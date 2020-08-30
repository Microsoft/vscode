/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { EditorModel } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { ITextBufferFactory } from 'vs/editor/common/model';
import { URI } from 'vs/base/common/uri';
import { createTextBufferFactory } from 'vs/editor/common/model/textModel';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TestTextResourcePropertiesService } from 'vs/workbench/test/common/workbenchTestServices';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';

class MyEditorModel extends EditorModel { }
class MyTextEditorModel extends BaseTextEditorModel {
	createTextEditorModel(value: ITextBufferFactory, resource?: URI, preferredMode?: string) {
		return super.createTextEditorModel(value, resource, preferredMode);
	}

	isReadonly(): boolean {
		return false;
	}
}

suite('Workbench editor model', () => {

	let instantiationService: TestInstantiationService;
	let modeService: IModeService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		modeService = instantiationService.stub(IModeService, ModeServiceImpl);
	});

	test('EditorModel', async () => {
		let counter = 0;

		let m = new MyEditorModel();

		m.onDispose(() => {
			assert(true);
			counter++;
		});

		const model = await m.load();
		assert(model === m);
		assert.strictEqual(m.isResolved(), true);
		m.dispose();
		assert.equal(counter, 1);
	});

	test('BaseTextEditorModel', async () => {
		let modelService = stubModelService(instantiationService);

		let m = new MyTextEditorModel(modelService, modeService);
		const model = await m.load() as MyTextEditorModel;

		assert(model === m);
		model.createTextEditorModel(createTextBufferFactory('foo'), null!, 'text/plain');
		assert.strictEqual(m.isResolved(), true);
		m.dispose();
	});

	function stubModelService(instantiationService: TestInstantiationService): IModelService {
		const dialogService = new TestDialogService();
		const notificationService = new TestNotificationService();
		const undoRedoService = new UndoRedoService(dialogService, notificationService);
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(ITextResourcePropertiesService, new TestTextResourcePropertiesService(instantiationService.get(IConfigurationService)));
		instantiationService.stub(IDialogService, dialogService);
		instantiationService.stub(INotificationService, notificationService);
		instantiationService.stub(IUndoRedoService, undoRedoService);
		instantiationService.stub(IThemeService, new TestThemeService());
		return instantiationService.createInstance(ModelServiceImpl);
	}
});
