/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { INotebookEditor, INotebookEditorMouseEvent, ICellRange, INotebookEditorContribution, NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_IS_ACTIVE_EDITOR } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import * as DOM from 'vs/base/browser/dom';
import { CellFoldingState, FoldingModel } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContextKey } from 'vs/platform/contextkey/common/contextkeys';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { getActiveNotebookEditor, NOTEBOOK_ACTIONS_CATEGORY } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { localize } from 'vs/nls';

export class FoldingController extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.findController';

	private _foldingModel: FoldingModel | null = null;
	private _localStore: DisposableStore = new DisposableStore();
	constructor(
		private readonly _notebookEditor: INotebookEditor

	) {
		super();

		this._register(this._notebookEditor.onMouseUp(e => { this.onMouseUp(e); }));

		this._register(this._notebookEditor.onDidChangeModel(() => {
			this._localStore.clear();

			if (!this._notebookEditor.viewModel) {
				return;
			}

			this._localStore.add(this._notebookEditor.viewModel!.eventDispatcher.onDidChangeCellState(e => {
				if (e.source.editStateChanged && e.cell.cellKind === CellKind.Markdown) {
					this._foldingModel?.recompute();
					// this._updateEditorFoldingRanges();
				}
			}));

			this._foldingModel = new FoldingModel();
			this._localStore.add(this._foldingModel);
			this._foldingModel.attachViewModel(this._notebookEditor.viewModel!);

			this._localStore.add(this._foldingModel.onDidFoldingRegionChanged(() => {
				this._updateEditorFoldingRanges();
			}));
		}));
	}

	saveViewState(): ICellRange[] {
		return this._foldingModel?.getMemento() || [];
	}

	restoreViewState(state: ICellRange[] | undefined) {
		this._foldingModel?.applyMemento(state || []);
		this._updateEditorFoldingRanges();
	}

	setFoldingState(index: number, state: CellFoldingState) {
		if (!this._foldingModel) {
			return;
		}

		const range = this._foldingModel.regions.findRange(index + 1);
		const startIndex = this._foldingModel.regions.getStartLineNumber(range) - 1;

		if (startIndex !== index) {
			return;
		}

		this._foldingModel.setCollapsed(range, state === CellFoldingState.Collapsed);
		this._updateEditorFoldingRanges();
	}

	private _updateEditorFoldingRanges() {
		if (!this._foldingModel) {
			return;
		}

		this._notebookEditor.viewModel!.updateFoldingRanges(this._foldingModel.regions);
		const hiddenRanges = this._notebookEditor.viewModel!.getHiddenRanges();
		this._notebookEditor.setHiddenAreas(hiddenRanges);
	}

	onMouseUp(e: INotebookEditorMouseEvent) {
		if (!e.event.target) {
			return;
		}

		const viewModel = this._notebookEditor.viewModel;

		if (!viewModel) {
			return;
		}

		const target = e.event.target as HTMLElement;

		if (DOM.hasClass(target, 'codicon-chevron-down') || DOM.hasClass(target, 'codicon-chevron-right')) {
			const parent = target.parentElement as HTMLElement;

			if (!DOM.hasClass(parent, 'notebook-folding-indicator')) {
				return;
			}

			// folding icon

			const cellViewModel = e.target;
			const modelIndex = viewModel.getCellIndex(cellViewModel);
			const state = viewModel.getFoldingState(modelIndex);

			if (state === CellFoldingState.None) {
				return;
			}

			this.setFoldingState(modelIndex, state === CellFoldingState.Collapsed ? CellFoldingState.Expanded : CellFoldingState.Collapsed);
		}

		return;
	}
}

registerNotebookContribution(FoldingController.id, FoldingController);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.fold',
			title: { value: localize('fold.cell', "Fold Cell"), original: 'Fold Cell' },
			category: NOTEBOOK_ACTIONS_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_OPEN_SQUARE_BRACKET,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_OPEN_SQUARE_BRACKET,
					secondary: [KeyCode.LeftArrow],
				},
				secondary: [KeyCode.LeftArrow],
				weight: KeybindingWeight.WorkbenchContrib
			},
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const activeCell = editor.getActiveCell();
		if (!activeCell) {
			return;
		}

		const controller = editor.getContribution<FoldingController>(FoldingController.id);

		const index = editor.viewModel?.viewCells.indexOf(activeCell);

		if (index !== undefined) {
			controller.setFoldingState(index, CellFoldingState.Collapsed);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.unfold',
			title: { value: localize('unfold.cell', "Unfold Cell"), original: 'Unfold Cell' },
			category: NOTEBOOK_ACTIONS_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET,
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_CLOSE_SQUARE_BRACKET,
					secondary: [KeyCode.RightArrow],
				},
				secondary: [KeyCode.RightArrow],
				weight: KeybindingWeight.WorkbenchContrib
			},
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const activeCell = editor.getActiveCell();
		if (!activeCell) {
			return;
		}

		const controller = editor.getContribution<FoldingController>(FoldingController.id);

		const index = editor.viewModel?.viewCells.indexOf(activeCell);

		if (index !== undefined) {
			controller.setFoldingState(index, CellFoldingState.Expanded);
		}
	}
});
