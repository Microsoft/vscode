/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI as uri } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { Position, IPosition } from 'vs/editor/common/core/position';
import { ILaunch, IDebugService, State, IDebugSession, IConfigurationManager, IStackFrame, IBreakpointData, IBreakpointUpdateData, IConfig, IDebugModel, IViewModel, IBreakpoint, LoadedSourceEvent, IThread, IRawModelUpdate, IFunctionBreakpoint, IExceptionBreakpoint, IDebugger, IExceptionInfo, AdapterEndEvent, IReplElement, IExpression, IReplElementSource, IDataBreakpoint, IDebugSessionOptions, IEvaluate, IAdapterManager } from 'vs/workbench/contrib/debug/common/debug';
import { Source } from 'vs/workbench/contrib/debug/common/debugSource';
import Severity from 'vs/base/common/severity';
import { AbstractDebugAdapter } from 'vs/workbench/contrib/debug/common/abstractDebugAdapter';
import { DebugStorage } from 'vs/workbench/contrib/debug/common/debugStorage';
import { ExceptionBreakpoint, Expression, DataBreakpoint, FunctionBreakpoint, Breakpoint, DebugModel } from 'vs/workbench/contrib/debug/common/debugModel';
import { DebugCompoundRoot } from 'vs/workbench/contrib/debug/common/debugCompoundRoot';
import { CancellationToken } from 'vs/base/common/cancellation';
import { TestFileService } from 'vs/workbench/test/browser/workbenchTestServices';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { ITextModel } from 'vs/editor/common/model';

const fileService = new TestFileService();
export const mockUriIdentityService = new UriIdentityService(fileService);

export class MockDebugService implements IDebugService {

	_serviceBrand: undefined;

	get state(): State {
		throw new Error('not implemented');
	}

	get onWillNewSession(): Event<IDebugSession> {
		throw new Error('not implemented');
	}

	get onDidNewSession(): Event<IDebugSession> {
		throw new Error('not implemented');
	}

	get onDidEndSession(): Event<IDebugSession> {
		throw new Error('not implemented');
	}

	get onDidChangeState(): Event<State> {
		throw new Error('not implemented');
	}

	getConfigurationManager(): IConfigurationManager {
		throw new Error('not implemented');
	}

	getAdapterManager(): IAdapterManager {
		throw new Error('Method not implemented.');
	}

	canSetBreakpointsIn(model: ITextModel): boolean {
		throw new Error('Method not implemented.');
	}

	focusStackFrame(focusedStackFrame: IStackFrame): Promise<void> {
		throw new Error('not implemented');
	}

	sendAllBreakpoints(session?: IDebugSession): Promise<any> {
		throw new Error('not implemented');
	}

	addBreakpoints(uri: uri, rawBreakpoints: IBreakpointData[]): Promise<IBreakpoint[]> {
		throw new Error('not implemented');
	}

	updateBreakpoints(uri: uri, data: Map<string, IBreakpointUpdateData>, sendOnResourceSaved: boolean): Promise<void> {
		throw new Error('not implemented');
	}

	enableOrDisableBreakpoints(enabled: boolean): Promise<void> {
		throw new Error('not implemented');
	}

	setBreakpointsActivated(): Promise<void> {
		throw new Error('not implemented');
	}

	removeBreakpoints(): Promise<any> {
		throw new Error('not implemented');
	}

	setExceptionBreakpointCondition(breakpoint: IExceptionBreakpoint, condition: string): Promise<void> {
		throw new Error('Method not implemented.');
	}

	setExceptionBreakpoints(data: DebugProtocol.ExceptionBreakpointsFilter[]): void {
		throw new Error('Method not implemented.');
	}

	addFunctionBreakpoint(): void { }

	moveWatchExpression(id: string, position: number): void { }

	updateFunctionBreakpoint(id: string, update: { name?: string, hitCondition?: string, condition?: string }): Promise<void> {
		throw new Error('not implemented');
	}

	removeFunctionBreakpoints(id?: string): Promise<void> {
		throw new Error('not implemented');
	}

	addDataBreakpoint(label: string, dataId: string, canPersist: boolean): Promise<void> {
		throw new Error('Method not implemented.');
	}
	removeDataBreakpoints(id?: string | undefined): Promise<void> {
		throw new Error('Method not implemented.');
	}

	addReplExpression(name: string): Promise<void> {
		throw new Error('not implemented');
	}

	removeReplExpressions(): void { }

	addWatchExpression(name?: string): Promise<void> {
		throw new Error('not implemented');
	}

	renameWatchExpression(id: string, newName: string): Promise<void> {
		throw new Error('not implemented');
	}

	removeWatchExpressions(id?: string): void { }

	startDebugging(launch: ILaunch, configOrName?: IConfig | string, options?: IDebugSessionOptions): Promise<boolean> {
		return Promise.resolve(true);
	}

	restartSession(): Promise<any> {
		throw new Error('not implemented');
	}

	stopSession(): Promise<any> {
		throw new Error('not implemented');
	}

	getModel(): IDebugModel {
		throw new Error('not implemented');
	}

	getViewModel(): IViewModel {
		throw new Error('not implemented');
	}

	logToRepl(session: IDebugSession, value: string): void { }

	sourceIsNotAvailable(uri: uri): void { }

	tryToAutoFocusStackFrame(thread: IThread): Promise<any> {
		throw new Error('not implemented');
	}
}

export class MockSession implements IDebugSession {
	get compoundRoot(): DebugCompoundRoot | undefined {
		return undefined;
	}

	stepInTargets(frameId: number): Promise<{ id: number; label: string; }[]> {
		throw new Error('Method not implemented.');
	}

	cancel(_progressId: string): Promise<DebugProtocol.CancelResponse> {
		throw new Error('Method not implemented.');
	}

	breakpointsLocations(uri: uri, lineNumber: number): Promise<IPosition[]> {
		throw new Error('Method not implemented.');
	}

	dataBreakpointInfo(name: string, variablesReference?: number | undefined): Promise<{ dataId: string | null; description: string; canPersist?: boolean | undefined; } | undefined> {
		throw new Error('Method not implemented.');
	}

	sendDataBreakpoints(dbps: IDataBreakpoint[]): Promise<void> {
		throw new Error('Method not implemented.');
	}

	subId: string | undefined;

	get compact(): boolean {
		return false;
	}

	setSubId(subId: string | undefined): void {
		throw new Error('Method not implemented.');
	}

	get parentSession(): IDebugSession | undefined {
		return undefined;
	}

	getReplElements(): IReplElement[] {
		return [];
	}

	hasSeparateRepl(): boolean {
		return true;
	}

	removeReplExpressions(): void { }
	get onDidChangeReplElements(): Event<void> {
		throw new Error('not implemented');
	}

	addReplExpression(stackFrame: IStackFrame, name: string): Promise<void> {
		return Promise.resolve(undefined);
	}

	appendToRepl(data: string | IExpression, severity: Severity, source?: IReplElementSource): void { }
	logToRepl(sev: Severity, args: any[], frame?: { uri: uri; line: number; column: number; }) { }

	configuration: IConfig = { type: 'mock', name: 'mock', request: 'launch' };
	unresolvedConfiguration: IConfig = { type: 'mock', name: 'mock', request: 'launch' };
	state = State.Stopped;
	root!: IWorkspaceFolder;
	capabilities: DebugProtocol.Capabilities = {};

	getId(): string {
		return 'mock';
	}

	getLabel(): string {
		return 'mockname';
	}

	get name(): string {
		return 'mockname';
	}

	setName(name: string): void {
		throw new Error('not implemented');
	}

	getSourceForUri(modelUri: uri): Source {
		throw new Error('not implemented');
	}

	getThread(threadId: number): IThread {
		throw new Error('not implemented');
	}

	get onDidCustomEvent(): Event<DebugProtocol.Event> {
		throw new Error('not implemented');
	}

	get onDidLoadedSource(): Event<LoadedSourceEvent> {
		throw new Error('not implemented');
	}

	get onDidChangeState(): Event<void> {
		throw new Error('not implemented');
	}

	get onDidEndAdapter(): Event<AdapterEndEvent | undefined> {
		throw new Error('not implemented');
	}

	get onDidChangeName(): Event<string> {
		throw new Error('not implemented');
	}

	get onDidProgressStart(): Event<DebugProtocol.ProgressStartEvent> {
		throw new Error('not implemented');
	}

	get onDidProgressUpdate(): Event<DebugProtocol.ProgressUpdateEvent> {
		throw new Error('not implemented');
	}

	get onDidProgressEnd(): Event<DebugProtocol.ProgressEndEvent> {
		throw new Error('not implemented');
	}

	setConfiguration(configuration: { resolved: IConfig, unresolved: IConfig }) { }

	getAllThreads(): IThread[] {
		return [];
	}

	getSource(raw: DebugProtocol.Source): Source {
		throw new Error('not implemented');
	}

	getLoadedSources(): Promise<Source[]> {
		return Promise.resolve([]);
	}

	completions(frameId: number, threadId: number, text: string, position: Position, overwriteBefore: number): Promise<DebugProtocol.CompletionsResponse> {
		throw new Error('not implemented');
	}

	clearThreads(removeThreads: boolean, reference?: number): void { }

	rawUpdate(data: IRawModelUpdate): void { }

	initialize(dbgr: IDebugger): Promise<void> {
		throw new Error('Method not implemented.');
	}
	launchOrAttach(config: IConfig): Promise<void> {
		throw new Error('Method not implemented.');
	}
	restart(): Promise<void> {
		throw new Error('Method not implemented.');
	}
	sendBreakpoints(modelUri: uri, bpts: IBreakpoint[], sourceModified: boolean): Promise<void> {
		throw new Error('Method not implemented.');
	}
	sendFunctionBreakpoints(fbps: IFunctionBreakpoint[]): Promise<void> {
		throw new Error('Method not implemented.');
	}
	sendExceptionBreakpoints(exbpts: IExceptionBreakpoint[]): Promise<void> {
		throw new Error('Method not implemented.');
	}
	getDebugProtocolBreakpoint(breakpointId: string): DebugProtocol.Breakpoint | undefined {
		throw new Error('Method not implemented.');
	}
	customRequest(request: string, args: any): Promise<DebugProtocol.Response> {
		throw new Error('Method not implemented.');
	}
	stackTrace(threadId: number, startFrame: number, levels: number, token: CancellationToken): Promise<DebugProtocol.StackTraceResponse> {
		throw new Error('Method not implemented.');
	}
	exceptionInfo(threadId: number): Promise<IExceptionInfo> {
		throw new Error('Method not implemented.');
	}
	scopes(frameId: number): Promise<DebugProtocol.ScopesResponse> {
		throw new Error('Method not implemented.');
	}
	variables(variablesReference: number, threadId: number | undefined, filter: 'indexed' | 'named', start: number, count: number): Promise<DebugProtocol.VariablesResponse> {
		throw new Error('Method not implemented.');
	}
	evaluate(expression: string, frameId: number, context?: string): Promise<DebugProtocol.EvaluateResponse> {
		throw new Error('Method not implemented.');
	}
	restartFrame(frameId: number, threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	next(threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	stepIn(threadId: number, targetId?: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	stepOut(threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	stepBack(threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	continue(threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	reverseContinue(threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	pause(threadId: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	terminateThreads(threadIds: number[]): Promise<void> {
		throw new Error('Method not implemented.');
	}
	setVariable(variablesReference: number, name: string, value: string): Promise<DebugProtocol.SetVariableResponse> {
		throw new Error('Method not implemented.');
	}
	loadSource(resource: uri): Promise<DebugProtocol.SourceResponse> {
		throw new Error('Method not implemented.');
	}

	terminate(restart = false): Promise<void> {
		throw new Error('Method not implemented.');
	}
	disconnect(restart = false): Promise<void> {
		throw new Error('Method not implemented.');
	}

	gotoTargets(source: DebugProtocol.Source, line: number, column?: number | undefined): Promise<DebugProtocol.GotoTargetsResponse> {
		throw new Error('Method not implemented.');
	}
	goto(threadId: number, targetId: number): Promise<DebugProtocol.GotoResponse> {
		throw new Error('Method not implemented.');
	}
}

export class MockRawSession {

	capabilities: DebugProtocol.Capabilities = {};
	disconnected = false;
	sessionLengthInSeconds: number = 0;

	readyForBreakpoints = true;
	emittedStopped = true;

	getLengthInSeconds(): number {
		return 100;
	}

	stackTrace(args: DebugProtocol.StackTraceArguments): Promise<DebugProtocol.StackTraceResponse> {
		return Promise.resolve({
			seq: 1,
			type: 'response',
			request_seq: 1,
			success: true,
			command: 'stackTrace',
			body: {
				stackFrames: [{
					id: 1,
					name: 'mock',
					line: 5,
					column: 6
				}]
			}
		});
	}

	exceptionInfo(args: DebugProtocol.ExceptionInfoArguments): Promise<DebugProtocol.ExceptionInfoResponse> {
		throw new Error('not implemented');
	}

	launchOrAttach(args: IConfig): Promise<DebugProtocol.Response> {
		throw new Error('not implemented');
	}

	scopes(args: DebugProtocol.ScopesArguments): Promise<DebugProtocol.ScopesResponse> {
		throw new Error('not implemented');
	}

	variables(args: DebugProtocol.VariablesArguments): Promise<DebugProtocol.VariablesResponse> {
		throw new Error('not implemented');
	}

	evaluate(args: DebugProtocol.EvaluateArguments): Promise<DebugProtocol.EvaluateResponse> {
		return Promise.resolve(null!);
	}

	custom(request: string, args: any): Promise<DebugProtocol.Response> {
		throw new Error('not implemented');
	}

	terminate(restart = false): Promise<DebugProtocol.TerminateResponse> {
		throw new Error('not implemented');
	}

	disconnect(restart?: boolean): Promise<any> {
		throw new Error('not implemented');
	}

	threads(): Promise<DebugProtocol.ThreadsResponse> {
		throw new Error('not implemented');
	}

	stepIn(args: DebugProtocol.StepInArguments): Promise<DebugProtocol.StepInResponse> {
		throw new Error('not implemented');
	}

	stepOut(args: DebugProtocol.StepOutArguments): Promise<DebugProtocol.StepOutResponse> {
		throw new Error('not implemented');
	}

	stepBack(args: DebugProtocol.StepBackArguments): Promise<DebugProtocol.StepBackResponse> {
		throw new Error('not implemented');
	}

	continue(args: DebugProtocol.ContinueArguments): Promise<DebugProtocol.ContinueResponse> {
		throw new Error('not implemented');
	}

	reverseContinue(args: DebugProtocol.ReverseContinueArguments): Promise<DebugProtocol.ReverseContinueResponse> {
		throw new Error('not implemented');
	}

	pause(args: DebugProtocol.PauseArguments): Promise<DebugProtocol.PauseResponse> {
		throw new Error('not implemented');
	}

	terminateThreads(args: DebugProtocol.TerminateThreadsArguments): Promise<DebugProtocol.TerminateThreadsResponse> {
		throw new Error('not implemented');
	}

	setVariable(args: DebugProtocol.SetVariableArguments): Promise<DebugProtocol.SetVariableResponse> {
		throw new Error('not implemented');
	}

	restartFrame(args: DebugProtocol.RestartFrameArguments): Promise<DebugProtocol.RestartFrameResponse> {
		throw new Error('not implemented');
	}

	completions(args: DebugProtocol.CompletionsArguments): Promise<DebugProtocol.CompletionsResponse> {
		throw new Error('not implemented');
	}

	next(args: DebugProtocol.NextArguments): Promise<DebugProtocol.NextResponse> {
		throw new Error('not implemented');
	}

	source(args: DebugProtocol.SourceArguments): Promise<DebugProtocol.SourceResponse> {
		throw new Error('not implemented');
	}

	loadedSources(args: DebugProtocol.LoadedSourcesArguments): Promise<DebugProtocol.LoadedSourcesResponse> {
		throw new Error('not implemented');
	}

	setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Promise<DebugProtocol.SetBreakpointsResponse> {
		throw new Error('not implemented');
	}

	setFunctionBreakpoints(args: DebugProtocol.SetFunctionBreakpointsArguments): Promise<DebugProtocol.SetFunctionBreakpointsResponse> {
		throw new Error('not implemented');
	}

	setExceptionBreakpoints(args: DebugProtocol.SetExceptionBreakpointsArguments): Promise<DebugProtocol.SetExceptionBreakpointsResponse> {
		throw new Error('not implemented');
	}

	readonly onDidStop: Event<DebugProtocol.StoppedEvent> = null!;
}

export class MockDebugAdapter extends AbstractDebugAdapter {
	private seq = 0;

	startSession(): Promise<void> {
		return Promise.resolve();
	}

	stopSession(): Promise<void> {
		return Promise.resolve();
	}

	sendMessage(message: DebugProtocol.ProtocolMessage): void {
		setTimeout(() => {
			if (message.type === 'request') {
				const request = message as DebugProtocol.Request;
				switch (request.command) {
					case 'evaluate':
						this.evaluate(request, request.arguments);
						return;
				}
				this.sendResponseBody(request, {});
				return;
			}
		}, 0);
	}

	sendResponseBody(request: DebugProtocol.Request, body: any) {
		const response: DebugProtocol.Response = {
			seq: ++this.seq,
			type: 'response',
			request_seq: request.seq,
			command: request.command,
			success: true,
			body
		};
		this.acceptMessage(response);
	}

	sendEventBody(event: string, body: any) {
		const response: DebugProtocol.Event = {
			seq: ++this.seq,
			type: 'event',
			event,
			body
		};
		this.acceptMessage(response);
	}

	evaluate(request: DebugProtocol.Request, args: DebugProtocol.EvaluateArguments) {
		if (args.expression.indexOf('before.') === 0) {
			this.sendEventBody('output', { output: args.expression });
		}

		this.sendResponseBody(request, {
			result: '=' + args.expression,
			variablesReference: 0
		});

		if (args.expression.indexOf('after.') === 0) {
			this.sendEventBody('output', { output: args.expression });
		}
	}
}

class MockDebugStorage extends DebugStorage {

	constructor() {
		super(undefined as any, undefined as any, undefined as any);
	}

	override loadBreakpoints(): Breakpoint[] {
		return [];
	}

	override loadFunctionBreakpoints(): FunctionBreakpoint[] {
		return [];
	}

	override loadExceptionBreakpoints(): ExceptionBreakpoint[] {
		return [];

	}

	override loadDataBreakpoints(): DataBreakpoint[] {
		return [];

	}

	override loadWatchExpressions(): Expression[] {
		return [];

	}

	override storeWatchExpressions(_watchExpressions: (IExpression & IEvaluate)[]): void { }

	override storeBreakpoints(_debugModel: IDebugModel): void { }
}

export function createMockDebugModel(): DebugModel {
	return new DebugModel(new MockDebugStorage(), <any>{ isDirty: (e: any) => false }, mockUriIdentityService);
}
