/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as gracefulFs from 'graceful-fs';
import { webFrame } from 'electron';
import { importEntries, mark } from 'vs/base/common/performance';
import { Workbench } from 'vs/workbench/browser/workbench';
import { NativeWindow } from 'vs/workbench/electron-browser/window';
import { setZoomLevel, setZoomFactor, setFullscreen } from 'vs/base/browser/browser';
import { domContentLoaded, addDisposableListener, EventType, scheduleAtNextAnimationFrame } from 'vs/base/browser/dom';
import { onUnexpectedError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { KeyboardMapperFactory } from 'vs/workbench/services/keybinding/electron-browser/nativeKeymapService';
import { INativeWindowConfiguration } from 'vs/platform/windows/node/window';
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
import { IMainProcessService, MainProcessService } from 'vs/platform/ipc/electron-browser/mainProcessService';
import { RemoteAuthorityResolverService } from 'vs/platform/remote/electron-browser/remoteAuthorityResolverService';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/electron-browser/diskFileSystemProvider';
import { RemoteFileSystemProvider } from 'vs/workbench/services/remote/common/remoteAgentFileSystemChannel';
import { ConfigurationCache } from 'vs/workbench/services/configuration/node/configurationCache';
import { SignService } from 'vs/platform/sign/node/signService';
import { ISignService } from 'vs/platform/sign/common/sign';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { basename } from 'vs/base/common/resources';
import { IProductService } from 'vs/platform/product/common/productService';
import product from 'vs/platform/product/common/product';
import { NativeResourceIdentityService } from 'vs/platform/resource/node/resourceIdentityServiceImpl';
import { IResourceIdentityService } from 'vs/platform/resource/common/resourceIdentityService';
import { DesktopLogService } from 'vs/workbench/services/log/electron-browser/logService';

class DesktopMain extends Disposable {

	private readonly environmentService = new NativeWorkbenchEnvironmentService(this.configuration, this.configuration.execPath);

	constructor(private configuration: INativeWindowConfiguration) {
		super();

		this.init();
	}

	private init(): void {

		// Enable gracefulFs
		gracefulFs.gracefulify(fs);

		// Massage configuration file URIs
		this.reviveUris();

		// Setup perf
		importEntries(this.environmentService.configuration.perfEntries);

		// Browser config
		setZoomFactor(webFrame.getZoomFactor()); // Ensure others can listen to zoom level changes
		setZoomLevel(webFrame.getZoomLevel(), true /* isTrusted */); // Can be trusted because we are not setting it ourselves (https://github.com/Microsoft/vscode/issues/26151)
		setFullscreen(!!this.environmentService.configuration.fullscreen);

		// Keyboard support
		KeyboardMapperFactory.INSTANCE._onKeyboardLayoutChanged();
	}

	private reviveUris() {
		if (this.environmentService.configuration.folderUri) {
			this.environmentService.configuration.folderUri = URI.revive(this.environmentService.configuration.folderUri);
		}

		if (this.environmentService.configuration.workspace) {
			this.environmentService.configuration.workspace = reviveWorkspaceIdentifier(this.environmentService.configuration.workspace);
		}

		const filesToWait = this.environmentService.configuration.filesToWait;
		const filesToWaitPaths = filesToWait?.paths;
		[filesToWaitPaths, this.environmentService.configuration.filesToOpenOrCreate, this.environmentService.configuration.filesToDiff].forEach(paths => {
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
		if (this.environmentService.configuration.driver) {
			instantiationService.invokeFunction(async accessor => this._register(await registerWindowDriver(accessor, this.configuration.windowId)));
		}

		// Logging
		services.logService.trace('workbench configuration', JSON.stringify(this.environmentService.configuration));
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

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// NOTE: DO NOT ADD ANY OTHER SERVICE INTO THE COLLECTION HERE.
		// CONTRIBUTE IT VIA WORKBENCH.DESKTOP.MAIN.TS AND registerSingleton().
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		// Main Process
		const mainProcessService = this._register(new MainProcessService(this.configuration.windowId));
		serviceCollection.set(IMainProcessService, mainProcessService);

		// Environment
		serviceCollection.set(IWorkbenchEnvironmentService, this.environmentService);

		// Product
		serviceCollection.set(IProductService, { _serviceBrand: undefined, ...product });

		// Log
		const logService = this._register(new DesktopLogService(this.configuration.windowId, mainProcessService, this.environmentService));
		serviceCollection.set(ILogService, logService);

		// Remote
		const remoteAuthorityResolverService = new RemoteAuthorityResolverService();
		serviceCollection.set(IRemoteAuthorityResolverService, remoteAuthorityResolverService);

		// Sign
		const signService = new SignService();
		serviceCollection.set(ISignService, signService);

		const remoteAgentService = this._register(new RemoteAgentService(this.environmentService, remoteAuthorityResolverService, signService, logService));
		serviceCollection.set(IRemoteAgentService, remoteAgentService);

		// Files
		const fileService = this._register(new FileService(logService));
		serviceCollection.set(IFileService, fileService);

		const diskFileSystemProvider = this._register(new DiskFileSystemProvider(logService));
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		// User Data Provider
		fileService.registerProvider(Schemas.userData, new FileUserDataProvider(this.environmentService.appSettingsHome, this.environmentService.backupHome, diskFileSystemProvider, this.environmentService, logService));

		const connection = remoteAgentService.getConnection();
		if (connection) {
			const remoteFileSystemProvider = this._register(new RemoteFileSystemProvider(remoteAgentService));
			fileService.registerProvider(Schemas.vscodeRemote, remoteFileSystemProvider);
		}

		const resourceIdentityService = this._register(new NativeResourceIdentityService());
		serviceCollection.set(IResourceIdentityService, resourceIdentityService);

		const payload = await this.resolveWorkspaceInitializationPayload(resourceIdentityService);

		const services = await Promise.all([
			this.createWorkspaceService(payload, fileService, remoteAgentService, logService).then(service => {

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
			})
		]);

		return { serviceCollection, logService, storageService: services[1] };
	}

	private async resolveWorkspaceInitializationPayload(resourceIdentityService: IResourceIdentityService): Promise<IWorkspaceInitializationPayload> {

		// Multi-root workspace
		if (this.environmentService.configuration.workspace) {
			return this.environmentService.configuration.workspace;
		}

		// Single-folder workspace
		let workspaceInitializationPayload: IWorkspaceInitializationPayload | undefined;
		if (this.environmentService.configuration.folderUri) {
			workspaceInitializationPayload = await this.resolveSingleFolderWorkspaceInitializationPayload(this.environmentService.configuration.folderUri, resourceIdentityService);
		}

		// Fallback to empty workspace if we have no payload yet.
		if (!workspaceInitializationPayload) {
			let id: string;
			if (this.environmentService.configuration.backupWorkspaceResource) {
				id = basename(this.environmentService.configuration.backupWorkspaceResource); // we know the backupPath must be a unique path so we leverage its name as workspace ID
			} else if (this.environmentService.isExtensionDevelopment) {
				id = 'ext-dev'; // extension development window never stores backups and is a singleton
			} else {
				throw new Error('Unexpected window configuration without backupPath');
			}

			workspaceInitializationPayload = { id };
		}

		return workspaceInitializationPayload;
	}

	private async resolveSingleFolderWorkspaceInitializationPayload(folderUri: ISingleFolderWorkspaceIdentifier, resourceIdentityService: IResourceIdentityService): Promise<ISingleFolderWorkspaceInitializationPayload | undefined> {
		try {
			const folder = folderUri.scheme === Schemas.file
				? URI.file(sanitizeFilePath(folderUri.fsPath, process.env['VSCODE_CWD'] || process.cwd())) // For local: ensure path is absolute
				: folderUri;
			const id = await resourceIdentityService.resolveResourceIdentity(folderUri);
			return { id, folder };
		} catch (error) {
			onUnexpectedError(error);
		}
		return;
	}

	private async createWorkspaceService(payload: IWorkspaceInitializationPayload, fileService: FileService, remoteAgentService: IRemoteAgentService, logService: ILogService): Promise<WorkspaceService> {
		const workspaceService = new WorkspaceService({ remoteAuthority: this.environmentService.configuration.remoteAuthority, configurationCache: new ConfigurationCache(this.environmentService) }, this.environmentService, fileService, remoteAgentService);

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

}

export function main(configuration: INativeWindowConfiguration): Promise<void> {
	const workbench = new DesktopMain(configuration);

	return workbench.open();
}
