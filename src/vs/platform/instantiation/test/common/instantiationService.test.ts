/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createDecorator, IInstantiationService, optional, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';

let IService1 = createDecorator<IService1>('service1');

interface IService1 {
	readonly _serviceBrand: undefined;
	c: number;
}

class Service1 implements IService1 {
	declare readonly _serviceBrand: undefined;
	c = 1;
}

let IService2 = createDecorator<IService2>('service2');

interface IService2 {
	readonly _serviceBrand: undefined;
	d: boolean;
}

class Service2 implements IService2 {
	declare readonly _serviceBrand: undefined;
	d = true;
}

let IService3 = createDecorator<IService3>('service3');

interface IService3 {
	readonly _serviceBrand: undefined;
	s: string;
}

class Service3 implements IService3 {
	declare readonly _serviceBrand: undefined;
	s = 'farboo';
}

let IDependentService = createDecorator<IDependentService>('dependentService');

interface IDependentService {
	readonly _serviceBrand: undefined;
	name: string;
}

class DependentService implements IDependentService {
	declare readonly _serviceBrand: undefined;
	constructor(@IService1 service: IService1) {
		assert.strictEqual(service.c, 1);
	}

	name = 'farboo';
}

class Service1Consumer {

	constructor(@IService1 service1: IService1) {
		assert.ok(service1);
		assert.strictEqual(service1.c, 1);
	}
}

class Target2Dep {

	constructor(@IService1 service1: IService1, @IService2 service2: Service2) {
		assert.ok(service1 instanceof Service1);
		assert.ok(service2 instanceof Service2);
	}
}

class TargetWithStaticParam {
	constructor(v: boolean, @IService1 service1: IService1) {
		assert.ok(v);
		assert.ok(service1);
		assert.strictEqual(service1.c, 1);
	}
}

class TargetNotOptional {
	constructor(@IService1 service1: IService1, @IService2 service2: IService2) {

	}
}
class TargetOptional {
	constructor(@IService1 service1: IService1, @optional(IService2) service2: IService2) {
		assert.ok(service1);
		assert.strictEqual(service1.c, 1);
		assert.ok(service2 === undefined);
	}
}

class DependentServiceTarget {
	constructor(@IDependentService d: IDependentService) {
		assert.ok(d);
		assert.strictEqual(d.name, 'farboo');
	}
}

class DependentServiceTarget2 {
	constructor(@IDependentService d: IDependentService, @IService1 s: IService1) {
		assert.ok(d);
		assert.strictEqual(d.name, 'farboo');
		assert.ok(s);
		assert.strictEqual(s.c, 1);
	}
}


class ServiceLoop1 implements IService1 {
	declare readonly _serviceBrand: undefined;
	c = 1;

	constructor(@IService2 s: IService2) {

	}
}

class ServiceLoop2 implements IService2 {
	declare readonly _serviceBrand: undefined;
	d = true;

	constructor(@IService1 s: IService1) {

	}
}

suite('Instantiation Service', () => {

	test('service collection, cannot overwrite', function () {
		let collection = new ServiceCollection();
		let result = collection.set(IService1, null!);
		assert.strictEqual(result, undefined);
		result = collection.set(IService1, new Service1());
		assert.strictEqual(result, null);
	});

	test('service collection, add/has', function () {
		let collection = new ServiceCollection();
		collection.set(IService1, null!);
		assert.ok(collection.has(IService1));

		collection.set(IService2, null!);
		assert.ok(collection.has(IService1));
		assert.ok(collection.has(IService2));
	});

	test('@Param - simple clase', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new Service1());
		collection.set(IService2, new Service2());
		collection.set(IService3, new Service3());

		service.createInstance(Service1Consumer);
	});

	test('@Param - fixed args', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new Service1());
		collection.set(IService2, new Service2());
		collection.set(IService3, new Service3());

		service.createInstance(TargetWithStaticParam, true);
	});

	test('service collection is live', function () {

		let collection = new ServiceCollection();
		collection.set(IService1, new Service1());

		let service = new InstantiationService(collection);
		service.createInstance(Service1Consumer);

		// no IService2
		assert.throws(() => service.createInstance(Target2Dep));
		service.invokeFunction(function (a) {
			assert.ok(a.get(IService1));
			assert.ok(!a.get(IService2, optional));
		});

		collection.set(IService2, new Service2());

		service.createInstance(Target2Dep);
		service.invokeFunction(function (a) {
			assert.ok(a.get(IService1));
			assert.ok(a.get(IService2));
		});
	});

	test('@Param - optional', function () {
		let collection = new ServiceCollection([IService1, new Service1()]);
		let service = new InstantiationService(collection, true);

		service.createInstance(TargetOptional);
		assert.throws(() => service.createInstance(TargetNotOptional));

		service = new InstantiationService(collection, false);
		service.createInstance(TargetOptional);
		service.createInstance(TargetNotOptional);
	});

	// we made this a warning
	// test('@Param - too many args', function () {
	// 	let service = instantiationService.create(Object.create(null));
	// 	service.addSingleton(IService1, new Service1());
	// 	service.addSingleton(IService2, new Service2());
	// 	service.addSingleton(IService3, new Service3());

	// 	assert.throws(() => service.createInstance(ParameterTarget2, true, 2));
	// });

	// test('@Param - too few args', function () {
	// 	let service = instantiationService.create(Object.create(null));
	// 	service.addSingleton(IService1, new Service1());
	// 	service.addSingleton(IService2, new Service2());
	// 	service.addSingleton(IService3, new Service3());

	// 	assert.throws(() => service.createInstance(ParameterTarget2));
	// });

	test('SyncDesc - no dependencies', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new SyncDescriptor<IService1>(Service1));

		service.invokeFunction(accessor => {

			let service1 = accessor.get(IService1);
			assert.ok(service1);
			assert.strictEqual(service1.c, 1);

			let service2 = accessor.get(IService1);
			assert.ok(service1 === service2);
		});
	});

	test('SyncDesc - service with service dependency', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new SyncDescriptor<IService1>(Service1));
		collection.set(IDependentService, new SyncDescriptor<IDependentService>(DependentService));

		service.invokeFunction(accessor => {
			let d = accessor.get(IDependentService);
			assert.ok(d);
			assert.strictEqual(d.name, 'farboo');
		});
	});

	test('SyncDesc - target depends on service future', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new SyncDescriptor<IService1>(Service1));
		collection.set(IDependentService, new SyncDescriptor<IDependentService>(DependentService));

		let d = service.createInstance(DependentServiceTarget);
		assert.ok(d instanceof DependentServiceTarget);

		let d2 = service.createInstance(DependentServiceTarget2);
		assert.ok(d2 instanceof DependentServiceTarget2);
	});

	test('SyncDesc - explode on loop', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new SyncDescriptor<IService1>(ServiceLoop1));
		collection.set(IService2, new SyncDescriptor<IService2>(ServiceLoop2));

		assert.throws(() => {
			service.invokeFunction(accessor => {
				accessor.get(IService1);
			});
		});
		assert.throws(() => {
			service.invokeFunction(accessor => {
				accessor.get(IService2);
			});
		});

		try {
			service.invokeFunction(accessor => {
				accessor.get(IService1);
			});
		} catch (err) {
			assert.ok(err.name);
			assert.ok(err.message);
		}
	});

	test('Invoke - get services', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new Service1());
		collection.set(IService2, new Service2());

		function test(accessor: ServicesAccessor) {
			assert.ok(accessor.get(IService1) instanceof Service1);
			assert.strictEqual(accessor.get(IService1).c, 1);

			return true;
		}

		assert.strictEqual(service.invokeFunction(test), true);
	});

	test('Invoke - get service, optional', function () {
		let collection = new ServiceCollection([IService1, new Service1()]);
		let service = new InstantiationService(collection);

		function test(accessor: ServicesAccessor) {
			assert.ok(accessor.get(IService1) instanceof Service1);
			assert.throws(() => accessor.get(IService2));
			assert.strictEqual(accessor.get(IService2, optional), undefined);
			return true;
		}
		assert.strictEqual(service.invokeFunction(test), true);
	});

	test('Invoke - keeping accessor NOT allowed', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new Service1());
		collection.set(IService2, new Service2());

		let cached: ServicesAccessor;

		function test(accessor: ServicesAccessor) {
			assert.ok(accessor.get(IService1) instanceof Service1);
			assert.strictEqual(accessor.get(IService1).c, 1);
			cached = accessor;
			return true;
		}

		assert.strictEqual(service.invokeFunction(test), true);

		assert.throws(() => cached.get(IService2));
	});

	test('Invoke - throw error', function () {
		let collection = new ServiceCollection();
		let service = new InstantiationService(collection);
		collection.set(IService1, new Service1());
		collection.set(IService2, new Service2());

		function test(accessor: ServicesAccessor) {
			throw new Error();
		}

		assert.throws(() => service.invokeFunction(test));
	});

	test('Create child', function () {

		let serviceInstanceCount = 0;

		const CtorCounter = class implements Service1 {
			declare readonly _serviceBrand: undefined;
			c = 1;
			constructor() {
				serviceInstanceCount += 1;
			}
		};

		// creating the service instance BEFORE the child service
		let service = new InstantiationService(new ServiceCollection([IService1, new SyncDescriptor(CtorCounter)]));
		service.createInstance(Service1Consumer);

		// second instance must be earlier ONE
		let child = service.createChild(new ServiceCollection([IService2, new Service2()]));
		child.createInstance(Service1Consumer);

		assert.strictEqual(serviceInstanceCount, 1);

		// creating the service instance AFTER the child service
		serviceInstanceCount = 0;
		service = new InstantiationService(new ServiceCollection([IService1, new SyncDescriptor(CtorCounter)]));
		child = service.createChild(new ServiceCollection([IService2, new Service2()]));

		// second instance must be earlier ONE
		service.createInstance(Service1Consumer);
		child.createInstance(Service1Consumer);

		assert.strictEqual(serviceInstanceCount, 1);
	});

	test('Remote window / integration tests is broken #105562', function () {

		const Service1 = createDecorator<any>('service1');
		class Service1Impl {
			constructor(@IInstantiationService insta: IInstantiationService) {
				const c = insta.invokeFunction(accessor => accessor.get(Service2)); // THIS is the recursive call
				assert.ok(c);
			}
		}
		const Service2 = createDecorator<any>('service2');
		class Service2Impl {
			constructor() { }
		}

		// This service depends on Service1 and Service2 BUT creating Service1 creates Service2 (via recursive invocation)
		// and then Servce2 should not be created a second time
		const Service21 = createDecorator<any>('service21');
		class Service21Impl {
			constructor(@Service2 readonly service2: Service2Impl, @Service1 readonly service1: Service1Impl) { }
		}

		const insta = new InstantiationService(new ServiceCollection(
			[Service1, new SyncDescriptor(Service1Impl)],
			[Service2, new SyncDescriptor(Service2Impl)],
			[Service21, new SyncDescriptor(Service21Impl)],
		));

		const obj = insta.invokeFunction(accessor => accessor.get(Service21));
		assert.ok(obj);
	});

});
