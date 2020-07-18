/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { TextDocumentSaveReason, TextEdit, Position, EndOfLine } from 'vs/workbench/api/common/extHostTypes';
import { MainThreadTextEditorsShape, IWorkspaceEditDto, IWorkspaceTextEditDto } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostDocumentSaveParticipant } from 'vs/workbench/api/common/extHostDocumentSaveParticipant';
import { SingleProxyRPCProtocol } from './testRPCProtocol';
import { SaveReason } from 'vs/workbench/common/editor';
import type * as vscode from 'vscode';
import { mock } from 'vs/base/test/common/mock';
import { NullLogService } from 'vs/platform/log/common/log';
import { timeout } from 'vs/base/common/async';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';

suite('ExtHostDocumentSaveParticipant', () => {

	let resource = URI.parse('foo:bar');
	let mainThreadEditors = new class extends mock<MainThreadTextEditorsShape>() { };
	let documents: ExtHostDocuments;
	let nullLogService = new NullLogService();
	let nullExtensionDescription: IExtensionDescription = {
		identifier: new ExtensionIdentifier('nullExtensionDescription'),
		name: 'Null Extension Description',
		publisher: 'vscode',
		enableProposedApi: false,
		engines: undefined!,
		extensionLocation: undefined!,
		isBuiltin: false,
		isUnderDevelopment: false,
		version: undefined!
	};

	setup(() => {
		const documentsAndEditors = new ExtHostDocumentsAndEditors(SingleProxyRPCProtocol(null), new NullLogService());
		documentsAndEditors.$acceptDocumentsAndEditorsDelta({
			addedDocuments: [{
				isDirty: false,
				modeId: 'foo',
				uri: resource,
				versionId: 1,
				lines: ['foo'],
				EOL: '\n',
			}]
		});
		documents = new ExtHostDocuments(SingleProxyRPCProtocol(null), documentsAndEditors);
	});

	test('no listeners, no problem', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);
		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => assert.ok(true));
	});

	test('event delivery', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let event: vscode.TextDocumentWillSaveEvent;
		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub.dispose();

			assert.ok(event);
			assert.equal(event.reason, TextDocumentSaveReason.Manual);
			assert.equal(typeof event.waitUntil, 'function');
		});
	});

	test('event delivery, immutable', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let event: vscode.TextDocumentWillSaveEvent;
		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub.dispose();

			assert.ok(event);
			assert.throws(() => { (event.document as any) = null!; });
		});
	});

	test('event delivery, bad listener', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			throw new Error('💀');
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(values => {
			sub.dispose();

			const [first] = values;
			assert.equal(first, false);
		});
	});

	test('event delivery, bad listener doesn\'t prevent more events', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let sub1 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			throw new Error('💀');
		});
		let event: vscode.TextDocumentWillSaveEvent;
		let sub2 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub1.dispose();
			sub2.dispose();

			assert.ok(event);
		});
	});

	test('event delivery, in subscriber order', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let counter = 0;
		let sub1 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			assert.equal(counter++, 0);
		});

		let sub2 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			assert.equal(counter++, 1);
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub1.dispose();
			sub2.dispose();
		});
	});

	test('event delivery, ignore bad listeners', async () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors, { timeout: 5, errors: 1 });

		let callCount = 0;
		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			callCount += 1;
			throw new Error('boom');
		});

		await participant.$participateInSave(resource, SaveReason.EXPLICIT);
		await participant.$participateInSave(resource, SaveReason.EXPLICIT);
		await participant.$participateInSave(resource, SaveReason.EXPLICIT);
		await participant.$participateInSave(resource, SaveReason.EXPLICIT);

		sub.dispose();
		assert.equal(callCount, 2);
	});

	test('event delivery, overall timeout', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors, { timeout: 20, errors: 5 });

		let callCount = 0;
		let sub1 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			callCount += 1;
			event.waitUntil(timeout(1));
		});

		let sub2 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			callCount += 1;
			event.waitUntil(timeout(170));
		});

		let sub3 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			callCount += 1;
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(values => {
			sub1.dispose();
			sub2.dispose();
			sub3.dispose();

			assert.equal(callCount, 2);
			assert.equal(values.length, 2);
		});
	});

	test('event delivery, waitUntil', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {

			event.waitUntil(timeout(10));
			event.waitUntil(timeout(10));
			event.waitUntil(timeout(10));
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub.dispose();
		});

	});

	test('event delivery, waitUntil must be called sync', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {

			event.waitUntil(new Promise((resolve, reject) => {
				setTimeout(() => {
					try {
						assert.throws(() => event.waitUntil(timeout(10)));
						resolve(undefined);
					} catch (e) {
						reject(e);
					}

				}, 10);
			}));
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub.dispose();
		});
	});

	test('event delivery, waitUntil will timeout', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors, { timeout: 5, errors: 3 });

		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (event) {
			event.waitUntil(timeout(15));
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(values => {
			sub.dispose();

			const [first] = values;
			assert.equal(first, false);
		});
	});

	test('event delivery, waitUntil failure handling', () => {
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, mainThreadEditors);

		let sub1 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			e.waitUntil(Promise.reject(new Error('dddd')));
		});

		let event: vscode.TextDocumentWillSaveEvent;
		let sub2 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			event = e;
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			assert.ok(event);
			sub1.dispose();
			sub2.dispose();
		});
	});

	test('event delivery, pushEdits sync', () => {

		let dto: IWorkspaceEditDto;
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, new class extends mock<MainThreadTextEditorsShape>() {
			$tryApplyWorkspaceEdit(_edits: IWorkspaceEditDto) {
				dto = _edits;
				return Promise.resolve(true);
			}
		});

		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			e.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), 'bar')]));
			e.waitUntil(Promise.resolve([TextEdit.setEndOfLine(EndOfLine.CRLF)]));
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub.dispose();

			assert.equal(dto.edits.length, 2);
			assert.ok((<IWorkspaceTextEditDto>dto.edits[0]).edit);
			assert.ok((<IWorkspaceTextEditDto>dto.edits[1]).edit);
		});
	});

	test('event delivery, concurrent change', () => {

		let edits: IWorkspaceEditDto;
		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, new class extends mock<MainThreadTextEditorsShape>() {
			$tryApplyWorkspaceEdit(_edits: IWorkspaceEditDto) {
				edits = _edits;
				return Promise.resolve(true);
			}
		});

		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {

			// concurrent change from somewhere
			documents.$acceptModelChanged(resource, {
				changes: [{
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
					rangeOffset: undefined!,
					rangeLength: undefined!,
					text: 'bar'
				}],
				eol: undefined!,
				versionId: 2
			}, true);

			e.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(values => {
			sub.dispose();

			assert.equal(edits, undefined);
			assert.equal(values[0], false);
		});

	});

	test('event delivery, two listeners -> two document states', () => {

		const participant = new ExtHostDocumentSaveParticipant(nullLogService, documents, new class extends mock<MainThreadTextEditorsShape>() {
			$tryApplyWorkspaceEdit(dto: IWorkspaceEditDto) {

				for (const edit of dto.edits) {

					const uri = URI.revive((<IWorkspaceTextEditDto>edit).resource);
					const { text, range } = (<IWorkspaceTextEditDto>edit).edit;
					documents.$acceptModelChanged(uri, {
						changes: [{
							range,
							text,
							rangeOffset: undefined!,
							rangeLength: undefined!,
						}],
						eol: undefined!,
						versionId: documents.getDocumentData(uri)!.version + 1
					}, true);
					// }
				}

				return Promise.resolve(true);
			}
		});

		const document = documents.getDocument(resource);

		let sub1 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			// the document state we started with
			assert.equal(document.version, 1);
			assert.equal(document.getText(), 'foo');

			e.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		let sub2 = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			// the document state AFTER the first listener kicked in
			assert.equal(document.version, 2);
			assert.equal(document.getText(), 'barfoo');

			e.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), 'bar')]));
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(values => {
			sub1.dispose();
			sub2.dispose();

			// the document state AFTER eventing is done
			assert.equal(document.version, 3);
			assert.equal(document.getText(), 'barbarfoo');
		});

	});

	test('Log failing listener', function () {
		let didLogSomething = false;
		let participant = new ExtHostDocumentSaveParticipant(new class extends NullLogService {
			error(message: string | Error, ...args: any[]): void {
				didLogSomething = true;
			}
		}, documents, mainThreadEditors);


		let sub = participant.getOnWillSaveTextDocumentEvent(nullExtensionDescription)(function (e) {
			throw new Error('boom');
		});

		return participant.$participateInSave(resource, SaveReason.EXPLICIT).then(() => {
			sub.dispose();
			assert.equal(didLogSomething, true);
		});
	});
});
