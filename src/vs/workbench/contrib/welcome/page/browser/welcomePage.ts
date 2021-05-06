/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./welcomePage';
import 'vs/workbench/contrib/welcome/page/browser/vs_code_welcome_page';
import { URI } from 'vs/base/common/uri';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import * as arrays from 'vs/base/common/arrays';
import { WalkThroughInput } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughInput';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { onUnexpectedError, isPromiseCanceledError } from 'vs/base/common/errors';
import { IWindowOpenable } from 'vs/platform/windows/common/windows';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { localize } from 'vs/nls';
import { Action, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { getInstalledExtensions, IExtensionStatus, onExtensionChanged, isKeymapExtension } from 'vs/workbench/contrib/extensions/common/extensionsUtils';
import { IExtensionManagementService, IExtensionGalleryService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionRecommendationsService } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { ILifecycleService, StartupKind } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Disposable } from 'vs/base/common/lifecycle';
import { splitName } from 'vs/base/common/labels';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { focusBorder, textLinkForeground, textLinkActiveForeground, foreground, descriptionForeground, contrastBorder, activeContrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { getExtraColor } from 'vs/workbench/contrib/welcome/walkThrough/common/walkThroughUtils';
import { IExtensionsViewPaneContainer, IExtensionsWorkbenchService, VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { IEditorInputSerializer, EditorInput } from 'vs/workbench/common/editor';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { TimeoutTimer } from 'vs/base/common/async';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ILabelService } from 'vs/platform/label/common/label';
import { IFileService } from 'vs/platform/files/common/files';
import { joinPath } from 'vs/base/common/resources';
import { IRecentlyOpened, isRecentWorkspace, IRecentWorkspace, IRecentFolder, isRecentFolder, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IProductService } from 'vs/platform/product/common/productService';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { GettingStartedInput, gettingStartedInputTypeId } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStartedInput';
import { welcomeButtonBackground, welcomeButtonHoverBackground, welcomePageBackground } from 'vs/workbench/contrib/welcome/page/browser/welcomePageColors';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationNode, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';


export const DEFAULT_STARTUP_EDITOR_CONFIG: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.startupEditor': {
			'scope': ConfigurationScope.RESOURCE,
			'type': 'string',
			'enum': ['none', 'welcomePage', 'readme', 'newUntitledFile', 'welcomePageInEmptyWorkbench', 'gettingStarted'],
			'enumDescriptions': [...[
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.none' }, "Start without an editor."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePage' }, "Open the Welcome page."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.readme' }, "Open the README when opening a folder that contains one, fallback to 'welcomePage' otherwise."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.newUntitledFile' }, "Open a new untitled file (only applies when opening an empty window)."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePageInEmptyWorkbench' }, "Open the Welcome page when opening an empty workbench."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.gettingStarted' }, "Open the Getting Started page.")]
			],
			'default': 'welcomePage',
			'description': localize('workbench.startupEditor', "Controls which editor is shown at startup, if none are restored from the previous session.")
		},
	}
};

export const EXPERIMENTAL_GETTING_STARTED_STARTUP_EDITOR_CONFIG: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	'properties': {
		'workbench.startupEditor': {
			'scope': ConfigurationScope.RESOURCE,
			'type': 'string',
			'enum': ['none', 'welcomePage', 'readme', 'newUntitledFile', 'welcomePageInEmptyWorkbench', 'gettingStarted'],
			'enumDescriptions': [...[
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.none' }, "Start without an editor."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePage' }, "Open the Welcome page."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.readme' }, "Open the README when opening a folder that contains one, fallback to 'welcomePage' otherwise."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.newUntitledFile' }, "Open a new untitled file (only applies when opening an empty window)."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.welcomePageInEmptyWorkbench' }, "Open the Welcome page when opening an empty workbench."),
				localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'workbench.startupEditor.gettingStarted' }, "Open the Getting Started page.")]
			],
			'default': 'gettingStarted',
			'description': localize('workbench.startupEditor', "Controls which editor is shown at startup, if none are restored from the previous session.")
		},
	}
};

const configurationKey = 'workbench.startupEditor';
const oldConfigurationKey = 'workbench.welcome.enabled';
const telemetryFrom = 'welcomePage';

export class WelcomePageContribution implements IWorkbenchContribution {
	private experimentManagementComplete: Promise<void>;
	private tasExperimentService: ITASExperimentService | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ICommandService private readonly commandService: ICommandService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService,
		@optional(ITASExperimentService) tasExperimentService: ITASExperimentService,
	) {
		this.tasExperimentService = tasExperimentService;

		// Run immediately to minimize time spent waiting for exp service.
		this.experimentManagementComplete = this.manageDefaultValuesForGettingStartedExperiment().catch(onUnexpectedError);
		this.run().then(undefined, onUnexpectedError);
	}

	private async manageDefaultValuesForGettingStartedExperiment() {
		const config = this.configurationService.inspect(configurationKey);

		if (this.lifecycleService.startupKind === StartupKind.ReloadedWindow || config.value !== config.defaultValue) {
			return;
		}

		if (this.configurationService.getValue('workbench.gettingStartedTreatmentOverride')) {
			await new Promise(resolve => setTimeout(resolve, 1000));
			Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).deregisterConfigurations([DEFAULT_STARTUP_EDITOR_CONFIG]);
			Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(EXPERIMENTAL_GETTING_STARTED_STARTUP_EDITOR_CONFIG);
		}

		let someValueReturned = false;
		type GettingStartedTreatmentData = { value: string; };
		type GettingStartedTreatmentClassification = { value: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' }; };

		const tasUseGettingStartedAsDefault = this.tasExperimentService?.getTreatment<boolean>('StartupGettingStarted')
			.then(result => {
				this.logService.trace('StartupGettingStarted:', result);
				this.telemetryService.publicLog2<GettingStartedTreatmentData, GettingStartedTreatmentClassification>('gettingStartedTreatmentValue', { value: '' + !!result });
				someValueReturned = true;
				return result;
			})
			.catch(error => {
				this.logService.error('Recieved error when consulting experiment service for getting started experiment', error);
				this.telemetryService.publicLog2<GettingStartedTreatmentData, GettingStartedTreatmentClassification>('gettingStartedTreatmentValue', { value: 'err' });
				someValueReturned = true;
				return false;
			});

		const fallback = new Promise<false>(c => setTimeout(() => c(false), 2000)).then(
			() => {
				if (!someValueReturned) { this.logService.trace('Unable to read getting started treatment data in time, falling back to welcome'); }
				someValueReturned = true;
			}
		);

		const useGettingStartedAsDefault = !!await Promise.race([tasUseGettingStartedAsDefault, fallback]);
		if (useGettingStartedAsDefault) {
			Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).deregisterConfigurations([DEFAULT_STARTUP_EDITOR_CONFIG]);
			Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration(EXPERIMENTAL_GETTING_STARTED_STARTUP_EDITOR_CONFIG);
		}
	}

	private async run() {
		const enabled = isWelcomePageEnabled(this.configurationService, this.contextService);
		if (enabled && this.lifecycleService.startupKind !== StartupKind.ReloadedWindow) {
			const hasBackups = await this.workingCopyBackupService.hasBackups();
			if (hasBackups) { return; }

			// Open the welcome even if we opened a set of default editors
			if (!this.editorService.activeEditor || this.layoutService.openedDefaultEditors) {
				const startupEditorSetting = this.configurationService.inspect<string>(configurationKey);

				// 'readme' should not be set in workspace settings to prevent tracking,
				// but it can be set as a default (as in codespaces) or a user setting
				const openWithReadme = startupEditorSetting.value === 'readme' &&
					(startupEditorSetting.userValue === 'readme' || startupEditorSetting.defaultValue === 'readme');

				if (openWithReadme) {
					await this.openReadme();
				} else {
					await this.openWelcome();
				}
			}
		}
	}

	private async openReadme() {
		const readmes = arrays.coalesce(
			await Promise.all(this.contextService.getWorkspace().folders.map(
				async folder => {
					const folderUri = folder.uri;
					const folderStat = await this.fileService.resolve(folderUri).catch(onUnexpectedError);
					const files = folderStat?.children ? folderStat.children.map(child => child.name).sort() : [];
					const file = files.find(file => file.toLowerCase() === 'readme.md') || files.find(file => file.toLowerCase().startsWith('readme'));
					if (file) { return joinPath(folderUri, file); }
					else { return undefined; }
				})));

		if (!this.editorService.activeEditor) {
			if (readmes.length) {
				const isMarkDown = (readme: URI) => readme.path.toLowerCase().endsWith('.md');
				await Promise.all([
					this.commandService.executeCommand('markdown.showPreview', null, readmes.filter(isMarkDown), { locked: true }),
					this.editorService.openEditors(readmes.filter(readme => !isMarkDown(readme)).map(readme => ({ resource: readme }))),
				]);
			} else {
				await this.openWelcome();
			}
		}
	}

	private async openWelcome() {
		await this.experimentManagementComplete;

		const startupEditorSetting = this.configurationService.getValue(configurationKey);
		const startupEditorTypeID = startupEditorSetting === 'gettingStarted' ? gettingStartedInputTypeId : welcomeInputTypeId;
		const editor = this.editorService.activeEditor;

		// Ensure that the welcome editor won't get opened more than once
		if (editor?.typeId === startupEditorTypeID || this.editorService.editors.some(e => e.typeId === startupEditorTypeID)) {
			return;
		}
		const options: IEditorOptions = editor ? { pinned: false, index: 0 } : { pinned: false };
		if (startupEditorTypeID === gettingStartedInputTypeId) {
			this.editorService.openEditor(this.instantiationService.createInstance(GettingStartedInput, {}), options);
		} else {
			this.instantiationService.createInstance(WelcomePage).openEditor(options);
		}
	}
}

function isWelcomePageEnabled(configurationService: IConfigurationService, contextService: IWorkspaceContextService) {
	const startupEditor = configurationService.inspect<string>(configurationKey);
	if (!startupEditor.userValue && !startupEditor.workspaceValue) {
		const welcomeEnabled = configurationService.inspect(oldConfigurationKey);
		if (welcomeEnabled.value !== undefined && welcomeEnabled.value !== null) {
			return welcomeEnabled.value;
		}
	}
	if (startupEditor.value === 'readme' && startupEditor.userValue !== 'readme') {
		console.error('Warning: `workbench.startupEditor: readme` setting ignored due to being set somewhere other than user settings');
	}
	return startupEditor.value === 'welcomePage' || startupEditor.value === 'gettingStarted' || startupEditor.userValue === 'readme' || startupEditor.value === 'welcomePageInEmptyWorkbench' && contextService.getWorkbenchState() === WorkbenchState.EMPTY;
}

export class WelcomePageAction extends Action {

	public static readonly ID = 'workbench.action.showWelcomePage';
	public static readonly LABEL = localize('welcomePage', "Welcome");

	constructor(
		id: string,
		label: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(id, label);
	}

	public override run(): Promise<void> {
		return this.instantiationService.createInstance(WelcomePage)
			.openEditor()
			.then(() => undefined);
	}
}

interface ExtensionSuggestion {
	name: string;
	title?: string;
	id: string;
	isKeymap?: boolean;
	isCommand?: boolean;
}

const extensionPacks: ExtensionSuggestion[] = [
	{ name: localize('welcomePage.javaScript', "JavaScript"), id: 'dbaeumer.vscode-eslint' },
	{ name: localize('welcomePage.python', "Python"), id: 'ms-python.python' },
	{ name: localize('welcomePage.java', "Java"), id: 'vscjava.vscode-java-pack' },
	{ name: localize('welcomePage.php', "PHP"), id: 'felixfbecker.php-pack' },
	{ name: localize('welcomePage.azure', "Azure"), title: localize('welcomePage.showAzureExtensions', "Show Azure extensions"), id: 'workbench.extensions.action.showAzureExtensions', isCommand: true },
	{ name: localize('welcomePage.docker', "Docker"), id: 'ms-azuretools.vscode-docker' },
];

const keymapExtensions: ExtensionSuggestion[] = [
	{ name: localize('welcomePage.vim', "Vim"), id: 'vscodevim.vim', isKeymap: true },
	{ name: localize('welcomePage.sublime', "Sublime"), id: 'ms-vscode.sublime-keybindings', isKeymap: true },
	{ name: localize('welcomePage.atom', "Atom"), id: 'ms-vscode.atom-keybindings', isKeymap: true },
];

interface Strings {
	installEvent: string;
	installedEvent: string;
	detailsEvent: string;

	alreadyInstalled: string;
	reloadAfterInstall: string;
	installing: string;
	extensionNotFound: string;
}

/* __GDPR__
	"installExtension" : {
		"${include}": [
			"${WelcomePageInstall-1}"
		]
	}
*/
/* __GDPR__
	"installedExtension" : {
		"${include}": [
			"${WelcomePageInstalled-1}",
			"${WelcomePageInstalled-2}",
			"${WelcomePageInstalled-3}",
			"${WelcomePageInstalled-4}",
			"${WelcomePageInstalled-6}"
		]
	}
*/
/* __GDPR__
	"detailsExtension" : {
		"${include}": [
			"${WelcomePageDetails-1}"
		]
	}
*/
const extensionPackStrings: Strings = {
	installEvent: 'installExtension',
	installedEvent: 'installedExtension',
	detailsEvent: 'detailsExtension',

	alreadyInstalled: localize('welcomePage.extensionPackAlreadyInstalled', "Support for {0} is already installed."),
	reloadAfterInstall: localize('welcomePage.willReloadAfterInstallingExtensionPack', "The window will reload after installing additional support for {0}."),
	installing: localize('welcomePage.installingExtensionPack', "Installing additional support for {0}..."),
	extensionNotFound: localize('welcomePage.extensionPackNotFound', "Support for {0} with id {1} could not be found."),
};

CommandsRegistry.registerCommand('workbench.extensions.action.showAzureExtensions', accessor => {
	const viewletService = accessor.get(IViewletService);
	return viewletService.openViewlet(VIEWLET_ID, true)
		.then(viewlet => viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer)
		.then(viewlet => {
			viewlet.search('@sort:installs azure ');
			viewlet.focus();
		});
});

/* __GDPR__
	"installKeymap" : {
		"${include}": [
			"${WelcomePageInstall-1}"
		]
	}
*/
/* __GDPR__
	"installedKeymap" : {
		"${include}": [
			"${WelcomePageInstalled-1}",
			"${WelcomePageInstalled-2}",
			"${WelcomePageInstalled-3}",
			"${WelcomePageInstalled-4}",
			"${WelcomePageInstalled-6}"
		]
	}
*/
/* __GDPR__
	"detailsKeymap" : {
		"${include}": [
			"${WelcomePageDetails-1}"
		]
	}
*/
const keymapStrings: Strings = {
	installEvent: 'installKeymap',
	installedEvent: 'installedKeymap',
	detailsEvent: 'detailsKeymap',

	alreadyInstalled: localize('welcomePage.keymapAlreadyInstalled', "The {0} keyboard shortcuts are already installed."),
	reloadAfterInstall: localize('welcomePage.willReloadAfterInstallingKeymap', "The window will reload after installing the {0} keyboard shortcuts."),
	installing: localize('welcomePage.installingKeymap', "Installing the {0} keyboard shortcuts..."),
	extensionNotFound: localize('welcomePage.keymapNotFound', "The {0} keyboard shortcuts with id {1} could not be found."),
};

const welcomeInputTypeId = 'workbench.editors.welcomePageInput';

class WelcomePage extends Disposable {

	readonly editorInput: WalkThroughInput;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILabelService private readonly labelService: ILabelService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionRecommendationsService private readonly tipsService: IExtensionRecommendationsService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IHostService private readonly hostService: IHostService,
		@IProductService private readonly productService: IProductService,

	) {
		super();
		this._register(lifecycleService.onDidShutdown(() => this.dispose()));

		const recentlyOpened = this.workspacesService.getRecentlyOpened();
		const installedExtensions = this.instantiationService.invokeFunction(getInstalledExtensions);
		const resource = FileAccess.asBrowserUri('./vs_code_welcome_page', require)
			.with({
				scheme: Schemas.walkThrough,
				query: JSON.stringify({ moduleId: 'vs/workbench/contrib/welcome/page/browser/vs_code_welcome_page' })
			});
		this.editorInput = this.instantiationService.createInstance(WalkThroughInput, {
			typeId: welcomeInputTypeId,
			name: localize('welcome.title', "Welcome"),
			resource,
			telemetryFrom,
			onReady: (container: HTMLElement) => this.onReady(container, recentlyOpened, installedExtensions)
		});
	}

	public openEditor(options: IEditorOptions = { pinned: false }) {
		return this.editorService.openEditor(this.editorInput, options);
	}

	private onReady(container: HTMLElement, recentlyOpened: Promise<IRecentlyOpened>, installedExtensions: Promise<IExtensionStatus[]>): void {
		const enabled = this.configurationService.getValue(configurationKey) === 'welcomePage';
		const showOnStartup = <HTMLInputElement>container.querySelector('#showOnStartup');
		if (enabled) {
			showOnStartup.setAttribute('checked', 'checked');
		}
		showOnStartup.addEventListener('click', e => {
			this.configurationService.updateValue(configurationKey, showOnStartup.checked ? 'welcomePage' : 'newUntitledFile');
		});

		const prodName = container.querySelector('.welcomePage .title .caption') as HTMLElement;
		if (prodName) {
			prodName.textContent = this.productService.nameLong;
		}

		recentlyOpened.then(({ workspaces }) => {
			// Filter out the current workspace
			workspaces = workspaces.filter(recent => !this.contextService.isCurrentWorkspace(isRecentWorkspace(recent) ? recent.workspace : recent.folderUri));
			if (!workspaces.length) {
				const recent = container.querySelector('.welcomePage') as HTMLElement;
				recent.classList.add('emptyRecent');
				return;
			}
			const ul = container.querySelector('.recent ul');
			if (!ul) {
				return;
			}
			const moreRecent = ul.querySelector('.moreRecent')!;
			const workspacesToShow = workspaces.slice(0, 5);
			const updateEntries = () => {
				const listEntries = this.createListEntries(workspacesToShow);
				while (ul.firstChild) {
					ul.removeChild(ul.firstChild);
				}
				ul.append(...listEntries, moreRecent);
			};
			updateEntries();
			this._register(this.labelService.onDidChangeFormatters(updateEntries));
		}).then(undefined, onUnexpectedError);

		this.addExtensionList(container, '.extensionPackList', extensionPacks, extensionPackStrings);
		this.addExtensionList(container, '.keymapList', keymapExtensions, keymapStrings);

		this.updateInstalledExtensions(container, installedExtensions);
		this._register(this.instantiationService.invokeFunction(onExtensionChanged)(ids => {
			for (const id of ids) {
				if (container.querySelector(`.installExtension[data-extension="${id.id}"], .enabledExtension[data-extension="${id.id}"]`)) {
					const installedExtensions = this.instantiationService.invokeFunction(getInstalledExtensions);
					this.updateInstalledExtensions(container, installedExtensions);
					break;
				}
			}
		}));
	}

	private createListEntries(recents: (IRecentWorkspace | IRecentFolder)[]) {
		return recents.map(recent => {
			let fullPath: string;
			let windowOpenable: IWindowOpenable;
			if (isRecentFolder(recent)) {
				windowOpenable = { folderUri: recent.folderUri };
				fullPath = recent.label || this.labelService.getWorkspaceLabel(recent.folderUri, { verbose: true });
			} else {
				fullPath = recent.label || this.labelService.getWorkspaceLabel(recent.workspace, { verbose: true });
				windowOpenable = { workspaceUri: recent.workspace.configPath };
			}

			const { name, parentPath } = splitName(fullPath);

			const li = document.createElement('li');
			const a = document.createElement('a');

			a.innerText = name;
			a.title = fullPath;
			a.setAttribute('aria-label', localize('welcomePage.openFolderWithPath', "Open folder {0} with path {1}", name, parentPath));
			a.href = 'javascript:void(0)';
			a.addEventListener('click', e => {
				this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', {
					id: 'openRecentFolder',
					from: telemetryFrom
				});
				this.hostService.openWindow([windowOpenable], { forceNewWindow: e.ctrlKey || e.metaKey, remoteAuthority: recent.remoteAuthority });
				e.preventDefault();
				e.stopPropagation();
			});
			li.appendChild(a);

			const span = document.createElement('span');
			span.classList.add('path');
			span.classList.add('detail');
			span.innerText = parentPath;
			span.title = fullPath;
			li.appendChild(span);

			return li;
		});
	}

	private addExtensionList(container: HTMLElement, listSelector: string, suggestions: ExtensionSuggestion[], strings: Strings) {
		const list = container.querySelector(listSelector);
		if (list) {
			suggestions.forEach((extension, i) => {
				if (i) {
					list.appendChild(document.createTextNode(localize('welcomePage.extensionListSeparator', ", ")));
				}

				const a = document.createElement('a');
				a.innerText = extension.name;
				a.title = extension.title || (extension.isKeymap ? localize('welcomePage.installKeymap', "Install {0} keymap", extension.name) : localize('welcomePage.installExtensionPack', "Install additional support for {0}", extension.name));
				if (extension.isCommand) {
					a.href = `command:${extension.id}`;
					list.appendChild(a);
				} else {
					a.classList.add('installExtension');
					a.setAttribute('data-extension', extension.id);
					a.href = 'javascript:void(0)';
					a.addEventListener('click', e => {
						this.installExtension(extension, strings);
						e.preventDefault();
						e.stopPropagation();
					});
					list.appendChild(a);

					const span = document.createElement('span');
					span.innerText = extension.name;
					span.title = extension.isKeymap ? localize('welcomePage.installedKeymap', "{0} keymap is already installed", extension.name) : localize('welcomePage.installedExtensionPack', "{0} support is already installed", extension.name);
					span.classList.add('enabledExtension');
					span.setAttribute('data-extension', extension.id);
					list.appendChild(span);
				}
			});
		}
	}

	private installExtension(extensionSuggestion: ExtensionSuggestion, strings: Strings): void {
		/* __GDPR__FRAGMENT__
			"WelcomePageInstall-1" : {
				"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLog(strings.installEvent, {
			from: telemetryFrom,
			extensionId: extensionSuggestion.id,
		});
		this.instantiationService.invokeFunction(getInstalledExtensions).then(extensions => {
			const installedExtension = extensions.find(extension => areSameExtensions(extension.identifier, { id: extensionSuggestion.id }));
			if (installedExtension && installedExtension.globallyEnabled) {
				/* __GDPR__FRAGMENT__
					"WelcomePageInstalled-1" : {
						"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
						"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
						"outcome": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
					}
				*/
				this.telemetryService.publicLog(strings.installedEvent, {
					from: telemetryFrom,
					extensionId: extensionSuggestion.id,
					outcome: 'already_enabled',
				});
				this.notificationService.info(strings.alreadyInstalled.replace('{0}', extensionSuggestion.name));
				return;
			}
			const foundAndInstalled = installedExtension ? Promise.resolve(installedExtension.local) : this.extensionGalleryService.query({ names: [extensionSuggestion.id], source: telemetryFrom }, CancellationToken.None)
				.then((result): null | Promise<ILocalExtension | null> => {
					const [extension] = result.firstPage;
					if (!extension) {
						return null;
					}
					return this.extensionManagementService.installFromGallery(extension)
						.then(() => this.extensionManagementService.getInstalled())
						.then(installed => {
							const local = installed.filter(i => areSameExtensions(extension.identifier, i.identifier))[0];
							// TODO: Do this as part of the install to avoid multiple events.
							return this.extensionEnablementService.setEnablement([local], EnablementState.DisabledGlobally).then(() => local);
						});
				});

			this.notificationService.prompt(
				Severity.Info,
				strings.reloadAfterInstall.replace('{0}', extensionSuggestion.name),
				[{
					label: localize('ok', "OK"),
					run: () => {
						const messageDelay = new TimeoutTimer();
						messageDelay.cancelAndSet(() => {
							this.notificationService.info(strings.installing.replace('{0}', extensionSuggestion.name));
						}, 300);
						const extensionsToDisable = extensions.filter(extension => isKeymapExtension(this.tipsService, extension) && extension.globallyEnabled).map(extension => extension.local);
						extensionsToDisable.length ? this.extensionEnablementService.setEnablement(extensionsToDisable, EnablementState.DisabledGlobally) : Promise.resolve()
							.then(() => {
								return foundAndInstalled.then(foundExtension => {
									messageDelay.cancel();
									if (foundExtension) {
										return this.extensionEnablementService.setEnablement([foundExtension], EnablementState.EnabledGlobally)
											.then(() => {
												/* __GDPR__FRAGMENT__
													"WelcomePageInstalled-2" : {
														"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
														"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
														"outcome": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
													}
												*/
												this.telemetryService.publicLog(strings.installedEvent, {
													from: telemetryFrom,
													extensionId: extensionSuggestion.id,
													outcome: installedExtension ? 'enabled' : 'installed',
												});
												return this.hostService.reload();
											});
									} else {
										/* __GDPR__FRAGMENT__
											"WelcomePageInstalled-3" : {
												"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
												"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
												"outcome": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
											}
										*/
										this.telemetryService.publicLog(strings.installedEvent, {
											from: telemetryFrom,
											extensionId: extensionSuggestion.id,
											outcome: 'not_found',
										});
										this.notificationService.error(strings.extensionNotFound.replace('{0}', extensionSuggestion.name).replace('{1}', extensionSuggestion.id));
										return undefined;
									}
								});
							}).then(undefined, err => {
								/* __GDPR__FRAGMENT__
									"WelcomePageInstalled-4" : {
										"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
										"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
										"outcome": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
									}
								*/
								this.telemetryService.publicLog(strings.installedEvent, {
									from: telemetryFrom,
									extensionId: extensionSuggestion.id,
									outcome: isPromiseCanceledError(err) ? 'canceled' : 'error',
								});
								this.notificationService.error(err);
							});
					}
				}, {
					label: localize('details', "Details"),
					run: () => {
						/* __GDPR__FRAGMENT__
							"WelcomePageDetails-1" : {
								"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
								"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
							}
						*/
						this.telemetryService.publicLog(strings.detailsEvent, {
							from: telemetryFrom,
							extensionId: extensionSuggestion.id,
						});
						this.extensionsWorkbenchService.queryGallery({ names: [extensionSuggestion.id] }, CancellationToken.None)
							.then(result => this.extensionsWorkbenchService.open(result.firstPage[0]))
							.then(undefined, onUnexpectedError);
					}
				}]
			);
		}).then(undefined, err => {
			/* __GDPR__FRAGMENT__
				"WelcomePageInstalled-6" : {
					"from" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"extensionId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"outcome": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog(strings.installedEvent, {
				from: telemetryFrom,
				extensionId: extensionSuggestion.id,
				outcome: isPromiseCanceledError(err) ? 'canceled' : 'error',
			});
			this.notificationService.error(err);
		});
	}

	private updateInstalledExtensions(container: HTMLElement, installedExtensions: Promise<IExtensionStatus[]>) {
		installedExtensions.then(extensions => {
			const elements = container.querySelectorAll('.installExtension, .enabledExtension');
			for (let i = 0; i < elements.length; i++) {
				elements[i].classList.remove('installed');
			}
			extensions.filter(ext => ext.globallyEnabled)
				.map(ext => ext.identifier.id)
				.forEach(id => {
					const install = container.querySelectorAll(`.installExtension[data-extension="${id}"]`);
					for (let i = 0; i < install.length; i++) {
						install[i].classList.add('installed');
					}
					const enabled = container.querySelectorAll(`.enabledExtension[data-extension="${id}"]`);
					for (let i = 0; i < enabled.length; i++) {
						enabled[i].classList.add('installed');
					}
				});
		}).then(undefined, onUnexpectedError);
	}
}

export class WelcomeInputSerializer implements IEditorInputSerializer {

	static readonly ID = welcomeInputTypeId;

	public canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	public serialize(editorInput: EditorInput): string {
		return '{}';
	}

	public deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): WalkThroughInput {
		return instantiationService.createInstance(WelcomePage)
			.editorInput;
	}
}

// theming

registerThemingParticipant((theme, collector) => {
	const backgroundColor = theme.getColor(welcomePageBackground);
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePageContainer { background-color: ${backgroundColor}; }`);
	}
	const foregroundColor = theme.getColor(foreground);
	if (foregroundColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage .caption { color: ${foregroundColor}; }`);
	}
	const descriptionColor = theme.getColor(descriptionForeground);
	if (descriptionColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage .detail { color: ${descriptionColor}; }`);
	}
	const buttonColor = getExtraColor(theme, welcomeButtonBackground, { dark: 'rgba(0, 0, 0, .2)', extra_dark: 'rgba(200, 235, 255, .042)', light: 'rgba(0,0,0,.04)', hc: 'black' });
	if (buttonColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage .commands .item button { background: ${buttonColor}; }`);
	}
	const buttonHoverColor = getExtraColor(theme, welcomeButtonHoverBackground, { dark: 'rgba(200, 235, 255, .072)', extra_dark: 'rgba(200, 235, 255, .072)', light: 'rgba(0,0,0,.10)', hc: null });
	if (buttonHoverColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage .commands .item button:hover { background: ${buttonHoverColor}; }`);
	}
	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage a { color: ${link}; }`);
	}
	const activeLink = theme.getColor(textLinkActiveForeground);
	if (activeLink) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage a:hover,
			.monaco-workbench .part.editor > .content .welcomePage a:active { color: ${activeLink}; }`);
	}
	const focusColor = theme.getColor(focusBorder);
	if (focusColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage a:focus { outline-color: ${focusColor}; }`);
	}
	const border = theme.getColor(contrastBorder);
	if (border) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage .commands .item button { border-color: ${border}; }`);
	}
	const activeBorder = theme.getColor(activeContrastBorder);
	if (activeBorder) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePage .commands .item button:hover { outline-color: ${activeBorder}; }`);
	}
});
