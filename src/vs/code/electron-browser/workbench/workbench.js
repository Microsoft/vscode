/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference path="../../../../typings/require.d.ts" />

//@ts-check
'use strict';

const perf = (function () {
	globalThis.MonacoPerformanceMarks = globalThis.MonacoPerformanceMarks || [];
	return {
		/**
		 * @param {string} name
		 */
		mark(name) {
			globalThis.MonacoPerformanceMarks.push(name, Date.now());
		}
	};
})();

perf.mark('renderer/started');

/**
 * @type {{
 *   load: (modules: string[], resultCallback: (result, configuration: object) => any, options: object) => unknown,
 *   globals: () => typeof import('../../../base/parts/sandbox/electron-sandbox/globals')
 * }}
 */
const bootstrapWindow = (() => {
	// @ts-ignore (defined in bootstrap-window.js)
	return window.MonacoBootstrapWindow;
})();

// Setup shell environment
process['lazyEnv'] = getLazyEnv();

// Load workbench main JS, CSS and NLS all in parallel. This is an
// optimization to prevent a waterfall of loading to happen, because
// we know for a fact that workbench.desktop.main will depend on
// the related CSS and NLS counterparts.
bootstrapWindow.load([
	'vs/workbench/workbench.desktop.main',
	'vs/nls!vs/workbench/workbench.desktop.main',
	'vs/css!vs/workbench/workbench.desktop.main'
],
	function (workbench, configuration) {

		// Mark start of workbench
		perf.mark('didLoadWorkbenchMain');
		performance.mark('workbench-start');

		return process['lazyEnv'].then(function () {
			perf.mark('main/startup');

			// @ts-ignore
			return require('vs/workbench/electron-browser/desktop.main').main(configuration);
		});
	},
	{
		removeDeveloperKeybindingsAfterLoad: true,
		canModifyDOM: function (windowConfig) {
			showPartsSplash(windowConfig);
		},
		beforeLoaderConfig: function (windowConfig, loaderConfig) {
			loaderConfig.recordStats = true;
		},
		beforeRequire: function () {
			perf.mark('willLoadWorkbenchMain');
		}
	}
);

/**
 * @param {{
 *	partsSplashPath?: string,
 *	highContrast?: boolean,
 *	defaultThemeType?: string,
 *	extensionDevelopmentPath?: string[],
 *	folderUri?: object,
 *	workspace?: object
 * }} configuration
 */
function showPartsSplash(configuration) {
	perf.mark('willShowPartsSplash');

	let data;
	if (typeof configuration.partsSplashPath === 'string') {
		try {
			data = JSON.parse(require.__$__nodeRequire('fs').readFileSync(configuration.partsSplashPath, 'utf8'));
		} catch (e) {
			// ignore
		}
	}

	// high contrast mode has been turned on from the outside, e.g. OS -> ignore stored colors and layouts
	if (data && configuration.highContrast && data.baseTheme !== 'hc-black') {
		data = undefined;
	}

	// developing an extension -> ignore stored layouts
	if (data && configuration.extensionDevelopmentPath) {
		data.layoutInfo = undefined;
	}

	// minimal color configuration (works with or without persisted data)
	let baseTheme, shellBackground, shellForeground;
	if (data) {
		baseTheme = data.baseTheme;
		shellBackground = data.colorInfo.editorBackground;
		shellForeground = data.colorInfo.foreground;
	} else if (configuration.highContrast || configuration.defaultThemeType === 'hc') {
		baseTheme = 'hc-black';
		shellBackground = '#000000';
		shellForeground = '#FFFFFF';
	} else if (configuration.defaultThemeType === 'vs') {
		baseTheme = 'vs';
		shellBackground = '#FFFFFF';
		shellForeground = '#000000';
	} else {
		baseTheme = 'vs-dark';
		shellBackground = '#1E1E1E';
		shellForeground = '#CCCCCC';
	}
	const style = document.createElement('style');
	style.className = 'initialShellColors';
	document.head.appendChild(style);
	style.innerHTML = `body { background-color: ${shellBackground}; color: ${shellForeground}; margin: 0; padding: 0; }`;

	if (data && data.layoutInfo) {
		// restore parts if possible (we might not always store layout info)
		const { id, layoutInfo, colorInfo } = data;
		const splash = document.createElement('div');
		splash.id = id;
		splash.className = baseTheme;

		if (layoutInfo.windowBorder) {
			splash.style.position = 'relative';
			splash.style.height = 'calc(100vh - 2px)';
			splash.style.width = 'calc(100vw - 2px)';
			splash.style.border = '1px solid var(--window-border-color)';
			splash.style.setProperty('--window-border-color', colorInfo.windowBorder);

			if (layoutInfo.windowBorderRadius) {
				splash.style.borderRadius = layoutInfo.windowBorderRadius;
			}
		}

		// ensure there is enough space
		layoutInfo.sideBarWidth = Math.min(layoutInfo.sideBarWidth, window.innerWidth - (layoutInfo.activityBarWidth + layoutInfo.editorPartMinWidth));

		if (configuration.folderUri || configuration.workspace) {
			// folder or workspace -> status bar color, sidebar
			splash.innerHTML = `
			<div style="position: absolute; width: 100%; left: 0; top: 0; height: ${layoutInfo.titleBarHeight}px; background-color: ${colorInfo.titleBarBackground}; -webkit-app-region: drag;"></div>
			<div style="position: absolute; height: calc(100% - ${layoutInfo.titleBarHeight}px); top: ${layoutInfo.titleBarHeight}px; ${layoutInfo.sideBarSide}: 0; width: ${layoutInfo.activityBarWidth}px; background-color: ${colorInfo.activityBarBackground};"></div>
			<div style="position: absolute; height: calc(100% - ${layoutInfo.titleBarHeight}px); top: ${layoutInfo.titleBarHeight}px; ${layoutInfo.sideBarSide}: ${layoutInfo.activityBarWidth}px; width: ${layoutInfo.sideBarWidth}px; background-color: ${colorInfo.sideBarBackground};"></div>
			<div style="position: absolute; width: 100%; bottom: 0; left: 0; height: ${layoutInfo.statusBarHeight}px; background-color: ${colorInfo.statusBarBackground};"></div>
			`;
		} else {
			// empty -> speical status bar color, no sidebar
			splash.innerHTML = `
			<div style="position: absolute; width: 100%; left: 0; top: 0; height: ${layoutInfo.titleBarHeight}px; background-color: ${colorInfo.titleBarBackground}; -webkit-app-region: drag;"></div>
			<div style="position: absolute; height: calc(100% - ${layoutInfo.titleBarHeight}px); top: ${layoutInfo.titleBarHeight}px; ${layoutInfo.sideBarSide}: 0; width: ${layoutInfo.activityBarWidth}px; background-color: ${colorInfo.activityBarBackground};"></div>
			<div style="position: absolute; width: 100%; bottom: 0; left: 0; height: ${layoutInfo.statusBarHeight}px; background-color: ${colorInfo.statusBarNoFolderBackground};"></div>
			`;
		}
		document.body.appendChild(splash);
	}

	perf.mark('didShowPartsSplash');
}

/**
 * @returns {Promise<void>}
 */
function getLazyEnv() {
	const ipcRenderer = bootstrapWindow.globals().ipcRenderer;

	return new Promise(function (resolve) {
		const handle = setTimeout(function () {
			resolve();
			console.warn('renderer did not receive lazyEnv in time');
		}, 10000);

		ipcRenderer.once('vscode:acceptShellEnv', function (event, shellEnv) {
			clearTimeout(handle);
			Object.assign(process.env, shellEnv);
			// @ts-ignore
			resolve(process.env);
		});

		ipcRenderer.send('vscode:fetchShellEnv');
	});
}
