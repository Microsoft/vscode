/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { INotebookEditor, INotebookEditorMouseEvent, INotebookEditorContribution, NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_IS_ACTIVE_EDITOR, getNotebookEditorFromEditorPane } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellFoldingState, FoldingModel } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContextKey } from 'vs/platform/contextkey/common/contextkeys';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { NOTEBOOK_ACTIONS_CATEGORY } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { localize } from 'vs/nls';
import { FoldingRegion } from 'vs/editor/contrib/folding/foldingRanges';

export class FoldingController extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.findController';

	private _foldingModel: FoldingModel | null = null;
	private readonly _localStore = this._register(new DisposableStore());

	constructor(private readonly _notebookEditor: INotebookEditor) {
		super();

		this._register(this._notebookEditor.onMouseUp(e => { this.onMouseUp(e); }));

		this._register(this._notebookEditor.onDidChangeModel(() => {
			this._localStore.clear();

			if (!this._notebookEditor.viewModel) {
				return;
			}

			this._localStore.add(this._notebookEditor.viewModel.eventDispatcher.onDidChangeCellState(e => {
				if (e.source.editStateChanged && e.cell.cellKind === CellKind.Markdown) {
					this._foldingModel?.recompute();
					// this._updateEditorFoldingRanges();
				}
			}));

			this._foldingModel = new FoldingModel();
			this._localStore.add(this._foldingModel);
			this._foldingModel.attachViewModel(this._notebookEditor.viewModel);

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

	setFoldingStateDown(index: number, state: CellFoldingState, levels: number) {
		const doCollapse = state === CellFoldingState.Collapsed;
		let region = this._foldingModel!.getRegionAtLine(index + 1);
		let regions: FoldingRegion[] = [];
		if (region) {
			if (region.isCollapsed !== doCollapse) {
				regions.push(region);
			}
			if (levels > 1) {
				let regionsInside = this._foldingModel!.getRegionsInside(region, (r, level: number) => r.isCollapsed !== doCollapse && level < levels);
				regions.push(...regionsInside);
			}
		}

		regions.forEach(r => this._foldingModel!.setCollapsed(r.regionIndex, state === CellFoldingState.Collapsed));
		this._updateEditorFoldingRanges();
	}

	setFoldingStateUp(index: number, state: CellFoldingState, levels: number) {
		if (!this._foldingModel) {
			return;
		}

		let regions = this._foldingModel.getAllRegionsAtLine(index + 1, (region, level) => region.isCollapsed !== (state === CellFoldingState.Collapsed) && level <= levels);
		regions.forEach(r => this._foldingModel!.setCollapsed(r.regionIndex, state === CellFoldingState.Collapsed));
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

		if (target.classList.contains('codicon-notebook-collapsed') || target.classList.contains('codicon-notebook-expanded')) {
			const parent = target.parentElement as HTMLElement;

			if (!parent.classList.contains('notebook-folding-indicator')) {
				return;
			}

			// folding icon

			const cellViewModel = e.target;
			const modelIndex = viewModel.getCellIndex(cellViewModel);
			const state = viewModel.getFoldingState(modelIndex);

			if (state === CellFoldingState.None) {
				return;
			}

			this.setFoldingStateUp(modelIndex, state === CellFoldingState.Collapsed ? CellFoldingState.Expanded : CellFoldingState.Collapsed, 1);
			this._notebookEditor.focusElement(cellViewModel);
		}

		return;
	}
}

registerNotebookContribution(FoldingController.id, FoldingController);


const NOTEBOOK_FOLD_COMMAND_LABEL = localize('fold.cell', "Fold Cell");
const NOTEBOOK_UNFOLD_COMMAND_LABEL = localize('unfold.cell', "Unfold Cell");

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
			description: {
				description: NOTEBOOK_FOLD_COMMAND_LABEL,
				args: [
					{
						isOptional: true,
						name: 'index',
						description: 'The cell index',
						schema: {
							'type': 'object',
							'required': ['index', 'direction'],
							'properties': {
								'index': {
									'type': 'number'
								},
								'direction': {
									'type': 'string',
									'enum': ['up', 'down'],
									'default': 'down'
								},
								'levels': {
									'type': 'number',
									'default': 1
								},
							}
						}
					}
				]
			},
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, args?: { index: number, levels: number, direction: 'up' | 'down' }): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const editor = getNotebookEditorFromEditorPane(editorService.activeEditorPane);
		if (!editor) {
			return;
		}

		const levels = args && args.levels || 1;
		const direction = args && args.direction === 'up' ? 'up' : 'down';
		let index: number | undefined = undefined;

		if (args) {
			index = args.index;
		} else {
			const activeCell = editor.getActiveCell();
			if (!activeCell) {
				return;
			}
			index = editor.viewModel?.viewCells.indexOf(activeCell);
		}

		const controller = editor.getContribution<FoldingController>(FoldingController.id);
		if (index !== undefined) {
			const targetCell = editor.viewModel?.viewCells[index];
			if (targetCell?.cellKind === CellKind.Code && direction === 'down') {
				return;
			}

			if (direction === 'up') {
				controller.setFoldingStateUp(index, CellFoldingState.Collapsed, levels);
			} else {
				controller.setFoldingStateDown(index, CellFoldingState.Collapsed, levels);
			}

			const viewIndex = editor.viewModel!.getNearestVisibleCellIndexUpwards(index);
			editor.focusElement(editor.viewModel!.viewCells[viewIndex]);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.unfold',
			title: { value: NOTEBOOK_UNFOLD_COMMAND_LABEL, original: 'Unfold Cell' },
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
			description: {
				description: NOTEBOOK_UNFOLD_COMMAND_LABEL,
				args: [
					{
						isOptional: true,
						name: 'index',
						description: 'The cell index',
						schema: {
							'type': 'object',
							'required': ['index', 'direction'],
							'properties': {
								'index': {
									'type': 'number'
								},
								'direction': {
									'type': 'string',
									'enum': ['up', 'down'],
									'default': 'down'
								},
								'levels': {
									'type': 'number',
									'default': 1
								},
							}
						}
					}
				]
			},
			precondition: NOTEBOOK_IS_ACTIVE_EDITOR,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, args?: { index: number, levels: number, direction: 'up' | 'down' }): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const editor = getNotebookEditorFromEditorPane(editorService.activeEditorPane);
		if (!editor) {
			return;
		}

		const levels = args && args.levels || 1;
		const direction = args && args.direction === 'up' ? 'up' : 'down';
		let index: number | undefined = undefined;

		if (args) {
			index = args.index;
		} else {
			const activeCell = editor.getActiveCell();
			if (!activeCell) {
				return;
			}
			index = editor.viewModel?.viewCells.indexOf(activeCell);
		}

		const controller = editor.getContribution<FoldingController>(FoldingController.id);
		if (index !== undefined) {
			if (direction === 'up') {
				controller.setFoldingStateUp(index, CellFoldingState.Expanded, levels);
			} else {
				controller.setFoldingStateDown(index, CellFoldingState.Expanded, levels);
			}
		}
	}
});
