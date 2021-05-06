/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IMenuService, MenuId, IMenu, SubmenuItemAction, registerAction2, Action2, MenuItemAction } from 'vs/platform/actions/common/actions';
import { registerThemingParticipant, IThemeService } from 'vs/platform/theme/common/themeService';
import { MenuBarVisibility, getTitleBarStyle, IWindowOpenable, getMenuBarVisibility } from 'vs/platform/windows/common/windows';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IAction, Action, SubmenuAction, Separator } from 'vs/base/common/actions';
import { addDisposableListener, Dimension, EventType } from 'vs/base/browser/dom';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { isMacintosh, isWeb, isIOS, isNative } from 'vs/base/common/platform';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IRecentlyOpened, isRecentFolder, IRecent, isRecentWorkspace, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { RunOnceScheduler } from 'vs/base/common/async';
import { MENUBAR_SELECTION_FOREGROUND, MENUBAR_SELECTION_BACKGROUND, MENUBAR_SELECTION_BORDER, TITLE_BAR_ACTIVE_FOREGROUND, TITLE_BAR_INACTIVE_FOREGROUND, ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_INACTIVE_FOREGROUND } from 'vs/workbench/common/theme';
import { URI } from 'vs/base/common/uri';
import { ILabelService } from 'vs/platform/label/common/label';
import { IUpdateService, StateType } from 'vs/platform/update/common/update';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { MenuBar, IMenuBarOptions } from 'vs/base/browser/ui/menu/menubar';
import { Direction } from 'vs/base/browser/ui/menu/menu';
import { attachMenuStyler } from 'vs/platform/theme/common/styler';
import { mnemonicMenuLabel, unmnemonicLabel } from 'vs/base/common/labels';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { isFullscreen } from 'vs/base/browser/browser';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { KeyCode } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IsWebContext } from 'vs/platform/contextkey/common/contextkeys';
import { ICommandService } from 'vs/platform/commands/common/commands';

export type IOpenRecentAction = IAction & { uri: URI, remoteAuthority?: string };

export abstract class MenubarControl extends Disposable {

	protected keys = [
		'window.menuBarVisibility',
		'window.enableMenuBarMnemonics',
		'window.customMenuBarAltFocus',
		'workbench.sideBar.location',
		'window.nativeTabs'
	];

	protected menus: {
		'File': IMenu;
		'Edit': IMenu;
		'Selection': IMenu;
		'View': IMenu;
		'Go': IMenu;
		'Run': IMenu;
		'Terminal': IMenu;
		'Window'?: IMenu;
		'Help': IMenu;
		[index: string]: IMenu | undefined;
	};

	protected topLevelTitles: { [menu: string]: string } = {
		'File': localize({ key: 'mFile', comment: ['&& denotes a mnemonic'] }, "&&File"),
		'Edit': localize({ key: 'mEdit', comment: ['&& denotes a mnemonic'] }, "&&Edit"),
		'Selection': localize({ key: 'mSelection', comment: ['&& denotes a mnemonic'] }, "&&Selection"),
		'View': localize({ key: 'mView', comment: ['&& denotes a mnemonic'] }, "&&View"),
		'Go': localize({ key: 'mGoto', comment: ['&& denotes a mnemonic'] }, "&&Go"),
		'Run': localize({ key: 'mRun', comment: ['&& denotes a mnemonic'] }, "&&Run"),
		'Terminal': localize({ key: 'mTerminal', comment: ['&& denotes a mnemonic'] }, "&&Terminal"),
		'Help': localize({ key: 'mHelp', comment: ['&& denotes a mnemonic'] }, "&&Help")
	};

	protected recentlyOpened: IRecentlyOpened = { files: [], workspaces: [] };

	protected menuUpdater: RunOnceScheduler;

	protected static readonly MAX_MENU_RECENT_ENTRIES = 10;

	constructor(
		protected readonly menuService: IMenuService,
		protected readonly workspacesService: IWorkspacesService,
		protected readonly contextKeyService: IContextKeyService,
		protected readonly keybindingService: IKeybindingService,
		protected readonly configurationService: IConfigurationService,
		protected readonly labelService: ILabelService,
		protected readonly updateService: IUpdateService,
		protected readonly storageService: IStorageService,
		protected readonly notificationService: INotificationService,
		protected readonly preferencesService: IPreferencesService,
		protected readonly environmentService: IWorkbenchEnvironmentService,
		protected readonly accessibilityService: IAccessibilityService,
		protected readonly hostService: IHostService,
		protected readonly commandService: ICommandService
	) {

		super();

		this.menus = {
			'File': this._register(this.menuService.createMenu(MenuId.MenubarFileMenu, this.contextKeyService)),
			'Edit': this._register(this.menuService.createMenu(MenuId.MenubarEditMenu, this.contextKeyService)),
			'Selection': this._register(this.menuService.createMenu(MenuId.MenubarSelectionMenu, this.contextKeyService)),
			'View': this._register(this.menuService.createMenu(MenuId.MenubarViewMenu, this.contextKeyService)),
			'Go': this._register(this.menuService.createMenu(MenuId.MenubarGoMenu, this.contextKeyService)),
			'Run': this._register(this.menuService.createMenu(MenuId.MenubarDebugMenu, this.contextKeyService)),
			'Terminal': this._register(this.menuService.createMenu(MenuId.MenubarTerminalMenu, this.contextKeyService)),
			'Help': this._register(this.menuService.createMenu(MenuId.MenubarHelpMenu, this.contextKeyService))
		};

		this.menuUpdater = this._register(new RunOnceScheduler(() => this.doUpdateMenubar(false), 200));

		this.notifyUserOfCustomMenubarAccessibility();
	}

	protected abstract doUpdateMenubar(firstTime: boolean): void;

	protected registerListeners(): void {
		// Listen for window focus changes
		this._register(this.hostService.onDidChangeFocus(e => this.onDidChangeWindowFocus(e)));

		// Update when config changes
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(e)));

		// Listen to update service
		this.updateService.onStateChange(() => this.onUpdateStateChange());

		// Listen for changes in recently opened menu
		this._register(this.workspacesService.onDidChangeRecentlyOpened(() => { this.onDidChangeRecentlyOpened(); }));

		// Listen to keybindings change
		this._register(this.keybindingService.onDidUpdateKeybindings(() => this.updateMenubar()));

		// Update recent menu items on formatter registration
		this._register(this.labelService.onDidChangeFormatters(() => { this.onDidChangeRecentlyOpened(); }));
	}

	protected updateMenubar(): void {
		this.menuUpdater.schedule();
	}

	protected calculateActionLabel(action: { id: string; label: string; }): string {
		let label = action.label;
		switch (action.id) {
			default:
				break;
		}

		return label;
	}

	protected onUpdateStateChange(): void {
		this.updateMenubar();
	}

	protected onUpdateKeybindings(): void {
		this.updateMenubar();
	}

	protected getOpenRecentActions(): (Separator | IOpenRecentAction)[] {
		if (!this.recentlyOpened) {
			return [];
		}

		const { workspaces, files } = this.recentlyOpened;

		const result = [];

		if (workspaces.length > 0) {
			for (let i = 0; i < MenubarControl.MAX_MENU_RECENT_ENTRIES && i < workspaces.length; i++) {
				result.push(this.createOpenRecentMenuAction(workspaces[i]));
			}

			result.push(new Separator());
		}

		if (files.length > 0) {
			for (let i = 0; i < MenubarControl.MAX_MENU_RECENT_ENTRIES && i < files.length; i++) {
				result.push(this.createOpenRecentMenuAction(files[i]));
			}

			result.push(new Separator());
		}

		return result;
	}

	protected onDidChangeWindowFocus(hasFocus: boolean): void {
		// When we regain focus, update the recent menu items
		if (hasFocus) {
			this.onDidChangeRecentlyOpened();
		}
	}

	private onConfigurationUpdated(event: IConfigurationChangeEvent): void {
		if (this.keys.some(key => event.affectsConfiguration(key))) {
			this.updateMenubar();
		}

		if (event.affectsConfiguration('editor.accessibilitySupport')) {
			this.notifyUserOfCustomMenubarAccessibility();
		}

		// Since we try not update when hidden, we should
		// try to update the recently opened list on visibility changes
		if (event.affectsConfiguration('window.menuBarVisibility')) {
			this.onDidChangeRecentlyOpened();
		}
	}

	private get menubarHidden(): boolean {
		return isMacintosh && isNative ? false : getMenuBarVisibility(this.configurationService) === 'hidden';
	}

	protected onDidChangeRecentlyOpened(): void {

		// Do not update recently opened when the menubar is hidden #108712
		if (!this.menubarHidden) {
			this.workspacesService.getRecentlyOpened().then(recentlyOpened => {
				this.recentlyOpened = recentlyOpened;
				this.updateMenubar();
			});
		}
	}

	private createOpenRecentMenuAction(recent: IRecent): IOpenRecentAction {

		let label: string;
		let uri: URI;
		let commandId: string;
		let openable: IWindowOpenable;
		const remoteAuthority = recent.remoteAuthority;

		if (isRecentFolder(recent)) {
			uri = recent.folderUri;
			label = recent.label || this.labelService.getWorkspaceLabel(uri, { verbose: true });
			commandId = 'openRecentFolder';
			openable = { folderUri: uri };
		} else if (isRecentWorkspace(recent)) {
			uri = recent.workspace.configPath;
			label = recent.label || this.labelService.getWorkspaceLabel(recent.workspace, { verbose: true });
			commandId = 'openRecentWorkspace';
			openable = { workspaceUri: uri };
		} else {
			uri = recent.fileUri;
			label = recent.label || this.labelService.getUriLabel(uri);
			commandId = 'openRecentFile';
			openable = { fileUri: uri };
		}

		const ret: IAction = new Action(commandId, unmnemonicLabel(label), undefined, undefined, event => {
			const browserEvent = event as KeyboardEvent;
			const openInNewWindow = event && ((!isMacintosh && (browserEvent.ctrlKey || browserEvent.shiftKey)) || (isMacintosh && (browserEvent.metaKey || browserEvent.altKey)));

			return this.hostService.openWindow([openable], {
				forceNewWindow: !!openInNewWindow,
				remoteAuthority
			});
		});

		return Object.assign(ret, { uri, remoteAuthority });
	}

	private notifyUserOfCustomMenubarAccessibility(): void {
		if (isWeb || isMacintosh) {
			return;
		}

		const hasBeenNotified = this.storageService.getBoolean('menubar/accessibleMenubarNotified', StorageScope.GLOBAL, false);
		const usingCustomMenubar = getTitleBarStyle(this.configurationService) === 'custom';

		if (hasBeenNotified || usingCustomMenubar || !this.accessibilityService.isScreenReaderOptimized()) {
			return;
		}

		const message = localize('menubar.customTitlebarAccessibilityNotification', "Accessibility support is enabled for you. For the most accessible experience, we recommend the custom title bar style.");
		this.notificationService.prompt(Severity.Info, message, [
			{
				label: localize('goToSetting', "Open Settings"),
				run: () => {
					return this.preferencesService.openGlobalSettings(undefined, { query: 'window.titleBarStyle' });
				}
			}
		]);

		this.storageService.store('menubar/accessibleMenubarNotified', true, StorageScope.GLOBAL, StorageTarget.USER);
	}
}

export class CustomMenubarControl extends MenubarControl {
	private menubar: MenuBar | undefined;
	private container: HTMLElement | undefined;
	private alwaysOnMnemonics: boolean = false;
	private focusInsideMenubar: boolean = false;
	private visible: boolean = true;
	private readonly webNavigationMenu = this._register(this.menuService.createMenu(MenuId.MenubarHomeMenu, this.contextKeyService));

	private readonly _onVisibilityChange: Emitter<boolean>;
	private readonly _onFocusStateChange: Emitter<boolean>;

	constructor(
		@IMenuService menuService: IMenuService,
		@IWorkspacesService workspacesService: IWorkspacesService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILabelService labelService: ILabelService,
		@IUpdateService updateService: IUpdateService,
		@IStorageService storageService: IStorageService,
		@INotificationService notificationService: INotificationService,
		@IPreferencesService preferencesService: IPreferencesService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IThemeService private readonly themeService: IThemeService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@ICommandService commandService: ICommandService
	) {
		super(menuService, workspacesService, contextKeyService, keybindingService, configurationService, labelService, updateService, storageService, notificationService, preferencesService, environmentService, accessibilityService, hostService, commandService);

		this._onVisibilityChange = this._register(new Emitter<boolean>());
		this._onFocusStateChange = this._register(new Emitter<boolean>());

		this.workspacesService.getRecentlyOpened().then((recentlyOpened) => {
			this.recentlyOpened = recentlyOpened;
		});

		this.registerListeners();

		this.registerActions();

		registerThemingParticipant((theme, collector) => {
			const menubarActiveWindowFgColor = theme.getColor(TITLE_BAR_ACTIVE_FOREGROUND);
			if (menubarActiveWindowFgColor) {
				collector.addRule(`
				.monaco-workbench .menubar > .menubar-menu-button,
				.monaco-workbench .menubar .toolbar-toggle-more {
					color: ${menubarActiveWindowFgColor};
				}
				`);
			}

			const activityBarInactiveFgColor = theme.getColor(ACTIVITY_BAR_INACTIVE_FOREGROUND);
			if (activityBarInactiveFgColor) {
				collector.addRule(`
				.monaco-workbench .menubar.compact > .menubar-menu-button,
				.monaco-workbench .menubar.compact .toolbar-toggle-more {
					color: ${activityBarInactiveFgColor};
				}
				`);
			}

			const activityBarFgColor = theme.getColor(ACTIVITY_BAR_FOREGROUND);
			if (activityBarFgColor) {
				collector.addRule(`
				.monaco-workbench .menubar.compact > .menubar-menu-button.open,
				.monaco-workbench .menubar.compact > .menubar-menu-button:focus,
				.monaco-workbench .menubar.compact:not(:focus-within) > .menubar-menu-button:hover,
				.monaco-workbench .menubar.compact  > .menubar-menu-button.open .toolbar-toggle-more,
				.monaco-workbench .menubar.compact > .menubar-menu-button:focus .toolbar-toggle-more,
				.monaco-workbench .menubar.compact:not(:focus-within) > .menubar-menu-button:hover .toolbar-toggle-more {
					color: ${activityBarFgColor};
				}
			`);
			}

			const menubarInactiveWindowFgColor = theme.getColor(TITLE_BAR_INACTIVE_FOREGROUND);
			if (menubarInactiveWindowFgColor) {
				collector.addRule(`
					.monaco-workbench .menubar.inactive:not(.compact) > .menubar-menu-button,
					.monaco-workbench .menubar.inactive:not(.compact) > .menubar-menu-button .toolbar-toggle-more  {
						color: ${menubarInactiveWindowFgColor};
					}
				`);
			}

			const menubarSelectedFgColor = theme.getColor(MENUBAR_SELECTION_FOREGROUND);
			if (menubarSelectedFgColor) {
				collector.addRule(`
					.monaco-workbench .menubar:not(.compact) > .menubar-menu-button.open,
					.monaco-workbench .menubar:not(.compact) > .menubar-menu-button:focus,
					.monaco-workbench .menubar:not(:focus-within):not(.compact) > .menubar-menu-button:hover,
					.monaco-workbench .menubar:not(.compact) > .menubar-menu-button.open .toolbar-toggle-more,
					.monaco-workbench .menubar:not(.compact) > .menubar-menu-button:focus .toolbar-toggle-more,
					.monaco-workbench .menubar:not(:focus-within):not(.compact) > .menubar-menu-button:hover .toolbar-toggle-more {
						color: ${menubarSelectedFgColor};
					}
				`);
			}

			const menubarSelectedBgColor = theme.getColor(MENUBAR_SELECTION_BACKGROUND);
			if (menubarSelectedBgColor) {
				collector.addRule(`
					.monaco-workbench .menubar:not(.compact) > .menubar-menu-button.open,
					.monaco-workbench .menubar:not(.compact) > .menubar-menu-button:focus,
					.monaco-workbench .menubar:not(:focus-within):not(.compact) > .menubar-menu-button:hover {
						background-color: ${menubarSelectedBgColor};
					}
				`);
			}

			const menubarSelectedBorderColor = theme.getColor(MENUBAR_SELECTION_BORDER);
			if (menubarSelectedBorderColor) {
				collector.addRule(`
					.monaco-workbench .menubar > .menubar-menu-button:hover {
						outline: dashed 1px;
					}

					.monaco-workbench .menubar > .menubar-menu-button.open,
					.monaco-workbench .menubar > .menubar-menu-button:focus {
						outline: solid 1px;
					}

					.monaco-workbench .menubar > .menubar-menu-button.open,
					.monaco-workbench .menubar > .menubar-menu-button:focus,
					.monaco-workbench .menubar > .menubar-menu-button:hover {
						outline-color: ${menubarSelectedBorderColor};
					}
				`);
			}
		});
	}

	protected doUpdateMenubar(firstTime: boolean): void {
		this.setupCustomMenubar(firstTime);
	}

	private registerActions(): void {
		const that = this;

		if (isWeb) {
			this._register(registerAction2(class extends Action2 {
				constructor() {
					super({
						id: `workbench.actions.menubar.focus`,
						title: { value: localize('focusMenu', "Focus Application Menu"), original: 'Focus Application Menu' },
						keybinding: {
							primary: KeyCode.F10,
							weight: KeybindingWeight.WorkbenchContrib,
							when: IsWebContext
						},
						f1: true
					});
				}

				async run(): Promise<void> {
					if (that.menubar) {
						that.menubar.toggleFocus();
					}
				}
			}));
		}
	}

	private getUpdateAction(): IAction | null {
		const state = this.updateService.state;

		switch (state.type) {
			case StateType.Uninitialized:
				return null;

			case StateType.Idle:
				return new Action('update.check', localize({ key: 'checkForUpdates', comment: ['&& denotes a mnemonic'] }, "Check for &&Updates..."), undefined, true, () =>
					this.updateService.checkForUpdates(true));

			case StateType.CheckingForUpdates:
				return new Action('update.checking', localize('checkingForUpdates', "Checking for Updates..."), undefined, false);

			case StateType.AvailableForDownload:
				return new Action('update.downloadNow', localize({ key: 'download now', comment: ['&& denotes a mnemonic'] }, "D&&ownload Update"), undefined, true, () =>
					this.updateService.downloadUpdate());

			case StateType.Downloading:
				return new Action('update.downloading', localize('DownloadingUpdate', "Downloading Update..."), undefined, false);

			case StateType.Downloaded:
				return new Action('update.install', localize({ key: 'installUpdate...', comment: ['&& denotes a mnemonic'] }, "Install &&Update..."), undefined, true, () =>
					this.updateService.applyUpdate());

			case StateType.Updating:
				return new Action('update.updating', localize('installingUpdate', "Installing Update..."), undefined, false);

			case StateType.Ready:
				return new Action('update.restart', localize({ key: 'restartToUpdate', comment: ['&& denotes a mnemonic'] }, "Restart to &&Update"), undefined, true, () =>
					this.updateService.quitAndInstall());
		}
	}

	private get currentMenubarVisibility(): MenuBarVisibility {
		return getMenuBarVisibility(this.configurationService);
	}

	private get currentDisableMenuBarAltFocus(): boolean {
		let settingValue = this.configurationService.getValue<boolean>('window.customMenuBarAltFocus');

		let disableMenuBarAltBehavior = false;
		if (typeof settingValue === 'boolean') {
			disableMenuBarAltBehavior = !settingValue;
		}

		return disableMenuBarAltBehavior;
	}

	private insertActionsBefore(nextAction: IAction, target: IAction[]): void {
		switch (nextAction.id) {
			case 'workbench.action.openRecent':
				target.push(...this.getOpenRecentActions());
				break;

			case 'workbench.action.showAboutDialog':
				if (!isMacintosh && !isWeb) {
					const updateAction = this.getUpdateAction();
					if (updateAction) {
						updateAction.label = mnemonicMenuLabel(updateAction.label);
						target.push(updateAction);
						target.push(new Separator());
					}
				}

				break;

			default:
				break;
		}
	}

	private get currentEnableMenuBarMnemonics(): boolean {
		let enableMenuBarMnemonics = this.configurationService.getValue<boolean>('window.enableMenuBarMnemonics');
		if (typeof enableMenuBarMnemonics !== 'boolean') {
			enableMenuBarMnemonics = true;
		}

		return enableMenuBarMnemonics && (!isWeb || isFullscreen());
	}

	private get currentCompactMenuMode(): Direction | undefined {
		if (this.currentMenubarVisibility !== 'compact') {
			return undefined;
		}

		const currentSidebarLocation = this.configurationService.getValue<string>('workbench.sideBar.location');
		return currentSidebarLocation === 'right' ? Direction.Left : Direction.Right;
	}

	private onDidVisibilityChange(visible: boolean): void {
		this.visible = visible;
		this.onDidChangeRecentlyOpened();
		this._onVisibilityChange.fire(visible);
	}

	private setupCustomMenubar(firstTime: boolean): void {
		// If there is no container, we cannot setup the menubar
		if (!this.container) {
			return;
		}

		if (firstTime) {
			this.menubar = this._register(new MenuBar(this.container, this.getMenuBarOptions()));

			this.accessibilityService.alwaysUnderlineAccessKeys().then(val => {
				this.alwaysOnMnemonics = val;
				this.menubar?.update(this.getMenuBarOptions());
			});

			this._register(this.menubar.onFocusStateChange(focused => {
				this._onFocusStateChange.fire(focused);

				// When the menubar loses focus, update it to clear any pending updates
				if (!focused) {
					this.updateMenubar();
					this.focusInsideMenubar = false;
				}
			}));

			this._register(this.menubar.onVisibilityChange(e => this.onDidVisibilityChange(e)));

			// Before we focus the menubar, stop updates to it so that focus-related context keys will work
			this._register(addDisposableListener(this.container, EventType.FOCUS_IN, () => {
				this.focusInsideMenubar = true;
			}));

			this._register(addDisposableListener(this.container, EventType.FOCUS_OUT, () => {
				this.focusInsideMenubar = false;
			}));

			this._register(attachMenuStyler(this.menubar, this.themeService));
		} else {
			this.menubar?.update(this.getMenuBarOptions());
		}

		// Update the menu actions
		const updateActions = (menu: IMenu, target: IAction[], topLevelTitle: string) => {
			target.splice(0);
			let groups = menu.getActions();

			for (let group of groups) {
				const [, actions] = group;

				for (let action of actions) {
					this.insertActionsBefore(action, target);

					// use mnemonicTitle whenever possible
					const title = typeof action.item.title === 'string'
						? action.item.title
						: action.item.title.mnemonicTitle ?? action.item.title.value;

					if (action instanceof SubmenuItemAction) {
						let submenu = this.menus[action.item.submenu.id];
						if (!submenu) {
							submenu = this.menus[action.item.submenu.id] = this.menuService.createMenu(action.item.submenu, this.contextKeyService);
							this._register(submenu.onDidChange(() => {
								if (!this.focusInsideMenubar) {
									const actions: IAction[] = [];
									updateActions(menu, actions, topLevelTitle);
									if (this.menubar) {
										this.menubar.updateMenu({ actions: actions, label: mnemonicMenuLabel(this.topLevelTitles[topLevelTitle]) });
									}
								}
							}, this));
						}

						const submenuActions: SubmenuAction[] = [];
						updateActions(submenu, submenuActions, topLevelTitle);

						if (submenuActions.length > 0) {
							target.push(new SubmenuAction(action.id, mnemonicMenuLabel(title), submenuActions));
						}
					} else {
						const newAction = new Action(action.id, mnemonicMenuLabel(title), action.class, action.enabled, () => this.commandService.executeCommand(action.id));
						newAction.tooltip = action.tooltip;
						newAction.checked = action.checked;
						target.push(newAction);
					}
				}

				target.push(new Separator());
			}

			// Append web navigation menu items to the file menu when not compact
			if (menu === this.menus.File && this.currentCompactMenuMode === undefined) {
				const webActions = this.getWebNavigationActions();
				if (webActions.length) {
					target.push(...webActions);
					target.push(new Separator()); // to account for pop below
				}
			}

			target.pop();
		};

		for (const title of Object.keys(this.topLevelTitles)) {
			const menu = this.menus[title];
			if (firstTime && menu) {
				this._register(menu.onDidChange(() => {
					if (!this.focusInsideMenubar) {
						const actions: IAction[] = [];
						updateActions(menu, actions, title);
						if (this.menubar) {
							this.menubar.updateMenu({ actions: actions, label: mnemonicMenuLabel(this.topLevelTitles[title]) });
						}
					}
				}));

				// For the file menu, we need to update if the web nav menu updates as well
				if (menu === this.menus.File) {
					this._register(this.webNavigationMenu.onDidChange(() => {
						if (!this.focusInsideMenubar) {
							const actions: IAction[] = [];
							updateActions(menu, actions, title);
							if (this.menubar) {
								this.menubar.updateMenu({ actions: actions, label: mnemonicMenuLabel(this.topLevelTitles[title]) });
							}
						}
					}));
				}
			}

			const actions: IAction[] = [];
			if (menu) {
				updateActions(menu, actions, title);
			}

			if (this.menubar) {
				if (!firstTime) {
					this.menubar.updateMenu({ actions: actions, label: mnemonicMenuLabel(this.topLevelTitles[title]) });
				} else {
					this.menubar.push({ actions: actions, label: mnemonicMenuLabel(this.topLevelTitles[title]) });
				}
			}
		}
	}

	private getWebNavigationActions(): IAction[] {
		if (!isWeb) {
			return []; // only for web
		}

		const webNavigationActions = [];
		for (const groups of this.webNavigationMenu.getActions()) {
			const [, actions] = groups;
			for (const action of actions) {
				if (action instanceof MenuItemAction) {
					const title = typeof action.item.title === 'string'
						? action.item.title
						: action.item.title.mnemonicTitle ?? action.item.title.value;
					webNavigationActions.push(new Action(action.id, mnemonicMenuLabel(title), action.class, action.enabled, async (event?: any) => {
						this.commandService.executeCommand(action.id, event);
					}));
				}
			}

			webNavigationActions.push(new Separator());
		}

		if (webNavigationActions.length) {
			webNavigationActions.pop();
		}

		return webNavigationActions;
	}

	private getMenuBarOptions(): IMenuBarOptions {
		return {
			enableMnemonics: this.currentEnableMenuBarMnemonics,
			disableAltFocus: this.currentDisableMenuBarAltFocus,
			visibility: this.currentMenubarVisibility,
			getKeybinding: (action) => this.keybindingService.lookupKeybinding(action.id),
			alwaysOnMnemonics: this.alwaysOnMnemonics,
			compactMode: this.currentCompactMenuMode,
			getCompactMenuActions: () => {
				if (!isWeb) {
					return []; // only for web
				}

				return this.getWebNavigationActions();
			}
		};
	}

	protected override onDidChangeWindowFocus(hasFocus: boolean): void {
		if (!this.visible) {
			return;
		}

		super.onDidChangeWindowFocus(hasFocus);

		if (this.container) {
			if (hasFocus) {
				this.container.classList.remove('inactive');
			} else {
				this.container.classList.add('inactive');
				if (this.menubar) {
					this.menubar.blur();
				}
			}
		}
	}

	protected override onUpdateStateChange(): void {
		if (!this.visible) {
			return;
		}

		super.onUpdateStateChange();
	}

	protected override onDidChangeRecentlyOpened(): void {
		if (!this.visible) {
			return;
		}

		super.onDidChangeRecentlyOpened();
	}

	protected override onUpdateKeybindings(): void {
		if (!this.visible) {
			return;
		}

		super.onUpdateKeybindings();
	}

	protected override registerListeners(): void {
		super.registerListeners();

		this._register(addDisposableListener(window, EventType.RESIZE, () => {
			if (this.menubar && !(isIOS && BrowserFeatures.pointerEvents)) {
				this.menubar.blur();
			}
		}));

		// Mnemonics require fullscreen in web
		if (isWeb) {
			this._register(this.layoutService.onDidChangeFullscreen(e => this.updateMenubar()));
			this._register(this.webNavigationMenu.onDidChange(() => this.updateMenubar()));
		}
	}

	get onVisibilityChange(): Event<boolean> {
		return this._onVisibilityChange.event;
	}

	get onFocusStateChange(): Event<boolean> {
		return this._onFocusStateChange.event;
	}

	getMenubarItemsDimensions(): Dimension {
		if (this.menubar) {
			return new Dimension(this.menubar.getWidth(), this.menubar.getHeight());
		}

		return new Dimension(0, 0);
	}

	create(parent: HTMLElement): HTMLElement {
		this.container = parent;

		// Build the menubar
		if (this.container) {
			this.doUpdateMenubar(true);
		}

		return this.container;
	}

	layout(dimension: Dimension) {
		if (this.container) {
			this.container.style.height = `${dimension.height}px`;
		}

		this.menubar?.update(this.getMenuBarOptions());
	}

	toggleFocus() {
		if (this.menubar) {
			this.menubar.toggleFocus();
		}
	}
}
