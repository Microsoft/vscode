/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { IAction } from 'vs/base/common/actions';
import { ThrottledDelayer } from 'vs/base/common/async';
import { streamToBuffer } from 'vs/base/common/buffer';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WebviewPortMappingManager } from 'vs/platform/webview/common/webviewPortMapping';
import { loadLocalResource, WebviewResourceResponse } from 'vs/workbench/contrib/webview/browser/resourceLoading';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { areWebviewContentOptionsEqual, WebviewContentOptions, WebviewExtensionDescription, WebviewMessageReceivedEvent, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export const enum WebviewMessageChannels {
	onmessage = 'onmessage',
	didClickLink = 'did-click-link',
	didScroll = 'did-scroll',
	didFocus = 'did-focus',
	didBlur = 'did-blur',
	didLoad = 'did-load',
	doUpdateState = 'do-update-state',
	doReload = 'do-reload',
	setConfirmBeforeClose = 'set-confirm-before-close',
	loadResource = 'load-resource',
	loadLocalhost = 'load-localhost',
	webviewReady = 'webview-ready',
	wheel = 'did-scroll-wheel',
	fatalError = 'fatal-error',
}

interface IKeydownEvent {
	key: string;
	keyCode: number;
	code: string;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	repeat: boolean;
}

interface WebviewContent {
	readonly html: string;
	readonly options: WebviewContentOptions;
	readonly state: string | undefined;
}

namespace WebviewState {
	export const enum Type { Initializing, Ready }

	export class Initializing {
		readonly type = Type.Initializing;

		constructor(
			public readonly pendingMessages: Array<{ readonly channel: string, readonly data?: any }>
		) { }
	}

	export const Ready = { type: Type.Ready } as const;

	export type State = typeof Ready | Initializing;
}

export abstract class BaseWebview<T extends HTMLElement> extends Disposable {

	private _element: T | undefined;
	protected get element(): T | undefined { return this._element; }

	private _focused: boolean | undefined;
	public get isFocused(): boolean { return !!this._focused; }

	private _state: WebviewState.State = new WebviewState.Initializing([]);

	protected content: WebviewContent;

	private readonly _portMappingManager: WebviewPortMappingManager;

	private readonly _resourceLoadingCts = this._register(new CancellationTokenSource());

	private readonly _fileService: IFileService;
	private readonly _logService: ILogService;
	private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService;
	private readonly _requestService: IRequestService;
	private readonly _telemetryService: ITelemetryService;
	private readonly _tunnelService: ITunnelService;
	protected readonly _environmentService: IWorkbenchEnvironmentService;
	private _contextKeyService: IContextKeyService | undefined;

	private readonly _focusDelayer = this._register(new ThrottledDelayer(10));

	constructor(
		public readonly id: string,
		private readonly options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		public extension: WebviewExtensionDescription | undefined,
		private readonly webviewThemeDataProvider: WebviewThemeDataProvider,
		services: {
			contextMenuService: IContextMenuService,
			environmentService: IWorkbenchEnvironmentService,
			fileService: IFileService,
			logService: ILogService,
			menuService: IMenuService,
			notificationService: INotificationService,
			remoteAuthorityResolverService: IRemoteAuthorityResolverService,
			requestService: IRequestService,
			telemetryService: ITelemetryService,
			tunnelService: ITunnelService,
		}
	) {
		super();

		this._environmentService = services.environmentService;
		this._fileService = services.fileService;
		this._logService = services.logService;
		this._remoteAuthorityResolverService = services.remoteAuthorityResolverService;
		this._requestService = services.requestService;
		this._telemetryService = services.telemetryService;
		this._tunnelService = services.tunnelService;

		this.content = {
			html: '',
			options: contentOptions,
			state: undefined
		};

		this._portMappingManager = this._register(new WebviewPortMappingManager(
			() => this.extension?.location,
			() => this.content.options.portMapping || [],
			this._tunnelService
		));

		this._element = this.createElement(options, contentOptions);

		const subscription = this._register(this.on(WebviewMessageChannels.webviewReady, () => {
			this._logService.debug(`Webview(${this.id}): webview ready`);

			this.element?.classList.add('ready');

			if (this._state.type === WebviewState.Type.Initializing) {
				this._state.pendingMessages.forEach(({ channel, data }) => this.doPostMessage(channel, data));
			}
			this._state = WebviewState.Ready;

			subscription.dispose();
		}));

		this._register(this.on('no-csp-found', () => {
			this.handleNoCspFound();
		}));

		this._register(this.on(WebviewMessageChannels.didClickLink, (uri: string) => {
			this._onDidClickLink.fire(uri);
		}));

		this._register(this.on(WebviewMessageChannels.onmessage, (data: { message: any, transfer?: ArrayBuffer[] }) => {
			this._onMessage.fire({
				message: data.message,
				transfer: data.transfer,
			});
		}));

		this._register(this.on(WebviewMessageChannels.didScroll, (scrollYPercentage: number) => {
			this._onDidScroll.fire({ scrollYPercentage: scrollYPercentage });
		}));

		this._register(this.on(WebviewMessageChannels.doReload, () => {
			this.reload();
		}));

		this._register(this.on(WebviewMessageChannels.doUpdateState, (state: any) => {
			this.state = state;
			this._onDidUpdateState.fire(state);
		}));

		this._register(this.on(WebviewMessageChannels.didFocus, () => {
			this.handleFocusChange(true);
		}));

		this._register(this.on(WebviewMessageChannels.wheel, (event: IMouseWheelEvent) => {
			this._onDidWheel.fire(event);
		}));

		this._register(this.on(WebviewMessageChannels.didBlur, () => {
			this.handleFocusChange(false);
		}));

		this._register(this.on<{ message: string }>(WebviewMessageChannels.fatalError, (e) => {
			services.notificationService.error(localize('fatalErrorMessage', "Error loading webview: {0}", e.message));
		}));

		this._register(this.on('did-keydown', (data: KeyboardEvent) => {
			// Electron: workaround for https://github.com/electron/electron/issues/14258
			// We have to detect keyboard events in the <webview> and dispatch them to our
			// keybinding service because these events do not bubble to the parent window anymore.
			this.handleKeyEvent('keydown', data);
		}));

		this._register(this.on('did-keyup', (data: KeyboardEvent) => {
			this.handleKeyEvent('keyup', data);
		}));

		this._register(this.on('did-context-menu', (data: { clientX: number, clientY: number }) => {
			if (!this.element) {
				return;
			}
			if (!this._contextKeyService) {
				return;
			}
			const elementBox = this.element.getBoundingClientRect();
			services.contextMenuService.showContextMenu({
				getActions: () => {
					const result: IAction[] = [];
					const menu = services.menuService.createMenu(MenuId.WebviewContext, this._contextKeyService!);
					createAndFillInContextMenuActions(menu, undefined, result);
					menu.dispose();
					return result;
				},
				getAnchor: () => ({
					x: elementBox.x + data.clientX,
					y: elementBox.y + data.clientY
				})
			});
		}));

		this._register(this.on(WebviewMessageChannels.loadResource, (entry: { id: number, path: string, query: string, ifNoneMatch?: string }) => {
			const rawPath = entry.path;
			const uri = URI.parse(rawPath.replace(/^\/([\w\-]+)(\/{1,2})/, (_: string, scheme: string, sep: string) => {
				if (sep.length === 1) {
					return `${scheme}:///`; // Add empty authority.
				} else {
					return `${scheme}://`; // Url has own authority.
				}
			})).with({
				query: decodeURIComponent(entry.query),
			});

			this.loadResource(entry.id, rawPath, uri, entry.ifNoneMatch);
		}));

		this._register(this.on(WebviewMessageChannels.loadLocalhost, (entry: any) => {
			this.localLocalhost(entry.id, entry.origin);
		}));

		this.style();
		this._register(webviewThemeDataProvider.onThemeDataChanged(this.style, this));
	}

	override dispose(): void {
		if (this.element) {
			this.element.remove();
		}
		this._element = undefined;

		this._onDidDispose.fire();

		this._resourceLoadingCts.dispose(true);

		super.dispose();
	}

	setContextKeyService(contextKeyService: IContextKeyService) {
		this._contextKeyService = contextKeyService;
	}

	private readonly _onMissingCsp = this._register(new Emitter<ExtensionIdentifier>());
	public readonly onMissingCsp = this._onMissingCsp.event;

	private readonly _onDidClickLink = this._register(new Emitter<string>());
	public readonly onDidClickLink = this._onDidClickLink.event;

	private readonly _onDidReload = this._register(new Emitter<void>());
	public readonly onDidReload = this._onDidReload.event;

	private readonly _onMessage = this._register(new Emitter<WebviewMessageReceivedEvent>());
	public readonly onMessage = this._onMessage.event;

	private readonly _onDidScroll = this._register(new Emitter<{ readonly scrollYPercentage: number; }>());
	public readonly onDidScroll = this._onDidScroll.event;

	private readonly _onDidWheel = this._register(new Emitter<IMouseWheelEvent>());
	public readonly onDidWheel = this._onDidWheel.event;

	private readonly _onDidUpdateState = this._register(new Emitter<string | undefined>());
	public readonly onDidUpdateState = this._onDidUpdateState.event;

	private readonly _onDidFocus = this._register(new Emitter<void>());
	public readonly onDidFocus = this._onDidFocus.event;

	private readonly _onDidBlur = this._register(new Emitter<void>());
	public readonly onDidBlur = this._onDidBlur.event;

	private readonly _onDidDispose = this._register(new Emitter<void>());
	public readonly onDidDispose = this._onDidDispose.event;

	public postMessage(message: any, transfer?: ArrayBuffer[]): void {
		this._send('message', { message, transfer });
	}

	protected _send(channel: string, data?: any): void {
		if (this._state.type === WebviewState.Type.Initializing) {
			this._state.pendingMessages.push({ channel, data });
		} else {
			this.doPostMessage(channel, data);
		}
	}

	protected abstract readonly extraContentOptions: { readonly [key: string]: string };

	protected abstract createElement(options: WebviewOptions, contentOptions: WebviewContentOptions): T;

	protected abstract on<T = unknown>(channel: string, handler: (data: T) => void): IDisposable;

	protected abstract doPostMessage(channel: string, data?: any): void;

	private _hasAlertedAboutMissingCsp = false;
	private handleNoCspFound(): void {
		if (this._hasAlertedAboutMissingCsp) {
			return;
		}
		this._hasAlertedAboutMissingCsp = true;

		if (this.extension && this.extension.id) {
			if (this._environmentService.isExtensionDevelopment) {
				this._onMissingCsp.fire(this.extension.id);
			}

			type TelemetryClassification = {
				extension?: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			};
			type TelemetryData = {
				extension?: string,
			};

			this._telemetryService.publicLog2<TelemetryData, TelemetryClassification>('webviewMissingCsp', {
				extension: this.extension.id.value
			});
		}
	}

	public reload(): void {
		this.doUpdateContent(this.content);

		const subscription = this._register(this.on(WebviewMessageChannels.didLoad, () => {
			this._onDidReload.fire();
			subscription.dispose();
		}));
	}

	public set html(value: string) {
		const rewrittenHtml = this.rewriteVsCodeResourceUrls(value);
		this.doUpdateContent({
			html: rewrittenHtml,
			options: this.content.options,
			state: this.content.state,
		});
	}

	protected abstract get webviewResourceEndpoint(): string;

	private rewriteVsCodeResourceUrls(value: string): string {
		return value
			.replace(/(["'])(?:vscode-resource):(\/\/([^\s\/'"]+?)(?=\/))?([^\s'"]+?)(["'])/gi, (match, startQuote, _1, scheme, path, endQuote) => {
				if (scheme) {
					return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/${scheme}${path}${endQuote}`;
				}
				return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/file${path}${endQuote}`;
			})
			.replace(/(["'])(?:vscode-webview-resource):(\/\/[^\s\/'"]+\/([^\s\/'"]+?)(?=\/))?([^\s'"]+?)(["'])/gi, (match, startQuote, _1, scheme, path, endQuote) => {
				if (scheme) {
					return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/${scheme}${path}${endQuote}`;
				}
				return `${startQuote}${this.webviewResourceEndpoint}/vscode-resource/file${path}${endQuote}`;
			});
	}

	public set contentOptions(options: WebviewContentOptions) {
		this._logService.debug(`Webview(${this.id}): will update content options`);

		if (areWebviewContentOptionsEqual(options, this.content.options)) {
			this._logService.debug(`Webview(${this.id}): skipping content options update`);
			return;
		}

		this.doUpdateContent({
			html: this.content.html,
			options: options,
			state: this.content.state,
		});
	}

	public set localResourcesRoot(resources: readonly URI[]) {
		this.content = {
			...this.content,
			options: { ...this.content.options, localResourceRoots: resources }
		};
	}

	public set state(state: string | undefined) {
		this.content = {
			html: this.content.html,
			options: this.content.options,
			state,
		};
	}

	public set initialScrollProgress(value: number) {
		this._send('initial-scroll-position', value);
	}

	private doUpdateContent(newContent: WebviewContent) {
		this._logService.debug(`Webview(${this.id}): will update content`);

		this.content = newContent;

		this._send('content', {
			contents: this.content.html,
			options: this.content.options,
			state: this.content.state,
			resourceEndpoint: this.webviewResourceEndpoint,
			...this.extraContentOptions
		});
	}

	protected style(): void {
		let { styles, activeTheme, themeLabel } = this.webviewThemeDataProvider.getWebviewThemeData();
		if (this.options.transformCssVariables) {
			styles = this.options.transformCssVariables(styles);
		}

		this._send('styles', { styles, activeTheme, themeName: themeLabel });
	}

	protected handleFocusChange(isFocused: boolean): void {
		this._focused = isFocused;
		if (isFocused) {
			this._onDidFocus.fire();
		} else {
			this._onDidBlur.fire();
		}
	}

	private handleKeyEvent(type: 'keydown' | 'keyup', event: IKeydownEvent) {
		// Create a fake KeyboardEvent from the data provided
		const emulatedKeyboardEvent = new KeyboardEvent(type, event);
		// Force override the target
		Object.defineProperty(emulatedKeyboardEvent, 'target', {
			get: () => this.element,
		});
		// And re-dispatch
		window.dispatchEvent(emulatedKeyboardEvent);
	}

	windowDidDragStart(): void {
		// Webview break drag and droping around the main window (no events are generated when you are over them)
		// Work around this by disabling pointer events during the drag.
		// https://github.com/electron/electron/issues/18226
		if (this.element) {
			this.element.style.pointerEvents = 'none';
		}
	}

	windowDidDragEnd(): void {
		if (this.element) {
			this.element.style.pointerEvents = '';
		}
	}

	public selectAll() {
		this.execCommand('selectAll');
	}

	public copy() {
		this.execCommand('copy');
	}

	public paste() {
		this.execCommand('paste');
	}

	public cut() {
		this.execCommand('cut');
	}

	public undo() {
		this.execCommand('undo');
	}

	public redo() {
		this.execCommand('redo');
	}

	private execCommand(command: string) {
		if (this.element) {
			this._send('execCommand', command);
		}
	}

	private async loadResource(id: number, requestPath: string, uri: URI, ifNoneMatch: string | undefined) {
		try {
			const remoteAuthority = this._environmentService.remoteAuthority;
			const remoteConnectionData = remoteAuthority ? this._remoteAuthorityResolverService.getConnectionData(remoteAuthority) : null;

			const result = await loadLocalResource(uri, ifNoneMatch, {
				extensionLocation: this.extension?.location,
				roots: this.content.options.localResourceRoots || [],
				remoteConnectionData,
				useRootAuthority: this.content.options.useRootAuthority
			}, this._fileService, this._requestService, this._logService, this._resourceLoadingCts.token);

			switch (result.type) {
				case WebviewResourceResponse.Type.Success:
					{
						const { buffer } = await streamToBuffer(result.stream);
						return this._send('did-load-resource', {
							id,
							status: 200,
							path: requestPath,
							mime: result.mimeType,
							data: buffer,
							etag: result.etag,
						});
					}
				case WebviewResourceResponse.Type.NotModified:
					{
						return this._send('did-load-resource', {
							id,
							status: 304, // not modified
							path: requestPath,
							mime: result.mimeType,
						});
					}
				case WebviewResourceResponse.Type.AccessDenied:
					{
						return this._send('did-load-resource', {
							id,
							status: 401, // unauthorized
							path: requestPath,
						});
					}
			}
		} catch {
			// noop
		}

		return this._send('did-load-resource', {
			id,
			status: 404,
			path: requestPath
		});
	}

	private async localLocalhost(id: string, origin: string) {
		const authority = this._environmentService.remoteAuthority;
		const resolveAuthority = authority ? await this._remoteAuthorityResolverService.resolveAuthority(authority) : undefined;
		const redirect = resolveAuthority ? await this._portMappingManager.getRedirect(resolveAuthority.authority, origin) : undefined;
		return this._send('did-load-localhost', {
			id,
			origin,
			location: redirect
		});
	}

	public focus(): void {
		this.doFocus();

		// Handle focus change programmatically (do not rely on event from <webview>)
		this.handleFocusChange(true);
	}

	protected doFocus() {
		if (!this.element) {
			return;
		}

		// Clear the existing focus first if not already on the webview.
		// This is required because the next part where we set the focus is async.
		if (document.activeElement && document.activeElement instanceof HTMLElement && document.activeElement !== this.element) {
			// Don't blur if on the webview because this will also happen async and may unset the focus
			// after the focus trigger fires below.
			document.activeElement.blur();
		}

		// Workaround for https://github.com/microsoft/vscode/issues/75209
		// Electron's webview.focus is async so for a sequence of actions such as:
		//
		// 1. Open webview
		// 1. Show quick pick from command palette
		//
		// We end up focusing the webview after showing the quick pick, which causes
		// the quick pick to instantly dismiss.
		//
		// Workaround this by debouncing the focus and making sure we are not focused on an input
		// when we try to re-focus.
		this._focusDelayer.trigger(async () => {
			if (!this.isFocused || !this.element) {
				return;
			}
			if (document.activeElement && document.activeElement?.tagName !== 'BODY') {
				return;
			}
			try {
				this.elementFocusImpl();
			} catch {
				// noop
			}
			this._send('focus');
		});
	}

	protected abstract elementFocusImpl(): void;
}
