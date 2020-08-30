/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LineTokens } from 'vs/editor/common/core/lineTokens';
import * as modes from 'vs/editor/common/modes';

export function createScopedLineTokens(context: LineTokens, offset: number): ScopedLineTokens {
	let tokenCount = context.getCount();
	let tokenIndex = context.findTokenIndexAtOffset(offset);
	let desiredLanguageId = context.getLanguageId(tokenIndex);

	let lastTokenIndex = tokenIndex;
	while (lastTokenIndex + 1 < tokenCount && context.getLanguageId(lastTokenIndex + 1) === desiredLanguageId) {
		lastTokenIndex++;
	}

	let firstTokenIndex = tokenIndex;
	while (firstTokenIndex > 0 && context.getLanguageId(firstTokenIndex - 1) === desiredLanguageId) {
		firstTokenIndex--;
	}

	return new ScopedLineTokens(
		context,
		desiredLanguageId,
		firstTokenIndex,
		lastTokenIndex + 1,
		context.getStartOffset(firstTokenIndex),
		context.getEndOffset(lastTokenIndex)
	);
}

export class ScopedLineTokens {
	_scopedLineTokensBrand: void;

	public readonly languageId: modes.LanguageId;
	private readonly _actual: LineTokens;
	private readonly _firstTokenIndex: number;
	private readonly _lastTokenIndex: number;
	public readonly firstCharOffset: number;
	private readonly _lastCharOffset: number;

	constructor(
		actual: LineTokens,
		languageId: modes.LanguageId,
		firstTokenIndex: number,
		lastTokenIndex: number,
		firstCharOffset: number,
		lastCharOffset: number
	) {
		this._actual = actual;
		this.languageId = languageId;
		this._firstTokenIndex = firstTokenIndex;
		this._lastTokenIndex = lastTokenIndex;
		this.firstCharOffset = firstCharOffset;
		this._lastCharOffset = lastCharOffset;
	}

	public getLineContent(): string {
		const actualLineContent = this._actual.getLineContent();
		return actualLineContent.substring(this.firstCharOffset, this._lastCharOffset);
	}

	public getActualLineContentBefore(offset: number): string {
		const actualLineContent = this._actual.getLineContent();
		return actualLineContent.substring(0, this.firstCharOffset + offset);
	}

	public getTokenCount(): number {
		return this._lastTokenIndex - this._firstTokenIndex;
	}

	public findTokenIndexAtOffset(offset: number): number {
		return this._actual.findTokenIndexAtOffset(offset + this.firstCharOffset) - this._firstTokenIndex;
	}

	public getStandardTokenType(tokenIndex: number): modes.StandardTokenType {
		return this._actual.getStandardTokenType(tokenIndex + this._firstTokenIndex);
	}
}

const enum IgnoreBracketsInTokens {
	value = modes.StandardTokenType.Comment | modes.StandardTokenType.String | modes.StandardTokenType.RegEx
}

export function ignoreBracketsInToken(standardTokenType: modes.StandardTokenType): boolean {
	return (standardTokenType & IgnoreBracketsInTokens.value) !== 0;
}
