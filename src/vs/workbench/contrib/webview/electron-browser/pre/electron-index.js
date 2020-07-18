/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
(function () {
	'use strict';

	const registerVscodeResourceScheme = (function () {
		let hasRegistered = false;
		return () => {
			if (hasRegistered) {
				return;
			}
			hasRegistered = true;
		};
	}());

	const ipcRenderer = require('electron').ipcRenderer;

	let isInDevelopmentMode = false;

	/**
	 * @type {import('../../browser/pre/main').WebviewHost}
	 */
	const host = {
		postMessage: (channel, data) => {
			ipcRenderer.sendToHost(channel, data);
		},
		onMessage: (channel, handler) => {
			ipcRenderer.on(channel, handler);
		},
		focusIframeOnCreate: true,
		onIframeLoaded: (newFrame) => {
			newFrame.contentWindow.onbeforeunload = () => {
				if (isInDevelopmentMode) { // Allow reloads while developing a webview
					host.postMessage('do-reload');
					return false;
				}
				// Block navigation when not in development mode
				console.log('prevented webview navigation');
				return false;
			};

			// Electron 4 eats mouseup events from inside webviews
			// https://github.com/microsoft/vscode/issues/75090
			// Try to fix this by rebroadcasting mouse moves and mouseups so that we can
			// emulate these on the main window
			let isMouseDown = false;
			newFrame.contentWindow.addEventListener('mousedown', () => {
				isMouseDown = true;
			});

			const tryDispatchSyntheticMouseEvent = (e) => {
				if (!isMouseDown) {
					host.postMessage('synthetic-mouse-event', { type: e.type, screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY });
				}
			};
			newFrame.contentWindow.addEventListener('mouseup', e => {
				tryDispatchSyntheticMouseEvent(e);
				isMouseDown = false;
			});
			newFrame.contentWindow.addEventListener('mousemove', tryDispatchSyntheticMouseEvent);
		},
		rewriteCSP: (csp) => {
			return csp.replace(/vscode-resource:(?=(\s|;|$))/g, 'vscode-webview-resource:');
		},
	};

	host.onMessage('devtools-opened', () => {
		isInDevelopmentMode = true;
	});

	document.addEventListener('DOMContentLoaded', () => {
		registerVscodeResourceScheme();

		// Forward messages from the embedded iframe
		window.onmessage = (message) => {
			ipcRenderer.sendToHost(message.data.command, message.data.data);
		};
	});

	require('../../browser/pre/main')(host);
}());
