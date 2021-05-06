/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncStoreService, SyncResource, SyncStatus, IUserDataSyncResourceEnablementService, IRemoteUserData, Change, USER_DATA_SYNC_SCHEME, IUserDataManifest, MergeState, IResourcePreview as IBaseResourcePreview } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { AbstractSynchroniser, IAcceptResult, IMergeResult, IResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { Barrier } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { VSBuffer } from 'vs/base/common/buffer';
import { isEqual, joinPath } from 'vs/base/common/resources';

interface ITestResourcePreview extends IResourcePreview {
	ref: string;
}

class TestSynchroniser extends AbstractSynchroniser {

	syncBarrier: Barrier = new Barrier();
	syncResult: { hasConflicts: boolean, hasError: boolean } = { hasConflicts: false, hasError: false };
	onDoSyncCall: Emitter<void> = this._register(new Emitter<void>());
	failWhenGettingLatestRemoteUserData: boolean = false;

	override readonly resource: SyncResource = SyncResource.Settings;
	protected readonly version: number = 1;

	private cancelled: boolean = false;
	readonly localResource = joinPath(this.environmentService.userRoamingDataHome, 'testResource.json');

	protected override getLatestRemoteUserData(manifest: IUserDataManifest | null, lastSyncUserData: IRemoteUserData | null): Promise<IRemoteUserData> {
		if (this.failWhenGettingLatestRemoteUserData) {
			throw new Error();
		}
		return super.getLatestRemoteUserData(manifest, lastSyncUserData);
	}

	protected override async doSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, apply: boolean): Promise<SyncStatus> {
		this.cancelled = false;
		this.onDoSyncCall.fire();
		await this.syncBarrier.wait();

		if (this.cancelled) {
			return SyncStatus.Idle;
		}

		return super.doSync(remoteUserData, lastSyncUserData, apply);
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<ITestResourcePreview[]> {
		if (this.syncResult.hasError) {
			throw new Error('failed');
		}

		let fileContent = null;
		try {
			fileContent = await this.fileService.readFile(this.localResource);
		} catch (error) { }

		return [{
			localResource: this.localResource,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.localResource.with(({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' })),
			remoteContent: remoteUserData.syncData ? remoteUserData.syncData.content : null,
			previewResource: this.localResource.with(({ scheme: USER_DATA_SYNC_SCHEME, authority: 'preview' })),
			ref: remoteUserData.ref,
			localChange: Change.Modified,
			remoteChange: Change.Modified,
			acceptedResource: this.localResource.with(({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' })),
		}];
	}

	protected async getMergeResult(resourcePreview: ITestResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		return {
			content: resourcePreview.ref,
			localChange: Change.Modified,
			remoteChange: Change.Modified,
			hasConflicts: this.syncResult.hasConflicts,
		};
	}

	protected async getAcceptResult(resourcePreview: ITestResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IAcceptResult> {

		if (isEqual(resource, resourcePreview.localResource)) {
			return {
				content: resourcePreview.localContent,
				localChange: Change.None,
				remoteChange: resourcePreview.localContent === null ? Change.Deleted : Change.Modified,
			};
		}

		if (isEqual(resource, resourcePreview.remoteResource)) {
			return {
				content: resourcePreview.remoteContent,
				localChange: resourcePreview.remoteContent === null ? Change.Deleted : Change.Modified,
				remoteChange: Change.None,
			};
		}

		if (isEqual(resource, resourcePreview.previewResource)) {
			if (content === undefined) {
				return {
					content: resourcePreview.ref,
					localChange: Change.Modified,
					remoteChange: Change.Modified,
				};
			} else {
				return {
					content,
					localChange: content === null ? resourcePreview.localContent !== null ? Change.Deleted : Change.None : Change.Modified,
					remoteChange: content === null ? resourcePreview.remoteContent !== null ? Change.Deleted : Change.None : Change.Modified,
				};
			}
		}

		throw new Error(`Invalid Resource: ${resource.toString()}`);
	}

	protected async applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: [IResourcePreview, IAcceptResult][], force: boolean): Promise<void> {
		if (resourcePreviews[0][1].localChange === Change.Deleted) {
			await this.fileService.del(this.localResource);
		}

		if (resourcePreviews[0][1].localChange === Change.Added || resourcePreviews[0][1].localChange === Change.Modified) {
			await this.fileService.writeFile(this.localResource, VSBuffer.fromString(resourcePreviews[0][1].content!));
		}

		if (resourcePreviews[0][1].remoteChange === Change.Deleted) {
			await this.applyRef(null, remoteUserData.ref);
		}

		if (resourcePreviews[0][1].remoteChange === Change.Added || resourcePreviews[0][1].remoteChange === Change.Modified) {
			await this.applyRef(resourcePreviews[0][1].content, remoteUserData.ref);
		}
	}

	async applyRef(content: string | null, ref: string): Promise<void> {
		const remoteUserData = await this.updateRemoteUserData(content === null ? '' : content, ref);
		await this.updateLastSyncUserData(remoteUserData);
	}

	override async stop(): Promise<void> {
		this.cancelled = true;
		this.syncBarrier.open();
		super.stop();
	}

	override async triggerLocalChange(): Promise<void> {
		super.triggerLocalChange();
	}

	onDidTriggerLocalChangeCall: Emitter<void> = this._register(new Emitter<void>());
	protected override async doTriggerLocalChange(): Promise<void> {
		await super.doTriggerLocalChange();
		this.onDidTriggerLocalChangeCall.fire();
	}

}

suite('TestSynchronizer - Auto Sync', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let client: UserDataSyncClient;
	let userDataSyncStoreService: IUserDataSyncStoreService;

	setup(async () => {
		client = disposableStore.add(new UserDataSyncClient(server));
		await client.setUp();
		userDataSyncStoreService = client.instantiationService.get(IUserDataSyncStoreService);
		disposableStore.add(toDisposable(() => userDataSyncStoreService.clear()));
		client.instantiationService.get(IFileService).registerProvider(USER_DATA_SYNC_SCHEME, new InMemoryFileSystemProvider());
	});

	teardown(() => disposableStore.clear());

	test('status is syncing', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));

		const actual: SyncStatus[] = [];
		disposableStore.add(testObject.onDidChangeStatus(status => actual.push(status)));

		const promise = Event.toPromise(testObject.onDoSyncCall.event);

		testObject.sync(await client.manifest());
		await promise;

		assert.deepStrictEqual(actual, [SyncStatus.Syncing]);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);

		testObject.stop();
	});

	test('status is set correctly when sync is finished', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();

		const actual: SyncStatus[] = [];
		disposableStore.add(testObject.onDidChangeStatus(status => actual.push(status)));
		await testObject.sync(await client.manifest());

		assert.deepStrictEqual(actual, [SyncStatus.Syncing, SyncStatus.Idle]);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
	});

	test('status is set correctly when sync has errors', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasError: true, hasConflicts: false };
		testObject.syncBarrier.open();

		const actual: SyncStatus[] = [];
		disposableStore.add(testObject.onDidChangeStatus(status => actual.push(status)));

		try {
			await testObject.sync(await client.manifest());
			assert.fail('Should fail');
		} catch (e) {
			assert.deepStrictEqual(actual, [SyncStatus.Syncing, SyncStatus.Idle]);
			assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		}
	});

	test('status is set to hasConflicts when asked to sync if there are conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		await testObject.sync(await client.manifest());

		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);
		assertConflicts(testObject.conflicts, [testObject.localResource]);
	});

	test('sync should not run if syncing already', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		const promise = Event.toPromise(testObject.onDoSyncCall.event);

		testObject.sync(await client.manifest());
		await promise;

		const actual: SyncStatus[] = [];
		disposableStore.add(testObject.onDidChangeStatus(status => actual.push(status)));
		await testObject.sync(await client.manifest());

		assert.deepStrictEqual(actual, []);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);

		await testObject.stop();
	});

	test('sync should not run if disabled', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		client.instantiationService.get(IUserDataSyncResourceEnablementService).setResourceEnablement(testObject.resource, false);

		const actual: SyncStatus[] = [];
		disposableStore.add(testObject.onDidChangeStatus(status => actual.push(status)));

		await testObject.sync(await client.manifest());

		assert.deepStrictEqual(actual, []);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
	});

	test('sync should not run if there are conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const actual: SyncStatus[] = [];
		disposableStore.add(testObject.onDidChangeStatus(status => actual.push(status)));
		await testObject.sync(await client.manifest());

		assert.deepStrictEqual(actual, []);
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);
	});

	test('accept preview during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		await testObject.accept(testObject.conflicts[0].previewResource);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		const fileService = client.instantiationService.get(IFileService);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, (await fileService.readFile(testObject.localResource)).value.toString());
	});

	test('accept remote during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());
		const fileService = client.instantiationService.get(IFileService);
		const currentRemoteContent = (await testObject.getRemoteUserData(null)).syncData?.content;
		const newLocalContent = 'conflict';
		await fileService.writeFile(testObject.localResource, VSBuffer.fromString(newLocalContent));

		testObject.syncResult = { hasConflicts: true, hasError: false };
		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		await testObject.accept(testObject.conflicts[0].remoteResource);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, currentRemoteContent);
		assert.strictEqual((await fileService.readFile(testObject.localResource)).value.toString(), currentRemoteContent);
	});

	test('accept local during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());
		const fileService = client.instantiationService.get(IFileService);
		const newLocalContent = 'conflict';
		await fileService.writeFile(testObject.localResource, VSBuffer.fromString(newLocalContent));

		testObject.syncResult = { hasConflicts: true, hasError: false };
		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		await testObject.accept(testObject.conflicts[0].localResource);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, newLocalContent);
		assert.strictEqual((await fileService.readFile(testObject.localResource)).value.toString(), newLocalContent);
	});

	test('accept new content during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());
		const fileService = client.instantiationService.get(IFileService);
		const newLocalContent = 'conflict';
		await fileService.writeFile(testObject.localResource, VSBuffer.fromString(newLocalContent));

		testObject.syncResult = { hasConflicts: true, hasError: false };
		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		const mergeContent = 'newContent';
		await testObject.accept(testObject.conflicts[0].previewResource, mergeContent);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, mergeContent);
		assert.strictEqual((await fileService.readFile(testObject.localResource)).value.toString(), mergeContent);
	});

	test('accept delete during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());
		const fileService = client.instantiationService.get(IFileService);
		const newLocalContent = 'conflict';
		await fileService.writeFile(testObject.localResource, VSBuffer.fromString(newLocalContent));

		testObject.syncResult = { hasConflicts: true, hasError: false };
		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		await testObject.accept(testObject.conflicts[0].previewResource, null);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, '');
		assert.ok(!(await fileService.exists(testObject.localResource)));
	});

	test('accept deleted local during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());
		const fileService = client.instantiationService.get(IFileService);
		await fileService.del(testObject.localResource);

		testObject.syncResult = { hasConflicts: true, hasError: false };
		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		await testObject.accept(testObject.conflicts[0].localResource);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, '');
		assert.ok(!(await fileService.exists(testObject.localResource)));
	});

	test('accept deleted remote during conflicts', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		const fileService = client.instantiationService.get(IFileService);
		await fileService.writeFile(testObject.localResource, VSBuffer.fromString('some content'));
		testObject.syncResult = { hasConflicts: true, hasError: false };

		await testObject.sync(await client.manifest());
		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);

		await testObject.accept(testObject.conflicts[0].remoteResource);
		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertConflicts(testObject.conflicts, []);

		await testObject.apply(false);
		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData, null);
		assert.ok(!(await fileService.exists(testObject.localResource)));
	});

	test('request latest data on precondition failure', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		// Sync once
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());
		testObject.syncBarrier = new Barrier();

		// update remote data before syncing so that 412 is thrown by server
		const disposable = testObject.onDoSyncCall.event(async () => {
			disposable.dispose();
			await testObject.applyRef(ref, ref);
			server.reset();
			testObject.syncBarrier.open();
		});

		// Start sycing
		const manifest = await client.manifest();
		const ref = manifest!.latest![testObject.resource];
		await testObject.sync(await client.manifest());

		assert.deepStrictEqual(server.requests, [
			{ type: 'POST', url: `${server.url}/v1/resource/${testObject.resource}`, headers: { 'If-Match': ref } },
			{ type: 'GET', url: `${server.url}/v1/resource/${testObject.resource}/latest`, headers: {} },
			{ type: 'POST', url: `${server.url}/v1/resource/${testObject.resource}`, headers: { 'If-Match': `${parseInt(ref) + 1}` } },
		]);
	});

	test('no requests are made to server when local change is triggered', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		server.reset();
		const promise = Event.toPromise(testObject.onDidTriggerLocalChangeCall.event);
		await testObject.triggerLocalChange();

		await promise;
		assert.deepStrictEqual(server.requests, []);
	});

	test('status is reset when getting latest remote data fails', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.failWhenGettingLatestRemoteUserData = true;

		try {
			await testObject.sync(await client.manifest());
			assert.fail('Should throw an error');
		} catch (error) {
		}

		assert.strictEqual(testObject.status, SyncStatus.Idle);
	});
});

suite('TestSynchronizer - Manual Sync', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let client: UserDataSyncClient;
	let userDataSyncStoreService: IUserDataSyncStoreService;

	setup(async () => {
		client = disposableStore.add(new UserDataSyncClient(server));
		await client.setUp();
		userDataSyncStoreService = client.instantiationService.get(IUserDataSyncStoreService);
		disposableStore.add(toDisposable(() => userDataSyncStoreService.clear()));
		client.instantiationService.get(IFileService).registerProvider(USER_DATA_SYNC_SCHEME, new InMemoryFileSystemProvider());
	});

	teardown(() => disposableStore.clear());

	test('preview', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		const preview = await testObject.preview(await client.manifest());

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assertConflicts(testObject.conflicts, []);
	});

	test('preview -> merge', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('preview -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('preview -> merge -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].localResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('preview -> merge -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const manifest = await client.manifest();
		let preview = await testObject.preview(manifest);
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		const expectedContent = manifest!.latest![testObject.resource];
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('preview -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const manifest = await client.manifest();
		const expectedContent = manifest!.latest![testObject.resource];
		let preview = await testObject.preview(manifest);
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('preview -> merge -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const expectedContent = (await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString();
		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].localResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('preview -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assertConflicts(testObject.conflicts, []);
	});

	test('preview -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const manifest = await client.manifest();
		const expectedContent = manifest!.latest![testObject.resource];
		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('preivew -> merge -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('preivew -> merge -> discard -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('preivew -> accept -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('preivew -> accept -> discard -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('preivew -> accept -> discard -> merge', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.merge(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('preivew -> merge -> accept -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('preivew -> merge -> discard -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const expectedContent = (await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString();
		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].localResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('preivew -> accept -> discard -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const expectedContent = (await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString();
		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].localResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('preivew -> accept -> discard -> merge -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const manifest = await client.manifest();
		const expectedContent = manifest!.latest![testObject.resource];
		let preview = await testObject.preview(manifest);
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.merge(preview!.resourcePreviews[0].localResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('conflicts: preview', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		const preview = await testObject.preview(await client.manifest());

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preview -> merge', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Conflict);
		assertConflicts(testObject.conflicts, [preview!.resourcePreviews[0].localResource]);
	});

	test('conflicts: preview -> merge -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		const preview = await testObject.preview(await client.manifest());
		await testObject.merge(preview!.resourcePreviews[0].previewResource);
		await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preview -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		await testObject.merge(preview!.resourcePreviews[0].previewResource);
		const content = await testObject.resolveContent(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource, content);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.deepStrictEqual(testObject.conflicts, []);
	});

	test('conflicts: preview -> merge -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		testObject.syncResult = { hasConflicts: true, hasError: false };
		const manifest = await client.manifest();
		const expectedContent = manifest!.latest![testObject.resource];
		let preview = await testObject.preview(manifest);

		await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('conflicts: preview -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		const content = await testObject.resolveContent(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource, content);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preview -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		testObject.syncResult = { hasConflicts: true, hasError: false };
		const manifest = await client.manifest();
		const expectedContent = manifest!.latest![testObject.resource];
		let preview = await testObject.preview(manifest);

		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);

		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('conflicts: preivew -> merge -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preivew -> merge -> discard -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preivew -> accept -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preivew -> accept -> discard -> accept', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Accepted);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preivew -> accept -> discard -> merge', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.merge(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Conflict);
		assertConflicts(testObject.conflicts, [preview!.resourcePreviews[0].localResource]);
	});

	test('conflicts: preivew -> merge -> discard -> merge', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: true, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.merge(preview!.resourcePreviews[0].remoteResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.HasConflicts);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Conflict);
		assertConflicts(testObject.conflicts, [preview!.resourcePreviews[0].localResource]);
	});

	test('conflicts: preivew -> merge -> accept -> discard', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();

		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);

		assert.deepStrictEqual(testObject.status, SyncStatus.Syncing);
		assertPreviews(preview!.resourcePreviews, [testObject.localResource]);
		assert.strictEqual(preview!.resourcePreviews[0].mergeState, MergeState.Preview);
		assertConflicts(testObject.conflicts, []);
	});

	test('conflicts: preivew -> merge -> discard -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const expectedContent = (await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString();
		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].localResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

	test('conflicts: preivew -> accept -> discard -> accept -> apply', async () => {
		const testObject: TestSynchroniser = disposableStore.add(client.instantiationService.createInstance(TestSynchroniser, SyncResource.Settings));
		testObject.syncResult = { hasConflicts: false, hasError: false };
		testObject.syncBarrier.open();
		await testObject.sync(await client.manifest());

		const expectedContent = (await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString();
		let preview = await testObject.preview(await client.manifest());
		preview = await testObject.merge(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].remoteResource);
		preview = await testObject.discard(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.accept(preview!.resourcePreviews[0].localResource);
		preview = await testObject.apply(false);

		assert.deepStrictEqual(testObject.status, SyncStatus.Idle);
		assert.strictEqual(preview, null);
		assertConflicts(testObject.conflicts, []);
		assert.strictEqual((await testObject.getRemoteUserData(null)).syncData?.content, expectedContent);
		assert.strictEqual((await client.instantiationService.get(IFileService).readFile(testObject.localResource)).value.toString(), expectedContent);
	});

});

function assertConflicts(actual: IBaseResourcePreview[], expected: URI[]) {
	assert.deepStrictEqual(actual.map(({ localResource }) => localResource.toString()), expected.map(uri => uri.toString()));
}

function assertPreviews(actual: IBaseResourcePreview[], expected: URI[]) {
	assert.deepStrictEqual(actual.map(({ localResource }) => localResource.toString()), expected.map(uri => uri.toString()));
}
