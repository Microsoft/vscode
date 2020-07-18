/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mark } from 'vs/base/common/performance';
import { domContentLoaded, addDisposableListener, EventType, EventHelper } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService, ConsoleLogService, MultiplexLogService } from 'vs/platform/log/common/log';
import { ConsoleLogInAutomationService } from 'vs/platform/log/browser/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { Workbench } from 'vs/workbench/browser/workbench';
import { RemoteFileSystemProvider } from 'vs/workbench/services/remote/common/remoteAgentFileSystemChannel';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IProductService } from 'vs/platform/product/common/productService';
import product from 'vs/platform/product/common/product';
import { RemoteAgentService } from 'vs/workbench/services/remote/browser/remoteAgentServiceImpl';
import { RemoteAuthorityResolverService } from 'vs/platform/remote/browser/remoteAuthorityResolverService';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IFileService, IFileSystemProvider } from 'vs/platform/files/common/files';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { onUnexpectedError } from 'vs/base/common/errors';
import * as browser from 'vs/base/browser/browser';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ConfigurationCache } from 'vs/workbench/services/configuration/browser/configurationCache';
import { ISignService } from 'vs/platform/sign/common/sign';
import { SignService } from 'vs/platform/sign/browser/signService';
import { IWorkbenchConstructionOptions, IWorkspace, IWorkbench } from 'vs/workbench/workbench.web.api';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { BACKUPS } from 'vs/platform/environment/common/environment';
import { joinPath } from 'vs/base/common/resources';
import { BrowserStorageService } from 'vs/platform/storage/browser/storageService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { registerWindowDriver } from 'vs/platform/driver/browser/driver';
import { BufferLogService } from 'vs/platform/log/common/bufferLog';
import { FileLogService } from 'vs/platform/log/common/fileLogService';
import { toLocalISOString } from 'vs/base/common/date';
import { isWorkspaceToOpen, isFolderToOpen } from 'vs/platform/windows/common/windows';
import { getWorkspaceIdentifier } from 'vs/workbench/services/workspaces/browser/workspaces';
import { coalesce } from 'vs/base/common/arrays';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { WebResourceIdentityService, IResourceIdentityService } from 'vs/platform/resource/common/resourceIdentityService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IndexedDB, INDEXEDDB_LOGS_OBJECT_STORE, INDEXEDDB_USERDATA_OBJECT_STORE } from 'vs/platform/files/browser/indexedDBFileSystemProvider';

class BrowserMain extends Disposable {

	constructor(
		private readonly domElement: HTMLElement,
		private readonly configuration: IWorkbenchConstructionOptions
	) {
		super();
	}

	async open(): Promise<IWorkbench> {
		const services = await this.initServices();

		await domContentLoaded();
		mark('willStartWorkbench');

		// Create Workbench
		const workbench = new Workbench(
			this.domElement,
			services.serviceCollection,
			services.logService
		);

		// Listeners
		this.registerListeners(workbench, services.storageService);

		// Driver
		if (this.configuration.driver) {
			(async () => this._register(await registerWindowDriver()))();
		}

		// Startup
		const instantiationService = workbench.startup();

		// Return API Facade
		return instantiationService.invokeFunction(accessor => {
			const commandService = accessor.get(ICommandService);

			return {
				commands: {
					executeCommand: (command, ...args) => commandService.executeCommand(command, ...args)
				}
			};
		});
	}

	private registerListeners(workbench: Workbench, storageService: BrowserStorageService): void {

		// Layout
		const viewport = platform.isIOS && (<any>window).visualViewport ? (<any>window).visualViewport /** Visual viewport */ : window /** Layout viewport */;
		this._register(addDisposableListener(viewport, EventType.RESIZE, () => workbench.layout()));

		// Prevent the back/forward gestures in macOS
		this._register(addDisposableListener(this.domElement, EventType.WHEEL, e => e.preventDefault(), { passive: false }));

		// Prevent native context menus in web
		this._register(addDisposableListener(this.domElement, EventType.CONTEXT_MENU, e => EventHelper.stop(e, true)));

		// Prevent default navigation on drop
		this._register(addDisposableListener(this.domElement, EventType.DROP, e => EventHelper.stop(e, true)));

		// Workbench Lifecycle
		this._register(workbench.onBeforeShutdown(event => {
			if (storageService.hasPendingUpdate) {
				console.warn('Unload prevented: pending storage update');
				event.veto(true); // prevent data loss from pending storage update
			}
		}));
		this._register(workbench.onWillShutdown(() => {
			storageService.close();
		}));
		this._register(workbench.onShutdown(() => this.dispose()));

		// Fullscreen
		[EventType.FULLSCREEN_CHANGE, EventType.WK_FULLSCREEN_CHANGE].forEach(event => {
			this._register(addDisposableListener(document, event, () => {
				if (document.fullscreenElement || (<any>document).webkitFullscreenElement || (<any>document).webkitIsFullScreen) {
					browser.setFullscreen(true);
				} else {
					browser.setFullscreen(false);
				}
			}));
		});
	}

	private async initServices(): Promise<{ serviceCollection: ServiceCollection, logService: ILogService, storageService: BrowserStorageService }> {
		const serviceCollection = new ServiceCollection();

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// NOTE: DO NOT ADD ANY OTHER SERVICE INTO THE COLLECTION HERE.
		// CONTRIBUTE IT VIA WORKBENCH.WEB.MAIN.TS AND registerSingleton().
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		// Log
		const logsPath = URI.file(toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '')).with({ scheme: 'vscode-log' });
		const logService = new BufferLogService(this.configuration.logLevel);
		serviceCollection.set(ILogService, logService);

		// Resource Identity
		const resourceIdentityService = this._register(new WebResourceIdentityService());
		serviceCollection.set(IResourceIdentityService, resourceIdentityService);

		const payload = await this.resolveWorkspaceInitializationPayload(resourceIdentityService);

		// Environment
		const environmentService = new BrowserWorkbenchEnvironmentService({ workspaceId: payload.id, logsPath, ...this.configuration });
		serviceCollection.set(IWorkbenchEnvironmentService, environmentService);

		// Product
		const productService: IProductService = { _serviceBrand: undefined, ...product, ...this.configuration.productConfiguration };
		serviceCollection.set(IProductService, productService);

		// Remote
		const remoteAuthorityResolverService = new RemoteAuthorityResolverService(this.configuration.resourceUriProvider);
		serviceCollection.set(IRemoteAuthorityResolverService, remoteAuthorityResolverService);

		// Signing
		const signService = new SignService(environmentService.options.connectionToken || this.getCookieValue('vscode-tkn'));
		serviceCollection.set(ISignService, signService);

		// Remote Agent
		const remoteAgentService = this._register(new RemoteAgentService(this.configuration.webSocketFactory, environmentService, productService, remoteAuthorityResolverService, signService, logService));
		serviceCollection.set(IRemoteAgentService, remoteAgentService);

		// Files
		const fileService = this._register(new FileService(logService));
		serviceCollection.set(IFileService, fileService);
		await this.registerFileSystemProviders(environmentService, fileService, remoteAgentService, logService, logsPath);

		// Long running services (workspace, config, storage)
		const services = await Promise.all([
			this.createWorkspaceService(payload, environmentService, fileService, remoteAgentService, logService).then(service => {

				// Workspace
				serviceCollection.set(IWorkspaceContextService, service);

				// Configuration
				serviceCollection.set(IConfigurationService, service);

				return service;
			}),

			this.createStorageService(payload, environmentService, fileService, logService).then(service => {

				// Storage
				serviceCollection.set(IStorageService, service);

				return service;
			})
		]);

		return { serviceCollection, logService, storageService: services[1] };
	}

	private async registerFileSystemProviders(environmentService: IWorkbenchEnvironmentService, fileService: IFileService, remoteAgentService: IRemoteAgentService, logService: BufferLogService, logsPath: URI): Promise<void> {
		const indexedDB = new IndexedDB();

		// Logger
		(async () => {
			let indexedDBLogProvider: IFileSystemProvider | null = null;
			try {
				indexedDBLogProvider = await indexedDB.createFileSystemProvider(logsPath.scheme, INDEXEDDB_LOGS_OBJECT_STORE);
			} catch (error) {
				console.error(error);
			}
			if (indexedDBLogProvider) {
				fileService.registerProvider(logsPath.scheme, indexedDBLogProvider);
			} else {
				fileService.registerProvider(logsPath.scheme, new InMemoryFileSystemProvider());
			}

			logService.logger = new MultiplexLogService(coalesce([
				new ConsoleLogService(logService.getLevel()),
				new FileLogService('window', environmentService.logFile, logService.getLevel(), fileService),
				// Extension development test CLI: forward everything to test runner
				environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI ? new ConsoleLogInAutomationService(logService.getLevel()) : undefined
			]));
		})();

		const connection = remoteAgentService.getConnection();
		if (connection) {

			// Remote file system
			const remoteFileSystemProvider = this._register(new RemoteFileSystemProvider(remoteAgentService));
			fileService.registerProvider(Schemas.vscodeRemote, remoteFileSystemProvider);

			if (!this.configuration.userDataProvider) {
				const remoteUserDataUri = this.getRemoteUserDataUri();
				if (remoteUserDataUri) {
					this.configuration.userDataProvider = this._register(new FileUserDataProvider(remoteUserDataUri, joinPath(remoteUserDataUri, BACKUPS), remoteFileSystemProvider, environmentService, logService));
				}
			}
		}

		// User data
		if (!this.configuration.userDataProvider) {
			let indexedDBUserDataProvider: IFileSystemProvider | null = null;
			try {
				indexedDBUserDataProvider = await indexedDB.createFileSystemProvider(Schemas.userData, INDEXEDDB_USERDATA_OBJECT_STORE);
			} catch (error) {
				console.error(error);
			}
			if (indexedDBUserDataProvider) {
				this.configuration.userDataProvider = indexedDBUserDataProvider;
			} else {
				this.configuration.userDataProvider = new InMemoryFileSystemProvider();
			}
		}

		fileService.registerProvider(Schemas.userData, this.configuration.userDataProvider);
	}

	private async createStorageService(payload: IWorkspaceInitializationPayload, environmentService: IWorkbenchEnvironmentService, fileService: IFileService, logService: ILogService): Promise<BrowserStorageService> {
		const storageService = new BrowserStorageService(environmentService, fileService);

		try {
			await storageService.initialize(payload);

			return storageService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return storageService;
		}
	}

	private async createWorkspaceService(payload: IWorkspaceInitializationPayload, environmentService: IWorkbenchEnvironmentService, fileService: FileService, remoteAgentService: IRemoteAgentService, logService: ILogService): Promise<WorkspaceService> {
		const workspaceService = new WorkspaceService({ remoteAuthority: this.configuration.remoteAuthority, configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService);

		try {
			await workspaceService.initialize(payload);

			return workspaceService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return workspaceService;
		}
	}

	private async resolveWorkspaceInitializationPayload(resourceIdentityService: IResourceIdentityService): Promise<IWorkspaceInitializationPayload> {
		let workspace: IWorkspace | undefined = undefined;
		if (this.configuration.workspaceProvider) {
			workspace = this.configuration.workspaceProvider.workspace;
		}

		// Multi-root workspace
		if (workspace && isWorkspaceToOpen(workspace)) {
			return getWorkspaceIdentifier(workspace.workspaceUri);
		}

		// Single-folder workspace
		if (workspace && isFolderToOpen(workspace)) {
			const id = await resourceIdentityService.resolveResourceIdentity(workspace.folderUri);
			return { id, folder: workspace.folderUri };
		}

		return { id: 'empty-window' };
	}

	private getRemoteUserDataUri(): URI | undefined {
		const element = document.getElementById('vscode-remote-user-data-uri');
		if (element) {
			const remoteUserDataPath = element.getAttribute('data-settings');
			if (remoteUserDataPath) {
				return joinPath(URI.revive(JSON.parse(remoteUserDataPath)), 'User');
			}
		}

		return undefined;
	}

	private getCookieValue(name: string): string | undefined {
		const match = document.cookie.match('(^|[^;]+)\\s*' + name + '\\s*=\\s*([^;]+)'); // See https://stackoverflow.com/a/25490531

		return match ? match.pop() : undefined;
	}
}

export function main(domElement: HTMLElement, options: IWorkbenchConstructionOptions): Promise<IWorkbench> {
	const workbench = new BrowserMain(domElement, options);

	return workbench.open();
}
