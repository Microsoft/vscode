/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { IWorkingCopyEditorHandler, WorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { createEditorPart, registerTestResourceEditor, TestEditorService, TestServiceAccessor, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestWorkingCopy } from 'vs/workbench/test/common/workbenchTestServices';

suite('WorkingCopyEditorService', () => {

	let disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestResourceEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	test('registry - basics', () => {
		const service = new WorkingCopyEditorService(new TestEditorService());

		let handlerEvent: IWorkingCopyEditorHandler | undefined = undefined;
		service.onDidRegisterHandler(handler => {
			handlerEvent = handler;
		});

		const editorHandler: IWorkingCopyEditorHandler = {
			handles: workingCopy => false,
			isOpen: () => false,
			createEditor: workingCopy => { throw new Error(); }
		};

		const disposable = service.registerHandler(editorHandler);

		assert.strictEqual(handlerEvent, editorHandler);

		disposable.dispose();
	});

	test('findEditor', async () => {
		const disposables = new DisposableStore();

		const instantiationService = workbenchInstantiationService();
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		const editorService = instantiationService.createInstance(EditorService);
		const accessor = instantiationService.createInstance(TestServiceAccessor);

		const service = new WorkingCopyEditorService(editorService);

		const resource = URI.parse('custom://some/folder/custom.txt');
		const testWorkingCopy = new TestWorkingCopy(resource, false, 'testWorkingCopyTypeId1');

		assert.strictEqual(service.findEditor(testWorkingCopy), undefined);

		const editorHandler: IWorkingCopyEditorHandler = {
			handles: workingCopy => workingCopy === testWorkingCopy,
			isOpen: (workingCopy, editor) => workingCopy === testWorkingCopy,
			createEditor: workingCopy => { throw new Error(); }
		};

		disposables.add(service.registerHandler(editorHandler));

		const editor1 = instantiationService.createInstance(UntitledTextEditorInput, accessor.untitledTextEditorService.create({ initialValue: 'foo' }));
		const editor2 = instantiationService.createInstance(UntitledTextEditorInput, accessor.untitledTextEditorService.create({ initialValue: 'foo' }));

		await editorService.openEditors([{ editor: editor1 }, { editor: editor2 }]);

		assert.ok(service.findEditor(testWorkingCopy));

		disposables.dispose();
	});
});
