/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from 'vs/base/common/actions';
import { coalesce } from 'vs/base/common/arrays';
import { VSBuffer } from 'vs/base/common/buffer';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { getExtensionForMimeType } from 'vs/base/common/mime';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { dirname, joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import * as nls from 'vs/nls';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFileService } from 'vs/platform/files/common/files';
import { IOpenerService, matchesScheme } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
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

export interface DimensionUpdate {
	id: string;
	init?: boolean;
	height: number;
	isOutput?: boolean;
}

export interface IDimensionMessage extends BaseToWebviewMessage {
	type: 'dimension';
	updates: readonly DimensionUpdate[];
}

export interface IMouseEnterMessage extends BaseToWebviewMessage {
	type: 'mouseenter';
	id: string;
}

export interface IMouseLeaveMessage extends BaseToWebviewMessage {
	type: 'mouseleave';
	id: string;
}

export interface IOutputFocusMessage extends BaseToWebviewMessage {
	type: 'outputFocus';
	id: string;
}

export interface IOutputBlurMessage extends BaseToWebviewMessage {
	type: 'outputBlur';
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

export interface IClickMarkdownPreviewMessage extends BaseToWebviewMessage {
	readonly type: 'clickMarkdownPreview';
	readonly cellId: string;
	readonly ctrlKey: boolean
	readonly altKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}

export interface IContextMenuMarkdownPreviewMessage extends BaseToWebviewMessage {
	readonly type: 'contextMenuMarkdownPreview';
	readonly cellId: string;
	readonly clientX: number;
	readonly clientY: number;
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
	readonly cellId: string;
	readonly position: {
		readonly clientY: number;
	};
}

export interface ICellDragMessage extends BaseToWebviewMessage {
	type: 'cell-drag';
	readonly cellId: string;
	readonly position: {
		readonly clientY: number;
	};
}

export interface ICellDropMessage extends BaseToWebviewMessage {
	readonly type: 'cell-drop';
	readonly cellId: string;
	readonly ctrlKey: boolean
	readonly altKey: boolean;
	readonly position: {
		readonly clientY: number;
	};
}

export interface ICellDragEndMessage extends BaseToWebviewMessage {
	readonly type: 'cell-drag-end';
	readonly cellId: string;
}

export interface IInitializedMarkdownPreviewMessage extends BaseToWebviewMessage {
	readonly type: 'initializedMarkdownPreview';
}

export interface ITelemetryFoundRenderedMarkdownMath extends BaseToWebviewMessage {
	readonly type: 'telemetryFoundRenderedMarkdownMath';
}

export interface ITelemetryFoundUnrenderedMarkdownMath extends BaseToWebviewMessage {
	readonly type: 'telemetryFoundUnrenderedMarkdownMath';
	readonly latexDirective: string;
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
	| { type: RenderOutputType.Extension; outputId: string; value: unknown; metadata: unknown; mimeType: string };
	cellId: string;
	outputId: string;
	cellTop: number;
	outputOffset: number;
	left: number;
	requiredPreloads: ReadonlyArray<IPreloadResource>;
	readonly initiallyHidden?: boolean;
	rendererId?: string | undefined;
}

export interface IContentWidgetTopRequest {
	outputId: string;
	cellTop: number;
	outputOffset: number;
	forceDisplay: boolean;
}

export interface IViewScrollTopRequestMessage {
	type: 'view-scroll';
	widgets: IContentWidgetTopRequest[];
	markdownPreviews: { id: string; top: number }[];
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
	rendererId: string | undefined;
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
	cellTop: number;
	outputOffset: number;
}

export interface IFocusOutputMessage {
	type: 'focus-output';
	cellId: string;
}

export interface IAckOutputHeightMessage {
	type: 'ack-dimension',
	cellId: string;
	outputId: string;
	height: number;
}

export interface IPreloadResource {
	originalUri: string;
	uri: string;
	source: 'kernel' | { rendererId: string };
}

export interface IUpdatePreloadResourceMessage {
	type: 'preload';
	resources: IPreloadResource[];
}

export interface IUpdateDecorationsMessage {
	type: 'decorations';
	cellId: string;
	addedClassNames: string[];
	removedClassNames: string[];
}

export interface ICustomKernelMessage extends BaseToWebviewMessage {
	type: 'customKernelMessage';
	message: unknown;
}

export interface ICreateMarkdownMessage {
	type: 'createMarkdownPreview',
	id: string;
	handle: number;
	content: string;
	top: number;
}
export interface IDeleteMarkdownMessage {
	type: 'deleteMarkdownPreview',
	ids: readonly string[];
}

export interface IHideMarkdownMessage {
	type: 'hideMarkdownPreviews';
	ids: readonly string[];
}

export interface IUnhideMarkdownMessage {
	type: 'unhideMarkdownPreviews';
	ids: readonly string[];
}

export interface IShowMarkdownMessage {
	type: 'showMarkdownPreview',
	id: string;
	handle: number;
	content: string | undefined;
	top: number;
}

export interface IUpdateSelectedMarkdownPreviews {
	readonly type: 'updateSelectedMarkdownPreviews',
	readonly selectedCellIds: readonly string[]
}

export interface IInitializeMarkdownMessage {
	type: 'initializeMarkdownPreview';
	cells: Array<{ cellId: string, cellHandle: number, content: string, offset: number }>;
}

export type FromWebviewMessage =
	| WebviewIntialized
	| IDimensionMessage
	| IMouseEnterMessage
	| IMouseLeaveMessage
	| IOutputFocusMessage
	| IOutputBlurMessage
	| IWheelMessage
	| IScrollAckMessage
	| IBlurOutputMessage
	| ICustomKernelMessage
	| IClickedDataUrlMessage
	| IClickMarkdownPreviewMessage
	| IContextMenuMarkdownPreviewMessage
	| IMouseEnterMarkdownPreviewMessage
	| IMouseLeaveMarkdownPreviewMessage
	| IToggleMarkdownPreviewMessage
	| ICellDragStartMessage
	| ICellDragMessage
	| ICellDropMessage
	| ICellDragEndMessage
	| IInitializedMarkdownPreviewMessage
	| ITelemetryFoundRenderedMarkdownMath
	| ITelemetryFoundUnrenderedMarkdownMath
	;

export type ToWebviewMessage =
	| IClearMessage
	| IFocusOutputMessage
	| IAckOutputHeightMessage
	| ICreationRequestMessage
	| IViewScrollTopRequestMessage
	| IScrollRequestMessage
	| IClearOutputRequestMessage
	| IHideOutputMessage
	| IShowOutputMessage
	| IUpdatePreloadResourceMessage
	| IUpdateDecorationsMessage
	| ICustomKernelMessage
	| ICreateMarkdownMessage
	| IDeleteMarkdownMessage
	| IShowMarkdownMessage
	| IHideMarkdownMessage
	| IUnhideMarkdownMessage
	| IUpdateSelectedMarkdownPreviews
	| IInitializeMarkdownMessage;

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
}

export interface IResolvedBackLayerWebview {
	webview: WebviewElement;
}

export class BackLayerWebView<T extends ICommonCellInfo> extends Disposable {
	element: HTMLElement;
	webview: WebviewElement | undefined = undefined;
	insetMapping: Map<IDisplayOutputViewModel, ICachedInset<T>> = new Map();
	readonly markdownPreviewMapping = new Map<string, { contentHash: number, visible: boolean }>();
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
			previewNodePadding: number,
			leftMargin: number,
			rightMargin: number,
			runGutter: number,
		},
		@IWebviewService readonly webviewService: IWebviewService,
		@IOpenerService readonly openerService: IOpenerService,
		@INotebookService private readonly notebookService: INotebookService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) {
		super();

		this.element = document.createElement('div');

		this.element.style.height = '1400px';
		this.element.style.position = 'absolute';
	}
	private generateContent(coreDependencies: string, baseUrl: string) {
		const markupRenderer = this.getMarkdownRenderer();
		const outputWidth = `calc(100% - ${this.options.leftMargin + this.options.rightMargin + this.options.runGutter}px)`;
		const outputMarginLeft = `${this.options.leftMargin + this.options.runGutter}px`;
		return html`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<base href="${baseUrl}/"/>

				<!--
				Markdown previews are rendered using a shadow dom and are not effected by normal css.
				Insert this style node into all preview shadow doms for styling.
				-->
				<template id="preview-styles">
					<style>
						img {
							max-width: 100%;
							max-height: 100%;
						}

						a {
							text-decoration: none;
						}

						a:hover {
							text-decoration: underline;
						}

						a:focus,
						input:focus,
						select:focus,
						textarea:focus {
							outline: 1px solid -webkit-focus-ring-color;
							outline-offset: -1px;
						}

						hr {
							border: 0;
							height: 2px;
							border-bottom: 2px solid;
						}

						h1 {
							font-size: 26px;
							line-height: 31px;
							margin: 0;
							margin-bottom: 13px;
						}

						h2 {
							font-size: 19px;
							margin: 0;
							margin-bottom: 10px;
						}

						h1,
						h2,
						h3 {
							font-weight: normal;
						}

						div {
							width: 100%;
						}

						/* Adjust margin of first item in markdown cell */
						*:first-child {
							margin-top: 0px;
						}

						/* h1 tags don't need top margin */
						h1:first-child {
							margin-top: 0;
						}

						/* Removes bottom margin when only one item exists in markdown cell */
						*:only-child,
						*:last-child {
							margin-bottom: 0;
							padding-bottom: 0;
						}

						/* makes all markdown cells consistent */
						div {
							min-height: ${this.options.previewNodePadding * 2}px;
						}

						table {
							border-collapse: collapse;
							border-spacing: 0;
						}

						table th,
						table td {
							border: 1px solid;
						}

						table > thead > tr > th {
							text-align: left;
							border-bottom: 1px solid;
						}

						table > thead > tr > th,
						table > thead > tr > td,
						table > tbody > tr > th,
						table > tbody > tr > td {
							padding: 5px 10px;
						}

						table > tbody > tr + tr > td {
							border-top: 1px solid;
						}

						blockquote {
							margin: 0 7px 0 5px;
							padding: 0 16px 0 10px;
							border-left-width: 5px;
							border-left-style: solid;
						}

						code,
						.code {
							font-family: var(--monaco-monospace-font);
							font-size: 1em;
							line-height: 1.357em;
						}

						.code {
							white-space: pre-wrap;
						}

						dragging {
							background-color: var(--vscode-editor-background);
						}
					</style>
				</template>
				<style>
					#container .cell_container {
						width: 100%;
					}

					#container .output_container {
						width: 100%;
					}

					#container > div > div > div.output {
						width: ${outputWidth};
						margin-left: ${outputMarginLeft};
						padding: ${this.options.outputNodePadding}px ${this.options.outputNodePadding}px ${this.options.outputNodePadding}px ${this.options.outputNodeLeftPadding}px;
						box-sizing: border-box;
						background-color: var(--vscode-notebook-outputContainerBackgroundColor);
					}

					/* markdown */
					#container > div.preview {
						width: 100%;
						padding-right: ${this.options.previewNodePadding}px;
						padding-left: ${this.options.leftMargin}px;
						padding-top: ${this.options.previewNodePadding}px;
						padding-bottom: ${this.options.previewNodePadding}px;

						box-sizing: border-box;
						white-space: nowrap;
						overflow: hidden;
						user-select: none;
						-webkit-user-select: none;
						-ms-user-select: none;
						white-space: initial;
						cursor: grab;

						color: var(--vscode-foreground);
					}

					#container > div.preview.emptyMarkdownCell::before {
						content: "${nls.localize('notebook.emptyMarkdownPlaceholder', "Empty markdown cell, double click or press enter to edit.")}";
						font-style: italic;
						opacity: 0.6;
					}

					#container > div.preview.selected {
						background: var(--vscode-notebook-selectedCellBackground);
					}

					#container > div.preview.dragging {
						background-color: var(--vscode-editor-background);
					}

					.monaco-workbench.vs-dark .notebookOverlay .cell.markdown .latex img,
					.monaco-workbench.vs-dark .notebookOverlay .cell.markdown .latex-block img {
						filter: brightness(0) invert(1)
					}

					#container > div.nb-symbolHighlight {
						background-color: var(--vscode-notebook-symbolHighlightBackground);
					}

					#container > div.nb-cellDeleted {
						background-color: var(--vscode-diffEditor-removedTextBackground);
					}

					#container > div.nb-cellAdded {
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
				<script type="module">${preloadsScriptStr({
			outputNodePadding: this.options.outputNodePadding,
			outputNodeLeftPadding: this.options.outputNodeLeftPadding,
		}, {
			entrypoint: markupRenderer[0].entrypoint,
			dependencies: markupRenderer[0].dependencies,
		})}</script>
			</body>
		</html>`;
	}

	private getMarkdownRenderer(): Array<{ entrypoint: string, dependencies: Array<{ entrypoint: string }> }> {
		const allRenderers = this.notebookService.getMarkupRendererInfo();

		const topLevelMarkdownRenderers = allRenderers
			.filter(renderer => !renderer.dependsOn)
			.filter(renderer => renderer.mimeTypes?.includes('text/markdown'));

		const subRenderers = new Map<string, Array<{ entrypoint: string }>>();
		for (const renderer of allRenderers) {
			if (renderer.dependsOn) {
				if (!subRenderers.has(renderer.dependsOn)) {
					subRenderers.set(renderer.dependsOn, []);
				}
				const entryPoint = asWebviewUri(this.environmentService, this.id, renderer.entrypoint);
				subRenderers.get(renderer.dependsOn)!.push({ entrypoint: entryPoint.toString(true) });
			}
		}

		return topLevelMarkdownRenderers.map((renderer) => {
			const src = asWebviewUri(this.environmentService, this.id, renderer.entrypoint);
			return {
				entrypoint: src.toString(),
				dependencies: subRenderers.get(renderer.id) || [],
			};
		});
	}

	postKernelMessage(message: any) {
		this._sendMessageToWebview({
			__vscode_notebook_message: true,
			type: 'customKernelMessage',
			message,
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
			}, error => {
				// the fetch request is rejected
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
				this.openerService.open(link, { fromUserGesture: true, allowContributedOpeners: true, allowCommands: true });
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

		this._register(this.webview.onMessage((message) => {
			const data: FromWebviewMessage | { readonly __vscode_notebook_message: undefined } = message.message;
			if (this._disposed) {
				return;
			}

			if (!data.__vscode_notebook_message) {
				return;
			}

			switch (data.type) {
				case 'dimension':
					{
						for (const update of data.updates) {
							const height = update.height;
							if (update.isOutput) {
								const resolvedResult = this.resolveOutputId(update.id);
								if (resolvedResult) {
									const { cellInfo, output } = resolvedResult;
									this.notebookEditor.updateOutputHeight(cellInfo, output, height, !!update.init, 'webview#dimension');
									this.notebookEditor.scheduleOutputHeightAck(cellInfo, update.id, height);
								}
							} else {
								this.notebookEditor.updateMarkdownCellHeight(update.id, height, !!update.init);
							}
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
				case 'outputFocus':
					{
						const resolvedResult = this.resolveOutputId(data.id);
						if (resolvedResult) {
							const latestCell = this.notebookEditor.getCellByInfo(resolvedResult.cellInfo);
							if (latestCell) {
								latestCell.outputIsFocused = true;
							}
						}
						break;
					}
				case 'outputBlur':
					{
						const resolvedResult = this.resolveOutputId(data.id);
						if (resolvedResult) {
							const latestCell = this.notebookEditor.getCellByInfo(resolvedResult.cellInfo);
							if (latestCell) {
								latestCell.outputIsFocused = false;
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
				case 'customKernelMessage':
					{
						this._onMessage.fire({ message: data.message });
						break;
					}
				case 'clickMarkdownPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							if (data.shiftKey || (isMacintosh ? data.metaKey : data.ctrlKey)) {
								// Add to selection
								this.notebookEditor.toggleNotebookCellSelection(cell);
							} else {
								// Normal click
								this.notebookEditor.focusNotebookCell(cell, 'container', { skipReveal: true });
							}
						}
						break;
					}
				case 'contextMenuMarkdownPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							// Focus the cell first
							this.notebookEditor.focusNotebookCell(cell, 'container', { skipReveal: true });

							// Then show the context menu
							const webviewRect = this.element.getBoundingClientRect();
							this.contextMenuService.showContextMenu({
								getActions: () => {
									const result: IAction[] = [];
									const menu = this.menuService.createMenu(MenuId.NotebookCellTitle, this.contextKeyService);
									createAndFillInContextMenuActions(menu, undefined, result);
									menu.dispose();
									return result;
								},
								getAnchor: () => ({
									x: webviewRect.x + data.clientX,
									y: webviewRect.y + data.clientY
								})
							});
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
				case 'cell-drop':
					{
						this.notebookEditor.markdownCellDrop(data.cellId, {
							clientY: data.position.clientY,
							ctrlKey: data.ctrlKey,
							altKey: data.altKey,
						});
						break;
					}
				case 'cell-drag-end':
					{
						this.notebookEditor.markdownCellDragEnd(data.cellId);
						break;
					}

				case 'telemetryFoundRenderedMarkdownMath':
					{
						this.telemetryService.publicLog2<{}, {}>('notebook/markdown/renderedLatex', {});
						break;
					}
				case 'telemetryFoundUnrenderedMarkdownMath':
					{
						type Classification = {
							latexDirective: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
						};

						type TelemetryEvent = {
							latexDirective: string;
						};

						this.telemetryService.publicLog2<TelemetryEvent, Classification>('notebook/markdown/foundUnrenderedLatex', {
							latexDirective: data.latexDirective
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
			...this.notebookService.getMarkupRendererInfo().map(x => dirname(x.entrypoint)),
			...workspaceFolders,
			rootPath,
		];

		const webview = webviewService.createWebviewElement(this.id, {
			purpose: WebviewContentPurpose.NotebookRenderer,
			enableFindWidget: false,
			transformCssVariables: transformWebviewThemeVars,
			serviceWorkerFetchIgnoreSubdomain: true
		}, {
			allowMultipleAPIAcquire: true,
			allowScripts: true,
			allowWebUSB: true,
			localResourceRoots: this.localResourceRootsCache,
			useRootAuthority: true
		}, undefined);

		let resolveFunc: () => void;
		this._loaded = new Promise<void>((resolve, reject) => {
			resolveFunc = resolve;
		});

		const dispose = webview.onMessage((message) => {
			const data: FromWebviewMessage = message.message;
			if (data.__vscode_notebook_message && data.type === 'initialized') {
				resolveFunc();
				dispose.dispose();
			}
		});

		webview.html = content;
		return webview;
	}

	private shouldUpdateInset(cell: IGenericCellViewModel, output: ICellOutputViewModel, cellTop: number, outputOffset: number): boolean {
		if (this._disposed) {
			return false;
		}

		if (cell.metadata?.outputCollapsed) {
			return false;
		}

		if (this.hiddenInsetMapping.has(output)) {
			return true;
		}

		const outputCache = this.insetMapping.get(output);
		if (!outputCache) {
			return false;
		}

		if (outputOffset === outputCache.cachedCreation.outputOffset && cellTop === outputCache.cachedCreation.cellTop) {
			return false;
		}

		return true;
	}

	ackHeight(cellId: string, id: string, height: number): void {
		this._sendMessageToWebview({
			type: 'ack-dimension',
			cellId: cellId,
			outputId: id,
			height: height
		});
	}

	updateScrollTops(outputRequests: IDisplayOutputLayoutUpdateRequest[], markdownPreviews: { id: string, top: number }[]) {
		if (this._disposed) {
			return;
		}

		const widgets = coalesce(outputRequests.map((request): IContentWidgetTopRequest | undefined => {
			const outputCache = this.insetMapping.get(request.output);
			if (!outputCache) {
				return;
			}

			if (!request.forceDisplay && !this.shouldUpdateInset(request.cell, request.output, request.cellTop, request.outputOffset)) {
				return;
			}

			const id = outputCache.outputId;
			outputCache.cachedCreation.cellTop = request.cellTop;
			outputCache.cachedCreation.outputOffset = request.outputOffset;
			this.hiddenInsetMapping.delete(request.output);

			return {
				outputId: id,
				cellTop: request.cellTop,
				outputOffset: request.outputOffset,
				forceDisplay: request.forceDisplay,
			};
		}));

		if (!widgets.length && !markdownPreviews.length) {
			return;
		}

		this._sendMessageToWebview({
			type: 'view-scroll',
			widgets: widgets,
			markdownPreviews,
		});
	}

	private async createMarkdownPreview(cellId: string, cellHandle: number, content: string, cellTop: number, contentHash: number) {
		if (this._disposed) {
			return;
		}

		if (this.markdownPreviewMapping.has(cellId)) {
			console.error('Trying to create markdown preview that already exists');
			return;
		}

		const initialTop = cellTop;
		this.markdownPreviewMapping.set(cellId, { contentHash, visible: true });

		this._sendMessageToWebview({
			type: 'createMarkdownPreview',
			id: cellId,
			handle: cellHandle,
			content: content,
			top: initialTop,
		});
	}

	async showMarkdownPreview(cellId: string, cellHandle: number, content: string, cellTop: number, contentHash: number) {
		if (this._disposed) {
			return;
		}

		if (!this.markdownPreviewMapping.has(cellId)) {
			return this.createMarkdownPreview(cellId, cellHandle, content, cellTop, contentHash);
		}

		const entry = this.markdownPreviewMapping.get(cellId);
		if (!entry) {
			console.error('Try to show a preview that does not exist');
			return;
		}

		if (entry.contentHash !== contentHash || !entry.visible) {
			this._sendMessageToWebview({
				type: 'showMarkdownPreview',
				id: cellId,
				handle: cellHandle,
				// If the content has not changed, we still want to make sure the
				// preview is visible but don't need to send anything over
				content: entry.contentHash === contentHash ? undefined : content,
				top: cellTop
			});
		}

		entry.contentHash = contentHash;
		entry.visible = true;
	}

	async hideMarkdownPreviews(cellIds: readonly string[]) {
		if (this._disposed) {
			return;
		}

		const cellsToHide: string[] = [];
		for (const cellId of cellIds) {
			const entry = this.markdownPreviewMapping.get(cellId);
			if (entry) {
				if (entry.visible) {
					cellsToHide.push(cellId);
					entry.visible = false;
				}
			}
		}

		if (cellsToHide.length) {
			this._sendMessageToWebview({
				type: 'hideMarkdownPreviews',
				ids: cellsToHide
			});
		}
	}

	async unhideMarkdownPreviews(cellIds: readonly string[]) {
		if (this._disposed) {
			return;
		}

		const toUnhide: string[] = [];
		for (const cellId of cellIds) {
			const entry = this.markdownPreviewMapping.get(cellId);
			if (entry) {
				if (!entry.visible) {
					entry.visible = true;
					toUnhide.push(cellId);
				}
			} else {
				console.error(`Trying to unhide a preview that does not exist: ${cellId}`);
			}
		}

		this._sendMessageToWebview({
			type: 'unhideMarkdownPreviews',
			ids: toUnhide,
		});
	}

	async deleteMarkdownPreviews(cellIds: readonly string[]) {
		if (this._disposed) {
			return;
		}

		for (const id of cellIds) {
			if (!this.markdownPreviewMapping.has(id)) {
				console.error(`Trying to delete a preview that does not exist: ${id}`);
			}
			this.markdownPreviewMapping.delete(id);
		}

		if (cellIds.length) {
			this._sendMessageToWebview({
				type: 'deleteMarkdownPreview',
				ids: cellIds
			});
		}
	}

	async updateMarkdownPreviewSelections(selectedCellsIds: string[]) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'updateSelectedMarkdownPreviews',
			selectedCellIds: selectedCellsIds.filter(id => this.markdownPreviewMapping.has(id)),
		});
	}

	async initializeMarkdown(cells: Array<{ cellId: string, cellHandle: number, content: string, offset: number }>) {
		await this._loaded;

		if (this._disposed) {
			return;
		}

		// TODO: use proper handler
		const p = new Promise<void>(resolve => {
			this.webview?.onMessage(e => {
				if (e.message.type === 'initializedMarkdownPreview') {
					resolve();
				}
			});
		});

		for (const cell of cells) {
			this.markdownPreviewMapping.set(cell.cellId, { contentHash: 0, visible: false });
		}

		this._sendMessageToWebview({
			type: 'initializeMarkdownPreview',
			cells: cells,
		});

		await p;
	}

	async createOutput(cellInfo: T, content: IInsetRenderOutput, cellTop: number, offset: number) {
		if (this._disposed) {
			return;
		}

		if (this.insetMapping.has(content.source)) {
			const outputCache = this.insetMapping.get(content.source);

			if (outputCache) {
				this.hiddenInsetMapping.delete(content.source);
				this._sendMessageToWebview({
					type: 'showOutput',
					cellId: outputCache.cellInfo.cellId,
					outputId: outputCache.outputId,
					cellTop: cellTop,
					outputOffset: offset
				});
				return;
			}
		}

		const messageBase = {
			type: 'html',
			cellId: cellInfo.cellId,
			cellTop: cellTop,
			outputOffset: offset,
			left: 0,
			requiredPreloads: [],
		} as const;

		let message: ICreationRequestMessage;
		let renderer: INotebookRendererInfo | undefined;
		if (content.type === RenderOutputType.Extension) {
			const output = content.source.model;
			renderer = content.renderer;
			const outputDto = output.outputs.find(op => op.mime === content.mimeType);
			message = {
				...messageBase,
				outputId: output.outputId,
				rendererId: content.renderer.id,
				requiredPreloads: await this.updateRendererPreloads([content.renderer]),
				content: {
					type: RenderOutputType.Extension,
					outputId: output.outputId,
					mimeType: content.mimeType,
					value: outputDto?.value,
					metadata: outputDto?.metadata,
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

	removeInsets(outputs: readonly ICellOutputViewModel[]) {
		if (this._disposed) {
			return;
		}

		for (const output of outputs) {
			const outputCache = this.insetMapping.get(output);
			if (!outputCache) {
				continue;
			}

			const id = outputCache.outputId;

			this._sendMessageToWebview({
				type: 'clearOutput',
				rendererId: outputCache.cachedCreation.rendererId,
				cellUri: outputCache.cellInfo.cellUri.toString(),
				outputId: id,
				cellId: outputCache.cellInfo.cellId
			});
			this.insetMapping.delete(output);
			this.reversedInsetMapping.delete(id);
		}
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
				resources.push({ uri: uri.toString(), originalUri: preload.toString(), source: 'kernel' });
				this._preloadsCache.add(uri.toString());
			}
		}

		if (!resources.length) {
			return;
		}

		this.kernelRootsCache = [...extensionLocations, ...this.kernelRootsCache];
		this._updatePreloads(resources);
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
				const resource: IPreloadResource = {
					uri: uri.toString(),
					originalUri: preload.toString(),
					source: { rendererId: rendererInfo.id },
				};

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
		this._updatePreloads(resources);
		return requiredPreloads;
	}

	private _updatePreloads(resources: IPreloadResource[]) {
		if (!this.webview) {
			return;
		}

		const mixedResourceRoots = [...(this.localResourceRootsCache || []), ...this.rendererRootsCache, ...this.kernelRootsCache];

		this.webview.localResourcesRoot = mixedResourceRoots;

		this._sendMessageToWebview({
			type: 'preload',
			resources: resources,
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

	override dispose() {
		this._disposed = true;
		this.webview?.dispose();
		super.dispose();
	}
}
