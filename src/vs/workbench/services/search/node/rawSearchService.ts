/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as gracefulFs from 'graceful-fs';
import * as arrays from 'vs/base/common/arrays';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { compareItemsByFuzzyScore, FuzzyScorerCache, IItemAccessor, prepareQuery } from 'vs/base/common/fuzzyScorer';
import { basename, dirname, join, sep } from 'vs/base/common/path';
import { StopWatch } from 'vs/base/common/stopwatch';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Arch, getPlatformLimits } from 'vs/platform/files/common/files';
import { ICachedSearchStats, IFileQuery, IFileSearchProgressItem, IFileSearchStats, IFolderQuery, IProgressMessage, IRawFileMatch, IRawFileQuery, IRawQuery, IRawSearchService, IRawTextQuery, ISearchEngine, ISearchEngineSuccess, ISerializedFileMatch, ISerializedSearchComplete, ISerializedSearchProgressItem, ISerializedSearchSuccess, isFilePatternMatch, ITextQuery } from 'vs/workbench/services/search/common/search';
import { Engine as FileSearchEngine } from 'vs/workbench/services/search/node/fileSearch';
import { TextSearchEngineAdapter } from 'vs/workbench/services/search/node/textSearchAdapter';

gracefulFs.gracefulify(fs);

export type IProgressCallback = (p: ISerializedSearchProgressItem) => void;
export type IFileProgressCallback = (p: IFileSearchProgressItem) => void;

export class SearchService implements IRawSearchService {

	private static readonly BATCH_SIZE = 512;

	private caches: { [cacheKey: string]: Cache; } = Object.create(null);

	fileSearch(config: IRawFileQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete> {
		let promise: CancelablePromise<ISerializedSearchSuccess>;

		const query = reviveQuery(config);
		const emitter = new Emitter<ISerializedSearchProgressItem | ISerializedSearchComplete>({
			onFirstListenerDidAdd: () => {
				promise = createCancelablePromise(token => {
					return this.doFileSearchWithEngine(FileSearchEngine, query, p => emitter.fire(p), token);
				});

				promise.then(
					c => emitter.fire(c),
					err => emitter.fire({ type: 'error', error: { message: err.message, stack: err.stack } }));
			},
			onLastListenerRemove: () => {
				promise.cancel();
			}
		});

		return emitter.event;
	}

	textSearch(rawQuery: IRawTextQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete> {
		let promise: CancelablePromise<ISerializedSearchComplete>;

		const query = reviveQuery(rawQuery);
		const emitter = new Emitter<ISerializedSearchProgressItem | ISerializedSearchComplete>({
			onFirstListenerDidAdd: () => {
				promise = createCancelablePromise(token => {
					return this.ripgrepTextSearch(query, p => emitter.fire(p), token);
				});

				promise.then(
					c => emitter.fire(c),
					err => emitter.fire({ type: 'error', error: { message: err.message, stack: err.stack } }));
			},
			onLastListenerRemove: () => {
				promise.cancel();
			}
		});

		return emitter.event;
	}

	private ripgrepTextSearch(config: ITextQuery, progressCallback: IProgressCallback, token: CancellationToken): Promise<ISerializedSearchSuccess> {
		config.maxFileSize = getPlatformLimits(process.arch === 'ia32' ? Arch.IA32 : Arch.OTHER).maxFileSize;
		const engine = new TextSearchEngineAdapter(config);

		return engine.search(token, progressCallback, progressCallback);
	}

	doFileSearch(config: IFileQuery, progressCallback: IProgressCallback, token?: CancellationToken): Promise<ISerializedSearchSuccess> {
		return this.doFileSearchWithEngine(FileSearchEngine, config, progressCallback, token);
	}

	doFileSearchWithEngine(EngineClass: { new(config: IFileQuery): ISearchEngine<IRawFileMatch>; }, config: IFileQuery, progressCallback: IProgressCallback, token?: CancellationToken, batchSize = SearchService.BATCH_SIZE): Promise<ISerializedSearchSuccess> {
		let resultCount = 0;
		const fileProgressCallback: IFileProgressCallback = progress => {
			if (Array.isArray(progress)) {
				resultCount += progress.length;
				progressCallback(progress.map(m => this.rawMatchToSearchItem(m)));
			} else if ((<IRawFileMatch>progress).relativePath) {
				resultCount++;
				progressCallback(this.rawMatchToSearchItem(<IRawFileMatch>progress));
			} else {
				progressCallback(<IProgressMessage>progress);
			}
		};

		if (config.sortByScore) {
			let sortedSearch = this.trySortedSearchFromCache(config, fileProgressCallback, token);
			if (!sortedSearch) {
				const walkerConfig = config.maxResults ? Object.assign({}, config, { maxResults: null }) : config;
				const engine = new EngineClass(walkerConfig);
				sortedSearch = this.doSortedSearch(engine, config, progressCallback, fileProgressCallback, token);
			}

			return new Promise<ISerializedSearchSuccess>((c, e) => {
				sortedSearch!.then(([result, rawMatches]) => {
					const serializedMatches = rawMatches.map(rawMatch => this.rawMatchToSearchItem(rawMatch));
					this.sendProgress(serializedMatches, progressCallback, batchSize);
					c(result);
				}, e);
			});
		}

		const engine = new EngineClass(config);

		return this.doSearch(engine, fileProgressCallback, batchSize, token).then(complete => {
			return <ISerializedSearchSuccess>{
				limitHit: complete.limitHit,
				type: 'success',
				stats: {
					detailStats: complete.stats,
					type: 'searchProcess',
					fromCache: false,
					resultCount,
					sortingTime: undefined
				}
			};
		});
	}

	private rawMatchToSearchItem(match: IRawFileMatch): ISerializedFileMatch {
		return { path: match.base ? join(match.base, match.relativePath) : match.relativePath };
	}

	private doSortedSearch(engine: ISearchEngine<IRawFileMatch>, config: IFileQuery, progressCallback: IProgressCallback, fileProgressCallback: IFileProgressCallback, token?: CancellationToken): Promise<[ISerializedSearchSuccess, IRawFileMatch[]]> {
		const emitter = new Emitter<IFileSearchProgressItem>();

		let allResultsPromise = createCancelablePromise(token => {
			let results: IRawFileMatch[] = [];

			const innerProgressCallback: IFileProgressCallback = progress => {
				if (Array.isArray(progress)) {
					results = progress;
				} else {
					fileProgressCallback(progress);
					emitter.fire(progress);
				}
			};

			return this.doSearch(engine, innerProgressCallback, -1, token)
				.then<[ISearchEngineSuccess, IRawFileMatch[]]>(result => {
					return [result, results];
				});
		});

		let cache: Cache;
		if (config.cacheKey) {
			cache = this.getOrCreateCache(config.cacheKey);
			const cacheRow: ICacheRow = {
				promise: allResultsPromise,
				event: emitter.event,
				resolved: false
			};
			cache.resultsToSearchCache[config.filePattern || ''] = cacheRow;
			allResultsPromise.then(() => {
				cacheRow.resolved = true;
			}, err => {
				delete cache.resultsToSearchCache[config.filePattern || ''];
			});

			allResultsPromise = this.preventCancellation(allResultsPromise);
		}

		return allResultsPromise.then(([result, results]) => {
			const scorerCache: FuzzyScorerCache = cache ? cache.scorerCache : Object.create(null);
			const sortSW = (typeof config.maxResults !== 'number' || config.maxResults > 0) && StopWatch.create(false);
			return this.sortResults(config, results, scorerCache, token)
				.then<[ISerializedSearchSuccess, IRawFileMatch[]]>(sortedResults => {
					// sortingTime: -1 indicates a "sorted" search that was not sorted, i.e. populating the cache when quickaccess is opened.
					// Contrasting with findFiles which is not sorted and will have sortingTime: undefined
					const sortingTime = sortSW ? sortSW.elapsed() : -1;

					return [{
						type: 'success',
						stats: {
							detailStats: result.stats,
							sortingTime,
							fromCache: false,
							type: 'searchProcess',
							workspaceFolderCount: config.folderQueries.length,
							resultCount: sortedResults.length
						},
						messages: result.messages,
						limitHit: result.limitHit || typeof config.maxResults === 'number' && results.length > config.maxResults
					} as ISerializedSearchSuccess, sortedResults];
				});
		});
	}

	private getOrCreateCache(cacheKey: string): Cache {
		const existing = this.caches[cacheKey];
		if (existing) {
			return existing;
		}
		return this.caches[cacheKey] = new Cache();
	}

	private trySortedSearchFromCache(config: IFileQuery, progressCallback: IFileProgressCallback, token?: CancellationToken): Promise<[ISerializedSearchSuccess, IRawFileMatch[]]> | undefined {
		const cache = config.cacheKey && this.caches[config.cacheKey];
		if (!cache) {
			return undefined;
		}

		const cached = this.getResultsFromCache(cache, config.filePattern || '', progressCallback, token);
		if (cached) {
			return cached.then(([result, results, cacheStats]) => {
				const sortSW = StopWatch.create(false);
				return this.sortResults(config, results, cache.scorerCache, token)
					.then<[ISerializedSearchSuccess, IRawFileMatch[]]>(sortedResults => {
						const sortingTime = sortSW.elapsed();
						const stats: IFileSearchStats = {
							fromCache: true,
							detailStats: cacheStats,
							type: 'searchProcess',
							resultCount: results.length,
							sortingTime
						};

						return [
							{
								type: 'success',
								limitHit: result.limitHit || typeof config.maxResults === 'number' && results.length > config.maxResults,
								stats
							} as ISerializedSearchSuccess,
							sortedResults
						];
					});
			});
		}
		return undefined;
	}

	private sortResults(config: IFileQuery, results: IRawFileMatch[], scorerCache: FuzzyScorerCache, token?: CancellationToken): Promise<IRawFileMatch[]> {
		// we use the same compare function that is used later when showing the results using fuzzy scoring
		// this is very important because we are also limiting the number of results by config.maxResults
		// and as such we want the top items to be included in this result set if the number of items
		// exceeds config.maxResults.
		const query = prepareQuery(config.filePattern || '');
		const compare = (matchA: IRawFileMatch, matchB: IRawFileMatch) => compareItemsByFuzzyScore(matchA, matchB, query, true, FileMatchItemAccessor, scorerCache);

		const maxResults = typeof config.maxResults === 'number' ? config.maxResults : Number.MAX_VALUE;
		return arrays.topAsync(results, compare, maxResults, 10000, token);
	}

	private sendProgress(results: ISerializedFileMatch[], progressCb: IProgressCallback, batchSize: number) {
		if (batchSize && batchSize > 0) {
			for (let i = 0; i < results.length; i += batchSize) {
				progressCb(results.slice(i, i + batchSize));
			}
		} else {
			progressCb(results);
		}
	}

	private getResultsFromCache(cache: Cache, searchValue: string, progressCallback: IFileProgressCallback, token?: CancellationToken): Promise<[ISearchEngineSuccess, IRawFileMatch[], ICachedSearchStats]> | null {
		const cacheLookupSW = StopWatch.create(false);

		// Find cache entries by prefix of search value
		const hasPathSep = searchValue.indexOf(sep) >= 0;
		let cachedRow: ICacheRow | undefined;
		for (const previousSearch in cache.resultsToSearchCache) {
			// If we narrow down, we might be able to reuse the cached results
			if (searchValue.startsWith(previousSearch)) {
				if (hasPathSep && previousSearch.indexOf(sep) < 0 && previousSearch !== '') {
					continue; // since a path character widens the search for potential more matches, require it in previous search too
				}

				const row = cache.resultsToSearchCache[previousSearch];
				cachedRow = {
					promise: this.preventCancellation(row.promise),
					event: row.event,
					resolved: row.resolved
				};
				break;
			}
		}

		if (!cachedRow) {
			return null;
		}

		const cacheLookupTime = cacheLookupSW.elapsed();
		const cacheFilterSW = StopWatch.create(false);

		const listener = cachedRow.event(progressCallback);
		if (token) {
			token.onCancellationRequested(() => {
				listener.dispose();
			});
		}

		return cachedRow.promise.then<[ISearchEngineSuccess, IRawFileMatch[], ICachedSearchStats]>(([complete, cachedEntries]) => {
			if (token && token.isCancellationRequested) {
				throw canceled();
			}

			// Pattern match on results
			const results: IRawFileMatch[] = [];
			const normalizedSearchValueLowercase = prepareQuery(searchValue).normalizedLowercase;
			for (const entry of cachedEntries) {

				// Check if this entry is a match for the search value
				if (!isFilePatternMatch(entry, normalizedSearchValueLowercase)) {
					continue;
				}

				results.push(entry);
			}

			return [complete, results, {
				cacheWasResolved: cachedRow!.resolved,
				cacheLookupTime,
				cacheFilterTime: cacheFilterSW.elapsed(),
				cacheEntryCount: cachedEntries.length
			}];
		});
	}



	private doSearch(engine: ISearchEngine<IRawFileMatch>, progressCallback: IFileProgressCallback, batchSize: number, token?: CancellationToken): Promise<ISearchEngineSuccess> {
		return new Promise<ISearchEngineSuccess>((c, e) => {
			let batch: IRawFileMatch[] = [];
			if (token) {
				token.onCancellationRequested(() => engine.cancel());
			}

			engine.search((match) => {
				if (match) {
					if (batchSize) {
						batch.push(match);
						if (batchSize > 0 && batch.length >= batchSize) {
							progressCallback(batch);
							batch = [];
						}
					} else {
						progressCallback(match);
					}
				}
			}, (progress) => {
				progressCallback(progress);
			}, (error, complete) => {
				if (batch.length) {
					progressCallback(batch);
				}

				if (error) {
					e(error);
				} else {
					c(complete);
				}
			});
		});
	}

	clearCache(cacheKey: string): Promise<void> {
		delete this.caches[cacheKey];
		return Promise.resolve(undefined);
	}

	/**
	 * Return a CancelablePromise which is not actually cancelable
	 * TODO@rob - Is this really needed?
	 */
	private preventCancellation<C>(promise: CancelablePromise<C>): CancelablePromise<C> {
		return new class implements CancelablePromise<C> {
			get [Symbol.toStringTag]() { return this.toString(); }
			cancel() {
				// Do nothing
			}
			then<TResult1 = C, TResult2 = never>(resolve?: ((value: C) => TResult1 | Promise<TResult1>) | undefined | null, reject?: ((reason: any) => TResult2 | Promise<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
				return promise.then(resolve, reject);
			}
			catch(reject?: any) {
				return this.then(undefined, reject);
			}
			finally(onFinally: any) {
				return promise.finally(onFinally);
			}
		};
	}
}

interface ICacheRow {
	// TODO@roblou - never actually canceled
	promise: CancelablePromise<[ISearchEngineSuccess, IRawFileMatch[]]>;
	resolved: boolean;
	event: Event<IFileSearchProgressItem>;
}

class Cache {

	resultsToSearchCache: { [searchValue: string]: ICacheRow; } = Object.create(null);

	scorerCache: FuzzyScorerCache = Object.create(null);
}

const FileMatchItemAccessor = new class implements IItemAccessor<IRawFileMatch> {

	getItemLabel(match: IRawFileMatch): string {
		return basename(match.relativePath); // e.g. myFile.txt
	}

	getItemDescription(match: IRawFileMatch): string {
		return dirname(match.relativePath); // e.g. some/path/to/file
	}

	getItemPath(match: IRawFileMatch): string {
		return match.relativePath; // e.g. some/path/to/file/myFile.txt
	}
};

function reviveQuery<U extends IRawQuery>(rawQuery: U): U extends IRawTextQuery ? ITextQuery : IFileQuery {
	return {
		...<any>rawQuery, // TODO
		...{
			folderQueries: rawQuery.folderQueries && rawQuery.folderQueries.map(reviveFolderQuery),
			extraFileResources: rawQuery.extraFileResources && rawQuery.extraFileResources.map(components => URI.revive(components))
		}
	};
}

function reviveFolderQuery(rawFolderQuery: IFolderQuery<UriComponents>): IFolderQuery<URI> {
	return {
		...rawFolderQuery,
		folder: URI.revive(rawFolderQuery.folder)
	};
}
