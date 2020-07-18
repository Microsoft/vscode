/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function insane(
	html: string,
	options?: {
		readonly allowedSchemes?: readonly string[],
		readonly allowedTags?: readonly string[],
		readonly allowedAttributes?: { readonly [key: string]: string[] },
		readonly filter?: (token: { tag: string, attrs: { readonly [key: string]: string } }) => boolean,
	},
	strict?: boolean,
): string;
