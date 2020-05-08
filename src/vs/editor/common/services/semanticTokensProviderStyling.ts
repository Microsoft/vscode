/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SemanticTokensLegend, TokenMetadata, FontStyle, MetadataConsts, SemanticTokens, LanguageIdentifier } from 'vs/editor/common/modes';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ILogService, LogLevel } from 'vs/platform/log/common/log';
import { MultilineTokens2, SparseEncodedTokens } from 'vs/editor/common/model/tokensStore';

export const enum SemanticTokensProviderStylingConstants {
	NO_STYLING = 0b01111111111111111111111111111111
}

export class SemanticTokensProviderStyling {

	private readonly _hashTable: HashTable;

	constructor(
		private readonly _legend: SemanticTokensLegend,
		private readonly _themeService: IThemeService,
		private readonly _logService: ILogService
	) {
		this._hashTable = new HashTable();
	}

	public getMetadata(tokenTypeIndex: number, tokenModifierSet: number, languageId: LanguageIdentifier): number {
		const entry = this._hashTable.get(tokenTypeIndex, tokenModifierSet, languageId.id);
		let metadata: number;
		if (entry) {
			metadata = entry.metadata;
			if (this._logService.getLevel() === LogLevel.Trace) {
				this._logService.trace(`SemanticTokensProviderStyling [CACHED] ${tokenTypeIndex} / ${tokenModifierSet}: foreground ${TokenMetadata.getForeground(metadata)}, fontStyle ${TokenMetadata.getFontStyle(metadata).toString(2)}`);
			}
		} else {
			let tokenType = this._legend.tokenTypes[tokenTypeIndex];
			const tokenModifiers: string[] = [];
			if (tokenType) {
				let modifierSet = tokenModifierSet;
				for (let modifierIndex = 0; modifierSet > 0 && modifierIndex < this._legend.tokenModifiers.length; modifierIndex++) {
					if (modifierSet & 1) {
						tokenModifiers.push(this._legend.tokenModifiers[modifierIndex]);
					}
					modifierSet = modifierSet >> 1;
				}
				if (modifierSet > 0 && this._logService.getLevel() === LogLevel.Trace) {
					this._logService.trace(`SemanticTokensProviderStyling: unknown token modifier index: ${tokenModifierSet.toString(2)} for legend: ${JSON.stringify(this._legend.tokenModifiers)}`);
					tokenModifiers.push('not-in-legend');
				}

				const tokenStyle = this._themeService.getColorTheme().getTokenStyleMetadata(tokenType, tokenModifiers, languageId.language);
				if (typeof tokenStyle === 'undefined') {
					metadata = SemanticTokensProviderStylingConstants.NO_STYLING;
				} else {
					metadata = 0;
					if (typeof tokenStyle.italic !== 'undefined') {
						const italicBit = (tokenStyle.italic ? FontStyle.Italic : 0) << MetadataConsts.FONT_STYLE_OFFSET;
						metadata |= italicBit | MetadataConsts.SEMANTIC_USE_ITALIC;
					}
					if (typeof tokenStyle.bold !== 'undefined') {
						const boldBit = (tokenStyle.bold ? FontStyle.Bold : 0) << MetadataConsts.FONT_STYLE_OFFSET;
						metadata |= boldBit | MetadataConsts.SEMANTIC_USE_BOLD;
					}
					if (typeof tokenStyle.underline !== 'undefined') {
						const underlineBit = (tokenStyle.underline ? FontStyle.Underline : 0) << MetadataConsts.FONT_STYLE_OFFSET;
						metadata |= underlineBit | MetadataConsts.SEMANTIC_USE_UNDERLINE;
					}
					if (tokenStyle.foreground) {
						const foregroundBits = (tokenStyle.foreground) << MetadataConsts.FOREGROUND_OFFSET;
						metadata |= foregroundBits | MetadataConsts.SEMANTIC_USE_FOREGROUND;
					}
					if (metadata === 0) {
						// Nothing!
						metadata = SemanticTokensProviderStylingConstants.NO_STYLING;
					}
				}
			} else {
				if (this._logService.getLevel() === LogLevel.Trace) {
					this._logService.trace(`SemanticTokensProviderStyling: unknown token type index: ${tokenTypeIndex} for legend: ${JSON.stringify(this._legend.tokenTypes)}`);
				}
				metadata = SemanticTokensProviderStylingConstants.NO_STYLING;
				tokenType = 'not-in-legend';
			}
			this._hashTable.add(tokenTypeIndex, tokenModifierSet, languageId.id, metadata);

			if (this._logService.getLevel() === LogLevel.Trace) {
				this._logService.trace(`SemanticTokensProviderStyling ${tokenTypeIndex} (${tokenType}) / ${tokenModifierSet} (${tokenModifiers.join(' ')}): foreground ${TokenMetadata.getForeground(metadata)}, fontStyle ${TokenMetadata.getFontStyle(metadata).toString(2)}`);
			}
		}

		return metadata;
	}
}

const enum SemanticColoringConstants {
	/**
	 * Let's aim at having 8KB buffers if possible...
	 * So that would be 8192 / (5 * 4) = 409.6 tokens per area
	 */
	DesiredTokensPerArea = 400,

	/**
	 * Try to keep the total number of areas under 1024 if possible,
	 * simply compensate by having more tokens per area...
	 */
	DesiredMaxAreas = 1024,
}

export function toMultilineTokens2(tokens: SemanticTokens, styling: SemanticTokensProviderStyling, languageId: LanguageIdentifier): MultilineTokens2[] {
	const srcData = tokens.data;
	const tokenCount = (tokens.data.length / 5) | 0;
	const tokensPerArea = Math.max(Math.ceil(tokenCount / SemanticColoringConstants.DesiredMaxAreas), SemanticColoringConstants.DesiredTokensPerArea);
	const result: MultilineTokens2[] = [];

	let tokenIndex = 0;
	let lastLineNumber = 1;
	let lastStartCharacter = 0;
	while (tokenIndex < tokenCount) {
		const tokenStartIndex = tokenIndex;
		let tokenEndIndex = Math.min(tokenStartIndex + tokensPerArea, tokenCount);

		// Keep tokens on the same line in the same area...
		if (tokenEndIndex < tokenCount) {

			let smallTokenEndIndex = tokenEndIndex;
			while (smallTokenEndIndex - 1 > tokenStartIndex && srcData[5 * smallTokenEndIndex] === 0) {
				smallTokenEndIndex--;
			}

			if (smallTokenEndIndex - 1 === tokenStartIndex) {
				// there are so many tokens on this line that our area would be empty, we must now go right
				let bigTokenEndIndex = tokenEndIndex;
				while (bigTokenEndIndex + 1 < tokenCount && srcData[5 * bigTokenEndIndex] === 0) {
					bigTokenEndIndex++;
				}
				tokenEndIndex = bigTokenEndIndex;
			} else {
				tokenEndIndex = smallTokenEndIndex;
			}
		}

		let destData = new Uint32Array((tokenEndIndex - tokenStartIndex) * 4);
		let destOffset = 0;
		let areaLine = 0;
		while (tokenIndex < tokenEndIndex) {
			const srcOffset = 5 * tokenIndex;
			const deltaLine = srcData[srcOffset];
			const deltaCharacter = srcData[srcOffset + 1];
			const lineNumber = lastLineNumber + deltaLine;
			const startCharacter = (deltaLine === 0 ? lastStartCharacter + deltaCharacter : deltaCharacter);
			const length = srcData[srcOffset + 2];
			const tokenTypeIndex = srcData[srcOffset + 3];
			const tokenModifierSet = srcData[srcOffset + 4];
			const metadata = styling.getMetadata(tokenTypeIndex, tokenModifierSet, languageId);

			if (metadata !== SemanticTokensProviderStylingConstants.NO_STYLING) {
				if (areaLine === 0) {
					areaLine = lineNumber;
				}
				destData[destOffset] = lineNumber - areaLine;
				destData[destOffset + 1] = startCharacter;
				destData[destOffset + 2] = startCharacter + length;
				destData[destOffset + 3] = metadata;
				destOffset += 4;
			}

			lastLineNumber = lineNumber;
			lastStartCharacter = startCharacter;
			tokenIndex++;
		}

		if (destOffset !== destData.length) {
			destData = destData.subarray(0, destOffset);
		}

		const tokens = new MultilineTokens2(areaLine, new SparseEncodedTokens(destData));
		result.push(tokens);
	}

	return result;
}

class HashTableEntry {
	public readonly tokenTypeIndex: number;
	public readonly tokenModifierSet: number;
	public readonly languageId: number;
	public readonly metadata: number;
	public next: HashTableEntry | null;

	constructor(tokenTypeIndex: number, tokenModifierSet: number, languageId: number, metadata: number) {
		this.tokenTypeIndex = tokenTypeIndex;
		this.tokenModifierSet = tokenModifierSet;
		this.languageId = languageId;
		this.metadata = metadata;
		this.next = null;
	}
}

class HashTable {

	private static _SIZES = [3, 7, 13, 31, 61, 127, 251, 509, 1021, 2039, 4093, 8191, 16381, 32749, 65521, 131071, 262139, 524287, 1048573, 2097143];

	private _elementsCount: number;
	private _currentLengthIndex: number;
	private _currentLength: number;
	private _growCount: number;
	private _elements: (HashTableEntry | null)[];

	constructor() {
		this._elementsCount = 0;
		this._currentLengthIndex = 0;
		this._currentLength = HashTable._SIZES[this._currentLengthIndex];
		this._growCount = Math.round(this._currentLengthIndex + 1 < HashTable._SIZES.length ? 2 / 3 * this._currentLength : 0);
		this._elements = [];
		HashTable._nullOutEntries(this._elements, this._currentLength);
	}

	private static _nullOutEntries(entries: (HashTableEntry | null)[], length: number): void {
		for (let i = 0; i < length; i++) {
			entries[i] = null;
		}
	}

	private _hash2(n1: number, n2: number): number {
		return (((n1 << 5) - n1) + n2) | 0;  // n1 * 31 + n2, keep as int32
	}

	private _hashFunc(tokenTypeIndex: number, tokenModifierSet: number, languageId: number): number {
		return this._hash2(this._hash2(tokenTypeIndex, tokenModifierSet), languageId) % this._currentLength;
	}

	public get(tokenTypeIndex: number, tokenModifierSet: number, languageId: number): HashTableEntry | null {
		const hash = this._hashFunc(tokenTypeIndex, tokenModifierSet, languageId);

		let p = this._elements[hash];
		while (p) {
			if (p.tokenTypeIndex === tokenTypeIndex && p.tokenModifierSet === tokenModifierSet && p.languageId === languageId) {
				return p;
			}
			p = p.next;
		}

		return null;
	}

	public add(tokenTypeIndex: number, tokenModifierSet: number, languageId: number, metadata: number): void {
		this._elementsCount++;
		if (this._growCount !== 0 && this._elementsCount >= this._growCount) {
			// expand!
			const oldElements = this._elements;

			this._currentLengthIndex++;
			this._currentLength = HashTable._SIZES[this._currentLengthIndex];
			this._growCount = Math.round(this._currentLengthIndex + 1 < HashTable._SIZES.length ? 2 / 3 * this._currentLength : 0);
			this._elements = [];
			HashTable._nullOutEntries(this._elements, this._currentLength);

			for (const first of oldElements) {
				let p = first;
				while (p) {
					const oldNext = p.next;
					p.next = null;
					this._add(p);
					p = oldNext;
				}
			}
		}
		this._add(new HashTableEntry(tokenTypeIndex, tokenModifierSet, languageId, metadata));
	}

	private _add(element: HashTableEntry): void {
		const hash = this._hashFunc(element.tokenTypeIndex, element.tokenModifierSet, element.languageId);
		element.next = this._elements[hash];
		this._elements[hash] = element;
	}
}
