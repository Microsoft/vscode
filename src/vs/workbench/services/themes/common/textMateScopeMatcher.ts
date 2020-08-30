/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

export interface MatcherWithPriority<T> {
	matcher: Matcher<T>;
	priority: -1 | 0 | 1;
}

export interface Matcher<T> {
	(matcherInput: T): number;
}

export function createMatchers<T>(selector: string, matchesName: (names: string[], matcherInput: T) => number, results: MatcherWithPriority<T>[]): void {
	const tokenizer = newTokenizer(selector);
	let token = tokenizer.next();
	while (token !== null) {
		let priority: -1 | 0 | 1 = 0;
		if (token.length === 2 && token.charAt(1) === ':') {
			switch (token.charAt(0)) {
				case 'R': priority = 1; break;
				case 'L': priority = -1; break;
				default:
					console.log(`Unknown priority ${token} in scope selector`);
			}
			token = tokenizer.next();
		}
		let matcher = parseConjunction();
		if (matcher) {
			results.push({ matcher, priority });
		}
		if (token !== ',') {
			break;
		}
		token = tokenizer.next();
	}

	function parseOperand(): Matcher<T> | null {
		if (token === '-') {
			token = tokenizer.next();
			const expressionToNegate = parseOperand();
			if (!expressionToNegate) {
				return null;
			}
			return matcherInput => {
				const score = expressionToNegate(matcherInput);
				return score < 0 ? 0 : -1;
			};
		}
		if (token === '(') {
			token = tokenizer.next();
			const expressionInParents = parseInnerExpression();
			if (token === ')') {
				token = tokenizer.next();
			}
			return expressionInParents;
		}
		if (isIdentifier(token)) {
			const identifiers: string[] = [];
			do {
				identifiers.push(token);
				token = tokenizer.next();
			} while (isIdentifier(token));
			return matcherInput => matchesName(identifiers, matcherInput);
		}
		return null;
	}
	function parseConjunction(): Matcher<T> | null {
		let matcher = parseOperand();
		if (!matcher) {
			return null;
		}

		const matchers: Matcher<T>[] = [];
		while (matcher) {
			matchers.push(matcher);
			matcher = parseOperand();
		}
		return matcherInput => {  // and
			let min = matchers[0](matcherInput);
			for (let i = 1; min >= 0 && i < matchers.length; i++) {
				min = Math.min(min, matchers[i](matcherInput));
			}
			return min;
		};
	}
	function parseInnerExpression(): Matcher<T> | null {
		let matcher = parseConjunction();
		if (!matcher) {
			return null;
		}
		const matchers: Matcher<T>[] = [];
		while (matcher) {
			matchers.push(matcher);
			if (token === '|' || token === ',') {
				do {
					token = tokenizer.next();
				} while (token === '|' || token === ','); // ignore subsequent commas
			} else {
				break;
			}
			matcher = parseConjunction();
		}
		return matcherInput => {  // or
			let max = matchers[0](matcherInput);
			for (let i = 1; i < matchers.length; i++) {
				max = Math.max(max, matchers[i](matcherInput));
			}
			return max;
		};
	}
}

function isIdentifier(token: string | null): token is string {
	return !!token && !!token.match(/[\w\.:]+/);
}

function newTokenizer(input: string): { next: () => string | null } {
	let regex = /([LR]:|[\w\.:][\w\.:\-]*|[\,\|\-\(\)])/g;
	let match = regex.exec(input);
	return {
		next: () => {
			if (!match) {
				return null;
			}
			const res = match[0];
			match = regex.exec(input);
			return res;
		}
	};
}
