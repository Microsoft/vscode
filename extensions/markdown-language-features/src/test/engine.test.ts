/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import 'mocha';

import { InMemoryDocument } from './inMemoryDocument';
import { createNewMarkdownEngine } from './engine';

const testFileName = vscode.Uri.file('test.md');

suite('markdown.engine', () => {
	suite('rendering', () => {
		const input = '# hello\n\nworld!';
		const output = '<h1 id="hello" data-line="0" class="code-line">hello</h1>\n'
			+ '<p data-line="2" class="code-line">world!</p>\n';

		test('Renders a document', async () => {
			const doc = new InMemoryDocument(testFileName, input);
			const engine = createNewMarkdownEngine();
			assert.strictEqual(await engine.render(doc), output);
		});

		test('Renders a string', async () => {
			const engine = createNewMarkdownEngine();
			assert.strictEqual(await engine.render(input), output);
		});
	});
});
