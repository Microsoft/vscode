/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import { flatten, mapArrayOrNot } from 'vs/base/common/arrays';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import * as resources from 'vs/base/common/resources';
import * as glob from 'vs/base/common/glob';
import { URI } from 'vs/base/common/uri';
import { IExtendedExtensionSearchOptions, IFileMatch, IFolderQuery, IPatternInfo, ISearchCompleteStats, ITextQuery, ITextSearchContext, ITextSearchMatch, ITextSearchResult, QueryGlobTester, resolvePatternsForProvider } from 'vs/workbench/services/search/common/search';
import { TextSearchProvider, TextSearchResult, TextSearchMatch, TextSearchComplete, Range, TextSearchOptions, TextSearchQuery } from 'vs/workbench/services/search/common/searchExtTypes';
import { Schemas } from 'vs/base/common/network';
import { isArray } from 'vs/base/common/types';

export interface IFileUtils {
	readdir: (resource: URI) => Promise<string[]>;
	toCanonicalName: (encoding: string) => string;
}

export class TextSearchManager {

	private collector: TextSearchResultsCollector | null = null;

	private isLimitHit = false;
	private resultCount = 0;

	constructor(private query: ITextQuery, private provider: TextSearchProvider, private fileUtils: IFileUtils) { }

	search(onProgress: (matches: IFileMatch[]) => void, token: CancellationToken): Promise<ISearchCompleteStats> {
		const folderQueries = this.query.folderQueries || [];
		const tokenSource = new CancellationTokenSource();
		token.onCancellationRequested(() => tokenSource.cancel());

		return new Promise<ISearchCompleteStats>((resolve, reject) => {
			this.collector = new TextSearchResultsCollector(onProgress);

			let isCanceled = false;
			const onResult = (result: TextSearchResult, folderIdx: number) => {
				if (isCanceled) {
					return;
				}

				if (!this.isLimitHit) {
					const resultSize = this.resultSize(result);
					if (extensionResultIsMatch(result) && typeof this.query.maxResults === 'number' && this.resultCount + resultSize > this.query.maxResults) {
						this.isLimitHit = true;
						isCanceled = true;
						tokenSource.cancel();

						result = this.trimResultToSize(result, this.query.maxResults - this.resultCount);
					}

					const newResultSize = this.resultSize(result);
					this.resultCount += newResultSize;
					if (newResultSize > 0 || !extensionResultIsMatch(result)) {
						this.collector!.add(result, folderIdx);
					}
				}
			};

			// For each root folder
			Promise.all(folderQueries.map((fq, i) => {
				return this.searchInFolder(fq, r => onResult(r, i), tokenSource.token);
			})).then(results => {
				tokenSource.dispose();
				this.collector!.flush();

				const someFolderHitLImit = results.some(result => !!result && !!result.limitHit);
				resolve({
					limitHit: this.isLimitHit || someFolderHitLImit,
					messages: flatten(results.map(result => {
						if (!result?.message) { return []; }
						if (isArray(result.message)) { return result.message; }
						else { return [result.message]; }
					})),
					stats: {
						type: 'textSearchProvider'
					}
				});
			}, (err: Error) => {
				tokenSource.dispose();
				const errMsg = toErrorMessage(err);
				reject(new Error(errMsg));
			});
		});
	}

	private resultSize(result: TextSearchResult): number {
		if (extensionResultIsMatch(result)) {
			return Array.isArray(result.ranges) ?
				result.ranges.length :
				1;
		}
		else {
			// #104400 context lines shoudn't count towards result count
			return 0;
		}
	}

	private trimResultToSize(result: TextSearchMatch, size: number): TextSearchMatch {
		const rangesArr = Array.isArray(result.ranges) ? result.ranges : [result.ranges];
		const matchesArr = Array.isArray(result.preview.matches) ? result.preview.matches : [result.preview.matches];

		return {
			ranges: rangesArr.slice(0, size),
			preview: {
				matches: matchesArr.slice(0, size),
				text: result.preview.text
			},
			uri: result.uri
		};
	}

	private async searchInFolder(folderQuery: IFolderQuery<URI>, onResult: (result: TextSearchResult) => void, token: CancellationToken): Promise<TextSearchComplete | null | undefined> {
		const queryTester = new QueryGlobTester(this.query, folderQuery);
		const testingPs: Promise<void>[] = [];
		const progress = {
			report: (result: TextSearchResult) => {
				if (!this.validateProviderResult(result)) {
					return;
				}

				const hasSibling = folderQuery.folder.scheme === Schemas.file ?
					glob.hasSiblingPromiseFn(() => {
						return this.fileUtils.readdir(resources.dirname(result.uri));
					}) :
					undefined;

				const relativePath = resources.relativePath(folderQuery.folder, result.uri);
				if (relativePath) {
					testingPs.push(
						queryTester.includedInQuery(relativePath, path.basename(relativePath), hasSibling)
							.then(included => {
								if (included) {
									onResult(result);
								}
							}));
				}
			}
		};

		const searchOptions = this.getSearchOptionsForFolder(folderQuery);
		const result = await this.provider.provideTextSearchResults(patternInfoToQuery(this.query.contentPattern), searchOptions, progress, token);
		await Promise.all(testingPs);
		return result;
	}

	private validateProviderResult(result: TextSearchResult): boolean {
		if (extensionResultIsMatch(result)) {
			if (Array.isArray(result.ranges)) {
				if (!Array.isArray(result.preview.matches)) {
					console.warn('INVALID - A text search provider match\'s`ranges` and`matches` properties must have the same type.');
					return false;
				}

				if ((<Range[]>result.preview.matches).length !== result.ranges.length) {
					console.warn('INVALID - A text search provider match\'s`ranges` and`matches` properties must have the same length.');
					return false;
				}
			} else {
				if (Array.isArray(result.preview.matches)) {
					console.warn('INVALID - A text search provider match\'s`ranges` and`matches` properties must have the same length.');
					return false;
				}
			}
		}

		return true;
	}

	private getSearchOptionsForFolder(fq: IFolderQuery<URI>): TextSearchOptions {
		const includes = resolvePatternsForProvider(this.query.includePattern, fq.includePattern);
		const excludes = resolvePatternsForProvider(this.query.excludePattern, fq.excludePattern);

		const options = <TextSearchOptions>{
			folder: URI.from(fq.folder),
			excludes,
			includes,
			useIgnoreFiles: !fq.disregardIgnoreFiles,
			useGlobalIgnoreFiles: !fq.disregardGlobalIgnoreFiles,
			followSymlinks: !fq.ignoreSymlinks,
			encoding: fq.fileEncoding && this.fileUtils.toCanonicalName(fq.fileEncoding),
			maxFileSize: this.query.maxFileSize,
			maxResults: this.query.maxResults,
			previewOptions: this.query.previewOptions,
			afterContext: this.query.afterContext,
			beforeContext: this.query.beforeContext
		};
		(<IExtendedExtensionSearchOptions>options).usePCRE2 = this.query.usePCRE2;
		return options;
	}
}

function patternInfoToQuery(patternInfo: IPatternInfo): TextSearchQuery {
	return <TextSearchQuery>{
		isCaseSensitive: patternInfo.isCaseSensitive || false,
		isRegExp: patternInfo.isRegExp || false,
		isWordMatch: patternInfo.isWordMatch || false,
		isMultiline: patternInfo.isMultiline || false,
		pattern: patternInfo.pattern
	};
}

export class TextSearchResultsCollector {
	private _batchedCollector: BatchedCollector<IFileMatch>;

	private _currentFolderIdx: number = -1;
	private _currentUri: URI | undefined;
	private _currentFileMatch: IFileMatch | null = null;

	constructor(private _onResult: (result: IFileMatch[]) => void) {
		this._batchedCollector = new BatchedCollector<IFileMatch>(512, items => this.sendItems(items));
	}

	add(data: TextSearchResult, folderIdx: number): void {
		// Collects TextSearchResults into IInternalFileMatches and collates using BatchedCollector.
		// This is efficient for ripgrep which sends results back one file at a time. It wouldn't be efficient for other search
		// providers that send results in random order. We could do this step afterwards instead.
		if (this._currentFileMatch && (this._currentFolderIdx !== folderIdx || !resources.isEqual(this._currentUri, data.uri))) {
			this.pushToCollector();
			this._currentFileMatch = null;
		}

		if (!this._currentFileMatch) {
			this._currentFolderIdx = folderIdx;
			this._currentFileMatch = {
				resource: data.uri,
				results: []
			};
		}

		this._currentFileMatch.results!.push(extensionResultToFrontendResult(data));
	}

	private pushToCollector(): void {
		const size = this._currentFileMatch && this._currentFileMatch.results ?
			this._currentFileMatch.results.length :
			0;
		this._batchedCollector.addItem(this._currentFileMatch!, size);
	}

	flush(): void {
		this.pushToCollector();
		this._batchedCollector.flush();
	}

	private sendItems(items: IFileMatch[]): void {
		this._onResult(items);
	}
}

function extensionResultToFrontendResult(data: TextSearchResult): ITextSearchResult {
	// Warning: result from RipgrepTextSearchEH has fake Range. Don't depend on any other props beyond these...
	if (extensionResultIsMatch(data)) {
		return <ITextSearchMatch>{
			preview: {
				matches: mapArrayOrNot(data.preview.matches, m => ({
					startLineNumber: m.start.line,
					startColumn: m.start.character,
					endLineNumber: m.end.line,
					endColumn: m.end.character
				})),
				text: data.preview.text
			},
			ranges: mapArrayOrNot(data.ranges, r => ({
				startLineNumber: r.start.line,
				startColumn: r.start.character,
				endLineNumber: r.end.line,
				endColumn: r.end.character
			}))
		};
	} else {
		return <ITextSearchContext>{
			text: data.text,
			lineNumber: data.lineNumber
		};
	}
}

export function extensionResultIsMatch(data: TextSearchResult): data is TextSearchMatch {
	return !!(<TextSearchMatch>data).preview;
}

/**
 * Collects items that have a size - before the cumulative size of collected items reaches START_BATCH_AFTER_COUNT, the callback is called for every
 * set of items collected.
 * But after that point, the callback is called with batches of maxBatchSize.
 * If the batch isn't filled within some time, the callback is also called.
 */
export class BatchedCollector<T> {
	private static readonly TIMEOUT = 4000;

	// After START_BATCH_AFTER_COUNT items have been collected, stop flushing on timeout
	private static readonly START_BATCH_AFTER_COUNT = 50;

	private totalNumberCompleted = 0;
	private batch: T[] = [];
	private batchSize = 0;
	private timeoutHandle: any;

	constructor(private maxBatchSize: number, private cb: (items: T[]) => void) {
	}

	addItem(item: T, size: number): void {
		if (!item) {
			return;
		}

		this.addItemToBatch(item, size);
	}

	addItems(items: T[], size: number): void {
		if (!items) {
			return;
		}

		this.addItemsToBatch(items, size);
	}

	private addItemToBatch(item: T, size: number): void {
		this.batch.push(item);
		this.batchSize += size;
		this.onUpdate();
	}

	private addItemsToBatch(item: T[], size: number): void {
		this.batch = this.batch.concat(item);
		this.batchSize += size;
		this.onUpdate();
	}

	private onUpdate(): void {
		if (this.totalNumberCompleted < BatchedCollector.START_BATCH_AFTER_COUNT) {
			// Flush because we aren't batching yet
			this.flush();
		} else if (this.batchSize >= this.maxBatchSize) {
			// Flush because the batch is full
			this.flush();
		} else if (!this.timeoutHandle) {
			// No timeout running, start a timeout to flush
			this.timeoutHandle = setTimeout(() => {
				this.flush();
			}, BatchedCollector.TIMEOUT);
		}
	}

	flush(): void {
		if (this.batchSize) {
			this.totalNumberCompleted += this.batchSize;
			this.cb(this.batch);
			this.batch = [];
			this.batchSize = 0;

			if (this.timeoutHandle) {
				clearTimeout(this.timeoutHandle);
				this.timeoutHandle = 0;
			}
		}
	}
}
