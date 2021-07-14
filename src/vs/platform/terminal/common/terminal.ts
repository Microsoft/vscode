/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IProcessEnvironment, OperatingSystem } from 'vs/base/common/platform';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IGetTerminalLayoutInfoArgs, IProcessDetails, IPtyHostProcessReplayEvent, ISetTerminalLayoutInfoArgs } from 'vs/platform/terminal/common/terminalProcess';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

export const enum TerminalSettingPrefix {
	Shell = 'terminal.integrated.shell.',
	ShellArgs = 'terminal.integrated.shellArgs.',
	DefaultProfile = 'terminal.integrated.defaultProfile.',
	Profiles = 'terminal.integrated.profiles.'
}

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
	TabsEnableAnimation = 'terminal.integrated.tabs.enableAnimation',
	TabsHideCondition = 'terminal.integrated.tabs.hideCondition',
	TabsShowActiveTerminal = 'terminal.integrated.tabs.showActiveTerminal',
	TabsShowActions = 'terminal.integrated.tabs.showActions',
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
	DefaultLocation = 'terminal.integrated.defaultLocation',
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
	TitleMode = 'terminal.integrated.titleMode',
	EnableFileLinks = 'terminal.integrated.enableFileLinks',
	UnicodeVersion = 'terminal.integrated.unicodeVersion',
	ExperimentalLinkProvider = 'terminal.integrated.experimentalLinkProvider',
	LocalEchoLatencyThreshold = 'terminal.integrated.localEchoLatencyThreshold',
	LocalEchoExcludePrograms = 'terminal.integrated.localEchoExcludePrograms',
	LocalEchoStyle = 'terminal.integrated.localEchoStyle',
	EnablePersistentSessions = 'terminal.integrated.enablePersistentSessions',
	InheritEnv = 'terminal.integrated.inheritEnv',
	ShowLinkHover = 'terminal.integrated.showLinkHover',
}

export enum WindowsShellType {
	CommandPrompt = 'cmd',
	PowerShell = 'pwsh',
	Wsl = 'wsl',
	GitBash = 'gitbash'
}
export type TerminalShellType = WindowsShellType | undefined;
export interface IRawTerminalInstanceLayoutInfo<T> {
	relativeSize: number;
	terminal: T;
}
export type ITerminalInstanceLayoutInfoById = IRawTerminalInstanceLayoutInfo<number>;
export type ITerminalInstanceLayoutInfo = IRawTerminalInstanceLayoutInfo<IPtyHostAttachTarget>;

export interface IRawTerminalTabLayoutInfo<T> {
	isActive: boolean;
	activePersistentProcessId: number | undefined;
	terminals: IRawTerminalInstanceLayoutInfo<T>[];
}

export type ITerminalTabLayoutInfoById = IRawTerminalTabLayoutInfo<number>;

export interface IRawTerminalsLayoutInfo<T> {
	tabs: IRawTerminalTabLayoutInfo<T>[];
}

export interface IPtyHostAttachTarget {
	id: number;
	pid: number;
	title: string;
	titleSource: TitleEventSource;
	cwd: string;
	workspaceId: string;
	workspaceName: string;
	isOrphan: boolean;
	icon: TerminalIcon | undefined;
}

export enum TitleEventSource {
	/** From the API or the rename command that overrides any other type */
	Api,
	/** From the process name property*/
	Process,
	/** From the VT sequence */
	Sequence
}

export type ITerminalsLayoutInfo = IRawTerminalsLayoutInfo<IPtyHostAttachTarget | null>;
export type ITerminalsLayoutInfoById = IRawTerminalsLayoutInfo<number>;

export interface IRawTerminalInstanceLayoutInfo<T> {
	relativeSize: number;
	terminal: T;
}

export enum TerminalIpcChannels {
	/**
	 * Communicates between the renderer process and shared process.
	 */
	LocalPty = 'localPty',
	/**
	 * Communicates between the shared process and the pty host process.
	 */
	PtyHost = 'ptyHost',
	/**
	 * Deals with logging from the pty host process.
	 */
	Log = 'log',
	/**
	 * Enables the detection of unresponsive pty hosts.
	 */
	Heartbeat = 'heartbeat'
}

export const IPtyService = createDecorator<IPtyService>('ptyService');
export interface IPtyService {
	readonly _serviceBrand: undefined;

	readonly onPtyHostExit?: Event<number>;
	readonly onPtyHostStart?: Event<void>;
	readonly onPtyHostUnresponsive?: Event<void>;
	readonly onPtyHostResponsive?: Event<void>;
	readonly onPtyHostRequestResolveVariables?: Event<IRequestResolveVariablesEvent>;

	readonly onProcessData: Event<{ id: number, event: IProcessDataEvent | string }>;
	readonly onProcessExit: Event<{ id: number, event: number | undefined }>;
	readonly onProcessReady: Event<{ id: number, event: { pid: number, cwd: string } }>;
	readonly onProcessTitleChanged: Event<{ id: number, event: string }>;
	readonly onProcessShellTypeChanged: Event<{ id: number, event: TerminalShellType }>;
	readonly onProcessOverrideDimensions: Event<{ id: number, event: ITerminalDimensionsOverride | undefined }>;
	readonly onProcessResolvedShellLaunchConfig: Event<{ id: number, event: IShellLaunchConfig }>;
	readonly onProcessReplay: Event<{ id: number, event: IPtyHostProcessReplayEvent }>;
	readonly onProcessOrphanQuestion: Event<{ id: number }>;
	readonly onDidRequestDetach: Event<{ workspaceId: string, instanceId: number }>;

	restartPtyHost?(): Promise<void>;
	shutdownAll?(): Promise<void>;
	acceptPtyHostResolvedVariables?(id: number, resolved: string[]): Promise<void>;

	createProcess(
		shellLaunchConfig: IShellLaunchConfig,
		cwd: string,
		cols: number,
		rows: number,
		env: IProcessEnvironment,
		executableEnv: IProcessEnvironment,
		windowsEnableConpty: boolean,
		shouldPersist: boolean,
		workspaceId: string,
		workspaceName: string
	): Promise<number>;
	attachToProcess(id: number): Promise<void>;
	detachFromProcess(id: number): Promise<void>;

	/**
	 * Lists orphaned processes, ie. those without a connected frontend, unless only the detached one (via a drop between windows) is requested.
	 */
	listProcesses(getDetachedInstance?: boolean): Promise<IProcessDetails[]>;

	start(id: number): Promise<ITerminalLaunchError | undefined>;
	shutdown(id: number, immediate: boolean): Promise<void>;
	input(id: number, data: string): Promise<void>;
	resize(id: number, cols: number, rows: number): Promise<void>;
	getInitialCwd(id: number): Promise<string>;
	getCwd(id: number): Promise<string>;
	getLatency(id: number): Promise<number>;
	acknowledgeDataEvent(id: number, charCount: number): Promise<void>;
	processBinary(id: number, data: string): Promise<void>;
	/** Confirm the process is _not_ an orphan. */
	orphanQuestionReply(id: number): Promise<void>;
	updateTitle(id: number, title: string, titleSource: TitleEventSource): Promise<void>;
	updateIcon(id: number, icon: TerminalIcon, color?: string): Promise<void>;
	getDefaultSystemShell(osOverride?: OperatingSystem): Promise<string>;
	getProfiles?(workspaceId: string, profiles: unknown, defaultProfile: unknown, includeDetectedProfiles?: boolean): Promise<ITerminalProfile[]>;
	getEnvironment(): Promise<IProcessEnvironment>;
	getWslPath(original: string): Promise<string>;
	setTerminalLayoutInfo(args: ISetTerminalLayoutInfoArgs): Promise<void>;
	getTerminalLayoutInfo(args: IGetTerminalLayoutInfoArgs): Promise<ITerminalsLayoutInfo | undefined>;
	reduceConnectionGraceTime(): Promise<void>;
	requestDetachInstance(workspaceId: string, instanceId: number): Promise<void>;
	acceptInstanceForAttachment(persistentProcessId: number): Promise<void>;
}

export interface IRequestResolveVariablesEvent {
	id: number;
	workspaceId: string;
	originalText: string[];
}

export enum HeartbeatConstants {
	/**
	 * The duration between heartbeats
	 */
	BeatInterval = 5000,
	/**
	 * Defines a multiplier for BeatInterval for how long to wait before starting the second wait
	 * timer.
	 */
	FirstWaitMultiplier = 1.2,
	/**
	 * Defines a multiplier for BeatInterval for how long to wait before telling the user about
	 * non-responsiveness. The second timer is to avoid informing the user incorrectly when waking
	 * the computer up from sleep
	 */
	SecondWaitMultiplier = 1,
	/**
	 * How long to wait before telling the user about non-responsiveness when they try to create a
	 * process. This short circuits the standard wait timeouts to tell the user sooner and only
	 * create process is handled to avoid additional perf overhead.
	 */
	CreateProcessTimeout = 5000
}

export interface IHeartbeatService {
	readonly onBeat: Event<void>;
}

export interface IShellLaunchConfig {
	/**
	 * The name of the terminal, if this is not set the name of the process will be used.
	 */
	name?: string;

	/**
	 * An string to follow the name of the terminal with, indicating a special kind of terminal
	 */
	description?: string;

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
	 * Custom PTY/pseudoterminal process to use.
	 */
	customPtyImplementation?: (terminalId: number, cols: number, rows: number) => ITerminalChildProcess;

	/**
	 * A UUID generated by the extension host process for terminals created on the extension host process.
	 */
	extHostTerminalId?: string;

	/**
	 * This is a terminal that attaches to an already running terminal.
	 */
	attachPersistentProcess?: { id: number; pid: number; title: string; titleSource: TitleEventSource; cwd: string; icon?: TerminalIcon; color?: string };

	/**
	 * Whether the terminal process environment should be exactly as provided in
	 * `TerminalOptions.env`. When this is false (default), the environment will be based on the
	 * window's environment and also apply configured platform settings like
	 * `terminal.integrated.windows.env` on top. When this is true, the complete environment must be
	 * provided as nothing will be inherited from the process or any configuration.
	 */
	strictEnv?: boolean;

	/**
	 * Whether the terminal process environment will inherit VS Code's "shell environment" that may
	 * get sourced from running a login shell depnding on how the application was launched.
	 * Consumers that rely on development tools being present in the $PATH should set this to true.
	 * This will overwrite the value of the inheritEnv setting.
	 */
	useShellEnvironment?: boolean;

	/**
	 * When enabled the terminal will run the process as normal but not be surfaced to the user
	 * until `Terminal.show` is called. The typical usage for this is when you need to run
	 * something that may need interactivity but only want to tell the user about it when
	 * interaction is needed. Note that the terminals will still be exposed to all extensions
	 * as normal.
	 */
	hideFromUser?: boolean;

	/**
	 * Whether this terminal is not a terminal that the user directly created and uses, but rather
	 * a terminal used to drive some VS Code feature.
	 */
	isFeatureTerminal?: boolean;

	/**
	 * Whether this terminal was created by an extension.
	 */
	isExtensionOwnedTerminal?: boolean;

	/**
	 * The icon for the terminal, used primarily in the terminal tab.
	 */
	icon?: TerminalIcon;

	/**
	 * The color ID to use for this terminal. If not specified it will use the default fallback
	 */
	color?: string;
}

export interface ICreateTerminalOptions {
	/**
	 * The shell launch config or profile to launch with, when not specified the default terminal
	 * profile will be used.
	 */
	config?: IShellLaunchConfig | ITerminalProfile;
	/**
	 * The current working directory to start with, this will override IShellLaunchConfig.cwd if
	 * specified.
	 */
	cwd?: string | URI;
	/**
	 * Where to create the terminal, when not specified the default target will be used.
	 */
	target?: TerminalLocation;
}

export interface ICreateContributedTerminalProfileOptions {
	isSplitTerminal: boolean;
	target?: TerminalLocation;
	icon?: string;
}

export const enum TerminalLocation {
	TerminalView = 'view',
	Editor = 'editor'
}

export type TerminalIcon = ThemeIcon | URI | { light: URI; dark: URI };

export interface IShellLaunchConfigDto {
	name?: string;
	executable?: string;
	args?: string[] | string;
	cwd?: string | UriComponents;
	env?: ITerminalEnvironment;
	useShellEnvironment?: boolean;
	hideFromUser?: boolean;
}

export interface ITerminalEnvironment {
	[key: string]: string | null | undefined;
}

export interface ITerminalLaunchError {
	message: string;
	code?: number;
}

export interface IProcessReadyEvent {
	pid: number,
	cwd: string,
	requiresWindowsMode?: boolean
}

/**
 * An interface representing a raw terminal child process, this contains a subset of the
 * child_process.ChildProcess node.js interface.
 */
export interface ITerminalChildProcess {
	/**
	 * A unique identifier for the terminal process. Note that the uniqueness only applies to a
	 * given pty service connection, IDs will be duplicated for remote and local terminals for
	 * example. The ID will be 0 if it does not support reconnection.
	 */
	id: number;

	/**
	 * Whether the process should be persisted across reloads.
	 */
	shouldPersist: boolean;

	onProcessData: Event<IProcessDataEvent | string>;
	onProcessExit: Event<number | undefined>;
	onProcessReady: Event<IProcessReadyEvent>;
	onProcessTitleChanged: Event<string>;
	onProcessOverrideDimensions?: Event<ITerminalDimensionsOverride | undefined>;
	onProcessResolvedShellLaunchConfig?: Event<IShellLaunchConfig>;
	onProcessShellTypeChanged: Event<TerminalShellType>;

	/**
	 * Starts the process.
	 *
	 * @returns undefined when the process was successfully started, otherwise an object containing
	 * information on what went wrong.
	 */
	start(): Promise<ITerminalLaunchError | undefined>;

	/**
	 * Detach the process from the UI and await reconnect.
	 */
	detach?(): Promise<void>;

	/**
	 * Shutdown the terminal process.
	 *
	 * @param immediate When true the process will be killed immediately, otherwise the process will
	 * be given some time to make sure no additional data comes through.
	 */
	shutdown(immediate: boolean): void;
	input(data: string): void;
	processBinary(data: string): Promise<void>;
	resize(cols: number, rows: number): void;

	/**
	 * Acknowledge a data event has been parsed by the terminal, this is used to implement flow
	 * control to ensure remote processes to not get too far ahead of the client and flood the
	 * connection.
	 * @param charCount The number of characters being acknowledged.
	 */
	acknowledgeDataEvent(charCount: number): void;

	getInitialCwd(): Promise<string>;
	getCwd(): Promise<string>;
	getLatency(): Promise<number>;
}

export interface IReconnectConstants {
	GraceTime: number,
	ShortGraceTime: number
}

export const enum LocalReconnectConstants {
	/**
	 * If there is no reconnection within this time-frame, consider the connection permanently closed...
	*/
	GraceTime = 60000, // 60 seconds
	/**
	 * Maximal grace time between the first and the last reconnection...
	*/
	ShortGraceTime = 6000, // 6 seconds
}

export const enum FlowControlConstants {
	/**
	 * The number of _unacknowledged_ chars to have been sent before the pty is paused in order for
	 * the client to catch up.
	 */
	HighWatermarkChars = 100000,
	/**
	 * After flow control pauses the pty for the client the catch up, this is the number of
	 * _unacknowledged_ chars to have been caught up to on the client before resuming the pty again.
	 * This is used to attempt to prevent pauses in the flowing data; ideally while the pty is
	 * paused the number of unacknowledged chars would always be greater than 0 or the client will
	 * appear to stutter. In reality this balance is hard to accomplish though so heavy commands
	 * will likely pause as latency grows, not flooding the connection is the important thing as
	 * it's shared with other core functionality.
	 */
	LowWatermarkChars = 5000,
	/**
	 * The number characters that are accumulated on the client side before sending an ack event.
	 * This must be less than or equal to LowWatermarkChars or the terminal max never unpause.
	 */
	CharCountAckSize = 5000
}

export interface IProcessDataEvent {
	data: string;
	trackCommit: boolean;
	/**
	 * When trackCommit is set, this will be set to a promise that resolves when the data is parsed.
	 */
	writePromise?: Promise<void>;
}

export interface ITerminalDimensions {
	/**
	 * The columns of the terminal.
	 */
	cols: number;

	/**
	 * The rows of the terminal.
	 */
	rows: number;
}

export interface ITerminalProfile {
	profileName: string;
	path: string;
	isDefault: boolean;
	isAutoDetected?: boolean;
	args?: string | string[] | undefined;
	env?: ITerminalEnvironment;
	overrideName?: boolean;
	color?: string;
	icon?: ThemeIcon | URI | { light: URI, dark: URI };
}

export interface ITerminalDimensionsOverride extends Readonly<ITerminalDimensions> {
	/**
	 * indicate that xterm must receive these exact dimensions, even if they overflow the ui!
	 */
	forceExactSize?: boolean;
}

export const enum ProfileSource {
	GitBash = 'Git Bash',
	Pwsh = 'PowerShell'
}

export interface IBaseUnresolvedTerminalProfile {
	args?: string | string[] | undefined;
	isAutoDetected?: boolean;
	overrideName?: boolean;
	icon?: string | ThemeIcon | URI | { light: URI, dark: URI };
	color?: string;
	env?: ITerminalEnvironment;
}

export interface ITerminalExecutable extends IBaseUnresolvedTerminalProfile {
	path: string | string[];
}

export interface ITerminalProfileSource extends IBaseUnresolvedTerminalProfile {
	source: ProfileSource;
}

export type ITerminalProfileObject = ITerminalExecutable | ITerminalProfileSource | null;
