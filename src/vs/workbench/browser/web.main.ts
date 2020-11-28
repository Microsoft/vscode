/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mark } from 'vs/base/common/performance';
import { hash } from 'vs/base/common/hash';
import { domContentLoaded, addDisposableListener, EventType, EventHelper, detectFullscreen, addDisposableThrottledListener } from 'vs/base/browser/dom';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILogService, ConsoleLogService, MultiplexLogService, getLogLevel } from 'vs/platform/log/common/log';
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
import { setFullscreen } from 'vs/base/browser/browser';
import { isIOS, isMacintosh } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ConfigurationCache } from 'vs/workbench/services/configuration/browser/configurationCache';
import { ISignService } from 'vs/platform/sign/common/sign';
import { SignService } from 'vs/platform/sign/browser/signService';
import type { IWorkbenchConstructionOptions, IWorkspace, IWorkbench } from 'vs/workbench/workbench.web.api';
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
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IIndexedDBFileSystemProvider, IndexedDB, INDEXEDDB_LOGS_OBJECT_STORE, INDEXEDDB_USERDATA_OBJECT_STORE } from 'vs/platform/files/browser/indexedDBFileSystemProvider';
import { BrowserRequestService } from 'vs/workbench/services/request/browser/requestService';
import { IRequestService } from 'vs/platform/request/common/request';
import { IUserDataInitializationService, UserDataInitializationService } from 'vs/workbench/services/userData/browser/userDataInit';
import { UserDataSyncStoreManagementService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { IUserDataSyncStoreManagementService } from 'vs/platform/userDataSync/common/userDataSync';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { localize } from 'vs/nls';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';

class BrowserMain extends Disposable {

	constructor(
		private readonly domElement: HTMLElement,
		private readonly configuration: IWorkbenchConstructionOptions
	) {
		super();

		this.init();
	}

	private init(): void {

		// Browser config
		setFullscreen(!!detectFullscreen());
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
		this.registerListeners(workbench, services.storageService, services.logService);

		// Driver
		if (this.configuration.driver) {
			(async () => this._register(await registerWindowDriver()))();
		}

		// Startup
		const instantiationService = workbench.startup();

		// Return API Facade
		return instantiationService.invokeFunction(accessor => {
			const commandService = accessor.get(ICommandService);
			const lifecycleService = accessor.get(ILifecycleService);

			return {
				commands: {
					executeCommand: (command, ...args) => commandService.executeCommand(command, ...args)
				},
				shutdown: () => lifecycleService.shutdown()
			};
		});
	}

	private registerListeners(workbench: Workbench, storageService: BrowserStorageService, logService: ILogService): void {

		// Layout
		const viewport = isIOS && window.visualViewport ? window.visualViewport /** Visual viewport */ : window /** Layout viewport */;
		this._register(addDisposableListener(viewport, EventType.RESIZE, () => {
			logService.trace(`web.main#${isIOS && window.visualViewport ? 'visualViewport' : 'window'}Resize`);
			workbench.layout();
		}));

		// Prevent the back/forward gestures in macOS
		this._register(addDisposableListener(this.domElement, EventType.WHEEL, e => e.preventDefault(), { passive: false }));

		// Prevent native context menus in web
		this._register(addDisposableListener(this.domElement, EventType.CONTEXT_MENU, e => EventHelper.stop(e, true)));

		// Prevent default navigation on drop
		this._register(addDisposableListener(this.domElement, EventType.DROP, e => EventHelper.stop(e, true)));

		// Workbench Lifecycle
		this._register(workbench.onBeforeShutdown(event => {
			if (storageService.hasPendingUpdate) {
				logService.warn('Unload veto: pending storage update');
				event.veto(true); // prevent data loss from pending storage update
			}
		}));
		this._register(workbench.onWillShutdown(() => {
			storageService.close();
		}));
		this._register(workbench.onShutdown(() => this.dispose()));

		// Fullscreen (Browser)
		[EventType.FULLSCREEN_CHANGE, EventType.WK_FULLSCREEN_CHANGE].forEach(event => {
			this._register(addDisposableListener(document, event, () => setFullscreen(!!detectFullscreen())));
		});

		// Fullscreen (Native)
		this._register(addDisposableThrottledListener(viewport, EventType.RESIZE, () => {
			setFullscreen(!!detectFullscreen());
		}, undefined, isMacintosh ? 2000 /* adjust for macOS animation */ : 800 /* can be throttled */));
	}

	private async initServices(): Promise<{ serviceCollection: ServiceCollection, configurationService: IConfigurationService, logService: ILogService, storageService: BrowserStorageService }> {
		const serviceCollection = new ServiceCollection();

		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// NOTE: DO NOT ADD ANY OTHER SERVICE INTO THE COLLECTION HERE.
		// CONTRIBUTE IT VIA WORKBENCH.WEB.MAIN.TS AND registerSingleton().
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

		const payload = await this.resolveWorkspaceInitializationPayload();

		// Product
		const productService: IProductService = { _serviceBrand: undefined, ...product, ...this.configuration.productConfiguration };
		serviceCollection.set(IProductService, productService);

		// Environment
		const logsPath = URI.file(toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '')).with({ scheme: 'vscode-log' });
		const environmentService = new BrowserWorkbenchEnvironmentService({ workspaceId: payload.id, logsPath, ...this.configuration }, productService);
		serviceCollection.set(IWorkbenchEnvironmentService, environmentService);

		// Log
		const logService = new BufferLogService(getLogLevel(environmentService));
		serviceCollection.set(ILogService, logService);

		const connectionToken = environmentService.options.connectionToken || this.getCookieValue('vscode-tkn');

		// Remote
		const remoteAuthorityResolverService = new RemoteAuthorityResolverService(connectionToken, this.configuration.resourceUriProvider);
		serviceCollection.set(IRemoteAuthorityResolverService, remoteAuthorityResolverService);

		// Signing
		const signService = new SignService(connectionToken);
		serviceCollection.set(ISignService, signService);

		// Remote Agent
		const remoteAgentService = this._register(new RemoteAgentService(this.configuration.webSocketFactory, environmentService, productService, remoteAuthorityResolverService, signService, logService));
		serviceCollection.set(IRemoteAgentService, remoteAgentService);

		// Files
		const fileService = this._register(new FileService(logService));
		serviceCollection.set(IFileService, fileService);
		await this.registerFileSystemProviders(environmentService, fileService, remoteAgentService, logService, logsPath);

		// IURIIdentityService
		const uriIdentityService = new UriIdentityService(fileService);
		serviceCollection.set(IUriIdentityService, uriIdentityService);

		// Long running services (workspace, config, storage)
		const [configurationService, storageService] = await Promise.all([
			this.createWorkspaceService(payload, environmentService, fileService, remoteAgentService, uriIdentityService, logService).then(service => {

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

		// Request Service
		const requestService = new BrowserRequestService(remoteAgentService, configurationService, logService);
		serviceCollection.set(IRequestService, requestService);

		// Userdata Sync Store Management Service
		const userDataSyncStoreManagementService = new UserDataSyncStoreManagementService(productService, configurationService, storageService);
		serviceCollection.set(IUserDataSyncStoreManagementService, userDataSyncStoreManagementService);

		// Userdata Initialize Service
		const userDataInitializationService = new UserDataInitializationService(environmentService, userDataSyncStoreManagementService, fileService, storageService, productService, requestService, logService);
		serviceCollection.set(IUserDataInitializationService, userDataInitializationService);

		if (await userDataInitializationService.requiresInitialization()) {
			mark('willInitRequiredUserData');
			// Initialize required resources - settings & global state
			await userDataInitializationService.initializeRequiredResources();

			// Important: Reload only local user configuration after initializing
			// Reloading complete configuraiton blocks workbench until remote configuration is loaded.
			await configurationService.reloadLocalUserConfiguration();
			mark('didInitRequiredUserData');
		}

		return { serviceCollection, configurationService, logService, storageService };
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
		}

		// User data
		let indexedDBUserDataProvider: IIndexedDBFileSystemProvider | null = null;
		try {
			indexedDBUserDataProvider = await indexedDB.createFileSystemProvider(Schemas.userData, INDEXEDDB_USERDATA_OBJECT_STORE);
		} catch (error) {
			console.error(error);
		}

		if (indexedDBUserDataProvider) {
			registerAction2(class ResetUserDataAction extends Action2 {
				constructor() {
					super({
						id: 'workbench.action.resetUserData',
						title: { original: 'Reset User Data', value: localize('reset', "Reset User Data") },
						category: CATEGORIES.Developer,
						menu: {
							id: MenuId.CommandPalette
						}
					});
				}
				async run(accessor: ServicesAccessor): Promise<void> {
					const dialogService = accessor.get(IDialogService);
					const hostService = accessor.get(IHostService);
					const result = await dialogService.confirm({
						message: localize('reset user data message', "Would you like to reset your data (settings, keybindings, extensions, snippets and UI State) and reload?")
					});
					if (result.confirmed) {
						await indexedDBUserDataProvider!.reset();
					}
					hostService.reload();
				}
			});
		}

		fileService.registerProvider(Schemas.userData, indexedDBUserDataProvider || new InMemoryFileSystemProvider());
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

	private async createWorkspaceService(payload: IWorkspaceInitializationPayload, environmentService: IWorkbenchEnvironmentService, fileService: FileService, remoteAgentService: IRemoteAgentService, uriIdentityService: IUriIdentityService, logService: ILogService): Promise<WorkspaceService> {
		const workspaceService = new WorkspaceService({ remoteAuthority: this.configuration.remoteAuthority, configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, uriIdentityService, logService);

		try {
			await workspaceService.initialize(payload);

			return workspaceService;
		} catch (error) {
			onUnexpectedError(error);
			logService.error(error);

			return workspaceService;
		}
	}

	private async resolveWorkspaceInitializationPayload(): Promise<IWorkspaceInitializationPayload> {
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
			const id = hash(workspace.folderUri.toString()).toString(16);
			return { id, folder: workspace.folderUri };
		}

		return { id: 'empty-window' };
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
