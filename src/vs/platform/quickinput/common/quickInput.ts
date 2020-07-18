/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IQuickPickItem, IPickOptions, IInputOptions, IQuickNavigateConfiguration, IQuickPick, IQuickInputButton, IInputBox, QuickPickInput, IKeyMods } from 'vs/base/parts/quickinput/common/quickInput';
import { IQuickAccessController } from 'vs/platform/quickinput/common/quickAccess';

export * from 'vs/base/parts/quickinput/common/quickInput';

export const IQuickInputService = createDecorator<IQuickInputService>('quickInputService');

export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export interface IQuickInputService {

	readonly _serviceBrand: undefined;

	/**
	 * Provides access to the back button in quick input.
	 */
	readonly backButton: IQuickInputButton;

	/**
	 * Provides access to the quick access providers.
	 */
	readonly quickAccess: IQuickAccessController;

	/**
	 * Allows to register on the event that quick input is showing.
	 */
	readonly onShow: Event<void>;

	/**
	 * Allows to register on the event that quick input is hiding.
	 */
	readonly onHide: Event<void>;

	/**
	 * Opens the quick input box for selecting items and returns a promise
	 * with the user selected item(s) if any.
	 */
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: true }, token?: CancellationToken): Promise<T[] | undefined>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: false }, token?: CancellationToken): Promise<T | undefined>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: Omit<IPickOptions<T>, 'canPickMany'>, token?: CancellationToken): Promise<T | undefined>;

	/**
	 * Opens the quick input box for text input and returns a promise with the user typed value if any.
	 */
	input(options?: IInputOptions, token?: CancellationToken): Promise<string | undefined>;

	/**
	 * Provides raw access to the quick pick controller.
	 */
	createQuickPick<T extends IQuickPickItem>(): IQuickPick<T>;

	/**
	 * Provides raw access to the quick input controller.
	 */
	createInputBox(): IInputBox;

	/**
	 * Moves focus into quick input.
	 */
	focus(): void;

	/**
	 * Toggle the checked state of the selected item.
	 */
	toggle(): void;

	/**
	 * Navigate inside the opened quick input list.
	 */
	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void;

	/**
	 * Navigate back in a multi-step quick input.
	 */
	back(): Promise<void>;

	/**
	 * Accept the selected item.
	 *
	 * @param keyMods allows to override the state of key
	 * modifiers that should be present when invoking.
	 */
	accept(keyMods?: IKeyMods): Promise<void>;

	/**
	 * Cancels quick input and closes it.
	 */
	cancel(): Promise<void>;
}
