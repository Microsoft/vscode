/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import { tagsMarkdownPreview, markdownDocumentation } from '../utils/previewer';

suite('typescript.previewer', () => {
	test('Should ignore hyphens after a param tag', async () => {
		assert.strictEqual(
			tagsMarkdownPreview([
				{
					name: 'param',
					text: 'a - b'
				}
			]),
			'*@param* `a` — b');
	});

	test('Should parse url jsdoc @link', async () => {
		assert.strictEqual(
			markdownDocumentation('x {@link http://www.example.com/foo} y {@link https://api.jquery.com/bind/#bind-eventType-eventData-handler} z', []).value,
			'x [http://www.example.com/foo](http://www.example.com/foo) y [https://api.jquery.com/bind/#bind-eventType-eventData-handler](https://api.jquery.com/bind/#bind-eventType-eventData-handler) z');
	});

	test('Should parse url jsdoc @link with text', async () => {
		assert.strictEqual(
			markdownDocumentation('x {@link http://www.example.com/foo abc xyz} y {@link http://www.example.com/bar|b a z} z', []).value,
			'x [abc xyz](http://www.example.com/foo) y [b a z](http://www.example.com/bar) z');
	});

	test('Should treat @linkcode jsdocs links as monospace', async () => {
		assert.strictEqual(
			markdownDocumentation('x {@linkcode http://www.example.com/foo} y {@linkplain http://www.example.com/bar} z', []).value,
			'x [`http://www.example.com/foo`](http://www.example.com/foo) y [http://www.example.com/bar](http://www.example.com/bar) z');
	});

	test('Should parse url jsdoc @link in param tag', async () => {
		assert.strictEqual(
			tagsMarkdownPreview([
				{
					name: 'param',
					text: 'a x {@link http://www.example.com/foo abc xyz} y {@link http://www.example.com/bar|b a z} z'
				}
			]),
			'*@param* `a` — x [abc xyz](http://www.example.com/foo) y [b a z](http://www.example.com/bar) z');
	});

	test('Should ignore unclosed jsdocs @link', async () => {
		assert.strictEqual(
			markdownDocumentation('x {@link http://www.example.com/foo y {@link http://www.example.com/bar bar} z', []).value,
			'x {@link http://www.example.com/foo y [bar](http://www.example.com/bar) z');
	});

	test('Should support non-ascii characters in parameter name (#90108)', async () => {
		assert.strictEqual(
			tagsMarkdownPreview([
				{
					name: 'param',
					text: 'parámetroConDiacríticos this will not'
				}
			]),
			'*@param* `parámetroConDiacríticos` — this will not');
	});
});

