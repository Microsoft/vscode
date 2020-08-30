/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColorId, LanguageId, StandardTokenType, TokenMetadata } from 'vs/editor/common/modes';

export interface IViewLineTokens {
	equals(other: IViewLineTokens): boolean;
	getCount(): number;
	getForeground(tokenIndex: number): ColorId;
	getEndOffset(tokenIndex: number): number;
	getClassName(tokenIndex: number): string;
	getInlineStyle(tokenIndex: number, colorMap: string[]): string;
	findTokenIndexAtOffset(offset: number): number;
}

export class LineTokens implements IViewLineTokens {
	_lineTokensBrand: void;

	private readonly _tokens: Uint32Array;
	private readonly _tokensCount: number;
	private readonly _text: string;

	constructor(tokens: Uint32Array, text: string) {
		this._tokens = tokens;
		this._tokensCount = (this._tokens.length >>> 1);
		this._text = text;
	}

	public equals(other: IViewLineTokens): boolean {
		if (other instanceof LineTokens) {
			return this.slicedEquals(other, 0, this._tokensCount);
		}
		return false;
	}

	public slicedEquals(other: LineTokens, sliceFromTokenIndex: number, sliceTokenCount: number): boolean {
		if (this._text !== other._text) {
			return false;
		}
		if (this._tokensCount !== other._tokensCount) {
			return false;
		}
		const from = (sliceFromTokenIndex << 1);
		const to = from + (sliceTokenCount << 1);
		for (let i = from; i < to; i++) {
			if (this._tokens[i] !== other._tokens[i]) {
				return false;
			}
		}
		return true;
	}

	public getLineContent(): string {
		return this._text;
	}

	public getCount(): number {
		return this._tokensCount;
	}

	public getStartOffset(tokenIndex: number): number {
		if (tokenIndex > 0) {
			return this._tokens[(tokenIndex - 1) << 1];
		}
		return 0;
	}

	public getMetadata(tokenIndex: number): number {
		const metadata = this._tokens[(tokenIndex << 1) + 1];
		return metadata;
	}

	public getLanguageId(tokenIndex: number): LanguageId {
		const metadata = this._tokens[(tokenIndex << 1) + 1];
		return TokenMetadata.getLanguageId(metadata);
	}

	public getStandardTokenType(tokenIndex: number): StandardTokenType {
		const metadata = this._tokens[(tokenIndex << 1) + 1];
		return TokenMetadata.getTokenType(metadata);
	}

	public getForeground(tokenIndex: number): ColorId {
		const metadata = this._tokens[(tokenIndex << 1) + 1];
		return TokenMetadata.getForeground(metadata);
	}

	public getClassName(tokenIndex: number): string {
		const metadata = this._tokens[(tokenIndex << 1) + 1];
		return TokenMetadata.getClassNameFromMetadata(metadata);
	}

	public getInlineStyle(tokenIndex: number, colorMap: string[]): string {
		const metadata = this._tokens[(tokenIndex << 1) + 1];
		return TokenMetadata.getInlineStyleFromMetadata(metadata, colorMap);
	}

	public getEndOffset(tokenIndex: number): number {
		return this._tokens[tokenIndex << 1];
	}

	/**
	 * Find the token containing offset `offset`.
	 * @param offset The search offset
	 * @return The index of the token containing the offset.
	 */
	public findTokenIndexAtOffset(offset: number): number {
		return LineTokens.findIndexInTokensArray(this._tokens, offset);
	}

	public inflate(): IViewLineTokens {
		return this;
	}

	public sliceAndInflate(startOffset: number, endOffset: number, deltaOffset: number): IViewLineTokens {
		return new SlicedLineTokens(this, startOffset, endOffset, deltaOffset);
	}

	public static convertToEndOffset(tokens: Uint32Array, lineTextLength: number): void {
		const tokenCount = (tokens.length >>> 1);
		const lastTokenIndex = tokenCount - 1;
		for (let tokenIndex = 0; tokenIndex < lastTokenIndex; tokenIndex++) {
			tokens[tokenIndex << 1] = tokens[(tokenIndex + 1) << 1];
		}
		tokens[lastTokenIndex << 1] = lineTextLength;
	}

	public static findIndexInTokensArray(tokens: Uint32Array, desiredIndex: number): number {
		if (tokens.length <= 2) {
			return 0;
		}

		let low = 0;
		let high = (tokens.length >>> 1) - 1;

		while (low < high) {

			const mid = low + Math.floor((high - low) / 2);
			const endOffset = tokens[(mid << 1)];

			if (endOffset === desiredIndex) {
				return mid + 1;
			} else if (endOffset < desiredIndex) {
				low = mid + 1;
			} else if (endOffset > desiredIndex) {
				high = mid;
			}
		}

		return low;
	}
}

export class SlicedLineTokens implements IViewLineTokens {

	private readonly _source: LineTokens;
	private readonly _startOffset: number;
	private readonly _endOffset: number;
	private readonly _deltaOffset: number;

	private readonly _firstTokenIndex: number;
	private readonly _tokensCount: number;

	constructor(source: LineTokens, startOffset: number, endOffset: number, deltaOffset: number) {
		this._source = source;
		this._startOffset = startOffset;
		this._endOffset = endOffset;
		this._deltaOffset = deltaOffset;
		this._firstTokenIndex = source.findTokenIndexAtOffset(startOffset);

		this._tokensCount = 0;
		for (let i = this._firstTokenIndex, len = source.getCount(); i < len; i++) {
			const tokenStartOffset = source.getStartOffset(i);
			if (tokenStartOffset >= endOffset) {
				break;
			}
			this._tokensCount++;
		}
	}

	public equals(other: IViewLineTokens): boolean {
		if (other instanceof SlicedLineTokens) {
			return (
				this._startOffset === other._startOffset
				&& this._endOffset === other._endOffset
				&& this._deltaOffset === other._deltaOffset
				&& this._source.slicedEquals(other._source, this._firstTokenIndex, this._tokensCount)
			);
		}
		return false;
	}

	public getCount(): number {
		return this._tokensCount;
	}

	public getForeground(tokenIndex: number): ColorId {
		return this._source.getForeground(this._firstTokenIndex + tokenIndex);
	}

	public getEndOffset(tokenIndex: number): number {
		const tokenEndOffset = this._source.getEndOffset(this._firstTokenIndex + tokenIndex);
		return Math.min(this._endOffset, tokenEndOffset) - this._startOffset + this._deltaOffset;
	}

	public getClassName(tokenIndex: number): string {
		return this._source.getClassName(this._firstTokenIndex + tokenIndex);
	}

	public getInlineStyle(tokenIndex: number, colorMap: string[]): string {
		return this._source.getInlineStyle(this._firstTokenIndex + tokenIndex, colorMap);
	}

	public findTokenIndexAtOffset(offset: number): number {
		return this._source.findTokenIndexAtOffset(offset + this._startOffset - this._deltaOffset) - this._firstTokenIndex;
	}
}
