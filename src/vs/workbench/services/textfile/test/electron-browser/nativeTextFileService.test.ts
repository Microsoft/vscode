/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IFileService } from 'vs/platform/files/common/files';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { Schemas } from 'vs/base/common/network';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { workbenchInstantiationService, TestNativeTextFileServiceWithEncodingOverrides, TestServiceAccessor } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { IWorkingCopyFileService, WorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { WorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { toResource } from 'vs/base/test/common/utils';

suite('Files - NativeTextFileService', function () {
	const disposables = new DisposableStore();

	let service: ITextFileService;
	let instantiationService: IInstantiationService;

	setup(() => {
		instantiationService = workbenchInstantiationService();

		const logService = new NullLogService();
		const fileService = new FileService(logService);

		const fileProvider = new InMemoryFileSystemProvider();
		disposables.add(fileService.registerProvider(Schemas.file, fileProvider));
		disposables.add(fileProvider);

		const collection = new ServiceCollection();
		collection.set(IFileService, fileService);

		collection.set(IWorkingCopyFileService, new WorkingCopyFileService(fileService, new WorkingCopyService(), instantiationService, new UriIdentityService(fileService)));

		service = instantiationService.createChild(collection).createInstance(TestNativeTextFileServiceWithEncodingOverrides);
	});

	teardown(() => {
		(<TextFileEditorModelManager>service.files).dispose();

		disposables.clear();
	});

	test('shutdown joins on pending saves', async function () {
		const model: TextFileEditorModel = instantiationService.createInstance(TextFileEditorModel, toResource.call(this, '/path/index_async.txt'), 'utf8', undefined);

		await model.resolve();

		let pendingSaveAwaited = false;
		model.save().then(() => pendingSaveAwaited = true);

		const accessor = instantiationService.createInstance(TestServiceAccessor);
		accessor.lifecycleService.fireShutdown();

		assert.ok(accessor.lifecycleService.shutdownJoiners.length > 0);
		await Promise.all(accessor.lifecycleService.shutdownJoiners);

		assert.strictEqual(pendingSaveAwaited, true);
	});
});
