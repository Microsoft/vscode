/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/paneviewlet';
import * as nls from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { ColorIdentifier, activeContrastBorder, foreground } from 'vs/platform/theme/common/colorRegistry';
import { attachStyler, IColorMapping, attachButtonStyler, attachLinkStyler, attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { SIDE_BAR_DRAG_AND_DROP_BACKGROUND, SIDE_BAR_SECTION_HEADER_FOREGROUND, SIDE_BAR_SECTION_HEADER_BACKGROUND, SIDE_BAR_SECTION_HEADER_BORDER, PANEL_BACKGROUND, SIDE_BAR_BACKGROUND, PANEL_SECTION_HEADER_FOREGROUND, PANEL_SECTION_HEADER_BACKGROUND, PANEL_SECTION_HEADER_BORDER, PANEL_SECTION_DRAG_AND_DROP_BACKGROUND, PANEL_SECTION_BORDER } from 'vs/workbench/common/theme';
import { after, append, $, trackFocus, EventType, isAncestor, Dimension, addDisposableListener, createCSSRule, asCSSUrl } from 'vs/base/browser/dom';
import { IDisposable, combinedDisposable, dispose, toDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IAction, Separator, IActionViewItem } from 'vs/base/common/actions';
import { ActionsOrientation, prepareActions } from 'vs/base/browser/ui/actionbar/actionbar';
import { Registry } from 'vs/platform/registry/common/platform';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, Themable, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { PaneView, IPaneViewOptions, IPaneOptions, Pane, IPaneStyles } from 'vs/base/browser/ui/splitview/paneview';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { Extensions as ViewContainerExtensions, IView, FocusedViewContext, IViewDescriptor, ViewContainer, IViewDescriptorService, ViewContainerLocation, IViewPaneContainer, IViewsRegistry, IViewContentDescriptor, IAddedViewDescriptorRef, IViewDescriptorRef, IViewContainerModel, defaultViewIcon } from 'vs/workbench/common/views';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { assertIsDefined } from 'vs/base/common/types';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { Component } from 'vs/workbench/common/component';
import { MenuId, MenuItemAction, registerAction2, Action2, IAction2Options, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { MenuEntryActionViewItem, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ViewMenuActions } from 'vs/workbench/browser/parts/views/viewMenuActions';
import { parseLinkedText } from 'vs/base/common/linkedText';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { Button } from 'vs/base/browser/ui/button/button';
import { Link } from 'vs/platform/opener/browser/link';
import { CompositeDragAndDropObserver, DragAndDropObserver, toggleDropEffect } from 'vs/workbench/browser/dnd';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { CompositeProgressIndicator } from 'vs/workbench/services/progress/browser/progressIndicator';
import { IProgressIndicator } from 'vs/platform/progress/common/progress';
import { RunOnceScheduler } from 'vs/base/common/async';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { URI } from 'vs/base/common/uri';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { Codicon } from 'vs/base/common/codicons';

export interface IPaneColors extends IColorMapping {
	dropBackground?: ColorIdentifier;
	headerForeground?: ColorIdentifier;
	headerBackground?: ColorIdentifier;
	headerBorder?: ColorIdentifier;
	leftBorder?: ColorIdentifier;
}

export interface IViewPaneOptions extends IPaneOptions {
	id: string;
	showActionsAlways?: boolean;
	titleMenuId?: MenuId;
}

type WelcomeActionClassification = {
	viewId: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	uri: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

const viewPaneContainerExpandedIcon = registerIcon('view-pane-container-expanded', Codicon.chevronDown, nls.localize('viewPaneContainerExpandedIcon', 'Icon for an expanded view pane container.'));
const viewPaneContainerCollapsedIcon = registerIcon('view-pane-container-collapsed', Codicon.chevronRight, nls.localize('viewPaneContainerCollapsedIcon', 'Icon for a collapsed view pane container.'));

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

interface IItem {
	readonly descriptor: IViewContentDescriptor;
	visible: boolean;
}

class ViewWelcomeController {

	private _onDidChange = new Emitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private defaultItem: IItem | undefined;
	private items: IItem[] = [];
	get contents(): IViewContentDescriptor[] {
		const visibleItems = this.items.filter(v => v.visible);

		if (visibleItems.length === 0 && this.defaultItem) {
			return [this.defaultItem.descriptor];
		}

		return visibleItems.map(v => v.descriptor);
	}

	private contextKeyService: IContextKeyService;
	private disposables = new DisposableStore();

	constructor(
		private id: string,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		this.contextKeyService = contextKeyService.createScoped();
		this.disposables.add(this.contextKeyService);

		contextKeyService.onDidChangeContext(this.onDidChangeContext, this, this.disposables);
		Event.filter(viewsRegistry.onDidChangeViewWelcomeContent, id => id === this.id)(this.onDidChangeViewWelcomeContent, this, this.disposables);
		this.onDidChangeViewWelcomeContent();
	}

	private onDidChangeViewWelcomeContent(): void {
		const descriptors = viewsRegistry.getViewWelcomeContent(this.id);

		this.items = [];

		for (const descriptor of descriptors) {
			if (descriptor.when === 'default') {
				this.defaultItem = { descriptor, visible: true };
			} else {
				const visible = descriptor.when ? this.contextKeyService.contextMatchesRules(descriptor.when) : true;
				this.items.push({ descriptor, visible });
			}
		}

		this._onDidChange.fire();
	}

	private onDidChangeContext(): void {
		let didChange = false;

		for (const item of this.items) {
			if (!item.descriptor.when || item.descriptor.when === 'default') {
				continue;
			}

			const visible = this.contextKeyService.contextMatchesRules(item.descriptor.when);

			if (item.visible === visible) {
				continue;
			}

			item.visible = visible;
			didChange = true;
		}

		if (didChange) {
			this._onDidChange.fire();
		}
	}

	dispose(): void {
		this.disposables.dispose();
	}
}

export abstract class ViewPane extends Pane implements IView {

	private static readonly AlwaysShowActionsConfig = 'workbench.view.alwaysShowHeaderActions';

	private _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus: Event<void> = this._onDidFocus.event;

	private _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur: Event<void> = this._onDidBlur.event;

	private _onDidChangeBodyVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeBodyVisibility: Event<boolean> = this._onDidChangeBodyVisibility.event;

	protected _onDidChangeTitleArea = this._register(new Emitter<void>());
	readonly onDidChangeTitleArea: Event<void> = this._onDidChangeTitleArea.event;

	protected _onDidChangeViewWelcomeState = this._register(new Emitter<void>());
	readonly onDidChangeViewWelcomeState: Event<void> = this._onDidChangeViewWelcomeState.event;

	private focusedViewContextKey: IContextKey<string>;

	private _isVisible: boolean = false;
	readonly id: string;

	private _title: string;
	public get title(): string {
		return this._title;
	}

	private _titleDescription: string | undefined;
	public get titleDescription(): string | undefined {
		return this._titleDescription;
	}

	private readonly menuActions: ViewMenuActions;
	private progressBar!: ProgressBar;
	private progressIndicator!: IProgressIndicator;

	private toolbar?: ToolBar;
	private readonly showActionsAlways: boolean = false;
	private headerContainer?: HTMLElement;
	private titleContainer?: HTMLElement;
	private titleDescriptionContainer?: HTMLElement;
	private iconContainer?: HTMLElement;
	protected twistiesContainer?: HTMLElement;

	private bodyContainer!: HTMLElement;
	private viewWelcomeContainer!: HTMLElement;
	private viewWelcomeDisposable: IDisposable = Disposable.None;
	private viewWelcomeController: ViewWelcomeController;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IContextKeyService protected contextKeyService: IContextKeyService,
		@IViewDescriptorService protected viewDescriptorService: IViewDescriptorService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IOpenerService protected openerService: IOpenerService,
		@IThemeService protected themeService: IThemeService,
		@ITelemetryService protected telemetryService: ITelemetryService,
	) {
		super({ ...options, ...{ orientation: viewDescriptorService.getViewLocationById(options.id) === ViewContainerLocation.Panel ? Orientation.HORIZONTAL : Orientation.VERTICAL } });

		this.id = options.id;
		this._title = options.title;
		this._titleDescription = options.titleDescription;
		this.showActionsAlways = !!options.showActionsAlways;
		this.focusedViewContextKey = FocusedViewContext.bindTo(contextKeyService);

		this.menuActions = this._register(instantiationService.createInstance(ViewMenuActions, this.id, options.titleMenuId || MenuId.ViewTitle, MenuId.ViewTitleContext));
		this._register(this.menuActions.onDidChangeTitle(() => this.updateActions()));

		this.viewWelcomeController = new ViewWelcomeController(this.id, contextKeyService);
	}

	get headerVisible(): boolean {
		return super.headerVisible;
	}

	set headerVisible(visible: boolean) {
		super.headerVisible = visible;
		this.element.classList.toggle('merged-header', !visible);
	}

	setVisible(visible: boolean): void {
		if (this._isVisible !== visible) {
			this._isVisible = visible;

			if (this.isExpanded()) {
				this._onDidChangeBodyVisibility.fire(visible);
			}
		}
	}

	isVisible(): boolean {
		return this._isVisible;
	}

	isBodyVisible(): boolean {
		return this._isVisible && this.isExpanded();
	}

	setExpanded(expanded: boolean): boolean {
		const changed = super.setExpanded(expanded);
		if (changed) {
			this._onDidChangeBodyVisibility.fire(expanded);
		}
		if (this.twistiesContainer) {
			this.twistiesContainer.classList.remove(...ThemeIcon.asClassNameArray(this.getTwistyIcon(!expanded)));
			this.twistiesContainer.classList.add(...ThemeIcon.asClassNameArray(this.getTwistyIcon(expanded)));
		}
		return changed;
	}

	render(): void {
		super.render();

		const focusTracker = trackFocus(this.element);
		this._register(focusTracker);
		this._register(focusTracker.onDidFocus(() => {
			this.focusedViewContextKey.set(this.id);
			this._onDidFocus.fire();
		}));
		this._register(focusTracker.onDidBlur(() => {
			if (this.focusedViewContextKey.get() === this.id) {
				this.focusedViewContextKey.reset();
			}

			this._onDidBlur.fire();
		}));
	}

	protected renderHeader(container: HTMLElement): void {
		this.headerContainer = container;

		this.twistiesContainer = append(container, $(ThemeIcon.asCSSSelector(this.getTwistyIcon(this.isExpanded()))));

		this.renderHeaderTitle(container, this.title);

		const actions = append(container, $('.actions'));
		actions.classList.toggle('show', this.showActionsAlways);
		this.toolbar = new ToolBar(actions, this.contextMenuService, {
			orientation: ActionsOrientation.HORIZONTAL,
			actionViewItemProvider: action => this.getActionViewItem(action),
			ariaLabel: nls.localize('viewToolbarAriaLabel', "{0} actions", this.title),
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
			renderDropdownAsChildElement: true
		});

		this._register(this.toolbar);
		this.setActions();

		this._register(addDisposableListener(actions, EventType.CLICK, e => e.preventDefault()));

		this._register(this.viewDescriptorService.getViewContainerModel(this.viewDescriptorService.getViewContainerByViewId(this.id)!)!.onDidChangeContainerInfo(({ title }) => {
			this.updateTitle(this.title);
		}));

		const onDidRelevantConfigurationChange = Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration(ViewPane.AlwaysShowActionsConfig));
		this._register(onDidRelevantConfigurationChange(this.updateActionsVisibility, this));
		this.updateActionsVisibility();
	}

	protected getTwistyIcon(expanded: boolean): ThemeIcon {
		return expanded ? viewPaneContainerExpandedIcon : viewPaneContainerCollapsedIcon;
	}

	style(styles: IPaneStyles): void {
		super.style(styles);

		const icon = this.getIcon();
		if (this.iconContainer) {
			const fgColor = styles.headerForeground || this.themeService.getColorTheme().getColor(foreground);
			if (URI.isUri(icon)) {
				// Apply background color to activity bar item provided with iconUrls
				this.iconContainer.style.backgroundColor = fgColor ? fgColor.toString() : '';
				this.iconContainer.style.color = '';
			} else {
				// Apply foreground color to activity bar items provided with codicons
				this.iconContainer.style.color = fgColor ? fgColor.toString() : '';
				this.iconContainer.style.backgroundColor = '';
			}
		}
	}

	private getIcon(): ThemeIcon | URI {
		return this.viewDescriptorService.getViewDescriptorById(this.id)?.containerIcon || defaultViewIcon;
	}

	protected renderHeaderTitle(container: HTMLElement, title: string): void {
		this.iconContainer = append(container, $('.icon', undefined));
		const icon = this.getIcon();

		let cssClass: string | undefined = undefined;
		if (URI.isUri(icon)) {
			cssClass = `view-${this.id.replace(/[\.\:]/g, '-')}`;
			const iconClass = `.pane-header .icon.${cssClass}`;

			createCSSRule(iconClass, `
				mask: ${asCSSUrl(icon)} no-repeat 50% 50%;
				mask-size: 24px;
				-webkit-mask: ${asCSSUrl(icon)} no-repeat 50% 50%;
				-webkit-mask-size: 16px;
			`);
		} else if (ThemeIcon.isThemeIcon(icon)) {
			cssClass = ThemeIcon.asClassName(icon);
		}

		if (cssClass) {
			this.iconContainer.classList.add(...cssClass.split(' '));
		}

		const calculatedTitle = this.calculateTitle(title);
		this.titleContainer = append(container, $('h3.title', { title: calculatedTitle }, calculatedTitle));

		if (this._titleDescription) {
			this.setTitleDescription(this._titleDescription);
		}

		this.iconContainer.title = calculatedTitle;
		this.iconContainer.setAttribute('aria-label', calculatedTitle);
	}

	protected updateTitle(title: string): void {
		const calculatedTitle = this.calculateTitle(title);
		if (this.titleContainer) {
			this.titleContainer.textContent = calculatedTitle;
			this.titleContainer.setAttribute('title', calculatedTitle);
		}

		if (this.iconContainer) {
			this.iconContainer.title = calculatedTitle;
			this.iconContainer.setAttribute('aria-label', calculatedTitle);
		}

		this._title = title;
		this._onDidChangeTitleArea.fire();
	}

	private setTitleDescription(description: string | undefined) {
		if (this.titleDescriptionContainer) {
			this.titleDescriptionContainer.textContent = description ?? '';
			this.titleDescriptionContainer.setAttribute('title', description ?? '');
		}
		else if (description && this.titleContainer) {
			this.titleDescriptionContainer = after(this.titleContainer, $('span.description', { title: description }, description));
		}
	}

	protected updateTitleDescription(description?: string | undefined): void {
		this.setTitleDescription(description);

		this._titleDescription = description;
		this._onDidChangeTitleArea.fire();
	}

	private calculateTitle(title: string): string {
		const viewContainer = this.viewDescriptorService.getViewContainerByViewId(this.id)!;
		const model = this.viewDescriptorService.getViewContainerModel(viewContainer);
		const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(this.id);
		const isDefault = this.viewDescriptorService.getDefaultContainerById(this.id) === viewContainer;

		if (!isDefault && viewDescriptor?.containerTitle && model.title !== viewDescriptor.containerTitle) {
			return `${viewDescriptor.containerTitle}: ${title}`;
		}

		return title;
	}

	private scrollableElement!: DomScrollableElement;

	protected renderBody(container: HTMLElement): void {
		this.bodyContainer = container;

		const viewWelcomeContainer = append(container, $('.welcome-view'));
		this.viewWelcomeContainer = $('.welcome-view-content', { tabIndex: 0 });
		this.scrollableElement = this._register(new DomScrollableElement(this.viewWelcomeContainer, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Visible,
		}));

		append(viewWelcomeContainer, this.scrollableElement.getDomNode());

		const onViewWelcomeChange = Event.any(this.viewWelcomeController.onDidChange, this.onDidChangeViewWelcomeState);
		this._register(onViewWelcomeChange(this.updateViewWelcome, this));
		this.updateViewWelcome();
	}

	protected layoutBody(height: number, width: number): void {
		this.viewWelcomeContainer.style.height = `${height}px`;
		this.viewWelcomeContainer.style.width = `${width}px`;
		this.scrollableElement.scanDomNode();
	}

	getProgressIndicator() {
		if (this.progressBar === undefined) {
			// Progress bar
			this.progressBar = this._register(new ProgressBar(this.element));
			this._register(attachProgressBarStyler(this.progressBar, this.themeService));
			this.progressBar.hide();
		}

		if (this.progressIndicator === undefined) {
			this.progressIndicator = this.instantiationService.createInstance(CompositeProgressIndicator, assertIsDefined(this.progressBar), this.id, this.isBodyVisible());
		}
		return this.progressIndicator;
	}

	protected getProgressLocation(): string {
		return this.viewDescriptorService.getViewContainerByViewId(this.id)!.id;
	}

	protected getBackgroundColor(): string {
		return this.viewDescriptorService.getViewLocationById(this.id) === ViewContainerLocation.Panel ? PANEL_BACKGROUND : SIDE_BAR_BACKGROUND;
	}

	focus(): void {
		if (this.shouldShowWelcome()) {
			this.viewWelcomeContainer.focus();
		} else if (this.element) {
			this.element.focus();
			this._onDidFocus.fire();
		}
	}

	private setActions(): void {
		if (this.toolbar) {
			this.toolbar.setActions(prepareActions(this.getActions()), prepareActions(this.getSecondaryActions()));
			this.toolbar.context = this.getActionsContext();
		}
	}

	private updateActionsVisibility(): void {
		if (!this.headerContainer) {
			return;
		}
		const shouldAlwaysShowActions = this.configurationService.getValue<boolean>('workbench.view.alwaysShowHeaderActions');
		this.headerContainer.classList.toggle('actions-always-visible', shouldAlwaysShowActions);
	}

	protected updateActions(): void {
		this.setActions();
		this._onDidChangeTitleArea.fire();
	}

	getActions(): IAction[] {
		return this.menuActions.getPrimaryActions();
	}

	getSecondaryActions(): IAction[] {
		return this.menuActions.getSecondaryActions();
	}

	getContextMenuActions(): IAction[] {
		return this.menuActions.getContextMenuActions();
	}

	getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action instanceof MenuItemAction) {
			return this.instantiationService.createInstance(MenuEntryActionViewItem, action);
		} else if (action instanceof SubmenuItemAction) {
			return this.instantiationService.createInstance(SubmenuEntryActionViewItem, action);
		}
		return undefined;
	}

	getActionsContext(): unknown {
		return undefined;
	}

	getOptimalWidth(): number {
		return 0;
	}

	saveState(): void {
		// Subclasses to implement for saving state
	}

	private updateViewWelcome(): void {
		this.viewWelcomeDisposable.dispose();

		if (!this.shouldShowWelcome()) {
			this.bodyContainer.classList.remove('welcome');
			this.viewWelcomeContainer.innerText = '';
			this.scrollableElement.scanDomNode();
			return;
		}

		const contents = this.viewWelcomeController.contents;

		if (contents.length === 0) {
			this.bodyContainer.classList.remove('welcome');
			this.viewWelcomeContainer.innerText = '';
			this.scrollableElement.scanDomNode();
			return;
		}

		const disposables = new DisposableStore();
		this.bodyContainer.classList.add('welcome');
		this.viewWelcomeContainer.innerText = '';

		for (const { content, precondition } of contents) {
			const lines = content.split('\n');

			for (let line of lines) {
				line = line.trim();

				if (!line) {
					continue;
				}

				const linkedText = parseLinkedText(line);

				if (linkedText.nodes.length === 1 && typeof linkedText.nodes[0] !== 'string') {
					const node = linkedText.nodes[0];
					const button = new Button(this.viewWelcomeContainer, { title: node.title, supportCodicons: true });
					button.label = node.label;
					button.onDidClick(_ => {
						this.telemetryService.publicLog2<{ viewId: string, uri: string }, WelcomeActionClassification>('views.welcomeAction', { viewId: this.id, uri: node.href });
						this.openerService.open(node.href);
					}, null, disposables);
					disposables.add(button);
					disposables.add(attachButtonStyler(button, this.themeService));

					if (precondition) {
						const updateEnablement = () => button.enabled = this.contextKeyService.contextMatchesRules(precondition);
						updateEnablement();

						const keys = new Set();
						precondition.keys().forEach(key => keys.add(key));
						const onDidChangeContext = Event.filter(this.contextKeyService.onDidChangeContext, e => e.affectsSome(keys));
						onDidChangeContext(updateEnablement, null, disposables);
					}
				} else {
					const p = append(this.viewWelcomeContainer, $('p'));

					for (const node of linkedText.nodes) {
						if (typeof node === 'string') {
							append(p, document.createTextNode(node));
						} else {
							const link = this.instantiationService.createInstance(Link, node);
							append(p, link.el);
							disposables.add(link);
							disposables.add(attachLinkStyler(link, this.themeService));
						}
					}
				}
			}
		}

		this.scrollableElement.scanDomNode();
		this.viewWelcomeDisposable = disposables;
	}

	shouldShowWelcome(): boolean {
		return false;
	}
}

export interface IViewPaneContainerOptions extends IPaneViewOptions {
	mergeViewWithContainerWhenSingleView: boolean;
}

interface IViewPaneItem {
	pane: ViewPane;
	disposable: IDisposable;
}

const enum DropDirection {
	UP,
	DOWN,
	LEFT,
	RIGHT
}

type BoundingRect = { top: number, left: number, bottom: number, right: number };

class ViewPaneDropOverlay extends Themable {

	private static readonly OVERLAY_ID = 'monaco-pane-drop-overlay';

	private container!: HTMLElement;
	private overlay!: HTMLElement;

	private _currentDropOperation: DropDirection | undefined;

	// private currentDropOperation: IDropOperation | undefined;
	private _disposed: boolean | undefined;

	private cleanupOverlayScheduler: RunOnceScheduler;

	get currentDropOperation(): DropDirection | undefined {
		return this._currentDropOperation;
	}

	constructor(
		private paneElement: HTMLElement,
		private orientation: Orientation | undefined,
		private bounds: BoundingRect | undefined,
		protected location: ViewContainerLocation,
		protected themeService: IThemeService,
	) {
		super(themeService);
		this.cleanupOverlayScheduler = this._register(new RunOnceScheduler(() => this.dispose(), 300));

		this.create();
	}

	get disposed(): boolean {
		return !!this._disposed;
	}

	private create(): void {
		// Container
		this.container = document.createElement('div');
		this.container.id = ViewPaneDropOverlay.OVERLAY_ID;
		this.container.style.top = '0px';

		// Parent
		this.paneElement.appendChild(this.container);
		this.paneElement.classList.add('dragged-over');
		this._register(toDisposable(() => {
			this.paneElement.removeChild(this.container);
			this.paneElement.classList.remove('dragged-over');
		}));

		// Overlay
		this.overlay = document.createElement('div');
		this.overlay.classList.add('pane-overlay-indicator');
		this.container.appendChild(this.overlay);

		// Overlay Event Handling
		this.registerListeners();

		// Styles
		this.updateStyles();
	}

	protected updateStyles(): void {

		// Overlay drop background
		this.overlay.style.backgroundColor = this.getColor(this.location === ViewContainerLocation.Panel ? PANEL_SECTION_DRAG_AND_DROP_BACKGROUND : SIDE_BAR_DRAG_AND_DROP_BACKGROUND) || '';

		// Overlay contrast border (if any)
		const activeContrastBorderColor = this.getColor(activeContrastBorder);
		this.overlay.style.outlineColor = activeContrastBorderColor || '';
		this.overlay.style.outlineOffset = activeContrastBorderColor ? '-2px' : '';
		this.overlay.style.outlineStyle = activeContrastBorderColor ? 'dashed' : '';
		this.overlay.style.outlineWidth = activeContrastBorderColor ? '2px' : '';

		this.overlay.style.borderColor = activeContrastBorderColor || '';
		this.overlay.style.borderStyle = 'solid' || '';
		this.overlay.style.borderWidth = '0px';
	}

	private registerListeners(): void {
		this._register(new DragAndDropObserver(this.container, {
			onDragEnter: e => undefined,
			onDragOver: e => {

				// Position overlay
				this.positionOverlay(e.offsetX, e.offsetY);

				// Make sure to stop any running cleanup scheduler to remove the overlay
				if (this.cleanupOverlayScheduler.isScheduled()) {
					this.cleanupOverlayScheduler.cancel();
				}
			},

			onDragLeave: e => this.dispose(),
			onDragEnd: e => this.dispose(),

			onDrop: e => {
				// Dispose overlay
				this.dispose();
			}
		}));

		this._register(addDisposableListener(this.container, EventType.MOUSE_OVER, () => {
			// Under some circumstances we have seen reports where the drop overlay is not being
			// cleaned up and as such the editor area remains under the overlay so that you cannot
			// type into the editor anymore. This seems related to using VMs and DND via host and
			// guest OS, though some users also saw it without VMs.
			// To protect against this issue we always destroy the overlay as soon as we detect a
			// mouse event over it. The delay is used to guarantee we are not interfering with the
			// actual DROP event that can also trigger a mouse over event.
			if (!this.cleanupOverlayScheduler.isScheduled()) {
				this.cleanupOverlayScheduler.schedule();
			}
		}));
	}

	private positionOverlay(mousePosX: number, mousePosY: number): void {
		const paneWidth = this.paneElement.clientWidth;
		const paneHeight = this.paneElement.clientHeight;

		const splitWidthThreshold = paneWidth / 2;
		const splitHeightThreshold = paneHeight / 2;

		let dropDirection: DropDirection | undefined;

		if (this.orientation === Orientation.VERTICAL) {
			if (mousePosY < splitHeightThreshold) {
				dropDirection = DropDirection.UP;
			} else if (mousePosY >= splitHeightThreshold) {
				dropDirection = DropDirection.DOWN;
			}
		} else if (this.orientation === Orientation.HORIZONTAL) {
			if (mousePosX < splitWidthThreshold) {
				dropDirection = DropDirection.LEFT;
			} else if (mousePosX >= splitWidthThreshold) {
				dropDirection = DropDirection.RIGHT;
			}
		}

		// Draw overlay based on split direction
		switch (dropDirection) {
			case DropDirection.UP:
				this.doPositionOverlay({ top: '0', left: '0', width: '100%', height: '50%' });
				break;
			case DropDirection.DOWN:
				this.doPositionOverlay({ bottom: '0', left: '0', width: '100%', height: '50%' });
				break;
			case DropDirection.LEFT:
				this.doPositionOverlay({ top: '0', left: '0', width: '50%', height: '100%' });
				break;
			case DropDirection.RIGHT:
				this.doPositionOverlay({ top: '0', right: '0', width: '50%', height: '100%' });
				break;
			default:
				// const top = this.bounds?.top || 0;
				// const left = this.bounds?.bottom || 0;

				let top = '0';
				let left = '0';
				let width = '100%';
				let height = '100%';
				if (this.bounds) {
					const boundingRect = this.container.getBoundingClientRect();
					top = `${this.bounds.top - boundingRect.top}px`;
					left = `${this.bounds.left - boundingRect.left}px`;
					height = `${this.bounds.bottom - this.bounds.top}px`;
					width = `${this.bounds.right - this.bounds.left}px`;
				}

				this.doPositionOverlay({ top, left, width, height });
		}

		if ((this.orientation === Orientation.VERTICAL && paneHeight <= 25) ||
			(this.orientation === Orientation.HORIZONTAL && paneWidth <= 25)) {
			this.doUpdateOverlayBorder(dropDirection);
		} else {
			this.doUpdateOverlayBorder(undefined);
		}

		// Make sure the overlay is visible now
		this.overlay.style.opacity = '1';

		// Enable transition after a timeout to prevent initial animation
		setTimeout(() => this.overlay.classList.add('overlay-move-transition'), 0);

		// Remember as current split direction
		this._currentDropOperation = dropDirection;
	}

	private doUpdateOverlayBorder(direction: DropDirection | undefined): void {
		this.overlay.style.borderTopWidth = direction === DropDirection.UP ? '2px' : '0px';
		this.overlay.style.borderLeftWidth = direction === DropDirection.LEFT ? '2px' : '0px';
		this.overlay.style.borderBottomWidth = direction === DropDirection.DOWN ? '2px' : '0px';
		this.overlay.style.borderRightWidth = direction === DropDirection.RIGHT ? '2px' : '0px';
	}

	private doPositionOverlay(options: { top?: string, bottom?: string, left?: string, right?: string, width: string, height: string }): void {

		// Container
		this.container.style.height = '100%';

		// Overlay
		this.overlay.style.top = options.top || '';
		this.overlay.style.left = options.left || '';
		this.overlay.style.bottom = options.bottom || '';
		this.overlay.style.right = options.right || '';
		this.overlay.style.width = options.width;
		this.overlay.style.height = options.height;
	}


	contains(element: HTMLElement): boolean {
		return element === this.container || element === this.overlay;
	}

	dispose(): void {
		super.dispose();

		this._disposed = true;
	}
}

export class ViewPaneContainer extends Component implements IViewPaneContainer {

	readonly viewContainer: ViewContainer;
	private lastFocusedPane: ViewPane | undefined;
	private paneItems: IViewPaneItem[] = [];
	private paneview?: PaneView;

	private visible: boolean = false;

	private areExtensionsReady: boolean = false;

	private didLayout = false;
	private dimension: Dimension | undefined;

	private readonly visibleViewsCountFromCache: number | undefined;
	private readonly visibleViewsStorageId: string;
	protected readonly viewContainerModel: IViewContainerModel;
	private viewDisposables: IDisposable[] = [];

	private readonly _onTitleAreaUpdate: Emitter<void> = this._register(new Emitter<void>());
	readonly onTitleAreaUpdate: Event<void> = this._onTitleAreaUpdate.event;

	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private readonly _onDidAddViews = this._register(new Emitter<IView[]>());
	readonly onDidAddViews = this._onDidAddViews.event;

	private readonly _onDidRemoveViews = this._register(new Emitter<IView[]>());
	readonly onDidRemoveViews = this._onDidRemoveViews.event;

	private readonly _onDidChangeViewVisibility = this._register(new Emitter<IView>());
	readonly onDidChangeViewVisibility = this._onDidChangeViewVisibility.event;

	get onDidSashChange(): Event<number> {
		return assertIsDefined(this.paneview).onDidSashChange;
	}

	protected get panes(): ViewPane[] {
		return this.paneItems.map(i => i.pane);
	}

	get views(): IView[] {
		return this.panes;
	}

	get length(): number {
		return this.paneItems.length;
	}

	constructor(
		id: string,
		private options: IViewPaneContainerOptions,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IWorkbenchLayoutService protected layoutService: IWorkbenchLayoutService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@ITelemetryService protected telemetryService: ITelemetryService,
		@IExtensionService protected extensionService: IExtensionService,
		@IThemeService protected themeService: IThemeService,
		@IStorageService protected storageService: IStorageService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IViewDescriptorService protected viewDescriptorService: IViewDescriptorService
	) {

		super(id, themeService, storageService);

		const container = this.viewDescriptorService.getViewContainerById(id);
		if (!container) {
			throw new Error('Could not find container');
		}


		this.viewContainer = container;
		this.visibleViewsStorageId = `${id}.numberOfVisibleViews`;
		this.visibleViewsCountFromCache = this.storageService.getNumber(this.visibleViewsStorageId, StorageScope.WORKSPACE, undefined);
		this._register(toDisposable(() => this.viewDisposables = dispose(this.viewDisposables)));
		this.viewContainerModel = this.viewDescriptorService.getViewContainerModel(container);
	}

	create(parent: HTMLElement): void {
		const options = this.options as IPaneViewOptions;
		options.orientation = this.orientation;
		this.paneview = this._register(new PaneView(parent, this.options));
		this._register(this.paneview.onDidDrop(({ from, to }) => this.movePane(from as ViewPane, to as ViewPane)));
		this._register(addDisposableListener(parent, EventType.CONTEXT_MENU, (e: MouseEvent) => this.showContextMenu(new StandardMouseEvent(e))));

		let overlay: ViewPaneDropOverlay | undefined;
		const getOverlayBounds: () => BoundingRect = () => {
			const fullSize = parent.getBoundingClientRect();
			const lastPane = this.panes[this.panes.length - 1].element.getBoundingClientRect();
			const top = this.orientation === Orientation.VERTICAL ? lastPane.bottom : fullSize.top;
			const left = this.orientation === Orientation.HORIZONTAL ? lastPane.right : fullSize.left;

			return {
				top,
				bottom: fullSize.bottom,
				left,
				right: fullSize.right,
			};
		};

		const inBounds = (bounds: BoundingRect, pos: { x: number, y: number }) => {
			return pos.x >= bounds.left && pos.x <= bounds.right && pos.y >= bounds.top && pos.y <= bounds.bottom;
		};


		let bounds: BoundingRect;

		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(parent, {
			onDragEnter: (e) => {
				bounds = getOverlayBounds();
				if (overlay && overlay.disposed) {
					overlay = undefined;
				}

				if (!overlay && inBounds(bounds, e.eventData)) {
					const dropData = e.dragAndDropData.getData();
					if (dropData.type === 'view') {

						const oldViewContainer = this.viewDescriptorService.getViewContainerByViewId(dropData.id);
						const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(dropData.id);

						if (oldViewContainer !== this.viewContainer && (!viewDescriptor || !viewDescriptor.canMoveView || this.viewContainer.rejectAddedViews)) {
							return;
						}

						overlay = new ViewPaneDropOverlay(parent, undefined, bounds, this.viewDescriptorService.getViewContainerLocation(this.viewContainer)!, this.themeService);
					}

					if (dropData.type === 'composite' && dropData.id !== this.viewContainer.id) {
						const container = this.viewDescriptorService.getViewContainerById(dropData.id)!;
						const viewsToMove = this.viewDescriptorService.getViewContainerModel(container).allViewDescriptors;

						if (!viewsToMove.some(v => !v.canMoveView) && viewsToMove.length > 0) {
							overlay = new ViewPaneDropOverlay(parent, undefined, bounds, this.viewDescriptorService.getViewContainerLocation(this.viewContainer)!, this.themeService);
						}
					}
				}
			},
			onDragOver: (e) => {
				if (overlay && overlay.disposed) {
					overlay = undefined;
				}

				if (overlay && !inBounds(bounds, e.eventData)) {
					overlay.dispose();
					overlay = undefined;
				}

				if (inBounds(bounds, e.eventData)) {
					toggleDropEffect(e.eventData.dataTransfer, 'move', overlay !== undefined);
				}
			},
			onDragLeave: (e) => {
				overlay?.dispose();
				overlay = undefined;
			},
			onDrop: (e) => {
				if (overlay) {
					const dropData = e.dragAndDropData.getData();
					const viewsToMove: IViewDescriptor[] = [];

					if (dropData.type === 'composite' && dropData.id !== this.viewContainer.id) {
						const container = this.viewDescriptorService.getViewContainerById(dropData.id)!;
						const allViews = this.viewDescriptorService.getViewContainerModel(container).allViewDescriptors;
						if (!allViews.some(v => !v.canMoveView)) {
							viewsToMove.push(...allViews);
						}
					} else if (dropData.type === 'view') {
						const oldViewContainer = this.viewDescriptorService.getViewContainerByViewId(dropData.id);
						const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(dropData.id);
						if (oldViewContainer !== this.viewContainer && viewDescriptor && viewDescriptor.canMoveView) {
							this.viewDescriptorService.moveViewsToContainer([viewDescriptor], this.viewContainer);
						}
					}

					const paneCount = this.panes.length;

					if (viewsToMove.length > 0) {
						this.viewDescriptorService.moveViewsToContainer(viewsToMove, this.viewContainer);
					}

					if (paneCount > 0) {
						for (const view of viewsToMove) {
							const paneToMove = this.panes.find(p => p.id === view.id);
							if (paneToMove) {
								this.movePane(paneToMove, this.panes[this.panes.length - 1]);
							}
						}
					}
				}

				overlay?.dispose();
				overlay = undefined;
			}
		}));

		this._register(this.onDidSashChange(() => this.saveViewSizes()));
		this._register(this.viewContainerModel.onDidAddVisibleViewDescriptors(added => this.onDidAddViewDescriptors(added)));
		this._register(this.viewContainerModel.onDidRemoveVisibleViewDescriptors(removed => this.onDidRemoveViewDescriptors(removed)));
		const addedViews: IAddedViewDescriptorRef[] = this.viewContainerModel.visibleViewDescriptors.map((viewDescriptor, index) => {
			const size = this.viewContainerModel.getSize(viewDescriptor.id);
			const collapsed = this.viewContainerModel.isCollapsed(viewDescriptor.id);
			return ({ viewDescriptor, index, size, collapsed });
		});
		if (addedViews.length) {
			this.onDidAddViewDescriptors(addedViews);
		}

		// Update headers after and title contributed views after available, since we read from cache in the beginning to know if the viewlet has single view or not. Ref #29609
		this.extensionService.whenInstalledExtensionsRegistered().then(() => {
			this.areExtensionsReady = true;
			if (this.panes.length) {
				this.updateTitleArea();
				this.updateViewHeaders();
			}
		});

		this._register(this.viewContainerModel.onDidChangeActiveViewDescriptors(() => this._onTitleAreaUpdate.fire()));
	}

	getTitle(): string {
		const containerTitle = this.viewContainerModel.title;

		if (this.isViewMergedWithContainer()) {
			const paneItemTitle = this.paneItems[0].pane.title;
			if (containerTitle === paneItemTitle) {
				return this.paneItems[0].pane.title;
			}
			return paneItemTitle ? `${containerTitle}: ${paneItemTitle}` : containerTitle;
		}

		return containerTitle;
	}

	private showContextMenu(event: StandardMouseEvent): void {
		for (const paneItem of this.paneItems) {
			// Do not show context menu if target is coming from inside pane views
			if (isAncestor(event.target, paneItem.pane.element)) {
				return;
			}
		}

		event.stopPropagation();
		event.preventDefault();

		let anchor: { x: number, y: number; } = { x: event.posx, y: event.posy };
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => this.getContextMenuActions()
		});
	}

	getContextMenuActions(viewDescriptor?: IViewDescriptor): IAction[] {
		const result: IAction[] = [];

		let showHide = true;
		if (!viewDescriptor && this.isViewMergedWithContainer()) {
			viewDescriptor = this.viewDescriptorService.getViewDescriptorById(this.panes[0].id) || undefined;
			showHide = false;
		}

		if (viewDescriptor) {
			if (showHide) {
				result.push(<IAction>{
					id: `${viewDescriptor.id}.removeView`,
					label: nls.localize('hideView', "Hide"),
					enabled: viewDescriptor.canToggleVisibility,
					run: () => this.toggleViewVisibility(viewDescriptor!.id)
				});
			}
			const view = this.getView(viewDescriptor.id);
			if (view) {
				result.push(...view.getContextMenuActions());
			}
		}

		const viewToggleActions = this.getViewsVisibilityActions();
		if (result.length && viewToggleActions.length) {
			result.push(new Separator());
		}

		result.push(...viewToggleActions);

		return result;
	}

	getActions(): IAction[] {
		if (this.isViewMergedWithContainer()) {
			return this.paneItems[0].pane.getActions();
		}

		return [];
	}

	getSecondaryActions(): IAction[] {
		if (this.isViewMergedWithContainer()) {
			return this.paneItems[0].pane.getSecondaryActions();
		}

		return [];
	}

	getActionsContext(): unknown {
		return undefined;
	}

	getViewsVisibilityActions(): IAction[] {
		return this.viewContainerModel.activeViewDescriptors.map(viewDescriptor => (<IAction>{
			id: `${viewDescriptor.id}.toggleVisibility`,
			label: viewDescriptor.name,
			checked: this.viewContainerModel.isVisible(viewDescriptor.id),
			enabled: viewDescriptor.canToggleVisibility && (!this.viewContainerModel.isVisible(viewDescriptor.id) || this.viewContainerModel.visibleViewDescriptors.length > 1),
			run: () => this.toggleViewVisibility(viewDescriptor.id)
		}));
	}

	getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (this.isViewMergedWithContainer()) {
			return this.paneItems[0].pane.getActionViewItem(action);
		}

		return undefined;
	}

	focus(): void {
		if (this.lastFocusedPane) {
			this.lastFocusedPane.focus();
		} else if (this.paneItems.length > 0) {
			for (const { pane: pane } of this.paneItems) {
				if (pane.isExpanded()) {
					pane.focus();
					return;
				}
			}
		}
	}

	private get orientation(): Orientation {
		if (this.viewDescriptorService.getViewContainerLocation(this.viewContainer) === ViewContainerLocation.Sidebar) {
			return Orientation.VERTICAL;
		} else {
			return this.layoutService.getPanelPosition() === Position.BOTTOM ? Orientation.HORIZONTAL : Orientation.VERTICAL;
		}
	}

	layout(dimension: Dimension): void {
		if (this.paneview) {
			if (this.paneview.orientation !== this.orientation) {
				this.paneview.flipOrientation(dimension.height, dimension.width);
			}

			this.paneview.layout(dimension.height, dimension.width);
		}

		this.dimension = dimension;
		if (this.didLayout) {
			this.saveViewSizes();
		} else {
			this.didLayout = true;
			this.restoreViewSizes();
		}
	}

	getOptimalWidth(): number {
		const additionalMargin = 16;
		const optimalWidth = Math.max(...this.panes.map(view => view.getOptimalWidth() || 0));
		return optimalWidth + additionalMargin;
	}

	addPanes(panes: { pane: ViewPane, size: number, index?: number; }[]): void {
		const wasMerged = this.isViewMergedWithContainer();

		for (const { pane: pane, size, index } of panes) {
			this.addPane(pane, size, index);
		}

		this.updateViewHeaders();
		if (this.isViewMergedWithContainer() !== wasMerged) {
			this.updateTitleArea();
		}

		this._onDidAddViews.fire(panes.map(({ pane }) => pane));
	}

	setVisible(visible: boolean): void {
		if (this.visible !== !!visible) {
			this.visible = visible;

			this._onDidChangeVisibility.fire(visible);
		}

		this.panes.filter(view => view.isVisible() !== visible)
			.map((view) => view.setVisible(visible));
	}

	isVisible(): boolean {
		return this.visible;
	}

	protected updateTitleArea(): void {
		this._onTitleAreaUpdate.fire();
	}

	protected createView(viewDescriptor: IViewDescriptor, options: IViewletViewOptions): ViewPane {
		return (this.instantiationService as any).createInstance(viewDescriptor.ctorDescriptor.ctor, ...(viewDescriptor.ctorDescriptor.staticArguments || []), options) as ViewPane;
	}

	getView(id: string): ViewPane | undefined {
		return this.panes.filter(view => view.id === id)[0];
	}

	private saveViewSizes(): void {
		// Save size only when the layout has happened
		if (this.didLayout) {
			for (const view of this.panes) {
				this.viewContainerModel.setSize(view.id, this.getPaneSize(view));
			}
		}
	}

	private restoreViewSizes(): void {
		// Restore sizes only when the layout has happened
		if (this.didLayout) {
			let initialSizes;
			for (let i = 0; i < this.viewContainerModel.visibleViewDescriptors.length; i++) {
				const pane = this.panes[i];
				const viewDescriptor = this.viewContainerModel.visibleViewDescriptors[i];
				const size = this.viewContainerModel.getSize(viewDescriptor.id);

				if (typeof size === 'number') {
					this.resizePane(pane, size);
				} else {
					initialSizes = initialSizes ? initialSizes : this.computeInitialSizes();
					this.resizePane(pane, initialSizes.get(pane.id) || 200);
				}
			}
		}
	}

	private computeInitialSizes(): Map<string, number> {
		const sizes: Map<string, number> = new Map<string, number>();
		if (this.dimension) {
			const totalWeight = this.viewContainerModel.visibleViewDescriptors.reduce((totalWeight, { weight }) => totalWeight + (weight || 20), 0);
			for (const viewDescriptor of this.viewContainerModel.visibleViewDescriptors) {
				if (this.orientation === Orientation.VERTICAL) {
					sizes.set(viewDescriptor.id, this.dimension.height * (viewDescriptor.weight || 20) / totalWeight);
				} else {
					sizes.set(viewDescriptor.id, this.dimension.width * (viewDescriptor.weight || 20) / totalWeight);
				}
			}
		}
		return sizes;
	}

	saveState(): void {
		this.panes.forEach((view) => view.saveState());
		this.storageService.store(this.visibleViewsStorageId, this.length, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private onContextMenu(event: StandardMouseEvent, viewDescriptor: IViewDescriptor): void {
		event.stopPropagation();
		event.preventDefault();

		const actions: IAction[] = this.getContextMenuActions(viewDescriptor);

		let anchor: { x: number, y: number } = { x: event.posx, y: event.posy };
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions
		});
	}

	openView(id: string, focus?: boolean): IView | undefined {
		let view = this.getView(id);
		if (!view) {
			this.toggleViewVisibility(id);
		}
		view = this.getView(id);
		if (view) {
			view.setExpanded(true);
			if (focus) {
				view.focus();
			}
		}
		return view;
	}

	protected onDidAddViewDescriptors(added: IAddedViewDescriptorRef[]): ViewPane[] {
		const panesToAdd: { pane: ViewPane, size: number, index: number }[] = [];

		for (const { viewDescriptor, collapsed, index, size } of added) {
			const pane = this.createView(viewDescriptor,
				{
					id: viewDescriptor.id,
					title: viewDescriptor.name,
					expanded: !collapsed
				});

			pane.render();
			const contextMenuDisposable = addDisposableListener(pane.draggableElement, 'contextmenu', e => {
				e.stopPropagation();
				e.preventDefault();
				this.onContextMenu(new StandardMouseEvent(e), viewDescriptor);
			});

			const collapseDisposable = Event.latch(Event.map(pane.onDidChange, () => !pane.isExpanded()))(collapsed => {
				this.viewContainerModel.setCollapsed(viewDescriptor.id, collapsed);
			});

			this.viewDisposables.splice(index, 0, combinedDisposable(contextMenuDisposable, collapseDisposable));
			panesToAdd.push({ pane, size: size || pane.minimumSize, index });
		}

		this.addPanes(panesToAdd);
		this.restoreViewSizes();

		const panes: ViewPane[] = [];
		for (const { pane } of panesToAdd) {
			pane.setVisible(this.isVisible());
			panes.push(pane);
		}
		return panes;
	}

	private onDidRemoveViewDescriptors(removed: IViewDescriptorRef[]): void {
		removed = removed.sort((a, b) => b.index - a.index);
		const panesToRemove: ViewPane[] = [];
		for (const { index } of removed) {
			const [disposable] = this.viewDisposables.splice(index, 1);
			disposable.dispose();
			panesToRemove.push(this.panes[index]);
		}
		this.removePanes(panesToRemove);

		for (const pane of panesToRemove) {
			pane.setVisible(false);
		}
	}

	protected toggleViewVisibility(viewId: string): void {
		// Check if view is active
		if (this.viewContainerModel.activeViewDescriptors.some(viewDescriptor => viewDescriptor.id === viewId)) {
			const visible = !this.viewContainerModel.isVisible(viewId);
			type ViewsToggleVisibilityClassification = {
				viewId: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				visible: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};
			this.telemetryService.publicLog2<{ viewId: String, visible: boolean }, ViewsToggleVisibilityClassification>('views.toggleVisibility', { viewId, visible });
			this.viewContainerModel.setVisible(viewId, visible);
		}
	}

	private addPane(pane: ViewPane, size: number, index = this.paneItems.length - 1): void {
		const onDidFocus = pane.onDidFocus(() => this.lastFocusedPane = pane);
		const onDidChangeTitleArea = pane.onDidChangeTitleArea(() => {
			if (this.isViewMergedWithContainer()) {
				this.updateTitleArea();
			}
		});

		const onDidChangeVisibility = pane.onDidChangeBodyVisibility(() => this._onDidChangeViewVisibility.fire(pane));
		const onDidChange = pane.onDidChange(() => {
			if (pane === this.lastFocusedPane && !pane.isExpanded()) {
				this.lastFocusedPane = undefined;
			}
		});

		const isPanel = this.viewDescriptorService.getViewContainerLocation(this.viewContainer) === ViewContainerLocation.Panel;
		const paneStyler = attachStyler<IPaneColors>(this.themeService, {
			headerForeground: isPanel ? PANEL_SECTION_HEADER_FOREGROUND : SIDE_BAR_SECTION_HEADER_FOREGROUND,
			headerBackground: isPanel ? PANEL_SECTION_HEADER_BACKGROUND : SIDE_BAR_SECTION_HEADER_BACKGROUND,
			headerBorder: isPanel ? PANEL_SECTION_HEADER_BORDER : SIDE_BAR_SECTION_HEADER_BORDER,
			dropBackground: isPanel ? PANEL_SECTION_DRAG_AND_DROP_BACKGROUND : SIDE_BAR_DRAG_AND_DROP_BACKGROUND,
			leftBorder: isPanel ? PANEL_SECTION_BORDER : undefined
		}, pane);
		const disposable = combinedDisposable(pane, onDidFocus, onDidChangeTitleArea, paneStyler, onDidChange, onDidChangeVisibility);
		const paneItem: IViewPaneItem = { pane, disposable };

		this.paneItems.splice(index, 0, paneItem);
		assertIsDefined(this.paneview).addPane(pane, size, index);

		let overlay: ViewPaneDropOverlay | undefined;

		this._register(CompositeDragAndDropObserver.INSTANCE.registerDraggable(pane.draggableElement, () => { return { type: 'view', id: pane.id }; }, {}));

		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(pane.dropTargetElement, {
			onDragEnter: (e) => {
				if (!overlay) {
					const dropData = e.dragAndDropData.getData();
					if (dropData.type === 'view' && dropData.id !== pane.id) {

						const oldViewContainer = this.viewDescriptorService.getViewContainerByViewId(dropData.id);
						const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(dropData.id);

						if (oldViewContainer !== this.viewContainer && (!viewDescriptor || !viewDescriptor.canMoveView || this.viewContainer.rejectAddedViews)) {
							return;
						}

						overlay = new ViewPaneDropOverlay(pane.dropTargetElement, this.orientation ?? Orientation.VERTICAL, undefined, this.viewDescriptorService.getViewContainerLocation(this.viewContainer)!, this.themeService);
					}

					if (dropData.type === 'composite' && dropData.id !== this.viewContainer.id && !this.viewContainer.rejectAddedViews) {
						const container = this.viewDescriptorService.getViewContainerById(dropData.id)!;
						const viewsToMove = this.viewDescriptorService.getViewContainerModel(container).allViewDescriptors;

						if (!viewsToMove.some(v => !v.canMoveView) && viewsToMove.length > 0) {
							overlay = new ViewPaneDropOverlay(pane.dropTargetElement, this.orientation ?? Orientation.VERTICAL, undefined, this.viewDescriptorService.getViewContainerLocation(this.viewContainer)!, this.themeService);
						}
					}
				}
			},
			onDragOver: (e) => {
				toggleDropEffect(e.eventData.dataTransfer, 'move', overlay !== undefined);
			},
			onDragLeave: (e) => {
				overlay?.dispose();
				overlay = undefined;
			},
			onDrop: (e) => {
				if (overlay) {
					const dropData = e.dragAndDropData.getData();
					const viewsToMove: IViewDescriptor[] = [];
					let anchorView: IViewDescriptor | undefined;

					if (dropData.type === 'composite' && dropData.id !== this.viewContainer.id && !this.viewContainer.rejectAddedViews) {
						const container = this.viewDescriptorService.getViewContainerById(dropData.id)!;
						const allViews = this.viewDescriptorService.getViewContainerModel(container).allViewDescriptors;

						if (allViews.length > 0 && !allViews.some(v => !v.canMoveView)) {
							viewsToMove.push(...allViews);
							anchorView = allViews[0];
						}
					} else if (dropData.type === 'view') {
						const oldViewContainer = this.viewDescriptorService.getViewContainerByViewId(dropData.id);
						const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(dropData.id);
						if (oldViewContainer !== this.viewContainer && viewDescriptor && viewDescriptor.canMoveView && !this.viewContainer.rejectAddedViews) {
							viewsToMove.push(viewDescriptor);
						}

						if (viewDescriptor) {
							anchorView = viewDescriptor;
						}
					}

					if (viewsToMove) {
						this.viewDescriptorService.moveViewsToContainer(viewsToMove, this.viewContainer);
					}

					if (anchorView) {
						if (overlay.currentDropOperation === DropDirection.DOWN ||
							overlay.currentDropOperation === DropDirection.RIGHT) {

							const fromIndex = this.panes.findIndex(p => p.id === anchorView!.id);
							let toIndex = this.panes.findIndex(p => p.id === pane.id);

							if (fromIndex >= 0 && toIndex >= 0) {
								if (fromIndex > toIndex) {
									toIndex++;
								}

								if (toIndex < this.panes.length && toIndex !== fromIndex) {
									this.movePane(this.panes[fromIndex], this.panes[toIndex]);
								}
							}
						}

						if (overlay.currentDropOperation === DropDirection.UP ||
							overlay.currentDropOperation === DropDirection.LEFT) {
							const fromIndex = this.panes.findIndex(p => p.id === anchorView!.id);
							let toIndex = this.panes.findIndex(p => p.id === pane.id);

							if (fromIndex >= 0 && toIndex >= 0) {
								if (fromIndex < toIndex) {
									toIndex--;
								}

								if (toIndex >= 0 && toIndex !== fromIndex) {
									this.movePane(this.panes[fromIndex], this.panes[toIndex]);
								}
							}
						}

						if (viewsToMove.length > 1) {
							viewsToMove.slice(1).forEach(view => {
								let toIndex = this.panes.findIndex(p => p.id === anchorView!.id);
								let fromIndex = this.panes.findIndex(p => p.id === view.id);
								if (fromIndex >= 0 && toIndex >= 0) {
									if (fromIndex > toIndex) {
										toIndex++;
									}

									if (toIndex < this.panes.length && toIndex !== fromIndex) {
										this.movePane(this.panes[fromIndex], this.panes[toIndex]);
										anchorView = view;
									}
								}
							});
						}
					}
				}

				overlay?.dispose();
				overlay = undefined;
			}
		}));
	}

	removePanes(panes: ViewPane[]): void {
		const wasMerged = this.isViewMergedWithContainer();

		panes.forEach(pane => this.removePane(pane));

		this.updateViewHeaders();
		if (wasMerged !== this.isViewMergedWithContainer()) {
			this.updateTitleArea();
		}

		this._onDidRemoveViews.fire(panes);
	}

	private removePane(pane: ViewPane): void {
		const index = this.paneItems.findIndex(i => i.pane === pane);

		if (index === -1) {
			return;
		}

		if (this.lastFocusedPane === pane) {
			this.lastFocusedPane = undefined;
		}

		assertIsDefined(this.paneview).removePane(pane);
		const [paneItem] = this.paneItems.splice(index, 1);
		paneItem.disposable.dispose();

	}

	movePane(from: ViewPane, to: ViewPane): void {
		const fromIndex = this.paneItems.findIndex(item => item.pane === from);
		const toIndex = this.paneItems.findIndex(item => item.pane === to);

		const fromViewDescriptor = this.viewContainerModel.visibleViewDescriptors[fromIndex];
		const toViewDescriptor = this.viewContainerModel.visibleViewDescriptors[toIndex];

		if (fromIndex < 0 || fromIndex >= this.paneItems.length) {
			return;
		}

		if (toIndex < 0 || toIndex >= this.paneItems.length) {
			return;
		}

		const [paneItem] = this.paneItems.splice(fromIndex, 1);
		this.paneItems.splice(toIndex, 0, paneItem);

		assertIsDefined(this.paneview).movePane(from, to);

		this.viewContainerModel.move(fromViewDescriptor.id, toViewDescriptor.id);

		this.updateTitleArea();
	}

	resizePane(pane: ViewPane, size: number): void {
		assertIsDefined(this.paneview).resizePane(pane, size);
	}

	getPaneSize(pane: ViewPane): number {
		return assertIsDefined(this.paneview).getPaneSize(pane);
	}

	private updateViewHeaders(): void {
		if (this.isViewMergedWithContainer()) {
			this.paneItems[0].pane.setExpanded(true);
			this.paneItems[0].pane.headerVisible = false;
		} else {
			this.paneItems.forEach(i => i.pane.headerVisible = true);
		}
	}

	private isViewMergedWithContainer(): boolean {
		if (!(this.options.mergeViewWithContainerWhenSingleView && this.paneItems.length === 1)) {
			return false;
		}
		if (!this.areExtensionsReady) {
			if (this.visibleViewsCountFromCache === undefined) {
				// TODO @sbatten fix hack for #91367
				return this.viewDescriptorService.getViewContainerLocation(this.viewContainer) === ViewContainerLocation.Panel;
			}
			// Check in cache so that view do not jump. See #29609
			return this.visibleViewsCountFromCache === 1;
		}
		return true;
	}

	dispose(): void {
		super.dispose();
		this.paneItems.forEach(i => i.disposable.dispose());
		if (this.paneview) {
			this.paneview.dispose();
		}
	}
}

class MoveViewPosition extends Action2 {
	constructor(desc: Readonly<IAction2Options>, private readonly offset: number) {
		super(desc);
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewDescriptorService = accessor.get(IViewDescriptorService);
		const contextKeyService = accessor.get(IContextKeyService);

		const viewId = FocusedViewContext.getValue(contextKeyService);
		if (viewId === undefined) {
			return;
		}

		const viewContainer = viewDescriptorService.getViewContainerByViewId(viewId)!;
		const model = viewDescriptorService.getViewContainerModel(viewContainer);

		const viewDescriptor = model.visibleViewDescriptors.find(vd => vd.id === viewId)!;
		const currentIndex = model.visibleViewDescriptors.indexOf(viewDescriptor);
		if (currentIndex + this.offset < 0 || currentIndex + this.offset >= model.visibleViewDescriptors.length) {
			return;
		}

		const newPosition = model.visibleViewDescriptors[currentIndex + this.offset];

		model.move(viewDescriptor.id, newPosition.id);
	}
}

registerAction2(
	class MoveViewUp extends MoveViewPosition {
		constructor() {
			super({
				id: 'views.moveViewUp',
				title: nls.localize('viewMoveUp', "Move View Up"),
				keybinding: {
					primary: KeyChord(KeyMod.CtrlCmd + KeyCode.KEY_K, KeyCode.UpArrow),
					weight: KeybindingWeight.WorkbenchContrib + 1,
					when: FocusedViewContext.notEqualsTo('')
				}
			}, -1);
		}
	}
);

registerAction2(
	class MoveViewLeft extends MoveViewPosition {
		constructor() {
			super({
				id: 'views.moveViewLeft',
				title: nls.localize('viewMoveLeft', "Move View Left"),
				keybinding: {
					primary: KeyChord(KeyMod.CtrlCmd + KeyCode.KEY_K, KeyCode.LeftArrow),
					weight: KeybindingWeight.WorkbenchContrib + 1,
					when: FocusedViewContext.notEqualsTo('')
				}
			}, -1);
		}
	}
);

registerAction2(
	class MoveViewDown extends MoveViewPosition {
		constructor() {
			super({
				id: 'views.moveViewDown',
				title: nls.localize('viewMoveDown', "Move View Down"),
				keybinding: {
					primary: KeyChord(KeyMod.CtrlCmd + KeyCode.KEY_K, KeyCode.DownArrow),
					weight: KeybindingWeight.WorkbenchContrib + 1,
					when: FocusedViewContext.notEqualsTo('')
				}
			}, 1);
		}
	}
);

registerAction2(
	class MoveViewRight extends MoveViewPosition {
		constructor() {
			super({
				id: 'views.moveViewRight',
				title: nls.localize('viewMoveRight', "Move View Right"),
				keybinding: {
					primary: KeyChord(KeyMod.CtrlCmd + KeyCode.KEY_K, KeyCode.RightArrow),
					weight: KeybindingWeight.WorkbenchContrib + 1,
					when: FocusedViewContext.notEqualsTo('')
				}
			}, 1);
		}
	}
);
