/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
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

	function testMatchBracket(electricCharacterSupport: BracketElectricCharacterSupport, line: TokenText[], character: string, offset: number, matchOpenBracket: string): void {
		let actual = _testOnElectricCharacter(electricCharacterSupport, line, character, offset);
		assert.deepEqual(actual, { matchOpenBracket: matchOpenBracket });
	}

	test('getElectricCharacters uses all sources and dedups', () => {
		let sup = new BracketElectricCharacterSupport(
			new RichEditBrackets(fakeLanguageIdentifier, [
				['{', '}'],
				['(', ')']
			])
		);

		assert.deepEqual(sup.getElectricCharacters(), ['}', ')']);
	});

	test('matchOpenBracket', () => {
		let sup = new BracketElectricCharacterSupport(
			new RichEditBrackets(fakeLanguageIdentifier, [
				['{', '}'],
				['(', ')']
			])
		);

		testDoesNothing(sup, [{ text: '\t{', type: StandardTokenType.Other }], '\t', 1);
		testDoesNothing(sup, [{ text: '\t{', type: StandardTokenType.Other }], '\t', 2);
		testDoesNothing(sup, [{ text: '\t\t', type: StandardTokenType.Other }], '{', 3);

		testDoesNothing(sup, [{ text: '\t}', type: StandardTokenType.Other }], '\t', 1);
		testDoesNothing(sup, [{ text: '\t}', type: StandardTokenType.Other }], '\t', 2);
		testMatchBracket(sup, [{ text: '\t\t', type: StandardTokenType.Other }], '}', 3, '}');
	});
});
