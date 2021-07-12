/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/quickInput';
import * as dom from 'vs/base/browser/dom';
import { InputBox, IRange, MessageType, IInputBoxStyles } from 'vs/base/browser/ui/inputbox/inputBox';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import Severity from 'vs/base/common/severity';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';

const $ = dom.$;

export class QuickInputBox extends Disposable {

	private container: HTMLElement;
	private inputBox: InputBox;

	constructor(
		private parent: HTMLElement
	) {
		super();
		this.container = dom.append(this.parent, $('.quick-input-box'));
		this.inputBox = this._register(new InputBox(this.container, undefined, { shouldNotBlurOnDisable: true }));
	}

	onKeyDown = (handler: (event: StandardKeyboardEvent) => void): IDisposable => {
		return dom.addDisposableListener(this.inputBox.inputElement, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			handler(new StandardKeyboardEvent(e));
		});
	};

	onMouseDown = (handler: (event: StandardMouseEvent) => void): IDisposable => {
		return dom.addDisposableListener(this.inputBox.inputElement, dom.EventType.MOUSE_DOWN, (e: MouseEvent) => {
			handler(new StandardMouseEvent(e));
		});
	};

	onDidChange = (handler: (event: string) => void): IDisposable => {
		return this.inputBox.onDidChange(handler);
	};

	get value() {
		return this.inputBox.value;
	}

	set value(value: string) {
		this.inputBox.value = value;
	}

	select(range: IRange | null = null): void {
		this.inputBox.select(range);
	}

	isSelectionAtEnd(): boolean {
		return this.inputBox.isSelectionAtEnd();
	}

	setPlaceholder(placeholder: string): void {
		this.inputBox.setPlaceHolder(placeholder);
	}

	get placeholder() {
		return this.inputBox.inputElement.getAttribute('placeholder') || '';
	}

	set placeholder(placeholder: string) {
		this.inputBox.setPlaceHolder(placeholder);
	}

	get ariaLabel() {
		return this.inputBox.getAriaLabel();
	}

	set ariaLabel(ariaLabel: string) {
		this.inputBox.setAriaLabel(ariaLabel);
	}

	get password() {
		return this.inputBox.inputElement.type === 'password';
	}

	set password(password: boolean) {
		this.inputBox.inputElement.type = password ? 'password' : 'text';
	}

	set enabled(enabled: boolean) {
		this.inputBox.setEnabled(enabled);
	}

	hasFocus(): boolean {
		return this.inputBox.hasFocus();
	}

	setAttribute(name: string, value: string): void {
		this.inputBox.inputElement.setAttribute(name, value);
	}

	removeAttribute(name: string): void {
		this.inputBox.inputElement.removeAttribute(name);
	}

	showDecoration(decoration: Severity): void {
		if (decoration === Severity.Ignore) {
			this.inputBox.hideMessage();
		} else {
			this.inputBox.showMessage({ type: decoration === Severity.Info ? MessageType.INFO : decoration === Severity.Warning ? MessageType.WARNING : MessageType.ERROR, content: '' });
		}
	}

	stylesForType(decoration: Severity) {
		return this.inputBox.stylesForType(decoration === Severity.Info ? MessageType.INFO : decoration === Severity.Warning ? MessageType.WARNING : MessageType.ERROR);
	}

	setFocus(): void {
		this.inputBox.focus();
	}

	layout(): void {
		this.inputBox.layout();
	}

	style(styles: IInputBoxStyles): void {
		this.inputBox.style(styles);
	}
}
