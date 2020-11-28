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
	// we know for a fact that workbench.desktop.main will depend on
	// the related CSS and NLS counterparts.
	bootstrapWindow.load([
		'vs/workbench/workbench.desktop.main',
		'vs/nls!vs/workbench/workbench.desktop.main',
		'vs/css!vs/workbench/workbench.desktop.main'
	],
		async function (workbench, configuration) {

			// Mark start of workbench
			perf.mark('didLoadWorkbenchMain');

			// @ts-ignore
			return require('vs/workbench/electron-browser/desktop.main').main(configuration);
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

	/**
	 * @param {{
	 *	partsSplashPath?: string,
	 *	colorScheme: ('light' | 'dark' | 'hc'),
	 *	autoDetectHighContrast?: boolean,
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
		const isHighContrast = configuration.colorScheme === 'hc' /* ColorScheme.HIGH_CONTRAST */ && configuration.autoDetectHighContrast;
		if (data && isHighContrast && data.baseTheme !== 'hc-black') {
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
		} else if (isHighContrast) {
			baseTheme = 'hc-black';
			shellBackground = '#000000';
			shellForeground = '#FFFFFF';
		} else {
			baseTheme = 'vs-dark';
			shellBackground = '#1E1E1E';
			shellForeground = '#CCCCCC';
		}
		const style = document.createElement('style');
		style.className = 'initialShellColors';
		document.head.appendChild(style);
		style.textContent = `body { background-color: ${shellBackground}; color: ${shellForeground}; margin: 0; padding: 0; }`;

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

			// part: title
			const titleDiv = document.createElement('div');
			titleDiv.setAttribute('style', `position: absolute; width: 100%; left: 0; top: 0; height: ${layoutInfo.titleBarHeight}px; background-color: ${colorInfo.titleBarBackground}; -webkit-app-region: drag;`);
			splash.appendChild(titleDiv);

			// part: activity bar
			const activityDiv = document.createElement('div');
			activityDiv.setAttribute('style', `position: absolute; height: calc(100% - ${layoutInfo.titleBarHeight}px); top: ${layoutInfo.titleBarHeight}px; ${layoutInfo.sideBarSide}: 0; width: ${layoutInfo.activityBarWidth}px; background-color: ${colorInfo.activityBarBackground};`);
			splash.appendChild(activityDiv);

			// part: side bar (only when opening workspace/folder)
			if (configuration.folderUri || configuration.workspace) {
				// folder or workspace -> status bar color, sidebar
				const sideDiv = document.createElement('div');
				sideDiv.setAttribute('style', `position: absolute; height: calc(100% - ${layoutInfo.titleBarHeight}px); top: ${layoutInfo.titleBarHeight}px; ${layoutInfo.sideBarSide}: ${layoutInfo.activityBarWidth}px; width: ${layoutInfo.sideBarWidth}px; background-color: ${colorInfo.sideBarBackground};`);
				splash.appendChild(sideDiv);
			}

			// part: statusbar
			const statusDiv = document.createElement('div');
			statusDiv.setAttribute('style', `position: absolute; width: 100%; bottom: 0; left: 0; height: ${layoutInfo.statusBarHeight}px; background-color: ${configuration.folderUri || configuration.workspace ? colorInfo.statusBarBackground : colorInfo.statusBarNoFolderBackground};`);
			splash.appendChild(statusDiv);

			document.body.appendChild(splash);
		}

		perf.mark('didShowPartsSplash');
	}

	//#endregion

}());
