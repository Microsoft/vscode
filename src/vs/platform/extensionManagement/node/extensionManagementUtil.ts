/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { buffer } from 'vs/base/node/zip';
import { localize } from 'vs/nls';
import { IExtensionManifest } from 'vs/platform/extensions/common/extensions';

export function getManifest(vsix: string): Promise<IExtensionManifest> {
	return buffer(vsix, 'extension/package.json')
		.then(buffer => {
			try {
				return JSON.parse(buffer.toString('utf8'));
			} catch (err) {
				throw new Error(localize('invalidManifest', "VSIX invalid: package.json is not a JSON file."));
			}
		});
}
