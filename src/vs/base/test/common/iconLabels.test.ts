/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IMatch } from 'vs/base/common/filters';
import { matchesFuzzyIconAware, parseLabelWithIcons, IParsedLabelWithIcons, stripIcons, escapeIcons, markdownEscapeEscapedIcons } from 'vs/base/common/iconLabels';

export interface IIconFilter {
	// Returns null if word doesn't match.
	(query: string, target: IParsedLabelWithIcons): IMatch[] | null;
}

function filterOk(filter: IIconFilter, word: string, target: IParsedLabelWithIcons, highlights?: { start: number; end: number; }[]) {
	let r = filter(word, target);
	assert(r);
	if (highlights) {
		assert.deepStrictEqual(r, highlights);
	}
}

suite('Icon Labels', () => {
	test('matchesFuzzyIconAware', () => {

		// Camel Case

		filterOk(matchesFuzzyIconAware, 'ccr', parseLabelWithIcons('$(codicon)CamelCaseRocks$(codicon)'), [
			{ start: 10, end: 11 },
			{ start: 15, end: 16 },
			{ start: 19, end: 20 }
		]);

		filterOk(matchesFuzzyIconAware, 'ccr', parseLabelWithIcons('$(codicon) CamelCaseRocks $(codicon)'), [
			{ start: 11, end: 12 },
			{ start: 16, end: 17 },
			{ start: 20, end: 21 }
		]);

		filterOk(matchesFuzzyIconAware, 'iut', parseLabelWithIcons('$(codicon) Indent $(octico) Using $(octic) Tpaces'), [
			{ start: 11, end: 12 },
			{ start: 28, end: 29 },
			{ start: 43, end: 44 },
		]);

		// Prefix

		filterOk(matchesFuzzyIconAware, 'using', parseLabelWithIcons('$(codicon) Indent Using Spaces'), [
			{ start: 18, end: 23 },
		]);

		// Broken Codicon

		filterOk(matchesFuzzyIconAware, 'codicon', parseLabelWithIcons('This $(codicon Indent Using Spaces'), [
			{ start: 7, end: 14 },
		]);

		filterOk(matchesFuzzyIconAware, 'indent', parseLabelWithIcons('This $codicon Indent Using Spaces'), [
			{ start: 14, end: 20 },
		]);

		// Testing #59343
		filterOk(matchesFuzzyIconAware, 'unt', parseLabelWithIcons('$(primitive-dot) $(file-text) Untitled-1'), [
			{ start: 30, end: 33 },
		]);
	});

	test('stripIcons', () => {
		assert.strictEqual(stripIcons('Hello World'), 'Hello World');
		assert.strictEqual(stripIcons('$(Hello World'), '$(Hello World');
		assert.strictEqual(stripIcons('$(Hello) World'), ' World');
		assert.strictEqual(stripIcons('$(Hello) W$(oi)rld'), ' Wrld');
	});


	test('escapeIcons', () => {
		assert.strictEqual(escapeIcons('Hello World'), 'Hello World');
		assert.strictEqual(escapeIcons('$(Hello World'), '$(Hello World');
		assert.strictEqual(escapeIcons('$(Hello) World'), '\\$(Hello) World');
		assert.strictEqual(escapeIcons('\\$(Hello) W$(oi)rld'), '\\$(Hello) W\\$(oi)rld');
	});

	test('markdownEscapeEscapedIcons', () => {
		assert.strictEqual(markdownEscapeEscapedIcons('Hello World'), 'Hello World');
		assert.strictEqual(markdownEscapeEscapedIcons('$(Hello) World'), '$(Hello) World');
		assert.strictEqual(markdownEscapeEscapedIcons('\\$(Hello) World'), '\\\\$(Hello) World');
	});
});
