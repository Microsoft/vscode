/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IMatch } from 'vs/base/common/filters';
import { IItemAccessor } from 'vs/base/common/fuzzyScorer';
import { Schemas } from 'vs/base/common/network';
import Severity from 'vs/base/common/severity';

export interface IQuickPickItemHighlights {
	label?: IMatch[];
	description?: IMatch[];
	detail?: IMatch[];
}

export interface IQuickPickItem {
	type?: 'item';
	id?: string;
	label: string;
	meta?: string;
	ariaLabel?: string;
	description?: string;
	detail?: string;
	/**
	 * Allows to show a keybinding next to the item to indicate
	 * how the item can be triggered outside of the picker using
	 * keyboard shortcut.
	 */
	keybinding?: ResolvedKeybinding;
	iconClasses?: string[];
	italic?: boolean;
	strikethrough?: boolean;
	highlights?: IQuickPickItemHighlights;
	buttons?: IQuickInputButton[];
	picked?: boolean;
	alwaysShow?: boolean;
}

export interface IQuickPickSeparator {
	type: 'separator';
	label?: string;
}

export interface IKeyMods {
	readonly ctrlCmd: boolean;
	readonly alt: boolean;
}

export const NO_KEY_MODS: IKeyMods = { ctrlCmd: false, alt: false };

export interface IQuickNavigateConfiguration {
	keybindings: ResolvedKeybinding[];
}

export interface IPickOptions<T extends IQuickPickItem> {

	/**
	 * an optional string to show as the title of the quick input
	 */
	title?: string;

	/**
	 * an optional string to show as placeholder in the input box to guide the user what she picks on
	 */
	placeHolder?: string;

	/**
	 * an optional flag to include the description when filtering the picks
	 */
	matchOnDescription?: boolean;

	/**
	 * an optional flag to include the detail when filtering the picks
	 */
	matchOnDetail?: boolean;

	/**
	 * an optional flag to filter the picks based on label. Defaults to true.
	 */
	matchOnLabel?: boolean;

	/**
	 * an option flag to control whether focus is always automatically brought to a list item. Defaults to true.
	 */
	autoFocusOnList?: boolean;

	/**
	 * an optional flag to not close the picker on focus lost
	 */
	ignoreFocusLost?: boolean;

	/**
	 * an optional flag to make this picker multi-select
	 */
	canPickMany?: boolean;

	/**
	 * enables quick navigate in the picker to open an element without typing
	 */
	quickNavigate?: IQuickNavigateConfiguration;

	/**
	 * a context key to set when this picker is active
	 */
	contextKey?: string;

	/**
	 * an optional property for the item to focus initially.
	 */
	activeItem?: Promise<T> | T;

	onKeyMods?: (keyMods: IKeyMods) => void;
	onDidFocus?: (entry: T) => void;
	onDidTriggerItemButton?: (context: IQuickPickItemButtonContext<T>) => void;
}

export interface IInputOptions {

	/**
	 * an optional string to show as the title of the quick input
	 */
	title?: string;

	/**
	 * the value to prefill in the input box
	 */
	value?: string;

	/**
	 * the selection of value, default to the whole word
	 */
	valueSelection?: [number, number];

	/**
	 * the text to display underneath the input box
	 */
	prompt?: string;

	/**
	 * an optional string to show as placeholder in the input box to guide the user what to type
	 */
	placeHolder?: string;

	/**
	 * Controls if a password input is shown. Password input hides the typed text.
	 */
	password?: boolean;

	ignoreFocusLost?: boolean;

	/**
	 * an optional function that is used to validate user input.
	 */
	validateInput?: (input: string) => Promise<string | null | undefined | { content: string, severity: Severity }>;
}

export enum QuickInputHideReason {

	/**
	 * Focus moved away from the quick input.
	 */
	Blur = 1,

	/**
	 * An explicit user gesture, e.g. pressing Escape key.
	 */
	Gesture,

	/**
	 * Anything else.
	 */
	Other
}

export interface IQuickInputHideEvent {
	reason: QuickInputHideReason;
}

export interface IQuickInput extends IDisposable {

	readonly onDidHide: Event<IQuickInputHideEvent>;
	readonly onDispose: Event<void>;

	title: string | undefined;

	description: string | undefined;

	step: number | undefined;

	totalSteps: number | undefined;

	enabled: boolean;

	contextKey: string | undefined;

	busy: boolean;

	ignoreFocusOut: boolean;

	show(): void;

	hide(): void;
}

export interface IQuickPickWillAcceptEvent {

	/**
	 * Allows to disable the default accept handling
	 * of the picker. If `veto` is called, the picker
	 * will not trigger the `onDidAccept` event.
	 */
	veto(): void;
}

export interface IQuickPickDidAcceptEvent {

	/**
	 * Signals if the picker item is to be accepted
	 * in the background while keeping the picker open.
	 */
	inBackground: boolean;
}

export enum ItemActivation {
	NONE,
	FIRST,
	SECOND,
	LAST
}

export interface IQuickPick<T extends IQuickPickItem> extends IQuickInput {

	value: string;

	/**
	 * A method that allows to massage the value used
	 * for filtering, e.g, to remove certain parts.
	 */
	filterValue: (value: string) => string;

	ariaLabel: string | undefined;

	placeholder: string | undefined;

	readonly onDidChangeValue: Event<string>;

	readonly onWillAccept: Event<IQuickPickWillAcceptEvent>;
	readonly onDidAccept: Event<IQuickPickDidAcceptEvent>;

	/**
	 * If enabled, will fire the `onDidAccept` event when
	 * pressing the arrow-right key with the idea of accepting
	 * the selected item without closing the picker.
	 */
	canAcceptInBackground: boolean;

	ok: boolean | 'default';

	readonly onDidCustom: Event<void>;

	customButton: boolean;

	customLabel: string | undefined;

	customHover: string | undefined;

	buttons: ReadonlyArray<IQuickInputButton>;

	readonly onDidTriggerButton: Event<IQuickInputButton>;

	readonly onDidTriggerItemButton: Event<IQuickPickItemButtonEvent<T>>;

	items: ReadonlyArray<T | IQuickPickSeparator>;

	canSelectMany: boolean;

	matchOnDescription: boolean;

	matchOnDetail: boolean;

	matchOnLabel: boolean;

	sortByLabel: boolean;

	autoFocusOnList: boolean;

	quickNavigate: IQuickNavigateConfiguration | undefined;

	activeItems: ReadonlyArray<T>;

	readonly onDidChangeActive: Event<T[]>;

	/**
	 * Allows to control which entry should be activated by default.
	 */
	itemActivation: ItemActivation;

	selectedItems: ReadonlyArray<T>;

	readonly onDidChangeSelection: Event<T[]>;

	readonly keyMods: IKeyMods;

	valueSelection: Readonly<[number, number]> | undefined;

	validationMessage: string | undefined;

	inputHasFocus(): boolean;

	focusOnInput(): void;

	/**
	 * Hides the input box from the picker UI. This is typically used
	 * in combination with quick-navigation where no search UI should
	 * be presented.
	 */
	hideInput: boolean;

	hideCheckAll: boolean;
}

export interface IInputBox extends IQuickInput {

	value: string;

	valueSelection: Readonly<[number, number]> | undefined;

	placeholder: string | undefined;

	password: boolean;

	readonly onDidChangeValue: Event<string>;

	readonly onDidAccept: Event<void>;

	buttons: ReadonlyArray<IQuickInputButton>;

	readonly onDidTriggerButton: Event<IQuickInputButton>;

	prompt: string | undefined;

	validationMessage: string | undefined;

	severity: Severity;
}

export interface IQuickInputButton {
	/** iconPath or iconClass required */
	iconPath?: { dark: URI; light?: URI; };
	/** iconPath or iconClass required */
	iconClass?: string;
	tooltip?: string;
	/**
	 * Whether to always show the button. By default buttons
	 * are only visible when hovering over them with the mouse
	 */
	alwaysVisible?: boolean;
}

export interface IQuickPickItemButtonEvent<T extends IQuickPickItem> {
	button: IQuickInputButton;
	item: T;
}

export interface IQuickPickItemButtonContext<T extends IQuickPickItem> extends IQuickPickItemButtonEvent<T> {
	removeItem(): void;
}

export type QuickPickInput<T = IQuickPickItem> = T | IQuickPickSeparator;


//#region Fuzzy Scorer Support

export type IQuickPickItemWithResource = IQuickPickItem & { resource?: URI };

export class QuickPickItemScorerAccessor implements IItemAccessor<IQuickPickItemWithResource> {

	constructor(private options?: { skipDescription?: boolean, skipPath?: boolean }) { }

	getItemLabel(entry: IQuickPickItemWithResource): string {
		return entry.label;
	}

	getItemDescription(entry: IQuickPickItemWithResource): string | undefined {
		if (this.options?.skipDescription) {
			return undefined;
		}

		return entry.description;
	}

	getItemPath(entry: IQuickPickItemWithResource): string | undefined {
		if (this.options?.skipPath) {
			return undefined;
		}

		if (entry.resource?.scheme === Schemas.file) {
			return entry.resource.fsPath;
		}

		return entry.resource?.path;
	}
}

export const quickPickItemScorerAccessor = new QuickPickItemScorerAccessor();

//#endregion
