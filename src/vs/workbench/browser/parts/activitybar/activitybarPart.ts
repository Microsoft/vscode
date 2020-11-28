/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/activitybarpart';
import * as nls from 'vs/nls';
import { ActionsOrientation, ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { GLOBAL_ACTIVITY_ID, IActivity, ACCOUNTS_ACTIVITY_ID } from 'vs/workbench/common/activity';
import { Part } from 'vs/workbench/browser/part';
import { GlobalActivityActionViewItem, ViewContainerActivityAction, PlaceHolderToggleCompositePinnedAction, PlaceHolderViewContainerActivityAction, AccountsActivityActionViewItem, HomeActivityActionViewItem } from 'vs/workbench/browser/parts/activitybar/activitybarActions';
import { IBadge, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, toDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { ToggleActivityBarVisibilityAction, ToggleMenuBarAction, ToggleSidebarPositionAction } from 'vs/workbench/browser/actions/layoutActions';
import { IThemeService, IColorTheme, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ACTIVITY_BAR_BACKGROUND, ACTIVITY_BAR_BORDER, ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_ACTIVE_BORDER, ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, ACTIVITY_BAR_INACTIVE_FOREGROUND, ACTIVITY_BAR_ACTIVE_BACKGROUND, ACTIVITY_BAR_DRAG_AND_DROP_BORDER } from 'vs/workbench/common/theme';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { CompositeBar, ICompositeBarItem, CompositeDragAndDrop } from 'vs/workbench/browser/parts/compositeBar';
import { Dimension, createCSSRule, asCSSUrl, addDisposableListener, EventType } from 'vs/base/browser/dom';
import { IStorageService, StorageScope, IStorageValueChangeEvent, StorageTarget } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ToggleCompositePinnedAction, ICompositeBarColors, ActivityAction, ICompositeActivity } from 'vs/workbench/browser/parts/compositeBarActions';
import { IViewDescriptorService, ViewContainer, TEST_VIEW_CONTAINER_ID, IViewContainerModel, ViewContainerLocation, IViewsService } from 'vs/workbench/common/views';
import { IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { assertIsDefined } from 'vs/base/common/types';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Schemas } from 'vs/base/common/network';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { CustomMenubarControl } from 'vs/workbench/browser/parts/titlebar/menubarControl';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { getMenuBarVisibility } from 'vs/platform/windows/common/windows';
import { isWeb } from 'vs/base/common/platform';
import { Before2D } from 'vs/workbench/browser/dnd';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { Action, Separator } from 'vs/base/common/actions';
import { Event } from 'vs/base/common/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

interface IPlaceholderViewContainer {
	readonly id: string;
	readonly name?: string;
	readonly iconUrl?: UriComponents;
	readonly themeIcon?: ThemeIcon;
	readonly views?: { when?: string }[];
}

interface IPinnedViewContainer {
	readonly id: string;
	readonly pinned: boolean;
	readonly order?: number;
	readonly visible: boolean;
}

interface ICachedViewContainer {
	readonly id: string;
	name?: string;
	icon?: URI | ThemeIcon;
	readonly pinned: boolean;
	readonly order?: number;
	visible: boolean;
	views?: { when?: string }[];
}

const settingsViewBarIcon = registerIcon('settings-view-bar-icon', Codicon.settingsGear, nls.localize('settingsViewBarIcon', 'Settings icon in the view bar.'));
const accountsViewBarIcon = registerIcon('accounts-view-bar-icon', Codicon.account, nls.localize('accountsViewBarIcon', 'Accounts icon in the view bar.'));

export class ActivitybarPart extends Part implements IActivityBarService {

	declare readonly _serviceBrand: undefined;

	private static readonly PINNED_VIEW_CONTAINERS = 'workbench.activity.pinnedViewlets2';
	private static readonly PLACEHOLDER_VIEW_CONTAINERS = 'workbench.activity.placeholderViewlets';
	private static readonly ACTION_HEIGHT = 48;
	private static readonly ACCOUNTS_ACTION_INDEX = 0;

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
	private compositeBarContainer: HTMLElement | undefined;

	private globalActivityAction: ActivityAction | undefined;
	private globalActivityActionBar: ActionBar | undefined;
	private globalActivitiesContainer: HTMLElement | undefined;
	private readonly globalActivity: ICompositeActivity[] = [];

	private accountsActivityAction: ActivityAction | undefined;

	private readonly accountsActivity: ICompositeActivity[] = [];

	private readonly compositeActions = new Map<string, { activityAction: ViewContainerActivityAction, pinnedAction: ToggleCompositePinnedAction }>();
	private readonly viewContainerDisposables = new Map<string, IDisposable>();

	private readonly keyboardNavigationDisposables = this._register(new DisposableStore());

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
	) {
		super(Parts.ACTIVITYBAR_PART, { hasTitle: false }, themeService, storageService, layoutService);

		for (const cachedViewContainer of this.cachedViewContainers) {
			if (
				environmentService.remoteAuthority || // In remote window, hide activity bar entries until registered
				this.shouldBeHidden(cachedViewContainer.id, cachedViewContainer)
			) {
				cachedViewContainer.visible = false;
			}
		}

		this.compositeBar = this.createCompositeBar();

		this.onDidRegisterViewContainers(this.getViewContainers());

		this.registerListeners();
	}

	private createCompositeBar() {
		const cachedItems = this.cachedViewContainers
			.map(container => ({
				id: container.id,
				name: container.name,
				visible: container.visible,
				order: container.order,
				pinned: container.pinned
			}));

		return this._register(this.instantiationService.createInstance(CompositeBar, cachedItems, {
			icon: true,
			orientation: ActionsOrientation.VERTICAL,
			preventLoopNavigation: true,
			openComposite: (compositeId: string) => this.viewsService.openViewContainer(compositeId, true),
			getActivityAction: (compositeId: string) => this.getCompositeActions(compositeId).activityAction,
			getCompositePinnedAction: (compositeId: string) => this.getCompositeActions(compositeId).pinnedAction,
			getOnCompositeClickAction: (compositeId: string) => new Action(compositeId, '', '', true, () => this.viewsService.isViewContainerVisible(compositeId) ? Promise.resolve(this.viewsService.closeViewContainer(compositeId)) : this.viewsService.openViewContainer(compositeId)),
			getContextMenuActions: () => {
				const actions = [];

				// Home
				if (this.homeBarContainer) {
					actions.push(new Action(
						'toggleHomeBarAction',
						this.homeBarVisibilityPreference ? nls.localize('hideHomeBar', "Hide Home Button") : nls.localize('showHomeBar', "Show Home Button"),
						undefined,
						true,
						async () => { this.homeBarVisibilityPreference = !this.homeBarVisibilityPreference; }
					));
				}

				// Menu
				const menuBarVisibility = getMenuBarVisibility(this.configurationService);
				if (menuBarVisibility === 'compact' || (menuBarVisibility === 'hidden' && isWeb)) {
					actions.push(this.instantiationService.createInstance(ToggleMenuBarAction, ToggleMenuBarAction.ID, menuBarVisibility === 'compact' ? nls.localize('hideMenu', "Hide Menu") : nls.localize('showMenu', "Show Menu")));
				}

				// Accounts
				actions.push(new Action(
					'toggleAccountsVisibility',
					this.accountsVisibilityPreference ? nls.localize('hideAccounts', "Hide Accounts") : nls.localize('showAccounts', "Show Accounts"),
					undefined,
					true,
					async () => { this.accountsVisibilityPreference = !this.accountsVisibilityPreference; }
				));
				actions.push(new Separator());

				// Toggle Sidebar
				actions.push(this.instantiationService.createInstance(ToggleSidebarPositionAction, ToggleSidebarPositionAction.ID, ToggleSidebarPositionAction.getLabel(this.layoutService)));

				// Toggle Activity Bar
				actions.push(new Action(
					ToggleActivityBarVisibilityAction.ID,
					nls.localize('hideActivitBar', "Hide Activity Bar"),
					undefined,
					true,
					async () => { this.instantiationService.invokeFunction(accessor => new ToggleActivityBarVisibilityAction().run(accessor)); }
				));

				return actions;
			},
			getContextMenuActionsForComposite: compositeId => this.getContextMenuActionsForComposite(compositeId),
			getDefaultCompositeId: () => this.viewDescriptorService.getDefaultViewContainer(this.location)!.id,
			hidePart: () => this.layoutService.setSideBarHidden(true),
			dndHandler: new CompositeDragAndDrop(this.viewDescriptorService, ViewContainerLocation.Sidebar,
				(id: string, focus?: boolean) => this.viewsService.openViewContainer(id, focus),
				(from: string, to: string, before?: Before2D) => this.compositeBar.move(from, to, before?.verticallyBefore),
				() => this.compositeBar.getCompositeBarItems(),
			),
			compositeSize: 52,
			colors: (theme: IColorTheme) => this.getActivitybarItemColors(theme),
			overflowActionSize: ActivitybarPart.ACTION_HEIGHT
		}));
	}

	private getContextMenuActionsForComposite(compositeId: string): Action[] {
		const actions = [];

		const viewContainer = this.viewDescriptorService.getViewContainerById(compositeId)!;
		const defaultLocation = this.viewDescriptorService.getDefaultViewContainerLocation(viewContainer)!;
		if (defaultLocation !== this.viewDescriptorService.getViewContainerLocation(viewContainer)) {
			actions.push(new Action('resetLocationAction', nls.localize('resetLocation', "Reset Location"), undefined, true, async () => {
				this.viewDescriptorService.moveViewContainerToLocation(viewContainer, defaultLocation);
			}));
		} else {
			const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
			if (viewContainerModel.allViewDescriptors.length === 1) {
				const viewToReset = viewContainerModel.allViewDescriptors[0];
				const defaultContainer = this.viewDescriptorService.getDefaultContainerById(viewToReset.id)!;
				if (defaultContainer !== viewContainer) {
					actions.push(new Action('resetLocationAction', nls.localize('resetLocation', "Reset Location"), undefined, true, async () => {
						this.viewDescriptorService.moveViewsToContainer([viewToReset], defaultContainer);
					}));
				}
			}
		}

		return actions;
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
			this.storageService.onDidChangeValue(e => this.onDidStorageValueChange(e), this, disposables);
		}));

		// Register for configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('window.menuBarVisibility')) {
				if (getMenuBarVisibility(this.configurationService) === 'compact') {
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

	private onDidChangeHomeBarVisibility(): void {
		if (this.homeBarContainer) {
			this.homeBarContainer.style.display = this.homeBarVisibilityPreference ? '' : 'none';
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
					// Update the composite bar by hiding
					this.hideComposite(viewContainer.id);
				}
			}
		}
	}

	showActivity(viewContainerOrActionId: string, badge: IBadge, clazz?: string, priority?: number): IDisposable {
		if (this.getViewContainer(viewContainerOrActionId)) {
			return this.compositeBar.showActivity(viewContainerOrActionId, badge, clazz, priority);
		}

		if (viewContainerOrActionId === GLOBAL_ACTIVITY_ID) {
			return this.showGlobalActivity(GLOBAL_ACTIVITY_ID, badge, clazz, priority);
		}

		if (viewContainerOrActionId === ACCOUNTS_ACTIVITY_ID) {
			return this.showGlobalActivity(ACCOUNTS_ACTIVITY_ID, badge, clazz, priority);
		}

		return Disposable.None;
	}

	private showGlobalActivity(activityId: string, badge: IBadge, clazz?: string, priority?: number): IDisposable {
		if (typeof priority !== 'number') {
			priority = 0;
		}

		const activity: ICompositeActivity = { badge, clazz, priority };
		const activityCache = activityId === GLOBAL_ACTIVITY_ID ? this.globalActivity : this.accountsActivity;

		for (let i = 0; i <= activityCache.length; i++) {
			if (i === activityCache.length) {
				activityCache.push(activity);
				break;
			} else if (activityCache[i].priority <= priority) {
				activityCache.splice(i, 0, activity);
				break;
			}
		}
		this.updateGlobalActivity(activityId);

		return toDisposable(() => this.removeGlobalActivity(activityId, activity));
	}

	private removeGlobalActivity(activityId: string, activity: ICompositeActivity): void {
		const activityCache = activityId === GLOBAL_ACTIVITY_ID ? this.globalActivity : this.accountsActivity;
		const index = activityCache.indexOf(activity);
		if (index !== -1) {
			activityCache.splice(index, 1);
			this.updateGlobalActivity(activityId);
		}
	}

	private updateGlobalActivity(activityId: string): void {
		const activityAction = activityId === GLOBAL_ACTIVITY_ID ? this.globalActivityAction : this.accountsActivityAction;
		if (!activityAction) {
			return;
		}

		const activityCache = activityId === GLOBAL_ACTIVITY_ID ? this.globalActivity : this.accountsActivity;
		if (activityCache.length) {
			const [{ badge, clazz, priority }] = activityCache;
			if (badge instanceof NumberBadge && activityCache.length > 1) {
				const cumulativeNumberBadge = this.getCumulativeNumberBadge(activityCache, priority);
				activityAction.setBadge(cumulativeNumberBadge);
			} else {
				activityAction.setBadge(badge, clazz);
			}
		} else {
			activityAction.setBadge(undefined);
		}
	}

	private getCumulativeNumberBadge(activityCache: ICompositeActivity[], priority: number): NumberBadge {
		const numberActivities = activityCache.filter(activity => activity.badge instanceof NumberBadge && activity.priority === priority);
		const number = numberActivities.reduce((result, activity) => { return result + (<NumberBadge>activity.badge).number; }, 0);
		const descriptorFn = (): string => {
			return numberActivities.reduce((result, activity, index) => {
				result = result + (<NumberBadge>activity.badge).getDescription();
				if (index < numberActivities.length - 1) {
					result = `${result}\n`;
				}

				return result;
			}, '');
		};

		return new NumberBadge(number, descriptorFn);
	}

	private uninstallMenubar() {
		if (this.menuBar) {
			this.menuBar.dispose();
			this.menuBar = undefined;
		}

		if (this.menuBarContainer) {
			this.menuBarContainer.remove();
			this.menuBarContainer = undefined;
			this.registerKeyboardNavigationListeners();
		}
	}

	private installMenubar() {
		if (this.menuBar) {
			return; // prevent menu bar from installing twice #110720
		}

		this.menuBarContainer = document.createElement('div');
		this.menuBarContainer.classList.add('menubar');

		const content = assertIsDefined(this.content);
		if (this.homeBarContainer) {
			content.insertBefore(this.menuBarContainer, this.homeBarContainer.nextSibling);
		} else {
			content.prepend(this.menuBarContainer);
		}

		// Menubar: install a custom menu bar depending on configuration
		this.menuBar = this._register(this.instantiationService.createInstance(CustomMenubarControl));
		this.menuBar.create(this.menuBarContainer);

		this.registerKeyboardNavigationListeners();
	}

	createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;

		this.content = document.createElement('div');
		this.content.classList.add('content');
		parent.appendChild(this.content);

		// Home action bar
		const homeIndicator = this.environmentService.options?.homeIndicator;
		if (homeIndicator) {
			let codicon = iconRegistry.get(homeIndicator.icon);
			if (!codicon) {
				codicon = Codicon.code;
			}

			this.createHomeBar(homeIndicator.href, codicon);
			this.onDidChangeHomeBarVisibility();
		}

		// Install menubar if compact
		if (getMenuBarVisibility(this.configurationService) === 'compact') {
			this.installMenubar();
		}

		// View Containers action bar
		this.compositeBarContainer = this.compositeBar.create(this.content);

		// Global action bar
		this.globalActivitiesContainer = document.createElement('div');
		this.content.appendChild(this.globalActivitiesContainer);

		this.createGlobalActivityActionBar(this.globalActivitiesContainer);

		// Keyboard Navigation
		this.registerKeyboardNavigationListeners();

		return this.content;
	}

	private registerKeyboardNavigationListeners(): void {
		this.keyboardNavigationDisposables.clear();

		// Down arrow on home indicator
		if (this.homeBarContainer) {
			this.keyboardNavigationDisposables.add(addDisposableListener(this.homeBarContainer, EventType.KEY_DOWN, e => {
				const kbEvent = new StandardKeyboardEvent(e);
				if (kbEvent.equals(KeyCode.DownArrow) || kbEvent.equals(KeyCode.RightArrow)) {
					if (this.menuBar) {
						this.menuBar.toggleFocus();
					} else if (this.compositeBar) {
						this.compositeBar.focus();
					}
				}
			}));
		}

		// Up/Down arrow on compact menu
		if (this.menuBarContainer) {
			this.keyboardNavigationDisposables.add(addDisposableListener(this.menuBarContainer, EventType.KEY_DOWN, e => {
				const kbEvent = new StandardKeyboardEvent(e);
				if (kbEvent.equals(KeyCode.DownArrow) || kbEvent.equals(KeyCode.RightArrow)) {
					if (this.compositeBar) {
						this.compositeBar.focus();
					}
				} else if (kbEvent.equals(KeyCode.UpArrow) || kbEvent.equals(KeyCode.LeftArrow)) {
					if (this.homeBar) {
						this.homeBar.focus();
					}
				}
			}));
		}

		// Up/Down on Activity Icons
		if (this.compositeBarContainer) {
			this.keyboardNavigationDisposables.add(addDisposableListener(this.compositeBarContainer, EventType.KEY_DOWN, e => {
				const kbEvent = new StandardKeyboardEvent(e);
				if (kbEvent.equals(KeyCode.DownArrow) || kbEvent.equals(KeyCode.RightArrow)) {
					if (this.globalActivityActionBar) {
						this.globalActivityActionBar.focus(true);
					}
				} else if (kbEvent.equals(KeyCode.UpArrow) || kbEvent.equals(KeyCode.LeftArrow)) {
					if (this.menuBar) {
						this.menuBar.toggleFocus();
					} else if (this.homeBar) {
						this.homeBar.focus();
					}
				}
			}));
		}

		// Up arrow on global icons
		if (this.globalActivitiesContainer) {
			this.keyboardNavigationDisposables.add(addDisposableListener(this.globalActivitiesContainer, EventType.KEY_DOWN, e => {
				const kbEvent = new StandardKeyboardEvent(e);
				if (kbEvent.equals(KeyCode.UpArrow) || kbEvent.equals(KeyCode.LeftArrow)) {
					if (this.compositeBar) {
						this.compositeBar.focus(this.getVisibleViewContainerIds().length - 1);
					}
				}
			}));
		}
	}

	private createHomeBar(href: string, icon: Codicon): void {
		this.homeBarContainer = document.createElement('div');
		this.homeBarContainer.setAttribute('aria-label', nls.localize('homeIndicator', "Home"));
		this.homeBarContainer.setAttribute('role', 'toolbar');
		this.homeBarContainer.classList.add('home-bar');

		this.homeBar = this._register(new ActionBar(this.homeBarContainer, {
			actionViewItemProvider: action => this.instantiationService.createInstance(HomeActivityActionViewItem, href, action as ActivityAction, (theme: IColorTheme) => this.getActivitybarItemColors(theme)),
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: nls.localize('home', "Home"),
			animated: false,
			preventLoopNavigation: true,
			ignoreOrientationForPreviousAndNextKey: true
		}));

		const homeBarIconBadge = document.createElement('div');
		homeBarIconBadge.classList.add('home-bar-icon-badge');
		this.homeBarContainer.appendChild(homeBarIconBadge);

		this.homeBar.push(this._register(new ActivityAction({
			id: 'workbench.actions.home',
			name: nls.localize('home', "Home"),
			cssClass: icon.classNames
		})));

		const content = assertIsDefined(this.content);
		content.appendChild(this.homeBarContainer);
	}

	private createGlobalActivityActionBar(container: HTMLElement): void {
		this.globalActivityActionBar = this._register(new ActionBar(container, {
			actionViewItemProvider: action => {
				if (action.id === 'workbench.actions.manage') {
					return this.instantiationService.createInstance(GlobalActivityActionViewItem, action as ActivityAction, (theme: IColorTheme) => this.getActivitybarItemColors(theme));
				}

				if (action.id === 'workbench.actions.accounts') {
					return this.instantiationService.createInstance(AccountsActivityActionViewItem, action as ActivityAction, (theme: IColorTheme) => this.getActivitybarItemColors(theme));
				}

				throw new Error(`No view item for action '${action.id}'`);
			},
			orientation: ActionsOrientation.VERTICAL,
			ariaLabel: nls.localize('manage', "Manage"),
			animated: false,
			preventLoopNavigation: true,
			ignoreOrientationForPreviousAndNextKey: true
		}));

		this.globalActivityAction = this._register(new ActivityAction({
			id: 'workbench.actions.manage',
			name: nls.localize('manage', "Manage"),
			cssClass: ThemeIcon.asClassName(settingsViewBarIcon)
		}));

		if (this.accountsVisibilityPreference) {
			this.accountsActivityAction = this._register(new ActivityAction({
				id: 'workbench.actions.accounts',
				name: nls.localize('accounts', "Accounts"),
				cssClass: ThemeIcon.asClassName(accountsViewBarIcon)
			}));

			this.globalActivityActionBar.push(this.accountsActivityAction, { index: ActivitybarPart.ACCOUNTS_ACTION_INDEX });
		}

		this.globalActivityActionBar.push(this.globalActivityAction);
	}

	private toggleAccountsActivity() {
		if (this.globalActivityActionBar) {
			if (this.accountsActivityAction) {
				this.globalActivityActionBar.pull(ActivitybarPart.ACCOUNTS_ACTION_INDEX);
				this.accountsActivityAction = undefined;
			} else {
				this.accountsActivityAction = this._register(new ActivityAction({
					id: 'workbench.actions.accounts',
					name: nls.localize('accounts', "Accounts"),
					cssClass: Codicon.account.classNames
				}));
				this.globalActivityActionBar.push(this.accountsActivityAction, { index: ActivitybarPart.ACCOUNTS_ACTION_INDEX });
			}
		}

		this.updateGlobalActivity(ACCOUNTS_ACTIVITY_ID);
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
		this.removeComposite(viewContainer.id);
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

	private static toActivity(id: string, name: string, icon: URI | ThemeIcon | undefined, keybindingId: string | undefined): IActivity {
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
		} else if (ThemeIcon.isThemeIcon(icon)) {
			cssClass = ThemeIcon.asClassName(icon);
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
				if (this.viewDescriptorService.isViewContainerRemovedPermanently(id)) {
					this.removeComposite(id);
				} else {
					this.hideComposite(id);
				}
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

	private removeComposite(compositeId: string): void {
		this.compositeBar.removeComposite(compositeId);

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

	focusActivityBar(): void {
		this.compositeBar.focus();
	}

	updateStyles(): void {
		super.updateStyles();

		const container = assertIsDefined(this.getContainer());
		const background = this.getColor(ACTIVITY_BAR_BACKGROUND) || '';
		container.style.backgroundColor = background;

		const borderColor = this.getColor(ACTIVITY_BAR_BORDER) || this.getColor(contrastBorder) || '';
		container.classList.toggle('bordered', !!borderColor);
		container.style.borderColor = borderColor ? borderColor : '';
	}

	private getActivitybarItemColors(theme: IColorTheme): ICompositeBarColors {
		return {
			activeForegroundColor: theme.getColor(ACTIVITY_BAR_FOREGROUND),
			inactiveForegroundColor: theme.getColor(ACTIVITY_BAR_INACTIVE_FOREGROUND),
			activeBorderColor: theme.getColor(ACTIVITY_BAR_ACTIVE_BORDER),
			activeBackground: theme.getColor(ACTIVITY_BAR_ACTIVE_BACKGROUND),
			badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
			badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
			dragAndDropBorder: theme.getColor(ACTIVITY_BAR_DRAG_AND_DROP_BORDER),
			activeBackgroundColor: undefined, inactiveBackgroundColor: undefined, activeBorderBottomColor: undefined,
		};
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

	private onDidStorageValueChange(e: IStorageValueChangeEvent): void {
		if (e.key === ActivitybarPart.PINNED_VIEW_CONTAINERS && e.scope === StorageScope.GLOBAL
			&& this.pinnedViewContainersValue !== this.getStoredPinnedViewContainersValue() /* This checks if current window changed the value or not */) {
			this._pinnedViewContainersValue = undefined;
			this._cachedViewContainers = undefined;

			const newCompositeItems: ICompositeBarItem[] = [];
			const compositeItems = this.compositeBar.getCompositeBarItems();

			for (const cachedViewContainer of this.cachedViewContainers) {
				newCompositeItems.push({
					id: cachedViewContainer.id,
					name: cachedViewContainer.name,
					order: cachedViewContainer.order,
					pinned: cachedViewContainer.pinned,
					visible: !!compositeItems.find(({ id }) => id === cachedViewContainer.id)
				});
			}

			for (let index = 0; index < compositeItems.length; index++) {
				// Add items currently exists but does not exist in new.
				if (!newCompositeItems.some(({ id }) => id === compositeItems[index].id)) {
					newCompositeItems.splice(index, 0, compositeItems[index]);
				}
			}

			this.compositeBar.setCompositeBarItems(newCompositeItems);
		}

		if (e.key === HomeActivityActionViewItem.HOME_BAR_VISIBILITY_PREFERENCE && e.scope === StorageScope.GLOBAL) {
			this.onDidChangeHomeBarVisibility();
		}

		if (e.key === AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY && e.scope === StorageScope.GLOBAL) {
			this.toggleAccountsActivity();
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

	private _cachedViewContainers: ICachedViewContainer[] | undefined = undefined;
	private get cachedViewContainers(): ICachedViewContainer[] {
		if (this._cachedViewContainers === undefined) {
			this._cachedViewContainers = this.getPinnedViewContainers();
			for (const placeholderViewContainer of this.getPlaceholderViewContainers()) {
				const cachedViewContainer = this._cachedViewContainers.filter(cached => cached.id === placeholderViewContainer.id)[0];
				if (cachedViewContainer) {
					cachedViewContainer.name = placeholderViewContainer.name;
					cachedViewContainer.icon = placeholderViewContainer.themeIcon ? ThemeIcon.revive(placeholderViewContainer.themeIcon) :
						placeholderViewContainer.iconUrl ? URI.revive(placeholderViewContainer.iconUrl) : undefined;
					cachedViewContainer.views = placeholderViewContainer.views;
				}
			}
		}

		return this._cachedViewContainers;
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
			themeIcon: ThemeIcon.isThemeIcon(icon) ? icon : undefined,
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
		this.storageService.store(ActivitybarPart.PINNED_VIEW_CONTAINERS, value, StorageScope.GLOBAL, StorageTarget.USER);
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
		this.storageService.store(ActivitybarPart.PLACEHOLDER_VIEW_CONTAINERS, value, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private get homeBarVisibilityPreference(): boolean {
		return this.storageService.getBoolean(HomeActivityActionViewItem.HOME_BAR_VISIBILITY_PREFERENCE, StorageScope.GLOBAL, true);
	}

	private set homeBarVisibilityPreference(value: boolean) {
		this.storageService.store(HomeActivityActionViewItem.HOME_BAR_VISIBILITY_PREFERENCE, value, StorageScope.GLOBAL, StorageTarget.USER);
	}

	private get accountsVisibilityPreference(): boolean {
		return this.storageService.getBoolean(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, StorageScope.GLOBAL, true);
	}

	private set accountsVisibilityPreference(value: boolean) {
		this.storageService.store(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, value, StorageScope.GLOBAL, StorageTarget.USER);
	}

	toJSON(): object {
		return {
			type: Parts.ACTIVITYBAR_PART
		};
	}
}

class FocusActivityBarAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.focusActivityBar',
			title: { value: nls.localize('focusActivityBar', "Focus Activity Bar"), original: 'Focus Activity Bar' },
			category: CATEGORIES.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const activityBarService = accessor.get(IActivityBarService);
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setActivityBarHidden(false);
		activityBarService.focusActivityBar();
	}
}

registerSingleton(IActivityBarService, ActivitybarPart);
registerAction2(FocusActivityBarAction);
