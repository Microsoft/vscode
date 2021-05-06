/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as utils from '../utils';

suite('Notebook Document', function () {

	const simpleContentProvider = new class implements vscode.NotebookSerializer {
		deserializeNotebook(_data: Uint8Array): vscode.NotebookData | Thenable<vscode.NotebookData> {
			return new vscode.NotebookData(
				[new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '// SIMPLE', 'javascript')],
				new vscode.NotebookDocumentMetadata()
			);
		}
		serializeNotebook(_data: vscode.NotebookData): Uint8Array | Thenable<Uint8Array> {
			return new Uint8Array();
		}
	};

	const complexContentProvider = new class implements vscode.NotebookContentProvider {
		async openNotebook(uri: vscode.Uri, _openContext: vscode.NotebookDocumentOpenContext): Promise<vscode.NotebookData> {
			return new vscode.NotebookData(
				[new vscode.NotebookCellData(vscode.NotebookCellKind.Code, uri.toString(), 'javascript')],
				new vscode.NotebookDocumentMetadata()
			);
		}
		async saveNotebook(_document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken) {
			//
		}
		async saveNotebookAs(_targetResource: vscode.Uri, _document: vscode.NotebookDocument, _cancellation: vscode.CancellationToken) {
			//
		}
		async backupNotebook(_document: vscode.NotebookDocument, _context: vscode.NotebookDocumentBackupContext, _cancellation: vscode.CancellationToken) {
			return { id: '', delete() { } };
		}
	};

	const disposables: vscode.Disposable[] = [];

	suiteTeardown(async function () {
		utils.assertNoRpc();
		await utils.revertAllDirty();
		await utils.closeAllEditors();
		utils.disposeAll(disposables);
		disposables.length = 0;

		for (let doc of vscode.notebook.notebookDocuments) {
			assert.strictEqual(doc.isDirty, false, doc.uri.toString());
		}
	});

	suiteSetup(function () {
		disposables.push(vscode.notebook.registerNotebookContentProvider('notebook.nbdtest', complexContentProvider));
		disposables.push(vscode.notebook.registerNotebookSerializer('notebook.nbdserializer', simpleContentProvider));
	});

	test('cannot register sample provider multiple times', function () {
		assert.throws(() => {
			vscode.notebook.registerNotebookContentProvider('notebook.nbdtest', complexContentProvider);
		});
		// assert.throws(() => {
		// 	vscode.notebook.registerNotebookSerializer('notebook.nbdserializer', simpleContentProvider);
		// });
	});

	test('cannot open unknown types', async function () {
		try {
			await vscode.notebook.openNotebookDocument(vscode.Uri.parse('some:///thing.notTypeKnown'));
			assert.ok(false);
		} catch {
			assert.ok(true);
		}
	});

	test('document basics', async function () {
		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');
		const notebook = await vscode.notebook.openNotebookDocument(uri);

		assert.strictEqual(notebook.uri.toString(), uri.toString());
		assert.strictEqual(notebook.isDirty, false);
		assert.strictEqual(notebook.isUntitled, false);
		assert.strictEqual(notebook.cellCount, 1);

		assert.strictEqual(notebook.viewType, 'notebook.nbdtest');
	});

	test('notebook open/close, notebook ready when cell-document open event is fired', async function () {
		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');
		let didHappen = false;
		const p = utils.asPromise(vscode.workspace.onDidOpenTextDocument).then(doc => {
			if (doc.uri.scheme !== 'vscode-notebook-cell') {
				return;
			}
			const notebook = vscode.notebook.notebookDocuments.find(notebook => {
				const cell = notebook.getCells().find(cell => cell.document === doc);
				return Boolean(cell);
			});
			assert.ok(notebook, `notebook for cell ${doc.uri} NOT found`);
			didHappen = true;
		});

		await vscode.notebook.openNotebookDocument(uri);
		await p;
		assert.strictEqual(didHappen, true);
	});

	test('notebook open/close, all cell-documents are ready', async function () {
		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');

		const p = utils.asPromise(vscode.notebook.onDidOpenNotebookDocument).then(notebook => {
			for (let i = 0; i < notebook.cellCount; i++) {
				let cell = notebook.cellAt(i);

				const doc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === cell.document.uri.toString());
				assert.ok(doc);
				assert.strictEqual(doc.notebook === notebook, true);
				assert.strictEqual(doc === cell.document, true);
				assert.strictEqual(doc?.languageId, cell.document.languageId);
				assert.strictEqual(doc?.isDirty, false);
				assert.strictEqual(doc?.isClosed, false);
			}
		});

		await vscode.notebook.openNotebookDocument(uri);
		await p;
	});


	test('workspace edit API (replaceCells)', async function () {
		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');

		const document = await vscode.notebook.openNotebookDocument(uri);
		assert.strictEqual(document.cellCount, 1);

		// inserting two new cells
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, 0), [{
				kind: vscode.NotebookCellKind.Markdown,
				language: 'markdown',
				metadata: undefined,
				outputs: [],
				source: 'new_markdown'
			}, {
				kind: vscode.NotebookCellKind.Code,
				language: 'fooLang',
				metadata: undefined,
				outputs: [],
				source: 'new_code'
			}]);

			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}

		assert.strictEqual(document.cellCount, 3);
		assert.strictEqual(document.cellAt(0).document.getText(), 'new_markdown');
		assert.strictEqual(document.cellAt(1).document.getText(), 'new_code');

		// deleting cell 1 and 3
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, 1), []);
			edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(2, 3), []);
			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}

		assert.strictEqual(document.cellCount, 1);
		assert.strictEqual(document.cellAt(0).document.getText(), 'new_code');

		// replacing all cells
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, 1), [{
				kind: vscode.NotebookCellKind.Markdown,
				language: 'markdown',
				metadata: undefined,
				outputs: [],
				source: 'new2_markdown'
			}, {
				kind: vscode.NotebookCellKind.Code,
				language: 'fooLang',
				metadata: undefined,
				outputs: [],
				source: 'new2_code'
			}]);
			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}
		assert.strictEqual(document.cellCount, 2);
		assert.strictEqual(document.cellAt(0).document.getText(), 'new2_markdown');
		assert.strictEqual(document.cellAt(1).document.getText(), 'new2_code');

		// remove all cells
		{
			const edit = new vscode.WorkspaceEdit();
			edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, document.cellCount), []);
			const success = await vscode.workspace.applyEdit(edit);
			assert.strictEqual(success, true);
		}
		assert.strictEqual(document.cellCount, 0);
	});

	test('workspace edit API (replaceCells, event)', async function () {
		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');
		const document = await vscode.notebook.openNotebookDocument(uri);
		assert.strictEqual(document.cellCount, 1);

		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, 0), [{
			kind: vscode.NotebookCellKind.Markdown,
			language: 'markdown',
			metadata: undefined,
			outputs: [],
			source: 'new_markdown'
		}, {
			kind: vscode.NotebookCellKind.Code,
			language: 'fooLang',
			metadata: undefined,
			outputs: [],
			source: 'new_code'
		}]);

		const event = utils.asPromise<vscode.NotebookCellsChangeEvent>(vscode.notebook.onDidChangeNotebookCells);

		const success = await vscode.workspace.applyEdit(edit);
		assert.strictEqual(success, true);

		const data = await event;

		// check document
		assert.strictEqual(document.cellCount, 3);
		assert.strictEqual(document.cellAt(0).document.getText(), 'new_markdown');
		assert.strictEqual(document.cellAt(1).document.getText(), 'new_code');

		// check event data
		assert.strictEqual(data.document === document, true);
		assert.strictEqual(data.changes.length, 1);
		assert.strictEqual(data.changes[0].deletedCount, 0);
		assert.strictEqual(data.changes[0].deletedItems.length, 0);
		assert.strictEqual(data.changes[0].items.length, 2);
		assert.strictEqual(data.changes[0].items[0], document.cellAt(0));
		assert.strictEqual(data.changes[0].items[1], document.cellAt(1));
	});

	test('document save API', async function () {
		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');
		const notebook = await vscode.notebook.openNotebookDocument(uri);

		assert.strictEqual(notebook.uri.toString(), uri.toString());
		assert.strictEqual(notebook.isDirty, false);
		assert.strictEqual(notebook.isUntitled, false);
		assert.strictEqual(notebook.cellCount, 1);
		assert.strictEqual(notebook.viewType, 'notebook.nbdtest');

		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCells(notebook.uri, new vscode.NotebookRange(0, 0), [{
			kind: vscode.NotebookCellKind.Markdown,
			language: 'markdown',
			metadata: undefined,
			outputs: [],
			source: 'new_markdown'
		}, {
			kind: vscode.NotebookCellKind.Code,
			language: 'fooLang',
			metadata: undefined,
			outputs: [],
			source: 'new_code'
		}]);

		const success = await vscode.workspace.applyEdit(edit);
		assert.strictEqual(success, true);
		assert.strictEqual(notebook.isDirty, true);

		await notebook.save();
		assert.strictEqual(notebook.isDirty, false);
	});


	test('setTextDocumentLanguage for notebook cells', async function () {

		const uri = await utils.createRandomFile(undefined, undefined, '.nbdtest');
		const notebook = await vscode.notebook.openNotebookDocument(uri);
		const first = notebook.cellAt(0);
		assert.strictEqual(first.document.languageId, 'javascript');

		const pclose = utils.asPromise(vscode.workspace.onDidCloseTextDocument);
		const popen = utils.asPromise(vscode.workspace.onDidOpenTextDocument);

		await vscode.languages.setTextDocumentLanguage(first.document, 'css');
		assert.strictEqual(first.document.languageId, 'css');

		const closed = await pclose;
		const opened = await popen;

		assert.strictEqual(closed.uri.toString(), first.document.uri.toString());
		assert.strictEqual(opened.uri.toString(), first.document.uri.toString());
		assert.strictEqual(opened === closed, true);
	});

	test('setTextDocumentLanguage when notebook editor is not open', async function () {
		const uri = await utils.createRandomFile('', undefined, '.nbdtest');
		const notebook = await vscode.notebook.openNotebookDocument(uri);
		const firstCelUri = notebook.cellAt(0).document.uri;
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

		let cellDoc = await vscode.workspace.openTextDocument(firstCelUri);
		cellDoc = await vscode.languages.setTextDocumentLanguage(cellDoc, 'css');
		assert.strictEqual(cellDoc.languageId, 'css');
	});

	test('dirty state - complex', async function () {
		const resource = await utils.createRandomFile(undefined, undefined, '.nbdtest');
		const document = await vscode.notebook.openNotebookDocument(resource);
		assert.strictEqual(document.isDirty, false);

		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, document.cellCount), []);
		assert.ok(await vscode.workspace.applyEdit(edit));

		assert.strictEqual(document.isDirty, true);

		await document.save();
		assert.strictEqual(document.isDirty, false);
	});

	test('dirty state - serializer', async function () {
		const resource = await utils.createRandomFile(undefined, undefined, '.nbdserializer');
		const document = await vscode.notebook.openNotebookDocument(resource);
		assert.strictEqual(document.isDirty, false);

		const edit = new vscode.WorkspaceEdit();
		edit.replaceNotebookCells(document.uri, new vscode.NotebookRange(0, document.cellCount), []);
		assert.ok(await vscode.workspace.applyEdit(edit));

		assert.strictEqual(document.isDirty, true);

		await document.save();
		assert.strictEqual(document.isDirty, false);
	});
});
