/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from 'vs/nls';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Extensions, IViewContainersRegistry, IViewsRegistry, IViewsService, ViewContainer, ViewContainerLocation } from 'vs/workbench/common/views';
import { IRemoteExplorerService, makeAddress, mapHasAddressLocalhostOrAllInterfaces, OnPortForward, PORT_AUTO_FORWARD_SETTING, PORT_AUTO_SOURCE_SETTING, PORT_AUTO_SOURCE_SETTING_OUTPUT, PORT_AUTO_SOURCE_SETTING_PROCESS, TUNNEL_VIEW_CONTAINER_ID, TUNNEL_VIEW_ID } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { forwardedPortsViewEnabled, ForwardPortAction, OpenPortInBrowserAction, TunnelPanel, TunnelPanelDescriptor, TunnelViewModel, OpenPortInPreviewAction } from 'vs/workbench/contrib/remote/browser/tunnelView';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from 'vs/workbench/services/statusbar/common/statusbar';
import { UrlFinder } from 'vs/workbench/contrib/remote/browser/urlFinder';
import Severity from 'vs/base/common/severity';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { INotificationHandle, INotificationService, IPromptChoice } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IDebugService } from 'vs/workbench/contrib/debug/common/debug';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { isWeb, OperatingSystem } from 'vs/base/common/platform';
import { isPortPrivileged, ITunnelService, RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { portsViewIcon } from 'vs/workbench/contrib/remote/browser/remoteIcons';
import { Event } from 'vs/base/common/event';
import { IExternalUriOpenerService } from 'vs/workbench/contrib/externalUriOpener/common/externalUriOpenerService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { ILogService } from 'vs/platform/log/common/log';

export const VIEWLET_ID = 'workbench.view.remote';

export class ForwardedPortsView extends Disposable implements IWorkbenchContribution {
	private contextKeyListener?: IDisposable;
	private _activityBadge?: IDisposable;
	private entryAccessor: IStatusbarEntryAccessor | undefined;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@IActivityService private readonly activityService: IActivityService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();
		this._register(Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViewWelcomeContent(TUNNEL_VIEW_ID, {
			content: `No forwarded ports. Forward a port to access your running services locally.\n[Forward a Port](command:${ForwardPortAction.INLINE_ID})`,
		}));
		this.enableBadgeAndStatusBar();
		this.enableForwardedPortsView();
	}

	private async getViewContainer(): Promise<ViewContainer | null> {
		return Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer({
			id: TUNNEL_VIEW_CONTAINER_ID,
			title: nls.localize('ports', "Ports"),
			icon: portsViewIcon,
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [TUNNEL_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
			storageId: TUNNEL_VIEW_CONTAINER_ID,
			hideIfEmpty: true,
			order: 5
		}, ViewContainerLocation.Panel);
	}

	private async enableForwardedPortsView() {
		if (this.contextKeyListener) {
			this.contextKeyListener.dispose();
			this.contextKeyListener = undefined;
		}

		const viewEnabled: boolean = !!forwardedPortsViewEnabled.getValue(this.contextKeyService);

		if (this.environmentService.remoteAuthority && viewEnabled) {
			const viewContainer = await this.getViewContainer();
			const tunnelPanelDescriptor = new TunnelPanelDescriptor(new TunnelViewModel(this.remoteExplorerService), this.environmentService);
			const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
			if (viewContainer) {
				this.remoteExplorerService.enablePortsFeatures();
				viewsRegistry.registerViews([tunnelPanelDescriptor!], viewContainer);
			}
		} else if (this.environmentService.remoteAuthority) {
			this.contextKeyListener = this.contextKeyService.onDidChangeContext(e => {
				if (e.affectsSome(new Set(forwardedPortsViewEnabled.keys()))) {
					this.enableForwardedPortsView();
				}
			});
		}
	}

	private enableBadgeAndStatusBar() {
		const disposable = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).onViewsRegistered(e => {
			if (e.find(view => view.views.find(viewDescriptor => viewDescriptor.id === TUNNEL_VIEW_ID))) {
				this._register(Event.debounce(this.remoteExplorerService.tunnelModel.onForwardPort, (_last, e) => e, 50)(() => {
					this.updateActivityBadge();
					this.updateStatusBar();
				}));
				this._register(Event.debounce(this.remoteExplorerService.tunnelModel.onClosePort, (_last, e) => e, 50)(() => {
					this.updateActivityBadge();
					this.updateStatusBar();
				}));

				this.updateActivityBadge();
				this.updateStatusBar();
				disposable.dispose();
			}
		});
	}

	private async updateActivityBadge() {
		if (this._activityBadge) {
			this._activityBadge.dispose();
		}
		if (this.remoteExplorerService.tunnelModel.forwarded.size > 0) {
			this._activityBadge = this.activityService.showViewActivity(TUNNEL_VIEW_ID, {
				badge: new NumberBadge(this.remoteExplorerService.tunnelModel.forwarded.size, n => n === 1 ? nls.localize('1forwardedPort', "1 forwarded port") : nls.localize('nForwardedPorts', "{0} forwarded ports", n))
			});
		}
	}

	private updateStatusBar() {
		if (!this.entryAccessor) {
			this._register(this.entryAccessor = this.statusbarService.addEntry(this.entry, 'status.forwardedPorts', nls.localize('status.forwardedPorts', "Forwarded Ports"), StatusbarAlignment.LEFT, 40));
		} else {
			this.entryAccessor.update(this.entry);
		}
	}

	private get entry(): IStatusbarEntry {
		let text: string;
		let tooltip: string;
		const count = this.remoteExplorerService.tunnelModel.forwarded.size + this.remoteExplorerService.tunnelModel.detected.size;
		text = `${count}`;
		if (count === 0) {
			tooltip = nls.localize('remote.forwardedPorts.statusbarTextNone', "No Ports Forwarded");
		} else {
			const allTunnels = Array.from(this.remoteExplorerService.tunnelModel.forwarded.values());
			allTunnels.push(...Array.from(this.remoteExplorerService.tunnelModel.detected.values()));
			tooltip = nls.localize('remote.forwardedPorts.statusbarTooltip', "Forwarded Ports: {0}",
				allTunnels.map(forwarded => forwarded.remotePort).join(', '));
		}
		return {
			text: `$(radio-tower) ${text}`,
			ariaLabel: tooltip,
			tooltip,
			command: `${TUNNEL_VIEW_ID}.focus`
		};
	}
}

export class PortRestore implements IWorkbenchContribution {
	constructor(
		@IRemoteExplorerService readonly remoteExplorerService: IRemoteExplorerService,
		@ILogService readonly logService: ILogService
	) {
		if (!this.remoteExplorerService.tunnelModel.environmentTunnelsSet) {
			Event.once(this.remoteExplorerService.tunnelModel.onEnvironmentTunnelsSet)(async () => {
				await this.restore();
			});
		} else {
			this.restore();
		}
	}

	private async restore() {
		this.logService.trace('ForwardedPorts: Doing first restore.');
		return this.remoteExplorerService.restore();
	}
}


export class AutomaticPortForwarding extends Disposable implements IWorkbenchContribution {

	constructor(
		@ITerminalService readonly terminalService: ITerminalService,
		@INotificationService readonly notificationService: INotificationService,
		@IOpenerService readonly openerService: IOpenerService,
		@IExternalUriOpenerService readonly externalOpenerService: IExternalUriOpenerService,
		@IViewsService readonly viewsService: IViewsService,
		@IRemoteExplorerService readonly remoteExplorerService: IRemoteExplorerService,
		@IWorkbenchEnvironmentService readonly environmentService: IWorkbenchEnvironmentService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@IConfigurationService readonly configurationService: IConfigurationService,
		@IDebugService readonly debugService: IDebugService,
		@IRemoteAgentService readonly remoteAgentService: IRemoteAgentService,
		@ITunnelService readonly tunnelService: ITunnelService,
		@IHostService readonly hostService: IHostService,
		@ILogService readonly logService: ILogService
	) {
		super();
		if (!this.environmentService.remoteAuthority) {
			return;
		}

		remoteAgentService.getEnvironment().then(environment => {
			if (environment?.os !== OperatingSystem.Linux) {
				Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
					.registerDefaultConfigurations([{ 'remote.autoForwardPortsSource': PORT_AUTO_SOURCE_SETTING_OUTPUT }]);
				this._register(new OutputAutomaticPortForwarding(terminalService, notificationService, openerService, externalOpenerService,
					remoteExplorerService, configurationService, debugService, tunnelService, remoteAgentService, hostService, logService, () => false));
			} else {
				const useProc = () => (this.configurationService.getValue(PORT_AUTO_SOURCE_SETTING) === PORT_AUTO_SOURCE_SETTING_PROCESS);
				if (useProc()) {
					this._register(new ProcAutomaticPortForwarding(configurationService, remoteExplorerService, notificationService,
						openerService, externalOpenerService, tunnelService, hostService, logService));
				}
				this._register(new OutputAutomaticPortForwarding(terminalService, notificationService, openerService, externalOpenerService,
					remoteExplorerService, configurationService, debugService, tunnelService, remoteAgentService, hostService, logService, useProc));
			}
		});
	}
}

class OnAutoForwardedAction extends Disposable {
	private lastNotifyTime: Date;
	private static NOTIFY_COOL_DOWN = 5000; // milliseconds
	private lastNotification: INotificationHandle | undefined;
	private lastShownPort: number | undefined;
	private doActionTunnels: RemoteTunnel[] | undefined;

	constructor(private readonly notificationService: INotificationService,
		private readonly remoteExplorerService: IRemoteExplorerService,
		private readonly openerService: IOpenerService,
		private readonly externalOpenerService: IExternalUriOpenerService,
		private readonly tunnelService: ITunnelService,
		private readonly hostService: IHostService,
		private readonly logService: ILogService) {
		super();
		this.lastNotifyTime = new Date();
		this.lastNotifyTime.setFullYear(this.lastNotifyTime.getFullYear() - 1);
	}

	public async doAction(tunnels: RemoteTunnel[]): Promise<void> {
		this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) Starting action for ${tunnels[0]?.tunnelRemotePort}`);
		this.doActionTunnels = tunnels;
		const tunnel = await this.portNumberHeuristicDelay();
		this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) Heuristic chose ${tunnel?.tunnelRemotePort}`);
		if (tunnel) {
			const attributes = (await this.remoteExplorerService.tunnelModel.getAttributes([tunnel.tunnelRemotePort]))?.get(tunnel.tunnelRemotePort)?.onAutoForward;
			this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) onAutoForward action is ${attributes}`);
			switch (attributes) {
				case OnPortForward.OpenBrowser: {
					const address = makeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
					await OpenPortInBrowserAction.run(this.remoteExplorerService.tunnelModel, this.openerService, address);
					break;
				}
				case OnPortForward.OpenPreview: {
					const address = makeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
					await OpenPortInPreviewAction.run(this.remoteExplorerService.tunnelModel, this.openerService, this.externalOpenerService, address);
					break;
				}
				case OnPortForward.Silent: break;
				default:
					const elapsed = new Date().getTime() - this.lastNotifyTime.getTime();
					this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) time elapsed since last notification ${elapsed} ms`);
					if (elapsed > OnAutoForwardedAction.NOTIFY_COOL_DOWN) {
						await this.showNotification(tunnel);
					}
			}
		}
	}

	public hide(removedPorts: number[]) {
		if (this.doActionTunnels) {
			this.doActionTunnels = this.doActionTunnels.filter(value => !removedPorts.includes(value.tunnelRemotePort));
		}
		if (this.lastShownPort && removedPorts.indexOf(this.lastShownPort) >= 0) {
			this.lastNotification?.close();
		}
	}

	private newerTunnel: RemoteTunnel | undefined;
	private async portNumberHeuristicDelay(): Promise<RemoteTunnel | undefined> {
		this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) Starting heuristic delay`);
		if (!this.doActionTunnels || this.doActionTunnels.length === 0) {
			return;
		}
		this.doActionTunnels = this.doActionTunnels.sort((a, b) => a.tunnelRemotePort - b.tunnelRemotePort);
		const firstTunnel = this.doActionTunnels.shift()!;
		// Heuristic.
		if (firstTunnel.tunnelRemotePort % 1000 === 0) {
			this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) Heuristic chose tunnel because % 1000: ${firstTunnel.tunnelRemotePort}`);
			this.newerTunnel = firstTunnel;
			return firstTunnel;
			// 9229 is the node inspect port
		} else if (firstTunnel.tunnelRemotePort < 10000 && firstTunnel.tunnelRemotePort !== 9229) {
			this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) Heuristic chose tunnel because < 10000: ${firstTunnel.tunnelRemotePort}`);
			this.newerTunnel = firstTunnel;
			return firstTunnel;
		}

		this.logService.trace(`ForwardedPorts: (OnAutoForwardedAction) Waiting for "better" tunnel than ${firstTunnel.tunnelRemotePort}`);
		this.newerTunnel = undefined;
		return new Promise(resolve => {
			setTimeout(() => {
				if (this.newerTunnel) {
					resolve(undefined);
				} else if (this.doActionTunnels?.includes(firstTunnel)) {
					resolve(firstTunnel);
				} else {
					resolve(undefined);
				}
			}, 3000);
		});
	}

	private basicMessage(tunnel: RemoteTunnel) {
		return nls.localize('remote.tunnelsView.automaticForward', "Your application running on port {0} is available.  ",
			tunnel.tunnelRemotePort);
	}

	private linkMessage() {
		return nls.localize('remote.tunnelsView.notificationLink', "[See all forwarded ports](command:{0}.focus)", TunnelPanel.ID);
	}

	private async showNotification(tunnel: RemoteTunnel) {
		if (!await this.hostService.hadLastFocus()) {
			return;
		}

		if (this.lastNotification) {
			this.lastNotification.close();
		}
		let message = this.basicMessage(tunnel);
		const choices = [this.openBrowserChoice(tunnel)];
		if (!isWeb) {
			choices.push(this.openPreviewChoice(tunnel));
		}

		if ((tunnel.tunnelLocalPort !== tunnel.tunnelRemotePort) && this.tunnelService.canElevate && isPortPrivileged(tunnel.tunnelRemotePort)) {
			// Privileged ports are not on Windows, so it's safe to use "superuser"
			message += nls.localize('remote.tunnelsView.elevationMessage', "You'll need to run as superuser to use port {0} locally.  ", tunnel.tunnelRemotePort);
			choices.unshift(this.elevateChoice(tunnel));
		}

		message += this.linkMessage();

		this.lastNotification = this.notificationService.prompt(Severity.Info, message, choices, { neverShowAgain: { id: 'remote.tunnelsView.autoForwardNeverShow', isSecondary: true } });
		this.lastShownPort = tunnel.tunnelRemotePort;
		this.lastNotifyTime = new Date();
		this.lastNotification.onDidClose(() => {
			this.lastNotification = undefined;
			this.lastShownPort = undefined;
		});
	}

	private openBrowserChoice(tunnel: RemoteTunnel): IPromptChoice {
		const address = makeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
		return {
			label: OpenPortInBrowserAction.LABEL,
			run: () => OpenPortInBrowserAction.run(this.remoteExplorerService.tunnelModel, this.openerService, address)
		};
	}

	private openPreviewChoice(tunnel: RemoteTunnel): IPromptChoice {
		const address = makeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
		return {
			label: OpenPortInPreviewAction.LABEL,
			run: () => OpenPortInPreviewAction.run(this.remoteExplorerService.tunnelModel, this.openerService, this.externalOpenerService, address)
		};
	}

	private elevateChoice(tunnel: RemoteTunnel): IPromptChoice {
		return {
			// Privileged ports are not on Windows, so it's ok to stick to just "sudo".
			label: nls.localize('remote.tunnelsView.elevationButton', "Use Port {0} as Sudo...", tunnel.tunnelRemotePort),
			run: async () => {
				await this.remoteExplorerService.close({ host: tunnel.tunnelRemoteHost, port: tunnel.tunnelRemotePort });
				const newTunnel = await this.remoteExplorerService.forward({ host: tunnel.tunnelRemoteHost, port: tunnel.tunnelRemotePort }, tunnel.tunnelRemotePort, undefined, undefined, true, undefined, false);
				if (!newTunnel) {
					return;
				}
				if (this.lastNotification) {
					this.lastNotification.close();
				}
				this.lastShownPort = newTunnel.tunnelRemotePort;
				this.lastNotification = this.notificationService.prompt(Severity.Info,
					this.basicMessage(newTunnel) + this.linkMessage(),
					[this.openBrowserChoice(newTunnel), this.openPreviewChoice(tunnel)],
					{ neverShowAgain: { id: 'remote.tunnelsView.autoForwardNeverShow', isSecondary: true } });
				this.lastNotification.onDidClose(() => {
					this.lastNotification = undefined;
					this.lastShownPort = undefined;
				});
			}
		};
	}
}

class OutputAutomaticPortForwarding extends Disposable {
	private portsFeatures?: IDisposable;
	private urlFinder?: UrlFinder;
	private notifier: OnAutoForwardedAction;

	constructor(
		private readonly terminalService: ITerminalService,
		readonly notificationService: INotificationService,
		readonly openerService: IOpenerService,
		readonly externalOpenerService: IExternalUriOpenerService,
		private readonly remoteExplorerService: IRemoteExplorerService,
		private readonly configurationService: IConfigurationService,
		private readonly debugService: IDebugService,
		readonly tunnelService: ITunnelService,
		private readonly remoteAgentService: IRemoteAgentService,
		readonly hostService: IHostService,
		readonly logService: ILogService,
		readonly privilegedOnly: () => boolean
	) {
		super();
		this.notifier = new OnAutoForwardedAction(notificationService, remoteExplorerService, openerService, externalOpenerService, tunnelService, hostService, logService);
		this._register(configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(PORT_AUTO_FORWARD_SETTING)) {
				this.tryStartStopUrlFinder();
			}
		}));

		this.portsFeatures = this._register(this.remoteExplorerService.onEnabledPortsFeatures(() => {
			this.tryStartStopUrlFinder();
		}));
		this.tryStartStopUrlFinder();
	}

	private tryStartStopUrlFinder() {
		if (this.configurationService.getValue(PORT_AUTO_FORWARD_SETTING)) {
			this.startUrlFinder();
		} else {
			this.stopUrlFinder();
		}
	}

	private startUrlFinder() {
		if (!this.urlFinder && !this.remoteExplorerService.portsFeaturesEnabled) {
			return;
		}
		if (this.portsFeatures) {
			this.portsFeatures.dispose();
		}
		this.urlFinder = this._register(new UrlFinder(this.terminalService, this.debugService));
		this._register(this.urlFinder.onDidMatchLocalUrl(async (localUrl) => {
			if (mapHasAddressLocalhostOrAllInterfaces(this.remoteExplorerService.tunnelModel.detected, localUrl.host, localUrl.port)) {
				return;
			}
			if ((await this.remoteExplorerService.tunnelModel.getAttributes([localUrl.port]))?.get(localUrl.port)?.onAutoForward === OnPortForward.Ignore) {
				return;
			}
			if (this.privilegedOnly() && !isPortPrivileged(localUrl.port, (await this.remoteAgentService.getEnvironment())?.os)) {
				return;
			}
			const forwarded = await this.remoteExplorerService.forward(localUrl, undefined, undefined, undefined, undefined, undefined, false);
			if (forwarded) {
				this.notifier.doAction([forwarded]);
			}
		}));
	}

	private stopUrlFinder() {
		if (this.urlFinder) {
			this.urlFinder.dispose();
			this.urlFinder = undefined;
		}
	}
}

class ProcAutomaticPortForwarding extends Disposable {
	private candidateListener: IDisposable | undefined;
	private autoForwarded: Set<string> = new Set();
	private notifiedOnly: Set<string> = new Set();
	private notifier: OnAutoForwardedAction;
	private initialCandidates: Set<string> = new Set();
	private portsFeatures: IDisposable | undefined;

	constructor(
		private readonly configurationService: IConfigurationService,
		readonly remoteExplorerService: IRemoteExplorerService,
		readonly notificationService: INotificationService,
		readonly openerService: IOpenerService,
		readonly externalOpenerService: IExternalUriOpenerService,
		readonly tunnelService: ITunnelService,
		readonly hostService: IHostService,
		readonly logService: ILogService
	) {
		super();
		this.notifier = new OnAutoForwardedAction(notificationService, remoteExplorerService, openerService, externalOpenerService, tunnelService, hostService, logService);
		this._register(configurationService.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration(PORT_AUTO_FORWARD_SETTING)) {
				await this.startStopCandidateListener();
			}
		}));

		this.portsFeatures = this._register(this.remoteExplorerService.onEnabledPortsFeatures(async () => {
			await this.startStopCandidateListener();
		}));

		this.startStopCandidateListener();
	}

	private async startStopCandidateListener() {
		if (this.configurationService.getValue(PORT_AUTO_FORWARD_SETTING)) {
			await this.startCandidateListener();
		} else {
			this.stopCandidateListener();
		}
	}

	private stopCandidateListener() {
		if (this.candidateListener) {
			this.candidateListener.dispose();
			this.candidateListener = undefined;
		}
	}

	private async startCandidateListener() {
		if (this.candidateListener || !this.remoteExplorerService.portsFeaturesEnabled) {
			return;
		}
		if (this.portsFeatures) {
			this.portsFeatures.dispose();
		}

		if (!this.remoteExplorerService.tunnelModel.environmentTunnelsSet) {
			await new Promise<void>(resolve => this.remoteExplorerService.tunnelModel.onEnvironmentTunnelsSet(() => resolve()));
		}

		// Capture list of starting candidates so we don't auto forward them later.
		await this.setInitialCandidates();

		this.candidateListener = this._register(this.remoteExplorerService.tunnelModel.onCandidatesChanged(this.handleCandidateUpdate, this));
	}

	private async setInitialCandidates() {
		let startingCandidates = this.remoteExplorerService.tunnelModel.candidatesOrUndefined;
		if (!startingCandidates) {
			await new Promise<void>(resolve => this.remoteExplorerService.tunnelModel.onCandidatesChanged(() => resolve()));
			startingCandidates = this.remoteExplorerService.tunnelModel.candidates;
		}

		for (const value of startingCandidates) {
			this.initialCandidates.add(makeAddress(value.host, value.port));
		}
	}

	private async forwardCandidates(): Promise<RemoteTunnel[] | undefined> {
		const attributes = await this.remoteExplorerService.tunnelModel.getAttributes(this.remoteExplorerService.tunnelModel.candidates.map(candidate => candidate.port));
		const allTunnels: RemoteTunnel[] = [];
		for (const value of this.remoteExplorerService.tunnelModel.candidates) {
			if (!value.detail) {
				continue;
			}

			const address = makeAddress(value.host, value.port);
			if (this.initialCandidates.has(address)) {
				continue;
			}
			if (this.notifiedOnly.has(address) || this.autoForwarded.has(address)) {
				continue;
			}
			const alreadyForwarded = mapHasAddressLocalhostOrAllInterfaces(this.remoteExplorerService.tunnelModel.forwarded, value.host, value.port);
			if (mapHasAddressLocalhostOrAllInterfaces(this.remoteExplorerService.tunnelModel.detected, value.host, value.port)) {
				continue;
			}
			if (attributes?.get(value.port)?.onAutoForward === OnPortForward.Ignore) {
				continue;
			}
			const forwarded = await this.remoteExplorerService.forward(value, undefined, undefined, undefined, undefined, undefined, false);
			if (!alreadyForwarded && forwarded) {
				this.autoForwarded.add(address);
			} else if (forwarded) {
				this.notifiedOnly.add(address);
			}
			if (forwarded) {
				allTunnels.push(forwarded);
			}
		}
		if (allTunnels.length === 0) {
			return undefined;
		}
		return allTunnels;
	}

	private async handleCandidateUpdate(removed: Map<string, { host: string, port: number }>) {
		const removedPorts: number[] = [];
		for (const removedPort of removed) {
			const key = removedPort[0];
			const value = removedPort[1];
			if (this.autoForwarded.has(key)) {
				await this.remoteExplorerService.close(value);
				this.autoForwarded.delete(key);
				removedPorts.push(value.port);
			} else if (this.notifiedOnly.has(key)) {
				this.notifiedOnly.delete(key);
				removedPorts.push(value.port);
			} else if (this.initialCandidates.has(key)) {
				this.initialCandidates.delete(key);
			}
		}

		if (removedPorts.length > 0) {
			await this.notifier.hide(removedPorts);
		}

		const tunnels = await this.forwardCandidates();
		if (tunnels) {
			await this.notifier.doAction(tunnels);
		}
	}
}
