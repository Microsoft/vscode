/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { Barrier } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as perf from 'vs/base/common/performance';
import { isEqualOrParent } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { BetterMergeId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ActivationTimes, ExtensionPointContribution, IExtensionService, IExtensionsStatus, IMessage, IWillActivateEvent, IResponsiveStateChangeEvent, toExtension, IExtensionHost, ActivationKind, ExtensionHostKind } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionMessageCollector, ExtensionPoint, ExtensionsRegistry, IExtensionPoint, IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { ResponsiveState } from 'vs/workbench/services/extensions/common/rpcProtocol';
import { ExtensionHostManager } from 'vs/workbench/services/extensions/common/extensionHostManager';
import { ExtensionIdentifier, IExtensionDescription, ExtensionType, ITranslatedScannedExtension, IExtension, ExtensionKind, IExtensionContributions } from 'vs/platform/extensions/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { parseExtensionDevOptions } from 'vs/workbench/services/extensions/common/extensionDevOptions';
import { IProductService } from 'vs/platform/product/common/productService';
import { ExtensionActivationReason } from 'vs/workbench/api/common/extHostExtensionActivator';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionActivationHost as IWorkspaceContainsActivationHost, checkGlobFileExists, checkActivateWorkspaceContainsExtension } from 'vs/workbench/api/common/shared/workspaceContains';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';

const hasOwnProperty = Object.hasOwnProperty;
const NO_OP_VOID_PROMISE = Promise.resolve<void>(undefined);

export function parseScannedExtension(extension: ITranslatedScannedExtension): IExtensionDescription {
	return {
		identifier: new ExtensionIdentifier(`${extension.packageJSON.publisher}.${extension.packageJSON.name}`),
		isBuiltin: extension.type === ExtensionType.System,
		isUserBuiltin: false,
		isUnderDevelopment: extension.isUnderDevelopment,
		extensionLocation: extension.location,
		...extension.packageJSON,
	};
}

class DeltaExtensionsQueueItem {
	constructor(
		public readonly toAdd: IExtension[],
		public readonly toRemove: string[]
	) { }
}

export const enum ExtensionRunningLocation {
	None,
	LocalProcess,
	LocalWebWorker,
	Remote
}

export const enum ExtensionRunningPreference {
	None,
	Local,
	Remote
}

export abstract class AbstractExtensionService extends Disposable implements IExtensionService {

	public _serviceBrand: undefined;

	protected readonly _onDidRegisterExtensions: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidRegisterExtensions = this._onDidRegisterExtensions.event;

	protected readonly _onDidChangeExtensionsStatus: Emitter<ExtensionIdentifier[]> = this._register(new Emitter<ExtensionIdentifier[]>());
	public readonly onDidChangeExtensionsStatus: Event<ExtensionIdentifier[]> = this._onDidChangeExtensionsStatus.event;

	protected readonly _onDidChangeExtensions: Emitter<void> = this._register(new Emitter<void>({ leakWarningThreshold: 400 }));
	public readonly onDidChangeExtensions: Event<void> = this._onDidChangeExtensions.event;

	protected readonly _onWillActivateByEvent = this._register(new Emitter<IWillActivateEvent>());
	public readonly onWillActivateByEvent: Event<IWillActivateEvent> = this._onWillActivateByEvent.event;

	protected readonly _onDidChangeResponsiveChange = this._register(new Emitter<IResponsiveStateChangeEvent>());
	public readonly onDidChangeResponsiveChange: Event<IResponsiveStateChangeEvent> = this._onDidChangeResponsiveChange.event;

	protected readonly _registry: ExtensionDescriptionRegistry;
	private readonly _installedExtensionsReady: Barrier;
	protected readonly _isDev: boolean;
	private readonly _extensionsMessages: Map<string, IMessage[]>;
	protected readonly _allRequestedActivateEvents = new Set<string>();
	private readonly _proposedApiController: ProposedApiController;
	private readonly _isExtensionDevHost: boolean;
	protected readonly _isExtensionDevTestFromCli: boolean;

	private _deltaExtensionsQueue: DeltaExtensionsQueueItem[];
	private _inHandleDeltaExtensions: boolean;
	private readonly _onDidFinishHandleDeltaExtensions = this._register(new Emitter<void>());

	protected _runningLocation: Map<string, ExtensionRunningLocation>;

	// --- Members used per extension host process
	protected _extensionHostManagers: ExtensionHostManager[];
	protected _extensionHostActiveExtensions: Map<string, ExtensionIdentifier>;
	private _extensionHostActivationTimes: Map<string, ActivationTimes>;
	private _extensionHostExtensionRuntimeErrors: Map<string, Error[]>;

	constructor(
		protected readonly _runningLocationClassifier: ExtensionRunningLocationClassifier,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@INotificationService protected readonly _notificationService: INotificationService,
		@IWorkbenchEnvironmentService protected readonly _environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService protected readonly _telemetryService: ITelemetryService,
		@IWorkbenchExtensionEnablementService protected readonly _extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IFileService protected readonly _fileService: IFileService,
		@IProductService protected readonly _productService: IProductService,
		@IExtensionManagementService protected readonly _extensionManagementService: IExtensionManagementService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@IConfigurationService protected readonly _configurationService: IConfigurationService,
		@IExtensionManifestPropertiesService protected readonly _extensionManifestPropertiesService: IExtensionManifestPropertiesService,
	) {
		super();

		// help the file service to activate providers by activating extensions by file system event
		this._register(this._fileService.onWillActivateFileSystemProvider(e => {
			e.join(this.activateByEvent(`onFileSystem:${e.scheme}`));
		}));

		this._registry = new ExtensionDescriptionRegistry([]);
		this._installedExtensionsReady = new Barrier();
		this._isDev = !this._environmentService.isBuilt || this._environmentService.isExtensionDevelopment;
		this._extensionsMessages = new Map<string, IMessage[]>();
		this._proposedApiController = new ProposedApiController(this._environmentService, this._productService);

		this._extensionHostManagers = [];
		this._extensionHostActiveExtensions = new Map<string, ExtensionIdentifier>();
		this._extensionHostActivationTimes = new Map<string, ActivationTimes>();
		this._extensionHostExtensionRuntimeErrors = new Map<string, Error[]>();

		const devOpts = parseExtensionDevOptions(this._environmentService);
		this._isExtensionDevHost = devOpts.isExtensionDevHost;
		this._isExtensionDevTestFromCli = devOpts.isExtensionDevTestFromCli;

		this._deltaExtensionsQueue = [];
		this._inHandleDeltaExtensions = false;

		this._runningLocation = new Map<string, ExtensionRunningLocation>();

		this._register(this._extensionEnablementService.onEnablementChanged((extensions) => {
			let toAdd: IExtension[] = [];
			let toRemove: string[] = [];
			for (const extension of extensions) {
				if (this._safeInvokeIsEnabled(extension)) {
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
				if (this._safeInvokeIsEnabled(event.local)) {
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
	}

	protected _getExtensionKind(extensionDescription: IExtensionDescription): ExtensionKind[] {
		if (extensionDescription.isUnderDevelopment && this._environmentService.extensionDevelopmentKind) {
			return this._environmentService.extensionDevelopmentKind;
		}

		return this._extensionManifestPropertiesService.getExtensionKind(extensionDescription);
	}

	protected _getExtensionHostManager(kind: ExtensionHostKind): ExtensionHostManager | null {
		for (const extensionHostManager of this._extensionHostManagers) {
			if (extensionHostManager.kind === kind) {
				return extensionHostManager;
			}
		}
		return null;
	}

	//#region deltaExtensions

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

		this._onDidFinishHandleDeltaExtensions.fire();
	}

	private async _deltaExtensions(_toAdd: IExtension[], _toRemove: string[]): Promise<void> {
		let toAdd: IExtensionDescription[] = [];
		for (let i = 0, len = _toAdd.length; i < len; i++) {
			const extension = _toAdd[i];

			const extensionDescription = await this._scanSingleExtension(extension);
			if (!extensionDescription) {
				// could not scan extension...
				continue;
			}

			if (!this.canAddExtension(extensionDescription)) {
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

			if (!this.canRemoveExtension(extensionDescription)) {
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
		await this._updateExtensionsOnExtHosts(toAdd, toRemove.map(e => e.identifier));

		for (let i = 0; i < toAdd.length; i++) {
			this._activateAddedExtensionIfNeeded(toAdd[i]);
		}
	}

	private async _updateExtensionsOnExtHosts(toAdd: IExtensionDescription[], toRemove: ExtensionIdentifier[]): Promise<void> {
		const groupedToRemove: ExtensionIdentifier[][] = [];
		const groupRemove = (extensionHostKind: ExtensionHostKind, extensionRunningLocation: ExtensionRunningLocation) => {
			groupedToRemove[extensionHostKind] = filterByRunningLocation(toRemove, extId => extId, this._runningLocation, extensionRunningLocation);
		};
		groupRemove(ExtensionHostKind.LocalProcess, ExtensionRunningLocation.LocalProcess);
		groupRemove(ExtensionHostKind.LocalWebWorker, ExtensionRunningLocation.LocalWebWorker);
		groupRemove(ExtensionHostKind.Remote, ExtensionRunningLocation.Remote);
		for (const extensionId of toRemove) {
			this._runningLocation.delete(ExtensionIdentifier.toKey(extensionId));
		}

		const groupedToAdd: IExtensionDescription[][] = [];
		const groupAdd = (extensionHostKind: ExtensionHostKind, extensionRunningLocation: ExtensionRunningLocation) => {
			groupedToAdd[extensionHostKind] = filterByRunningLocation(toAdd, ext => ext.identifier, this._runningLocation, extensionRunningLocation);
		};
		for (const extension of toAdd) {
			const extensionKind = this._getExtensionKind(extension);
			const isRemote = extension.extensionLocation.scheme === Schemas.vscodeRemote;
			const runningLocation = this._runningLocationClassifier.pickRunningLocation(extensionKind, !isRemote, isRemote, ExtensionRunningPreference.None);
			this._runningLocation.set(ExtensionIdentifier.toKey(extension.identifier), runningLocation);
		}
		groupAdd(ExtensionHostKind.LocalProcess, ExtensionRunningLocation.LocalProcess);
		groupAdd(ExtensionHostKind.LocalWebWorker, ExtensionRunningLocation.LocalWebWorker);
		groupAdd(ExtensionHostKind.Remote, ExtensionRunningLocation.Remote);

		const promises: Promise<void>[] = [];

		for (const extensionHostKind of [ExtensionHostKind.LocalProcess, ExtensionHostKind.LocalWebWorker, ExtensionHostKind.Remote]) {
			const toAdd = groupedToAdd[extensionHostKind];
			const toRemove = groupedToRemove[extensionHostKind];
			if (toAdd.length > 0 || toRemove.length > 0) {
				const extensionHostManager = this._getExtensionHostManager(extensionHostKind);
				if (extensionHostManager) {
					promises.push(extensionHostManager.deltaExtensions(toAdd, toRemove));
				}
			}
		}

		await Promise.all(promises);
	}

	public canAddExtension(extension: IExtensionDescription): boolean {
		const existing = this._registry.getExtensionDescription(extension.identifier);
		if (existing) {
			// this extension is already running (most likely at a different version)
			return false;
		}

		// Check if extension is renamed
		if (extension.uuid && this._registry.getAllExtensionDescriptions().some(e => e.uuid === extension.uuid)) {
			return false;
		}

		const extensionKind = this._getExtensionKind(extension);
		const isRemote = extension.extensionLocation.scheme === Schemas.vscodeRemote;
		const runningLocation = this._runningLocationClassifier.pickRunningLocation(extensionKind, !isRemote, isRemote, ExtensionRunningPreference.None);
		if (runningLocation === ExtensionRunningLocation.None) {
			return false;
		}

		return true;
	}

	public canRemoveExtension(extension: IExtensionDescription): boolean {
		const extensionDescription = this._registry.getExtensionDescription(extension.identifier);
		if (!extensionDescription) {
			// ignore removing an extension which is not running
			return false;
		}

		if (this._extensionHostActiveExtensions.has(ExtensionIdentifier.toKey(extensionDescription.identifier))) {
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
			const forceUsingSearch = !!this._environmentService.remoteAuthority;
			const host: IWorkspaceContainsActivationHost = {
				folders: workspace.folders.map(folder => folder.uri),
				forceUsingSearch: forceUsingSearch,
				exists: (uri) => this._fileService.exists(uri),
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

	protected async _initialize(): Promise<void> {
		perf.mark('code/willLoadExtensions');
		this._startExtensionHosts(true, []);
		await this._scanAndHandleExtensions();
		this._releaseBarrier();
		perf.mark('code/didLoadExtensions');
		await this._handleExtensionTests();
	}

	private async _handleExtensionTests(): Promise<void> {
		if (!this._environmentService.isExtensionDevelopment || !this._environmentService.extensionTestsLocationURI) {
			return;
		}

		const extensionHostManager = this.findTestExtensionHost(this._environmentService.extensionTestsLocationURI);
		if (!extensionHostManager) {
			const msg = nls.localize('extensionTestError', "No extension host found that can launch the test runner at {0}.", this._environmentService.extensionTestsLocationURI.toString());
			console.error(msg);
			this._notificationService.error(msg);
			return;
		}


		let exitCode: number;
		try {
			exitCode = await extensionHostManager.extensionTestsExecute();
		} catch (err) {
			console.error(err);
			exitCode = 1 /* ERROR */;
		}

		await extensionHostManager.extensionTestsSendExit(exitCode);
		this._onExtensionHostExit(exitCode);
	}

	private findTestExtensionHost(testLocation: URI): ExtensionHostManager | undefined | null {
		let extensionHostKind: ExtensionHostKind | undefined;

		for (const extension of this._registry.getAllExtensionDescriptions()) {
			if (isEqualOrParent(testLocation, extension.extensionLocation)) {
				const runningLocation = this._runningLocation.get(ExtensionIdentifier.toKey(extension.identifier));
				if (runningLocation === ExtensionRunningLocation.LocalProcess) {
					extensionHostKind = ExtensionHostKind.LocalProcess;
				} else if (runningLocation === ExtensionRunningLocation.LocalWebWorker) {
					extensionHostKind = ExtensionHostKind.LocalWebWorker;
				} else if (runningLocation === ExtensionRunningLocation.Remote) {
					extensionHostKind = ExtensionHostKind.Remote;
				}
				break;
			}
		}
		if (extensionHostKind === undefined) {
			// not sure if we should support that, but it was possible to have an test outside an extension

			if (testLocation.scheme === Schemas.vscodeRemote) {
				extensionHostKind = ExtensionHostKind.Remote;
			} else {
				// When a debugger attaches to the extension host, it will surface all console.log messages from the extension host,
				// but not necessarily from the window. So it would be best if any errors get printed to the console of the extension host.
				// That is why here we use the local process extension host even for non-file URIs
				extensionHostKind = ExtensionHostKind.LocalProcess;
			}
		}
		if (extensionHostKind !== undefined) {
			return this._getExtensionHostManager(extensionHostKind);
		}
		return undefined;
	}

	private _releaseBarrier(): void {
		this._installedExtensionsReady.open();
		this._onDidRegisterExtensions.fire(undefined);
		this._onDidChangeExtensionsStatus.fire(this._registry.getAllExtensionDescriptions().map(e => e.identifier));
	}

	//#region Stopping / Starting / Restarting

	public stopExtensionHosts(): void {
		let previouslyActivatedExtensionIds: ExtensionIdentifier[] = [];
		this._extensionHostActiveExtensions.forEach((value) => {
			previouslyActivatedExtensionIds.push(value);
		});

		for (const manager of this._extensionHostManagers) {
			manager.dispose();
		}
		this._extensionHostManagers = [];
		this._extensionHostActiveExtensions = new Map<string, ExtensionIdentifier>();
		this._extensionHostActivationTimes = new Map<string, ActivationTimes>();
		this._extensionHostExtensionRuntimeErrors = new Map<string, Error[]>();

		if (previouslyActivatedExtensionIds.length > 0) {
			this._onDidChangeExtensionsStatus.fire(previouslyActivatedExtensionIds);
		}
	}

	private _startExtensionHosts(isInitialStart: boolean, initialActivationEvents: string[]): void {
		const extensionHosts = this._createExtensionHosts(isInitialStart);
		extensionHosts.forEach((extensionHost) => {
			const processManager = this._instantiationService.createInstance(ExtensionHostManager, extensionHost, initialActivationEvents);
			processManager.onDidExit(([code, signal]) => this._onExtensionHostCrashOrExit(processManager, code, signal));
			processManager.onDidChangeResponsiveState((responsiveState) => { this._onDidChangeResponsiveChange.fire({ isResponsive: responsiveState === ResponsiveState.Responsive }); });
			this._extensionHostManagers.push(processManager);
		});
	}

	private _onExtensionHostCrashOrExit(extensionHost: ExtensionHostManager, code: number, signal: string | null): void {

		// Unexpected termination
		if (!this._isExtensionDevHost) {
			this._onExtensionHostCrashed(extensionHost, code, signal);
			return;
		}

		this._onExtensionHostExit(code);
	}

	protected _onExtensionHostCrashed(extensionHost: ExtensionHostManager, code: number, signal: string | null): void {
		console.error('Extension host terminated unexpectedly. Code: ', code, ' Signal: ', signal);
		if (extensionHost.kind === ExtensionHostKind.LocalProcess) {
			this.stopExtensionHosts();
		} else if (extensionHost.kind === ExtensionHostKind.Remote) {
			for (let i = 0; i < this._extensionHostManagers.length; i++) {
				if (this._extensionHostManagers[i] === extensionHost) {
					this._extensionHostManagers[i].dispose();
					this._extensionHostManagers.splice(i, 1);
					break;
				}
			}
		}
	}

	public async startExtensionHosts(): Promise<void> {
		this.stopExtensionHosts();

		if (this._inHandleDeltaExtensions) {
			await Event.toPromise(this._onDidFinishHandleDeltaExtensions.event);
		}

		this._startExtensionHosts(false, Array.from(this._allRequestedActivateEvents.keys()));
	}

	public async restartExtensionHost(): Promise<void> {
		this.stopExtensionHosts();
		await this.startExtensionHosts();
	}

	//#endregion

	//#region IExtensionService

	public activateByEvent(activationEvent: string, activationKind: ActivationKind = ActivationKind.Normal): Promise<void> {
		if (this._installedExtensionsReady.isOpen()) {
			// Extensions have been scanned and interpreted

			// Record the fact that this activationEvent was requested (in case of a restart)
			this._allRequestedActivateEvents.add(activationEvent);

			if (!this._registry.containsActivationEvent(activationEvent)) {
				// There is no extension that is interested in this activation event
				return NO_OP_VOID_PROMISE;
			}

			return this._activateByEvent(activationEvent, activationKind);
		} else {
			// Extensions have not been scanned yet.

			// Record the fact that this activationEvent was requested (in case of a restart)
			this._allRequestedActivateEvents.add(activationEvent);

			if (activationKind === ActivationKind.Immediate) {
				// Do not wait for the normal start-up of the extension host(s)
				return this._activateByEvent(activationEvent, activationKind);
			}

			return this._installedExtensionsReady.wait().then(() => this._activateByEvent(activationEvent, activationKind));
		}
	}

	private _activateByEvent(activationEvent: string, activationKind: ActivationKind): Promise<void> {
		const result = Promise.all(
			this._extensionHostManagers.map(extHostManager => extHostManager.activateByEvent(activationEvent, activationKind))
		).then(() => { });
		this._onWillActivateByEvent.fire({
			event: activationEvent,
			activation: result
		});
		return result;
	}

	public whenInstalledExtensionsRegistered(): Promise<boolean> {
		return this._installedExtensionsReady.wait();
	}

	public getExtensions(): Promise<IExtensionDescription[]> {
		return this._installedExtensionsReady.wait().then(() => {
			return this._registry.getAllExtensionDescriptions();
		});
	}

	public getExtension(id: string): Promise<IExtensionDescription | undefined> {
		return this._installedExtensionsReady.wait().then(() => {
			return this._registry.getExtensionDescription(id);
		});
	}

	public readExtensionPointContributions<T extends IExtensionContributions[keyof IExtensionContributions]>(extPoint: IExtensionPoint<T>): Promise<ExtensionPointContribution<T>[]> {
		return this._installedExtensionsReady.wait().then(() => {
			const availableExtensions = this._registry.getAllExtensionDescriptions();

			const result: ExtensionPointContribution<T>[] = [];
			for (const desc of availableExtensions) {
				if (desc.contributes && hasOwnProperty.call(desc.contributes, extPoint.name)) {
					result.push(new ExtensionPointContribution<T>(desc, desc.contributes[extPoint.name as keyof typeof desc.contributes] as T));
				}
			}

			return result;
		});
	}

	public getExtensionsStatus(): { [id: string]: IExtensionsStatus; } {
		let result: { [id: string]: IExtensionsStatus; } = Object.create(null);
		if (this._registry) {
			const extensions = this._registry.getAllExtensionDescriptions();
			for (const extension of extensions) {
				const extensionKey = ExtensionIdentifier.toKey(extension.identifier);
				result[extension.identifier.value] = {
					messages: this._extensionsMessages.get(extensionKey) || [],
					activationTimes: this._extensionHostActivationTimes.get(extensionKey),
					runtimeErrors: this._extensionHostExtensionRuntimeErrors.get(extensionKey) || [],
				};
			}
		}
		return result;
	}

	public getInspectPort(_tryEnableInspector: boolean): Promise<number> {
		return Promise.resolve(0);
	}

	public async setRemoteEnvironment(env: { [key: string]: string | null }): Promise<void> {
		await this._extensionHostManagers
			.map(manager => manager.setRemoteEnvironment(env));
	}

	//#endregion

	// --- impl

	protected _checkEnableProposedApi(extensions: IExtensionDescription[]): void {
		for (let extension of extensions) {
			this._proposedApiController.updateEnableProposedApi(extension);
		}
	}

	protected _checkEnabledAndProposedAPI(extensions: IExtensionDescription[]): IExtensionDescription[] {
		// enable or disable proposed API per extension
		this._checkEnableProposedApi(extensions);

		// keep only enabled extensions
		return extensions.filter(extension => this._isEnabled(extension));
	}

	protected _isEnabled(extension: IExtensionDescription): boolean {
		if (extension.isUnderDevelopment) {
			// Never disable extensions under development
			return true;
		}

		if (ExtensionIdentifier.equals(extension.identifier, BetterMergeId)) {
			// Check if this is the better merge extension which was migrated to a built-in extension
			return false;
		}

		return this._safeInvokeIsEnabled(toExtension(extension));
	}

	protected _safeInvokeIsEnabled(extension: IExtension): boolean {
		try {
			return this._extensionEnablementService.isEnabled(extension);
		} catch (err) {
			return false;
		}
	}

	protected _doHandleExtensionPoints(affectedExtensions: IExtensionDescription[]): void {
		const affectedExtensionPoints: { [extPointName: string]: boolean; } = Object.create(null);
		for (let extensionDescription of affectedExtensions) {
			if (extensionDescription.contributes) {
				for (let extPointName in extensionDescription.contributes) {
					if (hasOwnProperty.call(extensionDescription.contributes, extPointName)) {
						affectedExtensionPoints[extPointName] = true;
					}
				}
			}
		}

		const messageHandler = (msg: IMessage) => this._handleExtensionPointMessage(msg);
		const availableExtensions = this._registry.getAllExtensionDescriptions();
		const extensionPoints = ExtensionsRegistry.getExtensionPoints();
		perf.mark('code/willHandleExtensionPoints');
		for (const extensionPoint of extensionPoints) {
			if (affectedExtensionPoints[extensionPoint.name]) {
				AbstractExtensionService._handleExtensionPoint(extensionPoint, availableExtensions, messageHandler);
			}
		}
		perf.mark('code/didHandleExtensionPoints');
	}

	private _handleExtensionPointMessage(msg: IMessage) {
		const extensionKey = ExtensionIdentifier.toKey(msg.extensionId);

		if (!this._extensionsMessages.has(extensionKey)) {
			this._extensionsMessages.set(extensionKey, []);
		}
		this._extensionsMessages.get(extensionKey)!.push(msg);

		const extension = this._registry.getExtensionDescription(msg.extensionId);
		const strMsg = `[${msg.extensionId.value}]: ${msg.message}`;
		if (extension && extension.isUnderDevelopment) {
			// This message is about the extension currently being developed
			this._showMessageToUser(msg.type, strMsg);
		} else {
			this._logMessageInConsole(msg.type, strMsg);
		}

		if (!this._isDev && msg.extensionId) {
			const { type, extensionId, extensionPointId, message } = msg;
			type ExtensionsMessageClassification = {
				type: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
				extensionId: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				extensionPointId: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				message: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
			};
			type ExtensionsMessageEvent = {
				type: Severity;
				extensionId: string;
				extensionPointId: string;
				message: string;
			};
			this._telemetryService.publicLog2<ExtensionsMessageEvent, ExtensionsMessageClassification>('extensionsMessage', {
				type, extensionId: extensionId.value, extensionPointId, message
			});
		}
	}

	private static _handleExtensionPoint<T extends IExtensionContributions[keyof IExtensionContributions]>(extensionPoint: ExtensionPoint<T>, availableExtensions: IExtensionDescription[], messageHandler: (msg: IMessage) => void): void {
		const users: IExtensionPointUser<T>[] = [];
		for (const desc of availableExtensions) {
			if (desc.contributes && hasOwnProperty.call(desc.contributes, extensionPoint.name)) {
				users.push({
					description: desc,
					value: desc.contributes[extensionPoint.name as keyof typeof desc.contributes] as T,
					collector: new ExtensionMessageCollector(messageHandler, desc, extensionPoint.name)
				});
			}
		}
		extensionPoint.acceptUsers(users);
	}

	private _showMessageToUser(severity: Severity, msg: string): void {
		if (severity === Severity.Error || severity === Severity.Warning) {
			this._notificationService.notify({ severity, message: msg });
		} else {
			this._logMessageInConsole(severity, msg);
		}
	}

	private _logMessageInConsole(severity: Severity, msg: string): void {
		if (severity === Severity.Error) {
			console.error(msg);
		} else if (severity === Severity.Warning) {
			console.warn(msg);
		} else {
			console.log(msg);
		}
	}

	//#region Called by extension host

	protected _logOrShowMessage(severity: Severity, msg: string): void {
		if (this._isDev) {
			this._showMessageToUser(severity, msg);
		} else {
			this._logMessageInConsole(severity, msg);
		}
	}

	public async _activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> {
		const results = await Promise.all(
			this._extensionHostManagers.map(manager => manager.activate(extensionId, reason))
		);
		const activated = results.some(e => e);
		if (!activated) {
			throw new Error(`Unknown extension ${extensionId.value}`);
		}
	}

	public _onWillActivateExtension(extensionId: ExtensionIdentifier): void {
		this._extensionHostActiveExtensions.set(ExtensionIdentifier.toKey(extensionId), extensionId);
	}

	public _onDidActivateExtension(extensionId: ExtensionIdentifier, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number, activationReason: ExtensionActivationReason): void {
		this._extensionHostActivationTimes.set(ExtensionIdentifier.toKey(extensionId), new ActivationTimes(codeLoadingTime, activateCallTime, activateResolvedTime, activationReason));
		this._onDidChangeExtensionsStatus.fire([extensionId]);
	}

	public _onDidActivateExtensionError(extensionId: ExtensionIdentifier, error: Error): void {
		type ExtensionActivationErrorClassification = {
			extensionId: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
			error: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
		};
		type ExtensionActivationErrorEvent = {
			extensionId: string;
			error: string;
		};
		this._telemetryService.publicLog2<ExtensionActivationErrorEvent, ExtensionActivationErrorClassification>('extensionActivationError', {
			extensionId: extensionId.value,
			error: error.message
		});
	}

	public _onExtensionRuntimeError(extensionId: ExtensionIdentifier, err: Error): void {
		const extensionKey = ExtensionIdentifier.toKey(extensionId);
		if (!this._extensionHostExtensionRuntimeErrors.has(extensionKey)) {
			this._extensionHostExtensionRuntimeErrors.set(extensionKey, []);
		}
		this._extensionHostExtensionRuntimeErrors.get(extensionKey)!.push(err);
		this._onDidChangeExtensionsStatus.fire([extensionId]);
	}

	//#endregion

	protected abstract _createExtensionHosts(isInitialStart: boolean): IExtensionHost[];
	protected abstract _scanAndHandleExtensions(): Promise<void>;
	protected abstract _scanSingleExtension(extension: IExtension): Promise<IExtensionDescription | null>;
	public abstract _onExtensionHostExit(code: number): void;
}

export class ExtensionRunningLocationClassifier {
	constructor(
		public readonly getExtensionKind: (extensionDescription: IExtensionDescription) => ExtensionKind[],
		public readonly pickRunningLocation: (extensionKinds: ExtensionKind[], isInstalledLocally: boolean, isInstalledRemotely: boolean, preference: ExtensionRunningPreference) => ExtensionRunningLocation,
	) {
	}

	public determineRunningLocation(localExtensions: IExtensionDescription[], remoteExtensions: IExtensionDescription[]): Map<string, ExtensionRunningLocation> {
		const allExtensionKinds = new Map<string, ExtensionKind[]>();
		localExtensions.forEach(ext => allExtensionKinds.set(ExtensionIdentifier.toKey(ext.identifier), this.getExtensionKind(ext)));
		remoteExtensions.forEach(ext => allExtensionKinds.set(ExtensionIdentifier.toKey(ext.identifier), this.getExtensionKind(ext)));

		const localExtensionsSet = new Set<string>();
		localExtensions.forEach(ext => localExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier)));

		const localUnderDevelopmentExtensionsSet = new Set<string>();
		localExtensions.forEach((ext) => {
			if (ext.isUnderDevelopment) {
				localUnderDevelopmentExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier));
			}
		});

		const remoteExtensionsSet = new Set<string>();
		remoteExtensions.forEach(ext => remoteExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier)));

		const remoteUnderDevelopmentExtensionsSet = new Set<string>();
		remoteExtensions.forEach((ext) => {
			if (ext.isUnderDevelopment) {
				remoteUnderDevelopmentExtensionsSet.add(ExtensionIdentifier.toKey(ext.identifier));
			}
		});

		const pickRunningLocation = (extensionIdentifier: ExtensionIdentifier): ExtensionRunningLocation => {
			const isInstalledLocally = localExtensionsSet.has(ExtensionIdentifier.toKey(extensionIdentifier));
			const isInstalledRemotely = remoteExtensionsSet.has(ExtensionIdentifier.toKey(extensionIdentifier));

			const isLocallyUnderDevelopment = localUnderDevelopmentExtensionsSet.has(ExtensionIdentifier.toKey(extensionIdentifier));
			const isRemotelyUnderDevelopment = remoteUnderDevelopmentExtensionsSet.has(ExtensionIdentifier.toKey(extensionIdentifier));

			let preference = ExtensionRunningPreference.None;
			if (isLocallyUnderDevelopment && !isRemotelyUnderDevelopment) {
				preference = ExtensionRunningPreference.Local;
			} else if (isRemotelyUnderDevelopment && !isLocallyUnderDevelopment) {
				preference = ExtensionRunningPreference.Remote;
			}

			const extensionKinds = allExtensionKinds.get(ExtensionIdentifier.toKey(extensionIdentifier)) || [];
			return this.pickRunningLocation(extensionKinds, isInstalledLocally, isInstalledRemotely, preference);
		};

		const runningLocation = new Map<string, ExtensionRunningLocation>();
		localExtensions.forEach(ext => runningLocation.set(ExtensionIdentifier.toKey(ext.identifier), pickRunningLocation(ext.identifier)));
		remoteExtensions.forEach(ext => runningLocation.set(ExtensionIdentifier.toKey(ext.identifier), pickRunningLocation(ext.identifier)));
		return runningLocation;
	}
}

class ProposedApiController {

	private readonly enableProposedApiFor: string[];
	private readonly enableProposedApiForAll: boolean;
	private readonly productAllowProposedApi: Set<string>;

	constructor(
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService
	) {
		// Make enabled proposed API be lowercase for case insensitive comparison
		this.enableProposedApiFor = (_environmentService.extensionEnabledProposedApi || []).map(id => id.toLowerCase());

		this.enableProposedApiForAll =
			!_environmentService.isBuilt || // always allow proposed API when running out of sources
			(_environmentService.isExtensionDevelopment && productService.quality !== 'stable') || // do not allow proposed API against stable builds when developing an extension
			(this.enableProposedApiFor.length === 0 && Array.isArray(_environmentService.extensionEnabledProposedApi)); // always allow proposed API if --enable-proposed-api is provided without extension ID

		this.productAllowProposedApi = new Set<string>();
		if (isNonEmptyArray(productService.extensionAllowedProposedApi)) {
			productService.extensionAllowedProposedApi.forEach((id) => this.productAllowProposedApi.add(ExtensionIdentifier.toKey(id)));
		}
	}

	public updateEnableProposedApi(extension: IExtensionDescription): void {
		if (this._allowProposedApiFromProduct(extension.identifier)) {
			// fast lane -> proposed api is available to all extensions
			// that are listed in product.json-files
			extension.enableProposedApi = true;

		} else if (extension.enableProposedApi && !extension.isBuiltin) {
			if (
				!this.enableProposedApiForAll &&
				this.enableProposedApiFor.indexOf(extension.identifier.value.toLowerCase()) < 0
			) {
				extension.enableProposedApi = false;
				console.error(`Extension '${extension.identifier.value} cannot use PROPOSED API (must started out of dev or enabled via --enable-proposed-api)`);

			} else if (this._environmentService.isBuilt) {
				// proposed api is available when developing or when an extension was explicitly
				// spelled out via a command line argument
				console.warn(`Extension '${extension.identifier.value}' uses PROPOSED API which is subject to change and removal without notice.`);
			}
		}
	}

	private _allowProposedApiFromProduct(id: ExtensionIdentifier): boolean {
		return this.productAllowProposedApi.has(ExtensionIdentifier.toKey(id));
	}
}

function filterByRunningLocation<T>(extensions: T[], extId: (item: T) => ExtensionIdentifier, runningLocation: Map<string, ExtensionRunningLocation>, desiredRunningLocation: ExtensionRunningLocation): T[] {
	return extensions.filter(ext => runningLocation.get(ExtensionIdentifier.toKey(extId(ext))) === desiredRunningLocation);
}
