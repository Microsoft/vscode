/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { MenuRegistry, MenuId, registerAction2, Action2, ISubmenuItem, IMenuItem, IAction2Options } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ExtensionsLabel, ExtensionsLocalizedLabel, ExtensionsChannelId, IExtensionManagementService, IExtensionGalleryService, PreferencesLocalizedLabel, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { EnablementState, IExtensionManagementServerService, IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionIgnoredRecommendationsService, IExtensionRecommendationsService } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IOutputChannelRegistry, Extensions as OutputExtensions } from 'vs/workbench/services/output/common/output';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { VIEWLET_ID, IExtensionsWorkbenchService, IExtensionsViewPaneContainer, TOGGLE_IGNORE_EXTENSION_ACTION_ID, INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID, DefaultViewsContext, ExtensionsSortByContext, WORKSPACE_RECOMMENDATIONS_VIEW_ID, IWorkspaceRecommendedExtensionsView, AutoUpdateConfigurationKey, HasOutdatedExtensionsContext, SELECT_INSTALL_VSIX_EXTENSION_COMMAND_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { ReinstallAction, InstallSpecificVersionOfExtensionAction, ConfigureWorkspaceRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction, PromptExtensionInstallFailureAction, SearchExtensionsAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
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
import { EditorDescriptor, IEditorRegistry } from 'vs/workbench/browser/editor';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ExtensionActivationProgress } from 'vs/workbench/contrib/extensions/browser/extensionsActivationProgress';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ExtensionDependencyChecker } from 'vs/workbench/contrib/extensions/browser/extensionsDependencyChecker';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsService } from 'vs/workbench/common/views';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { ContextKeyAndExpr, ContextKeyDefinedExpr, ContextKeyEqualsExpr, ContextKeyExpr, ContextKeyNotEqualsExpr, ContextKeyOrExpr, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
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
import { CATEGORIES } from 'vs/workbench/common/actions';
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
import { ExtensionEnablementByWorkspaceTrustRequirement } from 'vs/workbench/contrib/extensions/browser/extensionEnablementByWorkspaceTrustRequirement';
import { clearSearchResultsIcon, configureRecommendedIcon, extensionsViewIcon, filterIcon, installWorkspaceRecommendedIcon, refreshIcon } from 'vs/workbench/contrib/extensions/browser/extensionsIcons';
import { EXTENSION_CATEGORIES } from 'vs/platform/extensions/common/extensions';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { isArray } from 'vs/base/common/types';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDialogService, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { Query } from 'vs/workbench/contrib/extensions/common/extensionQuery';
import { Promises } from 'vs/base/common/async';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { WORKSPACE_TRUST_EXTENSION_SUPPORT } from 'vs/workbench/services/workspaces/common/workspaceTrust';
import { ExtensionsCompletionItemsProvider } from 'vs/workbench/contrib/extensions/browser/extensionsCompletionItemsProvider';

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
		title: localize('extensions', "Extensions"),
		openCommandActionDescriptor: {
			id: VIEWLET_ID,
			mnemonicTitle: localize({ key: 'miViewExtensions', comment: ['&& denotes a mnemonic'] }, "E&&xtensions"),
			keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_X },
			order: 4,
		},
		ctorDescriptor: new SyncDescriptor(ExtensionsViewPaneContainer),
		icon: extensionsViewIcon,
		order: 4,
		rejectAddedViews: true,
		alwaysUseContainerInfo: true,
	}, ViewContainerLocation.Sidebar);


Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'extensions',
		order: 30,
		title: localize('extensionsConfigurationTitle', "Extensions"),
		type: 'object',
		properties: {
			'extensions.autoUpdate': {
				enum: [true, 'onlyEnabledExtensions', false,],
				enumItemLabels: [
					localize('all', "All Extensions"),
					localize('enabled', "Only Enabled Extensions"),
					localize('none', "None"),
				],
				enumDescriptions: [
					localize('extensions.autoUpdate.true', 'Download and install updates automatically for all extensions.'),
					localize('extensions.autoUpdate.enabled', 'Download and install updates automatically only for enabled extensions. Disabled extensions will not be updated automatically.'),
					localize('extensions.autoUpdate.false', 'Extensions are not automatically updated.'),
				],
				description: localize('extensions.autoUpdate', "Controls the automatic update behavior of extensions. The updates are fetched from a Microsoft online service."),
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
				default: [],
				scope: ConfigurationScope.APPLICATION
			},
			'extensions.webWorker': {
				type: 'boolean',
				description: localize('extensionsWebWorker', "Enable web worker extension host."),
				default: false
			},
			'extensions.supportVirtualWorkspaces': {
				type: 'object',
				markdownDescription: localize('extensions.supportVirtualWorkspaces', "Override the virtual workspaces support of an extension."),
				patternProperties: {
					'([a-z0-9A-Z][a-z0-9\-A-Z]*)\\.([a-z0-9A-Z][a-z0-9\-A-Z]*)$': {
						type: 'boolean',
						default: false
					}
				},
				default: {
					'pub.name': false
				}
			},
			[WORKSPACE_TRUST_EXTENSION_SUPPORT]: {
				type: 'object',
				scope: ConfigurationScope.APPLICATION,
				markdownDescription: localize('extensions.supportUntrustedWorkspaces', "Override the untrusted workpace support of an extension. Extensions using `true` will always be enabled. Extensions using `limited` will always be enabled, and the extension will hide functionality that requires trust. Extensions using `false` will only be enabled only when the workspace is trusted."),
				patternProperties: {
					'([a-z0-9A-Z][a-z0-9\-A-Z]*)\\.([a-z0-9A-Z][a-z0-9\-A-Z]*)$': {
						type: 'object',
						properties: {
							'supported': {
								type: ['boolean', 'string'],
								enum: [true, false, 'limited'],
								enumDescriptions: [
									localize('extensions.supportUntrustedWorkspaces.true', "Extension will always be enabled."),
									localize('extensions.supportUntrustedWorkspaces.false', "Extension will only be enabled only when the workspace is trusted."),
									localize('extensions.supportUntrustedWorkspaces.limited', "Extension will always be enabled, and the extension will hide functionality requiring trust."),
								],
								description: localize('extensions.supportUntrustedWorkspaces.supported', "Defines the untrusted workspace support setting for the extension."),
							},
							'version': {
								type: 'string',
								description: localize('extensions.supportUntrustedWorkspaces.version', "Defines the version of the extension for which the override should be applied. If not specified, the override will be applied independent of the extension version."),
							}
						}
					}
				}
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

function overrideActionForActiveExtensionEditorWebview(command: MultiCommand | undefined, f: (webview: Webview) => void) {
	command?.addImplementation(105, 'extensions-editor', (accessor) => {
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

interface IExtensionActionOptions extends IAction2Options {
	menuTitles?: { [id: number]: string };
	run(accessor: ServicesAccessor, ...args: any[]): Promise<any>;
}

class ExtensionsContributions extends Disposable implements IWorkbenchContribution {

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewletService private readonly viewletService: IViewletService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
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
		this._register(MenuRegistry.appendMenuItems([{
			id: MenuId.MenubarPreferencesMenu,
			item: {
				command: {
					id: VIEWLET_ID,
					title: localize({ key: 'miPreferencesExtensions', comment: ['&& denotes a mnemonic'] }, "&&Extensions")
				},
				group: '1_settings',
				order: 3
			}
		}, {
			id: MenuId.GlobalActivity,
			item: {
				command: {
					id: VIEWLET_ID,
					title: localize('showExtensions', "Extensions")
				},
				group: '2_configuration',
				order: 3
			}
		}]));

		this.registerExtensionAction({
			id: 'workbench.extensions.action.installExtensions',
			title: { value: localize('installExtensions', "Install Extensions"), original: 'Install Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			},
			run: async (accessor: ServicesAccessor) => {
				accessor.get(IViewsService).openViewContainer(VIEWLET_ID);
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showRecommendedKeymapExtensions',
			title: { value: localize('showRecommendedKeymapExtensionsShort', "Keymaps"), original: 'Keymaps' },
			category: PreferencesLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: CONTEXT_HAS_GALLERY
			}, {
				id: MenuId.MenubarPreferencesMenu,
				group: '2_keybindings',
				order: 2
			}, {
				id: MenuId.GlobalActivity,
				group: '2_keybindings',
				order: 2
			}],
			keybinding: {
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_M),
				weight: KeybindingWeight.WorkbenchContrib
			},
			menuTitles: {
				[MenuId.MenubarPreferencesMenu.id]: localize({ key: 'miOpenKeymapExtensions', comment: ['&& denotes a mnemonic'] }, "&&Keymaps"),
				[MenuId.GlobalActivity.id]: localize('miOpenKeymapExtensions2', "Keymaps")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@recommended:keymaps '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showLanguageExtensions',
			title: { value: localize('showLanguageExtensionsShort', "Language Extensions"), original: 'Language Extensions' },
			category: PreferencesLocalizedLabel,
			menu: {
				id: MenuId.CommandPalette,
				when: CONTEXT_HAS_GALLERY
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@category:"programming languages" @sort:installs '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.checkForUpdates',
			title: { value: localize('checkForUpdates', "Check for Extension Updates"), original: 'Check for Extension Updates' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			}, {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
				group: '1_updates',
				order: 1
			}],
			run: async () => {
				await this.extensionsWorkbenchService.checkForUpdates();
				const outdated = this.extensionsWorkbenchService.outdated;
				if (outdated.length) {
					return runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@outdated '));
				} else {
					return this.dialogService.show(Severity.Info, localize('noUpdatesAvailable', "All extensions are up to date."), []);
				}
			}
		});

		const autoUpdateExtensionsSubMenu = new MenuId('autoUpdateExtensionsSubMenu');
		MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, <ISubmenuItem>{
			submenu: autoUpdateExtensionsSubMenu,
			title: localize('configure auto updating extensions', "Auto Update Extensions"),
			when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
			group: '1_updates',
			order: 5,
		});

		this.registerExtensionAction({
			id: 'configureExtensionsAutoUpdate.all',
			title: localize('configureExtensionsAutoUpdate.all', "All Extensions"),
			toggled: ContextKeyAndExpr.create([ContextKeyDefinedExpr.create(`config.${AutoUpdateConfigurationKey}`), ContextKeyNotEqualsExpr.create(`config.${AutoUpdateConfigurationKey}`, 'onlyEnabledExtensions')]),
			menu: [{
				id: autoUpdateExtensionsSubMenu,
				order: 1,
			}],
			run: (accessor: ServicesAccessor) => accessor.get(IConfigurationService).updateValue(AutoUpdateConfigurationKey, true)
		});

		this.registerExtensionAction({
			id: 'configureExtensionsAutoUpdate.enabled',
			title: localize('configureExtensionsAutoUpdate.enabled', "Only Enabled Extensions"),
			toggled: ContextKeyEqualsExpr.create(`config.${AutoUpdateConfigurationKey}`, 'onlyEnabledExtensions'),
			menu: [{
				id: autoUpdateExtensionsSubMenu,
				order: 2,
			}],
			run: (accessor: ServicesAccessor) => accessor.get(IConfigurationService).updateValue(AutoUpdateConfigurationKey, 'onlyEnabledExtensions')
		});

		this.registerExtensionAction({
			id: 'configureExtensionsAutoUpdate.none',
			title: localize('configureExtensionsAutoUpdate.none', "None"),
			toggled: ContextKeyEqualsExpr.create(`config.${AutoUpdateConfigurationKey}`, false),
			menu: [{
				id: autoUpdateExtensionsSubMenu,
				order: 3,
			}],
			run: (accessor: ServicesAccessor) => accessor.get(IConfigurationService).updateValue(AutoUpdateConfigurationKey, false)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.updateAllExtensions',
			title: { value: localize('updateAll', "Update All Extensions"), original: 'Update All Extensions' },
			category: ExtensionsLocalizedLabel,
			precondition: HasOutdatedExtensionsContext,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			}, {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyAndExpr.create([ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), ContextKeyOrExpr.create([ContextKeyDefinedExpr.create(`config.${AutoUpdateConfigurationKey}`).negate(), ContextKeyEqualsExpr.create(`config.${AutoUpdateConfigurationKey}`, 'onlyEnabledExtensions')])]),
				group: '1_updates',
				order: 2
			}],
			run: () => {
				return Promise.all(this.extensionsWorkbenchService.outdated.map(async extension => {
					try {
						await this.extensionsWorkbenchService.install(extension);
					} catch (err) {
						runAction(this.instantiationService.createInstance(PromptExtensionInstallFailureAction, extension, extension.latestVersion, InstallOperation.Update, err));
					}
				}));
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.disableAutoUpdate',
			title: { value: localize('disableAutoUpdate', "Disable Auto Update for all extensions"), original: 'Disable Auto Update for all extensions' },
			category: ExtensionsLocalizedLabel,
			f1: true,
			run: (accessor: ServicesAccessor) => accessor.get(IConfigurationService).updateValue(AutoUpdateConfigurationKey, false)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.enableAutoUpdate',
			title: { value: localize('enableAutoUpdate', "Enable Auto Update for all extensions"), original: 'Enable Auto Update for all extensions' },
			category: ExtensionsLocalizedLabel,
			f1: true,
			run: (accessor: ServicesAccessor) => accessor.get(IConfigurationService).updateValue(AutoUpdateConfigurationKey, true)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.enableAll',
			title: { value: localize('enableAll', "Enable All Extensions"), original: 'Enable All Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
				group: '2_enablement',
				order: 1
			}],
			run: async () => {
				const extensionsToEnable = this.extensionsWorkbenchService.local.filter(e => !!e.local && this.extensionEnablementService.canChangeEnablement(e.local) && !this.extensionEnablementService.isEnabled(e.local));
				if (extensionsToEnable.length) {
					await this.extensionsWorkbenchService.setEnablement(extensionsToEnable, EnablementState.EnabledGlobally);
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.enableAllWorkspace',
			title: { value: localize('enableAllWorkspace', "Enable All Extensions for this Workspace"), original: 'Enable All Extensions for this Workspace' },
			category: ExtensionsLocalizedLabel,
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([WorkbenchStateContext.notEqualsTo('empty'), ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			},
			run: async () => {
				const extensionsToEnable = this.extensionsWorkbenchService.local.filter(e => !!e.local && this.extensionEnablementService.canChangeEnablement(e.local) && !this.extensionEnablementService.isEnabled(e.local));
				if (extensionsToEnable.length) {
					await this.extensionsWorkbenchService.setEnablement(extensionsToEnable, EnablementState.EnabledWorkspace);
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.disableAll',
			title: { value: localize('disableAll', "Disable All Installed Extensions"), original: 'Disable All Installed Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
				group: '2_enablement',
				order: 2
			}],
			run: async () => {
				const extensionsToDisable = this.extensionsWorkbenchService.local.filter(e => !e.isBuiltin && !!e.local && this.extensionEnablementService.isEnabled(e.local) && this.extensionEnablementService.canChangeEnablement(e.local));
				if (extensionsToDisable.length) {
					await this.extensionsWorkbenchService.setEnablement(extensionsToDisable, EnablementState.DisabledGlobally);
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.disableAllWorkspace',
			title: { value: localize('disableAllWorkspace', "Disable All Installed Extensions for this Workspace"), original: 'Disable All Installed Extensions for this Workspace' },
			category: ExtensionsLocalizedLabel,
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([WorkbenchStateContext.notEqualsTo('empty'), ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			},
			run: async () => {
				const extensionsToDisable = this.extensionsWorkbenchService.local.filter(e => !e.isBuiltin && !!e.local && this.extensionEnablementService.isEnabled(e.local) && this.extensionEnablementService.canChangeEnablement(e.local));
				if (extensionsToDisable.length) {
					await this.extensionsWorkbenchService.setEnablement(extensionsToDisable, EnablementState.DisabledWorkspace);
				}
			}
		});

		this.registerExtensionAction({
			id: SELECT_INSTALL_VSIX_EXTENSION_COMMAND_ID,
			title: { value: localize('InstallFromVSIX', "Install from VSIX..."), original: 'Install from VSIX...' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER])
			}, {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyAndExpr.create([ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER])]),
				group: '3_install',
				order: 1
			}],
			run: async (accessor: ServicesAccessor) => {
				const fileDialogService = accessor.get(IFileDialogService);
				const commandService = accessor.get(ICommandService);
				const vsixPaths = await fileDialogService.showOpenDialog({
					title: localize('installFromVSIX', "Install from VSIX"),
					filters: [{ name: 'VSIX Extensions', extensions: ['vsix'] }],
					canSelectFiles: true,
					canSelectMany: true,
					openLabel: mnemonicButtonLabel(localize({ key: 'installButton', comment: ['&& denotes a mnemonic'] }, "&&Install"))
				});
				if (vsixPaths) {
					await commandService.executeCommand(INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID, vsixPaths);
				}
			}
		});

		this.registerExtensionAction({
			id: INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID,
			title: localize('installVSIX', "Install Extension VSIX"),
			menu: [{
				id: MenuId.ExplorerContext,
				group: 'extensions',
				when: ContextKeyAndExpr.create([ResourceContextKey.Extension.isEqualTo('.vsix'), ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER])]),
			}],
			run: async (accessor: ServicesAccessor, resources: URI[] | URI) => {
				const extensionService = accessor.get(IExtensionService);
				const extensionsWorkbenchService = accessor.get(IExtensionsWorkbenchService);
				const hostService = accessor.get(IHostService);
				const notificationService = accessor.get(INotificationService);

				const extensions = Array.isArray(resources) ? resources : [resources];
				await Promises.settled(extensions.map(async (vsix) => await extensionsWorkbenchService.install(vsix)))
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
								actions
							);
						}
					});
			}
		});

		const extensionsFilterSubMenu = new MenuId('extensionsFilterSubMenu');
		MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, <ISubmenuItem>{
			submenu: extensionsFilterSubMenu,
			title: localize('filterExtensions', "Filter Extensions..."),
			when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
			group: 'navigation',
			order: 1,
			icon: filterIcon,
		});

		const showFeaturedExtensionsId = 'extensions.filter.featured';
		this.registerExtensionAction({
			id: showFeaturedExtensionsId,
			title: { value: localize('showFeaturedExtensions', "Show Featured Extensions"), original: 'Show Featured Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: CONTEXT_HAS_GALLERY
			}, {
				id: extensionsFilterSubMenu,
				when: CONTEXT_HAS_GALLERY,
				group: '1_predefined',
				order: 1,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('featured filter', "Featured")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@featured '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showPopularExtensions',
			title: { value: localize('showPopularExtensions', "Show Popular Extensions"), original: 'Show Popular Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: CONTEXT_HAS_GALLERY
			}, {
				id: extensionsFilterSubMenu,
				when: CONTEXT_HAS_GALLERY,
				group: '1_predefined',
				order: 2,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('most popular filter', "Most Popular")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@popular '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showRecommendedExtensions',
			title: { value: localize('showRecommendedExtensions', "Show Recommended Extensions"), original: 'Show Recommended Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: CONTEXT_HAS_GALLERY
			}, {
				id: extensionsFilterSubMenu,
				when: CONTEXT_HAS_GALLERY,
				group: '1_predefined',
				order: 2,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('most popular recommended', "Recommended")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@recommended '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.recentlyPublishedExtensions',
			title: { value: localize('recentlyPublishedExtensions', "Show Recently Published Extensions"), original: 'Show Recently Published Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: CONTEXT_HAS_GALLERY
			}, {
				id: extensionsFilterSubMenu,
				when: CONTEXT_HAS_GALLERY,
				group: '1_predefined',
				order: 2,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('recently published filter', "Recently Published")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@sort:publishedDate '))
		});

		const extensionsCategoryFilterSubMenu = new MenuId('extensionsCategoryFilterSubMenu');
		MenuRegistry.appendMenuItem(extensionsFilterSubMenu, <ISubmenuItem>{
			submenu: extensionsCategoryFilterSubMenu,
			title: localize('filter by category', "Category"),
			when: CONTEXT_HAS_GALLERY,
			group: '2_categories',
			order: 1,
		});

		EXTENSION_CATEGORIES.map((category, index) => {
			this.registerExtensionAction({
				id: `extensions.actions.searchByCategory.${category}`,
				title: category,
				menu: [{
					id: extensionsCategoryFilterSubMenu,
					when: CONTEXT_HAS_GALLERY,
					order: index,
				}],
				run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, `@category:"${category.toLowerCase()}"`))
			});
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.listBuiltInExtensions',
			title: { value: localize('showBuiltInExtensions', "Show Built-in Extensions"), original: 'Show Built-in Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: extensionsFilterSubMenu,
				group: '3_installed',
				order: 1,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('builtin filter', "Built-in")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@builtin '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.listTrustRequiredExtensions',
			title: { value: localize('showTrustRequiredExtensions', "Show Extensions Requiring Trust"), original: 'Show Extensions Requiring Trust' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: extensionsFilterSubMenu,
				group: '3_installed',
				order: 6,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('trust required filter', "Trust Required")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@trustRequired'))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showInstalledExtensions',
			title: { value: localize('showInstalledExtensions', "Show Installed Extensions"), original: 'Show Installed Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: extensionsFilterSubMenu,
				group: '3_installed',
				order: 2,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('installed filter', "Installed")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@installed '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showEnabledExtensions',
			title: { value: localize('showEnabledExtensions', "Show Enabled Extensions"), original: 'Show Enabled Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: extensionsFilterSubMenu,
				group: '3_installed',
				order: 3,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('enabled filter', "Enabled")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@enabled '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.showDisabledExtensions',
			title: { value: localize('showDisabledExtensions', "Show Disabled Extensions"), original: 'Show Disabled Extensions' },
			category: ExtensionsLocalizedLabel,

			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])
			}, {
				id: extensionsFilterSubMenu,
				group: '3_installed',
				order: 4,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('disabled filter', "Disabled")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@disabled '))
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.listOutdatedExtensions',
			title: { value: localize('showOutdatedExtensions', "Show Outdated Extensions"), original: 'Show Outdated Extensions' },
			category: ExtensionsLocalizedLabel,
			menu: [{
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			}, {
				id: extensionsFilterSubMenu,
				group: '3_installed',
				order: 5,
			}],
			menuTitles: {
				[extensionsFilterSubMenu.id]: localize('outdated filter', "Outdated")
			},
			run: () => runAction(this.instantiationService.createInstance(SearchExtensionsAction, '@outdated '))
		});

		const extensionsSortSubMenu = new MenuId('extensionsSortSubMenu');
		MenuRegistry.appendMenuItem(extensionsFilterSubMenu, <ISubmenuItem>{
			submenu: extensionsSortSubMenu,
			title: localize('sorty by', "Sort By"),
			when: CONTEXT_HAS_GALLERY,
			group: '4_sort',
			order: 1,
		});

		[
			{ id: 'installs', title: localize('sort by installs', "Install Count") },
			{ id: 'rating', title: localize('sort by rating', "Rating") },
			{ id: 'name', title: localize('sort by name', "Name") },
			{ id: 'publishedDate', title: localize('sort by date', "Published Date") },
		].map(({ id, title }, index) => {
			this.registerExtensionAction({
				id: `extensions.sort.${id}`,
				title,
				precondition: DefaultViewsContext.toNegated(),
				menu: [{
					id: extensionsSortSubMenu,
					when: CONTEXT_HAS_GALLERY,
					order: index,
				}],
				toggled: ExtensionsSortByContext.isEqualTo(id),
				run: async () => {
					const viewlet = await this.viewletService.openViewlet(VIEWLET_ID, true);
					const extensionsViewPaneContainer = viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer;
					const currentQuery = Query.parse(extensionsViewPaneContainer.searchValue || '');
					extensionsViewPaneContainer.search(new Query(currentQuery.value, id, currentQuery.groupBy).toString());
					extensionsViewPaneContainer.focus();
				}
			});
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.clearExtensionsSearchResults',
			title: { value: localize('clearExtensionsSearchResults', "Clear Extensions Search Results"), original: 'Clear Extensions Search Results' },
			category: ExtensionsLocalizedLabel,
			icon: clearSearchResultsIcon,
			f1: true,
			precondition: DefaultViewsContext.toNegated(),
			menu: {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
				group: 'navigation',
				order: 3,
			},
			run: async (accessor: ServicesAccessor) => {
				const viewPaneContainer = accessor.get(IViewsService).getActiveViewPaneContainerWithId(VIEWLET_ID);
				if (viewPaneContainer) {
					const extensionsViewPaneContainer = viewPaneContainer as IExtensionsViewPaneContainer;
					extensionsViewPaneContainer.search('');
					extensionsViewPaneContainer.focus();
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.refreshExtension',
			title: { value: localize('refreshExtension', "Refresh"), original: 'Refresh' },
			category: ExtensionsLocalizedLabel,
			icon: refreshIcon,
			f1: true,
			menu: {
				id: MenuId.ViewContainerTitle,
				when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
				group: 'navigation',
				order: 2
			},
			run: async (accessor: ServicesAccessor) => {
				const viewPaneContainer = accessor.get(IViewsService).getActiveViewPaneContainerWithId(VIEWLET_ID);
				if (viewPaneContainer) {
					await (viewPaneContainer as IExtensionsViewPaneContainer).refresh();
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.installWorkspaceRecommendedExtensions',
			title: localize('installWorkspaceRecommendedExtensions', "Install Workspace Recommended Extensions"),
			icon: installWorkspaceRecommendedIcon,
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyEqualsExpr.create('view', WORKSPACE_RECOMMENDATIONS_VIEW_ID),
				group: 'navigation',
				order: 1
			},
			run: async (accessor: ServicesAccessor) => {
				const view = accessor.get(IViewsService).getActiveViewWithId(WORKSPACE_RECOMMENDATIONS_VIEW_ID) as IWorkspaceRecommendedExtensionsView;
				return view.installWorkspaceRecommendations();
			}
		});

		this.registerExtensionAction({
			id: ConfigureWorkspaceFolderRecommendedExtensionsAction.ID,
			title: ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL,
			icon: configureRecommendedIcon,
			menu: [{
				id: MenuId.CommandPalette,
				when: WorkbenchStateContext.notEqualsTo('empty'),
			}, {
				id: MenuId.ViewTitle,
				when: ContextKeyEqualsExpr.create('view', WORKSPACE_RECOMMENDATIONS_VIEW_ID),
				group: 'navigation',
				order: 2
			}],
			run: () => runAction(this.instantiationService.createInstance(ConfigureWorkspaceFolderRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction.ID, ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL))
		});

		this.registerExtensionAction({
			id: InstallSpecificVersionOfExtensionAction.ID,
			title: { value: InstallSpecificVersionOfExtensionAction.LABEL, original: 'Install Specific Version of Extension...' },
			category: ExtensionsLocalizedLabel,
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER, CONTEXT_HAS_WEB_SERVER])])
			},
			run: () => runAction(this.instantiationService.createInstance(InstallSpecificVersionOfExtensionAction, InstallSpecificVersionOfExtensionAction.ID, InstallSpecificVersionOfExtensionAction.LABEL))
		});

		this.registerExtensionAction({
			id: ReinstallAction.ID,
			title: { value: ReinstallAction.LABEL, original: 'Reinstall Extension...' },
			category: CATEGORIES.Developer,
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyAndExpr.create([CONTEXT_HAS_GALLERY, ContextKeyOrExpr.create([CONTEXT_HAS_LOCAL_SERVER, CONTEXT_HAS_REMOTE_SERVER])])
			},
			run: () => runAction(this.instantiationService.createInstance(ReinstallAction, ReinstallAction.ID, ReinstallAction.LABEL))
		});
	}

	// Extension Context Menu
	private registerContextMenuActions(): void {
		this.registerExtensionAction({
			id: 'workbench.extensions.action.copyExtension',
			title: { value: localize('workbench.extensions.action.copyExtension', "Copy"), original: 'Copy' },
			menu: {
				id: MenuId.ExtensionContext,
				group: '1_copy'
			},
			run: async (accessor: ServicesAccessor, extensionId: string) => {
				const clipboardService = accessor.get(IClipboardService);
				let extension = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, { id: extensionId }))[0]
					|| (await this.extensionsWorkbenchService.queryGallery({ names: [extensionId], pageSize: 1 }, CancellationToken.None)).firstPage[0];
				if (extension) {
					const name = localize('extensionInfoName', 'Name: {0}', extension.displayName);
					const id = localize('extensionInfoId', 'Id: {0}', extensionId);
					const description = localize('extensionInfoDescription', 'Description: {0}', extension.description);
					const verision = localize('extensionInfoVersion', 'Version: {0}', extension.version);
					const publisher = localize('extensionInfoPublisher', 'Publisher: {0}', extension.publisherDisplayName);
					const link = extension.url ? localize('extensionInfoVSMarketplaceLink', 'VS Marketplace Link: {0}', `${extension.url}`) : null;
					const clipboardStr = `${name}\n${id}\n${description}\n${verision}\n${publisher}${link ? '\n' + link : ''}`;
					await clipboardService.writeText(clipboardStr);
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.copyExtensionId',
			title: { value: localize('workbench.extensions.action.copyExtensionId', "Copy Extension Id"), original: 'Copy Extension Id' },
			menu: {
				id: MenuId.ExtensionContext,
				group: '1_copy'
			},
			run: async (accessor: ServicesAccessor, id: string) => accessor.get(IClipboardService).writeText(id)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.configure',
			title: { value: localize('workbench.extensions.action.configure', "Extension Settings"), original: 'Extension Settings' },
			menu: {
				id: MenuId.ExtensionContext,
				group: '2_configure',
				when: ContextKeyExpr.and(ContextKeyExpr.equals('extensionStatus', 'installed'), ContextKeyExpr.has('extensionHasConfiguration'))
			},
			run: async (accessor: ServicesAccessor, id: string) => accessor.get(IPreferencesService).openSettings(false, `@ext:${id}`)
		});

		this.registerExtensionAction({
			id: TOGGLE_IGNORE_EXTENSION_ACTION_ID,
			title: { value: localize('workbench.extensions.action.toggleIgnoreExtension', "Sync This Extension"), original: `Sync This Extension` },
			menu: {
				id: MenuId.ExtensionContext,
				group: '2_configure',
				when: ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, ContextKeyExpr.has('inExtensionEditor').negate())
			},
			run: async (accessor: ServicesAccessor, id: string) => {
				const extension = this.extensionsWorkbenchService.local.find(e => areSameExtensions({ id }, e.identifier));
				if (extension) {
					return this.extensionsWorkbenchService.toggleExtensionIgnoredToSync(extension);
				}
			}
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.ignoreRecommendation',
			title: { value: localize('workbench.extensions.action.ignoreRecommendation', "Ignore Recommendation"), original: `Ignore Recommendation` },
			menu: {
				id: MenuId.ExtensionContext,
				group: '3_recommendations',
				when: ContextKeyExpr.has('isExtensionRecommended'),
				order: 1
			},
			run: async (accessor: ServicesAccessor, id: string) => accessor.get(IExtensionIgnoredRecommendationsService).toggleGlobalIgnoredRecommendation(id, true)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.undoIgnoredRecommendation',
			title: { value: localize('workbench.extensions.action.undoIgnoredRecommendation', "Undo Ignored Recommendation"), original: `Undo Ignored Recommendation` },
			menu: {
				id: MenuId.ExtensionContext,
				group: '3_recommendations',
				when: ContextKeyExpr.has('isUserIgnoredRecommendation'),
				order: 1
			},
			run: async (accessor: ServicesAccessor, id: string) => accessor.get(IExtensionIgnoredRecommendationsService).toggleGlobalIgnoredRecommendation(id, false)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.addExtensionToWorkspaceRecommendations',
			title: { value: localize('workbench.extensions.action.addExtensionToWorkspaceRecommendations', "Add to Workspace Recommendations"), original: `Add to Workspace Recommendations` },
			menu: {
				id: MenuId.ExtensionContext,
				group: '3_recommendations',
				when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('empty'), ContextKeyExpr.has('isBuiltinExtension').negate(), ContextKeyExpr.has('isExtensionWorkspaceRecommended').negate(), ContextKeyExpr.has('isUserIgnoredRecommendation').negate()),
				order: 2
			},
			run: (accessor: ServicesAccessor, id: string) => accessor.get(IWorkpsaceExtensionsConfigService).toggleRecommendation(id)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.removeExtensionFromWorkspaceRecommendations',
			title: { value: localize('workbench.extensions.action.removeExtensionFromWorkspaceRecommendations', "Remove from Workspace Recommendations"), original: `Remove from Workspace Recommendations` },
			menu: {
				id: MenuId.ExtensionContext,
				group: '3_recommendations',
				when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('empty'), ContextKeyExpr.has('isBuiltinExtension').negate(), ContextKeyExpr.has('isExtensionWorkspaceRecommended')),
				order: 2
			},
			run: (accessor: ServicesAccessor, id: string) => accessor.get(IWorkpsaceExtensionsConfigService).toggleRecommendation(id)
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.addToWorkspaceRecommendations',
			title: { value: localize('workbench.extensions.action.addToWorkspaceRecommendations', "Add Extension to Workspace Recommendations"), original: `Add Extension to Workspace Recommendations` },
			category: localize('extensions', "Extensions"),
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('workspace'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
			},
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

		this.registerExtensionAction({
			id: 'workbench.extensions.action.addToWorkspaceFolderRecommendations',
			title: { value: localize('workbench.extensions.action.addToWorkspaceFolderRecommendations', "Add Extension to Workspace Folder Recommendations"), original: `Add Extension to Workspace Folder Recommendations` },
			category: localize('extensions', "Extensions"),
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('folder'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
			},
			run: () => this.commandService.executeCommand('workbench.extensions.action.addToWorkspaceRecommendations')
		});

		this.registerExtensionAction({
			id: 'workbench.extensions.action.addToWorkspaceIgnoredRecommendations',
			title: { value: localize('workbench.extensions.action.addToWorkspaceIgnoredRecommendations', "Add Extension to Workspace Ignored Recommendations"), original: `Add Extension to Workspace Ignored Recommendations` },
			category: localize('extensions', "Extensions"),
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('workspace'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
			},
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

		this.registerExtensionAction({
			id: 'workbench.extensions.action.addToWorkspaceFolderIgnoredRecommendations',
			title: { value: localize('workbench.extensions.action.addToWorkspaceFolderIgnoredRecommendations', "Add Extension to Workspace Folder Ignored Recommendations"), original: `Add Extension to Workspace Folder Ignored Recommendations` },
			category: localize('extensions', "Extensions"),
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('folder'), ContextKeyExpr.equals('resourceScheme', Schemas.extension)),
			},
			run: () => this.commandService.executeCommand('workbench.extensions.action.addToWorkspaceIgnoredRecommendations')
		});

		this.registerExtensionAction({
			id: ConfigureWorkspaceRecommendedExtensionsAction.ID,
			title: { value: ConfigureWorkspaceRecommendedExtensionsAction.LABEL, original: 'Configure Recommended Extensions (Workspace)' },
			category: localize('extensions', "Extensions"),
			menu: {
				id: MenuId.CommandPalette,
				when: WorkbenchStateContext.isEqualTo('workspace'),
			},
			run: () => runAction(this.instantiationService.createInstance(ConfigureWorkspaceRecommendedExtensionsAction, ConfigureWorkspaceRecommendedExtensionsAction.ID, ConfigureWorkspaceRecommendedExtensionsAction.LABEL))
		});

	}

	private registerExtensionAction(extensionActionOptions: IExtensionActionOptions): IDisposable {
		const menus = extensionActionOptions.menu ? isArray(extensionActionOptions.menu) ? extensionActionOptions.menu : [extensionActionOptions.menu] : [];
		let menusWithOutTitles: ({ id: MenuId } & Omit<IMenuItem, 'command'>)[] = [];
		const menusWithTitles: { id: MenuId, item: IMenuItem }[] = [];
		if (extensionActionOptions.menuTitles) {
			for (let index = 0; index < menus.length; index++) {
				const menu = menus[index];
				const menuTitle = extensionActionOptions.menuTitles[menu.id.id];
				if (menuTitle) {
					menusWithTitles.push({ id: menu.id, item: { ...menu, command: { id: extensionActionOptions.id, title: menuTitle } } });
				} else {
					menusWithOutTitles.push(menu);
				}
			}
		} else {
			menusWithOutTitles = menus;
		}
		const disposables = new DisposableStore();
		disposables.add(registerAction2(class extends Action2 {
			constructor() {
				super({
					...extensionActionOptions,
					menu: menusWithOutTitles
				});
			}
			run(accessor: ServicesAccessor, ...args: any[]): Promise<any> {
				return extensionActionOptions.run(accessor, ...args);
			}
		}));
		if (menusWithTitles.length) {
			disposables.add(MenuRegistry.appendMenuItems(menusWithTitles));
		}
		return disposables;
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
workbenchRegistry.registerWorkbenchContribution(ExtensionEnablementByWorkspaceTrustRequirement, LifecyclePhase.Restored);
workbenchRegistry.registerWorkbenchContribution(ExtensionsCompletionItemsProvider, LifecyclePhase.Restored);

// Running Extensions
registerAction2(ShowRuntimeExtensionsAction);
