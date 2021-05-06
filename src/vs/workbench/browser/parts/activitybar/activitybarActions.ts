/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/activityaction';
import { localize } from 'vs/nls';
import { EventType, addDisposableListener, EventHelper } from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventType as TouchEventType, GestureEvent } from 'vs/base/browser/touch';
import { Action, IAction, Separator, SubmenuAction, toAction } from 'vs/base/common/actions';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IMenuService, MenuId, IMenu, registerAction2, Action2, IAction2Options } from 'vs/platform/actions/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { activeContrastBorder, focusBorder } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { ActivityAction, ActivityActionViewItem, IActivityHoverOptions, ICompositeBar, ICompositeBarColors, ToggleCompositePinnedAction } from 'vs/workbench/browser/parts/compositeBarActions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { IActivity } from 'vs/workbench/common/activity';
import { ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_ACTIVE_BORDER, ACTIVITY_BAR_ACTIVE_FOCUS_BORDER, ACTIVITY_BAR_ACTIVE_BACKGROUND } from 'vs/workbench/common/theme';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { getCurrentAuthenticationSessionInfo, IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { AuthenticationSession } from 'vs/editor/common/modes';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IProductService } from 'vs/platform/product/common/productService';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { getTitleBarStyle } from 'vs/platform/windows/common/windows';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';

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

	override async run(event: unknown): Promise<void> {
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
			viewletId: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			action: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
		};
		this.telemetryService.publicLog2<{ viewletId: String, action: String; }, ActivityBarActionClassification>('activityBarAction', { viewletId: this.activity.id, action });
	}
}

class MenuActivityActionViewItem extends ActivityActionViewItem {

	constructor(
		private readonly menuId: MenuId,
		action: ActivityAction,
		private contextMenuActionsProvider: () => IAction[],
		colors: (theme: IColorTheme) => ICompositeBarColors,
		hoverOptions: IActivityHoverOptions,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService protected readonly menuService: IMenuService,
		@IContextMenuService protected readonly contextMenuService: IContextMenuService,
		@IContextKeyService protected readonly contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super(action, { draggable: false, colors, icon: true, hasPopup: true, hoverOptions }, themeService, hoverService, configurationService, keybindingService);
	}

	override render(container: HTMLElement): void {
		super.render(container);

		// Context menus are triggered on mouse down so that an item can be picked
		// and executed with releasing the mouse over it

		this._register(addDisposableListener(this.container, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			EventHelper.stop(e, true);
			this.showContextMenu(e);
		}));

		this._register(addDisposableListener(this.container, EventType.KEY_UP, (e: KeyboardEvent) => {
			let event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				EventHelper.stop(e, true);
				this.showContextMenu();
			}
		}));

		this._register(addDisposableListener(this.container, TouchEventType.Tap, (e: GestureEvent) => {
			EventHelper.stop(e, true);
			this.showContextMenu();
		}));
	}

	private async showContextMenu(e?: MouseEvent): Promise<void> {
		const disposables = new DisposableStore();

		let actions: IAction[];
		if (e?.button !== 2) {
			const menu = disposables.add(this.menuService.createMenu(this.menuId, this.contextKeyService));
			actions = await this.resolveMainMenuActions(menu, disposables);
		} else {
			actions = await this.resolveContextMenuActions(disposables);
		}

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

	protected async resolveMainMenuActions(menu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		const actions: IAction[] = [];

		disposables.add(createAndFillInActionBarActions(menu, undefined, { primary: [], secondary: actions }));

		return actions;
	}

	protected async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		return this.contextMenuActionsProvider();
	}
}

export class AccountsActivityActionViewItem extends MenuActivityActionViewItem {

	static readonly ACCOUNTS_VISIBILITY_PREFERENCE_KEY = 'workbench.activity.showAccounts';

	constructor(
		action: ActivityAction,
		contextMenuActionsProvider: () => IAction[],
		colors: (theme: IColorTheme) => ICompositeBarColors,
		activityHoverOptions: IActivityHoverOptions,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super(MenuId.AccountsContext, action, contextMenuActionsProvider, colors, activityHoverOptions, themeService, hoverService, menuService, contextMenuService, contextKeyService, configurationService, environmentService, keybindingService);
	}

	protected override async resolveMainMenuActions(accountsMenu: IMenu, disposables: DisposableStore): Promise<IAction[]> {
		await super.resolveMainMenuActions(accountsMenu, disposables);

		const otherCommands = accountsMenu.getActions();
		const providers = this.authenticationService.getProviderIds();
		const allSessions = providers.map(async providerId => {
			try {
				const sessions = await this.authenticationService.getSessions(providerId);

				const groupedSessions: { [label: string]: AuthenticationSession[]; } = {};
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
					const manageExtensionsAction = disposables.add(new Action(`configureSessions${accountName}`, localize('manageTrustedExtensions', "Manage Trusted Extensions"), '', true, () => {
						return this.authenticationService.manageTrustedExtensionsForAccount(sessionInfo.providerId, accountName);
					}));

					const signOutAction = disposables.add(new Action('signOut', localize('signOut', "Sign Out"), '', true, () => {
						return this.authenticationService.removeAccountSessions(sessionInfo.providerId, accountName, sessionInfo.sessions[accountName]);
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
				const providerUnavailableAction = disposables.add(new Action('providerUnavailable', localize('authProviderUnavailable', '{0} is currently unavailable', providerDisplayName)));
				menus.push(providerUnavailableAction);
			}
		});

		if (providers.length && !menus.length) {
			const noAccountsAvailableAction = disposables.add(new Action('noAccountsAvailable', localize('noAccounts', "You are not signed in to any accounts"), undefined, false));
			menus.push(noAccountsAvailableAction);
		}

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

		return menus;
	}

	protected override async resolveContextMenuActions(disposables: DisposableStore): Promise<IAction[]> {
		const actions = await super.resolveContextMenuActions(disposables);

		actions.unshift(...[
			toAction({ id: 'hideAccounts', label: localize('hideAccounts', "Hide Accounts"), run: () => this.storageService.store(AccountsActivityActionViewItem.ACCOUNTS_VISIBILITY_PREFERENCE_KEY, false, StorageScope.GLOBAL, StorageTarget.USER) }),
			new Separator()
		]);

		return actions;
	}
}

export class GlobalActivityActionViewItem extends MenuActivityActionViewItem {

	constructor(
		action: ActivityAction,
		contextMenuActionsProvider: () => IAction[],
		colors: (theme: IColorTheme) => ICompositeBarColors,
		activityHoverOptions: IActivityHoverOptions,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IMenuService menuService: IMenuService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super(MenuId.GlobalActivity, action, contextMenuActionsProvider, colors, activityHoverOptions, themeService, hoverService, menuService, contextMenuService, contextKeyService, configurationService, environmentService, keybindingService);
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
				title: { value: localize('previousSideBarView', "Previous Side Bar View"), original: 'Previous Side Bar View' },
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
				title: { value: localize('nextSideBarView', "Next Side Bar View"), original: 'Next Side Bar View' },
				category: CATEGORIES.View,
				f1: true
			}, 1);
		}
	}
);

registerThemingParticipant((theme, collector) => {
	const activityBarForegroundColor = theme.getColor(ACTIVITY_BAR_FOREGROUND);
	if (activityBarForegroundColor) {
		collector.addRule(`
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active .action-label:not(.codicon),
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus .action-label:not(.codicon),
			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:hover .action-label:not(.codicon) {
				background-color: ${activityBarForegroundColor} !important;
			}
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

			.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus .active-item-indicator:before {
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
				.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus .active-item-indicator:before {
						border-left-color: ${focusBorderColor};
					}
				`);
		}
	}
});
