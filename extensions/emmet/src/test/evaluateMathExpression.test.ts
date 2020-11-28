/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { Position, Selection } from 'vscode';
import { withRandomFileEditor, closeAllEditors } from './testUtils';
import { evaluateMathExpression } from '../evaluateMathExpression';

suite('Tests for Evaluate Math Expression', () => {
	teardown(closeAllEditors);

	function testEvaluateMathExpression(fileContents: string, selection: [number, number] | number, expectedFileContents: string): Thenable<boolean> {
		return withRandomFileEditor(fileContents, 'html', async (editor, _doc) => {
			const selectionToUse = typeof selection === 'number' ?
				new Selection(new Position(0, selection), new Position(0, selection)) :
				new Selection(new Position(0, selection[0]), new Position(0, selection[1]));
			editor.selection = selectionToUse;

			await evaluateMathExpression();

			assert.strictEqual(editor.document.getText(), expectedFileContents);
			return Promise.resolve();
		});
	}

	test('Selected sanity check', () => {
		return testEvaluateMathExpression('1 + 2', [0, 5], '3');
	});

	test('Selected with surrounding text', () => {
		return testEvaluateMathExpression('test1 + 2test', [4, 9], 'test3test');
	});

	test('Selected with number not part of selection', () => {
		return testEvaluateMathExpression('test3 1+2', [6, 9], 'test3 3');
	});

	test('Non-selected sanity check', () => {
		return testEvaluateMathExpression('1 + 2', 5, '3');
	});

	test('Non-selected midway', () => {
		return testEvaluateMathExpression('1 + 2', 1, '1 + 2');
	});

	test('Non-selected with surrounding text', () => {
		return testEvaluateMathExpression('test1 + 3test', 9, 'test4test');
	});
});
