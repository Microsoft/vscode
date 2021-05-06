/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { OpenDocumentLinkCommand, resolveLinkToMarkdownFile } from '../commands/openDocumentLink';
import { Logger } from '../logger';
import { MarkdownContributionProvider } from '../markdownExtensions';
import { Disposable } from '../util/dispose';
import { isMarkdownFile } from '../util/file';
import { normalizeResource, WebviewResourceProvider } from '../util/resources';
import { getVisibleLine, TopmostLineMonitor } from '../util/topmostLineMonitor';
import { MarkdownPreviewConfigurationManager } from './previewConfig';
import { MarkdownContentProvider, MarkdownContentProviderOutput } from './previewContentProvider';
import { MarkdownEngine } from '../markdownEngine';
import { urlToUri } from '../util/url';

const localize = nls.loadMessageBundle();

interface WebviewMessage {
	readonly source: string;
}

interface CacheImageSizesMessage extends WebviewMessage {
	readonly type: 'cacheImageSizes';
	readonly body: { id: string, width: number, height: number; }[];
}

interface RevealLineMessage extends WebviewMessage {
	readonly type: 'revealLine';
	readonly body: {
		readonly line: number;
	};
}

interface DidClickMessage extends WebviewMessage {
	readonly type: 'didClick';
	readonly body: {
		readonly line: number;
	};
}

interface ClickLinkMessage extends WebviewMessage {
	readonly type: 'openLink';
	readonly body: {
		readonly href: string;
	};
}

interface ShowPreviewSecuritySelectorMessage extends WebviewMessage {
	readonly type: 'showPreviewSecuritySelector';
}

interface PreviewStyleLoadErrorMessage extends WebviewMessage {
	readonly type: 'previewStyleLoadError';
	readonly body: {
		readonly unloadedStyles: string[];
	};
}

export class PreviewDocumentVersion {

	private readonly resource: vscode.Uri;
	private readonly version: number;

	public constructor(document: vscode.TextDocument) {
		this.resource = document.uri;
		this.version = document.version;
	}

	public equals(other: PreviewDocumentVersion): boolean {
		return this.resource.fsPath === other.resource.fsPath
			&& this.version === other.version;
	}
}

interface MarkdownPreviewDelegate {
	getTitle?(resource: vscode.Uri): string;
	getAdditionalState(): {},
	openPreviewLinkToMarkdownFile(markdownLink: vscode.Uri, fragment: string): void;
}

class StartingScrollLine {
	public readonly type = 'line';

	constructor(
		public readonly line: number,
	) { }
}

export class StartingScrollFragment {
	public readonly type = 'fragment';

	constructor(
		public readonly fragment: string,
	) { }
}

type StartingScrollLocation = StartingScrollLine | StartingScrollFragment;

class MarkdownPreview extends Disposable implements WebviewResourceProvider {

	private readonly delay = 300;

	private readonly _resource: vscode.Uri;
	private readonly _webviewPanel: vscode.WebviewPanel;

	private throttleTimer: any;

	private line: number | undefined;
	private scrollToFragment: string | undefined;

	private firstUpdate = true;
	private currentVersion?: PreviewDocumentVersion;
	private isScrolling = false;
	private _disposed: boolean = false;
	private imageInfo: { readonly id: string, readonly width: number, readonly height: number; }[] = [];

	private readonly _fileWatchersBySrc = new Map</* src: */ string, vscode.FileSystemWatcher>();

	constructor(
		webview: vscode.WebviewPanel,
		resource: vscode.Uri,
		startingScroll: StartingScrollLocation | undefined,
		private readonly delegate: MarkdownPreviewDelegate,
		private readonly engine: MarkdownEngine,
		private readonly _contentProvider: MarkdownContentProvider,
		private readonly _previewConfigurations: MarkdownPreviewConfigurationManager,
		private readonly _logger: Logger,
		private readonly _contributionProvider: MarkdownContributionProvider,
	) {
		super();

		this._webviewPanel = webview;
		this._resource = resource;

		switch (startingScroll?.type) {
			case 'line':
				if (!isNaN(startingScroll.line!)) {
					this.line = startingScroll.line;
				}
				break;

			case 'fragment':
				this.scrollToFragment = startingScroll.fragment;
				break;
		}

		this._register(_contributionProvider.onContributionsChanged(() => {
			setImmediate(() => this.refresh());
		}));

		this._register(vscode.workspace.onDidChangeTextDocument(event => {
			if (this.isPreviewOf(event.document.uri)) {
				this.refresh();
			}
		}));

		const watcher = this._register(vscode.workspace.createFileSystemWatcher(resource.fsPath));
		this._register(watcher.onDidChange(uri => {
			if (this.isPreviewOf(uri)) {
				// Only use the file system event when VS Code does not already know about the file
				if (!vscode.workspace.textDocuments.some(doc => doc.uri.toString() !== uri.toString())) {
					this.refresh();
				}
			}
		}));

		this._register(this._webviewPanel.webview.onDidReceiveMessage((e: CacheImageSizesMessage | RevealLineMessage | DidClickMessage | ClickLinkMessage | ShowPreviewSecuritySelectorMessage | PreviewStyleLoadErrorMessage) => {
			if (e.source !== this._resource.toString()) {
				return;
			}

			switch (e.type) {
				case 'cacheImageSizes':
					this.imageInfo = e.body;
					break;

				case 'revealLine':
					this.onDidScrollPreview(e.body.line);
					break;

				case 'didClick':
					this.onDidClickPreview(e.body.line);
					break;

				case 'openLink':
					this.onDidClickPreviewLink(e.body.href);
					break;

				case 'showPreviewSecuritySelector':
					vscode.commands.executeCommand('markdown.showPreviewSecuritySelector', e.source);
					break;

				case 'previewStyleLoadError':
					vscode.window.showWarningMessage(
						localize('onPreviewStyleLoadError',
							"Could not load 'markdown.styles': {0}",
							e.body.unloadedStyles.join(', ')));
					break;
			}
		}));

		this.updatePreview();
	}

	override dispose() {
		super.dispose();
		this._disposed = true;
		clearTimeout(this.throttleTimer);
		for (const entry of this._fileWatchersBySrc.values()) {
			entry.dispose();
		}
	}

	public get resource(): vscode.Uri {
		return this._resource;
	}

	public get state() {
		return {
			resource: this._resource.toString(),
			line: this.line,
			imageInfo: this.imageInfo,
			fragment: this.scrollToFragment,
			...this.delegate.getAdditionalState(),
		};
	}

	/**
	 * The first call immediately refreshes the preview,
	 * calls happening shortly thereafter are debounced.
	*/
	public refresh() {
		// Schedule update if none is pending
		if (!this.throttleTimer) {
			if (this.firstUpdate) {
				this.updatePreview(true);
			} else {
				this.throttleTimer = setTimeout(() => this.updatePreview(true), this.delay);
			}
		}

		this.firstUpdate = false;
	}

	private get iconPath() {
		const root = vscode.Uri.joinPath(this._contributionProvider.extensionUri, 'media');
		return {
			light: vscode.Uri.joinPath(root, 'preview-light.svg'),
			dark: vscode.Uri.joinPath(root, 'preview-dark.svg'),
		};
	}

	public isPreviewOf(resource: vscode.Uri): boolean {
		return this._resource.fsPath === resource.fsPath;
	}

	public postMessage(msg: any) {
		if (!this._disposed) {
			this._webviewPanel.webview.postMessage(msg);
		}
	}

	public scrollTo(topLine: number) {
		if (this._disposed) {
			return;
		}

		if (this.isScrolling) {
			this.isScrolling = false;
			return;
		}

		this._logger.log('updateForView', { markdownFile: this._resource });
		this.line = topLine;
		this.postMessage({
			type: 'updateView',
			line: topLine,
			source: this._resource.toString()
		});
	}

	private async updatePreview(forceUpdate?: boolean): Promise<void> {
		clearTimeout(this.throttleTimer);
		this.throttleTimer = undefined;

		if (this._disposed) {
			return;
		}

		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(this._resource);
		} catch {
			await this.showFileNotFoundError();
			return;
		}

		if (this._disposed) {
			return;
		}

		const pendingVersion = new PreviewDocumentVersion(document);
		if (!forceUpdate && this.currentVersion?.equals(pendingVersion)) {
			if (this.line) {
				this.scrollTo(this.line);
			}
			return;
		}

		this.currentVersion = pendingVersion;
		const content = await this._contentProvider.provideTextDocumentContent(document, this, this._previewConfigurations, this.line, this.state);

		// Another call to `doUpdate` may have happened.
		// Make sure we are still updating for the correct document
		if (this.currentVersion?.equals(pendingVersion)) {
			this.setContent(content);
		}
	}

	private onDidScrollPreview(line: number) {
		this.line = line;

		const config = this._previewConfigurations.loadAndCacheConfiguration(this._resource);
		if (!config.scrollEditorWithPreview) {
			return;
		}

		for (const editor of vscode.window.visibleTextEditors) {
			if (!this.isPreviewOf(editor.document.uri)) {
				continue;
			}

			this.isScrolling = true;
			const sourceLine = Math.floor(line);
			const fraction = line - sourceLine;
			const text = editor.document.lineAt(sourceLine).text;
			const start = Math.floor(fraction * text.length);
			editor.revealRange(
				new vscode.Range(sourceLine, start, sourceLine + 1, 0),
				vscode.TextEditorRevealType.AtTop);
		}
	}

	private async onDidClickPreview(line: number): Promise<void> {
		// fix #82457, find currently opened but unfocused source tab
		await vscode.commands.executeCommand('markdown.showSource');

		for (const visibleEditor of vscode.window.visibleTextEditors) {
			if (this.isPreviewOf(visibleEditor.document.uri)) {
				const editor = await vscode.window.showTextDocument(visibleEditor.document, visibleEditor.viewColumn);
				const position = new vscode.Position(line, 0);
				editor.selection = new vscode.Selection(position, position);
				return;
			}
		}

		vscode.workspace.openTextDocument(this._resource)
			.then(vscode.window.showTextDocument)
			.then(undefined, () => {
				vscode.window.showErrorMessage(localize('preview.clickOpenFailed', 'Could not open {0}', this._resource.toString()));
			});
	}

	private async showFileNotFoundError() {
		this._webviewPanel.webview.html = this._contentProvider.provideFileNotFoundContent(this._resource);
	}

	private setContent(content: MarkdownContentProviderOutput): void {
		if (this._disposed) {
			return;
		}

		if (this.delegate.getTitle) {
			this._webviewPanel.title = this.delegate.getTitle(this._resource);
		}
		this._webviewPanel.iconPath = this.iconPath;
		this._webviewPanel.webview.options = this.getWebviewOptions();

		this._webviewPanel.webview.html = content.html;

		const srcs = new Set(content.containingImages.map(img => img.src));

		// Delete stale file watchers.
		for (const [src, watcher] of [...this._fileWatchersBySrc]) {
			if (!srcs.has(src)) {
				watcher.dispose();
				this._fileWatchersBySrc.delete(src);
			}
		}

		// Create new file watchers.
		const root = vscode.Uri.joinPath(this._resource, '../');
		for (const src of srcs) {
			const uri = urlToUri(src, root);
			if (uri && uri.scheme === 'file' && !this._fileWatchersBySrc.has(src)) {
				const watcher = vscode.workspace.createFileSystemWatcher(uri.fsPath);
				watcher.onDidChange(() => {
					this.refresh();
				});
				this._fileWatchersBySrc.set(src, watcher);
			}
		}
	}

	private getWebviewOptions(): vscode.WebviewOptions {
		return {
			enableScripts: true,
			localResourceRoots: this.getLocalResourceRoots()
		};
	}

	private getLocalResourceRoots(): ReadonlyArray<vscode.Uri> {
		const baseRoots = Array.from(this._contributionProvider.contributions.previewResourceRoots);

		const folder = vscode.workspace.getWorkspaceFolder(this._resource);
		if (folder) {
			const workspaceRoots = vscode.workspace.workspaceFolders?.map(folder => folder.uri);
			if (workspaceRoots) {
				baseRoots.push(...workspaceRoots);
			}
		} else if (!this._resource.scheme || this._resource.scheme === 'file') {
			baseRoots.push(vscode.Uri.file(path.dirname(this._resource.fsPath)));
		}

		return baseRoots.map(root => normalizeResource(this._resource, root));
	}


	private async onDidClickPreviewLink(href: string) {
		let [hrefPath, fragment] = decodeURIComponent(href).split('#');

		if (hrefPath[0] !== '/') {
			// We perviously already resolve absolute paths.
			// Now make sure we handle relative file paths
			const dirnameUri = vscode.Uri.parse(path.dirname(this.resource.path));
			hrefPath = vscode.Uri.joinPath(dirnameUri, hrefPath).path;
		} else {
			// Handle any normalized file paths
			hrefPath = vscode.Uri.parse(hrefPath.replace('/file', '')).path;
		}

		const config = vscode.workspace.getConfiguration('markdown', this.resource);
		const openLinks = config.get<string>('preview.openMarkdownLinks', 'inPreview');
		if (openLinks === 'inPreview') {
			const markdownLink = await resolveLinkToMarkdownFile(hrefPath);
			if (markdownLink) {
				this.delegate.openPreviewLinkToMarkdownFile(markdownLink, fragment);
				return;
			}
		}

		OpenDocumentLinkCommand.execute(this.engine, { parts: { path: hrefPath }, fragment, fromResource: this.resource.toJSON() });
	}

	//#region WebviewResourceProvider

	asWebviewUri(resource: vscode.Uri) {
		return this._webviewPanel.webview.asWebviewUri(normalizeResource(this._resource, resource));
	}

	get cspSource() {
		return this._webviewPanel.webview.cspSource;
	}

	//#endregion
}

export interface ManagedMarkdownPreview {

	readonly resource: vscode.Uri;
	readonly resourceColumn: vscode.ViewColumn;

	readonly onDispose: vscode.Event<void>;
	readonly onDidChangeViewState: vscode.Event<vscode.WebviewPanelOnDidChangeViewStateEvent>;

	dispose(): void;

	refresh(): void;
	updateConfiguration(): void;

	matchesResource(
		otherResource: vscode.Uri,
		otherPosition: vscode.ViewColumn | undefined,
		otherLocked: boolean
	): boolean;
}

export class StaticMarkdownPreview extends Disposable implements ManagedMarkdownPreview {

	public static revive(
		resource: vscode.Uri,
		webview: vscode.WebviewPanel,
		contentProvider: MarkdownContentProvider,
		previewConfigurations: MarkdownPreviewConfigurationManager,
		logger: Logger,
		contributionProvider: MarkdownContributionProvider,
		engine: MarkdownEngine,
	): StaticMarkdownPreview {
		return new StaticMarkdownPreview(webview, resource, contentProvider, previewConfigurations, logger, contributionProvider, engine);
	}

	private readonly preview: MarkdownPreview;

	private constructor(
		private readonly _webviewPanel: vscode.WebviewPanel,
		resource: vscode.Uri,
		contentProvider: MarkdownContentProvider,
		private readonly _previewConfigurations: MarkdownPreviewConfigurationManager,
		logger: Logger,
		contributionProvider: MarkdownContributionProvider,
		engine: MarkdownEngine,
	) {
		super();

		this.preview = this._register(new MarkdownPreview(this._webviewPanel, resource, undefined, {
			getAdditionalState: () => { return {}; },
			openPreviewLinkToMarkdownFile: () => { /* todo */ }
		}, engine, contentProvider, _previewConfigurations, logger, contributionProvider));

		this._register(this._webviewPanel.onDidDispose(() => {
			this.dispose();
		}));

		this._register(this._webviewPanel.onDidChangeViewState(e => {
			this._onDidChangeViewState.fire(e);
		}));
	}

	private readonly _onDispose = this._register(new vscode.EventEmitter<void>());
	public readonly onDispose = this._onDispose.event;

	private readonly _onDidChangeViewState = this._register(new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>());
	public readonly onDidChangeViewState = this._onDidChangeViewState.event;

	override dispose() {
		this._onDispose.fire();
		super.dispose();
	}

	public matchesResource(
		_otherResource: vscode.Uri,
		_otherPosition: vscode.ViewColumn | undefined,
		_otherLocked: boolean
	): boolean {
		return false;
	}

	public refresh() {
		this.preview.refresh();
	}

	public updateConfiguration() {
		if (this._previewConfigurations.hasConfigurationChanged(this.preview.resource)) {
			this.refresh();
		}
	}

	public get resource() {
		return this.preview.resource;
	}

	public get resourceColumn() {
		return this._webviewPanel.viewColumn || vscode.ViewColumn.One;
	}
}

interface DynamicPreviewInput {
	readonly resource: vscode.Uri;
	readonly resourceColumn: vscode.ViewColumn;
	readonly locked: boolean;
	readonly line?: number;
}

/**
 * A
 */
export class DynamicMarkdownPreview extends Disposable implements ManagedMarkdownPreview {

	public static readonly viewType = 'markdown.preview';

	private readonly _resourceColumn: vscode.ViewColumn;
	private _locked: boolean;

	private readonly _webviewPanel: vscode.WebviewPanel;
	private _preview: MarkdownPreview;

	public static revive(
		input: DynamicPreviewInput,
		webview: vscode.WebviewPanel,
		contentProvider: MarkdownContentProvider,
		previewConfigurations: MarkdownPreviewConfigurationManager,
		logger: Logger,
		topmostLineMonitor: TopmostLineMonitor,
		contributionProvider: MarkdownContributionProvider,
		engine: MarkdownEngine,
	): DynamicMarkdownPreview {
		return new DynamicMarkdownPreview(webview, input,
			contentProvider, previewConfigurations, logger, topmostLineMonitor, contributionProvider, engine);
	}

	public static create(
		input: DynamicPreviewInput,
		previewColumn: vscode.ViewColumn,
		contentProvider: MarkdownContentProvider,
		previewConfigurations: MarkdownPreviewConfigurationManager,
		logger: Logger,
		topmostLineMonitor: TopmostLineMonitor,
		contributionProvider: MarkdownContributionProvider,
		engine: MarkdownEngine,
	): DynamicMarkdownPreview {
		const webview = vscode.window.createWebviewPanel(
			DynamicMarkdownPreview.viewType,
			DynamicMarkdownPreview.getPreviewTitle(input.resource, input.locked),
			previewColumn, { enableFindWidget: true, });

		return new DynamicMarkdownPreview(webview, input,
			contentProvider, previewConfigurations, logger, topmostLineMonitor, contributionProvider, engine);
	}

	private constructor(
		webview: vscode.WebviewPanel,
		input: DynamicPreviewInput,
		private readonly _contentProvider: MarkdownContentProvider,
		private readonly _previewConfigurations: MarkdownPreviewConfigurationManager,
		private readonly _logger: Logger,
		private readonly _topmostLineMonitor: TopmostLineMonitor,
		private readonly _contributionProvider: MarkdownContributionProvider,
		private readonly _engine: MarkdownEngine,
	) {
		super();

		this._webviewPanel = webview;

		this._resourceColumn = input.resourceColumn;
		this._locked = input.locked;

		this._preview = this.createPreview(input.resource, typeof input.line === 'number' ? new StartingScrollLine(input.line) : undefined);

		this._register(webview.onDidDispose(() => { this.dispose(); }));

		this._register(this._webviewPanel.onDidChangeViewState(e => {
			this._onDidChangeViewStateEmitter.fire(e);
		}));

		this._register(this._topmostLineMonitor.onDidChanged(event => {
			if (this._preview.isPreviewOf(event.resource)) {
				this._preview.scrollTo(event.line);
			}
		}));

		this._register(vscode.window.onDidChangeTextEditorSelection(event => {
			if (this._preview.isPreviewOf(event.textEditor.document.uri)) {
				this._preview.postMessage({
					type: 'onDidChangeTextEditorSelection',
					line: event.selections[0].active.line,
					source: this._preview.resource.toString()
				});
			}
		}));

		this._register(vscode.window.onDidChangeActiveTextEditor(editor => {
			// Only allow previewing normal text editors which have a viewColumn: See #101514
			if (typeof editor?.viewColumn === 'undefined') {
				return;
			}

			if (isMarkdownFile(editor.document) && !this._locked && !this._preview.isPreviewOf(editor.document.uri)) {
				const line = getVisibleLine(editor);
				this.update(editor.document.uri, line ? new StartingScrollLine(line) : undefined);
			}
		}));
	}

	private readonly _onDisposeEmitter = this._register(new vscode.EventEmitter<void>());
	public readonly onDispose = this._onDisposeEmitter.event;

	private readonly _onDidChangeViewStateEmitter = this._register(new vscode.EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>());
	public readonly onDidChangeViewState = this._onDidChangeViewStateEmitter.event;

	override dispose() {
		this._preview.dispose();
		this._webviewPanel.dispose();

		this._onDisposeEmitter.fire();
		this._onDisposeEmitter.dispose();
		super.dispose();
	}

	public get resource() {
		return this._preview.resource;
	}

	public get resourceColumn() {
		return this._resourceColumn;
	}

	public reveal(viewColumn: vscode.ViewColumn) {
		this._webviewPanel.reveal(viewColumn);
	}

	public refresh() {
		this._preview.refresh();
	}

	public updateConfiguration() {
		if (this._previewConfigurations.hasConfigurationChanged(this._preview.resource)) {
			this.refresh();
		}
	}

	public update(newResource: vscode.Uri, scrollLocation?: StartingScrollLocation) {
		if (this._preview.isPreviewOf(newResource)) {
			switch (scrollLocation?.type) {
				case 'line':
					this._preview.scrollTo(scrollLocation.line);
					return;

				case 'fragment':
					// Workaround. For fragments, just reload the entire preview
					break;

				default:
					return;
			}
		}

		this._preview.dispose();
		this._preview = this.createPreview(newResource, scrollLocation);
	}

	public toggleLock() {
		this._locked = !this._locked;
		this._webviewPanel.title = DynamicMarkdownPreview.getPreviewTitle(this._preview.resource, this._locked);
	}

	private static getPreviewTitle(resource: vscode.Uri, locked: boolean): string {
		return locked
			? localize('lockedPreviewTitle', '[Preview] {0}', path.basename(resource.fsPath))
			: localize('previewTitle', 'Preview {0}', path.basename(resource.fsPath));
	}

	public get position(): vscode.ViewColumn | undefined {
		return this._webviewPanel.viewColumn;
	}

	public matchesResource(
		otherResource: vscode.Uri,
		otherPosition: vscode.ViewColumn | undefined,
		otherLocked: boolean
	): boolean {
		if (this.position !== otherPosition) {
			return false;
		}

		if (this._locked) {
			return otherLocked && this._preview.isPreviewOf(otherResource);
		} else {
			return !otherLocked;
		}
	}

	public matches(otherPreview: DynamicMarkdownPreview): boolean {
		return this.matchesResource(otherPreview._preview.resource, otherPreview.position, otherPreview._locked);
	}

	private createPreview(resource: vscode.Uri, startingScroll?: StartingScrollLocation): MarkdownPreview {
		return new MarkdownPreview(this._webviewPanel, resource, startingScroll, {
			getTitle: (resource) => DynamicMarkdownPreview.getPreviewTitle(resource, this._locked),
			getAdditionalState: () => {
				return {
					resourceColumn: this.resourceColumn,
					locked: this._locked,
				};
			},
			openPreviewLinkToMarkdownFile: (link: vscode.Uri, fragment?: string) => {
				this.update(link, fragment ? new StartingScrollFragment(fragment) : undefined);
			}
		},
			this._engine,
			this._contentProvider,
			this._previewConfigurations,
			this._logger,
			this._contributionProvider);
	}
}

