/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workbenchInstantiationService as browserWorkbenchInstantiationService, ITestInstantiationService, TestLifecycleService, TestFilesConfigurationService, TestFileService, TestFileDialogService, TestPathService, TestEncodingOracle, TestProductService } from 'vs/workbench/test/browser/workbenchTestServices';
import { Event } from 'vs/base/common/event';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { NativeTextFileService, } from 'vs/workbench/services/textfile/electron-browser/nativeTextFileService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { FileOperationError, IFileService } from 'vs/platform/files/common/files';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModelService } from 'vs/editor/common/services/modelService';
import { INativeWorkbenchConfiguration, INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { IDialogService, IFileDialogService, INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { URI } from 'vs/base/common/uri';
import { IReadTextFileOptions, ITextFileStreamContent, ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { createTextBufferFactoryFromStream } from 'vs/editor/common/model/textModel';
import { IOpenEmptyWindowOptions, IWindowOpenable, IOpenWindowOptions, IOpenedWindow } from 'vs/platform/windows/common/windows';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { LogLevel, ILogService } from 'vs/platform/log/common/log';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { NodeTestBackupFileService } from 'vs/workbench/services/backup/test/electron-browser/backupFileService.test';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { MouseInputEvent } from 'vs/base/parts/sandbox/common/electronTypes';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IOSProperties, IOSStatistics } from 'vs/platform/native/common/native';
import { homedir, release } from 'os';

export const TestWorkbenchConfiguration: INativeWorkbenchConfiguration = {
	windowId: 0,
	machineId: 'testMachineId',
	sessionId: 'testSessionId',
	logLevel: LogLevel.Error,
	mainPid: 0,
	partsSplashPath: '',
	appRoot: '',
	userEnv: {},
	execPath: process.execPath,
	perfEntries: [],
	colorScheme: { dark: true, highContrast: false },
	os: { release: release() },
	...parseArgs(process.argv, OPTIONS)
};

export const TestEnvironmentService = new NativeWorkbenchEnvironmentService(TestWorkbenchConfiguration, TestProductService);

export class TestTextFileService extends NativeTextFileService {
	private resolveTextContentError!: FileOperationError | null;

	constructor(
		@IFileService protected fileService: IFileService,
		@IUntitledTextEditorService untitledTextEditorService: IUntitledTextEditorService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IDialogService dialogService: IDialogService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IProductService productService: IProductService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@ITextModelService textModelService: ITextModelService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IPathService pathService: IPathService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@ILogService logService: ILogService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IModeService modeService: IModeService,
		@INativeHostService nativeHostService: INativeHostService
	) {
		super(
			fileService,
			untitledTextEditorService,
			lifecycleService,
			instantiationService,
			modelService,
			environmentService,
			dialogService,
			fileDialogService,
			textResourceConfigurationService,
			filesConfigurationService,
			textModelService,
			codeEditorService,
			pathService,
			workingCopyFileService,
			uriIdentityService,
			modeService,
			nativeHostService,
			logService
		);
	}

	setResolveTextContentErrorOnce(error: FileOperationError): void {
		this.resolveTextContentError = error;
	}

	async readStream(resource: URI, options?: IReadTextFileOptions): Promise<ITextFileStreamContent> {
		if (this.resolveTextContentError) {
			const error = this.resolveTextContentError;
			this.resolveTextContentError = null;

			throw error;
		}

		const content = await this.fileService.readFileStream(resource, options);
		return {
			resource: content.resource,
			name: content.name,
			mtime: content.mtime,
			ctime: content.ctime,
			etag: content.etag,
			encoding: 'utf8',
			value: await createTextBufferFactoryFromStream(content.value),
			size: 10
		};
	}
}

export class TestNativeTextFileServiceWithEncodingOverrides extends NativeTextFileService {

	private _testEncoding: TestEncodingOracle | undefined;
	get encoding(): TestEncodingOracle {
		if (!this._testEncoding) {
			this._testEncoding = this._register(this.instantiationService.createInstance(TestEncodingOracle));
		}

		return this._testEncoding;
	}
}

export class TestSharedProcessService implements ISharedProcessService {

	declare readonly _serviceBrand: undefined;

	getChannel(channelName: string): any { return undefined; }

	registerChannel(channelName: string, channel: any): void { }

	async toggleSharedProcessWindow(): Promise<void> { }
	async whenSharedProcessReady(): Promise<void> { }
}

export class TestNativeHostService implements INativeHostService {

	declare readonly _serviceBrand: undefined;

	readonly windowId = -1;

	onDidOpenWindow: Event<number> = Event.None;
	onDidMaximizeWindow: Event<number> = Event.None;
	onDidUnmaximizeWindow: Event<number> = Event.None;
	onDidFocusWindow: Event<number> = Event.None;
	onDidBlurWindow: Event<number> = Event.None;
	onDidResumeOS: Event<unknown> = Event.None;
	onDidChangeColorScheme = Event.None;
	onDidChangePassword = Event.None;

	windowCount = Promise.resolve(1);
	getWindowCount(): Promise<number> { return this.windowCount; }

	async getWindows(): Promise<IOpenedWindow[]> { return []; }
	async getActiveWindowId(): Promise<number | undefined> { return undefined; }

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;
	openWindow(arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> {
		throw new Error('Method not implemented.');
	}

	async toggleFullScreen(): Promise<void> { }
	async handleTitleDoubleClick(): Promise<void> { }
	async isMaximized(): Promise<boolean> { return true; }
	async maximizeWindow(): Promise<void> { }
	async unmaximizeWindow(): Promise<void> { }
	async minimizeWindow(): Promise<void> { }
	async setMinimumSize(width: number | undefined, height: number | undefined): Promise<void> { }
	async focusWindow(options?: { windowId?: number | undefined; } | undefined): Promise<void> { }
	async showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> { throw new Error('Method not implemented.'); }
	async showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> { throw new Error('Method not implemented.'); }
	async showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> { throw new Error('Method not implemented.'); }
	async pickFileFolderAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async pickFileAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async pickFolderAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async pickWorkspaceAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async showItemInFolder(path: string): Promise<void> { }
	async setRepresentedFilename(path: string): Promise<void> { }
	async isAdmin(): Promise<boolean> { return false; }
	async writeElevated(source: URI, target: URI, options?: { overwriteReadonly?: boolean | undefined; }): Promise<void> { }
	async getOSProperties(): Promise<IOSProperties> { return Object.create(null); }
	async getOSStatistics(): Promise<IOSStatistics> { return Object.create(null); }
	async getOSVirtualMachineHint(): Promise<number> { return 0; }
	async killProcess(): Promise<void> { }
	async setDocumentEdited(edited: boolean): Promise<void> { }
	async openExternal(url: string): Promise<boolean> { return false; }
	async updateTouchBar(): Promise<void> { }
	async moveItemToTrash(): Promise<boolean> { return false; }
	async newWindowTab(): Promise<void> { }
	async showPreviousWindowTab(): Promise<void> { }
	async showNextWindowTab(): Promise<void> { }
	async moveWindowTabToNewWindow(): Promise<void> { }
	async mergeAllWindowTabs(): Promise<void> { }
	async toggleWindowTabsBar(): Promise<void> { }
	async notifyReady(): Promise<void> { }
	async relaunch(options?: { addArgs?: string[] | undefined; removeArgs?: string[] | undefined; } | undefined): Promise<void> { }
	async reload(): Promise<void> { }
	async closeWindow(): Promise<void> { }
	async closeWindowById(): Promise<void> { }
	async quit(): Promise<void> { }
	async exit(code: number): Promise<void> { }
	async openDevTools(options?: Electron.OpenDevToolsOptions | undefined): Promise<void> { }
	async toggleDevTools(): Promise<void> { }
	async resolveProxy(url: string): Promise<string | undefined> { return undefined; }
	async readClipboardText(type?: 'selection' | 'clipboard' | undefined): Promise<string> { return ''; }
	async writeClipboardText(text: string, type?: 'selection' | 'clipboard' | undefined): Promise<void> { }
	async readClipboardFindText(): Promise<string> { return ''; }
	async writeClipboardFindText(text: string): Promise<void> { }
	async writeClipboardBuffer(format: string, buffer: Uint8Array, type?: 'selection' | 'clipboard' | undefined): Promise<void> { }
	async readClipboardBuffer(format: string): Promise<Uint8Array> { return Uint8Array.from([]); }
	async hasClipboard(format: string, type?: 'selection' | 'clipboard' | undefined): Promise<boolean> { return false; }
	async sendInputEvent(event: MouseInputEvent): Promise<void> { }
	async windowsGetStringRegKey(hive: 'HKEY_CURRENT_USER' | 'HKEY_LOCAL_MACHINE' | 'HKEY_CLASSES_ROOT' | 'HKEY_USERS' | 'HKEY_CURRENT_CONFIG', path: string, name: string): Promise<string | undefined> { return undefined; }
	async getPassword(service: string, account: string): Promise<string | null> { return null; }
	async setPassword(service: string, account: string, password: string): Promise<void> { }
	async deletePassword(service: string, account: string): Promise<boolean> { return false; }
	async findPassword(service: string): Promise<string | null> { return null; }
	async findCredentials(service: string): Promise<{ account: string; password: string; }[]> { return []; }
}

export function workbenchInstantiationService(): ITestInstantiationService {
	const instantiationService = browserWorkbenchInstantiationService({
		textFileService: insta => <ITextFileService>insta.createInstance(TestTextFileService),
		pathService: insta => <IPathService>insta.createInstance(TestNativePathService)
	});

	instantiationService.stub(INativeHostService, new TestNativeHostService());
	instantiationService.stub(INativeWorkbenchEnvironmentService, TestEnvironmentService);

	return instantiationService;
}

export class TestServiceAccessor {
	constructor(
		@ILifecycleService public lifecycleService: TestLifecycleService,
		@ITextFileService public textFileService: TestTextFileService,
		@IFilesConfigurationService public filesConfigurationService: TestFilesConfigurationService,
		@IWorkspaceContextService public contextService: TestContextService,
		@IModelService public modelService: ModelServiceImpl,
		@IFileService public fileService: TestFileService,
		@INativeHostService public nativeHostService: TestNativeHostService,
		@IFileDialogService public fileDialogService: TestFileDialogService,
		@IBackupFileService public backupFileService: NodeTestBackupFileService,
		@IWorkingCopyService public workingCopyService: IWorkingCopyService,
		@IEditorService public editorService: IEditorService
	) {
	}
}

export class TestNativePathService extends TestPathService {

	declare readonly _serviceBrand: undefined;

	constructor() {
		super(URI.file(homedir()));
	}
}
