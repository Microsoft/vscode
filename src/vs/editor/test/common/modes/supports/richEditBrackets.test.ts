/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { BracketsUtils } from 'vs/editor/common/modes/supports/richEditBrackets';

suite('richEditBrackets', () => {

	function findPrevBracketInRange(reversedBracketRegex: RegExp, lineText: string, currentTokenStart: number, currentTokenEnd: number): Range | null {
		return BracketsUtils.findPrevBracketInRange(reversedBracketRegex, 1, lineText, currentTokenStart, currentTokenEnd);
	}

	function findNextBracketInRange(forwardBracketRegex: RegExp, lineText: string, currentTokenStart: number, currentTokenEnd: number): Range | null {
		return BracketsUtils.findNextBracketInRange(forwardBracketRegex, 1, lineText, currentTokenStart, currentTokenEnd);
	}

	test('findPrevBracketInToken one char 1', () => {
		let result = findPrevBracketInRange(/(\{)|(\})/i, '{', 0, 1);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 2);
	});

	test('findPrevBracketInToken one char 2', () => {
		let result = findPrevBracketInRange(/(\{)|(\})/i, '{{', 0, 1);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 2);
	});

	test('findPrevBracketInToken one char 3', () => {
		let result = findPrevBracketInRange(/(\{)|(\})/i, '{hello world!', 0, 13);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 2);
	});

	test('findPrevBracketInToken more chars 1', () => {
		let result = findPrevBracketInRange(/(olleh)/i, 'hello world!', 0, 12);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 6);
	});

	test('findPrevBracketInToken more chars 2', () => {
		let result = findPrevBracketInRange(/(olleh)/i, 'hello world!', 0, 5);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 6);
	});

	test('findPrevBracketInToken more chars 3', () => {
		let result = findPrevBracketInRange(/(olleh)/i, ' hello world!', 0, 6);
		assert.equal(result!.startColumn, 2);
		assert.equal(result!.endColumn, 7);
	});

	test('findNextBracketInToken one char', () => {
		let result = findNextBracketInRange(/(\{)|(\})/i, '{', 0, 1);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 2);
	});

	test('findNextBracketInToken more chars', () => {
		let result = findNextBracketInRange(/(world)/i, 'hello world!', 0, 12);
		assert.equal(result!.startColumn, 7);
		assert.equal(result!.endColumn, 12);
	});

	test('findNextBracketInToken with emoty result', () => {
		let result = findNextBracketInRange(/(\{)|(\})/i, '', 0, 0);
		assert.equal(result, null);
	});

	test('issue #3894: [Handlebars] Curly braces edit issues', () => {
		let result = findPrevBracketInRange(/(\-\-!<)|(>\-\-)|(\{\{)|(\}\})/i, '{{asd}}', 0, 2);
		assert.equal(result!.startColumn, 1);
		assert.equal(result!.endColumn, 3);
	});

});
