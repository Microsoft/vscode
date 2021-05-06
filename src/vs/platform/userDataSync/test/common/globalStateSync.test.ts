/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncStoreService, IUserDataSyncService, SyncResource, SyncStatus, IGlobalState, ISyncData } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { GlobalStateSynchroniser } from 'vs/platform/userDataSync/common/globalStateSync';
import { VSBuffer } from 'vs/base/common/buffer';


suite('GlobalStateSync', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let testClient: UserDataSyncClient;
	let client2: UserDataSyncClient;

	let testObject: GlobalStateSynchroniser;

	setup(async () => {
		testClient = disposableStore.add(new UserDataSyncClient(server));
		await testClient.setUp(true);
		testObject = (testClient.instantiationService.get(IUserDataSyncService) as UserDataSyncService).getSynchroniser(SyncResource.GlobalState) as GlobalStateSynchroniser;
		disposableStore.add(toDisposable(() => testClient.instantiationService.get(IUserDataSyncStoreService).clear()));

		client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
	});

	teardown(() => disposableStore.clear());

	test('when global state does not exist', async () => {
		assert.deepStrictEqual(await testObject.getLastSyncUserData(), null);
		let manifest = await testClient.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepStrictEqual(server.requests, [
			{ type: 'GET', url: `${server.url}/v1/resource/${testObject.resource}/latest`, headers: {} },
		]);

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepStrictEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepStrictEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.strictEqual(lastSyncUserData!.syncData, null);

		manifest = await testClient.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepStrictEqual(server.requests, []);

		manifest = await testClient.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepStrictEqual(server.requests, []);
	});

	test('when global state is created after first sync', async () => {
		await testObject.sync(await testClient.manifest());
		updateUserStorage('a', 'value1', testClient);

		let lastSyncUserData = await testObject.getLastSyncUserData();
		const manifest = await testClient.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepStrictEqual(server.requests, [
			{ type: 'POST', url: `${server.url}/v1/resource/${testObject.resource}`, headers: { 'If-Match': lastSyncUserData?.ref } },
		]);

		lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepStrictEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepStrictEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.deepStrictEqual(JSON.parse(lastSyncUserData!.syncData!.content).storage, { 'a': { version: 1, value: 'value1' } });
	});

	test('first time sync - outgoing to server (no state)', async () => {
		updateUserStorage('a', 'value1', testClient);
		updateMachineStorage('b', 'value1', testClient);
		await updateLocale(testClient);

		await testObject.sync(await testClient.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseGlobalState(content!);
		assert.deepStrictEqual(actual.storage, { 'globalState.argv.locale': { version: 1, value: 'en' }, 'a': { version: 1, value: 'value1' } });
	});

	test('first time sync - incoming from server (no state)', async () => {
		updateUserStorage('a', 'value1', client2);
		await updateLocale(client2);
		await client2.sync();

		await testObject.sync(await testClient.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		assert.strictEqual(readStorage('a', testClient), 'value1');
		assert.strictEqual(await readLocale(testClient), 'en');
	});

	test('first time sync when storage exists', async () => {
		updateUserStorage('a', 'value1', client2);
		await client2.sync();

		updateUserStorage('b', 'value2', testClient);
		await testObject.sync(await testClient.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		assert.strictEqual(readStorage('a', testClient), 'value1');
		assert.strictEqual(readStorage('b', testClient), 'value2');

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseGlobalState(content!);
		assert.deepStrictEqual(actual.storage, { 'a': { version: 1, value: 'value1' }, 'b': { version: 1, value: 'value2' } });
	});

	test('first time sync when storage exists - has conflicts', async () => {
		updateUserStorage('a', 'value1', client2);
		await client2.sync();

		updateUserStorage('a', 'value2', client2);
		await testObject.sync(await testClient.manifest());

		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		assert.strictEqual(readStorage('a', testClient), 'value1');

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseGlobalState(content!);
		assert.deepStrictEqual(actual.storage, { 'a': { version: 1, value: 'value1' } });
	});

	test('sync adding a storage value', async () => {
		updateUserStorage('a', 'value1', testClient);
		await testObject.sync(await testClient.manifest());

		updateUserStorage('b', 'value2', testClient);
		await testObject.sync(await testClient.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		assert.strictEqual(readStorage('a', testClient), 'value1');
		assert.strictEqual(readStorage('b', testClient), 'value2');

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseGlobalState(content!);
		assert.deepStrictEqual(actual.storage, { 'a': { version: 1, value: 'value1' }, 'b': { version: 1, value: 'value2' } });
	});

	test('sync updating a storage value', async () => {
		updateUserStorage('a', 'value1', testClient);
		await testObject.sync(await testClient.manifest());

		updateUserStorage('a', 'value2', testClient);
		await testObject.sync(await testClient.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		assert.strictEqual(readStorage('a', testClient), 'value2');

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseGlobalState(content!);
		assert.deepStrictEqual(actual.storage, { 'a': { version: 1, value: 'value2' } });
	});

	test('sync removing a storage value', async () => {
		updateUserStorage('a', 'value1', testClient);
		updateUserStorage('b', 'value2', testClient);
		await testObject.sync(await testClient.manifest());

		removeStorage('b', testClient);
		await testObject.sync(await testClient.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);

		assert.strictEqual(readStorage('a', testClient), 'value1');
		assert.strictEqual(readStorage('b', testClient), undefined);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseGlobalState(content!);
		assert.deepStrictEqual(actual.storage, { 'a': { version: 1, value: 'value1' } });
	});

	function parseGlobalState(content: string): IGlobalState {
		const syncData: ISyncData = JSON.parse(content);
		return JSON.parse(syncData.content);
	}

	async function updateLocale(client: UserDataSyncClient): Promise<void> {
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'en' })));
	}

	function updateUserStorage(key: string, value: string, client: UserDataSyncClient): void {
		const storageService = client.instantiationService.get(IStorageService);
		storageService.store(key, value, StorageScope.GLOBAL, StorageTarget.USER);
	}

	function updateMachineStorage(key: string, value: string, client: UserDataSyncClient): void {
		const storageService = client.instantiationService.get(IStorageService);
		storageService.store(key, value, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	function removeStorage(key: string, client: UserDataSyncClient): void {
		const storageService = client.instantiationService.get(IStorageService);
		storageService.remove(key, StorageScope.GLOBAL);
	}

	function readStorage(key: string, client: UserDataSyncClient): string | undefined {
		const storageService = client.instantiationService.get(IStorageService);
		return storageService.get(key, StorageScope.GLOBAL);
	}

	async function readLocale(client: UserDataSyncClient): Promise<string | undefined> {
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		const content = await fileService.readFile(environmentService.argvResource);
		return JSON.parse(content.value.toString()).locale;
	}

});
