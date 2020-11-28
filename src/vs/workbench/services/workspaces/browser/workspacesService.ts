/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkspacesService, IWorkspaceFolderCreationData, IWorkspaceIdentifier, IEnterWorkspaceResult, IRecentlyOpened, restoreRecentlyOpened, IRecent, isRecentFile, isRecentFolder, toStoreData, IStoredWorkspaceFolder, getStoredWorkspaceFolder, WORKSPACE_EXTENSION, IStoredWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { URI } from 'vs/base/common/uri';
import { Emitter } from 'vs/base/common/event';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { getWorkspaceIdentifier } from 'vs/workbench/services/workspaces/browser/workspaces';
import { IFileService, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { joinPath } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';

export class BrowserWorkspacesService extends Disposable implements IWorkspacesService {

	static readonly RECENTLY_OPENED_KEY = 'recently.opened';

	declare readonly _serviceBrand: undefined;

	private readonly _onRecentlyOpenedChange = this._register(new Emitter<void>());
	readonly onRecentlyOpenedChange = this._onRecentlyOpenedChange.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) {
		super();

		// Opening a workspace should push it as most
		// recently used to the workspaces history
		this.addWorkspaceToRecentlyOpened();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.storageService.onDidChangeValue(event => {
			if (event.key === BrowserWorkspacesService.RECENTLY_OPENED_KEY && event.scope === StorageScope.GLOBAL) {
				this._onRecentlyOpenedChange.fire();
			}
		}));
	}

	private addWorkspaceToRecentlyOpened(): void {
		const workspace = this.workspaceService.getWorkspace();
		switch (this.workspaceService.getWorkbenchState()) {
			case WorkbenchState.FOLDER:
				this.addRecentlyOpened([{ folderUri: workspace.folders[0].uri }]);
				break;
			case WorkbenchState.WORKSPACE:
				this.addRecentlyOpened([{ workspace: { id: workspace.id, configPath: workspace.configuration! } }]);
				break;
		}
	}

	//#region Workspaces History

	async getRecentlyOpened(): Promise<IRecentlyOpened> {
		const recentlyOpenedRaw = this.storageService.get(BrowserWorkspacesService.RECENTLY_OPENED_KEY, StorageScope.GLOBAL);
		if (recentlyOpenedRaw) {
			return restoreRecentlyOpened(JSON.parse(recentlyOpenedRaw), this.logService);
		}

		return { workspaces: [], files: [] };
	}

	async addRecentlyOpened(recents: IRecent[]): Promise<void> {
		const recentlyOpened = await this.getRecentlyOpened();

		recents.forEach(recent => {
			if (isRecentFile(recent)) {
				this.doRemoveRecentlyOpened(recentlyOpened, [recent.fileUri]);
				recentlyOpened.files.unshift(recent);
			} else if (isRecentFolder(recent)) {
				this.doRemoveRecentlyOpened(recentlyOpened, [recent.folderUri]);
				recentlyOpened.workspaces.unshift(recent);
			} else {
				this.doRemoveRecentlyOpened(recentlyOpened, [recent.workspace.configPath]);
				recentlyOpened.workspaces.unshift(recent);
			}
		});

		return this.saveRecentlyOpened(recentlyOpened);
	}

	async removeRecentlyOpened(paths: URI[]): Promise<void> {
		const recentlyOpened = await this.getRecentlyOpened();

		this.doRemoveRecentlyOpened(recentlyOpened, paths);

		return this.saveRecentlyOpened(recentlyOpened);
	}

	private doRemoveRecentlyOpened(recentlyOpened: IRecentlyOpened, paths: URI[]): void {
		recentlyOpened.files = recentlyOpened.files.filter(file => {
			return !paths.some(path => path.toString() === file.fileUri.toString());
		});

		recentlyOpened.workspaces = recentlyOpened.workspaces.filter(workspace => {
			return !paths.some(path => path.toString() === (isRecentFolder(workspace) ? workspace.folderUri.toString() : workspace.workspace.configPath.toString()));
		});
	}

	private async saveRecentlyOpened(data: IRecentlyOpened): Promise<void> {
		return this.storageService.store(BrowserWorkspacesService.RECENTLY_OPENED_KEY, JSON.stringify(toStoreData(data)), StorageScope.GLOBAL, StorageTarget.USER);
	}

	async clearRecentlyOpened(): Promise<void> {
		this.storageService.remove(BrowserWorkspacesService.RECENTLY_OPENED_KEY, StorageScope.GLOBAL);
	}

	//#endregion

	//#region Workspace Management

	async enterWorkspace(path: URI): Promise<IEnterWorkspaceResult | null> {
		return { workspace: await this.getWorkspaceIdentifier(path) };
	}

	async createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier> {
		const randomId = (Date.now() + Math.round(Math.random() * 1000)).toString();
		const newUntitledWorkspacePath = joinPath(this.environmentService.untitledWorkspacesHome, `Untitled-${randomId}.${WORKSPACE_EXTENSION}`);

		// Build array of workspace folders to store
		const storedWorkspaceFolder: IStoredWorkspaceFolder[] = [];
		if (folders) {
			for (const folder of folders) {
				storedWorkspaceFolder.push(getStoredWorkspaceFolder(folder.uri, true, folder.name, this.environmentService.untitledWorkspacesHome));
			}
		}

		// Store at untitled workspaces location
		const storedWorkspace: IStoredWorkspace = { folders: storedWorkspaceFolder, remoteAuthority };
		await this.fileService.writeFile(newUntitledWorkspacePath, VSBuffer.fromString(JSON.stringify(storedWorkspace, null, '\t')));

		return this.getWorkspaceIdentifier(newUntitledWorkspacePath);
	}

	async deleteUntitledWorkspace(workspace: IWorkspaceIdentifier): Promise<void> {
		try {
			await this.fileService.del(workspace.configPath);
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				throw error; // re-throw any other error than file not found which is OK
			}
		}
	}

	async getWorkspaceIdentifier(workspacePath: URI): Promise<IWorkspaceIdentifier> {
		return getWorkspaceIdentifier(workspacePath);
	}

	//#endregion


	//#region Dirty Workspaces

	async getDirtyWorkspaces(): Promise<Array<IWorkspaceIdentifier | URI>> {
		return []; // Currently not supported in web
	}

	//#endregion
}

registerSingleton(IWorkspacesService, BrowserWorkspacesService, true);
