/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//
// ############################################################################
//
//						! USED FOR RUNNING VSCODE OUT OF SOURCES FOR WEB !
//										! DO NOT REMOVE !
//
// ############################################################################
//

import * as vscode from 'vscode';
import { MemFS } from './memfs';

declare const navigator: unknown;

export function activate(context: vscode.ExtensionContext) {
	if (typeof navigator === 'object') {	// do not run under node.js
		const memFs = enableFs(context);

		if (vscode.workspace.workspaceFolders?.some(f => f.uri.scheme === MemFS.scheme)) {
			memFs.seed();
			enableProblems(context);
			enableTasks();
			enableDebug(context, memFs);

			vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`memfs:/sample-folder/large.ts`));
		}
	}
}

function enableFs(context: vscode.ExtensionContext): MemFS {
	const memFs = new MemFS();
	context.subscriptions.push(memFs);

	return memFs;
}

function enableProblems(context: vscode.ExtensionContext): void {
	const collection = vscode.languages.createDiagnosticCollection('test');
	if (vscode.window.activeTextEditor) {
		updateDiagnostics(vscode.window.activeTextEditor.document, collection);
	}
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			updateDiagnostics(editor.document, collection);
		}
	}));
}

function updateDiagnostics(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
	if (document && document.fileName === '/sample-folder/large.ts') {
		collection.set(document.uri, [{
			code: '',
			message: 'cannot assign twice to immutable variable `storeHouses`',
			range: new vscode.Range(new vscode.Position(4, 12), new vscode.Position(4, 32)),
			severity: vscode.DiagnosticSeverity.Error,
			source: '',
			relatedInformation: [
				new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 9))), 'first assignment to `x`')
			]
		}, {
			code: '',
			message: 'function does not follow naming conventions',
			range: new vscode.Range(new vscode.Position(7, 10), new vscode.Position(7, 23)),
			severity: vscode.DiagnosticSeverity.Warning,
			source: ''
		}]);
	} else {
		collection.clear();
	}
}

function enableTasks(): void {

	interface CustomBuildTaskDefinition extends vscode.TaskDefinition {
		/**
		 * The build flavor. Should be either '32' or '64'.
		 */
		flavor: string;

		/**
		 * Additional build flags
		 */
		flags?: string[];
	}

	class CustomBuildTaskProvider implements vscode.TaskProvider {
		static CustomBuildScriptType: string = 'custombuildscript';
		private tasks: vscode.Task[] | undefined;

		// We use a CustomExecution task when state needs to be shared accross runs of the task or when
		// the task requires use of some VS Code API to run.
		// If you don't need to share state between runs and if you don't need to execute VS Code API in your task,
		// then a simple ShellExecution or ProcessExecution should be enough.
		// Since our build has this shared state, the CustomExecution is used below.
		private sharedState: string | undefined;

		constructor(private workspaceRoot: string) { }

		public async provideTasks(): Promise<vscode.Task[]> {
			return this.getTasks();
		}

		public resolveTask(_task: vscode.Task): vscode.Task | undefined {
			const flavor: string = _task.definition.flavor;
			if (flavor) {
				const definition: CustomBuildTaskDefinition = <any>_task.definition;
				return this.getTask(definition.flavor, definition.flags ? definition.flags : [], definition);
			}
			return undefined;
		}

		private getTasks(): vscode.Task[] {
			if (this.tasks !== undefined) {
				return this.tasks;
			}
			// In our fictional build, we have two build flavors
			const flavors: string[] = ['32', '64'];
			// Each flavor can have some options.
			const flags: string[][] = [['watch', 'incremental'], ['incremental'], []];

			this.tasks = [];
			flavors.forEach(flavor => {
				flags.forEach(flagGroup => {
					this.tasks!.push(this.getTask(flavor, flagGroup));
				});
			});
			return this.tasks;
		}

		private getTask(flavor: string, flags: string[], definition?: CustomBuildTaskDefinition): vscode.Task {
			if (definition === undefined) {
				definition = {
					type: CustomBuildTaskProvider.CustomBuildScriptType,
					flavor,
					flags
				};
			}
			return new vscode.Task2(definition, vscode.TaskScope.Workspace, `${flavor} ${flags.join(' ')}`,
				CustomBuildTaskProvider.CustomBuildScriptType, new vscode.CustomExecution(async (): Promise<vscode.Pseudoterminal> => {
					// When the task is executed, this callback will run. Here, we setup for running the task.
					return new CustomBuildTaskTerminal(this.workspaceRoot, flavor, flags, () => this.sharedState, (state: string) => this.sharedState = state);
				}));
		}
	}

	class CustomBuildTaskTerminal implements vscode.Pseudoterminal {
		private writeEmitter = new vscode.EventEmitter<string>();
		onDidWrite: vscode.Event<string> = this.writeEmitter.event;
		private closeEmitter = new vscode.EventEmitter<void>();
		onDidClose?: vscode.Event<void> = this.closeEmitter.event;

		private fileWatcher: vscode.FileSystemWatcher | undefined;

		constructor(private workspaceRoot: string, _flavor: string, private flags: string[], private getSharedState: () => string | undefined, private setSharedState: (state: string) => void) {
		}

		open(_initialDimensions: vscode.TerminalDimensions | undefined): void {
			// At this point we can start using the terminal.
			if (this.flags.indexOf('watch') > -1) {
				let pattern = this.workspaceRoot + '/customBuildFile';
				this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
				this.fileWatcher.onDidChange(() => this.doBuild());
				this.fileWatcher.onDidCreate(() => this.doBuild());
				this.fileWatcher.onDidDelete(() => this.doBuild());
			}
			this.doBuild();
		}

		close(): void {
			// The terminal has been closed. Shutdown the build.
			if (this.fileWatcher) {
				this.fileWatcher.dispose();
			}
		}

		private async doBuild(): Promise<void> {
			return new Promise<void>((resolve) => {
				this.writeEmitter.fire('Starting build...\r\n');
				let isIncremental = this.flags.indexOf('incremental') > -1;
				if (isIncremental) {
					if (this.getSharedState()) {
						this.writeEmitter.fire('Using last build results: ' + this.getSharedState() + '\r\n');
					} else {
						isIncremental = false;
						this.writeEmitter.fire('No result from last build. Doing full build.\r\n');
					}
				}

				// Since we don't actually build anything in this example set a timeout instead.
				setTimeout(() => {
					const date = new Date();
					this.setSharedState(date.toTimeString() + ' ' + date.toDateString());
					this.writeEmitter.fire('Build complete.\r\n\r\n');
					if (this.flags.indexOf('watch') === -1) {
						this.closeEmitter.fire();
						resolve();
					}
				}, isIncremental ? 1000 : 4000);
			});
		}
	}

	vscode.tasks.registerTaskProvider(CustomBuildTaskProvider.CustomBuildScriptType, new CustomBuildTaskProvider(vscode.workspace.rootPath!));
}

//---------------------------------------------------------------------------
//								DEBUG
//---------------------------------------------------------------------------

function enableDebug(context: vscode.ExtensionContext, memFs: MemFS): void {
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mock', new MockConfigurationProvider()));
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('mock', new MockDebugAdapterDescriptorFactory(memFs)));
}

/**
 * Declaration module describing the VS Code debug protocol.
 * Auto-generated from json schema. Do not edit manually.
 */
declare module DebugProtocol {

	/** Base class of requests, responses, and events. */
	export interface ProtocolMessage {
		/** Sequence number (also known as message ID). For protocol messages of type 'request' this ID can be used to cancel the request. */
		seq: number;
		/** Message type.
			Values: 'request', 'response', 'event', etc.
		*/
		type: string;
	}

	/** A client or debug adapter initiated request. */
	export interface Request extends ProtocolMessage {
		// type: 'request';
		/** The command to execute. */
		command: string;
		/** Object containing arguments for the command. */
		arguments?: any;
	}

	/** A debug adapter initiated event. */
	export interface Event extends ProtocolMessage {
		// type: 'event';
		/** Type of event. */
		event: string;
		/** Event-specific information. */
		body?: any;
	}

	/** Response for a request. */
	export interface Response extends ProtocolMessage {
		// type: 'response';
		/** Sequence number of the corresponding request. */
		request_seq: number;
		/** Outcome of the request.
			If true, the request was successful and the 'body' attribute may contain the result of the request.
			If the value is false, the attribute 'message' contains the error in short form and the 'body' may contain additional information (see 'ErrorResponse.body.error').
		*/
		success: boolean;
		/** The command requested. */
		command: string;
		/** Contains the raw error in short form if 'success' is false.
			This raw error might be interpreted by the frontend and is not shown in the UI.
			Some predefined values exist.
			Values:
			'cancelled': request was cancelled.
			etc.
		*/
		message?: string;
		/** Contains request result if success is true and optional error details if success is false. */
		body?: any;
	}

	/** On error (whenever 'success' is false), the body can provide more details. */
	export interface ErrorResponse extends Response {
		body: {
			/** An optional, structured error message. */
			error?: Message;
		};
	}

	/** Cancel request; value of command field is 'cancel'.
		The 'cancel' request is used by the frontend to indicate that it is no longer interested in the result produced by a specific request issued earlier.
		This request has a hint characteristic: a debug adapter can only be expected to make a 'best effort' in honouring this request but there are no guarantees.
		The 'cancel' request may return an error if it could not cancel an operation but a frontend should refrain from presenting this error to end users.
		A frontend client should only call this request if the capability 'supportsCancelRequest' is true.
		The request that got canceled still needs to send a response back.
		This can either be a normal result ('success' attribute true) or an error response ('success' attribute false and the 'message' set to 'cancelled').
		Returning partial results from a cancelled request is possible but please note that a frontend client has no generic way for detecting that a response is partial or not.
	*/
	export interface CancelRequest extends Request {
		// command: 'cancel';
		arguments?: CancelArguments;
	}

	/** Arguments for 'cancel' request. */
	export interface CancelArguments {
		/** The ID (attribute 'seq') of the request to cancel. */
		requestId?: number;
	}

	/** Response to 'cancel' request. This is just an acknowledgement, so no body field is required. */
	export interface CancelResponse extends Response {
	}

	/** Event message for 'initialized' event type.
		This event indicates that the debug adapter is ready to accept configuration requests (e.g. SetBreakpointsRequest, SetExceptionBreakpointsRequest).
		A debug adapter is expected to send this event when it is ready to accept configuration requests (but not before the 'initialize' request has finished).
		The sequence of events/requests is as follows:
		- adapters sends 'initialized' event (after the 'initialize' request has returned)
		- frontend sends zero or more 'setBreakpoints' requests
		- frontend sends one 'setFunctionBreakpoints' request
		- frontend sends a 'setExceptionBreakpoints' request if one or more 'exceptionBreakpointFilters' have been defined (or if 'supportsConfigurationDoneRequest' is not defined or false)
		- frontend sends other future configuration requests
		- frontend sends one 'configurationDone' request to indicate the end of the configuration.
	*/
	export interface InitializedEvent extends Event {
		// event: 'initialized';
	}

	/** Event message for 'stopped' event type.
		The event indicates that the execution of the debuggee has stopped due to some condition.
		This can be caused by a break point previously set, a stepping action has completed, by executing a debugger statement etc.
	*/
	export interface StoppedEvent extends Event {
		// event: 'stopped';
		body: {
			/** The reason for the event.
				For backward compatibility this string is shown in the UI if the 'description' attribute is missing (but it must not be translated).
				Values: 'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto', 'function breakpoint', 'data breakpoint', etc.
			*/
			reason: string;
			/** The full reason for the event, e.g. 'Paused on exception'. This string is shown in the UI as is and must be translated. */
			description?: string;
			/** The thread which was stopped. */
			threadId?: number;
			/** A value of true hints to the frontend that this event should not change the focus. */
			preserveFocusHint?: boolean;
			/** Additional information. E.g. if reason is 'exception', text contains the exception name. This string is shown in the UI. */
			text?: string;
			/** If 'allThreadsStopped' is true, a debug adapter can announce that all threads have stopped.
				- The client should use this information to enable that all threads can be expanded to access their stacktraces.
				- If the attribute is missing or false, only the thread with the given threadId can be expanded.
			*/
			allThreadsStopped?: boolean;
		};
	}

	/** Event message for 'continued' event type.
		The event indicates that the execution of the debuggee has continued.
		Please note: a debug adapter is not expected to send this event in response to a request that implies that execution continues, e.g. 'launch' or 'continue'.
		It is only necessary to send a 'continued' event if there was no previous request that implied this.
	*/
	export interface ContinuedEvent extends Event {
		// event: 'continued';
		body: {
			/** The thread which was continued. */
			threadId: number;
			/** If 'allThreadsContinued' is true, a debug adapter can announce that all threads have continued. */
			allThreadsContinued?: boolean;
		};
	}

	/** Event message for 'exited' event type.
		The event indicates that the debuggee has exited and returns its exit code.
	*/
	export interface ExitedEvent extends Event {
		// event: 'exited';
		body: {
			/** The exit code returned from the debuggee. */
			exitCode: number;
		};
	}

	/** Event message for 'terminated' event type.
		The event indicates that debugging of the debuggee has terminated. This does **not** mean that the debuggee itself has exited.
	*/
	export interface TerminatedEvent extends Event {
		// event: 'terminated';
		body?: {
			/** A debug adapter may set 'restart' to true (or to an arbitrary object) to request that the front end restarts the session.
				The value is not interpreted by the client and passed unmodified as an attribute '__restart' to the 'launch' and 'attach' requests.
			*/
			restart?: any;
		};
	}

	/** Event message for 'thread' event type.
		The event indicates that a thread has started or exited.
	*/
	export interface ThreadEvent extends Event {
		// event: 'thread';
		body: {
			/** The reason for the event.
				Values: 'started', 'exited', etc.
			*/
			reason: string;
			/** The identifier of the thread. */
			threadId: number;
		};
	}

	/** Event message for 'output' event type.
		The event indicates that the target has produced some output.
	*/
	export interface OutputEvent extends Event {
		// event: 'output';
		body: {
			/** The output category. If not specified, 'console' is assumed.
				Values: 'console', 'stdout', 'stderr', 'telemetry', etc.
			*/
			category?: string;
			/** The output to report. */
			output: string;
			/** If an attribute 'variablesReference' exists and its value is > 0, the output contains objects which can be retrieved by passing 'variablesReference' to the 'variables' request. The value should be less than or equal to 2147483647 (2^31 - 1). */
			variablesReference?: number;
			/** An optional source location where the output was produced. */
			source?: Source;
			/** An optional source location line where the output was produced. */
			line?: number;
			/** An optional source location column where the output was produced. */
			column?: number;
			/** Optional data to report. For the 'telemetry' category the data will be sent to telemetry, for the other categories the data is shown in JSON format. */
			data?: any;
		};
	}

	/** Event message for 'breakpoint' event type.
		The event indicates that some information about a breakpoint has changed.
	*/
	export interface BreakpointEvent extends Event {
		// event: 'breakpoint';
		body: {
			/** The reason for the event.
				Values: 'changed', 'new', 'removed', etc.
			*/
			reason: string;
			/** The 'id' attribute is used to find the target breakpoint and the other attributes are used as the new values. */
			breakpoint: Breakpoint;
		};
	}

	/** Event message for 'module' event type.
		The event indicates that some information about a module has changed.
	*/
	export interface ModuleEvent extends Event {
		// event: 'module';
		body: {
			/** The reason for the event. */
			reason: 'new' | 'changed' | 'removed';
			/** The new, changed, or removed module. In case of 'removed' only the module id is used. */
			module: Module;
		};
	}

	/** Event message for 'loadedSource' event type.
		The event indicates that some source has been added, changed, or removed from the set of all loaded sources.
	*/
	export interface LoadedSourceEvent extends Event {
		// event: 'loadedSource';
		body: {
			/** The reason for the event. */
			reason: 'new' | 'changed' | 'removed';
			/** The new, changed, or removed source. */
			source: Source;
		};
	}

	/** Event message for 'process' event type.
		The event indicates that the debugger has begun debugging a new process. Either one that it has launched, or one that it has attached to.
	*/
	export interface ProcessEvent extends Event {
		// event: 'process';
		body: {
			/** The logical name of the process. This is usually the full path to process's executable file. Example: /home/example/myproj/program.js. */
			name: string;
			/** The system process id of the debugged process. This property will be missing for non-system processes. */
			systemProcessId?: number;
			/** If true, the process is running on the same computer as the debug adapter. */
			isLocalProcess?: boolean;
			/** Describes how the debug engine started debugging this process.
				'launch': Process was launched under the debugger.
				'attach': Debugger attached to an existing process.
				'attachForSuspendedLaunch': A project launcher component has launched a new process in a suspended state and then asked the debugger to attach.
			*/
			startMethod?: 'launch' | 'attach' | 'attachForSuspendedLaunch';
			/** The size of a pointer or address for this process, in bits. This value may be used by clients when formatting addresses for display. */
			pointerSize?: number;
		};
	}

	/** Event message for 'capabilities' event type.
		The event indicates that one or more capabilities have changed.
		Since the capabilities are dependent on the frontend and its UI, it might not be possible to change that at random times (or too late).
		Consequently this event has a hint characteristic: a frontend can only be expected to make a 'best effort' in honouring individual capabilities but there are no guarantees.
		Only changed capabilities need to be included, all other capabilities keep their values.
	*/
	export interface CapabilitiesEvent extends Event {
		// event: 'capabilities';
		body: {
			/** The set of updated capabilities. */
			capabilities: Capabilities;
		};
	}

	/** RunInTerminal request; value of command field is 'runInTerminal'.
		This request is sent from the debug adapter to the client to run a command in a terminal. This is typically used to launch the debuggee in a terminal provided by the client.
	*/
	export interface RunInTerminalRequest extends Request {
		// command: 'runInTerminal';
		arguments: RunInTerminalRequestArguments;
	}

	/** Arguments for 'runInTerminal' request. */
	export interface RunInTerminalRequestArguments {
		/** What kind of terminal to launch. */
		kind?: 'integrated' | 'external';
		/** Optional title of the terminal. */
		title?: string;
		/** Working directory of the command. */
		cwd: string;
		/** List of arguments. The first argument is the command to run. */
		args: string[];
		/** Environment key-value pairs that are added to or removed from the default environment. */
		env?: { [key: string]: string | null; };
	}

	/** Response to 'runInTerminal' request. */
	export interface RunInTerminalResponse extends Response {
		body: {
			/** The process ID. The value should be less than or equal to 2147483647 (2^31 - 1). */
			processId?: number;
			/** The process ID of the terminal shell. The value should be less than or equal to 2147483647 (2^31 - 1). */
			shellProcessId?: number;
		};
	}

	/** Initialize request; value of command field is 'initialize'.
		The 'initialize' request is sent as the first request from the client to the debug adapter in order to configure it with client capabilities and to retrieve capabilities from the debug adapter.
		Until the debug adapter has responded to with an 'initialize' response, the client must not send any additional requests or events to the debug adapter. In addition the debug adapter is not allowed to send any requests or events to the client until it has responded with an 'initialize' response.
		The 'initialize' request may only be sent once.
	*/
	export interface InitializeRequest extends Request {
		// command: 'initialize';
		arguments: InitializeRequestArguments;
	}

	/** Arguments for 'initialize' request. */
	export interface InitializeRequestArguments {
		/** The ID of the (frontend) client using this adapter. */
		clientID?: string;
		/** The human readable name of the (frontend) client using this adapter. */
		clientName?: string;
		/** The ID of the debug adapter. */
		adapterID: string;
		/** The ISO-639 locale of the (frontend) client using this adapter, e.g. en-US or de-CH. */
		locale?: string;
		/** If true all line numbers are 1-based (default). */
		linesStartAt1?: boolean;
		/** If true all column numbers are 1-based (default). */
		columnsStartAt1?: boolean;
		/** Determines in what format paths are specified. The default is 'path', which is the native format.
			Values: 'path', 'uri', etc.
		*/
		pathFormat?: string;
		/** Client supports the optional type attribute for variables. */
		supportsVariableType?: boolean;
		/** Client supports the paging of variables. */
		supportsVariablePaging?: boolean;
		/** Client supports the runInTerminal request. */
		supportsRunInTerminalRequest?: boolean;
		/** Client supports memory references. */
		supportsMemoryReferences?: boolean;
	}

	/** Response to 'initialize' request. */
	export interface InitializeResponse extends Response {
		/** The capabilities of this debug adapter. */
		body?: Capabilities;
	}

	/** ConfigurationDone request; value of command field is 'configurationDone'.
		The client of the debug protocol must send this request at the end of the sequence of configuration requests (which was started by the 'initialized' event).
	*/
	export interface ConfigurationDoneRequest extends Request {
		// command: 'configurationDone';
		arguments?: ConfigurationDoneArguments;
	}

	/** Arguments for 'configurationDone' request. */
	export interface ConfigurationDoneArguments {
	}

	/** Response to 'configurationDone' request. This is just an acknowledgement, so no body field is required. */
	export interface ConfigurationDoneResponse extends Response {
	}

	/** Launch request; value of command field is 'launch'.
		The launch request is sent from the client to the debug adapter to start the debuggee with or without debugging (if 'noDebug' is true). Since launching is debugger/runtime specific, the arguments for this request are not part of this specification.
	*/
	export interface LaunchRequest extends Request {
		// command: 'launch';
		arguments: LaunchRequestArguments;
	}

	/** Arguments for 'launch' request. Additional attributes are implementation specific. */
	export interface LaunchRequestArguments {
		/** If noDebug is true the launch request should launch the program without enabling debugging. */
		noDebug?: boolean;
		/** Optional data from the previous, restarted session.
			The data is sent as the 'restart' attribute of the 'terminated' event.
			The client should leave the data intact.
		*/
		__restart?: any;
	}

	/** Response to 'launch' request. This is just an acknowledgement, so no body field is required. */
	export interface LaunchResponse extends Response {
	}

	/** Attach request; value of command field is 'attach'.
		The attach request is sent from the client to the debug adapter to attach to a debuggee that is already running. Since attaching is debugger/runtime specific, the arguments for this request are not part of this specification.
	*/
	export interface AttachRequest extends Request {
		// command: 'attach';
		arguments: AttachRequestArguments;
	}

	/** Arguments for 'attach' request. Additional attributes are implementation specific. */
	export interface AttachRequestArguments {
		/** Optional data from the previous, restarted session.
			The data is sent as the 'restart' attribute of the 'terminated' event.
			The client should leave the data intact.
		*/
		__restart?: any;
	}

	/** Response to 'attach' request. This is just an acknowledgement, so no body field is required. */
	export interface AttachResponse extends Response {
	}

	/** Restart request; value of command field is 'restart'.
		Restarts a debug session. If the capability 'supportsRestartRequest' is missing or has the value false,
		the client will implement 'restart' by terminating the debug adapter first and then launching it anew.
		A debug adapter can override this default behaviour by implementing a restart request
		and setting the capability 'supportsRestartRequest' to true.
	*/
	export interface RestartRequest extends Request {
		// command: 'restart';
		arguments?: RestartArguments;
	}

	/** Arguments for 'restart' request. */
	export interface RestartArguments {
	}

	/** Response to 'restart' request. This is just an acknowledgement, so no body field is required. */
	export interface RestartResponse extends Response {
	}

	/** Disconnect request; value of command field is 'disconnect'.
		The 'disconnect' request is sent from the client to the debug adapter in order to stop debugging. It asks the debug adapter to disconnect from the debuggee and to terminate the debug adapter. If the debuggee has been started with the 'launch' request, the 'disconnect' request terminates the debuggee. If the 'attach' request was used to connect to the debuggee, 'disconnect' does not terminate the debuggee. This behavior can be controlled with the 'terminateDebuggee' argument (if supported by the debug adapter).
	*/
	export interface DisconnectRequest extends Request {
		// command: 'disconnect';
		arguments?: DisconnectArguments;
	}

	/** Arguments for 'disconnect' request. */
	export interface DisconnectArguments {
		/** A value of true indicates that this 'disconnect' request is part of a restart sequence. */
		restart?: boolean;
		/** Indicates whether the debuggee should be terminated when the debugger is disconnected.
			If unspecified, the debug adapter is free to do whatever it thinks is best.
			A client can only rely on this attribute being properly honored if a debug adapter returns true for the 'supportTerminateDebuggee' capability.
		*/
		terminateDebuggee?: boolean;
	}

	/** Response to 'disconnect' request. This is just an acknowledgement, so no body field is required. */
	export interface DisconnectResponse extends Response {
	}

	/** Terminate request; value of command field is 'terminate'.
		The 'terminate' request is sent from the client to the debug adapter in order to give the debuggee a chance for terminating itself.
	*/
	export interface TerminateRequest extends Request {
		// command: 'terminate';
		arguments?: TerminateArguments;
	}

	/** Arguments for 'terminate' request. */
	export interface TerminateArguments {
		/** A value of true indicates that this 'terminate' request is part of a restart sequence. */
		restart?: boolean;
	}

	/** Response to 'terminate' request. This is just an acknowledgement, so no body field is required. */
	export interface TerminateResponse extends Response {
	}

	/** BreakpointLocations request; value of command field is 'breakpointLocations'.
		The 'breakpointLocations' request returns all possible locations for source breakpoints in a given range.
	*/
	export interface BreakpointLocationsRequest extends Request {
		// command: 'breakpointLocations';
		arguments?: BreakpointLocationsArguments;
	}

	/** Arguments for 'breakpointLocations' request. */
	export interface BreakpointLocationsArguments {
		/** The source location of the breakpoints; either 'source.path' or 'source.reference' must be specified. */
		source: Source;
		/** Start line of range to search possible breakpoint locations in. If only the line is specified, the request returns all possible locations in that line. */
		line: number;
		/** Optional start column of range to search possible breakpoint locations in. If no start column is given, the first column in the start line is assumed. */
		column?: number;
		/** Optional end line of range to search possible breakpoint locations in. If no end line is given, then the end line is assumed to be the start line. */
		endLine?: number;
		/** Optional end column of range to search possible breakpoint locations in. If no end column is given, then it is assumed to be in the last column of the end line. */
		endColumn?: number;
	}

	/** Response to 'breakpointLocations' request.
		Contains possible locations for source breakpoints.
	*/
	export interface BreakpointLocationsResponse extends Response {
		body: {
			/** Sorted set of possible breakpoint locations. */
			breakpoints: BreakpointLocation[];
		};
	}

	/** SetBreakpoints request; value of command field is 'setBreakpoints'.
		Sets multiple breakpoints for a single source and clears all previous breakpoints in that source.
		To clear all breakpoint for a source, specify an empty array.
		When a breakpoint is hit, a 'stopped' event (with reason 'breakpoint') is generated.
	*/
	export interface SetBreakpointsRequest extends Request {
		// command: 'setBreakpoints';
		arguments: SetBreakpointsArguments;
	}

	/** Arguments for 'setBreakpoints' request. */
	export interface SetBreakpointsArguments {
		/** The source location of the breakpoints; either 'source.path' or 'source.reference' must be specified. */
		source: Source;
		/** The code locations of the breakpoints. */
		breakpoints?: SourceBreakpoint[];
		/** Deprecated: The code locations of the breakpoints. */
		lines?: number[];
		/** A value of true indicates that the underlying source has been modified which results in new breakpoint locations. */
		sourceModified?: boolean;
	}

	/** Response to 'setBreakpoints' request.
		Returned is information about each breakpoint created by this request.
		This includes the actual code location and whether the breakpoint could be verified.
		The breakpoints returned are in the same order as the elements of the 'breakpoints'
		(or the deprecated 'lines') array in the arguments.
	*/
	export interface SetBreakpointsResponse extends Response {
		body: {
			/** Information about the breakpoints. The array elements are in the same order as the elements of the 'breakpoints' (or the deprecated 'lines') array in the arguments. */
			breakpoints: Breakpoint[];
		};
	}

	/** SetFunctionBreakpoints request; value of command field is 'setFunctionBreakpoints'.
		Replaces all existing function breakpoints with new function breakpoints.
		To clear all function breakpoints, specify an empty array.
		When a function breakpoint is hit, a 'stopped' event (with reason 'function breakpoint') is generated.
	*/
	export interface SetFunctionBreakpointsRequest extends Request {
		// command: 'setFunctionBreakpoints';
		arguments: SetFunctionBreakpointsArguments;
	}

	/** Arguments for 'setFunctionBreakpoints' request. */
	export interface SetFunctionBreakpointsArguments {
		/** The function names of the breakpoints. */
		breakpoints: FunctionBreakpoint[];
	}

	/** Response to 'setFunctionBreakpoints' request.
		Returned is information about each breakpoint created by this request.
	*/
	export interface SetFunctionBreakpointsResponse extends Response {
		body: {
			/** Information about the breakpoints. The array elements correspond to the elements of the 'breakpoints' array. */
			breakpoints: Breakpoint[];
		};
	}

	/** SetExceptionBreakpoints request; value of command field is 'setExceptionBreakpoints'.
		The request configures the debuggers response to thrown exceptions. If an exception is configured to break, a 'stopped' event is fired (with reason 'exception').
	*/
	export interface SetExceptionBreakpointsRequest extends Request {
		// command: 'setExceptionBreakpoints';
		arguments: SetExceptionBreakpointsArguments;
	}

	/** Arguments for 'setExceptionBreakpoints' request. */
	export interface SetExceptionBreakpointsArguments {
		/** IDs of checked exception options. The set of IDs is returned via the 'exceptionBreakpointFilters' capability. */
		filters: string[];
		/** Configuration options for selected exceptions. */
		exceptionOptions?: ExceptionOptions[];
	}

	/** Response to 'setExceptionBreakpoints' request. This is just an acknowledgement, so no body field is required. */
	export interface SetExceptionBreakpointsResponse extends Response {
	}

	/** DataBreakpointInfo request; value of command field is 'dataBreakpointInfo'.
		Obtains information on a possible data breakpoint that could be set on an expression or variable.
	*/
	export interface DataBreakpointInfoRequest extends Request {
		// command: 'dataBreakpointInfo';
		arguments: DataBreakpointInfoArguments;
	}

	/** Arguments for 'dataBreakpointInfo' request. */
	export interface DataBreakpointInfoArguments {
		/** Reference to the Variable container if the data breakpoint is requested for a child of the container. */
		variablesReference?: number;
		/** The name of the Variable's child to obtain data breakpoint information for. If variableReference isn’t provided, this can be an expression. */
		name: string;
	}

	/** Response to 'dataBreakpointInfo' request. */
	export interface DataBreakpointInfoResponse extends Response {
		body: {
			/** An identifier for the data on which a data breakpoint can be registered with the setDataBreakpoints request or null if no data breakpoint is available. */
			dataId: string | null;
			/** UI string that describes on what data the breakpoint is set on or why a data breakpoint is not available. */
			description: string;
			/** Optional attribute listing the available access types for a potential data breakpoint. A UI frontend could surface this information. */
			accessTypes?: DataBreakpointAccessType[];
			/** Optional attribute indicating that a potential data breakpoint could be persisted across sessions. */
			canPersist?: boolean;
		};
	}

	/** SetDataBreakpoints request; value of command field is 'setDataBreakpoints'.
		Replaces all existing data breakpoints with new data breakpoints.
		To clear all data breakpoints, specify an empty array.
		When a data breakpoint is hit, a 'stopped' event (with reason 'data breakpoint') is generated.
	*/
	export interface SetDataBreakpointsRequest extends Request {
		// command: 'setDataBreakpoints';
		arguments: SetDataBreakpointsArguments;
	}

	/** Arguments for 'setDataBreakpoints' request. */
	export interface SetDataBreakpointsArguments {
		/** The contents of this array replaces all existing data breakpoints. An empty array clears all data breakpoints. */
		breakpoints: DataBreakpoint[];
	}

	/** Response to 'setDataBreakpoints' request.
		Returned is information about each breakpoint created by this request.
	*/
	export interface SetDataBreakpointsResponse extends Response {
		body: {
			/** Information about the data breakpoints. The array elements correspond to the elements of the input argument 'breakpoints' array. */
			breakpoints: Breakpoint[];
		};
	}

	/** Continue request; value of command field is 'continue'.
		The request starts the debuggee to run again.
	*/
	export interface ContinueRequest extends Request {
		// command: 'continue';
		arguments: ContinueArguments;
	}

	/** Arguments for 'continue' request. */
	export interface ContinueArguments {
		/** Continue execution for the specified thread (if possible). If the backend cannot continue on a single thread but will continue on all threads, it should set the 'allThreadsContinued' attribute in the response to true. */
		threadId: number;
	}

	/** Response to 'continue' request. */
	export interface ContinueResponse extends Response {
		body: {
			/** If true, the 'continue' request has ignored the specified thread and continued all threads instead. If this attribute is missing a value of 'true' is assumed for backward compatibility. */
			allThreadsContinued?: boolean;
		};
	}

	/** Next request; value of command field is 'next'.
		The request starts the debuggee to run again for one step.
		The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed.
	*/
	export interface NextRequest extends Request {
		// command: 'next';
		arguments: NextArguments;
	}

	/** Arguments for 'next' request. */
	export interface NextArguments {
		/** Execute 'next' for this thread. */
		threadId: number;
	}

	/** Response to 'next' request. This is just an acknowledgement, so no body field is required. */
	export interface NextResponse extends Response {
	}

	/** StepIn request; value of command field is 'stepIn'.
		The request starts the debuggee to step into a function/method if possible.
		If it cannot step into a target, 'stepIn' behaves like 'next'.
		The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed.
		If there are multiple function/method calls (or other targets) on the source line,
		the optional argument 'targetId' can be used to control into which target the 'stepIn' should occur.
		The list of possible targets for a given source line can be retrieved via the 'stepInTargets' request.
	*/
	export interface StepInRequest extends Request {
		// command: 'stepIn';
		arguments: StepInArguments;
	}

	/** Arguments for 'stepIn' request. */
	export interface StepInArguments {
		/** Execute 'stepIn' for this thread. */
		threadId: number;
		/** Optional id of the target to step into. */
		targetId?: number;
	}

	/** Response to 'stepIn' request. This is just an acknowledgement, so no body field is required. */
	export interface StepInResponse extends Response {
	}

	/** StepOut request; value of command field is 'stepOut'.
		The request starts the debuggee to run again for one step.
		The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed.
	*/
	export interface StepOutRequest extends Request {
		// command: 'stepOut';
		arguments: StepOutArguments;
	}

	/** Arguments for 'stepOut' request. */
	export interface StepOutArguments {
		/** Execute 'stepOut' for this thread. */
		threadId: number;
	}

	/** Response to 'stepOut' request. This is just an acknowledgement, so no body field is required. */
	export interface StepOutResponse extends Response {
	}

	/** StepBack request; value of command field is 'stepBack'.
		The request starts the debuggee to run one step backwards.
		The debug adapter first sends the response and then a 'stopped' event (with reason 'step') after the step has completed. Clients should only call this request if the capability 'supportsStepBack' is true.
	*/
	export interface StepBackRequest extends Request {
		// command: 'stepBack';
		arguments: StepBackArguments;
	}

	/** Arguments for 'stepBack' request. */
	export interface StepBackArguments {
		/** Execute 'stepBack' for this thread. */
		threadId: number;
	}

	/** Response to 'stepBack' request. This is just an acknowledgement, so no body field is required. */
	export interface StepBackResponse extends Response {
	}

	/** ReverseContinue request; value of command field is 'reverseContinue'.
		The request starts the debuggee to run backward. Clients should only call this request if the capability 'supportsStepBack' is true.
	*/
	export interface ReverseContinueRequest extends Request {
		// command: 'reverseContinue';
		arguments: ReverseContinueArguments;
	}

	/** Arguments for 'reverseContinue' request. */
	export interface ReverseContinueArguments {
		/** Execute 'reverseContinue' for this thread. */
		threadId: number;
	}

	/** Response to 'reverseContinue' request. This is just an acknowledgement, so no body field is required. */
	export interface ReverseContinueResponse extends Response {
	}

	/** RestartFrame request; value of command field is 'restartFrame'.
		The request restarts execution of the specified stackframe.
		The debug adapter first sends the response and then a 'stopped' event (with reason 'restart') after the restart has completed.
	*/
	export interface RestartFrameRequest extends Request {
		// command: 'restartFrame';
		arguments: RestartFrameArguments;
	}

	/** Arguments for 'restartFrame' request. */
	export interface RestartFrameArguments {
		/** Restart this stackframe. */
		frameId: number;
	}

	/** Response to 'restartFrame' request. This is just an acknowledgement, so no body field is required. */
	export interface RestartFrameResponse extends Response {
	}

	/** Goto request; value of command field is 'goto'.
		The request sets the location where the debuggee will continue to run.
		This makes it possible to skip the execution of code or to executed code again.
		The code between the current location and the goto target is not executed but skipped.
		The debug adapter first sends the response and then a 'stopped' event with reason 'goto'.
	*/
	export interface GotoRequest extends Request {
		// command: 'goto';
		arguments: GotoArguments;
	}

	/** Arguments for 'goto' request. */
	export interface GotoArguments {
		/** Set the goto target for this thread. */
		threadId: number;
		/** The location where the debuggee will continue to run. */
		targetId: number;
	}

	/** Response to 'goto' request. This is just an acknowledgement, so no body field is required. */
	export interface GotoResponse extends Response {
	}

	/** Pause request; value of command field is 'pause'.
		The request suspends the debuggee.
		The debug adapter first sends the response and then a 'stopped' event (with reason 'pause') after the thread has been paused successfully.
	*/
	export interface PauseRequest extends Request {
		// command: 'pause';
		arguments: PauseArguments;
	}

	/** Arguments for 'pause' request. */
	export interface PauseArguments {
		/** Pause execution for this thread. */
		threadId: number;
	}

	/** Response to 'pause' request. This is just an acknowledgement, so no body field is required. */
	export interface PauseResponse extends Response {
	}

	/** StackTrace request; value of command field is 'stackTrace'.
		The request returns a stacktrace from the current execution state.
	*/
	export interface StackTraceRequest extends Request {
		// command: 'stackTrace';
		arguments: StackTraceArguments;
	}

	/** Arguments for 'stackTrace' request. */
	export interface StackTraceArguments {
		/** Retrieve the stacktrace for this thread. */
		threadId: number;
		/** The index of the first frame to return; if omitted frames start at 0. */
		startFrame?: number;
		/** The maximum number of frames to return. If levels is not specified or 0, all frames are returned. */
		levels?: number;
		/** Specifies details on how to format the stack frames. */
		format?: StackFrameFormat;
	}

	/** Response to 'stackTrace' request. */
	export interface StackTraceResponse extends Response {
		body: {
			/** The frames of the stackframe. If the array has length zero, there are no stackframes available.
				This means that there is no location information available.
			*/
			stackFrames: StackFrame[];
			/** The total number of frames available. */
			totalFrames?: number;
		};
	}

	/** Scopes request; value of command field is 'scopes'.
		The request returns the variable scopes for a given stackframe ID.
	*/
	export interface ScopesRequest extends Request {
		// command: 'scopes';
		arguments: ScopesArguments;
	}

	/** Arguments for 'scopes' request. */
	export interface ScopesArguments {
		/** Retrieve the scopes for this stackframe. */
		frameId: number;
	}

	/** Response to 'scopes' request. */
	export interface ScopesResponse extends Response {
		body: {
			/** The scopes of the stackframe. If the array has length zero, there are no scopes available. */
			scopes: Scope[];
		};
	}

	/** Variables request; value of command field is 'variables'.
		Retrieves all child variables for the given variable reference.
		An optional filter can be used to limit the fetched children to either named or indexed children.
	*/
	export interface VariablesRequest extends Request {
		// command: 'variables';
		arguments: VariablesArguments;
	}

	/** Arguments for 'variables' request. */
	export interface VariablesArguments {
		/** The Variable reference. */
		variablesReference: number;
		/** Optional filter to limit the child variables to either named or indexed. If omitted, both types are fetched. */
		filter?: 'indexed' | 'named';
		/** The index of the first variable to return; if omitted children start at 0. */
		start?: number;
		/** The number of variables to return. If count is missing or 0, all variables are returned. */
		count?: number;
		/** Specifies details on how to format the Variable values. */
		format?: ValueFormat;
	}

	/** Response to 'variables' request. */
	export interface VariablesResponse extends Response {
		body: {
			/** All (or a range) of variables for the given variable reference. */
			variables: Variable[];
		};
	}

	/** SetVariable request; value of command field is 'setVariable'.
		Set the variable with the given name in the variable container to a new value.
	*/
	export interface SetVariableRequest extends Request {
		// command: 'setVariable';
		arguments: SetVariableArguments;
	}

	/** Arguments for 'setVariable' request. */
	export interface SetVariableArguments {
		/** The reference of the variable container. */
		variablesReference: number;
		/** The name of the variable in the container. */
		name: string;
		/** The value of the variable. */
		value: string;
		/** Specifies details on how to format the response value. */
		format?: ValueFormat;
	}

	/** Response to 'setVariable' request. */
	export interface SetVariableResponse extends Response {
		body: {
			/** The new value of the variable. */
			value: string;
			/** The type of the new value. Typically shown in the UI when hovering over the value. */
			type?: string;
			/** If variablesReference is > 0, the new value is structured and its children can be retrieved by passing variablesReference to the VariablesRequest. The value should be less than or equal to 2147483647 (2^31 - 1). */
			variablesReference?: number;
			/** The number of named child variables.
				The client can use this optional information to present the variables in a paged UI and fetch them in chunks. The value should be less than or equal to 2147483647 (2^31 - 1).
			*/
			namedVariables?: number;
			/** The number of indexed child variables.
				The client can use this optional information to present the variables in a paged UI and fetch them in chunks. The value should be less than or equal to 2147483647 (2^31 - 1).
			*/
			indexedVariables?: number;
		};
	}

	/** Source request; value of command field is 'source'.
		The request retrieves the source code for a given source reference.
	*/
	export interface SourceRequest extends Request {
		// command: 'source';
		arguments: SourceArguments;
	}

	/** Arguments for 'source' request. */
	export interface SourceArguments {
		/** Specifies the source content to load. Either source.path or source.sourceReference must be specified. */
		source?: Source;
		/** The reference to the source. This is the same as source.sourceReference. This is provided for backward compatibility since old backends do not understand the 'source' attribute. */
		sourceReference: number;
	}

	/** Response to 'source' request. */
	export interface SourceResponse extends Response {
		body: {
			/** Content of the source reference. */
			content: string;
			/** Optional content type (mime type) of the source. */
			mimeType?: string;
		};
	}

	/** Threads request; value of command field is 'threads'.
		The request retrieves a list of all threads.
	*/
	export interface ThreadsRequest extends Request {
		// command: 'threads';
	}

	/** Response to 'threads' request. */
	export interface ThreadsResponse extends Response {
		body: {
			/** All threads. */
			threads: Thread[];
		};
	}

	/** TerminateThreads request; value of command field is 'terminateThreads'.
		The request terminates the threads with the given ids.
	*/
	export interface TerminateThreadsRequest extends Request {
		// command: 'terminateThreads';
		arguments: TerminateThreadsArguments;
	}

	/** Arguments for 'terminateThreads' request. */
	export interface TerminateThreadsArguments {
		/** Ids of threads to be terminated. */
		threadIds?: number[];
	}

	/** Response to 'terminateThreads' request. This is just an acknowledgement, so no body field is required. */
	export interface TerminateThreadsResponse extends Response {
	}

	/** Modules request; value of command field is 'modules'.
		Modules can be retrieved from the debug adapter with the ModulesRequest which can either return all modules or a range of modules to support paging.
	*/
	export interface ModulesRequest extends Request {
		// command: 'modules';
		arguments: ModulesArguments;
	}

	/** Arguments for 'modules' request. */
	export interface ModulesArguments {
		/** The index of the first module to return; if omitted modules start at 0. */
		startModule?: number;
		/** The number of modules to return. If moduleCount is not specified or 0, all modules are returned. */
		moduleCount?: number;
	}

	/** Response to 'modules' request. */
	export interface ModulesResponse extends Response {
		body: {
			/** All modules or range of modules. */
			modules: Module[];
			/** The total number of modules available. */
			totalModules?: number;
		};
	}

	/** LoadedSources request; value of command field is 'loadedSources'.
		Retrieves the set of all sources currently loaded by the debugged process.
	*/
	export interface LoadedSourcesRequest extends Request {
		// command: 'loadedSources';
		arguments?: LoadedSourcesArguments;
	}

	/** Arguments for 'loadedSources' request. */
	export interface LoadedSourcesArguments {
	}

	/** Response to 'loadedSources' request. */
	export interface LoadedSourcesResponse extends Response {
		body: {
			/** Set of loaded sources. */
			sources: Source[];
		};
	}

	/** Evaluate request; value of command field is 'evaluate'.
		Evaluates the given expression in the context of the top most stack frame.
		The expression has access to any variables and arguments that are in scope.
	*/
	export interface EvaluateRequest extends Request {
		// command: 'evaluate';
		arguments: EvaluateArguments;
	}

	/** Arguments for 'evaluate' request. */
	export interface EvaluateArguments {
		/** The expression to evaluate. */
		expression: string;
		/** Evaluate the expression in the scope of this stack frame. If not specified, the expression is evaluated in the global scope. */
		frameId?: number;
		/** The context in which the evaluate request is run.
			Values:
			'watch': evaluate is run in a watch.
			'repl': evaluate is run from REPL console.
			'hover': evaluate is run from a data hover.
			etc.
		*/
		context?: string;
		/** Specifies details on how to format the Evaluate result. */
		format?: ValueFormat;
	}

	/** Response to 'evaluate' request. */
	export interface EvaluateResponse extends Response {
		body: {
			/** The result of the evaluate request. */
			result: string;
			/** The optional type of the evaluate result. */
			type?: string;
			/** Properties of a evaluate result that can be used to determine how to render the result in the UI. */
			presentationHint?: VariablePresentationHint;
			/** If variablesReference is > 0, the evaluate result is structured and its children can be retrieved by passing variablesReference to the VariablesRequest. The value should be less than or equal to 2147483647 (2^31 - 1). */
			variablesReference: number;
			/** The number of named child variables.
				The client can use this optional information to present the variables in a paged UI and fetch them in chunks. The value should be less than or equal to 2147483647 (2^31 - 1).
			*/
			namedVariables?: number;
			/** The number of indexed child variables.
				The client can use this optional information to present the variables in a paged UI and fetch them in chunks. The value should be less than or equal to 2147483647 (2^31 - 1).
			*/
			indexedVariables?: number;
			/** Memory reference to a location appropriate for this result. For pointer type eval results, this is generally a reference to the memory address contained in the pointer. */
			memoryReference?: string;
		};
	}

	/** SetExpression request; value of command field is 'setExpression'.
		Evaluates the given 'value' expression and assigns it to the 'expression' which must be a modifiable l-value.
		The expressions have access to any variables and arguments that are in scope of the specified frame.
	*/
	export interface SetExpressionRequest extends Request {
		// command: 'setExpression';
		arguments: SetExpressionArguments;
	}

	/** Arguments for 'setExpression' request. */
	export interface SetExpressionArguments {
		/** The l-value expression to assign to. */
		expression: string;
		/** The value expression to assign to the l-value expression. */
		value: string;
		/** Evaluate the expressions in the scope of this stack frame. If not specified, the expressions are evaluated in the global scope. */
		frameId?: number;
		/** Specifies how the resulting value should be formatted. */
		format?: ValueFormat;
	}

	/** Response to 'setExpression' request. */
	export interface SetExpressionResponse extends Response {
		body: {
			/** The new value of the expression. */
			value: string;
			/** The optional type of the value. */
			type?: string;
			/** Properties of a value that can be used to determine how to render the result in the UI. */
			presentationHint?: VariablePresentationHint;
			/** If variablesReference is > 0, the value is structured and its children can be retrieved by passing variablesReference to the VariablesRequest. The value should be less than or equal to 2147483647 (2^31 - 1). */
			variablesReference?: number;
			/** The number of named child variables.
				The client can use this optional information to present the variables in a paged UI and fetch them in chunks. The value should be less than or equal to 2147483647 (2^31 - 1).
			*/
			namedVariables?: number;
			/** The number of indexed child variables.
				The client can use this optional information to present the variables in a paged UI and fetch them in chunks. The value should be less than or equal to 2147483647 (2^31 - 1).
			*/
			indexedVariables?: number;
		};
	}

	/** StepInTargets request; value of command field is 'stepInTargets'.
		This request retrieves the possible stepIn targets for the specified stack frame.
		These targets can be used in the 'stepIn' request.
		The StepInTargets may only be called if the 'supportsStepInTargetsRequest' capability exists and is true.
	*/
	export interface StepInTargetsRequest extends Request {
		// command: 'stepInTargets';
		arguments: StepInTargetsArguments;
	}

	/** Arguments for 'stepInTargets' request. */
	export interface StepInTargetsArguments {
		/** The stack frame for which to retrieve the possible stepIn targets. */
		frameId: number;
	}

	/** Response to 'stepInTargets' request. */
	export interface StepInTargetsResponse extends Response {
		body: {
			/** The possible stepIn targets of the specified source location. */
			targets: StepInTarget[];
		};
	}

	/** GotoTargets request; value of command field is 'gotoTargets'.
		This request retrieves the possible goto targets for the specified source location.
		These targets can be used in the 'goto' request.
		The GotoTargets request may only be called if the 'supportsGotoTargetsRequest' capability exists and is true.
	*/
	export interface GotoTargetsRequest extends Request {
		// command: 'gotoTargets';
		arguments: GotoTargetsArguments;
	}

	/** Arguments for 'gotoTargets' request. */
	export interface GotoTargetsArguments {
		/** The source location for which the goto targets are determined. */
		source: Source;
		/** The line location for which the goto targets are determined. */
		line: number;
		/** An optional column location for which the goto targets are determined. */
		column?: number;
	}

	/** Response to 'gotoTargets' request. */
	export interface GotoTargetsResponse extends Response {
		body: {
			/** The possible goto targets of the specified location. */
			targets: GotoTarget[];
		};
	}

	/** Completions request; value of command field is 'completions'.
		Returns a list of possible completions for a given caret position and text.
		The CompletionsRequest may only be called if the 'supportsCompletionsRequest' capability exists and is true.
	*/
	export interface CompletionsRequest extends Request {
		// command: 'completions';
		arguments: CompletionsArguments;
	}

	/** Arguments for 'completions' request. */
	export interface CompletionsArguments {
		/** Returns completions in the scope of this stack frame. If not specified, the completions are returned for the global scope. */
		frameId?: number;
		/** One or more source lines. Typically this is the text a user has typed into the debug console before he asked for completion. */
		text: string;
		/** The character position for which to determine the completion proposals. */
		column: number;
		/** An optional line for which to determine the completion proposals. If missing the first line of the text is assumed. */
		line?: number;
	}

	/** Response to 'completions' request. */
	export interface CompletionsResponse extends Response {
		body: {
			/** The possible completions for . */
			targets: CompletionItem[];
		};
	}

	/** ExceptionInfo request; value of command field is 'exceptionInfo'.
		Retrieves the details of the exception that caused this event to be raised.
	*/
	export interface ExceptionInfoRequest extends Request {
		// command: 'exceptionInfo';
		arguments: ExceptionInfoArguments;
	}

	/** Arguments for 'exceptionInfo' request. */
	export interface ExceptionInfoArguments {
		/** Thread for which exception information should be retrieved. */
		threadId: number;
	}

	/** Response to 'exceptionInfo' request. */
	export interface ExceptionInfoResponse extends Response {
		body: {
			/** ID of the exception that was thrown. */
			exceptionId: string;
			/** Descriptive text for the exception provided by the debug adapter. */
			description?: string;
			/** Mode that caused the exception notification to be raised. */
			breakMode: ExceptionBreakMode;
			/** Detailed information about the exception. */
			details?: ExceptionDetails;
		};
	}

	/** ReadMemory request; value of command field is 'readMemory'.
		Reads bytes from memory at the provided location.
	*/
	export interface ReadMemoryRequest extends Request {
		// command: 'readMemory';
		arguments: ReadMemoryArguments;
	}

	/** Arguments for 'readMemory' request. */
	export interface ReadMemoryArguments {
		/** Memory reference to the base location from which data should be read. */
		memoryReference: string;
		/** Optional offset (in bytes) to be applied to the reference location before reading data. Can be negative. */
		offset?: number;
		/** Number of bytes to read at the specified location and offset. */
		count: number;
	}

	/** Response to 'readMemory' request. */
	export interface ReadMemoryResponse extends Response {
		body?: {
			/** The address of the first byte of data returned. Treated as a hex value if prefixed with '0x', or as a decimal value otherwise. */
			address: string;
			/** The number of unreadable bytes encountered after the last successfully read byte. This can be used to determine the number of bytes that must be skipped before a subsequent 'readMemory' request will succeed. */
			unreadableBytes?: number;
			/** The bytes read from memory, encoded using base64. */
			data?: string;
		};
	}

	/** Disassemble request; value of command field is 'disassemble'.
		Disassembles code stored at the provided location.
	*/
	export interface DisassembleRequest extends Request {
		// command: 'disassemble';
		arguments: DisassembleArguments;
	}

	/** Arguments for 'disassemble' request. */
	export interface DisassembleArguments {
		/** Memory reference to the base location containing the instructions to disassemble. */
		memoryReference: string;
		/** Optional offset (in bytes) to be applied to the reference location before disassembling. Can be negative. */
		offset?: number;
		/** Optional offset (in instructions) to be applied after the byte offset (if any) before disassembling. Can be negative. */
		instructionOffset?: number;
		/** Number of instructions to disassemble starting at the specified location and offset. An adapter must return exactly this number of instructions - any unavailable instructions should be replaced with an implementation-defined 'invalid instruction' value. */
		instructionCount: number;
		/** If true, the adapter should attempt to resolve memory addresses and other values to symbolic names. */
		resolveSymbols?: boolean;
	}

	/** Response to 'disassemble' request. */
	export interface DisassembleResponse extends Response {
		body?: {
			/** The list of disassembled instructions. */
			instructions: DisassembledInstruction[];
		};
	}

	/** Information about the capabilities of a debug adapter. */
	export interface Capabilities {
		/** The debug adapter supports the 'configurationDone' request. */
		supportsConfigurationDoneRequest?: boolean;
		/** The debug adapter supports function breakpoints. */
		supportsFunctionBreakpoints?: boolean;
		/** The debug adapter supports conditional breakpoints. */
		supportsConditionalBreakpoints?: boolean;
		/** The debug adapter supports breakpoints that break execution after a specified number of hits. */
		supportsHitConditionalBreakpoints?: boolean;
		/** The debug adapter supports a (side effect free) evaluate request for data hovers. */
		supportsEvaluateForHovers?: boolean;
		/** Available filters or options for the setExceptionBreakpoints request. */
		exceptionBreakpointFilters?: ExceptionBreakpointsFilter[];
		/** The debug adapter supports stepping back via the 'stepBack' and 'reverseContinue' requests. */
		supportsStepBack?: boolean;
		/** The debug adapter supports setting a variable to a value. */
		supportsSetVariable?: boolean;
		/** The debug adapter supports restarting a frame. */
		supportsRestartFrame?: boolean;
		/** The debug adapter supports the 'gotoTargets' request. */
		supportsGotoTargetsRequest?: boolean;
		/** The debug adapter supports the 'stepInTargets' request. */
		supportsStepInTargetsRequest?: boolean;
		/** The debug adapter supports the 'completions' request. */
		supportsCompletionsRequest?: boolean;
		/** The set of characters that should trigger completion in a REPL. If not specified, the UI should assume the '.' character. */
		completionTriggerCharacters?: string[];
		/** The debug adapter supports the 'modules' request. */
		supportsModulesRequest?: boolean;
		/** The set of additional module information exposed by the debug adapter. */
		additionalModuleColumns?: ColumnDescriptor[];
		/** Checksum algorithms supported by the debug adapter. */
		supportedChecksumAlgorithms?: ChecksumAlgorithm[];
		/** The debug adapter supports the 'restart' request. In this case a client should not implement 'restart' by terminating and relaunching the adapter but by calling the RestartRequest. */
		supportsRestartRequest?: boolean;
		/** The debug adapter supports 'exceptionOptions' on the setExceptionBreakpoints request. */
		supportsExceptionOptions?: boolean;
		/** The debug adapter supports a 'format' attribute on the stackTraceRequest, variablesRequest, and evaluateRequest. */
		supportsValueFormattingOptions?: boolean;
		/** The debug adapter supports the 'exceptionInfo' request. */
		supportsExceptionInfoRequest?: boolean;
		/** The debug adapter supports the 'terminateDebuggee' attribute on the 'disconnect' request. */
		supportTerminateDebuggee?: boolean;
		/** The debug adapter supports the delayed loading of parts of the stack, which requires that both the 'startFrame' and 'levels' arguments and the 'totalFrames' result of the 'StackTrace' request are supported. */
		supportsDelayedStackTraceLoading?: boolean;
		/** The debug adapter supports the 'loadedSources' request. */
		supportsLoadedSourcesRequest?: boolean;
		/** The debug adapter supports logpoints by interpreting the 'logMessage' attribute of the SourceBreakpoint. */
		supportsLogPoints?: boolean;
		/** The debug adapter supports the 'terminateThreads' request. */
		supportsTerminateThreadsRequest?: boolean;
		/** The debug adapter supports the 'setExpression' request. */
		supportsSetExpression?: boolean;
		/** The debug adapter supports the 'terminate' request. */
		supportsTerminateRequest?: boolean;
		/** The debug adapter supports data breakpoints. */
		supportsDataBreakpoints?: boolean;
		/** The debug adapter supports the 'readMemory' request. */
		supportsReadMemoryRequest?: boolean;
		/** The debug adapter supports the 'disassemble' request. */
		supportsDisassembleRequest?: boolean;
		/** The debug adapter supports the 'cancel' request. */
		supportsCancelRequest?: boolean;
		/** The debug adapter supports the 'breakpointLocations' request. */
		supportsBreakpointLocationsRequest?: boolean;
	}

	/** An ExceptionBreakpointsFilter is shown in the UI as an option for configuring how exceptions are dealt with. */
	export interface ExceptionBreakpointsFilter {
		/** The internal ID of the filter. This value is passed to the setExceptionBreakpoints request. */
		filter: string;
		/** The name of the filter. This will be shown in the UI. */
		label: string;
		/** Initial value of the filter. If not specified a value 'false' is assumed. */
		default?: boolean;
	}

	/** A structured message object. Used to return errors from requests. */
	export interface Message {
		/** Unique identifier for the message. */
		id: number;
		/** A format string for the message. Embedded variables have the form '{name}'.
			If variable name starts with an underscore character, the variable does not contain user data (PII) and can be safely used for telemetry purposes.
		*/
		format: string;
		/** An object used as a dictionary for looking up the variables in the format string. */
		variables?: { [key: string]: string; };
		/** If true send to telemetry. */
		sendTelemetry?: boolean;
		/** If true show user. */
		showUser?: boolean;
		/** An optional url where additional information about this message can be found. */
		url?: string;
		/** An optional label that is presented to the user as the UI for opening the url. */
		urlLabel?: string;
	}

	/** A Module object represents a row in the modules view.
		Two attributes are mandatory: an id identifies a module in the modules view and is used in a ModuleEvent for identifying a module for adding, updating or deleting.
		The name is used to minimally render the module in the UI.

		Additional attributes can be added to the module. They will show up in the module View if they have a corresponding ColumnDescriptor.

		To avoid an unnecessary proliferation of additional attributes with similar semantics but different names
		we recommend to re-use attributes from the 'recommended' list below first, and only introduce new attributes if nothing appropriate could be found.
	*/
	export interface Module {
		/** Unique identifier for the module. */
		id: number | string;
		/** A name of the module. */
		name: string;
		/** optional but recommended attributes.
			always try to use these first before introducing additional attributes.

			Logical full path to the module. The exact definition is implementation defined, but usually this would be a full path to the on-disk file for the module.
		*/
		path?: string;
		/** True if the module is optimized. */
		isOptimized?: boolean;
		/** True if the module is considered 'user code' by a debugger that supports 'Just My Code'. */
		isUserCode?: boolean;
		/** Version of Module. */
		version?: string;
		/** User understandable description of if symbols were found for the module (ex: 'Symbols Loaded', 'Symbols not found', etc. */
		symbolStatus?: string;
		/** Logical full path to the symbol file. The exact definition is implementation defined. */
		symbolFilePath?: string;
		/** Module created or modified. */
		dateTimeStamp?: string;
		/** Address range covered by this module. */
		addressRange?: string;
	}

	/** A ColumnDescriptor specifies what module attribute to show in a column of the ModulesView, how to format it, and what the column's label should be.
		It is only used if the underlying UI actually supports this level of customization.
	*/
	export interface ColumnDescriptor {
		/** Name of the attribute rendered in this column. */
		attributeName: string;
		/** Header UI label of column. */
		label: string;
		/** Format to use for the rendered values in this column. TBD how the format strings looks like. */
		format?: string;
		/** Datatype of values in this column.  Defaults to 'string' if not specified. */
		type?: 'string' | 'number' | 'boolean' | 'unixTimestampUTC';
		/** Width of this column in characters (hint only). */
		width?: number;
	}

	/** The ModulesViewDescriptor is the container for all declarative configuration options of a ModuleView.
		For now it only specifies the columns to be shown in the modules view.
	*/
	export interface ModulesViewDescriptor {
		columns: ColumnDescriptor[];
	}

	/** A Thread */
	export interface Thread {
		/** Unique identifier for the thread. */
		id: number;
		/** A name of the thread. */
		name: string;
	}

	/** A Source is a descriptor for source code. It is returned from the debug adapter as part of a StackFrame and it is used by clients when specifying breakpoints. */
	export interface Source {
		/** The short name of the source. Every source returned from the debug adapter has a name. When sending a source to the debug adapter this name is optional. */
		name?: string;
		/** The path of the source to be shown in the UI. It is only used to locate and load the content of the source if no sourceReference is specified (or its value is 0). */
		path?: string;
		/** If sourceReference > 0 the contents of the source must be retrieved through the SourceRequest (even if a path is specified). A sourceReference is only valid for a session, so it must not be used to persist a source. The value should be less than or equal to 2147483647 (2^31 - 1). */
		sourceReference?: number;
		/** An optional hint for how to present the source in the UI. A value of 'deemphasize' can be used to indicate that the source is not available or that it is skipped on stepping. */
		presentationHint?: 'normal' | 'emphasize' | 'deemphasize';
		/** The (optional) origin of this source: possible values 'internal module', 'inlined content from source map', etc. */
		origin?: string;
		/** An optional list of sources that are related to this source. These may be the source that generated this source. */
		sources?: Source[];
		/** Optional data that a debug adapter might want to loop through the client. The client should leave the data intact and persist it across sessions. The client should not interpret the data. */
		adapterData?: any;
		/** The checksums associated with this file. */
		checksums?: Checksum[];
	}

	/** A Stackframe contains the source location. */
	export interface StackFrame {
		/** An identifier for the stack frame. It must be unique across all threads. This id can be used to retrieve the scopes of the frame with the 'scopesRequest' or to restart the execution of a stackframe. */
		id: number;
		/** The name of the stack frame, typically a method name. */
		name: string;
		/** The optional source of the frame. */
		source?: Source;
		/** The line within the file of the frame. If source is null or doesn't exist, line is 0 and must be ignored. */
		line: number;
		/** The column within the line. If source is null or doesn't exist, column is 0 and must be ignored. */
		column: number;
		/** An optional end line of the range covered by the stack frame. */
		endLine?: number;
		/** An optional end column of the range covered by the stack frame. */
		endColumn?: number;
		/** Optional memory reference for the current instruction pointer in this frame. */
		instructionPointerReference?: string;
		/** The module associated with this frame, if any. */
		moduleId?: number | string;
		/** An optional hint for how to present this frame in the UI. A value of 'label' can be used to indicate that the frame is an artificial frame that is used as a visual label or separator. A value of 'subtle' can be used to change the appearance of a frame in a 'subtle' way. */
		presentationHint?: 'normal' | 'label' | 'subtle';
	}

	/** A Scope is a named container for variables. Optionally a scope can map to a source or a range within a source. */
	export interface Scope {
		/** Name of the scope such as 'Arguments', 'Locals', or 'Registers'. This string is shown in the UI as is and can be translated. */
		name: string;
		/** An optional hint for how to present this scope in the UI. If this attribute is missing, the scope is shown with a generic UI.
			Values:
			'arguments': Scope contains method arguments.
			'locals': Scope contains local variables.
			'registers': Scope contains registers. Only a single 'registers' scope should be returned from a 'scopes' request.
			etc.
		*/
		presentationHint?: string;
		/** The variables of this scope can be retrieved by passing the value of variablesReference to the VariablesRequest. */
		variablesReference: number;
		/** The number of named variables in this scope.
			The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
		*/
		namedVariables?: number;
		/** The number of indexed variables in this scope.
			The client can use this optional information to present the variables in a paged UI and fetch them in chunks.
		*/
		indexedVariables?: number;
		/** If true, the number of variables in this scope is large or expensive to retrieve. */
		expensive: boolean;
		/** Optional source for this scope. */
		source?: Source;
		/** Optional start line of the range covered by this scope. */
		line?: number;
		/** Optional start column of the range covered by this scope. */
		column?: number;
		/** Optional end line of the range covered by this scope. */
		endLine?: number;
		/** Optional end column of the range covered by this scope. */
		endColumn?: number;
	}

	/** A Variable is a name/value pair.
		Optionally a variable can have a 'type' that is shown if space permits or when hovering over the variable's name.
		An optional 'kind' is used to render additional properties of the variable, e.g. different icons can be used to indicate that a variable is public or private.
		If the value is structured (has children), a handle is provided to retrieve the children with the VariablesRequest.
		If the number of named or indexed children is large, the numbers should be returned via the optional 'namedVariables' and 'indexedVariables' attributes.
		The client can use this optional information to present the children in a paged UI and fetch them in chunks.
	*/
	export interface Variable {
		/** The variable's name. */
		name: string;
		/** The variable's value. This can be a multi-line text, e.g. for a function the body of a function. */
		value: string;
		/** The type of the variable's value. Typically shown in the UI when hovering over the value. */
		type?: string;
		/** Properties of a variable that can be used to determine how to render the variable in the UI. */
		presentationHint?: VariablePresentationHint;
		/** Optional evaluatable name of this variable which can be passed to the 'EvaluateRequest' to fetch the variable's value. */
		evaluateName?: string;
		/** If variablesReference is > 0, the variable is structured and its children can be retrieved by passing variablesReference to the VariablesRequest. */
		variablesReference: number;
		/** The number of named child variables.
			The client can use this optional information to present the children in a paged UI and fetch them in chunks.
		*/
		namedVariables?: number;
		/** The number of indexed child variables.
			The client can use this optional information to present the children in a paged UI and fetch them in chunks.
		*/
		indexedVariables?: number;
		/** Optional memory reference for the variable if the variable represents executable code, such as a function pointer. */
		memoryReference?: string;
	}

	/** Optional properties of a variable that can be used to determine how to render the variable in the UI. */
	export interface VariablePresentationHint {
		/** The kind of variable. Before introducing additional values, try to use the listed values.
			Values:
			'property': Indicates that the object is a property.
			'method': Indicates that the object is a method.
			'class': Indicates that the object is a class.
			'data': Indicates that the object is data.
			'event': Indicates that the object is an event.
			'baseClass': Indicates that the object is a base class.
			'innerClass': Indicates that the object is an inner class.
			'interface': Indicates that the object is an interface.
			'mostDerivedClass': Indicates that the object is the most derived class.
			'virtual': Indicates that the object is virtual, that means it is a synthetic object introduced by the adapter for rendering purposes, e.g. an index range for large arrays.
			'dataBreakpoint': Indicates that a data breakpoint is registered for the object.
			etc.
		*/
		kind?: string;
		/** Set of attributes represented as an array of strings. Before introducing additional values, try to use the listed values.
			Values:
			'static': Indicates that the object is static.
			'constant': Indicates that the object is a constant.
			'readOnly': Indicates that the object is read only.
			'rawString': Indicates that the object is a raw string.
			'hasObjectId': Indicates that the object can have an Object ID created for it.
			'canHaveObjectId': Indicates that the object has an Object ID associated with it.
			'hasSideEffects': Indicates that the evaluation had side effects.
			etc.
		*/
		attributes?: string[];
		/** Visibility of variable. Before introducing additional values, try to use the listed values.
			Values: 'public', 'private', 'protected', 'internal', 'final', etc.
		*/
		visibility?: string;
	}

	/** Properties of a breakpoint location returned from the 'breakpointLocations' request. */
	export interface BreakpointLocation {
		/** Start line of breakpoint location. */
		line: number;
		/** Optional start column of breakpoint location. */
		column?: number;
		/** Optional end line of breakpoint location if the location covers a range. */
		endLine?: number;
		/** Optional end column of breakpoint location if the location covers a range. */
		endColumn?: number;
	}

	/** Properties of a breakpoint or logpoint passed to the setBreakpoints request. */
	export interface SourceBreakpoint {
		/** The source line of the breakpoint or logpoint. */
		line: number;
		/** An optional source column of the breakpoint. */
		column?: number;
		/** An optional expression for conditional breakpoints. */
		condition?: string;
		/** An optional expression that controls how many hits of the breakpoint are ignored. The backend is expected to interpret the expression as needed. */
		hitCondition?: string;
		/** If this attribute exists and is non-empty, the backend must not 'break' (stop) but log the message instead. Expressions within {} are interpolated. */
		logMessage?: string;
	}

	/** Properties of a breakpoint passed to the setFunctionBreakpoints request. */
	export interface FunctionBreakpoint {
		/** The name of the function. */
		name: string;
		/** An optional expression for conditional breakpoints. */
		condition?: string;
		/** An optional expression that controls how many hits of the breakpoint are ignored. The backend is expected to interpret the expression as needed. */
		hitCondition?: string;
	}

	/** This enumeration defines all possible access types for data breakpoints. */
	export type DataBreakpointAccessType = 'read' | 'write' | 'readWrite';

	/** Properties of a data breakpoint passed to the setDataBreakpoints request. */
	export interface DataBreakpoint {
		/** An id representing the data. This id is returned from the dataBreakpointInfo request. */
		dataId: string;
		/** The access type of the data. */
		accessType?: DataBreakpointAccessType;
		/** An optional expression for conditional breakpoints. */
		condition?: string;
		/** An optional expression that controls how many hits of the breakpoint are ignored. The backend is expected to interpret the expression as needed. */
		hitCondition?: string;
	}

	/** Information about a Breakpoint created in setBreakpoints or setFunctionBreakpoints. */
	export interface Breakpoint {
		/** An optional identifier for the breakpoint. It is needed if breakpoint events are used to update or remove breakpoints. */
		id?: number;
		/** If true breakpoint could be set (but not necessarily at the desired location). */
		verified: boolean;
		/** An optional message about the state of the breakpoint. This is shown to the user and can be used to explain why a breakpoint could not be verified. */
		message?: string;
		/** The source where the breakpoint is located. */
		source?: Source;
		/** The start line of the actual range covered by the breakpoint. */
		line?: number;
		/** An optional start column of the actual range covered by the breakpoint. */
		column?: number;
		/** An optional end line of the actual range covered by the breakpoint. */
		endLine?: number;
		/** An optional end column of the actual range covered by the breakpoint. If no end line is given, then the end column is assumed to be in the start line. */
		endColumn?: number;
	}

	/** A StepInTarget can be used in the 'stepIn' request and determines into which single target the stepIn request should step. */
	export interface StepInTarget {
		/** Unique identifier for a stepIn target. */
		id: number;
		/** The name of the stepIn target (shown in the UI). */
		label: string;
	}

	/** A GotoTarget describes a code location that can be used as a target in the 'goto' request.
		The possible goto targets can be determined via the 'gotoTargets' request.
	*/
	export interface GotoTarget {
		/** Unique identifier for a goto target. This is used in the goto request. */
		id: number;
		/** The name of the goto target (shown in the UI). */
		label: string;
		/** The line of the goto target. */
		line: number;
		/** An optional column of the goto target. */
		column?: number;
		/** An optional end line of the range covered by the goto target. */
		endLine?: number;
		/** An optional end column of the range covered by the goto target. */
		endColumn?: number;
		/** Optional memory reference for the instruction pointer value represented by this target. */
		instructionPointerReference?: string;
	}

	/** CompletionItems are the suggestions returned from the CompletionsRequest. */
	export interface CompletionItem {
		/** The label of this completion item. By default this is also the text that is inserted when selecting this completion. */
		label: string;
		/** If text is not falsy then it is inserted instead of the label. */
		text?: string;
		/** A string that should be used when comparing this item with other items. When `falsy` the label is used. */
		sortText?: string;
		/** The item's type. Typically the client uses this information to render the item in the UI with an icon. */
		type?: CompletionItemType;
		/** This value determines the location (in the CompletionsRequest's 'text' attribute) where the completion text is added.
			If missing the text is added at the location specified by the CompletionsRequest's 'column' attribute.
		*/
		start?: number;
		/** This value determines how many characters are overwritten by the completion text.
			If missing the value 0 is assumed which results in the completion text being inserted.
		*/
		length?: number;
	}

	/** Some predefined types for the CompletionItem. Please note that not all clients have specific icons for all of them. */
	export type CompletionItemType = 'method' | 'function' | 'constructor' | 'field' | 'variable' | 'class' | 'interface' | 'module' | 'property' | 'unit' | 'value' | 'enum' | 'keyword' | 'snippet' | 'text' | 'color' | 'file' | 'reference' | 'customcolor';

	/** Names of checksum algorithms that may be supported by a debug adapter. */
	export type ChecksumAlgorithm = 'MD5' | 'SHA1' | 'SHA256' | 'timestamp';

	/** The checksum of an item calculated by the specified algorithm. */
	export interface Checksum {
		/** The algorithm used to calculate this checksum. */
		algorithm: ChecksumAlgorithm;
		/** Value of the checksum. */
		checksum: string;
	}

	/** Provides formatting information for a value. */
	export interface ValueFormat {
		/** Display the value in hex. */
		hex?: boolean;
	}

	/** Provides formatting information for a stack frame. */
	export interface StackFrameFormat extends ValueFormat {
		/** Displays parameters for the stack frame. */
		parameters?: boolean;
		/** Displays the types of parameters for the stack frame. */
		parameterTypes?: boolean;
		/** Displays the names of parameters for the stack frame. */
		parameterNames?: boolean;
		/** Displays the values of parameters for the stack frame. */
		parameterValues?: boolean;
		/** Displays the line number of the stack frame. */
		line?: boolean;
		/** Displays the module of the stack frame. */
		module?: boolean;
		/** Includes all stack frames, including those the debug adapter might otherwise hide. */
		includeAll?: boolean;
	}

	/** An ExceptionOptions assigns configuration options to a set of exceptions. */
	export interface ExceptionOptions {
		/** A path that selects a single or multiple exceptions in a tree. If 'path' is missing, the whole tree is selected. By convention the first segment of the path is a category that is used to group exceptions in the UI. */
		path?: ExceptionPathSegment[];
		/** Condition when a thrown exception should result in a break. */
		breakMode: ExceptionBreakMode;
	}

	/** This enumeration defines all possible conditions when a thrown exception should result in a break.
		never: never breaks,
		always: always breaks,
		unhandled: breaks when exception unhandled,
		userUnhandled: breaks if the exception is not handled by user code.
	*/
	export type ExceptionBreakMode = 'never' | 'always' | 'unhandled' | 'userUnhandled';

	/** An ExceptionPathSegment represents a segment in a path that is used to match leafs or nodes in a tree of exceptions. If a segment consists of more than one name, it matches the names provided if 'negate' is false or missing or it matches anything except the names provided if 'negate' is true. */
	export interface ExceptionPathSegment {
		/** If false or missing this segment matches the names provided, otherwise it matches anything except the names provided. */
		negate?: boolean;
		/** Depending on the value of 'negate' the names that should match or not match. */
		names: string[];
	}

	/** Detailed information about an exception that has occurred. */
	export interface ExceptionDetails {
		/** Message contained in the exception. */
		message?: string;
		/** Short type name of the exception object. */
		typeName?: string;
		/** Fully-qualified type name of the exception object. */
		fullTypeName?: string;
		/** Optional expression that can be evaluated in the current scope to obtain the exception object. */
		evaluateName?: string;
		/** Stack trace at the time the exception was thrown. */
		stackTrace?: string;
		/** Details of the exception contained by this exception, if any. */
		innerException?: ExceptionDetails[];
	}

	/** Represents a single disassembled instruction. */
	export interface DisassembledInstruction {
		/** The address of the instruction. Treated as a hex value if prefixed with '0x', or as a decimal value otherwise. */
		address: string;
		/** Optional raw bytes representing the instruction and its operands, in an implementation-defined format. */
		instructionBytes?: string;
		/** Text representing the instruction and its operands, in an implementation-defined format. */
		instruction: string;
		/** Name of the symbol that corresponds with the location of this instruction, if any. */
		symbol?: string;
		/** Source location that corresponds to this instruction, if any. Should always be set (if available) on the first instruction returned, but can be omitted afterwards if this instruction maps to the same source file as the previous instruction. */
		location?: Source;
		/** The line within the source location that corresponds to this instruction, if any. */
		line?: number;
		/** The column within the line that corresponds to this instruction, if any. */
		column?: number;
		/** The end line of the range that corresponds to this instruction, if any. */
		endLine?: number;
		/** The end column of the range that corresponds to this instruction, if any. */
		endColumn?: number;
	}
}

//------------------------------------------------------------------------------------------------------------------------------

export class Message implements DebugProtocol.ProtocolMessage {
	seq: number;
	type: string;

	public constructor(type: string) {
		this.seq = 0;
		this.type = type;
	}
}

export class Response extends Message implements DebugProtocol.Response {
	request_seq: number;
	success: boolean;
	command: string;

	public constructor(request: DebugProtocol.Request, message?: string) {
		super('response');
		this.request_seq = request.seq;
		this.command = request.command;
		if (message) {
			this.success = false;
			(<any>this).message = message;
		} else {
			this.success = true;
		}
	}
}

export class Event extends Message implements DebugProtocol.Event {
	event: string;

	public constructor(event: string, body?: any) {
		super('event');
		this.event = event;
		if (body) {
			(<any>this).body = body;
		}
	}
}

//--------------------------------------------------------------------------------------------------------------------------------

export class ProtocolServer implements vscode.DebugAdapter {

	private close = new vscode.EventEmitter<void>();
	onClose: vscode.Event<void> = this.close.event;

	private error = new vscode.EventEmitter<Error>();
	onError: vscode.Event<Error> = this.error.event;

	private sendMessage = new vscode.EventEmitter<DebugProtocol.ProtocolMessage>();
	readonly onDidSendMessage: vscode.Event<DebugProtocol.ProtocolMessage> = this.sendMessage.event;

	private _sequence: number = 1;
	private _pendingRequests = new Map<number, (response: DebugProtocol.Response) => void>();


	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this.dispatch(message);
	}

	public dispose() {
	}

	public sendEvent(event: DebugProtocol.Event): void {
		this._send('event', event);
	}

	public sendResponse(response: DebugProtocol.Response): void {
		if (response.seq > 0) {
			console.error(`attempt to send more than one response for command ${response.command}`);
		} else {
			this._send('response', response);
		}
	}

	public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {

		const request: any = {
			command: command
		};
		if (args && Object.keys(args).length > 0) {
			request.arguments = args;
		}

		this._send('request', request);

		if (cb) {
			this._pendingRequests.set(request.seq, cb);

			const timer = setTimeout(() => {
				clearTimeout(timer);
				const clb = this._pendingRequests.get(request.seq);
				if (clb) {
					this._pendingRequests.delete(request.seq);
					clb(new Response(request, 'timeout'));
				}
			}, timeout);
		}
	}

	// ---- protected ----------------------------------------------------------

	protected dispatchRequest(_request: DebugProtocol.Request): void {
	}

	// ---- private ------------------------------------------------------------

	private dispatch(msg: DebugProtocol.ProtocolMessage) {
		if (msg.type === 'request') {
			this.dispatchRequest(<DebugProtocol.Request>msg);
		} else if (msg.type === 'response') {
			const response = <DebugProtocol.Response>msg;
			const clb = this._pendingRequests.get(response.request_seq);
			if (clb) {
				this._pendingRequests.delete(response.request_seq);
				clb(response);
			}
		}
	}

	private _send(typ: 'request' | 'response' | 'event', message: DebugProtocol.ProtocolMessage): void {

		message.type = typ;
		message.seq = this._sequence++;

		this.sendMessage.fire(message);
	}
}

//-------------------------------------------------------------------------------------------------------------------------------

export class Source implements DebugProtocol.Source {
	name: string;
	path?: string;
	sourceReference: number;

	public constructor(name: string, path?: string, id: number = 0, origin?: string, data?: any) {
		this.name = name;
		this.path = path;
		this.sourceReference = id;
		if (origin) {
			(<any>this).origin = origin;
		}
		if (data) {
			(<any>this).adapterData = data;
		}
	}
}

export class Scope implements DebugProtocol.Scope {
	name: string;
	variablesReference: number;
	expensive: boolean;

	public constructor(name: string, reference: number, expensive: boolean = false) {
		this.name = name;
		this.variablesReference = reference;
		this.expensive = expensive;
	}
}

export class StackFrame implements DebugProtocol.StackFrame {
	id: number;
	source?: Source;
	line: number;
	column: number;
	name: string;

	public constructor(i: number, nm: string, src?: Source, ln: number = 0, col: number = 0) {
		this.id = i;
		this.source = src;
		this.line = ln;
		this.column = col;
		this.name = nm;
	}
}

export class Thread implements DebugProtocol.Thread {
	id: number;
	name: string;

	public constructor(id: number, name: string) {
		this.id = id;
		if (name) {
			this.name = name;
		} else {
			this.name = 'Thread #' + id;
		}
	}
}

export class Variable implements DebugProtocol.Variable {
	name: string;
	value: string;
	variablesReference: number;

	public constructor(name: string, value: string, ref: number = 0, indexedVariables?: number, namedVariables?: number) {
		this.name = name;
		this.value = value;
		this.variablesReference = ref;
		if (typeof namedVariables === 'number') {
			(<DebugProtocol.Variable>this).namedVariables = namedVariables;
		}
		if (typeof indexedVariables === 'number') {
			(<DebugProtocol.Variable>this).indexedVariables = indexedVariables;
		}
	}
}

export class Breakpoint implements DebugProtocol.Breakpoint {
	verified: boolean;

	public constructor(verified: boolean, line?: number, column?: number, source?: Source) {
		this.verified = verified;
		const e: DebugProtocol.Breakpoint = this;
		if (typeof line === 'number') {
			e.line = line;
		}
		if (typeof column === 'number') {
			e.column = column;
		}
		if (source) {
			e.source = source;
		}
	}
}

export class Module implements DebugProtocol.Module {
	id: number | string;
	name: string;

	public constructor(id: number | string, name: string) {
		this.id = id;
		this.name = name;
	}
}

export class CompletionItem implements DebugProtocol.CompletionItem {
	label: string;
	start: number;
	length: number;

	public constructor(label: string, start: number, length: number = 0) {
		this.label = label;
		this.start = start;
		this.length = length;
	}
}

export class StoppedEvent extends Event implements DebugProtocol.StoppedEvent {
	body: {
		reason: string;
	};

	public constructor(reason: string, threadId?: number, exceptionText?: string) {
		super('stopped');
		this.body = {
			reason: reason
		};
		if (typeof threadId === 'number') {
			(this as DebugProtocol.StoppedEvent).body.threadId = threadId;
		}
		if (typeof exceptionText === 'string') {
			(this as DebugProtocol.StoppedEvent).body.text = exceptionText;
		}
	}
}

export class ContinuedEvent extends Event implements DebugProtocol.ContinuedEvent {
	body: {
		threadId: number;
	};

	public constructor(threadId: number, allThreadsContinued?: boolean) {
		super('continued');
		this.body = {
			threadId: threadId
		};

		if (typeof allThreadsContinued === 'boolean') {
			(<DebugProtocol.ContinuedEvent>this).body.allThreadsContinued = allThreadsContinued;
		}
	}
}

export class InitializedEvent extends Event implements DebugProtocol.InitializedEvent {
	public constructor() {
		super('initialized');
	}
}

export class TerminatedEvent extends Event implements DebugProtocol.TerminatedEvent {
	public constructor(restart?: any) {
		super('terminated');
		if (typeof restart === 'boolean' || restart) {
			const e: DebugProtocol.TerminatedEvent = this;
			e.body = {
				restart: restart
			};
		}
	}
}

export class OutputEvent extends Event implements DebugProtocol.OutputEvent {
	body: {
		category: string,
		output: string,
		data?: any
	};

	public constructor(output: string, category: string = 'console', data?: any) {
		super('output');
		this.body = {
			category: category,
			output: output
		};
		if (data !== undefined) {
			this.body.data = data;
		}
	}
}

export class ThreadEvent extends Event implements DebugProtocol.ThreadEvent {
	body: {
		reason: string,
		threadId: number
	};

	public constructor(reason: string, threadId: number) {
		super('thread');
		this.body = {
			reason: reason,
			threadId: threadId
		};
	}
}

export class BreakpointEvent extends Event implements DebugProtocol.BreakpointEvent {
	body: {
		reason: string,
		breakpoint: Breakpoint
	};

	public constructor(reason: string, breakpoint: Breakpoint) {
		super('breakpoint');
		this.body = {
			reason: reason,
			breakpoint: breakpoint
		};
	}
}

export class ModuleEvent extends Event implements DebugProtocol.ModuleEvent {
	body: {
		reason: 'new' | 'changed' | 'removed',
		module: Module
	};

	public constructor(reason: 'new' | 'changed' | 'removed', module: Module) {
		super('module');
		this.body = {
			reason: reason,
			module: module
		};
	}
}

export class LoadedSourceEvent extends Event implements DebugProtocol.LoadedSourceEvent {
	body: {
		reason: 'new' | 'changed' | 'removed',
		source: Source
	};

	public constructor(reason: 'new' | 'changed' | 'removed', source: Source) {
		super('loadedSource');
		this.body = {
			reason: reason,
			source: source
		};
	}
}

export class CapabilitiesEvent extends Event implements DebugProtocol.CapabilitiesEvent {
	body: {
		capabilities: DebugProtocol.Capabilities
	};

	public constructor(capabilities: DebugProtocol.Capabilities) {
		super('capabilities');
		this.body = {
			capabilities: capabilities
		};
	}
}

export enum ErrorDestination {
	User = 1,
	Telemetry = 2
}

export class DebugSession extends ProtocolServer {

	private _debuggerLinesStartAt1: boolean;
	private _debuggerColumnsStartAt1: boolean;
	private _debuggerPathsAreURIs: boolean;

	private _clientLinesStartAt1: boolean;
	private _clientColumnsStartAt1: boolean;
	private _clientPathsAreURIs: boolean;

	protected _isServer: boolean;

	public constructor(obsolete_debuggerLinesAndColumnsStartAt1?: boolean, obsolete_isServer?: boolean) {
		super();

		const linesAndColumnsStartAt1 = typeof obsolete_debuggerLinesAndColumnsStartAt1 === 'boolean' ? obsolete_debuggerLinesAndColumnsStartAt1 : false;
		this._debuggerLinesStartAt1 = linesAndColumnsStartAt1;
		this._debuggerColumnsStartAt1 = linesAndColumnsStartAt1;
		this._debuggerPathsAreURIs = false;

		this._clientLinesStartAt1 = true;
		this._clientColumnsStartAt1 = true;
		this._clientPathsAreURIs = false;

		this._isServer = typeof obsolete_isServer === 'boolean' ? obsolete_isServer : false;

		this.onClose(() => {
			this.shutdown();
		});
		this.onError((_error) => {
			this.shutdown();
		});
	}

	public setDebuggerPathFormat(format: string) {
		this._debuggerPathsAreURIs = format !== 'path';
	}

	public setDebuggerLinesStartAt1(enable: boolean) {
		this._debuggerLinesStartAt1 = enable;
	}

	public setDebuggerColumnsStartAt1(enable: boolean) {
		this._debuggerColumnsStartAt1 = enable;
	}

	public setRunAsServer(enable: boolean) {
		this._isServer = enable;
	}

	public shutdown(): void {
		if (this._isServer) {
			// shutdown ignored in server mode
		} else {
			// TODO@AW
			/*
			// wait a bit before shutting down
			setTimeout(() => {
				process.exit(0);
			}, 100);
			*/
		}
	}

	protected sendErrorResponse(response: DebugProtocol.Response, codeOrMessage: number | DebugProtocol.Message, format?: string, variables?: any, dest: ErrorDestination = ErrorDestination.User): void {

		let msg: DebugProtocol.Message;
		if (typeof codeOrMessage === 'number') {
			msg = <DebugProtocol.Message>{
				id: <number>codeOrMessage,
				format: format
			};
			if (variables) {
				msg.variables = variables;
			}
			if (dest & ErrorDestination.User) {
				msg.showUser = true;
			}
			if (dest & ErrorDestination.Telemetry) {
				msg.sendTelemetry = true;
			}
		} else {
			msg = codeOrMessage;
		}

		response.success = false;
		response.message = DebugSession.formatPII(msg.format, true, msg.variables);
		if (!response.body) {
			response.body = {};
		}
		response.body.error = msg;

		this.sendResponse(response);
	}

	public runInTerminalRequest(args: DebugProtocol.RunInTerminalRequestArguments, timeout: number, cb: (response: DebugProtocol.Response) => void) {
		this.sendRequest('runInTerminal', args, timeout, cb);
	}

	protected dispatchRequest(request: DebugProtocol.Request): void {

		const response = new Response(request);

		try {
			if (request.command === 'initialize') {
				const args = <DebugProtocol.InitializeRequestArguments>request.arguments;

				if (typeof args.linesStartAt1 === 'boolean') {
					this._clientLinesStartAt1 = args.linesStartAt1;
				}
				if (typeof args.columnsStartAt1 === 'boolean') {
					this._clientColumnsStartAt1 = args.columnsStartAt1;
				}

				if (args.pathFormat !== 'path') {
					this.sendErrorResponse(response, 2018, 'debug adapter only supports native paths', null, ErrorDestination.Telemetry);
				} else {
					const initializeResponse = <DebugProtocol.InitializeResponse>response;
					initializeResponse.body = {};
					this.initializeRequest(initializeResponse, args);
				}

			} else if (request.command === 'launch') {
				this.launchRequest(<DebugProtocol.LaunchResponse>response, request.arguments, request);

			} else if (request.command === 'attach') {
				this.attachRequest(<DebugProtocol.AttachResponse>response, request.arguments, request);

			} else if (request.command === 'disconnect') {
				this.disconnectRequest(<DebugProtocol.DisconnectResponse>response, request.arguments, request);

			} else if (request.command === 'terminate') {
				this.terminateRequest(<DebugProtocol.TerminateResponse>response, request.arguments, request);

			} else if (request.command === 'restart') {
				this.restartRequest(<DebugProtocol.RestartResponse>response, request.arguments, request);

			} else if (request.command === 'setBreakpoints') {
				this.setBreakPointsRequest(<DebugProtocol.SetBreakpointsResponse>response, request.arguments, request);

			} else if (request.command === 'setFunctionBreakpoints') {
				this.setFunctionBreakPointsRequest(<DebugProtocol.SetFunctionBreakpointsResponse>response, request.arguments, request);

			} else if (request.command === 'setExceptionBreakpoints') {
				this.setExceptionBreakPointsRequest(<DebugProtocol.SetExceptionBreakpointsResponse>response, request.arguments, request);

			} else if (request.command === 'configurationDone') {
				this.configurationDoneRequest(<DebugProtocol.ConfigurationDoneResponse>response, request.arguments, request);

			} else if (request.command === 'continue') {
				this.continueRequest(<DebugProtocol.ContinueResponse>response, request.arguments, request);

			} else if (request.command === 'next') {
				this.nextRequest(<DebugProtocol.NextResponse>response, request.arguments, request);

			} else if (request.command === 'stepIn') {
				this.stepInRequest(<DebugProtocol.StepInResponse>response, request.arguments, request);

			} else if (request.command === 'stepOut') {
				this.stepOutRequest(<DebugProtocol.StepOutResponse>response, request.arguments, request);

			} else if (request.command === 'stepBack') {
				this.stepBackRequest(<DebugProtocol.StepBackResponse>response, request.arguments, request);

			} else if (request.command === 'reverseContinue') {
				this.reverseContinueRequest(<DebugProtocol.ReverseContinueResponse>response, request.arguments, request);

			} else if (request.command === 'restartFrame') {
				this.restartFrameRequest(<DebugProtocol.RestartFrameResponse>response, request.arguments, request);

			} else if (request.command === 'goto') {
				this.gotoRequest(<DebugProtocol.GotoResponse>response, request.arguments, request);

			} else if (request.command === 'pause') {
				this.pauseRequest(<DebugProtocol.PauseResponse>response, request.arguments, request);

			} else if (request.command === 'stackTrace') {
				this.stackTraceRequest(<DebugProtocol.StackTraceResponse>response, request.arguments, request);

			} else if (request.command === 'scopes') {
				this.scopesRequest(<DebugProtocol.ScopesResponse>response, request.arguments, request);

			} else if (request.command === 'variables') {
				this.variablesRequest(<DebugProtocol.VariablesResponse>response, request.arguments, request);

			} else if (request.command === 'setVariable') {
				this.setVariableRequest(<DebugProtocol.SetVariableResponse>response, request.arguments, request);

			} else if (request.command === 'setExpression') {
				this.setExpressionRequest(<DebugProtocol.SetExpressionResponse>response, request.arguments, request);

			} else if (request.command === 'source') {
				this.sourceRequest(<DebugProtocol.SourceResponse>response, request.arguments, request);

			} else if (request.command === 'threads') {
				this.threadsRequest(<DebugProtocol.ThreadsResponse>response, request);

			} else if (request.command === 'terminateThreads') {
				this.terminateThreadsRequest(<DebugProtocol.TerminateThreadsResponse>response, request.arguments, request);

			} else if (request.command === 'evaluate') {
				this.evaluateRequest(<DebugProtocol.EvaluateResponse>response, request.arguments, request);

			} else if (request.command === 'stepInTargets') {
				this.stepInTargetsRequest(<DebugProtocol.StepInTargetsResponse>response, request.arguments, request);

			} else if (request.command === 'gotoTargets') {
				this.gotoTargetsRequest(<DebugProtocol.GotoTargetsResponse>response, request.arguments, request);

			} else if (request.command === 'completions') {
				this.completionsRequest(<DebugProtocol.CompletionsResponse>response, request.arguments, request);

			} else if (request.command === 'exceptionInfo') {
				this.exceptionInfoRequest(<DebugProtocol.ExceptionInfoResponse>response, request.arguments, request);

			} else if (request.command === 'loadedSources') {
				this.loadedSourcesRequest(<DebugProtocol.LoadedSourcesResponse>response, request.arguments, request);

			} else if (request.command === 'dataBreakpointInfo') {
				this.dataBreakpointInfoRequest(<DebugProtocol.DataBreakpointInfoResponse>response, request.arguments, request);

			} else if (request.command === 'setDataBreakpoints') {
				this.setDataBreakpointsRequest(<DebugProtocol.SetDataBreakpointsResponse>response, request.arguments, request);

			} else if (request.command === 'readMemory') {
				this.readMemoryRequest(<DebugProtocol.ReadMemoryResponse>response, request.arguments, request);

			} else if (request.command === 'disassemble') {
				this.disassembleRequest(<DebugProtocol.DisassembleResponse>response, request.arguments, request);

			} else if (request.command === 'cancel') {
				this.cancelRequest(<DebugProtocol.CancelResponse>response, request.arguments, request);

			} else if (request.command === 'breakpointLocations') {
				this.breakpointLocationsRequest(<DebugProtocol.BreakpointLocationsResponse>response, request.arguments, request);

			} else {
				this.customRequest(request.command, <DebugProtocol.Response>response, request.arguments, request);
			}
		} catch (e) {
			this.sendErrorResponse(response, 1104, '{_stack}', { _exception: e.message, _stack: e.stack }, ErrorDestination.Telemetry);
		}
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {

		response.body = response.body || {};

		// This default debug adapter does not support conditional breakpoints.
		response.body.supportsConditionalBreakpoints = false;

		// This default debug adapter does not support hit conditional breakpoints.
		response.body.supportsHitConditionalBreakpoints = false;

		// This default debug adapter does not support function breakpoints.
		response.body.supportsFunctionBreakpoints = false;

		// This default debug adapter implements the 'configurationDone' request.
		response.body.supportsConfigurationDoneRequest = true;

		// This default debug adapter does not support hovers based on the 'evaluate' request.
		response.body.supportsEvaluateForHovers = false;

		// This default debug adapter does not support the 'stepBack' request.
		response.body.supportsStepBack = false;

		// This default debug adapter does not support the 'setVariable' request.
		response.body.supportsSetVariable = false;

		// This default debug adapter does not support the 'restartFrame' request.
		response.body.supportsRestartFrame = false;

		// This default debug adapter does not support the 'stepInTargets' request.
		response.body.supportsStepInTargetsRequest = false;

		// This default debug adapter does not support the 'gotoTargets' request.
		response.body.supportsGotoTargetsRequest = false;

		// This default debug adapter does not support the 'completions' request.
		response.body.supportsCompletionsRequest = false;

		// This default debug adapter does not support the 'restart' request.
		response.body.supportsRestartRequest = false;

		// This default debug adapter does not support the 'exceptionOptions' attribute on the 'setExceptionBreakpoints' request.
		response.body.supportsExceptionOptions = false;

		// This default debug adapter does not support the 'format' attribute on the 'variables', 'evaluate', and 'stackTrace' request.
		response.body.supportsValueFormattingOptions = false;

		// This debug adapter does not support the 'exceptionInfo' request.
		response.body.supportsExceptionInfoRequest = false;

		// This debug adapter does not support the 'TerminateDebuggee' attribute on the 'disconnect' request.
		response.body.supportTerminateDebuggee = false;

		// This debug adapter does not support delayed loading of stack frames.
		response.body.supportsDelayedStackTraceLoading = false;

		// This debug adapter does not support the 'loadedSources' request.
		response.body.supportsLoadedSourcesRequest = false;

		// This debug adapter does not support the 'logMessage' attribute of the SourceBreakpoint.
		response.body.supportsLogPoints = false;

		// This debug adapter does not support the 'terminateThreads' request.
		response.body.supportsTerminateThreadsRequest = false;

		// This debug adapter does not support the 'setExpression' request.
		response.body.supportsSetExpression = false;

		// This debug adapter does not support the 'terminate' request.
		response.body.supportsTerminateRequest = false;

		// This debug adapter does not support data breakpoints.
		response.body.supportsDataBreakpoints = false;

		/** This debug adapter does not support the 'readMemory' request. */
		response.body.supportsReadMemoryRequest = false;

		/** The debug adapter does not support the 'disassemble' request. */
		response.body.supportsDisassembleRequest = false;

		/** The debug adapter does not support the 'cancel' request. */
		response.body.supportsCancelRequest = false;

		/** The debug adapter does not support the 'breakpointLocations' request. */
		response.body.supportsBreakpointLocationsRequest = false;

		this.sendResponse(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, _args: DebugProtocol.DisconnectArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
		this.shutdown();
	}

	protected launchRequest(response: DebugProtocol.LaunchResponse, _args: DebugProtocol.LaunchRequestArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected attachRequest(response: DebugProtocol.AttachResponse, _args: DebugProtocol.AttachRequestArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, _args: DebugProtocol.TerminateArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected restartRequest(response: DebugProtocol.RestartResponse, _args: DebugProtocol.RestartArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, _args: DebugProtocol.SetBreakpointsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, _args: DebugProtocol.SetFunctionBreakpointsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, _args: DebugProtocol.SetExceptionBreakpointsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, _args: DebugProtocol.ConfigurationDoneArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, _args: DebugProtocol.ContinueArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, _args: DebugProtocol.NextArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, _args: DebugProtocol.StepInArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, _args: DebugProtocol.StepOutArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, _args: DebugProtocol.StepBackArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, _args: DebugProtocol.ReverseContinueArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected restartFrameRequest(response: DebugProtocol.RestartFrameResponse, _args: DebugProtocol.RestartFrameArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected gotoRequest(response: DebugProtocol.GotoResponse, _args: DebugProtocol.GotoArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected pauseRequest(response: DebugProtocol.PauseResponse, _args: DebugProtocol.PauseArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected sourceRequest(response: DebugProtocol.SourceResponse, _args: DebugProtocol.SourceArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected terminateThreadsRequest(response: DebugProtocol.TerminateThreadsResponse, _args: DebugProtocol.TerminateThreadsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, _args: DebugProtocol.StackTraceArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, _args: DebugProtocol.ScopesArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, _args: DebugProtocol.VariablesArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected setVariableRequest(response: DebugProtocol.SetVariableResponse, _args: DebugProtocol.SetVariableArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected setExpressionRequest(response: DebugProtocol.SetExpressionResponse, _args: DebugProtocol.SetExpressionArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, _args: DebugProtocol.EvaluateArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, _args: DebugProtocol.StepInTargetsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected gotoTargetsRequest(response: DebugProtocol.GotoTargetsResponse, _args: DebugProtocol.GotoTargetsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected completionsRequest(response: DebugProtocol.CompletionsResponse, _args: DebugProtocol.CompletionsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, _args: DebugProtocol.ExceptionInfoArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected loadedSourcesRequest(response: DebugProtocol.LoadedSourcesResponse, _args: DebugProtocol.LoadedSourcesArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, _args: DebugProtocol.DataBreakpointInfoArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, _args: DebugProtocol.SetDataBreakpointsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected readMemoryRequest(response: DebugProtocol.ReadMemoryResponse, _args: DebugProtocol.ReadMemoryArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected disassembleRequest(response: DebugProtocol.DisassembleResponse, _args: DebugProtocol.DisassembleArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, _args: DebugProtocol.CancelArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, _args: DebugProtocol.BreakpointLocationsArguments, _request?: DebugProtocol.Request): void {
		this.sendResponse(response);
	}

	/**
	 * Override this hook to implement custom requests.
	 */
	protected customRequest(_command: string, response: DebugProtocol.Response, _args: any, _request?: DebugProtocol.Request): void {
		this.sendErrorResponse(response, 1014, 'unrecognized request', null, ErrorDestination.Telemetry);
	}

	//---- protected -------------------------------------------------------------------------------------------------

	protected convertClientLineToDebugger(line: number): number {
		if (this._debuggerLinesStartAt1) {
			return this._clientLinesStartAt1 ? line : line + 1;
		}
		return this._clientLinesStartAt1 ? line - 1 : line;
	}

	protected convertDebuggerLineToClient(line: number): number {
		if (this._debuggerLinesStartAt1) {
			return this._clientLinesStartAt1 ? line : line - 1;
		}
		return this._clientLinesStartAt1 ? line + 1 : line;
	}

	protected convertClientColumnToDebugger(column: number): number {
		if (this._debuggerColumnsStartAt1) {
			return this._clientColumnsStartAt1 ? column : column + 1;
		}
		return this._clientColumnsStartAt1 ? column - 1 : column;
	}

	protected convertDebuggerColumnToClient(column: number): number {
		if (this._debuggerColumnsStartAt1) {
			return this._clientColumnsStartAt1 ? column : column - 1;
		}
		return this._clientColumnsStartAt1 ? column + 1 : column;
	}

	protected convertClientPathToDebugger(clientPath: string): string {
		if (this._clientPathsAreURIs !== this._debuggerPathsAreURIs) {
			if (this._clientPathsAreURIs) {
				return DebugSession.uri2path(clientPath);
			} else {
				return DebugSession.path2uri(clientPath);
			}
		}
		return clientPath;
	}

	protected convertDebuggerPathToClient(debuggerPath: string): string {
		if (this._debuggerPathsAreURIs !== this._clientPathsAreURIs) {
			if (this._debuggerPathsAreURIs) {
				return DebugSession.uri2path(debuggerPath);
			} else {
				return DebugSession.path2uri(debuggerPath);
			}
		}
		return debuggerPath;
	}

	//---- private -------------------------------------------------------------------------------

	private static path2uri(path: string): string {

		path = encodeURI(path);

		let uri = new URL(`file:`);	// ignore 'path' for now
		uri.pathname = path;	// now use 'path' to get the correct percent encoding (see https://url.spec.whatwg.org)
		return uri.toString();
	}

	private static uri2path(sourceUri: string): string {

		let uri = new URL(sourceUri);
		let s = decodeURIComponent(uri.pathname);
		return s;
	}

	private static _formatPIIRegexp = /{([^}]+)}/g;

	/*
	* If argument starts with '_' it is OK to send its value to telemetry.
	*/
	private static formatPII(format: string, excludePII: boolean, args?: { [key: string]: string }): string {
		return format.replace(DebugSession._formatPIIRegexp, function (match, paramName) {
			if (excludePII && paramName.length > 0 && paramName[0] !== '_') {
				return match;
			}
			return args && args[paramName] && args.hasOwnProperty(paramName) ?
				args[paramName] :
				match;
		});
	}
}

//---------------------------------------------------------------------------

export class Handles<T> {

	private START_HANDLE = 1000;

	private _nextHandle: number;
	private _handleMap = new Map<number, T>();

	public constructor(startHandle?: number) {
		this._nextHandle = typeof startHandle === 'number' ? startHandle : this.START_HANDLE;
	}

	public reset(): void {
		this._nextHandle = this.START_HANDLE;
		this._handleMap = new Map<number, T>();
	}

	public create(value: T): number {
		const handle = this._nextHandle++;
		this._handleMap.set(handle, value);
		return handle;
	}

	public get(handle: number, dflt?: T): T | undefined {
		return this._handleMap.get(handle) || dflt;
	}
}

//---------------------------------------------------------------------------

class MockConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, _token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'markdown') {
				config.type = 'mock';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage('Cannot find a program to debug').then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

export class MockDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	constructor(private memfs: MemFS) {
	}

	createDebugAdapterDescriptor(_session: vscode.DebugSession, _executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return <any>new vscode.DebugAdapterInlineImplementation(new MockDebugSession(this.memfs));
	}
}

function basename(path: string): string {
	const pos = path.lastIndexOf('/');
	if (pos >= 0) {
		return path.substring(pos + 1);
	}
	return path;
}

function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * This interface describes the mock-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the mock-debug extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
}

export class MockDebugSession extends DebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	// a Mock runtime (or debugger)
	private _runtime: MockRuntime;

	private _variableHandles = new Handles<string>();

	//private _configurationDone = new Subject();

	private promiseResolve?: () => void;
	private _configurationDone = new Promise<void>((r, _e) => {
		this.promiseResolve = r;
		setTimeout(r, 1000);
	});

	private _cancelationTokens = new Map<number, boolean>();
	private _isLongrunning = new Map<number, boolean>();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor(memfs: MemFS) {

		super();

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);

		this._runtime = new MockRuntime(memfs);

		// setup event handlers
		this._runtime.onStopOnEntry(() => {
			this.sendEvent(new StoppedEvent('entry', MockDebugSession.THREAD_ID));
		});
		this._runtime.onStopOnStep(() => {
			this.sendEvent(new StoppedEvent('step', MockDebugSession.THREAD_ID));
		});
		this._runtime.onStopOnBreakpoint(() => {
			this.sendEvent(new StoppedEvent('breakpoint', MockDebugSession.THREAD_ID));
		});
		this._runtime.onStopOnDataBreakpoint(() => {
			this.sendEvent(new StoppedEvent('data breakpoint', MockDebugSession.THREAD_ID));
		});
		this._runtime.onStopOnException(() => {
			this.sendEvent(new StoppedEvent('exception', MockDebugSession.THREAD_ID));
		});
		this._runtime.onBreakpointValidated((bp: MockBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this._runtime.onOutput(oe => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${oe.text}\n`);
			e.body.source = this.createSource(oe.filePath);
			e.body.line = this.convertDebuggerLineToClient(oe.line);
			e.body.column = this.convertDebuggerColumnToClient(oe.column);
			this.sendEvent(e);
		});
		this._runtime.onEnd(() => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, _args: DebugProtocol.InitializeRequestArguments): void {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = true;

		// make VS Code to support data breakpoints
		response.body.supportsDataBreakpoints = true;

		// make VS Code to support completion in REPL
		response.body.supportsCompletionsRequest = true;
		response.body.completionTriggerCharacters = ['.', '['];

		// make VS Code to send cancelRequests
		response.body.supportsCancelRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		//this._configurationDone.notify();
		if (this.promiseResolve) {
			this.promiseResolve();
		}
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		//logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone;

		// start the program in the runtime
		this._runtime.start(`memfs:${args.program}`, !!args.stopOnEntry);

		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		const path = <string>args.source.path;
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		this._runtime.clearBreakpoints(path);

		// set and verify breakpoint locations
		const actualBreakpoints = clientLines.map(l => {
			let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = <DebugProtocol.Breakpoint>new Breakpoint(verified, this.convertDebuggerLineToClient(line));
			bp.id = id;
			return bp;
		});

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, _request?: DebugProtocol.Request): void {

		if (args.source.path) {
			const bps = this._runtime.getBreakpoints(args.source.path, this.convertClientLineToDebugger(args.line));
			response.body = {
				breakpoints: bps.map(col => {
					return {
						line: args.line,
						column: this.convertDebuggerColumnToClient(col)
					};
				})
			};
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(MockDebugSession.THREAD_ID, 'thread 1')
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const stk = this._runtime.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line))),
			totalFrames: stk.count
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, _args: DebugProtocol.ScopesArguments): void {

		response.body = {
			scopes: [
				new Scope('Local', this._variableHandles.create('local'), false),
				new Scope('Global', this._variableHandles.create('global'), true)
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {

		const variables: DebugProtocol.Variable[] = [];

		if (this._isLongrunning.get(args.variablesReference)) {
			// long running

			if (request) {
				this._cancelationTokens.set(request.seq, false);
			}

			for (let i = 0; i < 100; i++) {
				await timeout(1000);
				variables.push({
					name: `i_${i}`,
					type: 'integer',
					value: `${i}`,
					variablesReference: 0
				});
				if (request && this._cancelationTokens.get(request.seq)) {
					break;
				}
			}

			if (request) {
				this._cancelationTokens.delete(request.seq);
			}

		} else {

			const id = this._variableHandles.get(args.variablesReference);

			if (id) {
				variables.push({
					name: id + '_i',
					type: 'integer',
					value: '123',
					variablesReference: 0
				});
				variables.push({
					name: id + '_f',
					type: 'float',
					value: '3.14',
					variablesReference: 0
				});
				variables.push({
					name: id + '_s',
					type: 'string',
					value: 'hello world',
					variablesReference: 0
				});
				variables.push({
					name: id + '_o',
					type: 'object',
					value: 'Object',
					variablesReference: this._variableHandles.create(id + '_o')
				});

				// cancelation support for long running requests
				const nm = id + '_long_running';
				const ref = this._variableHandles.create(id + '_lr');
				variables.push({
					name: nm,
					type: 'object',
					value: 'Object',
					variablesReference: ref
				});
				this._isLongrunning.set(ref, true);
			}
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, _args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, _args: DebugProtocol.ReverseContinueArguments): void {
		this._runtime.continue(true);
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, _args: DebugProtocol.NextArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, _args: DebugProtocol.StepBackArguments): void {
		this._runtime.step(true);
		this.sendResponse(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		let reply: string | undefined = undefined;

		if (args.context === 'repl') {
			// 'evaluate' supports to create and delete breakpoints from the 'repl':
			const matches = /new +([0-9]+)/.exec(args.expression);
			if (matches && matches.length === 2) {
				if (this._runtime.sourceFile) {
					const mbp = this._runtime.setBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
					const bp = <DebugProtocol.Breakpoint>new Breakpoint(mbp.verified, this.convertDebuggerLineToClient(mbp.line), undefined, this.createSource(this._runtime.sourceFile));
					bp.id = mbp.id;
					this.sendEvent(new BreakpointEvent('new', bp));
					reply = `breakpoint created`;
				}
			} else {
				const matches = /del +([0-9]+)/.exec(args.expression);
				if (matches && matches.length === 2) {
					const mbp = this._runtime.sourceFile ? this._runtime.clearBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1]))) : undefined;
					if (mbp) {
						const bp = <DebugProtocol.Breakpoint>new Breakpoint(false);
						bp.id = mbp.id;
						this.sendEvent(new BreakpointEvent('removed', bp));
						reply = `breakpoint deleted`;
					}
				}
			}
		}

		response.body = {
			result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {

		response.body = {
			dataId: null,
			description: 'cannot break on data access',
			accessTypes: undefined,
			canPersist: false
		};

		if (args.variablesReference && args.name) {
			const id = this._variableHandles.get(args.variablesReference);
			if (id && id.startsWith('global_')) {
				response.body.dataId = args.name;
				response.body.description = args.name;
				response.body.accessTypes = ['read'];
				response.body.canPersist = false;
			}
		}

		this.sendResponse(response);
	}

	protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments): void {

		// clear all data breakpoints
		this._runtime.clearAllDataBreakpoints();

		response.body = {
			breakpoints: []
		};

		for (let dbp of args.breakpoints) {
			// assume that id is the "address" to break on
			const ok = this._runtime.setDataBreakpoint(dbp.dataId);
			response.body.breakpoints.push({
				verified: ok
			});
		}

		this.sendResponse(response);
	}

	protected completionsRequest(response: DebugProtocol.CompletionsResponse, _args: DebugProtocol.CompletionsArguments): void {

		response.body = {
			targets: [
				{
					label: 'item 10',
					sortText: '10'
				},
				{
					label: 'item 1',
					sortText: '01'
				},
				{
					label: 'item 2',
					sortText: '02'
				}
			]
		};
		this.sendResponse(response);
	}

	protected cancelRequest(_response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
		if (args.requestId) {
			this._cancelationTokens.set(args.requestId, true);
		}
	}

	//---- helpers

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
	}
}

//------------------------------------------------------------------------------------------------------------------------------------------


/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

export interface MockBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

export interface MockOutputEvent {
	text: string;
	filePath: string;
	line: number;
	column: number;
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class MockRuntime {

	private stopOnEntry = new vscode.EventEmitter<void>();
	onStopOnEntry: vscode.Event<void> = this.stopOnEntry.event;

	private stopOnStep = new vscode.EventEmitter<void>();
	onStopOnStep: vscode.Event<void> = this.stopOnStep.event;

	private stopOnBreakpoint = new vscode.EventEmitter<void>();
	onStopOnBreakpoint: vscode.Event<void> = this.stopOnBreakpoint.event;

	private stopOnDataBreakpoint = new vscode.EventEmitter<void>();
	onStopOnDataBreakpoint: vscode.Event<void> = this.stopOnDataBreakpoint.event;

	private stopOnException = new vscode.EventEmitter<void>();
	onStopOnException: vscode.Event<void> = this.stopOnException.event;

	private breakpointValidated = new vscode.EventEmitter<MockBreakpoint>();
	onBreakpointValidated: vscode.Event<MockBreakpoint> = this.breakpointValidated.event;

	private output = new vscode.EventEmitter<MockOutputEvent>();
	onOutput: vscode.Event<MockOutputEvent> = this.output.event;

	private end = new vscode.EventEmitter<void>();
	onEnd: vscode.Event<void> = this.end.event;


	// the initial (and one and only) file we are 'debugging'
	private _sourceFile?: string;
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[] = [];

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, MockBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _breakAddresses = new Set<string>();

	constructor(private memfs: MemFS) {
	}

	/**
	 * Start executing the given program.
	 */
	public start(program: string, stopOnEntry: boolean) {

		this.loadSource(program);
		this._currentLine = -1;

		if (this._sourceFile) {
			this.verifyBreakpoints(this._sourceFile);
		}

		if (stopOnEntry) {
			// we step once
			this.step(false, this.stopOnEntry);
		} else {
			// we just start to run until we hit a breakpoint or an exception
			this.continue();
		}
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse = false) {
		this.run(reverse, undefined);
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = this.stopOnStep) {
		this.run(reverse, event);
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): { frames: any[], count: number } {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const frames = new Array<any>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push({
				index: i,
				name: `${name}(${i})`,
				file: this._sourceFile,
				line: this._currentLine
			});
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	public getBreakpoints(_path: string, line: number): number[] {

		const l = this._sourceLines[line];

		let sawSpace = true;
		const bps: number[] = [];
		for (let i = 0; i < l.length; i++) {
			if (l[i] !== ' ') {
				if (sawSpace) {
					bps.push(i);
					sawSpace = false;
				}
			} else {
				sawSpace = true;
			}
		}

		return bps;
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number): MockBreakpoint {

		const bp = <MockBreakpoint>{ verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<MockBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number): MockBreakpoint | undefined {
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}

	/*
	 * Set data breakpoint.
	 */
	public setDataBreakpoint(address: string): boolean {
		if (address) {
			this._breakAddresses.add(address);
			return true;
		}
		return false;
	}

	/*
	 * Clear all data breakpoints.
	 */
	public clearAllDataBreakpoints(): void {
		this._breakAddresses.clear();
	}

	// private methods

	private loadSource(file: string) {
		if (this._sourceFile !== file) {
			this._sourceFile = file;

			const _textDecoder = new TextDecoder();

			const uri = vscode.Uri.parse(file);
			const content = _textDecoder.decode(this.memfs.readFile(uri));
			this._sourceLines = content.split('\n');

			//this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	/**
	 * Run through the file.
	 * If stepEvent is specified only run a single step and emit the stepEvent.
	 */
	private run(reverse = false, stepEvent?: vscode.EventEmitter<void>): void {
		if (reverse) {
			for (let ln = this._currentLine - 1; ln >= 0; ln--) {
				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLine = ln;
					return;
				}
			}
			// no more lines: stop at first line
			this._currentLine = 0;
			this.stopOnEntry.fire();
		} else {
			for (let ln = this._currentLine + 1; ln < this._sourceLines.length; ln++) {
				if (this.fireEventsForLine(ln, stepEvent)) {
					this._currentLine = ln;
					return;
				}
			}
			// no more lines: run to end
			this.end.fire();
		}
	}

	private verifyBreakpoints(path: string): void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[bp.line].trim();

					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
					// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
					if (srcLine.indexOf('-') === 0) {
						bp.line--;
					}
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					if (srcLine.indexOf('lazy') < 0) {
						bp.verified = true;
						this.breakpointValidated.fire(bp);
					}
				}
			});
		}
	}

	/**
	 * Fire events if line has a breakpoint or the word 'exception' is found.
	 * Returns true is execution needs to stop.
	 */
	private fireEventsForLine(ln: number, stepEvent?: vscode.EventEmitter<void>): boolean {

		const line = this._sourceLines[ln].trim();

		// if 'log(...)' found in source -> send argument to debug console
		const matches = /log\((.*)\)/.exec(line);
		if (matches && matches.length === 2) {
			if (this._sourceFile) {
				this.output.fire({ text: matches[1], filePath: this._sourceFile, line: ln, column: matches.index });
			}
		}

		// if a word in a line matches a data breakpoint, fire a 'dataBreakpoint' event
		const words = line.split(' ');
		for (let word of words) {
			if (this._breakAddresses.has(word)) {
				this.stopOnDataBreakpoint.fire();
				return true;
			}
		}

		// if word 'exception' found in source -> throw exception
		if (line.indexOf('exception') >= 0) {
			this.stopOnException.fire();
			return true;
		}

		// is there a breakpoint?
		const breakpoints = this._sourceFile ? this._breakPoints.get(this._sourceFile) : undefined;
		if (breakpoints) {
			const bps = breakpoints.filter(bp => bp.line === ln);
			if (bps.length > 0) {

				// send 'stopped' event
				this.stopOnBreakpoint.fire();

				// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
				// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
				if (!bps[0].verified) {
					bps[0].verified = true;
					this.breakpointValidated.fire(bps[0]);
				}
				return true;
			}
		}

		// non-empty line
		if (stepEvent && line.length > 0) {
			stepEvent.fire();
			return true;
		}

		// nothing interesting found -> continue
		return false;
	}
}
