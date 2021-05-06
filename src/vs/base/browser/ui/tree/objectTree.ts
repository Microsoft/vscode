/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Iterable } from 'vs/base/common/iterator';
import { AbstractTree, IAbstractTreeOptions, IAbstractTreeOptionsUpdate } from 'vs/base/browser/ui/tree/abstractTree';
import { ITreeNode, ITreeModel, ITreeElement, ITreeRenderer, ITreeSorter, ICollapseStateChangeEvent } from 'vs/base/browser/ui/tree/tree';
import { ObjectTreeModel, IObjectTreeModel } from 'vs/base/browser/ui/tree/objectTreeModel';
import { IListVirtualDelegate, IKeyboardNavigationLabelProvider, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { Event } from 'vs/base/common/event';
import { CompressibleObjectTreeModel, ElementMapper, ICompressedTreeNode, ICompressedTreeElement } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import { memoize } from 'vs/base/common/decorators';
import { IList } from 'vs/base/browser/ui/tree/indexTreeModel';

export interface IObjectTreeOptions<T, TFilterData = void> extends IAbstractTreeOptions<T, TFilterData> {
	readonly sorter?: ITreeSorter<T>;
}

export interface IObjectTreeSetChildrenOptions<T> {

	/**
	 * If set, child updates will recurse the given number of levels even if
	 * items in the splice operation are unchanged. `Infinity` is a valid value.
	 */
	readonly diffDepth?: number;

	/**
	 * Identity provider used to optimize splice() calls in the IndexTree. If
	 * this is not present, optimized splicing is not enabled.
	 *
	 * Warning: if this is present, calls to `setChildren()` will not replace
	 * or update nodes if their identity is the same, even if the elements are
	 * different. For this, you should call `rerender()`.
	 */
	readonly diffIdentityProvider?: IIdentityProvider<T>;
}

export class ObjectTree<T extends NonNullable<any>, TFilterData = void> extends AbstractTree<T | null, TFilterData, T | null> {

	protected override model!: IObjectTreeModel<T, TFilterData>;

	override get onDidChangeCollapseState(): Event<ICollapseStateChangeEvent<T | null, TFilterData>> { return this.model.onDidChangeCollapseState; }

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ITreeRenderer<T, TFilterData, any>[],
		options: IObjectTreeOptions<T, TFilterData> = {}
	) {
		super(user, container, delegate, renderers, options as IObjectTreeOptions<T | null, TFilterData>);
	}

	setChildren(element: T | null, children: Iterable<ITreeElement<T>> = Iterable.empty(), options?: IObjectTreeSetChildrenOptions<T>): void {
		this.model.setChildren(element, children, options);
	}

	rerender(element?: T): void {
		if (element === undefined) {
			this.view.rerender();
			return;
		}

		this.model.rerender(element);
	}

	updateElementHeight(element: T, height: number): void {
		this.model.updateElementHeight(element, height);
	}

	resort(element: T | null, recursive = true): void {
		this.model.resort(element, recursive);
	}

	hasElement(element: T): boolean {
		return this.model.has(element);
	}

	protected createModel(user: string, view: IList<ITreeNode<T, TFilterData>>, options: IObjectTreeOptions<T, TFilterData>): ITreeModel<T | null, TFilterData, T | null> {
		return new ObjectTreeModel(user, view, options);
	}
}

interface ICompressedTreeNodeProvider<T, TFilterData> {
	getCompressedTreeNode(location: T | null): ITreeNode<ICompressedTreeNode<T> | null, TFilterData>;
}

export interface ICompressibleTreeRenderer<T, TFilterData = void, TTemplateData = void> extends ITreeRenderer<T, TFilterData, TTemplateData> {
	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<T>, TFilterData>, index: number, templateData: TTemplateData, height: number | undefined): void;
	disposeCompressedElements?(node: ITreeNode<ICompressedTreeNode<T>, TFilterData>, index: number, templateData: TTemplateData, height: number | undefined): void;
}

interface CompressibleTemplateData<T, TFilterData, TTemplateData> {
	compressedTreeNode: ITreeNode<ICompressedTreeNode<T>, TFilterData> | undefined;
	readonly data: TTemplateData;
}

class CompressibleRenderer<T extends NonNullable<any>, TFilterData, TTemplateData> implements ITreeRenderer<T, TFilterData, CompressibleTemplateData<T, TFilterData, TTemplateData>> {

	readonly templateId: string;
	readonly onDidChangeTwistieState: Event<T> | undefined;

	@memoize
	private get compressedTreeNodeProvider(): ICompressedTreeNodeProvider<T, TFilterData> {
		return this._compressedTreeNodeProvider();
	}

	constructor(private _compressedTreeNodeProvider: () => ICompressedTreeNodeProvider<T, TFilterData>, private renderer: ICompressibleTreeRenderer<T, TFilterData, TTemplateData>) {
		this.templateId = renderer.templateId;

		if (renderer.onDidChangeTwistieState) {
			this.onDidChangeTwistieState = renderer.onDidChangeTwistieState;
		}
	}

	renderTemplate(container: HTMLElement): CompressibleTemplateData<T, TFilterData, TTemplateData> {
		const data = this.renderer.renderTemplate(container);
		return { compressedTreeNode: undefined, data };
	}

	renderElement(node: ITreeNode<T, TFilterData>, index: number, templateData: CompressibleTemplateData<T, TFilterData, TTemplateData>, height: number | undefined): void {
		const compressedTreeNode = this.compressedTreeNodeProvider.getCompressedTreeNode(node.element) as ITreeNode<ICompressedTreeNode<T>, TFilterData>;

		if (compressedTreeNode.element.elements.length === 1) {
			templateData.compressedTreeNode = undefined;
			this.renderer.renderElement(node, index, templateData.data, height);
		} else {
			templateData.compressedTreeNode = compressedTreeNode;
			this.renderer.renderCompressedElements(compressedTreeNode, index, templateData.data, height);
		}
	}

	disposeElement(node: ITreeNode<T, TFilterData>, index: number, templateData: CompressibleTemplateData<T, TFilterData, TTemplateData>, height: number | undefined): void {
		if (templateData.compressedTreeNode) {
			if (this.renderer.disposeCompressedElements) {
				this.renderer.disposeCompressedElements(templateData.compressedTreeNode, index, templateData.data, height);
			}
		} else {
			if (this.renderer.disposeElement) {
				this.renderer.disposeElement(node, index, templateData.data, height);
			}
		}
	}

	disposeTemplate(templateData: CompressibleTemplateData<T, TFilterData, TTemplateData>): void {
		this.renderer.disposeTemplate(templateData.data);
	}

	renderTwistie?(element: T, twistieElement: HTMLElement): boolean {
		if (this.renderer.renderTwistie) {
			return this.renderer.renderTwistie(element, twistieElement);
		}
		return false;
	}
}

export interface ICompressibleKeyboardNavigationLabelProvider<T> extends IKeyboardNavigationLabelProvider<T> {
	getCompressedNodeKeyboardNavigationLabel(elements: T[]): { toString(): string | undefined; } | undefined;
}

export interface ICompressibleObjectTreeOptions<T, TFilterData = void> extends IObjectTreeOptions<T, TFilterData> {
	readonly compressionEnabled?: boolean;
	readonly elementMapper?: ElementMapper<T>;
	readonly keyboardNavigationLabelProvider?: ICompressibleKeyboardNavigationLabelProvider<T>;
}

function asObjectTreeOptions<T, TFilterData>(compressedTreeNodeProvider: () => ICompressedTreeNodeProvider<T, TFilterData>, options?: ICompressibleObjectTreeOptions<T, TFilterData>): IObjectTreeOptions<T, TFilterData> | undefined {
	return options && {
		...options,
		keyboardNavigationLabelProvider: options.keyboardNavigationLabelProvider && {
			getKeyboardNavigationLabel(e: T) {
				let compressedTreeNode: ITreeNode<ICompressedTreeNode<T>, TFilterData>;

				try {
					compressedTreeNode = compressedTreeNodeProvider().getCompressedTreeNode(e) as ITreeNode<ICompressedTreeNode<T>, TFilterData>;
				} catch {
					return options.keyboardNavigationLabelProvider!.getKeyboardNavigationLabel(e);
				}

				if (compressedTreeNode.element.elements.length === 1) {
					return options.keyboardNavigationLabelProvider!.getKeyboardNavigationLabel(e);
				} else {
					return options.keyboardNavigationLabelProvider!.getCompressedNodeKeyboardNavigationLabel(compressedTreeNode.element.elements);
				}
			}
		}
	};
}

export interface ICompressibleObjectTreeOptionsUpdate extends IAbstractTreeOptionsUpdate {
	readonly compressionEnabled?: boolean;
}

export class CompressibleObjectTree<T extends NonNullable<any>, TFilterData = void> extends ObjectTree<T, TFilterData> implements ICompressedTreeNodeProvider<T, TFilterData> {

	protected override model!: CompressibleObjectTreeModel<T, TFilterData>;

	constructor(
		user: string,
		container: HTMLElement,
		delegate: IListVirtualDelegate<T>,
		renderers: ICompressibleTreeRenderer<T, TFilterData, any>[],
		options: ICompressibleObjectTreeOptions<T, TFilterData> = {}
	) {
		const compressedTreeNodeProvider = () => this;
		const compressibleRenderers = renderers.map(r => new CompressibleRenderer<T, TFilterData, any>(compressedTreeNodeProvider, r));
		super(user, container, delegate, compressibleRenderers, asObjectTreeOptions<T, TFilterData>(compressedTreeNodeProvider, options));
	}

	override setChildren(element: T | null, children: Iterable<ICompressedTreeElement<T>> = Iterable.empty(), options?: IObjectTreeSetChildrenOptions<T>): void {
		this.model.setChildren(element, children, options);
	}

	protected override createModel(user: string, view: IList<ITreeNode<T, TFilterData>>, options: ICompressibleObjectTreeOptions<T, TFilterData>): ITreeModel<T | null, TFilterData, T | null> {
		return new CompressibleObjectTreeModel(user, view, options);
	}

	override updateOptions(optionsUpdate: ICompressibleObjectTreeOptionsUpdate = {}): void {
		super.updateOptions(optionsUpdate);

		if (typeof optionsUpdate.compressionEnabled !== 'undefined') {
			this.model.setCompressionEnabled(optionsUpdate.compressionEnabled);
		}
	}

	getCompressedTreeNode(element: T | null = null): ITreeNode<ICompressedTreeNode<T> | null, TFilterData> {
		return this.model.getCompressedTreeNode(element);
	}
}
