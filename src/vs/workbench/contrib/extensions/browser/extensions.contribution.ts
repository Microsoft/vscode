/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncActionDescriptor, MenuRegistry, MenuId, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ExtensionsLabel, ExtensionsChannelId, PreferencesLabel, IExtensionManagementService, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionManagementServerService, IExtensionRecommendationsService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IWorkbenchActionRegistry, Extensions as WorkbenchActionExtensions } from 'vs/workbench/common/actions';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IOutputChannelRegistry, Extensions as OutputExtensions } from 'vs/workbench/services/output/common/output';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { VIEWLET_ID, IExtensionsWorkbenchService, IExtensionsViewPaneContainer, TOGGLE_IGNORE_EXTENSION_ACTION_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { ExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/browser/extensionsWorkbenchService';
import {
	OpenExtensionsViewletAction, InstallExtensionsAction, ShowOutdatedExtensionsAction, ShowRecommendedExtensionsAction, ShowRecommendedKeymapExtensionsAction, ShowPopularExtensionsAction,
	ShowEnabledExtensionsAction, ShowInstalledExtensionsAction, ShowDisabledExtensionsAction, ShowBuiltInExtensionsAction, UpdateAllAction,
	EnableAllAction, EnableAllWorkspaceAction, DisableAllAction, DisableAllWorkspaceAction, CheckForUpdatesAction, ShowLanguageExtensionsAction, ShowAzureExtensionsAction, EnableAutoUpdateAction, DisableAutoUpdateAction, ConfigureRecommendedExtensionsCommandsContributor, InstallVSIXAction, ReinstallAction, InstallSpecificVersionOfExtensionAction
} from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { ExtensionsInput } from 'vs/workbench/contrib/extensions/common/extensionsInput';
import { ExtensionEditor } from 'vs/workbench/contrib/extensions/browser/extensionEditor';
import { StatusUpdater, MaliciousExtensionChecker, ExtensionsViewletViewsContribution, ExtensionsViewPaneContainer } from 'vs/workbench/contrib/extensions/browser/extensionsViewlet';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import * as jsonContributionRegistry from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { ExtensionsConfigurationSchema, ExtensionsConfigurationSchemaId } from 'vs/workbench/contrib/extensions/common/extensionsFileTemplate';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeymapExtensions } from 'vs/workbench/contrib/extensions/common/extensionsUtils';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { EditorDescriptor, IEditorRegistry, Extensions as EditorExtensions } from 'vs/workbench/browser/editor';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ExtensionActivationProgress } from 'vs/workbench/contrib/extensions/browser/extensionsActivationProgress';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ExtensionDependencyChecker } from 'vs/workbench/contrib/extensions/browser/extensionsDependencyChecker';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { RemoteExtensionsInstaller } from 'vs/workbench/contrib/extensions/browser/remoteExtensionsInstaller';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions } from 'vs/workbench/common/views';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { CONTEXT_SYNC_ENABLEMENT } from 'vs/platform/userDataSync/common/userDataSync';
import { IQuickAccessRegistry, Extensions } from 'vs/platform/quickinput/common/quickAccess';
import { InstallExtensionQuickAccessProvider, ManageExtensionsQuickAccessProvider } from 'vs/workbench/contrib/extensions/browser/extensionsQuickAccess';
import { ExtensionRecommendationsService } from 'vs/workbench/contrib/extensions/browser/extensionRecommendationsService';

// Singletons
registerSingleton(IExtensionsWorkbenchService, ExtensionsWorkbenchService);
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
		name: localize('extensions', "Extensions"),
		ctorDescriptor: new SyncDescriptor(ExtensionsViewPaneContainer),
		icon: 'codicon-extensions',
		order: 4,
		rejectAddedViews: true,
		alwaysUseContainerInfo: true
	}, ViewContainerLocation.Sidebar);


// Global actions
const actionRegistry = Registry.as<IWorkbenchActionRegistry>(WorkbenchActionExtensions.WorkbenchActions);

const openViewletActionDescriptor = SyncActionDescriptor.from(OpenExtensionsViewletAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_X });
actionRegistry.registerWorkbenchAction(openViewletActionDescriptor, 'View: Show Extensions', localize('view', "View"));

const installActionDescriptor = SyncActionDescriptor.from(InstallExtensionsAction);
actionRegistry.registerWorkbenchAction(installActionDescriptor, 'Extensions: Install Extensions', ExtensionsLabel);

const listOutdatedActionDescriptor = SyncActionDescriptor.from(ShowOutdatedExtensionsAction);
actionRegistry.registerWorkbenchAction(listOutdatedActionDescriptor, 'Extensions: Show Outdated Extensions', ExtensionsLabel);

const recommendationsActionDescriptor = SyncActionDescriptor.from(ShowRecommendedExtensionsAction);
actionRegistry.registerWorkbenchAction(recommendationsActionDescriptor, 'Extensions: Show Recommended Extensions', ExtensionsLabel);

const keymapRecommendationsActionDescriptor = SyncActionDescriptor.from(ShowRecommendedKeymapExtensionsAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_M) });
actionRegistry.registerWorkbenchAction(keymapRecommendationsActionDescriptor, 'Preferences: Keymaps', PreferencesLabel);

const languageExtensionsActionDescriptor = SyncActionDescriptor.from(ShowLanguageExtensionsAction);
actionRegistry.registerWorkbenchAction(languageExtensionsActionDescriptor, 'Preferences: Language Extensions', PreferencesLabel);

const azureExtensionsActionDescriptor = SyncActionDescriptor.from(ShowAzureExtensionsAction);
actionRegistry.registerWorkbenchAction(azureExtensionsActionDescriptor, 'Preferences: Azure Extensions', PreferencesLabel);

const popularActionDescriptor = SyncActionDescriptor.from(ShowPopularExtensionsAction);
actionRegistry.registerWorkbenchAction(popularActionDescriptor, 'Extensions: Show Popular Extensions', ExtensionsLabel);

const enabledActionDescriptor = SyncActionDescriptor.from(ShowEnabledExtensionsAction);
actionRegistry.registerWorkbenchAction(enabledActionDescriptor, 'Extensions: Show Enabled Extensions', ExtensionsLabel);

const installedActionDescriptor = SyncActionDescriptor.from(ShowInstalledExtensionsAction);
actionRegistry.registerWorkbenchAction(installedActionDescriptor, 'Extensions: Show Installed Extensions', ExtensionsLabel);

const disabledActionDescriptor = SyncActionDescriptor.from(ShowDisabledExtensionsAction);
actionRegistry.registerWorkbenchAction(disabledActionDescriptor, 'Extensions: Show Disabled Extensions', ExtensionsLabel);

const builtinActionDescriptor = SyncActionDescriptor.from(ShowBuiltInExtensionsAction);
actionRegistry.registerWorkbenchAction(builtinActionDescriptor, 'Extensions: Show Built-in Extensions', ExtensionsLabel);

const updateAllActionDescriptor = SyncActionDescriptor.from(UpdateAllAction);
actionRegistry.registerWorkbenchAction(updateAllActionDescriptor, 'Extensions: Update All Extensions', ExtensionsLabel);

const installVSIXActionDescriptor = SyncActionDescriptor.from(InstallVSIXAction);
actionRegistry.registerWorkbenchAction(installVSIXActionDescriptor, 'Extensions: Install from VSIX...', ExtensionsLabel);

const disableAllAction = SyncActionDescriptor.from(DisableAllAction);
actionRegistry.registerWorkbenchAction(disableAllAction, 'Extensions: Disable All Installed Extensions', ExtensionsLabel);

const disableAllWorkspaceAction = SyncActionDescriptor.from(DisableAllWorkspaceAction);
actionRegistry.registerWorkbenchAction(disableAllWorkspaceAction, 'Extensions: Disable All Installed Extensions for this Workspace', ExtensionsLabel);

const enableAllAction = SyncActionDescriptor.from(EnableAllAction);
actionRegistry.registerWorkbenchAction(enableAllAction, 'Extensions: Enable All Extensions', ExtensionsLabel);

const enableAllWorkspaceAction = SyncActionDescriptor.from(EnableAllWorkspaceAction);
actionRegistry.registerWorkbenchAction(enableAllWorkspaceAction, 'Extensions: Enable All Extensions for this Workspace', ExtensionsLabel);

const checkForUpdatesAction = SyncActionDescriptor.from(CheckForUpdatesAction);
actionRegistry.registerWorkbenchAction(checkForUpdatesAction, `Extensions: Check for Extension Updates`, ExtensionsLabel);

actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(EnableAutoUpdateAction), `Extensions: Enable Auto Updating Extensions`, ExtensionsLabel);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(DisableAutoUpdateAction), `Extensions: Disable Auto Updating Extensions`, ExtensionsLabel);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(InstallSpecificVersionOfExtensionAction), 'Install Specific Version of Extension...', ExtensionsLabel);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(ReinstallAction), 'Reinstall Extension...', localize('developer', "Developer"));

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
				description: localize('extensionsShowRecommendationsOnlyOnDemand', "When enabled, recommendations will not be fetched or shown unless specifically requested by the user. Some recommendations are fetched from a Microsoft online service."),
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
		const installed = await extensionManagementService.getInstalled(ExtensionType.User);
		const [extensionToUninstall] = installed.filter(e => areSameExtensions(e.identifier, { id }));
		if (!extensionToUninstall) {
			throw new Error(localize('notInstalled', "Extension '{0}' is not installed. Make sure you use the full extension ID, including the publisher, e.g.: ms-dotnettools.csharp.", id));
		}

		try {
			await extensionManagementService.uninstall(extensionToUninstall, true);
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

// Extension Context Menu

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
				when: CONTEXT_SYNC_ENABLEMENT
			},
		});
	}

	async run(accessor: ServicesAccessor, id: string) {
		const configurationService = accessor.get(IConfigurationService);
		const ignoredExtensions = [...configurationService.getValue<string[]>('sync.ignoredExtensions')];
		const index = ignoredExtensions.findIndex(ignoredExtension => areSameExtensions({ id: ignoredExtension }, { id }));
		if (index !== -1) {
			ignoredExtensions.splice(index, 1);
		} else {
			ignoredExtensions.push(id);
		}
		return configurationService.updateValue('sync.ignoredExtensions', ignoredExtensions.length ? ignoredExtensions : undefined, ConfigurationTarget.USER);
	}
});

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);

class ExtensionsContributions implements IWorkbenchContribution {

	constructor(
		@IExtensionManagementServerService extensionManagementServerService: IExtensionManagementServerService
	) {

		const canManageExtensions = extensionManagementServerService.localExtensionManagementServer || extensionManagementServerService.remoteExtensionManagementServer;

		if (canManageExtensions) {
			Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess).registerQuickAccessProvider({
				ctor: InstallExtensionQuickAccessProvider,
				prefix: InstallExtensionQuickAccessProvider.PREFIX,
				placeholder: localize('installExtensionQuickAccessPlaceholder', "Type the name of an extension to install or search."),
				helpEntries: [{ description: localize('installExtensionQuickAccessHelp', "Install or Search Extensions"), needsEditor: false }]
			});
		}
	}
}

workbenchRegistry.registerWorkbenchContribution(ExtensionsContributions, LifecyclePhase.Starting);
workbenchRegistry.registerWorkbenchContribution(StatusUpdater, LifecyclePhase.Restored);
workbenchRegistry.registerWorkbenchContribution(MaliciousExtensionChecker, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(ConfigureRecommendedExtensionsCommandsContributor, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(KeymapExtensions, LifecyclePhase.Restored);
workbenchRegistry.registerWorkbenchContribution(ExtensionsViewletViewsContribution, LifecyclePhase.Starting);
workbenchRegistry.registerWorkbenchContribution(ExtensionActivationProgress, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(ExtensionDependencyChecker, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(RemoteExtensionsInstaller, LifecyclePhase.Eventually);
