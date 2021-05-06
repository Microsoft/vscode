/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/anythingQuickAccess';
import { IQuickInputButton, IKeyMods, quickPickItemScorerAccessor, QuickPickItemScorerAccessor, IQuickPick, IQuickPickItemWithResource, QuickInputHideReason } from 'vs/platform/quickinput/common/quickInput';
import { IPickerQuickAccessItem, PickerQuickAccessProvider, TriggerAction, FastAndSlowPicks, Picks, PicksWithActive } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { prepareQuery, IPreparedQuery, compareItemsByFuzzyScore, scoreItemFuzzy, FuzzyScorerCache } from 'vs/base/common/fuzzyScorer';
import { IFileQueryBuilderOptions, QueryBuilder } from 'vs/workbench/contrib/search/common/queryBuilder';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { getOutOfWorkspaceEditorResources, extractRangeFromFilter, IWorkbenchSearchConfiguration } from 'vs/workbench/contrib/search/common/search';
import { ISearchService, ISearchComplete } from 'vs/workbench/services/search/common/search';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { untildify } from 'vs/base/common/labels';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { URI } from 'vs/base/common/uri';
import { toLocalResource, dirname, basenameOrAuthority } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IFileService } from 'vs/platform/files/common/files';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore, IDisposable, toDisposable, MutableDisposable, Disposable } from 'vs/base/common/lifecycle';
import { ILabelService } from 'vs/platform/label/common/label';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { localize } from 'vs/nls';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchEditorConfiguration, IEditorInput, EditorInput, EditorResourceAccessor } from 'vs/workbench/common/editor';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { Range, IRange } from 'vs/editor/common/core/range';
import { ThrottledDelayer } from 'vs/base/common/async';
import { top } from 'vs/base/common/arrays';
import { FileQueryCacheState } from 'vs/workbench/contrib/search/common/cacheState';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IResourceEditorInput, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { Schemas } from 'vs/base/common/network';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ResourceMap } from 'vs/base/common/map';
import { SymbolsQuickAccessProvider } from 'vs/workbench/contrib/search/browser/symbolsQuickAccess';
import { DefaultQuickAccessFilterValue } from 'vs/platform/quickinput/common/quickAccess';
import { IWorkbenchQuickAccessConfiguration } from 'vs/workbench/browser/quickaccess';
import { GotoSymbolQuickAccessProvider } from 'vs/workbench/contrib/codeEditor/browser/quickaccess/gotoSymbolQuickAccess';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ScrollType, IEditor, ICodeEditorViewState, IDiffEditorViewState } from 'vs/editor/common/editorCommon';
import { once } from 'vs/base/common/functional';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { getIEditor } from 'vs/editor/browser/editorBrowser';
import { withNullAsUndefined } from 'vs/base/common/types';
import { Codicon } from 'vs/base/common/codicons';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { stripIcons } from 'vs/base/common/iconLabels';

interface IAnythingQuickPickItem extends IPickerQuickAccessItem, IQuickPickItemWithResource { }

interface IEditorSymbolAnythingQuickPickItem extends IAnythingQuickPickItem {
	resource: URI;
	range: { decoration: IRange, selection: IRange }
}

function isEditorSymbolQuickPickItem(pick?: IAnythingQuickPickItem): pick is IEditorSymbolAnythingQuickPickItem {
	const candidate = pick ? pick as IEditorSymbolAnythingQuickPickItem : undefined;

	return !!candidate && !!candidate.range && !!candidate.resource;
}

export class AnythingQuickAccessProvider extends PickerQuickAccessProvider<IAnythingQuickPickItem> {

	static PREFIX = '';

	private static readonly NO_RESULTS_PICK: IAnythingQuickPickItem = {
		label: localize('noAnythingResults', "No matching results")
	};

	private static readonly MAX_RESULTS = 512;

	private static readonly TYPING_SEARCH_DELAY = 200; // this delay accommodates for the user typing a word and then stops typing to start searching

	private readonly pickState = new class {

		picker: IQuickPick<IAnythingQuickPickItem> | undefined = undefined;

		editorViewState: {
			editor: IEditorInput,
			group: IEditorGroup,
			state: ICodeEditorViewState | IDiffEditorViewState | undefined
		} | undefined = undefined;

		scorerCache: FuzzyScorerCache = Object.create(null);
		fileQueryCache: FileQueryCacheState | undefined = undefined;

		lastOriginalFilter: string | undefined = undefined;
		lastFilter: string | undefined = undefined;
		lastRange: IRange | undefined = undefined;

		lastGlobalPicks: PicksWithActive<IAnythingQuickPickItem> | undefined = undefined;

		isQuickNavigating: boolean | undefined = undefined;

		constructor(private readonly provider: AnythingQuickAccessProvider, private readonly editorService: IEditorService) { }

		set(picker: IQuickPick<IAnythingQuickPickItem>): void {

			// Picker for this run
			this.picker = picker;
			once(picker.onDispose)(() => {
				if (picker === this.picker) {
					this.picker = undefined; // clear the picker when disposed to not keep it in memory for too long
				}
			});

			// Caches
			const isQuickNavigating = !!picker.quickNavigate;
			if (!isQuickNavigating) {
				this.fileQueryCache = this.provider.createFileQueryCache();
				this.scorerCache = Object.create(null);
			}

			// Other
			this.isQuickNavigating = isQuickNavigating;
			this.lastOriginalFilter = undefined;
			this.lastFilter = undefined;
			this.lastRange = undefined;
			this.lastGlobalPicks = undefined;
			this.editorViewState = undefined;
		}

		rememberEditorViewState(): void {
			if (this.editorViewState) {
				return; // return early if already done
			}

			const activeEditorPane = this.editorService.activeEditorPane;
			if (activeEditorPane) {
				this.editorViewState = {
					group: activeEditorPane.group,
					editor: activeEditorPane.input,
					state: withNullAsUndefined(getIEditor(activeEditorPane.getControl())?.saveViewState())
				};
			}
		}

		async restoreEditorViewState(): Promise<void> {
			if (this.editorViewState) {
				await this.editorService.openEditor(
					this.editorViewState.editor,
					{ viewState: this.editorViewState.state, preserveFocus: true /* import to not close the picker as a result */ },
					this.editorViewState.group
				);
			}
		}
	}(this, this.editorService);

	get defaultFilterValue(): DefaultQuickAccessFilterValue | undefined {
		if (this.configuration.preserveInput) {
			return DefaultQuickAccessFilterValue.LAST;
		}

		return undefined;
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IPathService private readonly pathService: IPathService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IHistoryService private readonly historyService: IHistoryService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super(AnythingQuickAccessProvider.PREFIX, {
			canAcceptInBackground: true,
			noResultsPick: AnythingQuickAccessProvider.NO_RESULTS_PICK
		});
	}

	private get configuration() {
		const editorConfig = this.configurationService.getValue<IWorkbenchEditorConfiguration>().workbench?.editor;
		const searchConfig = this.configurationService.getValue<IWorkbenchSearchConfiguration>().search;
		const quickAccessConfig = this.configurationService.getValue<IWorkbenchQuickAccessConfiguration>().workbench.quickOpen;

		return {
			openEditorPinned: !editorConfig?.enablePreviewFromQuickOpen || !editorConfig?.enablePreview,
			openSideBySideDirection: editorConfig?.openSideBySideDirection,
			includeSymbols: searchConfig?.quickOpen.includeSymbols,
			includeHistory: searchConfig?.quickOpen.includeHistory,
			historyFilterSortOrder: searchConfig?.quickOpen.history.filterSortOrder,
			shortAutoSaveDelay: this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY,
			preserveInput: quickAccessConfig.preserveInput
		};
	}

	override provide(picker: IQuickPick<IAnythingQuickPickItem>, token: CancellationToken): IDisposable {
		const disposables = new DisposableStore();

		// Update the pick state for this run
		this.pickState.set(picker);

		// Add editor decorations for active editor symbol picks
		const editorDecorationsDisposable = disposables.add(new MutableDisposable());
		disposables.add(picker.onDidChangeActive(() => {

			// Clear old decorations
			editorDecorationsDisposable.value = undefined;

			// Add new decoration if editor symbol is active
			const [item] = picker.activeItems;
			if (isEditorSymbolQuickPickItem(item)) {
				editorDecorationsDisposable.value = this.decorateAndRevealSymbolRange(item);
			}
		}));

		// Restore view state upon cancellation if we changed it
		// but only when the picker was closed via explicit user
		// gesture and not e.g. when focus was lost because that
		// could mean the user clicked into the editor directly.
		disposables.add(once(picker.onDidHide)(({ reason }) => {
			if (reason === QuickInputHideReason.Gesture) {
				this.pickState.restoreEditorViewState();
			}
		}));

		// Start picker
		disposables.add(super.provide(picker, token));

		return disposables;
	}

	private decorateAndRevealSymbolRange(pick: IEditorSymbolAnythingQuickPickItem): IDisposable {
		const activeEditor = this.editorService.activeEditor;
		if (!this.uriIdentityService.extUri.isEqual(pick.resource, activeEditor?.resource)) {
			return Disposable.None; // active editor needs to be for resource
		}

		const activeEditorControl = this.editorService.activeTextEditorControl;
		if (!activeEditorControl) {
			return Disposable.None; // we need a text editor control to decorate and reveal
		}

		// we must remember our curret view state to be able to restore
		this.pickState.rememberEditorViewState();

		// Reveal
		activeEditorControl.revealRangeInCenter(pick.range.selection, ScrollType.Smooth);

		// Decorate
		this.addDecorations(activeEditorControl, pick.range.decoration);

		return toDisposable(() => this.clearDecorations(activeEditorControl));
	}

	protected _getPicks(originalFilter: string, disposables: DisposableStore, token: CancellationToken): Picks<IAnythingQuickPickItem> | Promise<Picks<IAnythingQuickPickItem>> | FastAndSlowPicks<IAnythingQuickPickItem> | null {

		// Find a suitable range from the pattern looking for ":", "#" or ","
		// unless we have the `@` editor symbol character inside the filter
		const filterWithRange = extractRangeFromFilter(originalFilter, [GotoSymbolQuickAccessProvider.PREFIX]);

		// Update filter with normalized values
		let filter: string;
		if (filterWithRange) {
			filter = filterWithRange.filter;
		} else {
			filter = originalFilter;
		}

		// Remember as last range
		this.pickState.lastRange = filterWithRange?.range;

		// If the original filter value has changed but the normalized
		// one has not, we return early with a `null` result indicating
		// that the results should preserve because the range information
		// (:<line>:<column>) does not need to trigger any re-sorting.
		if (originalFilter !== this.pickState.lastOriginalFilter && filter === this.pickState.lastFilter) {
			return null;
		}

		// Remember as last filter
		const lastWasFiltering = !!this.pickState.lastOriginalFilter;
		this.pickState.lastOriginalFilter = originalFilter;
		this.pickState.lastFilter = filter;

		// Remember our pick state before returning new picks
		// unless we are inside an editor symbol filter or result.
		// We can use this state to return back to the global pick
		// when the user is narrowing back out of editor symbols.
		const picks = this.pickState.picker?.items;
		const activePick = this.pickState.picker?.activeItems[0];
		if (picks && activePick) {
			const activePickIsEditorSymbol = isEditorSymbolQuickPickItem(activePick);
			const activePickIsNoResultsInEditorSymbols = activePick === AnythingQuickAccessProvider.NO_RESULTS_PICK && filter.indexOf(GotoSymbolQuickAccessProvider.PREFIX) >= 0;
			if (!activePickIsEditorSymbol && !activePickIsNoResultsInEditorSymbols) {
				this.pickState.lastGlobalPicks = {
					items: picks,
					active: activePick
				};
			}
		}

		// `enableEditorSymbolSearch`: this will enable local editor symbol
		// search if the filter value includes `@` character. We only want
		// to enable this support though if the user was filtering in the
		// picker because this feature depends on an active item in the result
		// list to get symbols from. If we would simply trigger editor symbol
		// search without prior filtering, you could not paste a file name
		// including the `@` character to open it (e.g. /some/file@path)
		// refs: https://github.com/microsoft/vscode/issues/93845
		return this.doGetPicks(filter, { enableEditorSymbolSearch: lastWasFiltering }, disposables, token);
	}

	private doGetPicks(filter: string, options: { enableEditorSymbolSearch: boolean }, disposables: DisposableStore, token: CancellationToken): Picks<IAnythingQuickPickItem> | Promise<Picks<IAnythingQuickPickItem>> | FastAndSlowPicks<IAnythingQuickPickItem> {
		const query = prepareQuery(filter);

		// Return early if we have editor symbol picks. We support this by:
		// - having a previously active global pick (e.g. a file)
		// - the user typing `@` to start the local symbol query
		if (options.enableEditorSymbolSearch) {
			const editorSymbolPicks = this.getEditorSymbolPicks(query, disposables, token);
			if (editorSymbolPicks) {
				return editorSymbolPicks;
			}
		}

		// If we have a known last active editor symbol pick, we try to restore
		// the last global pick to support the case of narrowing out from a
		// editor symbol search back into the global search
		const activePick = this.pickState.picker?.activeItems[0];
		if (isEditorSymbolQuickPickItem(activePick) && this.pickState.lastGlobalPicks) {
			return this.pickState.lastGlobalPicks;
		}

		// Otherwise return normally with history and file/symbol results
		const historyEditorPicks = this.getEditorHistoryPicks(query);

		return {

			// Fast picks: editor history
			picks:
				(this.pickState.isQuickNavigating || historyEditorPicks.length === 0) ?
					historyEditorPicks :
					[
						{ type: 'separator', label: localize('recentlyOpenedSeparator', "recently opened") },
						...historyEditorPicks
					],

			// Slow picks: files and symbols
			additionalPicks: (async (): Promise<Picks<IAnythingQuickPickItem>> => {

				// Exclude any result that is already present in editor history
				const additionalPicksExcludes = new ResourceMap<boolean>();
				for (const historyEditorPick of historyEditorPicks) {
					if (historyEditorPick.resource) {
						additionalPicksExcludes.set(historyEditorPick.resource, true);
					}
				}

				const additionalPicks = await this.getAdditionalPicks(query, additionalPicksExcludes, token);
				if (token.isCancellationRequested) {
					return [];
				}

				return additionalPicks.length > 0 ? [
					{ type: 'separator', label: this.configuration.includeSymbols ? localize('fileAndSymbolResultsSeparator', "file and symbol results") : localize('fileResultsSeparator', "file results") },
					...additionalPicks
				] : [];
			})()
		};
	}

	private async getAdditionalPicks(query: IPreparedQuery, excludes: ResourceMap<boolean>, token: CancellationToken): Promise<Array<IAnythingQuickPickItem>> {

		// Resolve file and symbol picks (if enabled)
		const [filePicks, symbolPicks] = await Promise.all([
			this.getFilePicks(query, excludes, token),
			this.getWorkspaceSymbolPicks(query, token)
		]);

		if (token.isCancellationRequested) {
			return [];
		}

		// Perform sorting (top results by score)
		const sortedAnythingPicks = top(
			[...filePicks, ...symbolPicks],
			(anyPickA, anyPickB) => compareItemsByFuzzyScore(anyPickA, anyPickB, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache),
			AnythingQuickAccessProvider.MAX_RESULTS
		);

		// Perform filtering
		const filteredAnythingPicks: IAnythingQuickPickItem[] = [];
		for (const anythingPick of sortedAnythingPicks) {

			// Always preserve any existing highlights (e.g. from workspace symbols)
			if (anythingPick.highlights) {
				filteredAnythingPicks.push(anythingPick);
			}

			// Otherwise, do the scoring and matching here
			else {
				const { score, labelMatch, descriptionMatch } = scoreItemFuzzy(anythingPick, query, true, quickPickItemScorerAccessor, this.pickState.scorerCache);
				if (!score) {
					continue;
				}

				anythingPick.highlights = {
					label: labelMatch,
					description: descriptionMatch
				};

				filteredAnythingPicks.push(anythingPick);
			}
		}

		return filteredAnythingPicks;
	}


	//#region Editor History

	private readonly labelOnlyEditorHistoryPickAccessor = new QuickPickItemScorerAccessor({ skipDescription: true });

	private getEditorHistoryPicks(query: IPreparedQuery): Array<IAnythingQuickPickItem> {
		const configuration = this.configuration;

		// Just return all history entries if not searching
		if (!query.normalized) {
			return this.historyService.getHistory().map(editor => this.createAnythingPick(editor, configuration));
		}

		if (!this.configuration.includeHistory) {
			return []; // disabled when searching
		}

		// Perform filtering
		const editorHistoryScorerAccessor = query.containsPathSeparator ? quickPickItemScorerAccessor : this.labelOnlyEditorHistoryPickAccessor; // Only match on label of the editor unless the search includes path separators
		const editorHistoryPicks: Array<IAnythingQuickPickItem> = [];
		for (const editor of this.historyService.getHistory()) {
			const resource = editor.resource;
			if (!resource || (!this.fileService.canHandleResource(resource) && resource.scheme !== Schemas.untitled)) {
				continue; // exclude editors without file resource if we are searching by pattern
			}

			const editorHistoryPick = this.createAnythingPick(editor, configuration);

			const { score, labelMatch, descriptionMatch } = scoreItemFuzzy(editorHistoryPick, query, false, editorHistoryScorerAccessor, this.pickState.scorerCache);
			if (!score) {
				continue; // exclude editors not matching query
			}

			editorHistoryPick.highlights = {
				label: labelMatch,
				description: descriptionMatch
			};

			editorHistoryPicks.push(editorHistoryPick);
		}

		// Return without sorting if settings tell to sort by recency
		if (this.configuration.historyFilterSortOrder === 'recency') {
			return editorHistoryPicks;
		}

		// Perform sorting
		return editorHistoryPicks.sort((editorA, editorB) => compareItemsByFuzzyScore(editorA, editorB, query, false, editorHistoryScorerAccessor, this.pickState.scorerCache));
	}

	//#endregion


	//#region File Search

	private readonly fileQueryDelayer = this._register(new ThrottledDelayer<URI[]>(AnythingQuickAccessProvider.TYPING_SEARCH_DELAY));

	private readonly fileQueryBuilder = this.instantiationService.createInstance(QueryBuilder);

	private createFileQueryCache(): FileQueryCacheState {
		return new FileQueryCacheState(
			cacheKey => this.fileQueryBuilder.file(this.contextService.getWorkspace().folders, this.getFileQueryOptions({ cacheKey })),
			query => this.searchService.fileSearch(query),
			cacheKey => this.searchService.clearCache(cacheKey),
			this.pickState.fileQueryCache
		).load();
	}

	private async getFilePicks(query: IPreparedQuery, excludes: ResourceMap<boolean>, token: CancellationToken): Promise<Array<IAnythingQuickPickItem>> {
		if (!query.normalized) {
			return [];
		}

		// Absolute path result
		const absolutePathResult = await this.getAbsolutePathFileResult(query, token);
		if (token.isCancellationRequested) {
			return [];
		}

		// Use absolute path result as only results if present
		let fileMatches: Array<URI>;
		if (absolutePathResult) {
			if (excludes.has(absolutePathResult)) {
				return []; // excluded
			}

			// Create a single result pick and make sure to apply full
			// highlights to ensure the pick is displayed. Since a
			// ~ might have been used for searching, our fuzzy scorer
			// may otherwise not properly respect the pick as a result
			const absolutePathPick = this.createAnythingPick(absolutePathResult, this.configuration);
			absolutePathPick.highlights = {
				label: [{ start: 0, end: absolutePathPick.label.length }],
				description: absolutePathPick.description ? [{ start: 0, end: absolutePathPick.description.length }] : undefined
			};

			return [absolutePathPick];
		}

		// Otherwise run the file search (with a delayer if cache is not ready yet)
		if (this.pickState.fileQueryCache?.isLoaded) {
			fileMatches = await this.doFileSearch(query, token);
		} else {
			fileMatches = await this.fileQueryDelayer.trigger(async () => {
				if (token.isCancellationRequested) {
					return [];
				}

				return this.doFileSearch(query, token);
			});
		}

		if (token.isCancellationRequested) {
			return [];
		}

		// Filter excludes & convert to picks
		const configuration = this.configuration;
		return fileMatches
			.filter(resource => !excludes.has(resource))
			.map(resource => this.createAnythingPick(resource, configuration));
	}

	private async doFileSearch(query: IPreparedQuery, token: CancellationToken): Promise<URI[]> {
		const [fileSearchResults, relativePathFileResults] = await Promise.all([

			// File search: this is a search over all files of the workspace using the provided pattern
			this.getFileSearchResults(query, token),

			// Relative path search: we also want to consider results that match files inside the workspace
			// by looking for relative paths that the user typed as query. This allows to return even excluded
			// results into the picker if found (e.g. helps for opening compilation results that are otherwise
			// excluded)
			this.getRelativePathFileResults(query, token)
		]);

		if (token.isCancellationRequested) {
			return [];
		}

		// Return quickly if no relative results are present
		if (!relativePathFileResults) {
			return fileSearchResults;
		}

		// Otherwise, make sure to filter relative path results from
		// the search results to prevent duplicates
		const relativePathFileResultsMap = new ResourceMap<boolean>();
		for (const relativePathFileResult of relativePathFileResults) {
			relativePathFileResultsMap.set(relativePathFileResult, true);
		}

		return [
			...fileSearchResults.filter(result => !relativePathFileResultsMap.has(result)),
			...relativePathFileResults
		];
	}

	private async getFileSearchResults(query: IPreparedQuery, token: CancellationToken): Promise<URI[]> {

		// filePattern for search depends on the number of queries in input:
		// - with multiple: only take the first one and let the filter later drop non-matching results
		// - with single: just take the original in full
		//
		// This enables to e.g. search for "someFile someFolder" by only returning
		// search results for "someFile" and not both that would normally not match.
		//
		let filePattern = '';
		if (query.values && query.values.length > 1) {
			filePattern = query.values[0].original;
		} else {
			filePattern = query.original;
		}

		const fileSearchResults = await this.doGetFileSearchResults(filePattern, token);
		if (token.isCancellationRequested) {
			return [];
		}

		// If we detect that the search limit has been hit and we have a query
		// that was composed of multiple inputs where we only took the first part
		// we run another search with the full original query included to make
		// sure we are including all possible results that could match.
		if (fileSearchResults.limitHit && query.values && query.values.length > 1) {
			const additionalFileSearchResults = await this.doGetFileSearchResults(query.original, token);
			if (token.isCancellationRequested) {
				return [];
			}

			// Remember which result we already covered
			const existingFileSearchResultsMap = new ResourceMap<boolean>();
			for (const fileSearchResult of fileSearchResults.results) {
				existingFileSearchResultsMap.set(fileSearchResult.resource, true);
			}

			// Add all additional results to the original set for inclusion
			for (const additionalFileSearchResult of additionalFileSearchResults.results) {
				if (!existingFileSearchResultsMap.has(additionalFileSearchResult.resource)) {
					fileSearchResults.results.push(additionalFileSearchResult);
				}
			}
		}

		return fileSearchResults.results.map(result => result.resource);
	}

	private doGetFileSearchResults(filePattern: string, token: CancellationToken): Promise<ISearchComplete> {
		return this.searchService.fileSearch(
			this.fileQueryBuilder.file(
				this.contextService.getWorkspace().folders,
				this.getFileQueryOptions({
					filePattern,
					cacheKey: this.pickState.fileQueryCache?.cacheKey,
					maxResults: AnythingQuickAccessProvider.MAX_RESULTS
				})
			), token);
	}

	private getFileQueryOptions(input: { filePattern?: string, cacheKey?: string, maxResults?: number }): IFileQueryBuilderOptions {
		return {
			_reason: 'openFileHandler', // used for telemetry - do not change
			extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			filePattern: input.filePattern || '',
			cacheKey: input.cacheKey,
			maxResults: input.maxResults || 0,
			sortByScore: true
		};
	}

	private async getAbsolutePathFileResult(query: IPreparedQuery, token: CancellationToken): Promise<URI | undefined> {
		if (!query.containsPathSeparator) {
			return;
		}

		const userHome = await this.pathService.userHome();
		const detildifiedQuery = untildify(query.original, userHome.scheme === Schemas.file ? userHome.fsPath : userHome.path);
		if (token.isCancellationRequested) {
			return;
		}

		const isAbsolutePathQuery = (await this.pathService.path).isAbsolute(detildifiedQuery);
		if (token.isCancellationRequested) {
			return;
		}

		if (isAbsolutePathQuery) {
			const resource = toLocalResource(
				await this.pathService.fileURI(detildifiedQuery),
				this.environmentService.remoteAuthority,
				this.pathService.defaultUriScheme
			);

			if (token.isCancellationRequested) {
				return;
			}

			try {
				if ((await this.fileService.resolve(resource)).isFile) {
					return resource;
				}
			} catch (error) {
				// ignore if file does not exist
			}
		}

		return;
	}

	private async getRelativePathFileResults(query: IPreparedQuery, token: CancellationToken): Promise<URI[] | undefined> {
		if (!query.containsPathSeparator) {
			return;
		}

		// Convert relative paths to absolute paths over all folders of the workspace
		// and return them as results if the absolute paths exist
		const isAbsolutePathQuery = (await this.pathService.path).isAbsolute(query.original);
		if (!isAbsolutePathQuery) {
			const resources: URI[] = [];
			for (const folder of this.contextService.getWorkspace().folders) {
				if (token.isCancellationRequested) {
					break;
				}

				const resource = toLocalResource(
					folder.toResource(query.original),
					this.environmentService.remoteAuthority,
					this.pathService.defaultUriScheme
				);

				try {
					if ((await this.fileService.resolve(resource)).isFile) {
						resources.push(resource);
					}
				} catch (error) {
					// ignore if file does not exist
				}
			}

			return resources;
		}

		return;
	}

	//#endregion


	//#region Workspace Symbols (if enabled)

	private workspaceSymbolsQuickAccess = this._register(this.instantiationService.createInstance(SymbolsQuickAccessProvider));

	private async getWorkspaceSymbolPicks(query: IPreparedQuery, token: CancellationToken): Promise<Array<IAnythingQuickPickItem>> {
		const configuration = this.configuration;
		if (
			!query.normalized ||	// we need a value for search for
			!configuration.includeSymbols ||		// we need to enable symbols in search
			this.pickState.lastRange				// a range is an indicator for just searching for files
		) {
			return [];
		}

		// Delegate to the existing symbols quick access
		// but skip local results and also do not score
		return this.workspaceSymbolsQuickAccess.getSymbolPicks(query.original, {
			skipLocal: true,
			skipSorting: true,
			delay: AnythingQuickAccessProvider.TYPING_SEARCH_DELAY
		}, token);
	}

	//#endregion


	//#region Editor Symbols (if narrowing down into a global pick via `@`)

	private readonly editorSymbolsQuickAccess = this.instantiationService.createInstance(GotoSymbolQuickAccessProvider);

	private getEditorSymbolPicks(query: IPreparedQuery, disposables: DisposableStore, token: CancellationToken): Promise<Picks<IAnythingQuickPickItem>> | null {
		const filterSegments = query.original.split(GotoSymbolQuickAccessProvider.PREFIX);
		const filter = filterSegments.length > 1 ? filterSegments[filterSegments.length - 1].trim() : undefined;
		if (typeof filter !== 'string') {
			return null; // we need to be searched for editor symbols via `@`
		}

		const activeGlobalPick = this.pickState.lastGlobalPicks?.active;
		if (!activeGlobalPick) {
			return null; // we need an active global pick to find symbols for
		}

		const activeGlobalResource = activeGlobalPick.resource;
		if (!activeGlobalResource || (!this.fileService.canHandleResource(activeGlobalResource) && activeGlobalResource.scheme !== Schemas.untitled)) {
			return null; // we need a resource that we can resolve
		}

		if (activeGlobalPick.label.includes(GotoSymbolQuickAccessProvider.PREFIX) || activeGlobalPick.description?.includes(GotoSymbolQuickAccessProvider.PREFIX)) {
			if (filterSegments.length < 3) {
				return null; // require at least 2 `@` if our active pick contains `@` in label or description
			}
		}

		return this.doGetEditorSymbolPicks(activeGlobalPick, activeGlobalResource, filter, disposables, token);
	}

	private async doGetEditorSymbolPicks(activeGlobalPick: IAnythingQuickPickItem, activeGlobalResource: URI, filter: string, disposables: DisposableStore, token: CancellationToken): Promise<Picks<IAnythingQuickPickItem>> {

		// Bring the editor to front to review symbols to go to
		try {

			// we must remember our curret view state to be able to restore
			this.pickState.rememberEditorViewState();

			// open it
			await this.editorService.openEditor({
				resource: activeGlobalResource,
				options: { preserveFocus: true, revealIfOpened: true, ignoreError: true }
			});
		} catch (error) {
			return []; // return if resource cannot be opened
		}

		if (token.isCancellationRequested) {
			return [];
		}

		// Obtain model from resource
		let model = this.modelService.getModel(activeGlobalResource);
		if (!model) {
			try {
				const modelReference = disposables.add(await this.textModelService.createModelReference(activeGlobalResource));
				if (token.isCancellationRequested) {
					return [];
				}

				model = modelReference.object.textEditorModel;
			} catch (error) {
				return []; // return if model cannot be resolved
			}
		}

		// Ask provider for editor symbols
		const editorSymbolPicks = (await this.editorSymbolsQuickAccess.getSymbolPicks(model, filter, { extraContainerLabel: stripIcons(activeGlobalPick.label) }, disposables, token));
		if (token.isCancellationRequested) {
			return [];
		}

		return editorSymbolPicks.map(editorSymbolPick => {

			// Preserve separators
			if (editorSymbolPick.type === 'separator') {
				return editorSymbolPick;
			}

			// Convert editor symbols to anything pick
			return {
				...editorSymbolPick,
				resource: activeGlobalResource,
				description: editorSymbolPick.description,
				trigger: (buttonIndex, keyMods) => {
					this.openAnything(activeGlobalResource, { keyMods, range: editorSymbolPick.range?.selection, forceOpenSideBySide: true });

					return TriggerAction.CLOSE_PICKER;
				},
				accept: (keyMods, event) => this.openAnything(activeGlobalResource, { keyMods, range: editorSymbolPick.range?.selection, preserveFocus: event.inBackground, forcePinned: event.inBackground })
			};
		});
	}

	addDecorations(editor: IEditor, range: IRange): void {
		this.editorSymbolsQuickAccess.addDecorations(editor, range);
	}

	clearDecorations(editor: IEditor): void {
		this.editorSymbolsQuickAccess.clearDecorations(editor);
	}

	//#endregion


	//#region Helpers

	private createAnythingPick(resourceOrEditor: URI | IEditorInput | IResourceEditorInput, configuration: { shortAutoSaveDelay: boolean, openSideBySideDirection: 'right' | 'down' | undefined }): IAnythingQuickPickItem {
		const isEditorHistoryEntry = !URI.isUri(resourceOrEditor);

		let resource: URI | undefined;
		let label: string;
		let description: string | undefined = undefined;
		let isDirty: boolean | undefined = undefined;

		if (resourceOrEditor instanceof EditorInput) {
			resource = EditorResourceAccessor.getOriginalUri(resourceOrEditor);
			label = resourceOrEditor.getName();
			description = resourceOrEditor.getDescription();
			isDirty = resourceOrEditor.isDirty() && !resourceOrEditor.isSaving();
		} else {
			resource = URI.isUri(resourceOrEditor) ? resourceOrEditor : (resourceOrEditor as IResourceEditorInput).resource;
			label = basenameOrAuthority(resource);
			description = this.labelService.getUriLabel(dirname(resource), { relative: true });
			isDirty = this.workingCopyService.isDirty(resource) && !configuration.shortAutoSaveDelay;
		}

		const labelAndDescription = description ? `${label} ${description}` : label;
		return {
			resource,
			label,
			ariaLabel: isDirty ? localize('filePickAriaLabelDirty', "{0} dirty", labelAndDescription) : labelAndDescription,
			description,
			iconClasses: getIconClasses(this.modelService, this.modeService, resource),
			buttons: (() => {
				const openSideBySideDirection = configuration.openSideBySideDirection;
				const buttons: IQuickInputButton[] = [];

				// Open to side / below
				buttons.push({
					iconClass: openSideBySideDirection === 'right' ? Codicon.splitHorizontal.classNames : Codicon.splitVertical.classNames,
					tooltip: openSideBySideDirection === 'right' ?
						localize({ key: 'openToSide', comment: ['Open this file in a split editor on the left/right side'] }, "Open to the Side") :
						localize({ key: 'openToBottom', comment: ['Open this file in a split editor on the bottom'] }, "Open to the Bottom")
				});

				// Remove from History
				if (isEditorHistoryEntry) {
					buttons.push({
						iconClass: isDirty ? ('dirty-anything ' + Codicon.circleFilled.classNames) : Codicon.close.classNames,
						tooltip: localize('closeEditor', "Remove from Recently Opened"),
						alwaysVisible: isDirty
					});
				}

				return buttons;
			})(),
			trigger: (buttonIndex, keyMods) => {
				switch (buttonIndex) {

					// Open to side / below
					case 0:
						this.openAnything(resourceOrEditor, { keyMods, range: this.pickState.lastRange, forceOpenSideBySide: true });

						return TriggerAction.CLOSE_PICKER;

					// Remove from History
					case 1:
						if (!URI.isUri(resourceOrEditor)) {
							this.historyService.removeFromHistory(resourceOrEditor);

							return TriggerAction.REMOVE_ITEM;
						}
				}

				return TriggerAction.NO_ACTION;
			},
			accept: (keyMods, event) => this.openAnything(resourceOrEditor, { keyMods, range: this.pickState.lastRange, preserveFocus: event.inBackground, forcePinned: event.inBackground })
		};
	}

	private async openAnything(resourceOrEditor: URI | IEditorInput | IResourceEditorInput, options: { keyMods?: IKeyMods, preserveFocus?: boolean, range?: IRange, forceOpenSideBySide?: boolean, forcePinned?: boolean }): Promise<void> {
		const editorOptions: ITextEditorOptions = {
			preserveFocus: options.preserveFocus,
			pinned: options.keyMods?.ctrlCmd || options.forcePinned || this.configuration.openEditorPinned,
			selection: options.range ? Range.collapseToStart(options.range) : undefined
		};

		const targetGroup = options.keyMods?.alt || (this.configuration.openEditorPinned && options.keyMods?.ctrlCmd) || options.forceOpenSideBySide ? SIDE_GROUP : ACTIVE_GROUP;

		// Restore any view state if the target is the side group
		if (targetGroup === SIDE_GROUP) {
			await this.pickState.restoreEditorViewState();
		}

		// Open editor
		if (resourceOrEditor instanceof EditorInput) {
			await this.editorService.openEditor(resourceOrEditor, editorOptions);
		} else {
			await this.editorService.openEditor({
				resource: URI.isUri(resourceOrEditor) ? resourceOrEditor : resourceOrEditor.resource,
				options: editorOptions
			}, targetGroup);
		}

	}

	//#endregion
}
