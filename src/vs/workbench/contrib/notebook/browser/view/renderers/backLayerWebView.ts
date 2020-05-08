/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import * as path from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IWebviewService, WebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewResourceScheme } from 'vs/workbench/contrib/webview/common/resourceLoader';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { CELL_MARGIN, CELL_RUN_GUTTER } from 'vs/workbench/contrib/notebook/browser/constants';
import { Emitter, Event } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { isWeb } from 'vs/base/common/platform';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

export interface IDimensionMessage {
	__vscode_notebook_message: boolean;
	type: 'dimension';
	id: string;
	data: DOM.Dimension;
}

export interface IMouseEnterMessage {
	__vscode_notebook_message: boolean;
	type: 'mouseenter';
	id: string;
}

export interface IMouseLeaveMessage {
	__vscode_notebook_message: boolean;
	type: 'mouseleave';
	id: string;
}

export interface IWheelMessage {
	__vscode_notebook_message: boolean;
	type: 'did-scroll-wheel';
	payload: any;
}


export interface IScrollAckMessage {
	__vscode_notebook_message: boolean;
	type: 'scroll-ack';
	data: { top: number };
	version: number;
}

export interface IClearMessage {
	type: 'clear';
}

export interface ICreationRequestMessage {
	type: 'html';
	content: string;
	id: string;
	outputId: string;
	top: number;
	left: number;
}

export interface IContentWidgetTopRequest {
	id: string;
	top: number;
	left: number;
}

export interface IViewScrollTopRequestMessage {
	type: 'view-scroll';
	top?: number;
	widgets: IContentWidgetTopRequest[];
	version: number;
}

export interface IScrollRequestMessage {
	type: 'scroll';
	id: string;
	top: number;
	widgetTop?: number;
	version: number;
}

export interface IUpdatePreloadResourceMessage {
	type: 'preload';
	resources: string[];
}

type IMessage = IDimensionMessage | IScrollAckMessage | IWheelMessage | IMouseEnterMessage | IMouseLeaveMessage;

let version = 0;
export class BackLayerWebView extends Disposable {
	element: HTMLElement;
	webview!: WebviewElement;
	insetMapping: Map<IOutput, { outputId: string, cell: CodeCellViewModel, cacheOffset: number | undefined }> = new Map();
	hiddenInsetMapping: Set<IOutput> = new Set();
	reversedInsetMapping: Map<string, IOutput> = new Map();
	preloadsCache: Map<string, boolean> = new Map();
	localResourceRootsCache: URI[] | undefined = undefined;
	rendererRootsCache: URI[] = [];
	private readonly _onMessage = this._register(new Emitter<any>());
	public readonly onMessage: Event<any> = this._onMessage.event;
	private _initalized: Promise<void>;


	constructor(
		public notebookEditor: INotebookEditor,
		@IWebviewService readonly webviewService: IWebviewService,
		@IOpenerService readonly openerService: IOpenerService,
		@INotebookService private readonly notebookService: INotebookService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super();
		this.element = document.createElement('div');

		this.element.style.width = `calc(100% - ${CELL_MARGIN * 2 + CELL_RUN_GUTTER}px)`;
		this.element.style.height = '1400px';
		this.element.style.position = 'absolute';
		this.element.style.margin = `0px 0 0px ${CELL_MARGIN + CELL_RUN_GUTTER}px`;

		const pathsPath = getPathFromAmdModule(require, 'vs/loader.js');
		const loader = URI.file(pathsPath).with({ scheme: WebviewResourceScheme });

		let coreDependencies = '';
		let resolveFunc: () => void;

		this._initalized = new Promise<void>((resolve, reject) => {
			resolveFunc = resolve;
		});

		if (!isWeb) {
			coreDependencies = `<script src="${loader}"></script>`;
			const htmlContent = this.generateContent(8, coreDependencies);
			this.initialize(htmlContent);
			resolveFunc!();
		} else {
			fetch(pathsPath).then(async response => {
				if (response.status !== 200) {
					throw new Error(response.statusText);
				}

				const loaderJs = await response.text();

				coreDependencies = `
<script>
${loaderJs}
</script>
`;
				const htmlContent = this.generateContent(8, coreDependencies);
				this.initialize(htmlContent);
				resolveFunc!();
			});
		}
	}

	generateContent(outputNodePadding: number, coreDependencies: string) {
		return /* html */`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<style>
					#container > div > div {
						width: 100%;
						padding: ${outputNodePadding}px;
						box-sizing: border-box;
						background-color: var(--vscode-notebook-outputContainerBackgroundColor);
					}
					body {
						padding: 0px;
						height: 100%;
						width: 100%;
					}
				</style>
			</head>
			<body style="overflow: hidden;">
				<script>
					self.require = {};
				</script>
				${coreDependencies}
				<div id="__vscode_preloads"></div>
				<div id='container' class="widgetarea" style="position: absolute;width:100%;top: 0px"></div>
<script>
(function () {
	// eslint-disable-next-line no-undef
	const vscode = acquireVsCodeApi();

	const preservedScriptAttributes = {
		type: true,
		src: true,
		nonce: true,
		noModule: true,
		async: true
	};

	// derived from https://github.com/jquery/jquery/blob/d0ce00cdfa680f1f0c38460bc51ea14079ae8b07/src/core/DOMEval.js
	const domEval = (container) => {
		var arr = Array.from(container.getElementsByTagName('script'));
		for (let n = 0; n < arr.length; n++) {
			let node = arr[n];
			let scriptTag = document.createElement('script');
			scriptTag.text = node.innerText;
			for (let key in preservedScriptAttributes ) {
				const val = node[key] || node.getAttribute && node.getAttribute(key);
				if (val) {
					scriptTag.setAttribute(key, val);
				}
			}

			// TODO: should script with src not be removed?
			container.appendChild(scriptTag).parentNode.removeChild(scriptTag);
		}
	};

	let observers = [];

	const resizeObserve = (container, id) => {
		const resizeObserver = new ResizeObserver(entries => {
			for (let entry of entries) {
				if (entry.target.id === id && entry.contentRect) {
					vscode.postMessage({
							__vscode_notebook_message: true,
							type: 'dimension',
							id: id,
							data: {
								height: entry.contentRect.height + ${outputNodePadding} * 2
							}
						});
				}
			}
		});

		resizeObserver.observe(container);
		observers.push(resizeObserver);
	}

	function scrollWillGoToParent(event) {
		for (let node = event.target; node; node = node.parentNode) {
			if (node.id === 'container') {
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

	const handleWheel = (event) => {
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

	window.addEventListener('wheel', handleWheel);

	window.addEventListener('message', event => {
		let id = event.data.id;

		switch (event.data.type) {
			case 'html':
				{
					let cellOutputContainer = document.getElementById(id);
					let outputId = event.data.outputId;
					if (!cellOutputContainer) {
						let newElement = document.createElement('div');

						newElement.id = id;
						document.getElementById('container').appendChild(newElement);
						cellOutputContainer = newElement;

						cellOutputContainer.addEventListener('mouseenter', () => {
							vscode.postMessage({
								__vscode_notebook_message: true,
								type: 'mouseenter',
								id: outputId,
								data: { }
							});
						});
						cellOutputContainer.addEventListener('mouseleave', () => {
							vscode.postMessage({
								__vscode_notebook_message: true,
								type: 'mouseleave',
								id: outputId,
								data: { }
							});
						});
					}

					let outputNode = document.createElement('div');
					outputNode.style.position = 'absolute';
					outputNode.style.top = event.data.top + 'px';
					outputNode.style.left = event.data.left + 'px';
					outputNode.style.width = 'calc(100% - ' + event.data.left + 'px)';
					outputNode.style.minHeight = '32px';

					outputNode.id = outputId;
					let content = event.data.content;
					outputNode.innerHTML = content;
					cellOutputContainer.appendChild(outputNode);

					// eval
					domEval(outputNode);
					resizeObserve(outputNode, outputId);

					vscode.postMessage({
						__vscode_notebook_message: true,
						type: 'dimension',
						id: outputId,
						data: {
							height: outputNode.clientHeight
						}
					});
				}
				break;
			case 'view-scroll':
				{
					// const date = new Date();
					// console.log('----- will scroll ----  ', date.getMinutes() + ':' + date.getSeconds() + ':' + date.getMilliseconds());

					for (let i = 0; i < event.data.widgets.length; i++) {
						let widget = document.getElementById(event.data.widgets[i].id);
						widget.style.top = event.data.widgets[i].top + 'px';
						widget.parentNode.style.display = 'block';
					}
					break;
				}
			case 'clear':
				document.getElementById('container').innerHTML = '';
				for (let i = 0; i < observers.length; i++) {
					observers[i].disconnect();
				}

				observers = [];
				break;
			case 'clearOutput':
				{
					let output = document.getElementById(id);
					document.getElementById(id).parentNode.removeChild(output);
					// @TODO remove observer
				}
				break;
			case 'hideOutput':
				document.getElementById(id).parentNode.style.display = 'none';
				break;
			case 'showOutput':
				{
					let output = document.getElementById(id);
					output.parentNode.style.display = 'block';
					output.style.top = event.data.top + 'px';
				}
				break;
			case 'preload':
				let resources = event.data.resources;
				let preloadsContainer = document.getElementById('__vscode_preloads');
				for (let i = 0; i < resources.length; i++) {
					let scriptTag = document.createElement('script');
					scriptTag.setAttribute('src', resources[i]);
					preloadsContainer.appendChild(scriptTag)
				}
				break;
		}
	});
}());

</script>
</body>
`;
	}

	private resolveOutputId(id: string): { cell: CodeCellViewModel, output: IOutput } | undefined {
		const output = this.reversedInsetMapping.get(id);
		if (!output) {
			return;
		}

		return { cell: this.insetMapping.get(output)!.cell, output };
	}

	initialize(content: string) {
		this.webview = this._createInset(this.webviewService, content);
		this.webview.mountTo(this.element);

		this._register(this.webview.onDidClickLink(link => {
			this.openerService.open(link, { fromUserGesture: true });
		}));

		this._register(this.webview.onMessage((data: IMessage) => {
			if (data.__vscode_notebook_message) {
				if (data.type === 'dimension') {
					let height = data.data.height;
					let outputHeight = height;

					const info = this.resolveOutputId(data.id);
					if (info) {
						const { cell, output } = info;
						let outputIndex = cell.outputs.indexOf(output);
						cell.updateOutputHeight(outputIndex, outputHeight);
						this.notebookEditor.layoutNotebookCell(cell, cell.layoutInfo.totalHeight);
					}
				} else if (data.type === 'mouseenter') {
					const info = this.resolveOutputId(data.id);
					if (info) {
						const { cell } = info;
						cell.outputIsHovered = true;
					}
				} else if (data.type === 'mouseleave') {
					const info = this.resolveOutputId(data.id);
					if (info) {
						const { cell } = info;
						cell.outputIsHovered = false;
					}
				} else if (data.type === 'scroll-ack') {
					// const date = new Date();
					// const top = data.data.top;
					// console.log('ack top ', top, ' version: ', data.version, ' - ', date.getMinutes() + ':' + date.getSeconds() + ':' + date.getMilliseconds());
				} else if (data.type === 'did-scroll-wheel') {
					this.notebookEditor.triggerScroll({
						...data.payload,
						preventDefault: () => { },
						stopPropagation: () => { }
					});
				}
				return;
			}

			this._onMessage.fire(data);
		}));
	}

	async waitForInitialization() {
		await this._initalized;
	}

	private _createInset(webviewService: IWebviewService, content: string) {
		const rootPath = URI.file(path.dirname(getPathFromAmdModule(require, '')));
		this.localResourceRootsCache = [...this.notebookService.getNotebookProviderResourceRoots(), rootPath];
		const webview = webviewService.createWebviewElement('' + UUID.generateUuid(), {
			enableFindWidget: false,
		}, {
			allowMultipleAPIAcquire: true,
			allowScripts: true,
			localResourceRoots: this.localResourceRootsCache
		});
		webview.html = content;
		return webview;
	}

	shouldUpdateInset(cell: CodeCellViewModel, output: IOutput, cellTop: number) {
		let outputCache = this.insetMapping.get(output)!;
		let outputIndex = cell.outputs.indexOf(output);
		let outputOffset = cellTop + cell.getOutputOffset(outputIndex);

		if (this.hiddenInsetMapping.has(output)) {
			return true;
		}

		if (outputOffset === outputCache.cacheOffset) {
			return false;
		}

		return true;
	}

	updateViewScrollTop(top: number, items: { cell: CodeCellViewModel, output: IOutput, cellTop: number }[]) {
		let widgets: IContentWidgetTopRequest[] = items.map(item => {
			let outputCache = this.insetMapping.get(item.output)!;
			let id = outputCache.outputId;
			let outputIndex = item.cell.outputs.indexOf(item.output);

			let outputOffset = item.cellTop + item.cell.getOutputOffset(outputIndex);
			outputCache.cacheOffset = outputOffset;
			this.hiddenInsetMapping.delete(item.output);

			return {
				id: id,
				top: outputOffset,
				left: 0
			};
		});

		let message: IViewScrollTopRequestMessage = {
			top,
			type: 'view-scroll',
			version: version++,
			widgets: widgets
		};

		this.webview.sendMessage(message);
	}

	createInset(cell: CodeCellViewModel, output: IOutput, cellTop: number, offset: number, shadowContent: string, preloads: Set<number>) {
		this.updateRendererPreloads(preloads);
		let initialTop = cellTop + offset;

		if (this.insetMapping.has(output)) {
			let outputCache = this.insetMapping.get(output);

			if (outputCache) {
				this.hiddenInsetMapping.delete(output);
				this.webview.sendMessage({
					type: 'showOutput',
					id: outputCache.outputId,
					top: initialTop
				});
				return;
			}
		}

		let outputId = UUID.generateUuid();

		let message: ICreationRequestMessage = {
			type: 'html',
			content: shadowContent,
			id: cell.id,
			outputId: outputId,
			top: initialTop,
			left: 0
		};

		this.webview.sendMessage(message);
		this.insetMapping.set(output, { outputId: outputId, cell: cell, cacheOffset: initialTop });
		this.hiddenInsetMapping.delete(output);
		this.reversedInsetMapping.set(outputId, output);
	}

	removeInset(output: IOutput) {
		let outputCache = this.insetMapping.get(output);
		if (!outputCache) {
			return;
		}

		let id = outputCache.outputId;

		this.webview.sendMessage({
			type: 'clearOutput',
			id: id
		});
		this.insetMapping.delete(output);
		this.reversedInsetMapping.delete(id);
	}

	hideInset(output: IOutput) {
		let outputCache = this.insetMapping.get(output);
		if (!outputCache) {
			return;
		}

		let id = outputCache.outputId;
		this.hiddenInsetMapping.add(output);

		this.webview.sendMessage({
			type: 'hideOutput',
			id: id
		});
	}

	clearInsets() {
		this.webview.sendMessage({
			type: 'clear'
		});

		this.insetMapping = new Map();
		this.reversedInsetMapping = new Map();
	}

	updateRendererPreloads(preloads: Set<number>) {
		let resources: string[] = [];
		let extensionLocations: URI[] = [];
		preloads.forEach(preload => {
			let rendererInfo = this.notebookService.getRendererInfo(preload);

			if (rendererInfo) {
				let preloadResources = rendererInfo.preloads.map(preloadResource => {
					if (this.environmentService.isExtensionDevelopment && (preloadResource.scheme === 'http' || preloadResource.scheme === 'https')) {
						return preloadResource;
					}
					return preloadResource.with({ scheme: WebviewResourceScheme });
				});
				extensionLocations.push(rendererInfo.extensionLocation);
				preloadResources.forEach(e => {
					if (!this.preloadsCache.has(e.toString())) {
						resources.push(e.toString());
						this.preloadsCache.set(e.toString(), true);
					}
				});
			}
		});

		this.rendererRootsCache = extensionLocations;
		const mixedResourceRoots = [...(this.localResourceRootsCache || []), ...this.rendererRootsCache];

		this.webview.contentOptions = {
			allowMultipleAPIAcquire: true,
			allowScripts: true,
			enableCommandUris: true,
			localResourceRoots: mixedResourceRoots
		};

		let message: IUpdatePreloadResourceMessage = {
			type: 'preload',
			resources: resources
		};

		this.webview.sendMessage(message);
	}

	clearPreloadsCache() {
		this.preloadsCache.clear();
	}
}
