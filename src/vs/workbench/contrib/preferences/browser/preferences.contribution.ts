/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/preferences';
import { Context as SuggestContext } from 'vs/editor/contrib/suggest/suggest';
import * as nls from 'vs/nls';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IsMacNativeContext } from 'vs/platform/contextkey/common/contextkeys';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ILabelService } from 'vs/platform/label/common/label';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkspaceContextService, IWorkspaceFolder, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { PICK_WORKSPACE_FOLDER_COMMAND_ID } from 'vs/workbench/browser/actions/workspaceCommands';
import { RemoteNameContext, WorkbenchStateContext } from 'vs/workbench/browser/contextkeys';
import { EditorDescriptor, IEditorRegistry } from 'vs/workbench/browser/editor';
import { AbstractSideBySideEditorInputSerializer } from 'vs/workbench/browser/parts/editor/editor.contribution';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { EditorInput, IEditorInputSerializer, IEditorInputFactoryRegistry, EditorExtensions } from 'vs/workbench/common/editor';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { ExplorerFolderContext, ExplorerRootContext } from 'vs/workbench/contrib/files/common/files';
import { KeybindingsEditor } from 'vs/workbench/contrib/preferences/browser/keybindingsEditor';
import { ConfigureLanguageBasedSettingsAction } from 'vs/workbench/contrib/preferences/browser/preferencesActions';
import { PreferencesEditor } from 'vs/workbench/contrib/preferences/browser/preferencesEditor';
import { SettingsEditor2, SettingsFocusContext } from 'vs/workbench/contrib/preferences/browser/settingsEditor2';
import { CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDINGS_SEARCH_FOCUS, CONTEXT_KEYBINDING_FOCUS, CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_JSON_EDITOR, CONTEXT_SETTINGS_ROW_FOCUS, CONTEXT_SETTINGS_SEARCH_FOCUS, CONTEXT_TOC_ROW_FOCUS, KEYBINDINGS_EDITOR_COMMAND_ADD, KEYBINDINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, KEYBINDINGS_EDITOR_COMMAND_COPY, KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND, KEYBINDINGS_EDITOR_COMMAND_DEFINE, KEYBINDINGS_EDITOR_COMMAND_DEFINE_WHEN, KEYBINDINGS_EDITOR_COMMAND_FOCUS_KEYBINDINGS, KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS, KEYBINDINGS_EDITOR_COMMAND_REMOVE, KEYBINDINGS_EDITOR_COMMAND_RESET, KEYBINDINGS_EDITOR_COMMAND_SEARCH, KEYBINDINGS_EDITOR_COMMAND_SHOW_SIMILAR, KEYBINDINGS_EDITOR_COMMAND_SORTBY_PRECEDENCE, KEYBINDINGS_EDITOR_SHOW_DEFAULT_KEYBINDINGS, KEYBINDINGS_EDITOR_SHOW_EXTENSION_KEYBINDINGS, KEYBINDINGS_EDITOR_SHOW_USER_KEYBINDINGS, MODIFIED_SETTING_TAG, SETTINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU, REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG } from 'vs/workbench/contrib/preferences/common/preferences';
import { PreferencesContribution } from 'vs/workbench/contrib/preferences/common/preferencesContribution';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { DefaultPreferencesEditorInput, KeybindingsEditorInput, PreferencesEditorInput, SettingsEditor2Input } from 'vs/workbench/services/preferences/browser/preferencesEditorInput';
import { preferencesOpenSettingsIcon } from 'vs/workbench/contrib/preferences/browser/preferencesIcons';

const SETTINGS_EDITOR_COMMAND_SEARCH = 'settings.action.search';

const SETTINGS_EDITOR_COMMAND_FOCUS_NEXT_SETTING = 'settings.action.focusNextSetting';
const SETTINGS_EDITOR_COMMAND_FOCUS_PREVIOUS_SETTING = 'settings.action.focusPreviousSetting';
const SETTINGS_EDITOR_COMMAND_FOCUS_FILE = 'settings.action.focusSettingsFile';
const SETTINGS_EDITOR_COMMAND_EDIT_FOCUSED_SETTING = 'settings.action.editFocusedSetting';
const SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_FROM_SEARCH = 'settings.action.focusSettingsFromSearch';
const SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_LIST = 'settings.action.focusSettingsList';
const SETTINGS_EDITOR_COMMAND_FOCUS_TOC = 'settings.action.focusTOC';
const SETTINGS_EDITOR_COMMAND_FOCUS_CONTROL = 'settings.action.focusSettingControl';
const SETTINGS_EDITOR_COMMAND_FOCUS_UP = 'settings.action.focusLevelUp';

const SETTINGS_EDITOR_COMMAND_SWITCH_TO_JSON = 'settings.switchToJSON';
const SETTINGS_EDITOR_COMMAND_FILTER_MODIFIED = 'settings.filterByModified';
const SETTINGS_EDITOR_COMMAND_FILTER_ONLINE = 'settings.filterByOnline';
const SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED = 'settings.filterUntrusted';

const SETTINGS_COMMAND_OPEN_SETTINGS = 'workbench.action.openSettings';

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		PreferencesEditor,
		PreferencesEditor.ID,
		nls.localize('defaultPreferencesEditor', "Default Preferences Editor")
	),
	[
		new SyncDescriptor(PreferencesEditorInput)
	]
);

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		SettingsEditor2,
		SettingsEditor2.ID,
		nls.localize('settingsEditor2', "Settings Editor 2")
	),
	[
		new SyncDescriptor(SettingsEditor2Input)
	]
);

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		KeybindingsEditor,
		KeybindingsEditor.ID,
		nls.localize('keybindingsEditor', "Keybindings Editor")
	),
	[
		new SyncDescriptor(KeybindingsEditorInput)
	]
);

// Register Preferences Editor Input Serializer
class PreferencesEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {

	protected createEditorInput(instantiationService: IInstantiationService, name: string, description: string | undefined, secondaryInput: EditorInput, primaryInput: EditorInput): EditorInput {
		return new PreferencesEditorInput(name, description, secondaryInput, primaryInput);
	}
}

class KeybindingsEditorInputSerializer implements IEditorInputSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(editorInput: EditorInput): string {
		const input = <KeybindingsEditorInput>editorInput;
		return JSON.stringify({
			name: input.getName(),
			typeId: input.typeId
		});
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput {
		return instantiationService.createInstance(KeybindingsEditorInput);
	}
}

class SettingsEditor2InputSerializer implements IEditorInputSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: SettingsEditor2Input): string {
		return '{}';
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): SettingsEditor2Input {
		return instantiationService.createInstance(SettingsEditor2Input);
	}
}

interface ISerializedDefaultPreferencesEditorInput {
	resource: string;
}

// Register Default Preferences Editor Input Serializer
class DefaultPreferencesEditorInputSerializer implements IEditorInputSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(editorInput: EditorInput): string {
		const input = <DefaultPreferencesEditorInput>editorInput;

		const serialized: ISerializedDefaultPreferencesEditorInput = { resource: input.resource.toString() };

		return JSON.stringify(serialized);
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput {
		const deserialized: ISerializedDefaultPreferencesEditorInput = JSON.parse(serializedEditorInput);

		return instantiationService.createInstance(DefaultPreferencesEditorInput, URI.parse(deserialized.resource));
	}
}

Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(PreferencesEditorInput.ID, PreferencesEditorInputSerializer);
Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(DefaultPreferencesEditorInput.ID, DefaultPreferencesEditorInputSerializer);
Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(KeybindingsEditorInput.ID, KeybindingsEditorInputSerializer);
Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(SettingsEditor2Input.ID, SettingsEditor2InputSerializer);

const OPEN_SETTINGS2_ACTION_TITLE = { value: nls.localize('openSettings2', "Open Settings (UI)"), original: 'Open Settings (UI)' };

const category = { value: nls.localize('preferences', "Preferences"), original: 'Preferences' };

class PreferencesActionsContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILabelService private readonly labelService: ILabelService,
		@IExtensionService private readonly extensionService: IExtensionService,
	) {
		super();

		this.registerSettingsActions();
		this.registerKeybindingsActions();

		this.updatePreferencesEditorMenuItem();
		this._register(workspaceContextService.onDidChangeWorkbenchState(() => this.updatePreferencesEditorMenuItem()));
		this._register(workspaceContextService.onDidChangeWorkspaceFolders(() => this.updatePreferencesEditorMenuItemForWorkspaceFolders()));
	}

	private registerSettingsActions() {
		const that = this;
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_COMMAND_OPEN_SETTINGS,
					title: nls.localize('settings', "Settings"),
					keybinding: {
						weight: KeybindingWeight.WorkbenchContrib,
						when: null,
						primary: KeyMod.CtrlCmd | KeyCode.US_COMMA,
					},
					menu: {
						id: MenuId.GlobalActivity,
						group: '2_configuration',
						order: 1
					}
				});
			}
			run(accessor: ServicesAccessor, args: string | undefined) {
				const query = typeof args === 'string' ? args : undefined;
				return accessor.get(IPreferencesService).openSettings(query ? false : undefined, query);
			}
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '1_settings',
			command: {
				id: SETTINGS_COMMAND_OPEN_SETTINGS,
				title: nls.localize({ key: 'miOpenSettings', comment: ['&& denotes a mnemonic'] }, "&&Settings")
			},
			order: 1
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openSettings2',
					title: { value: nls.localize('openSettings2', "Open Settings (UI)"), original: 'Open Settings (UI)' },
					category,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openSettings(false, undefined);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openSettingsJson',
					title: { value: nls.localize('openSettingsJson', "Open Settings (JSON)"), original: 'Open Settings (JSON)' },
					category,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openSettings(true, undefined);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openGlobalSettings',
					title: { value: nls.localize('openGlobalSettings', "Open User Settings"), original: 'Open User Settings' },
					category,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openGlobalSettings();
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openRawDefaultSettings',
					title: { value: nls.localize('openRawDefaultSettings', "Open Default Settings (JSON)"), original: 'Open Default Settings (JSON)' },
					category,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openRawDefaultSettings();
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: '_workbench.openUserSettingsEditor',
					title: OPEN_SETTINGS2_ACTION_TITLE,
					icon: preferencesOpenSettingsIcon,
					menu: [{
						id: MenuId.EditorTitle,
						when: ResourceContextKey.Resource.isEqualTo(that.environmentService.settingsResource.toString()),
						group: 'navigation',
						order: 1
					}]
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openGlobalSettings(false);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SWITCH_TO_JSON,
					title: { value: nls.localize('openSettingsJson', "Open Settings (JSON)"), original: 'Open Settings (JSON)' },
					icon: preferencesOpenSettingsIcon,
					menu: [{
						id: MenuId.EditorTitle,
						when: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_JSON_EDITOR.toNegated()),
						group: 'navigation',
						order: 1
					}]
				});
			}
			run(accessor: ServicesAccessor) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof SettingsEditor2) {
					return editorPane.switchToSettingsFile();
				}
				return Promise.resolve(null);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ConfigureLanguageBasedSettingsAction.ID,
					title: ConfigureLanguageBasedSettingsAction.LABEL,
					category,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IInstantiationService).createInstance(ConfigureLanguageBasedSettingsAction, ConfigureLanguageBasedSettingsAction.ID, ConfigureLanguageBasedSettingsAction.LABEL.value).run();
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openWorkspaceSettings',
					title: { value: nls.localize('openWorkspaceSettings', "Open Workspace Settings"), original: 'Open Workspace Settings' },
					category,
					menu: {
						id: MenuId.CommandPalette,
						when: WorkbenchStateContext.notEqualsTo('empty')
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openWorkspaceSettings();
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openWorkspaceSettingsFile',
					title: { value: nls.localize('openWorkspaceSettingsFile', "Open Workspace Settings (JSON)"), original: 'Open Workspace Settings (JSON)' },
					category,
					menu: {
						id: MenuId.CommandPalette,
						when: WorkbenchStateContext.notEqualsTo('empty')
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openWorkspaceSettings(true);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openFolderSettings',
					title: { value: nls.localize('openFolderSettings', "Open Folder Settings"), original: 'Open Folder Settings' },
					category,
					menu: {
						id: MenuId.CommandPalette,
						when: WorkbenchStateContext.isEqualTo('workspace')
					}
				});
			}
			async run(accessor: ServicesAccessor) {
				const commandService = accessor.get(ICommandService);
				const preferencesService = accessor.get(IPreferencesService);
				const workspaceFolder = await commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
				if (workspaceFolder) {
					await preferencesService.openFolderSettings(workspaceFolder.uri);
				}
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openFolderSettingsFile',
					title: { value: nls.localize('openFolderSettingsFile', "Open Folder Settings (JSON)"), original: 'Open Folder Settings (JSON)' },
					category,
					menu: {
						id: MenuId.CommandPalette,
						when: WorkbenchStateContext.isEqualTo('workspace')
					}
				});
			}
			async run(accessor: ServicesAccessor) {
				const commandService = accessor.get(ICommandService);
				const preferencesService = accessor.get(IPreferencesService);
				const workspaceFolder = await commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
				if (workspaceFolder) {
					await preferencesService.openFolderSettings(workspaceFolder.uri, true);
				}
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: '_workbench.action.openFolderSettings',
					title: { value: nls.localize('openFolderSettings', "Open Folder Settings"), original: 'Open Folder Settings' },
					category,
					menu: {
						id: MenuId.ExplorerContext,
						group: '2_workspace',
						order: 20,
						when: ContextKeyExpr.and(ExplorerRootContext, ExplorerFolderContext)
					}
				});
			}
			run(accessor: ServicesAccessor, resource: URI) {
				return accessor.get(IPreferencesService).openFolderSettings(resource);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FILTER_MODIFIED,
					title: { value: nls.localize('filterModifiedLabel', "Show modified settings"), original: 'Show modified settings' },
					menu: {
						id: MenuId.EditorTitle,
						group: '1_filter',
						order: 1,
						when: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_JSON_EDITOR.toNegated())
					}
				});
			}
			run(accessor: ServicesAccessor, resource: URI) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof SettingsEditor2) {
					editorPane.focusSearch(`@${MODIFIED_SETTING_TAG}`);
				}
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FILTER_ONLINE,
					title: { value: nls.localize('filterOnlineServicesLabel', "Show settings for online services"), original: 'Show settings for online services' },
					menu: {
						id: MenuId.EditorTitle,
						group: '1_filter',
						order: 2,
						when: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_JSON_EDITOR.toNegated())
					}
				});
			}
			run(accessor: ServicesAccessor) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof SettingsEditor2) {
					editorPane.focusSearch(`@tag:usesOnlineServices`);
				} else {
					accessor.get(IPreferencesService).openSettings(false, '@tag:usesOnlineServices');
				}
			}
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '1_settings',
			command: {
				id: SETTINGS_EDITOR_COMMAND_FILTER_ONLINE,
				title: nls.localize({ key: 'miOpenOnlineSettings', comment: ['&& denotes a mnemonic'] }, "&&Online Services Settings")
			},
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '2_configuration',
			command: {
				id: SETTINGS_EDITOR_COMMAND_FILTER_ONLINE,
				title: nls.localize('onlineServices', "Online Services Settings")
			},
			order: 2
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FILTER_UNTRUSTED,
					title: { value: nls.localize('filterUntrusted', "Show untrusted workspace settings"), original: 'Show untrusted workspace settings' },
				});
			}
			run(accessor: ServicesAccessor) {
				accessor.get(IPreferencesService).openWorkspaceSettings(false, { query: `@tag:${REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG}` });
			}
		});

		this.registerSettingsEditorActions();

		this.extensionService.whenInstalledExtensionsRegistered()
			.then(() => {
				const remoteAuthority = this.environmentService.remoteAuthority;
				const hostLabel = this.labelService.getHostLabel(Schemas.vscodeRemote, remoteAuthority) || remoteAuthority;
				const label = nls.localize('openRemoteSettings', "Open Remote Settings ({0})", hostLabel);
				registerAction2(class extends Action2 {
					constructor() {
						super({
							id: 'workbench.action.openRemoteSettings',
							title: { value: label, original: `Open Remote Settings (${hostLabel})` },
							category,
							menu: {
								id: MenuId.CommandPalette,
								when: RemoteNameContext.notEqualsTo('')
							}
						});
					}
					run(accessor: ServicesAccessor) {
						return accessor.get(IPreferencesService).openRemoteSettings();
					}
				});
			});
	}

	private registerSettingsEditorActions() {
		function getPreferencesEditor(accessor: ServicesAccessor): PreferencesEditor | SettingsEditor2 | null {
			const activeEditorPane = accessor.get(IEditorService).activeEditorPane;
			if (activeEditorPane instanceof PreferencesEditor || activeEditorPane instanceof SettingsEditor2) {
				return activeEditorPane;
			}
			return null;
		}

		function settingsEditorFocusSearch(accessor: ServicesAccessor) {
			const preferencesEditor = getPreferencesEditor(accessor);
			if (preferencesEditor) {
				preferencesEditor.focusSearch();
			}
		}

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SEARCH,
					precondition: CONTEXT_SETTINGS_EDITOR,
					keybinding: {
						primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
						weight: KeybindingWeight.EditorContrib,
						when: null
					},
					category,
					f1: true,
					title: nls.localize('settings.focusSearch', "Focus Settings Search")
				});
			}

			run(accessor: ServicesAccessor) { settingsEditorFocusSearch(accessor); }
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS,
					precondition: CONTEXT_SETTINGS_EDITOR,
					keybinding: {
						primary: KeyCode.Escape,
						weight: KeybindingWeight.EditorContrib,
						when: CONTEXT_SETTINGS_SEARCH_FOCUS
					},
					category,
					f1: true,
					title: nls.localize('settings.clearResults', "Clear Settings Search Results")
				});
			}

			run(accessor: ServicesAccessor) {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor) {
					preferencesEditor.clearSearchResults();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_FILE,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated()),
					keybinding: {
						primary: KeyCode.DownArrow,
						weight: KeybindingWeight.EditorContrib,
						when: null
					},
					title: nls.localize('settings.focusFile', "Focus settings file")
				});
			}

			run(accessor: ServicesAccessor, args: any): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof PreferencesEditor) {
					preferencesEditor.focusSettingsFileEditor();
				} else if (preferencesEditor) {
					preferencesEditor.focusSettings();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_FROM_SEARCH,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_SEARCH_FOCUS, SuggestContext.Visible.toNegated()),
					keybinding: {
						primary: KeyCode.DownArrow,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					title: nls.localize('settings.focusFile', "Focus settings file")
				});
			}

			run(accessor: ServicesAccessor, args: any): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof PreferencesEditor) {
					preferencesEditor.focusSettingsFileEditor();
				} else if (preferencesEditor) {
					preferencesEditor.focusSettings();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_NEXT_SETTING,
					precondition: CONTEXT_SETTINGS_SEARCH_FOCUS,
					keybinding: {
						primary: KeyCode.Enter,
						weight: KeybindingWeight.EditorContrib,
						when: null
					},
					title: nls.localize('settings.focusNextSetting', "Focus next setting")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof PreferencesEditor) {
					preferencesEditor.focusNextResult();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_PREVIOUS_SETTING,
					precondition: CONTEXT_SETTINGS_SEARCH_FOCUS,
					keybinding: {
						primary: KeyMod.Shift | KeyCode.Enter,
						weight: KeybindingWeight.EditorContrib,
						when: null
					},
					title: nls.localize('settings.focusPreviousSetting', "Focus previous setting")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof PreferencesEditor) {
					preferencesEditor.focusPreviousResult();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_EDIT_FOCUSED_SETTING,
					precondition: CONTEXT_SETTINGS_SEARCH_FOCUS,
					keybinding: {
						primary: KeyMod.CtrlCmd | KeyCode.US_DOT,
						weight: KeybindingWeight.EditorContrib,
						when: null
					},
					title: nls.localize('settings.editFocusedSetting', "Edit focused setting")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof PreferencesEditor) {
					preferencesEditor.editFocusedPreference();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_SETTINGS_LIST,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_TOC_ROW_FOCUS),
					keybinding: {
						primary: KeyCode.Enter,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					title: nls.localize('settings.focusSettingsList', "Focus settings list")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof SettingsEditor2) {
					preferencesEditor.focusSettings();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_TOC,
					precondition: CONTEXT_SETTINGS_EDITOR,
					f1: true,
					keybinding: [
						{
							primary: KeyCode.LeftArrow,
							weight: KeybindingWeight.WorkbenchContrib,
							when: CONTEXT_SETTINGS_ROW_FOCUS
						}],
					category,
					title: nls.localize('settings.focusSettingsTOC', "Focus Settings Table of Contents")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (!(preferencesEditor instanceof SettingsEditor2)) {
					return;
				}

				preferencesEditor.focusTOC();
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_CONTROL,
					precondition: CONTEXT_SETTINGS_ROW_FOCUS,
					keybinding: {
						primary: KeyCode.Enter,
						weight: KeybindingWeight.WorkbenchContrib,
					},
					title: nls.localize('settings.focusSettingControl', "Focus Setting Control")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (!(preferencesEditor instanceof SettingsEditor2)) {
					return;
				}

				if (document.activeElement?.classList.contains('monaco-list')) {
					preferencesEditor.focusSettings(true);
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU,
					precondition: CONTEXT_SETTINGS_EDITOR,
					keybinding: {
						primary: KeyMod.Shift | KeyCode.F9,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					f1: true,
					category,
					title: nls.localize('settings.showContextMenu', "Show Setting Context Menu")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (preferencesEditor instanceof SettingsEditor2) {
					preferencesEditor.showContextMenu();
				}
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: SETTINGS_EDITOR_COMMAND_FOCUS_UP,
					precondition: ContextKeyExpr.and(CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_SEARCH_FOCUS.toNegated(), CONTEXT_SETTINGS_JSON_EDITOR.toNegated()),
					keybinding: {
						primary: KeyCode.Escape,
						weight: KeybindingWeight.WorkbenchContrib,
						when: null
					},
					f1: true,
					category,
					title: nls.localize('settings.focusLevelUp', "Move Focus Up One Level")
				});
			}

			run(accessor: ServicesAccessor): void {
				const preferencesEditor = getPreferencesEditor(accessor);
				if (!(preferencesEditor instanceof SettingsEditor2)) {
					return;
				}

				if (preferencesEditor.currentFocusContext === SettingsFocusContext.SettingControl) {
					preferencesEditor.focusSettings();
				} else if (preferencesEditor.currentFocusContext === SettingsFocusContext.SettingTree) {
					preferencesEditor.focusTOC();
				} else if (preferencesEditor.currentFocusContext === SettingsFocusContext.TableOfContents) {
					preferencesEditor.focusSearch();
				}
			}
		});
	}

	private registerKeybindingsActions() {
		const that = this;
		const category = { value: nls.localize('preferences', "Preferences"), original: 'Preferences' };
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openGlobalKeybindings',
					title: { value: nls.localize('openGlobalKeybindings', "Open Keyboard Shortcuts"), original: 'Open Keyboard Shortcuts' },
					category,
					icon: preferencesOpenSettingsIcon,
					keybinding: {
						when: null,
						weight: KeybindingWeight.WorkbenchContrib,
						primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_S)
					},
					menu: [
						{ id: MenuId.CommandPalette },
						{
							id: MenuId.EditorTitle,
							when: ResourceContextKey.Resource.isEqualTo(that.environmentService.keybindingsResource.toString()),
							group: 'navigation',
							order: 1,
						}
					]
				});
			}
			run(accessor: ServicesAccessor, args: string | undefined) {
				const query = typeof args === 'string' ? args : undefined;
				return accessor.get(IPreferencesService).openGlobalKeybindingSettings(false, { query });
			}
		});
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			command: {
				id: 'workbench.action.openGlobalKeybindings',
				title: { value: nls.localize('Keyboard Shortcuts', "Keyboard Shortcuts"), original: 'Keyboard Shortcuts' }
			},
			group: '2_keybindings',
			order: 1
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			command: {
				id: 'workbench.action.openGlobalKeybindings',
				title: { value: nls.localize('Keyboard Shortcuts', "Keyboard Shortcuts"), original: 'Keyboard Shortcuts' }
			},
			group: '2_keybindings',
			order: 1
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openDefaultKeybindingsFile',
					title: { value: nls.localize('openDefaultKeybindingsFile', "Open Default Keyboard Shortcuts (JSON)"), original: 'Open Default Keyboard Shortcuts (JSON)' },
					category,
					menu: { id: MenuId.CommandPalette }
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openDefaultKeybindingsFile();
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.openGlobalKeybindingsFile',
					title: { value: nls.localize('openGlobalKeybindingsFile', "Open Keyboard Shortcuts (JSON)"), original: 'Open Keyboard Shortcuts (JSON)' },
					category,
					icon: preferencesOpenSettingsIcon,
					menu: [
						{ id: MenuId.CommandPalette },
						{
							id: MenuId.EditorTitle,
							when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR),
							group: 'navigation',
						}
					]
				});
			}
			run(accessor: ServicesAccessor) {
				return accessor.get(IPreferencesService).openGlobalKeybindingSettings(true);
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: KEYBINDINGS_EDITOR_SHOW_DEFAULT_KEYBINDINGS,
					title: { value: nls.localize('showDefaultKeybindings', "Show Default Keybindings"), original: 'Show Default Keybindings' },
					menu: [
						{
							id: MenuId.EditorTitle,
							when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR),
							group: '1_keyboard_preferences_actions'
						}
					]
				});
			}
			run(accessor: ServicesAccessor) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.search('@source:default');
				}
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: KEYBINDINGS_EDITOR_SHOW_EXTENSION_KEYBINDINGS,
					title: { value: nls.localize('showExtensionKeybindings', "Show Extension Keybindings"), original: 'Show Extension Keybindings' },
					menu: [
						{
							id: MenuId.EditorTitle,
							when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR),
							group: '1_keyboard_preferences_actions'
						}
					]
				});
			}
			run(accessor: ServicesAccessor) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.search('@source:extension');
				}
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: KEYBINDINGS_EDITOR_SHOW_USER_KEYBINDINGS,
					title: { value: nls.localize('showUserKeybindings', "Show User Keybindings"), original: 'Show User Keybindings' },
					menu: [
						{
							id: MenuId.EditorTitle,
							when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR),
							group: '1_keyboard_preferences_actions'
						}
					]
				});
			}
			run(accessor: ServicesAccessor) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.search('@source:user');
				}
			}
		});
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: KEYBINDINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS,
					title: nls.localize('clear', "Clear Search Results"),
					keybinding: {
						weight: KeybindingWeight.WorkbenchContrib,
						when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDINGS_SEARCH_FOCUS),
						primary: KeyCode.Escape,
					}
				});
			}
			run(accessor: ServicesAccessor) {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.clearSearchResults();
				}
			}
		});

		this.registerKeybindingEditorActions();
	}

	private registerKeybindingEditorActions(): void {
		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_DEFINE,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: KeyCode.Enter,
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.defineKeybinding(editorPane.activeKeybindingEntry!, false);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_ADD,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_A),
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.defineKeybinding(editorPane.activeKeybindingEntry!, true);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_DEFINE_WHEN,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_E),
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor && editorPane.activeKeybindingEntry!.keybindingItem.keybinding) {
					editorPane.defineWhenExpression(editorPane.activeKeybindingEntry!);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_REMOVE,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: KeyCode.Delete,
			mac: {
				primary: KeyMod.CtrlCmd | KeyCode.Backspace
			},
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.removeKeybinding(editorPane.activeKeybindingEntry!);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_RESET,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: 0,
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.resetKeybinding(editorPane.activeKeybindingEntry!);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_SEARCH,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR),
			primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.focusSearch();
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDINGS_SEARCH_FOCUS),
			primary: KeyMod.Alt | KeyCode.KEY_K,
			mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_K },
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.recordSearchKeys();
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_SORTBY_PRECEDENCE,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR),
			primary: KeyMod.Alt | KeyCode.KEY_P,
			mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_P },
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.toggleSortByPrecedence();
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_SHOW_SIMILAR,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: 0,
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.showSimilarKeybindings(editorPane.activeKeybindingEntry!);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_COPY,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
			handler: async (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					await editorPane.copyKeybinding(editorPane.activeKeybindingEntry!);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDING_FOCUS),
			primary: 0,
			handler: async (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					await editorPane.copyKeybindingCommand(editorPane.activeKeybindingEntry!);
				}
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: KEYBINDINGS_EDITOR_COMMAND_FOCUS_KEYBINDINGS,
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDINGS_SEARCH_FOCUS),
			primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
			handler: (accessor, args: any) => {
				const editorPane = accessor.get(IEditorService).activeEditorPane;
				if (editorPane instanceof KeybindingsEditor) {
					editorPane.focusKeybindings();
				}
			}
		});
	}

	private updatePreferencesEditorMenuItem() {
		const commandId = '_workbench.openWorkspaceSettingsEditor';
		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE && !CommandsRegistry.getCommand(commandId)) {
			CommandsRegistry.registerCommand(commandId, () => this.preferencesService.openWorkspaceSettings(false));
			MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
				command: {
					id: commandId,
					title: OPEN_SETTINGS2_ACTION_TITLE,
					icon: preferencesOpenSettingsIcon
				},
				when: ContextKeyExpr.and(ResourceContextKey.Resource.isEqualTo(this.preferencesService.workspaceSettingsResource!.toString()), WorkbenchStateContext.isEqualTo('workspace')),
				group: 'navigation',
				order: 1
			});
		}
		this.updatePreferencesEditorMenuItemForWorkspaceFolders();
	}

	private updatePreferencesEditorMenuItemForWorkspaceFolders() {
		for (const folder of this.workspaceContextService.getWorkspace().folders) {
			const commandId = `_workbench.openFolderSettings.${folder.uri.toString()}`;
			if (!CommandsRegistry.getCommand(commandId)) {
				CommandsRegistry.registerCommand(commandId, () => {
					if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.FOLDER) {
						return this.preferencesService.openWorkspaceSettings(false);
					} else {
						return this.preferencesService.openFolderSettings(folder.uri, false);
					}
				});
				MenuRegistry.appendMenuItem(MenuId.EditorTitle, {
					command: {
						id: commandId,
						title: OPEN_SETTINGS2_ACTION_TITLE,
						icon: preferencesOpenSettingsIcon
					},
					when: ContextKeyExpr.and(ResourceContextKey.Resource.isEqualTo(this.preferencesService.getFolderSettingsResource(folder.uri)!.toString())),
					group: 'navigation',
					order: 1
				});
			}
		}
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(PreferencesActionsContribution, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(PreferencesContribution, LifecyclePhase.Starting);

// Preferences menu

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	title: nls.localize({ key: 'miPreferences', comment: ['&& denotes a mnemonic'] }, "&&Preferences"),
	submenu: MenuId.MenubarPreferencesMenu,
	group: '5_autosave',
	order: 2,
	when: IsMacNativeContext.toNegated() // on macOS native the preferences menu is separate under the application menu
});
