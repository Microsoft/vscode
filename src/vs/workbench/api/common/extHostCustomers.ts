/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { IConstructorSignature1, BrandedService } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { ProxyIdentifier } from 'vs/workbench/services/extensions/common/proxyIdentifier';

export type IExtHostNamedCustomer<T extends IDisposable> = [ProxyIdentifier<T>, IExtHostCustomerCtor<T>];

export type IExtHostCustomerCtor<T extends IDisposable> = IConstructorSignature1<IExtHostContext, T>;

export function extHostNamedCustomer<T extends IDisposable>(id: ProxyIdentifier<T>) {
	return function <Services extends BrandedService[]>(ctor: { new(context: IExtHostContext, ...services: Services): T }): void {
		ExtHostCustomersRegistryImpl.INSTANCE.registerNamedCustomer(id, ctor as IExtHostCustomerCtor<T>);
	};
}

export function extHostCustomer<T extends IDisposable, Services extends BrandedService[]>(ctor: { new(context: IExtHostContext, ...services: Services): T }): void {
	ExtHostCustomersRegistryImpl.INSTANCE.registerCustomer(ctor as IExtHostCustomerCtor<T>);
}

export namespace ExtHostCustomersRegistry {

	export function getNamedCustomers(): IExtHostNamedCustomer<IDisposable>[] {
		return ExtHostCustomersRegistryImpl.INSTANCE.getNamedCustomers();
	}

	export function getCustomers(): IExtHostCustomerCtor<IDisposable>[] {
		return ExtHostCustomersRegistryImpl.INSTANCE.getCustomers();
	}
}

class ExtHostCustomersRegistryImpl {

	public static readonly INSTANCE = new ExtHostCustomersRegistryImpl();

	private _namedCustomers: IExtHostNamedCustomer<any>[];
	private _customers: IExtHostCustomerCtor<any>[];

	constructor() {
		this._namedCustomers = [];
		this._customers = [];
	}

	public registerNamedCustomer<T extends IDisposable>(id: ProxyIdentifier<T>, ctor: IExtHostCustomerCtor<T>): void {
		const entry: IExtHostNamedCustomer<T> = [id, ctor];
		this._namedCustomers.push(entry);
	}
	public getNamedCustomers(): IExtHostNamedCustomer<any>[] {
		return this._namedCustomers;
	}

	public registerCustomer<T extends IDisposable>(ctor: IExtHostCustomerCtor<T>): void {
		this._customers.push(ctor);
	}
	public getCustomers(): IExtHostCustomerCtor<any>[] {
		return this._customers;
	}
}
