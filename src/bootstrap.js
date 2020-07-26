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
		try {
			globalThis.MonacoBootstrap = factory();
		} catch (error) {
			console.warn(error); // expected when e.g. running with sandbox: true (TODO@sandbox eventually consolidate this)
		}
	}
}(this, function () {
	const Module = require('module');
	const path = require('path');
	const fs = require('fs');

	//#region global bootstrapping

	// increase number of stack frames(from 10, https://github.com/v8/v8/wiki/Stack-Trace-API)
	Error.stackTraceLimit = 100;

	// Workaround for Electron not installing a handler to ignore SIGPIPE
	// (https://github.com/electron/electron/issues/13254)
	process.on('SIGPIPE', () => {
		console.error(new Error('Unexpected SIGPIPE'));
	});

	//#endregion


	//#region Add support for using node_modules.asar

	/**
	 * @param {string} appRoot
	 */
	function enableASARSupport(appRoot) {
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
	 * @param {string} _path
	 * @returns {string}
	 */
	function fileUriFromPath(_path) {
		let pathName = path.resolve(_path).replace(/\\/g, '/');
		if (pathName.length > 0 && pathName.charAt(0) !== '/') {
			pathName = `/${pathName}`;
		}

		/** @type {string} */
		let uri;
		if (process.platform === 'win32' && pathName.startsWith('//')) { // specially handle Windows UNC paths
			uri = encodeURI(`file:${pathName}`);
		} else {
			uri = encodeURI(`file://${pathName}`);
		}

		return uri.replace(/#/g, '%23');
	}

	//#endregion


	//#region NLS helpers

	/**
	 * @returns {{locale?: string, availableLanguages: {[lang: string]: string;}, pseudo?: boolean }}
	 */
	function setupNLS() {

		// Get the nls configuration into the process.env as early as possible.
		let nlsConfig = { availableLanguages: {} };
		if (process.env['VSCODE_NLS_CONFIG']) {
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

				const bundleFile = path.join(nlsConfig._resolvedLanguagePackCoreLocation, `${bundle.replace(/\//g, '!')}.nls.json`);
				fs.promises.readFile(bundleFile, 'utf8').then(function (content) {
					const json = JSON.parse(content);
					bundles[bundle] = json;

					cb(undefined, json);
				}).catch((error) => {
					try {
						if (nlsConfig._corruptedFile) {
							fs.promises.writeFile(nlsConfig._corruptedFile, 'corrupted', 'utf8').catch(function (error) { console.error(error); });
						}
					} finally {
						cb(error, undefined);
					}
				});
			};
		}

		return nlsConfig;
	}

	//#endregion


	//#region Portable helpers

	/**
	 * @param {{ portable: string; applicationName: string; }} product
	 * @returns {{portableDataPath: string;isPortable: boolean;}}
	 */
	function configurePortable(product) {
		const appRoot = path.dirname(__dirname);

		function getApplicationPath() {
			if (process.env['VSCODE_DEV']) {
				return appRoot;
			}

			if (process.platform === 'darwin') {
				return path.dirname(path.dirname(path.dirname(appRoot)));
			}

			return path.dirname(path.dirname(appRoot));
		}

		function getPortableDataPath() {
			if (process.env['VSCODE_PORTABLE']) {
				return process.env['VSCODE_PORTABLE'];
			}

			if (process.platform === 'win32' || process.platform === 'linux') {
				return path.join(getApplicationPath(), 'data');
			}

			// @ts-ignore
			const portableDataName = product.portable || `${product.applicationName}-portable-data`;
			return path.join(path.dirname(getApplicationPath()), portableDataName);
		}

		const portableDataPath = getPortableDataPath();
		const isPortable = !('target' in product) && fs.existsSync(portableDataPath);
		const portableTempPath = path.join(portableDataPath, 'tmp');
		const isTempPortable = isPortable && fs.existsSync(portableTempPath);

		if (isPortable) {
			process.env['VSCODE_PORTABLE'] = portableDataPath;
		} else {
			delete process.env['VSCODE_PORTABLE'];
		}

		if (isTempPortable) {
			if (process.platform === 'win32') {
				process.env['TMP'] = portableTempPath;
				process.env['TEMP'] = portableTempPath;
			} else {
				process.env['TMPDIR'] = portableTempPath;
			}
		}

		return {
			portableDataPath,
			isPortable
		};
	}

	//#endregion


	//#region ApplicationInsights

	// Prevents appinsights from monkey patching modules.
	// This should be called before importing the applicationinsights module
	function avoidMonkeyPatchFromAppInsights() {
		// @ts-ignore
		process.env['APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL'] = true; // Skip monkey patching of 3rd party modules by appinsights
		global['diagnosticsSource'] = {}; // Prevents diagnostic channel (which patches "require") from initializing entirely
	}

	//#endregion


	return {
		enableASARSupport,
		avoidMonkeyPatchFromAppInsights,
		configurePortable,
		setupNLS,
		fileUriFromPath
	};
}));
