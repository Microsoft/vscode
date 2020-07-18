/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference path="typings/require.d.ts" />

//@ts-check
'use strict';

// Simple module style to support node.js and browser environments
(function (globalThis, factory) {

	// Node.js
	if (typeof exports === 'object') {
		module.exports = factory();
	}

	// Browser
	else {
		globalThis.MonacoBootstrapWindow = factory();
	}
}(this, function () {
	const path = require.__$__nodeRequire('path');
	const bootstrap = globalThis.MonacoBootstrap;

	/**
	 * @param {string[]} modulePaths
	 * @param {(result, configuration: object) => any} resultCallback
	 * @param {{ forceEnableDeveloperKeybindings?: boolean, disallowReloadKeybinding?: boolean, removeDeveloperKeybindingsAfterLoad?: boolean, canModifyDOM?: (config: object) => void, beforeLoaderConfig?: (config: object, loaderConfig: object) => void, beforeRequire?: () => void }=} options
	 */
	function load(modulePaths, resultCallback, options) {
		const args = parseURLQueryArgs();
		/**
		 * // configuration: INativeWindowConfiguration
		 * @type {{
		 * extensionDevelopmentPath?: string[],
		 * extensionTestsPath?: string,
		 * userEnv?: { [key: string]: string | undefined },
		 * appRoot?: string,
		 * nodeCachedDataDir?: string
		 * }} */
		const configuration = JSON.parse(args['config'] || '{}') || {};

		// Error handler
		process.on('uncaughtException', function (error) {
			onUnexpectedError(error, enableDeveloperTools);
		});

		// Developer tools
		const enableDeveloperTools = (process.env['VSCODE_DEV'] || !!configuration.extensionDevelopmentPath) && !configuration.extensionTestsPath;
		let developerToolsUnbind;
		if (enableDeveloperTools || (options && options.forceEnableDeveloperKeybindings)) {
			developerToolsUnbind = registerDeveloperKeybindings(options && options.disallowReloadKeybinding);
		}

		// Correctly inherit the parent's environment
		Object.assign(process.env, configuration.userEnv);

		// Enable ASAR support
		bootstrap.enableASARSupport(path.join(configuration.appRoot, 'node_modules'));

		if (options && typeof options.canModifyDOM === 'function') {
			options.canModifyDOM(configuration);
		}

		// Get the nls configuration into the process.env as early as possible.
		const nlsConfig = bootstrap.setupNLS();

		let locale = nlsConfig.availableLanguages['*'] || 'en';
		if (locale === 'zh-tw') {
			locale = 'zh-Hant';
		} else if (locale === 'zh-cn') {
			locale = 'zh-Hans';
		}

		window.document.documentElement.setAttribute('lang', locale);

		// do not advertise AMD to avoid confusing UMD modules loaded with nodejs
		window['define'] = undefined;

		// replace the patched electron fs with the original node fs for all AMD code
		require.define('fs', ['original-fs'], function (originalFS) { return originalFS; });

		window['MonacoEnvironment'] = {};

		const loaderConfig = {
			baseUrl: `${bootstrap.uriFromPath(configuration.appRoot)}/out`,
			'vs/nls': nlsConfig,
			amdModulesPattern: /^vs\//,
		};

		// cached data config
		if (configuration.nodeCachedDataDir) {
			loaderConfig.nodeCachedData = {
				path: configuration.nodeCachedDataDir,
				seed: modulePaths.join('')
			};
		}

		if (options && typeof options.beforeLoaderConfig === 'function') {
			options.beforeLoaderConfig(configuration, loaderConfig);
		}

		require.config(loaderConfig);

		if (nlsConfig.pseudo) {
			require(['vs/nls'], function (nlsPlugin) {
				nlsPlugin.setPseudoTranslation(nlsConfig.pseudo);
			});
		}

		if (options && typeof options.beforeRequire === 'function') {
			options.beforeRequire();
		}

		require(modulePaths, result => {
			try {
				const callbackResult = resultCallback(result, configuration);
				if (callbackResult && typeof callbackResult.then === 'function') {
					callbackResult.then(() => {
						if (developerToolsUnbind && options && options.removeDeveloperKeybindingsAfterLoad) {
							developerToolsUnbind();
						}
					}, error => {
						onUnexpectedError(error, enableDeveloperTools);
					});
				}
			} catch (error) {
				onUnexpectedError(error, enableDeveloperTools);
			}
		}, onUnexpectedError);
	}

	/**
	 * @returns {{[param: string]: string }}
	 */
	function parseURLQueryArgs() {
		const search = window.location.search || '';

		return search.split(/[?&]/)
			.filter(function (param) { return !!param; })
			.map(function (param) { return param.split('='); })
			.filter(function (param) { return param.length === 2; })
			.reduce(function (r, param) { r[param[0]] = decodeURIComponent(param[1]); return r; }, {});
	}

	/**
	 * @param {boolean} disallowReloadKeybinding
	 * @returns {() => void}
	 */
	function registerDeveloperKeybindings(disallowReloadKeybinding) {
		const ipcRenderer = globals().ipcRenderer;

		const extractKey = function (e) {
			return [
				e.ctrlKey ? 'ctrl-' : '',
				e.metaKey ? 'meta-' : '',
				e.altKey ? 'alt-' : '',
				e.shiftKey ? 'shift-' : '',
				e.keyCode
			].join('');
		};

		// Devtools & reload support
		const TOGGLE_DEV_TOOLS_KB = (process.platform === 'darwin' ? 'meta-alt-73' : 'ctrl-shift-73'); // mac: Cmd-Alt-I, rest: Ctrl-Shift-I
		const TOGGLE_DEV_TOOLS_KB_ALT = '123'; // F12
		const RELOAD_KB = (process.platform === 'darwin' ? 'meta-82' : 'ctrl-82'); // mac: Cmd-R, rest: Ctrl-R

		let listener = function (e) {
			const key = extractKey(e);
			if (key === TOGGLE_DEV_TOOLS_KB || key === TOGGLE_DEV_TOOLS_KB_ALT) {
				ipcRenderer.send('vscode:toggleDevTools');
			} else if (key === RELOAD_KB && !disallowReloadKeybinding) {
				ipcRenderer.send('vscode:reloadWindow');
			}
		};

		window.addEventListener('keydown', listener);

		return function () {
			if (listener) {
				window.removeEventListener('keydown', listener);
				listener = undefined;
			}
		};
	}

	/**
	 * @param {string | Error} error
	 * @param {boolean} [enableDeveloperTools]
	 */
	function onUnexpectedError(error, enableDeveloperTools) {
		if (enableDeveloperTools) {
			const ipcRenderer = globals().ipcRenderer;
			ipcRenderer.send('vscode:openDevTools');
		}

		console.error(`[uncaught exception]: ${error}`);

		if (error && typeof error !== 'string' && error.stack) {
			console.error(error.stack);
		}
	}

	/**
	 * @return {typeof import('./vs/base/parts/sandbox/electron-sandbox/globals')}
	 */
	function globals() {
		// @ts-ignore (defined in globals.js)
		return window.vscode;
	}

	return {
		load,
		globals
	};
}));
