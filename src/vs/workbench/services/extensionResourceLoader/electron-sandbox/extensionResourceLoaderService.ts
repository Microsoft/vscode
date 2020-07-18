/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IFileService } from 'vs/platform/files/common/files';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';

export class ExtensionResourceLoaderService implements IExtensionResourceLoaderService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService
	) { }

	async readExtensionResource(uri: URI): Promise<string> {
		const result = await this._fileService.readFile(uri);
		return result.value.toString();
	}
}

registerSingleton(IExtensionResourceLoaderService, ExtensionResourceLoaderService);
