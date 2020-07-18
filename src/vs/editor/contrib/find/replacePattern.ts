/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { buildReplaceStringWithCasePreserved } from 'vs/base/common/search';

const enum ReplacePatternKind {
	StaticValue = 0,
	DynamicPieces = 1
}

/**
 * Assigned when the replace pattern is entirely static.
 */
class StaticValueReplacePattern {
	public readonly kind = ReplacePatternKind.StaticValue;
	constructor(public readonly staticValue: string) { }
}

/**
 * Assigned when the replace pattern has replacement patterns.
 */
class DynamicPiecesReplacePattern {
	public readonly kind = ReplacePatternKind.DynamicPieces;
	constructor(public readonly pieces: ReplacePiece[]) { }
}

export class ReplacePattern {

	public static fromStaticValue(value: string): ReplacePattern {
		return new ReplacePattern([ReplacePiece.staticValue(value)]);
	}

	private readonly _state: StaticValueReplacePattern | DynamicPiecesReplacePattern;

	public get hasReplacementPatterns(): boolean {
		return (this._state.kind === ReplacePatternKind.DynamicPieces);
	}

	constructor(pieces: ReplacePiece[] | null) {
		if (!pieces || pieces.length === 0) {
			this._state = new StaticValueReplacePattern('');
		} else if (pieces.length === 1 && pieces[0].staticValue !== null) {
			this._state = new StaticValueReplacePattern(pieces[0].staticValue);
		} else {
			this._state = new DynamicPiecesReplacePattern(pieces);
		}
	}

	public buildReplaceString(matches: string[] | null, preserveCase?: boolean): string {
		if (this._state.kind === ReplacePatternKind.StaticValue) {
			if (preserveCase) {
				return buildReplaceStringWithCasePreserved(matches, this._state.staticValue);
			} else {
				return this._state.staticValue;
			}
		}

		let result = '';
		for (let i = 0, len = this._state.pieces.length; i < len; i++) {
			let piece = this._state.pieces[i];
			if (piece.staticValue !== null) {
				// static value ReplacePiece
				result += piece.staticValue;
				continue;
			}

			// match index ReplacePiece
			let match: string = ReplacePattern._substitute(piece.matchIndex, matches);
			if (piece.caseOps !== null && piece.caseOps.length > 0) {
				let repl: string[] = [];
				let lenOps: number = piece.caseOps.length;
				let opIdx: number = 0;
				for (let idx: number = 0, len: number = match.length; idx < len; idx++) {
					if (opIdx >= lenOps) {
						repl.push(match.slice(idx));
						break;
					}
					switch (piece.caseOps[opIdx]) {
						case 'U':
							repl.push(match[idx].toUpperCase());
							break;
						case 'u':
							repl.push(match[idx].toUpperCase());
							opIdx++;
							break;
						case 'L':
							repl.push(match[idx].toLowerCase());
							break;
						case 'l':
							repl.push(match[idx].toLowerCase());
							opIdx++;
							break;
						default:
							repl.push(match[idx]);
					}
				}
				match = repl.join('');
			}
			result += match;
		}

		return result;
	}

	private static _substitute(matchIndex: number, matches: string[] | null): string {
		if (matches === null) {
			return '';
		}
		if (matchIndex === 0) {
			return matches[0];
		}

		let remainder = '';
		while (matchIndex > 0) {
			if (matchIndex < matches.length) {
				// A match can be undefined
				let match = (matches[matchIndex] || '');
				return match + remainder;
			}
			remainder = String(matchIndex % 10) + remainder;
			matchIndex = Math.floor(matchIndex / 10);
		}
		return '$' + remainder;
	}
}

/**
 * A replace piece can either be a static string or an index to a specific match.
 */
export class ReplacePiece {

	public static staticValue(value: string): ReplacePiece {
		return new ReplacePiece(value, -1, null);
	}

	public static matchIndex(index: number): ReplacePiece {
		return new ReplacePiece(null, index, null);
	}

	public static caseOps(index: number, caseOps: string[]): ReplacePiece {
		return new ReplacePiece(null, index, caseOps);
	}

	public readonly staticValue: string | null;
	public readonly matchIndex: number;
	public readonly caseOps: string[] | null;

	private constructor(staticValue: string | null, matchIndex: number, caseOps: string[] | null) {
		this.staticValue = staticValue;
		this.matchIndex = matchIndex;
		if (!caseOps || caseOps.length === 0) {
			this.caseOps = null;
		} else {
			this.caseOps = caseOps.slice(0);
		}
	}
}

class ReplacePieceBuilder {

	private readonly _source: string;
	private _lastCharIndex: number;
	private readonly _result: ReplacePiece[];
	private _resultLen: number;
	private _currentStaticPiece: string;

	constructor(source: string) {
		this._source = source;
		this._lastCharIndex = 0;
		this._result = [];
		this._resultLen = 0;
		this._currentStaticPiece = '';
	}

	public emitUnchanged(toCharIndex: number): void {
		this._emitStatic(this._source.substring(this._lastCharIndex, toCharIndex));
		this._lastCharIndex = toCharIndex;
	}

	public emitStatic(value: string, toCharIndex: number): void {
		this._emitStatic(value);
		this._lastCharIndex = toCharIndex;
	}

	private _emitStatic(value: string): void {
		if (value.length === 0) {
			return;
		}
		this._currentStaticPiece += value;
	}

	public emitMatchIndex(index: number, toCharIndex: number, caseOps: string[]): void {
		if (this._currentStaticPiece.length !== 0) {
			this._result[this._resultLen++] = ReplacePiece.staticValue(this._currentStaticPiece);
			this._currentStaticPiece = '';
		}
		this._result[this._resultLen++] = ReplacePiece.caseOps(index, caseOps);
		this._lastCharIndex = toCharIndex;
	}


	public finalize(): ReplacePattern {
		this.emitUnchanged(this._source.length);
		if (this._currentStaticPiece.length !== 0) {
			this._result[this._resultLen++] = ReplacePiece.staticValue(this._currentStaticPiece);
			this._currentStaticPiece = '';
		}
		return new ReplacePattern(this._result);
	}
}

/**
 * \n			=> inserts a LF
 * \t			=> inserts a TAB
 * \\			=> inserts a "\".
 * \u			=> upper-cases one character in a match.
 * \U			=> upper-cases ALL remaining characters in a match.
 * \l			=> lower-cases one character in a match.
 * \L			=> lower-cases ALL remaining characters in a match.
 * $$			=> inserts a "$".
 * $& and $0	=> inserts the matched substring.
 * $n			=> Where n is a non-negative integer lesser than 100, inserts the nth parenthesized submatch string
 * everything else stays untouched
 *
 * Also see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#Specifying_a_string_as_a_parameter
 */
export function parseReplaceString(replaceString: string): ReplacePattern {
	if (!replaceString || replaceString.length === 0) {
		return new ReplacePattern(null);
	}

	let caseOps: string[] = [];
	let result = new ReplacePieceBuilder(replaceString);

	for (let i = 0, len = replaceString.length; i < len; i++) {
		let chCode = replaceString.charCodeAt(i);

		if (chCode === CharCode.Backslash) {

			// move to next char
			i++;

			if (i >= len) {
				// string ends with a \
				break;
			}

			let nextChCode = replaceString.charCodeAt(i);
			// let replaceWithCharacter: string | null = null;

			switch (nextChCode) {
				case CharCode.Backslash:
					// \\ => inserts a "\"
					result.emitUnchanged(i - 1);
					result.emitStatic('\\', i + 1);
					break;
				case CharCode.n:
					// \n => inserts a LF
					result.emitUnchanged(i - 1);
					result.emitStatic('\n', i + 1);
					break;
				case CharCode.t:
					// \t => inserts a TAB
					result.emitUnchanged(i - 1);
					result.emitStatic('\t', i + 1);
					break;
				// Case modification of string replacements, patterned after Boost, but only applied
				// to the replacement text, not subsequent content.
				case CharCode.u:
				// \u => upper-cases one character.
				case CharCode.U:
				// \U => upper-cases ALL following characters.
				case CharCode.l:
				// \l => lower-cases one character.
				case CharCode.L:
					// \L => lower-cases ALL following characters.
					result.emitUnchanged(i - 1);
					result.emitStatic('', i + 1);
					caseOps.push(String.fromCharCode(nextChCode));
					break;
			}

			continue;
		}

		if (chCode === CharCode.DollarSign) {

			// move to next char
			i++;

			if (i >= len) {
				// string ends with a $
				break;
			}

			let nextChCode = replaceString.charCodeAt(i);

			if (nextChCode === CharCode.DollarSign) {
				// $$ => inserts a "$"
				result.emitUnchanged(i - 1);
				result.emitStatic('$', i + 1);
				continue;
			}

			if (nextChCode === CharCode.Digit0 || nextChCode === CharCode.Ampersand) {
				// $& and $0 => inserts the matched substring.
				result.emitUnchanged(i - 1);
				result.emitMatchIndex(0, i + 1, caseOps);
				caseOps.length = 0;
				continue;
			}

			if (CharCode.Digit1 <= nextChCode && nextChCode <= CharCode.Digit9) {
				// $n

				let matchIndex = nextChCode - CharCode.Digit0;

				// peek next char to probe for $nn
				if (i + 1 < len) {
					let nextNextChCode = replaceString.charCodeAt(i + 1);
					if (CharCode.Digit0 <= nextNextChCode && nextNextChCode <= CharCode.Digit9) {
						// $nn

						// move to next char
						i++;
						matchIndex = matchIndex * 10 + (nextNextChCode - CharCode.Digit0);

						result.emitUnchanged(i - 2);
						result.emitMatchIndex(matchIndex, i + 1, caseOps);
						caseOps.length = 0;
						continue;
					}
				}

				result.emitUnchanged(i - 1);
				result.emitMatchIndex(matchIndex, i + 1, caseOps);
				caseOps.length = 0;
				continue;
			}
		}
	}

	return result.finalize();
}
