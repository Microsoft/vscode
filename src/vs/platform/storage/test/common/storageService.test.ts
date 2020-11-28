/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual, ok, equal } from 'assert';
import { StorageScope, InMemoryStorageService, StorageTarget, IStorageValueChangeEvent, IStorageTargetChangeEvent } from 'vs/platform/storage/common/storage';

suite('StorageService', function () {

	test('Get Data, Integer, Boolean (global, in-memory)', () => {
		storeData(StorageScope.GLOBAL);
	});

	test('Get Data, Integer, Boolean (workspace, in-memory)', () => {
		storeData(StorageScope.WORKSPACE);
	});

	function storeData(scope: StorageScope): void {
		const storage = new InMemoryStorageService();

		let storageValueChangeEvents: IStorageValueChangeEvent[] = [];
		storage.onDidChangeValue(e => storageValueChangeEvents.push(e));

		strictEqual(storage.get('test.get', scope, 'foobar'), 'foobar');
		strictEqual(storage.get('test.get', scope, ''), '');
		strictEqual(storage.getNumber('test.getNumber', scope, 5), 5);
		strictEqual(storage.getNumber('test.getNumber', scope, 0), 0);
		strictEqual(storage.getBoolean('test.getBoolean', scope, true), true);
		strictEqual(storage.getBoolean('test.getBoolean', scope, false), false);

		storage.store('test.get', 'foobar', scope, StorageTarget.MACHINE);
		strictEqual(storage.get('test.get', scope, (undefined)!), 'foobar');
		let storageValueChangeEvent = storageValueChangeEvents.find(e => e.key === 'test.get');
		equal(storageValueChangeEvent?.scope, scope);
		equal(storageValueChangeEvent?.key, 'test.get');
		storageValueChangeEvents = [];

		storage.store('test.get', '', scope, StorageTarget.MACHINE);
		strictEqual(storage.get('test.get', scope, (undefined)!), '');
		storageValueChangeEvent = storageValueChangeEvents.find(e => e.key === 'test.get');
		equal(storageValueChangeEvent!.scope, scope);
		equal(storageValueChangeEvent!.key, 'test.get');

		storage.store('test.getNumber', 5, scope, StorageTarget.MACHINE);
		strictEqual(storage.getNumber('test.getNumber', scope, (undefined)!), 5);

		storage.store('test.getNumber', 0, scope, StorageTarget.MACHINE);
		strictEqual(storage.getNumber('test.getNumber', scope, (undefined)!), 0);

		storage.store('test.getBoolean', true, scope, StorageTarget.MACHINE);
		strictEqual(storage.getBoolean('test.getBoolean', scope, (undefined)!), true);

		storage.store('test.getBoolean', false, scope, StorageTarget.MACHINE);
		strictEqual(storage.getBoolean('test.getBoolean', scope, (undefined)!), false);

		strictEqual(storage.get('test.getDefault', scope, 'getDefault'), 'getDefault');
		strictEqual(storage.getNumber('test.getNumberDefault', scope, 5), 5);
		strictEqual(storage.getBoolean('test.getBooleanDefault', scope, true), true);
	}

	test('Remove Data (global, in-memory)', () => {
		removeData(StorageScope.GLOBAL);
	});

	test('Remove Data (workspace, in-memory)', () => {
		removeData(StorageScope.WORKSPACE);
	});

	function removeData(scope: StorageScope): void {
		const storage = new InMemoryStorageService();

		let storageValueChangeEvents: IStorageValueChangeEvent[] = [];
		storage.onDidChangeValue(e => storageValueChangeEvents.push(e));

		storage.store('test.remove', 'foobar', scope, StorageTarget.MACHINE);
		strictEqual('foobar', storage.get('test.remove', scope, (undefined)!));

		storage.remove('test.remove', scope);
		ok(!storage.get('test.remove', scope, (undefined)!));
		let storageValueChangeEvent = storageValueChangeEvents.find(e => e.key === 'test.remove');
		equal(storageValueChangeEvent?.scope, scope);
		equal(storageValueChangeEvent?.key, 'test.remove');
	}

	test('Keys (in-memory)', () => {
		const storage = new InMemoryStorageService();

		let storageTargetEvent: IStorageTargetChangeEvent | undefined = undefined;
		storage.onDidChangeTarget(e => storageTargetEvent = e);

		let storageValueChangeEvent: IStorageValueChangeEvent | undefined = undefined;
		storage.onDidChangeValue(e => storageValueChangeEvent = e);

		// Empty
		for (const scope of [StorageScope.WORKSPACE, StorageScope.GLOBAL]) {
			for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
				strictEqual(storage.keys(scope, target).length, 0);
			}
		}

		// Add values
		for (const scope of [StorageScope.WORKSPACE, StorageScope.GLOBAL]) {
			for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
				storageTargetEvent = Object.create(null);
				storageValueChangeEvent = Object.create(null);

				storage.store('test.target1', 'value1', scope, target);
				strictEqual(storage.keys(scope, target).length, 1);
				equal(storageTargetEvent?.scope, scope);
				equal(storageValueChangeEvent?.key, 'test.target1');
				equal(storageValueChangeEvent?.scope, scope);
				equal(storageValueChangeEvent?.target, target);

				storageTargetEvent = undefined;
				storageValueChangeEvent = Object.create(null);

				storage.store('test.target1', 'otherValue1', scope, target);
				strictEqual(storage.keys(scope, target).length, 1);
				equal(storageTargetEvent, undefined);
				equal(storageValueChangeEvent?.key, 'test.target1');
				equal(storageValueChangeEvent?.scope, scope);
				equal(storageValueChangeEvent?.target, target);

				storage.store('test.target2', 'value2', scope, target);
				storage.store('test.target3', 'value3', scope, target);

				strictEqual(storage.keys(scope, target).length, 3);
			}
		}

		// Remove values
		for (const scope of [StorageScope.WORKSPACE, StorageScope.GLOBAL]) {
			for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
				const keysLength = storage.keys(scope, target).length;

				storage.store('test.target4', 'value1', scope, target);
				strictEqual(storage.keys(scope, target).length, keysLength + 1);

				storageTargetEvent = Object.create(null);
				storageValueChangeEvent = Object.create(null);

				storage.remove('test.target4', scope);
				strictEqual(storage.keys(scope, target).length, keysLength);
				equal(storageTargetEvent?.scope, scope);
				equal(storageValueChangeEvent?.key, 'test.target4');
				equal(storageValueChangeEvent?.scope, scope);
			}
		}

		// Remove all
		for (const scope of [StorageScope.WORKSPACE, StorageScope.GLOBAL]) {
			for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
				const keys = storage.keys(scope, target);

				for (const key of keys) {
					storage.remove(key, scope);
				}

				strictEqual(storage.keys(scope, target).length, 0);
			}
		}

		// Adding undefined or null removes value
		for (const scope of [StorageScope.WORKSPACE, StorageScope.GLOBAL]) {
			for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
				storage.store('test.target1', 'value1', scope, target);
				strictEqual(storage.keys(scope, target).length, 1);

				storageTargetEvent = Object.create(null);

				storage.store('test.target1', undefined, scope, target);
				strictEqual(storage.keys(scope, target).length, 0);
				equal(storageTargetEvent?.scope, scope);

				storage.store('test.target1', '', scope, target);
				strictEqual(storage.keys(scope, target).length, 1);

				storage.store('test.target1', null, scope, target);
				strictEqual(storage.keys(scope, target).length, 0);
			}
		}

		// Target change
		storageTargetEvent = undefined;
		storage.store('test.target5', 'value1', StorageScope.GLOBAL, StorageTarget.MACHINE);
		ok(storageTargetEvent);
		storageTargetEvent = undefined;
		storage.store('test.target5', 'value1', StorageScope.GLOBAL, StorageTarget.USER);
		ok(storageTargetEvent);
		storageTargetEvent = undefined;
		storage.store('test.target5', 'value1', StorageScope.GLOBAL, StorageTarget.MACHINE);
		ok(storageTargetEvent);
		storageTargetEvent = undefined;
		storage.store('test.target5', 'value1', StorageScope.GLOBAL, StorageTarget.MACHINE);
		ok(!storageTargetEvent); // no change in target
	});
});
