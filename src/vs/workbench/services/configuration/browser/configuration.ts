/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import * as resources from 'vs/base/common/resources';
import { Event, Emitter } from 'vs/base/common/event';
import * as errors from 'vs/base/common/errors';
import { Disposable, IDisposable, dispose, toDisposable, MutableDisposable, combinedDisposable } from 'vs/base/common/lifecycle';
import { RunOnceScheduler } from 'vs/base/common/async';
import { FileChangeType, FileChangesEvent, IFileService, whenProviderRegistered, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { ConfigurationModel, ConfigurationModelParser, UserSettings } from 'vs/platform/configuration/common/configurationModels';
import { WorkspaceConfigurationModelParser, StandaloneConfigurationModelParser } from 'vs/workbench/services/configuration/common/configurationModels';
import { TASKS_CONFIGURATION_KEY, FOLDER_SETTINGS_NAME, LAUNCH_CONFIGURATION_KEY, IConfigurationCache, ConfigurationKey, REMOTE_MACHINE_SCOPES, FOLDER_SCOPES, WORKSPACE_SCOPES } from 'vs/workbench/services/configuration/common/configuration';
import { IStoredWorkspaceFolder, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { JSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditingService';
import { WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { join } from 'vs/base/common/path';
import { equals } from 'vs/base/common/objects';
import { IConfigurationModel } from 'vs/platform/configuration/common/configuration';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { hash } from 'vs/base/common/hash';

export class UserConfiguration extends Disposable {

	private readonly _onDidChangeConfiguration: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	readonly onDidChangeConfiguration: Event<ConfigurationModel> = this._onDidChangeConfiguration.event;

	private readonly userConfiguration: MutableDisposable<UserSettings | FileServiceBasedConfiguration> = this._register(new MutableDisposable<UserSettings | FileServiceBasedConfiguration>());
	private readonly reloadConfigurationScheduler: RunOnceScheduler;

	get hasTasksLoaded(): boolean { return this.userConfiguration.value instanceof FileServiceBasedConfiguration; }

	constructor(
		private readonly userSettingsResource: URI,
		private readonly scopes: ConfigurationScope[] | undefined,
		private readonly fileService: IFileService
	) {
		super();
		this.userConfiguration.value = new UserSettings(this.userSettingsResource, this.scopes, this.fileService);
		this._register(this.userConfiguration.value.onDidChange(() => this.reloadConfigurationScheduler.schedule()));
		this.reloadConfigurationScheduler = this._register(new RunOnceScheduler(() => this.reload().then(configurationModel => this._onDidChangeConfiguration.fire(configurationModel)), 50));
	}

	async initialize(): Promise<ConfigurationModel> {
		return this.userConfiguration.value!.loadConfiguration();
	}

	async reload(): Promise<ConfigurationModel> {
		if (this.hasTasksLoaded) {
			return this.userConfiguration.value!.loadConfiguration();
		}

		const folder = resources.dirname(this.userSettingsResource);
		const standAloneConfigurationResources: [string, URI][] = [TASKS_CONFIGURATION_KEY].map(name => ([name, resources.joinPath(folder, `${name}.json`)]));
		const fileServiceBasedConfiguration = new FileServiceBasedConfiguration(folder.toString(), [this.userSettingsResource], standAloneConfigurationResources, this.scopes, this.fileService);
		const configurationModel = await fileServiceBasedConfiguration.loadConfiguration();
		this.userConfiguration.value = fileServiceBasedConfiguration;

		// Check for value because userConfiguration might have been disposed.
		if (this.userConfiguration.value) {
			this._register(this.userConfiguration.value.onDidChange(() => this.reloadConfigurationScheduler.schedule()));
		}

		return configurationModel;
	}

	reprocess(): ConfigurationModel {
		return this.userConfiguration.value!.reprocess();
	}
}

class FileServiceBasedConfiguration extends Disposable {

	private readonly allResources: URI[];
	private _folderSettingsModelParser: ConfigurationModelParser;
	private _standAloneConfigurations: ConfigurationModel[];
	private _cache: ConfigurationModel;

	private readonly changeEventTriggerScheduler: RunOnceScheduler;
	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		name: string,
		private readonly settingsResources: URI[],
		private readonly standAloneConfigurationResources: [string, URI][],
		private readonly scopes: ConfigurationScope[] | undefined,
		private fileService: IFileService
	) {
		super();
		this.allResources = [...this.settingsResources, ...this.standAloneConfigurationResources.map(([, resource]) => resource)];
		this._register(combinedDisposable(...this.allResources.map(resource => this.fileService.watch(resources.dirname(resource)))));
		this._folderSettingsModelParser = new ConfigurationModelParser(name, this.scopes);
		this._standAloneConfigurations = [];
		this._cache = new ConfigurationModel();

		this.changeEventTriggerScheduler = this._register(new RunOnceScheduler(() => this._onDidChange.fire(), 50));
		this._register(this.fileService.onDidFilesChange((e) => this.handleFileEvents(e)));
	}

	async loadConfiguration(): Promise<ConfigurationModel> {
		const resolveContents = async (resources: URI[]): Promise<(string | undefined)[]> => {
			return Promise.all(resources.map(async resource => {
				try {
					const content = await this.fileService.readFile(resource);
					return content.value.toString();
				} catch (error) {
					if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND
						&& (<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_DIRECTORY) {
						errors.onUnexpectedError(error);
					}
				}
				return '{}';
			}));
		};

		const [settingsContents, standAloneConfigurationContents] = await Promise.all([
			resolveContents(this.settingsResources),
			resolveContents(this.standAloneConfigurationResources.map(([, resource]) => resource)),
		]);

		// reset
		this._standAloneConfigurations = [];
		this._folderSettingsModelParser.parseContent('');

		// parse
		if (settingsContents[0] !== undefined) {
			this._folderSettingsModelParser.parseContent(settingsContents[0]);
		}
		for (let index = 0; index < standAloneConfigurationContents.length; index++) {
			const contents = standAloneConfigurationContents[index];
			if (contents !== undefined) {
				const standAloneConfigurationModelParser = new StandaloneConfigurationModelParser(this.standAloneConfigurationResources[index][1].toString(), this.standAloneConfigurationResources[index][0]);
				standAloneConfigurationModelParser.parseContent(contents);
				this._standAloneConfigurations.push(standAloneConfigurationModelParser.configurationModel);
			}
		}

		// Consolidate (support *.json files in the workspace settings folder)
		this.consolidate();

		return this._cache;
	}

	reprocess(): ConfigurationModel {
		const oldContents = this._folderSettingsModelParser.configurationModel.contents;
		this._folderSettingsModelParser.parse();
		if (!equals(oldContents, this._folderSettingsModelParser.configurationModel.contents)) {
			this.consolidate();
		}
		return this._cache;
	}

	private consolidate(): void {
		this._cache = this._folderSettingsModelParser.configurationModel.merge(...this._standAloneConfigurations);
	}

	protected async handleFileEvents(event: FileChangesEvent): Promise<void> {
		const isAffectedByChanges = (): boolean => {
			// One of the resources has changed
			if (this.allResources.some(resource => event.contains(resource))) {
				return true;
			}
			// One of the resource's parent got deleted
			if (this.allResources.some(resource => event.contains(resources.dirname(resource), FileChangeType.DELETED))) {
				return true;
			}
			return false;
		};
		if (isAffectedByChanges()) {
			this.changeEventTriggerScheduler.schedule();
		}
	}

}

export class RemoteUserConfiguration extends Disposable {

	private readonly _cachedConfiguration: CachedRemoteUserConfiguration;
	private readonly _fileService: IFileService;
	private _userConfiguration: FileServiceBasedRemoteUserConfiguration | CachedRemoteUserConfiguration;
	private _userConfigurationInitializationPromise: Promise<ConfigurationModel> | null = null;

	private readonly _onDidChangeConfiguration: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	public readonly onDidChangeConfiguration: Event<ConfigurationModel> = this._onDidChangeConfiguration.event;

	constructor(
		remoteAuthority: string,
		configurationCache: IConfigurationCache,
		fileService: IFileService,
		remoteAgentService: IRemoteAgentService
	) {
		super();
		this._fileService = fileService;
		this._userConfiguration = this._cachedConfiguration = new CachedRemoteUserConfiguration(remoteAuthority, configurationCache);
		remoteAgentService.getEnvironment().then(async environment => {
			if (environment) {
				const userConfiguration = this._register(new FileServiceBasedRemoteUserConfiguration(environment.settingsPath, REMOTE_MACHINE_SCOPES, this._fileService));
				this._register(userConfiguration.onDidChangeConfiguration(configurationModel => this.onDidUserConfigurationChange(configurationModel)));
				this._userConfigurationInitializationPromise = userConfiguration.initialize();
				const configurationModel = await this._userConfigurationInitializationPromise;
				this._userConfiguration.dispose();
				this._userConfiguration = userConfiguration;
				this.onDidUserConfigurationChange(configurationModel);
			}
		});
	}

	async initialize(): Promise<ConfigurationModel> {
		if (this._userConfiguration instanceof FileServiceBasedRemoteUserConfiguration) {
			return this._userConfiguration.initialize();
		}

		// Initialize cached configuration
		let configurationModel = await this._userConfiguration.initialize();
		if (this._userConfigurationInitializationPromise) {
			// Use user configuration
			configurationModel = await this._userConfigurationInitializationPromise;
			this._userConfigurationInitializationPromise = null;
		}

		return configurationModel;
	}

	reload(): Promise<ConfigurationModel> {
		return this._userConfiguration.reload();
	}

	reprocess(): ConfigurationModel {
		return this._userConfiguration.reprocess();
	}

	private onDidUserConfigurationChange(configurationModel: ConfigurationModel): void {
		this.updateCache(configurationModel);
		this._onDidChangeConfiguration.fire(configurationModel);
	}

	private updateCache(configurationModel: ConfigurationModel): Promise<void> {
		return this._cachedConfiguration.updateConfiguration(configurationModel);
	}
}

class FileServiceBasedRemoteUserConfiguration extends Disposable {

	private readonly parser: ConfigurationModelParser;
	private readonly reloadConfigurationScheduler: RunOnceScheduler;
	protected readonly _onDidChangeConfiguration: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	readonly onDidChangeConfiguration: Event<ConfigurationModel> = this._onDidChangeConfiguration.event;

	private fileWatcherDisposable: IDisposable = Disposable.None;
	private directoryWatcherDisposable: IDisposable = Disposable.None;

	constructor(
		private readonly configurationResource: URI,
		private readonly scopes: ConfigurationScope[] | undefined,
		private readonly fileService: IFileService
	) {
		super();

		this.parser = new ConfigurationModelParser(this.configurationResource.toString(), this.scopes);
		this._register(fileService.onDidFilesChange(e => this.handleFileEvents(e)));
		this.reloadConfigurationScheduler = this._register(new RunOnceScheduler(() => this.reload().then(configurationModel => this._onDidChangeConfiguration.fire(configurationModel)), 50));
		this._register(toDisposable(() => {
			this.stopWatchingResource();
			this.stopWatchingDirectory();
		}));
	}

	private watchResource(): void {
		this.fileWatcherDisposable = this.fileService.watch(this.configurationResource);
	}

	private stopWatchingResource(): void {
		this.fileWatcherDisposable.dispose();
		this.fileWatcherDisposable = Disposable.None;
	}

	private watchDirectory(): void {
		const directory = resources.dirname(this.configurationResource);
		this.directoryWatcherDisposable = this.fileService.watch(directory);
	}

	private stopWatchingDirectory(): void {
		this.directoryWatcherDisposable.dispose();
		this.directoryWatcherDisposable = Disposable.None;
	}

	async initialize(): Promise<ConfigurationModel> {
		const exists = await this.fileService.exists(this.configurationResource);
		this.onResourceExists(exists);
		return this.reload();
	}

	async reload(): Promise<ConfigurationModel> {
		try {
			const content = await this.fileService.readFile(this.configurationResource);
			this.parser.parseContent(content.value.toString());
			return this.parser.configurationModel;
		} catch (e) {
			return new ConfigurationModel();
		}
	}

	reprocess(): ConfigurationModel {
		this.parser.parse();
		return this.parser.configurationModel;
	}

	private async handleFileEvents(event: FileChangesEvent): Promise<void> {

		// Find changes that affect the resource
		let affectedByChanges = event.contains(this.configurationResource, FileChangeType.UPDATED);
		if (event.contains(this.configurationResource, FileChangeType.ADDED)) {
			affectedByChanges = true;
			this.onResourceExists(true);
		} else if (event.contains(this.configurationResource, FileChangeType.DELETED)) {
			affectedByChanges = true;
			this.onResourceExists(false);
		}

		if (affectedByChanges) {
			this.reloadConfigurationScheduler.schedule();
		}
	}

	private onResourceExists(exists: boolean): void {
		if (exists) {
			this.stopWatchingDirectory();
			this.watchResource();
		} else {
			this.stopWatchingResource();
			this.watchDirectory();
		}
	}
}

class CachedRemoteUserConfiguration extends Disposable {

	private readonly _onDidChange: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	readonly onDidChange: Event<ConfigurationModel> = this._onDidChange.event;

	private readonly key: ConfigurationKey;
	private configurationModel: ConfigurationModel;

	constructor(
		remoteAuthority: string,
		private readonly configurationCache: IConfigurationCache
	) {
		super();
		this.key = { type: 'user', key: remoteAuthority };
		this.configurationModel = new ConfigurationModel();
	}

	getConfigurationModel(): ConfigurationModel {
		return this.configurationModel;
	}

	initialize(): Promise<ConfigurationModel> {
		return this.reload();
	}

	reprocess(): ConfigurationModel {
		return this.configurationModel;
	}

	async reload(): Promise<ConfigurationModel> {
		const content = await this.configurationCache.read(this.key);
		try {
			const parsed: IConfigurationModel = JSON.parse(content);
			this.configurationModel = new ConfigurationModel(parsed.contents, parsed.keys, parsed.overrides);
		} catch (e) {
		}
		return this.configurationModel;
	}

	updateConfiguration(configurationModel: ConfigurationModel): Promise<void> {
		if (configurationModel.keys.length) {
			return this.configurationCache.write(this.key, JSON.stringify(configurationModel.toJSON()));
		} else {
			return this.configurationCache.remove(this.key);
		}
	}
}

export class WorkspaceConfiguration extends Disposable {

	private readonly _fileService: IFileService;
	private readonly _cachedConfiguration: CachedWorkspaceConfiguration;
	private _workspaceConfiguration: IWorkspaceConfiguration;
	private _workspaceConfigurationChangeDisposable: IDisposable = Disposable.None;
	private _workspaceIdentifier: IWorkspaceIdentifier | null = null;

	private readonly _onDidUpdateConfiguration: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidUpdateConfiguration: Event<void> = this._onDidUpdateConfiguration.event;

	private _initialized: boolean = false;
	get initialized(): boolean { return this._initialized; }
	constructor(
		private readonly configurationCache: IConfigurationCache,
		fileService: IFileService
	) {
		super();
		this._fileService = fileService;
		this._workspaceConfiguration = this._cachedConfiguration = new CachedWorkspaceConfiguration(configurationCache);
	}

	async initialize(workspaceIdentifier: IWorkspaceIdentifier): Promise<void> {
		this._workspaceIdentifier = workspaceIdentifier;
		if (!this._initialized) {
			if (this.configurationCache.needsCaching(this._workspaceIdentifier.configPath)) {
				this._workspaceConfiguration = this._cachedConfiguration;
				this.waitAndInitialize(this._workspaceIdentifier);
			} else {
				this.doInitialize(new FileServiceBasedWorkspaceConfiguration(this._fileService));
			}
		}
		await this.reload();
	}

	async reload(): Promise<void> {
		if (this._workspaceIdentifier) {
			await this._workspaceConfiguration.load(this._workspaceIdentifier);
		}
	}

	getFolders(): IStoredWorkspaceFolder[] {
		return this._workspaceConfiguration.getFolders();
	}

	setFolders(folders: IStoredWorkspaceFolder[], jsonEditingService: JSONEditingService): Promise<void> {
		if (this._workspaceIdentifier) {
			return jsonEditingService.write(this._workspaceIdentifier.configPath, [{ path: ['folders'], value: folders }], true)
				.then(() => this.reload());
		}
		return Promise.resolve();
	}

	getConfiguration(): ConfigurationModel {
		return this._workspaceConfiguration.getWorkspaceSettings();
	}

	reprocessWorkspaceSettings(): ConfigurationModel {
		this._workspaceConfiguration.reprocessWorkspaceSettings();
		return this.getConfiguration();
	}

	private async waitAndInitialize(workspaceIdentifier: IWorkspaceIdentifier): Promise<void> {
		await whenProviderRegistered(workspaceIdentifier.configPath, this._fileService);
		if (!(this._workspaceConfiguration instanceof FileServiceBasedWorkspaceConfiguration)) {
			const fileServiceBasedWorkspaceConfiguration = this._register(new FileServiceBasedWorkspaceConfiguration(this._fileService));
			await fileServiceBasedWorkspaceConfiguration.load(workspaceIdentifier);
			this.doInitialize(fileServiceBasedWorkspaceConfiguration);
			this.onDidWorkspaceConfigurationChange(false);
		}
	}

	private doInitialize(fileServiceBasedWorkspaceConfiguration: FileServiceBasedWorkspaceConfiguration): void {
		this._workspaceConfiguration.dispose();
		this._workspaceConfigurationChangeDisposable.dispose();
		this._workspaceConfiguration = this._register(fileServiceBasedWorkspaceConfiguration);
		this._workspaceConfigurationChangeDisposable = this._register(this._workspaceConfiguration.onDidChange(e => this.onDidWorkspaceConfigurationChange(true)));
		this._initialized = true;
	}

	private async onDidWorkspaceConfigurationChange(reload: boolean): Promise<void> {
		if (reload) {
			await this.reload();
		}
		this.updateCache();
		this._onDidUpdateConfiguration.fire();
	}

	private updateCache(): Promise<void> {
		if (this._workspaceIdentifier && this.configurationCache.needsCaching(this._workspaceIdentifier.configPath) && this._workspaceConfiguration instanceof FileServiceBasedWorkspaceConfiguration) {
			return this._workspaceConfiguration.load(this._workspaceIdentifier)
				.then(() => this._cachedConfiguration.updateWorkspace(this._workspaceIdentifier!, this._workspaceConfiguration.getConfigurationModel()));
		}
		return Promise.resolve(undefined);
	}
}

interface IWorkspaceConfiguration extends IDisposable {
	readonly onDidChange: Event<void>;
	workspaceConfigurationModelParser: WorkspaceConfigurationModelParser;
	workspaceSettings: ConfigurationModel;
	workspaceIdentifier: IWorkspaceIdentifier | null;
	load(workspaceIdentifier: IWorkspaceIdentifier): Promise<void>;
	getConfigurationModel(): ConfigurationModel;
	getFolders(): IStoredWorkspaceFolder[];
	getWorkspaceSettings(): ConfigurationModel;
	reprocessWorkspaceSettings(): ConfigurationModel;
}

class FileServiceBasedWorkspaceConfiguration extends Disposable implements IWorkspaceConfiguration {

	workspaceConfigurationModelParser: WorkspaceConfigurationModelParser;
	workspaceSettings: ConfigurationModel;
	private _workspaceIdentifier: IWorkspaceIdentifier | null = null;
	private workspaceConfigWatcher: IDisposable;
	private readonly reloadConfigurationScheduler: RunOnceScheduler;

	protected readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(private fileService: IFileService) {
		super();

		this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser('');
		this.workspaceSettings = new ConfigurationModel();

		this._register(fileService.onDidFilesChange(e => this.handleWorkspaceFileEvents(e)));
		this.reloadConfigurationScheduler = this._register(new RunOnceScheduler(() => this._onDidChange.fire(), 50));
		this.workspaceConfigWatcher = this._register(this.watchWorkspaceConfigurationFile());
	}

	get workspaceIdentifier(): IWorkspaceIdentifier | null {
		return this._workspaceIdentifier;
	}

	async load(workspaceIdentifier: IWorkspaceIdentifier): Promise<void> {
		if (!this._workspaceIdentifier || this._workspaceIdentifier.id !== workspaceIdentifier.id) {
			this._workspaceIdentifier = workspaceIdentifier;
			this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser(this._workspaceIdentifier.id);
			dispose(this.workspaceConfigWatcher);
			this.workspaceConfigWatcher = this._register(this.watchWorkspaceConfigurationFile());
		}
		let contents = '';
		try {
			const content = await this.fileService.readFile(this._workspaceIdentifier.configPath);
			contents = content.value.toString();
		} catch (error) {
			const exists = await this.fileService.exists(this._workspaceIdentifier.configPath);
			if (exists) {
				errors.onUnexpectedError(error);
			}
		}
		this.workspaceConfigurationModelParser.parseContent(contents);
		this.consolidate();
	}

	getConfigurationModel(): ConfigurationModel {
		return this.workspaceConfigurationModelParser.configurationModel;
	}

	getFolders(): IStoredWorkspaceFolder[] {
		return this.workspaceConfigurationModelParser.folders;
	}

	getWorkspaceSettings(): ConfigurationModel {
		return this.workspaceSettings;
	}

	reprocessWorkspaceSettings(): ConfigurationModel {
		this.workspaceConfigurationModelParser.reprocessWorkspaceSettings();
		this.consolidate();
		return this.getWorkspaceSettings();
	}

	private consolidate(): void {
		this.workspaceSettings = this.workspaceConfigurationModelParser.settingsModel.merge(this.workspaceConfigurationModelParser.launchModel, this.workspaceConfigurationModelParser.tasksModel);
	}

	private watchWorkspaceConfigurationFile(): IDisposable {
		return this._workspaceIdentifier ? this.fileService.watch(this._workspaceIdentifier.configPath) : Disposable.None;
	}

	private handleWorkspaceFileEvents(event: FileChangesEvent): void {
		if (this._workspaceIdentifier) {

			// Find changes that affect workspace file
			if (event.contains(this._workspaceIdentifier.configPath)) {
				this.reloadConfigurationScheduler.schedule();
			}
		}
	}
}

class CachedWorkspaceConfiguration extends Disposable implements IWorkspaceConfiguration {

	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	workspaceConfigurationModelParser: WorkspaceConfigurationModelParser;
	workspaceSettings: ConfigurationModel;

	constructor(private readonly configurationCache: IConfigurationCache) {
		super();
		this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser('');
		this.workspaceSettings = new ConfigurationModel();
	}

	async load(workspaceIdentifier: IWorkspaceIdentifier): Promise<void> {
		try {
			const key = this.getKey(workspaceIdentifier);
			const contents = await this.configurationCache.read(key);
			this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser(key.key);
			this.workspaceConfigurationModelParser.parseContent(contents);
			this.workspaceSettings = this.workspaceConfigurationModelParser.settingsModel.merge(this.workspaceConfigurationModelParser.launchModel, this.workspaceConfigurationModelParser.tasksModel);
		} catch (e) {
		}
	}

	get workspaceIdentifier(): IWorkspaceIdentifier | null {
		return null;
	}

	getConfigurationModel(): ConfigurationModel {
		return this.workspaceConfigurationModelParser.configurationModel;
	}

	getFolders(): IStoredWorkspaceFolder[] {
		return this.workspaceConfigurationModelParser.folders;
	}

	getWorkspaceSettings(): ConfigurationModel {
		return this.workspaceSettings;
	}

	reprocessWorkspaceSettings(): ConfigurationModel {
		return this.workspaceSettings;
	}

	async updateWorkspace(workspaceIdentifier: IWorkspaceIdentifier, configurationModel: ConfigurationModel): Promise<void> {
		try {
			const key = this.getKey(workspaceIdentifier);
			if (configurationModel.keys.length) {
				await this.configurationCache.write(key, JSON.stringify(configurationModel.toJSON().contents));
			} else {
				await this.configurationCache.remove(key);
			}
		} catch (error) {
		}
	}

	private getKey(workspaceIdentifier: IWorkspaceIdentifier): ConfigurationKey {
		return {
			type: 'workspaces',
			key: workspaceIdentifier.id
		};
	}
}

export interface IFolderConfiguration extends IDisposable {
	readonly onDidChange: Event<void>;
	loadConfiguration(): Promise<ConfigurationModel>;
	reprocess(): ConfigurationModel;
}

class CachedFolderConfiguration extends Disposable implements IFolderConfiguration {

	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private configurationModel: ConfigurationModel;
	private readonly key: ConfigurationKey;

	constructor(
		folder: URI,
		configFolderRelativePath: string,
		private readonly configurationCache: IConfigurationCache
	) {
		super();
		this.key = { type: 'folder', key: hash(join(folder.path, configFolderRelativePath)).toString(16) };
		this.configurationModel = new ConfigurationModel();
	}

	async loadConfiguration(): Promise<ConfigurationModel> {
		try {
			const contents = await this.configurationCache.read(this.key);
			const parsed: IConfigurationModel = JSON.parse(contents.toString());
			this.configurationModel = new ConfigurationModel(parsed.contents, parsed.keys, parsed.overrides);
		} catch (e) {
		}
		return this.configurationModel;
	}

	async updateConfiguration(configurationModel: ConfigurationModel): Promise<void> {
		if (configurationModel.keys.length) {
			await this.configurationCache.write(this.key, JSON.stringify(configurationModel.toJSON()));
		} else {
			await this.configurationCache.remove(this.key);
		}
	}

	reprocess(): ConfigurationModel {
		return this.configurationModel;
	}

	getUnsupportedKeys(): string[] {
		return [];
	}
}

export class FolderConfiguration extends Disposable implements IFolderConfiguration {

	protected readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private folderConfiguration: IFolderConfiguration;
	private folderConfigurationDisposable: IDisposable = Disposable.None;
	private readonly configurationFolder: URI;
	private cachedFolderConfiguration: CachedFolderConfiguration;

	constructor(
		readonly workspaceFolder: IWorkspaceFolder,
		configFolderRelativePath: string,
		private readonly workbenchState: WorkbenchState,
		fileService: IFileService,
		private readonly configurationCache: IConfigurationCache
	) {
		super();

		this.configurationFolder = resources.joinPath(workspaceFolder.uri, configFolderRelativePath);
		this.cachedFolderConfiguration = new CachedFolderConfiguration(workspaceFolder.uri, configFolderRelativePath, configurationCache);
		if (this.configurationCache.needsCaching(workspaceFolder.uri)) {
			this.folderConfiguration = this.cachedFolderConfiguration;
			whenProviderRegistered(workspaceFolder.uri, fileService)
				.then(() => {
					this.folderConfiguration.dispose();
					this.folderConfigurationDisposable.dispose();
					this.folderConfiguration = this.createFileServiceBasedConfiguration(fileService);
					this._register(this.folderConfiguration.onDidChange(e => this.onDidFolderConfigurationChange()));
					this.onDidFolderConfigurationChange();
				});
		} else {
			this.folderConfiguration = this.createFileServiceBasedConfiguration(fileService);
			this.folderConfigurationDisposable = this._register(this.folderConfiguration.onDidChange(e => this.onDidFolderConfigurationChange()));
		}
	}

	loadConfiguration(): Promise<ConfigurationModel> {
		return this.folderConfiguration.loadConfiguration();
	}

	reprocess(): ConfigurationModel {
		return this.folderConfiguration.reprocess();
	}

	private onDidFolderConfigurationChange(): void {
		this.updateCache();
		this._onDidChange.fire();
	}

	private createFileServiceBasedConfiguration(fileService: IFileService) {
		const settingsResources = [resources.joinPath(this.configurationFolder, `${FOLDER_SETTINGS_NAME}.json`)];
		const standAloneConfigurationResources: [string, URI][] = [TASKS_CONFIGURATION_KEY, LAUNCH_CONFIGURATION_KEY].map(name => ([name, resources.joinPath(this.configurationFolder, `${name}.json`)]));
		return new FileServiceBasedConfiguration(this.configurationFolder.toString(), settingsResources, standAloneConfigurationResources, WorkbenchState.WORKSPACE === this.workbenchState ? FOLDER_SCOPES : WORKSPACE_SCOPES, fileService);
	}

	private updateCache(): Promise<void> {
		if (this.configurationCache.needsCaching(this.configurationFolder) && this.folderConfiguration instanceof FileServiceBasedConfiguration) {
			return this.folderConfiguration.loadConfiguration()
				.then(configurationModel => this.cachedFolderConfiguration.updateConfiguration(configurationModel));
		}
		return Promise.resolve(undefined);
	}
}
