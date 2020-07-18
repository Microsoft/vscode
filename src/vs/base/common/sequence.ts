/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';

export interface ISplice<T> {
	readonly start: number;
	readonly deleteCount: number;
	readonly toInsert: T[];
}

export interface ISpliceable<T> {
	splice(start: number, deleteCount: number, toInsert: T[]): void;
}

export interface ISequence<T> {
	readonly elements: T[];
	readonly onDidSplice: Event<ISplice<T>>;
}

export class Sequence<T> implements ISequence<T>, ISpliceable<T> {

	readonly elements: T[] = [];

	private readonly _onDidSplice = new Emitter<ISplice<T>>();
	readonly onDidSplice: Event<ISplice<T>> = this._onDidSplice.event;

	splice(start: number, deleteCount: number, toInsert: T[] = []): void {
		this.elements.splice(start, deleteCount, ...toInsert);
		this._onDidSplice.fire({ start, deleteCount, toInsert });
	}
}

export class SimpleSequence<T> implements ISequence<T> {

	private _elements: T[];
	get elements(): T[] { return this._elements; }

	readonly onDidSplice: Event<ISplice<T>>;
	private disposable: IDisposable;

	constructor(elements: T[], onDidAdd: Event<T>, onDidRemove: Event<T>) {
		this._elements = [...elements];
		this.onDidSplice = Event.any(
			Event.map(onDidAdd, e => ({ start: this.elements.length, deleteCount: 0, toInsert: [e] })),
			Event.map(Event.filter(Event.map(onDidRemove, e => this.elements.indexOf(e)), i => i > -1), i => ({ start: i, deleteCount: 1, toInsert: [] }))
		);

		this.disposable = this.onDidSplice(({ start, deleteCount, toInsert }) => this._elements.splice(start, deleteCount, ...toInsert));
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
