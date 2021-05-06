/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { UserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IUserDataSyncService, SyncResource, UserDataAutoSyncError, UserDataSyncErrorCode, UserDataSyncStoreError } from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { VSBuffer } from 'vs/base/common/buffer';
import { joinPath } from 'vs/base/common/resources';
import { IUserDataSyncMachinesService } from 'vs/platform/userDataSync/common/userDataSyncMachines';

class TestUserDataAutoSyncService extends UserDataAutoSyncService {
	protected override startAutoSync(): boolean { return false; }
	protected override getSyncTriggerDelayTime(): number { return 50; }

	sync(): Promise<void> {
		return this.triggerSync(['sync'], false, false);
	}
}

suite('UserDataAutoSyncService', () => {

	const disposableStore = new DisposableStore();

	teardown(() => disposableStore.clear());

	test('test auto sync with sync resource change triggers sync', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();

		// Sync once and reset requests
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();
		target.reset();

		const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Trigger auto sync with settings change
		await testObject.triggerSync([SyncResource.Settings], false, false);

		// Filter out machine requests
		const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

		// Make sure only one manifest request is made
		assert.deepStrictEqual(actual, [{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }]);
	});

	test('test auto sync with sync resource change triggers sync for every change', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();

		// Sync once and reset requests
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();
		target.reset();

		const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Trigger auto sync with settings change multiple times
		for (let counter = 0; counter < 2; counter++) {
			await testObject.triggerSync([SyncResource.Settings], false, false);
		}

		// Filter out machine requests
		const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

		assert.deepStrictEqual(actual, [
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }
		]);
	});

	test('test auto sync with non sync resource change triggers sync', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();

		// Sync once and reset requests
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();
		target.reset();

		const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Trigger auto sync with window focus once
		await testObject.triggerSync(['windowFocus'], true, false);

		// Filter out machine requests
		const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

		// Make sure only one manifest request is made
		assert.deepStrictEqual(actual, [{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }]);
	});

	test('test auto sync with non sync resource change does not trigger continuous syncs', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();

		// Sync once and reset requests
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();
		target.reset();

		const testObject: UserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Trigger auto sync with window focus multiple times
		for (let counter = 0; counter < 2; counter++) {
			await testObject.triggerSync(['windowFocus'], true, false);
		}

		// Filter out machine requests
		const actual = target.requests.filter(request => !request.url.startsWith(`${target.url}/v1/resource/machines`));

		// Make sure only one manifest request is made
		assert.deepStrictEqual(actual, [{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }]);
	});

	test('test first auto sync requests', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		await testObject.sync();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Machines
			{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: {} },
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
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Machines
			{ type: 'POST', url: `${target.url}/v1/resource/machines`, headers: { 'If-Match': '0' } }
		]);

	});

	test('test further auto sync requests without changes', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Sync once and reset requests
		await testObject.sync();
		target.reset();

		await testObject.sync();

		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} }
		]);

	});

	test('test further auto sync requests with changes', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Sync once and reset requests
		await testObject.sync();
		target.reset();

		// Do changes in the client
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({ 'editor.fontSize': 14 })));
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify([{ 'command': 'abcd', 'key': 'cmd+c' }])));
		await fileService.writeFile(joinPath(environmentService.snippetsHome, 'html.json'), VSBuffer.fromString(`{}`));
		await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'de' })));
		await testObject.sync();

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

	test('test auto sync send execution id header', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(client.instantiationService.createInstance(TestUserDataAutoSyncService));

		// Sync once and reset requests
		await testObject.sync();
		target.reset();

		await testObject.sync();

		for (const request of target.requestsWithAllHeaders) {
			const hasExecutionIdHeader = request.headers && request.headers['X-Execution-Id'] && request.headers['X-Execution-Id'].length > 0;
			if (request.url.startsWith(`${target.url}/v1/resource/machines`)) {
				assert.ok(!hasExecutionIdHeader, `Should not have execution header: ${request.url}`);
			} else {
				assert.ok(hasExecutionIdHeader, `Should have execution header: ${request.url}`);
			}
		}

	});

	test('test delete on one client throws turned off error on other client while syncing', async () => {
		const target = new UserDataSyncTestServer();

		// Set up and sync from the client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
		await testObject.sync();

		// Reset from the first client
		await client.instantiationService.get(IUserDataSyncService).reset();

		// Sync from the test client
		target.reset();

		const errorPromise = Event.toPromise(testObject.onError);
		await testObject.sync();

		const e = await errorPromise;
		assert.ok(e instanceof UserDataAutoSyncError);
		assert.deepStrictEqual((<UserDataAutoSyncError>e).code, UserDataSyncErrorCode.TurnedOff);
		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Machine
			{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: { 'If-None-Match': '1' } },
		]);
	});

	test('test disabling the machine turns off sync', async () => {
		const target = new UserDataSyncTestServer();

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
		await testObject.sync();

		// Disable current machine
		const userDataSyncMachinesService = testClient.instantiationService.get(IUserDataSyncMachinesService);
		const machines = await userDataSyncMachinesService.getMachines();
		const currentMachine = machines.find(m => m.isCurrent)!;
		await userDataSyncMachinesService.setEnablement(currentMachine.id, false);

		target.reset();

		const errorPromise = Event.toPromise(testObject.onError);
		await testObject.sync();

		const e = await errorPromise;
		assert.ok(e instanceof UserDataAutoSyncError);
		assert.deepStrictEqual((<UserDataAutoSyncError>e).code, UserDataSyncErrorCode.TurnedOff);
		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Machine
			{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: { 'If-None-Match': '2' } },
			{ type: 'POST', url: `${target.url}/v1/resource/machines`, headers: { 'If-Match': '2' } },
		]);
	});

	test('test removing the machine adds machine back', async () => {
		const target = new UserDataSyncTestServer();

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
		await testObject.sync();

		// Remove current machine
		await testClient.instantiationService.get(IUserDataSyncMachinesService).removeCurrentMachine();

		target.reset();

		await testObject.sync();
		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Machine
			{ type: 'POST', url: `${target.url}/v1/resource/machines`, headers: { 'If-Match': '2' } },
		]);
	});

	test('test creating new session from one client throws session expired error on another client while syncing', async () => {
		const target = new UserDataSyncTestServer();

		// Set up and sync from the client
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));
		await testObject.sync();

		// Reset from the first client
		await client.instantiationService.get(IUserDataSyncService).reset();

		// Sync again from the first client to create new session
		await (await client.instantiationService.get(IUserDataSyncService).createSyncTask()).run();

		// Sync from the test client
		target.reset();

		const errorPromise = Event.toPromise(testObject.onError);
		await testObject.sync();

		const e = await errorPromise;
		assert.ok(e instanceof UserDataAutoSyncError);
		assert.deepStrictEqual((<UserDataAutoSyncError>e).code, UserDataSyncErrorCode.SessionExpired);
		assert.deepStrictEqual(target.requests, [
			// Manifest
			{ type: 'GET', url: `${target.url}/v1/manifest`, headers: {} },
			// Machine
			{ type: 'GET', url: `${target.url}/v1/resource/machines/latest`, headers: { 'If-None-Match': '1' } },
		]);
	});

	test('test rate limit on server', async () => {
		const target = new UserDataSyncTestServer(5);

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

		const errorPromise = Event.toPromise(testObject.onError);
		while (target.requests.length < 5) {
			await testObject.sync();
		}

		const e = await errorPromise;
		assert.ok(e instanceof UserDataSyncStoreError);
		assert.deepStrictEqual((<UserDataSyncStoreError>e).code, UserDataSyncErrorCode.TooManyRequests);
	});

	test('test auto sync is suspended when server donot accepts requests', async () => {
		const target = new UserDataSyncTestServer(5, 1);

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

		while (target.requests.length < 5) {
			await testObject.sync();
		}

		target.reset();
		await testObject.sync();

		assert.deepStrictEqual(target.requests, []);
	});

	test('test cache control header with no cache is sent when triggered with disable cache option', async () => {
		const target = new UserDataSyncTestServer(5, 1);

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

		await testObject.triggerSync(['some reason'], true, true);
		assert.strictEqual(target.requestsWithAllHeaders[0].headers!['Cache-Control'], 'no-cache');
	});

	test('test cache control header is not sent when triggered without disable cache option', async () => {
		const target = new UserDataSyncTestServer(5, 1);

		// Set up and sync from the test client
		const testClient = disposableStore.add(new UserDataSyncClient(target));
		await testClient.setUp();
		const testObject: TestUserDataAutoSyncService = disposableStore.add(testClient.instantiationService.createInstance(TestUserDataAutoSyncService));

		await testObject.triggerSync(['some reason'], true, false);
		assert.strictEqual(target.requestsWithAllHeaders[0].headers!['Cache-Control'], undefined);
	});

});
