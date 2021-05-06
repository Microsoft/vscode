/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'vs/base/browser/dom';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { BaseWebview, WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { Webview, WebviewContentOptions, WebviewExtensionDescription, WebviewOptions } from 'vs/workbench/contrib/webview/browser/webview';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class IFrameWebview extends BaseWebview<HTMLIFrameElement> implements Webview {

	private _confirmBeforeClose: string;

	constructor(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
		webviewThemeDataProvider: WebviewThemeDataProvider,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService,
		@IMenuService menuService: IMenuService,
		@INotificationService notificationService: INotificationService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IRequestService requestService: IRequestService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ITunnelService tunnelService: ITunnelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super(id, options, contentOptions, extension, webviewThemeDataProvider, {
			contextMenuService,
			notificationService,
			logService,
			telemetryService,
			environmentService,
			requestService,
			fileService,
			tunnelService,
			remoteAuthorityResolverService,
			menuService,
		});

		/* __GDPR__
			"webview.createWebview" : {
				"extension": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"s": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		telemetryService.publicLog('webview.createWebview', {
			extension: extension?.id.value,
			webviewElementType: 'iframe',
		});

		this._confirmBeforeClose = configurationService.getValue<string>('window.confirmBeforeClose');

		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('window.confirmBeforeClose')) {
				this._confirmBeforeClose = configurationService.getValue('window.confirmBeforeClose');
				this._send(WebviewMessageChannels.setConfirmBeforeClose, this._confirmBeforeClose);
			}
		}));

		this.initElement(extension, options);
	}

	protected createElement(options: WebviewOptions, _contentOptions: WebviewContentOptions) {
		// Do not start loading the webview yet.
		// Wait the end of the ctor when all listeners have been hooked up.
		const element = document.createElement('iframe');
		element.className = `webview ${options.customClasses || ''}`;
		element.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-pointer-lock', 'allow-downloads');
		element.setAttribute('allow', 'clipboard-read; clipboard-write; usb;');
		element.style.border = 'none';
		element.style.width = '100%';
		element.style.height = '100%';

		element.focus = () => {
			this.doFocus();
		};

		return element;
	}

	protected elementFocusImpl() {
		this.element?.contentWindow?.focus();
	}

	protected initElement(extension: WebviewExtensionDescription | undefined, options: WebviewOptions, extraParams?: object) {
		const params = {
			id: this.id,
			extensionId: extension?.id.value ?? '', // The extensionId and purpose in the URL are used for filtering in js-debug:
			purpose: options.purpose,
			serviceWorkerFetchIgnoreSubdomain: options.serviceWorkerFetchIgnoreSubdomain,
			...extraParams
		} as const;

		const queryString = (Object.keys(params) as Array<keyof typeof params>)
			.map((key) => `${key}=${encodeURIComponent(params[key]!)}`)
			.join('&');

		this.element!.setAttribute('src', `${this.webviewContentEndpoint}/index.html?${queryString}`);
	}

	protected get webviewContentEndpoint(): string {
		const endpoint = this._environmentService.webviewExternalEndpoint!.replace('{{uuid}}', this.id);
		if (endpoint[endpoint.length - 1] === '/') {
			return endpoint.slice(0, endpoint.length - 1);
		}
		return endpoint;
	}

	protected get webviewResourceEndpoint(): string {
		return this.webviewContentEndpoint;
	}

	public mountTo(parent: HTMLElement) {
		if (this.element) {
			parent.appendChild(this.element);
		}
	}

	protected get extraContentOptions(): any {
		return {
			confirmBeforeClose: this._confirmBeforeClose,
		};
	}

	showFind(): void {
		throw new Error('Method not implemented.');
	}

	hideFind(): void {
		throw new Error('Method not implemented.');
	}

	runFindAction(previous: boolean): void {
		throw new Error('Method not implemented.');
	}

	protected doPostMessage(channel: string, data?: any): void {
		if (this.element) {
			this.element.contentWindow!.postMessage({ channel, args: data }, '*');
		}
	}

	protected on<T = unknown>(channel: WebviewMessageChannels, handler: (data: T) => void): IDisposable {
		return addDisposableListener(window, 'message', e => {
			if (!e || !e.data || e.data.target !== this.id) {
				return;
			}
			if (e.data.channel === channel) {
				handler(e.data.data);
			}
		});
	}
}
