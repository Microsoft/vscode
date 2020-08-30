/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewLineTokens } from 'vs/editor/common/core/lineTokens';
import { ColorId, TokenMetadata } from 'vs/editor/common/modes';

/**
 * A token on a line.
 */
export class ViewLineToken {
	_viewLineTokenBrand: void;

	/**
	 * last char index of this token (not inclusive).
	 */
	public readonly endIndex: number;
	private readonly _metadata: number;

	constructor(endIndex: number, metadata: number) {
		this.endIndex = endIndex;
		this._metadata = metadata;
	}

	public getForeground(): ColorId {
		return TokenMetadata.getForeground(this._metadata);
	}

	public getType(): string {
		return TokenMetadata.getClassNameFromMetadata(this._metadata);
	}

	public getInlineStyle(colorMap: string[]): string {
		return TokenMetadata.getInlineStyleFromMetadata(this._metadata, colorMap);
	}

	private static _equals(a: ViewLineToken, b: ViewLineToken): boolean {
		return (
			a.endIndex === b.endIndex
			&& a._metadata === b._metadata
		);
	}

	public static equalsArr(a: ViewLineToken[], b: ViewLineToken[]): boolean {
		const aLen = a.length;
		const bLen = b.length;
		if (aLen !== bLen) {
			return false;
		}
		for (let i = 0; i < aLen; i++) {
			if (!this._equals(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}
}

export class ViewLineTokens implements IViewLineTokens {

	private readonly _actual: ViewLineToken[];

	constructor(actual: ViewLineToken[]) {
		this._actual = actual;
	}

	public equals(other: IViewLineTokens): boolean {
		if (other instanceof ViewLineTokens) {
			return ViewLineToken.equalsArr(this._actual, other._actual);
		}
		return false;
	}

	public getCount(): number {
		return this._actual.length;
	}

	public getForeground(tokenIndex: number): ColorId {
		return this._actual[tokenIndex].getForeground();
	}

	public getEndOffset(tokenIndex: number): number {
		return this._actual[tokenIndex].endIndex;
	}

	public getClassName(tokenIndex: number): string {
		return this._actual[tokenIndex].getType();
	}

	public getInlineStyle(tokenIndex: number, colorMap: string[]): string {
		return this._actual[tokenIndex].getInlineStyle(colorMap);
	}

	public findTokenIndexAtOffset(offset: number): number {
		throw new Error('Not implemented');
	}
}

export class ViewLineTokenFactory {

	public static inflateArr(tokens: Uint32Array): ViewLineToken[] {
		const tokensCount = (tokens.length >>> 1);

		let result: ViewLineToken[] = new Array<ViewLineToken>(tokensCount);
		for (let i = 0; i < tokensCount; i++) {
			const endOffset = tokens[i << 1];
			const metadata = tokens[(i << 1) + 1];

			result[i] = new ViewLineToken(endOffset, metadata);
		}

		return result;
	}

}
