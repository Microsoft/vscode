/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { IEditorInput, GroupIdentifier } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';

export const IHistoryService = createDecorator<IHistoryService>('historyService');

export interface IHistoryService {

	readonly _serviceBrand: undefined;

	/**
	 * Re-opens the last closed editor if any.
	 */
	reopenLastClosedEditor(): void;

	/**
	 * Navigates to the last location where an edit happened.
	 */
	openLastEditLocation(): void;

	/**
	 * Navigate forwards in history.
	 */
	forward(): void;

	/**
	 * Navigate backwards in history.
	 */
	back(): void;

	/**
	 * Navigate forward or backwards to previous entry in history.
	 */
	last(): void;

	/**
	 * Removes an entry from history.
	 */
	remove(input: IEditorInput | IResourceEditorInput): void;

	/**
	 * Clears all history.
	 */
	clear(): void;

	/**
	 * Clear list of recently opened editors.
	 */
	clearRecentlyOpened(): void;

	/**
	 * Get the entire history of editors that were opened.
	 */
	getHistory(): ReadonlyArray<IEditorInput | IResourceEditorInput>;

	/**
	 * Looking at the editor history, returns the workspace root of the last file that was
	 * inside the workspace and part of the editor history.
	 *
	 * @param schemeFilter filter to restrict roots by scheme.
	 */
	getLastActiveWorkspaceRoot(schemeFilter?: string): URI | undefined;

	/**
	 * Looking at the editor history, returns the resource of the last file that was opened.
	 *
	 * @param schemeFilter filter to restrict roots by scheme.
	 */
	getLastActiveFile(schemeFilter: string): URI | undefined;

	/**
	 * Opens the next used editor if any.
	 *
	 * @param group optional indicator to scope to a specific group.
	 */
	openNextRecentlyUsedEditor(group?: GroupIdentifier): void;

	/**
	 * Opens the previously used editor if any.
	 *
	 * @param group optional indicator to scope to a specific group.
	 */
	openPreviouslyUsedEditor(group?: GroupIdentifier): void;
}
