/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NullLogService } from 'vs/platform/log/common/log';
import { mock } from 'vs/base/test/common/mock';
import { IModelAddedData, MainContext, MainThreadCommandsShape, MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostNotebookDocument, ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { CellKind, CellUri, NotebookCellsChangeType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { URI } from 'vs/base/common/uri';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { isEqual } from 'vs/base/common/resources';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import { generateUuid } from 'vs/base/common/uuid';

suite('NotebookCell#Document', function () {


	let rpcProtocol: TestRPCProtocol;
	let notebook: ExtHostNotebookDocument;
	let extHostDocumentsAndEditors: ExtHostDocumentsAndEditors;
	let extHostDocuments: ExtHostDocuments;
	let extHostNotebooks: ExtHostNotebookController;
	const notebookUri = URI.parse('test:///notebook.file');
	const disposables = new DisposableStore();

	setup(async function () {
		disposables.clear();

		rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadCommands, new class extends mock<MainThreadCommandsShape>() {
			$registerCommand() { }
		});
		rpcProtocol.set(MainContext.MainThreadNotebook, new class extends mock<MainThreadNotebookShape>() {
			async $registerNotebookProvider() { }
			async $unregisterNotebookProvider() { }
		});
		extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
		extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);
		const extHostStoragePaths = new class extends mock<IExtensionStoragePaths>() {
			workspaceValue() {
				return URI.from({ scheme: 'test', path: generateUuid() });
			}
		};
		extHostNotebooks = new ExtHostNotebookController(rpcProtocol, new ExtHostCommands(rpcProtocol, new NullLogService()), extHostDocumentsAndEditors, { isExtensionDevelopmentDebug: false, webviewCspSource: '', webviewResourceRoot: '' }, new NullLogService(), extHostStoragePaths);
		let reg = extHostNotebooks.registerNotebookContentProvider(nullExtensionDescription, 'test', new class extends mock<vscode.NotebookContentProvider>() {
			// async openNotebook() { }
		});
		extHostNotebooks.$acceptDocumentAndEditorsDelta({
			addedDocuments: [{
				handle: 0,
				uri: notebookUri,
				viewType: 'test',
				versionId: 0,
				cells: [{
					handle: 0,
					uri: CellUri.generate(notebookUri, 0),
					source: ['### Heading'],
					eol: '\n',
					language: 'markdown',
					cellKind: CellKind.Markdown,
					outputs: [],
				}, {
					handle: 1,
					uri: CellUri.generate(notebookUri, 1),
					source: ['console.log("aaa")', 'console.log("bbb")'],
					eol: '\n',
					language: 'javascript',
					cellKind: CellKind.Code,
					outputs: [],
				}],
			}],
			addedEditors: [{
				documentUri: notebookUri,
				id: '_notebook_editor_0',
				selections: [0],
				visibleRanges: []
			}]
		});
		extHostNotebooks.$acceptDocumentAndEditorsDelta({ newActiveEditor: '_notebook_editor_0' });

		notebook = extHostNotebooks.notebookDocuments[0]!;

		disposables.add(reg);
		disposables.add(notebook);
		disposables.add(extHostDocuments);
	});


	test('cell document is vscode.TextDocument', async function () {

		assert.strictEqual(notebook.notebookDocument.cells.length, 2);

		const [c1, c2] = notebook.notebookDocument.cells;
		const d1 = extHostDocuments.getDocument(c1.uri);

		assert.ok(d1);
		assert.equal(d1.languageId, c1.language);
		assert.equal(d1.version, 1);
		assert.ok(d1.notebook === notebook.notebookDocument);

		const d2 = extHostDocuments.getDocument(c2.uri);
		assert.ok(d2);
		assert.equal(d2.languageId, c2.language);
		assert.equal(d2.version, 1);
		assert.ok(d2.notebook === notebook.notebookDocument);
	});

	test('cell document goes when notebook closes', async function () {
		const cellUris: string[] = [];
		for (let cell of notebook.notebookDocument.cells) {
			assert.ok(extHostDocuments.getDocument(cell.uri));
			cellUris.push(cell.uri.toString());
		}

		const removedCellUris: string[] = [];
		const reg = extHostDocuments.onDidRemoveDocument(doc => {
			removedCellUris.push(doc.uri.toString());
		});

		extHostNotebooks.$acceptDocumentAndEditorsDelta({ removedDocuments: [notebook.uri] });
		reg.dispose();

		assert.strictEqual(removedCellUris.length, 2);
		assert.deepStrictEqual(removedCellUris.sort(), cellUris.sort());
	});

	test('cell document is vscode.TextDocument after changing it', async function () {

		const p = new Promise((resolve, reject) => {
			extHostNotebooks.onDidChangeNotebookCells(e => {
				try {
					assert.strictEqual(e.changes.length, 1);
					assert.strictEqual(e.changes[0].items.length, 2);

					const [first, second] = e.changes[0].items;

					const doc1 = extHostDocuments.getAllDocumentData().find(data => isEqual(data.document.uri, first.uri));
					assert.ok(doc1);
					assert.strictEqual(doc1?.document === first.document, true);

					const doc2 = extHostDocuments.getAllDocumentData().find(data => isEqual(data.document.uri, second.uri));
					assert.ok(doc2);
					assert.strictEqual(doc2?.document === second.document, true);

					resolve();

				} catch (err) {
					reject(err);
				}
			});
		});

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			kind: NotebookCellsChangeType.ModelChange,
			versionId: notebook.notebookDocument.version + 1,
			changes: [[0, 0, [{
				handle: 2,
				uri: CellUri.generate(notebookUri, 2),
				source: ['Hello', 'World', 'Hello World!'],
				eol: '\n',
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}, {
				handle: 3,
				uri: CellUri.generate(notebookUri, 3),
				source: ['Hallo', 'Welt', 'Hallo Welt!'],
				eol: '\n',
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}]]]
		}, false);

		await p;

	});

	test('cell document stays open when notebook is still open', async function () {

		const docs: vscode.TextDocument[] = [];
		const addData: IModelAddedData[] = [];
		for (let cell of notebook.notebookDocument.cells) {
			const doc = extHostDocuments.getDocument(cell.uri);
			assert.ok(doc);
			assert.equal(extHostDocuments.getDocument(cell.uri).isClosed, false);
			docs.push(doc);
			addData.push({
				EOL: '\n',
				isDirty: doc.isDirty,
				lines: doc.getText().split('\n'),
				modeId: doc.languageId,
				uri: doc.uri,
				versionId: doc.version
			});
		}

		// this call happens when opening a document on the main side
		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ addedDocuments: addData });

		// this call happens when closing a document from the main side
		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ removedDocuments: docs.map(d => d.uri) });

		// notebook is still open -> cell documents stay open
		for (let cell of notebook.notebookDocument.cells) {
			assert.ok(extHostDocuments.getDocument(cell.uri));
			assert.equal(extHostDocuments.getDocument(cell.uri).isClosed, false);
		}

		// close notebook -> docs are closed
		extHostNotebooks.$acceptDocumentAndEditorsDelta({ removedDocuments: [notebook.uri] });
		for (let cell of notebook.notebookDocument.cells) {
			assert.throws(() => extHostDocuments.getDocument(cell.uri));
		}
		for (let doc of docs) {
			assert.equal(doc.isClosed, true);
		}
	});

	test('cell document goes when cell is removed', async function () {

		assert.equal(notebook.notebookDocument.cells.length, 2);
		const [cell1, cell2] = notebook.notebookDocument.cells;

		extHostNotebooks.$acceptModelChanged(notebook.uri, {
			kind: NotebookCellsChangeType.ModelChange,
			versionId: 2,
			changes: [[0, 1, []]]
		}, false);

		assert.equal(notebook.notebookDocument.cells.length, 1);
		assert.equal(cell1.document.isClosed, true); // ref still alive!
		assert.equal(cell2.document.isClosed, false);

		assert.throws(() => extHostDocuments.getDocument(cell1.uri));
	});

	test('cell document knows notebook', function () {
		for (let cells of notebook.notebookDocument.cells) {
			assert.equal(cells.document.notebook === notebook.notebookDocument, true);
		}
	});
});
