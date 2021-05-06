/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IOffProcessTerminalService, IShellLaunchConfig, ITerminalChildProcess, ITerminalDimensions, ITerminalLaunchError, ITerminalTabLayoutInfoById, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { IAvailableProfilesRequest, ICommandTracker, INavigationMode, IRemoteTerminalAttachTarget, ITerminalProfile, IStartExtensionTerminalRequest, ITerminalConfigHelper, ITerminalProcessExtHostProxy, TitleEventSource } from 'vs/workbench/contrib/terminal/common/terminal';
import type { Terminal as XTermTerminal } from 'xterm';
import type { SearchAddon as XTermSearchAddon } from 'xterm-addon-search';
import type { Unicode11Addon as XTermUnicode11Addon } from 'xterm-addon-unicode11';
import type { WebglAddon as XTermWebglAddon } from 'xterm-addon-webgl';
import { ITerminalStatusList } from 'vs/workbench/contrib/terminal/browser/terminalStatusList';
import { ICompleteTerminalConfiguration } from 'vs/workbench/contrib/terminal/common/remoteTerminalChannel';

export const ITerminalService = createDecorator<ITerminalService>('terminalService');
export const ITerminalInstanceService = createDecorator<ITerminalInstanceService>('terminalInstanceService');
export const IRemoteTerminalService = createDecorator<IRemoteTerminalService>('remoteTerminalService');

/**
 * A service used by TerminalInstance (and components owned by it) that allows it to break its
 * dependency on electron-browser and node layers, while at the same time avoiding a cyclic
 * dependency on ITerminalService.
 */
export interface ITerminalInstanceService {
	readonly _serviceBrand: undefined;

	getXtermConstructor(): Promise<typeof XTermTerminal>;
	getXtermSearchConstructor(): Promise<typeof XTermSearchAddon>;
	getXtermUnicode11Constructor(): Promise<typeof XTermUnicode11Addon>;
	getXtermWebglConstructor(): Promise<typeof XTermWebglAddon>;
}

export interface IBrowserTerminalConfigHelper extends ITerminalConfigHelper {
	panelContainer: HTMLElement | undefined;
}

export const enum Direction {
	Left = 0,
	Right = 1,
	Up = 2,
	Down = 3
}

export interface ITerminalGroup {
	activeInstance: ITerminalInstance | null;
	terminalInstances: ITerminalInstance[];
	title: string;
	onDisposed: Event<ITerminalGroup>;
	onInstancesChanged: Event<void>;
	focusPreviousPane(): void;
	focusNextPane(): void;
	resizePane(direction: Direction): void;
	resizePanes(relativeSizes: number[]): void;
	setActiveInstanceByIndex(index: number): void;
	attachToElement(element: HTMLElement): void;
	setVisible(visible: boolean): void;
	layout(width: number, height: number): void;
	addDisposable(disposable: IDisposable): void;
	split(shellLaunchConfig: IShellLaunchConfig): ITerminalInstance;
	getLayoutInfo(isActive: boolean): ITerminalTabLayoutInfoById;
}

export const enum TerminalConnectionState {
	Connecting,
	Connected
}

export interface ITerminalService {
	readonly _serviceBrand: undefined;

	activeTabIndex: number;
	configHelper: ITerminalConfigHelper;
	terminalInstances: ITerminalInstance[];
	terminalGroups: ITerminalGroup[];
	isProcessSupportRegistered: boolean;
	readonly connectionState: TerminalConnectionState;
	readonly availableProfiles: ITerminalProfile[];

	initializeTerminals(): Promise<void>;
	onActiveTabChanged: Event<void>;
	onTabDisposed: Event<ITerminalGroup>;
	onInstanceCreated: Event<ITerminalInstance>;
	onInstanceDisposed: Event<ITerminalInstance>;
	onInstanceProcessIdReady: Event<ITerminalInstance>;
	onInstanceDimensionsChanged: Event<ITerminalInstance>;
	onInstanceMaximumDimensionsChanged: Event<ITerminalInstance>;
	onInstanceRequestStartExtensionTerminal: Event<IStartExtensionTerminalRequest>;
	onInstancesChanged: Event<void>;
	onInstanceTitleChanged: Event<ITerminalInstance | undefined>;
	onInstanceIconChanged: Event<ITerminalInstance | undefined>;
	onInstancePrimaryStatusChanged: Event<ITerminalInstance>;
	onActiveInstanceChanged: Event<ITerminalInstance | undefined>;
	onRequestAvailableProfiles: Event<IAvailableProfilesRequest>;
	onDidRegisterProcessSupport: Event<void>;
	onDidChangeConnectionState: Event<void>;
	onDidChangeAvailableProfiles: Event<ITerminalProfile[]>;
	onPanelMovedToSide: Event<void>;

	/**
	 * Creates a terminal.
	 * @param shell The shell launch configuration to use.
	 */
	createTerminal(shell?: IShellLaunchConfig, cwd?: string | URI): ITerminalInstance;

	/**
	 * Creates a terminal.
	 * @param profile The profile to launch the terminal with.
	 */
	createTerminal(profile: ITerminalProfile): ITerminalInstance;

	/**
	 * Creates a raw terminal instance, this should not be used outside of the terminal part.
	 */
	createInstance(container: HTMLElement | undefined, shellLaunchConfig: IShellLaunchConfig): ITerminalInstance;
	getInstanceFromId(terminalId: number): ITerminalInstance | undefined;
	getInstanceFromIndex(terminalIndex: number): ITerminalInstance;
	getTabLabels(): string[];
	getActiveInstance(): ITerminalInstance | null;
	setActiveInstance(terminalInstance: ITerminalInstance): void;
	setActiveInstanceByIndex(terminalIndex: number): void;
	getActiveOrCreateInstance(): ITerminalInstance;
	splitInstance(instance: ITerminalInstance, shell?: IShellLaunchConfig, cwd?: string | URI): ITerminalInstance | null;
	splitInstance(instance: ITerminalInstance, profile: ITerminalProfile): ITerminalInstance | null;

	/**
	 * Perform an action with the active terminal instance, if the terminal does
	 * not exist the callback will not be called.
	 * @param callback The callback that fires with the active terminal
	 */
	doWithActiveInstance<T>(callback: (terminal: ITerminalInstance) => T): T | void;

	getActiveGroup(): ITerminalGroup | null;
	setActiveTabToNext(): void;
	setActiveTabToPrevious(): void;
	setActiveTabByIndex(tabIndex: number): void;

	/**
	 * Fire the onActiveTabChanged event, this will trigger the terminal dropdown to be updated,
	 * among other things.
	 */
	refreshActiveTab(): void;

	showPanel(focus?: boolean): Promise<void>;
	hidePanel(): void;
	focusFindWidget(): Promise<void>;
	hideFindWidget(): void;
	getFindState(): FindReplaceState;
	findNext(): void;
	findPrevious(): void;
	focusTabs(): void;
	showTabs(): void;

	registerProcessSupport(isSupported: boolean): void;
	/**
	 * Registers a link provider that enables integrators to add links to the terminal.
	 * @param linkProvider When registered, the link provider is asked whenever a cell is hovered
	 * for links at that position. This lets the terminal know all links at a given area and also
	 * labels for what these links are going to do.
	 */
	registerLinkProvider(linkProvider: ITerminalExternalLinkProvider): IDisposable;

	showProfileQuickPick(type: 'setDefault' | 'createInstance', cwd?: string | URI): Promise<ITerminalInstance | undefined>;

	getGroupForInstance(instance: ITerminalInstance): ITerminalGroup | undefined;

	setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): void;

	/**
	 * Takes a path and returns the properly escaped path to send to the terminal.
	 * On Windows, this included trying to prepare the path for WSL if needed.
	 *
	 * @param executable The executable off the shellLaunchConfig
	 * @param title The terminal's title
	 * @param path The path to be escaped and formatted.
	 * @param isRemote Whether the terminal's pty is remote.
	 * @returns An escaped version of the path to be execuded in the terminal.
	 */
	preparePathForTerminalAsync(path: string, executable: string | undefined, title: string, shellType: TerminalShellType, isRemote: boolean): Promise<string>;

	extHostReady(remoteAuthority: string): void;
	requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined>;
	isAttachedToTerminal(remoteTerm: IRemoteTerminalAttachTarget): boolean;
}

export interface IRemoteTerminalService extends IOffProcessTerminalService {
	createProcess(shellLaunchConfig: IShellLaunchConfig, configuration: ICompleteTerminalConfiguration, activeWorkspaceRootUri: URI | undefined, cols: number, rows: number, shouldPersist: boolean, configHelper: ITerminalConfigHelper): Promise<ITerminalChildProcess>;
}

/**
 * Similar to xterm.js' ILinkProvider but using promises and hides xterm.js internals (like buffer
 * positions, decorations, etc.) from the rest of vscode. This is the interface to use for
 * workbench integrations.
 */
export interface ITerminalExternalLinkProvider {
	provideLinks(instance: ITerminalInstance, line: string): Promise<ITerminalLink[] | undefined>;
}

export interface ITerminalLink {
	/** The startIndex of the link in the line. */
	startIndex: number;
	/** The length of the link in the line. */
	length: number;
	/** The descriptive label for what the link does when activated. */
	label?: string;
	/**
	 * Activates the link.
	 * @param text The text of the link.
	 */
	activate(text: string): void;
}

export interface ISearchOptions {
	/** Whether the find should be done as a regex. */
	regex?: boolean;
	/** Whether only whole words should match. */
	wholeWord?: boolean;
	/** Whether find should pay attention to case. */
	caseSensitive?: boolean;
	/** Whether the search should start at the current search position (not the next row). */
	incremental?: boolean;
}

export interface ITerminalBeforeHandleLinkEvent {
	terminal?: ITerminalInstance;
	/** The text of the link */
	link: string;
	/** Call with whether the link was handled by the interceptor */
	resolve(wasHandled: boolean): void;
}

export interface ITerminalInstance {
	/**
	 * The ID of the terminal instance, this is an arbitrary number only used to uniquely identify
	 * terminal instances within a window.
	 */
	readonly instanceId: number;
	/**
	 * A unique URI for this terminal instance with the following encoding:
	 * path: Title
	 * fragment: Instance ID
	 */
	readonly resource: URI;

	readonly cols: number;
	readonly rows: number;
	readonly maxCols: number;
	readonly maxRows: number;
	readonly icon?: Codicon;

	readonly statusList: ITerminalStatusList;

	/**
	 * The process ID of the shell process, this is undefined when there is no process associated
	 * with this terminal.
	 */
	processId: number | undefined;

	/**
	 * The id of a persistent process. This is defined if this is a terminal created by a pty host
	 * that supports reconnection.
	 */
	readonly persistentProcessId: number | undefined;

	/**
	 * Whether the process should be persisted across reloads.
	 */
	readonly shouldPersist: boolean;

	/**
	 * Whether the process communication channel has been disconnected.
	 */
	readonly isDisconnected: boolean;

	/**
	 * Whether the terminal's pty is hosted on a remote.
	 */
	readonly isRemote: boolean;

	/**
	 * An event that fires when the terminal instance's title changes.
	 */
	onTitleChanged: Event<ITerminalInstance>;

	/**
	 * An event that fires when the terminal instance's icon changes.
	 */
	onIconChanged: Event<ITerminalInstance>;

	/**
	 * An event that fires when the terminal instance is disposed.
	 */
	onDisposed: Event<ITerminalInstance>;

	onFocused: Event<ITerminalInstance>;
	onDropped: Event<{ instance: ITerminalInstance, dragEvent: DragEvent; }>;
	onProcessIdReady: Event<ITerminalInstance>;
	onLinksReady: Event<ITerminalInstance>;
	onRequestExtHostProcess: Event<ITerminalInstance>;
	onDimensionsChanged: Event<void>;
	onMaximumDimensionsChanged: Event<void>;

	onFocus: Event<ITerminalInstance>;

	/**
	 * Attach a listener to the raw data stream coming from the pty, including ANSI escape
	 * sequences.
	 */
	onData: Event<string>;

	/**
	 * Attach a listener to the binary data stream coming from xterm and going to pty
	 */
	onBinary: Event<string>;

	/**
	 * Attach a listener to listen for new lines added to this terminal instance.
	 *
	 * @param listener The listener function which takes new line strings added to the terminal,
	 * excluding ANSI escape sequences. The line event will fire when an LF character is added to
	 * the terminal (ie. the line is not wrapped). Note that this means that the line data will
	 * not fire for the last line, until either the line is ended with a LF character of the process
	 * is exited. The lineData string will contain the fully wrapped line, not containing any LF/CR
	 * characters.
	 */
	onLineData: Event<string>;

	/**
	 * Attach a listener that fires when the terminal's pty process exits. The number in the event
	 * is the processes' exit code, an exit code of null means the process was killed as a result of
	 * the ITerminalInstance being disposed.
	 */
	onExit: Event<number | undefined>;

	readonly exitCode: number | undefined;

	readonly areLinksReady: boolean;

	/**
	 * Returns an array of data events that have fired within the first 10 seconds. If this is
	 * called 10 seconds after the terminal has existed the result will be undefined. This is useful
	 * when objects that depend on the data events have delayed initialization, like extension
	 * hosts.
	 */
	readonly initialDataEvents: string[] | undefined;

	/** A promise that resolves when the terminal's pty/process have been created. */
	processReady: Promise<void>;

	/**
	 * The title of the terminal. This is either title or the process currently running or an
	 * explicit name given to the terminal instance through the extension API.
	 */
	readonly title: string;

	/**
	 * The shell type of the terminal.
	 */
	readonly shellType: TerminalShellType;

	/**
	 * The focus state of the terminal before exiting.
	 */
	readonly hadFocusOnExit: boolean;

	/**
	 * False when the title is set by an API or the user. We check this to make sure we
	 * do not override the title when the process title changes in the terminal.
	 */
	isTitleSetByProcess: boolean;

	/**
	 * The shell launch config used to launch the shell.
	 */
	readonly shellLaunchConfig: IShellLaunchConfig;

	/**
	 * Whether to disable layout for the terminal. This is useful when the size of the terminal is
	 * being manipulating (e.g. adding a split pane) and we want the terminal to ignore particular
	 * resize events.
	 */
	disableLayout: boolean;

	/**
	 * An object that tracks when commands are run and enables navigating and selecting between
	 * them.
	 */
	readonly commandTracker: ICommandTracker | undefined;

	readonly navigationMode: INavigationMode | undefined;

	/**
	 * Shows the environment information hover if the widget exists.
	 */
	showEnvironmentInfoHover(): void;

	/**
	 * Dispose the terminal instance, removing it from the panel/service and freeing up resources.
	 *
	 * @param immediate Whether the kill should be immediate or not. Immediate should only be used
	 * when VS Code is shutting down or in cases where the terminal dispose was user initiated.
	 * The immediate===false exists to cover an edge case where the final output of the terminal can
	 * get cut off. If immediate kill any terminal processes immediately.
	 */
	dispose(immediate?: boolean): void;

	/**
	 * Inform the process that the terminal is now detached.
	 */
	detachFromProcess(): void;

	/**
	 * Forces the terminal to redraw its viewport.
	 */
	forceRedraw(): void;

	/**
	 * Check if anything is selected in terminal.
	 */
	hasSelection(): boolean;

	/**
	 * Copies the terminal selection to the clipboard.
	 */
	copySelection(): Promise<void>;

	/**
	 * Current selection in the terminal.
	 */
	readonly selection: string | undefined;

	/**
	 * Clear current selection.
	 */
	clearSelection(): void;

	/**
	 * Select all text in the terminal.
	 */
	selectAll(): void;

	/**
	 * Find the next instance of the term
	*/
	findNext(term: string, searchOptions: ISearchOptions): boolean;

	/**
	 * Find the previous instance of the term
	 */
	findPrevious(term: string, searchOptions: ISearchOptions): boolean;

	/**
	 * Notifies the terminal that the find widget's focus state has been changed.
	 */
	notifyFindWidgetFocusChanged(isFocused: boolean): void;

	/**
	 * Focuses the terminal instance if it's able to (xterm.js instance exists).
	 *
	 * @param focus Force focus even if there is a selection.
	 */
	focus(force?: boolean): void;

	/**
	 * Focuses the terminal instance when it's ready (the xterm.js instance is created). Use this
	 * when the terminal is being shown.
	 *
	 * @param focus Force focus even if there is a selection.
	 */
	focusWhenReady(force?: boolean): Promise<void>;

	/**
	 * Focuses and pastes the contents of the clipboard into the terminal instance.
	 */
	paste(): Promise<void>;

	/**
	 * Focuses and pastes the contents of the selection clipboard into the terminal instance.
	 */
	pasteSelection(): Promise<void>;

	/**
	 * Send text to the terminal instance. The text is written to the stdin of the underlying pty
	 * process (shell) of the terminal instance.
	 *
	 * @param text The text to send.
	 * @param addNewLine Whether to add a new line to the text being sent, this is normally
	 * required to run a command in the terminal. The character(s) added are \n or \r\n
	 * depending on the platform. This defaults to `true`.
	 */
	sendText(text: string, addNewLine: boolean): void;

	/** Scroll the terminal buffer down 1 line. */
	scrollDownLine(): void;
	/** Scroll the terminal buffer down 1 page. */
	scrollDownPage(): void;
	/** Scroll the terminal buffer to the bottom. */
	scrollToBottom(): void;
	/** Scroll the terminal buffer up 1 line. */
	scrollUpLine(): void;
	/** Scroll the terminal buffer up 1 page. */
	scrollUpPage(): void;
	/** Scroll the terminal buffer to the top. */
	scrollToTop(): void;

	/**
	 * Clears the terminal buffer, leaving only the prompt line.
	 */
	clear(): void;

	/**
	 * Attaches the terminal instance to an element on the DOM, before this is called the terminal
	 * instance process may run in the background but cannot be displayed on the UI.
	 *
	 * @param container The element to attach the terminal instance to.
	 */
	attachToElement(container: HTMLElement): void;

	/**
	 * Configure the dimensions of the terminal instance.
	 *
	 * @param dimension The dimensions of the container.
	 */
	layout(dimension: { width: number, height: number }): void;

	/**
	 * Sets whether the terminal instance's element is visible in the DOM.
	 *
	 * @param visible Whether the element is visible.
	 */
	setVisible(visible: boolean): void;

	/**
	 * Immediately kills the terminal's current pty process and launches a new one to replace it.
	 *
	 * @param shell The new launch configuration.
	 */
	reuseTerminal(shell: IShellLaunchConfig): void;

	/**
	 * Relaunches the terminal, killing it and reusing the launch config used initially. Any
	 * environment variable changes will be recalculated when this happens.
	 */
	relaunch(): void;

	/**
	 * Sets the title of the terminal instance.
	 */
	setTitle(title: string, eventSource: TitleEventSource): void;

	waitForTitle(): Promise<string>;

	setDimensions(dimensions: ITerminalDimensions): void;

	addDisposable(disposable: IDisposable): void;

	toggleEscapeSequenceLogging(): void;

	getInitialCwd(): Promise<string>;
	getCwd(): Promise<string>;

	/**
	 * @throws when called before xterm.js is ready.
	 */
	registerLinkProvider(provider: ITerminalExternalLinkProvider): IDisposable;

	/**
	 * Triggers a quick pick to rename this terminal.
	 */
	rename(): Promise<void>;

	/**
	 * Triggers a quick pick to rename this terminal.
	 */
	changeIcon(): Promise<void>;
}

export const enum LinuxDistro {
	Unknown = 1,
	Fedora = 2,
	Ubuntu = 3,
}
