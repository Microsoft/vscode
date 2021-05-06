/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LocalProcessExtensionHost } from 'vs/workbench/services/extensions/electron-browser/localProcessExtensionHost';
import { CachedExtensionScanner } from 'vs/workbench/services/extensions/electron-browser/cachedExtensionScanner';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { AbstractExtensionService, ExtensionRunningLocation, ExtensionRunningLocationClassifier, ExtensionRunningPreference, parseScannedExtension } from 'vs/workbench/services/extensions/common/abstractExtensionService';
import * as nls from 'vs/nls';
import { runWhenIdle } from 'vs/base/common/async';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionManagementService, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IWebExtensionsScannerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IRemoteExtensionHostDataProvider, RemoteExtensionHost, IRemoteExtensionHostInitData } from 'vs/workbench/services/extensions/common/remoteExtensionHost';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IRemoteAuthorityResolverService, RemoteAuthorityResolverError, RemoteTrustOption, ResolverResult } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IExtensionService, toExtension, ExtensionHostKind, IExtensionHost, webWorkerExtHostConfig } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionHostManager } from 'vs/workbench/services/extensions/common/extensionHostManager';
import { ExtensionIdentifier, IExtension, ExtensionType, IExtensionDescription, ExtensionKind } from 'vs/platform/extensions/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { PersistentConnectionEventType } from 'vs/platform/remote/common/remoteAgentConnection';
import { IProductService } from 'vs/platform/product/common/productService';
import { Logger } from 'vs/workbench/services/extensions/common/extensionPoints';
import { flatten } from 'vs/base/common/arrays';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IRemoteExplorerService } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { getRemoteName } from 'vs/platform/remote/common/remoteHosts';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { WebWorkerExtensionHost } from 'vs/workbench/services/extensions/browser/webWorkerExtensionHost';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ILogService } from 'vs/platform/log/common/log';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { Schemas } from 'vs/base/common/network';
import { ExtensionHostExitCode } from 'vs/workbench/services/extensions/common/extensionHostProtocol';
import { updateProxyConfigurationsScope } from 'vs/platform/request/common/request';
import { ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { Codicon } from 'vs/base/common/codicons';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';

const MACHINE_PROMPT = false;

export class ExtensionService extends AbstractExtensionService implements IExtensionService {

	private readonly _enableLocalWebWorker: boolean;
	private readonly _remoteInitData: Map<string, IRemoteExtensionHostInitData>;
	private readonly _extensionScanner: CachedExtensionScanner;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IWorkbenchEnvironmentService _environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchExtensionEnablementService extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IConfigurationService configurationService: IConfigurationService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IRemoteAuthorityResolverService private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IWebExtensionsScannerService private readonly _webExtensionsScannerService: IWebExtensionsScannerService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IHostService private readonly _hostService: IHostService,
		@IRemoteExplorerService private readonly _remoteExplorerService: IRemoteExplorerService,
		@IExtensionGalleryService private readonly _extensionGalleryService: IExtensionGalleryService,
		@ILogService private readonly _logService: ILogService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IWorkspaceTrustManagementService private readonly _workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionManifestPropertiesService extensionManifestPropertiesService: IExtensionManifestPropertiesService,
	) {
		super(
			new ExtensionRunningLocationClassifier(
				(extension) => this._getExtensionKind(extension),
				(extensionKinds, isInstalledLocally, isInstalledRemotely, preference) => this._pickRunningLocation(extensionKinds, isInstalledLocally, isInstalledRemotely, preference)
			),
			instantiationService,
			notificationService,
			_environmentService,
			telemetryService,
			extensionEnablementService,
			fileService,
			productService,
			extensionManagementService,
			contextService,
			configurationService,
			extensionManifestPropertiesService
		);

		this._enableLocalWebWorker = this._isLocalWebWorkerEnabled();
		this._remoteInitData = new Map<string, IRemoteExtensionHostInitData>();
		this._extensionScanner = instantiationService.createInstance(CachedExtensionScanner);

		// delay extension host creation and extension scanning
		// until the workbench is running. we cannot defer the
		// extension host more (LifecyclePhase.Restored) because
		// some editors require the extension host to restore
		// and this would result in a deadlock
		// see https://github.com/microsoft/vscode/issues/41322
		this._lifecycleService.when(LifecyclePhase.Ready).then(() => {
			// reschedule to ensure this runs after restoring viewlets, panels, and editors
			runWhenIdle(() => {
				this._initialize();
			}, 50 /*max delay*/);
		});
	}

	private _isLocalWebWorkerEnabled() {
		if (this._configurationService.getValue<boolean>(webWorkerExtHostConfig)) {
			return true;
		}
		if (this._environmentService.isExtensionDevelopment && this._environmentService.extensionDevelopmentKind?.some(k => k === 'web')) {
			return true;
		}
		return false;
	}

	protected _scanSingleExtension(extension: IExtension): Promise<IExtensionDescription | null> {
		if (extension.location.scheme === Schemas.vscodeRemote) {
			return this._remoteAgentService.scanSingleExtension(extension.location, extension.type === ExtensionType.System);
		}

		return this._extensionScanner.scanSingleExtension(extension.location.fsPath, extension.type === ExtensionType.System, this.createLogger());
	}

	private async _scanAllLocalExtensions(): Promise<IExtensionDescription[]> {
		return flatten(await Promise.all([
			this._extensionScanner.scannedExtensions,
			this._webExtensionsScannerService.scanAndTranslateExtensions().then(extensions => extensions.map(parseScannedExtension))
		]));
	}

	private _createLocalExtensionHostDataProvider(isInitialStart: boolean, desiredRunningLocation: ExtensionRunningLocation) {
		return {
			getInitData: async () => {
				if (isInitialStart) {
					const localExtensions = this._checkEnabledAndProposedAPI(await this._scanAllLocalExtensions());
					const runningLocation = this._runningLocationClassifier.determineRunningLocation(localExtensions, []);
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

	private _pickRunningLocation(extensionKinds: ExtensionKind[], isInstalledLocally: boolean, isInstalledRemotely: boolean, preference: ExtensionRunningPreference): ExtensionRunningLocation {
		return ExtensionService.pickRunningLocation(extensionKinds, isInstalledLocally, isInstalledRemotely, preference, Boolean(this._environmentService.remoteAuthority), this._enableLocalWebWorker);
	}

	public static pickRunningLocation(extensionKinds: ExtensionKind[], isInstalledLocally: boolean, isInstalledRemotely: boolean, preference: ExtensionRunningPreference, hasRemoteExtHost: boolean, hasWebWorkerExtHost: boolean): ExtensionRunningLocation {
		const result: ExtensionRunningLocation[] = [];
		for (const extensionKind of extensionKinds) {
			if (extensionKind === 'ui' && isInstalledLocally) {
				// ui extensions run locally if possible
				if (preference === ExtensionRunningPreference.None || preference === ExtensionRunningPreference.Local) {
					return ExtensionRunningLocation.LocalProcess;
				} else {
					result.push(ExtensionRunningLocation.LocalProcess);
				}
			}
			if (extensionKind === 'workspace' && isInstalledRemotely) {
				// workspace extensions run remotely if possible
				if (preference === ExtensionRunningPreference.None || preference === ExtensionRunningPreference.Remote) {
					return ExtensionRunningLocation.Remote;
				} else {
					result.push(ExtensionRunningLocation.Remote);
				}
			}
			if (extensionKind === 'workspace' && !hasRemoteExtHost) {
				// workspace extensions also run locally if there is no remote
				if (preference === ExtensionRunningPreference.None || preference === ExtensionRunningPreference.Local) {
					return ExtensionRunningLocation.LocalProcess;
				} else {
					result.push(ExtensionRunningLocation.LocalProcess);
				}
			}
			if (extensionKind === 'web' && isInstalledLocally && hasWebWorkerExtHost) {
				// web worker extensions run in the local web worker if possible
				if (preference === ExtensionRunningPreference.None || preference === ExtensionRunningPreference.Local) {
					return ExtensionRunningLocation.LocalWebWorker;
				} else {
					result.push(ExtensionRunningLocation.LocalWebWorker);
				}
			}
		}
		return (result.length > 0 ? result[0] : ExtensionRunningLocation.None);
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

	protected override _onExtensionHostCrashed(extensionHost: ExtensionHostManager, code: number, signal: string | null): void {
		const activatedExtensions = Array.from(this._extensionHostActiveExtensions.values());
		super._onExtensionHostCrashed(extensionHost, code, signal);

		if (extensionHost.kind === ExtensionHostKind.LocalProcess) {
			if (code === ExtensionHostExitCode.VersionMismatch) {
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

			const message = `Extension host terminated unexpectedly. The following extensions were running: ${activatedExtensions.map(id => id.value).join(', ')}`;
			this._logService.error(message);

			this._notificationService.prompt(Severity.Error, nls.localize('extensionService.crash', "Extension host terminated unexpectedly."),
				[{
					label: nls.localize('devTools', "Open Developer Tools"),
					run: () => this._nativeHostService.openDevTools()
				},
				{
					label: nls.localize('restart', "Restart Extension Host"),
					run: () => this.startExtensionHosts()
				}]
			);

			type ExtensionHostCrashClassification = {
				code: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				signal: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				extensionIds: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
			};
			type ExtensionHostCrashEvent = {
				code: number;
				signal: string | null;
				extensionIds: string[];
			};
			this._telemetryService.publicLog2<ExtensionHostCrashEvent, ExtensionHostCrashClassification>('extensionHostCrash', {
				code,
				signal,
				extensionIds: activatedExtensions.map(e => e.value)
			});

			for (const extensionId of activatedExtensions) {
				type ExtensionHostCrashExtensionClassification = {
					code: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					signal: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					extensionId: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				};
				type ExtensionHostCrashExtensionEvent = {
					code: number;
					signal: string | null;
					extensionId: string;
				};
				this._telemetryService.publicLog2<ExtensionHostCrashExtensionEvent, ExtensionHostCrashExtensionClassification>('extensionHostCrashExtension', {
					code,
					signal,
					extensionId: extensionId.value
				});
			}
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
		const remoteAuthority = this._environmentService.remoteAuthority;
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

		const remoteAuthority = this._environmentService.remoteAuthority;
		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess)!;

		const localExtensions = this._checkEnabledAndProposedAPI(await this._scanAllLocalExtensions());
		let remoteEnv: IRemoteAgentEnvironment | null = null;
		let remoteExtensions: IExtensionDescription[] = [];

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

			let promptForMachineTrust = MACHINE_PROMPT;

			if (resolverResult.options?.trust === RemoteTrustOption.DisableTrust) {
				promptForMachineTrust = false;
				this._workspaceTrustManagementService.setWorkspaceTrust(true);
			} else if (resolverResult.options?.trust === RemoteTrustOption.MachineTrusted) {
				promptForMachineTrust = false;
			}

			if (promptForMachineTrust) {
				const dialogResult = await this._dialogService.show(
					Severity.Info,
					nls.localize('machineTrustQuestion', "Do you trust the machine you're connecting to?"),
					[nls.localize('yes', "Yes, connect."), nls.localize('no', "No, do not connect.")],
					{
						cancelId: 1,
						custom: {
							icon: Codicon.remoteExplorer
						},
						// checkbox: { label: nls.localize('remember', "Remember my choice"), checked: true }
					}
				);

				if (dialogResult.choice !== 0) {
					// Did not confirm trust
					this._notificationService.notify({ severity: Severity.Warning, message: nls.localize('trustFailure', "Refused to connect to untrusted machine.") });
					// Proceed with the local extension host
					await this._startLocalExtensionHost(localExtensions);
					return;
				}
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
			[remoteEnv, remoteExtensions] = await Promise.all([
				this._remoteAgentService.getEnvironment(),
				this._remoteAgentService.scanExtensions()
			]);
			remoteExtensions = this._checkEnabledAndProposedAPI(remoteExtensions);

			if (!remoteEnv) {
				this._notificationService.notify({ severity: Severity.Error, message: nls.localize('getEnvironmentFailure', "Could not fetch remote environment") });
				// Proceed with the local extension host
				await this._startLocalExtensionHost(localExtensions);
				return;
			}

			updateProxyConfigurationsScope(remoteEnv.useHostProxy ? ConfigurationScope.APPLICATION : ConfigurationScope.MACHINE);
		}

		await this._startLocalExtensionHost(localExtensions, remoteAuthority, remoteEnv, remoteExtensions);
	}

	private async _startLocalExtensionHost(localExtensions: IExtensionDescription[], remoteAuthority: string | undefined = undefined, remoteEnv: IRemoteAgentEnvironment | null = null, remoteExtensions: IExtensionDescription[] = []): Promise<void> {

		this._runningLocation = this._runningLocationClassifier.determineRunningLocation(localExtensions, remoteExtensions);

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

		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess);
		if (localProcessExtensionHost) {
			localProcessExtensionHost.start(localProcessExtensions.map(extension => extension.identifier).filter(id => this._registry.containsExtension(id)));
		}

		const localWebWorkerExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalWebWorker);
		if (localWebWorkerExtensionHost) {
			localWebWorkerExtensionHost.start(localWebWorkerExtensions.map(extension => extension.identifier).filter(id => this._registry.containsExtension(id)));
		}
	}

	public override async getInspectPort(tryEnableInspector: boolean): Promise<number> {
		const localProcessExtensionHost = this._getExtensionHostManager(ExtensionHostKind.LocalProcess);
		if (localProcessExtensionHost) {
			return localProcessExtensionHost.getInspectPort(tryEnableInspector);
		}
		return 0;
	}

	public _onExtensionHostExit(code: number): void {
		// Dispose everything associated with the extension host
		this.stopExtensionHosts();

		if (this._isExtensionDevTestFromCli) {
			// When CLI testing make sure to exit with proper exit code
			this._nativeHostService.exit(code);
		} else {
			// Expected development extension termination: When the extension host goes down we also shutdown the window
			this._nativeHostService.closeWindow();
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

function filterByRunningLocation(extensions: IExtensionDescription[], runningLocation: Map<string, ExtensionRunningLocation>, desiredRunningLocation: ExtensionRunningLocation): IExtensionDescription[] {
	return extensions.filter(ext => runningLocation.get(ExtensionIdentifier.toKey(ext.identifier)) === desiredRunningLocation);
}

registerSingleton(IExtensionService, ExtensionService);

class RestartExtensionHostAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.restartExtensionHost',
			title: { value: nls.localize('restartExtensionHost', "Restart Extension Host"), original: 'Restart Extension Host' },
			category: CATEGORIES.Developer,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IExtensionService).restartExtensionHost();
	}
}

registerAction2(RestartExtensionHostAction);
