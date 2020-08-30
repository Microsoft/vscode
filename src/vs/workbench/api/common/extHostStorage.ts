/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainContext, MainThreadStorageShape, ExtHostStorageShape } from './extHost.protocol';
import { Emitter } from 'vs/base/common/event';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface IStorageChangeEvent {
	shared: boolean;
	key: string;
	value: object;
}

export class ExtHostStorage implements ExtHostStorageShape {

	readonly _serviceBrand: undefined;

	private _proxy: MainThreadStorageShape;

	private readonly _onDidChangeStorage = new Emitter<IStorageChangeEvent>();
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	constructor(mainContext: IExtHostRpcService) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadStorage);
	}

	getValue<T>(shared: boolean, key: string, defaultValue?: T): Promise<T | undefined> {
		return this._proxy.$getValue<T>(shared, key).then(value => value || defaultValue);
	}

	setValue(shared: boolean, key: string, value: object): Promise<void> {
		return this._proxy.$setValue(shared, key, value);
	}

	$acceptValue(shared: boolean, key: string, value: object): void {
		this._onDidChangeStorage.fire({ shared, key, value });
	}
}

export interface IExtHostStorage extends ExtHostStorage { }
export const IExtHostStorage = createDecorator<IExtHostStorage>('IExtHostStorage');
