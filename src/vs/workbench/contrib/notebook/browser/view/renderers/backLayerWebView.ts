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
import { asWebviewUri } from 'vs/workbench/api/common/shared/webview';
import { CellEditState, ICellOutputViewModel, ICommonCellInfo, ICommonNotebookEditor, IDisplayOutputLayoutUpdateRequest, IDisplayOutputViewModel, IGenericCellViewModel, IInsetRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { preloadsScriptStr, RendererMetadata } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewPreloads';
import { transformWebviewThemeVars } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewThemeMapping';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { INotebookKernel, INotebookRendererInfo, RendererMessagingSpec } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IScopedRendererMessaging } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IWebviewService, WebviewContentPurpose, WebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ICreationRequestMessage, IMarkupCellInitialization, FromWebviewMessage, IClickedDataUrlMessage, IContentWidgetTopRequest, IControllerPreload, ToWebviewMessage } from './webviewMessages';

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
	readonly markdownPreviewMapping = new Map<string, IMarkupCellInitialization>();
	hiddenInsetMapping: Set<IDisplayOutputViewModel> = new Set();
	reversedInsetMapping: Map<string, IDisplayOutputViewModel> = new Map();
	localResourceRootsCache: URI[] | undefined = undefined;
	rendererRootsCache: URI[] = [];
	private readonly _onMessage = this._register(new Emitter<INotebookWebviewMessage>());
	private readonly _preloadsCache = new Set<string>();
	public readonly onMessage: Event<INotebookWebviewMessage> = this._onMessage.event;
	private _initalized?: Promise<void>;
	private _disposed = false;
	private _currentKernel?: INotebookKernel;

	constructor(
		public readonly notebookEditor: ICommonNotebookEditor,
		public readonly id: string,
		public readonly documentUri: URI,
		private options: {
			outputNodePadding: number,
			outputNodeLeftPadding: number,
			previewNodePadding: number,
			markdownLeftMargin: number,
			leftMargin: number,
			rightMargin: number,
			runGutter: number,
			dragAndDropEnabled: boolean,
			fontSize: number
		},
		private readonly rendererMessaging: IScopedRendererMessaging | undefined,
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

		if (rendererMessaging) {
			this._register(rendererMessaging.onDidReceiveMessage(evt => {
				this._sendMessageToWebview({
					__vscode_notebook_message: true,
					type: 'customRendererMessage',
					rendererId: evt.rendererId,
					message: evt.message
				});
			}));
		}
	}

	updateOptions(options: {
		outputNodePadding: number,
		outputNodeLeftPadding: number,
		previewNodePadding: number,
		markdownLeftMargin: number,
		leftMargin: number,
		rightMargin: number,
		runGutter: number,
		dragAndDropEnabled: boolean,
		fontSize: number
	}) {
		this.options = options;
		this._updateStyles();
		this._updateOptions();
	}

	private _updateStyles() {
		this._sendMessageToWebview({
			type: 'notebookStyles',
			styles: this._generateStyles()
		});
	}

	private _updateOptions() {
		this._sendMessageToWebview({
			type: 'notebookOptions',
			options: {
				dragAndDropEnabled: this.options.dragAndDropEnabled
			}
		});
	}

	private _generateStyles() {
		return {
			'notebook-output-left-margin': `${this.options.leftMargin + this.options.runGutter}px`,
			'notebook-output-width': `calc(100% - ${this.options.leftMargin + this.options.rightMargin + this.options.runGutter}px)`,
			'notebook-output-node-padding': `${this.options.outputNodePadding}px`,
			'notebook-run-gutter': `${this.options.runGutter}px`,
			'notebook-preivew-node-padding': `${this.options.previewNodePadding}px`,
			'notebook-markdown-left-margin': `${this.options.markdownLeftMargin}px`,
			'notebook-output-node-left-padding': `${this.options.outputNodeLeftPadding}px`,
			'notebook-markdown-min-height': `${this.options.previewNodePadding * 2}px`,
			'notebook-cell-output-font-size': `${this.options.fontSize}px`,
			'notebook-cell-markup-empty-content': nls.localize('notebook.emptyMarkdownPlaceholder', "Empty markdown cell, double click or press enter to edit."),
		};
	}

	private generateContent(coreDependencies: string, baseUrl: string) {
		const renderersData = this.getRendererData();
		return html`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<base href="${baseUrl}/"/>
				<style>
					#container .cell_container {
						width: 100%;
					}

					#container .output_container {
						width: 100%;
					}

					#container > div > div > div.output {
						font-size: var(--notebook-cell-output-font-size);
						width: var(--notebook-output-width);
						margin-left: var(--notebook-output-left-margin);
						padding-top: var(--notebook-output-node-padding);
						padding-right: var(--notebook-output-node-padding);
						padding-bottom: var(--notebook-output-node-padding);
						padding-left: var(--notebook-output-node-left-padding);
						box-sizing: border-box;
						background-color: var(--theme-notebook-output-background);
					}

					/* markdown */
					#container > div.preview {
						width: 100%;
						padding-right: var(--notebook-preivew-node-padding);
						padding-left: var(--notebook-markdown-left-margin);
						padding-top: var(--notebook-preivew-node-padding);
						padding-bottom: var(--notebook-preivew-node-padding);

						box-sizing: border-box;
						white-space: nowrap;
						overflow: hidden;
						white-space: initial;
						color: var(--theme-ui-foreground);
					}

					#container > div.preview.draggable {
						user-select: none;
						-webkit-user-select: none;
						-ms-user-select: none;
						cursor: grab;
					}

					#container > div.preview.selected {
						background: var(--theme-notebook-cell-selected-background);
					}

					#container > div.preview.dragging {
						background-color: var(--theme-background);
					}

					.monaco-workbench.vs-dark .notebookOverlay .cell.markdown .latex img,
					.monaco-workbench.vs-dark .notebookOverlay .cell.markdown .latex-block img {
						filter: brightness(0) invert(1)
					}

					#container > div.nb-symbolHighlight {
						background-color: var(--theme-notebook-symbol-highlight-background);
					}

					#container > div.nb-cellDeleted {
						background-color: var(--theme-notebook-diff-removed-background);
					}

					#container > div.nb-cellAdded {
						background-color: var(--theme-notebook-diff-inserted-background);
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
				<script type="module">${preloadsScriptStr(this.options, { dragAndDropEnabled: this.options.dragAndDropEnabled }, renderersData)}</script>
			</body>
		</html>`;
	}

	private getRendererData(): RendererMetadata[] {
		return this.notebookService.getRenderers().map((renderer): RendererMetadata => {
			const entrypoint = this.asWebviewUri(renderer.entrypoint, renderer.extensionLocation).toString();
			return {
				id: renderer.id,
				entrypoint,
				mimeTypes: renderer.mimeTypes,
				extends: renderer.extends,
				messaging: renderer.messaging !== RendererMessagingSpec.Never,
			};
		});
	}

	private asWebviewUri(uri: URI, fromExtension: URI | undefined) {
		return asWebviewUri(uri, fromExtension?.scheme === Schemas.vscodeRemote ? { isRemote: true, authority: fromExtension.authority } : undefined);
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
		const baseUrl = this.asWebviewUri(dirname(this.documentUri), undefined);

		// Python hasn't moved to use a preload to load require support yet.
		// For all other notebooks, we no longer want to include our loader.
		if (!this.documentUri.path.toLowerCase().endsWith('.ipynb')) {
			const htmlContent = this.generateContent('', baseUrl.toString());
			this._initialize(htmlContent);
			return;
		}

		let coreDependencies = '';
		let resolveFunc: () => void;

		this._initalized = new Promise<void>((resolve, reject) => {
			resolveFunc = resolve;
		});


		if (!isWeb) {
			const loaderUri = FileAccess.asFileUri('vs/loader.js', require);
			const loader = this.asWebviewUri(loaderUri, undefined);

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

	private _initialize(content: string) {
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

			if (matchesScheme(link, Schemas.command)) {
				console.warn('Command links are deprecated and will be removed, use messag passing instead: https://github.com/microsoft/vscode/issues/123601');
			}

			if (matchesScheme(link, Schemas.http) || matchesScheme(link, Schemas.https) || matchesScheme(link, Schemas.mailto)
				|| matchesScheme(link, Schemas.command)) {
				this.openerService.open(link, { fromUserGesture: true, allowContributedOpeners: true, allowCommands: true });
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
				case 'initialized':
					this.initializeWebViewState();
					break;
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
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							if (data.focusNext) {
								this.notebookEditor.focusNextNotebookCell(cell, 'editor');
							} else {
								this.notebookEditor.focusNotebookCell(cell, 'editor');
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
				case 'customRendererMessage':
					{
						this.rendererMessaging?.postMessage(data.rendererId, data.message);
						break;
					}
				case 'clickMarkupCell':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							if (data.shiftKey || (isMacintosh ? data.metaKey : data.ctrlKey)) {
								// Modify selection
								this.notebookEditor.toggleNotebookCellSelection(cell, /* fromPrevious */ data.shiftKey);
							} else {
								// Normal click
								this.notebookEditor.focusNotebookCell(cell, 'container', { skipReveal: true });
							}
						}
						break;
					}
				case 'contextMenuMarkupCell':
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
				case 'toggleMarkupPreview':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell) {
							this.notebookEditor.setMarkdownCellEditState(data.cellId, CellEditState.Editing);
							this.notebookEditor.focusNotebookCell(cell, 'editor', { skipReveal: true });
						}
						break;
					}
				case 'mouseEnterMarkupCell':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell instanceof MarkdownCellViewModel) {
							cell.cellIsHovered = true;
						}
						break;
					}
				case 'mouseLeaveMarkupCell':
					{
						const cell = this.notebookEditor.getCellById(data.cellId);
						if (cell instanceof MarkdownCellViewModel) {
							cell.cellIsHovered = false;
						}
						break;
					}
				case 'cell-drag-start':
					{
						this.notebookEditor.markdownCellDragStart(data.cellId, data);
						break;
					}
				case 'cell-drag':
					{
						this.notebookEditor.markdownCellDrag(data.cellId, data);
						break;
					}
				case 'cell-drop':
					{
						this.notebookEditor.markdownCellDrop(data.cellId, {
							dragOffsetY: data.dragOffsetY,
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
			...this.notebookService.getRenderers().map(x => dirname(x.entrypoint)),
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
			localResourceRoots: this.localResourceRootsCache,
		}, undefined);

		webview.html = content;
		return webview;
	}

	private initializeWebViewState() {
		const renderers = new Set<INotebookRendererInfo>();
		for (const inset of this.insetMapping.values()) {
			if (inset.renderer) {
				renderers.add(inset.renderer);
			}
		}

		this._preloadsCache.clear();
		if (this._currentKernel) {
			this._updatePreloadsFromKernel(this._currentKernel);
		}

		for (const [output, inset] of this.insetMapping.entries()) {
			this._sendMessageToWebview({ ...inset.cachedCreation, initiallyHidden: this.hiddenInsetMapping.has(output) });
		}

		const mdCells = [...this.markdownPreviewMapping.values()];
		this.markdownPreviewMapping.clear();
		this.initializeMarkup(mdCells);
		this._updateStyles();
		this._updateOptions();
	}

	private shouldUpdateInset(cell: IGenericCellViewModel, output: ICellOutputViewModel, cellTop: number, outputOffset: number): boolean {
		if (this._disposed) {
			return false;
		}

		if (cell.metadata.outputCollapsed) {
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
				cellId: request.cell.id,
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
			markupCells: markdownPreviews,
		});
	}

	private async createMarkdownPreview(initialization: IMarkupCellInitialization) {
		if (this._disposed) {
			return;
		}

		if (this.markdownPreviewMapping.has(initialization.cellId)) {
			console.error('Trying to create markdown preview that already exists');
			return;
		}

		this.markdownPreviewMapping.set(initialization.cellId, initialization);
		this._sendMessageToWebview({
			type: 'createMarkupCell',
			cell: initialization
		});
	}

	async showMarkdownPreview(initialization: IMarkupCellInitialization) {
		if (this._disposed) {
			return;
		}

		const entry = this.markdownPreviewMapping.get(initialization.cellId);
		if (!entry) {
			return this.createMarkdownPreview(initialization);
		}

		const sameContent = initialization.content === entry.content;
		if (!sameContent || !entry.visible) {
			this._sendMessageToWebview({
				type: 'showMarkupCell',
				id: initialization.cellId,
				handle: initialization.cellHandle,
				// If the content has not changed, we still want to make sure the
				// preview is visible but don't need to send anything over
				content: sameContent ? undefined : initialization.content,
				top: initialization.offset
			});
		}

		entry.content = initialization.content;
		entry.offset = initialization.offset;
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
				type: 'hideMarkupCells',
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
			type: 'unhideMarkupCells',
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
				type: 'deleteMarkupCell',
				ids: cellIds
			});
		}
	}

	async updateMarkdownPreviewSelections(selectedCellsIds: string[]) {
		if (this._disposed) {
			return;
		}

		this._sendMessageToWebview({
			type: 'updateSelectedMarkupCells',
			selectedCellIds: selectedCellsIds.filter(id => this.markdownPreviewMapping.has(id)),
		});
	}

	async initializeMarkup(cells: readonly IMarkupCellInitialization[]) {
		if (this._disposed) {
			return;
		}

		// TODO: use proper handler
		const p = new Promise<void>(resolve => {
			this.webview?.onMessage(e => {
				if (e.message.type === 'initializedMarkup') {
					resolve();
				}
			});
		});

		for (const cell of cells) {
			this.markdownPreviewMapping.set(cell.cellId, { ...cell, visible: false });
		}

		this._sendMessageToWebview({
			type: 'initializeMarkup',
			cells,
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

			// TODO@notebook - the message can contain "bytes" and those are transferable
			// which improves IPC performance and therefore should be used. However, it does
			// means that the bytes cannot be used here anymore
			message = {
				...messageBase,
				outputId: output.outputId,
				rendererId: content.renderer.id,
				content: {
					type: RenderOutputType.Extension,
					outputId: output.outputId,
					mimeType: content.mimeType,
					valueBytes: new Uint8Array(outputDto?.valueBytes ?? []),
					metadata: output.metadata,
					metadata2: output.metadata
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

	async updateKernelPreloads(kernel: INotebookKernel | undefined) {
		if (this._disposed || kernel === this._currentKernel) {
			return;
		}

		const previousKernel = this._currentKernel;
		this._currentKernel = kernel;

		if (previousKernel && previousKernel.preloadUris.length > 0) {
			this.webview?.reload(); // preloads will be restored after reload
		} else if (kernel) {
			this._updatePreloadsFromKernel(kernel);
		}
	}

	private _updatePreloadsFromKernel(kernel: INotebookKernel) {
		const resources: IControllerPreload[] = [];
		for (const preload of kernel.preloadUris) {
			const uri = this.environmentService.isExtensionDevelopment && (preload.scheme === 'http' || preload.scheme === 'https')
				? preload : this.asWebviewUri(preload, undefined);

			if (!this._preloadsCache.has(uri.toString())) {
				resources.push({ uri: uri.toString(), originalUri: preload.toString() });
				this._preloadsCache.add(uri.toString());
			}
		}

		if (!resources.length) {
			return;
		}

		this._updatePreloads(resources);
	}

	private _updatePreloads(resources: IControllerPreload[]) {
		if (!this.webview) {
			return;
		}

		const mixedResourceRoots = [
			...(this.localResourceRootsCache || []),
			...this.rendererRootsCache,
			...(this._currentKernel ? [this._currentKernel.localResourceRoot] : []),
		];

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
