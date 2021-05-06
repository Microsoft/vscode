/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

/**
 * @typedef {{
 *   postMessage: (channel: string, data?: any) => void,
 *   onMessage: (channel: string, handler: any) => void,
 *   focusIframeOnCreate?: boolean,
 *   ready?: Promise<void>,
 *   onIframeLoaded?: (iframe: HTMLIFrameElement) => void,
 *   onElectron?: boolean,
 *   useParentPostMessage: boolean,
 * }} WebviewHost
 */

const isSafari = navigator.vendor && navigator.vendor.indexOf('Apple') > -1 &&
	navigator.userAgent &&
	navigator.userAgent.indexOf('CriOS') === -1 &&
	navigator.userAgent.indexOf('FxiOS') === -1;

const searchParams = new URL(location.toString()).searchParams;
const ID = searchParams.get('id');

/**
 * Use polling to track focus of main webview and iframes within the webview
 *
 * @param {Object} handlers
 * @param {() => void} handlers.onFocus
 * @param {() => void} handlers.onBlur
 */
const trackFocus = ({ onFocus, onBlur }) => {
	const interval = 50;
	let isFocused = document.hasFocus();
	setInterval(() => {
		const isCurrentlyFocused = document.hasFocus();
		if (isCurrentlyFocused === isFocused) {
			return;
		}
		isFocused = isCurrentlyFocused;
		if (isCurrentlyFocused) {
			onFocus();
		} else {
			onBlur();
		}
	}, interval);
};

const getActiveFrame = () => {
	return /** @type {HTMLIFrameElement} */ (document.getElementById('active-frame'));
};

const getPendingFrame = () => {
	return /** @type {HTMLIFrameElement} */ (document.getElementById('pending-frame'));
};

const vscodePostMessageFuncName = '__vscode_post_message__';

const defaultStyles = document.createElement('style');
defaultStyles.id = '_defaultStyles';
defaultStyles.textContent = `
	html {
		scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-editor-background);
	}

	body {
		background-color: transparent;
		color: var(--vscode-editor-foreground);
		font-family: var(--vscode-font-family);
		font-weight: var(--vscode-font-weight);
		font-size: var(--vscode-font-size);
		margin: 0;
		padding: 0 20px;
	}

	img {
		max-width: 100%;
		max-height: 100%;
	}

	a {
		color: var(--vscode-textLink-foreground);
	}

	a:hover {
		color: var(--vscode-textLink-activeForeground);
	}

	a:focus,
	input:focus,
	select:focus,
	textarea:focus {
		outline: 1px solid -webkit-focus-ring-color;
		outline-offset: -1px;
	}

	code {
		color: var(--vscode-textPreformat-foreground);
	}

	blockquote {
		background: var(--vscode-textBlockQuote-background);
		border-color: var(--vscode-textBlockQuote-border);
	}

	kbd {
		color: var(--vscode-editor-foreground);
		border-radius: 3px;
		vertical-align: middle;
		padding: 1px 3px;

		background-color: hsla(0,0%,50%,.17);
		border: 1px solid rgba(71,71,71,.4);
		border-bottom-color: rgba(88,88,88,.4);
		box-shadow: inset 0 -1px 0 rgba(88,88,88,.4);
	}
	.vscode-light kbd {
		background-color: hsla(0,0%,87%,.5);
		border: 1px solid hsla(0,0%,80%,.7);
		border-bottom-color: hsla(0,0%,73%,.7);
		box-shadow: inset 0 -1px 0 hsla(0,0%,73%,.7);
	}

	::-webkit-scrollbar {
		width: 10px;
		height: 10px;
	}

	::-webkit-scrollbar-corner {
		background-color: var(--vscode-editor-background);
	}

	::-webkit-scrollbar-thumb {
		background-color: var(--vscode-scrollbarSlider-background);
	}
	::-webkit-scrollbar-thumb:hover {
		background-color: var(--vscode-scrollbarSlider-hoverBackground);
	}
	::-webkit-scrollbar-thumb:active {
		background-color: var(--vscode-scrollbarSlider-activeBackground);
	}`;

/**
 * @param {boolean} allowMultipleAPIAcquire
 * @param {boolean} useParentPostMessage
 * @param {*} [state]
 * @return {string}
 */
function getVsCodeApiScript(allowMultipleAPIAcquire, useParentPostMessage, state) {
	const encodedState = state ? encodeURIComponent(state) : undefined;
	return /* js */`
			globalThis.acquireVsCodeApi = (function() {
				const originalPostMessage = window.parent['${useParentPostMessage ? 'postMessage' : vscodePostMessageFuncName}'].bind(window.parent);
				const doPostMessage = (channel, data, transfer) => {
					${useParentPostMessage
			? `originalPostMessage({ command: channel, data: data }, '*', transfer);`
			: `originalPostMessage(channel, data, transfer);`
		}
				};

				let acquired = false;

				let state = ${state ? `JSON.parse(decodeURIComponent("${encodedState}"))` : undefined};

				return () => {
					if (acquired && !${allowMultipleAPIAcquire}) {
						throw new Error('An instance of the VS Code API has already been acquired');
					}
					acquired = true;
					return Object.freeze({
						postMessage: function(message, transfer) {
							doPostMessage('onmessage', { message, transfer }, transfer);
						},
						setState: function(newState) {
							state = newState;
							doPostMessage('do-update-state', JSON.stringify(newState));
							return newState;
						},
						getState: function() {
							return state;
						}
					});
				};
			})();
			delete window.parent;
			delete window.top;
			delete window.frameElement;
		`;
}

/** @type {Promise<void>} */
const workerReady = new Promise(async (resolve, reject) => {
	if (!areServiceWorkersEnabled()) {
		return reject(new Error('Service Workers are not enabled in browser. Webviews will not work.'));
	}

	const expectedWorkerVersion = 1;

	navigator.serviceWorker.register(`service-worker.js${self.location.search}`).then(
		async registration => {
			await navigator.serviceWorker.ready;

			const versionHandler = (event) => {
				if (event.data.channel !== 'version') {
					return;
				}

				navigator.serviceWorker.removeEventListener('message', versionHandler);
				if (event.data.version === expectedWorkerVersion) {
					return resolve();
				} else {
					// If we have the wrong version, try once to unregister and re-register
					return registration.update()
						.then(() => navigator.serviceWorker.ready)
						.finally(resolve);
				}
			};
			navigator.serviceWorker.addEventListener('message', versionHandler);
			registration.active.postMessage({ channel: 'version' });
		},
		error => {
			reject(new Error(`Could not register service workers: ${error}.`));
		});
});

/**
 * @param {WebviewHost} host
 */
export async function createWebviewManager(host) {
	// state
	let firstLoad = true;
	let loadTimeout;
	let styleVersion = 0;

	/** @type {Array<{ readonly message: any, transfer?: ArrayBuffer[] }>} */
	let pendingMessages = [];

	const initData = {
		/** @type {number | undefined} */
		initialScrollProgress: undefined,

		/** @type {{ [key: string]: string }} */
		styles: undefined,

		/** @type {string | undefined} */
		activeTheme: undefined,

		/** @type {string | undefined} */
		themeName: undefined,
	};

	host.onMessage('did-load-resource', (_event, data) => {
		navigator.serviceWorker.ready.then(registration => {
			registration.active.postMessage({ channel: 'did-load-resource', data }, data.data?.buffer ? [data.data.buffer] : []);
		});
	});

	host.onMessage('did-load-localhost', (_event, data) => {
		navigator.serviceWorker.ready.then(registration => {
			registration.active.postMessage({ channel: 'did-load-localhost', data });
		});
	});

	navigator.serviceWorker.addEventListener('message', event => {
		switch (event.data.channel) {
			case 'load-resource':
			case 'load-localhost':
				host.postMessage(event.data.channel, event.data);
				return;
		}
	});
	/**
	 * @param {HTMLDocument?} document
	 * @param {HTMLElement?} body
	 */
	const applyStyles = (document, body) => {
		if (!document) {
			return;
		}

		if (body) {
			body.classList.remove('vscode-light', 'vscode-dark', 'vscode-high-contrast');
			body.classList.add(initData.activeTheme);

			body.dataset.vscodeThemeKind = initData.activeTheme;
			body.dataset.vscodeThemeName = initData.themeName || '';
		}

		if (initData.styles) {
			const documentStyle = document.documentElement.style;

			// Remove stale properties
			for (let i = documentStyle.length - 1; i >= 0; i--) {
				const property = documentStyle[i];

				// Don't remove properties that the webview might have added separately
				if (property && property.startsWith('--vscode-')) {
					documentStyle.removeProperty(property);
				}
			}

			// Re-add new properties
			for (const variable of Object.keys(initData.styles)) {
				documentStyle.setProperty(`--${variable}`, initData.styles[variable]);
			}
		}
	};

	/**
	 * @param {MouseEvent} event
	 */
	const handleInnerClick = (event) => {
		if (!event || !event.view || !event.view.document) {
			return;
		}

		const baseElement = event.view.document.getElementsByTagName('base')[0];

		for (const pathElement of event.composedPath()) {
			/** @type {any} */
			const node = pathElement;
			if (node.tagName && node.tagName.toLowerCase() === 'a' && node.href) {
				if (node.getAttribute('href') === '#') {
					event.view.scrollTo(0, 0);
				} else if (node.hash && (node.getAttribute('href') === node.hash || (baseElement && node.href === baseElement.href + node.hash))) {
					const scrollTarget = event.view.document.getElementById(node.hash.substr(1, node.hash.length - 1));
					if (scrollTarget) {
						scrollTarget.scrollIntoView();
					}
				} else {
					host.postMessage('did-click-link', node.href.baseVal || node.href);
				}
				event.preventDefault();
				return;
			}
		}
	};

	/**
	 * @param {MouseEvent} event
	 */
	const handleAuxClick =
		(event) => {
			// Prevent middle clicks opening a broken link in the browser
			if (!event.view || !event.view.document) {
				return;
			}

			if (event.button === 1) {
				for (const pathElement of event.composedPath()) {
					/** @type {any} */
					const node = pathElement;
					if (node.tagName && node.tagName.toLowerCase() === 'a' && node.href) {
						event.preventDefault();
						return;
					}
				}
			}
		};

	/**
	 * @param {KeyboardEvent} e
	 */
	const handleInnerKeydown = (e) => {
		// If the keypress would trigger a browser event, such as copy or paste,
		// make sure we block the browser from dispatching it. Instead VS Code
		// handles these events and will dispatch a copy/paste back to the webview
		// if needed
		if (isUndoRedo(e) || isPrint(e)) {
			e.preventDefault();
		} else if (isCopyPasteOrCut(e)) {
			if (host.onElectron) {
				e.preventDefault();
			} else {
				return; // let the browser handle this
			}
		}

		host.postMessage('did-keydown', {
			key: e.key,
			keyCode: e.keyCode,
			code: e.code,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
			repeat: e.repeat
		});
	};
	/**
	 * @param {KeyboardEvent} e
	 */
	const handleInnerUp = (e) => {
		host.postMessage('did-keyup', {
			key: e.key,
			keyCode: e.keyCode,
			code: e.code,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
			ctrlKey: e.ctrlKey,
			metaKey: e.metaKey,
			repeat: e.repeat
		});
	};

	/**
	 * @param {KeyboardEvent} e
	 * @return {boolean}
	 */
	function isCopyPasteOrCut(e) {
		const hasMeta = e.ctrlKey || e.metaKey;
		const shiftInsert = e.shiftKey && e.key.toLowerCase() === 'insert';
		return (hasMeta && ['c', 'v', 'x'].includes(e.key.toLowerCase())) || shiftInsert;
	}

	/**
	 * @param {KeyboardEvent} e
	 * @return {boolean}
	 */
	function isUndoRedo(e) {
		const hasMeta = e.ctrlKey || e.metaKey;
		return hasMeta && ['z', 'y'].includes(e.key.toLowerCase());
	}

	/**
	 * @param {KeyboardEvent} e
	 * @return {boolean}
	 */
	function isPrint(e) {
		const hasMeta = e.ctrlKey || e.metaKey;
		return hasMeta && e.key.toLowerCase() === 'p';
	}

	let isHandlingScroll = false;

	const handleWheel = (event) => {
		if (isHandlingScroll) {
			return;
		}

		host.postMessage('did-scroll-wheel', {
			deltaMode: event.deltaMode,
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			deltaZ: event.deltaZ,
			detail: event.detail,
			type: event.type
		});
	};

	const handleInnerScroll = (event) => {
		if (!event.target || !event.target.body) {
			return;
		}
		if (isHandlingScroll) {
			return;
		}

		const progress = event.currentTarget.scrollY / event.target.body.clientHeight;
		if (isNaN(progress)) {
			return;
		}

		isHandlingScroll = true;
		window.requestAnimationFrame(() => {
			try {
				host.postMessage('did-scroll', progress);
			} catch (e) {
				// noop
			}
			isHandlingScroll = false;
		});
	};

	/**
	 * @return {string}
	 */
	function toContentHtml(data) {
		const options = data.options;
		const text = data.contents;
		const newDocument = new DOMParser().parseFromString(text, 'text/html');

		newDocument.querySelectorAll('a').forEach(a => {
			if (!a.title) {
				a.title = a.getAttribute('href');
			}
		});

		// Inject default script
		if (options.allowScripts) {
			const defaultScript = newDocument.createElement('script');
			defaultScript.id = '_vscodeApiScript';
			defaultScript.textContent = getVsCodeApiScript(options.allowMultipleAPIAcquire, host.useParentPostMessage, data.state);
			newDocument.head.prepend(defaultScript);
		}

		// Inject default styles
		newDocument.head.prepend(defaultStyles.cloneNode(true));

		applyStyles(newDocument, newDocument.body);

		// Check for CSP
		const csp = newDocument.querySelector('meta[http-equiv="Content-Security-Policy"]');
		if (!csp) {
			host.postMessage('no-csp-found');
		} else {
			try {
				// Attempt to rewrite CSPs that hardcode old-style resource endpoint
				const endpointUrl = new URL(data.resourceEndpoint);
				const newCsp = csp.getAttribute('content').replace(/(vscode-webview-resource|vscode-resource):(?=(\s|;|$))/g, endpointUrl.origin);
				csp.setAttribute('content', newCsp);
			} catch (e) {
				console.error(`Could not rewrite csp: ${e}`);
			}
		}

		// set DOCTYPE for newDocument explicitly as DOMParser.parseFromString strips it off
		// and DOCTYPE is needed in the iframe to ensure that the user agent stylesheet is correctly overridden
		return '<!DOCTYPE html>\n' + newDocument.documentElement.outerHTML;
	}

	onDomReady(() => {
		if (!document.body) {
			return;
		}

		host.onMessage('styles', (_event, data) => {
			++styleVersion;

			initData.styles = data.styles;
			initData.activeTheme = data.activeTheme;
			initData.themeName = data.themeName;

			const target = getActiveFrame();
			if (!target) {
				return;
			}

			if (target.contentDocument) {
				applyStyles(target.contentDocument, target.contentDocument.body);
			}
		});

		// propagate focus
		host.onMessage('focus', () => {
			const activeFrame = getActiveFrame();
			if (!activeFrame || !activeFrame.contentWindow) {
				// Focus the top level webview instead
				window.focus();
				return;
			}

			if (document.activeElement === activeFrame) {
				// We are already focused on the iframe (or one of its children) so no need
				// to refocus.
				return;
			}

			activeFrame.contentWindow.focus();
		});

		// update iframe-contents
		let updateId = 0;
		host.onMessage('content', async (_event, data) => {
			const currentUpdateId = ++updateId;

			try {
				await workerReady;
			} catch (e) {
				console.error(`Webview fatal error: ${e}`);
				host.postMessage('fatal-error', { message: e + '' });
				return;
			}

			if (currentUpdateId !== updateId) {
				return;
			}

			const options = data.options;
			const newDocument = toContentHtml(data);

			const initialStyleVersion = styleVersion;

			const frame = getActiveFrame();
			const wasFirstLoad = firstLoad;
			// keep current scrollY around and use later
			let setInitialScrollPosition;
			if (firstLoad) {
				firstLoad = false;
				setInitialScrollPosition = (body, window) => {
					if (!isNaN(initData.initialScrollProgress)) {
						if (window.scrollY === 0) {
							window.scroll(0, body.clientHeight * initData.initialScrollProgress);
						}
					}
				};
			} else {
				const scrollY = frame && frame.contentDocument && frame.contentDocument.body ? frame.contentWindow.scrollY : 0;
				setInitialScrollPosition = (body, window) => {
					if (window.scrollY === 0) {
						window.scroll(0, scrollY);
					}
				};
			}

			// Clean up old pending frames and set current one as new one
			const previousPendingFrame = getPendingFrame();
			if (previousPendingFrame) {
				previousPendingFrame.setAttribute('id', '');
				document.body.removeChild(previousPendingFrame);
			}
			if (!wasFirstLoad) {
				pendingMessages = [];
			}

			const newFrame = document.createElement('iframe');
			newFrame.setAttribute('id', 'pending-frame');
			newFrame.setAttribute('frameborder', '0');
			newFrame.setAttribute('sandbox', options.allowScripts ? 'allow-scripts allow-forms allow-same-origin allow-pointer-lock allow-downloads' : 'allow-same-origin allow-pointer-lock');
			newFrame.setAttribute('allow', `${options.allowScripts ? 'clipboard-read; clipboard-write;' : ''} ${options.allowWebUSB ? 'usb;' : ''}`);
			// We should just be able to use srcdoc, but I wasn't
			// seeing the service worker applying properly.
			// Fake load an empty on the correct origin and then write real html
			// into it to get around this.
			newFrame.src = `./fake.html?id=${ID}`;

			newFrame.style.cssText = 'display: block; margin: 0; overflow: hidden; position: absolute; width: 100%; height: 100%; visibility: hidden';
			document.body.appendChild(newFrame);

			/**
			 * @param {Document} contentDocument
			 */
			function onFrameLoaded(contentDocument) {
				// Workaround for https://bugs.chromium.org/p/chromium/issues/detail?id=978325
				setTimeout(() => {
					contentDocument.open();
					contentDocument.write(newDocument);
					contentDocument.close();
					hookupOnLoadHandlers(newFrame);

					if (initialStyleVersion !== styleVersion) {
						applyStyles(contentDocument, contentDocument.body);
					}
				}, 0);
			}

			if (!options.allowScripts && isSafari) {
				// On Safari for iframes with scripts disabled, the `DOMContentLoaded` never seems to be fired.
				// Use polling instead.
				const interval = setInterval(() => {
					// If the frame is no longer mounted, loading has stopped
					if (!newFrame.parentElement) {
						clearInterval(interval);
						return;
					}

					if (newFrame.contentDocument.readyState !== 'loading') {
						clearInterval(interval);
						onFrameLoaded(newFrame.contentDocument);
					}
				}, 10);
			} else {
				newFrame.contentWindow.addEventListener('DOMContentLoaded', e => {
					const contentDocument = e.target ? (/** @type {HTMLDocument} */ (e.target)) : undefined;
					onFrameLoaded(contentDocument);
				});
			}

			/**
			 * @param {Document} contentDocument
			 * @param {Window} contentWindow
			 */
			const onLoad = (contentDocument, contentWindow) => {
				if (contentDocument && contentDocument.body) {
					// Workaround for https://github.com/microsoft/vscode/issues/12865
					// check new scrollY and reset if necessary
					setInitialScrollPosition(contentDocument.body, contentWindow);
				}

				const newFrame = getPendingFrame();
				if (newFrame && newFrame.contentDocument && newFrame.contentDocument === contentDocument) {
					const oldActiveFrame = getActiveFrame();
					if (oldActiveFrame) {
						document.body.removeChild(oldActiveFrame);
					}
					// Styles may have changed since we created the element. Make sure we re-style
					if (initialStyleVersion !== styleVersion) {
						applyStyles(newFrame.contentDocument, newFrame.contentDocument.body);
					}
					newFrame.setAttribute('id', 'active-frame');
					newFrame.style.visibility = 'visible';
					if (host.focusIframeOnCreate) {
						newFrame.contentWindow.focus();
					}

					contentWindow.addEventListener('scroll', handleInnerScroll);
					contentWindow.addEventListener('wheel', handleWheel);

					if (document.hasFocus()) {
						contentWindow.focus();
					}

					pendingMessages.forEach((message) => {
						contentWindow.postMessage(message.message, '*', message.transfer);
					});
					pendingMessages = [];
				}

				host.postMessage('did-load');
			};

			/**
			 * @param {HTMLIFrameElement} newFrame
			 */
			function hookupOnLoadHandlers(newFrame) {
				clearTimeout(loadTimeout);
				loadTimeout = undefined;
				loadTimeout = setTimeout(() => {
					clearTimeout(loadTimeout);
					loadTimeout = undefined;
					onLoad(newFrame.contentDocument, newFrame.contentWindow);
				}, 200);

				newFrame.contentWindow.addEventListener('load', function (e) {
					const contentDocument = /** @type {Document} */ (e.target);

					if (loadTimeout) {
						clearTimeout(loadTimeout);
						loadTimeout = undefined;
						onLoad(contentDocument, this);
					}
				});

				// Bubble out various events
				newFrame.contentWindow.addEventListener('click', handleInnerClick);
				newFrame.contentWindow.addEventListener('auxclick', handleAuxClick);
				newFrame.contentWindow.addEventListener('keydown', handleInnerKeydown);
				newFrame.contentWindow.addEventListener('keyup', handleInnerUp);
				newFrame.contentWindow.addEventListener('contextmenu', e => {
					e.preventDefault();
					host.postMessage('did-context-menu', {
						clientX: e.clientX,
						clientY: e.clientY,
					});
				});

				if (host.onIframeLoaded) {
					host.onIframeLoaded(newFrame);
				}
			}

			host.postMessage('did-set-content', undefined);
		});

		// Forward message to the embedded iframe
		host.onMessage('message', (_event, /** @type {{message: any, transfer?: ArrayBuffer[] }} */ data) => {
			const pending = getPendingFrame();
			if (!pending) {
				const target = getActiveFrame();
				if (target) {
					target.contentWindow.postMessage(data.message, '*', data.transfer);
					return;
				}
			}
			pendingMessages.push(data);
		});

		host.onMessage('initial-scroll-position', (_event, progress) => {
			initData.initialScrollProgress = progress;
		});

		host.onMessage('execCommand', (_event, data) => {
			const target = getActiveFrame();
			if (!target) {
				return;
			}
			target.contentDocument.execCommand(data);
		});

		trackFocus({
			onFocus: () => host.postMessage('did-focus'),
			onBlur: () => host.postMessage('did-blur')
		});

		(/** @type {any} */ (window))[vscodePostMessageFuncName] = (command, data, transfer) => {
			switch (command) {
				case 'onmessage':
				case 'do-update-state':
					host.postMessage(command, data);
					break;
			}
		};

		// signal ready
		host.postMessage('webview-ready', {});
	});
}

/**
 * @param {() => void} callback
 */
function onDomReady(callback) {
	if (document.readyState === 'interactive' || document.readyState === 'complete') {
		callback();
	} else {
		document.addEventListener('DOMContentLoaded', callback);
	}
}

function areServiceWorkersEnabled() {
	try {
		return !!navigator.serviceWorker;
	} catch (e) {
		return false;
	}
}
