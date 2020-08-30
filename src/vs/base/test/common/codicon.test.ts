/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IMatch } from 'vs/base/common/filters';
import { matchesFuzzyCodiconAware, parseCodicons, IParsedCodicons } from 'vs/base/common/codicon';
import { stripCodicons } from 'vs/base/common/codicons';

export interface ICodiconFilter {
	// Returns null if word doesn't match.
	(query: string, target: IParsedCodicons): IMatch[] | null;
}

function filterOk(filter: ICodiconFilter, word: string, target: IParsedCodicons, highlights?: { start: number; end: number; }[]) {
	let r = filter(word, target);
	assert(r);
	if (highlights) {
		assert.deepEqual(r, highlights);
	}
}

suite('Codicon', () => {
	test('matchesFuzzzyCodiconAware', () => {

		// Camel Case

		filterOk(matchesFuzzyCodiconAware, 'ccr', parseCodicons('$(codicon)CamelCaseRocks$(codicon)'), [
			{ start: 10, end: 11 },
			{ start: 15, end: 16 },
			{ start: 19, end: 20 }
		]);

		filterOk(matchesFuzzyCodiconAware, 'ccr', parseCodicons('$(codicon) CamelCaseRocks $(codicon)'), [
			{ start: 11, end: 12 },
			{ start: 16, end: 17 },
			{ start: 20, end: 21 }
		]);

		filterOk(matchesFuzzyCodiconAware, 'iut', parseCodicons('$(codicon) Indent $(octico) Using $(octic) Tpaces'), [
			{ start: 11, end: 12 },
			{ start: 28, end: 29 },
			{ start: 43, end: 44 },
		]);

		// Prefix

		filterOk(matchesFuzzyCodiconAware, 'using', parseCodicons('$(codicon) Indent Using Spaces'), [
			{ start: 18, end: 23 },
		]);

		// Broken Codicon

		filterOk(matchesFuzzyCodiconAware, 'codicon', parseCodicons('This $(codicon Indent Using Spaces'), [
			{ start: 7, end: 14 },
		]);

		filterOk(matchesFuzzyCodiconAware, 'indent', parseCodicons('This $codicon Indent Using Spaces'), [
			{ start: 14, end: 20 },
		]);

		// Testing #59343
		filterOk(matchesFuzzyCodiconAware, 'unt', parseCodicons('$(primitive-dot) $(file-text) Untitled-1'), [
			{ start: 30, end: 33 },
		]);
	});
});

suite('Codicons', () => {

	test('stripCodicons', () => {
		assert.equal(stripCodicons('Hello World'), 'Hello World');
		assert.equal(stripCodicons('$(Hello World'), '$(Hello World');
		assert.equal(stripCodicons('$(Hello) World'), ' World');
		assert.equal(stripCodicons('$(Hello) W$(oi)rld'), ' Wrld');
	});
});
