/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/remoteViewlet';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { URI } from 'vs/base/common/uri';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { FilterViewPaneContainer } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { AutomaticPortForwarding, ForwardedPortsView, PortRestore, VIEWLET_ID } from 'vs/workbench/contrib/remote/browser/remoteExplorer';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IViewDescriptor, IViewsRegistry, Extensions, ViewContainerLocation, IViewContainersRegistry, IViewDescriptorService } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { IProgress, IProgressStep, IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ReconnectionWaitEvent, PersistentConnectionEventType } from 'vs/platform/remote/common/remoteAgentConnection';
import Severity from 'vs/base/common/severity';
import { ReloadWindowAction } from 'vs/workbench/browser/actions/windowActions';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { SwitchRemoteViewItem, SwitchRemoteAction } from 'vs/workbench/contrib/remote/browser/explorerViewItems';
import { Action } from 'vs/base/common/actions';
import { isStringArray } from 'vs/base/common/types';
import { IRemoteExplorerService } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeRenderer, ITreeNode, IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Event } from 'vs/base/common/event';
import { ExtensionsRegistry, IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { RemoteStatusIndicator } from 'vs/workbench/contrib/remote/browser/remoteIndicator';
import * as icons from 'vs/workbench/contrib/remote/browser/remoteIcons';
import { ILogService } from 'vs/platform/log/common/log';
import { ITimerService } from 'vs/workbench/services/timer/browser/timerService';
import { getRemoteName } from 'vs/platform/remote/common/remoteHosts';
import { IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';


export interface HelpInformation {
	extensionDescription: IExtensionDescription;
	getStarted?: string;
	documentation?: string;
	feedback?: string;
	issues?: string;
	remoteName?: string[] | string;
}

const remoteHelpExtPoint = ExtensionsRegistry.registerExtensionPoint<HelpInformation>({
	extensionPoint: 'remoteHelp',
	jsonSchema: {
		description: nls.localize('RemoteHelpInformationExtPoint', 'Contributes help information for Remote'),
		type: 'object',
		properties: {
			'getStarted': {
				description: nls.localize('RemoteHelpInformationExtPoint.getStarted', "The url, or a command that returns the url, to your project's Getting Started page"),
				type: 'string'
			},
			'documentation': {
				description: nls.localize('RemoteHelpInformationExtPoint.documentation', "The url, or a command that returns the url, to your project's documentation page"),
				type: 'string'
			},
			'feedback': {
				description: nls.localize('RemoteHelpInformationExtPoint.feedback', "The url, or a command that returns the url, to your project's feedback reporter"),
				type: 'string'
			},
			'issues': {
				description: nls.localize('RemoteHelpInformationExtPoint.issues', "The url, or a command that returns the url, to your project's issues list"),
				type: 'string'
			}
		}
	}
});

interface IViewModel {
	helpInformation: HelpInformation[];
}

class HelpTreeVirtualDelegate implements IListVirtualDelegate<IHelpItem> {
	getHeight(element: IHelpItem): number {
		return 22;
	}

	getTemplateId(element: IHelpItem): string {
		return 'HelpItemTemplate';
	}
}

interface IHelpItemTemplateData {
	parent: HTMLElement;
	icon: HTMLElement;
}

class HelpTreeRenderer implements ITreeRenderer<HelpModel | IHelpItem, IHelpItem, IHelpItemTemplateData> {
	templateId: string = 'HelpItemTemplate';

	renderTemplate(container: HTMLElement): IHelpItemTemplateData {
		container.classList.add('remote-help-tree-node-item');
		const icon = dom.append(container, dom.$('.remote-help-tree-node-item-icon'));
		const data = <IHelpItemTemplateData>Object.create(null);
		data.parent = container;
		data.icon = icon;
		return data;
	}

	renderElement(element: ITreeNode<IHelpItem, IHelpItem>, index: number, templateData: IHelpItemTemplateData, height: number | undefined): void {
		const container = templateData.parent;
		dom.append(container, templateData.icon);
		templateData.icon.classList.add(...element.element.iconClasses);
		const labelContainer = dom.append(container, dom.$('.help-item-label'));
		labelContainer.innerText = element.element.label;
	}

	disposeTemplate(templateData: IHelpItemTemplateData): void {

	}
}

class HelpDataSource implements IAsyncDataSource<HelpModel, IHelpItem> {
	hasChildren(element: HelpModel) {
		return element instanceof HelpModel;
	}

	getChildren(element: HelpModel) {
		if (element instanceof HelpModel && element.items) {
			return element.items;
		}

		return [];
	}
}
interface IHelpItem {
	icon: ThemeIcon,
	iconClasses: string[];
	label: string;
	handleClick(): Promise<void>;
}

class HelpModel {
	items: IHelpItem[] | undefined;

	constructor(
		viewModel: IViewModel,
		openerService: IOpenerService,
		quickInputService: IQuickInputService,
		commandService: ICommandService,
		remoteExplorerService: IRemoteExplorerService,
		environmentService: IWorkbenchEnvironmentService
	) {
		let helpItems: IHelpItem[] = [];
		const getStarted = viewModel.helpInformation.filter(info => info.getStarted);

		if (getStarted.length) {
			helpItems.push(new HelpItem(
				icons.getStartedIcon,
				nls.localize('remote.help.getStarted', "Get Started"),
				getStarted.map((info: HelpInformation) => (new HelpItemValue(commandService,
					info.extensionDescription,
					(typeof info.remoteName === 'string') ? [info.remoteName] : info.remoteName,
					info.getStarted!)
				)),
				quickInputService,
				environmentService,
				openerService,
				remoteExplorerService
			));
		}

		const documentation = viewModel.helpInformation.filter(info => info.documentation);

		if (documentation.length) {
			helpItems.push(new HelpItem(
				icons.documentationIcon,
				nls.localize('remote.help.documentation', "Read Documentation"),
				documentation.map((info: HelpInformation) => (new HelpItemValue(commandService,
					info.extensionDescription,
					(typeof info.remoteName === 'string') ? [info.remoteName] : info.remoteName,
					info.documentation!)
				)),
				quickInputService,
				environmentService,
				openerService,
				remoteExplorerService
			));
		}

		const feedback = viewModel.helpInformation.filter(info => info.feedback);

		if (feedback.length) {
			helpItems.push(new HelpItem(
				icons.feedbackIcon,
				nls.localize('remote.help.feedback', "Provide Feedback"),
				feedback.map((info: HelpInformation) => (new HelpItemValue(commandService,
					info.extensionDescription,
					(typeof info.remoteName === 'string') ? [info.remoteName] : info.remoteName,
					info.feedback!)
				)),
				quickInputService,
				environmentService,
				openerService,
				remoteExplorerService
			));
		}

		const issues = viewModel.helpInformation.filter(info => info.issues);

		if (issues.length) {
			helpItems.push(new HelpItem(
				icons.reviewIssuesIcon,
				nls.localize('remote.help.issues', "Review Issues"),
				issues.map((info: HelpInformation) => (new HelpItemValue(commandService,
					info.extensionDescription,
					(typeof info.remoteName === 'string') ? [info.remoteName] : info.remoteName,
					info.issues!)
				)),
				quickInputService,
				environmentService,
				openerService,
				remoteExplorerService
			));
		}

		if (helpItems.length) {
			helpItems.push(new IssueReporterItem(
				icons.reportIssuesIcon,
				nls.localize('remote.help.report', "Report Issue"),
				viewModel.helpInformation.map(info => (new HelpItemValue(commandService,
					info.extensionDescription,
					(typeof info.remoteName === 'string') ? [info.remoteName] : info.remoteName
				))),
				quickInputService,
				environmentService,
				commandService,
				remoteExplorerService
			));
		}

		if (helpItems.length) {
			this.items = helpItems;
		}
	}
}

class HelpItemValue {
	private _url: string | undefined;
	constructor(private commandService: ICommandService, public extensionDescription: IExtensionDescription, public remoteAuthority: string[] | undefined, private urlOrCommand?: string) { }

	get url(): Promise<string> {
		return new Promise<string>(async (resolve) => {
			if (this._url === undefined) {
				if (this.urlOrCommand) {
					let url = URI.parse(this.urlOrCommand);
					if (url.authority) {
						this._url = this.urlOrCommand;
					} else {
						const urlCommand: Promise<string | undefined> = this.commandService.executeCommand(this.urlOrCommand);
						// We must be defensive. The command may never return, meaning that no help at all is ever shown!
						const emptyString: Promise<string> = new Promise(resolve => setTimeout(() => resolve(''), 500));
						this._url = await Promise.race([urlCommand, emptyString]);
					}
				}
			}
			if (this._url === undefined) {
				this._url = '';
			}
			resolve(this._url);
		});
	}
}

abstract class HelpItemBase implements IHelpItem {
	public iconClasses: string[] = [];
	constructor(
		public icon: ThemeIcon,
		public label: string,
		public values: HelpItemValue[],
		private quickInputService: IQuickInputService,
		private environmentService: IWorkbenchEnvironmentService,
		private remoteExplorerService: IRemoteExplorerService
	) {
		this.iconClasses.push(...ThemeIcon.asClassNameArray(icon));
		this.iconClasses.push('remote-help-tree-node-item-icon');
	}

	async handleClick() {
		const remoteAuthority = this.environmentService.remoteAuthority;
		if (remoteAuthority) {
			for (let i = 0; i < this.remoteExplorerService.targetType.length; i++) {
				if (remoteAuthority.startsWith(this.remoteExplorerService.targetType[i])) {
					for (let value of this.values) {
						if (value.remoteAuthority) {
							for (let authority of value.remoteAuthority) {
								if (remoteAuthority.startsWith(authority)) {
									await this.takeAction(value.extensionDescription, await value.url);
									return;
								}
							}
						}
					}
				}
			}
		}

		if (this.values.length > 1) {
			let actions = (await Promise.all(this.values.map(async (value) => {
				return {
					label: value.extensionDescription.displayName || value.extensionDescription.identifier.value,
					description: await value.url,
					extensionDescription: value.extensionDescription
				};
			}))).filter(item => item.description);

			const action = await this.quickInputService.pick(actions, { placeHolder: nls.localize('pickRemoteExtension', "Select url to open") });

			if (action) {
				await this.takeAction(action.extensionDescription, action.description);
			}
		} else {
			await this.takeAction(this.values[0].extensionDescription, await this.values[0].url);
		}
	}

	protected abstract takeAction(extensionDescription: IExtensionDescription, url?: string): Promise<void>;
}

class HelpItem extends HelpItemBase {
	constructor(
		icon: ThemeIcon,
		label: string,
		values: HelpItemValue[],
		quickInputService: IQuickInputService,
		environmentService: IWorkbenchEnvironmentService,
		private openerService: IOpenerService,
		remoteExplorerService: IRemoteExplorerService
	) {
		super(icon, label, values, quickInputService, environmentService, remoteExplorerService);
	}

	protected async takeAction(extensionDescription: IExtensionDescription, url: string): Promise<void> {
		await this.openerService.open(URI.parse(url), { allowCommands: true });
	}
}

class IssueReporterItem extends HelpItemBase {
	constructor(
		icon: ThemeIcon,
		label: string,
		values: HelpItemValue[],
		quickInputService: IQuickInputService,
		environmentService: IWorkbenchEnvironmentService,
		private commandService: ICommandService,
		remoteExplorerService: IRemoteExplorerService
	) {
		super(icon, label, values, quickInputService, environmentService, remoteExplorerService);
	}

	protected async takeAction(extensionDescription: IExtensionDescription): Promise<void> {
		await this.commandService.executeCommand('workbench.action.openIssueReporter', [extensionDescription.identifier.value]);
	}
}

class HelpPanel extends ViewPane {
	static readonly ID = '~remote.helpPanel';
	static readonly TITLE = nls.localize('remote.help', "Help and feedback");
	private tree!: WorkbenchAsyncDataTree<HelpModel, IHelpItem, IHelpItem>;

	constructor(
		protected viewModel: IViewModel,
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IOpenerService openerService: IOpenerService,
		@IQuickInputService protected quickInputService: IQuickInputService,
		@ICommandService protected commandService: ICommandService,
		@IRemoteExplorerService protected readonly remoteExplorerService: IRemoteExplorerService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('remote-help');
		const treeContainer = document.createElement('div');
		treeContainer.classList.add('remote-help-content');
		container.appendChild(treeContainer);

		this.tree = <WorkbenchAsyncDataTree<HelpModel, IHelpItem, IHelpItem>>this.instantiationService.createInstance(WorkbenchAsyncDataTree,
			'RemoteHelp',
			treeContainer,
			new HelpTreeVirtualDelegate(),
			[new HelpTreeRenderer()],
			new HelpDataSource(),
			{
				accessibilityProvider: {
					getAriaLabel: (item: HelpItemBase) => {
						return item.label;
					},
					getWidgetAriaLabel: () => nls.localize('remotehelp', "Remote Help")
				}
			}
		);

		const model = new HelpModel(this.viewModel, this.openerService, this.quickInputService, this.commandService, this.remoteExplorerService, this.environmentService);

		this.tree.setInput(model);

		this._register(Event.debounce(this.tree.onDidOpen, (last, event) => event, 75, true)(e => {
			e.element?.handleClick();
		}));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}
}

class HelpPanelDescriptor implements IViewDescriptor {
	readonly id = HelpPanel.ID;
	readonly name = HelpPanel.TITLE;
	readonly ctorDescriptor: SyncDescriptor<HelpPanel>;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly group = 'help@50';
	readonly order = -10;

	constructor(viewModel: IViewModel) {
		this.ctorDescriptor = new SyncDescriptor(HelpPanel, [viewModel]);
	}
}

export class RemoteViewPaneContainer extends FilterViewPaneContainer implements IViewModel {
	private helpPanelDescriptor = new HelpPanelDescriptor(this);
	helpInformation: HelpInformation[] = [];
	private hasSetSwitchForConnection: boolean = false;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IRemoteExplorerService readonly remoteExplorerService: IRemoteExplorerService,
		@IWorkbenchEnvironmentService readonly environmentService: IWorkbenchEnvironmentService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		super(VIEWLET_ID, remoteExplorerService.onDidChangeTargetType, configurationService, layoutService, telemetryService, storageService, instantiationService, themeService, contextMenuService, extensionService, contextService, viewDescriptorService);
		this.addConstantViewDescriptors([this.helpPanelDescriptor]);
		remoteHelpExtPoint.setHandler((extensions) => {
			let helpInformation: HelpInformation[] = [];
			for (let extension of extensions) {
				this._handleRemoteInfoExtensionPoint(extension, helpInformation);
			}

			this.helpInformation = helpInformation;

			const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
			if (this.helpInformation.length) {
				viewsRegistry.registerViews([this.helpPanelDescriptor], this.viewContainer);
			} else {
				viewsRegistry.deregisterViews([this.helpPanelDescriptor], this.viewContainer);
			}
		});
	}

	private _handleRemoteInfoExtensionPoint(extension: IExtensionPointUser<HelpInformation>, helpInformation: HelpInformation[]) {
		if (!extension.description.enableProposedApi) {
			return;
		}

		if (!extension.value.documentation && !extension.value.feedback && !extension.value.getStarted && !extension.value.issues) {
			return;
		}

		helpInformation.push({
			extensionDescription: extension.description,
			getStarted: extension.value.getStarted,
			documentation: extension.value.documentation,
			feedback: extension.value.feedback,
			issues: extension.value.issues,
			remoteName: extension.value.remoteName
		});
	}

	protected getFilterOn(viewDescriptor: IViewDescriptor): string | undefined {
		return isStringArray(viewDescriptor.remoteAuthority) ? viewDescriptor.remoteAuthority[0] : viewDescriptor.remoteAuthority;
	}

	protected setFilter(viewDescriptor: IViewDescriptor): void {
		this.remoteExplorerService.targetType = isStringArray(viewDescriptor.remoteAuthority) ? viewDescriptor.remoteAuthority : [viewDescriptor.remoteAuthority!];
	}

	public override getActionViewItem(action: Action): IActionViewItem | undefined {
		if (action.id === SwitchRemoteAction.ID) {
			const optionItems = SwitchRemoteViewItem.createOptionItems(Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).getViews(this.viewContainer), this.contextKeyService);
			const item = this.instantiationService.createInstance(SwitchRemoteViewItem, action, optionItems);
			if (!this.hasSetSwitchForConnection) {
				this.hasSetSwitchForConnection = item.setSelectionForConnection();
			} else {
				item.setSelection();
			}
			return item;
		}

		return super.getActionViewItem(action);
	}

	getTitle(): string {
		const title = nls.localize('remote.explorer', "Remote Explorer");
		return title;
	}
}

registerAction2(SwitchRemoteAction);

Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
	{
		id: VIEWLET_ID,
		title: nls.localize('remote.explorer', "Remote Explorer"),
		ctorDescriptor: new SyncDescriptor(RemoteViewPaneContainer),
		hideIfEmpty: true,
		viewOrderDelegate: {
			getOrder: (group?: string) => {
				if (!group) {
					return;
				}

				let matches = /^targets@(\d+)$/.exec(group);
				if (matches) {
					return -1000;
				}

				matches = /^details(@(\d+))?$/.exec(group);

				if (matches) {
					return -500 + Number(matches[2]);
				}

				matches = /^help(@(\d+))?$/.exec(group);
				if (matches) {
					return -10;
				}

				return;
			}
		},
		icon: icons.remoteExplorerViewIcon,
		order: 4
	}, ViewContainerLocation.Sidebar);

class RemoteMarkers implements IWorkbenchContribution {

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@ITimerService timerService: ITimerService,
	) {
		remoteAgentService.getEnvironment().then(remoteEnv => {
			if (remoteEnv) {
				timerService.setPerformanceMarks('server', remoteEnv.marks);
			}
		});
	}
}

class VisibleProgress {

	public readonly location: ProgressLocation;
	private _isDisposed: boolean;
	private _lastReport: string | null;
	private _currentProgressPromiseResolve: (() => void) | null;
	private _currentProgress: IProgress<IProgressStep> | null;
	private _currentTimer: ReconnectionTimer2 | null;

	public get lastReport(): string | null {
		return this._lastReport;
	}

	constructor(progressService: IProgressService, location: ProgressLocation, initialReport: string | null, buttons: string[], onDidCancel: (choice: number | undefined, lastReport: string | null) => void) {
		this.location = location;
		this._isDisposed = false;
		this._lastReport = initialReport;
		this._currentProgressPromiseResolve = null;
		this._currentProgress = null;
		this._currentTimer = null;

		const promise = new Promise<void>((resolve) => this._currentProgressPromiseResolve = resolve);

		progressService.withProgress(
			{ location: location, buttons: buttons },
			(progress) => { if (!this._isDisposed) { this._currentProgress = progress; } return promise; },
			(choice) => onDidCancel(choice, this._lastReport)
		);

		if (this._lastReport) {
			this.report();
		}
	}

	public dispose(): void {
		this._isDisposed = true;
		if (this._currentProgressPromiseResolve) {
			this._currentProgressPromiseResolve();
			this._currentProgressPromiseResolve = null;
		}
		this._currentProgress = null;
		if (this._currentTimer) {
			this._currentTimer.dispose();
			this._currentTimer = null;
		}
	}

	public report(message?: string) {
		if (message) {
			this._lastReport = message;
		}

		if (this._lastReport && this._currentProgress) {
			this._currentProgress.report({ message: this._lastReport });
		}
	}

	public startTimer(completionTime: number): void {
		this.stopTimer();
		this._currentTimer = new ReconnectionTimer2(this, completionTime);
	}

	public stopTimer(): void {
		if (this._currentTimer) {
			this._currentTimer.dispose();
			this._currentTimer = null;
		}
	}
}

class ReconnectionTimer2 implements IDisposable {
	private readonly _parent: VisibleProgress;
	private readonly _completionTime: number;
	private readonly _token: any;

	constructor(parent: VisibleProgress, completionTime: number) {
		this._parent = parent;
		this._completionTime = completionTime;
		this._token = setInterval(() => this._render(), 1000);
		this._render();
	}

	public dispose(): void {
		clearInterval(this._token);
	}

	private _render() {
		const remainingTimeMs = this._completionTime - Date.now();
		if (remainingTimeMs < 0) {
			return;
		}
		const remainingTime = Math.ceil(remainingTimeMs / 1000);
		if (remainingTime === 1) {
			this._parent.report(nls.localize('reconnectionWaitOne', "Attempting to reconnect in {0} second...", remainingTime));
		} else {
			this._parent.report(nls.localize('reconnectionWaitMany', "Attempting to reconnect in {0} seconds...", remainingTime));
		}
	}
}

/**
 * The time when a prompt is shown to the user
 */
const DISCONNECT_PROMPT_TIME = 40 * 1000; // 40 seconds

class RemoteAgentConnectionStatusListener extends Disposable implements IWorkbenchContribution {

	private _reloadWindowShown: boolean = false;

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@IProgressService progressService: IProgressService,
		@IDialogService dialogService: IDialogService,
		@ICommandService commandService: ICommandService,
		@IQuickInputService quickInputService: IQuickInputService,
		@ILogService logService: ILogService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService
	) {
		super();
		const connection = remoteAgentService.getConnection();
		if (connection) {
			let quickInputVisible = false;
			quickInputService.onShow(() => quickInputVisible = true);
			quickInputService.onHide(() => quickInputVisible = false);

			let visibleProgress: VisibleProgress | null = null;
			let reconnectWaitEvent: ReconnectionWaitEvent | null = null;
			let disposableListener: IDisposable | null = null;

			function showProgress(location: ProgressLocation.Dialog | ProgressLocation.Notification | null, buttons: { label: string, callback: () => void }[], initialReport: string | null = null): VisibleProgress {
				if (visibleProgress) {
					visibleProgress.dispose();
					visibleProgress = null;
				}

				if (!location) {
					location = quickInputVisible ? ProgressLocation.Notification : ProgressLocation.Dialog;
				}

				return new VisibleProgress(
					progressService, location, initialReport, buttons.map(button => button.label),
					(choice, lastReport) => {
						// Handle choice from dialog
						if (typeof choice !== 'undefined' && buttons[choice]) {
							buttons[choice].callback();
						} else {
							if (location === ProgressLocation.Dialog) {
								visibleProgress = showProgress(ProgressLocation.Notification, buttons, lastReport);
							} else {
								hideProgress();
							}
						}
					}
				);
			}

			function hideProgress() {
				if (visibleProgress) {
					visibleProgress.dispose();
					visibleProgress = null;
				}
			}

			let reconnectionToken: string = '';
			let lastIncomingDataTime: number = 0;
			let reconnectionAttempts: number = 0;

			const reconnectButton = {
				label: nls.localize('reconnectNow', "Reconnect Now"),
				callback: () => {
					if (reconnectWaitEvent) {
						reconnectWaitEvent.skipWait();
					}
				}
			};

			const reloadButton = {
				label: nls.localize('reloadWindow', "Reload Window"),
				callback: () => {

					type ReconnectReloadClassification = {
						remoteName: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						reconnectionToken: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						millisSinceLastIncomingData: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						attempt: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
					};
					type ReconnectReloadEvent = {
						remoteName: string | undefined;
						reconnectionToken: string;
						millisSinceLastIncomingData: number;
						attempt: number;
					};
					telemetryService.publicLog2<ReconnectReloadEvent, ReconnectReloadClassification>('remoteReconnectionReload', {
						remoteName: getRemoteName(environmentService.remoteAuthority),
						reconnectionToken: reconnectionToken,
						millisSinceLastIncomingData: Date.now() - lastIncomingDataTime,
						attempt: reconnectionAttempts
					});

					commandService.executeCommand(ReloadWindowAction.ID);
				}
			};

			// Possible state transitions:
			// ConnectionGain      -> ConnectionLost
			// ConnectionLost      -> ReconnectionWait, ReconnectionRunning
			// ReconnectionWait    -> ReconnectionRunning
			// ReconnectionRunning -> ConnectionGain, ReconnectionPermanentFailure

			connection.onDidStateChange((e) => {
				if (visibleProgress) {
					visibleProgress.stopTimer();
				}

				if (disposableListener) {
					disposableListener.dispose();
					disposableListener = null;
				}
				switch (e.type) {
					case PersistentConnectionEventType.ConnectionLost:
						reconnectionToken = e.reconnectionToken;
						lastIncomingDataTime = Date.now() - e.millisSinceLastIncomingData;
						reconnectionAttempts = 0;

						type RemoteConnectionLostClassification = {
							remoteName: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							reconnectionToken: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						};
						type RemoteConnectionLostEvent = {
							remoteName: string | undefined;
							reconnectionToken: string;
						};
						telemetryService.publicLog2<RemoteConnectionLostEvent, RemoteConnectionLostClassification>('remoteConnectionLost', {
							remoteName: getRemoteName(environmentService.remoteAuthority),
							reconnectionToken: e.reconnectionToken,
						});

						if (visibleProgress || e.millisSinceLastIncomingData > DISCONNECT_PROMPT_TIME) {
							if (!visibleProgress) {
								visibleProgress = showProgress(null, [reconnectButton, reloadButton]);
							}
							visibleProgress.report(nls.localize('connectionLost', "Connection Lost"));
						}
						break;

					case PersistentConnectionEventType.ReconnectionWait:
						if (visibleProgress) {
							reconnectWaitEvent = e;
							visibleProgress = showProgress(null, [reconnectButton, reloadButton]);
							visibleProgress.startTimer(Date.now() + 1000 * e.durationSeconds);
						}
						break;

					case PersistentConnectionEventType.ReconnectionRunning:
						reconnectionToken = e.reconnectionToken;
						lastIncomingDataTime = Date.now() - e.millisSinceLastIncomingData;
						reconnectionAttempts = e.attempt;

						type RemoteReconnectionRunningClassification = {
							remoteName: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							reconnectionToken: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							millisSinceLastIncomingData: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							attempt: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						};
						type RemoteReconnectionRunningEvent = {
							remoteName: string | undefined;
							reconnectionToken: string;
							millisSinceLastIncomingData: number;
							attempt: number;
						};
						telemetryService.publicLog2<RemoteReconnectionRunningEvent, RemoteReconnectionRunningClassification>('remoteReconnectionRunning', {
							remoteName: getRemoteName(environmentService.remoteAuthority),
							reconnectionToken: e.reconnectionToken,
							millisSinceLastIncomingData: e.millisSinceLastIncomingData,
							attempt: e.attempt
						});

						if (visibleProgress || e.millisSinceLastIncomingData > DISCONNECT_PROMPT_TIME) {
							visibleProgress = showProgress(null, [reloadButton]);
							visibleProgress.report(nls.localize('reconnectionRunning', "Disconnected. Attempting to reconnect..."));

							// Register to listen for quick input is opened
							disposableListener = quickInputService.onShow(() => {
								// Need to move from dialog if being shown and user needs to type in a prompt
								if (visibleProgress && visibleProgress.location === ProgressLocation.Dialog) {
									visibleProgress = showProgress(ProgressLocation.Notification, [reloadButton], visibleProgress.lastReport);
								}
							});
						}

						break;

					case PersistentConnectionEventType.ReconnectionPermanentFailure:
						reconnectionToken = e.reconnectionToken;
						lastIncomingDataTime = Date.now() - e.millisSinceLastIncomingData;
						reconnectionAttempts = e.attempt;

						type RemoteReconnectionPermanentFailureClassification = {
							remoteName: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							reconnectionToken: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							millisSinceLastIncomingData: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							attempt: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							handled: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						};
						type RemoteReconnectionPermanentFailureEvent = {
							remoteName: string | undefined;
							reconnectionToken: string;
							millisSinceLastIncomingData: number;
							attempt: number;
							handled: boolean;
						};
						telemetryService.publicLog2<RemoteReconnectionPermanentFailureEvent, RemoteReconnectionPermanentFailureClassification>('remoteReconnectionPermanentFailure', {
							remoteName: getRemoteName(environmentService.remoteAuthority),
							reconnectionToken: e.reconnectionToken,
							millisSinceLastIncomingData: e.millisSinceLastIncomingData,
							attempt: e.attempt,
							handled: e.handled
						});

						hideProgress();

						if (e.handled) {
							logService.info(`Error handled: Not showing a notification for the error.`);
							console.log(`Error handled: Not showing a notification for the error.`);
						} else if (!this._reloadWindowShown) {
							this._reloadWindowShown = true;
							dialogService.show(Severity.Error, nls.localize('reconnectionPermanentFailure', "Cannot reconnect. Please reload the window."), [nls.localize('reloadWindow', "Reload Window"), nls.localize('cancel', "Cancel")], { cancelId: 1, custom: true }).then(result => {
								// Reload the window
								if (result.choice === 0) {
									commandService.executeCommand(ReloadWindowAction.ID);
								}
							});
						}
						break;

					case PersistentConnectionEventType.ConnectionGain:
						reconnectionToken = e.reconnectionToken;
						lastIncomingDataTime = Date.now() - e.millisSinceLastIncomingData;
						reconnectionAttempts = e.attempt;

						type RemoteConnectionGainClassification = {
							remoteName: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							reconnectionToken: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							millisSinceLastIncomingData: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
							attempt: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth' };
						};
						type RemoteConnectionGainEvent = {
							remoteName: string | undefined;
							reconnectionToken: string;
							millisSinceLastIncomingData: number;
							attempt: number;
						};
						telemetryService.publicLog2<RemoteConnectionGainEvent, RemoteConnectionGainClassification>('remoteConnectionGain', {
							remoteName: getRemoteName(environmentService.remoteAuthority),
							reconnectionToken: e.reconnectionToken,
							millisSinceLastIncomingData: e.millisSinceLastIncomingData,
							attempt: e.attempt
						});

						hideProgress();
						break;
				}
			});
		}
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteAgentConnectionStatusListener, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteStatusIndicator, LifecyclePhase.Starting);
workbenchContributionsRegistry.registerWorkbenchContribution(ForwardedPortsView, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(PortRestore, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(AutomaticPortForwarding, LifecyclePhase.Eventually);
workbenchContributionsRegistry.registerWorkbenchContribution(RemoteMarkers, LifecyclePhase.Eventually);
