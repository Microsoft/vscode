/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import * as objects from 'vs/base/common/objects';
import { Action } from 'vs/base/common/actions';
import * as errors from 'vs/base/common/errors';
import { ICustomEndpointTelemetryService, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { formatPII, isUri } from 'vs/workbench/contrib/debug/common/debugUtils';
import { IDebugAdapter, IConfig, AdapterEndEvent, IDebugger } from 'vs/workbench/contrib/debug/common/debug';
import { IExtensionHostDebugService, IOpenExtensionWindowResult } from 'vs/platform/debug/common/extensionHostDebug';
import { URI } from 'vs/base/common/uri';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';

/**
 * This interface represents a single command line argument split into a "prefix" and a "path" half.
 * The optional "prefix" contains arbitrary text and the optional "path" contains a file system path.
 * Concatenating both results in the original command line argument.
 */
interface ILaunchVSCodeArgument {
	prefix?: string;
	path?: string;
}

interface ILaunchVSCodeArguments {
	args: ILaunchVSCodeArgument[];
	debugRenderer?: boolean;
	env?: { [key: string]: string | null; };
}

/**
 * Encapsulates the DebugAdapter lifecycle and some idiosyncrasies of the Debug Adapter Protocol.
 */
export class RawDebugSession implements IDisposable {

	private allThreadsContinued = true;
	private _readyForBreakpoints = false;
	private _capabilities: DebugProtocol.Capabilities;

	// shutdown
	private debugAdapterStopped = false;
	private inShutdown = false;
	private terminated = false;
	private firedAdapterExitEvent = false;

	// telemetry
	private startTime = 0;
	private didReceiveStoppedEvent = false;

	// DAP events
	private readonly _onDidInitialize = new Emitter<DebugProtocol.InitializedEvent>();
	private readonly _onDidStop = new Emitter<DebugProtocol.StoppedEvent>();
	private readonly _onDidContinued = new Emitter<DebugProtocol.ContinuedEvent>();
	private readonly _onDidTerminateDebugee = new Emitter<DebugProtocol.TerminatedEvent>();
	private readonly _onDidExitDebugee = new Emitter<DebugProtocol.ExitedEvent>();
	private readonly _onDidThread = new Emitter<DebugProtocol.ThreadEvent>();
	private readonly _onDidOutput = new Emitter<DebugProtocol.OutputEvent>();
	private readonly _onDidBreakpoint = new Emitter<DebugProtocol.BreakpointEvent>();
	private readonly _onDidLoadedSource = new Emitter<DebugProtocol.LoadedSourceEvent>();
	private readonly _onDidProgressStart = new Emitter<DebugProtocol.ProgressStartEvent>();
	private readonly _onDidProgressUpdate = new Emitter<DebugProtocol.ProgressUpdateEvent>();
	private readonly _onDidProgressEnd = new Emitter<DebugProtocol.ProgressEndEvent>();
	private readonly _onDidInvalidated = new Emitter<DebugProtocol.InvalidatedEvent>();
	private readonly _onDidCustomEvent = new Emitter<DebugProtocol.Event>();
	private readonly _onDidEvent = new Emitter<DebugProtocol.Event>();

	// DA events
	private readonly _onDidExitAdapter = new Emitter<AdapterEndEvent>();
	private debugAdapter: IDebugAdapter | null;

	private toDispose: IDisposable[] = [];

	constructor(
		debugAdapter: IDebugAdapter,
		public readonly dbgr: IDebugger,
		private readonly sessionId: string,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ICustomEndpointTelemetryService private readonly customTelemetryService: ICustomEndpointTelemetryService,
		@IExtensionHostDebugService private readonly extensionHostDebugService: IExtensionHostDebugService,
		@IOpenerService private readonly openerService: IOpenerService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogSerivce: IDialogService,
	) {
		this.debugAdapter = debugAdapter;
		this._capabilities = Object.create(null);

		this.toDispose.push(this.debugAdapter.onError(err => {
			this.shutdown(err);
		}));

		this.toDispose.push(this.debugAdapter.onExit(code => {
			if (code !== 0) {
				this.shutdown(new Error(`exit code: ${code}`));
			} else {
				// normal exit
				this.shutdown();
			}
		}));

		this.debugAdapter.onEvent(event => {
			switch (event.event) {
				case 'initialized':
					this._readyForBreakpoints = true;
					this._onDidInitialize.fire(event);
					break;
				case 'loadedSource':
					this._onDidLoadedSource.fire(<DebugProtocol.LoadedSourceEvent>event);
					break;
				case 'capabilities':
					if (event.body) {
						const capabilities = (<DebugProtocol.CapabilitiesEvent>event).body.capabilities;
						this.mergeCapabilities(capabilities);
					}
					break;
				case 'stopped':
					this.didReceiveStoppedEvent = true;		// telemetry: remember that debugger stopped successfully
					this._onDidStop.fire(<DebugProtocol.StoppedEvent>event);
					break;
				case 'continued':
					this.allThreadsContinued = (<DebugProtocol.ContinuedEvent>event).body.allThreadsContinued === false ? false : true;
					this._onDidContinued.fire(<DebugProtocol.ContinuedEvent>event);
					break;
				case 'thread':
					this._onDidThread.fire(<DebugProtocol.ThreadEvent>event);
					break;
				case 'output':
					this._onDidOutput.fire(<DebugProtocol.OutputEvent>event);
					break;
				case 'breakpoint':
					this._onDidBreakpoint.fire(<DebugProtocol.BreakpointEvent>event);
					break;
				case 'terminated':
					this._onDidTerminateDebugee.fire(<DebugProtocol.TerminatedEvent>event);
					break;
				case 'exit':
					this._onDidExitDebugee.fire(<DebugProtocol.ExitedEvent>event);
					break;
				case 'progressStart':
					this._onDidProgressStart.fire(event as DebugProtocol.ProgressStartEvent);
					break;
				case 'progressUpdate':
					this._onDidProgressUpdate.fire(event as DebugProtocol.ProgressUpdateEvent);
					break;
				case 'progressEnd':
					this._onDidProgressEnd.fire(event as DebugProtocol.ProgressEndEvent);
					break;
				case 'invalidated':
					this._onDidInvalidated.fire(event as DebugProtocol.InvalidatedEvent);
					break;
				case 'process':
					break;
				case 'module':
					break;
				default:
					this._onDidCustomEvent.fire(event);
					break;
			}
			this._onDidEvent.fire(event);
		});

		this.debugAdapter.onRequest(request => this.dispatchRequest(request, dbgr));
	}

	get onDidExitAdapter(): Event<AdapterEndEvent> {
		return this._onDidExitAdapter.event;
	}

	get capabilities(): DebugProtocol.Capabilities {
		return this._capabilities;
	}

	/**
	 * DA is ready to accepts setBreakpoint requests.
	 * Becomes true after "initialized" events has been received.
	 */
	get readyForBreakpoints(): boolean {
		return this._readyForBreakpoints;
	}

	//---- DAP events

	get onDidInitialize(): Event<DebugProtocol.InitializedEvent> {
		return this._onDidInitialize.event;
	}

	get onDidStop(): Event<DebugProtocol.StoppedEvent> {
		return this._onDidStop.event;
	}

	get onDidContinued(): Event<DebugProtocol.ContinuedEvent> {
		return this._onDidContinued.event;
	}

	get onDidTerminateDebugee(): Event<DebugProtocol.TerminatedEvent> {
		return this._onDidTerminateDebugee.event;
	}

	get onDidExitDebugee(): Event<DebugProtocol.ExitedEvent> {
		return this._onDidExitDebugee.event;
	}

	get onDidThread(): Event<DebugProtocol.ThreadEvent> {
		return this._onDidThread.event;
	}

	get onDidOutput(): Event<DebugProtocol.OutputEvent> {
		return this._onDidOutput.event;
	}

	get onDidBreakpoint(): Event<DebugProtocol.BreakpointEvent> {
		return this._onDidBreakpoint.event;
	}

	get onDidLoadedSource(): Event<DebugProtocol.LoadedSourceEvent> {
		return this._onDidLoadedSource.event;
	}

	get onDidCustomEvent(): Event<DebugProtocol.Event> {
		return this._onDidCustomEvent.event;
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

	get onDidInvalidated(): Event<DebugProtocol.InvalidatedEvent> {
		return this._onDidInvalidated.event;
	}

	get onDidEvent(): Event<DebugProtocol.Event> {
		return this._onDidEvent.event;
	}

	//---- DebugAdapter lifecycle

	/**
	 * Starts the underlying debug adapter and tracks the session time for telemetry.
	 */
	async start(): Promise<void> {
		if (!this.debugAdapter) {
			return Promise.reject(new Error(nls.localize('noDebugAdapterStart', "No debug adapter, can not start debug session.")));
		}

		await this.debugAdapter.startSession();
		this.startTime = new Date().getTime();
	}

	/**
	 * Send client capabilities to the debug adapter and receive DA capabilities in return.
	 */
	async initialize(args: DebugProtocol.InitializeRequestArguments): Promise<DebugProtocol.InitializeResponse | undefined> {
		const response = await this.send('initialize', args);
		if (response) {
			this.mergeCapabilities(response.body);
		}

		return response;
	}

	/**
	 * Terminate the debuggee and shutdown the adapter
	 */
	disconnect(args: DebugProtocol.DisconnectArguments): Promise<any> {
		const terminateDebuggee = this.capabilities.supportTerminateDebuggee ? args.terminateDebuggee : undefined;
		return this.shutdown(undefined, args.restart, terminateDebuggee);
	}

	//---- DAP requests

	async launchOrAttach(config: IConfig): Promise<DebugProtocol.Response | undefined> {
		const response = await this.send(config.request, config);
		if (response) {
			this.mergeCapabilities(response.body);
		}

		return response;
	}

	/**
	 * Try killing the debuggee softly...
	 */
	terminate(restart = false): Promise<DebugProtocol.TerminateResponse | undefined> {
		if (this.capabilities.supportsTerminateRequest) {
			if (!this.terminated) {
				this.terminated = true;
				return this.send('terminate', { restart }, undefined, 2000);
			}
			return this.disconnect({ terminateDebuggee: true, restart });
		}
		return Promise.reject(new Error('terminated not supported'));
	}

	restart(args: DebugProtocol.RestartArguments): Promise<DebugProtocol.RestartResponse | undefined> {
		if (this.capabilities.supportsRestartRequest) {
			return this.send('restart', args);
		}
		return Promise.reject(new Error('restart not supported'));
	}

	async next(args: DebugProtocol.NextArguments): Promise<DebugProtocol.NextResponse | undefined> {
		const response = await this.send('next', args);
		this.fireSimulatedContinuedEvent(args.threadId);
		return response;
	}

	async stepIn(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse | undefined> {
		const response = await this.send('stepIn', args);
		this.fireSimulatedContinuedEvent(args.threadId);
		return response;
	}

	async stepOut(args: DebugProtocol.StepOutArguments): Promise<DebugProtocol.StepOutResponse | undefined> {
		const response = await this.send('stepOut', args);
		this.fireSimulatedContinuedEvent(args.threadId);
		return response;
	}

	async continue(args: DebugProtocol.ContinueArguments): Promise<DebugProtocol.ContinueResponse | undefined> {
		const response = await this.send<DebugProtocol.ContinueResponse>('continue', args);
		if (response && response.body && response.body.allThreadsContinued !== undefined) {
			this.allThreadsContinued = response.body.allThreadsContinued;
		}
		this.fireSimulatedContinuedEvent(args.threadId, this.allThreadsContinued);

		return response;
	}

	pause(args: DebugProtocol.PauseArguments): Promise<DebugProtocol.PauseResponse | undefined> {
		return this.send('pause', args);
	}

	terminateThreads(args: DebugProtocol.TerminateThreadsArguments): Promise<DebugProtocol.TerminateThreadsResponse | undefined> {
		if (this.capabilities.supportsTerminateThreadsRequest) {
			return this.send('terminateThreads', args);
		}
		return Promise.reject(new Error('terminateThreads not supported'));
	}

	setVariable(args: DebugProtocol.SetVariableArguments): Promise<DebugProtocol.SetVariableResponse | undefined> {
		if (this.capabilities.supportsSetVariable) {
			return this.send<DebugProtocol.SetVariableResponse>('setVariable', args);
		}
		return Promise.reject(new Error('setVariable not supported'));
	}

	async restartFrame(args: DebugProtocol.RestartFrameArguments, threadId: number): Promise<DebugProtocol.RestartFrameResponse | undefined> {
		if (this.capabilities.supportsRestartFrame) {
			const response = await this.send('restartFrame', args);
			this.fireSimulatedContinuedEvent(threadId);
			return response;
		}
		return Promise.reject(new Error('restartFrame not supported'));
	}

	stepInTargets(args: DebugProtocol.StepInTargetsArguments): Promise<DebugProtocol.StepInTargetsResponse | undefined> {
		if (this.capabilities.supportsStepInTargetsRequest) {
			return this.send('stepInTargets', args);
		}
		return Promise.reject(new Error('stepInTargets not supported'));
	}

	completions(args: DebugProtocol.CompletionsArguments, token: CancellationToken): Promise<DebugProtocol.CompletionsResponse | undefined> {
		if (this.capabilities.supportsCompletionsRequest) {
			return this.send<DebugProtocol.CompletionsResponse>('completions', args, token);
		}
		return Promise.reject(new Error('completions not supported'));
	}

	setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Promise<DebugProtocol.SetBreakpointsResponse | undefined> {
		return this.send<DebugProtocol.SetBreakpointsResponse>('setBreakpoints', args);
	}

	setFunctionBreakpoints(args: DebugProtocol.SetFunctionBreakpointsArguments): Promise<DebugProtocol.SetFunctionBreakpointsResponse | undefined> {
		if (this.capabilities.supportsFunctionBreakpoints) {
			return this.send<DebugProtocol.SetFunctionBreakpointsResponse>('setFunctionBreakpoints', args);
		}
		return Promise.reject(new Error('setFunctionBreakpoints not supported'));
	}

	dataBreakpointInfo(args: DebugProtocol.DataBreakpointInfoArguments): Promise<DebugProtocol.DataBreakpointInfoResponse | undefined> {
		if (this.capabilities.supportsDataBreakpoints) {
			return this.send<DebugProtocol.DataBreakpointInfoResponse>('dataBreakpointInfo', args);
		}
		return Promise.reject(new Error('dataBreakpointInfo not supported'));
	}

	setDataBreakpoints(args: DebugProtocol.SetDataBreakpointsArguments): Promise<DebugProtocol.SetDataBreakpointsResponse | undefined> {
		if (this.capabilities.supportsDataBreakpoints) {
			return this.send<DebugProtocol.SetDataBreakpointsResponse>('setDataBreakpoints', args);
		}
		return Promise.reject(new Error('setDataBreakpoints not supported'));
	}

	setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<DebugProtocol.SetExceptionBreakpointsResponse | undefined> {
		return this.send<DebugProtocol.SetExceptionBreakpointsResponse>('setExceptionBreakpoints', args);
	}

	breakpointLocations(args: DebugProtocol.BreakpointLocationsArguments): Promise<DebugProtocol.BreakpointLocationsResponse | undefined> {
		if (this.capabilities.supportsBreakpointLocationsRequest) {
			return this.send('breakpointLocations', args);
		}
		return Promise.reject(new Error('breakpointLocations is not supported'));
	}

	configurationDone(): Promise<DebugProtocol.ConfigurationDoneResponse | undefined> {
		if (this.capabilities.supportsConfigurationDoneRequest) {
			return this.send('configurationDone', null);
		}
		return Promise.reject(new Error('configurationDone not supported'));
	}

	stackTrace(args: DebugProtocol.StackTraceArguments, token: CancellationToken): Promise<DebugProtocol.StackTraceResponse | undefined> {
		return this.send<DebugProtocol.StackTraceResponse>('stackTrace', args, token);
	}

	exceptionInfo(args: DebugProtocol.ExceptionInfoArguments): Promise<DebugProtocol.ExceptionInfoResponse | undefined> {
		if (this.capabilities.supportsExceptionInfoRequest) {
			return this.send<DebugProtocol.ExceptionInfoResponse>('exceptionInfo', args);
		}
		return Promise.reject(new Error('exceptionInfo not supported'));
	}

	scopes(args: DebugProtocol.ScopesArguments, token: CancellationToken): Promise<DebugProtocol.ScopesResponse | undefined> {
		return this.send<DebugProtocol.ScopesResponse>('scopes', args, token);
	}

	variables(args: DebugProtocol.VariablesArguments, token?: CancellationToken): Promise<DebugProtocol.VariablesResponse | undefined> {
		return this.send<DebugProtocol.VariablesResponse>('variables', args, token);
	}

	source(args: DebugProtocol.SourceArguments): Promise<DebugProtocol.SourceResponse | undefined> {
		return this.send<DebugProtocol.SourceResponse>('source', args);
	}

	loadedSources(args: DebugProtocol.LoadedSourcesArguments): Promise<DebugProtocol.LoadedSourcesResponse | undefined> {
		if (this.capabilities.supportsLoadedSourcesRequest) {
			return this.send<DebugProtocol.LoadedSourcesResponse>('loadedSources', args);
		}
		return Promise.reject(new Error('loadedSources not supported'));
	}

	threads(): Promise<DebugProtocol.ThreadsResponse | undefined> {
		return this.send<DebugProtocol.ThreadsResponse>('threads', null);
	}

	evaluate(args: DebugProtocol.EvaluateArguments): Promise<DebugProtocol.EvaluateResponse | undefined> {
		return this.send<DebugProtocol.EvaluateResponse>('evaluate', args);
	}

	async stepBack(args: DebugProtocol.StepBackArguments): Promise<DebugProtocol.StepBackResponse | undefined> {
		if (this.capabilities.supportsStepBack) {
			const response = await this.send('stepBack', args);
			this.fireSimulatedContinuedEvent(args.threadId);
			return response;
		}
		return Promise.reject(new Error('stepBack not supported'));
	}

	async reverseContinue(args: DebugProtocol.ReverseContinueArguments): Promise<DebugProtocol.ReverseContinueResponse | undefined> {
		if (this.capabilities.supportsStepBack) {
			const response = await this.send('reverseContinue', args);
			this.fireSimulatedContinuedEvent(args.threadId);
			return response;
		}
		return Promise.reject(new Error('reverseContinue not supported'));
	}

	gotoTargets(args: DebugProtocol.GotoTargetsArguments): Promise<DebugProtocol.GotoTargetsResponse | undefined> {
		if (this.capabilities.supportsGotoTargetsRequest) {
			return this.send('gotoTargets', args);
		}
		return Promise.reject(new Error('gotoTargets is not supported'));
	}

	async goto(args: DebugProtocol.GotoArguments): Promise<DebugProtocol.GotoResponse | undefined> {
		if (this.capabilities.supportsGotoTargetsRequest) {
			const response = await this.send('goto', args);
			this.fireSimulatedContinuedEvent(args.threadId);
			return response;
		}

		return Promise.reject(new Error('goto is not supported'));
	}

	cancel(args: DebugProtocol.CancelArguments): Promise<DebugProtocol.CancelResponse | undefined> {
		return this.send('cancel', args);
	}

	custom(request: string, args: any): Promise<DebugProtocol.Response | undefined> {
		return this.send(request, args);
	}

	//---- private

	private async shutdown(error?: Error, restart = false, terminateDebuggee: boolean | undefined = undefined): Promise<any> {
		if (!this.inShutdown) {
			this.inShutdown = true;
			if (this.debugAdapter) {
				try {
					const args = typeof terminateDebuggee === 'boolean' ? { restart, terminateDebuggee } : { restart };
					this.send('disconnect', args, undefined, 2000);
				} catch (e) {
					// Catch the potential 'disconnect' error - no need to show it to the user since the adapter is shutting down
				} finally {
					this.stopAdapter(error);
				}
			} else {
				return this.stopAdapter(error);
			}
		}
	}

	private async stopAdapter(error?: Error): Promise<any> {
		try {
			if (this.debugAdapter) {
				const da = this.debugAdapter;
				this.debugAdapter = null;
				await da.stopSession();
				this.debugAdapterStopped = true;
			}
		} finally {
			this.fireAdapterExitEvent(error);
		}
	}

	private fireAdapterExitEvent(error?: Error): void {
		if (!this.firedAdapterExitEvent) {
			this.firedAdapterExitEvent = true;

			const e: AdapterEndEvent = {
				emittedStopped: this.didReceiveStoppedEvent,
				sessionLengthInSeconds: (new Date().getTime() - this.startTime) / 1000
			};
			if (error && !this.debugAdapterStopped) {
				e.error = error;
			}
			this._onDidExitAdapter.fire(e);
		}
	}

	private async dispatchRequest(request: DebugProtocol.Request, dbgr: IDebugger): Promise<void> {

		const response: DebugProtocol.Response = {
			type: 'response',
			seq: 0,
			command: request.command,
			request_seq: request.seq,
			success: true
		};

		const safeSendResponse = (response: DebugProtocol.Response) => this.debugAdapter && this.debugAdapter.sendResponse(response);

		switch (request.command) {
			case 'launchVSCode':
				try {
					let result = await this.launchVsCode(<ILaunchVSCodeArguments>request.arguments);
					if (!result.success) {
						const showResult = await this.dialogSerivce.show(Severity.Warning, nls.localize('canNotStart', "The debugger needs to open a new tab or window for the debuggee but the browser prevented this. You must give permission to continue."),
							[nls.localize('continue', "Continue"), nls.localize('cancel', "Cancel")], { cancelId: 1 });
						if (showResult.choice === 0) {
							result = await this.launchVsCode(<ILaunchVSCodeArguments>request.arguments);
						} else {
							response.success = false;
							safeSendResponse(response);
							await this.shutdown();
						}
					}
					response.body = {
						rendererDebugPort: result.rendererDebugPort,
					};
					safeSendResponse(response);
				} catch (err) {
					response.success = false;
					response.message = err.message;
					safeSendResponse(response);
				}
				break;
			case 'runInTerminal':
				try {
					const shellProcessId = await dbgr.runInTerminal(request.arguments as DebugProtocol.RunInTerminalRequestArguments, this.sessionId);
					const resp = response as DebugProtocol.RunInTerminalResponse;
					resp.body = {};
					if (typeof shellProcessId === 'number') {
						resp.body.shellProcessId = shellProcessId;
					}
					safeSendResponse(resp);
				} catch (err) {
					response.success = false;
					response.message = err.message;
					safeSendResponse(response);
				}
				break;
			default:
				response.success = false;
				response.message = `unknown request '${request.command}'`;
				safeSendResponse(response);
				break;
		}
	}

	private launchVsCode(vscodeArgs: ILaunchVSCodeArguments): Promise<IOpenExtensionWindowResult> {

		const args: string[] = [];

		for (let arg of vscodeArgs.args) {
			const a2 = (arg.prefix || '') + (arg.path || '');
			const match = /^--(.+)=(.+)$/.exec(a2);
			if (match && match.length === 3) {
				const key = match[1];
				let value = match[2];

				if ((key === 'file-uri' || key === 'folder-uri') && !isUri(arg.path)) {
					value = URI.file(value).toString();
				}
				args.push(`--${key}=${value}`);
			} else {
				args.push(a2);
			}
		}

		return this.extensionHostDebugService.openExtensionDevelopmentHostWindow(args, vscodeArgs.env, !!vscodeArgs.debugRenderer);
	}

	private send<R extends DebugProtocol.Response>(command: string, args: any, token?: CancellationToken, timeout?: number): Promise<R | undefined> {
		return new Promise<DebugProtocol.Response | undefined>((completeDispatch, errorDispatch) => {
			if (!this.debugAdapter) {
				if (this.inShutdown) {
					// We are in shutdown silently complete
					completeDispatch(undefined);
				} else {
					errorDispatch(new Error(nls.localize('noDebugAdapter', "No debugger available found. Can not send '{0}'.", command)));
				}
				return;
			}

			let cancelationListener: IDisposable;
			const requestId = this.debugAdapter.sendRequest(command, args, (response: DebugProtocol.Response) => {
				if (cancelationListener) {
					cancelationListener.dispose();
				}

				if (response.success) {
					completeDispatch(response);
				} else {
					errorDispatch(response);
				}
			}, timeout);

			if (token) {
				cancelationListener = token.onCancellationRequested(() => {
					cancelationListener.dispose();
					if (this.capabilities.supportsCancelRequest) {
						this.cancel({ requestId });
					}
				});
			}
		}).then(undefined, err => Promise.reject(this.handleErrorResponse(err)));
	}

	private handleErrorResponse(errorResponse: DebugProtocol.Response): Error {

		if (errorResponse.command === 'canceled' && errorResponse.message === 'canceled') {
			return errors.canceled();
		}

		const error: DebugProtocol.Message | undefined = errorResponse?.body?.error;
		const errorMessage = errorResponse?.message || '';

		if (error && error.sendTelemetry) {
			const telemetryMessage = error ? formatPII(error.format, true, error.variables) : errorMessage;
			this.telemetryDebugProtocolErrorResponse(telemetryMessage);
		}

		const userMessage = error ? formatPII(error.format, false, error.variables) : errorMessage;
		const url = error?.url;
		if (error && url) {
			const label = error.urlLabel ? error.urlLabel : nls.localize('moreInfo', "More Info");
			return errors.createErrorWithActions(userMessage, {
				actions: [new Action('debug.moreInfo', label, undefined, true, async () => {
					this.openerService.open(URI.parse(url));
				})]
			});
		}
		if (error && error.format && error.showUser) {
			this.notificationService.error(userMessage);
		}

		return new Error(userMessage);
	}

	private mergeCapabilities(capabilities: DebugProtocol.Capabilities | undefined): void {
		if (capabilities) {
			this._capabilities = objects.mixin(this._capabilities, capabilities);
		}
	}

	private fireSimulatedContinuedEvent(threadId: number, allThreadsContinued = false): void {
		this._onDidContinued.fire({
			type: 'event',
			event: 'continued',
			body: {
				threadId,
				allThreadsContinued
			},
			seq: undefined!
		});
	}

	private telemetryDebugProtocolErrorResponse(telemetryMessage: string | undefined) {
		/* __GDPR__
			"debugProtocolErrorResponse" : {
				"error" : { "classification": "CallstackOrException", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLogError('debugProtocolErrorResponse', { error: telemetryMessage });
		const telemetryEndpoint = this.dbgr.getCustomTelemetryEndpoint();
		if (telemetryEndpoint) {
			/* __GDPR__TODO__
				The message is sent in the name of the adapter but the adapter doesn't know about it.
				However, since adapters are an open-ended set, we can not declared the events statically either.
			*/
			this.customTelemetryService.publicLogError(telemetryEndpoint, 'debugProtocolErrorResponse', { error: telemetryMessage });
		}
	}

	dispose(): void {
		dispose(this.toDispose);
	}
}
