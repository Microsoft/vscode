/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { Selection } from 'vs/editor/common/core/selection';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

class CursorState {
	readonly selections: readonly Selection[];

	constructor(selections: readonly Selection[]) {
		this.selections = selections;
	}

	public equals(other: CursorState): boolean {
		const thisLen = this.selections.length;
		const otherLen = other.selections.length;
		if (thisLen !== otherLen) {
			return false;
		}
		for (let i = 0; i < thisLen; i++) {
			if (!this.selections[i].equalsSelection(other.selections[i])) {
				return false;
			}
		}
		return true;
	}
}

class StackElement {
	constructor(
		public readonly cursorState: CursorState,
		public readonly scrollTop: number,
		public readonly scrollLeft: number
	) { }
}

export class CursorUndoRedoController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.cursorUndoRedoController';

	public static get(editor: ICodeEditor): CursorUndoRedoController {
		return editor.getContribution<CursorUndoRedoController>(CursorUndoRedoController.ID);
	}

	private readonly _editor: ICodeEditor;
	private _isCursorUndoRedo: boolean;

	private _undoStack: StackElement[];
	private _redoStack: StackElement[];

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;
		this._isCursorUndoRedo = false;

		this._undoStack = [];
		this._redoStack = [];

		this._register(editor.onDidChangeModel((e) => {
			this._undoStack = [];
			this._redoStack = [];
		}));
		this._register(editor.onDidChangeModelContent((e) => {
			this._undoStack = [];
			this._redoStack = [];
		}));
		this._register(editor.onDidChangeCursorSelection((e) => {
			if (this._isCursorUndoRedo) {
				return;
			}
			if (!e.oldSelections) {
				return;
			}
			if (e.oldModelVersionId !== e.modelVersionId) {
				return;
			}
			const prevState = new CursorState(e.oldSelections);
			const isEqualToLastUndoStack = (this._undoStack.length > 0 && this._undoStack[this._undoStack.length - 1].cursorState.equals(prevState));
			if (!isEqualToLastUndoStack) {
				this._undoStack.push(new StackElement(prevState, editor.getScrollTop(), editor.getScrollLeft()));
				this._redoStack = [];
				if (this._undoStack.length > 50) {
					// keep the cursor undo stack bounded
					this._undoStack.shift();
				}
			}
		}));
	}

	public cursorUndo(): void {
		if (!this._editor.hasModel() || this._undoStack.length === 0) {
			return;
		}

		this._redoStack.push(new StackElement(new CursorState(this._editor.getSelections()), this._editor.getScrollTop(), this._editor.getScrollLeft()));
		this._applyState(this._undoStack.pop()!);
	}

	public cursorRedo(): void {
		if (!this._editor.hasModel() || this._redoStack.length === 0) {
			return;
		}

		this._undoStack.push(new StackElement(new CursorState(this._editor.getSelections()), this._editor.getScrollTop(), this._editor.getScrollLeft()));
		this._applyState(this._redoStack.pop()!);
	}

	private _applyState(stackElement: StackElement): void {
		this._isCursorUndoRedo = true;
		this._editor.setSelections(stackElement.cursorState.selections);
		this._editor.setScrollPosition({
			scrollTop: stackElement.scrollTop,
			scrollLeft: stackElement.scrollLeft
		});
		this._isCursorUndoRedo = false;
	}
}

export class CursorUndo extends EditorAction {
	constructor() {
		super({
			id: 'cursorUndo',
			label: nls.localize('cursor.undo', "Cursor Undo"),
			alias: 'Cursor Undo',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_U,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
		CursorUndoRedoController.get(editor).cursorUndo();
	}
}

export class CursorRedo extends EditorAction {
	constructor() {
		super({
			id: 'cursorRedo',
			label: nls.localize('cursor.redo', "Cursor Redo"),
			alias: 'Cursor Redo',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {
		CursorUndoRedoController.get(editor).cursorRedo();
	}
}

registerEditorContribution(CursorUndoRedoController.ID, CursorUndoRedoController);
registerEditorAction(CursorUndo);
registerEditorAction(CursorRedo);
