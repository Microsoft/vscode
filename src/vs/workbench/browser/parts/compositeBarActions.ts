/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action, Separator } from 'vs/base/common/actions';
import * as dom from 'vs/base/browser/dom';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { dispose, toDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { TextBadge, NumberBadge, IBadge, IconBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { DelayedDragHandler } from 'vs/base/browser/dnd';
import { IActivity } from 'vs/workbench/common/activity';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Emitter, Event } from 'vs/base/common/event';
import { CompositeDragAndDropObserver, ICompositeDragAndDrop, Before2D, toggleDropEffect } from 'vs/workbench/browser/dnd';
import { Color } from 'vs/base/common/color';
import { Codicon } from 'vs/base/common/codicons';
import { IBaseActionViewItemOptions, BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

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

	dispose(): void {
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

export interface IActivityActionViewItemOptions extends IBaseActionViewItemOptions {
	icon?: boolean;
	colors: (theme: IColorTheme) => ICompositeBarColors;
}

export class ActivityActionViewItem extends BaseActionViewItem {
	protected container!: HTMLElement;
	protected label!: HTMLElement;
	protected badge!: HTMLElement;
	protected options!: IActivityActionViewItemOptions;

	private badgeContent: HTMLElement | undefined;
	private readonly badgeDisposable = this._register(new MutableDisposable());
	private mouseUpTimeout: any;

	constructor(
		action: ActivityAction,
		options: IActivityActionViewItemOptions,
		@IThemeService protected readonly themeService: IThemeService
	) {
		super(null, action, options);

		this._register(this.themeService.onDidColorThemeChange(this.onThemeChange, this));
		this._register(action.onDidChangeActivity(this.updateActivity, this));
		this._register(action.onDidChangeBadge(this.updateBadge, this));
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

	render(container: HTMLElement): void {
		super.render(container);

		this.container = container;

		// Make the container tab-able for keyboard navigation
		this.container.tabIndex = 0;
		this.container.setAttribute('role', 'tab');

		// Try hard to prevent keyboard only focus feedback when using mouse
		this._register(dom.addDisposableListener(this.container, dom.EventType.MOUSE_DOWN, () => {
			dom.addClass(this.container, 'clicked');
		}));

		this._register(dom.addDisposableListener(this.container, dom.EventType.MOUSE_UP, () => {
			if (this.mouseUpTimeout) {
				clearTimeout(this.mouseUpTimeout);
			}

			this.mouseUpTimeout = setTimeout(() => {
				dom.removeClass(this.container, 'clicked');
			}, 800); // delayed to prevent focus feedback from showing on mouse up
		}));

		// Label
		this.label = dom.append(container, dom.$('a'));

		// Badge
		this.badge = dom.append(container, dom.$('.badge'));
		this.badgeContent = dom.append(this.badge, dom.$('.badge-content'));

		// Activity bar active border + background
		const isActivityBarItem = this.options.icon;
		if (isActivityBarItem) {
			dom.append(container, dom.$('.active-item-indicator'));
		}

		dom.hide(this.badge);

		this.updateActivity();
		this.updateStyles();
	}

	private onThemeChange(theme: IColorTheme): void {
		this.updateStyles();
	}

	protected updateActivity(): void {
		this.updateLabel();
		this.updateTitle(this.activity.name);
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

		dom.clearNode(this.badgeContent);
		dom.hide(this.badge);

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
					dom.show(this.badge);
				}
			}

			// Text
			else if (badge instanceof TextBadge) {
				this.badgeContent.textContent = badge.text;
				dom.show(this.badge);
			}

			// Text
			else if (badge instanceof IconBadge) {
				dom.show(this.badge);
			}

			// Progress
			else if (badge instanceof ProgressBadge) {
				dom.show(this.badge);
			}

			if (clazz) {
				dom.addClasses(this.badge, clazz);
				this.badgeDisposable.value = toDisposable(() => dom.removeClasses(this.badge, clazz));
			}
		}

		// Title
		let title: string;
		if (badge?.getDescription()) {
			if (this.activity.name) {
				title = nls.localize('badgeTitle', "{0} - {1}", this.activity.name, badge.getDescription());
			} else {
				title = badge.getDescription();
			}
		} else {
			title = this.activity.name;
		}

		this.updateTitle(title);
	}

	protected updateLabel(): void {
		this.label.className = 'action-label';

		if (this.activity.cssClass) {
			dom.addClasses(this.label, this.activity.cssClass);
		}

		if (this.options.icon && !this.activity.iconUrl) {
			// Only apply codicon class to activity bar icon items without iconUrl
			dom.addClass(this.label, 'codicon');
		}

		if (!this.options.icon) {
			this.label.textContent = this.getAction().label;
		}
	}

	private updateTitle(title: string): void {
		[this.label, this.badge, this.container].forEach(element => {
			if (element) {
				element.setAttribute('aria-label', title);
				element.title = title;
			}
		});
	}

	dispose(): void {
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
			name: nls.localize('additionalViews', "Additional Views"),
			cssClass: Codicon.more.classNames
		});
	}

	async run(): Promise<void> {
		this.showMenu();
	}
}

export class CompositeOverflowActivityActionViewItem extends ActivityActionViewItem {
	private actions: Action[] = [];

	constructor(
		action: ActivityAction,
		private getOverflowingComposites: () => { id: string, name?: string }[],
		private getActiveCompositeId: () => string | undefined,
		private getBadge: (compositeId: string) => IBadge,
		private getCompositeOpenAction: (compositeId: string) => Action,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IThemeService themeService: IThemeService
	) {
		super(action, { icon: true, colors }, themeService);
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

	private getActions(): Action[] {
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
				action.label = nls.localize('numberBadge', "{0} ({1})", composite.name, suffix);
			} else {
				action.label = composite.name || '';
			}

			return action;
		});
	}

	dispose(): void {
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
		super('activitybar.manage.extension', nls.localize('manageExtension', "Manage Extension"));
	}

	run(id: string): Promise<void> {
		return this.commandService.executeCommand('_extensions.manage', id);
	}
}

export class CompositeActionViewItem extends ActivityActionViewItem {

	private static manageExtensionAction: ManageExtensionAction;

	private compositeActivity: IActivity | undefined;

	constructor(
		private compositeActivityAction: ActivityAction,
		private toggleCompositePinnedAction: Action,
		private compositeContextMenuActionsProvider: (compositeId: string) => ReadonlyArray<Action>,
		private contextMenuActionsProvider: () => ReadonlyArray<Action>,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		icon: boolean,
		private dndHandler: ICompositeDragAndDrop,
		private compositeBar: ICompositeBar,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService
	) {
		super(compositeActivityAction, { draggable: true, colors, icon }, themeService);

		if (!CompositeActionViewItem.manageExtensionAction) {
			CompositeActionViewItem.manageExtensionAction = instantiationService.createInstance(ManageExtensionAction);
		}

		this._register(compositeActivityAction.onDidChangeActivity(() => {
			this.compositeActivity = undefined;
			this.updateActivity();
		}, this));
		this._register(Event.any(
			compositeActivityAction.onDidChangeActivity,
			Event.filter(keybindingService.onDidUpdateKeybindings, () => this.compositeActivity!.name !== this.getActivtyName())
		)(() => {
			if (this.compositeActivity && this.compositeActivity.name !== this.getActivtyName()) {
				this.compositeActivity = undefined;
				this.updateActivity();
			}
		}));
	}

	protected get activity(): IActivity {
		if (!this.compositeActivity) {
			this.compositeActivity = {
				...this.compositeActivityAction.activity,
				... { name: this.getActivtyName() }
			};
		}
		return this.compositeActivity;
	}

	private getActivtyName(): string {
		const keybinding = this.compositeActivityAction.activity.keybindingId ? this.keybindingService.lookupKeybinding(this.compositeActivityAction.activity.keybindingId) : null;
		return keybinding ? nls.localize('titleKeybinding', "{0} ({1})", this.compositeActivityAction.activity.name, keybinding.getLabel()) : this.compositeActivityAction.activity.name;
	}

	render(container: HTMLElement): void {
		super.render(container);

		this.updateChecked();
		this.updateEnabled();

		this._register(dom.addDisposableListener(this.container, dom.EventType.CONTEXT_MENU, e => {
			dom.EventHelper.stop(e, true);

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
				dom.EventHelper.stop(e.eventData, true);
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

		dom.toggleClass(element, 'top', showFeedback && top);
		dom.toggleClass(element, 'bottom', showFeedback && bottom);
		dom.toggleClass(element, 'left', showFeedback && left);
		dom.toggleClass(element, 'right', showFeedback && right);

		if (!showFeedback) {
			return undefined;
		}

		return { verticallyBefore: top, horizontallyBefore: left };
	}

	private showContextMenu(container: HTMLElement): void {
		const actions: Action[] = [this.toggleCompositePinnedAction];

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
			this.toggleCompositePinnedAction.label = nls.localize('hide', "Hide");
			this.toggleCompositePinnedAction.checked = false;
		} else {
			this.toggleCompositePinnedAction.label = nls.localize('keep', "Keep");
		}

		const otherActions = this.contextMenuActionsProvider();
		if (otherActions.length) {
			actions.push(new Separator());
			actions.push(...otherActions);
		}

		const elementPosition = dom.getDomNodePagePosition(container);
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

	focus(): void {
		this.container.focus();
	}

	protected updateChecked(): void {
		if (this.getAction().checked) {
			dom.addClass(this.container, 'checked');
			this.container.setAttribute('aria-label', nls.localize('compositeActive', "{0} active", this.container.title));
			this.container.setAttribute('aria-expanded', 'true');
		} else {
			dom.removeClass(this.container, 'checked');
			this.container.setAttribute('aria-label', this.container.title);
			this.container.setAttribute('aria-expanded', 'false');
		}
		this.updateStyles();
	}

	protected updateEnabled(): void {
		if (!this.element) {
			return;
		}

		if (this.getAction().enabled) {
			dom.removeClass(this.element, 'disabled');
		} else {
			dom.addClass(this.element, 'disabled');
		}
	}

	dispose(): void {
		super.dispose();
		this.label.remove();
	}
}

export class ToggleCompositePinnedAction extends Action {

	constructor(
		private activity: IActivity | undefined,
		private compositeBar: ICompositeBar
	) {
		super('show.toggleCompositePinned', activity ? activity.name : nls.localize('toggle', "Toggle View Pinned"));

		this.checked = !!this.activity && this.compositeBar.isPinned(this.activity.id);
	}

	async run(context: string): Promise<void> {
		const id = this.activity ? this.activity.id : context;

		if (this.compositeBar.isPinned(id)) {
			this.compositeBar.unpin(id);
		} else {
			this.compositeBar.pin(id);
		}
	}
}
