/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../../shared.webpack.config');
const path = require('path');

module.exports = withDefaults({
	context: path.join(__dirname),
	entry: {
		extension: './src/node/cssServerMain.ts',
	},
	output: {
		filename: 'cssServerMain.js',
		path: path.join(__dirname, 'dist', 'node'),
	}
});
