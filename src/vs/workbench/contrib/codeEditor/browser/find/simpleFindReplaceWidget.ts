/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { FindInput, IFindInputStyles } from 'vs/base/browser/ui/findinput/findInput';
import { IReplaceInputStyles, ReplaceInput } from 'vs/base/browser/ui/findinput/replaceInput';
import { IMessage as InputBoxMessage } from 'vs/base/browser/ui/inputbox/inputBox';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { Widget } from 'vs/base/browser/ui/widget';
import { Delayer } from 'vs/base/common/async';
import { KeyCode } from 'vs/base/common/keyCodes';
import 'vs/css!./simpleFindReplaceWidget';
import { FindReplaceState, FindReplaceStateChangedEvent } from 'vs/editor/contrib/find/findState';
import { findNextMatchIcon, findPreviousMatchIcon, findReplaceAllIcon, findReplaceIcon, SimpleButton } from 'vs/editor/contrib/find/findWidget';
import * as nls from 'vs/nls';
import { ContextScopedFindInput, ContextScopedReplaceInput } from 'vs/platform/browser/contextScopedHistoryWidget';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { editorWidgetBackground, editorWidgetForeground, inputActiveOptionBackground, inputActiveOptionBorder, inputActiveOptionForeground, inputBackground, inputBorder, inputForeground, inputValidationErrorBackground, inputValidationErrorBorder, inputValidationErrorForeground, inputValidationInfoBackground, inputValidationInfoBorder, inputValidationInfoForeground, inputValidationWarningBackground, inputValidationWarningBorder, inputValidationWarningForeground, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { widgetClose } from 'vs/platform/theme/common/iconRegistry';
import { attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { IColorTheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';

const NLS_FIND_INPUT_LABEL = nls.localize('label.find', "Find");
const NLS_FIND_INPUT_PLACEHOLDER = nls.localize('placeholder.find', "Find");
const NLS_PREVIOUS_MATCH_BTN_LABEL = nls.localize('label.previousMatchButton', "Previous match");
const NLS_NEXT_MATCH_BTN_LABEL = nls.localize('label.nextMatchButton', "Next match");
const NLS_CLOSE_BTN_LABEL = nls.localize('label.closeButton', "Close");
const NLS_TOGGLE_REPLACE_MODE_BTN_LABEL = nls.localize('label.toggleReplaceButton', "Toggle Replace mode");
const NLS_REPLACE_INPUT_LABEL = nls.localize('label.replace', "Replace");
const NLS_REPLACE_INPUT_PLACEHOLDER = nls.localize('placeholder.replace', "Replace");
const NLS_REPLACE_BTN_LABEL = nls.localize('label.replaceButton', "Replace");
const NLS_REPLACE_ALL_BTN_LABEL = nls.localize('label.replaceAllButton', "Replace All");


export abstract class SimpleFindReplaceWidget extends Widget {
	protected readonly _findInput: FindInput;
	private readonly _domNode: HTMLElement;
	private readonly _innerFindDomNode: HTMLElement;
	private readonly _focusTracker: dom.IFocusTracker;
	private readonly _findInputFocusTracker: dom.IFocusTracker;
	private readonly _updateHistoryDelayer: Delayer<void>;
	protected readonly _matchesCount!: HTMLElement;
	private readonly prevBtn: SimpleButton;
	private readonly nextBtn: SimpleButton;

	protected readonly _replaceInput!: ReplaceInput;
	private readonly _innerReplaceDomNode!: HTMLElement;
	private _toggleReplaceBtn!: SimpleButton;
	private readonly _replaceInputFocusTracker!: dom.IFocusTracker;
	private _replaceBtn!: SimpleButton;
	private _replaceAllBtn!: SimpleButton;


	private _isVisible: boolean = false;
	private _isReplaceVisible: boolean = false;
	private foundMatch: boolean = false;

	protected _progressBar!: ProgressBar;


	constructor(
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService private readonly _themeService: IThemeService,
		protected readonly _state: FindReplaceState = new FindReplaceState(),
		showOptionButtons?: boolean
	) {
		super();

		this._domNode = document.createElement('div');
		this._domNode.classList.add('simple-fr-find-part-wrapper');
		this._register(this._state.onFindReplaceStateChange((e) => this._onStateChanged(e)));

		let progressContainer = dom.$('.find-replace-progress');
		this._progressBar = new ProgressBar(progressContainer);
		this._register(attachProgressBarStyler(this._progressBar, this._themeService));
		this._domNode.appendChild(progressContainer);

		// Toggle replace button
		this._toggleReplaceBtn = this._register(new SimpleButton({
			label: NLS_TOGGLE_REPLACE_MODE_BTN_LABEL,
			className: 'codicon toggle left',
			onTrigger: () => {
				this._isReplaceVisible = !this._isReplaceVisible;
				this._state.change({ isReplaceRevealed: this._isReplaceVisible }, false);
				if (this._isReplaceVisible) {
					this._innerReplaceDomNode.style.display = 'flex';
				} else {
					this._innerReplaceDomNode.style.display = 'none';
				}
			}
		}));
		this._toggleReplaceBtn.setExpanded(this._isReplaceVisible);
		this._domNode.appendChild(this._toggleReplaceBtn.domNode);


		this._innerFindDomNode = document.createElement('div');
		this._innerFindDomNode.classList.add('simple-fr-find-part');

		this._findInput = this._register(new ContextScopedFindInput(null, this._contextViewService, {
			label: NLS_FIND_INPUT_LABEL,
			placeholder: NLS_FIND_INPUT_PLACEHOLDER,
			validation: (value: string): InputBoxMessage | null => {
				if (value.length === 0 || !this._findInput.getRegex()) {
					return null;
				}
				try {
					new RegExp(value);
					return null;
				} catch (e) {
					this.foundMatch = false;
					this.updateButtons(this.foundMatch);
					return { content: e.message };
				}
			}
		}, contextKeyService, showOptionButtons));

		// Find History with update delayer
		this._updateHistoryDelayer = new Delayer<void>(500);

		this.oninput(this._findInput.domNode, (e) => {
			this.foundMatch = this.onInputChanged();
			this.updateButtons(this.foundMatch);
			this._delayedUpdateHistory();
		});

		this._findInput.setRegex(!!this._state.isRegex);
		this._findInput.setCaseSensitive(!!this._state.matchCase);
		this._findInput.setWholeWords(!!this._state.wholeWord);

		this._register(this._findInput.onDidOptionChange(() => {
			this._state.change({
				isRegex: this._findInput.getRegex(),
				wholeWord: this._findInput.getWholeWords(),
				matchCase: this._findInput.getCaseSensitive()
			}, true);
		}));

		this._register(this._state.onFindReplaceStateChange(() => {
			this._findInput.setRegex(this._state.isRegex);
			this._findInput.setWholeWords(this._state.wholeWord);
			this._findInput.setCaseSensitive(this._state.matchCase);
			this._replaceInput.setPreserveCase(this._state.preserveCase);
			this.findFirst();
		}));

		this._matchesCount = document.createElement('div');
		this._matchesCount.className = 'matchesCount';
		this._updateMatchesCount();

		this.prevBtn = this._register(new SimpleButton({
			label: NLS_PREVIOUS_MATCH_BTN_LABEL,
			icon: findPreviousMatchIcon,
			onTrigger: () => {
				this.find(true);
			}
		}));

		this.nextBtn = this._register(new SimpleButton({
			label: NLS_NEXT_MATCH_BTN_LABEL,
			icon: findNextMatchIcon,
			onTrigger: () => {
				this.find(false);
			}
		}));

		const closeBtn = this._register(new SimpleButton({
			label: NLS_CLOSE_BTN_LABEL,
			icon: widgetClose,
			onTrigger: () => {
				this.hide();
			}
		}));

		this._innerFindDomNode.appendChild(this._findInput.domNode);
		this._innerFindDomNode.appendChild(this._matchesCount);
		this._innerFindDomNode.appendChild(this.prevBtn.domNode);
		this._innerFindDomNode.appendChild(this.nextBtn.domNode);
		this._innerFindDomNode.appendChild(closeBtn.domNode);

		// _domNode wraps _innerDomNode, ensuring that
		this._domNode.appendChild(this._innerFindDomNode);

		this.onkeyup(this._innerFindDomNode, e => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
				e.preventDefault();
				return;
			}
		});

		this._focusTracker = this._register(dom.trackFocus(this._innerFindDomNode));
		this._register(this._focusTracker.onDidFocus(this.onFocusTrackerFocus.bind(this)));
		this._register(this._focusTracker.onDidBlur(this.onFocusTrackerBlur.bind(this)));

		this._findInputFocusTracker = this._register(dom.trackFocus(this._findInput.domNode));
		this._register(this._findInputFocusTracker.onDidFocus(this.onFindInputFocusTrackerFocus.bind(this)));
		this._register(this._findInputFocusTracker.onDidBlur(this.onFindInputFocusTrackerBlur.bind(this)));

		this._register(dom.addDisposableListener(this._innerFindDomNode, 'click', (event) => {
			event.stopPropagation();
		}));

		// Replace
		this._innerReplaceDomNode = document.createElement('div');
		this._innerReplaceDomNode.classList.add('simple-fr-replace-part');

		this._replaceInput = this._register(new ContextScopedReplaceInput(null, undefined, {
			label: NLS_REPLACE_INPUT_LABEL,
			placeholder: NLS_REPLACE_INPUT_PLACEHOLDER,
			history: []
		}, contextKeyService, false));
		this._innerReplaceDomNode.appendChild(this._replaceInput.domNode);
		this._replaceInputFocusTracker = this._register(dom.trackFocus(this._replaceInput.domNode));
		this._register(this._replaceInputFocusTracker.onDidFocus(this.onReplaceInputFocusTrackerFocus.bind(this)));
		this._register(this._replaceInputFocusTracker.onDidBlur(this.onReplaceInputFocusTrackerBlur.bind(this)));

		this._domNode.appendChild(this._innerReplaceDomNode);

		if (this._isReplaceVisible) {
			this._innerReplaceDomNode.style.display = 'flex';
		} else {
			this._innerReplaceDomNode.style.display = 'none';
		}

		this._replaceBtn = this._register(new SimpleButton({
			label: NLS_REPLACE_BTN_LABEL,
			icon: findReplaceIcon,
			onTrigger: () => {
				this.replaceOne();
			}
		}));

		// Replace all button
		this._replaceAllBtn = this._register(new SimpleButton({
			label: NLS_REPLACE_ALL_BTN_LABEL,
			icon: findReplaceAllIcon,
			onTrigger: () => {
				this.replaceAll();
			}
		}));

		this._innerReplaceDomNode.appendChild(this._replaceBtn.domNode);
		this._innerReplaceDomNode.appendChild(this._replaceAllBtn.domNode);


	}

	protected abstract onInputChanged(): boolean;
	protected abstract find(previous: boolean): void;
	protected abstract findFirst(): void;
	protected abstract replaceOne(): void;
	protected abstract replaceAll(): void;
	protected abstract onFocusTrackerFocus(): void;
	protected abstract onFocusTrackerBlur(): void;
	protected abstract onFindInputFocusTrackerFocus(): void;
	protected abstract onFindInputFocusTrackerBlur(): void;
	protected abstract onReplaceInputFocusTrackerFocus(): void;
	protected abstract onReplaceInputFocusTrackerBlur(): void;

	protected get inputValue() {
		return this._findInput.getValue();
	}

	protected get replaceValue() {
		return this._replaceInput.getValue();
	}

	public get focusTracker(): dom.IFocusTracker {
		return this._focusTracker;
	}

	public updateTheme(theme: IColorTheme): void {
		const inputStyles: IFindInputStyles = {
			inputActiveOptionBorder: theme.getColor(inputActiveOptionBorder),
			inputActiveOptionForeground: theme.getColor(inputActiveOptionForeground),
			inputActiveOptionBackground: theme.getColor(inputActiveOptionBackground),
			inputBackground: theme.getColor(inputBackground),
			inputForeground: theme.getColor(inputForeground),
			inputBorder: theme.getColor(inputBorder),
			inputValidationInfoBackground: theme.getColor(inputValidationInfoBackground),
			inputValidationInfoForeground: theme.getColor(inputValidationInfoForeground),
			inputValidationInfoBorder: theme.getColor(inputValidationInfoBorder),
			inputValidationWarningBackground: theme.getColor(inputValidationWarningBackground),
			inputValidationWarningForeground: theme.getColor(inputValidationWarningForeground),
			inputValidationWarningBorder: theme.getColor(inputValidationWarningBorder),
			inputValidationErrorBackground: theme.getColor(inputValidationErrorBackground),
			inputValidationErrorForeground: theme.getColor(inputValidationErrorForeground),
			inputValidationErrorBorder: theme.getColor(inputValidationErrorBorder),
		};
		this._findInput.style(inputStyles);
		const replaceStyles: IReplaceInputStyles = {
			inputActiveOptionBorder: theme.getColor(inputActiveOptionBorder),
			inputActiveOptionForeground: theme.getColor(inputActiveOptionForeground),
			inputActiveOptionBackground: theme.getColor(inputActiveOptionBackground),
			inputBackground: theme.getColor(inputBackground),
			inputForeground: theme.getColor(inputForeground),
			inputBorder: theme.getColor(inputBorder),
			inputValidationInfoBackground: theme.getColor(inputValidationInfoBackground),
			inputValidationInfoForeground: theme.getColor(inputValidationInfoForeground),
			inputValidationInfoBorder: theme.getColor(inputValidationInfoBorder),
			inputValidationWarningBackground: theme.getColor(inputValidationWarningBackground),
			inputValidationWarningForeground: theme.getColor(inputValidationWarningForeground),
			inputValidationWarningBorder: theme.getColor(inputValidationWarningBorder),
			inputValidationErrorBackground: theme.getColor(inputValidationErrorBackground),
			inputValidationErrorForeground: theme.getColor(inputValidationErrorForeground),
			inputValidationErrorBorder: theme.getColor(inputValidationErrorBorder),
		};
		this._replaceInput.style(replaceStyles);
	}

	private _onStateChanged(e: FindReplaceStateChangedEvent): void {
		this._updateButtons();
		this._updateMatchesCount();
	}

	private _updateButtons(): void {
		this._findInput.setEnabled(this._isVisible);
		this._replaceInput.setEnabled(this._isVisible && this._isReplaceVisible);
		let findInputIsNonEmpty = (this._state.searchString.length > 0);
		this._replaceBtn.setEnabled(this._isVisible && this._isReplaceVisible && findInputIsNonEmpty);
		this._replaceAllBtn.setEnabled(this._isVisible && this._isReplaceVisible && findInputIsNonEmpty);

		this._domNode.classList.toggle('replaceToggled', this._isReplaceVisible);
		this._toggleReplaceBtn.setExpanded(this._isReplaceVisible);
	}

	protected _updateMatchesCount(): void {
	}

	override dispose() {
		super.dispose();

		if (this._domNode && this._domNode.parentElement) {
			this._domNode.parentElement.removeChild(this._domNode);
		}
	}

	public getDomNode() {
		return this._domNode;
	}

	public reveal(initialInput?: string): void {
		if (initialInput) {
			this._findInput.setValue(initialInput);
		}

		if (this._isVisible) {
			this._findInput.select();
			return;
		}

		this._isVisible = true;
		this.updateButtons(this.foundMatch);

		setTimeout(() => {
			this._domNode.classList.add('visible', 'visible-transition');
			this._domNode.setAttribute('aria-hidden', 'false');
			this._findInput.select();
		}, 0);
	}

	public focus(): void {
		this._findInput.focus();
	}

	public show(initialInput?: string): void {
		if (initialInput && !this._isVisible) {
			this._findInput.setValue(initialInput);
		}

		this._isVisible = true;

		setTimeout(() => {
			this._domNode.classList.add('visible', 'visible-transition');
			this._domNode.setAttribute('aria-hidden', 'false');

			this.focus();
		}, 0);
	}

	public showWithReplace(initialInput?: string, replaceInput?: string): void {
		if (initialInput && !this._isVisible) {
			this._findInput.setValue(initialInput);
		}

		if (replaceInput && !this._isVisible) {
			this._replaceInput.setValue(replaceInput);
		}

		this._isVisible = true;
		this._isReplaceVisible = true;
		this._state.change({ isReplaceRevealed: this._isReplaceVisible }, false);
		if (this._isReplaceVisible) {
			this._innerReplaceDomNode.style.display = 'flex';
		} else {
			this._innerReplaceDomNode.style.display = 'none';
		}

		setTimeout(() => {
			this._domNode.classList.add('visible', 'visible-transition');
			this._domNode.setAttribute('aria-hidden', 'false');
			this._updateButtons();

			this._replaceInput.focus();
		}, 0);
	}

	public hide(): void {
		if (this._isVisible) {
			this._domNode.classList.remove('visible-transition');
			this._domNode.setAttribute('aria-hidden', 'true');
			// Need to delay toggling visibility until after Transition, then visibility hidden - removes from tabIndex list
			setTimeout(() => {
				this._isVisible = false;
				this.updateButtons(this.foundMatch);
				this._domNode.classList.remove('visible');
			}, 200);
		}
	}

	protected _delayedUpdateHistory() {
		this._updateHistoryDelayer.trigger(this._updateHistory.bind(this));
	}

	protected _updateHistory() {
		this._findInput.inputBox.addToHistory();
	}

	protected _getRegexValue(): boolean {
		return this._findInput.getRegex();
	}

	protected _getWholeWordValue(): boolean {
		return this._findInput.getWholeWords();
	}

	protected _getCaseSensitiveValue(): boolean {
		return this._findInput.getCaseSensitive();
	}

	protected updateButtons(foundMatch: boolean) {
		const hasInput = this.inputValue.length > 0;
		this.prevBtn.setEnabled(this._isVisible && hasInput && foundMatch);
		this.nextBtn.setEnabled(this._isVisible && hasInput && foundMatch);
	}
}

// theming
registerThemingParticipant((theme, collector) => {
	const findWidgetBGColor = theme.getColor(editorWidgetBackground);
	if (findWidgetBGColor) {
		collector.addRule(`.monaco-workbench .simple-fr-find-part-wrapper { background-color: ${findWidgetBGColor} !important; }`);
	}

	const widgetForeground = theme.getColor(editorWidgetForeground);
	if (widgetForeground) {
		collector.addRule(`.monaco-workbench .simple-fr-find-part-wrapper { color: ${widgetForeground}; }`);
	}

	const widgetShadowColor = theme.getColor(widgetShadow);
	if (widgetShadowColor) {
		collector.addRule(`.monaco-workbench .simple-fr-find-part-wrapper { box-shadow: 0 0 8px 2px ${widgetShadowColor}; }`);
	}
});
