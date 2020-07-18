/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withBrowserDefaults = require('../shared.webpack.config').browser;
const path = require('path');

module.exports = withBrowserDefaults({
	context: path.join(__dirname, 'client'),
	entry: {
		extension: './src/browser/htmlClientMain.ts'
	},
	output: {
		filename: 'htmlClientMain.js',
		path: path.join(__dirname, 'client', 'dist', 'browser')
	}
});
