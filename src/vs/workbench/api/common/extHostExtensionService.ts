/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as path from 'vs/base/common/path';
import * as performance from 'vs/base/common/performance';
import { originalFSPath, joinPath } from 'vs/base/common/resources';
import { Barrier, timeout } from 'vs/base/common/async';
import { dispose, toDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { TernarySearchTree } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtHostExtensionServiceShape, IInitData, MainContext, MainThreadExtensionServiceShape, MainThreadTelemetryShape, MainThreadWorkspaceShape, IResolveAuthorityResult } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostConfiguration, IExtHostConfiguration } from 'vs/workbench/api/common/extHostConfiguration';
import { ActivatedExtension, EmptyExtension, ExtensionActivationReason, ExtensionActivationTimes, ExtensionActivationTimesBuilder, ExtensionsActivator, IExtensionAPI, IExtensionModule, HostExtension, ExtensionActivationTimesFragment } from 'vs/workbench/api/common/extHostExtensionActivator';
import { ExtHostStorage, IExtHostStorage } from 'vs/workbench/api/common/extHostStorage';
import { ExtHostWorkspace, IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { MissingExtensionDependency, checkProposedApiEnabled, ActivationKind } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import * as errors from 'vs/base/common/errors';
import type * as vscode from 'vscode';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { VSBuffer } from 'vs/base/common/buffer';
import { ExtensionGlobalMemento, ExtensionMemento } from 'vs/workbench/api/common/extHostMemento';
import { RemoteAuthorityResolverError, ExtensionKind, ExtensionMode, ExtensionRuntime } from 'vs/workbench/api/common/extHostTypes';
import { ResolvedAuthority, ResolvedOptions, RemoteAuthorityResolverErrorCode, IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IInstantiationService, createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IExtHostTunnelService } from 'vs/workbench/api/common/extHostTunnelService';
import { IExtHostTerminalService } from 'vs/workbench/api/common/extHostTerminalService';
import { Emitter, Event } from 'vs/base/common/event';
import { IExtensionActivationHost, checkActivateWorkspaceContainsExtension } from 'vs/workbench/api/common/shared/workspaceContains';
import { ExtHostSecretState, IExtHostSecretState } from 'vs/workbench/api/common/exHostSecretState';
import { ExtensionSecrets } from 'vs/workbench/api/common/extHostSecrets';

interface ITestRunner {
	/** Old test runner API, as exported from `vscode/lib/testrunner` */
	run(testsRoot: string, clb: (error: Error, failures?: number) => void): void;
}

interface INewTestRunner {
	/** New test runner API, as explained in the extension test doc */
	run(): Promise<void>;
}

export const IHostUtils = createDecorator<IHostUtils>('IHostUtils');

export interface IHostUtils {
	readonly _serviceBrand: undefined;
	exit(code: number): void;
	exists(path: string): Promise<boolean>;
	realpath(path: string): Promise<string>;
}

type TelemetryActivationEventFragment = {
	id: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
	name: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
	extensionVersion: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
	publisherDisplayName: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	activationEvents: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	isBuiltin: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	reason: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	reasonId: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

export abstract class AbstractExtHostExtensionService extends Disposable implements ExtHostExtensionServiceShape {

	readonly _serviceBrand: undefined;

	abstract readonly extensionRuntime: ExtensionRuntime;

	private readonly _onDidChangeRemoteConnectionData = this._register(new Emitter<void>());
	public readonly onDidChangeRemoteConnectionData = this._onDidChangeRemoteConnectionData.event;

	protected readonly _hostUtils: IHostUtils;
	protected readonly _initData: IInitData;
	protected readonly _extHostContext: IExtHostRpcService;
	protected readonly _instaService: IInstantiationService;
	protected readonly _extHostWorkspace: ExtHostWorkspace;
	protected readonly _extHostConfiguration: ExtHostConfiguration;
	protected readonly _logService: ILogService;
	protected readonly _extHostTunnelService: IExtHostTunnelService;
	protected readonly _extHostTerminalService: IExtHostTerminalService;

	protected readonly _mainThreadWorkspaceProxy: MainThreadWorkspaceShape;
	protected readonly _mainThreadTelemetryProxy: MainThreadTelemetryShape;
	protected readonly _mainThreadExtensionsProxy: MainThreadExtensionServiceShape;

	private readonly _almostReadyToRunExtensions: Barrier;
	private readonly _readyToStartExtensionHost: Barrier;
	private readonly _readyToRunExtensions: Barrier;
	private readonly _eagerExtensionsActivated: Barrier;

	protected readonly _registry: ExtensionDescriptionRegistry;
	private readonly _storage: ExtHostStorage;
	private readonly _secretState: ExtHostSecretState;
	private readonly _storagePath: IExtensionStoragePaths;
	private readonly _activator: ExtensionsActivator;
	private _extensionPathIndex: Promise<TernarySearchTree<string, IExtensionDescription>> | null;

	private readonly _resolvers: { [authorityPrefix: string]: vscode.RemoteAuthorityResolver; };

	private _started: boolean;
	private _remoteConnectionData: IRemoteConnectionData | null;

	private readonly _disposables: DisposableStore;

	constructor(
		@IInstantiationService instaService: IInstantiationService,
		@IHostUtils hostUtils: IHostUtils,
		@IExtHostRpcService extHostContext: IExtHostRpcService,
		@IExtHostWorkspace extHostWorkspace: IExtHostWorkspace,
		@IExtHostConfiguration extHostConfiguration: IExtHostConfiguration,
		@ILogService logService: ILogService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtensionStoragePaths storagePath: IExtensionStoragePaths,
		@IExtHostTunnelService extHostTunnelService: IExtHostTunnelService,
		@IExtHostTerminalService extHostTerminalService: IExtHostTerminalService,
	) {
		super();
		this._hostUtils = hostUtils;
		this._extHostContext = extHostContext;
		this._initData = initData;

		this._extHostWorkspace = extHostWorkspace;
		this._extHostConfiguration = extHostConfiguration;
		this._logService = logService;
		this._extHostTunnelService = extHostTunnelService;
		this._extHostTerminalService = extHostTerminalService;
		this._disposables = new DisposableStore();

		this._mainThreadWorkspaceProxy = this._extHostContext.getProxy(MainContext.MainThreadWorkspace);
		this._mainThreadTelemetryProxy = this._extHostContext.getProxy(MainContext.MainThreadTelemetry);
		this._mainThreadExtensionsProxy = this._extHostContext.getProxy(MainContext.MainThreadExtensionService);

		this._almostReadyToRunExtensions = new Barrier();
		this._readyToStartExtensionHost = new Barrier();
		this._readyToRunExtensions = new Barrier();
		this._eagerExtensionsActivated = new Barrier();
		this._registry = new ExtensionDescriptionRegistry(this._initData.extensions);
		this._storage = new ExtHostStorage(this._extHostContext);
		this._secretState = new ExtHostSecretState(this._extHostContext);
		this._storagePath = storagePath;

		this._instaService = instaService.createChild(new ServiceCollection(
			[IExtHostStorage, this._storage],
			[IExtHostSecretState, this._secretState]
		));

		const hostExtensions = new Set<string>();
		this._initData.hostExtensions.forEach((extensionId) => hostExtensions.add(ExtensionIdentifier.toKey(extensionId)));

		this._activator = new ExtensionsActivator(
			this._registry,
			this._initData.resolvedExtensions,
			this._initData.hostExtensions,
			{
				onExtensionActivationError: (extensionId: ExtensionIdentifier, error: Error, missingExtensionDependency: MissingExtensionDependency | null): void => {
					this._mainThreadExtensionsProxy.$onExtensionActivationError(extensionId, errors.transformErrorForSerialization(error), missingExtensionDependency);
				},

				actualActivateExtension: async (extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<ActivatedExtension> => {
					if (hostExtensions.has(ExtensionIdentifier.toKey(extensionId))) {
						await this._mainThreadExtensionsProxy.$activateExtension(extensionId, reason);
						return new HostExtension();
					}
					const extensionDescription = this._registry.getExtensionDescription(extensionId)!;
					return this._activateExtension(extensionDescription, reason);
				}
			},
			this._logService
		);
		this._extensionPathIndex = null;
		this._resolvers = Object.create(null);
		this._started = false;
		this._remoteConnectionData = this._initData.remote.connectionData;
	}

	public getRemoteConnectionData(): IRemoteConnectionData | null {
		return this._remoteConnectionData;
	}

	public async initialize(): Promise<void> {
		try {

			await this._beforeAlmostReadyToRunExtensions();
			this._almostReadyToRunExtensions.open();

			await this._extHostWorkspace.waitForInitializeCall();
			performance.mark('code/extHost/ready');
			this._readyToStartExtensionHost.open();

			if (this._initData.autoStart) {
				this._startExtensionHost();
			}
		} catch (err) {
			errors.onUnexpectedError(err);
		}
	}

	public async deactivateAll(): Promise<void> {
		let allPromises: Promise<void>[] = [];
		try {
			const allExtensions = this._registry.getAllExtensionDescriptions();
			const allExtensionsIds = allExtensions.map(ext => ext.identifier);
			const activatedExtensions = allExtensionsIds.filter(id => this.isActivated(id));

			allPromises = activatedExtensions.map((extensionId) => {
				return this._deactivate(extensionId);
			});
		} catch (err) {
			// TODO: write to log once we have one
		}
		await Promise.all(allPromises);
	}

	public isActivated(extensionId: ExtensionIdentifier): boolean {
		if (this._readyToRunExtensions.isOpen()) {
			return this._activator.isActivated(extensionId);
		}
		return false;
	}

	private _activateByEvent(activationEvent: string, startup: boolean): Promise<void> {
		return this._activator.activateByEvent(activationEvent, startup);
	}

	private _activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> {
		return this._activator.activateById(extensionId, reason);
	}

	public activateByIdWithErrors(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> {
		return this._activateById(extensionId, reason).then(() => {
			const extension = this._activator.getActivatedExtension(extensionId);
			if (extension.activationFailed) {
				// activation failed => bubble up the error as the promise result
				return Promise.reject(extension.activationFailedError);
			}
			return undefined;
		});
	}

	public getExtensionRegistry(): Promise<ExtensionDescriptionRegistry> {
		return this._readyToRunExtensions.wait().then(_ => this._registry);
	}

	public getExtensionExports(extensionId: ExtensionIdentifier): IExtensionAPI | null | undefined {
		if (this._readyToRunExtensions.isOpen()) {
			return this._activator.getActivatedExtension(extensionId).exports;
		} else {
			return null;
		}
	}

	// create trie to enable fast 'filename -> extension id' look up
	public getExtensionPathIndex(): Promise<TernarySearchTree<string, IExtensionDescription>> {
		if (!this._extensionPathIndex) {
			const tree = TernarySearchTree.forPaths<IExtensionDescription>();
			const extensions = this._registry.getAllExtensionDescriptions().map(ext => {
				if (!this._getEntryPoint(ext)) {
					return undefined;
				}
				return this._hostUtils.realpath(ext.extensionLocation.fsPath).then(value => tree.set(URI.file(value).fsPath, ext));
			});
			this._extensionPathIndex = Promise.all(extensions).then(() => tree);
		}
		return this._extensionPathIndex;
	}

	private _deactivate(extensionId: ExtensionIdentifier): Promise<void> {
		let result = Promise.resolve(undefined);

		if (!this._readyToRunExtensions.isOpen()) {
			return result;
		}

		if (!this._activator.isActivated(extensionId)) {
			return result;
		}

		const extension = this._activator.getActivatedExtension(extensionId);
		if (!extension) {
			return result;
		}

		// call deactivate if available
		try {
			if (typeof extension.module.deactivate === 'function') {
				result = Promise.resolve(extension.module.deactivate()).then(undefined, (err) => {
					// TODO: Do something with err if this is not the shutdown case
					return Promise.resolve(undefined);
				});
			}
		} catch (err) {
			// TODO: Do something with err if this is not the shutdown case
		}

		// clean up subscriptions
		try {
			dispose(extension.subscriptions);
		} catch (err) {
			// TODO: Do something with err if this is not the shutdown case
		}

		return result;
	}

	// --- impl

	private async _activateExtension(extensionDescription: IExtensionDescription, reason: ExtensionActivationReason): Promise<ActivatedExtension> {
		if (!this._initData.remote.isRemote) {
			// local extension host process
			await this._mainThreadExtensionsProxy.$onWillActivateExtension(extensionDescription.identifier);
		} else {
			// remote extension host process
			// do not wait for renderer confirmation
			this._mainThreadExtensionsProxy.$onWillActivateExtension(extensionDescription.identifier);
		}
		return this._doActivateExtension(extensionDescription, reason).then((activatedExtension) => {
			const activationTimes = activatedExtension.activationTimes;
			this._mainThreadExtensionsProxy.$onDidActivateExtension(extensionDescription.identifier, activationTimes.codeLoadingTime, activationTimes.activateCallTime, activationTimes.activateResolvedTime, reason);
			this._logExtensionActivationTimes(extensionDescription, reason, 'success', activationTimes);
			return activatedExtension;
		}, (err) => {
			this._logExtensionActivationTimes(extensionDescription, reason, 'failure');
			throw err;
		});
	}

	private _logExtensionActivationTimes(extensionDescription: IExtensionDescription, reason: ExtensionActivationReason, outcome: string, activationTimes?: ExtensionActivationTimes) {
		const event = getTelemetryActivationEvent(extensionDescription, reason);
		type ExtensionActivationTimesClassification = {
			outcome: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
		} & TelemetryActivationEventFragment & ExtensionActivationTimesFragment;

		type ExtensionActivationTimesEvent = {
			outcome: string
		} & ActivationTimesEvent & TelemetryActivationEvent;

		type ActivationTimesEvent = {
			startup?: boolean;
			codeLoadingTime?: number;
			activateCallTime?: number;
			activateResolvedTime?: number;
		};

		this._mainThreadTelemetryProxy.$publicLog2<ExtensionActivationTimesEvent, ExtensionActivationTimesClassification>('extensionActivationTimes', {
			...event,
			...(activationTimes || {}),
			outcome
		});
	}

	private _doActivateExtension(extensionDescription: IExtensionDescription, reason: ExtensionActivationReason): Promise<ActivatedExtension> {
		const event = getTelemetryActivationEvent(extensionDescription, reason);
		type ActivatePluginClassification = {} & TelemetryActivationEventFragment;
		this._mainThreadTelemetryProxy.$publicLog2<TelemetryActivationEvent, ActivatePluginClassification>('activatePlugin', event);
		const entryPoint = this._getEntryPoint(extensionDescription);
		if (!entryPoint) {
			// Treat the extension as being empty => NOT AN ERROR CASE
			return Promise.resolve(new EmptyExtension(ExtensionActivationTimes.NONE));
		}

		this._logService.info(`ExtensionService#_doActivateExtension ${extensionDescription.identifier.value} ${JSON.stringify(reason)}`);
		this._logService.flush();

		const activationTimesBuilder = new ExtensionActivationTimesBuilder(reason.startup);
		return Promise.all([
			this._loadCommonJSModule<IExtensionModule>(extensionDescription.identifier, joinPath(extensionDescription.extensionLocation, entryPoint), activationTimesBuilder),
			this._loadExtensionContext(extensionDescription)
		]).then(values => {
			performance.mark(`code/extHost/willActivateExtension/${extensionDescription.identifier.value}`);
			return AbstractExtHostExtensionService._callActivate(this._logService, extensionDescription.identifier, values[0], values[1], activationTimesBuilder);
		}).then((activatedExtension) => {
			performance.mark(`code/extHost/didActivateExtension/${extensionDescription.identifier.value}`);
			return activatedExtension;
		});
	}

	private _loadExtensionContext(extensionDescription: IExtensionDescription): Promise<vscode.ExtensionContext> {

		const globalState = new ExtensionGlobalMemento(extensionDescription, this._storage);
		const workspaceState = new ExtensionMemento(extensionDescription.identifier.value, false, this._storage);
		const secrets = new ExtensionSecrets(extensionDescription, this._secretState);
		const extensionMode = extensionDescription.isUnderDevelopment
			? (this._initData.environment.extensionTestsLocationURI ? ExtensionMode.Test : ExtensionMode.Development)
			: ExtensionMode.Production;
		const extensionKind = this._initData.remote.isRemote ? ExtensionKind.Workspace : ExtensionKind.UI;

		this._logService.trace(`ExtensionService#loadExtensionContext ${extensionDescription.identifier.value}`);

		return Promise.all([
			globalState.whenReady,
			workspaceState.whenReady,
			this._storagePath.whenReady
		]).then(() => {
			const that = this;
			let extension: vscode.Extension<any> | undefined;

			return Object.freeze<vscode.ExtensionContext>({
				globalState,
				workspaceState,
				secrets,
				subscriptions: [],
				get extensionUri() { return extensionDescription.extensionLocation; },
				get extensionPath() { return extensionDescription.extensionLocation.fsPath; },
				asAbsolutePath(relativePath: string) { return path.join(extensionDescription.extensionLocation.fsPath, relativePath); },
				get storagePath() { return that._storagePath.workspaceValue(extensionDescription)?.fsPath; },
				get globalStoragePath() { return that._storagePath.globalValue(extensionDescription).fsPath; },
				get logPath() { return path.join(that._initData.logsLocation.fsPath, extensionDescription.identifier.value); },
				get logUri() { return URI.joinPath(that._initData.logsLocation, extensionDescription.identifier.value); },
				get storageUri() { return that._storagePath.workspaceValue(extensionDescription); },
				get globalStorageUri() { return that._storagePath.globalValue(extensionDescription); },
				get extensionMode() { return extensionMode; },
				get extension() {
					if (extension === undefined) {
						extension = new Extension(that, extensionDescription.identifier, extensionDescription, extensionKind);
					}
					return extension;
				},
				get extensionRuntime() {
					checkProposedApiEnabled(extensionDescription);
					return that.extensionRuntime;
				},
				get environmentVariableCollection() { return that._extHostTerminalService.getEnvironmentVariableCollection(extensionDescription); }
			});
		});
	}

	private static _callActivate(logService: ILogService, extensionId: ExtensionIdentifier, extensionModule: IExtensionModule, context: vscode.ExtensionContext, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<ActivatedExtension> {
		// Make sure the extension's surface is not undefined
		extensionModule = extensionModule || {
			activate: undefined,
			deactivate: undefined
		};

		return this._callActivateOptional(logService, extensionId, extensionModule, context, activationTimesBuilder).then((extensionExports) => {
			return new ActivatedExtension(false, null, activationTimesBuilder.build(), extensionModule, extensionExports, context.subscriptions);
		});
	}

	private static _callActivateOptional(logService: ILogService, extensionId: ExtensionIdentifier, extensionModule: IExtensionModule, context: vscode.ExtensionContext, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<IExtensionAPI> {
		if (typeof extensionModule.activate === 'function') {
			try {
				activationTimesBuilder.activateCallStart();
				logService.trace(`ExtensionService#_callActivateOptional ${extensionId.value}`);
				const scope = typeof global === 'object' ? global : self; // `global` is nodejs while `self` is for workers
				const activateResult: Promise<IExtensionAPI> = extensionModule.activate.apply(scope, [context]);
				activationTimesBuilder.activateCallStop();

				activationTimesBuilder.activateResolveStart();
				return Promise.resolve(activateResult).then((value) => {
					activationTimesBuilder.activateResolveStop();
					return value;
				});
			} catch (err) {
				return Promise.reject(err);
			}
		} else {
			// No activate found => the module is the extension's exports
			return Promise.resolve<IExtensionAPI>(extensionModule);
		}
	}

	// -- eager activation

	private _activateOneStartupFinished(desc: IExtensionDescription, activationEvent: string): void {
		this._activateById(desc.identifier, {
			startup: false,
			extensionId: desc.identifier,
			activationEvent: activationEvent
		}).then(undefined, (err) => {
			this._logService.error(err);
		});
	}

	private _activateAllStartupFinished(): void {
		// startup is considered finished
		this._mainThreadExtensionsProxy.$setPerformanceMarks(performance.getMarks());

		for (const desc of this._registry.getAllExtensionDescriptions()) {
			if (desc.activationEvents) {
				for (const activationEvent of desc.activationEvents) {
					if (activationEvent === 'onStartupFinished') {
						this._activateOneStartupFinished(desc, activationEvent);
					}
				}
			}
		}
	}

	// Handle "eager" activation extensions
	private _handleEagerExtensions(): Promise<void> {
		const starActivation = this._activateByEvent('*', true).then(undefined, (err) => {
			this._logService.error(err);
		});

		this._disposables.add(this._extHostWorkspace.onDidChangeWorkspace((e) => this._handleWorkspaceContainsEagerExtensions(e.added)));
		const folders = this._extHostWorkspace.workspace ? this._extHostWorkspace.workspace.folders : [];
		const workspaceContainsActivation = this._handleWorkspaceContainsEagerExtensions(folders);
		const eagerExtensionsActivation = Promise.all([starActivation, workspaceContainsActivation]).then(() => { });

		Promise.race([eagerExtensionsActivation, timeout(10000)]).then(() => {
			this._activateAllStartupFinished();
		});

		return eagerExtensionsActivation;
	}

	private _handleWorkspaceContainsEagerExtensions(folders: ReadonlyArray<vscode.WorkspaceFolder>): Promise<void> {
		if (folders.length === 0) {
			return Promise.resolve(undefined);
		}

		return Promise.all(
			this._registry.getAllExtensionDescriptions().map((desc) => {
				return this._handleWorkspaceContainsEagerExtension(folders, desc);
			})
		).then(() => { });
	}

	private async _handleWorkspaceContainsEagerExtension(folders: ReadonlyArray<vscode.WorkspaceFolder>, desc: IExtensionDescription): Promise<void> {
		if (this.isActivated(desc.identifier)) {
			return;
		}

		const localWithRemote = !this._initData.remote.isRemote && !!this._initData.remote.authority;
		const host: IExtensionActivationHost = {
			folders: folders.map(folder => folder.uri),
			forceUsingSearch: localWithRemote,
			exists: (uri) => this._hostUtils.exists(uri.fsPath),
			checkExists: (folders, includes, token) => this._mainThreadWorkspaceProxy.$checkExists(folders, includes, token)
		};

		const result = await checkActivateWorkspaceContainsExtension(host, desc);
		if (!result) {
			return;
		}

		return (
			this._activateById(desc.identifier, { startup: true, extensionId: desc.identifier, activationEvent: result.activationEvent })
				.then(undefined, err => this._logService.error(err))
		);
	}

	public async $extensionTestsExecute(): Promise<number> {
		await this._eagerExtensionsActivated.wait();
		try {
			return this._doHandleExtensionTests();
		} catch (error) {
			console.error(error); // ensure any error message makes it onto the console
			throw error;
		}
	}

	private async _doHandleExtensionTests(): Promise<number> {
		const { extensionDevelopmentLocationURI, extensionTestsLocationURI } = this._initData.environment;
		if (!extensionDevelopmentLocationURI || !extensionTestsLocationURI) {
			throw new Error(nls.localize('extensionTestError1', "Cannot load test runner."));
		}

		// Require the test runner via node require from the provided path
		const testRunner: ITestRunner | INewTestRunner | undefined = await this._loadCommonJSModule(null, extensionTestsLocationURI, new ExtensionActivationTimesBuilder(false));

		if (!testRunner || typeof testRunner.run !== 'function') {
			throw new Error(nls.localize('extensionTestError', "Path {0} does not point to a valid extension test runner.", extensionTestsLocationURI.toString()));
		}

		// Execute the runner if it follows the old `run` spec
		return new Promise<number>((resolve, reject) => {
			const oldTestRunnerCallback = (error: Error, failures: number | undefined) => {
				if (error) {
					reject(error);
				} else {
					resolve((typeof failures === 'number' && failures > 0) ? 1 /* ERROR */ : 0 /* OK */);
				}
			};

			const extensionTestsPath = originalFSPath(extensionTestsLocationURI); // for the old test runner API

			const runResult = testRunner.run(extensionTestsPath, oldTestRunnerCallback);

			// Using the new API `run(): Promise<void>`
			if (runResult && runResult.then) {
				runResult
					.then(() => {
						resolve(0);
					})
					.catch((err: Error) => {
						reject(err.toString());
					});
			}
		});
	}

	public async $extensionTestsExit(code: number): Promise<void> {
		this._logService.info(`extension host terminating: test runner requested exit with code ${code}`);
		this._logService.info(`exiting with code ${code}`);
		this._logService.flush();
		this._hostUtils.exit(code);
	}

	private _startExtensionHost(): Promise<void> {
		if (this._started) {
			throw new Error(`Extension host is already started!`);
		}
		this._started = true;

		return this._readyToStartExtensionHost.wait()
			.then(() => this._readyToRunExtensions.open())
			.then(() => this._handleEagerExtensions())
			.then(() => {
				this._eagerExtensionsActivated.open();
				this._logService.info(`eager extensions activated`);
			});
	}

	// -- called by extensions

	public registerRemoteAuthorityResolver(authorityPrefix: string, resolver: vscode.RemoteAuthorityResolver): vscode.Disposable {
		this._resolvers[authorityPrefix] = resolver;
		return toDisposable(() => {
			delete this._resolvers[authorityPrefix];
		});
	}

	// -- called by main thread

	public async $resolveAuthority(remoteAuthority: string, resolveAttempt: number): Promise<IResolveAuthorityResult> {
		const authorityPlusIndex = remoteAuthority.indexOf('+');
		if (authorityPlusIndex === -1) {
			throw new Error(`Not an authority that can be resolved!`);
		}
		const authorityPrefix = remoteAuthority.substr(0, authorityPlusIndex);

		await this._almostReadyToRunExtensions.wait();
		await this._activateByEvent(`onResolveRemoteAuthority:${authorityPrefix}`, false);

		const resolver = this._resolvers[authorityPrefix];
		if (!resolver) {
			return {
				type: 'error',
				error: {
					code: RemoteAuthorityResolverErrorCode.NoResolverFound,
					message: `No remote extension installed to resolve ${authorityPrefix}.`,
					detail: undefined
				}
			};
		}

		try {
			this._disposables.add(await this._extHostTunnelService.setTunnelExtensionFunctions(resolver));
			performance.mark(`code/extHost/willResolveAuthority/${authorityPrefix}`);
			const result = await resolver.resolve(remoteAuthority, { resolveAttempt });
			performance.mark(`code/extHost/didResolveAuthorityOK/${authorityPrefix}`);

			// Split merged API result into separate authority/options
			const authority: ResolvedAuthority = {
				authority: remoteAuthority,
				host: result.host,
				port: result.port,
				connectionToken: result.connectionToken
			};
			const options: ResolvedOptions = {
				extensionHostEnv: result.extensionHostEnv,
				trust: result.trust
			};

			return {
				type: 'ok',
				value: {
					authority,
					options,
					tunnelInformation: { environmentTunnels: result.environmentTunnels }
				}
			};
		} catch (err) {
			performance.mark(`code/extHost/didResolveAuthorityError/${authorityPrefix}`);
			if (err instanceof RemoteAuthorityResolverError) {
				return {
					type: 'error',
					error: {
						code: err._code,
						message: err._message,
						detail: err._detail
					}
				};
			}
			throw err;
		}
	}

	public $startExtensionHost(enabledExtensionIds: ExtensionIdentifier[]): Promise<void> {
		this._registry.keepOnly(enabledExtensionIds);
		return this._startExtensionHost();
	}

	public $activateByEvent(activationEvent: string, activationKind: ActivationKind): Promise<void> {
		if (activationKind === ActivationKind.Immediate) {
			return this._activateByEvent(activationEvent, false);
		}

		return (
			this._readyToRunExtensions.wait()
				.then(_ => this._activateByEvent(activationEvent, false))
		);
	}

	public async $activate(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<boolean> {
		await this._readyToRunExtensions.wait();
		if (!this._registry.getExtensionDescription(extensionId)) {
			// unknown extension => ignore
			return false;
		}
		await this._activateById(extensionId, reason);
		return true;
	}

	public async $deltaExtensions(toAdd: IExtensionDescription[], toRemove: ExtensionIdentifier[]): Promise<void> {
		toAdd.forEach((extension) => (<any>extension).extensionLocation = URI.revive(extension.extensionLocation));

		const trie = await this.getExtensionPathIndex();

		await Promise.all(toRemove.map(async (extensionId) => {
			const extensionDescription = this._registry.getExtensionDescription(extensionId);
			if (!extensionDescription) {
				return;
			}
			const realpathValue = await this._hostUtils.realpath(extensionDescription.extensionLocation.fsPath);
			trie.delete(URI.file(realpathValue).fsPath);
		}));

		await Promise.all(toAdd.map(async (extensionDescription) => {
			const realpathValue = await this._hostUtils.realpath(extensionDescription.extensionLocation.fsPath);
			trie.set(URI.file(realpathValue).fsPath, extensionDescription);
		}));

		this._registry.deltaExtensions(toAdd, toRemove);
		return Promise.resolve(undefined);
	}

	public async $test_latency(n: number): Promise<number> {
		return n;
	}

	public async $test_up(b: VSBuffer): Promise<number> {
		return b.byteLength;
	}

	public async $test_down(size: number): Promise<VSBuffer> {
		let buff = VSBuffer.alloc(size);
		let value = Math.random() % 256;
		for (let i = 0; i < size; i++) {
			buff.writeUInt8(value, i);
		}
		return buff;
	}

	public async $updateRemoteConnectionData(connectionData: IRemoteConnectionData): Promise<void> {
		this._remoteConnectionData = connectionData;
		this._onDidChangeRemoteConnectionData.fire();
	}

	protected abstract _beforeAlmostReadyToRunExtensions(): Promise<void>;
	protected abstract _getEntryPoint(extensionDescription: IExtensionDescription): string | undefined;
	protected abstract _loadCommonJSModule<T>(extensionId: ExtensionIdentifier | null, module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<T>;
	public abstract $setRemoteEnvironment(env: { [key: string]: string | null }): Promise<void>;
}


type TelemetryActivationEvent = {
	id: string;
	name: string;
	extensionVersion: string;
	publisherDisplayName: string;
	activationEvents: string | null;
	isBuiltin: boolean;
	reason: string;
	reasonId: string;
};

function getTelemetryActivationEvent(extensionDescription: IExtensionDescription, reason: ExtensionActivationReason): TelemetryActivationEvent {
	const event = {
		id: extensionDescription.identifier.value,
		name: extensionDescription.name,
		extensionVersion: extensionDescription.version,
		publisherDisplayName: extensionDescription.publisher,
		activationEvents: extensionDescription.activationEvents ? extensionDescription.activationEvents.join(',') : null,
		isBuiltin: extensionDescription.isBuiltin,
		reason: reason.activationEvent,
		reasonId: reason.extensionId.value,
	};

	return event;
}


export const IExtHostExtensionService = createDecorator<IExtHostExtensionService>('IExtHostExtensionService');

export interface IExtHostExtensionService extends AbstractExtHostExtensionService {
	readonly _serviceBrand: undefined;
	initialize(): Promise<void>;
	isActivated(extensionId: ExtensionIdentifier): boolean;
	activateByIdWithErrors(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void>;
	deactivateAll(): Promise<void>;
	getExtensionExports(extensionId: ExtensionIdentifier): IExtensionAPI | null | undefined;
	getExtensionRegistry(): Promise<ExtensionDescriptionRegistry>;
	getExtensionPathIndex(): Promise<TernarySearchTree<string, IExtensionDescription>>;
	registerRemoteAuthorityResolver(authorityPrefix: string, resolver: vscode.RemoteAuthorityResolver): vscode.Disposable;

	onDidChangeRemoteConnectionData: Event<void>;
	getRemoteConnectionData(): IRemoteConnectionData | null;
}

export class Extension<T> implements vscode.Extension<T> {

	#extensionService: IExtHostExtensionService;
	#originExtensionId: ExtensionIdentifier;
	#identifier: ExtensionIdentifier;

	readonly id: string;
	readonly extensionUri: URI;
	readonly extensionPath: string;
	readonly packageJSON: IExtensionDescription;
	readonly extensionKind: vscode.ExtensionKind;

	constructor(extensionService: IExtHostExtensionService, originExtensionId: ExtensionIdentifier, description: IExtensionDescription, kind: ExtensionKind) {
		this.#extensionService = extensionService;
		this.#originExtensionId = originExtensionId;
		this.#identifier = description.identifier;
		this.id = description.identifier.value;
		this.extensionUri = description.extensionLocation;
		this.extensionPath = path.normalize(originalFSPath(description.extensionLocation));
		this.packageJSON = description;
		this.extensionKind = kind;
	}

	get isActive(): boolean {
		return this.#extensionService.isActivated(this.#identifier);
	}

	get exports(): T {
		if (this.packageJSON.api === 'none') {
			return undefined!; // Strict nulloverride - Public api
		}
		return <T>this.#extensionService.getExtensionExports(this.#identifier);
	}

	activate(): Thenable<T> {
		return this.#extensionService.activateByIdWithErrors(this.#identifier, { startup: false, extensionId: this.#originExtensionId, activationEvent: 'api' }).then(() => this.exports);
	}
}
