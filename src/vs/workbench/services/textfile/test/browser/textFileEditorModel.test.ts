/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EncodingMode } from 'vs/workbench/common/editor';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { TextFileEditorModelState, snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { createFileEditorInput, workbenchInstantiationService, TestServiceAccessor, TestReadonlyTextFileEditorModel } from 'vs/workbench/test/browser/workbenchTestServices';
import { toResource } from 'vs/base/test/common/utils';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { FileOperationResult, FileOperationError } from 'vs/platform/files/common/files';
import { timeout } from 'vs/base/common/async';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { assertIsDefined } from 'vs/base/common/types';
import { createTextBufferFactory } from 'vs/editor/common/model/textModel';

function getLastModifiedTime(model: TextFileEditorModel): number {
	const stat = model.getStat();

	return stat ? stat.mtime : -1;
}

suite('Files - TextFileEditorModel', () => {

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

		let onDidLoadCounter = 0;
		model.onDidLoad(() => onDidLoadCounter++);

		await model.load();

		assert.equal(onDidLoadCounter, 1);

		let onDidChangeContentCounter = 0;
		model.onDidChangeContent(() => onDidChangeContentCounter++);

		let onDidChangeDirtyCounter = 0;
		model.onDidChangeDirty(() => onDidChangeDirtyCounter++);

		model.updateTextEditorModel(createTextBufferFactory('bar'));

		assert.equal(onDidChangeContentCounter, 1);
		assert.equal(onDidChangeDirtyCounter, 1);

		model.updateTextEditorModel(createTextBufferFactory('foo'));

		assert.equal(onDidChangeContentCounter, 2);
		assert.equal(onDidChangeDirtyCounter, 1);

		await model.revert();

		assert.equal(onDidChangeDirtyCounter, 2);

		model.dispose();
	});

	test('save', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		assert.equal(accessor.workingCopyService.dirtyCount, 0);

		let savedEvent = false;
		model.onDidSave(() => savedEvent = true);

		await model.save();
		assert.ok(!savedEvent);

		model.updateTextEditorModel(createTextBufferFactory('bar'));
		assert.ok(getLastModifiedTime(model) <= Date.now());
		assert.ok(model.hasState(TextFileEditorModelState.DIRTY));

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		const pendingSave = model.save();
		assert.ok(model.hasState(TextFileEditorModelState.PENDING_SAVE));

		await pendingSave;

		assert.ok(model.hasState(TextFileEditorModelState.SAVED));
		assert.ok(!model.isDirty());
		assert.ok(savedEvent);
		assert.ok(workingCopyEvent);

		assert.equal(accessor.workingCopyService.dirtyCount, 0);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), false);

		savedEvent = false;

		await model.save({ force: true });
		assert.ok(savedEvent);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save - touching also emits saved event', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

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

		await model.load();

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

			assert.equal(accessor.workingCopyService.dirtyCount, 1);
			assert.equal(accessor.workingCopyService.isDirty(model.resource), true);
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}

		await model.save({ force: true });

		assert.ok(savedEvent);
		assert.ok(!model.isDirty());

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('save error (generic)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

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

			assert.equal(accessor.workingCopyService.dirtyCount, 1);
			assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

			model.dispose();
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}
	});

	test('save error (conflict)', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

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

			assert.equal(accessor.workingCopyService.dirtyCount, 1);
			assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

			model.dispose();
		} finally {
			accessor.fileService.writeShouldThrowError = undefined;
		}
	});

	test('setEncoding - encode', function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		let encodingEvent = false;
		model.onDidChangeEncoding(() => encodingEvent = true);

		model.setEncoding('utf8', EncodingMode.Encode); // no-op
		assert.equal(getLastModifiedTime(model), -1);

		assert.ok(!encodingEvent);

		model.setEncoding('utf16', EncodingMode.Encode);

		assert.ok(encodingEvent);

		assert.ok(getLastModifiedTime(model) <= Date.now()); // indicates model was saved due to encoding change

		model.dispose();
	});

	test('setEncoding - decode', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.setEncoding('utf16', EncodingMode.Decode);

		await timeout(0);
		assert.ok(model.isResolved()); // model got loaded due to decoding
		model.dispose();
	});

	test('create with mode', async function () {
		const mode = 'text-file-model-test';
		ModesRegistry.registerLanguage({
			id: mode,
		});

		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', mode);

		await model.load();

		assert.equal(model.textEditorModel!.getModeId(), mode);

		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('disposes when underlying model is destroyed', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		model.textEditorModel!.dispose();
		assert.ok(model.isDisposed());
	});

	test('Load does not trigger save', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index.txt'), 'utf8', undefined);
		assert.ok(model.hasState(TextFileEditorModelState.SAVED));

		model.onDidSave(() => assert.fail());
		model.onDidChangeDirty(() => assert.fail());

		await model.load();
		assert.ok(model.isResolved());
		model.dispose();
		assert.ok(!accessor.modelService.getModel(model.resource));
	});

	test('Load returns dirty model as long as model is dirty', async function () {
		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());
		assert.ok(model.hasState(TextFileEditorModelState.DIRTY));

		await model.load();
		assert.ok(model.isDirty());
		model.dispose();
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

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

		await model.revert();
		assert.ok(!model.isDirty());
		assert.equal(model.textEditorModel!.getValue(), 'Hello Html');
		assert.equal(eventCounter, 1);

		assert.ok(workingCopyEvent);
		assert.equal(accessor.workingCopyService.dirtyCount, 0);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), false);

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

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());
		assert.equal(model.textEditorModel!.getValue(), 'foo');
		assert.equal(eventCounter, 1);

		assert.ok(workingCopyEvent);
		assert.equal(accessor.workingCopyService.dirtyCount, 0);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), false);

		model.dispose();
	});

	test('Undo to saved state turns model non-dirty', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);
		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('Hello Text'));
		assert.ok(model.isDirty());

		model.textEditorModel!.undo();
		assert.ok(!model.isDirty());
	});

	test('Load and undo turns model dirty', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);
		await model.load();
		accessor.fileService.setContent('Hello Change');

		await model.load();
		model.textEditorModel!.undo();
		assert.ok(model.isDirty());

		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		assert.equal(accessor.workingCopyService.isDirty(model.resource), true);
	});

	test('Update Dirty', async function () {
		let eventCounter = 0;

		const model = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.setDirty(true);
		assert.ok(!model.isDirty()); // needs to be resolved

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());

		model.onDidChangeDirty(() => eventCounter++);

		let workingCopyEvent = false;
		accessor.workingCopyService.onDidChangeDirty(e => {
			if (e.resource.toString() === model.resource.toString()) {
				workingCopyEvent = true;
			}
		});

		model.setDirty(true);
		assert.ok(model.isDirty());
		assert.equal(eventCounter, 1);
		assert.ok(workingCopyEvent);

		model.setDirty(false);
		assert.ok(!model.isDirty());
		assert.equal(eventCounter, 2);

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

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(!model.isDirty());

		await model.save({ force: true });
		assert.equal(saveEvent, false);

		await model.revert({ soft: true });
		assert.ok(!model.isDirty());

		assert.ok(!workingCopyEvent);

		model.dispose();
	});

	test('File not modified error is handled gracefully', async function () {
		let model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();

		const mtime = getLastModifiedTime(model);
		accessor.textFileService.setResolveTextContentErrorOnce(new FileOperationError('error', FileOperationResult.FILE_NOT_MODIFIED_SINCE));

		model = await model.load() as TextFileEditorModel;

		assert.ok(model);
		assert.equal(getLastModifiedTime(model), mtime);
		model.dispose();
	});

	test('Load error is handled gracefully if model already exists', async function () {
		let model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.load();
		accessor.textFileService.setResolveTextContentErrorOnce(new FileOperationError('error', FileOperationResult.FILE_NOT_FOUND));

		model = await model.load() as TextFileEditorModel;
		assert.ok(model);
		model.dispose();
	});

	test('save() and isDirty() - proper with check for mtimes', async function () {
		const input1 = createFileEditorInput(instantiationService, toResource.call(this, '/path/index_async2.txt'));
		const input2 = createFileEditorInput(instantiationService, toResource.call(this, '/path/index_async.txt'));

		const model1 = await input1.resolve() as TextFileEditorModel;
		const model2 = await input2.resolve() as TextFileEditorModel;

		model1.updateTextEditorModel(createTextBufferFactory('foo'));

		const m1Mtime = assertIsDefined(model1.getStat()).mtime;
		const m2Mtime = assertIsDefined(model2.getStat()).mtime;
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
		assert.ok(assertIsDefined(model1.getStat()).mtime > m1Mtime);
		assert.ok(assertIsDefined(model2.getStat()).mtime > m2Mtime);

		model1.dispose();
		model2.dispose();
	});

	test('Save Participant', async function () {
		let eventCounter = 0;
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		model.onDidSave(() => {
			assert.equal(snapshotToString(model.createSnapshot()!), eventCounter === 1 ? 'bar' : 'foobar');
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

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));
		assert.ok(model.isDirty());

		await model.save();
		assert.equal(eventCounter, 2);

		participant.dispose();
		model.updateTextEditorModel(createTextBufferFactory('foobar'));
		assert.ok(model.isDirty());

		await model.save();
		assert.equal(eventCounter, 3);

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

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		await model.save({ skipSaveParticipants: true });
		assert.equal(eventCounter, 0);

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

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		const now = Date.now();
		await model.save();
		assert.equal(eventCounter, 2);
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

		await model.load();
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

		await model.load();

		model.updateTextEditorModel(createTextBufferFactory('foo'));
		const p1 = model.save();

		model.updateTextEditorModel(createTextBufferFactory('foo 1'));
		const p2 = model.save();

		model.updateTextEditorModel(createTextBufferFactory('foo 2'));
		const p3 = model.save();

		model.updateTextEditorModel(createTextBufferFactory('foo 3'));
		const p4 = model.save();

		await Promise.all([p1, p2, p3, p4]);
		assert.equal(participations.length, 1);

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
				assert.equal(savePromise, newSavePromise);
			}
		});

		await model.load();
		model.updateTextEditorModel(createTextBufferFactory('foo'));

		savePromise = model.save();
		await savePromise;

		participant.dispose();
	}
});
