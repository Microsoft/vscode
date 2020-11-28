/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StandardTokenType } from 'vs/editor/common/modes';

/**
 * Describes how comments for a language work.
 */
export interface CommentRule {
	/**
	 * The line comment token, like `// this is a comment`
	 */
	lineComment?: string | null;
	/**
	 * The block comment character pair, like `/* block comment *&#47;`
	 */
	blockComment?: CharacterPair | null;
}

/**
 * The language configuration interface defines the contract between extensions and
 * various editor features, like automatic bracket insertion, automatic indentation etc.
 */
export interface LanguageConfiguration {
	/**
	 * The language's comment settings.
	 */
	comments?: CommentRule;
	/**
	 * The language's brackets.
	 * This configuration implicitly affects pressing Enter around these brackets.
	 */
	brackets?: CharacterPair[];
	/**
	 * The language's word definition.
	 * If the language supports Unicode identifiers (e.g. JavaScript), it is preferable
	 * to provide a word definition that uses exclusion of known separators.
	 * e.g.: A regex that matches anything except known separators (and dot is allowed to occur in a floating point number):
	 *   /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g
	 */
	wordPattern?: RegExp;
	/**
	 * The language's indentation settings.
	 */
	indentationRules?: IndentationRule;
	/**
	 * The language's rules to be evaluated when pressing Enter.
	 */
	onEnterRules?: OnEnterRule[];
	/**
	 * The language's auto closing pairs. The 'close' character is automatically inserted with the
	 * 'open' character is typed. If not set, the configured brackets will be used.
	 */
	autoClosingPairs?: IAutoClosingPairConditional[];
	/**
	 * The language's surrounding pairs. When the 'open' character is typed on a selection, the
	 * selected string is surrounded by the open and close characters. If not set, the autoclosing pairs
	 * settings will be used.
	 */
	surroundingPairs?: IAutoClosingPair[];

	/**
	 * Defines what characters must be after the cursor for bracket or quote autoclosing to occur when using the \'languageDefined\' autoclosing setting.
	 *
	 * This is typically the set of characters which can not start an expression, such as whitespace, closing brackets, non-unary operators, etc.
	 */
	autoCloseBefore?: string;

	/**
	 * The language's folding rules.
	 */
	folding?: FoldingRules;

	/**
	 * **Deprecated** Do not use.
	 *
	 * @deprecated Will be replaced by a better API soon.
	 */
	__electricCharacterSupport?: {
		docComment?: IDocComment;
	};
}

/**
 * Describes indentation rules for a language.
 */
export interface IndentationRule {
	/**
	 * If a line matches this pattern, then all the lines after it should be unindented once (until another rule matches).
	 */
	decreaseIndentPattern: RegExp;
	/**
	 * If a line matches this pattern, then all the lines after it should be indented once (until another rule matches).
	 */
	increaseIndentPattern: RegExp;
	/**
	 * If a line matches this pattern, then **only the next line** after it should be indented once.
	 */
	indentNextLinePattern?: RegExp | null;
	/**
	 * If a line matches this pattern, then its indentation should not be changed and it should not be evaluated against the other rules.
	 */
	unIndentedLinePattern?: RegExp | null;

}

/**
 * Describes language specific folding markers such as '#region' and '#endregion'.
 * The start and end regexes will be tested against the contents of all lines and must be designed efficiently:
 * - the regex should start with '^'
 * - regexp flags (i, g) are ignored
 */
export interface FoldingMarkers {
	start: RegExp;
	end: RegExp;
}

/**
 * Describes folding rules for a language.
 */
export interface FoldingRules {
	/**
	 * Used by the indentation based strategy to decide whether empty lines belong to the previous or the next block.
	 * A language adheres to the off-side rule if blocks in that language are expressed by their indentation.
	 * See [wikipedia](https://en.wikipedia.org/wiki/Off-side_rule) for more information.
	 * If not set, `false` is used and empty lines belong to the previous block.
	 */
	offSide?: boolean;

	/**
	 * Region markers used by the language.
	 */
	markers?: FoldingMarkers;
}

/**
 * Describes a rule to be evaluated when pressing Enter.
 */
export interface OnEnterRule {
	/**
	 * This rule will only execute if the text before the cursor matches this regular expression.
	 */
	beforeText: RegExp;
	/**
	 * This rule will only execute if the text after the cursor matches this regular expression.
	 */
	afterText?: RegExp;
	/**
	 * This rule will only execute if the text above the this line matches this regular expression.
	 */
	oneLineAboveText?: RegExp;
	/**
	 * The action to execute.
	 */
	action: EnterAction;
}

/**
 * Definition of documentation comments (e.g. Javadoc/JSdoc)
 */
export interface IDocComment {
	/**
	 * The string that starts a doc comment (e.g. '/**')
	 */
	open: string;
	/**
	 * The string that appears on the last line and closes the doc comment (e.g. ' * /').
	 */
	close?: string;
}

/**
 * A tuple of two characters, like a pair of
 * opening and closing brackets.
 */
export type CharacterPair = [string, string];

export interface IAutoClosingPair {
	open: string;
	close: string;
}

export interface IAutoClosingPairConditional extends IAutoClosingPair {
	notIn?: string[];
}

/**
 * Describes what to do with the indentation when pressing Enter.
 */
export enum IndentAction {
	/**
	 * Insert new line and copy the previous line's indentation.
	 */
	None = 0,
	/**
	 * Insert new line and indent once (relative to the previous line's indentation).
	 */
	Indent = 1,
	/**
	 * Insert two new lines:
	 *  - the first one indented which will hold the cursor
	 *  - the second one at the same indentation level
	 */
	IndentOutdent = 2,
	/**
	 * Insert new line and outdent once (relative to the previous line's indentation).
	 */
	Outdent = 3
}

/**
 * Describes what to do when pressing Enter.
 */
export interface EnterAction {
	/**
	 * Describe what to do with the indentation.
	 */
	indentAction: IndentAction;
	/**
	 * Describes text to be appended after the new line and after the indentation.
	 */
	appendText?: string;
	/**
	 * Describes the number of characters to remove from the new line's indentation.
	 */
	removeText?: number;
}

/**
 * @internal
 */
export interface CompleteEnterAction {
	/**
	 * Describe what to do with the indentation.
	 */
	indentAction: IndentAction;
	/**
	 * Describes text to be appended after the new line and after the indentation.
	 */
	appendText: string;
	/**
	 * Describes the number of characters to remove from the new line's indentation.
	 */
	removeText: number;
	/**
	 * The line's indentation minus removeText
	 */
	indentation: string;
}

/**
 * @internal
 */
export class StandardAutoClosingPairConditional {
	_standardAutoClosingPairConditionalBrand: void;

	readonly open: string;
	readonly close: string;
	private readonly _standardTokenMask: number;

	constructor(source: IAutoClosingPairConditional) {
		this.open = source.open;
		this.close = source.close;

		// initially allowed in all tokens
		this._standardTokenMask = 0;

		if (Array.isArray(source.notIn)) {
			for (let i = 0, len = source.notIn.length; i < len; i++) {
				const notIn: string = source.notIn[i];
				switch (notIn) {
					case 'string':
						this._standardTokenMask |= StandardTokenType.String;
						break;
					case 'comment':
						this._standardTokenMask |= StandardTokenType.Comment;
						break;
					case 'regex':
						this._standardTokenMask |= StandardTokenType.RegEx;
						break;
				}
			}
		}
	}

	public isOK(standardToken: StandardTokenType): boolean {
		return (this._standardTokenMask & <number>standardToken) === 0;
	}
}

/**
 * @internal
 */
export class AutoClosingPairs {
	// it is useful to be able to get pairs using either end of open and close

	/** Key is first character of open */
	public readonly autoClosingPairsOpenByStart: Map<string, StandardAutoClosingPairConditional[]>;
	/** Key is last character of open */
	public readonly autoClosingPairsOpenByEnd: Map<string, StandardAutoClosingPairConditional[]>;
	/** Key is first character of close */
	public readonly autoClosingPairsCloseByStart: Map<string, StandardAutoClosingPairConditional[]>;
	/** Key is last character of close */
	public readonly autoClosingPairsCloseByEnd: Map<string, StandardAutoClosingPairConditional[]>;
	/** Key is close. Only has pairs that are a single character */
	public readonly autoClosingPairsCloseSingleChar: Map<string, StandardAutoClosingPairConditional[]>;

	constructor(autoClosingPairs: StandardAutoClosingPairConditional[]) {
		this.autoClosingPairsOpenByStart = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsOpenByEnd = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsCloseByStart = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsCloseByEnd = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsCloseSingleChar = new Map<string, StandardAutoClosingPairConditional[]>();
		for (const pair of autoClosingPairs) {
			appendEntry(this.autoClosingPairsOpenByStart, pair.open.charAt(0), pair);
			appendEntry(this.autoClosingPairsOpenByEnd, pair.open.charAt(pair.open.length - 1), pair);
			appendEntry(this.autoClosingPairsCloseByStart, pair.close.charAt(0), pair);
			appendEntry(this.autoClosingPairsCloseByEnd, pair.close.charAt(pair.close.length - 1), pair);
			if (pair.close.length === 1 && pair.open.length === 1) {
				appendEntry(this.autoClosingPairsCloseSingleChar, pair.close, pair);
			}
		}
	}
}

function appendEntry<K, V>(target: Map<K, V[]>, key: K, value: V): void {
	if (target.has(key)) {
		target.get(key)!.push(value);
	} else {
		target.set(key, [value]);
	}
}
