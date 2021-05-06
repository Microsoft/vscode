/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./menubar';
import * as browser from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import * as strings from 'vs/base/common/strings';
import * as nls from 'vs/nls';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventType, Gesture, GestureEvent } from 'vs/base/browser/touch';
import { cleanMnemonic, IMenuOptions, Menu, MENU_ESCAPED_MNEMONIC_REGEX, MENU_MNEMONIC_REGEX, IMenuStyles, Direction } from 'vs/base/browser/ui/menu/menu';
import { ActionRunner, IAction, IActionRunner, SubmenuAction, Separator } from 'vs/base/common/actions';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { KeyCode, ResolvedKeybinding, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { withNullAsUndefined } from 'vs/base/common/types';
import { asArray } from 'vs/base/common/arrays';
import { ScanCodeUtils, ScanCode } from 'vs/base/common/scanCode';
import { isMacintosh } from 'vs/base/common/platform';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { Codicon, registerCodicon } from 'vs/base/common/codicons';

const $ = DOM.$;

const menuBarMoreIcon = registerCodicon('menubar-more', Codicon.more);

export interface IMenuBarOptions {
	enableMnemonics?: boolean;
	disableAltFocus?: boolean;
	visibility?: string;
	getKeybinding?: (action: IAction) => ResolvedKeybinding | undefined;
	alwaysOnMnemonics?: boolean;
	compactMode?: Direction;
	getCompactMenuActions?: () => IAction[]
}

export interface MenuBarMenu {
	actions: IAction[];
	label: string;
}

enum MenubarState {
	HIDDEN,
	VISIBLE,
	FOCUSED,
	OPEN
}

export class MenuBar extends Disposable {

	static readonly OVERFLOW_INDEX: number = -1;

	private menuCache: {
		buttonElement: HTMLElement;
		titleElement: HTMLElement;
		label: string;
		actions?: IAction[];
	}[];

	private overflowMenu!: {
		buttonElement: HTMLElement;
		titleElement: HTMLElement;
		label: string;
		actions?: IAction[];
	};

	private focusedMenu: {
		index: number;
		holder?: HTMLElement;
		widget?: Menu;
	} | undefined;

	private focusToReturn: HTMLElement | undefined;
	private menuUpdater: RunOnceScheduler;

	// Input-related
	private _mnemonicsInUse: boolean = false;
	private openedViaKeyboard: boolean = false;
	private awaitingAltRelease: boolean = false;
	private ignoreNextMouseUp: boolean = false;
	private mnemonics: Map<string, number>;

	private updatePending: boolean = false;
	private _focusState: MenubarState;
	private actionRunner: IActionRunner;

	private readonly _onVisibilityChange: Emitter<boolean>;
	private readonly _onFocusStateChange: Emitter<boolean>;

	private numMenusShown: number = 0;
	private menuStyle: IMenuStyles | undefined;
	private overflowLayoutScheduled: IDisposable | undefined = undefined;

	constructor(private container: HTMLElement, private options: IMenuBarOptions = {}) {
		super();

		this.container.setAttribute('role', 'menubar');
		if (this.options.compactMode !== undefined) {
			this.container.classList.add('compact');
		}

		this.menuCache = [];
		this.mnemonics = new Map<string, number>();

		this._focusState = MenubarState.VISIBLE;

		this._onVisibilityChange = this._register(new Emitter<boolean>());
		this._onFocusStateChange = this._register(new Emitter<boolean>());

		this.createOverflowMenu();

		this.menuUpdater = this._register(new RunOnceScheduler(() => this.update(), 200));

		this.actionRunner = this._register(new ActionRunner());
		this._register(this.actionRunner.onBeforeRun(() => {
			this.setUnfocusedState();
		}));

		this._register(DOM.ModifierKeyEmitter.getInstance().event(this.onModifierKeyToggled, this));

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.KEY_DOWN, (e) => {
			let event = new StandardKeyboardEvent(e as KeyboardEvent);
			let eventHandled = true;
			const key = !!e.key ? e.key.toLocaleLowerCase() : '';

			const tabNav = isMacintosh && this.options.compactMode === undefined;

			if (event.equals(KeyCode.LeftArrow) || (tabNav && event.equals(KeyCode.Tab | KeyMod.Shift))) {
				this.focusPrevious();
			} else if (event.equals(KeyCode.RightArrow) || (tabNav && event.equals(KeyCode.Tab))) {
				this.focusNext();
			} else if (event.equals(KeyCode.Escape) && this.isFocused && !this.isOpen) {
				this.setUnfocusedState();
			} else if (!this.isOpen && !event.ctrlKey && this.options.enableMnemonics && this.mnemonicsInUse && this.mnemonics.has(key)) {
				const menuIndex = this.mnemonics.get(key)!;
				this.onMenuTriggered(menuIndex, false);
			} else {
				eventHandled = false;
			}

			// Never allow default tab behavior when not compact
			if (this.options.compactMode === undefined && (event.equals(KeyCode.Tab | KeyMod.Shift) || event.equals(KeyCode.Tab))) {
				event.preventDefault();
			}

			if (eventHandled) {
				event.preventDefault();
				event.stopPropagation();
			}
		}));

		this._register(DOM.addDisposableListener(window, DOM.EventType.MOUSE_DOWN, () => {
			// This mouse event is outside the menubar so it counts as a focus out
			if (this.isFocused) {
				this.setUnfocusedState();
			}
		}));

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.FOCUS_IN, (e) => {
			let event = e as FocusEvent;

			if (event.relatedTarget) {
				if (!this.container.contains(event.relatedTarget as HTMLElement)) {
					this.focusToReturn = event.relatedTarget as HTMLElement;
				}
			}
		}));

		this._register(DOM.addDisposableListener(this.container, DOM.EventType.FOCUS_OUT, (e) => {
			let event = e as FocusEvent;

			// We are losing focus and there is no related target, e.g. webview case
			if (!event.relatedTarget) {
				this.setUnfocusedState();
			}
			// We are losing focus and there is a target, reset focusToReturn value as not to redirect
			else if (event.relatedTarget && !this.container.contains(event.relatedTarget as HTMLElement)) {
				this.focusToReturn = undefined;
				this.setUnfocusedState();
			}
		}));

		this._register(DOM.addDisposableListener(window, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (!this.options.enableMnemonics || !e.altKey || e.ctrlKey || e.defaultPrevented) {
				return;
			}

			const key = e.key.toLocaleLowerCase();
			if (!this.mnemonics.has(key)) {
				return;
			}

			this.mnemonicsInUse = true;
			this.updateMnemonicVisibility(true);

			const menuIndex = this.mnemonics.get(key)!;
			this.onMenuTriggered(menuIndex, false);
		}));

		this.setUnfocusedState();
	}

	push(arg: MenuBarMenu | MenuBarMenu[]): void {
		const menus: MenuBarMenu[] = asArray(arg);

		menus.forEach((menuBarMenu) => {
			const menuIndex = this.menuCache.length;
			const cleanMenuLabel = cleanMnemonic(menuBarMenu.label);

			const buttonElement = $('div.menubar-menu-button', { 'role': 'menuitem', 'tabindex': -1, 'aria-label': cleanMenuLabel, 'aria-haspopup': true });
			const titleElement = $('div.menubar-menu-title', { 'role': 'none', 'aria-hidden': true });

			buttonElement.appendChild(titleElement);
			this.container.insertBefore(buttonElement, this.overflowMenu.buttonElement);

			let mnemonicMatches = MENU_MNEMONIC_REGEX.exec(menuBarMenu.label);

			// Register mnemonics
			if (mnemonicMatches) {
				let mnemonic = !!mnemonicMatches[1] ? mnemonicMatches[1] : mnemonicMatches[3];

				this.registerMnemonic(this.menuCache.length, mnemonic);
			}

			this.updateLabels(titleElement, buttonElement, menuBarMenu.label);

			this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.KEY_UP, (e) => {
				let event = new StandardKeyboardEvent(e as KeyboardEvent);
				let eventHandled = true;

				if ((event.equals(KeyCode.DownArrow) || event.equals(KeyCode.Enter)) && !this.isOpen) {
					this.focusedMenu = { index: menuIndex };
					this.openedViaKeyboard = true;
					this.focusState = MenubarState.OPEN;
				} else {
					eventHandled = false;
				}

				if (eventHandled) {
					event.preventDefault();
					event.stopPropagation();
				}
			}));

			this._register(Gesture.addTarget(buttonElement));
			this._register(DOM.addDisposableListener(buttonElement, EventType.Tap, (e: GestureEvent) => {
				// Ignore this touch if the menu is touched
				if (this.isOpen && this.focusedMenu && this.focusedMenu.holder && DOM.isAncestor(e.initialTarget as HTMLElement, this.focusedMenu.holder)) {
					return;
				}

				this.ignoreNextMouseUp = false;
				this.onMenuTriggered(menuIndex, true);

				e.preventDefault();
				e.stopPropagation();
			}));

			this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.MOUSE_DOWN, (e: MouseEvent) => {
				// Ignore non-left-click
				const mouseEvent = new StandardMouseEvent(e);
				if (!mouseEvent.leftButton) {
					e.preventDefault();
					return;
				}

				if (!this.isOpen) {
					// Open the menu with mouse down and ignore the following mouse up event
					this.ignoreNextMouseUp = true;
					this.onMenuTriggered(menuIndex, true);
				} else {
					this.ignoreNextMouseUp = false;
				}

				e.preventDefault();
				e.stopPropagation();
			}));

			this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.MOUSE_UP, (e) => {
				if (e.defaultPrevented) {
					return;
				}

				if (!this.ignoreNextMouseUp) {
					if (this.isFocused) {
						this.onMenuTriggered(menuIndex, true);
					}
				} else {
					this.ignoreNextMouseUp = false;
				}
			}));

			this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.MOUSE_ENTER, () => {
				if (this.isOpen && !this.isCurrentMenu(menuIndex)) {
					this.menuCache[menuIndex].buttonElement.focus();
					this.cleanupCustomMenu();
					this.showCustomMenu(menuIndex, false);
				} else if (this.isFocused && !this.isOpen) {
					this.focusedMenu = { index: menuIndex };
					buttonElement.focus();
				}
			}));

			this.menuCache.push({
				label: menuBarMenu.label,
				actions: menuBarMenu.actions,
				buttonElement: buttonElement,
				titleElement: titleElement
			});
		});
	}

	createOverflowMenu(): void {
		const label = this.options.compactMode !== undefined ? nls.localize('mAppMenu', 'Application Menu') : nls.localize('mMore', 'More');
		const title = this.options.compactMode !== undefined ? label : undefined;
		const buttonElement = $('div.menubar-menu-button', { 'role': 'menuitem', 'tabindex': this.options.compactMode !== undefined ? 0 : -1, 'aria-label': label, 'title': title, 'aria-haspopup': true });
		const titleElement = $('div.menubar-menu-title.toolbar-toggle-more' + menuBarMoreIcon.cssSelector, { 'role': 'none', 'aria-hidden': true });

		buttonElement.appendChild(titleElement);
		this.container.appendChild(buttonElement);
		buttonElement.style.visibility = 'hidden';

		this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.KEY_UP, (e) => {
			let event = new StandardKeyboardEvent(e as KeyboardEvent);
			let eventHandled = true;

			const triggerKeys = [KeyCode.Enter];
			if (this.options.compactMode === undefined) {
				triggerKeys.push(KeyCode.DownArrow);
			} else {
				triggerKeys.push(KeyCode.Space);
				triggerKeys.push(this.options.compactMode === Direction.Right ? KeyCode.RightArrow : KeyCode.LeftArrow);
			}

			if ((triggerKeys.some(k => event.equals(k)) && !this.isOpen)) {
				this.focusedMenu = { index: MenuBar.OVERFLOW_INDEX };
				this.openedViaKeyboard = true;
				this.focusState = MenubarState.OPEN;
			} else {
				eventHandled = false;
			}

			if (eventHandled) {
				event.preventDefault();
				event.stopPropagation();
			}
		}));

		this._register(Gesture.addTarget(buttonElement));
		this._register(DOM.addDisposableListener(buttonElement, EventType.Tap, (e: GestureEvent) => {
			// Ignore this touch if the menu is touched
			if (this.isOpen && this.focusedMenu && this.focusedMenu.holder && DOM.isAncestor(e.initialTarget as HTMLElement, this.focusedMenu.holder)) {
				return;
			}

			this.ignoreNextMouseUp = false;
			this.onMenuTriggered(MenuBar.OVERFLOW_INDEX, true);

			e.preventDefault();
			e.stopPropagation();
		}));

		this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.MOUSE_DOWN, (e) => {
			// Ignore non-left-click
			const mouseEvent = new StandardMouseEvent(e);
			if (!mouseEvent.leftButton) {
				e.preventDefault();
				return;
			}

			if (!this.isOpen) {
				// Open the menu with mouse down and ignore the following mouse up event
				this.ignoreNextMouseUp = true;
				this.onMenuTriggered(MenuBar.OVERFLOW_INDEX, true);
			} else {
				this.ignoreNextMouseUp = false;
			}

			e.preventDefault();
			e.stopPropagation();
		}));

		this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.MOUSE_UP, (e) => {
			if (e.defaultPrevented) {
				return;
			}

			if (!this.ignoreNextMouseUp) {
				if (this.isFocused) {
					this.onMenuTriggered(MenuBar.OVERFLOW_INDEX, true);
				}
			} else {
				this.ignoreNextMouseUp = false;
			}
		}));

		this._register(DOM.addDisposableListener(buttonElement, DOM.EventType.MOUSE_ENTER, () => {
			if (this.isOpen && !this.isCurrentMenu(MenuBar.OVERFLOW_INDEX)) {
				this.overflowMenu.buttonElement.focus();
				this.cleanupCustomMenu();
				this.showCustomMenu(MenuBar.OVERFLOW_INDEX, false);
			} else if (this.isFocused && !this.isOpen) {
				this.focusedMenu = { index: MenuBar.OVERFLOW_INDEX };
				buttonElement.focus();
			}
		}));

		this.overflowMenu = {
			buttonElement: buttonElement,
			titleElement: titleElement,
			label: 'More'
		};
	}

	updateMenu(menu: MenuBarMenu): void {
		const menuToUpdate = this.menuCache.filter(menuBarMenu => menuBarMenu.label === menu.label);
		if (menuToUpdate && menuToUpdate.length) {
			menuToUpdate[0].actions = menu.actions;
		}
	}

	override dispose(): void {
		super.dispose();

		this.menuCache.forEach(menuBarMenu => {
			menuBarMenu.titleElement.remove();
			menuBarMenu.buttonElement.remove();
		});

		this.overflowMenu.titleElement.remove();
		this.overflowMenu.buttonElement.remove();

		dispose(this.overflowLayoutScheduled);
		this.overflowLayoutScheduled = undefined;
	}

	blur(): void {
		this.setUnfocusedState();
	}

	getWidth(): number {
		if (this.menuCache) {
			const left = this.menuCache[0].buttonElement.getBoundingClientRect().left;
			const right = this.hasOverflow ? this.overflowMenu.buttonElement.getBoundingClientRect().right : this.menuCache[this.menuCache.length - 1].buttonElement.getBoundingClientRect().right;
			return right - left;
		}

		return 0;
	}

	getHeight(): number {
		return this.container.clientHeight;
	}

	toggleFocus(): void {
		if (!this.isFocused && this.options.visibility !== 'hidden') {
			this.mnemonicsInUse = true;
			this.focusedMenu = { index: this.numMenusShown > 0 ? 0 : MenuBar.OVERFLOW_INDEX };
			this.focusState = MenubarState.FOCUSED;
		} else if (!this.isOpen) {
			this.setUnfocusedState();
		}
	}

	private updateOverflowAction(): void {
		if (!this.menuCache || !this.menuCache.length) {
			return;
		}

		const sizeAvailable = this.container.offsetWidth;
		let currentSize = 0;
		let full = this.options.compactMode !== undefined;
		const prevNumMenusShown = this.numMenusShown;
		this.numMenusShown = 0;
		for (let menuBarMenu of this.menuCache) {
			if (!full) {
				const size = menuBarMenu.buttonElement.offsetWidth;
				if (currentSize + size > sizeAvailable) {
					full = true;
				} else {
					currentSize += size;
					this.numMenusShown++;
					if (this.numMenusShown > prevNumMenusShown) {
						menuBarMenu.buttonElement.style.visibility = 'visible';
					}
				}
			}

			if (full) {
				menuBarMenu.buttonElement.style.visibility = 'hidden';
			}
		}

		// Overflow
		if (full) {
			// Can't fit the more button, need to remove more menus
			while (currentSize + this.overflowMenu.buttonElement.offsetWidth > sizeAvailable && this.numMenusShown > 0) {
				this.numMenusShown--;
				const size = this.menuCache[this.numMenusShown].buttonElement.offsetWidth;
				this.menuCache[this.numMenusShown].buttonElement.style.visibility = 'hidden';
				currentSize -= size;
			}

			this.overflowMenu.actions = [];
			for (let idx = this.numMenusShown; idx < this.menuCache.length; idx++) {
				this.overflowMenu.actions.push(new SubmenuAction(`menubar.submenu.${this.menuCache[idx].label}`, this.menuCache[idx].label, this.menuCache[idx].actions || []));
			}

			if (this.overflowMenu.buttonElement.nextElementSibling !== this.menuCache[this.numMenusShown].buttonElement) {
				this.overflowMenu.buttonElement.remove();
				this.container.insertBefore(this.overflowMenu.buttonElement, this.menuCache[this.numMenusShown].buttonElement);
				this.overflowMenu.buttonElement.style.visibility = 'visible';
			}

			const compactMenuActions = this.options.getCompactMenuActions?.();
			if (compactMenuActions && compactMenuActions.length) {
				this.overflowMenu.actions.push(new Separator());
				this.overflowMenu.actions.push(...compactMenuActions);
			}
		} else {
			this.overflowMenu.buttonElement.remove();
			this.container.appendChild(this.overflowMenu.buttonElement);
			this.overflowMenu.buttonElement.style.visibility = 'hidden';
		}
	}

	private updateLabels(titleElement: HTMLElement, buttonElement: HTMLElement, label: string): void {
		const cleanMenuLabel = cleanMnemonic(label);

		// Update the button label to reflect mnemonics

		if (this.options.enableMnemonics) {
			let cleanLabel = strings.escape(label);

			// This is global so reset it
			MENU_ESCAPED_MNEMONIC_REGEX.lastIndex = 0;
			let escMatch = MENU_ESCAPED_MNEMONIC_REGEX.exec(cleanLabel);

			// We can't use negative lookbehind so we match our negative and skip
			while (escMatch && escMatch[1]) {
				escMatch = MENU_ESCAPED_MNEMONIC_REGEX.exec(cleanLabel);
			}

			const replaceDoubleEscapes = (str: string) => str.replace(/&amp;&amp;/g, '&amp;');

			if (escMatch) {
				titleElement.innerText = '';
				titleElement.append(
					strings.ltrim(replaceDoubleEscapes(cleanLabel.substr(0, escMatch.index)), ' '),
					$('mnemonic', { 'aria-hidden': 'true' }, escMatch[3]),
					strings.rtrim(replaceDoubleEscapes(cleanLabel.substr(escMatch.index + escMatch[0].length)), ' ')
				);
			} else {
				titleElement.innerText = replaceDoubleEscapes(cleanLabel).trim();
			}
		} else {
			titleElement.innerText = cleanMenuLabel.replace(/&&/g, '&');
		}

		let mnemonicMatches = MENU_MNEMONIC_REGEX.exec(label);

		// Register mnemonics
		if (mnemonicMatches) {
			let mnemonic = !!mnemonicMatches[1] ? mnemonicMatches[1] : mnemonicMatches[3];

			if (this.options.enableMnemonics) {
				buttonElement.setAttribute('aria-keyshortcuts', 'Alt+' + mnemonic.toLocaleLowerCase());
			} else {
				buttonElement.removeAttribute('aria-keyshortcuts');
			}
		}
	}

	style(style: IMenuStyles): void {
		this.menuStyle = style;
	}

	update(options?: IMenuBarOptions): void {
		if (options) {
			this.options = options;
		}

		// Don't update while using the menu
		if (this.isFocused) {
			this.updatePending = true;
			return;
		}

		this.menuCache.forEach(menuBarMenu => {
			this.updateLabels(menuBarMenu.titleElement, menuBarMenu.buttonElement, menuBarMenu.label);
		});

		if (!this.overflowLayoutScheduled) {
			this.overflowLayoutScheduled = DOM.scheduleAtNextAnimationFrame(() => {
				this.updateOverflowAction();
				this.overflowLayoutScheduled = undefined;
			});
		}

		this.setUnfocusedState();
	}

	private registerMnemonic(menuIndex: number, mnemonic: string): void {
		this.mnemonics.set(mnemonic.toLocaleLowerCase(), menuIndex);
	}

	private hideMenubar(): void {
		if (this.container.style.display !== 'none') {
			this.container.style.display = 'none';
			this._onVisibilityChange.fire(false);
		}
	}

	private showMenubar(): void {
		if (this.container.style.display !== 'flex') {
			this.container.style.display = 'flex';
			this._onVisibilityChange.fire(true);

			this.updateOverflowAction();
		}
	}

	private get focusState(): MenubarState {
		return this._focusState;
	}

	private set focusState(value: MenubarState) {
		if (this._focusState >= MenubarState.FOCUSED && value < MenubarState.FOCUSED) {
			// Losing focus, update the menu if needed

			if (this.updatePending) {
				this.menuUpdater.schedule();
				this.updatePending = false;
			}
		}

		if (value === this._focusState) {
			return;
		}

		const isVisible = this.isVisible;
		const isOpen = this.isOpen;
		const isFocused = this.isFocused;

		this._focusState = value;

		switch (value) {
			case MenubarState.HIDDEN:
				if (isVisible) {
					this.hideMenubar();
				}

				if (isOpen) {
					this.cleanupCustomMenu();
				}

				if (isFocused) {
					this.focusedMenu = undefined;

					if (this.focusToReturn) {
						this.focusToReturn.focus();
						this.focusToReturn = undefined;
					}
				}


				break;
			case MenubarState.VISIBLE:
				if (!isVisible) {
					this.showMenubar();
				}

				if (isOpen) {
					this.cleanupCustomMenu();
				}

				if (isFocused) {
					if (this.focusedMenu) {
						if (this.focusedMenu.index === MenuBar.OVERFLOW_INDEX) {
							this.overflowMenu.buttonElement.blur();
						} else {
							this.menuCache[this.focusedMenu.index].buttonElement.blur();
						}
					}

					this.focusedMenu = undefined;

					if (this.focusToReturn) {
						this.focusToReturn.focus();
						this.focusToReturn = undefined;
					}
				}

				break;
			case MenubarState.FOCUSED:
				if (!isVisible) {
					this.showMenubar();
				}

				if (isOpen) {
					this.cleanupCustomMenu();
				}

				if (this.focusedMenu) {
					if (this.focusedMenu.index === MenuBar.OVERFLOW_INDEX) {
						this.overflowMenu.buttonElement.focus();
					} else {
						this.menuCache[this.focusedMenu.index].buttonElement.focus();
					}
				}
				break;
			case MenubarState.OPEN:
				if (!isVisible) {
					this.showMenubar();
				}

				if (this.focusedMenu) {
					this.showCustomMenu(this.focusedMenu.index, this.openedViaKeyboard);
				}
				break;
		}

		this._focusState = value;
		this._onFocusStateChange.fire(this.focusState >= MenubarState.FOCUSED);
	}

	private get isVisible(): boolean {
		return this.focusState >= MenubarState.VISIBLE;
	}

	private get isFocused(): boolean {
		return this.focusState >= MenubarState.FOCUSED;
	}

	private get isOpen(): boolean {
		return this.focusState >= MenubarState.OPEN;
	}

	private get hasOverflow(): boolean {
		return this.numMenusShown < this.menuCache.length;
	}

	private setUnfocusedState(): void {
		if (this.options.visibility === 'toggle' || this.options.visibility === 'hidden') {
			this.focusState = MenubarState.HIDDEN;
		} else if (this.options.visibility === 'classic' && browser.isFullscreen()) {
			this.focusState = MenubarState.HIDDEN;
		} else {
			this.focusState = MenubarState.VISIBLE;
		}

		this.ignoreNextMouseUp = false;
		this.mnemonicsInUse = false;
		this.updateMnemonicVisibility(false);
	}

	private focusPrevious(): void {

		if (!this.focusedMenu || this.numMenusShown === 0) {
			return;
		}


		let newFocusedIndex = (this.focusedMenu.index - 1 + this.numMenusShown) % this.numMenusShown;
		if (this.focusedMenu.index === MenuBar.OVERFLOW_INDEX) {
			newFocusedIndex = this.numMenusShown - 1;
		} else if (this.focusedMenu.index === 0 && this.hasOverflow) {
			newFocusedIndex = MenuBar.OVERFLOW_INDEX;
		}

		if (newFocusedIndex === this.focusedMenu.index) {
			return;
		}

		if (this.isOpen) {
			this.cleanupCustomMenu();
			this.showCustomMenu(newFocusedIndex);
		} else if (this.isFocused) {
			this.focusedMenu.index = newFocusedIndex;
			if (newFocusedIndex === MenuBar.OVERFLOW_INDEX) {
				this.overflowMenu.buttonElement.focus();
			} else {
				this.menuCache[newFocusedIndex].buttonElement.focus();
			}
		}
	}

	private focusNext(): void {
		if (!this.focusedMenu || this.numMenusShown === 0) {
			return;
		}

		let newFocusedIndex = (this.focusedMenu.index + 1) % this.numMenusShown;
		if (this.focusedMenu.index === MenuBar.OVERFLOW_INDEX) {
			newFocusedIndex = 0;
		} else if (this.focusedMenu.index === this.numMenusShown - 1) {
			newFocusedIndex = MenuBar.OVERFLOW_INDEX;
		}

		if (newFocusedIndex === this.focusedMenu.index) {
			return;
		}

		if (this.isOpen) {
			this.cleanupCustomMenu();
			this.showCustomMenu(newFocusedIndex);
		} else if (this.isFocused) {
			this.focusedMenu.index = newFocusedIndex;
			if (newFocusedIndex === MenuBar.OVERFLOW_INDEX) {
				this.overflowMenu.buttonElement.focus();
			} else {
				this.menuCache[newFocusedIndex].buttonElement.focus();
			}
		}
	}

	private updateMnemonicVisibility(visible: boolean): void {
		if (this.menuCache) {
			this.menuCache.forEach(menuBarMenu => {
				if (menuBarMenu.titleElement.children.length) {
					let child = menuBarMenu.titleElement.children.item(0) as HTMLElement;
					if (child) {
						child.style.textDecoration = (this.options.alwaysOnMnemonics || visible) ? 'underline' : '';
					}
				}
			});
		}
	}

	private get mnemonicsInUse(): boolean {
		return this._mnemonicsInUse;
	}

	private set mnemonicsInUse(value: boolean) {
		this._mnemonicsInUse = value;
	}

	private get shouldAltKeyFocus(): boolean {
		if (isMacintosh) {
			return false;
		}

		if (!this.options.disableAltFocus) {
			return true;
		}

		if (this.options.visibility === 'toggle') {
			return true;
		}

		return false;
	}

	public get onVisibilityChange(): Event<boolean> {
		return this._onVisibilityChange.event;
	}

	public get onFocusStateChange(): Event<boolean> {
		return this._onFocusStateChange.event;
	}

	private onMenuTriggered(menuIndex: number, clicked: boolean) {
		if (this.isOpen) {
			if (this.isCurrentMenu(menuIndex)) {
				this.setUnfocusedState();
			} else {
				this.cleanupCustomMenu();
				this.showCustomMenu(menuIndex, this.openedViaKeyboard);
			}
		} else {
			this.focusedMenu = { index: menuIndex };
			this.openedViaKeyboard = !clicked;
			this.focusState = MenubarState.OPEN;
		}
	}

	private onModifierKeyToggled(modifierKeyStatus: DOM.IModifierKeyStatus): void {
		const allModifiersReleased = !modifierKeyStatus.altKey && !modifierKeyStatus.ctrlKey && !modifierKeyStatus.shiftKey && !modifierKeyStatus.metaKey;

		if (this.options.visibility === 'hidden') {
			return;
		}

		// Prevent alt-key default if the menu is not hidden and we use alt to focus
		if (modifierKeyStatus.event && this.shouldAltKeyFocus) {
			if (ScanCodeUtils.toEnum(modifierKeyStatus.event.code) === ScanCode.AltLeft) {
				modifierKeyStatus.event.preventDefault();
			}
		}

		// Alt key pressed while menu is focused. This should return focus away from the menubar
		if (this.isFocused && modifierKeyStatus.lastKeyPressed === 'alt' && modifierKeyStatus.altKey) {
			this.setUnfocusedState();
			this.mnemonicsInUse = false;
			this.awaitingAltRelease = true;
		}

		// Clean alt key press and release
		if (allModifiersReleased && modifierKeyStatus.lastKeyPressed === 'alt' && modifierKeyStatus.lastKeyReleased === 'alt') {
			if (!this.awaitingAltRelease) {
				if (!this.isFocused && this.shouldAltKeyFocus) {
					this.mnemonicsInUse = true;
					this.focusedMenu = { index: this.numMenusShown > 0 ? 0 : MenuBar.OVERFLOW_INDEX };
					this.focusState = MenubarState.FOCUSED;
				} else if (!this.isOpen) {
					this.setUnfocusedState();
				}
			}
		}

		// Alt key released
		if (!modifierKeyStatus.altKey && modifierKeyStatus.lastKeyReleased === 'alt') {
			this.awaitingAltRelease = false;
		}

		if (this.options.enableMnemonics && this.menuCache && !this.isOpen) {
			this.updateMnemonicVisibility((!this.awaitingAltRelease && modifierKeyStatus.altKey) || this.mnemonicsInUse);
		}
	}

	private isCurrentMenu(menuIndex: number): boolean {
		if (!this.focusedMenu) {
			return false;
		}

		return this.focusedMenu.index === menuIndex;
	}

	private cleanupCustomMenu(): void {
		if (this.focusedMenu) {
			// Remove focus from the menus first
			if (this.focusedMenu.index === MenuBar.OVERFLOW_INDEX) {
				this.overflowMenu.buttonElement.focus();
			} else {
				this.menuCache[this.focusedMenu.index].buttonElement.focus();
			}

			if (this.focusedMenu.holder) {
				if (this.focusedMenu.holder.parentElement) {
					this.focusedMenu.holder.parentElement.classList.remove('open');
				}

				this.focusedMenu.holder.remove();
			}

			if (this.focusedMenu.widget) {
				this.focusedMenu.widget.dispose();
			}

			this.focusedMenu = { index: this.focusedMenu.index };
		}
	}

	private showCustomMenu(menuIndex: number, selectFirst = true): void {
		const actualMenuIndex = menuIndex >= this.numMenusShown ? MenuBar.OVERFLOW_INDEX : menuIndex;
		const customMenu = actualMenuIndex === MenuBar.OVERFLOW_INDEX ? this.overflowMenu : this.menuCache[actualMenuIndex];

		if (!customMenu.actions) {
			return;
		}

		const menuHolder = $('div.menubar-menu-items-holder', { 'title': '' });

		customMenu.buttonElement.classList.add('open');

		const buttonBoundingRect = customMenu.buttonElement.getBoundingClientRect();

		if (this.options.compactMode === Direction.Right) {
			menuHolder.style.top = `${buttonBoundingRect.top}px`;
			menuHolder.style.left = `${buttonBoundingRect.left + this.container.clientWidth}px`;
		} else if (this.options.compactMode === Direction.Left) {
			menuHolder.style.top = `${buttonBoundingRect.top}px`;
			menuHolder.style.right = `${this.container.clientWidth}px`;
			menuHolder.style.left = 'auto';
		} else {
			menuHolder.style.top = `${buttonBoundingRect.bottom}px`;
			menuHolder.style.left = `${buttonBoundingRect.left}px`;
		}

		customMenu.buttonElement.appendChild(menuHolder);

		let menuOptions: IMenuOptions = {
			getKeyBinding: this.options.getKeybinding,
			actionRunner: this.actionRunner,
			enableMnemonics: this.options.alwaysOnMnemonics || (this.mnemonicsInUse && this.options.enableMnemonics),
			ariaLabel: withNullAsUndefined(customMenu.buttonElement.getAttribute('aria-label')),
			expandDirection: this.options.compactMode !== undefined ? this.options.compactMode : Direction.Right,
			useEventAsContext: true
		};

		let menuWidget = this._register(new Menu(menuHolder, customMenu.actions, menuOptions));
		if (this.menuStyle) {
			menuWidget.style(this.menuStyle);
		}

		this._register(menuWidget.onDidCancel(() => {
			this.focusState = MenubarState.FOCUSED;
		}));

		if (actualMenuIndex !== menuIndex) {
			menuWidget.trigger(menuIndex - this.numMenusShown);
		} else {
			menuWidget.focus(selectFirst);
		}

		this.focusedMenu = {
			index: actualMenuIndex,
			holder: menuHolder,
			widget: menuWidget
		};
	}
}
