/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
(function () {
	'use strict';

	const { ipcRenderer, webFrame, crashReporter, contextBridge } = require('electron');

	// #######################################################################
	// ###                                                                 ###
	// ###       !!! DO NOT USE GET/SET PROPERTIES ANYWHERE HERE !!!       ###
	// ###       !!!  UNLESS THE ACCESS IS WITHOUT SIDE EFFECTS  !!!       ###
	// ###       (https://github.com/electron/electron/issues/25516)       ###
	// ###                                                                 ###
	// #######################################################################

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
			 * @param {any[]} args
			 * @returns {Promise<any> | undefined}
			 */
			invoke(channel, ...args) {
				if (validateIPC(channel)) {
					return ipcRenderer.invoke(channel, ...args);
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
		 *
		 * Note: when `sandbox` is enabled, the only properties available
		 * are https://github.com/electron/electron/blob/master/docs/api/process.md#sandbox
		 */
		process: {
			get platform() { return process.platform; },
			get env() { return process.env; },
			get versions() { return process.versions; },
			get type() { return 'renderer'; },
			get execPath() { return process.execPath; },

			/**
			 * @param {{[key: string]: string}} userEnv
			 * @returns {Promise<void>}
			 */
			resolveEnv(userEnv) {
				return resolveEnv(userEnv);
			},

			/**
			 * @returns {Promise<import('electron').ProcessMemoryInfo>}
			 */
			getProcessMemoryInfo() {
				return process.getProcessMemoryInfo();
			},

			/**
			 * @param {string} type
			 * @param {() => void} callback
			 */
			on(type, callback) {
				if (validateProcessEventType(type)) {
					process.on(type, callback);
				}
			}
		},

		/**
		 * Some information about the context we are running in.
		 */
		context: {
			get sandbox() { return process.sandboxed; }
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
	 * @returns {true | never}
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

	/** @type {Promise<void> | undefined} */
	let resolvedEnv = undefined;

	/**
	 * If VSCode is not run from a terminal, we should resolve additional
	 * shell specific environment from the OS shell to ensure we are seeing
	 * all development related environment variables. We do this from the
	 * main process because it may involve spawning a shell.
	 *
	 * @param {{[key: string]: string}} userEnv
	 * @returns {Promise<void>}
	 */
	function resolveEnv(userEnv) {
		if (!resolvedEnv) {

			// Apply `userEnv` directly
			Object.assign(process.env, userEnv);

			// Resolve `shellEnv` from the main side
			resolvedEnv = new Promise(function (resolve) {
				ipcRenderer.once('vscode:acceptShellEnv', function (event, shellEnv) {

					// Assign all keys of the shell environment to our process environment
					// But make sure that the user environment wins in the end
					Object.assign(process.env, shellEnv, userEnv);

					resolve();
				});

				ipcRenderer.send('vscode:fetchShellEnv');
			});
		}

		return resolvedEnv;
	}

	//#endregion
}());
