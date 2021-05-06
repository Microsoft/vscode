/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { Widget } from 'vs/base/browser/ui/widget';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { IContextViewProvider } from 'vs/base/browser/ui/contextview/contextview';
import { IInputValidator, HistoryInputBox, IInputBoxStyles } from 'vs/base/browser/ui/inputbox/inputBox';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Event as CommonEvent, Emitter } from 'vs/base/common/event';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachInputBoxStyler, attachCheckboxStyler } from 'vs/platform/theme/common/styler';
import { ContextScopedHistoryInputBox } from 'vs/platform/browser/contextScopedHistoryWidget';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import type { IThemable } from 'vs/base/common/styler';
import { Codicon } from 'vs/base/common/codicons';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export interface IOptions {
	placeholder?: string;
	tooltip?: string;
	width?: number;
	validation?: IInputValidator;
	ariaLabel?: string;
	history?: string[];
	submitOnType?: boolean;
	submitOnTypeDelay?: number;
}

export class PatternInputWidget extends Widget implements IThemable {

	static OPTION_CHANGE: string = 'optionChange';

	inputFocusTracker!: dom.IFocusTracker;

	private width: number;
	private placeholder: string;
	private tooltip: string;
	private ariaLabel: string;

	private domNode!: HTMLElement;
	protected inputBox!: HistoryInputBox;

	private _onSubmit = this._register(new Emitter<boolean>());
	onSubmit: CommonEvent<boolean /* triggeredOnType */> = this._onSubmit.event;

	private _onCancel = this._register(new Emitter<void>());
	onCancel: CommonEvent<void> = this._onCancel.event;

	constructor(parent: HTMLElement, private contextViewProvider: IContextViewProvider, options: IOptions = Object.create(null),
		@IThemeService protected themeService: IThemeService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService protected readonly configurationService: IConfigurationService
	) {
		super();
		this.width = options.width || 100;
		this.placeholder = options.placeholder || '';
		this.tooltip = options.tooltip || '';
		this.ariaLabel = options.ariaLabel || nls.localize('defaultLabel', "input");

		this.render(options);

		parent.appendChild(this.domNode);
	}

	override dispose(): void {
		super.dispose();
		if (this.inputFocusTracker) {
			this.inputFocusTracker.dispose();
		}
	}

	setWidth(newWidth: number): void {
		this.width = newWidth;
		this.domNode.style.width = this.width + 'px';
		this.contextViewProvider.layout();
		this.setInputWidth();
	}

	getValue(): string {
		return this.inputBox.value;
	}

	setValue(value: string): void {
		if (this.inputBox.value !== value) {
			this.inputBox.value = value;
		}
	}


	select(): void {
		this.inputBox.select();
	}

	focus(): void {
		this.inputBox.focus();
	}

	inputHasFocus(): boolean {
		return this.inputBox.hasFocus();
	}

	private setInputWidth(): void {
		this.inputBox.width = this.width - this.getSubcontrolsWidth() - 2; // 2 for input box border
	}

	protected getSubcontrolsWidth(): number {
		return 0;
	}

	getHistory(): string[] {
		return this.inputBox.getHistory();
	}

	clearHistory(): void {
		this.inputBox.clearHistory();
	}

	clear(): void {
		this.setValue('');
	}

	onSearchSubmit(): void {
		this.inputBox.addToHistory();
	}

	showNextTerm() {
		this.inputBox.showNextValue();
	}

	showPreviousTerm() {
		this.inputBox.showPreviousValue();
	}

	style(styles: IInputBoxStyles): void {
		this.inputBox.style(styles);
	}

	private render(options: IOptions): void {
		this.domNode = document.createElement('div');
		this.domNode.style.width = this.width + 'px';
		this.domNode.classList.add('monaco-findInput');

		this.inputBox = new ContextScopedHistoryInputBox(this.domNode, this.contextViewProvider, {
			placeholder: this.placeholder || '',
			tooltip: this.tooltip || '',
			ariaLabel: this.ariaLabel || '',
			validationOptions: {
				validation: undefined
			},
			history: options.history || []
		}, this.contextKeyService);
		this._register(attachInputBoxStyler(this.inputBox, this.themeService));
		this._register(this.inputBox.onDidChange(() => this._onSubmit.fire(true)));

		this.inputFocusTracker = dom.trackFocus(this.inputBox.inputElement);
		this.onkeyup(this.inputBox.inputElement, (keyboardEvent) => this.onInputKeyUp(keyboardEvent));

		const controls = document.createElement('div');
		controls.className = 'controls';
		this.renderSubcontrols(controls);

		this.domNode.appendChild(controls);
		this.setInputWidth();
	}

	protected renderSubcontrols(_controlsDiv: HTMLDivElement): void {
	}

	private onInputKeyUp(keyboardEvent: IKeyboardEvent) {
		switch (keyboardEvent.keyCode) {
			case KeyCode.Enter:
				this.onSearchSubmit();
				this._onSubmit.fire(false);
				return;
			case KeyCode.Escape:
				this._onCancel.fire();
				return;
		}
	}
}

export class IncludePatternInputWidget extends PatternInputWidget {

	private _onChangeSearchInEditorsBoxEmitter = this._register(new Emitter<void>());
	onChangeSearchInEditorsBox = this._onChangeSearchInEditorsBoxEmitter.event;

	constructor(parent: HTMLElement, contextViewProvider: IContextViewProvider, options: IOptions = Object.create(null),
		@IThemeService themeService: IThemeService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(parent, contextViewProvider, options, themeService, contextKeyService, configurationService);
	}

	private useSearchInEditorsBox!: Checkbox;

	override dispose(): void {
		super.dispose();
		this.useSearchInEditorsBox.dispose();
	}

	onlySearchInOpenEditors(): boolean {
		return this.useSearchInEditorsBox.checked;
	}

	setOnlySearchInOpenEditors(value: boolean) {
		this.useSearchInEditorsBox.checked = value;
	}

	protected override getSubcontrolsWidth(): number {
		return super.getSubcontrolsWidth() + this.useSearchInEditorsBox.width();
	}

	protected override renderSubcontrols(controlsDiv: HTMLDivElement): void {
		this.useSearchInEditorsBox = this._register(new Checkbox({
			icon: Codicon.book,
			title: nls.localize('onlySearchInOpenEditors', "Search only in Open Editors"),
			isChecked: false,
		}));
		this._register(this.useSearchInEditorsBox.onChange(viaKeyboard => {
			this._onChangeSearchInEditorsBoxEmitter.fire();
			if (!viaKeyboard) {
				this.inputBox.focus();
			}
		}));
		this._register(attachCheckboxStyler(this.useSearchInEditorsBox, this.themeService));
		controlsDiv.appendChild(this.useSearchInEditorsBox.domNode);
		super.renderSubcontrols(controlsDiv);
	}
}

export class ExcludePatternInputWidget extends PatternInputWidget {

	private _onChangeIgnoreBoxEmitter = this._register(new Emitter<void>());
	onChangeIgnoreBox = this._onChangeIgnoreBoxEmitter.event;

	constructor(parent: HTMLElement, contextViewProvider: IContextViewProvider, options: IOptions = Object.create(null),
		@IThemeService themeService: IThemeService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(parent, contextViewProvider, options, themeService, contextKeyService, configurationService);
	}

	private useExcludesAndIgnoreFilesBox!: Checkbox;

	override dispose(): void {
		super.dispose();
		this.useExcludesAndIgnoreFilesBox.dispose();
	}

	useExcludesAndIgnoreFiles(): boolean {
		return this.useExcludesAndIgnoreFilesBox.checked;
	}

	setUseExcludesAndIgnoreFiles(value: boolean) {
		this.useExcludesAndIgnoreFilesBox.checked = value;
		this._onChangeIgnoreBoxEmitter.fire();
	}

	protected override getSubcontrolsWidth(): number {
		return super.getSubcontrolsWidth() + this.useExcludesAndIgnoreFilesBox.width();
	}

	protected override renderSubcontrols(controlsDiv: HTMLDivElement): void {
		this.useExcludesAndIgnoreFilesBox = this._register(new Checkbox({
			icon: Codicon.exclude,
			actionClassName: 'useExcludesAndIgnoreFiles',
			title: nls.localize('useExcludesAndIgnoreFilesDescription', "Use Exclude Settings and Ignore Files"),
			isChecked: true,
		}));
		this._register(this.useExcludesAndIgnoreFilesBox.onChange(viaKeyboard => {
			this._onChangeIgnoreBoxEmitter.fire();
			if (!viaKeyboard) {
				this.inputBox.focus();
			}
		}));
		this._register(attachCheckboxStyler(this.useExcludesAndIgnoreFilesBox, this.themeService));

		controlsDiv.appendChild(this.useExcludesAndIgnoreFilesBox.domNode);
		super.renderSubcontrols(controlsDiv);
	}
}
