/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/extensionActions';
import { localize } from 'vs/nls';
import { IAction, Action } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import * as DOM from 'vs/base/browser/dom';
import { Event } from 'vs/base/common/event';
import * as json from 'vs/base/common/json';
import { ActionViewItem, Separator, IActionViewItemOptions } from 'vs/base/browser/ui/actionbar/actionbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { dispose, Disposable } from 'vs/base/common/lifecycle';
import { IExtension, ExtensionState, IExtensionsWorkbenchService, VIEWLET_ID, IExtensionsViewlet, AutoUpdateConfigurationKey, IExtensionContainer, EXTENSIONS_CONFIG } from 'vs/workbench/contrib/extensions/common/extensions';
import { ExtensionsConfigurationInitialContent } from 'vs/workbench/contrib/extensions/common/extensionsFileTemplate';
import { IExtensionEnablementService, IExtensionTipsService, EnablementState, ExtensionsLabel, IExtensionRecommendation, IGalleryExtension, IExtensionsConfigContent, IExtensionGalleryService, INSTALL_ERROR_MALICIOUS, INSTALL_ERROR_INCOMPATIBLE, IGalleryExtensionVersion, ILocalExtension, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/platform/extensionManagement/common/extensionManagement';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ExtensionType, ExtensionIdentifier, IExtensionDescription, IExtensionManifest, isLanguagePackExtension } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ShowViewletAction } from 'vs/workbench/browser/viewlet';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { Query } from 'vs/workbench/contrib/extensions/common/extensionQuery';
import { IFileService, IFileContent } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IWindowService, IWindowsService } from 'vs/platform/windows/common/windows';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { URI } from 'vs/base/common/uri';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { registerThemingParticipant, ITheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { buttonBackground, buttonForeground, buttonHoverBackground, contrastBorder, registerColor, foreground } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { ITextEditorSelection } from 'vs/platform/editor/common/editor';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { PagedModel } from 'vs/base/common/paging';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { PICK_WORKSPACE_FOLDER_COMMAND_ID } from 'vs/workbench/browser/actions/workspaceCommands';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ExtensionsInput } from 'vs/workbench/contrib/extensions/common/extensionsInput';
import { IQuickPickItem, IQuickInputService, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { coalesce } from 'vs/base/common/arrays';
import { IWorkbenchThemeService, COLOR_THEME_SETTING, ICON_THEME_SETTING, IFileIconTheme, IColorTheme } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { ILabelService } from 'vs/platform/label/common/label';
import { REMOTE_HOST_SCHEME } from 'vs/platform/remote/common/remoteHosts';
import { isUIExtension } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IProductService } from 'vs/platform/product/common/product';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

function toExtensionDescription(local: ILocalExtension): IExtensionDescription {
	return {
		identifier: new ExtensionIdentifier(local.identifier.id),
		isBuiltin: local.type === ExtensionType.System,
		isUnderDevelopment: false,
		extensionLocation: local.location,
		...local.manifest,
		uuid: local.identifier.uuid
	};
}

const promptDownloadManually = (extension: IGalleryExtension | undefined, message: string, error: Error, instantiationService: IInstantiationService, notificationService: INotificationService, openerService: IOpenerService, productService: IProductService) => {
	if (!extension || error.name === INSTALL_ERROR_INCOMPATIBLE || error.name === INSTALL_ERROR_MALICIOUS || !productService.extensionsGallery) {
		return Promise.reject(error);
	} else {
		const downloadUrl = `${productService.extensionsGallery.serviceUrl}/publishers/${extension.publisher}/vsextensions/${extension.name}/${extension.version}/vspackage`;
		notificationService.prompt(Severity.Error, message, [{
			label: localize('download', "Download Manually"),
			run: () => openerService.open(URI.parse(downloadUrl)).then(() => {
				notificationService.prompt(
					Severity.Info,
					localize('install vsix', 'Once downloaded, please manually install the downloaded VSIX of \'{0}\'.', extension.identifier.id),
					[{
						label: InstallVSIXAction.LABEL,
						run: () => {
							const action = instantiationService.createInstance(InstallVSIXAction, InstallVSIXAction.ID, InstallVSIXAction.LABEL);
							action.run();
							action.dispose();
						}
					}]
				);
			})
		}]);
		return Promise.resolve();
	}
};

function getRelativeDateLabel(date: Date): string {
	const delta = new Date().getTime() - date.getTime();

	const year = 365 * 24 * 60 * 60 * 1000;
	if (delta > year) {
		const noOfYears = Math.floor(delta / year);
		return noOfYears > 1 ? localize('noOfYearsAgo', "{0} years ago", noOfYears) : localize('one year ago', "1 year ago");
	}

	const month = 30 * 24 * 60 * 60 * 1000;
	if (delta > month) {
		const noOfMonths = Math.floor(delta / month);
		return noOfMonths > 1 ? localize('noOfMonthsAgo', "{0} months ago", noOfMonths) : localize('one month ago', "1 month ago");
	}

	const day = 24 * 60 * 60 * 1000;
	if (delta > day) {
		const noOfDays = Math.floor(delta / day);
		return noOfDays > 1 ? localize('noOfDaysAgo', "{0} days ago", noOfDays) : localize('one day ago', "1 day ago");
	}

	const hour = 60 * 60 * 1000;
	if (delta > hour) {
		const noOfHours = Math.floor(delta / day);
		return noOfHours > 1 ? localize('noOfHoursAgo', "{0} hours ago", noOfHours) : localize('one hour ago', "1 hour ago");
	}

	if (delta > 0) {
		return localize('just now', "Just now");
	}

	return '';
}

export abstract class ExtensionAction extends Action implements IExtensionContainer {
	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) { this._extension = extension; this.update(); }
	abstract update(): void;
}

export class InstallAction extends ExtensionAction {

	private static INSTALL_LABEL = localize('install', "Install");
	private static INSTALLING_LABEL = localize('installing', "Installing");

	private static readonly Class = 'extension-action prominent install';
	private static readonly InstallingClass = 'extension-action install installing';


	private _manifest: IExtensionManifest | null;
	set manifest(manifest: IExtensionManifest) {
		this._manifest = manifest;
		this.updateLabel();
	}

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IExtensionService private readonly runtimeExtensionService: IExtensionService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@ILabelService private readonly labelService: ILabelService
	) {
		super(`extensions.install`, InstallAction.INSTALL_LABEL, InstallAction.Class, false);
		this.update();
		this._register(this.labelService.onDidChangeFormatters(() => this.updateLabel(), this));
	}

	update(): void {
		if (!this.extension || this.extension.type === ExtensionType.System || this.extension.state === ExtensionState.Installed) {
			this.enabled = false;
			this.class = InstallAction.Class;
			this.label = InstallAction.INSTALL_LABEL;
			return;
		}
		this.enabled = false;
		if (this.extensionsWorkbenchService.canInstall(this.extension)) {
			const local = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, this.extension.identifier))[0];
			this.enabled = !local || (!!local.local && isLanguagePackExtension(local.local.manifest));
		}
		this.class = this.extension.state === ExtensionState.Installing ? InstallAction.InstallingClass : InstallAction.Class;
		this.updateLabel();
	}

	private updateLabel(): void {
		if (this.extension.state === ExtensionState.Installing) {
			this.label = InstallAction.INSTALLING_LABEL;
			this.tooltip = InstallAction.INSTALLING_LABEL;
		} else {
			if (this._manifest && this.workbenchEnvironmentService.configuration.remoteAuthority) {
				if (isUIExtension(this._manifest, this.productService, this.configurationService)) {
					this.label = `${InstallAction.INSTALL_LABEL} ${localize('locally', "Locally")}`;
					this.tooltip = `${InstallAction.INSTALL_LABEL} ${localize('locally', "Locally")}`;
				} else {
					const host = this.labelService.getHostLabel(REMOTE_HOST_SCHEME, this.workbenchEnvironmentService.configuration.remoteAuthority) || localize('remote', "Remote");
					this.label = `${InstallAction.INSTALL_LABEL} on ${host}`;
					this.tooltip = `${InstallAction.INSTALL_LABEL} on ${host}`;
				}
			} else {
				this.label = InstallAction.INSTALL_LABEL;
				this.tooltip = InstallAction.INSTALL_LABEL;
			}
		}
	}

	async run(): Promise<any> {
		this.extensionsWorkbenchService.open(this.extension);

		alert(localize('installExtensionStart', "Installing extension {0} started. An editor is now open with more details on this extension", this.extension.displayName));

		const extension = await this.install(this.extension);

		alert(localize('installExtensionComplete', "Installing extension {0} is completed. Please reload Visual Studio Code to enable it.", this.extension.displayName));

		if (extension && extension.local) {
			const runningExtension = await this.getRunningExtension(extension.local);
			if (runningExtension) {
				const colorThemes = await this.workbenchThemeService.getColorThemes();
				const fileIconThemes = await this.workbenchThemeService.getFileIconThemes();
				if (SetColorThemeAction.getColorThemes(colorThemes, this.extension).length) {
					const action = this.instantiationService.createInstance(SetColorThemeAction, colorThemes);
					action.extension = extension;
					return action.run({ showCurrentTheme: true, ignoreFocusLost: true });
				}
				if (SetFileIconThemeAction.getFileIconThemes(fileIconThemes, this.extension).length) {
					const action = this.instantiationService.createInstance(SetFileIconThemeAction, fileIconThemes);
					action.extension = extension;
					return action.run({ showCurrentTheme: true, ignoreFocusLost: true });
				}
			}
		}

	}

	private install(extension: IExtension): Promise<IExtension | void> {
		return this.extensionsWorkbenchService.install(extension)
			.then(null, err => {
				if (!extension.gallery) {
					return this.notificationService.error(err);
				}

				console.error(err);

				return promptDownloadManually(extension.gallery, localize('failedToInstall', "Failed to install \'{0}\'.", extension.identifier.id), err, this.instantiationService, this.notificationService, this.openerService, this.productService);
			});
	}

	private async getRunningExtension(extension: ILocalExtension): Promise<IExtensionDescription | null> {
		const runningExtension = await this.runtimeExtensionService.getExtension(extension.identifier.id);
		if (runningExtension) {
			return runningExtension;
		}
		if (this.runtimeExtensionService.canAddExtension(toExtensionDescription(extension))) {
			return new Promise<IExtensionDescription | null>((c, e) => {
				const disposable = this.runtimeExtensionService.onDidChangeExtensions(async () => {
					const runningExtension = await this.runtimeExtensionService.getExtension(extension.identifier.id);
					if (runningExtension) {
						disposable.dispose();
						c(runningExtension);
					}
				});
			});
		}
		return null;
	}
}

export class RemoteInstallAction extends ExtensionAction {

	private static INSTALL_LABEL = localize('install', "Install");
	private static INSTALLING_LABEL = localize('installing', "Installing");

	private static readonly Class = 'extension-action prominent install';
	private static readonly InstallingClass = 'extension-action install installing';

	updateWhenCounterExtensionChanges: boolean = true;
	private installing: boolean = false;

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
	) {
		super(`extensions.remoteinstall`, RemoteInstallAction.INSTALL_LABEL, RemoteInstallAction.Class, false);
		this._register(this.labelService.onDidChangeFormatters(() => this.updateLabel(), this));
		this.updateLabel();
		this.update();
	}

	private updateLabel(): void {
		if (this.installing) {
			this.label = RemoteInstallAction.INSTALLING_LABEL;
			this.tooltip = this.label;
			return;
		}
		const remoteAuthority = this.environmentService.configuration.remoteAuthority;
		if (remoteAuthority) {
			const host = this.labelService.getHostLabel(REMOTE_HOST_SCHEME, this.environmentService.configuration.remoteAuthority) || localize('remote', "Remote");
			this.label = `${RemoteInstallAction.INSTALL_LABEL} on ${host}`;
			this.tooltip = this.label;
			return;
		}
	}

	update(): void {
		this.enabled = false;
		this.class = RemoteInstallAction.Class;
		if (this.installing) {
			this.enabled = true;
			this.class = RemoteInstallAction.InstallingClass;
			this.updateLabel();
			return;
		}
		if (this.environmentService.configuration.remoteAuthority
			// Installed User Extension
			&& this.extension && this.extension.local && this.extension.type === ExtensionType.User && this.extension.state === ExtensionState.Installed
			// Local Workspace Extension
			&& this.extension.server === this.extensionManagementServerService.localExtensionManagementServer && (isLanguagePackExtension(this.extension.local.manifest) || !isUIExtension(this.extension.local.manifest, this.productService, this.configurationService))
			// Extension does not exist in remote
			&& !this.extensionsWorkbenchService.installed.some(e => areSameExtensions(e.identifier, this.extension.identifier) && e.server === this.extensionManagementServerService.remoteExtensionManagementServer)
			&& this.extensionsWorkbenchService.canInstall(this.extension)
		) {
			this.enabled = true;
			this.updateLabel();
			return;
		}
	}

	async run(): Promise<void> {
		if (this.extensionManagementServerService.remoteExtensionManagementServer && !this.installing) {
			this.installing = true;
			this.update();
			this.extensionsWorkbenchService.open(this.extension);
			alert(localize('installExtensionStart', "Installing extension {0} started. An editor is now open with more details on this extension", this.extension.displayName));
			if (this.extension.gallery) {
				await this.extensionManagementServerService.remoteExtensionManagementServer.extensionManagementService.installFromGallery(this.extension.gallery);
				this.installing = false;
				this.update();
			}
		}
	}
}

export class LocalInstallAction extends ExtensionAction {

	private static INSTALL_LABEL = localize('install locally', "Install Locally");
	private static INSTALLING_LABEL = localize('installing', "Installing");

	private static readonly Class = 'extension-action prominent install';
	private static readonly InstallingClass = 'extension-action install installing';

	updateWhenCounterExtensionChanges: boolean = true;
	private installing: boolean = false;

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
	) {
		super(`extensions.localinstall`, LocalInstallAction.INSTALL_LABEL, LocalInstallAction.Class, false);
		this._register(this.labelService.onDidChangeFormatters(() => this.updateLabel(), this));
		this.updateLabel();
		this.update();
	}

	private updateLabel(): void {
		if (this.installing) {
			this.label = LocalInstallAction.INSTALLING_LABEL;
			this.tooltip = this.label;
			return;
		}
		this.label = `${LocalInstallAction.INSTALL_LABEL}`;
		this.tooltip = this.label;
	}

	update(): void {
		this.enabled = false;
		this.class = LocalInstallAction.Class;
		if (this.installing) {
			this.enabled = true;
			this.class = LocalInstallAction.InstallingClass;
			this.updateLabel();
			return;
		}
		if (this.environmentService.configuration.remoteAuthority
			// Installed User Extension
			&& this.extension && this.extension.local && this.extension.type === ExtensionType.User && this.extension.state === ExtensionState.Installed
			// Remote UI or Language pack Extension
			&& this.extension.server === this.extensionManagementServerService.remoteExtensionManagementServer && (isLanguagePackExtension(this.extension.local.manifest) || isUIExtension(this.extension.local.manifest, this.productService, this.configurationService))
			// Extension does not exist in local
			&& !this.extensionsWorkbenchService.installed.some(e => areSameExtensions(e.identifier, this.extension.identifier) && e.server === this.extensionManagementServerService.localExtensionManagementServer)
			&& this.extensionsWorkbenchService.canInstall(this.extension)
		) {
			this.enabled = true;
			this.updateLabel();
			return;
		}
	}

	async run(): Promise<void> {
		if (!this.installing) {
			this.installing = true;
			this.update();
			this.extensionsWorkbenchService.open(this.extension);
			alert(localize('installExtensionStart', "Installing extension {0} started. An editor is now open with more details on this extension", this.extension.displayName));
			if (this.extension.gallery) {
				await this.extensionManagementServerService.localExtensionManagementServer.extensionManagementService.installFromGallery(this.extension.gallery);
				this.installing = false;
				this.update();
			}
		}
	}
}

export class UninstallAction extends ExtensionAction {

	private static readonly UninstallLabel = localize('uninstallAction', "Uninstall");
	private static readonly UninstallingLabel = localize('Uninstalling', "Uninstalling");

	private static readonly UninstallClass = 'extension-action uninstall';
	private static readonly UnInstallingClass = 'extension-action uninstall uninstalling';

	constructor(
		@IExtensionsWorkbenchService private extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super('extensions.uninstall', UninstallAction.UninstallLabel, UninstallAction.UninstallClass, false);
		this.update();
	}

	update(): void {
		if (!this.extension) {
			this.enabled = false;
			return;
		}

		const state = this.extension.state;

		if (state === ExtensionState.Uninstalling) {
			this.label = UninstallAction.UninstallingLabel;
			this.class = UninstallAction.UnInstallingClass;
			this.enabled = false;
			return;
		}

		this.tooltip = UninstallAction.UninstallLabel;
		this.label = UninstallAction.UninstallLabel;
		this.class = UninstallAction.UninstallClass;
		this.tooltip = UninstallAction.UninstallLabel;

		if (state !== ExtensionState.Installed) {
			this.enabled = false;
			return;
		}

		if (this.extension.type !== ExtensionType.User) {
			this.enabled = false;
			return;
		}

		this.enabled = true;
	}

	run(): Promise<any> {
		alert(localize('uninstallExtensionStart', "Uninstalling extension {0} started.", this.extension.displayName));

		return this.extensionsWorkbenchService.uninstall(this.extension).then(() => {
			alert(localize('uninstallExtensionComplete', "Please reload Visual Studio Code to complete the uninstallation of the extension {0}.", this.extension.displayName));
		});
	}
}

export class CombinedInstallAction extends ExtensionAction {

	private static readonly NoExtensionClass = 'extension-action prominent install no-extension';
	private installAction: InstallAction;
	private uninstallAction: UninstallAction;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super('extensions.combinedInstall', '', '', false);

		this.installAction = this._register(instantiationService.createInstance(InstallAction));
		this.uninstallAction = this._register(instantiationService.createInstance(UninstallAction));

		this.update();
	}

	set manifest(manifiest: IExtensionManifest) { this.installAction.manifest = manifiest; this.update(); }

	update(): void {
		this.installAction.extension = this.extension;
		this.uninstallAction.extension = this.extension;
		this.installAction.update();
		this.uninstallAction.update();

		if (!this.extension || this.extension.type === ExtensionType.System) {
			this.enabled = false;
			this.class = CombinedInstallAction.NoExtensionClass;
		} else if (this.extension.state === ExtensionState.Installing) {
			this.enabled = false;
			this.label = this.installAction.label;
			this.class = this.installAction.class;
			this.tooltip = this.installAction.tooltip;
		} else if (this.extension.state === ExtensionState.Uninstalling) {
			this.enabled = false;
			this.label = this.uninstallAction.label;
			this.class = this.uninstallAction.class;
			this.tooltip = this.uninstallAction.tooltip;
		} else if (this.installAction.enabled) {
			this.enabled = true;
			this.label = this.installAction.label;
			this.class = this.installAction.class;
			this.tooltip = this.installAction.tooltip;
		} else if (this.uninstallAction.enabled) {
			this.enabled = true;
			this.label = this.uninstallAction.label;
			this.class = this.uninstallAction.class;
			this.tooltip = this.uninstallAction.tooltip;
		} else {
			this.enabled = false;
			this.label = this.installAction.label;
			this.class = this.installAction.class;
			this.tooltip = this.installAction.tooltip;
		}
	}

	run(): Promise<any> {
		if (this.installAction.enabled) {
			return this.installAction.run();
		} else if (this.uninstallAction.enabled) {
			return this.uninstallAction.run();
		}

		return Promise.resolve();
	}
}

export class UpdateAction extends ExtensionAction {

	private static readonly EnabledClass = 'extension-action prominent update';
	private static readonly DisabledClass = `${UpdateAction.EnabledClass} disabled`;

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService
	) {
		super(`extensions.update`, '', UpdateAction.DisabledClass, false);
		this.update();
	}

	update(): void {
		if (!this.extension) {
			this.enabled = false;
			this.class = UpdateAction.DisabledClass;
			this.label = this.getUpdateLabel();
			return;
		}

		if (this.extension.type !== ExtensionType.User) {
			this.enabled = false;
			this.class = UpdateAction.DisabledClass;
			this.label = this.getUpdateLabel();
			return;
		}

		const canInstall = this.extensionsWorkbenchService.canInstall(this.extension);
		const isInstalled = this.extension.state === ExtensionState.Installed;

		this.enabled = canInstall && isInstalled && this.extension.outdated;
		this.class = this.enabled ? UpdateAction.EnabledClass : UpdateAction.DisabledClass;
		this.label = this.extension.outdated ? this.getUpdateLabel(this.extension.latestVersion) : this.getUpdateLabel();
	}

	run(): Promise<any> {
		alert(localize('updateExtensionStart', "Updating extension {0} to version {1} started.", this.extension.displayName, this.extension.latestVersion));
		return this.install(this.extension);
	}

	private install(extension: IExtension): Promise<void> {
		return this.extensionsWorkbenchService.install(extension).then(() => {
			alert(localize('updateExtensionComplete', "Updating extension {0} to version {1} completed.", this.extension.displayName, this.extension.latestVersion));
		}, err => {
			if (!extension.gallery) {
				return this.notificationService.error(err);
			}

			console.error(err);

			return promptDownloadManually(extension.gallery, localize('failedToUpdate', "Failed to update \'{0}\'.", extension.identifier.id), err, this.instantiationService, this.notificationService, this.openerService, this.productService);
		});
	}

	private getUpdateLabel(version?: string): string {
		return version ? localize('updateTo', "Update to {0}", version) : localize('updateAction', "Update");
	}
}

interface IExtensionActionViewItemOptions extends IActionViewItemOptions {
	tabOnlyOnFocus?: boolean;
}

export class ExtensionActionViewItem extends ActionViewItem {

	protected options: IExtensionActionViewItemOptions;

	constructor(context: any, action: IAction, options: IExtensionActionViewItemOptions = {}) {
		super(context, action, options);
	}

	updateEnabled(): void {
		super.updateEnabled();

		if (this.options.tabOnlyOnFocus && this.getAction().enabled && !this._hasFocus) {
			DOM.removeTabIndexAndUpdateFocus(this.label);
		}
	}

	private _hasFocus: boolean;
	setFocus(value: boolean): void {
		if (!this.options.tabOnlyOnFocus || this._hasFocus === value) {
			return;
		}
		this._hasFocus = value;
		if (this.getAction().enabled) {
			if (this._hasFocus) {
				this.label.tabIndex = 0;
			} else {
				DOM.removeTabIndexAndUpdateFocus(this.label);
			}
		}
	}
}

export abstract class ExtensionDropDownAction extends ExtensionAction {

	constructor(
		id: string,
		label: string,
		cssClass: string,
		enabled: boolean,
		private readonly tabOnlyOnFocus: boolean,
		@IInstantiationService protected instantiationService: IInstantiationService
	) {
		super(id, label, cssClass, enabled);
	}

	private _actionViewItem: DropDownMenuActionViewItem;
	createActionViewItem(): DropDownMenuActionViewItem {
		this._actionViewItem = this.instantiationService.createInstance(DropDownMenuActionViewItem, this, this.tabOnlyOnFocus);
		return this._actionViewItem;
	}

	public run({ actionGroups, disposeActionsOnHide }: { actionGroups: IAction[][], disposeActionsOnHide: boolean }): Promise<any> {
		if (this._actionViewItem) {
			this._actionViewItem.showMenu(actionGroups, disposeActionsOnHide);
		}
		return Promise.resolve();
	}
}

export class DropDownMenuActionViewItem extends ExtensionActionViewItem {

	constructor(action: ExtensionDropDownAction,
		tabOnlyOnFocus: boolean,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		super(null, action, { icon: true, label: true, tabOnlyOnFocus });
	}

	public showMenu(menuActionGroups: IAction[][], disposeActionsOnHide: boolean): void {
		if (this.element) {
			const actions = this.getActions(menuActionGroups);
			let elementPosition = DOM.getDomNodePagePosition(this.element);
			const anchor = { x: elementPosition.left, y: elementPosition.top + elementPosition.height + 10 };
			this.contextMenuService.showContextMenu({
				getAnchor: () => anchor,
				getActions: () => actions,
				actionRunner: this.actionRunner,
				onHide: () => { if (disposeActionsOnHide) { dispose(actions); } }
			});
		}
	}

	private getActions(menuActionGroups: IAction[][]): IAction[] {
		let actions: IAction[] = [];
		for (const menuActions of menuActionGroups) {
			actions = [...actions, ...menuActions, new Separator()];
		}
		return actions.length ? actions.slice(0, actions.length - 1) : actions;
	}
}

export class ManageExtensionAction extends ExtensionDropDownAction {

	static readonly ID = 'extensions.manage';
	private static readonly Class = 'extension-action manage';
	private static readonly HideManageExtensionClass = `${ManageExtensionAction.Class} hide`;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService
	) {

		super(ManageExtensionAction.ID, '', '', true, true, instantiationService);

		this.tooltip = localize('manage', "Manage");

		this.update();
	}

	getActionGroups(runningExtensions: IExtensionDescription[], colorThemes: IColorTheme[], fileIconThemes: IFileIconTheme[]): IAction[][] {
		const groups: ExtensionAction[][] = [];
		if (this.extension) {
			const extensionColorThemes = SetColorThemeAction.getColorThemes(colorThemes, this.extension);
			const extensionFileIconThemes = SetFileIconThemeAction.getFileIconThemes(fileIconThemes, this.extension);
			if (extensionColorThemes.length || extensionFileIconThemes.length) {
				const themesGroup: ExtensionAction[] = [];
				if (extensionColorThemes.length) {
					themesGroup.push(this.instantiationService.createInstance(SetColorThemeAction, colorThemes));
				}
				if (extensionFileIconThemes.length) {
					themesGroup.push(this.instantiationService.createInstance(SetFileIconThemeAction, fileIconThemes));
				}
				groups.push(themesGroup);
			}
		}
		groups.push([
			this.instantiationService.createInstance(EnableGloballyAction),
			this.instantiationService.createInstance(EnableForWorkspaceAction)
		]);
		groups.push([
			this.instantiationService.createInstance(DisableGloballyAction, runningExtensions),
			this.instantiationService.createInstance(DisableForWorkspaceAction, runningExtensions)
		]);
		groups.push([this.instantiationService.createInstance(UninstallAction)]);
		groups.push([this.instantiationService.createInstance(InstallAnotherVersionAction)]);
		groups.push([this.instantiationService.createInstance(ExtensionInfoAction), this.instantiationService.createInstance(ExtensionSettingsAction)]);

		groups.forEach(group => group.forEach(extensionAction => extensionAction.extension = this.extension));

		return groups;
	}

	async run(): Promise<any> {
		const runtimeExtensions = await this.extensionService.getExtensions();
		const colorThemes = await this.workbenchThemeService.getColorThemes();
		const fileIconThemes = await this.workbenchThemeService.getFileIconThemes();
		return super.run({ actionGroups: this.getActionGroups(runtimeExtensions, colorThemes, fileIconThemes), disposeActionsOnHide: true });
	}

	update(): void {
		this.class = ManageExtensionAction.HideManageExtensionClass;
		this.enabled = false;
		if (this.extension) {
			const state = this.extension.state;
			this.enabled = state === ExtensionState.Installed;
			this.class = this.enabled || state === ExtensionState.Uninstalling ? ManageExtensionAction.Class : ManageExtensionAction.HideManageExtensionClass;
			this.tooltip = state === ExtensionState.Uninstalling ? localize('ManageExtensionAction.uninstallingTooltip', "Uninstalling") : '';
		}
	}
}

export class InstallAnotherVersionAction extends ExtensionAction {

	static readonly ID = 'workbench.extensions.action.install.anotherVersion';
	static LABEL = localize('install another version', "Install Another Version...");

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService
	) {
		super(InstallAnotherVersionAction.ID, InstallAnotherVersionAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = this.extension && !!this.extension.gallery;
	}

	run(): Promise<any> {
		if (!this.enabled) {
			return Promise.resolve();
		}
		return this.quickInputService.pick(this.getVersionEntries(), { placeHolder: localize('selectVersion', "Select Version to Install"), matchOnDetail: true })
			.then(pick => {
				if (pick) {
					if (this.extension.version === pick.id) {
						return Promise.resolve();
					}
					const promise: Promise<any> = pick.latest ? this.extensionsWorkbenchService.install(this.extension) : this.extensionsWorkbenchService.installVersion(this.extension, pick.id);
					return promise
						.then(null, err => {
							if (!this.extension.gallery) {
								return this.notificationService.error(err);
							}

							console.error(err);

							return promptDownloadManually(this.extension.gallery, localize('failedToInstall', "Failed to install \'{0}\'.", this.extension.identifier.id), err, this.instantiationService, this.notificationService, this.openerService, this.productService);
						});
				}
				return null;
			});
	}

	private getVersionEntries(): Promise<(IQuickPickItem & { latest: boolean, id: string })[]> {
		return this.extensionGalleryService.getAllVersions(this.extension.gallery!, true)
			.then(allVersions => allVersions.map((v, i) => ({ id: v.version, label: v.version, description: `${getRelativeDateLabel(new Date(Date.parse(v.date)))}${v.version === this.extension.version ? ` (${localize('current', "Current")})` : ''}`, latest: i === 0 })));
	}
}

export class ExtensionInfoAction extends ExtensionAction {

	static readonly ID = 'extensions.extensionInfo';
	static readonly LABEL = localize('extensionInfoAction', "Copy Extension Information");

	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super(ExtensionInfoAction.ID, ExtensionInfoAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = !!this.extension;
	}

	run(): Promise<any> {

		const name = localize('extensionInfoName', 'Name: {0}', this.extension.displayName);
		const id = localize('extensionInfoId', 'Id: {0}', this.extension.identifier.id);
		const description = localize('extensionInfoDescription', 'Description: {0}', this.extension.description);
		const verision = localize('extensionInfoVersion', 'Version: {0}', this.extension.version);
		const publisher = localize('extensionInfoPublisher', 'Publisher: {0}', this.extension.publisherDisplayName);
		const link = this.extension.url ? localize('extensionInfoVSMarketplaceLink', 'VS Marketplace Link: {0}', this.extension.url.toString()) : null;

		const clipboardStr = `${name}\n${id}\n${description}\n${verision}\n${publisher}${link ? '\n' + link : ''}`;

		return this.clipboardService.writeText(clipboardStr);
	}
}

export class ExtensionSettingsAction extends ExtensionAction {

	static readonly ID = 'extensions.extensionSettings';
	static readonly LABEL = localize('extensionSettingsAction', "Configure Extension Settings");

	constructor(
		@IPreferencesService private readonly preferencesService: IPreferencesService
	) {
		super(ExtensionSettingsAction.ID, ExtensionSettingsAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = !!this.extension;
	}
	run(): Promise<any> {
		this.preferencesService.openSettings(false, `@ext:${this.extension.identifier.id}`);
		return Promise.resolve();
	}
}

export class EnableForWorkspaceAction extends ExtensionAction {

	static readonly ID = 'extensions.enableForWorkspace';
	static LABEL = localize('enableForWorkspaceAction', "Enable (Workspace)");

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(EnableForWorkspaceAction.ID, EnableForWorkspaceAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = false;
		if (this.extension) {
			this.enabled = this.extension.state === ExtensionState.Installed && (this.extension.enablementState === EnablementState.Disabled || this.extension.enablementState === EnablementState.WorkspaceDisabled) && !!this.extension.local && this.extensionEnablementService.canChangeEnablement(this.extension.local);
		}
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extension, EnablementState.WorkspaceEnabled);
	}
}

export class EnableGloballyAction extends ExtensionAction {

	static readonly ID = 'extensions.enableGlobally';
	static LABEL = localize('enableGloballyAction', "Enable");

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(EnableGloballyAction.ID, EnableGloballyAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = false;
		if (this.extension && this.extension.local) {
			this.enabled = this.extension.state === ExtensionState.Installed && this.extension.enablementState === EnablementState.Disabled && this.extensionEnablementService.canChangeEnablement(this.extension.local);
		}
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extension, EnablementState.Enabled);
	}
}

export class DisableForWorkspaceAction extends ExtensionAction {

	static readonly ID = 'extensions.disableForWorkspace';
	static LABEL = localize('disableForWorkspaceAction', "Disable (Workspace)");

	constructor(readonly runningExtensions: IExtensionDescription[],
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(DisableForWorkspaceAction.ID, DisableForWorkspaceAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = false;
		if (this.extension && this.runningExtensions.some(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier) && this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY)) {
			this.enabled = this.extension.state === ExtensionState.Installed && (this.extension.enablementState === EnablementState.Enabled || this.extension.enablementState === EnablementState.WorkspaceEnabled) && !!this.extension.local && this.extensionEnablementService.canChangeEnablement(this.extension.local);
		}
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extension, EnablementState.WorkspaceDisabled);
	}
}

export class DisableGloballyAction extends ExtensionAction {

	static readonly ID = 'extensions.disableGlobally';
	static LABEL = localize('disableGloballyAction', "Disable");

	constructor(readonly runningExtensions: IExtensionDescription[],
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(DisableGloballyAction.ID, DisableGloballyAction.LABEL);
		this.update();
	}

	update(): void {
		this.enabled = false;
		if (this.extension && this.runningExtensions.some(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier))) {
			this.enabled = this.extension.state === ExtensionState.Installed && (this.extension.enablementState === EnablementState.Enabled || this.extension.enablementState === EnablementState.WorkspaceEnabled) && !!this.extension.local && this.extensionEnablementService.canChangeEnablement(this.extension.local);
		}
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extension, EnablementState.Disabled);
	}
}

export abstract class ExtensionEditorDropDownAction extends ExtensionDropDownAction {

	private static readonly EnabledClass = 'extension-action extension-editor-dropdown-action';
	private static readonly EnabledDropDownClass = 'extension-action extension-editor-dropdown-action dropdown enable';
	private static readonly DisabledClass = `${ExtensionEditorDropDownAction.EnabledClass} disabled`;

	constructor(
		id: string, private readonly initialLabel: string,
		readonly actions: ExtensionAction[],
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(id, initialLabel, ExtensionEditorDropDownAction.DisabledClass, false, false, instantiationService);
		this.update();
	}

	update(): void {
		this.actions.forEach(a => a.extension = this.extension);
		this.actions.forEach(a => a.update());
		const enabledActions = this.actions.filter(a => a.enabled);
		this.enabled = enabledActions.length > 0;
		if (this.enabled) {
			if (enabledActions.length === 1) {
				this.label = enabledActions[0].label;
				this.class = ExtensionEditorDropDownAction.EnabledClass;
			} else {
				this.label = this.initialLabel;
				this.class = ExtensionEditorDropDownAction.EnabledDropDownClass;
			}
		} else {
			this.class = ExtensionEditorDropDownAction.DisabledClass;
		}
	}

	public run(): Promise<any> {
		const enabledActions = this.actions.filter(a => a.enabled);
		if (enabledActions.length === 1) {
			enabledActions[0].run();
		} else {
			return super.run({ actionGroups: [this.actions], disposeActionsOnHide: false });
		}
		return Promise.resolve();
	}
}

export class EnableDropDownAction extends ExtensionEditorDropDownAction {

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super('extensions.enable', localize('enableAction', "Enable"), [
			instantiationService.createInstance(EnableGloballyAction),
			instantiationService.createInstance(EnableForWorkspaceAction)
		], instantiationService);
	}
}

export class DisableDropDownAction extends ExtensionEditorDropDownAction {

	constructor(
		runningExtensions: IExtensionDescription[],
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super('extensions.disable', localize('disableAction', "Disable"), [
			instantiationService.createInstance(DisableGloballyAction, runningExtensions),
			instantiationService.createInstance(DisableForWorkspaceAction, runningExtensions)
		], instantiationService);
	}
}

export class CheckForUpdatesAction extends Action {

	static readonly ID = 'workbench.extensions.action.checkForUpdates';
	static LABEL = localize('checkForUpdates', "Check for Extension Updates");

	constructor(
		id = CheckForUpdatesAction.ID,
		label = CheckForUpdatesAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IViewletService private readonly viewletService: IViewletService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(id, label, '', true);
	}

	private checkUpdatesAndNotify(): void {
		const outdated = this.extensionsWorkbenchService.outdated;
		if (!outdated.length) {
			this.notificationService.info(localize('noUpdatesAvailable', "All extensions are up to date."));
			return;
		}

		let msgAvailableExtensions = outdated.length === 1 ? localize('singleUpdateAvailable', "An extension update is available.") : localize('updatesAvailable', "{0} extension updates are available.", outdated.length);

		const disabledExtensionsCount = outdated.filter(ext => ext.enablementState === EnablementState.Disabled || ext.enablementState === EnablementState.WorkspaceDisabled).length;
		if (disabledExtensionsCount) {
			if (outdated.length === 1) {
				msgAvailableExtensions = localize('singleDisabledUpdateAvailable', "An update to an extension which is disabled is available.");
			} else if (disabledExtensionsCount === 1) {
				msgAvailableExtensions = localize('updatesAvailableOneDisabled', "{0} extension updates are available. One of them is for a disabled extension.", outdated.length);
			} else if (disabledExtensionsCount === outdated.length) {
				msgAvailableExtensions = localize('updatesAvailableAllDisabled', "{0} extension updates are available. All of them are for disabled extensions.", outdated.length);
			} else {
				msgAvailableExtensions = localize('updatesAvailableIncludingDisabled', "{0} extension updates are available. {1} of them are for disabled extensions.", outdated.length, disabledExtensionsCount);
			}
		}

		this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => viewlet.search(''));

		this.notificationService.info(msgAvailableExtensions);
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.checkForUpdates().then(() => this.checkUpdatesAndNotify());
	}
}

export class ToggleAutoUpdateAction extends Action {

	constructor(
		id: string,
		label: string,
		private autoUpdateValue: boolean,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label, '', true);
		this.updateEnablement();
		configurationService.onDidChangeConfiguration(() => this.updateEnablement());
	}

	private updateEnablement(): void {
		this.enabled = this.configurationService.getValue(AutoUpdateConfigurationKey) !== this.autoUpdateValue;
	}

	run(): Promise<any> {
		return this.configurationService.updateValue(AutoUpdateConfigurationKey, this.autoUpdateValue);
	}
}

export class EnableAutoUpdateAction extends ToggleAutoUpdateAction {

	static readonly ID = 'workbench.extensions.action.enableAutoUpdate';
	static LABEL = localize('enableAutoUpdate', "Enable Auto Updating Extensions");

	constructor(
		id = EnableAutoUpdateAction.ID,
		label = EnableAutoUpdateAction.LABEL,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, true, configurationService);
	}
}

export class DisableAutoUpdateAction extends ToggleAutoUpdateAction {

	static readonly ID = 'workbench.extensions.action.disableAutoUpdate';
	static LABEL = localize('disableAutoUpdate', "Disable Auto Updating Extensions");

	constructor(
		id = EnableAutoUpdateAction.ID,
		label = EnableAutoUpdateAction.LABEL,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(id, label, false, configurationService);
	}
}

export class UpdateAllAction extends Action {

	static readonly ID = 'workbench.extensions.action.updateAllExtensions';
	static LABEL = localize('updateAll', "Update All Extensions");

	constructor(
		id = UpdateAllAction.ID,
		label = UpdateAllAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService
	) {
		super(id, label, '', false);

		this._register(this.extensionsWorkbenchService.onChange(() => this.update()));
		this.update();
	}

	private update(): void {
		this.enabled = this.extensionsWorkbenchService.outdated.length > 0;
	}

	run(): Promise<any> {
		return Promise.all(this.extensionsWorkbenchService.outdated.map(e => this.install(e)));
	}

	private install(extension: IExtension): Promise<any> {
		return this.extensionsWorkbenchService.install(extension).then(undefined, err => {
			if (!extension.gallery) {
				return this.notificationService.error(err);
			}

			console.error(err);

			return promptDownloadManually(extension.gallery, localize('failedToUpdate', "Failed to update \'{0}\'.", extension.identifier.id), err, this.instantiationService, this.notificationService, this.openerService, this.productService);
		});
	}
}

export class ReloadAction extends ExtensionAction {

	private static readonly EnabledClass = 'extension-action reload';
	private static readonly DisabledClass = `${ReloadAction.EnabledClass} disabled`;

	updateWhenCounterExtensionChanges: boolean = true;
	private _runningExtensions: IExtensionDescription[] | null = null;

	constructor(
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWindowService private readonly windowService: IWindowService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
	) {
		super('extensions.reload', localize('reloadAction', "Reload"), ReloadAction.DisabledClass, false);
		this._register(this.extensionService.onDidChangeExtensions(this.updateRunningExtensions, this));
		this.updateRunningExtensions();
	}

	private updateRunningExtensions(): void {
		this.extensionService.getExtensions().then(runningExtensions => { this._runningExtensions = runningExtensions; this.update(); });
	}

	update(): void {
		this.enabled = false;
		this.tooltip = '';
		if (!this.extension || !this._runningExtensions) {
			return;
		}
		const state = this.extension.state;
		if (state === ExtensionState.Installing || state === ExtensionState.Uninstalling) {
			return;
		}
		if (this.extension.local && this.extension.local.manifest && this.extension.local.manifest.contributes && this.extension.local.manifest.contributes.localizations && this.extension.local.manifest.contributes.localizations.length > 0) {
			return;
		}
		this.computeReloadState();
		this.class = this.enabled ? ReloadAction.EnabledClass : ReloadAction.DisabledClass;
	}

	private computeReloadState(): void {
		if (!this._runningExtensions) {
			return;
		}
		const isUninstalled = this.extension.state === ExtensionState.Uninstalled;
		const runningExtension = this._runningExtensions.filter(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier))[0];
		const isSameExtensionRunning = runningExtension && this.extension.server === this.extensionManagementServerService.getExtensionManagementServer(runningExtension.extensionLocation);

		if (isUninstalled) {
			if (isSameExtensionRunning) {
				this.enabled = true;
				this.label = localize('reloadRequired', "Reload Required");
				this.tooltip = localize('postUninstallTooltip', "Please reload Visual Studio Code to complete the uninstallation of this extension.");
				alert(localize('uninstallExtensionComplete', "Please reload Visual Studio Code to complete the uninstallation of the extension {0}.", this.extension.displayName));
			}
			return;
		}
		if (this.extension.local) {
			const isEnabled = this.extensionEnablementService.isEnabled(this.extension.local);
			if (runningExtension) {
				// Extension is running
				if (isEnabled) {
					if (!this.extensionService.canAddExtension(toExtensionDescription(this.extension.local))) {
						if (isSameExtensionRunning) {
							if (this.extension.version !== runningExtension.version) {
								this.enabled = true;
								this.label = localize('reloadRequired', "Reload Required");
								this.tooltip = localize('postUpdateTooltip', "Please reload Visual Studio Code to enable the updated extension.");
							}
						} else {
							this.enabled = true;
							this.label = localize('reloadRequired', "Reload Required");
							this.tooltip = localize('postEnableTooltip', "Please reload Visual Studio Code to enable this extension.");
						}
					}
				} else {
					if (isSameExtensionRunning) {
						this.enabled = true;
						this.label = localize('reloadRequired', "Reload Required");
						this.tooltip = localize('postDisableTooltip', "Please reload Visual Studio Code to disable this extension.");
					}
				}
				return;
			} else {
				// Extension is not running
				if (isEnabled && !this.extensionService.canAddExtension(toExtensionDescription(this.extension.local))) {
					this.enabled = true;
					this.label = localize('reloadRequired', "Reload Required");
					this.tooltip = localize('postEnableTooltip', "Please reload Visual Studio Code to enable this extension.");
					return;
				}
				if (this.workbenchEnvironmentService.configuration.remoteAuthority) {
					const uiExtension = isUIExtension(this.extension.local.manifest, this.productService, this.configurationService);
					// Local Workspace Extension
					if (!uiExtension && this.extension.server === this.extensionManagementServerService.localExtensionManagementServer) {
						const remoteExtension = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, this.extension.identifier) && e.server === this.extensionManagementServerService.remoteExtensionManagementServer)[0];
						// Extension exist in remote and enabled
						if (remoteExtension && remoteExtension.local && this.extensionEnablementService.isEnabled(remoteExtension.local)) {
							this.enabled = true;
							this.label = localize('reloadRequired', "Reload Required");
							this.tooltip = localize('postEnableTooltip', "Please reload Visual Studio Code to enable this extension.");
							alert(localize('installExtensionComplete', "Installing extension {0} is completed. Please reload Visual Studio Code to enable it.", this.extension.displayName));
							return;
						}
					}
					// Remote UI Extension
					if (uiExtension && this.extension.server === this.extensionManagementServerService.remoteExtensionManagementServer) {
						const localExtension = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, this.extension.identifier) && e.server === this.extensionManagementServerService.localExtensionManagementServer)[0];
						// Extension exist in local and enabled
						if (localExtension && localExtension.local && this.extensionEnablementService.isEnabled(localExtension.local)) {
							this.enabled = true;
							this.label = localize('reloadRequired', "Reload Required");
							this.tooltip = localize('postEnableTooltip', "Please reload Visual Studio Code to enable this extension.");
							alert(localize('installExtensionComplete', "Installing extension {0} is completed. Please reload Visual Studio Code to enable it.", this.extension.displayName));
							return;
						}
					}
				}
			}
		}
	}

	run(): Promise<any> {
		return Promise.resolve(this.windowService.reloadWindow());
	}
}

export class SetColorThemeAction extends ExtensionAction {

	static getColorThemes(colorThemes: IColorTheme[], extension: IExtension): IColorTheme[] {
		return colorThemes.filter(c => c.extensionData && ExtensionIdentifier.equals(c.extensionData.extensionId, extension.identifier.id));
	}

	private static readonly EnabledClass = 'extension-action theme';
	private static readonly DisabledClass = `${SetColorThemeAction.EnabledClass} disabled`;


	constructor(
		private readonly colorThemes: IColorTheme[],
		@IExtensionService extensionService: IExtensionService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(`extensions.colorTheme`, localize('color theme', "Set Color Theme"), SetColorThemeAction.DisabledClass, false);
		this._register(Event.any<any>(extensionService.onDidChangeExtensions, workbenchThemeService.onDidColorThemeChange)(() => this.update(), this));
		this.update();
	}

	update(): void {
		this.enabled = false;
		if (this.extension) {
			const isInstalled = this.extension.state === ExtensionState.Installed;
			if (isInstalled) {
				const extensionThemes = SetColorThemeAction.getColorThemes(this.colorThemes, this.extension);
				this.enabled = extensionThemes.length > 0;
			}
		}
		this.class = this.enabled ? SetColorThemeAction.EnabledClass : SetColorThemeAction.DisabledClass;
	}

	async run({ showCurrentTheme, ignoreFocusLost }: { showCurrentTheme: boolean, ignoreFocusLost: boolean } = { showCurrentTheme: false, ignoreFocusLost: false }): Promise<any> {
		this.update();
		if (!this.enabled) {
			return;
		}
		let extensionThemes = SetColorThemeAction.getColorThemes(this.colorThemes, this.extension);
		const currentTheme = this.colorThemes.filter(t => t.settingsId === this.configurationService.getValue(COLOR_THEME_SETTING))[0];
		showCurrentTheme = showCurrentTheme || extensionThemes.some(t => t.id === currentTheme.id);
		if (showCurrentTheme) {
			extensionThemes = extensionThemes.filter(t => t.id !== currentTheme.id);
		}

		const delayer = new Delayer<any>(100);
		const picks: (IQuickPickItem | IQuickPickSeparator)[] = [];
		picks.push(...extensionThemes.map(theme => (<IQuickPickItem>{ label: theme.label, id: theme.id })));
		if (showCurrentTheme) {
			picks.push(<IQuickPickSeparator>{ type: 'separator', label: localize('current', "Current") });
			picks.push(<IQuickPickItem>{ label: currentTheme.label, id: currentTheme.id });
		}
		const pickedTheme = await this.quickInputService.pick(
			picks,
			{
				placeHolder: localize('select color theme', "Select Color Theme"),
				onDidFocus: item => delayer.trigger(() => this.workbenchThemeService.setColorTheme(item.id, undefined)),
				ignoreFocusLost
			});
		let confValue = this.configurationService.inspect(COLOR_THEME_SETTING);
		const target = typeof confValue.workspace !== 'undefined' ? ConfigurationTarget.WORKSPACE : ConfigurationTarget.USER;
		return this.workbenchThemeService.setColorTheme(pickedTheme ? pickedTheme.id : currentTheme.id, target);
	}
}

export class SetFileIconThemeAction extends ExtensionAction {

	private static readonly EnabledClass = 'extension-action theme';
	private static readonly DisabledClass = `${SetFileIconThemeAction.EnabledClass} disabled`;


	static getFileIconThemes(fileIconThemes: IFileIconTheme[], extension: IExtension): IFileIconTheme[] {
		return fileIconThemes.filter(c => c.extensionData && ExtensionIdentifier.equals(c.extensionData.extensionId, extension.identifier.id));
	}

	constructor(
		private readonly fileIconThemes: IFileIconTheme[],
		@IExtensionService extensionService: IExtensionService,
		@IWorkbenchThemeService private readonly workbenchThemeService: IWorkbenchThemeService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(`extensions.fileIconTheme`, localize('file icon theme', "Set File Icon Theme"), SetFileIconThemeAction.DisabledClass, false);
		this._register(Event.any<any>(extensionService.onDidChangeExtensions, workbenchThemeService.onDidFileIconThemeChange)(() => this.update(), this));
		this.update();
	}

	update(): void {
		this.enabled = false;
		if (this.extension) {
			const isInstalled = this.extension.state === ExtensionState.Installed;
			if (isInstalled) {
				const extensionThemes = SetFileIconThemeAction.getFileIconThemes(this.fileIconThemes, this.extension);
				this.enabled = extensionThemes.length > 0;
			}
		}
		this.class = this.enabled ? SetFileIconThemeAction.EnabledClass : SetFileIconThemeAction.DisabledClass;
	}

	async run({ showCurrentTheme, ignoreFocusLost }: { showCurrentTheme: boolean, ignoreFocusLost: boolean } = { showCurrentTheme: false, ignoreFocusLost: false }): Promise<any> {
		await this.update();
		if (!this.enabled) {
			return;
		}
		let extensionThemes = SetFileIconThemeAction.getFileIconThemes(this.fileIconThemes, this.extension);
		const currentTheme = this.fileIconThemes.filter(t => t.settingsId === this.configurationService.getValue(ICON_THEME_SETTING))[0] || this.workbenchThemeService.getFileIconTheme();
		showCurrentTheme = showCurrentTheme || extensionThemes.some(t => t.id === currentTheme.id);
		if (showCurrentTheme) {
			extensionThemes = extensionThemes.filter(t => t.id !== currentTheme.id);
		}

		const delayer = new Delayer<any>(100);
		const picks: (IQuickPickItem | IQuickPickSeparator)[] = [];
		picks.push(...extensionThemes.map(theme => (<IQuickPickItem>{ label: theme.label, id: theme.id })));
		if (showCurrentTheme && currentTheme.label) {
			picks.push(<IQuickPickSeparator>{ type: 'separator', label: localize('current', "Current") });
			picks.push(<IQuickPickItem>{ label: currentTheme.label, id: currentTheme.id });
		}
		const pickedTheme = await this.quickInputService.pick(
			picks,
			{
				placeHolder: localize('select file icon theme', "Select File Icon Theme"),
				onDidFocus: item => delayer.trigger(() => this.workbenchThemeService.setFileIconTheme(item.id, undefined)),
				ignoreFocusLost
			});
		let confValue = this.configurationService.inspect(ICON_THEME_SETTING);
		const target = typeof confValue.workspace !== 'undefined' ? ConfigurationTarget.WORKSPACE : ConfigurationTarget.USER;
		return this.workbenchThemeService.setFileIconTheme(pickedTheme ? pickedTheme.id : currentTheme.id, target);
	}
}

export class OpenExtensionsViewletAction extends ShowViewletAction {

	static ID = VIEWLET_ID;
	static LABEL = localize('toggleExtensionsViewlet', "Show Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService viewletService: IViewletService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super(id, label, VIEWLET_ID, viewletService, editorGroupService, layoutService);
	}
}

export class InstallExtensionsAction extends OpenExtensionsViewletAction {
	static ID = 'workbench.extensions.action.installExtensions';
	static LABEL = localize('installExtensions', "Install Extensions");
}

export class ShowEnabledExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showEnabledExtensions';
	static LABEL = localize('showEnabledExtensions', "Show Enabled Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@enabled ');
				viewlet.focus();
			});
	}
}

export class ShowInstalledExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showInstalledExtensions';
	static LABEL = localize('showInstalledExtensions', "Show Installed Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@installed ');
				viewlet.focus();
			});
	}
}

export class ShowDisabledExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showDisabledExtensions';
	static LABEL = localize('showDisabledExtensions', "Show Disabled Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, 'null', true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@disabled ');
				viewlet.focus();
			});
	}
}

export class ClearExtensionsInputAction extends Action {

	static readonly ID = 'workbench.extensions.action.clearExtensionsInput';
	static LABEL = localize('clearExtensionsInput', "Clear Extensions Input");

	constructor(
		id: string,
		label: string,
		onSearchChange: Event<string>,
		value: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, 'clear-extensions', true);
		this.onSearchChange(value);
		this._register(onSearchChange(this.onSearchChange, this));
	}

	private onSearchChange(value: string): void {
		this.enabled = !!value;
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('');
				viewlet.focus();
			});
	}
}

export class ShowBuiltInExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.listBuiltInExtensions';
	static LABEL = localize('showBuiltInExtensions', "Show Built-in Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@builtin ');
				viewlet.focus();
			});
	}
}

export class ShowOutdatedExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.listOutdatedExtensions';
	static LABEL = localize('showOutdatedExtensions', "Show Outdated Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@outdated ');
				viewlet.focus();
			});
	}
}

export class ShowPopularExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showPopularExtensions';
	static LABEL = localize('showPopularExtensions', "Show Popular Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@sort:installs ');
				viewlet.focus();
			});
	}
}

export class ShowRecommendedExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showRecommendedExtensions';
	static LABEL = localize('showRecommendedExtensions', "Show Recommended Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@recommended ');
				viewlet.focus();
			});
	}
}

export class InstallWorkspaceRecommendedExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.installWorkspaceRecommendedExtensions';
	static LABEL = localize('installWorkspaceRecommendedExtensions', "Install All Workspace Recommended Extensions");

	private _recommendations: IExtensionRecommendation[] = [];
	get recommendations(): IExtensionRecommendation[] { return this._recommendations; }
	set recommendations(recommendations: IExtensionRecommendation[]) { this._recommendations = recommendations; this.enabled = this._recommendations.length > 0; }

	constructor(
		id: string = InstallWorkspaceRecommendedExtensionsAction.ID,
		label: string = InstallWorkspaceRecommendedExtensionsAction.LABEL,
		recommendations: IExtensionRecommendation[],
		@IViewletService private readonly viewletService: IViewletService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IExtensionsWorkbenchService private readonly extensionWorkbenchService: IExtensionsWorkbenchService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IProductService private readonly productService: IProductService,
	) {
		super(id, label, 'extension-action');
		this.recommendations = recommendations;
	}

	run(): Promise<any> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@recommended ');
				viewlet.focus();
				const names = this.recommendations.map(({ extensionId }) => extensionId);
				return this.extensionWorkbenchService.queryGallery({ names, source: 'install-all-workspace-recommendations' }, CancellationToken.None).then(pager => {
					let installPromises: Promise<any>[] = [];
					let model = new PagedModel(pager);
					for (let i = 0; i < pager.total; i++) {
						installPromises.push(model.resolve(i, CancellationToken.None).then(e => this.installExtension(e)));
					}
					return Promise.all(installPromises);
				});
			});
	}

	private async installExtension(extension: IExtension): Promise<void> {
		try {
			if (extension.local && extension.gallery) {
				if (isUIExtension(extension.local.manifest, this.productService, this.configurationService)) {
					await this.extensionManagementServerService.localExtensionManagementServer.extensionManagementService.installFromGallery(extension.gallery);
					return;
				} else if (this.extensionManagementServerService.remoteExtensionManagementServer) {
					await this.extensionManagementServerService.remoteExtensionManagementServer.extensionManagementService.installFromGallery(extension.gallery);
					return;
				}
			}
			await this.extensionWorkbenchService.install(extension);
		} catch (err) {
			console.error(err);
			return promptDownloadManually(extension.gallery, localize('failedToInstall', "Failed to install \'{0}\'.", extension.identifier.id), err, this.instantiationService, this.notificationService, this.openerService, this.productService);
		}
	}
}

export class InstallRecommendedExtensionAction extends Action {

	static readonly ID = 'workbench.extensions.action.installRecommendedExtension';
	static LABEL = localize('installRecommendedExtension', "Install Recommended Extension");

	private extensionId: string;

	constructor(
		extensionId: string,
		@IViewletService private readonly viewletService: IViewletService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IExtensionsWorkbenchService private readonly extensionWorkbenchService: IExtensionsWorkbenchService,
		@IProductService private readonly productService: IProductService
	) {
		super(InstallRecommendedExtensionAction.ID, InstallRecommendedExtensionAction.LABEL, undefined, false);
		this.extensionId = extensionId;
	}

	run(): Promise<any> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@recommended ');
				viewlet.focus();
				return this.extensionWorkbenchService.queryGallery({ names: [this.extensionId], source: 'install-recommendation', pageSize: 1 }, CancellationToken.None)
					.then(pager => {
						if (pager && pager.firstPage && pager.firstPage.length) {
							const extension = pager.firstPage[0];
							return this.extensionWorkbenchService.install(extension)
								.then(() => null, err => {
									console.error(err);
									return promptDownloadManually(extension.gallery, localize('failedToInstall', "Failed to install \'{0}\'.", extension.identifier.id), err, this.instantiationService, this.notificationService, this.openerService, this.productService);
								});
						}
						return null;
					});
			});
	}
}

export class IgnoreExtensionRecommendationAction extends Action {

	static readonly ID = 'extensions.ignore';

	private static readonly Class = 'extension-action ignore';

	extension: IExtension;

	constructor(
		@IExtensionTipsService private readonly extensionsTipsService: IExtensionTipsService,
	) {
		super(IgnoreExtensionRecommendationAction.ID, 'Ignore Recommendation');

		this.class = IgnoreExtensionRecommendationAction.Class;
		this.tooltip = localize('ignoreExtensionRecommendation', "Do not recommend this extension again");
		this.enabled = true;
	}

	public run(): Promise<any> {
		this.extensionsTipsService.toggleIgnoredRecommendation(this.extension.identifier.id, true);
		return Promise.resolve();
	}
}

export class UndoIgnoreExtensionRecommendationAction extends Action {

	static readonly ID = 'extensions.ignore';

	private static readonly Class = 'extension-action undo-ignore';

	extension: IExtension;

	constructor(
		@IExtensionTipsService private readonly extensionsTipsService: IExtensionTipsService,
	) {
		super(UndoIgnoreExtensionRecommendationAction.ID, 'Undo');

		this.class = UndoIgnoreExtensionRecommendationAction.Class;
		this.tooltip = localize('undo', "Undo");
		this.enabled = true;
	}

	public run(): Promise<any> {
		this.extensionsTipsService.toggleIgnoredRecommendation(this.extension.identifier.id, false);
		return Promise.resolve();
	}
}


export class ShowRecommendedKeymapExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showRecommendedKeymapExtensions';
	static SHORT_LABEL = localize('showRecommendedKeymapExtensionsShort', "Keymaps");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@recommended:keymaps ');
				viewlet.focus();
			});
	}
}

export class ShowLanguageExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showLanguageExtensions';
	static SHORT_LABEL = localize('showLanguageExtensionsShort', "Language Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@category:"programming languages" @sort:installs ');
				viewlet.focus();
			});
	}
}

export class ShowAzureExtensionsAction extends Action {

	static readonly ID = 'workbench.extensions.action.showAzureExtensions';
	static SHORT_LABEL = localize('showAzureExtensionsShort', "Azure Extensions");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search('@sort:installs azure ');
				viewlet.focus();
			});
	}
}

export class ChangeSortAction extends Action {

	private query: Query;

	constructor(
		id: string,
		label: string,
		onSearchChange: Event<string>,
		private sortBy: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label, undefined, true);

		if (sortBy === undefined) {
			throw new Error('bad arguments');
		}

		this.query = Query.parse('');
		this.enabled = false;
		this._register(onSearchChange(this.onSearchChange, this));
	}

	private onSearchChange(value: string): void {
		const query = Query.parse(value);
		this.query = new Query(query.value, this.sortBy || query.sortBy, query.groupBy);
		this.enabled = !!value && this.query.isValid() && !this.query.equals(query);
	}

	run(): Promise<void> {
		return this.viewletService.openViewlet(VIEWLET_ID, true)
			.then(viewlet => viewlet as IExtensionsViewlet)
			.then(viewlet => {
				viewlet.search(this.query.toString());
				viewlet.focus();
			});
	}
}

export class ConfigureRecommendedExtensionsCommandsContributor extends Disposable implements IWorkbenchContribution {

	private workspaceContextKey = new RawContextKey<boolean>('workspaceRecommendations', true);
	private workspaceFolderContextKey = new RawContextKey<boolean>('workspaceFolderRecommendations', true);
	private addToWorkspaceRecommendationsContextKey = new RawContextKey<boolean>('addToWorkspaceRecommendations', false);
	private addToWorkspaceFolderRecommendationsContextKey = new RawContextKey<boolean>('addToWorkspaceFolderRecommendations', false);

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IEditorService editorService: IEditorService
	) {
		super();
		const boundWorkspaceContextKey = this.workspaceContextKey.bindTo(contextKeyService);
		boundWorkspaceContextKey.set(workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE);
		this._register(workspaceContextService.onDidChangeWorkbenchState(() => boundWorkspaceContextKey.set(workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE)));

		const boundWorkspaceFolderContextKey = this.workspaceFolderContextKey.bindTo(contextKeyService);
		boundWorkspaceFolderContextKey.set(workspaceContextService.getWorkspace().folders.length > 0);
		this._register(workspaceContextService.onDidChangeWorkspaceFolders(() => boundWorkspaceFolderContextKey.set(workspaceContextService.getWorkspace().folders.length > 0)));

		const boundAddToWorkspaceRecommendationsContextKey = this.addToWorkspaceRecommendationsContextKey.bindTo(contextKeyService);
		boundAddToWorkspaceRecommendationsContextKey.set(editorService.activeEditor instanceof ExtensionsInput && workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE);
		this._register(editorService.onDidActiveEditorChange(() => boundAddToWorkspaceRecommendationsContextKey.set(
			editorService.activeEditor instanceof ExtensionsInput && workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE)));
		this._register(workspaceContextService.onDidChangeWorkbenchState(() => boundAddToWorkspaceRecommendationsContextKey.set(
			editorService.activeEditor instanceof ExtensionsInput && workspaceContextService.getWorkbenchState() === WorkbenchState.WORKSPACE)));

		const boundAddToWorkspaceFolderRecommendationsContextKey = this.addToWorkspaceFolderRecommendationsContextKey.bindTo(contextKeyService);
		boundAddToWorkspaceFolderRecommendationsContextKey.set(editorService.activeEditor instanceof ExtensionsInput);
		this._register(editorService.onDidActiveEditorChange(() => boundAddToWorkspaceFolderRecommendationsContextKey.set(editorService.activeEditor instanceof ExtensionsInput)));

		this.registerCommands();
	}

	private registerCommands(): void {
		CommandsRegistry.registerCommand(ConfigureWorkspaceRecommendedExtensionsAction.ID, serviceAccessor => {
			serviceAccessor.get(IInstantiationService).createInstance(ConfigureWorkspaceRecommendedExtensionsAction, ConfigureWorkspaceRecommendedExtensionsAction.ID, ConfigureWorkspaceRecommendedExtensionsAction.LABEL).run();
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: ConfigureWorkspaceRecommendedExtensionsAction.ID,
				title: { value: `${ExtensionsLabel}: ${ConfigureWorkspaceRecommendedExtensionsAction.LABEL}`, original: 'Extensions: Configure Recommended Extensions (Workspace)' },
				category: localize('extensions', "Extensions")
			},
			when: this.workspaceContextKey
		});

		CommandsRegistry.registerCommand(ConfigureWorkspaceFolderRecommendedExtensionsAction.ID, serviceAccessor => {
			serviceAccessor.get(IInstantiationService).createInstance(ConfigureWorkspaceFolderRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction.ID, ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL).run();
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: ConfigureWorkspaceFolderRecommendedExtensionsAction.ID,
				title: { value: `${ExtensionsLabel}: ${ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL}`, original: 'Extensions: Configure Recommended Extensions (Workspace Folder)' },
				category: localize('extensions', "Extensions")
			},
			when: this.workspaceFolderContextKey
		});

		CommandsRegistry.registerCommand(AddToWorkspaceRecommendationsAction.ADD_ID, serviceAccessor => {
			serviceAccessor.get(IInstantiationService)
				.createInstance(AddToWorkspaceRecommendationsAction, AddToWorkspaceRecommendationsAction.ADD_ID, AddToWorkspaceRecommendationsAction.ADD_LABEL)
				.run(AddToWorkspaceRecommendationsAction.ADD);
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: AddToWorkspaceRecommendationsAction.ADD_ID,
				title: { value: `${ExtensionsLabel}: ${AddToWorkspaceRecommendationsAction.ADD_LABEL}`, original: 'Extensions: Add to Recommended Extensions (Workspace)' },
				category: localize('extensions', "Extensions")
			},
			when: this.addToWorkspaceRecommendationsContextKey
		});

		CommandsRegistry.registerCommand(AddToWorkspaceFolderRecommendationsAction.ADD_ID, serviceAccessor => {
			serviceAccessor.get(IInstantiationService)
				.createInstance(AddToWorkspaceFolderRecommendationsAction, AddToWorkspaceFolderRecommendationsAction.ADD_ID, AddToWorkspaceFolderRecommendationsAction.ADD_LABEL)
				.run(AddToWorkspaceRecommendationsAction.ADD);
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: AddToWorkspaceFolderRecommendationsAction.ADD_ID,
				title: { value: `${ExtensionsLabel}: ${AddToWorkspaceFolderRecommendationsAction.ADD_LABEL}`, original: 'Extensions: Add to Recommended Extensions (Workspace Folder)' },
				category: localize('extensions', "Extensions")
			},
			when: this.addToWorkspaceFolderRecommendationsContextKey
		});

		CommandsRegistry.registerCommand(AddToWorkspaceRecommendationsAction.IGNORE_ID, serviceAccessor => {
			serviceAccessor.get(IInstantiationService)
				.createInstance(AddToWorkspaceRecommendationsAction, AddToWorkspaceRecommendationsAction.IGNORE_ID, AddToWorkspaceRecommendationsAction.IGNORE_LABEL)
				.run(AddToWorkspaceRecommendationsAction.IGNORE);
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: AddToWorkspaceRecommendationsAction.IGNORE_ID,
				title: { value: `${ExtensionsLabel}: ${AddToWorkspaceRecommendationsAction.IGNORE_LABEL}`, original: 'Extensions: Ignore Recommended Extension (Workspace)' },
				category: localize('extensions', "Extensions")
			},
			when: this.addToWorkspaceRecommendationsContextKey
		});

		CommandsRegistry.registerCommand(AddToWorkspaceFolderRecommendationsAction.IGNORE_ID, serviceAccessor => {
			serviceAccessor.get(IInstantiationService)
				.createInstance(AddToWorkspaceFolderRecommendationsAction, AddToWorkspaceFolderRecommendationsAction.IGNORE_ID, AddToWorkspaceFolderRecommendationsAction.IGNORE_LABEL)
				.run(AddToWorkspaceRecommendationsAction.IGNORE);
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: AddToWorkspaceFolderRecommendationsAction.IGNORE_ID,
				title: { value: `${ExtensionsLabel}: ${AddToWorkspaceFolderRecommendationsAction.IGNORE_LABEL}`, original: 'Extensions: Ignore Recommended Extension (Workspace Folder)' },
				category: localize('extensions', "Extensions")
			},
			when: this.addToWorkspaceFolderRecommendationsContextKey
		});
	}
}

export abstract class AbstractConfigureRecommendedExtensionsAction extends Action {

	constructor(
		id: string,
		label: string,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IEditorService protected editorService: IEditorService,
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
		@ITextModelService private readonly textModelResolverService: ITextModelService
	) {
		super(id, label);
	}

	protected openExtensionsFile(extensionsFileResource: URI): Promise<any> {
		return this.getOrCreateExtensionsFile(extensionsFileResource)
			.then(({ created, content }) =>
				this.getSelectionPosition(content, extensionsFileResource, ['recommendations'])
					.then(selection => this.editorService.openEditor({
						resource: extensionsFileResource,
						options: {
							pinned: created,
							selection
						}
					})),
				error => Promise.reject(new Error(localize('OpenExtensionsFile.failed', "Unable to create 'extensions.json' file inside the '.vscode' folder ({0}).", error))));
	}

	protected openWorkspaceConfigurationFile(workspaceConfigurationFile: URI): Promise<any> {
		return this.getOrUpdateWorkspaceConfigurationFile(workspaceConfigurationFile)
			.then(content => this.getSelectionPosition(content.value.toString(), content.resource, ['extensions', 'recommendations']))
			.then(selection => this.editorService.openEditor({
				resource: workspaceConfigurationFile,
				options: {
					selection,
					forceReload: true // because content has changed
				}
			}));
	}

	protected addExtensionToWorkspaceConfig(workspaceConfigurationFile: URI, extensionId: string, shouldRecommend: boolean) {
		return this.getOrUpdateWorkspaceConfigurationFile(workspaceConfigurationFile)
			.then(content => {
				const extensionIdLowerCase = extensionId.toLowerCase();
				const workspaceExtensionsConfigContent: IExtensionsConfigContent = (json.parse(content.value.toString()) || {})['extensions'] || {};
				let insertInto = shouldRecommend ? workspaceExtensionsConfigContent.recommendations || [] : workspaceExtensionsConfigContent.unwantedRecommendations || [];
				let removeFrom = shouldRecommend ? workspaceExtensionsConfigContent.unwantedRecommendations || [] : workspaceExtensionsConfigContent.recommendations || [];

				if (insertInto.some(e => e.toLowerCase() === extensionIdLowerCase)) {
					return Promise.resolve(null);
				}

				insertInto.push(extensionId);
				removeFrom = removeFrom.filter(x => x.toLowerCase() !== extensionIdLowerCase);

				return this.jsonEditingService.write(workspaceConfigurationFile,
					{
						key: 'extensions',
						value: {
							recommendations: shouldRecommend ? insertInto : removeFrom,
							unwantedRecommendations: shouldRecommend ? removeFrom : insertInto
						}
					},
					true);
			});
	}

	protected addExtensionToWorkspaceFolderConfig(extensionsFileResource: URI, extensionId: string, shouldRecommend: boolean): Promise<any> {
		return this.getOrCreateExtensionsFile(extensionsFileResource)
			.then(({ content }) => {
				const extensionIdLowerCase = extensionId.toLowerCase();
				const extensionsConfigContent: IExtensionsConfigContent = json.parse(content) || {};
				let insertInto = shouldRecommend ? extensionsConfigContent.recommendations || [] : extensionsConfigContent.unwantedRecommendations || [];
				let removeFrom = shouldRecommend ? extensionsConfigContent.unwantedRecommendations || [] : extensionsConfigContent.recommendations || [];

				if (insertInto.some(e => e.toLowerCase() === extensionIdLowerCase)) {
					return Promise.resolve(null);
				}

				insertInto.push(extensionId);

				let removeFromPromise: Promise<void> = Promise.resolve();
				if (removeFrom.some(e => e.toLowerCase() === extensionIdLowerCase)) {
					removeFrom = removeFrom.filter(x => x.toLowerCase() !== extensionIdLowerCase);
					removeFromPromise = this.jsonEditingService.write(extensionsFileResource,
						{
							key: shouldRecommend ? 'unwantedRecommendations' : 'recommendations',
							value: removeFrom
						},
						true);
				}

				return removeFromPromise.then(() =>
					this.jsonEditingService.write(extensionsFileResource,
						{
							key: shouldRecommend ? 'recommendations' : 'unwantedRecommendations',
							value: insertInto
						},
						true)
				);
			});
	}

	protected getWorkspaceExtensionsConfigContent(extensionsFileResource: URI): Promise<IExtensionsConfigContent> {
		return Promise.resolve(this.fileService.readFile(extensionsFileResource))
			.then(content => {
				return (json.parse(content.value.toString()) || {})['extensions'] || {};
			}, err => ({ recommendations: [], unwantedRecommendations: [] }));
	}

	protected getWorkspaceFolderExtensionsConfigContent(extensionsFileResource: URI): Promise<IExtensionsConfigContent> {
		return Promise.resolve(this.fileService.readFile(extensionsFileResource))
			.then(content => {
				return (<IExtensionsConfigContent>json.parse(content.value.toString()));
			}, err => ({ recommendations: [], unwantedRecommendations: [] }));
	}

	private getOrUpdateWorkspaceConfigurationFile(workspaceConfigurationFile: URI): Promise<IFileContent> {
		return Promise.resolve(this.fileService.readFile(workspaceConfigurationFile))
			.then(content => {
				const workspaceRecommendations = <IExtensionsConfigContent>json.parse(content.value.toString())['extensions'];
				if (!workspaceRecommendations || !workspaceRecommendations.recommendations) {
					return this.jsonEditingService.write(workspaceConfigurationFile, { key: 'extensions', value: { recommendations: [] } }, true)
						.then(() => this.fileService.readFile(workspaceConfigurationFile));
				}
				return content;
			});
	}

	private getSelectionPosition(content: string, resource: URI, path: json.JSONPath): Promise<ITextEditorSelection | undefined> {
		const tree = json.parseTree(content);
		const node = json.findNodeAtLocation(tree, path);
		if (node && node.parent && node.parent.children) {
			const recommendationsValueNode = node.parent.children[1];
			const lastExtensionNode = recommendationsValueNode.children && recommendationsValueNode.children.length ? recommendationsValueNode.children[recommendationsValueNode.children.length - 1] : null;
			const offset = lastExtensionNode ? lastExtensionNode.offset + lastExtensionNode.length : recommendationsValueNode.offset + 1;
			return Promise.resolve(this.textModelResolverService.createModelReference(resource))
				.then(reference => {
					const position = reference.object.textEditorModel.getPositionAt(offset);
					reference.dispose();
					return <ITextEditorSelection>{
						startLineNumber: position.lineNumber,
						startColumn: position.column,
						endLineNumber: position.lineNumber,
						endColumn: position.column,
					};
				});
		}
		return Promise.resolve(undefined);
	}

	private getOrCreateExtensionsFile(extensionsFileResource: URI): Promise<{ created: boolean, extensionsFileResource: URI, content: string }> {
		return Promise.resolve(this.fileService.readFile(extensionsFileResource)).then(content => {
			return { created: false, extensionsFileResource, content: content.value.toString() };
		}, err => {
			return this.textFileService.write(extensionsFileResource, ExtensionsConfigurationInitialContent).then(() => {
				return { created: true, extensionsFileResource, content: ExtensionsConfigurationInitialContent };
			});
		});
	}
}

export class ConfigureWorkspaceRecommendedExtensionsAction extends AbstractConfigureRecommendedExtensionsAction {

	static readonly ID = 'workbench.extensions.action.configureWorkspaceRecommendedExtensions';
	static LABEL = localize('configureWorkspaceRecommendedExtensions', "Configure Recommended Extensions (Workspace)");


	constructor(
		id: string,
		label: string,
		@IFileService fileService: IFileService,
		@ITextFileService textFileService: ITextFileService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEditorService editorService: IEditorService,
		@IJSONEditingService jsonEditingService: IJSONEditingService,
		@ITextModelService textModelResolverService: ITextModelService
	) {
		super(id, label, contextService, fileService, textFileService, editorService, jsonEditingService, textModelResolverService);
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.update(), this));
		this.update();
	}

	private update(): void {
		this.enabled = this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY;
	}

	public run(): Promise<void> {
		switch (this.contextService.getWorkbenchState()) {
			case WorkbenchState.FOLDER:
				return this.openExtensionsFile(this.contextService.getWorkspace().folders[0].toResource(EXTENSIONS_CONFIG));
			case WorkbenchState.WORKSPACE:
				return this.openWorkspaceConfigurationFile(this.contextService.getWorkspace().configuration!);
		}
		return Promise.resolve();
	}
}

export class ConfigureWorkspaceFolderRecommendedExtensionsAction extends AbstractConfigureRecommendedExtensionsAction {

	static readonly ID = 'workbench.extensions.action.configureWorkspaceFolderRecommendedExtensions';
	static LABEL = localize('configureWorkspaceFolderRecommendedExtensions', "Configure Recommended Extensions (Workspace Folder)");


	constructor(
		id: string,
		label: string,
		@IFileService fileService: IFileService,
		@ITextFileService textFileService: ITextFileService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEditorService editorService: IEditorService,
		@IJSONEditingService jsonEditingService: IJSONEditingService,
		@ITextModelService textModelResolverService: ITextModelService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(id, label, contextService, fileService, textFileService, editorService, jsonEditingService, textModelResolverService);
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => this.update(), this));
		this.update();
	}

	private update(): void {
		this.enabled = this.contextService.getWorkspace().folders.length > 0;
	}

	public run(): Promise<any> {
		const folderCount = this.contextService.getWorkspace().folders.length;
		const pickFolderPromise = folderCount === 1 ? Promise.resolve(this.contextService.getWorkspace().folders[0]) : this.commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
		return Promise.resolve(pickFolderPromise)
			.then(workspaceFolder => {
				if (workspaceFolder) {
					return this.openExtensionsFile(workspaceFolder.toResource(EXTENSIONS_CONFIG));
				}
				return null;
			});
	}
}

export class AddToWorkspaceFolderRecommendationsAction extends AbstractConfigureRecommendedExtensionsAction {
	static readonly ADD = true;
	static readonly IGNORE = false;
	static readonly ADD_ID = 'workbench.extensions.action.addToWorkspaceFolderRecommendations';
	static readonly ADD_LABEL = localize('addToWorkspaceFolderRecommendations', "Add to Recommended Extensions (Workspace Folder)");
	static readonly IGNORE_ID = 'workbench.extensions.action.addToWorkspaceFolderIgnoredRecommendations';
	static readonly IGNORE_LABEL = localize('addToWorkspaceFolderIgnoredRecommendations', "Ignore Recommended Extension (Workspace Folder)");

	constructor(
		id: string,
		label: string,
		@IFileService fileService: IFileService,
		@ITextFileService textFileService: ITextFileService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEditorService editorService: IEditorService,
		@IJSONEditingService jsonEditingService: IJSONEditingService,
		@ITextModelService textModelResolverService: ITextModelService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(id, label, contextService, fileService, textFileService, editorService, jsonEditingService, textModelResolverService);
	}

	run(shouldRecommend: boolean): Promise<void> {
		if (!(this.editorService.activeEditor instanceof ExtensionsInput) || !this.editorService.activeEditor.extension) {
			return Promise.resolve();
		}
		const folders = this.contextService.getWorkspace().folders;
		if (!folders || !folders.length) {
			this.notificationService.info(localize('AddToWorkspaceFolderRecommendations.noWorkspace', 'There are no workspace folders open to add recommendations.'));
			return Promise.resolve();
		}

		const extensionId = this.editorService.activeEditor.extension.identifier;
		const pickFolderPromise = folders.length === 1
			? Promise.resolve(folders[0])
			: this.commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
		return Promise.resolve(pickFolderPromise)
			.then(workspaceFolder => {
				if (!workspaceFolder) {
					return Promise.resolve();
				}
				const configurationFile = workspaceFolder.toResource(EXTENSIONS_CONFIG);
				return this.getWorkspaceFolderExtensionsConfigContent(configurationFile).then(content => {
					const extensionIdLowerCase = extensionId.id.toLowerCase();
					if (shouldRecommend) {
						if ((content.recommendations || []).some(e => e.toLowerCase() === extensionIdLowerCase)) {
							this.notificationService.info(localize('AddToWorkspaceFolderRecommendations.alreadyExists', 'This extension is already present in this workspace folder\'s recommendations.'));
							return Promise.resolve();
						}

						return this.addExtensionToWorkspaceFolderConfig(configurationFile, extensionId.id, shouldRecommend).then(() => {
							this.notificationService.prompt(Severity.Info,
								localize('AddToWorkspaceFolderRecommendations.success', 'The extension was successfully added to this workspace folder\'s recommendations.'),
								[{
									label: localize('viewChanges', "View Changes"),
									run: () => this.openExtensionsFile(configurationFile)
								}]);
						}, err => {
							this.notificationService.error(localize('AddToWorkspaceFolderRecommendations.failure', 'Failed to write to extensions.json. {0}', err));
						});
					}
					else {
						if ((content.unwantedRecommendations || []).some(e => e.toLowerCase() === extensionIdLowerCase)) {
							this.notificationService.info(localize('AddToWorkspaceFolderIgnoredRecommendations.alreadyExists', 'This extension is already present in this workspace folder\'s unwanted recommendations.'));
							return Promise.resolve();
						}

						return this.addExtensionToWorkspaceFolderConfig(configurationFile, extensionId.id, shouldRecommend).then(() => {
							this.notificationService.prompt(Severity.Info,
								localize('AddToWorkspaceFolderIgnoredRecommendations.success', 'The extension was successfully added to this workspace folder\'s unwanted recommendations.'),
								[{
									label: localize('viewChanges', "View Changes"),
									run: () => this.openExtensionsFile(configurationFile)
								}]);
						}, err => {
							this.notificationService.error(localize('AddToWorkspaceFolderRecommendations.failure', 'Failed to write to extensions.json. {0}', err));
						});
					}
				});
			});
	}
}

export class AddToWorkspaceRecommendationsAction extends AbstractConfigureRecommendedExtensionsAction {
	static readonly ADD = true;
	static readonly IGNORE = false;
	static readonly ADD_ID = 'workbench.extensions.action.addToWorkspaceRecommendations';
	static readonly ADD_LABEL = localize('addToWorkspaceRecommendations', "Add to Recommended Extensions (Workspace)");
	static readonly IGNORE_ID = 'workbench.extensions.action.addToWorkspaceIgnoredRecommendations';
	static readonly IGNORE_LABEL = localize('addToWorkspaceIgnoredRecommendations', "Ignore Recommended Extension (Workspace)");

	constructor(
		id: string,
		label: string,
		@IFileService fileService: IFileService,
		@ITextFileService textFileService: ITextFileService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IEditorService editorService: IEditorService,
		@IJSONEditingService jsonEditingService: IJSONEditingService,
		@ITextModelService textModelResolverService: ITextModelService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super(id, label, contextService, fileService, textFileService, editorService, jsonEditingService, textModelResolverService);
	}

	run(shouldRecommend: boolean): Promise<void> {
		const workspaceConfig = this.contextService.getWorkspace().configuration;

		if (!(this.editorService.activeEditor instanceof ExtensionsInput) || !this.editorService.activeEditor.extension || !workspaceConfig) {
			return Promise.resolve();
		}

		const extensionId = this.editorService.activeEditor.extension.identifier;

		return this.getWorkspaceExtensionsConfigContent(workspaceConfig).then(content => {
			const extensionIdLowerCase = extensionId.id.toLowerCase();
			if (shouldRecommend) {
				if ((content.recommendations || []).some(e => e.toLowerCase() === extensionIdLowerCase)) {
					this.notificationService.info(localize('AddToWorkspaceRecommendations.alreadyExists', 'This extension is already present in workspace recommendations.'));
					return Promise.resolve();
				}

				return this.addExtensionToWorkspaceConfig(workspaceConfig, extensionId.id, shouldRecommend).then(() => {
					this.notificationService.prompt(Severity.Info,
						localize('AddToWorkspaceRecommendations.success', 'The extension was successfully added to this workspace\'s recommendations.'),
						[{
							label: localize('viewChanges', "View Changes"),
							run: () => this.openWorkspaceConfigurationFile(workspaceConfig)
						}]);

				}, err => {
					this.notificationService.error(localize('AddToWorkspaceRecommendations.failure', 'Failed to write. {0}', err));
				});
			} else {
				if ((content.unwantedRecommendations || []).some(e => e.toLowerCase() === extensionIdLowerCase)) {
					this.notificationService.info(localize('AddToWorkspaceUnwantedRecommendations.alreadyExists', 'This extension is already present in workspace unwanted recommendations.'));
					return Promise.resolve();
				}

				return this.addExtensionToWorkspaceConfig(workspaceConfig, extensionId.id, shouldRecommend).then(() => {
					this.notificationService.prompt(Severity.Info,
						localize('AddToWorkspaceUnwantedRecommendations.success', 'The extension was successfully added to this workspace\'s unwanted recommendations.'),
						[{
							label: localize('viewChanges', "View Changes"),
							run: () => this.openWorkspaceConfigurationFile(workspaceConfig)
						}]);
				}, err => {
					this.notificationService.error(localize('AddToWorkspaceRecommendations.failure', 'Failed to write. {0}', err));
				});
			}
		});
	}
}

export class StatusLabelAction extends Action implements IExtensionContainer {

	private static readonly ENABLED_CLASS = 'extension-status-label';
	private static readonly DISABLED_CLASS = `${StatusLabelAction.ENABLED_CLASS} hide`;

	private initialStatus: ExtensionState | null = null;
	private status: ExtensionState | null = null;
	private enablementState: EnablementState | null = null;

	private _extension: IExtension;
	get extension(): IExtension { return this._extension; }
	set extension(extension: IExtension) {
		if (!(this._extension && extension && areSameExtensions(this._extension.identifier, extension.identifier))) {
			// Different extension. Reset
			this.initialStatus = null;
			this.status = null;
			this.enablementState = null;
		}
		this._extension = extension;
		this.update();
	}

	constructor(
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService
	) {
		super('extensions.action.statusLabel', '', StatusLabelAction.DISABLED_CLASS, false);
	}

	update(): void {
		this.computeLabel()
			.then(label => {
				this.label = label || '';
				this.class = label ? StatusLabelAction.ENABLED_CLASS : StatusLabelAction.DISABLED_CLASS;
			});
	}

	private async computeLabel(): Promise<string | null> {
		if (!this.extension) {
			return null;
		}

		const currentStatus = this.status;
		const currentEnablementState = this.enablementState;
		this.status = this.extension.state;
		if (this.initialStatus === null) {
			this.initialStatus = this.status;
		}
		this.enablementState = this.extension.enablementState;

		const runningExtensions = await this.extensionService.getExtensions();
		const canAddExtension = () => {
			const runningExtension = runningExtensions.filter(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier))[0];
			if (this.extension.local) {
				if (runningExtension && this.extension.version === runningExtension.version) {
					return true;
				}
				return this.extensionService.canAddExtension(toExtensionDescription(this.extension.local));
			}
			return false;
		};
		const canRemoveExtension = () => {
			if (this.extension.local) {
				if (runningExtensions.every(e => !(areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier) && this.extension.server === this.extensionManagementServerService.getExtensionManagementServer(e.extensionLocation)))) {
					return true;
				}
				return this.extensionService.canRemoveExtension(toExtensionDescription(this.extension.local));
			}
			return false;
		};

		if (currentStatus !== null) {
			if (currentStatus === ExtensionState.Installing && this.status === ExtensionState.Installed) {
				return canAddExtension() ? this.initialStatus === ExtensionState.Installed ? localize('updated', "Updated") : localize('installed', "Installed") : null;
			}
			if (currentStatus === ExtensionState.Uninstalling && this.status === ExtensionState.Uninstalled) {
				this.initialStatus = this.status;
				return canRemoveExtension() ? localize('uninstalled', "Uninstalled") : null;
			}
		}

		if (currentEnablementState !== null) {
			const currentlyEnabled = currentEnablementState === EnablementState.Enabled || currentEnablementState === EnablementState.WorkspaceEnabled;
			const enabled = this.enablementState === EnablementState.Enabled || this.enablementState === EnablementState.WorkspaceEnabled;
			if (!currentlyEnabled && enabled) {
				return canAddExtension() ? localize('enabled', "Enabled") : null;
			}
			if (currentlyEnabled && !enabled) {
				return canRemoveExtension() ? localize('disabled', "Disabled") : null;
			}

		}

		return null;
	}

	run(): Promise<any> {
		return Promise.resolve();
	}

}

export class MaliciousStatusLabelAction extends ExtensionAction {

	private static readonly Class = 'malicious-status';

	constructor(long: boolean) {
		const tooltip = localize('malicious tooltip', "This extension was reported to be problematic.");
		const label = long ? tooltip : localize('malicious', "Malicious");
		super('extensions.install', label, '', false);
		this.tooltip = localize('malicious tooltip', "This extension was reported to be problematic.");
	}

	update(): void {
		if (this.extension && this.extension.isMalicious) {
			this.class = `${MaliciousStatusLabelAction.Class} malicious`;
		} else {
			this.class = `${MaliciousStatusLabelAction.Class} not-malicious`;
		}
	}

	run(): Promise<any> {
		return Promise.resolve();
	}
}

export class DisabledLabelAction extends ExtensionAction {

	private static readonly Class = 'disable-status';

	updateWhenCounterExtensionChanges: boolean = true;
	private _runningExtensions: IExtensionDescription[] | null = null;

	constructor(
		private readonly warningAction: SystemDisabledWarningAction,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService,
		@IExtensionService private readonly extensionService: IExtensionService,
	) {
		super('extensions.disabledLabel', warningAction.tooltip, `${DisabledLabelAction.Class} hide`, false);
		this._register(warningAction.onDidChange(() => this.update(), this));
		this._register(this.extensionService.onDidChangeExtensions(this.updateRunningExtensions, this));
		this.updateRunningExtensions();
	}

	private updateRunningExtensions(): void {
		this.extensionService.getExtensions().then(runningExtensions => { this._runningExtensions = runningExtensions; this.update(); });
	}

	update(): void {
		this.class = `${DisabledLabelAction.Class} hide`;
		this.label = '';
		if (this.warningAction.tooltip) {
			this.class = DisabledLabelAction.Class;
			this.label = this.warningAction.tooltip;
			return;
		}
		if (this.extension && this.extension.local && isLanguagePackExtension(this.extension.local.manifest)) {
			return;
		}
		if (this.extension && this.extension.local && this._runningExtensions) {
			const isEnabled = this.extensionEnablementService.isEnabled(this.extension.local);
			const isExtensionRunning = this._runningExtensions.some(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier));
			if (!isExtensionRunning && !isEnabled && this.extensionEnablementService.canChangeEnablement(this.extension.local)) {
				this.class = DisabledLabelAction.Class;
				this.label = localize('disabled by user', "This extension is disabled by the user.");
				return;
			}
		}
	}

	run(): Promise<any> {
		return Promise.resolve(null);
	}
}

export class SystemDisabledWarningAction extends ExtensionAction {

	private static readonly CLASS = 'system-disable';
	private static readonly WARNING_CLASS = `${SystemDisabledWarningAction.CLASS} warning`;
	private static readonly INFO_CLASS = `${SystemDisabledWarningAction.CLASS} info`;

	updateWhenCounterExtensionChanges: boolean = true;
	private _runningExtensions: IExtensionDescription[] | null = null;

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionService private readonly extensionService: IExtensionService,
	) {
		super('extensions.install', '', `${SystemDisabledWarningAction.CLASS} hide`, false);
		this._register(this.labelService.onDidChangeFormatters(() => this.update(), this));
		this._register(this.extensionService.onDidChangeExtensions(this.updateRunningExtensions, this));
		this.updateRunningExtensions();
		this.update();
	}

	private updateRunningExtensions(): void {
		this.extensionService.getExtensions().then(runningExtensions => { this._runningExtensions = runningExtensions; this.update(); });
	}

	update(): void {
		this.class = `${SystemDisabledWarningAction.CLASS} hide`;
		this.tooltip = '';
		if (
			!this.extension ||
			!this.extension.local ||
			!this.extension.server ||
			!this._runningExtensions ||
			!this.workbenchEnvironmentService.configuration.remoteAuthority ||
			!this.extensionManagementServerService.remoteExtensionManagementServer ||
			this.extension.state !== ExtensionState.Installed
		) {
			return;
		}
		if (isLanguagePackExtension(this.extension.local.manifest)) {
			if (!this.extensionsWorkbenchService.installed.some(e => areSameExtensions(e.identifier, this.extension.identifier) && e.server !== this.extension.server)) {
				this.class = `${SystemDisabledWarningAction.INFO_CLASS}`;
				this.tooltip = this.extension.server === this.extensionManagementServerService.localExtensionManagementServer
					? localize('Install language pack also in remote server', "Install the language pack extension on '{0}' to enable it also there.", this.getServerLabel(this.extensionManagementServerService.remoteExtensionManagementServer))
					: localize('Install language pack also locally', "Install the language pack extension locally to enable it also there.");
			}
			return;
		}
		const runningExtension = this._runningExtensions.filter(e => areSameExtensions({ id: e.identifier.value, uuid: e.uuid }, this.extension.identifier))[0];
		const runningExtensionServer = runningExtension ? this.extensionManagementServerService.getExtensionManagementServer(runningExtension.extensionLocation) : null;
		const localExtension = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, this.extension.identifier))[0];
		const localExtensionServer = localExtension ? localExtension.server : null;
		if (this.extension.server === this.extensionManagementServerService.localExtensionManagementServer && !isUIExtension(this.extension.local.manifest, this.productService, this.configurationService)) {
			if (runningExtensionServer === this.extensionManagementServerService.remoteExtensionManagementServer) {
				this.class = `${SystemDisabledWarningAction.INFO_CLASS}`;
				this.tooltip = localize('disabled locally', "Extension is enabled on '{0}' and disabled locally.", this.getServerLabel(this.extensionManagementServerService.remoteExtensionManagementServer));
				return;
			}
			if (localExtensionServer !== this.extensionManagementServerService.remoteExtensionManagementServer) {
				this.class = `${SystemDisabledWarningAction.WARNING_CLASS}`;
				this.tooltip = localize('Install in remote server', "Install the extension on '{0}' to enable.", this.getServerLabel(this.extensionManagementServerService.remoteExtensionManagementServer));
				return;
			}
		}
		if (this.extension.server === this.extensionManagementServerService.remoteExtensionManagementServer && isUIExtension(this.extension.local.manifest, this.productService, this.configurationService)) {
			if (runningExtensionServer === this.extensionManagementServerService.localExtensionManagementServer) {
				this.class = `${SystemDisabledWarningAction.INFO_CLASS}`;
				this.tooltip = localize('disabled remotely', "Extension is enabled locally and disabled on '{0}'.", this.getServerLabel(this.extensionManagementServerService.remoteExtensionManagementServer));
				return;
			}
			if (localExtensionServer !== this.extensionManagementServerService.localExtensionManagementServer) {
				this.class = `${SystemDisabledWarningAction.WARNING_CLASS}`;
				this.tooltip = localize('Install in local server', "Install the extension locally to enable.");
				return;
			}
		}
	}

	private getServerLabel(server: IExtensionManagementServer): string {
		if (server === this.extensionManagementServerService.remoteExtensionManagementServer) {
			return this.labelService.getHostLabel(REMOTE_HOST_SCHEME, this.workbenchEnvironmentService.configuration.remoteAuthority) || localize('remote', "Remote");
		}
		return server.label;
	}
	run(): Promise<any> {
		return Promise.resolve(null);
	}
}

export class DisableAllAction extends Action {

	static readonly ID = 'workbench.extensions.action.disableAll';
	static LABEL = localize('disableAll', "Disable All Installed Extensions");


	constructor(
		id: string = DisableAllAction.ID, label: string = DisableAllAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(id, label);
		this.update();
		this._register(this.extensionsWorkbenchService.onChange(() => this.update()));
	}

	private update(): void {
		this.enabled = this.extensionsWorkbenchService.local.some(e => e.type === ExtensionType.User && (e.enablementState === EnablementState.Enabled || e.enablementState === EnablementState.WorkspaceEnabled) && !!e.local && this.extensionEnablementService.canChangeEnablement(e.local));
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extensionsWorkbenchService.local.filter(e => e.type === ExtensionType.User), EnablementState.Disabled);
	}
}

export class DisableAllWorkpsaceAction extends Action {

	static readonly ID = 'workbench.extensions.action.disableAllWorkspace';
	static LABEL = localize('disableAllWorkspace', "Disable All Installed Extensions for this Workspace");


	constructor(
		id: string = DisableAllWorkpsaceAction.ID, label: string = DisableAllWorkpsaceAction.LABEL,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super(id, label);
		this.update();
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.update(), this));
		this._register(this.extensionsWorkbenchService.onChange(() => this.update(), this));
	}

	private update(): void {
		this.enabled = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.extensionsWorkbenchService.local.some(e => e.type === ExtensionType.User && (e.enablementState === EnablementState.Enabled || e.enablementState === EnablementState.WorkspaceEnabled));
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extensionsWorkbenchService.local.filter(e => e.type === ExtensionType.User), EnablementState.WorkspaceDisabled);
	}
}

export class EnableAllAction extends Action {

	static readonly ID = 'workbench.extensions.action.enableAll';
	static LABEL = localize('enableAll', "Enable All Extensions");


	constructor(
		id: string = EnableAllAction.ID, label: string = EnableAllAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(id, label);
		this.update();
		this._register(this.extensionsWorkbenchService.onChange(() => this.update()));
	}

	private update(): void {
		this.enabled = this.extensionsWorkbenchService.local.some(e => !!e.local && this.extensionEnablementService.canChangeEnablement(e.local) && (e.enablementState === EnablementState.Disabled || e.enablementState === EnablementState.WorkspaceDisabled));
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extensionsWorkbenchService.local, EnablementState.Enabled);
	}
}

export class EnableAllWorkpsaceAction extends Action {

	static readonly ID = 'workbench.extensions.action.enableAllWorkspace';
	static LABEL = localize('enableAllWorkspace', "Enable All Extensions for this Workspace");


	constructor(
		id: string = EnableAllWorkpsaceAction.ID, label: string = EnableAllWorkpsaceAction.LABEL,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionEnablementService private readonly extensionEnablementService: IExtensionEnablementService
	) {
		super(id, label);
		this.update();
		this._register(this.extensionsWorkbenchService.onChange(() => this.update(), this));
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this.update(), this));
	}

	private update(): void {
		this.enabled = this.workspaceContextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.extensionsWorkbenchService.local.some(e => !!e.local && this.extensionEnablementService.canChangeEnablement(e.local) && (e.enablementState === EnablementState.Disabled || e.enablementState === EnablementState.WorkspaceDisabled));
	}

	run(): Promise<any> {
		return this.extensionsWorkbenchService.setEnablement(this.extensionsWorkbenchService.local, EnablementState.WorkspaceEnabled);
	}
}

export class OpenExtensionsFolderAction extends Action {

	static readonly ID = 'workbench.extensions.action.openExtensionsFolder';
	static LABEL = localize('openExtensionsFolder', "Open Extensions Folder");

	constructor(
		id: string,
		label: string,
		@IWindowsService private readonly windowsService: IWindowsService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		const extensionsHome = URI.file(this.environmentService.extensionsPath);

		return Promise.resolve(this.fileService.resolve(extensionsHome)).then(file => {
			let itemToShow: URI;
			if (file.children && file.children.length > 0) {
				itemToShow = file.children[0].resource;
			} else {
				itemToShow = extensionsHome;
			}

			return this.windowsService.showItemInFolder(itemToShow);
		});
	}
}

export class InstallVSIXAction extends Action {

	static readonly ID = 'workbench.extensions.action.installVSIX';
	static LABEL = localize('installVSIX', "Install from VSIX...");

	constructor(
		id = InstallVSIXAction.ID,
		label = InstallVSIXAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWindowService private readonly windowService: IWindowService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(id, label, 'extension-action install-vsix', true);
	}

	run(): Promise<any> {
		return Promise.resolve(this.windowService.showOpenDialog({
			title: localize('installFromVSIX', "Install from VSIX"),
			filters: [{ name: 'VSIX Extensions', extensions: ['vsix'] }],
			properties: ['openFile'],
			buttonLabel: mnemonicButtonLabel(localize({ key: 'installButton', comment: ['&& denotes a mnemonic'] }, "&&Install"))
		})).then(result => {
			if (!result) {
				return Promise.resolve();
			}

			return Promise.all(result.map(vsix => this.extensionsWorkbenchService.install(vsix)))
				.then(extensions => {
					for (const extension of extensions) {
						const requireReload = !(extension.local && this.extensionService.canAddExtension(toExtensionDescription(extension.local)));
						const message = requireReload ? localize('InstallVSIXAction.successReload', "Please reload Visual Studio Code to complete installing the extension {0}.", extension.displayName || extension.name)
							: localize('InstallVSIXAction.success', "Completed installing the extension {0}.", extension.displayName || extension.name);
						const actions = requireReload ? [{
							label: localize('InstallVSIXAction.reloadNow', "Reload Now"),
							run: () => this.windowService.reloadWindow()
						}] : [];
						this.notificationService.prompt(
							Severity.Info,
							message,
							actions,
							{ sticky: true }
						);
					}
					return this.instantiationService.createInstance(ShowInstalledExtensionsAction, ShowInstalledExtensionsAction.ID, ShowInstalledExtensionsAction.LABEL).run();
				});
		});
	}
}

export class ReinstallAction extends Action {

	static readonly ID = 'workbench.extensions.action.reinstall';
	static LABEL = localize('reinstall', "Reinstall Extension...");

	constructor(
		id: string = ReinstallAction.ID, label: string = ReinstallAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWindowService private readonly windowService: IWindowService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super(id, label);
	}

	get enabled(): boolean {
		return this.extensionsWorkbenchService.local.filter(l => l.type === ExtensionType.User && l.local).length > 0;
	}

	run(): Promise<any> {
		return this.quickInputService.pick(this.getEntries(), { placeHolder: localize('selectExtensionToReinstall', "Select Extension to Reinstall") })
			.then(pick => pick && this.reinstallExtension(pick.extension));
	}

	private getEntries(): Promise<(IQuickPickItem & { extension: IExtension })[]> {
		return this.extensionsWorkbenchService.queryLocal()
			.then(local => {
				const entries = local
					.filter(extension => extension.type === ExtensionType.User)
					.map(extension => {
						return {
							id: extension.identifier.id,
							label: extension.displayName,
							description: extension.identifier.id,
							extension,
						} as (IQuickPickItem & { extension: IExtension });
					});
				return entries;
			});
	}

	private reinstallExtension(extension: IExtension): Promise<void> {
		return this.instantiationService.createInstance(ShowInstalledExtensionsAction, ShowInstalledExtensionsAction.ID, ShowInstalledExtensionsAction.LABEL).run()
			.then(() => {
				return this.extensionsWorkbenchService.reinstall(extension)
					.then(extension => {
						const requireReload = !(extension.local && this.extensionService.canAddExtension(toExtensionDescription(extension.local)));
						const message = requireReload ? localize('ReinstallAction.successReload', "Please reload Visual Studio Code to complete reinstalling the extension {0}.", extension.identifier.id)
							: localize('ReinstallAction.success', "Reinstalling the extension {0} is completed.", extension.identifier.id);
						const actions = requireReload ? [{
							label: localize('InstallVSIXAction.reloadNow', "Reload Now"),
							run: () => this.windowService.reloadWindow()
						}] : [];
						this.notificationService.prompt(
							Severity.Info,
							message,
							actions,
							{ sticky: true }
						);
					}, error => this.notificationService.error(error));
			});
	}
}

export class InstallSpecificVersionOfExtensionAction extends Action {

	static readonly ID = 'workbench.extensions.action.install.specificVersion';
	static LABEL = localize('install previous version', "Install Specific Version of Extension...");

	constructor(
		id: string = InstallSpecificVersionOfExtensionAction.ID, label: string = InstallSpecificVersionOfExtensionAction.LABEL,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWindowService private readonly windowService: IWindowService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super(id, label);
	}

	get enabled(): boolean {
		return this.extensionsWorkbenchService.local.some(l => this.isEnabled(l));
	}

	async run(): Promise<any> {
		const extensionPick = await this.quickInputService.pick(this.getExtensionEntries(), { placeHolder: localize('selectExtension', "Select Extension"), matchOnDetail: true });
		if (extensionPick && extensionPick.extension) {
			const versionPick = await this.quickInputService.pick(extensionPick.versions.map(v => ({ id: v.version, label: v.version, description: `${getRelativeDateLabel(new Date(Date.parse(v.date)))}${v.version === extensionPick.extension.version ? ` (${localize('current', "Current")})` : ''}` })), { placeHolder: localize('selectVersion', "Select Version to Install"), matchOnDetail: true });
			if (versionPick) {
				if (extensionPick.extension.version !== versionPick.id) {
					await this.install(extensionPick.extension, versionPick.id);
				}
			}
		}
	}

	private isEnabled(extension: IExtension): boolean {
		return !!extension.gallery && (extension.enablementState === EnablementState.Enabled || extension.enablementState === EnablementState.WorkspaceEnabled);
	}

	private async getExtensionEntries(): Promise<(IQuickPickItem & { extension: IExtension, versions: IGalleryExtensionVersion[] })[]> {
		const installed = await this.extensionsWorkbenchService.queryLocal();
		const versionsPromises: Promise<{ extension: IExtension, versions: IGalleryExtensionVersion[] } | null>[] = [];
		for (const extension of installed) {
			if (this.isEnabled(extension)) {
				versionsPromises.push(this.extensionGalleryService.getAllVersions(extension.gallery!, true)
					.then(versions => (versions.length ? { extension, versions } : null)));
			}
		}

		const extensions = await Promise.all(versionsPromises);
		return coalesce(extensions)
			.sort((e1, e2) => e1.extension.displayName.localeCompare(e2.extension.displayName))
			.map(({ extension, versions }) => {
				return {
					id: extension.identifier.id,
					label: extension.displayName || extension.identifier.id,
					description: extension.identifier.id,
					extension,
					versions
				} as (IQuickPickItem & { extension: IExtension, versions: IGalleryExtensionVersion[] });
			});
	}

	private install(extension: IExtension, version: string): Promise<void> {
		return this.instantiationService.createInstance(ShowInstalledExtensionsAction, ShowInstalledExtensionsAction.ID, ShowInstalledExtensionsAction.LABEL).run()
			.then(() => {
				return this.extensionsWorkbenchService.installVersion(extension, version)
					.then(extension => {
						const requireReload = !(extension.local && this.extensionService.canAddExtension(toExtensionDescription(extension.local)));
						const message = requireReload ? localize('InstallAnotherVersionExtensionAction.successReload', "Please reload Visual Studio Code to complete installing the extension {0}.", extension.identifier.id)
							: localize('InstallAnotherVersionExtensionAction.success', "Installing the extension {0} is completed.", extension.identifier.id);
						const actions = requireReload ? [{
							label: localize('InstallAnotherVersionExtensionAction.reloadNow', "Reload Now"),
							run: () => this.windowService.reloadWindow()
						}] : [];
						this.notificationService.prompt(
							Severity.Info,
							message,
							actions,
							{ sticky: true }
						);
					}, error => this.notificationService.error(error));
			});
	}
}

CommandsRegistry.registerCommand('workbench.extensions.action.showExtensionsForLanguage', function (accessor: ServicesAccessor, fileExtension: string) {
	const viewletService = accessor.get(IViewletService);

	return viewletService.openViewlet(VIEWLET_ID, true)
		.then(viewlet => viewlet as IExtensionsViewlet)
		.then(viewlet => {
			viewlet.search(`ext:${fileExtension.replace(/^\./, '')}`);
			viewlet.focus();
		});
});

CommandsRegistry.registerCommand('workbench.extensions.action.showExtensionsWithIds', function (accessor: ServicesAccessor, extensionIds: string[]) {
	const viewletService = accessor.get(IViewletService);

	return viewletService.openViewlet(VIEWLET_ID, true)
		.then(viewlet => viewlet as IExtensionsViewlet)
		.then(viewlet => {
			const query = extensionIds
				.map(id => `@id:${id}`)
				.join(' ');
			viewlet.search(query);
			viewlet.focus();
		});
});

export const extensionButtonProminentBackground = registerColor('extensionButton.prominentBackground', {
	dark: '#327e36',
	light: '#327e36',
	hc: null
}, localize('extensionButtonProminentBackground', "Button background color for actions extension that stand out (e.g. install button)."));

export const extensionButtonProminentForeground = registerColor('extensionButton.prominentForeground', {
	dark: Color.white,
	light: Color.white,
	hc: null
}, localize('extensionButtonProminentForeground', "Button foreground color for actions extension that stand out (e.g. install button)."));

export const extensionButtonProminentHoverBackground = registerColor('extensionButton.prominentHoverBackground', {
	dark: '#28632b',
	light: '#28632b',
	hc: null
}, localize('extensionButtonProminentHoverBackground', "Button background hover color for actions extension that stand out (e.g. install button)."));

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
	const foregroundColor = theme.getColor(foreground);
	if (foregroundColor) {
		collector.addRule(`.extension .monaco-action-bar .action-item .action-label.extension-action.built-in-status { border-color: ${foregroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item .action-label.extension-action.built-in-status { border-color: ${foregroundColor}; }`);
	}

	const buttonBackgroundColor = theme.getColor(buttonBackground);
	if (buttonBackgroundColor) {
		collector.addRule(`.extension .monaco-action-bar .action-item .action-label.extension-action { background-color: ${buttonBackgroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item .action-label.extension-action { background-color: ${buttonBackgroundColor}; }`);
	}

	const buttonForegroundColor = theme.getColor(buttonForeground);
	if (buttonForegroundColor) {
		collector.addRule(`.extension .monaco-action-bar .action-item .action-label.extension-action { color: ${buttonForegroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item .action-label.extension-action { color: ${buttonForegroundColor}; }`);
	}

	const buttonHoverBackgroundColor = theme.getColor(buttonHoverBackground);
	if (buttonHoverBackgroundColor) {
		collector.addRule(`.extension .monaco-action-bar .action-item:hover .action-label.extension-action { background-color: ${buttonHoverBackgroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item:hover .action-label.extension-action { background-color: ${buttonHoverBackgroundColor}; }`);
	}

	const contrastBorderColor = theme.getColor(contrastBorder);
	if (contrastBorderColor) {
		collector.addRule(`.extension .monaco-action-bar .action-item .action-label.extension-action { border: 1px solid ${contrastBorderColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item .action-label.extension-action { border: 1px solid ${contrastBorderColor}; }`);
	}

	const extensionButtonProminentBackgroundColor = theme.getColor(extensionButtonProminentBackground);
	if (extensionButtonProminentBackground) {
		collector.addRule(`.extension .monaco-action-bar .action-item .action-label.extension-action.prominent { background-color: ${extensionButtonProminentBackgroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item .action-label.extension-action.prominent { background-color: ${extensionButtonProminentBackgroundColor}; }`);
	}

	const extensionButtonProminentForegroundColor = theme.getColor(extensionButtonProminentForeground);
	if (extensionButtonProminentForeground) {
		collector.addRule(`.extension .monaco-action-bar .action-item .action-label.extension-action.prominent { color: ${extensionButtonProminentForegroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item .action-label.extension-action.prominent { color: ${extensionButtonProminentForegroundColor}; }`);
	}

	const extensionButtonProminentHoverBackgroundColor = theme.getColor(extensionButtonProminentHoverBackground);
	if (extensionButtonProminentHoverBackground) {
		collector.addRule(`.extension .monaco-action-bar .action-item:hover .action-label.extension-action.prominent { background-color: ${extensionButtonProminentHoverBackgroundColor}; }`);
		collector.addRule(`.extension-editor .monaco-action-bar .action-item:hover .action-label.extension-action.prominent { background-color: ${extensionButtonProminentHoverBackgroundColor}; }`);
	}
});
