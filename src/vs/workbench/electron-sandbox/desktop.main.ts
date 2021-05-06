/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INativeWorkbenchConfiguration, INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { Schemas } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { initFileSystem, simpleFileSystemProvider, simpleWorkspaceDir } from 'vs/workbench/electron-sandbox/sandbox.simpleservices';
import { SharedDesktopMain } from 'vs/workbench/electron-sandbox/shared.desktop.main';

class DesktopMain extends SharedDesktopMain {

	constructor(configuration: INativeWorkbenchConfiguration) {
		super({ ...configuration, workspace: { id: configuration.workspace?.id ?? '4064f6ec-cb38-4ad0-af64-ee6467e63c82', uri: simpleWorkspaceDir } });
	}

	protected registerFileSystemProviders(environmentService: INativeWorkbenchEnvironmentService, fileService: IFileService, logService: ILogService): Promise<void> {

		// Local Files
		fileService.registerProvider(Schemas.file, simpleFileSystemProvider);

		// User Data Provider
		fileService.registerProvider(Schemas.userData, new FileUserDataProvider(Schemas.file, simpleFileSystemProvider, Schemas.userData, logService));

		// Init our in-memory file system
		return initFileSystem(environmentService, fileService);
	}
}

export function main(configuration: INativeWorkbenchConfiguration): Promise<void> {
	const workbench = new DesktopMain(configuration);

	return workbench.open();
}
