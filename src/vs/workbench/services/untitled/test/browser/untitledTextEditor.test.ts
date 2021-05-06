/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { join } from 'vs/base/common/path';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IUntitledTextEditorService, UntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { workbenchInstantiationService, TestServiceAccessor } from 'vs/workbench/test/browser/workbenchTestServices';
import { snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { ModesRegistry, PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { Range } from 'vs/editor/common/core/range';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { CancellationToken } from 'vs/base/common/cancellation';

suite('Untitled text editors', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	teardown(() => {
		(accessor.untitledTextEditorService as UntitledTextEditorService).dispose();
	});

	test('basics', async () => {
		const service = accessor.untitledTextEditorService;
		const workingCopyService = accessor.workingCopyService;

		const input1 = instantiationService.createInstance(UntitledTextEditorInput, service.create());
		await input1.resolve();
		assert.strictEqual(service.get(input1.resource), input1.model);

		assert.ok(service.get(input1.resource));
		assert.ok(!service.get(URI.file('testing')));

		const input2 = instantiationService.createInstance(UntitledTextEditorInput, service.create());
		assert.strictEqual(service.get(input2.resource), input2.model);

		// get()
		assert.strictEqual(service.get(input1.resource), input1.model);
		assert.strictEqual(service.get(input2.resource), input2.model);

		// revert()
		await input1.revert(0);
		assert.ok(input1.isDisposed());
		assert.ok(!service.get(input1.resource));

		// dirty
		const model = await input2.resolve();
		assert.strictEqual(await service.resolve({ untitledResource: input2.resource }), model);
		assert.ok(service.get(model.resource));

		assert.ok(!input2.isDirty());

		const resourcePromise = awaitDidChangeDirty(accessor.untitledTextEditorService);

		model.textEditorModel?.setValue('foo bar');

		const resource = await resourcePromise;

		assert.strictEqual(resource.toString(), input2.resource.toString());

		assert.ok(input2.isDirty());

		assert.ok(workingCopyService.isDirty(input2.resource));
		assert.strictEqual(workingCopyService.dirtyCount, 1);

		await input1.revert(0);
		await input2.revert(0);
		assert.ok(!service.get(input1.resource));
		assert.ok(!service.get(input2.resource));
		assert.ok(!input2.isDirty());
		assert.ok(!model.isDirty());

		assert.ok(!workingCopyService.isDirty(input2.resource));
		assert.strictEqual(workingCopyService.dirtyCount, 0);

		await input1.revert(0);
		assert.ok(input1.isDisposed());
		assert.ok(!service.get(input1.resource));

		input2.dispose();
		assert.ok(!service.get(input2.resource));
	});

	function awaitDidChangeDirty(service: IUntitledTextEditorService): Promise<URI> {
		return new Promise(resolve => {
			const listener = service.onDidChangeDirty(async model => {
				listener.dispose();

				resolve(model.resource);
			});
		});
	}

	test('setValue()', async () => {
		const service = accessor.untitledTextEditorService;
		const untitled = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		const model = await untitled.resolve();

		model.setValue('not dirty', true);
		assert.ok(!model.isDirty());

		model.setValue('dirty');
		assert.ok(model.isDirty());

		untitled.dispose();
		model.dispose();
	});

	test('associated resource is dirty', async () => {
		const service = accessor.untitledTextEditorService;
		const file = URI.file(join('C:\\', '/foo/file.txt'));

		let onDidChangeDirtyModel: IUntitledTextEditorModel | undefined = undefined;
		const listener = service.onDidChangeDirty(model => {
			onDidChangeDirtyModel = model;
		});

		const model = service.create({ associatedResource: file });
		const untitled = instantiationService.createInstance(UntitledTextEditorInput, model);
		assert.ok(untitled.isDirty());
		assert.strictEqual(model, onDidChangeDirtyModel);

		const resolvedModel = await untitled.resolve();

		assert.ok(resolvedModel.hasAssociatedFilePath);
		assert.strictEqual(untitled.isDirty(), true);

		untitled.dispose();
		listener.dispose();
	});

	test('no longer dirty when content gets empty (not with associated resource)', async () => {
		const service = accessor.untitledTextEditorService;
		const workingCopyService = accessor.workingCopyService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		// dirty
		const model = await input.resolve();
		model.textEditorModel?.setValue('foo bar');
		assert.ok(model.isDirty());
		assert.ok(workingCopyService.isDirty(model.resource, model.typeId));
		model.textEditorModel?.setValue('');
		assert.ok(!model.isDirty());
		assert.ok(!workingCopyService.isDirty(model.resource, model.typeId));
		input.dispose();
		model.dispose();
	});

	test('via create options', async () => {
		const service = accessor.untitledTextEditorService;

		const model1 = await instantiationService.createInstance(UntitledTextEditorInput, service.create()).resolve();

		model1.textEditorModel!.setValue('foo bar');
		assert.ok(model1.isDirty());

		model1.textEditorModel!.setValue('');
		assert.ok(!model1.isDirty());

		const model2 = await instantiationService.createInstance(UntitledTextEditorInput, service.create({ initialValue: 'Hello World' })).resolve();
		assert.strictEqual(snapshotToString(model2.createSnapshot()!), 'Hello World');

		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		const model3 = await instantiationService.createInstance(UntitledTextEditorInput, service.create({ untitledResource: input.resource })).resolve();

		assert.strictEqual(model3.resource.toString(), input.resource.toString());

		const file = URI.file(join('C:\\', '/foo/file44.txt'));
		const model4 = await instantiationService.createInstance(UntitledTextEditorInput, service.create({ associatedResource: file })).resolve();
		assert.ok(model4.hasAssociatedFilePath);
		assert.ok(model4.isDirty());

		model1.dispose();
		model2.dispose();
		model3.dispose();
		model4.dispose();
		input.dispose();
	});

	test('associated path remains dirty when content gets empty', async () => {
		const service = accessor.untitledTextEditorService;
		const file = URI.file(join('C:\\', '/foo/file.txt'));
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create({ associatedResource: file }));

		// dirty
		const model = await input.resolve();
		model.textEditorModel?.setValue('foo bar');
		assert.ok(model.isDirty());
		model.textEditorModel?.setValue('');
		assert.ok(model.isDirty());
		input.dispose();
		model.dispose();
	});

	test('initial content is dirty', async () => {
		const service = accessor.untitledTextEditorService;
		const workingCopyService = accessor.workingCopyService;

		const untitled = instantiationService.createInstance(UntitledTextEditorInput, service.create({ initialValue: 'Hello World' }));
		assert.ok(untitled.isDirty());

		// dirty
		const model = await untitled.resolve();
		assert.ok(model.isDirty());
		assert.strictEqual(workingCopyService.dirtyCount, 1);

		untitled.dispose();
		model.dispose();
	});

	test('created with files.defaultLanguage setting', () => {
		const defaultLanguage = 'javascript';
		const config = accessor.testConfigurationService;
		config.setUserConfiguration('files', { 'defaultLanguage': defaultLanguage });

		const service = accessor.untitledTextEditorService;
		const input = service.create();

		assert.strictEqual(input.getMode(), defaultLanguage);

		config.setUserConfiguration('files', { 'defaultLanguage': undefined });

		input.dispose();
	});

	test('created with files.defaultLanguage setting (${activeEditorLanguage})', async () => {
		const config = accessor.testConfigurationService;
		config.setUserConfiguration('files', { 'defaultLanguage': '${activeEditorLanguage}' });

		accessor.editorService.activeTextEditorMode = 'typescript';

		const service = accessor.untitledTextEditorService;
		const model = service.create();

		assert.strictEqual(model.getMode(), 'typescript');

		config.setUserConfiguration('files', { 'defaultLanguage': undefined });
		accessor.editorService.activeTextEditorMode = undefined;

		model.dispose();
	});

	test('created with mode overrides files.defaultLanguage setting', () => {
		const mode = 'typescript';
		const defaultLanguage = 'javascript';
		const config = accessor.testConfigurationService;
		config.setUserConfiguration('files', { 'defaultLanguage': defaultLanguage });

		const service = accessor.untitledTextEditorService;
		const input = service.create({ mode });

		assert.strictEqual(input.getMode(), mode);

		config.setUserConfiguration('files', { 'defaultLanguage': undefined });

		input.dispose();
	});

	test('can change mode afterwards', async () => {
		const mode = 'untitled-input-test';

		ModesRegistry.registerLanguage({
			id: mode,
		});

		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create({ mode }));

		assert.ok(input.model.hasModeSetExplicitly);
		assert.strictEqual(input.getMode(), mode);

		const model = await input.resolve();
		assert.strictEqual(model.getMode(), mode);

		input.setMode('plaintext');

		assert.strictEqual(input.getMode(), PLAINTEXT_MODE_ID);

		input.dispose();
		model.dispose();
	});

	test('remembers that mode was set explicitly', async () => {
		const mode = 'untitled-input-test';

		ModesRegistry.registerLanguage({
			id: mode,
		});

		const service = accessor.untitledTextEditorService;
		const model = service.create();
		const input = instantiationService.createInstance(UntitledTextEditorInput, model);

		assert.ok(!input.model.hasModeSetExplicitly);
		input.setMode('plaintext');
		assert.ok(input.model.hasModeSetExplicitly);

		assert.strictEqual(input.getMode(), PLAINTEXT_MODE_ID);

		input.dispose();
		model.dispose();
	});

	test('service#onDidChangeEncoding', async () => {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		service.onDidChangeEncoding(model => {
			counter++;
			assert.strictEqual(model.resource.toString(), input.resource.toString());
		});

		// encoding
		const model = await input.resolve();
		await model.setEncoding('utf16');
		assert.strictEqual(counter, 1);
		input.dispose();
		model.dispose();
	});

	test('service#onDidChangeLabel', async () => {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		service.onDidChangeLabel(model => {
			counter++;
			assert.strictEqual(model.resource.toString(), input.resource.toString());
		});

		// label
		const model = await input.resolve();
		model.textEditorModel?.setValue('Foo Bar');
		assert.strictEqual(counter, 1);
		input.dispose();
		model.dispose();
	});

	test('service#onWillDispose', async () => {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		service.onWillDispose(model => {
			counter++;
			assert.strictEqual(model.resource.toString(), input.resource.toString());
		});

		const model = await input.resolve();
		assert.strictEqual(counter, 0);
		model.dispose();
		assert.strictEqual(counter, 1);
	});


	test('service#getValue', async () => {
		// This function is used for the untitledocumentData API
		const service = accessor.untitledTextEditorService;
		const model1 = await instantiationService.createInstance(UntitledTextEditorInput, service.create()).resolve();

		model1.textEditorModel!.setValue('foo bar');
		assert.strictEqual(service.getValue(model1.resource), 'foo bar');
		model1.dispose();

		// When a model doesn't exist, it should return undefined
		assert.strictEqual(service.getValue(URI.parse('https://www.microsoft.com')), undefined);
	});

	test('model#onDidChangeContent', async function () {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		const model = await input.resolve();
		model.onDidChangeContent(() => counter++);

		model.textEditorModel?.setValue('foo');

		assert.strictEqual(counter, 1, 'Dirty model should trigger event');
		model.textEditorModel?.setValue('bar');

		assert.strictEqual(counter, 2, 'Content change when dirty should trigger event');
		model.textEditorModel?.setValue('');

		assert.strictEqual(counter, 3, 'Manual revert should trigger event');
		model.textEditorModel?.setValue('foo');

		assert.strictEqual(counter, 4, 'Dirty model should trigger event');

		input.dispose();
		model.dispose();
	});

	test('model#onDidRevert and input disposed when reverted', async function () {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		const model = await input.resolve();
		model.onDidRevert(() => counter++);

		model.textEditorModel?.setValue('foo');

		await model.revert();

		assert.ok(input.isDisposed());
		assert.ok(counter === 1);
	});

	test('model#onDidChangeName and input name', async function () {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		let model = await input.resolve();
		model.onDidChangeName(() => counter++);

		model.textEditorModel?.setValue('foo');
		assert.strictEqual(input.getName(), 'foo');
		assert.strictEqual(model.name, 'foo');

		assert.strictEqual(counter, 1);
		model.textEditorModel?.setValue('bar');
		assert.strictEqual(input.getName(), 'bar');
		assert.strictEqual(model.name, 'bar');

		assert.strictEqual(counter, 2);
		model.textEditorModel?.setValue('');
		assert.strictEqual(input.getName(), 'Untitled-1');
		assert.strictEqual(model.name, 'Untitled-1');

		model.textEditorModel?.setValue('        ');
		assert.strictEqual(input.getName(), 'Untitled-1');
		assert.strictEqual(model.name, 'Untitled-1');

		model.textEditorModel?.setValue('([]}'); // require actual words
		assert.strictEqual(input.getName(), 'Untitled-1');
		assert.strictEqual(model.name, 'Untitled-1');

		model.textEditorModel?.setValue('([]}hello   '); // require actual words
		assert.strictEqual(input.getName(), '([]}hello');
		assert.strictEqual(model.name, '([]}hello');

		model.textEditorModel?.setValue('12345678901234567890123456789012345678901234567890'); // trimmed at 40chars max
		assert.strictEqual(input.getName(), '1234567890123456789012345678901234567890');
		assert.strictEqual(model.name, '1234567890123456789012345678901234567890');

		model.textEditorModel?.setValue('123456789012345678901234567890123456789🌞'); // do not break grapehems (#111235)
		assert.strictEqual(input.getName(), '123456789012345678901234567890123456789');
		assert.strictEqual(model.name, '123456789012345678901234567890123456789');

		assert.strictEqual(counter, 6);

		model.textEditorModel?.setValue('Hello\nWorld');
		assert.strictEqual(counter, 7);

		function createSingleEditOp(text: string, positionLineNumber: number, positionColumn: number, selectionLineNumber: number = positionLineNumber, selectionColumn: number = positionColumn): IIdentifiedSingleEditOperation {
			let range = new Range(
				selectionLineNumber,
				selectionColumn,
				positionLineNumber,
				positionColumn
			);

			return {
				identifier: null,
				range,
				text,
				forceMoveMarkers: false
			};
		}

		model.textEditorModel?.applyEdits([createSingleEditOp('hello', 2, 2)]);
		assert.strictEqual(counter, 7); // change was not on first line

		input.dispose();
		model.dispose();

		const inputWithContents = instantiationService.createInstance(UntitledTextEditorInput, service.create({ initialValue: 'Foo' }));
		model = await inputWithContents.resolve();

		assert.strictEqual(inputWithContents.getName(), 'Foo');

		inputWithContents.dispose();
		model.dispose();
	});

	test('model#onDidChangeDirty', async function () {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		const model = await input.resolve();
		model.onDidChangeDirty(() => counter++);

		model.textEditorModel?.setValue('foo');

		assert.strictEqual(counter, 1, 'Dirty model should trigger event');
		model.textEditorModel?.setValue('bar');

		assert.strictEqual(counter, 1, 'Another change does not fire event');

		input.dispose();
		model.dispose();
	});

	test('model#onDidChangeEncoding', async function () {
		const service = accessor.untitledTextEditorService;
		const input = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		let counter = 0;

		const model = await input.resolve();
		model.onDidChangeEncoding(() => counter++);

		await model.setEncoding('utf16');

		assert.strictEqual(counter, 1, 'Dirty model should trigger event');
		await model.setEncoding('utf16');

		assert.strictEqual(counter, 1, 'Another change to same encoding does not fire event');

		input.dispose();
		model.dispose();
	});

	test('backup and restore (simple)', async function () {
		return testBackupAndRestore('Some very small file text content.');
	});

	test('backup and restore (large, #121347)', async function () {
		const largeContent = '국어한\n'.repeat(100000);
		return testBackupAndRestore(largeContent);
	});

	async function testBackupAndRestore(content: string) {
		const service = accessor.untitledTextEditorService;
		const originalInput = instantiationService.createInstance(UntitledTextEditorInput, service.create());
		const restoredInput = instantiationService.createInstance(UntitledTextEditorInput, service.create());

		const originalModel = await originalInput.resolve();
		originalModel.textEditorModel?.setValue(content);

		const backup = await originalModel.backup(CancellationToken.None);
		const modelRestoredIdentifier = { typeId: originalModel.typeId, resource: restoredInput.resource };
		await accessor.workingCopyBackupService.backup(modelRestoredIdentifier, backup.content);

		const restoredModel = await restoredInput.resolve();

		assert.strictEqual(restoredModel.textEditorModel?.getValue(), content);
		assert.strictEqual(restoredModel.isDirty(), true);

		originalInput.dispose();
		originalModel.dispose();
		restoredInput.dispose();
		restoredModel.dispose();
	}
});
