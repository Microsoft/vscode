/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Token, TokenizationResult, TokenizationResult2 } from 'vs/editor/common/core/token';
import { ColorId, FontStyle, IState, LanguageId, LanguageIdentifier, MetadataConsts, StandardTokenType } from 'vs/editor/common/modes';

class NullStateImpl implements IState {

	public clone(): IState {
		return this;
	}

	public equals(other: IState): boolean {
		return (this === other);
	}
}

export const NULL_STATE: IState = new NullStateImpl();

export const NULL_MODE_ID = 'vs.editor.nullMode';

export const NULL_LANGUAGE_IDENTIFIER = new LanguageIdentifier(NULL_MODE_ID, LanguageId.Null);

export function nullTokenize(modeId: string, buffer: string, state: IState, deltaOffset: number): TokenizationResult {
	return new TokenizationResult([new Token(deltaOffset, '', modeId)], state);
}

export function nullTokenize2(languageId: LanguageId, buffer: string, state: IState | null, deltaOffset: number): TokenizationResult2 {
	let tokens = new Uint32Array(2);
	tokens[0] = deltaOffset;
	tokens[1] = (
		(languageId << MetadataConsts.LANGUAGEID_OFFSET)
		| (StandardTokenType.Other << MetadataConsts.TOKEN_TYPE_OFFSET)
		| (FontStyle.None << MetadataConsts.FONT_STYLE_OFFSET)
		| (ColorId.DefaultForeground << MetadataConsts.FOREGROUND_OFFSET)
		| (ColorId.DefaultBackground << MetadataConsts.BACKGROUND_OFFSET)
	) >>> 0;

	return new TokenizationResult2(tokens, state === null ? NULL_STATE : state);
}
