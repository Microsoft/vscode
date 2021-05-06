/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./dialog';
import * as nls from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { $, hide, show, EventHelper, clearNode, isAncestor, addDisposableListener, EventType } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Color } from 'vs/base/common/color';
import { ButtonBar, ButtonWithDescription, IButtonStyles } from 'vs/base/browser/ui/button/button';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action } from 'vs/base/common/actions';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { isMacintosh, isLinux } from 'vs/base/common/platform';
import { SimpleCheckbox, ISimpleCheckboxStyles } from 'vs/base/browser/ui/checkbox/checkbox';
import { Codicon, registerCodicon } from 'vs/base/common/codicons';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';

export interface IDialogInputOptions {
	readonly placeholder?: string;
	readonly type?: 'text' | 'password';
	readonly value?: string;
}

export interface IDialogOptions {
	readonly cancelId?: number;
	readonly detail?: string;
	readonly checkboxLabel?: string;
	readonly checkboxChecked?: boolean;
	readonly type?: 'none' | 'info' | 'error' | 'question' | 'warning' | 'pending';
	readonly inputs?: IDialogInputOptions[];
	readonly keyEventProcessor?: (event: StandardKeyboardEvent) => void;
	readonly renderBody?: (container: HTMLElement) => void;
	readonly icon?: Codicon;
	readonly buttonDetails?: string[];
	readonly disableCloseAction?: boolean;
}

export interface IDialogResult {
	readonly button: number;
	readonly checkboxChecked?: boolean;
	readonly values?: string[];
}

export interface IDialogStyles extends IButtonStyles, ISimpleCheckboxStyles {
	readonly dialogForeground?: Color;
	readonly dialogBackground?: Color;
	readonly dialogShadow?: Color;
	readonly dialogBorder?: Color;
	readonly errorIconForeground?: Color;
	readonly warningIconForeground?: Color;
	readonly infoIconForeground?: Color;
	readonly inputBackground?: Color;
	readonly inputForeground?: Color;
	readonly inputBorder?: Color;
	readonly textLinkForeground?: Color;

}

interface ButtonMapEntry {
	readonly label: string;
	readonly index: number;
}

const dialogErrorIcon = registerCodicon('dialog-error', Codicon.error);
const dialogWarningIcon = registerCodicon('dialog-warning', Codicon.warning);
const dialogInfoIcon = registerCodicon('dialog-info', Codicon.info);
const dialogCloseIcon = registerCodicon('dialog-close', Codicon.close);

export class Dialog extends Disposable {
	private readonly element: HTMLElement;
	private readonly shadowElement: HTMLElement;
	private modalElement: HTMLElement | undefined;
	private readonly buttonsContainer: HTMLElement;
	private readonly messageDetailElement: HTMLElement;
	private readonly messageContainer: HTMLElement;
	private readonly iconElement: HTMLElement;
	private readonly checkbox: SimpleCheckbox | undefined;
	private readonly toolbarContainer: HTMLElement;
	private buttonBar: ButtonBar | undefined;
	private styles: IDialogStyles | undefined;
	private focusToReturn: HTMLElement | undefined;
	private readonly inputs: InputBox[];
	private readonly buttons: string[];

	constructor(private container: HTMLElement, private message: string, buttons: string[], private options: IDialogOptions) {
		super();

		this.modalElement = this.container.appendChild($(`.monaco-dialog-modal-block.dimmed`));
		this.shadowElement = this.modalElement.appendChild($('.dialog-shadow'));
		this.element = this.shadowElement.appendChild($('.monaco-dialog-box'));
		this.element.setAttribute('role', 'dialog');
		hide(this.element);

		this.buttons = buttons.length ? buttons : [nls.localize('ok', "OK")]; // If no button is provided, default to OK
		const buttonsRowElement = this.element.appendChild($('.dialog-buttons-row'));
		this.buttonsContainer = buttonsRowElement.appendChild($('.dialog-buttons'));

		const messageRowElement = this.element.appendChild($('.dialog-message-row'));
		this.iconElement = messageRowElement.appendChild($('.dialog-icon'));
		this.messageContainer = messageRowElement.appendChild($('.dialog-message-container'));

		if (this.options.detail || this.options.renderBody) {
			const messageElement = this.messageContainer.appendChild($('.dialog-message'));
			const messageTextElement = messageElement.appendChild($('.dialog-message-text'));
			messageTextElement.innerText = this.message;
		}

		this.messageDetailElement = this.messageContainer.appendChild($('.dialog-message-detail'));
		if (this.options.detail || !this.options.renderBody) {
			this.messageDetailElement.innerText = this.options.detail ? this.options.detail : message;
		} else {
			this.messageDetailElement.style.display = 'none';
		}

		if (this.options.renderBody) {
			const customBody = this.messageContainer.appendChild($('.dialog-message-body'));
			this.options.renderBody(customBody);
		}

		if (this.options.inputs) {
			this.inputs = this.options.inputs.map(input => {
				const inputRowElement = this.messageContainer.appendChild($('.dialog-message-input'));

				const inputBox = this._register(new InputBox(inputRowElement, undefined, {
					placeholder: input.placeholder,
					type: input.type ?? 'text',
				}));

				if (input.value) {
					inputBox.value = input.value;
				}

				return inputBox;
			});
		} else {
			this.inputs = [];
		}

		if (this.options.checkboxLabel) {
			const checkboxRowElement = this.messageContainer.appendChild($('.dialog-checkbox-row'));

			const checkbox = this.checkbox = this._register(new SimpleCheckbox(this.options.checkboxLabel, !!this.options.checkboxChecked));

			checkboxRowElement.appendChild(checkbox.domNode);

			const checkboxMessageElement = checkboxRowElement.appendChild($('.dialog-checkbox-message'));
			checkboxMessageElement.innerText = this.options.checkboxLabel;
			this._register(addDisposableListener(checkboxMessageElement, EventType.CLICK, () => checkbox.checked = !checkbox.checked));
		}

		const toolbarRowElement = this.element.appendChild($('.dialog-toolbar-row'));
		this.toolbarContainer = toolbarRowElement.appendChild($('.dialog-toolbar'));
	}

	private getAriaLabel(): string {
		let typeLabel = nls.localize('dialogInfoMessage', 'Info');
		switch (this.options.type) {
			case 'error':
				nls.localize('dialogErrorMessage', 'Error');
				break;
			case 'warning':
				nls.localize('dialogWarningMessage', 'Warning');
				break;
			case 'pending':
				nls.localize('dialogPendingMessage', 'In Progress');
				break;
			case 'none':
			case 'info':
			case 'question':
			default:
				break;
		}

		return `${typeLabel}: ${this.message} ${this.options.detail || ''}`;
	}

	updateMessage(message: string): void {
		this.messageDetailElement.innerText = message;
	}

	async show(): Promise<IDialogResult> {
		this.focusToReturn = document.activeElement as HTMLElement;

		return new Promise<IDialogResult>((resolve) => {
			clearNode(this.buttonsContainer);

			const buttonBar = this.buttonBar = this._register(new ButtonBar(this.buttonsContainer));
			const buttonMap = this.rearrangeButtons(this.buttons, this.options.cancelId);
			this.buttonsContainer.classList.toggle('centered');

			// Handle button clicks
			buttonMap.forEach((entry, index) => {
				const primary = buttonMap[index].index === 0;
				const button = this.options.buttonDetails ? this._register(buttonBar.addButtonWithDescription({ title: true, secondary: !primary })) : this._register(buttonBar.addButton({ title: true, secondary: !primary }));
				button.label = mnemonicButtonLabel(buttonMap[index].label, true);
				if (button instanceof ButtonWithDescription) {
					button.description = this.options.buttonDetails![buttonMap[index].index];
				}
				this._register(button.onDidClick(e => {
					if (e) {
						EventHelper.stop(e);
					}

					resolve({
						button: buttonMap[index].index,
						checkboxChecked: this.checkbox ? this.checkbox.checked : undefined,
						values: this.inputs.length > 0 ? this.inputs.map(input => input.value) : undefined
					});
				}));
			});

			// Handle keyboard events gloably: Tab, Arrow-Left/Right
			this._register(domEvent(window, 'keydown', true)((e: KeyboardEvent) => {
				const evt = new StandardKeyboardEvent(e);

				if (evt.equals(KeyCode.Enter)) {

					// Enter in input field should OK the dialog
					if (this.inputs.some(input => input.hasFocus())) {
						EventHelper.stop(e);

						resolve({
							button: buttonMap.find(button => button.index !== this.options.cancelId)?.index ?? 0,
							checkboxChecked: this.checkbox ? this.checkbox.checked : undefined,
							values: this.inputs.length > 0 ? this.inputs.map(input => input.value) : undefined
						});
					}

					return; // leave default handling
				}

				if (evt.equals(KeyCode.Space)) {
					return; // leave default handling
				}

				let eventHandled = false;

				// Focus: Next / Previous
				if (evt.equals(KeyCode.Tab) || evt.equals(KeyCode.RightArrow) || evt.equals(KeyMod.Shift | KeyCode.Tab) || evt.equals(KeyCode.LeftArrow)) {

					// Build a list of focusable elements in their visual order
					const focusableElements: { focus: () => void }[] = [];
					let focusedIndex = -1;
					for (const input of this.inputs) {
						focusableElements.push(input);
						if (input.hasFocus()) {
							focusedIndex = focusableElements.length - 1;
						}
					}

					if (this.checkbox) {
						focusableElements.push(this.checkbox);
						if (this.checkbox.hasFocus()) {
							focusedIndex = focusableElements.length - 1;
						}
					}

					if (this.buttonBar) {
						for (const button of this.buttonBar.buttons) {
							focusableElements.push(button);
							if (button.hasFocus()) {
								focusedIndex = focusableElements.length - 1;
							}
						}
					}

					// Focus next element (with wrapping)
					if (evt.equals(KeyCode.Tab) || evt.equals(KeyCode.RightArrow)) {
						if (focusedIndex === -1) {
							focusedIndex = 0; // default to focus first element if none have focus
						}

						const newFocusedIndex = (focusedIndex + 1) % focusableElements.length;
						focusableElements[newFocusedIndex].focus();
					}

					// Focus previous element (with wrapping)
					else {
						if (focusedIndex === -1) {
							focusedIndex = focusableElements.length; // default to focus last element if none have focus
						}

						let newFocusedIndex = focusedIndex - 1;
						if (newFocusedIndex === -1) {
							newFocusedIndex = focusableElements.length - 1;
						}

						focusableElements[newFocusedIndex].focus();
					}

					eventHandled = true;
				}

				if (eventHandled) {
					EventHelper.stop(e, true);
				} else if (this.options.keyEventProcessor) {
					this.options.keyEventProcessor(evt);
				}
			}));

			this._register(domEvent(window, 'keyup', true)((e: KeyboardEvent) => {
				EventHelper.stop(e, true);
				const evt = new StandardKeyboardEvent(e);

				if (!this.options.disableCloseAction && evt.equals(KeyCode.Escape)) {
					resolve({
						button: this.options.cancelId || 0,
						checkboxChecked: this.checkbox ? this.checkbox.checked : undefined
					});
				}
			}));

			// Detect focus out
			this._register(domEvent(this.element, 'focusout', false)((e: FocusEvent) => {
				if (!!e.relatedTarget && !!this.element) {
					if (!isAncestor(e.relatedTarget as HTMLElement, this.element)) {
						this.focusToReturn = e.relatedTarget as HTMLElement;

						if (e.target) {
							(e.target as HTMLElement).focus();
							EventHelper.stop(e, true);
						}
					}
				}
			}));

			const spinModifierClassName = 'codicon-modifier-spin';

			this.iconElement.classList.remove(...dialogErrorIcon.classNamesArray, ...dialogWarningIcon.classNamesArray, ...dialogInfoIcon.classNamesArray, ...Codicon.loading.classNamesArray, spinModifierClassName);

			if (this.options.icon) {
				this.iconElement.classList.add(...this.options.icon.classNamesArray);
			} else {
				switch (this.options.type) {
					case 'error':
						this.iconElement.classList.add(...dialogErrorIcon.classNamesArray);
						break;
					case 'warning':
						this.iconElement.classList.add(...dialogWarningIcon.classNamesArray);
						break;
					case 'pending':
						this.iconElement.classList.add(...Codicon.loading.classNamesArray, spinModifierClassName);
						break;
					case 'none':
					case 'info':
					case 'question':
					default:
						this.iconElement.classList.add(...dialogInfoIcon.classNamesArray);
						break;
				}
			}


			if (!this.options.disableCloseAction) {
				const actionBar = this._register(new ActionBar(this.toolbarContainer, {}));

				const action = this._register(new Action('dialog.close', nls.localize('dialogClose', "Close Dialog"), dialogCloseIcon.classNames, true, async () => {
					resolve({
						button: this.options.cancelId || 0,
						checkboxChecked: this.checkbox ? this.checkbox.checked : undefined
					});
				}));

				actionBar.push(action, { icon: true, label: false, });
			}

			this.applyStyles();

			this.element.setAttribute('aria-label', this.getAriaLabel());
			show(this.element);

			// Focus first element (input or button)
			if (this.inputs.length > 0) {
				this.inputs[0].focus();
				this.inputs[0].select();
			} else {
				buttonMap.forEach((value, index) => {
					if (value.index === 0) {
						buttonBar.buttons[index].focus();
					}
				});
			}
		});
	}

	private applyStyles() {
		if (this.styles) {
			const style = this.styles;

			const fgColor = style.dialogForeground;
			const bgColor = style.dialogBackground;
			const shadowColor = style.dialogShadow ? `0 0px 8px ${style.dialogShadow}` : '';
			const border = style.dialogBorder ? `1px solid ${style.dialogBorder}` : '';
			const linkFgColor = style.textLinkForeground;

			this.shadowElement.style.boxShadow = shadowColor;

			this.element.style.color = fgColor?.toString() ?? '';
			this.element.style.backgroundColor = bgColor?.toString() ?? '';
			this.element.style.border = border;

			if (this.buttonBar) {
				this.buttonBar.buttons.forEach(button => button.style(style));
			}

			if (this.checkbox) {
				this.checkbox.style(style);
			}

			if (fgColor && bgColor) {
				const messageDetailColor = fgColor.transparent(.9);
				this.messageDetailElement.style.color = messageDetailColor.makeOpaque(bgColor).toString();
			}

			if (linkFgColor) {
				for (const el of this.messageContainer.getElementsByTagName('a')) {
					el.style.color = linkFgColor.toString();
				}
			}

			let color;
			switch (this.options.type) {
				case 'error':
					color = style.errorIconForeground;
					break;
				case 'warning':
					color = style.warningIconForeground;
					break;
				default:
					color = style.infoIconForeground;
					break;
			}
			if (color) {
				this.iconElement.style.color = color.toString();
			}

			for (const input of this.inputs) {
				input.style(style);
			}
		}
	}

	style(style: IDialogStyles): void {
		this.styles = style;

		this.applyStyles();
	}

	override dispose(): void {
		super.dispose();

		if (this.modalElement) {
			this.modalElement.remove();
			this.modalElement = undefined;
		}

		if (this.focusToReturn && isAncestor(this.focusToReturn, document.body)) {
			this.focusToReturn.focus();
			this.focusToReturn = undefined;
		}
	}

	private rearrangeButtons(buttons: Array<string>, cancelId: number | undefined): ButtonMapEntry[] {
		const buttonMap: ButtonMapEntry[] = [];

		// Maps each button to its current label and old index so that when we move them around it's not a problem
		buttons.forEach((button, index) => {
			buttonMap.push({ label: button, index });
		});

		// macOS/linux: reverse button order
		if (isMacintosh || isLinux) {
			if (cancelId !== undefined) {
				const cancelButton = buttonMap.splice(cancelId, 1)[0];
				buttonMap.reverse();
				buttonMap.splice(buttonMap.length - 1, 0, cancelButton);
			}
		}

		return buttonMap;
	}
}
