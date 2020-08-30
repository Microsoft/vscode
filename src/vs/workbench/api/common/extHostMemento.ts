/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ExtHostStorage } from 'vs/workbench/api/common/extHostStorage';

export class ExtensionMemento implements vscode.Memento {

	private readonly _id: string;
	private readonly _shared: boolean;
	private readonly _storage: ExtHostStorage;

	private readonly _init: Promise<ExtensionMemento>;
	private _value?: { [n: string]: any; };
	private readonly _storageListener: IDisposable;

	constructor(id: string, global: boolean, storage: ExtHostStorage) {
		this._id = id;
		this._shared = global;
		this._storage = storage;

		this._init = this._storage.getValue(this._shared, this._id, Object.create(null)).then(value => {
			this._value = value;
			return this;
		});

		this._storageListener = this._storage.onDidChangeStorage(e => {
			if (e.shared === this._shared && e.key === this._id) {
				this._value = e.value;
			}
		});
	}

	get whenReady(): Promise<ExtensionMemento> {
		return this._init;
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T {
		let value = this._value![key];
		if (typeof value === 'undefined') {
			value = defaultValue;
		}
		return value;
	}

	update(key: string, value: any): Promise<void> {
		this._value![key] = value;
		return this._storage.setValue(this._shared, this._id, this._value!);
	}

	dispose(): void {
		this._storageListener.dispose();
	}
}
