/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { STATUS_BAR_HOST_NAME_BACKGROUND, STATUS_BAR_HOST_NAME_FOREGROUND } from 'vs/workbench/common/theme';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { Disposable } from 'vs/base/common/lifecycle';
import { MenuId, IMenuService, MenuItemAction, IMenu, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor, IStatusbarEntry } from 'vs/workbench/services/statusbar/common/statusbar';
import { ILabelService } from 'vs/platform/label/common/label';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { REMOTE_HOST_SCHEME } from 'vs/platform/remote/common/remoteHosts';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { PersistentConnectionEventType } from 'vs/platform/remote/common/remoteAgentConnection';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { RemoteConnectionState, Deprecated_RemoteAuthorityContext } from 'vs/workbench/browser/contextkeys';
import { isWeb } from 'vs/base/common/platform';
import { once } from 'vs/base/common/functional';

const WINDOW_ACTIONS_COMMAND_ID = 'workbench.action.remote.showMenu';
const CLOSE_REMOTE_COMMAND_ID = 'workbench.action.remote.close';
const SHOW_CLOSE_REMOTE_COMMAND_ID = !isWeb; // web does not have a "Close Remote" command

export class RemoteWindowActiveIndicator extends Disposable implements IWorkbenchContribution {

	private windowIndicatorEntry: IStatusbarEntryAccessor | undefined;
	private windowCommandMenu: IMenu;
	private hasWindowActions: boolean = false;
	private remoteAuthority: string | undefined;
	private connectionState: 'initializing' | 'connected' | 'disconnected' | undefined = undefined;

	constructor(
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ILabelService private readonly labelService: ILabelService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IMenuService private menuService: IMenuService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ICommandService private readonly commandService: ICommandService,
		@IExtensionService extensionService: IExtensionService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IHostService hostService: IHostService
	) {
		super();

		this.windowCommandMenu = this.menuService.createMenu(MenuId.StatusBarWindowIndicatorMenu, this.contextKeyService);
		this._register(this.windowCommandMenu);

		const category = { value: nls.localize('remote.category', "Remote"), original: 'Remote' };
		const that = this;
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: WINDOW_ACTIONS_COMMAND_ID,
					category,
					title: { value: nls.localize('remote.showMenu', "Show Remote Menu"), original: 'Show Remote Menu' },
					f1: true,
				});
			}
			run = () => that.showIndicatorActions(that.windowCommandMenu);
		});

		this.remoteAuthority = environmentService.configuration.remoteAuthority;
		Deprecated_RemoteAuthorityContext.bindTo(this.contextKeyService).set(this.remoteAuthority || '');

		if (this.remoteAuthority) {

			if (SHOW_CLOSE_REMOTE_COMMAND_ID) {
				registerAction2(class extends Action2 {
					constructor() {
						super({
							id: CLOSE_REMOTE_COMMAND_ID,
							category,
							title: { value: nls.localize('remote.close', "Close Remote Connection"), original: 'Close Remote Connection' },
							f1: true
						});
					}
					run = () => that.remoteAuthority && hostService.openWindow({ forceReuseWindow: true });
				});

				MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
					group: '6_close',
					command: {
						id: CLOSE_REMOTE_COMMAND_ID,
						title: nls.localize({ key: 'miCloseRemote', comment: ['&& denotes a mnemonic'] }, "Close Re&&mote Connection")
					},
					order: 3.5
				});
			}

			// Pending entry until extensions are ready
			this.renderWindowIndicator('$(sync~spin) ' + nls.localize('host.open', "Opening Remote..."), undefined, WINDOW_ACTIONS_COMMAND_ID);
			this.connectionState = 'initializing';
			RemoteConnectionState.bindTo(this.contextKeyService).set(this.connectionState);

			const connection = remoteAgentService.getConnection();
			if (connection) {
				this._register(connection.onDidStateChange((e) => {
					switch (e.type) {
						case PersistentConnectionEventType.ConnectionLost:
						case PersistentConnectionEventType.ReconnectionPermanentFailure:
						case PersistentConnectionEventType.ReconnectionRunning:
						case PersistentConnectionEventType.ReconnectionWait:
							this.setDisconnected(true);
							break;
						case PersistentConnectionEventType.ConnectionGain:
							this.setDisconnected(false);
							break;
					}
				}));
			}
		}

		extensionService.whenInstalledExtensionsRegistered().then(_ => {
			if (this.remoteAuthority) {
				this._register(this.labelService.onDidChangeFormatters(e => this.updateWindowIndicator()));
				remoteAuthorityResolverService.resolveAuthority(this.remoteAuthority).then(() => this.setDisconnected(false), () => this.setDisconnected(true));
			}
			this._register(this.windowCommandMenu.onDidChange(e => this.updateWindowActions()));
			this.updateWindowIndicator();
		});
	}

	private setDisconnected(isDisconnected: boolean): void {
		const newState = isDisconnected ? 'disconnected' : 'connected';
		if (this.connectionState !== newState) {
			this.connectionState = newState;
			RemoteConnectionState.bindTo(this.contextKeyService).set(this.connectionState);
			Deprecated_RemoteAuthorityContext.bindTo(this.contextKeyService).set(isDisconnected ? `disconnected/${this.remoteAuthority!}` : this.remoteAuthority!);
			this.updateWindowIndicator();
		}
	}

	private updateWindowIndicator(): void {
		const windowActionCommand = (this.remoteAuthority || this.windowCommandMenu.getActions().length) ? WINDOW_ACTIONS_COMMAND_ID : undefined;
		if (this.remoteAuthority) {
			const hostLabel = this.labelService.getHostLabel(REMOTE_HOST_SCHEME, this.remoteAuthority) || this.remoteAuthority;
			if (this.connectionState !== 'disconnected') {
				this.renderWindowIndicator(`$(remote) ${hostLabel}`, nls.localize('host.tooltip', "Editing on {0}", hostLabel), windowActionCommand);
			} else {
				this.renderWindowIndicator(`$(alert) ${nls.localize('disconnectedFrom', "Disconnected from")} ${hostLabel}`, nls.localize('host.tooltipDisconnected', "Disconnected from {0}", hostLabel), windowActionCommand);
			}
		} else {
			if (windowActionCommand) {
				this.renderWindowIndicator(`$(remote)`, nls.localize('noHost.tooltip', "Open a remote window"), windowActionCommand);
			} else if (this.windowIndicatorEntry) {
				this.windowIndicatorEntry.dispose();
				this.windowIndicatorEntry = undefined;
			}
		}
	}

	private updateWindowActions() {
		const newHasWindowActions = this.windowCommandMenu.getActions().length > 0;
		if (newHasWindowActions !== this.hasWindowActions) {
			this.hasWindowActions = newHasWindowActions;
			this.updateWindowIndicator();
		}
	}

	private renderWindowIndicator(text: string, tooltip?: string, command?: string): void {
		const properties: IStatusbarEntry = {
			backgroundColor: themeColorFromId(STATUS_BAR_HOST_NAME_BACKGROUND),
			color: themeColorFromId(STATUS_BAR_HOST_NAME_FOREGROUND),
			ariaLabel: nls.localize('remote', "Remote"),
			text,
			tooltip,
			command
		};
		if (this.windowIndicatorEntry) {
			this.windowIndicatorEntry.update(properties);
		} else {
			this.windowIndicatorEntry = this.statusbarService.addEntry(properties, 'status.host', nls.localize('status.host', "Remote Host"), StatusbarAlignment.LEFT, Number.MAX_VALUE /* first entry */);
		}
	}

	private showIndicatorActions(menu: IMenu) {

		const actions = menu.getActions();

		const items: (IQuickPickItem | IQuickPickSeparator)[] = [];
		for (let actionGroup of actions) {
			if (items.length) {
				items.push({ type: 'separator' });
			}
			for (let action of actionGroup[1]) {
				if (action instanceof MenuItemAction) {
					let label = typeof action.item.title === 'string' ? action.item.title : action.item.title.value;
					if (action.item.category) {
						const category = typeof action.item.category === 'string' ? action.item.category : action.item.category.value;
						label = nls.localize('cat.title', "{0}: {1}", category, label);
					}
					items.push({
						type: 'item',
						id: action.item.id,
						label
					});
				}
			}
		}

		if (SHOW_CLOSE_REMOTE_COMMAND_ID && this.remoteAuthority) {
			if (items.length) {
				items.push({ type: 'separator' });
			}
			items.push({
				type: 'item',
				id: CLOSE_REMOTE_COMMAND_ID,
				label: nls.localize('closeRemote.title', 'Close Remote Connection')
			});
		}

		const quickPick = this.quickInputService.createQuickPick();
		quickPick.items = items;
		quickPick.canSelectMany = false;
		once(quickPick.onDidAccept)((_ => {
			const selectedItems = quickPick.selectedItems;
			if (selectedItems.length === 1) {
				this.commandService.executeCommand(selectedItems[0].id!);
			}
			quickPick.hide();
		}));
		quickPick.show();
	}
}
