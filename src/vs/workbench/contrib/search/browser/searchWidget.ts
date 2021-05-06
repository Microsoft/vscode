/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Button, IButtonOptions } from 'vs/base/browser/ui/button/button';
import { FindInput, IFindInputOptions } from 'vs/base/browser/ui/findinput/findInput';
import { ReplaceInput } from 'vs/base/browser/ui/findinput/replaceInput';
import { IMessage, InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { Widget } from 'vs/base/browser/ui/widget';
import { Action } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { CONTEXT_FIND_WIDGET_NOT_VISIBLE } from 'vs/editor/contrib/find/findModel';
import * as nls from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ISearchConfigurationProperties } from 'vs/workbench/services/search/common/search';
import { attachFindReplaceInputBoxStyler, attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ContextScopedFindInput, ContextScopedReplaceInput } from 'vs/platform/browser/contextScopedHistoryWidget';
import { appendKeyBindingLabel, isSearchViewFocused, getSearchView } from 'vs/workbench/contrib/search/browser/searchActions';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { isMacintosh } from 'vs/base/common/platform';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { IViewsService } from 'vs/workbench/common/views';
import { searchReplaceAllIcon, searchHideReplaceIcon, searchShowContextIcon, searchShowReplaceIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import { ToggleSearchEditorContextLinesCommandId } from 'vs/workbench/contrib/searchEditor/browser/constants';

/** Specified in searchview.css */
export const SingleLineInputHeight = 24;

export interface ISearchWidgetOptions {
	value?: string;
	replaceValue?: string;
	isRegex?: boolean;
	isCaseSensitive?: boolean;
	isWholeWords?: boolean;
	searchHistory?: string[];
	replaceHistory?: string[];
	preserveCase?: boolean;
	_hideReplaceToggle?: boolean; // TODO: Search Editor's replace experience
	showContextToggle?: boolean;
}

class ReplaceAllAction extends Action {

	static readonly ID: string = 'search.action.replaceAll';

	constructor(private _searchWidget: SearchWidget) {
		super(ReplaceAllAction.ID, '', ThemeIcon.asClassName(searchReplaceAllIcon), false);
	}

	set searchWidget(searchWidget: SearchWidget) {
		this._searchWidget = searchWidget;
	}

	override run(): Promise<any> {
		if (this._searchWidget) {
			return this._searchWidget.triggerReplaceAll();
		}
		return Promise.resolve(null);
	}
}

const ctrlKeyMod = (isMacintosh ? KeyMod.WinCtrl : KeyMod.CtrlCmd);

function stopPropagationForMultiLineUpwards(event: IKeyboardEvent, value: string, textarea: HTMLTextAreaElement | null) {
	const isMultiline = !!value.match(/\n/);
	if (textarea && (isMultiline || textarea.clientHeight > SingleLineInputHeight) && textarea.selectionStart > 0) {
		event.stopPropagation();
		return;
	}
}

function stopPropagationForMultiLineDownwards(event: IKeyboardEvent, value: string, textarea: HTMLTextAreaElement | null) {
	const isMultiline = !!value.match(/\n/);
	if (textarea && (isMultiline || textarea.clientHeight > SingleLineInputHeight) && textarea.selectionEnd < textarea.value.length) {
		event.stopPropagation();
		return;
	}
}

export class SearchWidget extends Widget {
	private static readonly INPUT_MAX_HEIGHT = 134;

	private static readonly REPLACE_ALL_DISABLED_LABEL = nls.localize('search.action.replaceAll.disabled.label', "Replace All (Submit Search to Enable)");
	private static readonly REPLACE_ALL_ENABLED_LABEL = (keyBindingService2: IKeybindingService): string => {
		const kb = keyBindingService2.lookupKeybinding(ReplaceAllAction.ID);
		return appendKeyBindingLabel(nls.localize('search.action.replaceAll.enabled.label', "Replace All"), kb, keyBindingService2);
	};

	domNode!: HTMLElement;

	searchInput!: FindInput;
	searchInputFocusTracker!: dom.IFocusTracker;
	private searchInputBoxFocused: IContextKey<boolean>;

	private replaceContainer!: HTMLElement;
	replaceInput!: ReplaceInput;
	replaceInputFocusTracker!: dom.IFocusTracker;
	private replaceInputBoxFocused: IContextKey<boolean>;
	private toggleReplaceButton!: Button;
	private replaceAllAction!: ReplaceAllAction;
	private replaceActive: IContextKey<boolean>;
	private replaceActionBar!: ActionBar;
	private _replaceHistoryDelayer: Delayer<void>;
	private ignoreGlobalFindBufferOnNextFocus = false;
	private previousGlobalFindBufferValue: string | null = null;

	private _onSearchSubmit = this._register(new Emitter<{ triggeredOnType: boolean, delay: number }>());
	readonly onSearchSubmit: Event<{ triggeredOnType: boolean, delay: number }> = this._onSearchSubmit.event;

	private _onSearchCancel = this._register(new Emitter<{ focus: boolean }>());
	readonly onSearchCancel: Event<{ focus: boolean }> = this._onSearchCancel.event;

	private _onReplaceToggled = this._register(new Emitter<void>());
	readonly onReplaceToggled: Event<void> = this._onReplaceToggled.event;

	private _onReplaceStateChange = this._register(new Emitter<boolean>());
	readonly onReplaceStateChange: Event<boolean> = this._onReplaceStateChange.event;

	private _onPreserveCaseChange = this._register(new Emitter<boolean>());
	readonly onPreserveCaseChange: Event<boolean> = this._onPreserveCaseChange.event;

	private _onReplaceValueChanged = this._register(new Emitter<void>());
	readonly onReplaceValueChanged: Event<void> = this._onReplaceValueChanged.event;

	private _onReplaceAll = this._register(new Emitter<void>());
	readonly onReplaceAll: Event<void> = this._onReplaceAll.event;

	private _onBlur = this._register(new Emitter<void>());
	readonly onBlur: Event<void> = this._onBlur.event;

	private _onDidHeightChange = this._register(new Emitter<void>());
	readonly onDidHeightChange: Event<void> = this._onDidHeightChange.event;

	private readonly _onDidToggleContext = new Emitter<void>();
	readonly onDidToggleContext: Event<void> = this._onDidToggleContext.event;

	private showContextCheckbox!: Checkbox;
	public contextLinesInput!: InputBox;

	constructor(
		container: HTMLElement,
		options: ISearchWidgetOptions,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IKeybindingService private readonly keyBindingService: IKeybindingService,
		@IClipboardService private readonly clipboardServce: IClipboardService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService
	) {
		super();
		this.replaceActive = Constants.ReplaceActiveKey.bindTo(this.contextKeyService);
		this.searchInputBoxFocused = Constants.SearchInputBoxFocusedKey.bindTo(this.contextKeyService);
		this.replaceInputBoxFocused = Constants.ReplaceInputBoxFocusedKey.bindTo(this.contextKeyService);

		this._replaceHistoryDelayer = new Delayer<void>(500);

		this.render(container, options);

		this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.accessibilitySupport')) {
				this.updateAccessibilitySupport();
			}
		});
		this.accessibilityService.onDidChangeScreenReaderOptimized(() => this.updateAccessibilitySupport());
		this.updateAccessibilitySupport();
	}

	focus(select: boolean = true, focusReplace: boolean = false, suppressGlobalSearchBuffer = false): void {
		this.ignoreGlobalFindBufferOnNextFocus = suppressGlobalSearchBuffer;

		if (focusReplace && this.isReplaceShown()) {
			this.replaceInput.focus();
			if (select) {
				this.replaceInput.select();
			}
		} else {
			this.searchInput.focus();
			if (select) {
				this.searchInput.select();
			}
		}
	}

	setWidth(width: number) {
		this.searchInput.inputBox.layout();
		this.replaceInput.width = width - 28;
		this.replaceInput.inputBox.layout();
	}

	clear() {
		this.searchInput.clear();
		this.replaceInput.setValue('');
		this.setReplaceAllActionState(false);
	}

	isReplaceShown(): boolean {
		return !this.replaceContainer.classList.contains('disabled');
	}

	isReplaceActive(): boolean {
		return !!this.replaceActive.get();
	}

	getReplaceValue(): string {
		return this.replaceInput.getValue();
	}

	toggleReplace(show?: boolean): void {
		if (show === undefined || show !== this.isReplaceShown()) {
			this.onToggleReplaceButton();
		}
	}

	getSearchHistory(): string[] {
		return this.searchInput.inputBox.getHistory();
	}

	getReplaceHistory(): string[] {
		return this.replaceInput.inputBox.getHistory();
	}

	clearHistory(): void {
		this.searchInput.inputBox.clearHistory();
	}

	showNextSearchTerm() {
		this.searchInput.inputBox.showNextValue();
	}

	showPreviousSearchTerm() {
		this.searchInput.inputBox.showPreviousValue();
	}

	showNextReplaceTerm() {
		this.replaceInput.inputBox.showNextValue();
	}

	showPreviousReplaceTerm() {
		this.replaceInput.inputBox.showPreviousValue();
	}

	searchInputHasFocus(): boolean {
		return !!this.searchInputBoxFocused.get();
	}

	replaceInputHasFocus(): boolean {
		return this.replaceInput.inputBox.hasFocus();
	}

	focusReplaceAllAction(): void {
		this.replaceActionBar.focus(true);
	}

	focusRegexAction(): void {
		this.searchInput.focusOnRegex();
	}

	private render(container: HTMLElement, options: ISearchWidgetOptions): void {
		this.domNode = dom.append(container, dom.$('.search-widget'));
		this.domNode.style.position = 'relative';

		if (!options._hideReplaceToggle) {
			this.renderToggleReplaceButton(this.domNode);
		}

		this.renderSearchInput(this.domNode, options);
		this.renderReplaceInput(this.domNode, options);
	}

	private updateAccessibilitySupport(): void {
		this.searchInput.setFocusInputOnOptionClick(!this.accessibilityService.isScreenReaderOptimized());
	}

	private renderToggleReplaceButton(parent: HTMLElement): void {
		const opts: IButtonOptions = {
			buttonBackground: undefined,
			buttonBorder: undefined,
			buttonForeground: undefined,
			buttonHoverBackground: undefined
		};
		this.toggleReplaceButton = this._register(new Button(parent, opts));
		this.toggleReplaceButton.element.setAttribute('aria-expanded', 'false');
		this.toggleReplaceButton.element.classList.add('toggle-replace-button');
		this.toggleReplaceButton.icon = searchHideReplaceIcon;
		// TODO@joao need to dispose this listener eventually
		this.toggleReplaceButton.onDidClick(() => this.onToggleReplaceButton());
		this.toggleReplaceButton.element.title = nls.localize('search.replace.toggle.button.title', "Toggle Replace");
	}

	private renderSearchInput(parent: HTMLElement, options: ISearchWidgetOptions): void {
		const inputOptions: IFindInputOptions = {
			label: nls.localize('label.Search', 'Search: Type Search Term and press Enter to search'),
			validation: (value: string) => this.validateSearchInput(value),
			placeholder: nls.localize('search.placeHolder', "Search"),
			appendCaseSensitiveLabel: appendKeyBindingLabel('', this.keyBindingService.lookupKeybinding(Constants.ToggleCaseSensitiveCommandId), this.keyBindingService),
			appendWholeWordsLabel: appendKeyBindingLabel('', this.keyBindingService.lookupKeybinding(Constants.ToggleWholeWordCommandId), this.keyBindingService),
			appendRegexLabel: appendKeyBindingLabel('', this.keyBindingService.lookupKeybinding(Constants.ToggleRegexCommandId), this.keyBindingService),
			history: options.searchHistory,
			flexibleHeight: true,
			flexibleMaxHeight: SearchWidget.INPUT_MAX_HEIGHT
		};

		const searchInputContainer = dom.append(parent, dom.$('.search-container.input-box'));
		this.searchInput = this._register(new ContextScopedFindInput(searchInputContainer, this.contextViewService, inputOptions, this.contextKeyService, true));
		this._register(attachFindReplaceInputBoxStyler(this.searchInput, this.themeService));
		this.searchInput.onKeyDown((keyboardEvent: IKeyboardEvent) => this.onSearchInputKeyDown(keyboardEvent));
		this.searchInput.setValue(options.value || '');
		this.searchInput.setRegex(!!options.isRegex);
		this.searchInput.setCaseSensitive(!!options.isCaseSensitive);
		this.searchInput.setWholeWords(!!options.isWholeWords);
		this._register(this.searchInput.onCaseSensitiveKeyDown((keyboardEvent: IKeyboardEvent) => this.onCaseSensitiveKeyDown(keyboardEvent)));
		this._register(this.searchInput.onRegexKeyDown((keyboardEvent: IKeyboardEvent) => this.onRegexKeyDown(keyboardEvent)));
		this._register(this.searchInput.inputBox.onDidChange(() => this.onSearchInputChanged()));
		this._register(this.searchInput.inputBox.onDidHeightChange(() => this._onDidHeightChange.fire()));

		this._register(this.onReplaceValueChanged(() => {
			this._replaceHistoryDelayer.trigger(() => this.replaceInput.inputBox.addToHistory());
		}));

		this.searchInputFocusTracker = this._register(dom.trackFocus(this.searchInput.inputBox.inputElement));
		this._register(this.searchInputFocusTracker.onDidFocus(async () => {
			this.searchInputBoxFocused.set(true);

			const useGlobalFindBuffer = this.searchConfiguration.globalFindClipboard;
			if (!this.ignoreGlobalFindBufferOnNextFocus && useGlobalFindBuffer) {
				const globalBufferText = await this.clipboardServce.readFindText();
				if (globalBufferText && this.previousGlobalFindBufferValue !== globalBufferText) {
					this.searchInput.inputBox.addToHistory();
					this.searchInput.setValue(globalBufferText);
					this.searchInput.select();
				}

				this.previousGlobalFindBufferValue = globalBufferText;
			}

			this.ignoreGlobalFindBufferOnNextFocus = false;
		}));
		this._register(this.searchInputFocusTracker.onDidBlur(() => this.searchInputBoxFocused.set(false)));


		this.showContextCheckbox = new Checkbox({
			isChecked: false,
			title: appendKeyBindingLabel(nls.localize('showContext', "Toggle Context Lines"), this.keyBindingService.lookupKeybinding(ToggleSearchEditorContextLinesCommandId), this.keyBindingService),
			icon: searchShowContextIcon
		});
		this._register(this.showContextCheckbox.onChange(() => this.onContextLinesChanged()));

		if (options.showContextToggle) {
			this.contextLinesInput = new InputBox(searchInputContainer, this.contextViewService, { type: 'number' });
			this.contextLinesInput.element.classList.add('context-lines-input');
			this.contextLinesInput.value = '' + (this.configurationService.getValue<ISearchConfigurationProperties>('search').searchEditor.defaultNumberOfContextLines ?? 1);
			this._register(this.contextLinesInput.onDidChange(() => this.onContextLinesChanged()));
			this._register(attachInputBoxStyler(this.contextLinesInput, this.themeService));
			dom.append(searchInputContainer, this.showContextCheckbox.domNode);
		}
	}

	private onContextLinesChanged() {
		this.domNode.classList.toggle('show-context', this.showContextCheckbox.checked);
		this._onDidToggleContext.fire();

		if (this.contextLinesInput.value.includes('-')) {
			this.contextLinesInput.value = '0';
		}

		this._onDidToggleContext.fire();
	}

	public setContextLines(lines: number) {
		if (!this.contextLinesInput) { return; }
		if (lines === 0) {
			this.showContextCheckbox.checked = false;
		} else {
			this.showContextCheckbox.checked = true;
			this.contextLinesInput.value = '' + lines;
		}
		this.domNode.classList.toggle('show-context', this.showContextCheckbox.checked);
	}

	private renderReplaceInput(parent: HTMLElement, options: ISearchWidgetOptions): void {
		this.replaceContainer = dom.append(parent, dom.$('.replace-container.disabled'));
		const replaceBox = dom.append(this.replaceContainer, dom.$('.replace-input'));

		this.replaceInput = this._register(new ContextScopedReplaceInput(replaceBox, this.contextViewService, {
			label: nls.localize('label.Replace', 'Replace: Type replace term and press Enter to preview'),
			placeholder: nls.localize('search.replace.placeHolder', "Replace"),
			appendPreserveCaseLabel: appendKeyBindingLabel('', this.keyBindingService.lookupKeybinding(Constants.TogglePreserveCaseId), this.keyBindingService),
			history: options.replaceHistory,
			flexibleHeight: true,
			flexibleMaxHeight: SearchWidget.INPUT_MAX_HEIGHT
		}, this.contextKeyService, true));

		this._register(this.replaceInput.onDidOptionChange(viaKeyboard => {
			if (!viaKeyboard) {
				this._onPreserveCaseChange.fire(this.replaceInput.getPreserveCase());
			}
		}));

		this._register(attachFindReplaceInputBoxStyler(this.replaceInput, this.themeService));
		this.replaceInput.onKeyDown((keyboardEvent) => this.onReplaceInputKeyDown(keyboardEvent));
		this.replaceInput.setValue(options.replaceValue || '');
		this._register(this.replaceInput.inputBox.onDidChange(() => this._onReplaceValueChanged.fire()));
		this._register(this.replaceInput.inputBox.onDidHeightChange(() => this._onDidHeightChange.fire()));

		this.replaceAllAction = new ReplaceAllAction(this);
		this.replaceAllAction.label = SearchWidget.REPLACE_ALL_DISABLED_LABEL;
		this.replaceActionBar = this._register(new ActionBar(this.replaceContainer));
		this.replaceActionBar.push([this.replaceAllAction], { icon: true, label: false });
		this.onkeydown(this.replaceActionBar.domNode, (keyboardEvent) => this.onReplaceActionbarKeyDown(keyboardEvent));

		this.replaceInputFocusTracker = this._register(dom.trackFocus(this.replaceInput.inputBox.inputElement));
		this._register(this.replaceInputFocusTracker.onDidFocus(() => this.replaceInputBoxFocused.set(true)));
		this._register(this.replaceInputFocusTracker.onDidBlur(() => this.replaceInputBoxFocused.set(false)));
		this._register(this.replaceInput.onPreserveCaseKeyDown((keyboardEvent: IKeyboardEvent) => this.onPreserveCaseKeyDown(keyboardEvent)));
	}

	triggerReplaceAll(): Promise<any> {
		this._onReplaceAll.fire();
		return Promise.resolve(null);
	}

	private onToggleReplaceButton(): void {
		this.replaceContainer.classList.toggle('disabled');
		if (this.isReplaceShown()) {
			this.toggleReplaceButton.element.classList.remove(...ThemeIcon.asClassNameArray(searchHideReplaceIcon));
			this.toggleReplaceButton.element.classList.add(...ThemeIcon.asClassNameArray(searchShowReplaceIcon));
		} else {
			this.toggleReplaceButton.element.classList.remove(...ThemeIcon.asClassNameArray(searchShowReplaceIcon));
			this.toggleReplaceButton.element.classList.add(...ThemeIcon.asClassNameArray(searchHideReplaceIcon));
		}
		this.toggleReplaceButton.element.setAttribute('aria-expanded', this.isReplaceShown() ? 'true' : 'false');
		this.updateReplaceActiveState();
		this._onReplaceToggled.fire();
	}

	setValue(value: string) {
		this.searchInput.setValue(value);
	}

	setReplaceAllActionState(enabled: boolean): void {
		if (this.replaceAllAction.enabled !== enabled) {
			this.replaceAllAction.enabled = enabled;
			this.replaceAllAction.label = enabled ? SearchWidget.REPLACE_ALL_ENABLED_LABEL(this.keyBindingService) : SearchWidget.REPLACE_ALL_DISABLED_LABEL;
			this.updateReplaceActiveState();
		}
	}

	private updateReplaceActiveState(): void {
		const currentState = this.isReplaceActive();
		const newState = this.isReplaceShown() && this.replaceAllAction.enabled;
		if (currentState !== newState) {
			this.replaceActive.set(newState);
			this._onReplaceStateChange.fire(newState);
			this.replaceInput.inputBox.layout();
		}
	}

	private validateSearchInput(value: string): IMessage | null {
		if (value.length === 0) {
			return null;
		}
		if (!this.searchInput.getRegex()) {
			return null;
		}
		try {
			new RegExp(value, 'u');
		} catch (e) {
			return { content: e.message };
		}

		return null;
	}

	private onSearchInputChanged(): void {
		this.searchInput.clearMessage();
		this.setReplaceAllActionState(false);

		if (this.searchConfiguration.searchOnType) {
			if (this.searchInput.getRegex()) {
				try {
					const regex = new RegExp(this.searchInput.getValue(), 'ug');
					const matchienessHeuristic = `
								~!@#$%^&*()_+
								\`1234567890-=
								qwertyuiop[]\\
								QWERTYUIOP{}|
								asdfghjkl;'
								ASDFGHJKL:"
								zxcvbnm,./
								ZXCVBNM<>? `.match(regex)?.length ?? 0;

					const delayMultiplier =
						matchienessHeuristic < 50 ? 1 :
							matchienessHeuristic < 100 ? 5 : // expressions like `.` or `\w`
								10; // only things matching empty string

					this.submitSearch(true, this.searchConfiguration.searchOnTypeDebouncePeriod * delayMultiplier);
				} catch {
					// pass
				}
			} else {
				this.submitSearch(true, this.searchConfiguration.searchOnTypeDebouncePeriod);
			}
		}
	}

	private onSearchInputKeyDown(keyboardEvent: IKeyboardEvent) {
		if (keyboardEvent.equals(ctrlKeyMod | KeyCode.Enter)) {
			this.searchInput.inputBox.insertAtCursor('\n');
			keyboardEvent.preventDefault();
		}

		if (keyboardEvent.equals(KeyCode.Enter)) {
			this.searchInput.onSearchSubmit();
			this.submitSearch();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KeyCode.Escape)) {
			this._onSearchCancel.fire({ focus: true });
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KeyCode.Tab)) {
			if (this.isReplaceShown()) {
				this.replaceInput.focus();
			} else {
				this.searchInput.focusOnCaseSensitive();
			}
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KeyCode.UpArrow)) {
			stopPropagationForMultiLineUpwards(keyboardEvent, this.searchInput.getValue(), this.searchInput.domNode.querySelector('textarea'));
		}

		else if (keyboardEvent.equals(KeyCode.DownArrow)) {
			stopPropagationForMultiLineDownwards(keyboardEvent, this.searchInput.getValue(), this.searchInput.domNode.querySelector('textarea'));
		}
	}

	private onCaseSensitiveKeyDown(keyboardEvent: IKeyboardEvent) {
		if (keyboardEvent.equals(KeyMod.Shift | KeyCode.Tab)) {
			if (this.isReplaceShown()) {
				this.replaceInput.focus();
				keyboardEvent.preventDefault();
			}
		}
	}

	private onRegexKeyDown(keyboardEvent: IKeyboardEvent) {
		if (keyboardEvent.equals(KeyCode.Tab)) {
			if (this.isReplaceShown()) {
				this.replaceInput.focusOnPreserve();
				keyboardEvent.preventDefault();
			}
		}
	}

	private onPreserveCaseKeyDown(keyboardEvent: IKeyboardEvent) {
		if (keyboardEvent.equals(KeyCode.Tab)) {
			if (this.isReplaceActive()) {
				this.focusReplaceAllAction();
			} else {
				this._onBlur.fire();
			}
			keyboardEvent.preventDefault();
		}
		else if (keyboardEvent.equals(KeyMod.Shift | KeyCode.Tab)) {
			this.focusRegexAction();
			keyboardEvent.preventDefault();
		}
	}

	private onReplaceInputKeyDown(keyboardEvent: IKeyboardEvent) {
		if (keyboardEvent.equals(ctrlKeyMod | KeyCode.Enter)) {
			this.replaceInput.inputBox.insertAtCursor('\n');
			keyboardEvent.preventDefault();
		}

		if (keyboardEvent.equals(KeyCode.Enter)) {
			this.submitSearch();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KeyCode.Tab)) {
			this.searchInput.focusOnCaseSensitive();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KeyMod.Shift | KeyCode.Tab)) {
			this.searchInput.focus();
			keyboardEvent.preventDefault();
		}

		else if (keyboardEvent.equals(KeyCode.UpArrow)) {
			stopPropagationForMultiLineUpwards(keyboardEvent, this.replaceInput.getValue(), this.replaceInput.domNode.querySelector('textarea'));
		}

		else if (keyboardEvent.equals(KeyCode.DownArrow)) {
			stopPropagationForMultiLineDownwards(keyboardEvent, this.replaceInput.getValue(), this.replaceInput.domNode.querySelector('textarea'));
		}
	}

	private onReplaceActionbarKeyDown(keyboardEvent: IKeyboardEvent) {
		if (keyboardEvent.equals(KeyMod.Shift | KeyCode.Tab)) {
			this.focusRegexAction();
			keyboardEvent.preventDefault();
		}
	}

	private async submitSearch(triggeredOnType = false, delay: number = 0): Promise<void> {
		this.searchInput.validate();
		if (!this.searchInput.inputBox.isInputValid()) {
			return;
		}

		const value = this.searchInput.getValue();
		const useGlobalFindBuffer = this.searchConfiguration.globalFindClipboard;
		if (value && useGlobalFindBuffer) {
			await this.clipboardServce.writeFindText(value);
		}
		this._onSearchSubmit.fire({ triggeredOnType, delay });
	}

	getContextLines() {
		return this.showContextCheckbox.checked ? +this.contextLinesInput.value : 0;
	}

	modifyContextLines(increase: boolean) {
		const current = +this.contextLinesInput.value;
		const modified = current + (increase ? 1 : -1);
		this.showContextCheckbox.checked = modified !== 0;
		this.contextLinesInput.value = '' + modified;
	}

	toggleContextLines() {
		this.showContextCheckbox.checked = !this.showContextCheckbox.checked;
		this.onContextLinesChanged();
	}

	override dispose(): void {
		this.setReplaceAllActionState(false);
		super.dispose();
	}

	private get searchConfiguration(): ISearchConfigurationProperties {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}
}

export function registerContributions() {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: ReplaceAllAction.ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.ReplaceActiveKey, CONTEXT_FIND_WIDGET_NOT_VISIBLE),
		primary: KeyMod.Alt | KeyMod.CtrlCmd | KeyCode.Enter,
		handler: accessor => {
			const viewsService = accessor.get(IViewsService);
			if (isSearchViewFocused(viewsService)) {
				const searchView = getSearchView(viewsService);
				if (searchView) {
					new ReplaceAllAction(searchView.searchAndReplaceWidget).run();
				}
			}
		}
	});
}
