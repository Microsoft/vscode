/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FindInPageOptions, WebviewTag } from 'electron';
import { addDisposableListener } from 'vs/base/browser/dom';
import { Emitter, Event } from 'vs/base/common/event';
import { once } from 'vs/base/common/functional';
import { IDisposable } from 'vs/base/common/lifecycle';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/services';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { webviewPartitionId } from 'vs/platform/webview/common/webviewManagerService';
import { BaseWebview, WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { Webview, WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewFindDelegate, WebviewFindWidget } from 'vs/workbench/contrib/webview/browser/webviewFindWidget';
import { WebviewIgnoreMenuShortcutsManager } from 'vs/workbench/contrib/webview/electron-browser/webviewIgnoreMenuShortcutsManager';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class ElectronWebviewBasedWebview extends BaseWebview<WebviewTag> implements Webview, WebviewFindDelegate {

	private static _webviewKeyboardHandler: WebviewIgnoreMenuShortcutsManager | undefined;

	private static getWebviewKeyboardHandler(
		configService: IConfigurationService,
		mainProcessService: IMainProcessService,
	) {
		if (!this._webviewKeyboardHandler) {
			this._webviewKeyboardHandler = new WebviewIgnoreMenuShortcutsManager(configService, mainProcessService);
		}
		return this._webviewKeyboardHandler;
	}

	private _webviewFindWidget: WebviewFindWidget | undefined;
	private _findStarted: boolean = false;

	constructor(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
		private readonly _webviewThemeDataProvider: WebviewThemeDataProvider,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ILogService private readonly _myLogService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IMenuService menuService: IMenuService,
		@INotificationService notificationService: INotificationService,
		@IFileService fileService: IFileService,
		@IRequestService requestService: IRequestService,
		@ITunnelService tunnelService: ITunnelService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
	) {
		super(id, options, contentOptions, extension, _webviewThemeDataProvider, {
			contextMenuService,
			notificationService,
			logService: _myLogService,
			telemetryService,
			environmentService,
			fileService,
			menuService,
			requestService,
			tunnelService,
			remoteAuthorityResolverService
		});

		/* __GDPR__
			"webview.createWebview" : {
				"extension": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"enableFindWidget": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"webviewElementType": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		telemetryService.publicLog('webview.createWebview', {
			enableFindWidget: !!options.enableFindWidget,
			extension: extension?.id.value,
			webviewElementType: 'webview',
		});

		this._myLogService.debug(`Webview(${this.id}): init`);

		this._register(addDisposableListener(this.element!, 'dom-ready', once(() => {
			this._register(ElectronWebviewBasedWebview.getWebviewKeyboardHandler(configurationService, mainProcessService).add(this.element!));
		})));

		this._register(addDisposableListener(this.element!, 'console-message', function (e: { level: number; message: string; line: number; sourceId: string; }) {
			console.log(`[Embedded Page] ${e.message}`);
		}));

		this._register(addDisposableListener(this.element!, 'dom-ready', () => {
			this._myLogService.debug(`Webview(${this.id}): dom-ready`);

			// Workaround for https://github.com/electron/electron/issues/14474
			if (this.element && (this.isFocused || document.activeElement === this.element)) {
				this.element.blur();
				this.element.focus();
			}
		}));

		this._register(addDisposableListener(this.element!, 'crashed', () => {
			console.error('embedded page crashed');
		}));

		this._register(this.on('synthetic-mouse-event', (rawEvent: any) => {
			if (!this.element) {
				return;
			}
			const bounds = this.element.getBoundingClientRect();
			try {
				window.dispatchEvent(new MouseEvent(rawEvent.type, {
					...rawEvent,
					clientX: rawEvent.clientX + bounds.left,
					clientY: rawEvent.clientY + bounds.top,
				}));
				return;
			} catch {
				// CustomEvent was treated as MouseEvent so don't do anything - https://github.com/microsoft/vscode/issues/78915
				return;
			}
		}));

		this._register(this.on('did-set-content', () => {
			this._myLogService.debug(`Webview(${this.id}): did-set-content`);

			if (this.element) {
				this.element.style.flex = '';
				this.element.style.width = '100%';
				this.element.style.height = '100%';
			}
		}));

		this._register(addDisposableListener(this.element!, 'devtools-opened', () => {
			this._send('devtools-opened');
		}));

		if (options.enableFindWidget) {
			this._webviewFindWidget = this._register(instantiationService.createInstance(WebviewFindWidget, this));

			this._register(addDisposableListener(this.element!, 'found-in-page', e => {
				this._hasFindResult.fire(e.result.matches > 0);
			}));

			this.styledFindWidget();
		}

		// We must ensure to put a `file:` URI as the preload attribute
		// and not the `vscode-file` URI because preload scripts are loaded
		// via node.js from the main side and only allow `file:` protocol
		this.element!.preload = FileAccess.asFileUri('./pre/electron-index.js', require).toString(true);
		this.element!.src = `${Schemas.vscodeWebview}://${this.id}/electron-browser-index.html?platform=electron&id=${this.id}&vscode-resource-origin=${encodeURIComponent(this.webviewResourceEndpoint)}`;
	}

	protected createElement(options: WebviewOptions) {
		// Do not start loading the webview yet.
		// Wait the end of the ctor when all listeners have been hooked up.
		const element = document.createElement('webview');

		element.focus = () => {
			this.doFocus();
		};

		element.setAttribute('partition', webviewPartitionId);
		element.setAttribute('webpreferences', 'contextIsolation=yes');
		element.className = `webview ${options.customClasses || ''}`;

		element.style.flex = '0 1';
		element.style.width = '0';
		element.style.height = '0';
		element.style.outline = '0';

		return element;
	}

	protected elementFocusImpl() {
		this.element?.focus();
	}

	public override set contentOptions(options: WebviewContentOptions) {
		this._myLogService.debug(`Webview(${this.id}): will set content options`);
		super.contentOptions = options;
	}

	protected override get webviewResourceEndpoint(): string {
		return `https://${this.id}.vscode-webview-test.com`;
	}

	protected readonly extraContentOptions = {};

	public mountTo(parent: HTMLElement) {
		if (!this.element) {
			return;
		}

		if (this._webviewFindWidget) {
			parent.appendChild(this._webviewFindWidget.getDomNode()!);
		}
		parent.appendChild(this.element);
	}

	protected async doPostMessage(channel: string, data?: any): Promise<void> {
		this._myLogService.debug(`Webview(${this.id}): did post message on '${channel}'`);
		this.element?.send(channel, data);
	}

	protected override style(): void {
		super.style();
		this.styledFindWidget();
	}

	private styledFindWidget() {
		this._webviewFindWidget?.updateTheme(this._webviewThemeDataProvider.getTheme());
	}

	private readonly _hasFindResult = this._register(new Emitter<boolean>());
	public readonly hasFindResult: Event<boolean> = this._hasFindResult.event;

	public startFind(value: string, options?: FindInPageOptions) {
		if (!value || !this.element) {
			return;
		}

		// ensure options is defined without modifying the original
		options = options || {};

		// FindNext must be false for a first request
		const findOptions: FindInPageOptions = {
			forward: options.forward,
			findNext: true,
			matchCase: options.matchCase
		};

		this._findStarted = true;
		this.element.findInPage(value, findOptions);
	}

	/**
	 * Webviews expose a stateful find API.
	 * Successive calls to find will move forward or backward through onFindResults
	 * depending on the supplied options.
	 *
	 * @param value The string to search for. Empty strings are ignored.
	 */
	public find(value: string, previous: boolean): void {
		if (!this.element) {
			return;
		}

		// Searching with an empty value will throw an exception
		if (!value) {
			return;
		}

		const options = { findNext: false, forward: !previous };
		if (!this._findStarted) {
			this.startFind(value, options);
			return;
		}

		this.element.findInPage(value, options);
	}

	public stopFind(keepSelection?: boolean): void {
		this._hasFindResult.fire(false);
		if (!this.element) {
			return;
		}
		this._findStarted = false;
		this.element.stopFindInPage(keepSelection ? 'keepSelection' : 'clearSelection');
	}

	public showFind() {
		this._webviewFindWidget?.reveal();
	}

	public hideFind() {
		this._webviewFindWidget?.hide();
	}

	public runFindAction(previous: boolean) {
		this._webviewFindWidget?.find(previous);
	}

	public override selectAll() {
		this.element?.selectAll();
	}

	public override copy() {
		this.element?.copy();
	}

	public override paste() {
		this.element?.paste();
	}

	public override cut() {
		this.element?.cut();
	}

	public override undo() {
		this.element?.undo();
	}

	public override redo() {
		this.element?.redo();
	}

	protected override on<T = unknown>(channel: WebviewMessageChannels | string, handler: (data: T) => void): IDisposable {
		if (!this.element) {
			throw new Error('Cannot add event listener. No webview element found.');
		}
		return addDisposableListener(this.element, 'ipc-message', (event) => {
			if (!this.element) {
				return;
			}
			if (event.channel === channel && event.args && event.args.length) {
				handler(event.args[0]);
			}
		});
	}
}
