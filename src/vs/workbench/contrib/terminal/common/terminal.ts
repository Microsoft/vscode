/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { OperatingSystem } from 'vs/base/common/platform';
import { IOpenFileRequest } from 'vs/platform/windows/common/windows';
import { IEnvironmentVariableInfo } from 'vs/workbench/contrib/terminal/common/environmentVariable';

export const TERMINAL_VIEW_ID = 'workbench.panel.terminal';

/** A context key that is set when there is at least one opened integrated terminal. */
export const KEYBINDING_CONTEXT_TERMINAL_IS_OPEN = new RawContextKey<boolean>('terminalIsOpen', false);

/** A context key that is set when the integrated terminal has focus. */
export const KEYBINDING_CONTEXT_TERMINAL_FOCUS = new RawContextKey<boolean>('terminalFocus', false);

export const KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY = 'terminalShellType';
/** A context key that is set to the detected shell for the most recently active terminal, this is set to the last known value when no terminals exist. */
export const KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE = new RawContextKey<string>(KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY, undefined);

/** A context key that is set when the integrated terminal does not have focus. */
export const KEYBINDING_CONTEXT_TERMINAL_NOT_FOCUSED = KEYBINDING_CONTEXT_TERMINAL_FOCUS.toNegated();

/** A context key that is set when the user is navigating the accessibility tree */
export const KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS = new RawContextKey<boolean>('terminalA11yTreeFocus', false);

/** A keybinding context key that is set when the integrated terminal has text selected. */
export const KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED = new RawContextKey<boolean>('terminalTextSelected', false);
/** A keybinding context key that is set when the integrated terminal does not have text selected. */
export const KEYBINDING_CONTEXT_TERMINAL_TEXT_NOT_SELECTED = KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED.toNegated();

/**  A context key that is set when the find widget in integrated terminal is visible. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE = new RawContextKey<boolean>('terminalFindVisible', false);
/**  A context key that is set when the find widget in integrated terminal is not visible. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_NOT_VISIBLE = KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE.toNegated();
/**  A context key that is set when the find widget find input in integrated terminal is focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_INPUT_FOCUSED = new RawContextKey<boolean>('terminalFindInputFocused', false);
/**  A context key that is set when the find widget in integrated terminal is focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED = new RawContextKey<boolean>('terminalFindFocused', false);
/**  A context key that is set when the find widget find input in integrated terminal is not focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_INPUT_NOT_FOCUSED = KEYBINDING_CONTEXT_TERMINAL_FIND_INPUT_FOCUSED.toNegated();

export const IS_WORKSPACE_SHELL_ALLOWED_STORAGE_KEY = 'terminal.integrated.isWorkspaceShellAllowed';
export const NEVER_MEASURE_RENDER_TIME_STORAGE_KEY = 'terminal.integrated.neverMeasureRenderTime';

// The creation of extension host terminals is delayed by this value (milliseconds). The purpose of
// this delay is to allow the terminal instance to initialize correctly and have its ID set before
// trying to create the corressponding object on the ext host.
export const EXT_HOST_CREATION_DELAY = 100;

export const ITerminalNativeService = createDecorator<ITerminalNativeService>('terminalNativeService');

export const TerminalCursorStyle = {
	BLOCK: 'block',
	LINE: 'line',
	UNDERLINE: 'underline'
};

export const TERMINAL_CONFIG_SECTION = 'terminal.integrated';

export const TERMINAL_ACTION_CATEGORY = nls.localize('terminalCategory', "Terminal");

export const DEFAULT_LETTER_SPACING = 0;
export const MINIMUM_LETTER_SPACING = -5;
export const DEFAULT_LINE_HEIGHT = 1;
export const SHELL_PATH_INVALID_EXIT_CODE = -1;
export const SHELL_PATH_DIRECTORY_EXIT_CODE = -2;
export const SHELL_CWD_INVALID_EXIT_CODE = -3;
export const LEGACY_CONSOLE_MODE_EXIT_CODE = 3221225786; // microsoft/vscode#73790

export type FontWeight = 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface ITerminalConfiguration {
	shell: {
		linux: string | null;
		osx: string | null;
		windows: string | null;
	};
	automationShell: {
		linux: string | null;
		osx: string | null;
		windows: string | null;
	};
	shellArgs: {
		linux: string[];
		osx: string[];
		windows: string[];
	};
	macOptionIsMeta: boolean;
	macOptionClickForcesSelection: boolean;
	rendererType: 'auto' | 'canvas' | 'dom' | 'experimentalWebgl';
	rightClickBehavior: 'default' | 'copyPaste' | 'paste' | 'selectWord';
	cursorBlinking: boolean;
	cursorStyle: string;
	cursorWidth: number;
	drawBoldTextInBrightColors: boolean;
	fastScrollSensitivity: number;
	fontFamily: string;
	fontWeight: FontWeight;
	fontWeightBold: FontWeight;
	minimumContrastRatio: number;
	mouseWheelScrollSensitivity: number;
	// fontLigatures: boolean;
	fontSize: number;
	letterSpacing: number;
	lineHeight: number;
	detectLocale: 'auto' | 'off' | 'on';
	scrollback: number;
	commandsToSkipShell: string[];
	allowChords: boolean;
	allowMnemonics: boolean;
	cwd: string;
	confirmOnExit: boolean;
	enableBell: boolean;
	inheritEnv: boolean;
	env: {
		linux: { [key: string]: string };
		osx: { [key: string]: string };
		windows: { [key: string]: string };
	};
	environmentChangesIndicator: 'off' | 'on' | 'warnonly';
	showExitAlert: boolean;
	splitCwd: 'workspaceRoot' | 'initial' | 'inherited';
	windowsEnableConpty: boolean;
	wordSeparators: string;
	experimentalUseTitleEvent: boolean;
	enableFileLinks: boolean;
	unicodeVersion: '6' | '11';
	experimentalLinkProvider: boolean;
}

export interface ITerminalConfigHelper {
	config: ITerminalConfiguration;

	onWorkspacePermissionsChanged: Event<boolean>;

	configFontIsMonospace(): boolean;
	getFont(): ITerminalFont;
	/** Sets whether a workspace shell configuration is allowed or not */
	setWorkspaceShellAllowed(isAllowed: boolean): void;
	checkWorkspaceShellPermissions(osOverride?: OperatingSystem): boolean;
	showRecommendations(shellLaunchConfig: IShellLaunchConfig): void;
}

export interface ITerminalFont {
	fontFamily: string;
	fontSize: number;
	letterSpacing: number;
	lineHeight: number;
	charWidth?: number;
	charHeight?: number;
}

export interface ITerminalEnvironment {
	[key: string]: string | null;
}

export interface IShellLaunchConfig {
	/**
	 * The name of the terminal, if this is not set the name of the process will be used.
	 */
	name?: string;

	/**
	 * The shell executable (bash, cmd, etc.).
	 */
	executable?: string;

	/**
	 * The CLI arguments to use with executable, a string[] is in argv format and will be escaped,
	 * a string is in "CommandLine" pre-escaped format and will be used as is. The string option is
	 * only supported on Windows and will throw an exception if used on macOS or Linux.
	 */
	args?: string[] | string;

	/**
	 * The current working directory of the terminal, this overrides the `terminal.integrated.cwd`
	 * settings key.
	 */
	cwd?: string | URI;

	/**
	 * A custom environment for the terminal, if this is not set the environment will be inherited
	 * from the VS Code process.
	 */
	env?: ITerminalEnvironment;

	/**
	 * Whether to ignore a custom cwd from the `terminal.integrated.cwd` settings key (e.g. if the
	 * shell is being launched by an extension).
	 */
	ignoreConfigurationCwd?: boolean;

	/** Whether to wait for a key press before closing the terminal. */
	waitOnExit?: boolean | string;

	/**
	 * A string including ANSI escape sequences that will be written to the terminal emulator
	 * _before_ the terminal process has launched, a trailing \n is added at the end of the string.
	 * This allows for example the terminal instance to display a styled message as the first line
	 * of the terminal. Use \x1b over \033 or \e for the escape control character.
	 */
	initialText?: string;

	/**
	 * Whether an extension is controlling the terminal via a `vscode.Pseudoterminal`.
	 */
	isExtensionTerminal?: boolean;

	/**
	 * Whether the terminal process environment should be exactly as provided in
	 * `TerminalOptions.env`. When this is false (default), the environment will be based on the
	 * window's environment and also apply configured platform settings like
	 * `terminal.integrated.windows.env` on top. When this is true, the complete environment must be
	 * provided as nothing will be inherited from the process or any configuration.
	 */
	strictEnv?: boolean;

	/**
	 * When enabled the terminal will run the process as normal but not be surfaced to the user
	 * until `Terminal.show` is called. The typical usage for this is when you need to run
	 * something that may need interactivity but only want to tell the user about it when
	 * interaction is needed. Note that the terminals will still be exposed to all extensions
	 * as normal.
	 */
	hideFromUser?: boolean;
}

/**
 * Provides access to native or electron APIs to other terminal services.
 */
export interface ITerminalNativeService {
	_serviceBrand: undefined;

	readonly linuxDistro: LinuxDistro;

	readonly onOpenFileRequest: Event<IOpenFileRequest>;
	readonly onOsResume: Event<void>;

	getWindowsBuildNumber(): number;
	whenFileDeleted(path: URI): Promise<void>;
	getWslPath(path: string): Promise<string>;
}

export interface IShellDefinition {
	label: string;
	path: string;
}

export interface ITerminalDimensions {
	/**
	 * The columns of the terminal.
	 */
	readonly cols: number;

	/**
	 * The rows of the terminal.
	 */
	readonly rows: number;
}

export interface ICommandTracker {
	scrollToPreviousCommand(): void;
	scrollToNextCommand(): void;
	selectToPreviousCommand(): void;
	selectToNextCommand(): void;
	selectToPreviousLine(): void;
	selectToNextLine(): void;
}

export interface INavigationMode {
	exitNavigationMode(): void;
	focusPreviousLine(): void;
	focusNextLine(): void;
}

export interface IBeforeProcessDataEvent {
	/**
	 * The data of the event, this can be modified by the event listener to change what gets sent
	 * to the terminal.
	 */
	data: string;
}

export interface ITerminalProcessManager extends IDisposable {
	readonly processState: ProcessState;
	readonly ptyProcessReady: Promise<void>;
	readonly shellProcessId: number | undefined;
	readonly remoteAuthority: string | undefined;
	readonly os: OperatingSystem | undefined;
	readonly userHome: string | undefined;
	readonly environmentVariableInfo: IEnvironmentVariableInfo | undefined;

	readonly onProcessReady: Event<void>;
	readonly onBeforeProcessData: Event<IBeforeProcessDataEvent>;
	readonly onProcessData: Event<string>;
	readonly onProcessTitle: Event<string>;
	readonly onProcessExit: Event<number | undefined>;
	readonly onProcessOverrideDimensions: Event<ITerminalDimensions | undefined>;
	readonly onProcessResolvedShellLaunchConfig: Event<IShellLaunchConfig>;
	readonly onEnvironmentVariableInfoChanged: Event<IEnvironmentVariableInfo>;

	dispose(immediate?: boolean): void;
	createProcess(shellLaunchConfig: IShellLaunchConfig, cols: number, rows: number, isScreenReaderModeEnabled: boolean): Promise<void>;
	write(data: string): void;
	setDimensions(cols: number, rows: number): void;

	getInitialCwd(): Promise<string>;
	getCwd(): Promise<string>;
	getLatency(): Promise<number>;
}

export const enum ProcessState {
	// The process has not been initialized yet.
	UNINITIALIZED,
	// The process is currently launching, the process is marked as launching
	// for a short duration after being created and is helpful to indicate
	// whether the process died as a result of bad shell and args.
	LAUNCHING,
	// The process is running normally.
	RUNNING,
	// The process was killed during launch, likely as a result of bad shell and
	// args.
	KILLED_DURING_LAUNCH,
	// The process was killed by the user (the event originated from VS Code).
	KILLED_BY_USER,
	// The process was killed by itself, for example the shell crashed or `exit`
	// was run.
	KILLED_BY_PROCESS
}

export interface ITerminalProcessExtHostProxy extends IDisposable {
	readonly terminalId: number;

	emitData(data: string): void;
	emitTitle(title: string): void;
	emitReady(pid: number, cwd: string): void;
	emitExit(exitCode: number | undefined): void;
	emitOverrideDimensions(dimensions: ITerminalDimensions | undefined): void;
	emitResolvedShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig): void;
	emitInitialCwd(initialCwd: string): void;
	emitCwd(cwd: string): void;
	emitLatency(latency: number): void;

	onInput: Event<string>;
	onResize: Event<{ cols: number, rows: number }>;
	onShutdown: Event<boolean>;
	onRequestInitialCwd: Event<void>;
	onRequestCwd: Event<void>;
	onRequestLatency: Event<void>;
}

export interface ISpawnExtHostProcessRequest {
	proxy: ITerminalProcessExtHostProxy;
	shellLaunchConfig: IShellLaunchConfig;
	activeWorkspaceRootUri: URI | undefined;
	cols: number;
	rows: number;
	isWorkspaceShellAllowed: boolean;
}

export interface IStartExtensionTerminalRequest {
	proxy: ITerminalProcessExtHostProxy;
	cols: number;
	rows: number;
}

export interface IAvailableShellsRequest {
	callback: (shells: IShellDefinition[]) => void;
}

export interface IDefaultShellAndArgsRequest {
	useAutomationShell: boolean;
	callback: (shell: string, args: string[] | string | undefined) => void;
}

export enum LinuxDistro {
	Fedora,
	Ubuntu,
	Unknown
}

export enum TitleEventSource {
	/** From the API or the rename command that overrides any other type */
	Api,
	/** From the process name property*/
	Process,
	/** From the VT sequence */
	Sequence
}

export interface IWindowsShellHelper extends IDisposable {
	readonly onShellNameChange: Event<string>;

	getShellName(): Promise<string>;
}

/**
 * An interface representing a raw terminal child process, this contains a subset of the
 * child_process.ChildProcess node.js interface.
 */
export interface ITerminalChildProcess {
	onProcessData: Event<string>;
	onProcessExit: Event<number | undefined>;
	onProcessReady: Event<{ pid: number, cwd: string }>;
	onProcessTitleChanged: Event<string>;
	onProcessOverrideDimensions?: Event<ITerminalDimensions | undefined>;
	onProcessResolvedShellLaunchConfig?: Event<IShellLaunchConfig>;

	/**
	 * Shutdown the terminal process.
	 *
	 * @param immediate When true the process will be killed immediately, otherwise the process will
	 * be given some time to make sure no additional data comes through.
	 */
	shutdown(immediate: boolean): void;
	input(data: string): void;
	resize(cols: number, rows: number): void;

	getInitialCwd(): Promise<string>;
	getCwd(): Promise<string>;
	getLatency(): Promise<number>;
}

export const enum TERMINAL_COMMAND_ID {
	FIND_NEXT = 'workbench.action.terminal.findNext',
	FIND_PREVIOUS = 'workbench.action.terminal.findPrevious',
	TOGGLE = 'workbench.action.terminal.toggleTerminal',
	KILL = 'workbench.action.terminal.kill',
	QUICK_KILL = 'workbench.action.terminal.quickKill',
	COPY_SELECTION = 'workbench.action.terminal.copySelection',
	SELECT_ALL = 'workbench.action.terminal.selectAll',
	DELETE_WORD_LEFT = 'workbench.action.terminal.deleteWordLeft',
	DELETE_WORD_RIGHT = 'workbench.action.terminal.deleteWordRight',
	DELETE_TO_LINE_START = 'workbench.action.terminal.deleteToLineStart',
	MOVE_TO_LINE_START = 'workbench.action.terminal.moveToLineStart',
	MOVE_TO_LINE_END = 'workbench.action.terminal.moveToLineEnd',
	NEW = 'workbench.action.terminal.new',
	NEW_WITH_CWD = 'workbench.action.terminal.newWithCwd',
	NEW_LOCAL = 'workbench.action.terminal.newLocal',
	NEW_IN_ACTIVE_WORKSPACE = 'workbench.action.terminal.newInActiveWorkspace',
	SPLIT = 'workbench.action.terminal.split',
	SPLIT_IN_ACTIVE_WORKSPACE = 'workbench.action.terminal.splitInActiveWorkspace',
	RELAUNCH = 'workbench.action.terminal.relaunch',
	FOCUS_PREVIOUS_PANE = 'workbench.action.terminal.focusPreviousPane',
	FOCUS_NEXT_PANE = 'workbench.action.terminal.focusNextPane',
	RESIZE_PANE_LEFT = 'workbench.action.terminal.resizePaneLeft',
	RESIZE_PANE_RIGHT = 'workbench.action.terminal.resizePaneRight',
	RESIZE_PANE_UP = 'workbench.action.terminal.resizePaneUp',
	RESIZE_PANE_DOWN = 'workbench.action.terminal.resizePaneDown',
	FOCUS = 'workbench.action.terminal.focus',
	FOCUS_NEXT = 'workbench.action.terminal.focusNext',
	FOCUS_PREVIOUS = 'workbench.action.terminal.focusPrevious',
	PASTE = 'workbench.action.terminal.paste',
	SELECT_DEFAULT_SHELL = 'workbench.action.terminal.selectDefaultShell',
	RUN_SELECTED_TEXT = 'workbench.action.terminal.runSelectedText',
	RUN_ACTIVE_FILE = 'workbench.action.terminal.runActiveFile',
	SWITCH_TERMINAL = 'workbench.action.terminal.switchTerminal',
	SCROLL_DOWN_LINE = 'workbench.action.terminal.scrollDown',
	SCROLL_DOWN_PAGE = 'workbench.action.terminal.scrollDownPage',
	SCROLL_TO_BOTTOM = 'workbench.action.terminal.scrollToBottom',
	SCROLL_UP_LINE = 'workbench.action.terminal.scrollUp',
	SCROLL_UP_PAGE = 'workbench.action.terminal.scrollUpPage',
	SCROLL_TO_TOP = 'workbench.action.terminal.scrollToTop',
	CLEAR = 'workbench.action.terminal.clear',
	CLEAR_SELECTION = 'workbench.action.terminal.clearSelection',
	MANAGE_WORKSPACE_SHELL_PERMISSIONS = 'workbench.action.terminal.manageWorkspaceShellPermissions',
	RENAME = 'workbench.action.terminal.rename',
	RENAME_WITH_ARG = 'workbench.action.terminal.renameWithArg',
	FIND_FOCUS = 'workbench.action.terminal.focusFind',
	FIND_HIDE = 'workbench.action.terminal.hideFind',
	QUICK_OPEN_TERM = 'workbench.action.quickOpenTerm',
	SCROLL_TO_PREVIOUS_COMMAND = 'workbench.action.terminal.scrollToPreviousCommand',
	SCROLL_TO_NEXT_COMMAND = 'workbench.action.terminal.scrollToNextCommand',
	SELECT_TO_PREVIOUS_COMMAND = 'workbench.action.terminal.selectToPreviousCommand',
	SELECT_TO_NEXT_COMMAND = 'workbench.action.terminal.selectToNextCommand',
	SELECT_TO_PREVIOUS_LINE = 'workbench.action.terminal.selectToPreviousLine',
	SELECT_TO_NEXT_LINE = 'workbench.action.terminal.selectToNextLine',
	TOGGLE_ESCAPE_SEQUENCE_LOGGING = 'toggleEscapeSequenceLogging',
	SEND_SEQUENCE = 'workbench.action.terminal.sendSequence',
	TOGGLE_FIND_REGEX = 'workbench.action.terminal.toggleFindRegex',
	TOGGLE_FIND_WHOLE_WORD = 'workbench.action.terminal.toggleFindWholeWord',
	TOGGLE_FIND_CASE_SENSITIVE = 'workbench.action.terminal.toggleFindCaseSensitive',
	NAVIGATION_MODE_EXIT = 'workbench.action.terminal.navigationModeExit',
	NAVIGATION_MODE_FOCUS_NEXT = 'workbench.action.terminal.navigationModeFocusNext',
	NAVIGATION_MODE_FOCUS_PREVIOUS = 'workbench.action.terminal.navigationModeFocusPrevious',
	SHOW_ENVIRONMENT_INFORMATION = 'workbench.action.terminal.showEnvironmentInformation'
}

export const DEFAULT_COMMANDS_TO_SKIP_SHELL: string[] = [
	TERMINAL_COMMAND_ID.CLEAR_SELECTION,
	TERMINAL_COMMAND_ID.CLEAR,
	TERMINAL_COMMAND_ID.COPY_SELECTION,
	TERMINAL_COMMAND_ID.DELETE_TO_LINE_START,
	TERMINAL_COMMAND_ID.DELETE_WORD_LEFT,
	TERMINAL_COMMAND_ID.DELETE_WORD_RIGHT,
	TERMINAL_COMMAND_ID.FIND_FOCUS,
	TERMINAL_COMMAND_ID.FIND_HIDE,
	TERMINAL_COMMAND_ID.FIND_NEXT,
	TERMINAL_COMMAND_ID.FIND_PREVIOUS,
	TERMINAL_COMMAND_ID.TOGGLE_FIND_REGEX,
	TERMINAL_COMMAND_ID.TOGGLE_FIND_WHOLE_WORD,
	TERMINAL_COMMAND_ID.TOGGLE_FIND_CASE_SENSITIVE,
	TERMINAL_COMMAND_ID.FOCUS_NEXT_PANE,
	TERMINAL_COMMAND_ID.FOCUS_NEXT,
	TERMINAL_COMMAND_ID.FOCUS_PREVIOUS_PANE,
	TERMINAL_COMMAND_ID.FOCUS_PREVIOUS,
	TERMINAL_COMMAND_ID.FOCUS,
	TERMINAL_COMMAND_ID.KILL,
	TERMINAL_COMMAND_ID.MOVE_TO_LINE_END,
	TERMINAL_COMMAND_ID.MOVE_TO_LINE_START,
	TERMINAL_COMMAND_ID.NEW_IN_ACTIVE_WORKSPACE,
	TERMINAL_COMMAND_ID.NEW,
	TERMINAL_COMMAND_ID.PASTE,
	TERMINAL_COMMAND_ID.RESIZE_PANE_DOWN,
	TERMINAL_COMMAND_ID.RESIZE_PANE_LEFT,
	TERMINAL_COMMAND_ID.RESIZE_PANE_RIGHT,
	TERMINAL_COMMAND_ID.RESIZE_PANE_UP,
	TERMINAL_COMMAND_ID.RUN_ACTIVE_FILE,
	TERMINAL_COMMAND_ID.RUN_SELECTED_TEXT,
	TERMINAL_COMMAND_ID.SCROLL_DOWN_LINE,
	TERMINAL_COMMAND_ID.SCROLL_DOWN_PAGE,
	TERMINAL_COMMAND_ID.SCROLL_TO_BOTTOM,
	TERMINAL_COMMAND_ID.SCROLL_TO_NEXT_COMMAND,
	TERMINAL_COMMAND_ID.SCROLL_TO_PREVIOUS_COMMAND,
	TERMINAL_COMMAND_ID.SCROLL_TO_TOP,
	TERMINAL_COMMAND_ID.SCROLL_UP_LINE,
	TERMINAL_COMMAND_ID.SCROLL_UP_PAGE,
	TERMINAL_COMMAND_ID.SEND_SEQUENCE,
	TERMINAL_COMMAND_ID.SELECT_ALL,
	TERMINAL_COMMAND_ID.SELECT_TO_NEXT_COMMAND,
	TERMINAL_COMMAND_ID.SELECT_TO_NEXT_LINE,
	TERMINAL_COMMAND_ID.SELECT_TO_PREVIOUS_COMMAND,
	TERMINAL_COMMAND_ID.SELECT_TO_PREVIOUS_LINE,
	TERMINAL_COMMAND_ID.SPLIT_IN_ACTIVE_WORKSPACE,
	TERMINAL_COMMAND_ID.SPLIT,
	TERMINAL_COMMAND_ID.TOGGLE,
	TERMINAL_COMMAND_ID.NAVIGATION_MODE_EXIT,
	TERMINAL_COMMAND_ID.NAVIGATION_MODE_FOCUS_NEXT,
	TERMINAL_COMMAND_ID.NAVIGATION_MODE_FOCUS_PREVIOUS,
	'editor.action.toggleTabFocusMode',
	'workbench.action.quickOpen',
	'workbench.action.quickOpenPreviousEditor',
	'workbench.action.showCommands',
	'workbench.action.tasks.build',
	'workbench.action.tasks.restartTask',
	'workbench.action.tasks.runTask',
	'workbench.action.tasks.reRunTask',
	'workbench.action.tasks.showLog',
	'workbench.action.tasks.showTasks',
	'workbench.action.tasks.terminate',
	'workbench.action.tasks.test',
	'workbench.action.toggleFullScreen',
	'workbench.action.terminal.focusAtIndex1',
	'workbench.action.terminal.focusAtIndex2',
	'workbench.action.terminal.focusAtIndex3',
	'workbench.action.terminal.focusAtIndex4',
	'workbench.action.terminal.focusAtIndex5',
	'workbench.action.terminal.focusAtIndex6',
	'workbench.action.terminal.focusAtIndex7',
	'workbench.action.terminal.focusAtIndex8',
	'workbench.action.terminal.focusAtIndex9',
	'workbench.action.focusSecondEditorGroup',
	'workbench.action.focusThirdEditorGroup',
	'workbench.action.focusFourthEditorGroup',
	'workbench.action.focusFifthEditorGroup',
	'workbench.action.focusSixthEditorGroup',
	'workbench.action.focusSeventhEditorGroup',
	'workbench.action.focusEighthEditorGroup',
	'workbench.action.focusNextPart',
	'workbench.action.focusPreviousPart',
	'workbench.action.nextPanelView',
	'workbench.action.previousPanelView',
	'workbench.action.nextSideBarView',
	'workbench.action.previousSideBarView',
	'workbench.action.debug.start',
	'workbench.action.debug.stop',
	'workbench.action.debug.run',
	'workbench.action.debug.restart',
	'workbench.action.debug.continue',
	'workbench.action.debug.pause',
	'workbench.action.debug.stepInto',
	'workbench.action.debug.stepOut',
	'workbench.action.debug.stepOver',
	'workbench.action.nextEditor',
	'workbench.action.previousEditor',
	'workbench.action.nextEditorInGroup',
	'workbench.action.previousEditorInGroup',
	'workbench.action.openNextRecentlyUsedEditor',
	'workbench.action.openPreviousRecentlyUsedEditor',
	'workbench.action.openNextRecentlyUsedEditorInGroup',
	'workbench.action.openPreviousRecentlyUsedEditorInGroup',
	'workbench.action.quickOpenPreviousRecentlyUsedEditor',
	'workbench.action.quickOpenLeastRecentlyUsedEditor',
	'workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup',
	'workbench.action.quickOpenLeastRecentlyUsedEditorInGroup',
	'workbench.action.focusActiveEditorGroup',
	'workbench.action.focusFirstEditorGroup',
	'workbench.action.focusLastEditorGroup',
	'workbench.action.firstEditorInGroup',
	'workbench.action.lastEditorInGroup',
	'workbench.action.navigateUp',
	'workbench.action.navigateDown',
	'workbench.action.navigateRight',
	'workbench.action.navigateLeft',
	'workbench.action.togglePanel',
	'workbench.action.quickOpenView',
	'workbench.action.toggleMaximizedPanel'
];
