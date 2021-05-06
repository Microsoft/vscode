/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService, RawContextKey, IContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { IDebugService, CONTEXT_DEBUGGERS_AVAILABLE } from 'vs/workbench/contrib/debug/common/debug';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IViewDescriptorService, IViewsRegistry, Extensions, ViewContentGroups } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { WorkbenchStateContext } from 'vs/workbench/browser/contextkeys';
import { OpenFolderAction, OpenFileAction, OpenFileFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { SELECT_AND_START_ID, DEBUG_CONFIGURE_COMMAND_ID, DEBUG_START_COMMAND_ID } from 'vs/workbench/contrib/debug/browser/debugCommands';

const debugStartLanguageKey = 'debugStartLanguage';
const CONTEXT_DEBUG_START_LANGUAGE = new RawContextKey<string>(debugStartLanguageKey, undefined);
const CONTEXT_DEBUGGER_INTERESTED_IN_ACTIVE_EDITOR = new RawContextKey<boolean>('debuggerInterestedInActiveEditor', false);

export class WelcomeView extends ViewPane {

	static readonly ID = 'workbench.debug.welcome';
	static readonly LABEL = localize('run', "Run");

	private debugStartLanguageContext: IContextKey<string | undefined>;
	private debuggerInterestedContext: IContextKey<boolean>;

	constructor(
		options: IViewletViewOptions,
		@IThemeService themeService: IThemeService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IDebugService private readonly debugService: IDebugService,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IOpenerService openerService: IOpenerService,
		@IStorageService storageSevice: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this.debugStartLanguageContext = CONTEXT_DEBUG_START_LANGUAGE.bindTo(contextKeyService);
		this.debuggerInterestedContext = CONTEXT_DEBUGGER_INTERESTED_IN_ACTIVE_EDITOR.bindTo(contextKeyService);
		const lastSetLanguage = storageSevice.get(debugStartLanguageKey, StorageScope.WORKSPACE);
		this.debugStartLanguageContext.set(lastSetLanguage);

		const setContextKey = () => {
			const editorControl = this.editorService.activeTextEditorControl;
			if (isCodeEditor(editorControl)) {
				const model = editorControl.getModel();
				const language = model ? model.getLanguageIdentifier().language : undefined;
				if (language && this.debugService.getAdapterManager().isDebuggerInterestedInLanguage(language)) {
					this.debugStartLanguageContext.set(language);
					this.debuggerInterestedContext.set(true);
					storageSevice.store(debugStartLanguageKey, language, StorageScope.WORKSPACE, StorageTarget.MACHINE);
					return;
				}
			}
			this.debuggerInterestedContext.set(false);
		};

		const disposables = new DisposableStore();
		this._register(disposables);

		this._register(editorService.onDidActiveEditorChange(() => {
			disposables.clear();

			const editorControl = this.editorService.activeTextEditorControl;
			if (isCodeEditor(editorControl)) {
				disposables.add(editorControl.onDidChangeModelLanguage(setContextKey));
			}

			setContextKey();
		}));
		this._register(this.debugService.getAdapterManager().onDidRegisterDebugger(setContextKey));
		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				setContextKey();
			}
		}));
		setContextKey();

		const debugKeybinding = this.keybindingService.lookupKeybinding(DEBUG_START_COMMAND_ID);
		debugKeybindingLabel = debugKeybinding ? ` (${debugKeybinding.getLabel()})` : '';
	}

	override shouldShowWelcome(): boolean {
		return true;
	}
}

const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'openAFileWhichCanBeDebugged', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"[Open a file](command:{0}) which can be debugged or run.", (isMacintosh && !isWeb) ? OpenFileFolderAction.ID : OpenFileAction.ID),
	when: ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, CONTEXT_DEBUGGER_INTERESTED_IN_ACTIVE_EDITOR.toNegated()),
	group: ViewContentGroups.Open
});

let debugKeybindingLabel = '';
viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'runAndDebugAction', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"[Run and Debug{0}](command:{1})", debugKeybindingLabel, DEBUG_START_COMMAND_ID),
	when: CONTEXT_DEBUGGERS_AVAILABLE,
	group: ViewContentGroups.Debug
});

viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'detectThenRunAndDebug', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"[Show all automatic debug configurations](command:{0}).", SELECT_AND_START_ID),
	when: CONTEXT_DEBUGGERS_AVAILABLE,
	group: ViewContentGroups.Debug,
	order: 10
});

viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'customizeRunAndDebug', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"To customize Run and Debug [create a launch.json file](command:{0}).", DEBUG_CONFIGURE_COMMAND_ID),
	when: ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, WorkbenchStateContext.notEqualsTo('empty')),
	group: ViewContentGroups.Debug
});

viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'customizeRunAndDebugOpenFolder', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"To customize Run and Debug, [open a folder](command:{0}) and create a launch.json file.", (isMacintosh && !isWeb) ? OpenFileFolderAction.ID : OpenFolderAction.ID),
	when: ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, WorkbenchStateContext.isEqualTo('empty')),
	group: ViewContentGroups.Debug
});
