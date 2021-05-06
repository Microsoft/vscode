/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { $, addDisposableListener, append, clearNode, EventHelper, EventType, getDomNodePagePosition, hide, show } from 'vs/base/browser/dom';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { dispose, toDisposable, MutableDisposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IThemeService, IColorTheme, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { TextBadge, NumberBadge, IBadge, IconBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { DelayedDragHandler } from 'vs/base/browser/dnd';
import { IActivity } from 'vs/workbench/common/activity';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Emitter, Event } from 'vs/base/common/event';
import { CompositeDragAndDropObserver, ICompositeDragAndDrop, Before2D, toggleDropEffect } from 'vs/workbench/browser/dnd';
import { Color } from 'vs/base/common/color';
import { IBaseActionViewItemOptions, BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Codicon } from 'vs/base/common/codicons';
import { IHoverService } from 'vs/workbench/services/hover/browser/hover';
import { domEvent } from 'vs/base/browser/event';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';

export interface ICompositeActivity {
	badge: IBadge;
	clazz?: string;
	priority: number;
}

export interface ICompositeBar {
	/**
	 * Unpins a composite from the composite bar.
	 */
	unpin(compositeId: string): void;

	/**
	 * Pin a composite inside the composite bar.
	 */
	pin(compositeId: string): void;

	/**
	 * Find out if a composite is pinned in the composite bar.
	 */
	isPinned(compositeId: string): boolean;

	/**
	 * Reorder composite ordering by moving a composite to the location of another composite.
	 */
	move(compositeId: string, tocompositeId: string): void;
}

export class ActivityAction extends Action {

	private readonly _onDidChangeActivity = this._register(new Emitter<ActivityAction>());
	readonly onDidChangeActivity = this._onDidChangeActivity.event;

	private readonly _onDidChangeBadge = this._register(new Emitter<ActivityAction>());
	readonly onDidChangeBadge = this._onDidChangeBadge.event;

	private badge: IBadge | undefined;
	private clazz: string | undefined;

	constructor(private _activity: IActivity) {
		super(_activity.id, _activity.name, _activity.cssClass);
	}

	get activity(): IActivity {
		return this._activity;
	}

	set activity(activity: IActivity) {
		this._label = activity.name;
		this._activity = activity;
		this._onDidChangeActivity.fire(this);
	}

	activate(): void {
		if (!this.checked) {
			this._setChecked(true);
		}
	}

	deactivate(): void {
		if (this.checked) {
			this._setChecked(false);
		}
	}

	getBadge(): IBadge | undefined {
		return this.badge;
	}

	getClass(): string | undefined {
		return this.clazz;
	}

	setBadge(badge: IBadge | undefined, clazz?: string): void {
		this.badge = badge;
		this.clazz = clazz;
		this._onDidChangeBadge.fire(this);
	}

	override dispose(): void {
		this._onDidChangeActivity.dispose();
		this._onDidChangeBadge.dispose();

		super.dispose();
	}
}

export interface ICompositeBarColors {
	activeBackgroundColor?: Color;
	inactiveBackgroundColor?: Color;
	activeBorderColor?: Color;
	activeBackground?: Color;
	activeBorderBottomColor?: Color;
	activeForegroundColor?: Color;
	inactiveForegroundColor?: Color;
	badgeBackground?: Color;
	badgeForeground?: Color;
	dragAndDropBorder?: Color;
}

export interface IActivityHoverOptions {
	position: () => HoverPosition;
	delay: () => number;
}

export interface IActivityActionViewItemOptions extends IBaseActionViewItemOptions {
	icon?: boolean;
	colors: (theme: IColorTheme) => ICompositeBarColors;
	hoverOptions: IActivityHoverOptions;
	hasPopup?: boolean;
}

export class ActivityActionViewItem extends BaseActionViewItem {
	protected container!: HTMLElement;
	protected label!: HTMLElement;
	protected badge!: HTMLElement;
	protected override readonly options: IActivityActionViewItemOptions;

	private badgeContent: HTMLElement | undefined;
	private readonly badgeDisposable = this._register(new MutableDisposable());
	private mouseUpTimeout: any;
	private keybindingLabel: string | undefined | null;

	private readonly hoverDisposables = this._register(new DisposableStore());
	private readonly hover = this._register(new MutableDisposable<IDisposable>());
	private readonly showHoverScheduler = new RunOnceScheduler(() => this.showHover(), 0);

	constructor(
		action: ActivityAction,
		options: IActivityActionViewItemOptions,
		@IThemeService protected readonly themeService: IThemeService,
		@IHoverService private readonly hoverService: IHoverService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IKeybindingService protected readonly keybindingService: IKeybindingService,
	) {
		super(null, action, options);

		this.options = options;

		this._register(this.themeService.onDidColorThemeChange(this.onThemeChange, this));
		this._register(action.onDidChangeActivity(this.updateActivity, this));
		this._register(Event.filter(keybindingService.onDidUpdateKeybindings, () => this.keybindingLabel !== this.computeKeybindingLabel())(() => this.updateTitle()));
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('workbench.experimental.useCustomHover'))(() => this.updateHover()));
		this._register(action.onDidChangeBadge(this.updateBadge, this));
		this._register(toDisposable(() => this.showHoverScheduler.cancel()));
	}

	protected get activity(): IActivity {
		return (this._action as ActivityAction).activity;
	}

	protected updateStyles(): void {
		const theme = this.themeService.getColorTheme();
		const colors = this.options.colors(theme);

		if (this.label) {
			if (this.options.icon) {
				const foreground = this._action.checked ? colors.activeBackgroundColor || colors.activeForegroundColor : colors.inactiveBackgroundColor || colors.inactiveForegroundColor;
				if (this.activity.iconUrl) {
					// Apply background color to activity bar item provided with iconUrls
					this.label.style.backgroundColor = foreground ? foreground.toString() : '';
					this.label.style.color = '';
				} else {
					// Apply foreground color to activity bar items provided with codicons
					this.label.style.color = foreground ? foreground.toString() : '';
					this.label.style.backgroundColor = '';
				}
			} else {
				const foreground = this._action.checked ? colors.activeForegroundColor : colors.inactiveForegroundColor;
				const borderBottomColor = this._action.checked ? colors.activeBorderBottomColor : null;
				this.label.style.color = foreground ? foreground.toString() : '';
				this.label.style.borderBottomColor = borderBottomColor ? borderBottomColor.toString() : '';
			}

			this.container.style.setProperty('--insert-border-color', colors.dragAndDropBorder ? colors.dragAndDropBorder.toString() : '');
		}

		// Badge
		if (this.badgeContent) {
			const badgeForeground = colors.badgeForeground;
			const badgeBackground = colors.badgeBackground;
			const contrastBorderColor = theme.getColor(contrastBorder);

			this.badgeContent.style.color = badgeForeground ? badgeForeground.toString() : '';
			this.badgeContent.style.backgroundColor = badgeBackground ? badgeBackground.toString() : '';

			this.badgeContent.style.borderStyle = contrastBorderColor ? 'solid' : '';
			this.badgeContent.style.borderWidth = contrastBorderColor ? '1px' : '';
			this.badgeContent.style.borderColor = contrastBorderColor ? contrastBorderColor.toString() : '';
		}
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this.container = container;
		if (this.options.icon) {
			this.container.classList.add('icon');
		}

		if (this.options.hasPopup) {
			this.container.setAttribute('role', 'button');
			this.container.setAttribute('aria-haspopup', 'true');
		} else {
			this.container.setAttribute('role', 'tab');
		}

		// Try hard to prevent keyboard only focus feedback when using mouse
		this._register(addDisposableListener(this.container, EventType.MOUSE_DOWN, () => {
			this.container.classList.add('clicked');
		}));

		this._register(addDisposableListener(this.container, EventType.MOUSE_UP, () => {
			if (this.mouseUpTimeout) {
				clearTimeout(this.mouseUpTimeout);
			}

			this.mouseUpTimeout = setTimeout(() => {
				this.container.classList.remove('clicked');
			}, 800); // delayed to prevent focus feedback from showing on mouse up
		}));

		// Label
		this.label = append(container, $('a'));

		// Badge
		this.badge = append(container, $('.badge'));
		this.badgeContent = append(this.badge, $('.badge-content'));

		// Activity bar active border + background
		const isActivityBarItem = this.options.icon;
		if (isActivityBarItem) {
			append(container, $('.active-item-indicator'));
		}

		hide(this.badge);

		this.updateActivity();
		this.updateStyles();
		this.updateHover();
	}

	private onThemeChange(theme: IColorTheme): void {
		this.updateStyles();
	}

	protected updateActivity(): void {
		this.updateLabel();
		this.updateTitle();
		this.updateBadge();
		this.updateStyles();
	}

	protected updateBadge(): void {
		const action = this.getAction();
		if (!this.badge || !this.badgeContent || !(action instanceof ActivityAction)) {
			return;
		}

		const badge = action.getBadge();
		const clazz = action.getClass();

		this.badgeDisposable.clear();

		clearNode(this.badgeContent);
		hide(this.badge);

		if (badge) {

			// Number
			if (badge instanceof NumberBadge) {
				if (badge.number) {
					let number = badge.number.toString();
					if (badge.number > 999) {
						const noOfThousands = badge.number / 1000;
						const floor = Math.floor(noOfThousands);
						if (noOfThousands > floor) {
							number = `${floor}K+`;
						} else {
							number = `${noOfThousands}K`;
						}
					}
					this.badgeContent.textContent = number;
					show(this.badge);
				}
			}

			// Text
			else if (badge instanceof TextBadge) {
				this.badgeContent.textContent = badge.text;
				show(this.badge);
			}

			// Icon
			else if (badge instanceof IconBadge) {
				const clazzList = ThemeIcon.asClassNameArray(badge.icon);
				this.badgeContent.classList.add(...clazzList);
				show(this.badge);
			}

			// Progress
			else if (badge instanceof ProgressBadge) {
				show(this.badge);
			}

			if (clazz) {
				const classNames = clazz.split(' ');
				this.badge.classList.add(...classNames);
				this.badgeDisposable.value = toDisposable(() => this.badge.classList.remove(...classNames));
			}
		}

		this.updateTitle();
	}

	protected override updateLabel(): void {
		this.label.className = 'action-label';

		if (this.activity.cssClass) {
			this.label.classList.add(...this.activity.cssClass.split(' '));
		}

		if (this.options.icon && !this.activity.iconUrl) {
			// Only apply codicon class to activity bar icon items without iconUrl
			this.label.classList.add('codicon');
		}

		if (!this.options.icon) {
			this.label.textContent = this.getAction().label;
		}
	}

	private updateTitle(): void {
		// Title
		const title = this.computeTitle();
		[this.label, this.badge, this.container].forEach(element => {
			if (element) {
				element.setAttribute('aria-label', title);
				if (this.useCustomHover) {
					element.setAttribute('title', '');
					element.removeAttribute('title');
				} else {
					element.setAttribute('title', title);
				}
			}
		});
	}

	private computeTitle(): string {
		this.keybindingLabel = this.computeKeybindingLabel();
		let title = this.keybindingLabel ? localize('titleKeybinding', "{0} ({1})", this.activity.name, this.keybindingLabel) : this.activity.name;
		const badge = (this.getAction() as ActivityAction).getBadge();
		if (badge?.getDescription()) {
			title = localize('badgeTitle', "{0} - {1}", title, badge.getDescription());
		}
		return title;
	}

	private computeKeybindingLabel(): string | undefined | null {
		const keybinding = this.activity.keybindingId ? this.keybindingService.lookupKeybinding(this.activity.keybindingId) : null;
		return keybinding?.getLabel();
	}

	private updateHover(): void {
		this.hoverDisposables.clear();

		this.updateTitle();
		if (this.useCustomHover) {
			this.hoverDisposables.add(domEvent(this.container, EventType.MOUSE_OVER, true)(() => {
				if (!this.showHoverScheduler.isScheduled()) {
					this.showHoverScheduler.schedule(this.options.hoverOptions!.delay() || 150);
				}
			}));
			this.hoverDisposables.add(domEvent(this.container, EventType.MOUSE_LEAVE, true)(() => {
				this.hover.value = undefined;
				this.showHoverScheduler.cancel();
			}));
			this.hoverDisposables.add(toDisposable(() => {
				this.hover.value = undefined;
				this.showHoverScheduler.cancel();
			}));
		}
	}

	private showHover(): void {
		if (this.hover.value) {
			return;
		}
		const hoverPosition = this.options.hoverOptions!.position();
		this.hover.value = this.hoverService.showHover({
			target: this.container,
			hoverPosition,
			text: this.computeTitle(),
			showPointer: true,
			compact: true
		});
	}

	private get useCustomHover(): boolean {
		return !!this.configurationService.getValue<boolean>('workbench.experimental.useCustomHover');
	}

	override dispose(): void {
		super.dispose();

		if (this.mouseUpTimeout) {
			clearTimeout(this.mouseUpTimeout);
		}

		this.badge.remove();
	}
}

export class CompositeOverflowActivityAction extends ActivityAction {

	constructor(
		private showMenu: () => void
	) {
		super({
			id: 'additionalComposites.action',
			name: localize('additionalViews', "Additional Views"),
			cssClass: Codicon.more.classNames
		});
	}

	override async run(): Promise<void> {
		this.showMenu();
	}
}

export class CompositeOverflowActivityActionViewItem extends ActivityActionViewItem {
	private actions: IAction[] = [];

	constructor(
		action: ActivityAction,
		private getOverflowingComposites: () => { id: string, name?: string }[],
		private getActiveCompositeId: () => string | undefined,
		private getBadge: (compositeId: string) => IBadge,
		private getCompositeOpenAction: (compositeId: string) => IAction,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		hoverOptions: IActivityHoverOptions,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super(action, { icon: true, colors, hasPopup: true, hoverOptions }, themeService, hoverService, configurationService, keybindingService);
	}

	showMenu(): void {
		if (this.actions) {
			dispose(this.actions);
		}

		this.actions = this.getActions();

		this.contextMenuService.showContextMenu({
			getAnchor: () => this.container,
			getActions: () => this.actions,
			getCheckedActionsRepresentation: () => 'radio',
			onHide: () => dispose(this.actions)
		});
	}

	private getActions(): IAction[] {
		return this.getOverflowingComposites().map(composite => {
			const action = this.getCompositeOpenAction(composite.id);
			action.checked = this.getActiveCompositeId() === action.id;

			const badge = this.getBadge(composite.id);
			let suffix: string | number | undefined;
			if (badge instanceof NumberBadge) {
				suffix = badge.number;
			} else if (badge instanceof TextBadge) {
				suffix = badge.text;
			}

			if (suffix) {
				action.label = localize('numberBadge', "{0} ({1})", composite.name, suffix);
			} else {
				action.label = composite.name || '';
			}

			return action;
		});
	}

	override dispose(): void {
		super.dispose();

		if (this.actions) {
			this.actions = dispose(this.actions);
		}
	}
}

class ManageExtensionAction extends Action {

	constructor(
		@ICommandService private readonly commandService: ICommandService
	) {
		super('activitybar.manage.extension', localize('manageExtension', "Manage Extension"));
	}

	override run(id: string): Promise<void> {
		return this.commandService.executeCommand('_extensions.manage', id);
	}
}

export class CompositeActionViewItem extends ActivityActionViewItem {

	private static manageExtensionAction: ManageExtensionAction;

	constructor(
		options: IActivityActionViewItemOptions,
		private readonly compositeActivityAction: ActivityAction,
		private readonly toggleCompositePinnedAction: IAction,
		private readonly compositeContextMenuActionsProvider: (compositeId: string) => IAction[],
		private readonly contextMenuActionsProvider: () => IAction[],
		private readonly dndHandler: ICompositeDragAndDrop,
		private readonly compositeBar: ICompositeBar,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(compositeActivityAction, options, themeService, hoverService, configurationService, keybindingService);

		if (!CompositeActionViewItem.manageExtensionAction) {
			CompositeActionViewItem.manageExtensionAction = instantiationService.createInstance(ManageExtensionAction);
		}
	}

	override render(container: HTMLElement): void {
		super.render(container);

		this.updateChecked();
		this.updateEnabled();

		this._register(addDisposableListener(this.container, EventType.CONTEXT_MENU, e => {
			EventHelper.stop(e, true);

			this.showContextMenu(container);
		}));

		let insertDropBefore: Before2D | undefined = undefined;
		// Allow to drag
		this._register(CompositeDragAndDropObserver.INSTANCE.registerDraggable(this.container, () => { return { type: 'composite', id: this.activity.id }; }, {
			onDragOver: e => {
				const isValidMove = e.dragAndDropData.getData().id !== this.activity.id && this.dndHandler.onDragOver(e.dragAndDropData, this.activity.id, e.eventData);
				toggleDropEffect(e.eventData.dataTransfer, 'move', isValidMove);
				insertDropBefore = this.updateFromDragging(container, isValidMove, e.eventData);
			},

			onDragLeave: e => {
				insertDropBefore = this.updateFromDragging(container, false, e.eventData);
			},

			onDragEnd: e => {
				insertDropBefore = this.updateFromDragging(container, false, e.eventData);
			},

			onDrop: e => {
				EventHelper.stop(e.eventData, true);
				this.dndHandler.drop(e.dragAndDropData, this.activity.id, e.eventData, insertDropBefore);
				insertDropBefore = this.updateFromDragging(container, false, e.eventData);
			},
			onDragStart: e => {
				if (e.dragAndDropData.getData().id !== this.activity.id) {
					return;
				}

				if (e.eventData.dataTransfer) {
					e.eventData.dataTransfer.effectAllowed = 'move';
				}
				// Remove focus indicator when dragging
				this.blur();
			}
		}));

		// Activate on drag over to reveal targets
		[this.badge, this.label].forEach(b => this._register(new DelayedDragHandler(b, () => {
			if (!this.getAction().checked) {
				this.getAction().run();
			}
		})));

		this.updateStyles();
	}

	private updateFromDragging(element: HTMLElement, showFeedback: boolean, event: DragEvent): Before2D | undefined {
		const rect = element.getBoundingClientRect();
		const posX = event.clientX;
		const posY = event.clientY;
		const height = rect.bottom - rect.top;
		const width = rect.right - rect.left;

		const forceTop = posY <= rect.top + height * 0.4;
		const forceBottom = posY > rect.bottom - height * 0.4;
		const preferTop = posY <= rect.top + height * 0.5;

		const forceLeft = posX <= rect.left + width * 0.4;
		const forceRight = posX > rect.right - width * 0.4;
		const preferLeft = posX <= rect.left + width * 0.5;

		const classes = element.classList;
		const lastClasses = {
			vertical: classes.contains('top') ? 'top' : (classes.contains('bottom') ? 'bottom' : undefined),
			horizontal: classes.contains('left') ? 'left' : (classes.contains('right') ? 'right' : undefined)
		};

		const top = forceTop || (preferTop && !lastClasses.vertical) || (!forceBottom && lastClasses.vertical === 'top');
		const bottom = forceBottom || (!preferTop && !lastClasses.vertical) || (!forceTop && lastClasses.vertical === 'bottom');
		const left = forceLeft || (preferLeft && !lastClasses.horizontal) || (!forceRight && lastClasses.horizontal === 'left');
		const right = forceRight || (!preferLeft && !lastClasses.horizontal) || (!forceLeft && lastClasses.horizontal === 'right');

		element.classList.toggle('top', showFeedback && top);
		element.classList.toggle('bottom', showFeedback && bottom);
		element.classList.toggle('left', showFeedback && left);
		element.classList.toggle('right', showFeedback && right);

		if (!showFeedback) {
			return undefined;
		}

		return { verticallyBefore: top, horizontallyBefore: left };
	}

	private showContextMenu(container: HTMLElement): void {
		const actions: IAction[] = [this.toggleCompositePinnedAction];

		const compositeContextMenuActions = this.compositeContextMenuActionsProvider(this.activity.id);
		if (compositeContextMenuActions.length) {
			actions.push(...compositeContextMenuActions);
		}

		if ((<any>this.compositeActivityAction.activity).extensionId) {
			actions.push(new Separator());
			actions.push(CompositeActionViewItem.manageExtensionAction);
		}

		const isPinned = this.compositeBar.isPinned(this.activity.id);
		if (isPinned) {
			this.toggleCompositePinnedAction.label = localize('hide', "Hide '{0}'", this.activity.name);
			this.toggleCompositePinnedAction.checked = false;
		} else {
			this.toggleCompositePinnedAction.label = localize('keep', "Keep '{0}'", this.activity.name);
		}

		const otherActions = this.contextMenuActionsProvider();
		if (otherActions.length) {
			actions.push(new Separator());
			actions.push(...otherActions);
		}

		const elementPosition = getDomNodePagePosition(container);
		const anchor = {
			x: Math.floor(elementPosition.left + (elementPosition.width / 2)),
			y: elementPosition.top + elementPosition.height
		};

		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			getActionsContext: () => this.activity.id
		});
	}

	protected override updateChecked(): void {
		if (this.getAction().checked) {
			this.container.classList.add('checked');
			this.container.setAttribute('aria-label', this.container.title);
			this.container.setAttribute('aria-expanded', 'true');
			this.container.setAttribute('aria-selected', 'true');
		} else {
			this.container.classList.remove('checked');
			this.container.setAttribute('aria-label', this.container.title);
			this.container.setAttribute('aria-expanded', 'false');
			this.container.setAttribute('aria-selected', 'false');
		}
		this.updateStyles();
	}

	protected override updateEnabled(): void {
		if (!this.element) {
			return;
		}

		if (this.getAction().enabled) {
			this.element.classList.remove('disabled');
		} else {
			this.element.classList.add('disabled');
		}
	}

	override dispose(): void {
		super.dispose();
		this.label.remove();
	}
}

export class ToggleCompositePinnedAction extends Action {

	constructor(
		private activity: IActivity | undefined,
		private compositeBar: ICompositeBar
	) {
		super('show.toggleCompositePinned', activity ? activity.name : localize('toggle', "Toggle View Pinned"));

		this.checked = !!this.activity && this.compositeBar.isPinned(this.activity.id);
	}

	override async run(context: string): Promise<void> {
		const id = this.activity ? this.activity.id : context;

		if (this.compositeBar.isPinned(id)) {
			this.compositeBar.unpin(id);
		} else {
			this.compositeBar.pin(id);
		}
	}
}
