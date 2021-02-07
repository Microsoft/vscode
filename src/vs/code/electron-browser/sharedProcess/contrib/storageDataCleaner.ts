/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { join } from 'vs/base/common/path';
import { readdir, rimraf } from 'vs/base/node/pfs';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IBackupWorkspacesFormat } from 'vs/platform/backup/node/backup';

export class StorageDataCleaner extends Disposable {

	// Workspace/Folder storage names are MD5 hashes (128bits / 4 due to hex presentation)
	private static readonly NON_EMPTY_WORKSPACE_ID_LENGTH = 128 / 4;

	constructor(
		private readonly backupWorkspacesPath: string,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService
	) {
		super();

		this.cleanUpStorageSoon();
	}

	private cleanUpStorageSoon(): void {
		let handle: NodeJS.Timeout | undefined = setTimeout(() => {
			handle = undefined;

			(async () => {
				try {
					// Leverage the backup workspace file to find out which empty workspace is currently in use to
					// determine which empty workspace storage can safely be deleted
					const contents = await promises.readFile(this.backupWorkspacesPath, 'utf8');

					const workspaces = JSON.parse(contents) as IBackupWorkspacesFormat;
					const emptyWorkspaces = workspaces.emptyWorkspaceInfos.map(info => info.backupFolder);

					// Read all workspace storage folders that exist
					const storageFolders = await readdir(this.environmentService.workspaceStorageHome.fsPath);
					const deletes: Promise<void>[] = [];

					storageFolders.forEach(storageFolder => {
						if (storageFolder.length === StorageDataCleaner.NON_EMPTY_WORKSPACE_ID_LENGTH) {
							return;
						}

						if (emptyWorkspaces.indexOf(storageFolder) === -1) {
							deletes.push(rimraf(join(this.environmentService.workspaceStorageHome.fsPath, storageFolder)));
						}
					});

					await Promise.all(deletes);
				} catch (error) {
					onUnexpectedError(error);
				}
			})();
		}, 30 * 1000);

		this._register(toDisposable(() => {
			if (handle) {
				clearTimeout(handle);
				handle = undefined;
			}
		}));
	}
}
