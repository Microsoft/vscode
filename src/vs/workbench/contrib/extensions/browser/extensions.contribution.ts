/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { MenuRegistry, MenuId, registerAction2, Action2, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ExtensionsLabel, ExtensionsLocalizedLabel, ExtensionsChannelId, IExtensionManagementService, IExtensionGalleryService, PreferencesLocalizedLabel } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionIgnoredRecommendationsService, IExtensionRecommendationsService } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IOutputChannelRegistry, Extensions as OutputExtensions } from 'vs/workbench/services/output/common/output';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { VIEWLET_ID, IExtensionsWorkbenchService, IExtensionsViewPaneContainer, TOGGLE_IGNORE_EXTENSION_ACTION_ID, INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import {
	OpenExtensionsViewletAction, InstallExtensionsAction, ShowOutdatedExtensionsAction, ShowRecommendedExtensionsAction, ShowRecommendedKeymapExtensionsAction, ShowPopularExtensionsAction,
	ShowEnabledExtensionsAction, ShowInstalledExtensionsAction, ShowDisabledExtensionsAction, ShowBuiltInExtensionsAction, UpdateAllAction,
	EnableAllAction, EnableAllWorkspaceAction, DisableAllAction, DisableAllWorkspaceAction, CheckForUpdatesAction, ShowLanguageExtensionsAction, EnableAutoUpdateAction, DisableAutoUpdateAction, InstallVSIXAction, ReinstallAction, InstallSpecificVersionOfExtensionAction, ClearExtensionsSearchResultsAction, ConfigureWorkspaceRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction, RefreshExtensionsAction
} from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { ExtensionsInput } from 'vs/workbench/contrib/extensions/common/extensionsInput';
import { ExtensionEditor } from 'vs/workbench/contrib/extensions/browser/extensionEditor';
import { StatusUpdater, MaliciousExtensionChecker, ExtensionsViewletViewsContribution, ExtensionsViewPaneContainer } from 'vs/workbench/contrib/extensions/browser/extensionsViewlet';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import * as jsonContributionRegistry from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { ExtensionsConfigurationSchema, ExtensionsConfigurationSchemaId } from 'vs/workbench/contrib/extensions/common/extensionsFileTemplate';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeymapExtensions } from 'vs/workbench/contrib/extensions/common/extensionsUtils';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { EditorDescriptor, IEditorRegistry, Extensions as EditorExtensions } from 'vs/workbench/browser/editor';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ExtensionActivationProgress } from 'vs/workbench/contrib/extensions/browser/extensionsActivationProgress';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ExtensionDependencyChecker } from 'vs/workbench/contrib/extensions/browser/extensionsDependencyChecker';
import { CancellationToken } from 'vs/base/common/cancellation';
import { RemoteExtensionsInstaller } from 'vs/workbench/contrib/extensions/browser/remoteExtensionsInstaller';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions } from 'vs/workbench/common/views';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { ContextKeyAndExpr, ContextKeyExpr, ContextKeyOrExpr, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IQuickAccessRegistry, Extensions } from 'vs/platform/quickinput/common/quickAccess';
import { InstallExtensionQuickAccessProvider, ManageExtensionsQuickAccessProvider } from 'vs/workbench/contrib/extensions/browser/extensionsQuickAccess';
import { ExtensionRecommendationsService } from 'vs/workbench/contrib/extensions/browser/extensionRecommendationsService';
import { CONTEXT_SYNC_ENABLEMENT } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { CopyAction, CutAction, PasteAction } from 'vs/editor/contrib/clipboard/clipboard';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { MultiCommand } from 'vs/editor/browser/editorExtensions';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';
import { ExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/browser/extensionsWorkbenchService';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { WorkbenchStateContext } from 'vs/workbench/browser/contextkeys';
import { IWorkbenchActionRegistry, Extensions as WorkbenchActionExtensions, CATEGORIES } from 'vs/workbench/common/actions';
import { IExtensionRecommendationNotificationService } from 'vs/platform/extensionRecommendations/common/extensionRecommendations';
import { ExtensionRecommendationNotificationService } from 'vs/workbench/contrib/extensions/browser/extensionRecommendationNotificationService';
import { IExtensionService, toExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { IAction } from 'vs/base/common/actions';
import { IWorkpsaceExtensionsConfigService } from 'vs/workbench/services/extensionRecommendations/common/workspaceExtensionsConfig';
import { Schemas } from 'vs/base/common/network';
import { ShowRuntimeExtensionsAction } from 'vs/workbench/contrib/extensions/browser/abstractRuntimeExtensionsEditor';
import { extensionsViewIcon } from 'vs/workbench/contrib/extensions/browser/extensionsIcons';

// Singletons
registerSingleton(IExtensionsWorkbenchService, ExtensionsWorkbenchService);
registerSingleton(IExtensionRecommendationNotificationService, ExtensionRecommendationNotificationService);
registerSingleton(IExtensionRecommendationsService, ExtensionRecommendationsService);

Registry.as<IOutputChannelRegistry>(OutputExtensions.OutputChannels)
	.registerChannel({ id: ExtensionsChannelId, label: ExtensionsLabel, log: false });

// Quick Access
Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess).registerQuickAccessProvider({
	ctor: ManageExtensionsQuickAccessProvider,
	prefix: ManageExtensionsQuickAccessProvider.PREFIX,
	placeholder: localize('manageExtensionsQuickAccessPlaceholder', "Press Enter to manage extensions."),
	helpEntries: [{ description: localize('manageExtensionsHelp', "Manage Extensions"), needsEditor: false }]
});

// Explorer
MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: 'extensions',
	command: {
		id: INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID,
		title: localize('installVSIX', "Install Extension VSIX"),
	},
	when: ResourceContextKey.Extension.isEqualTo('.vsix')
});

// Editor
Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		ExtensionEditor,
		ExtensionEditor.ID,
		localize('extension', "Extension")
	),
	[
		new SyncDescriptor(ExtensionsInput)
	]);


Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(
	{
		id: VIEWLET_ID,
		name: localize('extensions', "Extensions"),
		ctorDescriptor: new SyncDescriptor(ExtensionsViewPaneContainer),
		icon: extensionsViewIcon,
		order: 4,
		rejectAddedViews: true,
		alwaysUseContainerInfo: true
	}, ViewContainerLocation.Sidebar);


Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'extensions',
		order: 30,
		title: localize('extensionsConfigurationTitle', "Extensions"),
		type: 'object',
		properties: {
			'extensions.autoUpdate': {
				type: 'boolean',
				description: localize('extensionsAutoUpdate', "When enabled, automatically installs updates for extensions. The updates are fetched from a Microsoft online service."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
				tags: ['usesOnlineServices']
			},
			'extensions.autoCheckUpdates': {
				type: 'boolean',
				description: localize('extensionsCheckUpdates', "When enabled, automatically checks extensions for updates. If an extension has an update, it is marked as outdated in the Extensions view. The updates are fetched from a Microsoft online service."),
				default: true,
				scope: ConfigurationScope.APPLICATION,
				tags: ['usesOnlineServices']
			},
			'extensions.ignoreRecommendations': {
				type: 'boolean',
				description: localize('extensionsIgnoreRecommendations', "When enabled, the notifications for extension recommendations will not be shown."),
				default: false
			},
			'extensions.showRecommendationsOnlyOnDemand': {
				type: 'boolean',
				deprecationMessage: localize('extensionsShowRecommendationsOnlyOnDemand_Deprecated', "This setting is deprecated. Use extensions.ignoreRecommendations setting to control recommendation notifications. Use Extensions view's visibility actions to hide Recommended view by default."),
				default: false,
				tags: ['usesOnlineServices']
			},
			'extensions.closeExtensionDetailsOnViewChange': {
				type: 'boolean',
				description: localize('extensionsCloseExtensionDetailsOnViewChange', "When enabled, editors with extension details will be automatically closed upon navigating away from the Extensions View."),
				default: false
			},
			'extensions.confirmedUriHandlerExtensionIds': {
				type: 'array',
				description: localize('handleUriConfirmedExtensions', "When an extension is listed here, a confirmation prompt will not be shown when that extension handles a URI."),
				default: []
			},
			'extensions.webWorker': {
				type: 'boolean',
				description: localize('extensionsWebWorker', "Enable web worker extension host."),
				default: false
			}
		}
	});

const jsonRegistry = <jsonContributionRegistry.IJSONContributionRegistry>Registry.as(jsonContributionRegistry.Extensions.JSONContribution);
jsonRegistry.registerSchema(ExtensionsConfigurationSchemaId, ExtensionsConfigurationSchema);

// Register Commands
CommandsRegistry.registerCommand('_extensions.manage', (accessor: ServicesAccessor, extensionId: string) => {
	const extensionService = accessor.get(IExtensionsWorkbenchService);
	const extension = extensionService.local.filter(e => areSameExtensions(e.identifier, { id: extensionId }));
	if (extension.length === 1) {
		extensionService.open(extension[0]);
	}
});

CommandsRegistry.registerCommand('extension.open', (accessor: ServicesAccessor, extensionId: string) => {
	const extensionService = accessor.get(IExtensionsWorkbenchService);

	return extensionService.queryGallery({ names: [extensionId], pageSize: 1 }, CancellationToken.None).then(pager => {
		if (pager.total !== 1) {
			return;
		}

		extensionService.open(pager.firstPage[0]);
	});
});

CommandsRegistry.registerCommand({
	id: 'workbench.extensions.installExtension',
	description: {
		description: localize('workbench.extensions.installExtension.description', "Install the given extension"),
		args: [
			{
				name: localize('workbench.extensions.installExtension.arg.name', "Extension id or VSIX resource uri"),
				schema: {
					'type': ['object', 'string']
				}
			}
		]
	},
	handler: async (accessor, arg: string | UriComponents) => {
		const extensionManagementService = accessor.get(IExtensionManagementService);
		const extensionGalleryService = accessor.get(IExtensionGalleryService);
		try {
			if (typeof arg === 'string') {
				const extension = await extensionGalleryService.getCompatibleExtension({ id: arg });
				if (extension) {
					await extensionManagementService.installFromGallery(extension);
				} else {
					throw new Error(localize('notFound', "Extension '{0}' not found.", arg));
				}
			} else {
				const vsix = URI.revive(arg);
				await extensionManagementService.install(vsix);
			}
		} catch (e) {
			onUnexpectedError(e);
			throw e;
		}
	}
});

CommandsRegistry.registerCommand({
	id: INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID,
	handler: async (accessor: ServicesAccessor, resources: URI[] | URI) => {
		const extensionService = accessor.get(IExtensionService);
		const extensionsWorkbenchService = accessor.get(IExtensionsWorkbenchService);
		const hostService = accessor.get(IHostService);
		const notificationService = accessor.get(INotificationService);

		const extensions = Array.isArray(resources) ? resources : [resources];
		await Promise.all(extensions.map(async (vsix) => await extensionsWorkbenchService.install(vsix)))
			.then(async (extensions) => {
				for (const extension of extensions) {
					const requireReload = !(extension.local && extensionService.canAddExtension(toExtensionDescription(extension.local)));
					const message = requireReload ? localize('InstallVSIXAction.successReload', "Completed installing {0} extension from VSIX. Please reload Visual Studio Code to enable it.", extension.displayName || extension.name)
						: localize('InstallVSIXAction.success', "Completed installing {0} extension from VSIX.", extension.displayName || extension.name);
					const actions = requireReload ? [{
						label: localize('InstallVSIXAction.reloadNow', "Reload Now"),
						run: () => hostService.reload()
					}] : [];
					notificationService.prompt(
						Severity.Info,
						message,
						actions,
						{ sticky: true }
					);
				}
			});
	}
});

CommandsRegistry.registerCommand({
	id: 'workbench.extensions.uninstallExtension',
	description: {
		description: localize('workbench.extensions.uninstallExtension.description', "Uninstall the given extension"),
		args: [
			{
				name: localize('workbench.extensions.uninstallExtension.arg.name', "Id of the extension to uninstall"),
				schema: {
					'type': 'string'
				}
			}
		]
	},
	handler: async (accessor, id: string) => {
		if (!id) {
			throw new Error(localize('id required', "Extension id required."));
		}
		const extensionManagementService = accessor.get(IExtensionManagementService);
		const installed = await extensionManagementService.getInstalled();
		const [extensionToUninstall] = installed.filter(e => areSameExtensions(e.identifier, { id }));
		if (!extensionToUninstall) {
			throw new Error(localize('notInstalled', "Extension '{0}' is not installed. Make sure you use the full extension ID, including the publisher, e.g.: ms-dotnettools.csharp.", id));
		}
		if (extensionToUninstall.isBuiltin) {
			throw new Error(localize('builtin', "Extension '{0}' is a Built-in extension and cannot be installed", id));
		}

		try {
			await extensionManagementService.uninstall(extensionToUninstall);
		} catch (e) {
			onUnexpectedError(e);
			throw e;
		}
	}
});

CommandsRegistry.registerCommand({
	id: 'workbench.extensions.search',
	description: {
		description: localize('workbench.extensions.search.description', "Search for a specific extension"),
		args: [
			{
				name: localize('workbench.extensions.search.arg.name', "Query to use in search"),
				schema: { 'type': 'string' }
			}
		]
	},
	handler: async (accessor, query: string = '') => {
		const viewletService = accessor.get(IViewletService);
		const viewlet = await viewletService.openViewlet(VIEWLET_ID, true);

		if (!viewlet) {
			return;
		}

		(viewlet.getViewPaneContainer() as IExtensionsViewPaneContainer).search(query);
		viewlet.focus();
	}
});

// File menu registration

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '2_keybindings',
	command: {
		id: ShowRecommendedKeymapExtensionsAction.ID,
		title: localize({ key: 'miOpenKeymapExtensions', comment: ['&& denotes a mnemonic'] }, "&&Keymaps")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '2_keybindings',
	command: {
		id: ShowRecommendedKeymapExtensionsAction.ID,
		title: localize('miOpenKeymapExtensions2', "Keymaps")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
	group: '1_settings',
	command: {
		id: VIEWLET_ID,
		title: localize({ key: 'miPreferencesExtensions', comment: ['&& denotes a mnemonic'] }, "&&Extensions")
	},
	order: 3
});

// View menu

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '3_views',
	command: {
		id: VIEWLET_ID,
		title: localize({ key: 'miViewExtensions', comment: ['&& denotes a mnemonic'] }, "E&&xtensions")
	},
	order: 5
});

// Global Activity Menu

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '2_configuration',
	command: {
		id: VIEWLET_ID,
		title: localize('showExtensions', "Extensions")
	},
	order: 3
});

function overrideActionForActiveExtensionEditorWebview(command: MultiCommand | undefined, f: (webview: Webview) => void) {
	command?.addImplementation(105, (accessor) => {
		const editorService = accessor.get(IEditorService);
		const editor = editorService.activeEditorPane;
		if (editor instanceof ExtensionEditor) {
			if (editor.activeWebview?.isFocused) {
				f(editor.activeWebview);
				return true;
			}
		}
		return false;
	});
}

overrideActionForActiveExtensionEditorWebview(CopyAction, webview => webview.copy());
overrideActionForActiveExtensionEditorWebview(CutAction, webview => webview.cut());
overrideActionForActiveExtensionEditorWebview(PasteAction, webview => webview.paste());

// Contexts
export const CONTEXT_HAS_GALLERY = new RawContextKey<boolean>('hasGallery', false);
export const CONTEXT_HAS_LOCAL_SERVER = new RawContextKey<boolean>('hasLocalServer', false);
export const CONTEXT_HAS_REMOTE_SERVER = new RawContextKey<boolean>('hasRemoteServer', false);
export const CONTEXT_HAS_WEB_SERVER = new RawContextKey<boolean>('hasWebServer', false);

async function runAction(action: IAction): Promise<void> {
	try {
		await action.run();
	} finally {
		action.dispose();
	}
}

class ExtensionsContributions implements IWorkbenchContribution {

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		const hasGalleryContext = CONTEXT_HAS_GALLERY.bindTo(contextKeyService);
		if (extensionGalleryService.isEnabled()) {
			hasGalleryContext.set(true);
		}

		const hasLocalServerContext = CONTEXT_HAS_LOCAL_SERVER.bindTo(contextKeyService);
		if (this.extensionManagementServerService.localExtensionManagementServer) {
			hasLocalServerContext.set(true);
		}

		const hasRemoteServerContext = CONTEXT_HAS_REMOTE_SERVER.bindTo(contextKeyService);
		if (this.extensionManagementServerService.remoteExtensionManagementServer) {
			hasRemoteServerContext.set(true);
		}

		const hasWebServerContext = CONTEXT_HAS_WEB_SERVER.bindTo(contextKeyService);
		if (this.extensionManagementServerService.webExtensionManagementServer) {
			hasWebServerContext.set(true);
		}

		this.registerGlobalActions();
		this.registerContextMenuActions();
		this.registerQuickAccessProvider();
	}

	private registerQuickAccessProvider(): void {
		if (this.extensionManagementServerService.localExtensionManagementServer
			|| this.extensionManagementServerService.remoteExtensionManagementServer
			|| this.extensionManagementServerService.webExtensionManagementServer
		) {
			Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess).registerQuickAccessProvider({
				ctor: InstallExtensionQuickAccessProvider,
				prefix: InstallExtensionQuickAccessProvider.PREFIX,
				placeholder: localize('installExtensionQuickAccessPlaceholder', "Type the name of an extension to install or search."),
				helpEntries: [{ description: localize('installExtensionQuickAccessHelp', "Install or Search Extensions"), needsEditor: false }]
			});
		}
	}

	// Global actions
	private registerGlobalActions(): void {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: OpenExtensionsViewletAction.ID,
					title: { value: OpenExtensionsViewletAction.LABEL, original: 'Show Extensions' },
					category: CATEGORIES.View,
					menu: {
						id: MenuId.CommandPalette,
					},
					keybinding: {
						primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_X,
						weight: KeybindingWeight.WorkbenchContrib
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(OpenExtensionsViewletAction, OpenExtensionsViewletAction.ID, OpenExtensionsViewletAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: InstallExtensionsAction.ID,
					title: { value: InstallExtensionsAction.LABEL, original: 'Install Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(InstallExtensionsAction, InstallExtensionsAction.ID, InstallExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowOutdatedExtensionsAction.ID,
					title: { value: ShowOutdatedExtensionsAction.LABEL, original: 'Show Outdated Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowOutdatedExtensionsAction, ShowOutdatedExtensionsAction.ID, ShowOutdatedExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowRecommendedExtensionsAction.ID,
					title: { value: ShowRecommendedExtensionsAction.LABEL, original: 'Show Recommended Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: CONTEXT_HAS_GALLERY
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowRecommendedExtensionsAction, ShowRecommendedExtensionsAction.ID, ShowRecommendedExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowRecommendedKeymapExtensionsAction.ID,
					title: { value: ShowRecommendedKeymapExtensionsAction.LABEL, original: 'Keymaps' },
					category: PreferencesLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: CONTEXT_HAS_GALLERY
					},
					keybinding: {
						primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_M),
						weight: KeybindingWeight.WorkbenchContrib
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowRecommendedKeymapExtensionsAction, ShowRecommendedKeymapExtensionsAction.ID, ShowRecommendedKeymapExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowLanguageExtensionsAction.ID,
					title: { value: ShowLanguageExtensionsAction.LABEL, original: 'Language Extensions' },
					category: PreferencesLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: CONTEXT_HAS_GALLERY
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowLanguageExtensionsAction, ShowLanguageExtensionsAction.ID, ShowLanguageExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowPopularExtensionsAction.ID,
					title: { value: ShowPopularExtensionsAction.LABEL, original: 'Show Popular Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: CONTEXT_HAS_GALLERY
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowPopularExtensionsAction, ShowPopularExtensionsAction.ID, ShowPopularExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowEnabledExtensionsAction.ID,
					title: { value: ShowEnabledExtensionsAction.LABEL, original: 'Show Enabled Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowEnabledExtensionsAction, ShowEnabledExtensionsAction.ID, ShowEnabledExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowInstalledExtensionsAction.ID,
					title: { value: ShowInstalledExtensionsAction.LABEL, original: 'Show Installed Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowInstalledExtensionsAction, ShowInstalledExtensionsAction.ID, ShowInstalledExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowDisabledExtensionsAction.ID,
					title: { value: ShowDisabledExtensionsAction.LABEL, original: 'Show Disabled Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowDisabledExtensionsAction, ShowDisabledExtensionsAction.ID, ShowDisabledExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ShowBuiltInExtensionsAction.ID,
					title: { value: ShowBuiltInExtensionsAction.LABEL, original: 'Show Built-in Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ShowBuiltInExtensionsAction, ShowBuiltInExtensionsAction.ID, ShowBuiltInExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: UpdateAllAction.ID,
					title: { value: UpdateAllAction.LABEL, original: 'Update All Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(UpdateAllAction, UpdateAllAction.ID, UpdateAllAction.LABEL, false));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: InstallVSIXAction.ID,
					title: { value: InstallVSIXAction.LABEL, original: 'Install from VSIX...' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(InstallVSIXAction, InstallVSIXAction.ID, InstallVSIXAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: DisableAllAction.ID,
					title: { value: DisableAllAction.LABEL, original: 'Disable All Installed Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(DisableAllAction, DisableAllAction.ID, DisableAllAction.LABEL, false));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: DisableAllWorkspaceAction.ID,
					title: { value: DisableAllWorkspaceAction.LABEL, original: 'Disable All Installed Extensions for this Workspace' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([WorkbenchStateContext.notEqualsTo('empty'), ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(DisableAllWorkspaceAction, DisableAllWorkspaceAction.ID, DisableAllWorkspaceAction.LABEL, false));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: EnableAllAction.ID,
					title: { value: EnableAllAction.LABEL, original: 'Enable All Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(EnableAllAction, EnableAllAction.ID, EnableAllAction.LABEL, false));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: EnableAllWorkspaceAction.ID,
					title: { value: EnableAllWorkspaceAction.LABEL, original: 'Enable All Extensions for this Workspace' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([WorkbenchStateContext.notEqualsTo('empty'), ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(EnableAllWorkspaceAction, EnableAllWorkspaceAction.ID, EnableAllWorkspaceAction.LABEL, false));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: CheckForUpdatesAction.ID,
					title: { value: CheckForUpdatesAction.LABEL, original: 'Check for Extension Updates' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(CheckForUpdatesAction, CheckForUpdatesAction.ID, CheckForUpdatesAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ClearExtensionsSearchResultsAction.ID,
					title: { value: ClearExtensionsSearchResultsAction.LABEL, original: 'Clear Extensions Search Results' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ClearExtensionsSearchResultsAction, ClearExtensionsSearchResultsAction.ID, ClearExtensionsSearchResultsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: RefreshExtensionsAction.ID,
					title: { value: RefreshExtensionsAction.LABEL, original: 'Refresh' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(RefreshExtensionsAction, RefreshExtensionsAction.ID, RefreshExtensionsAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: EnableAutoUpdateAction.ID,
					title: { value: EnableAutoUpdateAction.LABEL, original: 'Enable Auto Updating Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(EnableAutoUpdateAction, EnableAutoUpdateAction.ID, EnableAutoUpdateAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: DisableAutoUpdateAction.ID,
					title: { value: DisableAutoUpdateAction.LABEL, original: 'Disable Auto Updating Extensions' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(DisableAutoUpdateAction, DisableAutoUpdateAction.ID, DisableAutoUpdateAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: InstallSpecificVersionOfExtensionAction.ID,
					title: { value: InstallSpecificVersionOfExtensionAction.LABEL, original: 'Install Specific Version of Extension...' },
					category: ExtensionsLocalizedLabel,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(InstallSpecificVersionOfExtensionAction, InstallSpecificVersionOfExtensionAction.ID, InstallSpecificVersionOfExtensionAction.LABEL));
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: ReinstallAction.ID,
					title: { value: ReinstallAction.LABEL, original: 'Reinstall Extension...' },
					category: CATEGORIES.Developer,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER])])
					}
				});
			}
			run(accessor: ServicesAccessor) {
				return runAction(accessor.get(IInstantiationService).createInstance(ReinstallAction, ReinstallAction.ID, ReinstallAction.LABEL));
			}
		});
	}

	// Extension Context Menu
	private registerContextMenuActions(): void {
		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.copyExtension',
					title: { value: localize('workbench.extensions.action.copyExtension', "Copy"), original: 'Copy' },
					menu: {
						id: MenuId.ExtensionContext,
						group: '1_copy'
					}
				});
			}

			async run(accessor: ServicesAccessor, extensionId: string) {
				const extensionWorkbenchService = accessor.get(IExtensionsWorkbenchService);
				let extension = extensionWorkbenchService.local.filter(e => areSameExtensions(e.identifier, { id: extensionId }))[0]
					|| (await extensionWorkbenchService.queryGallery({ names: [extensionId], pageSize: 1 }, CancellationToken.None)).firstPage[0];
				if (extension) {
					const name = localize('extensionInfoName', 'Name: {0}', extension.displayName);
					const id = localize('extensionInfoId', 'Id: {0}', extensionId);
					const description = localize('extensionInfoDescription', 'Description: {0}', extension.description);
					const verision = localize('extensionInfoVersion', 'Version: {0}', extension.version);
					const publisher = localize('extensionInfoPublisher', 'Publisher: {0}', extension.publisherDisplayName);
					const link = extension.url ? localize('extensionInfoVSMarketplaceLink', 'VS Marketplace Link: {0}', `${extension.url}`) : null;
					const clipboardStr = `${name}\n${id}\n${description}\n${verision}\n${publisher}${link ? '\n' + link : ''}`;
					await accessor.get(IClipboardService).writeText(clipboardStr);
				}
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.copyExtensionId',
					title: { value: localize('workbench.extensions.action.copyExtensionId', "Copy Extension Id"), original: 'Copy Extension Id' },
					menu: {
						id: MenuId.ExtensionContext,
						group: '1_copy'
					}
				});
			}

			async run(accessor: ServicesAccessor, id: string) {
				await accessor.get(IClipboardService).writeText(id);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.configure',
					title: { value: localize('workbench.extensions.action.configure', "Extension Settings"), original: 'Extension Settings' },
					menu: {
						id: MenuId.ExtensionContext,
						group: '2_configure',
						when: ContextKeyExpr.and(ContextKeyExpr.equals('extensionStatus', 'installed'), ContextKeyExpr.has('extensionHasConfiguration'))
					}
				});
			}

			async run(accessor: ServicesAccessor, id: string) {
				await accessor.get(IPreferencesService).openSettings(false, `@ext:${id}`);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: TOGGLE_IGNORE_EXTENSION_ACTION_ID,
					title: { value: localize('workbench.extensions.action.toggleIgnoreExtension', "Sync This Extension"), original: `Sync This Extension` },
					menu: {
						id: MenuId.ExtensionContext,
						group: '2_configure',
						when: ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, ContextKeyExpr.has('inExtensionEditor').negate())
					},
				});
			}

			async run(accessor: ServicesAccessor, id: string) {
				const extensionsWorkbenchService = accessor.get(IExtensionsWorkbenchService);
				const extension = extensionsWorkbenchService.local.find(e => areSameExtensions({ id }, e.identifier));
				if (extension) {
					return extensionsWorkbenchService.toggleExtensionIgnoredToSync(extension);
				}
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.ignoreRecommendation',
					title: { value: localize('workbench.extensions.action.ignoreRecommendation', "Ignore Recommendation"), original: `Ignore Recommendation` },
					menu: {
						id: MenuId.ExtensionContext,
						group: '3_recommendations',
						when: ContextKeyExpr.has('isExtensionRecommended'),
						order: 1
					},
				});
			}

			async run(accessor: ServicesAccessor, id: string): Promise<any> {
				accessor.get(IExtensionIgnoredRecommendationsService).toggleGlobalIgnoredRecommendation(id, true);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.undoIgnoredRecommendation',
					title: { value: localize('workbench.extensions.action.undoIgnoredRecommendation', "Undo Ignored Recommendation"), original: `Undo Ignored Recommendation` },
					menu: {
						id: MenuId.ExtensionContext,
						group: '3_recommendations',
						when: ContextKeyExpr.has('isUserIgnoredRecommendation'),
						order: 1
					},
				});
			}

			async run(accessor: ServicesAccessor, id: string): Promise<any> {
				accessor.get(IExtensionIgnoredRecommendationsService).toggleGlobalIgnoredRecommendation(id, false);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.addExtensionToWorkspaceRecommendations',
					title: { value: localize('workbench.extensions.action.addExtensionToWorkspaceRecommendations', "Add to Workspace Recommendations"), original: `Add to Workspace Recommendations` },
					menu: {
						id: MenuId.ExtensionContext,
						group: '3_recommendations',
						when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('empty'), ContextKeyExpr.has('isBuiltinExtension').negate(), ContextKeyExpr.has('isExtensionWorkspaceRecommended').negate(), ContextKeyExpr.has('isUserIgnoredRecommendation').negate()),
						order: 2
					},
				});
			}

			run(accessor: ServicesAccessor, id: string): Promise<any> {
				return accessor.get(IWorkpsaceExtensionsConfigService).toggleRecommendation(id);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.removeExtensionFromWorkspaceRecommendations',
					title: { value: localize('workbench.extensions.action.removeExtensionFromWorkspaceRecommendations', "Remove from Workspace Recommendations"), original: `Remove from Workspace Recommendations` },
					menu: {
						id: MenuId.ExtensionContext,
						group: '3_recommendations',
						when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('empty'), ContextKeyExpr.has('isBuiltinExtension').negate(), ContextKeyExpr.has('isExtensionWorkspaceRecommended')),
						order: 2
					},
				});
			}

			run(accessor: ServicesAccessor, id: string): Promise<any> {
				return accessor.get(IWorkpsaceExtensionsConfigService).toggleRecommendation(id);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.addToWorkspaceRecommendations',
					title: { value: localize('workbench.extensions.action.addToWorkspaceRecommendations', "Add Extension to Workspace Recommendations"), original: `Add Extension to Workspace Recommendations` },
					category: localize('extensions', "Extensions"),
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('workspace'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
					},
				});
			}

			async run(accessor: ServicesAccessor): Promise<any> {
				const editorService = accessor.get(IEditorService);
				const workpsaceExtensionsConfigService = accessor.get(IWorkpsaceExtensionsConfigService);
				if (!(editorService.activeEditor instanceof ExtensionsInput)) {
					return;
				}
				const extensionId = editorService.activeEditor.extension.identifier.id.toLowerCase();
				const recommendations = await workpsaceExtensionsConfigService.getRecommendations();
				if (recommendations.includes(extensionId)) {
					return;
				}
				await workpsaceExtensionsConfigService.toggleRecommendation(extensionId);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.addToWorkspaceFolderRecommendations',
					title: { value: localize('workbench.extensions.action.addToWorkspaceFolderRecommendations', "Add Extension to Workspace Folder Recommendations"), original: `Add Extension to Workspace Folder Recommendations` },
					category: localize('extensions', "Extensions"),
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('folder'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
					},
				});
			}

			async run(accessor: ServicesAccessor): Promise<any> {
				return accessor.get(ICommandService).executeCommand('workbench.extensions.action.addToWorkspaceRecommendations');
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.addToWorkspaceIgnoredRecommendations',
					title: { value: localize('workbench.extensions.action.addToWorkspaceIgnoredRecommendations', "Add Extension to Workspace Ignored Recommendations"), original: `Add Extension to Workspace Ignored Recommendations` },
					category: localize('extensions', "Extensions"),
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('workspace'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
					},
				});
			}

			async run(accessor: ServicesAccessor): Promise<any> {
				const editorService = accessor.get(IEditorService);
				const workpsaceExtensionsConfigService = accessor.get(IWorkpsaceExtensionsConfigService);
				if (!(editorService.activeEditor instanceof ExtensionsInput)) {
					return;
				}
				const extensionId = editorService.activeEditor.extension.identifier.id.toLowerCase();
				const unwatedRecommendations = await workpsaceExtensionsConfigService.getUnwantedRecommendations();
				if (unwatedRecommendations.includes(extensionId)) {
					return;
				}
				await workpsaceExtensionsConfigService.toggleUnwantedRecommendation(extensionId);
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: 'workbench.extensions.action.addToWorkspaceFolderIgnoredRecommendations',
					title: { value: localize('workbench.extensions.action.addToWorkspaceFolderIgnoredRecommendations', "Add Extension to Workspace Folder Ignored Recommendations"), original: `Add Extension to Workspace Folder Ignored Recommendations` },
					category: localize('extensions', "Extensions"),
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('folder'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
					},
				});
			}

			run(accessor: ServicesAccessor): Promise<any> {
				return accessor.get(ICommandService).executeCommand('workbench.extensions.action.addToWorkspaceIgnoredRecommendations');
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: ConfigureWorkspaceRecommendedExtensionsAction.ID,
					title: { value: ConfigureWorkspaceRecommendedExtensionsAction.LABEL, original: 'Configure Recommended Extensions (Workspace)' },
					category: localize('extensions', "Extensions"),
					menu: {
						id: MenuId.CommandPalette,
						when: WorkbenchStateContext.isEqualTo('workspace'),
					},
				});
			}

			run(accessor: ServicesAccessor): Promise<any> {
				return accessor.get(IInstantiationService).createInstance(ConfigureWorkspaceRecommendedExtensionsAction, ConfigureWorkspaceRecommendedExtensionsAction.ID, ConfigureWorkspaceRecommendedExtensionsAction.LABEL).run();
			}
		});

		registerAction2(class extends Action2 {

			constructor() {
				super({
					id: ConfigureWorkspaceFolderRecommendedExtensionsAction.ID,
					title: { value: ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL, original: 'Configure Recommended Extensions (Workspace Folder)' },
					category: localize('extensions', "Extensions"),
					menu: {
						id: MenuId.CommandPalette,
						when: WorkbenchStateContext.notEqualsTo('empty'),
					},
				});
			}

			run(accessor: ServicesAccessor): Promise<any> {
				return accessor.get(IInstantiationService).createInstance(ConfigureWorkspaceFolderRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction.ID, ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL).run();
			}
		});
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(ExtensionsContributions, LifecyclePhase.Starting);
workbenchRegistry.registerWorkbenchContribution(StatusUpdater, LifecyclePhase.Restored);
workbenchRegistry.registerWorkbenchContribution(MaliciousExtensionChecker, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(KeymapExtensions, LifecyclePhase.Restored);
workbenchRegistry.registerWorkbenchContribution(ExtensionsViewletViewsContribution, LifecyclePhase.Starting);
workbenchRegistry.registerWorkbenchContribution(ExtensionActivationProgress, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(ExtensionDependencyChecker, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(RemoteExtensionsInstaller, LifecyclePhase.Eventually);

// Running Extensions
const actionRegistry = Registry.as<IWorkbenchActionRegistry>(WorkbenchActionExtensions.WorkbenchActions);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(ShowRuntimeExtensionsAction), 'Show Running Extensions', CATEGORIES.Developer.value);
