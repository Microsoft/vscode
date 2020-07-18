/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CrashReporterStartOptions } from 'vs/base/parts/sandbox/common/electronTypes';

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
	 * You are required to call this method before using any other `crashReporter` APIs
	 * and in each process (main/renderer) from which you want to collect crash
	 * reports. You can pass different options to `crashReporter.start` when calling
	 * from different processes.
	 *
	 * **Note** Child processes created via the `child_process` module will not have
	 * access to the Electron modules. Therefore, to collect crash reports from them,
	 * use `process.crashReporter.start` instead. Pass the same options as above along
	 * with an additional one called `crashesDirectory` that should point to a
	 * directory to store the crash reports temporarily. You can test this out by
	 * calling `process.crash()` to crash the child process.
	 *
	 * **Note:** If you need send additional/updated `extra` parameters after your
	 * first call `start` you can call `addExtraParameter` on macOS or call `start`
	 * again with the new/updated `extra` parameters on Linux and Windows.
	 *
	 * **Note:** On macOS and windows, Electron uses a new `crashpad` client for crash
	 * collection and reporting. If you want to enable crash reporting, initializing
	 * `crashpad` from the main process using `crashReporter.start` is required
	 * regardless of which process you want to collect crashes from. Once initialized
	 * this way, the crashpad handler collects crashes from all processes. You still
	 * have to call `crashReporter.start` from the renderer or child process, otherwise
	 * crashes from them will get reported without `companyName`, `productName` or any
	 * of the `extra` information.
	 */
	start(options: CrashReporterStartOptions): void;
};
