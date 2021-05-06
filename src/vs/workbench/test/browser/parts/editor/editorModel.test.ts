/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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

suite('Workbench editor model', () => {

	class MyEditorModel extends EditorModel { }
	class MyTextEditorModel extends BaseTextEditorModel {
		override createTextEditorModel(value: ITextBufferFactory, resource?: URI, preferredMode?: string) {
			return super.createTextEditorModel(value, resource, preferredMode);
		}

		override isReadonly(): boolean {
			return false;
		}
	}

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

	let instantiationService: TestInstantiationService;
	let modeService: IModeService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		modeService = instantiationService.stub(IModeService, ModeServiceImpl);
	});

	test('EditorModel', async () => {
		let counter = 0;

		const model = new MyEditorModel();

		model.onWillDispose(() => {
			assert(true);
			counter++;
		});

		await model.resolve();
		assert.strictEqual(model.isDisposed(), false);
		assert.strictEqual(model.isResolved(), true);
		model.dispose();
		assert.strictEqual(counter, 1);
		assert.strictEqual(model.isDisposed(), true);
	});

	test('BaseTextEditorModel', async () => {
		let modelService = stubModelService(instantiationService);

		const model = new MyTextEditorModel(modelService, modeService);
		await model.resolve();

		model.createTextEditorModel(createTextBufferFactory('foo'), null!, 'text/plain');
		assert.strictEqual(model.isResolved(), true);
		model.dispose();
	});
});
