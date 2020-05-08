/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { URI as uri } from 'vs/base/common/uri';
import { first, distinct } from 'vs/base/common/arrays';
import * as errors from 'vs/base/common/errors';
import severity from 'vs/base/common/severity';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { FileChangesEvent, FileChangeType, IFileService } from 'vs/platform/files/common/files';
import { DebugModel, FunctionBreakpoint, Breakpoint, DataBreakpoint } from 'vs/workbench/contrib/debug/common/debugModel';
import { ViewModel } from 'vs/workbench/contrib/debug/common/debugViewModel';
import * as debugactions from 'vs/workbench/contrib/debug/browser/debugActions';
import { ConfigurationManager } from 'vs/workbench/contrib/debug/browser/debugConfigurationManager';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from 'vs/workbench/contrib/files/common/files';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { parse, getFirstFrame } from 'vs/base/common/console';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IAction } from 'vs/base/common/actions';
import { deepClone, equals } from 'vs/base/common/objects';
import { DebugSession } from 'vs/workbench/contrib/debug/browser/debugSession';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { IDebugService, State, IDebugSession, CONTEXT_DEBUG_TYPE, CONTEXT_DEBUG_STATE, CONTEXT_IN_DEBUG_MODE, IThread, IDebugConfiguration, VIEWLET_ID, DEBUG_PANEL_ID, IConfig, ILaunch, IViewModel, IConfigurationManager, IDebugModel, IEnablement, IBreakpoint, IBreakpointData, ICompound, IStackFrame, getStateLabel, IDebugSessionOptions, CONTEXT_DEBUG_UX, REPL_VIEW_ID, CONTEXT_BREAKPOINTS_EXIST, IGlobalConfig } from 'vs/workbench/contrib/debug/common/debug';
import { getExtensionHostDebugSession } from 'vs/workbench/contrib/debug/common/debugUtils';
import { isErrorWithActions } from 'vs/base/common/errorsWithActions';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IExtensionHostDebugService } from 'vs/platform/debug/common/extensionHostDebug';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { TaskRunResult, DebugTaskRunner } from 'vs/workbench/contrib/debug/browser/debugTaskRunner';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IViewsService } from 'vs/workbench/common/views';
import { generateUuid } from 'vs/base/common/uuid';
import { DebugStorage } from 'vs/workbench/contrib/debug/common/debugStorage';
import { DebugTelemetry } from 'vs/workbench/contrib/debug/common/debugTelemetry';

export class DebugService implements IDebugService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState: Emitter<State>;
	private readonly _onDidNewSession: Emitter<IDebugSession>;
	private readonly _onWillNewSession: Emitter<IDebugSession>;
	private readonly _onDidEndSession: Emitter<IDebugSession>;
	private debugStorage: DebugStorage;
	private model: DebugModel;
	private viewModel: ViewModel;
	private telemetry: DebugTelemetry;
	private taskRunner: DebugTaskRunner;
	private configurationManager: ConfigurationManager;
	private toDispose: IDisposable[];
	private debugType: IContextKey<string>;
	private debugState: IContextKey<string>;
	private inDebugMode: IContextKey<boolean>;
	private debugUx: IContextKey<string>;
	private breakpointsExist: IContextKey<boolean>;
	private breakpointsToSendOnResourceSaved: Set<string>;
	private initializing = false;
	private previousState: State | undefined;
	private sessionCancellationTokens = new Map<string, CancellationTokenSource>();
	private activity: IDisposable | undefined;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IViewletService private readonly viewletService: IViewletService,
		@IPanelService private readonly panelService: IPanelService,
		@IViewsService private readonly viewsService: IViewsService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExtensionHostDebugService private readonly extensionHostDebugService: IExtensionHostDebugService,
		@IActivityService private readonly activityService: IActivityService
	) {
		this.toDispose = [];

		this.breakpointsToSendOnResourceSaved = new Set<string>();

		this._onDidChangeState = new Emitter<State>();
		this._onDidNewSession = new Emitter<IDebugSession>();
		this._onWillNewSession = new Emitter<IDebugSession>();
		this._onDidEndSession = new Emitter<IDebugSession>();

		this.configurationManager = this.instantiationService.createInstance(ConfigurationManager);
		this.toDispose.push(this.configurationManager);

		this.debugType = CONTEXT_DEBUG_TYPE.bindTo(contextKeyService);
		this.debugState = CONTEXT_DEBUG_STATE.bindTo(contextKeyService);
		this.inDebugMode = CONTEXT_IN_DEBUG_MODE.bindTo(contextKeyService);
		this.debugUx = CONTEXT_DEBUG_UX.bindTo(contextKeyService);
		this.debugUx.set(!!this.configurationManager.selectedConfiguration.name ? 'default' : 'simple');

		this.debugStorage = this.instantiationService.createInstance(DebugStorage);
		this.model = this.instantiationService.createInstance(DebugModel, this.debugStorage);
		this.telemetry = this.instantiationService.createInstance(DebugTelemetry, this.model);
		const setBreakpointsExistContext = () => this.breakpointsExist.set(!!(this.model.getBreakpoints().length || this.model.getDataBreakpoints().length || this.model.getFunctionBreakpoints().length));
		this.breakpointsExist = CONTEXT_BREAKPOINTS_EXIST.bindTo(contextKeyService);
		setBreakpointsExistContext();

		this.viewModel = new ViewModel(contextKeyService);
		this.taskRunner = this.instantiationService.createInstance(DebugTaskRunner);

		this.toDispose.push(this.fileService.onDidFilesChange(e => this.onFileChanges(e)));
		this.toDispose.push(this.lifecycleService.onShutdown(this.dispose, this));

		this.toDispose.push(this.extensionHostDebugService.onAttachSession(event => {
			const session = this.model.getSession(event.sessionId, true);
			if (session) {
				// EH was started in debug mode -> attach to it
				session.configuration.request = 'attach';
				session.configuration.port = event.port;
				session.setSubId(event.subId);
				this.launchOrAttachToSession(session);
			}
		}));
		this.toDispose.push(this.extensionHostDebugService.onTerminateSession(event => {
			const session = this.model.getSession(event.sessionId);
			if (session && session.subId === event.subId) {
				session.disconnect();
			}
		}));
		this.toDispose.push(this.extensionHostDebugService.onLogToSession(event => {
			const session = this.model.getSession(event.sessionId, true);
			if (session) {
				// extension logged output -> show it in REPL
				const sev = event.log.severity === 'warn' ? severity.Warning : event.log.severity === 'error' ? severity.Error : severity.Info;
				const { args, stack } = parse(event.log);
				const frame = !!stack ? getFirstFrame(stack) : undefined;
				session.logToRepl(sev, args, frame);
			}
		}));

		this.toDispose.push(this.viewModel.onDidFocusStackFrame(() => {
			this.onStateChange();
		}));
		this.toDispose.push(this.viewModel.onDidFocusSession(() => {
			this.onStateChange();
		}));
		this.toDispose.push(this.configurationManager.onDidSelectConfiguration(() => {
			this.debugUx.set(!!(this.state !== State.Inactive || this.configurationManager.selectedConfiguration.name) ? 'default' : 'simple');
		}));
		this.toDispose.push(this.model.onDidChangeCallStack(() => {
			const numberOfSessions = this.model.getSessions().filter(s => !s.parentSession).length;
			if (this.activity) {
				this.activity.dispose();
			}
			if (numberOfSessions > 0) {
				this.activity = this.activityService.showViewContainerActivity(VIEWLET_ID, { badge: new NumberBadge(numberOfSessions, n => n === 1 ? nls.localize('1activeSession', "1 active session") : nls.localize('nActiveSessions', "{0} active sessions", n)) });
			}
		}));
		this.toDispose.push(this.model.onDidChangeBreakpoints(() => setBreakpointsExistContext()));
	}

	getModel(): IDebugModel {
		return this.model;
	}

	getViewModel(): IViewModel {
		return this.viewModel;
	}

	getConfigurationManager(): IConfigurationManager {
		return this.configurationManager;
	}

	sourceIsNotAvailable(uri: uri): void {
		this.model.sourceIsNotAvailable(uri);
	}

	dispose(): void {
		this.toDispose = dispose(this.toDispose);
	}

	//---- state management

	get state(): State {
		const focusedSession = this.viewModel.focusedSession;
		if (focusedSession) {
			return focusedSession.state;
		}

		return this.initializing ? State.Initializing : State.Inactive;
	}

	private startInitializingState(): void {
		if (!this.initializing) {
			this.initializing = true;
			this.onStateChange();
		}
	}

	private endInitializingState(): void {
		if (this.initializing) {
			this.initializing = false;
			this.onStateChange();
		}
	}

	private cancelTokens(id: string | undefined): void {
		if (id) {
			const token = this.sessionCancellationTokens.get(id);
			if (token) {
				token.cancel();
				this.sessionCancellationTokens.delete(id);
			}
		} else {
			this.sessionCancellationTokens.forEach(t => t.cancel());
			this.sessionCancellationTokens.clear();
		}
	}

	private onStateChange(): void {
		const state = this.state;
		if (this.previousState !== state) {
			this.debugState.set(getStateLabel(state));
			this.inDebugMode.set(state !== State.Inactive);
			// Only show the simple ux if debug is not yet started and if no launch.json exists
			this.debugUx.set(((state !== State.Inactive && state !== State.Initializing) || this.configurationManager.selectedConfiguration.name) ? 'default' : 'simple');
			this.previousState = state;
			this._onDidChangeState.fire(state);
		}
	}

	get onDidChangeState(): Event<State> {
		return this._onDidChangeState.event;
	}

	get onDidNewSession(): Event<IDebugSession> {
		return this._onDidNewSession.event;
	}

	get onWillNewSession(): Event<IDebugSession> {
		return this._onWillNewSession.event;
	}

	get onDidEndSession(): Event<IDebugSession> {
		return this._onDidEndSession.event;
	}

	//---- life cycle management

	/**
	 * main entry point
	 * properly manages compounds, checks for errors and handles the initializing state.
	 */
	async startDebugging(launch: ILaunch | undefined, configOrName?: IConfig | string, options?: IDebugSessionOptions): Promise<boolean> {

		this.startInitializingState();
		try {
			// make sure to save all files and that the configuration is up to date
			await this.extensionService.activateByEvent('onDebug');
			await this.editorService.saveAll();
			await this.configurationService.reloadConfiguration(launch ? launch.workspace : undefined);
			await this.extensionService.whenInstalledExtensionsRegistered();

			let config: IConfig | undefined;
			let compound: ICompound | undefined;
			if (!configOrName) {
				configOrName = this.configurationManager.selectedConfiguration.name;
			}
			if (typeof configOrName === 'string' && launch) {
				config = launch.getConfiguration(configOrName);
				compound = launch.getCompound(configOrName);

				const sessions = this.model.getSessions();
				const alreadyRunningMessage = nls.localize('configurationAlreadyRunning', "There is already a debug configuration \"{0}\" running.", configOrName);
				if (sessions.some(s => s.configuration.name === configOrName && (!launch || !launch.workspace || !s.root || s.root.uri.toString() === launch.workspace.uri.toString()))) {
					throw new Error(alreadyRunningMessage);
				}
				if (compound && compound.configurations && sessions.some(p => compound!.configurations.indexOf(p.configuration.name) !== -1)) {
					throw new Error(alreadyRunningMessage);
				}
			} else if (typeof configOrName !== 'string') {
				config = configOrName;
			}

			if (compound) {
				// we are starting a compound debug, first do some error checking and than start each configuration in the compound
				if (!compound.configurations) {
					throw new Error(nls.localize({ key: 'compoundMustHaveConfigurations', comment: ['compound indicates a "compounds" configuration item', '"configurations" is an attribute and should not be localized'] },
						"Compound must have \"configurations\" attribute set in order to start multiple configurations."));
				}
				if (compound.preLaunchTask) {
					const taskResult = await this.taskRunner.runTaskAndCheckErrors(launch?.workspace || this.contextService.getWorkspace(), compound.preLaunchTask, (msg, actions) => this.showError(msg, actions));
					if (taskResult === TaskRunResult.Failure) {
						this.endInitializingState();
						return false;
					}
				}

				const values = await Promise.all(compound.configurations.map(configData => {
					const name = typeof configData === 'string' ? configData : configData.name;
					if (name === compound!.name) {
						return Promise.resolve(false);
					}

					let launchForName: ILaunch | undefined;
					if (typeof configData === 'string') {
						const launchesContainingName = this.configurationManager.getLaunches().filter(l => !!l.getConfiguration(name));
						if (launchesContainingName.length === 1) {
							launchForName = launchesContainingName[0];
						} else if (launch && launchesContainingName.length > 1 && launchesContainingName.indexOf(launch) >= 0) {
							// If there are multiple launches containing the configuration give priority to the configuration in the current launch
							launchForName = launch;
						} else {
							throw new Error(launchesContainingName.length === 0 ? nls.localize('noConfigurationNameInWorkspace', "Could not find launch configuration '{0}' in the workspace.", name)
								: nls.localize('multipleConfigurationNamesInWorkspace', "There are multiple launch configurations '{0}' in the workspace. Use folder name to qualify the configuration.", name));
						}
					} else if (configData.folder) {
						const launchesMatchingConfigData = this.configurationManager.getLaunches().filter(l => l.workspace && l.workspace.name === configData.folder && !!l.getConfiguration(configData.name));
						if (launchesMatchingConfigData.length === 1) {
							launchForName = launchesMatchingConfigData[0];
						} else {
							throw new Error(nls.localize('noFolderWithName', "Can not find folder with name '{0}' for configuration '{1}' in compound '{2}'.", configData.folder, configData.name, compound!.name));
						}
					}

					return this.createSession(launchForName, launchForName!.getConfiguration(name), options);
				}));

				const result = values.every(success => !!success); // Compound launch is a success only if each configuration launched successfully
				this.endInitializingState();
				return result;
			}

			if (configOrName && !config) {
				const message = !!launch ? nls.localize('configMissing', "Configuration '{0}' is missing in 'launch.json'.", typeof configOrName === 'string' ? configOrName : JSON.stringify(configOrName)) :
					nls.localize('launchJsonDoesNotExist', "'launch.json' does not exist.");
				throw new Error(message);
			}

			const result = await this.createSession(launch, config, options);
			this.endInitializingState();
			return result;
		} catch (err) {
			// make sure to get out of initializing state, and propagate the result
			this.endInitializingState();
			return Promise.reject(err);
		}
	}

	/**
	 * gets the debugger for the type, resolves configurations by providers, substitutes variables and runs prelaunch tasks
	 */
	private async createSession(launch: ILaunch | undefined, config: IConfig | undefined, options?: IDebugSessionOptions): Promise<boolean> {
		// We keep the debug type in a separate variable 'type' so that a no-folder config has no attributes.
		// Storing the type in the config would break extensions that assume that the no-folder case is indicated by an empty config.
		let type: string | undefined;
		if (config) {
			type = config.type;
		} else {
			// a no-folder workspace has no launch.config
			config = Object.create(null);
		}
		const unresolvedConfig = deepClone(config);

		if (options && options.noDebug) {
			config!.noDebug = true;
		}

		if (!type) {
			const guess = await this.configurationManager.guessDebugger();
			if (guess) {
				type = guess.type;
			}
		}

		const initCancellationToken = new CancellationTokenSource();
		const sessionId = generateUuid();
		this.sessionCancellationTokens.set(sessionId, initCancellationToken);

		const configByProviders = await this.configurationManager.resolveConfigurationByProviders(launch && launch.workspace ? launch.workspace.uri : undefined, type, config!, initCancellationToken.token);
		// a falsy config indicates an aborted launch
		if (configByProviders && configByProviders.type) {
			try {
				let resolvedConfig = await this.substituteVariables(launch, configByProviders);
				if (!resolvedConfig) {
					// User cancelled resolving of interactive variables, silently return
					return false;
				}

				if (initCancellationToken.token.isCancellationRequested) {
					// User cancelled, silently return
					return false;
				}

				const cfg = await this.configurationManager.resolveDebugConfigurationWithSubstitutedVariables(launch && launch.workspace ? launch.workspace.uri : undefined, type, resolvedConfig, initCancellationToken.token);
				if (!cfg) {
					if (launch && type && cfg === null && !initCancellationToken.token.isCancellationRequested) {	// show launch.json only for "config" being "null".
						await launch.openConfigFile(false, true, type, initCancellationToken.token);
					}
					return false;
				}
				resolvedConfig = cfg;

				if (!this.configurationManager.getDebugger(resolvedConfig.type) || (configByProviders.request !== 'attach' && configByProviders.request !== 'launch')) {
					let message: string;
					if (configByProviders.request !== 'attach' && configByProviders.request !== 'launch') {
						message = configByProviders.request ? nls.localize('debugRequestNotSupported', "Attribute '{0}' has an unsupported value '{1}' in the chosen debug configuration.", 'request', configByProviders.request)
							: nls.localize('debugRequesMissing', "Attribute '{0}' is missing from the chosen debug configuration.", 'request');

					} else {
						message = resolvedConfig.type ? nls.localize('debugTypeNotSupported', "Configured debug type '{0}' is not supported.", resolvedConfig.type) :
							nls.localize('debugTypeMissing', "Missing property 'type' for the chosen launch configuration.");
					}

					await this.showError(message);
					return false;
				}

				const workspace = launch?.workspace || this.contextService.getWorkspace();
				const taskResult = await this.taskRunner.runTaskAndCheckErrors(workspace, resolvedConfig.preLaunchTask, (msg, actions) => this.showError(msg, actions));
				if (taskResult === TaskRunResult.Success) {
					return this.doCreateSession(sessionId, launch?.workspace, { resolved: resolvedConfig, unresolved: unresolvedConfig }, options);
				}
				return false;
			} catch (err) {
				if (err && err.message) {
					await this.showError(err.message);
				} else if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
					await this.showError(nls.localize('noFolderWorkspaceDebugError', "The active file can not be debugged. Make sure it is saved and that you have a debug extension installed for that file type."));
				}
				if (launch && !initCancellationToken.token.isCancellationRequested) {
					await launch.openConfigFile(false, true, undefined, initCancellationToken.token);
				}

				return false;
			}
		}

		if (launch && type && configByProviders === null && !initCancellationToken.token.isCancellationRequested) {	// show launch.json only for "config" being "null".
			await launch.openConfigFile(false, true, type, initCancellationToken.token);
		}

		return false;
	}

	/**
	 * instantiates the new session, initializes the session, registers session listeners and reports telemetry
	 */
	private async doCreateSession(sessionId: string, root: IWorkspaceFolder | undefined, configuration: { resolved: IConfig, unresolved: IConfig | undefined }, options?: IDebugSessionOptions): Promise<boolean> {

		const session = this.instantiationService.createInstance(DebugSession, sessionId, configuration, root, this.model, options);
		this.model.addSession(session);
		// register listeners as the very first thing!
		this.registerSessionListeners(session);

		// since the Session is now properly registered under its ID and hooked, we can announce it
		// this event doesn't go to extensions
		this._onWillNewSession.fire(session);

		const openDebug = this.configurationService.getValue<IDebugConfiguration>('debug').openDebug;
		// Open debug viewlet based on the visibility of the side bar and openDebug setting. Do not open for 'run without debug'
		if (!configuration.resolved.noDebug && (openDebug === 'openOnSessionStart' || (openDebug === 'openOnFirstSessionStart' && this.viewModel.firstSessionStart))) {
			await this.viewletService.openViewlet(VIEWLET_ID);
		}

		try {
			await this.launchOrAttachToSession(session);

			const internalConsoleOptions = session.configuration.internalConsoleOptions || this.configurationService.getValue<IDebugConfiguration>('debug').internalConsoleOptions;
			if (internalConsoleOptions === 'openOnSessionStart' || (this.viewModel.firstSessionStart && internalConsoleOptions === 'openOnFirstSessionStart')) {
				this.viewsService.openView(REPL_VIEW_ID, false);
			}

			this.viewModel.firstSessionStart = false;
			const showSubSessions = this.configurationService.getValue<IDebugConfiguration>('debug').showSubSessionsInToolBar;
			const sessions = this.model.getSessions();
			const shownSessions = showSubSessions ? sessions : sessions.filter(s => !s.parentSession);
			if (shownSessions.length > 1) {
				this.viewModel.setMultiSessionView(true);
			}

			// since the initialized response has arrived announce the new Session (including extensions)
			this._onDidNewSession.fire(session);

			return true;
		} catch (error) {

			if (errors.isPromiseCanceledError(error)) {
				// don't show 'canceled' error messages to the user #7906
				return false;
			}

			// Show the repl if some error got logged there #5870
			if (session && session.getReplElements().length > 0) {
				this.viewsService.openView(REPL_VIEW_ID, false);
			}

			if (session.configuration && session.configuration.request === 'attach' && session.configuration.__autoAttach) {
				// ignore attach timeouts in auto attach mode
				return false;
			}

			const errorMessage = error instanceof Error ? error.message : error;
			await this.showError(errorMessage, isErrorWithActions(error) ? error.actions : []);
			return false;
		}
	}

	private async launchOrAttachToSession(session: IDebugSession, forceFocus = false): Promise<void> {
		const dbgr = this.configurationManager.getDebugger(session.configuration.type);
		try {
			await session.initialize(dbgr!);
			await session.launchOrAttach(session.configuration);
			const launchJsonExists = !!session.root && !!this.configurationService.getValue<IGlobalConfig>('launch', { resource: session.root.uri });
			await this.telemetry.logDebugSessionStart(dbgr!, launchJsonExists);

			if (forceFocus || !this.viewModel.focusedSession || session.parentSession === this.viewModel.focusedSession) {
				await this.focusStackFrame(undefined, undefined, session);
			}
		} catch (err) {
			if (this.viewModel.focusedSession === session) {
				await this.focusStackFrame(undefined);
			}
			return Promise.reject(err);
		}
	}

	private registerSessionListeners(session: IDebugSession): void {
		const sessionRunningScheduler = new RunOnceScheduler(() => {
			// Do not immediatly defocus the stack frame if the session is running
			if (session.state === State.Running && this.viewModel.focusedSession === session) {
				this.viewModel.setFocus(undefined, this.viewModel.focusedThread, session, false);
			}
		}, 200);
		this.toDispose.push(session.onDidChangeState(() => {
			if (session.state === State.Running && this.viewModel.focusedSession === session) {
				sessionRunningScheduler.schedule();
			}
			if (session === this.viewModel.focusedSession) {
				this.onStateChange();
			}
		}));

		this.toDispose.push(session.onDidEndAdapter(async adapterExitEvent => {

			if (adapterExitEvent.error) {
				this.notificationService.error(nls.localize('debugAdapterCrash', "Debug adapter process has terminated unexpectedly ({0})", adapterExitEvent.error.message || adapterExitEvent.error.toString()));
			}

			// 'Run without debugging' mode VSCode must terminate the extension host. More details: #3905
			const extensionDebugSession = getExtensionHostDebugSession(session);
			if (extensionDebugSession && extensionDebugSession.state === State.Running && extensionDebugSession.configuration.noDebug) {
				this.extensionHostDebugService.close(extensionDebugSession.getId());
			}

			this.telemetry.logDebugSessionStop(session, adapterExitEvent);

			if (session.configuration.postDebugTask) {
				try {
					await this.taskRunner.runTask(session.root, session.configuration.postDebugTask);
				} catch (err) {
					this.notificationService.error(err);
				}
			}
			this.endInitializingState();
			this.cancelTokens(session.getId());
			this._onDidEndSession.fire(session);

			const focusedSession = this.viewModel.focusedSession;
			if (focusedSession && focusedSession.getId() === session.getId()) {
				const { session } = getStackFrameThreadAndSessionToFocus(this.model, undefined);
				this.viewModel.setFocus(undefined, undefined, session, false);
			}

			if (this.model.getSessions().length === 0) {
				this.viewModel.setMultiSessionView(false);

				if (this.layoutService.isVisible(Parts.SIDEBAR_PART) && this.configurationService.getValue<IDebugConfiguration>('debug').openExplorerOnEnd) {
					this.viewletService.openViewlet(EXPLORER_VIEWLET_ID);
				}

				// Data breakpoints that can not be persisted should be cleared when a session ends
				const dataBreakpoints = this.model.getDataBreakpoints().filter(dbp => !dbp.canPersist);
				dataBreakpoints.forEach(dbp => this.model.removeDataBreakpoints(dbp.getId()));

				if (this.panelService.getLastActivePanelId() === DEBUG_PANEL_ID && this.configurationService.getValue<IDebugConfiguration>('debug').console.closeOnEnd) {
					this.panelService.hideActivePanel();
				}
			}
		}));
	}

	async restartSession(session: IDebugSession, restartData?: any): Promise<any> {
		await this.editorService.saveAll();
		const isAutoRestart = !!restartData;

		const runTasks: () => Promise<TaskRunResult> = async () => {
			if (isAutoRestart) {
				// Do not run preLaunch and postDebug tasks for automatic restarts
				return Promise.resolve(TaskRunResult.Success);
			}

			const root = session.root || this.contextService.getWorkspace();
			await this.taskRunner.runTask(root, session.configuration.postDebugTask);
			return this.taskRunner.runTaskAndCheckErrors(root, session.configuration.preLaunchTask, (msg, actions) => this.showError(msg, actions));
		};

		const extensionDebugSession = getExtensionHostDebugSession(session);
		if (extensionDebugSession) {
			const taskResult = await runTasks();
			if (taskResult === TaskRunResult.Success) {
				this.extensionHostDebugService.reload(extensionDebugSession.getId());
			}

			return;
		}

		if (session.capabilities.supportsRestartRequest) {
			const taskResult = await runTasks();
			if (taskResult === TaskRunResult.Success) {
				await session.restart();
			}

			return;
		}

		const shouldFocus = !!this.viewModel.focusedSession && session.getId() === this.viewModel.focusedSession.getId();
		// If the restart is automatic  -> disconnect, otherwise -> terminate #55064
		if (isAutoRestart) {
			await session.disconnect(true);
		} else {
			await session.terminate(true);
		}

		return new Promise<void>((c, e) => {
			setTimeout(async () => {
				const taskResult = await runTasks();
				if (taskResult !== TaskRunResult.Success) {
					return;
				}

				// Read the configuration again if a launch.json has been changed, if not just use the inmemory configuration
				let needsToSubstitute = false;
				let unresolved: IConfig | undefined;
				const launch = session.root ? this.configurationManager.getLaunch(session.root.uri) : undefined;
				if (launch) {
					unresolved = launch.getConfiguration(session.configuration.name);
					if (unresolved && !equals(unresolved, session.unresolvedConfiguration)) {
						// Take the type from the session since the debug extension might overwrite it #21316
						unresolved.type = session.configuration.type;
						unresolved.noDebug = session.configuration.noDebug;
						needsToSubstitute = true;
					}
				}

				let resolved: IConfig | undefined | null = session.configuration;
				if (launch && needsToSubstitute && unresolved) {
					const initCancellationToken = new CancellationTokenSource();
					this.sessionCancellationTokens.set(session.getId(), initCancellationToken);
					const resolvedByProviders = await this.configurationManager.resolveConfigurationByProviders(launch.workspace ? launch.workspace.uri : undefined, unresolved.type, unresolved, initCancellationToken.token);
					if (resolvedByProviders) {
						resolved = await this.substituteVariables(launch, resolvedByProviders);
						if (resolved && !initCancellationToken.token.isCancellationRequested) {
							resolved = await this.configurationManager.resolveDebugConfigurationWithSubstitutedVariables(launch && launch.workspace ? launch.workspace.uri : undefined, unresolved.type, resolved, initCancellationToken.token);
						}
					} else {
						resolved = resolvedByProviders;
					}
				}

				if (!resolved) {
					return c(undefined);
				}

				session.setConfiguration({ resolved, unresolved });
				session.configuration.__restart = restartData;

				try {
					await this.launchOrAttachToSession(session, shouldFocus);
					this._onDidNewSession.fire(session);
					c(undefined);
				} catch (error) {
					e(error);
				}
			}, 300);
		});
	}

	stopSession(session: IDebugSession): Promise<any> {
		if (session) {
			return session.terminate();
		}

		const sessions = this.model.getSessions();
		if (sessions.length === 0) {
			this.taskRunner.cancel();
			this.endInitializingState();
			this.cancelTokens(undefined);
		}

		return Promise.all(sessions.map(s => s.terminate()));
	}

	private async substituteVariables(launch: ILaunch | undefined, config: IConfig): Promise<IConfig | undefined> {
		const dbg = this.configurationManager.getDebugger(config.type);
		if (dbg) {
			let folder: IWorkspaceFolder | undefined = undefined;
			if (launch && launch.workspace) {
				folder = launch.workspace;
			} else {
				const folders = this.contextService.getWorkspace().folders;
				if (folders.length === 1) {
					folder = folders[0];
				}
			}
			try {
				return await dbg.substituteVariables(folder, config);
			} catch (err) {
				this.showError(err.message);
				return undefined;	// bail out
			}
		}
		return Promise.resolve(config);
	}

	private async showError(message: string, errorActions: ReadonlyArray<IAction> = []): Promise<void> {
		const configureAction = this.instantiationService.createInstance(debugactions.ConfigureAction, debugactions.ConfigureAction.ID, debugactions.ConfigureAction.LABEL);
		const actions = [...errorActions, configureAction];
		const { choice } = await this.dialogService.show(severity.Error, message, actions.map(a => a.label).concat(nls.localize('cancel', "Cancel")), { cancelId: actions.length });
		if (choice < actions.length) {
			return actions[choice].run();
		}

		return undefined;
	}

	//---- focus management

	async focusStackFrame(_stackFrame: IStackFrame | undefined, _thread?: IThread, _session?: IDebugSession, explicit?: boolean): Promise<void> {
		const { stackFrame, thread, session } = getStackFrameThreadAndSessionToFocus(this.model, _stackFrame, _thread, _session);

		if (stackFrame) {
			const editor = await stackFrame.openInEditor(this.editorService, true);
			if (editor) {
				const control = editor.getControl();
				if (stackFrame && isCodeEditor(control) && control.hasModel()) {
					const model = control.getModel();
					const lineNumber = stackFrame.range.startLineNumber;
					if (lineNumber >= 1 && lineNumber <= model.getLineCount()) {
						const lineContent = control.getModel().getLineContent(lineNumber);
						aria.alert(nls.localize('debuggingPaused', "Debugging paused {0}, {1} {2} {3}", thread && thread.stoppedDetails ? `, reason ${thread.stoppedDetails.reason}` : '', stackFrame.source ? stackFrame.source.name : '', stackFrame.range.startLineNumber, lineContent));
					}
				}
			}
		}
		if (session) {
			this.debugType.set(session.configuration.type);
		} else {
			this.debugType.reset();
		}

		this.viewModel.setFocus(stackFrame, thread, session, !!explicit);
	}

	//---- watches

	addWatchExpression(name?: string): void {
		const we = this.model.addWatchExpression(name);
		if (!name) {
			this.viewModel.setSelectedExpression(we);
		}
		this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
	}

	renameWatchExpression(id: string, newName: string): void {
		this.model.renameWatchExpression(id, newName);
		this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
	}

	moveWatchExpression(id: string, position: number): void {
		this.model.moveWatchExpression(id, position);
		this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
	}

	removeWatchExpressions(id?: string): void {
		this.model.removeWatchExpressions(id);
		this.debugStorage.storeWatchExpressions(this.model.getWatchExpressions());
	}

	//---- breakpoints

	async enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): Promise<void> {
		if (breakpoint) {
			this.model.setEnablement(breakpoint, enable);
			if (breakpoint instanceof Breakpoint) {
				await this.sendBreakpoints(breakpoint.uri);
			} else if (breakpoint instanceof FunctionBreakpoint) {
				await this.sendFunctionBreakpoints();
			} else if (breakpoint instanceof DataBreakpoint) {
				await this.sendDataBreakpoints();
			} else {
				await this.sendExceptionBreakpoints();
			}
		} else {
			this.model.enableOrDisableAllBreakpoints(enable);
			await this.sendAllBreakpoints();
		}
		this.debugStorage.storeBreakpoints(this.model);
	}

	async addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[], context: string): Promise<IBreakpoint[]> {
		const breakpoints = this.model.addBreakpoints(uri, rawBreakpoints);
		breakpoints.forEach(bp => aria.status(nls.localize('breakpointAdded', "Added breakpoint, line {0}, file {1}", bp.lineNumber, uri.fsPath)));
		breakpoints.forEach(bp => this.telemetry.logDebugAddBreakpoint(bp, context));

		await this.sendBreakpoints(uri);
		this.debugStorage.storeBreakpoints(this.model);
		return breakpoints;
	}

	async updateBreakpoints(uri: uri, data: Map<string, DebugProtocol.Breakpoint>, sendOnResourceSaved: boolean): Promise<void> {
		this.model.updateBreakpoints(data);
		if (sendOnResourceSaved) {
			this.breakpointsToSendOnResourceSaved.add(uri.toString());
		} else {
			await this.sendBreakpoints(uri);
		}
		this.debugStorage.storeBreakpoints(this.model);
	}

	async removeBreakpoints(id?: string): Promise<void> {
		const toRemove = this.model.getBreakpoints().filter(bp => !id || bp.getId() === id);
		toRemove.forEach(bp => aria.status(nls.localize('breakpointRemoved', "Removed breakpoint, line {0}, file {1}", bp.lineNumber, bp.uri.fsPath)));
		const urisToClear = distinct(toRemove, bp => bp.uri.toString()).map(bp => bp.uri);

		this.model.removeBreakpoints(toRemove);

		await Promise.all(urisToClear.map(uri => this.sendBreakpoints(uri)));
		this.debugStorage.storeBreakpoints(this.model);
	}

	setBreakpointsActivated(activated: boolean): Promise<void> {
		this.model.setBreakpointsActivated(activated);
		return this.sendAllBreakpoints();
	}

	addFunctionBreakpoint(name?: string, id?: string): void {
		const newFunctionBreakpoint = this.model.addFunctionBreakpoint(name || '', id);
		this.viewModel.setSelectedFunctionBreakpoint(newFunctionBreakpoint);
	}

	async renameFunctionBreakpoint(id: string, newFunctionName: string): Promise<void> {
		this.model.renameFunctionBreakpoint(id, newFunctionName);
		await this.sendFunctionBreakpoints();
		this.debugStorage.storeBreakpoints(this.model);
	}

	async removeFunctionBreakpoints(id?: string): Promise<void> {
		this.model.removeFunctionBreakpoints(id);
		await this.sendFunctionBreakpoints();
		this.debugStorage.storeBreakpoints(this.model);
	}

	async addDataBreakpoint(label: string, dataId: string, canPersist: boolean, accessTypes: DebugProtocol.DataBreakpointAccessType[] | undefined): Promise<void> {
		this.model.addDataBreakpoint(label, dataId, canPersist, accessTypes);
		await this.sendDataBreakpoints();

		this.debugStorage.storeBreakpoints(this.model);
	}

	async removeDataBreakpoints(id?: string): Promise<void> {
		this.model.removeDataBreakpoints(id);
		await this.sendDataBreakpoints();
		this.debugStorage.storeBreakpoints(this.model);
	}

	async sendAllBreakpoints(session?: IDebugSession): Promise<any> {
		await Promise.all(distinct(this.model.getBreakpoints(), bp => bp.uri.toString()).map(bp => this.sendBreakpoints(bp.uri, false, session)));
		await this.sendFunctionBreakpoints(session);
		await this.sendDataBreakpoints(session);
		// send exception breakpoints at the end since some debug adapters rely on the order
		await this.sendExceptionBreakpoints(session);
	}

	private async sendBreakpoints(modelUri: uri, sourceModified = false, session?: IDebugSession): Promise<void> {
		const breakpointsToSend = this.model.getBreakpoints({ uri: modelUri, enabledOnly: true });

		await sendToOneOrAllSessions(this.model, session, s => s.sendBreakpoints(modelUri, breakpointsToSend, sourceModified));
	}

	private async sendFunctionBreakpoints(session?: IDebugSession): Promise<void> {
		const breakpointsToSend = this.model.getFunctionBreakpoints().filter(fbp => fbp.enabled && this.model.areBreakpointsActivated());

		await sendToOneOrAllSessions(this.model, session, async s => {
			if (s.capabilities.supportsFunctionBreakpoints) {
				await s.sendFunctionBreakpoints(breakpointsToSend);
			}
		});
	}

	private sendDataBreakpoints(session?: IDebugSession): Promise<void> {
		const breakpointsToSend = this.model.getDataBreakpoints().filter(fbp => fbp.enabled && this.model.areBreakpointsActivated());

		return sendToOneOrAllSessions(this.model, session, async s => {
			if (s.capabilities.supportsDataBreakpoints) {
				await s.sendDataBreakpoints(breakpointsToSend);
			}
		});
	}

	private sendExceptionBreakpoints(session?: IDebugSession): Promise<void> {
		const enabledExceptionBps = this.model.getExceptionBreakpoints().filter(exb => exb.enabled);

		return sendToOneOrAllSessions(this.model, session, async s => {
			if (s.capabilities.supportsConfigurationDoneRequest && (!s.capabilities.exceptionBreakpointFilters || s.capabilities.exceptionBreakpointFilters.length === 0)) {
				// Only call `setExceptionBreakpoints` as specified in dap protocol #90001
				return;
			}
			await s.sendExceptionBreakpoints(enabledExceptionBps);
		});
	}

	private onFileChanges(fileChangesEvent: FileChangesEvent): void {
		const toRemove = this.model.getBreakpoints().filter(bp =>
			fileChangesEvent.contains(bp.uri, FileChangeType.DELETED));
		if (toRemove.length) {
			this.model.removeBreakpoints(toRemove);
		}

		fileChangesEvent.getUpdated().forEach(event => {

			if (this.breakpointsToSendOnResourceSaved.delete(event.resource.toString())) {
				this.sendBreakpoints(event.resource, true);
			}
		});
	}
}

export function getStackFrameThreadAndSessionToFocus(model: IDebugModel, stackFrame: IStackFrame | undefined, thread?: IThread, session?: IDebugSession): { stackFrame: IStackFrame | undefined, thread: IThread | undefined, session: IDebugSession | undefined } {
	if (!session) {
		if (stackFrame || thread) {
			session = stackFrame ? stackFrame.thread.session : thread!.session;
		} else {
			const sessions = model.getSessions();
			const stoppedSession = sessions.find(s => s.state === State.Stopped);
			session = stoppedSession || (sessions.length ? sessions[0] : undefined);
		}
	}

	if (!thread) {
		if (stackFrame) {
			thread = stackFrame.thread;
		} else {
			const threads = session ? session.getAllThreads() : undefined;
			const stoppedThread = threads && threads.find(t => t.stopped);
			thread = stoppedThread || (threads && threads.length ? threads[0] : undefined);
		}
	}

	if (!stackFrame) {
		if (thread) {
			const callStack = thread.getCallStack();
			stackFrame = first(callStack, sf => !!(sf && sf.source && sf.source.available && sf.source.presentationHint !== 'deemphasize'), undefined);
		}
	}

	return { session, thread, stackFrame };
}

async function sendToOneOrAllSessions(model: DebugModel, session: IDebugSession | undefined, send: (session: IDebugSession) => Promise<void>): Promise<void> {
	if (session) {
		await send(session);
	} else {
		await Promise.all(model.getSessions().map(s => send(s)));
	}
}
