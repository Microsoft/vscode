/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Event, Emitter } from 'vs/base/common/event';
import { ExtHostTerminalServiceShape, MainContext, MainThreadTerminalServiceShape, ITerminalDimensionsDto, ITerminalLinkDto, TerminalIdentifier, IShellAndArgsDto } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostConfigProvider } from 'vs/workbench/api/common/extHostConfiguration';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { Disposable as VSCodeDisposable, EnvironmentVariableMutatorType } from './extHostTypes';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { localize } from 'vs/nls';
import { NotSupportedError } from 'vs/base/common/errors';
import { serializeEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableShared';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { generateUuid } from 'vs/base/common/uuid';
import { ISerializableEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { IShellLaunchConfigDto, ITerminalChildProcess, ITerminalDimensionsOverride, ITerminalEnvironment, ITerminalLaunchError, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { TerminalDataBufferer } from 'vs/platform/terminal/common/terminalDataBuffering';
import { ITerminalProfile } from 'vs/workbench/contrib/terminal/common/terminal';

export interface IExtHostTerminalService extends ExtHostTerminalServiceShape, IDisposable {

	readonly _serviceBrand: undefined;

	activeTerminal: vscode.Terminal | undefined;
	terminals: vscode.Terminal[];

	onDidCloseTerminal: Event<vscode.Terminal>;
	onDidOpenTerminal: Event<vscode.Terminal>;
	onDidChangeActiveTerminal: Event<vscode.Terminal | undefined>;
	onDidChangeTerminalDimensions: Event<vscode.TerminalDimensionsChangeEvent>;
	onDidWriteTerminalData: Event<vscode.TerminalDataWriteEvent>;

	createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal;
	createTerminalFromOptions(options: vscode.TerminalOptions, isFeatureTerminal?: boolean): vscode.Terminal;
	createExtensionTerminal(options: vscode.ExtensionTerminalOptions): vscode.Terminal;
	attachPtyToTerminal(id: number, pty: vscode.Pseudoterminal): void;
	getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string;
	getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string;
	registerLinkProvider(provider: vscode.TerminalLinkProvider): vscode.Disposable;
	getEnvironmentVariableCollection(extension: IExtensionDescription, persistent?: boolean): vscode.EnvironmentVariableCollection;
	getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto>;
}

export const IExtHostTerminalService = createDecorator<IExtHostTerminalService>('IExtHostTerminalService');

export class ExtHostTerminal {
	private _disposed: boolean = false;
	private _pidPromise: Promise<number | undefined>;
	private _cols: number | undefined;
	private _pidPromiseComplete: ((value: number | undefined) => any) | undefined;
	private _rows: number | undefined;
	private _exitStatus: vscode.TerminalExitStatus | undefined;

	public isOpen: boolean = false;

	readonly value: vscode.Terminal;

	constructor(
		private _proxy: MainThreadTerminalServiceShape,
		public _id: TerminalIdentifier,
		private readonly _creationOptions: vscode.TerminalOptions | vscode.ExtensionTerminalOptions,
		private _name?: string,
	) {
		this._creationOptions = Object.freeze(this._creationOptions);
		this._pidPromise = new Promise<number | undefined>(c => this._pidPromiseComplete = c);

		const that = this;
		this.value = {
			get name(): string {
				return that._name || '';
			},
			get processId(): Promise<number | undefined> {
				return that._pidPromise;
			},
			get creationOptions(): Readonly<vscode.TerminalOptions | vscode.ExtensionTerminalOptions> {
				return that._creationOptions;
			},
			get exitStatus(): vscode.TerminalExitStatus | undefined {
				return that._exitStatus;
			},
			sendText(text: string, addNewLine: boolean = true): void {
				that._checkDisposed();
				that._proxy.$sendText(that._id, text, addNewLine);
			},
			show(preserveFocus: boolean): void {
				that._checkDisposed();
				that._proxy.$show(that._id, preserveFocus);
			},
			hide(): void {
				that._checkDisposed();
				that._proxy.$hide(that._id);
			},
			dispose(): void {
				if (!that._disposed) {
					that._disposed = true;
					that._proxy.$dispose(that._id);
				}
			},
			get dimensions(): vscode.TerminalDimensions | undefined {
				if (that._cols === undefined || that._rows === undefined) {
					return undefined;
				}
				return {
					columns: that._cols,
					rows: that._rows
				};
			}
		};
	}

	public async create(
		shellPath?: string,
		shellArgs?: string[] | string,
		cwd?: string | URI,
		env?: ITerminalEnvironment,
		icon?: string,
		initialText?: string,
		waitOnExit?: boolean,
		strictEnv?: boolean,
		hideFromUser?: boolean,
		isFeatureTerminal?: boolean,
		isExtensionOwnedTerminal?: boolean
	): Promise<void> {
		if (typeof this._id !== 'string') {
			throw new Error('Terminal has already been created');
		}
		await this._proxy.$createTerminal(this._id, { name: this._name, shellPath, shellArgs, cwd, env, icon, initialText, waitOnExit, strictEnv, hideFromUser, isFeatureTerminal, isExtensionOwnedTerminal });
	}

	public async createExtensionTerminal(): Promise<number> {
		if (typeof this._id !== 'string') {
			throw new Error('Terminal has already been created');
		}
		await this._proxy.$createTerminal(this._id, { name: this._name, isExtensionCustomPtyTerminal: true });
		// At this point, the id has been set via `$acceptTerminalOpened`
		if (typeof this._id === 'string') {
			throw new Error('Terminal creation failed');
		}
		return this._id;
	}

	private _checkDisposed() {
		if (this._disposed) {
			throw new Error('Terminal has already been disposed');
		}
	}

	public set name(name: string) {
		this._name = name;
	}

	public setExitCode(code: number | undefined) {
		this._exitStatus = Object.freeze({ code });
	}

	public setDimensions(cols: number, rows: number): boolean {
		if (cols === this._cols && rows === this._rows) {
			// Nothing changed
			return false;
		}
		if (cols === 0 || rows === 0) {
			return false;
		}
		this._cols = cols;
		this._rows = rows;
		return true;
	}

	public _setProcessId(processId: number | undefined): void {
		// The event may fire 2 times when the panel is restored
		if (this._pidPromiseComplete) {
			this._pidPromiseComplete(processId);
			this._pidPromiseComplete = undefined;
		} else {
			// Recreate the promise if this is the nth processId set (e.g. reused task terminals)
			this._pidPromise.then(pid => {
				if (pid !== processId) {
					this._pidPromise = Promise.resolve(processId);
				}
			});
		}
	}
}

export class ExtHostPseudoterminal implements ITerminalChildProcess {
	readonly id = 0;
	readonly shouldPersist = false;

	private readonly _onProcessData = new Emitter<string>();
	public readonly onProcessData: Event<string> = this._onProcessData.event;
	private readonly _onProcessExit = new Emitter<number | undefined>();
	public readonly onProcessExit: Event<number | undefined> = this._onProcessExit.event;
	private readonly _onProcessReady = new Emitter<{ pid: number, cwd: string }>();
	public get onProcessReady(): Event<{ pid: number, cwd: string }> { return this._onProcessReady.event; }
	private readonly _onProcessTitleChanged = new Emitter<string>();
	public readonly onProcessTitleChanged: Event<string> = this._onProcessTitleChanged.event;
	private readonly _onProcessOverrideDimensions = new Emitter<ITerminalDimensionsOverride | undefined>();
	public get onProcessOverrideDimensions(): Event<ITerminalDimensionsOverride | undefined> { return this._onProcessOverrideDimensions.event; }
	private readonly _onProcessShellTypeChanged = new Emitter<TerminalShellType>();
	public readonly onProcessShellTypeChanged = this._onProcessShellTypeChanged.event;


	constructor(private readonly _pty: vscode.Pseudoterminal) { }

	async start(): Promise<undefined> {
		return undefined;
	}

	shutdown(): void {
		this._pty.close();
	}

	input(data: string): void {
		if (this._pty.handleInput) {
			this._pty.handleInput(data);
		}
	}

	resize(cols: number, rows: number): void {
		if (this._pty.setDimensions) {
			this._pty.setDimensions({ columns: cols, rows });
		}
	}

	async processBinary(data: string): Promise<void> {
		// No-op, processBinary is not supported in extextion owned terminals.
	}

	acknowledgeDataEvent(charCount: number): void {
		// No-op, flow control is not supported in extension owned terminals. If this is ever
		// implemented it will need new pause and resume VS Code APIs.
	}

	getInitialCwd(): Promise<string> {
		return Promise.resolve('');
	}

	getCwd(): Promise<string> {
		return Promise.resolve('');
	}

	getLatency(): Promise<number> {
		return Promise.resolve(0);
	}

	startSendingEvents(initialDimensions: ITerminalDimensionsDto | undefined): void {
		// Attach the listeners
		this._pty.onDidWrite(e => this._onProcessData.fire(e));
		if (this._pty.onDidClose) {
			this._pty.onDidClose((e: number | void = undefined) => {
				this._onProcessExit.fire(e === void 0 ? undefined : e);
			});
		}
		if (this._pty.onDidOverrideDimensions) {
			this._pty.onDidOverrideDimensions(e => this._onProcessOverrideDimensions.fire(e ? { cols: e.columns, rows: e.rows } : e));
		}
		if (this._pty.onDidChangeName) {
			this._pty.onDidChangeName(title => this._onProcessTitleChanged.fire(title));
		}

		this._pty.open(initialDimensions ? initialDimensions : undefined);

		if (this._pty.setDimensions && initialDimensions) {
			this._pty.setDimensions(initialDimensions);
		}

		this._onProcessReady.fire({ pid: -1, cwd: '' });
	}
}

let nextLinkId = 1;

interface ICachedLinkEntry {
	provider: vscode.TerminalLinkProvider;
	link: vscode.TerminalLink;
}

export abstract class BaseExtHostTerminalService extends Disposable implements IExtHostTerminalService, ExtHostTerminalServiceShape {

	readonly _serviceBrand: undefined;

	protected _proxy: MainThreadTerminalServiceShape;
	protected _activeTerminal: ExtHostTerminal | undefined;
	protected _terminals: ExtHostTerminal[] = [];
	protected _terminalProcesses: Map<number, ITerminalChildProcess> = new Map();
	protected _terminalProcessDisposables: { [id: number]: IDisposable } = {};
	protected _extensionTerminalAwaitingStart: { [id: number]: { initialDimensions: ITerminalDimensionsDto | undefined } | undefined } = {};
	protected _getTerminalPromises: { [id: number]: Promise<ExtHostTerminal | undefined> } = {};
	protected _environmentVariableCollections: Map<string, EnvironmentVariableCollection> = new Map();

	private readonly _bufferer: TerminalDataBufferer;
	private readonly _linkProviders: Set<vscode.TerminalLinkProvider> = new Set();
	private readonly _terminalLinkCache: Map<number, Map<number, ICachedLinkEntry>> = new Map();
	private readonly _terminalLinkCancellationSource: Map<number, CancellationTokenSource> = new Map();

	public get activeTerminal(): vscode.Terminal | undefined { return this._activeTerminal?.value; }
	public get terminals(): vscode.Terminal[] { return this._terminals.map(term => term.value); }

	protected readonly _onDidCloseTerminal: Emitter<vscode.Terminal> = new Emitter<vscode.Terminal>();
	public get onDidCloseTerminal(): Event<vscode.Terminal> { return this._onDidCloseTerminal && this._onDidCloseTerminal.event; }
	protected readonly _onDidOpenTerminal: Emitter<vscode.Terminal> = new Emitter<vscode.Terminal>();
	public get onDidOpenTerminal(): Event<vscode.Terminal> { return this._onDidOpenTerminal && this._onDidOpenTerminal.event; }
	protected readonly _onDidChangeActiveTerminal: Emitter<vscode.Terminal | undefined> = new Emitter<vscode.Terminal | undefined>();
	public get onDidChangeActiveTerminal(): Event<vscode.Terminal | undefined> { return this._onDidChangeActiveTerminal && this._onDidChangeActiveTerminal.event; }
	protected readonly _onDidChangeTerminalDimensions: Emitter<vscode.TerminalDimensionsChangeEvent> = new Emitter<vscode.TerminalDimensionsChangeEvent>();
	public get onDidChangeTerminalDimensions(): Event<vscode.TerminalDimensionsChangeEvent> { return this._onDidChangeTerminalDimensions && this._onDidChangeTerminalDimensions.event; }
	protected readonly _onDidWriteTerminalData: Emitter<vscode.TerminalDataWriteEvent>;
	public get onDidWriteTerminalData(): Event<vscode.TerminalDataWriteEvent> { return this._onDidWriteTerminalData && this._onDidWriteTerminalData.event; }

	constructor(
		supportsProcesses: boolean,
		@IExtHostRpcService extHostRpc: IExtHostRpcService
	) {
		super();
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadTerminalService);
		this._bufferer = new TerminalDataBufferer(this._proxy.$sendProcessData);
		this._onDidWriteTerminalData = new Emitter<vscode.TerminalDataWriteEvent>({
			onFirstListenerAdd: () => this._proxy.$startSendingDataEvents(),
			onLastListenerRemove: () => this._proxy.$stopSendingDataEvents()
		});
		this._proxy.$registerProcessSupport(supportsProcesses);
		this._register({
			dispose: () => {
				for (const [_, terminalProcess] of this._terminalProcesses) {
					terminalProcess.shutdown(true);
				}
			}
		});
	}

	public abstract createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal;
	public abstract createTerminalFromOptions(options: vscode.TerminalOptions): vscode.Terminal;
	public abstract getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string;
	public abstract getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string;
	public abstract getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto>;
	public abstract $getAvailableProfiles(configuredProfilesOnly: boolean): Promise<ITerminalProfile[]>;

	public createExtensionTerminal(options: vscode.ExtensionTerminalOptions): vscode.Terminal {
		const terminal = new ExtHostTerminal(this._proxy, generateUuid(), options, options.name);
		const p = new ExtHostPseudoterminal(options.pty);
		terminal.createExtensionTerminal().then(id => {
			const disposable = this._setupExtHostProcessListeners(id, p);
			this._terminalProcessDisposables[id] = disposable;
		});
		this._terminals.push(terminal);
		return terminal.value;
	}

	public attachPtyToTerminal(id: number, pty: vscode.Pseudoterminal): void {
		const terminal = this._getTerminalById(id);
		if (!terminal) {
			throw new Error(`Cannot resolve terminal with id ${id} for virtual process`);
		}
		const p = new ExtHostPseudoterminal(pty);
		const disposable = this._setupExtHostProcessListeners(id, p);
		this._terminalProcessDisposables[id] = disposable;
	}

	public async $acceptActiveTerminalChanged(id: number | null): Promise<void> {
		const original = this._activeTerminal;
		if (id === null) {
			this._activeTerminal = undefined;
			if (original !== this._activeTerminal) {
				this._onDidChangeActiveTerminal.fire(this._activeTerminal);
			}
			return;
		}
		const terminal = this._getTerminalById(id);
		if (terminal) {
			this._activeTerminal = terminal;
			if (original !== this._activeTerminal) {
				this._onDidChangeActiveTerminal.fire(this._activeTerminal.value);
			}
		}
	}

	public async $acceptTerminalProcessData(id: number, data: string): Promise<void> {
		const terminal = this._getTerminalById(id);
		if (terminal) {
			this._onDidWriteTerminalData.fire({ terminal: terminal.value, data });
		}
	}

	public async $acceptTerminalDimensions(id: number, cols: number, rows: number): Promise<void> {
		const terminal = this._getTerminalById(id);
		if (terminal) {
			if (terminal.setDimensions(cols, rows)) {
				this._onDidChangeTerminalDimensions.fire({
					terminal: terminal.value,
					dimensions: terminal.value.dimensions as vscode.TerminalDimensions
				});
			}
		}
	}

	public async $acceptTerminalMaximumDimensions(id: number, cols: number, rows: number): Promise<void> {
		// Extension pty terminal only - when virtual process resize fires it means that the
		// terminal's maximum dimensions changed
		this._terminalProcesses.get(id)?.resize(cols, rows);
	}

	public async $acceptTerminalTitleChange(id: number, name: string): Promise<void> {
		const terminal = this._getTerminalById(id);
		if (terminal) {
			terminal.name = name;
		}
	}

	public async $acceptTerminalClosed(id: number, exitCode: number | undefined): Promise<void> {
		const index = this._getTerminalObjectIndexById(this._terminals, id);
		if (index !== null) {
			const terminal = this._terminals.splice(index, 1)[0];
			terminal.setExitCode(exitCode);
			this._onDidCloseTerminal.fire(terminal.value);
		}
	}

	public $acceptTerminalOpened(id: number, extHostTerminalId: string | undefined, name: string, shellLaunchConfigDto: IShellLaunchConfigDto): void {
		if (extHostTerminalId) {
			// Resolve with the renderer generated id
			const index = this._getTerminalObjectIndexById(this._terminals, extHostTerminalId);
			if (index !== null) {
				// The terminal has already been created (via createTerminal*), only fire the event
				this._terminals[index]._id = id;
				this._onDidOpenTerminal.fire(this.terminals[index]);
				this._terminals[index].isOpen = true;
				return;
			}
		}

		const creationOptions: vscode.TerminalOptions = {
			name: shellLaunchConfigDto.name,
			shellPath: shellLaunchConfigDto.executable,
			shellArgs: shellLaunchConfigDto.args,
			cwd: typeof shellLaunchConfigDto.cwd === 'string' ? shellLaunchConfigDto.cwd : URI.revive(shellLaunchConfigDto.cwd),
			env: shellLaunchConfigDto.env,
			hideFromUser: shellLaunchConfigDto.hideFromUser
		};
		const terminal = new ExtHostTerminal(this._proxy, id, creationOptions, name);
		this._terminals.push(terminal);
		this._onDidOpenTerminal.fire(terminal.value);
		terminal.isOpen = true;
	}

	public async $acceptTerminalProcessId(id: number, processId: number): Promise<void> {
		const terminal = this._getTerminalById(id);
		if (terminal) {
			terminal._setProcessId(processId);
		}
	}

	public async $startExtensionTerminal(id: number, initialDimensions: ITerminalDimensionsDto | undefined): Promise<ITerminalLaunchError | undefined> {
		// Make sure the ExtHostTerminal exists so onDidOpenTerminal has fired before we call
		// Pseudoterminal.start
		const terminal = this._getTerminalById(id);
		if (!terminal) {
			return { message: localize('launchFail.idMissingOnExtHost', "Could not find the terminal with id {0} on the extension host", id) };
		}

		// Wait for onDidOpenTerminal to fire
		if (!terminal.isOpen) {
			await new Promise<void>(r => {
				// Ensure open is called after onDidOpenTerminal
				const listener = this.onDidOpenTerminal(async e => {
					if (e === terminal.value) {
						listener.dispose();
						r();
					}
				});
			});
		}

		const terminalProcess = this._terminalProcesses.get(id);
		if (terminalProcess) {
			(terminalProcess as ExtHostPseudoterminal).startSendingEvents(initialDimensions);
		} else {
			// Defer startSendingEvents call to when _setupExtHostProcessListeners is called
			this._extensionTerminalAwaitingStart[id] = { initialDimensions };
		}

		return undefined;
	}

	protected _setupExtHostProcessListeners(id: number, p: ITerminalChildProcess): IDisposable {
		const disposables = new DisposableStore();

		disposables.add(p.onProcessReady((e: { pid: number, cwd: string }) => this._proxy.$sendProcessReady(id, e.pid, e.cwd)));
		disposables.add(p.onProcessTitleChanged(title => this._proxy.$sendProcessTitle(id, title)));

		// Buffer data events to reduce the amount of messages going to the renderer
		this._bufferer.startBuffering(id, p.onProcessData);
		disposables.add(p.onProcessExit(exitCode => this._onProcessExit(id, exitCode)));

		if (p.onProcessOverrideDimensions) {
			disposables.add(p.onProcessOverrideDimensions(e => this._proxy.$sendOverrideDimensions(id, e)));
		}
		this._terminalProcesses.set(id, p);

		const awaitingStart = this._extensionTerminalAwaitingStart[id];
		if (awaitingStart && p instanceof ExtHostPseudoterminal) {
			p.startSendingEvents(awaitingStart.initialDimensions);
			delete this._extensionTerminalAwaitingStart[id];
		}

		return disposables;
	}

	public $acceptProcessAckDataEvent(id: number, charCount: number): void {
		this._terminalProcesses.get(id)?.acknowledgeDataEvent(charCount);
	}

	public $acceptProcessInput(id: number, data: string): void {
		this._terminalProcesses.get(id)?.input(data);
	}

	public $acceptProcessResize(id: number, cols: number, rows: number): void {
		try {
			this._terminalProcesses.get(id)?.resize(cols, rows);
		} catch (error) {
			// We tried to write to a closed pipe / channel.
			if (error.code !== 'EPIPE' && error.code !== 'ERR_IPC_CHANNEL_CLOSED') {
				throw (error);
			}
		}
	}

	public $acceptProcessShutdown(id: number, immediate: boolean): void {
		this._terminalProcesses.get(id)?.shutdown(immediate);
	}

	public $acceptProcessRequestInitialCwd(id: number): void {
		this._terminalProcesses.get(id)?.getInitialCwd().then(initialCwd => this._proxy.$sendProcessInitialCwd(id, initialCwd));
	}

	public $acceptProcessRequestCwd(id: number): void {
		this._terminalProcesses.get(id)?.getCwd().then(cwd => this._proxy.$sendProcessCwd(id, cwd));
	}

	public $acceptProcessRequestLatency(id: number): number {
		return id;
	}

	public registerLinkProvider(provider: vscode.TerminalLinkProvider): vscode.Disposable {
		this._linkProviders.add(provider);
		if (this._linkProviders.size === 1) {
			this._proxy.$startLinkProvider();
		}
		return new VSCodeDisposable(() => {
			this._linkProviders.delete(provider);
			if (this._linkProviders.size === 0) {
				this._proxy.$stopLinkProvider();
			}
		});
	}

	public async $provideLinks(terminalId: number, line: string): Promise<ITerminalLinkDto[]> {
		const terminal = this._getTerminalById(terminalId);
		if (!terminal) {
			return [];
		}

		// Discard any cached links the terminal has been holding, currently all links are released
		// when new links are provided.
		this._terminalLinkCache.delete(terminalId);

		const oldToken = this._terminalLinkCancellationSource.get(terminalId);
		if (oldToken) {
			oldToken.dispose(true);
		}
		const cancellationSource = new CancellationTokenSource();
		this._terminalLinkCancellationSource.set(terminalId, cancellationSource);

		const result: ITerminalLinkDto[] = [];
		const context: vscode.TerminalLinkContext = { terminal: terminal.value, line };
		const promises: vscode.ProviderResult<{ provider: vscode.TerminalLinkProvider, links: vscode.TerminalLink[] }>[] = [];

		for (const provider of this._linkProviders) {
			promises.push(new Promise(async r => {
				cancellationSource.token.onCancellationRequested(() => r({ provider, links: [] }));
				const links = (await provider.provideTerminalLinks(context, cancellationSource.token)) || [];
				if (!cancellationSource.token.isCancellationRequested) {
					r({ provider, links });
				}
			}));
		}

		const provideResults = await Promise.all(promises);

		if (cancellationSource.token.isCancellationRequested) {
			return [];
		}

		const cacheLinkMap = new Map<number, ICachedLinkEntry>();
		for (const provideResult of provideResults) {
			if (provideResult && provideResult.links.length > 0) {
				result.push(...provideResult.links.map(providerLink => {
					const link = {
						id: nextLinkId++,
						startIndex: providerLink.startIndex,
						length: providerLink.length,
						label: providerLink.tooltip
					};
					cacheLinkMap.set(link.id, {
						provider: provideResult.provider,
						link: providerLink
					});
					return link;
				}));
			}
		}

		this._terminalLinkCache.set(terminalId, cacheLinkMap);

		return result;
	}

	$activateLink(terminalId: number, linkId: number): void {
		const cachedLink = this._terminalLinkCache.get(terminalId)?.get(linkId);
		if (!cachedLink) {
			return;
		}
		cachedLink.provider.handleTerminalLink(cachedLink.link);
	}

	private _onProcessExit(id: number, exitCode: number | undefined): void {
		this._bufferer.stopBuffering(id);

		// Remove process reference
		this._terminalProcesses.delete(id);
		delete this._extensionTerminalAwaitingStart[id];

		// Clean up process disposables
		const processDiposable = this._terminalProcessDisposables[id];
		if (processDiposable) {
			processDiposable.dispose();
			delete this._terminalProcessDisposables[id];
		}

		// Send exit event to main side
		this._proxy.$sendProcessExit(id, exitCode);
	}

	private _getTerminalById(id: number): ExtHostTerminal | null {
		return this._getTerminalObjectById(this._terminals, id);
	}

	private _getTerminalObjectById<T extends ExtHostTerminal>(array: T[], id: number): T | null {
		const index = this._getTerminalObjectIndexById(array, id);
		return index !== null ? array[index] : null;
	}

	private _getTerminalObjectIndexById<T extends ExtHostTerminal>(array: T[], id: TerminalIdentifier): number | null {
		let index: number | null = null;
		array.some((item, i) => {
			const thisId = item._id;
			if (thisId === id) {
				index = i;
				return true;
			}
			return false;
		});
		return index;
	}

	public getEnvironmentVariableCollection(extension: IExtensionDescription): vscode.EnvironmentVariableCollection {
		let collection = this._environmentVariableCollections.get(extension.identifier.value);
		if (!collection) {
			collection = new EnvironmentVariableCollection();
			this._setEnvironmentVariableCollection(extension.identifier.value, collection);
		}
		return collection;
	}

	private _syncEnvironmentVariableCollection(extensionIdentifier: string, collection: EnvironmentVariableCollection): void {
		const serialized = serializeEnvironmentVariableCollection(collection.map);
		this._proxy.$setEnvironmentVariableCollection(extensionIdentifier, collection.persistent, serialized.length === 0 ? undefined : serialized);
	}

	public $initEnvironmentVariableCollections(collections: [string, ISerializableEnvironmentVariableCollection][]): void {
		collections.forEach(entry => {
			const extensionIdentifier = entry[0];
			const collection = new EnvironmentVariableCollection(entry[1]);
			this._setEnvironmentVariableCollection(extensionIdentifier, collection);
		});
	}

	private _setEnvironmentVariableCollection(extensionIdentifier: string, collection: EnvironmentVariableCollection): void {
		this._environmentVariableCollections.set(extensionIdentifier, collection);
		collection.onDidChangeCollection(() => {
			// When any collection value changes send this immediately, this is done to ensure
			// following calls to createTerminal will be created with the new environment. It will
			// result in more noise by sending multiple updates when called but collections are
			// expected to be small.
			this._syncEnvironmentVariableCollection(extensionIdentifier, collection!);
		});
	}
}

export class EnvironmentVariableCollection implements vscode.EnvironmentVariableCollection {
	readonly map: Map<string, vscode.EnvironmentVariableMutator> = new Map();
	private _persistent: boolean = true;

	public get persistent(): boolean { return this._persistent; }
	public set persistent(value: boolean) {
		this._persistent = value;
		this._onDidChangeCollection.fire();
	}

	protected readonly _onDidChangeCollection: Emitter<void> = new Emitter<void>();
	get onDidChangeCollection(): Event<void> { return this._onDidChangeCollection && this._onDidChangeCollection.event; }

	constructor(
		serialized?: ISerializableEnvironmentVariableCollection
	) {
		this.map = new Map(serialized);
	}

	get size(): number {
		return this.map.size;
	}

	replace(variable: string, value: string): void {
		this._setIfDiffers(variable, { value, type: EnvironmentVariableMutatorType.Replace });
	}

	append(variable: string, value: string): void {
		this._setIfDiffers(variable, { value, type: EnvironmentVariableMutatorType.Append });
	}

	prepend(variable: string, value: string): void {
		this._setIfDiffers(variable, { value, type: EnvironmentVariableMutatorType.Prepend });
	}

	private _setIfDiffers(variable: string, mutator: vscode.EnvironmentVariableMutator): void {
		const current = this.map.get(variable);
		if (!current || current.value !== mutator.value || current.type !== mutator.type) {
			this.map.set(variable, mutator);
			this._onDidChangeCollection.fire();
		}
	}

	get(variable: string): vscode.EnvironmentVariableMutator | undefined {
		return this.map.get(variable);
	}

	forEach(callback: (variable: string, mutator: vscode.EnvironmentVariableMutator, collection: vscode.EnvironmentVariableCollection) => any, thisArg?: any): void {
		this.map.forEach((value, key) => callback.call(thisArg, key, value, this));
	}

	delete(variable: string): void {
		this.map.delete(variable);
		this._onDidChangeCollection.fire();
	}

	clear(): void {
		this.map.clear();
		this._onDidChangeCollection.fire();
	}
}

export class WorkerExtHostTerminalService extends BaseExtHostTerminalService {
	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService
	) {
		super(false, extHostRpc);
	}

	public createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal {
		throw new NotSupportedError();
	}

	public createTerminalFromOptions(options: vscode.TerminalOptions): vscode.Terminal {
		throw new NotSupportedError();
	}

	public getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string {
		throw new NotSupportedError();
	}

	public getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string {
		throw new NotSupportedError();
	}

	public async getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto> {
		throw new NotSupportedError();
	}

	public $getAvailableProfiles(configuredProfilesOnly: boolean): Promise<ITerminalProfile[]> {
		throw new NotSupportedError();
	}
}
