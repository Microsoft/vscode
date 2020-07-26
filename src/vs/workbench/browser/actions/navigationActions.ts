/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { Action } from 'vs/base/common/actions';
import { IEditorGroupsService, GroupDirection, GroupLocation, IFindGroupScope } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { IPanel } from 'vs/workbench/common/panel';
import { Action2, MenuId, registerAction2, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions } from 'vs/workbench/common/actions';
import { Direction } from 'vs/base/browser/ui/grid/grid';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';

abstract class BaseNavigationAction extends Action {

	constructor(
		id: string,
		label: string,
		protected direction: Direction,
		@IEditorGroupsService protected editorGroupService: IEditorGroupsService,
		@IPanelService protected panelService: IPanelService,
		@IWorkbenchLayoutService protected layoutService: IWorkbenchLayoutService,
		@IViewletService protected viewletService: IViewletService
	) {
		super(id, label);
	}

	async run(): Promise<boolean | IViewlet | IPanel> {
		const isEditorFocus = this.layoutService.hasFocus(Parts.EDITOR_PART);
		const isPanelFocus = this.layoutService.hasFocus(Parts.PANEL_PART);
		const isSidebarFocus = this.layoutService.hasFocus(Parts.SIDEBAR_PART);

		let neighborPart: Parts | undefined;
		if (isEditorFocus) {
			const didNavigate = this.navigateAcrossEditorGroup(this.toGroupDirection(this.direction));
			if (didNavigate) {
				return true;
			}

			neighborPart = this.layoutService.getVisibleNeighborPart(Parts.EDITOR_PART, this.direction);
		}

		if (isPanelFocus) {
			neighborPart = this.layoutService.getVisibleNeighborPart(Parts.PANEL_PART, this.direction);
		}

		if (isSidebarFocus) {
			neighborPart = this.layoutService.getVisibleNeighborPart(Parts.SIDEBAR_PART, this.direction);
		}

		if (neighborPart === Parts.EDITOR_PART) {
			return this.navigateToEditorGroup(this.direction === Direction.Right ? GroupLocation.FIRST : GroupLocation.LAST);
		}

		if (neighborPart === Parts.SIDEBAR_PART) {
			return this.navigateToSidebar();
		}

		if (neighborPart === Parts.PANEL_PART) {
			return this.navigateToPanel();
		}

		return false;
	}

	private async navigateToPanel(): Promise<IPanel | boolean> {
		if (!this.layoutService.isVisible(Parts.PANEL_PART)) {
			return false;
		}

		const activePanel = this.panelService.getActivePanel();
		if (!activePanel) {
			return false;
		}

		const activePanelId = activePanel.getId();

		const res = await this.panelService.openPanel(activePanelId, true);
		if (!res) {
			return false;
		}

		return res;
	}

	private async navigateToSidebar(): Promise<IViewlet | boolean> {
		if (!this.layoutService.isVisible(Parts.SIDEBAR_PART)) {
			return false;
		}

		const activeViewlet = this.viewletService.getActiveViewlet();
		if (!activeViewlet) {
			return false;
		}
		const activeViewletId = activeViewlet.getId();

		const viewlet = await this.viewletService.openViewlet(activeViewletId, true);
		return !!viewlet;
	}

	private navigateAcrossEditorGroup(direction: GroupDirection): boolean {
		return this.doNavigateToEditorGroup({ direction });
	}

	private navigateToEditorGroup(location: GroupLocation): boolean {
		return this.doNavigateToEditorGroup({ location });
	}

	private toGroupDirection(direction: Direction): GroupDirection {
		switch (direction) {
			case Direction.Down: return GroupDirection.DOWN;
			case Direction.Left: return GroupDirection.LEFT;
			case Direction.Right: return GroupDirection.RIGHT;
			case Direction.Up: return GroupDirection.UP;
		}
	}

	private doNavigateToEditorGroup(scope: IFindGroupScope): boolean {
		const targetGroup = this.editorGroupService.findGroup(scope, this.editorGroupService.activeGroup);
		if (targetGroup) {
			targetGroup.focus();

			return true;
		}

		return false;
	}
}

class NavigateLeftAction extends BaseNavigationAction {

	static readonly ID = 'workbench.action.navigateLeft';
	static readonly LABEL = nls.localize('navigateLeft', "Navigate to the View on the Left");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IPanelService panelService: IPanelService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IViewletService viewletService: IViewletService
	) {
		super(id, label, Direction.Left, editorGroupService, panelService, layoutService, viewletService);
	}
}

class NavigateRightAction extends BaseNavigationAction {

	static readonly ID = 'workbench.action.navigateRight';
	static readonly LABEL = nls.localize('navigateRight', "Navigate to the View on the Right");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IPanelService panelService: IPanelService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IViewletService viewletService: IViewletService
	) {
		super(id, label, Direction.Right, editorGroupService, panelService, layoutService, viewletService);
	}
}

class NavigateUpAction extends BaseNavigationAction {

	static readonly ID = 'workbench.action.navigateUp';
	static readonly LABEL = nls.localize('navigateUp', "Navigate to the View Above");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IPanelService panelService: IPanelService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IViewletService viewletService: IViewletService
	) {
		super(id, label, Direction.Up, editorGroupService, panelService, layoutService, viewletService);
	}
}

class NavigateDownAction extends BaseNavigationAction {

	static readonly ID = 'workbench.action.navigateDown';
	static readonly LABEL = nls.localize('navigateDown', "Navigate to the View Below");

	constructor(
		id: string,
		label: string,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IPanelService panelService: IPanelService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IViewletService viewletService: IViewletService
	) {
		super(id, label, Direction.Down, editorGroupService, panelService, layoutService, viewletService);
	}
}

function findVisibleNeighbour(layoutService: IWorkbenchLayoutService, part: Parts, next: boolean): Parts {
	const neighbour = part === Parts.EDITOR_PART ? (next ? Parts.PANEL_PART : Parts.SIDEBAR_PART) : part === Parts.PANEL_PART ? (next ? Parts.STATUSBAR_PART : Parts.EDITOR_PART) :
		part === Parts.STATUSBAR_PART ? (next ? Parts.ACTIVITYBAR_PART : Parts.PANEL_PART) : part === Parts.ACTIVITYBAR_PART ? (next ? Parts.SIDEBAR_PART : Parts.STATUSBAR_PART) :
			part === Parts.SIDEBAR_PART ? (next ? Parts.EDITOR_PART : Parts.ACTIVITYBAR_PART) : Parts.EDITOR_PART;
	if (layoutService.isVisible(neighbour) || neighbour === Parts.EDITOR_PART) {
		return neighbour;
	}

	return findVisibleNeighbour(layoutService, neighbour, next);
}

function focusNextOrPreviousPart(layoutService: IWorkbenchLayoutService, next: boolean): void {
	const currentlyFocusedPart = layoutService.hasFocus(Parts.EDITOR_PART) ? Parts.EDITOR_PART : layoutService.hasFocus(Parts.ACTIVITYBAR_PART) ? Parts.ACTIVITYBAR_PART :
		layoutService.hasFocus(Parts.STATUSBAR_PART) ? Parts.STATUSBAR_PART : layoutService.hasFocus(Parts.SIDEBAR_PART) ? Parts.SIDEBAR_PART : layoutService.hasFocus(Parts.PANEL_PART) ? Parts.PANEL_PART : undefined;
	let partToFocus = Parts.EDITOR_PART;
	if (currentlyFocusedPart) {
		partToFocus = findVisibleNeighbour(layoutService, currentlyFocusedPart, next);
	}

	layoutService.focusPart(partToFocus);
}

export class FocusNextPart extends Action {
	static readonly ID = 'workbench.action.focusNextPart';
	static readonly LABEL = nls.localize('focusNextPart', "Focus Next Part");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		focusNextOrPreviousPart(this.layoutService, true);
	}
}

export class FocusPreviousPart extends Action {
	static readonly ID = 'workbench.action.focusPreviousPart';
	static readonly LABEL = nls.localize('focusPreviousPart', "Focus Previous Part");

	constructor(
		id: string,
		label: string,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		focusNextOrPreviousPart(this.layoutService, false);
	}
}

class GoHomeContributor implements IWorkbenchContribution {

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService
	) {
		const homeIndicator = environmentService.options?.homeIndicator;
		if (homeIndicator) {
			registerAction2(class extends Action2 {
				constructor() {
					super({
						id: `workbench.actions.goHome`,
						title: nls.localize('goHome', "Go Home"),
						menu: { id: MenuId.MenubarWebNavigationMenu }
					});
				}
				async run(): Promise<void> {
					window.location.href = homeIndicator.href;
				}
			});
		}
	}
}

const actionsRegistry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);
const viewCategory = nls.localize('view', "View");

actionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateUpAction, undefined), 'View: Navigate to the View Above', viewCategory);
actionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateDownAction, undefined), 'View: Navigate to the View Below', viewCategory);
actionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateLeftAction, undefined), 'View: Navigate to the View on the Left', viewCategory);
actionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateRightAction, undefined), 'View: Navigate to the View on the Right', viewCategory);
actionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(FocusNextPart, { primary: KeyCode.F6 }), 'View: Focus Next Part', viewCategory);
actionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(FocusPreviousPart, { primary: KeyMod.Shift | KeyCode.F6 }), 'View: Focus Previous Part', viewCategory);

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(GoHomeContributor, LifecyclePhase.Ready);
