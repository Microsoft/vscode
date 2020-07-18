/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./button';
import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Color } from 'vs/base/common/color';
import { mixin } from 'vs/base/common/objects';
import { Event as BaseEvent, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { Gesture, EventType } from 'vs/base/browser/touch';
import { renderCodicons } from 'vs/base/common/codicons';
import { escape } from 'vs/base/common/strings';

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

export class Button extends Disposable {

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

	private focusTracker: DOM.IFocusTracker;

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
		DOM.addClass(this._element, 'monaco-button');
		this._element.tabIndex = 0;
		this._element.setAttribute('role', 'button');

		container.appendChild(this._element);

		this._register(Gesture.addTarget(this._element));

		[DOM.EventType.CLICK, EventType.Tap].forEach(eventType => {
			this._register(DOM.addDisposableListener(this._element, eventType, e => {
				if (!this.enabled) {
					DOM.EventHelper.stop(e);
					return;
				}

				this._onDidClick.fire(e);
			}));
		});

		this._register(DOM.addDisposableListener(this._element, DOM.EventType.KEY_DOWN, e => {
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
				DOM.EventHelper.stop(event, true);
			}
		}));

		this._register(DOM.addDisposableListener(this._element, DOM.EventType.MOUSE_OVER, e => {
			if (!DOM.hasClass(this._element, 'disabled')) {
				this.setHoverBackground();
			}
		}));

		this._register(DOM.addDisposableListener(this._element, DOM.EventType.MOUSE_OUT, e => {
			this.applyStyles(); // restore standard styles
		}));

		// Also set hover background when button is focused for feedback
		this.focusTracker = this._register(DOM.trackFocus(this._element));
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
		if (!DOM.hasClass(this._element, 'monaco-text-button')) {
			DOM.addClass(this._element, 'monaco-text-button');
		}
		if (this.options.supportCodicons) {
			this._element.innerHTML = renderCodicons(escape(value));
		} else {
			this._element.textContent = value;
		}
		if (typeof this.options.title === 'string') {
			this._element.title = this.options.title;
		} else if (this.options.title) {
			this._element.title = value;
		}
	}

	set icon(iconClassName: string) {
		DOM.addClass(this._element, iconClassName);
	}

	set enabled(value: boolean) {
		if (value) {
			DOM.removeClass(this._element, 'disabled');
			this._element.setAttribute('aria-disabled', String(false));
			this._element.tabIndex = 0;
		} else {
			DOM.addClass(this._element, 'disabled');
			this._element.setAttribute('aria-disabled', String(true));
			DOM.removeTabIndexAndUpdateFocus(this._element);
		}
	}

	get enabled() {
		return !DOM.hasClass(this._element, 'disabled');
	}

	focus(): void {
		this._element.focus();
	}
}

export class ButtonGroup extends Disposable {
	private _buttons: Button[] = [];

	constructor(container: HTMLElement, count: number, options?: IButtonOptions) {
		super();

		this.create(container, count, options);
	}

	get buttons(): Button[] {
		return this._buttons;
	}

	private create(container: HTMLElement, count: number, options?: IButtonOptions): void {
		for (let index = 0; index < count; index++) {
			const button = this._register(new Button(container, options));
			this._buttons.push(button);

			// Implement keyboard access in buttons if there are multiple
			if (count > 1) {
				this._register(DOM.addDisposableListener(button.element, DOM.EventType.KEY_DOWN, e => {
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
						DOM.EventHelper.stop(e, true);
					}

				}));
			}
		}
	}
}
