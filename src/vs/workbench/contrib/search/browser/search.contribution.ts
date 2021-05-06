/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { onUnexpectedError } from 'vs/base/common/errors';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import * as platform from 'vs/base/common/platform';
import { dirname } from 'vs/base/common/resources';
import { assertIsDefined, assertType } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ToggleCaseSensitiveKeybinding, TogglePreserveCaseKeybinding, ToggleRegexKeybinding, ToggleWholeWordKeybinding } from 'vs/editor/contrib/find/findModel';
import { AbstractGotoLineQuickAccessProvider } from 'vs/editor/contrib/quickAccess/gotoLineQuickAccess';
import * as nls from 'vs/nls';
import { Action2, ICommandAction, MenuId, MenuRegistry, registerAction2, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandHandler, ICommandService } from 'vs/platform/commands/common/commands';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { ContextKeyEqualsExpr, ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IFileService } from 'vs/platform/files/common/files';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IListService, WorkbenchListFocusContextKey, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { Extensions as QuickAccessExtensions, IQuickAccessRegistry } from 'vs/platform/quickinput/common/quickAccess';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { defaultQuickAccessContextKeyValue } from 'vs/workbench/browser/quickaccess';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, IViewsRegistry, IViewsService, ViewContainerLocation } from 'vs/workbench/common/views';
import { GotoSymbolQuickAccessProvider } from 'vs/workbench/contrib/codeEditor/browser/quickaccess/gotoSymbolQuickAccess';
import { ExplorerViewPaneContainer } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { getMultiSelectedResources, IExplorerService } from 'vs/workbench/contrib/files/browser/files';
import { ExplorerFolderContext, ExplorerRootContext, FilesExplorerFocusCondition, VIEWLET_ID as VIEWLET_ID_FILES } from 'vs/workbench/contrib/files/common/files';
import { AnythingQuickAccessProvider } from 'vs/workbench/contrib/search/browser/anythingQuickAccess';
import { registerContributions as replaceContributions } from 'vs/workbench/contrib/search/browser/replaceContributions';
import { cancelSearch, clearHistoryCommand, clearSearchResults, CloseReplaceAction, collapseDeepestExpandedLevel, copyAllCommand, copyMatchCommand, copyPathCommand, expandAll, FindInFilesCommand, FocusNextInputAction, FocusNextSearchResultAction, FocusPreviousInputAction, FocusPreviousSearchResultAction, focusSearchListCommand, getSearchView, openSearchView, refreshSearch, RemoveAction, ReplaceAction, ReplaceAllAction, ReplaceAllInFolderAction, ReplaceInFilesAction, toggleCaseSensitiveCommand, togglePreserveCaseCommand, toggleRegexCommand, ToggleSearchOnTypeAction, toggleWholeWordCommand } from 'vs/workbench/contrib/search/browser/searchActions';
import { searchClearIcon, searchCollapseAllIcon, searchExpandAllIcon, searchRefreshIcon, searchStopIcon, searchViewIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import { SearchView } from 'vs/workbench/contrib/search/browser/searchView';
import { registerContributions as searchWidgetContributions } from 'vs/workbench/contrib/search/browser/searchWidget';
import { SymbolsQuickAccessProvider } from 'vs/workbench/contrib/search/browser/symbolsQuickAccess';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { resolveResourcesForSearchIncludes } from 'vs/workbench/contrib/search/common/queryBuilder';
import { getWorkspaceSymbols, SearchStateKey, SearchUIState } from 'vs/workbench/contrib/search/common/search';
import { ISearchHistoryService, SearchHistoryService } from 'vs/workbench/contrib/search/common/searchHistoryService';
import { FileMatch, FileMatchOrMatch, FolderMatch, ISearchWorkbenchService, Match, RenderableMatch, SearchWorkbenchService } from 'vs/workbench/contrib/search/common/searchModel';
import * as SearchEditorConstants from 'vs/workbench/contrib/searchEditor/browser/constants';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ISearchConfiguration, SearchSortOrder, SEARCH_EXCLUDE_CONFIG, VIEWLET_ID, VIEW_ID } from 'vs/workbench/services/search/common/search';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';

registerSingleton(ISearchWorkbenchService, SearchWorkbenchService, true);
registerSingleton(ISearchHistoryService, SearchHistoryService, true);

replaceContributions();
searchWidgetContributions();

const category = { value: nls.localize('search', "Search"), original: 'Search' };

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.action.search.toggleQueryDetails',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.or(Constants.SearchViewFocusedKey, SearchEditorConstants.InSearchEditor),
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_J,
	handler: accessor => {
		const contextService = accessor.get(IContextKeyService).getContext(document.activeElement);
		if (contextService.getValue(SearchEditorConstants.InSearchEditor.serialize())) {
			(accessor.get(IEditorService).activeEditorPane as SearchEditor).toggleQueryDetails();
		} else if (contextService.getValue(Constants.SearchViewFocusedKey.serialize())) {
			const searchView = getSearchView(accessor.get(IViewsService));
			assertIsDefined(searchView).toggleQueryDetails();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.FocusSearchFromResults,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FirstMatchFocusKey),
	primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			searchView.focusPreviousInputBox();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.OpenMatch,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FileMatchOrMatchFocusKey),
	primary: KeyCode.Enter,
	mac: {
		primary: KeyCode.Enter,
		secondary: [KeyMod.CtrlCmd | KeyCode.DownArrow]
	},
	handler: (accessor) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			searchView.open(<FileMatchOrMatch>tree.getFocus()[0], false, false, true);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.OpenMatchToSide,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FileMatchOrMatchFocusKey),
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	mac: {
		primary: KeyMod.WinCtrl | KeyCode.Enter
	},
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			searchView.open(<FileMatchOrMatch>tree.getFocus()[0], false, true, true);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.RemoveActionId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FileMatchOrMatchFocusKey),
	primary: KeyCode.Delete,
	mac: {
		primary: KeyMod.CtrlCmd | KeyCode.Backspace,
	},
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			accessor.get(IInstantiationService).createInstance(RemoveAction, tree, tree.getFocus()[0]!).run();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.ReplaceActionId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.ReplaceActiveKey, Constants.MatchFocusKey),
	primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KEY_1,
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			accessor.get(IInstantiationService).createInstance(ReplaceAction, tree, tree.getFocus()[0] as Match, searchView).run();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.ReplaceAllInFileActionId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.ReplaceActiveKey, Constants.FileFocusKey),
	primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KEY_1,
	secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter],
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			accessor.get(IInstantiationService).createInstance(ReplaceAllAction, searchView, tree.getFocus()[0] as FileMatch).run();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.ReplaceAllInFolderActionId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.ReplaceActiveKey, Constants.FolderFocusKey),
	primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KEY_1,
	secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter],
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			accessor.get(IInstantiationService).createInstance(ReplaceAllInFolderAction, tree, tree.getFocus()[0] as FolderMatch).run();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.CloseReplaceWidgetActionId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.ReplaceInputBoxFocusedKey),
	primary: KeyCode.Escape,
	handler: (accessor, args: any) => {
		accessor.get(IInstantiationService).createInstance(CloseReplaceAction, Constants.CloseReplaceWidgetActionId, '').run();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: FocusNextInputAction.ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.or(
		ContextKeyExpr.and(SearchEditorConstants.InSearchEditor, Constants.InputBoxFocusedKey),
		ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.InputBoxFocusedKey)),
	primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
	handler: (accessor, args: any) => {
		accessor.get(IInstantiationService).createInstance(FocusNextInputAction, FocusNextInputAction.ID, '').run();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: FocusPreviousInputAction.ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.or(
		ContextKeyExpr.and(SearchEditorConstants.InSearchEditor, Constants.InputBoxFocusedKey),
		ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.InputBoxFocusedKey, Constants.SearchInputBoxFocusedKey.toNegated())),
	primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
	handler: (accessor, args: any) => {
		accessor.get(IInstantiationService).createInstance(FocusPreviousInputAction, FocusPreviousInputAction.ID, '').run();
	}
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.ReplaceActionId,
		title: ReplaceAction.LABEL
	},
	when: ContextKeyExpr.and(Constants.ReplaceActiveKey, Constants.MatchFocusKey),
	group: 'search',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.ReplaceAllInFolderActionId,
		title: ReplaceAllInFolderAction.LABEL
	},
	when: ContextKeyExpr.and(Constants.ReplaceActiveKey, Constants.FolderFocusKey),
	group: 'search',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.ReplaceAllInFileActionId,
		title: ReplaceAllAction.LABEL
	},
	when: ContextKeyExpr.and(Constants.ReplaceActiveKey, Constants.FileFocusKey),
	group: 'search',
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.RemoveActionId,
		title: RemoveAction.LABEL
	},
	when: Constants.FileMatchOrMatchFocusKey,
	group: 'search',
	order: 2
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.CopyMatchCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.FileMatchOrMatchFocusKey,
	primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
	handler: copyMatchCommand
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.CopyMatchCommandId,
		title: nls.localize('copyMatchLabel', "Copy")
	},
	when: Constants.FileMatchOrMatchFocusKey,
	group: 'search_2',
	order: 1
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.CopyPathCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.FileMatchOrFolderMatchWithResourceFocusKey,
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_C,
	win: {
		primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_C
	},
	handler: copyPathCommand
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.CopyPathCommandId,
		title: nls.localize('copyPathLabel', "Copy Path")
	},
	when: Constants.FileMatchOrFolderMatchWithResourceFocusKey,
	group: 'search_2',
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: {
		id: Constants.CopyAllCommandId,
		title: nls.localize('copyAllLabel', "Copy All")
	},
	when: Constants.HasSearchResults,
	group: 'search_2',
	order: 3
});

CommandsRegistry.registerCommand({
	id: Constants.CopyAllCommandId,
	handler: copyAllCommand
});

CommandsRegistry.registerCommand({
	id: Constants.ClearSearchHistoryCommandId,
	handler: clearHistoryCommand
});

CommandsRegistry.registerCommand({
	id: Constants.RevealInSideBarForSearchResults,
	handler: (accessor, args: any) => {
		const viewletService = accessor.get(IViewletService);
		const explorerService = accessor.get(IExplorerService);
		const contextService = accessor.get(IWorkspaceContextService);

		const searchView = getSearchView(accessor.get(IViewsService));
		if (!searchView) {
			return;
		}

		let fileMatch: FileMatch;
		if (!(args instanceof FileMatch)) {
			args = searchView.getControl().getFocus()[0];
		}
		if (args instanceof FileMatch) {
			fileMatch = args;
		} else {
			return;
		}

		viewletService.openViewlet(VIEWLET_ID_FILES, false).then((viewlet) => {
			if (!viewlet) {
				return;
			}

			const explorerViewContainer = viewlet.getViewPaneContainer() as ExplorerViewPaneContainer;
			const uri = fileMatch.resource;
			if (uri && contextService.isInsideWorkspace(uri)) {
				const explorerView = explorerViewContainer.getExplorerView();
				explorerView.setExpanded(true);
				explorerService.select(uri, true).then(() => explorerView.focus(), onUnexpectedError);
			}
		});
	}
});

registerAction2(class CancelSearchAction extends Action2 {
	constructor() {
		super({
			id: 'search.action.cancel',
			title: nls.localize('CancelSearchAction.label', "Cancel Search"),
			icon: searchStopIcon,
			category,
			f1: true,
			precondition: SearchStateKey.isEqualTo(SearchUIState.Idle).negate(),
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, WorkbenchListFocusContextKey),
				primary: KeyCode.Escape,
			},
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 0,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', VIEW_ID), SearchStateKey.isEqualTo(SearchUIState.SlowSearch)),
			}]
		});
	}
	run(accessor: ServicesAccessor, ...args: any[]) {
		return cancelSearch(accessor);
	}
});

registerAction2(class RefreshAction extends Action2 {
	constructor() {
		super({
			id: 'search.action.refreshSearchResults',
			title: nls.localize('RefreshAction.label', "Refresh"),
			icon: searchRefreshIcon,
			precondition: Constants.ViewHasSearchPatternKey,
			category,
			f1: true,
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 0,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', VIEW_ID), SearchStateKey.isEqualTo(SearchUIState.SlowSearch).negate()),
			}]
		});
	}
	run(accessor: ServicesAccessor, ...args: any[]) {
		return refreshSearch(accessor);
	}
});

registerAction2(class CollapseDeepestExpandedLevelAction extends Action2 {
	constructor() {
		super({
			id: 'search.action.collapseSearchResults',
			title: nls.localize('CollapseDeepestExpandedLevelAction.label', "Collapse All"),
			category,
			icon: searchCollapseAllIcon,
			f1: true,
			precondition: ContextKeyExpr.and(Constants.HasSearchResults, Constants.ViewHasSomeCollapsibleKey),
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 3,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', VIEW_ID), ContextKeyExpr.or(Constants.HasSearchResults.negate(), Constants.ViewHasSomeCollapsibleKey)),
			}]
		});
	}
	run(accessor: ServicesAccessor, ...args: any[]) {
		return collapseDeepestExpandedLevel(accessor);
	}
});

registerAction2(class ExpandAllAction extends Action2 {
	constructor() {
		super({
			id: 'search.action.expandSearchResults',
			title: nls.localize('ExpandAllAction.label', "Expand All"),
			category,
			icon: searchExpandAllIcon,
			f1: true,
			precondition: ContextKeyExpr.and(Constants.HasSearchResults, Constants.ViewHasSomeCollapsibleKey.toNegated()),
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 3,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', VIEW_ID), Constants.HasSearchResults, Constants.ViewHasSomeCollapsibleKey.toNegated()),
			}]
		});
	}
	run(accessor: ServicesAccessor, ...args: any[]) {
		return expandAll(accessor);
	}
});

registerAction2(class ClearSearchResultsAction extends Action2 {
	constructor() {
		super({
			id: 'search.action.clearSearchResults',
			title: nls.localize('ClearSearchResultsAction.label', "Clear Search Results"),
			category,
			icon: searchClearIcon,
			f1: true,
			precondition: ContextKeyExpr.or(Constants.HasSearchResults, Constants.ViewHasSearchPatternKey, Constants.ViewHasReplacePatternKey, Constants.ViewHasFilePatternKey),
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 1,
				when: ContextKeyEqualsExpr.create('view', VIEW_ID),
			}]
		});
	}
	run(accessor: ServicesAccessor, ...args: any[]) {
		return clearSearchResults(accessor);
	}
});

const RevealInSideBarForSearchResultsCommand: ICommandAction = {
	id: Constants.RevealInSideBarForSearchResults,
	title: nls.localize('revealInSideBar', "Reveal in Side Bar")
};

MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: RevealInSideBarForSearchResultsCommand,
	when: ContextKeyExpr.and(Constants.FileFocusKey, Constants.HasSearchResults),
	group: 'search_3',
	order: 1
});

const ClearSearchHistoryCommand: ICommandAction = {
	id: Constants.ClearSearchHistoryCommandId,
	title: { value: nls.localize('clearSearchHistoryLabel', "Clear Search History"), original: 'Clear Search History' },
	category
};
MenuRegistry.addCommand(ClearSearchHistoryCommand);

CommandsRegistry.registerCommand({
	id: Constants.FocusSearchListCommandID,
	handler: focusSearchListCommand
});

const FocusSearchListCommand: ICommandAction = {
	id: Constants.FocusSearchListCommandID,
	title: { value: nls.localize('focusSearchListCommandLabel', "Focus List"), original: 'Focus List' },
	category
};
MenuRegistry.addCommand(FocusSearchListCommand);


const searchInFolderCommand: ICommandHandler = async (accessor, resource?: URI) => {
	const listService = accessor.get(IListService);
	const fileService = accessor.get(IFileService);
	const viewsService = accessor.get(IViewsService);
	const contextService = accessor.get(IWorkspaceContextService);
	const commandService = accessor.get(ICommandService);
	const resources = getMultiSelectedResources(resource, listService, accessor.get(IEditorService), accessor.get(IExplorerService));
	const searchConfig = accessor.get(IConfigurationService).getValue<ISearchConfiguration>().search;
	const mode = searchConfig.mode;

	const resolvedResources = fileService.resolveAll(resources.map(resource => ({ resource }))).then(results => {
		const folders: URI[] = [];
		results.forEach(result => {
			if (result.success && result.stat) {
				folders.push(result.stat.isDirectory ? result.stat.resource : dirname(result.stat.resource));
			}
		});
		return resolveResourcesForSearchIncludes(folders, contextService);
	});

	if (mode === 'view') {
		const searchView = await openSearchView(viewsService, true);
		if (resources && resources.length && searchView) {
			searchView.searchInFolders(await resolvedResources);
		}
		return undefined;
	} else {
		return commandService.executeCommand(SearchEditorConstants.OpenEditorCommandId, {
			filesToInclude: (await resolvedResources).join(', '),
			showIncludesExcludes: true,
			location: mode === 'newEditor' ? 'new' : 'reuse',
		});
	}
};

const FIND_IN_FOLDER_ID = 'filesExplorer.findInFolder';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: FIND_IN_FOLDER_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerFolderContext),
	primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_F,
	handler: searchInFolderCommand
});

const FIND_IN_WORKSPACE_ID = 'filesExplorer.findInWorkspace';
CommandsRegistry.registerCommand({
	id: FIND_IN_WORKSPACE_ID,
	handler: async (accessor) => {
		const searchConfig = accessor.get(IConfigurationService).getValue<ISearchConfiguration>().search;
		const mode = searchConfig.mode;

		if (mode === 'view') {
			const searchView = await openSearchView(accessor.get(IViewsService), true);
			if (searchView) {
				searchView.searchInFolders();
			}
		}
		else {
			return accessor.get(ICommandService).executeCommand(SearchEditorConstants.OpenEditorCommandId, {
				location: mode === 'newEditor' ? 'new' : 'reuse',
				filesToInclude: '',
			});
		}
	}
});

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: '4_search',
	order: 10,
	command: {
		id: FIND_IN_FOLDER_ID,
		title: nls.localize('findInFolder', "Find in Folder...")
	},
	when: ContextKeyExpr.and(ExplorerFolderContext)
});

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: '4_search',
	order: 10,
	command: {
		id: FIND_IN_WORKSPACE_ID,
		title: nls.localize('findInWorkspace', "Find in Workspace...")
	},
	when: ContextKeyExpr.and(ExplorerRootContext, ExplorerFolderContext.toNegated())
});


class ShowAllSymbolsAction extends Action {

	static readonly ID = 'workbench.action.showAllSymbols';
	static readonly LABEL = nls.localize('showTriggerActions', "Go to Symbol in Workspace...");
	static readonly ALL_SYMBOLS_PREFIX = '#';

	constructor(
		actionId: string,
		actionLabel: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(actionId, actionLabel);
	}

	override async run(): Promise<void> {
		this.quickInputService.quickAccess.show(ShowAllSymbolsAction.ALL_SYMBOLS_PREFIX);
	}
}

const SEARCH_MODE_CONFIG = 'search.mode';

const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VIEWLET_ID,
	title: nls.localize('name', "Search"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	hideIfEmpty: true,
	icon: searchViewIcon,
	order: 1,
}, ViewContainerLocation.Sidebar, { donotRegisterOpenCommand: true });

const viewDescriptor: IViewDescriptor = {
	id: VIEW_ID,
	containerIcon: searchViewIcon,
	name: nls.localize('search', "Search"),
	ctorDescriptor: new SyncDescriptor(SearchView),
	canToggleVisibility: false,
	canMoveView: true,
	openCommandActionDescriptor: {
		id: viewContainer.id,
		mnemonicTitle: nls.localize({ key: 'miViewSearch', comment: ['&& denotes a mnemonic'] }, "&&Search"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_F,
		},
		order: 1
	}
};

// Register search default location to sidebar
Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([viewDescriptor], viewContainer);


// Migrate search location setting to new model
class RegisterSearchViewContribution implements IWorkbenchContribution {
	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		const data = configurationService.inspect('search.location');

		if (data.value === 'panel') {
			viewDescriptorService.moveViewToLocation(viewDescriptor, ViewContainerLocation.Panel);
		}

		if (data.userValue) {
			configurationService.updateValue('search.location', undefined, ConfigurationTarget.USER);
		}

		if (data.userLocalValue) {
			configurationService.updateValue('search.location', undefined, ConfigurationTarget.USER_LOCAL);
		}

		if (data.userRemoteValue) {
			configurationService.updateValue('search.location', undefined, ConfigurationTarget.USER_REMOTE);
		}

		if (data.workspaceFolderValue) {
			configurationService.updateValue('search.location', undefined, ConfigurationTarget.WORKSPACE_FOLDER);
		}

		if (data.workspaceValue) {
			configurationService.updateValue('search.location', undefined, ConfigurationTarget.WORKSPACE);
		}
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(RegisterSearchViewContribution, LifecyclePhase.Starting);

// Actions
const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);

// Find in Files by default is the same as View: Show Search, but can be configured to open a search editor instead with the `search.mode` binding
KeybindingsRegistry.registerCommandAndKeybindingRule({
	description: {
		description: nls.localize('findInFiles.description', "Open the search viewlet"),
		args: [
			{
				name: nls.localize('findInFiles.args', "A set of options for the search viewlet"),
				schema: {
					type: 'object',
					properties: {
						query: { 'type': 'string' },
						replace: { 'type': 'string' },
						preserveCase: { 'type': 'boolean' },
						triggerSearch: { 'type': 'boolean' },
						filesToInclude: { 'type': 'string' },
						filesToExclude: { 'type': 'string' },
						isRegex: { 'type': 'boolean' },
						isCaseSensitive: { 'type': 'boolean' },
						matchWholeWord: { 'type': 'boolean' },
						useExcludeSettingsAndIgnoreFiles: { 'type': 'boolean' },
					}
				}
			},
		]
	},
	id: Constants.FindInFilesActionId,
	// Give more weightage to this keybinding than of `View: Show Search` keybinding. See #116188, #115556, #115511
	weight: KeybindingWeight.WorkbenchContrib + 1,
	when: null,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_F,
	handler: FindInFilesCommand
});
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: Constants.FindInFilesActionId, title: { value: nls.localize('findInFiles', "Find in Files"), original: 'Find in Files' }, category } });
MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
	group: '4_find_global',
	command: {
		id: Constants.FindInFilesActionId,
		title: nls.localize({ key: 'miFindInFiles', comment: ['&& denotes a mnemonic'] }, "Find &&in Files")
	},
	order: 1
});

registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusNextSearchResultAction, { primary: KeyCode.F4 }), 'Search: Focus Next Search Result', category.value, ContextKeyExpr.or(Constants.HasSearchResults, SearchEditorConstants.InSearchEditor));
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusPreviousSearchResultAction, { primary: KeyMod.Shift | KeyCode.F4 }), 'Search: Focus Previous Search Result', category.value, ContextKeyExpr.or(Constants.HasSearchResults, SearchEditorConstants.InSearchEditor));

registry.registerWorkbenchAction(SyncActionDescriptor.from(ReplaceInFilesAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_H }), 'Search: Replace in Files', category.value);
MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
	group: '4_find_global',
	command: {
		id: ReplaceInFilesAction.ID,
		title: nls.localize({ key: 'miReplaceInFiles', comment: ['&& denotes a mnemonic'] }, "Replace &&in Files")
	},
	order: 2
});

if (platform.isMacintosh) {
	// Register this with a more restrictive `when` on mac to avoid conflict with "copy path"
	KeybindingsRegistry.registerCommandAndKeybindingRule(Object.assign({
		id: Constants.ToggleCaseSensitiveCommandId,
		weight: KeybindingWeight.WorkbenchContrib,
		when: ContextKeyExpr.and(Constants.SearchViewFocusedKey, Constants.FileMatchOrFolderMatchFocusKey.toNegated()),
		handler: toggleCaseSensitiveCommand
	}, ToggleCaseSensitiveKeybinding));
} else {
	KeybindingsRegistry.registerCommandAndKeybindingRule(Object.assign({
		id: Constants.ToggleCaseSensitiveCommandId,
		weight: KeybindingWeight.WorkbenchContrib,
		when: Constants.SearchViewFocusedKey,
		handler: toggleCaseSensitiveCommand
	}, ToggleCaseSensitiveKeybinding));
}

KeybindingsRegistry.registerCommandAndKeybindingRule(Object.assign({
	id: Constants.ToggleWholeWordCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.SearchViewFocusedKey,
	handler: toggleWholeWordCommand
}, ToggleWholeWordKeybinding));

KeybindingsRegistry.registerCommandAndKeybindingRule(Object.assign({
	id: Constants.ToggleRegexCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.SearchViewFocusedKey,
	handler: toggleRegexCommand
}, ToggleRegexKeybinding));

KeybindingsRegistry.registerCommandAndKeybindingRule(Object.assign({
	id: Constants.TogglePreserveCaseId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.SearchViewFocusedKey,
	handler: togglePreserveCaseCommand
}, TogglePreserveCaseKeybinding));

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.AddCursorsAtSearchResults,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FileMatchOrMatchFocusKey),
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_L,
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewsService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			searchView.openEditorWithMultiCursor(<FileMatchOrMatch>tree.getFocus()[0]);
		}
	}
});

registry.registerWorkbenchAction(SyncActionDescriptor.from(ShowAllSymbolsAction, { primary: KeyMod.CtrlCmd | KeyCode.KEY_T }), 'Go to Symbol in Workspace...');
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleSearchOnTypeAction), 'Search: Toggle Search on Type', category.value);

// Register Quick Access Handler
const quickAccessRegistry = Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess);

quickAccessRegistry.registerQuickAccessProvider({
	ctor: AnythingQuickAccessProvider,
	prefix: AnythingQuickAccessProvider.PREFIX,
	placeholder: nls.localize('anythingQuickAccessPlaceholder', "Search files by name (append {0} to go to line or {1} to go to symbol)", AbstractGotoLineQuickAccessProvider.PREFIX, GotoSymbolQuickAccessProvider.PREFIX),
	contextKey: defaultQuickAccessContextKeyValue,
	helpEntries: [{ description: nls.localize('anythingQuickAccess', "Go to File"), needsEditor: false }]
});

quickAccessRegistry.registerQuickAccessProvider({
	ctor: SymbolsQuickAccessProvider,
	prefix: SymbolsQuickAccessProvider.PREFIX,
	placeholder: nls.localize('symbolsQuickAccessPlaceholder', "Type the name of a symbol to open."),
	contextKey: 'inWorkspaceSymbolsPicker',
	helpEntries: [{ description: nls.localize('symbolsQuickAccess', "Go to Symbol in Workspace"), needsEditor: false }]
});

// Configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'search',
	order: 13,
	title: nls.localize('searchConfigurationTitle', "Search"),
	type: 'object',
	properties: {
		[SEARCH_EXCLUDE_CONFIG]: {
			type: 'object',
			markdownDescription: nls.localize('exclude', "Configure glob patterns for excluding files and folders in fulltext searches and quick open. Inherits all glob patterns from the `#files.exclude#` setting. Read more about glob patterns [here](https://code.visualstudio.com/docs/editor/codebasics#_advanced-search-options)."),
			default: { '**/node_modules': true, '**/bower_components': true, '**/*.code-search': true },
			additionalProperties: {
				anyOf: [
					{
						type: 'boolean',
						description: nls.localize('exclude.boolean', "The glob pattern to match file paths against. Set to true or false to enable or disable the pattern."),
					},
					{
						type: 'object',
						properties: {
							when: {
								type: 'string', // expression ({ "**/*.js": { "when": "$(basename).js" } })
								pattern: '\\w*\\$\\(basename\\)\\w*',
								default: '$(basename).ext',
								description: nls.localize('exclude.when', 'Additional check on the siblings of a matching file. Use $(basename) as variable for the matching file name.')
							}
						}
					}
				]
			},
			scope: ConfigurationScope.RESOURCE
		},
		[SEARCH_MODE_CONFIG]: {
			type: 'string',
			enum: ['view', 'reuseEditor', 'newEditor'],
			default: 'view',
			markdownDescription: nls.localize('search.mode', "Controls where new `Search: Find in Files` and `Find in Folder` operations occur: either in the sidebar's search view, or in a search editor"),
			enumDescriptions: [
				nls.localize('search.mode.view', "Search in the search view, either in the panel or sidebar."),
				nls.localize('search.mode.reuseEditor', "Search in an existing search editor if present, otherwise in a new search editor."),
				nls.localize('search.mode.newEditor', "Search in a new search editor."),
			]
		},
		'search.useRipgrep': {
			type: 'boolean',
			description: nls.localize('useRipgrep', "This setting is deprecated and now falls back on \"search.usePCRE2\"."),
			deprecationMessage: nls.localize('useRipgrepDeprecated', "Deprecated. Consider \"search.usePCRE2\" for advanced regex feature support."),
			default: true
		},
		'search.maintainFileSearchCache': {
			type: 'boolean',
			description: nls.localize('search.maintainFileSearchCache', "When enabled, the searchService process will be kept alive instead of being shut down after an hour of inactivity. This will keep the file search cache in memory."),
			default: false
		},
		'search.useIgnoreFiles': {
			type: 'boolean',
			markdownDescription: nls.localize('useIgnoreFiles', "Controls whether to use `.gitignore` and `.ignore` files when searching for files."),
			default: true,
			scope: ConfigurationScope.RESOURCE
		},
		'search.useGlobalIgnoreFiles': {
			type: 'boolean',
			markdownDescription: nls.localize('useGlobalIgnoreFiles', "Controls whether to use global `.gitignore` and `.ignore` files when searching for files."),
			default: false,
			scope: ConfigurationScope.RESOURCE
		},
		'search.quickOpen.includeSymbols': {
			type: 'boolean',
			description: nls.localize('search.quickOpen.includeSymbols', "Whether to include results from a global symbol search in the file results for Quick Open."),
			default: false
		},
		'search.quickOpen.includeHistory': {
			type: 'boolean',
			description: nls.localize('search.quickOpen.includeHistory', "Whether to include results from recently opened files in the file results for Quick Open."),
			default: true
		},
		'search.quickOpen.history.filterSortOrder': {
			'type': 'string',
			'enum': ['default', 'recency'],
			'default': 'default',
			'enumDescriptions': [
				nls.localize('filterSortOrder.default', 'History entries are sorted by relevance based on the filter value used. More relevant entries appear first.'),
				nls.localize('filterSortOrder.recency', 'History entries are sorted by recency. More recently opened entries appear first.')
			],
			'description': nls.localize('filterSortOrder', "Controls sorting order of editor history in quick open when filtering.")
		},
		'search.followSymlinks': {
			type: 'boolean',
			description: nls.localize('search.followSymlinks', "Controls whether to follow symlinks while searching."),
			default: true
		},
		'search.smartCase': {
			type: 'boolean',
			description: nls.localize('search.smartCase', "Search case-insensitively if the pattern is all lowercase, otherwise, search case-sensitively."),
			default: false
		},
		'search.globalFindClipboard': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.globalFindClipboard', "Controls whether the search view should read or modify the shared find clipboard on macOS."),
			included: platform.isMacintosh
		},
		'search.location': {
			type: 'string',
			enum: ['sidebar', 'panel'],
			default: 'sidebar',
			description: nls.localize('search.location', "Controls whether the search will be shown as a view in the sidebar or as a panel in the panel area for more horizontal space."),
			deprecationMessage: nls.localize('search.location.deprecationMessage', "This setting is deprecated. You can drag the search icon to a new location instead.")
		},
		'search.collapseResults': {
			type: 'string',
			enum: ['auto', 'alwaysCollapse', 'alwaysExpand'],
			enumDescriptions: [
				nls.localize('search.collapseResults.auto', "Files with less than 10 results are expanded. Others are collapsed."),
				'',
				''
			],
			default: 'alwaysExpand',
			description: nls.localize('search.collapseAllResults', "Controls whether the search results will be collapsed or expanded."),
		},
		'search.useReplacePreview': {
			type: 'boolean',
			default: true,
			description: nls.localize('search.useReplacePreview', "Controls whether to open Replace Preview when selecting or replacing a match."),
		},
		'search.showLineNumbers': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.showLineNumbers', "Controls whether to show line numbers for search results."),
		},
		'search.usePCRE2': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.usePCRE2', "Whether to use the PCRE2 regex engine in text search. This enables using some advanced regex features like lookahead and backreferences. However, not all PCRE2 features are supported - only features that are also supported by JavaScript."),
			deprecationMessage: nls.localize('usePCRE2Deprecated', "Deprecated. PCRE2 will be used automatically when using regex features that are only supported by PCRE2."),
		},
		'search.actionsPosition': {
			type: 'string',
			enum: ['auto', 'right'],
			enumDescriptions: [
				nls.localize('search.actionsPositionAuto', "Position the actionbar to the right when the search view is narrow, and immediately after the content when the search view is wide."),
				nls.localize('search.actionsPositionRight', "Always position the actionbar to the right."),
			],
			default: 'right',
			description: nls.localize('search.actionsPosition', "Controls the positioning of the actionbar on rows in the search view.")
		},
		'search.searchOnType': {
			type: 'boolean',
			default: true,
			description: nls.localize('search.searchOnType', "Search all files as you type.")
		},
		'search.seedWithNearestWord': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.seedWithNearestWord', "Enable seeding search from the word nearest the cursor when the active editor has no selection.")
		},
		'search.seedOnFocus': {
			type: 'boolean',
			default: false,
			description: nls.localize('search.seedOnFocus', "Update the search query to the editor's selected text when focusing the search view. This happens either on click or when triggering the `workbench.views.search.focus` command.")
		},
		'search.searchOnTypeDebouncePeriod': {
			type: 'number',
			default: 300,
			markdownDescription: nls.localize('search.searchOnTypeDebouncePeriod', "When `#search.searchOnType#` is enabled, controls the timeout in milliseconds between a character being typed and the search starting. Has no effect when `search.searchOnType` is disabled.")
		},
		'search.searchEditor.doubleClickBehaviour': {
			type: 'string',
			enum: ['selectWord', 'goToLocation', 'openLocationToSide'],
			default: 'goToLocation',
			enumDescriptions: [
				nls.localize('search.searchEditor.doubleClickBehaviour.selectWord', "Double clicking selects the word under the cursor."),
				nls.localize('search.searchEditor.doubleClickBehaviour.goToLocation', "Double clicking opens the result in the active editor group."),
				nls.localize('search.searchEditor.doubleClickBehaviour.openLocationToSide', "Double clicking opens the result in the editor group to the side, creating one if it does not yet exist."),
			],
			markdownDescription: nls.localize('search.searchEditor.doubleClickBehaviour', "Configure effect of double clicking a result in a search editor.")
		},
		'search.searchEditor.reusePriorSearchConfiguration': {
			type: 'boolean',
			default: false,
			markdownDescription: nls.localize({ key: 'search.searchEditor.reusePriorSearchConfiguration', comment: ['"Search Editor" is a type of editor that can display search results. "includes, excludes, and flags" refers to the "files to include" and "files to exclude" input boxes, and the flags that control whether a query is case-sensitive or a regex.'] }, "When enabled, new Search Editors will reuse the includes, excludes, and flags of the previously opened Search Editor.")
		},
		'search.searchEditor.defaultNumberOfContextLines': {
			type: ['number', 'null'],
			default: 1,
			markdownDescription: nls.localize('search.searchEditor.defaultNumberOfContextLines', "The default number of surrounding context lines to use when creating new Search Editors. If using `#search.searchEditor.reusePriorSearchConfiguration#`, this can be set to `null` (empty) to use the prior Search Editor's configuration.")
		},
		'search.sortOrder': {
			'type': 'string',
			'enum': [SearchSortOrder.Default, SearchSortOrder.FileNames, SearchSortOrder.Type, SearchSortOrder.Modified, SearchSortOrder.CountDescending, SearchSortOrder.CountAscending],
			'default': SearchSortOrder.Default,
			'enumDescriptions': [
				nls.localize('searchSortOrder.default', "Results are sorted by folder and file names, in alphabetical order."),
				nls.localize('searchSortOrder.filesOnly', "Results are sorted by file names ignoring folder order, in alphabetical order."),
				nls.localize('searchSortOrder.type', "Results are sorted by file extensions, in alphabetical order."),
				nls.localize('searchSortOrder.modified', "Results are sorted by file last modified date, in descending order."),
				nls.localize('searchSortOrder.countDescending', "Results are sorted by count per file, in descending order."),
				nls.localize('searchSortOrder.countAscending', "Results are sorted by count per file, in ascending order.")
			],
			'description': nls.localize('search.sortOrder', "Controls sorting order of search results.")
		}
	}
});

CommandsRegistry.registerCommand('_executeWorkspaceSymbolProvider', function (accessor, ...args) {
	const [query] = args;
	assertType(typeof query === 'string');
	return getWorkspaceSymbols(query);
});

// Go to menu

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '3_global_nav',
	command: {
		id: 'workbench.action.showAllSymbols',
		title: nls.localize({ key: 'miGotoSymbolInWorkspace', comment: ['&& denotes a mnemonic'] }, "Go to Symbol in &&Workspace...")
	},
	order: 2
});
