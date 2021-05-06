/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dropdown';
import { Gesture, EventType as GestureEventType } from 'vs/base/browser/touch';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IContextViewProvider, IAnchor, AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IMenuOptions } from 'vs/base/browser/ui/menu/menu';
import { KeyCode } from 'vs/base/common/keyCodes';
import { EventHelper, EventType, append, $, addDisposableListener, DOMEvent } from 'vs/base/browser/dom';
import { IContextMenuProvider } from 'vs/base/browser/contextmenu';
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
					return; // prevent multiple clicks to open multiple context menus (https://github.com/microsoft/vscode/issues/41363)
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
				EventHelper.stop(e, true); // https://github.com/microsoft/vscode/issues/57997

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

	override dispose(): void {
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

	override show(): void {
		super.show();

		this.element.classList.add('active');

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
		this.element.classList.remove('active');
	}

	override hide(): void {
		super.hide();

		if (this.contextViewProvider) {
			this.contextViewProvider.hideContextView();
		}
	}

	protected renderContents(container: HTMLElement): IDisposable | null {
		return null;
	}
}

export interface IActionProvider {
	getActions(): readonly IAction[];
}

export interface IDropdownMenuOptions extends IBaseDropdownOptions {
	contextMenuProvider: IContextMenuProvider;
	readonly actions?: IAction[];
	readonly actionProvider?: IActionProvider;
	menuClassName?: string;
	menuAsChild?: boolean; // scope down for #99448
}

export class DropdownMenu extends BaseDropdown {
	private _contextMenuProvider: IContextMenuProvider;
	private _menuOptions: IMenuOptions | undefined;
	private _actions: readonly IAction[] = [];
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

	private get actions(): readonly IAction[] {
		if (this.actionProvider) {
			return this.actionProvider.getActions();
		}

		return this._actions;
	}

	private set actions(actions: readonly IAction[]) {
		this._actions = actions;
	}

	override show(): void {
		super.show();

		this.element.classList.add('active');

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
			domForShadowRoot: this.menuAsChild ? this.element : undefined
		});
	}

	override hide(): void {
		super.hide();
	}

	private onHide(): void {
		this.hide();
		this.element.classList.remove('active');
	}
}
