/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IState } from 'vs/editor/common/modes';

export class Token {
	_tokenBrand: void;

	public readonly offset: number;
	public readonly type: string;
	public readonly language: string;

	constructor(offset: number, type: string, language: string) {
		this.offset = offset | 0;// @perf
		this.type = type;
		this.language = language;
	}

	public toString(): string {
		return '(' + this.offset + ', ' + this.type + ')';
	}
}

export class TokenizationResult {
	_tokenizationResultBrand: void;

	public readonly tokens: Token[];
	public readonly endState: IState;

	constructor(tokens: Token[], endState: IState) {
		this.tokens = tokens;
		this.endState = endState;
	}
}

export class TokenizationResult2 {
	_tokenizationResult2Brand: void;

	/**
	 * The tokens in binary format. Each token occupies two array indices. For token i:
	 *  - at offset 2*i => startIndex
	 *  - at offset 2*i + 1 => metadata
	 *
	 */
	public readonly tokens: Uint32Array;
	public readonly endState: IState;

	constructor(tokens: Uint32Array, endState: IState) {
		this.tokens = tokens;
		this.endState = endState;
	}
}
