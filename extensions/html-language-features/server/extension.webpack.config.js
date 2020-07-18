/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../../shared.webpack.config');
const path = require('path');

module.exports = withDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/node/htmlServerMain.ts',
	},
	output: {
		filename: 'htmlServerMain.js',
		path: path.join(__dirname, 'dist', 'node'),
	},
	externals: {
		'typescript': 'commonjs typescript'
	}
});
