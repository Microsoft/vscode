/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Iterable } from 'vs/base/common/iterator';
import { IndexTreeModel, IIndexTreeModelOptions, IList } from 'vs/base/browser/ui/tree/indexTreeModel';
import { Event } from 'vs/base/common/event';
import { ITreeModel, ITreeNode, ITreeElement, ITreeSorter, ICollapseStateChangeEvent, ITreeModelSpliceEvent, TreeError } from 'vs/base/browser/ui/tree/tree';
import { IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { mergeSort } from 'vs/base/common/arrays';

export type ITreeNodeCallback<T, TFilterData> = (node: ITreeNode<T, TFilterData>) => void;

export interface IObjectTreeModel<T extends NonNullable<any>, TFilterData extends NonNullable<any> = void> extends ITreeModel<T | null, TFilterData, T | null> {
	setChildren(element: T | null, children: Iterable<ITreeElement<T>> | undefined): void;
	resort(element?: T | null, recursive?: boolean): void;
	updateElementHeight(element: T, height: number): void;
}

export interface IObjectTreeModelOptions<T, TFilterData> extends IIndexTreeModelOptions<T, TFilterData> {
	readonly sorter?: ITreeSorter<T>;
	readonly identityProvider?: IIdentityProvider<T>;
}

export class ObjectTreeModel<T extends NonNullable<any>, TFilterData extends NonNullable<any> = void> implements IObjectTreeModel<T, TFilterData> {

	readonly rootRef = null;

	private model: IndexTreeModel<T | null, TFilterData>;
	private nodes = new Map<T | null, ITreeNode<T, TFilterData>>();
	private readonly nodesByIdentity = new Map<string, ITreeNode<T, TFilterData>>();
	private readonly identityProvider?: IIdentityProvider<T>;
	private sorter?: ITreeSorter<{ element: T; }>;

	readonly onDidSplice: Event<ITreeModelSpliceEvent<T | null, TFilterData>>;
	readonly onDidChangeCollapseState: Event<ICollapseStateChangeEvent<T, TFilterData>>;
	readonly onDidChangeRenderNodeCount: Event<ITreeNode<T, TFilterData>>;

	get size(): number { return this.nodes.size; }

	constructor(
		private user: string,
		list: IList<ITreeNode<T, TFilterData>>,
		options: IObjectTreeModelOptions<T, TFilterData> = {}
	) {
		this.model = new IndexTreeModel(user, list, null, options);
		this.onDidSplice = this.model.onDidSplice;
		this.onDidChangeCollapseState = this.model.onDidChangeCollapseState as Event<ICollapseStateChangeEvent<T, TFilterData>>;
		this.onDidChangeRenderNodeCount = this.model.onDidChangeRenderNodeCount as Event<ITreeNode<T, TFilterData>>;

		if (options.sorter) {
			this.sorter = {
				compare(a, b) {
					return options.sorter!.compare(a.element, b.element);
				}
			};
		}

		this.identityProvider = options.identityProvider;
	}

	setChildren(
		element: T | null,
		children: Iterable<ITreeElement<T>> = Iterable.empty(),
		onDidCreateNode?: ITreeNodeCallback<T, TFilterData>,
		onDidDeleteNode?: ITreeNodeCallback<T, TFilterData>
	): void {
		const location = this.getElementLocation(element);
		this._setChildren(location, this.preserveCollapseState(children), onDidCreateNode, onDidDeleteNode);
	}

	private _setChildren(
		location: number[],
		children: Iterable<ITreeElement<T>> = Iterable.empty(),
		onDidCreateNode?: ITreeNodeCallback<T, TFilterData>,
		onDidDeleteNode?: ITreeNodeCallback<T, TFilterData>
	): void {
		const insertedElements = new Set<T | null>();
		const insertedElementIds = new Set<string>();

		const _onDidCreateNode = (node: ITreeNode<T | null, TFilterData>) => {
			if (node.element === null) {
				return;
			}

			const tnode = node as ITreeNode<T, TFilterData>;

			insertedElements.add(tnode.element);
			this.nodes.set(tnode.element, tnode);

			if (this.identityProvider) {
				const id = this.identityProvider.getId(tnode.element).toString();
				insertedElementIds.add(id);
				this.nodesByIdentity.set(id, tnode);
			}

			if (onDidCreateNode) {
				onDidCreateNode(tnode);
			}
		};

		const _onDidDeleteNode = (node: ITreeNode<T | null, TFilterData>) => {
			if (node.element === null) {
				return;
			}

			const tnode = node as ITreeNode<T, TFilterData>;

			if (!insertedElements.has(tnode.element)) {
				this.nodes.delete(tnode.element);
			}

			if (this.identityProvider) {
				const id = this.identityProvider.getId(tnode.element).toString();
				if (!insertedElementIds.has(id)) {
					this.nodesByIdentity.delete(id);
				}
			}

			if (onDidDeleteNode) {
				onDidDeleteNode(tnode);
			}
		};

		this.model.splice(
			[...location, 0],
			Number.MAX_VALUE,
			children,
			_onDidCreateNode,
			_onDidDeleteNode
		);
	}

	private preserveCollapseState(elements: Iterable<ITreeElement<T>> = Iterable.empty()): Iterable<ITreeElement<T>> {
		if (this.sorter) {
			elements = mergeSort([...elements], this.sorter.compare.bind(this.sorter));
		}

		return Iterable.map(elements, treeElement => {
			let node = this.nodes.get(treeElement.element);

			if (!node && this.identityProvider) {
				const id = this.identityProvider.getId(treeElement.element).toString();
				node = this.nodesByIdentity.get(id);
			}

			if (!node) {
				return {
					...treeElement,
					children: this.preserveCollapseState(treeElement.children)
				};
			}

			const collapsible = typeof treeElement.collapsible === 'boolean' ? treeElement.collapsible : node.collapsible;
			const collapsed = typeof treeElement.collapsed !== 'undefined' ? treeElement.collapsed : node.collapsed;

			return {
				...treeElement,
				collapsible,
				collapsed,
				children: this.preserveCollapseState(treeElement.children)
			};
		});
	}

	rerender(element: T | null): void {
		const location = this.getElementLocation(element);
		this.model.rerender(location);
	}

	updateElementHeight(element: T, height: number): void {
		const location = this.getElementLocation(element);
		this.model.updateElementHeight(location, height);
	}

	resort(element: T | null = null, recursive = true): void {
		if (!this.sorter) {
			return;
		}

		const location = this.getElementLocation(element);
		const node = this.model.getNode(location);

		this._setChildren(location, this.resortChildren(node, recursive));
	}

	private resortChildren(node: ITreeNode<T | null, TFilterData>, recursive: boolean, first = true): Iterable<ITreeElement<T>> {
		let childrenNodes = [...node.children] as ITreeNode<T, TFilterData>[];

		if (recursive || first) {
			childrenNodes = mergeSort(childrenNodes, this.sorter!.compare.bind(this.sorter));
		}

		return Iterable.map<ITreeNode<T | null, TFilterData>, ITreeElement<T>>(childrenNodes, node => ({
			element: node.element as T,
			collapsible: node.collapsible,
			collapsed: node.collapsed,
			children: this.resortChildren(node, recursive, false)
		}));
	}

	getFirstElementChild(ref: T | null = null): T | null | undefined {
		const location = this.getElementLocation(ref);
		return this.model.getFirstElementChild(location);
	}

	getLastElementAncestor(ref: T | null = null): T | null | undefined {
		const location = this.getElementLocation(ref);
		return this.model.getLastElementAncestor(location);
	}

	has(element: T | null): boolean {
		return this.nodes.has(element);
	}

	getListIndex(element: T | null): number {
		const location = this.getElementLocation(element);
		return this.model.getListIndex(location);
	}

	getListRenderCount(element: T | null): number {
		const location = this.getElementLocation(element);
		return this.model.getListRenderCount(location);
	}

	isCollapsible(element: T | null): boolean {
		const location = this.getElementLocation(element);
		return this.model.isCollapsible(location);
	}

	setCollapsible(element: T | null, collapsible?: boolean): boolean {
		const location = this.getElementLocation(element);
		return this.model.setCollapsible(location, collapsible);
	}

	isCollapsed(element: T | null): boolean {
		const location = this.getElementLocation(element);
		return this.model.isCollapsed(location);
	}

	setCollapsed(element: T | null, collapsed?: boolean, recursive?: boolean): boolean {
		const location = this.getElementLocation(element);
		return this.model.setCollapsed(location, collapsed, recursive);
	}

	expandTo(element: T | null): void {
		const location = this.getElementLocation(element);
		this.model.expandTo(location);
	}

	refilter(): void {
		this.model.refilter();
	}

	getNode(element: T | null = null): ITreeNode<T | null, TFilterData> {
		if (element === null) {
			return this.model.getNode(this.model.rootRef);
		}

		const node = this.nodes.get(element);

		if (!node) {
			throw new TreeError(this.user, `Tree element not found: ${element}`);
		}

		return node;
	}

	getNodeLocation(node: ITreeNode<T, TFilterData>): T | null {
		return node.element;
	}

	getParentNodeLocation(element: T | null): T | null {
		if (element === null) {
			throw new TreeError(this.user, `Invalid getParentNodeLocation call`);
		}

		const node = this.nodes.get(element);

		if (!node) {
			throw new TreeError(this.user, `Tree element not found: ${element}`);
		}

		const location = this.model.getNodeLocation(node);
		const parentLocation = this.model.getParentNodeLocation(location);
		const parent = this.model.getNode(parentLocation);

		return parent.element;
	}

	private getElementLocation(element: T | null): number[] {
		if (element === null) {
			return [];
		}

		const node = this.nodes.get(element);

		if (!node) {
			throw new TreeError(this.user, `Tree element not found: ${element}`);
		}

		return this.model.getNodeLocation(node);
	}
}
