/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import { IOpenerService, matchesScheme } from 'vs/platform/opener/common/opener';
import { CELL_MARGIN, CELL_RUN_GUTTER, CODE_CELL_LEFT_MARGIN, CELL_OUTPUT_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { CellOutputKind, IDisplayOutput, IInsetRenderOutput, INotebookRendererInfo, IProcessedOutput, ITransformedDisplayOutputDto, RenderOutputType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IWebviewService, WebviewElement, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webviewUri';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { dirname, joinPath } from 'vs/base/common/resources';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { preloadsScriptStr } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFileService } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { getExtensionForMimeType } from 'vs/base/common/mime';

export interface WebviewIntialized {
	__vscode_notebook_message: boolean;
	type: 'initialized'
}

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

export interface IBlurOutputMessage {
	__vscode_notebook_message: boolean;
	type: 'focus-editor';
	id: string;
	focusNext?: boolean;
}

export interface IClickedDataUrlMessage {
	__vscode_notebook_message: boolean;
	type: 'clicked-data-url';
	data: string;
	downloadName?: string;
}

export interface IClearMessage {
	type: 'clear';
}

export interface ICreationRequestMessage {
	type: 'html';
	content:
	| { type: RenderOutputType.Html; htmlContent: string }
	| { type: RenderOutputType.Extension; output: IDisplayOutput; mimeType: string };
	cellId: string;
	outputId: string;
	top: number;
	left: number;
	requiredPreloads: ReadonlyArray<IPreloadResource>;
	initiallyHidden?: boolean;
	apiNamespace?: string | undefined;
}

export interface IContentWidgetTopRequest {
	id: string;
	top: number;
	left: number;
}

export interface IViewScrollTopRequestMessage {
	type: 'view-scroll';
	top?: number;
	forceDisplay: boolean;
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

export interface IClearOutputRequestMessage {
	type: 'clearOutput';
	cellId: string;
	outputId: string;
	cellUri: string;
	apiNamespace: string | undefined;
}

export interface IHideOutputMessage {
	type: 'hideOutput';
	outputId: string;
	cellId: string;
}

export interface IShowOutputMessage {
	type: 'showOutput';
	cellId: string;
	outputId: string;
	top: number;
}

export interface IFocusOutputMessage {
	type: 'focus-output';
	cellId: string;
}

export interface IPreloadResource {
	originalUri: string;
	uri: string;
}

export interface IUpdatePreloadResourceMessage {
	type: 'preload';
	resources: IPreloadResource[];
	source: 'renderer' | 'kernel';
}

export interface IUpdateDecorationsMessage {
	type: 'decorations';
	cellId: string;
	addedClassNames: string[];
	removedClassNames: string[];
}

export interface ICustomRendererMessage {
	__vscode_notebook_message: boolean;
	type: 'customRendererMessage';
	rendererId: string;
	message: unknown;
}

export type FromWebviewMessage =
	| WebviewIntialized
	| IDimensionMessage
	| IMouseEnterMessage
	| IMouseLeaveMessage
	| IWheelMessage
	| IScrollAckMessage
	| IBlurOutputMessage
	| ICustomRendererMessage
	| IClickedDataUrlMessage;

export type ToWebviewMessage =
	| IClearMessage
	| IFocusOutputMessage
	| ICreationRequestMessage
	| IViewScrollTopRequestMessage
	| IScrollRequestMessage
	| IClearOutputRequestMessage
	| IHideOutputMessage
	| IShowOutputMessage
	| IUpdatePreloadResourceMessage
	| IUpdateDecorationsMessage
	| ICustomRendererMessage;

export type AnyMessage = FromWebviewMessage | ToWebviewMessage;

interface ICachedInset {
	outputId: string;
	cell: CodeCellViewModel;
	renderer?: INotebookRendererInfo;
	cachedCreation: ICreationRequestMessage;
}

function html(strings: TemplateStringsArray, ...values: any[]): string {
	let str = '';
	strings.forEach((string, i) => {
		str += string + (values[i] || '');
	});
	return str;
}

export interface INotebookWebviewMessage {
	message: unknown;
	forRenderer?: string;
}

let version = 0;
export class BackLayerWebView extends Disposable {
	element: HTMLElement;
	webview: WebviewElement | undefined = undefined;
	insetMapping: Map<IProcessedOutput, ICachedInset> = new Map();
	hiddenInsetMapping: Set<IProcessedOutput> = new Set();
	reversedInsetMapping: Map<string, IProcessedOutput> = new Map();
	localResourceRootsCache: URI[] | undefined = undefined;
	rendererRootsCache: URI[] = [];
	kernelRootsCache: URI[] = [];
	private readonly _onMessage = this._register(new Emitter<INotebookWebviewMessage>());
	private readonly _preloadsCache = new Set<string>();
	public readonly onMessage: Event<INotebookWebviewMessage> = this._onMessage.event;
	private _loaded!: Promise<void>;
	private _initalized?: Promise<void>;
	private _disposed = false;

	constructor(
		public notebookEditor: INotebookEditor,
		public id: string,
		public documentUri: URI,
		@IWebviewService readonly webviewService: IWebviewService,
		@IOpenerService readonly openerService: IOpenerService,
		@INotebookService private readonly notebookService: INotebookService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();

		this.element = document.createElement('div');

		this.element.style.width = `calc(100% - ${CODE_CELL_LEFT_MARGIN + (CELL_MARGIN * 2) + CELL_RUN_GUTTER}px)`;
		this.element.style.height = '1400px';
		this.element.style.position = 'absolute';
		this.element.style.margin = `0px 0 0px ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px`;
	}
	generateContent(outputNodePadding: number, coreDependencies: string, baseUrl: string) {
		return html`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<base href="${baseUrl}/"/>
				<style>
					#container > div > div {
						width: 100%;
						padding: ${outputNodePadding}px;
						box-sizing: border-box;
						background-color: var(--vscode-notebook-outputContainerBackgroundColor);
					}

					#container > div.nb-symbolHighlight > div {
						background-color: var(--vscode-notebook-symbolHighlightBackground);
					}

					#container > div > div > div {
						overflow-x: scroll;
					}

					body {
						padding: 0px;
						height: 100%;
						width: 100%;
					}

					table, thead, tr, th, td, tbody {
						border: none !important;
						border-color: transparent;
						border-spacing: 0;
						border-collapse: collapse;
					}

					table {
						width: 100%;
					}

					table, th, tr {
						text-align: left !important;
					}

					thead {
						font-weight: bold;
						background-color: rgba(130, 130, 130, 0.16);
					}

					th, td {
						padding: 4px 8px;
					}

					tr:nth-child(even) {
						background-color: rgba(130, 130, 130, 0.08);
					}

					tbody th {
						font-weight: normal;
					}

				</style>
			</head>
			<body style="overflow: hidden;">
				<script>
					self.require = {};
				</script>
				${coreDependencies}
				<div id='container' class="widgetarea" style="position: absolute;width:100%;top: 0px"></div>
				<script>${preloadsScriptStr(outputNodePadding)}</script>
			</body>
		</html>`;
	}

	postRendererMessage(rendererId: string, message: any) {
		this._sendMessageToWebview({
			__vscode_notebook_message: true,
			type: 'customRendererMessage',
			message,
			rendererId
		});
	}

	private resolveOutputId(id: string): { cell: CodeCellViewModel, output: IProcessedOutput } | undefined {
		const output = this.reversedInsetMapping.get(id);
		if (!output) {
			return;
		}

		const cell = this.insetMapping.get(output)!.cell;

		const currCell = this.notebookEditor.viewModel?.viewCells.find(vc => vc.handle === cell.handle);
		if (currCell !== cell && currCell !== undefined) {
			this.insetMapping.get(output)!.cell = currCell as CodeCellViewModel;
		}

		return { cell: this.insetMapping.get(output)!.cell, output };
	}

	async createWebview(): Promise<void> {
		let coreDependencies = '';
		let resolveFunc: () => void;

		this._initalized = new Promise<void>((resolve, reject) => {
			resolveFunc = resolve;
		});

		const baseUrl = asWebviewUri(this.environmentService, this.id, dirname(this.documentUri));

		if (!isWeb) {
			const loaderUri = FileAccess.asFileUri('vs/loader.js', require);
			const loader = asWebviewUri(this.environmentService, this.id, loaderUri);

			coreDependencies = `<script src="${loader}"></script><script>
			var requirejs = (function() {
				return require;
			}());
			</script>`;
			const htmlContent = this.generateContent(CELL_OUTPUT_PADDING, coreDependencies, baseUrl.toString());
			this._initialize(htmlContent);
			resolveFunc!();
		} else {
			const loaderUri = FileAccess.asBrowserUri('vs/loader.js', require);

			fetch(loaderUri.toString(true)).then(async response => {
				if (response.status !== 200) {
					throw new Error(response.statusText);
				}

				const loaderJs = await response.text();

				coreDependencies = `
<script>
${loaderJs}
</script>
<script>
var requirejs = (function() {
	return require;
}());
</script>
`;

				const htmlContent = this.generateContent(CELL_OUTPUT_PADDING, coreDependencies, baseUrl.toString());
				this._initialize(htmlContent);
				resolveFunc!();
			});
		}

		await this._initalized;
	}

	private async _initialize(content: string) {
		if (!document.body.contains(this.element)) {
			throw new Error('Element is already detached from the DOM tree');
		}

		this.webview = this._createInset(this.webviewService, content);
		this.webview.mountTo(this.element);
		this._register(this.webview);

		this._register(this.webview.onDidClickLink(link => {
			if (this._disposed) {
				return;
			}

			if (!link) {
				return;
			}

			if (matchesScheme(link, Schemas.http) || matchesScheme(link, Schemas.https) || matchesScheme(link, Schemas.mailto)
				|| matchesScheme(link, Schemas.command)) {
				this.openerService.open(link, { fromUserGesture: true });
			}
		}));

		this._register(this.webview.onDidReload(() => {
			if (this._disposed) {
				return;
			}

			let renderers = new Set<INotebookRendererInfo>();
			for (const inset of this.insetMapping.values()) {
				if (inset.renderer) {
					renderers.add(inset.renderer);
				}
			}

			this._preloadsCache.clear();
			this.updateRendererPreloads(renderers);

			for (const [output, inset] of this.insetMapping.entries()) {
				this._sendMessageToWebview({ ...inset.cachedCreation, initiallyHidden: this.hiddenInsetMapping.has(output) });
			}
		}));

		this._register(this.webview.onMessage((data: FromWebviewMessage) => {
			if (this._disposed) {
				return;
			}

			if (data.__vscode_notebook_message) {
				if (data.type === 'dimension') {
					const height = data.data.height;
					const outputHeight = height;

					const info = this.resolveOutputId(data.id);
					if (info) {
						const { cell, output } = info;
						const outputIndex = cell.outputs.indexOf(output);
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
				} else if (data.type === 'focus-editor') {
					const info = this.resolveOutputId(data.id);
					if (info) {
						if (data.focusNext) {
							const idx = this.notebookEditor.viewModel?.getCellIndex(info.cell);
							if (typeof idx !== 'number') {
								return;
							}

							const newCell = this.notebookEditor.viewModel?.viewCells[idx + 1];
							if (!newCell) {
								return;
							}

							this.notebookEditor.focusNotebookCell(newCell, 'editor');
						} else {
							this.notebookEditor.focusNotebookCell(info.cell, 'editor');
						}
					}
				} else if (data.type === 'clicked-data-url') {
					this._onDidClickDataLink(data);
				} else if (data.type === 'customRendererMessage') {
					this._onMessage.fire({ message: data.message, forRenderer: data.rendererId });
				}
				return;
			}

			this._onMessage.fire({ message: data });
		}));
	}

	private async _onDidClickDataLink(event: IClickedDataUrlMessage): Promise<void> {
		const [splitStart, splitData] = event.data.split(';base64,');
		if (!splitData || !splitStart) {
			return;
		}

		const defaultDir = dirname(this.documentUri);
		let defaultName: string;
		if (event.downloadName) {
			defaultName = event.downloadName;
		} else {
			const mimeType = splitStart.replace(/^data:/, '');
			const candidateExtension = mimeType && getExtensionForMimeType(mimeType);
			defaultName = candidateExtension ? `download${candidateExtension}` : 'download';
		}

		const defaultUri = joinPath(defaultDir, defaultName);
		const newFileUri = await this.fileDialogService.showSaveDialog({
			defaultUri
		});
		if (!newFileUri) {
			return;
		}

		const decoded = atob(splitData);
		const typedArray = new Uint8Array(decoded.length);
		for (let i = 0; i < decoded.length; i++) {
			typedArray[i] = decoded.charCodeAt(i);
		}

		const buff = VSBuffer.wrap(typedArray);
		await this.fileService.writeFile(newFileUri, buff);
		await this.openerService.open(newFileUri);
	}

	private _createInset(webviewService: IWebviewService, content: string) {
		const rootPath = isWeb ? FileAccess.asBrowserUri('', require) : FileAccess.asFileUri('', require);

		const workspaceFolders = this.contextService.getWorkspace().folders.map(x => x.uri);

		this.localResourceRootsCache = [...this.notebookService.getNotebookProviderResourceRoots(), ...workspaceFolders, rootPath];

		const webview = webviewService.createWebviewElement(this.id, {
			purpose: WebviewContentPurpose.NotebookRenderer,
			enableFindWidget: false,
		}, {
			allowMultipleAPIAcquire: true,
			allowScripts: true,
			localResourceRoots: this.localResourceRootsCache
		}, undefined);

		let resolveFunc: () => void;
		this._loaded = new Promise<void>((resolve, reject) => {
			resolveFunc = resolve;
		});

		const dispose = webview.onMessage((data: FromWebviewMessage) => {
			if (data.__vscode_notebook_message && data.type === 'initialized') {
				resolveFunc();
				dispose.dispose();
			}
		});

		webview.html = content;
		return webview;
	}

	shouldUpdateInset(cell: CodeCellViewModel, output: IProcessedOutput, cellTop: number) {
		if (this._disposed) {
			return;
		}

		if (cell.metadata?.outputCollapsed) {
			return false;
		}

		const outputCache = this.insetMapping.get(output)!;
		const outputIndex = cell.outputs.indexOf(output);
		const outputOffset = cellTop + cell.getOutputOffset(outputIndex);

		if (this.hiddenInsetMapping.has(output)) {
			return true;
		}

		if (outputOffset === outputCache.cachedCreation.top) {
			return false;
		}

		return true;
	}

	updateViewScrollTop(top: number, forceDisplay: boolean, items: { cell: CodeCellViewModel, output: IProcessedOutput, cellTop: number }[]) {
		if (this._disposed) {
			return;
		}

		const widgets: IContentWidgetTopRequest[] = items.map(item => {
			const outputCache = this.insetMapping.get(item.output)!;
			const id = outputCache.outputId;
			const outputIndex = item.cell.outputs.indexOf(item.output);

			const outputOffset = item.cellTop + item.cell.getOutputOffset(outputIndex);
			outputCache.cachedCreation.top = outputOffset;
			this.hiddenInsetMapping.delete(item.output);

			return {
				id: id,
				top: outputOffset,
				left: 0
			};
		});

		this._sendMessageToWebview({
			top,
			type: 'view-scroll',
			version: version++,
			forceDisplay,
			widgets: widgets
		});
	}

	async createInset(cell: CodeCellViewModel, content: IInsetRenderOutput, cellTop: number, offset: number) {
		if (this._disposed) {
			return;
		}

		const initialTop = cellTop + offset;

		if (this.insetMapping.has(content.source)) {
			const outputCache = this.insetMapping.get(content.source);

			if (outputCache) {
				this.hiddenInsetMapping.delete(content.source);
				this._sendMessageToWebview({
					type: 'showOutput',
					cellId: outputCache.cell.id,
					outputId: outputCache.outputId,
					top: initialTop
				});
				return;
			}
		}

		const messageBase = {
			type: 'html',
			cellId: cell.id,
			top: initialTop,
			left: 0,
			requiredPreloads: [],
		} as const;

		let message: ICreationRequestMessage;
		let renderer: INotebookRendererInfo | undefined;
		if (content.type === RenderOutputType.Extension) {
			const output = content.source as ITransformedDisplayOutputDto;
			renderer = content.renderer;
			message = {
				...messageBase,
				outputId: output.outputId,
				apiNamespace: content.renderer.id,
				requiredPreloads: await this.updateRendererPreloads([content.renderer]),
				content: {
					type: RenderOutputType.Extension,
					mimeType: content.mimeType,
					output: {
						outputKind: CellOutputKind.Rich,
						metadata: output.metadata,
						data: output.data,
					},
				},
			};
		} else {
			message = {
				...messageBase,
				outputId: UUID.generateUuid(),
				content: {
					type: content.type,
					htmlContent: content.htmlContent,
				}
			};
		}

		this._sendMessageToWebview(message);
		this.insetMapping.set(content.source, { outputId: message.outputId, cell, renderer, cachedCreation: message });
		this.hiddenInsetMapping.delete(content.source);
		this.reversedInsetMapping.set(message.outputId, content.source);
	}

	removeInset(output: IProcessedOutput) {
		if (this._disposed) {
			return;
		}

		const outputCache = this.insetMapping.get(output);
		if (!outputCache) {
			return;
		}

		const id = outputCache.outputId;

		this._sendMessageToWebview({
			type: 'clearOutput',
			apiNamespace: outputCache.cachedCreation.apiNamespace,
			cellUri: outputCache.cell.uri.toString(),
			outputId: id,
			cellId: outputCache.cell.id
		});
		this.insetMapping.delete(output);
		this.reversedInsetMapping.delete(id);
	}

	hideInset(output: IProcessedOutput) {
		if (this._disposed) {
			return;
		}

		const outputCache = this.insetMapping.get(output);
		if (!outputCache) {
			return;
		}

		this.hiddenInsetMapping.add(output);

		this._sendMessageToWebview({
			type: 'hideOutput',
			outputId: outputCache.outputId,
			cellId: outputCache.cell.id,
		});
	}

	clearInsets() {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'clear'
		});

		this.insetMapping = new Map();
		this.reversedInsetMapping = new Map();
	}

	focusWebview() {
		if (this._disposed) {
			return;
		}

		this.webview?.focus();
	}

	focusOutput(cellId: string) {
		if (this._disposed) {
			return;
		}

		this.webview?.focus();
		setTimeout(() => { // Need this, or focus decoration is not shown. No clue.
			this._sendMessageToWebview({
				type: 'focus-output',
				cellId,
			});
		}, 50);
	}

	deltaCellOutputContainerClassNames(cellId: string, added: string[], removed: string[]) {
		this._sendMessageToWebview({
			type: 'decorations',
			cellId,
			addedClassNames: added,
			removedClassNames: removed
		});

	}

	async updateKernelPreloads(extensionLocations: URI[], preloads: URI[]) {
		if (this._disposed) {
			return;
		}

		await this._loaded;

		const resources: IPreloadResource[] = [];
		for (const preload of preloads) {
			const uri = this.environmentService.isExtensionDevelopment && (preload.scheme === 'http' || preload.scheme === 'https')
				? preload : asWebviewUri(this.environmentService, this.id, preload);

			if (!this._preloadsCache.has(uri.toString())) {
				resources.push({ uri: uri.toString(), originalUri: preload.toString() });
				this._preloadsCache.add(uri.toString());
			}
		}

		if (!resources.length) {
			return;
		}

		this.kernelRootsCache = [...extensionLocations, ...this.kernelRootsCache];
		this._updatePreloads(resources, 'kernel');
	}

	async updateRendererPreloads(renderers: Iterable<INotebookRendererInfo>) {
		if (this._disposed) {
			return [];
		}

		await this._loaded;

		const requiredPreloads: IPreloadResource[] = [];
		const resources: IPreloadResource[] = [];
		const extensionLocations: URI[] = [];
		for (const rendererInfo of renderers) {
			extensionLocations.push(rendererInfo.extensionLocation);
			for (const preload of [rendererInfo.entrypoint, ...rendererInfo.preloads]) {
				const uri = asWebviewUri(this.environmentService, this.id, preload);
				const resource: IPreloadResource = { uri: uri.toString(), originalUri: preload.toString() };
				requiredPreloads.push(resource);

				if (!this._preloadsCache.has(uri.toString())) {
					resources.push(resource);
					this._preloadsCache.add(uri.toString());
				}
			}
		}

		if (!resources.length) {
			return requiredPreloads;
		}

		this.rendererRootsCache = extensionLocations;
		this._updatePreloads(resources, 'renderer');
		return requiredPreloads;
	}

	private _updatePreloads(resources: IPreloadResource[], source: 'renderer' | 'kernel') {
		if (!this.webview) {
			return;
		}

		const mixedResourceRoots = [...(this.localResourceRootsCache || []), ...this.rendererRootsCache, ...this.kernelRootsCache];

		this.webview.localResourcesRoot = mixedResourceRoots;

		this._sendMessageToWebview({
			type: 'preload',
			resources: resources,
			source: source
		});
	}

	private _sendMessageToWebview(message: ToWebviewMessage) {
		if (this._disposed) {
			return;
		}

		this.webview?.postMessage(message);
	}

	clearPreloadsCache() {
		this._preloadsCache.clear();
	}

	dispose() {
		this._disposed = true;
		this.webview?.dispose();
		super.dispose();
	}
}
