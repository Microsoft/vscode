/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { assertIsDefined, withNullAsUndefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/searchEditor';
import { ICodeEditor, isDiffEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { EditorsOrder } from 'vs/workbench/common/editor';
import { IViewsService } from 'vs/workbench/common/views';
import { getSearchView } from 'vs/workbench/contrib/search/browser/searchActions';
import { SearchResult } from 'vs/workbench/contrib/search/common/searchModel';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { OpenSearchEditorArgs } from 'vs/workbench/contrib/searchEditor/browser/searchEditor.contribution';
import { getOrMakeSearchEditorInput, SearchEditorInput } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { serializeSearchResultForEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { ISearchConfigurationProperties } from 'vs/workbench/services/search/common/search';

export const toggleSearchEditorCaseSensitiveCommand = (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const input = editorService.activeEditor;
	if (input instanceof SearchEditorInput) {
		(editorService.activeEditorPane as SearchEditor).toggleCaseSensitive();
	}
};

export const toggleSearchEditorWholeWordCommand = (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const input = editorService.activeEditor;
	if (input instanceof SearchEditorInput) {
		(editorService.activeEditorPane as SearchEditor).toggleWholeWords();
	}
};

export const toggleSearchEditorRegexCommand = (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const input = editorService.activeEditor;
	if (input instanceof SearchEditorInput) {
		(editorService.activeEditorPane as SearchEditor).toggleRegex();
	}
};

export const toggleSearchEditorContextLinesCommand = (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const input = editorService.activeEditor;
	if (input instanceof SearchEditorInput) {
		(editorService.activeEditorPane as SearchEditor).toggleContextLines();
	}
};

export const modifySearchEditorContextLinesCommand = (accessor: ServicesAccessor, increase: boolean) => {
	const editorService = accessor.get(IEditorService);
	const input = editorService.activeEditor;
	if (input instanceof SearchEditorInput) {
		(editorService.activeEditorPane as SearchEditor).modifyContextLines(increase);
	}
};

export const selectAllSearchEditorMatchesCommand = (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const input = editorService.activeEditor;
	if (input instanceof SearchEditorInput) {
		(editorService.activeEditorPane as SearchEditor).focusAllResults();
	}
};

export async function openSearchEditor(accessor: ServicesAccessor): Promise<void> {
	const viewsService = accessor.get(IViewsService);
	const instantiationService = accessor.get(IInstantiationService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		await instantiationService.invokeFunction(openNewSearchEditor, {
			filesToInclude: searchView.searchIncludePattern.getValue(),
			onlyOpenEditors: searchView.searchIncludePattern.onlySearchInOpenEditors(),
			filesToExclude: searchView.searchExcludePattern.getValue(),
			isRegexp: searchView.searchAndReplaceWidget.searchInput.getRegex(),
			isCaseSensitive: searchView.searchAndReplaceWidget.searchInput.getCaseSensitive(),
			matchWholeWord: searchView.searchAndReplaceWidget.searchInput.getWholeWords(),
			useExcludeSettingsAndIgnoreFiles: searchView.searchExcludePattern.useExcludesAndIgnoreFiles(),
			showIncludesExcludes: !!(searchView.searchIncludePattern.getValue() || searchView.searchExcludePattern.getValue() || !searchView.searchExcludePattern.useExcludesAndIgnoreFiles())
		});
	} else {
		await instantiationService.invokeFunction(openNewSearchEditor);
	}
}

export const openNewSearchEditor =
	async (accessor: ServicesAccessor, _args: OpenSearchEditorArgs = {}, toSide = false) => {
		const editorService = accessor.get(IEditorService);
		const editorGroupsService = accessor.get(IEditorGroupsService);
		const telemetryService = accessor.get(ITelemetryService);
		const instantiationService = accessor.get(IInstantiationService);
		const configurationService = accessor.get(IConfigurationService);

		const configurationResolverService = accessor.get(IConfigurationResolverService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const historyService = accessor.get(IHistoryService);
		const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const lastActiveWorkspaceRoot = activeWorkspaceRootUri ? withNullAsUndefined(workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;


		const activeEditorControl = editorService.activeTextEditorControl;
		let activeModel: ICodeEditor | undefined;
		let selected = '';
		if (activeEditorControl) {
			if (isDiffEditor(activeEditorControl)) {
				if (activeEditorControl.getOriginalEditor().hasTextFocus()) {
					activeModel = activeEditorControl.getOriginalEditor();
				} else {
					activeModel = activeEditorControl.getModifiedEditor();
				}
			} else {
				activeModel = activeEditorControl as ICodeEditor;
			}
			const selection = activeModel?.getSelection();
			selected = (selection && activeModel?.getModel()?.getValueInRange(selection)) ?? '';
		} else {
			if (editorService.activeEditor instanceof SearchEditorInput) {
				const active = editorService.activeEditorPane as SearchEditor;
				selected = active.getSelected();
			}
		}

		telemetryService.publicLog2('searchEditor/openNewSearchEditor');

		const seedSearchStringFromSelection = _args.location === 'new' || configurationService.getValue<IEditorOptions>('editor').find!.seedSearchStringFromSelection;
		const args: OpenSearchEditorArgs = { query: seedSearchStringFromSelection ? selected : undefined };
		for (const entry of Object.entries(_args)) {
			const name = entry[0];
			const value = entry[1];
			if (value !== undefined) {
				(args as any)[name as any] = (typeof value === 'string') ? await configurationResolverService.resolveAsync(lastActiveWorkspaceRoot, value) : value;
			}
		}
		const existing = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(id => id.editor.typeId === SearchEditorInput.ID);
		let editor: SearchEditor;
		if (existing && args.location === 'reuse') {
			const input = existing.editor as SearchEditorInput;
			editor = assertIsDefined(await assertIsDefined(editorGroupsService.getGroup(existing.groupId)).openEditor(input)) as SearchEditor;
			if (selected) { editor.setQuery(selected); }
			else { editor.selectQuery(); }
			editor.setSearchConfig(args);
		} else {
			const input = instantiationService.invokeFunction(getOrMakeSearchEditorInput, { config: args, text: '' });
			editor = await editorService.openEditor(input, { pinned: true }, toSide ? SIDE_GROUP : ACTIVE_GROUP) as SearchEditor;
		}

		const searchOnType = configurationService.getValue<ISearchConfigurationProperties>('search').searchOnType;
		if (
			args.triggerSearch === true ||
			args.triggerSearch !== false && searchOnType && args.query
		) {
			editor.triggerSearch({ focusResults: args.focusResults });
		}

		if (!args.focusResults) { editor.focusSearchInput(); }
	};

export const createEditorFromSearchResult =
	async (accessor: ServicesAccessor, searchResult: SearchResult, rawIncludePattern: string, rawExcludePattern: string, onlySearchInOpenEditors: boolean) => {
		if (!searchResult.query) {
			console.error('Expected searchResult.query to be defined. Got', searchResult);
			return;
		}

		const editorService = accessor.get(IEditorService);
		const telemetryService = accessor.get(ITelemetryService);
		const instantiationService = accessor.get(IInstantiationService);
		const labelService = accessor.get(ILabelService);
		const configurationService = accessor.get(IConfigurationService);
		const sortOrder = configurationService.getValue<ISearchConfigurationProperties>('search').sortOrder;


		telemetryService.publicLog2('searchEditor/createEditorFromSearchResult');

		const labelFormatter = (uri: URI): string => labelService.getUriLabel(uri, { relative: true });

		const { text, matchRanges, config } = serializeSearchResultForEditor(searchResult, rawIncludePattern, rawExcludePattern, 0, labelFormatter, sortOrder);
		config.onlyOpenEditors = onlySearchInOpenEditors;
		const contextLines = configurationService.getValue<ISearchConfigurationProperties>('search').searchEditor.defaultNumberOfContextLines;

		if (searchResult.isDirty || contextLines === 0 || contextLines === null) {
			const input = instantiationService.invokeFunction(getOrMakeSearchEditorInput, { text, config });
			await editorService.openEditor(input, { pinned: true });
			input.setMatchRanges(matchRanges);
		} else {
			const input = instantiationService.invokeFunction(getOrMakeSearchEditorInput, { text: '', config: { ...config, contextLines } });
			const editor = await editorService.openEditor(input, { pinned: true }) as SearchEditor;
			editor.triggerSearch({ focusResults: true });
		}
	};
