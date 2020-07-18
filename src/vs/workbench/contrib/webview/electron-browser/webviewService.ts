/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { DynamicWebviewEditorOverlay } from 'vs/workbench/contrib/webview/browser/dynamicWebviewEditorOverlay';
import { WebviewThemeDataProvider } from 'vs/workbench/contrib/webview/browser/themeing';
import { IWebviewService, WebviewContentOptions, WebviewElement, WebviewExtensionDescription, WebviewIcons, WebviewOptions, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewIconManager } from 'vs/workbench/contrib/webview/browser/webviewIconManager';
import { ElectronIframeWebview } from 'vs/workbench/contrib/webview/electron-browser/iframeWebviewElement';
import { ElectronWebviewBasedWebview } from 'vs/workbench/contrib/webview/electron-browser/webviewElement';

export class ElectronWebviewService implements IWebviewService {
	declare readonly _serviceBrand: undefined;

	private readonly _webviewThemeDataProvider: WebviewThemeDataProvider;
	private readonly _iconManager: WebviewIconManager;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configService: IConfigurationService,
	) {
		this._webviewThemeDataProvider = this._instantiationService.createInstance(WebviewThemeDataProvider);
		this._iconManager = this._instantiationService.createInstance(WebviewIconManager);
	}

	createWebviewElement(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
	): WebviewElement {
		const useIframes = this._configService.getValue<string>('webview.experimental.useIframes');
		return this._instantiationService.createInstance(useIframes ? ElectronIframeWebview : ElectronWebviewBasedWebview, id, options, contentOptions, extension, this._webviewThemeDataProvider);
	}

	createWebviewOverlay(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
	): WebviewOverlay {
		return this._instantiationService.createInstance(DynamicWebviewEditorOverlay, id, options, contentOptions, extension);
	}

	setIcons(id: string, iconPath: WebviewIcons | undefined): void {
		this._iconManager.setIcons(id, iconPath);
	}
}
