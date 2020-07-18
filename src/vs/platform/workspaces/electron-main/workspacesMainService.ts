/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceIdentifier, hasWorkspaceFileExtension, UNTITLED_WORKSPACE_NAME, IResolvedWorkspace, IStoredWorkspaceFolder, isStoredWorkspaceFolder, IWorkspaceFolderCreationData, IUntitledWorkspaceInfo, getStoredWorkspaceFolder, IEnterWorkspaceResult, isUntitledWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { join, dirname } from 'vs/base/common/path';
import { mkdirp, writeFile, rimrafSync, readdirSync, writeFileSync } from 'vs/base/node/pfs';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { isLinux } from 'vs/base/common/platform';
import { Event, Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { createHash } from 'crypto';
import * as json from 'vs/base/common/json';
import { toWorkspaceFolders } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { originalFSPath, joinPath, basename, extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { localize } from 'vs/nls';
import product from 'vs/platform/product/common/product';
import { MessageBoxOptions, BrowserWindow } from 'electron';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { findWindowOnWorkspace } from 'vs/platform/windows/node/window';

export const IWorkspacesMainService = createDecorator<IWorkspacesMainService>('workspacesMainService');

export interface IWorkspaceEnteredEvent {
	window: ICodeWindow;
	workspace: IWorkspaceIdentifier;
}

export interface IWorkspacesMainService {

	readonly _serviceBrand: undefined;

	readonly onUntitledWorkspaceDeleted: Event<IWorkspaceIdentifier>;
	readonly onWorkspaceEntered: Event<IWorkspaceEnteredEvent>;

	enterWorkspace(intoWindow: ICodeWindow, openedWindows: ICodeWindow[], path: URI): Promise<IEnterWorkspaceResult | null>;

	createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier>;
	createUntitledWorkspaceSync(folders?: IWorkspaceFolderCreationData[]): IWorkspaceIdentifier;

	deleteUntitledWorkspace(workspace: IWorkspaceIdentifier): Promise<void>;
	deleteUntitledWorkspaceSync(workspace: IWorkspaceIdentifier): void;

	getUntitledWorkspacesSync(): IUntitledWorkspaceInfo[];
	isUntitledWorkspace(workspace: IWorkspaceIdentifier): boolean;

	resolveLocalWorkspaceSync(path: URI): IResolvedWorkspace | null;
	getWorkspaceIdentifier(workspacePath: URI): Promise<IWorkspaceIdentifier>;
}

export interface IStoredWorkspace {
	folders: IStoredWorkspaceFolder[];
	remoteAuthority?: string;
}

export class WorkspacesMainService extends Disposable implements IWorkspacesMainService {

	declare readonly _serviceBrand: undefined;

	private readonly untitledWorkspacesHome: URI; // local URI that contains all untitled workspaces

	private readonly _onUntitledWorkspaceDeleted = this._register(new Emitter<IWorkspaceIdentifier>());
	readonly onUntitledWorkspaceDeleted: Event<IWorkspaceIdentifier> = this._onUntitledWorkspaceDeleted.event;

	private readonly _onWorkspaceEntered = this._register(new Emitter<IWorkspaceEnteredEvent>());
	readonly onWorkspaceEntered: Event<IWorkspaceEnteredEvent> = this._onWorkspaceEntered.event;

	constructor(
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IBackupMainService private readonly backupMainService: IBackupMainService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService
	) {
		super();

		this.untitledWorkspacesHome = environmentService.untitledWorkspacesHome;
	}

	resolveLocalWorkspaceSync(uri: URI): IResolvedWorkspace | null {
		if (!this.isWorkspacePath(uri)) {
			return null; // does not look like a valid workspace config file
		}
		if (uri.scheme !== Schemas.file) {
			return null;
		}

		let contents: string;
		try {
			contents = readFileSync(uri.fsPath, 'utf8');
		} catch (error) {
			return null; // invalid workspace
		}

		return this.doResolveWorkspace(uri, contents);
	}

	private isWorkspacePath(uri: URI): boolean {
		return isUntitledWorkspace(uri, this.environmentService) || hasWorkspaceFileExtension(uri);
	}

	private doResolveWorkspace(path: URI, contents: string): IResolvedWorkspace | null {
		try {
			const workspace = this.doParseStoredWorkspace(path, contents);
			const workspaceIdentifier = getWorkspaceIdentifier(path);
			return {
				id: workspaceIdentifier.id,
				configPath: workspaceIdentifier.configPath,
				folders: toWorkspaceFolders(workspace.folders, workspaceIdentifier.configPath),
				remoteAuthority: workspace.remoteAuthority
			};
		} catch (error) {
			this.logService.warn(error.toString());
		}

		return null;
	}

	private doParseStoredWorkspace(path: URI, contents: string): IStoredWorkspace {

		// Parse workspace file
		let storedWorkspace: IStoredWorkspace = json.parse(contents); // use fault tolerant parser

		// Filter out folders which do not have a path or uri set
		if (storedWorkspace && Array.isArray(storedWorkspace.folders)) {
			storedWorkspace.folders = storedWorkspace.folders.filter(folder => isStoredWorkspaceFolder(folder));
		} else {
			throw new Error(`${path.toString(true)} looks like an invalid workspace file.`);
		}

		return storedWorkspace;
	}

	async createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier> {
		const { workspace, storedWorkspace } = this.newUntitledWorkspace(folders, remoteAuthority);
		const configPath = workspace.configPath.fsPath;

		await mkdirp(dirname(configPath));
		await writeFile(configPath, JSON.stringify(storedWorkspace, null, '\t'));

		return workspace;
	}

	createUntitledWorkspaceSync(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): IWorkspaceIdentifier {
		const { workspace, storedWorkspace } = this.newUntitledWorkspace(folders, remoteAuthority);
		const configPath = workspace.configPath.fsPath;

		const configPathDir = dirname(configPath);
		if (!existsSync(configPathDir)) {
			const configPathDirDir = dirname(configPathDir);
			if (!existsSync(configPathDirDir)) {
				mkdirSync(configPathDirDir);
			}
			mkdirSync(configPathDir);
		}

		writeFileSync(configPath, JSON.stringify(storedWorkspace, null, '\t'));

		return workspace;
	}

	private newUntitledWorkspace(folders: IWorkspaceFolderCreationData[] = [], remoteAuthority?: string): { workspace: IWorkspaceIdentifier, storedWorkspace: IStoredWorkspace } {
		const randomId = (Date.now() + Math.round(Math.random() * 1000)).toString();
		const untitledWorkspaceConfigFolder = joinPath(this.untitledWorkspacesHome, randomId);
		const untitledWorkspaceConfigPath = joinPath(untitledWorkspaceConfigFolder, UNTITLED_WORKSPACE_NAME);

		const storedWorkspaceFolder: IStoredWorkspaceFolder[] = [];

		for (const folder of folders) {
			storedWorkspaceFolder.push(getStoredWorkspaceFolder(folder.uri, true, folder.name, untitledWorkspaceConfigFolder));
		}

		return {
			workspace: getWorkspaceIdentifier(untitledWorkspaceConfigPath),
			storedWorkspace: { folders: storedWorkspaceFolder, remoteAuthority }
		};
	}

	async getWorkspaceIdentifier(configPath: URI): Promise<IWorkspaceIdentifier> {
		return getWorkspaceIdentifier(configPath);
	}

	isUntitledWorkspace(workspace: IWorkspaceIdentifier): boolean {
		return isUntitledWorkspace(workspace.configPath, this.environmentService);
	}

	deleteUntitledWorkspaceSync(workspace: IWorkspaceIdentifier): void {
		if (!this.isUntitledWorkspace(workspace)) {
			return; // only supported for untitled workspaces
		}

		// Delete from disk
		this.doDeleteUntitledWorkspaceSync(workspace);

		// Event
		this._onUntitledWorkspaceDeleted.fire(workspace);
	}

	async deleteUntitledWorkspace(workspace: IWorkspaceIdentifier): Promise<void> {
		this.deleteUntitledWorkspaceSync(workspace);
	}

	private doDeleteUntitledWorkspaceSync(workspace: IWorkspaceIdentifier): void {
		const configPath = originalFSPath(workspace.configPath);
		try {

			// Delete Workspace
			rimrafSync(dirname(configPath));

			// Mark Workspace Storage to be deleted
			const workspaceStoragePath = join(this.environmentService.workspaceStorageHome.fsPath, workspace.id);
			if (existsSync(workspaceStoragePath)) {
				writeFileSync(join(workspaceStoragePath, 'obsolete'), '');
			}
		} catch (error) {
			this.logService.warn(`Unable to delete untitled workspace ${configPath} (${error}).`);
		}
	}

	getUntitledWorkspacesSync(): IUntitledWorkspaceInfo[] {
		let untitledWorkspaces: IUntitledWorkspaceInfo[] = [];
		try {
			const untitledWorkspacePaths = readdirSync(this.untitledWorkspacesHome.fsPath).map(folder => joinPath(this.untitledWorkspacesHome, folder, UNTITLED_WORKSPACE_NAME));
			for (const untitledWorkspacePath of untitledWorkspacePaths) {
				const workspace = getWorkspaceIdentifier(untitledWorkspacePath);
				const resolvedWorkspace = this.resolveLocalWorkspaceSync(untitledWorkspacePath);
				if (!resolvedWorkspace) {
					this.doDeleteUntitledWorkspaceSync(workspace);
				} else {
					untitledWorkspaces.push({ workspace, remoteAuthority: resolvedWorkspace.remoteAuthority });
				}
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.logService.warn(`Unable to read folders in ${this.untitledWorkspacesHome} (${error}).`);
			}
		}
		return untitledWorkspaces;
	}

	async enterWorkspace(window: ICodeWindow, windows: ICodeWindow[], path: URI): Promise<IEnterWorkspaceResult | null> {
		if (!window || !window.win || !window.isReady) {
			return null; // return early if the window is not ready or disposed
		}

		const isValid = await this.isValidTargetWorkspacePath(window, windows, path);
		if (!isValid) {
			return null; // return early if the workspace is not valid
		}

		const result = this.doEnterWorkspace(window, getWorkspaceIdentifier(path));
		if (!result) {
			return null;
		}

		// Emit as event
		this._onWorkspaceEntered.fire({ window, workspace: result.workspace });

		return result;
	}

	private async isValidTargetWorkspacePath(window: ICodeWindow, windows: ICodeWindow[], path?: URI): Promise<boolean> {
		if (!path) {
			return true;
		}

		if (window.openedWorkspace && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.configPath, path)) {
			return false; // window is already opened on a workspace with that path
		}

		// Prevent overwriting a workspace that is currently opened in another window
		if (findWindowOnWorkspace(windows, getWorkspaceIdentifier(path))) {
			const options: MessageBoxOptions = {
				title: product.nameLong,
				type: 'info',
				buttons: [localize('ok', "OK")],
				message: localize('workspaceOpenedMessage', "Unable to save workspace '{0}'", basename(path)),
				detail: localize('workspaceOpenedDetail', "The workspace is already opened in another window. Please close that window first and then try again."),
				noLink: true
			};

			await this.dialogMainService.showMessageBox(options, withNullAsUndefined(BrowserWindow.getFocusedWindow()));

			return false;
		}

		return true; // OK
	}

	private doEnterWorkspace(window: ICodeWindow, workspace: IWorkspaceIdentifier): IEnterWorkspaceResult | null {
		if (!window.config) {
			return null;
		}

		window.focus();

		// Register window for backups and migrate current backups over
		let backupPath: string | undefined;
		if (!window.config.extensionDevelopmentPath) {
			backupPath = this.backupMainService.registerWorkspaceBackupSync({ workspace, remoteAuthority: window.remoteAuthority }, window.config.backupPath);
		}

		// if the window was opened on an untitled workspace, delete it.
		if (window.openedWorkspace && this.isUntitledWorkspace(window.openedWorkspace)) {
			this.deleteUntitledWorkspaceSync(window.openedWorkspace);
		}

		// Update window configuration properly based on transition to workspace
		window.config.folderUri = undefined;
		window.config.workspace = workspace;
		window.config.backupPath = backupPath;

		return { workspace, backupPath };
	}
}

function getWorkspaceId(configPath: URI): string {
	let workspaceConfigPath = configPath.scheme === Schemas.file ? originalFSPath(configPath) : configPath.toString();
	if (!isLinux) {
		workspaceConfigPath = workspaceConfigPath.toLowerCase(); // sanitize for platform file system
	}

	return createHash('md5').update(workspaceConfigPath).digest('hex');
}

export function getWorkspaceIdentifier(configPath: URI): IWorkspaceIdentifier {
	return {
		configPath,
		id: getWorkspaceId(configPath)
	};
}
