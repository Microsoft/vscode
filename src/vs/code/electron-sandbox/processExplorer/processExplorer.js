/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

/**
 * @type {{ load: (modules: string[], resultCallback: (result, configuration: object) => any, options: object) => unknown }}
 */
const bootstrapWindow = (() => {
	// @ts-ignore (defined in bootstrap-window.js)
	return window.MonacoBootstrapWindow;
})();

bootstrapWindow.load(['vs/code/electron-sandbox/processExplorer/processExplorerMain'], function (processExplorer, configuration) {
	processExplorer.startup(configuration.windowId, configuration.data);
}, { forceEnableDeveloperKeybindings: true });
