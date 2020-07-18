/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICollapseStateChangeEvent, ITreeElement, ITreeFilter, ITreeFilterDataResult, ITreeModel, ITreeNode, TreeVisibility, ITreeModelSpliceEvent, TreeError } from 'vs/base/browser/ui/tree/tree';
import { tail2 } from 'vs/base/common/arrays';
import { Emitter, Event, EventBufferer } from 'vs/base/common/event';
import { Iterable } from 'vs/base/common/iterator';
import { ISpliceable } from 'vs/base/common/sequence';

// Exported for tests
export interface IIndexTreeNode<T, TFilterData = void> extends ITreeNode<T, TFilterData> {
	readonly parent: IIndexTreeNode<T, TFilterData> | undefined;
	readonly children: IIndexTreeNode<T, TFilterData>[];
	visibleChildrenCount: number;
	visibleChildIndex: number;
	collapsible: boolean;
	collapsed: boolean;
	renderNodeCount: number;
	visibility: TreeVisibility;
	visible: boolean;
	filterData: TFilterData | undefined;
}

export function isFilterResult<T>(obj: any): obj is ITreeFilterDataResult<T> {
	return typeof obj === 'object' && 'visibility' in obj && 'data' in obj;
}

export function getVisibleState(visibility: boolean | TreeVisibility): TreeVisibility {
	switch (visibility) {
		case true: return TreeVisibility.Visible;
		case false: return TreeVisibility.Hidden;
		default: return visibility;
	}
}

export interface IIndexTreeModelOptions<T, TFilterData> {
	readonly collapseByDefault?: boolean; // defaults to false
	readonly filter?: ITreeFilter<T, TFilterData>;
	readonly autoExpandSingleChildren?: boolean;
}

interface CollapsibleStateUpdate {
	readonly collapsible: boolean;
}

interface CollapsedStateUpdate {
	readonly collapsed: boolean;
	readonly recursive: boolean;
}

type CollapseStateUpdate = CollapsibleStateUpdate | CollapsedStateUpdate;

function isCollapsibleStateUpdate(update: CollapseStateUpdate): update is CollapsibleStateUpdate {
	return typeof (update as any).collapsible === 'boolean';
}

export interface IList<T> extends ISpliceable<T> {
	updateElementHeight(index: number, height: number): void;
}

export class IndexTreeModel<T extends Exclude<any, undefined>, TFilterData = void> implements ITreeModel<T, TFilterData, number[]> {

	readonly rootRef = [];

	private root: IIndexTreeNode<T, TFilterData>;
	private eventBufferer = new EventBufferer();

	private readonly _onDidChangeCollapseState = new Emitter<ICollapseStateChangeEvent<T, TFilterData>>();
	readonly onDidChangeCollapseState: Event<ICollapseStateChangeEvent<T, TFilterData>> = this.eventBufferer.wrapEvent(this._onDidChangeCollapseState.event);

	private readonly _onDidChangeRenderNodeCount = new Emitter<ITreeNode<T, TFilterData>>();
	readonly onDidChangeRenderNodeCount: Event<ITreeNode<T, TFilterData>> = this.eventBufferer.wrapEvent(this._onDidChangeRenderNodeCount.event);

	private collapseByDefault: boolean;
	private filter?: ITreeFilter<T, TFilterData>;
	private autoExpandSingleChildren: boolean;

	private readonly _onDidSplice = new Emitter<ITreeModelSpliceEvent<T, TFilterData>>();
	readonly onDidSplice = this._onDidSplice.event;

	constructor(
		private user: string,
		private list: IList<ITreeNode<T, TFilterData>>,
		rootElement: T,
		options: IIndexTreeModelOptions<T, TFilterData> = {}
	) {
		this.collapseByDefault = typeof options.collapseByDefault === 'undefined' ? false : options.collapseByDefault;
		this.filter = options.filter;
		this.autoExpandSingleChildren = typeof options.autoExpandSingleChildren === 'undefined' ? false : options.autoExpandSingleChildren;

		this.root = {
			parent: undefined,
			element: rootElement,
			children: [],
			depth: 0,
			visibleChildrenCount: 0,
			visibleChildIndex: -1,
			collapsible: false,
			collapsed: false,
			renderNodeCount: 0,
			visibility: TreeVisibility.Visible,
			visible: true,
			filterData: undefined
		};
	}

	splice(
		location: number[],
		deleteCount: number,
		toInsert: Iterable<ITreeElement<T>> = Iterable.empty(),
		onDidCreateNode?: (node: ITreeNode<T, TFilterData>) => void,
		onDidDeleteNode?: (node: ITreeNode<T, TFilterData>) => void
	): void {
		if (location.length === 0) {
			throw new TreeError(this.user, 'Invalid tree location');
		}

		const { parentNode, listIndex, revealed, visible } = this.getParentNodeWithListIndex(location);
		const treeListElementsToInsert: ITreeNode<T, TFilterData>[] = [];
		const nodesToInsertIterator = Iterable.map(toInsert, el => this.createTreeNode(el, parentNode, parentNode.visible ? TreeVisibility.Visible : TreeVisibility.Hidden, revealed, treeListElementsToInsert, onDidCreateNode));

		const lastIndex = location[location.length - 1];

		// figure out what's the visible child start index right before the
		// splice point
		let visibleChildStartIndex = 0;

		for (let i = lastIndex; i >= 0 && i < parentNode.children.length; i--) {
			const child = parentNode.children[i];

			if (child.visible) {
				visibleChildStartIndex = child.visibleChildIndex;
				break;
			}
		}

		const nodesToInsert: IIndexTreeNode<T, TFilterData>[] = [];
		let insertedVisibleChildrenCount = 0;
		let renderNodeCount = 0;

		for (const child of nodesToInsertIterator) {
			nodesToInsert.push(child);
			renderNodeCount += child.renderNodeCount;

			if (child.visible) {
				child.visibleChildIndex = visibleChildStartIndex + insertedVisibleChildrenCount++;
			}
		}

		const deletedNodes = parentNode.children.splice(lastIndex, deleteCount, ...nodesToInsert);

		// figure out what is the count of deleted visible children
		let deletedVisibleChildrenCount = 0;

		for (const child of deletedNodes) {
			if (child.visible) {
				deletedVisibleChildrenCount++;
			}
		}

		// and adjust for all visible children after the splice point
		if (deletedVisibleChildrenCount !== 0) {
			for (let i = lastIndex + nodesToInsert.length; i < parentNode.children.length; i++) {
				const child = parentNode.children[i];

				if (child.visible) {
					child.visibleChildIndex -= deletedVisibleChildrenCount;
				}
			}
		}

		// update parent's visible children count
		parentNode.visibleChildrenCount += insertedVisibleChildrenCount - deletedVisibleChildrenCount;

		if (revealed && visible) {
			const visibleDeleteCount = deletedNodes.reduce((r, node) => r + (node.visible ? node.renderNodeCount : 0), 0);

			this._updateAncestorsRenderNodeCount(parentNode, renderNodeCount - visibleDeleteCount);
			this.list.splice(listIndex, visibleDeleteCount, treeListElementsToInsert);
		}

		if (deletedNodes.length > 0 && onDidDeleteNode) {
			const visit = (node: ITreeNode<T, TFilterData>) => {
				onDidDeleteNode(node);
				node.children.forEach(visit);
			};

			deletedNodes.forEach(visit);
		}

		this._onDidSplice.fire({ insertedNodes: nodesToInsert, deletedNodes });

		let node: IIndexTreeNode<T, TFilterData> | undefined = parentNode;

		while (node) {
			if (node.visibility === TreeVisibility.Recurse) {
				this.refilter();
				break;
			}

			node = node.parent;
		}
	}

	rerender(location: number[]): void {
		if (location.length === 0) {
			throw new TreeError(this.user, 'Invalid tree location');
		}

		const { node, listIndex, revealed } = this.getTreeNodeWithListIndex(location);

		if (node.visible && revealed) {
			this.list.splice(listIndex, 1, [node]);
		}
	}

	updateElementHeight(location: number[], height: number): void {
		if (location.length === 0) {
			throw new TreeError(this.user, 'Invalid tree location');
		}

		const { listIndex } = this.getTreeNodeWithListIndex(location);
		this.list.updateElementHeight(listIndex, height);
	}

	has(location: number[]): boolean {
		return this.hasTreeNode(location);
	}

	getListIndex(location: number[]): number {
		const { listIndex, visible, revealed } = this.getTreeNodeWithListIndex(location);
		return visible && revealed ? listIndex : -1;
	}

	getListRenderCount(location: number[]): number {
		return this.getTreeNode(location).renderNodeCount;
	}

	isCollapsible(location: number[]): boolean {
		return this.getTreeNode(location).collapsible;
	}

	setCollapsible(location: number[], collapsible?: boolean): boolean {
		const node = this.getTreeNode(location);

		if (typeof collapsible === 'undefined') {
			collapsible = !node.collapsible;
		}

		const update: CollapsibleStateUpdate = { collapsible };
		return this.eventBufferer.bufferEvents(() => this._setCollapseState(location, update));
	}

	isCollapsed(location: number[]): boolean {
		return this.getTreeNode(location).collapsed;
	}

	setCollapsed(location: number[], collapsed?: boolean, recursive?: boolean): boolean {
		const node = this.getTreeNode(location);

		if (typeof collapsed === 'undefined') {
			collapsed = !node.collapsed;
		}

		const update: CollapsedStateUpdate = { collapsed, recursive: recursive || false };
		return this.eventBufferer.bufferEvents(() => this._setCollapseState(location, update));
	}

	private _setCollapseState(location: number[], update: CollapseStateUpdate): boolean {
		const { node, listIndex, revealed } = this.getTreeNodeWithListIndex(location);

		const result = this._setListNodeCollapseState(node, listIndex, revealed, update);

		if (node !== this.root && this.autoExpandSingleChildren && result && !isCollapsibleStateUpdate(update) && node.collapsible && !node.collapsed && !update.recursive) {
			let onlyVisibleChildIndex = -1;

			for (let i = 0; i < node.children.length; i++) {
				const child = node.children[i];

				if (child.visible) {
					if (onlyVisibleChildIndex > -1) {
						onlyVisibleChildIndex = -1;
						break;
					} else {
						onlyVisibleChildIndex = i;
					}
				}
			}

			if (onlyVisibleChildIndex > -1) {
				this._setCollapseState([...location, onlyVisibleChildIndex], update);
			}
		}

		return result;
	}

	private _setListNodeCollapseState(node: IIndexTreeNode<T, TFilterData>, listIndex: number, revealed: boolean, update: CollapseStateUpdate): boolean {
		const result = this._setNodeCollapseState(node, update, false);

		if (!revealed || !node.visible || !result) {
			return result;
		}

		const previousRenderNodeCount = node.renderNodeCount;
		const toInsert = this.updateNodeAfterCollapseChange(node);
		const deleteCount = previousRenderNodeCount - (listIndex === -1 ? 0 : 1);
		this.list.splice(listIndex + 1, deleteCount, toInsert.slice(1));

		return result;
	}

	private _setNodeCollapseState(node: IIndexTreeNode<T, TFilterData>, update: CollapseStateUpdate, deep: boolean): boolean {
		let result: boolean;

		if (node === this.root) {
			result = false;
		} else {
			if (isCollapsibleStateUpdate(update)) {
				result = node.collapsible !== update.collapsible;
				node.collapsible = update.collapsible;
			} else if (!node.collapsible) {
				result = false;
			} else {
				result = node.collapsed !== update.collapsed;
				node.collapsed = update.collapsed;
			}

			if (result) {
				this._onDidChangeCollapseState.fire({ node, deep });
			}
		}

		if (!isCollapsibleStateUpdate(update) && update.recursive) {
			for (const child of node.children) {
				result = this._setNodeCollapseState(child, update, true) || result;
			}
		}

		return result;
	}

	expandTo(location: number[]): void {
		this.eventBufferer.bufferEvents(() => {
			let node = this.getTreeNode(location);

			while (node.parent) {
				node = node.parent;
				location = location.slice(0, location.length - 1);

				if (node.collapsed) {
					this._setCollapseState(location, { collapsed: false, recursive: false });
				}
			}
		});
	}

	refilter(): void {
		const previousRenderNodeCount = this.root.renderNodeCount;
		const toInsert = this.updateNodeAfterFilterChange(this.root);
		this.list.splice(0, previousRenderNodeCount, toInsert);
	}

	private createTreeNode(
		treeElement: ITreeElement<T>,
		parent: IIndexTreeNode<T, TFilterData>,
		parentVisibility: TreeVisibility,
		revealed: boolean,
		treeListElements: ITreeNode<T, TFilterData>[],
		onDidCreateNode?: (node: ITreeNode<T, TFilterData>) => void
	): IIndexTreeNode<T, TFilterData> {
		const node: IIndexTreeNode<T, TFilterData> = {
			parent,
			element: treeElement.element,
			children: [],
			depth: parent.depth + 1,
			visibleChildrenCount: 0,
			visibleChildIndex: -1,
			collapsible: typeof treeElement.collapsible === 'boolean' ? treeElement.collapsible : (typeof treeElement.collapsed !== 'undefined'),
			collapsed: typeof treeElement.collapsed === 'undefined' ? this.collapseByDefault : treeElement.collapsed,
			renderNodeCount: 1,
			visibility: TreeVisibility.Visible,
			visible: true,
			filterData: undefined
		};

		const visibility = this._filterNode(node, parentVisibility);
		node.visibility = visibility;

		if (revealed) {
			treeListElements.push(node);
		}

		const childElements = treeElement.children || Iterable.empty();
		const childRevealed = revealed && visibility !== TreeVisibility.Hidden && !node.collapsed;
		const childNodes = Iterable.map(childElements, el => this.createTreeNode(el, node, visibility, childRevealed, treeListElements, onDidCreateNode));

		let visibleChildrenCount = 0;
		let renderNodeCount = 1;

		for (const child of childNodes) {
			node.children.push(child);
			renderNodeCount += child.renderNodeCount;

			if (child.visible) {
				child.visibleChildIndex = visibleChildrenCount++;
			}
		}

		node.collapsible = node.collapsible || node.children.length > 0;
		node.visibleChildrenCount = visibleChildrenCount;
		node.visible = visibility === TreeVisibility.Recurse ? visibleChildrenCount > 0 : (visibility === TreeVisibility.Visible);

		if (!node.visible) {
			node.renderNodeCount = 0;

			if (revealed) {
				treeListElements.pop();
			}
		} else if (!node.collapsed) {
			node.renderNodeCount = renderNodeCount;
		}

		if (onDidCreateNode) {
			onDidCreateNode(node);
		}

		return node;
	}

	private updateNodeAfterCollapseChange(node: IIndexTreeNode<T, TFilterData>): ITreeNode<T, TFilterData>[] {
		const previousRenderNodeCount = node.renderNodeCount;
		const result: ITreeNode<T, TFilterData>[] = [];

		this._updateNodeAfterCollapseChange(node, result);
		this._updateAncestorsRenderNodeCount(node.parent, result.length - previousRenderNodeCount);

		return result;
	}

	private _updateNodeAfterCollapseChange(node: IIndexTreeNode<T, TFilterData>, result: ITreeNode<T, TFilterData>[]): number {
		if (node.visible === false) {
			return 0;
		}

		result.push(node);
		node.renderNodeCount = 1;

		if (!node.collapsed) {
			for (const child of node.children) {
				node.renderNodeCount += this._updateNodeAfterCollapseChange(child, result);
			}
		}

		this._onDidChangeRenderNodeCount.fire(node);
		return node.renderNodeCount;
	}

	private updateNodeAfterFilterChange(node: IIndexTreeNode<T, TFilterData>): ITreeNode<T, TFilterData>[] {
		const previousRenderNodeCount = node.renderNodeCount;
		const result: ITreeNode<T, TFilterData>[] = [];

		this._updateNodeAfterFilterChange(node, node.visible ? TreeVisibility.Visible : TreeVisibility.Hidden, result);
		this._updateAncestorsRenderNodeCount(node.parent, result.length - previousRenderNodeCount);

		return result;
	}

	private _updateNodeAfterFilterChange(node: IIndexTreeNode<T, TFilterData>, parentVisibility: TreeVisibility, result: ITreeNode<T, TFilterData>[], revealed = true): boolean {
		let visibility: TreeVisibility;

		if (node !== this.root) {
			visibility = this._filterNode(node, parentVisibility);

			if (visibility === TreeVisibility.Hidden) {
				node.visible = false;
				node.renderNodeCount = 0;
				return false;
			}

			if (revealed) {
				result.push(node);
			}
		}

		const resultStartLength = result.length;
		node.renderNodeCount = node === this.root ? 0 : 1;

		let hasVisibleDescendants = false;
		if (!node.collapsed || visibility! !== TreeVisibility.Hidden) {
			let visibleChildIndex = 0;

			for (const child of node.children) {
				hasVisibleDescendants = this._updateNodeAfterFilterChange(child, visibility!, result, revealed && !node.collapsed) || hasVisibleDescendants;

				if (child.visible) {
					child.visibleChildIndex = visibleChildIndex++;
				}
			}

			node.visibleChildrenCount = visibleChildIndex;
		} else {
			node.visibleChildrenCount = 0;
		}

		if (node !== this.root) {
			node.visible = visibility! === TreeVisibility.Recurse ? hasVisibleDescendants : (visibility! === TreeVisibility.Visible);
		}

		if (!node.visible) {
			node.renderNodeCount = 0;

			if (revealed) {
				result.pop();
			}
		} else if (!node.collapsed) {
			node.renderNodeCount += result.length - resultStartLength;
		}

		this._onDidChangeRenderNodeCount.fire(node);
		return node.visible;
	}

	private _updateAncestorsRenderNodeCount(node: IIndexTreeNode<T, TFilterData> | undefined, diff: number): void {
		if (diff === 0) {
			return;
		}

		while (node) {
			node.renderNodeCount += diff;
			this._onDidChangeRenderNodeCount.fire(node);
			node = node.parent;
		}
	}

	private _filterNode(node: IIndexTreeNode<T, TFilterData>, parentVisibility: TreeVisibility): TreeVisibility {
		const result = this.filter ? this.filter.filter(node.element, parentVisibility) : TreeVisibility.Visible;

		if (typeof result === 'boolean') {
			node.filterData = undefined;
			return result ? TreeVisibility.Visible : TreeVisibility.Hidden;
		} else if (isFilterResult<TFilterData>(result)) {
			node.filterData = result.data;
			return getVisibleState(result.visibility);
		} else {
			node.filterData = undefined;
			return getVisibleState(result);
		}
	}

	// cheap
	private hasTreeNode(location: number[], node: IIndexTreeNode<T, TFilterData> = this.root): boolean {
		if (!location || location.length === 0) {
			return true;
		}

		const [index, ...rest] = location;

		if (index < 0 || index > node.children.length) {
			return false;
		}

		return this.hasTreeNode(rest, node.children[index]);
	}

	// cheap
	private getTreeNode(location: number[], node: IIndexTreeNode<T, TFilterData> = this.root): IIndexTreeNode<T, TFilterData> {
		if (!location || location.length === 0) {
			return node;
		}

		const [index, ...rest] = location;

		if (index < 0 || index > node.children.length) {
			throw new TreeError(this.user, 'Invalid tree location');
		}

		return this.getTreeNode(rest, node.children[index]);
	}

	// expensive
	private getTreeNodeWithListIndex(location: number[]): { node: IIndexTreeNode<T, TFilterData>, listIndex: number, revealed: boolean, visible: boolean } {
		if (location.length === 0) {
			return { node: this.root, listIndex: -1, revealed: true, visible: false };
		}

		const { parentNode, listIndex, revealed, visible } = this.getParentNodeWithListIndex(location);
		const index = location[location.length - 1];

		if (index < 0 || index > parentNode.children.length) {
			throw new TreeError(this.user, 'Invalid tree location');
		}

		const node = parentNode.children[index];

		return { node, listIndex, revealed, visible: visible && node.visible };
	}

	private getParentNodeWithListIndex(location: number[], node: IIndexTreeNode<T, TFilterData> = this.root, listIndex: number = 0, revealed = true, visible = true): { parentNode: IIndexTreeNode<T, TFilterData>; listIndex: number; revealed: boolean; visible: boolean; } {
		const [index, ...rest] = location;

		if (index < 0 || index > node.children.length) {
			throw new TreeError(this.user, 'Invalid tree location');
		}

		// TODO@joao perf!
		for (let i = 0; i < index; i++) {
			listIndex += node.children[i].renderNodeCount;
		}

		revealed = revealed && !node.collapsed;
		visible = visible && node.visible;

		if (rest.length === 0) {
			return { parentNode: node, listIndex, revealed, visible };
		}

		return this.getParentNodeWithListIndex(rest, node.children[index], listIndex + 1, revealed, visible);
	}

	getNode(location: number[] = []): ITreeNode<T, TFilterData> {
		return this.getTreeNode(location);
	}

	// TODO@joao perf!
	getNodeLocation(node: ITreeNode<T, TFilterData>): number[] {
		const location: number[] = [];
		let indexTreeNode = node as IIndexTreeNode<T, TFilterData>; // typing woes

		while (indexTreeNode.parent) {
			location.push(indexTreeNode.parent.children.indexOf(indexTreeNode));
			indexTreeNode = indexTreeNode.parent;
		}

		return location.reverse();
	}

	getParentNodeLocation(location: number[]): number[] | undefined {
		if (location.length === 0) {
			return undefined;
		} else if (location.length === 1) {
			return [];
		} else {
			return tail2(location)[0];
		}
	}

	getFirstElementChild(location: number[]): T | undefined {
		const node = this.getTreeNode(location);

		if (node.children.length === 0) {
			return undefined;
		}

		return node.children[0].element;
	}

	getLastElementAncestor(location: number[] = []): T | undefined {
		const node = this.getTreeNode(location);

		if (node.children.length === 0) {
			return undefined;
		}

		return this._getLastElementAncestor(node);
	}

	private _getLastElementAncestor(node: ITreeNode<T, TFilterData>): T {
		if (node.children.length === 0) {
			return node.element;
		}

		return this._getLastElementAncestor(node.children[node.children.length - 1]);
	}
}
