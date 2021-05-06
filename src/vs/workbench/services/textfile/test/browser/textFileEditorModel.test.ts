/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { EncodingMode, TextFileEditorModelState, snapshotToString, isTextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { createFileEditorInput, workbenchInstantiationService, TestServiceAccessor, TestReadonlyTextFileEditorModel, getLastResolvedFileStat } from 'vs/workbench/test/browser/workbenchTestServices';
import { toResource } from 'vs/base/test/common/utils';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { FileOperationResult, FileOperationError } from 'vs/platform/files/common/files';
import { timeout } from 'vs/base/common/async';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { assertIsDefined } from 'vs/base/common/types';
import { createTextBufferFactory, createTextBufferFactoryFromStream } from 'vs/editor/common/model/textModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { bufferToStream, VSBuffer } from 'vs/base/common/buffer';

suite('Files - TextFileEditorModel', () => {

	function getLastModifiedTime(model: TextFileEditorModel): number {
		const stat = getLastResolvedFileStat(model);

		return stat ? stat.mtime : -1;
	}

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;
	let content: string;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
		content = accessor.fileService.getContent();
	});

	teardown(() => {
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
		accessor.fileService.setContent(content);
	});

	test('basic events', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let onDidResolveCounter = 0;
		model.onDidResolve(() => onDidResolveCounter++);

		await model.resolve();

		assert.strictEqual(onDidResolveCounter, 1);

		let onDidChangeContentCounter = 0;
		model.onDidChangeContent(() => onDidChangeContentCounter++);

		let onDidChangeDirtyCounter = 0;
		model.onDidChangeDirty(() => onDidChangeDirtyCounter++);

		model.updateTextEditorModel(createTextBufferFactory('bar'));

		assert.strictEqual(onDidChangeContentCounter, 1);
		assert.strictEqual(onDidChangeDirtyCounter, 1);

		model.updateTextEditorModel(createTextBufferFactory('foo'));

		assert.strictEqual(onDidChangeContentCounter, 2);
		assert.strictEqual(onDidChangeDirtyCounter, 1);

		await model.revert();

		assert.strictEqual(onDidChangeDirtyCounter, 2);

		model.dispose();
	});

	test('isTextFileEditorModel', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		assert.strictEqual(isTextFileEditorModel(model), true);

		model.dispose();
	});

	test('save', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		assert.strictEqual(accessor.workingCopyService.dirtyCount, 0);

		let savedEvent = false;
		model.onDidSave(() => savedEvent = true);

		await model.save();
		assert.ok(!savedEvent);

		model.updateTextEditorModel(createTextBufferFactory('bar'));
		assert.ok(getLastModifiedTime(model) <= Date.now());
		assert.ok(model.hasState(TextFileEditorModelState.DIRTY));

		assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		const pendingSave = model.save();
		assert.ok(model.hasState(TextFileEditorModelState.PENDING_SAVE));

		await Promise.all([pendingSave, model.joinState(TextFileEditorModelState.PENDING_SAVE)]);

		assert.ok(model.hasState(TextFileEditorModelState.SAVED));
		assert.ok(!model.isDirty());
		assert.ok(savedEvent);
		assert.ok(workingCopyEvent);

		assert.strictEqual(accessor.workingCopyService.dirtyCount, 0);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), false);

		savedEvent = false;

		await model.save({ force: true });
		assert.ok(savedEvent);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save - touching also emits saved event', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		let savedEvent = false;
		model.onDidSave(() => savedEvent = true);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		await model.save({ force: true });

		assert.ok(savedEvent);
		assert.ok(!workingCopyEvent);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save - touching with error turns model dirty', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		let saveErrorEvent = false;
		model.onDidSaveError(() => saveErrorEvent = true);

		let savedEvent = false;
		model.onDidSave(() => savedEvent = true);

		accessor.fileService.writeShouldThrowError = new Error('failed to write');
		try {
			await model.save({ force: true });

			assert.ok(model.hasState(TextFileEditorModelState.ERROR));
			assert.ok(model.isDirty());
			assert.ok(saveErrorEvent);

			assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
			assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}

		await model.save({ force: true });

		assert.ok(savedEvent);
		assert.strictEqual(model.isDirty(), false);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save error (generic)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		model.updateTextEditorModel(createTextBufferFactory('bar'));

		let saveErrorEvent = false;
		model.onDidSaveError(() => saveErrorEvent = true);

		accessor.fileService.writeShouldThrowError = new Error('failed to write');
		try {
			const pendingSave = model.save();
			assert.ok(model.hasState(TextFileEditorModelState.PENDING_SAVE));

			await pendingSave;

			assert.ok(model.hasState(TextFileEditorModelState.ERROR));
			assert.ok(model.isDirty());
			assert.ok(saveErrorEvent);

			assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
			assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);

			model.dispose();
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}
	});

	test('save error (conflict)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		model.updateTextEditorModel(createTextBufferFactory('bar'));

		let saveErrorEvent = false;
		model.onDidSaveError(() => saveErrorEvent = true);

		accessor.fileService.writeShouldThrowError = new FileOperationError('save conflict', FileOperationResult.FILE_MODIFIED_SINCE);
		try {
			const pendingSave = model.save();
			assert.ok(model.hasState(TextFileEditorModelState.PENDING_SAVE));

			await pendingSave;

			assert.ok(model.hasState(TextFileEditorModelState.CONFLICT));
			assert.ok(model.isDirty());
			assert.ok(saveErrorEvent);

			assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
			assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);

			model.dispose();
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}
	});

	test('setEncoding - encode', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let encodingEvent = false;
		model.onDidChangeEncoding(() => encodingEvent = true);

		await model.setEncoding('utf8', EncodingMode.Encode); // no-op
		assert.strictEqual(getLastModifiedTime(model), -1);

		assert.ok(!encodingEvent);

		await model.setEncoding('utf16', EncodingMode.Encode);

		assert.ok(encodingEvent);

		assert.ok(getLastModifiedTime(model) <= Date.now()); // indicates model was saved due to encoding change

		model.dispose();
	});

	test('setEncoding - decode', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.setEncoding('utf16', EncodingMode.Decode);

		assert.ok(model.isResolved()); // model got resolved due to decoding
		model.dispose();
	});

	test('setEncoding - decode dirty file saves first', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);
		await model.resolve();

		model.updateTextEditorModel(createTextBufferFactory('bar'));
		assert.strictEqual(model.isDirty(), true);

		await model.setEncoding('utf16', EncodingMode.Decode);

		assert.strictEqual(model.isDirty(), false);
		model.dispose();
	});

	test('create with mode', async function () {
		const mode = 'text-file-model-test';
		ModesRegistry.registerLanguage({
			id: mode,
		});

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', mode);

		await model.resolve();

		assert.strictEqual(model.textEditorModel!.getModeId(), mode);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('disposes when underlying model is destroyed', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		model.textEditorModel!.dispose();
		assert.ok(model.isDisposed());
	});

	test('Resolve does not trigger save', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index.txt'), 'utf8', undefined);
		assert.ok(model.hasState(TextFileEditorModelState.SAVED));

		model.onDidSave(() => assert.fail());
		model.onDidChangeDirty(() => assert.fail());

		await model.resolve();
		assert.ok(model.isResolved());
		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('Resolve returns dirty model as long as model is dirty', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());
		assert.ok(model.hasState(TextFileEditorModelState.DIRTY));

		await model.resolve();
		assert.ok(model.isDirty());
		model.dispose();
	});

	test('Resolve with contents', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve({ contents: createTextBufferFactory('Hello World') });

		assert.strictEqual(model.textEditorModel?.getValue(), 'Hello World');
		assert.strictEqual(model.isDirty(), true);

		await model.resolve({ contents: createTextBufferFactory('Hello Changes') });

		assert.strictEqual(model.textEditorModel?.getValue(), 'Hello Changes');
		assert.strictEqual(model.isDirty(), true);

		// verify that we do not mark the model as saved when undoing once because
		// we never really had a saved state
		await model.textEditorModel!.undo();
		assert.ok(model.isDirty());

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('Revert', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidRevert(() => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);

		await model.revert();
		assert.strictEqual(model.isDirty(), false);
		assert.strictEqual(model.textEditorModel!.getValue(), 'Hello Html');
		assert.strictEqual(eventCounter, 1);

		assert.ok(workingCopyEvent);
		assert.strictEqual(accessor.workingCopyService.dirtyCount, 0);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), false);

		model.dispose();
	});

	test('Revert (soft)', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidRevert(() => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);

		await model.revert({ soft: true });
		assert.strictEqual(model.isDirty(), false);
		assert.strictEqual(model.textEditorModel!.getValue(), 'foo');
		assert.strictEqual(eventCounter, 1);

		assert.ok(workingCopyEvent);
		assert.strictEqual(accessor.workingCopyService.dirtyCount, 0);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), false);

		model.dispose();
	});

	test('Undo to saved state turns model non-dirty', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);
		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('Hello Text'));
		assert.ok(model.isDirty());

		await model.textEditorModel!.undo();
		assert.ok(!model.isDirty());
	});

	test('Resolve and undo turns model dirty', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);
		await model.resolve();
		accessor.fileService.setContent('Hello Change');

		await model.resolve();
		await model.textEditorModel!.undo();
		assert.ok(model.isDirty());

		assert.strictEqual(accessor.workingCopyService.dirtyCount, 1);
		assert.strictEqual(accessor.workingCopyService.isDirty(model.resource, model.typeId), true);
	});

	test('Update Dirty', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.setDirty(true);
		assert.ok(!model.isDirty()); // needs to be resolved

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		await model.revert({ soft: true });
		assert.strictEqual(model.isDirty(), false);

		model.onDidChangeDirty(() => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		model.setDirty(true);
		assert.ok(model.isDirty());
		assert.strictEqual(eventCounter, 1);
		assert.ok(workingCopyEvent);

		model.setDirty(false);
		assert.strictEqual(model.isDirty(), false);
		assert.strictEqual(eventCounter, 2);

		model.dispose();
	});

	test('No Dirty or saving for readonly models', async function () {
		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		const model = instantiationService.createInstance(TestReadonlyTextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let saveEvent = false;
		model.onDidSave(() => {
			saveEvent = true;
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(!model.isDirty());

		await model.save({ force: true });
		assert.strictEqual(saveEvent, false);

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());

		assert.ok(!workingCopyEvent);

		model.dispose();
	});

	test('File not modified error is handled gracefully', async function () {
		let model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		const mtime = getLastModifiedTime(model);
		accessor.textFileService.setReadStreamErrorOnce(new FileOperationError('error', FileOperationResult.FILE_NOT_MODIFIED_SINCE));

		await model.resolve();

		assert.ok(model);
		assert.strictEqual(getLastModifiedTime(model), mtime);
		model.dispose();
	});

	test('Resolve error is handled gracefully if model already exists', async function () {
		let model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();
		accessor.textFileService.setReadStreamErrorOnce(new FileOperationError('error', FileOperationResult.FILE_NOT_FOUND));

		await model.resolve();
		assert.ok(model);
		model.dispose();
	});

	test('save() and isDirty() - proper with check for mtimes', async function () {
		const input1 = createFileEditorInput(instantiationService, toResource.call(this, '/path/index_async2.txt'));
		const input2 = createFileEditorInput(instantiationService, toResource.call(this, '/path/index_async.txt'));

		const model1 = await input1.resolve() as TextFileEditorModel;
		const model2 = await input2.resolve() as TextFileEditorModel;

		model1.updateTextEditorModel(createTextBufferFactory('foo'));

		const m1Mtime = assertIsDefined(getLastResolvedFileStat(model1)).mtime;
		const m2Mtime = assertIsDefined(getLastResolvedFileStat(model2)).mtime;
		assert.ok(m1Mtime > 0);
		assert.ok(m2Mtime > 0);

		assert.ok(accessor.textFileService.isDirty(toResource.call(this, '/path/index_async2.txt')));
		assert.ok(!accessor.textFileService.isDirty(toResource.call(this, '/path/index_async.txt')));

		model2.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(accessor.textFileService.isDirty(toResource.call(this, '/path/index_async.txt')));

		await timeout(10);
		await accessor.textFileService.save(toResource.call(this, '/path/index_async.txt'));
		await accessor.textFileService.save(toResource.call(this, '/path/index_async2.txt'));
		assert.ok(!accessor.textFileService.isDirty(toResource.call(this, '/path/index_async.txt')));
		assert.ok(!accessor.textFileService.isDirty(toResource.call(this, '/path/index_async2.txt')));
		assert.ok(assertIsDefined(getLastResolvedFileStat(model1)).mtime > m1Mtime);
		assert.ok(assertIsDefined(getLastResolvedFileStat(model2)).mtime > m2Mtime);

		model1.dispose();
		model2.dispose();
	});

	test('Save Participant', async function () {
		let eventCounter = 0;
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidSave(() => {
			assert.strictEqual(snapshotToString(model.createSnapshot()!), eventCounter === 1 ? 'bar' : 'foobar');
			assert.ok(!model.isDirty());
			eventCounter++;
		});

		const participant = accessor.textFileService.files.addSaveParticipant({
			participate: async model => {
				assert.ok(model.isDirty());
				(model as TextFileEditorModel).updateTextEditorModel(createTextBufferFactory('bar'));
				assert.ok(model.isDirty());
				eventCounter++;
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		await model.save();
		assert.strictEqual(eventCounter, 2);

		participant.dispose();
		model.updateTextEditorModel(createTextBufferFactory('foobar'));
		assert.ok(model.isDirty());

		await model.save();
		assert.strictEqual(eventCounter, 3);

		model.dispose();
	});

	test('Save Participant - skip', async function () {
		let eventCounter = 0;
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		const participant = accessor.textFileService.files.addSaveParticipant({
			participate: async () => {
				eventCounter++;
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		await model.save({ skipSaveParticipants: true });
		assert.strictEqual(eventCounter, 0);

		participant.dispose();
		model.dispose();
	});

	test('Save Participant, async participant', async function () {
		let eventCounter = 0;
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidSave(() => {
			assert.ok(!model.isDirty());
			eventCounter++;
		});

		const participant = accessor.textFileService.files.addSaveParticipant({
			participate: model => {
				assert.ok(model.isDirty());
				(model as TextFileEditorModel).updateTextEditorModel(createTextBufferFactory('bar'));
				assert.ok(model.isDirty());
				eventCounter++;

				return timeout(10);
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		const now = Date.now();
		await model.save();
		assert.strictEqual(eventCounter, 2);
		assert.ok(Date.now() - now >= 10);

		model.dispose();
		participant.dispose();
	});

	test('Save Participant, bad participant', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		const participant = accessor.textFileService.files.addSaveParticipant({
			participate: async () => {
				new Error('boom');
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		await model.save();

		model.dispose();
		participant.dispose();
	});

	test('Save Participant, participant cancelled when saved again', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let participations: boolean[] = [];

		const participant = accessor.textFileService.files.addSaveParticipant({
			participate: async (model, context, progress, token) => {
				await timeout(10);

				if (!token.isCancellationRequested) {
					participations.push(true);
				}
			}
		});

		await model.resolve();

		model.updateTextEditorModel(createTextBufferFactory('foo'));
		const p1 = model.save();

		model.updateTextEditorModel(createTextBufferFactory('foo 1'));
		const p2 = model.save();

		model.updateTextEditorModel(createTextBufferFactory('foo 2'));
		const p3 = model.save();

		model.updateTextEditorModel(createTextBufferFactory('foo 3'));
		const p4 = model.save();

		await Promise.all([p1, p2, p3, p4]);
		assert.strictEqual(participations.length, 1);

		model.dispose();
		participant.dispose();
	});

	test('Save Participant, calling save from within is unsupported but does not explode (sync save)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await testSaveFromSaveParticipant(model, false);

		model.dispose();
	});

	test('Save Participant, calling save from within is unsupported but does not explode (async save)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await testSaveFromSaveParticipant(model, true);

		model.dispose();
	});

	async function testSaveFromSaveParticipant(model: TextFileEditorModel, async: boolean): Promise<void> {
		let savePromise: Promise<boolean>;
		let breakLoop = false;

		const participant = accessor.textFileService.files.addSaveParticipant({
			participate: async model => {
				if (breakLoop) {
					return;
				}

				breakLoop = true;

				if (async) {
					await timeout(10);
				}
				const newSavePromise = model.save();

				// assert that this is the same promise as the outer one
				assert.strictEqual(savePromise, newSavePromise);
			}
		});

		await model.resolve();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		savePromise = model.save();
		await savePromise;

		participant.dispose();
	}

	test('backup and restore (simple)', async function () {
		return testBackupAndRestore(toResource.call(this, '/path/index_async.txt'), toResource.call(this, '/path/index_async2.txt'), 'Some very small file text content.');
	});

	test('backup and restore (large, #121347)', async function () {
		const largeContent = '국어한\n'.repeat(100000);
		return testBackupAndRestore(toResource.call(this, '/path/index_async.txt'), toResource.call(this, '/path/index_async2.txt'), largeContent);
	});

	async function testBackupAndRestore(resourceA: URI, resourceB: URI, contents: string): Promise<void> {
		const originalModel: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, resourceA, 'utf8', undefined);
		await originalModel.resolve({
			contents: await createTextBufferFactoryFromStream(await accessor.textFileService.getDecodedStream(resourceA, bufferToStream(VSBuffer.fromString(contents))))
		});

		assert.strictEqual(originalModel.textEditorModel?.getValue(), contents);

		const backup = await originalModel.backup(CancellationToken.None);
		const modelRestoredIdentifier = { typeId: originalModel.typeId, resource: resourceB };
		await accessor.workingCopyBackupService.backup(modelRestoredIdentifier, backup.content);

		const modelRestored: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, modelRestoredIdentifier.resource, 'utf8', undefined);
		await modelRestored.resolve();

		assert.strictEqual(modelRestored.textEditorModel?.getValue(), contents);
		assert.strictEqual(modelRestored.isDirty(), true);

		originalModel.dispose();
		modelRestored.dispose();
	}
});
