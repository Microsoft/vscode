/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import * as dom from 'vs/base/browser/dom';
import * as arrays from 'vs/base/common/arrays';
import { ISelectBoxDelegate, ISelectOptionItem, ISelectBoxOptions, ISelectBoxStyles, ISelectData } from 'vs/base/browser/ui/selectBox/selectBox';
import { isMacintosh } from 'vs/base/common/platform';
import { Gesture, EventType } from 'vs/base/browser/touch';

export class SelectBoxNative extends Disposable implements ISelectBoxDelegate {

	private selectElement: HTMLSelectElement;
	private selectBoxOptions: ISelectBoxOptions;
	private options: ISelectOptionItem[];
	private selected = 0;
	private readonly _onDidSelect: Emitter<ISelectData>;
	private styles: ISelectBoxStyles;

	constructor(options: ISelectOptionItem[], selected: number, styles: ISelectBoxStyles, selectBoxOptions?: ISelectBoxOptions) {
		super();
		this.selectBoxOptions = selectBoxOptions || Object.create(null);

		this.options = [];

		this.selectElement = document.createElement('select');

		this.selectElement.className = 'monaco-select-box';

		if (typeof this.selectBoxOptions.ariaLabel === 'string') {
			this.selectElement.setAttribute('aria-label', this.selectBoxOptions.ariaLabel);
		}

		this._onDidSelect = this._register(new Emitter<ISelectData>());

		this.styles = styles;

		this.registerListeners();
		this.setOptions(options, selected);
	}

	private registerListeners() {
		this._register(Gesture.addTarget(this.selectElement));
		[EventType.Tap].forEach(eventType => {
			this._register(dom.addDisposableListener(this.selectElement, eventType, (e) => {
				this.selectElement.focus();
			}));
		});

		this._register(dom.addStandardDisposableListener(this.selectElement, 'click', (e) => {
			dom.EventHelper.stop(e, true);
		}));

		this._register(dom.addStandardDisposableListener(this.selectElement, 'change', (e) => {
			this.selectElement.title = e.target.value;
			this._onDidSelect.fire({
				index: e.target.selectedIndex,
				selected: e.target.value
			});
		}));

		this._register(dom.addStandardDisposableListener(this.selectElement, 'keydown', (e) => {
			let showSelect = false;

			if (isMacintosh) {
				if (e.keyCode === KeyCode.DownArrow || e.keyCode === KeyCode.UpArrow || e.keyCode === KeyCode.Space) {
					showSelect = true;
				}
			} else {
				if (e.keyCode === KeyCode.DownArrow && e.altKey || e.keyCode === KeyCode.Space || e.keyCode === KeyCode.Enter) {
					showSelect = true;
				}
			}

			if (showSelect) {
				// Space, Enter, is used to expand select box, do not propagate it (prevent action bar action run)
				e.stopPropagation();
			}
		}));
	}

	public get onDidSelect(): Event<ISelectData> {
		return this._onDidSelect.event;
	}

	public setOptions(options: ISelectOptionItem[], selected?: number): void {

		if (!this.options || !arrays.equals(this.options, options)) {
			this.options = options;
			this.selectElement.options.length = 0;

			this.options.forEach((option, index) => {
				this.selectElement.add(this.createOption(option.text, index, option.isDisabled));
			});

		}

		if (selected !== undefined) {
			this.select(selected);
		}
	}

	public select(index: number): void {
		if (this.options.length === 0) {
			this.selected = 0;
		} else if (index >= 0 && index < this.options.length) {
			this.selected = index;
		} else if (index > this.options.length - 1) {
			// Adjust index to end of list
			// This could make client out of sync with the select
			this.select(this.options.length - 1);
		} else if (this.selected < 0) {
			this.selected = 0;
		}

		this.selectElement.selectedIndex = this.selected;
		if ((this.selected < this.options.length) && typeof this.options[this.selected].text === 'string') {
			this.selectElement.title = this.options[this.selected].text;
		} else {
			this.selectElement.title = '';
		}
	}

	public setAriaLabel(label: string): void {
		this.selectBoxOptions.ariaLabel = label;
		this.selectElement.setAttribute('aria-label', label);
	}

	public focus(): void {
		if (this.selectElement) {
			this.selectElement.focus();
		}
	}

	public blur(): void {
		if (this.selectElement) {
			this.selectElement.blur();
		}
	}

	public render(container: HTMLElement): void {
		dom.addClass(container, 'select-container');
		container.appendChild(this.selectElement);
		this.setOptions(this.options, this.selected);
		this.applyStyles();
	}

	public style(styles: ISelectBoxStyles): void {
		this.styles = styles;
		this.applyStyles();
	}

	public applyStyles(): void {

		// Style native select
		if (this.selectElement) {
			const background = this.styles.selectBackground ? this.styles.selectBackground.toString() : '';
			const foreground = this.styles.selectForeground ? this.styles.selectForeground.toString() : '';
			const border = this.styles.selectBorder ? this.styles.selectBorder.toString() : '';

			this.selectElement.style.backgroundColor = background;
			this.selectElement.style.color = foreground;
			this.selectElement.style.borderColor = border;
		}

	}

	private createOption(value: string, index: number, disabled?: boolean): HTMLOptionElement {
		const option = document.createElement('option');
		option.value = value;
		option.text = value;
		option.disabled = !!disabled;

		return option;
	}
}
