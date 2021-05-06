/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { ActionBar, IActionViewItemProvider } from 'vs/base/browser/ui/actionbar/actionbar';
import { IAction } from 'vs/base/common/actions';
import { ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { suggestWidgetStatusbarMenu } from 'vs/editor/contrib/suggest/suggest';
import { localize } from 'vs/nls';
import { MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenuService, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

class StatusBarViewItem extends MenuEntryActionViewItem {

	override updateLabel() {
		const kb = this._keybindingService.lookupKeybinding(this._action.id);
		if (!kb) {
			return super.updateLabel();
		}
		if (this.label) {
			this.label.textContent = localize('ddd', '{0} ({1})', this._action.label, StatusBarViewItem.symbolPrintEnter(kb));
		}
	}

	static symbolPrintEnter(kb: ResolvedKeybinding) {
		return kb.getLabel()?.replace(/\benter\b/gi, '\u23CE');
	}
}

export class SuggestWidgetStatus {

	readonly element: HTMLElement;

	private readonly _leftActions: ActionBar;
	private readonly _rightActions: ActionBar;
	private readonly _menuDisposables = new DisposableStore();

	constructor(
		container: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService,
		@IMenuService private _menuService: IMenuService,
		@IContextKeyService private _contextKeyService: IContextKeyService,
	) {
		this.element = dom.append(container, dom.$('.suggest-status-bar'));

		const actionViewItemProvider = <IActionViewItemProvider>(action => {
			return action instanceof MenuItemAction ? instantiationService.createInstance(StatusBarViewItem, action) : undefined;
		});
		this._leftActions = new ActionBar(this.element, { actionViewItemProvider });
		this._rightActions = new ActionBar(this.element, { actionViewItemProvider });

		this._leftActions.domNode.classList.add('left');
		this._rightActions.domNode.classList.add('right');
	}

	dispose(): void {
		this._menuDisposables.dispose();
		this.element.remove();
	}

	show(): void {
		const menu = this._menuService.createMenu(suggestWidgetStatusbarMenu, this._contextKeyService);
		const renderMenu = () => {
			const left: IAction[] = [];
			const right: IAction[] = [];
			for (let [group, actions] of menu.getActions()) {
				if (group === 'left') {
					left.push(...actions);
				} else {
					right.push(...actions);
				}
			}
			this._leftActions.clear();
			this._leftActions.push(left);
			this._rightActions.clear();
			this._rightActions.push(right);
		};
		this._menuDisposables.add(menu.onDidChange(() => renderMenu()));
		this._menuDisposables.add(menu);
	}

	hide(): void {
		this._menuDisposables.clear();
	}
}
