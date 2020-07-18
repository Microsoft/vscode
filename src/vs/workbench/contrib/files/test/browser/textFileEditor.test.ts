/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { toResource } from 'vs/base/test/common/utils';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { workbenchInstantiationService, TestServiceAccessor, TestFilesConfigurationService, TestTextResourceConfigurationService } from 'vs/workbench/test/browser/workbenchTestServices';
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
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { Selection } from 'vs/editor/common/core/selection';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';

suite('Files - TextFileEditor', () => {

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

	async function createPart(restoreViewState: boolean): Promise<[EditorPart, TestServiceAccessor, IInstantiationService, IEditorService]> {
		const instantiationService = workbenchInstantiationService();

		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration('workbench', { editor: { restoreViewState } });
		instantiationService.stub(IConfigurationService, configurationService);

		instantiationService.stub(ITextResourceConfigurationService, new TestTextResourceConfigurationService(configurationService));

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

		await part.whenRestored;

		return [part, accessor, instantiationService, editorService];
	}

	test('text file editor preserves viewstate', async function () {
		return viewStateTest(this, true);
	});

	test('text file editor resets viewstate if configured as such', async function () {
		return viewStateTest(this, false);
	});

	async function viewStateTest(context: Mocha.ITestCallbackContext, restoreViewState: boolean): Promise<void> {
		const [part, accessor] = await createPart(restoreViewState);

		let editor = await accessor.editorService.openEditor(accessor.editorService.createEditorInput({ resource: toResource.call(context, '/path/index.txt'), forceFile: true }));

		let codeEditor = editor?.getControl() as CodeEditorWidget;
		const selection = new Selection(1, 3, 1, 4);
		codeEditor.setSelection(selection);

		editor = await accessor.editorService.openEditor(accessor.editorService.createEditorInput({ resource: toResource.call(context, '/path/index-other.txt'), forceFile: true }));
		editor = await accessor.editorService.openEditor(accessor.editorService.createEditorInput({ resource: toResource.call(context, '/path/index.txt'), forceFile: true }));

		codeEditor = editor?.getControl() as CodeEditorWidget;

		if (restoreViewState) {
			assert.ok(codeEditor.getSelection()?.equalsSelection(selection));
		} else {
			assert.ok(!codeEditor.getSelection()?.equalsSelection(selection));
		}

		part.dispose();
		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();
	}
});
