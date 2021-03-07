/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { getExtensionForMimeType } from 'vs/base/common/mime';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { isWeb } from 'vs/base/common/platform';
import { dirname, joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFileService } from 'vs/platform/files/common/files';
import { IOpenerService, matchesScheme } from 'vs/platform/opener/common/opener';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { CellEditState, ICellOutputViewModel, ICommonCellInfo, ICommonNotebookEditor, IDisplayOutputLayoutUpdateRequest, IDisplayOutputViewModel, IGenericCellViewModel, IInsetRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { preloadsScriptStr } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads';
import { transformWebviewThemeVars } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewThemeMapping';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { INotebookRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IWebviewService, WebviewContentPurpose, WebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webviewUri';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

interface BaseToWebviewMessage {
	readonly __vscode_notebook_message: true;
}

export interface WebviewIntialized extends BaseToWebviewMessage {
	type: 'initialized';
}

export interface IDimensionMessage extends BaseToWebviewMessage {
	type: 'dimension';
	id: string;
	init?: boolean;
	data: { height: number };
	isOutput?: boolean;
}

export interface IMouseEnterMessage extends BaseToWebviewMessage {
	type: 'mouseenter';
	id: string;
}

export interface IMouseLeaveMessage extends BaseToWebviewMessage {
	type: 'mouseleave';
	id: string;
}

export interface IWheelMessage extends BaseToWebviewMessage {
	type: 'did-scroll-wheel';
	payload: any;
}

export interface IScrollAckMessage extends BaseToWebviewMessage {
	type: 'scroll-ack';
	data: { top: number };
	version: number;
}

export interface IBlurOutputMessage extends BaseToWebviewMessage {
	type: 'focus-editor';
	id: string;
	focusNext?: boolean;
}

export interface IClickedDataUrlMessage extends BaseToWebviewMessage {
	type: 'clicked-data-url';
	data: string | ArrayBuffer | null;
	downloadName?: string;
}

export interface IFocusMarkdownPreviewMessage extends BaseToWebviewMessage {
	type: 'focusMarkdownPreview';
	cellId: string;
}

export interface IMouseEnterMarkdownPreviewMessage extends BaseToWebviewMessage {
	type: 'mouseEnterMarkdownPreview';
	cellId: string;
}

export interface IMouseLeaveMarkdownPreviewMessage extends BaseToWebviewMessage {
	type: 'mouseLeaveMarkdownPreview';
	cellId: string;
}

export interface IToggleMarkdownPreviewMessage extends BaseToWebviewMessage {
	type: 'toggleMarkdownPreview';
	cellId: string;
}

export interface ICellDragStartMessage extends BaseToWebviewMessage {
	type: 'cell-drag-start';
	cellId: string;
	position: { clientX: number, clientY: number };
}

export interface ICellDragMessage extends BaseToWebviewMessage {
	type: 'cell-drag';
	cellId: string;
	position: { clientX: number, clientY: number };
}

export interface ICellDragEndMessage extends BaseToWebviewMessage {
	readonly type: 'cell-drag-end';
	readonly cellId: string;
	readonly ctrlKey: boolean
	readonly altKey: boolean;
	readonly position: {
		readonly clientX: number;
		readonly clientY: number;
	};
}
export interface IInitializedMarkdownPreviewMessage extends BaseToWebviewMessage {
	readonly type: 'initializedMarkdownPreview';
}

export interface IClearMessage {
	type: 'clear';
}

export interface IOutputRequestMetadata {
	/**
	 * Additional attributes of a cell metadata.
	 */
	custom?: { [key: string]: unknown };
}

export interface IOutputRequestDto {
	/**
	 * { mime_type: value }
	 */
	data: { [key: string]: unknown; }

	metadata?: IOutputRequestMetadata;
	outputId: string;
}

export interface ICreationRequestMessage {
	type: 'html';
	content:
	| { type: RenderOutputType.Html; htmlContent: string }
	| { type: RenderOutputType.Extension; output: IOutputRequestDto; mimeType: string };
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

export interface IViewScrollMarkdownRequestMessage {
	type: 'view-scroll-markdown';
	cells: { id: string; top: number }[];
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

export interface ICustomRendererMessage extends BaseToWebviewMessage {
	type: 'customRendererMessage';
	rendererId: string;
	message: unknown;
}

export interface ICreateMarkdownMessage {
	type: 'createMarkdownPreview',
	id: string;
	content: string;
	top: number;
}
export interface IRemoveMarkdownMessage {
	type: 'removeMarkdownPreview',
	id: string;
}

export interface IHideMarkdownMessage {
	type: 'hideMarkdownPreview';
	id: string;
}

export interface IUnhideMarkdownMessage {
	type: 'unhideMarkdownPreview';
	id: string;
}

export interface IShowMarkdownMessage {
	type: 'showMarkdownPreview',
	id: string;
	content: string;
	top: number;
}

export interface IUpdateMarkdownPreviewSelectionState {
	readonly type: 'updateMarkdownPreviewSelectionState',
	readonly id: string;
	readonly isSelected: boolean;
}

export interface IInitializeMarkdownMessage {
	type: 'initializeMarkdownPreview';
	cells: Array<{ cellId: string, content: string }>;
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
	| IClickedDataUrlMessage
	| IFocusMarkdownPreviewMessage
	| IMouseEnterMarkdownPreviewMessage
	| IMouseLeaveMarkdownPreviewMessage
	| IToggleMarkdownPreviewMessage
	| ICellDragStartMessage
	| ICellDragMessage
	| ICellDragEndMessage
	| IInitializedMarkdownPreviewMessage
	;
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
	| ICustomRendererMessage
	| ICreateMarkdownMessage
	| IRemoveMarkdownMessage
	| IShowMarkdownMessage
	| IHideMarkdownMessage
	| IUnhideMarkdownMessage
	| IUpdateMarkdownPreviewSelectionState
	| IInitializeMarkdownMessage
	| IViewScrollMarkdownRequestMessage;

export type AnyMessage = FromWebviewMessage | ToWebviewMessage;

export interface ICachedInset<K extends ICommonCellInfo> {
	outputId: string;
	cellInfo: K;
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

export interface IResolvedBackLayerWebview {
	webview: WebviewElement;
}

let version = 0;
export class BackLayerWebView<T extends ICommonCellInfo> extends Disposable {
	element: HTMLElement;
	webview: WebviewElement | undefined = undefined;
	insetMapping: Map<IDisplayOutputViewModel, ICachedInset<T>> = new Map();
	markdownPreviewMapping: Set<string> = new Set();
	hiddenInsetMapping: Set<IDisplayOutputViewModel> = new Set();
	reversedInsetMapping: Map<string, IDisplayOutputViewModel> = new Map();
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
		public notebookEditor: ICommonNotebookEditor,
		public id: string,
		public documentUri: URI,
		public options: {
			outputNodePadding: number,
			outputNodeLeftPadding: number,
			leftMargin: number,
			cellMargin: number,
			runGutter: number,
		},
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

		this.element.style.height = '1400px';
		this.element.style.position = 'absolute';
	}
	private generateContent(coreDependencies: string, baseUrl: string) {
		const markdownRenderersSrc = this.getMarkdownRendererScripts();
		return html`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<base href="${baseUrl}/"/>
				<style>
					#container > div > div.output {
						width: calc(100% - ${this.options.leftMargin + (this.options.cellMargin * 2) + this.options.runGutter}px);
						margin-left: ${this.options.leftMargin + this.options.runGutter}px;
						padding: ${this.options.outputNodePadding}px ${this.options.outputNodePadding}px ${this.options.outputNodePadding}px ${this.options.outputNodeLeftPadding}px;
						box-sizing: border-box;
						background-color: var(--vscode-notebook-outputContainerBackgroundColor);
					}

					#container > div > div.preview {
						width: 100%;
						box-sizing: border-box;
						white-space: nowrap;
						overflow: hidden;
						user-select: text;
						-webkit-user-select: text;
						-ms-user-select: text;
						white-space: initial;
						cursor: grab;
					}

					/* markdown */
					#container > div > div.preview {
						color: var(--vscode-foreground);
						width: calc(100% - ${this.options.cellMargin}px);
						padding-left: ${this.options.leftMargin}px;
					}

					#container > div > div.preview.selected {
						background: var(--vscode-notebook-selectedCellBackground);
					}

					#container > div > div.preview img {
						max-width: 100%;
						max-height: 100%;
					}

					#container > div > div.preview a {
						text-decoration: none;
					}

					#container > div > div.preview a:hover {
						text-decoration: underline;
					}

					#container > div > div.preview a:focus,
					#container > div > div.preview input:focus,
					#container > div > div.preview select:focus,
					#container > div > div.preview textarea:focus {
						outline: 1px solid -webkit-focus-ring-color;
						outline-offset: -1px;
					}

					#container > div > div.preview hr {
						border: 0;
						height: 2px;
						border-bottom: 2px solid;
					}

					#container > div > div.preview h1 {
						padding-bottom: 0.3em;
						line-height: 1.2;
						border-bottom-width: 1px;
						border-bottom-style: solid;
						border-color: var(--vscode-foreground);
					}

					#container > div > div.preview h1,
					#container > div > div.preview h2,
					#container > div > div.preview h3 {
						font-weight: normal;
					}

					#container > div > div.preview div {
						width: 100%;
					}

					/* Adjust margin of first item in markdown cell */
					#container > div > div.preview *:first-child {
						margin-top: 0px;
					}

					/* h1 tags don't need top margin */
					#container > div > div.preview h1:first-child {
						margin-top: 0;
					}

					/* Removes bottom margin when only one item exists in markdown cell */
					#container > div > div.preview *:only-child,
					#container > div > div.preview *:last-child {
						margin-bottom: 0;
						padding-bottom: 0;
					}

					/* makes all markdown cells consistent */
					#container > div > div.preview div {
						min-height: 24px;
					}

					#container > div > div.preview table {
						border-collapse: collapse;
						border-spacing: 0;
					}

					#container > div > div.preview table th,
					#container > div > div.preview table td {
						border: 1px solid;
					}

					#container > div > div.preview table > thead > tr > th {
						text-align: left;
						border-bottom: 1px solid;
					}

					#container > div > div.preview table > thead > tr > th,
					#container > div > div.preview table > thead > tr > td,
					#container > div > div.preview table > tbody > tr > th,
					#container > div > div.preview table > tbody > tr > td {
						padding: 5px 10px;
					}

					#container > div > div.preview table > tbody > tr + tr > td {
						border-top: 1px solid;
					}

					#container > div > div.preview blockquote {
						margin: 0 7px 0 5px;
						padding: 0 16px 0 10px;
						border-left-width: 5px;
						border-left-style: solid;
					}

					#container > div > div.preview code,
					#container > div > div.preview .code {
						font-family: var(--monaco-monospace-font);
						font-size: 1em;
						line-height: 1.357em;
					}

					#container > div > div.preview .code {
						white-space: pre-wrap;
					}

					#container > div > div.preview .latex-block {
						display: block;
					}

					#container > div > div.preview .latex {
						vertical-align: middle;
						display: inline-block;
					}

					#container > div > div.preview .latex img,
					#container > div > div.preview .latex-block img {
						filter: brightness(0) invert(0)
					}

					#container > div > div.preview.dragging {
						background-color: var(--vscode-editor-background);
					}

					.monaco-workbench.vs-dark .notebookOverlay .cell.markdown .latex img,
					.monaco-workbench.vs-dark .notebookOverlay .cell.markdown .latex-block img {
						filter: brightness(0) invert(1)
					}

					#container > div.nb-symbolHighlight > div {
						background-color: var(--vscode-notebook-symbolHighlightBackground);
					}

					#container > div.nb-cellDeleted > div {
						background-color: var(--vscode-diffEditor-removedTextBackground);
					}

					#container > div.nb-cellAdded > div {
						background-color: var(--vscode-diffEditor-insertedTextBackground);
					}

					#container > div > div:not(.preview) > div {
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
				<script>${preloadsScriptStr({
			outputNodePadding: this.options.outputNodePadding,
			outputNodeLeftPadding: this.options.outputNodeLeftPadding,
			previewNodePadding: 8,
			leftMargin: this.options.leftMargin
		})}</script>
				${markdownRenderersSrc}
			</body>
		</html>`;
	}

	private getMarkdownRendererScripts() {
		const markdownRenderers = this.notebookService.getMarkdownRendererInfo();

		return markdownRenderers
			.sort((a, b) => {
				// prefer built-in extension
				if (a.extensionIsBuiltin) {
					return b.extensionIsBuiltin ? 0 : -1;
				}
				return b.extensionIsBuiltin ? 1 : -1;
			})
			.map(renderer => {
				return asWebviewUri(this.environmentService, this.id, renderer.entrypoint);
			})
			.map(src => `<script src="${src}"></script>`)
			.join('\n');
	}

	postRendererMessage(rendererId: string, message: any) {
		this._sendMessageToWebview({
			__vscode_notebook_message: true,
			type: 'customRendererMessage',
			message,
			rendererId
		});
	}

	private resolveOutputId(id: string): { cellInfo: T, output: ICellOutputViewModel } | undefined {
		const output = this.reversedInsetMapping.get(id);
		if (!output) {
			return;
		}

		const cellInfo = this.insetMapping.get(output)!.cellInfo;
		return { cellInfo, output };
	}

	isResolved(): this is IResolvedBackLayerWebview {
		return !!this.webview;
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
			const htmlContent = this.generateContent(coreDependencies, baseUrl.toString());
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

				const htmlContent = this.generateContent(coreDependencies, baseUrl.toString());
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
				this.openerService.open(link, { fromUserGesture: true, allowContributedOpeners: true });
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

		this._register(this.webview.onMessage((data: FromWebviewMessage | { readonly __vscode_notebook_message: undefined }) => {
			if (this._disposed) {
				return;
			}

			if (!data.__vscode_notebook_message) {
				this._onMessage.fire({ message: data });
				return;
			}

			switch (data.type) {
				case 'dimension':
					{
						if (data.isOutput) {
							const height = data.data.height;
							const outputHeight = height;

							const resolvedResult = this.resolveOutputId(data.id);
							if (resolvedResult) {
								const { cellInfo, output } = resolvedResult;
								this.notebookEditor.updateOutputHeight(cellInfo, output, outputHeight, !!data.init);
							}
						} else {
							const cellId = data.id.substr(0, data.id.length - '_preview'.length);
							this.notebookEditor.updateMarkdownCellHeight(cellId, data.data.height, !!data.init);
						}
						break;
					}
				case 'mouseenter':
					{
						const resolvedResult = this.resolveOutputId(data.id);
						if (resolvedResult) {
							const latestCell = this.notebookEditor.getCellByInfo(resolvedResult.cellInfo);
							if (latestCell) {
								latestCell.outputIsHovered = true;
							}
						}
						break;
					}
				case 'mouseleave':
					{
						const resolvedResult = this.resolveOutputId(data.id);
						if (resolvedResult) {
							const latestCell = this.notebookEditor.getCellByInfo(resolvedResult.cellInfo);
							if (latestCell) {
								latestCell.outputIsHovered = false;
							}
						}
						break;
					}
				case 'scroll-ack':
					{
						// const date = new Date();
						// const top = data.data.top;
						// console.log('ack top ', top, ' version: ', data.version, ' - ', date.getMinutes() + ':' + date.getSeconds() + ':' + date.getMilliseconds());
						break;
					}
				case 'did-scroll-wheel':
					{
						this.notebookEditor.triggerScroll({
							...data.payload,
							preventDefault: () => { },
							stopPropagation: () => { }
						});
						break;
					}
				case 'focus-editor':
					{
						const resolvedResult = this.resolveOutputId(data.id);
						if (resolvedResult) {
							const latestCell = this.notebookEditor.getCellByInfo(resolvedResult.cellInfo);
							if (!latestCell) {
								return;
							}

							if (data.focusNext) {
								this.notebookEditor.focusNextNotebookCell(latestCell, 'editor');
							} else {
								this.notebookEditor.focusNotebookCell(latestCell, 'editor');
							}
						}
						break;
					}
				case 'clicked-data-url':
					{
						this._onDidClickDataLink(data);
						break;
					}
				case 'customRendererMessage':
					{
						this._onMessage.fire({ message: data.message, forRenderer: data.rendererId });
						break;
					}
				case 'focusMarkdownPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							this.notebookEditor.focusNotebookCell(cell, 'container', { skipReveal: true });
						}
						break;
					}
				case 'toggleMarkdownPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							this.notebookEditor.setMarkdownCellEditState(data.cellId, CellEditState.Editing);
							this.notebookEditor.focusNotebookCell(cell, 'editor', { skipReveal: true });
						}
						break;
					}
				case 'mouseEnterMarkdownPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell instanceof MarkdownCellViewModel) {
							cell.cellIsHovered = true;
						}
						break;
					}
				case 'mouseLeaveMarkdownPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell instanceof MarkdownCellViewModel) {
							cell.cellIsHovered = false;
						}
						break;
					}
				case 'cell-drag-start':
					{
						this.notebookEditor.markdownCellDragStart(data.cellId, data.position);
						break;
					}
				case 'cell-drag':
					{
						this.notebookEditor.markdownCellDrag(data.cellId, data.position);
						break;
					}
				case 'cell-drag-end':
					{
						this.notebookEditor.markdownCellDragEnd(data.cellId, {
							clientY: data.position.clientY,
							ctrlKey: data.ctrlKey,
							altKey: data.altKey,
						});
						break;
					}
			}

		}));
	}

	private async _onDidClickDataLink(event: IClickedDataUrlMessage): Promise<void> {
		if (typeof event.data !== 'string') {
			return;
		}

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

		this.localResourceRootsCache = [
			...this.notebookService.getNotebookProviderResourceRoots(),
			...this.notebookService.getMarkdownRendererInfo().map(x => dirname(x.entrypoint)),
			...workspaceFolders,
			rootPath,
		];

		const webview = webviewService.createWebviewElement(this.id, {
			purpose: WebviewContentPurpose.NotebookRenderer,
			enableFindWidget: false,
			transformCssVariables: transformWebviewThemeVars,
		}, {
			allowMultipleAPIAcquire: true,
			allowScripts: true,
			allowWebUSB: true,
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

	shouldUpdateInset(cell: IGenericCellViewModel, output: ICellOutputViewModel, cellTop: number) {
		if (this._disposed) {
			return;
		}

		if (cell.metadata?.outputCollapsed) {
			return false;
		}

		const outputCache = this.insetMapping.get(output)!;
		const outputIndex = cell.outputsViewModels.indexOf(output);
		const outputOffset = cellTop + cell.getOutputOffset(outputIndex);

		if (this.hiddenInsetMapping.has(output)) {
			return true;
		}

		if (outputOffset === outputCache.cachedCreation.top) {
			return false;
		}

		return true;
	}

	updateMarkdownScrollTop(items: { id: string, top: number }[]) {
		this._sendMessageToWebview({
			type: 'view-scroll-markdown',
			cells: items
		});
	}

	updateViewScrollTop(top: number, forceDisplay: boolean, items: IDisplayOutputLayoutUpdateRequest[]) {
		if (this._disposed) {
			return;
		}

		const widgets: IContentWidgetTopRequest[] = items.map(item => {
			const outputCache = this.insetMapping.get(item.output)!;
			const id = outputCache.outputId;
			const outputOffset = item.outputOffset;
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

	async createMarkdownPreview(cellId: string, content: string, cellTop: number) {
		if (this._disposed) {
			return;
		}

		const initialTop = cellTop;
		this.markdownPreviewMapping.add(cellId);

		this._sendMessageToWebview({
			type: 'createMarkdownPreview',
			id: cellId,
			content: content,
			top: initialTop,
		});
	}

	async showMarkdownPreview(cellId: string, content: string, cellTop: number) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'showMarkdownPreview',
			id: cellId,
			content: content,
			top: cellTop
		});
	}

	async hideMarkdownPreview(cellId: string,) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'hideMarkdownPreview',
			id: cellId
		});
	}

	async unhideMarkdownPreview(cellId: string,) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'unhideMarkdownPreview',
			id: cellId
		});
	}

	async removeMarkdownPreview(cellId: string,) {
		if (this._disposed) {
			return;
		}

		this.markdownPreviewMapping.delete(cellId);

		this._sendMessageToWebview({
			type: 'removeMarkdownPreview',
			id: cellId
		});
	}

	async updateMarkdownPreviewSelectionState(cellId: any, isSelected: boolean) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'updateMarkdownPreviewSelectionState',
			id: cellId,
			isSelected
		});
	}

	async updateMarkdownPreviewDecpratopms(cellId: any, isSelected: boolean) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'updateMarkdownPreviewSelectionState',
			id: cellId,
			isSelected
		});
	}

	async initializeMarkdown(cells: Array<{ cellId: string, content: string }>) {
		await this._loaded;

		// TODO: use proper handler
		const p = new Promise<void>(resolve => {
			this.webview?.onMessage(e => {
				if (e.type === 'initializedMarkdownPreview') {
					resolve();
				}
			});
		});

		for (const cell of cells) {
			this.markdownPreviewMapping.add(cell.cellId);
		}

		this._sendMessageToWebview({
			type: 'initializeMarkdownPreview',
			cells: cells,
		});

		await p;
	}

	async createInset(cellInfo: T, content: IInsetRenderOutput, cellTop: number, offset: number) {
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
					cellId: outputCache.cellInfo.cellId,
					outputId: outputCache.outputId,
					top: initialTop
				});
				return;
			}
		}

		const messageBase = {
			type: 'html',
			cellId: cellInfo.cellId,
			top: initialTop,
			left: 0,
			requiredPreloads: [],
		} as const;

		let message: ICreationRequestMessage;
		let renderer: INotebookRendererInfo | undefined;
		if (content.type === RenderOutputType.Extension) {
			const output = content.source.model;
			renderer = content.renderer;
			let data: { [key: string]: unknown } = {};
			let metadata: { [key: string]: unknown } = {};
			data[content.mimeType] = output.outputs.find(op => op.mime === content.mimeType)?.value || undefined;
			metadata[content.mimeType] = output.outputs.find(op => op.mime === content.mimeType)?.metadata || undefined;
			message = {
				...messageBase,
				outputId: output.outputId,
				apiNamespace: content.renderer.id,
				requiredPreloads: await this.updateRendererPreloads([content.renderer]),
				content: {
					type: RenderOutputType.Extension,
					mimeType: content.mimeType,
					output: {
						metadata: metadata,
						data: data,
						outputId: output.outputId
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
		this.insetMapping.set(content.source, { outputId: message.outputId, cellInfo: cellInfo, renderer, cachedCreation: message });
		this.hiddenInsetMapping.delete(content.source);
		this.reversedInsetMapping.set(message.outputId, content.source);
	}

	removeInset(output: ICellOutputViewModel) {
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
			cellUri: outputCache.cellInfo.cellUri.toString(),
			outputId: id,
			cellId: outputCache.cellInfo.cellId
		});
		this.insetMapping.delete(output);
		this.reversedInsetMapping.delete(id);
	}

	hideInset(output: ICellOutputViewModel) {
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
			cellId: outputCache.cellInfo.cellId,
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
