/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAutoClosingPairConditional, IBracketElectricCharacterContribution, StandardAutoClosingPairConditional } from 'vs/editor/common/modes/languageConfiguration';
import { ScopedLineTokens, ignoreBracketsInToken } from 'vs/editor/common/modes/supports';
import { BracketsUtils, RichEditBrackets } from 'vs/editor/common/modes/supports/richEditBrackets';

/**
 * Interface used to support electric characters
 * @internal
 */
export interface IElectricAction {
	// Only one of the following properties should be defined:

	// The line will be indented at the same level of the line
	// which contains the matching given bracket type.
	matchOpenBracket?: string;

	// The text will be appended after the electric character.
	appendText?: string;

	// If the appendText is created as an auto-close text this field
	// contains opening part of auto-close pair.
	matchOpenText?: string;
}

export class BracketElectricCharacterSupport {

	private readonly _richEditBrackets: RichEditBrackets | null;
	private readonly _complexAutoClosePairs: StandardAutoClosingPairConditional[];

	constructor(richEditBrackets: RichEditBrackets | null, autoClosePairs: IAutoClosingPairConditional[], contribution: IBracketElectricCharacterContribution | null | undefined) {
		contribution = contribution || {};
		this._richEditBrackets = richEditBrackets;
		this._complexAutoClosePairs = autoClosePairs.filter(pair => pair.open.length > 1 && !!pair.close).map(el => new StandardAutoClosingPairConditional(el));
		if (contribution.docComment) {
			// IDocComment is legacy, only partially supported
			this._complexAutoClosePairs.push(new StandardAutoClosingPairConditional({ open: contribution.docComment.open, close: contribution.docComment.close || '' }));
		}
	}

	public getElectricCharacters(): string[] {
		let result: string[] = [];

		if (this._richEditBrackets) {
			for (let i = 0, len = this._richEditBrackets.brackets.length; i < len; i++) {
				let bracketPair = this._richEditBrackets.brackets[i];
				let lastChar = bracketPair.close.charAt(bracketPair.close.length - 1);
				result.push(lastChar);
			}
		}

		// auto close
		for (let pair of this._complexAutoClosePairs) {
			result.push(pair.open.charAt(pair.open.length - 1));
		}

		// Filter duplicate entries
		result = result.filter((item, pos, array) => {
			return array.indexOf(item) === pos;
		});

		return result;
	}

	public onElectricCharacter(character: string, context: ScopedLineTokens, column: number): IElectricAction | null {
		return (this._onElectricAutoClose(character, context, column) ||
			this._onElectricAutoIndent(character, context, column));
	}

	private _onElectricAutoIndent(character: string, context: ScopedLineTokens, column: number): IElectricAction | null {

		if (!this._richEditBrackets || this._richEditBrackets.brackets.length === 0) {
			return null;
		}

		let tokenIndex = context.findTokenIndexAtOffset(column - 1);
		if (ignoreBracketsInToken(context.getStandardTokenType(tokenIndex))) {
			return null;
		}

		let reversedBracketRegex = this._richEditBrackets.reversedRegex;
		let text = context.getLineContent().substring(0, column - 1) + character;

		let r = BracketsUtils.findPrevBracketInToken(reversedBracketRegex, 1, text, 0, text.length);
		if (!r) {
			return null;
		}

		let bracketText = text.substring(r.startColumn - 1, r.endColumn - 1);
		bracketText = bracketText.toLowerCase();

		let isOpen = this._richEditBrackets.textIsOpenBracket[bracketText];
		if (isOpen) {
			return null;
		}

		let textBeforeBracket = text.substring(0, r.startColumn - 1);
		if (!/^\s*$/.test(textBeforeBracket)) {
			// There is other text on the line before the bracket
			return null;
		}

		return {
			matchOpenBracket: bracketText
		};
	}

	private _onElectricAutoClose(character: string, context: ScopedLineTokens, column: number): IElectricAction | null {
		if (!this._complexAutoClosePairs.length) {
			return null;
		}

		let line = context.getLineContent();

		for (let i = 0, len = this._complexAutoClosePairs.length; i < len; i++) {
			let pair = this._complexAutoClosePairs[i];

			// See if the right electric character was pressed
			if (character !== pair.open.charAt(pair.open.length - 1)) {
				continue;
			}

			// check if the full open bracket matches
			let start = column - pair.open.length + 1;
			let actual = line.substring(start - 1, column - 1) + character;
			if (actual !== pair.open) {
				continue;
			}

			let lastTokenIndex = context.findTokenIndexAtOffset(column - 1);
			let lastTokenStandardType = context.getStandardTokenType(lastTokenIndex);
			// If we're in a scope listed in 'notIn', do nothing
			if (!pair.isOK(lastTokenStandardType)) {
				continue;
			}

			// If this line already contains the closing tag, do nothing.
			if (line.indexOf(pair.close, column - 1) >= 0) {
				continue;
			}

			return {
				matchOpenText: pair.open,
				appendText: pair.close
			};
		}

		return null;
	}
}
