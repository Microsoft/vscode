/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StandardTokenType } from 'vs/editor/common/modes';
import { CharCode } from 'vs/base/common/charCode';

class ParserContext {
	public readonly text: string;
	public readonly len: number;
	public readonly tokens: number[];
	public pos: number;

	private currentTokenStartOffset: number;
	private currentTokenType: StandardTokenType;

	constructor(text: string) {
		this.text = text;
		this.len = this.text.length;
		this.tokens = [];
		this.pos = 0;
		this.currentTokenStartOffset = 0;
		this.currentTokenType = StandardTokenType.Other;
	}

	private _safeCharCodeAt(index: number): number {
		if (index >= this.len) {
			return CharCode.Null;
		}
		return this.text.charCodeAt(index);
	}

	peek(distance: number = 0): number {
		return this._safeCharCodeAt(this.pos + distance);
	}

	next(): number {
		const result = this._safeCharCodeAt(this.pos);
		this.pos++;
		return result;
	}

	advance(distance: number): void {
		this.pos += distance;
	}

	eof(): boolean {
		return this.pos >= this.len;
	}

	beginToken(tokenType: StandardTokenType, deltaPos: number = 0): void {
		this.currentTokenStartOffset = this.pos + deltaPos;
		this.currentTokenType = tokenType;
	}

	endToken(deltaPos: number = 0): void {
		const length = this.pos + deltaPos - this.currentTokenStartOffset;
		// check if it is touching previous token
		if (this.tokens.length > 0) {
			const previousStartOffset = this.tokens[this.tokens.length - 3];
			const previousLength = this.tokens[this.tokens.length - 2];
			const previousTokenType = this.tokens[this.tokens.length - 1];
			const previousEndOffset = previousStartOffset + previousLength;
			if (this.currentTokenStartOffset === previousEndOffset && previousTokenType === this.currentTokenType) {
				// extend previous token
				this.tokens[this.tokens.length - 2] += length;
				return;
			}
		}
		this.tokens.push(this.currentTokenStartOffset, length, this.currentTokenType);
	}
}

export function parse(text: string): number[] {
	const ctx = new ParserContext(text);
	while (!ctx.eof()) {
		parseRoot(ctx);
	}
	return ctx.tokens;
}

function parseRoot(ctx: ParserContext): void {
	let curlyCount = 0;
	while (!ctx.eof()) {
		const ch = ctx.peek();

		switch (ch) {
			case CharCode.SingleQuote:
				parseSimpleString(ctx, CharCode.SingleQuote);
				break;
			case CharCode.DoubleQuote:
				parseSimpleString(ctx, CharCode.DoubleQuote);
				break;
			case CharCode.BackTick:
				parseInterpolatedString(ctx);
				break;
			case CharCode.Slash:
				parseSlash(ctx);
				break;
			case CharCode.OpenCurlyBrace:
				ctx.advance(1);
				curlyCount++;
				break;
			case CharCode.CloseCurlyBrace:
				ctx.advance(1);
				curlyCount--;
				if (curlyCount < 0) {
					return;
				}
				break;
			default:
				ctx.advance(1);
		}
	}

}

function parseSimpleString(ctx: ParserContext, closingQuote: number): void {
	ctx.beginToken(StandardTokenType.String);

	// skip the opening quote
	ctx.advance(1);

	while (!ctx.eof()) {
		const ch = ctx.next();
		if (ch === CharCode.Backslash) {
			// skip \r\n or any other character following a backslash
			const advanceCount = (ctx.peek() === CharCode.CarriageReturn && ctx.peek(1) === CharCode.LineFeed ? 2 : 1);
			ctx.advance(advanceCount);
		} else if (ch === closingQuote) {
			// hit end quote, so stop
			break;
		}
	}

	ctx.endToken();
}

function parseInterpolatedString(ctx: ParserContext): void {
	ctx.beginToken(StandardTokenType.String);

	// skip the opening quote
	ctx.advance(1);

	while (!ctx.eof()) {
		const ch = ctx.next();
		if (ch === CharCode.Backslash) {
			// skip \r\n or any other character following a backslash
			const advanceCount = (ctx.peek() === CharCode.CarriageReturn && ctx.peek(1) === CharCode.LineFeed ? 2 : 1);
			ctx.advance(advanceCount);
		} else if (ch === CharCode.BackTick) {
			// hit end quote, so stop
			break;
		} else if (ch === CharCode.DollarSign) {
			if (ctx.peek() === CharCode.OpenCurlyBrace) {
				ctx.advance(1);
				ctx.endToken();
				parseRoot(ctx);
				ctx.beginToken(StandardTokenType.String, -1);
			}
		}
	}

	ctx.endToken();
}

function parseSlash(ctx: ParserContext): void {

	const nextCh = ctx.peek(1);
	if (nextCh === CharCode.Asterisk) {
		parseMultiLineComment(ctx);
		return;
	}

	if (nextCh === CharCode.Slash) {
		parseSingleLineComment(ctx);
		return;
	}

	if (tryParseRegex(ctx)) {
		return;
	}

	ctx.advance(1);
}

function tryParseRegex(ctx: ParserContext): boolean {
	// See https://www.ecma-international.org/ecma-262/10.0/index.html#prod-RegularExpressionLiteral

	// TODO: avoid regex...
	let contentBefore = ctx.text.substr(ctx.pos - 100, 100);
	if (/[a-zA-Z0-9](\s*)$/.test(contentBefore)) {
		// Cannot start after an identifier
		return false;
	}

	let pos = 0;
	let len = ctx.len - ctx.pos;
	let inClass = false;

	// skip /
	pos++;

	while (pos < len) {
		const ch = ctx.peek(pos++);

		if (ch === CharCode.CarriageReturn || ch === CharCode.LineFeed) {
			return false;
		}

		if (ch === CharCode.Backslash) {
			const nextCh = ctx.peek();
			if (nextCh === CharCode.CarriageReturn || nextCh === CharCode.LineFeed) {
				return false;
			}
			// skip next character
			pos++;
			continue;
		}

		if (inClass) {

			if (ch === CharCode.CloseSquareBracket) {
				inClass = false;
				continue;
			}

		} else {

			if (ch === CharCode.Slash) {
				// cannot be directly followed by a /
				if (ctx.peek(pos) === CharCode.Slash) {
					return false;
				}

				// consume flags
				do {
					let nextCh = ctx.peek(pos);
					if (nextCh >= CharCode.a && nextCh <= CharCode.z) {
						pos++;
						continue;
					} else {
						break;
					}
				} while (true);

				// TODO: avoid regex...
				if (/^(\s*)(\.|;|\/|,|\)|\]|\}|$)/.test(ctx.text.substr(ctx.pos + pos))) {
					// Must be followed by an operator of kinds
					ctx.beginToken(StandardTokenType.RegEx);
					ctx.advance(pos);
					ctx.endToken();
					return true;
				}

				return false;
			}

			if (ch === CharCode.OpenSquareBracket) {
				inClass = true;
				continue;
			}

		}
	}

	return false;
}

function parseMultiLineComment(ctx: ParserContext): void {
	ctx.beginToken(StandardTokenType.Comment);

	// skip the /*
	ctx.advance(2);

	while (!ctx.eof()) {
		const ch = ctx.next();
		if (ch === CharCode.Asterisk) {
			if (ctx.peek() === CharCode.Slash) {
				ctx.advance(1);
				break;
			}
		}
	}

	ctx.endToken();
}

function parseSingleLineComment(ctx: ParserContext): void {
	ctx.beginToken(StandardTokenType.Comment);

	// skip the //
	ctx.advance(2);

	while (!ctx.eof()) {
		const ch = ctx.next();
		if (ch === CharCode.CarriageReturn || ch === CharCode.LineFeed) {
			break;
		}
	}

	ctx.endToken();
}
