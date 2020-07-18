/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NullLogService } from 'vs/platform/log/common/log';
import { mock } from 'vs/base/test/common/mock';
import { MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostNotebookDocument, ExtHostCell } from 'vs/workbench/api/common/extHostNotebook';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { URI } from 'vs/base/common/uri';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';

suite('NotebookCell', function () {

	let rpcProtocol: TestRPCProtocol;
	let extHostDocumentsAndEditors: ExtHostDocumentsAndEditors;

	const disposables = new DisposableStore();
	const fakeNotebookProxy = new class extends mock<MainThreadNotebookShape>() { };
	const fakeNotebook = new class extends mock<ExtHostNotebookDocument>() { };

	setup(async function () {
		disposables.clear();
		rpcProtocol = new TestRPCProtocol();
		extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
	});

	test('Document is real', function () {

		const dto = {
			cellKind: CellKind.Code,
			eol: '\n',
			source: ['aaaa', 'bbbb', 'cccc'],
			handle: 0,
			language: 'fooLang',
			outputs: [],
			uri: URI.parse('test:/path')
		};
		const cell = new ExtHostCell(fakeNotebookProxy, fakeNotebook, extHostDocumentsAndEditors, dto);

		assert.ok(cell.document);
		assert.strictEqual(cell.document.version, 0);
		assert.strictEqual(cell.document.languageId, dto.language);
		assert.strictEqual(cell.document.uri.toString(), dto.uri.toString());
		assert.strictEqual(cell.uri.toString(), dto.uri.toString());
	});


	test('Document is uses actual document when possible', function () {

		const dto = {
			cellKind: CellKind.Code,
			eol: '\n',
			source: ['aaaa', 'bbbb', 'cccc'],
			handle: 0,
			language: 'fooLang',
			outputs: [],
			uri: URI.parse('test:/path')
		};
		const cell = new ExtHostCell(fakeNotebookProxy, fakeNotebook, extHostDocumentsAndEditors, dto);

		// this is the "default document" which is used when the real
		// document isn't open
		const documentNow = cell.document;

		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({
			addedDocuments: [{
				isDirty: false,
				versionId: 12,
				modeId: dto.language,
				uri: dto.uri,
				lines: dto.source,
				EOL: dto.eol
			}]
		});

		// the real document
		assert.ok(documentNow !== cell.document);
		assert.strictEqual(cell.document.languageId, dto.language);
		assert.strictEqual(cell.document.uri.toString(), dto.uri.toString());
		assert.strictEqual(cell.uri.toString(), dto.uri.toString());

		// back to "default document"
		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ removedDocuments: [dto.uri] });
		assert.ok(documentNow === cell.document);
	});

	test('Document can change language (1/2)', function () {

		const dto = {
			cellKind: CellKind.Code,
			eol: '\n',
			source: ['aaaa', 'bbbb', 'cccc'],
			handle: 0,
			language: 'fooLang',
			outputs: [],
			uri: URI.parse('test:/path')
		};
		const cell = new ExtHostCell(fakeNotebookProxy, fakeNotebook, extHostDocumentsAndEditors, dto);

		assert.strictEqual(cell.document.languageId, dto.language);
		cell.defaultDocument._acceptLanguageId('barLang');
		assert.strictEqual(cell.document.languageId, 'barLang');
	});


	test('Document can change language (1/2)', function () {


		const dto = {
			cellKind: CellKind.Code,
			eol: '\n',
			source: ['aaaa', 'bbbb', 'cccc'],
			handle: 0,
			language: 'fooLang',
			outputs: [],
			uri: URI.parse('test:/path')
		};

		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({
			addedDocuments: [{
				isDirty: false,
				versionId: 12,
				modeId: dto.language,
				uri: dto.uri,
				lines: dto.source,
				EOL: dto.eol
			}]
		});

		const extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);

		const cell = new ExtHostCell(fakeNotebookProxy, fakeNotebook, extHostDocumentsAndEditors, dto);

		// a real document already exists and therefore
		// the "default document" doesn't count

		assert.strictEqual(cell.document.languageId, dto.language);
		cell.defaultDocument._acceptLanguageId('barLang');
		assert.strictEqual(cell.document.languageId, dto.language);

		extHostDocuments.$acceptModelModeChanged(dto.uri, dto.language, 'barLang');
		assert.strictEqual(cell.document.languageId, 'barLang');
	});

});
