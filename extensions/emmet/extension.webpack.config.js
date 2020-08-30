/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');

const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/node/emmetNodeMain.ts',
	},
	output: {
		path: path.join(__dirname, 'dist', 'node'),
		filename: 'emmetNodeMain.js'
	},
	externals: {
		'vscode-emmet-helper': 'commonjs vscode-emmet-helper',
	},
});
