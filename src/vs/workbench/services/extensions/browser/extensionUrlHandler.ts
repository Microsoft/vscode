/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IDisposable, toDisposable, combinedDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IExtensionGalleryService, IExtensionIdentifier, IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { createDecorator, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IURLHandler, IURLService, IOpenURLOptions } from 'vs/platform/url/common/url';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContribution, Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { IsWebContext } from 'vs/platform/contextkey/common/contextkeys';
import { IExtensionUrlTrustService } from 'vs/platform/extensionManagement/common/extensionUrlTrust';

const FIVE_MINUTES = 5 * 60 * 1000;
const THIRTY_SECONDS = 30 * 1000;
const URL_TO_HANDLE = 'extensionUrlHandler.urlToHandle';
const USER_TRUSTED_EXTENSIONS_CONFIGURATION_KEY = 'extensions.confirmedUriHandlerExtensionIds';
const USER_TRUSTED_EXTENSIONS_STORAGE_KEY = 'extensionUrlHandler.confirmedExtensions';

function isExtensionId(value: string): boolean {
	return /^[a-z0-9][a-z0-9\-]*\.[a-z0-9][a-z0-9\-]*$/i.test(value);
}

class UserTrustedExtensionIdStorage {

	get extensions(): string[] {
		const userTrustedExtensionIdsJson = this.storageService.get(USER_TRUSTED_EXTENSIONS_STORAGE_KEY, StorageScope.GLOBAL, '[]');

		try {
			return JSON.parse(userTrustedExtensionIdsJson);
		} catch {
			return [];
		}
	}

	constructor(private storageService: IStorageService) { }

	has(id: string): boolean {
		return this.extensions.indexOf(id) > -1;
	}

	add(id: string): void {
		this.set([...this.extensions, id]);
	}

	set(ids: string[]): void {
		this.storageService.store(USER_TRUSTED_EXTENSIONS_STORAGE_KEY, JSON.stringify(ids), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}
}

export const IExtensionUrlHandler = createDecorator<IExtensionUrlHandler>('extensionUrlHandler');

export interface IExtensionUrlHandler {
	readonly _serviceBrand: undefined;
	registerExtensionHandler(extensionId: ExtensionIdentifier, handler: IURLHandler): void;
	unregisterExtensionHandler(extensionId: ExtensionIdentifier): void;
}

/**
 * This class handles URLs which are directed towards extensions.
 * If a URL is directed towards an inactive extension, it buffers it,
 * activates the extension and re-opens the URL once the extension registers
 * a URL handler. If the extension never registers a URL handler, the urls
 * will eventually be garbage collected.
 *
 * It also makes sure the user confirms opening URLs directed towards extensions.
 */
class ExtensionUrlHandler implements IExtensionUrlHandler, IURLHandler {

	readonly _serviceBrand: undefined;

	private extensionHandlers = new Map<string, IURLHandler>();
	private uriBuffer = new Map<string, { timestamp: number, uri: URI }[]>();
	private userTrustedExtensionsStorage: UserTrustedExtensionIdStorage;
	private disposable: IDisposable;

	constructor(
		@IURLService urlService: IURLService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IDialogService private readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IHostService private readonly hostService: IHostService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProgressService private readonly progressService: IProgressService,
		@IExtensionUrlTrustService private readonly extensionUrlTrustService: IExtensionUrlTrustService
	) {
		this.userTrustedExtensionsStorage = new UserTrustedExtensionIdStorage(storageService);

		const interval = setInterval(() => this.garbageCollect(), THIRTY_SECONDS);
		const urlToHandleValue = this.storageService.get(URL_TO_HANDLE, StorageScope.WORKSPACE);
		if (urlToHandleValue) {
			this.storageService.remove(URL_TO_HANDLE, StorageScope.WORKSPACE);
			this.handleURL(URI.revive(JSON.parse(urlToHandleValue)), { trusted: true });
		}

		this.disposable = combinedDisposable(
			urlService.registerHandler(this),
			toDisposable(() => clearInterval(interval))
		);

		const cache = ExtensionUrlBootstrapHandler.cache;
		setTimeout(() => cache.forEach(([uri, option]) => this.handleURL(uri, option)));
	}

	async handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {
		if (!isExtensionId(uri.authority)) {
			return false;
		}

		const extensionId = uri.authority;
		const wasHandlerAvailable = this.extensionHandlers.has(ExtensionIdentifier.toKey(extensionId));
		const extension = await this.extensionService.getExtension(extensionId);

		if (!extension) {
			await this.handleUnhandledURL(uri, { id: extensionId });
			return true;
		}

		const trusted = options?.trusted
			|| (options?.originalUrl ? await this.extensionUrlTrustService.isExtensionUrlTrusted(extensionId, options.originalUrl) : false)
			|| this.didUserTrustExtension(ExtensionIdentifier.toKey(extensionId));

		if (!trusted) {
			let uriString = uri.toString(false);

			if (uriString.length > 40) {
				uriString = `${uriString.substring(0, 30)}...${uriString.substring(uriString.length - 5)}`;
			}

			const result = await this.dialogService.confirm({
				message: localize('confirmUrl', "Allow an extension to open this URI?", extensionId),
				checkbox: {
					label: localize('rememberConfirmUrl', "Don't ask again for this extension."),
				},
				detail: `${extension.displayName || extension.name} (${extensionId}) wants to open a URI:\n\n${uriString}`,
				primaryButton: localize('open', "&&Open"),
				type: 'question'
			});

			if (!result.confirmed) {
				return true;
			}

			if (result.checkboxChecked) {
				this.userTrustedExtensionsStorage.add(ExtensionIdentifier.toKey(extensionId));
			}
		}

		const handler = this.extensionHandlers.get(ExtensionIdentifier.toKey(extensionId));

		if (handler) {
			if (!wasHandlerAvailable) {
				// forward it directly
				return await handler.handleURL(uri, options);
			}

			// let the ExtensionUrlHandler instance handle this
			return false;
		}

		// collect URI for eventual extension activation
		const timestamp = new Date().getTime();
		let uris = this.uriBuffer.get(ExtensionIdentifier.toKey(extensionId));

		if (!uris) {
			uris = [];
			this.uriBuffer.set(ExtensionIdentifier.toKey(extensionId), uris);
		}

		uris.push({ timestamp, uri });

		// activate the extension
		await this.extensionService.activateByEvent(`onUri:${ExtensionIdentifier.toKey(extensionId)}`);
		return true;
	}

	registerExtensionHandler(extensionId: ExtensionIdentifier, handler: IURLHandler): void {
		this.extensionHandlers.set(ExtensionIdentifier.toKey(extensionId), handler);

		const uris = this.uriBuffer.get(ExtensionIdentifier.toKey(extensionId)) || [];

		for (const { uri } of uris) {
			handler.handleURL(uri);
		}

		this.uriBuffer.delete(ExtensionIdentifier.toKey(extensionId));
	}

	unregisterExtensionHandler(extensionId: ExtensionIdentifier): void {
		this.extensionHandlers.delete(ExtensionIdentifier.toKey(extensionId));
	}

	private async handleUnhandledURL(uri: URI, extensionIdentifier: IExtensionIdentifier): Promise<void> {
		const installedExtensions = await this.extensionManagementService.getInstalled();
		const extension = installedExtensions.filter(e => areSameExtensions(e.identifier, extensionIdentifier))[0];

		// Extension is installed
		if (extension) {
			const enabled = this.extensionEnablementService.isEnabled(extension);

			// Extension is not running. Reload the window to handle.
			if (enabled) {
				const result = await this.dialogService.confirm({
					message: localize('reloadAndHandle', "Extension '{0}' is not loaded. Would you like to reload the window to load the extension and open the URL?", extension.manifest.displayName || extension.manifest.name),
					detail: `${extension.manifest.displayName || extension.manifest.name} (${extensionIdentifier.id}) wants to open a URL:\n\n${uri.toString()}`,
					primaryButton: localize('reloadAndOpen', "&&Reload Window and Open"),
					type: 'question'
				});

				if (!result.confirmed) {
					return;
				}

				await this.reloadAndHandle(uri);
			}

			// Extension is disabled. Enable the extension and reload the window to handle.
			else {
				const result = await this.dialogService.confirm({
					message: localize('enableAndHandle', "Extension '{0}' is disabled. Would you like to enable the extension and reload the window to open the URL?", extension.manifest.displayName || extension.manifest.name),
					detail: `${extension.manifest.displayName || extension.manifest.name} (${extensionIdentifier.id}) wants to open a URL:\n\n${uri.toString()}`,
					primaryButton: localize('enableAndReload', "&&Enable and Open"),
					type: 'question'
				});

				if (!result.confirmed) {
					return;
				}

				await this.extensionEnablementService.setEnablement([extension], EnablementState.EnabledGlobally);
				await this.reloadAndHandle(uri);
			}
		}

		// Extension is not installed
		else {
			const galleryExtension = await this.galleryService.getCompatibleExtension(extensionIdentifier);

			if (!galleryExtension) {
				return;
			}

			// Install the Extension and reload the window to handle.
			const result = await this.dialogService.confirm({
				message: localize('installAndHandle', "Extension '{0}' is not installed. Would you like to install the extension and reload the window to open this URL?", galleryExtension.displayName || galleryExtension.name),
				detail: `${galleryExtension.displayName || galleryExtension.name} (${extensionIdentifier.id}) wants to open a URL:\n\n${uri.toString()}`,
				primaryButton: localize('install', "&&Install"),
				type: 'question'
			});

			if (!result.confirmed) {
				return;
			}

			try {
				await this.progressService.withProgress({
					location: ProgressLocation.Notification,
					title: localize('Installing', "Installing Extension '{0}'...", galleryExtension.displayName || galleryExtension.name)
				}, () => this.extensionManagementService.installFromGallery(galleryExtension));

				this.notificationService.prompt(
					Severity.Info,
					localize('reload', "Would you like to reload the window and open the URL '{0}'?", uri.toString()),
					[{ label: localize('Reload', "Reload Window and Open"), run: () => this.reloadAndHandle(uri) }],
					{ sticky: true }
				);
			} catch (error) {
				this.notificationService.error(error);
			}
		}
	}

	private async reloadAndHandle(url: URI): Promise<void> {
		this.storageService.store(URL_TO_HANDLE, JSON.stringify(url.toJSON()), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		await this.hostService.reload();
	}

	// forget about all uris buffered more than 5 minutes ago
	private garbageCollect(): void {
		const now = new Date().getTime();
		const uriBuffer = new Map<string, { timestamp: number, uri: URI }[]>();

		this.uriBuffer.forEach((uris, extensionId) => {
			uris = uris.filter(({ timestamp }) => now - timestamp < FIVE_MINUTES);

			if (uris.length > 0) {
				uriBuffer.set(extensionId, uris);
			}
		});

		this.uriBuffer = uriBuffer;
	}

	private didUserTrustExtension(id: string): boolean {
		if (this.userTrustedExtensionsStorage.has(id)) {
			return true;
		}

		return this.getConfirmedTrustedExtensionIdsFromConfiguration().indexOf(id) > -1;
	}

	private getConfirmedTrustedExtensionIdsFromConfiguration(): Array<string> {
		const trustedExtensionIds = this.configurationService.getValue<Array<string>>(USER_TRUSTED_EXTENSIONS_CONFIGURATION_KEY);

		if (!Array.isArray(trustedExtensionIds)) {
			return [];
		}

		return trustedExtensionIds;
	}

	dispose(): void {
		this.disposable.dispose();
		this.extensionHandlers.clear();
		this.uriBuffer.clear();
	}
}

registerSingleton(IExtensionUrlHandler, ExtensionUrlHandler);

/**
 * This class handles URLs before `ExtensionUrlHandler` is instantiated.
 * More info: https://github.com/microsoft/vscode/issues/73101
 */
class ExtensionUrlBootstrapHandler implements IWorkbenchContribution, IURLHandler {

	private static _cache: [URI, IOpenURLOptions | undefined][] = [];
	private static disposable: IDisposable;

	static get cache(): [URI, IOpenURLOptions | undefined][] {
		ExtensionUrlBootstrapHandler.disposable.dispose();

		const result = ExtensionUrlBootstrapHandler._cache;
		ExtensionUrlBootstrapHandler._cache = [];
		return result;
	}

	constructor(@IURLService urlService: IURLService) {
		ExtensionUrlBootstrapHandler.disposable = urlService.registerHandler(this);
	}

	async handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {
		if (!isExtensionId(uri.authority)) {
			return false;
		}

		ExtensionUrlBootstrapHandler._cache.push([uri, options]);
		return true;
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(ExtensionUrlBootstrapHandler, LifecyclePhase.Ready);

class ManageAuthorizedExtensionURIsAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.extensions.action.manageAuthorizedExtensionURIs',
			title: { value: localize('manage', "Manage Authorized Extension URIs..."), original: 'Manage Authorized Extension URIs...' },
			category: { value: localize('extensions', "Extensions"), original: 'Extensions' },
			menu: {
				id: MenuId.CommandPalette,
				when: IsWebContext.toNegated()
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		const quickInputService = accessor.get(IQuickInputService);
		const storage = new UserTrustedExtensionIdStorage(storageService);
		const items = storage.extensions.map(label => ({ label, picked: true } as IQuickPickItem));

		if (items.length === 0) {
			await quickInputService.pick([{ label: localize('no', 'There are currently no authorized extension URIs.') }]);
			return;
		}

		const result = await quickInputService.pick(items, { canPickMany: true });

		if (!result) {
			return;
		}

		storage.set(result.map(item => item.label));
	}
}

registerAction2(ManageAuthorizedExtensionURIsAction);
