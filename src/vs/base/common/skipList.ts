/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


class Node<K, V> {
	readonly forward: Node<K, V>[];
	constructor(readonly level: number, readonly key: K, public value: V) {
		this.forward = [];
	}
}

const NIL: undefined = undefined;

interface Comparator<K> {
	(a: K, b: K): number;
}

export class SkipList<K, V> implements Map<K, V> {

	readonly [Symbol.toStringTag] = 'SkipList';

	private _maxLevel: number;
	private _level: number = 1;
	private _header: Node<K, V>;
	private _size: number = 0;

	/**
	 *
	 * @param capacity Capacity at which the list performs best
	 */
	constructor(
		readonly comparator: (a: K, b: K) => number,
		capacity: number = 2 ** 16
	) {
		this._maxLevel = Math.max(1, Math.log2(capacity) | 0);
		this._header = <any>new Node(this._maxLevel, NIL, NIL);
	}

	get size(): number {
		return this._size;
	}

	clear(): void {
		this._header = <any>new Node(this._maxLevel, NIL, NIL);
	}

	has(key: K): boolean {
		return Boolean(SkipList._search(this, key, this.comparator));
	}

	get(key: K): V | undefined {
		return SkipList._search(this, key, this.comparator)?.value;
	}

	set(key: K, value: V): this {
		if (SkipList._insert(this, key, value, this.comparator)) {
			this._size += 1;
		}
		return this;
	}

	delete(key: K): boolean {
		const didDelete = SkipList._delete(this, key, this.comparator);
		if (didDelete) {
			this._size -= 1;
		}
		return didDelete;
	}

	// --- iteration

	forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
		let node = this._header.forward[0];
		while (node) {
			callbackfn.call(thisArg, node.value, node.key, this);
			node = node.forward[0];
		}
	}

	[Symbol.iterator](): IterableIterator<[K, V]> {
		return this.entries();
	}

	*entries(): IterableIterator<[K, V]> {
		let node = this._header.forward[0];
		while (node) {
			yield [node.key, node.value];
			node = node.forward[0];
		}
	}

	*keys(): IterableIterator<K> {
		let node = this._header.forward[0];
		while (node) {
			yield node.key;
			node = node.forward[0];
		}
	}

	*values(): IterableIterator<V> {
		let node = this._header.forward[0];
		while (node) {
			yield node.value;
			node = node.forward[0];
		}
	}

	toString(): string {
		// debug string...
		let result = '[SkipList]:';
		let node = this._header.forward[0];
		while (node) {
			result += `node(${node.key}, ${node.value}, lvl:${node.level})`;
			node = node.forward[0];
		}
		return result;
	}

	// from https://www.epaperpress.com/sortsearch/download/skiplist.pdf

	private static _search<K, V>(list: SkipList<K, V>, searchKey: K, comparator: Comparator<K>) {
		let x = list._header;
		for (let i = list._level; i >= 0; i--) {
			while (x.forward[i] && comparator(x.forward[i].key, searchKey) < 0) {
				x = x.forward[i];
			}
		}
		x = x.forward[0];
		if (x && comparator(x.key, searchKey) === 0) {
			return x;
		}
		return undefined;
	}

	private static _insert<K, V>(list: SkipList<K, V>, searchKey: K, value: V, comparator: Comparator<K>) {
		let update: Node<K, V>[] = [];
		let x = list._header;
		for (let i = list._level; i >= 0; i--) {
			while (x.forward[i] && comparator(x.forward[i].key, searchKey) < 0) {
				x = x.forward[i];
			}
			update[i] = x;
		}
		x = x.forward[0];
		if (x && comparator(x.key, searchKey) === 0) {
			// update
			x.value = value;
			return false;
		} else {
			// insert
			let lvl = SkipList._randomLevel(list);
			if (lvl > list._level) {
				for (let i = list._level + 1; i <= lvl; i++) {
					update[i] = list._header;
				}
				list._level = lvl;
			}
			x = new Node<K, V>(lvl, searchKey, value);
			for (let i = 0; i <= lvl; i++) {
				x.forward[i] = update[i].forward[i];
				update[i].forward[i] = x;
			}
			return true;
		}
	}

	private static _randomLevel(list: SkipList<any, any>, p: number = 0.5): number {
		let lvl = 1;
		while (Math.random() < p && lvl < list._maxLevel) {
			lvl += 1;
		}
		return lvl;
	}

	private static _delete<K, V>(list: SkipList<K, V>, searchKey: K, comparator: Comparator<K>) {
		let update: Node<K, V>[] = [];
		let x = list._header;
		for (let i = list._level; i >= 0; i--) {
			while (x.forward[i] && comparator(x.forward[i].key, searchKey) < 0) {
				x = x.forward[i];
			}
			update[i] = x;
		}
		x = x.forward[0];
		if (!x || comparator(x.key, searchKey) !== 0) {
			// not found
			return false;
		}
		for (let i = 0; i < list._level; i++) {
			if (update[i].forward[i] !== x) {
				break;
			}
			update[i].forward[i] = x.forward[i];
		}
		while (list._level >= 1 && list._header.forward[list._level] === NIL) {
			list._level -= 1;
		}
		return true;
	}

}
