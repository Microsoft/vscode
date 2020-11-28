/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

/**
 * Add support for redirecting the loading of node modules
 *
 * @param {string} injectPath
 */
exports.injectNodeModuleLookupPath = function (injectPath) {
	if (!injectPath) {
		throw new Error('Missing injectPath');
	}

	const Module = require('module');
	const path = require('path');

	const nodeModulesPath = path.join(__dirname, '../node_modules');

	// @ts-ignore
	const originalResolveLookupPaths = Module._resolveLookupPaths;

	// @ts-ignore
	Module._resolveLookupPaths = function (moduleName, parent) {
		const paths = originalResolveLookupPaths(moduleName, parent);
		if (Array.isArray(paths)) {
			for (let i = 0, len = paths.length; i < len; i++) {
				if (paths[i] === nodeModulesPath) {
					paths.splice(i, 0, injectPath);
					break;
				}
			}
		}

		return paths;
	};
};

exports.removeGlobalNodeModuleLookupPaths = function () {
	const Module = require('module');
	// @ts-ignore
	const globalPaths = Module.globalPaths;

	// @ts-ignore
	const originalResolveLookupPaths = Module._resolveLookupPaths;

	// @ts-ignore
	Module._resolveLookupPaths = function (moduleName, parent) {
		const paths = originalResolveLookupPaths(moduleName, parent);
		let commonSuffixLength = 0;
		while (commonSuffixLength < paths.length && paths[paths.length - 1 - commonSuffixLength] === globalPaths[globalPaths.length - 1 - commonSuffixLength]) {
			commonSuffixLength++;
		}
		return paths.slice(0, paths.length - commonSuffixLength);
	};
};

/**
 * Helper to enable portable mode.
 *
 * @param {{ portable?: string; applicationName: string; }} product
 * @returns {{ portableDataPath: string; isPortable: boolean; }}
 */
exports.configurePortable = function (product) {
	const fs = require('fs');
	const path = require('path');

	const appRoot = path.dirname(__dirname);

	/**
	 * @param {import('path')} path
	 */
	function getApplicationPath(path) {
		if (process.env['VSCODE_DEV']) {
			return appRoot;
		}

		if (process.platform === 'darwin') {
			return path.dirname(path.dirname(path.dirname(appRoot)));
		}

		return path.dirname(path.dirname(appRoot));
	}

	/**
	 * @param {import('path')} path
	 */
	function getPortableDataPath(path) {
		if (process.env['VSCODE_PORTABLE']) {
			return process.env['VSCODE_PORTABLE'];
		}

		if (process.platform === 'win32' || process.platform === 'linux') {
			return path.join(getApplicationPath(path), 'data');
		}

		// @ts-ignore
		const portableDataName = product.portable || `${product.applicationName}-portable-data`;
		return path.join(path.dirname(getApplicationPath(path)), portableDataName);
	}

	const portableDataPath = getPortableDataPath(path);
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
};
