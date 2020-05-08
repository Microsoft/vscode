/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./folding';
import * as nls from 'vs/nls';
import * as types from 'vs/base/common/types';
import { escapeRegExpCharacters } from 'vs/base/common/strings';
import { RunOnceScheduler, Delayer, CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { KeyCode, KeyMod, KeyChord } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ScrollType, IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { registerEditorAction, registerEditorContribution, ServicesAccessor, EditorAction, registerInstantiatedEditorAction } from 'vs/editor/browser/editorExtensions';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { FoldingModel, setCollapseStateAtLevel, CollapseMemento, setCollapseStateLevelsDown, setCollapseStateLevelsUp, setCollapseStateForMatchingLines, setCollapseStateForType, toggleCollapseState, setCollapseStateUp } from 'vs/editor/contrib/folding/foldingModel';
import { FoldingDecorationProvider } from './foldingDecorations';
import { FoldingRegions, FoldingRegion } from './foldingRanges';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { IMarginData, IEmptyContentData } from 'vs/editor/browser/controller/mouseTarget';
import { HiddenRangeModel } from 'vs/editor/contrib/folding/hiddenRangeModel';
import { IRange } from 'vs/editor/common/core/range';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { IndentRangeProvider } from 'vs/editor/contrib/folding/indentRangeProvider';
import { IPosition } from 'vs/editor/common/core/position';
import { FoldingRangeProviderRegistry, FoldingRangeKind } from 'vs/editor/common/modes';
import { SyntaxRangeProvider, ID_SYNTAX_PROVIDER } from './syntaxRangeProvider';
import { CancellationToken } from 'vs/base/common/cancellation';
import { InitializingRangeProvider, ID_INIT_PROVIDER } from 'vs/editor/contrib/folding/intializingRangeProvider';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { onUnexpectedError } from 'vs/base/common/errors';
import { RawContextKey, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { registerColor, editorSelectionBackground, transparent, iconForeground } from 'vs/platform/theme/common/colorRegistry';

const CONTEXT_FOLDING_ENABLED = new RawContextKey<boolean>('foldingEnabled', false);

export interface RangeProvider {
	readonly id: string;
	compute(cancelationToken: CancellationToken): Promise<FoldingRegions | null>;
	dispose(): void;
}

interface FoldingStateMemento {
	collapsedRegions?: CollapseMemento;
	lineCount?: number;
	provider?: string;
}

export class FoldingController extends Disposable implements IEditorContribution {

	public static ID = 'editor.contrib.folding';

	static readonly MAX_FOLDING_REGIONS = 5000;

	public static get(editor: ICodeEditor): FoldingController {
		return editor.getContribution<FoldingController>(FoldingController.ID);
	}

	private readonly editor: ICodeEditor;
	private _isEnabled: boolean;
	private _useFoldingProviders: boolean;
	private _unfoldOnClickAfterEndOfLine: boolean;

	private readonly foldingDecorationProvider: FoldingDecorationProvider;

	private foldingModel: FoldingModel | null;
	private hiddenRangeModel: HiddenRangeModel | null;

	private rangeProvider: RangeProvider | null;
	private foldingRegionPromise: CancelablePromise<FoldingRegions | null> | null;

	private foldingStateMemento: FoldingStateMemento | null;

	private foldingModelPromise: Promise<FoldingModel | null> | null;
	private updateScheduler: Delayer<FoldingModel | null> | null;

	private foldingEnabled: IContextKey<boolean>;
	private cursorChangedScheduler: RunOnceScheduler | null;

	private readonly localToDispose = this._register(new DisposableStore());
	private mouseDownInfo: { lineNumber: number, iconClicked: boolean } | null;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();
		this.editor = editor;
		const options = this.editor.getOptions();
		this._isEnabled = options.get(EditorOption.folding);
		this._useFoldingProviders = options.get(EditorOption.foldingStrategy) !== 'indentation';
		this._unfoldOnClickAfterEndOfLine = options.get(EditorOption.unfoldOnClickAfterEndOfLine);

		this.foldingModel = null;
		this.hiddenRangeModel = null;
		this.rangeProvider = null;
		this.foldingRegionPromise = null;
		this.foldingStateMemento = null;
		this.foldingModelPromise = null;
		this.updateScheduler = null;
		this.cursorChangedScheduler = null;
		this.mouseDownInfo = null;

		this.foldingDecorationProvider = new FoldingDecorationProvider(editor);
		this.foldingDecorationProvider.autoHideFoldingControls = options.get(EditorOption.showFoldingControls) === 'mouseover';
		this.foldingDecorationProvider.showFoldingHighlights = options.get(EditorOption.foldingHighlight);
		this.foldingEnabled = CONTEXT_FOLDING_ENABLED.bindTo(this.contextKeyService);
		this.foldingEnabled.set(this._isEnabled);

		this._register(this.editor.onDidChangeModel(() => this.onModelChanged()));

		this._register(this.editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.folding)) {
				this._isEnabled = this.editor.getOptions().get(EditorOption.folding);
				this.foldingEnabled.set(this._isEnabled);
				this.onModelChanged();
			}
			if (e.hasChanged(EditorOption.showFoldingControls) || e.hasChanged(EditorOption.foldingHighlight)) {
				const options = this.editor.getOptions();
				this.foldingDecorationProvider.autoHideFoldingControls = options.get(EditorOption.showFoldingControls) === 'mouseover';
				this.foldingDecorationProvider.showFoldingHighlights = options.get(EditorOption.foldingHighlight);
				this.onModelContentChanged();
			}
			if (e.hasChanged(EditorOption.foldingStrategy)) {
				this._useFoldingProviders = this.editor.getOptions().get(EditorOption.foldingStrategy) !== 'indentation';
				this.onFoldingStrategyChanged();
			}
			if (e.hasChanged(EditorOption.unfoldOnClickAfterEndOfLine)) {
				this._unfoldOnClickAfterEndOfLine = this.editor.getOptions().get(EditorOption.unfoldOnClickAfterEndOfLine);
			}
		}));
		this.onModelChanged();
	}

	/**
	 * Store view state.
	 */
	public saveViewState(): FoldingStateMemento | undefined {
		let model = this.editor.getModel();
		if (!model || !this._isEnabled || model.isTooLargeForTokenization()) {
			return {};
		}
		if (this.foldingModel) { // disposed ?
			let collapsedRegions = this.foldingModel.isInitialized ? this.foldingModel.getMemento() : this.hiddenRangeModel!.getMemento();
			let provider = this.rangeProvider ? this.rangeProvider.id : undefined;
			return { collapsedRegions, lineCount: model.getLineCount(), provider };
		}
		return undefined;
	}

	/**
	 * Restore view state.
	 */
	public restoreViewState(state: FoldingStateMemento): void {
		let model = this.editor.getModel();
		if (!model || !this._isEnabled || model.isTooLargeForTokenization() || !this.hiddenRangeModel) {
			return;
		}
		if (!state || !state.collapsedRegions || state.lineCount !== model.getLineCount()) {
			return;
		}

		if (state.provider === ID_SYNTAX_PROVIDER || state.provider === ID_INIT_PROVIDER) {
			this.foldingStateMemento = state;
		}

		const collapsedRegions = state.collapsedRegions;

		// set the hidden ranges right away, before waiting for the folding model.
		if (this.hiddenRangeModel.applyMemento(collapsedRegions)) {
			const foldingModel = this.getFoldingModel();
			if (foldingModel) {
				foldingModel.then(foldingModel => {
					if (foldingModel) {
						foldingModel.applyMemento(collapsedRegions);
					}
				}).then(undefined, onUnexpectedError);
			}
		}
	}

	private onModelChanged(): void {
		this.localToDispose.clear();

		let model = this.editor.getModel();
		if (!this._isEnabled || !model || model.isTooLargeForTokenization()) {
			// huge files get no view model, so they cannot support hidden areas
			return;
		}

		this.foldingModel = new FoldingModel(model, this.foldingDecorationProvider);
		this.localToDispose.add(this.foldingModel);

		this.hiddenRangeModel = new HiddenRangeModel(this.foldingModel);
		this.localToDispose.add(this.hiddenRangeModel);
		this.localToDispose.add(this.hiddenRangeModel.onDidChange(hr => this.onHiddenRangesChanges(hr)));

		this.updateScheduler = new Delayer<FoldingModel>(200);

		this.cursorChangedScheduler = new RunOnceScheduler(() => this.revealCursor(), 200);
		this.localToDispose.add(this.cursorChangedScheduler);
		this.localToDispose.add(FoldingRangeProviderRegistry.onDidChange(() => this.onFoldingStrategyChanged()));
		this.localToDispose.add(this.editor.onDidChangeModelLanguageConfiguration(() => this.onFoldingStrategyChanged())); // covers model language changes as well
		this.localToDispose.add(this.editor.onDidChangeModelContent(() => this.onModelContentChanged()));
		this.localToDispose.add(this.editor.onDidChangeCursorPosition(() => this.onCursorPositionChanged()));
		this.localToDispose.add(this.editor.onMouseDown(e => this.onEditorMouseDown(e)));
		this.localToDispose.add(this.editor.onMouseUp(e => this.onEditorMouseUp(e)));
		this.localToDispose.add({
			dispose: () => {
				if (this.foldingRegionPromise) {
					this.foldingRegionPromise.cancel();
					this.foldingRegionPromise = null;
				}
				if (this.updateScheduler) {
					this.updateScheduler.cancel();
				}
				this.updateScheduler = null;
				this.foldingModel = null;
				this.foldingModelPromise = null;
				this.hiddenRangeModel = null;
				this.cursorChangedScheduler = null;
				this.foldingStateMemento = null;
				if (this.rangeProvider) {
					this.rangeProvider.dispose();
				}
				this.rangeProvider = null;
			}
		});
		this.onModelContentChanged();
	}

	private onFoldingStrategyChanged() {
		if (this.rangeProvider) {
			this.rangeProvider.dispose();
		}
		this.rangeProvider = null;
		this.onModelContentChanged();
	}

	private getRangeProvider(editorModel: ITextModel): RangeProvider {
		if (this.rangeProvider) {
			return this.rangeProvider;
		}
		this.rangeProvider = new IndentRangeProvider(editorModel); // fallback


		if (this._useFoldingProviders && this.foldingModel) {
			let foldingProviders = FoldingRangeProviderRegistry.ordered(this.foldingModel.textModel);
			if (foldingProviders.length === 0 && this.foldingStateMemento && this.foldingStateMemento.collapsedRegions) {
				const rangeProvider = this.rangeProvider = new InitializingRangeProvider(editorModel, this.foldingStateMemento.collapsedRegions, () => {
					// if after 30 the InitializingRangeProvider is still not replaced, force a refresh
					this.foldingStateMemento = null;
					this.onFoldingStrategyChanged();
				}, 30000);
				return rangeProvider; // keep memento in case there are still no foldingProviders on the next request.
			} else if (foldingProviders.length > 0) {
				this.rangeProvider = new SyntaxRangeProvider(editorModel, foldingProviders);
			}
		}
		this.foldingStateMemento = null;
		return this.rangeProvider;
	}

	public getFoldingModel() {
		return this.foldingModelPromise;
	}

	private onModelContentChanged() {
		if (this.updateScheduler) {
			if (this.foldingRegionPromise) {
				this.foldingRegionPromise.cancel();
				this.foldingRegionPromise = null;
			}
			this.foldingModelPromise = this.updateScheduler.trigger(() => {
				const foldingModel = this.foldingModel;
				if (!foldingModel) { // null if editor has been disposed, or folding turned off
					return null;
				}
				let foldingRegionPromise = this.foldingRegionPromise = createCancelablePromise(token => this.getRangeProvider(foldingModel.textModel).compute(token));
				return foldingRegionPromise.then(foldingRanges => {
					if (foldingRanges && foldingRegionPromise === this.foldingRegionPromise) { // new request or cancelled in the meantime?
						// some cursors might have moved into hidden regions, make sure they are in expanded regions
						let selections = this.editor.getSelections();
						let selectionLineNumbers = selections ? selections.map(s => s.startLineNumber) : [];
						foldingModel.update(foldingRanges, selectionLineNumbers);
					}
					return foldingModel;
				});
			}).then(undefined, (err) => {
				onUnexpectedError(err);
				return null;
			});
		}
	}

	private onHiddenRangesChanges(hiddenRanges: IRange[]) {
		if (this.hiddenRangeModel && hiddenRanges.length) {
			let selections = this.editor.getSelections();
			if (selections) {
				if (this.hiddenRangeModel.adjustSelections(selections)) {
					this.editor.setSelections(selections);
				}
			}
		}
		this.editor.setHiddenAreas(hiddenRanges);
	}

	private onCursorPositionChanged() {
		if (this.hiddenRangeModel && this.hiddenRangeModel.hasRanges()) {
			this.cursorChangedScheduler!.schedule();
		}
	}

	private revealCursor() {
		const foldingModel = this.getFoldingModel();
		if (!foldingModel) {
			return;
		}
		foldingModel.then(foldingModel => { // null is returned if folding got disabled in the meantime
			if (foldingModel) {
				let selections = this.editor.getSelections();
				if (selections && selections.length > 0) {
					let toToggle: FoldingRegion[] = [];
					for (let selection of selections) {
						let lineNumber = selection.selectionStartLineNumber;
						if (this.hiddenRangeModel && this.hiddenRangeModel.isHidden(lineNumber)) {
							toToggle.push(...foldingModel.getAllRegionsAtLine(lineNumber, r => r.isCollapsed && lineNumber > r.startLineNumber));
						}
					}
					if (toToggle.length) {
						foldingModel.toggleCollapseState(toToggle);
						this.reveal(selections[0].getPosition());
					}
				}
			}
		}).then(undefined, onUnexpectedError);

	}

	private onEditorMouseDown(e: IEditorMouseEvent): void {
		this.mouseDownInfo = null;


		if (!this.hiddenRangeModel || !e.target || !e.target.range) {
			return;
		}
		if (!e.event.leftButton && !e.event.middleButton) {
			return;
		}
		const range = e.target.range;
		let iconClicked = false;
		switch (e.target.type) {
			case MouseTargetType.GUTTER_LINE_DECORATIONS:
				const data = e.target.detail as IMarginData;
				const offsetLeftInGutter = (e.target.element as HTMLElement).offsetLeft;
				const gutterOffsetX = data.offsetX - offsetLeftInGutter;

				// const gutterOffsetX = data.offsetX - data.glyphMarginWidth - data.lineNumbersWidth - data.glyphMarginLeft;

				// TODO@joao TODO@alex TODO@martin this is such that we don't collide with dirty diff
				if (gutterOffsetX < 5) { // the whitespace between the border and the real folding icon border is 5px
					return;
				}

				iconClicked = true;
				break;
			case MouseTargetType.CONTENT_EMPTY: {
				if (this._unfoldOnClickAfterEndOfLine && this.hiddenRangeModel.hasRanges()) {
					const data = e.target.detail as IEmptyContentData;
					if (!data.isAfterLines) {
						break;
					}
				}
				return;
			}
			case MouseTargetType.CONTENT_TEXT: {
				if (this.hiddenRangeModel.hasRanges()) {
					let model = this.editor.getModel();
					if (model && range.startColumn === model.getLineMaxColumn(range.startLineNumber)) {
						break;
					}
				}
				return;
			}
			default:
				return;
		}

		this.mouseDownInfo = { lineNumber: range.startLineNumber, iconClicked };
	}

	private onEditorMouseUp(e: IEditorMouseEvent): void {
		const foldingModel = this.getFoldingModel();
		if (!foldingModel || !this.mouseDownInfo || !e.target) {
			return;
		}
		let lineNumber = this.mouseDownInfo.lineNumber;
		let iconClicked = this.mouseDownInfo.iconClicked;

		let range = e.target.range;
		if (!range || range.startLineNumber !== lineNumber) {
			return;
		}

		if (iconClicked) {
			if (e.target.type !== MouseTargetType.GUTTER_LINE_DECORATIONS) {
				return;
			}
		} else {
			let model = this.editor.getModel();
			if (!model || range.startColumn !== model.getLineMaxColumn(lineNumber)) {
				return;
			}
		}

		foldingModel.then(foldingModel => {
			if (foldingModel) {
				let region = foldingModel.getRegionAtLine(lineNumber);
				if (region && region.startLineNumber === lineNumber) {
					let isCollapsed = region.isCollapsed;
					if (iconClicked || isCollapsed) {
						let toToggle = [];
						let recursive = e.event.middleButton || e.event.shiftKey;
						if (recursive) {
							for (const r of foldingModel.getRegionsInside(region)) {
								if (r.isCollapsed === isCollapsed) {
									toToggle.push(r);
								}
							}
						}
						// when recursive, first only collapse all children. If all are already folded or there are no children, also fold parent.
						if (isCollapsed || !recursive || toToggle.length === 0) {
							toToggle.push(region);
						}
						foldingModel.toggleCollapseState(toToggle);
						this.reveal({ lineNumber, column: 1 });
					}
				}
			}
		}).then(undefined, onUnexpectedError);
	}

	public reveal(position: IPosition): void {
		this.editor.revealPositionInCenterIfOutsideViewport(position, ScrollType.Smooth);
	}
}

abstract class FoldingAction<T> extends EditorAction {

	abstract invoke(foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor, args: T): void;

	public runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor, args: T): void | Promise<void> {
		let foldingController = FoldingController.get(editor);
		if (!foldingController) {
			return;
		}
		let foldingModelPromise = foldingController.getFoldingModel();
		if (foldingModelPromise) {
			this.reportTelemetry(accessor, editor);
			return foldingModelPromise.then(foldingModel => {
				if (foldingModel) {
					this.invoke(foldingController, foldingModel, editor, args);
					const selection = editor.getSelection();
					if (selection) {
						foldingController.reveal(selection.getStartPosition());
					}
				}
			});
		}
	}

	protected getSelectedLines(editor: ICodeEditor) {
		let selections = editor.getSelections();
		return selections ? selections.map(s => s.startLineNumber) : [];
	}

	protected getLineNumbers(args: FoldingArguments, editor: ICodeEditor) {
		if (args && args.selectionLines) {
			return args.selectionLines.map(l => l + 1); // to 0-bases line numbers
		}
		return this.getSelectedLines(editor);
	}

	public run(_accessor: ServicesAccessor, _editor: ICodeEditor): void {
	}
}

interface FoldingArguments {
	levels?: number;
	direction?: 'up' | 'down';
	selectionLines?: number[];
}

function foldingArgumentsConstraint(args: any) {
	if (!types.isUndefined(args)) {
		if (!types.isObject(args)) {
			return false;
		}
		const foldingArgs: FoldingArguments = args;
		if (!types.isUndefined(foldingArgs.levels) && !types.isNumber(foldingArgs.levels)) {
			return false;
		}
		if (!types.isUndefined(foldingArgs.direction) && !types.isString(foldingArgs.direction)) {
			return false;
		}
		if (!types.isUndefined(foldingArgs.selectionLines) && (!types.isArray(foldingArgs.selectionLines) || !foldingArgs.selectionLines.every(types.isNumber))) {
			return false;
		}
	}
	return true;
}

class UnfoldAction extends FoldingAction<FoldingArguments> {

	constructor() {
		super({
			id: 'editor.unfold',
			label: nls.localize('unfoldAction.label', "Unfold"),
			alias: 'Unfold',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_CLOSE_SQUARE_BRACKET
				},
				weight: KeybindingWeight.EditorContrib
			},
			description: {
				description: 'Unfold the content in the editor',
				args: [
					{
						name: 'Unfold editor argument',
						description: `Property-value pairs that can be passed through this argument:
						* 'levels': Number of levels to unfold. If not set, defaults to 1.
						* 'direction': If 'up', unfold given number of levels up otherwise unfolds down.
						* 'selectionLines': The start lines (0-based) of the editor selections to apply the unfold action to. If not set, the active selection(s) will be used.
						`,
						constraint: foldingArgumentsConstraint,
						schema: {
							'type': 'object',
							'properties': {
								'levels': {
									'type': 'number',
									'default': 1
								},
								'direction': {
									'type': 'string',
									'enum': ['up', 'down'],
									'default': 'down'
								},
								'selectionLines': {
									'type': 'array',
									'items': {
										'type': 'number'
									}
								}
							}
						}
					}
				]
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor, args: FoldingArguments): void {
		let levels = args && args.levels || 1;
		let lineNumbers = this.getLineNumbers(args, editor);
		if (args && args.direction === 'up') {
			setCollapseStateLevelsUp(foldingModel, false, levels, lineNumbers);
		} else {
			setCollapseStateLevelsDown(foldingModel, false, levels, lineNumbers);
		}
	}
}

class UnFoldRecursivelyAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.unfoldRecursively',
			label: nls.localize('unFoldRecursivelyAction.label', "Unfold Recursively"),
			alias: 'Unfold Recursively',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor, _args: any): void {
		setCollapseStateLevelsDown(foldingModel, false, Number.MAX_VALUE, this.getSelectedLines(editor));
	}
}

class FoldAction extends FoldingAction<FoldingArguments> {

	constructor() {
		super({
			id: 'editor.fold',
			label: nls.localize('foldAction.label', "Fold"),
			alias: 'Fold',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_OPEN_SQUARE_BRACKET,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_OPEN_SQUARE_BRACKET
				},
				weight: KeybindingWeight.EditorContrib
			},
			description: {
				description: 'Fold the content in the editor',
				args: [
					{
						name: 'Fold editor argument',
						description: `Property-value pairs that can be passed through this argument:
							* 'levels': Number of levels to fold.
							* 'direction': If 'up', folds given number of levels up otherwise folds down.
							* 'selectionLines': The start lines (0-based) of the editor selections to apply the fold action to. If not set, the active selection(s) will be used.
							If no levels or direction is set, folds the region at the locations or if already collapsed, the first uncollapsed parent instead.
						`,
						constraint: foldingArgumentsConstraint,
						schema: {
							'type': 'object',
							'properties': {
								'levels': {
									'type': 'number',
								},
								'direction': {
									'type': 'string',
									'enum': ['up', 'down'],
								},
								'selectionLines': {
									'type': 'array',
									'items': {
										'type': 'number'
									}
								}
							}
						}
					}
				]
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor, args: FoldingArguments): void {
		let lineNumbers = this.getLineNumbers(args, editor);

		const levels = args && args.levels;
		const direction = args && args.direction;

		if (typeof levels !== 'number' && typeof direction !== 'string') {
			// fold the region at the location or if already collapsed, the first uncollapsed parent instead.
			setCollapseStateUp(foldingModel, true, lineNumbers);
		} else {
			if (direction === 'up') {
				setCollapseStateLevelsUp(foldingModel, true, levels || 1, lineNumbers);
			} else {
				setCollapseStateLevelsDown(foldingModel, true, levels || 1, lineNumbers);
			}
		}
	}
}


class ToggleFoldAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.toggleFold',
			label: nls.localize('toggleFoldAction.label', "Toggle Fold"),
			alias: 'Toggle Fold',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_L),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor): void {
		let selectedLines = this.getSelectedLines(editor);
		toggleCollapseState(foldingModel, 1, selectedLines);
	}
}


class FoldRecursivelyAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.foldRecursively',
			label: nls.localize('foldRecursivelyAction.label', "Fold Recursively"),
			alias: 'Fold Recursively',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_OPEN_SQUARE_BRACKET),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor): void {
		let selectedLines = this.getSelectedLines(editor);
		setCollapseStateLevelsDown(foldingModel, true, Number.MAX_VALUE, selectedLines);
	}
}

class FoldAllBlockCommentsAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.foldAllBlockComments',
			label: nls.localize('foldAllBlockComments.label', "Fold All Block Comments"),
			alias: 'Fold All Block Comments',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_SLASH),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor): void {
		if (foldingModel.regions.hasTypes()) {
			setCollapseStateForType(foldingModel, FoldingRangeKind.Comment.value, true);
		} else {
			const editorModel = editor.getModel();
			if (!editorModel) {
				return;
			}
			let comments = LanguageConfigurationRegistry.getComments(editorModel.getLanguageIdentifier().id);
			if (comments && comments.blockCommentStartToken) {
				let regExp = new RegExp('^\\s*' + escapeRegExpCharacters(comments.blockCommentStartToken));
				setCollapseStateForMatchingLines(foldingModel, regExp, true);
			}
		}
	}
}

class FoldAllRegionsAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.foldAllMarkerRegions',
			label: nls.localize('foldAllMarkerRegions.label', "Fold All Regions"),
			alias: 'Fold All Regions',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_8),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor): void {
		if (foldingModel.regions.hasTypes()) {
			setCollapseStateForType(foldingModel, FoldingRangeKind.Region.value, true);
		} else {
			const editorModel = editor.getModel();
			if (!editorModel) {
				return;
			}
			let foldingRules = LanguageConfigurationRegistry.getFoldingRules(editorModel.getLanguageIdentifier().id);
			if (foldingRules && foldingRules.markers && foldingRules.markers.start) {
				let regExp = new RegExp(foldingRules.markers.start);
				setCollapseStateForMatchingLines(foldingModel, regExp, true);
			}
		}
	}
}

class UnfoldAllRegionsAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.unfoldAllMarkerRegions',
			label: nls.localize('unfoldAllMarkerRegions.label', "Unfold All Regions"),
			alias: 'Unfold All Regions',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_9),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor): void {
		if (foldingModel.regions.hasTypes()) {
			setCollapseStateForType(foldingModel, FoldingRangeKind.Region.value, false);
		} else {
			const editorModel = editor.getModel();
			if (!editorModel) {
				return;
			}
			let foldingRules = LanguageConfigurationRegistry.getFoldingRules(editorModel.getLanguageIdentifier().id);
			if (foldingRules && foldingRules.markers && foldingRules.markers.start) {
				let regExp = new RegExp(foldingRules.markers.start);
				setCollapseStateForMatchingLines(foldingModel, regExp, false);
			}
		}
	}
}

class FoldAllAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.foldAll',
			label: nls.localize('foldAllAction.label', "Fold All"),
			alias: 'Fold All',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_0),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, _editor: ICodeEditor): void {
		setCollapseStateLevelsDown(foldingModel, true);
	}
}

class UnfoldAllAction extends FoldingAction<void> {

	constructor() {
		super({
			id: 'editor.unfoldAll',
			label: nls.localize('unfoldAllAction.label', "Unfold All"),
			alias: 'Unfold All',
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_J),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, _editor: ICodeEditor): void {
		setCollapseStateLevelsDown(foldingModel, false);
	}
}

class FoldLevelAction extends FoldingAction<void> {
	private static readonly ID_PREFIX = 'editor.foldLevel';
	public static readonly ID = (level: number) => FoldLevelAction.ID_PREFIX + level;

	private getFoldingLevel() {
		return parseInt(this.id.substr(FoldLevelAction.ID_PREFIX.length));
	}

	invoke(_foldingController: FoldingController, foldingModel: FoldingModel, editor: ICodeEditor): void {
		setCollapseStateAtLevel(foldingModel, this.getFoldingLevel(), true, this.getSelectedLines(editor));
	}
}

registerEditorContribution(FoldingController.ID, FoldingController);
registerEditorAction(UnfoldAction);
registerEditorAction(UnFoldRecursivelyAction);
registerEditorAction(FoldAction);
registerEditorAction(FoldRecursivelyAction);
registerEditorAction(FoldAllAction);
registerEditorAction(UnfoldAllAction);
registerEditorAction(FoldAllBlockCommentsAction);
registerEditorAction(FoldAllRegionsAction);
registerEditorAction(UnfoldAllRegionsAction);
registerEditorAction(ToggleFoldAction);

for (let i = 1; i <= 7; i++) {
	registerInstantiatedEditorAction(
		new FoldLevelAction({
			id: FoldLevelAction.ID(i),
			label: nls.localize('foldLevelAction.label', "Fold Level {0}", i),
			alias: `Fold Level ${i}`,
			precondition: CONTEXT_FOLDING_ENABLED,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | (KeyCode.KEY_0 + i)),
				weight: KeybindingWeight.EditorContrib
			}
		})
	);
}

export const foldBackgroundBackground = registerColor('editor.foldBackground', { light: transparent(editorSelectionBackground, 0.3), dark: transparent(editorSelectionBackground, 0.3), hc: null }, nls.localize('foldBackgroundBackground', "Background color behind folded ranges. The color must not be opaque so as not to hide underlying decorations."), true);
export const editorFoldForeground = registerColor('editorGutter.foldingControlForeground', { dark: iconForeground, light: iconForeground, hc: iconForeground }, nls.localize('editorGutter.foldingControlForeground', 'Color of the folding control in the editor gutter.'));

registerThemingParticipant((theme, collector) => {
	const foldBackground = theme.getColor(foldBackgroundBackground);
	if (foldBackground) {
		collector.addRule(`.monaco-editor .folded-background { background-color: ${foldBackground}; }`);
	}

	const editorFoldColor = theme.getColor(editorFoldForeground);
	if (editorFoldColor) {
		collector.addRule(`
		.monaco-editor .cldr.codicon-chevron-right,
		.monaco-editor .cldr.codicon-chevron-down {
			color: ${editorFoldColor} !important;
		}
		`);
	}
});
