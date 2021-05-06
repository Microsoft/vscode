/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./gridview';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { Disposable } from 'vs/base/common/lifecycle';
import { tail2 as tail, equals } from 'vs/base/common/arrays';
import { orthogonal, IView as IGridViewView, GridView, Sizing as GridViewSizing, Box, IGridViewStyles, IViewSize, IGridViewOptions, IBoundarySashes } from './gridview';
import { Event } from 'vs/base/common/event';

export { Orientation, IViewSize, orthogonal, LayoutPriority } from './gridview';

export const enum Direction {
	Up,
	Down,
	Left,
	Right
}

function oppositeDirection(direction: Direction): Direction {
	switch (direction) {
		case Direction.Up: return Direction.Down;
		case Direction.Down: return Direction.Up;
		case Direction.Left: return Direction.Right;
		case Direction.Right: return Direction.Left;
	}
}

export interface IView extends IGridViewView {
	readonly preferredHeight?: number;
	readonly preferredWidth?: number;
}

export interface GridLeafNode<T extends IView> {
	readonly view: T;
	readonly box: Box;
	readonly cachedVisibleSize: number | undefined;
}

export interface GridBranchNode<T extends IView> {
	readonly children: GridNode<T>[];
	readonly box: Box;
}

export type GridNode<T extends IView> = GridLeafNode<T> | GridBranchNode<T>;

export function isGridBranchNode<T extends IView>(node: GridNode<T>): node is GridBranchNode<T> {
	return !!(node as any).children;
}

function getGridNode<T extends IView>(node: GridNode<T>, location: number[]): GridNode<T> {
	if (location.length === 0) {
		return node;
	}

	if (!isGridBranchNode(node)) {
		throw new Error('Invalid location');
	}

	const [index, ...rest] = location;
	return getGridNode(node.children[index], rest);
}

interface Range {
	readonly start: number;
	readonly end: number;
}

function intersects(one: Range, other: Range): boolean {
	return !(one.start >= other.end || other.start >= one.end);
}

interface Boundary {
	readonly offset: number;
	readonly range: Range;
}

function getBoxBoundary(box: Box, direction: Direction): Boundary {
	const orientation = getDirectionOrientation(direction);
	const offset = direction === Direction.Up ? box.top :
		direction === Direction.Right ? box.left + box.width :
			direction === Direction.Down ? box.top + box.height :
				box.left;

	const range = {
		start: orientation === Orientation.HORIZONTAL ? box.top : box.left,
		end: orientation === Orientation.HORIZONTAL ? box.top + box.height : box.left + box.width
	};

	return { offset, range };
}

function findAdjacentBoxLeafNodes<T extends IView>(boxNode: GridNode<T>, direction: Direction, boundary: Boundary): GridLeafNode<T>[] {
	const result: GridLeafNode<T>[] = [];

	function _(boxNode: GridNode<T>, direction: Direction, boundary: Boundary): void {
		if (isGridBranchNode(boxNode)) {
			for (const child of boxNode.children) {
				_(child, direction, boundary);
			}
		} else {
			const { offset, range } = getBoxBoundary(boxNode.box, direction);

			if (offset === boundary.offset && intersects(range, boundary.range)) {
				result.push(boxNode);
			}
		}
	}

	_(boxNode, direction, boundary);
	return result;
}

function getLocationOrientation(rootOrientation: Orientation, location: number[]): Orientation {
	return location.length % 2 === 0 ? orthogonal(rootOrientation) : rootOrientation;
}

function getDirectionOrientation(direction: Direction): Orientation {
	return direction === Direction.Up || direction === Direction.Down ? Orientation.VERTICAL : Orientation.HORIZONTAL;
}

export function getRelativeLocation(rootOrientation: Orientation, location: number[], direction: Direction): number[] {
	const orientation = getLocationOrientation(rootOrientation, location);
	const directionOrientation = getDirectionOrientation(direction);

	if (orientation === directionOrientation) {
		let [rest, index] = tail(location);

		if (direction === Direction.Right || direction === Direction.Down) {
			index += 1;
		}

		return [...rest, index];
	} else {
		const index = (direction === Direction.Right || direction === Direction.Down) ? 1 : 0;
		return [...location, index];
	}
}

function indexInParent(element: HTMLElement): number {
	const parentElement = element.parentElement;

	if (!parentElement) {
		throw new Error('Invalid grid element');
	}

	let el = parentElement.firstElementChild;
	let index = 0;

	while (el !== element && el !== parentElement.lastElementChild && el) {
		el = el.nextElementSibling;
		index++;
	}

	return index;
}

/**
 * Find the grid location of a specific DOM element by traversing the parent
 * chain and finding each child index on the way.
 *
 * This will break as soon as DOM structures of the Splitview or Gridview change.
 */
function getGridLocation(element: HTMLElement): number[] {
	const parentElement = element.parentElement;

	if (!parentElement) {
		throw new Error('Invalid grid element');
	}

	if (/\bmonaco-grid-view\b/.test(parentElement.className)) {
		return [];
	}

	const index = indexInParent(parentElement);
	const ancestor = parentElement.parentElement!.parentElement!.parentElement!.parentElement!;
	return [...getGridLocation(ancestor), index];
}

export type DistributeSizing = { type: 'distribute' };
export type SplitSizing = { type: 'split' };
export type InvisibleSizing = { type: 'invisible', cachedVisibleSize: number };
export type Sizing = DistributeSizing | SplitSizing | InvisibleSizing;

export namespace Sizing {
	export const Distribute: DistributeSizing = { type: 'distribute' };
	export const Split: SplitSizing = { type: 'split' };
	export function Invisible(cachedVisibleSize: number): InvisibleSizing { return { type: 'invisible', cachedVisibleSize }; }
}

export interface IGridStyles extends IGridViewStyles { }

export interface IGridOptions extends IGridViewOptions {
	readonly firstViewVisibleCachedSize?: number;
}

export class Grid<T extends IView = IView> extends Disposable {

	protected gridview: GridView;
	private views = new Map<T, HTMLElement>();
	get orientation(): Orientation { return this.gridview.orientation; }
	set orientation(orientation: Orientation) { this.gridview.orientation = orientation; }

	get width(): number { return this.gridview.width; }
	get height(): number { return this.gridview.height; }

	get minimumWidth(): number { return this.gridview.minimumWidth; }
	get minimumHeight(): number { return this.gridview.minimumHeight; }
	get maximumWidth(): number { return this.gridview.maximumWidth; }
	get maximumHeight(): number { return this.gridview.maximumHeight; }
	get onDidChange(): Event<{ width: number; height: number; } | undefined> { return this.gridview.onDidChange; }

	get boundarySashes(): IBoundarySashes { return this.gridview.boundarySashes; }
	set boundarySashes(boundarySashes: IBoundarySashes) { this.gridview.boundarySashes = boundarySashes; }

	set edgeSnapping(edgeSnapping: boolean) { this.gridview.edgeSnapping = edgeSnapping; }

	get element(): HTMLElement { return this.gridview.element; }

	private didLayout = false;

	constructor(gridview: GridView, options?: IGridOptions);
	constructor(view: T, options?: IGridOptions);
	constructor(view: T | GridView, options: IGridOptions = {}) {
		super();

		if (view instanceof GridView) {
			this.gridview = view;
			this.gridview.getViewMap(this.views);
		} else {
			this.gridview = new GridView(options);
		}
		this._register(this.gridview);

		this._register(this.gridview.onDidSashReset(this.onDidSashReset, this));

		const size: number | GridViewSizing = typeof options.firstViewVisibleCachedSize === 'number'
			? GridViewSizing.Invisible(options.firstViewVisibleCachedSize)
			: 0;

		if (!(view instanceof GridView)) {
			this._addView(view, size, [0]);
		}
	}

	style(styles: IGridStyles): void {
		this.gridview.style(styles);
	}

	layout(width: number, height: number): void {
		this.gridview.layout(width, height);
		this.didLayout = true;
	}

	hasView(view: T): boolean {
		return this.views.has(view);
	}

	addView(newView: T, size: number | Sizing, referenceView: T, direction: Direction): void {
		if (this.views.has(newView)) {
			throw new Error('Can\'t add same view twice');
		}

		const orientation = getDirectionOrientation(direction);

		if (this.views.size === 1 && this.orientation !== orientation) {
			this.orientation = orientation;
		}

		const referenceLocation = this.getViewLocation(referenceView);
		const location = getRelativeLocation(this.gridview.orientation, referenceLocation, direction);

		let viewSize: number | GridViewSizing;

		if (typeof size === 'number') {
			viewSize = size;
		} else if (size.type === 'split') {
			const [, index] = tail(referenceLocation);
			viewSize = GridViewSizing.Split(index);
		} else if (size.type === 'distribute') {
			viewSize = GridViewSizing.Distribute;
		} else {
			viewSize = size;
		}

		this._addView(newView, viewSize, location);
	}

	addViewAt(newView: T, size: number | DistributeSizing | InvisibleSizing, location: number[]): void {
		if (this.views.has(newView)) {
			throw new Error('Can\'t add same view twice');
		}

		let viewSize: number | GridViewSizing;

		if (typeof size === 'number') {
			viewSize = size;
		} else if (size.type === 'distribute') {
			viewSize = GridViewSizing.Distribute;
		} else {
			viewSize = size;
		}

		this._addView(newView, viewSize, location);
	}

	protected _addView(newView: T, size: number | GridViewSizing, location: number[]): void {
		this.views.set(newView, newView.element);
		this.gridview.addView(newView, size, location);
	}

	removeView(view: T, sizing?: Sizing): void {
		if (this.views.size === 1) {
			throw new Error('Can\'t remove last view');
		}

		const location = this.getViewLocation(view);
		this.gridview.removeView(location, (sizing && sizing.type === 'distribute') ? GridViewSizing.Distribute : undefined);
		this.views.delete(view);
	}

	moveView(view: T, sizing: number | Sizing, referenceView: T, direction: Direction): void {
		const sourceLocation = this.getViewLocation(view);
		const [sourceParentLocation, from] = tail(sourceLocation);

		const referenceLocation = this.getViewLocation(referenceView);
		const targetLocation = getRelativeLocation(this.gridview.orientation, referenceLocation, direction);
		const [targetParentLocation, to] = tail(targetLocation);

		if (equals(sourceParentLocation, targetParentLocation)) {
			this.gridview.moveView(sourceParentLocation, from, to);
		} else {
			this.removeView(view, typeof sizing === 'number' ? undefined : sizing);
			this.addView(view, sizing, referenceView, direction);
		}
	}

	moveViewTo(view: T, location: number[]): void {
		const sourceLocation = this.getViewLocation(view);
		const [sourceParentLocation, from] = tail(sourceLocation);
		const [targetParentLocation, to] = tail(location);

		if (equals(sourceParentLocation, targetParentLocation)) {
			this.gridview.moveView(sourceParentLocation, from, to);
		} else {
			const size = this.getViewSize(view);
			const orientation = getLocationOrientation(this.gridview.orientation, sourceLocation);
			const cachedViewSize = this.getViewCachedVisibleSize(view);
			const sizing = typeof cachedViewSize === 'undefined'
				? (orientation === Orientation.HORIZONTAL ? size.width : size.height)
				: Sizing.Invisible(cachedViewSize);

			this.removeView(view);
			this.addViewAt(view, sizing, location);
		}
	}

	swapViews(from: T, to: T): void {
		const fromLocation = this.getViewLocation(from);
		const toLocation = this.getViewLocation(to);
		return this.gridview.swapViews(fromLocation, toLocation);
	}

	resizeView(view: T, size: IViewSize): void {
		const location = this.getViewLocation(view);
		return this.gridview.resizeView(location, size);
	}

	getViewSize(view?: T): IViewSize {
		if (!view) {
			return this.gridview.getViewSize();
		}

		const location = this.getViewLocation(view);
		return this.gridview.getViewSize(location);
	}

	getViewCachedVisibleSize(view: T): number | undefined {
		const location = this.getViewLocation(view);
		return this.gridview.getViewCachedVisibleSize(location);
	}

	maximizeViewSize(view: T): void {
		const location = this.getViewLocation(view);
		this.gridview.maximizeViewSize(location);
	}

	distributeViewSizes(): void {
		this.gridview.distributeViewSizes();
	}

	isViewVisible(view: T): boolean {
		const location = this.getViewLocation(view);
		return this.gridview.isViewVisible(location);
	}

	setViewVisible(view: T, visible: boolean): void {
		const location = this.getViewLocation(view);
		this.gridview.setViewVisible(location, visible);
	}

	getViews(): GridBranchNode<T> {
		return this.gridview.getView() as GridBranchNode<T>;
	}

	getNeighborViews(view: T, direction: Direction, wrap: boolean = false): T[] {
		if (!this.didLayout) {
			throw new Error('Can\'t call getNeighborViews before first layout');
		}

		const location = this.getViewLocation(view);
		const root = this.getViews();
		const node = getGridNode(root, location);
		let boundary = getBoxBoundary(node.box, direction);

		if (wrap) {
			if (direction === Direction.Up && node.box.top === 0) {
				boundary = { offset: root.box.top + root.box.height, range: boundary.range };
			} else if (direction === Direction.Right && node.box.left + node.box.width === root.box.width) {
				boundary = { offset: 0, range: boundary.range };
			} else if (direction === Direction.Down && node.box.top + node.box.height === root.box.height) {
				boundary = { offset: 0, range: boundary.range };
			} else if (direction === Direction.Left && node.box.left === 0) {
				boundary = { offset: root.box.left + root.box.width, range: boundary.range };
			}
		}

		return findAdjacentBoxLeafNodes(root, oppositeDirection(direction), boundary)
			.map(node => node.view);
	}

	getViewLocation(view: T): number[] {
		const element = this.views.get(view);

		if (!element) {
			throw new Error('View not found');
		}

		return getGridLocation(element);
	}

	private onDidSashReset(location: number[]): void {
		const resizeToPreferredSize = (location: number[]): boolean => {
			const node = this.gridview.getView(location) as GridNode<T>;

			if (isGridBranchNode(node)) {
				return false;
			}

			const direction = getLocationOrientation(this.orientation, location);
			const size = direction === Orientation.HORIZONTAL ? node.view.preferredWidth : node.view.preferredHeight;

			if (typeof size !== 'number') {
				return false;
			}

			const viewSize = direction === Orientation.HORIZONTAL ? { width: Math.round(size) } : { height: Math.round(size) };
			this.gridview.resizeView(location, viewSize);
			return true;
		};

		if (resizeToPreferredSize(location)) {
			return;
		}

		const [parentLocation, index] = tail(location);

		if (resizeToPreferredSize([...parentLocation, index + 1])) {
			return;
		}

		this.gridview.distributeViewSizes(parentLocation);
	}
}

export interface ISerializableView extends IView {
	toJSON(): object;
}

export interface IViewDeserializer<T extends ISerializableView> {
	fromJSON(json: any): T;
}

export interface ISerializedLeafNode {
	type: 'leaf';
	data: any;
	size: number;
	visible?: boolean;
}

export interface ISerializedBranchNode {
	type: 'branch';
	data: ISerializedNode[];
	size: number;
}

export type ISerializedNode = ISerializedLeafNode | ISerializedBranchNode;

export interface ISerializedGrid {
	root: ISerializedNode;
	orientation: Orientation;
	width: number;
	height: number;
}

export class SerializableGrid<T extends ISerializableView> extends Grid<T> {

	private static serializeNode<T extends ISerializableView>(node: GridNode<T>, orientation: Orientation): ISerializedNode {
		const size = orientation === Orientation.VERTICAL ? node.box.width : node.box.height;

		if (!isGridBranchNode(node)) {
			if (typeof node.cachedVisibleSize === 'number') {
				return { type: 'leaf', data: node.view.toJSON(), size: node.cachedVisibleSize, visible: false };
			}

			return { type: 'leaf', data: node.view.toJSON(), size };
		}

		return { type: 'branch', data: node.children.map(c => SerializableGrid.serializeNode(c, orthogonal(orientation))), size };
	}

	static deserialize<T extends ISerializableView>(json: ISerializedGrid, deserializer: IViewDeserializer<T>, options: IGridOptions = {}): SerializableGrid<T> {
		if (typeof json.orientation !== 'number') {
			throw new Error('Invalid JSON: \'orientation\' property must be a number.');
		} else if (typeof json.width !== 'number') {
			throw new Error('Invalid JSON: \'width\' property must be a number.');
		} else if (typeof json.height !== 'number') {
			throw new Error('Invalid JSON: \'height\' property must be a number.');
		}

		const gridview = GridView.deserialize(json, deserializer, options);
		const result = new SerializableGrid<T>(gridview, options);

		return result;
	}

	/**
	 * Useful information in order to proportionally restore view sizes
	 * upon the very first layout call.
	 */
	private initialLayoutContext: boolean = true;

	serialize(): ISerializedGrid {
		return {
			root: SerializableGrid.serializeNode(this.getViews(), this.orientation),
			orientation: this.orientation,
			width: this.width,
			height: this.height
		};
	}

	override layout(width: number, height: number): void {
		super.layout(width, height);

		if (this.initialLayoutContext) {
			this.initialLayoutContext = false;
			this.gridview.trySet2x2();
		}
	}
}

export type GridNodeDescriptor = { size?: number, groups?: GridNodeDescriptor[] };
export type GridDescriptor = { orientation: Orientation, groups?: GridNodeDescriptor[] };

export function sanitizeGridNodeDescriptor(nodeDescriptor: GridNodeDescriptor, rootNode: boolean): void {
	if (!rootNode && nodeDescriptor.groups && nodeDescriptor.groups.length <= 1) {
		nodeDescriptor.groups = undefined;
	}

	if (!nodeDescriptor.groups) {
		return;
	}

	let totalDefinedSize = 0;
	let totalDefinedSizeCount = 0;

	for (const child of nodeDescriptor.groups) {
		sanitizeGridNodeDescriptor(child, false);

		if (child.size) {
			totalDefinedSize += child.size;
			totalDefinedSizeCount++;
		}
	}

	const totalUndefinedSize = totalDefinedSizeCount > 0 ? totalDefinedSize : 1;
	const totalUndefinedSizeCount = nodeDescriptor.groups.length - totalDefinedSizeCount;
	const eachUndefinedSize = totalUndefinedSize / totalUndefinedSizeCount;

	for (const child of nodeDescriptor.groups) {
		if (!child.size) {
			child.size = eachUndefinedSize;
		}
	}
}

function createSerializedNode(nodeDescriptor: GridNodeDescriptor): ISerializedNode {
	if (nodeDescriptor.groups) {
		return { type: 'branch', data: nodeDescriptor.groups.map(c => createSerializedNode(c)), size: nodeDescriptor.size! };
	} else {
		return { type: 'leaf', data: null, size: nodeDescriptor.size! };
	}
}

function getDimensions(node: ISerializedNode, orientation: Orientation): { width?: number, height?: number } {
	if (node.type === 'branch') {
		const childrenDimensions = node.data.map(c => getDimensions(c, orthogonal(orientation)));

		if (orientation === Orientation.VERTICAL) {
			const width = node.size || (childrenDimensions.length === 0 ? undefined : Math.max(...childrenDimensions.map(d => d.width || 0)));
			const height = childrenDimensions.length === 0 ? undefined : childrenDimensions.reduce((r, d) => r + (d.height || 0), 0);
			return { width, height };
		} else {
			const width = childrenDimensions.length === 0 ? undefined : childrenDimensions.reduce((r, d) => r + (d.width || 0), 0);
			const height = node.size || (childrenDimensions.length === 0 ? undefined : Math.max(...childrenDimensions.map(d => d.height || 0)));
			return { width, height };
		}
	} else {
		const width = orientation === Orientation.VERTICAL ? node.size : undefined;
		const height = orientation === Orientation.VERTICAL ? undefined : node.size;
		return { width, height };
	}
}

export function createSerializedGrid(gridDescriptor: GridDescriptor): ISerializedGrid {
	sanitizeGridNodeDescriptor(gridDescriptor, true);

	const root = createSerializedNode(gridDescriptor);
	const { width, height } = getDimensions(root, gridDescriptor.orientation);

	return {
		root,
		orientation: gridDescriptor.orientation,
		width: width || 1,
		height: height || 1
	};
}
