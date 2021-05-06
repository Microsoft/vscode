/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./menuEntryActionViewItem';
import { asCSSUrl, ModifierKeyEmitter } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { IDisposable, toDisposable, MutableDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { ICommandAction, IMenu, IMenuActionOptions, MenuItemAction, SubmenuItemAction, Icon } from 'vs/platform/actions/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { UILabelProvider } from 'vs/base/common/keybindingLabels';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { isWindows, isLinux, OS } from 'vs/base/common/platform';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

export function createAndFillInContextMenuActions(menu: IMenu, options: IMenuActionOptions | undefined, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, primaryGroup?: string): IDisposable {
	const groups = menu.getActions(options);
	const modifierKeyEmitter = ModifierKeyEmitter.getInstance();
	const useAlternativeActions = modifierKeyEmitter.keyStatus.altKey || ((isWindows || isLinux) && modifierKeyEmitter.keyStatus.shiftKey);
	fillInActions(groups, target, useAlternativeActions, primaryGroup);
	return asDisposable(groups);
}

export function createAndFillInActionBarActions(menu: IMenu, options: IMenuActionOptions | undefined, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, primaryGroup?: string, primaryMaxCount?: number, shouldInlineSubmenu?: (action: SubmenuAction, group: string, groupSize: number) => boolean): IDisposable {
	const groups = menu.getActions(options);
	// Action bars handle alternative actions on their own so the alternative actions should be ignored
	fillInActions(groups, target, false, primaryGroup, primaryMaxCount, shouldInlineSubmenu);
	return asDisposable(groups);
}

function asDisposable(groups: ReadonlyArray<[string, ReadonlyArray<MenuItemAction | SubmenuItemAction>]>): IDisposable {
	const disposables = new DisposableStore();
	for (const [, actions] of groups) {
		for (const action of actions) {
			disposables.add(action);
		}
	}
	return disposables;
}


function fillInActions(
	groups: ReadonlyArray<[string, ReadonlyArray<MenuItemAction | SubmenuItemAction>]>, target: IAction[] | { primary: IAction[]; secondary: IAction[]; },
	useAlternativeActions: boolean,
	primaryGroup = 'navigation',
	primaryMaxCount: number = Number.MAX_SAFE_INTEGER,
	shouldInlineSubmenu: (action: SubmenuAction, group: string, groupSize: number) => boolean = () => false
): void {

	let primaryBucket: IAction[];
	let secondaryBucket: IAction[];
	if (Array.isArray(target)) {
		primaryBucket = target;
		secondaryBucket = target;
	} else {
		primaryBucket = target.primary;
		secondaryBucket = target.secondary;
	}

	const submenuInfo = new Set<{ group: string, action: SubmenuAction, index: number }>();

	for (const [group, actions] of groups) {

		let target: IAction[];
		if (group === primaryGroup) {
			target = primaryBucket;
		} else {
			target = secondaryBucket;
			if (target.length > 0) {
				target.push(new Separator());
			}
		}

		for (let action of actions) {
			if (useAlternativeActions) {
				action = action instanceof MenuItemAction && action.alt ? action.alt : action;
			}
			const newLen = target.push(action);
			// keep submenu info for later inlining
			if (action instanceof SubmenuAction) {
				submenuInfo.add({ group, action, index: newLen - 1 });
			}
		}
	}

	// ask the outside if submenu should be inlined or not. only ask when
	// there would be enough space
	for (const { group, action, index } of submenuInfo) {
		const target = group === primaryGroup ? primaryBucket : secondaryBucket;

		// inlining submenus with length 0 or 1 is easy,
		// larger submenus need to be checked with the overall limit
		const submenuActions = action.actions;
		if ((submenuActions.length <= 1 || target.length + submenuActions.length - 2 <= primaryMaxCount) && shouldInlineSubmenu(action, group, target.length)) {
			target.splice(index, 1, ...submenuActions);
		}
	}

	// overflow items from the primary group into the secondary bucket
	if (primaryBucket !== secondaryBucket && primaryBucket.length > primaryMaxCount) {
		const overflow = primaryBucket.splice(primaryMaxCount, primaryBucket.length - primaryMaxCount);
		secondaryBucket.unshift(...overflow, new Separator());
	}
}

export class MenuEntryActionViewItem extends ActionViewItem {

	private _wantsAltCommand: boolean = false;
	private readonly _itemClassDispose = this._register(new MutableDisposable());
	private readonly _altKey: ModifierKeyEmitter;

	constructor(
		_action: MenuItemAction,
		@IKeybindingService protected readonly _keybindingService: IKeybindingService,
		@INotificationService protected _notificationService: INotificationService
	) {
		super(undefined, _action, { icon: !!(_action.class || _action.item.icon), label: !_action.class && !_action.item.icon });
		this._altKey = ModifierKeyEmitter.getInstance();
	}

	protected get _menuItemAction(): MenuItemAction {
		return <MenuItemAction>this._action;
	}

	protected get _commandAction(): MenuItemAction {
		return this._wantsAltCommand && this._menuItemAction.alt || this._menuItemAction;
	}

	override async onClick(event: MouseEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();

		try {
			await this.actionRunner.run(this._commandAction, this._context);
		} catch (err) {
			this._notificationService.error(err);
		}
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('menu-entry');

		this._updateItemClass(this._menuItemAction.item);

		let mouseOver = false;

		let alternativeKeyDown = this._altKey.keyStatus.altKey || ((isWindows || isLinux) && this._altKey.keyStatus.shiftKey);

		const updateAltState = () => {
			const wantsAltCommand = mouseOver && alternativeKeyDown;
			if (wantsAltCommand !== this._wantsAltCommand) {
				this._wantsAltCommand = wantsAltCommand;
				this.updateLabel();
				this.updateTooltip();
				this.updateClass();
			}
		};

		if (this._menuItemAction.alt) {
			this._register(this._altKey.event(value => {
				alternativeKeyDown = value.altKey || ((isWindows || isLinux) && value.shiftKey);
				updateAltState();
			}));
		}

		this._register(domEvent(container, 'mouseleave')(_ => {
			mouseOver = false;
			updateAltState();
		}));

		this._register(domEvent(container, 'mouseenter')(e => {
			mouseOver = true;
			updateAltState();
		}));
	}

	override updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.textContent = this._commandAction.label;
		}
	}

	override updateTooltip(): void {
		if (this.label) {
			const keybinding = this._keybindingService.lookupKeybinding(this._commandAction.id);
			const keybindingLabel = keybinding && keybinding.getLabel();

			const tooltip = this._commandAction.tooltip || this._commandAction.label;
			let title = keybindingLabel
				? localize('titleAndKb', "{0} ({1})", tooltip, keybindingLabel)
				: tooltip;
			if (!this._wantsAltCommand && this._menuItemAction.alt) {
				const altTooltip = this._menuItemAction.alt.tooltip || this._menuItemAction.alt.label;
				const altKeybinding = this._keybindingService.lookupKeybinding(this._menuItemAction.alt.id);
				const altKeybindingLabel = altKeybinding && altKeybinding.getLabel();
				const altTitleSection = altKeybindingLabel
					? localize('titleAndKb', "{0} ({1})", altTooltip, altKeybindingLabel)
					: altTooltip;
				title += `\n[${UILabelProvider.modifierLabels[OS].altKey}] ${altTitleSection}`;
			}
			this.label.title = title;
		}
	}

	override updateClass(): void {
		if (this.options.icon) {
			if (this._commandAction !== this._menuItemAction) {
				if (this._menuItemAction.alt) {
					this._updateItemClass(this._menuItemAction.alt.item);
				}
			} else if (this._menuItemAction.alt) {
				this._updateItemClass(this._menuItemAction.item);
			}
		}
	}

	private _updateItemClass(item: ICommandAction): void {
		this._itemClassDispose.value = undefined;

		const { element, label } = this;
		if (!element || !label) {
			return;
		}

		const icon = this._commandAction.checked && (item.toggled as { icon?: Icon })?.icon ? (item.toggled as { icon: Icon }).icon : item.icon;

		if (!icon) {
			return;
		}

		if (ThemeIcon.isThemeIcon(icon)) {
			// theme icons
			const iconClasses = ThemeIcon.asClassNameArray(icon);
			label.classList.add(...iconClasses);
			this._itemClassDispose.value = toDisposable(() => {
				label.classList.remove(...iconClasses);
			});

		} else {
			// icon path/url
			if (icon.light) {
				label.style.setProperty('--menu-entry-icon-light', asCSSUrl(icon.light));
			}
			if (icon.dark) {
				label.style.setProperty('--menu-entry-icon-dark', asCSSUrl(icon.dark));
			}
			label.classList.add('icon');
			this._itemClassDispose.value = toDisposable(() => {
				label.classList.remove('icon');
				label.style.removeProperty('--menu-entry-icon-light');
				label.style.removeProperty('--menu-entry-icon-dark');
			});
		}
	}
}

export class SubmenuEntryActionViewItem extends DropdownMenuActionViewItem {

	constructor(
		action: SubmenuItemAction,
		@IContextMenuService contextMenuService: IContextMenuService
	) {
		super(action, { getActions: () => action.actions }, contextMenuService, {
			menuAsChild: true,
			classNames: ThemeIcon.isThemeIcon(action.item.icon) ? ThemeIcon.asClassName(action.item.icon) : undefined,
		});
	}

	override render(container: HTMLElement): void {
		super.render(container);
		if (this.element) {
			container.classList.add('menu-entry');
			const { icon } = (<SubmenuItemAction>this._action).item;
			if (icon && !ThemeIcon.isThemeIcon(icon)) {
				this.element.classList.add('icon');
				if (icon.light) {
					this.element.style.setProperty('--menu-entry-icon-light', asCSSUrl(icon.light));
				}
				if (icon.dark) {
					this.element.style.setProperty('--menu-entry-icon-dark', asCSSUrl(icon.dark));
				}
			}
		}
	}
}

/**
 * Creates action view items for menu actions or submenu actions.
 */
export function createActionViewItem(instaService: IInstantiationService, action: IAction): undefined | MenuEntryActionViewItem | SubmenuEntryActionViewItem {
	if (action instanceof MenuItemAction) {
		return instaService.createInstance(MenuEntryActionViewItem, action);
	} else if (action instanceof SubmenuItemAction) {
		return instaService.createInstance(SubmenuEntryActionViewItem, action);
	} else {
		return undefined;
	}
}
