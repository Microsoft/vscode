/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'vs/base/common/event';
import type { IDisposable } from 'vs/base/common/lifecycle';
import { RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import type { FromWebviewMessage, IBlurOutputMessage, ICellDropMessage, ICellDragMessage, ICellDragStartMessage, IClickedDataUrlMessage, IDimensionMessage, IClickMarkdownPreviewMessage, IMouseEnterMarkdownPreviewMessage, IMouseEnterMessage, IMouseLeaveMarkdownPreviewMessage, IMouseLeaveMessage, IToggleMarkdownPreviewMessage, IWheelMessage, ToWebviewMessage, ICellDragEndMessage, IOutputFocusMessage, IOutputBlurMessage, DimensionUpdate, IContextMenuMarkdownPreviewMessage, ITelemetryFoundRenderedMarkdownMath, ITelemetryFoundUnrenderedMarkdownMath } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';

// !! IMPORTANT !! everything must be in-line within the webviewPreloads
// function. Imports are not allowed. This is stringified and injected into
// the webview.

declare module globalThis {
	const acquireVsCodeApi: () => ({
		getState(): { [key: string]: unknown; };
		setState(data: { [key: string]: unknown; }): void;
		postMessage: (msg: unknown) => void;
	});
}

declare class ResizeObserver {
	constructor(onChange: (entries: { target: HTMLElement, contentRect?: ClientRect; }[]) => void);
	observe(element: Element): void;
	disconnect(): void;
}

declare const __outputNodePadding__: number;
declare const __outputNodeLeftPadding__: number;

type Listener<T> = { fn: (evt: T) => void; thisArg: unknown; };

interface EmitterLike<T> {
	fire(data: T): void;
	event: Event<T>;
}

async function webviewPreloads(markdownRendererModule: any, markdownDeps: any) {
	const acquireVsCodeApi = globalThis.acquireVsCodeApi;
	const vscode = acquireVsCodeApi();
	delete (globalThis as any).acquireVsCodeApi;

	const handleInnerClick = (event: MouseEvent) => {
		if (!event || !event.view || !event.view.document) {
			return;
		}

		for (const node of event.composedPath()) {
			if (node instanceof HTMLAnchorElement && node.href) {
				if (node.href.startsWith('blob:')) {
					handleBlobUrlClick(node.href, node.download);
				} else if (node.href.startsWith('data:')) {
					handleDataUrl(node.href, node.download);
				}
				event.preventDefault();
				return;
			}
		}
	};

	const handleDataUrl = async (data: string | ArrayBuffer | null, downloadName: string) => {
		postNotebookMessage<IClickedDataUrlMessage>('clicked-data-url', {
			data,
			downloadName
		});
	};

	const handleBlobUrlClick = async (url: string, downloadName: string) => {
		try {
			const response = await fetch(url);
			const blob = await response.blob();
			const reader = new FileReader();
			reader.addEventListener('load', () => {
				handleDataUrl(reader.result, downloadName);
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
			const node = arr[n];
			const scriptTag = document.createElement('script');
			const trustedScript = ttPolicy?.createScript(node.innerText) ?? node.innerText;
			scriptTag.text = trustedScript as string;
			for (const key of preservedScriptAttributes) {
				const val = node[key] || node.getAttribute && node.getAttribute(key);
				if (val) {
					scriptTag.setAttribute(key, val as any);
				}
			}

			// TODO@connor4312: should script with src not be removed?
			container.appendChild(scriptTag).parentNode!.removeChild(scriptTag);
		}
	};

	const runScript = async (url: string, originalUri: string, globals: { [name: string]: unknown } = {}): Promise<() => (PreloadResult)> => {
		let text: string;
		try {
			const res = await fetch(url);
			text = await res.text();
			if (!res.ok) {
				throw new Error(`Unexpected ${res.status} requesting ${originalUri}: ${text || res.statusText}`);
			}

			globals.scriptUrl = url;
		} catch (e) {
			return () => ({ state: PreloadState.Error, error: e.message });
		}

		const args = Object.entries(globals);
		return () => {
			try {
				new Function(...args.map(([k]) => k), text)(...args.map(([, v]) => v));
				return { state: PreloadState.Ok };
			} catch (e) {
				console.error(e);
				return { state: PreloadState.Error, error: e.message };
			}
		};
	};

	const dimensionUpdater = new class {
		private readonly pending = new Map<string, DimensionUpdate>();

		update(id: string, height: number, options: { init?: boolean; isOutput?: boolean }) {
			if (!this.pending.size) {
				setTimeout(() => {
					this.updateImmediately();
				}, 0);
			}
			this.pending.set(id, {
				id,
				height,
				...options,
			});
		}

		updateImmediately() {
			if (!this.pending.size) {
				return;
			}

			postNotebookMessage<IDimensionMessage>('dimension', {
				updates: Array.from(this.pending.values())
			});
			this.pending.clear();
		}
	};

	const resizeObserver = new class {

		private readonly _observer: ResizeObserver;

		private readonly _observedElements = new WeakMap<Element, { id: string, output: boolean }>();

		constructor() {
			this._observer = new ResizeObserver(entries => {
				for (const entry of entries) {
					if (!document.body.contains(entry.target)) {
						continue;
					}

					const observedElementInfo = this._observedElements.get(entry.target);
					if (!observedElementInfo) {
						continue;
					}

					if (entry.target.id === observedElementInfo.id && entry.contentRect) {
						if (observedElementInfo.output) {
							let height = 0;
							if (entry.contentRect.height !== 0) {
								entry.target.style.padding = `${__outputNodePadding__}px ${__outputNodePadding__}px ${__outputNodePadding__}px ${__outputNodeLeftPadding__}px`;
								height = entry.contentRect.height + __outputNodePadding__ * 2;
							} else {
								entry.target.style.padding = `0px`;
							}
							dimensionUpdater.update(observedElementInfo.id, height, {
								isOutput: true
							});
						} else {
							dimensionUpdater.update(observedElementInfo.id, entry.target.clientHeight, {
								isOutput: false
							});
						}
					}
				}
			});
		}

		public observe(container: Element, id: string, output: boolean) {
			if (this._observedElements.has(container)) {
				return;
			}

			this._observedElements.set(container, { id, output });
			this._observer.observe(container);
		}
	};

	function scrollWillGoToParent(event: WheelEvent) {
		for (let node = event.target as Node | null; node; node = node.parentNode) {
			if (!(node instanceof Element) || node.id === 'container' || node.classList.contains('cell_container') || node.classList.contains('output_container')) {
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
		postNotebookMessage<IWheelMessage>('did-scroll-wheel', {
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
			postNotebookMessage<IBlurOutputMessage>('focus-editor', {
				id: outputId,
				focusNext
			});
		});

		return element;
	}

	function addMouseoverListeners(element: HTMLElement, outputId: string): void {
		element.addEventListener('mouseenter', () => {
			postNotebookMessage<IMouseEnterMessage>('mouseenter', {
				id: outputId,
			});
		});
		element.addEventListener('mouseleave', () => {
			postNotebookMessage<IMouseLeaveMessage>('mouseleave', {
				id: outputId,
			});
		});
	}

	function isAncestor(testChild: Node | null, testAncestor: Node | null): boolean {
		while (testChild) {
			if (testChild === testAncestor) {
				return true;
			}
			testChild = testChild.parentNode;
		}

		return false;
	}

	class FocusTracker {
		private _outputId: string;
		private _hasFocus: boolean = false;
		private _loosingFocus: boolean = false;
		private _element: HTMLElement | Window;
		constructor(element: HTMLElement | Window, outputId: string) {
			this._element = element;
			this._outputId = outputId;
			this._hasFocus = isAncestor(document.activeElement, <HTMLElement>element);
			this._loosingFocus = false;

			element.addEventListener('focus', this._onFocus.bind(this), true);
			element.addEventListener('blur', this._onBlur.bind(this), true);
		}

		private _onFocus() {
			this._loosingFocus = false;
			if (!this._hasFocus) {
				this._hasFocus = true;
				postNotebookMessage<IOutputFocusMessage>('outputFocus', {
					id: this._outputId,
				});
			}
		}

		private _onBlur() {
			if (this._hasFocus) {
				this._loosingFocus = true;
				window.setTimeout(() => {
					if (this._loosingFocus) {
						this._loosingFocus = false;
						this._hasFocus = false;
						postNotebookMessage<IOutputBlurMessage>('outputBlur', {
							id: this._outputId,
						});
					}
				}, 0);
			}
		}

		dispose() {
			if (this._element) {
				this._element.removeEventListener('focus', this._onFocus, true);
				this._element.removeEventListener('blur', this._onBlur, true);
			}
		}
	}

	const focusTrackers = new Map<string, FocusTracker>();

	function addFocusTracker(element: HTMLElement, outputId: string): void {
		if (focusTrackers.has(outputId)) {
			focusTrackers.get(outputId)?.dispose();
		}

		focusTrackers.set(outputId, new FocusTracker(element, outputId));
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
		element: HTMLElement;
		outputId: string;

		mime: string;
		value: unknown;
		metadata: unknown;
	}

	interface IDestroyCellInfo {
		outputId: string;
	}

	const onWillDestroyOutput = createEmitter<'all' | { rendererId: string, info: IDestroyCellInfo }>();
	const onDidCreateOutput = createEmitter<{ rendererId: string, info: ICreateCellInfo }>();
	const onDidReceiveKernelMessage = createEmitter<unknown>();

	const acquireNotebookRendererApi = <T>(id: string) => ({
		setState(newState: T) {
			vscode.setState({ ...vscode.getState(), [id]: newState });
		},
		getState(): T | undefined {
			const state = vscode.getState();
			return typeof state === 'object' && state ? state[id] as T : undefined;
		},
		onWillDestroyOutput: mapEmitter(onWillDestroyOutput, (evt) => {
			if (evt === 'all') {
				return undefined;
			}
			return evt.rendererId === id ? evt.info : dontEmit;
		}),
		onDidCreateOutput: mapEmitter(onDidCreateOutput, ({ rendererId, info }) => rendererId === id ? info : dontEmit),
	});

	const kernelPreloadGlobals = {
		acquireVsCodeApi,
		onDidReceiveKernelMessage: onDidReceiveKernelMessage.event,
		postKernelMessage: (data: unknown) => postNotebookMessage('customKernelMessage', { message: data }),
	};

	const enum PreloadState {
		Ok,
		Error
	}

	type PreloadResult = { state: PreloadState.Ok } | { state: PreloadState.Error, error: string };

	/**
	 * Map of preload resource URIs to promises that resolve one the resource
	 * loads or errors.
	 */
	const preloadPromises = new Map<string, Promise<PreloadResult>>();
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

	const ttPolicy = window.trustedTypes?.createPolicy('notebookOutputRenderer', {
		createHTML: value => value,
		createScript: value => value,
	});

	window.addEventListener('wheel', handleWheel);

	window.addEventListener('message', rawEvent => {
		const event = rawEvent as ({ data: ToWebviewMessage; });

		switch (event.data.type) {
			case 'initializeMarkdownPreview':
				for (const cell of event.data.cells) {
					createMarkdownPreview(cell.cellId, cell.content, cell.offset);

					const cellContainer = document.getElementById(cell.cellId);
					if (cellContainer) {
						cellContainer.style.visibility = 'hidden';
					}
				}

				dimensionUpdater.updateImmediately();
				postNotebookMessage('initializedMarkdownPreview', {});
				break;
			case 'createMarkdownPreview':
				createMarkdownPreview(event.data.id, event.data.content, event.data.top);
				break;
			case 'showMarkdownPreview':
				{
					const data = event.data;

					const cellContainer = document.getElementById(data.id);
					if (cellContainer) {
						cellContainer.style.visibility = 'visible';
						cellContainer.style.top = `${data.top}px`;
					}

					updateMarkdownPreview(data.id, data.content);
				}
				break;
			case 'hideMarkdownPreviews':
				{
					for (const id of event.data.ids) {
						const cellContainer = document.getElementById(id);
						if (cellContainer) {
							cellContainer.style.visibility = 'hidden';
						}
					}
				}
				break;
			case 'unhideMarkdownPreviews':
				{
					for (const id of event.data.ids) {
						const cellContainer = document.getElementById(id);
						if (cellContainer) {
							cellContainer.style.visibility = 'visible';
						}
						updateMarkdownPreview(id, undefined);
					}
				}
				break;
			case 'deleteMarkdownPreview':
				{
					for (const id of event.data.ids) {
						const cellContainer = document.getElementById(id);
						cellContainer?.remove();
					}
				}
				break;
			case 'updateSelectedMarkdownPreviews':
				{
					const selectedCellIds = new Set<string>(event.data.selectedCellIds);

					for (const oldSelected of document.querySelectorAll('.preview.selected')) {
						const id = oldSelected.id;
						if (!selectedCellIds.has(id)) {
							oldSelected.classList.remove('selected');
						}
					}

					for (const newSelected of selectedCellIds) {
						const previewContainer = document.getElementById(newSelected);
						if (previewContainer) {
							previewContainer.classList.add('selected');
						}
					}
				}
				break;
			case 'html':
				enqueueOutputAction(event.data, async data => {
					const preloadResults = await Promise.all(data.requiredPreloads.map(p => preloadPromises.get(p.uri)));
					if (!queuedOuputActions.has(data.outputId)) { // output was cleared while loading
						return;
					}

					let cellOutputContainer = document.getElementById(data.cellId);
					const outputId = data.outputId;
					if (!cellOutputContainer) {
						const container = document.getElementById('container')!;

						const upperWrapperElement = createFocusSink(data.cellId, outputId);
						container.appendChild(upperWrapperElement);

						const newElement = document.createElement('div');

						newElement.id = data.cellId;
						newElement.classList.add('cell_container');

						container.appendChild(newElement);
						cellOutputContainer = newElement;

						const lowerWrapperElement = createFocusSink(data.cellId, outputId, true);
						container.appendChild(lowerWrapperElement);
					}

					cellOutputContainer.style.position = 'absolute';
					cellOutputContainer.style.top = data.cellTop + 'px';

					const outputContainer = document.createElement('div');
					outputContainer.classList.add('output_container');
					outputContainer.style.position = 'absolute';
					outputContainer.style.overflow = 'hidden';
					outputContainer.style.maxHeight = '0px';
					outputContainer.style.top = `${data.outputOffset}px`;

					const outputNode = document.createElement('div');
					outputNode.classList.add('output');
					outputNode.style.position = 'absolute';
					outputNode.style.top = `0px`;
					outputNode.style.left = data.left + 'px';
					// outputNode.style.width = 'calc(100% - ' + data.left + 'px)';
					// outputNode.style.minHeight = '32px';
					outputNode.style.padding = '0px';
					outputNode.id = outputId;

					addMouseoverListeners(outputNode, outputId);
					addFocusTracker(outputNode, outputId);
					const content = data.content;
					if (content.type === RenderOutputType.Html) {
						const trustedHtml = ttPolicy?.createHTML(content.htmlContent) ?? content.htmlContent;
						outputNode.innerHTML = trustedHtml as string;
						cellOutputContainer.appendChild(outputContainer);
						outputContainer.appendChild(outputNode);
						domEval(outputNode);
					} else if (preloadResults.some(e => e?.state === PreloadState.Error)) {
						outputNode.innerText = `Error loading preloads:`;
						const errList = document.createElement('ul');
						for (const result of preloadResults) {
							if (result?.state === PreloadState.Error) {
								const item = document.createElement('li');
								item.innerText = result.error;
								errList.appendChild(item);
							}
						}
						outputNode.appendChild(errList);
						cellOutputContainer.appendChild(outputContainer);
						outputContainer.appendChild(outputNode);
					} else {
						onDidCreateOutput.fire({
							rendererId: data.rendererId!,
							info: {
								element: outputNode,
								outputId,
								mime: content.mimeType,
								value: content.value,
								metadata: content.metadata,
							}
						});
						cellOutputContainer.appendChild(outputContainer);
						outputContainer.appendChild(outputNode);
					}

					resizeObserver.observe(outputNode, outputId, true);

					const clientHeight = outputNode.clientHeight;
					const cps = document.defaultView!.getComputedStyle(outputNode);
					if (clientHeight !== 0 && cps.padding === '0px') {
						// we set padding to zero if the output height is zero (then we can have a zero-height output DOM node)
						// thus we need to ensure the padding is accounted when updating the init height of the output
						dimensionUpdater.update(outputId, clientHeight + __outputNodePadding__ * 2, {
							isOutput: true,
							init: true,
						});

						outputNode.style.padding = `${__outputNodePadding__}px ${__outputNodePadding__}px ${__outputNodePadding__}px ${__outputNodeLeftPadding__}px`;
					} else {
						dimensionUpdater.update(outputId, outputNode.clientHeight, {
							isOutput: true,
							init: true,
						});
					}

					// don't hide until after this step so that the height is right
					cellOutputContainer.style.visibility = data.initiallyHidden ? 'hidden' : 'visible';
				});
				break;
			case 'view-scroll':
				{
					// const date = new Date();
					// console.log('----- will scroll ----  ', date.getMinutes() + ':' + date.getSeconds() + ':' + date.getMilliseconds());

					for (const request of event.data.widgets) {
						const widget = document.getElementById(request.outputId);
						if (widget) {
							widget.parentElement!.parentElement!.style.top = `${request.cellTop}px`;
							widget.parentElement!.style.top = `${request.outputOffset}px`;
							if (request.forceDisplay) {
								widget.parentElement!.parentElement!.style.visibility = 'visible';
							}
						}
					}

					for (const cell of event.data.markdownPreviews) {
						const container = document.getElementById(cell.id);
						if (container) {
							container.style.top = `${cell.top}px`;
						}
					}

					break;
				}
			case 'clear':
				queuedOuputActions.clear(); // stop all loading outputs
				onWillDestroyOutput.fire('all');
				document.getElementById('container')!.innerText = '';

				focusTrackers.forEach(ft => {
					ft.dispose();
				});
				focusTrackers.clear();
				break;
			case 'clearOutput': {
				const output = document.getElementById(event.data.outputId);
				const { rendererId, outputId } = event.data;

				queuedOuputActions.delete(outputId); // stop any in-progress rendering
				if (output && output.parentNode) {
					if (rendererId) {
						onWillDestroyOutput.fire({ rendererId, info: { outputId } });
					}
					output.parentNode.removeChild(output);
				}

				break;
			}
			case 'hideOutput':
				enqueueOutputAction(event.data, ({ outputId }) => {
					const container = document.getElementById(outputId)?.parentElement?.parentElement;
					if (container) {
						container.style.visibility = 'hidden';
					}
				});
				break;
			case 'showOutput':
				enqueueOutputAction(event.data, ({ outputId, cellTop: top, }) => {
					const output = document.getElementById(outputId);
					if (output) {
						output.parentElement!.parentElement!.style.visibility = 'visible';
						output.parentElement!.parentElement!.style.top = top + 'px';

						dimensionUpdater.update(outputId, output.clientHeight, {
							isOutput: true,
						});
					}
				});
				break;
			case 'ack-dimension':
				{
					const { outputId, height } = event.data;
					const output = document.getElementById(outputId);
					if (output) {
						output.parentElement!.style.maxHeight = `${height}px`;
						output.parentElement!.style.height = `${height}px`;
					}
					break;
				}
			case 'preload':
				const resources = event.data.resources;
				let queue: Promise<PreloadResult> = Promise.resolve({ state: PreloadState.Ok });
				for (const { uri, originalUri, source } of resources) {
					const globals = source === 'kernel'
						? kernelPreloadGlobals
						: { acquireNotebookRendererApi: () => acquireNotebookRendererApi(source.rendererId) };

					// create the promise so that the scripts download in parallel, but
					// only invoke them in series within the queue
					const promise = runScript(uri, originalUri, globals);
					queue = queue.then(() => promise.then(fn => {
						const result = fn();
						if (result.state === PreloadState.Error) {
							console.error(result.error);
						}

						return result;
					}));
					preloadPromises.set(uri, queue);
				}
				break;
			case 'focus-output':
				focusFirstFocusableInCell(event.data.cellId);
				break;
			case 'decorations':
				{
					const outputContainer = document.getElementById(event.data.cellId);
					outputContainer?.classList.add(...event.data.addedClassNames);
					outputContainer?.classList.remove(...event.data.removedClassNames);
				}

				break;
			case 'customKernelMessage':
				onDidReceiveKernelMessage.fire(event.data.message);
				break;
		}
	});

	const markdownRenderer: {
		renderMarkup: (context: { element: HTMLElement, content: string }) => void,
	} = await markdownRendererModule.activate(markdownDeps);

	vscode.postMessage({
		__vscode_notebook_message: true,
		type: 'initialized'
	});

	function createMarkdownPreview(cellId: string, content: string, top: number) {
		const container = document.getElementById('container')!;
		const cellContainer = document.createElement('div');
		cellContainer.id = cellId;
		cellContainer.classList.add('preview');

		cellContainer.style.position = 'absolute';
		cellContainer.style.top = top + 'px';
		container.appendChild(cellContainer);

		cellContainer.addEventListener('dblclick', () => {
			postNotebookMessage<IToggleMarkdownPreviewMessage>('toggleMarkdownPreview', { cellId });
		});

		cellContainer.addEventListener('click', e => {
			postNotebookMessage<IClickMarkdownPreviewMessage>('clickMarkdownPreview', {
				cellId,
				altKey: e.altKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				shiftKey: e.shiftKey,
			});
		});

		cellContainer.addEventListener('contextmenu', e => {
			postNotebookMessage<IContextMenuMarkdownPreviewMessage>('contextMenuMarkdownPreview', {
				cellId,
				clientX: e.clientX,
				clientY: e.clientY,
			});
		});

		cellContainer.addEventListener('mouseenter', () => {
			postNotebookMessage<IMouseEnterMarkdownPreviewMessage>('mouseEnterMarkdownPreview', { cellId });
		});

		cellContainer.addEventListener('mouseleave', () => {
			postNotebookMessage<IMouseLeaveMarkdownPreviewMessage>('mouseLeaveMarkdownPreview', { cellId });
		});

		cellContainer.setAttribute('draggable', 'true');

		cellContainer.addEventListener('dragstart', e => {
			markdownPreviewDragManager.startDrag(e, cellId);
		});

		cellContainer.addEventListener('drag', e => {
			markdownPreviewDragManager.updateDrag(e, cellId);
		});

		cellContainer.addEventListener('dragend', e => {
			markdownPreviewDragManager.endDrag(e, cellId);
		});

		const previewRoot = cellContainer.attachShadow({ mode: 'open' });

		// Add default webview style
		const defaultStyles = document.getElementById('_defaultStyles') as HTMLStyleElement;
		previewRoot.appendChild(defaultStyles.cloneNode(true));

		// Add default preview style
		const previewStyles = document.getElementById('preview-styles') as HTMLTemplateElement;
		previewRoot.appendChild(previewStyles.content.cloneNode(true));

		const previewNode = document.createElement('div');
		previewNode.id = 'preview';
		previewRoot.appendChild(previewNode);

		updateMarkdownPreview(cellId, content);

		resizeObserver.observe(cellContainer, cellId, false);
	}

	function postNotebookMessage<T extends FromWebviewMessage>(
		type: T['type'],
		properties: Omit<T, '__vscode_notebook_message' | 'type'>
	) {
		vscode.postMessage({
			__vscode_notebook_message: true,
			type,
			...properties
		});
	}

	let hasPostedRenderedMathTelemetry = false;
	const unsupportedKatexTermsRegex = /(\\(?:abovewithdelims|array|Arrowvert|arrowvert|atopwithdelims|bbox|bracevert|buildrel|cancelto|cases|class|cssId|ddddot|dddot|DeclareMathOperator|definecolor|displaylines|enclose|eqalign|eqalignno|eqref|hfil|hfill|idotsint|iiiint|label|leftarrowtail|leftroot|leqalignno|lower|mathtip|matrix|mbox|mit|mmlToken|moveleft|moveright|mspace|newenvironment|Newextarrow|notag|oldstyle|overparen|overwithdelims|pmatrix|raise|ref|renewenvironment|require|root|Rule|scr|shoveleft|shoveright|sideset|skew|Space|strut|style|texttip|Tiny|toggle|underparen|unicode|uproot)\b)/g;

	function updateMarkdownPreview(cellId: string, content: string | undefined) {
		const previewContainerNode = document.getElementById(cellId);
		if (!previewContainerNode) {
			return;
		}

		const previewRoot = previewContainerNode.shadowRoot;
		const previewNode = previewRoot?.getElementById('preview');
		if (!previewNode) {
			return;
		}

		// TODO: handle namespace
		if (typeof content === 'string') {
			if (content.trim().length === 0) {
				previewContainerNode.classList.add('emptyMarkdownCell');
				previewNode.innerText = '';
			} else {
				previewContainerNode.classList.remove('emptyMarkdownCell');
				markdownRenderer.renderMarkup({
					element: previewNode,
					content: content
				});

				if (!hasPostedRenderedMathTelemetry) {
					const hasRenderedMath = previewNode.querySelector('.katex');
					if (hasRenderedMath) {
						hasPostedRenderedMathTelemetry = true;
						postNotebookMessage<ITelemetryFoundRenderedMarkdownMath>('telemetryFoundRenderedMarkdownMath', {});
					}
				}

				const matches = previewNode.innerText.match(unsupportedKatexTermsRegex);
				if (matches) {
					postNotebookMessage<ITelemetryFoundUnrenderedMarkdownMath>('telemetryFoundUnrenderedMarkdownMath', {
						latexDirective: matches[0],
					});
				}
			}
		}

		dimensionUpdater.update(cellId, previewContainerNode.clientHeight, {
			isOutput: false
		});
	}

	const markdownPreviewDragManager = new class MarkdownPreviewDragManager {

		private currentDrag: { cellId: string, clientY: number } | undefined;

		constructor() {
			document.addEventListener('dragover', e => {
				// Allow dropping dragged markdown cells
				e.preventDefault();
			});

			document.addEventListener('drop', e => {
				e.preventDefault();

				const drag = this.currentDrag;
				if (!drag) {
					return;
				}

				this.currentDrag = undefined;
				postNotebookMessage<ICellDropMessage>('cell-drop', {
					cellId: drag.cellId,
					ctrlKey: e.ctrlKey,
					altKey: e.altKey,
					position: { clientY: e.clientY },
				});
			});
		}

		startDrag(e: DragEvent, cellId: string) {
			if (!e.dataTransfer) {
				return;
			}

			this.currentDrag = { cellId, clientY: e.clientY };

			(e.target as HTMLElement).classList.add('dragging');

			postNotebookMessage<ICellDragStartMessage>('cell-drag-start', {
				cellId: cellId,
				position: { clientY: e.clientY },
			});

			// Continuously send updates while dragging instead of relying on `updateDrag`.
			// This lets us scroll the list based on drag position.
			const trySendDragUpdate = () => {
				if (this.currentDrag?.cellId !== cellId) {
					return;
				}

				postNotebookMessage<ICellDragMessage>('cell-drag', {
					cellId: cellId,
					position: { clientY: this.currentDrag.clientY },
				});
				requestAnimationFrame(trySendDragUpdate);
			};
			requestAnimationFrame(trySendDragUpdate);
		}

		updateDrag(e: DragEvent, cellId: string) {
			if (cellId !== this.currentDrag?.cellId) {
				this.currentDrag = undefined;
			}
			this.currentDrag = { cellId, clientY: e.clientY };
		}

		endDrag(e: DragEvent, cellId: string) {
			this.currentDrag = undefined;
			(e.target as HTMLElement).classList.remove('dragging');
			postNotebookMessage<ICellDragEndMessage>('cell-drag-end', {
				cellId: cellId
			});
		}
	}();
}

export function preloadsScriptStr(styleValues: {
	outputNodePadding: number;
	outputNodeLeftPadding: number;
}, markdownRenderer: {
	entrypoint: string,
	dependencies: Array<{ entrypoint: string }>,
}) {
	const markdownCtx = {
		dependencies: markdownRenderer.dependencies,
	};

	return `
	import * as markdownRendererModule from "${markdownRenderer.entrypoint}";
	(${webviewPreloads})(markdownRendererModule, JSON.parse(decodeURIComponent("${encodeURIComponent(JSON.stringify(markdownCtx))}")))`
		.replace(/__outputNodePadding__/g, `${styleValues.outputNodePadding}`)
		.replace(/__outputNodeLeftPadding__/g, `${styleValues.outputNodeLeftPadding}`);
}
