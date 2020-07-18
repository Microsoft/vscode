/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/onTypeRename';
import * as nls from 'vs/nls';
import { registerEditorContribution, registerModelAndPositionCommand, EditorAction, EditorCommand, ServicesAccessor, registerEditorAction, registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import * as arrays from 'vs/base/common/arrays';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position, IPosition } from 'vs/editor/common/core/position';
import { ITextModel, IModelDeltaDecoration, TrackedRangeStickiness, IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IRange, Range } from 'vs/editor/common/core/range';
import { OnTypeRenameProviderRegistry } from 'vs/editor/common/modes';
import { first, createCancelablePromise, CancelablePromise, RunOnceScheduler } from 'vs/base/common/async';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ContextKeyExpr, RawContextKey, IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { URI } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { onUnexpectedError, onUnexpectedExternalError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';

export const CONTEXT_ONTYPE_RENAME_INPUT_VISIBLE = new RawContextKey<boolean>('onTypeRenameInputVisible', false);

export class OnTypeRenameContribution extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.onTypeRename';

	private static readonly DECORATION = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
		className: 'on-type-rename-decoration'
	});

	static get(editor: ICodeEditor): OnTypeRenameContribution {
		return editor.getContribution<OnTypeRenameContribution>(OnTypeRenameContribution.ID);
	}

	private readonly _editor: ICodeEditor;
	private _enabled: boolean;

	private readonly _visibleContextKey: IContextKey<boolean>;

	private _currentRequest: CancelablePromise<{
		ranges: IRange[],
		stopPattern?: RegExp
	} | null | undefined> | null;
	private _currentDecorations: string[]; // The one at index 0 is the reference one
	private _stopPattern: RegExp;
	private _ignoreChangeEvent: boolean;
	private _updateMirrors: RunOnceScheduler;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();
		this._editor = editor;
		this._enabled = this._editor.getOption(EditorOption.renameOnType);
		this._visibleContextKey = CONTEXT_ONTYPE_RENAME_INPUT_VISIBLE.bindTo(contextKeyService);
		this._currentRequest = null;
		this._currentDecorations = [];
		this._stopPattern = /^\s/;
		this._ignoreChangeEvent = false;
		this._updateMirrors = this._register(new RunOnceScheduler(() => this._doUpdateMirrors(), 0));

		this._register(this._editor.onDidChangeModel((e) => {
			this.stopAll();
			this.run();
		}));

		this._register(this._editor.onDidChangeConfiguration((e) => {
			if (e.hasChanged(EditorOption.renameOnType)) {
				this._enabled = this._editor.getOption(EditorOption.renameOnType);
				this.stopAll();
				this.run();
			}
		}));

		this._register(this._editor.onDidChangeCursorPosition((e) => {
			// no regions, run
			if (this._currentDecorations.length === 0) {
				this.run(e.position);
			}

			// has cached regions, don't run
			if (!this._editor.hasModel()) {
				return;
			}
			if (this._currentDecorations.length === 0) {
				return;
			}
			const model = this._editor.getModel();
			const currentRanges = this._currentDecorations.map(decId => model.getDecorationRange(decId)!);

			// just moving cursor around, don't run again
			if (Range.containsPosition(currentRanges[0], e.position)) {
				return;
			}

			// moving cursor out of primary region, run
			this.run(e.position);
		}));

		this._register(OnTypeRenameProviderRegistry.onDidChange(() => {
			this.run();
		}));

		this._register(this._editor.onDidChangeModelContent((e) => {
			if (this._ignoreChangeEvent) {
				return;
			}
			if (!this._editor.hasModel()) {
				return;
			}
			if (this._currentDecorations.length === 0) {
				// nothing to do
				return;
			}
			if (e.isUndoing || e.isRedoing) {
				return;
			}
			if (e.changes[0] && this._stopPattern.test(e.changes[0].text)) {
				this.stopAll();
				return;
			}
			this._updateMirrors.schedule();
		}));
	}

	private _doUpdateMirrors(): void {
		if (!this._editor.hasModel()) {
			return;
		}
		if (this._currentDecorations.length === 0) {
			// nothing to do
			return;
		}

		const model = this._editor.getModel();
		const currentRanges = this._currentDecorations.map(decId => model.getDecorationRange(decId)!);

		const referenceRange = currentRanges[0];
		if (referenceRange.startLineNumber !== referenceRange.endLineNumber) {
			return this.stopAll();
		}

		const referenceValue = model.getValueInRange(referenceRange);
		if (this._stopPattern.test(referenceValue)) {
			return this.stopAll();
		}

		let edits: IIdentifiedSingleEditOperation[] = [];
		for (let i = 1, len = currentRanges.length; i < len; i++) {
			const mirrorRange = currentRanges[i];
			if (mirrorRange.startLineNumber !== mirrorRange.endLineNumber) {
				edits.push({
					range: mirrorRange,
					text: referenceValue
				});
			} else {
				let oldValue = model.getValueInRange(mirrorRange);
				let newValue = referenceValue;
				let rangeStartColumn = mirrorRange.startColumn;
				let rangeEndColumn = mirrorRange.endColumn;

				const commonPrefixLength = strings.commonPrefixLength(oldValue, newValue);
				rangeStartColumn += commonPrefixLength;
				oldValue = oldValue.substr(commonPrefixLength);
				newValue = newValue.substr(commonPrefixLength);

				const commonSuffixLength = strings.commonSuffixLength(oldValue, newValue);
				rangeEndColumn -= commonSuffixLength;
				oldValue = oldValue.substr(0, oldValue.length - commonSuffixLength);
				newValue = newValue.substr(0, newValue.length - commonSuffixLength);

				if (rangeStartColumn !== rangeEndColumn || newValue.length !== 0) {
					edits.push({
						range: new Range(mirrorRange.startLineNumber, rangeStartColumn, mirrorRange.endLineNumber, rangeEndColumn),
						text: newValue
					});
				}
			}
		}

		if (edits.length === 0) {
			return;
		}

		try {
			this._ignoreChangeEvent = true;
			const prevEditOperationType = this._editor._getViewModel().getPrevEditOperationType();
			this._editor.executeEdits('onTypeRename', edits);
			this._editor._getViewModel().setPrevEditOperationType(prevEditOperationType);
		} finally {
			this._ignoreChangeEvent = false;
		}
	}

	public dispose(): void {
		super.dispose();
		this.stopAll();
	}

	stopAll(): void {
		this._visibleContextKey.set(false);
		this._currentDecorations = this._editor.deltaDecorations(this._currentDecorations, []);
	}

	async run(position: Position | null = this._editor.getPosition(), force = false): Promise<void> {
		if (!position) {
			return;
		}
		if (!this._enabled && !force) {
			return;
		}
		if (!this._editor.hasModel()) {
			return;
		}

		if (this._currentRequest) {
			this._currentRequest.cancel();
			this._currentRequest = null;
		}

		const model = this._editor.getModel();

		this._currentRequest = createCancelablePromise(token => getOnTypeRenameRanges(model, position, token));
		try {
			const response = await this._currentRequest;

			let ranges: IRange[] = [];
			if (response?.ranges) {
				ranges = response.ranges;
			}
			if (response?.stopPattern) {
				this._stopPattern = response.stopPattern;
			}

			let foundReferenceRange = false;
			for (let i = 0, len = ranges.length; i < len; i++) {
				if (Range.containsPosition(ranges[i], position)) {
					foundReferenceRange = true;
					if (i !== 0) {
						const referenceRange = ranges[i];
						ranges.splice(i, 1);
						ranges.unshift(referenceRange);
					}
					break;
				}
			}

			if (!foundReferenceRange) {
				// Cannot do on type rename if the ranges are not where the cursor is...
				this.stopAll();
				return;
			}

			const decorations: IModelDeltaDecoration[] = ranges.map(range => ({ range: range, options: OnTypeRenameContribution.DECORATION }));
			this._visibleContextKey.set(true);
			this._currentDecorations = this._editor.deltaDecorations(this._currentDecorations, decorations);
		} catch (err) {
			onUnexpectedError(err);
			this.stopAll();
		}
	}
}

export class OnTypeRenameAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.onTypeRename',
			label: nls.localize('onTypeRename.label', "On Type Rename Symbol"),
			alias: 'On Type Rename Symbol',
			precondition: ContextKeyExpr.and(EditorContextKeys.writable, EditorContextKeys.hasRenameProvider),
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.F2,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	runCommand(accessor: ServicesAccessor, args: [URI, IPosition]): void | Promise<void> {
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
		const controller = OnTypeRenameContribution.get(editor);
		if (controller) {
			return Promise.resolve(controller.run(editor.getPosition(), true));
		}
		return Promise.resolve();
	}
}

const OnTypeRenameCommand = EditorCommand.bindToContribution<OnTypeRenameContribution>(OnTypeRenameContribution.get);
registerEditorCommand(new OnTypeRenameCommand({
	id: 'cancelOnTypeRenameInput',
	precondition: CONTEXT_ONTYPE_RENAME_INPUT_VISIBLE,
	handler: x => x.stopAll(),
	kbOpts: {
		kbExpr: EditorContextKeys.editorTextFocus,
		weight: KeybindingWeight.EditorContrib + 99,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));


export function getOnTypeRenameRanges(model: ITextModel, position: Position, token: CancellationToken): Promise<{
	ranges: IRange[],
	stopPattern?: RegExp
} | undefined | null> {
	const orderedByScore = OnTypeRenameProviderRegistry.ordered(model);

	// in order of score ask the occurrences provider
	// until someone response with a good result
	// (good = none empty array)
	return first<{
		ranges: IRange[],
		stopPattern?: RegExp
	} | undefined>(orderedByScore.map(provider => () => {
		return Promise.resolve(provider.provideOnTypeRenameRanges(model, position, token)).then((ranges) => {
			if (!ranges) {
				return undefined;
			}

			return {
				ranges,
				stopPattern: provider.stopPattern
			};
		}, (err) => {
			onUnexpectedExternalError(err);
			return undefined;
		});

	}), result => !!result && arrays.isNonEmptyArray(result?.ranges));
}


registerModelAndPositionCommand('_executeRenameOnTypeProvider', (model, position) => getOnTypeRenameRanges(model, position, CancellationToken.None));

registerEditorContribution(OnTypeRenameContribution.ID, OnTypeRenameContribution);
registerEditorAction(OnTypeRenameAction);
