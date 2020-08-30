/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import * as strings from 'vs/base/common/strings';
import * as extpath from 'vs/base/common/extpath';
import * as paths from 'vs/base/common/path';
import { LRUCache } from 'vs/base/common/map';
import { CharCode } from 'vs/base/common/charCode';
import { isThenable } from 'vs/base/common/async';

export interface IExpression {
	[pattern: string]: boolean | SiblingClause;
}

export interface IRelativePattern {
	base: string;
	pattern: string;
}

export function getEmptyExpression(): IExpression {
	return Object.create(null);
}

export interface SiblingClause {
	when: string;
}

const GLOBSTAR = '**';
const GLOB_SPLIT = '/';
const PATH_REGEX = '[/\\\\]';		// any slash or backslash
const NO_PATH_REGEX = '[^/\\\\]';	// any non-slash and non-backslash
const ALL_FORWARD_SLASHES = /\//g;

function starsToRegExp(starCount: number): string {
	switch (starCount) {
		case 0:
			return '';
		case 1:
			return `${NO_PATH_REGEX}*?`; // 1 star matches any number of characters except path separator (/ and \) - non greedy (?)
		default:
			// Matches:  (Path Sep OR Path Val followed by Path Sep OR Path Sep followed by Path Val) 0-many times
			// Group is non capturing because we don't need to capture at all (?:...)
			// Overall we use non-greedy matching because it could be that we match too much
			return `(?:${PATH_REGEX}|${NO_PATH_REGEX}+${PATH_REGEX}|${PATH_REGEX}${NO_PATH_REGEX}+)*?`;
	}
}

export function splitGlobAware(pattern: string, splitChar: string): string[] {
	if (!pattern) {
		return [];
	}

	const segments: string[] = [];

	let inBraces = false;
	let inBrackets = false;

	let curVal = '';
	for (const char of pattern) {
		switch (char) {
			case splitChar:
				if (!inBraces && !inBrackets) {
					segments.push(curVal);
					curVal = '';

					continue;
				}
				break;
			case '{':
				inBraces = true;
				break;
			case '}':
				inBraces = false;
				break;
			case '[':
				inBrackets = true;
				break;
			case ']':
				inBrackets = false;
				break;
		}

		curVal += char;
	}

	// Tail
	if (curVal) {
		segments.push(curVal);
	}

	return segments;
}

function parseRegExp(pattern: string): string {
	if (!pattern) {
		return '';
	}

	let regEx = '';

	// Split up into segments for each slash found
	const segments = splitGlobAware(pattern, GLOB_SPLIT);

	// Special case where we only have globstars
	if (segments.every(s => s === GLOBSTAR)) {
		regEx = '.*';
	}

	// Build regex over segments
	else {
		let previousSegmentWasGlobStar = false;
		segments.forEach((segment, index) => {

			// Globstar is special
			if (segment === GLOBSTAR) {

				// if we have more than one globstar after another, just ignore it
				if (!previousSegmentWasGlobStar) {
					regEx += starsToRegExp(2);
					previousSegmentWasGlobStar = true;
				}

				return;
			}

			// States
			let inBraces = false;
			let braceVal = '';

			let inBrackets = false;
			let bracketVal = '';

			for (const char of segment) {
				// Support brace expansion
				if (char !== '}' && inBraces) {
					braceVal += char;
					continue;
				}

				// Support brackets
				if (inBrackets && (char !== ']' || !bracketVal) /* ] is literally only allowed as first character in brackets to match it */) {
					let res: string;

					// range operator
					if (char === '-') {
						res = char;
					}

					// negation operator (only valid on first index in bracket)
					else if ((char === '^' || char === '!') && !bracketVal) {
						res = '^';
					}

					// glob split matching is not allowed within character ranges
					// see http://man7.org/linux/man-pages/man7/glob.7.html
					else if (char === GLOB_SPLIT) {
						res = '';
					}

					// anything else gets escaped
					else {
						res = strings.escapeRegExpCharacters(char);
					}

					bracketVal += res;
					continue;
				}

				switch (char) {
					case '{':
						inBraces = true;
						continue;

					case '[':
						inBrackets = true;
						continue;

					case '}':
						const choices = splitGlobAware(braceVal, ',');

						// Converts {foo,bar} => [foo|bar]
						const braceRegExp = `(?:${choices.map(c => parseRegExp(c)).join('|')})`;

						regEx += braceRegExp;

						inBraces = false;
						braceVal = '';

						break;

					case ']':
						regEx += ('[' + bracketVal + ']');

						inBrackets = false;
						bracketVal = '';

						break;


					case '?':
						regEx += NO_PATH_REGEX; // 1 ? matches any single character except path separator (/ and \)
						continue;

					case '*':
						regEx += starsToRegExp(1);
						continue;

					default:
						regEx += strings.escapeRegExpCharacters(char);
				}
			}

			// Tail: Add the slash we had split on if there is more to come and the remaining pattern is not a globstar
			// For example if pattern: some/**/*.js we want the "/" after some to be included in the RegEx to prevent
			// a folder called "something" to match as well.
			// However, if pattern: some/**, we tolerate that we also match on "something" because our globstar behaviour
			// is to match 0-N segments.
			if (index < segments.length - 1 && (segments[index + 1] !== GLOBSTAR || index + 2 < segments.length)) {
				regEx += PATH_REGEX;
			}

			// reset state
			previousSegmentWasGlobStar = false;
		});
	}

	return regEx;
}

// regexes to check for trival glob patterns that just check for String#endsWith
const T1 = /^\*\*\/\*\.[\w\.-]+$/; 						   			// **/*.something
const T2 = /^\*\*\/([\w\.-]+)\/?$/; 							   			// **/something
const T3 = /^{\*\*\/[\*\.]?[\w\.-]+\/?(,\*\*\/[\*\.]?[\w\.-]+\/?)*}$/; 	// {**/*.something,**/*.else} or {**/package.json,**/project.json}
const T3_2 = /^{\*\*\/[\*\.]?[\w\.-]+(\/(\*\*)?)?(,\*\*\/[\*\.]?[\w\.-]+(\/(\*\*)?)?)*}$/; 	// Like T3, with optional trailing /**
const T4 = /^\*\*((\/[\w\.-]+)+)\/?$/; 						   			// **/something/else
const T5 = /^([\w\.-]+(\/[\w\.-]+)*)\/?$/; 						   		// something/else

export type ParsedPattern = (path: string, basename?: string) => boolean;

// The ParsedExpression returns a Promise iff hasSibling returns a Promise.
export type ParsedExpression = (path: string, basename?: string, hasSibling?: (name: string) => boolean | Promise<boolean>) => string | null | Promise<string | null> /* the matching pattern */;

export interface IGlobOptions {
	/**
	 * Simplify patterns for use as exclusion filters during tree traversal to skip entire subtrees. Cannot be used outside of a tree traversal.
	 */
	trimForExclusions?: boolean;
}

interface ParsedStringPattern {
	(path: string, basename?: string): string | null | Promise<string | null> /* the matching pattern */;
	basenames?: string[];
	patterns?: string[];
	allBasenames?: string[];
	allPaths?: string[];
}
interface ParsedExpressionPattern {
	(path: string, basename?: string, name?: string, hasSibling?: (name: string) => boolean | Promise<boolean>): string | null | Promise<string | null> /* the matching pattern */;
	requiresSiblings?: boolean;
	allBasenames?: string[];
	allPaths?: string[];
}

const CACHE = new LRUCache<string, ParsedStringPattern>(10000); // bounded to 10000 elements

const FALSE = function () {
	return false;
};

const NULL = function (): string | null {
	return null;
};

function parsePattern(arg1: string | IRelativePattern, options: IGlobOptions): ParsedStringPattern {
	if (!arg1) {
		return NULL;
	}

	// Handle IRelativePattern
	let pattern: string;
	if (typeof arg1 !== 'string') {
		pattern = arg1.pattern;
	} else {
		pattern = arg1;
	}

	// Whitespace trimming
	pattern = pattern.trim();

	// Check cache
	const patternKey = `${pattern}_${!!options.trimForExclusions}`;
	let parsedPattern = CACHE.get(patternKey);
	if (parsedPattern) {
		return wrapRelativePattern(parsedPattern, arg1);
	}

	// Check for Trivias
	let match: RegExpExecArray | null;
	if (T1.test(pattern)) { // common pattern: **/*.txt just need endsWith check
		const base = pattern.substr(4); // '**/*'.length === 4
		parsedPattern = function (path, basename) {
			return typeof path === 'string' && path.endsWith(base) ? pattern : null;
		};
	} else if (match = T2.exec(trimForExclusions(pattern, options))) { // common pattern: **/some.txt just need basename check
		parsedPattern = trivia2(match[1], pattern);
	} else if ((options.trimForExclusions ? T3_2 : T3).test(pattern)) { // repetition of common patterns (see above) {**/*.txt,**/*.png}
		parsedPattern = trivia3(pattern, options);
	} else if (match = T4.exec(trimForExclusions(pattern, options))) { // common pattern: **/something/else just need endsWith check
		parsedPattern = trivia4and5(match[1].substr(1), pattern, true);
	} else if (match = T5.exec(trimForExclusions(pattern, options))) { // common pattern: something/else just need equals check
		parsedPattern = trivia4and5(match[1], pattern, false);
	}

	// Otherwise convert to pattern
	else {
		parsedPattern = toRegExp(pattern);
	}

	// Cache
	CACHE.set(patternKey, parsedPattern);

	return wrapRelativePattern(parsedPattern, arg1);
}

function wrapRelativePattern(parsedPattern: ParsedStringPattern, arg2: string | IRelativePattern): ParsedStringPattern {
	if (typeof arg2 === 'string') {
		return parsedPattern;
	}

	return function (path, basename) {
		if (!extpath.isEqualOrParent(path, arg2.base)) {
			return null;
		}
		return parsedPattern(paths.relative(arg2.base, path), basename);
	};
}

function trimForExclusions(pattern: string, options: IGlobOptions): string {
	return options.trimForExclusions && pattern.endsWith('/**') ? pattern.substr(0, pattern.length - 2) : pattern; // dropping **, tailing / is dropped later
}

// common pattern: **/some.txt just need basename check
function trivia2(base: string, originalPattern: string): ParsedStringPattern {
	const slashBase = `/${base}`;
	const backslashBase = `\\${base}`;
	const parsedPattern: ParsedStringPattern = function (path, basename) {
		if (typeof path !== 'string') {
			return null;
		}
		if (basename) {
			return basename === base ? originalPattern : null;
		}
		return path === base || path.endsWith(slashBase) || path.endsWith(backslashBase) ? originalPattern : null;
	};
	const basenames = [base];
	parsedPattern.basenames = basenames;
	parsedPattern.patterns = [originalPattern];
	parsedPattern.allBasenames = basenames;
	return parsedPattern;
}

// repetition of common patterns (see above) {**/*.txt,**/*.png}
function trivia3(pattern: string, options: IGlobOptions): ParsedStringPattern {
	const parsedPatterns = aggregateBasenameMatches(pattern.slice(1, -1).split(',')
		.map(pattern => parsePattern(pattern, options))
		.filter(pattern => pattern !== NULL), pattern);
	const n = parsedPatterns.length;
	if (!n) {
		return NULL;
	}
	if (n === 1) {
		return <ParsedStringPattern>parsedPatterns[0];
	}
	const parsedPattern: ParsedStringPattern = function (path: string, basename?: string) {
		for (let i = 0, n = parsedPatterns.length; i < n; i++) {
			if ((<ParsedStringPattern>parsedPatterns[i])(path, basename)) {
				return pattern;
			}
		}
		return null;
	};
	const withBasenames = arrays.first(parsedPatterns, pattern => !!(<ParsedStringPattern>pattern).allBasenames);
	if (withBasenames) {
		parsedPattern.allBasenames = (<ParsedStringPattern>withBasenames).allBasenames;
	}
	const allPaths = parsedPatterns.reduce((all, current) => current.allPaths ? all.concat(current.allPaths) : all, <string[]>[]);
	if (allPaths.length) {
		parsedPattern.allPaths = allPaths;
	}
	return parsedPattern;
}

// common patterns: **/something/else just need endsWith check, something/else just needs and equals check
function trivia4and5(path: string, pattern: string, matchPathEnds: boolean): ParsedStringPattern {
	const nativePath = paths.sep !== paths.posix.sep ? path.replace(ALL_FORWARD_SLASHES, paths.sep) : path;
	const nativePathEnd = paths.sep + nativePath;
	const parsedPattern: ParsedStringPattern = matchPathEnds ? function (path, basename) {
		return typeof path === 'string' && (path === nativePath || path.endsWith(nativePathEnd)) ? pattern : null;
	} : function (path, basename) {
		return typeof path === 'string' && path === nativePath ? pattern : null;
	};
	parsedPattern.allPaths = [(matchPathEnds ? '*/' : './') + path];
	return parsedPattern;
}

function toRegExp(pattern: string): ParsedStringPattern {
	try {
		const regExp = new RegExp(`^${parseRegExp(pattern)}$`);
		return function (path: string) {
			regExp.lastIndex = 0; // reset RegExp to its initial state to reuse it!
			return typeof path === 'string' && regExp.test(path) ? pattern : null;
		};
	} catch (error) {
		return NULL;
	}
}

/**
 * Simplified glob matching. Supports a subset of glob patterns:
 * - * matches anything inside a path segment
 * - ? matches 1 character inside a path segment
 * - ** matches anything including an empty path segment
 * - simple brace expansion ({js,ts} => js or ts)
 * - character ranges (using [...])
 */
export function match(pattern: string | IRelativePattern, path: string): boolean;
export function match(expression: IExpression, path: string, hasSibling?: (name: string) => boolean): string /* the matching pattern */;
export function match(arg1: string | IExpression | IRelativePattern, path: string, hasSibling?: (name: string) => boolean): boolean | string | null | Promise<string | null> {
	if (!arg1 || typeof path !== 'string') {
		return false;
	}

	return parse(<IExpression>arg1)(path, undefined, hasSibling);
}

/**
 * Simplified glob matching. Supports a subset of glob patterns:
 * - * matches anything inside a path segment
 * - ? matches 1 character inside a path segment
 * - ** matches anything including an empty path segment
 * - simple brace expansion ({js,ts} => js or ts)
 * - character ranges (using [...])
 */
export function parse(pattern: string | IRelativePattern, options?: IGlobOptions): ParsedPattern;
export function parse(expression: IExpression, options?: IGlobOptions): ParsedExpression;
export function parse(arg1: string | IExpression | IRelativePattern, options: IGlobOptions = {}): ParsedPattern | ParsedExpression {
	if (!arg1) {
		return FALSE;
	}

	// Glob with String
	if (typeof arg1 === 'string' || isRelativePattern(arg1)) {
		const parsedPattern = parsePattern(arg1, options);
		if (parsedPattern === NULL) {
			return FALSE;
		}
		const resultPattern: ParsedPattern & { allBasenames?: string[]; allPaths?: string[]; } = function (path: string, basename?: string) {
			return !!parsedPattern(path, basename);
		};
		if (parsedPattern.allBasenames) {
			resultPattern.allBasenames = parsedPattern.allBasenames;
		}
		if (parsedPattern.allPaths) {
			resultPattern.allPaths = parsedPattern.allPaths;
		}
		return resultPattern;
	}

	// Glob with Expression
	return parsedExpression(<IExpression>arg1, options);
}

export function hasSiblingPromiseFn(siblingsFn?: () => Promise<string[]>) {
	if (!siblingsFn) {
		return undefined;
	}

	let siblings: Promise<Record<string, true>>;
	return (name: string) => {
		if (!siblings) {
			siblings = (siblingsFn() || Promise.resolve([]))
				.then(list => list ? listToMap(list) : {});
		}
		return siblings.then(map => !!map[name]);
	};
}

export function hasSiblingFn(siblingsFn?: () => string[]) {
	if (!siblingsFn) {
		return undefined;
	}

	let siblings: Record<string, true>;
	return (name: string) => {
		if (!siblings) {
			const list = siblingsFn();
			siblings = list ? listToMap(list) : {};
		}
		return !!siblings[name];
	};
}

function listToMap(list: string[]) {
	const map: Record<string, true> = {};
	for (const key of list) {
		map[key] = true;
	}
	return map;
}

export function isRelativePattern(obj: unknown): obj is IRelativePattern {
	const rp = obj as IRelativePattern;

	return rp && typeof rp.base === 'string' && typeof rp.pattern === 'string';
}

export function getBasenameTerms(patternOrExpression: ParsedPattern | ParsedExpression): string[] {
	return (<ParsedStringPattern>patternOrExpression).allBasenames || [];
}

export function getPathTerms(patternOrExpression: ParsedPattern | ParsedExpression): string[] {
	return (<ParsedStringPattern>patternOrExpression).allPaths || [];
}

function parsedExpression(expression: IExpression, options: IGlobOptions): ParsedExpression {
	const parsedPatterns = aggregateBasenameMatches(Object.getOwnPropertyNames(expression)
		.map(pattern => parseExpressionPattern(pattern, expression[pattern], options))
		.filter(pattern => pattern !== NULL));

	const n = parsedPatterns.length;
	if (!n) {
		return NULL;
	}

	if (!parsedPatterns.some(parsedPattern => !!(<ParsedExpressionPattern>parsedPattern).requiresSiblings)) {
		if (n === 1) {
			return <ParsedStringPattern>parsedPatterns[0];
		}

		const resultExpression: ParsedStringPattern = function (path: string, basename?: string) {
			for (let i = 0, n = parsedPatterns.length; i < n; i++) {
				// Pattern matches path
				const result = (<ParsedStringPattern>parsedPatterns[i])(path, basename);
				if (result) {
					return result;
				}
			}

			return null;
		};

		const withBasenames = arrays.first(parsedPatterns, pattern => !!(<ParsedStringPattern>pattern).allBasenames);
		if (withBasenames) {
			resultExpression.allBasenames = (<ParsedStringPattern>withBasenames).allBasenames;
		}

		const allPaths = parsedPatterns.reduce((all, current) => current.allPaths ? all.concat(current.allPaths) : all, <string[]>[]);
		if (allPaths.length) {
			resultExpression.allPaths = allPaths;
		}

		return resultExpression;
	}

	const resultExpression: ParsedStringPattern = function (path: string, basename?: string, hasSibling?: (name: string) => boolean | Promise<boolean>) {
		let name: string | undefined = undefined;

		for (let i = 0, n = parsedPatterns.length; i < n; i++) {
			// Pattern matches path
			const parsedPattern = (<ParsedExpressionPattern>parsedPatterns[i]);
			if (parsedPattern.requiresSiblings && hasSibling) {
				if (!basename) {
					basename = paths.basename(path);
				}
				if (!name) {
					name = basename.substr(0, basename.length - paths.extname(path).length);
				}
			}
			const result = parsedPattern(path, basename, name, hasSibling);
			if (result) {
				return result;
			}
		}

		return null;
	};

	const withBasenames = arrays.first(parsedPatterns, pattern => !!(<ParsedStringPattern>pattern).allBasenames);
	if (withBasenames) {
		resultExpression.allBasenames = (<ParsedStringPattern>withBasenames).allBasenames;
	}

	const allPaths = parsedPatterns.reduce((all, current) => current.allPaths ? all.concat(current.allPaths) : all, <string[]>[]);
	if (allPaths.length) {
		resultExpression.allPaths = allPaths;
	}

	return resultExpression;
}

function parseExpressionPattern(pattern: string, value: boolean | SiblingClause, options: IGlobOptions): (ParsedStringPattern | ParsedExpressionPattern) {
	if (value === false) {
		return NULL; // pattern is disabled
	}

	const parsedPattern = parsePattern(pattern, options);
	if (parsedPattern === NULL) {
		return NULL;
	}

	// Expression Pattern is <boolean>
	if (typeof value === 'boolean') {
		return parsedPattern;
	}

	// Expression Pattern is <SiblingClause>
	if (value) {
		const when = (<SiblingClause>value).when;
		if (typeof when === 'string') {
			const result: ParsedExpressionPattern = (path: string, basename?: string, name?: string, hasSibling?: (name: string) => boolean | Promise<boolean>) => {
				if (!hasSibling || !parsedPattern(path, basename)) {
					return null;
				}

				const clausePattern = when.replace('$(basename)', name!);
				const matched = hasSibling(clausePattern);
				return isThenable(matched) ?
					matched.then(m => m ? pattern : null) :
					matched ? pattern : null;
			};
			result.requiresSiblings = true;
			return result;
		}
	}

	// Expression is Anything
	return parsedPattern;
}

function aggregateBasenameMatches(parsedPatterns: Array<ParsedStringPattern | ParsedExpressionPattern>, result?: string): Array<ParsedStringPattern | ParsedExpressionPattern> {
	const basenamePatterns = parsedPatterns.filter(parsedPattern => !!(<ParsedStringPattern>parsedPattern).basenames);
	if (basenamePatterns.length < 2) {
		return parsedPatterns;
	}

	const basenames = basenamePatterns.reduce<string[]>((all, current) => {
		const basenames = (<ParsedStringPattern>current).basenames;
		return basenames ? all.concat(basenames) : all;
	}, <string[]>[]);
	let patterns: string[];
	if (result) {
		patterns = [];
		for (let i = 0, n = basenames.length; i < n; i++) {
			patterns.push(result);
		}
	} else {
		patterns = basenamePatterns.reduce((all, current) => {
			const patterns = (<ParsedStringPattern>current).patterns;
			return patterns ? all.concat(patterns) : all;
		}, <string[]>[]);
	}
	const aggregate: ParsedStringPattern = function (path, basename) {
		if (typeof path !== 'string') {
			return null;
		}
		if (!basename) {
			let i: number;
			for (i = path.length; i > 0; i--) {
				const ch = path.charCodeAt(i - 1);
				if (ch === CharCode.Slash || ch === CharCode.Backslash) {
					break;
				}
			}
			basename = path.substr(i);
		}
		const index = basenames.indexOf(basename);
		return index !== -1 ? patterns[index] : null;
	};
	aggregate.basenames = basenames;
	aggregate.patterns = patterns;
	aggregate.allBasenames = basenames;

	const aggregatedPatterns = parsedPatterns.filter(parsedPattern => !(<ParsedStringPattern>parsedPattern).basenames);
	aggregatedPatterns.push(aggregate);
	return aggregatedPatterns;
}
