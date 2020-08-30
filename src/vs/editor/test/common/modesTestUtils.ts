/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LineTokens } from 'vs/editor/common/core/lineTokens';
import { MetadataConsts, StandardTokenType } from 'vs/editor/common/modes';
import { ScopedLineTokens, createScopedLineTokens } from 'vs/editor/common/modes/supports';

export interface TokenText {
	text: string;
	type: StandardTokenType;
}

export function createFakeScopedLineTokens(rawTokens: TokenText[]): ScopedLineTokens {
	let tokens = new Uint32Array(rawTokens.length << 1);
	let line = '';

	for (let i = 0, len = rawTokens.length; i < len; i++) {
		let rawToken = rawTokens[i];

		let startOffset = line.length;
		let metadata = (
			(rawToken.type << MetadataConsts.TOKEN_TYPE_OFFSET)
		) >>> 0;

		tokens[(i << 1)] = startOffset;
		tokens[(i << 1) + 1] = metadata;
		line += rawToken.text;
	}

	LineTokens.convertToEndOffset(tokens, line.length);
	return createScopedLineTokens(new LineTokens(tokens, line), 0);
}
