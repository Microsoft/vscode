/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

/**
 * @type {{ load: (modules: string[], resultCallback: (result, configuration: object) => any, options?: object) => unknown }}
 */
const bootstrapWindow = (() => {
	// @ts-ignore (defined in bootstrap-window.js)
	return window.MonacoBootstrapWindow;
})();

/**
 * @type {{ avoidMonkeyPatchFromAppInsights: () => void; }}
 */
const bootstrap = (() => {
	// @ts-ignore (defined in bootstrap.js)
	return window.MonacoBootstrap;
})();

// Avoid Monkey Patches from Application Insights
bootstrap.avoidMonkeyPatchFromAppInsights();

bootstrapWindow.load(['vs/code/electron-browser/sharedProcess/sharedProcessMain'], function (sharedProcess, configuration) {
	sharedProcess.startup({
		machineId: configuration.machineId,
		windowId: configuration.windowId
	});
});
