/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';

export function getPathFromAmdModule(requirefn: typeof require, relativePath: string): string {
	return getUriFromAmdModule(requirefn, relativePath).fsPath;
}

export function getUriFromAmdModule(requirefn: typeof require, relativePath: string): URI {
	return URI.parse(requirefn.toUrl(relativePath));
}
