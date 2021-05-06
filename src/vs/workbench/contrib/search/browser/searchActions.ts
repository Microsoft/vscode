/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { ITreeNavigator } from 'vs/base/browser/ui/tree/tree';
import { Action } from 'vs/base/common/actions';
import { createKeybinding, ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { isWindows, OS } from 'vs/base/common/platform';
import * as nls from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ICommandHandler, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILabelService } from 'vs/platform/label/common/label';
import { getSelectionKeyboardEvent, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IViewsService } from 'vs/workbench/common/views';
import { searchRemoveIcon, searchReplaceAllIcon, searchReplaceIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import { SearchView } from 'vs/workbench/contrib/search/browser/searchView';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { ISearchHistoryService } from 'vs/workbench/contrib/search/common/searchHistoryService';
import { FileMatch, FolderMatch, FolderMatchWithResource, Match, RenderableMatch, searchMatchComparer, SearchResult } from 'vs/workbench/contrib/search/common/searchModel';
import { OpenEditorCommandId } from 'vs/workbench/contrib/searchEditor/browser/constants';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { OpenSearchEditorArgs } from 'vs/workbench/contrib/searchEditor/browser/searchEditor.contribution';
import { SearchEditorInput } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ISearchConfiguration, VIEW_ID } from 'vs/workbench/services/search/common/search';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

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

export const togglePreserveCaseCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	if (searchView) {
		searchView.togglePreserveCase();
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

	override async run(): Promise<any> {
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

	override async run(): Promise<any> {
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

	override run(): Promise<any> {
		return openSearchView(this.viewsService, false).then(openedView => {
			if (openedView) {
				const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
				searchAndReplaceWidget.toggleReplace(this.expandSearchReplaceWidget);

				const updatedText = openedView.updateTextFromFindWidgetOrSelection({ allowUnselectedWord: !this.expandSearchReplaceWidget });
				openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
			}
		});
	}
}
export interface IFindInFilesArgs {
	query?: string;
	replace?: string;
	preserveCase?: boolean;
	triggerSearch?: boolean;
	filesToInclude?: string;
	filesToExclude?: string;
	isRegex?: boolean;
	isCaseSensitive?: boolean;
	matchWholeWord?: boolean;
	useExcludeSettingsAndIgnoreFiles?: boolean;
}
export const FindInFilesCommand: ICommandHandler = (accessor, args: IFindInFilesArgs = {}) => {
	const searchConfig = accessor.get(IConfigurationService).getValue<ISearchConfiguration>().search;
	const mode = searchConfig.mode;
	if (mode === 'view') {
		const viewsService = accessor.get(IViewsService);
		openSearchView(viewsService, false).then(openedView => {
			if (openedView) {
				const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
				searchAndReplaceWidget.toggleReplace(typeof args.replace === 'string');
				let updatedText = false;
				if (typeof args.query === 'string') {
					openedView.setSearchParameters(args);
				} else {
					updatedText = openedView.updateTextFromFindWidgetOrSelection({ allowUnselectedWord: typeof args.replace !== 'string' });
				}
				openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
			}
		});
	} else {
		const convertArgs = (args: IFindInFilesArgs): OpenSearchEditorArgs => ({
			location: mode === 'newEditor' ? 'new' : 'reuse',
			query: args.query,
			filesToInclude: args.filesToInclude,
			filesToExclude: args.filesToExclude,
			matchWholeWord: args.matchWholeWord,
			isCaseSensitive: args.isCaseSensitive,
			isRegexp: args.isRegex,
			useExcludeSettingsAndIgnoreFiles: args.useExcludeSettingsAndIgnoreFiles,
			showIncludesExcludes: !!(args.filesToExclude || args.filesToExclude || !args.useExcludeSettingsAndIgnoreFiles),
		});
		accessor.get(ICommandService).executeCommand(OpenEditorCommandId, convertArgs(args));
	}
};

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

	override run(): Promise<any> {
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

	override run(): Promise<any> {
		const searchOnType = this.configurationService.getValue<boolean>(ToggleSearchOnTypeAction.searchOnTypeKey);
		return this.configurationService.updateValue(ToggleSearchOnTypeAction.searchOnTypeKey, !searchOnType);
	}
}

export function expandAll(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		const viewer = searchView.getControl();
		viewer.expandAll();
		viewer.domFocus();
		viewer.focusFirst();
	}
}

export function clearSearchResults(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		searchView.clearSearchResults();
	}
}

export function cancelSearch(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		searchView.cancelSearch();
	}
}

export function refreshSearch(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		searchView.triggerQueryChange({ preserveFocus: false });
	}
}

export function collapseDeepestExpandedLevel(accessor: ServicesAccessor) {

	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
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

	override async run(): Promise<any> {
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

	override async run(): Promise<any> {
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
		super('remove', RemoveAction.LABEL, ThemeIcon.asClassName(searchRemoveIcon));
	}

	override run(): Promise<any> {
		const currentFocusElement = this.viewer.getFocus()[0];
		const nextFocusElement = !currentFocusElement || currentFocusElement instanceof SearchResult || elementIsEqualOrParent(currentFocusElement, this.element) ?
			this.getElementToFocusAfterRemoved(this.viewer, this.element) :
			null;

		if (nextFocusElement) {
			this.viewer.reveal(nextFocusElement);
			this.viewer.setFocus([nextFocusElement], getSelectionKeyboardEvent());
			this.viewer.setSelection([nextFocusElement], getSelectionKeyboardEvent());
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
		super(Constants.ReplaceAllInFileActionId, appendKeyBindingLabel(ReplaceAllAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceAllInFileActionId), keyBindingService), ThemeIcon.asClassName(searchReplaceAllIcon));
	}

	override run(): Promise<any> {
		const tree = this.viewlet.getControl();
		const nextFocusElement = this.getElementToFocusAfterRemoved(tree, this.fileMatch);
		return this.fileMatch.parent().replace(this.fileMatch).then(() => {
			if (nextFocusElement) {
				tree.setFocus([nextFocusElement], getSelectionKeyboardEvent());
				tree.setSelection([nextFocusElement], getSelectionKeyboardEvent());
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
		super(Constants.ReplaceAllInFolderActionId, appendKeyBindingLabel(ReplaceAllInFolderAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceAllInFolderActionId), keyBindingService), ThemeIcon.asClassName(searchReplaceAllIcon));
	}

	override run(): Promise<any> {
		const nextFocusElement = this.getElementToFocusAfterRemoved(this.viewer, this.folderMatch);
		return this.folderMatch.replaceAll().then(() => {
			if (nextFocusElement) {
				this.viewer.setFocus([nextFocusElement], getSelectionKeyboardEvent());
				this.viewer.setSelection([nextFocusElement], getSelectionKeyboardEvent());
			}
			this.viewer.domFocus();
		});
	}
}

export class ReplaceAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('match.replace.label', "Replace");

	static runQ = Promise.resolve();

	constructor(private viewer: WorkbenchObjectTree<RenderableMatch>, private element: Match, private viewlet: SearchView,
		@IReplaceService private readonly replaceService: IReplaceService,
		@IKeybindingService keyBindingService: IKeybindingService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super(Constants.ReplaceActionId, appendKeyBindingLabel(ReplaceAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceActionId), keyBindingService), ThemeIcon.asClassName(searchReplaceIcon));
	}

	override async run(): Promise<any> {
		this.enabled = false;

		await this.element.parent().replace(this.element);
		const elementToFocus = this.getElementToFocusAfterReplace();
		if (elementToFocus) {
			this.viewer.setFocus([elementToFocus], getSelectionKeyboardEvent());
			this.viewer.setSelection([elementToFocus], getSelectionKeyboardEvent());
		}

		const elementToShowReplacePreview = this.getElementToShowReplacePreview(elementToFocus);
		this.viewer.domFocus();

		const useReplacePreview = this.configurationService.getValue<ISearchConfiguration>().search.useReplacePreview;
		if (!useReplacePreview || !elementToShowReplacePreview || this.hasToOpenFile()) {
			this.viewlet.open(this.element, true);
		} else {
			this.replaceService.openReplacePreview(elementToShowReplacePreview, true);
		}
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

	private getElementToShowReplacePreview(elementToFocus: RenderableMatch): Match | null {
		if (this.hasSameParent(elementToFocus)) {
			return <Match>elementToFocus;
		}
		const previousElement = this.getPreviousElementAfterRemoved(this.viewer, this.element);
		if (this.hasSameParent(previousElement)) {
			return <Match>previousElement;
		}
		return null;
	}

	private hasSameParent(element: RenderableMatch): boolean {
		return element && element instanceof Match && this.uriIdentityService.extUri.isEqual(element.parent().resource, this.element.parent().resource);
	}

	private hasToOpenFile(): boolean {
		const activeEditor = this.editorService.activeEditor;
		const file = activeEditor?.resource;
		if (file) {
			return this.uriIdentityService.extUri.isEqual(file, this.element.parent().resource);
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

			const paddingStr = ' '.repeat(largestPrefixSize - prefix.length);
			const indentStr = ' '.repeat(indent);
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
