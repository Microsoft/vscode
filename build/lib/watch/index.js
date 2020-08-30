/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const watch = process.platform === 'win32' ? require('./watch-win32') : require('vscode-gulp-watch');

module.exports = function () {
	return watch.apply(null, arguments);
};
