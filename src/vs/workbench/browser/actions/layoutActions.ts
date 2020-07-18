/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { Action } from 'vs/base/common/actions';
import { SyncActionDescriptor, MenuId, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/actions';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService, Parts, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { IEditorGroupsService, GroupOrientation } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { getMenuBarVisibility } from 'vs/platform/windows/common/windows';
import { isWindows, isLinux, isWeb } from 'vs/base/common/platform';
import { IsMacNativeContext } from 'vs/platform/contextkey/common/contextkeys';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { InEditorZenModeContext, IsCenteredLayoutContext, EditorAreaVisibleContext } from 'vs/workbench/common/editor';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SideBarVisibleContext } from 'vs/workbench/common/viewlet';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IViewDescriptorService, IViewsService, FocusedViewContext, ViewContainerLocation, IViewDescriptor } from 'vs/workbench/common/views';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { Codicon } from 'vs/base/common/codicons';

const registry = Registry.as<IWorkbenchActionRegistry>(WorkbenchExtensions.WorkbenchActions);
const viewCategory = { value: nls.localize('view', "View"), original: 'View' };

// --- Close Side Bar

class CloseSidebarAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.closeSidebar',
			title: { value: nls.localize('closeSidebar', "Close Side Bar"), original: 'Close Side Bar' },
			category: viewCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchLayoutService).setSideBarHidden(true);
	}
}

registerAction2(CloseSidebarAction);

// --- Toggle Activity Bar

export class ToggleActivityBarVisibilityAction extends Action2 {

	static readonly ID = 'workbench.action.toggleActivityBarVisibility';
	static readonly LABEL = nls.localize('toggleActivityBar', "Toggle Activity Bar Visibility");

	private static readonly activityBarVisibleKey = 'workbench.activityBar.visible';

	constructor() {
		super({
			id: ToggleActivityBarVisibilityAction.ID,
			title: { value: ToggleActivityBarVisibilityAction.LABEL, original: 'Toggle Activity Bar Visibility' },
			category: viewCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const configurationService = accessor.get(IConfigurationService);

		const visibility = layoutService.isVisible(Parts.ACTIVITYBAR_PART);
		const newVisibilityValue = !visibility;

		configurationService.updateValue(ToggleActivityBarVisibilityAction.activityBarVisibleKey, newVisibilityValue, ConfigurationTarget.USER);
	}
}

registerAction2(ToggleActivityBarVisibilityAction);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '2_workbench_layout',
	command: {
		id: ToggleActivityBarVisibilityAction.ID,
		title: nls.localize({ key: 'miShowActivityBar', comment: ['&& denotes a mnemonic'] }, "Show &&Activity Bar"),
		toggled: ContextKeyExpr.equals('config.workbench.activityBar.visible', true)
	},
	order: 4
});

// --- Toggle Centered Layout

class ToggleCenteredLayout extends Action2 {

	static readonly ID = 'workbench.action.toggleCenteredLayout';

	constructor() {
		super({
			id: ToggleCenteredLayout.ID,
			title: { value: nls.localize('toggleCenteredLayout', "Toggle Centered Layout"), original: 'Toggle Centered Layout' },
			category: viewCategory,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);

		layoutService.centerEditorLayout(!layoutService.isEditorLayoutCentered());
	}
}

registerAction2(ToggleCenteredLayout);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '1_toggle_view',
	command: {
		id: ToggleCenteredLayout.ID,
		title: nls.localize({ key: 'miToggleCenteredLayout', comment: ['&& denotes a mnemonic'] }, "&&Centered Layout"),
		toggled: IsCenteredLayoutContext
	},
	order: 3
});

// --- Toggle Editor Layout

export class ToggleEditorLayoutAction extends Action {

	static readonly ID = 'workbench.action.toggleEditorGroupLayout';
	static readonly LABEL = nls.localize('flipLayout', "Toggle Vertical/Horizontal Editor Layout");

	private readonly toDispose = this._register(new DisposableStore());

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(id, label);

		this.class = Codicon.editorLayout.classNames;
		this.updateEnablement();

		this.registerListeners();
	}

	private registerListeners(): void {
		this.toDispose.add(this.editorGroupService.onDidAddGroup(() => this.updateEnablement()));
		this.toDispose.add(this.editorGroupService.onDidRemoveGroup(() => this.updateEnablement()));
	}

	private updateEnablement(): void {
		this.enabled = this.editorGroupService.count > 1;
	}

	async run(): Promise<void> {
		const newOrientation = (this.editorGroupService.orientation === GroupOrientation.VERTICAL) ? GroupOrientation.HORIZONTAL : GroupOrientation.VERTICAL;
		this.editorGroupService.setGroupOrientation(newOrientation);
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleEditorLayoutAction, { primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_0, mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_0 } }), 'View: Toggle Vertical/Horizontal Editor Layout', viewCategory.value);

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: 'z_flip',
	command: {
		id: ToggleEditorLayoutAction.ID,
		title: nls.localize({ key: 'miToggleEditorLayout', comment: ['&& denotes a mnemonic'] }, "Flip &&Layout")
	},
	order: 1
});

// --- Toggle Sidebar Position

export class ToggleSidebarPositionAction extends Action {

	static readonly ID = 'workbench.action.toggleSidebarPosition';
	static readonly LABEL = nls.localize('toggleSidebarPosition', "Toggle Side Bar Position");

	private static readonly sidebarPositionConfigurationKey = 'workbench.sideBar.location';

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		const position = this.layoutService.getSideBarPosition();
		const newPositionValue = (position === Position.LEFT) ? 'right' : 'left';

		return this.configurationService.updateValue(ToggleSidebarPositionAction.sidebarPositionConfigurationKey, newPositionValue, ConfigurationTarget.USER);
	}

	static getLabel(layoutService: IWorkbenchLayoutService): string {
		return layoutService.getSideBarPosition() === Position.LEFT ? nls.localize('moveSidebarRight', "Move Side Bar Right") : nls.localize('moveSidebarLeft', "Move Side Bar Left");
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleSidebarPositionAction), 'View: Toggle Side Bar Position', viewCategory.value);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '3_workbench_layout_move',
	command: {
		id: ToggleSidebarPositionAction.ID,
		title: nls.localize({ key: 'miMoveSidebarRight', comment: ['&& denotes a mnemonic'] }, "&&Move Side Bar Right")
	},
	when: ContextKeyExpr.notEquals('config.workbench.sideBar.location', 'right'),
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '3_workbench_layout_move',
	command: {
		id: ToggleSidebarPositionAction.ID,
		title: nls.localize({ key: 'miMoveSidebarLeft', comment: ['&& denotes a mnemonic'] }, "&&Move Side Bar Left")
	},
	when: ContextKeyExpr.equals('config.workbench.sideBar.location', 'right'),
	order: 2
});

// --- Toggle Sidebar Visibility

export class ToggleEditorVisibilityAction extends Action {
	static readonly ID = 'workbench.action.toggleEditorVisibility';
	static readonly LABEL = nls.localize('toggleEditor', "Toggle Editor Area Visibility");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		this.layoutService.toggleMaximizedPanel();
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleEditorVisibilityAction), 'View: Toggle Editor Area Visibility', viewCategory.value);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '2_workbench_layout',
	command: {
		id: ToggleEditorVisibilityAction.ID,
		title: nls.localize({ key: 'miShowEditorArea', comment: ['&& denotes a mnemonic'] }, "Show &&Editor Area"),
		toggled: EditorAreaVisibleContext
	},
	order: 5
});

export class ToggleSidebarVisibilityAction extends Action {

	static readonly ID = 'workbench.action.toggleSidebarVisibility';
	static readonly LABEL = nls.localize('toggleSidebar', "Toggle Side Bar Visibility");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const hideSidebar = this.layoutService.isVisible(Parts.SIDEBAR_PART);
		this.layoutService.setSideBarHidden(hideSidebar);
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleSidebarVisibilityAction, { primary: KeyMod.CtrlCmd | KeyCode.KEY_B }), 'View: Toggle Side Bar Visibility', viewCategory.value);

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '2_appearance',
	title: nls.localize({ key: 'miAppearance', comment: ['&& denotes a mnemonic'] }, "&&Appearance"),
	submenu: MenuId.MenubarAppearanceMenu,
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '2_workbench_layout',
	command: {
		id: ToggleSidebarVisibilityAction.ID,
		title: nls.localize({ key: 'miShowSidebar', comment: ['&& denotes a mnemonic'] }, "Show &&Side Bar"),
		toggled: SideBarVisibleContext
	},
	order: 1
});

// --- Toggle Statusbar Visibility

export class ToggleStatusbarVisibilityAction extends Action {

	static readonly ID = 'workbench.action.toggleStatusbarVisibility';
	static readonly LABEL = nls.localize('toggleStatusbar', "Toggle Status Bar Visibility");

	private static readonly statusbarVisibleKey = 'workbench.statusBar.visible';

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		const visibility = this.layoutService.isVisible(Parts.STATUSBAR_PART);
		const newVisibilityValue = !visibility;

		return this.configurationService.updateValue(ToggleStatusbarVisibilityAction.statusbarVisibleKey, newVisibilityValue, ConfigurationTarget.USER);
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleStatusbarVisibilityAction), 'View: Toggle Status Bar Visibility', viewCategory.value);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '2_workbench_layout',
	command: {
		id: ToggleStatusbarVisibilityAction.ID,
		title: nls.localize({ key: 'miShowStatusbar', comment: ['&& denotes a mnemonic'] }, "Show S&&tatus Bar"),
		toggled: ContextKeyExpr.equals('config.workbench.statusBar.visible', true)
	},
	order: 3
});

// --- Toggle Tabs Visibility

class ToggleTabsVisibilityAction extends Action {

	static readonly ID = 'workbench.action.toggleTabsVisibility';
	static readonly LABEL = nls.localize('toggleTabs', "Toggle Tab Visibility");

	private static readonly tabsVisibleKey = 'workbench.editor.showTabs';

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		const visibility = this.configurationService.getValue<string>(ToggleTabsVisibilityAction.tabsVisibleKey);
		const newVisibilityValue = !visibility;

		return this.configurationService.updateValue(ToggleTabsVisibilityAction.tabsVisibleKey, newVisibilityValue);
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleTabsVisibilityAction, {
	primary: undefined,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_W, },
	linux: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_W, }
}), 'View: Toggle Tab Visibility', viewCategory.value);

// --- Toggle Zen Mode

class ToggleZenMode extends Action {

	static readonly ID = 'workbench.action.toggleZenMode';
	static readonly LABEL = nls.localize('toggleZenMode', "Toggle Zen Mode");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		this.layoutService.toggleZenMode();
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleZenMode, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_Z) }), 'View: Toggle Zen Mode', viewCategory.value);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '1_toggle_view',
	command: {
		id: ToggleZenMode.ID,
		title: nls.localize('miToggleZenMode', "Zen Mode"),
		toggled: InEditorZenModeContext
	},
	order: 2
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.action.exitZenMode',
	weight: KeybindingWeight.EditorContrib - 1000,
	handler(accessor: ServicesAccessor) {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.toggleZenMode();
	},
	when: InEditorZenModeContext,
	primary: KeyChord(KeyCode.Escape, KeyCode.Escape)
});

// --- Toggle Menu Bar

export class ToggleMenuBarAction extends Action {

	static readonly ID = 'workbench.action.toggleMenuBar';
	static readonly LABEL = nls.localize('toggleMenuBar', "Toggle Menu Bar");

	private static readonly menuBarVisibilityKey = 'window.menuBarVisibility';

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		let currentVisibilityValue = getMenuBarVisibility(this.configurationService, this.environmentService);
		if (typeof currentVisibilityValue !== 'string') {
			currentVisibilityValue = 'default';
		}

		let newVisibilityValue: string;
		if (currentVisibilityValue === 'visible' || currentVisibilityValue === 'default') {
			newVisibilityValue = 'toggle';
		} else if (currentVisibilityValue === 'compact') {
			newVisibilityValue = 'hidden';
		} else {
			newVisibilityValue = (isWeb && currentVisibilityValue === 'hidden') ? 'compact' : 'default';
		}

		return this.configurationService.updateValue(ToggleMenuBarAction.menuBarVisibilityKey, newVisibilityValue, ConfigurationTarget.USER);
	}
}

if (isWindows || isLinux || isWeb) {
	registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleMenuBarAction), 'View: Toggle Menu Bar', viewCategory.value);
}

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '2_workbench_layout',
	command: {
		id: ToggleMenuBarAction.ID,
		title: nls.localize({ key: 'miShowMenuBar', comment: ['&& denotes a mnemonic'] }, "Show Menu &&Bar"),
		toggled: ContextKeyExpr.and(IsMacNativeContext.toNegated(), ContextKeyExpr.notEquals('config.window.menuBarVisibility', 'hidden'), ContextKeyExpr.notEquals('config.window.menuBarVisibility', 'toggle'))
	},
	when: IsMacNativeContext.toNegated(),
	order: 0
});

// --- Reset View Positions

export class ResetViewLocationsAction extends Action {
	static readonly ID = 'workbench.action.resetViewLocations';
	static readonly LABEL = nls.localize('resetViewLocations', "Reset View Locations");

	constructor(
		id: string,
		label: string,
		@IViewDescriptorService private viewDescriptorService: IViewDescriptorService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		this.viewDescriptorService.viewContainers.forEach(viewContainer => {
			const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);

			viewContainerModel.allViewDescriptors.forEach(viewDescriptor => {
				const defaultContainer = this.viewDescriptorService.getDefaultContainerById(viewDescriptor.id);
				const currentContainer = this.viewDescriptorService.getViewContainerByViewId(viewDescriptor.id);

				if (defaultContainer && currentContainer !== defaultContainer) {
					this.viewDescriptorService.moveViewsToContainer([viewDescriptor], defaultContainer);
				}
			});

			const defaultContainerLocation = this.viewDescriptorService.getDefaultViewContainerLocation(viewContainer);
			const currentContainerLocation = this.viewDescriptorService.getViewContainerLocation(viewContainer);
			if (defaultContainerLocation !== null && currentContainerLocation !== defaultContainerLocation) {
				this.viewDescriptorService.moveViewContainerToLocation(viewContainer, defaultContainerLocation);
			}
		});
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ResetViewLocationsAction), 'View: Reset View Locations', viewCategory.value);

// --- Toggle View with Command
export abstract class ToggleViewAction extends Action {

	constructor(
		id: string,
		label: string,
		private readonly viewId: string,
		protected viewsService: IViewsService,
		protected viewDescriptorService: IViewDescriptorService,
		protected contextKeyService: IContextKeyService,
		private layoutService: IWorkbenchLayoutService,
		cssClass?: string
	) {
		super(id, label, cssClass);
	}

	async run(): Promise<void> {
		const focusedViewId = FocusedViewContext.getValue(this.contextKeyService);

		if (focusedViewId === this.viewId) {
			if (this.viewDescriptorService.getViewLocationById(this.viewId) === ViewContainerLocation.Sidebar) {
				this.layoutService.setSideBarHidden(true);
			} else {
				this.layoutService.setPanelHidden(true);
			}
		} else {
			this.viewsService.openView(this.viewId, true);
		}
	}
}

// --- Move View with Command
export class MoveViewAction extends Action {
	static readonly ID = 'workbench.action.moveView';
	static readonly LABEL = nls.localize('moveView', "Move View");

	constructor(
		id: string,
		label: string,
		@IViewDescriptorService private viewDescriptorService: IViewDescriptorService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IQuickInputService private quickInputService: IQuickInputService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IActivityBarService private activityBarService: IActivityBarService,
		@IPanelService private panelService: IPanelService
	) {
		super(id, label);
	}

	private getViewItems(): Array<IQuickPickItem | IQuickPickSeparator> {
		const results: Array<IQuickPickItem | IQuickPickSeparator> = [];

		const viewlets = this.activityBarService.getVisibleViewContainerIds();
		viewlets.forEach(viewletId => {
			const container = this.viewDescriptorService.getViewContainerById(viewletId)!;
			const containerModel = this.viewDescriptorService.getViewContainerModel(container);

			let hasAddedView = false;
			containerModel.visibleViewDescriptors.forEach(viewDescriptor => {
				if (viewDescriptor.canMoveView) {
					if (!hasAddedView) {
						results.push({
							type: 'separator',
							label: nls.localize('sidebarContainer', "Side Bar / {0}", containerModel.title)
						});
						hasAddedView = true;
					}

					results.push({
						id: viewDescriptor.id,
						label: viewDescriptor.name
					});
				}
			});
		});

		const panels = this.panelService.getPinnedPanels();
		panels.forEach(panel => {
			const container = this.viewDescriptorService.getViewContainerById(panel.id)!;
			const containerModel = this.viewDescriptorService.getViewContainerModel(container);

			let hasAddedView = false;
			containerModel.visibleViewDescriptors.forEach(viewDescriptor => {
				if (viewDescriptor.canMoveView) {
					if (!hasAddedView) {
						results.push({
							type: 'separator',
							label: nls.localize('panelContainer', "Panel / {0}", containerModel.title)
						});
						hasAddedView = true;
					}

					results.push({
						id: viewDescriptor.id,
						label: viewDescriptor.name
					});
				}
			});
		});

		return results;
	}

	private async getView(viewId?: string): Promise<string> {
		const quickPick = this.quickInputService.createQuickPick();
		quickPick.placeholder = nls.localize('moveFocusedView.selectView', "Select a View to Move");
		quickPick.items = this.getViewItems();
		quickPick.selectedItems = quickPick.items.filter(item => (item as IQuickPickItem).id === viewId) as IQuickPickItem[];

		return new Promise((resolve, reject) => {
			quickPick.onDidAccept(() => {
				const viewId = quickPick.selectedItems[0];
				resolve(viewId.id);
				quickPick.hide();
			});

			quickPick.onDidHide(() => reject());

			quickPick.show();
		});
	}

	async run(): Promise<void> {
		const focusedViewId = FocusedViewContext.getValue(this.contextKeyService);
		let viewId: string;

		if (focusedViewId && this.viewDescriptorService.getViewDescriptorById(focusedViewId)?.canMoveView) {
			viewId = focusedViewId;
		}

		viewId = await this.getView(viewId!);

		if (!viewId) {
			return;
		}

		this.instantiationService.createInstance(MoveFocusedViewAction, MoveFocusedViewAction.ID, MoveFocusedViewAction.LABEL).run(viewId);
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveViewAction), 'View: Move View', viewCategory.value);

// --- Move Focused View with Command
export class MoveFocusedViewAction extends Action {
	static readonly ID = 'workbench.action.moveFocusedView';
	static readonly LABEL = nls.localize('moveFocusedView', "Move Focused View");

	constructor(
		id: string,
		label: string,
		@IViewDescriptorService private viewDescriptorService: IViewDescriptorService,
		@IViewsService private viewsService: IViewsService,
		@IQuickInputService private quickInputService: IQuickInputService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@INotificationService private notificationService: INotificationService,
		@IActivityBarService private activityBarService: IActivityBarService,
		@IPanelService private panelService: IPanelService
	) {
		super(id, label);
	}

	async run(viewId: string): Promise<void> {
		const focusedViewId = viewId || FocusedViewContext.getValue(this.contextKeyService);

		if (focusedViewId === undefined || focusedViewId.trim() === '') {
			this.notificationService.error(nls.localize('moveFocusedView.error.noFocusedView', "There is no view currently focused."));
			return;
		}

		const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(focusedViewId);
		if (!viewDescriptor || !viewDescriptor.canMoveView) {
			this.notificationService.error(nls.localize('moveFocusedView.error.nonMovableView', "The currently focused view is not movable."));
			return;
		}

		const quickPick = this.quickInputService.createQuickPick();
		quickPick.placeholder = nls.localize('moveFocusedView.selectDestination', "Select a Destination for the View");
		quickPick.title = nls.localize({ key: 'moveFocusedView.title', comment: ['{0} indicates the title of the view the user has selected to move.'] }, "View: Move {0}", viewDescriptor.name);

		const items: Array<IQuickPickItem | IQuickPickSeparator> = [];
		const currentContainer = this.viewDescriptorService.getViewContainerByViewId(focusedViewId)!;
		const currentLocation = this.viewDescriptorService.getViewLocationById(focusedViewId)!;
		const isViewSolo = this.viewDescriptorService.getViewContainerModel(currentContainer).allViewDescriptors.length === 1;

		if (!(isViewSolo && currentLocation === ViewContainerLocation.Panel)) {
			items.push({
				id: '_.panel.newcontainer',
				label: nls.localize({ key: 'moveFocusedView.newContainerInPanel', comment: ['Creates a new top-level tab in the panel.'] }, "New Panel Entry"),
			});
		}

		if (!(isViewSolo && currentLocation === ViewContainerLocation.Sidebar)) {
			items.push({
				id: '_.sidebar.newcontainer',
				label: nls.localize('moveFocusedView.newContainerInSidebar', "New Side Bar Entry")
			});
		}

		items.push({
			type: 'separator',
			label: nls.localize('sidebar', "Side Bar")
		});

		const pinnedViewlets = this.activityBarService.getVisibleViewContainerIds();
		items.push(...pinnedViewlets
			.filter(viewletId => {
				if (viewletId === this.viewDescriptorService.getViewContainerByViewId(focusedViewId)!.id) {
					return false;
				}

				return !this.viewDescriptorService.getViewContainerById(viewletId)!.rejectAddedViews;
			})
			.map(viewletId => {
				return {
					id: viewletId,
					label: this.viewDescriptorService.getViewContainerById(viewletId)!.name
				};
			}));

		items.push({
			type: 'separator',
			label: nls.localize('panel', "Panel")
		});

		const pinnedPanels = this.panelService.getPinnedPanels();
		items.push(...pinnedPanels
			.filter(panel => {
				if (panel.id === this.viewDescriptorService.getViewContainerByViewId(focusedViewId)!.id) {
					return false;
				}

				return !this.viewDescriptorService.getViewContainerById(panel.id)!.rejectAddedViews;
			})
			.map(panel => {
				return {
					id: panel.id,
					label: this.viewDescriptorService.getViewContainerById(panel.id)!.name
				};
			}));

		quickPick.items = items;

		quickPick.onDidAccept(() => {
			const destination = quickPick.selectedItems[0];

			if (destination.id === '_.panel.newcontainer') {
				this.viewDescriptorService.moveViewToLocation(viewDescriptor!, ViewContainerLocation.Panel);
				this.viewsService.openView(focusedViewId, true);
			} else if (destination.id === '_.sidebar.newcontainer') {
				this.viewDescriptorService.moveViewToLocation(viewDescriptor!, ViewContainerLocation.Sidebar);
				this.viewsService.openView(focusedViewId, true);
			} else if (destination.id) {
				this.viewDescriptorService.moveViewsToContainer([viewDescriptor], this.viewDescriptorService.getViewContainerById(destination.id)!);
				this.viewsService.openView(focusedViewId, true);
			}

			quickPick.hide();
		});

		quickPick.show();
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveFocusedViewAction), 'View: Move Focused View', viewCategory.value, FocusedViewContext.notEqualsTo(''));


// --- Reset View Location with Command
export class ResetFocusedViewLocationAction extends Action {
	static readonly ID = 'workbench.action.resetFocusedViewLocation';
	static readonly LABEL = nls.localize('resetFocusedViewLocation', "Reset Focused View Location");

	constructor(
		id: string,
		label: string,
		@IViewDescriptorService private viewDescriptorService: IViewDescriptorService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@INotificationService private notificationService: INotificationService,
		@IViewsService private viewsService: IViewsService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const focusedViewId = FocusedViewContext.getValue(this.contextKeyService);

		let viewDescriptor: IViewDescriptor | null = null;
		if (focusedViewId !== undefined && focusedViewId.trim() !== '') {
			viewDescriptor = this.viewDescriptorService.getViewDescriptorById(focusedViewId);
		}

		if (!viewDescriptor) {
			this.notificationService.error(nls.localize('resetFocusedView.error.noFocusedView', "There is no view currently focused."));
			return;
		}

		const defaultContainer = this.viewDescriptorService.getDefaultContainerById(viewDescriptor.id);
		if (!defaultContainer || defaultContainer === this.viewDescriptorService.getViewContainerByViewId(viewDescriptor.id)) {
			return;
		}

		this.viewDescriptorService.moveViewsToContainer([viewDescriptor], defaultContainer);
		this.viewsService.openView(viewDescriptor.id, true);

	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(ResetFocusedViewLocationAction), 'View: Reset Focused View Location', viewCategory.value, FocusedViewContext.notEqualsTo(''));


// --- Resize View

export abstract class BaseResizeViewAction extends Action {

	protected static readonly RESIZE_INCREMENT = 6.5; // This is a media-size percentage

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService protected layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	protected resizePart(sizeChange: number): void {
		const isEditorFocus = this.layoutService.hasFocus(Parts.EDITOR_PART);
		const isSidebarFocus = this.layoutService.hasFocus(Parts.SIDEBAR_PART);
		const isPanelFocus = this.layoutService.hasFocus(Parts.PANEL_PART);

		let part: Parts | undefined;
		if (isSidebarFocus) {
			part = Parts.SIDEBAR_PART;
		} else if (isPanelFocus) {
			part = Parts.PANEL_PART;
		} else if (isEditorFocus) {
			part = Parts.EDITOR_PART;
		}

		if (part) {
			this.layoutService.resizePart(part, sizeChange);
		}
	}
}

export class IncreaseViewSizeAction extends BaseResizeViewAction {

	static readonly ID = 'workbench.action.increaseViewSize';
	static readonly LABEL = nls.localize('increaseViewSize', "Increase Current View Size");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super(id, label, layoutService);
	}

	async run(): Promise<void> {
		this.resizePart(BaseResizeViewAction.RESIZE_INCREMENT);
	}
}

export class DecreaseViewSizeAction extends BaseResizeViewAction {

	static readonly ID = 'workbench.action.decreaseViewSize';
	static readonly LABEL = nls.localize('decreaseViewSize', "Decrease Current View Size");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService

	) {
		super(id, label, layoutService);
	}

	async run(): Promise<void> {
		this.resizePart(-BaseResizeViewAction.RESIZE_INCREMENT);
	}
}

registry.registerWorkbenchAction(SyncActionDescriptor.from(IncreaseViewSizeAction, undefined), 'View: Increase Current View Size', viewCategory.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(DecreaseViewSizeAction, undefined), 'View: Decrease Current View Size', viewCategory.value);
