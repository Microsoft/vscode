/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * This module exports common types and functionality shared between
 * the Monarch compiler that compiles JSON to ILexer, and the Monarch
 * Tokenizer (that highlights at runtime)
 */

/*
 * Type definitions to be used internally to Monarch.
 * Inside monarch we use fully typed definitions and compiled versions of the more abstract JSON descriptions.
 */

export const enum MonarchBracket {
	None = 0,
	Open = 1,
	Close = -1
}

export interface ILexerMin {
	languageId: string;
	noThrow: boolean;
	ignoreCase: boolean;
	unicode: boolean;
	usesEmbedded: boolean;
	defaultToken: string;
	stateNames: { [stateName: string]: any; };
	[attr: string]: any;
}

export interface ILexer extends ILexerMin {
	maxStack: number;
	start: string | null;
	ignoreCase: boolean;
	unicode: boolean;
	tokenPostfix: string;

	tokenizer: { [stateName: string]: IRule[]; };
	brackets: IBracket[];
}

export interface IBracket {
	token: string;
	open: string;
	close: string;
}

export type FuzzyAction = IAction | string;

export function isFuzzyActionArr(what: FuzzyAction | FuzzyAction[]): what is FuzzyAction[] {
	return (Array.isArray(what));
}

export function isFuzzyAction(what: FuzzyAction | FuzzyAction[]): what is FuzzyAction {
	return !isFuzzyActionArr(what);
}

export function isString(what: FuzzyAction): what is string {
	return (typeof what === 'string');
}

export function isIAction(what: FuzzyAction): what is IAction {
	return !isString(what);
}

export interface IRule {
	regex: RegExp;
	action: FuzzyAction;
	matchOnlyAtLineStart: boolean;
	name: string;
}

export interface IAction {
	// an action is either a group of actions
	group?: FuzzyAction[];

	// or a function that returns a fresh action
	test?: (id: string, matches: string[], state: string, eos: boolean) => FuzzyAction;

	// or it is a declarative action with a token value and various other attributes
	token?: string;
	tokenSubst?: boolean;
	next?: string;
	nextEmbedded?: string;
	bracket?: MonarchBracket;
	log?: string;
	switchTo?: string;
	goBack?: number;
	transform?: (states: string[]) => string[];
}

export interface IBranch {
	name: string;
	value: FuzzyAction;
	test?: (id: string, matches: string[], state: string, eos: boolean) => boolean;
}

// Small helper functions

/**
 * Is a string null, undefined, or empty?
 */
export function empty(s: string): boolean {
	return (s ? false : true);
}

/**
 * Puts a string to lower case if 'ignoreCase' is set.
 */
export function fixCase(lexer: ILexerMin, str: string): string {
	return (lexer.ignoreCase && str ? str.toLowerCase() : str);
}

/**
 * Ensures there are no bad characters in a CSS token class.
 */
export function sanitize(s: string) {
	return s.replace(/[&<>'"_]/g, '-'); // used on all output token CSS classes
}

// Logging

/**
 * Logs a message.
 */
export function log(lexer: ILexerMin, msg: string) {
	console.log(`${lexer.languageId}: ${msg}`);
}

// Throwing errors

export function createError(lexer: ILexerMin, msg: string): Error {
	return new Error(`${lexer.languageId}: ${msg}`);
}

// Helper functions for rule finding and substitution

/**
 * substituteMatches is used on lexer strings and can substitutes predefined patterns:
 * 		$$  => $
 * 		$#  => id
 * 		$n  => matched entry n
 * 		@attr => contents of lexer[attr]
 *
 * See documentation for more info
 */
export function substituteMatches(lexer: ILexerMin, str: string, id: string, matches: string[], state: string): string {
	const re = /\$((\$)|(#)|(\d\d?)|[sS](\d\d?)|@(\w+))/g;
	let stateMatches: string[] | null = null;
	return str.replace(re, function (full, sub?, dollar?, hash?, n?, s?, attr?, ofs?, total?) {
		if (!empty(dollar)) {
			return '$'; // $$
		}
		if (!empty(hash)) {
			return fixCase(lexer, id);   // default $#
		}
		if (!empty(n) && n < matches.length) {
			return fixCase(lexer, matches[n]); // $n
		}
		if (!empty(attr) && lexer && typeof (lexer[attr]) === 'string') {
			return lexer[attr]; //@attribute
		}
		if (stateMatches === null) { // split state on demand
			stateMatches = state.split('.');
			stateMatches.unshift(state);
		}
		if (!empty(s) && s < stateMatches.length) {
			return fixCase(lexer, stateMatches[s]); //$Sn
		}
		return '';
	});
}

/**
 * Find the tokenizer rules for a specific state (i.e. next action)
 */
export function findRules(lexer: ILexer, inState: string): IRule[] | null {
	let state: string | null = inState;
	while (state && state.length > 0) {
		const rules = lexer.tokenizer[state];
		if (rules) {
			return rules;
		}

		const idx = state.lastIndexOf('.');
		if (idx < 0) {
			state = null; // no further parent
		} else {
			state = state.substr(0, idx);
		}
	}
	return null;
}

/**
 * Is a certain state defined? In contrast to 'findRules' this works on a ILexerMin.
 * This is used during compilation where we may know the defined states
 * but not yet whether the corresponding rules are correct.
 */
export function stateExists(lexer: ILexerMin, inState: string): boolean {
	let state: string | null = inState;
	while (state && state.length > 0) {
		const exist = lexer.stateNames[state];
		if (exist) {
			return true;
		}

		const idx = state.lastIndexOf('.');
		if (idx < 0) {
			state = null; // no further parent
		} else {
			state = state.substr(0, idx);
		}
	}
	return false;
}
