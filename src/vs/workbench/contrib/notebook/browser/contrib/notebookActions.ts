/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { localize } from 'vs/nls';
import { Action2, IAction2Options, MenuId, MenuItemAction, MenuRegistry, registerAction2 } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContext, InputFocusedContextKey, IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { COPY_CELL_DOWN_COMMAND_ID, COPY_CELL_UP_COMMAND_ID, DELETE_CELL_COMMAND_ID, EDIT_CELL_COMMAND_ID, EXECUTE_CELL_COMMAND_ID, INSERT_CODE_CELL_ABOVE_COMMAND_ID, INSERT_CODE_CELL_BELOW_COMMAND_ID, INSERT_MARKDOWN_CELL_ABOVE_COMMAND_ID, INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID, MOVE_CELL_DOWN_COMMAND_ID, MOVE_CELL_UP_COMMAND_ID, SAVE_CELL_COMMAND_ID, NOTEBOOK_CELL_TYPE_CONTEXT_KEY, NOTEBOOK_EDITABLE_CONTEXT_KEY, NOTEBOOK_CELL_EDITABLE_CONTEXT_KEY, NOTEBOOK_CELL_MARKDOWN_EDIT_MODE_CONTEXT_KEY } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellRenderTemplate, CellEditState, ICellViewModel, INotebookEditor, KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED, NOTEBOOK_EDITOR_FOCUSED, CellRunState } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookService } from 'vs/workbench/services/notebook/browser/notebookService';
import { CellKind, NOTEBOOK_EDITOR_CURSOR_BOUNDARY } from 'vs/workbench/services/notebook/common/notebookCommon';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';

const enum CellToolbarOrder {
	MoveCellUp,
	MoveCellDown,
	EditCell,
	SaveCell,
	InsertCell,
	DeleteCell
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: EXECUTE_CELL_COMMAND_ID,
			title: localize('notebookActions.execute', "Execute Notebook Cell"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyMod.WinCtrl | KeyCode.Enter,
				win: {
					primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Enter
				},
				weight: KeybindingWeight.WorkbenchContrib
			},
			icon: { id: 'codicon/play' }
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		runCell(context);
	}
});

export class ExecuteCellAction extends MenuItemAction {
	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService commandService: ICommandService
	) {
		super(
			{
				id: EXECUTE_CELL_COMMAND_ID,
				title: localize('notebookActions.executeCell', "Execute Cell"),
				icon: { id: 'codicon/play' }
			},
			undefined,
			{ shouldForwardArgs: true },
			contextKeyService,
			commandService);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebookCellSelectBelow',
			title: localize('notebookActions.executeAndSelectBelow', "Execute Notebook Cell and Select Below"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyMod.Shift | KeyCode.Enter,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const activeCell = await runActiveCell(accessor);
		if (!activeCell) {
			return;
		}

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const idx = editor.viewModel?.getViewCellIndex(activeCell);
		if (typeof idx !== 'number') {
			return;
		}

		// Try to select below, fall back on inserting
		const nextCell = editor.viewModel?.viewCells[idx + 1];
		if (nextCell) {
			editor.focusNotebookCell(nextCell, false);
		} else {
			await editor.insertNotebookCell(activeCell, CellKind.Code, 'below');
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebookCellInsertBelow',
			title: localize('notebookActions.executeAndInsertBelow', "Execute Notebook Cell and Insert Below"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyMod.Alt | KeyCode.Enter,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const activeCell = await runActiveCell(accessor);
		if (!activeCell) {
			return;
		}

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		await editor.insertNotebookCell(activeCell, CellKind.Code, 'below');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebook',
			title: localize('notebookActions.executeNotebook', "Execute Notebook")
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let notebookService = accessor.get(INotebookService);

		let resource = editorService.activeEditor?.resource;

		if (!resource) {
			return;
		}

		let notebookProviders = notebookService.getContributedNotebookProviders(resource!);

		if (notebookProviders.length > 0) {
			let viewType = notebookProviders[0].id;
			notebookService.executeNotebook(viewType, resource);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.executeNotebookCell',
			title: localize('notebookActions.executeNotebookCell', "Execute Notebook Active Cell")
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		if (!editor) {
			return;
		}

		let activeCell = editor.getActiveCell();
		if (activeCell) {
			return editor.executeNotebookCell(activeCell);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.quitNotebookEdit',
			title: localize('notebookActions.quitEditing', "Quit Notebook Cell Editing"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, InputFocusedContext),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib - 5
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		if (!editor) {
			return;
		}

		let activeCell = editor.getActiveCell();
		if (activeCell) {
			if (activeCell.cellKind === CellKind.Markdown) {
				activeCell.editState = CellEditState.Preview;
			}

			editor.focusNotebookCell(activeCell, false);
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.hideFind',
			title: localize('notebookActions.hideFind', "Hide Find in Notebook"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED),
				primary: KeyCode.Escape,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		editor?.hideFind();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.find',
			title: localize('notebookActions.findInNotebook', "Find in Notebook"),
			keybinding: {
				when: NOTEBOOK_EDITOR_FOCUSED,
				primary: KeyCode.KEY_F | KeyMod.CtrlCmd,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		let editorService = accessor.get(IEditorService);
		let editor = getActiveNotebookEditor(editorService);

		editor?.showFind();
	}
});

MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'workbench.action.executeNotebook',
		title: localize('notebookActions.menu.executeNotebook', "Execute Notebook (Run all cells)"),
		icon: { id: 'codicon/debug-start' }
	},
	order: -1,
	group: 'navigation',
	when: NOTEBOOK_EDITOR_FOCUSED
});


MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
	command: {
		id: 'workbench.action.executeNotebookCell',
		title: localize('notebookActions.menu.execute', "Execute Notebook Cell"),
		icon: { id: 'codicon/debug-continue' }
	},
	order: -1,
	group: 'navigation',
	when: NOTEBOOK_EDITOR_FOCUSED
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.changeCellToCode',
			title: localize('notebookActions.changeCellToCode', "Change Cell to Code"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyCode.KEY_Y,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		return changeActiveCellToKind(CellKind.Code, accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.changeCellToMarkdown',
			title: localize('notebookActions.changeCellToMarkdown', "Change Cell to Markdown"),
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyCode.KEY_M,
				weight: KeybindingWeight.WorkbenchContrib
			}
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		return changeActiveCellToKind(CellKind.Markdown, accessor);
	}
});

function getActiveNotebookEditor(editorService: IEditorService): INotebookEditor | undefined {
	// TODO can `isNotebookEditor` be on INotebookEditor to avoid a circular dependency?
	const activeEditorPane = editorService.activeEditorPane as any | undefined;
	return activeEditorPane?.isNotebookEditor ? activeEditorPane : undefined;
}

async function runActiveCell(accessor: ServicesAccessor): Promise<ICellViewModel | undefined> {
	const editorService = accessor.get(IEditorService);
	const editor = getActiveNotebookEditor(editorService);
	if (!editor) {
		return;
	}

	const activeCell = editor.getActiveCell();
	if (!activeCell) {
		return;
	}

	editor.executeNotebookCell(activeCell);
	return activeCell;
}

async function runCell(context: INotebookCellActionContext): Promise<void> {
	if (context.cell.runState === CellRunState.Running) {
		return;
	}

	return context.notebookEditor.executeNotebookCell(context.cell);
}

async function changeActiveCellToKind(kind: CellKind, accessor: ServicesAccessor): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const editor = getActiveNotebookEditor(editorService);
	if (!editor) {
		return;
	}

	const activeCell = editor.getActiveCell();
	if (!activeCell) {
		return;
	}

	if (activeCell.cellKind === kind) {
		return;
	}

	const text = activeCell.getText();
	await editor.insertNotebookCell(activeCell, kind, 'below', text);
	const idx = editor.viewModel?.getViewCellIndex(activeCell);
	if (typeof idx !== 'number') {
		return;
	}

	const newCell = editor.viewModel?.viewCells[idx + 1];
	if (!newCell) {
		return;
	}

	editor.focusNotebookCell(newCell, true);
	editor.deleteNotebookCell(activeCell);
}

export interface INotebookCellActionContext {
	cellTemplate?: CellRenderTemplate;
	cell: ICellViewModel;
	notebookEditor: INotebookEditor;
}

function getActiveCellContext(accessor: ServicesAccessor): INotebookCellActionContext | undefined {
	const editorService = accessor.get(IEditorService);

	const editor = getActiveNotebookEditor(editorService);
	if (!editor) {
		return;
	}

	const activeCell = editor.getActiveCell();
	if (!activeCell) {
		return;
	}

	return {
		cell: activeCell,
		notebookEditor: editor
	};
}

abstract class InsertCellCommand extends Action2 {
	constructor(
		desc: Readonly<IAction2Options>,
		private kind: CellKind,
		private direction: 'above' | 'below'
	) {
		super(desc);
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		await context.notebookEditor.insertNotebookCell(context.cell, this.kind, this.direction);
	}
}

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_CODE_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.insertCodeCellAbove', "Insert Code Cell Above")
			},
			CellKind.Code,
			'above');
	}
});

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_CODE_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertCodeCellBelow', "Insert Code Cell Below"),
				icon: { id: 'codicon/add' },
				menu: {
					id: MenuId.NotebookCellTitle,
					order: CellToolbarOrder.InsertCell,
					alt: {
						id: INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID,
						title: localize('notebookActions.insertMarkdownCellBelow', "Insert Markdown Cell Below"),
						icon: { id: 'codicon/add' },
					},
					when: ContextKeyExpr.equals(NOTEBOOK_EDITABLE_CONTEXT_KEY, true)
				}
			},
			CellKind.Code,
			'below');
	}
});

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_MARKDOWN_CELL_ABOVE_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellAbove', "Insert Markdown Cell Above"),
			},
			CellKind.Markdown,
			'above');
	}
});

registerAction2(class extends InsertCellCommand {
	constructor() {
		super(
			{
				id: INSERT_MARKDOWN_CELL_BELOW_COMMAND_ID,
				title: localize('notebookActions.insertMarkdownCellBelow', "Insert Markdown Cell Below")
			},
			CellKind.Markdown,
			'below');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: EDIT_CELL_COMMAND_ID,
				title: localize('notebookActions.editCell', "Edit Cell"),
				keybinding: {
					when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
					primary: KeyCode.Enter,
					weight: KeybindingWeight.WorkbenchContrib
				},
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals(NOTEBOOK_CELL_TYPE_CONTEXT_KEY, 'markdown'),
						ContextKeyExpr.equals(NOTEBOOK_CELL_MARKDOWN_EDIT_MODE_CONTEXT_KEY, false),
						ContextKeyExpr.equals(NOTEBOOK_CELL_EDITABLE_CONTEXT_KEY, true)),
					order: CellToolbarOrder.EditCell
				},
				icon: { id: 'codicon/pencil' }
			});
	}

	run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return context.notebookEditor.editNotebookCell(context.cell);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: SAVE_CELL_COMMAND_ID,
				title: localize('notebookActions.saveCell', "Save Cell"),
				menu: {
					id: MenuId.NotebookCellTitle,
					when: ContextKeyExpr.and(
						ContextKeyExpr.equals(NOTEBOOK_CELL_TYPE_CONTEXT_KEY, 'markdown'),
						ContextKeyExpr.equals(NOTEBOOK_CELL_MARKDOWN_EDIT_MODE_CONTEXT_KEY, true),
						ContextKeyExpr.equals(NOTEBOOK_CELL_EDITABLE_CONTEXT_KEY, true)),
					order: CellToolbarOrder.SaveCell
				},
				icon: { id: 'codicon/save' }
			});
	}

	run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return context.notebookEditor.saveNotebookCell(context.cell);
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: DELETE_CELL_COMMAND_ID,
				title: localize('notebookActions.deleteCell', "Delete Cell"),
				menu: {
					id: MenuId.NotebookCellTitle,
					order: CellToolbarOrder.DeleteCell,
					when: ContextKeyExpr.equals(NOTEBOOK_EDITABLE_CONTEXT_KEY, true)
				},
				icon: { id: 'codicon/x' }
			});
	}

	run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return context.notebookEditor.deleteNotebookCell(context.cell);
	}
});

async function moveCell(context: INotebookCellActionContext, direction: 'up' | 'down'): Promise<void> {
	direction === 'up' ?
		context.notebookEditor.moveCellUp(context.cell) :
		context.notebookEditor.moveCellDown(context.cell);
}

async function copyCell(context: INotebookCellActionContext, direction: 'up' | 'down'): Promise<void> {
	const text = context.cell.getText();
	const newCellDirection = direction === 'up' ? 'above' : 'below';
	await context.notebookEditor.insertNotebookCell(context.cell, context.cell.cellKind, newCellDirection, text);
}

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: MOVE_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.moveCellUp', "Move Cell Up"),
				icon: { id: 'codicon/arrow-up' },
				menu: {
					id: MenuId.NotebookCellTitle,
					order: CellToolbarOrder.MoveCellUp,
					alt: {
						id: COPY_CELL_UP_COMMAND_ID,
						title: localize('notebookActions.copyCellUp', "Copy Cell Up"),
						icon: { id: 'codicon/arrow-up' }
					},
					when: ContextKeyExpr.equals(NOTEBOOK_EDITABLE_CONTEXT_KEY, true)
				},
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return moveCell(context, 'up');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: MOVE_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.moveCellDown', "Move Cell Down"),
				icon: { id: 'codicon/arrow-down' },
				menu: {
					id: MenuId.NotebookCellTitle,
					order: CellToolbarOrder.MoveCellDown,
					alt: {
						id: COPY_CELL_DOWN_COMMAND_ID,
						title: localize('notebookActions.copyCellDown', "Copy Cell Down"),
						icon: { id: 'codicon/arrow-down' }
					},
					when: ContextKeyExpr.equals(NOTEBOOK_EDITABLE_CONTEXT_KEY, true)
				},
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return moveCell(context, 'down');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: COPY_CELL_UP_COMMAND_ID,
				title: localize('notebookActions.copyCellUp', "Copy Cell Up")
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return copyCell(context, 'up');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super(
			{
				id: COPY_CELL_DOWN_COMMAND_ID,
				title: localize('notebookActions.copyCellDown', "Copy Cell Down")
			});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext) {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		return copyCell(context, 'down');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.cursorDown',
			title: 'Notebook Cursor Move Down',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.has(InputFocusedContextKey), EditorContextKeys.editorTextFocus, NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('top'), NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('none')),
				primary: KeyCode.DownArrow,
				weight: KeybindingWeight.EditorContrib // smaller than Suggest Widget, etc
			}
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		const editor = context.notebookEditor;
		const activeCell = context.cell;

		const idx = editor.viewModel?.getViewCellIndex(activeCell);
		if (typeof idx !== 'number') {
			return;
		}

		const newCell = editor.viewModel?.viewCells[idx + 1];

		if (!newCell) {
			return;
		}

		editor.focusNotebookCell(newCell, true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.cursorUp',
			title: 'Notebook Cursor Move Up',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.has(InputFocusedContextKey), EditorContextKeys.editorTextFocus, NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('bottom'), NOTEBOOK_EDITOR_CURSOR_BOUNDARY.notEqualsTo('none')),
				primary: KeyCode.UpArrow,
				weight: KeybindingWeight.EditorContrib // smaller than Suggest Widget, etc
			},
		});
	}

	async run(accessor: ServicesAccessor, context?: INotebookCellActionContext): Promise<void> {
		if (!context) {
			context = getActiveCellContext(accessor);
			if (!context) {
				return;
			}
		}

		const editor = context.notebookEditor;
		const activeCell = context.cell;

		const idx = editor.viewModel?.getViewCellIndex(activeCell);
		if (typeof idx !== 'number') {
			return;
		}

		if (idx < 1) {
			// we don't do loop
			return;
		}

		const newCell = editor.viewModel?.viewCells[idx - 1];

		if (!newCell) {
			return;
		}

		editor.focusNotebookCell(newCell, true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.undo',
			title: 'Notebook Undo',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyMod.CtrlCmd | KeyCode.KEY_Z,
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

		const viewModel = editor.viewModel;

		if (!viewModel) {
			return;
		}

		viewModel.undo();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.redo',
			title: 'Notebook Redo',
			keybinding: {
				when: ContextKeyExpr.and(NOTEBOOK_EDITOR_FOCUSED, ContextKeyExpr.not(InputFocusedContextKey)),
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z,
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

		const viewModel = editor.viewModel;

		if (!viewModel) {
			return;
		}

		viewModel.redo();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.notebook.testResize',
			title: 'Notebook Test Cell Resize',
			keybinding: {
				when: IsDevelopmentContext,
				primary: undefined,
				weight: KeybindingWeight.WorkbenchContrib
			},
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const resource = editorService.activeEditor?.resource;
		if (!resource) {
			return;
		}

		const editor = getActiveNotebookEditor(editorService);
		if (!editor) {
			return;
		}

		const cells = editor.viewModel?.viewCells;

		if (cells && cells.length) {
			const firstCell = cells[0];
			editor.layoutNotebookCell(firstCell, 400);
		}
	}
});
