/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createCSSRule, asCSSUrl, ModifierKeyEmitter } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { IAction, Separator } from 'vs/base/common/actions';
import { IdGenerator } from 'vs/base/common/idGenerator';
import { IDisposable, toDisposable, MutableDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { ICommandAction, IMenu, IMenuActionOptions, MenuItemAction, SubmenuItemAction, Icon } from 'vs/platform/actions/common/actions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { isWindows, isLinux } from 'vs/base/common/platform';

export function createAndFillInContextMenuActions(menu: IMenu, options: IMenuActionOptions | undefined, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, isPrimaryGroup?: (group: string) => boolean): IDisposable {
	const groups = menu.getActions(options);
	const useAlternativeActions = ModifierKeyEmitter.getInstance().keyStatus.altKey;
	fillInActions(groups, target, useAlternativeActions, isPrimaryGroup);
	return asDisposable(groups);
}

export function createAndFillInActionBarActions(menu: IMenu, options: IMenuActionOptions | undefined, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, isPrimaryGroup?: (group: string) => boolean): IDisposable {
	const groups = menu.getActions(options);
	// Action bars handle alternative actions on their own so the alternative actions should be ignored
	fillInActions(groups, target, false, isPrimaryGroup);
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

function fillInActions(groups: ReadonlyArray<[string, ReadonlyArray<MenuItemAction | SubmenuItemAction>]>, target: IAction[] | { primary: IAction[]; secondary: IAction[]; }, useAlternativeActions: boolean, isPrimaryGroup: (group: string) => boolean = group => group === 'navigation'): void {
	for (let tuple of groups) {
		let [group, actions] = tuple;
		if (useAlternativeActions) {
			actions = actions.map(a => (a instanceof MenuItemAction) && !!a.alt ? a.alt : a);
		}

		if (isPrimaryGroup(group)) {
			const to = Array.isArray(target) ? target : target.primary;

			to.unshift(...actions);
		} else {
			const to = Array.isArray(target) ? target : target.secondary;

			if (to.length > 0) {
				to.push(new Separator());
			}

			to.push(...actions);
		}
	}
}

const ids = new IdGenerator('menu-item-action-item-icon-');

const ICON_PATH_TO_CSS_RULES = new Map<string /* path*/, string /* CSS rule */>();

export class MenuEntryActionViewItem extends ActionViewItem {

	private _wantsAltCommand: boolean = false;
	private readonly _itemClassDispose = this._register(new MutableDisposable());
	private readonly _altKey: ModifierKeyEmitter;

	constructor(
		readonly _action: MenuItemAction,
		@IKeybindingService protected readonly _keybindingService: IKeybindingService,
		@INotificationService protected _notificationService: INotificationService
	) {
		super(undefined, _action, { icon: !!(_action.class || _action.item.icon), label: !_action.class && !_action.item.icon });
		this._altKey = ModifierKeyEmitter.getInstance();
	}

	protected get _commandAction(): IAction {
		return this._wantsAltCommand && (<MenuItemAction>this._action).alt || this._action;
	}

	onClick(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();

		this.actionRunner.run(this._commandAction, this._context)
			.then(undefined, err => this._notificationService.error(err));
	}

	render(container: HTMLElement): void {
		super.render(container);

		this._updateItemClass(this._action.item);

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

		if (this._action.alt) {
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

	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.textContent = this._commandAction.label;
		}
	}

	updateTooltip(): void {
		if (this.label) {
			const keybinding = this._keybindingService.lookupKeybinding(this._commandAction.id);
			const keybindingLabel = keybinding && keybinding.getLabel();

			const tooltip = this._commandAction.tooltip || this._commandAction.label;
			this.label.title = keybindingLabel
				? localize('titleAndKb', "{0} ({1})", tooltip, keybindingLabel)
				: tooltip;
		}
	}

	updateClass(): void {
		if (this.options.icon) {
			if (this._commandAction !== this._action) {
				if (this._action.alt) {
					this._updateItemClass(this._action.alt.item);
				}
			} else if ((<MenuItemAction>this._action).alt) {
				this._updateItemClass(this._action.item);
			}
		}
	}

	private _updateItemClass(item: ICommandAction): void {
		this._itemClassDispose.value = undefined;

		const icon = this._commandAction.checked && (item.toggled as { icon?: Icon })?.icon ? (item.toggled as { icon: Icon }).icon : item.icon;

		if (ThemeIcon.isThemeIcon(icon)) {
			// theme icons
			const iconClass = ThemeIcon.asClassName(icon);
			if (this.label && iconClass) {
				this.label.classList.add(...iconClass.split(' '));
				this._itemClassDispose.value = toDisposable(() => {
					if (this.label) {
						this.label.classList.remove(...iconClass.split(' '));
					}
				});
			}

		} else if (icon) {
			// icon path
			let iconClass: string;

			if (icon.dark?.scheme) {

				const iconPathMapKey = icon.dark.toString();

				if (ICON_PATH_TO_CSS_RULES.has(iconPathMapKey)) {
					iconClass = ICON_PATH_TO_CSS_RULES.get(iconPathMapKey)!;
				} else {
					iconClass = ids.nextId();
					createCSSRule(`.icon.${iconClass}`, `background-image: ${asCSSUrl(icon.light || icon.dark)}`);
					createCSSRule(`.vs-dark .icon.${iconClass}, .hc-black .icon.${iconClass}`, `background-image: ${asCSSUrl(icon.dark)}`);
					ICON_PATH_TO_CSS_RULES.set(iconPathMapKey, iconClass);
				}

				if (this.label) {
					this.label.classList.add('icon', ...iconClass.split(' '));
					this._itemClassDispose.value = toDisposable(() => {
						if (this.label) {
							this.label.classList.remove('icon', ...iconClass.split(' '));
						}
					});
				}
			}
		}
	}
}

export class SubmenuEntryActionViewItem extends DropdownMenuActionViewItem {

	constructor(
		action: SubmenuItemAction,
		@INotificationService _notificationService: INotificationService,
		@IContextMenuService _contextMenuService: IContextMenuService
	) {
		let classNames: string | string[] | undefined;

		if (action.item.icon) {
			if (ThemeIcon.isThemeIcon(action.item.icon)) {
				classNames = ThemeIcon.asClassName(action.item.icon)!;
			} else if (action.item.icon.dark?.scheme) {
				const iconPathMapKey = action.item.icon.dark.toString();

				if (ICON_PATH_TO_CSS_RULES.has(iconPathMapKey)) {
					classNames = ['icon', ICON_PATH_TO_CSS_RULES.get(iconPathMapKey)!];
				} else {
					const className = ids.nextId();
					classNames = ['icon', className];
					createCSSRule(`.icon.${className}`, `background-image: ${asCSSUrl(action.item.icon.light || action.item.icon.dark)}`);
					createCSSRule(`.vs-dark .icon.${className}, .hc-black .icon.${className}`, `background-image: ${asCSSUrl(action.item.icon.dark)}`);
					ICON_PATH_TO_CSS_RULES.set(iconPathMapKey, className);
				}
			}
		}

		super(action, action.actions, _contextMenuService, { classNames: classNames, menuAsChild: true });
	}
}
