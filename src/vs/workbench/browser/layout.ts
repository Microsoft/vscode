/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { EventType, addDisposableListener, getClientArea, Dimension, position, size, IDimension, isAncestorUsingFlowTo } from 'vs/base/browser/dom';
import { onDidChangeFullscreen, isFullscreen } from 'vs/base/browser/browser';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { Registry } from 'vs/platform/registry/common/platform';
import { isWindows, isLinux, isMacintosh, isWeb, isNative } from 'vs/base/common/platform';
import { pathsToEditors, SideBySideEditorInput } from 'vs/workbench/common/editor';
import { SidebarPart } from 'vs/workbench/browser/parts/sidebar/sidebarPart';
import { PanelPart } from 'vs/workbench/browser/parts/panel/panelPart';
import { PanelRegistry, Extensions as PanelExtensions } from 'vs/workbench/browser/panel';
import { Position, Parts, PanelOpensMaximizedOptions, IWorkbenchLayoutService, positionFromString, positionToString, panelOpensMaximizedFromString } from 'vs/workbench/services/layout/browser/layoutService';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { ITitleService } from 'vs/workbench/services/title/common/titleService';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { StartupKind, ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { MenuBarVisibility, getTitleBarStyle, getMenuBarVisibility, IPath } from 'vs/platform/windows/common/windows';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IEditor } from 'vs/editor/common/editorCommon';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IEditorService, IResourceEditorInputType } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { SerializableGrid, ISerializableView, ISerializedGrid, Orientation, ISerializedNode, ISerializedLeafNode, Direction, IViewSize } from 'vs/base/browser/ui/grid/grid';
import { Part } from 'vs/workbench/browser/part';
import { IStatusbarService } from 'vs/workbench/services/statusbar/common/statusbar';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { IFileService } from 'vs/platform/files/common/files';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { coalesce } from 'vs/base/common/arrays';
import { assertIsDefined } from 'vs/base/common/types';
import { INotificationService, NotificationsFilter } from 'vs/platform/notification/common/notification';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { WINDOW_ACTIVE_BORDER, WINDOW_INACTIVE_BORDER } from 'vs/workbench/common/theme';
import { LineNumbersType } from 'vs/editor/common/config/editorOptions';
import { URI } from 'vs/base/common/uri';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { mark } from 'vs/base/common/performance';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { Promises } from 'vs/base/common/async';

export enum Settings {
	ACTIVITYBAR_VISIBLE = 'workbench.activityBar.visible',
	STATUSBAR_VISIBLE = 'workbench.statusBar.visible',

	SIDEBAR_POSITION = 'workbench.sideBar.location',
	PANEL_POSITION = 'workbench.panel.defaultLocation',
	PANEL_OPENS_MAXIMIZED = 'workbench.panel.opensMaximized',

	ZEN_MODE_RESTORE = 'zenMode.restore',
}

enum Storage {
	SIDEBAR_HIDDEN = 'workbench.sidebar.hidden',
	SIDEBAR_SIZE = 'workbench.sidebar.size',

	PANEL_HIDDEN = 'workbench.panel.hidden',
	PANEL_POSITION = 'workbench.panel.location',
	PANEL_SIZE = 'workbench.panel.size',
	PANEL_DIMENSION = 'workbench.panel.dimension',
	PANEL_LAST_NON_MAXIMIZED_WIDTH = 'workbench.panel.lastNonMaximizedWidth',
	PANEL_LAST_NON_MAXIMIZED_HEIGHT = 'workbench.panel.lastNonMaximizedHeight',
	PANEL_LAST_IS_MAXIMIZED = 'workbench.panel.lastIsMaximized',

	EDITOR_HIDDEN = 'workbench.editor.hidden',

	ZEN_MODE_ENABLED = 'workbench.zenmode.active',
	CENTERED_LAYOUT_ENABLED = 'workbench.centerededitorlayout.active',

	GRID_LAYOUT = 'workbench.grid.layout',
	GRID_WIDTH = 'workbench.grid.width',
	GRID_HEIGHT = 'workbench.grid.height',

	MENU_VISIBILITY = 'window.menuBarVisibility'
}

enum Classes {
	SIDEBAR_HIDDEN = 'nosidebar',
	EDITOR_HIDDEN = 'noeditorarea',
	PANEL_HIDDEN = 'nopanel',
	STATUSBAR_HIDDEN = 'nostatusbar',
	FULLSCREEN = 'fullscreen',
	WINDOW_BORDER = 'border'
}

export abstract class Layout extends Disposable implements IWorkbenchLayoutService {

	declare readonly _serviceBrand: undefined;

	//#region Events

	private readonly _onDidChangeZenMode = this._register(new Emitter<boolean>());
	readonly onDidChangeZenMode = this._onDidChangeZenMode.event;

	private readonly _onDidChangeFullscreen = this._register(new Emitter<boolean>());
	readonly onDidChangeFullscreen = this._onDidChangeFullscreen.event;

	private readonly _onDidChangeCenteredLayout = this._register(new Emitter<boolean>());
	readonly onDidChangeCenteredLayout = this._onDidChangeCenteredLayout.event;

	private readonly _onDidChangeWindowMaximized = this._register(new Emitter<boolean>());
	readonly onDidChangeWindowMaximized = this._onDidChangeWindowMaximized.event;

	private readonly _onDidChangePanelPosition = this._register(new Emitter<string>());
	readonly onDidChangePanelPosition = this._onDidChangePanelPosition.event;

	private readonly _onDidChangePartVisibility = this._register(new Emitter<void>());
	readonly onDidChangePartVisibility = this._onDidChangePartVisibility.event;

	private readonly _onDidChangeNotificationsVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeNotificationsVisibility = this._onDidChangeNotificationsVisibility.event;

	private readonly _onDidLayout = this._register(new Emitter<IDimension>());
	readonly onDidLayout = this._onDidLayout.event;

	//#endregion

	readonly container: HTMLElement = document.createElement('div');

	private _dimension!: IDimension;
	get dimension(): IDimension { return this._dimension; }

	get offset() {
		return {
			top: (() => {
				let offset = 0;
				if (this.isVisible(Parts.TITLEBAR_PART)) {
					offset = this.getPart(Parts.TITLEBAR_PART).maximumHeight;
				}

				return offset;
			})()
		};
	}

	private readonly parts = new Map<string, Part>();

	private workbenchGrid!: SerializableGrid<ISerializableView>;

	private disposed: boolean | undefined;

	private titleBarPartView!: ISerializableView;
	private activityBarPartView!: ISerializableView;
	private sideBarPartView!: ISerializableView;
	private panelPartView!: ISerializableView;
	private editorPartView!: ISerializableView;
	private statusBarPartView!: ISerializableView;

	private environmentService!: IWorkbenchEnvironmentService;
	private extensionService!: IExtensionService;
	private configurationService!: IConfigurationService;
	private storageService!: IStorageService;
	private hostService!: IHostService;
	private editorService!: IEditorService;
	private editorGroupService!: IEditorGroupsService;
	private panelService!: IPanelService;
	private titleService!: ITitleService;
	private viewletService!: IViewletService;
	private viewDescriptorService!: IViewDescriptorService;
	private contextService!: IWorkspaceContextService;
	private workingCopyBackupService!: IWorkingCopyBackupService;
	private notificationService!: INotificationService;
	private themeService!: IThemeService;
	private activityBarService!: IActivityBarService;
	private statusBarService!: IStatusbarService;
	private logService!: ILogService;

	protected readonly state = {
		fullscreen: false,
		maximized: false,
		hasFocus: false,
		windowBorder: false,

		menuBar: {
			visibility: 'classic' as MenuBarVisibility,
			toggled: false
		},

		activityBar: {
			hidden: false
		},

		sideBar: {
			hidden: false,
			position: Position.LEFT,
			width: 300,
			viewletToRestore: undefined as string | undefined
		},

		editor: {
			hidden: false,
			centered: false,
			restoreCentered: false,
			restoreEditors: false,
			editorsToOpen: [] as Promise<IResourceEditorInputType[]> | IResourceEditorInputType[]
		},

		panel: {
			hidden: false,
			position: Position.BOTTOM,
			lastNonMaximizedWidth: 300,
			lastNonMaximizedHeight: 300,
			wasLastMaximized: false,
			panelToRestore: undefined as string | undefined
		},

		statusBar: {
			hidden: false
		},

		views: {
			defaults: undefined as (string[] | undefined)
		},

		zenMode: {
			active: false,
			restore: false,
			transitionedToFullScreen: false,
			transitionedToCenteredEditorLayout: false,
			wasSideBarVisible: false,
			wasPanelVisible: false,
			transitionDisposables: new DisposableStore(),
			setNotificationsFilter: false,
		}
	};

	constructor(
		protected readonly parent: HTMLElement
	) {
		super();
	}

	protected initLayout(accessor: ServicesAccessor): void {

		// Services
		this.environmentService = accessor.get(IWorkbenchEnvironmentService);
		this.configurationService = accessor.get(IConfigurationService);
		this.hostService = accessor.get(IHostService);
		this.contextService = accessor.get(IWorkspaceContextService);
		this.storageService = accessor.get(IStorageService);
		this.workingCopyBackupService = accessor.get(IWorkingCopyBackupService);
		this.themeService = accessor.get(IThemeService);
		this.extensionService = accessor.get(IExtensionService);
		this.logService = accessor.get(ILogService);

		// Parts
		this.editorService = accessor.get(IEditorService);
		this.editorGroupService = accessor.get(IEditorGroupsService);
		this.panelService = accessor.get(IPanelService);
		this.viewletService = accessor.get(IViewletService);
		this.viewDescriptorService = accessor.get(IViewDescriptorService);
		this.titleService = accessor.get(ITitleService);
		this.notificationService = accessor.get(INotificationService);
		this.activityBarService = accessor.get(IActivityBarService);
		this.statusBarService = accessor.get(IStatusbarService);

		// Listeners
		this.registerLayoutListeners();

		// State
		this.initLayoutState(accessor.get(ILifecycleService), accessor.get(IFileService));
	}

	private registerLayoutListeners(): void {

		// Restore editor if hidden and it changes
		// The editor service will always trigger this
		// on startup so we can ignore the first one
		let firstTimeEditorActivation = true;
		const showEditorIfHidden = () => {
			if (!firstTimeEditorActivation && this.state.editor.hidden) {
				this.toggleMaximizedPanel();
			}

			firstTimeEditorActivation = false;
		};

		// Restore editor part on any editor change
		this._register(this.editorService.onDidVisibleEditorsChange(showEditorIfHidden));
		this._register(this.editorGroupService.onDidActivateGroup(showEditorIfHidden));

		// Revalidate center layout when active editor changes: diff editor quits centered mode.
		this._register(this.editorService.onDidActiveEditorChange(() => this.centerEditorLayout(this.state.editor.centered)));

		// Configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(() => this.doUpdateLayoutConfiguration()));

		// Fullscreen changes
		this._register(onDidChangeFullscreen(() => this.onFullscreenChanged()));

		// Group changes
		this._register(this.editorGroupService.onDidAddGroup(() => this.centerEditorLayout(this.state.editor.centered)));
		this._register(this.editorGroupService.onDidRemoveGroup(() => this.centerEditorLayout(this.state.editor.centered)));

		// Prevent workbench from scrolling #55456
		this._register(addDisposableListener(this.container, EventType.SCROLL, () => this.container.scrollTop = 0));

		// Menubar visibility changes
		if ((isWindows || isLinux || isWeb) && getTitleBarStyle(this.configurationService) === 'custom') {
			this._register(this.titleService.onMenubarVisibilityChange(visible => this.onMenubarToggled(visible)));
		}

		// Theme changes
		this._register(this.themeService.onDidColorThemeChange(() => this.updateStyles()));

		// Window focus changes
		this._register(this.hostService.onDidChangeFocus(e => this.onWindowFocusChanged(e)));
	}

	private onMenubarToggled(visible: boolean) {
		if (visible !== this.state.menuBar.toggled) {
			this.state.menuBar.toggled = visible;


			// The menu bar toggles the title bar in web because it does not need to be shown for window controls only
			if (isWeb && this.state.menuBar.visibility === 'toggle') {
				this.workbenchGrid.setViewVisible(this.titleBarPartView, this.isVisible(Parts.TITLEBAR_PART));
			}
			// The menu bar toggles the title bar in full screen for toggle and classic settings
			else if (this.state.fullscreen && (this.state.menuBar.visibility === 'toggle' || this.state.menuBar.visibility === 'classic')) {
				this.workbenchGrid.setViewVisible(this.titleBarPartView, this.isVisible(Parts.TITLEBAR_PART));
			}

			// Move layout call to any time the menubar
			// is toggled to update consumers of offset
			// see issue #115267
			this.layout();
		}
	}

	private onFullscreenChanged(): void {
		this.state.fullscreen = isFullscreen();

		// Apply as CSS class
		if (this.state.fullscreen) {
			this.container.classList.add(Classes.FULLSCREEN);
		} else {
			this.container.classList.remove(Classes.FULLSCREEN);

			if (this.state.zenMode.transitionedToFullScreen && this.state.zenMode.active) {
				this.toggleZenMode();
			}
		}

		// Change edge snapping accordingly
		this.workbenchGrid.edgeSnapping = this.state.fullscreen;

		// Changing fullscreen state of the window has an impact on custom title bar visibility, so we need to update
		if (getTitleBarStyle(this.configurationService) === 'custom') {
			// Propagate to grid
			this.workbenchGrid.setViewVisible(this.titleBarPartView, this.isVisible(Parts.TITLEBAR_PART));

			this.updateWindowBorder(true);

			this.layout(); // handle title bar when fullscreen changes
		}

		this._onDidChangeFullscreen.fire(this.state.fullscreen);
	}

	private onWindowFocusChanged(hasFocus: boolean): void {
		if (this.state.hasFocus === hasFocus) {
			return;
		}

		this.state.hasFocus = hasFocus;
		this.updateWindowBorder();
	}

	private doUpdateLayoutConfiguration(skipLayout?: boolean): void {

		// Sidebar position
		const newSidebarPositionValue = this.configurationService.getValue<string>(Settings.SIDEBAR_POSITION);
		const newSidebarPosition = (newSidebarPositionValue === 'right') ? Position.RIGHT : Position.LEFT;
		if (newSidebarPosition !== this.getSideBarPosition()) {
			this.setSideBarPosition(newSidebarPosition);
		}

		// Panel position
		this.updatePanelPosition();

		if (!this.state.zenMode.active) {

			// Statusbar visibility
			const newStatusbarHiddenValue = !this.configurationService.getValue<boolean>(Settings.STATUSBAR_VISIBLE);
			if (newStatusbarHiddenValue !== this.state.statusBar.hidden) {
				this.setStatusBarHidden(newStatusbarHiddenValue, skipLayout);
			}

			// Activitybar visibility
			const newActivityBarHiddenValue = !this.configurationService.getValue<boolean>(Settings.ACTIVITYBAR_VISIBLE);
			if (newActivityBarHiddenValue !== this.state.activityBar.hidden) {
				this.setActivityBarHidden(newActivityBarHiddenValue, skipLayout);
			}
		}

		// Menubar visibility
		const newMenubarVisibility = getMenuBarVisibility(this.configurationService);
		this.setMenubarVisibility(newMenubarVisibility, !!skipLayout);

		// Centered Layout
		this.centerEditorLayout(this.state.editor.centered, skipLayout);
	}

	private setSideBarPosition(position: Position): void {
		const activityBar = this.getPart(Parts.ACTIVITYBAR_PART);
		const sideBar = this.getPart(Parts.SIDEBAR_PART);
		const wasHidden = this.state.sideBar.hidden;
		const newPositionValue = (position === Position.LEFT) ? 'left' : 'right';
		const oldPositionValue = (this.state.sideBar.position === Position.LEFT) ? 'left' : 'right';
		this.state.sideBar.position = position;

		// Adjust CSS
		const activityBarContainer = assertIsDefined(activityBar.getContainer());
		const sideBarContainer = assertIsDefined(sideBar.getContainer());
		activityBarContainer.classList.remove(oldPositionValue);
		sideBarContainer.classList.remove(oldPositionValue);
		activityBarContainer.classList.add(newPositionValue);
		sideBarContainer.classList.add(newPositionValue);

		// Update Styles
		activityBar.updateStyles();
		sideBar.updateStyles();

		// Layout
		if (!wasHidden) {
			this.state.sideBar.width = this.workbenchGrid.getViewSize(this.sideBarPartView).width;
		}

		if (position === Position.LEFT) {
			this.workbenchGrid.moveViewTo(this.activityBarPartView, [1, 0]);
			this.workbenchGrid.moveViewTo(this.sideBarPartView, [1, 1]);
		} else {
			this.workbenchGrid.moveViewTo(this.sideBarPartView, [1, 4]);
			this.workbenchGrid.moveViewTo(this.activityBarPartView, [1, 4]);
		}

		this.layout();
	}

	private updateWindowBorder(skipLayout: boolean = false) {
		if (isWeb || getTitleBarStyle(this.configurationService) !== 'custom') {
			return;
		}

		const theme = this.themeService.getColorTheme();

		const activeBorder = theme.getColor(WINDOW_ACTIVE_BORDER);
		const inactiveBorder = theme.getColor(WINDOW_INACTIVE_BORDER);

		let windowBorder = false;
		if (!this.state.fullscreen && !this.state.maximized && (activeBorder || inactiveBorder)) {
			windowBorder = true;

			// If the inactive color is missing, fallback to the active one
			const borderColor = this.state.hasFocus ? activeBorder : inactiveBorder ?? activeBorder;
			this.container.style.setProperty('--window-border-color', borderColor?.toString() ?? 'transparent');
		}

		if (windowBorder === this.state.windowBorder) {
			return;
		}

		this.state.windowBorder = windowBorder;

		this.container.classList.toggle(Classes.WINDOW_BORDER, windowBorder);

		if (!skipLayout) {
			this.layout();
		}
	}

	private updateStyles() {
		this.updateWindowBorder();
	}

	private initLayoutState(lifecycleService: ILifecycleService, fileService: IFileService): void {

		// Default Layout
		this.applyDefaultLayout(this.environmentService, this.storageService);

		// Fullscreen
		this.state.fullscreen = isFullscreen();

		// Menubar visibility
		this.state.menuBar.visibility = getMenuBarVisibility(this.configurationService);

		// Activity bar visibility
		this.state.activityBar.hidden = !this.configurationService.getValue<string>(Settings.ACTIVITYBAR_VISIBLE);

		// Sidebar visibility
		this.state.sideBar.hidden = this.storageService.getBoolean(Storage.SIDEBAR_HIDDEN, StorageScope.WORKSPACE, this.contextService.getWorkbenchState() === WorkbenchState.EMPTY);

		// Sidebar position
		this.state.sideBar.position = (this.configurationService.getValue<string>(Settings.SIDEBAR_POSITION) === 'right') ? Position.RIGHT : Position.LEFT;

		// Sidebar viewlet
		if (!this.state.sideBar.hidden) {

			// Only restore last viewlet if window was reloaded or we are in development mode
			let viewletToRestore: string | undefined;
			if (!this.environmentService.isBuilt || lifecycleService.startupKind === StartupKind.ReloadedWindow || isWeb) {
				viewletToRestore = this.storageService.get(SidebarPart.activeViewletSettingsKey, StorageScope.WORKSPACE, this.viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.Sidebar)?.id);
			} else {
				viewletToRestore = this.viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.Sidebar)?.id;
			}

			if (viewletToRestore) {
				this.state.sideBar.viewletToRestore = viewletToRestore;
			} else {
				this.state.sideBar.hidden = true; // we hide sidebar if there is no viewlet to restore
			}
		}

		// Editor visibility
		this.state.editor.hidden = this.storageService.getBoolean(Storage.EDITOR_HIDDEN, StorageScope.WORKSPACE, false);

		// Editor centered layout
		this.state.editor.restoreCentered = this.storageService.getBoolean(Storage.CENTERED_LAYOUT_ENABLED, StorageScope.WORKSPACE, false);

		// Editors to open
		this.state.editor.editorsToOpen = this.resolveEditorsToOpen(fileService);

		// Panel visibility
		this.state.panel.hidden = this.storageService.getBoolean(Storage.PANEL_HIDDEN, StorageScope.WORKSPACE, true);

		// Whether or not the panel was last maximized
		this.state.panel.wasLastMaximized = this.storageService.getBoolean(Storage.PANEL_LAST_IS_MAXIMIZED, StorageScope.WORKSPACE, false);

		// Panel position
		this.updatePanelPosition();

		// Panel to restore
		if (!this.state.panel.hidden) {
			let panelToRestore = this.storageService.get(PanelPart.activePanelSettingsKey, StorageScope.WORKSPACE, Registry.as<PanelRegistry>(PanelExtensions.Panels).getDefaultPanelId());

			if (panelToRestore) {
				this.state.panel.panelToRestore = panelToRestore;
			} else {
				this.state.panel.hidden = true; // we hide panel if there is no panel to restore
			}
		}

		// Panel size before maximized
		this.state.panel.lastNonMaximizedHeight = this.storageService.getNumber(Storage.PANEL_LAST_NON_MAXIMIZED_HEIGHT, StorageScope.GLOBAL, 300);
		this.state.panel.lastNonMaximizedWidth = this.storageService.getNumber(Storage.PANEL_LAST_NON_MAXIMIZED_WIDTH, StorageScope.GLOBAL, 300);

		// Statusbar visibility
		this.state.statusBar.hidden = !this.configurationService.getValue<string>(Settings.STATUSBAR_VISIBLE);

		// Zen mode enablement
		this.state.zenMode.restore = this.storageService.getBoolean(Storage.ZEN_MODE_ENABLED, StorageScope.WORKSPACE, false) && this.configurationService.getValue(Settings.ZEN_MODE_RESTORE);

		this.state.hasFocus = this.hostService.hasFocus;

		// Window border
		this.updateWindowBorder(true);
	}

	private applyDefaultLayout(environmentService: IWorkbenchEnvironmentService, storageService: IStorageService) {
		const defaultLayout = environmentService.options?.defaultLayout;
		if (!defaultLayout) {
			return;
		}

		if (!defaultLayout.force && !storageService.isNew(StorageScope.WORKSPACE)) {
			return;
		}

		const { views } = defaultLayout;
		if (views?.length) {
			this.state.views.defaults = views.map(view => view.id);
		}
	}

	private resolveEditorsToOpen(fileService: IFileService): Promise<IResourceEditorInputType[]> | IResourceEditorInputType[] {
		const initialFilesToOpen = this.getInitialFilesToOpen();

		// Only restore editors if we are not instructed to open files initially
		// or when `window.restoreWindows` setting is explicitly set to `preserve`
		const forceRestoreEditors = this.configurationService.getValue<string>('window.restoreWindows') === 'preserve';
		this.state.editor.restoreEditors = !!forceRestoreEditors || initialFilesToOpen === undefined;

		// Files to open, diff or create
		if (initialFilesToOpen !== undefined) {

			// Files to diff is exclusive
			return pathsToEditors(initialFilesToOpen.filesToDiff, fileService).then(filesToDiff => {
				if (filesToDiff.length === 2) {
					return [{
						leftResource: filesToDiff[0].resource,
						rightResource: filesToDiff[1].resource,
						options: { pinned: true },
						forceFile: true
					}];
				}

				// Otherwise: Open/Create files
				return pathsToEditors(initialFilesToOpen.filesToOpenOrCreate, fileService);
			});
		}

		// Empty workbench configured to open untitled file if empty
		else if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY && this.configurationService.getValue('workbench.startupEditor') === 'newUntitledFile') {
			if (this.editorGroupService.hasRestorableState) {
				return []; // do not open any empty untitled file if we restored groups/editors from previous session
			}

			return this.workingCopyBackupService.hasBackups().then(hasBackups => {
				if (hasBackups) {
					return []; // do not open any empty untitled file if we have backups to restore
				}

				return [Object.create(null)]; // open empty untitled file
			});
		}

		return [];
	}

	private _openedDefaultEditors: boolean = false;
	get openedDefaultEditors() { return this._openedDefaultEditors; }

	private getInitialFilesToOpen(): { filesToOpenOrCreate?: IPath[], filesToDiff?: IPath[]; } | undefined {

		// Check for editors from `defaultLayout` options first
		const defaultLayout = this.environmentService.options?.defaultLayout;
		if (defaultLayout?.editors?.length && (defaultLayout.force || this.storageService.isNew(StorageScope.WORKSPACE))) {
			this._openedDefaultEditors = true;

			return {
				filesToOpenOrCreate: defaultLayout.editors.map<IPath>(file => {
					return { fileUri: URI.revive(file.uri), openOnlyIfExists: file.openOnlyIfExists, editorOverrideId: file.openWith };
				})
			};
		}

		// Then check for files to open, create or diff from main side
		const { filesToOpenOrCreate, filesToDiff } = this.environmentService.configuration;
		if (filesToOpenOrCreate || filesToDiff) {
			return { filesToOpenOrCreate, filesToDiff };
		}

		return undefined;
	}

	private whenReadyResolve: (() => void) | undefined;
	protected readonly whenReady = new Promise<void>(resolve => (this.whenReadyResolve = resolve));

	private whenRestoredResolve: (() => void) | undefined;
	readonly whenRestored = new Promise<void>(resolve => (this.whenRestoredResolve = resolve));
	private restored = false;

	isRestored(): boolean {
		return this.restored;
	}

	protected restoreParts(): void {

		// distinguish long running restore operations that
		// are required for the layout to be ready from those
		// that are needed to signal restoring is done
		const layoutReadyPromises: Promise<unknown>[] = [];
		const layoutRestoredPromises: Promise<unknown>[] = [];

		// Restore editors
		layoutReadyPromises.push((async () => {
			mark('code/willRestoreEditors');

			// first ensure the editor part is ready
			await this.editorGroupService.whenReady;

			// then see for editors to open as instructed
			// it is important that we trigger this from
			// the overall restore flow to reduce possible
			// flicker on startup: we want any editor to
			// open to get a chance to open first before
			// signaling that layout is restored, but we do
			// not need to await the editors from having
			// fully loaded.
			let editors: IResourceEditorInputType[];
			if (Array.isArray(this.state.editor.editorsToOpen)) {
				editors = this.state.editor.editorsToOpen;
			} else {
				editors = await this.state.editor.editorsToOpen;
			}

			let openEditorsPromise: Promise<unknown> | undefined = undefined;
			if (editors.length) {
				openEditorsPromise = this.editorService.openEditors(editors);
			}

			// do not block the overall layout ready flow from potentially
			// slow editors to resolve on startup
			layoutRestoredPromises.push(
				Promise.all([
					openEditorsPromise,
					this.editorGroupService.whenRestored
				]).finally(() => {
					// the `code/didRestoreEditors` perf mark is specifically
					// for when visible editors have resolved, so we only mark
					// if when editor group service has restored.
					mark('code/didRestoreEditors');
				})
			);
		})());

		// Restore default views (only when `IDefaultLayout` is provided)
		const restoreDefaultViewsPromise = (async () => {
			if (this.state.views.defaults?.length) {
				mark('code/willOpenDefaultViews');

				const locationsRestored: { id: string; order: number; }[] = [];

				const tryOpenView = (view: { id: string; order: number; }): boolean => {
					const location = this.viewDescriptorService.getViewLocationById(view.id);
					if (location !== null) {
						const container = this.viewDescriptorService.getViewContainerByViewId(view.id);
						if (container) {
							if (view.order >= (locationsRestored?.[location]?.order ?? 0)) {
								locationsRestored[location] = { id: container.id, order: view.order };
							}

							const containerModel = this.viewDescriptorService.getViewContainerModel(container);
							containerModel.setCollapsed(view.id, false);
							containerModel.setVisible(view.id, true);

							return true;
						}
					}

					return false;
				};

				const defaultViews = [...this.state.views.defaults].reverse().map((v, index) => ({ id: v, order: index }));

				let i = defaultViews.length;
				while (i) {
					i--;
					if (tryOpenView(defaultViews[i])) {
						defaultViews.splice(i, 1);
					}
				}

				// If we still have views left over, wait until all extensions have been registered and try again
				if (defaultViews.length) {
					await this.extensionService.whenInstalledExtensionsRegistered();

					let i = defaultViews.length;
					while (i) {
						i--;
						if (tryOpenView(defaultViews[i])) {
							defaultViews.splice(i, 1);
						}
					}
				}

				// If we opened a view in the sidebar, stop any restore there
				if (locationsRestored[ViewContainerLocation.Sidebar]) {
					this.state.sideBar.viewletToRestore = locationsRestored[ViewContainerLocation.Sidebar].id;
				}

				// If we opened a view in the panel, stop any restore there
				if (locationsRestored[ViewContainerLocation.Panel]) {
					this.state.panel.panelToRestore = locationsRestored[ViewContainerLocation.Panel].id;
				}

				mark('code/didOpenDefaultViews');
			}
		})();
		layoutReadyPromises.push(restoreDefaultViewsPromise);

		// Restore Sidebar
		layoutReadyPromises.push((async () => {

			// Restoring views could mean that sidebar already
			// restored, as such we need to test again
			await restoreDefaultViewsPromise;
			if (!this.state.sideBar.viewletToRestore) {
				return;
			}

			mark('code/willRestoreViewlet');

			const viewlet = await this.viewletService.openViewlet(this.state.sideBar.viewletToRestore);
			if (!viewlet) {
				await this.viewletService.openViewlet(this.viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.Sidebar)?.id); // fallback to default viewlet as needed
			}

			mark('code/didRestoreViewlet');
		})());

		// Restore Panel
		layoutReadyPromises.push((async () => {

			// Restoring views could mean that panel already
			// restored, as such we need to test again
			await restoreDefaultViewsPromise;
			if (!this.state.panel.panelToRestore) {
				return;
			}

			mark('code/willRestorePanel');

			const panel = await this.panelService.openPanel(this.state.panel.panelToRestore);
			if (!panel) {
				await this.panelService.openPanel(Registry.as<PanelRegistry>(PanelExtensions.Panels).getDefaultPanelId()); // fallback to default panel as needed
			}

			mark('code/didRestorePanel');
		})());

		// Restore Zen Mode
		if (this.state.zenMode.restore) {
			this.toggleZenMode(false, true);
		}

		// Restore Editor Center Mode
		if (this.state.editor.restoreCentered) {
			this.centerEditorLayout(true, true);
		}

		// Await for promises that we recorded to update
		// our ready and restored states properly.
		Promises.settled(layoutReadyPromises).finally(() => {
			this.whenReadyResolve?.();

			Promises.settled(layoutRestoredPromises).finally(() => {
				this.restored = true;
				this.whenRestoredResolve?.();
			});
		});
	}

	private updatePanelPosition() {
		const defaultPanelPosition = this.configurationService.getValue<string>(Settings.PANEL_POSITION);
		const panelPosition = this.storageService.get(Storage.PANEL_POSITION, StorageScope.WORKSPACE, defaultPanelPosition);

		this.state.panel.position = positionFromString(panelPosition || defaultPanelPosition);
	}

	registerPart(part: Part): void {
		this.parts.set(part.getId(), part);
	}

	protected getPart(key: Parts): Part {
		const part = this.parts.get(key);
		if (!part) {
			throw new Error(`Unknown part ${key}`);
		}

		return part;
	}

	registerNotifications(delegate: { onDidChangeNotificationsVisibility: Event<boolean> }): void {
		this._register(delegate.onDidChangeNotificationsVisibility(visible => this._onDidChangeNotificationsVisibility.fire(visible)));
	}

	hasFocus(part: Parts): boolean {
		const activeElement = document.activeElement;
		if (!activeElement) {
			return false;
		}

		const container = this.getContainer(part);

		return !!container && isAncestorUsingFlowTo(activeElement, container);
	}

	focusPart(part: Parts): void {
		switch (part) {
			case Parts.EDITOR_PART:
				this.editorGroupService.activeGroup.focus();
				break;
			case Parts.PANEL_PART:
				const activePanel = this.panelService.getActivePanel();
				if (activePanel) {
					activePanel.focus();
				}
				break;
			case Parts.SIDEBAR_PART:
				const activeViewlet = this.viewletService.getActiveViewlet();
				if (activeViewlet) {
					activeViewlet.focus();
				}
				break;
			case Parts.ACTIVITYBAR_PART:
				this.activityBarService.focusActivityBar();
				break;
			case Parts.STATUSBAR_PART:
				this.statusBarService.focus();
			default:
				// Title Bar simply pass focus to container
				const container = this.getContainer(part);
				if (container) {
					container.focus();
				}
		}
	}

	getContainer(part: Parts): HTMLElement | undefined {
		switch (part) {
			case Parts.TITLEBAR_PART:
				return this.getPart(Parts.TITLEBAR_PART).getContainer();
			case Parts.ACTIVITYBAR_PART:
				return this.getPart(Parts.ACTIVITYBAR_PART).getContainer();
			case Parts.SIDEBAR_PART:
				return this.getPart(Parts.SIDEBAR_PART).getContainer();
			case Parts.PANEL_PART:
				return this.getPart(Parts.PANEL_PART).getContainer();
			case Parts.EDITOR_PART:
				return this.getPart(Parts.EDITOR_PART).getContainer();
			case Parts.STATUSBAR_PART:
				return this.getPart(Parts.STATUSBAR_PART).getContainer();
		}
	}

	isVisible(part: Parts): boolean {
		switch (part) {
			case Parts.TITLEBAR_PART:
				// Using the native title bar, don't ever show the custom one
				if (getTitleBarStyle(this.configurationService) === 'native') {
					return false;
				}

				// macOS desktop does not need a title bar when full screen
				if (isMacintosh && isNative) {
					return !this.state.fullscreen;
				}

				// non-fullscreen native must show the title bar
				if (isNative && !this.state.fullscreen) {
					return true;
				}

				// remaining behavior is based on menubar visibility
				switch (this.state.menuBar.visibility) {
					case 'classic':
						return !this.state.fullscreen || this.state.menuBar.toggled;
					case 'compact':
					case 'hidden':
						return false;
					case 'toggle':
						return this.state.menuBar.toggled;
					case 'visible':
						return true;
					default:
						return isWeb ? false : !this.state.fullscreen || this.state.menuBar.toggled;
				}
			case Parts.SIDEBAR_PART:
				return !this.state.sideBar.hidden;
			case Parts.PANEL_PART:
				return !this.state.panel.hidden;
			case Parts.STATUSBAR_PART:
				return !this.state.statusBar.hidden;
			case Parts.ACTIVITYBAR_PART:
				return !this.state.activityBar.hidden;
			case Parts.EDITOR_PART:
				return !this.state.editor.hidden;
			default:
				return true; // any other part cannot be hidden
		}
	}

	focus(): void {
		this.editorGroupService.activeGroup.focus();
	}

	getDimension(part: Parts): Dimension | undefined {
		return this.getPart(part).dimension;
	}

	getMaximumEditorDimensions(): Dimension {
		const isColumn = this.state.panel.position === Position.RIGHT || this.state.panel.position === Position.LEFT;
		const takenWidth =
			(this.isVisible(Parts.ACTIVITYBAR_PART) ? this.activityBarPartView.minimumWidth : 0) +
			(this.isVisible(Parts.SIDEBAR_PART) ? this.sideBarPartView.minimumWidth : 0) +
			(this.isVisible(Parts.PANEL_PART) && isColumn ? this.panelPartView.minimumWidth : 0);

		const takenHeight =
			(this.isVisible(Parts.TITLEBAR_PART) ? this.titleBarPartView.minimumHeight : 0) +
			(this.isVisible(Parts.STATUSBAR_PART) ? this.statusBarPartView.minimumHeight : 0) +
			(this.isVisible(Parts.PANEL_PART) && !isColumn ? this.panelPartView.minimumHeight : 0);

		const availableWidth = this.dimension.width - takenWidth;
		const availableHeight = this.dimension.height - takenHeight;

		return new Dimension(availableWidth, availableHeight);
	}

	toggleZenMode(skipLayout?: boolean, restoring = false): void {
		this.state.zenMode.active = !this.state.zenMode.active;
		this.state.zenMode.transitionDisposables.clear();

		const setLineNumbers = (lineNumbers?: LineNumbersType) => {
			const setEditorLineNumbers = (editor: IEditor) => {
				// To properly reset line numbers we need to read the configuration for each editor respecting it's uri.
				if (!lineNumbers && isCodeEditor(editor) && editor.hasModel()) {
					const model = editor.getModel();
					lineNumbers = this.configurationService.getValue('editor.lineNumbers', { resource: model.uri, overrideIdentifier: model.getModeId() });
				}
				if (!lineNumbers) {
					lineNumbers = this.configurationService.getValue('editor.lineNumbers');
				}

				editor.updateOptions({ lineNumbers });
			};

			if (!lineNumbers) {
				// Reset line numbers on all editors visible and non-visible
				for (const editorControl of this.editorService.visibleTextEditorControls) {
					setEditorLineNumbers(editorControl);
				}
			} else {
				for (const editorControl of this.editorService.visibleTextEditorControls) {
					setEditorLineNumbers(editorControl);
				}
			}
		};

		// Check if zen mode transitioned to full screen and if now we are out of zen mode
		// -> we need to go out of full screen (same goes for the centered editor layout)
		let toggleFullScreen = false;

		// Zen Mode Active
		if (this.state.zenMode.active) {
			const config: {
				fullScreen: boolean;
				centerLayout: boolean;
				hideTabs: boolean;
				hideActivityBar: boolean;
				hideStatusBar: boolean;
				hideLineNumbers: boolean;
				silentNotifications: boolean;
			} = this.configurationService.getValue('zenMode');

			toggleFullScreen = !this.state.fullscreen && config.fullScreen;

			this.state.zenMode.transitionedToFullScreen = restoring ? config.fullScreen : toggleFullScreen;
			this.state.zenMode.transitionedToCenteredEditorLayout = !this.isEditorLayoutCentered() && config.centerLayout;
			this.state.zenMode.wasSideBarVisible = this.isVisible(Parts.SIDEBAR_PART);
			this.state.zenMode.wasPanelVisible = this.isVisible(Parts.PANEL_PART);

			this.setPanelHidden(true, true);
			this.setSideBarHidden(true, true);

			if (config.hideActivityBar) {
				this.setActivityBarHidden(true, true);
			}

			if (config.hideStatusBar) {
				this.setStatusBarHidden(true, true);
			}

			if (config.hideLineNumbers) {
				setLineNumbers('off');
				this.state.zenMode.transitionDisposables.add(this.editorService.onDidVisibleEditorsChange(() => setLineNumbers('off')));
			}

			if (config.hideTabs && this.editorGroupService.partOptions.showTabs) {
				this.state.zenMode.transitionDisposables.add(this.editorGroupService.enforcePartOptions({ showTabs: false }));
			}

			this.state.zenMode.setNotificationsFilter = config.silentNotifications;
			if (config.silentNotifications) {
				this.notificationService.setFilter(NotificationsFilter.ERROR);
			}
			this.state.zenMode.transitionDisposables.add(this.configurationService.onDidChangeConfiguration(e => {
				const silentNotificationsKey = 'zenMode.silentNotifications';
				if (e.affectsConfiguration(silentNotificationsKey)) {
					const filter = this.configurationService.getValue(silentNotificationsKey) ? NotificationsFilter.ERROR : NotificationsFilter.OFF;
					this.notificationService.setFilter(filter);
				}
			}));

			if (config.centerLayout) {
				this.centerEditorLayout(true, true);
			}
		}

		// Zen Mode Inactive
		else {
			if (this.state.zenMode.wasPanelVisible) {
				this.setPanelHidden(false, true);
			}

			if (this.state.zenMode.wasSideBarVisible) {
				this.setSideBarHidden(false, true);
			}

			if (this.state.zenMode.transitionedToCenteredEditorLayout) {
				this.centerEditorLayout(false, true);
			}

			setLineNumbers();

			// Status bar and activity bar visibility come from settings -> update their visibility.
			this.doUpdateLayoutConfiguration(true);

			this.focus();
			if (this.state.zenMode.setNotificationsFilter) {
				this.notificationService.setFilter(NotificationsFilter.OFF);
			}

			toggleFullScreen = this.state.zenMode.transitionedToFullScreen && this.state.fullscreen;
		}

		if (!skipLayout) {
			this.layout();
		}

		if (toggleFullScreen) {
			this.hostService.toggleFullScreen();
		}

		// Event
		this._onDidChangeZenMode.fire(this.state.zenMode.active);

		// State
		if (this.state.zenMode.active) {
			this.storageService.store(Storage.ZEN_MODE_ENABLED, true, StorageScope.WORKSPACE, StorageTarget.USER);

			// Exit zen mode on shutdown unless configured to keep
			this.state.zenMode.transitionDisposables.add(this.storageService.onWillSaveState(e => {
				if (e.reason === WillSaveStateReason.SHUTDOWN && this.state.zenMode.active) {
					if (!this.configurationService.getValue(Settings.ZEN_MODE_RESTORE)) {
						this.toggleZenMode(true); // We will not restore zen mode, need to clear all zen mode state changes
					}
				}
			}));
		} else {
			this.storageService.remove(Storage.ZEN_MODE_ENABLED, StorageScope.WORKSPACE);
		}
	}

	private setStatusBarHidden(hidden: boolean, skipLayout?: boolean): void {
		this.state.statusBar.hidden = hidden;

		// Adjust CSS
		if (hidden) {
			this.container.classList.add(Classes.STATUSBAR_HIDDEN);
		} else {
			this.container.classList.remove(Classes.STATUSBAR_HIDDEN);
		}

		// Propagate to grid
		this.workbenchGrid.setViewVisible(this.statusBarPartView, !hidden);
	}

	protected createWorkbenchLayout(): void {
		const titleBar = this.getPart(Parts.TITLEBAR_PART);
		const editorPart = this.getPart(Parts.EDITOR_PART);
		const activityBar = this.getPart(Parts.ACTIVITYBAR_PART);
		const panelPart = this.getPart(Parts.PANEL_PART);
		const sideBar = this.getPart(Parts.SIDEBAR_PART);
		const statusBar = this.getPart(Parts.STATUSBAR_PART);

		// View references for all parts
		this.titleBarPartView = titleBar;
		this.sideBarPartView = sideBar;
		this.activityBarPartView = activityBar;
		this.editorPartView = editorPart;
		this.panelPartView = panelPart;
		this.statusBarPartView = statusBar;

		const viewMap = {
			[Parts.ACTIVITYBAR_PART]: this.activityBarPartView,
			[Parts.TITLEBAR_PART]: this.titleBarPartView,
			[Parts.EDITOR_PART]: this.editorPartView,
			[Parts.PANEL_PART]: this.panelPartView,
			[Parts.SIDEBAR_PART]: this.sideBarPartView,
			[Parts.STATUSBAR_PART]: this.statusBarPartView
		};

		const fromJSON = ({ type }: { type: Parts; }) => viewMap[type];
		const workbenchGrid = SerializableGrid.deserialize(
			this.createGridDescriptor(),
			{ fromJSON },
			{ proportionalLayout: false }
		);

		this.container.prepend(workbenchGrid.element);
		this.container.setAttribute('role', 'application');
		this.workbenchGrid = workbenchGrid;
		this.workbenchGrid.edgeSnapping = this.state.fullscreen;

		for (const part of [titleBar, editorPart, activityBar, panelPart, sideBar, statusBar]) {
			this._register(part.onDidVisibilityChange((visible) => {
				if (part === sideBar) {
					this.setSideBarHidden(!visible, true);
				} else if (part === panelPart) {
					this.setPanelHidden(!visible, true);
				} else if (part === editorPart) {
					this.setEditorHidden(!visible, true);
				}
				this._onDidChangePartVisibility.fire();
			}));
		}

		this._register(this.storageService.onWillSaveState(() => {
			const grid = this.workbenchGrid as SerializableGrid<ISerializableView>;

			const sideBarSize = this.state.sideBar.hidden
				? grid.getViewCachedVisibleSize(this.sideBarPartView)
				: grid.getViewSize(this.sideBarPartView).width;

			this.storageService.store(Storage.SIDEBAR_SIZE, sideBarSize, StorageScope.GLOBAL, StorageTarget.MACHINE);

			const panelSize = this.state.panel.hidden
				? grid.getViewCachedVisibleSize(this.panelPartView)
				: (this.state.panel.position === Position.BOTTOM ? grid.getViewSize(this.panelPartView).height : grid.getViewSize(this.panelPartView).width);

			this.storageService.store(Storage.PANEL_SIZE, panelSize, StorageScope.GLOBAL, StorageTarget.MACHINE);
			this.storageService.store(Storage.PANEL_DIMENSION, positionToString(this.state.panel.position), StorageScope.GLOBAL, StorageTarget.MACHINE);

			const gridSize = grid.getViewSize();
			this.storageService.store(Storage.GRID_WIDTH, gridSize.width, StorageScope.GLOBAL, StorageTarget.MACHINE);
			this.storageService.store(Storage.GRID_HEIGHT, gridSize.height, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}));
	}

	getClientArea(): Dimension {
		return getClientArea(this.parent);
	}

	layout(): void {
		if (!this.disposed) {
			this._dimension = this.getClientArea();
			this.logService.trace(`Layout#layout, height: ${this._dimension.height}, width: ${this._dimension.width}`);

			position(this.container, 0, 0, 0, 0, 'relative');
			size(this.container, this._dimension.width, this._dimension.height);

			// Layout the grid widget
			this.workbenchGrid.layout(this._dimension.width, this._dimension.height);

			// Emit as event
			this._onDidLayout.fire(this._dimension);
		}
	}

	isEditorLayoutCentered(): boolean {
		return this.state.editor.centered;
	}

	centerEditorLayout(active: boolean, skipLayout?: boolean): void {
		this.state.editor.centered = active;

		this.storageService.store(Storage.CENTERED_LAYOUT_ENABLED, active, StorageScope.WORKSPACE, StorageTarget.USER);

		let smartActive = active;
		const activeEditor = this.editorService.activeEditor;

		const isSideBySideLayout = activeEditor
			&& activeEditor instanceof SideBySideEditorInput
			// DiffEditorInput inherits from SideBySideEditorInput but can still be functionally an inline editor.
			&& (!(activeEditor instanceof DiffEditorInput) || this.configurationService.getValue('diffEditor.renderSideBySide'));

		const isCenteredLayoutAutoResizing = this.configurationService.getValue('workbench.editor.centeredLayoutAutoResize');
		if (
			isCenteredLayoutAutoResizing
			&& (this.editorGroupService.groups.length > 1 || isSideBySideLayout)
		) {
			smartActive = false;
		}

		// Enter Centered Editor Layout
		if (this.editorGroupService.isLayoutCentered() !== smartActive) {
			this.editorGroupService.centerLayout(smartActive);

			if (!skipLayout) {
				this.layout();
			}
		}

		this._onDidChangeCenteredLayout.fire(this.state.editor.centered);
	}

	resizePart(part: Parts, sizeChangeWidth: number, sizeChangeHeight: number): void {
		const sizeChangePxWidth = this.workbenchGrid.width * sizeChangeWidth / 100;
		const sizeChangePxHeight = this.workbenchGrid.height * sizeChangeHeight / 100;

		let viewSize: IViewSize;

		switch (part) {
			case Parts.SIDEBAR_PART:
				viewSize = this.workbenchGrid.getViewSize(this.sideBarPartView);
				this.workbenchGrid.resizeView(this.sideBarPartView,
					{
						width: viewSize.width + sizeChangePxWidth,
						height: viewSize.height
					});

				break;
			case Parts.PANEL_PART:
				viewSize = this.workbenchGrid.getViewSize(this.panelPartView);

				this.workbenchGrid.resizeView(this.panelPartView,
					{
						width: viewSize.width + (this.getPanelPosition() !== Position.BOTTOM ? sizeChangePxWidth : 0),
						height: viewSize.height + (this.getPanelPosition() !== Position.BOTTOM ? 0 : sizeChangePxHeight)
					});

				break;
			case Parts.EDITOR_PART:
				viewSize = this.workbenchGrid.getViewSize(this.editorPartView);

				// Single Editor Group
				if (this.editorGroupService.count === 1) {
					this.workbenchGrid.resizeView(this.editorPartView,
						{
							width: viewSize.width + sizeChangePxWidth,
							height: viewSize.height + sizeChangePxHeight
						});
				} else {
					const activeGroup = this.editorGroupService.activeGroup;

					const { width, height } = this.editorGroupService.getSize(activeGroup);
					this.editorGroupService.setSize(activeGroup, { width: width + sizeChangePxWidth, height: height + sizeChangePxHeight });

					// After resizing the editor group
					// if it does not change in either direction
					// try resizing the full editor part
					const { width: newWidth, height: newHeight } = this.editorGroupService.getSize(activeGroup);
					if ((sizeChangePxHeight && height === newHeight) || (sizeChangePxWidth && width === newWidth)) {
						this.workbenchGrid.resizeView(this.editorPartView,
							{
								width: viewSize.width + (sizeChangePxWidth && width === newWidth ? sizeChangePxWidth : 0),
								height: viewSize.height + (sizeChangePxHeight && height === newHeight ? sizeChangePxHeight : 0)
							});
					}
				}

				break;
			default:
				return; // Cannot resize other parts
		}
	}

	setActivityBarHidden(hidden: boolean, skipLayout?: boolean): void {
		this.state.activityBar.hidden = hidden;

		// Propagate to grid
		this.workbenchGrid.setViewVisible(this.activityBarPartView, !hidden);
	}

	setEditorHidden(hidden: boolean, skipLayout?: boolean): void {
		this.state.editor.hidden = hidden;

		// Adjust CSS
		if (hidden) {
			this.container.classList.add(Classes.EDITOR_HIDDEN);
		} else {
			this.container.classList.remove(Classes.EDITOR_HIDDEN);
		}

		// Propagate to grid
		this.workbenchGrid.setViewVisible(this.editorPartView, !hidden);

		// Remember in settings
		if (hidden) {
			this.storageService.store(Storage.EDITOR_HIDDEN, true, StorageScope.WORKSPACE, StorageTarget.USER);
		} else {
			this.storageService.remove(Storage.EDITOR_HIDDEN, StorageScope.WORKSPACE);
		}

		// The editor and panel cannot be hidden at the same time
		if (hidden && this.state.panel.hidden) {
			this.setPanelHidden(false, true);
		}
	}

	getLayoutClasses(): string[] {
		return coalesce([
			this.state.sideBar.hidden ? Classes.SIDEBAR_HIDDEN : undefined,
			this.state.editor.hidden ? Classes.EDITOR_HIDDEN : undefined,
			this.state.panel.hidden ? Classes.PANEL_HIDDEN : undefined,
			this.state.statusBar.hidden ? Classes.STATUSBAR_HIDDEN : undefined,
			this.state.fullscreen ? Classes.FULLSCREEN : undefined
		]);
	}

	setSideBarHidden(hidden: boolean, skipLayout?: boolean): void {
		this.state.sideBar.hidden = hidden;

		// Adjust CSS
		if (hidden) {
			this.container.classList.add(Classes.SIDEBAR_HIDDEN);
		} else {
			this.container.classList.remove(Classes.SIDEBAR_HIDDEN);
		}

		// If sidebar becomes hidden, also hide the current active Viewlet if any
		if (hidden && this.viewletService.getActiveViewlet()) {
			this.viewletService.hideActiveViewlet();

			// Pass Focus to Editor or Panel if Sidebar is now hidden
			const activePanel = this.panelService.getActivePanel();
			if (this.hasFocus(Parts.PANEL_PART) && activePanel) {
				activePanel.focus();
			} else {
				this.focus();
			}
		}

		// If sidebar becomes visible, show last active Viewlet or default viewlet
		else if (!hidden && !this.viewletService.getActiveViewlet()) {
			const viewletToOpen = this.viewletService.getLastActiveViewletId();
			if (viewletToOpen) {
				const viewlet = this.viewletService.openViewlet(viewletToOpen, true);
				if (!viewlet) {
					this.viewletService.openViewlet(this.viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.Sidebar)?.id, true);
				}
			}
		}

		// Propagate to grid
		this.workbenchGrid.setViewVisible(this.sideBarPartView, !hidden);

		// Remember in settings
		const defaultHidden = this.contextService.getWorkbenchState() === WorkbenchState.EMPTY;
		if (hidden !== defaultHidden) {
			this.storageService.store(Storage.SIDEBAR_HIDDEN, hidden ? 'true' : 'false', StorageScope.WORKSPACE, StorageTarget.USER);
		} else {
			this.storageService.remove(Storage.SIDEBAR_HIDDEN, StorageScope.WORKSPACE);
		}
	}

	setPanelHidden(hidden: boolean, skipLayout?: boolean): void {
		const wasHidden = this.state.panel.hidden;
		this.state.panel.hidden = hidden;

		// Return if not initialized fully #105480
		if (!this.workbenchGrid) {
			return;
		}

		const isPanelMaximized = this.isPanelMaximized();
		const panelOpensMaximized = this.panelOpensMaximized();

		// Adjust CSS
		if (hidden) {
			this.container.classList.add(Classes.PANEL_HIDDEN);
		} else {
			this.container.classList.remove(Classes.PANEL_HIDDEN);
		}

		// If panel part becomes hidden, also hide the current active panel if any
		let focusEditor = false;
		if (hidden && this.panelService.getActivePanel()) {
			this.panelService.hideActivePanel();
			focusEditor = true;
		}

		// If panel part becomes visible, show last active panel or default panel
		else if (!hidden && !this.panelService.getActivePanel()) {
			let panelToOpen: string | undefined = this.panelService.getLastActivePanelId();
			const hasViews = (id: string): boolean => {
				const viewContainer = this.viewDescriptorService.getViewContainerById(id);
				if (!viewContainer) {
					return false;
				}

				const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
				if (!viewContainerModel) {
					return false;
				}

				return viewContainerModel.activeViewDescriptors.length >= 1;
			};

			// verify that the panel we try to open has views before we default to it
			// otherwise fall back to any view that has views still refs #111463
			if (!panelToOpen || !hasViews(panelToOpen)) {
				panelToOpen = this.viewDescriptorService
					.getViewContainersByLocation(ViewContainerLocation.Panel)
					.find(viewContainer => hasViews(viewContainer.id))?.id;
			}

			if (panelToOpen) {
				const focus = !skipLayout;
				this.panelService.openPanel(panelToOpen, focus);
			}
		}

		// If maximized and in process of hiding, unmaximize before hiding to allow caching of non-maximized size
		if (hidden && isPanelMaximized) {
			this.toggleMaximizedPanel();
		}

		// Don't proceed if we have already done this before
		if (wasHidden === hidden) {
			return;
		}

		// Propagate layout changes to grid
		this.workbenchGrid.setViewVisible(this.panelPartView, !hidden);
		// If in process of showing, toggle whether or not panel is maximized
		if (!hidden) {
			if (isPanelMaximized !== panelOpensMaximized) {
				this.toggleMaximizedPanel();
			}
		}
		else {
			// If in process of hiding, remember whether the panel is maximized or not
			this.state.panel.wasLastMaximized = isPanelMaximized;
		}
		// Remember in settings
		if (!hidden) {
			this.storageService.store(Storage.PANEL_HIDDEN, 'false', StorageScope.WORKSPACE, StorageTarget.USER);
		}
		else {
			this.storageService.remove(Storage.PANEL_HIDDEN, StorageScope.WORKSPACE);

			// Remember this setting only when panel is hiding
			if (this.state.panel.wasLastMaximized) {
				this.storageService.store(Storage.PANEL_LAST_IS_MAXIMIZED, true, StorageScope.WORKSPACE, StorageTarget.USER);
			}
			else {
				this.storageService.remove(Storage.PANEL_LAST_IS_MAXIMIZED, StorageScope.WORKSPACE);
			}
		}

		if (focusEditor) {
			this.editorGroupService.activeGroup.focus(); // Pass focus to editor group if panel part is now hidden
		}
	}

	toggleMaximizedPanel(): void {
		const size = this.workbenchGrid.getViewSize(this.panelPartView);
		if (!this.isPanelMaximized()) {
			if (!this.state.panel.hidden) {
				if (this.state.panel.position === Position.BOTTOM) {
					this.state.panel.lastNonMaximizedHeight = size.height;
					this.storageService.store(Storage.PANEL_LAST_NON_MAXIMIZED_HEIGHT, this.state.panel.lastNonMaximizedHeight, StorageScope.GLOBAL, StorageTarget.MACHINE);
				} else {
					this.state.panel.lastNonMaximizedWidth = size.width;
					this.storageService.store(Storage.PANEL_LAST_NON_MAXIMIZED_WIDTH, this.state.panel.lastNonMaximizedWidth, StorageScope.GLOBAL, StorageTarget.MACHINE);
				}
			}

			this.setEditorHidden(true);
		} else {
			this.setEditorHidden(false);
			this.workbenchGrid.resizeView(this.panelPartView, { width: this.state.panel.position === Position.BOTTOM ? size.width : this.state.panel.lastNonMaximizedWidth, height: this.state.panel.position === Position.BOTTOM ? this.state.panel.lastNonMaximizedHeight : size.height });
		}
	}

	/**
	 * Returns whether or not the panel opens maximized
	 */
	private panelOpensMaximized() {
		const panelOpensMaximized = panelOpensMaximizedFromString(this.configurationService.getValue<string>(Settings.PANEL_OPENS_MAXIMIZED));
		const panelLastIsMaximized = this.state.panel.wasLastMaximized;

		return panelOpensMaximized === PanelOpensMaximizedOptions.ALWAYS || (panelOpensMaximized === PanelOpensMaximizedOptions.REMEMBER_LAST && panelLastIsMaximized);
	}

	hasWindowBorder(): boolean {
		return this.state.windowBorder;
	}

	getWindowBorderWidth(): number {
		return this.state.windowBorder ? 2 : 0;
	}

	getWindowBorderRadius(): string | undefined {
		return this.state.windowBorder && isMacintosh ? '5px' : undefined;
	}

	isPanelMaximized(): boolean {
		return this.state.editor.hidden;
	}

	getSideBarPosition(): Position {
		return this.state.sideBar.position;
	}

	setMenubarVisibility(visibility: MenuBarVisibility, skipLayout: boolean): void {
		if (this.state.menuBar.visibility !== visibility) {
			this.state.menuBar.visibility = visibility;

			// Layout
			if (!skipLayout && this.workbenchGrid) {
				this.workbenchGrid.setViewVisible(this.titleBarPartView, this.isVisible(Parts.TITLEBAR_PART));
			}
		}
	}

	getMenubarVisibility(): MenuBarVisibility {
		return this.state.menuBar.visibility;
	}

	toggleMenuBar(): void {
		let currentVisibilityValue = getMenuBarVisibility(this.configurationService);
		if (typeof currentVisibilityValue !== 'string') {
			currentVisibilityValue = 'classic';
		}

		let newVisibilityValue: string;
		if (currentVisibilityValue === 'visible' || currentVisibilityValue === 'classic') {
			newVisibilityValue = 'compact';
		} else {
			newVisibilityValue = 'classic';
		}

		this.configurationService.updateValue(Storage.MENU_VISIBILITY, newVisibilityValue);
	}

	getPanelPosition(): Position {
		return this.state.panel.position;
	}

	setPanelPosition(position: Position): void {
		if (this.state.panel.hidden) {
			this.setPanelHidden(false);
		}

		const panelPart = this.getPart(Parts.PANEL_PART);
		const oldPositionValue = positionToString(this.state.panel.position);
		const newPositionValue = positionToString(position);
		this.state.panel.position = position;

		// Save panel position
		this.storageService.store(Storage.PANEL_POSITION, newPositionValue, StorageScope.WORKSPACE, StorageTarget.USER);

		// Adjust CSS
		const panelContainer = assertIsDefined(panelPart.getContainer());
		panelContainer.classList.remove(oldPositionValue);
		panelContainer.classList.add(newPositionValue);

		// Update Styles
		panelPart.updateStyles();

		// Layout
		const size = this.workbenchGrid.getViewSize(this.panelPartView);
		const sideBarSize = this.workbenchGrid.getViewSize(this.sideBarPartView);

		// Save last non-maximized size for panel before move
		if (newPositionValue !== oldPositionValue && !this.state.editor.hidden) {

			// Save the current size of the panel for the new orthogonal direction
			// If moving down, save the width of the panel
			// Otherwise, save the height of the panel
			if (position === Position.BOTTOM) {
				this.state.panel.lastNonMaximizedWidth = size.width;
			} else if (positionFromString(oldPositionValue) === Position.BOTTOM) {
				this.state.panel.lastNonMaximizedHeight = size.height;
			}
		}

		if (position === Position.BOTTOM) {
			this.workbenchGrid.moveView(this.panelPartView, this.state.editor.hidden ? size.height : this.state.panel.lastNonMaximizedHeight, this.editorPartView, Direction.Down);
		} else if (position === Position.RIGHT) {
			this.workbenchGrid.moveView(this.panelPartView, this.state.editor.hidden ? size.width : this.state.panel.lastNonMaximizedWidth, this.editorPartView, Direction.Right);
		} else {
			this.workbenchGrid.moveView(this.panelPartView, this.state.editor.hidden ? size.width : this.state.panel.lastNonMaximizedWidth, this.editorPartView, Direction.Left);
		}

		// Reset sidebar to original size before shifting the panel
		this.workbenchGrid.resizeView(this.sideBarPartView, sideBarSize);

		this._onDidChangePanelPosition.fire(newPositionValue);
	}

	isWindowMaximized() {
		return this.state.maximized;
	}

	updateWindowMaximizedState(maximized: boolean) {
		if (this.state.maximized === maximized) {
			return;
		}

		this.state.maximized = maximized;

		this.updateWindowBorder();
		this._onDidChangeWindowMaximized.fire(maximized);
	}

	getVisibleNeighborPart(part: Parts, direction: Direction): Parts | undefined {
		if (!this.workbenchGrid) {
			return undefined;
		}

		if (!this.isVisible(part)) {
			return undefined;
		}

		const neighborViews = this.workbenchGrid.getNeighborViews(this.getPart(part), direction, false);

		if (!neighborViews) {
			return undefined;
		}

		for (const neighborView of neighborViews) {
			const neighborPart =
				[Parts.ACTIVITYBAR_PART, Parts.EDITOR_PART, Parts.PANEL_PART, Parts.SIDEBAR_PART, Parts.STATUSBAR_PART, Parts.TITLEBAR_PART]
					.find(partId => this.getPart(partId) === neighborView && this.isVisible(partId));

			if (neighborPart !== undefined) {
				return neighborPart;
			}
		}

		return undefined;
	}


	private arrangeEditorNodes(editorNode: ISerializedNode, panelNode: ISerializedNode, editorSectionWidth: number): ISerializedNode[] {
		switch (this.state.panel.position) {
			case Position.BOTTOM:
				return [{ type: 'branch', data: [editorNode, panelNode], size: editorSectionWidth }];
			case Position.RIGHT:
				return [editorNode, panelNode];
			case Position.LEFT:
				return [panelNode, editorNode];
		}
	}

	private createGridDescriptor(): ISerializedGrid {
		const workbenchDimensions = this.getClientArea();
		const width = this.storageService.getNumber(Storage.GRID_WIDTH, StorageScope.GLOBAL, workbenchDimensions.width);
		const height = this.storageService.getNumber(Storage.GRID_HEIGHT, StorageScope.GLOBAL, workbenchDimensions.height);
		const sideBarSize = this.storageService.getNumber(Storage.SIDEBAR_SIZE, StorageScope.GLOBAL, Math.min(workbenchDimensions.width / 4, 300));
		const panelDimension = positionFromString(this.storageService.get(Storage.PANEL_DIMENSION, StorageScope.GLOBAL, 'bottom'));
		const fallbackPanelSize = this.state.panel.position === Position.BOTTOM ? workbenchDimensions.height / 3 : workbenchDimensions.width / 4;
		const panelSize = panelDimension === this.state.panel.position ? this.storageService.getNumber(Storage.PANEL_SIZE, StorageScope.GLOBAL, fallbackPanelSize) : fallbackPanelSize;

		const titleBarHeight = this.titleBarPartView.minimumHeight;
		const statusBarHeight = this.statusBarPartView.minimumHeight;
		const activityBarWidth = this.activityBarPartView.minimumWidth;
		const middleSectionHeight = height - titleBarHeight - statusBarHeight;
		const editorSectionWidth = width - (this.state.activityBar.hidden ? 0 : activityBarWidth) - (this.state.sideBar.hidden ? 0 : sideBarSize);

		const activityBarNode: ISerializedLeafNode = {
			type: 'leaf',
			data: { type: Parts.ACTIVITYBAR_PART },
			size: activityBarWidth,
			visible: !this.state.activityBar.hidden
		};

		const sideBarNode: ISerializedLeafNode = {
			type: 'leaf',
			data: { type: Parts.SIDEBAR_PART },
			size: sideBarSize,
			visible: !this.state.sideBar.hidden
		};

		const editorNode: ISerializedLeafNode = {
			type: 'leaf',
			data: { type: Parts.EDITOR_PART },
			size: this.state.panel.position === Position.BOTTOM ?
				middleSectionHeight - (this.state.panel.hidden ? 0 : panelSize) :
				editorSectionWidth - (this.state.panel.hidden ? 0 : panelSize),
			visible: !this.state.editor.hidden
		};

		const panelNode: ISerializedLeafNode = {
			type: 'leaf',
			data: { type: Parts.PANEL_PART },
			size: panelSize,
			visible: !this.state.panel.hidden
		};

		const editorSectionNode = this.arrangeEditorNodes(editorNode, panelNode, editorSectionWidth);

		const middleSection: ISerializedNode[] = this.state.sideBar.position === Position.LEFT
			? [activityBarNode, sideBarNode, ...editorSectionNode]
			: [...editorSectionNode, sideBarNode, activityBarNode];

		const result: ISerializedGrid = {
			root: {
				type: 'branch',
				size: width,
				data: [
					{
						type: 'leaf',
						data: { type: Parts.TITLEBAR_PART },
						size: titleBarHeight,
						visible: this.isVisible(Parts.TITLEBAR_PART)
					},
					{
						type: 'branch',
						data: middleSection,
						size: middleSectionHeight
					},
					{
						type: 'leaf',
						data: { type: Parts.STATUSBAR_PART },
						size: statusBarHeight,
						visible: !this.state.statusBar.hidden
					}
				]
			},
			orientation: Orientation.VERTICAL,
			width,
			height
		};

		return result;
	}

	override dispose(): void {
		super.dispose();

		this.disposed = true;
	}
}
