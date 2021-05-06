/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import MDDocumentSymbolProvider from '../features/documentSymbolProvider';
import MarkdownWorkspaceSymbolProvider, { WorkspaceMarkdownDocumentProvider } from '../features/workspaceSymbolProvider';
import { createNewMarkdownEngine } from './engine';
import { InMemoryDocument } from './inMemoryDocument';


const symbolProvider = new MDDocumentSymbolProvider(createNewMarkdownEngine());

suite('markdown.WorkspaceSymbolProvider', () => {
	test('Should not return anything for empty workspace', async () => {
		const provider = new MarkdownWorkspaceSymbolProvider(symbolProvider, new InMemoryWorkspaceMarkdownDocumentProvider([]));

		assert.deepStrictEqual(await provider.provideWorkspaceSymbols(''), []);
	});

	test('Should return symbols from workspace with one markdown file', async () => {
		const testFileName = vscode.Uri.file('test.md');

		const provider = new MarkdownWorkspaceSymbolProvider(symbolProvider, new InMemoryWorkspaceMarkdownDocumentProvider([
			new InMemoryDocument(testFileName, `# header1\nabc\n## header2`)
		]));

		const symbols = await provider.provideWorkspaceSymbols('');
		assert.strictEqual(symbols.length, 2);
		assert.strictEqual(symbols[0].name, '# header1');
		assert.strictEqual(symbols[1].name, '## header2');
	});

	test('Should return all content  basic workspace', async () => {
		const fileNameCount = 10;
		const files: vscode.TextDocument[] = [];
		for (let i = 0; i < fileNameCount; ++i) {
			const testFileName = vscode.Uri.file(`test${i}.md`);
			files.push(new InMemoryDocument(testFileName, `# common\nabc\n## header${i}`));
		}

		const provider = new MarkdownWorkspaceSymbolProvider(symbolProvider, new InMemoryWorkspaceMarkdownDocumentProvider(files));

		const symbols = await provider.provideWorkspaceSymbols('');
		assert.strictEqual(symbols.length, fileNameCount * 2);
	});

	test('Should update results when markdown file changes symbols', async () => {
		const testFileName = vscode.Uri.file('test.md');

		const workspaceFileProvider = new InMemoryWorkspaceMarkdownDocumentProvider([
			new InMemoryDocument(testFileName, `# header1`, 1 /* version */)
		]);

		const provider = new MarkdownWorkspaceSymbolProvider(symbolProvider, workspaceFileProvider);

		assert.strictEqual((await provider.provideWorkspaceSymbols('')).length, 1);

		// Update file
		workspaceFileProvider.updateDocument(new InMemoryDocument(testFileName, `# new header\nabc\n## header2`, 2 /* version */));
		const newSymbols = await provider.provideWorkspaceSymbols('');
		assert.strictEqual(newSymbols.length, 2);
		assert.strictEqual(newSymbols[0].name, '# new header');
		assert.strictEqual(newSymbols[1].name, '## header2');
	});

	test('Should remove results when file is deleted', async () => {
		const testFileName = vscode.Uri.file('test.md');

		const workspaceFileProvider = new InMemoryWorkspaceMarkdownDocumentProvider([
			new InMemoryDocument(testFileName, `# header1`)
		]);

		const provider = new MarkdownWorkspaceSymbolProvider(symbolProvider, workspaceFileProvider);
		assert.strictEqual((await provider.provideWorkspaceSymbols('')).length, 1);

		// delete file
		workspaceFileProvider.deleteDocument(testFileName);
		const newSymbols = await provider.provideWorkspaceSymbols('');
		assert.strictEqual(newSymbols.length, 0);
	});

	test('Should update results when markdown file is created', async () => {
		const testFileName = vscode.Uri.file('test.md');

		const workspaceFileProvider = new InMemoryWorkspaceMarkdownDocumentProvider([
			new InMemoryDocument(testFileName, `# header1`)
		]);

		const provider = new MarkdownWorkspaceSymbolProvider(symbolProvider, workspaceFileProvider);
		assert.strictEqual((await provider.provideWorkspaceSymbols('')).length, 1);

		// Creat file
		workspaceFileProvider.createDocument(new InMemoryDocument(vscode.Uri.file('test2.md'), `# new header\nabc\n## header2`));
		const newSymbols = await provider.provideWorkspaceSymbols('');
		assert.strictEqual(newSymbols.length, 3);
	});
});


class InMemoryWorkspaceMarkdownDocumentProvider implements WorkspaceMarkdownDocumentProvider {
	private readonly _documents = new Map<string, vscode.TextDocument>();

	constructor(documents: vscode.TextDocument[]) {
		for (const doc of documents) {
			this._documents.set(doc.fileName, doc);
		}
	}

	async getAllMarkdownDocuments() {
		return Array.from(this._documents.values());
	}

	private readonly _onDidChangeMarkdownDocumentEmitter = new vscode.EventEmitter<vscode.TextDocument>();
	public onDidChangeMarkdownDocument = this._onDidChangeMarkdownDocumentEmitter.event;

	private readonly _onDidCreateMarkdownDocumentEmitter = new vscode.EventEmitter<vscode.TextDocument>();
	public onDidCreateMarkdownDocument = this._onDidCreateMarkdownDocumentEmitter.event;

	private readonly _onDidDeleteMarkdownDocumentEmitter = new vscode.EventEmitter<vscode.Uri>();
	public onDidDeleteMarkdownDocument = this._onDidDeleteMarkdownDocumentEmitter.event;

	public updateDocument(document: vscode.TextDocument) {
		this._documents.set(document.fileName, document);
		this._onDidChangeMarkdownDocumentEmitter.fire(document);
	}

	public createDocument(document: vscode.TextDocument) {
		assert.ok(!this._documents.has(document.uri.fsPath));

		this._documents.set(document.uri.fsPath, document);
		this._onDidCreateMarkdownDocumentEmitter.fire(document);
	}

	public deleteDocument(resource: vscode.Uri) {
		this._documents.delete(resource.fsPath);
		this._onDidDeleteMarkdownDocumentEmitter.fire(resource);
	}
}
