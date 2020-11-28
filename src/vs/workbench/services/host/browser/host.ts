/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWindowOpenable, IOpenWindowOptions, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';

export const IHostService = createDecorator<IHostService>('hostService');

/**
 * A set of methods supported in both web and native environments.
 *
 * @see `INativeHostService` for methods that are specific to native
 * environments.
 */
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
	 *
	 * @param options Pass `force: true` if you want to make the window take
	 * focus even if the application does not have focus currently. This option
	 * should only be used if it is necessary to steal focus from the current
	 * focused application which may not be VSCode. It may not be supported
	 * in all environments.
	 */
	focus(options?: { force: boolean }): Promise<void>;

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
	reload(options?: { disableExtensions?: boolean }): Promise<void>;

	/**
	 * Attempt to close the active window.
	 */
	close(): Promise<void>;

	//#endregion
}
