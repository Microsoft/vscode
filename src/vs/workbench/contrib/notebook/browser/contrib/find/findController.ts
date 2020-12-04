/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/notebookFind';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED, INotebookEditor, CellFindMatch, CellEditState, INotebookEditorContribution, NOTEBOOK_EDITOR_FOCUSED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { FindDecorations } from 'vs/editor/contrib/find/findDecorations';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { IModelDeltaDecoration } from 'vs/editor/common/model';
import { ICellModelDeltaDecorations, ICellModelDecorations } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { SimpleFindReplaceWidget } from 'vs/workbench/contrib/codeEditor/browser/find/simpleFindReplaceWidget';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import * as DOM from 'vs/base/browser/dom';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { getActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import { INotebookSearchOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EditorStartFindAction, EditorStartFindReplaceAction } from 'vs/editor/contrib/find/findController';

const FIND_HIDE_TRANSITION = 'find-hide-transition';
const FIND_SHOW_TRANSITION = 'find-show-transition';


export class NotebookFindWidget extends SimpleFindReplaceWidget implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.find';
	protected _findWidgetFocused: IContextKey<boolean>;
	private _findMatches: CellFindMatch[] = [];
	protected _findMatchesStarts: PrefixSumComputer | null = null;
	private _currentMatch: number = -1;
	private _allMatchesDecorations: ICellModelDecorations[] = [];
	private _currentMatchDecorations: ICellModelDecorations[] = [];
	private _showTimeout: number | null = null;
	private _hideTimeout: number | null = null;
	private _previousFocusElement?: HTMLElement;

	constructor(
		private readonly _notebookEditor: INotebookEditor,
		@IContextViewService contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService private readonly _configurationService: IConfigurationService

	) {
		super(contextViewService, contextKeyService, themeService, new FindReplaceState(), true);
		DOM.append(this._notebookEditor.getDomNode(), this.getDomNode());

		this._findWidgetFocused = KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED.bindTo(contextKeyService);
		this._register(this._findInput.onKeyDown((e) => this._onFindInputKeyDown(e)));
		this.updateTheme(themeService.getColorTheme());
		this._register(themeService.onDidColorThemeChange(() => {
			this.updateTheme(themeService.getColorTheme());
		}));

		this._register(this._state.onFindReplaceStateChange(() => {
			this.onInputChanged();
		}));

		this._register(DOM.addDisposableListener(this.getDomNode(), DOM.EventType.FOCUS, e => {
			this._previousFocusElement = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : undefined;
		}, true));
	}

	private _onFindInputKeyDown(e: IKeyboardEvent): void {
		if (e.equals(KeyCode.Enter)) {
			if (this._findMatches.length) {
				this.find(false);
			} else {
				this.set(null, true);
			}
			e.preventDefault();
			return;
		} else if (e.equals(KeyMod.Shift | KeyCode.Enter)) {
			if (this._findMatches.length) {
				this.find(true);
			} else {
				this.set(null, true);
			}
			e.preventDefault();
			return;
		}
	}

	protected onInputChanged(): boolean {
		const val = this.inputValue;
		const wordSeparators = this._configurationService.inspect<string>('editor.wordSeparators').value;
		const options: INotebookSearchOptions = { regex: this._getRegexValue(), wholeWord: this._getWholeWordValue(), caseSensitive: this._getCaseSensitiveValue(), wordSeparators: wordSeparators };
		if (val) {
			this._findMatches = this._notebookEditor.viewModel!.find(val, options).filter(match => match.matches.length > 0);
			this.set(this._findMatches, false);
			if (this._findMatches.length) {
				return true;
			} else {
				return false;
			}
		} else {
			this.set([], false);
		}

		return false;
	}

	protected find(previous: boolean): void {
		if (!this._findMatches.length) {
			return;
		}

		if (!this._findMatchesStarts) {
			this.set(this._findMatches, true);
		} else {
			const totalVal = this._findMatchesStarts.getTotalValue();
			const nextVal = (this._currentMatch + (previous ? -1 : 1) + totalVal) % totalVal;
			this._currentMatch = nextVal;
		}


		const nextIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
		this.setCurrentFindMatchDecoration(nextIndex.index, nextIndex.remainder);
		this.revealCellRange(nextIndex.index, nextIndex.remainder);
	}

	protected replaceOne() {
		if (!this._findMatches.length) {
			return;
		}

		if (!this._findMatchesStarts) {
			this.set(this._findMatches, true);
		}

		const nextIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
		const cell = this._findMatches[nextIndex.index].cell;
		const match = this._findMatches[nextIndex.index].matches[nextIndex.remainder];

		this._progressBar.infinite().show();

		this._notebookEditor.viewModel!.replaceOne(cell, match.range, this.replaceValue).then(() => {
			this._progressBar.stop();
		});
	}

	protected replaceAll() {
		this._progressBar.infinite().show();

		this._notebookEditor.viewModel!.replaceAll(this._findMatches, this.replaceValue).then(() => {
			this._progressBar.stop();
		});
	}

	private revealCellRange(cellIndex: number, matchIndex: number) {
		this._findMatches[cellIndex].cell.editState = CellEditState.Editing;
		this._notebookEditor.selectElement(this._findMatches[cellIndex].cell);
		this._notebookEditor.setCellSelection(this._findMatches[cellIndex].cell, this._findMatches[cellIndex].matches[matchIndex].range);
		this._notebookEditor.revealRangeInCenterIfOutsideViewportAsync(this._findMatches[cellIndex].cell, this._findMatches[cellIndex].matches[matchIndex].range);
	}

	protected findFirst(): void { }

	protected onFocusTrackerFocus() {
		this._findWidgetFocused.set(true);
	}

	protected onFocusTrackerBlur() {
		this._previousFocusElement = undefined;
		this._findWidgetFocused.reset();
	}

	protected onReplaceInputFocusTrackerFocus(): void {
		// throw new Error('Method not implemented.');
	}
	protected onReplaceInputFocusTrackerBlur(): void {
		// throw new Error('Method not implemented.');
	}

	protected onFindInputFocusTrackerFocus(): void { }
	protected onFindInputFocusTrackerBlur(): void { }

	private constructFindMatchesStarts() {
		if (this._findMatches && this._findMatches.length) {
			const values = new Uint32Array(this._findMatches.length);
			for (let i = 0; i < this._findMatches.length; i++) {
				values[i] = this._findMatches[i].matches.length;
			}

			this._findMatchesStarts = new PrefixSumComputer(values);
		} else {
			this._findMatchesStarts = null;
		}
	}

	private set(cellFindMatches: CellFindMatch[] | null, autoStart: boolean): void {
		if (!cellFindMatches || !cellFindMatches.length) {
			this._findMatches = [];
			this.setAllFindMatchesDecorations([]);

			this.constructFindMatchesStarts();
			this._currentMatch = -1;
			this.clearCurrentFindMatchDecoration();
			return;
		}

		// all matches
		this._findMatches = cellFindMatches;
		this.setAllFindMatchesDecorations(cellFindMatches || []);

		// current match
		this.constructFindMatchesStarts();

		if (autoStart) {
			this._currentMatch = 0;
			this.setCurrentFindMatchDecoration(0, 0);
		}
	}

	private setCurrentFindMatchDecoration(cellIndex: number, matchIndex: number) {
		this._notebookEditor.changeModelDecorations(accessor => {
			const findMatchesOptions: ModelDecorationOptions = FindDecorations._CURRENT_FIND_MATCH_DECORATION;

			const cell = this._findMatches[cellIndex].cell;
			const match = this._findMatches[cellIndex].matches[matchIndex];
			const decorations: IModelDeltaDecoration[] = [
				{ range: match.range, options: findMatchesOptions }
			];
			const deltaDecoration: ICellModelDeltaDecorations = {
				ownerId: cell.handle,
				decorations: decorations
			};

			this._currentMatchDecorations = accessor.deltaDecorations(this._currentMatchDecorations, [deltaDecoration]);
		});
	}

	private clearCurrentFindMatchDecoration() {
		this._notebookEditor.changeModelDecorations(accessor => {
			this._currentMatchDecorations = accessor.deltaDecorations(this._currentMatchDecorations, []);
		});
	}

	private setAllFindMatchesDecorations(cellFindMatches: CellFindMatch[]) {
		this._notebookEditor.changeModelDecorations((accessor) => {

			const findMatchesOptions: ModelDecorationOptions = FindDecorations._FIND_MATCH_DECORATION;

			const deltaDecorations: ICellModelDeltaDecorations[] = cellFindMatches.map(cellFindMatch => {
				const findMatches = cellFindMatch.matches;

				// Find matches
				const newFindMatchesDecorations: IModelDeltaDecoration[] = new Array<IModelDeltaDecoration>(findMatches.length);
				for (let i = 0, len = findMatches.length; i < len; i++) {
					newFindMatchesDecorations[i] = {
						range: findMatches[i].range,
						options: findMatchesOptions
					};
				}

				return { ownerId: cellFindMatch.cell.handle, decorations: newFindMatchesDecorations };
			});

			this._allMatchesDecorations = accessor.deltaDecorations(this._allMatchesDecorations, deltaDecorations);
		});
	}

	show(initialInput?: string): void {
		super.show(initialInput);
		this._findInput.select();

		if (this._showTimeout === null) {
			if (this._hideTimeout !== null) {
				window.clearTimeout(this._hideTimeout);
				this._hideTimeout = null;
				this._notebookEditor.removeClassName(FIND_HIDE_TRANSITION);
			}

			this._notebookEditor.addClassName(FIND_SHOW_TRANSITION);
			this._showTimeout = window.setTimeout(() => {
				this._notebookEditor.removeClassName(FIND_SHOW_TRANSITION);
				this._showTimeout = null;
			}, 200);
		} else {
			// no op
		}
	}

	replace(initialFindInput?: string, initialReplaceInput?: string) {
		super.showWithReplace(initialFindInput, initialReplaceInput);
		this._replaceInput.select();

		if (this._showTimeout === null) {
			if (this._hideTimeout !== null) {
				window.clearTimeout(this._hideTimeout);
				this._hideTimeout = null;
				this._notebookEditor.removeClassName(FIND_HIDE_TRANSITION);
			}

			this._notebookEditor.addClassName(FIND_SHOW_TRANSITION);
			this._showTimeout = window.setTimeout(() => {
				this._notebookEditor.removeClassName(FIND_SHOW_TRANSITION);
				this._showTimeout = null;
			}, 200);
		} else {
			// no op
		}
	}

	hide() {
		super.hide();
		this.set([], false);

		if (this._hideTimeout === null) {
			if (this._showTimeout !== null) {
				window.clearTimeout(this._showTimeout);
				this._showTimeout = null;
				this._notebookEditor.removeClassName(FIND_SHOW_TRANSITION);
			}
			this._notebookEditor.addClassName(FIND_HIDE_TRANSITION);
			this._hideTimeout = window.setTimeout(() => {
				this._notebookEditor.removeClassName(FIND_HIDE_TRANSITION);
			}, 200);
		} else {
			// no op
		}

		if (this._previousFocusElement && this._previousFocusElement.offsetParent) {
			this._previousFocusElement.focus();
			this._previousFocusElement = undefined;
		}
	}

	clear() {
		this._currentMatch = -1;
		this._findMatches = [];
	}

	dispose() {
		this._notebookEditor?.removeClassName(FIND_SHOW_TRANSITION);
		this._notebookEditor?.removeClassName(FIND_HIDE_TRANSITION);
		super.dispose();
	}

}

registerNotebookContribution(NotebookFindWidget.id, NotebookFindWidget);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.hideFind',
			title: { value: localize('notebookActions.hideFind', "Hide Find in Notebook"), original: 'Hide Find in Notebook' },
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editor = getActiveNotebookEditor(editorService);

		if (!editor) {
			return;
		}

		const controller = editor.getContribution<NotebookFindWidget>(NotebookFindWidget.id);
		controller.hide();
		editor.focus();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.find',
			title: { value: localize('notebookActions.findInNotebook', "Find in Notebook"), original: 'Find in Notebook' },
			keybinding: {
				when: NOTEBOOK_EDITOR_FOCUSED,
				primary: KeyCode.KEY_F | KeyMod.CtrlCmd,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editor = getActiveNotebookEditor(editorService);

		if (!editor) {
			return;
		}

		const controller = editor.getContribution<NotebookFindWidget>(NotebookFindWidget.id);
		controller.show();
	}
});

EditorStartFindAction.addImplementation(100, (accessor: ServicesAccessor, args: any) => {
	const editorService = accessor.get(IEditorService);
	const editor = getActiveNotebookEditor(editorService);

	if (!editor) {
		return false;
	}

	const controller = editor.getContribution<NotebookFindWidget>(NotebookFindWidget.id);
	controller.show();
	return true;
});

EditorStartFindReplaceAction.addImplementation(100, (accessor: ServicesAccessor, args: any) => {
	const editorService = accessor.get(IEditorService);
	const editor = getActiveNotebookEditor(editorService);

	if (!editor) {
		return false;
	}

	const controller = editor.getContribution<NotebookFindWidget>(NotebookFindWidget.id);
	controller.replace();
	return true;
});
