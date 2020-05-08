/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer as ipc } from 'electron';
import { ExtensionHostProcessWorker } from 'vs/workbench/services/extensions/electron-browser/extensionHost';
import { CachedExtensionScanner } from 'vs/workbench/services/extensions/electron-browser/cachedExtensionScanner';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { AbstractExtensionService } from 'vs/workbench/services/extensions/common/abstractExtensionService';
import * as nls from 'vs/nls';
import { runWhenIdle } from 'vs/base/common/async';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionManagementService, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInitDataProvider, RemoteExtensionHostClient } from 'vs/workbench/services/extensions/common/remoteExtensionHostClient';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IRemoteAuthorityResolverService, RemoteAuthorityResolverError, ResolverResult } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { getExtensionKind } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IExtensionService, toExtension } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionHostProcessManager } from 'vs/workbench/services/extensions/common/extensionHostProcessManager';
import { ExtensionIdentifier, IExtension, ExtensionType, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { Schemas } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { PersistentConnectionEventType } from 'vs/platform/remote/common/remoteAgentConnection';
import { IProductService } from 'vs/platform/product/common/productService';
import { Logger } from 'vs/workbench/services/extensions/common/extensionPoints';
import { flatten } from 'vs/base/common/arrays';
import { IStaticExtensionsService } from 'vs/workbench/services/extensions/common/staticExtensions';
import { IElectronService } from 'vs/platform/electron/node/electron';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IRemoteExplorerService } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { Action } from 'vs/base/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { getRemoteName } from 'vs/platform/remote/common/remoteHosts';

class DeltaExtensionsQueueItem {
	constructor(
		public readonly toAdd: IExtension[],
		public readonly toRemove: string[]
	) { }
}

export class ExtensionService extends AbstractExtensionService implements IExtensionService {

	private readonly _remoteExtensionsEnvironmentData: Map<string, IRemoteAgentEnvironment>;

	private readonly _extensionScanner: CachedExtensionScanner;
	private _deltaExtensionsQueue: DeltaExtensionsQueueItem[];

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IWorkbenchEnvironmentService protected readonly _environmentService: INativeWorkbenchEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchExtensionEnablementService extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IExtensionManagementService private readonly _extensionManagementService: IExtensionManagementService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IRemoteAuthorityResolverService private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IStaticExtensionsService private readonly _staticExtensions: IStaticExtensionsService,
		@IElectronService private readonly _electronService: IElectronService,
		@IHostService private readonly _hostService: IHostService,
		@IRemoteExplorerService private readonly _remoteExplorerService: IRemoteExplorerService,
		@IExtensionGalleryService private readonly _extensionGalleryService: IExtensionGalleryService,
	) {
		super(
			instantiationService,
			notificationService,
			_environmentService,
			telemetryService,
			extensionEnablementService,
			fileService,
			productService
		);

		if (this._extensionEnablementService.allUserExtensionsDisabled) {
			this._notificationService.prompt(Severity.Info, nls.localize('extensionsDisabled', "All installed extensions are temporarily disabled. Reload the window to return to the previous state."), [{
				label: nls.localize('Reload', "Reload"),
				run: () => {
					this._hostService.reload();
				}
			}]);
		}

		this._remoteExtensionsEnvironmentData = new Map<string, IRemoteAgentEnvironment>();

		this._extensionScanner = instantiationService.createInstance(CachedExtensionScanner);
		this._deltaExtensionsQueue = [];

		this._register(this._extensionEnablementService.onEnablementChanged((extensions) => {
			let toAdd: IExtension[] = [];
			let toRemove: string[] = [];
			for (const extension of extensions) {
				if (this._extensionEnablementService.isEnabled(extension)) {
					// an extension has been enabled
					toAdd.push(extension);
				} else {
					// an extension has been disabled
					toRemove.push(extension.identifier.id);
				}
			}
			this._handleDeltaExtensions(new DeltaExtensionsQueueItem(toAdd, toRemove));
		}));

		this._register(this._extensionManagementService.onDidInstallExtension((event) => {
			if (event.local) {
				if (this._extensionEnablementService.isEnabled(event.local)) {
					// an extension has been installed
					this._handleDeltaExtensions(new DeltaExtensionsQueueItem([event.local], []));
				}
			}
		}));

		this._register(this._extensionManagementService.onDidUninstallExtension((event) => {
			if (!event.error) {
				// an extension has been uninstalled
				this._handleDeltaExtensions(new DeltaExtensionsQueueItem([], [event.identifier.id]));
			}
		}));

		// delay extension host creation and extension scanning
		// until the workbench is running. we cannot defer the
		// extension host more (LifecyclePhase.Restored) because
		// some editors require the extension host to restore
		// and this would result in a deadlock
		// see https://github.com/Microsoft/vscode/issues/41322
		this._lifecycleService.when(LifecyclePhase.Ready).then(() => {
			// reschedule to ensure this runs after restoring viewlets, panels, and editors
			runWhenIdle(() => {
				this._initialize();
			}, 50 /*max delay*/);
		});
	}


	//#region deltaExtensions

	private _inHandleDeltaExtensions = false;
	private async _handleDeltaExtensions(item: DeltaExtensionsQueueItem): Promise<void> {
		this._deltaExtensionsQueue.push(item);
		if (this._inHandleDeltaExtensions) {
			// Let the current item finish, the new one will be picked up
			return;
		}

		while (this._deltaExtensionsQueue.length > 0) {
			const item = this._deltaExtensionsQueue.shift()!;
			try {
				this._inHandleDeltaExtensions = true;
				await this._deltaExtensions(item.toAdd, item.toRemove);
			} finally {
				this._inHandleDeltaExtensions = false;
			}
		}
	}

	private async _deltaExtensions(_toAdd: IExtension[], _toRemove: string[]): Promise<void> {
		if (this._environmentService.configuration.remoteAuthority) {
			return;
		}

		let toAdd: IExtensionDescription[] = [];
		for (let i = 0, len = _toAdd.length; i < len; i++) {
			const extension = _toAdd[i];

			if (!this._canAddExtension(extension)) {
				continue;
			}

			const extensionDescription = await this._extensionScanner.scanSingleExtension(extension.location.fsPath, extension.type === ExtensionType.System, this.createLogger());
			if (!extensionDescription) {
				// could not scan extension...
				continue;
			}

			toAdd.push(extensionDescription);
		}

		let toRemove: IExtensionDescription[] = [];
		for (let i = 0, len = _toRemove.length; i < len; i++) {
			const extensionId = _toRemove[i];
			const extensionDescription = this._registry.getExtensionDescription(extensionId);
			if (!extensionDescription) {
				// ignore disabling/uninstalling an extension which is not running
				continue;
			}

			if (!this._canRemoveExtension(extensionDescription)) {
				// uses non-dynamic extension point or is activated
				continue;
			}

			toRemove.push(extensionDescription);
		}

		if (toAdd.length === 0 && toRemove.length === 0) {
			return;
		}

		// Update the local registry
		const result = this._registry.deltaExtensions(toAdd, toRemove.map(e => e.identifier));
		this._onDidChangeExtensions.fire(undefined);

		toRemove = toRemove.concat(result.removedDueToLooping);
		if (result.removedDueToLooping.length > 0) {
			this._logOrShowMessage(Severity.Error, nls.localize('looping', "The following extensions contain dependency loops and have been disabled: {0}", result.removedDueToLooping.map(e => `'${e.identifier.value}'`).join(', ')));
		}

		// enable or disable proposed API per extension
		this._checkEnableProposedApi(toAdd);

		// Update extension points
		this._rehandleExtensionPoints((<IExtensionDescription[]>[]).concat(toAdd).concat(toRemove));

		// Update the extension host
		if (this._extensionHostProcessManagers.length > 0) {
			await this._extensionHostProcessManagers[0].deltaExtensions(toAdd, toRemove.map(e => e.identifier));
		}

		for (let i = 0; i < toAdd.length; i++) {
			this._activateAddedExtensionIfNeeded(toAdd[i]);
		}
	}

	private _rehandleExtensionPoints(extensionDescriptions: IExtensionDescription[]): void {
		this._doHandleExtensionPoints(extensionDescriptions);
	}

	public canAddExtension(extensionDescription: IExtensionDescription): boolean {
		return this._canAddExtension(toExtension(extensionDescription));
	}

	public _canAddExtension(extension: IExtension): boolean {
		if (this._environmentService.configuration.remoteAuthority) {
			return false;
		}

		if (extension.location.scheme !== Schemas.file) {
			return false;
		}

		const extensionDescription = this._registry.getExtensionDescription(extension.identifier.id);
		if (extensionDescription) {
			// this extension is already running (most likely at a different version)
			return false;
		}

		// Check if extension is renamed
		if (extension.identifier.uuid && this._registry.getAllExtensionDescriptions().some(e => e.uuid === extension.identifier.uuid)) {
			return false;
		}

		return true;
	}

	public canRemoveExtension(extension: IExtensionDescription): boolean {
		if (this._environmentService.configuration.remoteAuthority) {
			return false;
		}

		if (extension.extensionLocation.scheme !== Schemas.file) {
			return false;
		}

		const extensionDescription = this._registry.getExtensionDescription(extension.identifier);
		if (!extensionDescription) {
			// ignore removing an extension which is not running
			return false;
		}

		return this._canRemoveExtension(extensionDescription);
	}

	private _canRemoveExtension(extension: IExtensionDescription): boolean {
		if (this._extensionHostActiveExtensions.has(ExtensionIdentifier.toKey(extension.identifier))) {
			// Extension is running, cannot remove it safely
			return false;
		}

		return true;
	}

	private async _activateAddedExtensionIfNeeded(extensionDescription: IExtensionDescription): Promise<void> {

		let shouldActivate = false;
		let shouldActivateReason: string | null = null;
		if (Array.isArray(extensionDescription.activationEvents)) {
			for (let activationEvent of extensionDescription.activationEvents) {
				// TODO@joao: there's no easy way to contribute this
				if (activationEvent === 'onUri') {
					activationEvent = `onUri:${ExtensionIdentifier.toKey(extensionDescription.identifier)}`;
				}

				if (this._allRequestedActivateEvents.has(activationEvent)) {
					// This activation event was fired before the extension was added
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}

				if (activationEvent === '*') {
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}

				if (/^workspaceContains/.test(activationEvent)) {
					// do not trigger a search, just activate in this case...
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}
			}
		}

		if (shouldActivate) {
			await Promise.all(
				this._extensionHostProcessManagers.map(extHostManager => extHostManager.activate(extensionDescription.identifier, { startup: false, extensionId: extensionDescription.identifier, activationEvent: shouldActivateReason! }))
			).then(() => { });
		}
	}

	//#endregion

	private _createProvider(remoteAuthority: string): IInitDataProvider {
		return {
			remoteAuthority: remoteAuthority,
			getInitData: () => {
				return this.whenInstalledExtensionsRegistered().then(() => {
					return this._remoteExtensionsEnvironmentData.get(remoteAuthority)!;
				});
			}
		};
	}

	protected _createExtensionHosts(isInitialStart: boolean, initialActivationEvents: string[]): ExtensionHostProcessManager[] {
		let autoStart: boolean;
		let extensions: Promise<IExtensionDescription[]>;
		if (isInitialStart) {
			autoStart = false;
			extensions = this._extensionScanner.scannedExtensions.then(extensions => extensions.filter(extension => this._isEnabled(extension))); // remove disabled extensions
		} else {
			// restart case
			autoStart = true;
			extensions = this.getExtensions().then((extensions) => extensions.filter(ext => ext.extensionLocation.scheme === Schemas.file));
		}

		const result: ExtensionHostProcessManager[] = [];

		const extHostProcessWorker = this._instantiationService.createInstance(ExtensionHostProcessWorker, autoStart, extensions, this._environmentService.extHostLogsPath);
		const extHostProcessManager = this._instantiationService.createInstance(ExtensionHostProcessManager, true, extHostProcessWorker, null, initialActivationEvents);
		result.push(extHostProcessManager);

		const remoteAgentConnection = this._remoteAgentService.getConnection();
		if (remoteAgentConnection) {
			const remoteExtHostProcessWorker = this._instantiationService.createInstance(RemoteExtensionHostClient, this.getExtensions(), this._createProvider(remoteAgentConnection.remoteAuthority), this._remoteAgentService.socketFactory);
			const remoteExtHostProcessManager = this._instantiationService.createInstance(ExtensionHostProcessManager, false, remoteExtHostProcessWorker, remoteAgentConnection.remoteAuthority, initialActivationEvents);
			result.push(remoteExtHostProcessManager);
		}

		return result;
	}

	protected _onExtensionHostCrashed(extensionHost: ExtensionHostProcessManager, code: number, signal: string | null): void {
		super._onExtensionHostCrashed(extensionHost, code, signal);

		if (extensionHost.isLocal) {
			if (code === 55) {
				this._notificationService.prompt(
					Severity.Error,
					nls.localize('extensionService.versionMismatchCrash', "Extension host cannot start: version mismatch."),
					[{
						label: nls.localize('relaunch', "Relaunch VS Code"),
						run: () => {
							this._instantiationService.invokeFunction((accessor) => {
								const hostService = accessor.get(IHostService);
								hostService.restart();
							});
						}
					}]
				);
				return;
			}

			this._notificationService.prompt(Severity.Error, nls.localize('extensionService.crash', "Extension host terminated unexpectedly."),
				[{
					label: nls.localize('devTools', "Open Developer Tools"),
					run: () => this._electronService.openDevTools()
				},
				{
					label: nls.localize('restart', "Restart Extension Host"),
					run: () => this.startExtensionHost()
				}]
			);
		}
	}

	// --- impl

	private createLogger(): Logger {
		return new Logger((severity, source, message) => {
			if (this._isDev && source) {
				this._logOrShowMessage(severity, `[${source}]: ${message}`);
			} else {
				this._logOrShowMessage(severity, message);
			}
		});
	}

	private async _resolveAuthorityAgain(): Promise<void> {
		const remoteAuthority = this._environmentService.configuration.remoteAuthority;
		if (!remoteAuthority) {
			return;
		}

		const extensionHost = this._extensionHostProcessManagers[0];
		this._remoteAuthorityResolverService.clearResolvedAuthority(remoteAuthority);
		try {
			const result = await extensionHost.resolveAuthority(remoteAuthority);
			this._remoteAuthorityResolverService.setResolvedAuthority(result.authority, result.options);
		} catch (err) {
			this._remoteAuthorityResolverService.setResolvedAuthorityError(remoteAuthority, err);
		}
	}

	protected async _scanAndHandleExtensions(): Promise<void> {
		this._extensionScanner.startScanningExtensions(this.createLogger());

		const remoteAuthority = this._environmentService.configuration.remoteAuthority;
		const extensionHost = this._extensionHostProcessManagers[0];

		const allExtensions = flatten(await Promise.all([this._extensionScanner.scannedExtensions, this._staticExtensions.getExtensions()]));

		// enable or disable proposed API per extension
		this._checkEnableProposedApi(allExtensions);

		// remove disabled extensions
		let localExtensions = remove(allExtensions, extension => this._isDisabled(extension));

		if (remoteAuthority) {
			let resolvedAuthority: ResolverResult;

			try {
				resolvedAuthority = await extensionHost.resolveAuthority(remoteAuthority);
			} catch (err) {
				const remoteName = getRemoteName(remoteAuthority);
				if (RemoteAuthorityResolverError.isNoResolverFound(err)) {
					err.isHandled = await this._handleNoResolverFound(remoteName, allExtensions);
				} else {
					console.log(err);
					if (RemoteAuthorityResolverError.isHandled(err)) {
						console.log(`Error handled: Not showing a notification for the error`);
					}
				}
				this._remoteAuthorityResolverService.setResolvedAuthorityError(remoteAuthority, err);

				// Proceed with the local extension host
				await this._startLocalExtensionHost(extensionHost, localExtensions, localExtensions.map(extension => extension.identifier));
				return;
			}

			// set the resolved authority
			this._remoteAuthorityResolverService.setResolvedAuthority(resolvedAuthority.authority, resolvedAuthority.options);
			this._remoteExplorerService.setTunnelInformation(resolvedAuthority.tunnelInformation);

			// monitor for breakage
			const connection = this._remoteAgentService.getConnection();
			if (connection) {
				connection.onDidStateChange(async (e) => {
					const remoteAuthority = this._environmentService.configuration.remoteAuthority;
					if (!remoteAuthority) {
						return;
					}
					if (e.type === PersistentConnectionEventType.ConnectionLost) {
						this._remoteAuthorityResolverService.clearResolvedAuthority(remoteAuthority);
					}
				});
				connection.onReconnecting(() => this._resolveAuthorityAgain());
			}

			// fetch the remote environment
			const remoteEnv = (await this._remoteAgentService.getEnvironment());

			if (!remoteEnv) {
				this._notificationService.notify({ severity: Severity.Error, message: nls.localize('getEnvironmentFailure', "Could not fetch remote environment") });
				// Proceed with the local extension host
				await this._startLocalExtensionHost(extensionHost, localExtensions, localExtensions.map(extension => extension.identifier));
				return;
			}

			// enable or disable proposed API per extension
			this._checkEnableProposedApi(remoteEnv.extensions);

			// remove disabled extensions
			remoteEnv.extensions = remove(remoteEnv.extensions, extension => this._isDisabled(extension));

			// Determine where each extension will execute, based on extensionKind
			const isInstalledLocally = new Set<string>();
			localExtensions.forEach(ext => isInstalledLocally.add(ExtensionIdentifier.toKey(ext.identifier)));

			const isInstalledRemotely = new Set<string>();
			remoteEnv.extensions.forEach(ext => isInstalledRemotely.add(ExtensionIdentifier.toKey(ext.identifier)));

			const enum RunningLocation { None, Local, Remote }
			const pickRunningLocation = (extension: IExtensionDescription): RunningLocation => {
				for (const extensionKind of getExtensionKind(extension, this._productService, this._configurationService)) {
					if (extensionKind === 'ui') {
						if (isInstalledLocally.has(ExtensionIdentifier.toKey(extension.identifier))) {
							return RunningLocation.Local;
						}
					} else if (extensionKind === 'workspace') {
						if (isInstalledRemotely.has(ExtensionIdentifier.toKey(extension.identifier))) {
							return RunningLocation.Remote;
						}
					}
				}
				return RunningLocation.None;
			};

			const runningLocation = new Map<string, RunningLocation>();
			localExtensions.forEach(ext => runningLocation.set(ExtensionIdentifier.toKey(ext.identifier), pickRunningLocation(ext)));
			remoteEnv.extensions.forEach(ext => runningLocation.set(ExtensionIdentifier.toKey(ext.identifier), pickRunningLocation(ext)));

			// remove non-UI extensions from the local extensions
			localExtensions = localExtensions.filter(ext => runningLocation.get(ExtensionIdentifier.toKey(ext.identifier)) === RunningLocation.Local);

			// in case of UI extensions overlap, the local extension wins
			remoteEnv.extensions = remoteEnv.extensions.filter(ext => runningLocation.get(ExtensionIdentifier.toKey(ext.identifier)) === RunningLocation.Remote);

			// save for remote extension's init data
			this._remoteExtensionsEnvironmentData.set(remoteAuthority, remoteEnv);

			await this._startLocalExtensionHost(extensionHost, remoteEnv.extensions.concat(localExtensions), localExtensions.map(extension => extension.identifier));
		} else {
			await this._startLocalExtensionHost(extensionHost, localExtensions, localExtensions.map(extension => extension.identifier));
		}
	}

	private async _startLocalExtensionHost(extensionHost: ExtensionHostProcessManager, allExtensions: IExtensionDescription[], localExtensions: ExtensionIdentifier[]): Promise<void> {
		this._registerAndHandleExtensions(allExtensions);
		extensionHost.start(localExtensions.filter(id => this._registry.containsExtension(id)));
	}

	private _registerAndHandleExtensions(allExtensions: IExtensionDescription[]): void {
		const result = this._registry.deltaExtensions(allExtensions, []);
		if (result.removedDueToLooping.length > 0) {
			this._logOrShowMessage(Severity.Error, nls.localize('looping', "The following extensions contain dependency loops and have been disabled: {0}", result.removedDueToLooping.map(e => `'${e.identifier.value}'`).join(', ')));
		}

		this._doHandleExtensionPoints(this._registry.getAllExtensionDescriptions());
	}

	public async getInspectPort(tryEnableInspector: boolean): Promise<number> {
		if (this._extensionHostProcessManagers.length > 0) {
			return this._extensionHostProcessManagers[0].getInspectPort(tryEnableInspector);
		}
		return 0;
	}

	public _onExtensionHostExit(code: number): void {
		if (this._isExtensionDevTestFromCli) {
			// When CLI testing make sure to exit with proper exit code
			ipc.send('vscode:exit', code);
		} else {
			// Expected development extension termination: When the extension host goes down we also shutdown the window
			this._electronService.closeWindow();
		}
	}

	private async _handleNoResolverFound(remoteName: string, allExtensions: IExtensionDescription[]): Promise<boolean> {
		const recommendation = this._productService.remoteExtensionTips?.[remoteName];
		if (!recommendation) {
			return false;
		}
		const sendTelemetry = (userReaction: 'install' | 'enable' | 'cancel') => {
			/* __GDPR__
			"remoteExtensionRecommendations:popup" : {
				"userReaction" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"extensionId": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
			}
			*/
			this._telemetryService.publicLog('remoteExtensionRecommendations:popup', { userReaction, extensionId: resolverExtensionId });
		};

		const resolverExtensionId = recommendation.extensionId;
		const extension = allExtensions.filter(e => e.identifier.value === resolverExtensionId)[0];
		if (extension) {
			if (this._isDisabled(extension)) {
				const message = nls.localize('enableResolver', "Extension '{0}' is required to open the remote window.\nOK to enable?", recommendation.friendlyName);
				this._notificationService.prompt(Severity.Info, message,
					[{
						label: nls.localize('enable', 'Enable and Reload'),
						run: async () => {
							sendTelemetry('enable');
							await this._extensionEnablementService.setEnablement([toExtension(extension)], EnablementState.EnabledGlobally);
							await this._hostService.reload();
						}
					}],
					{ sticky: true }
				);
			}
		} else {
			// Install the Extension and reload the window to handle.
			const message = nls.localize('installResolver', "Extension '{0}' is required to open the remote window.\nOK to install?", recommendation.friendlyName);
			this._notificationService.prompt(Severity.Info, message,
				[{
					label: nls.localize('install', 'Install and Reload'),
					run: async () => {
						sendTelemetry('install');
						const galleryExtension = await this._extensionGalleryService.getCompatibleExtension({ id: resolverExtensionId });
						if (galleryExtension) {
							await this._extensionManagementService.installFromGallery(galleryExtension);
							await this._hostService.reload();
						} else {
							this._notificationService.error(nls.localize('resolverExtensionNotFound', "`{0}` not found on marketplace"));
						}

					}
				}],
				{
					sticky: true,
					onCancel: () => sendTelemetry('cancel')
				}
			);

		}
		return true;

	}
}

function remove(arr: IExtensionDescription[], predicate: (item: IExtensionDescription) => boolean): IExtensionDescription[];
function remove(arr: IExtensionDescription[], toRemove: IExtensionDescription[]): IExtensionDescription[];
function remove(arr: IExtensionDescription[], arg2: ((item: IExtensionDescription) => boolean) | IExtensionDescription[]): IExtensionDescription[] {
	if (typeof arg2 === 'function') {
		return _removePredicate(arr, arg2);
	}
	return _removeSet(arr, arg2);
}

function _removePredicate(arr: IExtensionDescription[], predicate: (item: IExtensionDescription) => boolean): IExtensionDescription[] {
	return arr.filter(extension => !predicate(extension));
}

function _removeSet(arr: IExtensionDescription[], toRemove: IExtensionDescription[]): IExtensionDescription[] {
	const toRemoveSet = new Set<string>();
	toRemove.forEach(extension => toRemoveSet.add(ExtensionIdentifier.toKey(extension.identifier)));
	return arr.filter(extension => !toRemoveSet.has(ExtensionIdentifier.toKey(extension.identifier)));
}

registerSingleton(IExtensionService, ExtensionService);

class RestartExtensionHostAction extends Action {

	public static readonly ID = 'workbench.action.restartExtensionHost';
	public static readonly LABEL = nls.localize('restartExtensionHost', "Restart Extension Host");

	constructor(
		id: string,
		label: string,
		@IExtensionService private readonly _extensionService: IExtensionService
	) {
		super(id, label);
	}

	public async run() {
		this._extensionService.restartExtensionHost();
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(RestartExtensionHostAction), 'Developer: Restart Extension Host', nls.localize('developer', "Developer"));
