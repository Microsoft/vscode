/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import { KeyCode, KeyMod, KeyChord } from 'vs/base/common/keyCodes';
import { SortLinesCommand } from 'vs/editor/contrib/linesOperations/sortLinesCommand';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { TrimTrailingWhitespaceCommand } from 'vs/editor/common/commands/trimTrailingWhitespaceCommand';
import { ICommand } from 'vs/editor/common/editorCommon';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ReplaceCommand, ReplaceCommandThatPreservesSelection } from 'vs/editor/common/commands/replaceCommand';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { Position } from 'vs/editor/common/core/position';
import { registerEditorAction, ServicesAccessor, IActionOptions, EditorAction } from 'vs/editor/browser/editorExtensions';
import { CopyLinesCommand } from './copyLinesCommand';
import { DeleteLinesCommand } from './deleteLinesCommand';
import { TypeOperations } from 'vs/editor/common/controller/cursorTypeOperations';
import { CoreEditingCommands } from 'vs/editor/browser/controller/coreCommands';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

// copy lines

abstract class AbstractCopyLinesAction extends EditorAction {

	private down: boolean;

	constructor(down: boolean, opts: IActionOptions) {
		super(opts);
		this.down = down;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {

		var commands: ICommand[] = [];
		var selections = editor.getSelections();

		for (var i = 0; i < selections.length; i++) {
			commands.push(new CopyLinesCommand(selections[i], this.down));
		}

		editor.pushUndoStop();
		editor.executeCommands(this.id, commands);
		editor.pushUndoStop();
	}
}

class CopyLinesUpAction extends AbstractCopyLinesAction {
	constructor() {
		super(false, {
			id: 'editor.action.copyLinesUpAction',
			label: nls.localize('lines.copyUp', "Copy Line Up"),
			alias: 'Copy Line Up',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.UpArrow,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.UpArrow }
			}
		});
	}
}

class CopyLinesDownAction extends AbstractCopyLinesAction {
	constructor() {
		super(true, {
			id: 'editor.action.copyLinesDownAction',
			label: nls.localize('lines.copyDown', "Copy Line Down"),
			alias: 'Copy Line Down',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.DownArrow,
				linux: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.DownArrow }
			}
		});
	}
}

// move lines

export abstract class AbstractMoveLinesAction extends EditorAction {

	private down: boolean;

	constructor(down: boolean, opts: IActionOptions) {
		super(opts);
		this.down = down;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {

		const primaryCursor = editor.getSelection();
		const allSelections = editor.getSelections();
		const model = editor.getModel();
		const maxLine = model.getLineCount();
		let rangeAll = [];
		let result = null;

		if ((allSelections[0].startLineNumber === 1 && this.down === false) || (allSelections[allSelections.length - 1].startLineNumber >= maxLine && this.down === true)) {
			return null;
		}

		for (let i = 0; i < allSelections.length; i++) {
			rangeAll.push(model.getLineContent(allSelections[i].selectionStartLineNumber));
		}

		let fullResult = this._getFullRangesToMove(editor, rangeAll);

		if (this.down) {
			rangeAll.unshift(model.getLineContent(allSelections[allSelections.length - 1].selectionStartLineNumber + 1));
			result = editor.getModel().findNextMatch(rangeAll[0], editor.getPosition(), false, true, null, false);
		} else {
			rangeAll.push(model.getLineContent(allSelections[0].selectionStartLineNumber - 1));
			result = editor.getModel().findPreviousMatch(rangeAll[rangeAll.length - 1], editor.getPosition(), false, true, null, false);
		}

		let rangesToMove = this._getRangesToMove(editor);
		let effectiveRanges: Range[] = [];

		let lastEdit = [result.range];

		for (let i = 0, count = rangesToMove.length - 1; i < count; i++) {

			let range = rangesToMove[i];
			let nextRange = rangesToMove[i + 1];

			if (Range.intersectRanges(range, nextRange) === null) {
				effectiveRanges.push(range);
			} else {
				rangesToMove[i + 1] = Range.plusRange(range, nextRange);
			}
		}

		effectiveRanges.push(rangesToMove[rangesToMove.length - 1]);

		let endCursorState = this._getEndCursorState(primaryCursor, effectiveRanges, this.down);
		let count = this.down ? 0 : 1;

		let edits: IIdentifiedSingleEditOperation[] = fullResult.map(range => {
			return EditOperation.replace(range, rangeAll[count++]);
		});

		if (this.down) {
			edits = edits.concat(lastEdit.map(range => {
				return EditOperation.replace(range, rangeAll[rangeAll.length - 1]);
			}));
		} else {
			edits = edits.concat(lastEdit.map(range => {
				return EditOperation.replace(range, rangeAll[0]);
			}));
		}

		editor.pushUndoStop();
		editor.executeEdits(this.id, edits, endCursorState);
		editor.pushUndoStop();
	}

	_getEndCursorState(primaryCursor: Range, rangesToMove: Range[], down: boolean): Selection[] {
		let endPrimaryCursor: Selection;
		let endCursorState: Selection[] = [];

		for (let i = 0, len = rangesToMove.length; i < len; i++) {
			let range = rangesToMove[i];
			let endCursor = null;
			if (down) {
				endCursor = new Selection(rangesToMove[i].startLineNumber + 1, rangesToMove[i].startColumn, rangesToMove[i].endLineNumber + 1, rangesToMove[i].endColumn);
			} else {
				endCursor = new Selection(rangesToMove[i].startLineNumber - 1, rangesToMove[i].startColumn, rangesToMove[i].endLineNumber - 1, rangesToMove[i].endColumn);
			}

			if (range.intersectRanges(primaryCursor)) {
				endPrimaryCursor = endCursor;
			} else {
				endCursorState.push(endCursor);
			}
		}

		if (endPrimaryCursor) {
			endCursorState.unshift(endPrimaryCursor);
		}

		return endCursorState;
	}

	_getRangesToMove(editor: ICodeEditor): Range[] {
		let rangesToMove: Range[] = editor.getSelections();

		rangesToMove.sort(Range.compareRangesUsingStarts);
		rangesToMove = rangesToMove.map(selection => {
			if (selection.isEmpty()) {
				return new Range(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn);
			} else {
				return selection;
			}
		});

		return rangesToMove;
	}

	_getFullRangesToMove(editor: ICodeEditor, rangesText: string[]): Range[] {
		let rangesToMove: Range[] = editor.getSelections();
		let fullRanges = [];

		for (let i = 0; i < rangesToMove.length; i++) {
			fullRanges.push(editor.getModel().findNextMatch(rangesText[i], editor.getPosition(), false, true, null, false).range);
		}

		return fullRanges;
	}

}

export class MoveLinesUpAction extends AbstractMoveLinesAction {
	constructor() {
		super(false, {
			id: 'editor.action.moveLinesUpAction',
			label: nls.localize('lines.moveUp', "Move Line Up"),
			alias: 'Move Line Up',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Alt | KeyCode.UpArrow,
				linux: { primary: KeyMod.Alt | KeyCode.UpArrow }
			}
		});
	}
}

export class MoveLinesDownAction extends AbstractMoveLinesAction {
	constructor() {
		super(true, {
			id: 'editor.action.moveLinesDownAction',
			label: nls.localize('lines.moveDown', "Move Line Down"),
			alias: 'Move Line Down',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.Alt | KeyCode.DownArrow,
				linux: { primary: KeyMod.Alt | KeyCode.DownArrow }
			}
		});
	}
}

export abstract class AbstractSortLinesAction extends EditorAction {
	private descending: boolean;

	constructor(descending: boolean, opts: IActionOptions) {
		super(opts);
		this.descending = descending;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const selections = editor.getSelections();

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			if (!SortLinesCommand.canRun(editor.getModel(), selection, this.descending)) {
				return;
			}
		}

		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new SortLinesCommand(selections[i], this.descending);
		}

		editor.pushUndoStop();
		editor.executeCommands(this.id, commands);
		editor.pushUndoStop();
	}
}

export class SortLinesAscendingAction extends AbstractSortLinesAction {
	constructor() {
		super(false, {
			id: 'editor.action.sortLinesAscending',
			label: nls.localize('lines.sortAscending', "Sort Lines Ascending"),
			alias: 'Sort Lines Ascending',
			precondition: EditorContextKeys.writable
		});
	}
}

export class SortLinesDescendingAction extends AbstractSortLinesAction {
	constructor() {
		super(true, {
			id: 'editor.action.sortLinesDescending',
			label: nls.localize('lines.sortDescending', "Sort Lines Descending"),
			alias: 'Sort Lines Descending',
			precondition: EditorContextKeys.writable
		});
	}
}

export class TrimTrailingWhitespaceAction extends EditorAction {

	public static readonly ID = 'editor.action.trimTrailingWhitespace';

	constructor() {
		super({
			id: TrimTrailingWhitespaceAction.ID,
			label: nls.localize('lines.trimTrailingWhitespace', "Trim Trailing Whitespace"),
			alias: 'Trim Trailing Whitespace',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_X)
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor, args: any): void {

		let cursors: Position[] = [];
		if (args.reason === 'auto-save') {
			// See https://github.com/editorconfig/editorconfig-vscode/issues/47
			// It is very convenient for the editor config extension to invoke this action.
			// So, if we get a reason:'auto-save' passed in, let's preserve cursor positions.
			cursors = editor.getSelections().map(s => new Position(s.positionLineNumber, s.positionColumn));
		}

		var command = new TrimTrailingWhitespaceCommand(editor.getSelection(), cursors);

		editor.pushUndoStop();
		editor.executeCommands(this.id, [command]);
		editor.pushUndoStop();
	}
}

// delete lines

interface IDeleteLinesOperation {
	startLineNumber: number;
	endLineNumber: number;
	positionColumn: number;
}

abstract class AbstractRemoveLinesAction extends EditorAction {
	_getLinesToRemove(editor: ICodeEditor): IDeleteLinesOperation[] {
		// Construct delete operations
		var operations: IDeleteLinesOperation[] = editor.getSelections().map((s) => {

			var endLineNumber = s.endLineNumber;
			if (s.startLineNumber < s.endLineNumber && s.endColumn === 1) {
				endLineNumber -= 1;
			}

			return {
				startLineNumber: s.startLineNumber,
				endLineNumber: endLineNumber,
				positionColumn: s.positionColumn
			};
		});

		// Sort delete operations
		operations.sort((a, b) => {
			return a.startLineNumber - b.startLineNumber;
		});

		// Merge delete operations on consecutive lines
		var mergedOperations: IDeleteLinesOperation[] = [];
		var previousOperation = operations[0];
		for (var i = 1; i < operations.length; i++) {
			if (previousOperation.endLineNumber + 1 === operations[i].startLineNumber) {
				// Merge current operations into the previous one
				previousOperation.endLineNumber = operations[i].endLineNumber;
			} else {
				// Push previous operation
				mergedOperations.push(previousOperation);
				previousOperation = operations[i];
			}
		}
		// Push the last operation
		mergedOperations.push(previousOperation);

		return mergedOperations;
	}
}

class DeleteLinesAction extends AbstractRemoveLinesAction {

	constructor() {
		super({
			id: 'editor.action.deleteLines',
			label: nls.localize('lines.delete', "Delete Line"),
			alias: 'Delete Line',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_K
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {

		var ops = this._getLinesToRemove(editor);

		// Finally, construct the delete lines commands
		var commands: ICommand[] = ops.map((op) => {
			return new DeleteLinesCommand(op.startLineNumber, op.endLineNumber, op.positionColumn);
		});

		editor.pushUndoStop();
		editor.executeCommands(this.id, commands);
		editor.pushUndoStop();
	}
}

export class IndentLinesAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.indentLines',
			label: nls.localize('lines.indent', "Indent Line"),
			alias: 'Indent Line',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		editor.pushUndoStop();
		editor.executeCommands(this.id, TypeOperations.indent(editor._getCursorConfiguration(), editor.getModel(), editor.getSelections()));
		editor.pushUndoStop();
	}
}

class OutdentLinesAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.outdentLines',
			label: nls.localize('lines.outdent', "Outdent Line"),
			alias: 'Outdent Line',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.US_OPEN_SQUARE_BRACKET
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		CoreEditingCommands.Outdent.runEditorCommand(null, editor, null);
	}
}

export class InsertLineBeforeAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.insertLineBefore',
			label: nls.localize('lines.insertBefore', "Insert Line Above"),
			alias: 'Insert Line Above',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		editor.pushUndoStop();
		editor.executeCommands(this.id, TypeOperations.lineInsertBefore(editor._getCursorConfiguration(), editor.getModel(), editor.getSelections()));
	}
}

export class InsertLineAfterAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.insertLineAfter',
			label: nls.localize('lines.insertAfter', "Insert Line Below"),
			alias: 'Insert Line Below',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.Enter
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		editor.pushUndoStop();
		editor.executeCommands(this.id, TypeOperations.lineInsertAfter(editor._getCursorConfiguration(), editor.getModel(), editor.getSelections()));
	}
}

export abstract class AbstractDeleteAllToBoundaryAction extends EditorAction {
	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const primaryCursor = editor.getSelection();
		let rangesToDelete = this._getRangesToDelete(editor);
		// merge overlapping selections
		let effectiveRanges: Range[] = [];

		for (let i = 0, count = rangesToDelete.length - 1; i < count; i++) {
			let range = rangesToDelete[i];
			let nextRange = rangesToDelete[i + 1];

			if (Range.intersectRanges(range, nextRange) === null) {
				effectiveRanges.push(range);
			} else {
				rangesToDelete[i + 1] = Range.plusRange(range, nextRange);
			}
		}

		effectiveRanges.push(rangesToDelete[rangesToDelete.length - 1]);

		let endCursorState = this._getEndCursorState(primaryCursor, effectiveRanges);
		let edits: IIdentifiedSingleEditOperation[] = effectiveRanges.map(range => {
			endCursorState.push(new Selection(range.startLineNumber, range.startColumn, range.startLineNumber, range.startColumn));
			return EditOperation.replace(range, '');
		});

		editor.pushUndoStop();
		editor.executeEdits(this.id, edits, endCursorState);
		editor.pushUndoStop();
	}

	/**
	 * Compute the cursor state after the edit operations were applied.
	 */
	protected abstract _getEndCursorState(primaryCursor: Range, rangesToDelete: Range[]): Selection[];

	protected abstract _getRangesToDelete(editor: ICodeEditor): Range[];
}

export class DeleteAllLeftAction extends AbstractDeleteAllToBoundaryAction {
	constructor() {
		super({
			id: 'deleteAllLeft',
			label: nls.localize('lines.deleteAllLeft', "Delete All Left"),
			alias: 'Delete All Left',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: null,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace }
			}
		});
	}

	_getEndCursorState(primaryCursor: Range, rangesToDelete: Range[]): Selection[] {
		let endPrimaryCursor: Selection;
		let endCursorState: Selection[] = [];

		for (let i = 0, len = rangesToDelete.length; i < len; i++) {
			let range = rangesToDelete[i];
			let endCursor = new Selection(rangesToDelete[i].startLineNumber, rangesToDelete[i].startColumn, rangesToDelete[i].startLineNumber, rangesToDelete[i].startColumn);

			if (range.intersectRanges(primaryCursor)) {
				endPrimaryCursor = endCursor;
			} else {
				endCursorState.push(endCursor);
			}
		}

		if (endPrimaryCursor) {
			endCursorState.unshift(endPrimaryCursor);
		}

		return endCursorState;
	}

	_getRangesToDelete(editor: ICodeEditor): Range[] {
		let rangesToDelete: Range[] = editor.getSelections();

		rangesToDelete.sort(Range.compareRangesUsingStarts);
		rangesToDelete = rangesToDelete.map(selection => {
			if (selection.isEmpty()) {
				return new Range(selection.startLineNumber, 1, selection.startLineNumber, selection.startColumn);
			} else {
				return selection;
			}
		});

		return rangesToDelete;
	}
}

export class DeleteAllRightAction extends AbstractDeleteAllToBoundaryAction {
	constructor() {
		super({
			id: 'deleteAllRight',
			label: nls.localize('lines.deleteAllRight', "Delete All Right"),
			alias: 'Delete All Right',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: null,
				mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_K, secondary: [KeyMod.CtrlCmd | KeyCode.Delete] }
			}
		});
	}

	_getEndCursorState(primaryCursor: Range, rangesToDelete: Range[]): Selection[] {
		let endPrimaryCursor: Selection;
		let endCursorState: Selection[] = [];
		for (let i = 0, len = rangesToDelete.length, offset = 0; i < len; i++) {
			let range = rangesToDelete[i];
			let endCursor = new Selection(range.startLineNumber - offset, range.startColumn, range.startLineNumber - offset, range.startColumn);

			if (range.intersectRanges(primaryCursor)) {
				endPrimaryCursor = endCursor;
			} else {
				endCursorState.push(endCursor);
			}
		}

		if (endPrimaryCursor) {
			endCursorState.unshift(endPrimaryCursor);
		}

		return endCursorState;
	}

	_getRangesToDelete(editor: ICodeEditor): Range[] {
		let model = editor.getModel();

		let rangesToDelete: Range[] = editor.getSelections().map((sel) => {
			if (sel.isEmpty()) {
				const maxColumn = model.getLineMaxColumn(sel.startLineNumber);

				if (sel.startColumn === maxColumn) {
					return new Range(sel.startLineNumber, sel.startColumn, sel.startLineNumber + 1, 1);
				} else {
					return new Range(sel.startLineNumber, sel.startColumn, sel.startLineNumber, maxColumn);
				}
			}
			return sel;
		});

		rangesToDelete.sort(Range.compareRangesUsingStarts);
		return rangesToDelete;
	}
}

export class JoinLinesAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.joinLines',
			label: nls.localize('lines.joinLines', "Join Lines"),
			alias: 'Join Lines',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: 0,
				mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_J }
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let selections = editor.getSelections();
		let primaryCursor = editor.getSelection();

		selections.sort(Range.compareRangesUsingStarts);
		let reducedSelections: Selection[] = [];

		let lastSelection = selections.reduce((previousValue, currentValue) => {
			if (previousValue.isEmpty()) {
				if (previousValue.endLineNumber === currentValue.startLineNumber) {
					if (primaryCursor.equalsSelection(previousValue)) {
						primaryCursor = currentValue;
					}
					return currentValue;
				}

				if (currentValue.startLineNumber > previousValue.endLineNumber + 1) {
					reducedSelections.push(previousValue);
					return currentValue;
				} else {
					return new Selection(previousValue.startLineNumber, previousValue.startColumn, currentValue.endLineNumber, currentValue.endColumn);
				}
			} else {
				if (currentValue.startLineNumber > previousValue.endLineNumber) {
					reducedSelections.push(previousValue);
					return currentValue;
				} else {
					return new Selection(previousValue.startLineNumber, previousValue.startColumn, currentValue.endLineNumber, currentValue.endColumn);
				}
			}
		});

		reducedSelections.push(lastSelection);

		let model = editor.getModel();
		let edits = [];
		let endCursorState = [];
		let endPrimaryCursor = primaryCursor;
		let lineOffset = 0;

		for (let i = 0, len = reducedSelections.length; i < len; i++) {
			let selection = reducedSelections[i];
			let startLineNumber = selection.startLineNumber;
			let startColumn = 1;
			let endLineNumber: number,
				endColumn: number,
				columnDeltaOffset: number;

			let selectionEndPositionOffset = model.getLineContent(selection.endLineNumber).length - selection.endColumn;

			if (selection.isEmpty() || selection.startLineNumber === selection.endLineNumber) {
				let position = selection.getStartPosition();
				if (position.lineNumber < model.getLineCount()) {
					endLineNumber = startLineNumber + 1;
					endColumn = model.getLineMaxColumn(endLineNumber);
				} else {
					endLineNumber = position.lineNumber;
					endColumn = model.getLineMaxColumn(position.lineNumber);
				}
			} else {
				endLineNumber = selection.endLineNumber;
				endColumn = model.getLineMaxColumn(endLineNumber);
			}

			let trimmedLinesContent = model.getLineContent(startLineNumber);

			for (let i = startLineNumber + 1; i <= endLineNumber; i++) {
				let lineText = model.getLineContent(i);
				let firstNonWhitespaceIdx = model.getLineFirstNonWhitespaceColumn(i);

				if (firstNonWhitespaceIdx >= 1) {
					let insertSpace = true;
					if (trimmedLinesContent === '') {
						insertSpace = false;
					}

					if (insertSpace && (trimmedLinesContent.charAt(trimmedLinesContent.length - 1) === ' ' ||
						trimmedLinesContent.charAt(trimmedLinesContent.length - 1) === '\t')) {
						insertSpace = false;
						trimmedLinesContent = trimmedLinesContent.replace(/[\s\uFEFF\xA0]+$/g, ' ');
					}

					let lineTextWithoutIndent = lineText.substr(firstNonWhitespaceIdx - 1);

					trimmedLinesContent += (insertSpace ? ' ' : '') + lineTextWithoutIndent;

					if (insertSpace) {
						columnDeltaOffset = lineTextWithoutIndent.length + 1;
					} else {
						columnDeltaOffset = lineTextWithoutIndent.length;
					}
				} else {
					columnDeltaOffset = 0;
				}
			}

			let deleteSelection = new Range(startLineNumber, startColumn, endLineNumber, endColumn);

			if (!deleteSelection.isEmpty()) {
				let resultSelection: Selection;

				if (selection.isEmpty()) {
					edits.push(EditOperation.replace(deleteSelection, trimmedLinesContent));
					resultSelection = new Selection(deleteSelection.startLineNumber - lineOffset, trimmedLinesContent.length - columnDeltaOffset + 1, startLineNumber - lineOffset, trimmedLinesContent.length - columnDeltaOffset + 1);
				} else {
					if (selection.startLineNumber === selection.endLineNumber) {
						edits.push(EditOperation.replace(deleteSelection, trimmedLinesContent));
						resultSelection = new Selection(selection.startLineNumber - lineOffset, selection.startColumn,
							selection.endLineNumber - lineOffset, selection.endColumn);
					} else {
						edits.push(EditOperation.replace(deleteSelection, trimmedLinesContent));
						resultSelection = new Selection(selection.startLineNumber - lineOffset, selection.startColumn,
							selection.startLineNumber - lineOffset, trimmedLinesContent.length - selectionEndPositionOffset);
					}
				}

				if (Range.intersectRanges(deleteSelection, primaryCursor) !== null) {
					endPrimaryCursor = resultSelection;
				} else {
					endCursorState.push(resultSelection);
				}
			}

			lineOffset += deleteSelection.endLineNumber - deleteSelection.startLineNumber;
		}

		endCursorState.unshift(endPrimaryCursor);
		editor.pushUndoStop();
		editor.executeEdits(this.id, edits, endCursorState);
		editor.pushUndoStop();
	}
}

export class TransposeAction extends EditorAction {
	constructor() {
		super({
			id: 'editor.action.transpose',
			label: nls.localize('editor.transpose', "Transpose characters around the cursor"),
			alias: 'Transpose characters around the cursor',
			precondition: EditorContextKeys.writable
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let selections = editor.getSelections();
		let model = editor.getModel();
		let commands: ICommand[] = [];

		for (let i = 0, len = selections.length; i < len; i++) {
			let selection = selections[i];

			if (!selection.isEmpty()) {
				continue;
			}

			let cursor = selection.getStartPosition();
			let maxColumn = model.getLineMaxColumn(cursor.lineNumber);

			if (cursor.column >= maxColumn) {
				if (cursor.lineNumber === model.getLineCount()) {
					continue;
				}

				// The cursor is at the end of current line and current line is not empty
				// then we transpose the character before the cursor and the line break if there is any following line.
				let deleteSelection = new Range(cursor.lineNumber, Math.max(1, cursor.column - 1), cursor.lineNumber + 1, 1);
				let chars = model.getValueInRange(deleteSelection).split('').reverse().join('');

				commands.push(new ReplaceCommand(new Selection(cursor.lineNumber, Math.max(1, cursor.column - 1), cursor.lineNumber + 1, 1), chars));
			} else {
				let deleteSelection = new Range(cursor.lineNumber, Math.max(1, cursor.column - 1), cursor.lineNumber, cursor.column + 1);
				let chars = model.getValueInRange(deleteSelection).split('').reverse().join('');
				commands.push(new ReplaceCommandThatPreservesSelection(deleteSelection, chars,
					new Selection(cursor.lineNumber, cursor.column + 1, cursor.lineNumber, cursor.column + 1)));
			}
		}

		editor.pushUndoStop();
		editor.executeCommands(this.id, commands);
		editor.pushUndoStop();
	}
}

export abstract class AbstractCaseAction extends EditorAction {
	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let selections = editor.getSelections();
		let model = editor.getModel();
		let commands: ICommand[] = [];

		for (let i = 0, len = selections.length; i < len; i++) {
			let selection = selections[i];
			if (selection.isEmpty()) {
				let cursor = selection.getStartPosition();
				let word = model.getWordAtPosition(cursor);

				if (!word) {
					continue;
				}

				let wordRange = new Range(cursor.lineNumber, word.startColumn, cursor.lineNumber, word.endColumn);
				let text = model.getValueInRange(wordRange);
				commands.push(new ReplaceCommandThatPreservesSelection(wordRange, this._modifyText(text),
					new Selection(cursor.lineNumber, cursor.column, cursor.lineNumber, cursor.column)));

			} else {
				let text = model.getValueInRange(selection);
				commands.push(new ReplaceCommandThatPreservesSelection(selection, this._modifyText(text), selection));
			}
		}

		editor.pushUndoStop();
		editor.executeCommands(this.id, commands);
		editor.pushUndoStop();
	}

	protected abstract _modifyText(text: string): string;
}

export class UpperCaseAction extends AbstractCaseAction {
	constructor() {
		super({
			id: 'editor.action.transformToUppercase',
			label: nls.localize('editor.transformToUppercase', "Transform to Uppercase"),
			alias: 'Transform to Uppercase',
			precondition: EditorContextKeys.writable
		});
	}

	protected _modifyText(text: string): string {
		return text.toLocaleUpperCase();
	}
}

export class LowerCaseAction extends AbstractCaseAction {
	constructor() {
		super({
			id: 'editor.action.transformToLowercase',
			label: nls.localize('editor.transformToLowercase', "Transform to Lowercase"),
			alias: 'Transform to Lowercase',
			precondition: EditorContextKeys.writable
		});
	}

	protected _modifyText(text: string): string {
		return text.toLocaleLowerCase();
	}
}

registerEditorAction(CopyLinesUpAction);
registerEditorAction(CopyLinesDownAction);
registerEditorAction(MoveLinesUpAction);
registerEditorAction(MoveLinesDownAction);
registerEditorAction(SortLinesAscendingAction);
registerEditorAction(SortLinesDescendingAction);
registerEditorAction(TrimTrailingWhitespaceAction);
registerEditorAction(DeleteLinesAction);
registerEditorAction(IndentLinesAction);
registerEditorAction(OutdentLinesAction);
registerEditorAction(InsertLineBeforeAction);
registerEditorAction(InsertLineAfterAction);
registerEditorAction(DeleteAllLeftAction);
registerEditorAction(DeleteAllRightAction);
registerEditorAction(JoinLinesAction);
registerEditorAction(TransposeAction);
registerEditorAction(UpperCaseAction);
registerEditorAction(LowerCaseAction);
