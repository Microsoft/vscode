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
 * @returns {string}
 */
function getDefaultUserDataPath() {

	// Support global VSCODE_APPDATA environment variable
	let appDataPath = process.env['VSCODE_APPDATA'];

	// Otherwise check per platform
	if (!appDataPath) {
		switch (process.platform) {
			case 'win32':
				appDataPath = process.env['APPDATA'];
				if (!appDataPath) {
					const userProfile = process.env['USERPROFILE'];
					if (typeof userProfile !== 'string') {
						throw new Error('Windows: Unexpected undefined %USERPROFILE% environment variable');
					}
					appDataPath = path.join(userProfile, 'AppData', 'Roaming');
				}
				break;
			case 'darwin':
				appDataPath = path.join(os.homedir(), 'Library', 'Application Support');
				break;
			case 'linux':
				appDataPath = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
				break;
			default:
				throw new Error('Platform not supported');
		}
	}

	return path.join(appDataPath, pkg.name);
}

exports.getDefaultUserDataPath = getDefaultUserDataPath;
