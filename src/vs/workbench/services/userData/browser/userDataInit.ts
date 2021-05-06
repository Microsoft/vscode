/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { AbstractExtensionsInitializer, getExtensionStorageState, IExtensionsInitializerPreviewResult, storeExtensionStorageState } from 'vs/platform/userDataSync/common/extensionsSync';
import { GlobalStateInitializer, UserDataSyncStoreTypeSynchronizer } from 'vs/platform/userDataSync/common/globalStateSync';
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
import { IRemoteUserData, IUserData, IUserDataInitializer, IUserDataSyncLogService, IUserDataSyncStoreClient, IUserDataSyncStoreManagementService, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { AuthenticationSessionInfo, getCurrentAuthenticationSessionInfo } from 'vs/workbench/services/authentication/browser/authenticationService';
import { getSyncAreaLabel } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';
import { Barrier, Promises } from 'vs/base/common/async';
import { IExtensionGalleryService, IExtensionManagementService, IGlobalExtensionEnablementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IExtensionService, toExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { mark } from 'vs/base/common/performance';
import { IIgnoredExtensionsManagementService } from 'vs/platform/userDataSync/common/ignoredExtensions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { isEqual } from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';

export const IUserDataInitializationService = createDecorator<IUserDataInitializationService>('IUserDataInitializationService');
export interface IUserDataInitializationService {
	_serviceBrand: any;

	requiresInitialization(): Promise<boolean>;
	whenInitializationFinished(): Promise<void>;
	initializeRequiredResources(): Promise<void>;
	initializeInstalledExtensions(instantiationService: IInstantiationService): Promise<void>;
	initializeOtherResources(instantiationService: IInstantiationService): Promise<void>;
}

export class UserDataInitializationService implements IUserDataInitializationService {

	_serviceBrand: any;

	private readonly initialized: SyncResource[] = [];
	private readonly initializationFinished = new Barrier();
	private globalStateUserData: IUserData | null = null;

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

				if (!this.storageService.isNew(StorageScope.GLOBAL)) {
					this.logService.trace(`Skipping initializing user data as application was opened before`);
					return;
				}

				if (!this.storageService.isNew(StorageScope.WORKSPACE)) {
					this.logService.trace(`Skipping initializing user data as workspace was opened before`);
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

				await this.initializeUserDataSyncStore(authenticationSession);

				const userDataSyncStore = this.userDataSyncStoreManagementService.userDataSyncStore;
				if (!userDataSyncStore) {
					this.logService.trace(`Skipping initializing user data as sync service is not provided`);
					return;
				}

				this.logService.info(`Using settings sync service ${userDataSyncStore.url.toString()} for initialization`);
				const userDataSyncStoreClient = new UserDataSyncStoreClient(userDataSyncStore.url, this.productService, this.requestService, this.logService, this.environmentService, this.fileService, this.storageService);
				userDataSyncStoreClient.setAuthToken(authenticationSession.accessToken, authenticationSession.providerId);
				return userDataSyncStoreClient;
			})();
		}

		return this._userDataSyncStoreClientPromise;
	}

	private async initializeUserDataSyncStore(authenticationSession: AuthenticationSessionInfo): Promise<void> {
		const userDataSyncStore = this.userDataSyncStoreManagementService.userDataSyncStore;
		if (!userDataSyncStore?.canSwitch) {
			return;
		}

		const disposables = new DisposableStore();
		try {
			const userDataSyncStoreClient = disposables.add(new UserDataSyncStoreClient(userDataSyncStore.url, this.productService, this.requestService, this.logService, this.environmentService, this.fileService, this.storageService));
			userDataSyncStoreClient.setAuthToken(authenticationSession.accessToken, authenticationSession.providerId);

			// Cache global state data for global state initialization
			this.globalStateUserData = await userDataSyncStoreClient.read(SyncResource.GlobalState, null);

			if (this.globalStateUserData) {
				const userDataSyncStoreType = new UserDataSyncStoreTypeSynchronizer(userDataSyncStoreClient, this.storageService, this.environmentService, this.fileService, this.logService).getSyncStoreType(this.globalStateUserData);
				if (userDataSyncStoreType) {
					await this.userDataSyncStoreManagementService.switch(userDataSyncStoreType);

					// Unset cached global state data if urls are changed
					if (!isEqual(userDataSyncStore.url, this.userDataSyncStoreManagementService.userDataSyncStore?.url)) {
						this.logService.info('Switched settings sync store');
						this.globalStateUserData = null;
					}
				}
			}
		} finally {
			disposables.dispose();
		}
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
			await Promises.allSettled([this.initialize([SyncResource.Keybindings, SyncResource.Snippets]), this.initializeExtensions(instantiationService)]);
		} finally {
			this.initializationFinished.open();
		}
	}

	private async initializeExtensions(instantiationService: IInstantiationService): Promise<void> {
		try {
			await Promise.all([this.initializeInstalledExtensions(instantiationService), this.initializeNewExtensions(instantiationService)]);
		} finally {
			this.initialized.push(SyncResource.Extensions);
		}
	}

	private initializeInstalledExtensionsPromise: Promise<void> | undefined;
	async initializeInstalledExtensions(instantiationService: IInstantiationService): Promise<void> {
		if (!this.initializeInstalledExtensionsPromise) {
			this.initializeInstalledExtensionsPromise = (async () => {
				this.logService.trace(`UserDataInitializationService#initializeInstalledExtensions`);
				const extensionsPreviewInitializer = await this.getExtensionsPreviewInitializer(instantiationService);
				if (extensionsPreviewInitializer) {
					await instantiationService.createInstance(InstalledExtensionsInitializer, extensionsPreviewInitializer).initialize();
				}
			})();
		}
		return this.initializeInstalledExtensionsPromise;
	}

	private initializeNewExtensionsPromise: Promise<void> | undefined;
	private async initializeNewExtensions(instantiationService: IInstantiationService): Promise<void> {
		if (!this.initializeNewExtensionsPromise) {
			this.initializeNewExtensionsPromise = (async () => {
				this.logService.trace(`UserDataInitializationService#initializeNewExtensions`);
				const extensionsPreviewInitializer = await this.getExtensionsPreviewInitializer(instantiationService);
				if (extensionsPreviewInitializer) {
					await instantiationService.createInstance(NewExtensionsInitializer, extensionsPreviewInitializer).initialize();
				}
			})();
		}
		return this.initializeNewExtensionsPromise;
	}

	private extensionsPreviewInitializerPromise: Promise<ExtensionsPreviewInitializer | null> | undefined;
	private getExtensionsPreviewInitializer(instantiationService: IInstantiationService): Promise<ExtensionsPreviewInitializer | null> {
		if (!this.extensionsPreviewInitializerPromise) {
			this.extensionsPreviewInitializerPromise = (async () => {
				const userDataSyncStoreClient = await this.createUserDataSyncStoreClient();
				if (!userDataSyncStoreClient) {
					return null;
				}
				const userData = await userDataSyncStoreClient.read(SyncResource.Extensions, null);
				return instantiationService.createInstance(ExtensionsPreviewInitializer, userData);
			})();
		}
		return this.extensionsPreviewInitializerPromise;
	}

	private async initialize(syncResources: SyncResource[]): Promise<void> {
		const userDataSyncStoreClient = await this.createUserDataSyncStoreClient();
		if (!userDataSyncStoreClient) {
			return;
		}

		await Promises.settled(syncResources.map(async syncResource => {
			try {
				if (this.initialized.includes(syncResource)) {
					this.logService.info(`${getSyncAreaLabel(syncResource)} initialized already.`);
					return;
				}
				this.initialized.push(syncResource);
				this.logService.trace(`Initializing ${getSyncAreaLabel(syncResource)}`);
				const initializer = this.createSyncResourceInitializer(syncResource);
				const userData = await userDataSyncStoreClient.read(syncResource, syncResource === SyncResource.GlobalState ? this.globalStateUserData : null);
				await initializer.initialize(userData);
				this.logService.info(`Initialized ${getSyncAreaLabel(syncResource)}`);
			} catch (error) {
				this.logService.info(`Error while initializing ${getSyncAreaLabel(syncResource)}`);
				this.logService.error(error);
			}
		}));
	}

	private createSyncResourceInitializer(syncResource: SyncResource): IUserDataInitializer {
		switch (syncResource) {
			case SyncResource.Settings: return new SettingsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.Keybindings: return new KeybindingsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.Snippets: return new SnippetsInitializer(this.fileService, this.environmentService, this.logService);
			case SyncResource.GlobalState: return new GlobalStateInitializer(this.storageService, this.fileService, this.environmentService, this.logService);
		}
		throw new Error(`Cannot create initializer for ${syncResource}`);
	}

}

class ExtensionsPreviewInitializer extends AbstractExtensionsInitializer {

	private previewPromise: Promise<IExtensionsInitializerPreviewResult | null> | undefined;
	private preview: IExtensionsInitializerPreviewResult | null = null;

	constructor(
		private readonly extensionsData: IUserData,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@IIgnoredExtensionsManagementService ignoredExtensionsManagementService: IIgnoredExtensionsManagementService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
	) {
		super(extensionManagementService, ignoredExtensionsManagementService, fileService, environmentService, logService);
	}

	getPreview(): Promise<IExtensionsInitializerPreviewResult | null> {
		if (!this.previewPromise) {
			this.previewPromise = super.initialize(this.extensionsData).then(() => this.preview);
		}
		return this.previewPromise;
	}

	override initialize(): Promise<void> {
		throw new Error('should not be called directly');
	}

	protected override async doInitialize(remoteUserData: IRemoteUserData): Promise<void> {
		const remoteExtensions = await this.parseExtensions(remoteUserData);
		if (!remoteExtensions) {
			this.logService.info('Skipping initializing extensions because remote extensions does not exist.');
			return;
		}
		const installedExtensions = await this.extensionManagementService.getInstalled();
		this.preview = this.generatePreview(remoteExtensions, installedExtensions);
	}
}

class InstalledExtensionsInitializer implements IUserDataInitializer {

	constructor(
		private readonly extensionsPreviewInitializer: ExtensionsPreviewInitializer,
		@IGlobalExtensionEnablementService private readonly extensionEnablementService: IGlobalExtensionEnablementService,
		@IStorageService private readonly storageService: IStorageService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
	) {
	}

	async initialize(): Promise<void> {
		const preview = await this.extensionsPreviewInitializer.getPreview();
		if (!preview) {
			return;
		}

		// 1. Initialise already installed extensions state
		for (const installedExtension of preview.installedExtensions) {
			const syncExtension = preview.remoteExtensions.find(({ identifier }) => areSameExtensions(identifier, installedExtension.identifier));
			if (syncExtension?.state) {
				const extensionState = getExtensionStorageState(installedExtension.manifest.publisher, installedExtension.manifest.name, this.storageService);
				Object.keys(syncExtension.state).forEach(key => extensionState[key] = syncExtension.state![key]);
				storeExtensionStorageState(installedExtension.manifest.publisher, installedExtension.manifest.name, extensionState, this.storageService);
			}
		}

		// 2. Initialise extensions enablement
		if (preview.disabledExtensions.length) {
			for (const identifier of preview.disabledExtensions) {
				this.logService.trace(`Disabling extension...`, identifier.id);
				await this.extensionEnablementService.disableExtension(identifier);
				this.logService.info(`Disabling extension`, identifier.id);
			}
		}
	}
}

class NewExtensionsInitializer implements IUserDataInitializer {

	constructor(
		private readonly extensionsPreviewInitializer: ExtensionsPreviewInitializer,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
	) {
	}

	async initialize(): Promise<void> {
		const preview = await this.extensionsPreviewInitializer.getPreview();
		if (!preview) {
			return;
		}

		const newlyEnabledExtensions: ILocalExtension[] = [];
		const uuids: string[] = [], names: string[] = [];
		for (const { uuid, id } of preview.newExtensions) {
			if (uuid) {
				uuids.push(uuid);
			} else {
				names.push(id);
			}
		}
		const galleryExtensions = (await this.galleryService.query({ ids: uuids, names: names, pageSize: uuids.length + names.length }, CancellationToken.None)).firstPage;
		for (const galleryExtension of galleryExtensions) {
			try {
				const extensionToSync = preview.remoteExtensions.find(({ identifier }) => areSameExtensions(identifier, galleryExtension.identifier));
				if (!extensionToSync) {
					continue;
				}
				if (extensionToSync.state) {
					storeExtensionStorageState(galleryExtension.publisher, galleryExtension.name, extensionToSync.state, this.storageService);
				}
				this.logService.trace(`Installing extension...`, galleryExtension.identifier.id);
				const local = await this.extensionManagementService.installFromGallery(galleryExtension, { isMachineScoped: false } /* pass options to prevent install and sync dialog in web */);
				if (!preview.disabledExtensions.some(identifier => areSameExtensions(identifier, galleryExtension.identifier))) {
					newlyEnabledExtensions.push(local);
				}
				this.logService.info(`Installed extension.`, galleryExtension.identifier.id);
			} catch (error) {
				this.logService.error(error);
			}
		}

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
	}

	private async areExtensionsRunning(extensions: ILocalExtension[]): Promise<boolean> {
		const runningExtensions = await this.extensionService.getExtensions();
		return extensions.every(e => runningExtensions.some(r => areSameExtensions({ id: r.identifier.value }, e.identifier)));
	}
}

class InitializeOtherResourcesContribution implements IWorkbenchContribution {
	constructor(
		@IUserDataInitializationService userDataInitializeService: IUserDataInitializationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IExtensionService extensionService: IExtensionService
	) {
		extensionService.whenInstalledExtensionsRegistered().then(() => this.initializeOtherResource(userDataInitializeService, instantiationService));
	}

	private async initializeOtherResource(userDataInitializeService: IUserDataInitializationService, instantiationService: IInstantiationService): Promise<void> {
		if (await userDataInitializeService.requiresInitialization()) {
			mark('code/willInitOtherUserData');
			await userDataInitializeService.initializeOtherResources(instantiationService);
			mark('code/didInitOtherUserData');
		}
	}
}

if (isWeb) {
	const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench);
	workbenchRegistry.registerWorkbenchContribution(InitializeOtherResourcesContribution, LifecyclePhase.Restored);
}
