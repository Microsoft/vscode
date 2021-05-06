/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ThemeColor } from 'vs/platform/theme/common/themeService';
import { Event } from 'vs/base/common/event';
import { Command } from 'vs/editor/common/modes';

export const IStatusbarService = createDecorator<IStatusbarService>('statusbarService');

export const enum StatusbarAlignment {
	LEFT,
	RIGHT
}

/**
 * A declarative way of describing a status bar entry
 */
export interface IStatusbarEntry {

	/**
	 * The text to show for the entry. You can embed icons in the text by leveraging the syntax:
	 *
	 * `My text ${icon name} contains icons like ${icon name} this one.`
	 */
	readonly text: string;

	/**
	 * Text to be read out by the screen reader.
	 */
	readonly ariaLabel: string;

	/**
	 * Role of the status bar entry which defines how a screen reader interacts with it.
	 * Default is 'button'.
	 */
	readonly role?: string;

	/**
	 * An optional tooltip text to show when you hover over the entry
	 */
	readonly tooltip?: string;

	/**
	 * An optional color to use for the entry
	 */
	readonly color?: string | ThemeColor;

	/**
	 * An optional background color to use for the entry
	 */
	readonly backgroundColor?: string | ThemeColor;

	/**
	 * An optional id of a command that is known to the workbench to execute on click
	 */
	readonly command?: string | Command;

	/**
	 * Whether to show a beak above the status bar entry.
	 */
	readonly showBeak?: boolean;

	/**
	 * Will enable a spinning icon in front of the text to indicate progress.
	 */
	readonly showProgress?: boolean;
}

export interface IStatusbarService {

	readonly _serviceBrand: undefined;

	/**
	 * Adds an entry to the statusbar with the given alignment and priority. Use the returned accessor
	 * to update or remove the statusbar entry.
	 *
	 * @param id  identifier of the entry is needed to allow users to hide entries via settings
	 * @param name human readable name the entry is about
	 * @param alignment either LEFT or RIGHT
	 * @param priority items get arranged from highest priority to lowest priority from left to right
	 * in their respective alignment slot
	 */
	addEntry(entry: IStatusbarEntry, id: string, name: string, alignment: StatusbarAlignment, priority?: number): IStatusbarEntryAccessor;

	/**
	 * An event that is triggered when an entry's visibility is changed.
	 */
	readonly onDidChangeEntryVisibility: Event<{ id: string, visible: boolean }>;

	/**
	 * Return if an entry is visible or not.
	 */
	isEntryVisible(id: string): boolean;

	/**
	 * Allows to update an entry's visibility with the provided ID.
	 */
	updateEntryVisibility(id: string, visible: boolean): void;

	/**
	 * Focused the status bar. If one of the status bar entries was focused, focuses it directly.
	 */
	focus(preserveEntryFocus?: boolean): void;

	/**
	 * Focuses the next status bar entry. If none focused, focuses the first.
	 */
	focusNextEntry(): void;

	/**
	 * Focuses the previous status bar entry. If none focused, focuses the last.
	 */
	focusPreviousEntry(): void;

	/**
	 *	Returns true if a status bar entry is focused.
	 */
	isEntryFocused(): boolean;
}

export interface IStatusbarEntryAccessor extends IDisposable {

	/**
	 * Allows to update an existing status bar entry.
	 */
	update(properties: IStatusbarEntry): void;
}
