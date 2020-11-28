/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dropdown';
import { Action, IAction, IActionRunner, IActionViewItemProvider } from 'vs/base/common/actions';
import { IDisposable } from 'vs/base/common/lifecycle';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { append, $ } from 'vs/base/browser/dom';
import { Emitter } from 'vs/base/common/event';
import { ActionViewItem, BaseActionViewItem, IActionViewItemOptions, IBaseActionViewItemOptions } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { IActionProvider, DropdownMenu, IDropdownMenuOptions, ILabelRenderer } from 'vs/base/browser/ui/dropdown/dropdown';
import { IContextMenuProvider } from 'vs/base/browser/contextmenu';
import { Codicon } from 'vs/base/common/codicons';

export interface IKeybindingProvider {
	(action: IAction): ResolvedKeybinding | undefined;
}

export interface IAnchorAlignmentProvider {
	(): AnchorAlignment;
}

export interface IDropdownMenuActionViewItemOptions extends IBaseActionViewItemOptions {
	readonly actionViewItemProvider?: IActionViewItemProvider;
	readonly keybindingProvider?: IKeybindingProvider;
	readonly actionRunner?: IActionRunner;
	readonly classNames?: string[] | string;
	readonly anchorAlignmentProvider?: IAnchorAlignmentProvider;
	readonly menuAsChild?: boolean;
}

export class DropdownMenuActionViewItem extends BaseActionViewItem {
	private menuActionsOrProvider: readonly IAction[] | IActionProvider;
	private dropdownMenu: DropdownMenu | undefined;
	private contextMenuProvider: IContextMenuProvider;
	private actionItem: HTMLElement | null = null;

	private _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	constructor(
		action: IAction,
		menuActionsOrProvider: readonly IAction[] | IActionProvider,
		contextMenuProvider: IContextMenuProvider,
		protected options: IDropdownMenuActionViewItemOptions = {}
	) {
		super(null, action, options);

		this.menuActionsOrProvider = menuActionsOrProvider;
		this.contextMenuProvider = contextMenuProvider;

		if (this.options.actionRunner) {
			this.actionRunner = this.options.actionRunner;
		}
	}

	render(container: HTMLElement): void {
		this.actionItem = container;

		const labelRenderer: ILabelRenderer = (el: HTMLElement): IDisposable | null => {
			this.element = append(el, $('a.action-label'));

			let classNames: string[] = [];

			if (typeof this.options.classNames === 'string') {
				classNames = this.options.classNames.split(/\s+/g).filter(s => !!s);
			} else if (this.options.classNames) {
				classNames = this.options.classNames;
			}

			// todo@aeschli: remove codicon, should come through `this.options.classNames`
			if (!classNames.find(c => c === 'icon')) {
				classNames.push('codicon');
			}

			this.element.classList.add(...classNames);

			this.element.tabIndex = 0;
			this.element.setAttribute('role', 'button');
			this.element.setAttribute('aria-haspopup', 'true');
			this.element.setAttribute('aria-expanded', 'false');
			this.element.title = this._action.label || '';

			return null;
		};

		const isActionsArray = Array.isArray(this.menuActionsOrProvider);
		const options: IDropdownMenuOptions = {
			contextMenuProvider: this.contextMenuProvider,
			labelRenderer: labelRenderer,
			menuAsChild: this.options.menuAsChild,
			actions: isActionsArray ? this.menuActionsOrProvider as IAction[] : undefined,
			actionProvider: isActionsArray ? undefined : this.menuActionsOrProvider as IActionProvider
		};

		this.dropdownMenu = this._register(new DropdownMenu(container, options));
		this._register(this.dropdownMenu.onDidChangeVisibility(visible => {
			this.element?.setAttribute('aria-expanded', `${visible}`);
			this._onDidChangeVisibility.fire(visible);
		}));

		this.dropdownMenu.menuOptions = {
			actionViewItemProvider: this.options.actionViewItemProvider,
			actionRunner: this.actionRunner,
			getKeyBinding: this.options.keybindingProvider,
			context: this._context
		};

		if (this.options.anchorAlignmentProvider) {
			const that = this;

			this.dropdownMenu.menuOptions = {
				...this.dropdownMenu.menuOptions,
				get anchorAlignment(): AnchorAlignment {
					return that.options.anchorAlignmentProvider!();
				}
			};
		}

		this.updateEnabled();
	}

	setActionContext(newContext: unknown): void {
		super.setActionContext(newContext);

		if (this.dropdownMenu) {
			if (this.dropdownMenu.menuOptions) {
				this.dropdownMenu.menuOptions.context = newContext;
			} else {
				this.dropdownMenu.menuOptions = { context: newContext };
			}
		}
	}

	show(): void {
		if (this.dropdownMenu) {
			this.dropdownMenu.show();
		}
	}

	protected updateEnabled(): void {
		const disabled = !this.getAction().enabled;
		this.actionItem?.classList.toggle('disabled', disabled);
		this.element?.classList.toggle('disabled', disabled);
	}
}

export interface IActionWithDropdownActionViewItemOptions extends IActionViewItemOptions {
	readonly menuActionsOrProvider: readonly IAction[] | IActionProvider;
	readonly menuActionClassNames?: string[];
}

export class ActionWithDropdownActionViewItem extends ActionViewItem {

	protected dropdownMenuActionViewItem: DropdownMenuActionViewItem | undefined;

	constructor(
		context: unknown,
		action: IAction,
		options: IActionWithDropdownActionViewItemOptions,
		private readonly contextMenuProvider: IContextMenuProvider
	) {
		super(context, action, options);
	}

	render(container: HTMLElement): void {
		super.render(container);
		if (this.element) {
			this.element.classList.add('action-dropdown-item');
			this.dropdownMenuActionViewItem = new DropdownMenuActionViewItem(new Action('dropdownAction', undefined), (<IActionWithDropdownActionViewItemOptions>this.options).menuActionsOrProvider, this.contextMenuProvider, { classNames: ['dropdown', ...Codicon.dropDownButton.classNamesArray, ...(<IActionWithDropdownActionViewItemOptions>this.options).menuActionClassNames || []] });
			this.dropdownMenuActionViewItem.render(this.element);
		}
	}

}
