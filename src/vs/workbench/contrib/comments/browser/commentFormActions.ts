/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Button } from 'vs/base/browser/ui/button/button';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { IMenu } from 'vs/platform/actions/common/actions';
import { attachButtonStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';

export class CommentFormActions implements IDisposable {
	private _buttonElements: HTMLElement[] = [];
	private readonly _toDispose = new DisposableStore();
	private _actions: IAction[] = [];

	constructor(
		private container: HTMLElement,
		private actionHandler: (action: IAction) => void,
		private themeService: IThemeService
	) { }

	setActions(menu: IMenu) {
		this._toDispose.clear();

		this._buttonElements.forEach(b => DOM.removeNode(b));

		const groups = menu.getActions({ shouldForwardArgs: true });
		for (const group of groups) {
			const [, actions] = group;

			this._actions = actions;
			actions.forEach(action => {
				const button = new Button(this.container);
				this._buttonElements.push(button.element);

				this._toDispose.add(button);
				this._toDispose.add(attachButtonStyler(button, this.themeService));
				this._toDispose.add(button.onDidClick(() => this.actionHandler(action)));

				button.enabled = action.enabled;
				button.label = action.label;
			});
		}
	}

	triggerDefaultAction() {
		if (this._actions.length) {
			let lastAction = this._actions[0];

			if (lastAction.enabled) {
				this.actionHandler(lastAction);
			}
		}
	}

	dispose() {
		this._toDispose.dispose();
	}
}
