/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference path="../../../../typings/require.d.ts" />

//@ts-check
(function () {
	'use strict';

	const bootstrapWindow = bootstrapWindowLib();

	// Add a perf entry right from the top
	performance.mark('code/didStartRenderer');

	// Load workbench main JS, CSS and NLS all in parallel. This is an
	// optimization to prevent a waterfall of loading to happen, because
	// we know for a fact that workbench.desktop.main will depend on
	// the related CSS and NLS counterparts.
	bootstrapWindow.load([
		'vs/workbench/workbench.desktop.main',
		'vs/nls!vs/workbench/workbench.desktop.main',
		'vs/css!vs/workbench/workbench.desktop.main'
	],
		function (_, configuration) {

			// Mark start of workbench
			performance.mark('code/didLoadWorkbenchMain');

			// @ts-ignore
			return require('vs/workbench/electron-browser/desktop.main').main(configuration);
		},
		{
			configureDeveloperSettings: function (windowConfig) {
				return {
					// disable automated devtools opening on error when running extension tests
					// as this can lead to undeterministic test exectuion (devtools steals focus)
					forceDisableShowDevtoolsOnError: typeof windowConfig.extensionTestsPath === 'string',
					// enable devtools keybindings in extension development window
					forceEnableDeveloperKeybindings: Array.isArray(windowConfig.extensionDevelopmentPath) && windowConfig.extensionDevelopmentPath.length > 0,
					removeDeveloperKeybindingsAfterLoad: true
				};
			},
			canModifyDOM: function (windowConfig) {
				showPartsSplash(windowConfig);
			},
			beforeLoaderConfig: function (loaderConfig) {
				loaderConfig.recordStats = true;
			},
			beforeRequire: function () {
				performance.mark('code/willLoadWorkbenchMain');

				// It looks like browsers only lazily enable
				// the <canvas> element when needed. Since we
				// leverage canvas elements in our code in many
				// locations, we try to help the browser to
				// initialize canvas when it is idle, right
				// before we wait for the scripts to be loaded.
				// @ts-ignore
				window.requestIdleCallback(() => {
					const canvas = document.createElement('canvas');
					const context = canvas.getContext('2d');
					context.clearRect(0, 0, canvas.width, canvas.height);
					canvas.remove();
				}, { timeout: 50 });
			}
		}
	);

	// add default trustedTypes-policy for logging and to workaround
	// lib/platform limitations
	window.trustedTypes?.createPolicy('default', {
		createHTML(value) {
			// see https://github.com/electron/electron/issues/27211
			// Electron webviews use a static innerHTML default value and
			// that isn't trusted. We use a default policy to check for the
			// exact value of that innerHTML-string and only allow that.
			if (value === '<!DOCTYPE html><style type="text/css">:host { display: flex; }</style>') {
				return value;
			}
			throw new Error('UNTRUSTED html usage, default trusted types policy should NEVER be reached');
			// console.trace('UNTRUSTED html usage, default trusted types policy should NEVER be reached');
			// return value;
		}
	});

	//#region Helpers

	/**
	 * @typedef {import('../../../platform/windows/common/windows').INativeWindowConfiguration} INativeWindowConfiguration
	 * @typedef {import('../../../platform/environment/common/argv').NativeParsedArgs} NativeParsedArgs
	 *
	 * @returns {{
	 *   load: (
	 *     modules: string[],
	 *     resultCallback: (result, configuration: INativeWindowConfiguration & NativeParsedArgs) => unknown,
	 *     options?: {
	 *       configureDeveloperSettings?: (config: INativeWindowConfiguration & NativeParsedArgs) => {
	 * 			forceDisableShowDevtoolsOnError?: boolean,
	 * 			forceEnableDeveloperKeybindings?: boolean,
	 * 			disallowReloadKeybinding?: boolean,
	 * 			removeDeveloperKeybindingsAfterLoad?: boolean
	 * 		 },
	 * 	     canModifyDOM?: (config: INativeWindowConfiguration & NativeParsedArgs) => void,
	 * 	     beforeLoaderConfig?: (loaderConfig: object) => void,
	 *       beforeRequire?: () => void
	 *     }
	 *   ) => Promise<unknown>
	 * }}
	 */
	function bootstrapWindowLib() {
		// @ts-ignore (defined in bootstrap-window.js)
		return window.MonacoBootstrapWindow;
	}

	/**
	 * @param {INativeWindowConfiguration & NativeParsedArgs} configuration
	 */
	function showPartsSplash(configuration) {
		performance.mark('code/willShowPartsSplash');

		let data = configuration.partsSplash;

		// high contrast mode has been turned on from the outside, e.g. OS -> ignore stored colors and layouts
		const isHighContrast = configuration.colorScheme.highContrast && configuration.autoDetectHighContrast;
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

		// restore parts if possible (we might not always store layout info)
		if (data && data.layoutInfo) {
			const { layoutInfo, colorInfo } = data;
			const splash = document.createElement('div');
			splash.id = 'monaco-parts-splash';
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
			if (configuration.workspace) {

				// folder or workspace -> status bar color, sidebar
				const sideDiv = document.createElement('div');
				sideDiv.setAttribute('style', `position: absolute; height: calc(100% - ${layoutInfo.titleBarHeight}px); top: ${layoutInfo.titleBarHeight}px; ${layoutInfo.sideBarSide}: ${layoutInfo.activityBarWidth}px; width: ${layoutInfo.sideBarWidth}px; background-color: ${colorInfo.sideBarBackground};`);
				splash.appendChild(sideDiv);
			}

			// part: statusbar
			const statusDiv = document.createElement('div');
			statusDiv.setAttribute('style', `position: absolute; width: 100%; bottom: 0; left: 0; height: ${layoutInfo.statusBarHeight}px; background-color: ${configuration.workspace ? colorInfo.statusBarBackground : colorInfo.statusBarNoFolderBackground};`);
			splash.appendChild(statusDiv);

			document.body.appendChild(splash);
		}

		performance.mark('code/didShowPartsSplash');
	}

	//#endregion
}());
