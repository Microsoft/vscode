/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/thirdPanelPart';
import { LayoutPriority } from 'vs/base/browser/ui/splitview/splitview';
import { Event, Emitter } from 'vs/base/common/event';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { assertIsDefined } from 'vs/base/common/types';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IWorkbenchLayoutService, Parts, Position as SideBarPosition } from 'vs/workbench/services/layout/browser/layoutService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { CompositePart } from 'vs/workbench/browser/parts/compositePart';
import { Viewlet, ViewletRegistry, Extensions as ViewletExtensions, ViewletDescriptor } from 'vs/workbench/browser/viewlet';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { SIDE_BAR_BACKGROUND, SIDE_BAR_BORDER, SIDE_BAR_DRAG_AND_DROP_BACKGROUND, SIDE_BAR_FOREGROUND, SIDE_BAR_TITLE_FOREGROUND } from 'vs/workbench/common/theme';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ISecondViewletService, IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';

// TODO@wendellhu: will find some shared code in sidebarPart.ts
export class ThirdPanelPart extends CompositePart<Viewlet> implements IViewletService {

	declare readonly _serviceBrand: undefined;

	static readonly activeViewletSettingsKey = 'workbench.thirdpanel.activeviweletid';

	//#region IView

	readonly minimumWidth: number = 170;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	readonly priority: LayoutPriority = LayoutPriority.Low;

	// TODO@wendellhu: what does this even mean?
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


	get onDidViewletRegister(): Event<ViewletDescriptor> { return <Event<ViewletDescriptor>>this.viewletRegistry.onDidDeregister; }

	private _onDidViewletDeregister = this._register(new Emitter<ViewletDescriptor>());
	readonly onDidViewletDeregister = this._onDidViewletDeregister.event;

	get onDidViewletOpen(): Event<IViewlet> { return Event.map(this.onDidCompositeOpen.event, compositeEvent => <IViewlet>compositeEvent.composite); }
	get onDidViewletClose(): Event<IViewlet> { return this.onDidCompositeClose.event as Event<IViewlet>; }

	private readonly viewletRegistry = Registry.as<ViewletRegistry>(ViewletExtensions.ThirdPanelViewlets);

	// private readonly sideBarFocusContextKey = SidebarFocusContext.bindTo(this.contextKeyService);
	// private readonly activeViewletContextKey = ActiveViewletContext.bindTo(this.contextKeyService);

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
		@IViewDescriptorService readonly viewDescriptorService: IViewDescriptorService,
		// @IContextKeyService private readonly contextKeyService: IContextKeyService,
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
			Registry.as<ViewletRegistry>(ViewletExtensions.ThirdPanelViewlets),
			ThirdPanelPart.activeViewletSettingsKey,
			viewDescriptorService.getDefaultViewContainer(ViewContainerLocation.ThirdPanel)!.id,
			'thirdPanel',
			'viewlet',
			SIDE_BAR_TITLE_FOREGROUND,
			Parts.THIRD_PANEL_PART,
			{ hasTitle: true, borderWidth: () => (this.getColor(SIDE_BAR_BORDER) || this.getColor(contrastBorder)) ? 1 : 0 }
		);

		// this.registerListeners();
	}

	getViewlet(id: string): ViewletDescriptor | undefined {
		return this.getViewlets().filter(viewlet => viewlet.id === id)[0];
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

	override create(parent: HTMLElement): void {
		this.element = parent;

		super.create(parent);

		// TODO:wendell: focus things
	}

	override createTitleArea(parent: HTMLElement): HTMLElement {
		const titleArea = super.createTitleArea(parent);

		// TODO@wendell: this is just a hack
		this.titleLabel!.updateTitle('third-panel', 'THIRD PANEL');

		this.titleLabelElement!.draggable = false;
		return titleArea;
	}

	override updateStyles(): void {
		super.updateStyles();

		const container = assertIsDefined(this.getContainer());

		container.style.background = this.getColor(SIDE_BAR_BACKGROUND) || '';
		container.style.color = this.getColor(SIDE_BAR_FOREGROUND) || '';

		const borderColor = this.getColor(SIDE_BAR_BORDER) || this.getColor(contrastBorder);
		const isPositionLeft = this.layoutService.getSideBarPosition() === SideBarPosition.RIGHT; // opposite to the side bar
		container.style.borderRightWidth = borderColor && isPositionLeft ? '1px' : '';
		container.style.borderRightStyle = borderColor && isPositionLeft ? 'solid' : '';
		container.style.borderRightColor = isPositionLeft ? borderColor || '' : '';
		container.style.borderLeftWidth = borderColor && !isPositionLeft ? '1px' : '';
		container.style.borderLeftStyle = borderColor && !isPositionLeft ? 'solid' : '';
		container.style.borderLeftColor = !isPositionLeft ? borderColor || '' : '';
		container.style.outlineColor = this.getColor(SIDE_BAR_DRAG_AND_DROP_BACKGROUND) ?? '';
	}

	override layout(width: number, height: number): void {
		if (!this.layoutService.isVisible(Parts.THIRD_PANEL_PART)) {
			return;
		}

		super.layout(width, height);
	}

	//#region Viewlet service (second viewlet)

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

	private doOpenViewlet(id: string, focus?: boolean): Viewlet | undefined {
		if (this.blockOpeningViewlet) {
			return undefined;
		}

		if (!this.layoutService.isVisible(Parts.THIRD_PANEL_PART)) {
			try {
				this.blockOpeningViewlet = true;
				this.layoutService.setSideBarHidden(false);
			} finally {
				this.blockOpeningViewlet = false;
			}
		}

		return this.openComposite(id, focus) as Viewlet;
	}

	// private onTitleAreaContextMenu(event: StandardMouseEvent): void {
	// 	const activeViewlet = this.getActiveViewlet() as Viewlet;
	// 	if (activeViewlet) {
	// 		const contextMenuActions = activeViewlet ? activeViewlet.getContextMenuActions() : [];
	// 		if (contextMenuActions.length) {
	// 			const anchor: { x: number, y: number } = { x: event.posx, y: event.posy };
	// 			this.contextMenuService.showContextMenu({
	// 				getAnchor: () => anchor,
	// 				getActions: () => contextMenuActions.slice(),
	// 				getActionViewItem: action => this.actionViewItemProvider(action),
	// 				actionRunner: activeViewlet.getActionRunner()
	// 			});
	// 		}
	// 	}
	// }

	toJSON(): object {
		return {
			type: Parts.THIRD_PANEL_PART
		};
	}
}

class FocusThirdPanelAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.focusThirdPanel',
			title: { value: 'Focus Third Panel', original: 'Focus into Third Panel' }, // TODO@wendell: i18n
			category: CATEGORIES.View,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: null,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_0
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const secondViewletService = accessor.get(ISecondViewletService);

		if (!layoutService.isVisible(Parts.THIRD_PANEL_PART)) {
			layoutService.setSideBarHidden(false);
			return;
		}

		const viewlet = secondViewletService.getActiveViewlet();
		viewlet?.focus();
	}
}

registerAction2(FocusThirdPanelAction);

registerSingleton(ISecondViewletService, ThirdPanelPart);
