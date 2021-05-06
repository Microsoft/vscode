/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
(function () {
	'use strict';

	const { ipcRenderer, contextBridge } = require('electron');

	/**
	 * @type {import('../../browser/pre/main').WebviewHost & {isInDevelopmentMode: boolean}}
	 */
	const host = {
		onElectron: true,
		useParentPostMessage: true,
		postMessage: (channel, data) => {
			ipcRenderer.sendToHost(channel, data);
		},
		onMessage: (channel, handler) => {
			ipcRenderer.on(channel, handler);
		},
		focusIframeOnCreate: true,
		isInDevelopmentMode: false
	};

	host.onMessage('devtools-opened', () => {
		host.isInDevelopmentMode = true;
	});

	document.addEventListener('DOMContentLoaded', e => {
		// Forward messages from the embedded iframe
		window.onmessage = (/** @type {MessageEvent} */ event) => {
			ipcRenderer.sendToHost(event.data.command, event.data.data);
		};
	});

	contextBridge.exposeInMainWorld('vscodeHost', host);
}());
