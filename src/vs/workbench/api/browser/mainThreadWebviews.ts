/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { isWeb } from 'vs/base/common/platform';
import { escape } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IProductService } from 'vs/platform/product/common/productService';
import * as extHostProtocol from 'vs/workbench/api/common/extHost.protocol';
import { Webview, WebviewContentOptions, WebviewExtensionDescription, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';

export class MainThreadWebviews extends Disposable implements extHostProtocol.MainThreadWebviewsShape {

	private static readonly standardSupportedLinkSchemes = new Set([
		Schemas.http,
		Schemas.https,
		Schemas.mailto,
		Schemas.vscode,
		'vscode-insider',
	]);

	private readonly _proxy: extHostProtocol.ExtHostWebviewsShape;

	private readonly _webviews = new Map<string, Webview>();

	constructor(
		context: extHostProtocol.IExtHostContext,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IProductService private readonly _productService: IProductService,
	) {
		super();

		this._proxy = context.getProxy(extHostProtocol.ExtHostContext.ExtHostWebviews);
	}

	public addWebview(handle: extHostProtocol.WebviewHandle, webview: WebviewOverlay): void {
		if (this._webviews.has(handle)) {
			throw new Error('Webview already registered');
		}

		this._webviews.set(handle, webview);
		this.hookupWebviewEventDelegate(handle, webview);
	}

	public $setHtml(handle: extHostProtocol.WebviewHandle, value: string): void {
		const webview = this.getWebview(handle);
		webview.html = value;
	}

	public $setOptions(handle: extHostProtocol.WebviewHandle, options: extHostProtocol.IWebviewOptions): void {
		const webview = this.getWebview(handle);
		webview.contentOptions = reviveWebviewContentOptions(options);
	}

	public async $postMessage(handle: extHostProtocol.WebviewHandle, message: any): Promise<boolean> {
		const webview = this.getWebview(handle);
		webview.postMessage(message);
		return true;
	}

	private hookupWebviewEventDelegate(handle: extHostProtocol.WebviewHandle, webview: WebviewOverlay) {
		const disposables = new DisposableStore();

		disposables.add(webview.onDidClickLink((uri) => this.onDidClickLink(handle, uri)));
		disposables.add(webview.onMessage((message: any) => { this._proxy.$onMessage(handle, message); }));
		disposables.add(webview.onMissingCsp((extension: ExtensionIdentifier) => this._proxy.$onMissingCsp(handle, extension.value)));

		disposables.add(webview.onDidDispose(() => {
			disposables.dispose();
			this._webviews.delete(handle);
		}));
	}

	private onDidClickLink(handle: extHostProtocol.WebviewHandle, link: string): void {
		const webview = this.getWebview(handle);
		if (this.isSupportedLink(webview, URI.parse(link))) {
			this._openerService.open(link, { fromUserGesture: true, allowContributedOpeners: true });
		}
	}

	private isSupportedLink(webview: Webview, link: URI): boolean {
		if (MainThreadWebviews.standardSupportedLinkSchemes.has(link.scheme)) {
			return true;
		}
		if (!isWeb && this._productService.urlProtocol === link.scheme) {
			return true;
		}
		return !!webview.contentOptions.enableCommandUris && link.scheme === Schemas.command;
	}

	private getWebview(handle: extHostProtocol.WebviewHandle): Webview {
		const webview = this._webviews.get(handle);
		if (!webview) {
			throw new Error(`Unknown webview handle:${handle}`);
		}
		return webview;
	}

	public getWebviewResolvedFailedContent(viewType: string) {
		return `<!DOCTYPE html>
		<html>
			<head>
				<meta http-equiv="Content-type" content="text/html;charset=UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none';">
			</head>
			<body>${localize('errorMessage', "An error occurred while loading view: {0}", escape(viewType))}</body>
		</html>`;
	}
}

export function reviveWebviewExtension(extensionData: extHostProtocol.WebviewExtensionDescription): WebviewExtensionDescription {
	return { id: extensionData.id, location: URI.revive(extensionData.location) };
}

export function reviveWebviewContentOptions(webviewOptions: extHostProtocol.IWebviewOptions): WebviewContentOptions {
	return {
		allowScripts: webviewOptions.enableScripts,
		allowWebUSB: webviewOptions.enableWebUSB,
		enableCommandUris: webviewOptions.enableCommandUris,
		localResourceRoots: Array.isArray(webviewOptions.localResourceRoots) ? webviewOptions.localResourceRoots.map(r => URI.revive(r)) : undefined,
		portMapping: webviewOptions.portMapping,
	};
}
