/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

import { createWebviewManager } from './main.js';

const id = document.location.search.match(/\bid=([\w-]+)/)[1];
const onElectron = /platform=electron/.test(document.location.search);

const hostMessaging = new class HostMessaging {
	constructor() {
		/** @type {Map<string, Array<(event: MessageEvent, data: any) => void>>} */
		this.handlers = new Map();

		window.addEventListener('message', (e) => {
			const channel = e.data.channel;
			const handlers = this.handlers.get(channel);
			if (handlers) {
				for (const handler of handlers) {
					handler(e, e.data.args);
				}
			} else {
				console.log('no handler for ', e);
			}
		});
	}

	/**
	 * @param {string} channel
	 * @param {any} data
	 */
	postMessage(channel, data) {
		window.parent.postMessage({ target: id, channel, data }, '*');
	}

	/**
	 * @param {string} channel
	 * @param {(event: MessageEvent, data: any) => void} handler
	 */
	onMessage(channel, handler) {
		let handlers = this.handlers.get(channel);
		if (!handlers) {
			handlers = [];
			this.handlers.set(channel, handlers);
		}
		handlers.push(handler);
	}
}();

const unloadMonitor = new class {

	constructor() {
		this.confirmBeforeClose = 'keyboardOnly';
		this.isModifierKeyDown = false;

		hostMessaging.onMessage('set-confirm-before-close', (_e, /** @type {string} */ data) => {
			this.confirmBeforeClose = data;
		});

		hostMessaging.onMessage('content', (_e, /** @type {any} */ data) => {
			this.confirmBeforeClose = data.confirmBeforeClose;
		});

		window.addEventListener('beforeunload', (event) => {
			if (onElectron) {
				return;
			}

			switch (this.confirmBeforeClose) {
				case 'always':
					{
						event.preventDefault();
						event.returnValue = '';
						return '';
					}
				case 'never':
					{
						break;
					}
				case 'keyboardOnly':
				default: {
					if (this.isModifierKeyDown) {
						event.preventDefault();
						event.returnValue = '';
						return '';
					}
					break;
				}
			}
		});
	}

	onIframeLoaded(/** @type {HTMLIFrameElement} */frame) {
		frame.contentWindow.addEventListener('keydown', e => {
			this.isModifierKeyDown = e.metaKey || e.ctrlKey || e.altKey;
		});

		frame.contentWindow.addEventListener('keyup', () => {
			this.isModifierKeyDown = false;
		});
	}
};

createWebviewManager({
	postMessage: hostMessaging.postMessage.bind(hostMessaging),
	onMessage: hostMessaging.onMessage.bind(hostMessaging),
	onElectron: onElectron,
	useParentPostMessage: false,
	onIframeLoaded: (frame) => {
		unloadMonitor.onIframeLoaded(frame);
	}
});
