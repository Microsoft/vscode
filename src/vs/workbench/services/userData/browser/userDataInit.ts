/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ExtensionsInitializer } from 'vs/platform/userDataSync/common/extensionsSync';
import { GlobalStateInitializer } from 'vs/platform/userDataSync/common/globalStateSync';
import { KeybindingsInitializer } from 'vs/platform/userDataSync/common/keybindingsSync';
import { SettingsInitializer } from 'vs/platform/userDataSync/common/settingsSync';
import { SnippetsInitializer } from 'vs/platform/userDataSync/common/snippetsSync';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IFileService } from 'vs/platform/files/common/files';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { UserDataSyncStoreClient } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IRequestService } from 'vs/platform/request/common/request';
import { ISyncExtension, IUserDataInitializer, IUserDataSyncLogService, IUserDataSyncStoreClient, IUserDataSyncStoreManagementService, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { getCurrentAuthenticationSessionInfo } from 'vs/workbench/services/authentication/browser/authenticationService';
import { getSyncAreaLabel } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';
import { Barrier } from 'vs/base/common/async';
import { IExtensionGalleryService, IExtensionManagementService, IGlobalExtensionEnablementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IExtensionService, toExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { mark } from 'vs/base/common/performance';

export const IUserDataInitializationService = createDecorator<IUserDataInitializationService>('IUserDataInitializationService');
export interface IUserDataInitializationService {
	_serviceBrand: any;

	requiresInitialization(): Promise<boolean>;
	whenInitializationFinished(): Promise<void>;
	initializeRequiredResources(): Promise<void>;
	initializeOtherResources(instantiationService: IInstantiationService): Promise<void>;
}

export class UserDataInitializationService implements IUserDataInitializationService {

	_serviceBrand: any;

	private readonly initialized: SyncResource[] = [];
	private readonly initializationFinished = new Barrier();

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService
	) {
		this.createUserDataSyncStoreClient().then(userDataSyncStoreClient => {
			if (!userDataSyncStoreClient) {
				this.initializationFinished.open();
			}
		});
	}

	private _userDataSyncStoreClientPromise: Promise<IUserDataSyncStoreClient | undefined> | undefined;
	private createUserDataSyncStoreClient(): Promise<IUserDataSyncStoreClient | undefined> {
		if (!this._userDataSyncStoreClientPromise) {
			this._userDataSyncStoreClientPromise = (async (): Promise<IUserDataSyncStoreClient | undefined> => {
				if (!isWeb) {
					this.logService.trace(`Skipping initializing user data in desktop`);
					return;
				}

				if (!this.environmentService.options?.enableSyncByDefault && !this.environmentService.options?.settingsSyncOptions?.enabled) {
					this.logService.trace(`Skipping initializing user data as settings sync is not enabled`);
					return;
				}

				if (!this.storageService.isNew(StorageScope.GLOBAL)) {
					this.logService.trace(`Skipping initializing user data as application was opened before`);
					return;
				}

				if (!this.storageService.isNew(StorageScope.WORKSPACE)) {
					this.logService.trace(`Skipping initializing user data as workspace was opened before`);
					return;
				}

				const userDataSyncStore = this.userDataSyncStoreManagementService.userDataSyncStore;
				if (!userDataSyncStore) {
					this.logService.trace(`Skipping initializing user data as sync service is not provided`);
					return;
				}

				if (!this.environmentService.options?.credentialsProvider) {
					this.logService.trace(`Skipping initializing user data as credentials provider is not provided`);
					return;
				}

				let authenticationSession;
				try {
					authenticationSession = await getCurrentAuthenticationSessionInfo(this.environmentService, this.productService);
				} catch (error) {
					this.logService.error(error);
				}
				if (!authenticationSession) {
					this.logService.trace(`Skipping initializing user data as authentication session is not set`);
					return;
				}

				const userDataSyncStoreClient = new UserDataSyncStoreClient(userDataSyncStore.url, this.productService, this.requestService, this.logService, this.environmentService, this.fileService, this.storageService);
				userDataSyncStoreClient.setAuthToken(authenticationSession.accessToken, authenticationSession.providerId);
				return userDataSyncStoreClient;
			})();
		}

		return this._userDataSyncStoreClientPromise;
	}

	async whenInitializationFinished(): Promise<void> {
		await this.initializationFinished.wait();
	}

	async requiresInitialization(): Promise<boolean> {
		this.logService.trace(`UserDataInitializationService#requiresInitialization`);
		const userDataSyncStoreClient = await this.createUserDataSyncStoreClient();
		return !!userDataSyncStoreClient;
	}

	async initializeRequiredResources(): Promise<void> {
		this.logService.trace(`UserDataInitializationService#initializeRequiredResources`);
		return this.initialize([SyncResource.Settings, SyncResource.GlobalState]);
	}

	async initializeOtherResources(instantiationService: IInstantiationService): Promise<void> {
		try {
			this.logService.trace(`UserDataInitializationService#initializeOtherResources`);
			await this.initialize([SyncResource.Extensions, SyncResource.Keybindings, SyncResource.Snippets], instantiationService);
		} finally {
			this.initializationFinished.open();
		}
	}

	private async initialize(syncResources: SyncResource[], instantiationService?: IInstantiationService): Promise<void> {
		const userDataSyncStoreClient = await this.createUserDataSyncStoreClient();
		if (!userDataSyncStoreClient) {
			return;
		}

		await Promise.all(syncResources.map(async syncResource => {
			try {
				if (this.initialized.includes(syncResource)) {
					this.logService.info(`${getSyncAreaLabel(syncResource)} initialized already.`);
					return;
				}
				this.initialized.push(syncResource);
				this.logService.trace(`Initializing ${getSyncAreaLabel(syncResource)}`);
				const initializer = this.createSyncResourceInitializer(syncResource, instantiationService);
				const userData = await userDataSyncStoreClient.read(syncResource, null);
				await initializer.initialize(userData);
				this.logService.info(`Initialized ${getSyncAreaLabel(syncResource)}`);
			} catch (error) {
				this.logService.info(`Error while initializing ${getSyncAreaLabel(syncResource)}`);
				this.logService.error(error);
			}
		}));
	}

	private createSyncResourceInitializer(syncResource: SyncResource, instantiationService?: IInstantiationService): IUserDataInitializer {
		switch (syncResource) {
			case SyncResource.Settings: return new SettingsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.Keybindings: return new KeybindingsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.Snippets: return new SnippetsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.GlobalState: return new GlobalStateInitializer(this.storageService, this.fileService, this.environmentService, this.logService);
			case SyncResource.Extensions:
				if (!instantiationService) {
					throw new Error('Instantiation Service is required to initialize extension');
				}
				return instantiationService.createInstance(WorkbenchExtensionsInitializer);
		}
	}

}

class WorkbenchExtensionsInitializer extends ExtensionsInitializer {

	constructor(
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@IExtensionGalleryService galleryService: IExtensionGalleryService,
		@IGlobalExtensionEnablementService extensionEnablementService: IGlobalExtensionEnablementService,
		@IStorageService storageService: IStorageService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
	) {
		super(extensionManagementService, galleryService, extensionEnablementService, storageService, fileService, environmentService, logService);
	}

	protected async initializeRemoteExtensions(remoteExtensions: ISyncExtension[]): Promise<ILocalExtension[]> {
		const newlyEnabledExtensions = (await super.initializeRemoteExtensions(remoteExtensions));
		const canEnabledExtensions = newlyEnabledExtensions.filter(e => this.extensionService.canAddExtension(toExtensionDescription(e)));
		if (!(await this.areExtensionsRunning(canEnabledExtensions))) {
			await new Promise<void>((c, e) => {
				const disposable = this.extensionService.onDidChangeExtensions(async () => {
					try {
						if (await this.areExtensionsRunning(canEnabledExtensions)) {
							disposable.dispose();
							c();
						}
					} catch (error) {
						e(error);
					}
				});
			});
		}
		return newlyEnabledExtensions;
	}

	private async areExtensionsRunning(extensions: ILocalExtension[]): Promise<boolean> {
		const runningExtensions = await this.extensionService.getExtensions();
		return extensions.every(e => runningExtensions.some(r => areSameExtensions({ id: r.identifier.value }, e.identifier)));
	}
}

class InitializeOtherResourcesContribution implements IWorkbenchContribution {
	constructor(
		@IUserDataInitializationService userDataInitializeService: IUserDataInitializationService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this.initializeOtherResource(userDataInitializeService, instantiationService);
	}

	private async initializeOtherResource(userDataInitializeService: IUserDataInitializationService, instantiationService: IInstantiationService): Promise<void> {
		if (await userDataInitializeService.requiresInitialization()) {
			mark('willInitOtherUserData');
			await userDataInitializeService.initializeOtherResources(instantiationService);
			mark('didInitOtherUserData');
		}
	}
}

if (isWeb) {
	const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench);
	workbenchRegistry.registerWorkbenchContribution(InitializeOtherResourcesContribution, LifecyclePhase.Restored);
}
