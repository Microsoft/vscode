/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI as uri } from 'vs/base/common/uri';
import severity from 'vs/base/common/severity';
import { Event } from 'vs/base/common/event';
import { IJSONSchemaSnippet } from 'vs/base/common/jsonSchema';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ITextModel as EditorIModel } from 'vs/editor/common/model';
import { IEditorPane, ITextEditorPane } from 'vs/workbench/common/editor';
import { Position, IPosition } from 'vs/editor/common/core/position';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import { Range, IRange } from 'vs/editor/common/core/range';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IDisposable } from 'vs/base/common/lifecycle';
import { TaskIdentifier } from 'vs/workbench/contrib/tasks/common/tasks';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DebugConfigurationProviderTriggerKind } from 'vs/workbench/api/common/extHostTypes';
import { DebugCompoundRoot } from 'vs/workbench/contrib/debug/common/debugCompoundRoot';
import { IAction } from 'vs/base/common/actions';
import { ITelemetryEndpoint } from 'vs/platform/telemetry/common/telemetry';

export const VIEWLET_ID = 'workbench.view.debug';

export const VARIABLES_VIEW_ID = 'workbench.debug.variablesView';
export const WATCH_VIEW_ID = 'workbench.debug.watchExpressionsView';
export const CALLSTACK_VIEW_ID = 'workbench.debug.callStackView';
export const LOADED_SCRIPTS_VIEW_ID = 'workbench.debug.loadedScriptsView';
export const BREAKPOINTS_VIEW_ID = 'workbench.debug.breakPointsView';
export const DEBUG_PANEL_ID = 'workbench.panel.repl';
export const REPL_VIEW_ID = 'workbench.panel.repl.view';
export const DEBUG_SERVICE_ID = 'debugService';
export const CONTEXT_DEBUG_TYPE = new RawContextKey<string>('debugType', undefined, { type: 'string', description: nls.localize('debugType', "Debug type of the active debug session. For example 'python'.") });
export const CONTEXT_DEBUG_CONFIGURATION_TYPE = new RawContextKey<string>('debugConfigurationType', undefined, { type: 'string', description: nls.localize('debugConfigurationType', "Debug type of the selected launch configuration. For example 'python'.") });
export const CONTEXT_DEBUG_STATE = new RawContextKey<string>('debugState', 'inactive', { type: 'string', description: nls.localize('debugState', "State that the focused debug session is in. One of the following: 'inactive', 'initializing', 'stopped' or 'running'.") });
export const CONTEXT_DEBUG_UX_KEY = 'debugUx';
export const CONTEXT_DEBUG_UX = new RawContextKey<string>(CONTEXT_DEBUG_UX_KEY, 'default', { type: 'string', description: nls.localize('debugUX', "Debug UX state. When there are no debug configurations it is 'simple', otherwise 'default'. Used to decide when to show welcome views in the debug viewlet.") });
export const CONTEXT_IN_DEBUG_MODE = new RawContextKey<boolean>('inDebugMode', false, { type: 'boolean', description: nls.localize('inDebugMode', "True when debugging, false otherwise.") });
export const CONTEXT_IN_DEBUG_REPL = new RawContextKey<boolean>('inDebugRepl', false, { type: 'boolean', description: nls.localize('inDebugRepl', "True when focus is in the debug console, false otherwise.") });
export const CONTEXT_BREAKPOINT_WIDGET_VISIBLE = new RawContextKey<boolean>('breakpointWidgetVisible', false, { type: 'boolean', description: nls.localize('breakpointWidgetVisibile', "True when breakpoint editor zone widget is visible, false otherwise.") });
export const CONTEXT_IN_BREAKPOINT_WIDGET = new RawContextKey<boolean>('inBreakpointWidget', false, { type: 'boolean', description: nls.localize('inBreakpointWidget', "True when focus is in the breakpoint editor zone widget, false otherwise.") });
export const CONTEXT_BREAKPOINTS_FOCUSED = new RawContextKey<boolean>('breakpointsFocused', true, { type: 'boolean', description: nls.localize('breakpointsFocused', "True when the BREAKPOINTS view is focused, false otherwise.") });
export const CONTEXT_WATCH_EXPRESSIONS_FOCUSED = new RawContextKey<boolean>('watchExpressionsFocused', true, { type: 'boolean', description: nls.localize('watchExpressionsFocused', "True when the WATCH view is focused, false otherwsie.") });
export const CONTEXT_WATCH_EXPRESSIONS_EXIST = new RawContextKey<boolean>('watchExpressionsExist', false, { type: 'boolean', description: nls.localize('watchExpressionsExist', "True when at least one watch expression exists, false otherwise.") });
export const CONTEXT_VARIABLES_FOCUSED = new RawContextKey<boolean>('variablesFocused', true, { type: 'boolean', description: nls.localize('variablesFocused', "True when the VARIABLES views is focused, false otherwsie") });
export const CONTEXT_EXPRESSION_SELECTED = new RawContextKey<boolean>('expressionSelected', false, { type: 'boolean', description: nls.localize('expressionSelected', "True when an expression input box is open in either the WATCH or the VARIABLES view, false otherwise.") });
export const CONTEXT_BREAKPOINT_INPUT_FOCUSED = new RawContextKey<boolean>('breakpointInputFocused', false, { type: 'boolean', description: nls.localize('breakpointInputFocused', "True when the input box has focus in the BREAKPOINTS view.") });
export const CONTEXT_CALLSTACK_ITEM_TYPE = new RawContextKey<string>('callStackItemType', undefined, { type: 'string', description: nls.localize('callStackItemType', "Represents the item type of the focused element in the CALL STACK view. For example: 'session', 'thread', 'stackFrame'") });
export const CONTEXT_CALLSTACK_SESSION_IS_ATTACH = new RawContextKey<boolean>('callStackSessionIsAttach', false, { type: 'boolean', description: nls.localize('callStackSessionIsAttach', "True when the session in the CALL STACK view is attach, false otherwise. Used internally for inline menus in the CALL STACK view.") });
export const CONTEXT_CALLSTACK_ITEM_STOPPED = new RawContextKey<boolean>('callStackItemStopped', false, { type: 'boolean', description: nls.localize('callStackItemStopped', "True when the focused item in the CALL STACK is stopped. Used internaly for inline menus in the CALL STACK view.") });
export const CONTEXT_CALLSTACK_SESSION_HAS_ONE_THREAD = new RawContextKey<boolean>('callStackSessionHasOneThread', false, { type: 'boolean', description: nls.localize('callStackSessionHasOneThread', "True when the focused session in the CALL STACK view has exactly one thread. Used internally for inline menus in the CALL STACK view.") });
export const CONTEXT_WATCH_ITEM_TYPE = new RawContextKey<string>('watchItemType', undefined, { type: 'string', description: nls.localize('watchItemType', "Represents the item type of the focused element in the WATCH view. For example: 'expression', 'variable'") });
export const CONTEXT_BREAKPOINT_ITEM_TYPE = new RawContextKey<string>('breakpointItemType', undefined, { type: 'string', description: nls.localize('breakpointItemType', "Represents the item type of the focused element in the BREAKPOINTS view. For example: 'breakpoint', 'exceptionBreakppint', 'functionBreakpoint', 'dataBreakpoint'") });
export const CONTEXT_BREAKPOINT_ACCESS_TYPE = new RawContextKey<string>('breakpointAccessType', undefined, { type: 'string', description: nls.localize('breakpointAccessType', "Represents the access type of the focused data breakpoint in the BREAKPOINTS view. For example: 'read', 'readWrite', 'write'") });
export const CONTEXT_BREAKPOINT_SUPPORTS_CONDITION = new RawContextKey<boolean>('breakpointSupportsCondition', false, { type: 'boolean', description: nls.localize('breakpointSupportsCondition', "True when the focused breakpoint supports conditions.") });
export const CONTEXT_LOADED_SCRIPTS_SUPPORTED = new RawContextKey<boolean>('loadedScriptsSupported', false, { type: 'boolean', description: nls.localize('loadedScriptsSupported', "True when the focused sessions supports the LOADED SCRIPTS view") });
export const CONTEXT_LOADED_SCRIPTS_ITEM_TYPE = new RawContextKey<string>('loadedScriptsItemType', undefined, { type: 'string', description: nls.localize('loadedScriptsItemType', "Represents the item type of the focused element in the LOADED SCRIPTS view.") });
export const CONTEXT_FOCUSED_SESSION_IS_ATTACH = new RawContextKey<boolean>('focusedSessionIsAttach', false, { type: 'boolean', description: nls.localize('focusedSessionIsAttach', "True when the focused session is 'attach'.") });
export const CONTEXT_STEP_BACK_SUPPORTED = new RawContextKey<boolean>('stepBackSupported', false, { type: 'boolean', description: nls.localize('stepBackSupported', "True when the focused session supports 'stepBack' requests.") });
export const CONTEXT_RESTART_FRAME_SUPPORTED = new RawContextKey<boolean>('restartFrameSupported', false, { type: 'boolean', description: nls.localize('restartFrameSupported', "True when the focused session supports 'restartFrame' requests.") });
export const CONTEXT_STACK_FRAME_SUPPORTS_RESTART = new RawContextKey<boolean>('stackFrameSupportsRestart', false, { type: 'boolean', description: nls.localize('stackFrameSupportsRestart', "True when the focused stack frame suppots 'restartFrame'.") });
export const CONTEXT_JUMP_TO_CURSOR_SUPPORTED = new RawContextKey<boolean>('jumpToCursorSupported', false, { type: 'boolean', description: nls.localize('jumpToCursorSupported', "True when the focused session supports 'jumpToCursor' request.") });
export const CONTEXT_STEP_INTO_TARGETS_SUPPORTED = new RawContextKey<boolean>('stepIntoTargetsSupported', false, { type: 'boolean', description: nls.localize('stepIntoTargetsSupported', "True when the focused session supports 'stepIntoTargets' request.") });
export const CONTEXT_BREAKPOINTS_EXIST = new RawContextKey<boolean>('breakpointsExist', false, { type: 'boolean', description: nls.localize('breakpointsExist', "True when at least one breakpoint exists.") });
export const CONTEXT_DEBUGGERS_AVAILABLE = new RawContextKey<boolean>('debuggersAvailable', false, { type: 'boolean', description: nls.localize('debuggersAvailable', "True when there is at least one debug extensions active.") });
export const CONTEXT_DEBUG_PROTOCOL_VARIABLE_MENU_CONTEXT = new RawContextKey<string>('debugProtocolVariableMenuContext', undefined, { type: 'string', description: nls.localize('debugProtocolVariableMenuContext', "Represents the context the debug adapter sets on the focused variable in the VARIABLES view.") });
export const CONTEXT_SET_VARIABLE_SUPPORTED = new RawContextKey<boolean>('debugSetVariableSupported', false, { type: 'boolean', description: nls.localize('debugSetVariableSupported', "True when the focused session supports 'setVariable' request.") });
export const CONTEXT_BREAK_WHEN_VALUE_CHANGES_SUPPORTED = new RawContextKey<boolean>('breakWhenValueChangesSupported', false, { type: 'boolean', description: nls.localize('breakWhenValueChangesSupported', "True when the focused session supports to break when value changes.") });
export const CONTEXT_BREAK_WHEN_VALUE_IS_ACCESSED_SUPPORTED = new RawContextKey<boolean>('breakWhenValueIsAccessedSupported', false, { type: 'boolean', description: nls.localize('breakWhenValueIsAccessedSupported', "True when the focused breakpoint supports to break when value is accessed.") });
export const CONTEXT_BREAK_WHEN_VALUE_IS_READ_SUPPORTED = new RawContextKey<boolean>('breakWhenValueIsReadSupported', false, { type: 'boolean', description: nls.localize('breakWhenValueIsReadSupported', "True when the focused breakpoint supports to break when value is read.") });
export const CONTEXT_TERMINATE_DEBUGGEE_SUPPORTED = new RawContextKey<boolean>('terminateDebuggeeSupported', false, { type: 'boolean', description: nls.localize('terminateDebuggeeSupported', "True when the focused session supports the terminate debuggee capability.") });
export const CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT = new RawContextKey<boolean>('variableEvaluateNamePresent', false, { type: 'boolean', description: nls.localize('variableEvaluateNamePresent', "True when the focused variable has an 'evalauteName' field set") });
export const CONTEXT_EXCEPTION_WIDGET_VISIBLE = new RawContextKey<boolean>('exceptionWidgetVisible', false, { type: 'boolean', description: nls.localize('exceptionWidgetVisible', "True when the exception widget is visible.") });
export const CONTEXT_MULTI_SESSION_REPL = new RawContextKey<boolean>('multiSessionRepl', false, { type: 'boolean', description: nls.localize('multiSessionRepl', "True when there is more than 1 debug console.") });
export const CONTEXT_MULTI_SESSION_DEBUG = new RawContextKey<boolean>('multiSessionDebug', false, { type: 'boolean', description: nls.localize('multiSessionDebug', "True when there is more than 1 active debug session.") });

export const EDITOR_CONTRIBUTION_ID = 'editor.contrib.debug';
export const BREAKPOINT_EDITOR_CONTRIBUTION_ID = 'editor.contrib.breakpoint';
export const DEBUG_SCHEME = 'debug';
export const INTERNAL_CONSOLE_OPTIONS_SCHEMA = {
	enum: ['neverOpen', 'openOnSessionStart', 'openOnFirstSessionStart'],
	default: 'openOnFirstSessionStart',
	description: nls.localize('internalConsoleOptions', "Controls when the internal debug console should open.")
};

// raw

export interface IRawModelUpdate {
	sessionId: string;
	threads: DebugProtocol.Thread[];
	stoppedDetails?: IRawStoppedDetails;
}

export interface IRawStoppedDetails {
	reason?: string;
	description?: string;
	threadId?: number;
	text?: string;
	totalFrames?: number;
	allThreadsStopped?: boolean;
	framesErrorMessage?: string;
}

// model

export interface ITreeElement {
	getId(): string;
}

export interface IReplElement extends ITreeElement {
	toString(includeSource?: boolean): string;
	readonly sourceData?: IReplElementSource;
}

export interface IReplElementSource {
	readonly source: Source;
	readonly lineNumber: number;
	readonly column: number;
}

export interface IExpressionContainer extends ITreeElement {
	readonly hasChildren: boolean;
	getChildren(): Promise<IExpression[]>;
	readonly reference?: number;
	readonly value: string;
	readonly type?: string;
	valueChanged?: boolean;
}

export interface IExpression extends IExpressionContainer {
	name: string;
}

export interface IDebugger {
	createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter>;
	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
	getCustomTelemetryEndpoint(): ITelemetryEndpoint | undefined;
}

export const enum State {
	Inactive,
	Initializing,
	Stopped,
	Running
}

export function getStateLabel(state: State): string {
	switch (state) {
		case State.Initializing: return 'initializing';
		case State.Stopped: return 'stopped';
		case State.Running: return 'running';
		default: return 'inactive';
	}
}

export interface AdapterEndEvent {
	error?: Error;
	sessionLengthInSeconds: number;
	emittedStopped: boolean;
}

export interface LoadedSourceEvent {
	reason: 'new' | 'changed' | 'removed';
	source: Source;
}

export type IDebugSessionReplMode = 'separate' | 'mergeWithParent';

export interface IDebugSessionOptions {
	noDebug?: boolean;
	parentSession?: IDebugSession;
	repl?: IDebugSessionReplMode;
	compoundRoot?: DebugCompoundRoot;
	compact?: boolean;
}

export interface IDataBreakpointInfoResponse {
	dataId: string | null;
	description: string;
	canPersist?: boolean,
	accessTypes?: DebugProtocol.DataBreakpointAccessType[];
}

export interface IDebugSession extends ITreeElement {

	readonly configuration: IConfig;
	readonly unresolvedConfiguration: IConfig | undefined;
	readonly state: State;
	readonly root: IWorkspaceFolder | undefined;
	readonly parentSession: IDebugSession | undefined;
	readonly subId: string | undefined;
	readonly compact: boolean;
	readonly compoundRoot: DebugCompoundRoot | undefined;
	readonly name: string;

	setSubId(subId: string | undefined): void;

	setName(name: string): void;
	readonly onDidChangeName: Event<string>;
	getLabel(): string;

	getSourceForUri(modelUri: uri): Source | undefined;
	getSource(raw?: DebugProtocol.Source): Source;

	setConfiguration(configuration: { resolved: IConfig, unresolved: IConfig | undefined }): void;
	rawUpdate(data: IRawModelUpdate): void;

	getThread(threadId: number): IThread | undefined;
	getAllThreads(): IThread[];
	clearThreads(removeThreads: boolean, reference?: number): void;

	getReplElements(): IReplElement[];
	hasSeparateRepl(): boolean;
	removeReplExpressions(): void;
	addReplExpression(stackFrame: IStackFrame | undefined, name: string): Promise<void>;
	appendToRepl(data: string | IExpression, severity: severity, source?: IReplElementSource): void;
	logToRepl(sev: severity, args: any[], frame?: { uri: uri, line: number, column: number }): void;

	// session events
	readonly onDidEndAdapter: Event<AdapterEndEvent | undefined>;
	readonly onDidChangeState: Event<void>;
	readonly onDidChangeReplElements: Event<void>;

	// DA capabilities
	readonly capabilities: DebugProtocol.Capabilities;

	// DAP events

	readonly onDidLoadedSource: Event<LoadedSourceEvent>;
	readonly onDidCustomEvent: Event<DebugProtocol.Event>;
	readonly onDidProgressStart: Event<DebugProtocol.ProgressStartEvent>;
	readonly onDidProgressUpdate: Event<DebugProtocol.ProgressUpdateEvent>;
	readonly onDidProgressEnd: Event<DebugProtocol.ProgressEndEvent>;

	// DAP request

	initialize(dbgr: IDebugger): Promise<void>;
	launchOrAttach(config: IConfig): Promise<void>;
	restart(): Promise<void>;
	terminate(restart?: boolean /* false */): Promise<void>;
	disconnect(restart?: boolean /* false */): Promise<void>;

	sendBreakpoints(modelUri: uri, bpts: IBreakpoint[], sourceModified: boolean): Promise<void>;
	sendFunctionBreakpoints(fbps: IFunctionBreakpoint[]): Promise<void>;
	dataBreakpointInfo(name: string, variablesReference?: number): Promise<IDataBreakpointInfoResponse | undefined>;
	sendDataBreakpoints(dbps: IDataBreakpoint[]): Promise<void>;
	sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void>;
	breakpointsLocations(uri: uri, lineNumber: number): Promise<IPosition[]>;
	getDebugProtocolBreakpoint(breakpointId: string): DebugProtocol.Breakpoint | undefined;

	stackTrace(threadId: number, startFrame: number, levels: number, token: CancellationToken): Promise<DebugProtocol.StackTraceResponse | undefined>;
	exceptionInfo(threadId: number): Promise<IExceptionInfo | undefined>;
	scopes(frameId: number, threadId: number): Promise<DebugProtocol.ScopesResponse | undefined>;
	variables(variablesReference: number, threadId: number | undefined, filter: 'indexed' | 'named' | undefined, start: number | undefined, count: number | undefined): Promise<DebugProtocol.VariablesResponse | undefined>;
	evaluate(expression: string, frameId?: number, context?: string): Promise<DebugProtocol.EvaluateResponse | undefined>;
	customRequest(request: string, args: any): Promise<DebugProtocol.Response | undefined>;
	cancel(progressId: string): Promise<DebugProtocol.CancelResponse | undefined>;

	restartFrame(frameId: number, threadId: number): Promise<void>;
	next(threadId: number): Promise<void>;
	stepIn(threadId: number, targetId?: number): Promise<void>;
	stepInTargets(frameId: number): Promise<{ id: number, label: string }[] | undefined>;
	stepOut(threadId: number): Promise<void>;
	stepBack(threadId: number): Promise<void>;
	continue(threadId: number): Promise<void>;
	reverseContinue(threadId: number): Promise<void>;
	pause(threadId: number): Promise<void>;
	terminateThreads(threadIds: number[]): Promise<void>;

	completions(frameId: number | undefined, threadId: number, text: string, position: Position, overwriteBefore: number, token: CancellationToken): Promise<DebugProtocol.CompletionsResponse | undefined>;
	setVariable(variablesReference: number | undefined, name: string, value: string): Promise<DebugProtocol.SetVariableResponse | undefined>;
	loadSource(resource: uri): Promise<DebugProtocol.SourceResponse | undefined>;
	getLoadedSources(): Promise<Source[]>;

	gotoTargets(source: DebugProtocol.Source, line: number, column?: number): Promise<DebugProtocol.GotoTargetsResponse | undefined>;
	goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse | undefined>;
}

export interface IThread extends ITreeElement {

	/**
	 * Process the thread belongs to
	 */
	readonly session: IDebugSession;

	/**
	 * Id of the thread generated by the debug adapter backend.
	 */
	readonly threadId: number;

	/**
	 * Name of the thread.
	 */
	readonly name: string;

	/**
	 * Information about the current thread stop event. Undefined if thread is not stopped.
	 */
	readonly stoppedDetails: IRawStoppedDetails | undefined;

	/**
	 * Information about the exception if an 'exception' stopped event raised and DA supports the 'exceptionInfo' request, otherwise undefined.
	 */
	readonly exceptionInfo: Promise<IExceptionInfo | undefined>;

	readonly stateLabel: string;

	/**
	 * Gets the callstack if it has already been received from the debug
	 * adapter.
	 */
	getCallStack(): ReadonlyArray<IStackFrame>;


	/**
	 * Gets the top stack frame that is not hidden if the callstack has already been received from the debug adapter
	 */
	getTopStackFrame(): IStackFrame | undefined;

	/**
	 * Invalidates the callstack cache
	 */
	clearCallStack(): void;

	/**
	 * Indicates whether this thread is stopped. The callstack for stopped
	 * threads can be retrieved from the debug adapter.
	 */
	readonly stopped: boolean;

	next(): Promise<any>;
	stepIn(): Promise<any>;
	stepOut(): Promise<any>;
	stepBack(): Promise<any>;
	continue(): Promise<any>;
	pause(): Promise<any>;
	terminate(): Promise<any>;
	reverseContinue(): Promise<any>;
}

export interface IScope extends IExpressionContainer {
	readonly name: string;
	readonly expensive: boolean;
	readonly range?: IRange;
	readonly hasChildren: boolean;
}

export interface IStackFrame extends ITreeElement {
	readonly thread: IThread;
	readonly name: string;
	readonly presentationHint: string | undefined;
	readonly frameId: number;
	readonly range: IRange;
	readonly source: Source;
	readonly canRestart: boolean;
	getScopes(): Promise<IScope[]>;
	getMostSpecificScopes(range: IRange): Promise<ReadonlyArray<IScope>>;
	forgetScopes(): void;
	restart(): Promise<any>;
	toString(): string;
	openInEditor(editorService: IEditorService, preserveFocus?: boolean, sideBySide?: boolean): Promise<ITextEditorPane | undefined>;
	equals(other: IStackFrame): boolean;
}

export interface IEnablement extends ITreeElement {
	readonly enabled: boolean;
}

export interface IBreakpointData {
	readonly id?: string;
	readonly lineNumber: number;
	readonly column?: number;
	readonly enabled?: boolean;
	readonly condition?: string;
	readonly logMessage?: string;
	readonly hitCondition?: string;
}

export interface IBreakpointUpdateData {
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	readonly lineNumber?: number;
	readonly column?: number;
}

export interface IBaseBreakpoint extends IEnablement {
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;
	readonly verified: boolean;
	readonly supported: boolean;
	readonly message?: string;
	readonly sessionsThatVerified: string[];
	getIdFromAdapter(sessionId: string): number | undefined;
}

export interface IBreakpoint extends IBaseBreakpoint {
	readonly uri: uri;
	readonly lineNumber: number;
	readonly endLineNumber?: number;
	readonly column?: number;
	readonly endColumn?: number;
	readonly adapterData: any;
	readonly sessionAgnosticData: { lineNumber: number, column: number | undefined };
}

export interface IFunctionBreakpoint extends IBaseBreakpoint {
	readonly name: string;
}

export interface IExceptionBreakpoint extends IBaseBreakpoint {
	readonly filter: string;
	readonly label: string;
	readonly description: string | undefined;
}

export interface IDataBreakpoint extends IBaseBreakpoint {
	readonly description: string;
	readonly dataId: string;
	readonly canPersist: boolean;
	readonly accessType: DebugProtocol.DataBreakpointAccessType;
}

export interface IExceptionInfo {
	readonly id?: string;
	readonly description?: string;
	readonly breakMode: string | null;
	readonly details?: DebugProtocol.ExceptionDetails;
}

// model interfaces

export interface IViewModel extends ITreeElement {
	/**
	 * Returns the focused debug session or undefined if no session is stopped.
	 */
	readonly focusedSession: IDebugSession | undefined;

	/**
	 * Returns the focused thread or undefined if no thread is stopped.
	 */
	readonly focusedThread: IThread | undefined;

	/**
	 * Returns the focused stack frame or undefined if there are no stack frames.
	 */
	readonly focusedStackFrame: IStackFrame | undefined;

	getSelectedExpression(): IExpression | undefined;
	setSelectedExpression(expression: IExpression | undefined): void;
	updateViews(): void;

	isMultiSessionView(): boolean;

	onDidFocusSession: Event<IDebugSession | undefined>;
	onDidFocusStackFrame: Event<{ stackFrame: IStackFrame | undefined, explicit: boolean }>;
	onDidSelectExpression: Event<IExpression | undefined>;
	onWillUpdateViews: Event<void>;
}

export interface IEvaluate {
	evaluate(session: IDebugSession, stackFrame: IStackFrame, context: string): Promise<void>;
}

export interface IDebugModel extends ITreeElement {
	getSession(sessionId: string | undefined, includeInactive?: boolean): IDebugSession | undefined;
	getSessions(includeInactive?: boolean): IDebugSession[];
	getBreakpoints(filter?: { uri?: uri, lineNumber?: number, column?: number, enabledOnly?: boolean }): ReadonlyArray<IBreakpoint>;
	areBreakpointsActivated(): boolean;
	getFunctionBreakpoints(): ReadonlyArray<IFunctionBreakpoint>;
	getDataBreakpoints(): ReadonlyArray<IDataBreakpoint>;
	getExceptionBreakpoints(): ReadonlyArray<IExceptionBreakpoint>;
	getWatchExpressions(): ReadonlyArray<IExpression & IEvaluate>;

	onDidChangeBreakpoints: Event<IBreakpointsChangeEvent | undefined>;
	onDidChangeCallStack: Event<void>;
	onDidChangeWatchExpressions: Event<IExpression | undefined>;
}

/**
 * An event describing a change to the set of [breakpoints](#debug.Breakpoint).
 */
export interface IBreakpointsChangeEvent {
	added?: Array<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint>;
	removed?: Array<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint>;
	changed?: Array<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint>;
	sessionOnly: boolean;
}

// Debug configuration interfaces

export interface IDebugConfiguration {
	allowBreakpointsEverywhere: boolean;
	openDebug: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart' | 'openOnDebugBreak';
	openExplorerOnEnd: boolean;
	inlineValues: boolean | 'auto';
	toolBarLocation: 'floating' | 'docked' | 'hidden';
	showInStatusBar: 'never' | 'always' | 'onFirstSessionStart';
	internalConsoleOptions: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart';
	extensionHostDebugAdapter: boolean;
	enableAllHovers: boolean;
	showSubSessionsInToolBar: boolean;
	console: {
		fontSize: number;
		fontFamily: string;
		lineHeight: number;
		wordWrap: boolean;
		closeOnEnd: boolean;
		collapseIdenticalLines: boolean;
		historySuggestions: boolean;
	};
	focusWindowOnBreak: boolean;
	onTaskErrors: 'debugAnyway' | 'showErrors' | 'prompt' | 'abort';
	showBreakpointsInOverviewRuler: boolean;
	showInlineBreakpointCandidates: boolean;
}

export interface IGlobalConfig {
	version: string;
	compounds: ICompound[];
	configurations: IConfig[];
}

export interface IEnvConfig {
	internalConsoleOptions?: 'neverOpen' | 'openOnSessionStart' | 'openOnFirstSessionStart';
	preRestartTask?: string | TaskIdentifier;
	postRestartTask?: string | TaskIdentifier;
	preLaunchTask?: string | TaskIdentifier;
	postDebugTask?: string | TaskIdentifier;
	debugServer?: number;
	noDebug?: boolean;
}

export interface IConfigPresentation {
	hidden?: boolean;
	group?: string;
	order?: number;
}

export interface IConfig extends IEnvConfig {

	// fundamental attributes
	type: string;
	request: string;
	name: string;
	presentation?: IConfigPresentation;
	// platform specifics
	windows?: IEnvConfig;
	osx?: IEnvConfig;
	linux?: IEnvConfig;

	// internals
	__configurationTarget?: ConfigurationTarget;
	__sessionId?: string;
	__restart?: any;
	__autoAttach?: boolean;
	port?: number; // TODO
}

export interface ICompound {
	name: string;
	stopAll?: boolean;
	preLaunchTask?: string | TaskIdentifier;
	configurations: (string | { name: string, folder: string })[];
	presentation?: IConfigPresentation;
}

export interface IDebugAdapter extends IDisposable {
	readonly onError: Event<Error>;
	readonly onExit: Event<number | null>;
	onRequest(callback: (request: DebugProtocol.Request) => void): void;
	onEvent(callback: (event: DebugProtocol.Event) => void): void;
	startSession(): Promise<void>;
	sendMessage(message: DebugProtocol.ProtocolMessage): void;
	sendResponse(response: DebugProtocol.Response): void;
	sendRequest(command: string, args: any, clb: (result: DebugProtocol.Response) => void, timeout?: number): number;
	stopSession(): Promise<void>;
}

export interface IDebugAdapterFactory extends ITerminalLauncher {
	createDebugAdapter(session: IDebugSession): IDebugAdapter;
	substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
}

export interface IDebugAdapterExecutableOptions {
	cwd?: string;
	env?: { [key: string]: string };
}

export interface IDebugAdapterExecutable {
	readonly type: 'executable';
	readonly command: string;
	readonly args: string[];
	readonly options?: IDebugAdapterExecutableOptions;
}

export interface IDebugAdapterServer {
	readonly type: 'server';
	readonly port: number;
	readonly host?: string;
}

export interface IDebugAdapterNamedPipeServer {
	readonly type: 'pipeServer';
	readonly path: string;
}

export interface IDebugAdapterInlineImpl extends IDisposable {
	readonly onDidSendMessage: Event<DebugProtocol.Message>;
	handleMessage(message: DebugProtocol.Message): void;
}

export interface IDebugAdapterImpl {
	readonly type: 'implementation';
	readonly implementation: IDebugAdapterInlineImpl;
}

export type IAdapterDescriptor = IDebugAdapterExecutable | IDebugAdapterServer | IDebugAdapterNamedPipeServer | IDebugAdapterImpl;

export interface IPlatformSpecificAdapterContribution {
	program?: string;
	args?: string[];
	runtime?: string;
	runtimeArgs?: string[];
}

export interface IDebuggerContribution extends IPlatformSpecificAdapterContribution {
	type: string;
	label?: string;
	win?: IPlatformSpecificAdapterContribution;
	winx86?: IPlatformSpecificAdapterContribution;
	windows?: IPlatformSpecificAdapterContribution;
	osx?: IPlatformSpecificAdapterContribution;
	linux?: IPlatformSpecificAdapterContribution;

	// internal
	aiKey?: string;

	// supported languages
	languages?: string[];

	// debug configuration support
	configurationAttributes?: any;
	initialConfigurations?: any[];
	configurationSnippets?: IJSONSchemaSnippet[];
	variables?: { [key: string]: string };
}

export interface IDebugConfigurationProvider {
	readonly type: string;
	readonly triggerKind: DebugConfigurationProviderTriggerKind;
	resolveDebugConfiguration?(folderUri: uri | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	resolveDebugConfigurationWithSubstitutedVariables?(folderUri: uri | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	provideDebugConfigurations?(folderUri: uri | undefined, token: CancellationToken): Promise<IConfig[]>;
}

export interface IDebugAdapterDescriptorFactory {
	readonly type: string;
	createDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor>;
}

export interface IDebugAdapterTrackerFactory {
	readonly type: string;
}

export interface ITerminalLauncher {
	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
}

export interface IConfigurationManager {

	/**
	 * Returns an object containing the selected launch configuration and the selected configuration name. Both these fields can be null (no folder workspace).
	 */
	readonly selectedConfiguration: {
		launch: ILaunch | undefined;
		// Potentially activates extensions
		getConfig: () => Promise<IConfig | undefined>;
		name: string | undefined;
		// Type is used when matching dynamic configurations to their corresponding provider
		type: string | undefined;
	};

	selectConfiguration(launch: ILaunch | undefined, name?: string, config?: IConfig, dynamicConfigOptions?: { type?: string }): Promise<void>;

	getLaunches(): ReadonlyArray<ILaunch>;
	getLaunch(workspaceUri: uri | undefined): ILaunch | undefined;
	getAllConfigurations(): { launch: ILaunch, name: string, presentation?: IConfigPresentation }[];
	getRecentDynamicConfigurations(): { name: string, type: string }[];

	/**
	 * Allows to register on change of selected debug configuration.
	 */
	onDidSelectConfiguration: Event<void>;

	hasDebugConfigurationProvider(debugType: string): boolean;
	getDynamicProviders(): Promise<{ label: string, type: string, pick: () => Promise<{ launch: ILaunch, config: IConfig } | undefined> }[]>;

	registerDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): IDisposable;
	unregisterDebugConfigurationProvider(debugConfigurationProvider: IDebugConfigurationProvider): void;

	resolveConfigurationByProviders(folderUri: uri | undefined, type: string | undefined, debugConfiguration: any, token: CancellationToken): Promise<any>;
}

export interface IAdapterManager {

	onDidRegisterDebugger: Event<void>;

	hasDebuggers(): boolean;
	getDebugAdapterDescriptor(session: IDebugSession): Promise<IAdapterDescriptor | undefined>;
	getDebuggerLabel(type: string): string | undefined;
	isDebuggerInterestedInLanguage(language: string): boolean;

	activateDebuggers(activationEvent: string, debugType?: string): Promise<void>;
	registerDebugAdapterFactory(debugTypes: string[], debugAdapterFactory: IDebugAdapterFactory): IDisposable;
	createDebugAdapter(session: IDebugSession): IDebugAdapter | undefined;
	registerDebugAdapterDescriptorFactory(debugAdapterDescriptorFactory: IDebugAdapterDescriptorFactory): IDisposable;
	unregisterDebugAdapterDescriptorFactory(debugAdapterDescriptorFactory: IDebugAdapterDescriptorFactory): void;

	substituteVariables(debugType: string, folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig>;
	runInTerminal(debugType: string, args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined>;
}

export interface ILaunch {

	/**
	 * Resource pointing to the launch.json this object is wrapping.
	 */
	readonly uri: uri;

	/**
	 * Name of the launch.
	 */
	readonly name: string;

	/**
	 * Workspace of the launch. Can be undefined.
	 */
	readonly workspace: IWorkspaceFolder | undefined;

	/**
	 * Should this launch be shown in the debug dropdown.
	 */
	readonly hidden: boolean;

	/**
	 * Returns a configuration with the specified name.
	 * Returns undefined if there is no configuration with the specified name.
	 */
	getConfiguration(name: string): IConfig | undefined;

	/**
	 * Returns a compound with the specified name.
	 * Returns undefined if there is no compound with the specified name.
	 */
	getCompound(name: string): ICompound | undefined;

	/**
	 * Returns the names of all configurations and compounds.
	 * Ignores configurations which are invalid.
	 */
	getConfigurationNames(ignoreCompoundsAndPresentation?: boolean): string[];

	/**
	 * Opens the launch.json file. Creates if it does not exist.
	 */
	openConfigFile(preserveFocus: boolean, type?: string, token?: CancellationToken): Promise<{ editor: IEditorPane | null, created: boolean }>;
}

// Debug service interfaces

export const IDebugService = createDecorator<IDebugService>(DEBUG_SERVICE_ID);

export interface IDebugService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the current debug state.
	 */
	readonly state: State;

	/**
	 * Allows to register on debug state changes.
	 */
	onDidChangeState: Event<State>;

	/**
	 * Allows to register on new session events.
	 */
	onDidNewSession: Event<IDebugSession>;

	/**
	 * Allows to register on sessions about to be created (not yet fully initialised)
	 */
	onWillNewSession: Event<IDebugSession>;

	/**
	 * Allows to register on end session events.
	 */
	onDidEndSession: Event<IDebugSession>;

	/**
	 * Gets the configuration manager.
	 */
	getConfigurationManager(): IConfigurationManager;

	/**
	 * Gets the adapter manager.
	 */
	getAdapterManager(): IAdapterManager;

	/**
	 * Sets the focused stack frame and evaluates all expressions against the newly focused stack frame,
	 */
	focusStackFrame(focusedStackFrame: IStackFrame | undefined, thread?: IThread, session?: IDebugSession, explicit?: boolean): Promise<void>;

	/**
	 * Returns true if breakpoints can be set for a given editor model. Depends on mode.
	 */
	canSetBreakpointsIn(model: EditorIModel): boolean;

	/**
	 * Adds new breakpoints to the model for the file specified with the uri. Notifies debug adapter of breakpoint changes.
	 */
	addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[], ariaAnnounce?: boolean): Promise<IBreakpoint[]>;

	/**
	 * Updates the breakpoints.
	 */
	updateBreakpoints(uri: uri, data: Map<string, IBreakpointUpdateData>, sendOnResourceSaved: boolean): Promise<void>;

	/**
	 * Enables or disables all breakpoints. If breakpoint is passed only enables or disables the passed breakpoint.
	 * Notifies debug adapter of breakpoint changes.
	 */
	enableOrDisableBreakpoints(enable: boolean, breakpoint?: IEnablement): Promise<void>;

	/**
	 * Sets the global activated property for all breakpoints.
	 * Notifies debug adapter of breakpoint changes.
	 */
	setBreakpointsActivated(activated: boolean): Promise<void>;

	/**
	 * Removes all breakpoints. If id is passed only removes the breakpoint associated with that id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeBreakpoints(id?: string): Promise<any>;

	/**
	 * Adds a new function breakpoint for the given name.
	 */
	addFunctionBreakpoint(name?: string, id?: string): void;

	/**
	 * Updates an already existing function breakpoint.
	 * Notifies debug adapter of breakpoint changes.
	 */
	updateFunctionBreakpoint(id: string, update: { name?: string, hitCondition?: string, condition?: string }): Promise<void>;

	/**
	 * Removes all function breakpoints. If id is passed only removes the function breakpoint with the passed id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeFunctionBreakpoints(id?: string): Promise<void>;

	/**
	 * Adds a new data breakpoint.
	 */
	addDataBreakpoint(label: string, dataId: string, canPersist: boolean, accessTypes: DebugProtocol.DataBreakpointAccessType[] | undefined, accessType: DebugProtocol.DataBreakpointAccessType): Promise<void>;

	/**
	 * Removes all data breakpoints. If id is passed only removes the data breakpoint with the passed id.
	 * Notifies debug adapter of breakpoint changes.
	 */
	removeDataBreakpoints(id?: string): Promise<void>;

	setExceptionBreakpointCondition(breakpoint: IExceptionBreakpoint, condition: string | undefined): Promise<void>;

	setExceptionBreakpoints(data: DebugProtocol.ExceptionBreakpointsFilter[]): void;

	/**
	 * Sends all breakpoints to the passed session.
	 * If session is not passed, sends all breakpoints to each session.
	 */
	sendAllBreakpoints(session?: IDebugSession): Promise<any>;

	/**
	 * Adds a new watch expression and evaluates it against the debug adapter.
	 */
	addWatchExpression(name?: string): void;

	/**
	 * Renames a watch expression and evaluates it against the debug adapter.
	 */
	renameWatchExpression(id: string, newName: string): void;

	/**
	 * Moves a watch expression to a new possition. Used for reordering watch expressions.
	 */
	moveWatchExpression(id: string, position: number): void;

	/**
	 * Removes all watch expressions. If id is passed only removes the watch expression with the passed id.
	 */
	removeWatchExpressions(id?: string): void;

	/**
	 * Starts debugging. If the configOrName is not passed uses the selected configuration in the debug dropdown.
	 * Also saves all files, manages if compounds are present in the configuration
	 * and resolveds configurations via DebugConfigurationProviders.
	 *
	 * Returns true if the start debugging was successfull. For compound launches, all configurations have to start successfuly for it to return success.
	 * On errors the startDebugging will throw an error, however some error and cancelations are handled and in that case will simply return false.
	 */
	startDebugging(launch: ILaunch | undefined, configOrName?: IConfig | string, options?: IDebugSessionOptions): Promise<boolean>;

	/**
	 * Restarts a session or creates a new one if there is no active session.
	 */
	restartSession(session: IDebugSession, restartData?: any): Promise<any>;

	/**
	 * Stops the session. If no session is specified then all sessions are stopped.
	 */
	stopSession(session: IDebugSession | undefined, disconnect?: boolean): Promise<any>;

	/**
	 * Makes unavailable all sources with the passed uri. Source will appear as grayed out in callstack view.
	 */
	sourceIsNotAvailable(uri: uri): void;

	/**
	 * Gets the current debug model.
	 */
	getModel(): IDebugModel;

	/**
	 * Gets the current view model.
	 */
	getViewModel(): IViewModel;
}

// Editor interfaces
export const enum BreakpointWidgetContext {
	CONDITION = 0,
	HIT_COUNT = 1,
	LOG_MESSAGE = 2
}

export interface IDebugEditorContribution extends editorCommon.IEditorContribution {
	showHover(range: Range, focus: boolean): Promise<void>;
	addLaunchConfiguration(): Promise<any>;
	closeExceptionWidget(): void;
}

export interface IBreakpointEditorContribution extends editorCommon.IEditorContribution {
	showBreakpointWidget(lineNumber: number, column: number | undefined, context?: BreakpointWidgetContext): void;
	closeBreakpointWidget(): void;
	getContextMenuActionsAtPosition(lineNumber: number, model: EditorIModel): IAction[];
}
