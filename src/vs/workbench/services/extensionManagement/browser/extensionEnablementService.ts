/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IExtensionManagementService, DidUninstallExtensionEvent, IExtensionIdentifier, IGlobalExtensionEnablementService, ENABLED_EXTENSIONS_STORAGE_PATH, DISABLED_EXTENSIONS_STORAGE_PATH } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtension, isAuthenticaionProviderExtension, isLanguagePackExtension } from 'vs/platform/extensions/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { getExtensionKind } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IProductService } from 'vs/platform/product/common/productService';
import { StorageManager } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { webWorkerExtHostConfig } from 'vs/workbench/services/extensions/common/extensions';
import { IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IExtensionBisectService } from 'vs/workbench/services/extensionManagement/browser/extensionBisect';

const SOURCE = 'IWorkbenchExtensionEnablementService';

export class ExtensionEnablementService extends Disposable implements IWorkbenchExtensionEnablementService {

	declare readonly _serviceBrand: undefined;

	private readonly _onEnablementChanged = new Emitter<readonly IExtension[]>();
	public readonly onEnablementChanged: Event<readonly IExtension[]> = this._onEnablementChanged.event;

	private readonly storageManger: StorageManager;

	constructor(
		@IStorageService storageService: IStorageService,
		@IGlobalExtensionEnablementService protected readonly globalExtensionEnablementService: IGlobalExtensionEnablementService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IProductService private readonly productService: IProductService,
		@IUserDataAutoSyncEnablementService private readonly userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
		@IUserDataSyncAccountService private readonly userDataSyncAccountService: IUserDataSyncAccountService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@INotificationService private readonly notificationService: INotificationService,
		@IHostService hostService: IHostService,
		@IExtensionBisectService private readonly extensionBisectService: IExtensionBisectService,
	) {
		super();
		this.storageManger = this._register(new StorageManager(storageService));
		this._register(this.globalExtensionEnablementService.onDidChangeEnablement(({ extensions, source }) => this.onDidChangeExtensions(extensions, source)));
		this._register(extensionManagementService.onDidUninstallExtension(this._onDidUninstallExtension, this));

		// delay notification for extensions disabled until workbench restored
		if (this.allUserExtensionsDisabled) {
			this.lifecycleService.when(LifecyclePhase.Restored).then(() => {
				this.notificationService.prompt(Severity.Info, localize('extensionsDisabled', "All installed extensions are temporarily disabled."), [{
					label: localize('Reload', "Reload and Enable Extensions"),
					run: () => hostService.reload({ disableExtensions: false })
				}]);
			});
		}
	}

	private get hasWorkspace(): boolean {
		return this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY;
	}

	private get allUserExtensionsDisabled(): boolean {
		return this.environmentService.disableExtensions === true;
	}

	getEnablementState(extension: IExtension): EnablementState {
		if (this.extensionBisectService.isDisabledByBisect(extension)) {
			return EnablementState.DisabledByEnvironemt;
		}
		if (this._isDisabledInEnv(extension)) {
			return EnablementState.DisabledByEnvironemt;
		}
		if (this._isDisabledByExtensionKind(extension)) {
			return EnablementState.DisabledByExtensionKind;
		}
		return this._getEnablementState(extension.identifier);
	}

	canChangeEnablement(extension: IExtension): boolean {
		try {
			this.throwErrorIfCannotChangeEnablement(extension);
		} catch (error) {
			return false;
		}
		const enablementState = this.getEnablementState(extension);
		if (enablementState === EnablementState.DisabledByEnvironemt || enablementState === EnablementState.DisabledByExtensionKind) {
			return false;
		}
		return true;
	}

	private throwErrorIfCannotChangeEnablement(extension: IExtension): void {
		if (isLanguagePackExtension(extension.manifest)) {
			throw new Error(localize('cannot disable language pack extension', "Cannot change enablement of {0} extension because it contributes language packs.", extension.manifest.displayName || extension.identifier.id));
		}

		if (this.userDataAutoSyncEnablementService.isEnabled() && this.userDataSyncAccountService.account &&
			isAuthenticaionProviderExtension(extension.manifest) && extension.manifest.contributes!.authentication!.some(a => a.id === this.userDataSyncAccountService.account!.authenticationProviderId)) {
			throw new Error(localize('cannot disable auth extension', "Cannot change enablement {0} extension because Settings Sync depends on it.", extension.manifest.displayName || extension.identifier.id));
		}
	}

	canChangeWorkspaceEnablement(extension: IExtension): boolean {
		if (!this.canChangeEnablement(extension)) {
			return false;
		}
		try {
			this.throwErrorIfCannotChangeWorkspaceEnablement(extension);
		} catch (error) {
			return false;
		}
		return true;
	}

	private throwErrorIfCannotChangeWorkspaceEnablement(extension: IExtension): void {
		if (!this.hasWorkspace) {
			throw new Error(localize('noWorkspace', "No workspace."));
		}
		if (isAuthenticaionProviderExtension(extension.manifest)) {
			throw new Error(localize('cannot disable auth extension in workspace', "Cannot change enablement of {0} extension in workspace because it contributes authentication providers", extension.manifest.displayName || extension.identifier.id));
		}
	}

	async setEnablement(extensions: IExtension[], newState: EnablementState): Promise<boolean[]> {

		const workspace = newState === EnablementState.DisabledWorkspace || newState === EnablementState.EnabledWorkspace;
		for (const extension of extensions) {
			if (workspace) {
				this.throwErrorIfCannotChangeWorkspaceEnablement(extension);
			} else {
				this.throwErrorIfCannotChangeEnablement(extension);
			}
		}

		const result = await Promise.all(extensions.map(e => this._setEnablement(e, newState)));
		const changedExtensions = extensions.filter((e, index) => result[index]);
		if (changedExtensions.length) {
			this._onEnablementChanged.fire(changedExtensions);
		}
		return result;
	}

	private _setEnablement(extension: IExtension, newState: EnablementState): Promise<boolean> {

		const currentState = this._getEnablementState(extension.identifier);

		if (currentState === newState) {
			return Promise.resolve(false);
		}

		switch (newState) {
			case EnablementState.EnabledGlobally:
				this._enableExtension(extension.identifier);
				break;
			case EnablementState.DisabledGlobally:
				this._disableExtension(extension.identifier);
				break;
			case EnablementState.EnabledWorkspace:
				this._enableExtensionInWorkspace(extension.identifier);
				break;
			case EnablementState.DisabledWorkspace:
				this._disableExtensionInWorkspace(extension.identifier);
				break;
		}

		return Promise.resolve(true);
	}

	isEnabled(extension: IExtension): boolean {
		const enablementState = this.getEnablementState(extension);
		return enablementState === EnablementState.EnabledWorkspace || enablementState === EnablementState.EnabledGlobally;
	}

	isDisabledGlobally(extension: IExtension): boolean {
		return this._isDisabledGlobally(extension.identifier);
	}

	private _isDisabledInEnv(extension: IExtension): boolean {
		if (this.allUserExtensionsDisabled) {
			return !extension.isBuiltin;
		}
		const disabledExtensions = this.environmentService.disableExtensions;
		if (Array.isArray(disabledExtensions)) {
			return disabledExtensions.some(id => areSameExtensions({ id }, extension.identifier));
		}
		return false;
	}

	private _isDisabledByExtensionKind(extension: IExtension): boolean {
		if (this.extensionManagementServerService.remoteExtensionManagementServer || this.extensionManagementServerService.webExtensionManagementServer) {
			const server = this.extensionManagementServerService.getExtensionManagementServer(extension);
			for (const extensionKind of getExtensionKind(extension.manifest, this.productService, this.configurationService)) {
				if (extensionKind === 'ui') {
					if (this.extensionManagementServerService.localExtensionManagementServer && this.extensionManagementServerService.localExtensionManagementServer === server) {
						return false;
					}
				}
				if (extensionKind === 'workspace') {
					if (server === this.extensionManagementServerService.remoteExtensionManagementServer) {
						return false;
					}
				}
				if (extensionKind === 'web') {
					const enableLocalWebWorker = this.configurationService.getValue<boolean>(webWorkerExtHostConfig);
					if (enableLocalWebWorker) {
						// Web extensions are enabled on all configurations
						return false;
					}
					if (this.extensionManagementServerService.localExtensionManagementServer === null) {
						// Web extensions run only in the web
						return false;
					}
				}
			}
			return true;
		}
		return false;
	}

	private _getEnablementState(identifier: IExtensionIdentifier): EnablementState {
		if (this.hasWorkspace) {
			if (this._getWorkspaceEnabledExtensions().filter(e => areSameExtensions(e, identifier))[0]) {
				return EnablementState.EnabledWorkspace;
			}

			if (this._getWorkspaceDisabledExtensions().filter(e => areSameExtensions(e, identifier))[0]) {
				return EnablementState.DisabledWorkspace;
			}
		}
		if (this._isDisabledGlobally(identifier)) {
			return EnablementState.DisabledGlobally;
		}
		return EnablementState.EnabledGlobally;
	}

	private _isDisabledGlobally(identifier: IExtensionIdentifier): boolean {
		return this.globalExtensionEnablementService.getDisabledExtensions().some(e => areSameExtensions(e, identifier));
	}

	private _enableExtension(identifier: IExtensionIdentifier): Promise<boolean> {
		this._removeFromWorkspaceDisabledExtensions(identifier);
		this._removeFromWorkspaceEnabledExtensions(identifier);
		return this.globalExtensionEnablementService.enableExtension(identifier, SOURCE);
	}

	private _disableExtension(identifier: IExtensionIdentifier): Promise<boolean> {
		this._removeFromWorkspaceDisabledExtensions(identifier);
		this._removeFromWorkspaceEnabledExtensions(identifier);
		return this.globalExtensionEnablementService.disableExtension(identifier, SOURCE);
	}

	private _enableExtensionInWorkspace(identifier: IExtensionIdentifier): void {
		this._removeFromWorkspaceDisabledExtensions(identifier);
		this._addToWorkspaceEnabledExtensions(identifier);
	}

	private _disableExtensionInWorkspace(identifier: IExtensionIdentifier): void {
		this._addToWorkspaceDisabledExtensions(identifier);
		this._removeFromWorkspaceEnabledExtensions(identifier);
	}

	private _addToWorkspaceDisabledExtensions(identifier: IExtensionIdentifier): Promise<boolean> {
		if (!this.hasWorkspace) {
			return Promise.resolve(false);
		}
		let disabledExtensions = this._getWorkspaceDisabledExtensions();
		if (disabledExtensions.every(e => !areSameExtensions(e, identifier))) {
			disabledExtensions.push(identifier);
			this._setDisabledExtensions(disabledExtensions);
			return Promise.resolve(true);
		}
		return Promise.resolve(false);
	}

	private async _removeFromWorkspaceDisabledExtensions(identifier: IExtensionIdentifier): Promise<boolean> {
		if (!this.hasWorkspace) {
			return false;
		}
		let disabledExtensions = this._getWorkspaceDisabledExtensions();
		for (let index = 0; index < disabledExtensions.length; index++) {
			const disabledExtension = disabledExtensions[index];
			if (areSameExtensions(disabledExtension, identifier)) {
				disabledExtensions.splice(index, 1);
				this._setDisabledExtensions(disabledExtensions);
				return true;
			}
		}
		return false;
	}

	private _addToWorkspaceEnabledExtensions(identifier: IExtensionIdentifier): boolean {
		if (!this.hasWorkspace) {
			return false;
		}
		let enabledExtensions = this._getWorkspaceEnabledExtensions();
		if (enabledExtensions.every(e => !areSameExtensions(e, identifier))) {
			enabledExtensions.push(identifier);
			this._setEnabledExtensions(enabledExtensions);
			return true;
		}
		return false;
	}

	private _removeFromWorkspaceEnabledExtensions(identifier: IExtensionIdentifier): boolean {
		if (!this.hasWorkspace) {
			return false;
		}
		let enabledExtensions = this._getWorkspaceEnabledExtensions();
		for (let index = 0; index < enabledExtensions.length; index++) {
			const disabledExtension = enabledExtensions[index];
			if (areSameExtensions(disabledExtension, identifier)) {
				enabledExtensions.splice(index, 1);
				this._setEnabledExtensions(enabledExtensions);
				return true;
			}
		}
		return false;
	}

	protected _getWorkspaceEnabledExtensions(): IExtensionIdentifier[] {
		return this._getExtensions(ENABLED_EXTENSIONS_STORAGE_PATH);
	}

	private _setEnabledExtensions(enabledExtensions: IExtensionIdentifier[]): void {
		this._setExtensions(ENABLED_EXTENSIONS_STORAGE_PATH, enabledExtensions);
	}

	protected _getWorkspaceDisabledExtensions(): IExtensionIdentifier[] {
		return this._getExtensions(DISABLED_EXTENSIONS_STORAGE_PATH);
	}

	private _setDisabledExtensions(disabledExtensions: IExtensionIdentifier[]): void {
		this._setExtensions(DISABLED_EXTENSIONS_STORAGE_PATH, disabledExtensions);
	}

	private _getExtensions(storageId: string): IExtensionIdentifier[] {
		if (!this.hasWorkspace) {
			return [];
		}
		return this.storageManger.get(storageId, StorageScope.WORKSPACE);
	}

	private _setExtensions(storageId: string, extensions: IExtensionIdentifier[]): void {
		this.storageManger.set(storageId, extensions, StorageScope.WORKSPACE);
	}

	private async onDidChangeExtensions(extensionIdentifiers: ReadonlyArray<IExtensionIdentifier>, source?: string): Promise<void> {
		if (source !== SOURCE) {
			const installedExtensions = await this.extensionManagementService.getInstalled();
			const extensions = installedExtensions.filter(installedExtension => extensionIdentifiers.some(identifier => areSameExtensions(identifier, installedExtension.identifier)));
			this._onEnablementChanged.fire(extensions);
		}
	}

	private _onDidUninstallExtension({ identifier, error }: DidUninstallExtensionEvent): void {
		if (!error) {
			this._reset(identifier);
		}
	}

	private _reset(extension: IExtensionIdentifier) {
		this._removeFromWorkspaceDisabledExtensions(extension);
		this._removeFromWorkspaceEnabledExtensions(extension);
		this.globalExtensionEnablementService.enableExtension(extension);
	}
}

registerSingleton(IWorkbenchExtensionEnablementService, ExtensionEnablementService);
