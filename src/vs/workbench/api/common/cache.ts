/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class Cache<T> {

	private static readonly enableDebugLogging = false;

	private readonly _data = new Map<number, readonly T[]>();
	private _idPool = 1;

	constructor(
		private readonly id: string
	) { }

	add(item: readonly T[]): number {
		const id = this._idPool++;
		this._data.set(id, item);
		this.logDebugInfo();
		return id;
	}

	get(pid: number, id: number): T | undefined {
		return this._data.has(pid) ? this._data.get(pid)![id] : undefined;
	}

	delete(id: number) {
		this._data.delete(id);
		this.logDebugInfo();
	}

	private logDebugInfo() {
		if (!Cache.enableDebugLogging) {
			return;
		}
		console.log(`${this.id} cache size — ${this._data.size}`);
	}
}
