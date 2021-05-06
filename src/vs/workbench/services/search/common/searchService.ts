/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import { DeferredPromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { StopWatch } from 'vs/base/common/stopwatch';
import { URI, URI as uri } from 'vs/base/common/uri';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { deserializeSearchError, FileMatch, ICachedSearchStats, IFileMatch, IFileQuery, IFileSearchStats, IFolderQuery, IProgressMessage, ISearchComplete, ISearchEngineStats, ISearchProgressItem, ISearchQuery, ISearchResultProvider, ISearchService, isFileMatch, isProgressMessage, ITextQuery, pathIncludedInQuery, QueryType, SearchError, SearchErrorCode, SearchProviderType } from 'vs/workbench/services/search/common/search';
import { addContextToEditorMatches, editorMatchesToTextSearchResults } from 'vs/workbench/services/search/common/searchHelpers';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class SearchService extends Disposable implements ISearchService {

	declare readonly _serviceBrand: undefined;

	protected diskSearch: ISearchResultProvider | null = null;
	private readonly fileSearchProviders = new Map<string, ISearchResultProvider>();
	private readonly textSearchProviders = new Map<string, ISearchResultProvider>();

	private deferredFileSearchesByScheme = new Map<string, DeferredPromise<ISearchResultProvider>>();
	private deferredTextSearchesByScheme = new Map<string, DeferredPromise<ISearchResultProvider>>();

	constructor(
		private readonly modelService: IModelService,
		private readonly editorService: IEditorService,
		private readonly telemetryService: ITelemetryService,
		private readonly logService: ILogService,
		private readonly extensionService: IExtensionService,
		private readonly fileService: IFileService,
		private readonly uriIdentityService: IUriIdentityService,
	) {
		super();
	}

	registerSearchResultProvider(scheme: string, type: SearchProviderType, provider: ISearchResultProvider): IDisposable {
		let list: Map<string, ISearchResultProvider>;
		let deferredMap: Map<string, DeferredPromise<ISearchResultProvider>>;
		if (type === SearchProviderType.file) {
			list = this.fileSearchProviders;
			deferredMap = this.deferredFileSearchesByScheme;
		} else if (type === SearchProviderType.text) {
			list = this.textSearchProviders;
			deferredMap = this.deferredTextSearchesByScheme;
		} else {
			throw new Error('Unknown SearchProviderType');
		}

		list.set(scheme, provider);

		if (deferredMap.has(scheme)) {
			deferredMap.get(scheme)!.complete(provider);
			deferredMap.delete(scheme);
		}

		return toDisposable(() => {
			list.delete(scheme);
		});
	}

	async textSearch(query: ITextQuery, token?: CancellationToken, onProgress?: (item: ISearchProgressItem) => void): Promise<ISearchComplete> {
		// Get local results from dirty/untitled
		const localResults = this.getLocalResults(query);

		if (onProgress) {
			arrays.coalesce([...localResults.results.values()]).forEach(onProgress);
		}

		const onProviderProgress = (progress: ISearchProgressItem) => {
			if (isFileMatch(progress)) {
				// Match
				if (!localResults.results.has(progress.resource) && onProgress) { // don't override local results
					onProgress(progress);
				}
			} else if (onProgress) {
				// Progress
				onProgress(<IProgressMessage>progress);
			}

			if (isProgressMessage(progress)) {
				this.logService.debug('SearchService#search', progress.message);
			}
		};

		const otherResults = await this.doSearch(query, token, onProviderProgress);
		return {
			...otherResults,
			...{
				limitHit: otherResults.limitHit || localResults.limitHit
			},
			results: [...otherResults.results, ...arrays.coalesce([...localResults.results.values()])]
		};
	}

	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
		return this.doSearch(query, token);
	}

	private doSearch(query: ISearchQuery, token?: CancellationToken, onProgress?: (item: ISearchProgressItem) => void): Promise<ISearchComplete> {
		this.logService.trace('SearchService#search', JSON.stringify(query));

		const schemesInQuery = this.getSchemesInQuery(query);

		const providerActivations: Promise<any>[] = [Promise.resolve(null)];
		schemesInQuery.forEach(scheme => providerActivations.push(this.extensionService.activateByEvent(`onSearch:${scheme}`)));
		providerActivations.push(this.extensionService.activateByEvent('onSearch:file'));

		const providerPromise = (async () => {
			await Promise.all(providerActivations);
			this.extensionService.whenInstalledExtensionsRegistered();

			// Cancel faster if search was canceled while waiting for extensions
			if (token && token.isCancellationRequested) {
				return Promise.reject(canceled());
			}

			const progressCallback = (item: ISearchProgressItem) => {
				if (token && token.isCancellationRequested) {
					return;
				}

				if (onProgress) {
					onProgress(item);
				}
			};

			const exists = await Promise.all(query.folderQueries.map(query => this.fileService.exists(query.folder)));
			query.folderQueries = query.folderQueries.filter((_, i) => exists[i]);

			let completes = await this.searchWithProviders(query, progressCallback, token);
			completes = arrays.coalesce(completes);
			if (!completes.length) {
				return {
					limitHit: false,
					results: [],
					messages: [],
				};
			}

			return {
				limitHit: completes[0] && completes[0].limitHit,
				stats: completes[0].stats,
				messages: arrays.coalesce(arrays.flatten(completes.map(i => i.messages))).filter(arrays.uniqueFilter(message => message.type + message.text)),
				results: arrays.flatten(completes.map((c: ISearchComplete) => c.results))
			};
		})();

		return new Promise((resolve, reject) => {
			if (token) {
				token.onCancellationRequested(() => {
					reject(canceled());
				});
			}

			providerPromise.then(resolve, reject);
		});
	}

	private getSchemesInQuery(query: ISearchQuery): Set<string> {
		const schemes = new Set<string>();
		if (query.folderQueries) {
			query.folderQueries.forEach(fq => schemes.add(fq.folder.scheme));
		}

		if (query.extraFileResources) {
			query.extraFileResources.forEach(extraFile => schemes.add(extraFile.scheme));
		}

		return schemes;
	}

	private async waitForProvider(queryType: QueryType, scheme: string): Promise<ISearchResultProvider> {
		const deferredMap: Map<string, DeferredPromise<ISearchResultProvider>> = queryType === QueryType.File ?
			this.deferredFileSearchesByScheme :
			this.deferredTextSearchesByScheme;

		if (deferredMap.has(scheme)) {
			return deferredMap.get(scheme)!.p;
		} else {
			const deferred = new DeferredPromise<ISearchResultProvider>();
			deferredMap.set(scheme, deferred);
			return deferred.p;
		}
	}

	private async searchWithProviders(query: ISearchQuery, onProviderProgress: (progress: ISearchProgressItem) => void, token?: CancellationToken) {
		const e2eSW = StopWatch.create(false);

		const diskSearchQueries: IFolderQuery[] = [];
		const searchPs: Promise<ISearchComplete>[] = [];

		const fqs = this.groupFolderQueriesByScheme(query);
		await Promise.all([...fqs.keys()].map(async scheme => {
			const schemeFQs = fqs.get(scheme)!;
			let provider = query.type === QueryType.File ?
				this.fileSearchProviders.get(scheme) :
				this.textSearchProviders.get(scheme);

			if (!provider && scheme === Schemas.file) {
				diskSearchQueries.push(...schemeFQs);
			} else {
				if (!provider) {
					if (scheme !== Schemas.vscodeRemote) {
						console.warn(`No search provider registered for scheme: ${scheme}`);
						return;
					}

					console.warn(`No search provider registered for scheme: ${scheme}, waiting`);
					provider = await this.waitForProvider(query.type, scheme);
				}

				const oneSchemeQuery: ISearchQuery = {
					...query,
					...{
						folderQueries: schemeFQs
					}
				};

				searchPs.push(query.type === QueryType.File ?
					provider.fileSearch(<IFileQuery>oneSchemeQuery, token) :
					provider.textSearch(<ITextQuery>oneSchemeQuery, onProviderProgress, token));
			}
		}));

		const diskSearchExtraFileResources = query.extraFileResources && query.extraFileResources.filter(res => res.scheme === Schemas.file);

		if (diskSearchQueries.length || diskSearchExtraFileResources) {
			const diskSearchQuery: ISearchQuery = {
				...query,
				...{
					folderQueries: diskSearchQueries
				},
				extraFileResources: diskSearchExtraFileResources
			};


			if (this.diskSearch) {
				searchPs.push(diskSearchQuery.type === QueryType.File ?
					this.diskSearch.fileSearch(diskSearchQuery, token) :
					this.diskSearch.textSearch(diskSearchQuery, onProviderProgress, token));
			}
		}

		return Promise.all(searchPs).then(completes => {
			const endToEndTime = e2eSW.elapsed();
			this.logService.trace(`SearchService#search: ${endToEndTime}ms`);
			completes.forEach(complete => {
				this.sendTelemetry(query, endToEndTime, complete);
			});
			return completes;
		}, err => {
			const endToEndTime = e2eSW.elapsed();
			this.logService.trace(`SearchService#search: ${endToEndTime}ms`);
			const searchError = deserializeSearchError(err);
			this.logService.trace(`SearchService#searchError: ${searchError.message}`);
			this.sendTelemetry(query, endToEndTime, undefined, searchError);

			throw searchError;
		});
	}

	private groupFolderQueriesByScheme(query: ISearchQuery): Map<string, IFolderQuery[]> {
		const queries = new Map<string, IFolderQuery[]>();

		query.folderQueries.forEach(fq => {
			const schemeFQs = queries.get(fq.folder.scheme) || [];
			schemeFQs.push(fq);

			queries.set(fq.folder.scheme, schemeFQs);
		});

		return queries;
	}

	private sendTelemetry(query: ISearchQuery, endToEndTime: number, complete?: ISearchComplete, err?: SearchError): void {
		const fileSchemeOnly = query.folderQueries.every(fq => fq.folder.scheme === Schemas.file);
		const otherSchemeOnly = query.folderQueries.every(fq => fq.folder.scheme !== Schemas.file);
		const scheme = fileSchemeOnly ? Schemas.file :
			otherSchemeOnly ? 'other' :
				'mixed';

		if (query.type === QueryType.File && complete && complete.stats) {
			const fileSearchStats = complete.stats as IFileSearchStats;
			if (fileSearchStats.fromCache) {
				const cacheStats: ICachedSearchStats = fileSearchStats.detailStats as ICachedSearchStats;

				type CachedSearchCompleteClassifcation = {
					reason?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					resultCount: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					workspaceFolderCount: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					type: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					endToEndTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					sortingTime?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					cacheWasResolved: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					cacheLookupTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					cacheFilterTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					cacheEntryCount: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					scheme: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				};
				type CachedSearchCompleteEvent = {
					reason?: string;
					resultCount: number;
					workspaceFolderCount: number;
					type: 'fileSearchProvider' | 'searchProcess';
					endToEndTime: number;
					sortingTime?: number;
					cacheWasResolved: boolean;
					cacheLookupTime: number;
					cacheFilterTime: number;
					cacheEntryCount: number;
					scheme: string;
				};
				this.telemetryService.publicLog2<CachedSearchCompleteEvent, CachedSearchCompleteClassifcation>('cachedSearchComplete', {
					reason: query._reason,
					resultCount: fileSearchStats.resultCount,
					workspaceFolderCount: query.folderQueries.length,
					type: fileSearchStats.type,
					endToEndTime: endToEndTime,
					sortingTime: fileSearchStats.sortingTime,
					cacheWasResolved: cacheStats.cacheWasResolved,
					cacheLookupTime: cacheStats.cacheLookupTime,
					cacheFilterTime: cacheStats.cacheFilterTime,
					cacheEntryCount: cacheStats.cacheEntryCount,
					scheme
				});
			} else {
				const searchEngineStats: ISearchEngineStats = fileSearchStats.detailStats as ISearchEngineStats;

				type SearchCompleteClassification = {
					reason?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					resultCount: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					workspaceFolderCount: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					type: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					endToEndTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					sortingTime?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					fileWalkTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					directoriesWalked: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					filesWalked: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					cmdTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					cmdResultCount?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
					scheme: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				};
				type SearchCompleteEvent = {
					reason?: string;
					resultCount: number;
					workspaceFolderCount: number;
					type: 'fileSearchProvider' | 'searchProcess';
					endToEndTime: number;
					sortingTime?: number;
					fileWalkTime: number
					directoriesWalked: number;
					filesWalked: number;
					cmdTime: number;
					cmdResultCount?: number;
					scheme: string;

				};

				this.telemetryService.publicLog2<SearchCompleteEvent, SearchCompleteClassification>('searchComplete', {
					reason: query._reason,
					resultCount: fileSearchStats.resultCount,
					workspaceFolderCount: query.folderQueries.length,
					type: fileSearchStats.type,
					endToEndTime: endToEndTime,
					sortingTime: fileSearchStats.sortingTime,
					fileWalkTime: searchEngineStats.fileWalkTime,
					directoriesWalked: searchEngineStats.directoriesWalked,
					filesWalked: searchEngineStats.filesWalked,
					cmdTime: searchEngineStats.cmdTime,
					cmdResultCount: searchEngineStats.cmdResultCount,
					scheme
				});
			}
		} else if (query.type === QueryType.Text) {
			let errorType: string | undefined;
			if (err) {
				errorType = err.code === SearchErrorCode.regexParseError ? 'regex' :
					err.code === SearchErrorCode.unknownEncoding ? 'encoding' :
						err.code === SearchErrorCode.globParseError ? 'glob' :
							err.code === SearchErrorCode.invalidLiteral ? 'literal' :
								err.code === SearchErrorCode.other ? 'other' :
									err.code === SearchErrorCode.canceled ? 'canceled' :
										'unknown';
			}

			type TextSearchCompleteClassification = {
				reason?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				workspaceFolderCount: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
				endToEndTime: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
				scheme: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				error?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
				usePCRE2: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
			};
			type TextSearchCompleteEvent = {
				reason?: string;
				workspaceFolderCount: number;
				endToEndTime: number;
				scheme: string;
				error?: string;
				usePCRE2: boolean;
			};
			this.telemetryService.publicLog2<TextSearchCompleteEvent, TextSearchCompleteClassification>('textSearchComplete', {
				reason: query._reason,
				workspaceFolderCount: query.folderQueries.length,
				endToEndTime: endToEndTime,
				scheme,
				error: errorType,
				usePCRE2: !!query.usePCRE2
			});
		}
	}

	private getLocalResults(query: ITextQuery): { results: ResourceMap<IFileMatch | null>; limitHit: boolean } {
		const localResults = new ResourceMap<IFileMatch | null>(uri => this.uriIdentityService.extUri.getComparisonKey(uri));
		let limitHit = false;

		if (query.type === QueryType.Text) {
			const canonicalToOriginalResources = new ResourceMap<URI>();
			for (let editorInput of this.editorService.editors) {
				const canonical = EditorResourceAccessor.getCanonicalUri(editorInput, { supportSideBySide: SideBySideEditor.PRIMARY });
				const original = EditorResourceAccessor.getOriginalUri(editorInput, { supportSideBySide: SideBySideEditor.PRIMARY });

				if (canonical) {
					canonicalToOriginalResources.set(canonical, original ?? canonical);
				}
			}

			const models = this.modelService.getModels();
			models.forEach((model) => {
				const resource = model.uri;
				if (!resource) {
					return;
				}

				if (limitHit) {
					return;
				}

				const originalResource = canonicalToOriginalResources.get(resource);
				if (!originalResource) {
					return;
				}

				// Skip search results
				if (model.getModeId() === 'search-result' && !(query.includePattern && query.includePattern['**/*.code-search'])) {
					// TODO: untitled search editors will be excluded from search even when include *.code-search is specified
					return;
				}

				// Block walkthrough, webview, etc.
				if (originalResource.scheme !== Schemas.untitled && !this.fileService.canHandleResource(originalResource)) {
					return;
				}

				// Exclude files from the git FileSystemProvider, e.g. to prevent open staged files from showing in search results
				if (originalResource.scheme === 'git') {
					return;
				}

				if (!this.matches(originalResource, query)) {
					return; // respect user filters
				}

				// Use editor API to find matches
				const askMax = typeof query.maxResults === 'number' ? query.maxResults + 1 : undefined;
				let matches = model.findMatches(query.contentPattern.pattern, false, !!query.contentPattern.isRegExp, !!query.contentPattern.isCaseSensitive, query.contentPattern.isWordMatch ? query.contentPattern.wordSeparators! : null, false, askMax);
				if (matches.length) {
					if (askMax && matches.length >= askMax) {
						limitHit = true;
						matches = matches.slice(0, askMax - 1);
					}

					const fileMatch = new FileMatch(originalResource);
					localResults.set(originalResource, fileMatch);

					const textSearchResults = editorMatchesToTextSearchResults(matches, model, query.previewOptions);
					fileMatch.results = addContextToEditorMatches(textSearchResults, model, query);
				} else {
					localResults.set(originalResource, null);
				}
			});
		}

		return {
			results: localResults,
			limitHit
		};
	}

	private matches(resource: uri, query: ITextQuery): boolean {
		return pathIncludedInQuery(query, resource.fsPath);
	}

	clearCache(cacheKey: string): Promise<void> {
		const clearPs = [
			this.diskSearch,
			...Array.from(this.fileSearchProviders.values())
		].map(provider => provider && provider.clearCache(cacheKey));

		return Promise.all(clearPs)
			.then(() => { });
	}
}
