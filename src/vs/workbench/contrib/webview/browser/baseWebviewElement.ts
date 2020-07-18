/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addClass } from 'vs/base/browser/dom';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { areWebviewInputOptionsEqual } from 'vs/workbench/contrib/webview/browser/webviewWorkbenchService';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILogService } from 'vs/platform/log/common/log';

export const enum WebviewMessageChannels {
	onmessage = 'onmessage',
	didClickLink = 'did-click-link',
	didScroll = 'did-scroll',
	didFocus = 'did-focus',
	didBlur = 'did-blur',
	didLoad = 'did-load',
	doUpdateState = 'do-update-state',
	doReload = 'do-reload',
	loadResource = 'load-resource',
	loadLocalhost = 'load-localhost',
	webviewReady = 'webview-ready',
	wheel = 'did-scroll-wheel'
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
	protected get focused(): boolean { return !!this._focused; }

	private _state: WebviewState.State = new WebviewState.Initializing([]);

	protected content: WebviewContent;

	constructor(
		// TODO: matb, this should not be protected. The only reason it needs to be is that the base class ends up using it in the call to createElement
		protected readonly id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		public readonly extension: WebviewExtensionDescription | undefined,
		private readonly webviewThemeDataProvider: WebviewThemeDataProvider,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
		@IWorkbenchEnvironmentService protected readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
	) {
		super();

		this.content = {
			html: '',
			options: contentOptions,
			state: undefined
		};

		this._element = this.createElement(options, contentOptions);

		const subscription = this._register(this.on(WebviewMessageChannels.webviewReady, () => {
			this._logService.debug(`Webview(${this.id}): webview ready`);

			if (this.element) {
				addClass(this.element, 'ready');
			}

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

		this._register(this.on(WebviewMessageChannels.onmessage, (data: any) => {
			this._onMessage.fire(data);
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

		this._register(this.on('did-keydown', (data: KeyboardEvent) => {
			// Electron: workaround for https://github.com/electron/electron/issues/14258
			// We have to detect keyboard events in the <webview> and dispatch them to our
			// keybinding service because these events do not bubble to the parent window anymore.
			this.handleKeyDown(data);
		}));

		this.style();
		this._register(webviewThemeDataProvider.onThemeDataChanged(this.style, this));
	}

	dispose(): void {
		if (this.element) {
			this.element.remove();
		}

		this._element = undefined;
		super.dispose();
	}

	private readonly _onMissingCsp = this._register(new Emitter<ExtensionIdentifier>());
	public readonly onMissingCsp = this._onMissingCsp.event;

	private readonly _onDidClickLink = this._register(new Emitter<string>());
	public readonly onDidClickLink = this._onDidClickLink.event;

	private readonly _onDidReload = this._register(new Emitter<void>());
	public readonly onDidReload = this._onDidReload.event;

	private readonly _onMessage = this._register(new Emitter<any>());
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

	public postMessage(data: any): void {
		this._send('message', data);
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
		this.doUpdateContent({
			html: value,
			options: this.content.options,
			state: this.content.state,
		});
	}

	public set contentOptions(options: WebviewContentOptions) {
		this._logService.debug(`Webview(${this.id}): will update content options`);

		if (areWebviewInputOptionsEqual(options, this.content.options)) {
			this._logService.debug(`Webview(${this.id}): skipping content options update`);
			return;
		}

		this.doUpdateContent({
			html: this.content.html,
			options: options,
			state: this.content.state,
		});
	}

	public set localResourcesRoot(resources: URI[]) {
		/** no op */
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
			...this.extraContentOptions
		});
	}

	protected style(): void {
		const { styles, activeTheme, themeLabel } = this.webviewThemeDataProvider.getWebviewThemeData();
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

	private handleKeyDown(event: IKeydownEvent) {
		// Create a fake KeyboardEvent from the data provided
		const emulatedKeyboardEvent = new KeyboardEvent('keydown', event);
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
}
