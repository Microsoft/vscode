/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI as uri, UriComponents } from 'vs/base/common/uri';
import { IDebugService, IConfig, IDebugConfigurationProvider, IBreakpoint, IFunctionBreakpoint, IBreakpointData, IDebugAdapter, IDebugAdapterDescriptorFactory, IDebugSession, IDebugAdapterFactory, IDataBreakpoint, IDebugSessionOptions } from 'vs/workbench/contrib/debug/common/debug';
import {
	ExtHostContext, ExtHostDebugServiceShape, MainThreadDebugServiceShape, DebugSessionUUID, MainContext,
	IExtHostContext, IBreakpointsDeltaDto, ISourceMultiBreakpointDto, ISourceBreakpointDto, IFunctionBreakpointDto, IDebugSessionDto, IDataBreakpointDto, IStartDebuggingOptions, IDebugConfiguration
} from 'vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import severity from 'vs/base/common/severity';
import { AbstractDebugAdapter } from 'vs/workbench/contrib/debug/common/abstractDebugAdapter';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { convertToVSCPaths, convertToDAPaths } from 'vs/workbench/contrib/debug/common/debugUtils';
import { DebugConfigurationProviderTriggerKind } from 'vs/workbench/api/common/extHostTypes';

@extHostNamedCustomer(MainContext.MainThreadDebugService)
export class MainThreadDebugService implements MainThreadDebugServiceShape, IDebugAdapterFactory {

	private readonly _proxy: ExtHostDebugServiceShape;
	private readonly _toDispose = new DisposableStore();
	private _breakpointEventsActive: boolean | undefined;
	private readonly _debugAdapters: Map<number, ExtensionHostDebugAdapter>;
	private _debugAdaptersHandleCounter = 1;
	private readonly _debugConfigurationProviders: Map<number, IDebugConfigurationProvider>;
	private readonly _debugAdapterDescriptorFactories: Map<number, IDebugAdapterDescriptorFactory>;
	private readonly _sessions: Set<DebugSessionUUID>;

	constructor(
		extHostContext: IExtHostContext,
		@IDebugService private readonly debugService: IDebugService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDebugService);
		this._toDispose.add(debugService.onDidNewSession(session => {
			this._proxy.$acceptDebugSessionStarted(this.getSessionDto(session));
			this._toDispose.add(session.onDidChangeName(name => {
				this._proxy.$acceptDebugSessionNameChanged(this.getSessionDto(session), name);
			}));
		}));
		// Need to start listening early to new session events because a custom event can come while a session is initialising
		this._toDispose.add(debugService.onWillNewSession(session => {
			this._toDispose.add(session.onDidCustomEvent(event => this._proxy.$acceptDebugSessionCustomEvent(this.getSessionDto(session), event)));
		}));
		this._toDispose.add(debugService.onDidEndSession(session => {
			this._proxy.$acceptDebugSessionTerminated(this.getSessionDto(session));
			this._sessions.delete(session.getId());
		}));
		this._toDispose.add(debugService.getViewModel().onDidFocusSession(session => {
			this._proxy.$acceptDebugSessionActiveChanged(this.getSessionDto(session));
		}));

		this._debugAdapters = new Map();
		this._debugConfigurationProviders = new Map();
		this._debugAdapterDescriptorFactories = new Map();
		this._sessions = new Set();
	}

	public dispose(): void {
		this._toDispose.dispose();
	}

	// interface IDebugAdapterProvider

	createDebugAdapter(session: IDebugSession): IDebugAdapter {
		const handle = this._debugAdaptersHandleCounter++;
		const da = new ExtensionHostDebugAdapter(this, handle, this._proxy, session);
		this._debugAdapters.set(handle, da);
		return da;
	}

	substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig> {
		return Promise.resolve(this._proxy.$substituteVariables(folder ? folder.uri : undefined, config));
	}

	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined> {
		return this._proxy.$runInTerminal(args);
	}

	// RPC methods (MainThreadDebugServiceShape)

	public $registerDebugTypes(debugTypes: string[]) {
		this._toDispose.add(this.debugService.getAdapterManager().registerDebugAdapterFactory(debugTypes, this));
	}

	public $startBreakpointEvents(): void {

		if (!this._breakpointEventsActive) {
			this._breakpointEventsActive = true;

			// set up a handler to send more
			this._toDispose.add(this.debugService.getModel().onDidChangeBreakpoints(e => {
				// Ignore session only breakpoint events since they should only reflect in the UI
				if (e && !e.sessionOnly) {
					const delta: IBreakpointsDeltaDto = {};
					if (e.added) {
						delta.added = this.convertToDto(e.added);
					}
					if (e.removed) {
						delta.removed = e.removed.map(x => x.getId());
					}
					if (e.changed) {
						delta.changed = this.convertToDto(e.changed);
					}

					if (delta.added || delta.removed || delta.changed) {
						this._proxy.$acceptBreakpointsDelta(delta);
					}
				}
			}));

			// send all breakpoints
			const bps = this.debugService.getModel().getBreakpoints();
			const fbps = this.debugService.getModel().getFunctionBreakpoints();
			const dbps = this.debugService.getModel().getDataBreakpoints();
			if (bps.length > 0 || fbps.length > 0) {
				this._proxy.$acceptBreakpointsDelta({
					added: this.convertToDto(bps).concat(this.convertToDto(fbps)).concat(this.convertToDto(dbps))
				});
			}
		}
	}

	public $registerBreakpoints(DTOs: Array<ISourceMultiBreakpointDto | IFunctionBreakpointDto | IDataBreakpointDto>): Promise<void> {

		for (let dto of DTOs) {
			if (dto.type === 'sourceMulti') {
				const rawbps = dto.lines.map(l =>
					<IBreakpointData>{
						id: l.id,
						enabled: l.enabled,
						lineNumber: l.line + 1,
						column: l.character > 0 ? l.character + 1 : undefined, // a column value of 0 results in an omitted column attribute; see #46784
						condition: l.condition,
						hitCondition: l.hitCondition,
						logMessage: l.logMessage
					}
				);
				this.debugService.addBreakpoints(uri.revive(dto.uri), rawbps);
			} else if (dto.type === 'function') {
				this.debugService.addFunctionBreakpoint(dto.functionName, dto.id);
			} else if (dto.type === 'data') {
				this.debugService.addDataBreakpoint(dto.label, dto.dataId, dto.canPersist, dto.accessTypes);
			}
		}
		return Promise.resolve();
	}

	public $unregisterBreakpoints(breakpointIds: string[], functionBreakpointIds: string[], dataBreakpointIds: string[]): Promise<void> {
		breakpointIds.forEach(id => this.debugService.removeBreakpoints(id));
		functionBreakpointIds.forEach(id => this.debugService.removeFunctionBreakpoints(id));
		dataBreakpointIds.forEach(id => this.debugService.removeDataBreakpoints(id));
		return Promise.resolve();
	}

	public $registerDebugConfigurationProvider(debugType: string, providerTriggerKind: DebugConfigurationProviderTriggerKind, hasProvide: boolean, hasResolve: boolean, hasResolve2: boolean, handle: number): Promise<void> {

		const provider = <IDebugConfigurationProvider>{
			type: debugType,
			triggerKind: providerTriggerKind
		};
		if (hasProvide) {
			provider.provideDebugConfigurations = (folder, token) => {
				return this._proxy.$provideDebugConfigurations(handle, folder, token);
			};
		}
		if (hasResolve) {
			provider.resolveDebugConfiguration = (folder, config, token) => {
				return this._proxy.$resolveDebugConfiguration(handle, folder, config, token);
			};
		}
		if (hasResolve2) {
			provider.resolveDebugConfigurationWithSubstitutedVariables = (folder, config, token) => {
				return this._proxy.$resolveDebugConfigurationWithSubstitutedVariables(handle, folder, config, token);
			};
		}
		this._debugConfigurationProviders.set(handle, provider);
		this._toDispose.add(this.debugService.getConfigurationManager().registerDebugConfigurationProvider(provider));

		return Promise.resolve(undefined);
	}

	public $unregisterDebugConfigurationProvider(handle: number): void {
		const provider = this._debugConfigurationProviders.get(handle);
		if (provider) {
			this._debugConfigurationProviders.delete(handle);
			this.debugService.getConfigurationManager().unregisterDebugConfigurationProvider(provider);
		}
	}

	public $registerDebugAdapterDescriptorFactory(debugType: string, handle: number): Promise<void> {

		const provider = <IDebugAdapterDescriptorFactory>{
			type: debugType,
			createDebugAdapterDescriptor: session => {
				return Promise.resolve(this._proxy.$provideDebugAdapter(handle, this.getSessionDto(session)));
			}
		};
		this._debugAdapterDescriptorFactories.set(handle, provider);
		this._toDispose.add(this.debugService.getAdapterManager().registerDebugAdapterDescriptorFactory(provider));

		return Promise.resolve(undefined);
	}

	public $unregisterDebugAdapterDescriptorFactory(handle: number): void {
		const provider = this._debugAdapterDescriptorFactories.get(handle);
		if (provider) {
			this._debugAdapterDescriptorFactories.delete(handle);
			this.debugService.getAdapterManager().unregisterDebugAdapterDescriptorFactory(provider);
		}
	}

	private getSession(sessionId: DebugSessionUUID | undefined): IDebugSession | undefined {
		if (sessionId) {
			return this.debugService.getModel().getSession(sessionId, true);
		}
		return undefined;
	}

	public $startDebugging(folder: UriComponents | undefined, nameOrConfig: string | IDebugConfiguration, options: IStartDebuggingOptions): Promise<boolean> {
		const folderUri = folder ? uri.revive(folder) : undefined;
		const launch = this.debugService.getConfigurationManager().getLaunch(folderUri);
		const parentSession = this.getSession(options.parentSessionID);
		const debugOptions: IDebugSessionOptions = {
			noDebug: options.noDebug,
			parentSession,
			repl: options.repl,
			compact: options.compact,
			compoundRoot: parentSession?.compoundRoot
		};
		return this.debugService.startDebugging(launch, nameOrConfig, debugOptions).then(success => {
			return success;
		}, err => {
			return Promise.reject(new Error(err && err.message ? err.message : 'cannot start debugging'));
		});
	}

	public $setDebugSessionName(sessionId: DebugSessionUUID, name: string): void {
		const session = this.debugService.getModel().getSession(sessionId);
		if (session) {
			session.setName(name);
		}
	}

	public $customDebugAdapterRequest(sessionId: DebugSessionUUID, request: string, args: any): Promise<any> {
		const session = this.debugService.getModel().getSession(sessionId, true);
		if (session) {
			return session.customRequest(request, args).then(response => {
				if (response && response.success) {
					return response.body;
				} else {
					return Promise.reject(new Error(response ? response.message : 'custom request failed'));
				}
			});
		}
		return Promise.reject(new Error('debug session not found'));
	}

	public $getDebugProtocolBreakpoint(sessionId: DebugSessionUUID, breakpoinId: string): Promise<DebugProtocol.Breakpoint | undefined> {
		const session = this.debugService.getModel().getSession(sessionId, true);
		if (session) {
			return Promise.resolve(session.getDebugProtocolBreakpoint(breakpoinId));
		}
		return Promise.reject(new Error('debug session not found'));
	}

	public $stopDebugging(sessionId: DebugSessionUUID | undefined): Promise<void> {
		if (sessionId) {
			const session = this.debugService.getModel().getSession(sessionId, true);
			if (session) {
				return this.debugService.stopSession(session);
			}
		} else {	// stop all
			return this.debugService.stopSession(undefined);
		}
		return Promise.reject(new Error('debug session not found'));
	}

	public $appendDebugConsole(value: string): void {
		// Use warning as severity to get the orange color for messages coming from the debug extension
		const session = this.debugService.getViewModel().focusedSession;
		if (session) {
			session.appendToRepl(value, severity.Warning);
		}
	}

	public $acceptDAMessage(handle: number, message: DebugProtocol.ProtocolMessage) {
		this.getDebugAdapter(handle).acceptMessage(convertToVSCPaths(message, false));
	}

	public $acceptDAError(handle: number, name: string, message: string, stack: string) {
		this.getDebugAdapter(handle).fireError(handle, new Error(`${name}: ${message}\n${stack}`));
	}

	public $acceptDAExit(handle: number, code: number, signal: string) {
		this.getDebugAdapter(handle).fireExit(handle, code, signal);
	}

	private getDebugAdapter(handle: number): ExtensionHostDebugAdapter {
		const adapter = this._debugAdapters.get(handle);
		if (!adapter) {
			throw new Error('Invalid debug adapter');
		}
		return adapter;
	}

	// dto helpers

	public $sessionCached(sessionID: string) {
		// remember that the EH has cached the session and we do not have to send it again
		this._sessions.add(sessionID);
	}


	getSessionDto(session: undefined): undefined;
	getSessionDto(session: IDebugSession): IDebugSessionDto;
	getSessionDto(session: IDebugSession | undefined): IDebugSessionDto | undefined;
	getSessionDto(session: IDebugSession | undefined): IDebugSessionDto | undefined {
		if (session) {
			const sessionID = <DebugSessionUUID>session.getId();
			if (this._sessions.has(sessionID)) {
				return sessionID;
			} else {
				// this._sessions.add(sessionID); 	// #69534: see $sessionCached above
				return {
					id: sessionID,
					type: session.configuration.type,
					name: session.configuration.name,
					folderUri: session.root ? session.root.uri : undefined,
					configuration: session.configuration
				};
			}
		}
		return undefined;
	}

	private convertToDto(bps: (ReadonlyArray<IBreakpoint | IFunctionBreakpoint | IDataBreakpoint>)): Array<ISourceBreakpointDto | IFunctionBreakpointDto | IDataBreakpointDto> {
		return bps.map(bp => {
			if ('name' in bp) {
				const fbp = <IFunctionBreakpoint>bp;
				return <IFunctionBreakpointDto>{
					type: 'function',
					id: fbp.getId(),
					enabled: fbp.enabled,
					condition: fbp.condition,
					hitCondition: fbp.hitCondition,
					logMessage: fbp.logMessage,
					functionName: fbp.name
				};
			} else if ('dataId' in bp) {
				const dbp = <IDataBreakpoint>bp;
				return <IDataBreakpointDto>{
					type: 'data',
					id: dbp.getId(),
					dataId: dbp.dataId,
					enabled: dbp.enabled,
					condition: dbp.condition,
					hitCondition: dbp.hitCondition,
					logMessage: dbp.logMessage,
					label: dbp.description,
					canPersist: dbp.canPersist
				};
			} else {
				const sbp = <IBreakpoint>bp;
				return <ISourceBreakpointDto>{
					type: 'source',
					id: sbp.getId(),
					enabled: sbp.enabled,
					condition: sbp.condition,
					hitCondition: sbp.hitCondition,
					logMessage: sbp.logMessage,
					uri: sbp.uri,
					line: sbp.lineNumber > 0 ? sbp.lineNumber - 1 : 0,
					character: (typeof sbp.column === 'number' && sbp.column > 0) ? sbp.column - 1 : 0,
				};
			}
		});
	}
}

/**
 * DebugAdapter that communicates via extension protocol with another debug adapter.
 */
class ExtensionHostDebugAdapter extends AbstractDebugAdapter {

	constructor(private readonly _ds: MainThreadDebugService, private _handle: number, private _proxy: ExtHostDebugServiceShape, private _session: IDebugSession) {
		super();
	}

	fireError(handle: number, err: Error) {
		this._onError.fire(err);
	}

	fireExit(handle: number, code: number, signal: string) {
		this._onExit.fire(code);
	}

	startSession(): Promise<void> {
		return Promise.resolve(this._proxy.$startDASession(this._handle, this._ds.getSessionDto(this._session)));
	}

	sendMessage(message: DebugProtocol.ProtocolMessage): void {
		this._proxy.$sendDAMessage(this._handle, convertToDAPaths(message, true));
	}

	async stopSession(): Promise<void> {
		await this.cancelPendingRequests();
		return Promise.resolve(this._proxy.$stopDASession(this._handle));
	}
}
