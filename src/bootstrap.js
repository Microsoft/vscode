/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
		globalThis.MonacoBootstrap = factory();
	}
}(this, function () {
	const Module = typeof require === 'function' ? require('module') : undefined;
	const path = typeof require === 'function' ? require('path') : undefined;
	const fs = typeof require === 'function' ? require('fs') : undefined;

	//#region global bootstrapping

	// increase number of stack frames(from 10, https://github.com/v8/v8/wiki/Stack-Trace-API)
	Error.stackTraceLimit = 100;

	// Workaround for Electron not installing a handler to ignore SIGPIPE
	// (https://github.com/electron/electron/issues/13254)
	if (typeof process !== 'undefined') {
		process.on('SIGPIPE', () => {
			console.error(new Error('Unexpected SIGPIPE'));
		});
	}

	//#endregion


	//#region Add support for using node_modules.asar

	/**
	 * @param {string | undefined} appRoot
	 */
	function enableASARSupport(appRoot) {
		if (!path || !Module || typeof process === 'undefined') {
			console.warn('enableASARSupport() is only available in node.js environments'); // TODO@sandbox ASAR is currently non-sandboxed only
			return;
		}

		let NODE_MODULES_PATH = appRoot ? path.join(appRoot, 'node_modules') : undefined;
		if (!NODE_MODULES_PATH) {
			NODE_MODULES_PATH = path.join(__dirname, '../node_modules');
		} else {
			// use the drive letter casing of __dirname
			if (process.platform === 'win32') {
				NODE_MODULES_PATH = __dirname.substr(0, 1) + NODE_MODULES_PATH.substr(1);
			}
		}

		const NODE_MODULES_ASAR_PATH = `${NODE_MODULES_PATH}.asar`;

		// @ts-ignore
		const originalResolveLookupPaths = Module._resolveLookupPaths;

		// @ts-ignore
		Module._resolveLookupPaths = function (request, parent) {
			const paths = originalResolveLookupPaths(request, parent);
			if (Array.isArray(paths)) {
				for (let i = 0, len = paths.length; i < len; i++) {
					if (paths[i] === NODE_MODULES_PATH) {
						paths.splice(i, 0, NODE_MODULES_ASAR_PATH);
						break;
					}
				}
			}

			return paths;
		};
	}

	//#endregion


	//#region URI helpers

	/**
	 * @param {string} path
	 * @param {{ isWindows?: boolean, scheme?: string, fallbackAuthority?: string }} config
	 * @returns {string}
	 */
	function fileUriFromPath(path, config) {

		// Since we are building a URI, we normalize any backlsash
		// to slashes and we ensure that the path begins with a '/'.
		let pathName = path.replace(/\\/g, '/');
		if (pathName.length > 0 && pathName.charAt(0) !== '/') {
			pathName = `/${pathName}`;
		}

		/** @type {string} */
		let uri;

		// Windows: in order to support UNC paths (which start with '//')
		// that have their own authority, we do not use the provided authority
		// but rather preserve it.
		if (config.isWindows && pathName.startsWith('//')) {
			uri = encodeURI(`${config.scheme || 'file'}:${pathName}`);
		}

		// Otherwise we optionally add the provided authority if specified
		else {
			uri = encodeURI(`${config.scheme || 'file'}://${config.fallbackAuthority || ''}${pathName}`);
		}

		return uri.replace(/#/g, '%23');
	}

	//#endregion


	//#region NLS helpers

	/**
	 * @returns {{locale?: string, availableLanguages: {[lang: string]: string;}, pseudo?: boolean } | undefined}
	 */
	function setupNLS() {

		// Get the nls configuration as early as possible.
		const process = safeProcess();
		let nlsConfig = { availableLanguages: {} };
		if (process && process.env['VSCODE_NLS_CONFIG']) {
			try {
				nlsConfig = JSON.parse(process.env['VSCODE_NLS_CONFIG']);
			} catch (e) {
				// Ignore
			}
		}

		if (nlsConfig._resolvedLanguagePackCoreLocation) {
			const bundles = Object.create(null);

			nlsConfig.loadBundle = function (bundle, language, cb) {
				const result = bundles[bundle];
				if (result) {
					cb(undefined, result);

					return;
				}

				safeReadNlsFile(nlsConfig._resolvedLanguagePackCoreLocation, `${bundle.replace(/\//g, '!')}.nls.json`).then(function (content) {
					const json = JSON.parse(content);
					bundles[bundle] = json;

					cb(undefined, json);
				}).catch((error) => {
					try {
						if (nlsConfig._corruptedFile) {
							safeWriteNlsFile(nlsConfig._corruptedFile, 'corrupted').catch(function (error) { console.error(error); });
						}
					} finally {
						cb(error, undefined);
					}
				});
			};
		}

		return nlsConfig;
	}

	/**
	 * @returns {typeof import('./vs/base/parts/sandbox/electron-sandbox/globals') | undefined}
	 */
	function safeSandboxGlobals() {
		const globals = (typeof self === 'object' ? self : typeof global === 'object' ? global : {});

		return globals.vscode;
	}

	/**
	 * @returns {import('./vs/base/parts/sandbox/electron-sandbox/globals').ISandboxNodeProcess | NodeJS.Process}
	 */
	function safeProcess() {
		const sandboxGlobals = safeSandboxGlobals();
		if (sandboxGlobals) {
			return sandboxGlobals.process; // Native environment (sandboxed)
		}

		if (typeof process !== 'undefined') {
			return process; // Native environment (non-sandboxed)
		}

		return undefined;
	}

	/**
	 * @returns {import('./vs/base/parts/sandbox/electron-sandbox/electronTypes').IpcRenderer | undefined}
	 */
	function safeIpcRenderer() {
		const sandboxGlobals = safeSandboxGlobals();
		if (sandboxGlobals) {
			return sandboxGlobals.ipcRenderer;
		}

		return undefined;
	}

	/**
	 * @param {string[]} pathSegments
	 * @returns {Promise<string>}
	 */
	async function safeReadNlsFile(...pathSegments) {
		const ipcRenderer = safeIpcRenderer();
		if (ipcRenderer) {
			return ipcRenderer.invoke('vscode:readNlsFile', ...pathSegments);
		}

		if (fs && path) {
			return (await fs.promises.readFile(path.join(...pathSegments))).toString();
		}

		throw new Error('Unsupported operation (read NLS files)');
	}

	/**
	 * @param {string} path
	 * @param {string} content
	 * @returns {Promise<void>}
	 */
	function safeWriteNlsFile(path, content) {
		const ipcRenderer = safeIpcRenderer();
		if (ipcRenderer) {
			return ipcRenderer.invoke('vscode:writeNlsFile', path, content);
		}

		if (fs) {
			return fs.promises.writeFile(path, content);
		}

		throw new Error('Unsupported operation (write NLS files)');
	}

	//#endregion


	//#region ApplicationInsights

	// Prevents appinsights from monkey patching modules.
	// This should be called before importing the applicationinsights module
	function avoidMonkeyPatchFromAppInsights() {
		if (typeof process === 'undefined') {
			console.warn('avoidMonkeyPatchFromAppInsights() is only available in node.js environments');
			return;
		}

		// @ts-ignore
		process.env['APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL'] = true; // Skip monkey patching of 3rd party modules by appinsights
		global['diagnosticsSource'] = {}; // Prevents diagnostic channel (which patches "require") from initializing entirely
	}

	//#endregion


	return {
		enableASARSupport,
		avoidMonkeyPatchFromAppInsights,
		setupNLS,
		fileUriFromPath
	};
}));
