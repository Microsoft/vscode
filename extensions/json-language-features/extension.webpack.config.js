/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../shared.webpack.config');
const path = require('path');
const webpack = require('webpack');

const config = withDefaults({
	context: path.join(__dirname, 'client'),
	entry: {
		extension: './src/node/jsonClientMain.ts'
	},
	output: {
		filename: 'jsonClientMain.js',
		path: path.join(__dirname, 'client', 'dist', 'node')
	}
});

// add plugin, don't replace inherited
config.plugins.push(new webpack.IgnorePlugin(/vertx/)); // request-light dependency

module.exports = config;
