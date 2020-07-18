/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHTMLDataProvider, newHTMLDataProvider } from 'vscode-html-languageservice';
import { RequestService } from './requests';

export function fetchHTMLDataProviders(dataPaths: string[], requestService: RequestService): Promise<IHTMLDataProvider[]> {
	const providers = dataPaths.map(async p => {
		try {
			const content = await requestService.getContent(p);
			return parseHTMLData(p, content);
		} catch (e) {
			return newHTMLDataProvider(p, { version: 1 });
		}
	});

	return Promise.all(providers);
}

function parseHTMLData(id: string, source: string): IHTMLDataProvider {
	let rawData: any;

	try {
		rawData = JSON.parse(source);
	} catch (err) {
		return newHTMLDataProvider(id, { version: 1 });
	}

	return newHTMLDataProvider(id, {
		version: rawData.version || 1,
		tags: rawData.tags || [],
		globalAttributes: rawData.globalAttributes || [],
		valueSets: rawData.valueSets || []
	});
}

