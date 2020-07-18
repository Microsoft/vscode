/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWindowOpenable, IOpenWindowOptions, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';

export const IHostService = createDecorator<IHostService>('hostService');

export interface IHostService {

	readonly _serviceBrand: undefined;

	//#region Focus

	/**
	 * Emitted when the window focus changes.
	 */
	readonly onDidChangeFocus: Event<boolean>;

	/**
	 * Find out if the window has focus or not.
	 */
	readonly hasFocus: boolean;

	/**
	 * Find out if the window had the last focus.
	 */
	hadLastFocus(): Promise<boolean>;

	/**
	 * Attempt to bring the window to the foreground and focus it.
	 */
	focus(): Promise<void>;

	//#endregion


	//#region Window

	/**
	 * Opens an empty window. The optional parameter allows to define if
	 * a new window should open or the existing one change to an empty.
	 */
	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;

	/**
	 * Opens the provided array of openables in a window with the provided options.
	 */
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;

	/**
	 * Switch between fullscreen and normal window.
	 */
	toggleFullScreen(): Promise<void>;

	//#endregion


	//#region Lifecycle

	/**
	 * Restart the entire application.
	 */
	restart(): Promise<void>;

	/**
	 * Reload the currently active window.
	 */
	reload(): Promise<void>;

	//#endregion
}
