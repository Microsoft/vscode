/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkbenchExtensionEnablementService, IWebExtensionsScannerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IExtensionService, IExtensionHost } from 'vs/workbench/services/extensions/common/extensions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { IProductService } from 'vs/platform/product/common/productService';
import { AbstractExtensionService, parseScannedExtension } from 'vs/workbench/services/extensions/common/abstractExtensionService';
import { RemoteExtensionHost, IRemoteExtensionHostDataProvider, IRemoteExtensionHostInitData } from 'vs/workbench/services/extensions/common/remoteExtensionHost';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { WebWorkerExtensionHost } from 'vs/workbench/services/extensions/browser/webWorkerExtensionHost';
import { getExtensionKind } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ExtensionIdentifier, IExtensionDescription, ExtensionKind } from 'vs/platform/extensions/common/extensions';
import { FetchFileSystemProvider } from 'vs/workbench/services/extensions/browser/webWorkerFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IUserDataInitializationService } from 'vs/workbench/services/userData/browser/userDataInit';

export class ExtensionService extends AbstractExtensionService implements IExtensionService {

	private _disposables = new DisposableStore();
	private _remoteInitData: IRemoteExtensionHostInitData | null = null;
	private _runningLocation: Map<string, ExtensionRunningLocation>;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchExtensionEnablementService extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IRemoteAuthorityResolverService private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IWebExtensionsScannerService private readonly _webExtensionsScannerService: IWebExtensionsScannerService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IUserDataInitializationService private readonly _userDataInitializationService: IUserDataInitializationService,
	) {
		super(
			instantiationService,
			notificationService,
			environmentService,
			telemetryService,
			extensionEnablementService,
			fileService,
			productService,
		);

		this._runningLocation = new Map<string, ExtensionRunningLocation>();

		// Initialize extensions first and do it only after workbench is ready
		this._lifecycleService.when(LifecyclePhase.Ready).then(async () => {
			await this._userDataInitializationService.initializeExtensions(this._instantiationService);
			this._initialize();
		});

		this._initFetchFileSystem();
	}

	dispose(): void {
		this._disposables.dispose();
		super.dispose();
	}

	private _initFetchFileSystem(): void {
		const provider = new FetchFileSystemProvider();
		this._disposables.add(this._fileService.registerProvider(Schemas.http, provider));
		this._disposables.add(this._fileService.registerProvider(Schemas.https, provider));
	}

	private _createLocalExtensionHostDataProvider() {
		return {
			getInitData: async () => {
				const allExtensions = await this.getExtensions();
				const localWebWorkerExtensions = filterByRunningLocation(allExtensions, this._runningLocation, ExtensionRunningLocation.LocalWebWorker);
				return {
					autoStart: true,
					extensions: localWebWorkerExtensions
				};
			}
		};
	}

	private _createRemoteExtensionHostDataProvider(remoteAuthority: string): IRemoteExtensionHostDataProvider {
		return {
			remoteAuthority: remoteAuthority,
			getInitData: async () => {
				await this.whenInstalledExtensionsRegistered();
				return this._remoteInitData!;
			}
		};
	}

	protected _createExtensionHosts(_isInitialStart: boolean): IExtensionHost[] {
		const result: IExtensionHost[] = [];

		const webWorkerExtHost = this._instantiationService.createInstance(WebWorkerExtensionHost, this._createLocalExtensionHostDataProvider());
		result.push(webWorkerExtHost);

		const remoteAgentConnection = this._remoteAgentService.getConnection();
		if (remoteAgentConnection) {
			const remoteExtHost = this._instantiationService.createInstance(RemoteExtensionHost, this._createRemoteExtensionHostDataProvider(remoteAgentConnection.remoteAuthority), this._remoteAgentService.socketFactory);
			result.push(remoteExtHost);
		}

		return result;
	}

	protected async _scanAndHandleExtensions(): Promise<void> {
		// fetch the remote environment
		let [localExtensions, remoteEnv, remoteExtensions] = await Promise.all([
			this._webExtensionsScannerService.scanAndTranslateExtensions().then(extensions => extensions.map(parseScannedExtension)),
			this._remoteAgentService.getEnvironment(),
			this._remoteAgentService.scanExtensions()
		]);
		localExtensions = this._checkEnabledAndProposedAPI(localExtensions);
		remoteExtensions = this._checkEnabledAndProposedAPI(remoteExtensions);

		const remoteAgentConnection = this._remoteAgentService.getConnection();
		this._runningLocation = _determineRunningLocation(this._productService, this._configService, localExtensions, remoteExtensions, Boolean(remoteEnv && remoteAgentConnection));

		localExtensions = filterByRunningLocation(localExtensions, this._runningLocation, ExtensionRunningLocation.LocalWebWorker);
		remoteExtensions = filterByRunningLocation(remoteExtensions, this._runningLocation, ExtensionRunningLocation.Remote);

		const result = this._registry.deltaExtensions(remoteExtensions.concat(localExtensions), []);
		if (result.removedDueToLooping.length > 0) {
			this._logOrShowMessage(Severity.Error, nls.localize('looping', "The following extensions contain dependency loops and have been disabled: {0}", result.removedDueToLooping.map(e => `'${e.identifier.value}'`).join(', ')));
		}

		if (remoteEnv && remoteAgentConnection) {
			// save for remote extension's init data
			this._remoteInitData = {
				connectionData: this._remoteAuthorityResolverService.getConnectionData(remoteAgentConnection.remoteAuthority),
				pid: remoteEnv.pid,
				appRoot: remoteEnv.appRoot,
				extensionHostLogsPath: remoteEnv.extensionHostLogsPath,
				globalStorageHome: remoteEnv.globalStorageHome,
				workspaceStorageHome: remoteEnv.workspaceStorageHome,
				extensions: remoteExtensions,
				allExtensions: this._registry.getAllExtensionDescriptions()
			};
		}

		this._doHandleExtensionPoints(this._registry.getAllExtensionDescriptions());
	}

	public _onExtensionHostExit(code: number): void {
		// We log the exit code to the console. Do NOT remove this
		// code as the automated integration tests in browser rely
		// on this message to exit properly.
		console.log(`vscode:exit ${code}`);
	}
}

const enum ExtensionRunningLocation {
	None,
	LocalWebWorker,
	Remote
}

export function determineRunningLocation(localExtensions: IExtensionDescription[], remoteExtensions: IExtensionDescription[], allExtensionKinds: Map<string, ExtensionKind[]>, hasRemote: boolean): Map<string, ExtensionRunningLocation> {
	const localExtensionsSet = new Set<string>();
	localExtensions.forEach(ext => localExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier)));

	const remoteExtensionsSet = new Set<string>();
	remoteExtensions.forEach(ext => remoteExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier)));

	const pickRunningLocation = (extension: IExtensionDescription): ExtensionRunningLocation => {
		const isInstalledLocally = localExtensionsSet.has(ExtensionIdentifier.toKey(extension.identifier));
		const isInstalledRemotely = remoteExtensionsSet.has(ExtensionIdentifier.toKey(extension.identifier));
		const extensionKinds = allExtensionKinds.get(ExtensionIdentifier.toKey(extension.identifier)) || [];
		for (const extensionKind of extensionKinds) {
			if (extensionKind === 'ui' && isInstalledRemotely) {
				// ui extensions run remotely if possible
				return ExtensionRunningLocation.Remote;
			}
			if (extensionKind === 'workspace' && isInstalledRemotely) {
				// workspace extensions run remotely if possible
				return ExtensionRunningLocation.Remote;
			}
			if (extensionKind === 'web' && isInstalledLocally) {
				// web worker extensions run in the local web worker if possible
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

function _determineRunningLocation(productService: IProductService, configurationService: IConfigurationService, localExtensions: IExtensionDescription[], remoteExtensions: IExtensionDescription[], hasRemote: boolean): Map<string, ExtensionRunningLocation> {
	const allExtensionKinds = new Map<string, ExtensionKind[]>();
	localExtensions.forEach(ext => allExtensionKinds.set(ExtensionIdentifier.toKey(ext.identifier), getExtensionKind(ext, productService, configurationService)));
	remoteExtensions.forEach(ext => allExtensionKinds.set(ExtensionIdentifier.toKey(ext.identifier), getExtensionKind(ext, productService, configurationService)));
	return determineRunningLocation(localExtensions, remoteExtensions, allExtensionKinds, hasRemote);
}

function filterByRunningLocation(extensions: IExtensionDescription[], runningLocation: Map<string, ExtensionRunningLocation>, desiredRunningLocation: ExtensionRunningLocation): IExtensionDescription[] {
	return extensions.filter(ext => runningLocation.get(ExtensionIdentifier.toKey(ext.identifier)) === desiredRunningLocation);
}

registerSingleton(IExtensionService, ExtensionService);
