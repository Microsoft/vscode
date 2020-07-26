/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'vs/base/common/event';
import type { IDisposable } from 'vs/base/common/lifecycle';
import { ToWebviewMessage } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';

// !! IMPORTANT !! everything must be in-line within the webviewPreloads
// function. Imports are not allowed. This is stringifies and injected into
// the webview.

declare const acquireVsCodeApi: () => ({ getState(): { [key: string]: unknown; }, setState(data: { [key: string]: unknown; }): void, postMessage: (msg: unknown) => void; });

declare class ResizeObserver {
	constructor(onChange: (entries: { target: HTMLElement, contentRect?: ClientRect; }[]) => void);
	observe(element: Element): void;
	disconnect(): void;
}

declare const __outputNodePadding__: number;

type Listener<T> = { fn: (evt: T) => void; thisArg: unknown; };

interface EmitterLike<T> {
	fire(data: T): void;
	event: Event<T>;
}

function webviewPreloads() {
	const vscode = acquireVsCodeApi();

	const handleInnerClick = (event: MouseEvent) => {
		if (!event || !event.view || !event.view.document) {
			return;
		}

		for (let node = event.target as HTMLElement | null; node; node = node.parentNode as HTMLElement) {
			if (node instanceof HTMLAnchorElement && node.href) {
				if (node.href.startsWith('blob:')) {
					handleBlobUrlClick(node.href, node.download);
				}
				event.preventDefault();
				break;
			}
		}
	};

	const handleBlobUrlClick = async (url: string, downloadName: string) => {
		try {
			const response = await fetch(url);
			const blob = await response.blob();
			const reader = new FileReader();
			reader.addEventListener('load', () => {
				const data = reader.result;
				vscode.postMessage({
					__vscode_notebook_message: true,
					type: 'clicked-data-url',
					data,
					downloadName
				});
			});
			reader.readAsDataURL(blob);
		} catch (e) {
			console.error(e.message);
		}
	};

	document.body.addEventListener('click', handleInnerClick);

	const preservedScriptAttributes: (keyof HTMLScriptElement)[] = [
		'type', 'src', 'nonce', 'noModule', 'async',
	];

	// derived from https://github.com/jquery/jquery/blob/d0ce00cdfa680f1f0c38460bc51ea14079ae8b07/src/core/DOMEval.js
	const domEval = (container: Element) => {
		const arr = Array.from(container.getElementsByTagName('script'));
		for (let n = 0; n < arr.length; n++) {
			let node = arr[n];
			let scriptTag = document.createElement('script');
			scriptTag.text = node.innerText;
			for (let key of preservedScriptAttributes) {
				const val = node[key] || node.getAttribute && node.getAttribute(key);
				if (val) {
					scriptTag.setAttribute(key, val as any);
				}
			}

			// TODO: should script with src not be removed?
			container.appendChild(scriptTag).parentNode!.removeChild(scriptTag);
		}
	};

	let outputObservers = new Map<string, ResizeObserver>();

	const resizeObserve = (container: Element, id: string) => {
		const resizeObserver = new ResizeObserver(entries => {
			for (let entry of entries) {
				if (!document.body.contains(entry.target)) {
					return;
				}

				if (entry.target.id === id && entry.contentRect) {
					vscode.postMessage({
						__vscode_notebook_message: true,
						type: 'dimension',
						id: id,
						data: {
							height: entry.contentRect.height + __outputNodePadding__ * 2
						}
					});
				}
			}
		});

		resizeObserver.observe(container);
		if (outputObservers.has(id)) {
			outputObservers.get(id)?.disconnect();
		}

		outputObservers.set(id, resizeObserver);
	};

	function scrollWillGoToParent(event: WheelEvent) {
		for (let node = event.target as Node | null; node; node = node.parentNode) {
			if (!(node instanceof Element) || node.id === 'container') {
				return false;
			}

			if (event.deltaY < 0 && node.scrollTop > 0) {
				return true;
			}

			if (event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight) {
				return true;
			}
		}

		return false;
	}

	const handleWheel = (event: WheelEvent) => {
		if (event.defaultPrevented || scrollWillGoToParent(event)) {
			return;
		}

		vscode.postMessage({
			__vscode_notebook_message: true,
			type: 'did-scroll-wheel',
			payload: {
				deltaMode: event.deltaMode,
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaZ: event.deltaZ,
				detail: event.detail,
				type: event.type
			}
		});
	};

	function focusFirstFocusableInCell(cellId: string) {
		const cellOutputContainer = document.getElementById(cellId);
		if (cellOutputContainer) {
			const focusableElement = cellOutputContainer.querySelector('[tabindex="0"], [href], button, input, option, select, textarea') as HTMLElement | null;
			focusableElement?.focus();
		}
	}

	function createFocusSink(cellId: string, outputId: string, focusNext?: boolean) {
		const element = document.createElement('div');
		element.tabIndex = 0;
		element.addEventListener('focus', () => {
			vscode.postMessage({
				__vscode_notebook_message: true,
				type: 'focus-editor',
				id: outputId,
				focusNext
			});

			setTimeout(() => { // Wait a tick to prevent the focus indicator blinking before webview blurs
				// Move focus off the focus sink - single use
				focusFirstFocusableInCell(cellId);
			}, 50);
		});

		return element;
	}

	function addMouseoverListeners(element: HTMLElement, outputId: string): void {
		element.addEventListener('mouseenter', () => {
			vscode.postMessage({
				__vscode_notebook_message: true,
				type: 'mouseenter',
				id: outputId,
				data: {}
			});
		});
		element.addEventListener('mouseleave', () => {
			vscode.postMessage({
				__vscode_notebook_message: true,
				type: 'mouseleave',
				id: outputId,
				data: {}
			});
		});
	}

	const dontEmit = Symbol('dontEmit');

	function createEmitter<T>(listenerChange: (listeners: Set<Listener<T>>) => void = () => undefined): EmitterLike<T> {
		const listeners = new Set<Listener<T>>();
		return {
			fire(data) {
				for (const listener of [...listeners]) {
					listener.fn.call(listener.thisArg, data);
				}
			},
			event(fn, thisArg, disposables) {
				const listenerObj = { fn, thisArg };
				const disposable: IDisposable = {
					dispose: () => {
						listeners.delete(listenerObj);
						listenerChange(listeners);
					},
				};

				listeners.add(listenerObj);
				listenerChange(listeners);

				if (disposables instanceof Array) {
					disposables.push(disposable);
				} else if (disposables) {
					disposables.add(disposable);
				}

				return disposable;
			},
		};
	}

	// Maps the events in the given emitter, invoking mapFn on each one. mapFn can return
	// the dontEmit symbol to skip emission.
	function mapEmitter<T, R>(emitter: EmitterLike<T>, mapFn: (data: T) => R | typeof dontEmit) {
		let listener: IDisposable;
		const mapped = createEmitter(listeners => {
			if (listeners.size && !listener) {
				listener = emitter.event(data => {
					const v = mapFn(data);
					if (v !== dontEmit) {
						mapped.fire(v);
					}
				});
			} else if (listener && !listeners.size) {
				listener.dispose();
			}
		});

		return mapped.event;
	}

	interface ICreateCellInfo {
		outputId: string;
		output?: unknown;
		mimeType?: string;
		element: HTMLElement;
	}

	interface IDestroyCellInfo {
		outputId: string;
	}

	const onWillDestroyOutput = createEmitter<[string | undefined /* namespace */, IDestroyCellInfo | undefined /* cell uri */]>();
	const onDidCreateOutput = createEmitter<[string | undefined /* namespace */, ICreateCellInfo]>();
	const onDidReceiveMessage = createEmitter<[string, unknown]>();

	const matchesNs = (namespace: string, query: string | undefined) => namespace === '*' || query === namespace || query === 'undefined';

	(window as any).acquireNotebookRendererApi = <T>(namespace: string) => {
		if (!namespace || typeof namespace !== 'string') {
			throw new Error(`acquireNotebookRendererApi should be called your renderer type as a string, got: ${namespace}.`);
		}

		return {
			postMessage(message: unknown) {
				vscode.postMessage({
					__vscode_notebook_message: true,
					type: 'customRendererMessage',
					rendererId: namespace,
					message,
				});
			},
			setState(newState: T) {
				vscode.setState({ ...vscode.getState(), [namespace]: newState });
			},
			getState(): T | undefined {
				const state = vscode.getState();
				return typeof state === 'object' && state ? state[namespace] as T : undefined;
			},
			onDidReceiveMessage: mapEmitter(onDidReceiveMessage, ([ns, data]) => ns === namespace ? data : dontEmit),
			onWillDestroyOutput: mapEmitter(onWillDestroyOutput, ([ns, data]) => matchesNs(namespace, ns) ? data : dontEmit),
			onDidCreateOutput: mapEmitter(onDidCreateOutput, ([ns, data]) => matchesNs(namespace, ns) ? data : dontEmit),
		};
	};

	/**
	 * Map of preload resource URIs to promises that resolve one the resource
	 * loads or errors.
	 */
	const preloadPromises = new Map<string, Promise<void>>();
	const queuedOuputActions = new Map<string, Promise<void>>();

	/**
	 * Enqueues an action that affects a output. This blocks behind renderer load
	 * requests that affect the same output. This should be called whenever you
	 * do something that affects output to ensure it runs in
	 * the correct order.
	 */
	const enqueueOutputAction = <T extends { outputId: string; }>(event: T, fn: (event: T) => Promise<void> | void) => {
		const queued = queuedOuputActions.get(event.outputId);
		const maybePromise = queued ? queued.then(() => fn(event)) : fn(event);
		if (typeof maybePromise === 'undefined') {
			return; // a synchonrously-called function, we're done
		}

		const promise = maybePromise.then(() => {
			if (queuedOuputActions.get(event.outputId) === promise) {
				queuedOuputActions.delete(event.outputId);
			}
		});

		queuedOuputActions.set(event.outputId, promise);
	};

	window.addEventListener('wheel', handleWheel);

	window.addEventListener('message', rawEvent => {
		const event = rawEvent as ({ data: ToWebviewMessage; });

		switch (event.data.type) {
			case 'html':
				enqueueOutputAction(event.data, async data => {
					await Promise.all(data.requiredPreloads.map(p => preloadPromises.get(p.uri)));
					if (!queuedOuputActions.has(data.outputId)) { // output was cleared while loading
						return;
					}

					let cellOutputContainer = document.getElementById(data.cellId);
					let outputId = data.outputId;
					if (!cellOutputContainer) {
						const container = document.getElementById('container')!;

						const upperWrapperElement = createFocusSink(data.cellId, outputId);
						container.appendChild(upperWrapperElement);

						let newElement = document.createElement('div');

						newElement.id = data.cellId;
						container.appendChild(newElement);
						cellOutputContainer = newElement;

						const lowerWrapperElement = createFocusSink(data.cellId, outputId, true);
						container.appendChild(lowerWrapperElement);
					}

					let outputNode = document.createElement('div');
					outputNode.style.position = 'absolute';
					outputNode.style.top = data.top + 'px';
					outputNode.style.left = data.left + 'px';
					outputNode.style.width = 'calc(100% - ' + data.left + 'px)';
					outputNode.style.minHeight = '32px';
					outputNode.id = outputId;

					addMouseoverListeners(outputNode, outputId);
					let content = data.content;
					outputNode.innerHTML = content;
					cellOutputContainer.appendChild(outputNode);

					let pureData: { mimeType: string, output: unknown } | undefined;
					const outputScript = cellOutputContainer.querySelector('script.vscode-pure-data');
					if (outputScript) {
						try { pureData = JSON.parse(outputScript.innerHTML); } catch { }
					}

					// eval
					domEval(outputNode);
					resizeObserve(outputNode, outputId);
					onDidCreateOutput.fire([data.apiNamespace, {
						element: outputNode,
						output: pureData?.output,
						mimeType: pureData?.mimeType,
						outputId
					}]);

					vscode.postMessage({
						__vscode_notebook_message: true,
						type: 'dimension',
						id: outputId,
						data: {
							height: outputNode.clientHeight
						}
					});

					// don't hide until after this step so that the height is right
					cellOutputContainer.style.display = data.initiallyHidden ? 'none' : 'block';
				});
				break;
			case 'view-scroll':
				{
					// const date = new Date();
					// console.log('----- will scroll ----  ', date.getMinutes() + ':' + date.getSeconds() + ':' + date.getMilliseconds());

					for (let i = 0; i < event.data.widgets.length; i++) {
						let widget = document.getElementById(event.data.widgets[i].id)!;
						widget.style.top = event.data.widgets[i].top + 'px';
						widget.parentElement!.style.display = 'block';
					}
					break;
				}
			case 'clear':
				queuedOuputActions.clear(); // stop all loading outputs
				onWillDestroyOutput.fire([undefined, undefined]);
				document.getElementById('container')!.innerHTML = '';

				outputObservers.forEach(ob => {
					ob.disconnect();
				});
				outputObservers.clear();
				break;
			case 'clearOutput':
				let output = document.getElementById(event.data.outputId);
				queuedOuputActions.delete(event.data.outputId); // stop any in-progress rendering
				if (output && output.parentNode) {
					onWillDestroyOutput.fire([event.data.apiNamespace, { outputId: event.data.outputId }]);
					output.parentNode.removeChild(output);
				}
				break;
			case 'hideOutput':
				enqueueOutputAction(event.data, ({ outputId }) => {
					const container = document.getElementById(outputId)?.parentElement;
					if (container) {
						container.style.display = 'none';
					}
				});
				break;
			case 'showOutput':
				enqueueOutputAction(event.data, ({ outputId, top }) => {
					let output = document.getElementById(outputId);
					if (output) {
						output.parentElement!.style.display = 'block';
						output.style.top = top + 'px';
					}
				});
				break;
			case 'preload':
				let resources = event.data.resources;
				let preloadsContainer = document.getElementById('__vscode_preloads')!;
				for (let i = 0; i < resources.length; i++) {
					const { uri } = resources[i];
					const scriptTag = document.createElement('script');
					scriptTag.setAttribute('src', uri);
					preloadsContainer.appendChild(scriptTag);
					preloadPromises.set(uri, new Promise<void>(resolve => {
						scriptTag.addEventListener('load', () => resolve());
						scriptTag.addEventListener('error', () => resolve());
					}));
				}
				break;
			case 'focus-output':
				focusFirstFocusableInCell(event.data.cellId);
				break;
			case 'decorations':
				{
					let outputContainer = document.getElementById(event.data.cellId);
					event.data.addedClassNames.forEach(n => {
						outputContainer?.classList.add(n);
					});

					event.data.removedClassNames.forEach(n => {
						outputContainer?.classList.remove(n);
					});
				}

				break;
			case 'customRendererMessage':
				onDidReceiveMessage.fire([event.data.rendererId, event.data.message]);
				break;
		}
	});

	vscode.postMessage({
		__vscode_notebook_message: true,
		type: 'initialized'
	});
}

export const preloadsScriptStr = (outputNodePadding: number) => `(${webviewPreloads})()`.replace(/__outputNodePadding__/g, `${outputNodePadding}`);
