/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { LineTokens } from 'vs/editor/common/core/lineTokens';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import { DEFAULT_WORD_REGEXP, ensureValidWordDefinition } from 'vs/editor/common/model/wordHelper';
import { LanguageId, LanguageIdentifier } from 'vs/editor/common/modes';
import { EnterAction, FoldingRules, IAutoClosingPair, IndentAction, IndentationRule, LanguageConfiguration, StandardAutoClosingPairConditional, CompleteEnterAction, AutoClosingPairs } from 'vs/editor/common/modes/languageConfiguration';
import { createScopedLineTokens, ScopedLineTokens } from 'vs/editor/common/modes/supports';
import { CharacterPairSupport } from 'vs/editor/common/modes/supports/characterPair';
import { BracketElectricCharacterSupport, IElectricAction } from 'vs/editor/common/modes/supports/electricCharacter';
import { IndentConsts, IndentRulesSupport } from 'vs/editor/common/modes/supports/indentRules';
import { OnEnterSupport } from 'vs/editor/common/modes/supports/onEnter';
import { RichEditBrackets } from 'vs/editor/common/modes/supports/richEditBrackets';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

/**
 * Interface used to support insertion of mode specific comments.
 */
export interface ICommentsConfiguration {
	lineCommentToken?: string;
	blockCommentStartToken?: string;
	blockCommentEndToken?: string;
}

export interface IVirtualModel {
	getLineTokens(lineNumber: number): LineTokens;
	getLanguageIdentifier(): LanguageIdentifier;
	getLanguageIdAtPosition(lineNumber: number, column: number): LanguageId;
	getLineContent(lineNumber: number): string;
}

export interface IIndentConverter {
	shiftIndent(indentation: string): string;
	unshiftIndent(indentation: string): string;
	normalizeIndentation?(indentation: string): string;
}

export class RichEditSupport {

	private readonly _conf: LanguageConfiguration;
	private readonly _languageIdentifier: LanguageIdentifier;
	private _brackets: RichEditBrackets | null;
	private _electricCharacter: BracketElectricCharacterSupport | null;
	private readonly _onEnterSupport: OnEnterSupport | null;

	public readonly comments: ICommentsConfiguration | null;
	public readonly characterPair: CharacterPairSupport;
	public readonly wordDefinition: RegExp;
	public readonly indentRulesSupport: IndentRulesSupport | null;
	public readonly indentationRules: IndentationRule | undefined;
	public readonly foldingRules: FoldingRules;

	constructor(languageIdentifier: LanguageIdentifier, previous: RichEditSupport | undefined, rawConf: LanguageConfiguration) {
		this._languageIdentifier = languageIdentifier;

		this._brackets = null;
		this._electricCharacter = null;

		let prev: LanguageConfiguration | null = null;
		if (previous) {
			prev = previous._conf;
		}

		this._conf = RichEditSupport._mergeConf(prev, rawConf);

		this._onEnterSupport = (this._conf.brackets || this._conf.indentationRules || this._conf.onEnterRules ? new OnEnterSupport(this._conf) : null);
		this.comments = RichEditSupport._handleComments(this._conf);

		this.characterPair = new CharacterPairSupport(this._conf);

		this.wordDefinition = this._conf.wordPattern || DEFAULT_WORD_REGEXP;

		this.indentationRules = this._conf.indentationRules;
		if (this._conf.indentationRules) {
			this.indentRulesSupport = new IndentRulesSupport(this._conf.indentationRules);
		} else {
			this.indentRulesSupport = null;
		}

		this.foldingRules = this._conf.folding || {};
	}

	public get brackets(): RichEditBrackets | null {
		if (!this._brackets && this._conf.brackets) {
			this._brackets = new RichEditBrackets(this._languageIdentifier, this._conf.brackets);
		}
		return this._brackets;
	}

	public get electricCharacter(): BracketElectricCharacterSupport | null {
		if (!this._electricCharacter) {
			this._electricCharacter = new BracketElectricCharacterSupport(this.brackets);
		}
		return this._electricCharacter;
	}

	public onEnter(autoIndent: EditorAutoIndentStrategy, oneLineAboveText: string, beforeEnterText: string, afterEnterText: string): EnterAction | null {
		if (!this._onEnterSupport) {
			return null;
		}
		return this._onEnterSupport.onEnter(autoIndent, oneLineAboveText, beforeEnterText, afterEnterText);
	}

	private static _mergeConf(prev: LanguageConfiguration | null, current: LanguageConfiguration): LanguageConfiguration {
		return {
			comments: (prev ? current.comments || prev.comments : current.comments),
			brackets: (prev ? current.brackets || prev.brackets : current.brackets),
			wordPattern: (prev ? current.wordPattern || prev.wordPattern : current.wordPattern),
			indentationRules: (prev ? current.indentationRules || prev.indentationRules : current.indentationRules),
			onEnterRules: (prev ? current.onEnterRules || prev.onEnterRules : current.onEnterRules),
			autoClosingPairs: (prev ? current.autoClosingPairs || prev.autoClosingPairs : current.autoClosingPairs),
			surroundingPairs: (prev ? current.surroundingPairs || prev.surroundingPairs : current.surroundingPairs),
			autoCloseBefore: (prev ? current.autoCloseBefore || prev.autoCloseBefore : current.autoCloseBefore),
			folding: (prev ? current.folding || prev.folding : current.folding),
			__electricCharacterSupport: (prev ? current.__electricCharacterSupport || prev.__electricCharacterSupport : current.__electricCharacterSupport),
		};
	}

	private static _handleComments(conf: LanguageConfiguration): ICommentsConfiguration | null {
		let commentRule = conf.comments;
		if (!commentRule) {
			return null;
		}

		// comment configuration
		let comments: ICommentsConfiguration = {};

		if (commentRule.lineComment) {
			comments.lineCommentToken = commentRule.lineComment;
		}
		if (commentRule.blockComment) {
			let [blockStart, blockEnd] = commentRule.blockComment;
			comments.blockCommentStartToken = blockStart;
			comments.blockCommentEndToken = blockEnd;
		}

		return comments;
	}
}

export class LanguageConfigurationChangeEvent {
	constructor(
		public readonly languageIdentifier: LanguageIdentifier
	) { }
}

export class LanguageConfigurationRegistryImpl {

	private readonly _entries = new Map<LanguageId, RichEditSupport | undefined>();

	private readonly _onDidChange = new Emitter<LanguageConfigurationChangeEvent>();
	public readonly onDidChange: Event<LanguageConfigurationChangeEvent> = this._onDidChange.event;

	public register(languageIdentifier: LanguageIdentifier, configuration: LanguageConfiguration): IDisposable {
		let previous = this._getRichEditSupport(languageIdentifier.id);
		let current = new RichEditSupport(languageIdentifier, previous, configuration);
		this._entries.set(languageIdentifier.id, current);
		this._onDidChange.fire(new LanguageConfigurationChangeEvent(languageIdentifier));
		return toDisposable(() => {
			if (this._entries.get(languageIdentifier.id) === current) {
				this._entries.set(languageIdentifier.id, previous);
				this._onDidChange.fire(new LanguageConfigurationChangeEvent(languageIdentifier));
			}
		});
	}

	private _getRichEditSupport(languageId: LanguageId): RichEditSupport | undefined {
		return this._entries.get(languageId);
	}

	public getIndentationRules(languageId: LanguageId) {
		const value = this._entries.get(languageId);

		if (!value) {
			return null;
		}

		return value.indentationRules || null;
	}

	// begin electricCharacter

	private _getElectricCharacterSupport(languageId: LanguageId): BracketElectricCharacterSupport | null {
		let value = this._getRichEditSupport(languageId);
		if (!value) {
			return null;
		}
		return value.electricCharacter || null;
	}

	public getElectricCharacters(languageId: LanguageId): string[] {
		let electricCharacterSupport = this._getElectricCharacterSupport(languageId);
		if (!electricCharacterSupport) {
			return [];
		}
		return electricCharacterSupport.getElectricCharacters();
	}

	/**
	 * Should return opening bracket type to match indentation with
	 */
	public onElectricCharacter(character: string, context: LineTokens, column: number): IElectricAction | null {
		let scopedLineTokens = createScopedLineTokens(context, column - 1);
		let electricCharacterSupport = this._getElectricCharacterSupport(scopedLineTokens.languageId);
		if (!electricCharacterSupport) {
			return null;
		}
		return electricCharacterSupport.onElectricCharacter(character, scopedLineTokens, column - scopedLineTokens.firstCharOffset);
	}

	// end electricCharacter

	public getComments(languageId: LanguageId): ICommentsConfiguration | null {
		let value = this._getRichEditSupport(languageId);
		if (!value) {
			return null;
		}
		return value.comments || null;
	}

	// begin characterPair

	private _getCharacterPairSupport(languageId: LanguageId): CharacterPairSupport | null {
		let value = this._getRichEditSupport(languageId);
		if (!value) {
			return null;
		}
		return value.characterPair || null;
	}

	public getAutoClosingPairs(languageId: LanguageId): AutoClosingPairs {
		const characterPairSupport = this._getCharacterPairSupport(languageId);
		return new AutoClosingPairs(characterPairSupport ? characterPairSupport.getAutoClosingPairs() : []);
	}

	public getAutoCloseBeforeSet(languageId: LanguageId): string {
		let characterPairSupport = this._getCharacterPairSupport(languageId);
		if (!characterPairSupport) {
			return CharacterPairSupport.DEFAULT_AUTOCLOSE_BEFORE_LANGUAGE_DEFINED;
		}
		return characterPairSupport.getAutoCloseBeforeSet();
	}

	public getSurroundingPairs(languageId: LanguageId): IAutoClosingPair[] {
		let characterPairSupport = this._getCharacterPairSupport(languageId);
		if (!characterPairSupport) {
			return [];
		}
		return characterPairSupport.getSurroundingPairs();
	}

	public shouldAutoClosePair(autoClosingPair: StandardAutoClosingPairConditional, context: LineTokens, column: number): boolean {
		const scopedLineTokens = createScopedLineTokens(context, column - 1);
		return CharacterPairSupport.shouldAutoClosePair(autoClosingPair, scopedLineTokens, column - scopedLineTokens.firstCharOffset);
	}

	// end characterPair

	public getWordDefinition(languageId: LanguageId): RegExp {
		let value = this._getRichEditSupport(languageId);
		if (!value) {
			return ensureValidWordDefinition(null);
		}
		return ensureValidWordDefinition(value.wordDefinition || null);
	}

	public getWordDefinitions(): [LanguageId, RegExp][] {
		let result: [LanguageId, RegExp][] = [];
		this._entries.forEach((value, language) => {
			if (value) {
				result.push([language, value.wordDefinition]);
			}
		});
		return result;
	}

	public getFoldingRules(languageId: LanguageId): FoldingRules {
		let value = this._getRichEditSupport(languageId);
		if (!value) {
			return {};
		}
		return value.foldingRules;
	}

	// begin Indent Rules

	public getIndentRulesSupport(languageId: LanguageId): IndentRulesSupport | null {
		let value = this._getRichEditSupport(languageId);
		if (!value) {
			return null;
		}
		return value.indentRulesSupport || null;
	}

	/**
	 * Get nearest preceiding line which doesn't match unIndentPattern or contains all whitespace.
	 * Result:
	 * -1: run into the boundary of embedded languages
	 * 0: every line above are invalid
	 * else: nearest preceding line of the same language
	 */
	private getPrecedingValidLine(model: IVirtualModel, lineNumber: number, indentRulesSupport: IndentRulesSupport) {
		let languageID = model.getLanguageIdAtPosition(lineNumber, 0);
		if (lineNumber > 1) {
			let lastLineNumber: number;
			let resultLineNumber = -1;

			for (lastLineNumber = lineNumber - 1; lastLineNumber >= 1; lastLineNumber--) {
				if (model.getLanguageIdAtPosition(lastLineNumber, 0) !== languageID) {
					return resultLineNumber;
				}
				let text = model.getLineContent(lastLineNumber);
				if (indentRulesSupport.shouldIgnore(text) || /^\s+$/.test(text) || text === '') {
					resultLineNumber = lastLineNumber;
					continue;
				}

				return lastLineNumber;
			}
		}

		return -1;
	}

	/**
	 * Get inherited indentation from above lines.
	 * 1. Find the nearest preceding line which doesn't match unIndentedLinePattern.
	 * 2. If this line matches indentNextLinePattern or increaseIndentPattern, it means that the indent level of `lineNumber` should be 1 greater than this line.
	 * 3. If this line doesn't match any indent rules
	 *   a. check whether the line above it matches indentNextLinePattern
	 *   b. If not, the indent level of this line is the result
	 *   c. If so, it means the indent of this line is *temporary*, go upward utill we find a line whose indent is not temporary (the same workflow a -> b -> c).
	 * 4. Otherwise, we fail to get an inherited indent from aboves. Return null and we should not touch the indent of `lineNumber`
	 *
	 * This function only return the inherited indent based on above lines, it doesn't check whether current line should decrease or not.
	 */
	public getInheritIndentForLine(autoIndent: EditorAutoIndentStrategy, model: IVirtualModel, lineNumber: number, honorIntentialIndent: boolean = true): { indentation: string; action: IndentAction | null; line?: number; } | null {
		if (autoIndent < EditorAutoIndentStrategy.Full) {
			return null;
		}

		const indentRulesSupport = this.getIndentRulesSupport(model.getLanguageIdentifier().id);
		if (!indentRulesSupport) {
			return null;
		}

		if (lineNumber <= 1) {
			return {
				indentation: '',
				action: null
			};
		}

		const precedingUnIgnoredLine = this.getPrecedingValidLine(model, lineNumber, indentRulesSupport);
		if (precedingUnIgnoredLine < 0) {
			return null;
		} else if (precedingUnIgnoredLine < 1) {
			return {
				indentation: '',
				action: null
			};
		}

		const precedingUnIgnoredLineContent = model.getLineContent(precedingUnIgnoredLine);
		if (indentRulesSupport.shouldIncrease(precedingUnIgnoredLineContent) || indentRulesSupport.shouldIndentNextLine(precedingUnIgnoredLineContent)) {
			return {
				indentation: strings.getLeadingWhitespace(precedingUnIgnoredLineContent),
				action: IndentAction.Indent,
				line: precedingUnIgnoredLine
			};
		} else if (indentRulesSupport.shouldDecrease(precedingUnIgnoredLineContent)) {
			return {
				indentation: strings.getLeadingWhitespace(precedingUnIgnoredLineContent),
				action: null,
				line: precedingUnIgnoredLine
			};
		} else {
			// precedingUnIgnoredLine can not be ignored.
			// it doesn't increase indent of following lines
			// it doesn't increase just next line
			// so current line is not affect by precedingUnIgnoredLine
			// and then we should get a correct inheritted indentation from above lines
			if (precedingUnIgnoredLine === 1) {
				return {
					indentation: strings.getLeadingWhitespace(model.getLineContent(precedingUnIgnoredLine)),
					action: null,
					line: precedingUnIgnoredLine
				};
			}

			const previousLine = precedingUnIgnoredLine - 1;

			const previousLineIndentMetadata = indentRulesSupport.getIndentMetadata(model.getLineContent(previousLine));
			if (!(previousLineIndentMetadata & (IndentConsts.INCREASE_MASK | IndentConsts.DECREASE_MASK)) &&
				(previousLineIndentMetadata & IndentConsts.INDENT_NEXTLINE_MASK)) {
				let stopLine = 0;
				for (let i = previousLine - 1; i > 0; i--) {
					if (indentRulesSupport.shouldIndentNextLine(model.getLineContent(i))) {
						continue;
					}
					stopLine = i;
					break;
				}

				return {
					indentation: strings.getLeadingWhitespace(model.getLineContent(stopLine + 1)),
					action: null,
					line: stopLine + 1
				};
			}

			if (honorIntentialIndent) {
				return {
					indentation: strings.getLeadingWhitespace(model.getLineContent(precedingUnIgnoredLine)),
					action: null,
					line: precedingUnIgnoredLine
				};
			} else {
				// search from precedingUnIgnoredLine until we find one whose indent is not temporary
				for (let i = precedingUnIgnoredLine; i > 0; i--) {
					const lineContent = model.getLineContent(i);
					if (indentRulesSupport.shouldIncrease(lineContent)) {
						return {
							indentation: strings.getLeadingWhitespace(lineContent),
							action: IndentAction.Indent,
							line: i
						};
					} else if (indentRulesSupport.shouldIndentNextLine(lineContent)) {
						let stopLine = 0;
						for (let j = i - 1; j > 0; j--) {
							if (indentRulesSupport.shouldIndentNextLine(model.getLineContent(i))) {
								continue;
							}
							stopLine = j;
							break;
						}

						return {
							indentation: strings.getLeadingWhitespace(model.getLineContent(stopLine + 1)),
							action: null,
							line: stopLine + 1
						};
					} else if (indentRulesSupport.shouldDecrease(lineContent)) {
						return {
							indentation: strings.getLeadingWhitespace(lineContent),
							action: null,
							line: i
						};
					}
				}

				return {
					indentation: strings.getLeadingWhitespace(model.getLineContent(1)),
					action: null,
					line: 1
				};
			}
		}
	}

	public getGoodIndentForLine(autoIndent: EditorAutoIndentStrategy, virtualModel: IVirtualModel, languageId: LanguageId, lineNumber: number, indentConverter: IIndentConverter): string | null {
		if (autoIndent < EditorAutoIndentStrategy.Full) {
			return null;
		}

		const richEditSupport = this._getRichEditSupport(languageId);
		if (!richEditSupport) {
			return null;
		}

		const indentRulesSupport = this.getIndentRulesSupport(languageId);
		if (!indentRulesSupport) {
			return null;
		}

		const indent = this.getInheritIndentForLine(autoIndent, virtualModel, lineNumber);
		const lineContent = virtualModel.getLineContent(lineNumber);

		if (indent) {
			const inheritLine = indent.line;
			if (inheritLine !== undefined) {
				const enterResult = richEditSupport.onEnter(autoIndent, '', virtualModel.getLineContent(inheritLine), '');

				if (enterResult) {
					let indentation = strings.getLeadingWhitespace(virtualModel.getLineContent(inheritLine));

					if (enterResult.removeText) {
						indentation = indentation.substring(0, indentation.length - enterResult.removeText);
					}

					if (
						(enterResult.indentAction === IndentAction.Indent) ||
						(enterResult.indentAction === IndentAction.IndentOutdent)
					) {
						indentation = indentConverter.shiftIndent(indentation);
					} else if (enterResult.indentAction === IndentAction.Outdent) {
						indentation = indentConverter.unshiftIndent(indentation);
					}

					if (indentRulesSupport.shouldDecrease(lineContent)) {
						indentation = indentConverter.unshiftIndent(indentation);
					}

					if (enterResult.appendText) {
						indentation += enterResult.appendText;
					}

					return strings.getLeadingWhitespace(indentation);
				}
			}

			if (indentRulesSupport.shouldDecrease(lineContent)) {
				if (indent.action === IndentAction.Indent) {
					return indent.indentation;
				} else {
					return indentConverter.unshiftIndent(indent.indentation);
				}
			} else {
				if (indent.action === IndentAction.Indent) {
					return indentConverter.shiftIndent(indent.indentation);
				} else {
					return indent.indentation;
				}
			}
		}
		return null;
	}

	public getIndentForEnter(autoIndent: EditorAutoIndentStrategy, model: ITextModel, range: Range, indentConverter: IIndentConverter): { beforeEnter: string, afterEnter: string } | null {
		if (autoIndent < EditorAutoIndentStrategy.Full) {
			return null;
		}
		model.forceTokenization(range.startLineNumber);
		const lineTokens = model.getLineTokens(range.startLineNumber);
		const scopedLineTokens = createScopedLineTokens(lineTokens, range.startColumn - 1);
		const scopedLineText = scopedLineTokens.getLineContent();

		let embeddedLanguage = false;
		let beforeEnterText: string;
		if (scopedLineTokens.firstCharOffset > 0 && lineTokens.getLanguageId(0) !== scopedLineTokens.languageId) {
			// we are in the embeded language content
			embeddedLanguage = true; // if embeddedLanguage is true, then we don't touch the indentation of current line
			beforeEnterText = scopedLineText.substr(0, range.startColumn - 1 - scopedLineTokens.firstCharOffset);
		} else {
			beforeEnterText = lineTokens.getLineContent().substring(0, range.startColumn - 1);
		}

		let afterEnterText: string;
		if (range.isEmpty()) {
			afterEnterText = scopedLineText.substr(range.startColumn - 1 - scopedLineTokens.firstCharOffset);
		} else {
			const endScopedLineTokens = this.getScopedLineTokens(model, range.endLineNumber, range.endColumn);
			afterEnterText = endScopedLineTokens.getLineContent().substr(range.endColumn - 1 - scopedLineTokens.firstCharOffset);
		}

		const indentRulesSupport = this.getIndentRulesSupport(scopedLineTokens.languageId);
		if (!indentRulesSupport) {
			return null;
		}

		const beforeEnterResult = beforeEnterText;
		const beforeEnterIndent = strings.getLeadingWhitespace(beforeEnterText);

		const virtualModel: IVirtualModel = {
			getLineTokens: (lineNumber: number) => {
				return model.getLineTokens(lineNumber);
			},
			getLanguageIdentifier: () => {
				return model.getLanguageIdentifier();
			},
			getLanguageIdAtPosition: (lineNumber: number, column: number) => {
				return model.getLanguageIdAtPosition(lineNumber, column);
			},
			getLineContent: (lineNumber: number) => {
				if (lineNumber === range.startLineNumber) {
					return beforeEnterResult;
				} else {
					return model.getLineContent(lineNumber);
				}
			}
		};

		const currentLineIndent = strings.getLeadingWhitespace(lineTokens.getLineContent());
		const afterEnterAction = this.getInheritIndentForLine(autoIndent, virtualModel, range.startLineNumber + 1);
		if (!afterEnterAction) {
			const beforeEnter = embeddedLanguage ? currentLineIndent : beforeEnterIndent;
			return {
				beforeEnter: beforeEnter,
				afterEnter: beforeEnter
			};
		}

		let afterEnterIndent = embeddedLanguage ? currentLineIndent : afterEnterAction.indentation;

		if (afterEnterAction.action === IndentAction.Indent) {
			afterEnterIndent = indentConverter.shiftIndent(afterEnterIndent);
		}

		if (indentRulesSupport.shouldDecrease(afterEnterText)) {
			afterEnterIndent = indentConverter.unshiftIndent(afterEnterIndent);
		}

		return {
			beforeEnter: embeddedLanguage ? currentLineIndent : beforeEnterIndent,
			afterEnter: afterEnterIndent
		};
	}

	/**
	 * We should always allow intentional indentation. It means, if users change the indentation of `lineNumber` and the content of
	 * this line doesn't match decreaseIndentPattern, we should not adjust the indentation.
	 */
	public getIndentActionForType(autoIndent: EditorAutoIndentStrategy, model: ITextModel, range: Range, ch: string, indentConverter: IIndentConverter): string | null {
		if (autoIndent < EditorAutoIndentStrategy.Full) {
			return null;
		}
		const scopedLineTokens = this.getScopedLineTokens(model, range.startLineNumber, range.startColumn);

		if (scopedLineTokens.firstCharOffset) {
			// this line has mixed languages and indentation rules will not work
			return null;
		}

		const indentRulesSupport = this.getIndentRulesSupport(scopedLineTokens.languageId);
		if (!indentRulesSupport) {
			return null;
		}

		const scopedLineText = scopedLineTokens.getLineContent();
		const beforeTypeText = scopedLineText.substr(0, range.startColumn - 1 - scopedLineTokens.firstCharOffset);

		// selection support
		let afterTypeText: string;
		if (range.isEmpty()) {
			afterTypeText = scopedLineText.substr(range.startColumn - 1 - scopedLineTokens.firstCharOffset);
		} else {
			const endScopedLineTokens = this.getScopedLineTokens(model, range.endLineNumber, range.endColumn);
			afterTypeText = endScopedLineTokens.getLineContent().substr(range.endColumn - 1 - scopedLineTokens.firstCharOffset);
		}

		// If previous content already matches decreaseIndentPattern, it means indentation of this line should already be adjusted
		// Users might change the indentation by purpose and we should honor that instead of readjusting.
		if (!indentRulesSupport.shouldDecrease(beforeTypeText + afterTypeText) && indentRulesSupport.shouldDecrease(beforeTypeText + ch + afterTypeText)) {
			// after typing `ch`, the content matches decreaseIndentPattern, we should adjust the indent to a good manner.
			// 1. Get inherited indent action
			const r = this.getInheritIndentForLine(autoIndent, model, range.startLineNumber, false);
			if (!r) {
				return null;
			}

			let indentation = r.indentation;
			if (r.action !== IndentAction.Indent) {
				indentation = indentConverter.unshiftIndent(indentation);
			}

			return indentation;
		}

		return null;
	}

	public getIndentMetadata(model: ITextModel, lineNumber: number): number | null {
		const indentRulesSupport = this.getIndentRulesSupport(model.getLanguageIdentifier().id);
		if (!indentRulesSupport) {
			return null;
		}
		if (lineNumber < 1 || lineNumber > model.getLineCount()) {
			return null;
		}
		return indentRulesSupport.getIndentMetadata(model.getLineContent(lineNumber));
	}

	// end Indent Rules

	// begin onEnter

	public getEnterAction(autoIndent: EditorAutoIndentStrategy, model: ITextModel, range: Range): CompleteEnterAction | null {
		const scopedLineTokens = this.getScopedLineTokens(model, range.startLineNumber, range.startColumn);
		const richEditSupport = this._getRichEditSupport(scopedLineTokens.languageId);
		if (!richEditSupport) {
			return null;
		}

		const scopedLineText = scopedLineTokens.getLineContent();
		const beforeEnterText = scopedLineText.substr(0, range.startColumn - 1 - scopedLineTokens.firstCharOffset);

		// selection support
		let afterEnterText: string;
		if (range.isEmpty()) {
			afterEnterText = scopedLineText.substr(range.startColumn - 1 - scopedLineTokens.firstCharOffset);
		} else {
			const endScopedLineTokens = this.getScopedLineTokens(model, range.endLineNumber, range.endColumn);
			afterEnterText = endScopedLineTokens.getLineContent().substr(range.endColumn - 1 - scopedLineTokens.firstCharOffset);
		}

		let oneLineAboveText = '';
		if (range.startLineNumber > 1 && scopedLineTokens.firstCharOffset === 0) {
			// This is not the first line and the entire line belongs to this mode
			const oneLineAboveScopedLineTokens = this.getScopedLineTokens(model, range.startLineNumber - 1);
			if (oneLineAboveScopedLineTokens.languageId === scopedLineTokens.languageId) {
				// The line above ends with text belonging to the same mode
				oneLineAboveText = oneLineAboveScopedLineTokens.getLineContent();
			}
		}

		const enterResult = richEditSupport.onEnter(autoIndent, oneLineAboveText, beforeEnterText, afterEnterText);
		if (!enterResult) {
			return null;
		}

		const indentAction = enterResult.indentAction;
		let appendText = enterResult.appendText;
		const removeText = enterResult.removeText || 0;

		// Here we add `\t` to appendText first because enterAction is leveraging appendText and removeText to change indentation.
		if (!appendText) {
			if (
				(indentAction === IndentAction.Indent) ||
				(indentAction === IndentAction.IndentOutdent)
			) {
				appendText = '\t';
			} else {
				appendText = '';
			}
		}

		let indentation = this.getIndentationAtPosition(model, range.startLineNumber, range.startColumn);
		if (removeText) {
			indentation = indentation.substring(0, indentation.length - removeText);
		}

		return {
			indentAction: indentAction,
			appendText: appendText,
			removeText: removeText,
			indentation: indentation
		};
	}

	public getIndentationAtPosition(model: ITextModel, lineNumber: number, column: number): string {
		const lineText = model.getLineContent(lineNumber);
		let indentation = strings.getLeadingWhitespace(lineText);
		if (indentation.length > column - 1) {
			indentation = indentation.substring(0, column - 1);
		}
		return indentation;
	}

	private getScopedLineTokens(model: ITextModel, lineNumber: number, columnNumber?: number): ScopedLineTokens {
		model.forceTokenization(lineNumber);
		const lineTokens = model.getLineTokens(lineNumber);
		const column = (typeof columnNumber === 'undefined' ? model.getLineMaxColumn(lineNumber) - 1 : columnNumber - 1);
		return createScopedLineTokens(lineTokens, column);
	}

	// end onEnter

	public getBracketsSupport(languageId: LanguageId): RichEditBrackets | null {
		const value = this._getRichEditSupport(languageId);
		if (!value) {
			return null;
		}
		return value.brackets || null;
	}
}

export const LanguageConfigurationRegistry = new LanguageConfigurationRegistryImpl();
