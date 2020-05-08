/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { Event, Emitter } from 'vs/base/common/event';
import { ExtHostTerminalServiceShape, MainContext, MainThreadTerminalServiceShape, IShellLaunchConfigDto, IShellDefinitionDto, IShellAndArgsDto, ITerminalDimensionsDto } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostConfigProvider } from 'vs/workbench/api/common/extHostConfiguration';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ITerminalChildProcess, ITerminalDimensions, EXT_HOST_CREATION_DELAY } from 'vs/workbench/contrib/terminal/common/terminal';
import { timeout } from 'vs/base/common/async';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { TerminalDataBufferer } from 'vs/workbench/contrib/terminal/common/terminalDataBuffering';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Disposable as VSCodeDisposable, EnvironmentVariableMutatorType } from './extHostTypes';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ISerializableEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';

export interface IExtHostTerminalService extends ExtHostTerminalServiceShape {

	_serviceBrand: undefined;

	activeTerminal: vscode.Terminal | undefined;
	terminals: vscode.Terminal[];

	onDidCloseTerminal: Event<vscode.Terminal>;
	onDidOpenTerminal: Event<vscode.Terminal>;
	onDidChangeActiveTerminal: Event<vscode.Terminal | undefined>;
	onDidChangeTerminalDimensions: Event<vscode.TerminalDimensionsChangeEvent>;
	onDidWriteTerminalData: Event<vscode.TerminalDataWriteEvent>;

	createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal;
	createTerminalFromOptions(options: vscode.TerminalOptions): vscode.Terminal;
	createExtensionTerminal(options: vscode.ExtensionTerminalOptions): vscode.Terminal;
	attachPtyToTerminal(id: number, pty: vscode.Pseudoterminal): void;
	getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string;
	getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string;
	registerLinkHandler(handler: vscode.TerminalLinkHandler): vscode.Disposable;
	getEnvironmentVariableCollection(extension: IExtensionDescription, persistent?: boolean): vscode.EnvironmentVariableCollection;
}

export const IExtHostTerminalService = createDecorator<IExtHostTerminalService>('IExtHostTerminalService');

export class BaseExtHostTerminal {
	public _id: number | undefined;
	protected _idPromise: Promise<number>;
	private _idPromiseComplete: ((value: number) => any) | undefined;
	private _disposed: boolean = false;
	private _queuedRequests: ApiRequest[] = [];

	constructor(
		protected _proxy: MainThreadTerminalServiceShape,
		id?: number
	) {
		this._idPromise = new Promise<number>(c => {
			if (id !== undefined) {
				this._id = id;
				c(id);
			} else {
				this._idPromiseComplete = c;
			}
		});
	}

	public dispose(): void {
		if (!this._disposed) {
			this._disposed = true;
			this._queueApiRequest(this._proxy.$dispose, []);
		}
	}

	protected _checkDisposed() {
		if (this._disposed) {
			throw new Error('Terminal has already been disposed');
		}
	}

	protected _queueApiRequest(callback: (...args: any[]) => void, args: any[]): void {
		const request: ApiRequest = new ApiRequest(callback, args);
		if (!this._id) {
			this._queuedRequests.push(request);
			return;
		}
		request.run(this._proxy, this._id);
	}

	public _runQueuedRequests(id: number): void {
		this._id = id;
		if (this._idPromiseComplete) {
			this._idPromiseComplete(id);
			this._idPromiseComplete = undefined;
		}
		this._queuedRequests.forEach((r) => {
			r.run(this._proxy, id);
		});
		this._queuedRequests.length = 0;
	}
}

export class ExtHostTerminal extends BaseExtHostTerminal implements vscode.Terminal {
	private _pidPromise: Promise<number | undefined>;
	private _cols: number | undefined;
	private _pidPromiseComplete: ((value: number | undefined) => any) | undefined;
	private _rows: number | undefined;
	private _exitStatus: vscode.TerminalExitStatus | undefined;

	public isOpen: boolean = false;

	constructor(
		proxy: MainThreadTerminalServiceShape,
		private readonly _creationOptions: vscode.TerminalOptions | vscode.ExtensionTerminalOptions,
		private _name?: string,
		id?: number
	) {
		super(proxy, id);
		this._creationOptions = Object.freeze(this._creationOptions);
		this._pidPromise = new Promise<number>(c => this._pidPromiseComplete = c);
	}

	public async create(
		shellPath?: string,
		shellArgs?: string[] | string,
		cwd?: string | URI,
		env?: { [key: string]: string | null },
		waitOnExit?: boolean,
		strictEnv?: boolean,
		hideFromUser?: boolean
	): Promise<void> {
		const result = await this._proxy.$createTerminal({ name: this._name, shellPath, shellArgs, cwd, env, waitOnExit, strictEnv, hideFromUser });
		this._name = result.name;
		this._runQueuedRequests(result.id);
	}

	public async createExtensionTerminal(): Promise<number> {
		const result = await this._proxy.$createTerminal({ name: this._name, isExtensionTerminal: true });
		this._name = result.name;
		this._runQueuedRequests(result.id);
		return result.id;
	}

	public get name(): string {
		return this._name || '';
	}

	public set name(name: string) {
		this._name = name;
	}

	public get exitStatus(): vscode.TerminalExitStatus | undefined {
		return this._exitStatus;
	}

	public get dimensions(): vscode.TerminalDimensions | undefined {
		if (this._cols === undefined || this._rows === undefined) {
			return undefined;
		}
		return {
			columns: this._cols,
			rows: this._rows
		};
	}

	public setExitCode(code: number | undefined) {
		this._exitStatus = Object.freeze({ code });
	}

	public setDimensions(cols: number, rows: number): boolean {
		if (cols === this._cols && rows === this._rows) {
			// Nothing changed
			return false;
		}
		this._cols = cols;
		this._rows = rows;
		return true;
	}

	public get processId(): Promise<number | undefined> {
		return this._pidPromise;
	}

	public get creationOptions(): Readonly<vscode.TerminalOptions | vscode.ExtensionTerminalOptions> {
		return this._creationOptions;
	}

	public sendText(text: string, addNewLine: boolean = true): void {
		this._checkDisposed();
		this._queueApiRequest(this._proxy.$sendText, [text, addNewLine]);
	}

	public show(preserveFocus: boolean): void {
		this._checkDisposed();
		this._queueApiRequest(this._proxy.$show, [preserveFocus]);
	}

	public hide(): void {
		this._checkDisposed();
		this._queueApiRequest(this._proxy.$hide, []);
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

class ApiRequest {
	private _callback: (...args: any[]) => void;
	private _args: any[];

	constructor(callback: (...args: any[]) => void, args: any[]) {
		this._callback = callback;
		this._args = args;
	}

	public run(proxy: MainThreadTerminalServiceShape, id: number) {
		this._callback.apply(proxy, [id].concat(this._args));
	}
}

export class ExtHostPseudoterminal implements ITerminalChildProcess {
	private readonly _onProcessData = new Emitter<string>();
	public readonly onProcessData: Event<string> = this._onProcessData.event;
	private readonly _onProcessExit = new Emitter<number | undefined>();
	public readonly onProcessExit: Event<number | undefined> = this._onProcessExit.event;
	private readonly _onProcessReady = new Emitter<{ pid: number, cwd: string }>();
	public get onProcessReady(): Event<{ pid: number, cwd: string }> { return this._onProcessReady.event; }
	private readonly _onProcessTitleChanged = new Emitter<string>();
	public readonly onProcessTitleChanged: Event<string> = this._onProcessTitleChanged.event;
	private readonly _onProcessOverrideDimensions = new Emitter<ITerminalDimensions | undefined>();
	public get onProcessOverrideDimensions(): Event<ITerminalDimensions | undefined> { return this._onProcessOverrideDimensions.event; }

	constructor(private readonly _pty: vscode.Pseudoterminal) { }

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

		this._pty.open(initialDimensions ? initialDimensions : undefined);
		this._onProcessReady.fire({ pid: -1, cwd: '' });
	}
}

export abstract class BaseExtHostTerminalService implements IExtHostTerminalService, ExtHostTerminalServiceShape {

	readonly _serviceBrand: undefined;

	protected _proxy: MainThreadTerminalServiceShape;
	protected _activeTerminal: ExtHostTerminal | undefined;
	protected _terminals: ExtHostTerminal[] = [];
	protected _terminalProcesses: { [id: number]: ITerminalChildProcess } = {};
	protected _terminalProcessDisposables: { [id: number]: IDisposable } = {};
	protected _extensionTerminalAwaitingStart: { [id: number]: { initialDimensions: ITerminalDimensionsDto | undefined } | undefined } = {};
	protected _getTerminalPromises: { [id: number]: Promise<ExtHostTerminal> } = {};

	private readonly _bufferer: TerminalDataBufferer;
	private readonly _linkHandlers: Set<vscode.TerminalLinkHandler> = new Set();

	public get activeTerminal(): ExtHostTerminal | undefined { return this._activeTerminal; }
	public get terminals(): ExtHostTerminal[] { return this._terminals; }

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
		@IExtHostRpcService extHostRpc: IExtHostRpcService
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadTerminalService);
		this._bufferer = new TerminalDataBufferer(this._proxy.$sendProcessData);
		this._onDidWriteTerminalData = new Emitter<vscode.TerminalDataWriteEvent>({
			onFirstListenerAdd: () => this._proxy.$startSendingDataEvents(),
			onLastListenerRemove: () => this._proxy.$stopSendingDataEvents()
		});
	}

	public abstract createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal;
	public abstract createTerminalFromOptions(options: vscode.TerminalOptions): vscode.Terminal;
	public abstract getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string;
	public abstract getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string;
	public abstract $spawnExtHostProcess(id: number, shellLaunchConfigDto: IShellLaunchConfigDto, activeWorkspaceRootUriComponents: UriComponents, cols: number, rows: number, isWorkspaceShellAllowed: boolean): Promise<void>;
	public abstract $getAvailableShells(): Promise<IShellDefinitionDto[]>;
	public abstract $getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto>;
	public abstract $acceptWorkspacePermissionsChanged(isAllowed: boolean): void;
	public abstract getEnvironmentVariableCollection(extension: IExtensionDescription, persistent?: boolean): vscode.EnvironmentVariableCollection;
	public abstract $initEnvironmentVariableCollections(collections: [string, ISerializableEnvironmentVariableCollection][]): void;

	public createExtensionTerminal(options: vscode.ExtensionTerminalOptions): vscode.Terminal {
		const terminal = new ExtHostTerminal(this._proxy, options, options.name);
		const p = new ExtHostPseudoterminal(options.pty);
		terminal.createExtensionTerminal().then(id => {
			const disposable = this._setupExtHostProcessListeners(id, p);
			this._terminalProcessDisposables[id] = disposable;
		});
		this._terminals.push(terminal);
		return terminal;
	}

	public attachPtyToTerminal(id: number, pty: vscode.Pseudoterminal): void {
		const terminal = this._getTerminalByIdEventually(id);
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
		const terminal = await this._getTerminalByIdEventually(id);
		if (terminal) {
			this._activeTerminal = terminal;
			if (original !== this._activeTerminal) {
				this._onDidChangeActiveTerminal.fire(this._activeTerminal);
			}
		}
	}

	public async $acceptTerminalProcessData(id: number, data: string): Promise<void> {
		const terminal = await this._getTerminalByIdEventually(id);
		if (terminal) {
			this._onDidWriteTerminalData.fire({ terminal, data });
		}
	}

	public async $acceptTerminalDimensions(id: number, cols: number, rows: number): Promise<void> {
		const terminal = await this._getTerminalByIdEventually(id);
		if (terminal) {
			if (terminal.setDimensions(cols, rows)) {
				this._onDidChangeTerminalDimensions.fire({
					terminal: terminal,
					dimensions: terminal.dimensions as vscode.TerminalDimensions
				});
			}
		}
	}

	public async $acceptTerminalMaximumDimensions(id: number, cols: number, rows: number): Promise<void> {
		await this._getTerminalByIdEventually(id);

		if (this._terminalProcesses[id]) {
			// Extension pty terminal only - when virtual process resize fires it means that the
			// terminal's maximum dimensions changed
			this._terminalProcesses[id]?.resize(cols, rows);
		}
	}

	public async $acceptTerminalTitleChange(id: number, name: string): Promise<void> {
		await this._getTerminalByIdEventually(id);
		const extHostTerminal = this._getTerminalObjectById(this.terminals, id);
		if (extHostTerminal) {
			extHostTerminal.name = name;
		}
	}

	public async $acceptTerminalClosed(id: number, exitCode: number | undefined): Promise<void> {
		await this._getTerminalByIdEventually(id);
		const index = this._getTerminalObjectIndexById(this.terminals, id);
		if (index !== null) {
			const terminal = this._terminals.splice(index, 1)[0];
			terminal.setExitCode(exitCode);
			this._onDidCloseTerminal.fire(terminal);
		}
	}

	public $acceptTerminalOpened(id: number, name: string, shellLaunchConfigDto: IShellLaunchConfigDto): void {
		const index = this._getTerminalObjectIndexById(this._terminals, id);
		if (index !== null) {
			// The terminal has already been created (via createTerminal*), only fire the event
			this._onDidOpenTerminal.fire(this.terminals[index]);
			this.terminals[index].isOpen = true;
			return;
		}

		const creationOptions: vscode.TerminalOptions = {
			name: shellLaunchConfigDto.name,
			shellPath: shellLaunchConfigDto.executable,
			shellArgs: shellLaunchConfigDto.args,
			cwd: typeof shellLaunchConfigDto.cwd === 'string' ? shellLaunchConfigDto.cwd : URI.revive(shellLaunchConfigDto.cwd),
			env: shellLaunchConfigDto.env
		};
		const terminal = new ExtHostTerminal(this._proxy, creationOptions, name, id);
		this._terminals.push(terminal);
		this._onDidOpenTerminal.fire(terminal);
		terminal.isOpen = true;
	}

	public async $acceptTerminalProcessId(id: number, processId: number): Promise<void> {
		const terminal = await this._getTerminalByIdEventually(id);
		if (terminal) {
			terminal._setProcessId(processId);
		}
	}

	public async $startExtensionTerminal(id: number, initialDimensions: ITerminalDimensionsDto | undefined): Promise<void> {
		// Make sure the ExtHostTerminal exists so onDidOpenTerminal has fired before we call
		// Pseudoterminal.start
		const terminal = await this._getTerminalByIdEventually(id);
		if (!terminal) {
			return;
		}

		// Wait for onDidOpenTerminal to fire
		let openPromise: Promise<void>;
		if (terminal.isOpen) {
			openPromise = Promise.resolve();
		} else {
			openPromise = new Promise<void>(r => {
				// Ensure open is called after onDidOpenTerminal
				const listener = this.onDidOpenTerminal(async e => {
					if (e === terminal) {
						listener.dispose();
						r();
					}
				});
			});
		}
		await openPromise;

		if (this._terminalProcesses[id]) {
			(this._terminalProcesses[id] as ExtHostPseudoterminal).startSendingEvents(initialDimensions);
		} else {
			// Defer startSendingEvents call to when _setupExtHostProcessListeners is called
			this._extensionTerminalAwaitingStart[id] = { initialDimensions };
		}

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
		this._terminalProcesses[id] = p;

		const awaitingStart = this._extensionTerminalAwaitingStart[id];
		if (awaitingStart && p instanceof ExtHostPseudoterminal) {
			p.startSendingEvents(awaitingStart.initialDimensions);
			delete this._extensionTerminalAwaitingStart[id];
		}

		return disposables;
	}

	public $acceptProcessInput(id: number, data: string): void {
		this._terminalProcesses[id]?.input(data);
	}

	public $acceptProcessResize(id: number, cols: number, rows: number): void {
		try {
			this._terminalProcesses[id]?.resize(cols, rows);
		} catch (error) {
			// We tried to write to a closed pipe / channel.
			if (error.code !== 'EPIPE' && error.code !== 'ERR_IPC_CHANNEL_CLOSED') {
				throw (error);
			}
		}
	}

	public $acceptProcessShutdown(id: number, immediate: boolean): void {
		this._terminalProcesses[id]?.shutdown(immediate);
	}

	public $acceptProcessRequestInitialCwd(id: number): void {
		this._terminalProcesses[id]?.getInitialCwd().then(initialCwd => this._proxy.$sendProcessInitialCwd(id, initialCwd));
	}

	public $acceptProcessRequestCwd(id: number): void {
		this._terminalProcesses[id]?.getCwd().then(cwd => this._proxy.$sendProcessCwd(id, cwd));
	}

	public $acceptProcessRequestLatency(id: number): number {
		return id;
	}

	public registerLinkHandler(handler: vscode.TerminalLinkHandler): vscode.Disposable {
		this._linkHandlers.add(handler);
		if (this._linkHandlers.size === 1) {
			this._proxy.$startHandlingLinks();
		}
		return new VSCodeDisposable(() => {
			this._linkHandlers.delete(handler);
			if (this._linkHandlers.size === 0) {
				this._proxy.$stopHandlingLinks();
			}
		});
	}

	public async $handleLink(id: number, link: string): Promise<boolean> {
		const terminal = this._getTerminalById(id);
		if (!terminal) {
			return false;
		}

		// Call each handler synchronously so multiple handlers aren't triggered at once
		const it = this._linkHandlers.values();
		let next = it.next();
		while (!next.done) {
			const handled = await next.value.handleLink(terminal, link);
			if (handled) {
				return true;
			}
			next = it.next();
		}
		return false;
	}

	private _onProcessExit(id: number, exitCode: number | undefined): void {
		this._bufferer.stopBuffering(id);

		// Remove process reference
		delete this._terminalProcesses[id];
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

	// TODO: This could be improved by using a single promise and resolve it when the terminal is ready
	private _getTerminalByIdEventually(id: number, retries: number = 5): Promise<ExtHostTerminal | undefined> {
		if (!this._getTerminalPromises[id]) {
			this._getTerminalPromises[id] = this._createGetTerminalPromise(id, retries);
		}
		return this._getTerminalPromises[id];
	}

	private _createGetTerminalPromise(id: number, retries: number = 5): Promise<ExtHostTerminal> {
		return new Promise(c => {
			if (retries === 0) {
				c(undefined);
				return;
			}

			const terminal = this._getTerminalById(id);
			if (terminal) {
				c(terminal);
			} else {
				// This should only be needed immediately after createTerminalRenderer is called as
				// the ExtHostTerminal has not yet been iniitalized
				timeout(EXT_HOST_CREATION_DELAY * 2).then(() => c(this._createGetTerminalPromise(id, retries - 1)));
			}
		});
	}

	private _getTerminalById(id: number): ExtHostTerminal | null {
		return this._getTerminalObjectById(this._terminals, id);
	}

	private _getTerminalObjectById<T extends ExtHostTerminal>(array: T[], id: number): T | null {
		const index = this._getTerminalObjectIndexById(array, id);
		return index !== null ? array[index] : null;
	}

	private _getTerminalObjectIndexById<T extends ExtHostTerminal>(array: T[], id: number): number | null {
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
	public createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal {
		throw new Error('Not implemented');
	}

	public createTerminalFromOptions(options: vscode.TerminalOptions): vscode.Terminal {
		throw new Error('Not implemented');
	}

	public getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string {
		throw new Error('Not implemented');
	}

	public getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string {
		throw new Error('Not implemented');
	}

	public $spawnExtHostProcess(id: number, shellLaunchConfigDto: IShellLaunchConfigDto, activeWorkspaceRootUriComponents: UriComponents, cols: number, rows: number, isWorkspaceShellAllowed: boolean): Promise<void> {
		throw new Error('Not implemented');
	}

	public $getAvailableShells(): Promise<IShellDefinitionDto[]> {
		throw new Error('Not implemented');
	}

	public async $getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto> {
		throw new Error('Not implemented');
	}

	public $acceptWorkspacePermissionsChanged(isAllowed: boolean): void {
		// No-op for web worker ext host as workspace permissions aren't used
	}

	public getEnvironmentVariableCollection(extension: IExtensionDescription, persistent?: boolean): vscode.EnvironmentVariableCollection {
		// This is not implemented so worker ext host extensions cannot influence terminal envs
		throw new Error('Not implemented');
	}

	public $initEnvironmentVariableCollections(collections: [string, ISerializableEnvironmentVariableCollection][]): void {
		// No-op for web worker ext host as collections aren't used
	}
}
