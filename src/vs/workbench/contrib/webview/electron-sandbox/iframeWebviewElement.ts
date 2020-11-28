/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThrottledDelayer } from 'vs/base/common/async';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { IFrameWebview } from 'vs/workbench/contrib/webview/browser/webviewElement';
import { rewriteVsCodeResourceUrls, WebviewResourceRequestManager } from 'vs/workbench/contrib/webview/electron-sandbox/resourceLoading';
import { WindowIgnoreMenuShortcutsManager } from 'vs/workbench/contrib/webview/electron-sandbox/windowIgnoreMenuShortcutsManager';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

/**
 * Webview backed by an iframe but that uses Electron APIs to power the webview.
 */
export class ElectronIframeWebview extends IFrameWebview {

	private readonly _resourceRequestManager: WebviewResourceRequestManager;
	private _messagePromise = Promise.resolve();

	private readonly _focusDelayer = this._register(new ThrottledDelayer(10));
	private _elementFocusImpl!: (options?: FocusOptions | undefined) => void;

	private readonly _webviewKeyboardHandler: WindowIgnoreMenuShortcutsManager;

	constructor(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
		webviewThemeDataProvider: WebviewThemeDataProvider,
		@ITunnelService tunnelService: ITunnelService,
		@IFileService fileService: IFileService,
		@IRequestService requestService: IRequestService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@INotificationService noficationService: INotificationService,
		@INativeHostService nativeHostService: INativeHostService,
	) {
		super(id, options, contentOptions, extension, webviewThemeDataProvider,
			noficationService, tunnelService, fileService, requestService, telemetryService, environmentService, _remoteAuthorityResolverService, logService);

		this._resourceRequestManager = this._register(instantiationService.createInstance(WebviewResourceRequestManager, id, extension, this.content.options));

		this._webviewKeyboardHandler = new WindowIgnoreMenuShortcutsManager(configurationService, mainProcessService, nativeHostService);

		this._register(this.on(WebviewMessageChannels.didFocus, () => {
			this._webviewKeyboardHandler.didFocus();
		}));

		this._register(this.on(WebviewMessageChannels.didBlur, () => {
			this._webviewKeyboardHandler.didBlur();
		}));
	}

	protected createElement(options: WebviewOptions, contentOptions: WebviewContentOptions) {
		const element = super.createElement(options, contentOptions);
		this._elementFocusImpl = element.focus.bind(element);
		element.focus = () => {
			this.doFocus();
		};
		return element;
	}

	protected initElement(extension: WebviewExtensionDescription | undefined, options: WebviewOptions) {
		// The extensionId and purpose in the URL are used for filtering in js-debug:
		this.element!.setAttribute('src', `${Schemas.vscodeWebview}://${this.id}/index.html?id=${this.id}&platform=electron&extensionId=${extension?.id.value ?? ''}&purpose=${options.purpose}`);
	}

	public set contentOptions(options: WebviewContentOptions) {
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

	protected get extraContentOptions() {
		return {};
	}

	protected async doPostMessage(channel: string, data?: any): Promise<void> {
		this._messagePromise = this._messagePromise
			.then(() => this._resourceRequestManager.ensureReady())
			.then(() => {
				this.element?.contentWindow!.postMessage({ channel, args: data }, '*');
			});
	}

	protected preprocessHtml(value: string): string {
		return rewriteVsCodeResourceUrls(this.id, value);
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

		// Workaround for https://github.com/microsoft/vscode/issues/75209
		// .focus is async for imframes so for a sequence of actions such as:
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

			if (document.activeElement?.tagName === 'INPUT') {
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
}
