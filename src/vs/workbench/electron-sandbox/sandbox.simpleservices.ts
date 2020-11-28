/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable code-no-standalone-editor */
/* eslint-disable code-import-patterns */

import { ConsoleLogService } from 'vs/platform/log/common/log';
import { ISignService } from 'vs/platform/sign/common/sign';
import { URI } from 'vs/base/common/uri';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { Event } from 'vs/base/common/event';
import { IRemoteAgentConnection, IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IDiagnosticInfoOptions, IDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { IAddressProvider, ISocketFactory } from 'vs/platform/remote/common/remoteAgentConnection';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { ITelemetryData, ITelemetryInfo, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { BrowserSocketFactory } from 'vs/platform/remote/browser/browserSocketFactory';
import { ExtensionIdentifier, IExtension, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { SimpleConfigurationService as BaseSimpleConfigurationService } from 'vs/editor/standalone/browser/simpleServices';
import { InMemoryStorageService } from 'vs/platform/storage/common/storage';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IBackupFileService, IResolvedBackup } from 'vs/workbench/services/backup/common/backup';
import { ITextSnapshot } from 'vs/editor/common/model';
import { IExtensionService, NullExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ClassifiedEvent, GDPRClassification, StrictPropertyChecker } from 'vs/platform/telemetry/common/gdprTypings';
import { IKeyboardLayoutService } from 'vs/platform/keyboardLayout/common/keyboardLayout';
import { isWindows } from 'vs/base/common/platform';
import { IWebviewService, WebviewContentOptions, WebviewElement, WebviewExtensionDescription, WebviewIcons, WebviewOptions, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { AbstractTextFileService } from 'vs/workbench/services/textfile/browser/textFileService';
import { IExtensionManagementServer, IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ITunnelProvider, ITunnelService, RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IManualSyncTask, IResourcePreview, ISyncResourceHandle, ISyncTask, IUserDataAutoSyncService, IUserDataSyncService, IUserDataSyncStore, IUserDataSyncStoreManagementService, SyncResource, SyncStatus, UserDataSyncStoreType } from 'vs/platform/userDataSync/common/userDataSync';
import { IUserDataSyncAccount, IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ITaskProvider, ITaskService, ITaskSummary, ProblemMatcherRunOptions, Task, TaskFilter, TaskTerminateResponse, WorkspaceFolderTaskResult } from 'vs/workbench/contrib/tasks/common/taskService';
import { Action } from 'vs/base/common/actions';
import { LinkedMap } from 'vs/base/common/map';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFolder, WorkbenchState, WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { CustomTask, ContributedTask, InMemoryTask, TaskRunSource, ConfiguringTask, TaskIdentifier, TaskSorter } from 'vs/workbench/contrib/tasks/common/tasks';
import { TaskSystemInfo } from 'vs/workbench/contrib/tasks/common/taskSystem';
import { IExtensionTipsService, IConfigBasedExtensionTip, IExecutableBasedExtensionTip, IWorkspaceTips } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkspaceTagsService, Tags } from 'vs/workbench/contrib/tags/common/workspaceTags';
import { AbstractOutputChannelModelService, IOutputChannelModelService } from 'vs/workbench/contrib/output/common/outputChannelModel';
import { joinPath } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { IIntegrityService, IntegrityTestResult } from 'vs/workbench/services/integrity/common/integrity';
import { INativeWorkbenchConfiguration, INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';
import type { IWorkbenchConstructionOptions } from 'vs/workbench/workbench.web.api';
import { Schemas } from 'vs/base/common/network';
import { BrowserKeyboardLayoutService } from 'vs/workbench/services/keybinding/browser/keyboardLayoutService';
import { TerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminalInstanceService';
import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';


//#region Environment

export class SimpleNativeWorkbenchEnvironmentService implements INativeWorkbenchEnvironmentService {

	declare readonly _serviceBrand: undefined;

	constructor(
		readonly configuration: INativeWorkbenchConfiguration
	) { }

	get userRoamingDataHome(): URI { return URI.file('/sandbox-user-data-dir').with({ scheme: Schemas.userData }); }
	get settingsResource(): URI { return joinPath(this.userRoamingDataHome, 'settings.json'); }
	get argvResource(): URI { return joinPath(this.userRoamingDataHome, 'argv.json'); }
	get snippetsHome(): URI { return joinPath(this.userRoamingDataHome, 'snippets'); }
	get globalStorageHome(): URI { return URI.joinPath(this.userRoamingDataHome, 'globalStorage'); }
	get workspaceStorageHome(): URI { return URI.joinPath(this.userRoamingDataHome, 'workspaceStorage'); }
	get keybindingsResource(): URI { return joinPath(this.userRoamingDataHome, 'keybindings.json'); }
	get logFile(): URI { return joinPath(this.userRoamingDataHome, 'window.log'); }
	get untitledWorkspacesHome(): URI { return joinPath(this.userRoamingDataHome, 'Workspaces'); }
	get serviceMachineIdResource(): URI { return joinPath(this.userRoamingDataHome, 'machineid'); }
	get userDataSyncLogResource(): URI { return joinPath(this.userRoamingDataHome, 'syncLog'); }
	get userDataSyncHome(): URI { return joinPath(this.userRoamingDataHome, 'syncHome'); }
	get tmpDir(): URI { return joinPath(this.userRoamingDataHome, 'tmp'); }
	get logsPath(): string { return joinPath(this.userRoamingDataHome, 'logs').path; }

	sessionId = this.configuration.sessionId;
	machineId = this.configuration.machineId;
	remoteAuthority = this.configuration.remoteAuthority;
	os = { release: 'unknown' };

	options?: IWorkbenchConstructionOptions | undefined;
	logExtensionHostCommunication?: boolean | undefined;
	extensionEnabledProposedApi?: string[] | undefined;
	webviewExternalEndpoint: string = undefined!;
	webviewResourceRoot: string = undefined!;
	webviewCspSource: string = undefined!;
	skipReleaseNotes: boolean = undefined!;
	keyboardLayoutResource: URI = undefined!;
	sync: 'on' | 'off' | undefined;
	debugExtensionHost: IExtensionHostDebugParams = undefined!;
	debugRenderer = false;
	isExtensionDevelopment: boolean = false;
	disableExtensions: boolean | string[] = [];
	extensionDevelopmentLocationURI?: URI[] | undefined;
	extensionTestsLocationURI?: URI | undefined;
	logLevel?: string | undefined;

	args: NativeParsedArgs = Object.create(null);

	execPath: string = undefined!;
	appRoot: string = undefined!;
	userHome: URI = undefined!;
	appSettingsHome: URI = undefined!;
	userDataPath: string = undefined!;
	machineSettingsResource: URI = undefined!;

	log?: string | undefined;
	extHostLogsPath: URI = undefined!;

	installSourcePath: string = undefined!;

	sharedIPCHandle: string = undefined!;

	extensionsPath: string = undefined!;
	extensionsDownloadPath: string = undefined!;
	builtinExtensionsPath: string = undefined!;

	driverHandle?: string | undefined;

	crashReporterDirectory?: string | undefined;
	crashReporterId?: string | undefined;

	nodeCachedDataDir?: string | undefined;

	verbose = false;
	isBuilt = false;

	get telemetryLogResource(): URI { return joinPath(this.userRoamingDataHome, 'telemetry.log'); }
	disableTelemetry = false;
}

//#endregion


//#region Workspace

export const workspaceResource = URI.file(isWindows ? '\\simpleWorkspace' : '/simpleWorkspace');

export class SimpleWorkspaceService implements IWorkspaceContextService {

	declare readonly _serviceBrand: undefined;

	readonly onDidChangeWorkspaceName = Event.None;
	readonly onDidChangeWorkspaceFolders = Event.None;
	readonly onDidChangeWorkbenchState = Event.None;

	private readonly workspace: IWorkspace;

	constructor() {
		this.workspace = { id: '4064f6ec-cb38-4ad0-af64-ee6467e63c82', folders: [new WorkspaceFolder({ uri: workspaceResource, name: '', index: 0 })] };
	}

	async getCompleteWorkspace(): Promise<IWorkspace> { return this.getWorkspace(); }

	getWorkspace(): IWorkspace { return this.workspace; }

	getWorkbenchState(): WorkbenchState {
		if (this.workspace) {
			if (this.workspace.configuration) {
				return WorkbenchState.WORKSPACE;
			}
			return WorkbenchState.FOLDER;
		}
		return WorkbenchState.EMPTY;
	}

	getWorkspaceFolder(resource: URI): IWorkspaceFolder | null { return resource && resource.scheme === workspaceResource.scheme ? this.workspace.folders[0] : null; }
	isInsideWorkspace(resource: URI): boolean { return resource && resource.scheme === workspaceResource.scheme; }
	isCurrentWorkspace(workspaceIdentifier: ISingleFolderWorkspaceIdentifier | IWorkspaceIdentifier): boolean { return true; }
}

//#endregion


//#region Configuration

export class SimpleStorageService extends InMemoryStorageService { }

//#endregion


//#region Configuration

export class SimpleConfigurationService extends BaseSimpleConfigurationService { }

//#endregion


//#region Logger

export class SimpleLogService extends ConsoleLogService { }

export class SimpleSignService implements ISignService {

	declare readonly _serviceBrand: undefined;

	async sign(value: string): Promise<string> { return value; }
}

//#endregion


//#region Files

class SimpleFileSystemProvider extends InMemoryFileSystemProvider { }

export const simpleFileSystemProvider = new SimpleFileSystemProvider();

function createFile(parent: string, name: string, content: string = ''): void {
	simpleFileSystemProvider.writeFile(joinPath(workspaceResource, parent, name), VSBuffer.fromString(content).buffer, { create: true, overwrite: true });
}

function createFolder(name: string): void {
	simpleFileSystemProvider.mkdir(joinPath(workspaceResource, name));
}

createFolder('');
createFolder('src');
createFolder('test');

createFile('', '.gitignore', `out
node_modules
.vscode-test/
*.vsix
`);

createFile('', '.vscodeignore', `.vscode/**
.vscode-test/**
out/test/**
src/**
.gitignore
vsc-extension-quickstart.md
**/tsconfig.json
**/tslint.json
**/*.map
**/*.ts`);

createFile('', 'CHANGELOG.md', `# Change Log
All notable changes to the "test-ts" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]
- Initial release`);
createFile('', 'package.json', `{
	"name": "test-ts",
	"displayName": "test-ts",
	"description": "",
	"version": "0.0.1",
	"engines": {
		"vscode": "^1.31.0"
	},
	"categories": [
		"Other"
	],
	"activationEvents": [
		"onCommand:extension.helloWorld"
	],
	"main": "./out/extension.js",
	"contributes": {
		"commands": [
			{
				"command": "extension.helloWorld",
				"title": "Hello World"
			}
		]
	},
	"scripts": {
		"vscode:prepublish": "npm run compile",
		"compile": "tsc -p ./",
		"watch": "tsc -watch -p ./",
		"postinstall": "node ./node_modules/vscode/bin/install",
		"test": "npm run compile && node ./node_modules/vscode/bin/test"
	},
	"devDependencies": {
		"typescript": "^3.3.1",
		"vscode": "^1.1.28",
		"tslint": "^5.12.1",
		"@types/node": "^8.10.25",
		"@types/mocha": "^2.2.42"
	}
}
`);

createFile('', 'tsconfig.json', `{
	"compilerOptions": {
		"module": "commonjs",
		"target": "es6",
		"outDir": "out",
		"lib": [
			"es6"
		],
		"sourceMap": true,
		"rootDir": "src",
		"strict": true   /* enable all strict type-checking options */
		/* Additional Checks */
		// "noImplicitReturns": true, /* Report error when not all code paths in function return a value. */
		// "noFallthroughCasesInSwitch": true, /* Report errors for fallthrough cases in switch statement. */
		// "noUnusedParameters": true,  /* Report errors on unused parameters. */
	},
	"exclude": [
		"node_modules",
		".vscode-test"
	]
}
`);

createFile('', 'tslint.json', `{
	"rules": {
		"no-string-throw": true,
		"no-unused-expression": true,
		"no-duplicate-variable": true,
		"curly": true,
		"class-name": true,
		"semicolon": [
			true,
			"always"
		],
		"triple-equals": true
	},
	"defaultSeverity": "warning"
}
`);

createFile('src', 'extension.ts', `// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
		console.log('Congratulations, your extension "test-ts" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World!');
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
`);

createFile('test', 'extension.test.ts', `//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
// import * as myExtension from '../extension';

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function () {

	// Defines a Mocha unit test
	test("Something 1", function() {
		assert.equal(-1, [1, 2, 3].indexOf(5));
		assert.equal(-1, [1, 2, 3].indexOf(0));
	});
});`);

createFile('test', 'index.ts', `//
// PLEASE DO NOT MODIFY / DELETE UNLESS YOU KNOW WHAT YOU ARE DOING
//
// This file is providing the test runner to use when running extension tests.
// By default the test runner in use is Mocha based.
//
// You can provide your own test runner if you want to override it by exporting
// a function run(testRoot: string, clb: (error:Error) => void) that the extension
// host can call to run the tests. The test runner is expected to use console.log
// to report the results back to the caller. When the tests are finished, return
// a possible error to the callback or null if none.

import * as testRunner from 'vscode/lib/testrunner';

// You can directly control Mocha options by configuring the test runner below
// See https://github.com/mochajs/mocha/wiki/Using-mocha-programmatically#set-options
// for more info
testRunner.configure({
	ui: 'tdd', 		// the TDD UI is being used in extension.test.ts (suite, test, etc.)
	useColors: true // colored output from test results
});

module.exports = testRunner;`);

//#endregion

//#region Remote

export class SimpleRemoteAgentService implements IRemoteAgentService {

	declare readonly _serviceBrand: undefined;

	socketFactory: ISocketFactory = new BrowserSocketFactory(null);

	getConnection(): IRemoteAgentConnection | null { return null; }
	async getEnvironment(bail?: boolean): Promise<IRemoteAgentEnvironment | null> { return null; }
	async getDiagnosticInfo(options: IDiagnosticInfoOptions): Promise<IDiagnosticInfo | undefined> { return undefined; }
	async disableTelemetry(): Promise<void> { }
	async logTelemetry(eventName: string, data?: ITelemetryData): Promise<void> { }
	async flushTelemetry(): Promise<void> { }
	async getRawEnvironment(): Promise<IRemoteAgentEnvironment | null> { return null; }
	async scanExtensions(skipExtensions?: ExtensionIdentifier[]): Promise<IExtensionDescription[]> { return []; }
	async scanSingleExtension(extensionLocation: URI, isBuiltin: boolean): Promise<IExtensionDescription | null> { return null; }
	async whenExtensionsReady(): Promise<void> { }
}

//#endregion


//#region Backup File

class SimpleBackupFileService implements IBackupFileService {

	declare readonly _serviceBrand: undefined;

	async hasBackups(): Promise<boolean> { return false; }
	async discardResourceBackup(resource: URI): Promise<void> { }
	async discardAllWorkspaceBackups(): Promise<void> { }
	toBackupResource(resource: URI): URI { return resource; }
	hasBackupSync(resource: URI, versionId?: number): boolean { return false; }
	async getBackups(): Promise<URI[]> { return []; }
	async resolve<T extends object>(resource: URI): Promise<IResolvedBackup<T> | undefined> { return undefined; }
	async backup<T extends object>(resource: URI, content?: ITextSnapshot, versionId?: number, meta?: T): Promise<void> { }
	async discardBackup(resource: URI): Promise<void> { }
	async discardBackups(): Promise<void> { }
}

registerSingleton(IBackupFileService, SimpleBackupFileService);

//#endregion


//#region Extensions

class SimpleExtensionService extends NullExtensionService { }

registerSingleton(IExtensionService, SimpleExtensionService);

//#endregion


//#region Telemetry

class SimpleTelemetryService implements ITelemetryService {

	declare readonly _serviceBrand: undefined;

	readonly sendErrorTelemetry = false;
	readonly isOptedIn = false;

	async publicLog(eventName: string, data?: ITelemetryData, anonymizeFilePaths?: boolean): Promise<void> { }
	async publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyChecker<E, ClassifiedEvent<T>, 'Type of classified event does not match event properties'>, anonymizeFilePaths?: boolean): Promise<void> { }
	async publicLogError(errorEventName: string, data?: ITelemetryData): Promise<void> { }
	async publicLogError2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyChecker<E, ClassifiedEvent<T>, 'Type of classified event does not match event properties'>): Promise<void> { }
	setEnabled(value: boolean): void { }
	setExperimentProperty(name: string, value: string): void { }
	async getTelemetryInfo(): Promise<ITelemetryInfo> {
		return {
			instanceId: 'someValue.instanceId',
			sessionId: 'someValue.sessionId',
			machineId: 'someValue.machineId'
		};
	}
}

registerSingleton(ITelemetryService, SimpleTelemetryService);

//#endregion


//#region Keymap Service (borrowed from browser for now to enable keyboard access)

class SimpleKeyboardLayoutService extends BrowserKeyboardLayoutService { }

registerSingleton(IKeyboardLayoutService, SimpleKeyboardLayoutService);

//#endregion


//#region Webview

class SimpleWebviewService implements IWebviewService {
	declare readonly _serviceBrand: undefined;

	readonly activeWebview = undefined;

	createWebviewElement(id: string, options: WebviewOptions, contentOptions: WebviewContentOptions, extension: WebviewExtensionDescription | undefined): WebviewElement { throw new Error('Method not implemented.'); }
	createWebviewOverlay(id: string, options: WebviewOptions, contentOptions: WebviewContentOptions, extension: WebviewExtensionDescription | undefined): WebviewOverlay { throw new Error('Method not implemented.'); }
	setIcons(id: string, value: WebviewIcons | undefined): void { }
}

registerSingleton(IWebviewService, SimpleWebviewService);

//#endregion


//#region Textfiles

class SimpleTextFileService extends AbstractTextFileService {
	declare readonly _serviceBrand: undefined;
}

registerSingleton(ITextFileService, SimpleTextFileService);

//#endregion


//#region extensions management

class SimpleExtensionManagementServerService implements IExtensionManagementServerService {

	declare readonly _serviceBrand: undefined;

	readonly localExtensionManagementServer = null;
	readonly remoteExtensionManagementServer = null;
	readonly webExtensionManagementServer = null;

	getExtensionManagementServer(extension: IExtension): IExtensionManagementServer | null { return null; }
}

registerSingleton(IExtensionManagementServerService, SimpleExtensionManagementServerService);

//#endregion


//#region Tunnel

class SimpleTunnelService implements ITunnelService {

	declare readonly _serviceBrand: undefined;

	tunnels: Promise<readonly RemoteTunnel[]> = Promise.resolve([]);

	onTunnelOpened = Event.None;
	onTunnelClosed = Event.None;

	openTunnel(addressProvider: IAddressProvider | undefined, remoteHost: string | undefined, remotePort: number, localPort?: number): Promise<RemoteTunnel> | undefined { return undefined; }
	async closeTunnel(remoteHost: string, remotePort: number): Promise<void> { }
	setTunnelProvider(provider: ITunnelProvider | undefined): IDisposable { return Disposable.None; }
}

registerSingleton(ITunnelService, SimpleTunnelService);

//#endregion


//#region User Data Sync

class SimpleUserDataSyncService implements IUserDataSyncService {

	declare readonly _serviceBrand: undefined;

	onDidChangeStatus = Event.None;
	onDidChangeConflicts = Event.None;
	onDidChangeLocal = Event.None;
	onSyncErrors = Event.None;
	onDidChangeLastSyncTime = Event.None;
	onDidResetRemote = Event.None;
	onDidResetLocal = Event.None;

	status: SyncStatus = SyncStatus.Idle;
	conflicts: [SyncResource, IResourcePreview[]][] = [];
	lastSyncTime = undefined;

	createSyncTask(): Promise<ISyncTask> { throw new Error('Method not implemented.'); }
	createManualSyncTask(): Promise<IManualSyncTask> { throw new Error('Method not implemented.'); }

	async replace(uri: URI): Promise<void> { }
	async reset(): Promise<void> { }
	async resetRemote(): Promise<void> { }
	async resetLocal(): Promise<void> { }
	async hasLocalData(): Promise<boolean> { return false; }
	async hasPreviouslySynced(): Promise<boolean> { return false; }
	async resolveContent(resource: URI): Promise<string | null> { return null; }
	async accept(resource: SyncResource, conflictResource: URI, content: string | null | undefined, apply: boolean): Promise<void> { }
	async getLocalSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> { return []; }
	async getRemoteSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> { return []; }
	async getAssociatedResources(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<{ resource: URI; comparableResource: URI; }[]> { return []; }
	async getMachineId(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<string | undefined> { return undefined; }
}

registerSingleton(IUserDataSyncService, SimpleUserDataSyncService);

//#endregion


//#region User Data Sync Account

class SimpleUserDataSyncAccountService implements IUserDataSyncAccountService {

	declare readonly _serviceBrand: undefined;

	onTokenFailed = Event.None;
	onDidChangeAccount = Event.None;

	account: IUserDataSyncAccount | undefined = undefined;

	async updateAccount(account: IUserDataSyncAccount | undefined): Promise<void> { }
}

registerSingleton(IUserDataSyncAccountService, SimpleUserDataSyncAccountService);

//#endregion


//#region User Data Auto Sync Account

class SimpleUserDataAutoSyncAccountService implements IUserDataAutoSyncService {

	declare readonly _serviceBrand: undefined;

	onError = Event.None;
	onDidChangeEnablement = Event.None;

	isEnabled(): boolean { return false; }
	canToggleEnablement(): boolean { return false; }
	async turnOn(): Promise<void> { }
	async turnOff(everywhere: boolean): Promise<void> { }
	async triggerSync(sources: string[], hasToLimitSync: boolean, disableCache: boolean): Promise<void> { }
}

registerSingleton(IUserDataAutoSyncService, SimpleUserDataAutoSyncAccountService);

//#endregion


//#region User Data Sync Store Management

class SimpleUserDataSyncStoreManagementService implements IUserDataSyncStoreManagementService {

	declare readonly _serviceBrand: undefined;

	onDidChangeUserDataSyncStore = Event.None;

	userDataSyncStore: IUserDataSyncStore | undefined = undefined;

	async switch(type: UserDataSyncStoreType): Promise<void> { }

	async getPreviousUserDataSyncStore(): Promise<IUserDataSyncStore | undefined> { return undefined; }
}

registerSingleton(IUserDataSyncStoreManagementService, SimpleUserDataSyncStoreManagementService);

//#endregion

//#region Task

class SimpleTaskService implements ITaskService {

	declare readonly _serviceBrand: undefined;

	onDidStateChange = Event.None;
	supportsMultipleTaskExecutions = false;

	configureAction(): Action { throw new Error('Method not implemented.'); }
	build(): Promise<ITaskSummary> { throw new Error('Method not implemented.'); }
	runTest(): Promise<ITaskSummary> { throw new Error('Method not implemented.'); }
	run(task: CustomTask | ContributedTask | InMemoryTask | undefined, options?: ProblemMatcherRunOptions): Promise<ITaskSummary | undefined> { throw new Error('Method not implemented.'); }
	inTerminal(): boolean { throw new Error('Method not implemented.'); }
	isActive(): Promise<boolean> { throw new Error('Method not implemented.'); }
	getActiveTasks(): Promise<Task[]> { throw new Error('Method not implemented.'); }
	getBusyTasks(): Promise<Task[]> { throw new Error('Method not implemented.'); }
	restart(task: Task): void { throw new Error('Method not implemented.'); }
	terminate(task: Task): Promise<TaskTerminateResponse> { throw new Error('Method not implemented.'); }
	terminateAll(): Promise<TaskTerminateResponse[]> { throw new Error('Method not implemented.'); }
	tasks(filter?: TaskFilter): Promise<Task[]> { throw new Error('Method not implemented.'); }
	taskTypes(): string[] { throw new Error('Method not implemented.'); }
	getWorkspaceTasks(runSource?: TaskRunSource): Promise<Map<string, WorkspaceFolderTaskResult>> { throw new Error('Method not implemented.'); }
	readRecentTasks(): Promise<(CustomTask | ContributedTask | InMemoryTask | ConfiguringTask)[]> { throw new Error('Method not implemented.'); }
	getTask(workspaceFolder: string | IWorkspace | IWorkspaceFolder, alias: string | TaskIdentifier, compareId?: boolean): Promise<CustomTask | ContributedTask | InMemoryTask | undefined> { throw new Error('Method not implemented.'); }
	tryResolveTask(configuringTask: ConfiguringTask): Promise<CustomTask | ContributedTask | InMemoryTask | undefined> { throw new Error('Method not implemented.'); }
	getTasksForGroup(group: string): Promise<Task[]> { throw new Error('Method not implemented.'); }
	getRecentlyUsedTasks(): LinkedMap<string, string> { throw new Error('Method not implemented.'); }
	removeRecentlyUsedTask(taskRecentlyUsedKey: string): void { throw new Error('Method not implemented.'); }
	migrateRecentTasks(tasks: Task[]): Promise<void> { throw new Error('Method not implemented.'); }
	createSorter(): TaskSorter { throw new Error('Method not implemented.'); }
	getTaskDescription(task: CustomTask | ContributedTask | InMemoryTask | ConfiguringTask): string | undefined { throw new Error('Method not implemented.'); }
	canCustomize(task: CustomTask | ContributedTask): boolean { throw new Error('Method not implemented.'); }
	customize(task: CustomTask | ContributedTask | ConfiguringTask, properties?: {}, openConfig?: boolean): Promise<void> { throw new Error('Method not implemented.'); }
	openConfig(task: CustomTask | ConfiguringTask | undefined): Promise<boolean> { throw new Error('Method not implemented.'); }
	registerTaskProvider(taskProvider: ITaskProvider, type: string): IDisposable { throw new Error('Method not implemented.'); }
	registerTaskSystem(scheme: string, taskSystemInfo: TaskSystemInfo): void { throw new Error('Method not implemented.'); }
	registerSupportedExecutions(custom?: boolean, shell?: boolean, process?: boolean): void { throw new Error('Method not implemented.'); }
	setJsonTasksSupported(areSuppored: Promise<boolean>): void { throw new Error('Method not implemented.'); }
	extensionCallbackTaskComplete(task: Task, result: number | undefined): Promise<void> { throw new Error('Method not implemented.'); }
}

registerSingleton(ITaskService, SimpleTaskService);

//#endregion


//#region Extension Tips

class SimpleExtensionTipsService implements IExtensionTipsService {

	declare readonly _serviceBrand: undefined;

	onRecommendationChange = Event.None;

	async getConfigBasedTips(folder: URI): Promise<IConfigBasedExtensionTip[]> { return []; }
	async getImportantExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> { return []; }
	async getOtherExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> { return []; }
	async getAllWorkspacesTips(): Promise<IWorkspaceTips[]> { return []; }
}

registerSingleton(IExtensionTipsService, SimpleExtensionTipsService);

//#endregion


//#region Workspace Tags

class SimpleWorkspaceTagsService implements IWorkspaceTagsService {

	declare readonly _serviceBrand: undefined;

	async getTags(): Promise<Tags> { return Object.create(null); }
	async getTelemetryWorkspaceId(workspace: IWorkspace, state: WorkbenchState): Promise<string | undefined> { return undefined; }
	async getHashedRemotesFromUri(workspaceUri: URI, stripEndingDotGit?: boolean): Promise<string[]> { return []; }
}

registerSingleton(IWorkspaceTagsService, SimpleWorkspaceTagsService);

//#endregion


//#region Output Channel

class SimpleOutputChannelModelService extends AbstractOutputChannelModelService {
	declare readonly _serviceBrand: undefined;
}

registerSingleton(IOutputChannelModelService, SimpleOutputChannelModelService);

//#endregion


//#region Integrity

class SimpleIntegrityService implements IIntegrityService {

	declare readonly _serviceBrand: undefined;

	async isPure(): Promise<IntegrityTestResult> {
		return { isPure: true, proof: [] };
	}
}

registerSingleton(IIntegrityService, SimpleIntegrityService);

//#endregion

//#region Terminal Instance

class SimpleTerminalInstanceService extends TerminalInstanceService { }

registerSingleton(ITerminalInstanceService, SimpleTerminalInstanceService);
