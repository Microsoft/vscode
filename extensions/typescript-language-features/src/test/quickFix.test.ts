/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import { disposeAll } from '../utils/dispose';
import { createTestEditor, joinLines, retryUntilDocumentChanges, wait } from './testUtils';

suite('TypeScript Quick Fix', () => {

	const _disposables: vscode.Disposable[] = [];

	teardown(async () => {
		disposeAll(_disposables);

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('Fix all should not be marked as preferred #97866', async () => {
		const testDocumentUri = vscode.Uri.parse('untitled:test.ts');

		const editor = await createTestEditor(testDocumentUri,
			`export const _ = 1;`,
			`const a$0 = 1;`,
			`const b = 2;`,
		);

		await retryUntilDocumentChanges(testDocumentUri, { retries: 10, timeout: 500 }, _disposables, () => {
			return vscode.commands.executeCommand('editor.action.autoFix');
		});

		assert.strictEqual(editor.document.getText(), joinLines(
			`export const _ = 1;`,
			`const b = 2;`,
		));
	});

	test('Add import should be a preferred fix if there is only one possible import', async () => {
		const testDocumentUri = workspaceFile('foo.ts');

		await createTestEditor(testDocumentUri,
			`export const foo = 1;`);

		const editor = await createTestEditor(workspaceFile('index.ts'),
			`export const _ = 1;`,
			`foo$0;`
		);

		await retryUntilDocumentChanges(testDocumentUri, { retries: 10, timeout: 500 }, _disposables, () => {
			return vscode.commands.executeCommand('editor.action.autoFix');
		});

		// Document should not have been changed here

		assert.strictEqual(editor.document.getText(), joinLines(
			`import { foo } from "./foo";`,
			``,
			`export const _ = 1;`,
			`foo;`
		));
	});

	test('Add import should not be a preferred fix if are multiple possible imports', async () => {
		await createTestEditor(workspaceFile('foo.ts'),
			`export const foo = 1;`);

		await createTestEditor(workspaceFile('bar.ts'),
			`export const foo = 1;`);

		const editor = await createTestEditor(workspaceFile('index.ts'),
			`export const _ = 1;`,
			`foo$0;`
		);

		await wait(3000);

		await vscode.commands.executeCommand('editor.action.autoFix');

		await wait(500);

		assert.strictEqual(editor.document.getText(), joinLines(
			`export const _ = 1;`,
			`foo;`
		));
	});

	test('Only a single ts-ignore should be returned if there are multiple errors on one line #98274', async () => {
		const testDocumentUri = workspaceFile('foojs.js');
		const editor = await createTestEditor(testDocumentUri,
			`//@ts-check`,
			`const a = require('./bla');`);

		await wait(3000);

		const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider',
			testDocumentUri,
			editor.document.lineAt(1).range
		);

		const ignoreFixes = fixes?.filter(x => x.title === 'Ignore this error message');
		assert.strictEqual(ignoreFixes?.length, 1);
	});

	test('Should prioritize implement interface over remove unused #94212', async () => {
		const testDocumentUri = workspaceFile('foo.ts');
		const editor = await createTestEditor(testDocumentUri,
			`export interface IFoo { value: string; }`,
			`class Foo implements IFoo { }`);

		await wait(3000);

		const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider',
			testDocumentUri,
			editor.document.lineAt(1).range
		);

		assert.strictEqual(fixes?.length, 2);
		assert.strictEqual(fixes![0].title, `Implement interface 'IFoo'`);
		assert.strictEqual(fixes![1].title, `Remove unused declaration for: 'Foo'`);
	});

	test('Should prioritize implement abstract class over remove unused #101486', async () => {
		const testDocumentUri = workspaceFile('foo.ts');
		const editor = await createTestEditor(testDocumentUri,
			`export abstract class Foo { abstract foo(): number; }`,
			`class ConcreteFoo extends Foo { }`,
		);

		await wait(3000);

		const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider',
			testDocumentUri,
			editor.document.lineAt(1).range
		);

		assert.strictEqual(fixes?.length, 2);
		assert.strictEqual(fixes![0].title, `Implement inherited abstract class`);
		assert.strictEqual(fixes![1].title, `Remove unused declaration for: 'ConcreteFoo'`);
	});

	test('Add all missing imports should come after other add import fixes #98613', async () => {
		await createTestEditor(workspaceFile('foo.ts'),
			`export const foo = 1;`);

		await createTestEditor(workspaceFile('bar.ts'),
			`export const foo = 1;`);

		const editor = await createTestEditor(workspaceFile('index.ts'),
			`export const _ = 1;`,
			`foo$0;`,
			`foo$0;`
		);

		await wait(3000);

		const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider',
			workspaceFile('index.ts'),
			editor.document.lineAt(1).range
		);

		assert.strictEqual(fixes?.length, 3);
		assert.strictEqual(fixes![0].title, `Import 'foo' from module "./bar"`);
		assert.strictEqual(fixes![1].title, `Import 'foo' from module "./foo"`);
		assert.strictEqual(fixes![2].title, `Add all missing imports`);
	});
});

function workspaceFile(fileName: string) {
	return vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, fileName);
}
