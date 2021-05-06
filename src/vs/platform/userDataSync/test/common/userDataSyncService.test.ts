/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncService, SyncStatus, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { VSBuffer } from 'vs/base/common/buffer';
import { joinPath } from 'vs/base/common/resources';

suite('UserDataSyncService', () => {

	const disposableStore = new DisposableStore();

	teardown(() => disposableStore.clear());

	test('test first time sync ever', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncService);

		// Sync for first time
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Settings
			{ type: 'GET', url: `${target.url}/v1/resource/settings/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/settings`, headers: { 'If-Match': '0' } },
			// Keybindings
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/keybindings`, headers: { 'If-Match': '0' } },
			// Snippets
			{ type: 'GET', url: `${target.url}/v1/resource/snippets/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/snippets`, headers: { 'If-Match': '0' } },
			// Global state
			{ type: 'GET', url: `${target.url}/v1/resource/globalState/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/globalState`, headers: { 'If-Match': '0' } },
			// Extensions
			{ type: 'GET', url: `${target.url}/v1/resource/extensions/latest`, headers: {} },
		]);

	});

	test('test first time sync ever with no data', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp(true);
		const testObject = client.instantiationService.get(IUserDataSyncService);

		// Sync for first time
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Settings
			{ type: 'GET', url: `${target.url}/v1/resource/settings/latest`, headers: {} },
			// Keybindings
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: {} },
			// Snippets
			{ type: 'GET', url: `${target.url}/v1/resource/snippets/latest`, headers: {} },
			// Global state
			{ type: 'GET', url: `${target.url}/v1/resource/globalState/latest`, headers: {} },
			// Extensions
			{ type: 'GET', url: `${target.url}/v1/resource/extensions/latest`, headers: {} },
		]);

	});

	test('test first time sync from the client with no changes - merge', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the first client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Setup the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject = testClient.instantiationService.get(IUserDataSyncService);

		// Sync (merge) from the test client
		target.reset();
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/settings/latest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/snippets/latest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/globalState/latest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/extensions/latest`, headers: {} },
		]);

	});

	test('test first time sync from the client with changes - merge', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the first client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Setup the test client with changes
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const fileService = testClient.instantiationService.get(IFileService);
		const environmentService = testClient.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify([{ 'command': 'abcd', 'key': 'cmd+c' }])));
		await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'de' })));
		await fileService.writeFile(joinPath(environmentService.snippetsHome, 'html.json'), VSBuffer.fromString(`{}`));
		const testObject = testClient.instantiationService.get(IUserDataSyncService);

		// Sync (merge) from the test client
		target.reset();
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/settings/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/settings`, headers: { 'If-Match': '1' } },
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/keybindings`, headers: { 'If-Match': '1' } },
			{ type: 'GET', url: `${target.url}/v1/resource/snippets/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/snippets`, headers: { 'If-Match': '1' } },
			{ type: 'GET', url: `${target.url}/v1/resource/globalState/latest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/resource/extensions/latest`, headers: {} },
		]);

	});

	test('test sync when there are no changes', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncService);
		await (await testObject.createSyncTask()).run();

		// sync from the client again
		target.reset();
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
		]);
	});

	test('test sync when there are local changes', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncService);
		await (await testObject.createSyncTask()).run();
		target.reset();

		// Do changes in the client
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify([{ 'command': 'abcd', 'key': 'cmd+c' }])));
		await fileService.writeFile(joinPath(environmentService.snippetsHome, 'html.json'), VSBuffer.fromString(`{}`));
		await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'de' })));

		// Sync from the client
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Settings
			{ type: 'POST', url: `${target.url}/v1/resource/settings`, headers: { 'If-Match': '1' } },
			// Keybindings
			{ type: 'POST', url: `${target.url}/v1/resource/keybindings`, headers: { 'If-Match': '1' } },
			// Snippets
			{ type: 'POST', url: `${target.url}/v1/resource/snippets`, headers: { 'If-Match': '1' } },
			// Global state
			{ type: 'POST', url: `${target.url}/v1/resource/globalState`, headers: { 'If-Match': '1' } },
		]);
	});

	test('test sync when there are remote changes', async () => {
		const target = new UserDataSyncTestServer();

		// Sync from first client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Sync from test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject = testClient.instantiationService.get(IUserDataSyncService);
		await (await testObject.createSyncTask()).run();

		// Do changes in first client and sync
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify([{ 'command': 'abcd', 'key': 'cmd+c' }])));
		await fileService.writeFile(joinPath(environmentService.snippetsHome, 'html.json'), VSBuffer.fromString(`{ "a": "changed" }`));
		await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'de' })));
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Sync from test client
		target.reset();
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Settings
			{ type: 'GET', url: `${target.url}/v1/resource/settings/latest`, headers: { 'If-None-Match': '1' } },
			// Keybindings
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: { 'If-None-Match': '1' } },
			// Snippets
			{ type: 'GET', url: `${target.url}/v1/resource/snippets/latest`, headers: { 'If-None-Match': '1' } },
			// Global state
			{ type: 'GET', url: `${target.url}/v1/resource/globalState/latest`, headers: { 'If-None-Match': '1' } },
		]);

	});

	test('test delete', async () => {
		const target = new UserDataSyncTestServer();

		// Sync from the client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject = testClient.instantiationService.get(IUserDataSyncService);
		await (await testObject.createSyncTask()).run();

		// Reset from the client
		target.reset();
		await testObject.reset();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'DELETE', url: `${target.url}/v1/resource`, headers: {} },
		]);

	});

	test('test delete and sync', async () => {
		const target = new UserDataSyncTestServer();

		// Sync from the client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject = testClient.instantiationService.get(IUserDataSyncService);
		await (await testObject.createSyncTask()).run();

		// Reset from the client
		await testObject.reset();

		// Sync again
		target.reset();
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Settings
			{ type: 'GET', url: `${target.url}/v1/resource/settings/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/settings`, headers: { 'If-Match': '0' } },
			// Keybindings
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/keybindings`, headers: { 'If-Match': '0' } },
			// Snippets
			{ type: 'GET', url: `${target.url}/v1/resource/snippets/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/snippets`, headers: { 'If-Match': '0' } },
			// Global state
			{ type: 'GET', url: `${target.url}/v1/resource/globalState/latest`, headers: {} },
			{ type: 'POST', url: `${target.url}/v1/resource/globalState`, headers: { 'If-Match': '0' } },
			// Extensions
			{ type: 'GET', url: `${target.url}/v1/resource/extensions/latest`, headers: {} },
		]);

	});

	test('test sync status', async () => {
		const target = new UserDataSyncTestServer();

		// Setup the client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncService);

		// sync from the client
		const actualStatuses: SyncStatus[] = [];
		const disposable = testObject.onDidChangeStatus(status => actualStatuses.push(status));
		await (await testObject.createSyncTask()).run();

		disposable.dispose();
		assert.deepStrictEqual(actualStatuses, [SyncStatus.Syncing, SyncStatus.Idle, SyncStatus.Syncing, SyncStatus.Idle, SyncStatus.Syncing, SyncStatus.Idle, SyncStatus.Syncing, SyncStatus.Idle, SyncStatus.Syncing, SyncStatus.Idle]);
	});

	test('test sync conflicts status', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the first client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		let fileService = client.instantiationService.get(IFileService);
		let environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Setup the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		fileService = testClient.instantiationService.get(IFileService);
		environmentService = testClient.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 16 })));
		const testObject = testClient.instantiationService.get(IUserDataSyncService);

		// sync from the client
		await (await testObject.createSyncTask()).run();

		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);
		assert.deepStrictEqual(testObject.conflicts.map(([syncResource]) => syncResource), [SyncResource.Settings]);
	});

	test('test sync will sync other non conflicted areas', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the first client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		let fileService = client.instantiationService.get(IFileService);
		let environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Setup the test client and get conflicts in settings
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		let testFileService = testClient.instantiationService.get(IFileService);
		let testEnvironmentService = testClient.instantiationService.get(IEnvironmentService);
		await testFileService.writeFile(testEnvironmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 16 })));
		const testObject = testClient.instantiationService.get(IUserDataSyncService);
		await (await testObject.createSyncTask()).run();

		// sync from the first client with changes in keybindings
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify([{ 'command': 'abcd', 'key': 'cmd+c' }])));
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// sync from the test client
		target.reset();
		const actualStatuses: SyncStatus[] = [];
		const disposable = testObject.onDidChangeStatus(status => actualStatuses.push(status));
		await (await testObject.createSyncTask()).run();

		disposable.dispose();
		assert.deepStrictEqual(actualStatuses, []);
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Keybindings
			{ type: 'GET', url: `${target.url}/v1/resource/keybindings/latest`, headers: { 'If-None-Match': '1' } },
		]);
	});

	test('test stop sync reset status', async () => {
		const target = new UserDataSyncTestServer();

		// Setup and sync from the first client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		let fileService = client.instantiationService.get(IFileService);
		let environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Setup the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		fileService = testClient.instantiationService.get(IFileService);
		environmentService = testClient.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 16 })));
		const testObject = testClient.instantiationService.get(IUserDataSyncService);


		const syncTask = (await testObject.createSyncTask());
		syncTask.run().then(null, () => null /* ignore error */);
		await syncTask.stop();

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.deepStrictEqual(testObject.conflicts, []);
	});

	test('test sync send execution id header', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncService);

		await (await testObject.createSyncTask()).run();

		for (const request of target.requestsWithAllHeaders) {
			const hasExecutionIdHeader = request.headers && request.headers['X-Execution-Id'] && request.headers['X-Execution-Id'].length > 0;
			assert.ok(hasExecutionIdHeader, `Should have execution header: ${request.url}`);
		}

	});

	test('test can run sync taks only once', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncService);

		const syncTask = await testObject.createSyncTask();
		await syncTask.run();

		try {
			await syncTask.run();
			assert.fail('Should fail running the task again');
		} catch (error) {
			/* expected */
		}
	});

});
