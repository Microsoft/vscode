/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/quickInput';
import { IQuickPickItem, IPickOptions, IInputOptions, IQuickNavigateConfiguration, IQuickPick, IQuickInput, IQuickInputButton, IInputBox, IQuickPickItemButtonEvent, QuickPickInput, IQuickPickSeparator, IKeyMods, IQuickPickDidAcceptEvent, NO_KEY_MODS, ItemActivation, QuickInputHideReason, IQuickInputHideEvent, IQuickPickWillAcceptEvent } from 'vs/base/parts/quickinput/common/quickInput';
import * as dom from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { QuickInputList, QuickInputListFocus } from './quickInputList';
import { QuickInputBox } from './quickInputBox';
import { KeyCode } from 'vs/base/common/keyCodes';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { localize } from 'vs/nls';
import { CountBadge, ICountBadgetyles } from 'vs/base/browser/ui/countBadge/countBadge';
import { ProgressBar, IProgressBarStyles } from 'vs/base/browser/ui/progressbar/progressbar';
import { Emitter, Event } from 'vs/base/common/event';
import { Button, IButtonStyles } from 'vs/base/browser/ui/button/button';
import { dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import Severity from 'vs/base/common/severity';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Action } from 'vs/base/common/actions';
import { equals } from 'vs/base/common/arrays';
import { TimeoutTimer } from 'vs/base/common/async';
import { getIconClass } from 'vs/base/parts/quickinput/browser/quickInputUtils';
import { IListVirtualDelegate, IListRenderer } from 'vs/base/browser/ui/list/list';
import { List, IListOptions, IListStyles } from 'vs/base/browser/ui/list/listWidget';
import { IInputBoxStyles } from 'vs/base/browser/ui/inputbox/inputBox';
import { Color } from 'vs/base/common/color';
import { registerCodicon, Codicon } from 'vs/base/common/codicons';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { renderLabelWithIcons } from 'vs/base/browser/ui/iconLabel/iconLabels';
import { isString } from 'vs/base/common/types';
import { IKeybindingLabelStyles } from 'vs/base/browser/ui/keybindingLabel/keybindingLabel';

export interface IQuickInputOptions {
	idPrefix: string;
	container: HTMLElement;
	ignoreFocusOut(): boolean;
	isScreenReaderOptimized(): boolean;
	backKeybindingLabel(): string | undefined;
	setContextKey(id?: string): void;
	returnFocus(): void;
	createList<T>(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: IListRenderer<T, any>[],
		options: IListOptions<T>,
	): List<T>;
	styles: IQuickInputStyles;
}

export interface IQuickInputStyles {
	widget: IQuickInputWidgetStyles;
	inputBox: IInputBoxStyles;
	countBadge: ICountBadgetyles;
	button: IButtonStyles;
	progressBar: IProgressBarStyles;
	keybindingLabel: IKeybindingLabelStyles;
	list: IListStyles & { pickerGroupBorder?: Color; pickerGroupForeground?: Color; };
}

export interface IQuickInputWidgetStyles {
	quickInputBackground?: Color;
	quickInputForeground?: Color;
	quickInputTitleBackground?: Color;
	contrastBorder?: Color;
	widgetShadow?: Color;
}

const $ = dom.$;

type Writeable<T> = { -readonly [P in keyof T]: T[P] };


const backButtonIcon = registerCodicon('quick-input-back', Codicon.arrowLeft);

const backButton = {
	iconClass: backButtonIcon.classNames,
	tooltip: localize('quickInput.back', "Back"),
	handle: -1 // TODO
};

interface QuickInputUI {
	container: HTMLElement;
	styleSheet: HTMLStyleElement;
	leftActionBar: ActionBar;
	titleBar: HTMLElement;
	title: HTMLElement;
	description1: HTMLElement;
	description2: HTMLElement;
	rightActionBar: ActionBar;
	checkAll: HTMLInputElement;
	filterContainer: HTMLElement;
	inputBox: QuickInputBox;
	visibleCountContainer: HTMLElement;
	visibleCount: CountBadge;
	countContainer: HTMLElement;
	count: CountBadge;
	okContainer: HTMLElement;
	ok: Button;
	message: HTMLElement;
	customButtonContainer: HTMLElement;
	customButton: Button;
	progressBar: ProgressBar;
	list: QuickInputList;
	onDidAccept: Event<void>;
	onDidCustom: Event<void>;
	onDidTriggerButton: Event<IQuickInputButton>;
	ignoreFocusOut: boolean;
	keyMods: Writeable<IKeyMods>;
	isScreenReaderOptimized(): boolean;
	show(controller: QuickInput): void;
	setVisibilities(visibilities: Visibilities): void;
	setComboboxAccessibility(enabled: boolean): void;
	setEnabled(enabled: boolean): void;
	setContextKey(contextKey?: string): void;
	hide(): void;
}

type Visibilities = {
	title?: boolean;
	description?: boolean;
	checkAll?: boolean;
	inputBox?: boolean;
	checkBox?: boolean;
	visibleCount?: boolean;
	count?: boolean;
	message?: boolean;
	list?: boolean;
	ok?: boolean;
	customButton?: boolean;
	progressBar?: boolean;
};

class QuickInput extends Disposable implements IQuickInput {
	protected static readonly noPromptMessage = localize('inputModeEntry', "Press 'Enter' to confirm your input or 'Escape' to cancel");

	private _title: string | undefined;
	private _description: string | undefined;
	private _steps: number | undefined;
	private _totalSteps: number | undefined;
	protected visible = false;
	private _enabled = true;
	private _contextKey: string | undefined;
	private _busy = false;
	private _ignoreFocusOut = false;
	private _buttons: IQuickInputButton[] = [];
	protected noValidationMessage = QuickInput.noPromptMessage;
	private _validationMessage: string | undefined;
	private _lastValidationMessage: string | undefined;
	private _severity: Severity = Severity.Ignore;
	private _lastSeverity: Severity | undefined;
	private buttonsUpdated = false;
	private readonly onDidTriggerButtonEmitter = this._register(new Emitter<IQuickInputButton>());
	private readonly onDidHideEmitter = this._register(new Emitter<IQuickInputHideEvent>());
	private readonly onDisposeEmitter = this._register(new Emitter<void>());

	protected readonly visibleDisposables = this._register(new DisposableStore());

	private busyDelay: TimeoutTimer | undefined;

	constructor(
		protected ui: QuickInputUI
	) {
		super();
	}

	get title() {
		return this._title;
	}

	set title(title: string | undefined) {
		this._title = title;
		this.update();
	}

	get description() {
		return this._description;
	}

	set description(description: string | undefined) {
		this._description = description;
		this.update();
	}

	get step() {
		return this._steps;
	}

	set step(step: number | undefined) {
		this._steps = step;
		this.update();
	}

	get totalSteps() {
		return this._totalSteps;
	}

	set totalSteps(totalSteps: number | undefined) {
		this._totalSteps = totalSteps;
		this.update();
	}

	get enabled() {
		return this._enabled;
	}

	set enabled(enabled: boolean) {
		this._enabled = enabled;
		this.update();
	}

	get contextKey() {
		return this._contextKey;
	}

	set contextKey(contextKey: string | undefined) {
		this._contextKey = contextKey;
		this.update();
	}

	get busy() {
		return this._busy;
	}

	set busy(busy: boolean) {
		this._busy = busy;
		this.update();
	}

	get ignoreFocusOut() {
		return this._ignoreFocusOut;
	}

	set ignoreFocusOut(ignoreFocusOut: boolean) {
		this._ignoreFocusOut = ignoreFocusOut;
		this.update();
	}

	get buttons() {
		return this._buttons;
	}

	set buttons(buttons: IQuickInputButton[]) {
		this._buttons = buttons;
		this.buttonsUpdated = true;
		this.update();
	}

	get validationMessage() {
		return this._validationMessage;
	}

	set validationMessage(validationMessage: string | undefined) {
		this._validationMessage = validationMessage;
		this.update();
	}

	get severity() {
		return this._severity;
	}

	set severity(severity: Severity) {
		this._severity = severity;
		this.update();
	}

	readonly onDidTriggerButton = this.onDidTriggerButtonEmitter.event;

	show(): void {
		if (this.visible) {
			return;
		}
		this.visibleDisposables.add(
			this.ui.onDidTriggerButton(button => {
				if (this.buttons.indexOf(button) !== -1) {
					this.onDidTriggerButtonEmitter.fire(button);
				}
			}),
		);
		this.ui.show(this);
		this.visible = true;
		this.update();
	}

	hide(): void {
		if (!this.visible) {
			return;
		}
		this.ui.hide();
	}

	didHide(reason = QuickInputHideReason.Other): void {
		this.visible = false;
		this.visibleDisposables.clear();
		this.onDidHideEmitter.fire({ reason });
	}

	readonly onDidHide = this.onDidHideEmitter.event;

	protected update() {
		if (!this.visible) {
			return;
		}
		const title = this.getTitle();
		if (title && this.ui.title.textContent !== title) {
			this.ui.title.textContent = title;
		} else if (!title && this.ui.title.innerHTML !== '&nbsp;') {
			this.ui.title.innerText = '\u00a0;';
		}
		const description = this.getDescription();
		if (this.ui.description1.textContent !== description) {
			this.ui.description1.textContent = description;
		}
		if (this.ui.description2.textContent !== description) {
			this.ui.description2.textContent = description;
		}
		if (this.busy && !this.busyDelay) {
			this.busyDelay = new TimeoutTimer();
			this.busyDelay.setIfNotSet(() => {
				if (this.visible) {
					this.ui.progressBar.infinite();
				}
			}, 800);
		}
		if (!this.busy && this.busyDelay) {
			this.ui.progressBar.stop();
			this.busyDelay.cancel();
			this.busyDelay = undefined;
		}
		if (this.buttonsUpdated) {
			this.buttonsUpdated = false;
			this.ui.leftActionBar.clear();
			const leftButtons = this.buttons.filter(button => button === backButton);
			this.ui.leftActionBar.push(leftButtons.map((button, index) => {
				const action = new Action(`id-${index}`, '', button.iconClass || getIconClass(button.iconPath), true, async () => {
					this.onDidTriggerButtonEmitter.fire(button);
				});
				action.tooltip = button.tooltip || '';
				return action;
			}), { icon: true, label: false });
			this.ui.rightActionBar.clear();
			const rightButtons = this.buttons.filter(button => button !== backButton);
			this.ui.rightActionBar.push(rightButtons.map((button, index) => {
				const action = new Action(`id-${index}`, '', button.iconClass || getIconClass(button.iconPath), true, async () => {
					this.onDidTriggerButtonEmitter.fire(button);
				});
				action.tooltip = button.tooltip || '';
				return action;
			}), { icon: true, label: false });
		}
		this.ui.ignoreFocusOut = this.ignoreFocusOut;
		this.ui.setEnabled(this.enabled);
		this.ui.setContextKey(this.contextKey);

		const validationMessage = this.validationMessage || this.noValidationMessage;
		if (this._lastValidationMessage !== validationMessage) {
			this._lastValidationMessage = validationMessage;
			dom.reset(this.ui.message, ...renderLabelWithIcons(validationMessage));
		}
		if (this._lastSeverity !== this.severity) {
			this._lastSeverity = this.severity;
			this.showMessageDecoration(this.severity);
		}
	}

	private getTitle() {
		if (this.title && this.step) {
			return `${this.title} (${this.getSteps()})`;
		}
		if (this.title) {
			return this.title;
		}
		if (this.step) {
			return this.getSteps();
		}
		return '';
	}

	private getDescription() {
		return this.description || '';
	}

	private getSteps() {
		if (this.step && this.totalSteps) {
			return localize('quickInput.steps', "{0}/{1}", this.step, this.totalSteps);
		}
		if (this.step) {
			return String(this.step);
		}
		return '';
	}

	protected showMessageDecoration(severity: Severity) {
		this.ui.inputBox.showDecoration(severity);
		if (severity !== Severity.Ignore) {
			const styles = this.ui.inputBox.stylesForType(severity);
			this.ui.message.style.color = styles.foreground ? `${styles.foreground}` : '';
			this.ui.message.style.backgroundColor = styles.background ? `${styles.background}` : '';
			this.ui.message.style.border = styles.border ? `1px solid ${styles.border}` : '';
			this.ui.message.style.paddingBottom = '4px';
		} else {
			this.ui.message.style.color = '';
			this.ui.message.style.backgroundColor = '';
			this.ui.message.style.border = '';
			this.ui.message.style.paddingBottom = '';
		}
	}

	readonly onDispose = this.onDisposeEmitter.event;

	override dispose(): void {
		this.hide();
		this.onDisposeEmitter.fire();

		super.dispose();
	}
}

class QuickPick<T extends IQuickPickItem> extends QuickInput implements IQuickPick<T> {

	private static readonly DEFAULT_ARIA_LABEL = localize('quickInputBox.ariaLabel', "Type to narrow down results.");

	private _value = '';
	private _ariaLabel: string | undefined;
	private _placeholder: string | undefined;
	private readonly onDidChangeValueEmitter = this._register(new Emitter<string>());
	private readonly onWillAcceptEmitter = this._register(new Emitter<IQuickPickWillAcceptEvent>());
	private readonly onDidAcceptEmitter = this._register(new Emitter<IQuickPickDidAcceptEvent>());
	private readonly onDidCustomEmitter = this._register(new Emitter<void>());
	private _items: Array<T | IQuickPickSeparator> = [];
	private itemsUpdated = false;
	private _canSelectMany = false;
	private _canAcceptInBackground = false;
	private _matchOnDescription = false;
	private _matchOnDetail = false;
	private _matchOnLabel = true;
	private _sortByLabel = true;
	private _autoFocusOnList = true;
	private _itemActivation = this.ui.isScreenReaderOptimized() ? ItemActivation.NONE /* https://github.com/microsoft/vscode/issues/57501 */ : ItemActivation.FIRST;
	private _activeItems: T[] = [];
	private activeItemsUpdated = false;
	private activeItemsToConfirm: T[] | null = [];
	private readonly onDidChangeActiveEmitter = this._register(new Emitter<T[]>());
	private _selectedItems: T[] = [];
	private selectedItemsUpdated = false;
	private selectedItemsToConfirm: T[] | null = [];
	private readonly onDidChangeSelectionEmitter = this._register(new Emitter<T[]>());
	private readonly onDidTriggerItemButtonEmitter = this._register(new Emitter<IQuickPickItemButtonEvent<T>>());
	private _valueSelection: Readonly<[number, number]> | undefined;
	private valueSelectionUpdated = true;
	private _ok: boolean | 'default' = 'default';
	private _customButton = false;
	private _customButtonLabel: string | undefined;
	private _customButtonHover: string | undefined;
	private _quickNavigate: IQuickNavigateConfiguration | undefined;
	private _hideInput: boolean | undefined;
	private _hideCheckAll: boolean | undefined;

	get quickNavigate() {
		return this._quickNavigate;
	}

	set quickNavigate(quickNavigate: IQuickNavigateConfiguration | undefined) {
		this._quickNavigate = quickNavigate;
		this.update();
	}

	get value() {
		return this._value;
	}

	set value(value: string) {
		if (this._value !== value) {
			this._value = value || '';
			this.update();
			this.onDidChangeValueEmitter.fire(this._value);
		}
	}

	filterValue = (value: string) => value;

	set ariaLabel(ariaLabel: string | undefined) {
		this._ariaLabel = ariaLabel;
		this.update();
	}

	get ariaLabel() {
		return this._ariaLabel;
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string | undefined) {
		this._placeholder = placeholder;
		this.update();
	}

	onDidChangeValue = this.onDidChangeValueEmitter.event;

	onWillAccept = this.onWillAcceptEmitter.event;
	onDidAccept = this.onDidAcceptEmitter.event;

	onDidCustom = this.onDidCustomEmitter.event;

	get items() {
		return this._items;
	}

	set items(items: Array<T | IQuickPickSeparator>) {
		this._items = items;
		this.itemsUpdated = true;
		this.update();
	}

	get canSelectMany() {
		return this._canSelectMany;
	}

	set canSelectMany(canSelectMany: boolean) {
		this._canSelectMany = canSelectMany;
		this.update();
	}

	get canAcceptInBackground() {
		return this._canAcceptInBackground;
	}

	set canAcceptInBackground(canAcceptInBackground: boolean) {
		this._canAcceptInBackground = canAcceptInBackground;
	}

	get matchOnDescription() {
		return this._matchOnDescription;
	}

	set matchOnDescription(matchOnDescription: boolean) {
		this._matchOnDescription = matchOnDescription;
		this.update();
	}

	get matchOnDetail() {
		return this._matchOnDetail;
	}

	set matchOnDetail(matchOnDetail: boolean) {
		this._matchOnDetail = matchOnDetail;
		this.update();
	}

	get matchOnLabel() {
		return this._matchOnLabel;
	}

	set matchOnLabel(matchOnLabel: boolean) {
		this._matchOnLabel = matchOnLabel;
		this.update();
	}

	get sortByLabel() {
		return this._sortByLabel;
	}

	set sortByLabel(sortByLabel: boolean) {
		this._sortByLabel = sortByLabel;
		this.update();
	}

	get autoFocusOnList() {
		return this._autoFocusOnList;
	}

	set autoFocusOnList(autoFocusOnList: boolean) {
		this._autoFocusOnList = autoFocusOnList;
		this.update();
	}

	get itemActivation() {
		return this._itemActivation;
	}

	set itemActivation(itemActivation: ItemActivation) {
		this._itemActivation = itemActivation;
	}

	get activeItems() {
		return this._activeItems;
	}

	set activeItems(activeItems: T[]) {
		this._activeItems = activeItems;
		this.activeItemsUpdated = true;
		this.update();
	}

	onDidChangeActive = this.onDidChangeActiveEmitter.event;

	get selectedItems() {
		return this._selectedItems;
	}

	set selectedItems(selectedItems: T[]) {
		this._selectedItems = selectedItems;
		this.selectedItemsUpdated = true;
		this.update();
	}

	get keyMods() {
		if (this._quickNavigate) {
			// Disable keyMods when quick navigate is enabled
			// because in this model the interaction is purely
			// keyboard driven and Ctrl/Alt are typically
			// pressed and hold during this interaction.
			return NO_KEY_MODS;
		}
		return this.ui.keyMods;
	}

	set valueSelection(valueSelection: Readonly<[number, number]>) {
		this._valueSelection = valueSelection;
		this.valueSelectionUpdated = true;
		this.update();
	}

	get customButton() {
		return this._customButton;
	}

	set customButton(showCustomButton: boolean) {
		this._customButton = showCustomButton;
		this.update();
	}

	get customLabel() {
		return this._customButtonLabel;
	}

	set customLabel(label: string | undefined) {
		this._customButtonLabel = label;
		this.update();
	}

	get customHover() {
		return this._customButtonHover;
	}

	set customHover(hover: string | undefined) {
		this._customButtonHover = hover;
		this.update();
	}

	get ok() {
		return this._ok;
	}

	set ok(showOkButton: boolean | 'default') {
		this._ok = showOkButton;
		this.update();
	}

	inputHasFocus(): boolean {
		return this.visible ? this.ui.inputBox.hasFocus() : false;
	}

	focusOnInput() {
		this.ui.inputBox.setFocus();
	}

	get hideInput() {
		return !!this._hideInput;
	}

	set hideInput(hideInput: boolean) {
		this._hideInput = hideInput;
		this.update();
	}

	get hideCheckAll() {
		return !!this._hideCheckAll;
	}

	set hideCheckAll(hideCheckAll: boolean) {
		this._hideCheckAll = hideCheckAll;
		this.update();
	}

	onDidChangeSelection = this.onDidChangeSelectionEmitter.event;

	onDidTriggerItemButton = this.onDidTriggerItemButtonEmitter.event;

	private trySelectFirst() {
		if (this.autoFocusOnList) {
			if (!this.canSelectMany) {
				this.ui.list.focus(QuickInputListFocus.First);
			}
		}
	}

	override show() {
		if (!this.visible) {
			this.visibleDisposables.add(
				this.ui.inputBox.onDidChange(value => {
					if (value === this.value) {
						return;
					}
					this._value = value;
					const didFilter = this.ui.list.filter(this.filterValue(this.ui.inputBox.value));
					if (didFilter) {
						this.trySelectFirst();
					}
					this.onDidChangeValueEmitter.fire(value);
				}));
			this.visibleDisposables.add(this.ui.inputBox.onMouseDown(event => {
				if (!this.autoFocusOnList) {
					this.ui.list.clearFocus();
				}
			}));
			this.visibleDisposables.add((this._hideInput ? this.ui.list : this.ui.inputBox).onKeyDown((event: KeyboardEvent | StandardKeyboardEvent) => {
				switch (event.keyCode) {
					case KeyCode.DownArrow:
						this.ui.list.focus(QuickInputListFocus.Next);
						if (this.canSelectMany) {
							this.ui.list.domFocus();
						}
						dom.EventHelper.stop(event, true);
						break;
					case KeyCode.UpArrow:
						if (this.ui.list.getFocusedElements().length) {
							this.ui.list.focus(QuickInputListFocus.Previous);
						} else {
							this.ui.list.focus(QuickInputListFocus.Last);
						}
						if (this.canSelectMany) {
							this.ui.list.domFocus();
						}
						dom.EventHelper.stop(event, true);
						break;
					case KeyCode.PageDown:
						this.ui.list.focus(QuickInputListFocus.NextPage);
						if (this.canSelectMany) {
							this.ui.list.domFocus();
						}
						dom.EventHelper.stop(event, true);
						break;
					case KeyCode.PageUp:
						this.ui.list.focus(QuickInputListFocus.PreviousPage);
						if (this.canSelectMany) {
							this.ui.list.domFocus();
						}
						dom.EventHelper.stop(event, true);
						break;
					case KeyCode.RightArrow:
						if (!this._canAcceptInBackground) {
							return; // needs to be enabled
						}

						if (!this.ui.inputBox.isSelectionAtEnd()) {
							return; // ensure input box selection at end
						}

						if (this.activeItems[0]) {
							this._selectedItems = [this.activeItems[0]];
							this.onDidChangeSelectionEmitter.fire(this.selectedItems);
							this.handleAccept(true);
						}

						break;
					case KeyCode.Home:
						if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
							this.ui.list.focus(QuickInputListFocus.First);
							dom.EventHelper.stop(event, true);
						}
						break;
					case KeyCode.End:
						if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
							this.ui.list.focus(QuickInputListFocus.Last);
							dom.EventHelper.stop(event, true);
						}
						break;
				}
			}));
			this.visibleDisposables.add(this.ui.onDidAccept(() => {
				if (!this.canSelectMany && this.activeItems[0]) {
					this._selectedItems = [this.activeItems[0]];
					this.onDidChangeSelectionEmitter.fire(this.selectedItems);
				}
				this.handleAccept(false);
			}));
			this.visibleDisposables.add(this.ui.onDidCustom(() => {
				this.onDidCustomEmitter.fire();
			}));
			this.visibleDisposables.add(this.ui.list.onDidChangeFocus(focusedItems => {
				if (this.activeItemsUpdated) {
					return; // Expect another event.
				}
				if (this.activeItemsToConfirm !== this._activeItems && equals(focusedItems, this._activeItems, (a, b) => a === b)) {
					return;
				}
				this._activeItems = focusedItems as T[];
				this.onDidChangeActiveEmitter.fire(focusedItems as T[]);
			}));
			this.visibleDisposables.add(this.ui.list.onDidChangeSelection(({ items: selectedItems, event }) => {
				if (this.canSelectMany) {
					if (selectedItems.length) {
						this.ui.list.setSelectedElements([]);
					}
					return;
				}
				if (this.selectedItemsToConfirm !== this._selectedItems && equals(selectedItems, this._selectedItems, (a, b) => a === b)) {
					return;
				}
				this._selectedItems = selectedItems as T[];
				this.onDidChangeSelectionEmitter.fire(selectedItems as T[]);
				if (selectedItems.length) {
					this.handleAccept(event instanceof MouseEvent && event.button === 1 /* mouse middle click */);
				}
			}));
			this.visibleDisposables.add(this.ui.list.onChangedCheckedElements(checkedItems => {
				if (!this.canSelectMany) {
					return;
				}
				if (this.selectedItemsToConfirm !== this._selectedItems && equals(checkedItems, this._selectedItems, (a, b) => a === b)) {
					return;
				}
				this._selectedItems = checkedItems as T[];
				this.onDidChangeSelectionEmitter.fire(checkedItems as T[]);
			}));
			this.visibleDisposables.add(this.ui.list.onButtonTriggered(event => this.onDidTriggerItemButtonEmitter.fire(event as IQuickPickItemButtonEvent<T>)));
			this.visibleDisposables.add(this.registerQuickNavigation());
			this.valueSelectionUpdated = true;
		}
		super.show(); // TODO: Why have show() bubble up while update() trickles down? (Could move setComboboxAccessibility() here.)
	}

	private handleAccept(inBackground: boolean): void {

		// Figure out veto via `onWillAccept` event
		let veto = false;
		this.onWillAcceptEmitter.fire({ veto: () => veto = true });

		// Continue with `onDidAccpet` if no veto
		if (!veto) {
			this.onDidAcceptEmitter.fire({ inBackground });
		}
	}

	private registerQuickNavigation() {
		return dom.addDisposableListener(this.ui.container, dom.EventType.KEY_UP, e => {
			if (this.canSelectMany || !this._quickNavigate) {
				return;
			}

			const keyboardEvent: StandardKeyboardEvent = new StandardKeyboardEvent(e);
			const keyCode = keyboardEvent.keyCode;

			// Select element when keys are pressed that signal it
			const quickNavKeys = this._quickNavigate.keybindings;
			const wasTriggerKeyPressed = quickNavKeys.some(k => {
				const [firstPart, chordPart] = k.getParts();
				if (chordPart) {
					return false;
				}

				if (firstPart.shiftKey && keyCode === KeyCode.Shift) {
					if (keyboardEvent.ctrlKey || keyboardEvent.altKey || keyboardEvent.metaKey) {
						return false; // this is an optimistic check for the shift key being used to navigate back in quick input
					}

					return true;
				}

				if (firstPart.altKey && keyCode === KeyCode.Alt) {
					return true;
				}

				if (firstPart.ctrlKey && keyCode === KeyCode.Ctrl) {
					return true;
				}

				if (firstPart.metaKey && keyCode === KeyCode.Meta) {
					return true;
				}

				return false;
			});

			if (wasTriggerKeyPressed) {
				if (this.activeItems[0]) {
					this._selectedItems = [this.activeItems[0]];
					this.onDidChangeSelectionEmitter.fire(this.selectedItems);
					this.handleAccept(false);
				}
				// Unset quick navigate after press. It is only valid once
				// and should not result in any behaviour change afterwards
				// if the picker remains open because there was no active item
				this._quickNavigate = undefined;
			}
		});
	}

	protected override update() {
		if (!this.visible) {
			return;
		}
		const hideInput = !!this._hideInput && this._items.length > 0;
		this.ui.container.classList.toggle('hidden-input', hideInput && !this.description);
		const visibilities: Visibilities = {
			title: !!this.title || !!this.step || !!this.buttons.length,
			description: !!this.description,
			checkAll: this.canSelectMany && !this._hideCheckAll,
			checkBox: this.canSelectMany,
			inputBox: !hideInput,
			progressBar: !hideInput,
			visibleCount: true,
			count: this.canSelectMany,
			ok: this.ok === 'default' ? this.canSelectMany : this.ok,
			list: true,
			message: !!this.validationMessage,
			customButton: this.customButton
		};
		this.ui.setVisibilities(visibilities);
		super.update();
		if (this.ui.inputBox.value !== this.value) {
			this.ui.inputBox.value = this.value;
		}
		if (this.valueSelectionUpdated) {
			this.valueSelectionUpdated = false;
			this.ui.inputBox.select(this._valueSelection && { start: this._valueSelection[0], end: this._valueSelection[1] });
		}
		if (this.ui.inputBox.placeholder !== (this.placeholder || '')) {
			this.ui.inputBox.placeholder = (this.placeholder || '');
		}
		const ariaLabel = this.ariaLabel || this.placeholder || QuickPick.DEFAULT_ARIA_LABEL;
		if (this.ui.inputBox.ariaLabel !== ariaLabel) {
			this.ui.inputBox.ariaLabel = ariaLabel;
		}
		this.ui.list.matchOnDescription = this.matchOnDescription;
		this.ui.list.matchOnDetail = this.matchOnDetail;
		this.ui.list.matchOnLabel = this.matchOnLabel;
		this.ui.list.sortByLabel = this.sortByLabel;
		if (this.itemsUpdated) {
			this.itemsUpdated = false;
			this.ui.list.setElements(this.items);
			this.ui.list.filter(this.filterValue(this.ui.inputBox.value));
			this.ui.checkAll.checked = this.ui.list.getAllVisibleChecked();
			this.ui.visibleCount.setCount(this.ui.list.getVisibleCount());
			this.ui.count.setCount(this.ui.list.getCheckedCount());
			switch (this._itemActivation) {
				case ItemActivation.NONE:
					this._itemActivation = ItemActivation.FIRST; // only valid once, then unset
					break;
				case ItemActivation.SECOND:
					this.ui.list.focus(QuickInputListFocus.Second);
					this._itemActivation = ItemActivation.FIRST; // only valid once, then unset
					break;
				case ItemActivation.LAST:
					this.ui.list.focus(QuickInputListFocus.Last);
					this._itemActivation = ItemActivation.FIRST; // only valid once, then unset
					break;
				default:
					this.trySelectFirst();
					break;
			}
		}
		if (this.ui.container.classList.contains('show-checkboxes') !== !!this.canSelectMany) {
			if (this.canSelectMany) {
				this.ui.list.clearFocus();
			} else {
				this.trySelectFirst();
			}
		}
		if (this.activeItemsUpdated) {
			this.activeItemsUpdated = false;
			this.activeItemsToConfirm = this._activeItems;
			this.ui.list.setFocusedElements(this.activeItems);
			if (this.activeItemsToConfirm === this._activeItems) {
				this.activeItemsToConfirm = null;
			}
		}
		if (this.selectedItemsUpdated) {
			this.selectedItemsUpdated = false;
			this.selectedItemsToConfirm = this._selectedItems;
			if (this.canSelectMany) {
				this.ui.list.setCheckedElements(this.selectedItems);
			} else {
				this.ui.list.setSelectedElements(this.selectedItems);
			}
			if (this.selectedItemsToConfirm === this._selectedItems) {
				this.selectedItemsToConfirm = null;
			}
		}
		this.ui.customButton.label = this.customLabel || '';
		this.ui.customButton.element.title = this.customHover || '';
		this.ui.setComboboxAccessibility(true);
		if (!visibilities.inputBox) {
			// we need to move focus into the tree to detect keybindings
			// properly when the input box is not visible (quick nav)
			this.ui.list.domFocus();

			// Focus the first element in the list if multiselect is enabled
			if (this.canSelectMany) {
				this.ui.list.focus(QuickInputListFocus.First);
			}
		}
	}
}

class InputBox extends QuickInput implements IInputBox {
	private _value = '';
	private _valueSelection: Readonly<[number, number]> | undefined;
	private valueSelectionUpdated = true;
	private _placeholder: string | undefined;
	private _password = false;
	private _prompt: string | undefined;
	private readonly onDidValueChangeEmitter = this._register(new Emitter<string>());
	private readonly onDidAcceptEmitter = this._register(new Emitter<void>());

	get value() {
		return this._value;
	}

	set value(value: string) {
		this._value = value || '';
		this.update();
	}

	set valueSelection(valueSelection: Readonly<[number, number]>) {
		this._valueSelection = valueSelection;
		this.valueSelectionUpdated = true;
		this.update();
	}

	get placeholder() {
		return this._placeholder;
	}

	set placeholder(placeholder: string | undefined) {
		this._placeholder = placeholder;
		this.update();
	}

	get password() {
		return this._password;
	}

	set password(password: boolean) {
		this._password = password;
		this.update();
	}

	get prompt() {
		return this._prompt;
	}

	set prompt(prompt: string | undefined) {
		this._prompt = prompt;
		this.noValidationMessage = prompt
			? localize('inputModeEntryDescription', "{0} (Press 'Enter' to confirm or 'Escape' to cancel)", prompt)
			: QuickInput.noPromptMessage;
		this.update();
	}

	readonly onDidChangeValue = this.onDidValueChangeEmitter.event;

	readonly onDidAccept = this.onDidAcceptEmitter.event;

	override show() {
		if (!this.visible) {
			this.visibleDisposables.add(
				this.ui.inputBox.onDidChange(value => {
					if (value === this.value) {
						return;
					}
					this._value = value;
					this.onDidValueChangeEmitter.fire(value);
				}));
			this.visibleDisposables.add(this.ui.onDidAccept(() => this.onDidAcceptEmitter.fire()));
			this.valueSelectionUpdated = true;
		}
		super.show();
	}

	protected override update() {
		if (!this.visible) {
			return;
		}
		const visibilities: Visibilities = {
			title: !!this.title || !!this.step || !!this.buttons.length,
			description: !!this.description || !!this.step,
			inputBox: true, message: true
		};
		this.ui.setVisibilities(visibilities);
		super.update();
		if (this.ui.inputBox.value !== this.value) {
			this.ui.inputBox.value = this.value;
		}
		if (this.valueSelectionUpdated) {
			this.valueSelectionUpdated = false;
			this.ui.inputBox.select(this._valueSelection && { start: this._valueSelection[0], end: this._valueSelection[1] });
		}
		if (this.ui.inputBox.placeholder !== (this.placeholder || '')) {
			this.ui.inputBox.placeholder = (this.placeholder || '');
		}
		if (this.ui.inputBox.password !== this.password) {
			this.ui.inputBox.password = this.password;
		}

	}
}

export class QuickInputController extends Disposable {
	private static readonly MAX_WIDTH = 600; // Max total width of quick input widget

	private idPrefix: string;
	private ui: QuickInputUI | undefined;
	private dimension?: dom.IDimension;
	private titleBarOffset?: number;
	private comboboxAccessibility = false;
	private enabled = true;
	private readonly onDidAcceptEmitter = this._register(new Emitter<void>());
	private readonly onDidCustomEmitter = this._register(new Emitter<void>());
	private readonly onDidTriggerButtonEmitter = this._register(new Emitter<IQuickInputButton>());
	private keyMods: Writeable<IKeyMods> = { ctrlCmd: false, alt: false };

	private controller: QuickInput | null = null;

	private parentElement: HTMLElement;
	private styles: IQuickInputStyles;

	private onShowEmitter = this._register(new Emitter<void>());
	readonly onShow = this.onShowEmitter.event;

	private onHideEmitter = this._register(new Emitter<void>());
	readonly onHide = this.onHideEmitter.event;

	private previousFocusElement?: HTMLElement;

	constructor(private options: IQuickInputOptions) {
		super();
		this.idPrefix = options.idPrefix;
		this.parentElement = options.container;
		this.styles = options.styles;
		this.registerKeyModsListeners();
	}

	private registerKeyModsListeners() {
		const listener = (e: KeyboardEvent | MouseEvent) => {
			this.keyMods.ctrlCmd = e.ctrlKey || e.metaKey;
			this.keyMods.alt = e.altKey;
		};
		this._register(dom.addDisposableListener(window, dom.EventType.KEY_DOWN, listener, true));
		this._register(dom.addDisposableListener(window, dom.EventType.KEY_UP, listener, true));
		this._register(dom.addDisposableListener(window, dom.EventType.MOUSE_DOWN, listener, true));
	}

	private getUI() {
		if (this.ui) {
			return this.ui;
		}

		const container = dom.append(this.parentElement, $('.quick-input-widget.show-file-icons'));
		container.tabIndex = -1;
		container.style.display = 'none';

		const styleSheet = dom.createStyleSheet(container);

		const titleBar = dom.append(container, $('.quick-input-titlebar'));

		const leftActionBar = this._register(new ActionBar(titleBar));
		leftActionBar.domNode.classList.add('quick-input-left-action-bar');

		const title = dom.append(titleBar, $('.quick-input-title'));

		const rightActionBar = this._register(new ActionBar(titleBar));
		rightActionBar.domNode.classList.add('quick-input-right-action-bar');

		const description1 = dom.append(container, $('.quick-input-description'));
		const headerContainer = dom.append(container, $('.quick-input-header'));

		const checkAll = <HTMLInputElement>dom.append(headerContainer, $('input.quick-input-check-all'));
		checkAll.type = 'checkbox';
		this._register(dom.addStandardDisposableListener(checkAll, dom.EventType.CHANGE, e => {
			const checked = checkAll.checked;
			list.setAllVisibleChecked(checked);
		}));
		this._register(dom.addDisposableListener(checkAll, dom.EventType.CLICK, e => {
			if (e.x || e.y) { // Avoid 'click' triggered by 'space'...
				inputBox.setFocus();
			}
		}));

		const description2 = dom.append(headerContainer, $('.quick-input-description'));
		const extraContainer = dom.append(headerContainer, $('.quick-input-and-message'));
		const filterContainer = dom.append(extraContainer, $('.quick-input-filter'));

		const inputBox = this._register(new QuickInputBox(filterContainer));
		inputBox.setAttribute('aria-describedby', `${this.idPrefix}message`);

		const visibleCountContainer = dom.append(filterContainer, $('.quick-input-visible-count'));
		visibleCountContainer.setAttribute('aria-live', 'polite');
		visibleCountContainer.setAttribute('aria-atomic', 'true');
		const visibleCount = new CountBadge(visibleCountContainer, { countFormat: localize({ key: 'quickInput.visibleCount', comment: ['This tells the user how many items are shown in a list of items to select from. The items can be anything. Currently not visible, but read by screen readers.'] }, "{0} Results") });

		const countContainer = dom.append(filterContainer, $('.quick-input-count'));
		countContainer.setAttribute('aria-live', 'polite');
		const count = new CountBadge(countContainer, { countFormat: localize({ key: 'quickInput.countSelected', comment: ['This tells the user how many items are selected in a list of items to select from. The items can be anything.'] }, "{0} Selected") });

		const okContainer = dom.append(headerContainer, $('.quick-input-action'));
		const ok = new Button(okContainer);
		ok.label = localize('ok', "OK");
		this._register(ok.onDidClick(e => {
			this.onDidAcceptEmitter.fire();
		}));

		const customButtonContainer = dom.append(headerContainer, $('.quick-input-action'));
		const customButton = new Button(customButtonContainer);
		customButton.label = localize('custom', "Custom");
		this._register(customButton.onDidClick(e => {
			this.onDidCustomEmitter.fire();
		}));

		const message = dom.append(extraContainer, $(`#${this.idPrefix}message.quick-input-message`));

		const list = this._register(new QuickInputList(container, this.idPrefix + 'list', this.options));
		this._register(list.onChangedAllVisibleChecked(checked => {
			checkAll.checked = checked;
		}));
		this._register(list.onChangedVisibleCount(c => {
			visibleCount.setCount(c);
		}));
		this._register(list.onChangedCheckedCount(c => {
			count.setCount(c);
		}));
		this._register(list.onLeave(() => {
			// Defer to avoid the input field reacting to the triggering key.
			setTimeout(() => {
				inputBox.setFocus();
				if (this.controller instanceof QuickPick && this.controller.canSelectMany) {
					list.clearFocus();
				}
			}, 0);
		}));
		this._register(list.onDidChangeFocus(() => {
			if (this.comboboxAccessibility) {
				this.getUI().inputBox.setAttribute('aria-activedescendant', this.getUI().list.getActiveDescendant() || '');
			}
		}));

		const progressBar = new ProgressBar(container);
		progressBar.getContainer().classList.add('quick-input-progress');

		const focusTracker = dom.trackFocus(container);
		this._register(focusTracker);
		this._register(dom.addDisposableListener(container, dom.EventType.FOCUS, e => {
			this.previousFocusElement = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : undefined;
		}, true));
		this._register(focusTracker.onDidBlur(() => {
			if (!this.getUI().ignoreFocusOut && !this.options.ignoreFocusOut()) {
				this.hide(QuickInputHideReason.Blur);
			}
			this.previousFocusElement = undefined;
		}));
		this._register(dom.addDisposableListener(container, dom.EventType.FOCUS, (e: FocusEvent) => {
			inputBox.setFocus();
		}));
		this._register(dom.addDisposableListener(container, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			switch (event.keyCode) {
				case KeyCode.Enter:
					dom.EventHelper.stop(e, true);
					this.onDidAcceptEmitter.fire();
					break;
				case KeyCode.Escape:
					dom.EventHelper.stop(e, true);
					this.hide(QuickInputHideReason.Gesture);
					break;
				case KeyCode.Tab:
					if (!event.altKey && !event.ctrlKey && !event.metaKey) {
						const selectors = ['.action-label.codicon'];
						if (container.classList.contains('show-checkboxes')) {
							selectors.push('input');
						} else {
							selectors.push('input[type=text]');
						}
						if (this.getUI().list.isDisplayed()) {
							selectors.push('.monaco-list');
						}
						const stops = container.querySelectorAll<HTMLElement>(selectors.join(', '));
						if (event.shiftKey && event.target === stops[0]) {
							dom.EventHelper.stop(e, true);
							stops[stops.length - 1].focus();
						} else if (!event.shiftKey && event.target === stops[stops.length - 1]) {
							dom.EventHelper.stop(e, true);
							stops[0].focus();
						}
					}
					break;
			}
		}));

		this.ui = {
			container,
			styleSheet,
			leftActionBar,
			titleBar,
			title,
			description1,
			description2,
			rightActionBar,
			checkAll,
			filterContainer,
			inputBox,
			visibleCountContainer,
			visibleCount,
			countContainer,
			count,
			okContainer,
			ok,
			message,
			customButtonContainer,
			customButton,
			list,
			progressBar,
			onDidAccept: this.onDidAcceptEmitter.event,
			onDidCustom: this.onDidCustomEmitter.event,
			onDidTriggerButton: this.onDidTriggerButtonEmitter.event,
			ignoreFocusOut: false,
			keyMods: this.keyMods,
			isScreenReaderOptimized: () => this.options.isScreenReaderOptimized(),
			show: controller => this.show(controller),
			hide: () => this.hide(),
			setVisibilities: visibilities => this.setVisibilities(visibilities),
			setComboboxAccessibility: enabled => this.setComboboxAccessibility(enabled),
			setEnabled: enabled => this.setEnabled(enabled),
			setContextKey: contextKey => this.options.setContextKey(contextKey),
		};
		this.updateStyles();
		return this.ui;
	}

	pick<T extends IQuickPickItem, O extends IPickOptions<T>>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options: O = <O>{}, token: CancellationToken = CancellationToken.None): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		type R = (O extends { canPickMany: true } ? T[] : T) | undefined;
		return new Promise<R>((doResolve, reject) => {
			let resolve = (result: R) => {
				resolve = doResolve;
				if (options.onKeyMods) {
					options.onKeyMods(input.keyMods);
				}
				doResolve(result);
			};
			if (token.isCancellationRequested) {
				resolve(undefined);
				return;
			}
			const input = this.createQuickPick<T>();
			let activeItem: T | undefined;
			const disposables = [
				input,
				input.onDidAccept(() => {
					if (input.canSelectMany) {
						resolve(<R>input.selectedItems.slice());
						input.hide();
					} else {
						const result = input.activeItems[0];
						if (result) {
							resolve(<R>result);
							input.hide();
						}
					}
				}),
				input.onDidChangeActive(items => {
					const focused = items[0];
					if (focused && options.onDidFocus) {
						options.onDidFocus(focused);
					}
				}),
				input.onDidChangeSelection(items => {
					if (!input.canSelectMany) {
						const result = items[0];
						if (result) {
							resolve(<R>result);
							input.hide();
						}
					}
				}),
				input.onDidTriggerItemButton(event => options.onDidTriggerItemButton && options.onDidTriggerItemButton({
					...event,
					removeItem: () => {
						const index = input.items.indexOf(event.item);
						if (index !== -1) {
							const items = input.items.slice();
							const removed = items.splice(index, 1);
							const activeItems = input.activeItems.filter((ai) => ai !== removed[0]);
							input.items = items;
							if (activeItems) {
								input.activeItems = activeItems;
							}
						}
					}
				})),
				input.onDidChangeValue(value => {
					if (activeItem && !value && (input.activeItems.length !== 1 || input.activeItems[0] !== activeItem)) {
						input.activeItems = [activeItem];
					}
				}),
				token.onCancellationRequested(() => {
					input.hide();
				}),
				input.onDidHide(() => {
					dispose(disposables);
					resolve(undefined);
				}),
			];
			input.title = options.title;
			input.canSelectMany = !!options.canPickMany;
			input.placeholder = options.placeHolder;
			input.ignoreFocusOut = !!options.ignoreFocusLost;
			input.matchOnDescription = !!options.matchOnDescription;
			input.matchOnDetail = !!options.matchOnDetail;
			input.matchOnLabel = (options.matchOnLabel === undefined) || options.matchOnLabel; // default to true
			input.autoFocusOnList = (options.autoFocusOnList === undefined) || options.autoFocusOnList; // default to true
			input.quickNavigate = options.quickNavigate;
			input.contextKey = options.contextKey;
			input.busy = true;
			Promise.all<QuickPickInput<T>[], T | undefined>([picks, options.activeItem])
				.then(([items, _activeItem]) => {
					activeItem = _activeItem;
					input.busy = false;
					input.items = items;
					if (input.canSelectMany) {
						input.selectedItems = items.filter(item => item.type !== 'separator' && item.picked) as T[];
					}
					if (activeItem) {
						input.activeItems = [activeItem];
					}
				});
			input.show();
			Promise.resolve(picks).then(undefined, err => {
				reject(err);
				input.hide();
			});
		});
	}

	private setValidationOnInput(input: IInputBox, validationResult: string | {
		content: string;
		severity: Severity;
	} | null | undefined) {
		if (validationResult && isString(validationResult)) {
			input.severity = Severity.Error;
			input.validationMessage = validationResult;
		} else if (validationResult && !isString(validationResult)) {
			input.severity = validationResult.severity;
			input.validationMessage = validationResult.content;
		} else {
			input.severity = Severity.Ignore;
			input.validationMessage = undefined;
		}
	}

	input(options: IInputOptions = {}, token: CancellationToken = CancellationToken.None): Promise<string | undefined> {
		return new Promise<string | undefined>((resolve) => {
			if (token.isCancellationRequested) {
				resolve(undefined);
				return;
			}
			const input = this.createInputBox();
			const validateInput = options.validateInput || (() => <Promise<undefined>>Promise.resolve(undefined));
			const onDidValueChange = Event.debounce(input.onDidChangeValue, (last, cur) => cur, 100);
			let validationValue = options.value || '';
			let validation = Promise.resolve(validateInput(validationValue));
			const disposables = [
				input,
				onDidValueChange(value => {
					if (value !== validationValue) {
						validation = Promise.resolve(validateInput(value));
						validationValue = value;
					}
					validation.then(result => {
						if (value === validationValue) {
							this.setValidationOnInput(input, result);
						}
					});
				}),
				input.onDidAccept(() => {
					const value = input.value;
					if (value !== validationValue) {
						validation = Promise.resolve(validateInput(value));
						validationValue = value;
					}
					validation.then(result => {
						if (!result || (!isString(result) && result.severity !== Severity.Error)) {
							resolve(value);
							input.hide();
						} else if (value === validationValue) {
							this.setValidationOnInput(input, result);
						}
					});
				}),
				token.onCancellationRequested(() => {
					input.hide();
				}),
				input.onDidHide(() => {
					dispose(disposables);
					resolve(undefined);
				}),
			];

			input.title = options.title;
			input.value = options.value || '';
			input.valueSelection = options.valueSelection;
			input.prompt = options.prompt;
			input.placeholder = options.placeHolder;
			input.password = !!options.password;
			input.ignoreFocusOut = !!options.ignoreFocusLost;
			input.show();
		});
	}

	backButton = backButton;

	createQuickPick<T extends IQuickPickItem>(): IQuickPick<T> {
		const ui = this.getUI();
		return new QuickPick<T>(ui);
	}

	createInputBox(): IInputBox {
		const ui = this.getUI();
		return new InputBox(ui);
	}

	private show(controller: QuickInput) {
		const ui = this.getUI();
		this.onShowEmitter.fire();
		const oldController = this.controller;
		this.controller = controller;
		if (oldController) {
			oldController.didHide();
		}

		this.setEnabled(true);
		ui.leftActionBar.clear();
		ui.title.textContent = '';
		ui.description1.textContent = '';
		ui.description2.textContent = '';
		ui.rightActionBar.clear();
		ui.checkAll.checked = false;
		// ui.inputBox.value = ''; Avoid triggering an event.
		ui.inputBox.placeholder = '';
		ui.inputBox.password = false;
		ui.inputBox.showDecoration(Severity.Ignore);
		ui.visibleCount.setCount(0);
		ui.count.setCount(0);
		dom.reset(ui.message);
		ui.progressBar.stop();
		ui.list.setElements([]);
		ui.list.matchOnDescription = false;
		ui.list.matchOnDetail = false;
		ui.list.matchOnLabel = true;
		ui.list.sortByLabel = true;
		ui.ignoreFocusOut = false;
		this.setComboboxAccessibility(false);
		ui.inputBox.ariaLabel = '';

		const backKeybindingLabel = this.options.backKeybindingLabel();
		backButton.tooltip = backKeybindingLabel ? localize('quickInput.backWithKeybinding', "Back ({0})", backKeybindingLabel) : localize('quickInput.back', "Back");

		ui.container.style.display = '';
		this.updateLayout();
		ui.inputBox.setFocus();
	}

	private setVisibilities(visibilities: Visibilities) {
		const ui = this.getUI();
		ui.title.style.display = visibilities.title ? '' : 'none';
		ui.description1.style.display = visibilities.description && (visibilities.inputBox || visibilities.checkAll) ? '' : 'none';
		ui.description2.style.display = visibilities.description && !(visibilities.inputBox || visibilities.checkAll) ? '' : 'none';
		ui.checkAll.style.display = visibilities.checkAll ? '' : 'none';
		ui.filterContainer.style.display = visibilities.inputBox ? '' : 'none';
		ui.visibleCountContainer.style.display = visibilities.visibleCount ? '' : 'none';
		ui.countContainer.style.display = visibilities.count ? '' : 'none';
		ui.okContainer.style.display = visibilities.ok ? '' : 'none';
		ui.customButtonContainer.style.display = visibilities.customButton ? '' : 'none';
		ui.message.style.display = visibilities.message ? '' : 'none';
		ui.progressBar.getContainer().style.display = visibilities.progressBar ? '' : 'none';
		ui.list.display(!!visibilities.list);
		ui.container.classList[visibilities.checkBox ? 'add' : 'remove']('show-checkboxes');
		this.updateLayout(); // TODO
	}

	private setComboboxAccessibility(enabled: boolean) {
		if (enabled !== this.comboboxAccessibility) {
			const ui = this.getUI();
			this.comboboxAccessibility = enabled;
			if (this.comboboxAccessibility) {
				ui.inputBox.setAttribute('role', 'combobox');
				ui.inputBox.setAttribute('aria-haspopup', 'true');
				ui.inputBox.setAttribute('aria-autocomplete', 'list');
				ui.inputBox.setAttribute('aria-activedescendant', ui.list.getActiveDescendant() || '');
			} else {
				ui.inputBox.removeAttribute('role');
				ui.inputBox.removeAttribute('aria-haspopup');
				ui.inputBox.removeAttribute('aria-autocomplete');
				ui.inputBox.removeAttribute('aria-activedescendant');
			}
		}
	}

	private setEnabled(enabled: boolean) {
		if (enabled !== this.enabled) {
			this.enabled = enabled;
			for (const item of this.getUI().leftActionBar.viewItems) {
				(item as ActionViewItem).getAction().enabled = enabled;
			}
			for (const item of this.getUI().rightActionBar.viewItems) {
				(item as ActionViewItem).getAction().enabled = enabled;
			}
			this.getUI().checkAll.disabled = !enabled;
			// this.getUI().inputBox.enabled = enabled; Avoid loosing focus.
			this.getUI().ok.enabled = enabled;
			this.getUI().list.enabled = enabled;
		}
	}

	hide(reason?: QuickInputHideReason) {
		const controller = this.controller;
		if (controller) {
			const focusChanged = !this.ui?.container.contains(document.activeElement);
			this.controller = null;
			this.onHideEmitter.fire();
			this.getUI().container.style.display = 'none';
			if (!focusChanged) {
				if (this.previousFocusElement && this.previousFocusElement.offsetParent) {
					this.previousFocusElement.focus();
					this.previousFocusElement = undefined;
				} else {
					this.options.returnFocus();
				}
			}
			controller.didHide(reason);
		}
	}

	focus() {
		if (this.isDisplayed()) {
			this.getUI().inputBox.setFocus();
		}
	}

	toggle() {
		if (this.isDisplayed() && this.controller instanceof QuickPick && this.controller.canSelectMany) {
			this.getUI().list.toggleCheckbox();
		}
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration) {
		if (this.isDisplayed() && this.getUI().list.isDisplayed()) {
			this.getUI().list.focus(next ? QuickInputListFocus.Next : QuickInputListFocus.Previous);
			if (quickNavigate && this.controller instanceof QuickPick) {
				this.controller.quickNavigate = quickNavigate;
			}
		}
	}

	async accept(keyMods: IKeyMods = { alt: false, ctrlCmd: false }) {
		// When accepting the item programmatically, it is important that
		// we update `keyMods` either from the provided set or unset it
		// because the accept did not happen from mouse or keyboard
		// interaction on the list itself
		this.keyMods.alt = keyMods.alt;
		this.keyMods.ctrlCmd = keyMods.ctrlCmd;

		this.onDidAcceptEmitter.fire();
	}

	async back() {
		this.onDidTriggerButtonEmitter.fire(this.backButton);
	}

	async cancel() {
		this.hide();
	}

	layout(dimension: dom.IDimension, titleBarOffset: number): void {
		this.dimension = dimension;
		this.titleBarOffset = titleBarOffset;
		this.updateLayout();
	}

	private updateLayout() {
		if (this.ui) {
			this.ui.container.style.top = `${this.titleBarOffset}px`;

			const style = this.ui.container.style;
			const width = Math.min(this.dimension!.width * 0.62 /* golden cut */, QuickInputController.MAX_WIDTH);
			style.width = width + 'px';
			style.marginLeft = '-' + (width / 2) + 'px';

			this.ui.inputBox.layout();
			this.ui.list.layout(this.dimension && this.dimension.height * 0.4);
		}
	}

	applyStyles(styles: IQuickInputStyles) {
		this.styles = styles;
		this.updateStyles();
	}

	private updateStyles() {
		if (this.ui) {
			const {
				quickInputTitleBackground,
				quickInputBackground,
				quickInputForeground,
				contrastBorder,
				widgetShadow,
			} = this.styles.widget;
			this.ui.titleBar.style.backgroundColor = quickInputTitleBackground ? quickInputTitleBackground.toString() : '';
			this.ui.container.style.backgroundColor = quickInputBackground ? quickInputBackground.toString() : '';
			this.ui.container.style.color = quickInputForeground ? quickInputForeground.toString() : '';
			this.ui.container.style.border = contrastBorder ? `1px solid ${contrastBorder}` : '';
			this.ui.container.style.boxShadow = widgetShadow ? `0 0 8px 2px ${widgetShadow}` : '';
			this.ui.inputBox.style(this.styles.inputBox);
			this.ui.count.style(this.styles.countBadge);
			this.ui.ok.style(this.styles.button);
			this.ui.customButton.style(this.styles.button);
			this.ui.progressBar.style(this.styles.progressBar);
			this.ui.list.style(this.styles.list);

			const content: string[] = [];
			if (this.styles.list.pickerGroupBorder) {
				content.push(`.quick-input-list .quick-input-list-entry { border-top-color:  ${this.styles.list.pickerGroupBorder}; }`);
			}
			if (this.styles.list.pickerGroupForeground) {
				content.push(`.quick-input-list .quick-input-list-separator { color:  ${this.styles.list.pickerGroupForeground}; }`);
			}

			if (
				this.styles.keybindingLabel.keybindingLabelBackground ||
				this.styles.keybindingLabel.keybindingLabelBorder ||
				this.styles.keybindingLabel.keybindingLabelBottomBorder ||
				this.styles.keybindingLabel.keybindingLabelShadow ||
				this.styles.keybindingLabel.keybindingLabelForeground
			) {
				content.push('.quick-input-list .monaco-keybinding > .monaco-keybinding-key {');
				if (this.styles.keybindingLabel.keybindingLabelBackground) {
					content.push(`background-color: ${this.styles.keybindingLabel.keybindingLabelBackground};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelBorder) {
					// Order matters here. `border-color` must come before `border-bottom-color`.
					content.push(`border-color: ${this.styles.keybindingLabel.keybindingLabelBorder};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelBottomBorder) {
					content.push(`border-bottom-color: ${this.styles.keybindingLabel.keybindingLabelBottomBorder};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelShadow) {
					content.push(`box-shadow: inset 0 -1px 0 ${this.styles.keybindingLabel.keybindingLabelShadow};`);
				}
				if (this.styles.keybindingLabel.keybindingLabelForeground) {
					content.push(`color: ${this.styles.keybindingLabel.keybindingLabelForeground};`);
				}
				content.push('}');
			}

			const newStyles = content.join('\n');
			if (newStyles !== this.ui.styleSheet.textContent) {
				this.ui.styleSheet.textContent = newStyles;
			}
		}
	}

	private isDisplayed() {
		return this.ui && this.ui.container.style.display !== 'none';
	}
}
