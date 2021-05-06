/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from 'vs/base/common/async';
import { debounce, throttle } from 'vs/base/common/decorators';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/path';
import { isMacintosh, isWeb, isWindows, OperatingSystem } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { DataTransfers } from 'vs/base/browser/dnd';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import * as nls from 'vs/nls';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { IKeyMods, IPickOptions, IQuickInputButton, IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ILocalTerminalService, IShellLaunchConfig, ITerminalLaunchError, ITerminalsLayoutInfo, ITerminalsLayoutInfoById, TerminalShellType, WindowsShellType } from 'vs/platform/terminal/common/terminal';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IViewDescriptorService, IViewsService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IRemoteTerminalService, ITerminalExternalLinkProvider, ITerminalInstance, ITerminalService, ITerminalGroup, TerminalConnectionState } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { TerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminalInstance';
import { TerminalGroup } from 'vs/workbench/contrib/terminal/browser/terminalGroup';
import { TerminalViewPane } from 'vs/workbench/contrib/terminal/browser/terminalView';
import { IAvailableProfilesRequest, IRemoteTerminalAttachTarget, ITerminalProfile, IStartExtensionTerminalRequest, ITerminalConfigHelper, ITerminalProcessExtHostProxy, KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_IS_OPEN, KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE, TERMINAL_VIEW_ID, ITerminalProfileObject, ITerminalTypeContribution, KEYBINDING_CONTEXT_TERMINAL_COUNT, TerminalSettingId } from 'vs/workbench/contrib/terminal/common/terminal';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ILifecycleService, ShutdownReason, WillShutdownEvent } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { configureTerminalProfileIcon } from 'vs/workbench/contrib/terminal/browser/terminalIcons';
import { equals } from 'vs/base/common/objects';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILabelService } from 'vs/platform/label/common/label';
import { Schemas } from 'vs/base/common/network';
import { VirtualWorkspaceContext } from 'vs/workbench/browser/contextkeys';
import { formatMessageForTerminal } from 'vs/workbench/contrib/terminal/common/terminalStrings';
import { escapeNonWindowsPath } from 'vs/platform/terminal/common/terminalEnvironment';

interface IExtHostReadyEntry {
	promise: Promise<void>;
	resolve: () => void;
}

export class TerminalService implements ITerminalService {
	declare _serviceBrand: undefined;

	private _isShuttingDown: boolean;
	private _terminalFocusContextKey: IContextKey<boolean>;
	private _terminalCountContextKey: IContextKey<number>;
	private _terminalShellTypeContextKey: IContextKey<string>;
	private _terminalAltBufferActiveContextKey: IContextKey<boolean>;
	private _terminalGroups: ITerminalGroup[] = [];
	private _backgroundedTerminalInstances: ITerminalInstance[] = [];
	private get _terminalInstances(): ITerminalInstance[] {
		return this._terminalGroups.reduce((p, c) => p.concat(c.terminalInstances), <ITerminalInstance[]>[]);
	}
	private _findState: FindReplaceState;
	private _extHostsReady: { [authority: string]: IExtHostReadyEntry | undefined } = {};
	private _activeGroupIndex: number;
	private _linkProviders: Set<ITerminalExternalLinkProvider> = new Set();
	private _linkProviderDisposables: Map<ITerminalExternalLinkProvider, IDisposable[]> = new Map();
	private _processSupportContextKey: IContextKey<boolean>;

	public get activeTabIndex(): number { return this._activeGroupIndex; }
	public get terminalInstances(): ITerminalInstance[] { return this._terminalInstances; }
	public get terminalGroups(): ITerminalGroup[] { return this._terminalGroups; }
	public get isProcessSupportRegistered(): boolean { return !!this._processSupportContextKey.get(); }

	private _configHelper: TerminalConfigHelper;
	private _terminalContainer: HTMLElement | undefined;
	private _remoteTerminalsInitPromise: Promise<void> | undefined;
	private _localTerminalsInitPromise: Promise<void> | undefined;
	private _connectionState: TerminalConnectionState;
	get connectionState(): TerminalConnectionState { return this._connectionState; }
	private readonly _localTerminalService?: ILocalTerminalService;

	private _availableProfiles: ITerminalProfile[] | undefined;
	get availableProfiles(): ITerminalProfile[] {
		this._refreshAvailableProfiles();
		return this._availableProfiles || [];
	}

	get configHelper(): ITerminalConfigHelper { return this._configHelper; }

	private readonly _onActiveTabChanged = new Emitter<void>();
	get onActiveTabChanged(): Event<void> { return this._onActiveTabChanged.event; }
	private readonly _onInstanceCreated = new Emitter<ITerminalInstance>();
	get onInstanceCreated(): Event<ITerminalInstance> { return this._onInstanceCreated.event; }
	private readonly _onInstanceDisposed = new Emitter<ITerminalInstance>();
	get onInstanceDisposed(): Event<ITerminalInstance> { return this._onInstanceDisposed.event; }
	private readonly _onInstanceProcessIdReady = new Emitter<ITerminalInstance>();
	get onInstanceProcessIdReady(): Event<ITerminalInstance> { return this._onInstanceProcessIdReady.event; }
	private readonly _onInstanceLinksReady = new Emitter<ITerminalInstance>();
	get onInstanceLinksReady(): Event<ITerminalInstance> { return this._onInstanceLinksReady.event; }
	private readonly _onInstanceRequestStartExtensionTerminal = new Emitter<IStartExtensionTerminalRequest>();
	get onInstanceRequestStartExtensionTerminal(): Event<IStartExtensionTerminalRequest> { return this._onInstanceRequestStartExtensionTerminal.event; }
	private readonly _onInstanceDimensionsChanged = new Emitter<ITerminalInstance>();
	get onInstanceDimensionsChanged(): Event<ITerminalInstance> { return this._onInstanceDimensionsChanged.event; }
	private readonly _onInstanceMaximumDimensionsChanged = new Emitter<ITerminalInstance>();
	get onInstanceMaximumDimensionsChanged(): Event<ITerminalInstance> { return this._onInstanceMaximumDimensionsChanged.event; }
	private readonly _onInstancesChanged = new Emitter<void>();
	get onInstancesChanged(): Event<void> { return this._onInstancesChanged.event; }
	private readonly _onInstanceTitleChanged = new Emitter<ITerminalInstance | undefined>();
	get onInstanceTitleChanged(): Event<ITerminalInstance | undefined> { return this._onInstanceTitleChanged.event; }
	private readonly _onInstanceIconChanged = new Emitter<ITerminalInstance | undefined>();
	get onInstanceIconChanged(): Event<ITerminalInstance | undefined> { return this._onInstanceIconChanged.event; }
	private readonly _onActiveInstanceChanged = new Emitter<ITerminalInstance | undefined>();
	get onActiveInstanceChanged(): Event<ITerminalInstance | undefined> { return this._onActiveInstanceChanged.event; }
	private readonly _onInstancePrimaryStatusChanged = new Emitter<ITerminalInstance>();
	public get onInstancePrimaryStatusChanged(): Event<ITerminalInstance> { return this._onInstancePrimaryStatusChanged.event; }
	private readonly _onTabDisposed = new Emitter<ITerminalGroup>();
	public get onTabDisposed(): Event<ITerminalGroup> { return this._onTabDisposed.event; }
	private readonly _onRequestAvailableProfiles = new Emitter<IAvailableProfilesRequest>();
	get onRequestAvailableProfiles(): Event<IAvailableProfilesRequest> { return this._onRequestAvailableProfiles.event; }
	private readonly _onDidRegisterProcessSupport = new Emitter<void>();
	get onDidRegisterProcessSupport(): Event<void> { return this._onDidRegisterProcessSupport.event; }
	private readonly _onDidChangeConnectionState = new Emitter<void>();
	get onDidChangeConnectionState(): Event<void> { return this._onDidChangeConnectionState.event; }
	private readonly _onDidChangeAvailableProfiles = new Emitter<ITerminalProfile[]>();
	get onDidChangeAvailableProfiles(): Event<ITerminalProfile[]> { return this._onDidChangeAvailableProfiles.event; }
	private readonly _onPanelMovedToSide = new Emitter<void>();
	get onPanelMovedToSide(): Event<void> { return this._onPanelMovedToSide.event; }

	constructor(
		@IContextKeyService private _contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService private _layoutService: IWorkbenchLayoutService,
		@ILabelService labelService: ILabelService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IDialogService private _dialogService: IDialogService,
		@IInstantiationService private _instantiationService: IInstantiationService,
		@IRemoteAgentService private _remoteAgentService: IRemoteAgentService,
		@IQuickInputService private _quickInputService: IQuickInputService,
		@IConfigurationService private _configurationService: IConfigurationService,
		@IViewsService private _viewsService: IViewsService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IRemoteTerminalService private readonly _remoteTerminalService: IRemoteTerminalService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ITerminalContributionService private readonly _terminalContributionService: ITerminalContributionService,
		@ICommandService private readonly _commandService: ICommandService,
		@optional(ILocalTerminalService) localTerminalService: ILocalTerminalService
	) {
		this._localTerminalService = localTerminalService;

		this._activeGroupIndex = 0;
		this._isShuttingDown = false;
		this._findState = new FindReplaceState();
		lifecycleService.onBeforeShutdown(async e => e.veto(this._onBeforeShutdown(e.reason), 'veto.terminal'));
		lifecycleService.onWillShutdown(e => this._onWillShutdown(e));
		this._terminalFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_FOCUS.bindTo(this._contextKeyService);
		this._terminalCountContextKey = KEYBINDING_CONTEXT_TERMINAL_COUNT.bindTo(this._contextKeyService);
		this._terminalShellTypeContextKey = KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE.bindTo(this._contextKeyService);
		this._terminalAltBufferActiveContextKey = KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE.bindTo(this._contextKeyService);
		this._configHelper = this._instantiationService.createInstance(TerminalConfigHelper);
		this.onTabDisposed(group => this._removeTab(group));
		this.onActiveTabChanged(() => {
			const instance = this.getActiveInstance();
			this._onActiveInstanceChanged.fire(instance ? instance : undefined);
		});
		// update detected profiles so for example we detect if you've installed a pwsh
		// this avoids having poll routinely
		this.onInstanceCreated(() => this._refreshAvailableProfiles());
		this.onInstancesChanged(() => this._terminalCountContextKey.set(this._terminalInstances.length));
		this.onInstanceLinksReady(instance => this._setInstanceLinkProviders(instance));
		this._handleInstanceContextKeys();
		this._processSupportContextKey = KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED.bindTo(this._contextKeyService);
		this._processSupportContextKey.set(!isWeb || this._remoteAgentService.getConnection() !== null);

		this._configurationService.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration(TerminalSettingId.ProfilesWindows) ||
				e.affectsConfiguration(TerminalSettingId.ProfilesMacOs) ||
				e.affectsConfiguration(TerminalSettingId.ProfilesLinux) ||
				e.affectsConfiguration(TerminalSettingId.DefaultProfileWindows) ||
				e.affectsConfiguration(TerminalSettingId.DefaultProfileMacOs) ||
				e.affectsConfiguration(TerminalSettingId.DefaultProfileLinux) ||
				e.affectsConfiguration(TerminalSettingId.UseWslProfiles)) {
				this._refreshAvailableProfiles();
			}
		});

		// Register a resource formatter for terminal URIs
		labelService.registerFormatter({
			scheme: Schemas.vscodeTerminal,
			formatting: {
				label: '${path}',
				separator: ''
			}
		});

		const enableTerminalReconnection = this.configHelper.config.enablePersistentSessions;

		const conn = this._remoteAgentService.getConnection();
		const remoteAuthority = conn ? conn.remoteAuthority : 'null';
		this._whenExtHostReady(remoteAuthority).then(() => {
			this._refreshAvailableProfiles();
		});

		// Connect to the extension host if it's there, set the connection state to connected when
		// it's done. This should happen even when there is no extension host.
		this._connectionState = TerminalConnectionState.Connecting;
		let initPromise: Promise<any>;
		if (!!this._environmentService.remoteAuthority && enableTerminalReconnection) {
			initPromise = this._remoteTerminalsInitPromise = this._reconnectToRemoteTerminals();
		} else if (enableTerminalReconnection) {
			initPromise = this._localTerminalsInitPromise = this._reconnectToLocalTerminals();
		} else {
			initPromise = Promise.resolve();
		}
		initPromise.then(() => this._setConnected());
	}

	private _setConnected() {
		this._connectionState = TerminalConnectionState.Connected;
		this._onDidChangeConnectionState.fire();
	}

	private async _reconnectToRemoteTerminals(): Promise<void> {
		// Reattach to all remote terminals
		const layoutInfo = await this._remoteTerminalService.getTerminalLayoutInfo();
		this._remoteTerminalService.reduceConnectionGraceTime();
		const reconnectCounter = this._recreateTerminalTabs(layoutInfo);
		/* __GDPR__
			"terminalReconnection" : {
				"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		 */
		const data = {
			count: reconnectCounter
		};
		this._telemetryService.publicLog('terminalReconnection', data);
		// now that terminals have been restored,
		// attach listeners to update remote when terminals are changed
		this._attachProcessLayoutListeners(true);
	}

	private async _reconnectToLocalTerminals(): Promise<void> {
		if (!this._localTerminalService) {
			return;
		}
		// Reattach to all local terminals
		const layoutInfo = await this._localTerminalService.getTerminalLayoutInfo();
		if (layoutInfo && layoutInfo.tabs.length > 0) {
			this._recreateTerminalTabs(layoutInfo);
		}
		// now that terminals have been restored,
		// attach listeners to update local state when terminals are changed
		this._attachProcessLayoutListeners(false);
	}

	private _recreateTerminalTabs(layoutInfo?: ITerminalsLayoutInfo): number {
		let reconnectCounter = 0;
		let activeTab: ITerminalGroup | undefined;
		if (layoutInfo) {
			layoutInfo.tabs.forEach(groupLayout => {
				const terminalLayouts = groupLayout.terminals.filter(t => t.terminal && t.terminal.isOrphan);
				if (terminalLayouts.length) {
					reconnectCounter += terminalLayouts.length;
					let terminalInstance: ITerminalInstance | undefined;
					let group: ITerminalGroup | undefined;
					terminalLayouts.forEach((terminalLayout) => {
						if (!terminalInstance) {
							// create group and terminal
							terminalInstance = this.createTerminal({ attachPersistentProcess: terminalLayout.terminal! });
							group = this.getGroupForInstance(terminalInstance);
							if (groupLayout.isActive) {
								activeTab = group;
							}
						} else {
							// add split terminals to this group
							this.splitInstance(terminalInstance, { attachPersistentProcess: terminalLayout.terminal! });
						}
					});
					const activeInstance = this.terminalInstances.find(t => {
						return t.shellLaunchConfig.attachPersistentProcess?.id === groupLayout.activePersistentProcessId;
					});
					if (activeInstance) {
						this.setActiveInstance(activeInstance);
					}
					group?.resizePanes(groupLayout.terminals.map(terminal => terminal.relativeSize));
				}
			});
			if (layoutInfo.tabs.length) {
				this.setActiveTabByIndex(activeTab ? this.terminalGroups.indexOf(activeTab) : 0);
			}
		}
		return reconnectCounter;
	}

	private _attachProcessLayoutListeners(isRemote: boolean): void {
		this.onActiveTabChanged(() => this._saveState(isRemote));
		this.onActiveInstanceChanged(() => this._saveState(isRemote));
		this.onInstancesChanged(() => this._saveState(isRemote));
		// The state must be updated when the terminal is relaunched, otherwise the persistent
		// terminal ID will be stale and the process will be leaked.
		this.onInstanceProcessIdReady(() => this._saveState(isRemote));
		this.onInstanceTitleChanged(instance => {
			this._updateTitle(instance);
		});
		this.onInstanceIconChanged(instance => {
			this._updateIcon(instance);
		});
	}

	private _handleInstanceContextKeys(): void {
		const terminalIsOpenContext = KEYBINDING_CONTEXT_TERMINAL_IS_OPEN.bindTo(this._contextKeyService);
		const updateTerminalContextKeys = () => {
			terminalIsOpenContext.set(this.terminalInstances.length > 0);
		};
		this.onInstancesChanged(() => updateTerminalContextKeys());
	}

	getActiveOrCreateInstance(): ITerminalInstance {
		const activeInstance = this.getActiveInstance();
		return activeInstance ? activeInstance : this.createTerminal(undefined);
	}

	requestStartExtensionTerminal(proxy: ITerminalProcessExtHostProxy, cols: number, rows: number): Promise<ITerminalLaunchError | undefined> {
		// The initial request came from the extension host, no need to wait for it
		return new Promise<ITerminalLaunchError | undefined>(callback => {
			this._onInstanceRequestStartExtensionTerminal.fire({ proxy, cols, rows, callback });
		});
	}

	async extHostReady(remoteAuthority: string): Promise<void> {
		this._createExtHostReadyEntry(remoteAuthority);
		this._extHostsReady[remoteAuthority]!.resolve();
	}

	@throttle(10000)
	private async _refreshAvailableProfiles(): Promise<void> {
		const result = await this._detectProfiles(true);
		if (!equals(result, this._availableProfiles)) {
			this._availableProfiles = result;
			this._onDidChangeAvailableProfiles.fire(this._availableProfiles);
		}
	}

	private async _detectProfiles(configuredProfilesOnly: boolean): Promise<ITerminalProfile[]> {
		await this._extensionService.whenInstalledExtensionsRegistered();
		// Wait for the remoteAuthority to be ready (and listening for events) before firing
		// the event to spawn the ext host process
		const conn = this._remoteAgentService.getConnection();
		const remoteAuthority = conn ? conn.remoteAuthority : 'null';
		await this._whenExtHostReady(remoteAuthority);
		return new Promise(r => this._onRequestAvailableProfiles.fire({ callback: r, configuredProfilesOnly: configuredProfilesOnly }));
	}

	private async _whenExtHostReady(remoteAuthority: string): Promise<void> {
		this._createExtHostReadyEntry(remoteAuthority);
		return this._extHostsReady[remoteAuthority]!.promise;
	}

	private _createExtHostReadyEntry(remoteAuthority: string): void {
		if (this._extHostsReady[remoteAuthority]) {
			return;
		}

		let resolve!: () => void;
		const promise = new Promise<void>(r => resolve = r);
		this._extHostsReady[remoteAuthority] = { promise, resolve };
	}

	private _onBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean> {
		if (this.terminalInstances.length === 0) {
			// No terminal instances, don't veto
			return false;
		}

		const shouldPersistTerminals = this._configHelper.config.enablePersistentSessions && reason === ShutdownReason.RELOAD;
		if (this.configHelper.config.confirmOnExit && !shouldPersistTerminals) {
			return this._onBeforeShutdownAsync();
		}

		this._isShuttingDown = true;

		return false;
	}

	private async _onBeforeShutdownAsync(): Promise<boolean> {
		// veto if configured to show confirmation and the user chose not to exit
		const veto = await this._showTerminalCloseConfirmation();
		if (!veto) {
			this._isShuttingDown = true;
		}
		return veto;
	}

	private _onWillShutdown(e: WillShutdownEvent): void {
		// Don't touch processes if the shutdown was a result of reload as they will be reattached
		const shouldPersistTerminals = this._configHelper.config.enablePersistentSessions && e.reason === ShutdownReason.RELOAD;
		if (shouldPersistTerminals) {
			this.terminalInstances.forEach(instance => instance.detachFromProcess());
			return;
		}

		// Force dispose of all terminal instances
		this.terminalInstances.forEach(instance => instance.dispose(true));

		this._localTerminalService?.setTerminalLayoutInfo(undefined);
	}

	public getTabLabels(): string[] {
		return this._terminalGroups.filter(group => group.terminalInstances.length > 0).map((group, index) => {
			return `${index + 1}: ${group.title ? group.title : ''}`;
		});
	}

	getFindState(): FindReplaceState {
		return this._findState;
	}

	@debounce(500)
	private _saveState(isRemote?: boolean): void {
		const offProcService = isRemote ? this._remoteTerminalService : this._localTerminalService;
		const state: ITerminalsLayoutInfoById = {
			tabs: this.terminalGroups.map(t => t.getLayoutInfo(t === this.getActiveGroup()))
		};
		offProcService!.setTerminalLayoutInfo(state);
	}

	@debounce(500)
	private _updateTitle(instance?: ITerminalInstance): void {
		const isRemote = !!this._environmentService.remoteAuthority;
		const offProcService = isRemote ? this._remoteTerminalService : this._localTerminalService;
		if (!instance || !instance.persistentProcessId || !instance.title) {
			return;
		}
		offProcService?.updateTitle(instance.persistentProcessId, instance.title);
	}

	@debounce(500)
	private _updateIcon(instance?: ITerminalInstance): void {
		const isRemote = !!this._environmentService.remoteAuthority;
		const offProcService = isRemote ? this._remoteTerminalService : this._localTerminalService;
		if (!instance || !instance.persistentProcessId || !instance.icon) {
			return;
		}
		offProcService?.updateIcon(instance.persistentProcessId, instance.icon.id);
	}

	private _removeTab(group: ITerminalGroup): void {
		// Get the index of the group and remove it from the list
		const index = this._terminalGroups.indexOf(group);
		const activeTab = this.getActiveGroup();
		const activeTabIndex = activeTab ? this._terminalGroups.indexOf(activeTab) : -1;
		const wasActiveTab = group === activeTab;
		if (index !== -1) {
			this._terminalGroups.splice(index, 1);
		}

		// Adjust focus if the group was active
		if (wasActiveTab && this._terminalGroups.length > 0) {
			const newIndex = index < this._terminalGroups.length ? index : this._terminalGroups.length - 1;
			this.setActiveTabByIndex(newIndex);
			const activeInstance = this.getActiveInstance();
			if (activeInstance) {
				activeInstance.focus(true);
			}
		} else if (activeTabIndex >= this._terminalGroups.length) {
			const newIndex = this._terminalGroups.length - 1;
			this.setActiveTabByIndex(newIndex);
		}

		// Hide the panel if there are no more instances, provided that VS Code is not shutting
		// down. When shutting down the panel is locked in place so that it is restored upon next
		// launch.
		if (this._terminalGroups.length === 0 && !this._isShuttingDown) {
			this.hidePanel();
			this._onActiveInstanceChanged.fire(undefined);
		}

		// Fire events
		this._onInstancesChanged.fire();
		if (wasActiveTab) {
			this._onActiveTabChanged.fire();
		}
	}

	refreshActiveTab(): void {
		// Fire active instances changed
		this._onActiveTabChanged.fire();
	}

	public getActiveGroup(): ITerminalGroup | null {
		if (this._activeGroupIndex < 0 || this._activeGroupIndex >= this._terminalGroups.length) {
			return null;
		}
		return this._terminalGroups[this._activeGroupIndex];
	}

	public getActiveInstance(): ITerminalInstance | null {
		const group = this.getActiveGroup();
		if (!group) {
			return null;
		}
		return group.activeInstance;
	}

	doWithActiveInstance<T>(callback: (terminal: ITerminalInstance) => T): T | void {
		const instance = this.getActiveInstance();
		if (instance) {
			return callback(instance);
		}
	}

	getInstanceFromId(terminalId: number): ITerminalInstance | undefined {
		let bgIndex = -1;
		this._backgroundedTerminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.instanceId === terminalId) {
				bgIndex = i;
			}
		});
		if (bgIndex !== -1) {
			return this._backgroundedTerminalInstances[bgIndex];
		}
		try {
			return this.terminalInstances[this._getIndexFromId(terminalId)];
		} catch {
			return undefined;
		}
	}

	getInstanceFromIndex(terminalIndex: number): ITerminalInstance {
		return this.terminalInstances[terminalIndex];
	}

	setActiveInstance(terminalInstance: ITerminalInstance): void {
		// If this was a hideFromUser terminal created by the API this was triggered by show,
		// in which case we need to create the terminal group
		if (terminalInstance.shellLaunchConfig.hideFromUser) {
			this._showBackgroundTerminal(terminalInstance);
		}
		this.setActiveInstanceByIndex(this._getIndexFromId(terminalInstance.instanceId));
	}

	setActiveTabByIndex(groupIndex: number): void {
		if (groupIndex >= this._terminalGroups.length) {
			return;
		}

		const didTabChange = this._activeGroupIndex !== groupIndex;
		this._activeGroupIndex = groupIndex;

		this._terminalGroups.forEach((g, i) => g.setVisible(i === this._activeGroupIndex));
		if (didTabChange) {
			this._onActiveTabChanged.fire();
		}
	}

	isAttachedToTerminal(remoteTerm: IRemoteTerminalAttachTarget): boolean {
		return this.terminalInstances.some(term => term.processId === remoteTerm.pid);
	}

	async initializeTerminals(): Promise<void> {
		if (this._remoteTerminalsInitPromise) {
			await this._remoteTerminalsInitPromise;
		} else if (this._localTerminalsInitPromise) {
			await this._localTerminalsInitPromise;
		}
		if (this.terminalGroups.length === 0 && this.isProcessSupportRegistered) {
			this.createTerminal();
		}
	}

	private _getInstanceFromGlobalInstanceIndex(index: number): { group: ITerminalGroup, groupIndex: number, instance: ITerminalInstance, localInstanceIndex: number } | null {
		let currentTabIndex = 0;
		while (index >= 0 && currentTabIndex < this._terminalGroups.length) {
			const group = this._terminalGroups[currentTabIndex];
			const count = group.terminalInstances.length;
			if (index < count) {
				return {
					group,
					groupIndex: currentTabIndex,
					instance: group.terminalInstances[index],
					localInstanceIndex: index
				};
			}
			index -= count;
			currentTabIndex++;
		}
		return null;
	}

	setActiveInstanceByIndex(terminalIndex: number): void {
		const query = this._getInstanceFromGlobalInstanceIndex(terminalIndex);
		if (!query) {
			return;
		}

		query.group.setActiveInstanceByIndex(query.localInstanceIndex);
		const didTabChange = this._activeGroupIndex !== query.groupIndex;
		this._activeGroupIndex = query.groupIndex;
		this._terminalGroups.forEach((g, i) => g.setVisible(i === query.groupIndex));

		// Only fire the event if there was a change
		if (didTabChange) {
			this._onActiveTabChanged.fire();
		}
	}

	setActiveTabToNext(): void {
		if (this._terminalGroups.length <= 1) {
			return;
		}
		let newIndex = this._activeGroupIndex + 1;
		if (newIndex >= this._terminalGroups.length) {
			newIndex = 0;
		}
		this.setActiveTabByIndex(newIndex);
	}

	setActiveTabToPrevious(): void {
		if (this._terminalGroups.length <= 1) {
			return;
		}
		let newIndex = this._activeGroupIndex - 1;
		if (newIndex < 0) {
			newIndex = this._terminalGroups.length - 1;
		}
		this.setActiveTabByIndex(newIndex);
	}

	splitInstance(instanceToSplit: ITerminalInstance, shellLaunchConfig?: IShellLaunchConfig): ITerminalInstance | null;
	splitInstance(instanceToSplit: ITerminalInstance, profile: ITerminalProfile, cwd?: string | URI): ITerminalInstance | null
	splitInstance(instanceToSplit: ITerminalInstance, shellLaunchConfigOrProfile: IShellLaunchConfig | ITerminalProfile = {}, cwd?: string | URI): ITerminalInstance | null {
		const group = this.getGroupForInstance(instanceToSplit);
		if (!group) {
			return null;
		}
		const shellLaunchConfig = this._convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile, cwd);
		const instance = group.split(shellLaunchConfig);

		this._initInstanceListeners(instance);
		this._onInstancesChanged.fire();

		this._terminalGroups.forEach((g, i) => g.setVisible(i === this._activeGroupIndex));
		return instance;
	}

	protected _initInstanceListeners(instance: ITerminalInstance): void {
		instance.addDisposable(instance.onDisposed(this._onInstanceDisposed.fire, this._onInstanceDisposed));
		instance.addDisposable(instance.onTitleChanged(this._onInstanceTitleChanged.fire, this._onInstanceTitleChanged));
		instance.addDisposable(instance.onIconChanged(this._onInstanceIconChanged.fire, this._onInstanceIconChanged));
		instance.addDisposable(instance.onProcessIdReady(this._onInstanceProcessIdReady.fire, this._onInstanceProcessIdReady));
		instance.addDisposable(instance.statusList.onDidChangePrimaryStatus(() => this._onInstancePrimaryStatusChanged.fire(instance)));
		instance.addDisposable(instance.onLinksReady(this._onInstanceLinksReady.fire, this._onInstanceLinksReady));
		instance.addDisposable(instance.onDimensionsChanged(() => {
			this._onInstanceDimensionsChanged.fire(instance);
			if (this.configHelper.config.enablePersistentSessions && this.isProcessSupportRegistered) {
				this._saveState(!!this._environmentService.remoteAuthority);
			}
		}));
		instance.addDisposable(instance.onMaximumDimensionsChanged(() => this._onInstanceMaximumDimensionsChanged.fire(instance)));
		instance.addDisposable(instance.onFocus(this._onActiveInstanceChanged.fire, this._onActiveInstanceChanged));
		instance.addDisposable(instance.onDropped(async (e) => {
			const dragEvent = e.dragEvent;
			if (!dragEvent.dataTransfer) {
				return;
			}

			// Check if files were dragged from the tree explorer
			let path: string | undefined;
			const resources = dragEvent.dataTransfer.getData(DataTransfers.RESOURCES);
			if (resources) {
				path = URI.parse(JSON.parse(resources)[0]).fsPath;
			} else if (dragEvent.dataTransfer.files?.[0].path /* Electron only */) {
				// Check if the file was dragged from the filesystem
				path = URI.file(dragEvent.dataTransfer.files[0].path).fsPath;
			}

			if (!path) {
				return;
			}

			const instance = e.instance;
			if (!instance.shellLaunchConfig.executable) {
				return;
			}
			const preparedPath = await this.preparePathForTerminalAsync(path, instance.shellLaunchConfig.executable, instance.title, instance.shellType, instance.isRemote);

			instance.sendText(preparedPath, false);
			instance.focus();
		}));
	}

	registerProcessSupport(isSupported: boolean): void {
		if (!isSupported) {
			return;
		}
		this._processSupportContextKey.set(isSupported);
		this._onDidRegisterProcessSupport.fire();
	}

	registerLinkProvider(linkProvider: ITerminalExternalLinkProvider): IDisposable {
		const disposables: IDisposable[] = [];
		this._linkProviders.add(linkProvider);
		for (const instance of this.terminalInstances) {
			if (instance.areLinksReady) {
				disposables.push(instance.registerLinkProvider(linkProvider));
			}
		}
		this._linkProviderDisposables.set(linkProvider, disposables);
		return {
			dispose: () => {
				const disposables = this._linkProviderDisposables.get(linkProvider) || [];
				for (const disposable of disposables) {
					disposable.dispose();
				}
				this._linkProviders.delete(linkProvider);
			}
		};
	}

	private _setInstanceLinkProviders(instance: ITerminalInstance): void {
		for (const linkProvider of this._linkProviders) {
			const disposables = this._linkProviderDisposables.get(linkProvider);
			const provider = instance.registerLinkProvider(linkProvider);
			disposables?.push(provider);
		}
	}

	getGroupForInstance(instance: ITerminalInstance): ITerminalGroup | undefined {
		return this._terminalGroups.find(group => group.terminalInstances.indexOf(instance) !== -1);
	}

	async showPanel(focus?: boolean): Promise<void> {
		const pane = this._viewsService.getActiveViewWithId(TERMINAL_VIEW_ID) as TerminalViewPane;
		if (!pane) {
			await this._viewsService.openView(TERMINAL_VIEW_ID, focus);
		}
		if (focus) {
			// Do the focus call asynchronously as going through the
			// command palette will force editor focus
			await timeout(0);
			const instance = this.getActiveInstance();
			if (instance) {
				await instance.focusWhenReady(true);
			}
		}
	}

	async focusTabs(): Promise<void> {
		await this.showPanel(true);
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		pane?.terminalTabbedView?.focusTabs();
	}

	showTabs() {
		this._configurationService.updateValue(TerminalSettingId.TabsEnabled, true);
	}

	private _getIndexFromId(terminalId: number): number {
		let terminalIndex = -1;
		this.terminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.instanceId === terminalId) {
				terminalIndex = i;
			}
		});
		if (terminalIndex === -1) {
			throw new Error(`Terminal with ID ${terminalId} does not exist (has it already been disposed?)`);
		}
		return terminalIndex;
	}

	protected async _showTerminalCloseConfirmation(): Promise<boolean> {
		let message: string;
		if (this.terminalInstances.length === 1) {
			message = nls.localize('terminalService.terminalCloseConfirmationSingular', "There is an active terminal session, do you want to kill it?");
		} else {
			message = nls.localize('terminalService.terminalCloseConfirmationPlural', "There are {0} active terminal sessions, do you want to kill them?", this.terminalInstances.length);
		}
		const res = await this._dialogService.confirm({
			message,
			type: 'warning',
		});
		return !res.confirmed;
	}

	preparePathForTerminalAsync(originalPath: string, executable: string, title: string, shellType: TerminalShellType, isRemote: boolean): Promise<string> {
		return new Promise<string>(c => {
			if (!executable) {
				c(originalPath);
				return;
			}

			const hasSpace = originalPath.indexOf(' ') !== -1;
			const hasParens = originalPath.indexOf('(') !== -1 || originalPath.indexOf(')') !== -1;

			const pathBasename = basename(executable, '.exe');
			const isPowerShell = pathBasename === 'pwsh' ||
				title === 'pwsh' ||
				pathBasename === 'powershell' ||
				title === 'powershell';

			if (isPowerShell && (hasSpace || originalPath.indexOf('\'') !== -1)) {
				c(`& '${originalPath.replace(/'/g, '\'\'')}'`);
				return;
			}

			if (hasParens && isPowerShell) {
				c(`& '${originalPath}'`);
				return;
			}

			if (isWindows) {
				// 17063 is the build number where wsl path was introduced.
				// Update Windows uriPath to be executed in WSL.
				if (shellType !== undefined) {
					if (shellType === WindowsShellType.GitBash) {
						c(originalPath.replace(/\\/g, '/'));
					}
					else if (shellType === WindowsShellType.Wsl) {
						const offProcService = isRemote ? this._remoteTerminalService : this._localTerminalService;
						c(offProcService?.getWslPath(originalPath) || originalPath);
					}

					else if (hasSpace) {
						c('"' + originalPath + '"');
					} else {
						c(originalPath);
					}
				} else {
					const lowerExecutable = executable.toLowerCase();
					if (lowerExecutable.indexOf('wsl') !== -1 || (lowerExecutable.indexOf('bash.exe') !== -1 && lowerExecutable.toLowerCase().indexOf('git') === -1)) {
						const offProcService = isRemote ? this._remoteTerminalService : this._localTerminalService;
						c(offProcService?.getWslPath(originalPath) || originalPath);
					} else if (hasSpace) {
						c('"' + originalPath + '"');
					} else {
						c(originalPath);
					}
				}

				return;
			}

			c(escapeNonWindowsPath(originalPath));
		});
	}

	private async _getPlatformKey(): Promise<string> {
		const env = await this._remoteAgentService.getEnvironment();
		if (env) {
			return env.os === OperatingSystem.Windows ? 'windows' : (env.os === OperatingSystem.Macintosh ? 'osx' : 'linux');
		}
		return isWindows ? 'windows' : (isMacintosh ? 'osx' : 'linux');
	}

	async showProfileQuickPick(type: 'setDefault' | 'createInstance', cwd?: string | URI): Promise<ITerminalInstance | undefined> {
		let keyMods: IKeyMods | undefined;
		const profiles = await this._detectProfiles(false);
		const platformKey = await this._getPlatformKey();

		const options: IPickOptions<IProfileQuickPickItem> = {
			placeHolder: type === 'createInstance' ? nls.localize('terminal.integrated.selectProfileToCreate', "Select the terminal profile to create") : nls.localize('terminal.integrated.chooseDefaultProfile', "Select your default terminal profile"),
			onDidTriggerItemButton: async (context) => {
				if ('command' in context.item.profile) {
					return;
				}
				const configKey = `terminal.integrated.profiles.${platformKey}`;
				const configProfiles = this._configurationService.getValue<{ [key: string]: ITerminalProfileObject }>(configKey);
				const existingProfiles = configProfiles ? Object.keys(configProfiles) : [];
				const name = await this._quickInputService.input({
					prompt: nls.localize('enterTerminalProfileName', "Enter terminal profile name"),
					value: context.item.profile.profileName,
					validateInput: async input => {
						if (existingProfiles.includes(input)) {
							return nls.localize('terminalProfileAlreadyExists', "A terminal profile already exists with that name");
						}
						return undefined;
					}
				});
				if (!name) {
					return;
				}
				const newConfigValue: { [key: string]: ITerminalProfileObject } = { ...configProfiles } ?? {};
				newConfigValue[name] = {
					path: context.item.profile.path,
					args: context.item.profile.args
				};
				await this._configurationService.updateValue(configKey, newConfigValue, ConfigurationTarget.USER);
			},
			onKeyMods: mods => keyMods = mods
		};

		// Build quick pick items
		const quickPickItems: (IProfileQuickPickItem | IQuickPickSeparator)[] = [];
		const configProfiles = profiles.filter(e => !e.isAutoDetected);
		const autoDetectedProfiles = profiles.filter(e => e.isAutoDetected);
		if (configProfiles.length > 0) {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles', "profiles") });
			quickPickItems.push(...configProfiles.map(e => this._createProfileQuickPickItem(e)));
		}
		// Add contributed profiles, these cannot be defaults
		if (type === 'createInstance') {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles.contributed', "contributed") });
			for (const contributed of this._terminalContributionService.terminalTypes) {
				const icon = contributed.icon ? (iconRegistry.get(contributed.icon) || Codicon.terminal) : Codicon.terminal;
				quickPickItems.push({
					label: `$(${icon.id}) ${contributed.title}`,
					profile: contributed
				});
			}
		}
		if (autoDetectedProfiles.length > 0) {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles.detected', "detected") });
			quickPickItems.push(...autoDetectedProfiles.map(e => this._createProfileQuickPickItem(e)));
		}

		const value = await this._quickInputService.pick(quickPickItems, options);
		if (!value) {
			return;
		}
		if (type === 'createInstance') {
			// TODO: How to support alt here?
			if ('command' in value.profile) {
				return this._commandService.executeCommand(value.profile.command);
			}

			let instance;
			const activeInstance = this.getActiveInstance();
			if (keyMods?.alt && activeInstance) {
				// create split, only valid if there's an active instance
				if (activeInstance) {
					instance = this.splitInstance(activeInstance, value.profile, cwd);
				}
			} else {
				instance = this.createTerminal(value.profile, cwd);
			}
			if (instance) {
				this.showPanel(true);
				this.setActiveInstance(instance);
				return instance;
			}
		} else { // setDefault
			if ('command' in value.profile) {
				return; // Should never happen
			}
			// Add the profile to settings if necessary
			if (value.profile.isAutoDetected) {
				const profilesConfig = await this._configurationService.getValue(`terminal.integrated.profiles.${platformKey}`);
				if (typeof profilesConfig === 'object') {
					const newProfile: ITerminalProfileObject = {
						path: value.profile.path
					};
					if (value.profile.args) {
						newProfile.args = value.profile.args;
					}
					(profilesConfig as { [key: string]: ITerminalProfileObject })[value.profile.profileName] = newProfile;
				}
				await this._configurationService.updateValue(`terminal.integrated.profiles.${platformKey}`, profilesConfig, ConfigurationTarget.USER);
			}
			// Set the default profile
			await this._configurationService.updateValue(`terminal.integrated.defaultProfile.${platformKey}`, value.profile.profileName, ConfigurationTarget.USER);
		}
		return undefined;
	}

	private _createProfileQuickPickItem(profile: ITerminalProfile): IProfileQuickPickItem {
		const buttons: IQuickInputButton[] = [{
			iconClass: ThemeIcon.asClassName(configureTerminalProfileIcon),
			tooltip: nls.localize('createQuickLaunchProfile', "Configure Terminal Profile")
		}];
		const icon = profile.icon ? (iconRegistry.get(profile.icon) || Codicon.terminal) : Codicon.terminal;
		const label = `$(${icon.id}) ${profile.profileName}`;
		if (profile.args) {
			if (typeof profile.args === 'string') {
				return { label, description: `${profile.path} ${profile.args}`, profile, buttons };
			}
			const argsString = profile.args.map(e => {
				if (e.includes(' ')) {
					return `"${e.replace('/"/g', '\\"')}"`;
				}
				return e;
			}).join(' ');
			return { label, description: `${profile.path} ${argsString}`, profile, buttons };
		}
		return { label, description: profile.path, profile, buttons };
	}

	createInstance(container: HTMLElement | undefined, shellLaunchConfig: IShellLaunchConfig): ITerminalInstance {
		const instance = this._instantiationService.createInstance(TerminalInstance,
			this._terminalFocusContextKey,
			this._terminalShellTypeContextKey,
			this._terminalAltBufferActiveContextKey,
			this._configHelper,
			container,
			shellLaunchConfig
		);
		this._onInstanceCreated.fire(instance);
		return instance;
	}

	private _convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile?: IShellLaunchConfig | ITerminalProfile, cwd?: string | URI): IShellLaunchConfig {
		// Profile was provided
		if (shellLaunchConfigOrProfile && 'profileName' in shellLaunchConfigOrProfile) {
			const profile = shellLaunchConfigOrProfile;
			return {
				executable: profile.path,
				args: profile.args,
				env: profile.env,
				icon: profile.icon,
				name: profile.overrideName ? profile.profileName : undefined,
				cwd
			};
		}

		// Shell launch config was provided
		if (shellLaunchConfigOrProfile) {
			if (cwd) {
				shellLaunchConfigOrProfile.cwd = cwd;
			}
			return shellLaunchConfigOrProfile;
		}

		// Return empty shell launch config
		return {};
	}

	createTerminal(shellLaunchConfig?: IShellLaunchConfig): ITerminalInstance;
	createTerminal(profile: ITerminalProfile, cwd?: string | URI): ITerminalInstance;
	createTerminal(shellLaunchConfigOrProfile: IShellLaunchConfig | ITerminalProfile, cwd?: string | URI): ITerminalInstance {
		const shellLaunchConfig = this._convertProfileToShellLaunchConfig(shellLaunchConfigOrProfile);

		if (cwd) {
			shellLaunchConfig.cwd = cwd;
		}

		if (!shellLaunchConfig.customPtyImplementation && !this.isProcessSupportRegistered) {
			throw new Error('Could not create terminal when process support is not registered');
		}
		if (shellLaunchConfig.hideFromUser) {
			const instance = this.createInstance(undefined, shellLaunchConfig);
			this._backgroundedTerminalInstances.push(instance);
			this._initInstanceListeners(instance);
			return instance;
		}

		// Add welcome message and title annotation for local terminals launched within remote or
		// virtual workspaces
		const isRemoteWorkspace = !!VirtualWorkspaceContext.getValue(this._contextKeyService) ||
			this._remoteAgentService.getConnection() && (typeof shellLaunchConfig.cwd === 'string' || shellLaunchConfig.cwd?.scheme === Schemas.file);
		if (isRemoteWorkspace) {
			shellLaunchConfig.initialText = formatMessageForTerminal(nls.localize('localTerminal', "Warning: This shell is running on your local machine"), true);
			shellLaunchConfig.description = nls.localize('localTerminalDescription', "Local");
		}

		const terminalGroup = this._instantiationService.createInstance(TerminalGroup, this._terminalContainer, shellLaunchConfig);
		this._terminalGroups.push(terminalGroup);
		terminalGroup.onPanelMovedToSide(() => this._onPanelMovedToSide.fire());

		const instance = terminalGroup.terminalInstances[0];

		terminalGroup.addDisposable(terminalGroup.onDisposed(this._onTabDisposed.fire, this._onTabDisposed));
		terminalGroup.addDisposable(terminalGroup.onInstancesChanged(this._onInstancesChanged.fire, this._onInstancesChanged));
		this._initInstanceListeners(instance);
		this._onInstancesChanged.fire();
		if (this.terminalInstances.length === 1) {
			// It's the first instance so it should be made active automatically, this must fire
			// after onInstancesChanged so consumers can react to the instance being added first
			this.setActiveInstanceByIndex(0);
		}
		return instance;
	}

	protected _showBackgroundTerminal(instance: ITerminalInstance): void {
		this._backgroundedTerminalInstances.splice(this._backgroundedTerminalInstances.indexOf(instance), 1);
		instance.shellLaunchConfig.hideFromUser = false;
		const terminalGroup = this._instantiationService.createInstance(TerminalGroup, this._terminalContainer, instance);
		this._terminalGroups.push(terminalGroup);
		terminalGroup.addDisposable(terminalGroup.onDisposed(this._onTabDisposed.fire, this._onTabDisposed));
		terminalGroup.addDisposable(terminalGroup.onInstancesChanged(this._onInstancesChanged.fire, this._onInstancesChanged));
		if (this.terminalInstances.length === 1) {
			// It's the first instance so it should be made active automatically
			this.setActiveInstanceByIndex(0);
		}
		this._onInstancesChanged.fire();
	}

	async focusFindWidget(): Promise<void> {
		await this.showPanel(false);
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		pane?.terminalTabbedView?.focusFindWidget();
	}

	hideFindWidget(): void {
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		pane?.terminalTabbedView?.hideFindWidget();
	}

	findNext(): void {
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		if (pane?.terminalTabbedView) {
			pane.terminalTabbedView.showFindWidget();
			pane.terminalTabbedView.getFindWidget().find(false);
		}
	}

	findPrevious(): void {
		const pane = this._viewsService.getActiveViewWithId<TerminalViewPane>(TERMINAL_VIEW_ID);
		if (pane?.terminalTabbedView) {
			pane.terminalTabbedView.showFindWidget();
			pane.terminalTabbedView.getFindWidget().find(true);
		}
	}

	async setContainers(panelContainer: HTMLElement, terminalContainer: HTMLElement): Promise<void> {
		this._configHelper.panelContainer = panelContainer;
		this._terminalContainer = terminalContainer;
		this._terminalGroups.forEach(group => group.attachToElement(terminalContainer));
	}

	hidePanel(): void {
		// Hide the panel if the terminal is in the panel and it has no sibling views
		const location = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID);
		if (location === ViewContainerLocation.Panel) {
			const panel = this._viewDescriptorService.getViewContainerByViewId(TERMINAL_VIEW_ID);
			if (panel && this._viewDescriptorService.getViewContainerModel(panel).activeViewDescriptors.length === 1) {
				this._layoutService.setPanelHidden(true);
			}
		}
	}
}

interface IProfileQuickPickItem extends IQuickPickItem {
	profile: ITerminalProfile | ITerminalTypeContribution;
}
