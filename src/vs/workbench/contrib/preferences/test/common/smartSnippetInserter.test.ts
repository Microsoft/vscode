/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SmartSnippetInserter } from 'vs/workbench/contrib/preferences/common/smartSnippetInserter';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { Position } from 'vs/editor/common/core/position';

suite('SmartSnippetInserter', () => {

	function testSmartSnippetInserter(text: string[], runner: (assert: (desiredPos: Position, pos: Position, prepend: string, append: string) => void) => void): void {
		let model = createTextModel(text.join('\n'));
		runner((desiredPos, pos, prepend, append) => {
			let actual = SmartSnippetInserter.insertSnippet(model, desiredPos);
			let expected = {
				position: pos,
				prepend,
				append
			};
			assert.deepStrictEqual(actual, expected);
		});
		model.dispose();
	}

	test('empty text', () => {
		testSmartSnippetInserter([
		], (assert) => {
			assert(new Position(1, 1), new Position(1, 1), '\n[', ']');
		});

		testSmartSnippetInserter([
			' '
		], (assert) => {
			assert(new Position(1, 1), new Position(1, 2), '\n[', ']');
			assert(new Position(1, 2), new Position(1, 2), '\n[', ']');
		});

		testSmartSnippetInserter([
			'// just some text'
		], (assert) => {
			assert(new Position(1, 1), new Position(1, 18), '\n[', ']');
			assert(new Position(1, 18), new Position(1, 18), '\n[', ']');
		});

		testSmartSnippetInserter([
			'// just some text',
			''
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 1), '\n[', ']');
			assert(new Position(1, 18), new Position(2, 1), '\n[', ']');
			assert(new Position(2, 1), new Position(2, 1), '\n[', ']');
		});
	});

	test('empty array 1', () => {
		testSmartSnippetInserter([
			'// just some text',
			'[]'
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 2), '', '');
			assert(new Position(2, 1), new Position(2, 2), '', '');
			assert(new Position(2, 2), new Position(2, 2), '', '');
			assert(new Position(2, 3), new Position(2, 2), '', '');
		});
	});

	test('empty array 2', () => {
		testSmartSnippetInserter([
			'// just some text',
			'[',
			']'
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 2), '', '');
			assert(new Position(2, 1), new Position(2, 2), '', '');
			assert(new Position(2, 2), new Position(2, 2), '', '');
			assert(new Position(3, 1), new Position(3, 1), '', '');
			assert(new Position(3, 2), new Position(3, 1), '', '');
		});
	});

	test('empty array 3', () => {
		testSmartSnippetInserter([
			'// just some text',
			'[',
			'// just some text',
			']'
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 2), '', '');
			assert(new Position(2, 1), new Position(2, 2), '', '');
			assert(new Position(2, 2), new Position(2, 2), '', '');
			assert(new Position(3, 1), new Position(3, 1), '', '');
			assert(new Position(3, 2), new Position(3, 1), '', '');
			assert(new Position(4, 1), new Position(4, 1), '', '');
			assert(new Position(4, 2), new Position(4, 1), '', '');
		});
	});

	test('one element array 1', () => {
		testSmartSnippetInserter([
			'// just some text',
			'[',
			'{}',
			']'
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 2), '', ',');
			assert(new Position(2, 1), new Position(2, 2), '', ',');
			assert(new Position(2, 2), new Position(2, 2), '', ',');
			assert(new Position(3, 1), new Position(3, 1), '', ',');
			assert(new Position(3, 2), new Position(3, 1), '', ',');
			assert(new Position(3, 3), new Position(3, 3), ',', '');
			assert(new Position(4, 1), new Position(4, 1), ',', '');
			assert(new Position(4, 2), new Position(4, 1), ',', '');
		});
	});

	test('two elements array 1', () => {
		testSmartSnippetInserter([
			'// just some text',
			'[',
			'{},',
			'{}',
			']'
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 2), '', ',');
			assert(new Position(2, 1), new Position(2, 2), '', ',');
			assert(new Position(2, 2), new Position(2, 2), '', ',');
			assert(new Position(3, 1), new Position(3, 1), '', ',');
			assert(new Position(3, 2), new Position(3, 1), '', ',');
			assert(new Position(3, 3), new Position(3, 3), ',', '');
			assert(new Position(3, 4), new Position(3, 4), '', ',');
			assert(new Position(4, 1), new Position(4, 1), '', ',');
			assert(new Position(4, 2), new Position(4, 1), '', ',');
			assert(new Position(4, 3), new Position(4, 3), ',', '');
			assert(new Position(5, 1), new Position(5, 1), ',', '');
			assert(new Position(5, 2), new Position(5, 1), ',', '');
		});
	});

	test('two elements array 2', () => {
		testSmartSnippetInserter([
			'// just some text',
			'[',
			'{},{}',
			']'
		], (assert) => {
			assert(new Position(1, 1), new Position(2, 2), '', ',');
			assert(new Position(2, 1), new Position(2, 2), '', ',');
			assert(new Position(2, 2), new Position(2, 2), '', ',');
			assert(new Position(3, 1), new Position(3, 1), '', ',');
			assert(new Position(3, 2), new Position(3, 1), '', ',');
			assert(new Position(3, 3), new Position(3, 3), ',', '');
			assert(new Position(3, 4), new Position(3, 4), '', ',');
			assert(new Position(3, 5), new Position(3, 4), '', ',');
			assert(new Position(3, 6), new Position(3, 6), ',', '');
			assert(new Position(4, 1), new Position(4, 1), ',', '');
			assert(new Position(4, 2), new Position(4, 1), ',', '');
		});
	});

});
