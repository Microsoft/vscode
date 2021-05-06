/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mapArrayOrNot } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import * as glob from 'vs/base/common/glob';
import { IDisposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as extpath from 'vs/base/common/extpath';
import { fuzzyContains, getNLines } from 'vs/base/common/strings';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IFilesConfiguration } from 'vs/platform/files/common/files';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { Event } from 'vs/base/common/event';
import * as paths from 'vs/base/common/path';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { TextSearchCompleteMessageType } from 'vs/workbench/services/search/common/searchExtTypes';

export { TextSearchCompleteMessageType };

export const VIEWLET_ID = 'workbench.view.search';
export const PANEL_ID = 'workbench.panel.search';
export const VIEW_ID = 'workbench.view.search';

export const SEARCH_EXCLUDE_CONFIG = 'search.exclude';

// Warning: this pattern is used in the search editor to detect offsets. If you
// change this, also change the search-result built-in extension
const SEARCH_ELIDED_PREFIX = '⟪ ';
const SEARCH_ELIDED_SUFFIX = ' characters skipped ⟫';
const SEARCH_ELIDED_MIN_LEN = (SEARCH_ELIDED_PREFIX.length + SEARCH_ELIDED_SUFFIX.length + 5) * 2;

export const ISearchService = createDecorator<ISearchService>('searchService');

/**
 * A service that enables to search for files or with in files.
 */
export interface ISearchService {
	readonly _serviceBrand: undefined;
	textSearch(query: ITextQuery, token?: CancellationToken, onProgress?: (result: ISearchProgressItem) => void): Promise<ISearchComplete>;
	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete>;
	clearCache(cacheKey: string): Promise<void>;
	registerSearchResultProvider(scheme: string, type: SearchProviderType, provider: ISearchResultProvider): IDisposable;
}

/**
 * TODO@roblou - split text from file search entirely, or share code in a more natural way.
 */
export const enum SearchProviderType {
	file,
	text
}

export interface ISearchResultProvider {
	textSearch(query: ITextQuery, onProgress?: (p: ISearchProgressItem) => void, token?: CancellationToken): Promise<ISearchComplete>;
	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete>;
	clearCache(cacheKey: string): Promise<void>;
}

export interface IFolderQuery<U extends UriComponents = URI> {
	folder: U;
	folderName?: string;
	excludePattern?: glob.IExpression;
	includePattern?: glob.IExpression;
	fileEncoding?: string;
	disregardIgnoreFiles?: boolean;
	disregardGlobalIgnoreFiles?: boolean;
	ignoreSymlinks?: boolean;
}

export interface ICommonQueryProps<U extends UriComponents> {
	/** For telemetry - indicates what is triggering the source */
	_reason?: string;

	folderQueries: IFolderQuery<U>[];
	includePattern?: glob.IExpression;
	excludePattern?: glob.IExpression;
	extraFileResources?: U[];

	onlyOpenEditors?: boolean;

	maxResults?: number;
	usingSearchPaths?: boolean;
}

export interface IFileQueryProps<U extends UriComponents> extends ICommonQueryProps<U> {
	type: QueryType.File;
	filePattern?: string;

	/**
	 * If true no results will be returned. Instead `limitHit` will indicate if at least one result exists or not.
	 * Currently does not work with queries including a 'siblings clause'.
	 */
	exists?: boolean;
	sortByScore?: boolean;
	cacheKey?: string;
}

export interface ITextQueryProps<U extends UriComponents> extends ICommonQueryProps<U> {
	type: QueryType.Text;
	contentPattern: IPatternInfo;

	previewOptions?: ITextSearchPreviewOptions;
	maxFileSize?: number;
	usePCRE2?: boolean;
	afterContext?: number;
	beforeContext?: number;

	userDisabledExcludesAndIgnoreFiles?: boolean;
}

export type IFileQuery = IFileQueryProps<URI>;
export type IRawFileQuery = IFileQueryProps<UriComponents>;
export type ITextQuery = ITextQueryProps<URI>;
export type IRawTextQuery = ITextQueryProps<UriComponents>;

export type IRawQuery = IRawTextQuery | IRawFileQuery;
export type ISearchQuery = ITextQuery | IFileQuery;

export const enum QueryType {
	File = 1,
	Text = 2
}

/* __GDPR__FRAGMENT__
	"IPatternInfo" : {
		"pattern" : { "classification": "CustomerContent", "purpose": "FeatureInsight" },
		"isRegExp": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"isWordMatch": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"wordSeparators": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"isMultiline": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"isCaseSensitive": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"isSmartCase": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
	}
*/
export interface IPatternInfo {
	pattern: string;
	isRegExp?: boolean;
	isWordMatch?: boolean;
	wordSeparators?: string;
	isMultiline?: boolean;
	isUnicode?: boolean;
	isCaseSensitive?: boolean;
}

export interface IExtendedExtensionSearchOptions {
	usePCRE2?: boolean;
}

export interface IFileMatch<U extends UriComponents = URI> {
	resource: U;
	results?: ITextSearchResult[];
}

export type IRawFileMatch2 = IFileMatch<UriComponents>;

export interface ITextSearchPreviewOptions {
	matchLines: number;
	charsPerLine: number;
}

export interface ISearchRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface ITextSearchResultPreview {
	text: string;
	matches: ISearchRange | ISearchRange[];
}

export interface ITextSearchMatch {
	uri?: URI;
	ranges: ISearchRange | ISearchRange[];
	preview: ITextSearchResultPreview;
}

export interface ITextSearchContext {
	uri?: URI;
	text: string;
	lineNumber: number;
}

export type ITextSearchResult = ITextSearchMatch | ITextSearchContext;

export function resultIsMatch(result: ITextSearchResult): result is ITextSearchMatch {
	return !!(<ITextSearchMatch>result).preview;
}

export interface IProgressMessage {
	message: string;
}

export type ISearchProgressItem = IFileMatch | IProgressMessage;

export function isFileMatch(p: ISearchProgressItem): p is IFileMatch {
	return !!(<IFileMatch>p).resource;
}

export function isProgressMessage(p: ISearchProgressItem | ISerializedSearchProgressItem): p is IProgressMessage {
	return !!(p as IProgressMessage).message;
}

export interface ISearchCompleteStats {
	limitHit?: boolean;
	messages: { text: string, type: TextSearchCompleteMessageType }[];
	stats?: IFileSearchStats | ITextSearchStats;
}

export interface ISearchComplete extends ISearchCompleteStats {
	results: IFileMatch[];
	exit?: SearchCompletionExitCode
}

export const enum SearchCompletionExitCode {
	Normal,
	NewSearchStarted
}

export interface ITextSearchStats {
	type: 'textSearchProvider' | 'searchProcess';
}

export interface IFileSearchStats {
	fromCache: boolean;
	detailStats: ISearchEngineStats | ICachedSearchStats | IFileSearchProviderStats;

	resultCount: number;
	type: 'fileSearchProvider' | 'searchProcess';
	sortingTime?: number;
}

export interface ICachedSearchStats {
	cacheWasResolved: boolean;
	cacheLookupTime: number;
	cacheFilterTime: number;
	cacheEntryCount: number;
}

export interface ISearchEngineStats {
	fileWalkTime: number;
	directoriesWalked: number;
	filesWalked: number;
	cmdTime: number;
	cmdResultCount?: number;
}

export interface IFileSearchProviderStats {
	providerTime: number;
	postProcessTime: number;
}

export class FileMatch implements IFileMatch {
	results: ITextSearchResult[] = [];
	constructor(public resource: URI) {
		// empty
	}
}

export class TextSearchMatch implements ITextSearchMatch {
	ranges: ISearchRange | ISearchRange[];
	preview: ITextSearchResultPreview;

	constructor(text: string, range: ISearchRange | ISearchRange[], previewOptions?: ITextSearchPreviewOptions) {
		this.ranges = range;

		// Trim preview if this is one match and a single-line match with a preview requested.
		// Otherwise send the full text, like for replace or for showing multiple previews.
		// TODO this is fishy.
		const ranges = Array.isArray(range) ? range : [range];
		if (previewOptions && previewOptions.matchLines === 1 && isSingleLineRangeList(ranges)) {
			// 1 line preview requested
			text = getNLines(text, previewOptions.matchLines);

			let result = '';
			let shift = 0;
			let lastEnd = 0;
			const leadingChars = Math.floor(previewOptions.charsPerLine / 5);
			const matches: ISearchRange[] = [];
			for (const range of ranges) {
				const previewStart = Math.max(range.startColumn - leadingChars, 0);
				const previewEnd = range.startColumn + previewOptions.charsPerLine;
				if (previewStart > lastEnd + leadingChars + SEARCH_ELIDED_MIN_LEN) {
					const elision = SEARCH_ELIDED_PREFIX + (previewStart - lastEnd) + SEARCH_ELIDED_SUFFIX;
					result += elision + text.slice(previewStart, previewEnd);
					shift += previewStart - (lastEnd + elision.length);
				} else {
					result += text.slice(lastEnd, previewEnd);
				}

				matches.push(new OneLineRange(0, range.startColumn - shift, range.endColumn - shift));
				lastEnd = previewEnd;
			}

			this.preview = { text: result, matches: Array.isArray(this.ranges) ? matches : matches[0] };
		} else {
			const firstMatchLine = Array.isArray(range) ? range[0].startLineNumber : range.startLineNumber;

			this.preview = {
				text,
				matches: mapArrayOrNot(range, r => new SearchRange(r.startLineNumber - firstMatchLine, r.startColumn, r.endLineNumber - firstMatchLine, r.endColumn))
			};
		}
	}
}

function isSingleLineRangeList(ranges: ISearchRange[]): boolean {
	const line = ranges[0].startLineNumber;
	for (const r of ranges) {
		if (r.startLineNumber !== line || r.endLineNumber !== line) {
			return false;
		}
	}

	return true;
}

export class SearchRange implements ISearchRange {
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;

	constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
		this.startLineNumber = startLineNumber;
		this.startColumn = startColumn;
		this.endLineNumber = endLineNumber;
		this.endColumn = endColumn;
	}
}

export class OneLineRange extends SearchRange {
	constructor(lineNumber: number, startColumn: number, endColumn: number) {
		super(lineNumber, startColumn, lineNumber, endColumn);
	}
}

export const enum SearchSortOrder {
	Default = 'default',
	FileNames = 'fileNames',
	Type = 'type',
	Modified = 'modified',
	CountDescending = 'countDescending',
	CountAscending = 'countAscending'
}

export interface ISearchConfigurationProperties {
	exclude: glob.IExpression;
	useRipgrep: boolean;
	/**
	 * Use ignore file for file search.
	 */
	useIgnoreFiles: boolean;
	useGlobalIgnoreFiles: boolean;
	followSymlinks: boolean;
	smartCase: boolean;
	globalFindClipboard: boolean;
	location: 'sidebar' | 'panel';
	useReplacePreview: boolean;
	showLineNumbers: boolean;
	usePCRE2: boolean;
	actionsPosition: 'auto' | 'right';
	maintainFileSearchCache: boolean;
	collapseResults: 'auto' | 'alwaysCollapse' | 'alwaysExpand';
	searchOnType: boolean;
	seedOnFocus: boolean;
	seedWithNearestWord: boolean;
	searchOnTypeDebouncePeriod: number;
	mode: 'view' | 'reuseEditor' | 'newEditor';
	searchEditor: {
		doubleClickBehaviour: 'selectWord' | 'goToLocation' | 'openLocationToSide',
		reusePriorSearchConfiguration: boolean,
		defaultNumberOfContextLines: number | null,
		experimental: {}
	};
	sortOrder: SearchSortOrder;
}

export interface ISearchConfiguration extends IFilesConfiguration {
	search: ISearchConfigurationProperties;
	editor: {
		wordSeparators: string;
	};
}

export function getExcludes(configuration: ISearchConfiguration, includeSearchExcludes = true): glob.IExpression | undefined {
	const fileExcludes = configuration && configuration.files && configuration.files.exclude;
	const searchExcludes = includeSearchExcludes && configuration && configuration.search && configuration.search.exclude;

	if (!fileExcludes && !searchExcludes) {
		return undefined;
	}

	if (!fileExcludes || !searchExcludes) {
		return fileExcludes || searchExcludes;
	}

	let allExcludes: glob.IExpression = Object.create(null);
	// clone the config as it could be frozen
	allExcludes = objects.mixin(allExcludes, objects.deepClone(fileExcludes));
	allExcludes = objects.mixin(allExcludes, objects.deepClone(searchExcludes), true);

	return allExcludes;
}

export function pathIncludedInQuery(queryProps: ICommonQueryProps<URI>, fsPath: string): boolean {
	if (queryProps.excludePattern && glob.match(queryProps.excludePattern, fsPath)) {
		return false;
	}

	if (queryProps.includePattern || queryProps.usingSearchPaths) {
		if (queryProps.includePattern && glob.match(queryProps.includePattern, fsPath)) {
			return true;
		}

		// If searchPaths are being used, the extra file must be in a subfolder and match the pattern, if present
		if (queryProps.usingSearchPaths) {
			return !!queryProps.folderQueries && queryProps.folderQueries.some(fq => {
				const searchPath = fq.folder.fsPath;
				if (extpath.isEqualOrParent(fsPath, searchPath)) {
					const relPath = paths.relative(searchPath, fsPath);
					return !fq.includePattern || !!glob.match(fq.includePattern, relPath);
				} else {
					return false;
				}
			});
		}

		return false;
	}

	return true;
}

export enum SearchErrorCode {
	unknownEncoding = 1,
	regexParseError,
	globParseError,
	invalidLiteral,
	rgProcessError,
	other,
	canceled
}

export class SearchError extends Error {
	constructor(message: string, readonly code?: SearchErrorCode) {
		super(message);
	}
}

export function deserializeSearchError(error: Error): SearchError {
	const errorMsg = error.message;

	if (isPromiseCanceledError(error)) {
		return new SearchError(errorMsg, SearchErrorCode.canceled);
	}

	try {
		const details = JSON.parse(errorMsg);
		return new SearchError(details.message, details.code);
	} catch (e) {
		return new SearchError(errorMsg, SearchErrorCode.other);
	}
}

export function serializeSearchError(searchError: SearchError): Error {
	const details = { message: searchError.message, code: searchError.code };
	return new Error(JSON.stringify(details));
}
export interface ITelemetryEvent {
	eventName: string;
	data: ITelemetryData;
}

export interface IRawSearchService {
	fileSearch(search: IRawFileQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete>;
	textSearch(search: IRawTextQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete>;
	clearCache(cacheKey: string): Promise<void>;
}

export interface IRawFileMatch {
	base?: string;
	/**
	 * The path of the file relative to the containing `base` folder.
	 * This path is exactly as it appears on the filesystem.
	 */
	relativePath: string;
	/**
	 * This path is transformed for search purposes. For example, this could be
	 * the `relativePath` with the workspace folder name prepended. This way the
	 * search algorithm would also match against the name of the containing folder.
	 *
	 * If not given, the search algorithm should use `relativePath`.
	 */
	searchPath: string | undefined;
}

export interface ISearchEngine<T> {
	search: (onResult: (matches: T) => void, onProgress: (progress: IProgressMessage) => void, done: (error: Error | null, complete: ISearchEngineSuccess) => void) => void;
	cancel: () => void;
}

export interface ISerializedSearchSuccess {
	type: 'success';
	limitHit: boolean;
	messages: { text: string, type: TextSearchCompleteMessageType }[];
	stats?: IFileSearchStats | ITextSearchStats;
}

export interface ISearchEngineSuccess {
	limitHit: boolean;
	messages: { text: string, type: TextSearchCompleteMessageType }[];
	stats: ISearchEngineStats;
}

export interface ISerializedSearchError {
	type: 'error';
	error: {
		message: string,
		stack: string
	};
}

export type ISerializedSearchComplete = ISerializedSearchSuccess | ISerializedSearchError;

export function isSerializedSearchComplete(arg: ISerializedSearchProgressItem | ISerializedSearchComplete): arg is ISerializedSearchComplete {
	if ((arg as any).type === 'error') {
		return true;
	} else if ((arg as any).type === 'success') {
		return true;
	} else {
		return false;
	}
}

export function isSerializedSearchSuccess(arg: ISerializedSearchComplete): arg is ISerializedSearchSuccess {
	return arg.type === 'success';
}

export function isSerializedFileMatch(arg: ISerializedSearchProgressItem): arg is ISerializedFileMatch {
	return !!(<ISerializedFileMatch>arg).path;
}

export function isFilePatternMatch(candidate: IRawFileMatch, normalizedFilePatternLowercase: string): boolean {
	const pathToMatch = candidate.searchPath ? candidate.searchPath : candidate.relativePath;
	return fuzzyContains(pathToMatch, normalizedFilePatternLowercase);
}

export interface ISerializedFileMatch {
	path: string;
	results?: ITextSearchResult[];
	numMatches?: number;
}

// Type of the possible values for progress calls from the engine
export type ISerializedSearchProgressItem = ISerializedFileMatch | ISerializedFileMatch[] | IProgressMessage;
export type IFileSearchProgressItem = IRawFileMatch | IRawFileMatch[] | IProgressMessage;


export class SerializableFileMatch implements ISerializedFileMatch {
	path: string;
	results: ITextSearchMatch[];

	constructor(path: string) {
		this.path = path;
		this.results = [];
	}

	addMatch(match: ITextSearchMatch): void {
		this.results.push(match);
	}

	serialize(): ISerializedFileMatch {
		return {
			path: this.path,
			results: this.results,
			numMatches: this.results.length
		};
	}
}

/**
 *  Computes the patterns that the provider handles. Discards sibling clauses and 'false' patterns
 */
export function resolvePatternsForProvider(globalPattern: glob.IExpression | undefined, folderPattern: glob.IExpression | undefined): string[] {
	const merged = {
		...(globalPattern || {}),
		...(folderPattern || {})
	};

	return Object.keys(merged)
		.filter(key => {
			const value = merged[key];
			return typeof value === 'boolean' && value;
		});
}

export class QueryGlobTester {

	private _excludeExpression: glob.IExpression;
	private _parsedExcludeExpression: glob.ParsedExpression;

	private _parsedIncludeExpression: glob.ParsedExpression | null = null;

	constructor(config: ISearchQuery, folderQuery: IFolderQuery) {
		this._excludeExpression = {
			...(config.excludePattern || {}),
			...(folderQuery.excludePattern || {})
		};
		this._parsedExcludeExpression = glob.parse(this._excludeExpression);

		// Empty includeExpression means include nothing, so no {} shortcuts
		let includeExpression: glob.IExpression | undefined = config.includePattern;
		if (folderQuery.includePattern) {
			if (includeExpression) {
				includeExpression = {
					...includeExpression,
					...folderQuery.includePattern
				};
			} else {
				includeExpression = folderQuery.includePattern;
			}
		}

		if (includeExpression) {
			this._parsedIncludeExpression = glob.parse(includeExpression);
		}
	}

	/**
	 * Guaranteed sync - siblingsFn should not return a promise.
	 */
	includedInQuerySync(testPath: string, basename?: string, hasSibling?: (name: string) => boolean): boolean {
		if (this._parsedExcludeExpression && this._parsedExcludeExpression(testPath, basename, hasSibling)) {
			return false;
		}

		if (this._parsedIncludeExpression && !this._parsedIncludeExpression(testPath, basename, hasSibling)) {
			return false;
		}

		return true;
	}

	/**
	 * Guaranteed async.
	 */
	includedInQuery(testPath: string, basename?: string, hasSibling?: (name: string) => boolean | Promise<boolean>): Promise<boolean> {
		const excludeP = Promise.resolve(this._parsedExcludeExpression(testPath, basename, hasSibling)).then(result => !!result);

		return excludeP.then(excluded => {
			if (excluded) {
				return false;
			}

			return this._parsedIncludeExpression ?
				Promise.resolve(this._parsedIncludeExpression(testPath, basename, hasSibling)).then(result => !!result) :
				Promise.resolve(true);
		}).then(included => {
			return included;
		});
	}

	hasSiblingExcludeClauses(): boolean {
		return hasSiblingClauses(this._excludeExpression);
	}
}

function hasSiblingClauses(pattern: glob.IExpression): boolean {
	for (const key in pattern) {
		if (typeof pattern[key] !== 'boolean') {
			return true;
		}
	}

	return false;
}
