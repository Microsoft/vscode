/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Registry } from 'vs/platform/registry/common/platform';
import { Action, IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { CompositeDescriptor, CompositeRegistry } from 'vs/workbench/browser/composite';
import { IConstructorSignature0, IInstantiationService, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { ToggleSidebarVisibilityAction, ToggleSidebarPositionAction } from 'vs/workbench/browser/actions/layoutActions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { URI } from 'vs/base/common/uri';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { AsyncDataTree } from 'vs/base/browser/ui/tree/asyncDataTree';
import { AbstractTree } from 'vs/base/browser/ui/tree/abstractTree';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PaneComposite } from 'vs/workbench/browser/panecomposite';
import { Event } from 'vs/base/common/event';

export abstract class Viewlet extends PaneComposite implements IViewlet {

	constructor(id: string,
		viewPaneContainer: ViewPaneContainer,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService protected storageService: IStorageService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IExtensionService protected extensionService: IExtensionService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IWorkbenchLayoutService protected layoutService: IWorkbenchLayoutService,
		@IConfigurationService protected configurationService: IConfigurationService
	) {
		super(id, viewPaneContainer, telemetryService, storageService, instantiationService, themeService, contextMenuService, extensionService, contextService);
		this._register(Event.any(viewPaneContainer.onDidAddViews, viewPaneContainer.onDidRemoveViews, viewPaneContainer.onTitleAreaUpdate)(() => {
			// Update title area since there is no better way to update secondary actions
			this.updateTitleArea();
		}));
	}

	getContextMenuActions(): IAction[] {
		const parentActions = [...super.getContextMenuActions()];
		if (parentActions.length) {
			parentActions.push(new Separator());
		}

		const toggleSidebarPositionAction = new ToggleSidebarPositionAction(ToggleSidebarPositionAction.ID, ToggleSidebarPositionAction.getLabel(this.layoutService), this.layoutService, this.configurationService);
		return [...parentActions, toggleSidebarPositionAction,
		<IAction>{
			id: ToggleSidebarVisibilityAction.ID,
			label: nls.localize('compositePart.hideSideBarLabel', "Hide Side Bar"),
			enabled: true,
			run: () => this.layoutService.setSideBarHidden(true)
		}];
	}

	getSecondaryActions(): IAction[] {
		const viewVisibilityActions = this.viewPaneContainer.getViewsVisibilityActions();
		const secondaryActions = this.viewPaneContainer.getSecondaryActions();
		if (viewVisibilityActions.length <= 1 || viewVisibilityActions.every(({ enabled }) => !enabled)) {
			return secondaryActions;
		}

		if (secondaryActions.length === 0) {
			return viewVisibilityActions;
		}

		return [
			new SubmenuAction('workbench.views', nls.localize('views', "Views"), viewVisibilityActions),
			new Separator(),
			...secondaryActions
		];
	}
}

/**
 * A viewlet descriptor is a leightweight descriptor of a viewlet in the workbench.
 */
export class ViewletDescriptor extends CompositeDescriptor<Viewlet> {

	static create<Services extends BrandedService[]>(
		ctor: { new(...services: Services): Viewlet },
		id: string,
		name: string,
		cssClass?: string,
		order?: number,
		requestedIndex?: number,
		iconUrl?: URI
	): ViewletDescriptor {

		return new ViewletDescriptor(ctor as IConstructorSignature0<Viewlet>, id, name, cssClass, order, requestedIndex, iconUrl);
	}

	private constructor(
		ctor: IConstructorSignature0<Viewlet>,
		id: string,
		name: string,
		cssClass?: string,
		order?: number,
		requestedIndex?: number,
		readonly iconUrl?: URI
	) {
		super(ctor, id, name, cssClass, order, requestedIndex, id);
	}
}

export const Extensions = {
	Viewlets: 'workbench.contributions.viewlets'
};

export class ViewletRegistry extends CompositeRegistry<Viewlet> {

	/**
	 * Registers a viewlet to the platform.
	 */
	registerViewlet(descriptor: ViewletDescriptor): void {
		super.registerComposite(descriptor);
	}

	/**
	 * Deregisters a viewlet to the platform.
	 */
	deregisterViewlet(id: string): void {
		super.deregisterComposite(id);
	}

	/**
	 * Returns the viewlet descriptor for the given id or null if none.
	 */
	getViewlet(id: string): ViewletDescriptor {
		return this.getComposite(id) as ViewletDescriptor;
	}

	/**
	 * Returns an array of registered viewlets known to the platform.
	 */
	getViewlets(): ViewletDescriptor[] {
		return this.getComposites() as ViewletDescriptor[];
	}

}

Registry.add(Extensions.Viewlets, new ViewletRegistry());

/**
 * A reusable action to show a viewlet with a specific id.
 */
export class ShowViewletAction extends Action {

	constructor(
		id: string,
		name: string,
		private readonly viewletId: string,
		@IViewletService protected viewletService: IViewletService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(id, name);
	}

	async run(): Promise<void> {

		// Pass focus to viewlet if not open or focused
		if (this.otherViewletShowing() || !this.sidebarHasFocus()) {
			await this.viewletService.openViewlet(this.viewletId, true);
			return;
		}

		// Otherwise pass focus to editor group
		this.editorGroupService.activeGroup.focus();
	}

	private otherViewletShowing(): boolean {
		const activeViewlet = this.viewletService.getActiveViewlet();

		return !activeViewlet || activeViewlet.getId() !== this.viewletId;
	}

	private sidebarHasFocus(): boolean {
		const activeViewlet = this.viewletService.getActiveViewlet();
		const activeElement = document.activeElement;
		const sidebarPart = this.layoutService.getContainer(Parts.SIDEBAR_PART);

		return !!(activeViewlet && activeElement && sidebarPart && DOM.isAncestor(activeElement, sidebarPart));
	}
}

export class CollapseAction extends Action {
	// We need a tree getter because the action is sometimes instantiated too early
	constructor(treeGetter: () => AsyncDataTree<any, any, any> | AbstractTree<any, any, any>, enabled: boolean, clazz?: string) {
		super('workbench.action.collapse', nls.localize('collapse', "Collapse All"), clazz, enabled, async () => {
			const tree = treeGetter();
			tree.collapseAll();
		});
	}
}
