/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const loader = require('./vs/loader');
const bootstrap = require('./bootstrap');

// Bootstrap: NLS
const nlsConfig = bootstrap.setupNLS();

// Bootstrap: Loader
loader.config({
	baseUrl: bootstrap.fileUriFromPath(__dirname),
	catchError: true,
	nodeRequire: require,
	nodeMain: __filename,
	'vs/nls': nlsConfig
});

// Running in Electron
if (process.env['ELECTRON_RUN_AS_NODE'] || process.versions['electron']) {
	loader.define('fs', ['original-fs'], function (originalFS) {
		return originalFS;  // replace the patched electron fs with the original node fs for all AMD code
	});
}

// Pseudo NLS support
if (nlsConfig.pseudo) {
	loader(['vs/nls'], function (nlsPlugin) {
		nlsPlugin.setPseudoTranslation(nlsConfig.pseudo);
	});
}

exports.load = function (entrypoint, onLoad, onError) {
	if (!entrypoint) {
		return;
	}

	// cached data config
	if (process.env['VSCODE_NODE_CACHED_DATA_DIR']) {
		loader.config({
			nodeCachedData: {
				path: process.env['VSCODE_NODE_CACHED_DATA_DIR'],
				seed: entrypoint
			}
		});
	}

	onLoad = onLoad || function () { };
	onError = onError || function (err) { console.error(err); };

	loader([entrypoint], onLoad, onError);
};
