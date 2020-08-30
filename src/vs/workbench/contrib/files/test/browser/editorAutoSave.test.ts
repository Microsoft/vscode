/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { toResource } from 'vs/base/test/common/utils';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { TestFilesConfigurationService, workbenchInstantiationService, TestServiceAccessor } from 'vs/workbench/test/browser/workbenchTestServices';
import { IResolvedTextFileEditorModel, ITextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { IEditorRegistry, EditorDescriptor, Extensions as EditorExtensions } from 'vs/workbench/browser/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { TextFileEditor } from 'vs/workbench/contrib/files/browser/editors/textFileEditor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { EditorInput } from 'vs/workbench/common/editor';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { EditorAutoSave } from 'vs/workbench/browser/parts/editor/editorAutoSave';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';

suite('EditorAutoSave', () => {

	let disposables: IDisposable[] = [];

	setup(() => {
		disposables.push(Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
			EditorDescriptor.create(
				TextFileEditor,
				TextFileEditor.ID,
				'Text File Editor'
			),
			[new SyncDescriptor<EditorInput>(FileEditorInput)]
		));
	});

	teardown(() => {
		dispose(disposables);
		disposables = [];
	});

	async function createEditorAutoSave(autoSaveConfig: object): Promise<[TestServiceAccessor, EditorPart, EditorAutoSave]> {
		const instantiationService = workbenchInstantiationService();

		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('files', autoSaveConfig);
		instantiationService.stub(IConfigurationService, configurationService);

		instantiationService.stub(IFilesConfigurationService, new TestFilesConfigurationService(
			<IContextKeyService>instantiationService.createInstance(MockContextKeyService),
			configurationService
		));

		const part = instantiationService.createInstance(EditorPart);
		part.create(document.createElement('div'));
		part.layout(400, 300);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService: EditorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		const accessor = instantiationService.createInstance(TestServiceAccessor);

		const editorAutoSave = instantiationService.createInstance(EditorAutoSave);

		return [accessor, part, editorAutoSave];
	}

	test('editor auto saves after short delay if configured', async function () {
		const [accessor, part, editorAutoSave] = await createEditorAutoSave({ autoSave: 'afterDelay', autoSaveDelay: 1 });

		const resource = toResource.call(this, '/path/index.txt');

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;
		model.textEditorModel.setValue('Super Good');

		assert.ok(model.isDirty());

		await awaitModelSaved(model);

		assert.ok(!model.isDirty());

		part.dispose();
		editorAutoSave.dispose();
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	});

	test('editor auto saves on focus change if configured', async function () {
		const [accessor, part, editorAutoSave] = await createEditorAutoSave({ autoSave: 'onFocusChange' });

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, forceFile: true });

		const model = await accessor.textFileService.files.resolve(resource) as IResolvedTextFileEditorModel;
		model.textEditorModel.setValue('Super Good');

		assert.ok(model.isDirty());

		await accessor.editorService.openEditor({ resource: toResource.call(this, '/path/index_other.txt') });

		await awaitModelSaved(model);

		assert.ok(!model.isDirty());

		part.dispose();
		editorAutoSave.dispose();
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	});

	function awaitModelSaved(model: ITextFileEditorModel): Promise<void> {
		return new Promise(c => {
			Event.once(model.onDidChangeDirty)(c);
		});
	}
});
