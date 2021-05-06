/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { expandCellRangesWithHiddenCells, getNotebookEditorFromEditorPane, ICellViewModel, INotebookEditor, NOTEBOOK_CELL_EDITABLE, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_EDITOR_FOCUSED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CopyAction, CutAction, PasteAction } from 'vs/editor/contrib/clipboard/clipboard';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { CellViewModel, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { cloneNotebookCellTextModel, NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellEditType, ICellEditOperation, ISelectionState, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import * as platform from 'vs/base/common/platform';
import { MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { CellOverflowToolbarGroups, INotebookActionContext, INotebookCellActionContext, NotebookAction, NotebookCellAction, NOTEBOOK_EDITOR_WIDGET_ACTION_WEIGHT } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContextKey } from 'vs/platform/contextkey/common/contextkeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { RedoCommand, UndoCommand } from 'vs/editor/browser/editorExtensions';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';

function getFocusedWebviewDelegate(accessor: ServicesAccessor): Webview | undefined {
	const editorService = accessor.get(IEditorService);
	const editor = getNotebookEditorFromEditorPane(editorService.activeEditorPane);
	if (!editor?.hasFocus()) {
		return;
	}

	if (!editor?.hasWebviewFocus()) {
		return;
	}

	const webview = editor?.getInnerWebview();
	return webview;
}

function withWebview(accessor: ServicesAccessor, f: (webviewe: Webview) => void) {
	const webview = getFocusedWebviewDelegate(accessor);
	if (webview) {
		f(webview);
		return true;
	}
	return false;
}

const PRIORITY = 105;

UndoCommand.addImplementation(PRIORITY, 'notebook-webview', accessor => {
	return withWebview(accessor, webview => webview.undo());
});

RedoCommand.addImplementation(PRIORITY, 'notebook-webview', accessor => {
	return withWebview(accessor, webview => webview.redo());
});

CopyAction?.addImplementation(PRIORITY, 'notebook-webview', accessor => {
	return withWebview(accessor, webview => webview.copy());
});

PasteAction?.addImplementation(PRIORITY, 'notebook-webview', accessor => {
	return withWebview(accessor, webview => webview.paste());
});

CutAction?.addImplementation(PRIORITY, 'notebook-webview', accessor => {
	return withWebview(accessor, webview => webview.cut());
});


export function runPasteCells(editor: INotebookEditor, activeCell: ICellViewModel | undefined, pasteCells: {
	items: NotebookCellTextModel[];
	isCopy: boolean;
}): boolean {
	const viewModel = editor.viewModel;

	if (!viewModel || viewModel.options.isReadOnly) {
		return false;
	}

	const originalState: ISelectionState = {
		kind: SelectionStateType.Index,
		focus: viewModel.getFocus(),
		selections: viewModel.getSelections()
	};

	if (activeCell) {
		const currCellIndex = viewModel.getCellIndex(activeCell);
		const newFocusIndex = typeof currCellIndex === 'number' ? currCellIndex + 1 : 0;
		viewModel.notebookDocument.applyEdits([
			{
				editType: CellEditType.Replace,
				index: newFocusIndex,
				count: 0,
				cells: pasteCells.items.map(cell => cloneNotebookCellTextModel(cell))
			}
		], true, originalState, () => ({
			kind: SelectionStateType.Index,
			focus: { start: newFocusIndex, end: newFocusIndex + 1 },
			selections: [{ start: newFocusIndex, end: newFocusIndex + pasteCells.items.length }]
		}), undefined);
	} else {
		if (viewModel.length !== 0) {
			return false;
		}

		viewModel.notebookDocument.applyEdits([
			{
				editType: CellEditType.Replace,
				index: 0,
				count: 0,
				cells: pasteCells.items.map(cell => cloneNotebookCellTextModel(cell))
			}
		], true, originalState, () => ({
			kind: SelectionStateType.Index,
			focus: { start: 0, end: 1 },
			selections: [{ start: 1, end: pasteCells.items.length + 1 }]
		}), undefined);
	}

	return true;
}

function cellRangeToViewCells(viewModel: NotebookViewModel, ranges: ICellRange[]) {
	const cells: ICellViewModel[] = [];
	ranges.forEach(range => {
		cells.push(...viewModel.getCells(range));
	});

	return cells;
}
export function runCopyCells(accessor: ServicesAccessor, editor: INotebookEditor, targetCell: ICellViewModel | undefined): boolean {
	if (!editor.hasModel()) {
		return false;
	}

	if (editor.hasOutputTextSelection()) {
		document.execCommand('copy');
		return true;
	}

	const clipboardService = accessor.get<IClipboardService>(IClipboardService);
	const notebookService = accessor.get<INotebookService>(INotebookService);
	const viewModel = editor.viewModel;
	const selections = viewModel.getSelections();

	if (targetCell) {
		const targetCellIndex = viewModel.getCellIndex(targetCell);
		const containingSelection = selections.find(selection => selection.start <= targetCellIndex && targetCellIndex < selection.end);

		if (!containingSelection) {
			clipboardService.writeText(targetCell.getText());
			notebookService.setToCopy([targetCell.model], true);
			return true;
		}
	}

	const selectionRanges = expandCellRangesWithHiddenCells(editor, editor.viewModel, editor.viewModel.getSelections());
	const selectedCells = cellRangeToViewCells(editor.viewModel, selectionRanges);

	if (!selectedCells.length) {
		return false;
	}

	clipboardService.writeText(selectedCells.map(cell => cell.getText()).join('\n'));
	notebookService.setToCopy(selectedCells.map(cell => cell.model), true);

	return true;
}
export function runCutCells(accessor: ServicesAccessor, editor: INotebookEditor, targetCell: ICellViewModel | undefined): boolean {
	const viewModel = editor.viewModel;

	if (!viewModel || viewModel.options.isReadOnly) {
		return false;
	}

	const clipboardService = accessor.get<IClipboardService>(IClipboardService);
	const notebookService = accessor.get<INotebookService>(INotebookService);
	const selections = viewModel.getSelections();

	if (targetCell) {
		// from ui
		const targetCellIndex = viewModel.getCellIndex(targetCell);
		const containingSelection = selections.find(selection => selection.start <= targetCellIndex && targetCellIndex < selection.end);

		if (!containingSelection) {
			clipboardService.writeText(targetCell.getText());
			// delete cell
			const focus = viewModel.getFocus();
			const newFocus = focus.end <= targetCellIndex ? focus : { start: focus.start - 1, end: focus.end - 1 };
			const newSelections = selections.map(selection => (selection.end <= targetCellIndex ? selection : { start: selection.start - 1, end: selection.end - 1 }));

			viewModel.notebookDocument.applyEdits([
				{ editType: CellEditType.Replace, index: targetCellIndex, count: 1, cells: [] }
			], true, { kind: SelectionStateType.Index, focus: viewModel.getFocus(), selections: selections }, () => ({ kind: SelectionStateType.Index, focus: newFocus, selections: newSelections }), undefined, true);

			notebookService.setToCopy([targetCell.model], false);
			return true;
		}
	}

	const focus = viewModel.getFocus();
	const containingSelection = selections.find(selection => selection.start <= focus.start && focus.end <= selection.end);

	if (!containingSelection) {
		// focus is out of any selection, we should only cut this cell
		const targetCell = viewModel.cellAt(focus.start)!;
		clipboardService.writeText(targetCell.getText());
		const newFocus = focus.end === viewModel.length ? { start: focus.start - 1, end: focus.end - 1 } : focus;
		const newSelections = selections.map(selection => (selection.end <= focus.start ? selection : { start: selection.start - 1, end: selection.end - 1 }));
		viewModel.notebookDocument.applyEdits([
			{ editType: CellEditType.Replace, index: focus.start, count: 1, cells: [] }
		], true, { kind: SelectionStateType.Index, focus: viewModel.getFocus(), selections: selections }, () => ({ kind: SelectionStateType.Index, focus: newFocus, selections: newSelections }), undefined, true);

		notebookService.setToCopy([targetCell.model], false);
		return true;
	}

	const selectionRanges = expandCellRangesWithHiddenCells(editor, viewModel, viewModel.getSelections());
	const selectedCells = cellRangeToViewCells(viewModel, selectionRanges);

	if (!selectedCells.length) {
		return false;
	}

	clipboardService.writeText(selectedCells.map(cell => cell.getText()).join('\n'));
	const edits: ICellEditOperation[] = selectionRanges.map(range => ({ editType: CellEditType.Replace, index: range.start, count: range.end - range.start, cells: [] }));
	const firstSelectIndex = selectionRanges[0].start;

	/**
	 * If we have cells, 0, 1, 2, 3, 4, 5, 6
	 * and cells 1, 2 are selected, and then we delete cells 1 and 2
	 * the new focused cell should still be at index 1
	 */
	const newFocusedCellIndex = firstSelectIndex < viewModel.notebookDocument.cells.length - 1
		? firstSelectIndex
		: Math.max(viewModel.notebookDocument.cells.length - 2, 0);

	viewModel.notebookDocument.applyEdits(edits, true, { kind: SelectionStateType.Index, focus: viewModel.getFocus(), selections: selectionRanges }, () => {
		return {
			kind: SelectionStateType.Index,
			focus: { start: newFocusedCellIndex, end: newFocusedCellIndex + 1 },
			selections: [{ start: newFocusedCellIndex, end: newFocusedCellIndex + 1 }]
		};
	}, undefined, true);
	notebookService.setToCopy(selectedCells.map(cell => cell.model), false);

	return true;
}

export class NotebookClipboardContribution extends Disposable {

	constructor(@IEditorService private readonly _editorService: IEditorService) {
		super();

		const PRIORITY = 105;

		if (CopyAction) {
			this._register(CopyAction.addImplementation(PRIORITY, 'notebook-clipboard', accessor => {
				return this.runCopyAction(accessor);
			}));
		}

		if (PasteAction) {
			PasteAction.addImplementation(PRIORITY, 'notebook-clipboard', accessor => {
				return this.runPasteAction(accessor);
			});
		}

		if (CutAction) {
			CutAction.addImplementation(PRIORITY, 'notebook-clipboard', accessor => {
				return this.runCutAction(accessor);
			});
		}
	}

	private _getContext() {
		const editor = getNotebookEditorFromEditorPane(this._editorService.activeEditorPane);
		const activeCell = editor?.getActiveCell();

		return {
			editor,
			activeCell
		};
	}

	runCopyAction(accessor: ServicesAccessor) {
		const activeElement = <HTMLElement>document.activeElement;
		if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
			return false;
		}

		const { editor } = this._getContext();
		if (!editor) {
			return false;
		}

		return runCopyCells(accessor, editor, undefined);
	}

	runPasteAction(accessor: ServicesAccessor) {
		const activeElement = <HTMLElement>document.activeElement;
		if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
			return false;
		}

		const notebookService = accessor.get<INotebookService>(INotebookService);
		const pasteCells = notebookService.getToCopy();

		if (!pasteCells) {
			return false;
		}

		const { editor, activeCell } = this._getContext();
		if (!editor) {
			return false;
		}

		return runPasteCells(editor, activeCell, pasteCells);
	}

	runCutAction(accessor: ServicesAccessor) {
		const activeElement = <HTMLElement>document.activeElement;
		if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
			return false;
		}

		const { editor } = this._getContext();
		if (!editor) {
			return false;
		}

		return runCutCells(accessor, editor, undefined);
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookClipboardContribution, LifecyclePhase.Ready);

const COPY_CELL_COMMAND_ID = 'notebook.cell.copy';
const CUT_CELL_COMMAND_ID = 'notebook.cell.cut';
const PASTE_CELL_COMMAND_ID = 'notebook.cell.paste';
const PASTE_CELL_ABOVE_COMMAND_ID = 'notebook.cell.pasteAbove';

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: COPY_CELL_COMMAND_ID,
				title: localize('notebookActions.copy', "Copy Cell"),
				menu: {
					id: MenuId.NotebookCellTitle,
					when: NOTEBOOK_EDITOR_FOCUSED,
					group: CellOverflowToolbarGroups.Copy,
				},
				keybinding: platform.isNative ? undefined : {
					primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
					win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_C, secondary: [KeyMod.CtrlCmd | KeyCode.Insert] },
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		runCopyCells(accessor, context.notebookEditor, context.cell);
	}
});

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: CUT_CELL_COMMAND_ID,
				title: localize('notebookActions.cut', "Cut Cell"),
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_CELL_EDITABLE),
					group: CellOverflowToolbarGroups.Copy,
				},
				keybinding: platform.isNative ? undefined : {
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
					primary: KeyMod.CtrlCmd | KeyCode.KEY_X,
					win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_X, secondary: [KeyMod.Shift | KeyCode.Delete] },
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		runCutCells(accessor, context.notebookEditor, context.cell);
	}
});

registerAction2(class extends NotebookAction {
	constructor() {
		super(
			{
				id: PASTE_CELL_COMMAND_ID,
				title: localize('notebookActions.paste', "Paste Cell"),
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_EDITABLE),
					group: CellOverflowToolbarGroups.Copy,
				},
				keybinding: platform.isNative ? undefined : {
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
					primary: KeyMod.CtrlCmd | KeyCode.KEY_V,
					win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_V, secondary: [KeyMod.Shift | KeyCode.Insert] },
					linux: { primary: KeyMod.CtrlCmd | KeyCode.KEY_V, secondary: [KeyMod.Shift | KeyCode.Insert] },
					weight: KeybindingWeight.EditorContrib
				}
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookActionContext) {
		const notebookService = accessor.get<INotebookService>(INotebookService);
		const pasteCells = notebookService.getToCopy();

		const viewModel = context.notebookEditor.viewModel;

		if (!viewModel || viewModel.options.isReadOnly) {
			return;
		}

		if (!pasteCells) {
			return;
		}

		runPasteCells(context.notebookEditor, context.cell, pasteCells);
	}
});

registerAction2(class extends NotebookCellAction {
	constructor() {
		super(
			{
				id: PASTE_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.pasteAbove', "Paste Cell Above"),
				keybinding: {
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_V,
					weight: NOTEBOOK_EDITOR_WIDGET_ACTION_WEIGHT
				},
			});
	}

	async runWithContext(accessor: ServicesAccessor, context: INotebookCellActionContext) {
		const notebookService = accessor.get<INotebookService>(INotebookService);
		const pasteCells = notebookService.getToCopy();

		const viewModel = context.notebookEditor.viewModel;

		if (!viewModel || viewModel.options.isReadOnly) {
			return;
		}

		if (!pasteCells) {
			return;
		}

		const currCellIndex = viewModel.getCellIndex(context.cell);

		let topPastedCell: CellViewModel | undefined = undefined;
		pasteCells.items.reverse().map(cell => cloneNotebookCellTextModel(cell)).forEach(pasteCell => {
			topPastedCell = viewModel.createCell(currCellIndex, pasteCell.source, pasteCell.language, pasteCell.cellKind, pasteCell.metadata, pasteCell.outputs, true);
			return;
		});

		if (topPastedCell) {
			context.notebookEditor.focusNotebookCell(topPastedCell, 'container');
		}
	}
});
