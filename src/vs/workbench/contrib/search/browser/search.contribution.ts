/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { distinct } from 'vs/base/common/arrays';
import { illegalArgument, onUnexpectedError } from 'vs/base/common/errors';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import * as objects from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import { dirname } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { registerLanguageCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { getSelectionSearchString } from 'vs/editor/contrib/find/findController';
import { ToggleCaseSensitiveKeybinding, ToggleRegexKeybinding, ToggleWholeWordKeybinding } from 'vs/editor/contrib/find/findModel';
import * as nls from 'vs/nls';
import { ICommandAction, MenuId, MenuRegistry, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandHandler } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IFileService } from 'vs/platform/files/common/files';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IListService, WorkbenchListFocusContextKey, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { IQuickOpenService } from 'vs/platform/quickOpen/common/quickOpen';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as PanelExtensions, PanelDescriptor, PanelRegistry } from 'vs/workbench/browser/panel';
import { defaultQuickOpenContextKey } from 'vs/workbench/browser/parts/quickopen/quickopen';
import { Extensions as QuickOpenExtensions, IQuickOpenRegistry, QuickOpenHandlerDescriptor } from 'vs/workbench/browser/quickopen';
import { Extensions as ViewletExtensions, ViewletDescriptor, ViewletRegistry } from 'vs/workbench/browser/viewlet';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { Extensions as ViewExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { getMultiSelectedResources } from 'vs/workbench/contrib/files/browser/files';
import { ExplorerFolderContext, ExplorerRootContext, FilesExplorerFocusCondition, IExplorerService, VIEWLET_ID as VIEWLET_ID_FILES } from 'vs/workbench/contrib/files/common/files';
import { OpenAnythingHandler } from 'vs/workbench/contrib/search/browser/openAnythingHandler';
import { OpenSymbolHandler } from 'vs/workbench/contrib/search/browser/openSymbolHandler';
import { registerContributions as replaceContributions } from 'vs/workbench/contrib/search/browser/replaceContributions';
import { clearHistoryCommand, ClearSearchResultsAction, CloseReplaceAction, CollapseDeepestExpandedLevelAction, copyAllCommand, copyMatchCommand, copyPathCommand, FocusNextInputAction, FocusNextSearchResultAction, FocusPreviousInputAction, FocusPreviousSearchResultAction, focusSearchListCommand, getSearchView, openSearchView, OpenSearchViewletAction, RefreshAction, RemoveAction, ReplaceAction, ReplaceAllAction, ReplaceAllInFolderAction, ReplaceInFilesAction, toggleCaseSensitiveCommand, toggleRegexCommand, toggleWholeWordCommand, FindInFilesCommand, ToggleSearchOnTypeAction, OpenResultsInEditorAction, RerunEditorSearchAction } from 'vs/workbench/contrib/search/browser/searchActions';
import { SearchPanel } from 'vs/workbench/contrib/search/browser/searchPanel';
import { SearchView, SearchViewPosition } from 'vs/workbench/contrib/search/browser/searchView';
import { SearchViewlet } from 'vs/workbench/contrib/search/browser/searchViewlet';
import { registerContributions as searchWidgetContributions } from 'vs/workbench/contrib/search/browser/searchWidget';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { getWorkspaceSymbols } from 'vs/workbench/contrib/search/common/search';
import { ISearchHistoryService, SearchHistoryService } from 'vs/workbench/contrib/search/common/searchHistoryService';
import { FileMatchOrMatch, ISearchWorkbenchService, RenderableMatch, SearchWorkbenchService, FileMatch, Match, FolderMatch } from 'vs/workbench/contrib/search/common/searchModel';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { ISearchConfiguration, ISearchConfigurationProperties, PANEL_ID, VIEWLET_ID, VIEW_CONTAINER, VIEW_ID } from 'vs/workbench/services/search/common/search';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ExplorerViewlet } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';

registerSingleton(ISearchWorkbenchService, SearchWorkbenchService, true);
registerSingleton(ISearchHistoryService, SearchHistoryService, true);

replaceContributions();
searchWidgetContributions();

const category = nls.localize('search', "Search");

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.action.search.toggleQueryDetails',
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.SearchViewVisibleKey,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_J,
	handler: accessor => {
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
		if (searchView) {
			searchView.toggleQueryDetails();
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.FocusSearchFromResults,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FirstMatchFocusKey),
	primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
		if (searchView) {
			searchView.focusPreviousInputBox();
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
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			searchView.open(<FileMatchOrMatch>tree.getFocus()[0], false, true, true);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.CancelActionId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, WorkbenchListFocusContextKey),
	primary: KeyCode.Escape,
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
		if (searchView) {
			searchView.cancelSearch();
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
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
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
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
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
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
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
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
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
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.InputBoxFocusedKey),
	primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
	handler: (accessor, args: any) => {
		accessor.get(IInstantiationService).createInstance(FocusNextInputAction, FocusNextInputAction.ID, '').run();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: FocusPreviousInputAction.ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.InputBoxFocusedKey, Constants.SearchInputBoxFocusedKey.toNegated()),
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
	handler: (accessor, fileMatch: FileMatch) => {
		const viewletService = accessor.get(IViewletService);
		const explorerService = accessor.get(IExplorerService);
		const contextService = accessor.get(IWorkspaceContextService);
		const uri = fileMatch.resource;

		viewletService.openViewlet(VIEWLET_ID_FILES, false).then((viewlet: ExplorerViewlet) => {
			if (uri && contextService.isInsideWorkspace(uri)) {
				const explorerView = viewlet.getExplorerView();
				if (explorerView) {
					explorerView.setExpanded(true);
					explorerService.select(uri, true).then(() => explorerView.focus(), onUnexpectedError);
				}
			}
		});
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

const clearSearchHistoryLabel = nls.localize('clearSearchHistoryLabel', "Clear Search History");
const ClearSearchHistoryCommand: ICommandAction = {
	id: Constants.ClearSearchHistoryCommandId,
	title: clearSearchHistoryLabel,
	category
};
MenuRegistry.addCommand(ClearSearchHistoryCommand);

CommandsRegistry.registerCommand({
	id: Constants.ToggleSearchViewPositionCommandId,
	handler: (accessor) => {
		const configurationService = accessor.get(IConfigurationService);
		const currentValue = configurationService.getValue<ISearchConfigurationProperties>('search').location;
		const toggleValue = currentValue === 'sidebar' ? 'panel' : 'sidebar';

		configurationService.updateValue('search.location', toggleValue);
	}
});

const toggleSearchViewPositionLabel = nls.localize('toggleSearchViewPositionLabel', "Toggle Search View Position");
const ToggleSearchViewPositionCommand: ICommandAction = {
	id: Constants.ToggleSearchViewPositionCommandId,
	title: toggleSearchViewPositionLabel,
	category
};
MenuRegistry.addCommand(ToggleSearchViewPositionCommand);
MenuRegistry.appendMenuItem(MenuId.SearchContext, {
	command: ToggleSearchViewPositionCommand,
	when: Constants.SearchViewVisibleKey,
	group: 'search_9',
	order: 1
});

CommandsRegistry.registerCommand({
	id: Constants.FocusSearchListCommandID,
	handler: focusSearchListCommand
});

const focusSearchListCommandLabel = nls.localize('focusSearchListCommandLabel', "Focus List");
const FocusSearchListCommand: ICommandAction = {
	id: Constants.FocusSearchListCommandID,
	title: focusSearchListCommandLabel,
	category
};
MenuRegistry.addCommand(FocusSearchListCommand);

const searchInFolderCommand: ICommandHandler = (accessor, resource?: URI) => {
	const listService = accessor.get(IListService);
	const viewletService = accessor.get(IViewletService);
	const panelService = accessor.get(IPanelService);
	const fileService = accessor.get(IFileService);
	const configurationService = accessor.get(IConfigurationService);
	const resources = getMultiSelectedResources(resource, listService, accessor.get(IEditorService));

	return openSearchView(viewletService, panelService, configurationService, true).then(searchView => {
		if (resources && resources.length && searchView) {
			return fileService.resolveAll(resources.map(resource => ({ resource }))).then(results => {
				const folders: URI[] = [];

				results.forEach(result => {
					if (result.success && result.stat) {
						folders.push(result.stat.isDirectory ? result.stat.resource : dirname(result.stat.resource));
					}
				});

				searchView.searchInFolders(distinct(folders, folder => folder.toString()));
			});
		}

		return undefined;
	});
};

const FIND_IN_FOLDER_ID = 'filesExplorer.findInFolder';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: FIND_IN_FOLDER_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerFolderContext),
	primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_F,
	handler: searchInFolderCommand
});

CommandsRegistry.registerCommand({
	id: ClearSearchResultsAction.ID,
	handler: (accessor, args: any) => {
		accessor.get(IInstantiationService).createInstance(ClearSearchResultsAction, ClearSearchResultsAction.ID, '').run();
	}
});

CommandsRegistry.registerCommand({
	id: RefreshAction.ID,
	handler: (accessor, args: any) => {
		accessor.get(IInstantiationService).createInstance(RefreshAction, RefreshAction.ID, '').run();
	}
});

const FIND_IN_WORKSPACE_ID = 'filesExplorer.findInWorkspace';
CommandsRegistry.registerCommand({
	id: FIND_IN_WORKSPACE_ID,
	handler: (accessor) => {
		return openSearchView(accessor.get(IViewletService), accessor.get(IPanelService), accessor.get(IConfigurationService), true).then(searchView => {
			if (searchView) {
				searchView.searchInFolders();
			}
		});
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
		actionId: string, actionLabel: string,
		@IQuickOpenService private readonly quickOpenService: IQuickOpenService,
		@ICodeEditorService private readonly editorService: ICodeEditorService) {
		super(actionId, actionLabel);
		this.enabled = !!this.quickOpenService;
	}

	run(context?: any): Promise<void> {

		let prefix = ShowAllSymbolsAction.ALL_SYMBOLS_PREFIX;
		let inputSelection: { start: number; end: number; } | undefined = undefined;
		const editor = this.editorService.getFocusedCodeEditor();
		const word = editor && getSelectionSearchString(editor);
		if (word) {
			prefix = prefix + word;
			inputSelection = { start: 1, end: word.length + 1 };
		}

		this.quickOpenService.show(prefix, { inputSelection });

		return Promise.resolve(undefined);
	}
}

Registry.as<ViewletRegistry>(ViewletExtensions.Viewlets).registerViewlet(ViewletDescriptor.create(
	SearchViewlet,
	VIEWLET_ID,
	nls.localize('name', "Search"),
	'codicon-search',
	1
));

Registry.as<PanelRegistry>(PanelExtensions.Panels).registerPanel(PanelDescriptor.create(
	SearchPanel,
	PANEL_ID,
	nls.localize('name', "Search"),
	'search',
	10
));

class RegisterSearchViewContribution implements IWorkbenchContribution {

	constructor(
		@IViewletService viewletService: IViewletService,
		@IPanelService panelService: IPanelService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		const updateSearchViewLocation = (open: boolean) => {
			const config = configurationService.getValue<ISearchConfiguration>();
			if (config.search.location === 'panel') {
				viewsRegistry.deregisterViews(viewsRegistry.getViews(VIEW_CONTAINER), VIEW_CONTAINER);
				Registry.as<PanelRegistry>(PanelExtensions.Panels).registerPanel(PanelDescriptor.create(
					SearchPanel,
					PANEL_ID,
					nls.localize('name', "Search"),
					'search',
					10
				));
				if (open) {
					panelService.openPanel(PANEL_ID);
				}
			} else {
				Registry.as<PanelRegistry>(PanelExtensions.Panels).deregisterPanel(PANEL_ID);
				viewsRegistry.registerViews([{ id: VIEW_ID, name: nls.localize('search', "Search"), ctorDescriptor: { ctor: SearchView, arguments: [SearchViewPosition.SideBar] }, canToggleVisibility: false }], VIEW_CONTAINER);
				if (open) {
					viewletService.openViewlet(VIEWLET_ID);
				}
			}
		};
		configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('search.location')) {
				updateSearchViewLocation(true);
			}
		});

		updateSearchViewLocation(false);
	}
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(RegisterSearchViewContribution, LifecyclePhase.Starting);

// Actions
const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);

// Show Search and Find in Files are redundant, but we can't break keybindings by removing one. So it's the same action, same keybinding, registered to different IDs.
// Show Search 'when' is redundant but if the two conflict with exactly the same keybinding and 'when' clause, then they can show up as "unbound" - #51780
registry.registerWorkbenchAction(SyncActionDescriptor.create(OpenSearchViewletAction, VIEWLET_ID, OpenSearchViewletAction.LABEL, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_F }, Constants.SearchViewVisibleKey.toNegated()), 'View: Show Search', nls.localize('view', "View"));
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.FindInFilesActionId,
	weight: KeybindingWeight.WorkbenchContrib,
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

registry.registerWorkbenchAction(SyncActionDescriptor.create(FocusNextSearchResultAction, FocusNextSearchResultAction.ID, FocusNextSearchResultAction.LABEL, { primary: KeyCode.F4 }, ContextKeyExpr.and(Constants.HasSearchResults)), 'Focus Next Search Result', category);
registry.registerWorkbenchAction(SyncActionDescriptor.create(FocusPreviousSearchResultAction, FocusPreviousSearchResultAction.ID, FocusPreviousSearchResultAction.LABEL, { primary: KeyMod.Shift | KeyCode.F4 }, ContextKeyExpr.and(Constants.HasSearchResults)), 'Focus Previous Search Result', category);

registry.registerWorkbenchAction(SyncActionDescriptor.create(ReplaceInFilesAction, ReplaceInFilesAction.ID, ReplaceInFilesAction.LABEL, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_H }), 'Replace in Files', category);
MenuRegistry.appendMenuItem(MenuId.MenubarEditMenu, {
	group: '4_find_global',
	command: {
		id: ReplaceInFilesAction.ID,
		title: nls.localize({ key: 'miReplaceInFiles', comment: ['&& denotes a mnemonic'] }, "Replace &&in Files")
	},
	order: 2
});

KeybindingsRegistry.registerCommandAndKeybindingRule(objects.assign({
	id: Constants.ToggleCaseSensitiveCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.SearchViewFocusedKey, Constants.FileMatchOrFolderMatchFocusKey.toNegated()),
	handler: toggleCaseSensitiveCommand
}, ToggleCaseSensitiveKeybinding));

KeybindingsRegistry.registerCommandAndKeybindingRule(objects.assign({
	id: Constants.ToggleWholeWordCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.SearchViewFocusedKey),
	handler: toggleWholeWordCommand
}, ToggleWholeWordKeybinding));

KeybindingsRegistry.registerCommandAndKeybindingRule(objects.assign({
	id: Constants.ToggleRegexCommandId,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.SearchViewFocusedKey),
	handler: toggleRegexCommand
}, ToggleRegexKeybinding));

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.AddCursorsAtSearchResults,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.SearchViewVisibleKey, Constants.FileMatchOrMatchFocusKey),
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_L,
	handler: (accessor, args: any) => {
		const searchView = getSearchView(accessor.get(IViewletService), accessor.get(IPanelService));
		if (searchView) {
			const tree: WorkbenchObjectTree<RenderableMatch> = searchView.getControl();
			searchView.openEditorWithMultiCursor(<FileMatchOrMatch>tree.getFocus()[0]);
		}
	}
});

registry.registerWorkbenchAction(SyncActionDescriptor.create(CollapseDeepestExpandedLevelAction, CollapseDeepestExpandedLevelAction.ID, CollapseDeepestExpandedLevelAction.LABEL), 'Search: Collapse All', category);
registry.registerWorkbenchAction(SyncActionDescriptor.create(ShowAllSymbolsAction, ShowAllSymbolsAction.ID, ShowAllSymbolsAction.LABEL, { primary: KeyMod.CtrlCmd | KeyCode.KEY_T }), 'Go to Symbol in Workspace...');
registry.registerWorkbenchAction(SyncActionDescriptor.create(ToggleSearchOnTypeAction, ToggleSearchOnTypeAction.ID, ToggleSearchOnTypeAction.LABEL), 'Search: Toggle Search on Type', category);
registry.registerWorkbenchAction(SyncActionDescriptor.create(RefreshAction, RefreshAction.ID, RefreshAction.LABEL), 'Search: Refresh', category);
registry.registerWorkbenchAction(SyncActionDescriptor.create(ClearSearchResultsAction, ClearSearchResultsAction.ID, ClearSearchResultsAction.LABEL), 'Search: Clear Search Results', category);

registry.registerWorkbenchAction(
	SyncActionDescriptor.create(OpenResultsInEditorAction, OpenResultsInEditorAction.ID, OpenResultsInEditorAction.LABEL,
		{ mac: { primary: KeyMod.CtrlCmd | KeyCode.Enter } },
		ContextKeyExpr.and(Constants.HasSearchResults, Constants.SearchViewFocusedKey, Constants.EnableSearchEditorPreview)),
	'Search: Open Results in Editor', category,
	ContextKeyExpr.and(Constants.EnableSearchEditorPreview));

registry.registerWorkbenchAction(
	SyncActionDescriptor.create(RerunEditorSearchAction, RerunEditorSearchAction.ID, RerunEditorSearchAction.LABEL,
		{ primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KEY_R },
		ContextKeyExpr.and(EditorContextKeys.languageId.isEqualTo('search-result'))),
	'Search Editor: Search Again', category,
	ContextKeyExpr.and(EditorContextKeys.languageId.isEqualTo('search-result')));


// Register Quick Open Handler
Registry.as<IQuickOpenRegistry>(QuickOpenExtensions.Quickopen).registerDefaultQuickOpenHandler(
	QuickOpenHandlerDescriptor.create(
		OpenAnythingHandler,
		OpenAnythingHandler.ID,
		'',
		defaultQuickOpenContextKey,
		nls.localize('openAnythingHandlerDescription', "Go to File")
	)
);

Registry.as<IQuickOpenRegistry>(QuickOpenExtensions.Quickopen).registerQuickOpenHandler(
	QuickOpenHandlerDescriptor.create(
		OpenSymbolHandler,
		OpenSymbolHandler.ID,
		ShowAllSymbolsAction.ALL_SYMBOLS_PREFIX,
		'inWorkspaceSymbolsPicker',
		[
			{
				prefix: ShowAllSymbolsAction.ALL_SYMBOLS_PREFIX,
				needsEditor: false,
				description: nls.localize('openSymbolDescriptionNormal', "Go to Symbol in Workspace")
			}
		]
	)
);

// Configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'search',
	order: 13,
	title: nls.localize('searchConfigurationTitle', "Search"),
	type: 'object',
	properties: {
		'search.exclude': {
			type: 'object',
			markdownDescription: nls.localize('exclude', "Configure glob patterns for excluding files and folders in searches. Inherits all glob patterns from the `#files.exclude#` setting. Read more about glob patterns [here](https://code.visualstudio.com/docs/editor/codebasics#_advanced-search-options)."),
			default: { '**/node_modules': true, '**/bower_components': true },
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
		},
		'search.collapseResults': {
			type: 'string',
			enum: ['auto', 'alwaysCollapse', 'alwaysExpand'],
			enumDescriptions: [
				'Files with less than 10 results are expanded. Others are collapsed.',
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
			default: 'auto',
			description: nls.localize('search.actionsPosition', "Controls the positioning of the actionbar on rows in the search view.")
		},
		'search.expandableTokens': {
			type: 'object',
			markdownDescription: nls.localize('expandableTokens', "Configure tokens for quick search. Read more about expanding tokens [here](https://code.visualstudio.com/docs/editor/codebasics#_advanced-search-options)."),
			default: {
				'@config': ['**/*.config', 'src/**/*.cscfg'],
				'@deploy': ['**/deploy', '@config']
			},
			scope: ConfigurationScope.RESOURCE
		},
		'search.searchOnType': {
			type: 'boolean',
			default: true,
			description: nls.localize('search.searchOnType', "Search all files as you type.")
		},
		'search.searchOnTypeDebouncePeriod': {
			type: 'number',
			default: 300,
			markdownDescription: nls.localize('search.searchOnTypeDebouncePeriod', "When `#search.searchOnType#` is enabled, controls the timeout in milliseconds between a character being typed and the search starting. Has no effect when `search.searchOnType` is disabled.")
		}
	}
});

registerLanguageCommand('_executeWorkspaceSymbolProvider', function (accessor, args: { query: string; }) {
	const { query } = args;
	if (typeof query !== 'string') {
		throw illegalArgument();
	}
	return getWorkspaceSymbols(query);
});

// View menu

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '3_views',
	command: {
		id: VIEWLET_ID,
		title: nls.localize({ key: 'miViewSearch', comment: ['&& denotes a mnemonic'] }, "&&Search")
	},
	order: 2
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
