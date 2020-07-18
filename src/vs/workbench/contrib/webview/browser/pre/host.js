/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
(function () {
	const id = document.location.search.match(/\bid=([\w-]+)/)[1];
	const onElectron = /platform=electron/.test(document.location.search);

	const hostMessaging = new class HostMessaging {
		constructor() {
			this.handlers = new Map();
			window.addEventListener('message', (e) => {
				if (e.data && (e.data.command === 'onmessage' || e.data.command === 'do-update-state')) {
					// Came from inner iframe
					this.postMessage(e.data.command, e.data.data);
					return;
				}

				const channel = e.data.channel;
				const handler = this.handlers.get(channel);
				if (handler) {
					handler(e, e.data.args);
				} else {
					console.log('no handler for ', e);
				}
			});
		}

		postMessage(channel, data) {
			window.parent.postMessage({ target: id, channel, data }, '*');
		}

		onMessage(channel, handler) {
			this.handlers.set(channel, handler);
		}
	}();

	const workerReady = new Promise(async (resolveWorkerReady) => {
		if (onElectron) {
			return resolveWorkerReady();
		}

		if (!areServiceWorkersEnabled()) {
			console.log('Service Workers are not enabled. Webviews will not work properly');
			return resolveWorkerReady();
		}

		const expectedWorkerVersion = 1;

		navigator.serviceWorker.register('service-worker.js').then(async registration => {
			await navigator.serviceWorker.ready;

			const versionHandler = (event) => {
				if (event.data.channel !== 'version') {
					return;
				}

				navigator.serviceWorker.removeEventListener('message', versionHandler);
				if (event.data.version === expectedWorkerVersion) {
					return resolveWorkerReady();
				} else {
					// If we have the wrong version, try once to unregister and re-register
					return registration.update()
						.then(() => navigator.serviceWorker.ready)
						.finally(resolveWorkerReady);
				}
			};
			navigator.serviceWorker.addEventListener('message', versionHandler);
			registration.active.postMessage({ channel: 'version' });
		});

		const forwardFromHostToWorker = (channel) => {
			hostMessaging.onMessage(channel, event => {
				navigator.serviceWorker.ready.then(registration => {
					registration.active.postMessage({ channel: channel, data: event.data.args });
				});
			});
		};
		forwardFromHostToWorker('did-load-resource');
		forwardFromHostToWorker('did-load-localhost');

		navigator.serviceWorker.addEventListener('message', event => {
			if (['load-resource', 'load-localhost'].includes(event.data.channel)) {
				hostMessaging.postMessage(event.data.channel, event.data);
			}
		});
	});

	function areServiceWorkersEnabled() {
		try {
			return !!navigator.serviceWorker;
		} catch (e) {
			return false;
		}
	}

	/** @type {import('./main').WebviewHost} */
	const host = {
		postMessage: hostMessaging.postMessage.bind(hostMessaging),
		onMessage: hostMessaging.onMessage.bind(hostMessaging),
		ready: workerReady,
		fakeLoad: !onElectron,
		rewriteCSP: onElectron
			? (csp) => {
				return csp.replace(/vscode-resource:(?=(\s|;|$))/g, 'vscode-webview-resource:');
			}
			: (csp, endpoint) => {
				const endpointUrl = new URL(endpoint);
				return csp.replace(/(vscode-webview-resource|vscode-resource):(?=(\s|;|$))/g, endpointUrl.origin);
			}
	};

	(/** @type {any} */ (window)).createWebviewManager(host);
}());
