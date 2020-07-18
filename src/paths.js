/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const pkg = require('../package.json');
const path = require('path');
const os = require('os');

/**
 * @param {string} platform
 * @returns {string}
 */
function getAppDataPath(platform) {
	switch (platform) {
		case 'win32': return process.env['VSCODE_APPDATA'] || process.env['APPDATA'] || path.join(process.env['USERPROFILE'], 'AppData', 'Roaming');
		case 'darwin': return process.env['VSCODE_APPDATA'] || path.join(os.homedir(), 'Library', 'Application Support');
		case 'linux': return process.env['VSCODE_APPDATA'] || process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
		default: throw new Error('Platform not supported');
	}
}

/**
 * @param {string} platform
 * @returns {string}
 */
function getDefaultUserDataPath(platform) {
	return path.join(getAppDataPath(platform), pkg.name);
}

exports.getAppDataPath = getAppDataPath;
exports.getDefaultUserDataPath = getDefaultUserDataPath;
