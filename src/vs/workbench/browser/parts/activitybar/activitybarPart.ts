/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/activitybarpart';
import * as nls from 'vs/nls';
import { ActionsOrientation, ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { GLOBAL_ACTIVITY_ID, IActivity } from 'vs/workbench/common/activity';
import { Part } from 'vs/workbench/browser/part';
import { GlobalActivityActionViewItem, ViewContainerActivityAction, PlaceHolderToggleCompositePinnedAction, PlaceHolderViewContainerActivityAction, AccountsActionViewItem, HomeAction } from 'vs/workbench/browser/parts/activitybar/activitybarActions';
import { IBadge, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IWorkbenchLayoutService, Parts, Position as SideBarPosition } from 'vs/workbench/services/layout/browser/layoutService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, toDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { ToggleActivityBarVisibilityAction, ToggleMenuBarAction } from 'vs/workbench/browser/actions/layoutActions';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { ACTIVITY_BAR_BACKGROUND, ACTIVITY_BAR_BORDER, ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_ACTIVE_BORDER, ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, ACTIVITY_BAR_DRAG_AND_DROP_BACKGROUND, ACTIVITY_BAR_INACTIVE_FOREGROUND, ACTIVITY_BAR_ACTIVE_BACKGROUND } from 'vs/workbench/common/theme';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { CompositeBar, ICompositeBarItem, CompositeDragAndDrop } from 'vs/workbench/browser/parts/compositeBar';
import { Dimension, addClass, removeNode, createCSSRule, asCSSUrl } from 'vs/base/browser/dom';
import { IStorageService, StorageScope, IWorkspaceStorageChangeEvent } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ToggleCompositePinnedAction, ICompositeBarColors, ActivityAction, ICompositeActivity } from 'vs/workbench/browser/parts/compositeBarActions';
import { IViewDescriptorService, ViewContainer, TEST_VIEW_CONTAINER_ID, IViewContainerModel, ViewContainerLocation, IViewsService } from 'vs/workbench/common/views';
import { IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { isUndefinedOrNull, assertIsDefined, isString } from 'vs/base/common/types';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Schemas } from 'vs/base/common/network';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { CustomMenubarControl } from 'vs/workbench/browser/parts/titlebar/menubarControl';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { getMenuBarVisibility } from 'vs/platform/windows/common/windows';
import { isWeb } from 'vs/base/common/platform';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { getUserDataSyncStore } from 'vs/platform/userDataSync/common/userDataSync';
import { IProductService } from 'vs/platform/product/common/productService';
import { Before2D } from 'vs/workbench/browser/dnd';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { Action } from 'vs/base/common/actions';
import { Event } from 'vs/base/common/event';

interface IPlaceholderViewContainer {
	id: string;
	name?: string;
	iconUrl?: UriComponents;
	iconCSS?: string;
	views?: { when?: string }[];
}

interface IPinnedViewContainer {
	id: string;
	pinned: boolean;
	order?: number;
	visible: boolean;
}

interface ICachedViewContainer {
	id: string;
	name?: string;
	icon?: URI | string;
	pinned: boolean;
	order?: number;
	visible: boolean;
	views?: { when?: string }[];
}

export class ActivitybarPart extends Part implements IActivityBarService {

	_serviceBrand: undefined;

	private static readonly ACTION_HEIGHT = 48;
	static readonly PINNED_VIEW_CONTAINERS = 'workbench.activity.pinnedViewlets2';
	private static readonly PLACEHOLDER_VIEW_CONTAINERS = 'workbench.activity.placeholderViewlets';

	//#region IView

	readonly minimumWidth: number = 48;
	readonly maximumWidth: number = 48;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	//#endregion

	private content: HTMLElement | undefined;

	private homeBar: ActionBar | undefined;
	private homeBarContainer: HTMLElement | undefined;

	private menuBar: CustomMenubarControl | undefined;
	private menuBarContainer: HTMLElement | undefined;

	private compositeBar: CompositeBar;

	private globalActivityAction: ActivityAction | undefined;
	private globalActivityActionBar: ActionBar | undefined;
	private readonly globalActivity: ICompositeActivity[] = [];

	private readonly cachedViewContainers: ICachedViewContainer[] = [];
	private readonly compositeActions = new Map<string, { activityAction: ViewContainerActivityAction, pinnedAction: ToggleCompositePinnedAction }>();
	private readonly viewContainerDisposables = new Map<string, IDisposable>();

	private readonly location = ViewContainerLocation.Sidebar;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly viewsService: IViewsService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
		@IProductService private readonly productService: IProductService
	) {
		super(Parts.ACTIVITYBAR_PART, { hasTitle: false }, themeService, storageService, layoutService);

		storageKeysSyncRegistryService.registerStorageKey({ key: ActivitybarPart.PINNED_VIEW_CONTAINERS, version: 1 });
		this.migrateFromOldCachedViewContainersValue();

		this.cachedViewContainers = this.getCachedViewContainers();
		for (const cachedViewContainer of this.cachedViewContainers) {
			if (environmentService.configuration.remoteAuthority // In remote window, hide activity bar entries until registered.
				|| this.shouldBeHidden(cachedViewContainer.id, cachedViewContainer)
			) {
				cachedViewContainer.visible = false;
			}
		}

		const cachedItems = this.cachedViewContainers
			.map(v => ({ id: v.id, name: v.name, visible: v.visible, order: v.order, pinned: v.pinned }));
		this.compositeBar = this._register(this.instantiationService.createInstance(CompositeBar, cachedItems, {
			icon: true,
			orientation: ActionsOrientation.VERTICAL,
			openComposite: (compositeId: string) => this.viewsService.openViewContainer(compositeId, true),
			getActivityAction: (compositeId: string) => this.getCompositeActions(compositeId).activityAction,
			getCompositePinnedAction: (compositeId: string) => this.getCompositeActions(compositeId).pinnedAction,
			getOnCompositeClickAction: (compositeId: string) => new Action(compositeId, '', '', true, () => this.viewsService.isViewContainerVisible(compositeId) ? Promise.resolve(this.viewsService.closeViewContainer(compositeId)) : this.viewsService.openViewContainer(compositeId)),
			getContextMenuActions: () => {
				const menuBarVisibility = getMenuBarVisibility(this.configurationService, this.environmentService);
				const actions = [];

				if (menuBarVisibility === 'compact' || (menuBarVisibility === 'hidden' && isWeb)) {
					actions.push(this.instantiationService.createInstance(ToggleMenuBarAction, ToggleMenuBarAction.ID, menuBarVisibility === 'compact' ? nls.localize('hideMenu', "Hide Menu") : nls.localize('showMenu', "Show Menu")));
				}

				actions.push(this.instantiationService.createInstance(ToggleActivityBarVisibilityAction, ToggleActivityBarVisibilityAction.ID, nls.localize('hideActivitBar', "Hide Activity Bar")));
				return actions;
			},
			getContextMenuActionsForComposite: () => [],
			getDefaultCompositeId: () => this.viewDescriptorService.getDefaultViewContainer(this.location)!.id,
			hidePart: () => this.layoutService.setSideBarHidden(true),
			dndHandler: new CompositeDragAndDrop(this.viewDescriptorService, ViewContainerLocation.Sidebar,
				(id: string, focus?: boolean) => this.viewsService.openViewContainer(id, focus),
				(from: string, to: string, before?: Before2D) => this.compositeBar.move(from, to, before?.verticallyBefore)
			),
			compositeSize: 52,
			colors: (theme: IColorTheme) => this.getActivitybarItemColors(theme),
			overflowActionSize: ActivitybarPart.ACTION_HEIGHT
		}));

		this.onDidRegisterViewContainers(this.getViewContainers());
		this.registerListeners();
	}

	focusActivityBar(): void {
		this.compositeBar.focus();
	}

	private registerListeners(): void {

		// View Container Changes
		this._register(this.viewDescriptorService.onDidChangeViewContainers(({ added, removed }) => this.onDidChangeViewContainers(added, removed)));
		this._register(this.viewDescriptorService.onDidChangeContainerLocation(({ viewContainer, from, to }) => this.onDidChangeViewContainerLocation(viewContainer, from, to)));

		// View Container Visibility Changes
		this._register(Event.filter(this.viewsService.onDidChangeViewContainerVisibility, e => e.location === this.location)(({ id, visible }) => this.onDidChangeViewContainerVisibility(id, visible)));

		// Extension registration
		let disposables = this._register(new DisposableStore());
		this._register(this.extensionService.onDidRegisterExtensions(() => {
			disposables.clear();
			this.onDidRegisterExtensions();
			this.compositeBar.onDidChange(() => this.saveCachedViewContainers(), this, disposables);
			this.storageService.onDidChangeStorage(e => this.onDidStorageChange(e), this, disposables);
		}));

		// Register for configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('window.menuBarVisibility')) {
				if (getMenuBarVisibility(this.configurationService, this.environmentService) === 'compact') {
					this.installMenubar();
				} else {
					this.uninstallMenubar();
				}
			}
		}));
	}

	private onDidChangeViewContainers(added: ReadonlyArray<{ container: ViewContainer, location: ViewContainerLocation }>, removed: ReadonlyArray<{ container: ViewContainer, location: ViewContainerLocation }>) {
		removed.filter(({ location }) => location === ViewContainerLocation.Sidebar).forEach(({ container }) => this.onDidDeregisterViewContainer(container));
		this.onDidRegisterViewContainers(added.filter(({ location }) => location === ViewContainerLocation.Sidebar).map(({ container }) => container));
	}

	private onDidChangeViewContainerLocation(container: ViewContainer, from: ViewContainerLocation, to: ViewContainerLocation) {
		if (from === this.location) {
			this.onDidDeregisterViewContainer(container);
		}
		if (to === this.location) {
			this.onDidRegisterViewContainers([container]);
		}
	}

	private onDidChangeViewContainerVisibility(id: string, visible: boolean) {
		if (visible) {
			// Activate view container action on opening of a view container
			this.onDidViewContainerVisible(id);
		} else {
			// Deactivate view container action on close
			this.compositeBar.deactivateComposite(id);
		}
	}

	private onDidRegisterExtensions(): void {
		this.removeNotExistingComposites();
		this.saveCachedViewContainers();
	}

	private onDidViewContainerVisible(id: string): void {
		const viewContainer = this.getViewContainer(id);
		if (viewContainer) {
			// Update the composite bar by adding
			this.compositeBar.addComposite(viewContainer);
			this.compositeBar.activateComposite(viewContainer.id);

			if (viewContainer.hideIfEmpty) {
				const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
				if (viewContainerModel.activeViewDescriptors.length === 0) {
					this.hideComposite(viewContainer.id); // Update the composite bar by hiding
				}
			}
		}
	}

	showActivity(viewContainerOrActionId: string, badge: IBadge, clazz?: string, priority?: number): IDisposable {
		if (this.getViewContainer(viewContainerOrActionId)) {
			return this.compositeBar.showActivity(viewContainerOrActionId, badge, clazz, priority);
		}

		if (viewContainerOrActionId === GLOBAL_ACTIVITY_ID) {
			return this.showGlobalActivity(badge, clazz, priority);
		}

		return Disposable.None;
	}

	private showGlobalActivity(badge: IBadge, clazz?: string, priority?: number): IDisposable {
		if (typeof priority !== 'number') {
			priority = 0;
		}
		const activity: ICompositeActivity = { badge, clazz, priority };

		for (let i = 0; i <= this.globalActivity.length; i++) {
			if (i === this.globalActivity.length) {
				this.globalActivity.push(activity);
				break;
			} else if (this.globalActivity[i].priority <= priority) {
				this.globalActivity.splice(i, 0, activity);
				break;
			}
		}
		this.updateGlobalActivity();

		return toDisposable(() => this.removeGlobalActivity(activity));
	}

	private removeGlobalActivity(activity: ICompositeActivity): void {
		const index = this.globalActivity.indexOf(activity);
		if (index !== -1) {
			this.globalActivity.splice(index, 1);
			this.updateGlobalActivity();
		}
	}

	private updateGlobalActivity(): void {
		const globalActivityAction = assertIsDefined(this.globalActivityAction);
		if (this.globalActivity.length) {
			const [{ badge, clazz, priority }] = this.globalActivity;
			if (badge instanceof NumberBadge && this.globalActivity.length > 1) {
				const cumulativeNumberBadge = this.getCumulativeNumberBadge(priority);
				globalActivityAction.setBadge(cumulativeNumberBadge);
			} else {
				globalActivityAction.setBadge(badge, clazz);
			}
		} else {
			globalActivityAction.setBadge(undefined);
		}
	}

	private getCumulativeNumberBadge(priority: number): NumberBadge {
		const numberActivities = this.globalActivity.filter(activity => activity.badge instanceof NumberBadge && activity.priority === priority);
		let number = numberActivities.reduce((result, activity) => { return result + (<NumberBadge>activity.badge).number; }, 0);
		let descriptorFn = (): string => {
			return numberActivities.reduce((result, activity, index) => {
				result = result + (<NumberBadge>activity.badge).getDescription();
				if (index < numberActivities.length - 1) {
					result = result + '\n';
				}
				return result;
			}, '');
		};
		return new NumberBadge(number, descriptorFn);
	}

	private uninstallMenubar() {
		if (this.menuBar) {
			this.menuBar.dispose();
		}

		if (this.menuBarContainer) {
			removeNode(this.menuBarContainer);
		}
	}

	private installMenubar() {
		this.menuBarContainer = document.createElement('div');
		addClass(this.menuBarContainer, 'menubar');

		const content = assertIsDefined(this.content);
		content.prepend(this.menuBarContainer);

		// Menubar: install a custom menu bar depending on configuration
		this.menuBar = this._register(this.instantiationService.createInstance(CustomMenubarControl));
		this.menuBar.create(this.menuBarContainer);
	}

	createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;

		this.content = document.createElement('div');
		addClass(this.content, 'content');
		parent.appendChild(this.content);

		// Home action bar
		const homeIndicator = this.environmentService.options?.homeIndicator;
		if (homeIndicator) {
			let codicon = iconRegistry.get(homeIndicator.icon);
			if (!codicon) {
				console.warn(`Unknown home indicator icon ${homeIndicator.icon}`);
				codicon = Codicon.code;
			}
			this.createHomeBar(homeIndicator.command, homeIndicator.title, codicon);
		}

		// Install menubar if compact
		if (getMenuBarVisibility(this.configurationService, this.environmentService) === 'compact') {
			this.installMenubar();
		}

		// View Containers action bar
		this.compositeBar.create(this.content);

		// Global action bar
		const globalActivities = document.createElement('div');
		addClass(globalActivities, 'global-activity');
		this.content.appendChild(globalActivities);

		this.createGlobalActivityActionBar(globalActivities);

		return this.content;
	}

	private createHomeBar(command: string, title: string, icon: Codicon): void {
		this.homeBarContainer = document.createElement('div');
		this.homeBarContainer.setAttribute('aria-label', nls.localize('homeIndicator', "Home"));
		this.homeBarContainer.setAttribute('role', 'toolbar');
		addClass(this.homeBarContainer, 'home-bar');

		this.homeBar = this._register(new ActionBar(this.homeBarContainer, {
			orientation: ActionsOrientation.VERTICAL,
			animated: false
		}));

		const homeBarIconBadge = document.createElement('div');
		addClass(homeBarIconBadge, 'home-bar-icon-badge');
		this.homeBarContainer.appendChild(homeBarIconBadge);

		this.homeBar.push(this._register(this.instantiationService.createInstance(HomeAction, command, title, icon)), { icon: true, label: false });

		const content = assertIsDefined(this.content);
		content.prepend(this.homeBarContainer);
	}

	updateStyles(): void {
		super.updateStyles();

		const container = assertIsDefined(this.getContainer());
		const background = this.getColor(ACTIVITY_BAR_BACKGROUND) || '';
		container.style.backgroundColor = background;

		const borderColor = this.getColor(ACTIVITY_BAR_BORDER) || this.getColor(contrastBorder) || '';
		const isPositionLeft = this.layoutService.getSideBarPosition() === SideBarPosition.LEFT;
		container.style.boxSizing = borderColor && isPositionLeft ? 'border-box' : '';
		container.style.borderRightWidth = borderColor && isPositionLeft ? '1px' : '';
		container.style.borderRightStyle = borderColor && isPositionLeft ? 'solid' : '';
		container.style.borderRightColor = isPositionLeft ? borderColor : '';
		container.style.borderLeftWidth = borderColor && !isPositionLeft ? '1px' : '';
		container.style.borderLeftStyle = borderColor && !isPositionLeft ? 'solid' : '';
		container.style.borderLeftColor = !isPositionLeft ? borderColor : '';
	}

	private getActivitybarItemColors(theme: IColorTheme): ICompositeBarColors {
		return {
			activeForegroundColor: theme.getColor(ACTIVITY_BAR_FOREGROUND),
			inactiveForegroundColor: theme.getColor(ACTIVITY_BAR_INACTIVE_FOREGROUND),
			activeBorderColor: theme.getColor(ACTIVITY_BAR_ACTIVE_BORDER),
			activeBackground: theme.getColor(ACTIVITY_BAR_ACTIVE_BACKGROUND),
			badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
			badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
			dragAndDropBackground: theme.getColor(ACTIVITY_BAR_DRAG_AND_DROP_BACKGROUND),
			activeBackgroundColor: undefined, inactiveBackgroundColor: undefined, activeBorderBottomColor: undefined,
		};
	}

	private createGlobalActivityActionBar(container: HTMLElement): void {
		this.globalActivityActionBar = this._register(new ActionBar(container, {
			actionViewItemProvider: action => {
				if (action.id === 'workbench.actions.manage') {
					return this.instantiationService.createInstance(GlobalActivityActionViewItem, action as ActivityAction, (theme: IColorTheme) => this.getActivitybarItemColors(theme));
				}

				if (action.id === 'workbench.actions.accounts') {
					return this.instantiationService.createInstance(AccountsActionViewItem, action as ActivityAction, (theme: IColorTheme) => this.getActivitybarItemColors(theme));
				}

				throw new Error(`No view item for action '${action.id}'`);
			},
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: nls.localize('manage', "Manage"),
			animated: false
		}));

		this.globalActivityAction = new ActivityAction({
			id: 'workbench.actions.manage',
			name: nls.localize('manage', "Manage"),
			cssClass: Codicon.settingsGear.classNames
		});

		if (getUserDataSyncStore(this.productService, this.configurationService)) {
			const profileAction = new ActivityAction({
				id: 'workbench.actions.accounts',
				name: nls.localize('accounts', "Accounts"),
				cssClass: Codicon.account.classNames
			});

			this.globalActivityActionBar.push(profileAction);
		}

		this.globalActivityActionBar.push(this.globalActivityAction);
	}

	private getCompositeActions(compositeId: string): { activityAction: ViewContainerActivityAction, pinnedAction: ToggleCompositePinnedAction } {
		let compositeActions = this.compositeActions.get(compositeId);
		if (!compositeActions) {
			const viewContainer = this.getViewContainer(compositeId);
			if (viewContainer) {
				const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
				compositeActions = {
					activityAction: this.instantiationService.createInstance(ViewContainerActivityAction, this.toActivity(viewContainer, viewContainerModel)),
					pinnedAction: new ToggleCompositePinnedAction(viewContainer, this.compositeBar)
				};
			} else {
				const cachedComposite = this.cachedViewContainers.filter(c => c.id === compositeId)[0];
				compositeActions = {
					activityAction: this.instantiationService.createInstance(PlaceHolderViewContainerActivityAction, ActivitybarPart.toActivity(compositeId, compositeId, cachedComposite?.icon, undefined)),
					pinnedAction: new PlaceHolderToggleCompositePinnedAction(compositeId, this.compositeBar)
				};
			}

			this.compositeActions.set(compositeId, compositeActions);
		}

		return compositeActions;
	}

	private onDidRegisterViewContainers(viewContainers: ReadonlyArray<ViewContainer>): void {
		for (const viewContainer of viewContainers) {
			const cachedViewContainer = this.cachedViewContainers.filter(({ id }) => id === viewContainer.id)[0];
			const visibleViewContainer = this.viewsService.getVisibleViewContainer(this.location);
			const isActive = visibleViewContainer?.id === viewContainer.id;

			if (isActive || !this.shouldBeHidden(viewContainer.id, cachedViewContainer)) {
				this.compositeBar.addComposite(viewContainer);

				// Pin it by default if it is new
				if (!cachedViewContainer) {
					this.compositeBar.pin(viewContainer.id);
				}

				if (isActive) {
					this.compositeBar.activateComposite(viewContainer.id);
				}
			}
		}

		for (const viewContainer of viewContainers) {
			const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
			this.updateActivity(viewContainer, viewContainerModel);
			this.onDidChangeActiveViews(viewContainer, viewContainerModel);

			const disposables = new DisposableStore();
			disposables.add(viewContainerModel.onDidChangeContainerInfo(() => this.updateActivity(viewContainer, viewContainerModel)));
			disposables.add(viewContainerModel.onDidChangeActiveViewDescriptors(() => this.onDidChangeActiveViews(viewContainer, viewContainerModel)));

			this.viewContainerDisposables.set(viewContainer.id, disposables);
		}
	}

	private onDidDeregisterViewContainer(viewContainer: ViewContainer): void {
		const disposable = this.viewContainerDisposables.get(viewContainer.id);
		if (disposable) {
			disposable.dispose();
		}

		this.viewContainerDisposables.delete(viewContainer.id);
		this.hideComposite(viewContainer.id);
	}

	private updateActivity(viewContainer: ViewContainer, viewContainerModel: IViewContainerModel): void {
		const activity: IActivity = this.toActivity(viewContainer, viewContainerModel);
		const { activityAction, pinnedAction } = this.getCompositeActions(viewContainer.id);
		activityAction.updateActivity(activity);

		if (pinnedAction instanceof PlaceHolderToggleCompositePinnedAction) {
			pinnedAction.setActivity(activity);
		}

		this.saveCachedViewContainers();
	}

	private toActivity({ id, focusCommand }: ViewContainer, { icon, title: name }: IViewContainerModel): IActivity {
		return ActivitybarPart.toActivity(id, name, icon, focusCommand?.id || id);
	}

	private static toActivity(id: string, name: string, icon: URI | string | undefined, keybindingId: string | undefined): IActivity {
		let cssClass: string | undefined = undefined;
		let iconUrl: URI | undefined = undefined;
		if (URI.isUri(icon)) {
			iconUrl = icon;
			cssClass = `activity-${id.replace(/\./g, '-')}`;
			const iconClass = `.monaco-workbench .activitybar .monaco-action-bar .action-label.${cssClass}`;
			createCSSRule(iconClass, `
				mask: ${asCSSUrl(icon)} no-repeat 50% 50%;
				mask-size: 24px;
				-webkit-mask: ${asCSSUrl(icon)} no-repeat 50% 50%;
				-webkit-mask-size: 24px;
			`);
		} else if (isString(icon)) {
			cssClass = icon;
		}
		return { id, name, cssClass, iconUrl, keybindingId };
	}

	private onDidChangeActiveViews(viewContainer: ViewContainer, viewContainerModel: IViewContainerModel): void {
		if (viewContainerModel.activeViewDescriptors.length) {
			this.compositeBar.addComposite(viewContainer);
		} else if (viewContainer.hideIfEmpty) {
			this.hideComposite(viewContainer.id);
		}
	}

	private shouldBeHidden(viewContainerId: string, cachedViewContainer?: ICachedViewContainer): boolean {
		const viewContainer = this.getViewContainer(viewContainerId);
		if (!viewContainer || !viewContainer.hideIfEmpty) {
			return false;
		}

		return cachedViewContainer?.views && cachedViewContainer.views.length
			? cachedViewContainer.views.every(({ when }) => !!when && !this.contextKeyService.contextMatchesRules(ContextKeyExpr.deserialize(when)))
			: viewContainerId === TEST_VIEW_CONTAINER_ID /* Hide Test view container for the first time or it had no views registered before */;
	}

	private removeNotExistingComposites(): void {
		const viewContainers = this.getViewContainers();
		for (const { id } of this.cachedViewContainers) {
			if (viewContainers.every(viewContainer => viewContainer.id !== id)) {
				this.hideComposite(id);
			}
		}
	}

	private hideComposite(compositeId: string): void {
		this.compositeBar.hideComposite(compositeId);

		const compositeActions = this.compositeActions.get(compositeId);
		if (compositeActions) {
			compositeActions.activityAction.dispose();
			compositeActions.pinnedAction.dispose();
			this.compositeActions.delete(compositeId);
		}
	}

	getPinnedViewContainerIds(): string[] {
		const pinnedCompositeIds = this.compositeBar.getPinnedComposites().map(v => v.id);
		return this.getViewContainers()
			.filter(v => this.compositeBar.isPinned(v.id))
			.sort((v1, v2) => pinnedCompositeIds.indexOf(v1.id) - pinnedCompositeIds.indexOf(v2.id))
			.map(v => v.id);
	}

	getVisibleViewContainerIds(): string[] {
		return this.compositeBar.getVisibleComposites()
			.filter(v => this.viewsService.getVisibleViewContainer(this.location)?.id === v.id || this.compositeBar.isPinned(v.id))
			.map(v => v.id);
	}

	layout(width: number, height: number): void {
		if (!this.layoutService.isVisible(Parts.ACTIVITYBAR_PART)) {
			return;
		}

		// Layout contents
		const contentAreaSize = super.layoutContents(width, height).contentSize;

		// Layout composite bar
		let availableHeight = contentAreaSize.height;
		if (this.homeBarContainer) {
			availableHeight -= this.homeBarContainer.clientHeight;
		}
		if (this.menuBarContainer) {
			availableHeight -= this.menuBarContainer.clientHeight;
		}
		if (this.globalActivityActionBar) {
			availableHeight -= (this.globalActivityActionBar.viewItems.length * ActivitybarPart.ACTION_HEIGHT); // adjust height for global actions showing
		}
		this.compositeBar.layout(new Dimension(width, availableHeight));
	}

	private getViewContainer(id: string): ViewContainer | undefined {
		const viewContainer = this.viewDescriptorService.getViewContainerById(id);
		return viewContainer && this.viewDescriptorService.getViewContainerLocation(viewContainer) === this.location ? viewContainer : undefined;
	}

	private getViewContainers(): ReadonlyArray<ViewContainer> {
		return this.viewDescriptorService.getViewContainersByLocation(this.location);
	}

	private onDidStorageChange(e: IWorkspaceStorageChangeEvent): void {
		if (e.key === ActivitybarPart.PINNED_VIEW_CONTAINERS && e.scope === StorageScope.GLOBAL
			&& this.pinnedViewContainersValue !== this.getStoredPinnedViewContainersValue() /* This checks if current window changed the value or not */) {
			this._pinnedViewContainersValue = undefined;
			const newCompositeItems: ICompositeBarItem[] = [];
			const compositeItems = this.compositeBar.getCompositeBarItems();
			const cachedViewContainers = this.getCachedViewContainers();

			for (const cachedViewContainer of cachedViewContainers) {
				// Add and update existing items
				const existingItem = compositeItems.filter(({ id }) => id === cachedViewContainer.id)[0];
				if (existingItem) {
					newCompositeItems.push({
						id: existingItem.id,
						name: existingItem.name,
						order: existingItem.order,
						pinned: cachedViewContainer.pinned,
						visible: existingItem.visible
					});
				}
			}

			for (let index = 0; index < compositeItems.length; index++) {
				// Add items currently exists but does not exist in new.
				if (!newCompositeItems.some(({ id }) => id === compositeItems[index].id)) {
					newCompositeItems.splice(index, 0, compositeItems[index]);
				}
			}

			this.compositeBar.setCompositeBarItems(newCompositeItems);
		}
	}

	private saveCachedViewContainers(): void {
		const state: ICachedViewContainer[] = [];

		const compositeItems = this.compositeBar.getCompositeBarItems();
		for (const compositeItem of compositeItems) {
			const viewContainer = this.getViewContainer(compositeItem.id);
			if (viewContainer) {
				const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
				const views: { when: string | undefined }[] = [];
				for (const { when } of viewContainerModel.allViewDescriptors) {
					views.push({ when: when ? when.serialize() : undefined });
				}
				const cacheIcon = URI.isUri(viewContainerModel.icon) ? viewContainerModel.icon.scheme === Schemas.file : true;
				state.push({
					id: compositeItem.id,
					name: viewContainerModel.title,
					icon: cacheIcon ? viewContainerModel.icon : undefined,
					views,
					pinned: compositeItem.pinned,
					order: compositeItem.order,
					visible: compositeItem.visible
				});
			} else {
				state.push({ id: compositeItem.id, pinned: compositeItem.pinned, order: compositeItem.order, visible: false });
			}
		}

		this.storeCachedViewContainersState(state);
	}

	private getCachedViewContainers(): ICachedViewContainer[] {
		const cachedViewContainers: ICachedViewContainer[] = this.getPinnedViewContainers();
		for (const placeholderViewContainer of this.getPlaceholderViewContainers()) {
			const cachedViewContainer = cachedViewContainers.filter(cached => cached.id === placeholderViewContainer.id)[0];
			if (cachedViewContainer) {
				cachedViewContainer.name = placeholderViewContainer.name;
				cachedViewContainer.icon = placeholderViewContainer.iconCSS ? placeholderViewContainer.iconCSS :
					placeholderViewContainer.iconUrl ? URI.revive(placeholderViewContainer.iconUrl) : undefined;
				cachedViewContainer.views = placeholderViewContainer.views;
			}
		}

		return cachedViewContainers;
	}

	private storeCachedViewContainersState(cachedViewContainers: ICachedViewContainer[]): void {
		this.setPinnedViewContainers(cachedViewContainers.map(({ id, pinned, visible, order }) => (<IPinnedViewContainer>{
			id,
			pinned,
			visible,
			order
		})));
		this.setPlaceholderViewContainers(cachedViewContainers.map(({ id, icon, name, views }) => (<IPlaceholderViewContainer>{
			id,
			iconUrl: URI.isUri(icon) ? icon : undefined,
			iconCSS: isString(icon) ? icon : undefined,
			name,
			views
		})));
	}

	private getPinnedViewContainers(): IPinnedViewContainer[] {
		return JSON.parse(this.pinnedViewContainersValue);
	}

	private setPinnedViewContainers(pinnedViewContainers: IPinnedViewContainer[]): void {
		this.pinnedViewContainersValue = JSON.stringify(pinnedViewContainers);
	}

	private _pinnedViewContainersValue: string | undefined;
	private get pinnedViewContainersValue(): string {
		if (!this._pinnedViewContainersValue) {
			this._pinnedViewContainersValue = this.getStoredPinnedViewContainersValue();
		}

		return this._pinnedViewContainersValue;
	}

	private set pinnedViewContainersValue(pinnedViewContainersValue: string) {
		if (this.pinnedViewContainersValue !== pinnedViewContainersValue) {
			this._pinnedViewContainersValue = pinnedViewContainersValue;
			this.setStoredPinnedViewContainersValue(pinnedViewContainersValue);
		}
	}

	private getStoredPinnedViewContainersValue(): string {
		return this.storageService.get(ActivitybarPart.PINNED_VIEW_CONTAINERS, StorageScope.GLOBAL, '[]');
	}

	private setStoredPinnedViewContainersValue(value: string): void {
		this.storageService.store(ActivitybarPart.PINNED_VIEW_CONTAINERS, value, StorageScope.GLOBAL);
	}

	private getPlaceholderViewContainers(): IPlaceholderViewContainer[] {
		return JSON.parse(this.placeholderViewContainersValue);
	}

	private setPlaceholderViewContainers(placeholderViewContainers: IPlaceholderViewContainer[]): void {
		this.placeholderViewContainersValue = JSON.stringify(placeholderViewContainers);
	}

	private _placeholderViewContainersValue: string | undefined;
	private get placeholderViewContainersValue(): string {
		if (!this._placeholderViewContainersValue) {
			this._placeholderViewContainersValue = this.getStoredPlaceholderViewContainersValue();
		}

		return this._placeholderViewContainersValue;
	}

	private set placeholderViewContainersValue(placeholderViewContainesValue: string) {
		if (this.placeholderViewContainersValue !== placeholderViewContainesValue) {
			this._placeholderViewContainersValue = placeholderViewContainesValue;
			this.setStoredPlaceholderViewContainersValue(placeholderViewContainesValue);
		}
	}

	private getStoredPlaceholderViewContainersValue(): string {
		return this.storageService.get(ActivitybarPart.PLACEHOLDER_VIEW_CONTAINERS, StorageScope.GLOBAL, '[]');
	}

	private setStoredPlaceholderViewContainersValue(value: string): void {
		this.storageService.store(ActivitybarPart.PLACEHOLDER_VIEW_CONTAINERS, value, StorageScope.GLOBAL);
	}

	private migrateFromOldCachedViewContainersValue(): void {
		const value = this.storageService.get('workbench.activity.pinnedViewlets', StorageScope.GLOBAL);
		if (value !== undefined) {
			const storedStates: Array<string | ICachedViewContainer> = JSON.parse(value);
			const cachedViewContainers = storedStates.map(c => {
				const serialized: ICachedViewContainer = typeof c === 'string' /* migration from pinned states to composites states */ ? { id: c, pinned: true, order: undefined, visible: true, name: undefined, icon: undefined, views: undefined } : c;
				serialized.visible = isUndefinedOrNull(serialized.visible) ? true : serialized.visible;
				return serialized;
			});
			this.storeCachedViewContainersState(cachedViewContainers);
			this.storageService.remove('workbench.activity.pinnedViewlets', StorageScope.GLOBAL);
		}
	}

	toJSON(): object {
		return {
			type: Parts.ACTIVITYBAR_PART
		};
	}
}

registerSingleton(IActivityBarService, ActivitybarPart);
