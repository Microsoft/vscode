/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';

suite('HighlightedLabel', () => {
	let label: HighlightedLabel;

	setup(() => {
		label = new HighlightedLabel(document.createElement('div'), true);
	});

	test('empty label', function () {
		assert.equal(label.element.innerHTML, '');
	});

	test('no decorations', function () {
		label.set('hello');
		assert.equal(label.element.innerHTML, '<span>hello</span>');
	});

	test('escape html', function () {
		label.set('hel<lo');
		assert.equal(label.element.innerHTML, '<span>hel&lt;lo</span>');
	});

	test('everything highlighted', function () {
		label.set('hello', [{ start: 0, end: 5 }]);
		assert.equal(label.element.innerHTML, '<span class="highlight">hello</span>');
	});

	test('beginning highlighted', function () {
		label.set('hellothere', [{ start: 0, end: 5 }]);
		assert.equal(label.element.innerHTML, '<span class="highlight">hello</span><span>there</span>');
	});

	test('ending highlighted', function () {
		label.set('goodbye', [{ start: 4, end: 7 }]);
		assert.equal(label.element.innerHTML, '<span>good</span><span class="highlight">bye</span>');
	});

	test('middle highlighted', function () {
		label.set('foobarfoo', [{ start: 3, end: 6 }]);
		assert.equal(label.element.innerHTML, '<span>foo</span><span class="highlight">bar</span><span>foo</span>');
	});

	test('escapeNewLines', () => {

		let highlights = [{ start: 0, end: 5 }, { start: 7, end: 9 }, { start: 11, end: 12 }];// before,after,after
		let escaped = HighlightedLabel.escapeNewLines('ACTION\r\n_TYPE2', highlights);
		assert.equal(escaped, 'ACTION\u23CE_TYPE2');
		assert.deepEqual(highlights, [{ start: 0, end: 5 }, { start: 6, end: 8 }, { start: 10, end: 11 }]);

		highlights = [{ start: 5, end: 9 }, { start: 11, end: 12 }];//overlap,after
		escaped = HighlightedLabel.escapeNewLines('ACTION\r\n_TYPE2', highlights);
		assert.equal(escaped, 'ACTION\u23CE_TYPE2');
		assert.deepEqual(highlights, [{ start: 5, end: 8 }, { start: 10, end: 11 }]);

	});
});
