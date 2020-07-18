/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { memoize } from 'vs/base/common/decorators';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { WebviewIcons } from 'vs/workbench/contrib/webview/browser/webview';

export class WebviewIconManager {

	private readonly _icons = new Map<string, WebviewIcons>();

	constructor(
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IConfigurationService private readonly _configService: IConfigurationService,
	) {
		this._configService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.iconTheme')) {
				this.updateStyleSheet();
			}
		});
	}

	@memoize
	private get _styleElement(): HTMLStyleElement {
		const element = dom.createStyleSheet();
		element.className = 'webview-icons';
		return element;
	}

	public setIcons(
		webviewId: string,
		iconPath: WebviewIcons | undefined,
	) {
		if (iconPath) {
			this._icons.set(webviewId, iconPath);
		} else {
			this._icons.delete(webviewId);
		}

		this.updateStyleSheet();
	}

	private async updateStyleSheet() {
		await this._lifecycleService.when(LifecyclePhase.Starting);

		const cssRules: string[] = [];
		if (this._configService.getValue('workbench.iconTheme') !== null) {
			for (const [key, value] of this._icons) {
				const webviewSelector = `.show-file-icons .webview-${key}-name-file-icon::before`;
				try {
					cssRules.push(
						`.monaco-workbench.vs ${webviewSelector} { content: ""; background-image: ${dom.asCSSUrl(value.light)}; }`,
						`.monaco-workbench.vs-dark ${webviewSelector} { content: ""; background-image: ${dom.asCSSUrl(value.dark)}; }`
					);
				} catch {
					// noop
				}
			}
		}
		this._styleElement.innerHTML = cssRules.join('\n');
	}
}
