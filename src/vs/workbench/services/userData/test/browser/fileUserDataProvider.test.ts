/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IFileService, FileChangeType, IFileChange, IFileSystemProviderWithFileReadWriteCapability, IStat, FileType, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { dirname, isEqual, joinPath } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { DisposableStore, IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { TestProductService } from 'vs/workbench/test/browser/workbenchTestServices';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';

const ROOT = URI.file('tests').with({ scheme: 'vscode-tests' });

class TestWorkbenchEnvironmentService extends BrowserWorkbenchEnvironmentService {
	constructor(private readonly appSettingsHome: URI) {
		super(Object.create(null), TestProductService);
	}
	override get userRoamingDataHome() { return this.appSettingsHome.with({ scheme: Schemas.userData }); }
}

suite('FileUserDataProvider', () => {

	let testObject: IFileService;
	let userDataHomeOnDisk: URI;
	let backupWorkspaceHomeOnDisk: URI;
	let environmentService: IWorkbenchEnvironmentService;
	const disposables = new DisposableStore();
	let fileUserDataProvider: FileUserDataProvider;

	setup(async () => {
		const logService = new NullLogService();
		testObject = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		disposables.add(testObject.registerProvider(ROOT.scheme, fileSystemProvider));

		userDataHomeOnDisk = joinPath(ROOT, 'User');
		const backupHome = joinPath(ROOT, 'Backups');
		backupWorkspaceHomeOnDisk = joinPath(backupHome, 'workspaceId');
		await testObject.createFolder(userDataHomeOnDisk);
		await testObject.createFolder(backupWorkspaceHomeOnDisk);

		environmentService = new TestWorkbenchEnvironmentService(userDataHomeOnDisk);

		fileUserDataProvider = new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, logService);
		disposables.add(fileUserDataProvider);
		disposables.add(testObject.registerProvider(Schemas.userData, fileUserDataProvider));
	});

	teardown(() => disposables.clear());

	test('exists return false when file does not exist', async () => {
		const exists = await testObject.exists(environmentService.settingsResource);
		assert.strictEqual(exists, false);
	});

	test('read file throws error if not exist', async () => {
		try {
			await testObject.readFile(environmentService.settingsResource);
			assert.fail('Should fail since file does not exist');
		} catch (e) { }
	});

	test('read existing file', async () => {
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'settings.json'), VSBuffer.fromString('{}'));
		const result = await testObject.readFile(environmentService.settingsResource);
		assert.strictEqual(result.value.toString(), '{}');
	});

	test('create file', async () => {
		const resource = environmentService.settingsResource;
		const actual1 = await testObject.createFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual2 = await testObject.readFile(joinPath(userDataHomeOnDisk, 'settings.json'));
		assert.strictEqual(actual2.value.toString(), '{}');
	});

	test('write file creates the file if not exist', async () => {
		const resource = environmentService.settingsResource;
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual2 = await testObject.readFile(joinPath(userDataHomeOnDisk, 'settings.json'));
		assert.strictEqual(actual2.value.toString(), '{}');
	});

	test('write to existing file', async () => {
		const resource = environmentService.settingsResource;
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'settings.json'), VSBuffer.fromString('{}'));
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{a:1}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual2 = await testObject.readFile(joinPath(userDataHomeOnDisk, 'settings.json'));
		assert.strictEqual(actual2.value.toString(), '{a:1}');
	});

	test('delete file', async () => {
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'settings.json'), VSBuffer.fromString(''));
		await testObject.del(environmentService.settingsResource);
		const result = await testObject.exists(joinPath(userDataHomeOnDisk, 'settings.json'));
		assert.strictEqual(false, result);
	});

	test('resolve file', async () => {
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'settings.json'), VSBuffer.fromString(''));
		const result = await testObject.resolve(environmentService.settingsResource);
		assert.ok(!result.isDirectory);
		assert.ok(result.children === undefined);
	});

	test('exists return false for folder that does not exist', async () => {
		const exists = await testObject.exists(environmentService.snippetsHome);
		assert.strictEqual(exists, false);
	});

	test('exists return true for folder that exists', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		const exists = await testObject.exists(environmentService.snippetsHome);
		assert.strictEqual(exists, true);
	});

	test('read file throws error for folder', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		try {
			await testObject.readFile(environmentService.snippetsHome);
			assert.fail('Should fail since read file is not supported for folders');
		} catch (e) { }
	});

	test('read file under folder', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'), VSBuffer.fromString('{}'));
		const resource = joinPath(environmentService.snippetsHome, 'settings.json');
		const actual = await testObject.readFile(resource);
		assert.strictEqual(actual.resource.toString(), resource.toString());
		assert.strictEqual(actual.value.toString(), '{}');
	});

	test('read file under sub folder', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets', 'java'));
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'snippets', 'java', 'settings.json'), VSBuffer.fromString('{}'));
		const resource = joinPath(environmentService.snippetsHome, 'java/settings.json');
		const actual = await testObject.readFile(resource);
		assert.strictEqual(actual.resource.toString(), resource.toString());
		assert.strictEqual(actual.value.toString(), '{}');
	});

	test('create file under folder that exists', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		const resource = joinPath(environmentService.snippetsHome, 'settings.json');
		const actual1 = await testObject.createFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual2 = await testObject.readFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'));
		assert.strictEqual(actual2.value.toString(), '{}');
	});

	test('create file under folder that does not exist', async () => {
		const resource = joinPath(environmentService.snippetsHome, 'settings.json');
		const actual1 = await testObject.createFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual2 = await testObject.readFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'));
		assert.strictEqual(actual2.value.toString(), '{}');
	});

	test('write to not existing file under container that exists', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		const resource = joinPath(environmentService.snippetsHome, 'settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual = await testObject.readFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'));
		assert.strictEqual(actual.value.toString(), '{}');
	});

	test('write to not existing file under container that does not exists', async () => {
		const resource = joinPath(environmentService.snippetsHome, 'settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual = await testObject.readFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'));
		assert.strictEqual(actual.value.toString(), '{}');
	});

	test('write to existing file under container', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'), VSBuffer.fromString('{}'));
		const resource = joinPath(environmentService.snippetsHome, 'settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{a:1}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual = await testObject.readFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'));
		assert.strictEqual(actual.value.toString(), '{a:1}');
	});

	test('write file under sub container', async () => {
		const resource = joinPath(environmentService.snippetsHome, 'java/settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.strictEqual(actual1.resource.toString(), resource.toString());
		const actual = await testObject.readFile(joinPath(userDataHomeOnDisk, 'snippets', 'java', 'settings.json'));
		assert.strictEqual(actual.value.toString(), '{}');
	});

	test('delete throws error for folder that does not exist', async () => {
		try {
			await testObject.del(environmentService.snippetsHome);
			assert.fail('Should fail the folder does not exist');
		} catch (e) { }
	});

	test('delete not existing file under container that exists', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		try {
			await testObject.del(joinPath(environmentService.snippetsHome, 'settings.json'));
			assert.fail('Should fail since file does not exist');
		} catch (e) { }
	});

	test('delete not existing file under container that does not exists', async () => {
		try {
			await testObject.del(joinPath(environmentService.snippetsHome, 'settings.json'));
			assert.fail('Should fail since file does not exist');
		} catch (e) { }
	});

	test('delete existing file under folder', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'), VSBuffer.fromString('{}'));
		await testObject.del(joinPath(environmentService.snippetsHome, 'settings.json'));
		const exists = await testObject.exists(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'));
		assert.strictEqual(exists, false);
	});

	test('resolve folder', async () => {
		await testObject.createFolder(joinPath(userDataHomeOnDisk, 'snippets'));
		await testObject.writeFile(joinPath(userDataHomeOnDisk, 'snippets', 'settings.json'), VSBuffer.fromString('{}'));
		const result = await testObject.resolve(environmentService.snippetsHome);
		assert.ok(result.isDirectory);
		assert.ok(result.children !== undefined);
		assert.strictEqual(result.children!.length, 1);
		assert.strictEqual(result.children![0].resource.toString(), joinPath(environmentService.snippetsHome, 'settings.json').toString());
	});

	test('read backup file', async () => {
		await testObject.writeFile(joinPath(backupWorkspaceHomeOnDisk, 'backup.json'), VSBuffer.fromString('{}'));
		const result = await testObject.readFile(joinPath(backupWorkspaceHomeOnDisk.with({ scheme: environmentService.userRoamingDataHome.scheme }), `backup.json`));
		assert.strictEqual(result.value.toString(), '{}');
	});

	test('create backup file', async () => {
		await testObject.createFile(joinPath(backupWorkspaceHomeOnDisk.with({ scheme: environmentService.userRoamingDataHome.scheme }), `backup.json`), VSBuffer.fromString('{}'));
		const result = await testObject.readFile(joinPath(backupWorkspaceHomeOnDisk, 'backup.json'));
		assert.strictEqual(result.value.toString(), '{}');
	});

	test('write backup file', async () => {
		await testObject.writeFile(joinPath(backupWorkspaceHomeOnDisk, 'backup.json'), VSBuffer.fromString('{}'));
		await testObject.writeFile(joinPath(backupWorkspaceHomeOnDisk.with({ scheme: environmentService.userRoamingDataHome.scheme }), `backup.json`), VSBuffer.fromString('{a:1}'));
		const result = await testObject.readFile(joinPath(backupWorkspaceHomeOnDisk, 'backup.json'));
		assert.strictEqual(result.value.toString(), '{a:1}');
	});

	test('resolve backups folder', async () => {
		await testObject.writeFile(joinPath(backupWorkspaceHomeOnDisk, 'backup.json'), VSBuffer.fromString('{}'));
		const result = await testObject.resolve(backupWorkspaceHomeOnDisk.with({ scheme: environmentService.userRoamingDataHome.scheme }));
		assert.ok(result.isDirectory);
		assert.ok(result.children !== undefined);
		assert.strictEqual(result.children!.length, 1);
		assert.strictEqual(result.children![0].resource.toString(), joinPath(backupWorkspaceHomeOnDisk.with({ scheme: environmentService.userRoamingDataHome.scheme }), `backup.json`).toString());
	});
});

class TestFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {

	constructor(readonly onDidChangeFile: Event<readonly IFileChange[]>) { }

	readonly capabilities: FileSystemProviderCapabilities = FileSystemProviderCapabilities.FileReadWrite;

	readonly onDidChangeCapabilities: Event<void> = Event.None;

	watch(): IDisposable { return Disposable.None; }

	stat(): Promise<IStat> { throw new Error('Not Supported'); }

	mkdir(resource: URI): Promise<void> { throw new Error('Not Supported'); }

	rename(): Promise<void> { throw new Error('Not Supported'); }

	readFile(resource: URI): Promise<Uint8Array> { throw new Error('Not Supported'); }

	readdir(resource: URI): Promise<[string, FileType][]> { throw new Error('Not Supported'); }

	writeFile(): Promise<void> { throw new Error('Not Supported'); }

	delete(): Promise<void> { throw new Error('Not Supported'); }

}

suite('FileUserDataProvider - Watching', () => {

	let testObject: FileUserDataProvider;
	const disposables = new DisposableStore();
	const rootFileResource = joinPath(ROOT, 'User');
	const rootUserDataResource = rootFileResource.with({ scheme: Schemas.userData });

	const fileEventEmitter: Emitter<readonly IFileChange[]> = new Emitter<readonly IFileChange[]>();
	disposables.add(fileEventEmitter);

	setup(() => {
		testObject = disposables.add(new FileUserDataProvider(rootFileResource.scheme, new TestFileSystemProvider(fileEventEmitter.event), Schemas.userData, new NullLogService()));
	});

	teardown(() => disposables.clear());

	test('file added change event', done => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const expected = joinPath(rootUserDataResource, 'settings.json');
		const target = joinPath(rootFileResource, 'settings.json');
		disposables.add(testObject.onDidChangeFile(e => {
			if (isEqual(e[0].resource, expected) && e[0].type === FileChangeType.ADDED) {
				done();
			}
		}));
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.ADDED
		}]);
	});

	test('file updated change event', done => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const expected = joinPath(rootUserDataResource, 'settings.json');
		const target = joinPath(rootFileResource, 'settings.json');
		disposables.add(testObject.onDidChangeFile(e => {
			if (isEqual(e[0].resource, expected) && e[0].type === FileChangeType.UPDATED) {
				done();
			}
		}));
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.UPDATED
		}]);
	});

	test('file deleted change event', done => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const expected = joinPath(rootUserDataResource, 'settings.json');
		const target = joinPath(rootFileResource, 'settings.json');
		disposables.add(testObject.onDidChangeFile(e => {
			if (isEqual(e[0].resource, expected) && e[0].type === FileChangeType.DELETED) {
				done();
			}
		}));
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
	});

	test('file under folder created change event', done => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const expected = joinPath(rootUserDataResource, 'snippets', 'settings.json');
		const target = joinPath(rootFileResource, 'snippets', 'settings.json');
		disposables.add(testObject.onDidChangeFile(e => {
			if (isEqual(e[0].resource, expected) && e[0].type === FileChangeType.ADDED) {
				done();
			}
		}));
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.ADDED
		}]);
	});

	test('file under folder updated change event', done => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const expected = joinPath(rootUserDataResource, 'snippets', 'settings.json');
		const target = joinPath(rootFileResource, 'snippets', 'settings.json');
		disposables.add(testObject.onDidChangeFile(e => {
			if (isEqual(e[0].resource, expected) && e[0].type === FileChangeType.UPDATED) {
				done();
			}
		}));
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.UPDATED
		}]);
	});

	test('file under folder deleted change event', done => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const expected = joinPath(rootUserDataResource, 'snippets', 'settings.json');
		const target = joinPath(rootFileResource, 'snippets', 'settings.json');
		disposables.add(testObject.onDidChangeFile(e => {
			if (isEqual(e[0].resource, expected) && e[0].type === FileChangeType.DELETED) {
				done();
			}
		}));
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
	});

	test('event is not triggered if not watched', async () => {
		const target = joinPath(rootFileResource, 'settings.json');
		let triggered = false;
		testObject.onDidChangeFile(() => triggered = true);
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
		if (triggered) {
			assert.fail('event should not be triggered');
		}
	});

	test('event is not triggered if not watched 2', async () => {
		disposables.add(testObject.watch(rootUserDataResource, { excludes: [], recursive: false }));
		const target = joinPath(dirname(rootFileResource), 'settings.json');
		let triggered = false;
		testObject.onDidChangeFile(() => triggered = true);
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
		if (triggered) {
			assert.fail('event should not be triggered');
		}
	});

});
