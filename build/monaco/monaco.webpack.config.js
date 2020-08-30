/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const path = require('path');

module.exports = {
	mode: 'production',
	entry: {
		'core': './build/monaco/esm.core.js',
		'editor.worker': './out-monaco-editor-core/esm/vs/editor/editor.worker.js'
	},
	output: {
		globalObject: 'self',
		filename: '[name].bundle.js',
		path: path.resolve(__dirname, 'dist')
	},
	module: {
		rules: [{
			test: /\.css$/,
			use: ['style-loader', 'css-loader']
		}, {
			test: /\.ttf$/,
			use: ['file-loader']
		}]
	},
	resolve: {
		alias: {
			'monaco-editor-core': path.resolve(__dirname, '../../out-monaco-editor-core/esm/vs/editor/editor.main.js'),
		}
	},
	stats: {
		all: false,
		modules: true,
		maxModules: 0,
		errors: true,
		warnings: true,
		// our additional options
		moduleTrace: true,
		errorDetails: true,
		chunks: true
	}
};
