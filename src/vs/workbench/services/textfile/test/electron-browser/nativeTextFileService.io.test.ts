/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IFileService } from 'vs/platform/files/common/files';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { Schemas } from 'vs/base/common/network';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { rimraf, RimRafMode, copy, readFile, exists, stat } from 'vs/base/node/pfs';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { tmpdir } from 'os';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { generateUuid } from 'vs/base/common/uuid';
import { join } from 'vs/base/common/path';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { detectEncodingByBOM } from 'vs/workbench/services/textfile/test/node/encoding/encoding.test';
import { workbenchInstantiationService, TestNativeTextFileServiceWithEncodingOverrides } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import createSuite from 'vs/workbench/services/textfile/test/common/textFileService.io.test';
import { IWorkingCopyFileService, WorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { TestWorkingCopyService } from 'vs/workbench/test/common/workbenchTestServices';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';

suite('Files - NativeTextFileService i/o', function () {
	const parentDir = getRandomTestPath(tmpdir(), 'vsctests', 'textfileservice');

	const disposables = new DisposableStore();

	let service: ITextFileService;
	let testDir: string;

	// Given issues such as https://github.com/microsoft/vscode/issues/78602
	// and https://github.com/microsoft/vscode/issues/92334 we see random test
	// failures when accessing the native file system. To diagnose further, we
	// retry node.js file access tests up to 3 times to rule out any random disk
	// issue and increase the timeout.
	this.retries(3);
	this.timeout(1000 * 10);

	createSuite({
		setup: async () => {
			const instantiationService = workbenchInstantiationService();

			const logService = new NullLogService();
			const fileService = new FileService(logService);

			const fileProvider = new DiskFileSystemProvider(logService);
			disposables.add(fileService.registerProvider(Schemas.file, fileProvider));
			disposables.add(fileProvider);

			const collection = new ServiceCollection();
			collection.set(IFileService, fileService);

			collection.set(IWorkingCopyFileService, new WorkingCopyFileService(fileService, new TestWorkingCopyService(), instantiationService, new UriIdentityService(fileService)));

			service = instantiationService.createChild(collection).createInstance(TestNativeTextFileServiceWithEncodingOverrides);

			const id = generateUuid();
			testDir = join(parentDir, id);
			const sourceDir = getPathFromAmdModule(require, './fixtures');

			await copy(sourceDir, testDir);

			return { service, testDir };
		},

		teardown: async () => {
			(<TextFileEditorModelManager>service.files).dispose();

			disposables.clear();

			await rimraf(parentDir, RimRafMode.MOVE);
		},

		exists,
		stat,
		readFile,
		detectEncodingByBOM
	});
});
