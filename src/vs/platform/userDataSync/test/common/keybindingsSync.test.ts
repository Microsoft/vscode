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
import { getKeybindingsContentFromSyncContent, KeybindingsSynchroniser } from 'vs/platform/userDataSync/common/keybindingsSync';
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

		assert.deepStrictEqual(await testObject.getLastSyncUserData(), null);
		let manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepStrictEqual(server.requests, [
			{ type: 'GET', url: `${server.url}/v1/resource/${testObject.resource}/latest`, headers: {} },
		]);
		assert.ok(!await fileService.exists(keybindingsResource));

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepStrictEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepStrictEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.strictEqual(lastSyncUserData!.syncData, null);

		manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepStrictEqual(server.requests, []);

		manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepStrictEqual(server.requests, []);
	});

	test('when keybindings file is empty and remote has no changes', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		await fileService.writeFile(keybindingsResource, VSBuffer.fromString(''));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!, true), '[]');
		assert.strictEqual(getKeybindingsContentFromSyncContent(remoteUserData!.syncData!.content!, true), '[]');
		assert.strictEqual((await fileService.readFile(keybindingsResource)).value.toString(), '');
	});

	test('when keybindings file is empty and remote has changes', async () => {
		const client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
		const content = JSON.stringify([
			{
				'key': 'shift+cmd+w',
				'command': 'workbench.action.closeAllEditors',
			}
		]);
		await client2.instantiationService.get(IFileService).writeFile(client2.instantiationService.get(IEnvironmentService).keybindingsResource, VSBuffer.fromString(content));
		await client2.sync();

		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		await fileService.writeFile(keybindingsResource, VSBuffer.fromString(''));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!, true), content);
		assert.strictEqual(getKeybindingsContentFromSyncContent(remoteUserData!.syncData!.content!, true), content);
		assert.strictEqual((await fileService.readFile(keybindingsResource)).value.toString(), content);
	});

	test('when keybindings file is empty with comment and remote has no changes', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		const expectedContent = '// Empty Keybindings';
		await fileService.writeFile(keybindingsResource, VSBuffer.fromString(expectedContent));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!, true), expectedContent);
		assert.strictEqual(getKeybindingsContentFromSyncContent(remoteUserData!.syncData!.content!, true), expectedContent);
		assert.strictEqual((await fileService.readFile(keybindingsResource)).value.toString(), expectedContent);
	});

	test('when keybindings file is empty and remote has keybindings', async () => {
		const client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
		const content = JSON.stringify([
			{
				'key': 'shift+cmd+w',
				'command': 'workbench.action.closeAllEditors',
			}
		]);
		await client2.instantiationService.get(IFileService).writeFile(client2.instantiationService.get(IEnvironmentService).keybindingsResource, VSBuffer.fromString(content));
		await client2.sync();

		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		await fileService.writeFile(keybindingsResource, VSBuffer.fromString('// Empty Keybindings'));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!, true), content);
		assert.strictEqual(getKeybindingsContentFromSyncContent(remoteUserData!.syncData!.content!, true), content);
		assert.strictEqual((await fileService.readFile(keybindingsResource)).value.toString(), content);
	});

	test('when keybindings file is empty and remote has empty array', async () => {
		const client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
		const content =
			`// Place your key bindings in this file to override the defaults
[
]`;
		await client2.instantiationService.get(IFileService).writeFile(client2.instantiationService.get(IEnvironmentService).keybindingsResource, VSBuffer.fromString(content));
		await client2.sync();

		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		const expectedLocalContent = '// Empty Keybindings';
		await fileService.writeFile(keybindingsResource, VSBuffer.fromString(expectedLocalContent));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!, true), content);
		assert.strictEqual(getKeybindingsContentFromSyncContent(remoteUserData!.syncData!.content!, true), content);
		assert.strictEqual((await fileService.readFile(keybindingsResource)).value.toString(), expectedLocalContent);
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

		assert.deepStrictEqual(server.requests, [
			{ type: 'POST', url: `${server.url}/v1/resource/${testObject.resource}`, headers: { 'If-Match': lastSyncUserData?.ref } },
		]);

		lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepStrictEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepStrictEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.strictEqual(getKeybindingsContentFromSyncContent(lastSyncUserData!.syncData!.content!, true), '[]');
	});

	test('test apply remote when keybindings file does not exist', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const keybindingsResource = client.instantiationService.get(IEnvironmentService).keybindingsResource;
		if (await fileService.exists(keybindingsResource)) {
			await fileService.del(keybindingsResource);
		}

		const preview = (await testObject.preview(await client.manifest()))!;

		server.reset();
		const content = await testObject.resolveContent(preview.resourcePreviews[0].remoteResource);
		await testObject.accept(preview.resourcePreviews[0].remoteResource, content);
		await testObject.apply(false);
		assert.deepStrictEqual(server.requests, []);
	});

});
