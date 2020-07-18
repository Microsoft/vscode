/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Iterable } from 'vs/base/common/iterator';
import { Event } from 'vs/base/common/event';
import { ITreeModel, ITreeNode, ITreeElement, ICollapseStateChangeEvent, ITreeModelSpliceEvent, TreeError, TreeFilterResult, TreeVisibility, WeakMapper } from 'vs/base/browser/ui/tree/tree';
import { IObjectTreeModelOptions, ObjectTreeModel, IObjectTreeModel } from 'vs/base/browser/ui/tree/objectTreeModel';
import { IList } from 'vs/base/browser/ui/tree/indexTreeModel';

// Exported only for test reasons, do not use directly
export interface ICompressedTreeElement<T> extends ITreeElement<T> {
	readonly children?: Iterable<ICompressedTreeElement<T>>;
	readonly incompressible?: boolean;
}

// Exported only for test reasons, do not use directly
export interface ICompressedTreeNode<T> {
	readonly elements: T[];
	readonly incompressible: boolean;
}

function noCompress<T>(element: ICompressedTreeElement<T>): ITreeElement<ICompressedTreeNode<T>> {
	const elements = [element.element];
	const incompressible = element.incompressible || false;

	return {
		element: { elements, incompressible },
		children: Iterable.map(Iterable.from(element.children), noCompress),
		collapsible: element.collapsible,
		collapsed: element.collapsed
	};
}

// Exported only for test reasons, do not use directly
export function compress<T>(element: ICompressedTreeElement<T>): ITreeElement<ICompressedTreeNode<T>> {
	const elements = [element.element];
	const incompressible = element.incompressible || false;

	let childrenIterator: Iterable<ITreeElement<T>>;
	let children: ITreeElement<T>[];

	while (true) {
		[children, childrenIterator] = Iterable.consume(Iterable.from(element.children), 2);

		if (children.length !== 1) {
			break;
		}

		element = children[0];

		if (element.incompressible) {
			break;
		}

		elements.push(element.element);
	}

	return {
		element: { elements, incompressible },
		children: Iterable.map(Iterable.concat(children, childrenIterator), compress),
		collapsible: element.collapsible,
		collapsed: element.collapsed
	};
}

function _decompress<T>(element: ITreeElement<ICompressedTreeNode<T>>, index = 0): ICompressedTreeElement<T> {
	let children: Iterable<ICompressedTreeElement<T>>;

	if (index < element.element.elements.length - 1) {
		children = [_decompress(element, index + 1)];
	} else {
		children = Iterable.map(Iterable.from(element.children), el => _decompress(el, 0));
	}

	if (index === 0 && element.element.incompressible) {
		return {
			element: element.element.elements[index],
			children,
			incompressible: true,
			collapsible: element.collapsible,
			collapsed: element.collapsed
		};
	}

	return {
		element: element.element.elements[index],
		children,
		collapsible: element.collapsible,
		collapsed: element.collapsed
	};
}

// Exported only for test reasons, do not use directly
export function decompress<T>(element: ITreeElement<ICompressedTreeNode<T>>): ICompressedTreeElement<T> {
	return _decompress(element, 0);
}

function splice<T>(treeElement: ICompressedTreeElement<T>, element: T, children: Iterable<ICompressedTreeElement<T>>): ICompressedTreeElement<T> {
	if (treeElement.element === element) {
		return { ...treeElement, children };
	}

	return { ...treeElement, children: Iterable.map(Iterable.from(treeElement.children), e => splice(e, element, children)) };
}

interface ICompressedObjectTreeModelOptions<T, TFilterData> extends IObjectTreeModelOptions<ICompressedTreeNode<T>, TFilterData> {
	readonly compressionEnabled?: boolean;
}

// Exported only for test reasons, do not use directly
export class CompressedObjectTreeModel<T extends NonNullable<any>, TFilterData extends NonNullable<any> = void> implements ITreeModel<ICompressedTreeNode<T> | null, TFilterData, T | null> {

	readonly rootRef = null;

	get onDidSplice(): Event<ITreeModelSpliceEvent<ICompressedTreeNode<T> | null, TFilterData>> { return this.model.onDidSplice; }
	get onDidChangeCollapseState(): Event<ICollapseStateChangeEvent<ICompressedTreeNode<T>, TFilterData>> { return this.model.onDidChangeCollapseState; }
	get onDidChangeRenderNodeCount(): Event<ITreeNode<ICompressedTreeNode<T>, TFilterData>> { return this.model.onDidChangeRenderNodeCount; }

	private model: ObjectTreeModel<ICompressedTreeNode<T>, TFilterData>;
	private nodes = new Map<T | null, ICompressedTreeNode<T>>();
	private enabled: boolean;

	get size(): number { return this.nodes.size; }

	constructor(
		private user: string,
		list: IList<ITreeNode<ICompressedTreeNode<T>, TFilterData>>,
		options: ICompressedObjectTreeModelOptions<T, TFilterData> = {}
	) {
		this.model = new ObjectTreeModel(user, list, options);
		this.enabled = typeof options.compressionEnabled === 'undefined' ? true : options.compressionEnabled;
	}

	setChildren(
		element: T | null,
		children: Iterable<ICompressedTreeElement<T>> = Iterable.empty()
	): void {
		if (element === null) {
			const compressedChildren = Iterable.map(children, this.enabled ? compress : noCompress);
			this._setChildren(null, compressedChildren);
			return;
		}

		const compressedNode = this.nodes.get(element);

		if (!compressedNode) {
			throw new Error('Unknown compressed tree node');
		}

		const node = this.model.getNode(compressedNode) as ITreeNode<ICompressedTreeNode<T>, TFilterData>;
		const compressedParentNode = this.model.getParentNodeLocation(compressedNode);
		const parent = this.model.getNode(compressedParentNode) as ITreeNode<ICompressedTreeNode<T>, TFilterData>;

		const decompressedElement = decompress(node);
		const splicedElement = splice(decompressedElement, element, children);
		const recompressedElement = (this.enabled ? compress : noCompress)(splicedElement);

		const parentChildren = parent.children
			.map(child => child === node ? recompressedElement : child);

		this._setChildren(parent.element, parentChildren);
	}

	isCompressionEnabled(): boolean {
		return this.enabled;
	}

	setCompressionEnabled(enabled: boolean): void {
		if (enabled === this.enabled) {
			return;
		}

		this.enabled = enabled;

		const root = this.model.getNode();
		const rootChildren = root.children as ITreeNode<ICompressedTreeNode<T>>[];
		const decompressedRootChildren = Iterable.map(rootChildren, decompress);
		const recompressedRootChildren = Iterable.map(decompressedRootChildren, enabled ? compress : noCompress);
		this._setChildren(null, recompressedRootChildren);
	}

	private _setChildren(
		node: ICompressedTreeNode<T> | null,
		children: Iterable<ITreeElement<ICompressedTreeNode<T>>>
	): void {
		const insertedElements = new Set<T | null>();
		const _onDidCreateNode = (node: ITreeNode<ICompressedTreeNode<T>, TFilterData>) => {
			for (const element of node.element.elements) {
				insertedElements.add(element);
				this.nodes.set(element, node.element);
			}
		};

		const _onDidDeleteNode = (node: ITreeNode<ICompressedTreeNode<T>, TFilterData>) => {
			for (const element of node.element.elements) {
				if (!insertedElements.has(element)) {
					this.nodes.delete(element);
				}
			}
		};

		this.model.setChildren(node, children, _onDidCreateNode, _onDidDeleteNode);
	}

	has(element: T | null): boolean {
		return this.nodes.has(element);
	}

	getListIndex(location: T | null): number {
		const node = this.getCompressedNode(location);
		return this.model.getListIndex(node);
	}

	getListRenderCount(location: T | null): number {
		const node = this.getCompressedNode(location);
		return this.model.getListRenderCount(node);
	}

	getNode(location?: T | null | undefined): ITreeNode<ICompressedTreeNode<T> | null, TFilterData> {
		if (typeof location === 'undefined') {
			return this.model.getNode();
		}

		const node = this.getCompressedNode(location);
		return this.model.getNode(node);
	}

	// TODO: review this
	getNodeLocation(node: ITreeNode<ICompressedTreeNode<T>, TFilterData>): T | null {
		const compressedNode = this.model.getNodeLocation(node);

		if (compressedNode === null) {
			return null;
		}

		return compressedNode.elements[compressedNode.elements.length - 1];
	}

	// TODO: review this
	getParentNodeLocation(location: T | null): T | null {
		const compressedNode = this.getCompressedNode(location);
		const parentNode = this.model.getParentNodeLocation(compressedNode);

		if (parentNode === null) {
			return null;
		}

		return parentNode.elements[parentNode.elements.length - 1];
	}

	getFirstElementChild(location: T | null): ICompressedTreeNode<T> | null | undefined {
		const compressedNode = this.getCompressedNode(location);
		return this.model.getFirstElementChild(compressedNode);
	}

	getLastElementAncestor(location?: T | null | undefined): ICompressedTreeNode<T> | null | undefined {
		const compressedNode = typeof location === 'undefined' ? undefined : this.getCompressedNode(location);
		return this.model.getLastElementAncestor(compressedNode);
	}

	isCollapsible(location: T | null): boolean {
		const compressedNode = this.getCompressedNode(location);
		return this.model.isCollapsible(compressedNode);
	}

	setCollapsible(location: T | null, collapsible?: boolean): boolean {
		const compressedNode = this.getCompressedNode(location);
		return this.model.setCollapsible(compressedNode, collapsible);
	}

	isCollapsed(location: T | null): boolean {
		const compressedNode = this.getCompressedNode(location);
		return this.model.isCollapsed(compressedNode);
	}

	setCollapsed(location: T | null, collapsed?: boolean | undefined, recursive?: boolean | undefined): boolean {
		const compressedNode = this.getCompressedNode(location);
		return this.model.setCollapsed(compressedNode, collapsed, recursive);
	}

	expandTo(location: T | null): void {
		const compressedNode = this.getCompressedNode(location);
		this.model.expandTo(compressedNode);
	}

	rerender(location: T | null): void {
		const compressedNode = this.getCompressedNode(location);
		this.model.rerender(compressedNode);
	}

	updateElementHeight(element: T, height: number): void {
		const compressedNode = this.getCompressedNode(element);

		if (!compressedNode) {
			return;
		}

		this.model.updateElementHeight(compressedNode, height);
	}

	refilter(): void {
		this.model.refilter();
	}

	resort(location: T | null = null, recursive = true): void {
		const compressedNode = this.getCompressedNode(location);
		this.model.resort(compressedNode, recursive);
	}

	getCompressedNode(element: T | null): ICompressedTreeNode<T> | null {
		if (element === null) {
			return null;
		}

		const node = this.nodes.get(element);

		if (!node) {
			throw new TreeError(this.user, `Tree element not found: ${element}`);
		}

		return node;
	}
}

// Compressible Object Tree

export type ElementMapper<T> = (elements: T[]) => T;
export const DefaultElementMapper: ElementMapper<any> = elements => elements[elements.length - 1];

export type CompressedNodeUnwrapper<T> = (node: ICompressedTreeNode<T>) => T;
type CompressedNodeWeakMapper<T, TFilterData> = WeakMapper<ITreeNode<ICompressedTreeNode<T> | null, TFilterData>, ITreeNode<T | null, TFilterData>>;

class CompressedTreeNodeWrapper<T, TFilterData> implements ITreeNode<T | null, TFilterData> {

	get element(): T | null { return this.node.element === null ? null : this.unwrapper(this.node.element); }
	get children(): ITreeNode<T | null, TFilterData>[] { return this.node.children.map(node => new CompressedTreeNodeWrapper(this.unwrapper, node)); }
	get depth(): number { return this.node.depth; }
	get visibleChildrenCount(): number { return this.node.visibleChildrenCount; }
	get visibleChildIndex(): number { return this.node.visibleChildIndex; }
	get collapsible(): boolean { return this.node.collapsible; }
	get collapsed(): boolean { return this.node.collapsed; }
	get visible(): boolean { return this.node.visible; }
	get filterData(): TFilterData | undefined { return this.node.filterData; }

	constructor(
		private unwrapper: CompressedNodeUnwrapper<T>,
		private node: ITreeNode<ICompressedTreeNode<T> | null, TFilterData>
	) { }
}

function mapList<T, TFilterData>(nodeMapper: CompressedNodeWeakMapper<T, TFilterData>, list: IList<ITreeNode<T, TFilterData>>): IList<ITreeNode<ICompressedTreeNode<T>, TFilterData>> {
	return {
		splice(start: number, deleteCount: number, toInsert: ITreeNode<ICompressedTreeNode<T>, TFilterData>[]): void {
			list.splice(start, deleteCount, toInsert.map(node => nodeMapper.map(node)) as ITreeNode<T, TFilterData>[]);
		},
		updateElementHeight(index: number, height: number): void {
			list.updateElementHeight(index, height);
		}
	};
}

function mapOptions<T, TFilterData>(compressedNodeUnwrapper: CompressedNodeUnwrapper<T>, options: ICompressibleObjectTreeModelOptions<T, TFilterData>): ICompressedObjectTreeModelOptions<T, TFilterData> {
	return {
		...options,
		sorter: options.sorter && {
			compare(node: ICompressedTreeNode<T>, otherNode: ICompressedTreeNode<T>): number {
				return options.sorter!.compare(node.elements[0], otherNode.elements[0]);
			}
		},
		identityProvider: options.identityProvider && {
			getId(node: ICompressedTreeNode<T>): { toString(): string; } {
				return options.identityProvider!.getId(compressedNodeUnwrapper(node));
			}
		},
		filter: options.filter && {
			filter(node: ICompressedTreeNode<T>, parentVisibility: TreeVisibility): TreeFilterResult<TFilterData> {
				return options.filter!.filter(compressedNodeUnwrapper(node), parentVisibility);
			}
		}
	};
}

export interface ICompressibleObjectTreeModelOptions<T, TFilterData> extends IObjectTreeModelOptions<T, TFilterData> {
	readonly compressionEnabled?: boolean;
	readonly elementMapper?: ElementMapper<T>;
}

export class CompressibleObjectTreeModel<T extends NonNullable<any>, TFilterData extends NonNullable<any> = void> implements IObjectTreeModel<T, TFilterData> {

	readonly rootRef = null;

	get onDidSplice(): Event<ITreeModelSpliceEvent<T | null, TFilterData>> {
		return Event.map(this.model.onDidSplice, ({ insertedNodes, deletedNodes }) => ({
			insertedNodes: insertedNodes.map(node => this.nodeMapper.map(node)),
			deletedNodes: deletedNodes.map(node => this.nodeMapper.map(node)),
		}));
	}

	get onDidChangeCollapseState(): Event<ICollapseStateChangeEvent<T | null, TFilterData>> {
		return Event.map(this.model.onDidChangeCollapseState, ({ node, deep }) => ({
			node: this.nodeMapper.map(node),
			deep
		}));
	}

	get onDidChangeRenderNodeCount(): Event<ITreeNode<T | null, TFilterData>> {
		return Event.map(this.model.onDidChangeRenderNodeCount, node => this.nodeMapper.map(node));
	}

	private elementMapper: ElementMapper<T>;
	private nodeMapper: CompressedNodeWeakMapper<T, TFilterData>;
	private model: CompressedObjectTreeModel<T, TFilterData>;

	constructor(
		user: string,
		list: IList<ITreeNode<T, TFilterData>>,
		options: ICompressibleObjectTreeModelOptions<T, TFilterData> = {}
	) {
		this.elementMapper = options.elementMapper || DefaultElementMapper;
		const compressedNodeUnwrapper: CompressedNodeUnwrapper<T> = node => this.elementMapper(node.elements);
		this.nodeMapper = new WeakMapper(node => new CompressedTreeNodeWrapper(compressedNodeUnwrapper, node));

		this.model = new CompressedObjectTreeModel(user, mapList(this.nodeMapper, list), mapOptions(compressedNodeUnwrapper, options));
	}

	setChildren(element: T | null, children: Iterable<ICompressedTreeElement<T>> = Iterable.empty()): void {
		this.model.setChildren(element, children);
	}

	isCompressionEnabled(): boolean {
		return this.model.isCompressionEnabled();
	}

	setCompressionEnabled(enabled: boolean): void {
		this.model.setCompressionEnabled(enabled);
	}

	has(location: T | null): boolean {
		return this.model.has(location);
	}

	getListIndex(location: T | null): number {
		return this.model.getListIndex(location);
	}

	getListRenderCount(location: T | null): number {
		return this.model.getListRenderCount(location);
	}

	getNode(location?: T | null | undefined): ITreeNode<T | null, any> {
		return this.nodeMapper.map(this.model.getNode(location));
	}

	getNodeLocation(node: ITreeNode<T | null, any>): T | null {
		return node.element;
	}

	getParentNodeLocation(location: T | null): T | null {
		return this.model.getParentNodeLocation(location);
	}

	getFirstElementChild(location: T | null): T | null | undefined {
		const result = this.model.getFirstElementChild(location);

		if (result === null || typeof result === 'undefined') {
			return result;
		}

		return this.elementMapper(result.elements);
	}

	getLastElementAncestor(location?: T | null | undefined): T | null | undefined {
		const result = this.model.getLastElementAncestor(location);

		if (result === null || typeof result === 'undefined') {
			return result;
		}

		return this.elementMapper(result.elements);
	}

	isCollapsible(location: T | null): boolean {
		return this.model.isCollapsible(location);
	}

	setCollapsible(location: T | null, collapsed?: boolean): boolean {
		return this.model.setCollapsible(location, collapsed);
	}

	isCollapsed(location: T | null): boolean {
		return this.model.isCollapsed(location);
	}

	setCollapsed(location: T | null, collapsed?: boolean | undefined, recursive?: boolean | undefined): boolean {
		return this.model.setCollapsed(location, collapsed, recursive);
	}

	expandTo(location: T | null): void {
		return this.model.expandTo(location);
	}

	rerender(location: T | null): void {
		return this.model.rerender(location);
	}

	updateElementHeight(element: T, height: number): void {
		this.model.updateElementHeight(element, height);
	}

	refilter(): void {
		return this.model.refilter();
	}

	resort(element: T | null = null, recursive = true): void {
		return this.model.resort(element, recursive);
	}

	getCompressedTreeNode(location: T | null = null): ITreeNode<ICompressedTreeNode<T> | null, TFilterData> {
		return this.model.getNode(location);
	}
}
