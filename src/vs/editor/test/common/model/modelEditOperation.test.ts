/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

suite('Editor Model - Model Edit Operation', () => {
	const LINE1 = 'My First Line';
	const LINE2 = '\t\tMy Second Line';
	const LINE3 = '    Third Line';
	const LINE4 = '';
	const LINE5 = '1';

	let model: TextModel;

	setup(() => {
		const text =
			LINE1 + '\r\n' +
			LINE2 + '\n' +
			LINE3 + '\n' +
			LINE4 + '\r\n' +
			LINE5;
		model = createTextModel(text);
	});

	teardown(() => {
		model.dispose();
	});

	function createSingleEditOp(text: string, positionLineNumber: number, positionColumn: number, selectionLineNumber: number = positionLineNumber, selectionColumn: number = positionColumn): IIdentifiedSingleEditOperation {
		let range = new Range(
			selectionLineNumber,
			selectionColumn,
			positionLineNumber,
			positionColumn
		);

		return {
			identifier: null,
			range: range,
			text: text,
			forceMoveMarkers: false
		};
	}

	function assertSingleEditOp(singleEditOp: IIdentifiedSingleEditOperation, editedLines: string[]) {
		let editOp = [singleEditOp];

		let inverseEditOp = model.applyEdits(editOp, true);

		assert.equal(model.getLineCount(), editedLines.length);
		for (let i = 0; i < editedLines.length; i++) {
			assert.equal(model.getLineContent(i + 1), editedLines[i]);
		}

		let originalOp = model.applyEdits(inverseEditOp, true);

		assert.equal(model.getLineCount(), 5);
		assert.equal(model.getLineContent(1), LINE1);
		assert.equal(model.getLineContent(2), LINE2);
		assert.equal(model.getLineContent(3), LINE3);
		assert.equal(model.getLineContent(4), LINE4);
		assert.equal(model.getLineContent(5), LINE5);

		const simplifyEdit = (edit: IIdentifiedSingleEditOperation) => {
			return {
				identifier: edit.identifier,
				range: edit.range,
				text: edit.text,
				forceMoveMarkers: edit.forceMoveMarkers || false,
				isAutoWhitespaceEdit: edit.isAutoWhitespaceEdit || false
			};
		};
		assert.deepEqual(originalOp.map(simplifyEdit), editOp.map(simplifyEdit));
	}

	test('Insert inline', () => {
		assertSingleEditOp(
			createSingleEditOp('a', 1, 1),
			[
				'aMy First Line',
				LINE2,
				LINE3,
				LINE4,
				LINE5
			]
		);
	});

	test('Replace inline/inline 1', () => {
		assertSingleEditOp(
			createSingleEditOp(' incredibly awesome', 1, 3),
			[
				'My incredibly awesome First Line',
				LINE2,
				LINE3,
				LINE4,
				LINE5
			]
		);
	});

	test('Replace inline/inline 2', () => {
		assertSingleEditOp(
			createSingleEditOp(' with text at the end.', 1, 14),
			[
				'My First Line with text at the end.',
				LINE2,
				LINE3,
				LINE4,
				LINE5
			]
		);
	});

	test('Replace inline/inline 3', () => {
		assertSingleEditOp(
			createSingleEditOp('My new First Line.', 1, 1, 1, 14),
			[
				'My new First Line.',
				LINE2,
				LINE3,
				LINE4,
				LINE5
			]
		);
	});

	test('Replace inline/multi line 1', () => {
		assertSingleEditOp(
			createSingleEditOp('My new First Line.', 1, 1, 3, 15),
			[
				'My new First Line.',
				LINE4,
				LINE5
			]
		);
	});

	test('Replace inline/multi line 2', () => {
		assertSingleEditOp(
			createSingleEditOp('My new First Line.', 1, 2, 3, 15),
			[
				'MMy new First Line.',
				LINE4,
				LINE5
			]
		);
	});

	test('Replace inline/multi line 3', () => {
		assertSingleEditOp(
			createSingleEditOp('My new First Line.', 1, 2, 3, 2),
			[
				'MMy new First Line.   Third Line',
				LINE4,
				LINE5
			]
		);
	});

	test('Replace muli line/multi line', () => {
		assertSingleEditOp(
			createSingleEditOp('1\n2\n3\n4\n', 1, 1),
			[
				'1',
				'2',
				'3',
				'4',
				LINE1,
				LINE2,
				LINE3,
				LINE4,
				LINE5
			]
		);
	});
});
