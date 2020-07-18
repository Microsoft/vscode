/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dropdown';
import { Gesture, EventType as GestureEventType } from 'vs/base/browser/touch';
import { ActionRunner, IAction, IActionRunner } from 'vs/base/common/actions';
import { BaseActionViewItem, IActionViewItemProvider } from 'vs/base/browser/ui/actionbar/actionbar';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IContextViewProvider, IAnchor, AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IMenuOptions } from 'vs/base/browser/ui/menu/menu';
import { ResolvedKeybinding, KeyCode } from 'vs/base/common/keyCodes';
import { EventHelper, EventType, removeClass, addClass, append, $, addDisposableListener, addClasses, DOMEvent } from 'vs/base/browser/dom';
import { IContextMenuDelegate } from 'vs/base/browser/contextmenu';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Emitter } from 'vs/base/common/event';

export interface ILabelRenderer {
	(container: HTMLElement): IDisposable | null;
}

export interface IBaseDropdownOptions {
	label?: string;
	labelRenderer?: ILabelRenderer;
}

export class BaseDropdown extends ActionRunner {
	private _element: HTMLElement;
	private boxContainer?: HTMLElement;
	private _label?: HTMLElement;
	private contents?: HTMLElement;

	private visible: boolean | undefined;
	private _onDidChangeVisibility = new Emitter<boolean>();
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	constructor(container: HTMLElement, options: IBaseDropdownOptions) {
		super();

		this._element = append(container, $('.monaco-dropdown'));

		this._label = append(this._element, $('.dropdown-label'));

		let labelRenderer = options.labelRenderer;
		if (!labelRenderer) {
			labelRenderer = (container: HTMLElement): IDisposable | null => {
				container.textContent = options.label || '';

				return null;
			};
		}

		for (const event of [EventType.CLICK, EventType.MOUSE_DOWN, GestureEventType.Tap]) {
			this._register(addDisposableListener(this.element, event, e => EventHelper.stop(e, true))); // prevent default click behaviour to trigger
		}

		for (const event of [EventType.MOUSE_DOWN, GestureEventType.Tap]) {
			this._register(addDisposableListener(this._label, event, e => {
				if (e instanceof MouseEvent && e.detail > 1) {
					return; // prevent multiple clicks to open multiple context menus (https://github.com/Microsoft/vscode/issues/41363)
				}

				if (this.visible) {
					this.hide();
				} else {
					this.show();
				}
			}));
		}

		this._register(addDisposableListener(this._label, EventType.KEY_UP, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				EventHelper.stop(e, true); // https://github.com/Microsoft/vscode/issues/57997

				if (this.visible) {
					this.hide();
				} else {
					this.show();
				}
			}
		}));

		const cleanupFn = labelRenderer(this._label);
		if (cleanupFn) {
			this._register(cleanupFn);
		}

		this._register(Gesture.addTarget(this._label));
	}

	get element(): HTMLElement {
		return this._element;
	}

	get label() {
		return this._label;
	}

	set tooltip(tooltip: string) {
		if (this._label) {
			this._label.title = tooltip;
		}
	}

	show(): void {
		if (!this.visible) {
			this.visible = true;
			this._onDidChangeVisibility.fire(true);
		}
	}

	hide(): void {
		if (this.visible) {
			this.visible = false;
			this._onDidChangeVisibility.fire(false);
		}
	}

	isVisible(): boolean {
		return !!this.visible;
	}

	protected onEvent(e: DOMEvent, activeElement: HTMLElement): void {
		this.hide();
	}

	dispose(): void {
		super.dispose();
		this.hide();

		if (this.boxContainer) {
			this.boxContainer.remove();
			this.boxContainer = undefined;
		}

		if (this.contents) {
			this.contents.remove();
			this.contents = undefined;
		}

		if (this._label) {
			this._label.remove();
			this._label = undefined;
		}
	}
}

export interface IDropdownOptions extends IBaseDropdownOptions {
	contextViewProvider: IContextViewProvider;
}

export class Dropdown extends BaseDropdown {
	private contextViewProvider: IContextViewProvider;

	constructor(container: HTMLElement, options: IDropdownOptions) {
		super(container, options);

		this.contextViewProvider = options.contextViewProvider;
	}

	show(): void {
		super.show();

		addClass(this.element, 'active');

		this.contextViewProvider.showContextView({
			getAnchor: () => this.getAnchor(),

			render: (container) => {
				return this.renderContents(container);
			},

			onDOMEvent: (e, activeElement) => {
				this.onEvent(e, activeElement);
			},

			onHide: () => this.onHide()
		});
	}

	protected getAnchor(): HTMLElement | IAnchor {
		return this.element;
	}

	protected onHide(): void {
		removeClass(this.element, 'active');
	}

	hide(): void {
		super.hide();

		if (this.contextViewProvider) {
			this.contextViewProvider.hideContextView();
		}
	}

	protected renderContents(container: HTMLElement): IDisposable | null {
		return null;
	}
}

export interface IContextMenuProvider {
	showContextMenu(delegate: IContextMenuDelegate): void;
}

export interface IActionProvider {
	getActions(): ReadonlyArray<IAction>;
}

export interface IDropdownMenuOptions extends IBaseDropdownOptions {
	contextMenuProvider: IContextMenuProvider;
	actions?: ReadonlyArray<IAction>;
	actionProvider?: IActionProvider;
	menuClassName?: string;
	menuAsChild?: boolean; // scope down for #99448
}

export class DropdownMenu extends BaseDropdown {
	private _contextMenuProvider: IContextMenuProvider;
	private _menuOptions: IMenuOptions | undefined;
	private _actions: ReadonlyArray<IAction> = [];
	private actionProvider?: IActionProvider;
	private menuClassName: string;
	private menuAsChild?: boolean;

	constructor(container: HTMLElement, options: IDropdownMenuOptions) {
		super(container, options);

		this._contextMenuProvider = options.contextMenuProvider;
		this.actions = options.actions || [];
		this.actionProvider = options.actionProvider;
		this.menuClassName = options.menuClassName || '';
		this.menuAsChild = !!options.menuAsChild;
	}

	set menuOptions(options: IMenuOptions | undefined) {
		this._menuOptions = options;
	}

	get menuOptions(): IMenuOptions | undefined {
		return this._menuOptions;
	}

	private get actions(): ReadonlyArray<IAction> {
		if (this.actionProvider) {
			return this.actionProvider.getActions();
		}

		return this._actions;
	}

	private set actions(actions: ReadonlyArray<IAction>) {
		this._actions = actions;
	}

	show(): void {
		super.show();

		addClass(this.element, 'active');

		this._contextMenuProvider.showContextMenu({
			getAnchor: () => this.element,
			getActions: () => this.actions,
			getActionsContext: () => this.menuOptions ? this.menuOptions.context : null,
			getActionViewItem: action => this.menuOptions && this.menuOptions.actionViewItemProvider ? this.menuOptions.actionViewItemProvider(action) : undefined,
			getKeyBinding: action => this.menuOptions && this.menuOptions.getKeyBinding ? this.menuOptions.getKeyBinding(action) : undefined,
			getMenuClassName: () => this.menuClassName,
			onHide: () => this.onHide(),
			actionRunner: this.menuOptions ? this.menuOptions.actionRunner : undefined,
			anchorAlignment: this.menuOptions ? this.menuOptions.anchorAlignment : AnchorAlignment.LEFT,
			anchorAsContainer: this.menuAsChild
		});
	}

	hide(): void {
		super.hide();
	}

	private onHide(): void {
		this.hide();
		removeClass(this.element, 'active');
	}
}

export class DropdownMenuActionViewItem extends BaseActionViewItem {
	private menuActionsOrProvider: ReadonlyArray<IAction> | IActionProvider;
	private dropdownMenu: DropdownMenu | undefined;
	private contextMenuProvider: IContextMenuProvider;
	private actionViewItemProvider?: IActionViewItemProvider;
	private keybindings?: (action: IAction) => ResolvedKeybinding | undefined;
	private clazz: string | undefined;
	private anchorAlignmentProvider: (() => AnchorAlignment) | undefined;
	private menuAsChild?: boolean;

	private _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	constructor(action: IAction, menuActions: ReadonlyArray<IAction>, contextMenuProvider: IContextMenuProvider, actionViewItemProvider: IActionViewItemProvider | undefined, actionRunner: IActionRunner, keybindings: ((action: IAction) => ResolvedKeybinding | undefined) | undefined, clazz: string | undefined, anchorAlignmentProvider?: () => AnchorAlignment, menuAsChild?: boolean);
	constructor(action: IAction, actionProvider: IActionProvider, contextMenuProvider: IContextMenuProvider, actionViewItemProvider: IActionViewItemProvider | undefined, actionRunner: IActionRunner, keybindings: ((action: IAction) => ResolvedKeybinding) | undefined, clazz: string | undefined, anchorAlignmentProvider?: () => AnchorAlignment, menuAsChild?: boolean);
	constructor(action: IAction, menuActionsOrProvider: ReadonlyArray<IAction> | IActionProvider, contextMenuProvider: IContextMenuProvider, actionViewItemProvider: IActionViewItemProvider | undefined, actionRunner: IActionRunner, keybindings: ((action: IAction) => ResolvedKeybinding | undefined) | undefined, clazz: string | undefined, anchorAlignmentProvider?: () => AnchorAlignment, menuAsChild?: boolean) {
		super(null, action);

		this.menuActionsOrProvider = menuActionsOrProvider;
		this.contextMenuProvider = contextMenuProvider;
		this.actionViewItemProvider = actionViewItemProvider;
		this.actionRunner = actionRunner;
		this.keybindings = keybindings;
		this.clazz = clazz;
		this.anchorAlignmentProvider = anchorAlignmentProvider;
		this.menuAsChild = menuAsChild;
	}

	render(container: HTMLElement): void {
		const labelRenderer: ILabelRenderer = (el: HTMLElement): IDisposable | null => {
			this.element = append(el, $('a.action-label.codicon')); // todo@aeschli: remove codicon, should come through `this.clazz`
			if (this.clazz) {
				addClasses(this.element, this.clazz);
			}

			this.element.tabIndex = 0;
			this.element.setAttribute('role', 'button');
			this.element.setAttribute('aria-haspopup', 'true');
			this.element.setAttribute('aria-expanded', 'false');
			this.element.title = this._action.label || '';

			return null;
		};

		const options: IDropdownMenuOptions = {
			contextMenuProvider: this.contextMenuProvider,
			labelRenderer: labelRenderer,
			menuAsChild: this.menuAsChild
		};

		// Render the DropdownMenu around a simple action to toggle it
		if (Array.isArray(this.menuActionsOrProvider)) {
			options.actions = this.menuActionsOrProvider;
		} else {
			options.actionProvider = this.menuActionsOrProvider as IActionProvider;
		}

		this.dropdownMenu = this._register(new DropdownMenu(container, options));
		this._register(this.dropdownMenu.onDidChangeVisibility(visible => {
			this.element?.setAttribute('aria-expanded', `${visible}`);
			this._onDidChangeVisibility.fire(visible);
		}));

		this.dropdownMenu.menuOptions = {
			actionViewItemProvider: this.actionViewItemProvider,
			actionRunner: this.actionRunner,
			getKeyBinding: this.keybindings,
			context: this._context
		};

		if (this.anchorAlignmentProvider) {
			const that = this;

			this.dropdownMenu.menuOptions = {
				...this.dropdownMenu.menuOptions,
				get anchorAlignment(): AnchorAlignment {
					return that.anchorAlignmentProvider!();
				}
			};
		}
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
}
