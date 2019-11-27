/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as extensionsRegistry from 'vs/workbench/services/extensions/common/extensionsRegistry';
import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { ISearchTokenRegistry, SearchExtensions, ISearchTokenCommand } from 'vs/workbench/services/search/common/searchTokenRegistry';

export class SearchTokenExtensionPoint {
	constructor() {
		searchTokenExtensionPoint.setHandler((_, { added, removed }) => {
			if (removed.length) {
				removed.map(extension => extension.value)
					.forEach(tokens => searchTokenRegistry.deregisterTokens(tokens));
			}

			if (added.length) {
				added.map(extension => extension.value)
					.forEach(tokens => searchTokenRegistry.registerTokens(tokens));
			}
		});
	}
}

const searchTokenRegistry = Registry.as<ISearchTokenRegistry>(SearchExtensions.SearchTokens);

const searchTokenExtensionPoint = extensionsRegistry.ExtensionsRegistry.registerExtensionPoint<ISearchTokenCommand[]>({
	extensionPoint: 'searchTokens',
	jsonSchema: {
		description: nls.localize('vscode.extension.contributes.searchTokens', 'Contributes search tokens that can be expanded into patterns or text.'),
		type: 'array',
	}
});
