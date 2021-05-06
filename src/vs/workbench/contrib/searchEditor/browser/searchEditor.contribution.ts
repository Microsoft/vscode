/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { extname, isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Range } from 'vs/editor/common/core/range';
import { ToggleCaseSensitiveKeybinding, ToggleRegexKeybinding, ToggleWholeWordKeybinding } from 'vs/editor/contrib/find/findModel';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ContextKeyEqualsExpr, ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { EditorDescriptor, IEditorRegistry } from 'vs/workbench/browser/editor';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ActiveEditorContext, IEditorInputSerializer, IEditorInputFactoryRegistry, EditorExtensions } from 'vs/workbench/common/editor';
import { IViewsService } from 'vs/workbench/common/views';
import { getSearchView } from 'vs/workbench/contrib/search/browser/searchActions';
import { searchNewEditorIcon, searchRefreshIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import * as SearchConstants from 'vs/workbench/contrib/search/common/constants';
import * as SearchEditorConstants from 'vs/workbench/contrib/searchEditor/browser/constants';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { createEditorFromSearchResult, modifySearchEditorContextLinesCommand, openNewSearchEditor, openSearchEditor, selectAllSearchEditorMatchesCommand, toggleSearchEditorCaseSensitiveCommand, toggleSearchEditorContextLinesCommand, toggleSearchEditorRegexCommand, toggleSearchEditorWholeWordCommand } from 'vs/workbench/contrib/searchEditor/browser/searchEditorActions';
import { getOrMakeSearchEditorInput, SearchConfiguration, SearchEditorInput, SEARCH_EDITOR_EXT } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { parseSavedSearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { VIEW_ID } from 'vs/workbench/services/search/common/search';
import { EditorOverride } from 'vs/platform/editor/common/editor';
import { DEFAULT_EDITOR_ASSOCIATION } from 'vs/workbench/services/editor/common/editorOverrideService';
import { IWorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { Disposable } from 'vs/base/common/lifecycle';


const OpenInEditorCommandId = 'search.action.openInEditor';
const OpenNewEditorToSideCommandId = 'search.action.openNewEditorToSide';
const FocusQueryEditorWidgetCommandId = 'search.action.focusQueryEditorWidget';

const ToggleSearchEditorCaseSensitiveCommandId = 'toggleSearchEditorCaseSensitive';
const ToggleSearchEditorWholeWordCommandId = 'toggleSearchEditorWholeWord';
const ToggleSearchEditorRegexCommandId = 'toggleSearchEditorRegex';
const IncreaseSearchEditorContextLinesCommandId = 'increaseSearchEditorContextLines';
const DecreaseSearchEditorContextLinesCommandId = 'decreaseSearchEditorContextLines';

const RerunSearchEditorSearchCommandId = 'rerunSearchEditorSearch';
const CleanSearchEditorStateCommandId = 'cleanSearchEditorState';
const SelectAllSearchEditorMatchesCommandId = 'selectAllSearchEditorMatches';



//#region Editor Descriptior
Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		SearchEditor,
		SearchEditor.ID,
		localize('searchEditor', "Search Editor")
	),
	[
		new SyncDescriptor(SearchEditorInput)
	]
);
//#endregion

//#region Startup Contribution
class SearchEditorContribution implements IWorkbenchContribution {
	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@ITelemetryService protected readonly telemetryService: ITelemetryService,
		@IContextKeyService protected readonly contextKeyService: IContextKeyService,
	) {

		this.editorService.overrideOpenEditor({
			getEditorOverrides: (resource: URI) => {
				return extname(resource) === SEARCH_EDITOR_EXT ? [{
					id: SearchEditorInput.ID,
					label: localize('promptOpenWith.searchEditor.displayName', "Search Editor"),
					detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
					active: isEqual(this.editorService.activeEditor?.resource, resource) && this.editorService.activeEditor instanceof SearchEditorInput
				}] : [];
			},
			open: (editor, options, group) => {
				const resource = editor.resource;
				if (!resource) { return undefined; }

				if (extname(resource) !== SEARCH_EDITOR_EXT) {
					return undefined;
				}

				if (editor instanceof SearchEditorInput && group.contains(editor)) {
					return undefined;
				}

				this.telemetryService.publicLog2('searchEditor/openSavedSearchEditor');

				return {
					override: (async () => {
						const { config } = await instantiationService.invokeFunction(parseSavedSearchEditor, resource);
						const input = instantiationService.invokeFunction(getOrMakeSearchEditorInput, { backingUri: resource, config });
						return editorService.openEditor(input, { ...options, override: EditorOverride.DISABLED }, group);
					})()
				};
			}
		});
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(SearchEditorContribution, LifecyclePhase.Starting);
//#endregion

//#region Input Serializer
type SerializedSearchEditor = { modelUri: string | undefined, dirty: boolean, config: SearchConfiguration, name: string, matchRanges: Range[], backingUri: string };

class SearchEditorInputSerializer implements IEditorInputSerializer {

	canSerialize(input: SearchEditorInput) {
		return !!input.config;
	}

	serialize(input: SearchEditorInput) {
		if (input.isDisposed()) {
			return JSON.stringify({ modelUri: undefined, dirty: false, config: input.config, name: input.getName(), matchRanges: [], backingUri: input.backingUri?.toString() } as SerializedSearchEditor);
		}

		let modelUri = undefined;
		if (input.modelUri.path || input.modelUri.fragment) {
			modelUri = input.modelUri.toString();
		}
		if (!modelUri) { return undefined; }

		const config = input.config;
		const dirty = input.isDirty();
		const matchRanges = input.getMatchRanges();
		const backingUri = input.backingUri;

		return JSON.stringify({ modelUri, dirty, config, name: input.getName(), matchRanges, backingUri: backingUri?.toString() } as SerializedSearchEditor);
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): SearchEditorInput | undefined {
		const { modelUri, dirty, config, matchRanges, backingUri } = JSON.parse(serializedEditorInput) as SerializedSearchEditor;
		if (config && (config.query !== undefined)) {
			if (modelUri) {
				const input = instantiationService.invokeFunction(getOrMakeSearchEditorInput,
					{ config, modelUri: URI.parse(modelUri), backingUri: backingUri ? URI.parse(backingUri) : undefined });
				input.setDirty(dirty);
				input.setMatchRanges(matchRanges);
				return input;
			} else {
				if (backingUri) {
					return instantiationService.invokeFunction(getOrMakeSearchEditorInput,
						{ config, backingUri: URI.parse(backingUri) });
				} else {
					return instantiationService.invokeFunction(getOrMakeSearchEditorInput,
						{ config, text: '' });
				}
			}
		}
		return undefined;
	}
}

Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(
	SearchEditorInput.ID,
	SearchEditorInputSerializer);
//#endregion

//#region Commands
CommandsRegistry.registerCommand(
	CleanSearchEditorStateCommandId,
	(accessor: ServicesAccessor) => {
		const activeEditorPane = accessor.get(IEditorService).activeEditorPane;
		if (activeEditorPane instanceof SearchEditor) {
			activeEditorPane.cleanState();
		}
	});
//#endregion

//#region Actions
const category = { value: localize('search', "Search Editor"), original: 'Search Editor' };

export type LegacySearchEditorArgs = Partial<{
	query: string,
	includes: string,
	excludes: string,
	contextLines: number,
	wholeWord: boolean,
	caseSensitive: boolean,
	regexp: boolean,
	useIgnores: boolean,
	showIncludesExcludes: boolean,
	triggerSearch: boolean,
	focusResults: boolean,
	location: 'reuse' | 'new'
}>;

const translateLegacyConfig = (legacyConfig: LegacySearchEditorArgs & OpenSearchEditorArgs = {}): OpenSearchEditorArgs => {
	const config: OpenSearchEditorArgs = {};
	const overrides: { [K in keyof LegacySearchEditorArgs]: keyof OpenSearchEditorArgs } = {
		includes: 'filesToInclude',
		excludes: 'filesToExclude',
		wholeWord: 'matchWholeWord',
		caseSensitive: 'isCaseSensitive',
		regexp: 'isRegexp',
		useIgnores: 'useExcludeSettingsAndIgnoreFiles',
	};
	Object.entries(legacyConfig).forEach(([key, value]) => {
		(config as any)[(overrides as any)[key] ?? key] = value;
	});
	return config;
};

export type OpenSearchEditorArgs = Partial<SearchConfiguration & { triggerSearch: boolean, focusResults: boolean, location: 'reuse' | 'new' }>;
const openArgDescription = {
	description: 'Open a new search editor. Arguments passed can include variables like ${relativeFileDirname}.',
	args: [{
		name: 'Open new Search Editor args',
		schema: {
			properties: {
				query: { type: 'string' },
				filesToInclude: { type: 'string' },
				filesToExclude: { type: 'string' },
				contextLines: { type: 'number' },
				matchWholeWord: { type: 'boolean' },
				isCaseSensitive: { type: 'boolean' },
				isRegexp: { type: 'boolean' },
				useExcludeSettingsAndIgnoreFiles: { type: 'boolean' },
				showIncludesExcludes: { type: 'boolean' },
				triggerSearch: { type: 'boolean' },
				focusResults: { type: 'boolean' },
			}
		}
	}]
} as const;

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'search.searchEditor.action.deleteFileResults',
			title: { value: localize('searchEditor.deleteResultBlock', "Delete File Results"), original: 'Delete File Results' },
			keybinding: {
				weight: KeybindingWeight.EditorContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Backspace,
			},
			precondition: SearchEditorConstants.InSearchEditor,
			category,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor) {
		const contextService = accessor.get(IContextKeyService).getContext(document.activeElement);
		if (contextService.getValue(SearchEditorConstants.InSearchEditor.serialize())) {
			(accessor.get(IEditorService).activeEditorPane as SearchEditor).deleteResultBlock();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SearchEditorConstants.OpenNewEditorCommandId,
			title: { value: localize('search.openNewSearchEditor', "New Search Editor"), original: 'New Search Editor' },
			category,
			f1: true,
			description: openArgDescription
		});
	}
	async run(accessor: ServicesAccessor, args: LegacySearchEditorArgs | OpenSearchEditorArgs) {
		await accessor.get(IInstantiationService).invokeFunction(openNewSearchEditor, translateLegacyConfig({ location: 'new', ...args }));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SearchEditorConstants.OpenEditorCommandId,
			title: { value: localize('search.openSearchEditor', "Open Search Editor"), original: 'Open Search Editor' },
			category,
			f1: true,
			description: openArgDescription
		});
	}
	async run(accessor: ServicesAccessor, args: LegacySearchEditorArgs | OpenSearchEditorArgs) {
		await accessor.get(IInstantiationService).invokeFunction(openNewSearchEditor, translateLegacyConfig({ location: 'reuse', ...args }));
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OpenNewEditorToSideCommandId,
			title: { value: localize('search.openNewEditorToSide', "Open new Search Editor to the Side"), original: 'Open new Search Editor to the Side' },
			category,
			f1: true,
			description: openArgDescription
		});
	}
	async run(accessor: ServicesAccessor, args: LegacySearchEditorArgs | OpenSearchEditorArgs) {
		await accessor.get(IInstantiationService).invokeFunction(openNewSearchEditor, translateLegacyConfig(args), true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: OpenInEditorCommandId,
			title: { value: localize('search.openResultsInEditor', "Open Results in Editor"), original: 'Open Results in Editor' },
			category,
			f1: true,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.Enter,
				when: ContextKeyExpr.and(SearchConstants.HasSearchResults, SearchConstants.SearchViewFocusedKey),
				weight: KeybindingWeight.WorkbenchContrib,
				mac: {
					primary: KeyMod.CtrlCmd | KeyCode.Enter
				}
			},
		});
	}
	async run(accessor: ServicesAccessor) {
		const viewsService = accessor.get(IViewsService);
		const instantiationService = accessor.get(IInstantiationService);
		const searchView = getSearchView(viewsService);
		if (searchView) {
			await instantiationService.invokeFunction(createEditorFromSearchResult, searchView.searchResult, searchView.searchIncludePattern.getValue(), searchView.searchExcludePattern.getValue(), searchView.searchIncludePattern.onlySearchInOpenEditors());
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RerunSearchEditorSearchCommandId,
			title: { value: localize('search.rerunSearchInEditor', "Search Again"), original: 'Search Again' },
			category,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_R,
				when: SearchEditorConstants.InSearchEditor,
				weight: KeybindingWeight.EditorContrib
			},
			icon: searchRefreshIcon,
			menu: [{
				id: MenuId.EditorTitle,
				group: 'navigation',
				when: ActiveEditorContext.isEqualTo(SearchEditorConstants.SearchEditorID)
			},
			{
				id: MenuId.CommandPalette,
				when: ActiveEditorContext.isEqualTo(SearchEditorConstants.SearchEditorID)
			}]
		});
	}
	async run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const input = editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			(editorService.activeEditorPane as SearchEditor).triggerSearch({ resetCursor: false });
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: FocusQueryEditorWidgetCommandId,
			title: { value: localize('search.action.focusQueryEditorWidget', "Focus Search Editor Input"), original: 'Focus Search Editor Input' },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: {
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const input = editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			(editorService.activeEditorPane as SearchEditor).focusSearchInput();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ToggleSearchEditorCaseSensitiveCommandId,
			title: { value: localize('searchEditor.action.toggleSearchEditorCaseSensitive', "Toggle Match Case"), original: 'Toggle Match Case' },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: Object.assign({
				weight: KeybindingWeight.WorkbenchContrib,
				when: SearchConstants.SearchInputBoxFocusedKey,
			}, ToggleCaseSensitiveKeybinding)
		});
	}
	run(accessor: ServicesAccessor) {
		toggleSearchEditorCaseSensitiveCommand(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ToggleSearchEditorWholeWordCommandId,
			title: { value: localize('searchEditor.action.toggleSearchEditorWholeWord', "Toggle Match Whole Word"), original: 'Toggle Match Whole Word' },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: Object.assign({
				weight: KeybindingWeight.WorkbenchContrib,
				when: SearchConstants.SearchInputBoxFocusedKey,
			}, ToggleWholeWordKeybinding)
		});
	}
	run(accessor: ServicesAccessor) {
		toggleSearchEditorWholeWordCommand(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ToggleSearchEditorRegexCommandId,
			title: { value: localize('searchEditor.action.toggleSearchEditorRegex', "Toggle Use Regular Expression"), original: 'Toggle Use Regular Expression"' },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: Object.assign({
				weight: KeybindingWeight.WorkbenchContrib,
				when: SearchConstants.SearchInputBoxFocusedKey,
			}, ToggleRegexKeybinding)
		});
	}
	run(accessor: ServicesAccessor) {
		toggleSearchEditorRegexCommand(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SearchEditorConstants.ToggleSearchEditorContextLinesCommandId,
			title: { value: localize('searchEditor.action.toggleSearchEditorContextLines', "Toggle Context Lines"), original: 'Toggle Context Lines"' },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Alt | KeyCode.KEY_L,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_L }
			}
		});
	}
	run(accessor: ServicesAccessor) {
		toggleSearchEditorContextLinesCommand(accessor);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: IncreaseSearchEditorContextLinesCommandId,
			title: { original: 'Increase Context Lines', value: localize('searchEditor.action.increaseSearchEditorContextLines', "Increase Context Lines") },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Alt | KeyCode.US_EQUAL
			}
		});
	}
	run(accessor: ServicesAccessor) { modifySearchEditorContextLinesCommand(accessor, true); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: DecreaseSearchEditorContextLinesCommandId,
			title: { original: 'Decrease Context Lines', value: localize('searchEditor.action.decreaseSearchEditorContextLines', "Decrease Context Lines") },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Alt | KeyCode.US_MINUS
			}
		});
	}
	run(accessor: ServicesAccessor) { modifySearchEditorContextLinesCommand(accessor, false); }
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SelectAllSearchEditorMatchesCommandId,
			title: { original: 'Select All Matches', value: localize('searchEditor.action.selectAllSearchEditorMatches', "Select All Matches") },
			category,
			f1: true,
			precondition: SearchEditorConstants.InSearchEditor,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_L,
			}
		});
	}
	run(accessor: ServicesAccessor) {
		selectAllSearchEditorMatchesCommand(accessor);
	}
});

registerAction2(class OpenSearchEditorAction extends Action2 {
	constructor() {
		super({
			id: 'search.action.openNewEditorFromView',
			title: localize('search.openNewEditor', "Open New Search Editor from View"),
			category,
			icon: searchNewEditorIcon,
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 2,
				when: ContextKeyEqualsExpr.create('view', VIEW_ID),
			}]
		});
	}
	run(accessor: ServicesAccessor, ...args: any[]) {
		return openSearchEditor(accessor);
	}
});
//#endregion

//#region Search Editor Working Copy Editor Handler
class SearchEditorWorkingCopyEditorHandler extends Disposable implements IWorkbenchContribution {

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkingCopyEditorService private readonly workingCopyEditorService: IWorkingCopyEditorService,
	) {
		super();

		this.installHandler();
	}

	private installHandler(): void {
		this._register(this.workingCopyEditorService.registerHandler({
			handles: workingCopy => {
				return workingCopy.resource.scheme === SearchEditorConstants.SearchEditorScheme;
			},
			isOpen: (workingCopy, editor) => {
				return editor instanceof SearchEditorInput && isEqual(workingCopy.resource, editor.modelUri);
			},
			createEditor: workingCopy => {
				const input = this.instantiationService.invokeFunction(getOrMakeSearchEditorInput, { modelUri: workingCopy.resource, config: {} });
				input.setDirty(true);

				return input;
			}
		}));
	}
}

workbenchContributionsRegistry.registerWorkbenchContribution(SearchEditorWorkingCopyEditorHandler, LifecyclePhase.Ready);
//#endregion
