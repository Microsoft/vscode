/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { toResource } from 'vs/base/test/common/utils';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { workbenchInstantiationService, TestServiceAccessor, TestEditorService, getLastResolvedFileStat } from 'vs/workbench/test/browser/workbenchTestServices';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorInputFactoryRegistry, Verbosity, EditorExtensions } from 'vs/workbench/common/editor';
import { EncodingMode, TextFileOperationError, TextFileOperationResult } from 'vs/workbench/services/textfile/common/textfiles';
import { FileOperationResult, FileOperationError } from 'vs/platform/files/common/files';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { timeout } from 'vs/base/common/async';
import { ModesRegistry, PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { BinaryEditorModel } from 'vs/workbench/common/editor/binaryEditorModel';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { FileEditorInputSerializer } from 'vs/workbench/contrib/files/browser/files';

suite('Files - FileEditorInput', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;

	function createFileInput(resource: URI, preferredResource?: URI, preferredMode?: string, preferredName?: string, preferredDescription?: string): FileEditorInput {
		return instantiationService.createInstance(FileEditorInput, resource, preferredResource, preferredName, preferredDescription, undefined, preferredMode);
	}

	setup(() => {
		instantiationService = workbenchInstantiationService({
			editorService: () => {
				return new class extends TestEditorService {
					override createEditorInput(input: IResourceEditorInput) {
						return createFileInput(input.resource);
					}
				};
			}
		});

		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	test('Basics', async function () {
		let input = createFileInput(toResource.call(this, '/foo/bar/file.js'));
		const otherInput = createFileInput(toResource.call(this, 'foo/bar/otherfile.js'));
		const otherInputSame = createFileInput(toResource.call(this, 'foo/bar/file.js'));

		assert(input.matches(input));
		assert(input.matches(otherInputSame));
		assert(!input.matches(otherInput));
		assert(!input.matches(null));
		assert.ok(input.getName());
		assert.ok(input.getDescription());
		assert.ok(input.getTitle(Verbosity.SHORT));

		assert.strictEqual('file.js', input.getName());

		assert.strictEqual(toResource.call(this, '/foo/bar/file.js').fsPath, input.resource.fsPath);
		assert(input.resource instanceof URI);

		input = createFileInput(toResource.call(this, '/foo/bar.html'));

		const inputToResolve: FileEditorInput = createFileInput(toResource.call(this, '/foo/bar/file.js'));
		const sameOtherInput: FileEditorInput = createFileInput(toResource.call(this, '/foo/bar/file.js'));

		let resolved = await inputToResolve.resolve();
		assert.ok(inputToResolve.isResolved());

		const resolvedModelA = resolved;
		resolved = await inputToResolve.resolve();
		assert(resolvedModelA === resolved); // OK: Resolved Model cached globally per input

		try {
			DisposableStore.DISABLE_DISPOSED_WARNING = true; // prevent unwanted warning output from occuring

			const otherResolved = await sameOtherInput.resolve();
			assert(otherResolved === resolvedModelA); // OK: Resolved Model cached globally per input
			inputToResolve.dispose();

			resolved = await inputToResolve.resolve();
			assert(resolvedModelA === resolved); // Model is still the same because we had 2 clients
			inputToResolve.dispose();
			sameOtherInput.dispose();
			resolvedModelA.dispose();

			resolved = await inputToResolve.resolve();
			assert(resolvedModelA !== resolved); // Different instance, because input got disposed

			const stat = getLastResolvedFileStat(resolved);
			resolved = await inputToResolve.resolve();
			await timeout(0);
			assert(stat !== getLastResolvedFileStat(resolved)); // Different stat, because resolve always goes to the server for refresh
		} finally {
			DisposableStore.DISABLE_DISPOSED_WARNING = false;
		}
	});

	test('preferred resource', function () {
		const resource = toResource.call(this, '/foo/bar/updatefile.js');
		const preferredResource = toResource.call(this, '/foo/bar/UPDATEFILE.js');

		const inputWithoutPreferredResource = createFileInput(resource);
		assert.strictEqual(inputWithoutPreferredResource.resource.toString(), resource.toString());
		assert.strictEqual(inputWithoutPreferredResource.preferredResource.toString(), resource.toString());

		const inputWithPreferredResource = createFileInput(resource, preferredResource);

		assert.strictEqual(inputWithPreferredResource.resource.toString(), resource.toString());
		assert.strictEqual(inputWithPreferredResource.preferredResource.toString(), preferredResource.toString());

		let didChangeLabel = false;
		const listener = inputWithPreferredResource.onDidChangeLabel(e => {
			didChangeLabel = true;
		});

		assert.strictEqual(inputWithPreferredResource.getName(), 'UPDATEFILE.js');

		const otherPreferredResource = toResource.call(this, '/FOO/BAR/updateFILE.js');
		inputWithPreferredResource.setPreferredResource(otherPreferredResource);

		assert.strictEqual(inputWithPreferredResource.resource.toString(), resource.toString());
		assert.strictEqual(inputWithPreferredResource.preferredResource.toString(), otherPreferredResource.toString());
		assert.strictEqual(inputWithPreferredResource.getName(), 'updateFILE.js');
		assert.strictEqual(didChangeLabel, true);

		listener.dispose();
	});

	test('preferred mode', async function () {
		const mode = 'file-input-test';
		ModesRegistry.registerLanguage({
			id: mode,
		});

		const input = createFileInput(toResource.call(this, '/foo/bar/file.js'), undefined, mode);
		assert.strictEqual(input.getPreferredMode(), mode);

		const model = await input.resolve() as TextFileEditorModel;
		assert.strictEqual(model.textEditorModel!.getModeId(), mode);

		input.setMode('text');
		assert.strictEqual(input.getPreferredMode(), 'text');
		assert.strictEqual(model.textEditorModel!.getModeId(), PLAINTEXT_MODE_ID);

		const input2 = createFileInput(toResource.call(this, '/foo/bar/file.js'));
		input2.setPreferredMode(mode);

		const model2 = await input2.resolve() as TextFileEditorModel;
		assert.strictEqual(model2.textEditorModel!.getModeId(), mode);
	});

	test('matches', function () {
		const input1 = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));
		const input2 = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));
		const input3 = createFileInput(toResource.call(this, '/foo/bar/other.js'));
		const input2Upper = createFileInput(toResource.call(this, '/foo/bar/UPDATEFILE.js'));

		assert.strictEqual(input1.matches(null), false);
		assert.strictEqual(input1.matches(input1), true);
		assert.strictEqual(input1.matches(input2), true);
		assert.strictEqual(input1.matches(input3), false);

		assert.strictEqual(input1.matches(input2Upper), false);
	});

	test('getEncoding/setEncoding', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		await input.setEncoding('utf16', EncodingMode.Encode);
		assert.strictEqual(input.getEncoding(), 'utf16');

		const resolved = await input.resolve() as TextFileEditorModel;
		assert.strictEqual(input.getEncoding(), resolved.getEncoding());
		resolved.dispose();
	});

	test('save', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		const resolved = await input.resolve() as TextFileEditorModel;
		resolved.textEditorModel!.setValue('changed');
		assert.ok(input.isDirty());

		await input.save(0);
		assert.ok(!input.isDirty());
		resolved.dispose();
	});

	test('revert', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		const resolved = await input.resolve() as TextFileEditorModel;
		resolved.textEditorModel!.setValue('changed');
		assert.ok(input.isDirty());

		await input.revert(0);
		assert.ok(!input.isDirty());

		input.dispose();
		assert.ok(input.isDisposed());

		resolved.dispose();
	});

	test('resolve handles binary files', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		accessor.textFileService.setReadStreamErrorOnce(new TextFileOperationError('error', TextFileOperationResult.FILE_IS_BINARY));

		const resolved = await input.resolve();
		assert.ok(resolved);
		resolved.dispose();
	});

	test('resolve handles too large files', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		accessor.textFileService.setReadStreamErrorOnce(new FileOperationError('error', FileOperationResult.FILE_TOO_LARGE));

		const resolved = await input.resolve();
		assert.ok(resolved);
		resolved.dispose();
	});

	test('attaches to model when created and reports dirty', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		let listenerCount = 0;
		const listener = input.onDidChangeDirty(() => {
			listenerCount++;
		});

		// instead of going through file input resolve method
		// we resolve the model directly through the service
		const model = await accessor.textFileService.files.resolve(input.resource);
		model.textEditorModel?.setValue('hello world');

		assert.strictEqual(listenerCount, 1);
		assert.ok(input.isDirty());

		input.dispose();
		listener.dispose();
	});

	test('force open text/binary', async function () {
		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));
		input.setForceOpenAsBinary();

		let resolved = await input.resolve();
		assert.ok(resolved instanceof BinaryEditorModel);

		input.setForceOpenAsText();

		resolved = await input.resolve();
		assert.ok(resolved instanceof TextFileEditorModel);

		resolved.dispose();
	});

	test('file editor input serializer', async function () {
		instantiationService.invokeFunction(accessor => Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).start(accessor));

		const input = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'));

		const disposable = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer('workbench.editors.files.fileEditorInput', FileEditorInputSerializer);

		const editorSerializer = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).getEditorInputSerializer(input.typeId);
		if (!editorSerializer) {
			assert.fail('File Editor Input Serializer missing');
		}

		assert.strictEqual(editorSerializer.canSerialize(input), true);

		const inputSerialized = editorSerializer.serialize(input);
		if (!inputSerialized) {
			assert.fail('Unexpected serialized file input');
		}

		const inputDeserialized = editorSerializer.deserialize(instantiationService, inputSerialized);
		assert.strictEqual(input.matches(inputDeserialized), true);

		const preferredResource = toResource.call(this, '/foo/bar/UPDATEfile.js');
		const inputWithPreferredResource = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'), preferredResource);

		const inputWithPreferredResourceSerialized = editorSerializer.serialize(inputWithPreferredResource);
		if (!inputWithPreferredResourceSerialized) {
			assert.fail('Unexpected serialized file input');
		}

		const inputWithPreferredResourceDeserialized = editorSerializer.deserialize(instantiationService, inputWithPreferredResourceSerialized) as FileEditorInput;
		assert.strictEqual(inputWithPreferredResource.resource.toString(), inputWithPreferredResourceDeserialized.resource.toString());
		assert.strictEqual(inputWithPreferredResource.preferredResource.toString(), inputWithPreferredResourceDeserialized.preferredResource.toString());

		disposable.dispose();
	});

	test('preferred name/description', async function () {

		// Works with custom file input
		const customFileInput = createFileInput(toResource.call(this, '/foo/bar/updatefile.js').with({ scheme: 'test-custom' }), undefined, undefined, 'My Name', 'My Description');

		let didChangeLabelCounter = 0;
		customFileInput.onDidChangeLabel(() => {
			didChangeLabelCounter++;
		});

		assert.strictEqual(customFileInput.getName(), 'My Name');
		assert.strictEqual(customFileInput.getDescription(), 'My Description');

		customFileInput.setPreferredName('My Name 2');
		customFileInput.setPreferredDescription('My Description 2');

		assert.strictEqual(customFileInput.getName(), 'My Name 2');
		assert.strictEqual(customFileInput.getDescription(), 'My Description 2');

		assert.strictEqual(didChangeLabelCounter, 2);

		customFileInput.dispose();

		// Disallowed with local file input
		const fileInput = createFileInput(toResource.call(this, '/foo/bar/updatefile.js'), undefined, undefined, 'My Name', 'My Description');

		didChangeLabelCounter = 0;
		fileInput.onDidChangeLabel(() => {
			didChangeLabelCounter++;
		});

		assert.notStrictEqual(fileInput.getName(), 'My Name');
		assert.notStrictEqual(fileInput.getDescription(), 'My Description');

		fileInput.setPreferredName('My Name 2');
		fileInput.setPreferredDescription('My Description 2');

		assert.notStrictEqual(fileInput.getName(), 'My Name 2');
		assert.notStrictEqual(fileInput.getDescription(), 'My Description 2');

		assert.strictEqual(didChangeLabelCounter, 0);

		fileInput.dispose();
	});
});
