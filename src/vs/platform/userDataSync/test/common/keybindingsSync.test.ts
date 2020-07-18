/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncStoreService, IUserDataSyncService, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { KeybindingsSynchroniser } from 'vs/platform/userDataSync/common/keybindingsSync';
import { VSBuffer } from 'vs/base/common/buffer';

suite('KeybindingsSync', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let client: UserDataSyncClient;

	let testObject: KeybindingsSynchroniser;

	setup(async () => {
		client = disposableStore.add(new UserDataSyncClient(server));
		await client.setUp(true);
		testObject = (client.instantiationService.get(IUserDataSyncService) as UserDataSyncService).getSynchroniser(SyncResource.Keybindings) as KeybindingsSynchroniser;
		disposableStore.add(toDisposable(() => client.instantiationService.get(IUserDataSyncStoreService).clear()));
	});

	teardown(() => disposableStore.clear());

	test('when keybindings file does not exist', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;

		assert.deepEqual(await testObject.getLastSyncUserData(), null);
		let manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepEqual(server.requests, [
			{ type: 'GET', url: `${server.url}/v1/resource/${testObject.resource}/latest`, headers: {} },
		]);
		assert.ok(!await fileService.exists(keybindingsResource));

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.equal(lastSyncUserData!.syncData, null);

		manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepEqual(server.requests, []);

		manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepEqual(server.requests, []);
	});

	test('when keybindings file is created after first sync', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		await testObject.sync(await client.manifest());
		await fileService.createFile(keybindingsResource, VSBuffer.fromString('[]'));

		let lastSyncUserData = await testObject.getLastSyncUserData();
		const manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepEqual(server.requests, [
			{ type: 'POST', url: `${server.url}/v1/resource/${testObject.resource}`, headers: { 'If-Match': lastSyncUserData?.ref } },
		]);

		lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.equal(testObject.getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!), '[]');
	});

});
