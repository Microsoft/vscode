/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAutoClosingPair, StandardAutoClosingPairConditional, LanguageConfiguration } from 'vs/editor/common/modes/languageConfiguration';
import { ScopedLineTokens } from 'vs/editor/common/modes/supports';

export class CharacterPairSupport {

	static readonly DEFAULT_AUTOCLOSE_BEFORE_LANGUAGE_DEFINED = ';:.,=}])> \n\t';
	static readonly DEFAULT_AUTOCLOSE_BEFORE_WHITESPACE = ' \n\t';

	private readonly _autoClosingPairs: StandardAutoClosingPairConditional[];
	private readonly _surroundingPairs: IAutoClosingPair[];
	private readonly _autoCloseBefore: string;

	constructor(config: LanguageConfiguration) {
		if (config.autoClosingPairs) {
			this._autoClosingPairs = config.autoClosingPairs.map(el => new StandardAutoClosingPairConditional(el));
		} else if (config.brackets) {
			this._autoClosingPairs = config.brackets.map(b => new StandardAutoClosingPairConditional({ open: b[0], close: b[1] }));
		} else {
			this._autoClosingPairs = [];
		}

		if (config.__electricCharacterSupport && config.__electricCharacterSupport.docComment) {
			const docComment = config.__electricCharacterSupport.docComment;
			// IDocComment is legacy, only partially supported
			this._autoClosingPairs.push(new StandardAutoClosingPairConditional({ open: docComment.open, close: docComment.close || '' }));
		}

		this._autoCloseBefore = typeof config.autoCloseBefore === 'string' ? config.autoCloseBefore : CharacterPairSupport.DEFAULT_AUTOCLOSE_BEFORE_LANGUAGE_DEFINED;

		this._surroundingPairs = config.surroundingPairs || this._autoClosingPairs;
	}

	public getAutoClosingPairs(): StandardAutoClosingPairConditional[] {
		return this._autoClosingPairs;
	}

	public getAutoCloseBeforeSet(): string {
		return this._autoCloseBefore;
	}

	public static shouldAutoClosePair(autoClosingPair: StandardAutoClosingPairConditional, context: ScopedLineTokens, column: number): boolean {
		// Always complete on empty line
		if (context.getTokenCount() === 0) {
			return true;
		}

		const tokenIndex = context.findTokenIndexAtOffset(column - 2);
		const standardTokenType = context.getStandardTokenType(tokenIndex);
		return autoClosingPair.isOK(standardTokenType);
	}

	public getSurroundingPairs(): IAutoClosingPair[] {
		return this._surroundingPairs;
	}
}
