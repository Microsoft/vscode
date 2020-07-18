/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICSSDataProvider, newCSSDataProvider } from 'vscode-css-languageservice';
import { RequestService } from './requests';

export function fetchDataProviders(dataPaths: string[], requestService: RequestService): Promise<ICSSDataProvider[]> {
	const providers = dataPaths.map(async p => {
		try {
			const content = await requestService.getContent(p);
			return parseCSSData(content);
		} catch (e) {
			return newCSSDataProvider({ version: 1 });
		}
	});

	return Promise.all(providers);
}

function parseCSSData(source: string): ICSSDataProvider {
	let rawData: any;

	try {
		rawData = JSON.parse(source);
	} catch (err) {
		return newCSSDataProvider({ version: 1 });
	}

	return newCSSDataProvider({
		version: rawData.version || 1,
		properties: rawData.properties || [],
		atDirectives: rawData.atDirectives || [],
		pseudoClasses: rawData.pseudoClasses || [],
		pseudoElements: rawData.pseudoElements || []
	});
}
