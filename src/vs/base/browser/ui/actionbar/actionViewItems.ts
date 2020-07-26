/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionbar';
import * as platform from 'vs/base/common/platform';
import * as nls from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { SelectBox, ISelectOptionItem, ISelectBoxOptions } from 'vs/base/browser/ui/selectBox/selectBox';
import { IAction, IActionRunner, Action, IActionChangeEvent, ActionRunner, Separator, IActionViewItem } from 'vs/base/common/actions';
import * as DOM from 'vs/base/browser/dom';
import * as types from 'vs/base/common/types';
import { EventType, Gesture } from 'vs/base/browser/touch';
import { IContextViewProvider } from 'vs/base/browser/ui/contextview/contextview';
import { DataTransfers } from 'vs/base/browser/dnd';
import { isFirefox } from 'vs/base/browser/browser';

export interface IBaseActionViewItemOptions {
	draggable?: boolean;
	isMenu?: boolean;
	useEventAsContext?: boolean;
}

export class BaseActionViewItem extends Disposable implements IActionViewItem {

	element: HTMLElement | undefined;

	_context: any;
	_action: IAction;

	private _actionRunner: IActionRunner | undefined;

	constructor(context: any, action: IAction, protected options: IBaseActionViewItemOptions = {}) {
		super();

		this._context = context || this;
		this._action = action;

		if (action instanceof Action) {
			this._register(action.onDidChange(event => {
				if (!this.element) {
					// we have not been rendered yet, so there
					// is no point in updating the UI
					return;
				}

				this.handleActionChangeEvent(event);
			}));
		}
	}

	private handleActionChangeEvent(event: IActionChangeEvent): void {
		if (event.enabled !== undefined) {
			this.updateEnabled();
		}

		if (event.checked !== undefined) {
			this.updateChecked();
		}

		if (event.class !== undefined) {
			this.updateClass();
		}

		if (event.label !== undefined) {
			this.updateLabel();
			this.updateTooltip();
		}

		if (event.tooltip !== undefined) {
			this.updateTooltip();
		}
	}

	get actionRunner(): IActionRunner {
		if (!this._actionRunner) {
			this._actionRunner = this._register(new ActionRunner());
		}

		return this._actionRunner;
	}

	set actionRunner(actionRunner: IActionRunner) {
		this._actionRunner = actionRunner;
	}

	getAction(): IAction {
		return this._action;
	}

	isEnabled(): boolean {
		return this._action.enabled;
	}

	setActionContext(newContext: unknown): void {
		this._context = newContext;
	}

	render(container: HTMLElement): void {
		const element = this.element = container;
		this._register(Gesture.addTarget(container));

		const enableDragging = this.options && this.options.draggable;
		if (enableDragging) {
			container.draggable = true;

			if (isFirefox) {
				// Firefox: requires to set a text data transfer to get going
				this._register(DOM.addDisposableListener(container, DOM.EventType.DRAG_START, e => e.dataTransfer?.setData(DataTransfers.TEXT, this._action.label)));
			}
		}

		this._register(DOM.addDisposableListener(element, EventType.Tap, e => this.onClick(e)));

		this._register(DOM.addDisposableListener(element, DOM.EventType.MOUSE_DOWN, e => {
			if (!enableDragging) {
				DOM.EventHelper.stop(e, true); // do not run when dragging is on because that would disable it
			}

			if (this._action.enabled && e.button === 0) {
				DOM.addClass(element, 'active');
			}
		}));

		if (platform.isMacintosh) {
			// macOS: allow to trigger the button when holding Ctrl+key and pressing the
			// main mouse button. This is for scenarios where e.g. some interaction forces
			// the Ctrl+key to be pressed and hold but the user still wants to interact
			// with the actions (for example quick access in quick navigation mode).
			this._register(DOM.addDisposableListener(element, DOM.EventType.CONTEXT_MENU, e => {
				if (e.button === 0 && e.ctrlKey === true) {
					this.onClick(e);
				}
			}));
		}

		this._register(DOM.addDisposableListener(element, DOM.EventType.CLICK, e => {
			DOM.EventHelper.stop(e, true);
			// See https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Interact_with_the_clipboard
			// > Writing to the clipboard
			// > You can use the "cut" and "copy" commands without any special
			// permission if you are using them in a short-lived event handler
			// for a user action (for example, a click handler).

			// => to get the Copy and Paste context menu actions working on Firefox,
			// there should be no timeout here
			if (this.options && this.options.isMenu) {
				this.onClick(e);
			} else {
				platform.setImmediate(() => this.onClick(e));
			}
		}));

		this._register(DOM.addDisposableListener(element, DOM.EventType.DBLCLICK, e => {
			DOM.EventHelper.stop(e, true);
		}));

		[DOM.EventType.MOUSE_UP, DOM.EventType.MOUSE_OUT].forEach(event => {
			this._register(DOM.addDisposableListener(element, event, e => {
				DOM.EventHelper.stop(e);
				DOM.removeClass(element, 'active');
			}));
		});
	}

	onClick(event: DOM.EventLike): void {
		DOM.EventHelper.stop(event, true);

		const context = types.isUndefinedOrNull(this._context) ? this.options?.useEventAsContext ? event : undefined : this._context;
		this.actionRunner.run(this._action, context);
	}

	focus(): void {
		if (this.element) {
			this.element.focus();
			DOM.addClass(this.element, 'focused');
		}
	}

	blur(): void {
		if (this.element) {
			this.element.blur();
			DOM.removeClass(this.element, 'focused');
		}
	}

	protected updateEnabled(): void {
		// implement in subclass
	}

	protected updateLabel(): void {
		// implement in subclass
	}

	protected updateTooltip(): void {
		// implement in subclass
	}

	protected updateClass(): void {
		// implement in subclass
	}

	protected updateChecked(): void {
		// implement in subclass
	}

	dispose(): void {
		if (this.element) {
			DOM.removeNode(this.element);
			this.element = undefined;
		}

		super.dispose();
	}
}

export interface IActionViewItemOptions extends IBaseActionViewItemOptions {
	icon?: boolean;
	label?: boolean;
	keybinding?: string | null;
}

export class ActionViewItem extends BaseActionViewItem {

	protected label: HTMLElement | undefined;
	protected options: IActionViewItemOptions;

	private cssClass?: string;

	constructor(context: unknown, action: IAction, options: IActionViewItemOptions = {}) {
		super(context, action, options);

		this.options = options;
		this.options.icon = options.icon !== undefined ? options.icon : false;
		this.options.label = options.label !== undefined ? options.label : true;
		this.cssClass = '';
	}

	render(container: HTMLElement): void {
		super.render(container);

		if (this.element) {
			this.label = DOM.append(this.element, DOM.$('a.action-label'));
		}

		if (this.label) {
			if (this._action.id === Separator.ID) {
				this.label.setAttribute('role', 'presentation'); // A separator is a presentation item
			} else {
				if (this.options.isMenu) {
					this.label.setAttribute('role', 'menuitem');
				} else {
					this.label.setAttribute('role', 'button');
				}
			}
		}

		if (this.options.label && this.options.keybinding && this.element) {
			DOM.append(this.element, DOM.$('span.keybinding')).textContent = this.options.keybinding;
		}

		this.updateClass();
		this.updateLabel();
		this.updateTooltip();
		this.updateEnabled();
		this.updateChecked();
	}

	focus(): void {
		super.focus();

		if (this.label) {
			this.label.focus();
		}
	}

	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.textContent = this.getAction().label;
		}
	}

	updateTooltip(): void {
		let title: string | null = null;

		if (this.getAction().tooltip) {
			title = this.getAction().tooltip;

		} else if (!this.options.label && this.getAction().label && this.options.icon) {
			title = this.getAction().label;

			if (this.options.keybinding) {
				title = nls.localize({ key: 'titleLabel', comment: ['action title', 'action keybinding'] }, "{0} ({1})", title, this.options.keybinding);
			}
		}

		if (title && this.label) {
			this.label.title = title;
		}
	}

	updateClass(): void {
		if (this.cssClass && this.label) {
			DOM.removeClasses(this.label, this.cssClass);
		}

		if (this.options.icon) {
			this.cssClass = this.getAction().class;

			if (this.label) {
				DOM.addClass(this.label, 'codicon');
				if (this.cssClass) {
					DOM.addClasses(this.label, this.cssClass);
				}
			}

			this.updateEnabled();
		} else {
			if (this.label) {
				DOM.removeClass(this.label, 'codicon');
			}
		}
	}

	updateEnabled(): void {
		if (this.getAction().enabled) {
			if (this.label) {
				this.label.removeAttribute('aria-disabled');
				DOM.removeClass(this.label, 'disabled');
				this.label.tabIndex = 0;
			}

			if (this.element) {
				DOM.removeClass(this.element, 'disabled');
			}
		} else {
			if (this.label) {
				this.label.setAttribute('aria-disabled', 'true');
				DOM.addClass(this.label, 'disabled');
				DOM.removeTabIndexAndUpdateFocus(this.label);
			}

			if (this.element) {
				DOM.addClass(this.element, 'disabled');
			}
		}
	}

	updateChecked(): void {
		if (this.label) {
			if (this.getAction().checked) {
				DOM.addClass(this.label, 'checked');
			} else {
				DOM.removeClass(this.label, 'checked');
			}
		}
	}
}

export class SelectActionViewItem extends BaseActionViewItem {
	protected selectBox: SelectBox;

	constructor(ctx: unknown, action: IAction, options: ISelectOptionItem[], selected: number, contextViewProvider: IContextViewProvider, selectBoxOptions?: ISelectBoxOptions) {
		super(ctx, action);

		this.selectBox = new SelectBox(options, selected, contextViewProvider, undefined, selectBoxOptions);

		this._register(this.selectBox);
		this.registerListeners();
	}

	setOptions(options: ISelectOptionItem[], selected?: number): void {
		this.selectBox.setOptions(options, selected);
	}

	select(index: number): void {
		this.selectBox.select(index);
	}

	private registerListeners(): void {
		this._register(this.selectBox.onDidSelect(e => {
			this.actionRunner.run(this._action, this.getActionContext(e.selected, e.index));
		}));
	}

	protected getActionContext(option: string, index: number) {
		return option;
	}

	focus(): void {
		if (this.selectBox) {
			this.selectBox.focus();
		}
	}

	blur(): void {
		if (this.selectBox) {
			this.selectBox.blur();
		}
	}

	render(container: HTMLElement): void {
		this.selectBox.render(container);
	}
}
