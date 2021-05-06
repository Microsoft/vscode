/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action, IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, IColorTheme, registerThemingParticipant, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { switchTerminalActionViewItemSeparator, switchTerminalShowTabsTitle } from 'vs/workbench/contrib/terminal/browser/terminalActions';
import { TERMINAL_BACKGROUND_COLOR, TERMINAL_BORDER_COLOR } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { INotificationService, IPromptChoice, Severity } from 'vs/platform/notification/common/notification';
import { ITerminalInstance, ITerminalService, TerminalConnectionState } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { PANEL_BACKGROUND, SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IMenu, IMenuService, MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { ITerminalProfile, TerminalCommandId, TerminalSettingId } from 'vs/workbench/contrib/terminal/common/terminal';
import { ActionViewItem, SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { attachSelectBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { selectBorder } from 'vs/platform/theme/common/colorRegistry';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { TerminalTabbedView } from 'vs/workbench/contrib/terminal/browser/terminalTabbedView';
import { Codicon } from 'vs/base/common/codicons';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { DropdownWithPrimaryActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownWithPrimaryActionViewItem';
import { reset } from 'vs/base/browser/dom';
import { renderLabelWithIcons } from 'vs/base/browser/ui/iconLabel/iconLabels';
import { getColorForSeverity } from 'vs/workbench/contrib/terminal/browser/terminalStatusList';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { TerminalTabContextMenuGroup } from 'vs/workbench/contrib/terminal/browser/terminalMenus';

export class TerminalViewPane extends ViewPane {
	private _actions: IAction[] | undefined;
	private _fontStyleElement: HTMLElement | undefined;
	private _parentDomElement: HTMLElement | undefined;
	private _tabsViewWrapper: HTMLElement | undefined;
	private _terminalTabbedView?: TerminalTabbedView;
	get terminalTabbedView(): TerminalTabbedView | undefined { return this._terminalTabbedView; }
	private _terminalsInitialized = false;
	private _bodyDimensions: { width: number, height: number } = { width: 0, height: 0 };
	private _isWelcomeShowing: boolean = false;
	private _tabButtons: DropdownWithPrimaryActionViewItem | undefined;
	private readonly _dropdownMenu: IMenu;
	private readonly _singleTabMenu: IMenu;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IMenuService private readonly _menuService: IMenuService,
		@ICommandService private readonly _commandService: ICommandService,
		@ITerminalContributionService private readonly _terminalContributionService: ITerminalContributionService
	) {
		super(options, keybindingService, _contextMenuService, configurationService, _contextKeyService, viewDescriptorService, _instantiationService, openerService, themeService, telemetryService);
		this._terminalService.onDidRegisterProcessSupport(() => {
			if (this._actions) {
				for (const action of this._actions) {
					action.enabled = true;
				}
			}
			this._onDidChangeViewWelcomeState.fire();
		});
		this._terminalService.onInstanceCreated(() => {
			if (!this._isWelcomeShowing) {
				return;
			}
			this._isWelcomeShowing = true;
			this._onDidChangeViewWelcomeState.fire();
			if (!this._terminalTabbedView && this._parentDomElement) {
				this._createTabsView();
				this.layoutBody(this._parentDomElement.offsetHeight, this._parentDomElement.offsetWidth);
			}
		});

		this._dropdownMenu = this._register(this._menuService.createMenu(MenuId.TerminalNewDropdownContext, this._contextKeyService));
		this._singleTabMenu = this._register(this._menuService.createMenu(MenuId.TerminalInlineTabContext, this._contextKeyService));
		this._register(this._terminalService.onDidChangeAvailableProfiles(profiles => this._updateTabActionBar(profiles)));
	}

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._parentDomElement = container;
		this._parentDomElement.classList.add('integrated-terminal');
		this._fontStyleElement = document.createElement('style');

		if (!this.shouldShowWelcome()) {
			this._createTabsView();
		}

		this._parentDomElement.appendChild(this._fontStyleElement);

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TerminalSettingId.FontFamily) || e.affectsConfiguration('editor.fontFamily')) {
				const configHelper = this._terminalService.configHelper;
				if (!configHelper.configFontIsMonospace()) {
					const choices: IPromptChoice[] = [{
						label: nls.localize('terminal.useMonospace', "Use 'monospace'"),
						run: () => this.configurationService.updateValue(TerminalSettingId.FontFamily, 'monospace'),
					}];
					this._notificationService.prompt(Severity.Warning, nls.localize('terminal.monospaceOnly', "The terminal only supports monospace fonts. Be sure to restart VS Code if this is a newly installed font."), choices);
				}
			}
		}));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				const hadTerminals = !!this._terminalService.terminalGroups.length;
				if (this._terminalService.isProcessSupportRegistered) {
					if (this._terminalsInitialized) {
						if (!hadTerminals) {
							this._terminalService.createTerminal();
						}
					} else {
						this._terminalsInitialized = true;
						this._terminalService.initializeTerminals();
					}
				}

				if (hadTerminals) {
					this._terminalService.getActiveGroup()?.setVisible(visible);
				} else {
					// TODO@Tyriar - this call seems unnecessary
					this.layoutBody(this._bodyDimensions.height, this._bodyDimensions.width);
				}
				this._terminalService.showPanel(true);
			} else {
				this._terminalService.getActiveGroup()?.setVisible(false);
			}
		}));
		this.layoutBody(this._parentDomElement.offsetHeight, this._parentDomElement.offsetWidth);
	}

	private _createTabsView(): void {
		if (!this._parentDomElement) {
			return;
		}
		this._tabsViewWrapper = document.createElement('div');
		this._tabsViewWrapper.classList.add('tabs-view-wrapper');
		this._terminalTabbedView = this.instantiationService.createInstance(TerminalTabbedView, this._parentDomElement);
		this._parentDomElement.append(this._tabsViewWrapper);
	}

	// eslint-disable-next-line @typescript-eslint/naming-convention
	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		if (this._terminalTabbedView) {
			this._bodyDimensions.width = width;
			this._bodyDimensions.height = height;

			this._terminalTabbedView.layout(width, height);
		}
	}

	override getActionViewItem(action: Action): IActionViewItem | undefined {
		switch (action.id) {
			case TerminalCommandId.SwitchTerminal: {
				return this._instantiationService.createInstance(SwitchTerminalActionViewItem, action);
			}
			case TerminalCommandId.Focus: {
				const actions: IAction[] = [];
				createAndFillInContextMenuActions(this._singleTabMenu, undefined, actions);
				return this._instantiationService.createInstance(SingleTerminalTabActionViewItem, action, actions);
			}
			case TerminalCommandId.CreateWithProfileButton: {
				if (this._tabButtons) {
					this._tabButtons.dispose();
				}
				const actions = this._getTabActionBarArgs(this._terminalService.availableProfiles);
				this._tabButtons = new DropdownWithPrimaryActionViewItem(actions.primaryAction, actions.dropdownAction, actions.dropdownMenuActions, actions.className, this._contextMenuService);
				this._updateTabActionBar(this._terminalService.availableProfiles);
				return this._tabButtons;
			}
		}
		return super.getActionViewItem(action);
	}

	private _updateTabActionBar(profiles: ITerminalProfile[]): void {
		const actions = this._getTabActionBarArgs(profiles);
		this._tabButtons?.update(actions.dropdownAction, actions.dropdownMenuActions, actions.dropdownIcon);
	}

	private _getTabActionBarArgs(profiles: ITerminalProfile[]): {
		primaryAction: MenuItemAction,
		dropdownAction: IAction,
		dropdownMenuActions: IAction[],
		className: string,
		dropdownIcon?: string
	} {
		const dropdownActions: IAction[] = [];
		const submenuActions: IAction[] = [];

		for (const p of profiles) {
			dropdownActions.push(new MenuItemAction({ id: TerminalCommandId.NewWithProfile, title: p.profileName, category: TerminalTabContextMenuGroup.Profile }, undefined, { arg: p, shouldForwardArgs: true }, this._contextKeyService, this._commandService));
			submenuActions.push(new MenuItemAction({ id: TerminalCommandId.Split, title: p.profileName, category: TerminalTabContextMenuGroup.Profile }, undefined, { arg: p, shouldForwardArgs: true }, this._contextKeyService, this._commandService));
		}

		for (const contributed of this._terminalContributionService.terminalTypes) {
			dropdownActions.push(new MenuItemAction({ id: contributed.command, title: contributed.title, category: TerminalTabContextMenuGroup.Profile }, undefined, undefined, this._contextKeyService, this._commandService));
		}

		if (dropdownActions.length > 0) {
			dropdownActions.push(new SubmenuAction('split.profile', 'Split...', submenuActions));
			dropdownActions.push(new Separator());
		}

		for (const [, configureActions] of this._dropdownMenu.getActions()) {
			for (const action of configureActions) {
				// make sure the action is a MenuItemAction
				if ('alt' in action) {
					dropdownActions.push(action);
				}
			}
		}

		const primaryAction = this._instantiationService.createInstance(MenuItemAction, { id: TerminalCommandId.New, title: nls.localize('terminal.new', "New Terminal"), icon: Codicon.plus }, undefined, undefined);
		const dropdownAction = new Action('refresh profiles', 'Launch Profile...', 'codicon-chevron-down', true);
		return { primaryAction, dropdownAction, dropdownMenuActions: dropdownActions, className: 'terminal-tab-actions' };
	}

	override focus() {
		if (this._terminalService.connectionState === TerminalConnectionState.Connecting) {
			// If the terminal is waiting to reconnect to remote terminals, then there is no TerminalInstance yet that can
			// be focused. So wait for connection to finish, then focus.
			const activeElement = document.activeElement;
			this._register(this._terminalService.onDidChangeConnectionState(() => {
				// Only focus the terminal if the activeElement has not changed since focus() was called
				// TODO hack
				if (document.activeElement === activeElement) {
					this._focus();
				}
			}));

			return;
		}
		this._focus();
	}

	private _focus() {
		this._terminalService.getActiveInstance()?.focusWhenReady();
	}

	override shouldShowWelcome(): boolean {
		this._isWelcomeShowing = !this._terminalService.isProcessSupportRegistered && this._terminalService.terminalInstances.length === 0;
		return this._isWelcomeShowing;
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const panelBackgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(PANEL_BACKGROUND);
	collector.addRule(`.monaco-workbench .part.panel .pane-body.integrated-terminal .terminal-outer-container { background-color: ${panelBackgroundColor ? panelBackgroundColor.toString() : ''}; }`);

	const sidebarBackgroundColor = theme.getColor(TERMINAL_BACKGROUND_COLOR) || theme.getColor(SIDE_BAR_BACKGROUND);
	collector.addRule(`.monaco-workbench .part.sidebar .pane-body.integrated-terminal .terminal-outer-container { background-color: ${sidebarBackgroundColor ? sidebarBackgroundColor.toString() : ''}; }`);

	const borderColor = theme.getColor(TERMINAL_BORDER_COLOR);
	if (borderColor) {
		collector.addRule(`.monaco-workbench .pane-body.integrated-terminal .split-view-view:not(:first-child) { border-color: ${borderColor.toString()}; }`);
	}
});


class SwitchTerminalActionViewItem extends SelectActionViewItem {
	constructor(
		action: IAction,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService private readonly _themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService
	) {
		super(null, action, getTerminalSelectOpenItems(_terminalService), _terminalService.activeTabIndex, contextViewService, { ariaLabel: nls.localize('terminals', 'Open Terminals.'), optionsAsChildren: true });
		this._register(_terminalService.onInstancesChanged(() => this._updateItems(), this));
		this._register(_terminalService.onActiveTabChanged(() => this._updateItems(), this));
		this._register(_terminalService.onInstanceTitleChanged(() => this._updateItems(), this));
		this._register(_terminalService.onTabDisposed(() => this._updateItems(), this));
		this._register(_terminalService.onDidChangeConnectionState(() => this._updateItems(), this));
		this._register(_terminalService.onDidChangeAvailableProfiles(() => this._updateItems(), this));
		this._register(attachSelectBoxStyler(this.selectBox, this._themeService));
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('switch-terminal');
		this._register(attachStylerCallback(this._themeService, { selectBorder }, colors => {
			container.style.borderColor = colors.selectBorder ? `${colors.selectBorder}` : '';
		}));
	}

	private _updateItems(): void {
		const options = getTerminalSelectOpenItems(this._terminalService);
		this.setOptions(options, this._terminalService.activeTabIndex);
	}
}

function getTerminalSelectOpenItems(terminalService: ITerminalService): ISelectOptionItem[] {
	let items: ISelectOptionItem[];
	if (terminalService.connectionState === TerminalConnectionState.Connected) {
		items = terminalService.getTabLabels().map(label => {
			return { text: label };
		});
	} else {
		items = [{ text: nls.localize('terminalConnectingLabel', "Starting...") }];
	}
	items.push({ text: switchTerminalActionViewItemSeparator, isDisabled: true });
	items.push({ text: switchTerminalShowTabsTitle });
	return items;
}

class SingleTerminalTabActionViewItem extends ActionViewItem {
	constructor(
		action: IAction,
		private readonly _actions: IAction[],
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService private readonly _themeService: IThemeService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
	) {
		super(undefined, {
			...action,
			dispose: () => action.dispose(),
			run: async () => this._run(),
			label: getSingleTabLabel(_terminalService.getActiveInstance())
		});
		this._register(this._terminalService.onInstancePrimaryStatusChanged(() => this.updateLabel()));
		this._register(this._terminalService.onActiveInstanceChanged(() => this.updateLabel()));
		this._register(this._terminalService.onInstancesChanged(() => this.updateLabel()));
		this._register(this._terminalService.onInstanceTitleChanged(e => {
			if (e === this._terminalService.getActiveInstance()) {
				this.updateLabel();
			}
		}));
		this._register(this._terminalService.onInstanceIconChanged(e => {
			if (e === this._terminalService.getActiveInstance()) {
				this.updateLabel();
			}
		}));
	}

	override updateLabel(): void {
		if (this.label) {
			const label = this.label;
			const instance = this._terminalService.getActiveInstance();
			if (!instance) {
				reset(label, '');
				return;
			}
			label.classList.add('single-terminal-tab');
			let colorStyle = '';
			const primaryStatus = instance.statusList.primary;
			if (primaryStatus) {
				const colorKey = getColorForSeverity(primaryStatus.severity);
				this._themeService.getColorTheme();
				const foundColor = this._themeService.getColorTheme().getColor(colorKey);
				if (foundColor) {
					colorStyle = foundColor.toString();
				}
			}
			label.style.color = colorStyle;
			reset(label, ...renderLabelWithIcons(getSingleTabLabel(instance)));
		}
	}

	private _run() {
		this._contextMenuService.showContextMenu({
			getAnchor: () => this.element!,
			getActions: () => this._actions,
			getActionsContext: () => this.label
		});
	}
}

function getSingleTabLabel(instance: ITerminalInstance | null) {
	if (!instance || !instance.title) {
		return '';
	}
	const primaryStatus = instance.statusList.primary;
	let label = `$(${instance.icon?.id}) ${instance.title}`;
	if (instance.shellLaunchConfig.description) {
		label += ` (${instance.shellLaunchConfig.description})`;
	}
	if (primaryStatus?.icon) {
		label += ` $(${primaryStatus.icon.id})`;
	}
	return label;
}
