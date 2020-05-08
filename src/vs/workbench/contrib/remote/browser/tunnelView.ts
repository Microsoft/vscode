/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/tunnelView';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { IViewDescriptor, IEditableData, IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { WorkbenchAsyncDataTree, TreeResourceNavigator } from 'vs/platform/list/browser/listService';
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
import { ActionBar, ActionViewItem, IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { ActionRunner, IAction } from 'vs/base/common/actions';
import { IMenuService, MenuId, IMenu, MenuRegistry, MenuItemAction, ILocalizedString } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions, createAndFillInActionBarActions, ContextAwareMenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IRemoteExplorerService, TunnelModel, MakeAddress, TunnelType, ITunnelItem, Tunnel } from 'vs/workbench/services/remote/common/remoteExplorerService';
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

export const forwardedPortsViewEnabled = new RawContextKey<boolean>('forwardedPortsViewEnabled', false);

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
	groups(): Promise<ITunnelGroup[]>;
}

export class TunnelViewModel extends Disposable implements ITunnelViewModel {
	private _onForwardedPortsChanged: Emitter<void> = new Emitter();
	public onForwardedPortsChanged: Event<void> = this._onForwardedPortsChanged.event;
	private model: TunnelModel;
	private _input: TunnelItem;
	private _candidates: Map<string, { host: string, port: number, detail: string }> = new Map();

	constructor(
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService) {
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
			description: ''
		};
	}

	async groups(): Promise<ITunnelGroup[]> {
		const groups: ITunnelGroup[] = [];
		this._candidates = new Map();
		(await this.model.candidates).forEach(candidate => {
			this._candidates.set(MakeAddress(candidate.host, candidate.port), candidate);
		});
		if ((this.model.forwarded.size > 0) || this.remoteExplorerService.getEditableData(undefined)) {
			groups.push({
				label: nls.localize('remote.tunnelsView.forwarded', "Forwarded"),
				tunnelType: TunnelType.Forwarded,
				items: this.forwarded
			});
		}
		if (this.model.detected.size > 0) {
			groups.push({
				label: nls.localize('remote.tunnelsView.detected', "Existing Tunnels"),
				tunnelType: TunnelType.Detected,
				items: this.detected
			});
		}
		const candidates = await this.candidates;
		if (candidates.length > 0) {
			groups.push({
				label: nls.localize('remote.tunnelsView.candidates', "Not Forwarded"),
				tunnelType: TunnelType.Candidate,
				items: candidates
			});
		}
		if (groups.length === 0) {
			groups.push(this._input);
		}
		return groups;
	}

	private addProcessInfoFromCandidate(tunnelItem: ITunnelItem) {
		const key = MakeAddress(tunnelItem.remoteHost, tunnelItem.remotePort);
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
			const key = MakeAddress(value.host, value.port);
			if (!this.model.forwarded.has(key) && !this.model.detected.has(key)) {
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
	actionBar: ActionBar;
}

class TunnelTreeRenderer extends Disposable implements ITreeRenderer<ITunnelGroup | ITunnelItem, ITunnelItem, ITunnelTemplateData> {
	static readonly ITEM_HEIGHT = 22;
	static readonly TREE_TEMPLATE_ID = 'tunnelItemTemplate';

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
		dom.addClass(container, 'custom-view-tree-node-item');
		const iconLabel = new IconLabel(container, { supportHighlights: true });
		// dom.addClass(iconLabel.element, 'tunnel-view-label');
		const actionsContainer = dom.append(iconLabel.element, dom.$('.actions'));
		const actionBar = new ActionBar(actionsContainer, {
			// actionViewItemProvider: undefined // this.actionViewItemProvider
			actionViewItemProvider: (action: IAction) => {
				if (action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(ContextAwareMenuEntryActionViewItem, action);
				}

				return undefined;
			}
		});

		return { iconLabel, actionBar, container, elementDisposable: Disposable.None };
	}

	private isTunnelItem(item: ITunnelGroup | ITunnelItem): item is ITunnelItem {
		return !!((<ITunnelItem>item).remotePort);
	}

	renderElement(element: ITreeNode<ITunnelGroup | ITunnelItem, ITunnelGroup | ITunnelItem>, index: number, templateData: ITunnelTemplateData): void {
		templateData.elementDisposable.dispose();
		const node = element.element;

		// reset
		templateData.actionBar.clear();
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
	}

	private renderInputBox(container: HTMLElement, editableData: IEditableData): IDisposable {
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
			inputBox.element.style.display = 'none';
			const value = inputBox.value;
			dispose(toDispose);
			if (finishEditing) {
				editableData.onFinish(value, success);
			}
		});

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

	getChildren(element: ITunnelViewModel | ITunnelItem | ITunnelGroup) {
		if (element instanceof TunnelViewModel) {
			return element.groups();
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
		return new TunnelItem(type, tunnel.remoteHost, tunnel.remotePort, tunnel.localAddress, tunnel.localPort, closeable === undefined ? tunnel.closeable : closeable, tunnel.name, tunnel.description);
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
	) { }
	get label(): string {
		if (this.name) {
			return nls.localize('remote.tunnelsView.forwardedPortLabel0', "{0}", this.name);
		} else if (this.localAddress && (this.remoteHost !== 'localhost')) {
			return nls.localize('remote.tunnelsView.forwardedPortLabel2', "{0}:{1} \u2192 {2}", this.remoteHost, this.remotePort, this.localAddress);
		} else if (this.localAddress) {
			return nls.localize('remote.tunnelsView.forwardedPortLabel3', "{0} \u2192 {1}", this.remotePort, this.localAddress);
		} else if (this.remoteHost !== 'localhost') {
			return nls.localize('remote.tunnelsView.forwardedPortLabel4', "{0}:{1}", this.remoteHost, this.remotePort);
		} else {
			return nls.localize('remote.tunnelsView.forwardedPortLabel5', "{0}", this.remotePort);
		}
	}

	set description(description: string | undefined) {
		this._description = description;
	}

	get description(): string | undefined {
		if (this._description) {
			return this._description;
		} else if (this.name) {
			return nls.localize('remote.tunnelsView.forwardedPortDescription0', "{0} to {1}", this.remotePort, this.localAddress);
		}
		return undefined;
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
	static readonly ID = '~remote.forwardedPorts';
	static readonly TITLE = nls.localize('remote.tunnel', "Forwarded Ports");
	private tree!: TunnelDataTree;
	private tunnelTypeContext: IContextKey<TunnelType>;
	private tunnelCloseableContext: IContextKey<boolean>;
	private tunnelViewFocusContext: IContextKey<boolean>;
	private tunnelViewSelectionContext: IContextKey<ITunnelItem | undefined>;
	private portChangableContextKey: IContextKey<boolean>;

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
		@INotificationService private readonly notificationService: INotificationService,
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
		dom.addClass(treeContainer, 'file-icon-themable-tree');
		dom.addClass(treeContainer, 'show-file-icons');

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
			this.tree.updateChildren(undefined, true);
		}));

		const navigator = this._register(new TreeResourceNavigator(this.tree, { openOnFocus: false, openOnSelection: false }));

		this._register(Event.debounce(navigator.onDidOpenResource, (last, event) => event, 75, true)(e => {
			if (e.element && (e.element.tunnelType === TunnelType.Add)) {
				this.commandService.executeCommand(ForwardPortAction.INLINE_ID);
			}
		}));

		this._register(this.remoteExplorerService.onDidChangeEditable(async e => {
			const isEditing = !!this.remoteExplorerService.getEditableData(e);

			if (!isEditing) {
				dom.removeClass(treeContainer, 'highlight');
			}

			await this.tree.updateChildren(undefined, false);

			if (isEditing) {
				dom.addClass(treeContainer, 'highlight');
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
		this._register(createAndFillInContextMenuActions(this.contributedContextMenu, { shouldForwardArgs: true }, actions, this.contextMenuService));

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

	getActionViewItem(action: IAction): IActionViewItem | undefined {
		return action instanceof MenuItemAction ? new ContextAwareMenuEntryActionViewItem(action, this.keybindingService, this.notificationService, this.contextMenuService) : undefined;
	}
}

export class TunnelPanelDescriptor implements IViewDescriptor {
	readonly id = TunnelPanel.ID;
	readonly name = TunnelPanel.TITLE;
	readonly ctorDescriptor: SyncDescriptor<TunnelPanel>;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly workspace = true;
	readonly group = 'details@0';
	readonly remoteAuthority?: string | string[];

	constructor(viewModel: ITunnelViewModel, environmentService: IWorkbenchEnvironmentService) {
		this.ctorDescriptor = new SyncDescriptor(TunnelPanel, [viewModel]);
		this.remoteAuthority = environmentService.configuration.remoteAuthority ? environmentService.configuration.remoteAuthority.split('+')[0] : undefined;
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

namespace ForwardPortAction {
	export const INLINE_ID = 'remote.tunnel.forwardInline';
	export const COMMANDPALETTE_ID = 'remote.tunnel.forwardCommandPalette';
	export const LABEL: ILocalizedString = { value: nls.localize('remote.tunnel.forward', "Forward a Port"), original: 'Forward a Port' };
	export const TREEITEM_LABEL = nls.localize('remote.tunnel.forwardItem', "Forward Port");
	const forwardPrompt = nls.localize('remote.tunnel.forwardPrompt', "Port number or address (eg. 3000 or 10.10.10.10:2000).");

	function parseInput(value: string): { host: string, port: number } | undefined {
		const matches = value.match(/^([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\:|localhost:)?([0-9]+)$/);
		if (!matches) {
			return undefined;
		}
		return { host: matches[1]?.substring(0, matches[1].length - 1) || 'localhost', port: Number(matches[2]) };
	}

	function validateInput(value: string): string | null {
		const parsed = parseInput(value);
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
						if (success && (parsed = parseInput(value))) {
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
			if (value && (parsed = parseInput(value))) {
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

namespace OpenPortInBrowserAction {
	export const ID = 'remote.tunnel.open';
	export const LABEL = nls.localize('remote.tunnel.open', "Open in Browser");

	export function handler(): ICommandHandler {
		return async (accessor, arg) => {
			if (arg instanceof TunnelItem) {
				const model = accessor.get(IRemoteExplorerService).tunnelModel;
				const openerService = accessor.get(IOpenerService);
				const key = MakeAddress(arg.remoteHost, arg.remotePort);
				const tunnel = model.forwarded.get(key) || model.detected.get(key);
				let address: string | undefined;
				if (tunnel && tunnel.localAddress && (address = model.address(tunnel.remoteHost, tunnel.remotePort))) {
					return openerService.open(URI.parse('http://' + address));
				}
				return Promise.resolve();
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

namespace RefreshTunnelViewAction {
	export const ID = 'remote.tunnel.refresh';
	export const LABEL = nls.localize('remote.tunnel.refreshView', "Refresh");

	export function handler(): ICommandHandler {
		return (accessor, arg) => {
			const remoteExplorerService = accessor.get(IRemoteExplorerService);
			return remoteExplorerService.refresh();
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
								notificationService.warn(nls.localize('remote.tunnel.changeLocalPortNumber', "The local port {0} is not available. Port number {1} has been used instead", value, newForward.tunnelLocalPort));
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
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: CopyAddressAction.INLINE_ID,
	weight: KeybindingWeight.WorkbenchContrib + tunnelViewCommandsWeightBonus,
	when: ContextKeyExpr.or(ContextKeyExpr.and(TunnelViewFocusContextKey, TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded)), ContextKeyExpr.and(TunnelViewFocusContextKey, TunnelTypeContextKey.isEqualTo(TunnelType.Detected))),
	primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
	handler: CopyAddressAction.inlineHandler()
});
CommandsRegistry.registerCommand(CopyAddressAction.COMMANDPALETTE_ID, CopyAddressAction.commandPaletteHandler());
CommandsRegistry.registerCommand(RefreshTunnelViewAction.ID, RefreshTunnelViewAction.handler());
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
MenuRegistry.appendMenuItem(MenuId.TunnelTitle, ({
	group: 'navigation',
	order: 0,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.LABEL,
		icon: { id: 'codicon/plus' }
	}
}));
MenuRegistry.appendMenuItem(MenuId.TunnelTitle, ({
	group: 'navigation',
	order: 1,
	command: {
		id: RefreshTunnelViewAction.ID,
		title: RefreshTunnelViewAction.LABEL,
		icon: { id: 'codicon/refresh' }
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
		icon: { id: 'codicon/globe' }
	},
	when: ContextKeyExpr.or(TunnelTypeContextKey.isEqualTo(TunnelType.Forwarded), TunnelTypeContextKey.isEqualTo(TunnelType.Detected))
}));
MenuRegistry.appendMenuItem(MenuId.TunnelInline, ({
	order: 0,
	command: {
		id: ForwardPortAction.INLINE_ID,
		title: ForwardPortAction.TREEITEM_LABEL,
		icon: { id: 'codicon/plus' }
	},
	when: TunnelTypeContextKey.isEqualTo(TunnelType.Candidate)
}));
MenuRegistry.appendMenuItem(MenuId.TunnelInline, ({
	order: 2,
	command: {
		id: ClosePortAction.INLINE_ID,
		title: ClosePortAction.LABEL,
		icon: { id: 'codicon/x' }
	},
	when: TunnelCloseableContextKey
}));
