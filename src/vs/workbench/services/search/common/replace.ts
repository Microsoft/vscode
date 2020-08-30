/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import { IPatternInfo } from 'vs/workbench/services/search/common/search';
import { CharCode } from 'vs/base/common/charCode';
import { buildReplaceStringWithCasePreserved } from 'vs/base/common/search';

export class ReplacePattern {

	private _replacePattern: string;
	private _hasParameters: boolean = false;
	private _regExp: RegExp;
	private _caseOpsRegExp: RegExp;

	constructor(replaceString: string, searchPatternInfo: IPatternInfo)
	constructor(replaceString: string, parseParameters: boolean, regEx: RegExp)
	constructor(replaceString: string, arg2: any, arg3?: any) {
		this._replacePattern = replaceString;
		let searchPatternInfo: IPatternInfo;
		let parseParameters: boolean;
		if (typeof arg2 === 'boolean') {
			parseParameters = arg2;
			this._regExp = arg3;

		} else {
			searchPatternInfo = arg2;
			parseParameters = !!searchPatternInfo.isRegExp;
			this._regExp = strings.createRegExp(searchPatternInfo.pattern, !!searchPatternInfo.isRegExp, { matchCase: searchPatternInfo.isCaseSensitive, wholeWord: searchPatternInfo.isWordMatch, multiline: searchPatternInfo.isMultiline, global: false, unicode: true });
		}

		if (parseParameters) {
			this.parseReplaceString(replaceString);
		}

		if (this._regExp.global) {
			this._regExp = strings.createRegExp(this._regExp.source, true, { matchCase: !this._regExp.ignoreCase, wholeWord: false, multiline: this._regExp.multiline, global: false });
		}

		this._caseOpsRegExp = new RegExp(/([^\\]*?)((?:\\[uUlL])+?|)(\$[0-9]+)(.*?)/g);
	}

	get hasParameters(): boolean {
		return this._hasParameters;
	}

	get pattern(): string {
		return this._replacePattern;
	}

	get regExp(): RegExp {
		return this._regExp;
	}

	/**
	* Returns the replace string for the first match in the given text.
	* If text has no matches then returns null.
	*/
	getReplaceString(text: string, preserveCase?: boolean): string | null {
		this._regExp.lastIndex = 0;
		const match = this._regExp.exec(text);
		if (match) {
			if (this.hasParameters) {
				const replaceString = this.replaceWithCaseOperations(text, this._regExp, this.buildReplaceString(match, preserveCase));
				if (match[0] === text) {
					return replaceString;
				}
				return replaceString.substr(match.index, match[0].length - (text.length - replaceString.length));
			}
			return this.buildReplaceString(match, preserveCase);
		}

		return null;
	}

	/**
	 * replaceWithCaseOperations applies case operations to relevant replacement strings and applies
	 * the affected $N arguments. It then passes unaffected $N arguments through to string.replace().
	 *
	 * \u			=> upper-cases one character in a match.
	 * \U			=> upper-cases ALL remaining characters in a match.
	 * \l			=> lower-cases one character in a match.
	 * \L			=> lower-cases ALL remaining characters in a match.
	 */
	private replaceWithCaseOperations(text: string, regex: RegExp, replaceString: string): string {
		// Short-circuit the common path.
		if (!/\\[uUlL]/.test(replaceString)) {
			return text.replace(regex, replaceString);
		}
		// Store the values of the search parameters.
		const firstMatch = regex.exec(text);
		if (firstMatch === null) {
			return text.replace(regex, replaceString);
		}

		let patMatch: RegExpExecArray | null;
		let newReplaceString = '';
		let lastIndex = 0;
		let lastMatch = '';
		// For each annotated $N, perform text processing on the parameters and perform the substitution.
		while ((patMatch = this._caseOpsRegExp.exec(replaceString)) !== null) {
			lastIndex = patMatch.index;
			const fullMatch = patMatch[0];
			lastMatch = fullMatch;
			let caseOps = patMatch[2]; // \u, \l\u, etc.
			const money = patMatch[3]; // $1, $2, etc.

			if (!caseOps) {
				newReplaceString += fullMatch;
				continue;
			}
			const replacement = firstMatch[parseInt(money.slice(1))];
			if (!replacement) {
				newReplaceString += fullMatch;
				continue;
			}
			const replacementLen = replacement.length;

			newReplaceString += patMatch[1]; // prefix
			caseOps = caseOps.replace(/\\/g, '');
			let i = 0;
			for (; i < caseOps.length; i++) {
				switch (caseOps[i]) {
					case 'U':
						newReplaceString += replacement.slice(i).toUpperCase();
						i = replacementLen;
						break;
					case 'u':
						newReplaceString += replacement[i].toUpperCase();
						break;
					case 'L':
						newReplaceString += replacement.slice(i).toLowerCase();
						i = replacementLen;
						break;
					case 'l':
						newReplaceString += replacement[i].toLowerCase();
						break;
				}
			}
			// Append any remaining replacement string content not covered by case operations.
			if (i < replacementLen) {
				newReplaceString += replacement.slice(i);
			}

			newReplaceString += patMatch[4]; // suffix
		}

		// Append any remaining trailing content after the final regex match.
		newReplaceString += replaceString.slice(lastIndex + lastMatch.length);

		return text.replace(regex, newReplaceString);
	}

	public buildReplaceString(matches: string[] | null, preserveCase?: boolean): string {
		if (preserveCase) {
			return buildReplaceStringWithCasePreserved(matches, this._replacePattern);
		} else {
			return this._replacePattern;
		}
	}

	/**
	 * \n => LF
	 * \t => TAB
	 * \\ => \
	 * $0 => $& (see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#Specifying_a_string_as_a_parameter)
	 * everything else stays untouched
	 */
	private parseReplaceString(replaceString: string): void {
		if (!replaceString || replaceString.length === 0) {
			return;
		}

		let substrFrom = 0, result = '';
		for (let i = 0, len = replaceString.length; i < len; i++) {
			const chCode = replaceString.charCodeAt(i);

			if (chCode === CharCode.Backslash) {

				// move to next char
				i++;

				if (i >= len) {
					// string ends with a \
					break;
				}

				const nextChCode = replaceString.charCodeAt(i);
				let replaceWithCharacter: string | null = null;

				switch (nextChCode) {
					case CharCode.Backslash:
						// \\ => \
						replaceWithCharacter = '\\';
						break;
					case CharCode.n:
						// \n => LF
						replaceWithCharacter = '\n';
						break;
					case CharCode.t:
						// \t => TAB
						replaceWithCharacter = '\t';
						break;
				}

				if (replaceWithCharacter) {
					result += replaceString.substring(substrFrom, i - 1) + replaceWithCharacter;
					substrFrom = i + 1;
				}
			}

			if (chCode === CharCode.DollarSign) {

				// move to next char
				i++;

				if (i >= len) {
					// string ends with a $
					break;
				}

				const nextChCode = replaceString.charCodeAt(i);
				let replaceWithCharacter: string | null = null;

				switch (nextChCode) {
					case CharCode.Digit0:
						// $0 => $&
						replaceWithCharacter = '$&';
						this._hasParameters = true;
						break;
					case CharCode.BackTick:
					case CharCode.SingleQuote:
						this._hasParameters = true;
						break;
					default:
						// check if it is a valid string parameter $n (0 <= n <= 99). $0 is already handled by now.
						if (!this.between(nextChCode, CharCode.Digit1, CharCode.Digit9)) {
							break;
						}
						if (i === replaceString.length - 1) {
							this._hasParameters = true;
							break;
						}
						let charCode = replaceString.charCodeAt(++i);
						if (!this.between(charCode, CharCode.Digit0, CharCode.Digit9)) {
							this._hasParameters = true;
							--i;
							break;
						}
						if (i === replaceString.length - 1) {
							this._hasParameters = true;
							break;
						}
						charCode = replaceString.charCodeAt(++i);
						if (!this.between(charCode, CharCode.Digit0, CharCode.Digit9)) {
							this._hasParameters = true;
							--i;
							break;
						}
						break;
				}

				if (replaceWithCharacter) {
					result += replaceString.substring(substrFrom, i - 1) + replaceWithCharacter;
					substrFrom = i + 1;
				}
			}
		}

		if (substrFrom === 0) {
			// no replacement occurred
			return;
		}

		this._replacePattern = result + replaceString.substring(substrFrom);
	}

	private between(value: number, from: number, to: number): boolean {
		return from <= value && value <= to;
	}
}
