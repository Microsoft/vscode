/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./gridview';
import { Event, Emitter, Relay } from 'vs/base/common/event';
import { Orientation, Sash } from 'vs/base/browser/ui/sash/sash';
import { SplitView, IView as ISplitView, Sizing, LayoutPriority, ISplitViewStyles } from 'vs/base/browser/ui/splitview/splitview';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { $ } from 'vs/base/browser/dom';
import { tail2 as tail } from 'vs/base/common/arrays';
import { Color } from 'vs/base/common/color';
import { clamp } from 'vs/base/common/numbers';

export { Sizing, LayoutPriority } from 'vs/base/browser/ui/splitview/splitview';
export { Orientation } from 'vs/base/browser/ui/sash/sash';

export interface IViewSize {
	readonly width: number;
	readonly height: number;
}

interface IRelativeBoundarySashes {
	readonly start?: Sash;
	readonly end?: Sash;
	readonly orthogonalStart?: Sash;
	readonly orthogonalEnd?: Sash;
}

export interface IBoundarySashes {
	readonly top?: Sash;
	readonly right?: Sash;
	readonly bottom?: Sash;
	readonly left?: Sash;
}

export interface IView {
	readonly element: HTMLElement;
	readonly minimumWidth: number;
	readonly maximumWidth: number;
	readonly minimumHeight: number;
	readonly maximumHeight: number;
	readonly onDidChange: Event<IViewSize | undefined>;
	readonly priority?: LayoutPriority;
	readonly snap?: boolean;
	layout(width: number, height: number, top: number, left: number): void;
	setVisible?(visible: boolean): void;
	setBoundarySashes?(sashes: IBoundarySashes): void;
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

export interface ISerializedGridView {
	root: ISerializedNode;
	orientation: Orientation;
	width: number;
	height: number;
}

export function orthogonal(orientation: Orientation): Orientation {
	return orientation === Orientation.VERTICAL ? Orientation.HORIZONTAL : Orientation.VERTICAL;
}

export interface Box {
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
}

export interface GridLeafNode {
	readonly view: IView;
	readonly box: Box;
	readonly cachedVisibleSize: number | undefined;
}

export interface GridBranchNode {
	readonly children: GridNode[];
	readonly box: Box;
}

export type GridNode = GridLeafNode | GridBranchNode;

export function isGridBranchNode(node: GridNode): node is GridBranchNode {
	return !!(node as any).children;
}

export interface IGridViewStyles extends ISplitViewStyles { }

const defaultStyles: IGridViewStyles = {
	separatorBorder: Color.transparent
};

export interface ILayoutController {
	readonly isLayoutEnabled: boolean;
}

export class LayoutController implements ILayoutController {
	constructor(public isLayoutEnabled: boolean) { }
}

export class MultiplexLayoutController implements ILayoutController {
	get isLayoutEnabled(): boolean { return this.layoutControllers.every(l => l.isLayoutEnabled); }
	constructor(private layoutControllers: ILayoutController[]) { }
}

export interface IGridViewOptions {
	readonly styles?: IGridViewStyles;
	readonly proportionalLayout?: boolean; // default true
	readonly layoutController?: ILayoutController;
}

interface ILayoutContext {
	readonly orthogonalSize: number;
	readonly absoluteOffset: number;
	readonly absoluteOrthogonalOffset: number;
	readonly absoluteSize: number;
	readonly absoluteOrthogonalSize: number;
}

function toAbsoluteBoundarySashes(sashes: IRelativeBoundarySashes, orientation: Orientation): IBoundarySashes {
	if (orientation === Orientation.HORIZONTAL) {
		return { left: sashes.start, right: sashes.end, top: sashes.orthogonalStart, bottom: sashes.orthogonalEnd };
	} else {
		return { top: sashes.start, bottom: sashes.end, left: sashes.orthogonalStart, right: sashes.orthogonalEnd };
	}
}

function fromAbsoluteBoundarySashes(sashes: IBoundarySashes, orientation: Orientation): IRelativeBoundarySashes {
	if (orientation === Orientation.HORIZONTAL) {
		return { start: sashes.left, end: sashes.right, orthogonalStart: sashes.top, orthogonalEnd: sashes.bottom };
	} else {
		return { start: sashes.top, end: sashes.bottom, orthogonalStart: sashes.left, orthogonalEnd: sashes.right };
	}
}

class BranchNode implements ISplitView<ILayoutContext>, IDisposable {

	readonly element: HTMLElement;
	readonly children: Node[] = [];
	private splitview: SplitView<ILayoutContext>;

	private _size: number;
	get size(): number { return this._size; }

	private _orthogonalSize: number;
	get orthogonalSize(): number { return this._orthogonalSize; }

	private absoluteOffset: number = 0;
	private absoluteOrthogonalOffset: number = 0;

	private _styles: IGridViewStyles;
	get styles(): IGridViewStyles { return this._styles; }

	get width(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.size : this.orthogonalSize;
	}

	get height(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.orthogonalSize : this.size;
	}

	get top(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.absoluteOffset : this.absoluteOrthogonalOffset;
	}

	get left(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.absoluteOrthogonalOffset : this.absoluteOffset;
	}

	get minimumSize(): number {
		return this.children.length === 0 ? 0 : Math.max(...this.children.map(c => c.minimumOrthogonalSize));
	}

	get maximumSize(): number {
		return Math.min(...this.children.map(c => c.maximumOrthogonalSize));
	}

	get priority(): LayoutPriority {
		if (this.children.length === 0) {
			return LayoutPriority.Normal;
		}

		const priorities = this.children.map(c => typeof c.priority === 'undefined' ? LayoutPriority.Normal : c.priority);

		if (priorities.some(p => p === LayoutPriority.High)) {
			return LayoutPriority.High;
		} else if (priorities.some(p => p === LayoutPriority.Low)) {
			return LayoutPriority.Low;
		}

		return LayoutPriority.Normal;
	}

	get minimumOrthogonalSize(): number {
		return this.splitview.minimumSize;
	}

	get maximumOrthogonalSize(): number {
		return this.splitview.maximumSize;
	}

	get minimumWidth(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.minimumOrthogonalSize : this.minimumSize;
	}

	get minimumHeight(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.minimumSize : this.minimumOrthogonalSize;
	}

	get maximumWidth(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.maximumOrthogonalSize : this.maximumSize;
	}

	get maximumHeight(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.maximumSize : this.maximumOrthogonalSize;
	}

	private readonly _onDidChange = new Emitter<number | undefined>();
	readonly onDidChange: Event<number | undefined> = this._onDidChange.event;

	private childrenChangeDisposable: IDisposable = Disposable.None;

	private readonly _onDidSashReset = new Emitter<number[]>();
	readonly onDidSashReset: Event<number[]> = this._onDidSashReset.event;
	private splitviewSashResetDisposable: IDisposable = Disposable.None;
	private childrenSashResetDisposable: IDisposable = Disposable.None;

	private _boundarySashes: IRelativeBoundarySashes = {};
	get boundarySashes(): IRelativeBoundarySashes { return this._boundarySashes; }
	set boundarySashes(boundarySashes: IRelativeBoundarySashes) {
		this._boundarySashes = boundarySashes;

		this.splitview.orthogonalStartSash = boundarySashes.orthogonalStart;
		this.splitview.orthogonalEndSash = boundarySashes.orthogonalEnd;

		for (let index = 0; index < this.children.length; index++) {
			const child = this.children[index];
			const first = index === 0;
			const last = index === this.children.length - 1;

			child.boundarySashes = {
				start: boundarySashes.orthogonalStart,
				end: boundarySashes.orthogonalEnd,
				orthogonalStart: first ? boundarySashes.start : child.boundarySashes.orthogonalStart,
				orthogonalEnd: last ? boundarySashes.end : child.boundarySashes.orthogonalEnd,
			};
		}
	}

	constructor(
		readonly orientation: Orientation,
		readonly layoutController: ILayoutController,
		styles: IGridViewStyles,
		readonly proportionalLayout: boolean,
		size: number = 0,
		orthogonalSize: number = 0,
		childDescriptors?: INodeDescriptor[]
	) {
		this._styles = styles;
		this._size = size;
		this._orthogonalSize = orthogonalSize;

		this.element = $('.monaco-grid-branch-node');

		if (!childDescriptors) {
			// Normal behavior, we have no children yet, just set up the splitview
			this.splitview = new SplitView(this.element, { orientation, styles, proportionalLayout });
			this.splitview.layout(size, { orthogonalSize, absoluteOffset: 0, absoluteOrthogonalOffset: 0, absoluteSize: size, absoluteOrthogonalSize: orthogonalSize });
		} else {
			// Reconstruction behavior, we want to reconstruct a splitview
			const descriptor = {
				views: childDescriptors.map(childDescriptor => {
					return {
						view: childDescriptor.node,
						size: childDescriptor.node.size,
						visible: childDescriptor.node instanceof LeafNode && childDescriptor.visible !== undefined ? childDescriptor.visible : true
					};
				}),
				size: this.orthogonalSize
			};

			const options = { proportionalLayout, orientation, styles };

			this.children = childDescriptors.map(c => c.node);
			this.splitview = new SplitView(this.element, { ...options, descriptor });

			this.children.forEach((node, index) => {
				const first = index === 0;
				const last = index === this.children.length;

				node.boundarySashes = {
					start: this.boundarySashes.orthogonalStart,
					end: this.boundarySashes.orthogonalEnd,
					orthogonalStart: first ? this.boundarySashes.start : this.splitview.sashes[index - 1],
					orthogonalEnd: last ? this.boundarySashes.end : this.splitview.sashes[index],
				};
			});
		}

		const onDidSashReset = Event.map(this.splitview.onDidSashReset, i => [i]);
		this.splitviewSashResetDisposable = onDidSashReset(this._onDidSashReset.fire, this._onDidSashReset);

		const onDidChildrenChange = Event.map(Event.any(...this.children.map(c => c.onDidChange)), () => undefined);
		this.childrenChangeDisposable = onDidChildrenChange(this._onDidChange.fire, this._onDidChange);

		const onDidChildrenSashReset = Event.any(...this.children.map((c, i) => Event.map(c.onDidSashReset, location => [i, ...location])));
		this.childrenSashResetDisposable = onDidChildrenSashReset(this._onDidSashReset.fire, this._onDidSashReset);
	}

	style(styles: IGridViewStyles): void {
		this._styles = styles;
		this.splitview.style(styles);

		for (const child of this.children) {
			if (child instanceof BranchNode) {
				child.style(styles);
			}
		}
	}

	layout(size: number, offset: number, ctx: ILayoutContext | undefined): void {
		if (!this.layoutController.isLayoutEnabled) {
			return;
		}

		if (typeof ctx === 'undefined') {
			throw new Error('Invalid state');
		}

		// branch nodes should flip the normal/orthogonal directions
		this._size = ctx.orthogonalSize;
		this._orthogonalSize = size;
		this.absoluteOffset = ctx.absoluteOffset + offset;
		this.absoluteOrthogonalOffset = ctx.absoluteOrthogonalOffset;

		this.splitview.layout(ctx.orthogonalSize, {
			orthogonalSize: size,
			absoluteOffset: this.absoluteOrthogonalOffset,
			absoluteOrthogonalOffset: this.absoluteOffset,
			absoluteSize: ctx.absoluteOrthogonalSize,
			absoluteOrthogonalSize: ctx.absoluteSize
		});

		// Disable snapping on views which sit on the edges of the grid
		this.splitview.startSnappingEnabled = this.absoluteOrthogonalOffset > 0;
		this.splitview.endSnappingEnabled = this.absoluteOrthogonalOffset + ctx.orthogonalSize < ctx.absoluteOrthogonalSize;
	}

	setVisible(visible: boolean): void {
		for (const child of this.children) {
			child.setVisible(visible);
		}
	}

	addChild(node: Node, size: number | Sizing, index: number, skipLayout?: boolean): void {
		if (index < 0 || index > this.children.length) {
			throw new Error('Invalid index');
		}

		this.splitview.addView(node, size, index, skipLayout);
		this._addChild(node, index);
		this.onDidChildrenChange();
	}

	private _addChild(node: Node, index: number): void {
		const first = index === 0;
		const last = index === this.children.length;
		this.children.splice(index, 0, node);

		node.boundarySashes = {
			start: this.boundarySashes.orthogonalStart,
			end: this.boundarySashes.orthogonalEnd,
			orthogonalStart: first ? this.boundarySashes.start : this.splitview.sashes[index - 1],
			orthogonalEnd: last ? this.boundarySashes.end : this.splitview.sashes[index],
		};

		if (!first) {
			this.children[index - 1].boundarySashes = {
				...this.children[index - 1].boundarySashes,
				orthogonalEnd: this.splitview.sashes[index - 1]
			};
		}

		if (!last) {
			this.children[index + 1].boundarySashes = {
				...this.children[index + 1].boundarySashes,
				orthogonalStart: this.splitview.sashes[index]
			};
		}
	}

	removeChild(index: number, sizing?: Sizing): void {
		if (index < 0 || index >= this.children.length) {
			throw new Error('Invalid index');
		}

		this.splitview.removeView(index, sizing);
		this._removeChild(index);
		this.onDidChildrenChange();
	}

	private _removeChild(index: number): Node {
		const first = index === 0;
		const last = index === this.children.length - 1;
		const [child] = this.children.splice(index, 1);

		if (!first) {
			this.children[index - 1].boundarySashes = {
				...this.children[index - 1].boundarySashes,
				orthogonalEnd: this.splitview.sashes[index - 1]
			};
		}

		if (!last) { // [0,1,2,3] (2) => [0,1,3]
			this.children[index].boundarySashes = {
				...this.children[index].boundarySashes,
				orthogonalStart: this.splitview.sashes[Math.max(index - 1, 0)]
			};
		}

		return child;
	}

	moveChild(from: number, to: number): void {
		if (from === to) {
			return;
		}

		if (from < 0 || from >= this.children.length) {
			throw new Error('Invalid from index');
		}

		to = clamp(to, 0, this.children.length);

		if (from < to) {
			to--;
		}

		this.splitview.moveView(from, to);

		const child = this._removeChild(from);
		this._addChild(child, to);

		this.onDidChildrenChange();
	}

	swapChildren(from: number, to: number): void {
		if (from === to) {
			return;
		}

		if (from < 0 || from >= this.children.length) {
			throw new Error('Invalid from index');
		}

		to = clamp(to, 0, this.children.length);

		this.splitview.swapViews(from, to);

		// swap boundary sashes
		[this.children[from].boundarySashes, this.children[to].boundarySashes]
			= [this.children[from].boundarySashes, this.children[to].boundarySashes];

		// swap children
		[this.children[from], this.children[to]] = [this.children[to], this.children[from]];

		this.onDidChildrenChange();
	}

	resizeChild(index: number, size: number): void {
		if (index < 0 || index >= this.children.length) {
			throw new Error('Invalid index');
		}

		this.splitview.resizeView(index, size);
	}

	distributeViewSizes(recursive = false): void {
		this.splitview.distributeViewSizes();

		if (recursive) {
			for (const child of this.children) {
				if (child instanceof BranchNode) {
					child.distributeViewSizes(true);
				}
			}
		}
	}

	getChildSize(index: number): number {
		if (index < 0 || index >= this.children.length) {
			throw new Error('Invalid index');
		}

		return this.splitview.getViewSize(index);
	}

	isChildVisible(index: number): boolean {
		if (index < 0 || index >= this.children.length) {
			throw new Error('Invalid index');
		}

		return this.splitview.isViewVisible(index);
	}

	setChildVisible(index: number, visible: boolean): void {
		if (index < 0 || index >= this.children.length) {
			throw new Error('Invalid index');
		}

		if (this.splitview.isViewVisible(index) === visible) {
			return;
		}

		this.splitview.setViewVisible(index, visible);
	}

	getChildCachedVisibleSize(index: number): number | undefined {
		if (index < 0 || index >= this.children.length) {
			throw new Error('Invalid index');
		}

		return this.splitview.getViewCachedVisibleSize(index);
	}

	private onDidChildrenChange(): void {
		const onDidChildrenChange = Event.map(Event.any(...this.children.map(c => c.onDidChange)), () => undefined);
		this.childrenChangeDisposable.dispose();
		this.childrenChangeDisposable = onDidChildrenChange(this._onDidChange.fire, this._onDidChange);

		const onDidChildrenSashReset = Event.any(...this.children.map((c, i) => Event.map(c.onDidSashReset, location => [i, ...location])));
		this.childrenSashResetDisposable.dispose();
		this.childrenSashResetDisposable = onDidChildrenSashReset(this._onDidSashReset.fire, this._onDidSashReset);

		this._onDidChange.fire(undefined);
	}

	trySet2x2(other: BranchNode): IDisposable {
		if (this.children.length !== 2 || other.children.length !== 2) {
			return Disposable.None;
		}

		if (this.getChildSize(0) !== other.getChildSize(0)) {
			return Disposable.None;
		}

		const [firstChild, secondChild] = this.children;
		const [otherFirstChild, otherSecondChild] = other.children;

		if (!(firstChild instanceof LeafNode) || !(secondChild instanceof LeafNode)) {
			return Disposable.None;
		}

		if (!(otherFirstChild instanceof LeafNode) || !(otherSecondChild instanceof LeafNode)) {
			return Disposable.None;
		}

		if (this.orientation === Orientation.VERTICAL) {
			secondChild.linkedWidthNode = otherFirstChild.linkedHeightNode = firstChild;
			firstChild.linkedWidthNode = otherSecondChild.linkedHeightNode = secondChild;
			otherSecondChild.linkedWidthNode = firstChild.linkedHeightNode = otherFirstChild;
			otherFirstChild.linkedWidthNode = secondChild.linkedHeightNode = otherSecondChild;
		} else {
			otherFirstChild.linkedWidthNode = secondChild.linkedHeightNode = firstChild;
			otherSecondChild.linkedWidthNode = firstChild.linkedHeightNode = secondChild;
			firstChild.linkedWidthNode = otherSecondChild.linkedHeightNode = otherFirstChild;
			secondChild.linkedWidthNode = otherFirstChild.linkedHeightNode = otherSecondChild;
		}

		const mySash = this.splitview.sashes[0];
		const otherSash = other.splitview.sashes[0];
		mySash.linkedSash = otherSash;
		otherSash.linkedSash = mySash;

		this._onDidChange.fire(undefined);
		other._onDidChange.fire(undefined);

		return toDisposable(() => {
			mySash.linkedSash = otherSash.linkedSash = undefined;
			firstChild.linkedHeightNode = firstChild.linkedWidthNode = undefined;
			secondChild.linkedHeightNode = secondChild.linkedWidthNode = undefined;
			otherFirstChild.linkedHeightNode = otherFirstChild.linkedWidthNode = undefined;
			otherSecondChild.linkedHeightNode = otherSecondChild.linkedWidthNode = undefined;
		});
	}

	dispose(): void {
		for (const child of this.children) {
			child.dispose();
		}

		this._onDidChange.dispose();
		this._onDidSashReset.dispose();

		this.splitviewSashResetDisposable.dispose();
		this.childrenSashResetDisposable.dispose();
		this.childrenChangeDisposable.dispose();
		this.splitview.dispose();
	}
}

class LeafNode implements ISplitView<ILayoutContext>, IDisposable {

	private _size: number = 0;
	get size(): number { return this._size; }

	private _orthogonalSize: number;
	get orthogonalSize(): number { return this._orthogonalSize; }

	private absoluteOffset: number = 0;
	private absoluteOrthogonalOffset: number = 0;

	readonly onDidSashReset: Event<number[]> = Event.None;

	private _onDidLinkedWidthNodeChange = new Relay<number | undefined>();
	private _linkedWidthNode: LeafNode | undefined = undefined;
	get linkedWidthNode(): LeafNode | undefined { return this._linkedWidthNode; }
	set linkedWidthNode(node: LeafNode | undefined) {
		this._onDidLinkedWidthNodeChange.input = node ? node._onDidViewChange : Event.None;
		this._linkedWidthNode = node;
		this._onDidSetLinkedNode.fire(undefined);
	}

	private _onDidLinkedHeightNodeChange = new Relay<number | undefined>();
	private _linkedHeightNode: LeafNode | undefined = undefined;
	get linkedHeightNode(): LeafNode | undefined { return this._linkedHeightNode; }
	set linkedHeightNode(node: LeafNode | undefined) {
		this._onDidLinkedHeightNodeChange.input = node ? node._onDidViewChange : Event.None;
		this._linkedHeightNode = node;
		this._onDidSetLinkedNode.fire(undefined);
	}

	private readonly _onDidSetLinkedNode = new Emitter<number | undefined>();
	private _onDidViewChange: Event<number | undefined>;
	readonly onDidChange: Event<number | undefined>;

	constructor(
		readonly view: IView,
		readonly orientation: Orientation,
		readonly layoutController: ILayoutController,
		orthogonalSize: number,
		size: number = 0
	) {
		this._orthogonalSize = orthogonalSize;
		this._size = size;

		this._onDidViewChange = Event.map(this.view.onDidChange, e => e && (this.orientation === Orientation.VERTICAL ? e.width : e.height));
		this.onDidChange = Event.any(this._onDidViewChange, this._onDidSetLinkedNode.event, this._onDidLinkedWidthNodeChange.event, this._onDidLinkedHeightNodeChange.event);
	}

	get width(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.orthogonalSize : this.size;
	}

	get height(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.size : this.orthogonalSize;
	}

	get top(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.absoluteOffset : this.absoluteOrthogonalOffset;
	}

	get left(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.absoluteOrthogonalOffset : this.absoluteOffset;
	}

	get element(): HTMLElement {
		return this.view.element;
	}

	private get minimumWidth(): number {
		return this.linkedWidthNode ? Math.max(this.linkedWidthNode.view.minimumWidth, this.view.minimumWidth) : this.view.minimumWidth;
	}

	private get maximumWidth(): number {
		return this.linkedWidthNode ? Math.min(this.linkedWidthNode.view.maximumWidth, this.view.maximumWidth) : this.view.maximumWidth;
	}

	private get minimumHeight(): number {
		return this.linkedHeightNode ? Math.max(this.linkedHeightNode.view.minimumHeight, this.view.minimumHeight) : this.view.minimumHeight;
	}

	private get maximumHeight(): number {
		return this.linkedHeightNode ? Math.min(this.linkedHeightNode.view.maximumHeight, this.view.maximumHeight) : this.view.maximumHeight;
	}

	get minimumSize(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.minimumHeight : this.minimumWidth;
	}

	get maximumSize(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.maximumHeight : this.maximumWidth;
	}

	get priority(): LayoutPriority | undefined {
		return this.view.priority;
	}

	get snap(): boolean | undefined {
		return this.view.snap;
	}

	get minimumOrthogonalSize(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.minimumWidth : this.minimumHeight;
	}

	get maximumOrthogonalSize(): number {
		return this.orientation === Orientation.HORIZONTAL ? this.maximumWidth : this.maximumHeight;
	}

	private _boundarySashes: IRelativeBoundarySashes = {};
	get boundarySashes(): IRelativeBoundarySashes { return this._boundarySashes; }
	set boundarySashes(boundarySashes: IRelativeBoundarySashes) {
		this._boundarySashes = boundarySashes;

		if (this.view.setBoundarySashes) {
			this.view.setBoundarySashes(toAbsoluteBoundarySashes(boundarySashes, this.orientation));
		}
	}

	layout(size: number, offset: number, ctx: ILayoutContext | undefined): void {
		if (!this.layoutController.isLayoutEnabled) {
			return;
		}

		if (typeof ctx === 'undefined') {
			throw new Error('Invalid state');
		}

		this._size = size;
		this._orthogonalSize = ctx.orthogonalSize;
		this.absoluteOffset = ctx.absoluteOffset + offset;
		this.absoluteOrthogonalOffset = ctx.absoluteOrthogonalOffset;
		this.view.layout(this.width, this.height, this.top, this.left);
	}

	setVisible(visible: boolean): void {
		if (this.view.setVisible) {
			this.view.setVisible(visible);
		}
	}

	dispose(): void { }
}

type Node = BranchNode | LeafNode;

export interface INodeDescriptor {
	node: Node;
	visible?: boolean;
}

function flipNode<T extends Node>(node: T, size: number, orthogonalSize: number): T {
	if (node instanceof BranchNode) {
		const result = new BranchNode(orthogonal(node.orientation), node.layoutController, node.styles, node.proportionalLayout, size, orthogonalSize);

		let totalSize = 0;

		for (let i = node.children.length - 1; i >= 0; i--) {
			const child = node.children[i];
			const childSize = child instanceof BranchNode ? child.orthogonalSize : child.size;

			let newSize = node.size === 0 ? 0 : Math.round((size * childSize) / node.size);
			totalSize += newSize;

			// The last view to add should adjust to rounding errors
			if (i === 0) {
				newSize += size - totalSize;
			}

			result.addChild(flipNode(child, orthogonalSize, newSize), newSize, 0, true);
		}

		return result as T;
	} else {
		return new LeafNode((node as LeafNode).view, orthogonal(node.orientation), node.layoutController, orthogonalSize) as T;
	}
}

export class GridView implements IDisposable {

	readonly element: HTMLElement;
	private styles: IGridViewStyles;
	private proportionalLayout: boolean;

	private _root!: BranchNode;
	private onDidSashResetRelay = new Relay<number[]>();
	readonly onDidSashReset: Event<number[]> = this.onDidSashResetRelay.event;

	private disposable2x2: IDisposable = Disposable.None;

	private get root(): BranchNode {
		return this._root;
	}

	private set root(root: BranchNode) {
		const oldRoot = this._root;

		if (oldRoot) {
			this.element.removeChild(oldRoot.element);
			oldRoot.dispose();
		}

		this._root = root;
		this.element.appendChild(root.element);
		this.onDidSashResetRelay.input = root.onDidSashReset;
		this._onDidChange.input = Event.map(root.onDidChange, () => undefined); // TODO
	}

	get orientation(): Orientation {
		return this._root.orientation;
	}

	set orientation(orientation: Orientation) {
		if (this._root.orientation === orientation) {
			return;
		}

		const { size, orthogonalSize } = this._root;
		this.root = flipNode(this._root, orthogonalSize, size);
		this.root.layout(size, 0, { orthogonalSize, absoluteOffset: 0, absoluteOrthogonalOffset: 0, absoluteSize: size, absoluteOrthogonalSize: orthogonalSize });
		this.boundarySashes = this.boundarySashes;
	}

	get width(): number { return this.root.width; }
	get height(): number { return this.root.height; }

	get minimumWidth(): number { return this.root.minimumWidth; }
	get minimumHeight(): number { return this.root.minimumHeight; }
	get maximumWidth(): number { return this.root.maximumHeight; }
	get maximumHeight(): number { return this.root.maximumHeight; }

	private _onDidChange = new Relay<IViewSize | undefined>();
	readonly onDidChange = this._onDidChange.event;

	private _boundarySashes: IBoundarySashes = {};
	get boundarySashes(): IBoundarySashes { return this._boundarySashes; }
	set boundarySashes(boundarySashes: IBoundarySashes) {
		this._boundarySashes = boundarySashes;
		this.root.boundarySashes = fromAbsoluteBoundarySashes(boundarySashes, this.orientation);
	}

	/**
	 * The first layout controller makes sure layout only propagates
	 * to the views after the very first call to gridview.layout()
	 */
	private firstLayoutController: LayoutController;
	private layoutController: LayoutController;

	constructor(options: IGridViewOptions = {}) {
		this.element = $('.monaco-grid-view');
		this.styles = options.styles || defaultStyles;
		this.proportionalLayout = typeof options.proportionalLayout !== 'undefined' ? !!options.proportionalLayout : true;

		this.firstLayoutController = new LayoutController(false);
		this.layoutController = new MultiplexLayoutController([
			this.firstLayoutController,
			...(options.layoutController ? [options.layoutController] : [])
		]);

		this.root = new BranchNode(Orientation.VERTICAL, this.layoutController, this.styles, this.proportionalLayout);
	}

	getViewMap(map: Map<IView, HTMLElement>, node?: Node): void {
		if (!node) {
			node = this.root;
		}

		if (node instanceof BranchNode) {
			node.children.forEach(child => this.getViewMap(map, child));
		} else {
			map.set(node.view, node.element);
		}
	}

	style(styles: IGridViewStyles): void {
		this.styles = styles;
		this.root.style(styles);
	}

	layout(width: number, height: number): void {
		this.firstLayoutController.isLayoutEnabled = true;

		const [size, orthogonalSize] = this.root.orientation === Orientation.HORIZONTAL ? [height, width] : [width, height];
		this.root.layout(size, 0, { orthogonalSize, absoluteOffset: 0, absoluteOrthogonalOffset: 0, absoluteSize: size, absoluteOrthogonalSize: orthogonalSize });
	}

	addView(view: IView, size: number | Sizing, location: number[]): void {
		this.disposable2x2.dispose();
		this.disposable2x2 = Disposable.None;

		const [rest, index] = tail(location);
		const [pathToParent, parent] = this.getNode(rest);

		if (parent instanceof BranchNode) {
			const node = new LeafNode(view, orthogonal(parent.orientation), this.layoutController, parent.orthogonalSize);
			parent.addChild(node, size, index);

		} else {
			const [, grandParent] = tail(pathToParent);
			const [, parentIndex] = tail(rest);

			let newSiblingSize: number | Sizing = 0;

			const newSiblingCachedVisibleSize = grandParent.getChildCachedVisibleSize(parentIndex);
			if (typeof newSiblingCachedVisibleSize === 'number') {
				newSiblingSize = Sizing.Invisible(newSiblingCachedVisibleSize);
			}

			grandParent.removeChild(parentIndex);

			const newParent = new BranchNode(parent.orientation, parent.layoutController, this.styles, this.proportionalLayout, parent.size, parent.orthogonalSize);
			grandParent.addChild(newParent, parent.size, parentIndex);

			const newSibling = new LeafNode(parent.view, grandParent.orientation, this.layoutController, parent.size);
			newParent.addChild(newSibling, newSiblingSize, 0);

			if (typeof size !== 'number' && size.type === 'split') {
				size = Sizing.Split(0);
			}

			const node = new LeafNode(view, grandParent.orientation, this.layoutController, parent.size);
			newParent.addChild(node, size, index);
		}
	}

	removeView(location: number[], sizing?: Sizing): IView {
		this.disposable2x2.dispose();
		this.disposable2x2 = Disposable.None;

		const [rest, index] = tail(location);
		const [pathToParent, parent] = this.getNode(rest);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		const node = parent.children[index];

		if (!(node instanceof LeafNode)) {
			throw new Error('Invalid location');
		}

		parent.removeChild(index, sizing);

		if (parent.children.length === 0) {
			throw new Error('Invalid grid state');
		}

		if (parent.children.length > 1) {
			return node.view;
		}

		if (pathToParent.length === 0) { // parent is root
			const sibling = parent.children[0];

			if (sibling instanceof LeafNode) {
				return node.view;
			}

			// we must promote sibling to be the new root
			parent.removeChild(0);
			this.root = sibling;
			this.boundarySashes = this.boundarySashes;
			return node.view;
		}

		const [, grandParent] = tail(pathToParent);
		const [, parentIndex] = tail(rest);

		const sibling = parent.children[0];
		const isSiblingVisible = parent.isChildVisible(0);
		parent.removeChild(0);

		const sizes = grandParent.children.map((_, i) => grandParent.getChildSize(i));
		grandParent.removeChild(parentIndex, sizing);

		if (sibling instanceof BranchNode) {
			sizes.splice(parentIndex, 1, ...sibling.children.map(c => c.size));

			for (let i = 0; i < sibling.children.length; i++) {
				const child = sibling.children[i];
				grandParent.addChild(child, child.size, parentIndex + i);
			}
		} else {
			const newSibling = new LeafNode(sibling.view, orthogonal(sibling.orientation), this.layoutController, sibling.size);
			const sizing = isSiblingVisible ? sibling.orthogonalSize : Sizing.Invisible(sibling.orthogonalSize);
			grandParent.addChild(newSibling, sizing, parentIndex);
		}

		for (let i = 0; i < sizes.length; i++) {
			grandParent.resizeChild(i, sizes[i]);
		}

		return node.view;
	}

	moveView(parentLocation: number[], from: number, to: number): void {
		const [, parent] = this.getNode(parentLocation);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		parent.moveChild(from, to);
	}

	swapViews(from: number[], to: number[]): void {
		const [fromRest, fromIndex] = tail(from);
		const [, fromParent] = this.getNode(fromRest);

		if (!(fromParent instanceof BranchNode)) {
			throw new Error('Invalid from location');
		}

		const fromSize = fromParent.getChildSize(fromIndex);
		const fromNode = fromParent.children[fromIndex];

		if (!(fromNode instanceof LeafNode)) {
			throw new Error('Invalid from location');
		}

		const [toRest, toIndex] = tail(to);
		const [, toParent] = this.getNode(toRest);

		if (!(toParent instanceof BranchNode)) {
			throw new Error('Invalid to location');
		}

		const toSize = toParent.getChildSize(toIndex);
		const toNode = toParent.children[toIndex];

		if (!(toNode instanceof LeafNode)) {
			throw new Error('Invalid to location');
		}

		if (fromParent === toParent) {
			fromParent.swapChildren(fromIndex, toIndex);
		} else {
			fromParent.removeChild(fromIndex);
			toParent.removeChild(toIndex);

			fromParent.addChild(toNode, fromSize, fromIndex);
			toParent.addChild(fromNode, toSize, toIndex);
		}
	}

	resizeView(location: number[], { width, height }: Partial<IViewSize>): void {
		const [rest, index] = tail(location);
		const [pathToParent, parent] = this.getNode(rest);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		if (!width && !height) {
			return;
		}

		const [parentSize, grandParentSize] = parent.orientation === Orientation.HORIZONTAL ? [width, height] : [height, width];

		if (typeof grandParentSize === 'number' && pathToParent.length > 0) {
			const [, grandParent] = tail(pathToParent);
			const [, parentIndex] = tail(rest);

			grandParent.resizeChild(parentIndex, grandParentSize);
		}

		if (typeof parentSize === 'number') {
			parent.resizeChild(index, parentSize);
		}
	}

	getViewSize(location?: number[]): IViewSize {
		if (!location) {
			return { width: this.root.width, height: this.root.height };
		}

		const [, node] = this.getNode(location);
		return { width: node.width, height: node.height };
	}

	getViewCachedVisibleSize(location: number[]): number | undefined {
		const [rest, index] = tail(location);
		const [, parent] = this.getNode(rest);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		return parent.getChildCachedVisibleSize(index);
	}

	maximizeViewSize(location: number[]): void {
		const [ancestors, node] = this.getNode(location);

		if (!(node instanceof LeafNode)) {
			throw new Error('Invalid location');
		}

		for (let i = 0; i < ancestors.length; i++) {
			ancestors[i].resizeChild(location[i], Number.POSITIVE_INFINITY);
		}
	}

	distributeViewSizes(location?: number[]): void {
		if (!location) {
			this.root.distributeViewSizes(true);
			return;
		}

		const [, node] = this.getNode(location);

		if (!(node instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		node.distributeViewSizes();
	}

	isViewVisible(location: number[]): boolean {
		const [rest, index] = tail(location);
		const [, parent] = this.getNode(rest);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid from location');
		}

		return parent.isChildVisible(index);
	}

	setViewVisible(location: number[], visible: boolean): void {
		const [rest, index] = tail(location);
		const [, parent] = this.getNode(rest);

		if (!(parent instanceof BranchNode)) {
			throw new Error('Invalid from location');
		}

		parent.setChildVisible(index, visible);
	}

	getView(): GridBranchNode;
	getView(location?: number[]): GridNode;
	getView(location?: number[]): GridNode {
		const node = location ? this.getNode(location)[1] : this._root;
		return this._getViews(node, this.orientation);
	}

	static deserialize<T extends ISerializableView>(json: ISerializedGridView, deserializer: IViewDeserializer<T>, options: IGridViewOptions = {}): GridView {
		if (typeof json.orientation !== 'number') {
			throw new Error('Invalid JSON: \'orientation\' property must be a number.');
		} else if (typeof json.width !== 'number') {
			throw new Error('Invalid JSON: \'width\' property must be a number.');
		} else if (typeof json.height !== 'number') {
			throw new Error('Invalid JSON: \'height\' property must be a number.');
		} else if (json.root?.type !== 'branch') {
			throw new Error('Invalid JSON: \'root\' property must have \'type\' value of branch.');
		}

		const orientation = json.orientation;
		const height = json.height;

		const result = new GridView(options);
		result._deserialize(json.root as ISerializedBranchNode, orientation, deserializer, height);

		return result;
	}

	private _deserialize(root: ISerializedBranchNode, orientation: Orientation, deserializer: IViewDeserializer<ISerializableView>, orthogonalSize: number): void {
		this.root = this._deserializeNode(root, orientation, deserializer, orthogonalSize) as BranchNode;
	}

	private _deserializeNode(node: ISerializedNode, orientation: Orientation, deserializer: IViewDeserializer<ISerializableView>, orthogonalSize: number): Node {
		let result: Node;
		if (node.type === 'branch') {
			const serializedChildren = node.data as ISerializedNode[];
			const children = serializedChildren.map(serializedChild => {
				return {
					node: this._deserializeNode(serializedChild, orthogonal(orientation), deserializer, node.size),
					visible: (serializedChild as { visible?: boolean }).visible
				} as INodeDescriptor;
			});

			result = new BranchNode(orientation, this.layoutController, this.styles, this.proportionalLayout, node.size, orthogonalSize, children);
		} else {
			result = new LeafNode(deserializer.fromJSON(node.data), orientation, this.layoutController, orthogonalSize, node.size);
		}

		return result;
	}

	private _getViews(node: Node, orientation: Orientation, cachedVisibleSize?: number): GridNode {
		const box = { top: node.top, left: node.left, width: node.width, height: node.height };

		if (node instanceof LeafNode) {
			return { view: node.view, box, cachedVisibleSize };
		}

		const children: GridNode[] = [];

		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i];
			const cachedVisibleSize = node.getChildCachedVisibleSize(i);

			children.push(this._getViews(child, orthogonal(orientation), cachedVisibleSize));
		}

		return { children, box };
	}

	private getNode(location: number[], node: Node = this.root, path: BranchNode[] = []): [BranchNode[], Node] {
		if (location.length === 0) {
			return [path, node];
		}

		if (!(node instanceof BranchNode)) {
			throw new Error('Invalid location');
		}

		const [index, ...rest] = location;

		if (index < 0 || index >= node.children.length) {
			throw new Error('Invalid location');
		}

		const child = node.children[index];
		path.push(node);

		return this.getNode(rest, child, path);
	}

	trySet2x2(): void {
		this.disposable2x2.dispose();
		this.disposable2x2 = Disposable.None;

		if (this.root.children.length !== 2) {
			return;
		}

		const [first, second] = this.root.children;

		if (!(first instanceof BranchNode) || !(second instanceof BranchNode)) {
			return;
		}

		this.disposable2x2 = first.trySet2x2(second);
	}

	dispose(): void {
		this.onDidSashResetRelay.dispose();
		this.root.dispose();

		if (this.element && this.element.parentElement) {
			this.element.parentElement.removeChild(this.element);
		}
	}
}
