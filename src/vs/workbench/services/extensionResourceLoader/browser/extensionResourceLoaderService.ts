/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';
import * as dom from 'vs/base/browser/dom';
import { Schemas } from 'vs/base/common/network';

class ExtensionResourceLoaderService implements IExtensionResourceLoaderService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService
	) { }

	async readExtensionResource(uri: URI): Promise<string> {
		uri = dom.asDomUri(uri);

		if (uri.scheme !== Schemas.http && uri.scheme !== Schemas.https) {
			const result = await this._fileService.readFile(uri);
			return result.value.toString();
		}

		const response = await fetch(uri.toString(true));
		if (response.status !== 200) {
			throw new Error(response.statusText);
		}
		return response.text();

	}
}

registerSingleton(IExtensionResourceLoaderService, ExtensionResourceLoaderService);
