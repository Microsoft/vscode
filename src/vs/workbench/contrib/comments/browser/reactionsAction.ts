/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { Action, IAction } from 'vs/base/common/actions';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

export class ToggleReactionsAction extends Action {
	static readonly ID = 'toolbar.toggle.pickReactions';
	private _menuActions: IAction[] = [];
	private toggleDropdownMenu: () => void;
	constructor(toggleDropdownMenu: () => void, title?: string) {
		super(ToggleReactionsAction.ID, title || nls.localize('pickReactions', "Pick Reactions..."), 'toggle-reactions', true);
		this.toggleDropdownMenu = toggleDropdownMenu;
	}
	run(): Promise<any> {
		this.toggleDropdownMenu();
		return Promise.resolve(true);
	}
	get menuActions() {
		return this._menuActions;
	}
	set menuActions(actions: IAction[]) {
		this._menuActions = actions;
	}
}
export class ReactionActionViewItem extends ActionViewItem {
	constructor(action: ReactionAction) {
		super(null, action, {});
	}
	updateLabel(): void {
		if (!this.label) {
			return;
		}

		let action = this.getAction() as ReactionAction;
		if (action.class) {
			this.label.classList.add(action.class);
		}

		if (!action.icon) {
			let reactionLabel = dom.append(this.label, dom.$('span.reaction-label'));
			reactionLabel.innerText = action.label;
		} else {
			let reactionIcon = dom.append(this.label, dom.$('.reaction-icon'));
			reactionIcon.style.display = '';
			let uri = URI.revive(action.icon);
			reactionIcon.style.backgroundImage = `url('${uri}')`;
			reactionIcon.title = action.label;
		}
		if (action.count) {
			let reactionCount = dom.append(this.label, dom.$('span.reaction-count'));
			reactionCount.innerText = `${action.count}`;
		}
	}
}
export class ReactionAction extends Action {
	static readonly ID = 'toolbar.toggle.reaction';
	constructor(id: string, label: string = '', cssClass: string = '', enabled: boolean = true, actionCallback?: (event?: any) => Promise<any>, public icon?: UriComponents, public count?: number) {
		super(ReactionAction.ID, label, cssClass, enabled, actionCallback);
	}
}
