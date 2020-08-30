/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { TestExtensionService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { EnvironmentVariableService } from 'vs/workbench/contrib/terminal/common/environmentVariableService';
import { EnvironmentVariableMutatorType, IEnvironmentVariableMutator } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { Emitter } from 'vs/base/common/event';
import { IProcessEnvironment } from 'vs/base/common/platform';

class TestEnvironmentVariableService extends EnvironmentVariableService {
	persistCollections(): void { this._persistCollections(); }
	notifyCollectionUpdates(): void { this._notifyCollectionUpdates(); }
}

suite('EnvironmentVariable - EnvironmentVariableService', () => {
	let instantiationService: TestInstantiationService;
	let environmentVariableService: TestEnvironmentVariableService;
	let storageService: TestStorageService;
	let changeExtensionsEvent: Emitter<void>;

	setup(() => {
		changeExtensionsEvent = new Emitter<void>();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(IExtensionService, TestExtensionService);
		storageService = new TestStorageService();
		instantiationService.stub(IStorageService, storageService);
		instantiationService.stub(IExtensionService, TestExtensionService);
		instantiationService.stub(IExtensionService, 'onDidChangeExtensions', changeExtensionsEvent.event);
		instantiationService.stub(IExtensionService, 'getExtensions', [
			{ identifier: { value: 'ext1' } },
			{ identifier: { value: 'ext2' } },
			{ identifier: { value: 'ext3' } }
		]);

		environmentVariableService = instantiationService.createInstance(TestEnvironmentVariableService);
	});

	test('should persist collections to the storage service and be able to restore from them', () => {
		const collection = new Map<string, IEnvironmentVariableMutator>();
		collection.set('A', { value: 'a', type: EnvironmentVariableMutatorType.Replace });
		collection.set('B', { value: 'b', type: EnvironmentVariableMutatorType.Append });
		collection.set('C', { value: 'c', type: EnvironmentVariableMutatorType.Prepend });
		environmentVariableService.set('ext1', { map: collection, persistent: true });
		deepStrictEqual([...environmentVariableService.mergedCollection.map.entries()], [
			['A', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Replace, value: 'a' }]],
			['B', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Append, value: 'b' }]],
			['C', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Prepend, value: 'c' }]]
		]);

		// Persist with old service, create a new service with the same storage service to verify restore
		environmentVariableService.persistCollections();
		const service2: TestEnvironmentVariableService = instantiationService.createInstance(TestEnvironmentVariableService);
		deepStrictEqual([...service2.mergedCollection.map.entries()], [
			['A', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Replace, value: 'a' }]],
			['B', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Append, value: 'b' }]],
			['C', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Prepend, value: 'c' }]]
		]);
	});

	suite('mergedCollection', () => {
		test('should overwrite any other variable with the first extension that replaces', () => {
			const collection1 = new Map<string, IEnvironmentVariableMutator>();
			const collection2 = new Map<string, IEnvironmentVariableMutator>();
			const collection3 = new Map<string, IEnvironmentVariableMutator>();
			collection1.set('A', { value: 'a1', type: EnvironmentVariableMutatorType.Append });
			collection1.set('B', { value: 'b1', type: EnvironmentVariableMutatorType.Replace });
			collection2.set('A', { value: 'a2', type: EnvironmentVariableMutatorType.Replace });
			collection2.set('B', { value: 'b2', type: EnvironmentVariableMutatorType.Append });
			collection3.set('A', { value: 'a3', type: EnvironmentVariableMutatorType.Prepend });
			collection3.set('B', { value: 'b3', type: EnvironmentVariableMutatorType.Replace });
			environmentVariableService.set('ext1', { map: collection1, persistent: true });
			environmentVariableService.set('ext2', { map: collection2, persistent: true });
			environmentVariableService.set('ext3', { map: collection3, persistent: true });
			deepStrictEqual([...environmentVariableService.mergedCollection.map.entries()], [
				['A', [
					{ extensionIdentifier: 'ext2', type: EnvironmentVariableMutatorType.Replace, value: 'a2' },
					{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Append, value: 'a1' }
				]],
				['B', [{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Replace, value: 'b1' }]]
			]);
		});

		test('should correctly apply the environment values from multiple extension contributions in the correct order', () => {
			const collection1 = new Map<string, IEnvironmentVariableMutator>();
			const collection2 = new Map<string, IEnvironmentVariableMutator>();
			const collection3 = new Map<string, IEnvironmentVariableMutator>();
			collection1.set('A', { value: ':a1', type: EnvironmentVariableMutatorType.Append });
			collection2.set('A', { value: 'a2:', type: EnvironmentVariableMutatorType.Prepend });
			collection3.set('A', { value: 'a3', type: EnvironmentVariableMutatorType.Replace });
			environmentVariableService.set('ext1', { map: collection1, persistent: true });
			environmentVariableService.set('ext2', { map: collection2, persistent: true });
			environmentVariableService.set('ext3', { map: collection3, persistent: true });

			// The entries should be ordered in the order they are applied
			deepStrictEqual([...environmentVariableService.mergedCollection.map.entries()], [
				['A', [
					{ extensionIdentifier: 'ext3', type: EnvironmentVariableMutatorType.Replace, value: 'a3' },
					{ extensionIdentifier: 'ext2', type: EnvironmentVariableMutatorType.Prepend, value: 'a2:' },
					{ extensionIdentifier: 'ext1', type: EnvironmentVariableMutatorType.Append, value: ':a1' }
				]]
			]);

			// Verify the entries get applied to the environment as expected
			const env: IProcessEnvironment = { A: 'foo' };
			environmentVariableService.mergedCollection.applyToProcessEnvironment(env);
			deepStrictEqual(env, { A: 'a2:a3:a1' });
		});
	});
});
