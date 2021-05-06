/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import Severity from 'vs/base/common/severity';
import { MenuId, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService, Parts, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { isWindows, isLinux, isWeb } from 'vs/base/common/platform';
import { IsMacNativeContext } from 'vs/platform/contextkey/common/contextkeys';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { InEditorZenModeContext, IsCenteredLayoutContext, EditorAreaVisibleContext } from 'vs/workbench/common/editor';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SideBarVisibleContext } from 'vs/workbench/common/viewlet';
import { IViewDescriptorService, IViewsService, FocusedViewContext, ViewContainerLocation, IViewDescriptor, ViewContainerLocationToString } from 'vs/workbench/common/views';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';

// --- Close Side Bar

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.closeSidebar',
			title: { value: localize('closeSidebar', "Close Side Bar"), original: 'Close Side Bar' },
			category: CATEGORIES.View,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchLayoutService).setSideBarHidden(true);
	}
});

// --- Toggle Activity Bar

export class ToggleActivityBarVisibilityAction extends Action2 {

	static readonly ID = 'workbench.action.toggleActivityBarVisibility';

	private static readonly activityBarVisibleKey = 'workbench.activityBar.visible';

	constructor() {
		super({
			id: ToggleActivityBarVisibilityAction.ID,
			title: {
				value: localize('toggleActivityBar', "Toggle Activity Bar Visibility"),
				mnemonicTitle: localize({ key: 'miShowActivityBar', comment: ['&& denotes a mnemonic'] }, "Show &&Activity Bar"),
				original: 'Toggle Activity Bar Visibility'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: ContextKeyExpr.equals('config.workbench.activityBar.visible', true),
			menu: {
				id: MenuId.MenubarAppearanceMenu,
				group: '2_workbench_layout',
				order: 4
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const configurationService = accessor.get(IConfigurationService);

		const visibility = layoutService.isVisible(Parts.ACTIVITYBAR_PART);
		const newVisibilityValue = !visibility;

		configurationService.updateValue(ToggleActivityBarVisibilityAction.activityBarVisibleKey, newVisibilityValue);
	}
}

registerAction2(ToggleActivityBarVisibilityAction);

// --- Toggle Centered Layout

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.toggleCenteredLayout',
			title: {
				value: localize('toggleCenteredLayout', "Toggle Centered Layout"),
				mnemonicTitle: localize({ key: 'miToggleCenteredLayout', comment: ['&& denotes a mnemonic'] }, "&&Centered Layout"),
				original: 'Toggle Centered Layout'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: IsCenteredLayoutContext,
			menu: {
				id: MenuId.MenubarAppearanceMenu,
				group: '1_toggle_view',
				order: 3
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);

		layoutService.centerEditorLayout(!layoutService.isEditorLayoutCentered());
	}
});

// --- Toggle Sidebar Position

export class ToggleSidebarPositionAction extends Action2 {

	static readonly ID = 'workbench.action.toggleSidebarPosition';
	static readonly LABEL = localize('toggleSidebarPosition', "Toggle Side Bar Position");

	private static readonly sidebarPositionConfigurationKey = 'workbench.sideBar.location';

	static getLabel(layoutService: IWorkbenchLayoutService): string {
		return layoutService.getSideBarPosition() === Position.LEFT ? localize('moveSidebarRight', "Move Side Bar Right") : localize('moveSidebarLeft', "Move Side Bar Left");
	}

	constructor() {
		super({
			id: ToggleSidebarPositionAction.ID,
			title: { value: localize('toggleSidebarPosition', "Toggle Side Bar Position"), original: 'Toggle Side Bar Position' },
			category: CATEGORIES.View,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const configurationService = accessor.get(IConfigurationService);

		const position = layoutService.getSideBarPosition();
		const newPositionValue = (position === Position.LEFT) ? 'right' : 'left';

		return configurationService.updateValue(ToggleSidebarPositionAction.sidebarPositionConfigurationKey, newPositionValue);
	}
}

registerAction2(ToggleSidebarPositionAction);

MenuRegistry.appendMenuItems([{
	id: MenuId.ViewContainerTitleContext,
	item: {
		group: '3_workbench_layout_move',
		command: {
			id: ToggleSidebarPositionAction.ID,
			title: localize('move sidebar right', "Move Side Bar Right")
		},
		when: ContextKeyExpr.and(ContextKeyExpr.notEquals('config.workbench.sideBar.location', 'right'), ContextKeyExpr.equals('viewContainerLocation', ViewContainerLocationToString(ViewContainerLocation.Sidebar))),
		order: 1
	}
}, {
	id: MenuId.ViewTitleContext,
	item: {
		group: '3_workbench_layout_move',
		command: {
			id: ToggleSidebarPositionAction.ID,
			title: localize('move sidebar right', "Move Side Bar Right")
		},
		when: ContextKeyExpr.and(ContextKeyExpr.notEquals('config.workbench.sideBar.location', 'right'), ContextKeyExpr.equals('viewLocation', ViewContainerLocationToString(ViewContainerLocation.Sidebar))),
		order: 1
	}
}, {
	id: MenuId.ViewContainerTitleContext,
	item: {
		group: '3_workbench_layout_move',
		command: {
			id: ToggleSidebarPositionAction.ID,
			title: localize('move sidebar left', "Move Side Bar Left")
		},
		when: ContextKeyExpr.and(ContextKeyExpr.equals('config.workbench.sideBar.location', 'right'), ContextKeyExpr.equals('viewContainerLocation', ViewContainerLocationToString(ViewContainerLocation.Sidebar))),
		order: 1
	}
}, {
	id: MenuId.ViewTitleContext,
	item: {
		group: '3_workbench_layout_move',
		command: {
			id: ToggleSidebarPositionAction.ID,
			title: localize('move sidebar left', "Move Side Bar Left")
		},
		when: ContextKeyExpr.and(ContextKeyExpr.equals('config.workbench.sideBar.location', 'right'), ContextKeyExpr.equals('viewLocation', ViewContainerLocationToString(ViewContainerLocation.Sidebar))),
		order: 1
	}
}]);

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '3_workbench_layout_move',
	command: {
		id: ToggleSidebarPositionAction.ID,
		title: localize({ key: 'miMoveSidebarRight', comment: ['&& denotes a mnemonic'] }, "&&Move Side Bar Right")
	},
	when: ContextKeyExpr.notEquals('config.workbench.sideBar.location', 'right'),
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '3_workbench_layout_move',
	command: {
		id: ToggleSidebarPositionAction.ID,
		title: localize({ key: 'miMoveSidebarLeft', comment: ['&& denotes a mnemonic'] }, "&&Move Side Bar Left")
	},
	when: ContextKeyExpr.equals('config.workbench.sideBar.location', 'right'),
	order: 2
});

// --- Toggle Editor Visibility

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.toggleEditorVisibility',
			title: {
				value: localize('toggleEditor', "Toggle Editor Area Visibility"),
				mnemonicTitle: localize({ key: 'miShowEditorArea', comment: ['&& denotes a mnemonic'] }, "Show &&Editor Area"),
				original: 'Toggle Editor Area Visibility'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: EditorAreaVisibleContext,
			menu: {
				id: MenuId.MenubarAppearanceMenu,
				group: '2_workbench_layout',
				order: 5
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IWorkbenchLayoutService).toggleMaximizedPanel();
	}
});

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '2_appearance',
	title: localize({ key: 'miAppearance', comment: ['&& denotes a mnemonic'] }, "&&Appearance"),
	submenu: MenuId.MenubarAppearanceMenu,
	order: 1
});

// Toggle Sidebar Visibility

class ToggleSidebarVisibilityAction extends Action2 {

	static readonly ID = 'workbench.action.toggleSidebarVisibility';

	constructor() {
		super({
			id: ToggleSidebarVisibilityAction.ID,
			title: { value: localize('toggleSidebar', "Toggle Side Bar Visibility"), original: 'Toggle Side Bar Visibility' },
			category: CATEGORIES.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_B
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);

		layoutService.setSideBarHidden(layoutService.isVisible(Parts.SIDEBAR_PART));
	}
}

registerAction2(ToggleSidebarVisibilityAction);

MenuRegistry.appendMenuItems([{
	id: MenuId.ViewContainerTitleContext,
	item: {
		group: '3_workbench_layout_move',
		command: {
			id: ToggleSidebarVisibilityAction.ID,
			title: localize('compositePart.hideSideBarLabel', "Hide Side Bar"),
		},
		when: ContextKeyExpr.and(SideBarVisibleContext, ContextKeyExpr.equals('viewContainerLocation', ViewContainerLocationToString(ViewContainerLocation.Sidebar))),
		order: 2
	}
}, {
	id: MenuId.ViewTitleContext,
	item: {
		group: '3_workbench_layout_move',
		command: {
			id: ToggleSidebarVisibilityAction.ID,
			title: localize('compositePart.hideSideBarLabel', "Hide Side Bar"),
		},
		when: ContextKeyExpr.and(SideBarVisibleContext, ContextKeyExpr.equals('viewLocation', ViewContainerLocationToString(ViewContainerLocation.Sidebar))),
		order: 2
	}
}, {
	id: MenuId.MenubarAppearanceMenu,
	item: {
		group: '2_workbench_layout',
		command: {
			id: ToggleSidebarVisibilityAction.ID,
			title: localize({ key: 'miShowSidebar', comment: ['&& denotes a mnemonic'] }, "Show &&Side Bar"),
			toggled: SideBarVisibleContext
		},
		order: 1
	}
}]);

// --- Toggle Statusbar Visibility

export class ToggleStatusbarVisibilityAction extends Action2 {

	static readonly ID = 'workbench.action.toggleStatusbarVisibility';

	private static readonly statusbarVisibleKey = 'workbench.statusBar.visible';

	constructor() {
		super({
			id: ToggleStatusbarVisibilityAction.ID,
			title: {
				value: localize('toggleStatusbar', "Toggle Status Bar Visibility"),
				mnemonicTitle: localize({ key: 'miShowStatusbar', comment: ['&& denotes a mnemonic'] }, "Show S&&tatus Bar"),
				original: 'Toggle Status Bar Visibility'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: ContextKeyExpr.equals('config.workbench.statusBar.visible', true),
			menu: {
				id: MenuId.MenubarAppearanceMenu,
				group: '2_workbench_layout',
				order: 3
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const configurationService = accessor.get(IConfigurationService);

		const visibility = layoutService.isVisible(Parts.STATUSBAR_PART);
		const newVisibilityValue = !visibility;

		return configurationService.updateValue(ToggleStatusbarVisibilityAction.statusbarVisibleKey, newVisibilityValue);
	}
}

registerAction2(ToggleStatusbarVisibilityAction);

// --- Toggle Tabs Visibility

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.toggleTabsVisibility',
			title: {
				value: localize('toggleTabs', "Toggle Tab Visibility"),
				original: 'Toggle Tab Visibility'
			},
			category: CATEGORIES.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: undefined,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_W, },
				linux: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_W, }
			}
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);

		const visibility = configurationService.getValue<string>('workbench.editor.showTabs');
		const newVisibilityValue = !visibility;

		return configurationService.updateValue('workbench.editor.showTabs', newVisibilityValue);
	}
});

// --- Toggle Zen Mode

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.toggleZenMode',
			title: {
				value: localize('toggleZenMode', "Toggle Zen Mode"),
				mnemonicTitle: localize('miToggleZenMode', "Zen Mode"),
				original: 'Toggle Zen Mode'
			},
			category: CATEGORIES.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_Z)
			},
			toggled: InEditorZenModeContext,
			menu: {
				id: MenuId.MenubarAppearanceMenu,
				group: '1_toggle_view',
				order: 2
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		return accessor.get(IWorkbenchLayoutService).toggleZenMode();
	}
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

if (isWindows || isLinux || isWeb) {
	registerAction2(class extends Action2 {

		constructor() {
			super({
				id: 'workbench.action.toggleMenuBar',
				title: {
					value: localize('toggleMenuBar', "Toggle Menu Bar"),
					mnemonicTitle: localize({ key: 'miShowMenuBar', comment: ['&& denotes a mnemonic'] }, "Show Menu &&Bar"),
					original: 'Toggle Menu Bar'
				},
				category: CATEGORIES.View,
				f1: true,
				toggled: ContextKeyExpr.and(IsMacNativeContext.toNegated(), ContextKeyExpr.notEquals('config.window.menuBarVisibility', 'hidden'), ContextKeyExpr.notEquals('config.window.menuBarVisibility', 'toggle'), ContextKeyExpr.notEquals('config.window.menuBarVisibility', 'compact')),
				menu: {
					id: MenuId.MenubarAppearanceMenu,
					group: '2_workbench_layout',
					order: 0
				}
			});
		}

		run(accessor: ServicesAccessor): void {
			return accessor.get(IWorkbenchLayoutService).toggleMenuBar();
		}
	});
}

// --- Reset View Locations

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.resetViewLocations',
			title: {
				value: localize('resetViewLocations', "Reset View Locations"),
				original: 'Reset View Locations'
			},
			category: CATEGORIES.View,
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		return accessor.get(IViewDescriptorService).reset();
	}
});

// --- Move View

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.moveView',
			title: {
				value: localize('moveView', "Move View"),
				original: 'Move View'
			},
			category: CATEGORIES.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const instantiationService = accessor.get(IInstantiationService);
		const quickInputService = accessor.get(IQuickInputService);
		const contextKeyService = accessor.get(IContextKeyService);
		const activityBarService = accessor.get(IActivityBarService);
		const panelService = accessor.get(IPanelService);

		const focusedViewId = FocusedViewContext.getValue(contextKeyService);
		let viewId: string;

		if (focusedViewId && viewDescriptorService.getViewDescriptorById(focusedViewId)?.canMoveView) {
			viewId = focusedViewId;
		}

		viewId = await this.getView(quickInputService, activityBarService, viewDescriptorService, panelService, viewId!);

		if (!viewId) {
			return;
		}

		const moveFocusedViewAction = new MoveFocusedViewAction();
		instantiationService.invokeFunction(accessor => moveFocusedViewAction.run(accessor, viewId));
	}

	private getViewItems(activityBarService: IActivityBarService, viewDescriptorService: IViewDescriptorService, panelService: IPanelService): Array<IQuickPickItem | IQuickPickSeparator> {
		const results: Array<IQuickPickItem | IQuickPickSeparator> = [];

		const viewlets = activityBarService.getVisibleViewContainerIds();
		viewlets.forEach(viewletId => {
			const container = viewDescriptorService.getViewContainerById(viewletId)!;
			const containerModel = viewDescriptorService.getViewContainerModel(container);

			let hasAddedView = false;
			containerModel.visibleViewDescriptors.forEach(viewDescriptor => {
				if (viewDescriptor.canMoveView) {
					if (!hasAddedView) {
						results.push({
							type: 'separator',
							label: localize('sidebarContainer', "Side Bar / {0}", containerModel.title)
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

		const panels = panelService.getPinnedPanels();
		panels.forEach(panel => {
			const container = viewDescriptorService.getViewContainerById(panel.id)!;
			const containerModel = viewDescriptorService.getViewContainerModel(container);

			let hasAddedView = false;
			containerModel.visibleViewDescriptors.forEach(viewDescriptor => {
				if (viewDescriptor.canMoveView) {
					if (!hasAddedView) {
						results.push({
							type: 'separator',
							label: localize('panelContainer', "Panel / {0}", containerModel.title)
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

	private async getView(quickInputService: IQuickInputService, activityBarService: IActivityBarService, viewDescriptorService: IViewDescriptorService, panelService: IPanelService, viewId?: string): Promise<string> {
		const quickPick = quickInputService.createQuickPick();
		quickPick.placeholder = localize('moveFocusedView.selectView', "Select a View to Move");
		quickPick.items = this.getViewItems(activityBarService, viewDescriptorService, panelService);
		quickPick.selectedItems = quickPick.items.filter(item => (item as IQuickPickItem).id === viewId) as IQuickPickItem[];

		return new Promise((resolve, reject) => {
			quickPick.onDidAccept(() => {
				const viewId = quickPick.selectedItems[0];
				if (viewId.id) {
					resolve(viewId.id);
				} else {
					reject();
				}

				quickPick.hide();
			});

			quickPick.onDidHide(() => reject());

			quickPick.show();
		});
	}
});

// --- Move Focused View

class MoveFocusedViewAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.moveFocusedView',
			title: {
				value: localize('moveFocusedView', "Move Focused View"),
				original: 'Move Focused View'
			},
			category: CATEGORIES.View,
			precondition: FocusedViewContext.notEqualsTo(''),
			f1: true
		});
	}

	run(accessor: ServicesAccessor, viewId?: string): void {
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const viewsService = accessor.get(IViewsService);
		const quickInputService = accessor.get(IQuickInputService);
		const contextKeyService = accessor.get(IContextKeyService);
		const dialogService = accessor.get(IDialogService);
		const activityBarService = accessor.get(IActivityBarService);
		const panelService = accessor.get(IPanelService);

		const focusedViewId = viewId || FocusedViewContext.getValue(contextKeyService);

		if (focusedViewId === undefined || focusedViewId.trim() === '') {
			dialogService.show(Severity.Error, localize('moveFocusedView.error.noFocusedView', "There is no view currently focused."), [localize('ok', 'OK')]);
			return;
		}

		const viewDescriptor = viewDescriptorService.getViewDescriptorById(focusedViewId);
		if (!viewDescriptor || !viewDescriptor.canMoveView) {
			dialogService.show(Severity.Error, localize('moveFocusedView.error.nonMovableView', "The currently focused view is not movable."), [localize('ok', 'OK')]);
			return;
		}

		const quickPick = quickInputService.createQuickPick();
		quickPick.placeholder = localize('moveFocusedView.selectDestination', "Select a Destination for the View");
		quickPick.title = localize({ key: 'moveFocusedView.title', comment: ['{0} indicates the title of the view the user has selected to move.'] }, "View: Move {0}", viewDescriptor.name);

		const items: Array<IQuickPickItem | IQuickPickSeparator> = [];
		const currentContainer = viewDescriptorService.getViewContainerByViewId(focusedViewId)!;
		const currentLocation = viewDescriptorService.getViewLocationById(focusedViewId)!;
		const isViewSolo = viewDescriptorService.getViewContainerModel(currentContainer).allViewDescriptors.length === 1;

		if (!(isViewSolo && currentLocation === ViewContainerLocation.Panel)) {
			items.push({
				id: '_.panel.newcontainer',
				label: localize({ key: 'moveFocusedView.newContainerInPanel', comment: ['Creates a new top-level tab in the panel.'] }, "New Panel Entry"),
			});
		}

		if (!(isViewSolo && currentLocation === ViewContainerLocation.Sidebar)) {
			items.push({
				id: '_.sidebar.newcontainer',
				label: localize('moveFocusedView.newContainerInSidebar', "New Side Bar Entry")
			});
		}

		items.push({
			type: 'separator',
			label: localize('sidebar', "Side Bar")
		});

		const pinnedViewlets = activityBarService.getVisibleViewContainerIds();
		items.push(...pinnedViewlets
			.filter(viewletId => {
				if (viewletId === viewDescriptorService.getViewContainerByViewId(focusedViewId)!.id) {
					return false;
				}

				return !viewDescriptorService.getViewContainerById(viewletId)!.rejectAddedViews;
			})
			.map(viewletId => {
				return {
					id: viewletId,
					label: viewDescriptorService.getViewContainerModel(viewDescriptorService.getViewContainerById(viewletId)!)!.title
				};
			}));

		items.push({
			type: 'separator',
			label: localize('panel', "Panel")
		});

		const pinnedPanels = panelService.getPinnedPanels();
		items.push(...pinnedPanels
			.filter(panel => {
				if (panel.id === viewDescriptorService.getViewContainerByViewId(focusedViewId)!.id) {
					return false;
				}

				return !viewDescriptorService.getViewContainerById(panel.id)!.rejectAddedViews;
			})
			.map(panel => {
				return {
					id: panel.id,
					label: viewDescriptorService.getViewContainerModel(viewDescriptorService.getViewContainerById(panel.id)!)!.title
				};
			}));

		quickPick.items = items;

		quickPick.onDidAccept(() => {
			const destination = quickPick.selectedItems[0];

			if (destination.id === '_.panel.newcontainer') {
				viewDescriptorService.moveViewToLocation(viewDescriptor!, ViewContainerLocation.Panel);
				viewsService.openView(focusedViewId, true);
			} else if (destination.id === '_.sidebar.newcontainer') {
				viewDescriptorService.moveViewToLocation(viewDescriptor!, ViewContainerLocation.Sidebar);
				viewsService.openView(focusedViewId, true);
			} else if (destination.id) {
				viewDescriptorService.moveViewsToContainer([viewDescriptor], viewDescriptorService.getViewContainerById(destination.id)!);
				viewsService.openView(focusedViewId, true);
			}

			quickPick.hide();
		});

		quickPick.show();
	}
}

registerAction2(MoveFocusedViewAction);

// --- Reset Focused View Location

registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.resetFocusedViewLocation',
			title: {
				value: localize('resetFocusedViewLocation', "Reset Focused View Location"),
				original: 'Reset Focused View Location'
			},
			category: CATEGORIES.View,
			f1: true,
			precondition: FocusedViewContext.notEqualsTo('')
		});
	}

	run(accessor: ServicesAccessor): void {
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const contextKeyService = accessor.get(IContextKeyService);
		const dialogService = accessor.get(IDialogService);
		const viewsService = accessor.get(IViewsService);

		const focusedViewId = FocusedViewContext.getValue(contextKeyService);

		let viewDescriptor: IViewDescriptor | null = null;
		if (focusedViewId !== undefined && focusedViewId.trim() !== '') {
			viewDescriptor = viewDescriptorService.getViewDescriptorById(focusedViewId);
		}

		if (!viewDescriptor) {
			dialogService.show(Severity.Error, localize('resetFocusedView.error.noFocusedView', "There is no view currently focused."), [localize('ok', 'OK')]);
			return;
		}

		const defaultContainer = viewDescriptorService.getDefaultContainerById(viewDescriptor.id);
		if (!defaultContainer || defaultContainer === viewDescriptorService.getViewContainerByViewId(viewDescriptor.id)) {
			return;
		}

		viewDescriptorService.moveViewsToContainer([viewDescriptor], defaultContainer);
		viewsService.openView(viewDescriptor.id, true);
	}
});

// --- Resize View

abstract class BaseResizeViewAction extends Action2 {

	protected static readonly RESIZE_INCREMENT = 6.5; // This is a media-size percentage

	protected resizePart(widthChange: number, heightChange: number, layoutService: IWorkbenchLayoutService, partToResize?: Parts): void {

		let part: Parts | undefined;
		if (partToResize === undefined) {
			const isEditorFocus = layoutService.hasFocus(Parts.EDITOR_PART);
			const isSidebarFocus = layoutService.hasFocus(Parts.SIDEBAR_PART);
			const isPanelFocus = layoutService.hasFocus(Parts.PANEL_PART);

			if (isSidebarFocus) {
				part = Parts.SIDEBAR_PART;
			} else if (isPanelFocus) {
				part = Parts.PANEL_PART;
			} else if (isEditorFocus) {
				part = Parts.EDITOR_PART;
			}
		} else {
			part = partToResize;
		}

		if (part) {
			layoutService.resizePart(part, widthChange, heightChange);
		}
	}
}

class IncreaseViewSizeAction extends BaseResizeViewAction {

	constructor() {
		super({
			id: 'workbench.action.increaseViewSize',
			title: { value: localize('increaseViewSize', "Increase Current View Size"), original: 'Increase Current View Size' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		this.resizePart(BaseResizeViewAction.RESIZE_INCREMENT, BaseResizeViewAction.RESIZE_INCREMENT, accessor.get(IWorkbenchLayoutService));
	}
}

class IncreaseViewWidthAction extends BaseResizeViewAction {

	constructor() {
		super({
			id: 'workbench.action.increaseViewWidth',
			title: { value: localize('increaseEditorWidth', "Increase Editor Width"), original: 'Increase Editor Width' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		this.resizePart(BaseResizeViewAction.RESIZE_INCREMENT, 0, accessor.get(IWorkbenchLayoutService), Parts.EDITOR_PART);
	}
}

class IncreaseViewHeightAction extends BaseResizeViewAction {

	constructor() {
		super({
			id: 'workbench.action.increaseViewHeight',
			title: { value: localize('increaseEditorHeight', "Increase Editor Height"), original: 'Increase Editor Height' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		this.resizePart(0, BaseResizeViewAction.RESIZE_INCREMENT, accessor.get(IWorkbenchLayoutService), Parts.EDITOR_PART);
	}
}

class DecreaseViewSizeAction extends BaseResizeViewAction {

	constructor() {
		super({
			id: 'workbench.action.decreaseViewSize',
			title: { value: localize('decreaseViewSize', "Decrease Current View Size"), original: 'Decrease Current View Size' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		this.resizePart(-BaseResizeViewAction.RESIZE_INCREMENT, -BaseResizeViewAction.RESIZE_INCREMENT, accessor.get(IWorkbenchLayoutService));
	}
}

class DecreaseViewWidthAction extends BaseResizeViewAction {
	constructor() {
		super({
			id: 'workbench.action.decreaseViewWidth',
			title: { value: localize('decreaseEditorWidth', "Decrease Editor Width"), original: 'Decrease Editor Width' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		this.resizePart(-BaseResizeViewAction.RESIZE_INCREMENT, 0, accessor.get(IWorkbenchLayoutService), Parts.EDITOR_PART);
	}
}

class DecreaseViewHeightAction extends BaseResizeViewAction {

	constructor() {
		super({
			id: 'workbench.action.decreaseViewHeight',
			title: { value: localize('decreaseEditorHeight', "Decrease Editor Height"), original: 'Decrease Editor Height' },
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		this.resizePart(0, -BaseResizeViewAction.RESIZE_INCREMENT, accessor.get(IWorkbenchLayoutService), Parts.EDITOR_PART);
	}
}

registerAction2(IncreaseViewSizeAction);
registerAction2(IncreaseViewWidthAction);
registerAction2(IncreaseViewHeightAction);

registerAction2(DecreaseViewSizeAction);
registerAction2(DecreaseViewWidthAction);
registerAction2(DecreaseViewHeightAction);
