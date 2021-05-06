/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { asPromise } from 'vs/base/common/async';
import {
	MainContext, MainThreadDebugServiceShape, ExtHostDebugServiceShape, DebugSessionUUID,
	IBreakpointsDeltaDto, ISourceMultiBreakpointDto, IFunctionBreakpointDto, IDebugSessionDto
} from 'vs/workbench/api/common/extHost.protocol';
import { Disposable, Position, Location, SourceBreakpoint, FunctionBreakpoint, DebugAdapterServer, DebugAdapterExecutable, DataBreakpoint, DebugConsoleMode, DebugAdapterInlineImplementation, DebugAdapterNamedPipeServer } from 'vs/workbench/api/common/extHostTypes';
import { AbstractDebugAdapter } from 'vs/workbench/contrib/debug/common/abstractDebugAdapter';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { IExtHostExtensionService } from 'vs/workbench/api/common/extHostExtensionService';
import { ExtHostDocumentsAndEditors, IExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IDebuggerContribution, IConfig, IDebugAdapter, IDebugAdapterServer, IDebugAdapterExecutable, IAdapterDescriptor, IDebugAdapterImpl, IDebugAdapterNamedPipeServer } from 'vs/workbench/contrib/debug/common/debug';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { AbstractVariableResolverService } from 'vs/workbench/services/configurationResolver/common/variableResolver';
import { ExtHostConfigProvider, IExtHostConfiguration } from '../common/extHostConfiguration';
import { convertToVSCPaths, convertToDAPaths, isDebuggerMainContribution } from 'vs/workbench/contrib/debug/common/debugUtils';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { ISignService } from 'vs/platform/sign/common/sign';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import type * as vscode from 'vscode';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { withNullAsUndefined } from 'vs/base/common/types';
import * as process from 'vs/base/common/process';

export const IExtHostDebugService = createDecorator<IExtHostDebugService>('IExtHostDebugService');

export interface IExtHostDebugService extends ExtHostDebugServiceShape {

	readonly _serviceBrand: undefined;

	onDidStartDebugSession: Event<vscode.DebugSession>;
	onDidTerminateDebugSession: Event<vscode.DebugSession>;
	onDidChangeActiveDebugSession: Event<vscode.DebugSession | undefined>;
	activeDebugSession: vscode.DebugSession | undefined;
	activeDebugConsole: vscode.DebugConsole;
	onDidReceiveDebugSessionCustomEvent: Event<vscode.DebugSessionCustomEvent>;
	onDidChangeBreakpoints: Event<vscode.BreakpointsChangeEvent>;
	breakpoints: vscode.Breakpoint[];

	addBreakpoints(breakpoints0: vscode.Breakpoint[]): Promise<void>;
	removeBreakpoints(breakpoints0: vscode.Breakpoint[]): Promise<void>;
	startDebugging(folder: vscode.WorkspaceFolder | undefined, nameOrConfig: string | vscode.DebugConfiguration, options: vscode.DebugSessionOptions): Promise<boolean>;
	stopDebugging(session?: vscode.DebugSession): Promise<void>;
	registerDebugConfigurationProvider(type: string, provider: vscode.DebugConfigurationProvider, trigger: vscode.DebugConfigurationProviderTriggerKind): vscode.Disposable;
	registerDebugAdapterDescriptorFactory(extension: IExtensionDescription, type: string, factory: vscode.DebugAdapterDescriptorFactory): vscode.Disposable;
	registerDebugAdapterTrackerFactory(type: string, factory: vscode.DebugAdapterTrackerFactory): vscode.Disposable;
	asDebugSourceUri(source: vscode.DebugProtocolSource, session?: vscode.DebugSession): vscode.Uri;
}

export abstract class ExtHostDebugServiceBase implements IExtHostDebugService, ExtHostDebugServiceShape {

	readonly _serviceBrand: undefined;

	private _configProviderHandleCounter: number;
	private _configProviders: ConfigProviderTuple[];

	private _adapterFactoryHandleCounter: number;
	private _adapterFactories: DescriptorFactoryTuple[];

	private _trackerFactoryHandleCounter: number;
	private _trackerFactories: TrackerFactoryTuple[];

	private _debugServiceProxy: MainThreadDebugServiceShape;
	private _debugSessions: Map<DebugSessionUUID, ExtHostDebugSession> = new Map<DebugSessionUUID, ExtHostDebugSession>();

	private readonly _onDidStartDebugSession: Emitter<vscode.DebugSession>;
	get onDidStartDebugSession(): Event<vscode.DebugSession> { return this._onDidStartDebugSession.event; }

	private readonly _onDidTerminateDebugSession: Emitter<vscode.DebugSession>;
	get onDidTerminateDebugSession(): Event<vscode.DebugSession> { return this._onDidTerminateDebugSession.event; }

	private readonly _onDidChangeActiveDebugSession: Emitter<vscode.DebugSession | undefined>;
	get onDidChangeActiveDebugSession(): Event<vscode.DebugSession | undefined> { return this._onDidChangeActiveDebugSession.event; }

	private _activeDebugSession: ExtHostDebugSession | undefined;
	get activeDebugSession(): ExtHostDebugSession | undefined { return this._activeDebugSession; }

	private readonly _onDidReceiveDebugSessionCustomEvent: Emitter<vscode.DebugSessionCustomEvent>;
	get onDidReceiveDebugSessionCustomEvent(): Event<vscode.DebugSessionCustomEvent> { return this._onDidReceiveDebugSessionCustomEvent.event; }

	private _activeDebugConsole: ExtHostDebugConsole;
	get activeDebugConsole(): vscode.DebugConsole { return this._activeDebugConsole.value; }

	private _breakpoints: Map<string, vscode.Breakpoint>;
	private _breakpointEventsActive: boolean;

	private readonly _onDidChangeBreakpoints: Emitter<vscode.BreakpointsChangeEvent>;

	private _debugAdapters: Map<number, IDebugAdapter>;
	private _debugAdaptersTrackers: Map<number, vscode.DebugAdapterTracker>;

	private _variableResolver: IConfigurationResolverService | undefined;

	private _signService: ISignService | undefined;

	constructor(
		@IExtHostRpcService extHostRpcService: IExtHostRpcService,
		@IExtHostWorkspace protected _workspaceService: IExtHostWorkspace,
		@IExtHostExtensionService private _extensionService: IExtHostExtensionService,
		@IExtHostDocumentsAndEditors private _editorsService: IExtHostDocumentsAndEditors,
		@IExtHostConfiguration protected _configurationService: IExtHostConfiguration,
	) {
		this._configProviderHandleCounter = 0;
		this._configProviders = [];

		this._adapterFactoryHandleCounter = 0;
		this._adapterFactories = [];

		this._trackerFactoryHandleCounter = 0;
		this._trackerFactories = [];

		this._debugAdapters = new Map();
		this._debugAdaptersTrackers = new Map();

		this._onDidStartDebugSession = new Emitter<vscode.DebugSession>();
		this._onDidTerminateDebugSession = new Emitter<vscode.DebugSession>();
		this._onDidChangeActiveDebugSession = new Emitter<vscode.DebugSession | undefined>();
		this._onDidReceiveDebugSessionCustomEvent = new Emitter<vscode.DebugSessionCustomEvent>();

		this._debugServiceProxy = extHostRpcService.getProxy(MainContext.MainThreadDebugService);

		this._onDidChangeBreakpoints = new Emitter<vscode.BreakpointsChangeEvent>({
			onFirstListenerAdd: () => {
				this.startBreakpoints();
			}
		});

		this._activeDebugConsole = new ExtHostDebugConsole(this._debugServiceProxy);

		this._breakpoints = new Map<string, vscode.Breakpoint>();
		this._breakpointEventsActive = false;

		this._extensionService.getExtensionRegistry().then((extensionRegistry: ExtensionDescriptionRegistry) => {
			extensionRegistry.onDidChange(_ => {
				this.registerAllDebugTypes(extensionRegistry);
			});
			this.registerAllDebugTypes(extensionRegistry);
		});
	}

	public asDebugSourceUri(src: vscode.DebugProtocolSource, session?: vscode.DebugSession): URI {

		const source = <any>src;

		if (typeof source.sourceReference === 'number' && source.sourceReference > 0) {
			// src can be retrieved via DAP's "source" request

			let debug = `debug:${encodeURIComponent(source.path || '')}`;
			let sep = '?';

			if (session) {
				debug += `${sep}session=${encodeURIComponent(session.id)}`;
				sep = '&';
			}

			debug += `${sep}ref=${source.sourceReference}`;

			return URI.parse(debug);
		} else if (source.path) {
			// src is just a local file path
			return URI.file(source.path);
		} else {
			throw new Error(`cannot create uri from DAP 'source' object; properties 'path' and 'sourceReference' are both missing.`);
		}
	}

	private registerAllDebugTypes(extensionRegistry: ExtensionDescriptionRegistry) {

		const debugTypes: string[] = [];

		for (const ed of extensionRegistry.getAllExtensionDescriptions()) {
			if (ed.contributes) {
				const debuggers = <IDebuggerContribution[]>ed.contributes['debuggers'];
				if (debuggers && debuggers.length > 0) {
					for (const dbg of debuggers) {
						if (isDebuggerMainContribution(dbg)) {
							debugTypes.push(dbg.type);
						}
					}
				}
			}
		}

		this._debugServiceProxy.$registerDebugTypes(debugTypes);
	}

	// extension debug API

	get onDidChangeBreakpoints(): Event<vscode.BreakpointsChangeEvent> {
		return this._onDidChangeBreakpoints.event;
	}

	get breakpoints(): vscode.Breakpoint[] {

		this.startBreakpoints();

		const result: vscode.Breakpoint[] = [];
		this._breakpoints.forEach(bp => result.push(bp));
		return result;
	}

	public addBreakpoints(breakpoints0: vscode.Breakpoint[]): Promise<void> {

		this.startBreakpoints();

		// filter only new breakpoints
		const breakpoints = breakpoints0.filter(bp => {
			const id = bp.id;
			if (!this._breakpoints.has(id)) {
				this._breakpoints.set(id, bp);
				return true;
			}
			return false;
		});

		// send notification for added breakpoints
		this.fireBreakpointChanges(breakpoints, [], []);

		// convert added breakpoints to DTOs
		const dtos: Array<ISourceMultiBreakpointDto | IFunctionBreakpointDto> = [];
		const map = new Map<string, ISourceMultiBreakpointDto>();
		for (const bp of breakpoints) {
			if (bp instanceof SourceBreakpoint) {
				let dto = map.get(bp.location.uri.toString());
				if (!dto) {
					dto = <ISourceMultiBreakpointDto>{
						type: 'sourceMulti',
						uri: bp.location.uri,
						lines: []
					};
					map.set(bp.location.uri.toString(), dto);
					dtos.push(dto);
				}
				dto.lines.push({
					id: bp.id,
					enabled: bp.enabled,
					condition: bp.condition,
					hitCondition: bp.hitCondition,
					logMessage: bp.logMessage,
					line: bp.location.range.start.line,
					character: bp.location.range.start.character
				});
			} else if (bp instanceof FunctionBreakpoint) {
				dtos.push({
					type: 'function',
					id: bp.id,
					enabled: bp.enabled,
					hitCondition: bp.hitCondition,
					logMessage: bp.logMessage,
					condition: bp.condition,
					functionName: bp.functionName
				});
			}
		}

		// send DTOs to VS Code
		return this._debugServiceProxy.$registerBreakpoints(dtos);
	}

	public removeBreakpoints(breakpoints0: vscode.Breakpoint[]): Promise<void> {

		this.startBreakpoints();

		// remove from array
		const breakpoints = breakpoints0.filter(b => this._breakpoints.delete(b.id));

		// send notification
		this.fireBreakpointChanges([], breakpoints, []);

		// unregister with VS Code
		const ids = breakpoints.filter(bp => bp instanceof SourceBreakpoint).map(bp => bp.id);
		const fids = breakpoints.filter(bp => bp instanceof FunctionBreakpoint).map(bp => bp.id);
		const dids = breakpoints.filter(bp => bp instanceof DataBreakpoint).map(bp => bp.id);
		return this._debugServiceProxy.$unregisterBreakpoints(ids, fids, dids);
	}

	public startDebugging(folder: vscode.WorkspaceFolder | undefined, nameOrConfig: string | vscode.DebugConfiguration, options: vscode.DebugSessionOptions): Promise<boolean> {
		return this._debugServiceProxy.$startDebugging(folder ? folder.uri : undefined, nameOrConfig, {
			parentSessionID: options.parentSession ? options.parentSession.id : undefined,
			repl: options.consoleMode === DebugConsoleMode.MergeWithParent ? 'mergeWithParent' : 'separate',
			noDebug: options.noDebug,
			compact: options.compact
		});
	}

	public stopDebugging(session?: vscode.DebugSession): Promise<void> {
		return this._debugServiceProxy.$stopDebugging(session ? session.id : undefined);
	}

	public registerDebugConfigurationProvider(type: string, provider: vscode.DebugConfigurationProvider, trigger: vscode.DebugConfigurationProviderTriggerKind): vscode.Disposable {

		if (!provider) {
			return new Disposable(() => { });
		}

		const handle = this._configProviderHandleCounter++;
		this._configProviders.push({ type, handle, provider });

		this._debugServiceProxy.$registerDebugConfigurationProvider(type, trigger,
			!!provider.provideDebugConfigurations,
			!!provider.resolveDebugConfiguration,
			!!provider.resolveDebugConfigurationWithSubstitutedVariables,
			handle);

		return new Disposable(() => {
			this._configProviders = this._configProviders.filter(p => p.provider !== provider);		// remove
			this._debugServiceProxy.$unregisterDebugConfigurationProvider(handle);
		});
	}

	public registerDebugAdapterDescriptorFactory(extension: IExtensionDescription, type: string, factory: vscode.DebugAdapterDescriptorFactory): vscode.Disposable {

		if (!factory) {
			return new Disposable(() => { });
		}

		// a DebugAdapterDescriptorFactory can only be registered in the extension that contributes the debugger
		if (!this.definesDebugType(extension, type)) {
			throw new Error(`a DebugAdapterDescriptorFactory can only be registered from the extension that defines the '${type}' debugger.`);
		}

		// make sure that only one factory for this type is registered
		if (this.getAdapterDescriptorFactoryByType(type)) {
			throw new Error(`a DebugAdapterDescriptorFactory can only be registered once per a type.`);
		}

		const handle = this._adapterFactoryHandleCounter++;
		this._adapterFactories.push({ type, handle, factory });

		this._debugServiceProxy.$registerDebugAdapterDescriptorFactory(type, handle);

		return new Disposable(() => {
			this._adapterFactories = this._adapterFactories.filter(p => p.factory !== factory);		// remove
			this._debugServiceProxy.$unregisterDebugAdapterDescriptorFactory(handle);
		});
	}

	public registerDebugAdapterTrackerFactory(type: string, factory: vscode.DebugAdapterTrackerFactory): vscode.Disposable {

		if (!factory) {
			return new Disposable(() => { });
		}

		const handle = this._trackerFactoryHandleCounter++;
		this._trackerFactories.push({ type, handle, factory });

		return new Disposable(() => {
			this._trackerFactories = this._trackerFactories.filter(p => p.factory !== factory);		// remove
		});
	}

	// RPC methods (ExtHostDebugServiceShape)

	public async $runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined> {
		return Promise.resolve(undefined);
	}

	protected abstract createVariableResolver(folders: vscode.WorkspaceFolder[], editorService: ExtHostDocumentsAndEditors, configurationService: ExtHostConfigProvider): AbstractVariableResolverService;

	public async $substituteVariables(folderUri: UriComponents | undefined, config: IConfig): Promise<IConfig> {
		if (!this._variableResolver) {
			const [workspaceFolders, configProvider] = await Promise.all([this._workspaceService.getWorkspaceFolders2(), this._configurationService.getConfigProvider()]);
			this._variableResolver = this.createVariableResolver(workspaceFolders || [], this._editorsService, configProvider!);
		}
		let ws: IWorkspaceFolder | undefined;
		const folder = await this.getFolder(folderUri);
		if (folder) {
			ws = {
				uri: folder.uri,
				name: folder.name,
				index: folder.index,
				toResource: () => {
					throw new Error('Not implemented');
				}
			};
		}
		return this._variableResolver.resolveAnyAsync(ws, config);
	}

	protected createDebugAdapter(adapter: IAdapterDescriptor, session: ExtHostDebugSession): AbstractDebugAdapter | undefined {
		if (adapter.type === 'implementation') {
			return new DirectDebugAdapter(adapter.implementation);
		}
		return undefined;
	}

	protected createSignService(): ISignService | undefined {
		return undefined;
	}

	public async $startDASession(debugAdapterHandle: number, sessionDto: IDebugSessionDto): Promise<void> {
		const mythis = this;

		const session = await this.getSession(sessionDto);

		return this.getAdapterDescriptor(this.getAdapterDescriptorFactoryByType(session.type), session).then(daDescriptor => {

			if (!daDescriptor) {
				throw new Error(`Couldn't find a debug adapter descriptor for debug type '${session.type}' (extension might have failed to activate)`);
			}

			const adapterDescriptor = this.convertToDto(daDescriptor);

			const da = this.createDebugAdapter(adapterDescriptor, session);
			if (!da) {
				throw new Error(`Couldn't create a debug adapter for type '${session.type}'.`);
			}

			const debugAdapter = da;

			this._debugAdapters.set(debugAdapterHandle, debugAdapter);

			return this.getDebugAdapterTrackers(session).then(tracker => {

				if (tracker) {
					this._debugAdaptersTrackers.set(debugAdapterHandle, tracker);
				}

				debugAdapter.onMessage(async message => {

					if (message.type === 'request' && (<DebugProtocol.Request>message).command === 'handshake') {

						const request = <DebugProtocol.Request>message;

						const response: DebugProtocol.Response = {
							type: 'response',
							seq: 0,
							command: request.command,
							request_seq: request.seq,
							success: true
						};

						if (!this._signService) {
							this._signService = this.createSignService();
						}

						try {
							if (this._signService) {
								const signature = await this._signService.sign(request.arguments.value);
								response.body = {
									signature: signature
								};
								debugAdapter.sendResponse(response);
							} else {
								throw new Error('no signer');
							}
						} catch (e) {
							response.success = false;
							response.message = e.message;
							debugAdapter.sendResponse(response);
						}
					} else {
						if (tracker && tracker.onDidSendMessage) {
							tracker.onDidSendMessage(message);
						}

						// DA -> VS Code
						message = convertToVSCPaths(message, true);

						mythis._debugServiceProxy.$acceptDAMessage(debugAdapterHandle, message);
					}
				});
				debugAdapter.onError(err => {
					if (tracker && tracker.onError) {
						tracker.onError(err);
					}
					this._debugServiceProxy.$acceptDAError(debugAdapterHandle, err.name, err.message, err.stack);
				});
				debugAdapter.onExit((code: number | null) => {
					if (tracker && tracker.onExit) {
						tracker.onExit(withNullAsUndefined(code), undefined);
					}
					this._debugServiceProxy.$acceptDAExit(debugAdapterHandle, withNullAsUndefined(code), undefined);
				});

				if (tracker && tracker.onWillStartSession) {
					tracker.onWillStartSession();
				}

				return debugAdapter.startSession();
			});
		});
	}

	public $sendDAMessage(debugAdapterHandle: number, message: DebugProtocol.ProtocolMessage): void {

		// VS Code -> DA
		message = convertToDAPaths(message, false);

		const tracker = this._debugAdaptersTrackers.get(debugAdapterHandle);	// TODO@AW: same handle?
		if (tracker && tracker.onWillReceiveMessage) {
			tracker.onWillReceiveMessage(message);
		}

		const da = this._debugAdapters.get(debugAdapterHandle);
		if (da) {
			da.sendMessage(message);
		}
	}

	public $stopDASession(debugAdapterHandle: number): Promise<void> {

		const tracker = this._debugAdaptersTrackers.get(debugAdapterHandle);
		this._debugAdaptersTrackers.delete(debugAdapterHandle);
		if (tracker && tracker.onWillStopSession) {
			tracker.onWillStopSession();
		}

		const da = this._debugAdapters.get(debugAdapterHandle);
		this._debugAdapters.delete(debugAdapterHandle);
		if (da) {
			return da.stopSession();
		} else {
			return Promise.resolve(void 0);
		}
	}

	public $acceptBreakpointsDelta(delta: IBreakpointsDeltaDto): void {

		const a: vscode.Breakpoint[] = [];
		const r: vscode.Breakpoint[] = [];
		const c: vscode.Breakpoint[] = [];

		if (delta.added) {
			for (const bpd of delta.added) {
				const id = bpd.id;
				if (id && !this._breakpoints.has(id)) {
					let bp: vscode.Breakpoint;
					if (bpd.type === 'function') {
						bp = new FunctionBreakpoint(bpd.functionName, bpd.enabled, bpd.condition, bpd.hitCondition, bpd.logMessage);
					} else if (bpd.type === 'data') {
						bp = new DataBreakpoint(bpd.label, bpd.dataId, bpd.canPersist, bpd.enabled, bpd.hitCondition, bpd.condition, bpd.logMessage);
					} else {
						const uri = URI.revive(bpd.uri);
						bp = new SourceBreakpoint(new Location(uri, new Position(bpd.line, bpd.character)), bpd.enabled, bpd.condition, bpd.hitCondition, bpd.logMessage);
					}
					(bp as any)._id = id;
					this._breakpoints.set(id, bp);
					a.push(bp);
				}
			}
		}

		if (delta.removed) {
			for (const id of delta.removed) {
				const bp = this._breakpoints.get(id);
				if (bp) {
					this._breakpoints.delete(id);
					r.push(bp);
				}
			}
		}

		if (delta.changed) {
			for (const bpd of delta.changed) {
				if (bpd.id) {
					const bp = this._breakpoints.get(bpd.id);
					if (bp) {
						if (bp instanceof FunctionBreakpoint && bpd.type === 'function') {
							const fbp = <any>bp;
							fbp.enabled = bpd.enabled;
							fbp.condition = bpd.condition;
							fbp.hitCondition = bpd.hitCondition;
							fbp.logMessage = bpd.logMessage;
							fbp.functionName = bpd.functionName;
						} else if (bp instanceof SourceBreakpoint && bpd.type === 'source') {
							const sbp = <any>bp;
							sbp.enabled = bpd.enabled;
							sbp.condition = bpd.condition;
							sbp.hitCondition = bpd.hitCondition;
							sbp.logMessage = bpd.logMessage;
							sbp.location = new Location(URI.revive(bpd.uri), new Position(bpd.line, bpd.character));
						}
						c.push(bp);
					}
				}
			}
		}

		this.fireBreakpointChanges(a, r, c);
	}

	public $provideDebugConfigurations(configProviderHandle: number, folderUri: UriComponents | undefined, token: CancellationToken): Promise<vscode.DebugConfiguration[]> {
		return asPromise(async () => {
			const provider = this.getConfigProviderByHandle(configProviderHandle);
			if (!provider) {
				throw new Error('no DebugConfigurationProvider found');
			}
			if (!provider.provideDebugConfigurations) {
				throw new Error('DebugConfigurationProvider has no method provideDebugConfigurations');
			}
			const folder = await this.getFolder(folderUri);
			return provider.provideDebugConfigurations(folder, token);
		}).then(debugConfigurations => {
			if (!debugConfigurations) {
				throw new Error('nothing returned from DebugConfigurationProvider.provideDebugConfigurations');
			}
			return debugConfigurations;
		});
	}

	public $resolveDebugConfiguration(configProviderHandle: number, folderUri: UriComponents | undefined, debugConfiguration: vscode.DebugConfiguration, token: CancellationToken): Promise<vscode.DebugConfiguration | null | undefined> {
		return asPromise(async () => {
			const provider = this.getConfigProviderByHandle(configProviderHandle);
			if (!provider) {
				throw new Error('no DebugConfigurationProvider found');
			}
			if (!provider.resolveDebugConfiguration) {
				throw new Error('DebugConfigurationProvider has no method resolveDebugConfiguration');
			}
			const folder = await this.getFolder(folderUri);
			return provider.resolveDebugConfiguration(folder, debugConfiguration, token);
		});
	}

	public $resolveDebugConfigurationWithSubstitutedVariables(configProviderHandle: number, folderUri: UriComponents | undefined, debugConfiguration: vscode.DebugConfiguration, token: CancellationToken): Promise<vscode.DebugConfiguration | null | undefined> {
		return asPromise(async () => {
			const provider = this.getConfigProviderByHandle(configProviderHandle);
			if (!provider) {
				throw new Error('no DebugConfigurationProvider found');
			}
			if (!provider.resolveDebugConfigurationWithSubstitutedVariables) {
				throw new Error('DebugConfigurationProvider has no method resolveDebugConfigurationWithSubstitutedVariables');
			}
			const folder = await this.getFolder(folderUri);
			return provider.resolveDebugConfigurationWithSubstitutedVariables(folder, debugConfiguration, token);
		});
	}

	public async $provideDebugAdapter(adapterFactoryHandle: number, sessionDto: IDebugSessionDto): Promise<IAdapterDescriptor> {
		const adapterDescriptorFactory = this.getAdapterDescriptorFactoryByHandle(adapterFactoryHandle);
		if (!adapterDescriptorFactory) {
			return Promise.reject(new Error('no adapter descriptor factory found for handle'));
		}
		const session = await this.getSession(sessionDto);
		return this.getAdapterDescriptor(adapterDescriptorFactory, session).then(adapterDescriptor => {
			if (!adapterDescriptor) {
				throw new Error(`Couldn't find a debug adapter descriptor for debug type '${session.type}'`);
			}
			return this.convertToDto(adapterDescriptor);
		});
	}

	public async $acceptDebugSessionStarted(sessionDto: IDebugSessionDto): Promise<void> {
		const session = await this.getSession(sessionDto);
		this._onDidStartDebugSession.fire(session);
	}

	public async $acceptDebugSessionTerminated(sessionDto: IDebugSessionDto): Promise<void> {
		const session = await this.getSession(sessionDto);
		if (session) {
			this._onDidTerminateDebugSession.fire(session);
			this._debugSessions.delete(session.id);
		}
	}

	public async $acceptDebugSessionActiveChanged(sessionDto: IDebugSessionDto | undefined): Promise<void> {
		this._activeDebugSession = sessionDto ? await this.getSession(sessionDto) : undefined;
		this._onDidChangeActiveDebugSession.fire(this._activeDebugSession);
	}

	public async $acceptDebugSessionNameChanged(sessionDto: IDebugSessionDto, name: string): Promise<void> {
		const session = await this.getSession(sessionDto);
		if (session) {
			session._acceptNameChanged(name);
		}
	}

	public async $acceptDebugSessionCustomEvent(sessionDto: IDebugSessionDto, event: any): Promise<void> {
		const session = await this.getSession(sessionDto);
		const ee: vscode.DebugSessionCustomEvent = {
			session: session,
			event: event.event,
			body: event.body
		};
		this._onDidReceiveDebugSessionCustomEvent.fire(ee);
	}

	// private & dto helpers

	private convertToDto(x: vscode.DebugAdapterDescriptor): IAdapterDescriptor {

		if (x instanceof DebugAdapterExecutable) {
			return <IDebugAdapterExecutable>{
				type: 'executable',
				command: x.command,
				args: x.args,
				options: x.options
			};
		} else if (x instanceof DebugAdapterServer) {
			return <IDebugAdapterServer>{
				type: 'server',
				port: x.port,
				host: x.host
			};
		} else if (x instanceof DebugAdapterNamedPipeServer) {
			return <IDebugAdapterNamedPipeServer>{
				type: 'pipeServer',
				path: x.path
			};
		} else if (x instanceof DebugAdapterInlineImplementation) {
			return <IDebugAdapterImpl>{
				type: 'implementation',
				implementation: x.implementation
			};
		} else {
			throw new Error('convertToDto unexpected type');
		}
	}

	private getAdapterDescriptorFactoryByType(type: string): vscode.DebugAdapterDescriptorFactory | undefined {
		const results = this._adapterFactories.filter(p => p.type === type);
		if (results.length > 0) {
			return results[0].factory;
		}
		return undefined;
	}

	private getAdapterDescriptorFactoryByHandle(handle: number): vscode.DebugAdapterDescriptorFactory | undefined {
		const results = this._adapterFactories.filter(p => p.handle === handle);
		if (results.length > 0) {
			return results[0].factory;
		}
		return undefined;
	}

	private getConfigProviderByHandle(handle: number): vscode.DebugConfigurationProvider | undefined {
		const results = this._configProviders.filter(p => p.handle === handle);
		if (results.length > 0) {
			return results[0].provider;
		}
		return undefined;
	}

	private definesDebugType(ed: IExtensionDescription, type: string) {
		if (ed.contributes) {
			const debuggers = <IDebuggerContribution[]>ed.contributes['debuggers'];
			if (debuggers && debuggers.length > 0) {
				for (const dbg of debuggers) {
					// only debugger contributions with a "label" are considered a "defining" debugger contribution
					if (dbg.label && dbg.type) {
						if (dbg.type === type) {
							return true;
						}
					}
				}
			}
		}
		return false;
	}

	private getDebugAdapterTrackers(session: ExtHostDebugSession): Promise<vscode.DebugAdapterTracker | undefined> {

		const config = session.configuration;
		const type = config.type;

		const promises = this._trackerFactories
			.filter(tuple => tuple.type === type || tuple.type === '*')
			.map(tuple => asPromise<vscode.ProviderResult<vscode.DebugAdapterTracker>>(() => tuple.factory.createDebugAdapterTracker(session)).then(p => p, err => null));

		return Promise.race([
			Promise.all(promises).then(result => {
				const trackers = <vscode.DebugAdapterTracker[]>result.filter(t => !!t);	// filter null
				if (trackers.length > 0) {
					return new MultiTracker(trackers);
				}
				return undefined;
			}),
			new Promise<never>((resolve, reject) => {
				const timeout = setTimeout(() => {
					clearTimeout(timeout);
					reject(new Error('timeout'));
				}, 1000);
			})
		]).catch(err => {
			// ignore errors
			return undefined;
		});
	}

	private async getAdapterDescriptor(adapterDescriptorFactory: vscode.DebugAdapterDescriptorFactory | undefined, session: ExtHostDebugSession): Promise<vscode.DebugAdapterDescriptor | undefined> {

		// a "debugServer" attribute in the launch config takes precedence
		const serverPort = session.configuration.debugServer;
		if (typeof serverPort === 'number') {
			return Promise.resolve(new DebugAdapterServer(serverPort));
		}

		if (adapterDescriptorFactory) {
			const extensionRegistry = await this._extensionService.getExtensionRegistry();
			return asPromise(() => adapterDescriptorFactory.createDebugAdapterDescriptor(session, this.daExecutableFromPackage(session, extensionRegistry))).then(daDescriptor => {
				if (daDescriptor) {
					return daDescriptor;
				}
				return undefined;
			});
		}

		// fallback: use executable information from package.json
		const extensionRegistry = await this._extensionService.getExtensionRegistry();
		return Promise.resolve(this.daExecutableFromPackage(session, extensionRegistry));
	}

	protected daExecutableFromPackage(session: ExtHostDebugSession, extensionRegistry: ExtensionDescriptionRegistry): DebugAdapterExecutable | undefined {
		return undefined;
	}

	private startBreakpoints() {
		if (!this._breakpointEventsActive) {
			this._breakpointEventsActive = true;
			this._debugServiceProxy.$startBreakpointEvents();
		}
	}

	private fireBreakpointChanges(added: vscode.Breakpoint[], removed: vscode.Breakpoint[], changed: vscode.Breakpoint[]) {
		if (added.length > 0 || removed.length > 0 || changed.length > 0) {
			this._onDidChangeBreakpoints.fire(Object.freeze({
				added,
				removed,
				changed,
			}));
		}
	}

	private async getSession(dto: IDebugSessionDto): Promise<ExtHostDebugSession> {
		if (dto) {
			if (typeof dto === 'string') {
				const ds = this._debugSessions.get(dto);
				if (ds) {
					return ds;
				}
			} else {
				let ds = this._debugSessions.get(dto.id);
				if (!ds) {
					const folder = await this.getFolder(dto.folderUri);
					ds = new ExtHostDebugSession(this._debugServiceProxy, dto.id, dto.type, dto.name, folder, dto.configuration);
					this._debugSessions.set(ds.id, ds);
					this._debugServiceProxy.$sessionCached(ds.id);
				}
				return ds;
			}
		}
		throw new Error('cannot find session');
	}

	private getFolder(_folderUri: UriComponents | undefined): Promise<vscode.WorkspaceFolder | undefined> {
		if (_folderUri) {
			const folderURI = URI.revive(_folderUri);
			return this._workspaceService.resolveWorkspaceFolder(folderURI);
		}
		return Promise.resolve(undefined);
	}
}

export class ExtHostDebugSession implements vscode.DebugSession {

	constructor(
		private _debugServiceProxy: MainThreadDebugServiceShape,
		private _id: DebugSessionUUID,
		private _type: string,
		private _name: string,
		private _workspaceFolder: vscode.WorkspaceFolder | undefined,
		private _configuration: vscode.DebugConfiguration) {
	}

	public get id(): string {
		return this._id;
	}

	public get type(): string {
		return this._type;
	}

	public get name(): string {
		return this._name;
	}

	public set name(name: string) {
		this._name = name;
		this._debugServiceProxy.$setDebugSessionName(this._id, name);
	}

	_acceptNameChanged(name: string) {
		this._name = name;
	}

	public get workspaceFolder(): vscode.WorkspaceFolder | undefined {
		return this._workspaceFolder;
	}

	public get configuration(): vscode.DebugConfiguration {
		return this._configuration;
	}

	public customRequest(command: string, args: any): Promise<any> {
		return this._debugServiceProxy.$customDebugAdapterRequest(this._id, command, args);
	}

	public getDebugProtocolBreakpoint(breakpoint: vscode.Breakpoint): Promise<vscode.DebugProtocolBreakpoint | undefined> {
		return this._debugServiceProxy.$getDebugProtocolBreakpoint(this._id, breakpoint.id);
	}
}

export class ExtHostDebugConsole {

	readonly value: vscode.DebugConsole;

	constructor(proxy: MainThreadDebugServiceShape) {

		this.value = Object.freeze({
			append(value: string): void {
				proxy.$appendDebugConsole(value);
			},
			appendLine(value: string): void {
				this.append(value + '\n');
			}
		});
	}
}

export class ExtHostVariableResolverService extends AbstractVariableResolverService {

	constructor(folders: vscode.WorkspaceFolder[], editorService: ExtHostDocumentsAndEditors | undefined, configurationService: ExtHostConfigProvider, workspaceService?: IExtHostWorkspace) {
		super({
			getFolderUri: (folderName: string): URI | undefined => {
				const found = folders.filter(f => f.name === folderName);
				if (found && found.length > 0) {
					return found[0].uri;
				}
				return undefined;
			},
			getWorkspaceFolderCount: (): number => {
				return folders.length;
			},
			getConfigurationValue: (folderUri: URI | undefined, section: string): string | undefined => {
				return configurationService.getConfiguration(undefined, folderUri).get<string>(section);
			},
			getAppRoot: (): string | undefined => {
				return process.cwd();
			},
			getExecPath: (): string | undefined => {
				return process.env['VSCODE_EXEC_PATH'];
			},
			getFilePath: (): string | undefined => {
				if (editorService) {
					const activeEditor = editorService.activeEditor();
					if (activeEditor) {
						return path.normalize(activeEditor.document.uri.fsPath);
					}
				}
				return undefined;
			},
			getWorkspaceFolderPathForFile: (): string | undefined => {
				if (editorService && workspaceService) {
					const activeEditor = editorService.activeEditor();
					if (activeEditor) {
						const ws = workspaceService.getWorkspaceFolder(activeEditor.document.uri);
						if (ws) {
							return path.normalize(ws.uri.fsPath);
						}
					}
				}
				return undefined;
			},
			getSelectedText: (): string | undefined => {
				if (editorService) {
					const activeEditor = editorService.activeEditor();
					if (activeEditor && !activeEditor.selection.isEmpty) {
						return activeEditor.document.getText(activeEditor.selection);
					}
				}
				return undefined;
			},
			getLineNumber: (): string | undefined => {
				if (editorService) {
					const activeEditor = editorService.activeEditor();
					if (activeEditor) {
						return String(activeEditor.selection.end.line + 1);
					}
				}
				return undefined;
			}
		}, undefined, Promise.resolve(process.env));
	}
}

interface ConfigProviderTuple {
	type: string;
	handle: number;
	provider: vscode.DebugConfigurationProvider;
}

interface DescriptorFactoryTuple {
	type: string;
	handle: number;
	factory: vscode.DebugAdapterDescriptorFactory;
}

interface TrackerFactoryTuple {
	type: string;
	handle: number;
	factory: vscode.DebugAdapterTrackerFactory;
}

class MultiTracker implements vscode.DebugAdapterTracker {

	constructor(private trackers: vscode.DebugAdapterTracker[]) {
	}

	onWillStartSession(): void {
		this.trackers.forEach(t => t.onWillStartSession ? t.onWillStartSession() : undefined);
	}

	onWillReceiveMessage(message: any): void {
		this.trackers.forEach(t => t.onWillReceiveMessage ? t.onWillReceiveMessage(message) : undefined);
	}

	onDidSendMessage(message: any): void {
		this.trackers.forEach(t => t.onDidSendMessage ? t.onDidSendMessage(message) : undefined);
	}

	onWillStopSession(): void {
		this.trackers.forEach(t => t.onWillStopSession ? t.onWillStopSession() : undefined);
	}

	onError(error: Error): void {
		this.trackers.forEach(t => t.onError ? t.onError(error) : undefined);
	}

	onExit(code: number, signal: string): void {
		this.trackers.forEach(t => t.onExit ? t.onExit(code, signal) : undefined);
	}
}

/*
 * Call directly into a debug adapter implementation
 */
class DirectDebugAdapter extends AbstractDebugAdapter {

	constructor(private implementation: vscode.DebugAdapter) {
		super();

		implementation.onDidSendMessage((message: vscode.DebugProtocolMessage) => {
			this.acceptMessage(message as DebugProtocol.ProtocolMessage);
		});
	}

	startSession(): Promise<void> {
		return Promise.resolve(undefined);
	}

	sendMessage(message: DebugProtocol.ProtocolMessage): void {
		this.implementation.handleMessage(message);
	}

	stopSession(): Promise<void> {
		this.implementation.dispose();
		return Promise.resolve(undefined);
	}
}


export class WorkerExtHostDebugService extends ExtHostDebugServiceBase {
	constructor(
		@IExtHostRpcService extHostRpcService: IExtHostRpcService,
		@IExtHostWorkspace workspaceService: IExtHostWorkspace,
		@IExtHostExtensionService extensionService: IExtHostExtensionService,
		@IExtHostDocumentsAndEditors editorsService: IExtHostDocumentsAndEditors,
		@IExtHostConfiguration configurationService: IExtHostConfiguration
	) {
		super(extHostRpcService, workspaceService, extensionService, editorsService, configurationService);
	}

	protected createVariableResolver(folders: vscode.WorkspaceFolder[], editorService: ExtHostDocumentsAndEditors, configurationService: ExtHostConfigProvider): AbstractVariableResolverService {
		return new ExtHostVariableResolverService(folders, editorService, configurationService);
	}
}
