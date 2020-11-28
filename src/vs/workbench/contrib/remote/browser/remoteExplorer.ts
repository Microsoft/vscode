/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from 'vs/nls';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Extensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, IViewsService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IRemoteExplorerService, makeAddress, mapHasAddressLocalhostOrAllInterfaces, TUNNEL_VIEW_ID } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { PORT_AUTO_FORWARD_SETTING, forwardedPortsViewEnabled, ForwardPortAction, OpenPortInBrowserAction, TunnelPanel, TunnelPanelDescriptor, TunnelViewModel } from 'vs/workbench/contrib/remote/browser/tunnelView';
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
import { OperatingSystem } from 'vs/base/common/platform';
import { RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { Codicon } from 'vs/base/common/codicons';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';

export const VIEWLET_ID = 'workbench.view.remote';

export class ForwardedPortsView extends Disposable implements IWorkbenchContribution {
	private contextKeyListener?: IDisposable;
	private _activityBadge?: IDisposable;
	private entryAccessor: IStatusbarEntryAccessor | undefined;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IActivityService private readonly activityService: IActivityService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this._register(Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViewWelcomeContent(TUNNEL_VIEW_ID, {
			content: `Forwarded ports allow you to access your running services locally.\n[Forward a Port](command:${ForwardPortAction.INLINE_ID})`,
		}));
		this.enableBadgeAndStatusBar();
		this.enableForwardedPortsView();
	}

	private enableForwardedPortsView() {
		if (this.contextKeyListener) {
			this.contextKeyListener.dispose();
			this.contextKeyListener = undefined;
		}

		const viewEnabled: boolean = !!forwardedPortsViewEnabled.getValue(this.contextKeyService);
		if (this.environmentService.remoteAuthority && viewEnabled) {
			const viewContainer = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer({
				id: TunnelPanel.ID,
				name: nls.localize('ports', "Ports"),
				icon: Codicon.plug,
				ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [TunnelPanel.ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
				storageId: TunnelPanel.ID,
				hideIfEmpty: true,
				order: 5
			}, ViewContainerLocation.Panel);

			const tunnelPanelDescriptor = new TunnelPanelDescriptor(new TunnelViewModel(this.remoteExplorerService, this.configurationService), this.environmentService);
			const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
			if (viewContainer) {
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
				this._register(this.remoteExplorerService.tunnelModel.onForwardPort(() => {
					this.updateActivityBadge();
					this.updateStatusBar();
				}));
				this._register(this.remoteExplorerService.tunnelModel.onClosePort(() => {
					this.updateActivityBadge();
					this.updateStatusBar();
				}));

				this.updateActivityBadge();
				this.updateStatusBar();
				disposable.dispose();
			}
		});
	}

	private updateActivityBadge() {
		if (this._activityBadge) {
			this._activityBadge.dispose();
		}
		if (this.remoteExplorerService.tunnelModel.forwarded.size > 0) {
			const viewContainer = this.viewDescriptorService.getViewContainerByViewId(TUNNEL_VIEW_ID);
			if (viewContainer) {
				this._activityBadge = this.activityService.showViewContainerActivity(viewContainer.id, {
					badge: new NumberBadge(this.remoteExplorerService.tunnelModel.forwarded.size, n => n === 1 ? nls.localize('1forwardedPort', "1 forwarded port") : nls.localize('nForwardedPorts', "{0} forwarded ports", n))
				});
			}
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


export class AutomaticPortForwarding extends Disposable implements IWorkbenchContribution {

	constructor(
		@ITerminalService readonly terminalService: ITerminalService,
		@INotificationService readonly notificationService: INotificationService,
		@IOpenerService readonly openerService: IOpenerService,
		@IViewsService readonly viewsService: IViewsService,
		@IRemoteExplorerService readonly remoteExplorerService: IRemoteExplorerService,
		@IWorkbenchEnvironmentService readonly environmentService: IWorkbenchEnvironmentService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@IConfigurationService readonly configurationService: IConfigurationService,
		@IDebugService readonly debugService: IDebugService,
		@IRemoteAgentService readonly remoteAgentService: IRemoteAgentService
	) {
		super();
		if (!this.environmentService.remoteAuthority) {
			return;
		}

		remoteAgentService.getEnvironment().then(environment => {
			if (environment?.os === OperatingSystem.Windows) {
				this._register(new WindowsAutomaticPortForwarding(terminalService, notificationService, openerService,
					remoteExplorerService, contextKeyService, configurationService, debugService));
			} else if (environment?.os === OperatingSystem.Linux) {
				this._register(new LinuxAutomaticPortForwarding(configurationService, remoteExplorerService, notificationService, openerService, contextKeyService));
			}
		});
	}
}

class ForwardedPortNotifier extends Disposable {
	private lastNotifyTime: Date;
	private static COOL_DOWN = 5000; // milliseconds
	private lastNotification: INotificationHandle | undefined;

	constructor(private readonly notificationService: INotificationService,
		private readonly remoteExplorerService: IRemoteExplorerService,
		private readonly openerService: IOpenerService) {
		super();
		this.lastNotifyTime = new Date();
		this.lastNotifyTime.setFullYear(this.lastNotifyTime.getFullYear() - 1);
	}

	public notify(tunnels: RemoteTunnel[]) {
		if (Date.now() - this.lastNotifyTime.getTime() > ForwardedPortNotifier.COOL_DOWN) {
			this.showNotification(tunnels);
		}
	}

	private showNotification(tunnels: RemoteTunnel[]) {
		if (tunnels.length === 0) {
			return;
		}
		tunnels = tunnels.sort((a, b) => a.tunnelRemotePort - b.tunnelRemotePort);
		const firstTunnel = tunnels.shift()!;
		const address = makeAddress(firstTunnel.tunnelRemoteHost, firstTunnel.tunnelRemotePort);
		const message = nls.localize('remote.tunnelsView.automaticForward', "Your service running on port {0} is available. [See all forwarded ports](command:{1}.focus)",
			firstTunnel.tunnelRemotePort, TunnelPanel.ID);
		const browserChoice: IPromptChoice = {
			label: OpenPortInBrowserAction.LABEL,
			run: () => OpenPortInBrowserAction.run(this.remoteExplorerService.tunnelModel, this.openerService, address)
		};
		this.lastNotification = this.notificationService.prompt(Severity.Info, message, [browserChoice], { neverShowAgain: { id: 'remote.tunnelsView.autoForwardNeverShow', isSecondary: true } });
		this.lastNotifyTime = new Date();
		this.lastNotification.onDidClose(() => {
			this.lastNotification = undefined;
		});
	}
}

class WindowsAutomaticPortForwarding extends Disposable {
	private contextServiceListener?: IDisposable;
	private urlFinder?: UrlFinder;
	private notifier: ForwardedPortNotifier;

	constructor(
		private readonly terminalService: ITerminalService,
		readonly notificationService: INotificationService,
		readonly openerService: IOpenerService,
		private readonly remoteExplorerService: IRemoteExplorerService,
		private readonly contextKeyService: IContextKeyService,
		private readonly configurationService: IConfigurationService,
		private readonly debugService: IDebugService
	) {
		super();
		this.notifier = new ForwardedPortNotifier(notificationService, remoteExplorerService, openerService);
		this._register(configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(PORT_AUTO_FORWARD_SETTING)) {
				this.tryStartStopUrlFinder();
			}
		}));

		this.contextServiceListener = this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set(forwardedPortsViewEnabled.keys()))) {
				this.tryStartStopUrlFinder();
			}
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
		if (!this.urlFinder && !forwardedPortsViewEnabled.getValue(this.contextKeyService)) {
			return;
		}
		if (this.contextServiceListener) {
			this.contextServiceListener.dispose();
		}
		this.urlFinder = this._register(new UrlFinder(this.terminalService, this.debugService));
		this._register(this.urlFinder.onDidMatchLocalUrl(async (localUrl) => {
			if (mapHasAddressLocalhostOrAllInterfaces(this.remoteExplorerService.tunnelModel.forwarded, localUrl.host, localUrl.port)) {
				return;
			}
			const forwarded = await this.remoteExplorerService.forward(localUrl);
			if (forwarded) {
				this.notifier.notify([forwarded]);
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

class LinuxAutomaticPortForwarding extends Disposable {
	private candidateListener: IDisposable | undefined;
	private autoForwarded: Set<string> = new Set();
	private notifier: ForwardedPortNotifier;
	private initialCandidates: Set<string> = new Set();
	private contextServiceListener: IDisposable | undefined;

	constructor(
		private readonly configurationService: IConfigurationService,
		readonly remoteExplorerService: IRemoteExplorerService,
		readonly notificationService: INotificationService,
		readonly openerService: IOpenerService,
		readonly contextKeyService: IContextKeyService
	) {
		super();
		this.notifier = new ForwardedPortNotifier(notificationService, remoteExplorerService, openerService);
		this._register(configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(PORT_AUTO_FORWARD_SETTING)) {
				this.startStopCandidateListener();
			}
		}));

		this.contextServiceListener = this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set(forwardedPortsViewEnabled.keys()))) {
				this.startStopCandidateListener();
			}
		}));

		this.startStopCandidateListener();
	}

	private startStopCandidateListener() {
		if (this.configurationService.getValue(PORT_AUTO_FORWARD_SETTING)) {
			this.startCandidateListener();
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

	private startCandidateListener() {
		if (this.candidateListener || !forwardedPortsViewEnabled.getValue(this.contextKeyService)) {
			return;
		}
		if (this.contextServiceListener) {
			this.contextServiceListener.dispose();
		}

		this.candidateListener = this._register(this.remoteExplorerService.tunnelModel.onCandidatesChanged(this.handleCandidateUpdate, this));
		// Capture list of starting candidates so we don't auto forward them later.
		this.setInitialCandidates();
	}

	private setInitialCandidates() {
		this.remoteExplorerService.tunnelModel.candidates.forEach(async (value) => {
			this.initialCandidates.add(makeAddress(value.host, value.port));
		});
	}

	private async forwardCandidates(): Promise<RemoteTunnel[] | undefined> {
		const allTunnels = <RemoteTunnel[]>(await Promise.all(this.remoteExplorerService.tunnelModel.candidates.map(async (value) => {
			const address = makeAddress(value.host, value.port);
			if (this.initialCandidates.has(address)) {
				return undefined;
			}
			const forwarded = await this.remoteExplorerService.forward(value);
			if (forwarded) {
				this.autoForwarded.add(address);
			}
			return forwarded;
		}))).filter(tunnel => !!tunnel);
		if (allTunnels.length === 0) {
			return undefined;
		}
		return allTunnels;
	}

	private async handleCandidateUpdate(removed: Map<string, { host: string, port: number }>) {
		removed.forEach((value, key) => {
			if (this.autoForwarded.has(key)) {
				this.remoteExplorerService.close(value);
				this.autoForwarded.delete(key);
			} else if (this.initialCandidates.has(key)) {
				this.initialCandidates.delete(key);
			}
		});

		const tunnels = await this.forwardCandidates();
		if (tunnels) {
			this.notifier.notify(tunnels);
		}
	}
}
