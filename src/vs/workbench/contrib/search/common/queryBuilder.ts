/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import * as collections from 'vs/base/common/collections';
import * as glob from 'vs/base/common/glob';
import { untildify } from 'vs/base/common/labels';
import { values } from 'vs/base/common/map';
import * as path from 'vs/base/common/path';
import { isEqual } from 'vs/base/common/resources';
import * as strings from 'vs/base/common/strings';
import { URI as uri } from 'vs/base/common/uri';
import { isMultilineRegexSource } from 'vs/editor/common/model/textModelSearch';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { getExcludes, ICommonQueryProps, IFileQuery, IFolderQuery, IPatternInfo, ISearchConfiguration, ITextQuery, ITextSearchPreviewOptions, pathIncludedInQuery, QueryType } from 'vs/workbench/services/search/common/search';
import { Schemas } from 'vs/base/common/network';
import { QueryExpansion } from 'vs/workbench/contrib/search/common/queryExpansion';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

/**
 * One folder to search and a glob expression that should be applied.
 */
export interface IOneSearchPathPattern {
	searchPath: uri;
	pattern?: string;
}

/**
 * One folder to search and a set of glob expressions that should be applied.
 */
export interface ISearchPathPattern {
	searchPath: uri;
	pattern?: glob.IExpression;
}

/**
 * A set of search paths and a set of glob expressions that should be applied.
 */
export interface ISearchPathsInfo {
	searchPaths?: ISearchPathPattern[];
	pattern?: glob.IExpression;
}

export interface ICommonQueryBuilderOptions {
	_reason?: string;
	excludePattern?: string;
	includePattern?: string;
	extraFileResources?: uri[];

	/** Parse the special ./ syntax supported by the searchview, and expand foo to ** /foo */
	expandPatterns?: boolean;

	maxResults?: number;
	maxFileSize?: number;
	disregardIgnoreFiles?: boolean;
	disregardGlobalIgnoreFiles?: boolean;
	disregardExcludeSettings?: boolean;
	disregardSearchExcludeSettings?: boolean;
	ignoreSymlinks?: boolean;
}

export interface IFileQueryBuilderOptions extends ICommonQueryBuilderOptions {
	filePattern?: string;
	exists?: boolean;
	sortByScore?: boolean;
	cacheKey?: string;
}

export interface ITextQueryBuilderOptions extends ICommonQueryBuilderOptions {
	previewOptions?: ITextSearchPreviewOptions;
	fileEncoding?: string;
	beforeContext?: number;
	afterContext?: number;
	isSmartCase?: boolean;
}

export class QueryBuilder {
	private readonly queryExpansion: QueryExpansion;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService) {
		this.queryExpansion = instantiationService.createInstance(QueryExpansion);
	}

	text(contentPattern: IPatternInfo, folderResources?: uri[], options: ITextQueryBuilderOptions = {}): Promise<ITextQuery> {
		contentPattern = this.getContentPattern(contentPattern, options);
		const searchConfig = this.configurationService.getValue<ISearchConfiguration>();

		const fallbackToPCRE = folderResources && folderResources.some(folder => {
			const folderConfig = this.configurationService.getValue<ISearchConfiguration>({ resource: folder });
			return !folderConfig.search.useRipgrep;
		});

		const commonQuery = this.commonQuery(folderResources, options);
		return commonQuery.then(q => <ITextQuery>{
			...q,
			type: QueryType.Text,
			contentPattern,
			previewOptions: options.previewOptions,
			maxFileSize: options.maxFileSize,
			usePCRE2: searchConfig.search.usePCRE2 || fallbackToPCRE || false,
			beforeContext: options.beforeContext,
			afterContext: options.afterContext,
			userDisabledExcludesAndIgnoreFiles: options.disregardExcludeSettings && options.disregardIgnoreFiles
		});
	}

	/**
	 * Adjusts input pattern for config
	 */
	private getContentPattern(inputPattern: IPatternInfo, options: ITextQueryBuilderOptions): IPatternInfo {
		const searchConfig = this.configurationService.getValue<ISearchConfiguration>();

		if (inputPattern.isRegExp) {
			inputPattern.pattern = inputPattern.pattern.replace(/\r?\n/g, '\\n');
		}

		const newPattern = {
			...inputPattern,
			wordSeparators: searchConfig.editor.wordSeparators
		};

		if (this.isCaseSensitive(inputPattern, options)) {
			newPattern.isCaseSensitive = true;
		}

		if (this.isMultiline(inputPattern)) {
			newPattern.isMultiline = true;
		}

		return newPattern;
	}

	file(folderResources: uri[] | undefined, options: IFileQueryBuilderOptions = {}): IFileQuery {
		const commonQuery = this.commonQueryNoTokenExpansion(folderResources, options);
		return <IFileQuery>{
			...commonQuery,
			type: QueryType.File,
			filePattern: options.filePattern
				? options.filePattern.trim()
				: options.filePattern,
			exists: options.exists,
			sortByScore: options.sortByScore,
			cacheKey: options.cacheKey
		};
	}

	private commonQuery(folderResources: uri[] = [], options: ICommonQueryBuilderOptions = {}): Promise<ICommonQueryProps<uri>> {
		let includeSearchPathsInfoPromise: Promise<ISearchPathsInfo> = Promise.resolve({});
		if (options.includePattern) {
			if (options.expandPatterns) {
				includeSearchPathsInfoPromise = this.parseSearchPaths(options.includePattern);
			} else {
				const patternExpression = this.queryExpansion.expandQuerySegments(splitGlobPattern(options.includePattern))
					.then(patterns => patternListToIExpression(...patterns));
				includeSearchPathsInfoPromise = patternExpression.then(e => { return { pattern: e }; });

			}
		}

		let excludeSearchPathsInfoPromise: Promise<ISearchPathsInfo> = Promise.resolve({});
		if (options.excludePattern) {
			if (options.expandPatterns) {
				excludeSearchPathsInfoPromise = this.parseSearchPaths(options.excludePattern);
			} else {
				const patternExpression = this.queryExpansion.expandQuerySegments(splitGlobPattern(options.excludePattern))
					.then(patterns => patternListToIExpression(...patterns));
				excludeSearchPathsInfoPromise = patternExpression.then(e => { return { pattern: e }; });
			}
		}

		return Promise.all([includeSearchPathsInfoPromise, excludeSearchPathsInfoPromise])
			.then(([includeInfo, excludeInfo]) => this.buildFolderQueries(includeInfo, excludeInfo, folderResources, options));
	}

	private commonQueryNoTokenExpansion(folderResources: uri[] = [], options: ICommonQueryBuilderOptions = {}): ICommonQueryProps<uri> {
		let includeSearchPathsInfo: ISearchPathsInfo = {};
		if (options.includePattern) {
			includeSearchPathsInfo = options.expandPatterns ?
				this.parseSearchPathsNoTokenExpansion(options.includePattern) :
				{ pattern: patternListToIExpression(options.includePattern) };
		}

		let excludeSearchPathsInfo: ISearchPathsInfo = {};
		if (options.excludePattern) {
			excludeSearchPathsInfo = options.expandPatterns ?
				this.parseSearchPathsNoTokenExpansion(options.excludePattern) :
				{ pattern: patternListToIExpression(options.excludePattern) };
		}

		return this.buildFolderQueries(includeSearchPathsInfo, excludeSearchPathsInfo, folderResources, options);
	}

	private buildFolderQueries(
		includeSearchPathsInfo: ISearchPathsInfo,
		excludeSearchPathsInfo: ISearchPathsInfo,
		folderResources: uri[],
		options: ICommonQueryBuilderOptions): ICommonQueryProps<uri> {
		// Build folderQueries from searchPaths, if given, otherwise folderResources
		const folderQueries = (includeSearchPathsInfo.searchPaths && includeSearchPathsInfo.searchPaths.length ?
			includeSearchPathsInfo.searchPaths.map(searchPath => this.getFolderQueryForSearchPath(searchPath, options, excludeSearchPathsInfo)) :
			folderResources.map(uri => this.getFolderQueryForRoot(uri, options, excludeSearchPathsInfo)))
			.filter(query => !!query) as IFolderQuery[];

		const queryProps: ICommonQueryProps<uri> = {
			_reason: options._reason,
			folderQueries,
			usingSearchPaths: !!(includeSearchPathsInfo.searchPaths && includeSearchPathsInfo.searchPaths.length),
			extraFileResources: options.extraFileResources,

			excludePattern: excludeSearchPathsInfo.pattern,
			includePattern: includeSearchPathsInfo.pattern,
			maxResults: options.maxResults
		};

		// Filter extraFileResources against global include/exclude patterns - they are already expected to not belong to a workspace
		const extraFileResources = options.extraFileResources && options.extraFileResources.filter(extraFile => pathIncludedInQuery(queryProps, extraFile.fsPath));
		queryProps.extraFileResources = extraFileResources && extraFileResources.length ? extraFileResources : undefined;

		return queryProps;
	}

	/**
	 * Resolve isCaseSensitive flag based on the query and the isSmartCase flag, for search providers that don't support smart case natively.
	 */
	private isCaseSensitive(contentPattern: IPatternInfo, options: ITextQueryBuilderOptions): boolean {
		if (options.isSmartCase) {
			if (contentPattern.isRegExp) {
				// Consider it case sensitive if it contains an unescaped capital letter
				if (strings.containsUppercaseCharacter(contentPattern.pattern, true)) {
					return true;
				}
			} else if (strings.containsUppercaseCharacter(contentPattern.pattern)) {
				return true;
			}
		}

		return !!contentPattern.isCaseSensitive;
	}

	private isMultiline(contentPattern: IPatternInfo): boolean {
		if (contentPattern.isMultiline) {
			return true;
		}

		if (contentPattern.isRegExp && isMultilineRegexSource(contentPattern.pattern)) {
			return true;
		}

		if (contentPattern.pattern.indexOf('\n') >= 0) {
			return true;
		}

		return !!contentPattern.isMultiline;
	}

	/**
	 * Take the includePattern as seen in the search viewlet, and split into components that look like searchPaths, and
	 * glob patterns. Glob patterns are expanded from 'foo/bar' to '{foo/bar/**, **\/foo/bar}.
	 *
	 * Public for test.
	 */
	parseSearchPaths(pattern: string): Promise<ISearchPathsInfo> {
		return this.queryExpansion.expandQuerySegments(splitGlobPattern(pattern))
			.then(patterns => this.parseSearchPatterns(patterns));
	}

	parseSearchPathsNoTokenExpansion(pattern: string): ISearchPathsInfo {
		return this.parseSearchPatterns(splitGlobPattern(pattern));
	}

	private parseSearchPatterns(patterns: string[]): ISearchPathsInfo {
		const isSearchPath = (segment: string): boolean => {
			// A segment is a search path if it is an absolute path or starts with ./, ../, .\, or ..\
			return path.isAbsolute(segment) || /^\.\.?([\/\\]|$)/.test(segment);
		};

		const segments = patterns.map(segment => untildify(segment, this.environmentService.userHome));
		const groups = collections.groupBy(segments,
			segment => isSearchPath(segment) ? 'searchPaths' : 'exprSegments');

		const expandedExprSegments = (groups.exprSegments || [])
			.map(s => strings.rtrim(s, '/'))
			.map(s => strings.rtrim(s, '\\'))
			.map(p => {
				if (p[0] === '.') {
					p = '*' + p; // convert ".js" to "*.js"
				}

				return expandGlobalGlob(p);
			});

		const result: ISearchPathsInfo = {};
		const searchPaths = this.expandSearchPathPatterns(groups.searchPaths || []);
		if (searchPaths && searchPaths.length) {
			result.searchPaths = searchPaths;
		}

		const exprSegments = arrays.flatten(expandedExprSegments);
		const includePattern = patternListToIExpression(...exprSegments);
		if (includePattern) {
			result.pattern = includePattern;
		}

		return result;
	}

	private getExcludesForFolder(folderConfig: ISearchConfiguration, options: ICommonQueryBuilderOptions): glob.IExpression | undefined {
		return options.disregardExcludeSettings ?
			undefined :
			getExcludes(folderConfig, !options.disregardSearchExcludeSettings);
	}

	/**
	 * Split search paths (./ or ../ or absolute paths in the includePatterns) into absolute paths and globs applied to those paths
	 */
	private expandSearchPathPatterns(searchPaths: string[]): ISearchPathPattern[] {
		if (!searchPaths || !searchPaths.length) {
			// No workspace => ignore search paths
			return [];
		}

		const expandedSearchPaths = arrays.flatten(
			searchPaths.map(searchPath => {
				// 1 open folder => just resolve the search paths to absolute paths
				let { pathPortion, globPortion } = splitGlobFromPath(searchPath);

				if (globPortion) {
					globPortion = normalizeGlobPattern(globPortion);
				}

				// One pathPortion to multiple expanded search paths (e.g. duplicate matching workspace folders)
				const oneExpanded = this.expandOneSearchPath(pathPortion);

				// Expanded search paths to multiple resolved patterns (with ** and without)
				return arrays.flatten(
					oneExpanded.map(oneExpandedResult => this.resolveOneSearchPathPattern(oneExpandedResult, globPortion)));
			}));

		const searchPathPatternMap = new Map<string, ISearchPathPattern>();
		expandedSearchPaths.forEach(oneSearchPathPattern => {
			const key = oneSearchPathPattern.searchPath.toString();
			const existing = searchPathPatternMap.get(key);
			if (existing) {
				if (oneSearchPathPattern.pattern) {
					existing.pattern = existing.pattern || {};
					existing.pattern[oneSearchPathPattern.pattern] = true;
				}
			} else {
				searchPathPatternMap.set(key, {
					searchPath: oneSearchPathPattern.searchPath,
					pattern: oneSearchPathPattern.pattern ? patternListToIExpression(oneSearchPathPattern.pattern) : undefined
				});
			}
		});

		return values(searchPathPatternMap);
	}

	/**
	 * Takes a searchPath like `./a/foo` or `../a/foo` and expands it to absolute paths for all the workspaces it matches.
	 */
	private expandOneSearchPath(searchPath: string): IOneSearchPathPattern[] {
		if (path.isAbsolute(searchPath)) {
			const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
			if (workspaceFolders[0] && workspaceFolders[0].uri.scheme !== Schemas.file) {
				return [{
					searchPath: workspaceFolders[0].uri.with({ path: searchPath })
				}];
			}

			// Currently only local resources can be searched for with absolute search paths.
			// TODO convert this to a workspace folder + pattern, so excludes will be resolved properly for an absolute path inside a workspace folder
			return [{
				searchPath: uri.file(path.normalize(searchPath))
			}];
		}

		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.FOLDER) {
			const workspaceUri = this.workspaceContextService.getWorkspace().folders[0].uri;

			searchPath = normalizeSlashes(searchPath);
			if (strings.startsWith(searchPath, '../') || searchPath === '..') {
				const resolvedPath = path.posix.resolve(workspaceUri.path, searchPath);
				return [{
					searchPath: workspaceUri.with({ path: resolvedPath })
				}];
			}

			const cleanedPattern = normalizeGlobPattern(searchPath);
			return [{
				searchPath: workspaceUri,
				pattern: cleanedPattern
			}];
		} else if (searchPath === './' || searchPath === '.\\') {
			return []; // ./ or ./**/foo makes sense for single-folder but not multi-folder workspaces
		} else {
			const relativeSearchPathMatch = searchPath.match(/\.[\/\\]([^\/\\]+)(?:[\/\\](.+))?/);
			if (relativeSearchPathMatch) {
				const searchPathRoot = relativeSearchPathMatch[1];
				const matchingRoots = this.workspaceContextService.getWorkspace().folders.filter(folder => folder.name === searchPathRoot);
				if (matchingRoots.length) {
					return matchingRoots.map(root => {
						const patternMatch = relativeSearchPathMatch[2];
						return {
							searchPath: root.uri,
							pattern: patternMatch && normalizeGlobPattern(patternMatch)
						};
					});
				} else {
					// No root folder with name
					const searchPathNotFoundError = nls.localize('search.noWorkspaceWithName', "No folder in workspace with name: {0}", searchPathRoot);
					throw new Error(searchPathNotFoundError);
				}
			} else {
				// Malformed ./ search path, ignore
			}
		}

		return [];
	}

	private resolveOneSearchPathPattern(oneExpandedResult: IOneSearchPathPattern, globPortion?: string): IOneSearchPathPattern[] {
		const pattern = oneExpandedResult.pattern && globPortion ?
			`${oneExpandedResult.pattern}/${globPortion}` :
			oneExpandedResult.pattern || globPortion;

		const results = [
			{
				searchPath: oneExpandedResult.searchPath,
				pattern
			}];

		if (pattern && !strings.endsWith(pattern, '**')) {
			results.push({
				searchPath: oneExpandedResult.searchPath,
				pattern: pattern + '/**'
			});
		}

		return results;
	}

	private getFolderQueryForSearchPath(searchPath: ISearchPathPattern, options: ICommonQueryBuilderOptions, searchPathExcludes: ISearchPathsInfo): IFolderQuery | null {
		const rootConfig = this.getFolderQueryForRoot(searchPath.searchPath, options, searchPathExcludes);
		if (!rootConfig) {
			return null;
		}

		return {
			...rootConfig,
			...{
				includePattern: searchPath.pattern
			}
		};
	}

	private getFolderQueryForRoot(folder: uri, options: ICommonQueryBuilderOptions, searchPathExcludes: ISearchPathsInfo): IFolderQuery | null {
		let thisFolderExcludeSearchPathPattern: glob.IExpression | undefined;
		if (searchPathExcludes.searchPaths) {
			const thisFolderExcludeSearchPath = searchPathExcludes.searchPaths.filter(sp => isEqual(sp.searchPath, folder))[0];
			if (thisFolderExcludeSearchPath && !thisFolderExcludeSearchPath.pattern) {
				// entire folder is excluded
				return null;
			} else if (thisFolderExcludeSearchPath) {
				thisFolderExcludeSearchPathPattern = thisFolderExcludeSearchPath.pattern;
			}
		}

		const folderConfig = this.configurationService.getValue<ISearchConfiguration>({ resource: folder });
		const settingExcludes = this.getExcludesForFolder(folderConfig, options);
		const excludePattern: glob.IExpression = {
			...(settingExcludes || {}),
			...(thisFolderExcludeSearchPathPattern || {})
		};

		return <IFolderQuery>{
			folder,
			excludePattern: Object.keys(excludePattern).length > 0 ? excludePattern : undefined,
			fileEncoding: folderConfig.files && folderConfig.files.encoding,
			disregardIgnoreFiles: typeof options.disregardIgnoreFiles === 'boolean' ? options.disregardIgnoreFiles : !folderConfig.search.useIgnoreFiles,
			disregardGlobalIgnoreFiles: typeof options.disregardGlobalIgnoreFiles === 'boolean' ? options.disregardGlobalIgnoreFiles : !folderConfig.search.useGlobalIgnoreFiles,
			ignoreSymlinks: typeof options.ignoreSymlinks === 'boolean' ? options.ignoreSymlinks : !folderConfig.search.followSymlinks,
		};
	}
}

function splitGlobFromPath(searchPath: string): { pathPortion: string, globPortion?: string } {
	const globCharMatch = searchPath.match(/[\*\{\}\(\)\[\]\?]/);
	if (globCharMatch) {
		const globCharIdx = globCharMatch.index;
		const lastSlashMatch = searchPath.substr(0, globCharIdx).match(/[/|\\][^/\\]*$/);
		if (lastSlashMatch) {
			let pathPortion = searchPath.substr(0, lastSlashMatch.index);
			if (!pathPortion.match(/[/\\]/)) {
				// If the last slash was the only slash, then we now have '' or 'C:' or '.'. Append a slash.
				pathPortion += '/';
			}

			return {
				pathPortion,
				globPortion: searchPath.substr((lastSlashMatch.index || 0) + 1)
			};
		}
	}

	// No glob char, or malformed
	return {
		pathPortion: searchPath
	};
}

function patternListToIExpression(...patterns: string[]): glob.IExpression {
	return patterns.length ?
		patterns.reduce((glob, cur) => { glob[cur] = true; return glob; }, Object.create(null)) :
		undefined;
}

function splitGlobPattern(pattern: string): string[] {
	return glob.splitGlobAware(pattern, ',')
		.map(s => s.trim())
		.filter(s => !!s.length);
}

/**
 * Note - we used {} here previously but ripgrep can't handle nested {} patterns. See https://github.com/Microsoft/vscode/issues/32761
 */
function expandGlobalGlob(pattern: string): string[] {
	const patterns = [
		`**/${pattern}/**`,
		`**/${pattern}`
	];

	return patterns.map(p => p.replace(/\*\*\/\*\*/g, '**'));
}

function normalizeSlashes(pattern: string): string {
	return pattern.replace(/\\/g, '/');
}

/**
 * Normalize slashes, remove `./` and trailing slashes
 */
function normalizeGlobPattern(pattern: string): string {
	return normalizeSlashes(pattern)
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}
