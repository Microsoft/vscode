/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toWorkspaceFolders, IWorkspaceIdentifier, hasWorkspaceFileExtension, UNTITLED_WORKSPACE_NAME, IResolvedWorkspace, IStoredWorkspaceFolder, isStoredWorkspaceFolder, IWorkspaceFolderCreationData, IUntitledWorkspaceInfo, getStoredWorkspaceFolder, IEnterWorkspaceResult, isUntitledWorkspace, isWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { join, dirname } from 'vs/base/common/path';
import { writeFile, rimrafSync, readdirSync, writeFileSync } from 'vs/base/node/pfs';
import { promises, readFileSync, existsSync, mkdirSync, statSync, Stats } from 'fs';
import { isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { Event, Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { createHash } from 'crypto';
import { parse } from 'vs/base/common/json';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { originalFSPath, joinPath, basename, extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { localize } from 'vs/nls';
import { IProductService } from 'vs/platform/product/common/productService';
import { MessageBoxOptions, BrowserWindow } from 'electron';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogMainService';
import { findWindowOnWorkspaceOrFolder } from 'vs/platform/windows/electron-main/windowsFinder';

export const IWorkspacesManagementMainService = createDecorator<IWorkspacesManagementMainService>('workspacesManagementMainService');

export interface IWorkspaceEnteredEvent {
	window: ICodeWindow;
	workspace: IWorkspaceIdentifier;
}

export interface IWorkspacesManagementMainService {

	readonly _serviceBrand: undefined;

	readonly onDidDeleteUntitledWorkspace: Event<IWorkspaceIdentifier>;
	readonly onDidEnterWorkspace: Event<IWorkspaceEnteredEvent>;

	enterWorkspace(intoWindow: ICodeWindow, openedWindows: ICodeWindow[], path: URI): Promise<IEnterWorkspaceResult | undefined>;

	createUntitledWorkspace(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): Promise<IWorkspaceIdentifier>;
	createUntitledWorkspaceSync(folders?: IWorkspaceFolderCreationData[]): IWorkspaceIdentifier;

	deleteUntitledWorkspace(workspace: IWorkspaceIdentifier): Promise<void>;
	deleteUntitledWorkspaceSync(workspace: IWorkspaceIdentifier): void;

	getUntitledWorkspacesSync(): IUntitledWorkspaceInfo[];
	isUntitledWorkspace(workspace: IWorkspaceIdentifier): boolean;

	resolveLocalWorkspaceSync(path: URI): IResolvedWorkspace | undefined;
	getWorkspaceIdentifier(workspacePath: URI): Promise<IWorkspaceIdentifier>;
}

export interface IStoredWorkspace {
	folders: IStoredWorkspaceFolder[];
	remoteAuthority?: string;
}

export class WorkspacesManagementMainService extends Disposable implements IWorkspacesManagementMainService {

	declare readonly _serviceBrand: undefined;

	private readonly untitledWorkspacesHome = this.environmentMainService.untitledWorkspacesHome; // local URI that contains all untitled workspaces

	private readonly _onDidDeleteUntitledWorkspace = this._register(new Emitter<IWorkspaceIdentifier>());
	readonly onDidDeleteUntitledWorkspace: Event<IWorkspaceIdentifier> = this._onDidDeleteUntitledWorkspace.event;

	private readonly _onDidEnterWorkspace = this._register(new Emitter<IWorkspaceEnteredEvent>());
	readonly onDidEnterWorkspace: Event<IWorkspaceEnteredEvent> = this._onDidEnterWorkspace.event;

	constructor(
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService,
		@IBackupMainService private readonly backupMainService: IBackupMainService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@IProductService private readonly productService: IProductService
	) {
		super();
	}

	resolveLocalWorkspaceSync(uri: URI): IResolvedWorkspace | undefined {
		if (!this.isWorkspacePath(uri)) {
			return undefined; // does not look like a valid workspace config file
		}

		if (uri.scheme !== Schemas.file) {
			return undefined;
		}

		let contents: string;
		try {
			contents = readFileSync(uri.fsPath, 'utf8');
		} catch (error) {
			return undefined; // invalid workspace
		}

		return this.doResolveWorkspace(uri, contents);
	}

	private isWorkspacePath(uri: URI): boolean {
		return isUntitledWorkspace(uri, this.environmentMainService) || hasWorkspaceFileExtension(uri);
	}

	private doResolveWorkspace(path: URI, contents: string): IResolvedWorkspace | undefined {
		try {
			const workspace = this.doParseStoredWorkspace(path, contents);
			const workspaceIdentifier = getWorkspaceIdentifier(path);
			return {
				id: workspaceIdentifier.id,
				configPath: workspaceIdentifier.configPath,
				folders: toWorkspaceFolders(workspace.folders, workspaceIdentifier.configPath, extUriBiasedIgnorePathCase),
				remoteAuthority: workspace.remoteAuthority
			};
		} catch (error) {
			this.logService.warn(error.toString());
		}

		return undefined;
	}

	private doParseStoredWorkspace(path: URI, contents: string): IStoredWorkspace {

		// Parse workspace file
		const storedWorkspace: IStoredWorkspace = parse(contents); // use fault tolerant parser

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

		await promises.mkdir(dirname(configPath), { recursive: true });
		await writeFile(configPath, JSON.stringify(storedWorkspace, null, '\t'));

		return workspace;
	}

	createUntitledWorkspaceSync(folders?: IWorkspaceFolderCreationData[], remoteAuthority?: string): IWorkspaceIdentifier {
		const { workspace, storedWorkspace } = this.newUntitledWorkspace(folders, remoteAuthority);
		const configPath = workspace.configPath.fsPath;

		mkdirSync(dirname(configPath), { recursive: true });
		writeFileSync(configPath, JSON.stringify(storedWorkspace, null, '\t'));

		return workspace;
	}

	private newUntitledWorkspace(folders: IWorkspaceFolderCreationData[] = [], remoteAuthority?: string): { workspace: IWorkspaceIdentifier, storedWorkspace: IStoredWorkspace } {
		const randomId = (Date.now() + Math.round(Math.random() * 1000)).toString();
		const untitledWorkspaceConfigFolder = joinPath(this.untitledWorkspacesHome, randomId);
		const untitledWorkspaceConfigPath = joinPath(untitledWorkspaceConfigFolder, UNTITLED_WORKSPACE_NAME);

		const storedWorkspaceFolder: IStoredWorkspaceFolder[] = [];

		for (const folder of folders) {
			storedWorkspaceFolder.push(getStoredWorkspaceFolder(folder.uri, true, folder.name, untitledWorkspaceConfigFolder, !isWindows, extUriBiasedIgnorePathCase));
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
		return isUntitledWorkspace(workspace.configPath, this.environmentMainService);
	}

	deleteUntitledWorkspaceSync(workspace: IWorkspaceIdentifier): void {
		if (!this.isUntitledWorkspace(workspace)) {
			return; // only supported for untitled workspaces
		}

		// Delete from disk
		this.doDeleteUntitledWorkspaceSync(workspace);

		// Event
		this._onDidDeleteUntitledWorkspace.fire(workspace);
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
			const workspaceStoragePath = join(this.environmentMainService.workspaceStorageHome.fsPath, workspace.id);
			if (existsSync(workspaceStoragePath)) {
				writeFileSync(join(workspaceStoragePath, 'obsolete'), '');
			}
		} catch (error) {
			this.logService.warn(`Unable to delete untitled workspace ${configPath} (${error}).`);
		}
	}

	getUntitledWorkspacesSync(): IUntitledWorkspaceInfo[] {
		const untitledWorkspaces: IUntitledWorkspaceInfo[] = [];
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

	async enterWorkspace(window: ICodeWindow, windows: ICodeWindow[], path: URI): Promise<IEnterWorkspaceResult | undefined> {
		if (!window || !window.win || !window.isReady) {
			return undefined; // return early if the window is not ready or disposed
		}

		const isValid = await this.isValidTargetWorkspacePath(window, windows, path);
		if (!isValid) {
			return undefined; // return early if the workspace is not valid
		}

		const result = this.doEnterWorkspace(window, getWorkspaceIdentifier(path));
		if (!result) {
			return undefined;
		}

		// Emit as event
		this._onDidEnterWorkspace.fire({ window, workspace: result.workspace });

		return result;
	}

	private async isValidTargetWorkspacePath(window: ICodeWindow, windows: ICodeWindow[], workspacePath?: URI): Promise<boolean> {
		if (!workspacePath) {
			return true;
		}

		if (isWorkspaceIdentifier(window.openedWorkspace) && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.configPath, workspacePath)) {
			return false; // window is already opened on a workspace with that path
		}

		// Prevent overwriting a workspace that is currently opened in another window
		if (findWindowOnWorkspaceOrFolder(windows, workspacePath)) {
			const options: MessageBoxOptions = {
				title: this.productService.nameLong,
				type: 'info',
				buttons: [localize('ok', "OK")],
				message: localize('workspaceOpenedMessage', "Unable to save workspace '{0}'", basename(workspacePath)),
				detail: localize('workspaceOpenedDetail', "The workspace is already opened in another window. Please close that window first and then try again."),
				noLink: true
			};

			await this.dialogMainService.showMessageBox(options, withNullAsUndefined(BrowserWindow.getFocusedWindow()));

			return false;
		}

		return true; // OK
	}

	private doEnterWorkspace(window: ICodeWindow, workspace: IWorkspaceIdentifier): IEnterWorkspaceResult | undefined {
		if (!window.config) {
			return undefined;
		}

		window.focus();

		// Register window for backups and migrate current backups over
		let backupPath: string | undefined;
		if (!window.config.extensionDevelopmentPath) {
			backupPath = this.backupMainService.registerWorkspaceBackupSync({ workspace, remoteAuthority: window.remoteAuthority }, window.config.backupPath);
		}

		// if the window was opened on an untitled workspace, delete it.
		if (isWorkspaceIdentifier(window.openedWorkspace) && this.isUntitledWorkspace(window.openedWorkspace)) {
			this.deleteUntitledWorkspaceSync(window.openedWorkspace);
		}

		// Update window configuration properly based on transition to workspace
		window.config.workspace = workspace;
		window.config.backupPath = backupPath;

		return { workspace, backupPath };
	}
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// NOTE: DO NOT CHANGE. IDENTIFIERS HAVE TO REMAIN STABLE
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

export function getWorkspaceIdentifier(configPath: URI): IWorkspaceIdentifier {

	function getWorkspaceId(): string {
		let configPathStr = configPath.scheme === Schemas.file ? originalFSPath(configPath) : configPath.toString();
		if (!isLinux) {
			configPathStr = configPathStr.toLowerCase(); // sanitize for platform file system
		}

		return createHash('md5').update(configPathStr).digest('hex');
	}

	return {
		id: getWorkspaceId(),
		configPath
	};
}

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// NOTE: DO NOT CHANGE. IDENTIFIERS HAVE TO REMAIN STABLE
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

export function getSingleFolderWorkspaceIdentifier(folderUri: URI): ISingleFolderWorkspaceIdentifier | undefined;
export function getSingleFolderWorkspaceIdentifier(folderUri: URI, folderStat: Stats): ISingleFolderWorkspaceIdentifier;
export function getSingleFolderWorkspaceIdentifier(folderUri: URI, folderStat?: Stats): ISingleFolderWorkspaceIdentifier | undefined {

	function getFolderId(): string | undefined {

		// Remote: produce a hash from the entire URI
		if (folderUri.scheme !== Schemas.file) {
			return createHash('md5').update(folderUri.toString()).digest('hex');
		}

		// Local: produce a hash from the path and include creation time as salt
		if (!folderStat) {
			try {
				folderStat = statSync(folderUri.fsPath);
			} catch (error) {
				return undefined; // folder does not exist
			}
		}

		let ctime: number | undefined;
		if (isLinux) {
			ctime = folderStat.ino; // Linux: birthtime is ctime, so we cannot use it! We use the ino instead!
		} else if (isMacintosh) {
			ctime = folderStat.birthtime.getTime(); // macOS: birthtime is fine to use as is
		} else if (isWindows) {
			if (typeof folderStat.birthtimeMs === 'number') {
				ctime = Math.floor(folderStat.birthtimeMs); // Windows: fix precision issue in node.js 8.x to get 7.x results (see https://github.com/nodejs/node/issues/19897)
			} else {
				ctime = folderStat.birthtime.getTime();
			}
		}

		// we use the ctime as extra salt to the ID so that we catch the case of a folder getting
		// deleted and recreated. in that case we do not want to carry over previous state
		return createHash('md5').update(folderUri.fsPath).update(ctime ? String(ctime) : '').digest('hex');
	}

	const folderId = getFolderId();
	if (typeof folderId === 'string') {
		return {
			id: folderId,
			uri: folderUri
		};
	}

	return undefined; // invalid folder
}
