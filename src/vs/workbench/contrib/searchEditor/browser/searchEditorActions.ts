/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/searchEditor';
import { ICodeEditor, isDiffEditor } from 'vs/editor/browser/editorBrowser';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { SearchResult } from 'vs/workbench/contrib/search/common/searchModel';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { getOrMakeSearchEditorInput, SearchEditorInput } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { serializeSearchResultForEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { ISearchConfigurationProperties } from 'vs/workbench/services/search/common/search';
import { searchNewEditorIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { Schemas } from 'vs/base/common/network';
import { withNullAsUndefined, assertIsDefined } from 'vs/base/common/types';
import { OpenNewEditorCommandId } from 'vs/workbench/contrib/searchEditor/browser/constants';
import { OpenSearchEditorArgs } from 'vs/workbench/contrib/searchEditor/browser/searchEditor.contribution';
import { EditorsOrder } from 'vs/workbench/common/editor';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';

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

export class OpenSearchEditorAction extends Action {

	static readonly ID: string = OpenNewEditorCommandId;
	static readonly LABEL = localize('search.openNewEditor', "Open New Search Editor");

	constructor(id: string, label: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(id, label, ThemeIcon.asClassName(searchNewEditorIcon));
	}

	update() {
		// pass
	}

	get enabled(): boolean {
		return true;
	}

	async run() {
		await this.instantiationService.invokeFunction(openNewSearchEditor);
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

		const args: OpenSearchEditorArgs = { query: selected };
		Object.entries(_args).forEach(([name, value]) => {
			(args as any)[name as any] = (typeof value === 'string') ? configurationResolverService.resolve(lastActiveWorkspaceRoot, value) : value;
		});
		const existing = editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(id => id.editor.getTypeId() === SearchEditorInput.ID);
		let editor: SearchEditor;
		if (existing && args.location === 'reuse') {
			const input = existing.editor as SearchEditorInput;
			editor = assertIsDefined(await assertIsDefined(editorGroupsService.getGroup(existing.groupId)).openEditor(input)) as SearchEditor;
			if (selected) { editor.setQuery(selected); }
			else { editor.selectQuery(); }
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
	async (accessor: ServicesAccessor, searchResult: SearchResult, rawIncludePattern: string, rawExcludePattern: string) => {
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
