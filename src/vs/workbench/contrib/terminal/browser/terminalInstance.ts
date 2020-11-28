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
import { IDisposable, dispose, Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import { TabFocus } from 'vs/editor/common/config/commonEditorConfig';
import * as nls from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService, IPromptChoice, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { activeContrastBorder, scrollbarSliderActiveBackground, scrollbarSliderBackground, scrollbarSliderHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { ICssStyleCollector, IColorTheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { PANEL_BACKGROUND, SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { TerminalWidgetManager } from 'vs/workbench/contrib/terminal/browser/widgets/widgetManager';
import { IShellLaunchConfig, ITerminalProcessManager, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, NEVER_MEASURE_RENDER_TIME_STORAGE_KEY, ProcessState, TERMINAL_VIEW_ID, IWindowsShellHelper, KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, INavigationMode, TitleEventSource, DEFAULT_COMMANDS_TO_SKIP_SHELL, ITerminalLaunchError, IProcessDataEvent, ITerminalDimensionsOverride, SHOW_TERMINAL_CONFIG_PROMPT } from 'vs/workbench/contrib/terminal/common/terminal';
import { ansiColorIdentifiers, TERMINAL_BACKGROUND_COLOR, TERMINAL_CURSOR_BACKGROUND_COLOR, TERMINAL_CURSOR_FOREGROUND_COLOR, TERMINAL_FOREGROUND_COLOR, TERMINAL_SELECTION_BACKGROUND_COLOR } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { TerminalLinkManager } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ITerminalInstanceService, ITerminalInstance, TerminalShellType, WindowsShellType, ITerminalExternalLinkProvider } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalProcessManager } from 'vs/workbench/contrib/terminal/browser/terminalProcessManager';
import type { Terminal as XTermTerminal, IBuffer, ITerminalAddon } from 'xterm';
import type { SearchAddon, ISearchOptions } from 'xterm-addon-search';
import type { Unicode11Addon } from 'xterm-addon-unicode11';
import type { WebglAddon } from 'xterm-addon-webgl';
import { CommandTrackerAddon } from 'vs/workbench/contrib/terminal/browser/addons/commandTrackerAddon';
import { NavigationModeAddon } from 'vs/workbench/contrib/terminal/browser/addons/navigationModeAddon';
import { XTermCore } from 'vs/workbench/contrib/terminal/browser/xterm-private';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IViewsService, IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { EnvironmentVariableInfoWidget } from 'vs/workbench/contrib/terminal/browser/widgets/environmentVariableInfoWidget';
import { IEnvironmentVariableInfo } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { TerminalLaunchHelpAction } from 'vs/workbench/contrib/terminal/browser/terminalActions';
import { TypeAheadAddon } from 'vs/workbench/contrib/terminal/browser/terminalTypeAheadAddon';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';

// How long in milliseconds should an average frame take to render for a notification to appear
// which suggests the fallback DOM-based renderer
const SLOW_CANVAS_RENDER_THRESHOLD = 50;
const NUMBER_OF_FRAMES_TO_MEASURE = 20;

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
	private static readonly EOL_REGEX = /\r?\n/g;

	private static _lastKnownCanvasDimensions: ICanvasDimensions | undefined;
	private static _lastKnownGridDimensions: IGridDimensions | undefined;
	private static _idCounter = 1;

	private _processManager!: ITerminalProcessManager;
	private _pressAnyKeyToCloseListener: IDisposable | undefined;

	private _id: number;
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
	private _wrapperElement: (HTMLElement & { xterm?: XTermTerminal }) | undefined;
	private _xterm: XTermTerminal | undefined;
	private _xtermCore: XTermCore | undefined;
	private _xtermSearch: SearchAddon | undefined;
	private _xtermUnicode11: Unicode11Addon | undefined;
	private _xtermElement: HTMLDivElement | undefined;
	private _terminalHasTextContextKey: IContextKey<boolean>;
	private _terminalA11yTreeFocusContextKey: IContextKey<boolean>;
	private _cols: number = 0;
	private _rows: number = 0;
	private _dimensionsOverride: ITerminalDimensionsOverride | undefined;
	private _windowsShellHelper: IWindowsShellHelper | undefined;
	private _xtermReadyPromise: Promise<XTermTerminal>;
	private _titleReadyPromise: Promise<string>;
	private _titleReadyComplete: ((title: string) => any) | undefined;
	private _areLinksReady: boolean = false;
	private _initialDataEvents: string[] | undefined = [];

	private _messageTitleDisposable: IDisposable | undefined;

	private _widgetManager: TerminalWidgetManager = this._instantiationService.createInstance(TerminalWidgetManager);
	private _linkManager: TerminalLinkManager | undefined;
	private _environmentInfo: { widget: EnvironmentVariableInfoWidget, disposable: IDisposable } | undefined;
	private _webglAddon: WebglAddon | undefined;
	private _commandTrackerAddon: CommandTrackerAddon | undefined;
	private _navigationModeAddon: INavigationMode & ITerminalAddon | undefined;

	private _timeoutDimension: dom.Dimension | undefined;

	public disableLayout: boolean;
	public get id(): number { return this._id; }
	public get cols(): number {
		if (this._dimensionsOverride && this._dimensionsOverride.cols) {
			if (this._dimensionsOverride.forceExactSize) {
				return this._dimensionsOverride.cols;
			}
			return Math.min(Math.max(this._dimensionsOverride.cols, 2), this._cols);
		}
		return this._cols;
	}
	public get rows(): number {
		if (this._dimensionsOverride && this._dimensionsOverride.rows) {
			if (this._dimensionsOverride.forceExactSize) {
				return this._dimensionsOverride.rows;
			}
			return Math.min(Math.max(this._dimensionsOverride.rows, 2), this._rows);
		}
		return this._rows;
	}
	public get maxCols(): number { return this._cols; }
	public get maxRows(): number { return this._rows; }
	// TODO: Ideally processId would be merged into processReady
	public get processId(): number | undefined { return this._processManager.shellProcessId; }
	// TODO: How does this work with detached processes?
	// TODO: Should this be an event as it can fire twice?
	public get processReady(): Promise<void> { return this._processManager.ptyProcessReady; }
	public get areLinksReady(): boolean { return this._areLinksReady; }
	public get initialDataEvents(): string[] | undefined { return this._initialDataEvents; }
	public get exitCode(): number | undefined { return this._exitCode; }
	public get title(): string { return this._title; }
	public get hadFocusOnExit(): boolean { return this._hadFocusOnExit; }
	public get isTitleSetByProcess(): boolean { return !!this._messageTitleDisposable; }
	public get shellLaunchConfig(): IShellLaunchConfig { return this._shellLaunchConfig; }
	public get shellType(): TerminalShellType { return this._shellType; }
	public get commandTracker(): CommandTrackerAddon | undefined { return this._commandTrackerAddon; }
	public get navigationMode(): INavigationMode | undefined { return this._navigationModeAddon; }

	private readonly _onExit = new Emitter<number | undefined>();
	public get onExit(): Event<number | undefined> { return this._onExit.event; }
	private readonly _onDisposed = new Emitter<ITerminalInstance>();
	public get onDisposed(): Event<ITerminalInstance> { return this._onDisposed.event; }
	private readonly _onFocused = new Emitter<ITerminalInstance>();
	public get onFocused(): Event<ITerminalInstance> { return this._onFocused.event; }
	private readonly _onProcessIdReady = new Emitter<ITerminalInstance>();
	public get onProcessIdReady(): Event<ITerminalInstance> { return this._onProcessIdReady.event; }
	private readonly _onLinksReady = new Emitter<ITerminalInstance>();
	public get onLinksReady(): Event<ITerminalInstance> { return this._onLinksReady.event; }
	private readonly _onTitleChanged = new Emitter<ITerminalInstance>();
	public get onTitleChanged(): Event<ITerminalInstance> { return this._onTitleChanged.event; }
	private readonly _onData = new Emitter<string>();
	public get onData(): Event<string> { return this._onData.event; }
	private readonly _onLineData = new Emitter<string>();
	public get onLineData(): Event<string> { return this._onLineData.event; }
	private readonly _onRequestExtHostProcess = new Emitter<ITerminalInstance>();
	public get onRequestExtHostProcess(): Event<ITerminalInstance> { return this._onRequestExtHostProcess.event; }
	private readonly _onDimensionsChanged = new Emitter<void>();
	public get onDimensionsChanged(): Event<void> { return this._onDimensionsChanged.event; }
	private readonly _onMaximumDimensionsChanged = new Emitter<void>();
	public get onMaximumDimensionsChanged(): Event<void> { return this._onMaximumDimensionsChanged.event; }
	private readonly _onFocus = new Emitter<ITerminalInstance>();
	public get onFocus(): Event<ITerminalInstance> { return this._onFocus.event; }

	public constructor(
		private readonly _terminalFocusContextKey: IContextKey<boolean>,
		private readonly _terminalShellTypeContextKey: IContextKey<string>,
		private readonly _configHelper: TerminalConfigHelper,
		private _container: HTMLElement | undefined,
		private _shellLaunchConfig: IShellLaunchConfig,
		@ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService,
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
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService
	) {
		super();

		this._skipTerminalCommands = [];
		this._isExiting = false;
		this._hadFocusOnExit = false;
		this._isVisible = false;
		this._isDisposed = false;
		this._id = TerminalInstance._idCounter++;

		this._titleReadyPromise = new Promise<string>(c => {
			this._titleReadyComplete = c;
		});

		this._terminalHasTextContextKey = KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED.bindTo(this._contextKeyService);
		this._terminalA11yTreeFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS.bindTo(this._contextKeyService);
		this.disableLayout = false;

		this._logService.trace(`terminalInstance#ctor (id: ${this.id})`, this._shellLaunchConfig);

		this._initDimensions();
		this._createProcessManager();

		this._xtermReadyPromise = this._createXterm();
		this._xtermReadyPromise.then(() => {
			// Only attach xterm.js to the DOM if the terminal panel has been opened before.
			if (_container) {
				this._attachToElement(_container);
			}
			this._createProcess();
		});

		this.addDisposable(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('terminal.integrated') || e.affectsConfiguration('editor.fastScrollSensitivity') || e.affectsConfiguration('editor.mouseWheelScrollSensitivity')) {
				this.updateConfig();
				// HACK: Trigger another async layout to ensure xterm's CharMeasure is ready to use,
				// this hack can be removed when https://github.com/xtermjs/xterm.js/issues/702 is
				// supported.
				this.setVisible(this._isVisible);
			}
			if (e.affectsConfiguration('terminal.integrated.unicodeVersion')) {
				this._updateUnicodeVersion();
			}
			if (e.affectsConfiguration('editor.accessibilitySupport')) {
				this.updateAccessibilitySupport();
			}
		}));

		// Clear out initial data events after 10 seconds, hopefully extension hosts are up and
		// running at that point.
		let initialDataEventsTimeout: number | undefined = window.setTimeout(() => {
			initialDataEventsTimeout = undefined;
			this._initialDataEvents = undefined;
		}, 10000);
		this._register({
			dispose: () => {
				if (initialDataEventsTimeout) {
					window.clearTimeout(initialDataEventsTimeout);
				}
			}
		});
	}

	public addDisposable(disposable: IDisposable): void {
		this._register(disposable);
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

		// The panel is minimized
		if (!this._isVisible) {
			return TerminalInstance._lastKnownCanvasDimensions;
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
			bellStyle: config.enableBell ? 'sound' : 'none',
			macOptionIsMeta: config.macOptionIsMeta,
			macOptionClickForcesSelection: config.macOptionClickForcesSelection,
			rightClickSelectsWord: config.rightClickBehavior === 'selectWord',
			fastScrollModifier: 'alt',
			fastScrollSensitivity: editorOptions.fastScrollSensitivity,
			scrollSensitivity: editorOptions.mouseWheelScrollSensitivity,
			rendererType: config.rendererType === 'auto' || config.rendererType === 'experimentalWebgl' ? 'canvas' : config.rendererType,
			wordSeparator: config.wordSeparators
		});
		this._xterm = xterm;
		this._xtermCore = (xterm as any)._core as XTermCore;
		this._updateUnicodeVersion();
		this.updateAccessibilitySupport();
		this._terminalInstanceService.getXtermSearchConstructor().then(Addon => {
			this._xtermSearch = new Addon();
			xterm.loadAddon(this._xtermSearch);
		});
		if (this._shellLaunchConfig.initialText) {
			this._xterm.writeln(this._shellLaunchConfig.initialText);
		}
		this._xterm.onLineFeed(() => this._onLineFeed());
		this._xterm.onKey(e => this._onKey(e.key, e.domEvent));
		this._xterm.onSelectionChange(async () => this._onSelectionChange());

		this._processManager.onProcessData(e => this._onProcessData(e));
		this._xterm.onData(data => this._processManager.write(data));
		this.processReady.then(async () => {
			if (this._linkManager) {
				this._linkManager.processCwd = await this._processManager.getInitialCwd();
			}
		});
		// Init winpty compat and link handler after process creation as they rely on the
		// underlying process OS
		this._processManager.onProcessReady(() => {
			if (this._processManager.os === platform.OperatingSystem.Windows) {
				xterm.setOption('windowsMode', true);
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

		const typeaheadAddon = this._register(this._instantiationService.createInstance(TypeAheadAddon, this._processManager, this._configHelper));
		this._xterm.loadAddon(typeaheadAddon);

		return xterm;
	}

	public reattachToElement(container: HTMLElement): void {
		if (!this._wrapperElement) {
			throw new Error('The terminal instance has not been attached to a container yet');
		}

		this._wrapperElement.parentNode?.removeChild(this._wrapperElement);
		this._container = container;
		this._container.appendChild(this._wrapperElement);
	}

	public attachToElement(container: HTMLElement): void {
		// The container did not change, do nothing
		if (this._container === container) {
			return;
		}

		// Attach has not occured yet
		if (!this._wrapperElement) {
			this._attachToElement(container);
			return;
		}

		// The container changed, reattach
		this._container?.removeChild(this._wrapperElement);
		this._container = container;
		this._container.appendChild(this._wrapperElement);
	}

	public async _attachToElement(container: HTMLElement): Promise<void> {
		const xterm = await this._xtermReadyPromise;

		if (this._wrapperElement) {
			throw new Error('The terminal instance has already been attached to a container');
		}

		this._container = container;
		this._wrapperElement = document.createElement('div');
		this._wrapperElement.classList.add('terminal-wrapper');
		this._xtermElement = document.createElement('div');

		// Attach the xterm object to the DOM, exposing it to the smoke tests
		this._wrapperElement.xterm = this._xterm;

		this._wrapperElement.appendChild(this._xtermElement);
		this._container.appendChild(this._wrapperElement);
		xterm.open(this._xtermElement);
		if (this._configHelper.config.rendererType === 'experimentalWebgl') {
			this._enableWebglRenderer();
		}

		if (!xterm.element || !xterm.textarea) {
			throw new Error('xterm elements not set after open');
		}

		// Check if custom Terminal title exists and set same
		if (this._title.length > 0) {
			xterm.textarea.setAttribute('aria-label', nls.localize('terminalTextBoxAriaLabelNumberAndTitle', "Terminal {0}, {1}", this._id, this._title));
		} else {
			xterm.textarea.setAttribute('aria-label', nls.localize('terminalTextBoxAriaLabel', "Terminal {0}", this._id));
		}

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

			// for keyboard events that resolve to commands described
			// within commandsToSkipShell, either alert or skip processing by xterm.js
			if (resolveResult && this._skipTerminalCommands.some(k => k === resolveResult.commandId) && !this._configHelper.config.sendKeybindingsToShell) {
				// don't alert when terminal is opened or closed
				if (this._storageService.getBoolean(SHOW_TERMINAL_CONFIG_PROMPT, StorageScope.GLOBAL, true) &&
					resolveResult.commandId !== 'workbench.action.terminal.toggleTerminal' &&
					resolveResult.commandId !== 'workbench.action.terminal.new' &&
					resolveResult.commandId !== 'workbench.action.togglePanel' &&
					resolveResult.commandId !== 'workbench.action.terminal.focus') {
					this._notificationService.prompt(
						Severity.Info,
						nls.localize('configure terminal settings', "Some keybindings are dispatched to the workbench by default."),
						[
							{
								label: nls.localize('configureTerminalSettings', "Configure Terminal Settings"),
								run: () => {
									this._preferencesService.openSettings(false, '@id:terminal.integrated.commandsToSkipShell,terminal.integrated.sendKeybindingsToShell,terminal.integrated.allowChords');
								}
							} as IPromptChoice
						]
					);
					this._storageService.store(SHOW_TERMINAL_CONFIG_PROMPT, false, StorageScope.GLOBAL, StorageTarget.USER);
				}
				event.preventDefault();
				return false;
			}

			// Skip processing by xterm.js of keyboard events that match menu bar mnemonics
			if (this._configHelper.config.allowMnemonics && !platform.isMacintosh && event.altKey) {
				return false;
			}

			// If tab focus mode is on, tab is not passed to the terminal
			if (TabFocus.getTabFocusMode() && event.keyCode === 9) {
				return false;
			}

			// Always have alt+F4 skip the terminal on Windows and allow it to be handled by the
			// system
			if (platform.isWindows && event.altKey && event.key === 'F4' && !event.ctrlKey) {
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
		this._register(dom.addDisposableListener(xterm.element, 'focus', () => {
			this._terminalFocusContextKey.set(true);
			if (this.shellType) {
				this._terminalShellTypeContextKey.set(this.shellType.toString());
			} else {
				this._terminalShellTypeContextKey.reset();
			}
		}));
		this._register(dom.addDisposableListener(xterm.element, 'blur', () => {
			this._terminalFocusContextKey.reset();
			this._refreshSelectionContextKey();
		}));

		this._widgetManager.attachToElement(xterm.element);
		this._processManager.onProcessReady(() => this._linkManager?.setWidgetManager(this._widgetManager));

		const computedStyle = window.getComputedStyle(this._container);
		const width = parseInt(computedStyle.getPropertyValue('width').replace('px', ''), 10);
		const height = parseInt(computedStyle.getPropertyValue('height').replace('px', ''), 10);
		this.layout(new dom.Dimension(width, height));
		this.setVisible(this._isVisible);
		this.updateConfig();

		// If IShellLaunchConfig.waitOnExit was true and the process finished before the terminal
		// panel was initialized.
		if (xterm.getOption('disableStdin')) {
			this._attachPressAnyKeyToCloseListener(xterm);
		}

		const neverMeasureRenderTime = this._storageService.getBoolean(NEVER_MEASURE_RENDER_TIME_STORAGE_KEY, StorageScope.GLOBAL, false);
		if (!neverMeasureRenderTime && this._configHelper.config.rendererType === 'auto') {
			this._measureRenderTime();
		}
	}

	private async _measureRenderTime(): Promise<void> {
		await this._xtermReadyPromise;
		const frameTimes: number[] = [];
		const textRenderLayer = this._xtermCore!._renderService._renderer._renderLayers[0];
		const originalOnGridChanged = textRenderLayer.onGridChanged;

		const evaluateCanvasRenderer = () => {
			// Discard first frame time as it's normal to take longer
			frameTimes.shift();

			const medianTime = frameTimes.sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)];
			if (medianTime > SLOW_CANVAS_RENDER_THRESHOLD) {
				const promptChoices: IPromptChoice[] = [
					{
						label: nls.localize('yes', "Yes"),
						run: () => this._configurationService.updateValue('terminal.integrated.rendererType', 'dom', ConfigurationTarget.USER)
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
					nls.localize('terminal.slowRendering', 'The standard renderer for the integrated terminal appears to be slow on your computer. Would you like to switch to the alternative DOM-based renderer which may improve performance? [Read more about terminal settings](https://code.visualstudio.com/docs/editor/integrated-terminal#_changing-how-the-terminal-is-rendered).'),
					promptChoices
				);
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

	public hasSelection(): boolean {
		return this._xterm ? this._xterm.hasSelection() : false;
	}

	public async copySelection(): Promise<void> {
		const xterm = await this._xtermReadyPromise;
		if (this.hasSelection()) {
			await this._clipboardService.writeText(xterm.getSelection());
		} else {
			this._notificationService.warn(nls.localize('terminal.integrated.copySelection.noSelection', 'The terminal has no selection to copy'));
		}
	}

	public get selection(): string | undefined {
		return this._xterm && this.hasSelection() ? this._xterm.getSelection() : undefined;
	}

	public clearSelection(): void {
		this._xterm?.clearSelection();
	}

	public selectAll(): void {
		// Focus here to ensure the terminal context key is set
		this._xterm?.focus();
		this._xterm?.selectAll();
	}

	public findNext(term: string, searchOptions: ISearchOptions): boolean {
		if (!this._xtermSearch) {
			return false;
		}
		return this._xtermSearch.findNext(term, searchOptions);
	}

	public findPrevious(term: string, searchOptions: ISearchOptions): boolean {
		if (!this._xtermSearch) {
			return false;
		}
		return this._xtermSearch.findPrevious(term, searchOptions);
	}

	public notifyFindWidgetFocusChanged(isFocused: boolean): void {
		if (!this._xterm) {
			return;
		}
		const terminalFocused = !isFocused && (document.activeElement === this._xterm.textarea || document.activeElement === this._xterm.element);
		this._terminalFocusContextKey.set(terminalFocused);
	}

	public refreshFocusState() {
		this.notifyFindWidgetFocusChanged(false);
	}

	public dispose(immediate?: boolean): void {
		this._logService.trace(`terminalInstance#dispose (id: ${this.id})`);

		dispose(this._windowsShellHelper);
		this._windowsShellHelper = undefined;
		dispose(this._linkManager);
		this._linkManager = undefined;
		dispose(this._commandTrackerAddon);
		this._commandTrackerAddon = undefined;
		dispose(this._widgetManager);

		if (this._xterm && this._xterm.element) {
			this._hadFocusOnExit = this._xterm.element.classList.contains('focus');
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

	public forceRedraw(): void {
		if (!this._xterm) {
			return;
		}
		this._webglAddon?.clearTextureAtlas();
		// TODO: Do canvas renderer too?
	}

	public focus(force?: boolean): void {
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

	public async focusWhenReady(force?: boolean): Promise<void> {
		await this._xtermReadyPromise;
		this.focus(force);
	}

	public async paste(): Promise<void> {
		if (!this._xterm) {
			return;
		}
		this.focus();
		this._xterm.paste(await this._clipboardService.readText());
	}

	public async sendText(text: string, addNewLine: boolean): Promise<void> {
		// Normalize line endings to 'enter' press.
		text = text.replace(TerminalInstance.EOL_REGEX, '\r');
		if (addNewLine && text.substr(text.length - 1) !== '\r') {
			text += '\r';
		}

		// Send it to the process
		await this._processManager.ptyProcessReady;
		this._processManager.write(text);
	}

	public setVisible(visible: boolean): void {
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
			if (this._container && this._container.parentElement) {
				// Force a layout when the instance becomes invisible. This is particularly important
				// for ensuring that terminals that are created in the background by an extension will
				// correctly get correct character measurements in order to render to the screen (see
				// #34554).
				const computedStyle = window.getComputedStyle(this._container.parentElement);
				const width = parseInt(computedStyle.getPropertyValue('width').replace('px', ''), 10);
				const height = parseInt(computedStyle.getPropertyValue('height').replace('px', ''), 10);
				this.layout(new dom.Dimension(width, height));
				// HACK: Trigger another async layout to ensure xterm's CharMeasure is ready to use,
				// this hack can be removed when https://github.com/xtermjs/xterm.js/issues/702 is
				// supported.
				this._timeoutDimension = new dom.Dimension(width, height);
				setTimeout(() => this.layout(this._timeoutDimension!), 0);
			}
		}
	}

	public scrollDownLine(): void {
		this._xterm?.scrollLines(1);
	}

	public scrollDownPage(): void {
		this._xterm?.scrollPages(1);
	}

	public scrollToBottom(): void {
		this._xterm?.scrollToBottom();
	}

	public scrollUpLine(): void {
		this._xterm?.scrollLines(-1);
	}

	public scrollUpPage(): void {
		this._xterm?.scrollPages(-1);
	}

	public scrollToTop(): void {
		this._xterm?.scrollToTop();
	}

	public clear(): void {
		this._xterm?.clear();
	}

	private _refreshSelectionContextKey() {
		const isActive = !!this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID);
		this._terminalHasTextContextKey.set(isActive && this.hasSelection());
	}

	protected _createProcessManager(): void {
		this._processManager = this._instantiationService.createInstance(TerminalProcessManager, this._id, this._configHelper);
		this._processManager.onProcessReady(() => this._onProcessIdReady.fire(this));
		this._processManager.onProcessExit(exitCode => this._onProcessExit(exitCode));
		this._processManager.onProcessData(ev => {
			this._initialDataEvents?.push(ev.data);
			this._onData.fire(ev.data);
		});
		this._processManager.onProcessOverrideDimensions(e => this.setDimensions(e, true));
		this._processManager.onProcessResolvedShellLaunchConfig(e => this._setResolvedShellLaunchConfig(e));
		this._processManager.onEnvironmentVariableInfoChanged(e => this._onEnvironmentVariableInfoChanged(e));

		if (this._shellLaunchConfig.name) {
			this.setTitle(this._shellLaunchConfig.name, TitleEventSource.Api);
		} else {
			// Only listen for process title changes when a name is not provided
			if (this._configHelper.config.experimentalUseTitleEvent) {
				this._processManager.ptyProcessReady.then(() => {
					this._terminalInstanceService.getDefaultShellAndArgs(false).then(e => {
						this.setTitle(e.shell, TitleEventSource.Sequence);
					});
					this._xtermReadyPromise.then(xterm => {
						this._messageTitleDisposable = xterm.onTitleChange(e => this._onTitleChange(e));
					});
				});
			} else {
				this.setTitle(this._shellLaunchConfig.executable, TitleEventSource.Process);
				this._messageTitleDisposable = this._processManager.onProcessTitle(title => this.setTitle(title ? title : '', TitleEventSource.Process));
			}
		}

		if (platform.isWindows) {
			this._processManager.ptyProcessReady.then(() => {
				if (this._processManager.remoteAuthority) {
					return;
				}
				this._xtermReadyPromise.then(xterm => {
					if (!this._isDisposed && this._processManager && this._processManager.shellProcessId) {
						this._windowsShellHelper = this._terminalInstanceService.createWindowsShellHelper(this._processManager.shellProcessId, xterm);
						this._windowsShellHelper.onShellNameChange(title => {
							this.setShellType(this.getShellType(title));
							if (this.isTitleSetByProcess && !this._configHelper.config.experimentalUseTitleEvent) {
								this.setTitle(title, TitleEventSource.Process);
							}
						});
					}
				});
			});
		}
	}

	private _createProcess(): void {
		this._processManager.createProcess(this._shellLaunchConfig, this._cols, this._rows, this._accessibilityService.isScreenReaderOptimized()).then(error => {
			if (error) {
				this._onProcessExit(error);
			}
		});
	}

	private getShellType(executable: string): TerminalShellType {
		switch (executable.toLowerCase()) {
			case 'cmd.exe':
				return WindowsShellType.CommandPrompt;
			case 'powershell.exe':
			case 'pwsh.exe':
				return WindowsShellType.PowerShell;
			case 'bash.exe':
				return WindowsShellType.GitBash;
			case 'wsl.exe':
			case 'ubuntu.exe':
			case 'ubuntu1804.exe':
			case 'kali.exe':
			case 'debian.exe':
			case 'opensuse-42.exe':
			case 'sles-12.exe':
				return WindowsShellType.Wsl;
			default:
				return undefined;
		}
	}

	private _onProcessData(ev: IProcessDataEvent): void {
		if (ev.sync) {
			this._xtermCore?.writeSync(ev.data);
		} else {
			const messageId = ++this._latestXtermWriteData;
			this._xterm?.write(ev.data, () => this._latestXtermParseData = messageId);
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
		this._logService.debug(`Terminal process exit (id: ${this.id}) with code ${this._exitCode}`);

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

				if (this._processManager.processState === ProcessState.KILLED_DURING_LAUNCH) {
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
				this._exitCode = exitCodeOrError.code;
				exitCodeMessage = nls.localize('launchFailed.errorMessage', "The terminal process failed to launch: {0}.", exitCodeOrError.message);
				break;
		}

		this._logService.debug(`Terminal process exit (id: ${this.id}) state ${this._processManager.processState}`);

		// Only trigger wait on exit when the exit was *not* triggered by the
		// user (via the `workbench.action.terminal.kill` command).
		if (this._shellLaunchConfig.waitOnExit && this._processManager.processState !== ProcessState.KILLED_BY_USER) {
			this._xtermReadyPromise.then(xterm => {
				if (exitCodeMessage) {
					xterm.writeln(exitCodeMessage);
				}
				if (typeof this._shellLaunchConfig.waitOnExit === 'string') {
					let message = this._shellLaunchConfig.waitOnExit;
					// Bold the message and add an extra new line to make it stand out from the rest of the output
					message = `\r\n\x1b[1m${message}\x1b[0m`;
					xterm.writeln(message);
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
				const failedDuringLaunch = this._processManager.processState === ProcessState.KILLED_DURING_LAUNCH;
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

	public reuseTerminal(shell: IShellLaunchConfig, reset: boolean = false): void {
		// Unsubscribe any key listener we may have.
		this._pressAnyKeyToCloseListener?.dispose();
		this._pressAnyKeyToCloseListener = undefined;

		// Kill and clear up the process, making the process manager ready for a new process
		this._processManager.dispose();

		if (this._xterm) {
			if (reset) {
				this._xterm.reset();
			} else {
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

		// Launch the process unless this is only a renderer.
		// In the renderer only cases, we still need to set the title correctly.
		const oldTitle = this._title;
		this._createProcessManager();

		if (oldTitle !== this._title) {
			this.setTitle(this._title, TitleEventSource.Process);
		}

		this._processManager.onProcessData(data => this._onProcessData(data));
		this._createProcess();
	}

	public relaunch(): void {
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
		if (this._configurationService.getValue('terminal.integrated.copyOnSelection')) {
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

	public updateConfig(): void {
		const config = this._configHelper.config;
		this._setCursorBlink(config.cursorBlinking);
		this._setCursorStyle(config.cursorStyle);
		this._setCursorWidth(config.cursorWidth);
		this._setCommandsToSkipShell(config.commandsToSkipShell);
		this._setEnableBell(config.enableBell);
		this._safeSetOption('scrollback', config.scrollback);
		this._safeSetOption('minimumContrastRatio', config.minimumContrastRatio);
		this._safeSetOption('fastScrollSensitivity', config.fastScrollSensitivity);
		this._safeSetOption('scrollSensitivity', config.mouseWheelScrollSensitivity);
		this._safeSetOption('macOptionIsMeta', config.macOptionIsMeta);
		this._safeSetOption('macOptionClickForcesSelection', config.macOptionClickForcesSelection);
		this._safeSetOption('rightClickSelectsWord', config.rightClickBehavior === 'selectWord');
		this._safeSetOption('wordSeparator', config.wordSeparators);
		if (config.rendererType === 'experimentalWebgl') {
			this._enableWebglRenderer();
		} else {
			this._webglAddon?.dispose();
			this._webglAddon = undefined;
			// Never set webgl as it's an addon not a rendererType
			this._safeSetOption('rendererType', config.rendererType === 'auto' ? 'canvas' : config.rendererType);
		}
		this._refreshEnvironmentVariableInfoWidgetState(this._processManager.environmentVariableInfo);
	}

	private async _enableWebglRenderer(): Promise<void> {
		if (!this._xterm || this._webglAddon) {
			return;
		}
		const Addon = await this._terminalInstanceService.getXtermWebglConstructor();
		this._webglAddon = new Addon();
		this._xterm.loadAddon(this._webglAddon);
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

	public updateAccessibilitySupport(): void {
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

	private _setEnableBell(isEnabled: boolean): void {
		if (this._xterm) {
			if (this._xterm.getOption('bellStyle') === 'sound') {
				if (!this._configHelper.config.enableBell) {
					this._xterm.setOption('bellStyle', 'none');
				}
			} else {
				if (this._configHelper.config.enableBell) {
					this._xterm.setOption('bellStyle', 'sound');
				}
			}
		}
	}

	private _safeSetOption(key: string, value: any): void {
		if (!this._xterm) {
			return;
		}

		if (this._xterm.getOption(key) !== value) {
			this._xterm.setOption(key, value);
		}
	}

	public layout(dimension: dom.Dimension): void {
		if (this.disableLayout) {
			return;
		}

		const terminalWidth = this._evaluateColsAndRows(dimension.width, dimension.height);
		if (!terminalWidth) {
			return;
		}

		this._timeoutDimension = new dom.Dimension(dimension.width, dimension.height);

		if (this._xterm && this._xterm.element) {
			this._xterm.element.style.width = terminalWidth + 'px';
		}

		this._resize();
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
				this._safeSetOption('drawBoldTextInBrightColors', config.drawBoldTextInBrightColors);

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
			this._processManager.setDimensions(cols, rows);
		} else {
			await this._processManager.ptyProcessReady;
			this._processManager.setDimensions(cols, rows);
		}
	}

	public setShellType(shellType: TerminalShellType) {
		this._shellType = shellType;
	}

	public setTitle(title: string | undefined, eventSource: TitleEventSource): void {
		if (!title) {
			return;
		}
		switch (eventSource) {
			case TitleEventSource.Process:
				title = path.basename(title);
				if (platform.isWindows) {
					// Remove the .exe extension
					title = title.split('.exe')[0];
				}
				break;
			case TitleEventSource.Api:
				// If the title has not been set by the API or the rename command, unregister the handler that
				// automatically updates the terminal name
				dispose(this._messageTitleDisposable);
				this._messageTitleDisposable = undefined;
				dispose(this._windowsShellHelper);
				this._windowsShellHelper = undefined;
				break;
		}
		const didTitleChange = title !== this._title;
		this._title = title;
		if (didTitleChange) {
			if (this._titleReadyComplete) {
				this._titleReadyComplete(title);
				this._titleReadyComplete = undefined;
			}
			this._onTitleChanged.fire(this);
		}
	}

	public waitForTitle(): Promise<string> {
		return this._titleReadyPromise;
	}

	public setDimensions(dimensions: ITerminalDimensionsOverride | undefined, immediate: boolean = false): void {
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

	public showEnvironmentInfoHover(): void {
		if (this._environmentInfo) {
			this._environmentInfo.widget.focus();
		}
	}

	private _onEnvironmentVariableInfoChanged(info: IEnvironmentVariableInfo): void {
		if (info.requiresAction) {
			this._xterm?.textarea?.setAttribute('aria-label', nls.localize('terminalStaleTextBoxAriaLabel', "Terminal {0} environment is stale, run the 'Show Environment Information' command for more information", this._id));
		}
		this._refreshEnvironmentVariableInfoWidgetState(info);
	}

	private _refreshEnvironmentVariableInfoWidgetState(info?: IEnvironmentVariableInfo): void {
		this._environmentInfo?.disposable.dispose();

		// Check if the widget should not exist
		if (!info ||
			this._configHelper.config.environmentChangesIndicator === 'off' ||
			this._configHelper.config.environmentChangesIndicator === 'warnonly' && !info.requiresAction) {
			this._environmentInfo = undefined;
			return;
		}

		// (Re-)create the widget
		const widget = this._instantiationService.createInstance(EnvironmentVariableInfoWidget, info);
		const disposable = this._widgetManager.attachWidget(widget);
		if (disposable) {
			this._environmentInfo = { widget, disposable };
		}
	}

	private _getXtermTheme(theme?: IColorTheme): any {
		if (!theme) {
			theme = this._themeService.getColorTheme();
		}

		const location = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID)!;
		const foregroundColor = theme.getColor(TERMINAL_FOREGROUND_COLOR);
		const backgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || (location === ViewContainerLocation.Sidebar ? theme.getColor(SIDE_BAR_BACKGROUND) : theme.getColor(PANEL_BACKGROUND));
		const cursorColor = theme.getColor(TERMINAL_CURSOR_FOREGROUND_COLOR) || foregroundColor;
		const cursorAccentColor = theme.getColor(TERMINAL_CURSOR_BACKGROUND_COLOR) || backgroundColor;
		const selectionColor = theme.getColor(TERMINAL_SELECTION_BACKGROUND_COLOR);

		return {
			background: backgroundColor ? backgroundColor.toString() : null,
			foreground: foregroundColor ? foregroundColor.toString() : null,
			cursor: cursorColor ? cursorColor.toString() : null,
			cursorAccent: cursorAccentColor ? cursorAccentColor.toString() : null,
			selection: selectionColor ? selectionColor.toString() : null,
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

	public async toggleEscapeSequenceLogging(): Promise<void> {
		const xterm = await this._xtermReadyPromise;
		const isDebug = xterm.getOption('logLevel') === 'debug';
		xterm.setOption('logLevel', isDebug ? 'info' : 'debug');
	}

	public getInitialCwd(): Promise<string> {
		return this._processManager.getInitialCwd();
	}

	public getCwd(): Promise<string> {
		return this._processManager.getCwd();
	}

	public registerLinkProvider(provider: ITerminalExternalLinkProvider): IDisposable {
		if (!this._linkManager) {
			throw new Error('TerminalInstance.registerLinkProvider before link manager was ready');
		}
		return this._linkManager.registerExternalLinkProvider(this, provider);
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	// Border
	const border = theme.getColor(activeContrastBorder);
	if (border) {
		collector.addRule(`
			.monaco-workbench.hc-black .pane-body.integrated-terminal .xterm.focus::before,
			.monaco-workbench.hc-black .pane-body.integrated-terminal .xterm:focus::before { border-color: ${border}; }`
		);
	}

	// Scrollbar
	const scrollbarSliderBackgroundColor = theme.getColor(scrollbarSliderBackground);
	if (scrollbarSliderBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .pane-body.integrated-terminal .find-focused .xterm .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm.focus .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm:focus .xterm-viewport,
			.monaco-workbench .pane-body.integrated-terminal .xterm:hover .xterm-viewport { background-color: ${scrollbarSliderBackgroundColor} !important; }
			.monaco-workbench .pane-body.integrated-terminal .xterm-viewport { scrollbar-color: ${scrollbarSliderBackgroundColor} transparent; }
		`);
	}

	const scrollbarSliderHoverBackgroundColor = theme.getColor(scrollbarSliderHoverBackground);
	if (scrollbarSliderHoverBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .pane-body.integrated-terminal .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover { background-color: ${scrollbarSliderHoverBackgroundColor}; }
			.monaco-workbench .pane-body.integrated-terminal .xterm-viewport:hover { scrollbar-color: ${scrollbarSliderHoverBackgroundColor} transparent; }
		`);
	}

	const scrollbarSliderActiveBackgroundColor = theme.getColor(scrollbarSliderActiveBackground);
	if (scrollbarSliderActiveBackgroundColor) {
		collector.addRule(`.monaco-workbench .pane-body.integrated-terminal .xterm .xterm-viewport::-webkit-scrollbar-thumb:active { background-color: ${scrollbarSliderActiveBackgroundColor}; }`);
	}
});
