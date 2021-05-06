/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
	context: path.resolve(__dirname),
	entry: {
		index: './preview-src/index.ts',
	},
	mode: 'production',
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/
			}
		]
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js']
	},
	output: {
		filename: '[name].js',
		path: path.resolve(__dirname, 'media')
	},
	plugins: [
		// @ts-ignore
		new CopyPlugin({
			patterns: [
				{
					from: './node_modules/vscode-codicons/dist/codicon.css',
					to: 'codicon.css'
				},
				{
					from: './node_modules/vscode-codicons/dist/codicon.ttf',
					to: 'codicon.ttf'
				},
			],
		}),
	]
};
