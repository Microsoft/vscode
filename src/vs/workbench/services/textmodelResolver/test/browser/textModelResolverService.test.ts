/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ITextModel } from 'vs/editor/common/model';
import { URI } from 'vs/base/common/uri';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { ResourceEditorModel } from 'vs/workbench/common/editor/resourceEditorModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { workbenchInstantiationService, TestServiceAccessor, TestTextFileEditorModelManager } from 'vs/workbench/test/browser/workbenchTestServices';
import { toResource } from 'vs/base/test/common/utils';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { Event } from 'vs/base/common/event';
import { timeout } from 'vs/base/common/async';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { createTextBufferFactory } from 'vs/editor/common/model/textModel';

suite('Workbench - TextModelResolverService', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;
	let model: TextFileEditorModel;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	teardown(() => {
		model?.dispose();
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	});

	test('resolve resource', async () => {
		const disposable = accessor.textModelResolverService.registerTextModelContentProvider('test', {
			provideTextContent: async function (resource: URI): Promise<ITextModel | null> {
				if (resource.scheme === 'test') {
					let modelContent = 'Hello Test';
					let languageSelection = accessor.modeService.create('json');

					return accessor.modelService.createModel(modelContent, languageSelection, resource);
				}

				return null;
			}
		});

		let resource = URI.from({ scheme: 'test', authority: null!, path: 'thePath' });
		let input: ResourceEditorInput = instantiationService.createInstance(ResourceEditorInput, resource, 'The Name', 'The Description', undefined);

		const model = await input.resolve();
		assert.ok(model);
		assert.strictEqual(snapshotToString(((model as ResourceEditorModel).createSnapshot()!)), 'Hello Test');
		let disposed = false;
		let disposedPromise = new Promise<void>(resolve => {
			Event.once(model.onWillDispose)(() => {
				disposed = true;
				resolve();
			});
		});
		input.dispose();

		await disposedPromise;
		assert.strictEqual(disposed, true);
		disposable.dispose();
	});

	test('resolve file', async function () {
		const textModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file_resolver.txt'), 'utf8', undefined);
		(<TestTextFileEditorModelManager>accessor.textFileService.files).add(textModel.resource, textModel);

		await textModel.resolve();

		const ref = await accessor.textModelResolverService.createModelReference(textModel.resource);

		const model = ref.object;
		const editorModel = model.textEditorModel;

		assert.ok(editorModel);
		assert.strictEqual(editorModel.getValue(), 'Hello Html');

		let disposed = false;
		Event.once(model.onWillDispose)(() => {
			disposed = true;
		});

		ref.dispose();
		await timeout(0);  // due to the reference resolving the model first which is async
		assert.strictEqual(disposed, true);
	});

	test('resolved dirty file eventually disposes', async function () {
		const textModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file_resolver.txt'), 'utf8', undefined);
		(<TestTextFileEditorModelManager>accessor.textFileService.files).add(textModel.resource, textModel);

		await textModel.resolve();

		textModel.updateTextEditorModel(createTextBufferFactory('make dirty'));

		const ref = await accessor.textModelResolverService.createModelReference(textModel.resource);

		let disposed = false;
		Event.once(textModel.onWillDispose)(() => {
			disposed = true;
		});

		ref.dispose();
		await timeout(0);
		assert.strictEqual(disposed, false); // not disposed because model still dirty

		textModel.revert();

		await timeout(0);
		assert.strictEqual(disposed, true); // now disposed because model got reverted
	});

	test('resolved dirty file does not dispose when new reference created', async function () {
		const textModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/file_resolver.txt'), 'utf8', undefined);
		(<TestTextFileEditorModelManager>accessor.textFileService.files).add(textModel.resource, textModel);

		await textModel.resolve();

		textModel.updateTextEditorModel(createTextBufferFactory('make dirty'));

		const ref1 = await accessor.textModelResolverService.createModelReference(textModel.resource);

		let disposed = false;
		Event.once(textModel.onWillDispose)(() => {
			disposed = true;
		});

		ref1.dispose();
		await timeout(0);
		assert.strictEqual(disposed, false); // not disposed because model still dirty

		const ref2 = await accessor.textModelResolverService.createModelReference(textModel.resource);

		textModel.revert();

		await timeout(0);
		assert.strictEqual(disposed, false); // not disposed because we got another ref meanwhile

		ref2.dispose();

		await timeout(0);
		assert.strictEqual(disposed, true); // now disposed because last ref got disposed
	});

	test('resolve untitled', async () => {
		const service = accessor.untitledTextEditorService;
		const untitledModel = service.create();
		const input = instantiationService.createInstance(UntitledTextEditorInput, untitledModel);

		await input.resolve();
		const ref = await accessor.textModelResolverService.createModelReference(input.resource);
		const model = ref.object;
		assert.strictEqual(untitledModel, model);
		const editorModel = model.textEditorModel;
		assert.ok(editorModel);
		ref.dispose();
		input.dispose();
		model.dispose();
	});

	test('even loading documents should be refcounted', async () => {
		let resolveModel!: Function;
		let waitForIt = new Promise(resolve => resolveModel = resolve);

		const disposable = accessor.textModelResolverService.registerTextModelContentProvider('test', {
			provideTextContent: async (resource: URI): Promise<ITextModel> => {
				await waitForIt;

				let modelContent = 'Hello Test';
				let languageSelection = accessor.modeService.create('json');
				return accessor.modelService.createModel(modelContent, languageSelection, resource);
			}
		});

		const uri = URI.from({ scheme: 'test', authority: null!, path: 'thePath' });

		const modelRefPromise1 = accessor.textModelResolverService.createModelReference(uri);
		const modelRefPromise2 = accessor.textModelResolverService.createModelReference(uri);

		resolveModel();

		const modelRef1 = await modelRefPromise1;
		const model1 = modelRef1.object;
		const modelRef2 = await modelRefPromise2;
		const model2 = modelRef2.object;
		const textModel = model1.textEditorModel;

		assert.strictEqual(model1, model2, 'they are the same model');
		assert(!textModel.isDisposed(), 'the text model should not be disposed');

		modelRef1.dispose();
		assert(!textModel.isDisposed(), 'the text model should still not be disposed');

		let p1 = new Promise<void>(resolve => textModel.onWillDispose(resolve));
		modelRef2.dispose();

		await p1;
		assert(textModel.isDisposed(), 'the text model should finally be disposed');

		disposable.dispose();
	});
});
