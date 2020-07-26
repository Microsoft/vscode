/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';
const CopyPlugin = require('copy-webpack-plugin');
const { lchmod } = require('graceful-fs');
const Terser = require('terser');

const withBrowserDefaults = require('../shared.webpack.config').browser;

module.exports = withBrowserDefaults({
	context: __dirname,
	entry: {
		extension: './src/extension.browser.ts',
	},
	plugins: [
		// @ts-ignore
		new CopyPlugin({
			patterns: [
				{
					from: 'node_modules/typescript-web-server/*.d.ts',
					to: 'typescript-web/',
					flatten: true
				},
			],
		}),
		// @ts-ignore
		new CopyPlugin({
			patterns: [
				{
					from: 'node_modules/typescript-web-server/tsserver.js',
					to: 'typescript-web/tsserver.web.js',
					transform: (content) => {
						return Terser.minify(content.toString()).code;

					},
					transformPath: (targetPath) => {
						return targetPath.replace('tsserver.js', 'tsserver.web.js');
					}
				}
			],
		}),
	],
});
