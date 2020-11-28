/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FindInPageOptions, WebviewTag } from 'electron';
import { addDisposableListener } from 'vs/base/browser/dom';
import { ThrottledDelayer } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { once } from 'vs/base/common/functional';
import { IDisposable } from 'vs/base/common/lifecycle';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { webviewPartitionId } from 'vs/platform/webview/common/resourceLoader';
import { BaseWebview, WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { Webview, WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewFindDelegate, WebviewFindWidget } from 'vs/workbench/contrib/webview/browser/webviewFindWidget';
import { WebviewIgnoreMenuShortcutsManager } from 'vs/workbench/contrib/webview/electron-browser/webviewIgnoreMenuShortcutsManager';
import { rewriteVsCodeResourceUrls, WebviewResourceRequestManager } from 'vs/workbench/contrib/webview/electron-sandbox/resourceLoading';
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

	private readonly _resourceRequestManager: WebviewResourceRequestManager;
	private _messagePromise = Promise.resolve();

	private readonly _focusDelayer = this._register(new ThrottledDelayer(10));
	private _elementFocusImpl!: (options?: FocusOptions | undefined) => void;

	constructor(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
		private readonly _webviewThemeDataProvider: WebviewThemeDataProvider,
		@ILogService private readonly _myLogService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@INotificationService noficationService: INotificationService,
		@INativeHostService nativeHostService: INativeHostService,
	) {
		super(id, options, contentOptions, extension, _webviewThemeDataProvider, noficationService, _myLogService, telemetryService, environmentService);

		/* __GDPR__
			"webview.createWebview" : {
				"extension": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"enableFindWidget": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		telemetryService.publicLog('webview.createWebview', {
			enableFindWidget: !!options.enableFindWidget,
			extension: extension?.id.value,
		});

		this._myLogService.debug(`Webview(${this.id}): init`);

		this._resourceRequestManager = this._register(instantiationService.createInstance(WebviewResourceRequestManager, id, extension, this.content.options));

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
		this.element!.src = `${Schemas.vscodeWebview}://${this.id}/electron-browser/index.html?platform=electron`;
	}

	protected createElement(options: WebviewOptions) {
		// Do not start loading the webview yet.
		// Wait the end of the ctor when all listeners have been hooked up.
		const element = document.createElement('webview');

		this._elementFocusImpl = element.focus.bind(element);
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

	public set contentOptions(options: WebviewContentOptions) {
		this._myLogService.debug(`Webview(${this.id}): will set content options`);
		this._resourceRequestManager.update(options);
		super.contentOptions = options;
	}

	public set localResourcesRoot(resources: URI[]) {
		this._resourceRequestManager.update({
			...this.contentOptions,
			localResourceRoots: resources,
		});
		super.localResourcesRoot = resources;
	}

	protected readonly extraContentOptions = {};

	public set html(value: string) {
		this._myLogService.debug(`Webview(${this.id}): will set html`);

		super.html = rewriteVsCodeResourceUrls(this.id, value);
	}

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
		this._myLogService.debug(`Webview(${this.id}): will post message on '${channel}'`);

		this._messagePromise = this._messagePromise
			.then(() => this._resourceRequestManager.ensureReady())
			.then(() => {
				this._myLogService.debug(`Webview(${this.id}): did post message on '${channel}'`);
				return this.element?.send(channel, data);
			});
	}

	public focus(): void {
		this.doFocus();

		// Handle focus change programmatically (do not rely on event from <webview>)
		this.handleFocusChange(true);
	}

	private doFocus() {
		if (!this.element) {
			return;
		}

		// Clear the existing focus first.
		// This is required because the next part where we set the focus is async.
		if (document.activeElement && document.activeElement instanceof HTMLElement) {
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
				this._elementFocusImpl();
			} catch {
				// noop
			}
			this._send('focus');
		});
	}

	protected style(): void {
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
			findNext: false,
			matchCase: options.matchCase,
			medialCapitalAsWordStart: options.medialCapitalAsWordStart
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

		const options = { findNext: true, forward: !previous };
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

	public selectAll() {
		this.element?.selectAll();
	}

	public copy() {
		this.element?.copy();
	}

	public paste() {
		this.element?.paste();
	}

	public cut() {
		this.element?.cut();
	}

	public undo() {
		this.element?.undo();
	}

	public redo() {
		this.element?.redo();
	}

	protected on<T = unknown>(channel: WebviewMessageChannels | string, handler: (data: T) => void): IDisposable {
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
