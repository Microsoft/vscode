/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface INavigator<T> {
	current(): T | null;
	previous(): T | null;
	first(): T | null;
	last(): T | null;
	next(): T | null;
}

export class ArrayNavigator<T> implements INavigator<T> {

	constructor(
		private readonly items: readonly T[],
		protected start: number = 0,
		protected end: number = items.length,
		protected index = start - 1
	) { }

	current(): T | null {
		if (this.index === this.start - 1 || this.index === this.end) {
			return null;
		}

		return this.items[this.index];
	}

	next(): T | null {
		this.index = Math.min(this.index + 1, this.end);
		return this.current();
	}

	previous(): T | null {
		this.index = Math.max(this.index - 1, this.start - 1);
		return this.current();
	}

	first(): T | null {
		this.index = this.start;
		return this.current();
	}

	last(): T | null {
		this.index = this.end - 1;
		return this.current();
	}
}
