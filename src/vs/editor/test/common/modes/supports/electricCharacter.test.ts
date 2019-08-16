/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { LanguageIdentifier, StandardTokenType } from 'vs/editor/common/modes';
import { BracketElectricCharacterSupport, IElectricAction } from 'vs/editor/common/modes/supports/electricCharacter';
import { RichEditBrackets } from 'vs/editor/common/modes/supports/richEditBrackets';
import { TokenText, createFakeScopedLineTokens } from 'vs/editor/test/common/modesTestUtils';

const fakeLanguageIdentifier = new LanguageIdentifier('test', 3);

suite('Editor Modes - Auto Indentation', () => {
	function _testOnElectricCharacter(electricCharacterSupport: BracketElectricCharacterSupport, line: TokenText[], character: string, offset: number): IElectricAction | null {
		return electricCharacterSupport.onElectricCharacter(character, createFakeScopedLineTokens(line), offset);
	}

	function testDoesNothing(electricCharacterSupport: BracketElectricCharacterSupport, line: TokenText[], character: string, offset: number): void {
		let actual = _testOnElectricCharacter(electricCharacterSupport, line, character, offset);
		assert.deepEqual(actual, null);
	}

	function testAppendsAfterOpen(electricCharacterSupport: BracketElectricCharacterSupport, line: TokenText[], character: string, offset: number, appendText: string, matchOpenText: string): void {
		let actual = _testOnElectricCharacter(electricCharacterSupport, line, character, offset);
		assert.deepEqual(actual, { appendText: appendText, matchOpenText: matchOpenText });
	}

	function testMatchBracket(electricCharacterSupport: BracketElectricCharacterSupport, line: TokenText[], character: string, offset: number, matchOpenBracket: string): void {
		let actual = _testOnElectricCharacter(electricCharacterSupport, line, character, offset);
		assert.deepEqual(actual, { matchOpenBracket: matchOpenBracket });
	}

	test('Doc comments', () => {
		let brackets = new BracketElectricCharacterSupport(null, [{ open: '/**', close: ' */' }], null);

		testAppendsAfterOpen(brackets, [
			{ text: '/*', type: StandardTokenType.Other },
		], '*', 3, ' */', '/**');

		testDoesNothing(brackets, [
			{ text: '/*', type: StandardTokenType.Other },
			{ text: ' ', type: StandardTokenType.Other },
			{ text: '*/', type: StandardTokenType.Other },
		], '*', 3);
	});

	test('getElectricCharacters uses all sources and dedups', () => {
		let sup = new BracketElectricCharacterSupport(
			new RichEditBrackets(fakeLanguageIdentifier, [
				['{', '}'],
				['(', ')']
			]), [
				{ open: '{', close: '}', notIn: ['string', 'comment'] },
				{ open: '"', close: '"', notIn: ['string', 'comment'] },
				{ open: 'begin', close: 'end', notIn: ['string'] }
			],
			{ docComment: { open: '/**', close: ' */' } }
		);

		assert.deepEqual(sup.getElectricCharacters(), ['}', ')', 'n', '*']);
	});

	test('auto-close', () => {
		let sup = new BracketElectricCharacterSupport(
			new RichEditBrackets(fakeLanguageIdentifier, [
				['{', '}'],
				['(', ')']
			]), [
				{ open: '{', close: '}', notIn: ['string', 'comment'] },
				{ open: '"', close: '"', notIn: ['string', 'comment'] },
				{ open: 'begin', close: 'end', notIn: ['string'] }
			],
			{ docComment: { open: '/**', close: ' */' } }
		);

		testDoesNothing(sup, [], 'a', 0);

		testDoesNothing(sup, [{ text: 'egi', type: StandardTokenType.Other }], 'b', 1);
		testDoesNothing(sup, [{ text: 'bgi', type: StandardTokenType.Other }], 'e', 2);
		testDoesNothing(sup, [{ text: 'bei', type: StandardTokenType.Other }], 'g', 3);
		testDoesNothing(sup, [{ text: 'beg', type: StandardTokenType.Other }], 'i', 4);

		testDoesNothing(sup, [{ text: 'egin', type: StandardTokenType.Other }], 'b', 1);
		testDoesNothing(sup, [{ text: 'bgin', type: StandardTokenType.Other }], 'e', 2);
		testDoesNothing(sup, [{ text: 'bein', type: StandardTokenType.Other }], 'g', 3);
		testDoesNothing(sup, [{ text: 'begn', type: StandardTokenType.Other }], 'i', 4);
		testAppendsAfterOpen(sup, [{ text: 'begi', type: StandardTokenType.Other }], 'n', 5, 'end', 'begin');

		testDoesNothing(sup, [{ text: '3gin', type: StandardTokenType.Other }], 'b', 1);
		testDoesNothing(sup, [{ text: 'bgin', type: StandardTokenType.Other }], '3', 2);
		testDoesNothing(sup, [{ text: 'b3in', type: StandardTokenType.Other }], 'g', 3);
		testDoesNothing(sup, [{ text: 'b3gn', type: StandardTokenType.Other }], 'i', 4);
		testDoesNothing(sup, [{ text: 'b3gi', type: StandardTokenType.Other }], 'n', 5);

		testDoesNothing(sup, [{ text: 'begi', type: StandardTokenType.String }], 'n', 5);

		testAppendsAfterOpen(sup, [{ text: '"', type: StandardTokenType.String }, { text: 'begi', type: StandardTokenType.Other }], 'n', 6, 'end', 'begin');
		testDoesNothing(sup, [{ text: '"', type: StandardTokenType.String }, { text: 'begi', type: StandardTokenType.String }], 'n', 6);

		testAppendsAfterOpen(sup, [{ text: '/*', type: StandardTokenType.String }], '*', 3, ' */', '/**');

		testDoesNothing(sup, [{ text: 'begi', type: StandardTokenType.Other }, { text: 'end', type: StandardTokenType.Other }], 'n', 5);
	});

	test('matchOpenBracket', () => {
		let sup = new BracketElectricCharacterSupport(
			new RichEditBrackets(fakeLanguageIdentifier, [
				['{', '}'],
				['(', ')']
			]), [
				{ open: '{', close: '}', notIn: ['string', 'comment'] },
				{ open: '"', close: '"', notIn: ['string', 'comment'] },
				{ open: 'begin', close: 'end', notIn: ['string'] }
			],
			{ docComment: { open: '/**', close: ' */' } }
		);

		testDoesNothing(sup, [{ text: '\t{', type: StandardTokenType.Other }], '\t', 1);
		testDoesNothing(sup, [{ text: '\t{', type: StandardTokenType.Other }], '\t', 2);
		testDoesNothing(sup, [{ text: '\t\t', type: StandardTokenType.Other }], '{', 3);

		testDoesNothing(sup, [{ text: '\t}', type: StandardTokenType.Other }], '\t', 1);
		testDoesNothing(sup, [{ text: '\t}', type: StandardTokenType.Other }], '\t', 2);
		testMatchBracket(sup, [{ text: '\t\t', type: StandardTokenType.Other }], '}', 3, '}');
	});
});
