/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import * as errors from 'vs/base/common/errors';
import { Disposable, IDisposable, dispose, toDisposable, MutableDisposable, combinedDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { RunOnceScheduler } from 'vs/base/common/async';
import { FileChangeType, FileChangesEvent, IFileService, whenProviderRegistered, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { ConfigurationModel, ConfigurationModelParser, ConfigurationParseOptions, UserSettings } from 'vs/platform/configuration/common/configurationModels';
import { WorkspaceConfigurationModelParser, StandaloneConfigurationModelParser } from 'vs/workbench/services/configuration/common/configurationModels';
import { TASKS_CONFIGURATION_KEY, FOLDER_SETTINGS_NAME, LAUNCH_CONFIGURATION_KEY, IConfigurationCache, ConfigurationKey, REMOTE_MACHINE_SCOPES, FOLDER_SCOPES, WORKSPACE_SCOPES } from 'vs/workbench/services/configuration/common/configuration';
import { IStoredWorkspaceFolder, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { JSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditingService';
import { WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { join } from 'vs/base/common/path';
import { equals } from 'vs/base/common/objects';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { hash } from 'vs/base/common/hash';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { ILogService } from 'vs/platform/log/common/log';
import { IStringDictionary } from 'vs/base/common/collections';

export class UserConfiguration extends Disposable {

	private readonly _onDidChangeConfiguration: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	readonly onDidChangeConfiguration: Event<ConfigurationModel> = this._onDidChangeConfiguration.event;

	private readonly userConfiguration: MutableDisposable<UserSettings | FileServiceBasedConfiguration> = this._register(new MutableDisposable<UserSettings | FileServiceBasedConfiguration>());
	private readonly reloadConfigurationScheduler: RunOnceScheduler;

	private readonly configurationParseOptions: ConfigurationParseOptions;

	get hasTasksLoaded(): boolean { return this.userConfiguration.value instanceof FileServiceBasedConfiguration; }

	constructor(
		private readonly userSettingsResource: URI,
		scopes: ConfigurationScope[] | undefined,
		private readonly fileService: IFileService,
		private readonly uriIdentityService: IUriIdentityService,
		private readonly logService: ILogService,
	) {
		super();
		this.configurationParseOptions = { scopes, skipRestricted: false };
		this.userConfiguration.value = new UserSettings(this.userSettingsResource, scopes, uriIdentityService.extUri, this.fileService);
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

		const folder = this.uriIdentityService.extUri.dirname(this.userSettingsResource);
		const standAloneConfigurationResources: [string, URI][] = [TASKS_CONFIGURATION_KEY].map(name => ([name, this.uriIdentityService.extUri.joinPath(folder, `${name}.json`)]));
		const fileServiceBasedConfiguration = new FileServiceBasedConfiguration(folder.toString(), this.userSettingsResource, standAloneConfigurationResources, this.configurationParseOptions, this.fileService, this.uriIdentityService, this.logService);
		const configurationModel = await fileServiceBasedConfiguration.loadConfiguration();
		this.userConfiguration.value = fileServiceBasedConfiguration;

		// Check for value because userConfiguration might have been disposed.
		if (this.userConfiguration.value) {
			this._register(this.userConfiguration.value.onDidChange(() => this.reloadConfigurationScheduler.schedule()));
		}

		return configurationModel;
	}

	reparse(): ConfigurationModel {
		return this.userConfiguration.value!.reparse(this.configurationParseOptions);
	}

	getRestrictedSettings(): string[] {
		return this.userConfiguration.value!.getRestrictedSettings();
	}
}

class FileServiceBasedConfiguration extends Disposable {

	private readonly allResources: URI[];
	private _folderSettingsModelParser: ConfigurationModelParser;
	private _folderSettingsParseOptions: ConfigurationParseOptions;
	private _standAloneConfigurations: ConfigurationModel[];
	private _cache: ConfigurationModel;

	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		name: string,
		private readonly settingsResource: URI,
		private readonly standAloneConfigurationResources: [string, URI][],
		configurationParseOptions: ConfigurationParseOptions,
		private readonly fileService: IFileService,
		private readonly uriIdentityService: IUriIdentityService,
		private readonly logService: ILogService,
	) {
		super();
		this.allResources = [this.settingsResource, ...this.standAloneConfigurationResources.map(([, resource]) => resource)];
		this._register(combinedDisposable(...this.allResources.map(resource => combinedDisposable(
			this.fileService.watch(uriIdentityService.extUri.dirname(resource)),
			// Also listen to the resource incase the resource is a symlink - https://github.com/microsoft/vscode/issues/118134
			this.fileService.watch(resource)
		))));

		this._folderSettingsModelParser = new ConfigurationModelParser(name);
		this._folderSettingsParseOptions = configurationParseOptions;
		this._standAloneConfigurations = [];
		this._cache = new ConfigurationModel();

		this._register(Event.debounce(Event.filter(this.fileService.onDidFilesChange, e => this.handleFileEvents(e)), () => undefined, 100)(() => this._onDidChange.fire()));
	}

	async resolveContents(): Promise<[string | undefined, [string, string | undefined][]]> {

		const resolveContents = async (resources: URI[]): Promise<(string | undefined)[]> => {
			return Promise.all(resources.map(async resource => {
				try {
					const content = (await this.fileService.readFile(resource, { atomic: true })).value.toString();
					if (!content) {
						this.logService.debug(`Configuration file '${resource.toString()}' is empty`);
					}
					return content;
				} catch (error) {
					this.logService.trace(`Error while resolving configuration file '${resource.toString()}': ${errors.getErrorMessage(error)}`);
					if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND
						&& (<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_DIRECTORY) {
						errors.onUnexpectedError(error);
					}
				}
				return '{}';
			}));
		};

		const [[settingsContent], standAloneConfigurationContents] = await Promise.all([
			resolveContents([this.settingsResource]),
			resolveContents(this.standAloneConfigurationResources.map(([, resource]) => resource)),
		]);

		return [settingsContent, standAloneConfigurationContents.map((content, index) => ([this.standAloneConfigurationResources[index][0], content]))];
	}

	async loadConfiguration(): Promise<ConfigurationModel> {

		const [settingsContent, standAloneConfigurationContents] = await this.resolveContents();

		// reset
		this._standAloneConfigurations = [];
		this._folderSettingsModelParser.parse('', this._folderSettingsParseOptions);

		// parse
		if (settingsContent !== undefined) {
			this._folderSettingsModelParser.parse(settingsContent, this._folderSettingsParseOptions);
		}
		for (let index = 0; index < standAloneConfigurationContents.length; index++) {
			const contents = standAloneConfigurationContents[index][1];
			if (contents !== undefined) {
				const standAloneConfigurationModelParser = new StandaloneConfigurationModelParser(this.standAloneConfigurationResources[index][1].toString(), this.standAloneConfigurationResources[index][0]);
				standAloneConfigurationModelParser.parse(contents);
				this._standAloneConfigurations.push(standAloneConfigurationModelParser.configurationModel);
			}
		}

		// Consolidate (support *.json files in the workspace settings folder)
		this.consolidate();

		return this._cache;
	}

	getRestrictedSettings(): string[] {
		return this._folderSettingsModelParser.restrictedConfigurations;
	}

	reparse(configurationParseOptions: ConfigurationParseOptions): ConfigurationModel {
		const oldContents = this._folderSettingsModelParser.configurationModel.contents;
		this._folderSettingsParseOptions = configurationParseOptions;
		this._folderSettingsModelParser.reparse(this._folderSettingsParseOptions);
		if (!equals(oldContents, this._folderSettingsModelParser.configurationModel.contents)) {
			this.consolidate();
		}
		return this._cache;
	}

	private consolidate(): void {
		this._cache = this._folderSettingsModelParser.configurationModel.merge(...this._standAloneConfigurations);
	}

	private handleFileEvents(event: FileChangesEvent): boolean {
		// One of the resources has changed
		if (this.allResources.some(resource => event.contains(resource))) {
			return true;
		}
		// One of the resource's parent got deleted
		if (this.allResources.some(resource => event.contains(this.uriIdentityService.extUri.dirname(resource), FileChangeType.DELETED))) {
			return true;
		}
		return false;
	}

}

export class RemoteUserConfiguration extends Disposable {

	private readonly _cachedConfiguration: CachedRemoteUserConfiguration;
	private readonly _fileService: IFileService;
	private _userConfiguration: FileServiceBasedRemoteUserConfiguration | CachedRemoteUserConfiguration;
	private _userConfigurationInitializationPromise: Promise<ConfigurationModel> | null = null;

	private readonly _onDidChangeConfiguration: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	public readonly onDidChangeConfiguration: Event<ConfigurationModel> = this._onDidChangeConfiguration.event;

	private readonly _onDidInitialize = this._register(new Emitter<ConfigurationModel>());
	public readonly onDidInitialize = this._onDidInitialize.event;

	constructor(
		remoteAuthority: string,
		configurationCache: IConfigurationCache,
		fileService: IFileService,
		uriIdentityService: IUriIdentityService,
		remoteAgentService: IRemoteAgentService
	) {
		super();
		this._fileService = fileService;
		this._userConfiguration = this._cachedConfiguration = new CachedRemoteUserConfiguration(remoteAuthority, configurationCache, { scopes: REMOTE_MACHINE_SCOPES });
		remoteAgentService.getEnvironment().then(async environment => {
			if (environment) {
				const userConfiguration = this._register(new FileServiceBasedRemoteUserConfiguration(environment.settingsPath, { scopes: REMOTE_MACHINE_SCOPES }, this._fileService, uriIdentityService));
				this._register(userConfiguration.onDidChangeConfiguration(configurationModel => this.onDidUserConfigurationChange(configurationModel)));
				this._userConfigurationInitializationPromise = userConfiguration.initialize();
				const configurationModel = await this._userConfigurationInitializationPromise;
				this._userConfiguration.dispose();
				this._userConfiguration = userConfiguration;
				this.onDidUserConfigurationChange(configurationModel);
				this._onDidInitialize.fire(configurationModel);
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

	reparse(): ConfigurationModel {
		return this._userConfiguration.reparse({ scopes: REMOTE_MACHINE_SCOPES });
	}

	getRestrictedSettings(): string[] {
		return this._userConfiguration.getRestrictedSettings();
	}

	private onDidUserConfigurationChange(configurationModel: ConfigurationModel): void {
		this.updateCache();
		this._onDidChangeConfiguration.fire(configurationModel);
	}

	private async updateCache(): Promise<void> {
		if (this._userConfiguration instanceof FileServiceBasedRemoteUserConfiguration) {
			let content: string | undefined;
			try {
				content = await this._userConfiguration.resolveContent();
			} catch (error) {
				if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
					return;
				}
			}
			await this._cachedConfiguration.updateConfiguration(content);
		}
	}

}

class FileServiceBasedRemoteUserConfiguration extends Disposable {

	private readonly parser: ConfigurationModelParser;
	private parseOptions: ConfigurationParseOptions;
	private readonly reloadConfigurationScheduler: RunOnceScheduler;
	protected readonly _onDidChangeConfiguration: Emitter<ConfigurationModel> = this._register(new Emitter<ConfigurationModel>());
	readonly onDidChangeConfiguration: Event<ConfigurationModel> = this._onDidChangeConfiguration.event;

	private fileWatcherDisposable: IDisposable = Disposable.None;
	private directoryWatcherDisposable: IDisposable = Disposable.None;

	constructor(
		private readonly configurationResource: URI,
		configurationParseOptions: ConfigurationParseOptions,
		private readonly fileService: IFileService,
		private readonly uriIdentityService: IUriIdentityService,
	) {
		super();

		this.parser = new ConfigurationModelParser(this.configurationResource.toString());
		this.parseOptions = configurationParseOptions;
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
		const directory = this.uriIdentityService.extUri.dirname(this.configurationResource);
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

	async resolveContent(): Promise<string> {
		const content = await this.fileService.readFile(this.configurationResource);
		return content.value.toString();
	}

	async reload(): Promise<ConfigurationModel> {
		try {
			const content = await this.resolveContent();
			this.parser.parse(content, this.parseOptions);
			return this.parser.configurationModel;
		} catch (e) {
			return new ConfigurationModel();
		}
	}

	reparse(configurationParseOptions: ConfigurationParseOptions): ConfigurationModel {
		this.parseOptions = configurationParseOptions;
		this.parser.reparse(this.parseOptions);
		return this.parser.configurationModel;
	}

	getRestrictedSettings(): string[] {
		return this.parser.restrictedConfigurations;
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
	private readonly parser: ConfigurationModelParser;
	private parseOptions: ConfigurationParseOptions;
	private configurationModel: ConfigurationModel;

	constructor(
		remoteAuthority: string,
		private readonly configurationCache: IConfigurationCache,
		configurationParseOptions: ConfigurationParseOptions,
	) {
		super();
		this.key = { type: 'user', key: remoteAuthority };
		this.parser = new ConfigurationModelParser('CachedRemoteUserConfiguration');
		this.parseOptions = configurationParseOptions;
		this.configurationModel = new ConfigurationModel();
	}

	getConfigurationModel(): ConfigurationModel {
		return this.configurationModel;
	}

	initialize(): Promise<ConfigurationModel> {
		return this.reload();
	}

	reparse(configurationParseOptions: ConfigurationParseOptions): ConfigurationModel {
		this.parseOptions = configurationParseOptions;
		this.parser.reparse(this.parseOptions);
		this.configurationModel = this.parser.configurationModel;
		return this.configurationModel;
	}

	getRestrictedSettings(): string[] {
		return this.parser.restrictedConfigurations;
	}

	async reload(): Promise<ConfigurationModel> {
		try {
			const content = await this.configurationCache.read(this.key);
			const parsed: { content: string } = JSON.parse(content);
			if (parsed.content) {
				this.parser.parse(parsed.content, this.parseOptions);
				this.configurationModel = this.parser.configurationModel;
			}
		} catch (e) { /* Ignore error */ }
		return this.configurationModel;
	}

	async updateConfiguration(content: string | undefined): Promise<void> {
		if (content) {
			return this.configurationCache.write(this.key, JSON.stringify({ content }));
		} else {
			return this.configurationCache.remove(this.key);
		}
	}
}

export class WorkspaceConfiguration extends Disposable {

	private readonly _fileService: IFileService;
	private readonly _cachedConfiguration: CachedWorkspaceConfiguration;
	private _workspaceConfiguration: CachedWorkspaceConfiguration | FileServiceBasedWorkspaceConfiguration;
	private _workspaceConfigurationDisposables = this._register(new DisposableStore());
	private _workspaceIdentifier: IWorkspaceIdentifier | null = null;
	private _isWorkspaceTrusted: boolean = false;

	private readonly _onDidUpdateConfiguration = this._register(new Emitter<boolean>());
	public readonly onDidUpdateConfiguration = this._onDidUpdateConfiguration.event;

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

	async initialize(workspaceIdentifier: IWorkspaceIdentifier, workspaceTrusted: boolean): Promise<void> {
		this._workspaceIdentifier = workspaceIdentifier;
		this._isWorkspaceTrusted = workspaceTrusted;
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
			await this._workspaceConfiguration.load(this._workspaceIdentifier, { scopes: WORKSPACE_SCOPES, skipRestricted: this.isUntrusted() });
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

	updateWorkspaceTrust(trusted: boolean): ConfigurationModel {
		this._isWorkspaceTrusted = trusted;
		return this.reparseWorkspaceSettings();
	}

	reparseWorkspaceSettings(): ConfigurationModel {
		this._workspaceConfiguration.reparseWorkspaceSettings({ scopes: WORKSPACE_SCOPES, skipRestricted: this.isUntrusted() });
		return this.getConfiguration();
	}

	getRestrictedSettings(): string[] {
		return this._workspaceConfiguration.getRestrictedSettings();
	}

	private async waitAndInitialize(workspaceIdentifier: IWorkspaceIdentifier): Promise<void> {
		await whenProviderRegistered(workspaceIdentifier.configPath, this._fileService);
		if (!(this._workspaceConfiguration instanceof FileServiceBasedWorkspaceConfiguration)) {
			const fileServiceBasedWorkspaceConfiguration = this._register(new FileServiceBasedWorkspaceConfiguration(this._fileService));
			await fileServiceBasedWorkspaceConfiguration.load(workspaceIdentifier, { scopes: WORKSPACE_SCOPES, skipRestricted: this.isUntrusted() });
			this.doInitialize(fileServiceBasedWorkspaceConfiguration);
			this.onDidWorkspaceConfigurationChange(false, true);
		}
	}

	private doInitialize(fileServiceBasedWorkspaceConfiguration: FileServiceBasedWorkspaceConfiguration): void {
		this._workspaceConfigurationDisposables.clear();
		this._workspaceConfiguration = this._workspaceConfigurationDisposables.add(fileServiceBasedWorkspaceConfiguration);
		this._workspaceConfigurationDisposables.add(this._workspaceConfiguration.onDidChange(e => this.onDidWorkspaceConfigurationChange(true, false)));
		this._initialized = true;
	}

	private isUntrusted(): boolean {
		return !this._isWorkspaceTrusted;
	}

	private async onDidWorkspaceConfigurationChange(reload: boolean, fromCache: boolean): Promise<void> {
		if (reload) {
			await this.reload();
		}
		this.updateCache();
		this._onDidUpdateConfiguration.fire(fromCache);
	}

	private async updateCache(): Promise<void> {
		if (this._workspaceIdentifier && this.configurationCache.needsCaching(this._workspaceIdentifier.configPath) && this._workspaceConfiguration instanceof FileServiceBasedWorkspaceConfiguration) {
			const content = await this._workspaceConfiguration.resolveContent(this._workspaceIdentifier);
			await this._cachedConfiguration.updateWorkspace(this._workspaceIdentifier, content);
		}
	}
}

class FileServiceBasedWorkspaceConfiguration extends Disposable {

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

	async resolveContent(workspaceIdentifier: IWorkspaceIdentifier): Promise<string> {
		const content = await this.fileService.readFile(workspaceIdentifier.configPath);
		return content.value.toString();
	}

	async load(workspaceIdentifier: IWorkspaceIdentifier, configurationParseOptions: ConfigurationParseOptions): Promise<void> {
		if (!this._workspaceIdentifier || this._workspaceIdentifier.id !== workspaceIdentifier.id) {
			this._workspaceIdentifier = workspaceIdentifier;
			this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser(this._workspaceIdentifier.id);
			dispose(this.workspaceConfigWatcher);
			this.workspaceConfigWatcher = this._register(this.watchWorkspaceConfigurationFile());
		}
		let contents = '';
		try {
			contents = await this.resolveContent(this._workspaceIdentifier);
		} catch (error) {
			const exists = await this.fileService.exists(this._workspaceIdentifier.configPath);
			if (exists) {
				errors.onUnexpectedError(error);
			}
		}
		this.workspaceConfigurationModelParser.parse(contents, configurationParseOptions);
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

	reparseWorkspaceSettings(configurationParseOptions: ConfigurationParseOptions): ConfigurationModel {
		this.workspaceConfigurationModelParser.reparseWorkspaceSettings(configurationParseOptions);
		this.consolidate();
		return this.getWorkspaceSettings();
	}

	getRestrictedSettings(): string[] {
		return this.workspaceConfigurationModelParser.getRestrictedWorkspaceSettings();
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

class CachedWorkspaceConfiguration {

	readonly onDidChange: Event<void> = Event.None;

	workspaceConfigurationModelParser: WorkspaceConfigurationModelParser;
	workspaceSettings: ConfigurationModel;

	constructor(private readonly configurationCache: IConfigurationCache) {
		this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser('');
		this.workspaceSettings = new ConfigurationModel();
	}

	async load(workspaceIdentifier: IWorkspaceIdentifier, configurationParseOptions: ConfigurationParseOptions): Promise<void> {
		try {
			const key = this.getKey(workspaceIdentifier);
			const contents = await this.configurationCache.read(key);
			const parsed: { content: string } = JSON.parse(contents);
			if (parsed.content) {
				this.workspaceConfigurationModelParser = new WorkspaceConfigurationModelParser(key.key);
				this.workspaceConfigurationModelParser.parse(parsed.content, configurationParseOptions);
				this.consolidate();
			}
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

	reparseWorkspaceSettings(configurationParseOptions: ConfigurationParseOptions): ConfigurationModel {
		this.workspaceConfigurationModelParser.reparseWorkspaceSettings(configurationParseOptions);
		this.consolidate();
		return this.getWorkspaceSettings();
	}

	getRestrictedSettings(): string[] {
		return this.workspaceConfigurationModelParser.getRestrictedWorkspaceSettings();
	}

	private consolidate(): void {
		this.workspaceSettings = this.workspaceConfigurationModelParser.settingsModel.merge(this.workspaceConfigurationModelParser.launchModel, this.workspaceConfigurationModelParser.tasksModel);
	}

	async updateWorkspace(workspaceIdentifier: IWorkspaceIdentifier, content: string | undefined): Promise<void> {
		try {
			const key = this.getKey(workspaceIdentifier);
			if (content) {
				await this.configurationCache.write(key, JSON.stringify({ content }));
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

class CachedFolderConfiguration {

	readonly onDidChange = Event.None;

	private _folderSettingsModelParser: ConfigurationModelParser;
	private _folderSettingsParseOptions: ConfigurationParseOptions;
	private _standAloneConfigurations: ConfigurationModel[];
	private configurationModel: ConfigurationModel;
	private readonly key: ConfigurationKey;

	constructor(
		folder: URI,
		configFolderRelativePath: string,
		configurationParseOptions: ConfigurationParseOptions,
		private readonly configurationCache: IConfigurationCache,
	) {
		this.key = { type: 'folder', key: hash(join(folder.path, configFolderRelativePath)).toString(16) };
		this._folderSettingsModelParser = new ConfigurationModelParser('CachedFolderConfiguration');
		this._folderSettingsParseOptions = configurationParseOptions;
		this._standAloneConfigurations = [];
		this.configurationModel = new ConfigurationModel();
	}

	async loadConfiguration(): Promise<ConfigurationModel> {
		try {
			const contents = await this.configurationCache.read(this.key);
			const { content: configurationContents }: { content: IStringDictionary<string> } = JSON.parse(contents.toString());
			if (configurationContents) {
				for (const key of Object.keys(configurationContents)) {
					if (key === FOLDER_SETTINGS_NAME) {
						this._folderSettingsModelParser.parse(configurationContents[key], this._folderSettingsParseOptions);
					} else {
						const standAloneConfigurationModelParser = new StandaloneConfigurationModelParser(key, key);
						standAloneConfigurationModelParser.parse(configurationContents[key]);
						this._standAloneConfigurations.push(standAloneConfigurationModelParser.configurationModel);
					}
				}
			}
			this.consolidate();
		} catch (e) {
		}
		return this.configurationModel;
	}

	async updateConfiguration(settingsContent: string | undefined, standAloneConfigurationContents: [string, string | undefined][]): Promise<void> {
		const content: any = {};
		if (settingsContent) {
			content[FOLDER_SETTINGS_NAME] = settingsContent;
		}
		standAloneConfigurationContents.forEach(([key, contents]) => {
			if (contents) {
				content[key] = contents;
			}
		});
		if (Object.keys(content).length) {
			await this.configurationCache.write(this.key, JSON.stringify({ content }));
		} else {
			await this.configurationCache.remove(this.key);
		}
	}

	getRestrictedSettings(): string[] {
		return this._folderSettingsModelParser.restrictedConfigurations;
	}

	reparse(configurationParseOptions: ConfigurationParseOptions): ConfigurationModel {
		this._folderSettingsParseOptions = configurationParseOptions;
		this._folderSettingsModelParser.reparse(this._folderSettingsParseOptions);
		this.consolidate();
		return this.configurationModel;
	}

	private consolidate(): void {
		this.configurationModel = this._folderSettingsModelParser.configurationModel.merge(...this._standAloneConfigurations);
	}

	getUnsupportedKeys(): string[] {
		return [];
	}
}

export class FolderConfiguration extends Disposable {

	protected readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private folderConfiguration: CachedFolderConfiguration | FileServiceBasedConfiguration;
	private readonly scopes: ConfigurationScope[];
	private readonly configurationFolder: URI;
	private cachedFolderConfiguration: CachedFolderConfiguration;

	constructor(
		readonly workspaceFolder: IWorkspaceFolder,
		configFolderRelativePath: string,
		private readonly workbenchState: WorkbenchState,
		private workspaceTrusted: boolean,
		fileService: IFileService,
		uriIdentityService: IUriIdentityService,
		logService: ILogService,
		private readonly configurationCache: IConfigurationCache
	) {
		super();

		this.scopes = WorkbenchState.WORKSPACE === this.workbenchState ? FOLDER_SCOPES : WORKSPACE_SCOPES;
		this.configurationFolder = uriIdentityService.extUri.joinPath(workspaceFolder.uri, configFolderRelativePath);
		this.cachedFolderConfiguration = new CachedFolderConfiguration(workspaceFolder.uri, configFolderRelativePath, { scopes: this.scopes, skipRestricted: this.isUntrusted() }, configurationCache);
		if (this.configurationCache.needsCaching(workspaceFolder.uri)) {
			this.folderConfiguration = this.cachedFolderConfiguration;
			whenProviderRegistered(workspaceFolder.uri, fileService)
				.then(() => {
					this.folderConfiguration = this._register(this.createFileServiceBasedConfiguration(fileService, uriIdentityService, logService));
					this._register(this.folderConfiguration.onDidChange(e => this.onDidFolderConfigurationChange()));
					this.onDidFolderConfigurationChange();
				});
		} else {
			this.folderConfiguration = this._register(this.createFileServiceBasedConfiguration(fileService, uriIdentityService, logService));
			this._register(this.folderConfiguration.onDidChange(e => this.onDidFolderConfigurationChange()));
		}
	}

	loadConfiguration(): Promise<ConfigurationModel> {
		return this.folderConfiguration.loadConfiguration();
	}

	updateWorkspaceTrust(trusted: boolean): ConfigurationModel {
		this.workspaceTrusted = trusted;
		return this.reparse();
	}

	reparse(): ConfigurationModel {
		const configurationModel = this.folderConfiguration.reparse({ scopes: this.scopes, skipRestricted: this.isUntrusted() });
		this.updateCache();
		return configurationModel;
	}

	getRestrictedSettings(): string[] {
		return this.folderConfiguration.getRestrictedSettings();
	}

	private isUntrusted(): boolean {
		return !this.workspaceTrusted;
	}

	private onDidFolderConfigurationChange(): void {
		this.updateCache();
		this._onDidChange.fire();
	}

	private createFileServiceBasedConfiguration(fileService: IFileService, uriIdentityService: IUriIdentityService, logService: ILogService) {
		const settingsResource = uriIdentityService.extUri.joinPath(this.configurationFolder, `${FOLDER_SETTINGS_NAME}.json`);
		const standAloneConfigurationResources: [string, URI][] = [TASKS_CONFIGURATION_KEY, LAUNCH_CONFIGURATION_KEY].map(name => ([name, uriIdentityService.extUri.joinPath(this.configurationFolder, `${name}.json`)]));
		return new FileServiceBasedConfiguration(this.configurationFolder.toString(), settingsResource, standAloneConfigurationResources, { scopes: this.scopes, skipRestricted: this.isUntrusted() }, fileService, uriIdentityService, logService);
	}

	private async updateCache(): Promise<void> {
		if (this.configurationCache.needsCaching(this.configurationFolder) && this.folderConfiguration instanceof FileServiceBasedConfiguration) {
			const [settingsContent, standAloneConfigurationContents] = await this.folderConfiguration.resolveContents();
			this.cachedFolderConfiguration.updateConfiguration(settingsContent, standAloneConfigurationContents);
		}
	}
}
