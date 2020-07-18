/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CoreNavigationCommands } from 'vs/editor/browser/controller/coreCommands';
import { CursorMove } from 'vs/editor/common/controller/cursorMoveCommands';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { withTestCodeEditor, ITestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { ViewModel } from 'vs/editor/common/viewModel/viewModelImpl';

suite('Cursor move command test', () => {

	const TEXT = [
		'    \tMy First Line\t ',
		'\tMy Second Line',
		'    Third Line🐶',
		'',
		'1'
	].join('\n');

	function executeTest(callback: (editor: ITestCodeEditor, viewModel: ViewModel) => void): void {
		withTestCodeEditor(TEXT, {}, (editor, viewModel) => {
			callback(editor, viewModel);
		});
	}

	test('move left should move to left character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveLeft(viewModel);
			cursorEqual(viewModel, 1, 7);
		});
	});

	test('move left should move to left by n characters', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveLeft(viewModel, 3);
			cursorEqual(viewModel, 1, 5);
		});
	});

	test('move left should move to left by half line', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveLeft(viewModel, 1, CursorMove.RawUnit.HalfLine);
			cursorEqual(viewModel, 1, 1);
		});
	});

	test('move left moves to previous line', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 2, 3);
			moveLeft(viewModel, 10);
			cursorEqual(viewModel, 1, 21);
		});
	});

	test('move right should move to right character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 5);
			moveRight(viewModel);
			cursorEqual(viewModel, 1, 6);
		});
	});

	test('move right should move to right by n characters', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 2);
			moveRight(viewModel, 6);
			cursorEqual(viewModel, 1, 8);
		});
	});

	test('move right should move to right by half line', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 4);
			moveRight(viewModel, 1, CursorMove.RawUnit.HalfLine);
			cursorEqual(viewModel, 1, 14);
		});
	});

	test('move right moves to next line', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveRight(viewModel, 100);
			cursorEqual(viewModel, 2, 1);
		});
	});

	test('move to first character of line from middle', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveToLineStart(viewModel);
			cursorEqual(viewModel, 1, 1);
		});
	});

	test('move to first character of line from first non white space character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 6);
			moveToLineStart(viewModel);
			cursorEqual(viewModel, 1, 1);
		});
	});

	test('move to first character of line from first character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 1);
			moveToLineStart(viewModel);
			cursorEqual(viewModel, 1, 1);
		});
	});

	test('move to first non white space character of line from middle', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveToLineFirstNonWhitespaceCharacter(viewModel);
			cursorEqual(viewModel, 1, 6);
		});
	});

	test('move to first non white space character of line from first non white space character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 6);
			moveToLineFirstNonWhitespaceCharacter(viewModel);
			cursorEqual(viewModel, 1, 6);
		});
	});

	test('move to first non white space character of line from first character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 1);
			moveToLineFirstNonWhitespaceCharacter(viewModel);
			cursorEqual(viewModel, 1, 6);
		});
	});

	test('move to end of line from middle', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveToLineEnd(viewModel);
			cursorEqual(viewModel, 1, 21);
		});
	});

	test('move to end of line from last non white space character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 19);
			moveToLineEnd(viewModel);
			cursorEqual(viewModel, 1, 21);
		});
	});

	test('move to end of line from line end', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 21);
			moveToLineEnd(viewModel);
			cursorEqual(viewModel, 1, 21);
		});
	});

	test('move to last non white space character from middle', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveToLineLastNonWhitespaceCharacter(viewModel);
			cursorEqual(viewModel, 1, 19);
		});
	});

	test('move to last non white space character from last non white space character', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 19);
			moveToLineLastNonWhitespaceCharacter(viewModel);
			cursorEqual(viewModel, 1, 19);
		});
	});

	test('move to last non white space character from line end', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 21);
			moveToLineLastNonWhitespaceCharacter(viewModel);
			cursorEqual(viewModel, 1, 19);
		});
	});

	test('move to center of line not from center', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 8);
			moveToLineCenter(viewModel);
			cursorEqual(viewModel, 1, 11);
		});
	});

	test('move to center of line from center', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 11);
			moveToLineCenter(viewModel);
			cursorEqual(viewModel, 1, 11);
		});
	});

	test('move to center of line from start', () => {
		executeTest((editor, viewModel) => {
			moveToLineStart(viewModel);
			moveToLineCenter(viewModel);
			cursorEqual(viewModel, 1, 11);
		});
	});

	test('move to center of line from end', () => {
		executeTest((editor, viewModel) => {
			moveToLineEnd(viewModel);
			moveToLineCenter(viewModel);
			cursorEqual(viewModel, 1, 11);
		});
	});

	test('move up by cursor move command', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 3, 5);
			cursorEqual(viewModel, 3, 5);

			moveUp(viewModel, 2);
			cursorEqual(viewModel, 1, 5);

			moveUp(viewModel, 1);
			cursorEqual(viewModel, 1, 1);
		});
	});

	test('move up by model line cursor move command', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 3, 5);
			cursorEqual(viewModel, 3, 5);

			moveUpByModelLine(viewModel, 2);
			cursorEqual(viewModel, 1, 5);

			moveUpByModelLine(viewModel, 1);
			cursorEqual(viewModel, 1, 1);
		});
	});

	test('move down by model line cursor move command', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 3, 5);
			cursorEqual(viewModel, 3, 5);

			moveDownByModelLine(viewModel, 2);
			cursorEqual(viewModel, 5, 2);

			moveDownByModelLine(viewModel, 1);
			cursorEqual(viewModel, 5, 2);
		});
	});

	test('move up with selection by cursor move command', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 3, 5);
			cursorEqual(viewModel, 3, 5);

			moveUp(viewModel, 1, true);
			cursorEqual(viewModel, 2, 2, 3, 5);

			moveUp(viewModel, 1, true);
			cursorEqual(viewModel, 1, 5, 3, 5);
		});
	});

	test('move up and down with tabs by cursor move command', () => {
		executeTest((editor, viewModel) => {
			moveTo(viewModel, 1, 5);
			cursorEqual(viewModel, 1, 5);

			moveDown(viewModel, 4);
			cursorEqual(viewModel, 5, 2);

			moveUp(viewModel, 1);
			cursorEqual(viewModel, 4, 1);

			moveUp(viewModel, 1);
			cursorEqual(viewModel, 3, 5);

			moveUp(viewModel, 1);
			cursorEqual(viewModel, 2, 2);

			moveUp(viewModel, 1);
			cursorEqual(viewModel, 1, 5);
		});
	});

	test('move up and down with end of lines starting from a long one by cursor move command', () => {
		executeTest((editor, viewModel) => {
			moveToEndOfLine(viewModel);
			cursorEqual(viewModel, 1, 21);

			moveToEndOfLine(viewModel);
			cursorEqual(viewModel, 1, 21);

			moveDown(viewModel, 2);
			cursorEqual(viewModel, 3, 17);

			moveDown(viewModel, 1);
			cursorEqual(viewModel, 4, 1);

			moveDown(viewModel, 1);
			cursorEqual(viewModel, 5, 2);

			moveUp(viewModel, 4);
			cursorEqual(viewModel, 1, 21);
		});
	});

	test('move to view top line moves to first visible line if it is first line', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(1, 1, 10, 1);

			moveTo(viewModel, 2, 2);
			moveToTop(viewModel);

			cursorEqual(viewModel, 1, 6);
		});
	});

	test('move to view top line moves to top visible line when first line is not visible', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(2, 1, 10, 1);

			moveTo(viewModel, 4, 1);
			moveToTop(viewModel);

			cursorEqual(viewModel, 2, 2);
		});
	});

	test('move to view top line moves to nth line from top', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(1, 1, 10, 1);

			moveTo(viewModel, 4, 1);
			moveToTop(viewModel, 3);

			cursorEqual(viewModel, 3, 5);
		});
	});

	test('move to view top line moves to last line if n is greater than last visible line number', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(1, 1, 3, 1);

			moveTo(viewModel, 2, 2);
			moveToTop(viewModel, 4);

			cursorEqual(viewModel, 3, 5);
		});
	});

	test('move to view center line moves to the center line', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(3, 1, 3, 1);

			moveTo(viewModel, 2, 2);
			moveToCenter(viewModel);

			cursorEqual(viewModel, 3, 5);
		});
	});

	test('move to view bottom line moves to last visible line if it is last line', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(1, 1, 5, 1);

			moveTo(viewModel, 2, 2);
			moveToBottom(viewModel);

			cursorEqual(viewModel, 5, 1);
		});
	});

	test('move to view bottom line moves to last visible line when last line is not visible', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(2, 1, 3, 1);

			moveTo(viewModel, 2, 2);
			moveToBottom(viewModel);

			cursorEqual(viewModel, 3, 5);
		});
	});

	test('move to view bottom line moves to nth line from bottom', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(1, 1, 5, 1);

			moveTo(viewModel, 4, 1);
			moveToBottom(viewModel, 3);

			cursorEqual(viewModel, 3, 5);
		});
	});

	test('move to view bottom line moves to first line if n is lesser than first visible line number', () => {
		executeTest((editor, viewModel) => {
			viewModel.getCompletelyVisibleViewRange = () => new Range(2, 1, 5, 1);

			moveTo(viewModel, 4, 1);
			moveToBottom(viewModel, 5);

			cursorEqual(viewModel, 2, 2);
		});
	});
});

// Move command

function move(viewModel: ViewModel, args: any) {
	CoreNavigationCommands.CursorMove.runCoreEditorCommand(viewModel, args);
}

function moveToLineStart(viewModel: ViewModel) {
	move(viewModel, { to: CursorMove.RawDirection.WrappedLineStart });
}

function moveToLineFirstNonWhitespaceCharacter(viewModel: ViewModel) {
	move(viewModel, { to: CursorMove.RawDirection.WrappedLineFirstNonWhitespaceCharacter });
}

function moveToLineCenter(viewModel: ViewModel) {
	move(viewModel, { to: CursorMove.RawDirection.WrappedLineColumnCenter });
}

function moveToLineEnd(viewModel: ViewModel) {
	move(viewModel, { to: CursorMove.RawDirection.WrappedLineEnd });
}

function moveToLineLastNonWhitespaceCharacter(viewModel: ViewModel) {
	move(viewModel, { to: CursorMove.RawDirection.WrappedLineLastNonWhitespaceCharacter });
}

function moveLeft(viewModel: ViewModel, value?: number, by?: string, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.Left, by: by, value: value, select: select });
}

function moveRight(viewModel: ViewModel, value?: number, by?: string, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.Right, by: by, value: value, select: select });
}

function moveUp(viewModel: ViewModel, noOfLines: number = 1, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.Up, by: CursorMove.RawUnit.WrappedLine, value: noOfLines, select: select });
}

function moveUpByModelLine(viewModel: ViewModel, noOfLines: number = 1, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.Up, value: noOfLines, select: select });
}

function moveDown(viewModel: ViewModel, noOfLines: number = 1, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.Down, by: CursorMove.RawUnit.WrappedLine, value: noOfLines, select: select });
}

function moveDownByModelLine(viewModel: ViewModel, noOfLines: number = 1, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.Down, value: noOfLines, select: select });
}

function moveToTop(viewModel: ViewModel, noOfLines: number = 1, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.ViewPortTop, value: noOfLines, select: select });
}

function moveToCenter(viewModel: ViewModel, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.ViewPortCenter, select: select });
}

function moveToBottom(viewModel: ViewModel, noOfLines: number = 1, select?: boolean) {
	move(viewModel, { to: CursorMove.RawDirection.ViewPortBottom, value: noOfLines, select: select });
}

function cursorEqual(viewModel: ViewModel, posLineNumber: number, posColumn: number, selLineNumber: number = posLineNumber, selColumn: number = posColumn) {
	positionEqual(viewModel.getPosition(), posLineNumber, posColumn);
	selectionEqual(viewModel.getSelection(), posLineNumber, posColumn, selLineNumber, selColumn);
}

function positionEqual(position: Position, lineNumber: number, column: number) {
	assert.deepEqual(position, new Position(lineNumber, column), 'position equal');
}

function selectionEqual(selection: Selection, posLineNumber: number, posColumn: number, selLineNumber: number, selColumn: number) {
	assert.deepEqual({
		selectionStartLineNumber: selection.selectionStartLineNumber,
		selectionStartColumn: selection.selectionStartColumn,
		positionLineNumber: selection.positionLineNumber,
		positionColumn: selection.positionColumn
	}, {
		selectionStartLineNumber: selLineNumber,
		selectionStartColumn: selColumn,
		positionLineNumber: posLineNumber,
		positionColumn: posColumn
	}, 'selection equal');
}

function moveTo(viewModel: ViewModel, lineNumber: number, column: number, inSelectionMode: boolean = false) {
	if (inSelectionMode) {
		CoreNavigationCommands.MoveToSelect.runCoreEditorCommand(viewModel, {
			position: new Position(lineNumber, column)
		});
	} else {
		CoreNavigationCommands.MoveTo.runCoreEditorCommand(viewModel, {
			position: new Position(lineNumber, column)
		});
	}
}

function moveToEndOfLine(viewModel: ViewModel, inSelectionMode: boolean = false) {
	if (inSelectionMode) {
		CoreNavigationCommands.CursorEndSelect.runCoreEditorCommand(viewModel, {});
	} else {
		CoreNavigationCommands.CursorEnd.runCoreEditorCommand(viewModel, {});
	}
}
