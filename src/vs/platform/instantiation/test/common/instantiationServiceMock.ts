/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import { ServiceIdentifier } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';

interface IServiceMock<T> {
	id: ServiceIdentifier<T>;
	service: any;
}

const isSinonSpyLike = (fn: Function): fn is sinon.SinonSpy => fn && 'callCount' in fn;

export class TestInstantiationService extends InstantiationService {

	private _servciesMap: Map<ServiceIdentifier<any>, any>;

	constructor(private _serviceCollection: ServiceCollection = new ServiceCollection()) {
		super(_serviceCollection);

		this._servciesMap = new Map<ServiceIdentifier<any>, any>();
	}

	public get<T>(service: ServiceIdentifier<T>): T {
		return <T>this._serviceCollection.get(service);
	}

	public set<T>(service: ServiceIdentifier<T>, instance: T): T {
		return <T>this._serviceCollection.set(service, instance);
	}

	public mock<T>(service: ServiceIdentifier<T>): T | sinon.SinonMock {
		return <T>this._create(service, { mock: true });
	}

	public stub<T>(service: ServiceIdentifier<T>, ctor: Function): T;
	public stub<T>(service: ServiceIdentifier<T>, obj: Partial<T>): T;
	public stub<T, V>(service: ServiceIdentifier<T>, ctor: Function, property: string, value: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
	public stub<T, V>(service: ServiceIdentifier<T>, obj: Partial<T>, property: string, value: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
	public stub<T, V>(service: ServiceIdentifier<T>, property: string, value: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
	public stub<T>(serviceIdentifier: ServiceIdentifier<T>, arg2: any, arg3?: string, arg4?: any): sinon.SinonStub | sinon.SinonSpy {
		let service = typeof arg2 !== 'string' ? arg2 : undefined;
		let serviceMock: IServiceMock<any> = { id: serviceIdentifier, service: service };
		let property = typeof arg2 === 'string' ? arg2 : arg3;
		let value = typeof arg2 === 'string' ? arg3 : arg4;

		let stubObject = <any>this._create(serviceMock, { stub: true }, service && !property);
		if (property) {
			if (stubObject[property]) {
				if (stubObject[property].hasOwnProperty('restore')) {
					stubObject[property].restore();
				}
				if (typeof value === 'function') {
					const spy = isSinonSpyLike(value) ? value : sinon.spy(value);
					stubObject[property] = spy;
					return spy;
				} else {
					const stub = value ? sinon.stub().returns(value) : sinon.stub();
					stubObject[property] = stub;
					return stub;
				}
			} else {
				stubObject[property] = value;
			}
		}
		return stubObject;
	}

	public stubPromise<T>(service?: ServiceIdentifier<T>, fnProperty?: string, value?: any): T | sinon.SinonStub;
	public stubPromise<T, V>(service?: ServiceIdentifier<T>, ctor?: any, fnProperty?: string, value?: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
	public stubPromise<T, V>(service?: ServiceIdentifier<T>, obj?: any, fnProperty?: string, value?: V): V extends Function ? sinon.SinonSpy : sinon.SinonStub;
	public stubPromise(arg1?: any, arg2?: any, arg3?: any, arg4?: any): sinon.SinonStub | sinon.SinonSpy {
		arg3 = typeof arg2 === 'string' ? Promise.resolve(arg3) : arg3;
		arg4 = typeof arg2 !== 'string' && typeof arg3 === 'string' ? Promise.resolve(arg4) : arg4;
		return this.stub(arg1, arg2, arg3, arg4);
	}

	public spy<T>(service: ServiceIdentifier<T>, fnProperty: string): sinon.SinonSpy {
		let spy = sinon.spy();
		this.stub(service, fnProperty, spy);
		return spy;
	}

	private _create<T>(serviceMock: IServiceMock<T>, options: SinonOptions, reset?: boolean): any;
	private _create<T>(ctor: any, options: SinonOptions): any;
	private _create(arg1: any, options: SinonOptions, reset: boolean = false): any {
		if (this.isServiceMock(arg1)) {
			let service = this._getOrCreateService(arg1, options, reset);
			this._serviceCollection.set(arg1.id, service);
			return service;
		}
		return options.mock ? sinon.mock(arg1) : this._createStub(arg1);
	}

	private _getOrCreateService<T>(serviceMock: IServiceMock<T>, opts: SinonOptions, reset?: boolean): any {
		let service: any = this._serviceCollection.get(serviceMock.id);
		if (!reset && service) {
			if (opts.mock && service['sinonOptions'] && !!service['sinonOptions'].mock) {
				return service;
			}
			if (opts.stub && service['sinonOptions'] && !!service['sinonOptions'].stub) {
				return service;
			}
		}
		return this._createService(serviceMock, opts);
	}

	private _createService(serviceMock: IServiceMock<any>, opts: SinonOptions): any {
		serviceMock.service = serviceMock.service ? serviceMock.service : this._servciesMap.get(serviceMock.id);
		let service = opts.mock ? sinon.mock(serviceMock.service) : this._createStub(serviceMock.service);
		service['sinonOptions'] = opts;
		return service;
	}

	private _createStub(arg: any): any {
		return typeof arg === 'object' ? arg : sinon.createStubInstance(arg);
	}

	private isServiceMock(arg1: any): boolean {
		return typeof arg1 === 'object' && arg1.hasOwnProperty('id');
	}
}

interface SinonOptions {
	mock?: boolean;
	stub?: boolean;
}
