/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/activityaction';
import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventType as TouchEventType, GestureEvent } from 'vs/base/browser/touch';
import { Action, IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IMenuService, MenuId, IMenu, registerAction2, Action2, IAction2Options } from 'vs/platform/actions/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { activeContrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { ICssStyleCollector, IColorTheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { ActivityAction, ActivityActionViewItem, ICompositeBar, ICompositeBarColors, ToggleCompositePinnedAction } from 'vs/workbench/browser/parts/compositeBarActions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { IActivity } from 'vs/workbench/common/activity';
import { ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_ACTIVE_BORDER, ACTIVITY_BAR_ACTIVE_FOCUS_BORDER, ACTIVITY_BAR_ACTIVE_BACKGROUND, ACTIVITY_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { getCurrentAuthenticationSessionInfo, IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { AuthenticationSession } from 'vs/editor/common/modes';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IProductService } from 'vs/platform/product/common/productService';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { getTitleBarStyle } from 'vs/platform/windows/common/windows';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export class ViewContainerActivityAction extends ActivityAction {

	private static readonly preventDoubleClickDelay = 300;

	private lastRun = 0;

	constructor(
		activity: IActivity,
		@IViewletService private readonly viewletService: IViewletService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(activity);
	}

	updateActivity(activity: IActivity): void {
		this.activity = activity;
	}

	async run(event: unknown): Promise<void> {
		if (event instanceof MouseEvent && event.button === 2) {
			return; // do not run on right click
		}

		// prevent accident trigger on a doubleclick (to help nervous people)
		const now = Date.now();
		if (now > this.lastRun /* https://github.com/microsoft/vscode/issues/25830 */ && now - this.lastRun < ViewContainerActivityAction.preventDoubleClickDelay) {
			return;
		}
		this.lastRun = now;

		const sideBarVisible = this.layoutService.isVisible(Parts.SIDEBAR_PART);
		const activeViewlet = this.viewletService.getActiveViewlet();
		const focusBehavior = this.configurationService.getValue<string>('workbench.activityBar.iconClickBehavior');

		if (sideBarVisible && activeViewlet?.getId() === this.activity.id) {
			switch (focusBehavior) {
				case 'focus':
					this.logAction('refocus');
					this.viewletService.openViewlet(this.activity.id, true);
					break;
				case 'toggle':
				default:
					// Hide sidebar if selected viewlet already visible
					this.logAction('hide');
					this.layoutService.setSideBarHidden(true);
					break;
			}

			return;
		}

		this.logAction('show');
		await this.viewletService.openViewlet(this.activity.id, true);

		return this.activate();
	}

	private logAction(action: string) {
		type ActivityBarActionClassification = {
			viewletId: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			action: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
		};
		this.telemetryService.publicLog2<{ viewletId: String, action: String }, ActivityBarActionClassification>('activityBarAction', { viewletId: this.activity.id, action });
	}
}

class MenuActivityActionViewItem extends ActivityActionViewItem {

	constructor(
		private readonly menuId: MenuId,
		action: ActivityAction,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		@IThemeService themeService: IThemeService,
		@IMenuService protected readonly menuService: IMenuService,
		@IContextMenuService protected readonly contextMenuService: IContextMenuService,
		@IContextKeyService protected readonly contextKeyService: IContextKeyService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService
	) {
		super(action, { draggable: false, colors, icon: true }, themeService);
	}

	render(container: HTMLElement): void {
		super.render(container);

		// Context menus are triggered on mouse down so that an item can be picked
		// and executed with releasing the mouse over it

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			DOM.EventHelper.stop(e, true);
			this.showContextMenu(e);
		}));

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.KEY_UP, (e: KeyboardEvent) => {
			let event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				DOM.EventHelper.stop(e, true);
				this.showContextMenu();
			}
		}));

		this._register(DOM.addDisposableListener(this.container, TouchEventType.Tap, (e: GestureEvent) => {
			DOM.EventHelper.stop(e, true);
			this.showContextMenu();
		}));
	}

	protected async showContextMenu(e?: MouseEvent): Promise<void> {
		const disposables = new DisposableStore();

		const menu = disposables.add(this.menuService.createMenu(this.menuId, this.contextKeyService));
		const actions = await this.resolveActions(menu, disposables);

		const isUsingCustomMenu = isWeb || (getTitleBarStyle(this.configurationService) !== 'native' && !isMacintosh); // see #40262
		const position = this.configurationService.getValue('workbench.sideBar.location');

		this.contextMenuService.showContextMenu({
			getAnchor: () => isUsingCustomMenu ? this.container : e || this.container,
			anchorAlignment: isUsingCustomMenu ? (position === 'left' ? AnchorAlignment.RIGHT : AnchorAlignment.LEFT) : undefined,
			anchorAxisAlignment: isUsingCustomMenu ? AnchorAxisAlignment.HORIZONTAL : AnchorAxisAlignment.VERTICAL,
			getActions: () => actions,
			onHide: () => disposables.dispose()
		});
	}

	protected async resolveActions(menu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		const actions: IAction[] = [];

		disposables.add(createAndFillInActionBarActions(menu, undefined, { primary: [], secondary: actions }));

		return actions;
	}
}

export class HomeActivityActionViewItem extends MenuActivityActionViewItem {

	static readonly HOME_BAR_VISIBILITY_PREFERENCE = 'workbench.activity.showHomeIndicator';

	constructor(
		private readonly goHomeHref: string,
		action: ActivityAction,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		@IThemeService themeService: IThemeService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(MenuId.MenubarHomeMenu, action, colors, themeService, menuService, contextMenuService, contextKeyService, configurationService, environmentService);
	}

	protected async resolveActions(homeMenu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		const actions = [];

		// Go Home
		actions.push(disposables.add(new Action('goHome', nls.localize('goHome', "Go Home"), undefined, true, async () => window.location.href = this.goHomeHref)));
		actions.push(disposables.add(new Separator()));

		// Contributed
		const contributedActions = await super.resolveActions(homeMenu, disposables);
		actions.push(...contributedActions);

		// Hide
		if (contributedActions.length > 0) {
			actions.push(disposables.add(new Separator()));
		}
		actions.push(disposables.add(new Action('hide', nls.localize('hide', "Hide"), undefined, true, async () => {
			this.storageService.store(HomeActivityActionViewItem.HOME_BAR_VISIBILITY_PREFERENCE, false, StorageScope.GLOBAL, StorageTarget.USER);
		})));

		return actions;
	}
}

export class AccountsActivityActionViewItem extends MenuActivityActionViewItem {

	static readonly ACCOUNTS_VISIBILITY_PREFERENCE_KEY = 'workbench.activity.showAccounts';

	constructor(
		action: ActivityAction,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(MenuId.AccountsContext, action, colors, themeService, menuService, contextMenuService, contextKeyService, configurationService, environmentService);
	}

	protected async resolveActions(accountsMenu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		await super.resolveActions(accountsMenu, disposables);

		const otherCommands = accountsMenu.getActions();
		const providers = this.authenticationService.getProviderIds();
		const allSessions = providers.map(async providerId => {
			try {
				const sessions = await this.authenticationService.getSessions(providerId);

				const groupedSessions: { [label: string]: AuthenticationSession[] } = {};
				sessions.forEach(session => {
					if (groupedSessions[session.account.label]) {
						groupedSessions[session.account.label].push(session);
					} else {
						groupedSessions[session.account.label] = [session];
					}
				});

				return { providerId, sessions: groupedSessions };
			} catch {
				return { providerId };
			}
		});

		const result = await Promise.all(allSessions);
		let menus: IAction[] = [];
		const authenticationSession = this.environmentService.options?.credentialsProvider ? await getCurrentAuthenticationSessionInfo(this.environmentService, this.productService) : undefined;
		result.forEach(sessionInfo => {
			const providerDisplayName = this.authenticationService.getLabel(sessionInfo.providerId);

			if (sessionInfo.sessions) {
				Object.keys(sessionInfo.sessions).forEach(accountName => {
					const manageExtensionsAction = disposables.add(new Action(`configureSessions${accountName}`, nls.localize('manageTrustedExtensions', "Manage Trusted Extensions"), '', true, () => {
						return this.authenticationService.manageTrustedExtensionsForAccount(sessionInfo.providerId, accountName);
					}));

					const signOutAction = disposables.add(new Action('signOut', nls.localize('signOut', "Sign Out"), '', true, () => {
						return this.authenticationService.signOutOfAccount(sessionInfo.providerId, accountName);
					}));

					const providerSubMenuActions = [manageExtensionsAction];

					const hasEmbedderAccountSession = sessionInfo.sessions[accountName].some(session => session.id === (authenticationSession?.id));
					if (!hasEmbedderAccountSession || authenticationSession?.canSignOut) {
						providerSubMenuActions.push(signOutAction);
					}

					const providerSubMenu = disposables.add(new SubmenuAction('activitybar.submenu', `${accountName} (${providerDisplayName})`, providerSubMenuActions));
					menus.push(providerSubMenu);
				});
			} else {
				const providerUnavailableAction = disposables.add(new Action('providerUnavailable', nls.localize('authProviderUnavailable', '{0} is currently unavailable', providerDisplayName)));
				menus.push(providerUnavailableAction);
			}
		});

		if (menus.length && otherCommands.length) {
			menus.push(disposables.add(new Separator()));
		}

		otherCommands.forEach((group, i) => {
			const actions = group[1];
			menus = menus.concat(actions);
			if (i !== otherCommands.length - 1) {
				menus.push(disposables.add(new Separator()));
			}
		});

		if (menus.length) {
			menus.push(disposables.add(new Separator()));
		}

		menus.push(disposables.add(new Action('hide', nls.localize('hide', "Hide"), undefined, true, async () => {
			this.storageService.store(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, false, StorageScope.GLOBAL, StorageTarget.USER);
		})));

		return menus;
	}
}

export class GlobalActivityActionViewItem extends MenuActivityActionViewItem {

	constructor(
		action: ActivityAction,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		@IThemeService themeService: IThemeService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService
	) {
		super(MenuId.GlobalActivity, action, colors, themeService, menuService, contextMenuService, contextKeyService, configurationService, environmentService);
	}
}

export class PlaceHolderViewContainerActivityAction extends ViewContainerActivityAction { }

export class PlaceHolderToggleCompositePinnedAction extends ToggleCompositePinnedAction {

	constructor(id: string, compositeBar: ICompositeBar) {
		super({ id, name: id, cssClass: undefined }, compositeBar);
	}

	setActivity(activity: IActivity): void {
		this.label = activity.name;
	}
}

class SwitchSideBarViewAction extends Action2 {

	constructor(
		desc: Readonly<IAction2Options>,
		private readonly offset: number
	) {
		super(desc);
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const activityBarService = accessor.get(IActivityBarService);
		const viewletService = accessor.get(IViewletService);

		const visibleViewletIds = activityBarService.getVisibleViewContainerIds();

		const activeViewlet = viewletService.getActiveViewlet();
		if (!activeViewlet) {
			return;
		}
		let targetViewletId: string | undefined;
		for (let i = 0; i < visibleViewletIds.length; i++) {
			if (visibleViewletIds[i] === activeViewlet.getId()) {
				targetViewletId = visibleViewletIds[(i + visibleViewletIds.length + this.offset) % visibleViewletIds.length];
				break;
			}
		}

		await viewletService.openViewlet(targetViewletId, true);
	}
}

registerAction2(
	class PreviousSideBarViewAction extends SwitchSideBarViewAction {
		constructor() {
			super({
				id: 'workbench.action.previousSideBarView',
				title: { value: nls.localize('previousSideBarView', "Previous Side Bar View"), original: 'Previous Side Bar View' },
				category: CATEGORIES.View,
				f1: true
			}, -1);
		}
	}
);

registerAction2(
	class NextSideBarViewAction extends SwitchSideBarViewAction {
		constructor() {
			super({
				id: 'workbench.action.nextSideBarView',
				title: { value: nls.localize('nextSideBarView', "Next Side Bar View"), original: 'Next Side Bar View' },
				category: CATEGORIES.View,
				f1: true
			}, 1);
		}
	}
);

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const activityBarBackgroundColor = theme.getColor(ACTIVITY_BAR_BACKGROUND);
	if (activityBarBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content > .home-bar > .home-bar-icon-badge {
				background-color: ${activityBarBackgroundColor};
			}
		`);
	}

	const activityBarForegroundColor = theme.getColor(ACTIVITY_BAR_FOREGROUND);
	if (activityBarForegroundColor) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active .action-label:not(.codicon),
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus .action-label:not(.codicon),
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:hover .action-label:not(.codicon) {
				background-color: ${activityBarForegroundColor} !important;
			}
			.monaco-workbench .activitybar > .content .home-bar > .monaco-action-bar .action-item .action-label.codicon,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active .action-label.codicon,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus .action-label.codicon,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:hover .action-label.codicon {
				color: ${activityBarForegroundColor} !important;
			}
		`);
	}

	const activityBarActiveBorderColor = theme.getColor(ACTIVITY_BAR_ACTIVE_BORDER);
	if (activityBarActiveBorderColor) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked .active-item-indicator:before {
				border-left-color: ${activityBarActiveBorderColor};
			}
		`);
	}

	const activityBarActiveFocusBorderColor = theme.getColor(ACTIVITY_BAR_ACTIVE_FOCUS_BORDER);
	if (activityBarActiveFocusBorderColor) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked:focus::before {
				visibility: hidden;
			}

			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked:focus .active-item-indicator:before {
				visibility: visible;
				border-left-color: ${activityBarActiveFocusBorderColor};
			}
		`);
	}

	const activityBarActiveBackgroundColor = theme.getColor(ACTIVITY_BAR_ACTIVE_BACKGROUND);
	if (activityBarActiveBackgroundColor) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked .active-item-indicator {
				z-index: 0;
				background-color: ${activityBarActiveBackgroundColor};
			}
		`);
	}

	// Styling with Outline color (e.g. high contrast theme)
	const outline = theme.getColor(activeContrastBorder);
	if (outline) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:before {
				content: "";
				position: absolute;
				top: 9px;
				left: 9px;
				height: 32px;
				width: 32px;
				z-index: 1;
			}

			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active:hover:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked:hover:before {
				outline: 1px solid;
			}

			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:hover:before {
				outline: 1px dashed;
			}

			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus:before {
				border-left-color: ${outline};
			}

			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active:hover:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked:hover:before,
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:hover:before {
				outline-color: ${outline};
			}
		`);
	}

	// Styling without outline color
	else {
		const focusBorderColor = theme.getColor(focusBorder);
		if (focusBorderColor) {
			collector.addRule(`
					.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus:before {
						border-left-color: ${focusBorderColor};
					}
				`);
		}
	}
});
