/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PluginManager } from './utils/plugins';

class ApiV0 {
	public constructor(
		public readonly onCompletionAccepted: vscode.Event<vscode.CompletionItem & { metadata?: any }>,
		private readonly _pluginManager: PluginManager,
	) { }

	configurePlugin(pluginId: string, configuration: {}): void {
		this._pluginManager.setConfiguration(pluginId, configuration);
	}
}

export interface Api {
	getAPI(version: 0): ApiV0 | undefined;
}

export function getExtensionApi(
	onCompletionAccepted: vscode.Event<vscode.CompletionItem>,
	pluginManager: PluginManager,
): Api {
	return {
		getAPI(version) {
			if (version === 0) {
				return new ApiV0(onCompletionAccepted, pluginManager);
			}
			return undefined;
		}
	};
}
