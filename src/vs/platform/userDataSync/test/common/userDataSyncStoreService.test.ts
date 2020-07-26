/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncStoreService, SyncResource, UserDataSyncErrorCode, UserDataSyncStoreError } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IProductService } from 'vs/platform/product/common/productService';
import { isWeb } from 'vs/base/common/platform';
import { RequestsSession, UserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IRequestService } from 'vs/platform/request/common/request';
import { newWriteableBufferStream } from 'vs/base/common/buffer';
import { timeout } from 'vs/base/common/async';
import { NullLogService } from 'vs/platform/log/common/log';
import { Event } from 'vs/base/common/event';

suite('UserDataSyncStoreService', () => {

	const disposableStore = new DisposableStore();

	teardown(() => disposableStore.clear());

	test('test read manifest for the first time', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);
		const productService = client.instantiationService.get(IProductService);

		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Client-Name'], `${productService.applicationName}${isWeb ? '-web' : ''}`);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Client-Version'], productService.version);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Id'], undefined);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test read manifest for the second time when session is not yet created', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];

		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test session id header is not set in the first manifest request after session is created', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		await testObject.write(SyncResource.Settings, 'some content', null);

		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test session id header is set from the second manifest request after session is created', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();

		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test headers are send for write request', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		await testObject.manifest();

		target.reset();
		await testObject.write(SyncResource.Settings, 'some content', null);

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test headers are send for read request', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		await testObject.manifest();

		target.reset();
		await testObject.read(SyncResource.Settings, null);

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test headers are reset after session is cleared ', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		await testObject.manifest();
		await testObject.clear();

		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test old headers are sent after session is changed on server ', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		target.reset();
		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		const userSessionId = target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'];
		await target.clear();

		// client 2
		const client2 = disposableStore.add(new UserDataSyncClient(target));
		await client2.setUp();
		const testObject2 = client2.instantiationService.get(IUserDataSyncStoreService);
		await testObject2.write(SyncResource.Settings, 'some content', null);

		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], userSessionId);
	});

	test('test old headers are reset from second request after session is changed on server ', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		target.reset();
		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		const userSessionId = target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'];
		await target.clear();

		// client 2
		const client2 = disposableStore.add(new UserDataSyncClient(target));
		await client2.setUp();
		const testObject2 = client2.instantiationService.get(IUserDataSyncStoreService);
		await testObject2.write(SyncResource.Settings, 'some content', null);

		await testObject.manifest();
		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], userSessionId);
	});

	test('test old headers are sent after session is cleared from another server ', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		target.reset();
		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		const userSessionId = target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'];

		// client 2
		const client2 = disposableStore.add(new UserDataSyncClient(target));
		await client2.setUp();
		const testObject2 = client2.instantiationService.get(IUserDataSyncStoreService);
		await testObject2.clear();

		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], userSessionId);
	});

	test('test headers are reset after session is cleared from another server ', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		target.reset();
		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];

		// client 2
		const client2 = disposableStore.add(new UserDataSyncClient(target));
		await client2.setUp();
		const testObject2 = client2.instantiationService.get(IUserDataSyncStoreService);
		await testObject2.clear();

		await testObject.manifest();
		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.equal(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test headers are reset after session is cleared from another server - started syncing again', async () => {
		// Setup the client
		const target = new UserDataSyncTestServer();
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		target.reset();
		await testObject.manifest();
		const machineSessionId = target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'];
		const userSessionId = target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'];

		// client 2
		const client2 = disposableStore.add(new UserDataSyncClient(target));
		await client2.setUp();
		const testObject2 = client2.instantiationService.get(IUserDataSyncStoreService);
		await testObject2.clear();

		await testObject.manifest();
		await testObject.write(SyncResource.Settings, 'some content', null);
		await testObject.manifest();
		target.reset();
		await testObject.manifest();

		assert.equal(target.requestsWithAllHeaders.length, 1);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], undefined);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-Machine-Session-Id'], machineSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], userSessionId);
		assert.notEqual(target.requestsWithAllHeaders[0].headers!['X-User-Session-Id'], undefined);
	});

	test('test rate limit on server with retry after', async () => {
		const target = new UserDataSyncTestServer(1, 1);
		const client = disposableStore.add(new UserDataSyncClient(target));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();

		const promise = Event.toPromise(testObject.onDidChangeDonotMakeRequestsUntil);
		try {
			await testObject.manifest();
			assert.fail('should fail');
		} catch (e) {
			assert.ok(e instanceof UserDataSyncStoreError);
			assert.deepEqual((<UserDataSyncStoreError>e).code, UserDataSyncErrorCode.TooManyRequestsAndRetryAfter);
			await promise;
			assert.ok(!!testObject.donotMakeRequestsUntil);
		}
	});

	test('test donotMakeRequestsUntil is reset after retry time is finished', async () => {
		const client = disposableStore.add(new UserDataSyncClient(new UserDataSyncTestServer(1, 0.25)));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		try {
			await testObject.manifest();
		} catch (e) { }

		const promise = Event.toPromise(testObject.onDidChangeDonotMakeRequestsUntil);
		await timeout(300);
		await promise;
		assert.ok(!testObject.donotMakeRequestsUntil);
	});

	test('test donotMakeRequestsUntil is retrieved', async () => {
		const client = disposableStore.add(new UserDataSyncClient(new UserDataSyncTestServer(1, 1)));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		try {
			await testObject.manifest();
		} catch (e) { }

		const target = client.instantiationService.createInstance(UserDataSyncStoreService);
		assert.equal(target.donotMakeRequestsUntil?.getTime(), testObject.donotMakeRequestsUntil?.getTime());
	});

	test('test donotMakeRequestsUntil is checked and reset after retreived', async () => {
		const client = disposableStore.add(new UserDataSyncClient(new UserDataSyncTestServer(1, 0.25)));
		await client.setUp();
		const testObject = client.instantiationService.get(IUserDataSyncStoreService);

		await testObject.manifest();
		try {
			await testObject.manifest();
		} catch (e) { }

		await timeout(300);
		const target = client.instantiationService.createInstance(UserDataSyncStoreService);
		assert.ok(!target.donotMakeRequestsUntil);
	});

});

suite('UserDataSyncRequestsSession', () => {

	const requestService: IRequestService = {
		_serviceBrand: undefined,
		async request() { return { res: { headers: {} }, stream: newWriteableBufferStream() }; },
		async resolveProxy() { return undefined; }
	};

	test('too many requests are thrown when limit exceeded', async () => {
		const testObject = new RequestsSession(1, 500, requestService, new NullLogService());
		await testObject.request({}, CancellationToken.None);

		try {
			await testObject.request({}, CancellationToken.None);
		} catch (error) {
			assert.ok(error instanceof UserDataSyncStoreError);
			assert.equal((<UserDataSyncStoreError>error).code, UserDataSyncErrorCode.LocalTooManyRequests);
			return;
		}
		assert.fail('Should fail with limit exceeded');
	});

	test('requests are handled after session is expired', async () => {
		const testObject = new RequestsSession(1, 500, requestService, new NullLogService());
		await testObject.request({}, CancellationToken.None);
		await timeout(600);
		await testObject.request({}, CancellationToken.None);
	});

	test('too many requests are thrown after session is expired', async () => {
		const testObject = new RequestsSession(1, 500, requestService, new NullLogService());
		await testObject.request({}, CancellationToken.None);
		await timeout(600);
		await testObject.request({}, CancellationToken.None);

		try {
			await testObject.request({}, CancellationToken.None);
		} catch (error) {
			assert.ok(error instanceof UserDataSyncStoreError);
			assert.equal((<UserDataSyncStoreError>error).code, UserDataSyncErrorCode.LocalTooManyRequests);
			return;
		}
		assert.fail('Should fail with limit exceeded');
	});

});
