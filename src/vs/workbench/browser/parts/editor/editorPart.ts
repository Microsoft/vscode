/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IThemeService } from 'vs/platform/theme/common/themeService';
import { Part } from 'vs/workbench/browser/part';
import { Dimension, isAncestor, $, EventHelper, addDisposableGenericMouseDownListner } from 'vs/base/browser/dom';
import { Event, Emitter, Relay } from 'vs/base/common/event';
import { contrastBorder, editorBackground } from 'vs/platform/theme/common/colorRegistry';
import { GroupDirection, IAddGroupOptions, GroupsArrangement, GroupOrientation, IMergeGroupOptions, MergeGroupMode, GroupsOrder, GroupChangeKind, GroupLocation, IFindGroupScope, EditorGroupLayout, GroupLayoutArgument, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IView, orthogonal, LayoutPriority, IViewSize, Direction, SerializableGrid, Sizing, ISerializedGrid, Orientation, GridBranchNode, isGridBranchNode, GridNode, createSerializedGrid, Grid } from 'vs/base/browser/ui/grid/grid';
import { GroupIdentifier, IEditorPartOptions, IEditorPartOptionsChangeEvent } from 'vs/workbench/common/editor';
import { EDITOR_GROUP_BORDER, EDITOR_PANE_BACKGROUND } from 'vs/workbench/common/theme';
import { distinct, coalesce } from 'vs/base/common/arrays';
import { IEditorGroupsAccessor, IEditorGroupView, getEditorPartOptions, impactsEditorPartOptions, IEditorPartCreationOptions } from 'vs/workbench/browser/parts/editor/editor';
import { EditorGroupView } from 'vs/workbench/browser/parts/editor/editorGroupView';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IDisposable, dispose, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ISerializedEditorGroupModel, isSerializedEditorGroupModel } from 'vs/workbench/common/editor/editorGroupModel';
import { EditorDropTarget, IEditorDropTargetDelegate } from 'vs/workbench/browser/parts/editor/editorDropTarget';
import { IEditorDropService } from 'vs/workbench/services/editor/browser/editorDropService';
import { Color } from 'vs/base/common/color';
import { CenteredViewLayout } from 'vs/base/browser/ui/centered/centeredViewLayout';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Parts, IWorkbenchLayoutService, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { assertIsDefined } from 'vs/base/common/types';
import { IBoundarySashes } from 'vs/base/browser/ui/grid/gridview';
import { CompositeDragAndDropObserver } from 'vs/workbench/browser/dnd';
import { Promises } from 'vs/base/common/async';

interface IEditorPartUIState {
	serializedGrid: ISerializedGrid;
	activeGroup: GroupIdentifier;
	mostRecentActiveGroups: GroupIdentifier[];
}

class GridWidgetView<T extends IView> implements IView {

	readonly element: HTMLElement = $('.grid-view-container');

	get minimumWidth(): number { return this.gridWidget ? this.gridWidget.minimumWidth : 0; }
	get maximumWidth(): number { return this.gridWidget ? this.gridWidget.maximumWidth : Number.POSITIVE_INFINITY; }
	get minimumHeight(): number { return this.gridWidget ? this.gridWidget.minimumHeight : 0; }
	get maximumHeight(): number { return this.gridWidget ? this.gridWidget.maximumHeight : Number.POSITIVE_INFINITY; }

	private _onDidChange = new Relay<{ width: number; height: number; } | undefined>();
	readonly onDidChange = this._onDidChange.event;

	private _gridWidget: Grid<T> | undefined;

	get gridWidget(): Grid<T> | undefined {
		return this._gridWidget;
	}

	set gridWidget(grid: Grid<T> | undefined) {
		this.element.innerText = '';

		if (grid) {
			this.element.appendChild(grid.element);
			this._onDidChange.input = grid.onDidChange;
		} else {
			this._onDidChange.input = Event.None;
		}

		this._gridWidget = grid;
	}

	layout(width: number, height: number): void {
		if (this.gridWidget) {
			this.gridWidget.layout(width, height);
		}
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}

export class EditorPart extends Part implements IEditorGroupsService, IEditorGroupsAccessor, IEditorDropService {

	declare readonly _serviceBrand: undefined;

	private static readonly EDITOR_PART_UI_STATE_STORAGE_KEY = 'editorpart.state';
	private static readonly EDITOR_PART_CENTERED_VIEW_STORAGE_KEY = 'editorpart.centeredview';

	//#region Events

	private readonly _onDidLayout = this._register(new Emitter<Dimension>());
	readonly onDidLayout = this._onDidLayout.event;

	private readonly _onDidChangeActiveGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidChangeActiveGroup = this._onDidChangeActiveGroup.event;

	private readonly _onDidChangeGroupIndex = this._register(new Emitter<IEditorGroupView>());
	readonly onDidChangeGroupIndex = this._onDidChangeGroupIndex.event;

	private readonly _onDidActivateGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidActivateGroup = this._onDidActivateGroup.event;

	private readonly _onDidAddGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidAddGroup = this._onDidAddGroup.event;

	private readonly _onDidRemoveGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidRemoveGroup = this._onDidRemoveGroup.event;

	private readonly _onDidMoveGroup = this._register(new Emitter<IEditorGroupView>());
	readonly onDidMoveGroup = this._onDidMoveGroup.event;

	private readonly onDidSetGridWidget = this._register(new Emitter<{ width: number; height: number; } | undefined>());

	private readonly _onDidChangeSizeConstraints = this._register(new Relay<{ width: number; height: number; } | undefined>());
	readonly onDidChangeSizeConstraints = Event.any(this.onDidSetGridWidget.event, this._onDidChangeSizeConstraints.event);

	private readonly _onDidChangeEditorPartOptions = this._register(new Emitter<IEditorPartOptionsChangeEvent>());
	readonly onDidChangeEditorPartOptions = this._onDidChangeEditorPartOptions.event;

	//#endregion

	private readonly workspaceMemento = this.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE);
	private readonly globalMemento = this.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);

	private readonly groupViews = new Map<GroupIdentifier, IEditorGroupView>();
	private mostRecentActiveGroups: GroupIdentifier[] = [];

	private container: HTMLElement | undefined;

	private centeredLayoutWidget!: CenteredViewLayout;

	private gridWidget!: SerializableGrid<IEditorGroupView>;
	private readonly gridWidgetView = this._register(new GridWidgetView<IEditorGroupView>());

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super(Parts.EDITOR_PART, { hasTitle: false }, themeService, storageService, layoutService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(e)));
		this._register(this.themeService.onDidFileIconThemeChange(() => this.handleChangedPartOptions()));
	}

	private onConfigurationUpdated(event: IConfigurationChangeEvent): void {
		if (impactsEditorPartOptions(event)) {
			this.handleChangedPartOptions();
		}
	}

	private handleChangedPartOptions(): void {
		const oldPartOptions = this._partOptions;
		const newPartOptions = getEditorPartOptions(this.configurationService, this.themeService);

		this.enforcedPartOptions.forEach(enforcedPartOptions => {
			Object.assign(newPartOptions, enforcedPartOptions); // check for overrides
		});

		this._partOptions = newPartOptions;

		this._onDidChangeEditorPartOptions.fire({ oldPartOptions, newPartOptions });
	}

	//#region IEditorGroupsService

	private enforcedPartOptions: IEditorPartOptions[] = [];

	private _partOptions = getEditorPartOptions(this.configurationService, this.themeService);
	get partOptions(): IEditorPartOptions { return this._partOptions; }

	enforcePartOptions(options: IEditorPartOptions): IDisposable {
		this.enforcedPartOptions.push(options);
		this.handleChangedPartOptions();

		return toDisposable(() => {
			this.enforcedPartOptions.splice(this.enforcedPartOptions.indexOf(options), 1);
			this.handleChangedPartOptions();
		});
	}

	private _contentDimension!: Dimension;
	get contentDimension(): Dimension { return this._contentDimension; }

	private _activeGroup!: IEditorGroupView;
	get activeGroup(): IEditorGroupView {
		return this._activeGroup;
	}

	get groups(): IEditorGroupView[] {
		return Array.from(this.groupViews.values());
	}

	get count(): number {
		return this.groupViews.size;
	}

	get orientation(): GroupOrientation {
		return (this.gridWidget && this.gridWidget.orientation === Orientation.VERTICAL) ? GroupOrientation.VERTICAL : GroupOrientation.HORIZONTAL;
	}

	private whenReadyResolve: (() => void) | undefined;
	readonly whenReady = new Promise<void>(resolve => (this.whenReadyResolve = resolve));

	private whenRestoredResolve: (() => void) | undefined;
	readonly whenRestored = new Promise<void>(resolve => (this.whenRestoredResolve = resolve));
	private restored = false;

	isRestored(): boolean {
		return this.restored;
	}

	get hasRestorableState(): boolean {
		return !!this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
	}

	getGroups(order = GroupsOrder.CREATION_TIME): IEditorGroupView[] {
		switch (order) {
			case GroupsOrder.CREATION_TIME:
				return this.groups;

			case GroupsOrder.MOST_RECENTLY_ACTIVE:
				const mostRecentActive = coalesce(this.mostRecentActiveGroups.map(groupId => this.getGroup(groupId)));

				// there can be groups that got never active, even though they exist. in this case
				// make sure to just append them at the end so that all groups are returned properly
				return distinct([...mostRecentActive, ...this.groups]);

			case GroupsOrder.GRID_APPEARANCE:
				const views: IEditorGroupView[] = [];
				if (this.gridWidget) {
					this.fillGridNodes(views, this.gridWidget.getViews());
				}

				return views;
		}
	}

	private fillGridNodes(target: IEditorGroupView[], node: GridBranchNode<IEditorGroupView> | GridNode<IEditorGroupView>): void {
		if (isGridBranchNode(node)) {
			node.children.forEach(child => this.fillGridNodes(target, child));
		} else {
			target.push(node.view);
		}
	}

	getGroup(identifier: GroupIdentifier): IEditorGroupView | undefined {
		return this.groupViews.get(identifier);
	}

	findGroup(scope: IFindGroupScope, source: IEditorGroupView | GroupIdentifier = this.activeGroup, wrap?: boolean): IEditorGroupView {

		// by direction
		if (typeof scope.direction === 'number') {
			return this.doFindGroupByDirection(scope.direction, source, wrap);
		}

		// by location
		if (typeof scope.location === 'number') {
			return this.doFindGroupByLocation(scope.location, source, wrap);
		}

		throw new Error('invalid arguments');
	}

	private doFindGroupByDirection(direction: GroupDirection, source: IEditorGroupView | GroupIdentifier, wrap?: boolean): IEditorGroupView {
		const sourceGroupView = this.assertGroupView(source);

		// Find neighbours and sort by our MRU list
		const neighbours = this.gridWidget.getNeighborViews(sourceGroupView, this.toGridViewDirection(direction), wrap);
		neighbours.sort(((n1, n2) => this.mostRecentActiveGroups.indexOf(n1.id) - this.mostRecentActiveGroups.indexOf(n2.id)));

		return neighbours[0];
	}

	private doFindGroupByLocation(location: GroupLocation, source: IEditorGroupView | GroupIdentifier, wrap?: boolean): IEditorGroupView {
		const sourceGroupView = this.assertGroupView(source);
		const groups = this.getGroups(GroupsOrder.GRID_APPEARANCE);
		const index = groups.indexOf(sourceGroupView);

		switch (location) {
			case GroupLocation.FIRST:
				return groups[0];
			case GroupLocation.LAST:
				return groups[groups.length - 1];
			case GroupLocation.NEXT:
				let nextGroup = groups[index + 1];
				if (!nextGroup && wrap) {
					nextGroup = this.doFindGroupByLocation(GroupLocation.FIRST, source);
				}

				return nextGroup;
			case GroupLocation.PREVIOUS:
				let previousGroup = groups[index - 1];
				if (!previousGroup && wrap) {
					previousGroup = this.doFindGroupByLocation(GroupLocation.LAST, source);
				}

				return previousGroup;
		}
	}

	activateGroup(group: IEditorGroupView | GroupIdentifier): IEditorGroupView {
		const groupView = this.assertGroupView(group);
		this.doSetGroupActive(groupView);

		this._onDidActivateGroup.fire(groupView);
		return groupView;
	}

	restoreGroup(group: IEditorGroupView | GroupIdentifier): IEditorGroupView {
		const groupView = this.assertGroupView(group);
		this.doRestoreGroup(groupView);

		return groupView;
	}

	getSize(group: IEditorGroupView | GroupIdentifier): { width: number, height: number } {
		const groupView = this.assertGroupView(group);

		return this.gridWidget.getViewSize(groupView);
	}

	setSize(group: IEditorGroupView | GroupIdentifier, size: { width: number, height: number }): void {
		const groupView = this.assertGroupView(group);

		this.gridWidget.resizeView(groupView, size);
	}

	arrangeGroups(arrangement: GroupsArrangement, target = this.activeGroup): void {
		if (this.count < 2) {
			return; // require at least 2 groups to show
		}

		if (!this.gridWidget) {
			return; // we have not been created yet
		}

		switch (arrangement) {
			case GroupsArrangement.EVEN:
				this.gridWidget.distributeViewSizes();
				break;
			case GroupsArrangement.MINIMIZE_OTHERS:
				this.gridWidget.maximizeViewSize(target);
				break;
			case GroupsArrangement.TOGGLE:
				if (this.isGroupMaximized(target)) {
					this.arrangeGroups(GroupsArrangement.EVEN);
				} else {
					this.arrangeGroups(GroupsArrangement.MINIMIZE_OTHERS);
				}

				break;
		}
	}

	private isGroupMaximized(targetGroup: IEditorGroupView): boolean {
		for (const group of this.groups) {
			if (group === targetGroup) {
				continue; // ignore target group
			}

			if (!group.isMinimized) {
				return false; // target cannot be maximized if one group is not minimized
			}
		}

		return true;
	}

	setGroupOrientation(orientation: GroupOrientation): void {
		if (!this.gridWidget) {
			return; // we have not been created yet
		}

		const newOrientation = (orientation === GroupOrientation.HORIZONTAL) ? Orientation.HORIZONTAL : Orientation.VERTICAL;
		if (this.gridWidget.orientation !== newOrientation) {
			this.gridWidget.orientation = newOrientation;
		}
	}

	applyLayout(layout: EditorGroupLayout): void {
		const restoreFocus = this.shouldRestoreFocus(this.container);

		// Determine how many groups we need overall
		let layoutGroupsCount = 0;
		function countGroups(groups: GroupLayoutArgument[]): void {
			groups.forEach(group => {
				if (Array.isArray(group.groups)) {
					countGroups(group.groups);
				} else {
					layoutGroupsCount++;
				}
			});
		}
		countGroups(layout.groups);

		// If we currently have too many groups, merge them into the last one
		let currentGroupViews = this.getGroups(GroupsOrder.GRID_APPEARANCE);
		if (layoutGroupsCount < currentGroupViews.length) {
			const lastGroupInLayout = currentGroupViews[layoutGroupsCount - 1];
			currentGroupViews.forEach((group, index) => {
				if (index >= layoutGroupsCount) {
					this.mergeGroup(group, lastGroupInLayout);
				}
			});

			currentGroupViews = this.getGroups(GroupsOrder.GRID_APPEARANCE);
		}

		const activeGroup = this.activeGroup;

		// Prepare grid descriptor to create new grid from
		const gridDescriptor = createSerializedGrid({
			orientation: this.toGridViewOrientation(
				layout.orientation,
				this.isTwoDimensionalGrid() ?
					this.gridWidget.orientation :			// preserve original orientation for 2-dimensional grids
					orthogonal(this.gridWidget.orientation) // otherwise flip (fix https://github.com/microsoft/vscode/issues/52975)
			),
			groups: layout.groups
		});

		// Recreate gridwidget with descriptor
		this.doCreateGridControlWithState(gridDescriptor, activeGroup.id, currentGroupViews);

		// Layout
		this.doLayout(this._contentDimension);

		// Update container
		this.updateContainer();

		// Events for groups that got added
		this.getGroups(GroupsOrder.GRID_APPEARANCE).forEach(groupView => {
			if (!currentGroupViews.includes(groupView)) {
				this._onDidAddGroup.fire(groupView);
			}
		});

		// Notify group index change given layout has changed
		this.notifyGroupIndexChange();

		// Restore focus as needed
		if (restoreFocus) {
			this._activeGroup.focus();
		}
	}

	private shouldRestoreFocus(target: Element | undefined): boolean {
		if (!target) {
			return false;
		}

		const activeElement = document.activeElement;

		if (activeElement === document.body) {
			return true; // always restore focus if nothing is focused currently
		}

		// otherwise check for the active element being an ancestor of the target
		return isAncestor(activeElement, target);
	}

	private isTwoDimensionalGrid(): boolean {
		const views = this.gridWidget.getViews();
		if (isGridBranchNode(views)) {
			// the grid is 2-dimensional if any children
			// of the grid is a branch node
			return views.children.some(child => isGridBranchNode(child));
		}

		return false;
	}

	addGroup(location: IEditorGroupView | GroupIdentifier, direction: GroupDirection, options?: IAddGroupOptions): IEditorGroupView {
		const locationView = this.assertGroupView(location);

		const group = this.doAddGroup(locationView, direction);

		if (options?.activate) {
			this.doSetGroupActive(group);
		}

		return group;
	}

	private doAddGroup(locationView: IEditorGroupView, direction: GroupDirection, groupToCopy?: IEditorGroupView): IEditorGroupView {
		const newGroupView = this.doCreateGroupView(groupToCopy);

		// Add to grid widget
		this.gridWidget.addView(
			newGroupView,
			this.getSplitSizingStyle(),
			locationView,
			this.toGridViewDirection(direction),
		);

		// Update container
		this.updateContainer();

		// Event
		this._onDidAddGroup.fire(newGroupView);

		// Notify group index change given a new group was added
		this.notifyGroupIndexChange();

		return newGroupView;
	}

	private getSplitSizingStyle(): Sizing {
		return this._partOptions.splitSizing === 'split' ? Sizing.Split : Sizing.Distribute;
	}

	private doCreateGroupView(from?: IEditorGroupView | ISerializedEditorGroupModel | null): IEditorGroupView {

		// Create group view
		let groupView: IEditorGroupView;
		if (from instanceof EditorGroupView) {
			groupView = EditorGroupView.createCopy(from, this, this.count, this.instantiationService);
		} else if (isSerializedEditorGroupModel(from)) {
			groupView = EditorGroupView.createFromSerialized(from, this, this.count, this.instantiationService);
		} else {
			groupView = EditorGroupView.createNew(this, this.count, this.instantiationService);
		}

		// Keep in map
		this.groupViews.set(groupView.id, groupView);

		// Track focus
		const groupDisposables = new DisposableStore();
		groupDisposables.add(groupView.onDidFocus(() => {
			this.doSetGroupActive(groupView);
		}));

		// Track editor change
		groupDisposables.add(groupView.onDidGroupChange(e => {
			switch (e.kind) {
				case GroupChangeKind.EDITOR_ACTIVE:
					this.updateContainer();
					break;
				case GroupChangeKind.GROUP_INDEX:
					this._onDidChangeGroupIndex.fire(groupView);
					break;
			}
		}));

		// Track dispose
		Event.once(groupView.onWillDispose)(() => {
			dispose(groupDisposables);
			this.groupViews.delete(groupView.id);
			this.doUpdateMostRecentActive(groupView);
		});

		return groupView;
	}

	private doSetGroupActive(group: IEditorGroupView): void {
		if (this._activeGroup === group) {
			return; // return if this is already the active group
		}

		const previousActiveGroup = this._activeGroup;
		this._activeGroup = group;

		// Update list of most recently active groups
		this.doUpdateMostRecentActive(group, true);

		// Mark previous one as inactive
		if (previousActiveGroup) {
			previousActiveGroup.setActive(false);
		}

		// Mark group as new active
		group.setActive(true);

		// Maximize the group if it is currently minimized
		this.doRestoreGroup(group);

		// Event
		this._onDidChangeActiveGroup.fire(group);
	}

	private doRestoreGroup(group: IEditorGroupView): void {
		if (this.gridWidget) {
			const viewSize = this.gridWidget.getViewSize(group);
			if (viewSize.width === group.minimumWidth || viewSize.height === group.minimumHeight) {
				this.arrangeGroups(GroupsArrangement.MINIMIZE_OTHERS, group);
			}
		}
	}

	private doUpdateMostRecentActive(group: IEditorGroupView, makeMostRecentlyActive?: boolean): void {
		const index = this.mostRecentActiveGroups.indexOf(group.id);

		// Remove from MRU list
		if (index !== -1) {
			this.mostRecentActiveGroups.splice(index, 1);
		}

		// Add to front as needed
		if (makeMostRecentlyActive) {
			this.mostRecentActiveGroups.unshift(group.id);
		}
	}

	private toGridViewDirection(direction: GroupDirection): Direction {
		switch (direction) {
			case GroupDirection.UP: return Direction.Up;
			case GroupDirection.DOWN: return Direction.Down;
			case GroupDirection.LEFT: return Direction.Left;
			case GroupDirection.RIGHT: return Direction.Right;
		}
	}

	private toGridViewOrientation(orientation: GroupOrientation, fallback: Orientation): Orientation {
		if (typeof orientation === 'number') {
			return orientation === GroupOrientation.HORIZONTAL ? Orientation.HORIZONTAL : Orientation.VERTICAL;
		}

		return fallback;
	}

	removeGroup(group: IEditorGroupView | GroupIdentifier): void {
		const groupView = this.assertGroupView(group);
		if (this.groupViews.size === 1) {
			return; // Cannot remove the last root group
		}

		// Remove empty group
		if (groupView.isEmpty) {
			return this.doRemoveEmptyGroup(groupView);
		}

		// Remove group with editors
		this.doRemoveGroupWithEditors(groupView);
	}

	private doRemoveGroupWithEditors(groupView: IEditorGroupView): void {
		const mostRecentlyActiveGroups = this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);

		let lastActiveGroup: IEditorGroupView;
		if (this._activeGroup === groupView) {
			lastActiveGroup = mostRecentlyActiveGroups[1];
		} else {
			lastActiveGroup = mostRecentlyActiveGroups[0];
		}

		// Removing a group with editors should merge these editors into the
		// last active group and then remove this group.
		this.mergeGroup(groupView, lastActiveGroup);
	}

	private doRemoveEmptyGroup(groupView: IEditorGroupView): void {
		const restoreFocus = this.shouldRestoreFocus(this.container);

		// Activate next group if the removed one was active
		if (this._activeGroup === groupView) {
			const mostRecentlyActiveGroups = this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
			const nextActiveGroup = mostRecentlyActiveGroups[1]; // [0] will be the current group we are about to dispose
			this.activateGroup(nextActiveGroup);
		}

		// Remove from grid widget & dispose
		this.gridWidget.removeView(groupView, this.getSplitSizingStyle());
		groupView.dispose();

		// Restore focus if we had it previously (we run this after gridWidget.removeView() is called
		// because removing a view can mean to reparent it and thus focus would be removed otherwise)
		if (restoreFocus) {
			this._activeGroup.focus();
		}

		// Notify group index change given a group was removed
		this.notifyGroupIndexChange();

		// Update container
		this.updateContainer();

		// Event
		this._onDidRemoveGroup.fire(groupView);
	}

	moveGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView {
		const sourceView = this.assertGroupView(group);
		const targetView = this.assertGroupView(location);

		if (sourceView.id === targetView.id) {
			throw new Error('Cannot move group into its own');
		}

		const restoreFocus = this.shouldRestoreFocus(sourceView.element);

		// Move through grid widget API
		this.gridWidget.moveView(sourceView, this.getSplitSizingStyle(), targetView, this.toGridViewDirection(direction));

		// Restore focus if we had it previously (we run this after gridWidget.removeView() is called
		// because removing a view can mean to reparent it and thus focus would be removed otherwise)
		if (restoreFocus) {
			sourceView.focus();
		}

		// Event
		this._onDidMoveGroup.fire(sourceView);

		// Notify group index change given a group was moved
		this.notifyGroupIndexChange();

		return sourceView;
	}

	copyGroup(group: IEditorGroupView | GroupIdentifier, location: IEditorGroupView | GroupIdentifier, direction: GroupDirection): IEditorGroupView {
		const groupView = this.assertGroupView(group);
		const locationView = this.assertGroupView(location);

		const restoreFocus = this.shouldRestoreFocus(groupView.element);

		// Copy the group view
		const copiedGroupView = this.doAddGroup(locationView, direction, groupView);

		// Restore focus if we had it
		if (restoreFocus) {
			copiedGroupView.focus();
		}

		return copiedGroupView;
	}

	mergeGroup(group: IEditorGroupView | GroupIdentifier, target: IEditorGroupView | GroupIdentifier, options?: IMergeGroupOptions): IEditorGroupView {
		const sourceView = this.assertGroupView(group);
		const targetView = this.assertGroupView(target);

		// Move/Copy editors over into target
		let index = (options && typeof options.index === 'number') ? options.index : targetView.count;
		sourceView.editors.forEach(editor => {
			const inactive = !sourceView.isActive(editor) || this._activeGroup !== sourceView;
			const sticky = sourceView.isSticky(editor);
			const editorOptions = { index: !sticky ? index : undefined /* do not set index to preserve sticky flag */, inactive, preserveFocus: inactive };

			if (options?.mode === MergeGroupMode.COPY_EDITORS) {
				sourceView.copyEditor(editor, targetView, editorOptions);
			} else {
				sourceView.moveEditor(editor, targetView, editorOptions);
			}

			index++;
		});

		// Remove source if the view is now empty and not already removed
		if (sourceView.isEmpty && !sourceView.disposed /* could have been disposed already via workbench.editor.closeEmptyGroups setting */) {
			this.removeGroup(sourceView);
		}

		return targetView;
	}

	mergeAllGroups(target = this.activeGroup): IEditorGroupView {
		for (const group of this.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			if (group === target) {
				continue; // keep target
			}

			this.mergeGroup(group, target);
		}

		return target;
	}

	private assertGroupView(group: IEditorGroupView | GroupIdentifier): IEditorGroupView {
		let groupView: IEditorGroupView | undefined;
		if (typeof group === 'number') {
			groupView = this.getGroup(group);
		} else {
			groupView = group;
		}

		if (!groupView) {
			throw new Error('Invalid editor group provided!');
		}

		return groupView;
	}

	//#endregion

	//#region IEditorDropService

	createEditorDropTarget(container: HTMLElement, delegate: IEditorDropTargetDelegate): IDisposable {
		return this.instantiationService.createInstance(EditorDropTarget, this, container, delegate);
	}

	//#endregion

	//#region Part

	// TODO @sbatten @joao find something better to prevent editor taking over #79897
	get minimumWidth(): number { return Math.min(this.centeredLayoutWidget.minimumWidth, this.layoutService.getMaximumEditorDimensions().width); }
	get maximumWidth(): number { return this.centeredLayoutWidget.maximumWidth; }
	get minimumHeight(): number { return Math.min(this.centeredLayoutWidget.minimumHeight, this.layoutService.getMaximumEditorDimensions().height); }
	get maximumHeight(): number { return this.centeredLayoutWidget.maximumHeight; }

	readonly snap = true;

	override get onDidChange(): Event<IViewSize | undefined> { return Event.any(this.centeredLayoutWidget.onDidChange, this.onDidSetGridWidget.event); }
	readonly priority: LayoutPriority = LayoutPriority.High;

	private get gridSeparatorBorder(): Color {
		return this.theme.getColor(EDITOR_GROUP_BORDER) || this.theme.getColor(contrastBorder) || Color.transparent;
	}

	override updateStyles(): void {
		const container = assertIsDefined(this.container);
		container.style.backgroundColor = this.getColor(editorBackground) || '';

		const separatorBorderStyle = { separatorBorder: this.gridSeparatorBorder, background: this.theme.getColor(EDITOR_PANE_BACKGROUND) || Color.transparent };
		this.gridWidget.style(separatorBorderStyle);
		this.centeredLayoutWidget.styles(separatorBorderStyle);
	}

	override createContentArea(parent: HTMLElement, options?: IEditorPartCreationOptions): HTMLElement {

		// Container
		this.element = parent;
		this.container = document.createElement('div');
		this.container.classList.add('content');
		parent.appendChild(this.container);

		// Grid control
		this.doCreateGridControl(options);

		// Centered layout widget
		this.centeredLayoutWidget = this._register(new CenteredViewLayout(this.container, this.gridWidgetView, this.globalMemento[EditorPart.EDITOR_PART_CENTERED_VIEW_STORAGE_KEY]));

		// Drag & Drop support
		this.setupDragAndDropSupport(parent, this.container);

		// Signal ready
		this.whenReadyResolve?.();

		// Signal restored
		Promises.settled(this.groups.map(group => group.whenRestored)).finally(() => {
			this.restored = true;
			this.whenRestoredResolve?.();
		});

		return this.container;
	}

	private setupDragAndDropSupport(parent: HTMLElement, container: HTMLElement): void {

		// Editor drop target
		this._register(this.createEditorDropTarget(container, Object.create(null)));

		// No drop in the editor
		const overlay = document.createElement('div');
		overlay.classList.add('drop-block-overlay');
		parent.appendChild(overlay);

		// Hide the block if a mouse down event occurs #99065
		this._register(addDisposableGenericMouseDownListner(overlay, () => overlay.classList.remove('visible')));

		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(this.element, {
			onDragStart: e => overlay.classList.add('visible'),
			onDragEnd: e => overlay.classList.remove('visible')
		}));

		let panelOpenerTimeout: any;
		this._register(CompositeDragAndDropObserver.INSTANCE.registerTarget(overlay, {
			onDragOver: e => {
				EventHelper.stop(e.eventData, true);
				if (e.eventData.dataTransfer) {
					e.eventData.dataTransfer.dropEffect = 'none';
				}

				if (!this.layoutService.isVisible(Parts.PANEL_PART)) {
					const boundingRect = overlay.getBoundingClientRect();

					let openPanel = false;
					const proximity = 100;
					switch (this.layoutService.getPanelPosition()) {
						case Position.BOTTOM:
							if (e.eventData.clientY > boundingRect.bottom - proximity) {
								openPanel = true;
							}
							break;
						case Position.LEFT:
							if (e.eventData.clientX < boundingRect.left + proximity) {
								openPanel = true;
							}
							break;
						case Position.RIGHT:
							if (e.eventData.clientX > boundingRect.right - proximity) {
								openPanel = true;
							}
							break;
					}

					if (!panelOpenerTimeout && openPanel) {
						panelOpenerTimeout = setTimeout(() => this.layoutService.setPanelHidden(false), 200);
					} else if (panelOpenerTimeout && !openPanel) {
						clearTimeout(panelOpenerTimeout);
						panelOpenerTimeout = undefined;
					}
				}
			},
			onDragLeave: () => {
				if (panelOpenerTimeout) {
					clearTimeout(panelOpenerTimeout);
					panelOpenerTimeout = undefined;
				}
			},
			onDragEnd: () => {
				if (panelOpenerTimeout) {
					clearTimeout(panelOpenerTimeout);
					panelOpenerTimeout = undefined;
				}
			},
			onDrop: () => {
				if (panelOpenerTimeout) {
					clearTimeout(panelOpenerTimeout);
					panelOpenerTimeout = undefined;
				}
			}
		}));
	}

	centerLayout(active: boolean): void {
		this.centeredLayoutWidget.activate(active);

		this._activeGroup.focus();
	}

	isLayoutCentered(): boolean {
		if (this.centeredLayoutWidget) {
			return this.centeredLayoutWidget.isActive();
		}

		return false;
	}

	private doCreateGridControl(options?: IEditorPartCreationOptions): void {

		// Grid Widget (with previous UI state)
		let restoreError = false;
		if (!options || options.restorePreviousState) {
			restoreError = !this.doCreateGridControlWithPreviousState();
		}

		// Grid Widget (no previous UI state or failed to restore)
		if (!this.gridWidget || restoreError) {
			const initialGroup = this.doCreateGroupView();
			this.doSetGridWidget(new SerializableGrid(initialGroup));

			// Ensure a group is active
			this.doSetGroupActive(initialGroup);
		}

		// Update container
		this.updateContainer();

		// Notify group index change we created the entire grid
		this.notifyGroupIndexChange();
	}

	private doCreateGridControlWithPreviousState(): boolean {
		const uiState: IEditorPartUIState = this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
		if (uiState?.serializedGrid) {
			try {

				// MRU
				this.mostRecentActiveGroups = uiState.mostRecentActiveGroups;

				// Grid Widget
				this.doCreateGridControlWithState(uiState.serializedGrid, uiState.activeGroup);

				// Ensure last active group has focus
				this._activeGroup.focus();
			} catch (error) {

				// Log error
				onUnexpectedError(new Error(`Error restoring editor grid widget: ${error} (with state: ${JSON.stringify(uiState)})`));

				// Clear any state we have from the failing restore
				this.groupViews.forEach(group => group.dispose());
				this.groupViews.clear();
				this.mostRecentActiveGroups = [];

				return false; // failure
			}
		}

		return true; // success
	}

	private doCreateGridControlWithState(serializedGrid: ISerializedGrid, activeGroupId: GroupIdentifier, editorGroupViewsToReuse?: IEditorGroupView[]): void {

		// Determine group views to reuse if any
		let reuseGroupViews: IEditorGroupView[];
		if (editorGroupViewsToReuse) {
			reuseGroupViews = editorGroupViewsToReuse.slice(0); // do not modify original array
		} else {
			reuseGroupViews = [];
		}

		// Create new
		const groupViews: IEditorGroupView[] = [];
		const gridWidget = SerializableGrid.deserialize(serializedGrid, {
			fromJSON: (serializedEditorGroup: ISerializedEditorGroupModel | null) => {
				let groupView: IEditorGroupView;
				if (reuseGroupViews.length > 0) {
					groupView = reuseGroupViews.shift()!;
				} else {
					groupView = this.doCreateGroupView(serializedEditorGroup);
				}

				groupViews.push(groupView);

				if (groupView.id === activeGroupId) {
					this.doSetGroupActive(groupView);
				}

				return groupView;
			}
		}, { styles: { separatorBorder: this.gridSeparatorBorder } });

		// If the active group was not found when restoring the grid
		// make sure to make at least one group active. We always need
		// an active group.
		if (!this._activeGroup) {
			this.doSetGroupActive(groupViews[0]);
		}

		// Validate MRU group views matches grid widget state
		if (this.mostRecentActiveGroups.some(groupId => !this.getGroup(groupId))) {
			this.mostRecentActiveGroups = groupViews.map(group => group.id);
		}

		// Set it
		this.doSetGridWidget(gridWidget);
	}

	private doSetGridWidget(gridWidget: SerializableGrid<IEditorGroupView>): void {
		let boundarySashes: IBoundarySashes = {};

		if (this.gridWidget) {
			boundarySashes = this.gridWidget.boundarySashes;
			this.gridWidget.dispose();
		}

		this.gridWidget = gridWidget;
		this.gridWidget.boundarySashes = boundarySashes;
		this.gridWidgetView.gridWidget = gridWidget;

		this._onDidChangeSizeConstraints.input = gridWidget.onDidChange;

		this.onDidSetGridWidget.fire(undefined);
	}

	private updateContainer(): void {
		const container = assertIsDefined(this.container);
		container.classList.toggle('empty', this.isEmpty);
	}

	private notifyGroupIndexChange(): void {
		this.getGroups(GroupsOrder.GRID_APPEARANCE).forEach((group, index) => group.notifyIndexChanged(index));
	}

	private get isEmpty(): boolean {
		return this.groupViews.size === 1 && this._activeGroup.isEmpty;
	}

	setBoundarySashes(sashes: IBoundarySashes): void {
		this.gridWidget.boundarySashes = sashes;
		this.centeredLayoutWidget.boundarySashes = sashes;
	}

	override layout(width: number, height: number): void {

		// Layout contents
		const contentAreaSize = super.layoutContents(width, height).contentSize;

		// Layout editor container
		this.doLayout(Dimension.lift(contentAreaSize));
	}

	private doLayout(dimension: Dimension): void {
		this._contentDimension = dimension;

		// Layout Grid
		this.centeredLayoutWidget.layout(this._contentDimension.width, this._contentDimension.height);

		// Event
		this._onDidLayout.fire(dimension);
	}

	protected override saveState(): void {

		// Persist grid UI state
		if (this.gridWidget) {
			const uiState: IEditorPartUIState = {
				serializedGrid: this.gridWidget.serialize(),
				activeGroup: this._activeGroup.id,
				mostRecentActiveGroups: this.mostRecentActiveGroups
			};

			if (this.isEmpty) {
				delete this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY];
			} else {
				this.workspaceMemento[EditorPart.EDITOR_PART_UI_STATE_STORAGE_KEY] = uiState;
			}
		}

		// Persist centered view state
		if (this.centeredLayoutWidget) {
			const centeredLayoutState = this.centeredLayoutWidget.state;
			if (this.centeredLayoutWidget.isDefault(centeredLayoutState)) {
				delete this.globalMemento[EditorPart.EDITOR_PART_CENTERED_VIEW_STORAGE_KEY];
			} else {
				this.globalMemento[EditorPart.EDITOR_PART_CENTERED_VIEW_STORAGE_KEY] = centeredLayoutState;
			}
		}

		super.saveState();
	}

	toJSON(): object {
		return {
			type: Parts.EDITOR_PART
		};
	}

	override dispose(): void {

		// Forward to all groups
		this.groupViews.forEach(group => group.dispose());
		this.groupViews.clear();

		// Grid widget
		this.gridWidget?.dispose();

		super.dispose();
	}

	//#endregion
}

class EditorDropService implements IEditorDropService {

	declare readonly _serviceBrand: undefined;

	constructor(@IEditorGroupsService private readonly editorPart: EditorPart) { }

	createEditorDropTarget(container: HTMLElement, delegate: IEditorDropTargetDelegate): IDisposable {
		return this.editorPart.createEditorDropTarget(container, delegate);
	}
}

registerSingleton(IEditorGroupsService, EditorPart);
registerSingleton(IEditorDropService, EditorDropService);
