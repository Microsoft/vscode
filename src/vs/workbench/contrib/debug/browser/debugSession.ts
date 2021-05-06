/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import * as resources from 'vs/base/common/resources';
import * as platform from 'vs/base/common/platform';
import severity from 'vs/base/common/severity';
import { Event, Emitter } from 'vs/base/common/event';
import { Position, IPosition } from 'vs/editor/common/core/position';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { IDebugSession, IConfig, IThread, IRawModelUpdate, IDebugService, IRawStoppedDetails, State, LoadedSourceEvent, IFunctionBreakpoint, IExceptionBreakpoint, IBreakpoint, IExceptionInfo, AdapterEndEvent, IDebugger, VIEWLET_ID, IDebugConfiguration, IReplElement, IStackFrame, IExpression, IReplElementSource, IDataBreakpoint, IDebugSessionOptions } from 'vs/workbench/contrib/debug/common/debug';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { mixin } from 'vs/base/common/objects';
import { Thread, ExpressionContainer, DebugModel } from 'vs/workbench/contrib/debug/common/debugModel';
import { RawDebugSession } from 'vs/workbench/contrib/debug/browser/rawDebugSession';
import { IProductService } from 'vs/platform/product/common/productService';
import { IWorkspaceFolder, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { RunOnceScheduler, Queue } from 'vs/base/common/async';
import { generateUuid } from 'vs/base/common/uuid';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ICustomEndpointTelemetryService, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ReplModel } from 'vs/workbench/contrib/debug/common/replModel';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { distinct } from 'vs/base/common/arrays';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { localize } from 'vs/nls';
import { canceled } from 'vs/base/common/errors';
import { filterExceptionsFromTelemetry } from 'vs/workbench/contrib/debug/common/debugUtils';
import { DebugCompoundRoot } from 'vs/workbench/contrib/debug/common/debugCompoundRoot';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export class DebugSession implements IDebugSession {

	private _subId: string | undefined;
	private raw: RawDebugSession | undefined;
	private initialized = false;
	private _options: IDebugSessionOptions;

	private sources = new Map<string, Source>();
	private threads = new Map<number, Thread>();
	private cancellationMap = new Map<number, CancellationTokenSource[]>();
	private rawListeners: IDisposable[] = [];
	private fetchThreadsScheduler: RunOnceScheduler | undefined;
	private repl: ReplModel;
	private stoppedDetails: IRawStoppedDetails | undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	private readonly _onDidEndAdapter = new Emitter<AdapterEndEvent | undefined>();

	private readonly _onDidLoadedSource = new Emitter<LoadedSourceEvent>();
	private readonly _onDidCustomEvent = new Emitter<DebugProtocol.Event>();
	private readonly _onDidProgressStart = new Emitter<DebugProtocol.ProgressStartEvent>();
	private readonly _onDidProgressUpdate = new Emitter<DebugProtocol.ProgressUpdateEvent>();
	private readonly _onDidProgressEnd = new Emitter<DebugProtocol.ProgressEndEvent>();

	private readonly _onDidChangeREPLElements = new Emitter<void>();

	private _name: string | undefined;
	private readonly _onDidChangeName = new Emitter<string>();

	constructor(
		private id: string,
		private _configuration: { resolved: IConfig, unresolved: IConfig | undefined },
		public root: IWorkspaceFolder | undefined,
		private model: DebugModel,
		options: IDebugSessionOptions | undefined,
		@IDebugService private readonly debugService: IDebugService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IViewletService private readonly viewletService: IViewletService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IProductService private readonly productService: IProductService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICustomEndpointTelemetryService private readonly customEndpointTelemetryService: ICustomEndpointTelemetryService
	) {
		this._options = options || {};
		if (this.hasSeparateRepl()) {
			this.repl = new ReplModel(this.configurationService);
		} else {
			this.repl = (this.parentSession as DebugSession).repl;
		}

		const toDispose: IDisposable[] = [];
		toDispose.push(this.repl.onDidChangeElements(() => this._onDidChangeREPLElements.fire()));
		if (lifecycleService) {
			toDispose.push(lifecycleService.onDidShutdown(() => {
				this.shutdown();
				dispose(toDispose);
			}));
		}

		const compoundRoot = this._options.compoundRoot;
		if (compoundRoot) {
			toDispose.push(compoundRoot.onDidSessionStop(() => this.terminate()));
		}
	}

	getId(): string {
		return this.id;
	}

	setSubId(subId: string | undefined) {
		this._subId = subId;
	}

	get subId(): string | undefined {
		return this._subId;
	}

	get configuration(): IConfig {
		return this._configuration.resolved;
	}

	get unresolvedConfiguration(): IConfig | undefined {
		return this._configuration.unresolved;
	}

	get parentSession(): IDebugSession | undefined {
		return this._options.parentSession;
	}

	get compact(): boolean {
		return !!this._options.compact;
	}

	get compoundRoot(): DebugCompoundRoot | undefined {
		return this._options.compoundRoot;
	}

	setConfiguration(configuration: { resolved: IConfig, unresolved: IConfig | undefined }) {
		this._configuration = configuration;
	}

	getLabel(): string {
		const includeRoot = this.workspaceContextService.getWorkspace().folders.length > 1;
		return includeRoot && this.root ? `${this.name} (${resources.basenameOrAuthority(this.root.uri)})` : this.name;
	}

	setName(name: string): void {
		this._name = name;
		this._onDidChangeName.fire(name);
	}

	get name(): string {
		return this._name || this.configuration.name;
	}

	get state(): State {
		if (!this.initialized) {
			return State.Initializing;
		}
		if (!this.raw) {
			return State.Inactive;
		}

		const focusedThread = this.debugService.getViewModel().focusedThread;
		if (focusedThread && focusedThread.session === this) {
			return focusedThread.stopped ? State.Stopped : State.Running;
		}
		if (this.getAllThreads().some(t => t.stopped)) {
			return State.Stopped;
		}

		return State.Running;
	}

	get capabilities(): DebugProtocol.Capabilities {
		return this.raw ? this.raw.capabilities : Object.create(null);
	}

	//---- events
	get onDidChangeState(): Event<void> {
		return this._onDidChangeState.event;
	}

	get onDidEndAdapter(): Event<AdapterEndEvent | undefined> {
		return this._onDidEndAdapter.event;
	}

	get onDidChangeReplElements(): Event<void> {
		return this._onDidChangeREPLElements.event;
	}

	get onDidChangeName(): Event<string> {
		return this._onDidChangeName.event;
	}

	//---- DAP events

	get onDidCustomEvent(): Event<DebugProtocol.Event> {
		return this._onDidCustomEvent.event;
	}

	get onDidLoadedSource(): Event<LoadedSourceEvent> {
		return this._onDidLoadedSource.event;
	}

	get onDidProgressStart(): Event<DebugProtocol.ProgressStartEvent> {
		return this._onDidProgressStart.event;
	}

	get onDidProgressUpdate(): Event<DebugProtocol.ProgressUpdateEvent> {
		return this._onDidProgressUpdate.event;
	}

	get onDidProgressEnd(): Event<DebugProtocol.ProgressEndEvent> {
		return this._onDidProgressEnd.event;
	}

	//---- DAP requests

	/**
	 * create and initialize a new debug adapter for this session
	 */
	async initialize(dbgr: IDebugger): Promise<void> {

		if (this.raw) {
			// if there was already a connection make sure to remove old listeners
			this.shutdown();
		}

		try {
			const debugAdapter = await dbgr.createDebugAdapter(this);
			this.raw = this.instantiationService.createInstance(RawDebugSession, debugAdapter, dbgr, this.id);

			await this.raw.start();
			this.registerListeners();
			await this.raw!.initialize({
				clientID: 'vscode',
				clientName: this.productService.nameLong,
				adapterID: this.configuration.type,
				pathFormat: 'path',
				linesStartAt1: true,
				columnsStartAt1: true,
				supportsVariableType: true, // #8858
				supportsVariablePaging: true, // #9537
				supportsRunInTerminalRequest: true, // #10574
				locale: platform.locale,
				supportsProgressReporting: true, // #92253
				supportsInvalidatedEvent: true // #106745
			});

			this.initialized = true;
			this._onDidChangeState.fire();
			this.debugService.setExceptionBreakpoints((this.raw && this.raw.capabilities.exceptionBreakpointFilters) || []);
		} catch (err) {
			this.initialized = true;
			this._onDidChangeState.fire();
			this.shutdown();
			throw err;
		}
	}

	/**
	 * launch or attach to the debuggee
	 */
	async launchOrAttach(config: IConfig): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'launch or attach'));
		}
		if (this.parentSession && this.parentSession.state === State.Inactive) {
			throw canceled();
		}

		// __sessionID only used for EH debugging (but we add it always for now...)
		config.__sessionId = this.getId();
		try {
			await this.raw.launchOrAttach(config);
		} catch (err) {
			this.shutdown();
			throw err;
		}
	}

	/**
	 * terminate the current debug adapter session
	 */
	async terminate(restart = false): Promise<void> {
		if (!this.raw) {
			// Adapter went down but it did not send a 'terminated' event, simulate like the event has been sent
			this.onDidExitAdapter();
		}

		this.cancelAllRequests();
		if (this.raw) {
			if (this.raw.capabilities.supportsTerminateRequest && this._configuration.resolved.request === 'launch') {
				await this.raw.terminate(restart);
			} else {
				await this.raw.disconnect({ restart, terminateDebuggee: true });
			}
		}

		if (!restart) {
			this._options.compoundRoot?.sessionStopped();
		}
	}

	/**
	 * end the current debug adapter session
	 */
	async disconnect(restart = false): Promise<void> {
		if (!this.raw) {
			// Adapter went down but it did not send a 'terminated' event, simulate like the event has been sent
			this.onDidExitAdapter();
		}

		this.cancelAllRequests();
		if (this.raw) {
			await this.raw.disconnect({ restart, terminateDebuggee: false });
		}

		if (!restart) {
			this._options.compoundRoot?.sessionStopped();
		}
	}

	/**
	 * restart debug adapter session
	 */
	async restart(): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'restart'));
		}

		this.cancelAllRequests();
		await this.raw.restart({ arguments: this.configuration });
	}

	async sendBreakpoints(modelUri: URI, breakpointsToSend: IBreakpoint[], sourceModified: boolean): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'breakpoints'));
		}

		if (!this.raw.readyForBreakpoints) {
			return Promise.resolve(undefined);
		}

		const rawSource = this.getRawSource(modelUri);
		if (breakpointsToSend.length && !rawSource.adapterData) {
			rawSource.adapterData = breakpointsToSend[0].adapterData;
		}
		// Normalize all drive letters going out from vscode to debug adapters so we are consistent with our resolving #43959
		if (rawSource.path) {
			rawSource.path = normalizeDriveLetter(rawSource.path);
		}

		const response = await this.raw.setBreakpoints({
			source: rawSource,
			lines: breakpointsToSend.map(bp => bp.sessionAgnosticData.lineNumber),
			breakpoints: breakpointsToSend.map(bp => ({ line: bp.sessionAgnosticData.lineNumber, column: bp.sessionAgnosticData.column, condition: bp.condition, hitCondition: bp.hitCondition, logMessage: bp.logMessage })),
			sourceModified
		});
		if (response && response.body) {
			const data = new Map<string, DebugProtocol.Breakpoint>();
			for (let i = 0; i < breakpointsToSend.length; i++) {
				data.set(breakpointsToSend[i].getId(), response.body.breakpoints[i]);
			}

			this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
		}
	}

	async sendFunctionBreakpoints(fbpts: IFunctionBreakpoint[]): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'function breakpoints'));
		}

		if (this.raw.readyForBreakpoints) {
			const response = await this.raw.setFunctionBreakpoints({ breakpoints: fbpts });
			if (response && response.body) {
				const data = new Map<string, DebugProtocol.Breakpoint>();
				for (let i = 0; i < fbpts.length; i++) {
					data.set(fbpts[i].getId(), response.body.breakpoints[i]);
				}
				this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
			}
		}
	}

	async sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'exception breakpoints'));
		}

		if (this.raw.readyForBreakpoints) {
			const args: DebugProtocol.SetExceptionBreakpointsArguments = this.capabilities.supportsExceptionFilterOptions ? {
				filters: [],
				filterOptions: exbpts.map(exb => {
					if (exb.condition) {
						return { filterId: exb.filter, condition: exb.condition };
					}

					return { filterId: exb.filter };
				})
			} : { filters: exbpts.map(exb => exb.filter) };

			const response = await this.raw.setExceptionBreakpoints(args);
			if (response && response.body && response.body.breakpoints) {
				const data = new Map<string, DebugProtocol.Breakpoint>();
				for (let i = 0; i < exbpts.length; i++) {
					data.set(exbpts[i].getId(), response.body.breakpoints[i]);
				}

				this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
			}
		}
	}

	async dataBreakpointInfo(name: string, variablesReference?: number): Promise<{ dataId: string | null, description: string, canPersist?: boolean } | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'data breakpoints info'));
		}
		if (!this.raw.readyForBreakpoints) {
			throw new Error(localize('sessionNotReadyForBreakpoints', "Session is not ready for breakpoints"));
		}

		const response = await this.raw.dataBreakpointInfo({ name, variablesReference });
		return response?.body;
	}

	async sendDataBreakpoints(dataBreakpoints: IDataBreakpoint[]): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'data breakpoints'));
		}

		if (this.raw.readyForBreakpoints) {
			const response = await this.raw.setDataBreakpoints({ breakpoints: dataBreakpoints });
			if (response && response.body) {
				const data = new Map<string, DebugProtocol.Breakpoint>();
				for (let i = 0; i < dataBreakpoints.length; i++) {
					data.set(dataBreakpoints[i].getId(), response.body.breakpoints[i]);
				}
				this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
			}
		}
	}

	async breakpointsLocations(uri: URI, lineNumber: number): Promise<IPosition[]> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'breakpoints locations'));
		}

		const source = this.getRawSource(uri);
		const response = await this.raw.breakpointLocations({ source, line: lineNumber });
		if (!response || !response.body || !response.body.breakpoints) {
			return [];
		}

		const positions = response.body.breakpoints.map(bp => ({ lineNumber: bp.line, column: bp.column || 1 }));

		return distinct(positions, p => `${p.lineNumber}:${p.column}`);
	}

	getDebugProtocolBreakpoint(breakpointId: string): DebugProtocol.Breakpoint | undefined {
		return this.model.getDebugProtocolBreakpoint(breakpointId, this.getId());
	}

	customRequest(request: string, args: any): Promise<DebugProtocol.Response | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", request));
		}

		return this.raw.custom(request, args);
	}

	stackTrace(threadId: number, startFrame: number, levels: number, token: CancellationToken): Promise<DebugProtocol.StackTraceResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'stackTrace'));
		}

		const sessionToken = this.getNewCancellationToken(threadId, token);
		return this.raw.stackTrace({ threadId, startFrame, levels }, sessionToken);
	}

	async exceptionInfo(threadId: number): Promise<IExceptionInfo | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'exceptionInfo'));
		}

		const response = await this.raw.exceptionInfo({ threadId });
		if (response) {
			return {
				id: response.body.exceptionId,
				description: response.body.description,
				breakMode: response.body.breakMode,
				details: response.body.details
			};
		}

		return undefined;
	}

	scopes(frameId: number, threadId: number): Promise<DebugProtocol.ScopesResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'scopes'));
		}

		const token = this.getNewCancellationToken(threadId);
		return this.raw.scopes({ frameId }, token);
	}

	variables(variablesReference: number, threadId: number | undefined, filter: 'indexed' | 'named' | undefined, start: number | undefined, count: number | undefined): Promise<DebugProtocol.VariablesResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'variables'));
		}

		const token = threadId ? this.getNewCancellationToken(threadId) : undefined;
		return this.raw.variables({ variablesReference, filter, start, count }, token);
	}

	evaluate(expression: string, frameId: number, context?: string): Promise<DebugProtocol.EvaluateResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'evaluate'));
		}

		return this.raw.evaluate({ expression, frameId, context });
	}

	async restartFrame(frameId: number, threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'restartFrame'));
		}

		await this.raw.restartFrame({ frameId }, threadId);
	}

	async next(threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'next'));
		}

		await this.raw.next({ threadId });
	}

	async stepIn(threadId: number, targetId?: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'stepIn'));
		}

		await this.raw.stepIn({ threadId, targetId });
	}

	async stepOut(threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'stepOut'));
		}

		await this.raw.stepOut({ threadId });
	}

	async stepBack(threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'stepBack'));
		}

		await this.raw.stepBack({ threadId });
	}

	async continue(threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'continue'));
		}

		await this.raw.continue({ threadId });
	}

	async reverseContinue(threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'reverse continue'));
		}

		await this.raw.reverseContinue({ threadId });
	}

	async pause(threadId: number): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'pause'));
		}

		await this.raw.pause({ threadId });
	}

	async terminateThreads(threadIds?: number[]): Promise<void> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'terminateThreads'));
		}

		await this.raw.terminateThreads({ threadIds });
	}

	setVariable(variablesReference: number, name: string, value: string): Promise<DebugProtocol.SetVariableResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'setVariable'));
		}

		return this.raw.setVariable({ variablesReference, name, value });
	}

	gotoTargets(source: DebugProtocol.Source, line: number, column?: number): Promise<DebugProtocol.GotoTargetsResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'gotoTargets'));
		}

		return this.raw.gotoTargets({ source, line, column });
	}

	goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse | undefined> {
		if (!this.raw) {
			throw new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'goto'));
		}

		return this.raw.goto({ threadId, targetId });
	}

	loadSource(resource: URI): Promise<DebugProtocol.SourceResponse | undefined> {
		if (!this.raw) {
			return Promise.reject(new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'loadSource')));
		}

		const source = this.getSourceForUri(resource);
		let rawSource: DebugProtocol.Source;
		if (source) {
			rawSource = source.raw;
		} else {
			// create a Source
			const data = Source.getEncodedDebugData(resource);
			rawSource = { path: data.path, sourceReference: data.sourceReference };
		}

		return this.raw.source({ sourceReference: rawSource.sourceReference || 0, source: rawSource });
	}

	async getLoadedSources(): Promise<Source[]> {
		if (!this.raw) {
			return Promise.reject(new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'getLoadedSources')));
		}

		const response = await this.raw.loadedSources({});
		if (response && response.body && response.body.sources) {
			return response.body.sources.map(src => this.getSource(src));
		} else {
			return [];
		}
	}

	async completions(frameId: number | undefined, threadId: number, text: string, position: Position, overwriteBefore: number, token: CancellationToken): Promise<DebugProtocol.CompletionsResponse | undefined> {
		if (!this.raw) {
			return Promise.reject(new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'completions')));
		}
		const sessionCancelationToken = this.getNewCancellationToken(threadId, token);

		return this.raw.completions({
			frameId,
			text,
			column: position.column,
			line: position.lineNumber,
		}, sessionCancelationToken);
	}

	async stepInTargets(frameId: number): Promise<{ id: number, label: string }[] | undefined> {
		if (!this.raw) {
			return Promise.reject(new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'stepInTargets')));
		}

		const response = await this.raw.stepInTargets({ frameId });
		return response?.body.targets;
	}

	async cancel(progressId: string): Promise<DebugProtocol.CancelResponse | undefined> {
		if (!this.raw) {
			return Promise.reject(new Error(localize('noDebugAdapter', "No debugger available, can not send '{0}'", 'cancel')));
		}

		return this.raw.cancel({ progressId });
	}

	//---- threads

	getThread(threadId: number): Thread | undefined {
		return this.threads.get(threadId);
	}

	getAllThreads(): IThread[] {
		const result: IThread[] = [];
		this.threads.forEach(t => result.push(t));
		return result;
	}

	clearThreads(removeThreads: boolean, reference: number | undefined = undefined): void {
		if (reference !== undefined && reference !== null) {
			const thread = this.threads.get(reference);
			if (thread) {
				thread.clearCallStack();
				thread.stoppedDetails = undefined;
				thread.stopped = false;

				if (removeThreads) {
					this.threads.delete(reference);
				}
			}
		} else {
			this.threads.forEach(thread => {
				thread.clearCallStack();
				thread.stoppedDetails = undefined;
				thread.stopped = false;
			});

			if (removeThreads) {
				this.threads.clear();
				ExpressionContainer.allValues.clear();
			}
		}
	}

	rawUpdate(data: IRawModelUpdate): void {
		const threadIds: number[] = [];
		data.threads.forEach(thread => {
			threadIds.push(thread.id);
			if (!this.threads.has(thread.id)) {
				// A new thread came in, initialize it.
				this.threads.set(thread.id, new Thread(this, thread.name, thread.id));
			} else if (thread.name) {
				// Just the thread name got updated #18244
				const oldThread = this.threads.get(thread.id);
				if (oldThread) {
					oldThread.name = thread.name;
				}
			}
		});
		this.threads.forEach(t => {
			// Remove all old threads which are no longer part of the update #75980
			if (threadIds.indexOf(t.threadId) === -1) {
				this.threads.delete(t.threadId);
			}
		});

		const stoppedDetails = data.stoppedDetails;
		if (stoppedDetails) {
			// Set the availability of the threads' callstacks depending on
			// whether the thread is stopped or not
			if (stoppedDetails.allThreadsStopped) {
				this.threads.forEach(thread => {
					thread.stoppedDetails = thread.threadId === stoppedDetails.threadId ? stoppedDetails : { reason: undefined };
					thread.stopped = true;
					thread.clearCallStack();
				});
			} else {
				const thread = typeof stoppedDetails.threadId === 'number' ? this.threads.get(stoppedDetails.threadId) : undefined;
				if (thread) {
					// One thread is stopped, only update that thread.
					thread.stoppedDetails = stoppedDetails;
					thread.clearCallStack();
					thread.stopped = true;
				}
			}
		}
	}

	private async fetchThreads(stoppedDetails?: IRawStoppedDetails): Promise<void> {
		if (this.raw) {
			const response = await this.raw.threads();
			if (response && response.body && response.body.threads) {
				this.model.rawUpdate({
					sessionId: this.getId(),
					threads: response.body.threads,
					stoppedDetails
				});
			}
		}
	}

	initializeForTest(raw: RawDebugSession): void {
		this.raw = raw;
		this.registerListeners();
	}

	//---- private

	private registerListeners(): void {
		if (!this.raw) {
			return;
		}

		this.rawListeners.push(this.raw.onDidInitialize(async () => {
			aria.status(localize('debuggingStarted', "Debugging started."));
			const sendConfigurationDone = async () => {
				if (this.raw && this.raw.capabilities.supportsConfigurationDoneRequest) {
					try {
						await this.raw.configurationDone();
					} catch (e) {
						// Disconnect the debug session on configuration done error #10596
						this.notificationService.error(e);
						if (this.raw) {
							this.raw.disconnect({});
						}
					}
				}

				return undefined;
			};

			// Send all breakpoints
			try {
				await this.debugService.sendAllBreakpoints(this);
			} finally {
				await sendConfigurationDone();
				await this.fetchThreads();
			}
		}));

		this.rawListeners.push(this.raw.onDidStop(async event => {
			this.stoppedDetails = event.body;
			await this.fetchThreads(event.body);
			const thread = typeof event.body.threadId === 'number' ? this.getThread(event.body.threadId) : undefined;
			if (thread) {
				// Call fetch call stack twice, the first only return the top stack frame.
				// Second retrieves the rest of the call stack. For performance reasons #25605
				const promises = this.model.fetchCallStack(<Thread>thread);
				const focus = async () => {
					if (!event.body.preserveFocusHint && thread.getCallStack().length) {
						await this.debugService.focusStackFrame(undefined, thread);
						if (thread.stoppedDetails) {
							if (this.configurationService.getValue<IDebugConfiguration>('debug').openDebug === 'openOnDebugBreak') {
								this.viewletService.openViewlet(VIEWLET_ID);
							}

							if (this.configurationService.getValue<IDebugConfiguration>('debug').focusWindowOnBreak) {
								this.hostService.focus({ force: true /* Application may not be active */ });
							}
						}
					}
				};

				await promises.topCallStack;
				focus();
				await promises.wholeCallStack;
				const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
				if (!focusedStackFrame || !focusedStackFrame.source || focusedStackFrame.source.presentationHint === 'deemphasize') {
					// The top stack frame can be deemphesized so try to focus again #68616
					focus();
				}
			}
			this._onDidChangeState.fire();
		}));

		this.rawListeners.push(this.raw.onDidThread(event => {
			if (event.body.reason === 'started') {
				// debounce to reduce threadsRequest frequency and improve performance
				if (!this.fetchThreadsScheduler) {
					this.fetchThreadsScheduler = new RunOnceScheduler(() => {
						this.fetchThreads();
					}, 100);
					this.rawListeners.push(this.fetchThreadsScheduler);
				}
				if (!this.fetchThreadsScheduler.isScheduled()) {
					this.fetchThreadsScheduler.schedule();
				}
			} else if (event.body.reason === 'exited') {
				this.model.clearThreads(this.getId(), true, event.body.threadId);
				const viewModel = this.debugService.getViewModel();
				const focusedThread = viewModel.focusedThread;
				if (focusedThread && event.body.threadId === focusedThread.threadId) {
					// De-focus the thread in case it was focused
					this.debugService.focusStackFrame(undefined, undefined, viewModel.focusedSession, false);
				}
			}
		}));

		this.rawListeners.push(this.raw.onDidTerminateDebugee(async event => {
			aria.status(localize('debuggingStopped', "Debugging stopped."));
			if (event.body && event.body.restart) {
				await this.debugService.restartSession(this, event.body.restart);
			} else if (this.raw) {
				await this.raw.disconnect({ terminateDebuggee: false });
			}
		}));

		this.rawListeners.push(this.raw.onDidContinued(event => {
			const threadId = event.body.allThreadsContinued !== false ? undefined : event.body.threadId;
			if (threadId) {
				const tokens = this.cancellationMap.get(threadId);
				this.cancellationMap.delete(threadId);
				if (tokens) {
					tokens.forEach(t => t.cancel());
				}
			} else {
				this.cancelAllRequests();
			}

			this.model.clearThreads(this.getId(), false, threadId);
			this._onDidChangeState.fire();
		}));

		const outputQueue = new Queue<void>();
		this.rawListeners.push(this.raw.onDidOutput(async event => {
			outputQueue.queue(async () => {
				if (!event.body || !this.raw) {
					return;
				}

				const outputSeverity = event.body.category === 'stderr' ? severity.Error : event.body.category === 'console' ? severity.Warning : severity.Info;
				if (event.body.category === 'telemetry') {
					// only log telemetry events from debug adapter if the debug extension provided the telemetry key
					// and the user opted in telemetry
					const telemetryEndpoint = this.raw.dbgr.getCustomTelemetryEndpoint();
					if (telemetryEndpoint && this.telemetryService.isOptedIn) {
						// __GDPR__TODO__ We're sending events in the name of the debug extension and we can not ensure that those are declared correctly.
						let data = event.body.data;
						if (!telemetryEndpoint.sendErrorTelemetry && event.body.data) {
							data = filterExceptionsFromTelemetry(event.body.data);
						}

						this.customEndpointTelemetryService.publicLog(telemetryEndpoint, event.body.output, data);
					}

					return;
				}

				// Make sure to append output in the correct order by properly waiting on preivous promises #33822
				const source = event.body.source && event.body.line ? {
					lineNumber: event.body.line,
					column: event.body.column ? event.body.column : 1,
					source: this.getSource(event.body.source)
				} : undefined;

				if (event.body.group === 'start' || event.body.group === 'startCollapsed') {
					const expanded = event.body.group === 'start';
					this.repl.startGroup(event.body.output || '', expanded, source);
					return;
				}
				if (event.body.group === 'end') {
					this.repl.endGroup();
					if (!event.body.output) {
						// Only return if the end event does not have additional output in it
						return;
					}
				}

				if (event.body.variablesReference) {
					const container = new ExpressionContainer(this, undefined, event.body.variablesReference, generateUuid());
					await container.getChildren().then(children => {
						children.forEach(child => {
							// Since we can not display multiple trees in a row, we are displaying these variables one after the other (ignoring their names)
							(<any>child).name = null;
							this.appendToRepl(child, outputSeverity, source);
						});
					});
				} else if (typeof event.body.output === 'string') {
					this.appendToRepl(event.body.output, outputSeverity, source);
				}
			});
		}));

		this.rawListeners.push(this.raw.onDidBreakpoint(event => {
			const id = event.body && event.body.breakpoint ? event.body.breakpoint.id : undefined;
			const breakpoint = this.model.getBreakpoints().find(bp => bp.getIdFromAdapter(this.getId()) === id);
			const functionBreakpoint = this.model.getFunctionBreakpoints().find(bp => bp.getIdFromAdapter(this.getId()) === id);
			const dataBreakpoint = this.model.getDataBreakpoints().find(dbp => dbp.getIdFromAdapter(this.getId()) === id);
			const exceptionBreakpoint = this.model.getExceptionBreakpoints().find(excbp => excbp.getIdFromAdapter(this.getId()) === id);

			if (event.body.reason === 'new' && event.body.breakpoint.source && event.body.breakpoint.line) {
				const source = this.getSource(event.body.breakpoint.source);
				const bps = this.model.addBreakpoints(source.uri, [{
					column: event.body.breakpoint.column,
					enabled: true,
					lineNumber: event.body.breakpoint.line,
				}], false);
				if (bps.length === 1) {
					const data = new Map<string, DebugProtocol.Breakpoint>([[bps[0].getId(), event.body.breakpoint]]);
					this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
				}
			}

			if (event.body.reason === 'removed') {
				if (breakpoint) {
					this.model.removeBreakpoints([breakpoint]);
				}
				if (functionBreakpoint) {
					this.model.removeFunctionBreakpoints(functionBreakpoint.getId());
				}
				if (dataBreakpoint) {
					this.model.removeDataBreakpoints(dataBreakpoint.getId());
				}
			}

			if (event.body.reason === 'changed') {
				if (breakpoint) {
					if (!breakpoint.column) {
						event.body.breakpoint.column = undefined;
					}
					const data = new Map<string, DebugProtocol.Breakpoint>([[breakpoint.getId(), event.body.breakpoint]]);
					this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
				}
				if (functionBreakpoint) {
					const data = new Map<string, DebugProtocol.Breakpoint>([[functionBreakpoint.getId(), event.body.breakpoint]]);
					this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
				}
				if (dataBreakpoint) {
					const data = new Map<string, DebugProtocol.Breakpoint>([[dataBreakpoint.getId(), event.body.breakpoint]]);
					this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
				}
				if (exceptionBreakpoint) {
					const data = new Map<string, DebugProtocol.Breakpoint>([[exceptionBreakpoint.getId(), event.body.breakpoint]]);
					this.model.setBreakpointSessionData(this.getId(), this.capabilities, data);
				}
			}
		}));

		this.rawListeners.push(this.raw.onDidLoadedSource(event => {
			this._onDidLoadedSource.fire({
				reason: event.body.reason,
				source: this.getSource(event.body.source)
			});
		}));

		this.rawListeners.push(this.raw.onDidCustomEvent(event => {
			this._onDidCustomEvent.fire(event);
		}));

		this.rawListeners.push(this.raw.onDidProgressStart(event => {
			this._onDidProgressStart.fire(event);
		}));
		this.rawListeners.push(this.raw.onDidProgressUpdate(event => {
			this._onDidProgressUpdate.fire(event);
		}));
		this.rawListeners.push(this.raw.onDidProgressEnd(event => {
			this._onDidProgressEnd.fire(event);
		}));
		this.rawListeners.push(this.raw.onDidInvalidated(async event => {
			if (!(event.body.areas && event.body.areas.length === 1 && (event.body.areas[0] === 'variables' || event.body.areas[0] === 'watch'))) {
				// If invalidated event only requires to update variables or watch, do that, otherwise refatch threads https://github.com/microsoft/vscode/issues/106745
				this.cancelAllRequests();
				this.model.clearThreads(this.getId(), true);
				await this.fetchThreads(this.stoppedDetails);
			}

			const viewModel = this.debugService.getViewModel();
			if (viewModel.focusedSession === this) {
				viewModel.updateViews();
			}
		}));

		this.rawListeners.push(this.raw.onDidExitAdapter(event => this.onDidExitAdapter(event)));
	}

	private onDidExitAdapter(event?: AdapterEndEvent): void {
		this.initialized = true;
		this.model.setBreakpointSessionData(this.getId(), this.capabilities, undefined);
		this.shutdown();
		this._onDidEndAdapter.fire(event);
	}

	// Disconnects and clears state. Session can be initialized again for a new connection.
	private shutdown(): void {
		dispose(this.rawListeners);
		if (this.raw) {
			this.raw.disconnect({});
			this.raw.dispose();
			this.raw = undefined;
		}
		this.fetchThreadsScheduler = undefined;
		this.model.clearThreads(this.getId(), true);
		this._onDidChangeState.fire();
	}

	//---- sources

	getSourceForUri(uri: URI): Source | undefined {
		return this.sources.get(this.uriIdentityService.asCanonicalUri(uri).toString());
	}

	getSource(raw?: DebugProtocol.Source): Source {
		let source = new Source(raw, this.getId(), this.uriIdentityService);
		const uriKey = source.uri.toString();
		const found = this.sources.get(uriKey);
		if (found) {
			source = found;
			// merge attributes of new into existing
			source.raw = mixin(source.raw, raw);
			if (source.raw && raw) {
				// Always take the latest presentation hint from adapter #42139
				source.raw.presentationHint = raw.presentationHint;
			}
		} else {
			this.sources.set(uriKey, source);
		}

		return source;
	}

	private getRawSource(uri: URI): DebugProtocol.Source {
		const source = this.getSourceForUri(uri);
		if (source) {
			return source.raw;
		} else {
			const data = Source.getEncodedDebugData(uri);
			return { name: data.name, path: data.path, sourceReference: data.sourceReference };
		}
	}

	private getNewCancellationToken(threadId: number, token?: CancellationToken): CancellationToken {
		const tokenSource = new CancellationTokenSource(token);
		const tokens = this.cancellationMap.get(threadId) || [];
		tokens.push(tokenSource);
		this.cancellationMap.set(threadId, tokens);

		return tokenSource.token;
	}

	private cancelAllRequests(): void {
		this.cancellationMap.forEach(tokens => tokens.forEach(t => t.cancel()));
		this.cancellationMap.clear();
	}

	// REPL

	getReplElements(): IReplElement[] {
		return this.repl.getReplElements();
	}

	hasSeparateRepl(): boolean {
		return !this.parentSession || this._options.repl !== 'mergeWithParent';
	}

	removeReplExpressions(): void {
		this.repl.removeReplExpressions();
	}

	async addReplExpression(stackFrame: IStackFrame | undefined, name: string): Promise<void> {
		await this.repl.addReplExpression(this, stackFrame, name);
		// Evaluate all watch expressions and fetch variables again since repl evaluation might have changed some.
		this.debugService.getViewModel().updateViews();
	}

	appendToRepl(data: string | IExpression, severity: severity, source?: IReplElementSource): void {
		this.repl.appendToRepl(this, data, severity, source);
	}

	logToRepl(sev: severity, args: any[], frame?: { uri: URI, line: number, column: number }) {
		this.repl.logToRepl(this, sev, args, frame);
	}
}
