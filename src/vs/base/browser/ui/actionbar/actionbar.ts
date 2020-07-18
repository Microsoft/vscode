/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionbar';
import * as platform from 'vs/base/common/platform';
import * as nls from 'vs/nls';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { SelectBox, ISelectOptionItem, ISelectBoxOptions } from 'vs/base/browser/ui/selectBox/selectBox';
import { IAction, IActionRunner, Action, IActionChangeEvent, ActionRunner, IRunEvent } from 'vs/base/common/actions';
import * as DOM from 'vs/base/browser/dom';
import * as types from 'vs/base/common/types';
import { EventType, Gesture } from 'vs/base/browser/touch';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { IContextViewProvider } from 'vs/base/browser/ui/contextview/contextview';
import { Event, Emitter } from 'vs/base/common/event';
import { DataTransfers } from 'vs/base/browser/dnd';
import { isFirefox } from 'vs/base/browser/browser';

export interface IActionViewItem extends IDisposable {
	actionRunner: IActionRunner;
	setActionContext(context: any): void;
	render(element: HTMLElement): void;
	isEnabled(): boolean;
	focus(fromRight?: boolean): void;
	blur(): void;
}

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

	constructor(context: any, action: IAction, protected options?: IBaseActionViewItemOptions) {
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

export class Separator extends Action {

	static readonly ID = 'vs.actions.separator';

	constructor(label?: string) {
		super(Separator.ID, label, label ? 'separator text' : 'separator');
		this.checked = false;
		this.enabled = false;
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

export const enum ActionsOrientation {
	HORIZONTAL,
	HORIZONTAL_REVERSE,
	VERTICAL,
	VERTICAL_REVERSE,
}

export interface ActionTrigger {
	keys: KeyCode[];
	keyDown: boolean;
}

export interface IActionViewItemProvider {
	(action: IAction): IActionViewItem | undefined;
}

export interface IActionBarOptions {
	orientation?: ActionsOrientation;
	context?: any;
	actionViewItemProvider?: IActionViewItemProvider;
	actionRunner?: IActionRunner;
	ariaLabel?: string;
	animated?: boolean;
	triggerKeys?: ActionTrigger;
	allowContextMenu?: boolean;
	preventLoopNavigation?: boolean;
}

const defaultOptions: IActionBarOptions = {
	orientation: ActionsOrientation.HORIZONTAL,
	context: null,
	triggerKeys: {
		keys: [KeyCode.Enter, KeyCode.Space],
		keyDown: false
	}
};

export interface IActionOptions extends IActionViewItemOptions {
	index?: number;
}

export class ActionBar extends Disposable implements IActionRunner {

	options: IActionBarOptions;

	private _actionRunner: IActionRunner;
	private _context: unknown;

	// View Items
	viewItems: IActionViewItem[];
	protected focusedItem?: number;
	private focusTracker: DOM.IFocusTracker;

	// Elements
	domNode: HTMLElement;
	protected actionsList: HTMLElement;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur: Event<void> = this._onDidBlur.event;

	private _onDidCancel = this._register(new Emitter<void>());
	readonly onDidCancel: Event<void> = this._onDidCancel.event;

	private _onDidRun = this._register(new Emitter<IRunEvent>());
	readonly onDidRun: Event<IRunEvent> = this._onDidRun.event;

	private _onDidBeforeRun = this._register(new Emitter<IRunEvent>());
	readonly onDidBeforeRun: Event<IRunEvent> = this._onDidBeforeRun.event;

	constructor(container: HTMLElement, options: IActionBarOptions = defaultOptions) {
		super();

		this.options = options;
		this._context = options.context;

		if (!this.options.triggerKeys) {
			this.options.triggerKeys = defaultOptions.triggerKeys;
		}

		if (this.options.actionRunner) {
			this._actionRunner = this.options.actionRunner;
		} else {
			this._actionRunner = new ActionRunner();
			this._register(this._actionRunner);
		}

		this._register(this._actionRunner.onDidRun(e => this._onDidRun.fire(e)));
		this._register(this._actionRunner.onDidBeforeRun(e => this._onDidBeforeRun.fire(e)));

		this.viewItems = [];
		this.focusedItem = undefined;

		this.domNode = document.createElement('div');
		this.domNode.className = 'monaco-action-bar';

		if (options.animated !== false) {
			DOM.addClass(this.domNode, 'animated');
		}

		let previousKey: KeyCode;
		let nextKey: KeyCode;

		switch (this.options.orientation) {
			case ActionsOrientation.HORIZONTAL:
				previousKey = KeyCode.LeftArrow;
				nextKey = KeyCode.RightArrow;
				break;
			case ActionsOrientation.HORIZONTAL_REVERSE:
				previousKey = KeyCode.RightArrow;
				nextKey = KeyCode.LeftArrow;
				this.domNode.className += ' reverse';
				break;
			case ActionsOrientation.VERTICAL:
				previousKey = KeyCode.UpArrow;
				nextKey = KeyCode.DownArrow;
				this.domNode.className += ' vertical';
				break;
			case ActionsOrientation.VERTICAL_REVERSE:
				previousKey = KeyCode.DownArrow;
				nextKey = KeyCode.UpArrow;
				this.domNode.className += ' vertical reverse';
				break;
		}

		this._register(DOM.addDisposableListener(this.domNode, DOM.EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			let eventHandled = true;

			if (event.equals(previousKey)) {
				eventHandled = this.focusPrevious();
			} else if (event.equals(nextKey)) {
				eventHandled = this.focusNext();
			} else if (event.equals(KeyCode.Escape)) {
				this._onDidCancel.fire();
			} else if (this.isTriggerKeyEvent(event)) {
				// Staying out of the else branch even if not triggered
				if (this.options.triggerKeys && this.options.triggerKeys.keyDown) {
					this.doTrigger(event);
				}
			} else {
				eventHandled = false;
			}

			if (eventHandled) {
				event.preventDefault();
				event.stopPropagation();
			}
		}));

		this._register(DOM.addDisposableListener(this.domNode, DOM.EventType.KEY_UP, e => {
			const event = new StandardKeyboardEvent(e);

			// Run action on Enter/Space
			if (this.isTriggerKeyEvent(event)) {
				if (this.options.triggerKeys && !this.options.triggerKeys.keyDown) {
					this.doTrigger(event);
				}

				event.preventDefault();
				event.stopPropagation();
			}

			// Recompute focused item
			else if (event.equals(KeyCode.Tab) || event.equals(KeyMod.Shift | KeyCode.Tab)) {
				this.updateFocusedItem();
			}
		}));

		this.focusTracker = this._register(DOM.trackFocus(this.domNode));
		this._register(this.focusTracker.onDidBlur(() => {
			if (document.activeElement === this.domNode || !DOM.isAncestor(document.activeElement, this.domNode)) {
				this._onDidBlur.fire();
				this.focusedItem = undefined;
			}
		}));

		this._register(this.focusTracker.onDidFocus(() => this.updateFocusedItem()));

		this.actionsList = document.createElement('ul');
		this.actionsList.className = 'actions-container';
		this.actionsList.setAttribute('role', 'toolbar');

		if (this.options.ariaLabel) {
			this.actionsList.setAttribute('aria-label', this.options.ariaLabel);
		}

		this.domNode.appendChild(this.actionsList);

		container.appendChild(this.domNode);
	}

	setAriaLabel(label: string): void {
		if (label) {
			this.actionsList.setAttribute('aria-label', label);
		} else {
			this.actionsList.removeAttribute('aria-label');
		}
	}

	private isTriggerKeyEvent(event: StandardKeyboardEvent): boolean {
		let ret = false;
		if (this.options.triggerKeys) {
			this.options.triggerKeys.keys.forEach(keyCode => {
				ret = ret || event.equals(keyCode);
			});
		}

		return ret;
	}

	private updateFocusedItem(): void {
		for (let i = 0; i < this.actionsList.children.length; i++) {
			const elem = this.actionsList.children[i];
			if (DOM.isAncestor(document.activeElement, elem)) {
				this.focusedItem = i;
				break;
			}
		}
	}

	get context(): any {
		return this._context;
	}

	set context(context: any) {
		this._context = context;
		this.viewItems.forEach(i => i.setActionContext(context));
	}

	get actionRunner(): IActionRunner {
		return this._actionRunner;
	}

	set actionRunner(actionRunner: IActionRunner) {
		if (actionRunner) {
			this._actionRunner = actionRunner;
			this.viewItems.forEach(item => item.actionRunner = actionRunner);
		}
	}

	getContainer(): HTMLElement {
		return this.domNode;
	}

	push(arg: IAction | ReadonlyArray<IAction>, options: IActionOptions = {}): void {
		const actions: ReadonlyArray<IAction> = Array.isArray(arg) ? arg : [arg];

		let index = types.isNumber(options.index) ? options.index : null;

		actions.forEach((action: IAction) => {
			const actionViewItemElement = document.createElement('li');
			actionViewItemElement.className = 'action-item';
			actionViewItemElement.setAttribute('role', 'presentation');

			// Prevent native context menu on actions
			if (!this.options.allowContextMenu) {
				this._register(DOM.addDisposableListener(actionViewItemElement, DOM.EventType.CONTEXT_MENU, (e: DOM.EventLike) => {
					DOM.EventHelper.stop(e, true);
				}));
			}

			let item: IActionViewItem | undefined;

			if (this.options.actionViewItemProvider) {
				item = this.options.actionViewItemProvider(action);
			}

			if (!item) {
				item = new ActionViewItem(this.context, action, options);
			}

			item.actionRunner = this._actionRunner;
			item.setActionContext(this.context);
			item.render(actionViewItemElement);

			if (index === null || index < 0 || index >= this.actionsList.children.length) {
				this.actionsList.appendChild(actionViewItemElement);
				this.viewItems.push(item);
			} else {
				this.actionsList.insertBefore(actionViewItemElement, this.actionsList.children[index]);
				this.viewItems.splice(index, 0, item);
				index++;
			}
		});
	}

	getWidth(index: number): number {
		if (index >= 0 && index < this.actionsList.children.length) {
			const item = this.actionsList.children.item(index);
			if (item) {
				return item.clientWidth;
			}
		}

		return 0;
	}

	getHeight(index: number): number {
		if (index >= 0 && index < this.actionsList.children.length) {
			const item = this.actionsList.children.item(index);
			if (item) {
				return item.clientHeight;
			}
		}

		return 0;
	}

	pull(index: number): void {
		if (index >= 0 && index < this.viewItems.length) {
			this.actionsList.removeChild(this.actionsList.childNodes[index]);
			dispose(this.viewItems.splice(index, 1));
		}
	}

	clear(): void {
		dispose(this.viewItems);
		this.viewItems = [];
		DOM.clearNode(this.actionsList);
	}

	length(): number {
		return this.viewItems.length;
	}

	isEmpty(): boolean {
		return this.viewItems.length === 0;
	}

	focus(index?: number): void;
	focus(selectFirst?: boolean): void;
	focus(arg?: number | boolean): void {
		let selectFirst: boolean = false;
		let index: number | undefined = undefined;
		if (arg === undefined) {
			selectFirst = true;
		} else if (typeof arg === 'number') {
			index = arg;
		} else if (typeof arg === 'boolean') {
			selectFirst = arg;
		}

		if (selectFirst && typeof this.focusedItem === 'undefined') {
			// Focus the first enabled item
			this.focusedItem = -1;
			this.focusNext();
		} else {
			if (index !== undefined) {
				this.focusedItem = index;
			}

			this.updateFocus();
		}
	}

	protected focusNext(): boolean {
		if (typeof this.focusedItem === 'undefined') {
			this.focusedItem = this.viewItems.length - 1;
		}

		const startIndex = this.focusedItem;
		let item: IActionViewItem;

		do {
			if (this.options.preventLoopNavigation && this.focusedItem + 1 >= this.viewItems.length) {
				this.focusedItem = startIndex;
				return false;
			}

			this.focusedItem = (this.focusedItem + 1) % this.viewItems.length;
			item = this.viewItems[this.focusedItem];
		} while (this.focusedItem !== startIndex && !item.isEnabled());

		if (this.focusedItem === startIndex && !item.isEnabled()) {
			this.focusedItem = undefined;
		}

		this.updateFocus();
		return true;
	}

	protected focusPrevious(): boolean {
		if (typeof this.focusedItem === 'undefined') {
			this.focusedItem = 0;
		}

		const startIndex = this.focusedItem;
		let item: IActionViewItem;

		do {
			this.focusedItem = this.focusedItem - 1;

			if (this.focusedItem < 0) {
				if (this.options.preventLoopNavigation) {
					this.focusedItem = startIndex;
					return false;
				}

				this.focusedItem = this.viewItems.length - 1;
			}

			item = this.viewItems[this.focusedItem];
		} while (this.focusedItem !== startIndex && !item.isEnabled());

		if (this.focusedItem === startIndex && !item.isEnabled()) {
			this.focusedItem = undefined;
		}

		this.updateFocus(true);
		return true;
	}

	protected updateFocus(fromRight?: boolean, preventScroll?: boolean): void {
		if (typeof this.focusedItem === 'undefined') {
			this.actionsList.focus({ preventScroll });
		}

		for (let i = 0; i < this.viewItems.length; i++) {
			const item = this.viewItems[i];
			const actionViewItem = item;

			if (i === this.focusedItem) {
				if (types.isFunction(actionViewItem.isEnabled)) {
					if (actionViewItem.isEnabled() && types.isFunction(actionViewItem.focus)) {
						actionViewItem.focus(fromRight);
					} else {
						this.actionsList.focus({ preventScroll });
					}
				}
			} else {
				if (types.isFunction(actionViewItem.blur)) {
					actionViewItem.blur();
				}
			}
		}
	}

	private doTrigger(event: StandardKeyboardEvent): void {
		if (typeof this.focusedItem === 'undefined') {
			return; //nothing to focus
		}

		// trigger action
		const actionViewItem = this.viewItems[this.focusedItem];
		if (actionViewItem instanceof BaseActionViewItem) {
			const context = (actionViewItem._context === null || actionViewItem._context === undefined) ? event : actionViewItem._context;
			this.run(actionViewItem._action, context);
		}
	}

	run(action: IAction, context?: unknown): Promise<void> {
		return this._actionRunner.run(action, context);
	}

	dispose(): void {
		dispose(this.viewItems);
		this.viewItems = [];

		DOM.removeNode(this.getContainer());

		super.dispose();
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

export function prepareActions(actions: IAction[]): IAction[] {
	if (!actions.length) {
		return actions;
	}

	// Clean up leading separators
	let firstIndexOfAction = -1;
	for (let i = 0; i < actions.length; i++) {
		if (actions[i].id === Separator.ID) {
			continue;
		}

		firstIndexOfAction = i;
		break;
	}

	if (firstIndexOfAction === -1) {
		return [];
	}

	actions = actions.slice(firstIndexOfAction);

	// Clean up trailing separators
	for (let h = actions.length - 1; h >= 0; h--) {
		const isSeparator = actions[h].id === Separator.ID;
		if (isSeparator) {
			actions.splice(h, 1);
		} else {
			break;
		}
	}

	// Clean up separator duplicates
	let foundAction = false;
	for (let k = actions.length - 1; k >= 0; k--) {
		const isSeparator = actions[k].id === Separator.ID;
		if (isSeparator && !foundAction) {
			actions.splice(k, 1);
		} else if (!isSeparator) {
			foundAction = true;
		} else if (isSeparator) {
			foundAction = false;
		}
	}

	return actions;
}
