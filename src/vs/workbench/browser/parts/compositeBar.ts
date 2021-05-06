/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IAction, toAction } from 'vs/base/common/actions';
import { illegalArgument } from 'vs/base/common/errors';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IBadge } from 'vs/workbench/services/activity/common/activity';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ActionBar, ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { CompositeActionViewItem, CompositeOverflowActivityAction, ICompositeActivity, CompositeOverflowActivityActionViewItem, ActivityAction, ICompositeBar, ICompositeBarColors, IActivityHoverOptions } from 'vs/workbench/browser/parts/compositeBarActions';
import { Dimension, $, addDisposableListener, EventType, EventHelper, isAncestor } from 'vs/base/browser/dom';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Widget } from 'vs/base/browser/ui/widget';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { IColorTheme } from 'vs/platform/theme/common/themeService';
import { Emitter } from 'vs/base/common/event';
import { ViewContainerLocation, IViewDescriptorService } from 'vs/workbench/common/views';
import { IPaneComposite } from 'vs/workbench/common/panecomposite';
import { IComposite } from 'vs/workbench/common/composite';
import { CompositeDragAndDropData, CompositeDragAndDropObserver, IDraggedCompositeData, ICompositeDragAndDrop, Before2D, toggleDropEffect } from 'vs/workbench/browser/dnd';

export interface ICompositeBarItem {
	id: string;
	name?: string;
	pinned: boolean;
	order?: number;
	visible: boolean;
}

export class CompositeDragAndDrop implements ICompositeDragAndDrop {

	constructor(
		private viewDescriptorService: IViewDescriptorService,
		private targetContainerLocation: ViewContainerLocation,
		private openComposite: (id: string, focus?: boolean) => Promise<IPaneComposite | null>,
		private moveComposite: (from: string, to: string, before?: Before2D) => void,
		private getItems: () => ICompositeBarItem[],
	) { }

	drop(data: CompositeDragAndDropData, targetCompositeId: string | undefined, originalEvent: DragEvent, before?: Before2D): void {
		const dragData = data.getData();

		if (dragData.type === 'composite') {
			const currentContainer = this.viewDescriptorService.getViewContainerById(dragData.id)!;
			const currentLocation = this.viewDescriptorService.getViewContainerLocation(currentContainer);

			// ... on the same composite bar
			if (currentLocation === this.targetContainerLocation) {
				if (targetCompositeId) {
					this.moveComposite(dragData.id, targetCompositeId, before);
				}
			}
			// ... on a different composite bar
			else {
				const viewsToMove = this.viewDescriptorService.getViewContainerModel(currentContainer)!.allViewDescriptors;
				if (viewsToMove.some(v => !v.canMoveView)) {
					return;
				}

				this.viewDescriptorService.moveViewContainerToLocation(currentContainer, this.targetContainerLocation, this.getTargetIndex(targetCompositeId, before));
			}
		}

		if (dragData.type === 'view') {
			const viewToMove = this.viewDescriptorService.getViewDescriptorById(dragData.id)!;

			if (viewToMove && viewToMove.canMoveView) {
				this.viewDescriptorService.moveViewToLocation(viewToMove, this.targetContainerLocation);

				const newContainer = this.viewDescriptorService.getViewContainerByViewId(viewToMove.id)!;

				if (targetCompositeId) {
					this.moveComposite(newContainer.id, targetCompositeId, before);
				}

				this.openComposite(newContainer.id, true).then(composite => {
					if (composite) {
						composite.openView(viewToMove.id, true);
					}
				});
			}
		}
	}

	onDragEnter(data: CompositeDragAndDropData, targetCompositeId: string | undefined, originalEvent: DragEvent): boolean {
		return this.canDrop(data, targetCompositeId);
	}

	onDragOver(data: CompositeDragAndDropData, targetCompositeId: string | undefined, originalEvent: DragEvent): boolean {
		return this.canDrop(data, targetCompositeId);
	}

	private getTargetIndex(targetId: string | undefined, before2d: Before2D | undefined): number | undefined {
		if (!targetId) {
			return undefined;
		}

		const items = this.getItems();
		const before = this.targetContainerLocation === ViewContainerLocation.Panel ? before2d?.horizontallyBefore : before2d?.verticallyBefore;
		return items.filter(o => o.visible).findIndex(o => o.id === targetId) + (before ? 0 : 1);
	}

	private canDrop(data: CompositeDragAndDropData, targetCompositeId: string | undefined): boolean {
		const dragData = data.getData();

		if (dragData.type === 'composite') {
			// Dragging a composite
			const currentContainer = this.viewDescriptorService.getViewContainerById(dragData.id)!;
			const currentLocation = this.viewDescriptorService.getViewContainerLocation(currentContainer);

			// ... to the same composite location
			if (currentLocation === this.targetContainerLocation) {
				return true;
			}

			// ... to another composite location
			const draggedViews = this.viewDescriptorService.getViewContainerModel(currentContainer)!.allViewDescriptors;

			// ... all views must be movable
			return !draggedViews.some(v => !v.canMoveView);
		} else {
			// Dragging an individual view
			const viewDescriptor = this.viewDescriptorService.getViewDescriptorById(dragData.id);

			// ... that cannot move
			if (!viewDescriptor || !viewDescriptor.canMoveView) {
				return false;
			}

			// ... to create a view container
			return true;
		}
	}
}

export interface ICompositeBarOptions {

	readonly icon: boolean;
	readonly orientation: ActionsOrientation;
	readonly colors: (theme: IColorTheme) => ICompositeBarColors;
	readonly compositeSize: number;
	readonly overflowActionSize: number;
	readonly dndHandler: ICompositeDragAndDrop;
	readonly activityHoverOptions: IActivityHoverOptions;
	readonly preventLoopNavigation?: boolean;

	getActivityAction: (compositeId: string) => ActivityAction;
	getCompositePinnedAction: (compositeId: string) => IAction;
	getOnCompositeClickAction: (compositeId: string) => IAction;
	fillExtraContextMenuActions: (actions: IAction[]) => void;
	getContextMenuActionsForComposite: (compositeId: string) => IAction[];
	openComposite: (compositeId: string) => Promise<IComposite | null>;
	getDefaultCompositeId: () => string;
	hidePart: () => void;
}

export class CompositeBar extends Widget implements ICompositeBar {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private dimension: Dimension | undefined;

	private compositeSwitcherBar: ActionBar | undefined;
	private compositeOverflowAction: CompositeOverflowActivityAction | undefined;
	private compositeOverflowActionViewItem: CompositeOverflowActivityActionViewItem | undefined;

	private model: CompositeBarModel;
	private visibleComposites: string[];
	private compositeSizeInBar: Map<string, number>;

	constructor(
		items: ICompositeBarItem[],
		private readonly options: ICompositeBarOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		super();

		this.model = new CompositeBarModel(items, options);
		this.visibleComposites = [];
		this.compositeSizeInBar = new Map<string, number>();
		this.computeSizes(this.model.visibleItems);
	}

	getCompositeBarItems(): ICompositeBarItem[] {
		return [...this.model.items];
	}

	setCompositeBarItems(items: ICompositeBarItem[]): void {
		if (this.model.setItems(items)) {
			this.updateCompositeSwitcher();
		}
	}

	getPinnedComposites(): ICompositeBarItem[] {
		return this.model.pinnedItems;
	}

	getVisibleComposites(): ICompositeBarItem[] {
		return this.model.visibleItems;
	}

	create(parent: HTMLElement): HTMLElement {
		const actionBarDiv = parent.appendChild($('.composite-bar'));
		this.compositeSwitcherBar = this._register(new ActionBar(actionBarDiv, {
			actionViewItemProvider: action => {
				if (action instanceof CompositeOverflowActivityAction) {
					return this.compositeOverflowActionViewItem;
				}
				const item = this.model.findItem(action.id);
				return item && this.instantiationService.createInstance(
					CompositeActionViewItem,
					{ draggable: true, colors: this.options.colors, icon: this.options.icon, hoverOptions: this.options.activityHoverOptions },
					action as ActivityAction,
					item.pinnedAction,
					compositeId => this.options.getContextMenuActionsForComposite(compositeId),
					() => this.getContextMenuActions(),
					this.options.dndHandler,
					this
				);
			},
			orientation: this.options.orientation,
			ariaLabel: localize('activityBarAriaLabel', "Active View Switcher"),
			animated: false,
			preventLoopNavigation: this.options.preventLoopNavigation,
			triggerKeys: { keyDown: true }
		}));

		// Contextmenu for composites
		this._register(addDisposableListener(parent, EventType.CONTEXT_MENU, e => this.showContextMenu(e)));

		let insertDropBefore: Before2D | undefined = undefined;
		// Register a drop target on the whole bar to prevent forbidden feedback
		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(parent, {
			onDragOver: (e: IDraggedCompositeData) => {
				// don't add feedback if this is over the composite bar actions or there are no actions
				const visibleItems = this.getVisibleComposites();
				if (!visibleItems.length || (e.eventData.target && isAncestor(e.eventData.target as HTMLElement, actionBarDiv))) {
					insertDropBefore = this.updateFromDragging(parent, false, false);
					return;
				}

				const insertAtFront = this.insertAtFront(actionBarDiv, e.eventData);
				const target = insertAtFront ? visibleItems[0] : visibleItems[visibleItems.length - 1];
				const validDropTarget = this.options.dndHandler.onDragOver(e.dragAndDropData, target.id, e.eventData);
				toggleDropEffect(e.eventData.dataTransfer, 'move', validDropTarget);
				insertDropBefore = this.updateFromDragging(parent, validDropTarget, insertAtFront);
			},

			onDragLeave: (e: IDraggedCompositeData) => {
				insertDropBefore = this.updateFromDragging(parent, false, false);
			},
			onDragEnd: (e: IDraggedCompositeData) => {
				insertDropBefore = this.updateFromDragging(parent, false, false);
			},
			onDrop: (e: IDraggedCompositeData) => {
				const visibleItems = this.getVisibleComposites();
				if (visibleItems.length) {
					const target = this.insertAtFront(actionBarDiv, e.eventData) ? visibleItems[0] : visibleItems[visibleItems.length - 1];
					this.options.dndHandler.drop(e.dragAndDropData, target.id, e.eventData, insertDropBefore);
				}
				insertDropBefore = this.updateFromDragging(parent, false, false);
			}
		}));

		return actionBarDiv;
	}

	private insertAtFront(element: HTMLElement, event: DragEvent): boolean {
		const rect = element.getBoundingClientRect();
		const posX = event.clientX;
		const posY = event.clientY;

		switch (this.options.orientation) {
			case ActionsOrientation.HORIZONTAL:
				return posX < rect.left;
			case ActionsOrientation.VERTICAL:
				return posY < rect.top;
		}
	}

	private updateFromDragging(element: HTMLElement, showFeedback: boolean, front: boolean): Before2D | undefined {
		element.classList.toggle('dragged-over-head', showFeedback && front);
		element.classList.toggle('dragged-over-tail', showFeedback && !front);

		if (!showFeedback) {
			return undefined;
		}

		return { verticallyBefore: front, horizontallyBefore: front };
	}

	focus(index?: number): void {
		if (this.compositeSwitcherBar) {
			this.compositeSwitcherBar.focus(index);
		}
	}

	layout(dimension: Dimension): void {
		this.dimension = dimension;
		if (dimension.height === 0 || dimension.width === 0) {
			// Do not layout if not visible. Otherwise the size measurment would be computed wrongly
			return;
		}

		if (this.compositeSizeInBar.size === 0) {
			// Compute size of each composite by getting the size from the css renderer
			// Size is later used for overflow computation
			this.computeSizes(this.model.visibleItems);
		}

		this.updateCompositeSwitcher();
	}

	addComposite({ id, name, order, requestedIndex }: { id: string; name: string, order?: number, requestedIndex?: number; }): void {
		// Add to the model
		if (this.model.add(id, name, order, requestedIndex)) {
			this.computeSizes([this.model.findItem(id)]);
			this.updateCompositeSwitcher();
		}
	}

	removeComposite(id: string): void {

		// If it pinned, unpin it first
		if (this.isPinned(id)) {
			this.unpin(id);
		}

		// Remove from the model
		if (this.model.remove(id)) {
			this.updateCompositeSwitcher();
		}
	}

	hideComposite(id: string): void {
		if (this.model.hide(id)) {
			this.resetActiveComposite(id);
			this.updateCompositeSwitcher();
		}
	}

	activateComposite(id: string): void {
		const previousActiveItem = this.model.activeItem;
		if (this.model.activate(id)) {
			// Update if current composite is neither visible nor pinned
			// or previous active composite is not pinned
			if (this.visibleComposites.indexOf(id) === - 1 || (!!this.model.activeItem && !this.model.activeItem.pinned) || (previousActiveItem && !previousActiveItem.pinned)) {
				this.updateCompositeSwitcher();
			}
		}
	}

	deactivateComposite(id: string): void {
		const previousActiveItem = this.model.activeItem;
		if (this.model.deactivate()) {
			if (previousActiveItem && !previousActiveItem.pinned) {
				this.updateCompositeSwitcher();
			}
		}
	}

	showActivity(compositeId: string, badge: IBadge, clazz?: string, priority?: number): IDisposable {
		if (!badge) {
			throw illegalArgument('badge');
		}

		if (typeof priority !== 'number') {
			priority = 0;
		}

		const activity: ICompositeActivity = { badge, clazz, priority };
		this.model.addActivity(compositeId, activity);

		return toDisposable(() => this.model.removeActivity(compositeId, activity));
	}

	async pin(compositeId: string, open?: boolean): Promise<void> {
		if (this.model.setPinned(compositeId, true)) {
			this.updateCompositeSwitcher();

			if (open) {
				await this.options.openComposite(compositeId);
				this.activateComposite(compositeId); // Activate after opening
			}
		}
	}

	unpin(compositeId: string): void {
		if (this.model.setPinned(compositeId, false)) {

			this.updateCompositeSwitcher();

			this.resetActiveComposite(compositeId);
		}
	}

	private resetActiveComposite(compositeId: string) {
		const defaultCompositeId = this.options.getDefaultCompositeId();

		// Case: composite is not the active one or the active one is a different one
		// Solv: we do nothing
		if (!this.model.activeItem || this.model.activeItem.id !== compositeId) {
			return;
		}

		// Deactivate itself
		this.deactivateComposite(compositeId);

		// Case: composite is not the default composite and default composite is still showing
		// Solv: we open the default composite
		if (defaultCompositeId !== compositeId && this.isPinned(defaultCompositeId)) {
			this.options.openComposite(defaultCompositeId);
		}

		// Case: we closed the last visible composite
		// Solv: we hide the part
		else if (this.visibleComposites.length === 0) {
			this.options.hidePart();
		}

		// Case: we closed the default composite
		// Solv: we open the next visible composite from top
		else {
			this.options.openComposite(this.visibleComposites.filter(cid => cid !== compositeId)[0]);
		}
	}

	isPinned(compositeId: string): boolean {
		const item = this.model.findItem(compositeId);
		return item?.pinned;
	}

	move(compositeId: string, toCompositeId: string, before?: boolean): void {

		if (before !== undefined) {
			const fromIndex = this.model.items.findIndex(c => c.id === compositeId);
			let toIndex = this.model.items.findIndex(c => c.id === toCompositeId);

			if (fromIndex >= 0 && toIndex >= 0) {
				if (!before && fromIndex > toIndex) {
					toIndex++;
				}

				if (before && fromIndex < toIndex) {
					toIndex--;
				}

				if (toIndex < this.model.items.length && toIndex >= 0 && toIndex !== fromIndex) {
					if (this.model.move(this.model.items[fromIndex].id, this.model.items[toIndex].id)) {
						// timeout helps to prevent artifacts from showing up
						setTimeout(() => this.updateCompositeSwitcher(), 0);
					}
				}
			}

		} else {
			if (this.model.move(compositeId, toCompositeId)) {
				// timeout helps to prevent artifacts from showing up
				setTimeout(() => this.updateCompositeSwitcher(), 0);
			}
		}
	}

	getAction(compositeId: string): ActivityAction {
		const item = this.model.findItem(compositeId);
		return item?.activityAction;
	}

	private computeSizes(items: ICompositeBarModelItem[]): void {
		const size = this.options.compositeSize;
		if (size) {
			items.forEach(composite => this.compositeSizeInBar.set(composite.id, size));
		} else {
			const compositeSwitcherBar = this.compositeSwitcherBar;
			if (compositeSwitcherBar && this.dimension && this.dimension.height !== 0 && this.dimension.width !== 0) {
				// Compute sizes only if visible. Otherwise the size measurment would be computed wrongly.
				const currentItemsLength = compositeSwitcherBar.viewItems.length;
				compositeSwitcherBar.push(items.map(composite => composite.activityAction));
				items.map((composite, index) => this.compositeSizeInBar.set(composite.id, this.options.orientation === ActionsOrientation.VERTICAL
					? compositeSwitcherBar.getHeight(currentItemsLength + index)
					: compositeSwitcherBar.getWidth(currentItemsLength + index)
				));
				items.forEach(() => compositeSwitcherBar.pull(compositeSwitcherBar.viewItems.length - 1));
			}
		}
	}

	private updateCompositeSwitcher(): void {
		const compositeSwitcherBar = this.compositeSwitcherBar;
		if (!compositeSwitcherBar || !this.dimension) {
			return; // We have not been rendered yet so there is nothing to update.
		}

		let compositesToShow = this.model.visibleItems.filter(item =>
			item.pinned
			|| (this.model.activeItem && this.model.activeItem.id === item.id) /* Show the active composite even if it is not pinned */
		).map(item => item.id);

		// Ensure we are not showing more composites than we have height for
		let overflows = false;
		let maxVisible = compositesToShow.length;
		let size = 0;
		const limit = this.options.orientation === ActionsOrientation.VERTICAL ? this.dimension.height : this.dimension.width;
		for (let i = 0; i < compositesToShow.length && size <= limit; i++) {
			size += this.compositeSizeInBar.get(compositesToShow[i])!;
			if (size > limit) {
				maxVisible = i;
			}
		}
		overflows = compositesToShow.length > maxVisible;

		if (overflows) {
			size -= this.compositeSizeInBar.get(compositesToShow[maxVisible])!;
			compositesToShow = compositesToShow.slice(0, maxVisible);
			size += this.options.overflowActionSize;
		}
		// Check if we need to make extra room for the overflow action
		if (size > limit) {
			size -= this.compositeSizeInBar.get(compositesToShow.pop()!)!;
		}

		// We always try show the active composite
		if (this.model.activeItem && compositesToShow.every(compositeId => !!this.model.activeItem && compositeId !== this.model.activeItem.id)) {
			const removedComposite = compositesToShow.pop()!;
			size = size - this.compositeSizeInBar.get(removedComposite)! + this.compositeSizeInBar.get(this.model.activeItem.id)!;
			compositesToShow.push(this.model.activeItem.id);
		}

		// The active composite might have bigger size than the removed composite, check for overflow again
		if (size > limit) {
			compositesToShow.length ? compositesToShow.splice(compositesToShow.length - 2, 1) : compositesToShow.pop();
		}

		// Remove the overflow action if there are no overflows
		if (!overflows && this.compositeOverflowAction) {
			compositeSwitcherBar.pull(compositeSwitcherBar.length() - 1);

			this.compositeOverflowAction.dispose();
			this.compositeOverflowAction = undefined;

			if (this.compositeOverflowActionViewItem) {
				this.compositeOverflowActionViewItem.dispose();
			}
			this.compositeOverflowActionViewItem = undefined;
		}

		// Pull out composites that overflow or got hidden
		const compositesToRemove: number[] = [];
		this.visibleComposites.forEach((compositeId, index) => {
			if (!compositesToShow.includes(compositeId)) {
				compositesToRemove.push(index);
			}
		});
		compositesToRemove.reverse().forEach(index => {
			const actionViewItem = compositeSwitcherBar.viewItems[index];
			compositeSwitcherBar.pull(index);
			actionViewItem.dispose();
			this.visibleComposites.splice(index, 1);
		});

		// Update the positions of the composites
		compositesToShow.forEach((compositeId, newIndex) => {
			const currentIndex = this.visibleComposites.indexOf(compositeId);
			if (newIndex !== currentIndex) {
				if (currentIndex !== -1) {
					const actionViewItem = compositeSwitcherBar.viewItems[currentIndex];
					compositeSwitcherBar.pull(currentIndex);
					actionViewItem.dispose();
					this.visibleComposites.splice(currentIndex, 1);
				}

				compositeSwitcherBar.push(this.model.findItem(compositeId).activityAction, { label: true, icon: this.options.icon, index: newIndex });
				this.visibleComposites.splice(newIndex, 0, compositeId);
			}
		});

		// Add overflow action as needed
		if ((overflows && !this.compositeOverflowAction)) {
			this.compositeOverflowAction = this.instantiationService.createInstance(CompositeOverflowActivityAction, () => {
				if (this.compositeOverflowActionViewItem) {
					this.compositeOverflowActionViewItem.showMenu();
				}
			});
			this.compositeOverflowActionViewItem = this.instantiationService.createInstance(
				CompositeOverflowActivityActionViewItem,
				this.compositeOverflowAction,
				() => this.getOverflowingComposites(),
				() => this.model.activeItem ? this.model.activeItem.id : undefined,
				compositeId => {
					const item = this.model.findItem(compositeId);
					return item?.activity[0]?.badge;
				},
				this.options.getOnCompositeClickAction,
				this.options.colors,
				this.options.activityHoverOptions
			);

			compositeSwitcherBar.push(this.compositeOverflowAction, { label: false, icon: true });
		}

		this._onDidChange.fire();
	}

	private getOverflowingComposites(): { id: string, name?: string; }[] {
		let overflowingIds = this.model.visibleItems.filter(item => item.pinned).map(item => item.id);

		// Show the active composite even if it is not pinned
		if (this.model.activeItem && !this.model.activeItem.pinned) {
			overflowingIds.push(this.model.activeItem.id);
		}

		overflowingIds = overflowingIds.filter(compositeId => !this.visibleComposites.includes(compositeId));
		return this.model.visibleItems.filter(c => overflowingIds.includes(c.id)).map(item => { return { id: item.id, name: this.getAction(item.id)?.label || item.name }; });
	}

	private showContextMenu(e: MouseEvent): void {
		EventHelper.stop(e, true);
		const event = new StandardMouseEvent(e);
		this.contextMenuService.showContextMenu({
			getAnchor: () => { return { x: event.posx, y: event.posy }; },
			getActions: () => this.getContextMenuActions()
		});
	}

	getContextMenuActions(): IAction[] {
		const actions: IAction[] = this.model.visibleItems
			.map(({ id, name, activityAction }) => (toAction({
				id,
				label: this.getAction(id).label || name || id,
				checked: this.isPinned(id),
				enabled: activityAction.enabled,
				run: () => {
					if (this.isPinned(id)) {
						this.unpin(id);
					} else {
						this.pin(id, true);
					}
				}
			})));

		this.options.fillExtraContextMenuActions(actions);

		return actions;
	}
}

interface ICompositeBarModelItem extends ICompositeBarItem {
	activityAction: ActivityAction;
	pinnedAction: IAction;
	activity: ICompositeActivity[];
}

class CompositeBarModel {

	private _items: ICompositeBarModelItem[] = [];
	private readonly options: ICompositeBarOptions;
	activeItem?: ICompositeBarModelItem;

	constructor(
		items: ICompositeBarItem[],
		options: ICompositeBarOptions
	) {
		this.options = options;
		this.setItems(items);
	}

	get items(): ICompositeBarModelItem[] {
		return this._items;
	}

	setItems(items: ICompositeBarItem[]): boolean {
		const result: ICompositeBarModelItem[] = [];
		let hasChanges: boolean = false;
		if (!this.items || this.items.length === 0) {
			this._items = items.map(i => this.createCompositeBarItem(i.id, i.name, i.order, i.pinned, i.visible));
			hasChanges = true;
		} else {
			const existingItems = this.items;
			for (let index = 0; index < items.length; index++) {
				const newItem = items[index];
				const existingItem = existingItems.filter(({ id }) => id === newItem.id)[0];
				if (existingItem) {
					if (
						existingItem.pinned !== newItem.pinned ||
						index !== existingItems.indexOf(existingItem)
					) {
						existingItem.pinned = newItem.pinned;
						result.push(existingItem);
						hasChanges = true;
					} else {
						result.push(existingItem);
					}
				} else {
					result.push(this.createCompositeBarItem(newItem.id, newItem.name, newItem.order, newItem.pinned, newItem.visible));
					hasChanges = true;
				}
			}
			this._items = result;
		}

		return hasChanges;
	}

	get visibleItems(): ICompositeBarModelItem[] {
		return this.items.filter(item => item.visible);
	}

	get pinnedItems(): ICompositeBarModelItem[] {
		return this.items.filter(item => item.visible && item.pinned);
	}

	private createCompositeBarItem(id: string, name: string | undefined, order: number | undefined, pinned: boolean, visible: boolean): ICompositeBarModelItem {
		const options = this.options;
		return {
			id, name, pinned, order, visible,
			activity: [],
			get activityAction() {
				return options.getActivityAction(id);
			},
			get pinnedAction() {
				return options.getCompositePinnedAction(id);
			}
		};
	}

	add(id: string, name: string, order: number | undefined, requestedIndex: number | undefined): boolean {
		const item = this.findItem(id);
		if (item) {
			let changed = false;
			item.name = name;
			if (!isUndefinedOrNull(order)) {
				changed = item.order !== order;
				item.order = order;
			}
			if (!item.visible) {
				item.visible = true;
				changed = true;
			}

			return changed;
		} else {
			const item = this.createCompositeBarItem(id, name, order, true, true);
			if (!isUndefinedOrNull(requestedIndex)) {
				let index = 0;
				let rIndex = requestedIndex;
				while (rIndex > 0 && index < this.items.length) {
					if (this.items[index++].visible) {
						rIndex--;
					}
				}

				this.items.splice(index, 0, item);
			} else if (isUndefinedOrNull(order)) {
				this.items.push(item);
			} else {
				let index = 0;
				while (index < this.items.length && typeof this.items[index].order === 'number' && this.items[index].order! < order) {
					index++;
				}
				this.items.splice(index, 0, item);
			}

			return true;
		}
	}

	remove(id: string): boolean {
		for (let index = 0; index < this.items.length; index++) {
			if (this.items[index].id === id) {
				this.items.splice(index, 1);
				return true;
			}
		}
		return false;
	}

	hide(id: string): boolean {
		for (const item of this.items) {
			if (item.id === id) {
				if (item.visible) {
					item.visible = false;
					return true;
				}
				return false;
			}
		}
		return false;
	}

	move(compositeId: string, toCompositeId: string): boolean {

		const fromIndex = this.findIndex(compositeId);
		const toIndex = this.findIndex(toCompositeId);

		// Make sure both items are known to the model
		if (fromIndex === -1 || toIndex === -1) {
			return false;
		}

		const sourceItem = this.items.splice(fromIndex, 1)[0];
		this.items.splice(toIndex, 0, sourceItem);

		// Make sure a moved composite gets pinned
		sourceItem.pinned = true;

		return true;
	}

	setPinned(id: string, pinned: boolean): boolean {
		for (const item of this.items) {
			if (item.id === id) {
				if (item.pinned !== pinned) {
					item.pinned = pinned;
					return true;
				}
				return false;
			}
		}
		return false;
	}

	addActivity(id: string, activity: ICompositeActivity): boolean {
		const item = this.findItem(id);
		if (item) {
			const stack = item.activity;
			for (let i = 0; i <= stack.length; i++) {
				if (i === stack.length) {
					stack.push(activity);
					break;
				} else if (stack[i].priority <= activity.priority) {
					stack.splice(i, 0, activity);
					break;
				}
			}
			this.updateActivity(id);
			return true;
		}
		return false;
	}

	removeActivity(id: string, activity: ICompositeActivity): boolean {
		const item = this.findItem(id);
		if (item) {
			const index = item.activity.indexOf(activity);
			if (index !== -1) {
				item.activity.splice(index, 1);
				this.updateActivity(id);
				return true;
			}
		}
		return false;
	}

	updateActivity(id: string): void {
		const item = this.findItem(id);
		if (item) {
			if (item.activity.length) {
				const [{ badge, clazz }] = item.activity;
				item.activityAction.setBadge(badge, clazz);
			}
			else {
				item.activityAction.setBadge(undefined);
			}
		}
	}

	activate(id: string): boolean {
		if (!this.activeItem || this.activeItem.id !== id) {
			if (this.activeItem) {
				this.deactivate();
			}
			for (const item of this.items) {
				if (item.id === id) {
					this.activeItem = item;
					this.activeItem.activityAction.activate();
					return true;
				}
			}
		}
		return false;
	}

	deactivate(): boolean {
		if (this.activeItem) {
			this.activeItem.activityAction.deactivate();
			this.activeItem = undefined;
			return true;
		}
		return false;
	}

	findItem(id: string): ICompositeBarModelItem {
		return this.items.filter(item => item.id === id)[0];
	}

	private findIndex(id: string): number {
		for (let index = 0; index < this.items.length; index++) {
			if (this.items[index].id === id) {
				return index;
			}
		}
		return -1;
	}
}
