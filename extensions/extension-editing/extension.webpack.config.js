/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const withDefaults = require('../shared.webpack.config');

module.exports = withDefaults({
	context: __dirname,
	entry: {
		extension: './src/extensionEditingMain.ts',
	},
	output: {
		filename: 'extensionEditingMain.js'
	},
	externals: {
		'../../../product.json': 'commonjs ../../../product.json',
		'typescript': 'commonjs typescript'
	}
});
