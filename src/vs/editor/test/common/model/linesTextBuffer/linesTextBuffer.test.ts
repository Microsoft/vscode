/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { DefaultEndOfLine } from 'vs/editor/common/model';
import { IValidatedEditOperation, PieceTreeTextBuffer } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer';
import { createTextBufferFactory } from 'vs/editor/common/model/textModel';

suite('PieceTreeTextBuffer._getInverseEdits', () => {

	function editOp(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, text: string[] | null): IValidatedEditOperation {
		return {
			sortIndex: 0,
			identifier: null,
			range: new Range(startLineNumber, startColumn, endLineNumber, endColumn),
			rangeOffset: 0,
			rangeLength: 0,
			text: text ? text.join('\n') : '',
			eolCount: text ? text.length - 1 : 0,
			firstLineLength: text ? text[0].length : 0,
			lastLineLength: text ? text[text.length - 1].length : 0,
			forceMoveMarkers: false,
			isAutoWhitespaceEdit: false
		};
	}

	function inverseEditOp(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): Range {
		return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	function assertInverseEdits(ops: IValidatedEditOperation[], expected: Range[]): void {
		let actual = PieceTreeTextBuffer._getInverseEditRanges(ops);
		assert.deepEqual(actual, expected);
	}

	test('single insert', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello'])
			],
			[
				inverseEditOp(1, 1, 1, 6)
			]
		);
	});

	test('Bug 19872: Undo is funky', () => {
		assertInverseEdits(
			[
				editOp(2, 1, 2, 2, ['']),
				editOp(3, 1, 4, 2, [''])
			],
			[
				inverseEditOp(2, 1, 2, 1),
				inverseEditOp(3, 1, 3, 1)
			]
		);
	});

	test('two single unrelated inserts', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello']),
				editOp(2, 1, 2, 1, ['world'])
			],
			[
				inverseEditOp(1, 1, 1, 6),
				inverseEditOp(2, 1, 2, 6)
			]
		);
	});

	test('two single inserts 1', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello']),
				editOp(1, 2, 1, 2, ['world'])
			],
			[
				inverseEditOp(1, 1, 1, 6),
				inverseEditOp(1, 7, 1, 12)
			]
		);
	});

	test('two single inserts 2', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello']),
				editOp(1, 4, 1, 4, ['world'])
			],
			[
				inverseEditOp(1, 1, 1, 6),
				inverseEditOp(1, 9, 1, 14)
			]
		);
	});

	test('multiline insert', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello', 'world'])
			],
			[
				inverseEditOp(1, 1, 2, 6)
			]
		);
	});

	test('two unrelated multiline inserts', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello', 'world']),
				editOp(2, 1, 2, 1, ['how', 'are', 'you?']),
			],
			[
				inverseEditOp(1, 1, 2, 6),
				inverseEditOp(3, 1, 5, 5),
			]
		);
	});

	test('two multiline inserts 1', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 1, ['hello', 'world']),
				editOp(1, 2, 1, 2, ['how', 'are', 'you?']),
			],
			[
				inverseEditOp(1, 1, 2, 6),
				inverseEditOp(2, 7, 4, 5),
			]
		);
	});

	test('single delete', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 6, null)
			],
			[
				inverseEditOp(1, 1, 1, 1)
			]
		);
	});

	test('two single unrelated deletes', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 6, null),
				editOp(2, 1, 2, 6, null)
			],
			[
				inverseEditOp(1, 1, 1, 1),
				inverseEditOp(2, 1, 2, 1)
			]
		);
	});

	test('two single deletes 1', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 6, null),
				editOp(1, 7, 1, 12, null)
			],
			[
				inverseEditOp(1, 1, 1, 1),
				inverseEditOp(1, 2, 1, 2)
			]
		);
	});

	test('two single deletes 2', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 6, null),
				editOp(1, 9, 1, 14, null)
			],
			[
				inverseEditOp(1, 1, 1, 1),
				inverseEditOp(1, 4, 1, 4)
			]
		);
	});

	test('multiline delete', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 2, 6, null)
			],
			[
				inverseEditOp(1, 1, 1, 1)
			]
		);
	});

	test('two unrelated multiline deletes', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 2, 6, null),
				editOp(3, 1, 5, 5, null),
			],
			[
				inverseEditOp(1, 1, 1, 1),
				inverseEditOp(2, 1, 2, 1),
			]
		);
	});

	test('two multiline deletes 1', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 2, 6, null),
				editOp(2, 7, 4, 5, null),
			],
			[
				inverseEditOp(1, 1, 1, 1),
				inverseEditOp(1, 2, 1, 2),
			]
		);
	});

	test('single replace', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 6, ['Hello world'])
			],
			[
				inverseEditOp(1, 1, 1, 12)
			]
		);
	});

	test('two replaces', () => {
		assertInverseEdits(
			[
				editOp(1, 1, 1, 6, ['Hello world']),
				editOp(1, 7, 1, 8, ['How are you?']),
			],
			[
				inverseEditOp(1, 1, 1, 12),
				inverseEditOp(1, 13, 1, 25)
			]
		);
	});

	test('many edits', () => {
		assertInverseEdits(
			[
				editOp(1, 2, 1, 2, ['', '  ']),
				editOp(1, 5, 1, 6, ['']),
				editOp(1, 9, 1, 9, ['', ''])
			],
			[
				inverseEditOp(1, 2, 2, 3),
				inverseEditOp(2, 6, 2, 6),
				inverseEditOp(2, 9, 3, 1)
			]
		);
	});
});

suite('PieceTreeTextBuffer._toSingleEditOperation', () => {

	function editOp(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, rangeOffset: number, rangeLength: number, text: string[] | null): IValidatedEditOperation {
		return {
			sortIndex: 0,
			identifier: null,
			range: new Range(startLineNumber, startColumn, endLineNumber, endColumn),
			rangeOffset: rangeOffset,
			rangeLength: rangeLength,
			text: text ? text.join('\n') : '',
			eolCount: text ? text.length - 1 : 0,
			firstLineLength: text ? text[0].length : 0,
			lastLineLength: text ? text[text.length - 1].length : 0,
			forceMoveMarkers: false,
			isAutoWhitespaceEdit: false
		};
	}

	function testToSingleEditOperation(original: string[], edits: IValidatedEditOperation[], expected: IValidatedEditOperation): void {
		const textBuffer = <PieceTreeTextBuffer>createTextBufferFactory(original.join('\n')).create(DefaultEndOfLine.LF);

		const actual = textBuffer._toSingleEditOperation(edits);
		assert.deepEqual(actual, expected);
	}

	test('one edit op is unchanged', () => {
		testToSingleEditOperation(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'1'
			],
			[
				editOp(1, 3, 1, 3, 2, 0, [' new line', 'No longer'])
			],
			editOp(1, 3, 1, 3, 2, 0, [' new line', 'No longer'])
		);
	});

	test('two edits on one line', () => {
		testToSingleEditOperation([
			'My First Line',
			'\t\tMy Second Line',
			'    Third Line',
			'',
			'1'
		], [
			editOp(1, 1, 1, 3, 0, 2, ['Your']),
			editOp(1, 4, 1, 4, 3, 0, ['Interesting ']),
			editOp(2, 3, 2, 6, 16, 3, null)
		],
			editOp(1, 1, 2, 6, 0, 19, [
				'Your Interesting First Line',
				'\t\t'
			]));
	});

	test('insert multiple newlines', () => {
		testToSingleEditOperation(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'1'
			],
			[
				editOp(1, 3, 1, 3, 2, 0, ['', '', '', '', '']),
				editOp(3, 15, 3, 15, 45, 0, ['a', 'b'])
			],
			editOp(1, 3, 3, 15, 2, 43, [
				'',
				'',
				'',
				'',
				' First Line',
				'\t\tMy Second Line',
				'    Third Linea',
				'b'
			])
		);
	});

	test('delete empty text', () => {
		testToSingleEditOperation(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'1'
			],
			[
				editOp(1, 1, 1, 1, 0, 0, [''])
			],
			editOp(1, 1, 1, 1, 0, 0, [''])
		);
	});

	test('two unrelated edits', () => {
		testToSingleEditOperation(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			[
				editOp(2, 1, 2, 3, 14, 2, ['\t']),
				editOp(3, 1, 3, 5, 31, 4, [''])
			],
			editOp(2, 1, 3, 5, 14, 21, ['\tMy Second Line', ''])
		);
	});

	test('many edits', () => {
		testToSingleEditOperation(
			[
				'{"x" : 1}'
			],
			[
				editOp(1, 2, 1, 2, 1, 0, ['\n  ']),
				editOp(1, 5, 1, 6, 4, 1, ['']),
				editOp(1, 9, 1, 9, 8, 0, ['\n'])
			],
			editOp(1, 2, 1, 9, 1, 7, [
				'',
				'  "x": 1',
				''
			])
		);
	});

	test('many edits reversed', () => {
		testToSingleEditOperation(
			[
				'{',
				'  "x": 1',
				'}'
			],
			[
				editOp(1, 2, 2, 3, 1, 3, ['']),
				editOp(2, 6, 2, 6, 7, 0, [' ']),
				editOp(2, 9, 3, 1, 10, 1, [''])
			],
			editOp(1, 2, 3, 1, 1, 10, ['"x" : 1'])
		);
	});

	test('replacing newlines 1', () => {
		testToSingleEditOperation(
			[
				'{',
				'"a": true,',
				'',
				'"b": true',
				'}'
			],
			[
				editOp(1, 2, 2, 1, 1, 1, ['', '\t']),
				editOp(2, 11, 4, 1, 12, 2, ['', '\t'])
			],
			editOp(1, 2, 4, 1, 1, 13, [
				'',
				'\t"a": true,',
				'\t'
			])
		);
	});

	test('replacing newlines 2', () => {
		testToSingleEditOperation(
			[
				'some text',
				'some more text',
				'now comes an empty line',
				'',
				'after empty line',
				'and the last line'
			],
			[
				editOp(1, 5, 3, 1, 4, 21, [' text', 'some more text', 'some more text']),
				editOp(3, 2, 4, 1, 26, 23, ['o more lines', 'asd', 'asd', 'asd']),
				editOp(5, 1, 5, 6, 50, 5, ['zzzzzzzz']),
				editOp(5, 11, 6, 16, 60, 22, ['1', '2', '3', '4'])
			],
			editOp(1, 5, 6, 16, 4, 78, [
				' text',
				'some more text',
				'some more textno more lines',
				'asd',
				'asd',
				'asd',
				'zzzzzzzz empt1',
				'2',
				'3',
				'4'
			])
		);
	});

	test('advanced', () => {
		testToSingleEditOperation(
			[
				' {       "d": [',
				'             null',
				'        ] /*comment*/',
				'        ,"e": /*comment*/ [null] }',
			],
			[
				editOp(1, 1, 1, 2, 0, 1, ['']),
				editOp(1, 3, 1, 10, 2, 7, ['', '  ']),
				editOp(1, 16, 2, 14, 15, 14, ['', '    ']),
				editOp(2, 18, 3, 9, 33, 9, ['', '  ']),
				editOp(3, 22, 4, 9, 55, 9, ['']),
				editOp(4, 10, 4, 10, 65, 0, ['', '  ']),
				editOp(4, 28, 4, 28, 83, 0, ['', '    ']),
				editOp(4, 32, 4, 32, 87, 0, ['', '  ']),
				editOp(4, 33, 4, 34, 88, 1, ['', ''])
			],
			editOp(1, 1, 4, 34, 0, 89, [
				'{',
				'  "d": [',
				'    null',
				'  ] /*comment*/,',
				'  "e": /*comment*/ [',
				'    null',
				'  ]',
				''
			])
		);
	});

	test('advanced simplified', () => {
		testToSingleEditOperation(
			[
				'   abc',
				' ,def'
			],
			[
				editOp(1, 1, 1, 4, 0, 3, ['']),
				editOp(1, 7, 2, 2, 6, 2, ['']),
				editOp(2, 3, 2, 3, 9, 0, ['', ''])
			],
			editOp(1, 1, 2, 3, 0, 9, [
				'abc,',
				''
			])
		);
	});
});
