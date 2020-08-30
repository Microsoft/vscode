/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import 'mocha';

import MarkdownFoldingProvider from '../features/foldingProvider';
import { InMemoryDocument } from './inMemoryDocument';
import { createNewMarkdownEngine } from './engine';

const testFileName = vscode.Uri.file('test.md');

suite('markdown.FoldingProvider', () => {
	test('Should not return anything for empty document', async () => {
		const folds = await getFoldsForDocument(``);
		assert.strictEqual(folds.length, 0);
	});

	test('Should not return anything for document without headers', async () => {
		const folds = await getFoldsForDocument(`a
**b** afas
a#b
a`);
		assert.strictEqual(folds.length, 0);
	});

	test('Should fold from header to end of document', async () => {
		const folds = await getFoldsForDocument(`a
# b
c
d`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 3);
	});

	test('Should leave single newline before next header', async () => {
		const folds = await getFoldsForDocument(`
# a
x

# b
y`);
		assert.strictEqual(folds.length, 2);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 3);
	});

	test('Should collapse multuple newlines to single newline before next header', async () => {
		const folds = await getFoldsForDocument(`
# a
x



# b
y`);
		assert.strictEqual(folds.length, 2);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 5);
	});

	test('Should not collapse if there is no newline before next header', async () => {
		const folds = await getFoldsForDocument(`
# a
x
# b
y`);
		assert.strictEqual(folds.length, 2);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 2);
	});

	test('Should fold nested <!-- #region --> markers', async () => {
		const folds = await getFoldsForDocument(`a
<!-- #region -->
b
<!-- #region hello!-->
b.a
<!-- #endregion -->
b
<!-- #region: foo! -->
b.b
<!-- #endregion: foo -->
b
<!-- #endregion -->
a`);
		assert.strictEqual(folds.length, 3);
		const [outer, first, second] = folds.sort((a, b) => a.start - b.start);

		assert.strictEqual(outer.start, 1);
		assert.strictEqual(outer.end, 11);
		assert.strictEqual(first.start, 3);
		assert.strictEqual(first.end, 5);
		assert.strictEqual(second.start, 7);
		assert.strictEqual(second.end, 9);
	});

	test('Should fold from list to end of document', async () => {
		const folds = await getFoldsForDocument(`a
- b
c
d`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 3);
	});

	test('lists folds should span multiple lines of content', async () => {
		const folds = await getFoldsForDocument(`a
- This list item\n  spans multiple\n  lines.`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 3);
	});

	test('List should leave single blankline before new element', async () => {
		const folds = await getFoldsForDocument(`- a
a


b`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 0);
		assert.strictEqual(firstFold.end, 3);
	});

	test('Should fold fenced code blocks', async () => {
		const folds = await getFoldsForDocument(`~~~ts
a
~~~
b`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 0);
		assert.strictEqual(firstFold.end, 2);
	});

	test('Should fold fenced code blocks with yaml front matter', async () => {
		const folds = await getFoldsForDocument(`---
title: bla
---

~~~ts
a
~~~

a
a
b
a`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 4);
		assert.strictEqual(firstFold.end, 6);
	});

	test('Should fold html blocks', async () => {
		const folds = await getFoldsForDocument(`x
<div>
	fa
</div>`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 3);
	});

	test('Should fold html block comments', async () => {
		const folds = await getFoldsForDocument(`x
<!--
fa
-->`);
		assert.strictEqual(folds.length, 1);
		const firstFold = folds[0];
		assert.strictEqual(firstFold.start, 1);
		assert.strictEqual(firstFold.end, 3);
		assert.strictEqual(firstFold.kind, vscode.FoldingRangeKind.Comment);
	});
});


async function getFoldsForDocument(contents: string) {
	const doc = new InMemoryDocument(testFileName, contents);
	const provider = new MarkdownFoldingProvider(createNewMarkdownEngine());
	return await provider.provideFoldingRanges(doc, {}, new vscode.CancellationTokenSource().token);
}
