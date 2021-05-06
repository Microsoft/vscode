/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { NullLogService } from 'vs/platform/log/common/log';
import { ExtHostNotebookConcatDocument } from 'vs/workbench/api/common/extHostNotebookConcatDocument';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { ExtHostNotebookDocument } from 'vs/workbench/api/common/extHostNotebookDocument';
import { URI } from 'vs/base/common/uri';
import { CellKind, CellUri, NotebookCellsChangeType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Position, Location, Range } from 'vs/workbench/api/common/extHostTypes';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import * as vscode from 'vscode';
import { mock } from 'vs/workbench/test/common/workbenchTestServices';
import { MainContext, MainThreadCommandsShape, MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import { generateUuid } from 'vs/base/common/uuid';

suite('NotebookConcatDocument', function () {

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
			override $registerCommand() { }
		});
		rpcProtocol.set(MainContext.MainThreadNotebook, new class extends mock<MainThreadNotebookShape>() {
			override async $registerNotebookProvider() { }
			override async $unregisterNotebookProvider() { }
		});
		extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
		extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);
		const extHostStoragePaths = new class extends mock<IExtensionStoragePaths>() {
			override workspaceValue() {
				return URI.from({ scheme: 'test', path: generateUuid() });
			}
		};
		extHostNotebooks = new ExtHostNotebookController(rpcProtocol, new ExtHostCommands(rpcProtocol, new NullLogService()), extHostDocumentsAndEditors, extHostDocuments, new NullLogService(), extHostStoragePaths);
		let reg = extHostNotebooks.registerNotebookContentProvider(nullExtensionDescription, 'test', new class extends mock<vscode.NotebookContentProvider>() {
			// async openNotebook() { }
		});
		extHostNotebooks.$acceptDocumentAndEditorsDelta({
			addedDocuments: [{
				uri: notebookUri,
				viewType: 'test',
				cells: [{
					handle: 0,
					uri: CellUri.generate(notebookUri, 0),
					source: ['### Heading'],
					eol: '\n',
					language: 'markdown',
					cellKind: CellKind.Markdown,
					outputs: [],
				}],
				versionId: 0
			}],
			addedEditors: [{
				documentUri: notebookUri,
				id: '_notebook_editor_0',
				selections: [{ start: 0, end: 1 }],
				visibleRanges: []
			}]
		});
		extHostNotebooks.$acceptDocumentAndEditorsDelta({ newActiveEditor: '_notebook_editor_0' });

		notebook = extHostNotebooks.notebookDocuments[0]!;

		disposables.add(reg);
		disposables.add(notebook);
		disposables.add(extHostDocuments);
	});

	test('empty', function () {
		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		assert.strictEqual(doc.getText(), '');
		assert.strictEqual(doc.version, 0);

		// assert.strictEqual(doc.locationAt(new Position(0, 0)), undefined);
		// assert.strictEqual(doc.positionAt(SOME_FAKE_LOCATION?), undefined);
	});


	function assertLocation(doc: vscode.NotebookConcatTextDocument, pos: Position, expected: Location, reverse = true) {
		const actual = doc.locationAt(pos);
		assert.strictEqual(actual.uri.toString(), expected.uri.toString());
		assert.strictEqual(actual.range.isEqual(expected.range), true);

		if (reverse) {
			// reverse - offset
			const offset = doc.offsetAt(pos);
			assert.strictEqual(doc.positionAt(offset).isEqual(pos), true);

			// reverse - pos
			const actualPosition = doc.positionAt(actual);
			assert.strictEqual(actualPosition.isEqual(pos), true);
		}
	}

	function assertLines(doc: vscode.NotebookConcatTextDocument, ...lines: string[]) {
		let actual = doc.getText().split(/\r\n|\n|\r/);
		assert.deepStrictEqual(actual, lines);
	}

	test('contains', function () {

		const cellUri1 = CellUri.generate(notebook.uri, 1);
		const cellUri2 = CellUri.generate(notebook.uri, 2);

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [{
				kind: NotebookCellsChangeType.ModelChange,
				changes: [[0, 0, [{
					handle: 1,
					uri: cellUri1,
					source: ['Hello', 'World', 'Hello World!'],
					eol: '\n',
					language: 'test',
					cellKind: CellKind.Code,
					outputs: [],
				}, {
					handle: 2,
					uri: cellUri2,
					source: ['Hallo', 'Welt', 'Hallo Welt!'],
					eol: '\n',
					language: 'test',
					cellKind: CellKind.Code,
					outputs: [],
				}]]
				]
			}]
		}, false);


		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2); // markdown and code

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);

		assert.strictEqual(doc.contains(cellUri1), true);
		assert.strictEqual(doc.contains(cellUri2), true);
		assert.strictEqual(doc.contains(URI.parse('some://miss/path')), false);
	});

	test('location, position mapping', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);


		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2); // markdown and code

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');

		assertLocation(doc, new Position(0, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(0, 0)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(1, 0)));
		assertLocation(doc, new Position(4, 3), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(1, 3)));
		assertLocation(doc, new Position(5, 11), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(2, 11)));
		assertLocation(doc, new Position(5, 12), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(2, 11)), false); // don't check identity because position will be clamped
	});


	test('location, position mapping, cell changes', function () {

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);

		// UPDATE 1
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);
		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 1);
		assert.strictEqual(doc.version, 1);
		assertLines(doc, 'Hello', 'World', 'Hello World!');

		assertLocation(doc, new Position(0, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(0, 0)));
		assertLocation(doc, new Position(2, 2), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 2)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 12)), false); // clamped


		// UPDATE 2
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[1, 0, [{
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2);
		assert.strictEqual(doc.version, 2);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');
		assertLocation(doc, new Position(0, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(0, 0)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(1, 0)));
		assertLocation(doc, new Position(4, 3), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(1, 3)));
		assertLocation(doc, new Position(5, 11), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(2, 11)));
		assertLocation(doc, new Position(5, 12), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(2, 11)), false); // don't check identity because position will be clamped

		// UPDATE 3 (remove cell #2 again)
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[1, 1, []]]
				}
			]
		}, false);
		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 1);
		assert.strictEqual(doc.version, 3);
		assertLines(doc, 'Hello', 'World', 'Hello World!');
		assertLocation(doc, new Position(0, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(0, 0)));
		assertLocation(doc, new Position(2, 2), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 2)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 12)), false); // clamped
	});

	test('location, position mapping, cell-document changes', function () {

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);

		// UPDATE 1
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{

					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);
		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2);
		assert.strictEqual(doc.version, 1);

		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');
		assertLocation(doc, new Position(0, 0), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(0, 0)));
		assertLocation(doc, new Position(2, 2), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 2)));
		assertLocation(doc, new Position(2, 12), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 12)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(1, 0)));
		assertLocation(doc, new Position(4, 3), new Location(notebook.apiNotebook.cellAt(1).document.uri, new Position(1, 3)));

		// offset math
		let cell1End = doc.offsetAt(new Position(2, 12));
		assert.strictEqual(doc.positionAt(cell1End).isEqual(new Position(2, 12)), true);

		extHostDocuments.$acceptModelChanged(notebook.apiNotebook.cellAt(0).document.uri, {
			versionId: 0,
			eol: '\n',
			changes: [{
				range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 6 },
				rangeLength: 6,
				rangeOffset: 12,
				text: 'Hi'
			}]
		}, false);
		assertLines(doc, 'Hello', 'World', 'Hi World!', 'Hallo', 'Welt', 'Hallo Welt!');
		assertLocation(doc, new Position(2, 12), new Location(notebook.apiNotebook.cellAt(0).document.uri, new Position(2, 9)), false);

		assert.strictEqual(doc.positionAt(cell1End).isEqual(new Position(3, 2)), true);

	});

	test('selector', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['fooLang-document'],
						eol: '\n',
						language: 'fooLang',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['barLang-document'],
						eol: '\n',
						language: 'barLang',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		const mixedDoc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		const fooLangDoc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, 'fooLang');
		const barLangDoc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, 'barLang');

		assertLines(mixedDoc, 'fooLang-document', 'barLang-document');
		assertLines(fooLangDoc, 'fooLang-document');
		assertLines(barLangDoc, 'barLang-document');

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[2, 0, [{
						handle: 3,
						uri: CellUri.generate(notebook.uri, 3),
						source: ['barLang-document2'],
						eol: '\n',
						language: 'barLang',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		assertLines(mixedDoc, 'fooLang-document', 'barLang-document', 'barLang-document2');
		assertLines(fooLangDoc, 'fooLang-document');
		assertLines(barLangDoc, 'barLang-document', 'barLang-document2');
	});

	function assertOffsetAtPosition(doc: vscode.NotebookConcatTextDocument, offset: number, expected: { line: number, character: number }, reverse = true) {
		const actual = doc.positionAt(offset);

		assert.strictEqual(actual.line, expected.line);
		assert.strictEqual(actual.character, expected.character);

		if (reverse) {
			const actualOffset = doc.offsetAt(actual);
			assert.strictEqual(actualOffset, offset);
		}
	}


	test('offsetAt(position) <-> positionAt(offset)', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2); // markdown and code

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');

		assertOffsetAtPosition(doc, 0, { line: 0, character: 0 });
		assertOffsetAtPosition(doc, 1, { line: 0, character: 1 });
		assertOffsetAtPosition(doc, 9, { line: 1, character: 3 });
		assertOffsetAtPosition(doc, 32, { line: 4, character: 1 });
		assertOffsetAtPosition(doc, 47, { line: 5, character: 11 });
	});


	function assertLocationAtPosition(doc: vscode.NotebookConcatTextDocument, pos: { line: number, character: number }, expected: { uri: URI, line: number, character: number }, reverse = true) {

		const actual = doc.locationAt(new Position(pos.line, pos.character));
		assert.strictEqual(actual.uri.toString(), expected.uri.toString());
		assert.strictEqual(actual.range.start.line, expected.line);
		assert.strictEqual(actual.range.end.line, expected.line);
		assert.strictEqual(actual.range.start.character, expected.character);
		assert.strictEqual(actual.range.end.character, expected.character);

		if (reverse) {
			const actualPos = doc.positionAt(actual);
			assert.strictEqual(actualPos.line, pos.line);
			assert.strictEqual(actualPos.character, pos.character);
		}
	}

	test('locationAt(position) <-> positionAt(location)', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2); // markdown and code

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');

		assertLocationAtPosition(doc, { line: 0, character: 0 }, { uri: notebook.apiNotebook.cellAt(0).document.uri, line: 0, character: 0 });
		assertLocationAtPosition(doc, { line: 2, character: 0 }, { uri: notebook.apiNotebook.cellAt(0).document.uri, line: 2, character: 0 });
		assertLocationAtPosition(doc, { line: 2, character: 12 }, { uri: notebook.apiNotebook.cellAt(0).document.uri, line: 2, character: 12 });
		assertLocationAtPosition(doc, { line: 3, character: 0 }, { uri: notebook.apiNotebook.cellAt(1).document.uri, line: 0, character: 0 });
		assertLocationAtPosition(doc, { line: 5, character: 0 }, { uri: notebook.apiNotebook.cellAt(1).document.uri, line: 2, character: 0 });
		assertLocationAtPosition(doc, { line: 5, character: 11 }, { uri: notebook.apiNotebook.cellAt(1).document.uri, line: 2, character: 11 });
	});

	test('getText(range)', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2); // markdown and code

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');

		assert.strictEqual(doc.getText(new Range(0, 0, 0, 0)), '');
		assert.strictEqual(doc.getText(new Range(0, 0, 1, 0)), 'Hello\n');
		assert.strictEqual(doc.getText(new Range(2, 0, 4, 0)), 'Hello World!\nHallo\n');
	});

	test('validateRange/Position', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.apiNotebook.version + 1,
			rawEvents: [
				{
					kind: NotebookCellsChangeType.ModelChange,
					changes: [[0, 0, [{
						handle: 1,
						uri: CellUri.generate(notebook.uri, 1),
						source: ['Hello', 'World', 'Hello World!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}, {
						handle: 2,
						uri: CellUri.generate(notebook.uri, 2),
						source: ['Hallo', 'Welt', 'Hallo Welt!'],
						eol: '\n',
						language: 'test',
						cellKind: CellKind.Code,
						outputs: [],
					}]]]
				}
			]
		}, false);

		assert.strictEqual(notebook.apiNotebook.cellCount, 1 + 2); // markdown and code

		let doc = new ExtHostNotebookConcatDocument(extHostNotebooks, extHostDocuments, notebook.apiNotebook, undefined);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');


		function assertPosition(actual: vscode.Position, expectedLine: number, expectedCh: number) {
			assert.strictEqual(actual.line, expectedLine);
			assert.strictEqual(actual.character, expectedCh);
		}


		// "fixed"
		assertPosition(doc.validatePosition(new Position(0, 1000)), 0, 5);
		assertPosition(doc.validatePosition(new Position(2, 1000)), 2, 12);
		assertPosition(doc.validatePosition(new Position(5, 1000)), 5, 11);
		assertPosition(doc.validatePosition(new Position(5000, 1000)), 5, 11);

		// "good"
		assertPosition(doc.validatePosition(new Position(0, 1)), 0, 1);
		assertPosition(doc.validatePosition(new Position(0, 5)), 0, 5);
		assertPosition(doc.validatePosition(new Position(2, 8)), 2, 8);
		assertPosition(doc.validatePosition(new Position(2, 12)), 2, 12);
		assertPosition(doc.validatePosition(new Position(5, 11)), 5, 11);

	});
});
