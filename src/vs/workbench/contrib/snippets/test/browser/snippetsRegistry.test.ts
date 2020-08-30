/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getNonWhitespacePrefix } from 'vs/workbench/contrib/snippets/browser/snippetsService';
import { Position } from 'vs/editor/common/core/position';

suite('getNonWhitespacePrefix', () => {

	function assertGetNonWhitespacePrefix(line: string, column: number, expected: string): void {
		let model = {
			getLineContent: (lineNumber: number) => line
		};
		let actual = getNonWhitespacePrefix(model, new Position(1, column));
		assert.equal(actual, expected);
	}

	test('empty line', () => {
		assertGetNonWhitespacePrefix('', 1, '');
	});

	test('singleWordLine', () => {
		assertGetNonWhitespacePrefix('something', 1, '');
		assertGetNonWhitespacePrefix('something', 2, 's');
		assertGetNonWhitespacePrefix('something', 3, 'so');
		assertGetNonWhitespacePrefix('something', 4, 'som');
		assertGetNonWhitespacePrefix('something', 5, 'some');
		assertGetNonWhitespacePrefix('something', 6, 'somet');
		assertGetNonWhitespacePrefix('something', 7, 'someth');
		assertGetNonWhitespacePrefix('something', 8, 'somethi');
		assertGetNonWhitespacePrefix('something', 9, 'somethin');
		assertGetNonWhitespacePrefix('something', 10, 'something');
	});

	test('two word line', () => {
		assertGetNonWhitespacePrefix('something interesting', 1, '');
		assertGetNonWhitespacePrefix('something interesting', 2, 's');
		assertGetNonWhitespacePrefix('something interesting', 3, 'so');
		assertGetNonWhitespacePrefix('something interesting', 4, 'som');
		assertGetNonWhitespacePrefix('something interesting', 5, 'some');
		assertGetNonWhitespacePrefix('something interesting', 6, 'somet');
		assertGetNonWhitespacePrefix('something interesting', 7, 'someth');
		assertGetNonWhitespacePrefix('something interesting', 8, 'somethi');
		assertGetNonWhitespacePrefix('something interesting', 9, 'somethin');
		assertGetNonWhitespacePrefix('something interesting', 10, 'something');
		assertGetNonWhitespacePrefix('something interesting', 11, '');
		assertGetNonWhitespacePrefix('something interesting', 12, 'i');
		assertGetNonWhitespacePrefix('something interesting', 13, 'in');
		assertGetNonWhitespacePrefix('something interesting', 14, 'int');
		assertGetNonWhitespacePrefix('something interesting', 15, 'inte');
		assertGetNonWhitespacePrefix('something interesting', 16, 'inter');
		assertGetNonWhitespacePrefix('something interesting', 17, 'intere');
		assertGetNonWhitespacePrefix('something interesting', 18, 'interes');
		assertGetNonWhitespacePrefix('something interesting', 19, 'interest');
		assertGetNonWhitespacePrefix('something interesting', 20, 'interesti');
		assertGetNonWhitespacePrefix('something interesting', 21, 'interestin');
		assertGetNonWhitespacePrefix('something interesting', 22, 'interesting');
	});

	test('many separators', () => {
		// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions?redirectlocale=en-US&redirectslug=JavaScript%2FGuide%2FRegular_Expressions#special-white-space
		// \s matches a single white space character, including space, tab, form feed, line feed.
		// Equivalent to [ \f\n\r\t\v\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff].

		assertGetNonWhitespacePrefix('something interesting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\tinteresting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\finteresting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\vinteresting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\u00a0interesting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\u2000interesting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\u2028interesting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\u3000interesting', 22, 'interesting');
		assertGetNonWhitespacePrefix('something\ufeffinteresting', 22, 'interesting');

	});
});
