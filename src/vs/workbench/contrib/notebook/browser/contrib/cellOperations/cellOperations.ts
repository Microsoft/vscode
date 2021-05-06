/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { localize } from 'vs/nls';
import { MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContext } from 'vs/platform/contextkey/common/contextkeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { Range } from 'vs/editor/common/core/range';
import { CellOverflowToolbarGroups, CellToolbarOrder, CELL_TITLE_CELL_GROUP_ID, INotebookCellActionContext, NotebookCellAction } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { CellEditState, expandCellRangesWithHiddenCells, ICellViewModel, NOTEBOOK_CELL_EDITABLE, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_EDITOR_FOCUSED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import * as icons from 'vs/workbench/contrib/notebook/browser/notebookIcons';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { CellEditType, CellKind, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { cellRangeContains, cellRangesToIndexes, ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { cloneNotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellViewModel, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IBulkEditService, ResourceEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { ResourceNotebookCellEdit } from 'vs/workbench/contrib/bulkEdit/browser/bulkCellEdits';

const MOVE_CELL_UP_COMMAND_ID = 'notebook.cell.moveUp';
const MOVE_CELL_DOWN_COMMAND_ID = 'notebook.cell.moveDown';
const COPY_CELL_UP_COMMAND_ID = 'notebook.cell.copyUp';
const COPY_CELL_DOWN_COMMAND_ID = 'notebook.cell.copyDown';
const SPLIT_CELL_COMMAND_ID = 'notebook.cell.split';
const JOIN_CELL_ABOVE_COMMAND_ID = 'notebook.cell.joinAbove';
const JOIN_CELL_BELOW_COMMAND_ID = 'notebook.cell.joinBelow';

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: MOVE_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.moveCellUp', "Move Cell Up"),
				icon: icons.moveUpIcon,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.UpArrow,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext.toNegated()),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		return moveCellRange(context, 'up');
	}
});

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: MOVE_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.moveCellDown', "Move Cell Down"),
				icon: icons.moveDownIcon,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.DownArrow,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext.toNegated()),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		return moveCellRange(context, 'down');
	}
});

export async function moveCellRange(context: INotebookCellActionContext, direction: 'up' | 'down'): Promise<void> {
	const viewModel = context.notebookEditor.viewModel;
	if (!viewModel) {
		return;
	}

	if (viewModel.options.isReadOnly) {
		return;
	}

	const selections = context.notebookEditor.getSelections();
	const modelRanges = expandCellRangesWithHiddenCells(context.notebookEditor, context.notebookEditor.viewModel!, selections);
	const range = modelRanges[0];
	if (!range || range.start === range.end) {
		return;
	}

	if (direction === 'up') {
		if (range.start === 0) {
			return;
		}

		const indexAbove = range.start - 1;
		const finalSelection = { start: range.start - 1, end: range.end - 1 };
		const focus = context.notebookEditor.getFocus();
		const newFocus = cellRangeContains(range, focus) ? { start: focus.start - 1, end: focus.end - 1 } : { start: range.start - 1, end: range.start };
		viewModel.notebookDocument.applyEdits([
			{
				editType: CellEditType.Move,
				index: indexAbove,
				length: 1,
				newIdx: range.end - 1
			}],
			true,
			{
				kind: SelectionStateType.Index,
				focus: viewModel.getFocus(),
				selections: viewModel.getSelections()
			},
			() => ({ kind: SelectionStateType.Index, focus: newFocus, selections: [finalSelection] }),
			undefined
		);
		const focusRange = viewModel.getSelections()[0] ?? viewModel.getFocus();
		context.notebookEditor.revealCellRangeInView(focusRange);
	} else {
		if (range.end >= viewModel.length) {
			return;
		}

		const indexBelow = range.end;
		const finalSelection = { start: range.start + 1, end: range.end + 1 };
		const focus = context.notebookEditor.getFocus();
		const newFocus = cellRangeContains(range, focus) ? { start: focus.start + 1, end: focus.end + 1 } : { start: range.start + 1, end: range.start + 2 };

		viewModel.notebookDocument.applyEdits([
			{
				editType: CellEditType.Move,
				index: indexBelow,
				length: 1,
				newIdx: range.start
			}],
			true,
			{
				kind: SelectionStateType.Index,
				focus: viewModel.getFocus(),
				selections: viewModel.getSelections()
			},
			() => ({ kind: SelectionStateType.Index, focus: newFocus, selections: [finalSelection] }),
			undefined
		);

		const focusRange = viewModel.getSelections()[0] ?? viewModel.getFocus();
		context.notebookEditor.revealCellRangeInView(focusRange);
	}
}

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: COPY_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.copyCellUp', "Copy Cell Up"),
				keybinding: {
					primary: KeyMod.Alt | KeyMod.Shift | KeyCode.UpArrow,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext.toNegated()),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		return copyCellRange(context, 'up');
	}
});

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: COPY_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.copyCellDown', "Copy Cell Down"),
				keybinding: {
					primary: KeyMod.Alt | KeyMod.Shift | KeyCode.DownArrow,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext.toNegated()),
					weight: KeybindingWeight.WorkbenchContrib
				},
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_CELL_EDITABLE),
					group: CellOverflowToolbarGroups.Edit,
					order: 12
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		return copyCellRange(context, 'down');
	}
});

export async function copyCellRange(context: INotebookCellActionContext, direction: 'up' | 'down'): Promise<void> {
	const viewModel = context.notebookEditor.viewModel;
	if (!viewModel) {
		return;
	}

	if (viewModel.options.isReadOnly) {
		return;
	}

	let range: ICellRange | undefined = undefined;

	if (context.ui) {
		let targetCell = context.cell;
		const targetCellIndex = viewModel.getCellIndex(targetCell);
		range = { start: targetCellIndex, end: targetCellIndex + 1 };
	} else {
		const selections = context.notebookEditor.getSelections();
		const modelRanges = expandCellRangesWithHiddenCells(context.notebookEditor, context.notebookEditor.viewModel!, selections);
		range = modelRanges[0];
	}

	if (!range || range.start === range.end) {
		return;
	}

	if (direction === 'up') {
		// insert up, without changing focus and selections
		const focus = viewModel.getFocus();
		const selections = viewModel.getSelections();
		viewModel.notebookDocument.applyEdits([
			{
				editType: CellEditType.Replace,
				index: range.end,
				count: 0,
				cells: cellRangesToIndexes([range]).map(index => cloneNotebookCellTextModel(viewModel.cellAt(index)!.model))
			}],
			true,
			{
				kind: SelectionStateType.Index,
				focus: focus,
				selections: selections
			},
			() => ({ kind: SelectionStateType.Index, focus: focus, selections: selections }),
			undefined
		);
	} else {
		// insert down, move selections
		const focus = viewModel.getFocus();
		const selections = viewModel.getSelections();
		const newCells = cellRangesToIndexes([range]).map(index => cloneNotebookCellTextModel(viewModel.cellAt(index)!.model));
		const countDelta = newCells.length;
		const newFocus = context.ui ? focus : { start: focus.start + countDelta, end: focus.end + countDelta };
		const newSelections = context.ui ? selections : [{ start: range.start + countDelta, end: range.end + countDelta }];
		viewModel.notebookDocument.applyEdits([
			{
				editType: CellEditType.Replace,
				index: range.end,
				count: 0,
				cells: cellRangesToIndexes([range]).map(index => cloneNotebookCellTextModel(viewModel.cellAt(index)!.model))
			}],
			true,
			{
				kind: SelectionStateType.Index,
				focus: focus,
				selections: selections
			},
			() => ({ kind: SelectionStateType.Index, focus: newFocus, selections: newSelections }),
			undefined
		);

		const focusRange = viewModel.getSelections()[0] ?? viewModel.getFocus();
		context.notebookEditor.revealCellRangeInView(focusRange);
	}
}

export async function splitCell(context: INotebookCellActionContext): Promise<void> {
	const newCells = await context.notebookEditor.splitNotebookCell(context.cell);
	if (newCells) {
		context.notebookEditor.focusNotebookCell(newCells[newCells.length - 1], 'editor');
	}
}

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: SPLIT_CELL_COMMAND_ID,
				title: localize('notebookActions.splitCell', "Split Cell"),
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_CELL_EDITABLE),
					order: CellToolbarOrder.SplitCell,
					group: CELL_TITLE_CELL_GROUP_ID
				},
				icon: icons.splitCellIcon,
				keybinding: {
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_CELL_EDITABLE),
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_BACKSLASH),
					weight: KeybindingWeight.WorkbenchContrib
				},
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		return splitCell(context);
	}
});

export async function joinNotebookCells(viewModel: NotebookViewModel, range: ICellRange, direction: 'above' | 'below', constraint?: CellKind): Promise<{ edits: ResourceEdit[], cell: ICellViewModel, endFocus: ICellRange, endSelections: ICellRange[] } | null> {
	if (!viewModel || viewModel.options.isReadOnly) {
		return null;
	}

	const cells = viewModel.getCells(range);

	if (!cells.length) {
		return null;
	}

	if (range.start === 0 && direction === 'above') {
		return null;
	}

	if (range.end === viewModel.length && direction === 'below') {
		return null;
	}

	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];

		if (constraint && cell.cellKind !== constraint) {
			return null;
		}
	}

	if (direction === 'above') {
		const above = viewModel.cellAt(range.start - 1) as CellViewModel;
		if (constraint && above.cellKind !== constraint) {
			return null;
		}

		const insertContent = cells.map(cell => (cell.textBuffer.getEOL() ?? '') + cell.getText()).join('');
		const aboveCellLineCount = above.textBuffer.getLineCount();
		const aboveCellLastLineEndColumn = above.textBuffer.getLineLength(aboveCellLineCount);

		return {
			edits: [
				new ResourceTextEdit(above.uri, { range: new Range(aboveCellLineCount, aboveCellLastLineEndColumn + 1, aboveCellLineCount, aboveCellLastLineEndColumn + 1), text: insertContent }),
				new ResourceNotebookCellEdit(viewModel.notebookDocument.uri,
					{
						editType: CellEditType.Replace,
						index: range.start,
						count: range.end - range.start,
						cells: []
					}
				)
			],
			cell: above,
			endFocus: { start: range.start - 1, end: range.start },
			endSelections: [{ start: range.start - 1, end: range.start }]
		};
	} else {
		const below = viewModel.cellAt(range.end) as CellViewModel;
		if (constraint && below.cellKind !== constraint) {
			return null;
		}

		const cell = cells[0];
		const restCells = [...cells.slice(1), below];
		const insertContent = restCells.map(cl => (cl.textBuffer.getEOL() ?? '') + cl.getText()).join('');

		const cellLineCount = cell.textBuffer.getLineCount();
		const cellLastLineEndColumn = cell.textBuffer.getLineLength(cellLineCount);

		return {
			edits: [
				new ResourceTextEdit(cell.uri, { range: new Range(cellLineCount, cellLastLineEndColumn + 1, cellLineCount, cellLastLineEndColumn + 1), text: insertContent }),
				new ResourceNotebookCellEdit(viewModel.notebookDocument.uri,
					{
						editType: CellEditType.Replace,
						index: range.start + 1,
						count: range.end - range.start,
						cells: []
					}
				)
			],
			cell,
			endFocus: { start: range.start, end: range.start + 1 },
			endSelections: [{ start: range.start, end: range.start + 1 }]
		};
	}
}

export async function joinCellsWithSurrounds(bulkEditService: IBulkEditService, context: INotebookCellActionContext, direction: 'above' | 'below'): Promise<void> {
	const viewModel = context.notebookEditor.viewModel;
	let ret: {
		edits: ResourceEdit[];
		cell: ICellViewModel;
		endFocus: ICellRange;
		endSelections: ICellRange[];
	} | null = null;

	if (context.ui) {
		const cellIndex = viewModel.getCellIndex(context.cell);
		ret = await joinNotebookCells(viewModel, { start: cellIndex, end: cellIndex + 1 }, direction);
		if (!ret) {
			return;
		}

		await bulkEditService.apply(
			ret?.edits,
			{ quotableLabel: 'Join Notebook Cells' }
		);
		viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: ret.endFocus, selections: ret.endSelections });
		ret.cell.updateEditState(CellEditState.Editing, 'joinCellsWithSurrounds');
		context.notebookEditor.revealCellRangeInView(viewModel.getFocus());
	} else {
		const selections = viewModel.getSelections();
		if (!selections.length) {
			return;
		}

		const focus = viewModel.getFocus();
		let edits: ResourceEdit[] = [];
		let cell: ICellViewModel | null = null;
		let cells: ICellViewModel[] = [];

		for (let i = selections.length - 1; i >= 0; i--) {
			const selection = selections[i];
			const containFocus = cellRangeContains(selection, focus);

			if (
				selection.end >= viewModel.length && direction === 'below'
				|| selection.start === 0 && direction === 'above'
			) {
				if (containFocus) {
					cell = viewModel.cellAt(focus.start)!;
				}

				cells.push(...viewModel.getCells(selection));
				continue;
			}

			const singleRet = await joinNotebookCells(viewModel, selection, direction);

			if (!singleRet) {
				return;
			}

			edits.push(...singleRet.edits);
			cells.push(singleRet.cell);

			if (containFocus) {
				cell = singleRet.cell;
			}
		}

		if (!edits.length) {
			return;
		}

		if (!cell || !cells.length) {
			return;
		}

		await bulkEditService.apply(
			edits,
			{ quotableLabel: 'Join Notebook Cells' }
		);

		cells.forEach(cell => {
			cell.updateEditState(CellEditState.Editing, 'joinCellsWithSurrounds');
		});

		viewModel.updateSelectionsState({ kind: SelectionStateType.Handle, primary: cell.handle, selections: cells.map(cell => cell.handle) });
		context.notebookEditor.revealCellRangeInView(viewModel.getFocus());
	}
}

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: JOIN_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.joinCellAbove', "Join With Previous Cell"),
				keybinding: {
					when: NOTEBOOK_EDITOR_FOCUSED,
					primary: KeyMod.WinCtrl | KeyMod.Alt | KeyMod.Shift | KeyCode.KEY_J,
					weight: KeybindingWeight.WorkbenchContrib
				},
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE),
					group: CellOverflowToolbarGroups.Edit,
					order: 10
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		const bulkEditService = accessor.get(IBulkEditService);
		return joinCellsWithSurrounds(bulkEditService, context, 'above');
	}
});

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: JOIN_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.joinCellBelow', "Join With Next Cell"),
				keybinding: {
					when: NOTEBOOK_EDITOR_FOCUSED,
					primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.KEY_J,
					weight: KeybindingWeight.WorkbenchContrib
				},
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE),
					group: CellOverflowToolbarGroups.Edit,
					order: 11
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		const bulkEditService = accessor.get(IBulkEditService);
		return joinCellsWithSurrounds(bulkEditService, context, 'below');
	}
});
