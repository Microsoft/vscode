/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memoize } from 'vs/base/common/decorators';
import * as paths from 'vs/base/common/path';
import { relativePath, joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { PathIterator } from 'vs/base/common/map';

export interface IResourceNode<T, C = void> {
	readonly uri: URI;
	readonly relativePath: string;
	readonly name: string;
	readonly element: T | undefined;
	readonly children: Iterable<IResourceNode<T, C>>;
	readonly childrenCount: number;
	readonly parent: IResourceNode<T, C> | undefined;
	readonly context: C;
	get(childName: string): IResourceNode<T, C> | undefined;
}

class Node<T, C> implements IResourceNode<T, C> {

	private _children = new Map<string, Node<T, C>>();

	get childrenCount(): number {
		return this._children.size;
	}

	get children(): Iterable<Node<T, C>> {
		return this._children.values();
	}

	@memoize
	get name(): string {
		return paths.posix.basename(this.relativePath);
	}

	constructor(
		readonly uri: URI,
		readonly relativePath: string,
		readonly context: C,
		public element: T | undefined = undefined,
		readonly parent: IResourceNode<T, C> | undefined = undefined
	) { }

	get(path: string): Node<T, C> | undefined {
		return this._children.get(path);
	}

	set(path: string, child: Node<T, C>): void {
		this._children.set(path, child);
	}

	delete(path: string): void {
		this._children.delete(path);
	}

	clear(): void {
		this._children.clear();
	}
}

function collect<T, C>(node: IResourceNode<T, C>, result: T[]): T[] {
	if (typeof node.element !== 'undefined') {
		result.push(node.element);
	}

	for (const child of node.children) {
		collect(child, result);
	}

	return result;
}

export class ResourceTree<T extends NonNullable<any>, C> {

	readonly root: Node<T, C>;

	static getRoot<T, C>(node: IResourceNode<T, C>): IResourceNode<T, C> {
		while (node.parent) {
			node = node.parent;
		}

		return node;
	}

	static collect<T, C>(node: IResourceNode<T, C>): T[] {
		return collect(node, []);
	}

	static isResourceNode<T, C>(obj: any): obj is IResourceNode<T, C> {
		return obj instanceof Node;
	}

	constructor(context: C, rootURI: URI = URI.file('/')) {
		this.root = new Node(rootURI, '', context);
	}

	add(uri: URI, element: T): void {
		const key = relativePath(this.root.uri, uri) || uri.fsPath;
		const iterator = new PathIterator(false).reset(key);
		let node = this.root;
		let path = '';

		while (true) {
			const name = iterator.value();
			path = path + '/' + name;

			let child = node.get(name);

			if (!child) {
				child = new Node(
					joinPath(this.root.uri, path),
					path,
					this.root.context,
					iterator.hasNext() ? undefined : element,
					node
				);

				node.set(name, child);
			} else if (!iterator.hasNext()) {
				child.element = element;
			}

			node = child;

			if (!iterator.hasNext()) {
				return;
			}

			iterator.next();
		}
	}

	delete(uri: URI): T | undefined {
		const key = relativePath(this.root.uri, uri) || uri.fsPath;
		const iterator = new PathIterator(false).reset(key);
		return this._delete(this.root, iterator);
	}

	private _delete(node: Node<T, C>, iterator: PathIterator): T | undefined {
		const name = iterator.value();
		const child = node.get(name);

		if (!child) {
			return undefined;
		}

		if (iterator.hasNext()) {
			const result = this._delete(child, iterator.next());

			if (typeof result !== 'undefined' && child.childrenCount === 0) {
				node.delete(name);
			}

			return result;
		}

		node.delete(name);
		return child.element;
	}

	clear(): void {
		this.root.clear();
	}

	getNode(uri: URI): IResourceNode<T, C> | undefined {
		const key = relativePath(this.root.uri, uri) || uri.fsPath;
		const iterator = new PathIterator(false).reset(key);
		let node = this.root;

		while (true) {
			const name = iterator.value();
			const child = node.get(name);

			if (!child || !iterator.hasNext()) {
				return child;
			}

			node = child;
			iterator.next();
		}
	}
}
