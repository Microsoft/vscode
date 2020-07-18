/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Create a syntax highighter with a fully declarative JSON style lexer description
 * using regular expressions.
 */

import { IDisposable } from 'vs/base/common/lifecycle';
import { Token, TokenizationResult, TokenizationResult2 } from 'vs/editor/common/core/token';
import * as modes from 'vs/editor/common/modes';
import { NULL_MODE_ID, NULL_STATE } from 'vs/editor/common/modes/nullMode';
import { TokenTheme } from 'vs/editor/common/modes/supports/tokenization';
import { IModeService } from 'vs/editor/common/services/modeService';
import * as monarchCommon from 'vs/editor/standalone/common/monarch/monarchCommon';
import { IStandaloneThemeService } from 'vs/editor/standalone/common/standaloneThemeService';

const CACHE_STACK_DEPTH = 5;

/**
 * Reuse the same stack elements up to a certain depth.
 */
class MonarchStackElementFactory {

	private static readonly _INSTANCE = new MonarchStackElementFactory(CACHE_STACK_DEPTH);
	public static create(parent: MonarchStackElement | null, state: string): MonarchStackElement {
		return this._INSTANCE.create(parent, state);
	}

	private readonly _maxCacheDepth: number;
	private readonly _entries: { [stackElementId: string]: MonarchStackElement; };

	constructor(maxCacheDepth: number) {
		this._maxCacheDepth = maxCacheDepth;
		this._entries = Object.create(null);
	}

	public create(parent: MonarchStackElement | null, state: string): MonarchStackElement {
		if (parent !== null && parent.depth >= this._maxCacheDepth) {
			// no caching above a certain depth
			return new MonarchStackElement(parent, state);
		}
		let stackElementId = MonarchStackElement.getStackElementId(parent);
		if (stackElementId.length > 0) {
			stackElementId += '|';
		}
		stackElementId += state;

		let result = this._entries[stackElementId];
		if (result) {
			return result;
		}
		result = new MonarchStackElement(parent, state);
		this._entries[stackElementId] = result;
		return result;
	}
}

class MonarchStackElement {

	public readonly parent: MonarchStackElement | null;
	public readonly state: string;
	public readonly depth: number;

	constructor(parent: MonarchStackElement | null, state: string) {
		this.parent = parent;
		this.state = state;
		this.depth = (this.parent ? this.parent.depth : 0) + 1;
	}

	public static getStackElementId(element: MonarchStackElement | null): string {
		let result = '';
		while (element !== null) {
			if (result.length > 0) {
				result += '|';
			}
			result += element.state;
			element = element.parent;
		}
		return result;
	}

	private static _equals(a: MonarchStackElement | null, b: MonarchStackElement | null): boolean {
		while (a !== null && b !== null) {
			if (a === b) {
				return true;
			}
			if (a.state !== b.state) {
				return false;
			}
			a = a.parent;
			b = b.parent;
		}
		if (a === null && b === null) {
			return true;
		}
		return false;
	}

	public equals(other: MonarchStackElement): boolean {
		return MonarchStackElement._equals(this, other);
	}

	public push(state: string): MonarchStackElement {
		return MonarchStackElementFactory.create(this, state);
	}

	public pop(): MonarchStackElement | null {
		return this.parent;
	}

	public popall(): MonarchStackElement {
		let result: MonarchStackElement = this;
		while (result.parent) {
			result = result.parent;
		}
		return result;
	}

	public switchTo(state: string): MonarchStackElement {
		return MonarchStackElementFactory.create(this.parent, state);
	}
}

class EmbeddedModeData {
	public readonly modeId: string;
	public readonly state: modes.IState;

	constructor(modeId: string, state: modes.IState) {
		this.modeId = modeId;
		this.state = state;
	}

	public equals(other: EmbeddedModeData): boolean {
		return (
			this.modeId === other.modeId
			&& this.state.equals(other.state)
		);
	}

	public clone(): EmbeddedModeData {
		let stateClone = this.state.clone();
		// save an object
		if (stateClone === this.state) {
			return this;
		}
		return new EmbeddedModeData(this.modeId, this.state);
	}
}

/**
 * Reuse the same line states up to a certain depth.
 */
class MonarchLineStateFactory {

	private static readonly _INSTANCE = new MonarchLineStateFactory(CACHE_STACK_DEPTH);
	public static create(stack: MonarchStackElement, embeddedModeData: EmbeddedModeData | null): MonarchLineState {
		return this._INSTANCE.create(stack, embeddedModeData);
	}

	private readonly _maxCacheDepth: number;
	private readonly _entries: { [stackElementId: string]: MonarchLineState; };

	constructor(maxCacheDepth: number) {
		this._maxCacheDepth = maxCacheDepth;
		this._entries = Object.create(null);
	}

	public create(stack: MonarchStackElement, embeddedModeData: EmbeddedModeData | null): MonarchLineState {
		if (embeddedModeData !== null) {
			// no caching when embedding
			return new MonarchLineState(stack, embeddedModeData);
		}
		if (stack !== null && stack.depth >= this._maxCacheDepth) {
			// no caching above a certain depth
			return new MonarchLineState(stack, embeddedModeData);
		}
		let stackElementId = MonarchStackElement.getStackElementId(stack);

		let result = this._entries[stackElementId];
		if (result) {
			return result;
		}
		result = new MonarchLineState(stack, null);
		this._entries[stackElementId] = result;
		return result;
	}
}

class MonarchLineState implements modes.IState {

	public readonly stack: MonarchStackElement;
	public readonly embeddedModeData: EmbeddedModeData | null;

	constructor(
		stack: MonarchStackElement,
		embeddedModeData: EmbeddedModeData | null
	) {
		this.stack = stack;
		this.embeddedModeData = embeddedModeData;
	}

	public clone(): modes.IState {
		let embeddedModeDataClone = this.embeddedModeData ? this.embeddedModeData.clone() : null;
		// save an object
		if (embeddedModeDataClone === this.embeddedModeData) {
			return this;
		}
		return MonarchLineStateFactory.create(this.stack, this.embeddedModeData);
	}

	public equals(other: modes.IState): boolean {
		if (!(other instanceof MonarchLineState)) {
			return false;
		}
		if (!this.stack.equals(other.stack)) {
			return false;
		}
		if (this.embeddedModeData === null && other.embeddedModeData === null) {
			return true;
		}
		if (this.embeddedModeData === null || other.embeddedModeData === null) {
			return false;
		}
		return this.embeddedModeData.equals(other.embeddedModeData);
	}
}

interface IMonarchTokensCollector {
	enterMode(startOffset: number, modeId: string): void;
	emit(startOffset: number, type: string): void;
	nestedModeTokenize(embeddedModeLine: string, embeddedModeData: EmbeddedModeData, offsetDelta: number): modes.IState;
}

class MonarchClassicTokensCollector implements IMonarchTokensCollector {

	private _tokens: Token[];
	private _language: string | null;
	private _lastTokenType: string | null;
	private _lastTokenLanguage: string | null;

	constructor() {
		this._tokens = [];
		this._language = null;
		this._lastTokenType = null;
		this._lastTokenLanguage = null;
	}

	public enterMode(startOffset: number, modeId: string): void {
		this._language = modeId;
	}

	public emit(startOffset: number, type: string): void {
		if (this._lastTokenType === type && this._lastTokenLanguage === this._language) {
			return;
		}
		this._lastTokenType = type;
		this._lastTokenLanguage = this._language;
		this._tokens.push(new Token(startOffset, type, this._language!));
	}

	public nestedModeTokenize(embeddedModeLine: string, embeddedModeData: EmbeddedModeData, offsetDelta: number): modes.IState {
		const nestedModeId = embeddedModeData.modeId;
		const embeddedModeState = embeddedModeData.state;

		const nestedModeTokenizationSupport = modes.TokenizationRegistry.get(nestedModeId);
		if (!nestedModeTokenizationSupport) {
			this.enterMode(offsetDelta, nestedModeId);
			this.emit(offsetDelta, '');
			return embeddedModeState;
		}

		let nestedResult = nestedModeTokenizationSupport.tokenize(embeddedModeLine, embeddedModeState, offsetDelta);
		this._tokens = this._tokens.concat(nestedResult.tokens);
		this._lastTokenType = null;
		this._lastTokenLanguage = null;
		this._language = null;
		return nestedResult.endState;
	}

	public finalize(endState: MonarchLineState): TokenizationResult {
		return new TokenizationResult(this._tokens, endState);
	}
}

class MonarchModernTokensCollector implements IMonarchTokensCollector {

	private readonly _modeService: IModeService;
	private readonly _theme: TokenTheme;
	private _prependTokens: Uint32Array | null;
	private _tokens: number[];
	private _currentLanguageId: modes.LanguageId;
	private _lastTokenMetadata: number;

	constructor(modeService: IModeService, theme: TokenTheme) {
		this._modeService = modeService;
		this._theme = theme;
		this._prependTokens = null;
		this._tokens = [];
		this._currentLanguageId = modes.LanguageId.Null;
		this._lastTokenMetadata = 0;
	}

	public enterMode(startOffset: number, modeId: string): void {
		this._currentLanguageId = this._modeService.getLanguageIdentifier(modeId)!.id;
	}

	public emit(startOffset: number, type: string): void {
		let metadata = this._theme.match(this._currentLanguageId, type);
		if (this._lastTokenMetadata === metadata) {
			return;
		}
		this._lastTokenMetadata = metadata;
		this._tokens.push(startOffset);
		this._tokens.push(metadata);
	}

	private static _merge(a: Uint32Array | null, b: number[], c: Uint32Array | null): Uint32Array {
		let aLen = (a !== null ? a.length : 0);
		let bLen = b.length;
		let cLen = (c !== null ? c.length : 0);

		if (aLen === 0 && bLen === 0 && cLen === 0) {
			return new Uint32Array(0);
		}
		if (aLen === 0 && bLen === 0) {
			return c!;
		}
		if (bLen === 0 && cLen === 0) {
			return a!;
		}

		let result = new Uint32Array(aLen + bLen + cLen);
		if (a !== null) {
			result.set(a);
		}
		for (let i = 0; i < bLen; i++) {
			result[aLen + i] = b[i];
		}
		if (c !== null) {
			result.set(c, aLen + bLen);
		}
		return result;
	}

	public nestedModeTokenize(embeddedModeLine: string, embeddedModeData: EmbeddedModeData, offsetDelta: number): modes.IState {
		const nestedModeId = embeddedModeData.modeId;
		const embeddedModeState = embeddedModeData.state;

		const nestedModeTokenizationSupport = modes.TokenizationRegistry.get(nestedModeId);
		if (!nestedModeTokenizationSupport) {
			this.enterMode(offsetDelta, nestedModeId);
			this.emit(offsetDelta, '');
			return embeddedModeState;
		}

		let nestedResult = nestedModeTokenizationSupport.tokenize2(embeddedModeLine, embeddedModeState, offsetDelta);
		this._prependTokens = MonarchModernTokensCollector._merge(this._prependTokens, this._tokens, nestedResult.tokens);
		this._tokens = [];
		this._currentLanguageId = 0;
		this._lastTokenMetadata = 0;
		return nestedResult.endState;
	}

	public finalize(endState: MonarchLineState): TokenizationResult2 {
		return new TokenizationResult2(
			MonarchModernTokensCollector._merge(this._prependTokens, this._tokens, null),
			endState
		);
	}
}

export type ILoadStatus = { loaded: true; } | { loaded: false; promise: Promise<void>; };

export class MonarchTokenizer implements modes.ITokenizationSupport {

	private readonly _modeService: IModeService;
	private readonly _standaloneThemeService: IStandaloneThemeService;
	private readonly _modeId: string;
	private readonly _lexer: monarchCommon.ILexer;
	private readonly _embeddedModes: { [modeId: string]: boolean; };
	public embeddedLoaded: Promise<void>;
	private readonly _tokenizationRegistryListener: IDisposable;

	constructor(modeService: IModeService, standaloneThemeService: IStandaloneThemeService, modeId: string, lexer: monarchCommon.ILexer) {
		this._modeService = modeService;
		this._standaloneThemeService = standaloneThemeService;
		this._modeId = modeId;
		this._lexer = lexer;
		this._embeddedModes = Object.create(null);
		this.embeddedLoaded = Promise.resolve(undefined);

		// Set up listening for embedded modes
		let emitting = false;
		this._tokenizationRegistryListener = modes.TokenizationRegistry.onDidChange((e) => {
			if (emitting) {
				return;
			}
			let isOneOfMyEmbeddedModes = false;
			for (let i = 0, len = e.changedLanguages.length; i < len; i++) {
				let language = e.changedLanguages[i];
				if (this._embeddedModes[language]) {
					isOneOfMyEmbeddedModes = true;
					break;
				}
			}
			if (isOneOfMyEmbeddedModes) {
				emitting = true;
				modes.TokenizationRegistry.fire([this._modeId]);
				emitting = false;
			}
		});
	}

	public dispose(): void {
		this._tokenizationRegistryListener.dispose();
	}

	public getLoadStatus(): ILoadStatus {
		let promises: Thenable<any>[] = [];
		for (let nestedModeId in this._embeddedModes) {
			const tokenizationSupport = modes.TokenizationRegistry.get(nestedModeId);
			if (tokenizationSupport) {
				// The nested mode is already loaded
				if (tokenizationSupport instanceof MonarchTokenizer) {
					const nestedModeStatus = tokenizationSupport.getLoadStatus();
					if (nestedModeStatus.loaded === false) {
						promises.push(nestedModeStatus.promise);
					}
				}
				continue;
			}

			const tokenizationSupportPromise = modes.TokenizationRegistry.getPromise(nestedModeId);
			if (tokenizationSupportPromise) {
				// The nested mode is in the process of being loaded
				promises.push(tokenizationSupportPromise);
			}
		}

		if (promises.length === 0) {
			return {
				loaded: true
			};
		}
		return {
			loaded: false,
			promise: Promise.all(promises).then(_ => undefined)
		};
	}

	public getInitialState(): modes.IState {
		let rootState = MonarchStackElementFactory.create(null, this._lexer.start!);
		return MonarchLineStateFactory.create(rootState, null);
	}

	public tokenize(line: string, lineState: modes.IState, offsetDelta: number): TokenizationResult {
		let tokensCollector = new MonarchClassicTokensCollector();
		let endLineState = this._tokenize(line, <MonarchLineState>lineState, offsetDelta, tokensCollector);
		return tokensCollector.finalize(endLineState);
	}

	public tokenize2(line: string, lineState: modes.IState, offsetDelta: number): TokenizationResult2 {
		let tokensCollector = new MonarchModernTokensCollector(this._modeService, this._standaloneThemeService.getColorTheme().tokenTheme);
		let endLineState = this._tokenize(line, <MonarchLineState>lineState, offsetDelta, tokensCollector);
		return tokensCollector.finalize(endLineState);
	}

	private _tokenize(line: string, lineState: MonarchLineState, offsetDelta: number, collector: IMonarchTokensCollector): MonarchLineState {
		if (lineState.embeddedModeData) {
			return this._nestedTokenize(line, lineState, offsetDelta, collector);
		} else {
			return this._myTokenize(line, lineState, offsetDelta, collector);
		}
	}

	private _findLeavingNestedModeOffset(line: string, state: MonarchLineState): number {
		let rules: monarchCommon.IRule[] | null = this._lexer.tokenizer[state.stack.state];
		if (!rules) {
			rules = monarchCommon.findRules(this._lexer, state.stack.state); // do parent matching
			if (!rules) {
				throw monarchCommon.createError(this._lexer, 'tokenizer state is not defined: ' + state.stack.state);
			}
		}

		let popOffset = -1;
		let hasEmbeddedPopRule = false;

		for (const rule of rules) {
			if (!monarchCommon.isIAction(rule.action) || rule.action.nextEmbedded !== '@pop') {
				continue;
			}
			hasEmbeddedPopRule = true;

			let regex = rule.regex;
			let regexSource = rule.regex.source;
			if (regexSource.substr(0, 4) === '^(?:' && regexSource.substr(regexSource.length - 1, 1) === ')') {
				let flags = (regex.ignoreCase ? 'i' : '') + (regex.unicode ? 'u' : '');
				regex = new RegExp(regexSource.substr(4, regexSource.length - 5), flags);
			}

			let result = line.search(regex);
			if (result === -1 || (result !== 0 && rule.matchOnlyAtLineStart)) {
				continue;
			}

			if (popOffset === -1 || result < popOffset) {
				popOffset = result;
			}
		}

		if (!hasEmbeddedPopRule) {
			throw monarchCommon.createError(this._lexer, 'no rule containing nextEmbedded: "@pop" in tokenizer embedded state: ' + state.stack.state);
		}

		return popOffset;
	}

	private _nestedTokenize(line: string, lineState: MonarchLineState, offsetDelta: number, tokensCollector: IMonarchTokensCollector): MonarchLineState {

		let popOffset = this._findLeavingNestedModeOffset(line, lineState);

		if (popOffset === -1) {
			// tokenization will not leave nested mode
			let nestedEndState = tokensCollector.nestedModeTokenize(line, lineState.embeddedModeData!, offsetDelta);
			return MonarchLineStateFactory.create(lineState.stack, new EmbeddedModeData(lineState.embeddedModeData!.modeId, nestedEndState));
		}

		let nestedModeLine = line.substring(0, popOffset);
		if (nestedModeLine.length > 0) {
			// tokenize with the nested mode
			tokensCollector.nestedModeTokenize(nestedModeLine, lineState.embeddedModeData!, offsetDelta);
		}

		let restOfTheLine = line.substring(popOffset);
		return this._myTokenize(restOfTheLine, lineState, offsetDelta + popOffset, tokensCollector);
	}

	private _safeRuleName(rule: monarchCommon.IRule | null): string {
		if (rule) {
			return rule.name;
		}
		return '(unknown)';
	}

	private _myTokenize(line: string, lineState: MonarchLineState, offsetDelta: number, tokensCollector: IMonarchTokensCollector): MonarchLineState {
		tokensCollector.enterMode(offsetDelta, this._modeId);

		const lineLength = line.length;

		let embeddedModeData = lineState.embeddedModeData;
		let stack = lineState.stack;
		let pos = 0;

		// regular expression group matching
		// these never need cloning or equality since they are only used within a line match
		interface GroupMatching {
			matches: string[];
			rule: monarchCommon.IRule | null;
			groups: { action: monarchCommon.FuzzyAction; matched: string; }[];
		}
		let groupMatching: GroupMatching | null = null;

		// See https://github.com/Microsoft/monaco-editor/issues/1235:
		// Evaluate rules at least once for an empty line
		let forceEvaluation = true;

		while (forceEvaluation || pos < lineLength) {

			const pos0 = pos;
			const stackLen0 = stack.depth;
			const groupLen0 = groupMatching ? groupMatching.groups.length : 0;
			const state = stack.state;

			let matches: string[] | null = null;
			let matched: string | null = null;
			let action: monarchCommon.FuzzyAction | monarchCommon.FuzzyAction[] | null = null;
			let rule: monarchCommon.IRule | null = null;

			let enteringEmbeddedMode: string | null = null;

			// check if we need to process group matches first
			if (groupMatching) {
				matches = groupMatching.matches;
				const groupEntry = groupMatching.groups.shift()!;
				matched = groupEntry.matched;
				action = groupEntry.action;
				rule = groupMatching.rule;

				// cleanup if necessary
				if (groupMatching.groups.length === 0) {
					groupMatching = null;
				}
			} else {
				// otherwise we match on the token stream

				if (!forceEvaluation && pos >= lineLength) {
					// nothing to do
					break;
				}

				forceEvaluation = false;

				// get the rules for this state
				let rules: monarchCommon.IRule[] | null = this._lexer.tokenizer[state];
				if (!rules) {
					rules = monarchCommon.findRules(this._lexer, state); // do parent matching
					if (!rules) {
						throw monarchCommon.createError(this._lexer, 'tokenizer state is not defined: ' + state);
					}
				}

				// try each rule until we match
				let restOfLine = line.substr(pos);
				for (const rule of rules) {
					if (pos === 0 || !rule.matchOnlyAtLineStart) {
						matches = restOfLine.match(rule.regex);
						if (matches) {
							matched = matches[0];
							action = rule.action;
							break;
						}
					}
				}
			}

			// We matched 'rule' with 'matches' and 'action'
			if (!matches) {
				matches = [''];
				matched = '';
			}

			if (!action) {
				// bad: we didn't match anything, and there is no action to take
				// we need to advance the stream or we get progress trouble
				if (pos < lineLength) {
					matches = [line.charAt(pos)];
					matched = matches[0];
				}
				action = this._lexer.defaultToken;
			}

			if (matched === null) {
				// should never happen, needed for strict null checking
				break;
			}

			// advance stream
			pos += matched.length;

			// maybe call action function (used for 'cases')
			while (monarchCommon.isFuzzyAction(action) && monarchCommon.isIAction(action) && action.test) {
				action = action.test(matched, matches, state, pos === lineLength);
			}

			let result: monarchCommon.FuzzyAction | monarchCommon.FuzzyAction[] | null = null;
			// set the result: either a string or an array of actions
			if (typeof action === 'string' || Array.isArray(action)) {
				result = action;
			} else if (action.group) {
				result = action.group;
			} else if (action.token !== null && action.token !== undefined) {

				// do $n replacements?
				if (action.tokenSubst) {
					result = monarchCommon.substituteMatches(this._lexer, action.token, matched, matches, state);
				} else {
					result = action.token;
				}

				// enter embedded mode?
				if (action.nextEmbedded) {
					if (action.nextEmbedded === '@pop') {
						if (!embeddedModeData) {
							throw monarchCommon.createError(this._lexer, 'cannot pop embedded mode if not inside one');
						}
						embeddedModeData = null;
					} else if (embeddedModeData) {
						throw monarchCommon.createError(this._lexer, 'cannot enter embedded mode from within an embedded mode');
					} else {
						enteringEmbeddedMode = monarchCommon.substituteMatches(this._lexer, action.nextEmbedded, matched, matches, state);
					}
				}

				// state transformations
				if (action.goBack) { // back up the stream..
					pos = Math.max(0, pos - action.goBack);
				}

				if (action.switchTo && typeof action.switchTo === 'string') {
					let nextState = monarchCommon.substituteMatches(this._lexer, action.switchTo, matched, matches, state);  // switch state without a push...
					if (nextState[0] === '@') {
						nextState = nextState.substr(1); // peel off starting '@'
					}
					if (!monarchCommon.findRules(this._lexer, nextState)) {
						throw monarchCommon.createError(this._lexer, 'trying to switch to a state \'' + nextState + '\' that is undefined in rule: ' + this._safeRuleName(rule));
					} else {
						stack = stack.switchTo(nextState);
					}
				} else if (action.transform && typeof action.transform === 'function') {
					throw monarchCommon.createError(this._lexer, 'action.transform not supported');
				} else if (action.next) {
					if (action.next === '@push') {
						if (stack.depth >= this._lexer.maxStack) {
							throw monarchCommon.createError(this._lexer, 'maximum tokenizer stack size reached: [' +
								stack.state + ',' + stack.parent!.state + ',...]');
						} else {
							stack = stack.push(state);
						}
					} else if (action.next === '@pop') {
						if (stack.depth <= 1) {
							throw monarchCommon.createError(this._lexer, 'trying to pop an empty stack in rule: ' + this._safeRuleName(rule));
						} else {
							stack = stack.pop()!;
						}
					} else if (action.next === '@popall') {
						stack = stack.popall();
					} else {
						let nextState = monarchCommon.substituteMatches(this._lexer, action.next, matched, matches, state);
						if (nextState[0] === '@') {
							nextState = nextState.substr(1); // peel off starting '@'
						}

						if (!monarchCommon.findRules(this._lexer, nextState)) {
							throw monarchCommon.createError(this._lexer, 'trying to set a next state \'' + nextState + '\' that is undefined in rule: ' + this._safeRuleName(rule));
						} else {
							stack = stack.push(nextState);
						}
					}
				}

				if (action.log && typeof (action.log) === 'string') {
					monarchCommon.log(this._lexer, this._lexer.languageId + ': ' + monarchCommon.substituteMatches(this._lexer, action.log, matched, matches, state));
				}
			}

			// check result
			if (result === null) {
				throw monarchCommon.createError(this._lexer, 'lexer rule has no well-defined action in rule: ' + this._safeRuleName(rule));
			}

			const computeNewStateForEmbeddedMode = (enteringEmbeddedMode: string) => {
				// substitute language alias to known modes to support syntax highlighting
				let enteringEmbeddedModeId = this._modeService.getModeIdForLanguageName(enteringEmbeddedMode);
				if (enteringEmbeddedModeId) {
					enteringEmbeddedMode = enteringEmbeddedModeId;
				}

				const embeddedModeData = this._getNestedEmbeddedModeData(enteringEmbeddedMode);

				if (pos < lineLength) {
					// there is content from the embedded mode on this line
					const restOfLine = line.substr(pos);
					return this._nestedTokenize(restOfLine, MonarchLineStateFactory.create(stack, embeddedModeData), offsetDelta + pos, tokensCollector);
				} else {
					return MonarchLineStateFactory.create(stack, embeddedModeData);
				}
			};

			// is the result a group match?
			if (Array.isArray(result)) {
				if (groupMatching && groupMatching.groups.length > 0) {
					throw monarchCommon.createError(this._lexer, 'groups cannot be nested: ' + this._safeRuleName(rule));
				}
				if (matches.length !== result.length + 1) {
					throw monarchCommon.createError(this._lexer, 'matched number of groups does not match the number of actions in rule: ' + this._safeRuleName(rule));
				}
				let totalLen = 0;
				for (let i = 1; i < matches.length; i++) {
					totalLen += matches[i].length;
				}
				if (totalLen !== matched.length) {
					throw monarchCommon.createError(this._lexer, 'with groups, all characters should be matched in consecutive groups in rule: ' + this._safeRuleName(rule));
				}

				groupMatching = {
					rule: rule,
					matches: matches,
					groups: []
				};
				for (let i = 0; i < result.length; i++) {
					groupMatching.groups[i] = {
						action: result[i],
						matched: matches[i + 1]
					};
				}

				pos -= matched.length;
				// call recursively to initiate first result match
				continue;
			} else {
				// regular result

				// check for '@rematch'
				if (result === '@rematch') {
					pos -= matched.length;
					matched = '';  // better set the next state too..
					matches = null;
					result = '';

					// Even though `@rematch` was specified, if `nextEmbedded` also specified,
					// a state transition should occur.
					if (enteringEmbeddedMode !== null) {
						return computeNewStateForEmbeddedMode(enteringEmbeddedMode);
					}
				}

				// check progress
				if (matched.length === 0) {
					if (lineLength === 0 || stackLen0 !== stack.depth || state !== stack.state || (!groupMatching ? 0 : groupMatching.groups.length) !== groupLen0) {
						continue;
					} else {
						throw monarchCommon.createError(this._lexer, 'no progress in tokenizer in rule: ' + this._safeRuleName(rule));
					}
				}

				// return the result (and check for brace matching)
				// todo: for efficiency we could pre-sanitize tokenPostfix and substitutions
				let tokenType: string | null = null;
				if (monarchCommon.isString(result) && result.indexOf('@brackets') === 0) {
					let rest = result.substr('@brackets'.length);
					let bracket = findBracket(this._lexer, matched);
					if (!bracket) {
						throw monarchCommon.createError(this._lexer, '@brackets token returned but no bracket defined as: ' + matched);
					}
					tokenType = monarchCommon.sanitize(bracket.token + rest);
				} else {
					let token = (result === '' ? '' : result + this._lexer.tokenPostfix);
					tokenType = monarchCommon.sanitize(token);
				}

				tokensCollector.emit(pos0 + offsetDelta, tokenType);
			}

			if (enteringEmbeddedMode !== null) {
				return computeNewStateForEmbeddedMode(enteringEmbeddedMode);
			}
		}

		return MonarchLineStateFactory.create(stack, embeddedModeData);
	}

	private _getNestedEmbeddedModeData(mimetypeOrModeId: string): EmbeddedModeData {
		let nestedModeId = this._locateMode(mimetypeOrModeId);
		if (nestedModeId) {
			let tokenizationSupport = modes.TokenizationRegistry.get(nestedModeId);
			if (tokenizationSupport) {
				return new EmbeddedModeData(nestedModeId, tokenizationSupport.getInitialState());
			}
		}

		return new EmbeddedModeData(nestedModeId || NULL_MODE_ID, NULL_STATE);
	}

	private _locateMode(mimetypeOrModeId: string): string | null {
		if (!mimetypeOrModeId || !this._modeService.isRegisteredMode(mimetypeOrModeId)) {
			return null;
		}

		if (mimetypeOrModeId === this._modeId) {
			// embedding myself...
			return mimetypeOrModeId;
		}

		let modeId = this._modeService.getModeId(mimetypeOrModeId);

		if (modeId) {
			// Fire mode loading event
			this._modeService.triggerMode(modeId);
			this._embeddedModes[modeId] = true;
		}

		return modeId;
	}

}

/**
 * Searches for a bracket in the 'brackets' attribute that matches the input.
 */
function findBracket(lexer: monarchCommon.ILexer, matched: string) {
	if (!matched) {
		return null;
	}
	matched = monarchCommon.fixCase(lexer, matched);

	let brackets = lexer.brackets;
	for (const bracket of brackets) {
		if (bracket.open === matched) {
			return { token: bracket.token, bracketType: monarchCommon.MonarchBracket.Open };
		}
		else if (bracket.close === matched) {
			return { token: bracket.token, bracketType: monarchCommon.MonarchBracket.Close };
		}
	}
	return null;
}

export function createTokenizationSupport(modeService: IModeService, standaloneThemeService: IStandaloneThemeService, modeId: string, lexer: monarchCommon.ILexer): modes.ITokenizationSupport {
	return new MonarchTokenizer(modeService, standaloneThemeService, modeId, lexer);
}
