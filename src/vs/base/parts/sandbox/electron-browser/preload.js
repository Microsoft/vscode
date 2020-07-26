/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
(function () {
	'use strict';

	const { ipcRenderer, webFrame, crashReporter, contextBridge } = require('electron');

	const globals = {

		/**
		 * A minimal set of methods exposed from Electron's `ipcRenderer`
		 * to support communication to main process.
		 */
		ipcRenderer: {

			/**
			 * @param {string} channel
			 * @param {any[]} args
			 */
			send(channel, ...args) {
				if (validateIPC(channel)) {
					ipcRenderer.send(channel, ...args);
				}
			},

			/**
			 * @param {string} channel
			 * @param {(event: import('electron').IpcRendererEvent, ...args: any[]) => void} listener
			 */
			on(channel, listener) {
				if (validateIPC(channel)) {
					ipcRenderer.on(channel, listener);
				}
			},

			/**
			 * @param {string} channel
			 * @param {(event: import('electron').IpcRendererEvent, ...args: any[]) => void} listener
			 */
			once(channel, listener) {
				if (validateIPC(channel)) {
					ipcRenderer.once(channel, listener);
				}
			},

			/**
			 * @param {string} channel
			 * @param {(event: import('electron').IpcRendererEvent, ...args: any[]) => void} listener
			 */
			removeListener(channel, listener) {
				if (validateIPC(channel)) {
					ipcRenderer.removeListener(channel, listener);
				}
			}
		},

		/**
		 * Support for subset of methods of Electron's `webFrame` type.
		 */
		webFrame: {

			/**
			 * @param {number} level
			 */
			setZoomLevel(level) {
				if (typeof level === 'number') {
					webFrame.setZoomLevel(level);
				}
			}
		},

		/**
		 * Support for subset of methods of Electron's `crashReporter` type.
		 */
		crashReporter: {

			/**
			 * @param {string} key
			 * @param {string} value
			 */
			addExtraParameter(key, value) {
				crashReporter.addExtraParameter(key, value);
			}
		},

		/**
		 * Support for a subset of access to node.js global `process`.
		 */
		process: {
			platform: process.platform,
			env: process.env,
			on:
				/**
				 * @param {string} type
				 * @param {() => void} callback
				 */
				function (type, callback) {
					if (validateProcessEventType(type)) {
						process.on(type, callback);
					}
				}
		},

		/**
		 * Some information about the context we are running in.
		 */
		context: {
			sandbox: process.argv.includes('--enable-sandbox')
		}
	};

	// Use `contextBridge` APIs to expose globals to VSCode
	// only if context isolation is enabled, otherwise just
	// add to the DOM global.
	let useContextBridge = process.argv.includes('--context-isolation');
	if (useContextBridge) {
		try {
			contextBridge.exposeInMainWorld('vscode', globals);
		} catch (error) {
			console.error(error);

			useContextBridge = false;
		}
	}

	if (!useContextBridge) {
		// @ts-ignore
		window.vscode = globals;
	}

	//#region Utilities

	/**
	 * @param {string} channel
	 */
	function validateIPC(channel) {
		if (!channel || !channel.startsWith('vscode:')) {
			throw new Error(`Unsupported event IPC channel '${channel}'`);
		}

		return true;
	}

	/**
	 * @param {string} type
	 * @returns {type is 'uncaughtException'}
	 */
	function validateProcessEventType(type) {
		if (type !== 'uncaughtException') {
			throw new Error(`Unsupported process event '${type}'`);
		}

		return true;
	}

	//#endregion
}());
