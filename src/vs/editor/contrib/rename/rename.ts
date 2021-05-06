/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { onUnexpectedError } from 'vs/base/common/errors';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IEditorProgressService } from 'vs/platform/progress/common/progress';
import { registerEditorAction, registerEditorContribution, ServicesAccessor, EditorAction, EditorCommand, registerEditorCommand, registerModelAndPositionCommand } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { RenameInputField, CONTEXT_RENAME_INPUT_VISIBLE } from './renameInputField';
import { WorkspaceEdit, RenameProviderRegistry, RenameProvider, RenameLocation, Rejection } from 'vs/editor/common/modes';
import { Position, IPosition } from 'vs/editor/common/core/position';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { Range } from 'vs/editor/common/core/range';
import { MessageController } from 'vs/editor/contrib/message/messageController';
import { CodeEditorStateFlag, EditorStateCancellationTokenSource } from 'vs/editor/browser/core/editorState';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IBulkEditService, ResourceEdit } from 'vs/editor/browser/services/bulkEditService';
import { URI } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IdleValue, raceCancellation } from 'vs/base/common/async';
import { ILogService } from 'vs/platform/log/common/log';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, ConfigurationScope, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { assertType } from 'vs/base/common/types';

class RenameSkeleton {

	private readonly _providers: RenameProvider[];
	private _providerRenameIdx: number = 0;

	constructor(
		private readonly model: ITextModel,
		private readonly position: Position
	) {
		this._providers = RenameProviderRegistry.ordered(model);
	}

	hasProvider() {
		return this._providers.length > 0;
	}

	async resolveRenameLocation(token: CancellationToken): Promise<RenameLocation & Rejection | undefined> {

		const rejects: string[] = [];

		for (this._providerRenameIdx = 0; this._providerRenameIdx < this._providers.length; this._providerRenameIdx++) {
			const provider = this._providers[this._providerRenameIdx];
			if (!provider.resolveRenameLocation) {
				break;
			}
			let res = await provider.resolveRenameLocation(this.model, this.position, token);
			if (!res) {
				continue;
			}
			if (res.rejectReason) {
				rejects.push(res.rejectReason);
				continue;
			}
			return res;
		}

		const word = this.model.getWordAtPosition(this.position);
		if (!word) {
			return {
				range: Range.fromPositions(this.position),
				text: '',
				rejectReason: rejects.length > 0 ? rejects.join('\n') : undefined
			};
		}
		return {
			range: new Range(this.position.lineNumber, word.startColumn, this.position.lineNumber, word.endColumn),
			text: word.word,
			rejectReason: rejects.length > 0 ? rejects.join('\n') : undefined
		};
	}

	async provideRenameEdits(newName: string, token: CancellationToken): Promise<WorkspaceEdit & Rejection> {
		return this._provideRenameEdits(newName, this._providerRenameIdx, [], token);
	}

	private async _provideRenameEdits(newName: string, i: number, rejects: string[], token: CancellationToken): Promise<WorkspaceEdit & Rejection> {
		const provider = this._providers[i];
		if (!provider) {
			return {
				edits: [],
				rejectReason: rejects.join('\n')
			};
		}

		const result = await provider.provideRenameEdits(this.model, this.position, newName, token);
		if (!result) {
			return this._provideRenameEdits(newName, i + 1, rejects.concat(nls.localize('no result', "No result.")), token);
		} else if (result.rejectReason) {
			return this._provideRenameEdits(newName, i + 1, rejects.concat(result.rejectReason), token);
		}
		return result;
	}
}

export async function rename(model: ITextModel, position: Position, newName: string): Promise<WorkspaceEdit & Rejection> {
	const skeleton = new RenameSkeleton(model, position);
	const loc = await skeleton.resolveRenameLocation(CancellationToken.None);
	if (loc?.rejectReason) {
		return { edits: [], rejectReason: loc.rejectReason };
	}
	return skeleton.provideRenameEdits(newName, CancellationToken.None);
}

// ---  register actions and commands

class RenameController implements IEditorContribution {

	public static readonly ID = 'editor.contrib.renameController';

	static get(editor: ICodeEditor): RenameController {
		return editor.getContribution<RenameController>(RenameController.ID);
	}

	private readonly _renameInputField: IdleValue<RenameInputField>;
	private readonly _dispoableStore = new DisposableStore();
	private _cts: CancellationTokenSource = new CancellationTokenSource();

	constructor(
		private readonly editor: ICodeEditor,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
		@IEditorProgressService private readonly _progressService: IEditorProgressService,
		@ILogService private readonly _logService: ILogService,
		@ITextResourceConfigurationService private readonly _configService: ITextResourceConfigurationService,
	) {
		this._renameInputField = this._dispoableStore.add(new IdleValue(() => this._dispoableStore.add(this._instaService.createInstance(RenameInputField, this.editor, ['acceptRenameInput', 'acceptRenameInputWithPreview']))));
	}

	dispose(): void {
		this._dispoableStore.dispose();
		this._cts.dispose(true);
	}

	async run(): Promise<void> {

		this._cts.dispose(true);

		if (!this.editor.hasModel()) {
			return undefined;
		}

		const position = this.editor.getPosition();
		const skeleton = new RenameSkeleton(this.editor.getModel(), position);

		if (!skeleton.hasProvider()) {
			return undefined;
		}

		this._cts = new EditorStateCancellationTokenSource(this.editor, CodeEditorStateFlag.Position | CodeEditorStateFlag.Value);

		// resolve rename location
		let loc: RenameLocation & Rejection | undefined;
		try {
			const resolveLocationOperation = skeleton.resolveRenameLocation(this._cts.token);
			this._progressService.showWhile(resolveLocationOperation, 250);
			loc = await resolveLocationOperation;
		} catch (e) {
			MessageController.get(this.editor).showMessage(e || nls.localize('resolveRenameLocationFailed', "An unknown error occurred while resolving rename location"), position);
			return undefined;
		}

		if (!loc) {
			return undefined;
		}

		if (loc.rejectReason) {
			MessageController.get(this.editor).showMessage(loc.rejectReason, position);
			return undefined;
		}

		if (this._cts.token.isCancellationRequested) {
			return undefined;
		}
		this._cts.dispose();
		this._cts = new EditorStateCancellationTokenSource(this.editor, CodeEditorStateFlag.Position | CodeEditorStateFlag.Value, loc.range);

		// do rename at location
		let selection = this.editor.getSelection();
		let selectionStart = 0;
		let selectionEnd = loc.text.length;

		if (!Range.isEmpty(selection) && !Range.spansMultipleLines(selection) && Range.containsRange(loc.range, selection)) {
			selectionStart = Math.max(0, selection.startColumn - loc.range.startColumn);
			selectionEnd = Math.min(loc.range.endColumn, selection.endColumn) - loc.range.startColumn;
		}

		const supportPreview = this._bulkEditService.hasPreviewHandler() && this._configService.getValue<boolean>(this.editor.getModel().uri, 'editor.rename.enablePreview');
		const inputFieldResult = await this._renameInputField.value.getInput(loc.range, loc.text, selectionStart, selectionEnd, supportPreview, this._cts.token);

		// no result, only hint to focus the editor or not
		if (typeof inputFieldResult === 'boolean') {
			if (inputFieldResult) {
				this.editor.focus();
			}
			return undefined;
		}

		this.editor.focus();

		const renameOperation = raceCancellation(skeleton.provideRenameEdits(inputFieldResult.newName, this._cts.token), this._cts.token).then(async renameResult => {

			if (!renameResult || !this.editor.hasModel()) {
				return;
			}

			if (renameResult.rejectReason) {
				this._notificationService.info(renameResult.rejectReason);
				return;
			}

			this._bulkEditService.apply(ResourceEdit.convert(renameResult), {
				editor: this.editor,
				showPreview: inputFieldResult.wantsPreview,
				label: nls.localize('label', "Renaming '{0}'", loc?.text),
				quotableLabel: nls.localize('quotableLabel', "Renaming {0}", loc?.text),
			}).then(result => {
				if (result.ariaSummary) {
					alert(nls.localize('aria', "Successfully renamed '{0}' to '{1}'. Summary: {2}", loc!.text, inputFieldResult.newName, result.ariaSummary));
				}
			}).catch(err => {
				this._notificationService.error(nls.localize('rename.failedApply', "Rename failed to apply edits"));
				this._logService.error(err);
			});

		}, err => {
			this._notificationService.error(nls.localize('rename.failed', "Rename failed to compute edits"));
			this._logService.error(err);
		});

		this._progressService.showWhile(renameOperation, 250);
		return renameOperation;

	}

	acceptRenameInput(wantsPreview: boolean): void {
		this._renameInputField.value.acceptInput(wantsPreview);
	}

	cancelRenameInput(): void {
		this._renameInputField.value.cancelInput(true);
	}
}

// ---- action implementation

export class RenameAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.rename',
			label: nls.localize('rename.label', "Rename Symbol"),
			alias: 'Rename Symbol',
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasRenameProvider),
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyCode.F2,
				weight: KeybindingWeight.EditorContrib
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 1.1
			}
		});
	}

	override runCommand(accessor: ServicesAccessor, args: [URI, IPosition]): void | Promise<void> {
		const editorService = accessor.get(ICodeEditorService);
		const [uri, pos] = Array.isArray(args) && args || [undefined, undefined];

		if (URI.isUri(uri) && Position.isIPosition(pos)) {
			return editorService.openCodeEditor({ resource: uri }, editorService.getActiveCodeEditor()).then(editor => {
				if (!editor) {
					return;
				}
				editor.setPosition(pos);
				editor.invokeWithinContext(accessor => {
					this.reportTelemetry(accessor, editor);
					return this.run(accessor, editor);
				});
			}, onUnexpectedError);
		}

		return super.runCommand(accessor, args);
	}

	run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const controller = RenameController.get(editor);
		if (controller) {
			return controller.run();
		}
		return Promise.resolve();
	}
}

registerEditorContribution(RenameController.ID, RenameController);
registerEditorAction(RenameAction);

const RenameCommand = EditorCommand.bindToContribution<RenameController>(RenameController.get);

registerEditorCommand(new RenameCommand({
	id: 'acceptRenameInput',
	precondition: CONTEXT_RENAME_INPUT_VISIBLE,
	handler: x => x.acceptRenameInput(false),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 99,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.Enter
	}
}));

registerEditorCommand(new RenameCommand({
	id: 'acceptRenameInputWithPreview',
	precondition: ContextKeyExpr.and(CONTEXT_RENAME_INPUT_VISIBLE, ContextKeyExpr.has('config.editor.rename.enablePreview')),
	handler: x => x.acceptRenameInput(true),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 99,
		kbExpr: EditorContextKeys.focus,
		primary: KeyMod.Shift + KeyCode.Enter
	}
}));

registerEditorCommand(new RenameCommand({
	id: 'cancelRenameInput',
	precondition: CONTEXT_RENAME_INPUT_VISIBLE,
	handler: x => x.cancelRenameInput(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 99,
		kbExpr: EditorContextKeys.focus,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

// ---- api bridge command

registerModelAndPositionCommand('_executeDocumentRenameProvider', function (model, position, ...args) {
	const [newName] = args;
	assertType(typeof newName === 'string');
	return rename(model, position, newName);
});


//todo@jrieken use editor options world
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'editor',
	properties: {
		'editor.rename.enablePreview': {
			scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
			description: nls.localize('enablePreview', "Enable/disable the ability to preview changes before renaming"),
			default: true,
			type: 'boolean'
		}
	}
});
