/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { getSelectionSearchString } from 'vs/editor/contrib/find/findController';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';


suite('Find', () => {

	test('search string at position', () => {
		withTestCodeEditor([
			'ABC DEF',
			'0123 456'
		], {}, (editor) => {

			// The cursor is at the very top, of the file, at the first ABC
			let searchStringAtTop = getSelectionSearchString(editor);
			assert.equal(searchStringAtTop, 'ABC');

			// Move cursor to the end of ABC
			editor.setPosition(new Position(1, 3));
			let searchStringAfterABC = getSelectionSearchString(editor);
			assert.equal(searchStringAfterABC, 'ABC');

			// Move cursor to DEF
			editor.setPosition(new Position(1, 5));
			let searchStringInsideDEF = getSelectionSearchString(editor);
			assert.equal(searchStringInsideDEF, 'DEF');

		});
	});

	test('search string with selection', () => {
		withTestCodeEditor([
			'ABC DEF',
			'0123 456'
		], {}, (editor) => {

			// Select A of ABC
			editor.setSelection(new Range(1, 1, 1, 2));
			let searchStringSelectionA = getSelectionSearchString(editor);
			assert.equal(searchStringSelectionA, 'A');

			// Select BC of ABC
			editor.setSelection(new Range(1, 2, 1, 4));
			let searchStringSelectionBC = getSelectionSearchString(editor);
			assert.equal(searchStringSelectionBC, 'BC');

			// Select BC DE
			editor.setSelection(new Range(1, 2, 1, 7));
			let searchStringSelectionBCDE = getSelectionSearchString(editor);
			assert.equal(searchStringSelectionBCDE, 'BC DE');

		});
	});

	test('search string with multiline selection', () => {
		withTestCodeEditor([
			'ABC DEF',
			'0123 456'
		], {}, (editor) => {

			// Select first line and newline
			editor.setSelection(new Range(1, 1, 2, 1));
			let searchStringSelectionWholeLine = getSelectionSearchString(editor);
			assert.equal(searchStringSelectionWholeLine, null);

			// Select first line and chunk of second
			editor.setSelection(new Range(1, 1, 2, 4));
			let searchStringSelectionTwoLines = getSelectionSearchString(editor);
			assert.equal(searchStringSelectionTwoLines, null);

			// Select end of first line newline and chunk of second
			editor.setSelection(new Range(1, 7, 2, 4));
			let searchStringSelectionSpanLines = getSelectionSearchString(editor);
			assert.equal(searchStringSelectionSpanLines, null);

		});
	});

});
