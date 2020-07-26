/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const ipcRenderer = (window as any).vscode.ipcRenderer as {

	/**
	 * Listens to `channel`, when a new message arrives `listener` would be called with
	 * `listener(event, args...)`.
	 */
	on(channel: string, listener: (event: unknown, ...args: any[]) => void): void;

	/**
	 * Adds a one time `listener` function for the event. This `listener` is invoked
	 * only the next time a message is sent to `channel`, after which it is removed.
	 */
	once(channel: string, listener: (event: unknown, ...args: any[]) => void): void;

	/**
	 * Removes the specified `listener` from the listener array for the specified
	 * `channel`.
	 */
	removeListener(channel: string, listener: (event: unknown, ...args: any[]) => void): void;

	/**
	 * Send an asynchronous message to the main process via `channel`, along with
	 * arguments. Arguments will be serialized with the Structured Clone Algorithm,
	 * just like `postMessage`, so prototype chains will not be included. Sending
	 * Functions, Promises, Symbols, WeakMaps, or WeakSets will throw an exception.
	 *
	 * > **NOTE**: Sending non-standard JavaScript types such as DOM objects or special
	 * Electron objects is deprecated, and will begin throwing an exception starting
	 * with Electron 9.
	 *
	 * The main process handles it by listening for `channel` with the `ipcMain`
	 * module.
	 */
	send(channel: string, ...args: any[]): void;
};

export const webFrame = (window as any).vscode.webFrame as {

	/**
	 * Changes the zoom level to the specified level. The original size is 0 and each
	 * increment above or below represents zooming 20% larger or smaller to default
	 * limits of 300% and 50% of original size, respectively.
	 */
	setZoomLevel(level: number): void;
};

export const crashReporter = (window as any).vscode.crashReporter as {

	/**
	 * Set an extra parameter to be sent with the crash report. The values specified
	 * here will be sent in addition to any values set via the `extra` option when
	 * `start` was called.
	 *
	 * Parameters added in this fashion (or via the `extra` parameter to
	 * `crashReporter.start`) are specific to the calling process. Adding extra
	 * parameters in the main process will not cause those parameters to be sent along
	 * with crashes from renderer or other child processes. Similarly, adding extra
	 * parameters in a renderer process will not result in those parameters being sent
	 * with crashes that occur in other renderer processes or in the main process.
	 *
	 * **Note:** Parameters have limits on the length of the keys and values. Key names
	 * must be no longer than 39 bytes, and values must be no longer than 127 bytes.
	 * Keys with names longer than the maximum will be silently ignored. Key values
	 * longer than the maximum length will be truncated.
	 */
	addExtraParameter(key: string, value: string): void;
};

export const process = (window as any).vscode.process as {

	/**
	 * The process.platform property returns a string identifying the operating system platform
	 * on which the Node.js process is running.
	 */
	platform: 'win32' | 'linux' | 'darwin';

	/**
	 * The process.env property returns an object containing the user environment. See environ(7).
	 */
	env: { [key: string]: string | undefined };

	/**
	 * A listener on the process. Only a small subset of listener types are allowed.
	 */
	on: (type: string, callback: Function) => void;
};

export const context = (window as any).vscode.context as {

	/**
	 * Wether the renderer runs with `sandbox` enabled or not.
	 */
	sandbox: boolean;
};
