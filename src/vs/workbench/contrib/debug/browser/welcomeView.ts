/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { StartAction, ConfigureAction, SelectAndStartAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IDebugService } from 'vs/workbench/contrib/debug/common/debug';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IViewDescriptorService, IViewsRegistry, Extensions, ViewContentPriority } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { WorkbenchStateContext } from 'vs/workbench/browser/contextkeys';
import { OpenFolderAction, OpenFileAction, OpenFileFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { isMacintosh } from 'vs/base/common/platform';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { DisposableStore } from 'vs/base/common/lifecycle';

const debugStartLanguageKey = 'debugStartLanguage';
const CONTEXT_DEBUG_START_LANGUAGE = new RawContextKey<string>(debugStartLanguageKey, undefined);
const CONTEXT_DEBUGGER_INTERESTED_IN_ACTIVE_EDITOR = new RawContextKey<boolean>('debuggerInterestedInActiveEditor', false);

export class WelcomeView extends ViewPane {

	static ID = 'workbench.debug.welcome';
	static LABEL = localize('run', "Run");

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
				if (language && this.debugService.getConfigurationManager().isDebuggerInterestedInLanguage(language)) {
					this.debugStartLanguageContext.set(language);
					this.debuggerInterestedContext.set(true);
					storageSevice.store(debugStartLanguageKey, language, StorageScope.WORKSPACE);
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
		this._register(this.debugService.getConfigurationManager().onDidRegisterDebugger(setContextKey));
		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible) {
				setContextKey();
			}
		}));
		setContextKey();

		const debugKeybinding = this.keybindingService.lookupKeybinding(StartAction.ID);
		debugKeybindingLabel = debugKeybinding ? ` (${debugKeybinding.getLabel()})` : '';
	}

	shouldShowWelcome(): boolean {
		return true;
	}
}

const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'openAFileWhichCanBeDebugged', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"[Open a file](command:{0}) which can be debugged or run.", isMacintosh ? OpenFileFolderAction.ID : OpenFileAction.ID),
	when: CONTEXT_DEBUGGER_INTERESTED_IN_ACTIVE_EDITOR.toNegated()
});

let debugKeybindingLabel = '';
viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'runAndDebugAction', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"[Run and Debug{0}](command:{1})", debugKeybindingLabel, StartAction.ID),
	preconditions: [CONTEXT_DEBUGGER_INTERESTED_IN_ACTIVE_EDITOR]
});

viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'detectThenRunAndDebug', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"[Show](command:{0}) all automatic debug configurations.", SelectAndStartAction.ID),
	priority: ViewContentPriority.Lowest
});

viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'customizeRunAndDebug', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"To customize Run and Debug [create a launch.json file](command:{0}).", ConfigureAction.ID),
	when: WorkbenchStateContext.notEqualsTo('empty')
});

viewsRegistry.registerViewWelcomeContent(WelcomeView.ID, {
	content: localize({ key: 'customizeRunAndDebugOpenFolder', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"To customize Run and Debug, [open a folder](command:{0}) and create a launch.json file.", isMacintosh ? OpenFileFolderAction.ID : OpenFolderAction.ID),
	when: WorkbenchStateContext.isEqualTo('empty')
});
