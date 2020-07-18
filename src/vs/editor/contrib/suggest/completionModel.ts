/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fuzzyScore, fuzzyScoreGracefulAggressive, FuzzyScorer, FuzzyScore, anyScore } from 'vs/base/common/filters';
import { CompletionItemProvider, CompletionItemKind } from 'vs/editor/common/modes';
import { CompletionItem } from './suggest';
import { InternalSuggestOptions } from 'vs/editor/common/config/editorOptions';
import { WordDistance } from 'vs/editor/contrib/suggest/wordDistance';
import { CharCode } from 'vs/base/common/charCode';
import { compareIgnoreCase } from 'vs/base/common/strings';

type StrictCompletionItem = Required<CompletionItem>;

/* __GDPR__FRAGMENT__
	"ICompletionStats" : {
		"suggestionCount" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"snippetCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"textCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
	}
*/
// __GDPR__TODO__: This is a dynamically extensible structure which can not be declared statically.
export interface ICompletionStats {
	suggestionCount: number;
	snippetCount: number;
	textCount: number;
	[name: string]: any;
}

export class LineContext {
	constructor(
		readonly leadingLineContent: string,
		readonly characterCountDelta: number,
	) { }
}

const enum Refilter {
	Nothing = 0,
	All = 1,
	Incr = 2
}

/**
 * Sorted, filtered completion view model
 * */
export class CompletionModel {

	private readonly _items: CompletionItem[];
	private readonly _column: number;
	private readonly _wordDistance: WordDistance;
	private readonly _options: InternalSuggestOptions;
	private readonly _snippetCompareFn = CompletionModel._compareCompletionItems;

	private _lineContext: LineContext;
	private _refilterKind: Refilter;
	private _filteredItems?: StrictCompletionItem[];
	private _isIncomplete?: Set<CompletionItemProvider>;
	private _stats?: ICompletionStats;

	constructor(
		items: CompletionItem[],
		column: number,
		lineContext: LineContext,
		wordDistance: WordDistance,
		options: InternalSuggestOptions,
		snippetSuggestions: 'top' | 'bottom' | 'inline' | 'none',
		readonly clipboardText: string | undefined
	) {
		this._items = items;
		this._column = column;
		this._wordDistance = wordDistance;
		this._options = options;
		this._refilterKind = Refilter.All;
		this._lineContext = lineContext;

		if (snippetSuggestions === 'top') {
			this._snippetCompareFn = CompletionModel._compareCompletionItemsSnippetsUp;
		} else if (snippetSuggestions === 'bottom') {
			this._snippetCompareFn = CompletionModel._compareCompletionItemsSnippetsDown;
		}
	}

	get lineContext(): LineContext {
		return this._lineContext;
	}

	set lineContext(value: LineContext) {
		if (this._lineContext.leadingLineContent !== value.leadingLineContent
			|| this._lineContext.characterCountDelta !== value.characterCountDelta
		) {
			this._refilterKind = this._lineContext.characterCountDelta < value.characterCountDelta && this._filteredItems ? Refilter.Incr : Refilter.All;
			this._lineContext = value;
		}
	}

	get items(): CompletionItem[] {
		this._ensureCachedState();
		return this._filteredItems!;
	}

	get incomplete(): Set<CompletionItemProvider> {
		this._ensureCachedState();
		return this._isIncomplete!;
	}

	adopt(except: Set<CompletionItemProvider>): CompletionItem[] {
		let res: CompletionItem[] = [];
		for (let i = 0; i < this._items.length;) {
			if (!except.has(this._items[i].provider)) {
				res.push(this._items[i]);

				// unordered removed
				this._items[i] = this._items[this._items.length - 1];
				this._items.pop();
			} else {
				// continue with next item
				i++;
			}
		}
		this._refilterKind = Refilter.All;
		return res;
	}

	get stats(): ICompletionStats {
		this._ensureCachedState();
		return this._stats!;
	}

	private _ensureCachedState(): void {
		if (this._refilterKind !== Refilter.Nothing) {
			this._createCachedState();
		}
	}

	private _createCachedState(): void {

		this._isIncomplete = new Set();
		this._stats = { suggestionCount: 0, snippetCount: 0, textCount: 0 };

		const { leadingLineContent, characterCountDelta } = this._lineContext;
		let word = '';
		let wordLow = '';

		// incrementally filter less
		const source = this._refilterKind === Refilter.All ? this._items : this._filteredItems!;
		const target: StrictCompletionItem[] = [];

		// picks a score function based on the number of
		// items that we have to score/filter and based on the
		// user-configuration
		const scoreFn: FuzzyScorer = (!this._options.filterGraceful || source.length > 2000) ? fuzzyScore : fuzzyScoreGracefulAggressive;

		for (let i = 0; i < source.length; i++) {

			const item = source[i];

			if (item.isInvalid) {
				continue; // SKIP invalid items
			}

			// collect those supports that signaled having
			// an incomplete result
			if (item.container.incomplete) {
				this._isIncomplete.add(item.provider);
			}

			// 'word' is that remainder of the current line that we
			// filter and score against. In theory each suggestion uses a
			// different word, but in practice not - that's why we cache
			const overwriteBefore = item.position.column - item.editStart.column;
			const wordLen = overwriteBefore + characterCountDelta - (item.position.column - this._column);
			if (word.length !== wordLen) {
				word = wordLen === 0 ? '' : leadingLineContent.slice(-wordLen);
				wordLow = word.toLowerCase();
			}

			// remember the word against which this item was
			// scored
			item.word = word;

			if (wordLen === 0) {
				// when there is nothing to score against, don't
				// event try to do. Use a const rank and rely on
				// the fallback-sort using the initial sort order.
				// use a score of `-100` because that is out of the
				// bound of values `fuzzyScore` will return
				item.score = FuzzyScore.Default;

			} else {
				// skip word characters that are whitespace until
				// we have hit the replace range (overwriteBefore)
				let wordPos = 0;
				while (wordPos < overwriteBefore) {
					const ch = word.charCodeAt(wordPos);
					if (ch === CharCode.Space || ch === CharCode.Tab) {
						wordPos += 1;
					} else {
						break;
					}
				}

				const textLabel = typeof item.completion.label === 'string' ? item.completion.label : item.completion.label.name;
				if (wordPos >= wordLen) {
					// the wordPos at which scoring starts is the whole word
					// and therefore the same rules as not having a word apply
					item.score = FuzzyScore.Default;

				} else if (typeof item.completion.filterText === 'string') {
					// when there is a `filterText` it must match the `word`.
					// if it matches we check with the label to compute highlights
					// and if that doesn't yield a result we have no highlights,
					// despite having the match
					let match = scoreFn(word, wordLow, wordPos, item.completion.filterText, item.filterTextLow!, 0, false);
					if (!match) {
						continue; // NO match
					}
					if (compareIgnoreCase(item.completion.filterText, textLabel) === 0) {
						// filterText and label are actually the same -> use good highlights
						item.score = match;
					} else {
						// re-run the scorer on the label in the hope of a result BUT use the rank
						// of the filterText-match
						item.score = anyScore(word, wordLow, wordPos, textLabel, item.labelLow, 0);
						item.score[0] = match[0]; // use score from filterText
					}

				} else {
					// by default match `word` against the `label`
					let match = scoreFn(word, wordLow, wordPos, textLabel, item.labelLow, 0, false);
					if (!match) {
						continue; // NO match
					}
					item.score = match;
				}
			}

			item.idx = i;
			item.distance = this._wordDistance.distance(item.position, item.completion);
			target.push(item as StrictCompletionItem);

			// update stats
			this._stats.suggestionCount++;
			switch (item.completion.kind) {
				case CompletionItemKind.Snippet: this._stats.snippetCount++; break;
				case CompletionItemKind.Text: this._stats.textCount++; break;
			}
		}

		this._filteredItems = target.sort(this._snippetCompareFn);
		this._refilterKind = Refilter.Nothing;
	}

	private static _compareCompletionItems(a: StrictCompletionItem, b: StrictCompletionItem): number {
		if (a.score[0] > b.score[0]) {
			return -1;
		} else if (a.score[0] < b.score[0]) {
			return 1;
		} else if (a.distance < b.distance) {
			return -1;
		} else if (a.distance > b.distance) {
			return 1;
		} else if (a.idx < b.idx) {
			return -1;
		} else if (a.idx > b.idx) {
			return 1;
		} else {
			return 0;
		}
	}

	private static _compareCompletionItemsSnippetsDown(a: StrictCompletionItem, b: StrictCompletionItem): number {
		if (a.completion.kind !== b.completion.kind) {
			if (a.completion.kind === CompletionItemKind.Snippet) {
				return 1;
			} else if (b.completion.kind === CompletionItemKind.Snippet) {
				return -1;
			}
		}
		return CompletionModel._compareCompletionItems(a, b);
	}

	private static _compareCompletionItemsSnippetsUp(a: StrictCompletionItem, b: StrictCompletionItem): number {
		if (a.completion.kind !== b.completion.kind) {
			if (a.completion.kind === CompletionItemKind.Snippet) {
				return -1;
			} else if (b.completion.kind === CompletionItemKind.Snippet) {
				return 1;
			}
		}
		return CompletionModel._compareCompletionItems(a, b);
	}
}
