/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as dom from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { debounce } from 'vs/base/common/decorators';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IDisposable, dispose, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { TabFocus } from 'vs/editor/common/config/commonEditorConfig';
import * as nls from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService, IPromptChoice, NeverShowAgainScope, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { activeContrastBorder, editorBackground, scrollbarSliderActiveBackground, scrollbarSliderBackground, scrollbarSliderHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { ICssStyleCollector, IColorTheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { PANEL_BACKGROUND, SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { TerminalWidgetManager } from 'vs/workbench/contrib/terminal/browser/widgets/widgetManager';
import { ITerminalProcessManager, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, NEVER_MEASURE_RENDER_TIME_STORAGE_KEY, ProcessState, TERMINAL_VIEW_ID, KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, INavigationMode, DEFAULT_COMMANDS_TO_SKIP_SHELL, TERMINAL_CREATION_COMMANDS, KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE, SUGGESTED_RENDERER_TYPE, ITerminalProfileResolverService } from 'vs/workbench/contrib/terminal/common/terminal';
import { ansiColorIdentifiers, ansiColorMap, TERMINAL_BACKGROUND_COLOR, TERMINAL_CURSOR_BACKGROUND_COLOR, TERMINAL_CURSOR_FOREGROUND_COLOR, TERMINAL_FOREGROUND_COLOR, TERMINAL_SELECTION_BACKGROUND_COLOR } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { TerminalLinkManager } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ITerminalInstanceService, ITerminalInstance, ITerminalExternalLinkProvider, IRequestAddInstanceToGroupEvent } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalProcessManager } from 'vs/workbench/contrib/terminal/browser/terminalProcessManager';
import type { Terminal as XTermTerminal, IBuffer, ITerminalAddon, RendererType, ITheme } from 'xterm';
import type { SearchAddon, ISearchOptions } from 'xterm-addon-search';
import type { Unicode11Addon } from 'xterm-addon-unicode11';
import type { WebglAddon } from 'xterm-addon-webgl';
import { CommandTrackerAddon } from 'vs/workbench/contrib/terminal/browser/addons/commandTrackerAddon';
import { NavigationModeAddon } from 'vs/workbench/contrib/terminal/browser/addons/navigationModeAddon';
import { XTermCore } from 'vs/workbench/contrib/terminal/browser/xterm-private';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IViewsService, IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { EnvironmentVariableInfoWidget } from 'vs/workbench/contrib/terminal/browser/widgets/environmentVariableInfoWidget';
import { TerminalLaunchHelpAction } from 'vs/workbench/contrib/terminal/browser/terminalActions';
import { TypeAheadAddon } from 'vs/workbench/contrib/terminal/browser/terminalTypeAheadAddon';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IEnvironmentVariableInfo } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { IProcessDataEvent, IShellLaunchConfig, ITerminalDimensionsOverride, ITerminalLaunchError, TerminalShellType, TerminalSettingId, TitleEventSource, TerminalIcon, TerminalSettingPrefix, ITerminalProfileObject, TerminalLocation } from 'vs/platform/terminal/common/terminal';
import { IProductService } from 'vs/platform/product/common/productService';
import { formatMessageForTerminal } from 'vs/workbench/contrib/terminal/common/terminalStrings';
import { AutoOpenBarrier } from 'vs/base/common/async';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { ITerminalStatusList, TerminalStatus, TerminalStatusList } from 'vs/workbench/contrib/terminal/browser/terminalStatusList';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { isMacintosh, isWindows, OperatingSystem, OS } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { DataTransfers } from 'vs/base/browser/dnd';
import { containsDragType, DragAndDropObserver, IDragAndDropObserverCallbacks } from 'vs/workbench/browser/dnd';
import { getColorClass } from 'vs/workbench/contrib/terminal/browser/terminalIcon';
import { IWorkbenchLayoutService, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { Color } from 'vs/base/common/color';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';

// How long in milliseconds should an average frame take to render for a notification to appear
// which suggests the fallback DOM-based renderer
const SLOW_CANVAS_RENDER_THRESHOLD = 50;
const NUMBER_OF_FRAMES_TO_MEASURE = 20;

const SHOULD_PROMPT_FOR_PROFILE_MIGRATION_KEY = 'terminals.integrated.profile-migration';

let migrationMessageShown = false;

const enum Constants {
	/**
	 * The maximum amount of milliseconds to wait for a container before starting to create the
	 * terminal process. This period helps ensure the terminal has good initial dimensions to work
	 * with if it's going to be a foreground terminal.
	 */
	WaitForContainerThreshold = 100
}

let xtermConstructor: Promise<typeof XTermTerminal> | undefined;

interface ICanvasDimensions {
	width: number;
	height: number;
}

interface IGridDimensions {
	cols: number;
	rows: number;
}

export class TerminalInstance extends Disposable implements ITerminalInstance {
	private static _lastKnownCanvasDimensions: ICanvasDimensions | undefined;
	private static _lastKnownGridDimensions: IGridDimensions | undefined;
	private static _instanceIdCounter = 1;

	private _processManager!: ITerminalProcessManager;
	private _pressAnyKeyToCloseListener: IDisposable | undefined;

	private _instanceId: number;
	private _latestXtermWriteData: number = 0;
	private _latestXtermParseData: number = 0;
	private _isExiting: boolean;
	private _hadFocusOnExit: boolean;
	private _isVisible: boolean;
	private _isDisposed: boolean;
	private _exitCode: number | undefined;
	private _skipTerminalCommands: string[];
	private _shellType: TerminalShellType;
	private _title: string = '';
	private _titleSource: TitleEventSource = TitleEventSource.Process;
	private _container: HTMLElement | undefined;
	private _wrapperElement: (HTMLElement & { xterm?: XTermTerminal }) | undefined;
	private _xterm: XTermTerminal | undefined;
	private _xtermCore: XTermCore | undefined;
	private _xtermTypeAhead: TypeAheadAddon | undefined;
	private _xtermSearch: SearchAddon | undefined;
	private _xtermUnicode11: Unicode11Addon | undefined;
	private _xtermElement: HTMLDivElement | undefined;
	private _terminalHasTextContextKey: IContextKey<boolean>;
	private _terminalA11yTreeFocusContextKey: IContextKey<boolean>;
	private _cols: number = 0;
	private _rows: number = 0;
	private _dimensionsOverride: ITerminalDimensionsOverride | undefined;
	private _xtermReadyPromise: Promise<XTermTerminal>;
	private _titleReadyPromise: Promise<string>;
	private _titleReadyComplete: ((title: string) => any) | undefined;
	private _areLinksReady: boolean = false;
	private _initialDataEvents: string[] | undefined = [];
	private _containerReadyBarrier: AutoOpenBarrier;
	private _attachBarrier: AutoOpenBarrier;

	private _messageTitleDisposable: IDisposable | undefined;

	private _widgetManager: TerminalWidgetManager = this._instantiationService.createInstance(TerminalWidgetManager);
	private _linkManager: TerminalLinkManager | undefined;
	private _environmentInfo: { widget: EnvironmentVariableInfoWidget, disposable: IDisposable } | undefined;
	private _webglAddon: WebglAddon | undefined;
	private _commandTrackerAddon: CommandTrackerAddon | undefined;
	private _navigationModeAddon: INavigationMode & ITerminalAddon | undefined;
	private _dndObserver: IDisposable | undefined;

	private _lastLayoutDimensions: dom.Dimension | undefined;

	private _hasHadInput: boolean;

	readonly statusList: ITerminalStatusList;
	disableLayout: boolean = false;
	target?: TerminalLocation;
	get instanceId(): number { return this._instanceId; }
	get resource(): URI {
		return URI.from({
			scheme: Schemas.vscodeTerminal,
			path: `/${this._workspaceContextService.getWorkspace().id}/${this.instanceId}`,
			fragment: this.title,
		});
	}
	get cols(): number {
		if (this._dimensionsOverride && this._dimensionsOverride.cols) {
			if (this._dimensionsOverride.forceExactSize) {
				return this._dimensionsOverride.cols;
			}
			return Math.min(Math.max(this._dimensionsOverride.cols, 2), this._cols);
		}
		return this._cols;
	}
	get rows(): number {
		if (this._dimensionsOverride && this._dimensionsOverride.rows) {
			if (this._dimensionsOverride.forceExactSize) {
				return this._dimensionsOverride.rows;
			}
			return Math.min(Math.max(this._dimensionsOverride.rows, 2), this._rows);
		}
		return this._rows;
	}
	get maxCols(): number { return this._cols; }
	get maxRows(): number { return this._rows; }
	// TODO: Ideally processId would be merged into processReady
	get processId(): number | undefined { return this._processManager.shellProcessId; }
	// TODO: How does this work with detached processes?
	// TODO: Should this be an event as it can fire twice?
	get processReady(): Promise<void> { return this._processManager.ptyProcessReady; }
	get areLinksReady(): boolean { return this._areLinksReady; }
	get initialDataEvents(): string[] | undefined { return this._initialDataEvents; }
	get exitCode(): number | undefined { return this._exitCode; }

	get hadFocusOnExit(): boolean { return this._hadFocusOnExit; }
	get isTitleSetByProcess(): boolean { return !!this._messageTitleDisposable; }
	get shellLaunchConfig(): IShellLaunchConfig { return this._shellLaunchConfig; }
	get shellType(): TerminalShellType { return this._shellType; }
	get commandTracker(): CommandTrackerAddon | undefined { return this._commandTrackerAddon; }
	get navigationMode(): INavigationMode | undefined { return this._navigationModeAddon; }
	get isDisconnected(): boolean { return this._processManager.isDisconnected; }
	get isRemote(): boolean { return this._processManager.remoteAuthority !== undefined; }
	get hasFocus(): boolean { return this._wrapperElement?.contains(document.activeElement) ?? false; }
	get title(): string { return this._title; }
	get titleSource(): TitleEventSource { return this._titleSource; }
	get icon(): TerminalIcon | undefined { return this._getIcon(); }
	get color(): string | undefined { return this._getColor(); }

	// The onExit event is special in that it fires and is disposed after the terminal instance
	// itself is disposed
	private readonly _onExit = new Emitter<number | undefined>();
	readonly onExit = this._onExit.event;

	private readonly _onDisposed = this._register(new Emitter<ITerminalInstance>());
	readonly onDisposed = this._onDisposed.event;
	private readonly _onFocused = this._register(new Emitter<ITerminalInstance>());
	readonly onFocused = this._onFocused.event;
	private readonly _onProcessIdReady = this._register(new Emitter<ITerminalInstance>());
	readonly onProcessIdReady = this._onProcessIdReady.event;
	private readonly _onLinksReady = this._register(new Emitter<ITerminalInstance>());
	readonly onLinksReady = this._onLinksReady.event;
	private readonly _onTitleChanged = this._register(new Emitter<ITerminalInstance>());
	readonly onTitleChanged = this._onTitleChanged.event;
	private readonly _onIconChanged = this._register(new Emitter<ITerminalInstance>());
	readonly onIconChanged = this._onIconChanged.event;
	private readonly _onData = this._register(new Emitter<string>());
	readonly onData = this._onData.event;
	private readonly _onBinary = this._register(new Emitter<string>());
	readonly onBinary = this._onBinary.event;
	private readonly _onLineData = this._register(new Emitter<string>());
	readonly onLineData = this._onLineData.event;
	private readonly _onRequestExtHostProcess = this._register(new Emitter<ITerminalInstance>());
	readonly onRequestExtHostProcess = this._onRequestExtHostProcess.event;
	private readonly _onDimensionsChanged = this._register(new Emitter<void>());
	readonly onDimensionsChanged = this._onDimensionsChanged.event;
	private readonly _onMaximumDimensionsChanged = this._register(new Emitter<void>());
	readonly onMaximumDimensionsChanged = this._onMaximumDimensionsChanged.event;
	private readonly _onFocus = this._register(new Emitter<ITerminalInstance>());
	readonly onFocus = this._onFocus.event;
	private readonly _onRequestAddInstanceToGroup = this._register(new Emitter<IRequestAddInstanceToGroupEvent>());
	readonly onRequestAddInstanceToGroup = this._onRequestAddInstanceToGroup.event;

	constructor(
		private readonly _terminalFocusContextKey: IContextKey<boolean>,
		private readonly _terminalShellTypeContextKey: IContextKey<string>,
		private readonly _terminalAltBufferActiveContextKey: IContextKey<boolean>,
		private readonly _configHelper: TerminalConfigHelper,
		private _shellLaunchConfig: IShellLaunchConfig,
		@ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService,
		@ITerminalProfileResolverService private readonly _terminalProfileResolverService: ITerminalProfileResolverService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPreferencesService private readonly _preferencesService: IPreferencesService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IThemeService private readonly _themeService: IThemeService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IProductService private readonly _productService: IProductService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IWorkbenchEnvironmentService workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
		super();

		this._skipTerminalCommands = [];
		this._isExiting = false;
		this._hadFocusOnExit = false;
		this._isVisible = false;
		this._isDisposed = false;
		this._instanceId = TerminalInstance._instanceIdCounter++;

		this._hasHadInput = false;
		this._titleReadyPromise = new Promise<string>(c => {
			this._titleReadyComplete = c;
		});

		this._terminalHasTextContextKey = KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED.bindTo(this._contextKeyService);
		this._terminalA11yTreeFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS.bindTo(this._contextKeyService);
		this._terminalAltBufferActiveContextKey = KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE.bindTo(this._contextKeyService);

		this._logService.trace(`terminalInstance#ctor (instanceId: ${this.instanceId})`, this._shellLaunchConfig);

		// Resolve just the icon ahead of time so that it shows up immediately in the tabs. This is
		// disabled in remote because this needs to be sync and the OS may differ on the remote
		// which would result in the wrong profile being selected and the wrong icon being
		// permanently attached to the terminal.
		if (!this.shellLaunchConfig.executable && !workbenchEnvironmentService.remoteAuthority) {
			this._terminalProfileResolverService.resolveIcon(this._shellLaunchConfig, OS);
		}

		// When a custom pty is used set the name immediately so it gets passed over to the exthost
		// and is available when Pseudoterminal.open fires.
		if (this.shellLaunchConfig.customPtyImplementation) {
			this.setTitle(this._shellLaunchConfig.name, TitleEventSource.Api);
		}

		this.statusList = this._instantiationService.createInstance(TerminalStatusList);
		this._initDimensions();
		this._createProcessManager();

		this._register(toDisposable(() => this._dndObserver?.dispose()));

		this._containerReadyBarrier = new AutoOpenBarrier(Constants.WaitForContainerThreshold);
		this._attachBarrier = new AutoOpenBarrier(1000);
		this._xtermReadyPromise = this._createXterm();
		this._xtermReadyPromise.then(async () => {
			// Wait for a period to allow a container to be ready
			await this._containerReadyBarrier.wait();
			await this._createProcess();

			// Re-establish the title after reconnect
			if (this.shellLaunchConfig.attachPersistentProcess) {
				this.setTitle(this.shellLaunchConfig.attachPersistentProcess.title, this.shellLaunchConfig.attachPersistentProcess.titleSource);
			}
		});

		this.addDisposable(this._configurationService.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('terminal.integrated') || e.affectsConfiguration('editor.fastScrollSensitivity') || e.affectsConfiguration('editor.mouseWheelScrollSensitivity') || e.affectsConfiguration('editor.multiCursorModifier')) {
				this.updateConfig();
				// HACK: Trigger another async layout to ensure xterm's CharMeasure is ready to use,
				// this hack can be removed when https://github.com/xtermjs/xterm.js/issues/702 is
				// supported.
				this.setVisible(this._isVisible);
			}
			const layoutSettings: string[] = [
				TerminalSettingId.FontSize,
				TerminalSettingId.FontFamily,
				TerminalSettingId.FontWeight,
				TerminalSettingId.FontWeightBold,
				TerminalSettingId.LetterSpacing,
				TerminalSettingId.LineHeight,
				'editor.fontFamily'
			];
			if (layoutSettings.some(id => e.affectsConfiguration(id))) {
				await this._resize();
			}
			if (e.affectsConfiguration(TerminalSettingId.UnicodeVersion)) {
				this._updateUnicodeVersion();
			}
			if (e.affectsConfiguration('editor.accessibilitySupport')) {
				this.updateAccessibilitySupport();
			}
			if (e.affectsConfiguration(TerminalSettingId.GpuAcceleration)) {
				this._storageService.remove(SUGGESTED_RENDERER_TYPE, StorageScope.GLOBAL);
			}
		}));

		// Clear out initial data events after 10 seconds, hopefully extension hosts are up and
		// running at that point.
		let initialDataEventsTimeout: number | undefined = window.setTimeout(() => {
			initialDataEventsTimeout = undefined;
			this._initialDataEvents = undefined;
		}, 10000);
		this._register(toDisposable(() => {
			if (initialDataEventsTimeout) {
				window.clearTimeout(initialDataEventsTimeout);
			}
		}));
		this.showProfileMigrationNotification();
	}

	private _getIcon(): TerminalIcon | undefined {
		const icon = this._shellLaunchConfig.icon || this._shellLaunchConfig.attachPersistentProcess?.icon;
		if (!icon) {
			return this._processManager.processState >= ProcessState.Launching ? Codicon.terminal : undefined;
		}
		return icon;
	}

	private _getColor(): string | undefined {
		if (this.shellLaunchConfig.color) {
			return this.shellLaunchConfig.color;
		}
		if (this.shellLaunchConfig?.attachPersistentProcess?.color) {
			return this.shellLaunchConfig.attachPersistentProcess.color;
		}
		if (this._processManager.processState >= ProcessState.Launching) {
			return undefined;
		}
		return undefined;
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}

	async showProfileMigrationNotification(): Promise<void> {
		const platform = this._getPlatformKey();
		const shouldMigrateToProfile = (!!this._configurationService.getValue(TerminalSettingPrefix.Shell + platform) ||
			!!this._configurationService.inspect(TerminalSettingPrefix.ShellArgs + platform).userValue) &&
			!!this._configurationService.getValue(TerminalSettingPrefix.DefaultProfile + platform);
		if (shouldMigrateToProfile && this._storageService.getBoolean(SHOULD_PROMPT_FOR_PROFILE_MIGRATION_KEY, StorageScope.WORKSPACE, true) && !migrationMessageShown) {
			this._notificationService.prompt(
				Severity.Info,
				nls.localize('terminalProfileMigration', "The terminal is using deprecated shell/shellArgs settings, do you want to migrate it to a profile?"),
				[
					{
						label: nls.localize('migrateToProfile', "Migrate"),
						run: async () => {
							const shell = this._configurationService.getValue(TerminalSettingPrefix.Shell + platform);
							const shellArgs = this._configurationService.getValue(TerminalSettingPrefix.ShellArgs + platform);
							const profile = await this._terminalProfileResolverService.createProfileFromShellAndShellArgs(shell, shellArgs);
							if (typeof profile === 'string') {
								await this._configurationService.updateValue(TerminalSettingPrefix.DefaultProfile + platform, profile);
								this._logService.trace(`migrated from shell/shellArgs, using existing profile ${profile}`);
							} else {
								const profiles = { ...this._configurationService.inspect<Readonly<{ [key: string]: ITerminalProfileObject }>>(TerminalSettingPrefix.Profiles + platform).userValue } || {};
								const profileConfig: ITerminalProfileObject = { path: profile.path };
								if (profile.args) {
									profileConfig.args = profile.args;
								}
								profiles[profile.profileName] = profileConfig;
								await this._configurationService.updateValue(TerminalSettingPrefix.Profiles + platform, profiles);
								await this._configurationService.updateValue(TerminalSettingPrefix.DefaultProfile + platform, profile.profileName);
								this._logService.trace(`migrated from shell/shellArgs, ${shell} ${shellArgs} to profile ${JSON.stringify(profile)}`);
							}
							await this._configurationService.updateValue(TerminalSettingPrefix.Shell + platform, undefined);
							await this._configurationService.updateValue(TerminalSettingPrefix.ShellArgs + platform, undefined);
						}
					} as IPromptChoice,
				],
				{
					neverShowAgain: { id: SHOULD_PROMPT_FOR_PROFILE_MIGRATION_KEY, scope: NeverShowAgainScope.WORKSPACE }
				}
			);
			migrationMessageShown = true;
		}
	}

	private _getPlatformKey(): string {
		return isWindows ? 'windows' : (isMacintosh ? 'osx' : 'linux');
	}

	private _initDimensions(): void {
		// The terminal panel needs to have been created
		if (!this._container) {
			return;
		}

		const computedStyle = window.getComputedStyle(this._container.parentElement!);
		const width = parseInt(computedStyle.getPropertyValue('width').replace('px', ''), 10);
		const height = parseInt(computedStyle.getPropertyValue('height').replace('px', ''), 10);
		this._evaluateColsAndRows(width, height);
	}

	/**
	 * Evaluates and sets the cols and rows of the terminal if possible.
	 * @param width The width of the container.
	 * @param height The height of the container.
	 * @return The terminal's width if it requires a layout.
	 */
	private _evaluateColsAndRows(width: number, height: number): number | null {
		// Ignore if dimensions are undefined or 0
		if (!width || !height) {
			this._setLastKnownColsAndRows();
			return null;
		}

		const dimension = this._getDimension(width, height);
		if (!dimension) {
			this._setLastKnownColsAndRows();
			return null;
		}

		const font = this._configHelper.getFont(this._xtermCore);
		if (!font.charWidth || !font.charHeight) {
			this._setLastKnownColsAndRows();
			return null;
		}

		// Because xterm.js converts from CSS pixels to actual pixels through
		// the use of canvas, window.devicePixelRatio needs to be used here in
		// order to be precise. font.charWidth/charHeight alone as insufficient
		// when window.devicePixelRatio changes.
		const scaledWidthAvailable = dimension.width * window.devicePixelRatio;

		const scaledCharWidth = font.charWidth * window.devicePixelRatio + font.letterSpacing;
		const newCols = Math.max(Math.floor(scaledWidthAvailable / scaledCharWidth), 1);

		const scaledHeightAvailable = dimension.height * window.devicePixelRatio;
		const scaledCharHeight = Math.ceil(font.charHeight * window.devicePixelRatio);
		const scaledLineHeight = Math.floor(scaledCharHeight * font.lineHeight);
		const newRows = Math.max(Math.floor(scaledHeightAvailable / scaledLineHeight), 1);

		if (this._cols !== newCols || this._rows !== newRows) {
			this._cols = newCols;
			this._rows = newRows;
			this._fireMaximumDimensionsChanged();
		}

		return dimension.width;
	}

	private _setLastKnownColsAndRows(): void {
		if (TerminalInstance._lastKnownGridDimensions) {
			this._cols = TerminalInstance._lastKnownGridDimensions.cols;
			this._rows = TerminalInstance._lastKnownGridDimensions.rows;
		}
	}

	@debounce(50)
	private _fireMaximumDimensionsChanged(): void {
		this._onMaximumDimensionsChanged.fire();
	}

	private _getDimension(width: number, height: number): ICanvasDimensions | undefined {
		// The font needs to have been initialized
		const font = this._configHelper.getFont(this._xtermCore);
		if (!font || !font.charWidth || !font.charHeight) {
			return undefined;
		}

		if (!this._wrapperElement) {
			return undefined;
		}

		const wrapperElementStyle = getComputedStyle(this._wrapperElement);
		const marginLeft = parseInt(wrapperElementStyle.marginLeft!.split('px')[0], 10);
		const marginRight = parseInt(wrapperElementStyle.marginRight!.split('px')[0], 10);
		const bottom = parseInt(wrapperElementStyle.bottom!.split('px')[0], 10);

		const innerWidth = width - marginLeft - marginRight;
		const innerHeight = height - bottom - 1;

		TerminalInstance._lastKnownCanvasDimensions = new dom.Dimension(innerWidth, innerHeight);
		return TerminalInstance._lastKnownCanvasDimensions;
	}

	get persistentProcessId(): number | undefined { return this._processManager.persistentProcessId; }
	get shouldPersist(): boolean { return this._processManager.shouldPersist; }

	private async _getXtermConstructor(): Promise<typeof XTermTerminal> {
		if (xtermConstructor) {
			return xtermConstructor;
		}
		xtermConstructor = new Promise<typeof XTermTerminal>(async (resolve) => {
			const Terminal = await this._terminalInstanceService.getXtermConstructor();
			// Localize strings
			Terminal.strings.promptLabel = nls.localize('terminal.integrated.a11yPromptLabel', 'Terminal input');
			Terminal.strings.tooMuchOutput = nls.localize('terminal.integrated.a11yTooMuchOutput', 'Too much output to announce, navigate to rows manually to read');
			resolve(Terminal);
		});
		return xtermConstructor;
	}

	/**
	 * Create xterm.js instance and attach data listeners.
	 */
	protected async _createXterm(): Promise<XTermTerminal> {
		const Terminal = await this._getXtermConstructor();
		const font = this._configHelper.getFont(undefined, true);
		const config = this._configHelper.config;
		const editorOptions = this._configurationService.getValue<IEditorOptions>('editor');

		const xterm = new Terminal({
			// TODO: Replace null with undefined when https://github.com/xtermjs/xterm.js/issues/3329 is resolved
			cols: this._cols || null as any,
			rows: this._rows || null as any,
			altClickMovesCursor: config.altClickMovesCursor && editorOptions.multiCursorModifier === 'alt',
			scrollback: config.scrollback,
			theme: this._getXtermTheme(),
			drawBoldTextInBrightColors: config.drawBoldTextInBrightColors,
			fontFamily: font.fontFamily,
			fontWeight: config.fontWeight,
			fontWeightBold: config.fontWeightBold,
			fontSize: font.fontSize,
			letterSpacing: font.letterSpacing,
			lineHeight: font.lineHeight,
			minimumContrastRatio: config.minimumContrastRatio,
			bellStyle: 'none',
			macOptionIsMeta: config.macOptionIsMeta,
			macOptionClickForcesSelection: config.macOptionClickForcesSelection,
			rightClickSelectsWord: config.rightClickBehavior === 'selectWord',
			fastScrollModifier: 'alt',
			fastScrollSensitivity: editorOptions.fastScrollSensitivity,
			scrollSensitivity: editorOptions.mouseWheelScrollSensitivity,
			rendererType: this._getBuiltInXtermRenderer(config.gpuAcceleration, this._storageService.get(SUGGESTED_RENDERER_TYPE, StorageScope.GLOBAL)),
			wordSeparator: config.wordSeparators
		});
		this._xterm = xterm;
		this._xtermCore = (xterm as any)._core as XTermCore;
		this._updateUnicodeVersion();
		this.updateAccessibilitySupport();
		this._terminalInstanceService.getXtermSearchConstructor().then(addonCtor => {
			this._xtermSearch = new addonCtor();
			xterm.loadAddon(this._xtermSearch);
		});
		if (this._shellLaunchConfig.initialText) {
			this._xterm.writeln(this._shellLaunchConfig.initialText);
		}
		// Delay the creation of the bell listener to avoid showing the bell when the terminal
		// starts up or reconnects
		setTimeout(() => {
			this._xterm?.onBell(() => {
				if (this._configHelper.config.enableBell) {
					this.statusList.add({
						id: TerminalStatus.Bell,
						severity: Severity.Warning,
						icon: Codicon.bell,
						tooltip: nls.localize('bellStatus', "Bell")
					}, this._configHelper.config.bellDuration);
				}
			});
		}, 1000);
		this._xterm.onLineFeed(() => this._onLineFeed());
		this._xterm.onKey(e => this._onKey(e.key, e.domEvent));
		this._xterm.onSelectionChange(async () => this._onSelectionChange());
		this._xterm.buffer.onBufferChange(() => this._refreshAltBufferContextKey());

		this._processManager.onProcessData(e => this._onProcessData(e));
		this._xterm.onData(data => this._processManager.write(data));
		this._xterm.onBinary(data => this._processManager.processBinary(data));
		this.processReady.then(async () => {
			if (this._linkManager) {
				this._linkManager.processCwd = await this._processManager.getInitialCwd();
			}
		});
		// Init winpty compat and link handler after process creation as they rely on the
		// underlying process OS
		this._processManager.onProcessReady((processTraits) => {
			if (this._processManager.os === OperatingSystem.Windows) {
				xterm.setOption('windowsMode', processTraits.requiresWindowsMode || false);
				// Force line data to be sent when the cursor is moved, the main purpose for
				// this is because ConPTY will often not do a line feed but instead move the
				// cursor, in which case we still want to send the current line's data to tasks.
				xterm.parser.registerCsiHandler({ final: 'H' }, () => {
					this._onCursorMove();
					return false;
				});
			}
			this._linkManager = this._instantiationService.createInstance(TerminalLinkManager, xterm, this._processManager!);
			this._areLinksReady = true;
			this._onLinksReady.fire(this);
		});

		this._commandTrackerAddon = new CommandTrackerAddon();
		this._xterm.loadAddon(this._commandTrackerAddon);
		this._register(this._themeService.onDidColorThemeChange(theme => this._updateTheme(xterm, theme)));
		this._register(this._viewDescriptorService.onDidChangeLocation(({ views }) => {
			if (views.some(v => v.id === TERMINAL_VIEW_ID)) {
				this._updateTheme(xterm);
			}
		}));

		this._xtermTypeAhead = this._register(this._instantiationService.createInstance(TypeAheadAddon, this._processManager, this._configHelper));
		this._xterm.loadAddon(this._xtermTypeAhead);

		return xterm;
	}

	detachFromElement(): void {
		this._wrapperElement?.remove();
		this._container = undefined;
	}


	attachToElement(container: HTMLElement): Promise<void> | void {
		// The container did not change, do nothing
		if (this._container === container) {
			return;
		}

		this._attachBarrier.open();

		// Attach has not occurred yet
		if (!this._wrapperElement) {
			return this._attachToElement(container);
		}

		// Update the theme when attaching as the terminal location could have changed
		if (this._xterm) {
			this._updateTheme(this._xterm);
		}

		// The container changed, reattach
		this._container = container;
		this._container.appendChild(this._wrapperElement);
		setTimeout(() => this._initDragAndDrop(container));
	}

	private async _attachToElement(container: HTMLElement): Promise<void> {
		if (this._wrapperElement) {
			throw new Error('The terminal instance has already been attached to a container');
		}

		this._container = container;
		this._wrapperElement = document.createElement('div');
		this._wrapperElement.classList.add('terminal-wrapper');
		this._xtermElement = document.createElement('div');

		this._wrapperElement.appendChild(this._xtermElement);
		this._container.appendChild(this._wrapperElement);

		const xterm = await this._xtermReadyPromise;

		// Attach the xterm object to the DOM, exposing it to the smoke tests
		this._wrapperElement.xterm = xterm;

		this._updateTheme(xterm);
		xterm.open(this._xtermElement);

		if (!xterm.element || !xterm.textarea) {
			throw new Error('xterm elements not set after open');
		}

		this._setAriaLabel(xterm, this._instanceId, this._title);

		xterm.textarea.addEventListener('focus', () => this._onFocus.fire(this));
		xterm.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
			// Disable all input if the terminal is exiting
			if (this._isExiting) {
				return false;
			}

			const standardKeyboardEvent = new StandardKeyboardEvent(event);
			const resolveResult = this._keybindingService.softDispatch(standardKeyboardEvent, standardKeyboardEvent.target);

			// Respect chords if the allowChords setting is set and it's not Escape. Escape is
			// handled specially for Zen Mode's Escape, Escape chord, plus it's important in
			// terminals generally
			const isValidChord = resolveResult?.enterChord && this._configHelper.config.allowChords && event.key !== 'Escape';
			if (this._keybindingService.inChordMode || isValidChord) {
				event.preventDefault();
				return false;
			}

			const SHOW_TERMINAL_CONFIG_PROMPT_KEY = 'terminal.integrated.showTerminalConfigPrompt';
			const EXCLUDED_KEYS = ['RightArrow', 'LeftArrow', 'UpArrow', 'DownArrow', 'Space', 'Meta', 'Control', 'Shift', 'Alt', '', 'Delete', 'Backspace', 'Tab'];

			// only keep track of input if prompt hasn't already been shown
			if (this._storageService.getBoolean(SHOW_TERMINAL_CONFIG_PROMPT_KEY, StorageScope.GLOBAL, true) &&
				!EXCLUDED_KEYS.includes(event.key) &&
				!event.ctrlKey &&
				!event.shiftKey &&
				!event.altKey) {
				this._hasHadInput = true;
			}

			// for keyboard events that resolve to commands described
			// within commandsToSkipShell, either alert or skip processing by xterm.js
			if (resolveResult && resolveResult.commandId && this._skipTerminalCommands.some(k => k === resolveResult.commandId) && !this._configHelper.config.sendKeybindingsToShell) {
				// don't alert when terminal is opened or closed
				if (this._storageService.getBoolean(SHOW_TERMINAL_CONFIG_PROMPT_KEY, StorageScope.GLOBAL, true) &&
					this._hasHadInput &&
					!TERMINAL_CREATION_COMMANDS.includes(resolveResult.commandId)) {
					this._notificationService.prompt(
						Severity.Info,
						nls.localize('keybindingHandling', "Some keybindings don't go to the terminal by default and are handled by {0} instead.", this._productService.nameLong),
						[
							{
								label: nls.localize('configureTerminalSettings', "Configure Terminal Settings"),
								run: () => {
									this._preferencesService.openSettings(false, `@id:${TerminalSettingId.CommandsToSkipShell},${TerminalSettingId.SendKeybindingsToShell},${TerminalSettingId.AllowChords}`);
								}
							} as IPromptChoice
						]
					);
					this._storageService.store(SHOW_TERMINAL_CONFIG_PROMPT_KEY, false, StorageScope.GLOBAL, StorageTarget.USER);
				}
				event.preventDefault();
				return false;
			}

			// Skip processing by xterm.js of keyboard events that match menu bar mnemonics
			if (this._configHelper.config.allowMnemonics && !isMacintosh && event.altKey) {
				return false;
			}

			// If tab focus mode is on, tab is not passed to the terminal
			if (TabFocus.getTabFocusMode() && event.keyCode === 9) {
				return false;
			}

			// Always have alt+F4 skip the terminal on Windows and allow it to be handled by the
			// system
			if (isWindows && event.altKey && event.key === 'F4' && !event.ctrlKey) {
				return false;
			}

			// Fallback to force ctrl+v to paste on browsers that do not support
			// navigator.clipboard.readText
			if (!BrowserFeatures.clipboard.readText && event.key === 'v' && event.ctrlKey) {
				return false;
			}

			return true;
		});
		this._register(dom.addDisposableListener(xterm.element, 'mousedown', () => {
			// We need to listen to the mouseup event on the document since the user may release
			// the mouse button anywhere outside of _xterm.element.
			const listener = dom.addDisposableListener(document, 'mouseup', () => {
				// Delay with a setTimeout to allow the mouseup to propagate through the DOM
				// before evaluating the new selection state.
				setTimeout(() => this._refreshSelectionContextKey(), 0);
				listener.dispose();
			});
		}));

		// xterm.js currently drops selection on keyup as we need to handle this case.
		this._register(dom.addDisposableListener(xterm.element, 'keyup', () => {
			// Wait until keyup has propagated through the DOM before evaluating
			// the new selection state.
			setTimeout(() => this._refreshSelectionContextKey(), 0);
		}));

		this._register(dom.addDisposableListener(xterm.textarea, 'focus', () => {
			this._terminalFocusContextKey.set(true);
			if (this.shellType) {
				this._terminalShellTypeContextKey.set(this.shellType.toString());
			} else {
				this._terminalShellTypeContextKey.reset();
			}
			this._onFocused.fire(this);
		}));

		this._register(dom.addDisposableListener(xterm.textarea, 'blur', () => {
			this._terminalFocusContextKey.reset();
			this._refreshSelectionContextKey();
		}));

		this._initDragAndDrop(container);

		this._widgetManager.attachToElement(xterm.element);
		this._processManager.onProcessReady(() => this._linkManager?.setWidgetManager(this._widgetManager));

		// const computedStyle = window.getComputedStyle(this._container);
		// const computedStyle = window.getComputedStyle(this._container.parentElement!);
		// const width = parseInt(computedStyle.getPropertyValue('width').replace('px', ''), 10);
		// const height = parseInt(computedStyle.getPropertyValue('height').replace('px', ''), 10);
		if (this._lastLayoutDimensions) {
			this.layout(this._lastLayoutDimensions);
		}
		this.setVisible(this._isVisible);
		this.updateConfig();

		// If IShellLaunchConfig.waitOnExit was true and the process finished before the terminal
		// panel was initialized.
		if (xterm.getOption('disableStdin')) {
			this._attachPressAnyKeyToCloseListener(xterm);
		}
	}

	private _initDragAndDrop(container: HTMLElement) {
		this._dndObserver?.dispose();
		const dndController = this._instantiationService.createInstance(TerminalInstanceDragAndDropController, container);
		dndController.onDropTerminal(e => this._onRequestAddInstanceToGroup.fire(e));
		dndController.onDropFile(async path => {
			const preparedPath = await this._terminalInstanceService.preparePathForTerminalAsync(path, this.shellLaunchConfig.executable, this.title, this.shellType, this.isRemote);
			this.sendText(preparedPath, false);
			this.focus();
		});
		this._dndObserver = new DragAndDropObserver(container, dndController);
	}

	private async _measureRenderTime(): Promise<void> {
		await this._xtermReadyPromise;
		const frameTimes: number[] = [];
		if (!this._xtermCore?._renderService) {
			return;
		}
		const textRenderLayer = this._xtermCore!._renderService?._renderer._renderLayers[0];
		const originalOnGridChanged = textRenderLayer?.onGridChanged;
		const evaluateCanvasRenderer = () => {
			// Discard first frame time as it's normal to take longer
			frameTimes.shift();

			const medianTime = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)];
			if (medianTime > SLOW_CANVAS_RENDER_THRESHOLD) {
				if (this._configHelper.config.gpuAcceleration === 'auto') {
					this._storageService.store(SUGGESTED_RENDERER_TYPE, 'dom', StorageScope.GLOBAL, StorageTarget.MACHINE);
					this.updateConfig();
				} else {
					const promptChoices: IPromptChoice[] = [
						{
							label: nls.localize('yes', "Yes"),
							run: () => this._configurationService.updateValue(TerminalSettingId.GpuAcceleration, 'off', ConfigurationTarget.USER)
						} as IPromptChoice,
						{
							label: nls.localize('no', "No"),
							run: () => { }
						} as IPromptChoice,
						{
							label: nls.localize('dontShowAgain', "Don't Show Again"),
							isSecondary: true,
							run: () => this._storageService.store(NEVER_MEASURE_RENDER_TIME_STORAGE_KEY, true, StorageScope.GLOBAL, StorageTarget.MACHINE)
						} as IPromptChoice
					];
					this._notificationService.prompt(
						Severity.Warning,
						nls.localize('terminal.slowRendering', 'Terminal GPU acceleration appears to be slow on your computer. Would you like to switch to disable it which may improve performance? [Read more about terminal settings](https://code.visualstudio.com/docs/editor/integrated-terminal#_changing-how-the-terminal-is-rendered).'),
						promptChoices
					);
				}
			}
		};

		textRenderLayer.onGridChanged = (terminal: XTermTerminal, firstRow: number, lastRow: number) => {
			const startTime = performance.now();
			originalOnGridChanged.call(textRenderLayer, terminal, firstRow, lastRow);
			frameTimes.push(performance.now() - startTime);
			if (frameTimes.length === NUMBER_OF_FRAMES_TO_MEASURE) {
				evaluateCanvasRenderer();
				// Restore original function
				textRenderLayer.onGridChanged = originalOnGridChanged;
			}
		};
	}

	hasSelection(): boolean {
		return this._xterm ? this._xterm.hasSelection() : false;
	}

	async copySelection(): Promise<void> {
		const xterm = await this._xtermReadyPromise;
		if (this.hasSelection()) {
			await this._clipboardService.writeText(xterm.getSelection());
		} else {
			this._notificationService.warn(nls.localize('terminal.integrated.copySelection.noSelection', 'The terminal has no selection to copy'));
		}
	}

	get selection(): string | undefined {
		return this._xterm && this.hasSelection() ? this._xterm.getSelection() : undefined;
	}

	clearSelection(): void {
		this._xterm?.clearSelection();
	}

	selectAll(): void {
		// Focus here to ensure the terminal context key is set
		this._xterm?.focus();
		this._xterm?.selectAll();
	}

	findNext(term: string, searchOptions: ISearchOptions): boolean {
		if (!this._xtermSearch) {
			return false;
		}
		return this._xtermSearch.findNext(term, searchOptions);
	}

	findPrevious(term: string, searchOptions: ISearchOptions): boolean {
		if (!this._xtermSearch) {
			return false;
		}
		return this._xtermSearch.findPrevious(term, searchOptions);
	}

	notifyFindWidgetFocusChanged(isFocused: boolean): void {
		if (!this._xterm) {
			return;
		}
		const terminalFocused = !isFocused && (document.activeElement === this._xterm.textarea || document.activeElement === this._xterm.element);
		this._terminalFocusContextKey.set(terminalFocused);
	}

	private _refreshAltBufferContextKey() {
		this._terminalAltBufferActiveContextKey.set(!!(this._xterm && this._xterm.buffer.active === this._xterm.buffer.alternate));
	}

	override dispose(immediate?: boolean): void {
		this._logService.trace(`terminalInstance#dispose (instanceId: ${this.instanceId})`);
		dispose(this._linkManager);
		this._linkManager = undefined;
		dispose(this._commandTrackerAddon);
		this._commandTrackerAddon = undefined;
		dispose(this._widgetManager);

		if (this._xterm && this._xterm.element) {
			this._hadFocusOnExit = this.hasFocus;
		}
		if (this._wrapperElement) {
			if (this._wrapperElement.xterm) {
				this._wrapperElement.xterm = undefined;
			}
			if (this._wrapperElement.parentElement && this._container) {
				this._container.removeChild(this._wrapperElement);
			}
		}
		if (this._xterm) {
			const buffer = this._xterm.buffer;
			this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY);
			this._xterm.dispose();
		}

		if (this._pressAnyKeyToCloseListener) {
			this._pressAnyKeyToCloseListener.dispose();
			this._pressAnyKeyToCloseListener = undefined;
		}

		this._processManager.dispose(immediate);
		// Process manager dispose/shutdown doesn't fire process exit, trigger with undefined if it
		// hasn't happened yet
		this._onProcessExit(undefined);

		if (!this._isDisposed) {
			this._isDisposed = true;
			this._onDisposed.fire(this);
		}
		super.dispose();
	}

	async detachFromProcess(): Promise<void> {
		await this._processManager.detachFromProcess();
		this.dispose();
	}

	forceRedraw(): void {
		if (!this._xterm) {
			return;
		}
		this._webglAddon?.clearTextureAtlas();
		// TODO: Do canvas renderer too?
	}

	focus(force?: boolean): void {
		this._refreshAltBufferContextKey();
		if (!this._xterm) {
			return;
		}
		const selection = window.getSelection();
		if (!selection) {
			return;
		}
		const text = selection.toString();
		if (!text || force) {
			this._xterm.focus();
		}
	}

	async focusWhenReady(force?: boolean): Promise<void> {
		await this._xtermReadyPromise;
		await this._attachBarrier.wait();
		this.focus(force);
	}

	async paste(): Promise<void> {
		if (!this._xterm) {
			return;
		}
		this.focus();
		this._xterm.paste(await this._clipboardService.readText());
	}

	async pasteSelection(): Promise<void> {
		if (!this._xterm) {
			return;
		}
		this.focus();
		this._xterm.paste(await this._clipboardService.readText('selection'));
	}

	async sendText(text: string, addNewLine: boolean): Promise<void> {
		// Normalize line endings to 'enter' press.
		text = text.replace(/\r?\n/g, '\r');
		if (addNewLine && text.substr(text.length - 1) !== '\r') {
			text += '\r';
		}

		// Send it to the process
		return this._processManager.write(text);
	}

	setVisible(visible: boolean): void {
		this._isVisible = visible;
		if (this._wrapperElement) {
			this._wrapperElement.classList.toggle('active', visible);
		}
		if (visible && this._xterm && this._xtermCore) {
			// Trigger a manual scroll event which will sync the viewport and scroll bar. This is
			// necessary if the number of rows in the terminal has decreased while it was in the
			// background since scrollTop changes take no effect but the terminal's position does
			// change since the number of visible rows decreases.
			// This can likely be removed after https://github.com/xtermjs/xterm.js/issues/291 is
			// fixed upstream.
			this._xtermCore._onScroll.fire(this._xterm.buffer.active.viewportY);
		}
	}

	scrollDownLine(): void {
		this._xterm?.scrollLines(1);
	}

	scrollDownPage(): void {
		this._xterm?.scrollPages(1);
	}

	scrollToBottom(): void {
		this._xterm?.scrollToBottom();
	}

	scrollUpLine(): void {
		this._xterm?.scrollLines(-1);
	}

	scrollUpPage(): void {
		this._xterm?.scrollPages(-1);
	}

	scrollToTop(): void {
		this._xterm?.scrollToTop();
	}

	clear(): void {
		this._xterm?.clear();
	}

	private _refreshSelectionContextKey() {
		const isActive = !!this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID);
		this._terminalHasTextContextKey.set(isActive && this.hasSelection());
	}

	protected _createProcessManager(): void {
		this._processManager = this._instantiationService.createInstance(TerminalProcessManager, this._instanceId, this._configHelper);
		this._processManager.onProcessReady(() => {
			this._onProcessIdReady.fire(this);
			// Set the initial name based on the _resolved_ shell launch config, this will also
			// ensure the resolved icon gets shown
			if (this._shellLaunchConfig.name) {
				this.setTitle(this._shellLaunchConfig.name, TitleEventSource.Api);
			} else {
				// Only listen for process title changes when a name is not provided
				if (this._configHelper.config.titleMode === 'sequence') {
					// Set the title to the first event if the sequence hasn't set it yet
					Event.once(this._processManager.onProcessTitle)(e => {
						if (!this._title) {
							this.setTitle(e, TitleEventSource.Sequence);
						}
					});
					// Listen to xterm.js' sequence title change event, trigger this async to ensure
					// _xtermReadyPromise is ready constructed since this is called from the ctor
					setTimeout(() => {
						this._xtermReadyPromise.then(xterm => {
							this._messageTitleDisposable = xterm.onTitleChange(e => this._onTitleChange(e));
						});
					});
				} else {
					this.setTitle(this._shellLaunchConfig.executable, TitleEventSource.Process);
					this._messageTitleDisposable = this._processManager.onProcessTitle(title => this.setTitle(title ? title : '', TitleEventSource.Process));
				}
			}
		});
		this._processManager.onProcessExit(exitCode => this._onProcessExit(exitCode));
		this._processManager.onProcessData(ev => {
			this._initialDataEvents?.push(ev.data);
			this._onData.fire(ev.data);
		});
		this._processManager.onProcessOverrideDimensions(e => this.setDimensions(e, true));
		this._processManager.onProcessResolvedShellLaunchConfig(e => this._setResolvedShellLaunchConfig(e));
		this._processManager.onEnvironmentVariableInfoChanged(e => this._onEnvironmentVariableInfoChanged(e));
		this._processManager.onProcessShellTypeChanged(type => this.setShellType(type));
		this._processManager.onPtyDisconnect(() => {
			this._safeSetOption('disableStdin', true);
			this.statusList.add({
				id: TerminalStatus.Disconnected,
				severity: Severity.Error,
				icon: Codicon.debugDisconnect,
				tooltip: nls.localize('disconnectStatus', "Lost connection to process")
			});
		});
		this._processManager.onPtyReconnect(() => {
			this._safeSetOption('disableStdin', false);
			this.statusList.remove(TerminalStatus.Disconnected);
		});
	}

	private async _createProcess(): Promise<void> {
		if (this._isDisposed) {
			return;
		}
		const hadIcon = !!this.shellLaunchConfig.icon;
		await this._processManager.createProcess(this._shellLaunchConfig, this._cols, this._rows, this._accessibilityService.isScreenReaderOptimized()).then(error => {
			if (error) {
				this._onProcessExit(error);
			}
		});
		if (!hadIcon && this.shellLaunchConfig.icon) {
			this._onIconChanged.fire(this);
		}
	}

	private _onProcessData(ev: IProcessDataEvent): void {
		const messageId = ++this._latestXtermWriteData;
		if (ev.trackCommit) {
			ev.writePromise = new Promise<void>(r => {
				this._xterm?.write(ev.data, () => {
					this._latestXtermParseData = messageId;
					this._processManager.acknowledgeDataEvent(ev.data.length);
					r();
				});
			});
		} else {
			this._xterm?.write(ev.data, () => {
				this._latestXtermParseData = messageId;
				this._processManager.acknowledgeDataEvent(ev.data.length);
			});
		}
	}

	/**
	 * Called when either a process tied to a terminal has exited or when a terminal renderer
	 * simulates a process exiting (e.g. custom execution task).
	 * @param exitCode The exit code of the process, this is undefined when the terminal was exited
	 * through user action.
	 */
	private async _onProcessExit(exitCodeOrError?: number | ITerminalLaunchError): Promise<void> {
		// Prevent dispose functions being triggered multiple times
		if (this._isExiting) {
			return;
		}

		this._isExiting = true;

		await this._flushXtermData();
		this._logService.debug(`Terminal process exit (instanceId: ${this.instanceId}) with code ${this._exitCode}`);

		let exitCodeMessage: string | undefined;

		// Create exit code message
		switch (typeof exitCodeOrError) {
			case 'number':
				// Only show the error if the exit code is non-zero
				this._exitCode = exitCodeOrError;
				if (this._exitCode === 0) {
					break;
				}

				let commandLine: string | undefined = undefined;
				if (this._shellLaunchConfig.executable) {
					commandLine = this._shellLaunchConfig.executable;
					if (typeof this._shellLaunchConfig.args === 'string') {
						commandLine += ` ${this._shellLaunchConfig.args}`;
					} else if (this._shellLaunchConfig.args && this._shellLaunchConfig.args.length) {
						commandLine += this._shellLaunchConfig.args.map(a => ` '${a}'`).join();
					}
				}

				if (this._processManager.processState === ProcessState.KilledDuringLaunch) {
					if (commandLine) {
						exitCodeMessage = nls.localize('launchFailed.exitCodeAndCommandLine', "The terminal process \"{0}\" failed to launch (exit code: {1}).", commandLine, this._exitCode);
						break;
					}
					exitCodeMessage = nls.localize('launchFailed.exitCodeOnly', "The terminal process failed to launch (exit code: {0}).", this._exitCode);
					break;
				}
				if (commandLine) {
					exitCodeMessage = nls.localize('terminated.exitCodeAndCommandLine', "The terminal process \"{0}\" terminated with exit code: {1}.", commandLine, this._exitCode);
					break;
				}
				exitCodeMessage = nls.localize('terminated.exitCodeOnly', "The terminal process terminated with exit code: {0}.", this._exitCode);
				break;
			case 'object':
				if (exitCodeOrError.message.toString().includes('Could not find pty with id')) {
					break;
				}
				this._exitCode = exitCodeOrError.code;
				exitCodeMessage = nls.localize('launchFailed.errorMessage', "The terminal process failed to launch: {0}.", exitCodeOrError.message);
				break;
		}

		this._logService.debug(`Terminal process exit (instanceId: ${this.instanceId}) state ${this._processManager.processState}`);

		// Only trigger wait on exit when the exit was *not* triggered by the
		// user (via the `workbench.action.terminal.kill` command).
		if (this._shellLaunchConfig.waitOnExit && this._processManager.processState !== ProcessState.KilledByUser) {
			this._xtermReadyPromise.then(xterm => {
				if (exitCodeMessage) {
					xterm.writeln(exitCodeMessage);
				}
				if (typeof this._shellLaunchConfig.waitOnExit === 'string') {
					xterm.write(formatMessageForTerminal(this._shellLaunchConfig.waitOnExit));
				}
				// Disable all input if the terminal is exiting and listen for next keypress
				xterm.setOption('disableStdin', true);
				if (xterm.textarea) {
					this._attachPressAnyKeyToCloseListener(xterm);
				}
			});
		} else {
			this.dispose();
			if (exitCodeMessage) {
				const failedDuringLaunch = this._processManager.processState === ProcessState.KilledDuringLaunch;
				if (failedDuringLaunch || this._configHelper.config.showExitAlert) {
					// Always show launch failures
					this._notificationService.notify({
						message: exitCodeMessage,
						severity: Severity.Error,
						actions: { primary: [this._instantiationService.createInstance(TerminalLaunchHelpAction)] }
					});
				} else {
					// Log to help surface the error in case users report issues with showExitAlert
					// disabled
					this._logService.warn(exitCodeMessage);
				}
			}
		}

		this._onExit.fire(this._exitCode);
		this._onExit.dispose();
	}

	/**
	 * Ensure write calls to xterm.js have finished before resolving.
	 */
	private _flushXtermData(): Promise<void> {
		if (this._latestXtermWriteData === this._latestXtermParseData) {
			return Promise.resolve();
		}
		let retries = 0;
		return new Promise<void>(r => {
			const interval = setInterval(() => {
				if (this._latestXtermWriteData === this._latestXtermParseData || ++retries === 5) {
					clearInterval(interval);
					r();
				}
			}, 20);
		});
	}

	private _attachPressAnyKeyToCloseListener(xterm: XTermTerminal) {
		if (xterm.textarea && !this._pressAnyKeyToCloseListener) {
			this._pressAnyKeyToCloseListener = dom.addDisposableListener(xterm.textarea, 'keypress', (event: KeyboardEvent) => {
				if (this._pressAnyKeyToCloseListener) {
					this._pressAnyKeyToCloseListener.dispose();
					this._pressAnyKeyToCloseListener = undefined;
					this.dispose();
					event.preventDefault();
				}
			});
		}
	}

	reuseTerminal(shell: IShellLaunchConfig, reset: boolean = false): void {
		// Unsubscribe any key listener we may have.
		this._pressAnyKeyToCloseListener?.dispose();
		this._pressAnyKeyToCloseListener = undefined;

		if (this._xterm) {
			if (!reset) {
				// Ensure new processes' output starts at start of new line
				this._xterm.write('\n\x1b[G');
			}

			// Print initialText if specified
			if (shell.initialText) {
				this._xterm.writeln(shell.initialText);
			}

			// Clean up waitOnExit state
			if (this._isExiting && this._shellLaunchConfig.waitOnExit) {
				this._xterm.setOption('disableStdin', false);
				this._isExiting = false;
			}
		}

		// Dispose the environment info widget if it exists
		this.statusList.remove(TerminalStatus.RelaunchNeeded);
		this._environmentInfo?.disposable.dispose();
		this._environmentInfo = undefined;

		if (!reset) {
			// HACK: Force initialText to be non-falsy for reused terminals such that the
			// conptyInheritCursor flag is passed to the node-pty, this flag can cause a Window to stop
			// responding in Windows 10 1903 so we only want to use it when something is definitely written
			// to the terminal.
			shell.initialText = ' ';
		}

		// Set the new shell launch config
		this._shellLaunchConfig = shell; // Must be done before calling _createProcess()

		this._processManager.relaunch(this._shellLaunchConfig, this._cols, this._rows, this._accessibilityService.isScreenReaderOptimized(), reset);

		// Set title again as when creating the first process
		if (this._shellLaunchConfig.name) {
			this.setTitle(this._shellLaunchConfig.name, TitleEventSource.Api);
		}

		this._xtermTypeAhead?.reset();
	}

	@debounce(1000)
	relaunch(): void {
		this.reuseTerminal(this._shellLaunchConfig, true);
	}

	private _onLineFeed(): void {
		const buffer = this._xterm!.buffer;
		const newLine = buffer.active.getLine(buffer.active.baseY + buffer.active.cursorY);
		if (newLine && !newLine.isWrapped) {
			this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY - 1);
		}
	}

	private _onCursorMove(): void {
		const buffer = this._xterm!.buffer;
		this._sendLineData(buffer.active, buffer.active.baseY + buffer.active.cursorY);
	}

	private _onTitleChange(title: string): void {
		if (this.isTitleSetByProcess) {
			this.setTitle(title, TitleEventSource.Sequence);
		}
	}

	private _sendLineData(buffer: IBuffer, lineIndex: number): void {
		let line = buffer.getLine(lineIndex);
		if (!line) {
			return;
		}
		let lineData = line.translateToString(true);
		while (lineIndex > 0 && line.isWrapped) {
			line = buffer.getLine(--lineIndex);
			if (!line) {
				break;
			}
			lineData = line.translateToString(false) + lineData;
		}
		this._onLineData.fire(lineData);
	}

	private _onKey(key: string, ev: KeyboardEvent): void {
		const event = new StandardKeyboardEvent(ev);

		if (event.equals(KeyCode.Enter)) {
			this._updateProcessCwd();
		}
	}

	private async _onSelectionChange(): Promise<void> {
		if (this._configurationService.getValue(TerminalSettingId.CopyOnSelection)) {
			if (this.hasSelection()) {
				await this.copySelection();
			}
		}
	}

	@debounce(2000)
	private async _updateProcessCwd(): Promise<string> {
		// reset cwd if it has changed, so file based url paths can be resolved
		const cwd = await this.getCwd();
		if (cwd && this._linkManager) {
			this._linkManager.processCwd = cwd;
		}
		return cwd;
	}

	updateConfig(): void {
		const config = this._configHelper.config;
		this._safeSetOption('altClickMovesCursor', config.altClickMovesCursor);
		this._setCursorBlink(config.cursorBlinking);
		this._setCursorStyle(config.cursorStyle);
		this._setCursorWidth(config.cursorWidth);
		this._setCommandsToSkipShell(config.commandsToSkipShell);
		this._safeSetOption('scrollback', config.scrollback);
		this._safeSetOption('drawBoldTextInBrightColors', config.drawBoldTextInBrightColors);
		this._safeSetOption('minimumContrastRatio', config.minimumContrastRatio);
		this._safeSetOption('fastScrollSensitivity', config.fastScrollSensitivity);
		this._safeSetOption('scrollSensitivity', config.mouseWheelScrollSensitivity);
		this._safeSetOption('macOptionIsMeta', config.macOptionIsMeta);
		const editorOptions = this._configurationService.getValue<IEditorOptions>('editor');
		this._safeSetOption('altClickMovesCursor', config.altClickMovesCursor && editorOptions.multiCursorModifier === 'alt');
		this._safeSetOption('macOptionClickForcesSelection', config.macOptionClickForcesSelection);
		this._safeSetOption('rightClickSelectsWord', config.rightClickBehavior === 'selectWord');
		this._safeSetOption('wordSeparator', config.wordSeparators);

		const suggestedRendererType = this._storageService.get(SUGGESTED_RENDERER_TYPE, StorageScope.GLOBAL);
		if ((config.gpuAcceleration === 'auto' && suggestedRendererType === undefined) || config.gpuAcceleration === 'on') {
			this._enableWebglRenderer();
		} else {
			this._disposeOfWebglRenderer();
			this._safeSetOption('rendererType', this._getBuiltInXtermRenderer(config.gpuAcceleration, suggestedRendererType));
		}
		this._refreshEnvironmentVariableInfoWidgetState(this._processManager.environmentVariableInfo);
	}

	private _getBuiltInXtermRenderer(gpuAcceleration: string, suggestedRendererType?: string): RendererType {
		let rendererType: RendererType = 'canvas';
		if (gpuAcceleration === 'off' || (gpuAcceleration === 'auto' && suggestedRendererType === 'dom')) {
			rendererType = 'dom';
		}
		return rendererType;
	}

	private async _enableWebglRenderer(): Promise<void> {
		if (!this._xterm?.element || this._webglAddon) {
			return;
		}
		const Addon = await this._terminalInstanceService.getXtermWebglConstructor();
		this._webglAddon = new Addon();
		try {
			this._xterm.loadAddon(this._webglAddon);
			this._webglAddon.onContextLoss(() => {
				this._logService.info(`Webgl lost context, disposing of webgl renderer`);
				this._disposeOfWebglRenderer();
				this._safeSetOption('rendererType', 'dom');
			});
		} catch (e) {
			this._logService.warn(`Webgl could not be loaded. Falling back to the canvas renderer type.`, e);
			const neverMeasureRenderTime = this._storageService.getBoolean(NEVER_MEASURE_RENDER_TIME_STORAGE_KEY, StorageScope.GLOBAL, false);
			// if it's already set to dom, no need to measure render time
			if (!neverMeasureRenderTime && this._configHelper.config.gpuAcceleration !== 'off') {
				this._measureRenderTime();
			}
			this._safeSetOption('rendererType', 'canvas');
			this._storageService.store(SUGGESTED_RENDERER_TYPE, 'canvas', StorageScope.GLOBAL, StorageTarget.MACHINE);
			this._disposeOfWebglRenderer();
		}
	}

	private _disposeOfWebglRenderer(): void {
		try {
			this._webglAddon?.dispose();
		} catch {
			// ignore
		}
		this._webglAddon = undefined;
	}

	private async _updateUnicodeVersion(): Promise<void> {
		if (!this._xterm) {
			throw new Error('Cannot update unicode version before xterm has been initialized');
		}
		if (!this._xtermUnicode11 && this._configHelper.config.unicodeVersion === '11') {
			const Addon = await this._terminalInstanceService.getXtermUnicode11Constructor();
			this._xtermUnicode11 = new Addon();
			this._xterm.loadAddon(this._xtermUnicode11);
		}
		this._xterm.unicode.activeVersion = this._configHelper.config.unicodeVersion;
	}

	updateAccessibilitySupport(): void {
		const isEnabled = this._accessibilityService.isScreenReaderOptimized();
		if (isEnabled) {
			this._navigationModeAddon = new NavigationModeAddon(this._terminalA11yTreeFocusContextKey);
			this._xterm!.loadAddon(this._navigationModeAddon);
		} else {
			this._navigationModeAddon?.dispose();
			this._navigationModeAddon = undefined;
		}
		this._xterm!.setOption('screenReaderMode', isEnabled);
	}

	private _setCursorBlink(blink: boolean): void {
		if (this._xterm && this._xterm.getOption('cursorBlink') !== blink) {
			this._xterm.setOption('cursorBlink', blink);
			this._xterm.refresh(0, this._xterm.rows - 1);
		}
	}

	private _setCursorStyle(style: string): void {
		if (this._xterm && this._xterm.getOption('cursorStyle') !== style) {
			// 'line' is used instead of bar in VS Code to be consistent with editor.cursorStyle
			const xtermOption = style === 'line' ? 'bar' : style;
			this._xterm.setOption('cursorStyle', xtermOption);
		}
	}

	private _setCursorWidth(width: number): void {
		if (this._xterm && this._xterm.getOption('cursorWidth') !== width) {
			this._xterm.setOption('cursorWidth', width);
		}
	}

	private _setCommandsToSkipShell(commands: string[]): void {
		const excludeCommands = commands.filter(command => command[0] === '-').map(command => command.slice(1));
		this._skipTerminalCommands = DEFAULT_COMMANDS_TO_SKIP_SHELL.filter(defaultCommand => {
			return excludeCommands.indexOf(defaultCommand) === -1;
		}).concat(commands);
	}

	private _safeSetOption(key: string, value: any): void {
		if (!this._xterm) {
			return;
		}

		if (this._xterm.getOption(key) !== value) {
			this._xterm.setOption(key, value);
		}
	}

	layout(dimension: dom.Dimension): void {
		this._lastLayoutDimensions = dimension;
		if (this.disableLayout) {
			return;
		}

		// Don't layout if dimensions are invalid (eg. the container is not attached to the DOM or
		// if display: none
		if (dimension.width <= 0 || dimension.height <= 0) {
			return;
		}

		const terminalWidth = this._evaluateColsAndRows(dimension.width, dimension.height);
		if (!terminalWidth) {
			return;
		}

		if (this._xterm && this._xterm.element) {
			this._xterm.element.style.width = terminalWidth + 'px';
		}

		this._resize();

		// Signal the container is ready
		this._containerReadyBarrier.open();
	}

	@debounce(50)
	private async _resize(): Promise<void> {
		this._resizeNow(false);
	}

	private async _resizeNow(immediate: boolean): Promise<void> {
		let cols = this.cols;
		let rows = this.rows;

		if (this._xterm && this._xtermCore) {
			// Only apply these settings when the terminal is visible so that
			// the characters are measured correctly.
			if (this._isVisible) {
				const font = this._configHelper.getFont(this._xtermCore);
				const config = this._configHelper.config;
				this._safeSetOption('letterSpacing', font.letterSpacing);
				this._safeSetOption('lineHeight', font.lineHeight);
				this._safeSetOption('fontSize', font.fontSize);
				this._safeSetOption('fontFamily', font.fontFamily);
				this._safeSetOption('fontWeight', config.fontWeight);
				this._safeSetOption('fontWeightBold', config.fontWeightBold);

				// Any of the above setting changes could have changed the dimensions of the
				// terminal, re-evaluate now.
				this._initDimensions();
				cols = this.cols;
				rows = this.rows;
			}

			if (isNaN(cols) || isNaN(rows)) {
				return;
			}

			if (cols !== this._xterm.cols || rows !== this._xterm.rows) {
				this._onDimensionsChanged.fire();
			}

			this._xterm.resize(cols, rows);
			TerminalInstance._lastKnownGridDimensions = { cols, rows };

			if (this._isVisible) {
				// HACK: Force the renderer to unpause by simulating an IntersectionObserver event.
				// This is to fix an issue where dragging the window to the top of the screen to
				// maximize on Windows/Linux would fire an event saying that the terminal was not
				// visible.
				if (this._xterm.getOption('rendererType') === 'canvas') {
					this._xtermCore._renderService?._onIntersectionChange({ intersectionRatio: 1 });
					// HACK: Force a refresh of the screen to ensure links are refresh corrected.
					// This can probably be removed when the above hack is fixed in Chromium.
					this._xterm.refresh(0, this._xterm.rows - 1);
				}
			}
		}

		if (immediate) {
			// do not await, call setDimensions synchronously
			this._processManager.setDimensions(cols, rows, true);
		} else {
			await this._processManager.setDimensions(cols, rows);
		}
	}

	setShellType(shellType: TerminalShellType) {
		this._shellType = shellType;
	}

	private _setAriaLabel(xterm: XTermTerminal | undefined, terminalId: number, title: string | undefined): void {
		if (xterm) {
			if (title && title.length > 0) {
				xterm.textarea?.setAttribute('aria-label', nls.localize('terminalTextBoxAriaLabelNumberAndTitle', "Terminal {0}, {1}", terminalId, title));
			} else {
				xterm.textarea?.setAttribute('aria-label', nls.localize('terminalTextBoxAriaLabel', "Terminal {0}", terminalId));
			}
		}
	}

	setTitle(title: string | undefined, eventSource: TitleEventSource): void {
		if (!title) {
			return;
		}
		switch (eventSource) {
			case TitleEventSource.Process:

				if (this._processManager.os === OperatingSystem.Windows) {
					// Extract the file name without extension
					title = path.win32.parse(title).name;
				} else {
					const firstSpaceIndex = title.indexOf(' ');
					if (title.startsWith('/')) {
						title = path.basename(title);
					} else if (firstSpaceIndex > -1) {
						title = title.substring(0, firstSpaceIndex);
					}
				}
				break;
			case TitleEventSource.Api:
				// If the title has not been set by the API or the rename command, unregister the handler that
				// automatically updates the terminal name
				dispose(this._messageTitleDisposable);
				this._messageTitleDisposable = undefined;
				break;
			case TitleEventSource.Sequence:
				// On Windows, some shells will fire this with the full path which we want to trim
				// to show just the file name. This should only happen if the title looks like an
				// absolute Windows file path
				if (this._processManager.os === OperatingSystem.Windows && title.match(/^[a-zA-Z]:\\.+\.[a-zA-Z]{1,3}/)) {
					title = path.win32.parse(title).name;
				}
				break;
		}

		// Remove special characters that could mess with rendering
		title = title.replace(/[\n\r\t]/g, '');

		const didTitleChange = title !== this._title;
		this._title = title;
		this._titleSource = eventSource;
		if (didTitleChange) {
			this._setAriaLabel(this._xterm, this._instanceId, this._title);

			if (this._titleReadyComplete) {
				this._titleReadyComplete(title);
				this._titleReadyComplete = undefined;
			}
			this._onTitleChanged.fire(this);
		}
	}

	waitForTitle(): Promise<string> {
		return this._titleReadyPromise;
	}

	setDimensions(dimensions: ITerminalDimensionsOverride | undefined, immediate: boolean = false): void {
		if (this._dimensionsOverride && this._dimensionsOverride.forceExactSize && !dimensions && this._rows === 0 && this._cols === 0) {
			// this terminal never had a real size => keep the last dimensions override exact size
			this._cols = this._dimensionsOverride.cols;
			this._rows = this._dimensionsOverride.rows;
		}
		this._dimensionsOverride = dimensions;
		if (immediate) {
			this._resizeNow(true);
		} else {
			this._resize();
		}
	}

	private _setResolvedShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig): void {
		this._shellLaunchConfig.args = shellLaunchConfig.args;
		this._shellLaunchConfig.cwd = shellLaunchConfig.cwd;
		this._shellLaunchConfig.executable = shellLaunchConfig.executable;
		this._shellLaunchConfig.env = shellLaunchConfig.env;
	}

	showEnvironmentInfoHover(): void {
		if (this._environmentInfo) {
			this._environmentInfo.widget.focus();
		}
	}

	private _onEnvironmentVariableInfoChanged(info: IEnvironmentVariableInfo): void {
		if (info.requiresAction) {
			this._xterm?.textarea?.setAttribute('aria-label', nls.localize('terminalStaleTextBoxAriaLabel', "Terminal {0} environment is stale, run the 'Show Environment Information' command for more information", this._instanceId));
		}
		this._refreshEnvironmentVariableInfoWidgetState(info);
	}

	private _refreshEnvironmentVariableInfoWidgetState(info?: IEnvironmentVariableInfo): void {
		// Check if the widget should not exist
		if (
			!info ||
			this._configHelper.config.environmentChangesIndicator === 'off' ||
			this._configHelper.config.environmentChangesIndicator === 'warnonly' && !info.requiresAction
		) {
			this.statusList.remove(TerminalStatus.RelaunchNeeded);
			this._environmentInfo?.disposable.dispose();
			this._environmentInfo = undefined;
			return;
		}

		// Recreate the process if the terminal has not yet been interacted with and it's not a
		// special terminal (eg. task, extension terminal)
		if (
			info.requiresAction &&
			this._configHelper.config.environmentChangesRelaunch &&
			!this._processManager.hasWrittenData &&
			!this._shellLaunchConfig.isFeatureTerminal &&
			!this._shellLaunchConfig.customPtyImplementation
			&& !this._shellLaunchConfig.isExtensionOwnedTerminal &&
			!this._shellLaunchConfig.attachPersistentProcess
		) {
			this.relaunch();
			return;
		}

		// (Re-)create the widget
		this._environmentInfo?.disposable.dispose();
		const widget = this._instantiationService.createInstance(EnvironmentVariableInfoWidget, info);
		const disposable = this._widgetManager.attachWidget(widget);
		if (info.requiresAction) {
			this.statusList.add({
				id: TerminalStatus.RelaunchNeeded,
				severity: Severity.Warning,
				icon: Codicon.warning,
				tooltip: info.getInfo(),
				hoverActions: info.getActions ? info.getActions() : undefined
			});
		}
		if (disposable) {
			this._environmentInfo = { widget, disposable };
		}
	}

	private _getXtermTheme(theme?: IColorTheme): ITheme {
		if (!theme) {
			theme = this._themeService.getColorTheme();
		}

		const location = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID)!;
		const foregroundColor = theme.getColor(TERMINAL_FOREGROUND_COLOR);
		let backgroundColor: Color | undefined;
		if (this.target === TerminalLocation.Editor) {
			backgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(editorBackground);
		} else {
			backgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || (location === ViewContainerLocation.Sidebar ? theme.getColor(SIDE_BAR_BACKGROUND) : theme.getColor(PANEL_BACKGROUND));
		}
		const cursorColor = theme.getColor(TERMINAL_CURSOR_FOREGROUND_COLOR) || foregroundColor;
		const cursorAccentColor = theme.getColor(TERMINAL_CURSOR_BACKGROUND_COLOR) || backgroundColor;
		const selectionColor = theme.getColor(TERMINAL_SELECTION_BACKGROUND_COLOR);

		return {
			background: backgroundColor ? backgroundColor.toString() : undefined,
			foreground: foregroundColor ? foregroundColor.toString() : undefined,
			cursor: cursorColor ? cursorColor.toString() : undefined,
			cursorAccent: cursorAccentColor ? cursorAccentColor.toString() : undefined,
			selection: selectionColor ? selectionColor.toString() : undefined,
			black: theme.getColor(ansiColorIdentifiers[0])!.toString(),
			red: theme.getColor(ansiColorIdentifiers[1])!.toString(),
			green: theme.getColor(ansiColorIdentifiers[2])!.toString(),
			yellow: theme.getColor(ansiColorIdentifiers[3])!.toString(),
			blue: theme.getColor(ansiColorIdentifiers[4])!.toString(),
			magenta: theme.getColor(ansiColorIdentifiers[5])!.toString(),
			cyan: theme.getColor(ansiColorIdentifiers[6])!.toString(),
			white: theme.getColor(ansiColorIdentifiers[7])!.toString(),
			brightBlack: theme.getColor(ansiColorIdentifiers[8])!.toString(),
			brightRed: theme.getColor(ansiColorIdentifiers[9])!.toString(),
			brightGreen: theme.getColor(ansiColorIdentifiers[10])!.toString(),
			brightYellow: theme.getColor(ansiColorIdentifiers[11])!.toString(),
			brightBlue: theme.getColor(ansiColorIdentifiers[12])!.toString(),
			brightMagenta: theme.getColor(ansiColorIdentifiers[13])!.toString(),
			brightCyan: theme.getColor(ansiColorIdentifiers[14])!.toString(),
			brightWhite: theme.getColor(ansiColorIdentifiers[15])!.toString()
		};
	}

	private _updateTheme(xterm: XTermTerminal, theme?: IColorTheme): void {
		xterm.setOption('theme', this._getXtermTheme(theme));
	}

	async toggleEscapeSequenceLogging(): Promise<void> {
		const xterm = await this._xtermReadyPromise;
		const isDebug = xterm.getOption('logLevel') === 'debug';
		xterm.setOption('logLevel', isDebug ? 'info' : 'debug');
	}

	getInitialCwd(): Promise<string> {
		return this._processManager.getInitialCwd();
	}

	getCwd(): Promise<string> {
		return this._processManager.getCwd();
	}

	registerLinkProvider(provider: ITerminalExternalLinkProvider): IDisposable {
		if (!this._linkManager) {
			throw new Error('TerminalInstance.registerLinkProvider before link manager was ready');
		}
		return this._linkManager.registerExternalLinkProvider(this, provider);
	}

	async rename(title?: string) {
		if (!title) {
			title = await this._quickInputService.input({
				value: this.title,
				prompt: nls.localize('workbench.action.terminal.rename.prompt', "Enter terminal name"),
			});
		}
		if (title) {
			this.setTitle(title, TitleEventSource.Api);
		}
	}

	async changeIcon() {
		const items: IQuickPickItem[] = [];
		for (const icon of iconRegistry.all) {
			items.push({ label: `$(${icon.id})`, description: `${icon.id}` });
		}
		const result = await this._quickInputService.pick(items, {
			matchOnDescription: true
		});
		if (result && result.description) {
			this.shellLaunchConfig.icon = iconRegistry.get(result.description);
			this._onIconChanged.fire(this);
		}
	}

	async changeColor() {
		const icon = this._getIcon();
		if (!icon) {
			return;
		}

		const standardColors: string[] = [];
		const colorTheme = this._themeService.getColorTheme();
		for (const colorKey in ansiColorMap) {
			const color = colorTheme.getColor(colorKey);
			if (color && !colorKey.toLowerCase().includes('bright')) {
				standardColors.push(colorKey);
			}
		}

		const styleElement = document.createElement('style');
		let css = '';
		const items: (IQuickPickItem | IQuickPickSeparator)[] = [];
		for (const colorKey of standardColors) {
			const colorClass = getColorClass(colorKey);
			items.push({
				label: `$(${Codicon.circleFilled.id}) ${colorKey.replace('terminal.ansi', '')}`, id: colorKey, description: colorKey, iconClasses: [colorClass]
			});
			const color = colorTheme.getColor(colorKey);
			if (color) {
				css += (
					`.monaco-workbench .${colorClass} .codicon:first-child:not(.codicon-split-horizontal):not(.codicon-trashcan):not(.file-icon)` +
					`{ color: ${color} !important; }`
				);
			}
		}
		items.push({ type: 'separator' });
		const showAllColorsItem = { label: 'Reset to default' };
		items.push(showAllColorsItem);
		styleElement.textContent = css;
		document.body.appendChild(styleElement);

		const quickPick = this._quickInputService.createQuickPick();
		quickPick.items = items;
		quickPick.matchOnDescription = true;
		quickPick.show();
		const disposables: IDisposable[] = [];
		const result = await new Promise<IQuickPickItem | undefined>(r => {
			disposables.push(quickPick.onDidHide(() => r(undefined)));
			disposables.push(quickPick.onDidAccept(() => r(quickPick.selectedItems[0])));
		});
		dispose(disposables);

		if (result) {
			this.shellLaunchConfig.color = result.id;
			this._onIconChanged.fire(this);
		}

		quickPick.hide();
		document.body.removeChild(styleElement);
	}
}

class TerminalInstanceDragAndDropController extends Disposable implements IDragAndDropObserverCallbacks {
	private _dropOverlay?: HTMLElement;

	private readonly _onDropFile = new Emitter<string>();
	get onDropFile(): Event<string> { return this._onDropFile.event; }
	private readonly _onDropTerminal = new Emitter<IRequestAddInstanceToGroupEvent>();
	get onDropTerminal(): Event<IRequestAddInstanceToGroupEvent> { return this._onDropTerminal.event; }

	constructor(
		private readonly _container: HTMLElement,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
	) {
		super();
		this._register(toDisposable(() => this._clearDropOverlay()));
	}

	private _clearDropOverlay() {
		if (this._dropOverlay && this._dropOverlay.parentElement) {
			this._dropOverlay.parentElement.removeChild(this._dropOverlay);
		}
		this._dropOverlay = undefined;
	}

	onDragEnter(e: DragEvent) {
		if (!containsDragType(e, DataTransfers.FILES, DataTransfers.RESOURCES, DataTransfers.TERMINALS)) {
			return;
		}

		if (!this._dropOverlay) {
			this._dropOverlay = document.createElement('div');
			this._dropOverlay.classList.add('terminal-drop-overlay');
		}

		// Dragging terminals
		if (containsDragType(e, DataTransfers.TERMINALS)) {
			const side = this._getDropSide(e);
			this._dropOverlay.classList.toggle('drop-before', side === 'before');
			this._dropOverlay.classList.toggle('drop-after', side === 'after');
		}

		if (!this._dropOverlay.parentElement) {
			this._container.appendChild(this._dropOverlay);
		}
	}
	onDragLeave(e: DragEvent) {
		this._clearDropOverlay();
	}

	onDragEnd(e: DragEvent) {
		this._clearDropOverlay();
	}

	onDragOver(e: DragEvent) {
		if (!e.dataTransfer || !this._dropOverlay) {
			return;
		}

		// Dragging terminals
		if (containsDragType(e, DataTransfers.TERMINALS)) {
			const side = this._getDropSide(e);
			this._dropOverlay.classList.toggle('drop-before', side === 'before');
			this._dropOverlay.classList.toggle('drop-after', side === 'after');
		}

		this._dropOverlay.style.opacity = '1';
	}

	async onDrop(e: DragEvent) {
		this._clearDropOverlay();

		if (!e.dataTransfer) {
			return;
		}

		const terminalResources = e.dataTransfer.getData(DataTransfers.TERMINALS);
		if (terminalResources) {
			const json = JSON.parse(terminalResources);
			for (const entry of json) {
				const uri = URI.from({
					scheme: Schemas.vscodeTerminal,
					path: URI.parse(entry).path
				});
				const side = this._getDropSide(e);
				this._onDropTerminal.fire({ uri, side });
			}
			return;
		}

		// Check if files were dragged from the tree explorer
		let path: string | undefined;
		const resources = e.dataTransfer.getData(DataTransfers.RESOURCES);
		if (resources) {
			const uri = URI.parse(JSON.parse(resources)[0]);
			if (uri.scheme === Schemas.vscodeTerminal) {
				const side = this._getDropSide(e);
				this._onDropTerminal.fire({ uri, side });
				return;
			} else {
				path = uri.fsPath;
			}
		} else if (e.dataTransfer.files.length > 0 && e.dataTransfer.files[0].path /* Electron only */) {
			// Check if the file was dragged from the filesystem
			path = URI.file(e.dataTransfer.files[0].path).fsPath;
		}

		if (!path) {
			return;
		}

		this._onDropFile.fire(path);
	}

	private _getDropSide(e: DragEvent): 'before' | 'after' {
		const target = this._container;
		if (!target) {
			return 'after';
		}

		const rect = target.getBoundingClientRect();
		return this._getViewOrientation() === Orientation.HORIZONTAL
			? (e.clientX - rect.left < rect.width / 2 ? 'before' : 'after')
			: (e.clientY - rect.top < rect.height / 2 ? 'before' : 'after');
	}

	private _getViewOrientation(): Orientation {
		const panelPosition = this._layoutService.getPanelPosition();
		const terminalLocation = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID);
		return terminalLocation === ViewContainerLocation.Panel && panelPosition === Position.BOTTOM
			? Orientation.HORIZONTAL
			: Orientation.VERTICAL;
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	// Border
	const border = theme.getColor(activeContrastBorder);
	if (border) {
		collector.addRule(`
			.monaco-workbench.hc-black .editor-instance .xterm.focus::before,
			.monaco-workbench.hc-black .pane-body.integrated-terminal .xterm.focus::before,
			.monaco-workbench.hc-black .editor-instance .xterm:focus::before,
			.monaco-workbench.hc-black .pane-body.integrated-terminal .xterm:focus::before { border-color: ${border}; }`
		);
	}

	// Scrollbar
	const scrollbarSliderBackgroundColor = theme.getColor(scrollbarSliderBackground);
	if (scrollbarSliderBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .editor-instance .find-focused .xterm .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .find-focused .xterm .xterm-viewport,
			.monaco-workbench .editor-instance .xterm.focus .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm.focus .xterm-viewport,
			.monaco-workbench .editor-instance .xterm:focus .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm:focus .xterm-viewport,
			.monaco-workbench .editor-instance .xterm:hover .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm:hover .xterm-viewport { background-color: ${scrollbarSliderBackgroundColor} !important; }
			.monaco-workbench .editor-instance .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm-viewport { scrollbar-color: ${scrollbarSliderBackgroundColor} transparent; }
		`);
	}

	const scrollbarSliderHoverBackgroundColor = theme.getColor(scrollbarSliderHoverBackground);
	if (scrollbarSliderHoverBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .editor-instance .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover,
			.monaco-workbench .pane-body.integrated-terminal .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover { background-color: ${scrollbarSliderHoverBackgroundColor}; }
			.monaco-workbench .editor-instance .xterm-viewport:hover,
			.monaco-workbench .pane-body.integrated-terminal .xterm-viewport:hover { scrollbar-color: ${scrollbarSliderHoverBackgroundColor} transparent; }
		`);
	}

	const scrollbarSliderActiveBackgroundColor = theme.getColor(scrollbarSliderActiveBackground);
	if (scrollbarSliderActiveBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .editor-instance .xterm .xterm-viewport::-webkit-scrollbar-thumb:active,
			.monaco-workbench .pane-body.integrated-terminal .xterm .xterm-viewport::-webkit-scrollbar-thumb:active { background-color: ${scrollbarSliderActiveBackgroundColor}; }
		`);
	}
});
