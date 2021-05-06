/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/tunnelView';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { IViewDescriptor, IEditableData, IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey, RawContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { ICommandService, ICommandHandler, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { Event } from 'vs/base/common/event';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { Disposable, IDisposable, toDisposable, MutableDisposable, dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IMenuService, MenuId, MenuRegistry, ILocalizedString } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions, createAndFillInActionBarActions, createActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IRemoteExplorerService, TunnelModel, makeAddress, TunnelType, ITunnelItem, Tunnel, TUNNEL_VIEW_ID, parseAddress, CandidatePort, TunnelPrivacy, TunnelEditId, mapHasAddressLocalhostOrAllInterfaces } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { InputBox, MessageType } from 'vs/base/browser/ui/inputbox/inputBox';
import { attachButtonStyler, attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { once } from 'vs/base/common/functional';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { URI } from 'vs/base/common/uri';
import { isPortPrivileged, ITunnelService, RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { copyAddressIcon, forwardedPortWithoutProcessIcon, forwardedPortWithProcessIcon, forwardPortIcon, labelPortIcon, openBrowserIcon, openPreviewIcon, portsViewIcon, privatePortIcon, publicPortIcon, stopForwardIcon } from 'vs/workbench/contrib/remote/browser/remoteIcons';
import { IExternalUriOpenerService } from 'vs/workbench/contrib/externalUriOpener/common/externalUriOpenerService';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { ITableColumn, ITableContextMenuEvent, ITableEvent, ITableMouseEvent, ITableRenderer, ITableVirtualDelegate } from 'vs/base/browser/ui/table/table';
import { WorkbenchTable } from 'vs/platform/list/browser/listService';
import { Button } from 'vs/base/browser/ui/button/button';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { IMarkdownString, MarkdownString } from 'vs/base/common/htmlContent';
import { IHoverDelegateOptions } from 'vs/base/browser/ui/iconLabel/iconHoverDelegate';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { STATUS_BAR_HOST_NAME_BACKGROUND } from 'vs/workbench/common/theme';

export const forwardedPortsViewEnabled = new RawContextKey<boolean>('forwardedPortsViewEnabled', false, nls.localize('tunnel.forwardedPortsViewEnabled', "Whether the Ports view is enabled."));

class TunnelTreeVirtualDelegate implements ITableVirtualDelegate<ITunnelItem> {

	readonly headerRowHeight: number = 22;

	constructor(private readonly remoteExplorerService: IRemoteExplorerService) { }

	getHeight(row: ITunnelItem): number {
		return (row.tunnelType === TunnelType.Add && !this.remoteExplorerService.getEditableData(undefined)) ? 30 : 22;
	}
}

export interface ITunnelViewModel {
	readonly onForwardedPortsChanged: Event<void>;
	readonly all: TunnelItem[];
	readonly input: TunnelItem;
	isEmpty(): boolean;
}

export class TunnelViewModel implements ITunnelViewModel {

	readonly onForwardedPortsChanged: Event<void>;
	private model: TunnelModel;
	private _candidates: Map<string, CandidatePort> = new Map();

	readonly input = {
		label: nls.localize('remote.tunnelsView.addPort', "Add Port"),
		icon: undefined,
		tunnelType: TunnelType.Add,
		hasRunningProcess: false,
		remoteHost: '',
		remotePort: 0,
		processDescription: '',
		tooltipPostfix: '',
		iconTooltip: '',
		portTooltip: '',
		processTooltip: '',
		originTooltip: '',
		privacyTooltip: '',
		source: ''
	};

	constructor(
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService
	) {
		this.model = remoteExplorerService.tunnelModel;
		this.onForwardedPortsChanged = Event.any(this.model.onForwardPort, this.model.onClosePort, this.model.onPortName, this.model.onCandidatesChanged);
	}

	get all(): TunnelItem[] {
		const result: TunnelItem[] = [];
		this._candidates = new Map();
		this.model.candidates.forEach(candidate => {
			this._candidates.set(makeAddress(candidate.host, candidate.port), candidate);
		});
		if ((this.model.forwarded.size > 0) || this.remoteExplorerService.getEditableData(undefined)) {
			result.push(...this.forwarded);
		}
		if (this.model.detected.size > 0) {
			result.push(...this.detected);
		}

		result.push(this.input);
		return result;
	}

	private addProcessInfoFromCandidate(tunnelItem: ITunnelItem) {
		const key = makeAddress(tunnelItem.remoteHost, tunnelItem.remotePort);
		if (this._candidates.has(key)) {
			tunnelItem.processDescription = this._candidates.get(key)!.detail;
		}
	}

	private get forwarded(): TunnelItem[] {
		const forwarded = Array.from(this.model.forwarded.values()).map(tunnel => {
			const tunnelItem = TunnelItem.createFromTunnel(this.remoteExplorerService, tunnel);
			this.addProcessInfoFromCandidate(tunnelItem);
			return tunnelItem;
		}).sort((a: TunnelItem, b: TunnelItem) => {
			if (a.remotePort === b.remotePort) {
				return a.remoteHost < b.remoteHost ? -1 : 1;
			} else {
				return a.remotePort < b.remotePort ? -1 : 1;
			}
		});
		return forwarded;
	}

	private get detected(): TunnelItem[] {
		return Array.from(this.model.detected.values()).map(tunnel => {
			const tunnelItem = TunnelItem.createFromTunnel(this.remoteExplorerService, tunnel, TunnelType.Detected, false);
			this.addProcessInfoFromCandidate(tunnelItem);
			return tunnelItem;
		});
	}

	isEmpty(): boolean {
		return (this.detected.length === 0) &&
			((this.forwarded.length === 0) || (this.forwarded.length === 1 &&
				(this.forwarded[0].tunnelType === TunnelType.Add) && !this.remoteExplorerService.getEditableData(undefined)));
	}
}

function emptyCell(item: ITunnelItem): ActionBarCell {
	return { label: '', tunnel: item, editId: TunnelEditId.None, tooltip: '' };
}

class IconColumn implements ITableColumn<ITunnelItem, ActionBarCell> {
	readonly label: string = '';
	readonly tooltip: string = '';
	readonly weight: number = 1;
	readonly minimumWidth = 40;
	readonly maximumWidth = 40;
	readonly templateId: string = 'actionbar';
	project(row: ITunnelItem): ActionBarCell {
		if (row.tunnelType === TunnelType.Add) {
			return emptyCell(row);
		}

		const icon = row.processDescription ? forwardedPortWithProcessIcon : forwardedPortWithoutProcessIcon;
		let tooltip: string = '';
		if (row instanceof TunnelItem) {
			tooltip = `${row.iconTooltip} ${row.tooltipPostfix}`;
		}
		return {
			label: '', icon, tunnel: row, editId: TunnelEditId.None, tooltip
		};
	}
}

class PortColumn implements ITableColumn<ITunnelItem, ActionBarCell> {
	readonly label: string = nls.localize('tunnel.portColumn.label', "Port");
	readonly tooltip: string = nls.localize('tunnel.portColumn.tooltip', "The label and remote port number of the forwarded port.");
	readonly weight: number = 1;
	readonly templateId: string = 'actionbar';
	project(row: ITunnelItem): ActionBarCell {
		const isAdd = row.tunnelType === TunnelType.Add;
		const label = row.label;
		let tooltip: string = '';
		if (row instanceof TunnelItem && !isAdd) {
			tooltip = `${row.portTooltip} ${row.tooltipPostfix}`;
		} else {
			tooltip = label;
		}
		return {
			label, tunnel: row, menuId: MenuId.TunnelPortInline,
			editId: row.tunnelType === TunnelType.Add ? TunnelEditId.New : TunnelEditId.Label, tooltip
		};
	}
}

class LocalAddressColumn implements ITableColumn<ITunnelItem, ActionBarCell> {
	readonly label: string = nls.localize('tunnel.addressColumn.label', "Local Address");
	readonly tooltip: string = nls.localize('tunnel.addressColumn.tooltip', "The address that the forwarded port is available at locally.");
	readonly weight: number = 1;
	readonly templateId: string = 'actionbar';
	project(row: ITunnelItem): ActionBarCell {
		if (row.tunnelType === TunnelType.Add) {
			return emptyCell(row);
		}

		const label = row.localAddress ?? '';
		let tooltip: string = label;
		if (row instanceof TunnelItem) {
			tooltip = row.tooltipPostfix;
		}
		return {
			label,
			menuId: MenuId.TunnelLocalAddressInline,
			tunnel: row,
			editId: TunnelEditId.LocalPort,
			tooltip,
			markdownTooltip: label ? LocalAddressColumn.getHoverText(label) : undefined
		};
	}

	private static getHoverText(localAddress: string) {
		return function (configurationService: IConfigurationService) {
			const editorConf = configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');

			let clickLabel = '';
			if (editorConf.multiCursorModifier === 'ctrlCmd') {
				if (isMacintosh) {
					clickLabel = nls.localize('portsLink.followLinkAlt.mac', "option + click");
				} else {
					clickLabel = nls.localize('portsLink.followLinkAlt', "alt + click");
				}
			} else {
				if (isMacintosh) {
					clickLabel = nls.localize('portsLink.followLinkCmd', "cmd + click");
				} else {
					clickLabel = nls.localize('portsLink.followLinkCtrl', "ctrl + click");
				}
			}

			const markdown = new MarkdownString('', true);
			const uri = localAddress.startsWith('http') ? localAddress : `http://${localAddress}`;
			return markdown.appendMarkdown(`[Follow link](${uri}) (${clickLabel})`);
		};
	}
}

class RunningProcessColumn implements ITableColumn<ITunnelItem, ActionBarCell> {
	readonly label: string = nls.localize('tunnel.processColumn.label', "Running Process");
	readonly tooltip: string = nls.localize('tunnel.processColumn.tooltip', "The command line of the process that is using the port.");
	readonly weight: number = 2;
	readonly templateId: string = 'actionbar';
	project(row: ITunnelItem): ActionBarCell {
		if (row.tunnelType === TunnelType.Add) {
			return emptyCell(row);
		}

		const label = row.processDescription ?? '';
		return { label, tunnel: row, editId: TunnelEditId.None, tooltip: row instanceof TunnelItem ? row.processTooltip : '' };
	}
}

class OriginColumn implements ITableColumn<ITunnelItem, ActionBarCell> {
	readonly label: string = nls.localize('tunnel.originColumn.label', "Origin");
	readonly tooltip: string = nls.localize('tunnel.originColumn.tooltip', "The source that a forwarded port originates from. Can be an extension, user forwarded, statically forwarded, or automatically forwarded.");
	readonly weight: number = 1;
	readonly templateId: string = 'actionbar';
	project(row: ITunnelItem): ActionBarCell {
		if (row.tunnelType === TunnelType.Add) {
			return emptyCell(row);
		}

		const label = row.source;
		const tooltip = `${row instanceof TunnelItem ? row.originTooltip : ''}. ${row instanceof TunnelItem ? row.tooltipPostfix : ''}`;
		return { label, menuId: MenuId.TunnelOriginInline, tunnel: row, editId: TunnelEditId.None, tooltip };
	}
}

class PrivacyColumn implements ITableColumn<ITunnelItem, ActionBarCell> {
	readonly label: string = nls.localize('tunnel.privacyColumn.label', "Privacy");
	readonly tooltip: string = nls.localize('tunnel.privacyColumn.tooltip', "The availability of the forwarded port.");
	readonly weight: number = 1;
	readonly templateId: string = 'actionbar';
	project(row: ITunnelItem): ActionBarCell {
		if (row.tunnelType === TunnelType.Add) {
			return emptyCell(row);
		}

		const label = row.privacy === TunnelPrivacy.Public ? nls.localize('tunnel.privacyPublic', "Public") : nls.localize('tunnel.privacyPrivate', "Private");
		let tooltip: string = '';
		if (row instanceof TunnelItem) {
			tooltip = `${row.privacyTooltip} ${row.tooltipPostfix}`;
		}
		return { label, tunnel: row, icon: row.icon, editId: TunnelEditId.None, tooltip };
	}
}

interface IActionBarTemplateData {
	elementDisposable: IDisposable;
	container: HTMLElement;
	label: IconLabel;
	button?: Button;
	icon: HTMLElement;
	actionBar: ActionBar;
}

interface ActionBarCell {
	label: string;
	icon?: ThemeIcon;
	tooltip: string;
	markdownTooltip?: (configurationService: IConfigurationService) => IMarkdownString;
	menuId?: MenuId;
	tunnel: ITunnelItem;
	editId: TunnelEditId;
}

class ActionBarRenderer extends Disposable implements ITableRenderer<ActionBarCell, IActionBarTemplateData> {
	readonly templateId = 'actionbar';
	private inputDone?: (success: boolean, finishEditing: boolean) => void;
	private _actionRunner: ActionRunner | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHoverService private readonly hoverService: IHoverService
	) { super(); }

	set actionRunner(actionRunner: ActionRunner) {
		this._actionRunner = actionRunner;
	}

	renderTemplate(container: HTMLElement): IActionBarTemplateData {
		const cell = dom.append(container, dom.$('.ports-view-actionbar-cell'));
		const icon = dom.append(cell, dom.$('.ports-view-actionbar-cell-icon'));
		const label = new IconLabel(cell,
			{
				supportHighlights: true,
				hoverDelegate: {
					showHover: (options: IHoverDelegateOptions): IDisposable | undefined => {
						return this.hoverService.showHover(options);
					},
					delay: <number>this.configurationService.getValue('workbench.hover.delay')
				}
			});
		const actionsContainer = dom.append(cell, dom.$('.actions'));
		const actionBar = new ActionBar(actionsContainer, {
			actionViewItemProvider: createActionViewItem.bind(undefined, this.instantiationService)
		});
		return { label, icon, actionBar, container: cell, elementDisposable: Disposable.None };
	}

	renderElement(element: ActionBarCell, index: number, templateData: IActionBarTemplateData): void {
		// reset
		templateData.actionBar.clear();
		templateData.icon.className = 'ports-view-actionbar-cell-icon';
		templateData.icon.style.display = 'none';
		templateData.label.setLabel('');
		templateData.label.element.style.display = 'none';
		if (templateData.button) {
			templateData.button.element.style.display = 'none';
			templateData.button.dispose();
		}
		templateData.container.style.paddingLeft = '0px';
		templateData.elementDisposable.dispose();

		let editableData: IEditableData | undefined;
		if (element.editId === TunnelEditId.New && (editableData = this.remoteExplorerService.getEditableData(undefined))) {
			this.renderInputBox(templateData.container, editableData);
		} else {
			editableData = this.remoteExplorerService.getEditableData(element.tunnel, element.editId);
			if (editableData) {
				this.renderInputBox(templateData.container, editableData);
			} else if ((element.tunnel.tunnelType === TunnelType.Add) && (element.menuId === MenuId.TunnelPortInline)) {
				this.renderButton(element, templateData);
			} else {
				this.renderActionBarItem(element, templateData);
			}
		}
	}

	renderButton(element: ActionBarCell, templateData: IActionBarTemplateData): void {
		templateData.container.style.paddingLeft = '7px';
		templateData.container.style.height = '28px';
		templateData.button = this._register(new Button(templateData.container));
		templateData.button.label = element.label;
		templateData.button.element.title = element.tooltip;
		this._register(attachButtonStyler(templateData.button, this.themeService));
		this._register(templateData.button.onDidClick(() => {
			this.commandService.executeCommand(ForwardPortAction.INLINE_ID);
		}));
	}

	renderActionBarItem(element: ActionBarCell, templateData: IActionBarTemplateData): void {
		templateData.label.element.style.display = 'flex';
		templateData.label.setLabel(element.label, undefined,
			{
				title: element.markdownTooltip ?
					{ markdown: element.markdownTooltip(this.configurationService), markdownNotSupportedFallback: element.tooltip }
					: element.tooltip,
				extraClasses: element.menuId === MenuId.TunnelLocalAddressInline ? ['ports-view-actionbar-cell-localaddress'] : undefined
			});
		templateData.actionBar.context = element.tunnel;
		templateData.container.style.paddingLeft = '10px';
		const context: [string, any][] =
			[
				['view', TUNNEL_VIEW_ID],
				[TunnelTypeContextKey.key, element.tunnel.tunnelType],
				[TunnelCloseableContextKey.key, element.tunnel.closeable],
				[TunnelPrivacyContextKey.key, element.tunnel.privacy]
			];
		const contextKeyService = this.contextKeyService.createOverlay(context);
		const disposableStore = new DisposableStore();
		templateData.elementDisposable = disposableStore;
		if (element.menuId) {
			const menu = disposableStore.add(this.menuService.createMenu(element.menuId, contextKeyService));
			let actions: IAction[] = [];
			disposableStore.add(createAndFillInActionBarActions(menu, { shouldForwardArgs: true }, actions));
			if (actions) {
				let labelActions = actions.filter(action => action.id.toLowerCase().indexOf('label') >= 0);
				if (labelActions.length > 1) {
					labelActions.sort((a, b) => a.label.length - b.label.length);
					labelActions.pop();
					actions = actions.filter(action => labelActions.indexOf(action) < 0);
				}
				templateData.actionBar.push(actions, { icon: true, label: false });
				if (this._actionRunner) {
					templateData.actionBar.actionRunner = this._actionRunner;
				}
			}
		}
		if (element.icon) {
			templateData.icon.className = `ports-view-actionbar-cell-icon ${ThemeIcon.asClassName(element.icon)}`;
			templateData.icon.title = element.tooltip;
			templateData.icon.style.display = 'inline';
		}
	}

	private renderInputBox(container: HTMLElement, editableData: IEditableData): IDisposable {
		// Required for FireFox. The blur event doesn't fire on FireFox when you just mash the "+" button to forward a port.
		if (this.inputDone) {
			this.inputDone(false, false);
			this.inputDone = undefined;
		}
		container.style.paddingLeft = '5px';
		const value = editableData.startingValue || '';
		const inputBox = new InputBox(container, this.contextViewService, {
			ariaLabel: nls.localize('remote.tunnelsView.input', "Press Enter to confirm or Escape to cancel."),
			validationOptions: {
				validation: (value) => {
					const message = editableData.validationMessage(value);
					if (!message) {
						return null;
					}

					return {
						content: message.content,
						formatContent: true,
						type: message.severity === Severity.Error ? MessageType.ERROR : MessageType.INFO
					};
				}
			},
			placeholder: editableData.placeholder || ''
		});
		const styler = attachInputBoxStyler(inputBox, this.themeService);

		inputBox.value = value;
		inputBox.focus();
		inputBox.select({ start: 0, end: editableData.startingValue ? editableData.startingValue.length : 0 });

		const done = once(async (success: boolean, finishEditing: boolean) => {
			dispose(toDispose);
			if (this.inputDone) {
				this.inputDone = undefined;
			}
			inputBox.element.style.display = 'none';
			const inputValue = inputBox.value;
			if (finishEditing) {
				return editableData.onFinish(inputValue, success);
			}
		});
		this.inputDone = done;

		const toDispose = [
			inputBox,
			dom.addStandardDisposableListener(inputBox.inputElement, dom.EventType.KEY_DOWN, async (e: IKeyboardEvent) => {
				if (e.equals(KeyCode.Enter)) {
					e.stopPropagation();
					if (inputBox.validate() !== MessageType.ERROR) {
						return done(true, true);
					} else {
						return done(false, true);
					}
				} else if (e.equals(KeyCode.Escape)) {
					e.preventDefault();
					e.stopPropagation();
					return done(false, true);
				}
			}),
			dom.addDisposableListener(inputBox.inputElement, dom.EventType.BLUR, () => {
				return done(inputBox.validate() !== MessageType.ERROR, true);
			}),
			styler
		];

		return toDisposable(() => {
			done(false, false);
		});
	}

	disposeElement(element: ActionBarCell, index: number, templateData: IActionBarTemplateData, height: number | undefined) {
		templateData.elementDisposable.dispose();
	}

	disposeTemplate(templateData: IActionBarTemplateData): void {
		templateData.label.dispose();
		templateData.actionBar.dispose();
		templateData.elementDisposable.dispose();
		templateData.button?.dispose();
	}
}

class TunnelItem implements ITunnelItem {
	static createFromTunnel(remoteExplorerService: IRemoteExplorerService, tunnel: Tunnel, type: TunnelType = TunnelType.Forwarded, closeable?: boolean) {
		return new TunnelItem(type,
			tunnel.remoteHost,
			tunnel.remotePort,
			tunnel.source ?? (tunnel.userForwarded ? nls.localize('tunnel.user', "User Forwarded") :
				(type === TunnelType.Detected ? nls.localize('tunnel.staticallyForwarded', "Statically Forwarded") : nls.localize('tunnel.automatic', "Auto Forwarded"))),
			!!tunnel.hasRunningProcess,
			tunnel.localAddress,
			tunnel.localPort,
			closeable === undefined ? tunnel.closeable : closeable,
			tunnel.name,
			tunnel.runningProcess,
			tunnel.pid,
			tunnel.privacy,
			remoteExplorerService);
	}

	constructor(
		public tunnelType: TunnelType,
		public remoteHost: string,
		public remotePort: number,
		public source: string,
		public hasRunningProcess: boolean,
		public localAddress?: string,
		public localPort?: number,
		public closeable?: boolean,
		public name?: string,
		private runningProcess?: string,
		private pid?: number,
		public privacy?: TunnelPrivacy,
		private remoteExplorerService?: IRemoteExplorerService
	) { }

	get label(): string {
		if (this.tunnelType === TunnelType.Add && this.name) {
			return this.name;
		} else if (this.name) {
			return `${this.name} (${this.remotePort})`;
		} else {
			return `${this.remotePort}`;
		}
	}

	set processDescription(description: string | undefined) {
		this.runningProcess = description;
	}

	get processDescription(): string | undefined {
		let description: string = '';
		if (this.runningProcess) {
			if (this.pid && this.remoteExplorerService?.namedProcesses.has(this.pid)) {
				// This is a known process. Give it a friendly name.
				description = this.remoteExplorerService.namedProcesses.get(this.pid)!;
			} else {
				description = this.runningProcess.replace(/\0/g, ' ').trim();
			}
			if (this.pid) {
				description += ` (${this.pid})`;
			}
		} else if (this.hasRunningProcess) {
			description = nls.localize('tunnelView.runningProcess.inacessable', "Process information unavailable");
		}

		return description;
	}

	get icon(): ThemeIcon | undefined {
		switch (this.privacy) {
			case TunnelPrivacy.Public: return publicPortIcon;
			default: {
				if (this.tunnelType !== TunnelType.Add) {
					return privatePortIcon;
				} else {
					return undefined;
				}
			}
		}
	}

	get tooltipPostfix(): string {
		let information: string;
		if (this.localAddress) {
			information = nls.localize('remote.tunnel.tooltipForwarded', "Remote port {0}:{1} forwarded to local address {2}. ", this.remoteHost, this.remotePort, this.localAddress);
		} else {
			information = nls.localize('remote.tunnel.tooltipCandidate', "Remote port {0}:{1} not forwarded. ", this.remoteHost, this.remotePort);
		}

		return information;
	}

	get iconTooltip(): string {
		const isAdd = this.tunnelType === TunnelType.Add;
		if (!isAdd) {
			return `${this.processDescription ? nls.localize('tunnel.iconColumn.running', "Port has running process.") :
				nls.localize('tunnel.iconColumn.notRunning', "No running process.")}`;
		} else {
			return this.label;
		}
	}

	get portTooltip(): string {
		const isAdd = this.tunnelType === TunnelType.Add;
		if (!isAdd) {
			return `${this.name ? nls.localize('remote.tunnel.tooltipName', "Port labeled {0}. ", this.name) : ''}`;
		} else {
			return '';
		}
	}

	get processTooltip(): string {
		return this.processDescription ?? '';
	}

	get originTooltip(): string {
		return this.source;
	}

	get privacyTooltip(): string {
		return `${this.privacy === TunnelPrivacy.Public ? nls.localize('remote.tunnel.tooltipPublic', "Accessible publicly. ") :
			nls.localize('remote.tunnel.tooltipPrivate', "Only accessible from this machine. ")}`;
	}
}

export const TunnelTypeContextKey = new RawContextKey<TunnelType>('tunnelType', TunnelType.Add, true);
export const TunnelCloseableContextKey = new RawContextKey<boolean>('tunnelCloseable', false, true);
const TunnelPrivacyContextKey = new RawContextKey<TunnelPrivacy | undefined>('tunnelPrivacy', undefined, true);
const TunnelViewFocusContextKey = new RawContextKey<boolean>('tunnelViewFocus', false, nls.localize('tunnel.focusContext', "Whether the Ports view has focus."));
const TunnelViewSelectionKeyName = 'tunnelViewSelection';
const TunnelViewSelectionContextKey = new RawContextKey<ITunnelItem | undefined>(TunnelViewSelectionKeyName, undefined, true);
const TunnelViewMultiSelectionKeyName = 'tunnelViewMultiSelection';
const TunnelViewMultiSelectionContextKey = new RawContextKey<ITunnelItem[] | undefined>(TunnelViewMultiSelectionKeyName, undefined, true);
const PortChangableContextKey = new RawContextKey<boolean>('portChangable', false, true);
const WebContextKey = new RawContextKey<boolean>('isWeb', isWeb, true);

export class TunnelPanel extends ViewPane {

	static readonly ID = TUNNEL_VIEW_ID;
	static readonly TITLE = nls.localize('remote.tunnel', "Ports");

	private table!: WorkbenchTable<ITunnelItem>;
	private tunnelTypeContext: IContextKey<TunnelType>;
	private tunnelCloseableContext: IContextKey<boolean>;
	private tunnelPrivacyContext: IContextKey<TunnelPrivacy | undefined>;
	private tunnelViewFocusContext: IContextKey<boolean>;
	private tunnelViewSelectionContext: IContextKey<ITunnelItem | undefined>;
	private tunnelViewMultiSelectionContext: IContextKey<ITunnelItem[] | undefined>;
	private portChangableContextKey: IContextKey<boolean>;
	private isEditing: boolean = false;
	private titleActions: IAction[] = [];
	private lastFocus: number[] = [];
	private readonly titleActionsDisposable = this._register(new MutableDisposable());

	constructor(
		protected viewModel: ITunnelViewModel,
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
		@IMenuService private readonly menuService: IMenuService,
		@IThemeService themeService: IThemeService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ITunnelService private readonly tunnelService: ITunnelService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IHoverService private readonly hoverService: IHoverService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.tunnelTypeContext = TunnelTypeContextKey.bindTo(contextKeyService);
		this.tunnelCloseableContext = TunnelCloseableContextKey.bindTo(contextKeyService);
		this.tunnelPrivacyContext = TunnelPrivacyContextKey.bindTo(contextKeyService);
		this.tunnelViewFocusContext = TunnelViewFocusContextKey.bindTo(contextKeyService);
		this.tunnelViewSelectionContext = TunnelViewSelectionContextKey.bindTo(contextKeyService);
		this.tunnelViewMultiSelectionContext = TunnelViewMultiSelectionContextKey.bindTo(contextKeyService);
		this.portChangableContextKey = PortChangableContextKey.bindTo(contextKeyService);

		const overlayContextKeyService = this._register(this.contextKeyService.createOverlay([['view', TunnelPanel.ID]]));
		const titleMenu = this._register(this.menuService.createMenu(MenuId.TunnelTitle, overlayContextKeyService));
		const updateActions = () => {
			this.titleActions = [];
			this.titleActionsDisposable.value = createAndFillInActionBarActions(titleMenu, undefined, this.titleActions);
			this.updateActions();
		};

		this._register(titleMenu.onDidChange(updateActions));
		updateActions();

		this._register(toDisposable(() => {
			this.titleActions = [];
		}));
	}

	get portCount(): number {
		return this.remoteExplorerService.tunnelModel.forwarded.size + this.remoteExplorerService.tunnelModel.detected.size;
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const panelContainer = dom.append(container, dom.$('.tree-explorer-viewlet-tree-view'));
		const widgetContainer = dom.append(panelContainer, dom.$('.customview-tree'));
		widgetContainer.classList.add('ports-view');
		widgetContainer.classList.add('file-icon-themable-tree', 'show-file-icons');

		const actionBarRenderer = new ActionBarRenderer(this.instantiationService, this.contextKeyService,
			this.menuService, this.contextViewService, this.themeService, this.remoteExplorerService, this.commandService,
			this.configurationService, this.hoverService);
		const columns = [new IconColumn(), new PortColumn(), new LocalAddressColumn(), new RunningProcessColumn()];
		if (this.tunnelService.canMakePublic) {
			columns.push(new PrivacyColumn());
		}
		columns.push(new OriginColumn());

		this.table = this.instantiationService.createInstance(WorkbenchTable,
			'RemoteTunnels',
			widgetContainer,
			new TunnelTreeVirtualDelegate(this.remoteExplorerService),
			columns,
			[actionBarRenderer],
			{
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (item: ITunnelItem) => {
						return item.label;
					}
				},
				multipleSelectionSupport: true,
				accessibilityProvider: {
					getAriaLabel: (item: ITunnelItem) => {
						if (item instanceof TunnelItem) {
							return `${item.tooltipPostfix} ${item.portTooltip} ${item.iconTooltip} ${item.processTooltip} ${item.originTooltip} ${this.tunnelService.canMakePublic ? item.privacyTooltip : ''}`;
						} else {
							return item.label;
						}
					},
					getWidgetAriaLabel: () => nls.localize('tunnelView', "Tunnel View")
				},
				openOnSingleClick: true
			}
		) as WorkbenchTable<ITunnelItem>;

		const actionRunner: ActionRunner = new ActionRunner();
		actionBarRenderer.actionRunner = actionRunner;

		this._register(this.table.onContextMenu(e => this.onContextMenu(e, actionRunner)));
		this._register(this.table.onMouseDblClick(e => this.onMouseDblClick(e)));
		this._register(this.table.onDidChangeFocus(e => this.onFocusChanged(e)));
		this._register(this.table.onDidChangeSelection(e => this.onSelectionChanged(e)));
		this._register(this.table.onDidFocus(() => this.tunnelViewFocusContext.set(true)));
		this._register(this.table.onDidBlur(() => this.tunnelViewFocusContext.set(false)));

		const rerender = () => this.table.splice(0, Number.POSITIVE_INFINITY, this.viewModel.all);

		rerender();
		let lastPortCount = this.portCount;
		this._register(Event.debounce(this.viewModel.onForwardedPortsChanged, (_last, e) => e, 50)(() => {
			const newPortCount = this.portCount;
			if (((lastPortCount === 0) || (newPortCount === 0)) && (lastPortCount !== newPortCount)) {
				this._onDidChangeViewWelcomeState.fire();
			}
			lastPortCount = newPortCount;
			rerender();
		}));

		this._register(this.table.onDidOpen(e => {
			if (!e.element || (e.element.tunnelType !== TunnelType.Forwarded)) {
				return;
			}
			if (e.browserEvent?.type === 'dblclick') {
				this.commandService.executeCommand(LabelTunnelAction.ID);
			} else if (e.browserEvent instanceof MouseEvent) {
				const editorConf = this.configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');

				let modifierKey = false;
				if (editorConf.multiCursorModifier === 'ctrlCmd') {
					modifierKey = e.browserEvent.altKey;
				} else {
					if (isMacintosh) {
						modifierKey = e.browserEvent.metaKey;
					} else {
						modifierKey = e.browserEvent.ctrlKey;
					}
				}
				if (modifierKey) {
					this.commandService.executeCommand(OpenPortInBrowserAction.ID, e.element);
				}
			}
		}));

		this._register(this.remoteExplorerService.onDidChangeEditable(e => {
			this.isEditing = !!this.remoteExplorerService.getEditableData(e?.tunnel, e?.editId);
			this._onDidChangeViewWelcomeState.fire();

			if (!this.isEditing) {
				widgetContainer.classList.remove('highlight');
			}

			rerender();

			if (this.isEditing) {
				widgetContainer.classList.add('highlight');
				if (!e) {
					// When we are in editing mode for a new forward, rather than updating an existing one we need to reveal the input box since it might be out of view.
					this.table.reveal(this.table.indexOf(this.viewModel.input));
				}
			} else {
				if (e && (e.tunnel.tunnelType !== TunnelType.Add)) {
					this.table.setFocus(this.lastFocus);
				}
				this.focus();
			}
		}));
	}

	override shouldShowWelcome(): boolean {
		return this.viewModel.isEmpty() && !this.isEditing;
	}

	override focus(): void {
		super.focus();
		this.table.domFocus();
	}

	private onFocusChanged(event: ITableEvent<ITunnelItem>) {
		if (event.indexes.length > 0 && event.elements.length > 0) {
			this.lastFocus = event.indexes;
		}
		const elements = event.elements;
		const item = elements && elements.length ? elements[0] : undefined;
		if (item) {
			this.tunnelViewSelectionContext.set(item);
			this.tunnelTypeContext.set(item.tunnelType);
			this.tunnelCloseableContext.set(!!item.closeable);
			this.tunnelPrivacyContext.set(item.privacy);
			this.portChangableContextKey.set(!!item.localPort);
		} else {
			this.tunnelTypeContext.reset();
			this.tunnelViewSelectionContext.reset();
			this.tunnelCloseableContext.reset();
			this.tunnelPrivacyContext.reset();
			this.portChangableContextKey.reset();
		}
	}

	private onSelectionChanged(event: ITableEvent<ITunnelItem>) {
		const elements = event.elements;
		if (elements.length > 1) {
			this.tunnelViewMultiSelectionContext.set(elements);
		} else {
			this.tunnelViewMultiSelectionContext.set(undefined);
		}
	}

	private onContextMenu(event: ITableContextMenuEvent<ITunnelItem>, actionRunner: ActionRunner): void {
		if ((event.element !== undefined) && !(event.element instanceof TunnelItem)) {
			return;
		}

		event.browserEvent.preventDefault();
		event.browserEvent.stopPropagation();

		const node: ITunnelItem | undefined = event.element;

		if (node) {
			this.table.setFocus([this.table.indexOf(node)]);
			this.tunnelTypeContext.set(node.tunnelType);
			this.tunnelCloseableContext.set(!!node.closeable);
			this.tunnelPrivacyContext.set(node.privacy);
			this.portChangableContextKey.set(!!node.localPort);
		} else {
			this.tunnelTypeContext.set(TunnelType.Add);
			this.tunnelCloseableContext.set(false);
			this.tunnelPrivacyContext.set(undefined);
			this.portChangableContextKey.set(false);
		}

		const menu = this.menuService.createMenu(MenuId.TunnelContext, this.table.contextKeyService);
		const actions: IAction[] = [];
		this._register(createAndFillInContextMenuActions(menu, { shouldForwardArgs: true }, actions));
		menu.dispose();

		this.contextMenuService.showContextMenu({
			getAnchor: () => event.anchor,
			getActions: () => actions,
			getActionViewItem: (action) => {
				const keybinding = this.keybindingService.lookupKeybinding(action.id);
				if (keybinding) {
					return new ActionViewItem(action, action, { label: true, keybinding: keybinding.getLabel() });
				}
				return undefined;
			},
			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					this.table.domFocus();
				}
			},
			getActionsContext: () => node,
			actionRunner
		});
	}

	private onMouseDblClick(e: ITableMouseEvent<ITunnelItem>): void {
		if (!e.element) {
			this.commandService.executeCommand(ForwardPortAction.INLINE_ID);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.table.layout(height, width);
	}
}

export class TunnelPanelDescriptor implements IViewDescriptor {
	readonly id = TunnelPanel.ID;
	readonly name = TunnelPanel.TITLE;
	readonly ctorDescriptor: SyncDescriptor<TunnelPanel>;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly workspace = true;
	// group is not actually used for views that are not extension contributed. Use order instead.
	readonly group = 'details@0';
	// -500 comes from the remote explorer viewOrderDelegate
	readonly order = -500;
	readonly remoteAuthority?: string | string[];
	readonly canMoveView = true;
	readonly containerIcon = portsViewIcon;

	constructor(viewModel: ITunnelViewModel, environmentService: IWorkbenchEnvironmentService) {
		this.ctorDescriptor = new SyncDescriptor(TunnelPanel, [viewModel]);
		this.remoteAuthority = environmentService.remoteAuthority ? environmentService.remoteAuthority.split('+')[0] : undefined;
	}
}

namespace LabelTunnelAction {
	export const ID = 'remote.tunnel.label';
	export const LABEL = nls.localize('remote.tunnel.label', "Set Port Label");
	export const COMMAND_ID_KEYWORD = 'label';

	function isITunnelItem(item: any): item is ITunnelItem {
		return item && item.tunnelType && item.remoteHost && item.source;
	}

	export function handler(): ICommandHandler {
		return async (accessor, arg): Promise<{ port: number, label: string } | undefined> => {
			const context = isITunnelItem(arg) ? arg : accessor.get(IContextKeyService).getContextKeyValue<ITunnelItem | undefined>(TunnelViewSelectionKeyName);
			if (context) {
				return new Promise(resolve => {
					const remoteExplorerService = accessor.get(IRemoteExplorerService);
					const startingValue = context.name ? context.name : `${context.remotePort}`;
					remoteExplorerService.setEditable(context, TunnelEditId.Label, {
						onFinish: async (value, success) => {
							value = value.trim();
							remoteExplorerService.setEditable(context, TunnelEditId.Label, null);
							const changed = success && (value !== startingValue);
							if (changed) {
								await remoteExplorerService.tunnelModel.name(context.remoteHost, context.remotePort, value);
							}
							resolve(changed ? { port: context.remotePort, label: value } : undefined);
						},
						validationMessage: () => null,
						placeholder: nls.localize('remote.tunnelsView.labelPlaceholder', "Port label"),
						startingValue
					});
				});
			}
			return undefined;
		};
	}
}

const invalidPortString: string = nls.localize('remote.tunnelsView.portNumberValid', "Forwarded port is invalid.");
const maxPortNumber: number = 65536;
const invalidPortNumberString: string = nls.localize('remote.tunnelsView.portNumberToHigh', "Port number must be \u2265 0 and < {0}.", maxPortNumber);
const requiresSudoString: string = nls.localize('remote.tunnelView.inlineElevationMessage', "May Require Sudo");
const alreadyForwarded: string = nls.localize('remote.tunnelView.alreadyForwarded', "Port is already forwarded");

export namespace ForwardPortAction {
	export const INLINE_ID = 'remote.tunnel.forwardInline';
	export const COMMANDPALETTE_ID = 'remote.tunnel.forwardCommandPalette';
	export const LABEL: ILocalizedString = { value: nls.localize('remote.tunnel.forward', "Forward a Port"), original: 'Forward a Port' };
	export const TREEITEM_LABEL = nls.localize('remote.tunnel.forwardItem', "Forward Port");
	const forwardPrompt = nls.localize('remote.tunnel.forwardPrompt', "Port number or address (eg. 3000 or 10.10.10.10:2000).");

	function validateInput(remoteExplorerService: IRemoteExplorerService, value: string, canElevate: boolean): { content: string, severity: Severity } | null {
		const parsed = parseAddress(value);
		if (!parsed) {
			return { content: invalidPortString, severity: Severity.Error };
		} else if (parsed.port >= maxPortNumber) {
			return { content: invalidPortNumberString, severity: Severity.Error };
		} else if (canElevate && isPortPrivileged(parsed.port)) {
			return { content: requiresSudoString, severity: Severity.Info };
		} else if (mapHasAddressLocalhostOrAllInterfaces(remoteExplorerService.tunnelModel.forwarded, parsed.host, parsed.port)) {
			return { content: alreadyForwarded, severity: Severity.Error };
		}
		return null;
	}

	function error(notificationService: INotificationService, tunnel: RemoteTunnel | void, host: string, port: number) {
		if (!tunnel) {
			notificationService.warn(nls.localize('remote.tunnel.forwardError', "Unable to forward {0}:{1}. The host may not be available or that remote port may already be forwarded", host, port));
		}
	}

	export function inlineHandler(): ICommandHandler {
		return async (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const notificationService = accessor.get(INotificationService);
			const tunnelService = accessor.get(ITunnelService);
			remoteExplorerService.setEditable(undefined, TunnelEditId.New, {
				onFinish: async (value, success) => {
					remoteExplorerService.setEditable(undefined, TunnelEditId.New, null);
					let parsed: { host: string, port: number } | undefined;
					if (success && (parsed = parseAddress(value))) {
						remoteExplorerService.forward({ host: parsed.host, port: parsed.port }, undefined, undefined, undefined, true).then(tunnel => error(notificationService, tunnel, parsed!.host, parsed!.port));
					}
				},
				validationMessage: (value) => validateInput(remoteExplorerService, value, tunnelService.canElevate),
				placeholder: forwardPrompt
			});
		};
	}

	export function commandPaletteHandler(): ICommandHandler {
		return async (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const notificationService = accessor.get(INotificationService);
			const viewsService = accessor.get(IViewsService);
			const quickInputService = accessor.get(IQuickInputService);
			const tunnelService = accessor.get(ITunnelService);
			await viewsService.openView(TunnelPanel.ID, true);
			const value = await quickInputService.input({
				prompt: forwardPrompt,
				validateInput: (value) => Promise.resolve(validateInput(remoteExplorerService, value, tunnelService.canElevate))
			});
			let parsed: { host: string, port: number } | undefined;
			if (value && (parsed = parseAddress(value))) {
				remoteExplorerService.forward({ host: parsed.host, port: parsed.port }, undefined, undefined, undefined, true).then(tunnel => error(notificationService, tunnel, parsed!.host, parsed!.port));
			}
		};
	}
}

interface QuickPickTunnel extends IQuickPickItem {
	tunnel?: ITunnelItem
}

function makeTunnelPicks(tunnels: Tunnel[], remoteExplorerService: IRemoteExplorerService): QuickPickInput<QuickPickTunnel>[] {
	const picks: QuickPickInput<QuickPickTunnel>[] = tunnels.map(forwarded => {
		const item = TunnelItem.createFromTunnel(remoteExplorerService, forwarded);
		return {
			label: item.label,
			description: item.processDescription,
			tunnel: item
		};
	});
	if (picks.length === 0) {
		picks.push({
			label: nls.localize('remote.tunnel.closeNoPorts', "No ports currently forwarded. Try running the {0} command", ForwardPortAction.LABEL.value)
		});
	}
	return picks;
}

namespace ClosePortAction {
	export const INLINE_ID = 'remote.tunnel.closeInline';
	export const COMMANDPALETTE_ID = 'remote.tunnel.closeCommandPalette';
	export const LABEL: ILocalizedString = { value: nls.localize('remote.tunnel.close', "Stop Forwarding Port"), original: 'Stop Forwarding Port' };

	export function inlineHandler(): ICommandHandler {
		return async (accessor, arg) => {
			const contextKeyService = accessor.get(IContextKeyService);
			let ports = contextKeyService.getContextKeyValue<ITunnelItem[] | undefined>(TunnelViewMultiSelectionKeyName);
			if (!ports) {
				const context = (arg !== undefined || arg instanceof TunnelItem) ?
					arg : contextKeyService.getContextKeyValue<ITunnelItem | undefined>(TunnelViewSelectionKeyName);
				if (context) {
					ports = [context];
				}
			}
			if (!ports) {
				return;
			}
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			return Promise.all(ports.map(port => remoteExplorerService.close({ host: port.remoteHost, port: port.remotePort })));
		};
	}

	export function commandPaletteHandler(): ICommandHandler {
		return async (accessor) => {
			const quickInputService = accessor.get(IQuickInputService);
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const commandService = accessor.get(ICommandService);

			const picks: QuickPickInput<QuickPickTunnel>[] = makeTunnelPicks(Array.from(remoteExplorerService.tunnelModel.forwarded.values()).filter(tunnel => tunnel.closeable), remoteExplorerService);
			const result = await quickInputService.pick(picks, { placeHolder: nls.localize('remote.tunnel.closePlaceholder', "Choose a port to stop forwarding") });
			if (result && result.tunnel) {
				await remoteExplorerService.close({ host: result.tunnel.remoteHost, port: result.tunnel.remotePort });
			} else if (result) {
				await commandService.executeCommand(ForwardPortAction.COMMANDPALETTE_ID);
			}
		};
	}
}

export namespace OpenPortInBrowserAction {
	export const ID = 'remote.tunnel.open';
	export const LABEL = nls.localize('remote.tunnel.open', "Open in Browser");

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			let key: string | undefined;
			if (arg instanceof TunnelItem) {
				key = makeAddress(arg.remoteHost, arg.remotePort);
			} else if (arg.tunnelRemoteHost && arg.tunnelRemotePort) {
				key = makeAddress(arg.tunnelRemoteHost, arg.tunnelRemotePort);
			}
			if (key) {
				const model = accessor.get(IRemoteExplorerService).tunnelModel;
				const openerService = accessor.get(IOpenerService);
				return run(model, openerService, key);
			}
		};
	}

	export function run(model: TunnelModel, openerService: IOpenerService, key: string) {
		const tunnel = model.forwarded.get(key) || model.detected.get(key);
		let address: string | undefined;
		if (tunnel && tunnel.localAddress && (address = model.address(tunnel.remoteHost, tunnel.remotePort))) {
			if (!address.startsWith('http')) {
				address = `http://${address}`;
			}
			return openerService.open(URI.parse(address), { allowContributedOpeners: false });
		}
		return Promise.resolve();
	}
}

export namespace OpenPortInPreviewAction {
	export const ID = 'remote.tunnel.openPreview';
	export const LABEL = nls.localize('remote.tunnel.openPreview', "Preview in Editor");

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			let key: string | undefined;
			if (arg instanceof TunnelItem) {
				key = makeAddress(arg.remoteHost, arg.remotePort);
			} else if (arg.tunnelRemoteHost && arg.tunnelRemotePort) {
				key = makeAddress(arg.tunnelRemoteHost, arg.tunnelRemotePort);
			}
			if (key) {
				const model = accessor.get(IRemoteExplorerService).tunnelModel;
				const openerService = accessor.get(IOpenerService);
				const externalOpenerService = accessor.get(IExternalUriOpenerService);
				return run(model, openerService, externalOpenerService, key);
			}
		};
	}

	export async function run(model: TunnelModel, openerService: IOpenerService, externalOpenerService: IExternalUriOpenerService, key: string) {
		const tunnel = model.forwarded.get(key) || model.detected.get(key);
		let address: string | undefined;
		if (tunnel && tunnel.localAddress && (address = model.address(tunnel.remoteHost, tunnel.remotePort))) {
			if (!address.startsWith('http')) {
				address = `http://${address}`;
			}
			const uri = URI.parse(address);
			const sourceUri = URI.parse(`http://${tunnel.remoteHost}:${tunnel.remotePort}`);
			const opener = await externalOpenerService.getOpener(uri, { sourceUri }, new CancellationTokenSource().token);
			if (opener) {
				return opener.openExternalUri(uri, { sourceUri }, new CancellationTokenSource().token);
			}
			return openerService.open(uri);
		}
		return Promise.resolve();
	}
}

namespace OpenPortInBrowserCommandPaletteAction {
	export const ID = 'remote.tunnel.openCommandPalette';
	export const LABEL = nls.localize('remote.tunnel.openCommandPalette', "Open Port in Browser");

	interface QuickPickTunnel extends IQuickPickItem {
		tunnel?: TunnelItem;
	}

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const model = remoteExplorerService.tunnelModel;
			const quickPickService = accessor.get(IQuickInputService);
			const openerService = accessor.get(IOpenerService);
			const commandService = accessor.get(ICommandService);
			const options: QuickPickTunnel[] = [...model.forwarded, ...model.detected].map(value => {
				const tunnelItem = TunnelItem.createFromTunnel(remoteExplorerService, value[1]);
				return {
					label: tunnelItem.label,
					description: tunnelItem.processDescription,
					tunnel: tunnelItem
				};
			});
			if (options.length === 0) {
				options.push({
					label: nls.localize('remote.tunnel.openCommandPaletteNone', "No ports currently forwarded. Open the Ports view to get started.")
				});
			} else {
				options.push({
					label: nls.localize('remote.tunnel.openCommandPaletteView', "Open the Ports view...")
				});
			}
			const picked = await quickPickService.pick<QuickPickTunnel>(options, { placeHolder: nls.localize('remote.tunnel.openCommandPalettePick', "Choose the port to open") });
			if (picked && picked.tunnel) {
				return OpenPortInBrowserAction.run(model, openerService, makeAddress(picked.tunnel.remoteHost, picked.tunnel.remotePort));
			} else if (picked) {
				return commandService.executeCommand(`${TUNNEL_VIEW_ID}.focus`);
			}
		};
	}
}

namespace CopyAddressAction {
	export const INLINE_ID = 'remote.tunnel.copyAddressInline';
	export const COMMANDPALETTE_ID = 'remote.tunnel.copyAddressCommandPalette';
	export const INLINE_LABEL = nls.localize('remote.tunnel.copyAddressInline', "Copy Local Address");
	export const COMMANDPALETTE_LABEL = nls.localize('remote.tunnel.copyAddressCommandPalette', "Copy Forwarded Port Address");

	async function copyAddress(remoteExplorerService: IRemoteExplorerService, clipboardService: IClipboardService, tunnelItem: ITunnelItem) {
		const address = remoteExplorerService.tunnelModel.address(tunnelItem.remoteHost, tunnelItem.remotePort);
		if (address) {
			await clipboardService.writeText(address.toString());
		}
	}

	export function inlineHandler(): ICommandHandler {
		return async (accessor, arg) => {
			const context = (arg !== undefined || arg instanceof TunnelItem) ? arg : accessor.get(IContextKeyService).getContextKeyValue(TunnelViewSelectionKeyName);
			if (context instanceof TunnelItem) {
				return copyAddress(accessor.get(IRemoteExplorerService), accessor.get(IClipboardService), context);
			}
		};
	}

	export function commandPaletteHandler(): ICommandHandler {
		return async (accessor, arg) => {
			const quickInputService = accessor.get(IQuickInputService);
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const commandService = accessor.get(ICommandService);
			const clipboardService = accessor.get(IClipboardService);

			const tunnels = Array.from(remoteExplorerService.tunnelModel.forwarded.values()).concat(Array.from(remoteExplorerService.tunnelModel.detected.values()));
			const result = await quickInputService.pick(makeTunnelPicks(tunnels, remoteExplorerService), { placeHolder: nls.localize('remote.tunnel.copyAddressPlaceholdter', "Choose a forwarded port") });
			if (result && result.tunnel) {
				await copyAddress(remoteExplorerService, clipboardService, result.tunnel);
			} else if (result) {
				await commandService.executeCommand(ForwardPortAction.COMMANDPALETTE_ID);
			}
		};
	}
}

namespace ChangeLocalPortAction {
	export const ID = 'remote.tunnel.changeLocalPort';
	export const LABEL = nls.localize('remote.tunnel.changeLocalPort', "Change Local Address Port");

	function validateInput(value: string, canElevate: boolean): { content: string, severity: Severity } | null {
		if (!value.match(/^[0-9]+$/)) {
			return { content: invalidPortString, severity: Severity.Error };
		} else if (Number(value) >= maxPortNumber) {
			return { content: invalidPortNumberString, severity: Severity.Error };
		} else if (canElevate && isPortPrivileged(Number(value))) {
			return { content: requiresSudoString, severity: Severity.Info };
		}
		return null;
	}

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const notificationService = accessor.get(INotificationService);
			const tunnelService = accessor.get(ITunnelService);
			const context = (arg !== undefined || arg instanceof TunnelItem) ? arg : accessor.get(IContextKeyService).getContextKeyValue(TunnelViewSelectionKeyName);
			if (context instanceof TunnelItem) {
				remoteExplorerService.setEditable(context, TunnelEditId.LocalPort, {
					onFinish: async (value, success) => {
						remoteExplorerService.setEditable(context, TunnelEditId.LocalPort, null);
						if (success) {
							await remoteExplorerService.close({ host: context.remoteHost, port: context.remotePort });
							const numberValue = Number(value);
							const newForward = await remoteExplorerService.forward({ host: context.remoteHost, port: context.remotePort }, numberValue, context.name, undefined, true);
							if (newForward && newForward.tunnelLocalPort !== numberValue) {
								notificationService.warn(nls.localize('remote.tunnel.changeLocalPortNumber', "The local port {0} is not available. Port number {1} has been used instead", value, newForward.tunnelLocalPort ?? newForward.localAddress));
							}
						}
					},
					validationMessage: (value) => validateInput(value, tunnelService.canElevate),
					placeholder: nls.localize('remote.tunnelsView.changePort', "New local port")
				});
			}
		};
	}
}

namespace MakePortPublicAction {
	export const ID = 'remote.tunnel.makePublic';
	export const LABEL = nls.localize('remote.tunnel.makePublic', "Make Public");

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			if (arg instanceof TunnelItem) {
				const remoteExplorerService = accessor.get(IRemoteExplorerService);
				await remoteExplorerService.close({ host: arg.remoteHost, port: arg.remotePort });
				return remoteExplorerService.forward({ host: arg.remoteHost, port: arg.remotePort }, arg.localPort, arg.name, undefined, true, true);
			}
		};
	}
}

namespace MakePortPrivateAction {
	export const ID = 'remote.tunnel.makePrivate';
	export const LABEL = nls.localize('remote.tunnel.makePrivate', "Make Private");

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			if (arg instanceof TunnelItem) {
				const remoteExplorerService = accessor.get(IRemoteExplorerService);
				await remoteExplorerService.close({ host: arg.remoteHost, port: arg.remotePort });
				return remoteExplorerService.forward({ host: arg.remoteHost, port: arg.remotePort }, arg.localPort, arg.name, undefined, true, false);
			}
		};
	}
}

const tunnelViewCommandsWeightBonus = 10; // give our commands a little bit more weight over other default list/tree commands

const isForwardedExpr = TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded);
const isForwardedOrDetectedExpr = ContextKeyExpr.or(isForwardedExpr, TunnelTypeContextKey.isEqualTo(TunnelType.Detected));
const isNotMultiSelectionExpr = TunnelViewMultiSelectionContextKey.isEqualTo(undefined);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: LabelTunnelAction.ID,
	weight: KeybindingWeight.WorkbenchContrib + tunnelViewCommandsWeightBonus,
	when: ContextKeyExpr.and(TunnelViewFocusContextKey, isForwardedExpr, isNotMultiSelectionExpr),
	primary: KeyCode.F2,
	mac: {
		primary: KeyCode.Enter
	},
	handler: LabelTunnelAction.handler()
});
CommandsRegistry.registerCommand(ForwardPortAction.INLINE_ID, ForwardPortAction.inlineHandler());
CommandsRegistry.registerCommand(ForwardPortAction.COMMANDPALETTE_ID, ForwardPortAction.commandPaletteHandler());
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: ClosePortAction.INLINE_ID,
	weight: KeybindingWeight.WorkbenchContrib + tunnelViewCommandsWeightBonus,
	when: ContextKeyExpr.and(TunnelCloseableContextKey, TunnelViewFocusContextKey),
	primary: KeyCode.Delete,
	mac: {
		primary: KeyMod.CtrlCmd | KeyCode.Backspace,
		secondary: [KeyCode.Delete]
	},
	handler: ClosePortAction.inlineHandler()
});

CommandsRegistry.registerCommand(ClosePortAction.COMMANDPALETTE_ID, ClosePortAction.commandPaletteHandler());
CommandsRegistry.registerCommand(OpenPortInBrowserAction.ID, OpenPortInBrowserAction.handler());
CommandsRegistry.registerCommand(OpenPortInPreviewAction.ID, OpenPortInPreviewAction.handler());
CommandsRegistry.registerCommand(OpenPortInBrowserCommandPaletteAction.ID, OpenPortInBrowserCommandPaletteAction.handler());
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: CopyAddressAction.INLINE_ID,
	weight: KeybindingWeight.WorkbenchContrib + tunnelViewCommandsWeightBonus,
	when: ContextKeyExpr.and(TunnelViewFocusContextKey, isForwardedOrDetectedExpr, isNotMultiSelectionExpr),
	primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
	handler: CopyAddressAction.inlineHandler()
});
CommandsRegistry.registerCommand(CopyAddressAction.COMMANDPALETTE_ID, CopyAddressAction.commandPaletteHandler());
CommandsRegistry.registerCommand(ChangeLocalPortAction.ID, ChangeLocalPortAction.handler());
CommandsRegistry.registerCommand(MakePortPublicAction.ID, MakePortPublicAction.handler());
CommandsRegistry.registerCommand(MakePortPrivateAction.ID, MakePortPrivateAction.handler());

MenuRegistry.appendMenuItem(MenuId.CommandPalette, ({
	command: {
		id: ClosePortAction.COMMANDPALETTE_ID,
		title: ClosePortAction.LABEL
	},
	when: forwardedPortsViewEnabled
}));
MenuRegistry.appendMenuItem(MenuId.CommandPalette, ({
	command: {
		id: ForwardPortAction.COMMANDPALETTE_ID,
		title: ForwardPortAction.LABEL
	},
	when: forwardedPortsViewEnabled
}));
MenuRegistry.appendMenuItem(MenuId.CommandPalette, ({
	command: {
		id: CopyAddressAction.COMMANDPALETTE_ID,
		title: CopyAddressAction.COMMANDPALETTE_LABEL
	},
	when: forwardedPortsViewEnabled
}));
MenuRegistry.appendMenuItem(MenuId.CommandPalette, ({
	command: {
		id: OpenPortInBrowserCommandPaletteAction.ID,
		title: OpenPortInBrowserCommandPaletteAction.LABEL
	},
	when: forwardedPortsViewEnabled
}));

MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '._open',
	order: 0,
	command: {
		id: OpenPortInBrowserAction.ID,
		title: OpenPortInBrowserAction.LABEL,
	},
	when: ContextKeyExpr.and(isForwardedOrDetectedExpr, isNotMultiSelectionExpr)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '._open',
	order: 1,
	command: {
		id: OpenPortInPreviewAction.ID,
		title: OpenPortInPreviewAction.LABEL,
	},
	when: ContextKeyExpr.and(
		ContextKeyExpr.or(WebContextKey.negate(), TunnelPrivacyContextKey.isEqualTo(TunnelPrivacy.Public)),
		isForwardedOrDetectedExpr,
		isNotMultiSelectionExpr)
}));
// The group 0_manage is used by extensions, so try not to change it
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '0_manage',
	order: 1,
	command: {
		id: LabelTunnelAction.ID,
		title: LabelTunnelAction.LABEL,
		icon: labelPortIcon
	},
	when: ContextKeyExpr.and(isForwardedExpr, isNotMultiSelectionExpr)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '2_localaddress',
	order: 0,
	command: {
		id: CopyAddressAction.INLINE_ID,
		title: CopyAddressAction.INLINE_LABEL,
	},
	when: ContextKeyExpr.and(isForwardedOrDetectedExpr, isNotMultiSelectionExpr)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '2_localaddress',
	order: 1,
	command: {
		id: ChangeLocalPortAction.ID,
		title: ChangeLocalPortAction.LABEL,
	},
	when: ContextKeyExpr.and(isForwardedExpr, PortChangableContextKey, isNotMultiSelectionExpr)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '2_localaddress',
	order: 2,
	command: {
		id: MakePortPublicAction.ID,
		title: MakePortPublicAction.LABEL,
	},
	when: ContextKeyExpr.and(TunnelPrivacyContextKey.isEqualTo(TunnelPrivacy.Private), isNotMultiSelectionExpr)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '2_localaddress',
	order: 2,
	command: {
		id: MakePortPrivateAction.ID,
		title: MakePortPrivateAction.LABEL,
	},
	when: ContextKeyExpr.and(TunnelPrivacyContextKey.isEqualTo(TunnelPrivacy.Public), isNotMultiSelectionExpr)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '3_forward',
	order: 0,
	command: {
		id: ClosePortAction.INLINE_ID,
		title: ClosePortAction.LABEL,
	},
	when: TunnelCloseableContextKey
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '3_forward',
	order: 1,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.LABEL,
	},
}));


MenuRegistry.appendMenuItem(MenuId.TunnelPortInline, ({
	group: '0_manage',
	order: 0,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.TREEITEM_LABEL,
		icon: forwardPortIcon
	},
	when: TunnelTypeContextKey.isEqualTo(TunnelType.Candidate)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelPortInline, ({
	group: '0_manage',
	order: 4,
	command: {
		id: LabelTunnelAction.ID,
		title: LabelTunnelAction.LABEL,
		icon: labelPortIcon
	},
	when: isForwardedExpr
}));
MenuRegistry.appendMenuItem(MenuId.TunnelPortInline, ({
	group: '0_manage',
	order: 5,
	command: {
		id: ClosePortAction.INLINE_ID,
		title: ClosePortAction.LABEL,
		icon: stopForwardIcon
	},
	when: TunnelCloseableContextKey
}));

MenuRegistry.appendMenuItem(MenuId.TunnelLocalAddressInline, ({
	order: -1,
	command: {
		id: CopyAddressAction.INLINE_ID,
		title: CopyAddressAction.INLINE_LABEL,
		icon: copyAddressIcon
	},
	when: isForwardedOrDetectedExpr
}));
MenuRegistry.appendMenuItem(MenuId.TunnelLocalAddressInline, ({
	order: 0,
	command: {
		id: OpenPortInBrowserAction.ID,
		title: OpenPortInBrowserAction.LABEL,
		icon: openBrowserIcon
	},
	when: isForwardedOrDetectedExpr
}));
MenuRegistry.appendMenuItem(MenuId.TunnelLocalAddressInline, ({
	order: 1,
	command: {
		id: OpenPortInPreviewAction.ID,
		title: OpenPortInPreviewAction.LABEL,
		icon: openPreviewIcon
	},
	when: ContextKeyExpr.and(
		ContextKeyExpr.or(WebContextKey.negate(), TunnelPrivacyContextKey.isEqualTo(TunnelPrivacy.Public)),
		isForwardedOrDetectedExpr)
}));

export const portWithRunningProcessForeground = registerColor('ports.iconRunningProcessForeground', {
	light: STATUS_BAR_HOST_NAME_BACKGROUND,
	dark: STATUS_BAR_HOST_NAME_BACKGROUND,
	hc: STATUS_BAR_HOST_NAME_BACKGROUND
}, nls.localize('portWithRunningProcess.foreground', "The color of the icon for a port that has an associated running process."));

registerThemingParticipant((theme, collector) => {
	const portWithRunningProcessColor = theme.getColor(portWithRunningProcessForeground);
	if (portWithRunningProcessColor) {
		collector.addRule(`.monaco-workbench ${ThemeIcon.asCSSSelector(forwardedPortWithProcessIcon)} { color: ${portWithRunningProcessColor} ; }`);
	}

});
