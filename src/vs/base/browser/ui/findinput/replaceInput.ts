/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./findInput';

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { IMessage as InputBoxMessage, IInputValidator, IInputBoxStyles, HistoryInputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { IContextViewProvider } from 'vs/base/browser/ui/contextview/contextview';
import { Widget } from 'vs/base/browser/ui/widget';
import { Event, Emitter } from 'vs/base/common/event';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Color } from 'vs/base/common/color';
import { ICheckboxStyles, Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { IFindInputCheckboxOpts } from 'vs/base/browser/ui/findinput/findInputCheckboxes';
import { Codicon } from 'vs/base/common/codicons';

export interface IReplaceInputOptions extends IReplaceInputStyles {
	readonly placeholder?: string;
	readonly width?: number;
	readonly validation?: IInputValidator;
	readonly label: string;
	readonly flexibleHeight?: boolean;
	readonly flexibleWidth?: boolean;
	readonly flexibleMaxHeight?: number;

	readonly appendPreserveCaseLabel?: string;
	readonly history?: string[];
}

export interface IReplaceInputStyles extends IInputBoxStyles {
	inputActiveOptionBorder?: Color;
	inputActiveOptionForeground?: Color;
	inputActiveOptionBackground?: Color;
}

const NLS_DEFAULT_LABEL = nls.localize('defaultLabel', "input");
const NLS_PRESERVE_CASE_LABEL = nls.localize('label.preserveCaseCheckbox', "Preserve Case");

export class PreserveCaseCheckbox extends Checkbox {
	constructor(opts: IFindInputCheckboxOpts) {
		super({
			// TODO: does this need its own icon?
			icon: Codicon.preserveCase,
			title: NLS_PRESERVE_CASE_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}

export class ReplaceInput extends Widget {

	static readonly OPTION_CHANGE: string = 'optionChange';

	private contextViewProvider: IContextViewProvider | undefined;
	private placeholder: string;
	private validation?: IInputValidator;
	private label: string;
	private fixFocusOnOptionClickEnabled = true;

	private inputActiveOptionBorder?: Color;
	private inputActiveOptionForeground?: Color;
	private inputActiveOptionBackground?: Color;
	private inputBackground?: Color;
	private inputForeground?: Color;
	private inputBorder?: Color;

	private inputValidationInfoBorder?: Color;
	private inputValidationInfoBackground?: Color;
	private inputValidationInfoForeground?: Color;
	private inputValidationWarningBorder?: Color;
	private inputValidationWarningBackground?: Color;
	private inputValidationWarningForeground?: Color;
	private inputValidationErrorBorder?: Color;
	private inputValidationErrorBackground?: Color;
	private inputValidationErrorForeground?: Color;

	private preserveCase: PreserveCaseCheckbox;
	private cachedOptionsWidth: number = 0;
	public domNode: HTMLElement;
	public inputBox: HistoryInputBox;

	private readonly _onDidOptionChange = this._register(new Emitter<boolean>());
	public readonly onDidOptionChange: Event<boolean /* via keyboard */> = this._onDidOptionChange.event;

	private readonly _onKeyDown = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyDown: Event<IKeyboardEvent> = this._onKeyDown.event;

	private readonly _onMouseDown = this._register(new Emitter<IMouseEvent>());
	public readonly onMouseDown: Event<IMouseEvent> = this._onMouseDown.event;

	private readonly _onInput = this._register(new Emitter<void>());
	public readonly onInput: Event<void> = this._onInput.event;

	private readonly _onKeyUp = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyUp: Event<IKeyboardEvent> = this._onKeyUp.event;

	private _onPreserveCaseKeyDown = this._register(new Emitter<IKeyboardEvent>());
	public readonly onPreserveCaseKeyDown: Event<IKeyboardEvent> = this._onPreserveCaseKeyDown.event;

	constructor(parent: HTMLElement | null, contextViewProvider: IContextViewProvider | undefined, private readonly _showOptionButtons: boolean, options: IReplaceInputOptions) {
		super();
		this.contextViewProvider = contextViewProvider;
		this.placeholder = options.placeholder || '';
		this.validation = options.validation;
		this.label = options.label || NLS_DEFAULT_LABEL;

		this.inputActiveOptionBorder = options.inputActiveOptionBorder;
		this.inputActiveOptionForeground = options.inputActiveOptionForeground;
		this.inputActiveOptionBackground = options.inputActiveOptionBackground;
		this.inputBackground = options.inputBackground;
		this.inputForeground = options.inputForeground;
		this.inputBorder = options.inputBorder;

		this.inputValidationInfoBorder = options.inputValidationInfoBorder;
		this.inputValidationInfoBackground = options.inputValidationInfoBackground;
		this.inputValidationInfoForeground = options.inputValidationInfoForeground;
		this.inputValidationWarningBorder = options.inputValidationWarningBorder;
		this.inputValidationWarningBackground = options.inputValidationWarningBackground;
		this.inputValidationWarningForeground = options.inputValidationWarningForeground;
		this.inputValidationErrorBorder = options.inputValidationErrorBorder;
		this.inputValidationErrorBackground = options.inputValidationErrorBackground;
		this.inputValidationErrorForeground = options.inputValidationErrorForeground;

		const appendPreserveCaseLabel = options.appendPreserveCaseLabel || '';
		const history = options.history || [];
		const flexibleHeight = !!options.flexibleHeight;
		const flexibleWidth = !!options.flexibleWidth;
		const flexibleMaxHeight = options.flexibleMaxHeight;

		this.domNode = document.createElement('div');
		this.domNode.classList.add('monaco-findInput');

		this.inputBox = this._register(new HistoryInputBox(this.domNode, this.contextViewProvider, {
			ariaLabel: this.label || '',
			placeholder: this.placeholder || '',
			validationOptions: {
				validation: this.validation
			},
			inputBackground: this.inputBackground,
			inputForeground: this.inputForeground,
			inputBorder: this.inputBorder,
			inputValidationInfoBackground: this.inputValidationInfoBackground,
			inputValidationInfoForeground: this.inputValidationInfoForeground,
			inputValidationInfoBorder: this.inputValidationInfoBorder,
			inputValidationWarningBackground: this.inputValidationWarningBackground,
			inputValidationWarningForeground: this.inputValidationWarningForeground,
			inputValidationWarningBorder: this.inputValidationWarningBorder,
			inputValidationErrorBackground: this.inputValidationErrorBackground,
			inputValidationErrorForeground: this.inputValidationErrorForeground,
			inputValidationErrorBorder: this.inputValidationErrorBorder,
			history,
			flexibleHeight,
			flexibleWidth,
			flexibleMaxHeight
		}));

		this.preserveCase = this._register(new PreserveCaseCheckbox({
			appendTitle: appendPreserveCaseLabel,
			isChecked: false,
			inputActiveOptionBorder: this.inputActiveOptionBorder,
			inputActiveOptionForeground: this.inputActiveOptionForeground,
			inputActiveOptionBackground: this.inputActiveOptionBackground,
		}));
		this._register(this.preserveCase.onChange(viaKeyboard => {
			this._onDidOptionChange.fire(viaKeyboard);
			if (!viaKeyboard && this.fixFocusOnOptionClickEnabled) {
				this.inputBox.focus();
			}
			this.validate();
		}));
		this._register(this.preserveCase.onKeyDown(e => {
			this._onPreserveCaseKeyDown.fire(e);
		}));

		if (this._showOptionButtons) {
			this.cachedOptionsWidth = this.preserveCase.width();
		} else {
			this.cachedOptionsWidth = 0;
		}

		// Arrow-Key support to navigate between options
		let indexes = [this.preserveCase.domNode];
		this.onkeydown(this.domNode, (event: IKeyboardEvent) => {
			if (event.equals(KeyCode.LeftArrow) || event.equals(KeyCode.RightArrow) || event.equals(KeyCode.Escape)) {
				let index = indexes.indexOf(<HTMLElement>document.activeElement);
				if (index >= 0) {
					let newIndex: number = -1;
					if (event.equals(KeyCode.RightArrow)) {
						newIndex = (index + 1) % indexes.length;
					} else if (event.equals(KeyCode.LeftArrow)) {
						if (index === 0) {
							newIndex = indexes.length - 1;
						} else {
							newIndex = index - 1;
						}
					}

					if (event.equals(KeyCode.Escape)) {
						indexes[index].blur();
						this.inputBox.focus();
					} else if (newIndex >= 0) {
						indexes[newIndex].focus();
					}

					dom.EventHelper.stop(event, true);
				}
			}
		});


		let controls = document.createElement('div');
		controls.className = 'controls';
		controls.style.display = this._showOptionButtons ? 'block' : 'none';
		controls.appendChild(this.preserveCase.domNode);

		this.domNode.appendChild(controls);

		if (parent) {
			parent.appendChild(this.domNode);
		}

		this.onkeydown(this.inputBox.inputElement, (e) => this._onKeyDown.fire(e));
		this.onkeyup(this.inputBox.inputElement, (e) => this._onKeyUp.fire(e));
		this.oninput(this.inputBox.inputElement, (e) => this._onInput.fire());
		this.onmousedown(this.inputBox.inputElement, (e) => this._onMouseDown.fire(e));
	}

	public enable(): void {
		this.domNode.classList.remove('disabled');
		this.inputBox.enable();
		this.preserveCase.enable();
	}

	public disable(): void {
		this.domNode.classList.add('disabled');
		this.inputBox.disable();
		this.preserveCase.disable();
	}

	public setFocusInputOnOptionClick(value: boolean): void {
		this.fixFocusOnOptionClickEnabled = value;
	}

	public setEnabled(enabled: boolean): void {
		if (enabled) {
			this.enable();
		} else {
			this.disable();
		}
	}

	public clear(): void {
		this.clearValidation();
		this.setValue('');
		this.focus();
	}

	public getValue(): string {
		return this.inputBox.value;
	}

	public setValue(value: string): void {
		if (this.inputBox.value !== value) {
			this.inputBox.value = value;
		}
	}

	public onSearchSubmit(): void {
		this.inputBox.addToHistory();
	}

	public style(styles: IReplaceInputStyles): void {
		this.inputActiveOptionBorder = styles.inputActiveOptionBorder;
		this.inputActiveOptionForeground = styles.inputActiveOptionForeground;
		this.inputActiveOptionBackground = styles.inputActiveOptionBackground;
		this.inputBackground = styles.inputBackground;
		this.inputForeground = styles.inputForeground;
		this.inputBorder = styles.inputBorder;

		this.inputValidationInfoBackground = styles.inputValidationInfoBackground;
		this.inputValidationInfoForeground = styles.inputValidationInfoForeground;
		this.inputValidationInfoBorder = styles.inputValidationInfoBorder;
		this.inputValidationWarningBackground = styles.inputValidationWarningBackground;
		this.inputValidationWarningForeground = styles.inputValidationWarningForeground;
		this.inputValidationWarningBorder = styles.inputValidationWarningBorder;
		this.inputValidationErrorBackground = styles.inputValidationErrorBackground;
		this.inputValidationErrorForeground = styles.inputValidationErrorForeground;
		this.inputValidationErrorBorder = styles.inputValidationErrorBorder;

		this.applyStyles();
	}

	protected applyStyles(): void {
		if (this.domNode) {
			const checkBoxStyles: ICheckboxStyles = {
				inputActiveOptionBorder: this.inputActiveOptionBorder,
				inputActiveOptionForeground: this.inputActiveOptionForeground,
				inputActiveOptionBackground: this.inputActiveOptionBackground,
			};
			this.preserveCase.style(checkBoxStyles);

			const inputBoxStyles: IInputBoxStyles = {
				inputBackground: this.inputBackground,
				inputForeground: this.inputForeground,
				inputBorder: this.inputBorder,
				inputValidationInfoBackground: this.inputValidationInfoBackground,
				inputValidationInfoForeground: this.inputValidationInfoForeground,
				inputValidationInfoBorder: this.inputValidationInfoBorder,
				inputValidationWarningBackground: this.inputValidationWarningBackground,
				inputValidationWarningForeground: this.inputValidationWarningForeground,
				inputValidationWarningBorder: this.inputValidationWarningBorder,
				inputValidationErrorBackground: this.inputValidationErrorBackground,
				inputValidationErrorForeground: this.inputValidationErrorForeground,
				inputValidationErrorBorder: this.inputValidationErrorBorder
			};
			this.inputBox.style(inputBoxStyles);
		}
	}

	public select(): void {
		this.inputBox.select();
	}

	public focus(): void {
		this.inputBox.focus();
	}

	public getPreserveCase(): boolean {
		return this.preserveCase.checked;
	}

	public setPreserveCase(value: boolean): void {
		this.preserveCase.checked = value;
	}

	public focusOnPreserve(): void {
		this.preserveCase.focus();
	}

	private _lastHighlightFindOptions: number = 0;
	public highlightFindOptions(): void {
		this.domNode.classList.remove('highlight-' + (this._lastHighlightFindOptions));
		this._lastHighlightFindOptions = 1 - this._lastHighlightFindOptions;
		this.domNode.classList.add('highlight-' + (this._lastHighlightFindOptions));
	}

	public validate(): void {
		if (this.inputBox) {
			this.inputBox.validate();
		}
	}

	public showMessage(message: InputBoxMessage): void {
		if (this.inputBox) {
			this.inputBox.showMessage(message);
		}
	}

	public clearMessage(): void {
		if (this.inputBox) {
			this.inputBox.hideMessage();
		}
	}

	private clearValidation(): void {
		if (this.inputBox) {
			this.inputBox.hideMessage();
		}
	}

	public set width(newWidth: number) {
		this.inputBox.paddingRight = this.cachedOptionsWidth;
		this.inputBox.width = newWidth;
		this.domNode.style.width = newWidth + 'px';
	}

	public override dispose(): void {
		super.dispose();
	}
}
