/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { StoredValue } from 'vs/workbench/contrib/testing/common/storedValue';

export interface IObservableValue<T> {
	onDidChange: Event<T>;
	readonly value: T;
}

export const staticObservableValue = <T>(value: T): IObservableValue<T> => ({
	onDidChange: Event.None,
	value,
});

export class MutableObservableValue<T> implements IObservableValue<T> {
	private readonly changeEmitter = new Emitter<T>();

	public readonly onDidChange = this.changeEmitter.event;

	public get value() {
		return this._value;
	}

	public set value(v: T) {
		if (v !== this._value) {
			this._value = v;
			this.changeEmitter.fire(v);
		}
	}

	public static stored<T>(stored: StoredValue<T>, defaultValue: T) {
		const o = new MutableObservableValue(stored.get(defaultValue));
		o.onDidChange(value => stored.store(value));
		return o;
	}

	constructor(private _value: T) { }
}
