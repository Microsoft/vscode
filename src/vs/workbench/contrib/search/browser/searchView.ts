/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import * as aria from 'vs/base/browser/ui/aria/aria';
import { MessageType } from 'vs/base/browser/ui/inputbox/inputBox';
import { IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { ITreeContextMenuEvent, ITreeElement } from 'vs/base/browser/ui/tree/tree';
import { IAction } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import * as errors from 'vs/base/common/errors';
import { Event } from 'vs/base/common/event';
import { Iterator } from 'vs/base/common/iterator';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import * as env from 'vs/base/common/platform';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/searchview';
import { ICodeEditor, isCodeEditor, isDiffEditor, getCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import * as nls from 'vs/nls';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IConfirmation, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { FileChangesEvent, FileChangeType, IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TreeResourceNavigator2, WorkbenchObjectTree, getSelectionKeyboardEvent } from 'vs/platform/list/browser/listService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IProgressService, IProgressStep, IProgress } from 'vs/platform/progress/common/progress';
import { IPatternInfo, ISearchComplete, ISearchConfiguration, ISearchConfigurationProperties, ITextQuery, VIEW_ID, VIEWLET_ID } from 'vs/workbench/services/search/common/search';
import { ISearchHistoryService, ISearchHistoryValues } from 'vs/workbench/contrib/search/common/searchHistoryService';
import { diffInserted, diffInsertedOutline, diffRemoved, diffRemovedOutline, editorFindMatchHighlight, editorFindMatchHighlightBorder, listActiveSelectionForeground } from 'vs/platform/theme/common/colorRegistry';
import { ICssStyleCollector, ITheme, IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { OpenFileFolderAction, OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { IEditor } from 'vs/workbench/common/editor';
import { ExcludePatternInputWidget, PatternInputWidget } from 'vs/workbench/contrib/search/browser/patternInputWidget';
import { CancelSearchAction, ClearSearchResultsAction, CollapseDeepestExpandedLevelAction, RefreshAction, IFindInFilesArgs, OpenResultsInEditorAction, appendKeyBindingLabel } from 'vs/workbench/contrib/search/browser/searchActions';
import { FileMatchRenderer, FolderMatchRenderer, MatchRenderer, SearchAccessibilityProvider, SearchDelegate, SearchDND } from 'vs/workbench/contrib/search/browser/searchResultsView';
import { ISearchWidgetOptions, SearchWidget } from 'vs/workbench/contrib/search/browser/searchWidget';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { ITextQueryBuilderOptions, QueryBuilder } from 'vs/workbench/contrib/search/common/queryBuilder';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { getOutOfWorkspaceEditorResources } from 'vs/workbench/contrib/search/common/search';
import { FileMatch, FileMatchOrMatch, IChangeEvent, ISearchWorkbenchService, Match, RenderableMatch, searchMatchComparer, SearchModel, SearchResult, FolderMatch, FolderMatchWithResource } from 'vs/workbench/contrib/search/common/searchModel';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IPreferencesService, ISettingsEditorOptions } from 'vs/workbench/services/preferences/common/preferences';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { relativePath } from 'vs/base/common/resources';
import { IAccessibilityService, AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { ViewletPane, IViewletPaneOptions } from 'vs/workbench/browser/parts/views/paneViewlet';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Memento, MementoObject } from 'vs/workbench/common/memento';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { MultiCursorSelectionController } from 'vs/editor/contrib/multicursor/multicursor';
import { Selection } from 'vs/editor/common/core/selection';
import { SIDE_BAR_BACKGROUND, PANEL_BACKGROUND } from 'vs/workbench/common/theme';
import { createEditorFromSearchResult } from 'vs/workbench/contrib/search/browser/searchEditor';
import { ILabelService } from 'vs/platform/label/common/label';

const $ = dom.$;

enum SearchUIState {
	Idle,
	Searching,
	SlowSearch
}

export enum SearchViewPosition {
	SideBar,
	Panel
}

const SEARCH_CANCELLED_MESSAGE = nls.localize('searchCanceled', "Search was canceled before any results could be found - ");
export class SearchView extends ViewletPane {

	private static readonly MAX_TEXT_RESULTS = 10000;

	private static readonly WIDE_CLASS_NAME = 'wide';
	private static readonly WIDE_VIEW_SIZE = 1000;
	private static readonly ACTIONS_RIGHT_CLASS_NAME = 'actions-right';

	private isDisposed = false;

	private container!: HTMLElement;
	private queryBuilder: QueryBuilder;
	private viewModel: SearchModel;
	private memento: Memento;

	private viewletVisible: IContextKey<boolean>;
	private viewletFocused: IContextKey<boolean>;
	private inputBoxFocused: IContextKey<boolean>;
	private inputPatternIncludesFocused: IContextKey<boolean>;
	private inputPatternExclusionsFocused: IContextKey<boolean>;
	private firstMatchFocused: IContextKey<boolean>;
	private fileMatchOrMatchFocused: IContextKey<boolean>;
	private fileMatchOrFolderMatchFocus: IContextKey<boolean>;
	private fileMatchOrFolderMatchWithResourceFocus: IContextKey<boolean>;
	private fileMatchFocused: IContextKey<boolean>;
	private folderMatchFocused: IContextKey<boolean>;
	private matchFocused: IContextKey<boolean>;
	private hasSearchResultsKey: IContextKey<boolean>;
	private enableSearchEditorPreview: IContextKey<boolean>;

	private state: SearchUIState = SearchUIState.Idle;

	private actions: Array<CollapseDeepestExpandedLevelAction | ClearSearchResultsAction | OpenResultsInEditorAction> = [];
	private cancelAction: CancelSearchAction;
	private refreshAction: RefreshAction;
	private contextMenu: IMenu | null = null;

	private tree!: WorkbenchObjectTree<RenderableMatch>;
	private treeLabels!: ResourceLabels;
	private viewletState: MementoObject;
	private messagesElement!: HTMLElement;
	private messageDisposables: IDisposable[] = [];
	private searchWidgetsContainerElement!: HTMLElement;
	private searchWidget!: SearchWidget;
	private size!: dom.Dimension;
	private queryDetails!: HTMLElement;
	private toggleQueryDetailsButton!: HTMLElement;
	private inputPatternExcludes!: ExcludePatternInputWidget;
	private inputPatternIncludes!: PatternInputWidget;
	private resultsElement!: HTMLElement;

	private currentSelectedFileMatch: FileMatch | undefined;

	private delayedRefresh: Delayer<void>;
	private changedWhileHidden: boolean = false;

	private searchWithoutFolderMessageElement: HTMLElement | undefined;

	private currentSearchQ = Promise.resolve();
	private addToSearchHistoryDelayer: Delayer<void>;

	constructor(
		private position: SearchViewPosition,
		options: IViewletPaneOptions,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@IProgressService private readonly progressService: IProgressService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ISearchWorkbenchService private readonly searchWorkbenchService: ISearchWorkbenchService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IReplaceService private readonly replaceService: IReplaceService,
		@IUntitledTextEditorService private readonly untitledTextEditorService: IUntitledTextEditorService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IThemeService protected themeService: IThemeService,
		@ISearchHistoryService private readonly searchHistoryService: ISearchHistoryService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService,
		@ILabelService private readonly labelService: ILabelService,
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super({ ...options, id: VIEW_ID, ariaHeaderLabel: nls.localize('searchView', "Search") }, keybindingService, contextMenuService, configurationService, contextKeyService);

		this.viewletVisible = Constants.SearchViewVisibleKey.bindTo(contextKeyService);
		this.viewletFocused = Constants.SearchViewFocusedKey.bindTo(contextKeyService);
		this.inputBoxFocused = Constants.InputBoxFocusedKey.bindTo(this.contextKeyService);
		this.inputPatternIncludesFocused = Constants.PatternIncludesFocusedKey.bindTo(this.contextKeyService);
		this.inputPatternExclusionsFocused = Constants.PatternExcludesFocusedKey.bindTo(this.contextKeyService);
		this.firstMatchFocused = Constants.FirstMatchFocusKey.bindTo(contextKeyService);
		this.fileMatchOrMatchFocused = Constants.FileMatchOrMatchFocusKey.bindTo(contextKeyService);
		this.fileMatchOrFolderMatchFocus = Constants.FileMatchOrFolderMatchFocusKey.bindTo(contextKeyService);
		this.fileMatchOrFolderMatchWithResourceFocus = Constants.FileMatchOrFolderMatchWithResourceFocusKey.bindTo(contextKeyService);
		this.fileMatchFocused = Constants.FileFocusKey.bindTo(contextKeyService);
		this.folderMatchFocused = Constants.FolderFocusKey.bindTo(contextKeyService);
		this.matchFocused = Constants.MatchFocusKey.bindTo(this.contextKeyService);
		this.hasSearchResultsKey = Constants.HasSearchResults.bindTo(this.contextKeyService);
		this.enableSearchEditorPreview = Constants.EnableSearchEditorPreview.bindTo(this.contextKeyService);

		this.enableSearchEditorPreview.set(this.searchConfig.enableSearchEditorPreview);
		this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('search.previewSearchEditor')) {
				this.enableSearchEditorPreview.set(this.searchConfig.enableSearchEditorPreview);
			}
		});

		this.viewModel = this._register(this.searchWorkbenchService.searchModel);
		this.queryBuilder = this.instantiationService.createInstance(QueryBuilder);
		this.memento = new Memento(this.id, storageService);
		this.viewletState = this.memento.getMemento(StorageScope.WORKSPACE);

		this._register(this.fileService.onFileChanges(e => this.onFilesChanged(e)));
		this._register(this.untitledTextEditorService.onDidDisposeModel(e => this.onUntitledDidDispose(e)));
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.onDidChangeWorkbenchState()));
		this._register(this.searchHistoryService.onDidClearHistory(() => this.clearHistory()));

		this.delayedRefresh = this._register(new Delayer<void>(250));

		this.addToSearchHistoryDelayer = this._register(new Delayer<void>(500));

		this.actions = [
			this._register(this.instantiationService.createInstance(ClearSearchResultsAction, ClearSearchResultsAction.ID, ClearSearchResultsAction.LABEL)),
			this._register(this.instantiationService.createInstance(CollapseDeepestExpandedLevelAction, CollapseDeepestExpandedLevelAction.ID, CollapseDeepestExpandedLevelAction.LABEL))
		];

		if (this.searchConfig.enableSearchEditorPreview) {
			this.actions.push(
				this._register(this.instantiationService.createInstance(OpenResultsInEditorAction, OpenResultsInEditorAction.ID, OpenResultsInEditorAction.LABEL))
			);
		}

		this.refreshAction = this._register(this.instantiationService.createInstance(RefreshAction, RefreshAction.ID, RefreshAction.LABEL));
		this.cancelAction = this._register(this.instantiationService.createInstance(CancelSearchAction, CancelSearchAction.ID, CancelSearchAction.LABEL));
	}

	getContainer(): HTMLElement {
		return this.container;
	}

	get searchResult(): SearchResult {
		return this.viewModel && this.viewModel.searchResult;
	}

	private onDidChangeWorkbenchState(): void {
		if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.searchWithoutFolderMessageElement) {
			dom.hide(this.searchWithoutFolderMessageElement);
		}
	}

	renderBody(parent: HTMLElement): void {
		this.container = dom.append(parent, dom.$('.search-view'));

		this.searchWidgetsContainerElement = dom.append(this.container, $('.search-widgets-container'));
		this.createSearchWidget(this.searchWidgetsContainerElement);

		const history = this.searchHistoryService.load();
		const filePatterns = this.viewletState['query.filePatterns'] || '';
		const patternExclusions = this.viewletState['query.folderExclusions'] || '';
		const patternExclusionsHistory: string[] = history.exclude || [];
		const patternIncludes = this.viewletState['query.folderIncludes'] || '';
		const patternIncludesHistory: string[] = history.include || [];
		const queryDetailsExpanded = this.viewletState['query.queryDetailsExpanded'] || '';
		const useExcludesAndIgnoreFiles = typeof this.viewletState['query.useExcludesAndIgnoreFiles'] === 'boolean' ?
			this.viewletState['query.useExcludesAndIgnoreFiles'] : true;

		this.queryDetails = dom.append(this.searchWidgetsContainerElement, $('.query-details'));

		// Toggle query details button
		this.toggleQueryDetailsButton = dom.append(this.queryDetails,
			$('.more.codicon.codicon-ellipsis', { tabindex: 0, role: 'button', title: nls.localize('moreSearch', "Toggle Search Details") }));

		this._register(dom.addDisposableListener(this.toggleQueryDetailsButton, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e);
			this.toggleQueryDetails(!this.isScreenReaderOptimized());
		}));
		this._register(dom.addDisposableListener(this.toggleQueryDetailsButton, dom.EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);

			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				dom.EventHelper.stop(e);
				this.toggleQueryDetails(false);
			}
		}));
		this._register(dom.addDisposableListener(this.toggleQueryDetailsButton, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);

			if (event.equals(KeyMod.Shift | KeyCode.Tab)) {
				if (this.searchWidget.isReplaceActive()) {
					this.searchWidget.focusReplaceAllAction();
				} else {
					this.searchWidget.isReplaceShown() ? this.searchWidget.replaceInput.focusOnPreserve() : this.searchWidget.focusRegexAction();
				}
				dom.EventHelper.stop(e);
			}
		}));

		// folder includes list
		const folderIncludesList = dom.append(this.queryDetails,
			$('.file-types.includes'));
		const filesToIncludeTitle = nls.localize('searchScope.includes', "files to include");
		dom.append(folderIncludesList, $('h4', undefined, filesToIncludeTitle));

		this.inputPatternIncludes = this._register(this.instantiationService.createInstance(PatternInputWidget, folderIncludesList, this.contextViewService, {
			ariaLabel: nls.localize('label.includes', 'Search Include Patterns'),
			history: patternIncludesHistory,
		}));

		this.inputPatternIncludes.setValue(patternIncludes);

		this.inputPatternIncludes.onSubmit(triggeredOnType => this.onQueryChanged(true, triggeredOnType));
		this.inputPatternIncludes.onCancel(() => this.cancelSearch(false));
		this.trackInputBox(this.inputPatternIncludes.inputFocusTracker, this.inputPatternIncludesFocused);

		// excludes list
		const excludesList = dom.append(this.queryDetails, $('.file-types.excludes'));
		const excludesTitle = nls.localize('searchScope.excludes', "files to exclude");
		dom.append(excludesList, $('h4', undefined, excludesTitle));
		this.inputPatternExcludes = this._register(this.instantiationService.createInstance(ExcludePatternInputWidget, excludesList, this.contextViewService, {
			ariaLabel: nls.localize('label.excludes', 'Search Exclude Patterns'),
			history: patternExclusionsHistory,
		}));

		this.inputPatternExcludes.setValue(patternExclusions);
		this.inputPatternExcludes.setUseExcludesAndIgnoreFiles(useExcludesAndIgnoreFiles);

		this.inputPatternExcludes.onSubmit(triggeredOnType => this.onQueryChanged(true, triggeredOnType));
		this.inputPatternExcludes.onCancel(() => this.cancelSearch(false));
		this.inputPatternExcludes.onChangeIgnoreBox(() => this.onQueryChanged(true));
		this.trackInputBox(this.inputPatternExcludes.inputFocusTracker, this.inputPatternExclusionsFocused);

		this.messagesElement = dom.append(this.container, $('.messages'));
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.showSearchWithoutFolderMessage();
		}

		this.createSearchResultsView(this.container);

		if (filePatterns !== '' || patternExclusions !== '' || patternIncludes !== '' || queryDetailsExpanded !== '' || !useExcludesAndIgnoreFiles) {
			this.toggleQueryDetails(true, true, true);
		}

		this._register(this.viewModel.searchResult.onChange((event) => this.onSearchResultsChanged(event)));

		this._register(this.searchWidget.searchInput.onInput(() => this.updateActions()));
		this._register(this.searchWidget.replaceInput.onInput(() => this.updateActions()));

		this._register(this.onDidFocus(() => this.viewletFocused.set(true)));
		this._register(this.onDidBlur(() => this.viewletFocused.set(false)));

		this._register(this.onDidChangeBodyVisibility(visible => this.onVisibilityChanged(visible)));
	}

	private onVisibilityChanged(visible: boolean): void {
		this.viewletVisible.set(visible);
		if (visible) {
			if (this.changedWhileHidden) {
				// Render if results changed while viewlet was hidden - #37818
				this.refreshAndUpdateCount();
				this.changedWhileHidden = false;
			}
		}

		// Enable highlights if there are searchresults
		if (this.viewModel) {
			this.viewModel.searchResult.toggleHighlights(visible);
		}
	}

	get searchAndReplaceWidget(): SearchWidget {
		return this.searchWidget;
	}

	get searchIncludePattern(): PatternInputWidget {
		return this.inputPatternIncludes;
	}

	get searchExcludePattern(): PatternInputWidget {
		return this.inputPatternExcludes;
	}

	/**
	 * Warning: a bit expensive due to updating the view title
	 */
	protected updateActions(): void {
		for (const action of this.actions) {
			action.update();
		}

		this.refreshAction.update();
		this.cancelAction.update();

		super.updateActions();
	}

	private isScreenReaderOptimized() {
		const detected = this.accessibilityService.getAccessibilitySupport() === AccessibilitySupport.Enabled;
		const config = this.configurationService.getValue<IEditorOptions>('editor').accessibilitySupport;
		return config === 'on' || (config === 'auto' && detected);
	}

	private createSearchWidget(container: HTMLElement): void {
		const contentPattern = this.viewletState['query.contentPattern'] || '';
		const replaceText = this.viewletState['query.replaceText'] || '';
		const isRegex = this.viewletState['query.regex'] === true;
		const isWholeWords = this.viewletState['query.wholeWords'] === true;
		const isCaseSensitive = this.viewletState['query.caseSensitive'] === true;
		const history = this.searchHistoryService.load();
		const searchHistory = history.search || this.viewletState['query.searchHistory'] || [];
		const replaceHistory = history.replace || this.viewletState['query.replaceHistory'] || [];
		const showReplace = typeof this.viewletState['view.showReplace'] === 'boolean' ? this.viewletState['view.showReplace'] : true;
		const preserveCase = this.viewletState['query.preserveCase'] === true;

		this.searchWidget = this._register(this.instantiationService.createInstance(SearchWidget, container, <ISearchWidgetOptions>{
			value: contentPattern,
			replaceValue: replaceText,
			isRegex: isRegex,
			isCaseSensitive: isCaseSensitive,
			isWholeWords: isWholeWords,
			searchHistory: searchHistory,
			replaceHistory: replaceHistory,
			preserveCase: preserveCase
		}));

		if (showReplace) {
			this.searchWidget.toggleReplace(true);
		}

		this._register(this.searchWidget.onSearchSubmit(triggeredOnType => this.onQueryChanged(false, triggeredOnType)));
		this._register(this.searchWidget.onSearchCancel(({ focus }) => this.cancelSearch(focus)));
		this._register(this.searchWidget.searchInput.onDidOptionChange(() => this.onQueryChanged(true)));

		this._register(this.searchWidget.onDidHeightChange(() => this.reLayout()));

		this._register(this.searchWidget.onReplaceToggled(() => this.reLayout()));
		this._register(this.searchWidget.onReplaceStateChange((state) => {
			this.viewModel.replaceActive = state;
			this.refreshTree();
		}));

		this._register(this.searchWidget.onPreserveCaseChange((state) => {
			this.viewModel.preserveCase = state;
			this.refreshTree();
		}));

		this._register(this.searchWidget.onReplaceValueChanged((value) => {
			this.viewModel.replaceString = this.searchWidget.getReplaceValue();
			this.delayedRefresh.trigger(() => this.refreshTree());
		}));

		this._register(this.searchWidget.onBlur(() => {
			this.toggleQueryDetailsButton.focus();
		}));

		this._register(this.searchWidget.onReplaceAll(() => this.replaceAll()));

		this.trackInputBox(this.searchWidget.searchInputFocusTracker);
		this.trackInputBox(this.searchWidget.replaceInputFocusTracker);
	}

	private trackInputBox(inputFocusTracker: dom.IFocusTracker, contextKey?: IContextKey<boolean>): void {
		this._register(inputFocusTracker.onDidFocus(() => {
			this.inputBoxFocused.set(true);
			if (contextKey) {
				contextKey.set(true);
			}
		}));
		this._register(inputFocusTracker.onDidBlur(() => {
			this.inputBoxFocused.set(this.searchWidget.searchInputHasFocus()
				|| this.searchWidget.replaceInputHasFocus()
				|| this.inputPatternIncludes.inputHasFocus()
				|| this.inputPatternExcludes.inputHasFocus());
			if (contextKey) {
				contextKey.set(false);
			}
		}));
	}

	private onSearchResultsChanged(event?: IChangeEvent): void {
		if (this.isVisible()) {
			return this.refreshAndUpdateCount(event);
		} else {
			this.changedWhileHidden = true;
		}
	}

	private refreshAndUpdateCount(event?: IChangeEvent): void {
		this.searchWidget.setReplaceAllActionState(!this.viewModel.searchResult.isEmpty());
		this.updateSearchResultCount(this.viewModel.searchResult.query!.userDisabledExcludesAndIgnoreFiles);
		return this.refreshTree(event);
	}

	refreshTree(event?: IChangeEvent): void {
		const collapseResults = this.searchConfig.collapseResults;
		if (!event || event.added || event.removed) {
			// Refresh whole tree
			this.tree.setChildren(null, this.createResultIterator(collapseResults));
		} else {
			// FileMatch modified, refresh those elements
			event.elements.forEach(element => {
				this.tree.setChildren(element, this.createIterator(element, collapseResults));
				this.tree.rerender(element);
			});
		}
	}

	private createResultIterator(collapseResults: ISearchConfigurationProperties['collapseResults']): Iterator<ITreeElement<RenderableMatch>> {
		const folderMatches = this.searchResult.folderMatches()
			.filter(fm => !fm.isEmpty())
			.sort(searchMatchComparer);

		if (folderMatches.length === 1) {
			return this.createFolderIterator(folderMatches[0], collapseResults);
		}

		const foldersIt = Iterator.fromArray(folderMatches);
		return Iterator.map(foldersIt, folderMatch => {
			const children = this.createFolderIterator(folderMatch, collapseResults);
			return <ITreeElement<RenderableMatch>>{ element: folderMatch, children };
		});
	}

	private createFolderIterator(folderMatch: FolderMatch, collapseResults: ISearchConfigurationProperties['collapseResults']): Iterator<ITreeElement<RenderableMatch>> {
		const filesIt = Iterator.fromArray(
			folderMatch.matches()
				.sort(searchMatchComparer));

		return Iterator.map(filesIt, fileMatch => {
			const children = this.createFileIterator(fileMatch);

			let nodeExists = true;
			try { this.tree.getNode(fileMatch); } catch (e) { nodeExists = false; }

			const collapsed = nodeExists ? undefined :
				(collapseResults === 'alwaysCollapse' || (fileMatch.matches().length > 10 && collapseResults !== 'alwaysExpand'));

			return <ITreeElement<RenderableMatch>>{ element: fileMatch, children, collapsed };
		});
	}

	private createFileIterator(fileMatch: FileMatch): Iterator<ITreeElement<RenderableMatch>> {
		const matchesIt = Iterator.from(
			fileMatch.matches()
				.sort(searchMatchComparer));
		return Iterator.map(matchesIt, r => (<ITreeElement<RenderableMatch>>{ element: r }));
	}

	private createIterator(match: FolderMatch | FileMatch | SearchResult, collapseResults: ISearchConfigurationProperties['collapseResults']): Iterator<ITreeElement<RenderableMatch>> {
		return match instanceof SearchResult ? this.createResultIterator(collapseResults) :
			match instanceof FolderMatch ? this.createFolderIterator(match, collapseResults) :
				this.createFileIterator(match);
	}

	private replaceAll(): void {
		if (this.viewModel.searchResult.count() === 0) {
			return;
		}

		const occurrences = this.viewModel.searchResult.count();
		const fileCount = this.viewModel.searchResult.fileCount();
		const replaceValue = this.searchWidget.getReplaceValue() || '';
		const afterReplaceAllMessage = this.buildAfterReplaceAllMessage(occurrences, fileCount, replaceValue);

		let progressComplete: () => void;
		let progressReporter: IProgress<IProgressStep>;
		this.progressService.withProgress({ location: VIEWLET_ID, delay: 100, total: occurrences }, p => {
			progressReporter = p;

			return new Promise(resolve => progressComplete = resolve);
		});

		const confirmation: IConfirmation = {
			title: nls.localize('replaceAll.confirmation.title', "Replace All"),
			message: this.buildReplaceAllConfirmationMessage(occurrences, fileCount, replaceValue),
			primaryButton: nls.localize('replaceAll.confirm.button', "&&Replace"),
			type: 'question'
		};

		this.dialogService.confirm(confirmation).then(res => {
			if (res.confirmed) {
				this.searchWidget.setReplaceAllActionState(false);
				this.viewModel.searchResult.replaceAll(progressReporter).then(() => {
					progressComplete();
					const messageEl = this.clearMessage();
					dom.append(messageEl, $('p', undefined, afterReplaceAllMessage));
					this.reLayout();
				}, (error) => {
					progressComplete();
					errors.isPromiseCanceledError(error);
					this.notificationService.error(error);
				});
			}
		});
	}

	private buildAfterReplaceAllMessage(occurrences: number, fileCount: number, replaceValue?: string) {
		if (occurrences === 1) {
			if (fileCount === 1) {
				if (replaceValue) {
					return nls.localize('replaceAll.occurrence.file.message', "Replaced {0} occurrence across {1} file with '{2}'.", occurrences, fileCount, replaceValue);
				}

				return nls.localize('removeAll.occurrence.file.message', "Replaced {0} occurrence across {1} file.", occurrences, fileCount);
			}

			if (replaceValue) {
				return nls.localize('replaceAll.occurrence.files.message', "Replaced {0} occurrence across {1} files with '{2}'.", occurrences, fileCount, replaceValue);
			}

			return nls.localize('removeAll.occurrence.files.message', "Replaced {0} occurrence across {1} files.", occurrences, fileCount);
		}

		if (fileCount === 1) {
			if (replaceValue) {
				return nls.localize('replaceAll.occurrences.file.message', "Replaced {0} occurrences across {1} file with '{2}'.", occurrences, fileCount, replaceValue);
			}

			return nls.localize('removeAll.occurrences.file.message', "Replaced {0} occurrences across {1} file.", occurrences, fileCount);
		}

		if (replaceValue) {
			return nls.localize('replaceAll.occurrences.files.message', "Replaced {0} occurrences across {1} files with '{2}'.", occurrences, fileCount, replaceValue);
		}

		return nls.localize('removeAll.occurrences.files.message', "Replaced {0} occurrences across {1} files.", occurrences, fileCount);
	}

	private buildReplaceAllConfirmationMessage(occurrences: number, fileCount: number, replaceValue?: string) {
		if (occurrences === 1) {
			if (fileCount === 1) {
				if (replaceValue) {
					return nls.localize('removeAll.occurrence.file.confirmation.message', "Replace {0} occurrence across {1} file with '{2}'?", occurrences, fileCount, replaceValue);
				}

				return nls.localize('replaceAll.occurrence.file.confirmation.message', "Replace {0} occurrence across {1} file?", occurrences, fileCount);
			}

			if (replaceValue) {
				return nls.localize('removeAll.occurrence.files.confirmation.message', "Replace {0} occurrence across {1} files with '{2}'?", occurrences, fileCount, replaceValue);
			}

			return nls.localize('replaceAll.occurrence.files.confirmation.message', "Replace {0} occurrence across {1} files?", occurrences, fileCount);
		}

		if (fileCount === 1) {
			if (replaceValue) {
				return nls.localize('removeAll.occurrences.file.confirmation.message', "Replace {0} occurrences across {1} file with '{2}'?", occurrences, fileCount, replaceValue);
			}

			return nls.localize('replaceAll.occurrences.file.confirmation.message', "Replace {0} occurrences across {1} file?", occurrences, fileCount);
		}

		if (replaceValue) {
			return nls.localize('removeAll.occurrences.files.confirmation.message', "Replace {0} occurrences across {1} files with '{2}'?", occurrences, fileCount, replaceValue);
		}

		return nls.localize('replaceAll.occurrences.files.confirmation.message', "Replace {0} occurrences across {1} files?", occurrences, fileCount);
	}

	private clearMessage(): HTMLElement {
		this.searchWithoutFolderMessageElement = undefined;

		dom.clearNode(this.messagesElement);
		dom.show(this.messagesElement);
		dispose(this.messageDisposables);
		this.messageDisposables = [];

		return dom.append(this.messagesElement, $('.message'));
	}

	private createSearchResultsView(container: HTMLElement): void {
		this.resultsElement = dom.append(container, $('.results.show-file-icons'));
		const delegate = this.instantiationService.createInstance(SearchDelegate);

		const identityProvider: IIdentityProvider<RenderableMatch> = {
			getId(element: RenderableMatch) {
				return element.id();
			}
		};

		this.treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility }));
		this.tree = this._register(this.instantiationService.createInstance(WorkbenchObjectTree,
			'SearchView',
			this.resultsElement,
			delegate,
			[
				this._register(this.instantiationService.createInstance(FolderMatchRenderer, this.viewModel, this, this.treeLabels)),
				this._register(this.instantiationService.createInstance(FileMatchRenderer, this.viewModel, this, this.treeLabels)),
				this._register(this.instantiationService.createInstance(MatchRenderer, this.viewModel, this)),
			],
			{
				identityProvider,
				accessibilityProvider: this.instantiationService.createInstance(SearchAccessibilityProvider, this.viewModel),
				dnd: this.instantiationService.createInstance(SearchDND),
				multipleSelectionSupport: false,
				overrideStyles: {
					listBackground: this.position === SearchViewPosition.SideBar ? SIDE_BAR_BACKGROUND : PANEL_BACKGROUND
				}
			}));
		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		const resourceNavigator = this._register(new TreeResourceNavigator2(this.tree, { openOnFocus: true, openOnSelection: false }));
		this._register(Event.debounce(resourceNavigator.onDidOpenResource, (last, event) => event, 75, true)(options => {
			if (options.element instanceof Match) {
				const selectedMatch: Match = options.element;
				if (this.currentSelectedFileMatch) {
					this.currentSelectedFileMatch.setSelectedMatch(null);
				}
				this.currentSelectedFileMatch = selectedMatch.parent();
				this.currentSelectedFileMatch.setSelectedMatch(selectedMatch);

				this.onFocus(selectedMatch, options.editorOptions.preserveFocus, options.sideBySide, options.editorOptions.pinned);
			}
		}));

		this._register(Event.any<any>(this.tree.onDidFocus, this.tree.onDidChangeFocus)(() => {
			if (this.tree.isDOMFocused()) {
				const focus = this.tree.getFocus()[0];
				this.firstMatchFocused.set(this.tree.navigate().first() === focus);
				this.fileMatchOrMatchFocused.set(!!focus);
				this.fileMatchFocused.set(focus instanceof FileMatch);
				this.folderMatchFocused.set(focus instanceof FolderMatch);
				this.matchFocused.set(focus instanceof Match);
				this.fileMatchOrFolderMatchFocus.set(focus instanceof FileMatch || focus instanceof FolderMatch);
				this.fileMatchOrFolderMatchWithResourceFocus.set(focus instanceof FileMatch || focus instanceof FolderMatchWithResource);
			}
		}));

		this._register(this.tree.onDidBlur(e => {
			this.firstMatchFocused.reset();
			this.fileMatchOrMatchFocused.reset();
			this.fileMatchFocused.reset();
			this.folderMatchFocused.reset();
			this.matchFocused.reset();
			this.fileMatchOrFolderMatchFocus.reset();
			this.fileMatchOrFolderMatchWithResourceFocus.reset();
		}));
	}

	private onContextMenu(e: ITreeContextMenuEvent<RenderableMatch | null>): void {
		if (!this.contextMenu) {
			this.contextMenu = this._register(this.menuService.createMenu(MenuId.SearchContext, this.contextKeyService));
		}

		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		const actions: IAction[] = [];
		const actionsDisposable = createAndFillInContextMenuActions(this.contextMenu, { shouldForwardArgs: true }, actions, this.contextMenuService);

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => e.element,
			onHide: () => dispose(actionsDisposable)
		});
	}

	selectNextMatch(): void {
		const [selected] = this.tree.getSelection();

		// Expand the initial selected node, if needed
		if (selected && !(selected instanceof Match)) {
			if (this.tree.isCollapsed(selected)) {
				this.tree.expand(selected);
			}
		}

		let navigator = this.tree.navigate(selected);

		let next = navigator.next();
		if (!next) {
			next = navigator.first();
		}

		// Expand until first child is a Match
		while (!(next instanceof Match)) {
			if (this.tree.isCollapsed(next)) {
				this.tree.expand(next);
			}

			// Select the first child
			next = navigator.next();
		}

		// Reveal the newly selected element
		if (next) {
			if (next === selected) {
				this.tree.setFocus([]);
			}
			this.tree.setFocus([next], getSelectionKeyboardEvent(undefined, false));
			this.tree.reveal(next);
		}
	}

	selectPreviousMatch(): void {
		const [selected] = this.tree.getSelection();
		let navigator = this.tree.navigate(selected);

		let prev = navigator.previous();

		// Select previous until find a Match or a collapsed item
		while (!prev || (!(prev instanceof Match) && !this.tree.isCollapsed(prev))) {
			prev = prev ? navigator.previous() : navigator.last();
		}

		// Expand until last child is a Match
		while (!(prev instanceof Match)) {
			const nextItem = navigator.next();
			this.tree.expand(prev);
			navigator = this.tree.navigate(nextItem); // recreate navigator because modifying the tree can invalidate it
			prev = nextItem ? navigator.previous() : navigator.last(); // select last child
		}

		// Reveal the newly selected element
		if (prev) {
			if (prev === selected) {
				this.tree.setFocus([]);
			}
			this.tree.setFocus([prev], getSelectionKeyboardEvent(undefined, false));
			this.tree.reveal(prev);
		}
	}

	moveFocusToResults(): void {
		this.tree.domFocus();
	}

	focus(): void {
		super.focus();

		const updatedText = this.updateTextFromSelection();
		this.searchWidget.focus(undefined, undefined, updatedText);
	}

	updateTextFromSelection(allowUnselectedWord = true): boolean {
		let updatedText = false;
		const seedSearchStringFromSelection = this.configurationService.getValue<IEditorOptions>('editor').find!.seedSearchStringFromSelection;
		if (seedSearchStringFromSelection) {
			let selectedText = this.getSearchTextFromEditor(allowUnselectedWord);
			if (selectedText) {
				if (this.searchWidget.searchInput.getRegex()) {
					selectedText = strings.escapeRegExpCharacters(selectedText);
				}
				this.searchWidget.setValue(selectedText, true);
				updatedText = true;
				this.onQueryChanged(false);
			}
		}

		return updatedText;
	}

	focusNextInputBox(): void {
		if (this.searchWidget.searchInputHasFocus()) {
			if (this.searchWidget.isReplaceShown()) {
				this.searchWidget.focus(true, true);
			} else {
				this.moveFocusFromSearchOrReplace();
			}
			return;
		}

		if (this.searchWidget.replaceInputHasFocus()) {
			this.moveFocusFromSearchOrReplace();
			return;
		}

		if (this.inputPatternIncludes.inputHasFocus()) {
			this.inputPatternExcludes.focus();
			this.inputPatternExcludes.select();
			return;
		}

		if (this.inputPatternExcludes.inputHasFocus()) {
			this.selectTreeIfNotSelected();
			return;
		}
	}

	private moveFocusFromSearchOrReplace() {
		if (this.showsFileTypes()) {
			this.toggleQueryDetails(true, this.showsFileTypes());
		} else {
			this.selectTreeIfNotSelected();
		}
	}

	focusPreviousInputBox(): void {
		if (this.searchWidget.searchInputHasFocus()) {
			return;
		}

		if (this.searchWidget.replaceInputHasFocus()) {
			this.searchWidget.focus(true);
			return;
		}

		if (this.inputPatternIncludes.inputHasFocus()) {
			this.searchWidget.focus(true, true);
			return;
		}

		if (this.inputPatternExcludes.inputHasFocus()) {
			this.inputPatternIncludes.focus();
			this.inputPatternIncludes.select();
			return;
		}

		if (this.tree.isDOMFocused()) {
			this.moveFocusFromResults();
			return;
		}
	}

	private moveFocusFromResults(): void {
		if (this.showsFileTypes()) {
			this.toggleQueryDetails(true, true, false, true);
		} else {
			this.searchWidget.focus(true, true);
		}
	}

	private reLayout(): void {
		if (this.isDisposed) {
			return;
		}

		const actionsPosition = this.searchConfig.actionsPosition;
		dom.toggleClass(this.getContainer(), SearchView.ACTIONS_RIGHT_CLASS_NAME, actionsPosition === 'right');
		dom.toggleClass(this.getContainer(), SearchView.WIDE_CLASS_NAME, this.size.width >= SearchView.WIDE_VIEW_SIZE);

		this.searchWidget.setWidth(this.size.width - 28 /* container margin */);

		this.inputPatternExcludes.setWidth(this.size.width - 28 /* container margin */);
		this.inputPatternIncludes.setWidth(this.size.width - 28 /* container margin */);

		const messagesSize = this.messagesElement.style.display === 'none' ?
			0 :
			dom.getTotalHeight(this.messagesElement);

		const searchResultContainerHeight = this.size.height -
			messagesSize -
			dom.getTotalHeight(this.searchWidgetsContainerElement);

		this.resultsElement.style.height = searchResultContainerHeight + 'px';

		this.tree.layout(searchResultContainerHeight, this.size.width);
	}

	protected layoutBody(height: number, width: number): void {
		this.size = new dom.Dimension(width, height);
		this.reLayout();
	}

	getControl() {
		return this.tree;
	}

	isSlowSearch(): boolean {
		return this.state === SearchUIState.SlowSearch;
	}

	allSearchFieldsClear(): boolean {
		return this.searchWidget.getReplaceValue() === '' &&
			this.searchWidget.searchInput.getValue() === '';
	}

	hasSearchResults(): boolean {
		return !this.viewModel.searchResult.isEmpty();
	}

	hasSearchPattern(): boolean {
		return this.searchWidget && this.searchWidget.searchInput.getValue().length > 0;
	}

	clearSearchResults(): void {
		this.viewModel.searchResult.clear();
		this.showEmptyStage(true);
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.showSearchWithoutFolderMessage();
		}
		this.searchWidget.clear();
		this.viewModel.cancelSearch();
		this.updateActions();

		aria.status(nls.localize('ariaSearchResultsClearStatus', "The search results have been cleared"));
	}

	cancelSearch(focus: boolean = true): boolean {
		if (this.viewModel.cancelSearch()) {
			if (focus) { this.searchWidget.focus(); }
			return true;
		}
		return false;
	}

	private selectTreeIfNotSelected(): void {
		if (this.tree.getNode(null)) {
			this.tree.domFocus();
			const selection = this.tree.getSelection();
			if (selection.length === 0) {
				this.tree.focusNext();
			}
		}
	}

	private getSearchTextFromEditor(allowUnselectedWord: boolean): string | null {
		if (!this.editorService.activeEditor) {
			return null;
		}

		if (dom.isAncestor(document.activeElement, this.getContainer())) {
			return null;
		}

		let activeTextEditorWidget = this.editorService.activeTextEditorWidget;
		if (isDiffEditor(activeTextEditorWidget)) {
			if (activeTextEditorWidget.getOriginalEditor().hasTextFocus()) {
				activeTextEditorWidget = activeTextEditorWidget.getOriginalEditor();
			} else {
				activeTextEditorWidget = activeTextEditorWidget.getModifiedEditor();
			}
		}

		if (!isCodeEditor(activeTextEditorWidget) || !activeTextEditorWidget.hasModel()) {
			return null;
		}

		const range = activeTextEditorWidget.getSelection();
		if (!range) {
			return null;
		}

		if (range.isEmpty() && !this.searchWidget.searchInput.getValue() && allowUnselectedWord) {
			const wordAtPosition = activeTextEditorWidget.getModel().getWordAtPosition(range.getStartPosition());
			if (wordAtPosition) {
				return wordAtPosition.word;
			}
		}

		if (!range.isEmpty()) {
			let searchText = '';
			for (let i = range.startLineNumber; i <= range.endLineNumber; i++) {
				let lineText = activeTextEditorWidget.getModel().getLineContent(i);
				if (i === range.endLineNumber) {
					lineText = lineText.substring(0, range.endColumn - 1);
				}

				if (i === range.startLineNumber) {
					lineText = lineText.substring(range.startColumn - 1);
				}

				if (i !== range.startLineNumber) {
					lineText = '\n' + lineText;
				}

				searchText += lineText;
			}

			return searchText;
		}

		return null;
	}

	private showsFileTypes(): boolean {
		return dom.hasClass(this.queryDetails, 'more');
	}

	toggleCaseSensitive(): void {
		this.searchWidget.searchInput.setCaseSensitive(!this.searchWidget.searchInput.getCaseSensitive());
		this.onQueryChanged(true);
	}

	toggleWholeWords(): void {
		this.searchWidget.searchInput.setWholeWords(!this.searchWidget.searchInput.getWholeWords());
		this.onQueryChanged(true);
	}

	toggleRegex(): void {
		this.searchWidget.searchInput.setRegex(!this.searchWidget.searchInput.getRegex());
		this.onQueryChanged(true);
	}

	setSearchParameters(args: IFindInFilesArgs = {}): void {
		if (typeof args.isCaseSensitive === 'boolean') {
			this.searchWidget.searchInput.setCaseSensitive(args.isCaseSensitive);
		}
		if (typeof args.matchWholeWord === 'boolean') {
			this.searchWidget.searchInput.setWholeWords(args.matchWholeWord);
		}
		if (typeof args.isRegex === 'boolean') {
			this.searchWidget.searchInput.setRegex(args.isRegex);
		}
		if (typeof args.filesToInclude === 'string') {
			this.searchIncludePattern.setValue(String(args.filesToInclude));
		}
		if (typeof args.filesToExclude === 'string') {
			this.searchExcludePattern.setValue(String(args.filesToExclude));
		}
		if (typeof args.query === 'string') {
			this.searchWidget.searchInput.setValue(args.query);
		}
		if (typeof args.replace === 'string') {
			this.searchWidget.replaceInput.setValue(args.replace);
		} else {
			if (this.searchWidget.replaceInput.getValue() !== '') {
				this.searchWidget.replaceInput.setValue('');
			}
		}
		if (typeof args.triggerSearch === 'boolean' && args.triggerSearch) {
			this.onQueryChanged(true);
		}
	}

	toggleQueryDetails(moveFocus = true, show?: boolean, skipLayout?: boolean, reverse?: boolean): void {
		const cls = 'more';
		show = typeof show === 'undefined' ? !dom.hasClass(this.queryDetails, cls) : Boolean(show);
		this.viewletState['query.queryDetailsExpanded'] = show;
		skipLayout = Boolean(skipLayout);

		if (show) {
			this.toggleQueryDetailsButton.setAttribute('aria-expanded', 'true');
			dom.addClass(this.queryDetails, cls);
			if (moveFocus) {
				if (reverse) {
					this.inputPatternExcludes.focus();
					this.inputPatternExcludes.select();
				} else {
					this.inputPatternIncludes.focus();
					this.inputPatternIncludes.select();
				}
			}
		} else {
			this.toggleQueryDetailsButton.setAttribute('aria-expanded', 'false');
			dom.removeClass(this.queryDetails, cls);
			if (moveFocus) {
				this.searchWidget.focus();
			}
		}

		if (!skipLayout && this.size) {
			this.layout(this.size.height);
		}
	}

	searchInFolders(resources?: URI[]): void {
		const folderPaths: string[] = [];
		const workspace = this.contextService.getWorkspace();

		if (resources) {
			resources.forEach(resource => {
				let folderPath: string | undefined;
				if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
					// Show relative path from the root for single-root mode
					folderPath = relativePath(workspace.folders[0].uri, resource); // always uses forward slashes
					if (folderPath && folderPath !== '.') {
						folderPath = './' + folderPath;
					}
				} else {
					const owningFolder = this.contextService.getWorkspaceFolder(resource);
					if (owningFolder) {
						const owningRootName = owningFolder.name;

						// If this root is the only one with its basename, use a relative ./ path. If there is another, use an absolute path
						const isUniqueFolder = workspace.folders.filter(folder => folder.name === owningRootName).length === 1;
						if (isUniqueFolder) {
							const relPath = relativePath(owningFolder.uri, resource); // always uses forward slashes
							if (relPath === '') {
								folderPath = `./${owningFolder.name}`;
							} else {
								folderPath = `./${owningFolder.name}/${relPath}`;
							}
						} else {
							folderPath = resource.fsPath; // TODO rob: handle on-file URIs
						}
					}
				}

				if (folderPath) {
					folderPaths.push(folderPath);
				}
			});
		}

		if (!folderPaths.length || folderPaths.some(folderPath => folderPath === '.')) {
			this.inputPatternIncludes.setValue('');
			this.searchWidget.focus();
			return;
		}

		// Show 'files to include' box
		if (!this.showsFileTypes()) {
			this.toggleQueryDetails(true, true);
		}

		this.inputPatternIncludes.setValue(folderPaths.join(', '));
		this.searchWidget.focus(false);
	}

	onQueryChanged(preserveFocus: boolean, triggeredOnType = false): void {
		if (!this.searchWidget.searchInput.inputBox.isInputValid()) {
			return;
		}

		const isRegex = this.searchWidget.searchInput.getRegex();
		const isWholeWords = this.searchWidget.searchInput.getWholeWords();
		const isCaseSensitive = this.searchWidget.searchInput.getCaseSensitive();
		const contentPattern = this.searchWidget.searchInput.getValue();
		const excludePatternText = this.inputPatternExcludes.getValue().trim();
		const includePatternText = this.inputPatternIncludes.getValue().trim();
		const useExcludesAndIgnoreFiles = this.inputPatternExcludes.useExcludesAndIgnoreFiles();

		if (contentPattern.length === 0) {
			this.clearSearchResults();
			this.clearMessage();
			return;
		}

		const content: IPatternInfo = {
			pattern: contentPattern,
			isRegExp: isRegex,
			isCaseSensitive: isCaseSensitive,
			isWordMatch: isWholeWords
		};

		const excludePattern = this.inputPatternExcludes.getValue();
		const includePattern = this.inputPatternIncludes.getValue();

		// Need the full match line to correctly calculate replace text, if this is a search/replace with regex group references ($1, $2, ...).
		// 10000 chars is enough to avoid sending huge amounts of text around, if you do a replace with a longer match, it may or may not resolve the group refs correctly.
		// https://github.com/Microsoft/vscode/issues/58374
		const charsPerLine = content.isRegExp ? 10000 : 1000;

		const options: ITextQueryBuilderOptions = {
			_reason: 'searchView',
			extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			maxResults: SearchView.MAX_TEXT_RESULTS,
			disregardIgnoreFiles: !useExcludesAndIgnoreFiles || undefined,
			disregardExcludeSettings: !useExcludesAndIgnoreFiles || undefined,
			excludePattern,
			includePattern,
			previewOptions: {
				matchLines: 1,
				charsPerLine
			},
			isSmartCase: this.searchConfig.smartCase,
			expandPatterns: true
		};
		const folderResources = this.contextService.getWorkspace().folders;

		const onQueryValidationError = (err: Error) => {
			this.searchWidget.searchInput.showMessage({ content: err.message, type: MessageType.ERROR });
			this.viewModel.searchResult.clear();
		};

		this.queryBuilder.text(content, folderResources.map(folder => folder.uri), options)
			.then(query => {
				this.validateQuery(query).then(() => {
					this.onQueryTriggered(query, options, excludePatternText, includePatternText, triggeredOnType);

					if (!preserveFocus) {
						this.searchWidget.focus(false); // focus back to input field
					}
				}, onQueryValidationError);
			})
			.catch(err => {
				onQueryValidationError(err);
				return;
			});
	}

	private validateQuery(query: ITextQuery): Promise<void> {
		// Validate folderQueries
		const folderQueriesExistP =
			query.folderQueries.map(fq => {
				return this.fileService.exists(fq.folder);
			});

		return Promise.all(folderQueriesExistP).then(existResults => {
			// If no folders exist, show an error message about the first one
			const existingFolderQueries = query.folderQueries.filter((folderQuery, i) => existResults[i]);
			if (!query.folderQueries.length || existingFolderQueries.length) {
				query.folderQueries = existingFolderQueries;
			} else {
				const nonExistantPath = query.folderQueries[0].folder.fsPath;
				const searchPathNotFoundError = nls.localize('searchPathNotFoundError', "Search path not found: {0}", nonExistantPath);
				return Promise.reject(new Error(searchPathNotFoundError));
			}

			return undefined;
		});
	}

	private onQueryTriggered(query: ITextQuery, options: ITextQueryBuilderOptions, excludePatternText: string, includePatternText: string, triggeredOnType: boolean): void {
		this.addToSearchHistoryDelayer.trigger(() => this.searchWidget.searchInput.onSearchSubmit());
		this.inputPatternExcludes.onSearchSubmit();
		this.inputPatternIncludes.onSearchSubmit();

		this.viewModel.cancelSearch();

		this.currentSearchQ = this.currentSearchQ
			.then(() => this.doSearch(query, options, excludePatternText, includePatternText, triggeredOnType))
			.then(() => undefined, () => undefined);
	}

	private doSearch(query: ITextQuery, options: ITextQueryBuilderOptions, excludePatternText: string, includePatternText: string, triggeredOnType: boolean): Thenable<void> {
		let progressComplete: () => void;
		this.progressService.withProgress({ location: VIEWLET_ID, delay: triggeredOnType ? 300 : 0 }, _progress => {
			return new Promise(resolve => progressComplete = resolve);
		});

		this.searchWidget.searchInput.clearMessage();
		this.state = SearchUIState.Searching;
		this.showEmptyStage();

		const slowTimer = setTimeout(() => {
			this.state = SearchUIState.SlowSearch;
			this.updateActions();
		}, 2000);

		const onComplete = (completed?: ISearchComplete) => {
			clearTimeout(slowTimer);
			this.state = SearchUIState.Idle;

			// Complete up to 100% as needed
			progressComplete();

			// Do final render, then expand if just 1 file with less than 50 matches
			this.onSearchResultsChanged();

			const collapseResults = this.searchConfig.collapseResults;
			if (collapseResults !== 'alwaysCollapse' && this.viewModel.searchResult.matches().length === 1) {
				const onlyMatch = this.viewModel.searchResult.matches()[0];
				if (onlyMatch.count() < 50) {
					this.tree.expand(onlyMatch);
				}
			}

			this.viewModel.replaceString = this.searchWidget.getReplaceValue();

			this.updateActions();
			const hasResults = !this.viewModel.searchResult.isEmpty();

			if (completed && completed.limitHit) {
				this.searchWidget.searchInput.showMessage({
					content: nls.localize('searchMaxResultsWarning', "The result set only contains a subset of all matches. Please be more specific in your search to narrow down the results."),
					type: MessageType.WARNING
				});
			}

			if (!hasResults) {
				const hasExcludes = !!excludePatternText;
				const hasIncludes = !!includePatternText;
				let message: string;

				if (!completed) {
					message = SEARCH_CANCELLED_MESSAGE;
				} else if (hasIncludes && hasExcludes) {
					message = nls.localize('noResultsIncludesExcludes', "No results found in '{0}' excluding '{1}' - ", includePatternText, excludePatternText);
				} else if (hasIncludes) {
					message = nls.localize('noResultsIncludes', "No results found in '{0}' - ", includePatternText);
				} else if (hasExcludes) {
					message = nls.localize('noResultsExcludes', "No results found excluding '{0}' - ", excludePatternText);
				} else {
					message = nls.localize('noResultsFound', "No results found. Review your settings for configured exclusions and check your gitignore files - ");
				}

				// Indicate as status to ARIA
				aria.status(message);

				const messageEl = this.clearMessage();
				const p = dom.append(messageEl, $('p', undefined, message));

				if (!completed) {
					const searchAgainLink = dom.append(p, $('a.pointer.prominent', undefined, nls.localize('rerunSearch.message', "Search again")));
					this.messageDisposables.push(dom.addDisposableListener(searchAgainLink, dom.EventType.CLICK, (e: MouseEvent) => {
						dom.EventHelper.stop(e, false);
						this.onQueryChanged(false);
					}));
				} else if (hasIncludes || hasExcludes) {
					const searchAgainLink = dom.append(p, $('a.pointer.prominent', { tabindex: 0 }, nls.localize('rerunSearchInAll.message', "Search again in all files")));
					this.messageDisposables.push(dom.addDisposableListener(searchAgainLink, dom.EventType.CLICK, (e: MouseEvent) => {
						dom.EventHelper.stop(e, false);

						this.inputPatternExcludes.setValue('');
						this.inputPatternIncludes.setValue('');

						this.onQueryChanged(false);
					}));
				} else {
					const openSettingsLink = dom.append(p, $('a.pointer.prominent', { tabindex: 0 }, nls.localize('openSettings.message', "Open Settings")));
					this.addClickEvents(openSettingsLink, this.onOpenSettings);
				}

				if (completed) {
					dom.append(p, $('span', undefined, ' - '));

					const learnMoreLink = dom.append(p, $('a.pointer.prominent', { tabindex: 0 }, nls.localize('openSettings.learnMore', "Learn More")));
					this.addClickEvents(learnMoreLink, this.onLearnMore);
				}

				if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
					this.showSearchWithoutFolderMessage();
				}
				this.reLayout();
			} else {
				this.viewModel.searchResult.toggleHighlights(this.isVisible()); // show highlights

				// Indicate final search result count for ARIA
				aria.status(nls.localize('ariaSearchResultsStatus', "Search returned {0} results in {1} files", this.viewModel.searchResult.count(), this.viewModel.searchResult.fileCount()));
			}
		};

		const onError = (e: any) => {
			clearTimeout(slowTimer);
			this.state = SearchUIState.Idle;
			if (errors.isPromiseCanceledError(e)) {
				return onComplete(undefined);
			} else {
				this.updateActions();
				progressComplete();
				this.searchWidget.searchInput.showMessage({ content: e.message, type: MessageType.ERROR });
				this.viewModel.searchResult.clear();

				return Promise.resolve();
			}
		};

		let visibleMatches = 0;

		let updatedActionsForFileCount = false;

		// Handle UI updates in an interval to show frequent progress and results
		const uiRefreshHandle: any = setInterval(() => {
			if (this.state === SearchUIState.Idle) {
				window.clearInterval(uiRefreshHandle);
				return;
			}

			// Search result tree update
			const fileCount = this.viewModel.searchResult.fileCount();
			if (visibleMatches !== fileCount) {
				visibleMatches = fileCount;
				this.refreshAndUpdateCount();
			}

			if (fileCount > 0 && !updatedActionsForFileCount) {
				updatedActionsForFileCount = true;
				this.updateActions();
			}
		}, 100);

		this.searchWidget.setReplaceAllActionState(false);

		return this.viewModel.search(query)
			.then(onComplete, onError);
	}

	private addClickEvents = (element: HTMLElement, handler: (event: any) => void): void => {
		this.messageDisposables.push(dom.addDisposableListener(element, dom.EventType.CLICK, handler));
		this.messageDisposables.push(dom.addDisposableListener(element, dom.EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			let eventHandled = true;

			if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
				handler(e);
			} else {
				eventHandled = false;
			}

			if (eventHandled) {
				event.preventDefault();
				event.stopPropagation();
			}
		}));
	}

	private onOpenSettings = (e: dom.EventLike): void => {
		dom.EventHelper.stop(e, false);

		this.openSettings('.exclude');
	}

	private openSettings(query: string): Promise<IEditor | undefined> {
		const options: ISettingsEditorOptions = { query };
		return this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ?
			this.preferencesService.openWorkspaceSettings(undefined, options) :
			this.preferencesService.openGlobalSettings(undefined, options);
	}

	private onLearnMore = (e: MouseEvent): void => {
		dom.EventHelper.stop(e, false);

		this.openerService.open(URI.parse('https://go.microsoft.com/fwlink/?linkid=853977'));
	}

	private updateSearchResultCount(disregardExcludesAndIgnores?: boolean): void {
		const fileCount = this.viewModel.searchResult.fileCount();
		this.hasSearchResultsKey.set(fileCount > 0);

		const msgWasHidden = this.messagesElement.style.display === 'none';
		if (fileCount > 0) {
			const messageEl = this.clearMessage();
			let resultMsg = this.buildResultCountMessage(this.viewModel.searchResult.count(), fileCount);
			if (disregardExcludesAndIgnores) {
				resultMsg += nls.localize('useIgnoresAndExcludesDisabled', " - exclude settings and ignore files are disabled");
			}

			if (this.searchConfig.enableSearchEditorPreview) {
				dom.append(messageEl, $('span', undefined, resultMsg + ' - '));
				const span = dom.append(messageEl, $('span', undefined));
				const openInEditorLink = dom.append(span, $('a.pointer.prominent', undefined, nls.localize('openInEditor.message', "Open in editor")));

				openInEditorLink.title = appendKeyBindingLabel(
					nls.localize('openInEditor.tooltip', "Copy current search results to an editor"),
					this.keybindingService.lookupKeybinding(Constants.OpenInEditorCommandId), this.keybindingService);

				this.messageDisposables.push(dom.addDisposableListener(openInEditorLink, dom.EventType.CLICK, (e: MouseEvent) => {
					dom.EventHelper.stop(e, false);
					createEditorFromSearchResult(this.searchResult, this.searchIncludePattern.getValue(), this.searchExcludePattern.getValue(), this.labelService, this.editorService);
				}));

			} else {
				dom.append(messageEl, $('p', undefined, resultMsg));
			}
			this.reLayout();
		} else if (!msgWasHidden) {
			dom.hide(this.messagesElement);
		}
	}

	private buildResultCountMessage(resultCount: number, fileCount: number): string {
		if (resultCount === 1 && fileCount === 1) {
			return nls.localize('search.file.result', "{0} result in {1} file", resultCount, fileCount);
		} else if (resultCount === 1) {
			return nls.localize('search.files.result', "{0} result in {1} files", resultCount, fileCount);
		} else if (fileCount === 1) {
			return nls.localize('search.file.results', "{0} results in {1} file", resultCount, fileCount);
		} else {
			return nls.localize('search.files.results', "{0} results in {1} files", resultCount, fileCount);
		}
	}

	private showSearchWithoutFolderMessage(): void {
		this.searchWithoutFolderMessageElement = this.clearMessage();

		const textEl = dom.append(this.searchWithoutFolderMessageElement,
			$('p', undefined, nls.localize('searchWithoutFolder', "You have not opened or specified a folder. Only open files are currently searched - ")));

		const openFolderLink = dom.append(textEl,
			$('a.pointer.prominent', { tabindex: 0 }, nls.localize('openFolder', "Open Folder")));

		this.messageDisposables.push(dom.addDisposableListener(openFolderLink, dom.EventType.CLICK, (e: MouseEvent) => {
			dom.EventHelper.stop(e, false);

			const action = env.isMacintosh ?
				this.instantiationService.createInstance(OpenFileFolderAction, OpenFileFolderAction.ID, OpenFileFolderAction.LABEL) :
				this.instantiationService.createInstance(OpenFolderAction, OpenFolderAction.ID, OpenFolderAction.LABEL);

			this.actionRunner!.run(action).then(() => {
				action.dispose();
			}, err => {
				action.dispose();
				errors.onUnexpectedError(err);
			});
		}));
	}

	private showEmptyStage(forceHideMessages = false): void {
		// disable 'result'-actions
		this.updateActions();

		const showingCancelled = (this.messagesElement.firstChild?.textContent?.indexOf(SEARCH_CANCELLED_MESSAGE) ?? -1) > -1;

		// clean up ui
		// this.replaceService.disposeAllReplacePreviews();
		if (showingCancelled || forceHideMessages || !this.configurationService.getValue<ISearchConfiguration>().search.searchOnType) {
			// when in search to type, don't preemptively hide, as it causes flickering and shifting of the live results
			dom.hide(this.messagesElement);
		}

		dom.show(this.resultsElement);
		this.currentSelectedFileMatch = undefined;
	}

	private onFocus(lineMatch: Match, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean): Promise<any> {
		const useReplacePreview = this.configurationService.getValue<ISearchConfiguration>().search.useReplacePreview;
		return (useReplacePreview && this.viewModel.isReplaceActive() && !!this.viewModel.replaceString) ?
			this.replaceService.openReplacePreview(lineMatch, preserveFocus, sideBySide, pinned) :
			this.open(lineMatch, preserveFocus, sideBySide, pinned);
	}

	open(element: FileMatchOrMatch, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean): Promise<void> {
		const selection = this.getSelectionFrom(element);
		const resource = element instanceof Match ? element.parent().resource : (<FileMatch>element).resource;
		return this.editorService.openEditor({
			resource: resource,
			options: {
				preserveFocus,
				pinned,
				selection,
				revealIfVisible: true
			}
		}, sideBySide ? SIDE_GROUP : ACTIVE_GROUP).then(editor => {
			if (editor && element instanceof Match && preserveFocus) {
				this.viewModel.searchResult.rangeHighlightDecorations.highlightRange(
					(<ICodeEditor>editor.getControl()).getModel()!,
					element.range()
				);
			} else {
				this.viewModel.searchResult.rangeHighlightDecorations.removeHighlightRange();
			}
		}, errors.onUnexpectedError);
	}

	openEditorWithMultiCursor(element: FileMatchOrMatch): Promise<void> {
		const resource = element instanceof Match ? element.parent().resource : (<FileMatch>element).resource;
		return this.editorService.openEditor({
			resource: resource,
			options: {
				preserveFocus: false,
				pinned: true,
				revealIfVisible: true
			}
		}).then(editor => {
			if (editor) {
				let fileMatch = null;
				if (element instanceof FileMatch) {
					fileMatch = element;
				}
				else if (element instanceof Match) {
					fileMatch = element.parent();
				}

				if (fileMatch) {
					const selections = fileMatch.matches().map(m => new Selection(m.range().startLineNumber, m.range().startColumn, m.range().endLineNumber, m.range().endColumn));
					const codeEditor = getCodeEditor(editor.getControl());
					if (codeEditor) {
						let multiCursorController = MultiCursorSelectionController.get(codeEditor);
						multiCursorController.selectAllUsingSelections(selections);
					}
				}
			}
			this.viewModel.searchResult.rangeHighlightDecorations.removeHighlightRange();
		}, errors.onUnexpectedError);
	}

	private getSelectionFrom(element: FileMatchOrMatch): any {
		let match: Match | null = null;
		if (element instanceof Match) {
			match = element;
		}
		if (element instanceof FileMatch && element.count() > 0) {
			match = element.matches()[element.matches().length - 1];
		}
		if (match) {
			const range = match.range();
			if (this.viewModel.isReplaceActive() && !!this.viewModel.replaceString) {
				const replaceString = match.replaceString;
				return {
					startLineNumber: range.startLineNumber,
					startColumn: range.startColumn,
					endLineNumber: range.startLineNumber,
					endColumn: range.startColumn + replaceString.length
				};
			}
			return range;
		}
		return undefined;
	}

	private onUntitledDidDispose(resource: URI): void {
		if (!this.viewModel) {
			return;
		}

		// remove search results from this resource as it got disposed
		const matches = this.viewModel.searchResult.matches();
		for (let i = 0, len = matches.length; i < len; i++) {
			if (resource.toString() === matches[i].resource.toString()) {
				this.viewModel.searchResult.remove(matches[i]);
			}
		}
	}

	private onFilesChanged(e: FileChangesEvent): void {
		if (!this.viewModel || !e.gotDeleted()) {
			return;
		}

		const matches = this.viewModel.searchResult.matches();

		const changedMatches = matches.filter(m => e.contains(m.resource, FileChangeType.DELETED));
		this.viewModel.searchResult.remove(changedMatches);
	}

	getActions(): IAction[] {
		return [
			this.state === SearchUIState.SlowSearch ?
				this.cancelAction :
				this.refreshAction,
			...this.actions
		];
	}

	private get searchConfig(): ISearchConfigurationProperties {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	private clearHistory(): void {
		this.searchWidget.clearHistory();
		this.inputPatternExcludes.clearHistory();
		this.inputPatternIncludes.clearHistory();
	}

	public saveState(): void {
		const isRegex = this.searchWidget.searchInput.getRegex();
		const isWholeWords = this.searchWidget.searchInput.getWholeWords();
		const isCaseSensitive = this.searchWidget.searchInput.getCaseSensitive();
		const contentPattern = this.searchWidget.searchInput.getValue();
		const patternExcludes = this.inputPatternExcludes.getValue().trim();
		const patternIncludes = this.inputPatternIncludes.getValue().trim();
		const useExcludesAndIgnoreFiles = this.inputPatternExcludes.useExcludesAndIgnoreFiles();
		const preserveCase = this.viewModel.preserveCase;

		this.viewletState['query.contentPattern'] = contentPattern;
		this.viewletState['query.regex'] = isRegex;
		this.viewletState['query.wholeWords'] = isWholeWords;
		this.viewletState['query.caseSensitive'] = isCaseSensitive;
		this.viewletState['query.folderExclusions'] = patternExcludes;
		this.viewletState['query.folderIncludes'] = patternIncludes;
		this.viewletState['query.useExcludesAndIgnoreFiles'] = useExcludesAndIgnoreFiles;
		this.viewletState['query.preserveCase'] = preserveCase;

		const isReplaceShown = this.searchAndReplaceWidget.isReplaceShown();
		this.viewletState['view.showReplace'] = isReplaceShown;
		this.viewletState['query.replaceText'] = isReplaceShown && this.searchWidget.getReplaceValue();

		const history: ISearchHistoryValues = Object.create(null);

		const searchHistory = this.searchWidget.getSearchHistory();
		if (searchHistory && searchHistory.length) {
			history.search = searchHistory;
		}

		const replaceHistory = this.searchWidget.getReplaceHistory();
		if (replaceHistory && replaceHistory.length) {
			history.replace = replaceHistory;
		}

		const patternExcludesHistory = this.inputPatternExcludes.getHistory();
		if (patternExcludesHistory && patternExcludesHistory.length) {
			history.exclude = patternExcludesHistory;
		}

		const patternIncludesHistory = this.inputPatternIncludes.getHistory();
		if (patternIncludesHistory && patternIncludesHistory.length) {
			history.include = patternIncludesHistory;
		}

		this.searchHistoryService.save(history);

		super.saveState();
	}

	dispose(): void {
		this.isDisposed = true;
		this.saveState();
		super.dispose();
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
	const matchHighlightColor = theme.getColor(editorFindMatchHighlight);
	if (matchHighlightColor) {
		collector.addRule(`.monaco-workbench .search-view .findInFileMatch { background-color: ${matchHighlightColor}; }`);
	}

	const diffInsertedColor = theme.getColor(diffInserted);
	if (diffInsertedColor) {
		collector.addRule(`.monaco-workbench .search-view .replaceMatch { background-color: ${diffInsertedColor}; }`);
	}

	const diffRemovedColor = theme.getColor(diffRemoved);
	if (diffRemovedColor) {
		collector.addRule(`.monaco-workbench .search-view .replace.findInFileMatch { background-color: ${diffRemovedColor}; }`);
	}

	const diffInsertedOutlineColor = theme.getColor(diffInsertedOutline);
	if (diffInsertedOutlineColor) {
		collector.addRule(`.monaco-workbench .search-view .replaceMatch:not(:empty) { border: 1px ${theme.type === 'hc' ? 'dashed' : 'solid'} ${diffInsertedOutlineColor}; }`);
	}

	const diffRemovedOutlineColor = theme.getColor(diffRemovedOutline);
	if (diffRemovedOutlineColor) {
		collector.addRule(`.monaco-workbench .search-view .replace.findInFileMatch { border: 1px ${theme.type === 'hc' ? 'dashed' : 'solid'} ${diffRemovedOutlineColor}; }`);
	}

	const findMatchHighlightBorder = theme.getColor(editorFindMatchHighlightBorder);
	if (findMatchHighlightBorder) {
		collector.addRule(`.monaco-workbench .search-view .findInFileMatch { border: 1px ${theme.type === 'hc' ? 'dashed' : 'solid'} ${findMatchHighlightBorder}; }`);
	}

	const outlineSelectionColor = theme.getColor(listActiveSelectionForeground);
	if (outlineSelectionColor) {
		collector.addRule(`.monaco-workbench .search-view .monaco-list.element-focused .monaco-list-row.focused.selected:not(.highlighted) .action-label:focus { outline-color: ${outlineSelectionColor} }`);
	}
});
