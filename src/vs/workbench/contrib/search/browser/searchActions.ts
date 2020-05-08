/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Action } from 'vs/base/common/actions';
import { createKeybinding, ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { isWindows, OS } from 'vs/base/common/platform';
import { repeat } from 'vs/base/common/strings';
import * as nls from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ILabelService } from 'vs/platform/label/common/label';
import { ICommandHandler } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { getSelectionKeyboardEvent, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { SearchView } from 'vs/workbench/contrib/search/browser/searchView';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { FolderMatch, FileMatch, FolderMatchWithResource, Match, RenderableMatch, searchMatchComparer, SearchResult } from 'vs/workbench/contrib/search/common/searchModel';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ISearchConfiguration, VIEW_ID, VIEWLET_ID } from 'vs/workbench/services/search/common/search';
import { ISearchHistoryService } from 'vs/workbench/contrib/search/common/searchHistoryService';
import { ITreeNavigator } from 'vs/base/browser/ui/tree/tree';
import { IViewsService } from 'vs/workbench/common/views';
import { SearchEditorInput } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { searchRefreshIcon, searchCollapseAllIcon, searchExpandAllIcon, searchClearIcon, searchReplaceAllIcon, searchReplaceIcon, searchRemoveIcon, searchStopIcon } from 'vs/workbench/contrib/search/browser/searchIcons';

export function isSearchViewFocused(viewsService: IViewsService): boolean {
	const searchView = getSearchView(viewsService);
	const activeElement = document.activeElement;
	return !!(searchView && activeElement && DOM.isAncestor(activeElement, searchView.getContainer()));
}

export function appendKeyBindingLabel(label: string, inputKeyBinding: number | ResolvedKeybinding | undefined, keyBindingService2: IKeybindingService): string {
	if (typeof inputKeyBinding === 'number') {
		const keybinding = createKeybinding(inputKeyBinding, OS);
		if (keybinding) {
			const resolvedKeybindings = keyBindingService2.resolveKeybinding(keybinding);
			return doAppendKeyBindingLabel(label, resolvedKeybindings.length > 0 ? resolvedKeybindings[0] : undefined);
		}
		return doAppendKeyBindingLabel(label, undefined);
	} else {
		return doAppendKeyBindingLabel(label, inputKeyBinding);
	}
}

export function openSearchView(viewsService: IViewsService, focus?: boolean): Promise<SearchView | undefined> {
	return viewsService.openView(VIEW_ID, focus).then(view => (view as SearchView ?? undefined));
}

export function getSearchView(viewsService: IViewsService): SearchView | undefined {
	return viewsService.getActiveViewWithId(VIEW_ID) as SearchView ?? undefined;
}

function doAppendKeyBindingLabel(label: string, keyBinding: ResolvedKeybinding | undefined): string {
	return keyBinding ? label + ' (' + keyBinding.getLabel() + ')' : label;
}

export const toggleCaseSensitiveCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	if (searchView) {
		searchView.toggleCaseSensitive();
	}
};

export const toggleWholeWordCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	if (searchView) {
		searchView.toggleWholeWords();
	}
};

export const toggleRegexCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	if (searchView) {
		searchView.toggleRegex();
	}
};

export class FocusNextInputAction extends Action {

	static readonly ID = 'search.focus.nextInputBox';

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			(this.editorService.activeEditorPane as SearchEditor).focusNextInput();
		}

		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.focusNextInputBox();
		}
	}
}

export class FocusPreviousInputAction extends Action {

	static readonly ID = 'search.focus.previousInputBox';

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			(this.editorService.activeEditorPane as SearchEditor).focusPrevInput();
		}

		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.focusPreviousInputBox();
		}
	}
}

export abstract class FindOrReplaceInFilesAction extends Action {

	constructor(id: string, label: string, protected viewsService: IViewsService,
		private expandSearchReplaceWidget: boolean
	) {
		super(id, label);
	}

	run(): Promise<any> {
		return openSearchView(this.viewsService, false).then(openedView => {
			if (openedView) {
				const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
				searchAndReplaceWidget.toggleReplace(this.expandSearchReplaceWidget);

				const updatedText = openedView.updateTextFromSelection({ allowUnselectedWord: !this.expandSearchReplaceWidget });
				openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
			}
		});
	}
}
export interface IFindInFilesArgs {
	query?: string;
	replace?: string;
	triggerSearch?: boolean;
	filesToInclude?: string;
	filesToExclude?: string;
	isRegex?: boolean;
	isCaseSensitive?: boolean;
	matchWholeWord?: boolean;
}
export const FindInFilesCommand: ICommandHandler = (accessor, args: IFindInFilesArgs = {}) => {

	const viewsService = accessor.get(IViewsService);
	openSearchView(viewsService, false).then(openedView => {
		if (openedView) {
			const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
			searchAndReplaceWidget.toggleReplace(typeof args.replace === 'string');
			let updatedText = false;
			if (typeof args.query === 'string') {
				openedView.setSearchParameters(args);
			} else {
				updatedText = openedView.updateTextFromSelection({ allowUnselectedWord: typeof args.replace !== 'string' });
			}
			openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
		}
	});
};

export class OpenSearchViewletAction extends FindOrReplaceInFilesAction {

	static readonly ID = VIEWLET_ID;
	static readonly LABEL = nls.localize('showSearch', "Show Search");

	constructor(id: string, label: string,
		@IViewsService viewsService: IViewsService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService) {
		super(id, label, viewsService, /*expandSearchReplaceWidget=*/false);
	}

	run(): Promise<any> {

		// Pass focus to viewlet if not open or focused
		if (this.otherViewletShowing() || !isSearchViewFocused(this.viewsService)) {
			return super.run();
		}

		// Otherwise pass focus to editor group
		this.editorGroupService.activeGroup.focus();

		return Promise.resolve(true);
	}

	private otherViewletShowing(): boolean {
		return !getSearchView(this.viewsService);
	}
}

export class ReplaceInFilesAction extends FindOrReplaceInFilesAction {

	static readonly ID = 'workbench.action.replaceInFiles';
	static readonly LABEL = nls.localize('replaceInFiles', "Replace in Files");

	constructor(id: string, label: string,
		@IViewsService viewsService: IViewsService) {
		super(id, label, viewsService, /*expandSearchReplaceWidget=*/true);
	}
}

export class CloseReplaceAction extends Action {

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.searchAndReplaceWidget.toggleReplace(false);
			searchView.searchAndReplaceWidget.focus();
		}
		return Promise.resolve(null);
	}
}

// --- Toggle Search On Type

export class ToggleSearchOnTypeAction extends Action {

	static readonly ID = 'workbench.action.toggleSearchOnType';
	static readonly LABEL = nls.localize('toggleTabs', "Toggle Search on Type");

	private static readonly searchOnTypeKey = 'search.searchOnType';

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		const searchOnType = this.configurationService.getValue<boolean>(ToggleSearchOnTypeAction.searchOnTypeKey);
		return this.configurationService.updateValue(ToggleSearchOnTypeAction.searchOnTypeKey, !searchOnType);
	}
}


export class RefreshAction extends Action {

	static readonly ID: string = 'search.action.refreshSearchResults';
	static LABEL: string = nls.localize('RefreshAction.label', "Refresh");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, 'search-action ' + searchRefreshIcon.classNames);
	}

	get enabled(): boolean {
		const searchView = getSearchView(this.viewsService);
		return !!searchView && searchView.hasSearchPattern();
	}

	update(): void {
		this._setEnabled(this.enabled);
	}

	run(): Promise<void> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.triggerQueryChange({ preserveFocus: false });
		}

		return Promise.resolve();
	}
}

export class CollapseDeepestExpandedLevelAction extends Action {

	static readonly ID: string = 'search.action.collapseSearchResults';
	static LABEL: string = nls.localize('CollapseDeepestExpandedLevelAction.label', "Collapse All");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, 'search-action ' + searchCollapseAllIcon.classNames);
		this.update();
	}

	update(): void {
		const searchView = getSearchView(this.viewsService);
		this.enabled = !!searchView && searchView.hasSearchResults();
	}

	run(): Promise<void> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			const viewer = searchView.getControl();

			/**
			 * one level to collapse so collapse everything. If FolderMatch, check if there are visible grandchildren,
			 * i.e. if Matches are returned by the navigator, and if so, collapse to them, otherwise collapse all levels.
			 */
			const navigator = viewer.navigate();
			let node = navigator.first();
			let collapseFileMatchLevel = false;
			if (node instanceof FolderMatch) {
				while (node = navigator.next()) {
					if (node instanceof Match) {
						collapseFileMatchLevel = true;
						break;
					}
				}
			}

			if (collapseFileMatchLevel) {
				node = navigator.first();
				do {
					if (node instanceof FileMatch) {
						viewer.collapse(node);
					}
				} while (node = navigator.next());
			} else {
				viewer.collapseAll();
			}

			viewer.domFocus();
			viewer.focusFirst();
		}
		return Promise.resolve(undefined);
	}
}

export class ExpandAllAction extends Action {

	static readonly ID: string = 'search.action.expandSearchResults';
	static LABEL: string = nls.localize('ExpandAllAction.label', "Expand All");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, 'search-action ' + searchExpandAllIcon.classNames);
		this.update();
	}

	update(): void {
		const searchView = getSearchView(this.viewsService);
		this.enabled = !!searchView && searchView.hasSearchResults();
	}

	run(): Promise<void> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			const viewer = searchView.getControl();
			viewer.expandAll();
			viewer.domFocus();
			viewer.focusFirst();
		}
		return Promise.resolve(undefined);
	}
}

export class ToggleCollapseAndExpandAction extends Action {
	static readonly ID: string = 'search.action.collapseOrExpandSearchResults';
	static LABEL: string = nls.localize('ToggleCollapseAndExpandAction.label', "Toggle Collapse and Expand");

	// Cache to keep from crawling the tree too often.
	private action: CollapseDeepestExpandedLevelAction | ExpandAllAction | undefined;

	constructor(id: string, label: string,
		private collapseAction: CollapseDeepestExpandedLevelAction,
		private expandAction: ExpandAllAction,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, collapseAction.class);
		this.update();
	}

	update(): void {
		const searchView = getSearchView(this.viewsService);
		this.enabled = !!searchView && searchView.hasSearchResults();
		this.onTreeCollapseStateChange();
	}

	onTreeCollapseStateChange() {
		this.action = undefined;
		this.determineAction();
	}

	private determineAction(): CollapseDeepestExpandedLevelAction | ExpandAllAction {
		if (this.action !== undefined) { return this.action; }
		this.action = this.isSomeCollapsible() ? this.collapseAction : this.expandAction;
		this.class = this.action.class;
		return this.action;
	}

	private isSomeCollapsible(): boolean {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			const viewer = searchView.getControl();
			const navigator = viewer.navigate();
			let node = navigator.first();
			do {
				if (!viewer.isCollapsed(node)) {
					return true;
				}
			} while (node = navigator.next());
		}
		return false;
	}


	async run(): Promise<void> {
		await this.determineAction().run();
	}
}

export class ClearSearchResultsAction extends Action {

	static readonly ID: string = 'search.action.clearSearchResults';
	static LABEL: string = nls.localize('ClearSearchResultsAction.label', "Clear Search Results");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, 'search-action ' + searchClearIcon.classNames);
		this.update();
	}

	update(): void {
		const searchView = getSearchView(this.viewsService);
		this.enabled = !!searchView && (!searchView.allSearchFieldsClear() || searchView.hasSearchResults());
	}

	run(): Promise<void> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.clearSearchResults();
		}
		return Promise.resolve();
	}
}

export class CancelSearchAction extends Action {

	static readonly ID: string = 'search.action.cancelSearch';
	static LABEL: string = nls.localize('CancelSearchAction.label', "Cancel Search");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label, 'search-action ' + searchStopIcon.classNames);
		this.update();
	}

	update(): void {
		const searchView = getSearchView(this.viewsService);
		this.enabled = !!searchView && searchView.isSlowSearch();
	}

	run(): Promise<void> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.cancelSearch();
		}

		return Promise.resolve(undefined);
	}
}

export class FocusNextSearchResultAction extends Action {
	static readonly ID = 'search.action.focusNextSearchResult';
	static readonly LABEL = nls.localize('FocusNextSearchResult.label', "Focus Next Search Result");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			return (this.editorService.activeEditorPane as SearchEditor).focusNextResult();
		}

		return openSearchView(this.viewsService).then(searchView => {
			if (searchView) {
				searchView.selectNextMatch();
			}
		});
	}
}

export class FocusPreviousSearchResultAction extends Action {
	static readonly ID = 'search.action.focusPreviousSearchResult';
	static readonly LABEL = nls.localize('FocusPreviousSearchResult.label', "Focus Previous Search Result");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			return (this.editorService.activeEditorPane as SearchEditor).focusPreviousResult();
		}

		return openSearchView(this.viewsService).then(searchView => {
			if (searchView) {
				searchView.selectPreviousMatch();
			}
		});
	}
}

export abstract class AbstractSearchAndReplaceAction extends Action {

	/**
	 * Returns element to focus after removing the given element
	 */
	getElementToFocusAfterRemoved(viewer: WorkbenchObjectTree<RenderableMatch>, elementToBeRemoved: RenderableMatch): RenderableMatch {
		const elementToFocus = this.getNextElementAfterRemoved(viewer, elementToBeRemoved);
		return elementToFocus || this.getPreviousElementAfterRemoved(viewer, elementToBeRemoved);
	}

	getNextElementAfterRemoved(viewer: WorkbenchObjectTree<RenderableMatch>, element: RenderableMatch): RenderableMatch {
		const navigator: ITreeNavigator<any> = viewer.navigate(element);
		if (element instanceof FolderMatch) {
			while (!!navigator.next() && !(navigator.current() instanceof FolderMatch)) { }
		} else if (element instanceof FileMatch) {
			while (!!navigator.next() && !(navigator.current() instanceof FileMatch)) { }
		} else {
			while (navigator.next() && !(navigator.current() instanceof Match)) {
				viewer.expand(navigator.current());
			}
		}
		return navigator.current();
	}

	getPreviousElementAfterRemoved(viewer: WorkbenchObjectTree<RenderableMatch>, element: RenderableMatch): RenderableMatch {
		const navigator: ITreeNavigator<any> = viewer.navigate(element);
		let previousElement = navigator.previous();

		// Hence take the previous element.
		const parent = element.parent();
		if (parent === previousElement) {
			previousElement = navigator.previous();
		}

		if (parent instanceof FileMatch && parent.parent() === previousElement) {
			previousElement = navigator.previous();
		}

		// If the previous element is a File or Folder, expand it and go to its last child.
		// Spell out the two cases, would be too easy to create an infinite loop, like by adding another level...
		if (element instanceof Match && previousElement && previousElement instanceof FolderMatch) {
			navigator.next();
			viewer.expand(previousElement);
			previousElement = navigator.previous();
		}

		if (element instanceof Match && previousElement && previousElement instanceof FileMatch) {
			navigator.next();
			viewer.expand(previousElement);
			previousElement = navigator.previous();
		}

		return previousElement;
	}
}

export class RemoveAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('RemoveAction.label', "Dismiss");

	constructor(
		private viewer: WorkbenchObjectTree<RenderableMatch>,
		private element: RenderableMatch
	) {
		super('remove', RemoveAction.LABEL, searchRemoveIcon.classNames);
	}

	run(): Promise<any> {
		const currentFocusElement = this.viewer.getFocus()[0];
		const nextFocusElement = !currentFocusElement || currentFocusElement instanceof SearchResult || elementIsEqualOrParent(currentFocusElement, this.element) ?
			this.getElementToFocusAfterRemoved(this.viewer, this.element) :
			null;

		if (nextFocusElement) {
			this.viewer.reveal(nextFocusElement);
			this.viewer.setFocus([nextFocusElement], getSelectionKeyboardEvent());
		}

		this.element.parent().remove(<any>this.element);
		this.viewer.domFocus();

		return Promise.resolve();
	}
}

function elementIsEqualOrParent(element: RenderableMatch, testParent: RenderableMatch | SearchResult): boolean {
	do {
		if (element === testParent) {
			return true;
		}
	} while (!(element.parent() instanceof SearchResult) && (element = <RenderableMatch>element.parent()));

	return false;
}

export class ReplaceAllAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('file.replaceAll.label', "Replace All");

	constructor(
		private viewlet: SearchView,
		private fileMatch: FileMatch,
		@IKeybindingService keyBindingService: IKeybindingService
	) {
		super(Constants.ReplaceAllInFileActionId, appendKeyBindingLabel(ReplaceAllAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceAllInFileActionId), keyBindingService), searchReplaceAllIcon.classNames);
	}

	run(): Promise<any> {
		const tree = this.viewlet.getControl();
		const nextFocusElement = this.getElementToFocusAfterRemoved(tree, this.fileMatch);
		return this.fileMatch.parent().replace(this.fileMatch).then(() => {
			if (nextFocusElement) {
				tree.setFocus([nextFocusElement], getSelectionKeyboardEvent());
			}

			tree.domFocus();
			this.viewlet.open(this.fileMatch, true);
		});
	}
}

export class ReplaceAllInFolderAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('file.replaceAll.label', "Replace All");

	constructor(private viewer: WorkbenchObjectTree<RenderableMatch>, private folderMatch: FolderMatch,
		@IKeybindingService keyBindingService: IKeybindingService
	) {
		super(Constants.ReplaceAllInFolderActionId, appendKeyBindingLabel(ReplaceAllInFolderAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceAllInFolderActionId), keyBindingService), searchReplaceAllIcon.classNames);
	}

	run(): Promise<any> {
		const nextFocusElement = this.getElementToFocusAfterRemoved(this.viewer, this.folderMatch);
		return this.folderMatch.replaceAll().then(() => {
			if (nextFocusElement) {
				this.viewer.setFocus([nextFocusElement], getSelectionKeyboardEvent());
			}
			this.viewer.domFocus();
		});
	}
}

export class ReplaceAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('match.replace.label', "Replace");

	constructor(private viewer: WorkbenchObjectTree<RenderableMatch>, private element: Match, private viewlet: SearchView,
		@IReplaceService private readonly replaceService: IReplaceService,
		@IKeybindingService keyBindingService: IKeybindingService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService) {
		super(Constants.ReplaceActionId, appendKeyBindingLabel(ReplaceAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceActionId), keyBindingService), searchReplaceIcon.classNames);
	}

	run(): Promise<any> {
		this.enabled = false;

		return this.element.parent().replace(this.element).then(() => {
			const elementToFocus = this.getElementToFocusAfterReplace();
			if (elementToFocus) {
				this.viewer.setFocus([elementToFocus], getSelectionKeyboardEvent());
			}

			return this.getElementToShowReplacePreview(elementToFocus);
		}).then(elementToShowReplacePreview => {
			this.viewer.domFocus();

			const useReplacePreview = this.configurationService.getValue<ISearchConfiguration>().search.useReplacePreview;
			if (!useReplacePreview || !elementToShowReplacePreview || this.hasToOpenFile()) {
				this.viewlet.open(this.element, true);
			} else {
				this.replaceService.openReplacePreview(elementToShowReplacePreview, true);
			}
		});
	}

	private getElementToFocusAfterReplace(): RenderableMatch {
		const navigator: ITreeNavigator<RenderableMatch | null> = this.viewer.navigate();
		let fileMatched = false;
		let elementToFocus: RenderableMatch | null = null;
		do {
			elementToFocus = navigator.current();
			if (elementToFocus instanceof Match) {
				if (elementToFocus.parent().id() === this.element.parent().id()) {
					fileMatched = true;
					if (this.element.range().getStartPosition().isBeforeOrEqual(elementToFocus.range().getStartPosition())) {
						// Closest next match in the same file
						break;
					}
				} else if (fileMatched) {
					// First match in the next file (if expanded)
					break;
				}
			} else if (fileMatched) {
				if (this.viewer.isCollapsed(elementToFocus)) {
					// Next file match (if collapsed)
					break;
				}
			}
		} while (!!navigator.next());
		return elementToFocus!;
	}

	private async getElementToShowReplacePreview(elementToFocus: RenderableMatch): Promise<Match | null> {
		if (this.hasSameParent(elementToFocus)) {
			return <Match>elementToFocus;
		}
		const previousElement = await this.getPreviousElementAfterRemoved(this.viewer, this.element);
		if (this.hasSameParent(previousElement)) {
			return <Match>previousElement;
		}
		return null;
	}

	private hasSameParent(element: RenderableMatch): boolean {
		return element && element instanceof Match && element.parent().resource === this.element.parent().resource;
	}

	private hasToOpenFile(): boolean {
		const activeEditor = this.editorService.activeEditor;
		const file = activeEditor ? activeEditor.resource : undefined;
		if (file) {
			return file.toString() === this.element.parent().resource.toString();
		}
		return false;
	}
}

export const copyPathCommand: ICommandHandler = async (accessor, fileMatch: FileMatch | FolderMatchWithResource | undefined) => {
	if (!fileMatch) {
		const selection = getSelectedRow(accessor);
		if (!(selection instanceof FileMatch || selection instanceof FolderMatchWithResource)) {
			return;
		}

		fileMatch = selection;
	}

	const clipboardService = accessor.get(IClipboardService);
	const labelService = accessor.get(ILabelService);

	const text = labelService.getUriLabel(fileMatch.resource, { noPrefix: true });
	await clipboardService.writeText(text);
};

function matchToString(match: Match, indent = 0): string {
	const getFirstLinePrefix = () => `${match.range().startLineNumber},${match.range().startColumn}`;
	const getOtherLinePrefix = (i: number) => match.range().startLineNumber + i + '';

	const fullMatchLines = match.fullPreviewLines();
	const largestPrefixSize = fullMatchLines.reduce((largest, _, i) => {
		const thisSize = i === 0 ?
			getFirstLinePrefix().length :
			getOtherLinePrefix(i).length;

		return Math.max(thisSize, largest);
	}, 0);

	const formattedLines = fullMatchLines
		.map((line, i) => {
			const prefix = i === 0 ?
				getFirstLinePrefix() :
				getOtherLinePrefix(i);

			const paddingStr = repeat(' ', largestPrefixSize - prefix.length);
			const indentStr = repeat(' ', indent);
			return `${indentStr}${prefix}: ${paddingStr}${line}`;
		});

	return formattedLines.join('\n');
}

const lineDelimiter = isWindows ? '\r\n' : '\n';
function fileMatchToString(fileMatch: FileMatch, maxMatches: number, labelService: ILabelService): { text: string, count: number } {
	const matchTextRows = fileMatch.matches()
		.sort(searchMatchComparer)
		.slice(0, maxMatches)
		.map(match => matchToString(match, 2));
	const uriString = labelService.getUriLabel(fileMatch.resource, { noPrefix: true });
	return {
		text: `${uriString}${lineDelimiter}${matchTextRows.join(lineDelimiter)}`,
		count: matchTextRows.length
	};
}

function folderMatchToString(folderMatch: FolderMatchWithResource | FolderMatch, maxMatches: number, labelService: ILabelService): { text: string, count: number } {
	const fileResults: string[] = [];
	let numMatches = 0;

	const matches = folderMatch.matches().sort(searchMatchComparer);

	for (let i = 0; i < folderMatch.fileCount() && numMatches < maxMatches; i++) {
		const fileResult = fileMatchToString(matches[i], maxMatches - numMatches, labelService);
		numMatches += fileResult.count;
		fileResults.push(fileResult.text);
	}

	return {
		text: fileResults.join(lineDelimiter + lineDelimiter),
		count: numMatches
	};
}

const maxClipboardMatches = 1e4;
export const copyMatchCommand: ICommandHandler = async (accessor, match: RenderableMatch | undefined) => {
	if (!match) {
		const selection = getSelectedRow(accessor);
		if (!selection) {
			return;
		}

		match = selection;
	}

	const clipboardService = accessor.get(IClipboardService);
	const labelService = accessor.get(ILabelService);

	let text: string | undefined;
	if (match instanceof Match) {
		text = matchToString(match);
	} else if (match instanceof FileMatch) {
		text = fileMatchToString(match, maxClipboardMatches, labelService).text;
	} else if (match instanceof FolderMatch) {
		text = folderMatchToString(match, maxClipboardMatches, labelService).text;
	}

	if (text) {
		await clipboardService.writeText(text);
	}
};

function allFolderMatchesToString(folderMatches: Array<FolderMatchWithResource | FolderMatch>, maxMatches: number, labelService: ILabelService): string {
	const folderResults: string[] = [];
	let numMatches = 0;
	folderMatches = folderMatches.sort(searchMatchComparer);
	for (let i = 0; i < folderMatches.length && numMatches < maxMatches; i++) {
		const folderResult = folderMatchToString(folderMatches[i], maxMatches - numMatches, labelService);
		if (folderResult.count) {
			numMatches += folderResult.count;
			folderResults.push(folderResult.text);
		}
	}

	return folderResults.join(lineDelimiter + lineDelimiter);
}

function getSelectedRow(accessor: ServicesAccessor): RenderableMatch | undefined | null {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	return searchView?.getControl().getSelection()[0];
}

export const copyAllCommand: ICommandHandler = async (accessor) => {
	const viewsService = accessor.get(IViewsService);
	const clipboardService = accessor.get(IClipboardService);
	const labelService = accessor.get(ILabelService);

	const searchView = getSearchView(viewsService);
	if (searchView) {
		const root = searchView.searchResult;

		const text = allFolderMatchesToString(root.folderMatches(), maxClipboardMatches, labelService);
		await clipboardService.writeText(text);
	}
};

export const clearHistoryCommand: ICommandHandler = accessor => {
	const searchHistoryService = accessor.get(ISearchHistoryService);
	searchHistoryService.clearHistory();
};

export const focusSearchListCommand: ICommandHandler = accessor => {
	const viewsService = accessor.get(IViewsService);
	openSearchView(viewsService).then(searchView => {
		if (searchView) {
			searchView.moveFocusToResults();
		}
	});
};
