/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import * as strings from 'vs/base/common/strings';
import { IViewLineTokens } from 'vs/editor/common/core/lineTokens';
import { IStringBuilder, createStringBuilder } from 'vs/editor/common/core/stringBuilder';
import { LineDecoration, LineDecorationsNormalizer } from 'vs/editor/common/viewLayout/lineDecorations';
import { InlineDecorationType } from 'vs/editor/common/viewModel/viewModel';

export const enum RenderWhitespace {
	None = 0,
	Boundary = 1,
	Selection = 2,
	Trailing = 3,
	All = 4
}

export const enum LinePartMetadata {
	IS_WHITESPACE = 1,
	PSEUDO_BEFORE = 2,
	PSEUDO_AFTER = 4,

	IS_WHITESPACE_MASK = 0b001,
	PSEUDO_BEFORE_MASK = 0b010,
	PSEUDO_AFTER_MASK = 0b100,
}

class LinePart {
	_linePartBrand: void;

	/**
	 * last char index of this token (not inclusive).
	 */
	public readonly endIndex: number;
	public readonly type: string;
	public readonly metadata: number;

	constructor(endIndex: number, type: string, metadata: number) {
		this.endIndex = endIndex;
		this.type = type;
		this.metadata = metadata;
	}

	public isWhitespace(): boolean {
		return (this.metadata & LinePartMetadata.IS_WHITESPACE_MASK ? true : false);
	}
}

export class LineRange {
	/**
	 * Zero-based offset on which the range starts, inclusive.
	 */
	public readonly startOffset: number;

	/**
	 * Zero-based offset on which the range ends, inclusive.
	 */
	public readonly endOffset: number;

	constructor(startIndex: number, endIndex: number) {
		this.startOffset = startIndex;
		this.endOffset = endIndex;
	}

	public equals(otherLineRange: LineRange) {
		return this.startOffset === otherLineRange.startOffset
			&& this.endOffset === otherLineRange.endOffset;
	}
}

export class RenderLineInput {

	public readonly useMonospaceOptimizations: boolean;
	public readonly canUseHalfwidthRightwardsArrow: boolean;
	public readonly lineContent: string;
	public readonly continuesWithWrappedLine: boolean;
	public readonly isBasicASCII: boolean;
	public readonly containsRTL: boolean;
	public readonly fauxIndentLength: number;
	public readonly lineTokens: IViewLineTokens;
	public readonly lineDecorations: LineDecoration[];
	public readonly tabSize: number;
	public readonly startVisibleColumn: number;
	public readonly spaceWidth: number;
	public readonly renderSpaceWidth: number;
	public readonly renderSpaceCharCode: number;
	public readonly stopRenderingLineAfter: number;
	public readonly renderWhitespace: RenderWhitespace;
	public readonly renderControlCharacters: boolean;
	public readonly fontLigatures: boolean;

	/**
	 * Defined only when renderWhitespace is 'selection'. Selections are non-overlapping,
	 * and ordered by position within the line.
	 */
	public readonly selectionsOnLine: LineRange[] | null;

	constructor(
		useMonospaceOptimizations: boolean,
		canUseHalfwidthRightwardsArrow: boolean,
		lineContent: string,
		continuesWithWrappedLine: boolean,
		isBasicASCII: boolean,
		containsRTL: boolean,
		fauxIndentLength: number,
		lineTokens: IViewLineTokens,
		lineDecorations: LineDecoration[],
		tabSize: number,
		startVisibleColumn: number,
		spaceWidth: number,
		middotWidth: number,
		wsmiddotWidth: number,
		stopRenderingLineAfter: number,
		renderWhitespace: 'none' | 'boundary' | 'selection' | 'trailing' | 'all',
		renderControlCharacters: boolean,
		fontLigatures: boolean,
		selectionsOnLine: LineRange[] | null
	) {
		this.useMonospaceOptimizations = useMonospaceOptimizations;
		this.canUseHalfwidthRightwardsArrow = canUseHalfwidthRightwardsArrow;
		this.lineContent = lineContent;
		this.continuesWithWrappedLine = continuesWithWrappedLine;
		this.isBasicASCII = isBasicASCII;
		this.containsRTL = containsRTL;
		this.fauxIndentLength = fauxIndentLength;
		this.lineTokens = lineTokens;
		this.lineDecorations = lineDecorations.sort(LineDecoration.compare);
		this.tabSize = tabSize;
		this.startVisibleColumn = startVisibleColumn;
		this.spaceWidth = spaceWidth;
		this.stopRenderingLineAfter = stopRenderingLineAfter;
		this.renderWhitespace = (
			renderWhitespace === 'all'
				? RenderWhitespace.All
				: renderWhitespace === 'boundary'
					? RenderWhitespace.Boundary
					: renderWhitespace === 'selection'
						? RenderWhitespace.Selection
						: renderWhitespace === 'trailing'
							? RenderWhitespace.Trailing
							: RenderWhitespace.None
		);
		this.renderControlCharacters = renderControlCharacters;
		this.fontLigatures = fontLigatures;
		this.selectionsOnLine = selectionsOnLine && selectionsOnLine.sort((a, b) => a.startOffset < b.startOffset ? -1 : 1);

		const wsmiddotDiff = Math.abs(wsmiddotWidth - spaceWidth);
		const middotDiff = Math.abs(middotWidth - spaceWidth);
		if (wsmiddotDiff < middotDiff) {
			this.renderSpaceWidth = wsmiddotWidth;
			this.renderSpaceCharCode = 0x2E31; // U+2E31 - WORD SEPARATOR MIDDLE DOT
		} else {
			this.renderSpaceWidth = middotWidth;
			this.renderSpaceCharCode = 0xB7; // U+00B7 - MIDDLE DOT
		}
	}

	private sameSelection(otherSelections: LineRange[] | null): boolean {
		if (this.selectionsOnLine === null) {
			return otherSelections === null;
		}

		if (otherSelections === null) {
			return false;
		}

		if (otherSelections.length !== this.selectionsOnLine.length) {
			return false;
		}

		for (let i = 0; i < this.selectionsOnLine.length; i++) {
			if (!this.selectionsOnLine[i].equals(otherSelections[i])) {
				return false;
			}
		}

		return true;
	}

	public equals(other: RenderLineInput): boolean {
		return (
			this.useMonospaceOptimizations === other.useMonospaceOptimizations
			&& this.canUseHalfwidthRightwardsArrow === other.canUseHalfwidthRightwardsArrow
			&& this.lineContent === other.lineContent
			&& this.continuesWithWrappedLine === other.continuesWithWrappedLine
			&& this.isBasicASCII === other.isBasicASCII
			&& this.containsRTL === other.containsRTL
			&& this.fauxIndentLength === other.fauxIndentLength
			&& this.tabSize === other.tabSize
			&& this.startVisibleColumn === other.startVisibleColumn
			&& this.spaceWidth === other.spaceWidth
			&& this.renderSpaceWidth === other.renderSpaceWidth
			&& this.renderSpaceCharCode === other.renderSpaceCharCode
			&& this.stopRenderingLineAfter === other.stopRenderingLineAfter
			&& this.renderWhitespace === other.renderWhitespace
			&& this.renderControlCharacters === other.renderControlCharacters
			&& this.fontLigatures === other.fontLigatures
			&& LineDecoration.equalsArr(this.lineDecorations, other.lineDecorations)
			&& this.lineTokens.equals(other.lineTokens)
			&& this.sameSelection(other.selectionsOnLine)
		);
	}
}

export const enum CharacterMappingConstants {
	PART_INDEX_MASK = 0b11111111111111110000000000000000,
	CHAR_INDEX_MASK = 0b00000000000000001111111111111111,

	CHAR_INDEX_OFFSET = 0,
	PART_INDEX_OFFSET = 16
}

/**
 * Provides a both direction mapping between a line's character and its rendered position.
 */
export class CharacterMapping {

	public static getPartIndex(partData: number): number {
		return (partData & CharacterMappingConstants.PART_INDEX_MASK) >>> CharacterMappingConstants.PART_INDEX_OFFSET;
	}

	public static getCharIndex(partData: number): number {
		return (partData & CharacterMappingConstants.CHAR_INDEX_MASK) >>> CharacterMappingConstants.CHAR_INDEX_OFFSET;
	}

	public readonly length: number;
	private readonly _data: Uint32Array;
	private readonly _absoluteOffsets: Uint32Array;

	constructor(length: number, partCount: number) {
		this.length = length;
		this._data = new Uint32Array(this.length);
		this._absoluteOffsets = new Uint32Array(this.length);
	}

	public setPartData(charOffset: number, partIndex: number, charIndex: number, partAbsoluteOffset: number): void {
		let partData = (
			(partIndex << CharacterMappingConstants.PART_INDEX_OFFSET)
			| (charIndex << CharacterMappingConstants.CHAR_INDEX_OFFSET)
		) >>> 0;
		this._data[charOffset] = partData;
		this._absoluteOffsets[charOffset] = partAbsoluteOffset + charIndex;
	}

	public getAbsoluteOffsets(): Uint32Array {
		return this._absoluteOffsets;
	}

	public charOffsetToPartData(charOffset: number): number {
		if (this.length === 0) {
			return 0;
		}
		if (charOffset < 0) {
			return this._data[0];
		}
		if (charOffset >= this.length) {
			return this._data[this.length - 1];
		}
		return this._data[charOffset];
	}

	public partDataToCharOffset(partIndex: number, partLength: number, charIndex: number): number {
		if (this.length === 0) {
			return 0;
		}

		let searchEntry = (
			(partIndex << CharacterMappingConstants.PART_INDEX_OFFSET)
			| (charIndex << CharacterMappingConstants.CHAR_INDEX_OFFSET)
		) >>> 0;

		let min = 0;
		let max = this.length - 1;
		while (min + 1 < max) {
			let mid = ((min + max) >>> 1);
			let midEntry = this._data[mid];
			if (midEntry === searchEntry) {
				return mid;
			} else if (midEntry > searchEntry) {
				max = mid;
			} else {
				min = mid;
			}
		}

		if (min === max) {
			return min;
		}

		let minEntry = this._data[min];
		let maxEntry = this._data[max];

		if (minEntry === searchEntry) {
			return min;
		}
		if (maxEntry === searchEntry) {
			return max;
		}

		let minPartIndex = CharacterMapping.getPartIndex(minEntry);
		let minCharIndex = CharacterMapping.getCharIndex(minEntry);

		let maxPartIndex = CharacterMapping.getPartIndex(maxEntry);
		let maxCharIndex: number;

		if (minPartIndex !== maxPartIndex) {
			// sitting between parts
			maxCharIndex = partLength;
		} else {
			maxCharIndex = CharacterMapping.getCharIndex(maxEntry);
		}

		let minEntryDistance = charIndex - minCharIndex;
		let maxEntryDistance = maxCharIndex - charIndex;

		if (minEntryDistance <= maxEntryDistance) {
			return min;
		}
		return max;
	}
}

export const enum ForeignElementType {
	None = 0,
	Before = 1,
	After = 2
}

export class RenderLineOutput {
	_renderLineOutputBrand: void;

	readonly characterMapping: CharacterMapping;
	readonly containsRTL: boolean;
	readonly containsForeignElements: ForeignElementType;

	constructor(characterMapping: CharacterMapping, containsRTL: boolean, containsForeignElements: ForeignElementType) {
		this.characterMapping = characterMapping;
		this.containsRTL = containsRTL;
		this.containsForeignElements = containsForeignElements;
	}
}

export function renderViewLine(input: RenderLineInput, sb: IStringBuilder): RenderLineOutput {
	if (input.lineContent.length === 0) {

		if (input.lineDecorations.length > 0) {
			// This line is empty, but it contains inline decorations
			sb.appendASCIIString(`<span>`);

			let beforeCount = 0;
			let afterCount = 0;
			let containsForeignElements = ForeignElementType.None;
			for (const lineDecoration of input.lineDecorations) {
				if (lineDecoration.type === InlineDecorationType.Before || lineDecoration.type === InlineDecorationType.After) {
					sb.appendASCIIString(`<span class="`);
					sb.appendASCIIString(lineDecoration.className);
					sb.appendASCIIString(`"></span>`);

					if (lineDecoration.type === InlineDecorationType.Before) {
						containsForeignElements |= ForeignElementType.Before;
						beforeCount++;
					}
					if (lineDecoration.type === InlineDecorationType.After) {
						containsForeignElements |= ForeignElementType.After;
						afterCount++;
					}
				}
			}

			sb.appendASCIIString(`</span>`);

			const characterMapping = new CharacterMapping(1, beforeCount + afterCount);
			characterMapping.setPartData(0, beforeCount, 0, 0);

			return new RenderLineOutput(
				characterMapping,
				false,
				containsForeignElements
			);
		}

		// completely empty line
		sb.appendASCIIString('<span><span></span></span>');
		return new RenderLineOutput(
			new CharacterMapping(0, 0),
			false,
			ForeignElementType.None
		);
	}

	return _renderLine(resolveRenderLineInput(input), sb);
}

export class RenderLineOutput2 {
	constructor(
		public readonly characterMapping: CharacterMapping,
		public readonly html: string,
		public readonly containsRTL: boolean,
		public readonly containsForeignElements: ForeignElementType
	) {
	}
}

export function renderViewLine2(input: RenderLineInput): RenderLineOutput2 {
	let sb = createStringBuilder(10000);
	let out = renderViewLine(input, sb);
	return new RenderLineOutput2(out.characterMapping, sb.build(), out.containsRTL, out.containsForeignElements);
}

class ResolvedRenderLineInput {
	constructor(
		public readonly fontIsMonospace: boolean,
		public readonly canUseHalfwidthRightwardsArrow: boolean,
		public readonly lineContent: string,
		public readonly len: number,
		public readonly isOverflowing: boolean,
		public readonly parts: LinePart[],
		public readonly containsForeignElements: ForeignElementType,
		public readonly fauxIndentLength: number,
		public readonly tabSize: number,
		public readonly startVisibleColumn: number,
		public readonly containsRTL: boolean,
		public readonly spaceWidth: number,
		public readonly renderSpaceCharCode: number,
		public readonly renderWhitespace: RenderWhitespace,
		public readonly renderControlCharacters: boolean,
	) {
		//
	}
}

function resolveRenderLineInput(input: RenderLineInput): ResolvedRenderLineInput {
	const lineContent = input.lineContent;

	let isOverflowing: boolean;
	let len: number;

	if (input.stopRenderingLineAfter !== -1 && input.stopRenderingLineAfter < lineContent.length) {
		isOverflowing = true;
		len = input.stopRenderingLineAfter;
	} else {
		isOverflowing = false;
		len = lineContent.length;
	}

	let tokens = transformAndRemoveOverflowing(input.lineTokens, input.fauxIndentLength, len);
	if (input.renderWhitespace === RenderWhitespace.All ||
		input.renderWhitespace === RenderWhitespace.Boundary ||
		(input.renderWhitespace === RenderWhitespace.Selection && !!input.selectionsOnLine) ||
		input.renderWhitespace === RenderWhitespace.Trailing) {

		tokens = _applyRenderWhitespace(input, lineContent, len, tokens);
	}
	let containsForeignElements = ForeignElementType.None;
	if (input.lineDecorations.length > 0) {
		for (let i = 0, len = input.lineDecorations.length; i < len; i++) {
			const lineDecoration = input.lineDecorations[i];
			if (lineDecoration.type === InlineDecorationType.RegularAffectingLetterSpacing) {
				// Pretend there are foreign elements... although not 100% accurate.
				containsForeignElements |= ForeignElementType.Before;
			} else if (lineDecoration.type === InlineDecorationType.Before) {
				containsForeignElements |= ForeignElementType.Before;
			} else if (lineDecoration.type === InlineDecorationType.After) {
				containsForeignElements |= ForeignElementType.After;
			}
		}
		tokens = _applyInlineDecorations(lineContent, len, tokens, input.lineDecorations);
	}
	if (!input.containsRTL) {
		// We can never split RTL text, as it ruins the rendering
		tokens = splitLargeTokens(lineContent, tokens, !input.isBasicASCII || input.fontLigatures);
	}

	return new ResolvedRenderLineInput(
		input.useMonospaceOptimizations,
		input.canUseHalfwidthRightwardsArrow,
		lineContent,
		len,
		isOverflowing,
		tokens,
		containsForeignElements,
		input.fauxIndentLength,
		input.tabSize,
		input.startVisibleColumn,
		input.containsRTL,
		input.spaceWidth,
		input.renderSpaceCharCode,
		input.renderWhitespace,
		input.renderControlCharacters
	);
}

/**
 * In the rendering phase, characters are always looped until token.endIndex.
 * Ensure that all tokens end before `len` and the last one ends precisely at `len`.
 */
function transformAndRemoveOverflowing(tokens: IViewLineTokens, fauxIndentLength: number, len: number): LinePart[] {
	let result: LinePart[] = [], resultLen = 0;

	// The faux indent part of the line should have no token type
	if (fauxIndentLength > 0) {
		result[resultLen++] = new LinePart(fauxIndentLength, '', 0);
	}

	for (let tokenIndex = 0, tokensLen = tokens.getCount(); tokenIndex < tokensLen; tokenIndex++) {
		const endIndex = tokens.getEndOffset(tokenIndex);
		if (endIndex <= fauxIndentLength) {
			// The faux indent part of the line should have no token type
			continue;
		}
		const type = tokens.getClassName(tokenIndex);
		if (endIndex >= len) {
			result[resultLen++] = new LinePart(len, type, 0);
			break;
		}
		result[resultLen++] = new LinePart(endIndex, type, 0);
	}

	return result;
}

/**
 * written as a const enum to get value inlining.
 */
const enum Constants {
	LongToken = 50
}

/**
 * See https://github.com/microsoft/vscode/issues/6885.
 * It appears that having very large spans causes very slow reading of character positions.
 * So here we try to avoid that.
 */
function splitLargeTokens(lineContent: string, tokens: LinePart[], onlyAtSpaces: boolean): LinePart[] {
	let lastTokenEndIndex = 0;
	let result: LinePart[] = [], resultLen = 0;

	if (onlyAtSpaces) {
		// Split only at spaces => we need to walk each character
		for (let i = 0, len = tokens.length; i < len; i++) {
			const token = tokens[i];
			const tokenEndIndex = token.endIndex;
			if (lastTokenEndIndex + Constants.LongToken < tokenEndIndex) {
				const tokenType = token.type;
				const tokenMetadata = token.metadata;

				let lastSpaceOffset = -1;
				let currTokenStart = lastTokenEndIndex;
				for (let j = lastTokenEndIndex; j < tokenEndIndex; j++) {
					if (lineContent.charCodeAt(j) === CharCode.Space) {
						lastSpaceOffset = j;
					}
					if (lastSpaceOffset !== -1 && j - currTokenStart >= Constants.LongToken) {
						// Split at `lastSpaceOffset` + 1
						result[resultLen++] = new LinePart(lastSpaceOffset + 1, tokenType, tokenMetadata);
						currTokenStart = lastSpaceOffset + 1;
						lastSpaceOffset = -1;
					}
				}
				if (currTokenStart !== tokenEndIndex) {
					result[resultLen++] = new LinePart(tokenEndIndex, tokenType, tokenMetadata);
				}
			} else {
				result[resultLen++] = token;
			}

			lastTokenEndIndex = tokenEndIndex;
		}
	} else {
		// Split anywhere => we don't need to walk each character
		for (let i = 0, len = tokens.length; i < len; i++) {
			const token = tokens[i];
			const tokenEndIndex = token.endIndex;
			let diff = (tokenEndIndex - lastTokenEndIndex);
			if (diff > Constants.LongToken) {
				const tokenType = token.type;
				const tokenMetadata = token.metadata;
				const piecesCount = Math.ceil(diff / Constants.LongToken);
				for (let j = 1; j < piecesCount; j++) {
					let pieceEndIndex = lastTokenEndIndex + (j * Constants.LongToken);
					result[resultLen++] = new LinePart(pieceEndIndex, tokenType, tokenMetadata);
				}
				result[resultLen++] = new LinePart(tokenEndIndex, tokenType, tokenMetadata);
			} else {
				result[resultLen++] = token;
			}
			lastTokenEndIndex = tokenEndIndex;
		}
	}

	return result;
}

/**
 * Whitespace is rendered by "replacing" tokens with a special-purpose `mtkw` type that is later recognized in the rendering phase.
 * Moreover, a token is created for every visual indent because on some fonts the glyphs used for rendering whitespace (&rarr; or &middot;) do not have the same width as &nbsp;.
 * The rendering phase will generate `style="width:..."` for these tokens.
 */
function _applyRenderWhitespace(input: RenderLineInput, lineContent: string, len: number, tokens: LinePart[]): LinePart[] {

	const continuesWithWrappedLine = input.continuesWithWrappedLine;
	const fauxIndentLength = input.fauxIndentLength;
	const tabSize = input.tabSize;
	const startVisibleColumn = input.startVisibleColumn;
	const useMonospaceOptimizations = input.useMonospaceOptimizations;
	const selections = input.selectionsOnLine;
	const onlyBoundary = (input.renderWhitespace === RenderWhitespace.Boundary);
	const onlyTrailing = (input.renderWhitespace === RenderWhitespace.Trailing);
	const generateLinePartForEachWhitespace = (input.renderSpaceWidth !== input.spaceWidth);

	let result: LinePart[] = [], resultLen = 0;
	let tokenIndex = 0;
	let tokenType = tokens[tokenIndex].type;
	let tokenEndIndex = tokens[tokenIndex].endIndex;
	const tokensLength = tokens.length;

	let lineIsEmptyOrWhitespace = false;
	let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineContent);
	let lastNonWhitespaceIndex: number;
	if (firstNonWhitespaceIndex === -1) {
		lineIsEmptyOrWhitespace = true;
		firstNonWhitespaceIndex = len;
		lastNonWhitespaceIndex = len;
	} else {
		lastNonWhitespaceIndex = strings.lastNonWhitespaceIndex(lineContent);
	}

	let wasInWhitespace = false;
	let currentSelectionIndex = 0;
	let currentSelection = selections && selections[currentSelectionIndex];
	let tmpIndent = startVisibleColumn % tabSize;
	for (let charIndex = fauxIndentLength; charIndex < len; charIndex++) {
		const chCode = lineContent.charCodeAt(charIndex);

		if (currentSelection && charIndex >= currentSelection.endOffset) {
			currentSelectionIndex++;
			currentSelection = selections && selections[currentSelectionIndex];
		}

		let isInWhitespace: boolean;
		if (charIndex < firstNonWhitespaceIndex || charIndex > lastNonWhitespaceIndex) {
			// in leading or trailing whitespace
			isInWhitespace = true;
		} else if (chCode === CharCode.Tab) {
			// a tab character is rendered both in all and boundary cases
			isInWhitespace = true;
		} else if (chCode === CharCode.Space) {
			// hit a space character
			if (onlyBoundary) {
				// rendering only boundary whitespace
				if (wasInWhitespace) {
					isInWhitespace = true;
				} else {
					const nextChCode = (charIndex + 1 < len ? lineContent.charCodeAt(charIndex + 1) : CharCode.Null);
					isInWhitespace = (nextChCode === CharCode.Space || nextChCode === CharCode.Tab);
				}
			} else {
				isInWhitespace = true;
			}
		} else {
			isInWhitespace = false;
		}

		// If rendering whitespace on selection, check that the charIndex falls within a selection
		if (isInWhitespace && selections) {
			isInWhitespace = !!currentSelection && currentSelection.startOffset <= charIndex && currentSelection.endOffset > charIndex;
		}

		// If rendering only trailing whitespace, check that the charIndex points to trailing whitespace.
		if (isInWhitespace && onlyTrailing) {
			isInWhitespace = lineIsEmptyOrWhitespace || charIndex > lastNonWhitespaceIndex;
		}

		if (wasInWhitespace) {
			// was in whitespace token
			if (!isInWhitespace || (!useMonospaceOptimizations && tmpIndent >= tabSize)) {
				// leaving whitespace token or entering a new indent
				if (generateLinePartForEachWhitespace) {
					const lastEndIndex = (resultLen > 0 ? result[resultLen - 1].endIndex : fauxIndentLength);
					for (let i = lastEndIndex + 1; i <= charIndex; i++) {
						result[resultLen++] = new LinePart(i, 'mtkw', LinePartMetadata.IS_WHITESPACE);
					}
				} else {
					result[resultLen++] = new LinePart(charIndex, 'mtkw', LinePartMetadata.IS_WHITESPACE);
				}
				tmpIndent = tmpIndent % tabSize;
			}
		} else {
			// was in regular token
			if (charIndex === tokenEndIndex || (isInWhitespace && charIndex > fauxIndentLength)) {
				result[resultLen++] = new LinePart(charIndex, tokenType, 0);
				tmpIndent = tmpIndent % tabSize;
			}
		}

		if (chCode === CharCode.Tab) {
			tmpIndent = tabSize;
		} else if (strings.isFullWidthCharacter(chCode)) {
			tmpIndent += 2;
		} else {
			tmpIndent++;
		}

		wasInWhitespace = isInWhitespace;

		while (charIndex === tokenEndIndex) {
			tokenIndex++;
			if (tokenIndex < tokensLength) {
				tokenType = tokens[tokenIndex].type;
				tokenEndIndex = tokens[tokenIndex].endIndex;
			}
		}
	}

	let generateWhitespace = false;
	if (wasInWhitespace) {
		// was in whitespace token
		if (continuesWithWrappedLine && onlyBoundary) {
			let lastCharCode = (len > 0 ? lineContent.charCodeAt(len - 1) : CharCode.Null);
			let prevCharCode = (len > 1 ? lineContent.charCodeAt(len - 2) : CharCode.Null);
			let isSingleTrailingSpace = (lastCharCode === CharCode.Space && (prevCharCode !== CharCode.Space && prevCharCode !== CharCode.Tab));
			if (!isSingleTrailingSpace) {
				generateWhitespace = true;
			}
		} else {
			generateWhitespace = true;
		}
	}

	if (generateWhitespace) {
		if (generateLinePartForEachWhitespace) {
			const lastEndIndex = (resultLen > 0 ? result[resultLen - 1].endIndex : fauxIndentLength);
			for (let i = lastEndIndex + 1; i <= len; i++) {
				result[resultLen++] = new LinePart(i, 'mtkw', LinePartMetadata.IS_WHITESPACE);
			}
		} else {
			result[resultLen++] = new LinePart(len, 'mtkw', LinePartMetadata.IS_WHITESPACE);
		}
	} else {
		result[resultLen++] = new LinePart(len, tokenType, 0);
	}

	return result;
}

/**
 * Inline decorations are "merged" on top of tokens.
 * Special care must be taken when multiple inline decorations are at play and they overlap.
 */
function _applyInlineDecorations(lineContent: string, len: number, tokens: LinePart[], _lineDecorations: LineDecoration[]): LinePart[] {
	_lineDecorations.sort(LineDecoration.compare);
	const lineDecorations = LineDecorationsNormalizer.normalize(lineContent, _lineDecorations);
	const lineDecorationsLen = lineDecorations.length;

	let lineDecorationIndex = 0;
	let result: LinePart[] = [], resultLen = 0, lastResultEndIndex = 0;
	for (let tokenIndex = 0, len = tokens.length; tokenIndex < len; tokenIndex++) {
		const token = tokens[tokenIndex];
		const tokenEndIndex = token.endIndex;
		const tokenType = token.type;
		const tokenMetadata = token.metadata;

		while (lineDecorationIndex < lineDecorationsLen && lineDecorations[lineDecorationIndex].startOffset < tokenEndIndex) {
			const lineDecoration = lineDecorations[lineDecorationIndex];

			if (lineDecoration.startOffset > lastResultEndIndex) {
				lastResultEndIndex = lineDecoration.startOffset;
				result[resultLen++] = new LinePart(lastResultEndIndex, tokenType, tokenMetadata);
			}

			if (lineDecoration.endOffset + 1 <= tokenEndIndex) {
				// This line decoration ends before this token ends
				lastResultEndIndex = lineDecoration.endOffset + 1;
				result[resultLen++] = new LinePart(lastResultEndIndex, tokenType + ' ' + lineDecoration.className, tokenMetadata | lineDecoration.metadata);
				lineDecorationIndex++;
			} else {
				// This line decoration continues on to the next token
				lastResultEndIndex = tokenEndIndex;
				result[resultLen++] = new LinePart(lastResultEndIndex, tokenType + ' ' + lineDecoration.className, tokenMetadata | lineDecoration.metadata);
				break;
			}
		}

		if (tokenEndIndex > lastResultEndIndex) {
			lastResultEndIndex = tokenEndIndex;
			result[resultLen++] = new LinePart(lastResultEndIndex, tokenType, tokenMetadata);
		}
	}

	const lastTokenEndIndex = tokens[tokens.length - 1].endIndex;
	if (lineDecorationIndex < lineDecorationsLen && lineDecorations[lineDecorationIndex].startOffset === lastTokenEndIndex) {
		let classNames: string[] = [];
		let metadata = 0;
		while (lineDecorationIndex < lineDecorationsLen && lineDecorations[lineDecorationIndex].startOffset === lastTokenEndIndex) {
			classNames.push(lineDecorations[lineDecorationIndex].className);
			metadata |= lineDecorations[lineDecorationIndex].metadata;
			lineDecorationIndex++;
		}
		result[resultLen++] = new LinePart(lastResultEndIndex, classNames.join(' '), metadata);
	}

	return result;
}

/**
 * This function is on purpose not split up into multiple functions to allow runtime type inference (i.e. performance reasons).
 * Notice how all the needed data is fully resolved and passed in (i.e. no other calls).
 */
function _renderLine(input: ResolvedRenderLineInput, sb: IStringBuilder): RenderLineOutput {
	const fontIsMonospace = input.fontIsMonospace;
	const canUseHalfwidthRightwardsArrow = input.canUseHalfwidthRightwardsArrow;
	const containsForeignElements = input.containsForeignElements;
	const lineContent = input.lineContent;
	const len = input.len;
	const isOverflowing = input.isOverflowing;
	const parts = input.parts;
	const fauxIndentLength = input.fauxIndentLength;
	const tabSize = input.tabSize;
	const startVisibleColumn = input.startVisibleColumn;
	const containsRTL = input.containsRTL;
	const spaceWidth = input.spaceWidth;
	const renderSpaceCharCode = input.renderSpaceCharCode;
	const renderWhitespace = input.renderWhitespace;
	const renderControlCharacters = input.renderControlCharacters;

	const characterMapping = new CharacterMapping(len + 1, parts.length);

	let charIndex = 0;
	let visibleColumn = startVisibleColumn;
	let charOffsetInPart = 0;

	let partDisplacement = 0;
	let prevPartContentCnt = 0;
	let partAbsoluteOffset = 0;

	if (containsRTL) {
		sb.appendASCIIString('<span dir="ltr">');
	} else {
		sb.appendASCIIString('<span>');
	}

	for (let partIndex = 0, tokensLen = parts.length; partIndex < tokensLen; partIndex++) {
		partAbsoluteOffset += prevPartContentCnt;

		const part = parts[partIndex];
		const partEndIndex = part.endIndex;
		const partType = part.type;
		const partRendersWhitespace = (renderWhitespace !== RenderWhitespace.None && part.isWhitespace());
		const partRendersWhitespaceWithWidth = partRendersWhitespace && !fontIsMonospace && (partType === 'mtkw'/*only whitespace*/ || !containsForeignElements);
		const partIsEmptyAndHasPseudoAfter = (charIndex === partEndIndex && part.metadata === LinePartMetadata.PSEUDO_AFTER);
		charOffsetInPart = 0;

		sb.appendASCIIString('<span class="');
		sb.appendASCIIString(partRendersWhitespaceWithWidth ? 'mtkz' : partType);
		sb.appendASCII(CharCode.DoubleQuote);

		if (partRendersWhitespace) {

			let partContentCnt = 0;
			{
				let _charIndex = charIndex;
				let _visibleColumn = visibleColumn;

				for (; _charIndex < partEndIndex; _charIndex++) {
					const charCode = lineContent.charCodeAt(_charIndex);
					const charWidth = (charCode === CharCode.Tab ? (tabSize - (_visibleColumn % tabSize)) : 1) | 0;
					partContentCnt += charWidth;
					if (_charIndex >= fauxIndentLength) {
						_visibleColumn += charWidth;
					}
				}
			}

			if (partRendersWhitespaceWithWidth) {
				sb.appendASCIIString(' style="width:');
				sb.appendASCIIString(String(spaceWidth * partContentCnt));
				sb.appendASCIIString('px"');
			}
			sb.appendASCII(CharCode.GreaterThan);

			for (; charIndex < partEndIndex; charIndex++) {
				characterMapping.setPartData(charIndex, partIndex - partDisplacement, charOffsetInPart, partAbsoluteOffset);
				partDisplacement = 0;
				const charCode = lineContent.charCodeAt(charIndex);
				let charWidth: number;

				if (charCode === CharCode.Tab) {
					charWidth = (tabSize - (visibleColumn % tabSize)) | 0;

					if (!canUseHalfwidthRightwardsArrow || charWidth > 1) {
						sb.write1(0x2192); // RIGHTWARDS ARROW
					} else {
						sb.write1(0xFFEB); // HALFWIDTH RIGHTWARDS ARROW
					}
					for (let space = 2; space <= charWidth; space++) {
						sb.write1(0xA0); // &nbsp;
					}

				} else { // must be CharCode.Space
					charWidth = 1;

					sb.write1(renderSpaceCharCode); // &middot; or word separator middle dot
				}

				charOffsetInPart += charWidth;
				if (charIndex >= fauxIndentLength) {
					visibleColumn += charWidth;
				}
			}

			prevPartContentCnt = partContentCnt;

		} else {

			let partContentCnt = 0;

			sb.appendASCII(CharCode.GreaterThan);

			for (; charIndex < partEndIndex; charIndex++) {
				characterMapping.setPartData(charIndex, partIndex - partDisplacement, charOffsetInPart, partAbsoluteOffset);
				partDisplacement = 0;
				const charCode = lineContent.charCodeAt(charIndex);

				let producedCharacters = 1;
				let charWidth = 1;

				switch (charCode) {
					case CharCode.Tab:
						producedCharacters = (tabSize - (visibleColumn % tabSize));
						charWidth = producedCharacters;
						for (let space = 1; space <= producedCharacters; space++) {
							sb.write1(0xA0); // &nbsp;
						}
						break;

					case CharCode.Space:
						sb.write1(0xA0); // &nbsp;
						break;

					case CharCode.LessThan:
						sb.appendASCIIString('&lt;');
						break;

					case CharCode.GreaterThan:
						sb.appendASCIIString('&gt;');
						break;

					case CharCode.Ampersand:
						sb.appendASCIIString('&amp;');
						break;

					case CharCode.Null:
						if (renderControlCharacters) {
							// See https://unicode-table.com/en/blocks/control-pictures/
							sb.write1(9216);
						} else {
							sb.appendASCIIString('&#00;');
						}
						break;

					case CharCode.UTF8_BOM:
					case CharCode.LINE_SEPARATOR:
					case CharCode.PARAGRAPH_SEPARATOR:
					case CharCode.NEXT_LINE:
						sb.write1(0xFFFD);
						break;

					default:
						if (strings.isFullWidthCharacter(charCode)) {
							charWidth++;
						}
						// See https://unicode-table.com/en/blocks/control-pictures/
						if (renderControlCharacters && charCode < 32) {
							sb.write1(9216 + charCode);
						} else if (renderControlCharacters && charCode === 127) {
							// DEL
							sb.write1(9249);
						} else {
							sb.write1(charCode);
						}
				}

				charOffsetInPart += producedCharacters;
				partContentCnt += producedCharacters;
				if (charIndex >= fauxIndentLength) {
					visibleColumn += charWidth;
				}
			}

			prevPartContentCnt = partContentCnt;
		}

		if (partIsEmptyAndHasPseudoAfter) {
			partDisplacement++;
		} else {
			partDisplacement = 0;
		}

		sb.appendASCIIString('</span>');

	}

	// When getting client rects for the last character, we will position the
	// text range at the end of the span, insteaf of at the beginning of next span
	characterMapping.setPartData(len, parts.length - 1, charOffsetInPart, partAbsoluteOffset);

	if (isOverflowing) {
		sb.appendASCIIString('<span>&hellip;</span>');
	}

	sb.appendASCIIString('</span>');

	return new RenderLineOutput(characterMapping, containsRTL, containsForeignElements);
}
