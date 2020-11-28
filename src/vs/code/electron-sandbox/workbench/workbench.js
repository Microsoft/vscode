/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference path="../../../../typings/require.d.ts" />

//@ts-check
'use strict';

(function () {
	const bootstrapWindow = bootstrapWindowLib();

	// Add a perf entry right from the top
	const perf = bootstrapWindow.perfLib();
	perf.mark('renderer/started');

	// Load workbench main JS, CSS and NLS all in parallel. This is an
	// optimization to prevent a waterfall of loading to happen, because
	// we know for a fact that workbench.desktop.sandbox.main will depend on
	// the related CSS and NLS counterparts.
	bootstrapWindow.load([
		'vs/workbench/workbench.desktop.sandbox.main',
		'vs/nls!vs/workbench/workbench.desktop.main',
		'vs/css!vs/workbench/workbench.desktop.main'
	],
		async function (workbench, configuration) {

			// Mark start of workbench
			perf.mark('didLoadWorkbenchMain');

			// @ts-ignore
			return require('vs/workbench/electron-sandbox/desktop.main').main(configuration);
		},
		{
			removeDeveloperKeybindingsAfterLoad: true,
			canModifyDOM: function (windowConfig) {
				// TODO@sandbox part-splash is non-sandboxed only
			},
			beforeLoaderConfig: function (windowConfig, loaderConfig) {
				loaderConfig.recordStats = true;
			},
			beforeRequire: function () {
				perf.mark('willLoadWorkbenchMain');
			}
		}
	);


	//region Helpers

	/**
	 * @returns {{
	 *   load: (modules: string[], resultCallback: (result, configuration: object) => any, options: object) => unknown,
	 *   globals: () => typeof import('../../../base/parts/sandbox/electron-sandbox/globals'),
	 *   perfLib: () => { mark: (name: string) => void }
	 * }}
	 */
	function bootstrapWindowLib() {
		// @ts-ignore (defined in bootstrap-window.js)
		return window.MonacoBootstrapWindow;
	}

	//#endregion

}());
