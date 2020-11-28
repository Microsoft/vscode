/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Delayer } from 'vs/base/common/async';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, EditorCommand, ServicesAccessor, registerEditorAction, registerEditorCommand, registerEditorContribution, MultiEditorAction, registerMultiEditorAction } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { CONTEXT_FIND_INPUT_FOCUSED, CONTEXT_FIND_WIDGET_VISIBLE, FIND_IDS, FindModelBoundToEditorModel, ToggleCaseSensitiveKeybinding, TogglePreserveCaseKeybinding, ToggleRegexKeybinding, ToggleSearchScopeKeybinding, ToggleWholeWordKeybinding, CONTEXT_REPLACE_INPUT_FOCUSED } from 'vs/editor/contrib/find/findModel';
import { FindOptionsWidget } from 'vs/editor/contrib/find/findOptionsWidget';
import { FindReplaceState, FindReplaceStateChangedEvent, INewFindReplaceState } from 'vs/editor/contrib/find/findState';
import { FindWidget, IFindController } from 'vs/editor/contrib/find/findWidget';
import { MenuId } from 'vs/platform/actions/common/actions';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IContextKey, IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

const SEARCH_STRING_MAX_LENGTH = 524288;

export function getSelectionSearchString(editor: ICodeEditor, seedSearchStringFromSelection: 'single' | 'multiple' = 'single'): string | null {
	if (!editor.hasModel()) {
		return null;
	}

	const selection = editor.getSelection();
	// if selection spans multiple lines, default search string to empty

	if ((seedSearchStringFromSelection === 'single' && selection.startLineNumber === selection.endLineNumber)
		|| seedSearchStringFromSelection === 'multiple') {
		if (selection.isEmpty()) {
			const wordAtPosition = editor.getConfiguredWordAtPosition(selection.getStartPosition());
			if (wordAtPosition) {
				return wordAtPosition.word;
			}
		} else {
			if (editor.getModel().getValueLengthInRange(selection) < SEARCH_STRING_MAX_LENGTH) {
				return editor.getModel().getValueInRange(selection);
			}
		}
	}

	return null;
}

export const enum FindStartFocusAction {
	NoFocusChange,
	FocusFindInput,
	FocusReplaceInput
}

export interface IFindStartOptions {
	forceRevealReplace: boolean;
	seedSearchStringFromSelection: 'none' | 'single' | 'multiple';
	seedSearchStringFromGlobalClipboard: boolean;
	shouldFocus: FindStartFocusAction;
	shouldAnimate: boolean;
	updateSearchScope: boolean;
	loop: boolean;
}

export class CommonFindController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.findController';

	protected _editor: ICodeEditor;
	private readonly _findWidgetVisible: IContextKey<boolean>;
	protected _state: FindReplaceState;
	protected _updateHistoryDelayer: Delayer<void>;
	private _model: FindModelBoundToEditorModel | null;
	protected readonly _storageService: IStorageService;
	private readonly _clipboardService: IClipboardService;
	protected readonly _contextKeyService: IContextKeyService;

	get editor() {
		return this._editor;
	}

	public static get(editor: ICodeEditor): CommonFindController {
		return editor.getContribution<CommonFindController>(CommonFindController.ID);
	}

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService storageService: IStorageService,
		@IClipboardService clipboardService: IClipboardService
	) {
		super();
		this._editor = editor;
		this._findWidgetVisible = CONTEXT_FIND_WIDGET_VISIBLE.bindTo(contextKeyService);
		this._contextKeyService = contextKeyService;
		this._storageService = storageService;
		this._clipboardService = clipboardService;

		this._updateHistoryDelayer = new Delayer<void>(500);
		this._state = this._register(new FindReplaceState());
		this.loadQueryState();
		this._register(this._state.onFindReplaceStateChange((e) => this._onStateChanged(e)));

		this._model = null;

		this._register(this._editor.onDidChangeModel(() => {
			let shouldRestartFind = (this._editor.getModel() && this._state.isRevealed);

			this.disposeModel();

			this._state.change({
				searchScope: null,
				matchCase: this._storageService.getBoolean('editor.matchCase', StorageScope.WORKSPACE, false),
				wholeWord: this._storageService.getBoolean('editor.wholeWord', StorageScope.WORKSPACE, false),
				isRegex: this._storageService.getBoolean('editor.isRegex', StorageScope.WORKSPACE, false),
				preserveCase: this._storageService.getBoolean('editor.preserveCase', StorageScope.WORKSPACE, false)
			}, false);

			if (shouldRestartFind) {
				this._start({
					forceRevealReplace: false,
					seedSearchStringFromSelection: 'none',
					seedSearchStringFromGlobalClipboard: false,
					shouldFocus: FindStartFocusAction.NoFocusChange,
					shouldAnimate: false,
					updateSearchScope: false,
					loop: this._editor.getOption(EditorOption.find).loop
				});
			}
		}));
	}

	public dispose(): void {
		this.disposeModel();
		super.dispose();
	}

	private disposeModel(): void {
		if (this._model) {
			this._model.dispose();
			this._model = null;
		}
	}

	private _onStateChanged(e: FindReplaceStateChangedEvent): void {
		this.saveQueryState(e);

		if (e.isRevealed) {
			if (this._state.isRevealed) {
				this._findWidgetVisible.set(true);
			} else {
				this._findWidgetVisible.reset();
				this.disposeModel();
			}
		}
		if (e.searchString) {
			this.setGlobalBufferTerm(this._state.searchString);
		}
	}

	private saveQueryState(e: FindReplaceStateChangedEvent) {
		if (e.isRegex) {
			this._storageService.store('editor.isRegex', this._state.actualIsRegex, StorageScope.WORKSPACE, StorageTarget.USER);
		}
		if (e.wholeWord) {
			this._storageService.store('editor.wholeWord', this._state.actualWholeWord, StorageScope.WORKSPACE, StorageTarget.USER);
		}
		if (e.matchCase) {
			this._storageService.store('editor.matchCase', this._state.actualMatchCase, StorageScope.WORKSPACE, StorageTarget.USER);
		}
		if (e.preserveCase) {
			this._storageService.store('editor.preserveCase', this._state.actualPreserveCase, StorageScope.WORKSPACE, StorageTarget.USER);
		}
	}

	private loadQueryState() {
		this._state.change({
			matchCase: this._storageService.getBoolean('editor.matchCase', StorageScope.WORKSPACE, this._state.matchCase),
			wholeWord: this._storageService.getBoolean('editor.wholeWord', StorageScope.WORKSPACE, this._state.wholeWord),
			isRegex: this._storageService.getBoolean('editor.isRegex', StorageScope.WORKSPACE, this._state.isRegex),
			preserveCase: this._storageService.getBoolean('editor.preserveCase', StorageScope.WORKSPACE, this._state.preserveCase)
		}, false);
	}

	public isFindInputFocused(): boolean {
		return !!CONTEXT_FIND_INPUT_FOCUSED.getValue(this._contextKeyService);
	}

	public getState(): FindReplaceState {
		return this._state;
	}

	public closeFindWidget(): void {
		this._state.change({
			isRevealed: false,
			searchScope: null
		}, false);
		this._editor.focus();
	}

	public toggleCaseSensitive(): void {
		this._state.change({ matchCase: !this._state.matchCase }, false);
		if (!this._state.isRevealed) {
			this.highlightFindOptions();
		}
	}

	public toggleWholeWords(): void {
		this._state.change({ wholeWord: !this._state.wholeWord }, false);
		if (!this._state.isRevealed) {
			this.highlightFindOptions();
		}
	}

	public toggleRegex(): void {
		this._state.change({ isRegex: !this._state.isRegex }, false);
		if (!this._state.isRevealed) {
			this.highlightFindOptions();
		}
	}

	public togglePreserveCase(): void {
		this._state.change({ preserveCase: !this._state.preserveCase }, false);
		if (!this._state.isRevealed) {
			this.highlightFindOptions();
		}
	}

	public toggleSearchScope(): void {
		if (this._state.searchScope) {
			this._state.change({ searchScope: null }, true);
		} else {
			if (this._editor.hasModel()) {
				let selections = this._editor.getSelections();
				selections.map(selection => {
					if (selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber) {
						selection = selection.setEndPosition(
							selection.endLineNumber - 1,
							this._editor.getModel()!.getLineMaxColumn(selection.endLineNumber - 1)
						);
					}
					if (!selection.isEmpty()) {
						return selection;
					}
					return null;
				}).filter(element => !!element);

				if (selections.length) {
					this._state.change({ searchScope: selections }, true);
				}
			}
		}
	}

	public setSearchString(searchString: string): void {
		if (this._state.isRegex) {
			searchString = strings.escapeRegExpCharacters(searchString);
		}
		this._state.change({ searchString: searchString }, false);
	}

	public highlightFindOptions(ignoreWhenVisible: boolean = false): void {
		// overwritten in subclass
	}

	protected async _start(opts: IFindStartOptions): Promise<void> {
		this.disposeModel();

		if (!this._editor.hasModel()) {
			// cannot do anything with an editor that doesn't have a model...
			return;
		}

		let stateChanges: INewFindReplaceState = {
			isRevealed: true
		};

		if (opts.seedSearchStringFromSelection === 'single') {
			let selectionSearchString = getSelectionSearchString(this._editor, opts.seedSearchStringFromSelection);
			if (selectionSearchString) {
				if (this._state.isRegex) {
					stateChanges.searchString = strings.escapeRegExpCharacters(selectionSearchString);
				} else {
					stateChanges.searchString = selectionSearchString;
				}
			}
		} else if (opts.seedSearchStringFromSelection === 'multiple' && !opts.updateSearchScope) {
			let selectionSearchString = getSelectionSearchString(this._editor, opts.seedSearchStringFromSelection);
			if (selectionSearchString) {
				stateChanges.searchString = selectionSearchString;
			}
		}

		if (!stateChanges.searchString && opts.seedSearchStringFromGlobalClipboard) {
			let selectionSearchString = await this.getGlobalBufferTerm();

			if (!this._editor.hasModel()) {
				// the editor has lost its model in the meantime
				return;
			}

			if (selectionSearchString) {
				stateChanges.searchString = selectionSearchString;
			}
		}

		// Overwrite isReplaceRevealed
		if (opts.forceRevealReplace) {
			stateChanges.isReplaceRevealed = true;
		} else if (!this._findWidgetVisible.get()) {
			stateChanges.isReplaceRevealed = false;
		}

		if (opts.updateSearchScope) {
			let currentSelections = this._editor.getSelections();
			if (currentSelections.some(selection => !selection.isEmpty())) {
				stateChanges.searchScope = currentSelections;
			}
		}

		stateChanges.loop = opts.loop;

		this._state.change(stateChanges, false);

		if (!this._model) {
			this._model = new FindModelBoundToEditorModel(this._editor, this._state);
		}
	}

	public start(opts: IFindStartOptions): Promise<void> {
		return this._start(opts);
	}

	public moveToNextMatch(): boolean {
		if (this._model) {
			this._model.moveToNextMatch();
			return true;
		}
		return false;
	}

	public moveToPrevMatch(): boolean {
		if (this._model) {
			this._model.moveToPrevMatch();
			return true;
		}
		return false;
	}

	public replace(): boolean {
		if (this._model) {
			this._model.replace();
			return true;
		}
		return false;
	}

	public replaceAll(): boolean {
		if (this._model) {
			this._model.replaceAll();
			return true;
		}
		return false;
	}

	public selectAllMatches(): boolean {
		if (this._model) {
			this._model.selectAllMatches();
			this._editor.focus();
			return true;
		}
		return false;
	}

	public async getGlobalBufferTerm(): Promise<string> {
		if (this._editor.getOption(EditorOption.find).globalFindClipboard
			&& this._editor.hasModel()
			&& !this._editor.getModel().isTooLargeForSyncing()
		) {
			return this._clipboardService.readFindText();
		}
		return '';
	}

	public setGlobalBufferTerm(text: string): void {
		if (this._editor.getOption(EditorOption.find).globalFindClipboard
			&& this._editor.hasModel()
			&& !this._editor.getModel().isTooLargeForSyncing()
		) {
			// intentionally not awaited
			this._clipboardService.writeFindText(text);
		}
	}
}

export class FindController extends CommonFindController implements IFindController {

	private _widget: FindWidget | null;
	private _findOptionsWidget: FindOptionsWidget | null;

	constructor(
		editor: ICodeEditor,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IContextKeyService _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IThemeService private readonly _themeService: IThemeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IStorageService _storageService: IStorageService,
		@IClipboardService clipboardService: IClipboardService,
	) {
		super(editor, _contextKeyService, _storageService, clipboardService);
		this._widget = null;
		this._findOptionsWidget = null;
	}

	protected async _start(opts: IFindStartOptions): Promise<void> {
		if (!this._widget) {
			this._createFindWidget();
		}

		const selection = this._editor.getSelection();
		let updateSearchScope = false;

		switch (this._editor.getOption(EditorOption.find).autoFindInSelection) {
			case 'always':
				updateSearchScope = true;
				break;
			case 'never':
				updateSearchScope = false;
				break;
			case 'multiline':
				const isSelectionMultipleLine = !!selection && selection.startLineNumber !== selection.endLineNumber;
				updateSearchScope = isSelectionMultipleLine;
				break;

			default:
				break;
		}

		opts.updateSearchScope = updateSearchScope;

		await super._start(opts);

		if (this._widget) {
			if (opts.shouldFocus === FindStartFocusAction.FocusReplaceInput) {
				this._widget.focusReplaceInput();
			} else if (opts.shouldFocus === FindStartFocusAction.FocusFindInput) {
				this._widget.focusFindInput();
			}
		}
	}

	public highlightFindOptions(ignoreWhenVisible: boolean = false): void {
		if (!this._widget) {
			this._createFindWidget();
		}
		if (this._state.isRevealed && !ignoreWhenVisible) {
			this._widget!.highlightFindOptions();
		} else {
			this._findOptionsWidget!.highlightFindOptions();
		}
	}

	private _createFindWidget() {
		this._widget = this._register(new FindWidget(this._editor, this, this._state, this._contextViewService, this._keybindingService, this._contextKeyService, this._themeService, this._storageService, this._notificationService));
		this._findOptionsWidget = this._register(new FindOptionsWidget(this._editor, this._state, this._keybindingService, this._themeService));
	}

	saveViewState(): any {
		return this._widget?.getViewState();
	}

	restoreViewState(state: any): void {
		this._widget?.setViewState(state);
	}
}

export class StartFindAction extends MultiEditorAction {

	constructor() {
		super({
			id: FIND_IDS.StartFindAction,
			label: nls.localize('startFindAction', "Find"),
			alias: 'Find',
			precondition: ContextKeyExpr.or(ContextKeyExpr.has('editorFocus'), ContextKeyExpr.has('editorIsOpen')),
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MenuId.MenubarEditMenu,
				group: '3_find',
				title: nls.localize({ key: 'miFind', comment: ['&& denotes a mnemonic'] }, "&&Find"),
				order: 1
			}
		});
	}

	public async run(accessor: ServicesAccessor | null, editor: ICodeEditor): Promise<void> {
		let controller = CommonFindController.get(editor);
		if (controller) {
			await controller.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: editor.getOption(EditorOption.find).seedSearchStringFromSelection ? 'single' : 'none',
				seedSearchStringFromGlobalClipboard: editor.getOption(EditorOption.find).globalFindClipboard,
				shouldFocus: FindStartFocusAction.FocusFindInput,
				shouldAnimate: true,
				updateSearchScope: false,
				loop: editor.getOption(EditorOption.find).loop
			});
		}
	}
}

export class StartFindWithSelectionAction extends EditorAction {

	constructor() {
		super({
			id: FIND_IDS.StartFindWithSelection,
			label: nls.localize('startFindWithSelectionAction', "Find With Selection"),
			alias: 'Find With Selection',
			precondition: undefined,
			kbOpts: {
				kbExpr: null,
				primary: 0,
				mac: {
					primary: KeyMod.CtrlCmd | KeyCode.KEY_E,
				},
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public async run(accessor: ServicesAccessor | null, editor: ICodeEditor): Promise<void> {
		let controller = CommonFindController.get(editor);
		if (controller) {
			await controller.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'multiple',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: true,
				updateSearchScope: false,
				loop: editor.getOption(EditorOption.find).loop
			});

			controller.setGlobalBufferTerm(controller.getState().searchString);
		}
	}
}
export abstract class MatchFindAction extends EditorAction {
	public async run(accessor: ServicesAccessor | null, editor: ICodeEditor): Promise<void> {
		let controller = CommonFindController.get(editor);
		if (controller && !this._run(controller)) {
			await controller.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: (controller.getState().searchString.length === 0) && editor.getOption(EditorOption.find).seedSearchStringFromSelection ? 'single' : 'none',
				seedSearchStringFromGlobalClipboard: true,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: true,
				updateSearchScope: false,
				loop: editor.getOption(EditorOption.find).loop
			});
			this._run(controller);
		}
	}

	protected abstract _run(controller: CommonFindController): boolean;
}

export class NextMatchFindAction extends MatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.NextMatchFindAction,
			label: nls.localize('findNextMatchAction', "Find Next"),
			alias: 'Find Next',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_G, secondary: [KeyCode.F3] },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _run(controller: CommonFindController): boolean {
		const result = controller.moveToNextMatch();
		if (result) {
			controller.editor.pushUndoStop();
			return true;
		}

		return false;
	}
}

export class NextMatchFindAction2 extends MatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.NextMatchFindAction,
			label: nls.localize('findNextMatchAction', "Find Next"),
			alias: 'Find Next',
			precondition: undefined,
			kbOpts: {
				kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_FIND_INPUT_FOCUSED),
				primary: KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _run(controller: CommonFindController): boolean {
		const result = controller.moveToNextMatch();
		if (result) {
			controller.editor.pushUndoStop();
			return true;
		}

		return false;
	}
}

export class PreviousMatchFindAction extends MatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.PreviousMatchFindAction,
			label: nls.localize('findPreviousMatchAction', "Find Previous"),
			alias: 'Find Previous',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.Shift | KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_G, secondary: [KeyMod.Shift | KeyCode.F3] },
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _run(controller: CommonFindController): boolean {
		return controller.moveToPrevMatch();
	}
}

export class PreviousMatchFindAction2 extends MatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.PreviousMatchFindAction,
			label: nls.localize('findPreviousMatchAction', "Find Previous"),
			alias: 'Find Previous',
			precondition: undefined,
			kbOpts: {
				kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_FIND_INPUT_FOCUSED),
				primary: KeyMod.Shift | KeyCode.Enter,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _run(controller: CommonFindController): boolean {
		return controller.moveToPrevMatch();
	}
}

export abstract class SelectionMatchFindAction extends EditorAction {
	public async run(accessor: ServicesAccessor | null, editor: ICodeEditor): Promise<void> {
		let controller = CommonFindController.get(editor);
		if (!controller) {
			return;
		}
		let selectionSearchString = getSelectionSearchString(editor);
		if (selectionSearchString) {
			controller.setSearchString(selectionSearchString);
		}
		if (!this._run(controller)) {
			await controller.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: editor.getOption(EditorOption.find).seedSearchStringFromSelection ? 'single' : 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: true,
				updateSearchScope: false,
				loop: editor.getOption(EditorOption.find).loop
			});
			this._run(controller);
		}
	}

	protected abstract _run(controller: CommonFindController): boolean;
}

export class NextSelectionMatchFindAction extends SelectionMatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.NextSelectionMatchFindAction,
			label: nls.localize('nextSelectionMatchFindAction', "Find Next Selection"),
			alias: 'Find Next Selection',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.CtrlCmd | KeyCode.F3,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _run(controller: CommonFindController): boolean {
		return controller.moveToNextMatch();
	}
}

export class PreviousSelectionMatchFindAction extends SelectionMatchFindAction {

	constructor() {
		super({
			id: FIND_IDS.PreviousSelectionMatchFindAction,
			label: nls.localize('previousSelectionMatchFindAction', "Find Previous Selection"),
			alias: 'Find Previous Selection',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.focus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.F3,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	protected _run(controller: CommonFindController): boolean {
		return controller.moveToPrevMatch();
	}
}

export class StartFindReplaceAction extends MultiEditorAction {

	constructor() {
		super({
			id: FIND_IDS.StartFindReplaceAction,
			label: nls.localize('startReplace', "Replace"),
			alias: 'Replace',
			precondition: ContextKeyExpr.or(ContextKeyExpr.has('editorFocus'), ContextKeyExpr.has('editorIsOpen')),
			kbOpts: {
				kbExpr: null,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_H,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_F },
				weight: KeybindingWeight.EditorContrib
			},
			menuOpts: {
				menuId: MenuId.MenubarEditMenu,
				group: '3_find',
				title: nls.localize({ key: 'miReplace', comment: ['&& denotes a mnemonic'] }, "&&Replace"),
				order: 2
			}
		});
	}

	public async run(accessor: ServicesAccessor | null, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel() || editor.getOption(EditorOption.readOnly)) {
			return;
		}

		let controller = CommonFindController.get(editor);
		let currentSelection = editor.getSelection();
		let findInputFocused = controller.isFindInputFocused();
		// we only seed search string from selection when the current selection is single line and not empty,
		// + the find input is not focused
		let seedSearchStringFromSelection = !currentSelection.isEmpty()
			&& currentSelection.startLineNumber === currentSelection.endLineNumber && editor.getOption(EditorOption.find).seedSearchStringFromSelection
			&& !findInputFocused;
		/*
		 * if the existing search string in find widget is empty and we don't seed search string from selection, it means the Find Input is still empty, so we should focus the Find Input instead of Replace Input.

		 * findInputFocused true -> seedSearchStringFromSelection false, FocusReplaceInput
		 * findInputFocused false, seedSearchStringFromSelection true FocusReplaceInput
		 * findInputFocused false seedSearchStringFromSelection false FocusFindInput
		 */
		let shouldFocus = (findInputFocused || seedSearchStringFromSelection) ?
			FindStartFocusAction.FocusReplaceInput : FindStartFocusAction.FocusFindInput;


		if (controller) {
			await controller.start({
				forceRevealReplace: true,
				seedSearchStringFromSelection: seedSearchStringFromSelection ? 'single' : 'none',
				seedSearchStringFromGlobalClipboard: editor.getOption(EditorOption.find).seedSearchStringFromSelection,
				shouldFocus: shouldFocus,
				shouldAnimate: true,
				updateSearchScope: false,
				loop: editor.getOption(EditorOption.find).loop
			});
		}
	}
}

registerEditorContribution(CommonFindController.ID, FindController);

export const EditorStartFindAction = new StartFindAction();
registerMultiEditorAction(EditorStartFindAction);
registerEditorAction(StartFindWithSelectionAction);
registerEditorAction(NextMatchFindAction);
registerEditorAction(NextMatchFindAction2);
registerEditorAction(PreviousMatchFindAction);
registerEditorAction(PreviousMatchFindAction2);
registerEditorAction(NextSelectionMatchFindAction);
registerEditorAction(PreviousSelectionMatchFindAction);
export const EditorStartFindReplaceAction = new StartFindReplaceAction();
registerMultiEditorAction(EditorStartFindReplaceAction);

const FindCommand = EditorCommand.bindToContribution<CommonFindController>(CommonFindController.get);

registerEditorCommand(new FindCommand({
	id: FIND_IDS.CloseFindWidgetCommand,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.closeFindWidget(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, ContextKeyExpr.not('isComposing')),
		primary: KeyCode.Escape,
		secondary: [KeyMod.Shift | KeyCode.Escape]
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleCaseSensitiveCommand,
	precondition: undefined,
	handler: x => x.toggleCaseSensitive(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: ToggleCaseSensitiveKeybinding.primary,
		mac: ToggleCaseSensitiveKeybinding.mac,
		win: ToggleCaseSensitiveKeybinding.win,
		linux: ToggleCaseSensitiveKeybinding.linux
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleWholeWordCommand,
	precondition: undefined,
	handler: x => x.toggleWholeWords(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: ToggleWholeWordKeybinding.primary,
		mac: ToggleWholeWordKeybinding.mac,
		win: ToggleWholeWordKeybinding.win,
		linux: ToggleWholeWordKeybinding.linux
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleRegexCommand,
	precondition: undefined,
	handler: x => x.toggleRegex(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: ToggleRegexKeybinding.primary,
		mac: ToggleRegexKeybinding.mac,
		win: ToggleRegexKeybinding.win,
		linux: ToggleRegexKeybinding.linux
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ToggleSearchScopeCommand,
	precondition: undefined,
	handler: x => x.toggleSearchScope(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: ToggleSearchScopeKeybinding.primary,
		mac: ToggleSearchScopeKeybinding.mac,
		win: ToggleSearchScopeKeybinding.win,
		linux: ToggleSearchScopeKeybinding.linux
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.TogglePreserveCaseCommand,
	precondition: undefined,
	handler: x => x.togglePreserveCase(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: TogglePreserveCaseKeybinding.primary,
		mac: TogglePreserveCaseKeybinding.mac,
		win: TogglePreserveCaseKeybinding.win,
		linux: TogglePreserveCaseKeybinding.linux
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ReplaceOneAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.replace(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_1
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ReplaceOneAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.replace(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_REPLACE_INPUT_FOCUSED),
		primary: KeyCode.Enter
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ReplaceAllAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.replaceAll(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.ReplaceAllAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.replaceAll(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: ContextKeyExpr.and(EditorContextKeys.focus, CONTEXT_REPLACE_INPUT_FOCUSED),
		primary: undefined,
		mac: {
			primary: KeyMod.CtrlCmd | KeyCode.Enter,
		}
	}
}));

registerEditorCommand(new FindCommand({
	id: FIND_IDS.SelectAllMatchesAction,
	precondition: CONTEXT_FIND_WIDGET_VISIBLE,
	handler: x => x.selectAllMatches(),
	kbOpts: {
		weight: KeybindingWeight.EditorContrib + 5,
		kbExpr: EditorContextKeys.focus,
		primary: KeyMod.Alt | KeyCode.Enter
	}
}));
