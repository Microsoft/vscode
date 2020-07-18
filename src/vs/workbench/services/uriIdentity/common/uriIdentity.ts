/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtUri } from 'vs/base/common/resources';


export const IUriIdentityService = createDecorator<IUriIdentityService>('IUriIdentityService');

export interface IUriIdentityService {

	readonly _serviceBrand: undefined;

	/**
	 * Uri extensions that are aware of casing.
	 */
	readonly extUri: IExtUri;

	/**
	 * Returns a canonical uri for the given resource. Different uris can point to the same
	 * resource. That's because of casing or missing normalization, e.g the following uris
	 * are different but refer to the same document (because windows paths are not case-sensitive)
	 *
	 * ```txt
	 * file:///c:/foo/bar.txt
	 * file:///c:/FOO/BAR.txt
	 * ```
	 *
	 * This function should be invoked when feeding uris into the system that represent the truth,
	 * e.g document uris or marker-to-document associations etc. This function should NOT be called
	 * to pretty print a label nor to sanitize a uri.
	 *
	 * Samples:
	 *
	 * | in | out | |
	 * |---|---|---|
	 * | `file:///foo/bar/../bar` | `file:///foo/bar` | n/a |
	 * | `file:///foo/bar/../bar#frag` | `file:///foo/bar#frag` | keep fragment |
	 * | `file:///foo/BAR` | `file:///foo/bar` | assume ignore case |
	 * | `file:///foo/bar/../BAR?q=2` | `file:///foo/BAR?q=2` | query makes it a different document |
	 */
	asCanonicalUri(uri: URI): URI;
}
