/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./button';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Color } from 'vs/base/common/color';
import { mixin } from 'vs/base/common/objects';
import { Event as BaseEvent, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Gesture, EventType as TouchEventType } from 'vs/base/browser/touch';
import { renderCodicons } from 'vs/base/browser/codicons';
import { addDisposableListener, IFocusTracker, EventType, EventHelper, trackFocus, reset, removeTabIndexAndUpdateFocus } from 'vs/base/browser/dom';
import { IContextMenuProvider } from 'vs/base/browser/contextmenu';
import { IAction, IActionRunner } from 'vs/base/common/actions';
import { CSSIcon, Codicon } from 'vs/base/common/codicons';

export interface IButtonOptions extends IButtonStyles {
	readonly title?: boolean | string;
	readonly supportCodicons?: boolean;
	readonly secondary?: boolean;
}

export interface IButtonStyles {
	buttonBackground?: Color;
	buttonHoverBackground?: Color;
	buttonForeground?: Color;
	buttonSecondaryBackground?: Color;
	buttonSecondaryHoverBackground?: Color;
	buttonSecondaryForeground?: Color;
	buttonBorder?: Color;
}

const defaultOptions: IButtonStyles = {
	buttonBackground: Color.fromHex('#0E639C'),
	buttonHoverBackground: Color.fromHex('#006BB3'),
	buttonForeground: Color.white
};

export interface IButton extends IDisposable {
	readonly element: HTMLElement;
	readonly onDidClick: BaseEvent<Event>;
	label: string;
	icon: CSSIcon;
	enabled: boolean;
	style(styles: IButtonStyles): void;
	focus(): void;
	hasFocus(): boolean;
}

export class Button extends Disposable implements IButton {

	private _element: HTMLElement;
	private options: IButtonOptions;

	private buttonBackground: Color | undefined;
	private buttonHoverBackground: Color | undefined;
	private buttonForeground: Color | undefined;
	private buttonSecondaryBackground: Color | undefined;
	private buttonSecondaryHoverBackground: Color | undefined;
	private buttonSecondaryForeground: Color | undefined;
	private buttonBorder: Color | undefined;

	private _onDidClick = this._register(new Emitter<Event>());
	get onDidClick(): BaseEvent<Event> { return this._onDidClick.event; }

	private focusTracker: IFocusTracker;

	constructor(container: HTMLElement, options?: IButtonOptions) {
		super();

		this.options = options || Object.create(null);
		mixin(this.options, defaultOptions, false);

		this.buttonForeground = this.options.buttonForeground;
		this.buttonBackground = this.options.buttonBackground;
		this.buttonHoverBackground = this.options.buttonHoverBackground;

		this.buttonSecondaryForeground = this.options.buttonSecondaryForeground;
		this.buttonSecondaryBackground = this.options.buttonSecondaryBackground;
		this.buttonSecondaryHoverBackground = this.options.buttonSecondaryHoverBackground;

		this.buttonBorder = this.options.buttonBorder;

		this._element = document.createElement('a');
		this._element.classList.add('monaco-button');
		this._element.tabIndex = 0;
		this._element.setAttribute('role', 'button');

		container.appendChild(this._element);

		this._register(Gesture.addTarget(this._element));

		[EventType.CLICK, TouchEventType.Tap].forEach(eventType => {
			this._register(addDisposableListener(this._element, eventType, e => {
				if (!this.enabled) {
					EventHelper.stop(e);
					return;
				}

				this._onDidClick.fire(e);
			}));
		});

		this._register(addDisposableListener(this._element, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			let eventHandled = false;
			if (this.enabled && (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space))) {
				this._onDidClick.fire(e);
				eventHandled = true;
			} else if (event.equals(KeyCode.Escape)) {
				this._element.blur();
				eventHandled = true;
			}

			if (eventHandled) {
				EventHelper.stop(event, true);
			}
		}));

		this._register(addDisposableListener(this._element, EventType.MOUSE_OVER, e => {
			if (!this._element.classList.contains('disabled')) {
				this.setHoverBackground();
			}
		}));

		this._register(addDisposableListener(this._element, EventType.MOUSE_OUT, e => {
			this.applyStyles(); // restore standard styles
		}));

		// Also set hover background when button is focused for feedback
		this.focusTracker = this._register(trackFocus(this._element));
		this._register(this.focusTracker.onDidFocus(() => this.setHoverBackground()));
		this._register(this.focusTracker.onDidBlur(() => this.applyStyles())); // restore standard styles

		this.applyStyles();
	}

	private setHoverBackground(): void {
		let hoverBackground;
		if (this.options.secondary) {
			hoverBackground = this.buttonSecondaryHoverBackground ? this.buttonSecondaryHoverBackground.toString() : null;
		} else {
			hoverBackground = this.buttonHoverBackground ? this.buttonHoverBackground.toString() : null;
		}
		if (hoverBackground) {
			this._element.style.backgroundColor = hoverBackground;
		}
	}

	style(styles: IButtonStyles): void {
		this.buttonForeground = styles.buttonForeground;
		this.buttonBackground = styles.buttonBackground;
		this.buttonHoverBackground = styles.buttonHoverBackground;
		this.buttonSecondaryForeground = styles.buttonSecondaryForeground;
		this.buttonSecondaryBackground = styles.buttonSecondaryBackground;
		this.buttonSecondaryHoverBackground = styles.buttonSecondaryHoverBackground;
		this.buttonBorder = styles.buttonBorder;

		this.applyStyles();
	}

	private applyStyles(): void {
		if (this._element) {
			let background, foreground;
			if (this.options.secondary) {
				foreground = this.buttonSecondaryForeground ? this.buttonSecondaryForeground.toString() : '';
				background = this.buttonSecondaryBackground ? this.buttonSecondaryBackground.toString() : '';
			} else {
				foreground = this.buttonForeground ? this.buttonForeground.toString() : '';
				background = this.buttonBackground ? this.buttonBackground.toString() : '';
			}

			const border = this.buttonBorder ? this.buttonBorder.toString() : '';

			this._element.style.color = foreground;
			this._element.style.backgroundColor = background;

			this._element.style.borderWidth = border ? '1px' : '';
			this._element.style.borderStyle = border ? 'solid' : '';
			this._element.style.borderColor = border;
		}
	}

	get element(): HTMLElement {
		return this._element;
	}

	set label(value: string) {
		this._element.classList.add('monaco-text-button');
		if (this.options.supportCodicons) {
			reset(this._element, ...renderCodicons(value));
		} else {
			this._element.textContent = value;
		}
		if (typeof this.options.title === 'string') {
			this._element.title = this.options.title;
		} else if (this.options.title) {
			this._element.title = value;
		}
	}

	set icon(icon: CSSIcon) {
		this._element.classList.add(...icon.classNames.split(' '));
	}

	set enabled(value: boolean) {
		if (value) {
			this._element.classList.remove('disabled');
			this._element.setAttribute('aria-disabled', String(false));
			this._element.tabIndex = 0;
		} else {
			this._element.classList.add('disabled');
			this._element.setAttribute('aria-disabled', String(true));
			removeTabIndexAndUpdateFocus(this._element);
		}
	}

	get enabled() {
		return !this._element.classList.contains('disabled');
	}

	focus(): void {
		this._element.focus();
	}

	hasFocus(): boolean {
		return this._element === document.activeElement;
	}
}

export interface IButtonWithDropdownOptions extends IButtonOptions {
	readonly contextMenuProvider: IContextMenuProvider;
	readonly actions: IAction[];
	readonly actionRunner?: IActionRunner;
}

export class ButtonWithDropdown extends Disposable implements IButton {

	private readonly button: Button;
	private readonly dropdownButton: Button;

	readonly element: HTMLElement;
	readonly onDidClick: BaseEvent<Event>;

	constructor(container: HTMLElement, options: IButtonWithDropdownOptions) {
		super();

		this.element = document.createElement('div');
		this.element.classList.add('monaco-button-dropdown');
		container.appendChild(this.element);

		this.button = this._register(new Button(this.element, options));
		this.onDidClick = this.button.onDidClick;

		this.dropdownButton = this._register(new Button(this.element, { ...options, title: false, supportCodicons: true }));
		this.dropdownButton.element.classList.add('monaco-dropdown-button');
		this.dropdownButton.icon = Codicon.dropDownButton;
		this._register(this.dropdownButton.onDidClick(() => {
			options.contextMenuProvider.showContextMenu({
				getAnchor: () => this.dropdownButton.element,
				getActions: () => options.actions,
				actionRunner: options.actionRunner,
				onHide: () => this.dropdownButton.element.setAttribute('aria-expanded', 'false')
			});
			this.dropdownButton.element.setAttribute('aria-expanded', 'true');
		}));
	}

	set label(value: string) {
		this.button.label = value;
	}

	set icon(icon: CSSIcon) {
		this.button.icon = icon;
	}

	set enabled(enabled: boolean) {
		this.button.enabled = enabled;
		this.dropdownButton.enabled = enabled;
	}

	get enabled(): boolean {
		return this.button.enabled;
	}

	style(styles: IButtonStyles): void {
		this.button.style(styles);
		this.dropdownButton.style(styles);
	}

	focus(): void {
		this.button.focus();
	}

	hasFocus(): boolean {
		return this.button.hasFocus() || this.dropdownButton.hasFocus();
	}
}

export class ButtonBar extends Disposable {

	private _buttons: IButton[] = [];

	constructor(private readonly container: HTMLElement) {
		super();
	}

	get buttons(): IButton[] {
		return this._buttons;
	}

	addButton(options?: IButtonOptions): IButton {
		const button = this._register(new Button(this.container, options));
		this.pushButton(button);
		return button;
	}

	addButtonWithDropdown(options: IButtonWithDropdownOptions): IButton {
		const button = this._register(new ButtonWithDropdown(this.container, options));
		this.pushButton(button);
		return button;
	}

	private pushButton(button: IButton): void {
		this._buttons.push(button);

		const index = this._buttons.length - 1;
		this._register(addDisposableListener(button.element, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			let eventHandled = true;

			// Next / Previous Button
			let buttonIndexToFocus: number | undefined;
			if (event.equals(KeyCode.LeftArrow)) {
				buttonIndexToFocus = index > 0 ? index - 1 : this._buttons.length - 1;
			} else if (event.equals(KeyCode.RightArrow)) {
				buttonIndexToFocus = index === this._buttons.length - 1 ? 0 : index + 1;
			} else {
				eventHandled = false;
			}

			if (eventHandled && typeof buttonIndexToFocus === 'number') {
				this._buttons[buttonIndexToFocus].focus();
				EventHelper.stop(e, true);
			}

		}));

	}

}
