/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import * as glob from 'vs/base/common/glob';
import * as resources from 'vs/base/common/resources';
import { StopWatch } from 'vs/base/common/stopwatch';
import { URI } from 'vs/base/common/uri';
import { IFileMatch, IFileSearchProviderStats, IFolderQuery, ISearchCompleteStats, IFileQuery, QueryGlobTester, resolvePatternsForProvider } from 'vs/workbench/services/search/common/search';
import { FileSearchProvider, FileSearchOptions } from 'vs/workbench/services/search/common/searchExtTypes';

export interface IInternalFileMatch {
	base: URI;
	original?: URI;
	relativePath?: string; // Not present for extraFiles or absolute path matches
	basename: string;
	size?: number;
}

export interface IDirectoryEntry {
	base: URI;
	relativePath: string;
	basename: string;
}

export interface IDirectoryTree {
	rootEntries: IDirectoryEntry[];
	pathToEntries: { [relativePath: string]: IDirectoryEntry[] };
}

class FileSearchEngine {
	private filePattern?: string;
	private includePattern?: glob.ParsedExpression;
	private maxResults?: number;
	private exists?: boolean;
	private isLimitHit = false;
	private resultCount = 0;
	private isCanceled = false;

	private activeCancellationTokens: Set<CancellationTokenSource>;

	private globalExcludePattern?: glob.ParsedExpression;

	constructor(private config: IFileQuery, private provider: FileSearchProvider, private sessionToken?: CancellationToken) {
		this.filePattern = config.filePattern;
		this.includePattern = config.includePattern && glob.parse(config.includePattern);
		this.maxResults = config.maxResults || undefined;
		this.exists = config.exists;
		this.activeCancellationTokens = new Set<CancellationTokenSource>();

		this.globalExcludePattern = config.excludePattern && glob.parse(config.excludePattern);
	}

	cancel(): void {
		this.isCanceled = true;
		this.activeCancellationTokens.forEach(t => t.cancel());
		this.activeCancellationTokens = new Set();
	}

	search(_onResult: (match: IInternalFileMatch) => void): Promise<IInternalSearchComplete> {
		const folderQueries = this.config.folderQueries || [];

		return new Promise((resolve, reject) => {
			const onResult = (match: IInternalFileMatch) => {
				this.resultCount++;
				_onResult(match);
			};

			// Support that the file pattern is a full path to a file that exists
			if (this.isCanceled) {
				return resolve({ limitHit: this.isLimitHit });
			}

			// For each extra file
			if (this.config.extraFileResources) {
				this.config.extraFileResources
					.forEach(extraFile => {
						const extraFileStr = extraFile.toString(); // ?
						const basename = path.basename(extraFileStr);
						if (this.globalExcludePattern && this.globalExcludePattern(extraFileStr, basename)) {
							return; // excluded
						}

						// File: Check for match on file pattern and include pattern
						this.matchFile(onResult, { base: extraFile, basename });
					});
			}

			// For each root folder
			Promise.all(folderQueries.map(fq => {
				return this.searchInFolder(fq, onResult);
			})).then(stats => {
				resolve({
					limitHit: this.isLimitHit,
					stats: stats[0] || undefined // Only looking at single-folder workspace stats...
				});
			}, (err: Error) => {
				reject(new Error(toErrorMessage(err)));
			});
		});
	}

	private async searchInFolder(fq: IFolderQuery<URI>, onResult: (match: IInternalFileMatch) => void): Promise<IFileSearchProviderStats | null> {
		const cancellation = new CancellationTokenSource();
		const options = this.getSearchOptionsForFolder(fq);
		const tree = this.initDirectoryTree();

		const queryTester = new QueryGlobTester(this.config, fq);
		const noSiblingsClauses = !queryTester.hasSiblingExcludeClauses();

		let providerSW: StopWatch;

		try {
			this.activeCancellationTokens.add(cancellation);

			providerSW = StopWatch.create();
			const results = await this.provider.provideFileSearchResults(
				{
					pattern: this.config.filePattern || ''
				},
				options,
				cancellation.token);
			const providerTime = providerSW.elapsed();
			const postProcessSW = StopWatch.create();

			if (this.isCanceled && !this.isLimitHit) {
				return null;
			}

			if (results) {
				results.forEach(result => {
					const relativePath = path.posix.relative(fq.folder.path, result.path);

					if (noSiblingsClauses) {
						const basename = path.basename(result.path);
						this.matchFile(onResult, { base: fq.folder, relativePath, basename });

						return;
					}

					// TODO: Optimize siblings clauses with ripgrep here.
					this.addDirectoryEntries(tree, fq.folder, relativePath, onResult);
				});
			}

			if (this.isCanceled && !this.isLimitHit) {
				return null;
			}

			this.matchDirectoryTree(tree, queryTester, onResult);
			return <IFileSearchProviderStats>{
				providerTime,
				postProcessTime: postProcessSW.elapsed()
			};
		} finally {
			cancellation.dispose();
			this.activeCancellationTokens.delete(cancellation);
		}
	}

	private getSearchOptionsForFolder(fq: IFolderQuery<URI>): FileSearchOptions {
		const includes = resolvePatternsForProvider(this.config.includePattern, fq.includePattern);
		const excludes = resolvePatternsForProvider(this.config.excludePattern, fq.excludePattern);

		return {
			folder: fq.folder,
			excludes,
			includes,
			useIgnoreFiles: !fq.disregardIgnoreFiles,
			useGlobalIgnoreFiles: !fq.disregardGlobalIgnoreFiles,
			followSymlinks: !fq.ignoreSymlinks,
			maxResults: this.config.maxResults,
			session: this.sessionToken
		};
	}

	private initDirectoryTree(): IDirectoryTree {
		const tree: IDirectoryTree = {
			rootEntries: [],
			pathToEntries: Object.create(null)
		};
		tree.pathToEntries['.'] = tree.rootEntries;
		return tree;
	}

	private addDirectoryEntries({ pathToEntries }: IDirectoryTree, base: URI, relativeFile: string, onResult: (result: IInternalFileMatch) => void) {
		// Support relative paths to files from a root resource (ignores excludes)
		if (relativeFile === this.filePattern) {
			const basename = path.basename(this.filePattern);
			this.matchFile(onResult, { base: base, relativePath: this.filePattern, basename });
		}

		function add(relativePath: string) {
			const basename = path.basename(relativePath);
			const dirname = path.dirname(relativePath);
			let entries = pathToEntries[dirname];
			if (!entries) {
				entries = pathToEntries[dirname] = [];
				add(dirname);
			}
			entries.push({
				base,
				relativePath,
				basename
			});
		}

		add(relativeFile);
	}

	private matchDirectoryTree({ rootEntries, pathToEntries }: IDirectoryTree, queryTester: QueryGlobTester, onResult: (result: IInternalFileMatch) => void) {
		const self = this;
		const filePattern = this.filePattern;
		function matchDirectory(entries: IDirectoryEntry[]) {
			const hasSibling = glob.hasSiblingFn(() => entries.map(entry => entry.basename));
			for (let i = 0, n = entries.length; i < n; i++) {
				const entry = entries[i];
				const { relativePath, basename } = entry;

				// Check exclude pattern
				// If the user searches for the exact file name, we adjust the glob matching
				// to ignore filtering by siblings because the user seems to know what she
				// is searching for and we want to include the result in that case anyway
				if (!queryTester.includedInQuerySync(relativePath, basename, filePattern !== basename ? hasSibling : undefined)) {
					continue;
				}

				const sub = pathToEntries[relativePath];
				if (sub) {
					matchDirectory(sub);
				} else {
					if (relativePath === filePattern) {
						continue; // ignore file if its path matches with the file pattern because that is already matched above
					}

					self.matchFile(onResult, entry);
				}

				if (self.isLimitHit) {
					break;
				}
			}
		}
		matchDirectory(rootEntries);
	}

	private matchFile(onResult: (result: IInternalFileMatch) => void, candidate: IInternalFileMatch): void {
		if (!this.includePattern || (candidate.relativePath && this.includePattern(candidate.relativePath, candidate.basename))) {
			if (this.exists || (this.maxResults && this.resultCount >= this.maxResults)) {
				this.isLimitHit = true;
				this.cancel();
			}

			if (!this.isLimitHit) {
				onResult(candidate);
			}
		}
	}
}

interface IInternalSearchComplete {
	limitHit: boolean;
	stats?: IFileSearchProviderStats;
}

export class FileSearchManager {

	private static readonly BATCH_SIZE = 512;

	private readonly sessions = new Map<string, CancellationTokenSource>();

	fileSearch(config: IFileQuery, provider: FileSearchProvider, onBatch: (matches: IFileMatch[]) => void, token: CancellationToken): Promise<ISearchCompleteStats> {
		const sessionTokenSource = this.getSessionTokenSource(config.cacheKey);
		const engine = new FileSearchEngine(config, provider, sessionTokenSource && sessionTokenSource.token);

		let resultCount = 0;
		const onInternalResult = (batch: IInternalFileMatch[]) => {
			resultCount += batch.length;
			onBatch(batch.map(m => this.rawMatchToSearchItem(m)));
		};

		return this.doSearch(engine, FileSearchManager.BATCH_SIZE, onInternalResult, token).then(
			result => {
				return <ISearchCompleteStats>{
					limitHit: result.limitHit,
					stats: {
						fromCache: false,
						type: 'fileSearchProvider',
						resultCount,
						detailStats: result.stats
					}
				};
			});
	}

	clearCache(cacheKey: string): void {
		const sessionTokenSource = this.getSessionTokenSource(cacheKey);
		if (sessionTokenSource) {
			sessionTokenSource.cancel();
		}
	}

	private getSessionTokenSource(cacheKey: string | undefined): CancellationTokenSource | undefined {
		if (!cacheKey) {
			return undefined;
		}

		if (!this.sessions.has(cacheKey)) {
			this.sessions.set(cacheKey, new CancellationTokenSource());
		}

		return this.sessions.get(cacheKey);
	}

	private rawMatchToSearchItem(match: IInternalFileMatch): IFileMatch {
		if (match.relativePath) {
			return {
				resource: resources.joinPath(match.base, match.relativePath)
			};
		} else {
			// extraFileResources
			return {
				resource: match.base
			};
		}
	}

	private doSearch(engine: FileSearchEngine, batchSize: number, onResultBatch: (matches: IInternalFileMatch[]) => void, token: CancellationToken): Promise<IInternalSearchComplete> {
		token.onCancellationRequested(() => {
			engine.cancel();
		});

		const _onResult = (match: IInternalFileMatch) => {
			if (match) {
				batch.push(match);
				if (batchSize > 0 && batch.length >= batchSize) {
					onResultBatch(batch);
					batch = [];
				}
			}
		};

		let batch: IInternalFileMatch[] = [];
		return engine.search(_onResult).then(result => {
			if (batch.length) {
				onResultBatch(batch);
			}

			return result;
		}, error => {
			if (batch.length) {
				onResultBatch(batch);
			}

			return Promise.reject(error);
		});
	}
}
