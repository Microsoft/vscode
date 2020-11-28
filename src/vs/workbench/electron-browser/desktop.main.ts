/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as gracefulFs from 'graceful-fs';
import { createHash } from 'crypto';
import { stat } from 'vs/base/node/pfs';
import { isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { zoomLevelToZoomFactor } from 'vs/platform/windows/common/windows';
import { importEntries, mark } from 'vs/base/common/performance';
import { Workbench } from 'vs/workbench/browser/workbench';
import { NativeWindow } from 'vs/workbench/electron-sandbox/window';
import { setZoomLevel, setZoomFactor, setFullscreen } from 'vs/base/browser/browser';
import { domContentLoaded, addDisposableListener, EventType, scheduleAtNextAnimationFrame } from 'vs/base/browser/dom';
import { onUnexpectedError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { INativeWorkbenchConfiguration, INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceInitializationPayload, ISingleFolderWorkspaceInitializationPayload, reviveWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ILogService } from 'vs/platform/log/common/log';
import { NativeStorageService } from 'vs/platform/storage/node/storageService';
import { Schemas } from 'vs/base/common/network';
import { sanitizeFilePath } from 'vs/base/common/extpath';
import { GlobalStorageDatabaseChannelClient } from 'vs/platform/storage/node/storageIpc';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { Disposable } from 'vs/base/common/lifecycle';
import { registerWindowDriver } from 'vs/platform/driver/electron-browser/driver';
import { IMainProcessService, MainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { RemoteAuthorityResolverService } from 'vs/platform/remote/electron-sandbox/remoteAuthorityResolverService';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/electron-browser/diskFileSystemProvider';
import { RemoteFileSystemProvider } from 'vs/workbench/services/remote/common/remoteAgentFileSystemChannel';
import { ConfigurationCache } from 'vs/workbench/services/configuration/electron-browser/configurationCache';
import { SignService } from 'vs/platform/sign/node/signService';
import { ISignService } from 'vs/platform/sign/common/sign';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { basename } from 'vs/base/common/path';
import { IProductService } from 'vs/platform/product/common/productService';
import product from 'vs/platform/product/common/product';
import { NativeLogService } from 'vs/workbench/services/log/electron-browser/logService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { NativeHostService } from 'vs/platform/native/electron-sandbox/nativeHostService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { KeyboardLayoutService } from 'vs/workbench/services/keybinding/electron-sandbox/nativeKeyboardLayout';
import { IKeyboardLayoutService } from 'vs/platform/keyboardLayout/common/keyboardLayout';

class DesktopMain extends Disposable {

	private readonly productService: IProductService = { _serviceBrand: undefined, ...product };
	private readonly environmentService = new NativeWorkbenchEnvironmentService(this.configuration, this.productService);

	constructor(private configuration: INativeWorkbenchConfiguration) {
		super();

		this.init();
	}

	private init(): void {

		// Enable gracefulFs
		gracefulFs.gracefulify(fs);

		// Massage configuration file URIs
		this.reviveUris();

		// Setup perf
		importEntries(this.configuration.perfEntries);

		// Browser config
		const zoomLevel = this.configuration.zoomLevel || 0;
		setZoomFactor(zoomLevelToZoomFactor(zoomLevel));
		setZoomLevel(zoomLevel, true /* isTrusted */);
		setFullscreen(!!this.configuration.fullscreen);
	}

	private reviveUris() {
		if (this.configuration.folderUri) {
			this.configuration.folderUri = URI.revive(this.configuration.folderUri);
		}

		if (this.configuration.workspace) {
			this.configuration.workspace = reviveWorkspaceIdentifier(this.configuration.workspace);
		}

		const filesToWait = this.configuration.filesToWait;
		const filesToWaitPaths = filesToWait?.paths;
		[filesToWaitPaths, this.configuration.filesToOpenOrCreate, this.configuration.filesToDiff].forEach(paths => {
			if (Array.isArray(paths)) {
				paths.forEach(path => {
					if (path.fileUri) {
						path.fileUri = URI.revive(path.fileUri);
					}
				});
			}
		});

		if (filesToWait) {
			filesToWait.waitMarkerFileUri = URI.revive(filesToWait.waitMarkerFileUri);
		}
	}

	async open(): Promise<void> {
		const services = await this.initServices();

		await domContentLoaded();
		mark('willStartWorkbench');

		// Create Workbench
		const workbench = new Workbench(document.body, services.serviceCollection, services.logService);

		// Listeners
		this.registerListeners(workbench, services.storageService);

		// Startup
		const instantiationService = workbench.startup();

		// Window
		this._register(instantiationService.createInstance(NativeWindow));

		// Driver
		if (this.configuration.driver) {
			instantiationService.invokeFunction(async accessor => this._register(await registerWindowDriver(accessor, this.configuration.windowId)));
		}

		// Logging
		services.logService.trace('workbench configuration', JSON.stringify(this.configuration));
	}

	private registerListeners(workbench: Workbench, storageService: NativeStorageService): void {

		// Layout
		this._register(addDisposableListener(window, EventType.RESIZE, e => this.onWindowResize(e, true, workbench)));

		// Workbench Lifecycle
		this._register(workbench.onShutdown(() => this.dispose()));
		this._register(workbench.onWillShutdown(event => event.join(storageService.close())));
	}

	private onWindowResize(e: Event, retry: boolean, workbench: Workbench): void {
		if (e.target === window) {
			if (window.document && window.document.body && window.document.body.clientWidth === 0) {
				// TODO@Ben this is an electron issue on macOS when simple fullscreen is enabled
				// where for some reason the window clientWidth is reported as 0 when switching
				// between simple fullscreen and normal screen. In that case we schedule the layout
				// call at the next animation frame once, in the hope that the dimensions are
				// proper then.
				if (retry) {
					scheduleAtNextAnimationFrame(() => this.onWindowResize(e, false, workbench));
				}
				return;
			}

			workbench.layout();
		}
	}

	private async initServices(): Promise<{ serviceCollection: ServiceCollection, logService: ILogService, storageService: NativeStorageService }> {
		const serviceCollection = new ServiceCollection();


		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.sandbox.main.ts` if the service
		//       is desktop only.
		//
		//       DO NOT add services to `workbench.desktop.main.ts`, always add
		//       to `workbench.sandbox.main.ts` to support our Electron sandbox
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		// Main Process
		const mainProcessService = this._register(new MainProcessService(this.configuration.windowId));
		serviceCollection.set(IMainProcessService, mainProcessService);

		// Environment
		serviceCollection.set(IWorkbenchEnvironmentService, this.environmentService);
		serviceCollection.set(INativeWorkbenchEnvironmentService, this.environmentService);

		// Product
		serviceCollection.set(IProductService, this.productService);

		// Log
		const logService = this._register(new NativeLogService(this.configuration.windowId, mainProcessService, this.environmentService));
		serviceCollection.set(ILogService, logService);

		// Remote
		const remoteAuthorityResolverService = new RemoteAuthorityResolverService();
		serviceCollection.set(IRemoteAuthorityResolverService, remoteAuthorityResolverService);


		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.sandbox.main.ts` if the service
		//       is desktop only.
		//
		//       DO NOT add services to `workbench.desktop.main.ts`, always add
		//       to `workbench.sandbox.main.ts` to support our Electron sandbox
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		// Sign
		const signService = new SignService();
		serviceCollection.set(ISignService, signService);

		// Remote Agent
		const remoteAgentService = this._register(new RemoteAgentService(this.environmentService, this.productService, remoteAuthorityResolverService, signService, logService));
		serviceCollection.set(IRemoteAgentService, remoteAgentService);

		// Native Host
		const nativeHostService = new NativeHostService(this.configuration.windowId, mainProcessService) as INativeHostService;
		serviceCollection.set(INativeHostService, nativeHostService);

		// Files
		const fileService = this._register(new FileService(logService));
		serviceCollection.set(IFileService, fileService);

		const diskFileSystemProvider = this._register(new DiskFileSystemProvider(logService, nativeHostService));
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		// User Data Provider
		fileService.registerProvider(Schemas.userData, new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, logService));

		// Uri Identity
		const uriIdentityService = new UriIdentityService(fileService);
		serviceCollection.set(IUriIdentityService, uriIdentityService);

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.sandbox.main.ts` if the service
		//       is desktop only.
		//
		//       DO NOT add services to `workbench.desktop.main.ts`, always add
		//       to `workbench.sandbox.main.ts` to support our Electron sandbox
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		const connection = remoteAgentService.getConnection();
		if (connection) {
			const remoteFileSystemProvider = this._register(new RemoteFileSystemProvider(remoteAgentService));
			fileService.registerProvider(Schemas.vscodeRemote, remoteFileSystemProvider);
		}

		const payload = await this.resolveWorkspaceInitializationPayload();

		const services = await Promise.all([
			this.createWorkspaceService(payload, fileService, remoteAgentService, uriIdentityService, logService).then(service => {

				// Workspace
				serviceCollection.set(IWorkspaceContextService, service);

				// Configuration
				serviceCollection.set(IConfigurationService, service);

				return service;
			}),

			this.createStorageService(payload, logService, mainProcessService).then(service => {

				// Storage
				serviceCollection.set(IStorageService, service);

				return service;
			}),

			this.createKeyboardLayoutService(logService, mainProcessService).then(service => {

				// KeyboardLayout
				serviceCollection.set(IKeyboardLayoutService, service);

				return service;
			})
		]);


		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.sandbox.main.ts` if the service
		//       is desktop only.
		//
		//       DO NOT add services to `workbench.desktop.main.ts`, always add
		//       to `workbench.sandbox.main.ts` to support our Electron sandbox
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!


		return { serviceCollection, logService, storageService: services[1] };
	}

	private async resolveWorkspaceInitializationPayload(): Promise<IWorkspaceInitializationPayload> {

		// Multi-root workspace
		if (this.configuration.workspace) {
			return this.configuration.workspace;
		}

		// Single-folder workspace
		let workspaceInitializationPayload: IWorkspaceInitializationPayload | undefined;
		if (this.configuration.folderUri) {
			workspaceInitializationPayload = await this.resolveSingleFolderWorkspaceInitializationPayload(this.configuration.folderUri);
		}

		// Fallback to empty workspace if we have no payload yet.
		if (!workspaceInitializationPayload) {
			let id: string;
			if (this.configuration.backupPath) {
				id = basename(this.configuration.backupPath); // we know the backupPath must be a unique path so we leverage its name as workspace ID
			} else if (this.environmentService.isExtensionDevelopment) {
				id = 'ext-dev'; // extension development window never stores backups and is a singleton
			} else {
				throw new Error('Unexpected window configuration without backupPath');
			}

			workspaceInitializationPayload = { id };
		}

		return workspaceInitializationPayload;
	}

	private async resolveSingleFolderWorkspaceInitializationPayload(folderUri: ISingleFolderWorkspaceIdentifier): Promise<ISingleFolderWorkspaceInitializationPayload | undefined> {
		try {
			const folder = folderUri.scheme === Schemas.file
				? URI.file(sanitizeFilePath(folderUri.fsPath, process.env['VSCODE_CWD'] || process.cwd())) // For local: ensure path is absolute
				: folderUri;
			const id = await this.createHash(folderUri);
			return { id, folder };
		} catch (error) {
			onUnexpectedError(error);
		}

		return;
	}

	private async createHash(resource: URI): Promise<string> {

		// Return early the folder is not local
		if (resource.scheme !== Schemas.file) {
			return createHash('md5').update(resource.toString()).digest('hex');
		}

		const fileStat = await stat(resource.fsPath);
		let ctime: number | undefined;
		if (isLinux) {
			ctime = fileStat.ino; // Linux: birthtime is ctime, so we cannot use it! We use the ino instead!
		} else if (isMacintosh) {
			ctime = fileStat.birthtime.getTime(); // macOS: birthtime is fine to use as is
		} else if (isWindows) {
			if (typeof fileStat.birthtimeMs === 'number') {
				ctime = Math.floor(fileStat.birthtimeMs); // Windows: fix precision issue in node.js 8.x to get 7.x results (see https://github.com/nodejs/node/issues/19897)
			} else {
				ctime = fileStat.birthtime.getTime();
			}
		}

		// we use the ctime as extra salt to the ID so that we catch the case of a folder getting
		// deleted and recreated. in that case we do not want to carry over previous state
		return createHash('md5').update(resource.fsPath).update(ctime ? String(ctime) : '').digest('hex');
	}

	private async createWorkspaceService(payload: IWorkspaceInitializationPayload, fileService: FileService, remoteAgentService: IRemoteAgentService, uriIdentityService: IUriIdentityService, logService: ILogService): Promise<WorkspaceService> {
		const workspaceService = new WorkspaceService({ remoteAuthority: this.environmentService.remoteAuthority, configurationCache: new ConfigurationCache(this.environmentService) }, this.environmentService, fileService, remoteAgentService, uriIdentityService, logService);

		try {
			await workspaceService.initialize(payload);

			return workspaceService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return workspaceService;
		}
	}

	private async createStorageService(payload: IWorkspaceInitializationPayload, logService: ILogService, mainProcessService: IMainProcessService): Promise<NativeStorageService> {
		const globalStorageDatabase = new GlobalStorageDatabaseChannelClient(mainProcessService.getChannel('storage'));
		const storageService = new NativeStorageService(globalStorageDatabase, logService, this.environmentService);

		try {
			await storageService.initialize(payload);

			return storageService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return storageService;
		}
	}

	private async createKeyboardLayoutService(logService: ILogService, mainProcessService: IMainProcessService): Promise<KeyboardLayoutService> {
		const keyboardLayoutService = new KeyboardLayoutService(mainProcessService);

		try {
			await keyboardLayoutService.initialize();

			return keyboardLayoutService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return keyboardLayoutService;
		}
	}
}

export function main(configuration: INativeWorkbenchConfiguration): Promise<void> {
	const workbench = new DesktopMain(configuration);

	return workbench.open();
}
