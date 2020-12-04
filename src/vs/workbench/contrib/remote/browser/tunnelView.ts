/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/tunnelView';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { IViewDescriptor, IEditableData, IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey, RawContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';
import { ICommandService, ICommandHandler, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { Event, Emitter } from 'vs/base/common/event';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeRenderer, ITreeNode, IAsyncDataSource, ITreeContextMenuEvent, ITreeMouseEvent } from 'vs/base/browser/ui/tree/tree';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { Disposable, IDisposable, toDisposable, MutableDisposable, dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IMenuService, MenuId, IMenu, MenuRegistry, MenuItemAction, ILocalizedString, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions, createAndFillInActionBarActions, MenuEntryActionViewItem, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IRemoteExplorerService, TunnelModel, makeAddress, TunnelType, ITunnelItem, Tunnel, mapHasAddressLocalhostOrAllInterfaces, TUNNEL_VIEW_ID, parseAddress } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { InputBox, MessageType } from 'vs/base/browser/ui/inputbox/inputBox';
import { attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { once } from 'vs/base/common/functional';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { URI } from 'vs/base/common/uri';
import { RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Codicon } from 'vs/base/common/codicons';

export const forwardedPortsViewEnabled = new RawContextKey<boolean>('forwardedPortsViewEnabled', false);
export const PORT_AUTO_FORWARD_SETTING = 'remote.autoForwardPorts';

class TunnelTreeVirtualDelegate implements IListVirtualDelegate<ITunnelItem> {
	getHeight(element: ITunnelItem): number {
		return 22;
	}

	getTemplateId(element: ITunnelItem): string {
		return 'tunnelItemTemplate';
	}
}

export interface ITunnelViewModel {
	onForwardedPortsChanged: Event<void>;
	readonly forwarded: TunnelItem[];
	readonly detected: TunnelItem[];
	readonly candidates: TunnelItem[];
	readonly input: TunnelItem;
	groupsAndForwarded(): Promise<ITunnelGroup[]>;
}

export class TunnelViewModel extends Disposable implements ITunnelViewModel {
	private _onForwardedPortsChanged: Emitter<void> = new Emitter();
	public onForwardedPortsChanged: Event<void> = this._onForwardedPortsChanged.event;
	private model: TunnelModel;
	private _input: TunnelItem;
	private _candidates: Map<string, { host: string, port: number, detail: string }> = new Map();

	constructor(
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@IConfigurationService private readonly configurationService: IConfigurationService) {
		super();
		this.model = remoteExplorerService.tunnelModel;
		this._register(this.model.onForwardPort(() => this._onForwardedPortsChanged.fire()));
		this._register(this.model.onClosePort(() => this._onForwardedPortsChanged.fire()));
		this._register(this.model.onPortName(() => this._onForwardedPortsChanged.fire()));
		this._register(this.model.onCandidatesChanged(() => this._onForwardedPortsChanged.fire()));
		this._input = {
			label: nls.localize('remote.tunnelsView.add', "Forward a Port..."),
			tunnelType: TunnelType.Add,
			remoteHost: 'localhost',
			remotePort: 0,
			description: '',
			iconClasses: undefined
		};
	}

	async groupsAndForwarded(): Promise<ITunnelGroup[]> {
		const groups: (ITunnelGroup | TunnelItem)[] = [];
		this._candidates = new Map();
		(await this.model.candidates).forEach(candidate => {
			this._candidates.set(makeAddress(candidate.host, candidate.port), candidate);
		});
		if ((this.model.forwarded.size > 0) || this.remoteExplorerService.getEditableData(undefined)) {
			groups.push(...this.forwarded);
		}
		if (this.model.detected.size > 0) {
			groups.push({
				label: nls.localize('remote.tunnelsView.detected', "Existing Tunnels"),
				tunnelType: TunnelType.Detected,
				items: this.detected
			});
		}
		if (!this.configurationService.getValue(PORT_AUTO_FORWARD_SETTING)) {
			const candidates = await this.candidates;
			if (candidates.length > 0) {
				groups.push({
					label: nls.localize('remote.tunnelsView.candidates', "Not Forwarded"),
					tunnelType: TunnelType.Candidate,
					items: candidates
				});
			}
		}
		if (groups.length === 0) {
			groups.push(this._input);
		}
		return groups;
	}

	private addProcessInfoFromCandidate(tunnelItem: ITunnelItem) {
		const key = makeAddress(tunnelItem.remoteHost, tunnelItem.remotePort);
		if (this._candidates.has(key)) {
			tunnelItem.description = this._candidates.get(key)!.detail;
		}
	}

	get forwarded(): TunnelItem[] {
		const forwarded = Array.from(this.model.forwarded.values()).map(tunnel => {
			const tunnelItem = TunnelItem.createFromTunnel(tunnel);
			this.addProcessInfoFromCandidate(tunnelItem);
			return tunnelItem;
		}).sort((a: TunnelItem, b: TunnelItem) => {
			if (a.remotePort === b.remotePort) {
				return a.remoteHost < b.remoteHost ? -1 : 1;
			} else {
				return a.remotePort < b.remotePort ? -1 : 1;
			}
		});
		if (this.remoteExplorerService.getEditableData(undefined)) {
			forwarded.push(this._input);
		}
		return forwarded;
	}

	get detected(): TunnelItem[] {
		return Array.from(this.model.detected.values()).map(tunnel => {
			const tunnelItem = TunnelItem.createFromTunnel(tunnel, TunnelType.Detected, false);
			this.addProcessInfoFromCandidate(tunnelItem);
			return tunnelItem;
		});
	}

	get candidates(): TunnelItem[] {
		const candidates: TunnelItem[] = [];
		this._candidates.forEach(value => {
			if (!mapHasAddressLocalhostOrAllInterfaces(this.model.forwarded, value.host, value.port) &&
				!mapHasAddressLocalhostOrAllInterfaces(this.model.detected, value.host, value.port)) {
				candidates.push(new TunnelItem(TunnelType.Candidate, value.host, value.port, undefined, undefined, false, undefined, value.detail));
			}
		});
		return candidates;
	}

	get input(): TunnelItem {
		return this._input;
	}

	dispose() {
		super.dispose();
	}
}

interface ITunnelTemplateData {
	elementDisposable: IDisposable;
	container: HTMLElement;
	iconLabel: IconLabel;
	icon: HTMLElement;
	actionBar: ActionBar;
}

class TunnelTreeRenderer extends Disposable implements ITreeRenderer<ITunnelGroup | ITunnelItem, ITunnelItem, ITunnelTemplateData> {
	static readonly ITEM_HEIGHT = 22;
	static readonly TREE_TEMPLATE_ID = 'tunnelItemTemplate';

	private inputDone?: (success: boolean, finishEditing: boolean) => void;
	private _actionRunner: ActionRunner | undefined;

	constructor(
		private readonly viewId: string,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService
	) {
		super();
	}

	set actionRunner(actionRunner: ActionRunner) {
		this._actionRunner = actionRunner;
	}

	get templateId(): string {
		return TunnelTreeRenderer.TREE_TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): ITunnelTemplateData {
		container.classList.add('custom-view-tree-node-item');
		const icon = dom.append(container, dom.$('.custom-view-tree-node-item-icon'));
		const iconLabel = new IconLabel(container, { supportHighlights: true });
		// dom.addClass(iconLabel.element, 'tunnel-view-label');
		const actionsContainer = dom.append(iconLabel.element, dom.$('.actions'));
		const actionBar = new ActionBar(actionsContainer, {
			actionViewItemProvider: (action: IAction) => {
				if (action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(MenuEntryActionViewItem, action);
				} else if (action instanceof SubmenuItemAction) {
					return this.instantiationService.createInstance(SubmenuEntryActionViewItem, action);
				}

				return undefined;
			}
		});

		return { icon, iconLabel, actionBar, container, elementDisposable: Disposable.None };
	}

	private isTunnelItem(item: ITunnelGroup | ITunnelItem): item is ITunnelItem {
		return !!((<ITunnelItem>item).remotePort);
	}

	renderElement(element: ITreeNode<ITunnelGroup | ITunnelItem, ITunnelGroup | ITunnelItem>, index: number, templateData: ITunnelTemplateData): void {
		templateData.elementDisposable.dispose();
		const node = element.element;

		// reset
		templateData.actionBar.clear();
		templateData.icon.className = 'custom-view-tree-node-item-icon';
		templateData.icon.hidden = true;

		let editableData: IEditableData | undefined;
		if (this.isTunnelItem(node)) {
			editableData = this.remoteExplorerService.getEditableData(node);
			if (editableData) {
				templateData.iconLabel.element.style.display = 'none';
				this.renderInputBox(templateData.container, editableData);
			} else {
				templateData.iconLabel.element.style.display = 'flex';
				this.renderTunnel(node, templateData);
			}
		} else if ((node.tunnelType === TunnelType.Add) && (editableData = this.remoteExplorerService.getEditableData(undefined))) {
			templateData.iconLabel.element.style.display = 'none';
			this.renderInputBox(templateData.container, editableData);
		} else {
			templateData.iconLabel.element.style.display = 'flex';
			templateData.iconLabel.setLabel(node.label);
		}
	}

	private renderTunnel(node: ITunnelItem, templateData: ITunnelTemplateData) {
		const label = node.label + (node.description ? (' - ' + node.description) : '');
		templateData.iconLabel.setLabel(node.label, node.description, { title: label, extraClasses: ['tunnel-view-label'] });

		templateData.actionBar.context = node;
		const contextKeyService = this._register(this.contextKeyService.createScoped());
		contextKeyService.createKey('view', this.viewId);
		contextKeyService.createKey('tunnelType', node.tunnelType);
		contextKeyService.createKey('tunnelCloseable', node.closeable);
		const disposableStore = new DisposableStore();
		templateData.elementDisposable = disposableStore;
		const menu = disposableStore.add(this.menuService.createMenu(MenuId.TunnelInline, contextKeyService));
		const actions: IAction[] = [];
		disposableStore.add(createAndFillInActionBarActions(menu, { shouldForwardArgs: true }, actions));
		if (actions) {
			templateData.actionBar.push(actions, { icon: true, label: false });
			if (this._actionRunner) {
				templateData.actionBar.actionRunner = this._actionRunner;
			}
		}
		if (node.iconClasses) {
			templateData.icon.className = `custom-view-tree-node-item-icon ${node.iconClasses}`;
			templateData.icon.hidden = false;
		} else {
			templateData.icon.className = 'custom-view-tree-node-item-icon';
			templateData.icon.hidden = true;
		}

		menu.dispose();
		contextKeyService.dispose();
	}

	private renderInputBox(container: HTMLElement, editableData: IEditableData): IDisposable {
		// Required for FireFox. The blur event doesn't fire on FireFox when you just mash the "+" button to forward a port.
		if (this.inputDone) {
			this.inputDone(false, false);
			this.inputDone = undefined;
		}
		const value = editableData.startingValue || '';
		const inputBox = new InputBox(container, this.contextViewService, {
			ariaLabel: nls.localize('remote.tunnelsView.input', "Press Enter to confirm or Escape to cancel."),
			validationOptions: {
				validation: (value) => {
					const message = editableData.validationMessage(value);
					if (!message || message.severity !== Severity.Error) {
						return null;
					}

					return {
						content: message.content,
						formatContent: true,
						type: MessageType.ERROR
					};
				}
			},
			placeholder: editableData.placeholder || ''
		});
		const styler = attachInputBoxStyler(inputBox, this.themeService);

		inputBox.value = value;
		inputBox.focus();
		inputBox.select({ start: 0, end: editableData.startingValue ? editableData.startingValue.length : 0 });

		const done = once((success: boolean, finishEditing: boolean) => {
			if (this.inputDone) {
				this.inputDone = undefined;
			}
			inputBox.element.style.display = 'none';
			const inputValue = inputBox.value;
			dispose(toDispose);
			if (finishEditing) {
				editableData.onFinish(inputValue, success);
			}
		});
		this.inputDone = done;

		const toDispose = [
			inputBox,
			dom.addStandardDisposableListener(inputBox.inputElement, dom.EventType.KEY_DOWN, (e: IKeyboardEvent) => {
				if (e.equals(KeyCode.Enter)) {
					if (inputBox.validate()) {
						done(true, true);
					}
				} else if (e.equals(KeyCode.Escape)) {
					done(false, true);
				}
			}),
			dom.addDisposableListener(inputBox.inputElement, dom.EventType.BLUR, () => {
				done(inputBox.isInputValid(), true);
			}),
			styler
		];

		return toDisposable(() => {
			done(false, false);
		});
	}

	disposeElement(resource: ITreeNode<ITunnelGroup | ITunnelItem, ITunnelGroup | ITunnelItem>, index: number, templateData: ITunnelTemplateData): void {
		templateData.elementDisposable.dispose();
	}

	disposeTemplate(templateData: ITunnelTemplateData): void {
		templateData.actionBar.dispose();
		templateData.elementDisposable.dispose();
	}
}

class TunnelDataSource implements IAsyncDataSource<ITunnelViewModel, ITunnelItem | ITunnelGroup> {
	hasChildren(element: ITunnelViewModel | ITunnelItem | ITunnelGroup) {
		if (element instanceof TunnelViewModel) {
			return true;
		} else if (element instanceof TunnelItem) {
			return false;
		} else if ((<ITunnelGroup>element).items) {
			return true;
		}
		return false;
	}

	async getChildren(element: ITunnelViewModel | ITunnelItem | ITunnelGroup) {
		if (element instanceof TunnelViewModel) {
			return element.groupsAndForwarded();
		} else if (element instanceof TunnelItem) {
			return [];
		} else if ((<ITunnelGroup>element).items) {
			return (<ITunnelGroup>element).items!;
		}
		return [];
	}
}

interface ITunnelGroup {
	tunnelType: TunnelType;
	label: string;
	items?: ITunnelItem[] | Promise<ITunnelItem[]>;
}

class TunnelItem implements ITunnelItem {
	static createFromTunnel(tunnel: Tunnel, type: TunnelType = TunnelType.Forwarded, closeable?: boolean) {
		return new TunnelItem(type, tunnel.remoteHost, tunnel.remotePort, tunnel.localAddress, tunnel.localPort, closeable === undefined ? tunnel.closeable : closeable, tunnel.name, tunnel.description ?? tunnel.runningProcess, tunnel.source);
	}

	constructor(
		public tunnelType: TunnelType,
		public remoteHost: string,
		public remotePort: number,
		public localAddress?: string,
		public localPort?: number,
		public closeable?: boolean,
		public name?: string,
		private _description?: string,
		private source?: string
	) { }
	get label(): string {
		if (this.name) {
			return nls.localize('remote.tunnelsView.forwardedPortLabel0', "{0}", this.name);
		} else if (this.localAddress) {
			return nls.localize('remote.tunnelsView.forwardedPortLabel1', "{0} \u2192 {1}", this.remotePort, TunnelItem.compactLongAddress(this.localAddress));
		} else {
			return nls.localize('remote.tunnelsView.forwardedPortLabel2', "{0}", this.remotePort);
		}
	}

	private static compactLongAddress(address: string): string {
		if (address.length < 16) {
			return address;
		}
		let displayAddress: string = address;
		try {
			if (!address.startsWith('http')) {
				address = `http://${address}`;
			}
			const url = new URL(address);
			if (url && url.host) {
				const lastDotIndex = url.host.lastIndexOf('.');
				const secondLastDotIndex = lastDotIndex !== -1 ? url.host.substring(0, lastDotIndex).lastIndexOf('.') : -1;
				if (secondLastDotIndex !== -1) {
					displayAddress = `${url.protocol}//...${url.host.substring(secondLastDotIndex + 1)}`;
				}
			}
		} catch (e) {
			// Address isn't a valid url and can't be compacted.
		}
		return displayAddress;
	}

	set description(description: string | undefined) {
		this._description = description;
	}

	get description(): string | undefined {
		const description: string[] = [];

		if (this.name && this.localAddress) {
			description.push(nls.localize('remote.tunnelsView.forwardedPortDescription0', "{0} \u2192 {1}", this.remotePort, TunnelItem.compactLongAddress(this.localAddress)));
		}

		if (this._description) {
			description.push(this._description);
		}

		if (this.source) {
			description.push(this.source);
		}

		if (description.length > 0) {
			return description.join('  \u2022  ');
		}

		return undefined;
	}

	get iconClasses(): string | undefined {
		return this.tunnelType === TunnelType.Detected || this.tunnelType === TunnelType.Forwarded ? Codicon.plug.classNames : undefined;
	}
}

export const TunnelTypeContextKey = new RawContextKey<TunnelType>('tunnelType', TunnelType.Add);
export const TunnelCloseableContextKey = new RawContextKey<boolean>('tunnelCloseable', false);
const TunnelViewFocusContextKey = new RawContextKey<boolean>('tunnelViewFocus', false);
const TunnelViewSelectionKeyName = 'tunnelViewSelection';
const TunnelViewSelectionContextKey = new RawContextKey<ITunnelItem | undefined>(TunnelViewSelectionKeyName, undefined);
const PortChangableContextKey = new RawContextKey<boolean>('portChangable', false);

class TunnelDataTree extends WorkbenchAsyncDataTree<any, any, any> { }

export class TunnelPanel extends ViewPane {
	static readonly ID = TUNNEL_VIEW_ID;
	static readonly TITLE = nls.localize('remote.tunnel', "Ports");
	private tree!: TunnelDataTree;
	private tunnelTypeContext: IContextKey<TunnelType>;
	private tunnelCloseableContext: IContextKey<boolean>;
	private tunnelViewFocusContext: IContextKey<boolean>;
	private tunnelViewSelectionContext: IContextKey<ITunnelItem | undefined>;
	private portChangableContextKey: IContextKey<boolean>;
	private isEditing: boolean = false;
	private titleActions: IAction[] = [];
	private readonly titleActionsDisposable = this._register(new MutableDisposable());

	constructor(
		protected viewModel: ITunnelViewModel,
		options: IViewPaneOptions,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IContextKeyService protected contextKeyService: IContextKeyService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IOpenerService openerService: IOpenerService,
		@IQuickInputService protected quickInputService: IQuickInputService,
		@ICommandService protected commandService: ICommandService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService themeService: IThemeService,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.tunnelTypeContext = TunnelTypeContextKey.bindTo(contextKeyService);
		this.tunnelCloseableContext = TunnelCloseableContextKey.bindTo(contextKeyService);
		this.tunnelViewFocusContext = TunnelViewFocusContextKey.bindTo(contextKeyService);
		this.tunnelViewSelectionContext = TunnelViewSelectionContextKey.bindTo(contextKeyService);
		this.portChangableContextKey = PortChangableContextKey.bindTo(contextKeyService);

		const scopedContextKeyService = this._register(this.contextKeyService.createScoped());
		scopedContextKeyService.createKey('view', TunnelPanel.ID);

		const titleMenu = this._register(this.menuService.createMenu(MenuId.TunnelTitle, scopedContextKeyService));
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

	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const panelContainer = dom.append(container, dom.$('.tree-explorer-viewlet-tree-view'));
		const treeContainer = dom.append(panelContainer, dom.$('.customview-tree'));
		treeContainer.classList.add('ports-view');
		treeContainer.classList.add('file-icon-themable-tree', 'show-file-icons');

		const renderer = new TunnelTreeRenderer(TunnelPanel.ID, this.menuService, this.contextKeyService, this.instantiationService, this.contextViewService, this.themeService, this.remoteExplorerService);
		this.tree = this.instantiationService.createInstance(TunnelDataTree,
			'RemoteTunnels',
			treeContainer,
			new TunnelTreeVirtualDelegate(),
			[renderer],
			new TunnelDataSource(),
			{
				collapseByDefault: (e: ITunnelItem | ITunnelGroup): boolean => {
					return false;
				},
				keyboardNavigationLabelProvider: {
					getKeyboardNavigationLabel: (item: ITunnelItem | ITunnelGroup) => {
						return item.label;
					}
				},
				multipleSelectionSupport: false,
				accessibilityProvider: {
					getAriaLabel: (item: ITunnelItem | ITunnelGroup) => {
						if (item instanceof TunnelItem) {
							if (item.localAddress) {
								return nls.localize('remote.tunnel.ariaLabelForwarded', "Remote port {0}:{1} forwarded to local address {2}", item.remoteHost, item.remotePort, item.localAddress);
							} else {
								return nls.localize('remote.tunnel.ariaLabelCandidate', "Remote port {0}:{1} not forwarded", item.remoteHost, item.remotePort);
							}
						} else {
							return item.label;
						}
					},
					getWidgetAriaLabel: () => nls.localize('tunnelView', "Tunnel View")
				}
			}
		);
		const actionRunner: ActionRunner = new ActionRunner();
		renderer.actionRunner = actionRunner;

		this._register(this.tree.onContextMenu(e => this.onContextMenu(e, actionRunner)));
		this._register(this.tree.onMouseDblClick(e => this.onMouseDblClick(e)));
		this._register(this.tree.onDidChangeFocus(e => this.onFocusChanged(e.elements)));
		this._register(this.tree.onDidFocus(() => this.tunnelViewFocusContext.set(true)));
		this._register(this.tree.onDidBlur(() => this.tunnelViewFocusContext.set(false)));

		this.tree.setInput(this.viewModel);
		this._register(this.viewModel.onForwardedPortsChanged(() => {
			this._onDidChangeViewWelcomeState.fire();
			this.tree.updateChildren(undefined, true);
		}));

		this._register(Event.debounce(this.tree.onDidOpen, (last, event) => event, 75, true)(e => {
			if (e.element && (e.element.tunnelType === TunnelType.Add)) {
				this.commandService.executeCommand(ForwardPortAction.INLINE_ID);
			}
		}));

		this._register(this.remoteExplorerService.onDidChangeEditable(async e => {
			this.isEditing = !!this.remoteExplorerService.getEditableData(e);
			this._onDidChangeViewWelcomeState.fire();

			if (!this.isEditing) {
				treeContainer.classList.remove('highlight');
			}

			await this.tree.updateChildren(undefined, false);

			if (this.isEditing) {
				treeContainer.classList.add('highlight');
				if (!e) {
					// When we are in editing mode for a new forward, rather than updating an existing one we need to reveal the input box since it might be out of view.
					this.tree.reveal(this.viewModel.input);
				}
			} else {
				this.tree.domFocus();
			}
		}));
	}

	private get contributedContextMenu(): IMenu {
		const contributedContextMenu = this._register(this.menuService.createMenu(MenuId.TunnelContext, this.tree.contextKeyService));
		return contributedContextMenu;
	}

	getActions(): IAction[] {
		return this.titleActions;
	}

	shouldShowWelcome(): boolean {
		return (this.viewModel.forwarded.length === 0) && (this.viewModel.candidates.length === 0) &&
			(this.viewModel.detected.length === 0) && !this.isEditing;
	}

	focus(): void {
		super.focus();
		this.tree.domFocus();
	}

	private onFocusChanged(elements: ITunnelItem[]) {
		const item = elements && elements.length ? elements[0] : undefined;
		if (item) {
			this.tunnelViewSelectionContext.set(item);
			this.tunnelTypeContext.set(item.tunnelType);
			this.tunnelCloseableContext.set(!!item.closeable);
			this.portChangableContextKey.set(!!item.localPort);
		} else {
			this.tunnelTypeContext.reset();
			this.tunnelViewSelectionContext.reset();
			this.tunnelCloseableContext.reset();
			this.portChangableContextKey.reset();
		}
	}

	private onContextMenu(treeEvent: ITreeContextMenuEvent<ITunnelItem | ITunnelGroup>, actionRunner: ActionRunner): void {
		if ((treeEvent.element !== null) && !(treeEvent.element instanceof TunnelItem)) {
			return;
		}
		const node: ITunnelItem | null = treeEvent.element;
		const event: UIEvent = treeEvent.browserEvent;

		event.preventDefault();
		event.stopPropagation();

		if (node) {
			this.tree!.setFocus([node]);
			this.tunnelTypeContext.set(node.tunnelType);
			this.tunnelCloseableContext.set(!!node.closeable);
			this.portChangableContextKey.set(!!node.localPort);
		} else {
			this.tunnelTypeContext.set(TunnelType.Add);
			this.tunnelCloseableContext.set(false);
			this.portChangableContextKey.set(false);
		}

		const actions: IAction[] = [];
		this._register(createAndFillInContextMenuActions(this.contributedContextMenu, { shouldForwardArgs: true }, actions));

		this.contextMenuService.showContextMenu({
			getAnchor: () => treeEvent.anchor,
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
					this.tree!.domFocus();
				}
			},
			getActionsContext: () => node,
			actionRunner
		});
	}

	private onMouseDblClick(e: ITreeMouseEvent<ITunnelGroup | ITunnelItem | null>): void {
		if (!e.element) {
			this.commandService.executeCommand(ForwardPortAction.INLINE_ID);
		}
	}

	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
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
	readonly containerIcon = Codicon.plug;

	constructor(viewModel: ITunnelViewModel, environmentService: IWorkbenchEnvironmentService) {
		this.ctorDescriptor = new SyncDescriptor(TunnelPanel, [viewModel]);
		this.remoteAuthority = environmentService.remoteAuthority ? environmentService.remoteAuthority.split('+')[0] : undefined;
	}
}

function validationMessage(validationString: string | null): { content: string, severity: Severity } | null {
	if (!validationString) {
		return null;
	}

	return {
		content: validationString,
		severity: Severity.Error
	};
}

namespace LabelTunnelAction {
	export const ID = 'remote.tunnel.label';
	export const LABEL = nls.localize('remote.tunnel.label', "Set Label");

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			const context = (arg !== undefined || arg instanceof TunnelItem) ? arg : accessor.get(IContextKeyService).getContextKeyValue(TunnelViewSelectionKeyName);
			if (context instanceof TunnelItem) {
				const remoteExplorerService = accessor.get(IRemoteExplorerService);
				remoteExplorerService.setEditable(context, {
					onFinish: async (value, success) => {
						if (success) {
							remoteExplorerService.tunnelModel.name(context.remoteHost, context.remotePort, value);
						}
						remoteExplorerService.setEditable(context, null);
					},
					validationMessage: () => null,
					placeholder: nls.localize('remote.tunnelsView.labelPlaceholder', "Port label"),
					startingValue: context.name
				});
			}
			return;
		};
	}
}

const invalidPortString: string = nls.localize('remote.tunnelsView.portNumberValid', "Forwarded port is invalid.");
const maxPortNumber: number = 65536;
const invalidPortNumberString: string = nls.localize('remote.tunnelsView.portNumberToHigh', "Port number must be \u2265 0 and < {0}.", maxPortNumber);

export namespace ForwardPortAction {
	export const INLINE_ID = 'remote.tunnel.forwardInline';
	export const COMMANDPALETTE_ID = 'remote.tunnel.forwardCommandPalette';
	export const LABEL: ILocalizedString = { value: nls.localize('remote.tunnel.forward', "Forward a Port"), original: 'Forward a Port' };
	export const TREEITEM_LABEL = nls.localize('remote.tunnel.forwardItem', "Forward Port");
	const forwardPrompt = nls.localize('remote.tunnel.forwardPrompt', "Port number or address (eg. 3000 or 10.10.10.10:2000).");

	function validateInput(value: string): string | null {
		const parsed = parseAddress(value);
		if (!parsed) {
			return invalidPortString;
		} else if (parsed.port >= maxPortNumber) {
			return invalidPortNumberString;
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
			if (arg instanceof TunnelItem) {
				remoteExplorerService.forward({ host: arg.remoteHost, port: arg.remotePort }).then(tunnel => error(notificationService, tunnel, arg.remoteHost, arg.remotePort));
			} else {
				remoteExplorerService.setEditable(undefined, {
					onFinish: async (value, success) => {
						let parsed: { host: string, port: number } | undefined;
						if (success && (parsed = parseAddress(value))) {
							remoteExplorerService.forward({ host: parsed.host, port: parsed.port }).then(tunnel => error(notificationService, tunnel, parsed!.host, parsed!.port));
						}
						remoteExplorerService.setEditable(undefined, null);
					},
					validationMessage: (value) => validationMessage(validateInput(value)),
					placeholder: forwardPrompt
				});
			}
		};
	}

	export function commandPaletteHandler(): ICommandHandler {
		return async (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const notificationService = accessor.get(INotificationService);
			const viewsService = accessor.get(IViewsService);
			const quickInputService = accessor.get(IQuickInputService);
			await viewsService.openView(TunnelPanel.ID, true);
			const value = await quickInputService.input({
				prompt: forwardPrompt,
				validateInput: (value) => Promise.resolve(validateInput(value))
			});
			let parsed: { host: string, port: number } | undefined;
			if (value && (parsed = parseAddress(value))) {
				remoteExplorerService.forward({ host: parsed.host, port: parsed.port }).then(tunnel => error(notificationService, tunnel, parsed!.host, parsed!.port));
			}
		};
	}
}

interface QuickPickTunnel extends IQuickPickItem {
	tunnel?: ITunnelItem
}

function makeTunnelPicks(tunnels: Tunnel[]): QuickPickInput<QuickPickTunnel>[] {
	const picks: QuickPickInput<QuickPickTunnel>[] = tunnels.map(forwarded => {
		const item = TunnelItem.createFromTunnel(forwarded);
		return {
			label: item.label,
			description: item.description,
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
			const context = (arg !== undefined || arg instanceof TunnelItem) ? arg : accessor.get(IContextKeyService).getContextKeyValue(TunnelViewSelectionKeyName);
			if (context instanceof TunnelItem) {
				const remoteExplorerService = accessor.get(IRemoteExplorerService);
				await remoteExplorerService.close({ host: context.remoteHost, port: context.remotePort });
			}
		};
	}

	export function commandPaletteHandler(): ICommandHandler {
		return async (accessor) => {
			const quickInputService = accessor.get(IQuickInputService);
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const commandService = accessor.get(ICommandService);

			const picks: QuickPickInput<QuickPickTunnel>[] = makeTunnelPicks(Array.from(remoteExplorerService.tunnelModel.forwarded.values()).filter(tunnel => tunnel.closeable));
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
			return openerService.open(URI.parse(address));
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
			const model = accessor.get(IRemoteExplorerService).tunnelModel;
			const quickPickService = accessor.get(IQuickInputService);
			const openerService = accessor.get(IOpenerService);
			const commandService = accessor.get(ICommandService);
			const options: QuickPickTunnel[] = [...model.forwarded, ...model.detected].map(value => {
				const tunnelItem = TunnelItem.createFromTunnel(value[1]);
				return {
					label: tunnelItem.label,
					description: tunnelItem.description,
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
	export const INLINE_LABEL = nls.localize('remote.tunnel.copyAddressInline', "Copy Address");
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
			const result = await quickInputService.pick(makeTunnelPicks(tunnels), { placeHolder: nls.localize('remote.tunnel.copyAddressPlaceholdter', "Choose a forwarded port") });
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
	export const LABEL = nls.localize('remote.tunnel.changeLocalPort', "Change Local Port");

	function validateInput(value: string): string | null {
		if (!value.match(/^[0-9]+$/)) {
			return invalidPortString;
		} else if (Number(value) >= maxPortNumber) {
			return invalidPortNumberString;
		}
		return null;
	}

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			const notificationService = accessor.get(INotificationService);
			const context = (arg !== undefined || arg instanceof TunnelItem) ? arg : accessor.get(IContextKeyService).getContextKeyValue(TunnelViewSelectionKeyName);
			if (context instanceof TunnelItem) {
				remoteExplorerService.setEditable(context, {
					onFinish: async (value, success) => {
						remoteExplorerService.setEditable(context, null);
						if (success) {
							await remoteExplorerService.close({ host: context.remoteHost, port: context.remotePort });
							const numberValue = Number(value);
							const newForward = await remoteExplorerService.forward({ host: context.remoteHost, port: context.remotePort }, numberValue, context.name);
							if (newForward && newForward.tunnelLocalPort !== numberValue) {
								notificationService.warn(nls.localize('remote.tunnel.changeLocalPortNumber', "The local port {0} is not available. Port number {1} has been used instead", value, newForward.tunnelLocalPort ?? newForward.localAddress));
							}
						}
					},
					validationMessage: (value) => validationMessage(validateInput(value)),
					placeholder: nls.localize('remote.tunnelsView.changePort', "New local port")
				});
			}
		};
	}
}

const tunnelViewCommandsWeightBonus = 10; // give our commands a little bit more weight over other default list/tree commands

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: LabelTunnelAction.ID,
	weight: KeybindingWeight.WorkbenchContrib + tunnelViewCommandsWeightBonus,
	when: ContextKeyExpr.and(TunnelViewFocusContextKey, TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded)),
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
		primary: KeyMod.CtrlCmd | KeyCode.Backspace
	},
	handler: ClosePortAction.inlineHandler()
});

CommandsRegistry.registerCommand(ClosePortAction.COMMANDPALETTE_ID, ClosePortAction.commandPaletteHandler());
CommandsRegistry.registerCommand(OpenPortInBrowserAction.ID, OpenPortInBrowserAction.handler());
CommandsRegistry.registerCommand(OpenPortInBrowserCommandPaletteAction.ID, OpenPortInBrowserCommandPaletteAction.handler());
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: CopyAddressAction.INLINE_ID,
	weight: KeybindingWeight.WorkbenchContrib + tunnelViewCommandsWeightBonus,
	when: ContextKeyExpr.or(ContextKeyExpr.and(TunnelViewFocusContextKey, TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded)), ContextKeyExpr.and(TunnelViewFocusContextKey, TunnelTypeContextKey.isEqualTo(TunnelType.Detected))),
	primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
	handler: CopyAddressAction.inlineHandler()
});
CommandsRegistry.registerCommand(CopyAddressAction.COMMANDPALETTE_ID, CopyAddressAction.commandPaletteHandler());
CommandsRegistry.registerCommand(ChangeLocalPortAction.ID, ChangeLocalPortAction.handler());

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
MenuRegistry.appendMenuItem(MenuId.TunnelTitle, ({
	group: 'navigation',
	order: 0,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.LABEL,
		icon: Codicon.plus
	}
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '0_manage',
	order: 0,
	command: {
		id: CopyAddressAction.INLINE_ID,
		title: CopyAddressAction.INLINE_LABEL,
	},
	when: ContextKeyExpr.or(TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded), TunnelTypeContextKey.isEqualTo(TunnelType.Detected))
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '0_manage',
	order: 1,
	command: {
		id: OpenPortInBrowserAction.ID,
		title: OpenPortInBrowserAction.LABEL,
	},
	when: ContextKeyExpr.or(TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded), TunnelTypeContextKey.isEqualTo(TunnelType.Detected))
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '0_manage',
	order: 2,
	command: {
		id: LabelTunnelAction.ID,
		title: LabelTunnelAction.LABEL,
	},
	when: TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '1_manage',
	order: 0,
	command: {
		id: ChangeLocalPortAction.ID,
		title: ChangeLocalPortAction.LABEL,
	},
	when: ContextKeyExpr.and(TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded), PortChangableContextKey)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '0_manage',
	order: 1,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.TREEITEM_LABEL,
	},
	when: ContextKeyExpr.or(TunnelTypeContextKey.isEqualTo(TunnelType.Candidate), TunnelTypeContextKey.isEqualTo(TunnelType.Add))
}));
MenuRegistry.appendMenuItem(MenuId.TunnelContext, ({
	group: '1_manage',
	order: 1,
	command: {
		id: ClosePortAction.INLINE_ID,
		title: ClosePortAction.LABEL,
	},
	when: TunnelCloseableContextKey
}));

MenuRegistry.appendMenuItem(MenuId.TunnelInline, ({
	order: 0,
	command: {
		id: OpenPortInBrowserAction.ID,
		title: OpenPortInBrowserAction.LABEL,
		icon: Codicon.globe
	},
	when: ContextKeyExpr.or(TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded), TunnelTypeContextKey.isEqualTo(TunnelType.Detected))
}));
MenuRegistry.appendMenuItem(MenuId.TunnelInline, ({
	order: 0,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.TREEITEM_LABEL,
		icon: Codicon.plus
	},
	when: TunnelTypeContextKey.isEqualTo(TunnelType.Candidate)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelInline, ({
	order: 2,
	command: {
		id: ClosePortAction.INLINE_ID,
		title: ClosePortAction.LABEL,
		icon: Codicon.x
	},
	when: TunnelCloseableContextKey
}));
