/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./checkbox';
import * as DOM from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Widget } from 'vs/base/browser/ui/widget';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Codicon } from 'vs/base/common/codicons';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

export interface ICheckboxOpts extends ICheckboxStyles {
	readonly actionClassName?: string;
	readonly icon?: Codicon;
	readonly title: string;
	readonly isChecked: boolean;
}

export interface ICheckboxStyles {
	inputActiveOptionBorder?: Color;
	inputActiveOptionForeground?: Color;
	inputActiveOptionBackground?: Color;
}

export interface ISimpleCheckboxStyles {
	checkboxBackground?: Color;
	checkboxBorder?: Color;
	checkboxForeground?: Color;
}

const defaultOpts = {
	inputActiveOptionBorder: Color.fromHex('#007ACC00'),
	inputActiveOptionForeground: Color.fromHex('#FFFFFF'),
	inputActiveOptionBackground: Color.fromHex('#0E639C50')
};

export class CheckboxActionViewItem extends BaseActionViewItem {

	protected checkbox: Checkbox | undefined;
	protected readonly disposables = new DisposableStore();

	render(container: HTMLElement): void {
		this.element = container;

		this.disposables.clear();
		this.checkbox = new Checkbox({
			actionClassName: this._action.class,
			isChecked: this._action.checked,
			title: this._action.label
		});
		this.disposables.add(this.checkbox);
		this.disposables.add(this.checkbox.onChange(() => this._action.checked = !!this.checkbox && this.checkbox.checked, this));
		this.element.appendChild(this.checkbox.domNode);
	}

	updateEnabled(): void {
		if (this.checkbox) {
			if (this.isEnabled()) {
				this.checkbox.enable();
			} else {
				this.checkbox.disable();
			}
		}
	}

	updateChecked(): void {
		if (this.checkbox) {
			this.checkbox.checked = this._action.checked;
		}
	}

	dispose(): void {
		this.disposables.dispose();
		super.dispose();
	}
}

export class Checkbox extends Widget {

	private readonly _onChange = this._register(new Emitter<boolean>());
	readonly onChange: Event<boolean /* via keyboard */> = this._onChange.event;

	private readonly _onKeyDown = this._register(new Emitter<IKeyboardEvent>());
	readonly onKeyDown: Event<IKeyboardEvent> = this._onKeyDown.event;

	private readonly _opts: ICheckboxOpts;
	readonly domNode: HTMLElement;

	private _checked: boolean;

	constructor(opts: ICheckboxOpts) {
		super();

		this._opts = { ...defaultOpts, ...opts };
		this._checked = this._opts.isChecked;

		const classes = ['monaco-custom-checkbox'];
		if (this._opts.icon) {
			classes.push(this._opts.icon.classNames);
		} else {
			classes.push('codicon'); // todo@aeschli: remove once codicon fully adopted
		}
		if (this._opts.actionClassName) {
			classes.push(this._opts.actionClassName);
		}
		classes.push(this._checked ? 'checked' : 'unchecked');

		this.domNode = document.createElement('div');
		this.domNode.title = this._opts.title;
		this.domNode.className = classes.join(' ');
		this.domNode.tabIndex = 0;
		this.domNode.setAttribute('role', 'checkbox');
		this.domNode.setAttribute('aria-checked', String(this._checked));
		this.domNode.setAttribute('aria-label', this._opts.title);

		this.applyStyles();

		this.onclick(this.domNode, (ev) => {
			this.checked = !this._checked;
			this._onChange.fire(false);
			ev.preventDefault();
		});

		this.ignoreGesture(this.domNode);

		this.onkeydown(this.domNode, (keyboardEvent) => {
			if (keyboardEvent.keyCode === KeyCode.Space || keyboardEvent.keyCode === KeyCode.Enter) {
				this.checked = !this._checked;
				this._onChange.fire(true);
				keyboardEvent.preventDefault();
				return;
			}

			this._onKeyDown.fire(keyboardEvent);
		});
	}

	get enabled(): boolean {
		return this.domNode.getAttribute('aria-disabled') !== 'true';
	}

	focus(): void {
		this.domNode.focus();
	}

	get checked(): boolean {
		return this._checked;
	}

	set checked(newIsChecked: boolean) {
		this._checked = newIsChecked;
		this.domNode.setAttribute('aria-checked', String(this._checked));
		if (this._checked) {
			this.domNode.classList.add('checked');
		} else {
			this.domNode.classList.remove('checked');
		}

		this.applyStyles();
	}

	width(): number {
		return 2 /*marginleft*/ + 2 /*border*/ + 2 /*padding*/ + 16 /* icon width */;
	}

	style(styles: ICheckboxStyles): void {
		if (styles.inputActiveOptionBorder) {
			this._opts.inputActiveOptionBorder = styles.inputActiveOptionBorder;
		}
		if (styles.inputActiveOptionForeground) {
			this._opts.inputActiveOptionForeground = styles.inputActiveOptionForeground;
		}
		if (styles.inputActiveOptionBackground) {
			this._opts.inputActiveOptionBackground = styles.inputActiveOptionBackground;
		}
		this.applyStyles();
	}

	protected applyStyles(): void {
		if (this.domNode) {
			this.domNode.style.borderColor = this._checked && this._opts.inputActiveOptionBorder ? this._opts.inputActiveOptionBorder.toString() : 'transparent';
			this.domNode.style.color = this._checked && this._opts.inputActiveOptionForeground ? this._opts.inputActiveOptionForeground.toString() : 'inherit';
			this.domNode.style.backgroundColor = this._checked && this._opts.inputActiveOptionBackground ? this._opts.inputActiveOptionBackground.toString() : 'transparent';
		}
	}

	enable(): void {
		this.domNode.tabIndex = 0;
		this.domNode.setAttribute('aria-disabled', String(false));
	}

	disable(): void {
		DOM.removeTabIndexAndUpdateFocus(this.domNode);
		this.domNode.setAttribute('aria-disabled', String(true));
	}
}

export class SimpleCheckbox extends Widget {
	private checkbox: Checkbox;
	private styles: ISimpleCheckboxStyles;

	readonly domNode: HTMLElement;

	constructor(private title: string, private isChecked: boolean) {
		super();

		this.checkbox = new Checkbox({ title: this.title, isChecked: this.isChecked, icon: Codicon.check, actionClassName: 'monaco-simple-checkbox' });

		this.domNode = this.checkbox.domNode;

		this.styles = {};

		this.checkbox.onChange(() => {
			this.applyStyles();
		});
	}

	get checked(): boolean {
		return this.checkbox.checked;
	}

	set checked(newIsChecked: boolean) {
		this.checkbox.checked = newIsChecked;

		this.applyStyles();
	}

	style(styles: ISimpleCheckboxStyles): void {
		this.styles = styles;

		this.applyStyles();
	}

	protected applyStyles(): void {
		this.domNode.style.color = this.styles.checkboxForeground ? this.styles.checkboxForeground.toString() : '';
		this.domNode.style.backgroundColor = this.styles.checkboxBackground ? this.styles.checkboxBackground.toString() : '';
		this.domNode.style.borderColor = this.styles.checkboxBorder ? this.styles.checkboxBorder.toString() : '';
	}
}
