/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/sidebarpart';
import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { CompositePart } from 'vs/workbench/browser/parts/compositePart';
import { Viewlet, ViewletRegistry, Extensions as ViewletExtensions, ViewletDescriptor } from 'vs/workbench/browser/viewlet';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IWorkbenchLayoutService, Parts, Position as SideBarPosition } from 'vs/workbench/services/layout/browser/layoutService';
import { IViewlet, SidebarFocusContext, ActiveViewletContext } from 'vs/workbench/common/viewlet';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Event, Emitter } from 'vs/base/common/event';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { SIDE_BAR_TITLE_FOREGROUND, SIDE_BAR_BACKGROUND, SIDE_BAR_FOREGROUND, SIDE_BAR_BORDER, SIDE_BAR_DRAG_AND_DROP_BACKGROUND } from 'vs/workbench/common/theme';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { EventType, addDisposableListener, trackFocus } from 'vs/base/browser/dom';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { LayoutPriority } from 'vs/base/browser/ui/grid/grid';
import { assertIsDefined } from 'vs/base/common/types';
import { CompositeDragAndDropObserver } from 'vs/workbench/browser/dnd';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { CATEGORIES } from 'vs/workbench/common/actions';

export class SidebarPart extends CompositePart<Viewlet> implements IViewletService {

	declare readonly _serviceBrand: undefined;

	static readonly activeViewletSettingsKey = 'workbench.sidebar.activeviewletid';

	//#region IView

	readonly minimumWidth: number = 170;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	readonly priority: LayoutPriority = LayoutPriority.Low;

	readonly snap = true;

	get preferredWidth(): number | undefined {
		const viewlet = this.getActiveViewlet();

		if (!viewlet) {
			return;
		}

		const width = viewlet.getOptimalWidth();
		if (typeof width !== 'number') {
			return;
		}

		return Math.max(width, 300);
	}

	//#endregion

	get onDidViewletRegister(): Event<ViewletDescriptor> { return <Event<ViewletDescriptor>>this.viewletRegistry.onDidRegister; }

	private _onDidViewletDeregister = this._register(new Emitter<ViewletDescriptor>());
	readonly onDidViewletDeregister = this._onDidViewletDeregister.event;

	get onDidViewletOpen(): Event<IViewlet> { return Event.map(this.onDidCompositeOpen.event, compositeEvent => <IViewlet>compositeEvent.composite); }
	get onDidViewletClose(): Event<IViewlet> { return this.onDidCompositeClose.event as Event<IViewlet>; }

	private readonly viewletRegistry = Registry.as<ViewletRegistry>(ViewletExtensions.Viewlets);

	private readonly sideBarFocusContextKey = SidebarFocusContext.bindTo(this.contextKeyService);
	private readonly activeViewletContextKey = ActiveViewletContext.bindTo(this.contextKeyService);

	private blockOpeningViewlet = false;

	constructor(
		@INotificationService notificationService: INotificationService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super(
			notificationService,
			storageService,
			telemetryService,
			contextMenuService,
			layoutService,
			keybindingService,
			instantiationService,
			themeService,
			Registry.as<ViewletRegistry>(ViewletExtensions.Viewlets),
			SidebarPart.activeViewletSettingsKey,
			viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.Sidebar)!.id,
			'sideBar',
			'viewlet',
			SIDE_BAR_TITLE_FOREGROUND,
			Parts.SIDEBAR_PART,
			{ hasTitle: true, borderWidth: () => (this.getColor(SIDE_BAR_BORDER) || this.getColor(contrastBorder)) ? 1 : 0 }
		);

		this.registerListeners();
	}

	private registerListeners(): void {

		// Viewlet open
		this._register(this.onDidViewletOpen(viewlet => {
			this.activeViewletContextKey.set(viewlet.getId());
		}));

		// Viewlet close
		this._register(this.onDidViewletClose(viewlet => {
			if (this.activeViewletContextKey.get() === viewlet.getId()) {
				this.activeViewletContextKey.reset();
			}
		}));

		// Viewlet deregister
		this._register(this.registry.onDidDeregister(async (viewletDescriptor: ViewletDescriptor) => {

			const activeContainers = this.viewDescriptorService.getViewContainersByLocation(ViewContainerLocation.Sidebar)
				.filter(container => this.viewDescriptorService.getViewContainerModel(container).activeViewDescriptors.length > 0);

			if (activeContainers.length) {
				if (this.getActiveComposite()?.getId() === viewletDescriptor.id) {
					const defaultViewletId = this.viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.Sidebar)?.id;
					const containerToOpen = activeContainers.filter(c => c.id === defaultViewletId)[0] || activeContainers[0];
					await this.openViewlet(containerToOpen.id);
				}
			} else {
				this.layoutService.setSideBarHidden(true);
			}

			this.removeComposite(viewletDescriptor.id);
			this._onDidViewletDeregister.fire(viewletDescriptor);
		}));
	}

	override create(parent: HTMLElement): void {
		this.element = parent;

		super.create(parent);

		const focusTracker = this._register(trackFocus(parent));
		this._register(focusTracker.onDidFocus(() => this.sideBarFocusContextKey.set(true)));
		this._register(focusTracker.onDidBlur(() => this.sideBarFocusContextKey.set(false)));
	}

	override createTitleArea(parent: HTMLElement): HTMLElement {
		const titleArea = super.createTitleArea(parent);

		this._register(addDisposableListener(titleArea, EventType.CONTEXT_MENU, e => {
			this.onTitleAreaContextMenu(new StandardMouseEvent(e));
		}));

		this.titleLabelElement!.draggable = true;

		const draggedItemProvider = (): { type: 'view' | 'composite', id: string } => {
			const activeViewlet = this.getActiveViewlet()!;
			return { type: 'composite', id: activeViewlet.getId() };
		};

		this._register(CompositeDragAndDropObserver.INSTANCE.registerDraggable(this.titleLabelElement!, draggedItemProvider, {}));
		return titleArea;
	}

	override updateStyles(): void {
		super.updateStyles();

		// Part container
		const container = assertIsDefined(this.getContainer());

		container.style.backgroundColor = this.getColor(SIDE_BAR_BACKGROUND) || '';
		container.style.color = this.getColor(SIDE_BAR_FOREGROUND) || '';

		const borderColor = this.getColor(SIDE_BAR_BORDER) || this.getColor(contrastBorder);
		const isPositionLeft = this.layoutService.getSideBarPosition() === SideBarPosition.LEFT;
		container.style.borderRightWidth = borderColor && isPositionLeft ? '1px' : '';
		container.style.borderRightStyle = borderColor && isPositionLeft ? 'solid' : '';
		container.style.borderRightColor = isPositionLeft ? borderColor || '' : '';
		container.style.borderLeftWidth = borderColor && !isPositionLeft ? '1px' : '';
		container.style.borderLeftStyle = borderColor && !isPositionLeft ? 'solid' : '';
		container.style.borderLeftColor = !isPositionLeft ? borderColor || '' : '';
		container.style.outlineColor = this.getColor(SIDE_BAR_DRAG_AND_DROP_BACKGROUND) ?? '';
	}

	override layout(width: number, height: number): void {
		if (!this.layoutService.isVisible(Parts.SIDEBAR_PART)) {
			return;
		}

		super.layout(width, height);
	}

	// Viewlet service

	getActiveViewlet(): IViewlet | undefined {
		return <IViewlet>this.getActiveComposite();
	}

	getLastActiveViewletId(): string {
		return this.getLastActiveCompositetId();
	}

	hideActiveViewlet(): void {
		this.hideActiveComposite();
	}

	async openViewlet(id: string | undefined, focus?: boolean): Promise<IViewlet | undefined> {
		if (typeof id === 'string' && this.getViewlet(id)) {
			return this.doOpenViewlet(id, focus);
		}

		await this.extensionService.whenInstalledExtensionsRegistered();

		if (typeof id === 'string' && this.getViewlet(id)) {
			return this.doOpenViewlet(id, focus);
		}

		return undefined;
	}

	getViewlets(): ViewletDescriptor[] {
		return this.viewletRegistry.getViewlets().sort((v1, v2) => {
			if (typeof v1.order !== 'number') {
				return -1;
			}

			if (typeof v2.order !== 'number') {
				return 1;
			}

			return v1.order - v2.order;
		});
	}

	getViewlet(id: string): ViewletDescriptor {
		return this.getViewlets().filter(viewlet => viewlet.id === id)[0];
	}

	private doOpenViewlet(id: string, focus?: boolean): Viewlet | undefined {
		if (this.blockOpeningViewlet) {
			return undefined; // Workaround against a potential race condition
		}

		// First check if sidebar is hidden and show if so
		if (!this.layoutService.isVisible(Parts.SIDEBAR_PART)) {
			try {
				this.blockOpeningViewlet = true;
				this.layoutService.setSideBarHidden(false);
			} finally {
				this.blockOpeningViewlet = false;
			}
		}

		return this.openComposite(id, focus) as Viewlet;
	}

	protected override getTitleAreaDropDownAnchorAlignment(): AnchorAlignment {
		return this.layoutService.getSideBarPosition() === SideBarPosition.LEFT ? AnchorAlignment.LEFT : AnchorAlignment.RIGHT;
	}

	private onTitleAreaContextMenu(event: StandardMouseEvent): void {
		const activeViewlet = this.getActiveViewlet() as Viewlet;
		if (activeViewlet) {
			const contextMenuActions = activeViewlet ? activeViewlet.getContextMenuActions() : [];
			if (contextMenuActions.length) {
				const anchor: { x: number, y: number } = { x: event.posx, y: event.posy };
				this.contextMenuService.showContextMenu({
					getAnchor: () => anchor,
					getActions: () => contextMenuActions.slice(),
					getActionViewItem: action => this.actionViewItemProvider(action),
					actionRunner: activeViewlet.getActionRunner()
				});
			}
		}
	}

	toJSON(): object {
		return {
			type: Parts.SIDEBAR_PART
		};
	}
}

class FocusSideBarAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.focusSideBar',
			title: { value: localize('focusSideBar', "Focus into Side Bar"), original: 'Focus into Side Bar' },
			category: CATEGORIES.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: null,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_0
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const viewletService = accessor.get(IViewletService);

		// Show side bar
		if (!layoutService.isVisible(Parts.SIDEBAR_PART)) {
			layoutService.setSideBarHidden(false);
			return;
		}

		// Focus into active viewlet
		const viewlet = viewletService.getActiveViewlet();
		if (viewlet) {
			viewlet.focus();
		}
	}
}

registerAction2(FocusSideBarAction);

registerSingleton(IViewletService, SidebarPart);
