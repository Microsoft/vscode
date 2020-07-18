/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocalProcessExtensionHost } from 'vs/workbench/services/extensions/electron-browser/localProcessExtensionHost';
import { CachedExtensionScanner } from 'vs/workbench/services/extensions/electron-browser/cachedExtensionScanner';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { AbstractExtensionService, parseScannedExtension } from 'vs/workbench/services/extensions/common/abstractExtensionService';
import * as nls from 'vs/nls';
import { runWhenIdle } from 'vs/base/common/async';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionManagementService, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IWebExtensionsScannerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IRemoteExtensionHostDataProvider, RemoteExtensionHost, IRemoteExtensionHostInitData } from 'vs/workbench/services/extensions/common/remoteExtensionHost';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IRemoteAuthorityResolverService, RemoteAuthorityResolverError, ResolverResult } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { getExtensionKind } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IExtensionService, toExtension, ExtensionHostKind, IExtensionHost, webWorkerExtHostConfig } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionHostManager } from 'vs/workbench/services/extensions/common/extensionHostManager';
import { ExtensionIdentifier, IExtension, ExtensionType, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { Schemas } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { PersistentConnectionEventType } from 'vs/platform/remote/common/remoteAgentConnection';
import { IProductService } from 'vs/platform/product/common/productService';
import { Logger } from 'vs/workbench/services/extensions/common/extensionPoints';
import { flatten } from 'vs/base/common/arrays';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IRemoteExplorerService } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { getRemoteName } from 'vs/platform/remote/common/remoteHosts';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { WebWorkerExtensionHost } from 'vs/workbench/services/extensions/browser/webWorkerExtensionHost';
import { IExtensionActivationHost as IWorkspaceContainsActivationHost, checkGlobFileExists, checkActivateWorkspaceContainsExtension } from 'vs/workbench/api/common/shared/workspaceContains';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { exists } from 'vs/base/node/pfs';

class DeltaExtensionsQueueItem {
	constructor(
		public readonly toAdd: IExtension[],
		public readonly toRemove: string[]
	) { }
}

export class ExtensionService extends AbstractExtensionService implements IExtensionService {

	private readonly _enableLocalWebWorker: boolean;
	private readonly _remoteInitData: Map<string, IRemoteExtensionHostInitData>;
	private _runningLocation: Map<string, ExtensionRunningLocation>;
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
		@IWebExtensionsScannerService private readonly _webExtensionsScannerService: IWebExtensionsScannerService,
		@IElectronService private readonly _electronService: IElectronService,
		@IHostService private readonly _hostService: IHostService,
		@IRemoteExplorerService private readonly _remoteExplorerService: IRemoteExplorerService,
		@IExtensionGalleryService private readonly _extensionGalleryService: IExtensionGalleryService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
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

		this._enableLocalWebWorker = this._configurationService.getValue<boolean>(webWorkerExtHostConfig);

		this._remoteInitData = new Map<string, IRemoteExtensionHostInitData>();
		this._runningLocation = new Map<string, ExtensionRunningLocation>();

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

		// delay notification for extensions disabled until workbench restored
		if (this._extensionEnablementService.allUserExtensionsDisabled) {
			this._lifecycleService.when(LifecyclePhase.Restored).then(() => {
				this._notificationService.prompt(Severity.Info, nls.localize('extensionsDisabled', "All installed extensions are temporarily disabled. Reload the window to return to the previous state."), [{
					label: nls.localize('Reload', "Reload"),
					run: () => {
						this._hostService.reload();
					}
				}]);
			});
		}
	}

	private _getExtensionHostManager(kind: ExtensionHostKind): ExtensionHostManager | null {
		for (const extensionHostManager of this._extensionHostManagers) {
			if (extensionHostManager.kind === kind) {
				return extensionHostManager;
			}
		}
		return null;
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
		this._doHandleExtensionPoints((<IExtensionDescription[]>[]).concat(toAdd).concat(toRemove));

		// Update the extension host
		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess);
		if (localProcessExtensionHost) {
			await localProcessExtensionHost.deltaExtensions(toAdd, toRemove.map(e => e.identifier));
		}

		for (let i = 0; i < toAdd.length; i++) {
			this._activateAddedExtensionIfNeeded(toAdd[i]);
		}
	}

	public canAddExtension(extensionDescription: IExtensionDescription): boolean {
		return this._canAddExtension(toExtension(extensionDescription));
	}

	private _canAddExtension(extension: IExtension): boolean {
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
		let hasWorkspaceContains = false;
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
					hasWorkspaceContains = true;
				}

				if (activationEvent === 'onStartupFinished') {
					shouldActivate = true;
					shouldActivateReason = activationEvent;
					break;
				}
			}
		}

		if (shouldActivate) {
			await Promise.all(
				this._extensionHostManagers.map(extHostManager => extHostManager.activate(extensionDescription.identifier, { startup: false, extensionId: extensionDescription.identifier, activationEvent: shouldActivateReason! }))
			).then(() => { });
		} else if (hasWorkspaceContains) {
			const workspace = await this._contextService.getCompleteWorkspace();
			const forceUsingSearch = !!this._environmentService.configuration.remoteAuthority;
			const host: IWorkspaceContainsActivationHost = {
				folders: workspace.folders.map(folder => folder.uri),
				forceUsingSearch: forceUsingSearch,
				exists: (path) => exists(path),
				checkExists: (folders, includes, token) => this._instantiationService.invokeFunction((accessor) => checkGlobFileExists(accessor, folders, includes, token))
			};

			const result = await checkActivateWorkspaceContainsExtension(host, extensionDescription);
			if (!result) {
				return;
			}

			await Promise.all(
				this._extensionHostManagers.map(extHostManager => extHostManager.activate(extensionDescription.identifier, { startup: false, extensionId: extensionDescription.identifier, activationEvent: result.activationEvent }))
			).then(() => { });
		}
	}

	//#endregion

	private async _scanAllLocalExtensions(): Promise<IExtensionDescription[]> {
		return flatten(await Promise.all([
			this._extensionScanner.scannedExtensions,
			this._webExtensionsScannerService.scanExtensions().then(extensions => extensions.map(parseScannedExtension))
		]));
	}

	private _createLocalExtensionHostDataProvider(isInitialStart: boolean, desiredRunningLocation: ExtensionRunningLocation) {
		return {
			getInitData: async () => {
				if (isInitialStart) {
					const localExtensions = this._checkEnabledAndProposedAPI(await this._scanAllLocalExtensions());
					const runningLocation = determineRunningLocation(this._productService, this._configurationService, localExtensions, [], false, this._enableLocalWebWorker);
					const localProcessExtensions = filterByRunningLocation(localExtensions, runningLocation, desiredRunningLocation);
					return {
						autoStart: false,
						extensions: localProcessExtensions
					};
				} else {
					// restart case
					const allExtensions = await this.getExtensions();
					const localProcessExtensions = filterByRunningLocation(allExtensions, this._runningLocation, desiredRunningLocation);
					return {
						autoStart: true,
						extensions: localProcessExtensions
					};
				}
			}
		};
	}

	private _createRemoteExtensionHostDataProvider(remoteAuthority: string): IRemoteExtensionHostDataProvider {
		return {
			remoteAuthority: remoteAuthority,
			getInitData: async () => {
				await this.whenInstalledExtensionsRegistered();
				return this._remoteInitData.get(remoteAuthority)!;
			}
		};
	}

	protected _createExtensionHosts(isInitialStart: boolean): IExtensionHost[] {
		const result: IExtensionHost[] = [];

		const localProcessExtHost = this._instantiationService.createInstance(LocalProcessExtensionHost, this._createLocalExtensionHostDataProvider(isInitialStart, ExtensionRunningLocation.LocalProcess));
		result.push(localProcessExtHost);

		if (this._enableLocalWebWorker) {
			const webWorkerExtHost = this._instantiationService.createInstance(WebWorkerExtensionHost, this._createLocalExtensionHostDataProvider(isInitialStart, ExtensionRunningLocation.LocalWebWorker));
			result.push(webWorkerExtHost);
		}

		const remoteAgentConnection = this._remoteAgentService.getConnection();
		if (remoteAgentConnection) {
			const remoteExtHost = this._instantiationService.createInstance(RemoteExtensionHost, this._createRemoteExtensionHostDataProvider(remoteAgentConnection.remoteAuthority), this._remoteAgentService.socketFactory);
			result.push(remoteExtHost);
		}

		return result;
	}

	protected _onExtensionHostCrashed(extensionHost: ExtensionHostManager, code: number, signal: string | null): void {
		super._onExtensionHostCrashed(extensionHost, code, signal);

		if (extensionHost.kind === ExtensionHostKind.LocalProcess) {
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

		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess)!;
		this._remoteAuthorityResolverService._clearResolvedAuthority(remoteAuthority);
		try {
			const result = await localProcessExtensionHost.resolveAuthority(remoteAuthority);
			this._remoteAuthorityResolverService._setResolvedAuthority(result.authority, result.options);
		} catch (err) {
			this._remoteAuthorityResolverService._setResolvedAuthorityError(remoteAuthority, err);
		}
	}

	protected async _scanAndHandleExtensions(): Promise<void> {
		this._extensionScanner.startScanningExtensions(this.createLogger());

		const remoteAuthority = this._environmentService.configuration.remoteAuthority;
		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess)!;

		let localExtensions = this._checkEnabledAndProposedAPI(await this._scanAllLocalExtensions());
		let remoteEnv: IRemoteAgentEnvironment | null = null;

		if (remoteAuthority) {
			let resolverResult: ResolverResult;

			try {
				resolverResult = await localProcessExtensionHost.resolveAuthority(remoteAuthority);
			} catch (err) {
				if (RemoteAuthorityResolverError.isNoResolverFound(err)) {
					err.isHandled = await this._handleNoResolverFound(remoteAuthority);
				} else {
					console.log(err);
					if (RemoteAuthorityResolverError.isHandled(err)) {
						console.log(`Error handled: Not showing a notification for the error`);
					}
				}
				this._remoteAuthorityResolverService._setResolvedAuthorityError(remoteAuthority, err);

				// Proceed with the local extension host
				await this._startLocalExtensionHost(localExtensions);
				return;
			}

			// set the resolved authority
			this._remoteAuthorityResolverService._setResolvedAuthority(resolverResult.authority, resolverResult.options);
			this._remoteExplorerService.setTunnelInformation(resolverResult.tunnelInformation);

			// monitor for breakage
			const connection = this._remoteAgentService.getConnection();
			if (connection) {
				connection.onDidStateChange(async (e) => {
					if (e.type === PersistentConnectionEventType.ConnectionLost) {
						this._remoteAuthorityResolverService._clearResolvedAuthority(remoteAuthority);
					}
				});
				connection.onReconnecting(() => this._resolveAuthorityAgain());
			}

			// fetch the remote environment
			remoteEnv = await this._remoteAgentService.getEnvironment();

			if (!remoteEnv) {
				this._notificationService.notify({ severity: Severity.Error, message: nls.localize('getEnvironmentFailure', "Could not fetch remote environment") });
				// Proceed with the local extension host
				await this._startLocalExtensionHost(localExtensions);
				return;
			}
		}

		await this._startLocalExtensionHost(localExtensions, remoteAuthority, remoteEnv);
	}

	private async _startLocalExtensionHost(localExtensions: IExtensionDescription[], remoteAuthority: string | undefined = undefined, remoteEnv: IRemoteAgentEnvironment | null = null): Promise<void> {

		let remoteExtensions = remoteEnv ? this._checkEnabledAndProposedAPI(remoteEnv.extensions) : [];

		this._runningLocation = determineRunningLocation(this._productService, this._configurationService, localExtensions, remoteExtensions, Boolean(remoteAuthority), this._enableLocalWebWorker);

		// remove non-UI extensions from the local extensions
		const localProcessExtensions = filterByRunningLocation(localExtensions, this._runningLocation, ExtensionRunningLocation.LocalProcess);
		const localWebWorkerExtensions = filterByRunningLocation(localExtensions, this._runningLocation, ExtensionRunningLocation.LocalWebWorker);
		remoteExtensions = filterByRunningLocation(remoteExtensions, this._runningLocation, ExtensionRunningLocation.Remote);

		const result = this._registry.deltaExtensions(remoteExtensions.concat(localProcessExtensions).concat(localWebWorkerExtensions), []);
		if (result.removedDueToLooping.length > 0) {
			this._logOrShowMessage(Severity.Error, nls.localize('looping', "The following extensions contain dependency loops and have been disabled: {0}", result.removedDueToLooping.map(e => `'${e.identifier.value}'`).join(', ')));
		}

		if (remoteAuthority && remoteEnv) {
			this._remoteInitData.set(remoteAuthority, {
				connectionData: this._remoteAuthorityResolverService.getConnectionData(remoteAuthority),
				pid: remoteEnv.pid,
				appRoot: remoteEnv.appRoot,
				extensionHostLogsPath: remoteEnv.extensionHostLogsPath,
				globalStorageHome: remoteEnv.globalStorageHome,
				workspaceStorageHome: remoteEnv.workspaceStorageHome,
				extensions: remoteExtensions,
				allExtensions: this._registry.getAllExtensionDescriptions(),
			});
		}

		this._doHandleExtensionPoints(this._registry.getAllExtensionDescriptions());

		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess)!;
		localProcessExtensionHost.start(localProcessExtensions.map(extension => extension.identifier).filter(id => this._registry.containsExtension(id)));

		const localWebWorkerExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalWebWorker);
		if (localWebWorkerExtensionHost) {
			localWebWorkerExtensionHost.start(localWebWorkerExtensions.map(extension => extension.identifier).filter(id => this._registry.containsExtension(id)));
		}
	}

	public async getInspectPort(tryEnableInspector: boolean): Promise<number> {
		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess);
		if (localProcessExtensionHost) {
			return localProcessExtensionHost.getInspectPort(tryEnableInspector);
		}
		return 0;
	}

	public _onExtensionHostExit(code: number): void {
		if (this._isExtensionDevTestFromCli) {
			// When CLI testing make sure to exit with proper exit code
			this._electronService.exit(code);
		} else {
			// Expected development extension termination: When the extension host goes down we also shutdown the window
			this._electronService.closeWindow();
		}
	}

	private async _handleNoResolverFound(remoteAuthority: string): Promise<boolean> {
		const remoteName = getRemoteName(remoteAuthority);
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
		const allExtensions = await this._scanAllLocalExtensions();
		const extension = allExtensions.filter(e => e.identifier.value === resolverExtensionId)[0];
		if (extension) {
			if (!this._isEnabled(extension)) {
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
			const message = nls.localize('installResolver', "Extension '{0}' is required to open the remote window.\nDo you want to install the extension?", recommendation.friendlyName);
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

const enum ExtensionRunningLocation {
	None,
	LocalProcess,
	LocalWebWorker,
	Remote
}

function determineRunningLocation(productService: IProductService, configurationService: IConfigurationService, localExtensions: IExtensionDescription[], remoteExtensions: IExtensionDescription[], hasRemote: boolean, hasLocalWebWorker: boolean): Map<string, ExtensionRunningLocation> {
	const localExtensionsSet = new Set<string>();
	localExtensions.forEach(ext => localExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier)));

	const remoteExtensionsSet = new Set<string>();
	remoteExtensions.forEach(ext => remoteExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier)));

	const pickRunningLocation = (extension: IExtensionDescription): ExtensionRunningLocation => {
		const isInstalledLocally = localExtensionsSet.has(ExtensionIdentifier.toKey(extension.identifier));
		const isInstalledRemotely = remoteExtensionsSet.has(ExtensionIdentifier.toKey(extension.identifier));
		for (const extensionKind of getExtensionKind(extension, productService, configurationService)) {
			if (extensionKind === 'ui' && isInstalledLocally) {
				// ui extensions run locally if possible
				return ExtensionRunningLocation.LocalProcess;
			}
			if (extensionKind === 'workspace' && isInstalledRemotely) {
				// workspace extensions run remotely if possible
				return ExtensionRunningLocation.Remote;
			}
			if (extensionKind === 'workspace' && !hasRemote) {
				// workspace extensions also run locally if there is no remote
				return ExtensionRunningLocation.LocalProcess;
			}
			if (extensionKind === 'web' && isInstalledLocally && hasLocalWebWorker) {
				// web worker extensions run in the local web worker if possible
				if (typeof extension.browser !== 'undefined') {
					// The "browser" field determines the entry point
					(<any>extension).main = extension.browser;
				}
				return ExtensionRunningLocation.LocalWebWorker;
			}
		}
		return ExtensionRunningLocation.None;
	};

	const runningLocation = new Map<string, ExtensionRunningLocation>();
	localExtensions.forEach(ext => runningLocation.set(ExtensionIdentifier.toKey(ext.identifier), pickRunningLocation(ext)));
	remoteExtensions.forEach(ext => runningLocation.set(ExtensionIdentifier.toKey(ext.identifier), pickRunningLocation(ext)));
	return runningLocation;
}

function filterByRunningLocation(extensions: IExtensionDescription[], runningLocation: Map<string, ExtensionRunningLocation>, desiredRunningLocation: ExtensionRunningLocation): IExtensionDescription[] {
	return extensions.filter(ext => runningLocation.get(ExtensionIdentifier.toKey(ext.identifier)) === desiredRunningLocation);
}

registerSingleton(IExtensionService, ExtensionService);

class RestartExtensionHostAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.restartExtensionHost',
			title: { value: nls.localize('restartExtensionHost', "Restart Extension Host"), original: 'Restart Extension Host' },
			category: { value: nls.localize({ key: 'developer', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer"), original: 'Developer' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IExtensionService).restartExtensionHost();
	}
}

registerAction2(RestartExtensionHostAction);
