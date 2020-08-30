/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/onTypeRename';
import * as nls from 'vs/nls';
import { registerEditorContribution, registerModelAndPositionCommand, EditorAction, EditorCommand, ServicesAccessor, registerEditorAction, registerEditorCommand } from 'vs/editor/browser/editorExtensions';
import * as arrays from 'vs/base/common/arrays';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position, IPosition } from 'vs/editor/common/core/position';
import { ITextModel, IModelDeltaDecoration, TrackedRangeStickiness, IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IRange, Range } from 'vs/editor/common/core/range';
import { OnTypeRenameProviderRegistry } from 'vs/editor/common/modes';
import { first, createCancelablePromise, CancelablePromise, Delayer } from 'vs/base/common/async';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ContextKeyExpr, RawContextKey, IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { URI } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { isPromiseCanceledError, onUnexpectedError, onUnexpectedExternalError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { Color } from 'vs/base/common/color';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';

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

	private _debounceDuration = 200;

	private readonly _editor: ICodeEditor;
	private _enabled: boolean;

	private readonly _visibleContextKey: IContextKey<boolean>;

	private _rangeUpdateTriggerPromise: Promise<any> | null;
	private _rangeSyncTriggerPromise: Promise<any> | null;

	private _currentRequest: CancelablePromise<any> | null;
	private _currentRequestPosition: Position | null;
	private _currentRequestModelVersion: number | null;

	private _currentDecorations: string[]; // The one at index 0 is the reference one
	private _languageWordPattern: RegExp | null;
	private _currentWordPattern: RegExp | null;
	private _ignoreChangeEvent: boolean;

	private readonly _localToDispose = this._register(new DisposableStore());

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super();
		this._editor = editor;
		this._enabled = false;
		this._visibleContextKey = CONTEXT_ONTYPE_RENAME_INPUT_VISIBLE.bindTo(contextKeyService);

		this._currentDecorations = [];
		this._languageWordPattern = null;
		this._currentWordPattern = null;
		this._ignoreChangeEvent = false;
		this._localToDispose = this._register(new DisposableStore());

		this._rangeUpdateTriggerPromise = null;
		this._rangeSyncTriggerPromise = null;

		this._currentRequest = null;
		this._currentRequestPosition = null;
		this._currentRequestModelVersion = null;

		this._register(this._editor.onDidChangeModel(() => this.reinitialize()));

		this._register(this._editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.renameOnType)) {
				this.reinitialize();
			}
		}));
		this._register(OnTypeRenameProviderRegistry.onDidChange(() => this.reinitialize()));
		this._register(this._editor.onDidChangeModelLanguage(() => this.reinitialize()));

		this.reinitialize();
	}

	private reinitialize() {
		const model = this._editor.getModel();
		const isEnabled = model !== null && this._editor.getOption(EditorOption.renameOnType) && OnTypeRenameProviderRegistry.has(model);
		if (isEnabled === this._enabled) {
			return;
		}

		this._enabled = isEnabled;

		this.clearRanges();
		this._localToDispose.clear();

		if (!isEnabled || model === null) {
			return;
		}

		this._languageWordPattern = LanguageConfigurationRegistry.getWordDefinition(model.getLanguageIdentifier().id);
		this._localToDispose.add(model.onDidChangeLanguageConfiguration(() => {
			this._languageWordPattern = LanguageConfigurationRegistry.getWordDefinition(model.getLanguageIdentifier().id);
		}));

		const rangeUpdateScheduler = new Delayer(this._debounceDuration);
		const triggerRangeUpdate = () => {
			this._rangeUpdateTriggerPromise = rangeUpdateScheduler.trigger(() => this.updateRanges(), this._debounceDuration);
		};
		const rangeSyncScheduler = new Delayer(0);
		const triggerRangeSync = (decorations: string[]) => {
			this._rangeSyncTriggerPromise = rangeSyncScheduler.trigger(() => this._syncRanges(decorations));
		};
		this._localToDispose.add(this._editor.onDidChangeCursorPosition(() => {
			triggerRangeUpdate();
		}));
		this._localToDispose.add(this._editor.onDidChangeModelContent((e) => {
			if (!this._ignoreChangeEvent) {
				if (this._currentDecorations.length > 0) {
					const referenceRange = model.getDecorationRange(this._currentDecorations[0]);
					if (referenceRange && e.changes.every(c => referenceRange.intersectRanges(c.range))) {
						triggerRangeSync(this._currentDecorations);
						return;
					}
				}
			}
			triggerRangeUpdate();
		}));
		this._localToDispose.add({
			dispose: () => {
				rangeUpdateScheduler.cancel();
				rangeSyncScheduler.cancel();
			}
		});
		this.updateRanges();
	}

	private _syncRanges(decorations: string[]): void {
		// dalayed invocation, make sure we're still on
		if (!this._editor.hasModel() || decorations !== this._currentDecorations || decorations.length === 0) {
			// nothing to do
			return;
		}

		const model = this._editor.getModel();
		const referenceRange = model.getDecorationRange(decorations[0]);

		if (!referenceRange || referenceRange.startLineNumber !== referenceRange.endLineNumber) {
			return this.clearRanges();
		}

		const referenceValue = model.getValueInRange(referenceRange);
		if (this._currentWordPattern) {
			const match = referenceValue.match(this._currentWordPattern);
			const matchLength = match ? match[0].length : 0;
			if (matchLength !== referenceValue.length) {
				return this.clearRanges();
			}
		}

		let edits: IIdentifiedSingleEditOperation[] = [];
		for (let i = 1, len = decorations.length; i < len; i++) {
			const mirrorRange = model.getDecorationRange(decorations[i]);
			if (!mirrorRange) {
				continue;
			}
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
		this.clearRanges();
		super.dispose();
	}

	public clearRanges(): void {
		this._visibleContextKey.set(false);
		this._currentDecorations = this._editor.deltaDecorations(this._currentDecorations, []);
		if (this._currentRequest) {
			this._currentRequest.cancel();
			this._currentRequest = null;
			this._currentRequestPosition = null;
		}
	}

	public get currentUpdateTriggerPromise(): Promise<any> {
		return this._rangeUpdateTriggerPromise || Promise.resolve();
	}

	public get currentSyncTriggerPromise(): Promise<any> {
		return this._rangeSyncTriggerPromise || Promise.resolve();
	}

	public async updateRanges(force = false): Promise<void> {
		if (!this._editor.hasModel()) {
			this.clearRanges();
			return;
		}

		const position = this._editor.getPosition();
		if (!this._enabled && !force || this._editor.getSelections().length > 1) {
			// disabled or multicursor
			this.clearRanges();
			return;
		}

		const model = this._editor.getModel();
		const modelVersionId = model.getVersionId();
		if (this._currentRequestPosition && this._currentRequestModelVersion === modelVersionId) {
			if (position.equals(this._currentRequestPosition)) {
				return; // same position
			}
			if (this._currentDecorations && this._currentDecorations.length > 0) {
				const range = model.getDecorationRange(this._currentDecorations[0]);
				if (range && range.containsPosition(position)) {
					return; // just moving inside the existing primary range
				}
			}
		}

		this._currentRequestPosition = position;
		this._currentRequestModelVersion = modelVersionId;
		const request = createCancelablePromise(async token => {
			try {
				const response = await getOnTypeRenameRanges(model, position, token);
				if (request !== this._currentRequest) {
					return;
				}
				this._currentRequest = null;
				if (modelVersionId !== model.getVersionId()) {
					return;
				}

				let ranges: IRange[] = [];
				if (response?.ranges) {
					ranges = response.ranges;
				}

				this._currentWordPattern = response?.wordPattern || this._languageWordPattern;

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
					this.clearRanges();
					return;
				}

				const decorations: IModelDeltaDecoration[] = ranges.map(range => ({ range: range, options: OnTypeRenameContribution.DECORATION }));
				this._visibleContextKey.set(true);
				this._currentDecorations = this._editor.deltaDecorations(this._currentDecorations, decorations);
			} catch (err) {
				if (!isPromiseCanceledError(err)) {
					onUnexpectedError(err);
				}
				if (this._currentRequest === request || !this._currentRequest) {
					// stop if we are still the latest request
					this.clearRanges();
				}
			}
		});
		this._currentRequest = request;
		return request;
	}

	// for testing
	public setDebounceDuration(timeInMS: number) {
		this._debounceDuration = timeInMS;
	}

	// private printDecorators(model: ITextModel) {
	// 	return this._currentDecorations.map(d => {
	// 		const range = model.getDecorationRange(d);
	// 		if (range) {
	// 			return this.printRange(range);
	// 		}
	// 		return 'invalid';
	// 	}).join(',');
	// }

	// private printChanges(changes: IModelContentChange[]) {
	// 	return changes.map(c => {
	// 		return `${this.printRange(c.range)} - ${c.text}`;
	// 	}
	// 	).join(',');
	// }

	// private printRange(range: IRange) {
	// 	return `${range.startLineNumber},${range.startColumn}/${range.endLineNumber},${range.endColumn}`;
	// }
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

	run(_accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const controller = OnTypeRenameContribution.get(editor);
		if (controller) {
			return Promise.resolve(controller.updateRanges(true));
		}
		return Promise.resolve();
	}
}

const OnTypeRenameCommand = EditorCommand.bindToContribution<OnTypeRenameContribution>(OnTypeRenameContribution.get);
registerEditorCommand(new OnTypeRenameCommand({
	id: 'cancelOnTypeRenameInput',
	precondition: CONTEXT_ONTYPE_RENAME_INPUT_VISIBLE,
	handler: x => x.clearRanges(),
	kbOpts: {
		kbExpr: EditorContextKeys.editorTextFocus,
		weight: KeybindingWeight.EditorContrib + 99,
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));


export function getOnTypeRenameRanges(model: ITextModel, position: Position, token: CancellationToken): Promise<{
	ranges: IRange[],
	wordPattern?: RegExp
} | undefined | null> {
	const orderedByScore = OnTypeRenameProviderRegistry.ordered(model);

	// in order of score ask the occurrences provider
	// until someone response with a good result
	// (good = none empty array)
	return first<{
		ranges: IRange[],
		wordPattern?: RegExp
	} | undefined>(orderedByScore.map(provider => () => {
		return Promise.resolve(provider.provideOnTypeRenameRanges(model, position, token)).then((res) => {
			if (!res) {
				return undefined;
			}

			return {
				ranges: res.ranges,
				wordPattern: res.wordPattern || provider.wordPattern
			};
		}, (err) => {
			onUnexpectedExternalError(err);
			return undefined;
		});

	}), result => !!result && arrays.isNonEmptyArray(result?.ranges));
}

export const editorOnTypeRenameBackground = registerColor('editor.onTypeRenameBackground', { dark: Color.fromHex('#f00').transparent(0.3), light: Color.fromHex('#f00').transparent(0.3), hc: Color.fromHex('#f00').transparent(0.3) }, nls.localize('editorOnTypeRenameBackground', 'Background color when the editor auto renames on type.'));
registerThemingParticipant((theme, collector) => {
	const editorOnTypeRenameBackgroundColor = theme.getColor(editorOnTypeRenameBackground);
	if (editorOnTypeRenameBackgroundColor) {
		collector.addRule(`.monaco-editor .on-type-rename-decoration { background: ${editorOnTypeRenameBackgroundColor}; border-left-color: ${editorOnTypeRenameBackgroundColor}; }`);
	}
});

registerModelAndPositionCommand('_executeRenameOnTypeProvider', (model, position) => getOnTypeRenameRanges(model, position, CancellationToken.None));

registerEditorContribution(OnTypeRenameContribution.ID, OnTypeRenameContribution);
registerEditorAction(OnTypeRenameAction);
