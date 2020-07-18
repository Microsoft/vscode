/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as uuid from 'vs/base/common/uuid';
import * as pfs from 'vs/base/node/pfs';
import { IFileService, FileChangeType, IFileChange, IFileSystemProviderWithFileReadWriteCapability, IStat, FileType, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { joinPath, dirname } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { BACKUPS } from 'vs/platform/environment/common/environment';
import { DisposableStore, IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { Emitter, Event } from 'vs/base/common/event';
import { timeout } from 'vs/base/common/async';

class TestBrowserWorkbenchEnvironmentService extends BrowserWorkbenchEnvironmentService {

	testUserRoamingDataHome!: URI;

	get userRoamingDataHome(): URI {
		return this.testUserRoamingDataHome;
	}
}

suite('FileUserDataProvider', () => {

	let testObject: IFileService;
	let rootPath: string;
	let userDataPath: string;
	let backupsPath: string;
	let userDataResource: URI;
	const disposables = new DisposableStore();

	setup(async () => {
		const logService = new NullLogService();
		testObject = new FileService(logService);
		disposables.add(testObject);

		const diskFileSystemProvider = new DiskFileSystemProvider(logService);
		disposables.add(diskFileSystemProvider);
		disposables.add(testObject.registerProvider(Schemas.file, diskFileSystemProvider));

		rootPath = path.join(os.tmpdir(), 'vsctests', uuid.generateUuid());
		userDataPath = path.join(rootPath, 'user');
		backupsPath = path.join(rootPath, BACKUPS);
		userDataResource = URI.file(userDataPath).with({ scheme: Schemas.userData });
		await Promise.all([pfs.mkdirp(userDataPath), pfs.mkdirp(backupsPath)]);

		const environmentService = new TestBrowserWorkbenchEnvironmentService({ remoteAuthority: 'remote', workspaceId: 'workspaceId', logsPath: URI.file('logFile') });
		environmentService.testUserRoamingDataHome = userDataResource;

		const userDataFileSystemProvider = new FileUserDataProvider(URI.file(userDataPath), URI.file(backupsPath), diskFileSystemProvider, environmentService, logService);
		disposables.add(userDataFileSystemProvider);
		disposables.add(testObject.registerProvider(Schemas.userData, userDataFileSystemProvider));
	});

	teardown(async () => {
		disposables.clear();
		await pfs.rimraf(rootPath, pfs.RimRafMode.MOVE);
	});

	test('exists return false when file does not exist', async () => {
		const exists = await testObject.exists(joinPath(userDataResource, 'settings.json'));
		assert.equal(exists, false);
	});

	test('read file throws error if not exist', async () => {
		try {
			await testObject.readFile(joinPath(userDataResource, 'settings.json'));
			assert.fail('Should fail since file does not exist');
		} catch (e) { }
	});

	test('read existing file', async () => {
		await pfs.writeFile(path.join(userDataPath, 'settings.json'), '{}');
		const result = await testObject.readFile(joinPath(userDataResource, 'settings.json'));
		assert.equal(result.value, '{}');
	});

	test('create file', async () => {
		const resource = joinPath(userDataResource, 'settings.json');
		const actual1 = await testObject.createFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual2 = await pfs.readFile(path.join(userDataPath, 'settings.json'));
		assert.equal(actual2, '{}');
	});

	test('write file creates the file if not exist', async () => {
		const resource = joinPath(userDataResource, 'settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual2 = await pfs.readFile(path.join(userDataPath, 'settings.json'));
		assert.equal(actual2, '{}');
	});

	test('write to existing file', async () => {
		const resource = joinPath(userDataResource, 'settings.json');
		await pfs.writeFile(path.join(userDataPath, 'settings.json'), '{}');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{a:1}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual2 = await pfs.readFile(path.join(userDataPath, 'settings.json'));
		assert.equal(actual2, '{a:1}');
	});

	test('delete file', async () => {
		await pfs.writeFile(path.join(userDataPath, 'settings.json'), '');
		await testObject.del(joinPath(userDataResource, 'settings.json'));
		const result = await pfs.exists(path.join(userDataPath, 'settings.json'));
		assert.equal(false, result);
	});

	test('resolve file', async () => {
		await pfs.writeFile(path.join(userDataPath, 'settings.json'), '');
		const result = await testObject.resolve(joinPath(userDataResource, 'settings.json'));
		assert.ok(!result.isDirectory);
		assert.ok(result.children === undefined);
	});

	test('exists return false for folder that does not exist', async () => {
		const exists = await testObject.exists(joinPath(userDataResource, 'snippets'));
		assert.equal(exists, false);
	});

	test('exists return true for folder that exists', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		const exists = await testObject.exists(joinPath(userDataResource, 'snippets'));
		assert.equal(exists, true);
	});

	test('read file throws error for folder', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		try {
			await testObject.readFile(joinPath(userDataResource, 'snippets'));
			assert.fail('Should fail since read file is not supported for folders');
		} catch (e) { }
	});

	test('read file under folder', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		await pfs.writeFile(path.join(userDataPath, 'snippets', 'settings.json'), '{}');
		const resource = joinPath(userDataResource, 'snippets/settings.json');
		const actual = await testObject.readFile(resource);
		assert.equal(actual.resource.toString(), resource.toString());
		assert.equal(actual.value, '{}');
	});

	test('read file under sub folder', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets', 'java'));
		await pfs.writeFile(path.join(userDataPath, 'snippets', 'java', 'settings.json'), '{}');
		const resource = joinPath(userDataResource, 'snippets/java/settings.json');
		const actual = await testObject.readFile(resource);
		assert.equal(actual.resource.toString(), resource.toString());
		assert.equal(actual.value, '{}');
	});

	test('create file under folder that exists', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		const resource = joinPath(userDataResource, 'snippets/settings.json');
		const actual1 = await testObject.createFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual2 = await pfs.readFile(path.join(userDataPath, 'snippets', 'settings.json'));
		assert.equal(actual2, '{}');
	});

	test('create file under folder that does not exist', async () => {
		const resource = joinPath(userDataResource, 'snippets/settings.json');
		const actual1 = await testObject.createFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual2 = await pfs.readFile(path.join(userDataPath, 'snippets', 'settings.json'));
		assert.equal(actual2, '{}');
	});

	test('write to not existing file under container that exists', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		const resource = joinPath(userDataResource, 'snippets/settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual = await pfs.readFile(path.join(userDataPath, 'snippets', 'settings.json'));
		assert.equal(actual, '{}');
	});

	test('write to not existing file under container that does not exists', async () => {
		const resource = joinPath(userDataResource, 'snippets/settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual = await pfs.readFile(path.join(userDataPath, 'snippets', 'settings.json'));
		assert.equal(actual, '{}');
	});

	test('write to existing file under container', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		await pfs.writeFile(path.join(userDataPath, 'snippets', 'settings.json'), '{}');
		const resource = joinPath(userDataResource, 'snippets/settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{a:1}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual = await pfs.readFile(path.join(userDataPath, 'snippets', 'settings.json'));
		assert.equal(actual.toString(), '{a:1}');
	});

	test('write file under sub container', async () => {
		const resource = joinPath(userDataResource, 'snippets/java/settings.json');
		const actual1 = await testObject.writeFile(resource, VSBuffer.fromString('{}'));
		assert.equal(actual1.resource.toString(), resource.toString());
		const actual = await pfs.readFile(path.join(userDataPath, 'snippets', 'java', 'settings.json'));
		assert.equal(actual, '{}');
	});

	test('delete throws error for folder that does not exist', async () => {
		try {
			await testObject.del(joinPath(userDataResource, 'snippets'));
			assert.fail('Should fail the folder does not exist');
		} catch (e) { }
	});

	test('delete not existing file under container that exists', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		try {
			await testObject.del(joinPath(userDataResource, 'snippets/settings.json'));
			assert.fail('Should fail since file does not exist');
		} catch (e) { }
	});

	test('delete not existing file under container that does not exists', async () => {
		try {
			await testObject.del(joinPath(userDataResource, 'snippets/settings.json'));
			assert.fail('Should fail since file does not exist');
		} catch (e) { }
	});

	test('delete existing file under folder', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		await pfs.writeFile(path.join(userDataPath, 'snippets', 'settings.json'), '{}');
		await testObject.del(joinPath(userDataResource, 'snippets/settings.json'));
		const exists = await pfs.exists(path.join(userDataPath, 'snippets', 'settings.json'));
		assert.equal(exists, false);
	});

	test('resolve folder', async () => {
		await pfs.mkdirp(path.join(userDataPath, 'snippets'));
		await pfs.writeFile(path.join(userDataPath, 'snippets', 'settings.json'), '{}');
		const result = await testObject.resolve(joinPath(userDataResource, 'snippets'));
		assert.ok(result.isDirectory);
		assert.ok(result.children !== undefined);
		assert.equal(result.children!.length, 1);
		assert.equal(result.children![0].resource.toString(), joinPath(userDataResource, 'snippets/settings.json').toString());
	});

	test('read backup file', async () => {
		await pfs.writeFile(path.join(backupsPath, 'backup.json'), '{}');
		const result = await testObject.readFile(joinPath(userDataResource, `${BACKUPS}/backup.json`));
		assert.equal(result.value, '{}');
	});

	test('create backup file', async () => {
		await testObject.createFile(joinPath(userDataResource, `${BACKUPS}/backup.json`), VSBuffer.fromString('{}'));
		const result = await pfs.readFile(path.join(backupsPath, 'backup.json'));
		assert.equal(result, '{}');
	});

	test('write backup file', async () => {
		await pfs.writeFile(path.join(backupsPath, 'backup.json'), '{}');
		await testObject.writeFile(joinPath(userDataResource, `${BACKUPS}/backup.json`), VSBuffer.fromString('{a:1}'));
		const result = await pfs.readFile(path.join(backupsPath, 'backup.json'));
		assert.equal(result, '{a:1}');
	});

	test('resolve backups folder', async () => {
		await pfs.writeFile(path.join(backupsPath, 'backup.json'), '{}');
		const result = await testObject.resolve(joinPath(userDataResource, BACKUPS));
		assert.ok(result.isDirectory);
		assert.ok(result.children !== undefined);
		assert.equal(result.children!.length, 1);
		assert.equal(result.children![0].resource.toString(), joinPath(userDataResource, `${BACKUPS}/backup.json`).toString());
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

	let testObject: IFileService;
	let localBackupsResource: URI;
	let localUserDataResource: URI;
	let userDataResource: URI;
	const disposables = new DisposableStore();

	const fileEventEmitter: Emitter<readonly IFileChange[]> = new Emitter<readonly IFileChange[]>();
	disposables.add(fileEventEmitter);

	setup(() => {

		const rootPath = path.join(os.tmpdir(), 'vsctests', uuid.generateUuid());
		const userDataPath = path.join(rootPath, 'user');
		const backupsPath = path.join(rootPath, BACKUPS);
		localBackupsResource = URI.file(backupsPath);
		localUserDataResource = URI.file(userDataPath);
		userDataResource = localUserDataResource.with({ scheme: Schemas.userData });

		const environmentService = new TestBrowserWorkbenchEnvironmentService({ remoteAuthority: 'remote', workspaceId: 'workspaceId', logsPath: URI.file('logFile') });
		environmentService.testUserRoamingDataHome = userDataResource;

		const userDataFileSystemProvider = new FileUserDataProvider(localUserDataResource, localBackupsResource, new TestFileSystemProvider(fileEventEmitter.event), environmentService, new NullLogService());
		disposables.add(userDataFileSystemProvider);

		testObject = new FileService(new NullLogService());
		disposables.add(testObject);
		disposables.add(testObject.registerProvider(Schemas.userData, userDataFileSystemProvider));
	});

	teardown(() => {
		disposables.clear();
	});

	test('file added change event', done => {
		const expected = joinPath(userDataResource, 'settings.json');
		const target = joinPath(localUserDataResource, 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.ADDED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.ADDED
		}]);
	});

	test('file updated change event', done => {
		const expected = joinPath(userDataResource, 'settings.json');
		const target = joinPath(localUserDataResource, 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.UPDATED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.UPDATED
		}]);
	});

	test('file deleted change event', done => {
		const expected = joinPath(userDataResource, 'settings.json');
		const target = joinPath(localUserDataResource, 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.DELETED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
	});

	test('file under folder created change event', done => {
		const expected = joinPath(userDataResource, 'snippets', 'settings.json');
		const target = joinPath(localUserDataResource, 'snippets', 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.ADDED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.ADDED
		}]);
	});

	test('file under folder updated change event', done => {
		const expected = joinPath(userDataResource, 'snippets', 'settings.json');
		const target = joinPath(localUserDataResource, 'snippets', 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.UPDATED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.UPDATED
		}]);
	});

	test('file under folder deleted change event', done => {
		const expected = joinPath(userDataResource, 'snippets', 'settings.json');
		const target = joinPath(localUserDataResource, 'snippets', 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.DELETED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
	});

	test('event is not triggered if file is not under user data', async () => {
		const target = joinPath(dirname(localUserDataResource), 'settings.json');
		let triggered = false;
		testObject.onDidFilesChange(() => triggered = true);
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
		await timeout(0);
		if (triggered) {
			assert.fail('event should not be triggered');
		}
	});

	test('backup file created change event', done => {
		const expected = joinPath(userDataResource, BACKUPS, 'settings.json');
		const target = joinPath(localBackupsResource, 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.ADDED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.ADDED
		}]);
	});

	test('backup file update change event', done => {
		const expected = joinPath(userDataResource, BACKUPS, 'settings.json');
		const target = joinPath(localBackupsResource, 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.UPDATED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.UPDATED
		}]);
	});

	test('backup file delete change event', done => {
		const expected = joinPath(userDataResource, BACKUPS, 'settings.json');
		const target = joinPath(localBackupsResource, 'settings.json');
		testObject.onDidFilesChange(e => {
			if (e.contains(expected, FileChangeType.DELETED)) {
				done();
			}
		});
		fileEventEmitter.fire([{
			resource: target,
			type: FileChangeType.DELETED
		}]);
	});
});
