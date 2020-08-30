/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cloneAndChange } from 'vs/base/common/objects';
import { IExtensionManifest } from 'vs/platform/extensions/common/extensions';

const nlsRegex = /^%([\w\d.-]+)%$/i;

export interface ITranslations {
	[key: string]: string;
}

export function localizeManifest(manifest: IExtensionManifest, translations: ITranslations): IExtensionManifest {
	const patcher = (value: string) => {
		if (typeof value !== 'string') {
			return undefined;
		}

		const match = nlsRegex.exec(value);

		if (!match) {
			return undefined;
		}

		return translations[match[1]] || value;
	};

	return cloneAndChange(manifest, patcher);
}
