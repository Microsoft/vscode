/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IProcessEnvironment, OperatingSystem } from 'vs/base/common/platform';
import { IExtensionPointDescriptor } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { IProcessDataEvent, IShellLaunchConfig, ITerminalDimensions, ITerminalDimensionsOverride, ITerminalEnvironment, ITerminalLaunchError, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { IEnvironmentVariableInfo } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const TERMINAL_VIEW_ID = 'terminal';

/** A context key that is set when there is at least one opened integrated terminal. */
export const KEYBINDING_CONTEXT_TERMINAL_IS_OPEN = new RawContextKey<boolean>('terminalIsOpen', false, true);

/** A context key that is set when the integrated terminal has focus. */
export const KEYBINDING_CONTEXT_TERMINAL_FOCUS = new RawContextKey<boolean>('terminalFocus', false, nls.localize('terminalFocusContextKey', "Whether the terminal is focused"));

/** A context key that is set to the current number of integrated terminals. */
export const KEYBINDING_CONTEXT_TERMINAL_COUNT = new RawContextKey<number>('terminalCount', 0, nls.localize('terminalCountContextKey', "The current number of terminals"));

/** A context key that is set when the terminal tabs view is narrow. */
export const KEYBINDING_CONTEXT_TERMINAL_IS_TABS_NARROW_FOCUS = new RawContextKey<boolean>('isTerminalTabsNarrow', false, true);

/** A context key that is set when the integrated terminal tabs widget has focus. */
export const KEYBINDING_CONTEXT_TERMINAL_TABS_FOCUS = new RawContextKey<boolean>('terminalTabsFocus', false, nls.localize('terminalTabsFocusContextKey', "Whether the terminal tabs widget is focused"));

export const KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY = 'terminalShellType';
/** A context key that is set to the detected shell for the most recently active terminal, this is set to the last known value when no terminals exist. */
export const KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE = new RawContextKey<string>(KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY, undefined, { type: 'string', description: nls.localize('terminalShellTypeContextKey', "The shell type of the active terminal") });

export const KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE = new RawContextKey<boolean>('terminalAltBufferActive', false, true);

/** A context key that is set when the integrated terminal does not have focus. */
export const KEYBINDING_CONTEXT_TERMINAL_NOT_FOCUSED = KEYBINDING_CONTEXT_TERMINAL_FOCUS.toNegated();

/** A context key that is set when the user is navigating the accessibility tree */
export const KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS = new RawContextKey<boolean>('terminalA11yTreeFocus', false, true);

/** A keybinding context key that is set when the integrated terminal has text selected. */
export const KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED = new RawContextKey<boolean>('terminalTextSelected', false, nls.localize('terminalTextSelectedContextKey', "Whether text is selected in the active terminal"));
/** A keybinding context key that is set when the integrated terminal does not have text selected. */
export const KEYBINDING_CONTEXT_TERMINAL_TEXT_NOT_SELECTED = KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED.toNegated();

/**  A context key that is set when the find widget in integrated terminal is visible. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE = new RawContextKey<boolean>('terminalFindVisible', false, true);
/**  A context key that is set when the find widget in integrated terminal is not visible. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_NOT_VISIBLE = KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE.toNegated();
/**  A context key that is set when the find widget find input in integrated terminal is focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_INPUT_FOCUSED = new RawContextKey<boolean>('terminalFindInputFocused', false, true);
/**  A context key that is set when the find widget in integrated terminal is focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED = new RawContextKey<boolean>('terminalFindFocused', false, true);
/**  A context key that is set when the find widget find input in integrated terminal is not focused. */
export const KEYBINDING_CONTEXT_TERMINAL_FIND_INPUT_NOT_FOCUSED = KEYBINDING_CONTEXT_TERMINAL_FIND_INPUT_FOCUSED.toNegated();

export const KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED = new RawContextKey<boolean>('terminalProcessSupported', false, nls.localize('terminalProcessSupportedContextKey', "Whether terminal processes can be launched"));

export const KEYBINDING_CONTEXT_TERMINAL_TABS_SINGULAR_SELECTION = new RawContextKey<boolean>('terminalTabsSingularSelection', false, nls.localize('terminalTabsSingularSelectedContextKey', "Whether one terminal tab is selected"));

export const NEVER_MEASURE_RENDER_TIME_STORAGE_KEY = 'terminal.integrated.neverMeasureRenderTime';

export const TERMINAL_CREATION_COMMANDS = ['workbench.action.terminal.toggleTerminal', 'workbench.action.terminal.new', 'workbench.action.togglePanel', 'workbench.action.terminal.focus'];

export const SUGGESTED_RENDERER_TYPE = 'terminal.integrated.suggestedRendererType';

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

export const MINIMUM_FONT_WEIGHT = 1;
export const MAXIMUM_FONT_WEIGHT = 1000;
export const DEFAULT_FONT_WEIGHT = 'normal';
export const DEFAULT_BOLD_FONT_WEIGHT = 'bold';
export const SUGGESTIONS_FONT_WEIGHT = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

export const ITerminalProfileResolverService = createDecorator<ITerminalProfileResolverService>('terminalProfileResolverService');
export interface ITerminalProfileResolverService {
	readonly _serviceBrand: undefined;
	/**
	 * Resolves the icon of a shell launch config if this will use the default profile
	 */
	resolveIcon(shellLaunchConfig: IShellLaunchConfig, os: OperatingSystem): void;
	resolveShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig, options: IShellLaunchConfigResolveOptions): Promise<void>;
	getDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile>;
	getDefaultShell(options: IShellLaunchConfigResolveOptions): Promise<string>;
	getDefaultShellArgs(options: IShellLaunchConfigResolveOptions): Promise<string | string[]>;
	getEnvironment(remoteAuthority: string | undefined): Promise<IProcessEnvironment>;

	// TODO: Remove when workspace trust is enabled
	getSafeConfigValue(key: string, os: OperatingSystem): unknown | undefined;
	getSafeConfigValueFullKey(key: string): unknown | undefined;
}

export interface IShellLaunchConfigResolveOptions {
	remoteAuthority: string | undefined;
	os: OperatingSystem;
	allowAutomationShell?: boolean;
}

export type FontWeight = 'normal' | 'bold' | number;

export interface ITerminalProfiles {
	linux: { [key: string]: ITerminalProfileObject };
	osx: { [key: string]: ITerminalProfileObject };
	windows: { [key: string]: ITerminalProfileObject };
}

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
	profiles: ITerminalProfiles;
	defaultProfile: {
		linux: string | null;
		osx: string | null;
		windows: string | null;
	};
	useWslProfiles: boolean;
	altClickMovesCursor: boolean;
	macOptionIsMeta: boolean;
	macOptionClickForcesSelection: boolean;
	gpuAcceleration: 'auto' | 'on' | 'off';
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
	sendKeybindingsToShell: boolean;
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
	env: {
		linux: { [key: string]: string };
		osx: { [key: string]: string };
		windows: { [key: string]: string };
	};
	environmentChangesIndicator: 'off' | 'on' | 'warnonly';
	environmentChangesRelaunch: boolean;
	showExitAlert: boolean;
	splitCwd: 'workspaceRoot' | 'initial' | 'inherited';
	windowsEnableConpty: boolean;
	wordSeparators: string;
	experimentalUseTitleEvent: boolean;
	enableFileLinks: boolean;
	unicodeVersion: '6' | '11';
	experimentalLinkProvider: boolean;
	localEchoLatencyThreshold: number;
	localEchoExcludePrograms: ReadonlyArray<string>;
	localEchoStyle: 'bold' | 'dim' | 'italic' | 'underlined' | 'inverted' | string;
	enablePersistentSessions: boolean;
	tabs: {
		enabled: boolean;
		hideCondition: 'never' | 'singleTerminal';
		showActiveTerminal: 'always' | 'singleTerminal' | 'singleTerminalOrNarrow' | 'never';
		location: 'left' | 'right';
		focusMode: 'singleClick' | 'doubleClick';
	},
	bellDuration: number;
	allowWorkspaceConfiguration: boolean;
}

export const DEFAULT_LOCAL_ECHO_EXCLUDE: ReadonlyArray<string> = ['vim', 'vi', 'nano', 'tmux'];

export interface ITerminalConfigHelper {
	config: ITerminalConfiguration;

	configFontIsMonospace(): boolean;
	getFont(): ITerminalFont;
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

export interface IRemoteTerminalAttachTarget {
	id: number;
	pid: number;
	title: string;
	cwd: string;
	workspaceId: string;
	workspaceName: string;
	isOrphan: boolean;
	icon: string | undefined;
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

export interface ITerminalProfile {
	profileName: string;
	path: string;
	isAutoDetected?: boolean;
	args?: string | string[] | undefined;
	env?: ITerminalEnvironment;
	overrideName?: boolean;
	icon?: string;
}

export const enum ProfileSource {
	GitBash = 'Git Bash',
	Pwsh = 'PowerShell'
}

export interface ITerminalExecutable {
	path: string | string[];
	args?: string | string[] | undefined;
	isAutoDetected?: boolean;
	overrideName?: boolean;
	icon?: string;
	env?: ITerminalEnvironment;
}

export interface ITerminalProfileSource {
	source: ProfileSource;
	isAutoDetected?: boolean;
	overrideName?: boolean;
	args?: string | string[] | undefined;
	icon?: string;
	env?: ITerminalEnvironment;
}

export type ITerminalProfileObject = ITerminalExecutable | ITerminalProfileSource | null;

export interface IAvailableProfilesRequest {
	callback: (shells: ITerminalProfile[]) => void;
	configuredProfilesOnly: boolean;
}
export interface IDefaultShellAndArgsRequest {
	useAutomationShell: boolean;
	callback: (shell: string, args: string[] | string | undefined) => void;
}

export interface ITerminalProcessManager extends IDisposable {
	readonly processState: ProcessState;
	readonly ptyProcessReady: Promise<void>;
	readonly shellProcessId: number | undefined;
	readonly remoteAuthority: string | undefined;
	readonly os: OperatingSystem | undefined;
	readonly userHome: string | undefined;
	readonly environmentVariableInfo: IEnvironmentVariableInfo | undefined;
	readonly persistentProcessId: number | undefined;
	readonly shouldPersist: boolean;
	readonly isDisconnected: boolean;
	/** Whether the process has had data written to it yet. */
	readonly hasWrittenData: boolean;

	readonly onPtyDisconnect: Event<void>;
	readonly onPtyReconnect: Event<void>;

	readonly onProcessReady: Event<void>;
	readonly onBeforeProcessData: Event<IBeforeProcessDataEvent>;
	readonly onProcessData: Event<IProcessDataEvent>;
	readonly onProcessTitle: Event<string>;
	readonly onProcessShellTypeChanged: Event<TerminalShellType>;
	readonly onProcessExit: Event<number | undefined>;
	readonly onProcessOverrideDimensions: Event<ITerminalDimensionsOverride | undefined>;
	readonly onProcessResolvedShellLaunchConfig: Event<IShellLaunchConfig>;
	readonly onEnvironmentVariableInfoChanged: Event<IEnvironmentVariableInfo>;

	dispose(immediate?: boolean): void;
	detachFromProcess(): void;
	createProcess(shellLaunchConfig: IShellLaunchConfig, cols: number, rows: number, isScreenReaderModeEnabled: boolean): Promise<ITerminalLaunchError | undefined>;
	relaunch(shellLaunchConfig: IShellLaunchConfig, cols: number, rows: number, isScreenReaderModeEnabled: boolean, reset: boolean): Promise<ITerminalLaunchError | undefined>;
	write(data: string): void;
	setDimensions(cols: number, rows: number): Promise<void>;
	setDimensions(cols: number, rows: number, sync: false): Promise<void>;
	setDimensions(cols: number, rows: number, sync: true): void;
	acknowledgeDataEvent(charCount: number): void;
	processBinary(data: string): void;

	getInitialCwd(): Promise<string>;
	getCwd(): Promise<string>;
	getLatency(): Promise<number>;
}

export const enum ProcessState {
	// The process has not been initialized yet.
	Uninitialized,
	// The process is currently launching, the process is marked as launching
	// for a short duration after being created and is helpful to indicate
	// whether the process died as a result of bad shell and args.
	Launching,
	// The process is running normally.
	Running,
	// The process was killed during launch, likely as a result of bad shell and
	// args.
	KilledDuringLaunch,
	// The process was killed by the user (the event originated from VS Code).
	KilledByUser,
	// The process was killed by itself, for example the shell crashed or `exit`
	// was run.
	KilledByProcess
}

export interface ITerminalProcessExtHostProxy extends IDisposable {
	readonly instanceId: number;

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
	onBinary: Event<string>;
	onResize: Event<{ cols: number, rows: number }>;
	onAcknowledgeDataEvent: Event<number>;
	onShutdown: Event<boolean>;
	onRequestInitialCwd: Event<void>;
	onRequestCwd: Event<void>;
	onRequestLatency: Event<void>;
}

export interface IStartExtensionTerminalRequest {
	proxy: ITerminalProcessExtHostProxy;
	cols: number;
	rows: number;
	callback: (error: ITerminalLaunchError | undefined) => void;
}

export interface IDefaultShellAndArgsRequest {
	useAutomationShell: boolean;
	callback: (shell: string, args: string[] | string | undefined) => void;
}

export enum TitleEventSource {
	/** From the API or the rename command that overrides any other type */
	Api,
	/** From the process name property*/
	Process,
	/** From the VT sequence */
	Sequence
}

export const QUICK_LAUNCH_PROFILE_CHOICE = 'workbench.action.terminal.profile.choice';

export const enum TerminalSettingId {
	ShellLinux = 'terminal.integrated.shell.linux',
	ShellMacOs = 'terminal.integrated.shell.osx',
	ShellWindows = 'terminal.integrated.shell.windows',
	SendKeybindingsToShell = 'terminal.integrated.sendKeybindingsToShell',
	AutomationShellLinux = 'terminal.integrated.automationShell.linux',
	AutomationShellMacOs = 'terminal.integrated.automationShell.osx',
	AutomationShellWindows = 'terminal.integrated.automationShell.windows',
	ShellArgsLinux = 'terminal.integrated.shellArgs.linux',
	ShellArgsMacOs = 'terminal.integrated.shellArgs.osx',
	ShellArgsWindows = 'terminal.integrated.shellArgs.windows',
	ProfilesWindows = 'terminal.integrated.profiles.windows',
	ProfilesMacOs = 'terminal.integrated.profiles.osx',
	ProfilesLinux = 'terminal.integrated.profiles.linux',
	DefaultProfileLinux = 'terminal.integrated.defaultProfile.linux',
	DefaultProfileMacOs = 'terminal.integrated.defaultProfile.osx',
	DefaultProfileWindows = 'terminal.integrated.defaultProfile.windows',
	UseWslProfiles = 'terminal.integrated.useWslProfiles',
	TabsEnabled = 'terminal.integrated.tabs.enabled',
	TabsHideCondition = 'terminal.integrated.tabs.hideCondition',
	TabsShowActiveTerminal = 'terminal.integrated.tabs.showActiveTerminal',
	TabsLocation = 'terminal.integrated.tabs.location',
	TabsFocusMode = 'terminal.integrated.tabs.focusMode',
	MacOptionIsMeta = 'terminal.integrated.macOptionIsMeta',
	MacOptionClickForcesSelection = 'terminal.integrated.macOptionClickForcesSelection',
	AltClickMovesCursor = 'terminal.integrated.altClickMovesCursor',
	CopyOnSelection = 'terminal.integrated.copyOnSelection',
	DrawBoldTextInBrightColors = 'terminal.integrated.drawBoldTextInBrightColors',
	FontFamily = 'terminal.integrated.fontFamily',
	FontSize = 'terminal.integrated.fontSize',
	LetterSpacing = 'terminal.integrated.letterSpacing',
	LineHeight = 'terminal.integrated.lineHeight',
	MinimumContrastRatio = 'terminal.integrated.minimumContrastRatio',
	FastScrollSensitivity = 'terminal.integrated.fastScrollSensitivity',
	MouseWheelScrollSensitivity = 'terminal.integrated.mouseWheelScrollSensitivity',
	BellDuration = 'terminal.integrated.bellDuration',
	FontWeight = 'terminal.integrated.fontWeight',
	FontWeightBold = 'terminal.integrated.fontWeightBold',
	CursorBlinking = 'terminal.integrated.cursorBlinking',
	CursorStyle = 'terminal.integrated.cursorStyle',
	CursorWidth = 'terminal.integrated.cursorWidth',
	Scrollback = 'terminal.integrated.scrollback',
	DetectLocale = 'terminal.integrated.detectLocale',
	GpuAcceleration = 'terminal.integrated.gpuAcceleration',
	RightClickBehavior = 'terminal.integrated.rightClickBehavior',
	Cwd = 'terminal.integrated.cwd',
	ConfirmOnExit = 'terminal.integrated.confirmOnExit',
	EnableBell = 'terminal.integrated.enableBell',
	CommandsToSkipShell = 'terminal.integrated.commandsToSkipShell',
	AllowChords = 'terminal.integrated.allowChords',
	AllowMnemonics = 'terminal.integrated.allowMnemonics',
	EnvMacOs = 'terminal.integrated.env.osx',
	EnvLinux = 'terminal.integrated.env.linux',
	EnvWindows = 'terminal.integrated.env.windows',
	EnvironmentChangesIndicator = 'terminal.integrated.environmentChangesIndicator',
	EnvironmentChangesRelaunch = 'terminal.integrated.environmentChangesRelaunch',
	ShowExitAlert = 'terminal.integrated.showExitAlert',
	SplitCwd = 'terminal.integrated.splitCwd',
	WindowsEnableConpty = 'terminal.integrated.windowsEnableConpty',
	WordSeparators = 'terminal.integrated.wordSeparators',
	ExperimentalUseTitleEvent = 'terminal.integrated.experimentalUseTitleEvent',
	EnableFileLinks = 'terminal.integrated.enableFileLinks',
	UnicodeVersion = 'terminal.integrated.unicodeVersion',
	ExperimentalLinkProvider = 'terminal.integrated.experimentalLinkProvider',
	LocalEchoLatencyThreshold = 'terminal.integrated.localEchoLatencyThreshold',
	LocalEchoExcludePrograms = 'terminal.integrated.localEchoExcludePrograms',
	LocalEchoStyle = 'terminal.integrated.localEchoStyle',
	EnablePersistentSessions = 'terminal.integrated.enablePersistentSessions',
	AllowWorkspaceConfiguration = 'terminal.integrated.allowWorkspaceConfiguration'
}

export const enum TerminalCommandId {
	FindNext = 'workbench.action.terminal.findNext',
	FindPrevious = 'workbench.action.terminal.findPrevious',
	Toggle = 'workbench.action.terminal.toggleTerminal',
	Kill = 'workbench.action.terminal.kill',
	KillInstance = 'workbench.action.terminal.killInstance',
	QuickKill = 'workbench.action.terminal.quickKill',
	ConfigureTerminalSettings = 'workbench.action.terminal.openSettings',
	CopySelection = 'workbench.action.terminal.copySelection',
	SelectAll = 'workbench.action.terminal.selectAll',
	DeleteWordLeft = 'workbench.action.terminal.deleteWordLeft',
	DeleteWordRight = 'workbench.action.terminal.deleteWordRight',
	DeleteToLineStart = 'workbench.action.terminal.deleteToLineStart',
	MoveToLineStart = 'workbench.action.terminal.moveToLineStart',
	MoveToLineEnd = 'workbench.action.terminal.moveToLineEnd',
	New = 'workbench.action.terminal.new',
	NewWithCwd = 'workbench.action.terminal.newWithCwd',
	NewLocal = 'workbench.action.terminal.newLocal',
	NewInActiveWorkspace = 'workbench.action.terminal.newInActiveWorkspace',
	NewWithProfile = 'workbench.action.terminal.newWithProfile',
	Split = 'workbench.action.terminal.split',
	SplitInstance = 'workbench.action.terminal.splitInstance',
	SplitInActiveWorkspace = 'workbench.action.terminal.splitInActiveWorkspace',
	Relaunch = 'workbench.action.terminal.relaunch',
	FocusPreviousPane = 'workbench.action.terminal.focusPreviousPane',
	ShowTabs = 'workbench.action.terminal.showTabs',
	FocusTabs = 'workbench.action.terminal.focusTabs',
	FocusNextPane = 'workbench.action.terminal.focusNextPane',
	ResizePaneLeft = 'workbench.action.terminal.resizePaneLeft',
	ResizePaneRight = 'workbench.action.terminal.resizePaneRight',
	ResizePaneUp = 'workbench.action.terminal.resizePaneUp',
	CreateWithProfileButton = 'workbench.action.terminal.createProfileButton',
	ResizePaneDown = 'workbench.action.terminal.resizePaneDown',
	Focus = 'workbench.action.terminal.focus',
	FocusNext = 'workbench.action.terminal.focusNext',
	FocusPrevious = 'workbench.action.terminal.focusPrevious',
	Paste = 'workbench.action.terminal.paste',
	PasteSelection = 'workbench.action.terminal.pasteSelection',
	SelectDefaultProfile = 'workbench.action.terminal.selectDefaultShell',
	RunSelectedText = 'workbench.action.terminal.runSelectedText',
	RunActiveFile = 'workbench.action.terminal.runActiveFile',
	SwitchTerminal = 'workbench.action.terminal.switchTerminal',
	ScrollDownLine = 'workbench.action.terminal.scrollDown',
	ScrollDownPage = 'workbench.action.terminal.scrollDownPage',
	ScrollToBottom = 'workbench.action.terminal.scrollToBottom',
	ScrollUpLine = 'workbench.action.terminal.scrollUp',
	ScrollUpPage = 'workbench.action.terminal.scrollUpPage',
	ScrollToTop = 'workbench.action.terminal.scrollToTop',
	Clear = 'workbench.action.terminal.clear',
	ClearSelection = 'workbench.action.terminal.clearSelection',
	ChangeIcon = 'workbench.action.terminal.changeIcon',
	ChangeIconInstance = 'workbench.action.terminal.changeIconInstance',
	Rename = 'workbench.action.terminal.rename',
	RenameInstance = 'workbench.action.terminal.renameInstance',
	RenameWithArgs = 'workbench.action.terminal.renameWithArg',
	FindFocus = 'workbench.action.terminal.focusFind',
	FindHide = 'workbench.action.terminal.hideFind',
	QuickOpenTerm = 'workbench.action.quickOpenTerm',
	ScrollToPreviousCommand = 'workbench.action.terminal.scrollToPreviousCommand',
	ScrollToNextCommand = 'workbench.action.terminal.scrollToNextCommand',
	SelectToPreviousCommand = 'workbench.action.terminal.selectToPreviousCommand',
	SelectToNextCommand = 'workbench.action.terminal.selectToNextCommand',
	SelectToPreviousLine = 'workbench.action.terminal.selectToPreviousLine',
	SelectToNextLine = 'workbench.action.terminal.selectToNextLine',
	ToggleEscapeSequenceLogging = 'toggleEscapeSequenceLogging',
	SendSequence = 'workbench.action.terminal.sendSequence',
	ToggleFindRegex = 'workbench.action.terminal.toggleFindRegex',
	ToggleFindWholeWord = 'workbench.action.terminal.toggleFindWholeWord',
	ToggleFindCaseSensitive = 'workbench.action.terminal.toggleFindCaseSensitive',
	NavigationModeExit = 'workbench.action.terminal.navigationModeExit',
	NavigationModeFocusNext = 'workbench.action.terminal.navigationModeFocusNext',
	NavigationModeFocusPrevious = 'workbench.action.terminal.navigationModeFocusPrevious',
	ShowEnvironmentInformation = 'workbench.action.terminal.showEnvironmentInformation',
	SearchWorkspace = 'workbench.action.terminal.searchWorkspace',
	AttachToRemoteTerminal = 'workbench.action.terminal.attachToSession'
}

export const DEFAULT_COMMANDS_TO_SKIP_SHELL: string[] = [
	TerminalCommandId.ClearSelection,
	TerminalCommandId.Clear,
	TerminalCommandId.CopySelection,
	TerminalCommandId.DeleteToLineStart,
	TerminalCommandId.DeleteWordLeft,
	TerminalCommandId.DeleteWordRight,
	TerminalCommandId.FindFocus,
	TerminalCommandId.FindHide,
	TerminalCommandId.FindNext,
	TerminalCommandId.FindPrevious,
	TerminalCommandId.ToggleFindRegex,
	TerminalCommandId.ToggleFindWholeWord,
	TerminalCommandId.ToggleFindCaseSensitive,
	TerminalCommandId.FocusNextPane,
	TerminalCommandId.FocusNext,
	TerminalCommandId.FocusPreviousPane,
	TerminalCommandId.FocusPrevious,
	TerminalCommandId.Focus,
	TerminalCommandId.Kill,
	TerminalCommandId.MoveToLineEnd,
	TerminalCommandId.MoveToLineStart,
	TerminalCommandId.NewInActiveWorkspace,
	TerminalCommandId.New,
	TerminalCommandId.Paste,
	TerminalCommandId.PasteSelection,
	TerminalCommandId.ResizePaneDown,
	TerminalCommandId.ResizePaneLeft,
	TerminalCommandId.ResizePaneRight,
	TerminalCommandId.ResizePaneUp,
	TerminalCommandId.RunActiveFile,
	TerminalCommandId.RunSelectedText,
	TerminalCommandId.ScrollDownLine,
	TerminalCommandId.ScrollDownPage,
	TerminalCommandId.ScrollToBottom,
	TerminalCommandId.ScrollToNextCommand,
	TerminalCommandId.ScrollToPreviousCommand,
	TerminalCommandId.ScrollToTop,
	TerminalCommandId.ScrollUpLine,
	TerminalCommandId.ScrollUpPage,
	TerminalCommandId.SendSequence,
	TerminalCommandId.SelectAll,
	TerminalCommandId.SelectToNextCommand,
	TerminalCommandId.SelectToNextLine,
	TerminalCommandId.SelectToPreviousCommand,
	TerminalCommandId.SelectToPreviousLine,
	TerminalCommandId.SplitInActiveWorkspace,
	TerminalCommandId.Split,
	TerminalCommandId.Toggle,
	TerminalCommandId.NavigationModeExit,
	TerminalCommandId.NavigationModeFocusNext,
	TerminalCommandId.NavigationModeFocusPrevious,
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

export interface ITerminalContributions {
	types?: ITerminalTypeContribution[];
}

export interface ITerminalTypeContribution {
	title: string;
	command: string;
	icon?: string;
}

export const terminalContributionsDescriptor: IExtensionPointDescriptor = {
	extensionPoint: 'terminal',
	defaultExtensionKind: 'workspace',
	jsonSchema: {
		description: nls.localize('vscode.extension.contributes.terminal', 'Contributes terminal functionality.'),
		type: 'object',
		properties: {
			types: {
				type: 'array',
				description: nls.localize('vscode.extension.contributes.terminal.types', "Defines additional terminal types that the user can create."),
				items: {
					type: 'object',
					required: ['command', 'title'],
					properties: {
						command: {
							description: nls.localize('vscode.extension.contributes.terminal.types.command', "Command to execute when the user creates this type of terminal."),
							type: 'string',
						},
						title: {
							description: nls.localize('vscode.extension.contributes.terminal.types.title', "Title for this type of terminal."),
							type: 'string',
						},
						icon: {
							description: nls.localize('vscode.extension.contributes.terminal.types.icon', "A codicon to associate with this terminal type."),
							type: 'string',
						},
					},
				},
			},
		},
	},
};
