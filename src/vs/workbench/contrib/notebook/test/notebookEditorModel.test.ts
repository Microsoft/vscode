/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { IFileService } from 'vs/platform/files/common/files';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ILabelService } from 'vs/platform/label/common/label';
import { NullLogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ComplexNotebookEditorModel, NotebookFileWorkingCopyModel } from 'vs/workbench/contrib/notebook/common/notebookEditorModel';
import { INotebookContentProvider, INotebookSerializer, INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, NotebookDataDto, TransientOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { setupInstantiationService } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';

suite('NotebookFileWorkingCopyModel', function () {

	const instantiationService = setupInstantiationService();

	test('no transient output is send to serializer', function () {

		const notebook = instantiationService.createInstance(NotebookTextModel,
			'notebook',
			URI.file('test'),
			[{ cellKind: CellKind.Code, language: 'foo', source: 'foo', outputs: [{ outputId: 'id', outputs: [{ mime: 'text/plain', value: 'Hello Out' }] }] }],
			{},
			{ transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false }
		);

		{ // transient output
			let callCount = 0;
			const model = new NotebookFileWorkingCopyModel(
				notebook,
				new class extends mock<INotebookSerializer>() {
					override options: TransientOptions = { transientOutputs: true, transientCellMetadata: {}, transientDocumentMetadata: {} };
					override async notebookToData(notebook: NotebookDataDto) {
						callCount += 1;
						assert.strictEqual(notebook.cells.length, 1);
						assert.strictEqual(notebook.cells[0].outputs.length, 0);
						return VSBuffer.fromString('');
					}
				}
			);

			model.snapshot(CancellationToken.None);
			assert.strictEqual(callCount, 1);
		}

		{ // NOT transient output
			let callCount = 0;
			const model = new NotebookFileWorkingCopyModel(
				notebook,
				new class extends mock<INotebookSerializer>() {
					override options: TransientOptions = { transientOutputs: false, transientCellMetadata: {}, transientDocumentMetadata: {} };
					override async notebookToData(notebook: NotebookDataDto) {
						callCount += 1;
						assert.strictEqual(notebook.cells.length, 1);
						assert.strictEqual(notebook.cells[0].outputs.length, 1);
						return VSBuffer.fromString('');
					}
				}
			);
			model.snapshot(CancellationToken.None);
			assert.strictEqual(callCount, 1);
		}
	});

	test('no transient metadata is send to serializer', function () {

		const notebook = instantiationService.createInstance(NotebookTextModel,
			'notebook',
			URI.file('test'),
			[{ cellKind: CellKind.Code, language: 'foo', source: 'foo', outputs: [] }],
			{ foo: 123, bar: 456 },
			{ transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false }
		);

		{ // transient
			let callCount = 0;
			const model = new NotebookFileWorkingCopyModel(
				notebook,
				new class extends mock<INotebookSerializer>() {
					override options: TransientOptions = { transientOutputs: true, transientCellMetadata: {}, transientDocumentMetadata: { bar: true } };
					override async notebookToData(notebook: NotebookDataDto) {
						callCount += 1;
						assert.strictEqual(notebook.metadata.foo, 123);
						assert.strictEqual(notebook.metadata.bar, undefined);
						return VSBuffer.fromString('');
					}
				}
			);

			model.snapshot(CancellationToken.None);
			assert.strictEqual(callCount, 1);
		}

		{ // NOT transient
			let callCount = 0;
			const model = new NotebookFileWorkingCopyModel(
				notebook,
				new class extends mock<INotebookSerializer>() {
					override options: TransientOptions = { transientOutputs: false, transientCellMetadata: {}, transientDocumentMetadata: {} };
					override async notebookToData(notebook: NotebookDataDto) {
						callCount += 1;
						assert.strictEqual(notebook.metadata.foo, 123);
						assert.strictEqual(notebook.metadata.bar, 456);
						return VSBuffer.fromString('');
					}
				}
			);
			model.snapshot(CancellationToken.None);
			assert.strictEqual(callCount, 1);
		}
	});

	test('no transient cell metadata is send to serializer', function () {

		const notebook = instantiationService.createInstance(NotebookTextModel,
			'notebook',
			URI.file('test'),
			[{ cellKind: CellKind.Code, language: 'foo', source: 'foo', outputs: [], metadata: { foo: 123, bar: 456 } }],
			{},
			{ transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false }
		);

		{ // transient
			let callCount = 0;
			const model = new NotebookFileWorkingCopyModel(
				notebook,
				new class extends mock<INotebookSerializer>() {
					override options: TransientOptions = { transientOutputs: true, transientDocumentMetadata: {}, transientCellMetadata: { bar: true } };
					override async notebookToData(notebook: NotebookDataDto) {
						callCount += 1;
						assert.strictEqual(notebook.cells[0].metadata!.foo, 123);
						assert.strictEqual(notebook.cells[0].metadata!.bar, undefined);
						return VSBuffer.fromString('');
					}
				}
			);

			model.snapshot(CancellationToken.None);
			assert.strictEqual(callCount, 1);
		}

		{ // NOT transient
			let callCount = 0;
			const model = new NotebookFileWorkingCopyModel(
				notebook,
				new class extends mock<INotebookSerializer>() {
					override options: TransientOptions = { transientOutputs: false, transientCellMetadata: {}, transientDocumentMetadata: {} };
					override async notebookToData(notebook: NotebookDataDto) {
						callCount += 1;
						assert.strictEqual(notebook.cells[0].metadata!.foo, 123);
						assert.strictEqual(notebook.cells[0].metadata!.bar, 456);
						return VSBuffer.fromString('');
					}
				}
			);
			model.snapshot(CancellationToken.None);
			assert.strictEqual(callCount, 1);
		}
	});
});

suite('ComplexNotebookEditorModel', function () {

	const instaService = new InstantiationService();
	const notebokService = new class extends mock<INotebookService>() { };
	const backupService = new class extends mock<IWorkingCopyBackupService>() { };
	const notificationService = new class extends mock<INotificationService>() { };
	const untitledTextEditorService = new class extends mock<IUntitledTextEditorService>() { };
	const fileService = new class extends mock<IFileService>() {
		override onDidFilesChange = Event.None;
	};
	const labelService = new class extends mock<ILabelService>() {
		override getUriBasenameLabel(uri: URI) { return uri.toString(); }
	};

	const notebookDataProvider = new class extends mock<INotebookContentProvider>() { };

	test('working copy uri', function () {

		const r1 = URI.parse('foo-files:///my.nb');
		const r2 = URI.parse('bar-files:///my.nb');

		const copies: IWorkingCopy[] = [];
		const workingCopyService = new class extends mock<IWorkingCopyService>() {
			override registerWorkingCopy(copy: IWorkingCopy) {
				copies.push(copy);
				return Disposable.None;
			}
		};

		new ComplexNotebookEditorModel(r1, 'fff', notebookDataProvider, instaService, notebokService, workingCopyService, backupService, fileService, notificationService, new NullLogService(), untitledTextEditorService, labelService);
		new ComplexNotebookEditorModel(r2, 'fff', notebookDataProvider, instaService, notebokService, workingCopyService, backupService, fileService, notificationService, new NullLogService(), untitledTextEditorService, labelService);

		assert.strictEqual(copies.length, 2);
		assert.strictEqual(!isEqual(copies[0].resource, copies[1].resource), true);
	});
});
