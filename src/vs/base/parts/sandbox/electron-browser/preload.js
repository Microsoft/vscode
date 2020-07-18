/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
(function () {
	'use strict';

	const { ipcRenderer, webFrame, crashReporter } = require('electron');

	// @ts-ignore
	window.vscode = {

		/**
		 * A minimal set of methods exposed from ipcRenderer
		 * to support communication to electron-main
		 *
		 * @type {typeof import('../electron-sandbox/globals').ipcRenderer}
		 */
		ipcRenderer: {

			/**
			 * @param {string} channel
			 * @param {any[]} args
			 */
			send(channel, ...args) {
				validateIPC(channel);

				ipcRenderer.send(channel, ...args);
			},

			/**
			 * @param {string} channel
			 * @param {(event: import('electron').IpcRendererEvent, ...args: any[]) => void} listener
			 */
			on(channel, listener) {
				validateIPC(channel);

				ipcRenderer.on(channel, listener);
			},

			/**
			 * @param {string} channel
			 * @param {(event: import('electron').IpcRendererEvent, ...args: any[]) => void} listener
			 */
			once(channel, listener) {
				validateIPC(channel);

				ipcRenderer.once(channel, listener);
			},

			/**
			 * @param {string} channel
			 * @param {(event: import('electron').IpcRendererEvent, ...args: any[]) => void} listener
			 */
			removeListener(channel, listener) {
				validateIPC(channel);

				ipcRenderer.removeListener(channel, listener);
			}
		},

		/**
		 * Support for methods of webFrame type.
		 *
		 * @type {typeof import('../electron-sandbox/globals').webFrame}
		 */
		webFrame: {

			/**
			 * @param {number} level
			 */
			setZoomLevel(level) {
				webFrame.setZoomLevel(level);
			}
		},

		/**
		 * Support for methods of crashReporter type.
		 *
		 * @type {typeof import('../electron-sandbox/globals').crashReporter}
		 */
		crashReporter: {

			/**
			 * @param {Electron.CrashReporterStartOptions} options
			 */
			start(options) {
				crashReporter.start(options);
			}
		}
	};

	//#region Utilities

	/**
	 * @param {string} channel
	 */
	function validateIPC(channel) {
		if (!channel || !channel.startsWith('vscode:')) {
			throw new Error(`Unsupported event IPC channel '${channel}'`);
		}
	}

	//#endregion
}());
