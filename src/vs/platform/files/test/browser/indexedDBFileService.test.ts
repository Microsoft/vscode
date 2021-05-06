/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { FileOperation, FileOperationError, FileOperationEvent, FileOperationResult, FileSystemProviderErrorCode, FileType, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { NullLogService } from 'vs/platform/log/common/log';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IIndexedDBFileSystemProvider, IndexedDB, INDEXEDDB_LOGS_OBJECT_STORE, INDEXEDDB_USERDATA_OBJECT_STORE } from 'vs/platform/files/browser/indexedDBFileSystemProvider';
import { assertIsDefined } from 'vs/base/common/types';
import { basename, joinPath } from 'vs/base/common/resources';
import { bufferToReadable, bufferToStream, VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';

suite('IndexedDB File Service', function () {

	// IDB sometimes under pressure in build machines.
	this.retries(3);

	const logSchema = 'logs';

	let service: FileService;
	let logFileProvider: IIndexedDBFileSystemProvider;
	let userdataFileProvider: IIndexedDBFileSystemProvider;
	const testDir = '/';

	const logfileURIFromPaths = (paths: string[]) => joinPath(URI.from({ scheme: logSchema, path: testDir }), ...paths);
	const userdataURIFromPaths = (paths: readonly string[]) => joinPath(URI.from({ scheme: Schemas.userData, path: testDir }), ...paths);

	const disposables = new DisposableStore();

	const initFixtures = async () => {
		await Promise.all(
			[['fixtures', 'resolver', 'examples'],
			['fixtures', 'resolver', 'other', 'deep'],
			['fixtures', 'service', 'deep'],
			['batched']]
				.map(path => userdataURIFromPaths(path))
				.map(uri => service.createFolder(uri)));
		await Promise.all(
			([
				[['fixtures', 'resolver', 'examples', 'company.js'], 'class company {}'],
				[['fixtures', 'resolver', 'examples', 'conway.js'], 'export function conway() {}'],
				[['fixtures', 'resolver', 'examples', 'employee.js'], 'export const employee = "jax"'],
				[['fixtures', 'resolver', 'examples', 'small.js'], ''],
				[['fixtures', 'resolver', 'other', 'deep', 'company.js'], 'class company {}'],
				[['fixtures', 'resolver', 'other', 'deep', 'conway.js'], 'export function conway() {}'],
				[['fixtures', 'resolver', 'other', 'deep', 'employee.js'], 'export const employee = "jax"'],
				[['fixtures', 'resolver', 'other', 'deep', 'small.js'], ''],
				[['fixtures', 'resolver', 'index.html'], '<p>p</p>'],
				[['fixtures', 'resolver', 'site.css'], '.p {color: red;}'],
				[['fixtures', 'service', 'deep', 'company.js'], 'class company {}'],
				[['fixtures', 'service', 'deep', 'conway.js'], 'export function conway() {}'],
				[['fixtures', 'service', 'deep', 'employee.js'], 'export const employee = "jax"'],
				[['fixtures', 'service', 'deep', 'small.js'], ''],
				[['fixtures', 'service', 'binary.txt'], '<p>p</p>'],
			] as const)
				.map(([path, contents]) => [userdataURIFromPaths(path), contents] as const)
				.map(([uri, contents]) => service.createFile(uri, VSBuffer.fromString(contents)))
		);
	};

	const reload = async () => {
		const logService = new NullLogService();

		service = new FileService(logService);
		disposables.add(service);

		logFileProvider = assertIsDefined(await new IndexedDB().createFileSystemProvider(Schemas.file, INDEXEDDB_LOGS_OBJECT_STORE));
		disposables.add(service.registerProvider(logSchema, logFileProvider));
		disposables.add(logFileProvider);

		userdataFileProvider = assertIsDefined(await new IndexedDB().createFileSystemProvider(logSchema, INDEXEDDB_USERDATA_OBJECT_STORE));
		disposables.add(service.registerProvider(Schemas.userData, userdataFileProvider));
		disposables.add(userdataFileProvider);
	};

	setup(async function () {
		this.timeout(15000);
		await reload();
	});

	teardown(async () => {
		disposables.clear();
		await logFileProvider.delete(logfileURIFromPaths([]), { recursive: true, useTrash: false });
		await userdataFileProvider.delete(userdataURIFromPaths([]), { recursive: true, useTrash: false });
	});

	test('root is always present', async () => {
		assert.strictEqual((await userdataFileProvider.stat(userdataURIFromPaths([]))).type, FileType.Directory);
		await userdataFileProvider.delete(userdataURIFromPaths([]), { recursive: true, useTrash: false });
		assert.strictEqual((await userdataFileProvider.stat(userdataURIFromPaths([]))).type, FileType.Directory);
	});

	test('createFolder', async () => {
		let event: FileOperationEvent | undefined;
		disposables.add(service.onDidRunOperation(e => event = e));

		const parent = await service.resolve(userdataURIFromPaths([]));
		const newFolderResource = joinPath(parent.resource, 'newFolder');

		assert.strictEqual((await userdataFileProvider.readdir(parent.resource)).length, 0);
		const newFolder = await service.createFolder(newFolderResource);
		assert.strictEqual(newFolder.name, 'newFolder');
		assert.strictEqual((await userdataFileProvider.readdir(parent.resource)).length, 1);
		assert.strictEqual((await userdataFileProvider.stat(newFolderResource)).type, FileType.Directory);

		assert.ok(event);
		assert.strictEqual(event!.resource.path, newFolderResource.path);
		assert.strictEqual(event!.operation, FileOperation.CREATE);
		assert.strictEqual(event!.target!.resource.path, newFolderResource.path);
		assert.strictEqual(event!.target!.isDirectory, true);
	});

	test('createFolder: creating multiple folders at once', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const multiFolderPaths = ['a', 'couple', 'of', 'folders'];
		const parent = await service.resolve(userdataURIFromPaths([]));
		const newFolderResource = joinPath(parent.resource, ...multiFolderPaths);

		const newFolder = await service.createFolder(newFolderResource);

		const lastFolderName = multiFolderPaths[multiFolderPaths.length - 1];
		assert.strictEqual(newFolder.name, lastFolderName);
		assert.strictEqual((await userdataFileProvider.stat(newFolderResource)).type, FileType.Directory);

		assert.ok(event!);
		assert.strictEqual(event!.resource.path, newFolderResource.path);
		assert.strictEqual(event!.operation, FileOperation.CREATE);
		assert.strictEqual(event!.target!.resource.path, newFolderResource.path);
		assert.strictEqual(event!.target!.isDirectory, true);
	});

	test('exists', async () => {
		let exists = await service.exists(userdataURIFromPaths([]));
		assert.strictEqual(exists, true);

		exists = await service.exists(userdataURIFromPaths(['hello']));
		assert.strictEqual(exists, false);
	});

	test('resolve - file', async () => {
		await initFixtures();

		const resource = userdataURIFromPaths(['fixtures', 'resolver', 'index.html']);
		const resolved = await service.resolve(resource);

		assert.strictEqual(resolved.name, 'index.html');
		assert.strictEqual(resolved.isFile, true);
		assert.strictEqual(resolved.isDirectory, false);
		assert.strictEqual(resolved.isSymbolicLink, false);
		assert.strictEqual(resolved.resource.toString(), resource.toString());
		assert.strictEqual(resolved.children, undefined);
		assert.ok(resolved.size! > 0);
	});

	test('resolve - directory', async () => {
		await initFixtures();

		const testsElements = ['examples', 'other', 'index.html', 'site.css'];

		const resource = userdataURIFromPaths(['fixtures', 'resolver']);
		const result = await service.resolve(resource);

		assert.ok(result);
		assert.strictEqual(result.resource.toString(), resource.toString());
		assert.strictEqual(result.name, 'resolver');
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result!.isDirectory);
		assert.strictEqual(result.children!.length, testsElements.length);

		assert.ok(result.children!.every(entry => {
			return testsElements.some(name => {
				return basename(entry.resource) === name;
			});
		}));

		result.children!.forEach(value => {
			assert.ok(basename(value.resource));
			if (['examples', 'other'].indexOf(basename(value.resource)) >= 0) {
				assert.ok(value.isDirectory);
				assert.strictEqual(value.mtime, undefined);
				assert.strictEqual(value.ctime, undefined);
			} else if (basename(value.resource) === 'index.html') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.strictEqual(value.mtime, undefined);
				assert.strictEqual(value.ctime, undefined);
			} else if (basename(value.resource) === 'site.css') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.strictEqual(value.mtime, undefined);
				assert.strictEqual(value.ctime, undefined);
			} else {
				assert.ok(!'Unexpected value ' + basename(value.resource));
			}
		});
	});

	test('createFile', async () => {
		return assertCreateFile(contents => VSBuffer.fromString(contents));
	});

	test('createFile (readable)', async () => {
		return assertCreateFile(contents => bufferToReadable(VSBuffer.fromString(contents)));
	});

	test('createFile (stream)', async () => {
		return assertCreateFile(contents => bufferToStream(VSBuffer.fromString(contents)));
	});

	async function assertCreateFile(converter: (content: string) => VSBuffer | VSBufferReadable | VSBufferReadableStream): Promise<void> {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const contents = 'Hello World';
		const resource = userdataURIFromPaths(['test.txt']);

		assert.strictEqual(await service.canCreateFile(resource), true);
		const fileStat = await service.createFile(resource, converter(contents));
		assert.strictEqual(fileStat.name, 'test.txt');
		assert.strictEqual((await userdataFileProvider.stat(fileStat.resource)).type, FileType.File);
		assert.strictEqual(new TextDecoder().decode(await userdataFileProvider.readFile(fileStat.resource)), contents);

		assert.ok(event!);
		assert.strictEqual(event!.resource.path, resource.path);
		assert.strictEqual(event!.operation, FileOperation.CREATE);
		assert.strictEqual(event!.target!.resource.path, resource.path);
	}

	const makeBatchTester = (size: number, name: string) => {
		const batch = Array.from({ length: 50 }).map((_, i) => ({ contents: `Hello${i}`, resource: userdataURIFromPaths(['batched', name, `Hello${i}.txt`]) }));
		let stats: Promise<IFileStatWithMetadata[]> | undefined = undefined;
		return {
			async create() {
				return stats = Promise.all(batch.map(entry => service.createFile(entry.resource, VSBuffer.fromString(entry.contents))));
			},
			async assertContentsCorrect() {
				await Promise.all(batch.map(async (entry, i) => {
					if (!stats) { throw Error('read called before create'); }
					const stat = (await stats!)[i];
					assert.strictEqual(stat.name, `Hello${i}.txt`);
					assert.strictEqual((await userdataFileProvider.stat(stat.resource)).type, FileType.File);
					assert.strictEqual(new TextDecoder().decode(await userdataFileProvider.readFile(stat.resource)), entry.contents);
				}));
			},
			async delete() {
				await service.del(userdataURIFromPaths(['batched', name]), { recursive: true, useTrash: false });
			},
			async assertContentsEmpty() {
				if (!stats) { throw Error('assertContentsEmpty called before create'); }
				await Promise.all((await stats).map(async stat => {
					const newStat = await userdataFileProvider.stat(stat.resource).catch(e => e.code);
					assert.strictEqual(newStat, FileSystemProviderErrorCode.FileNotFound);
				}));
			}
		};
	};

	test('createFile (small batch)', async () => {
		const tester = makeBatchTester(50, 'smallBatch');
		await tester.create();
		await tester.assertContentsCorrect();
		await tester.delete();
		await tester.assertContentsEmpty();
	});

	test('createFile (mixed parallel/sequential)', async () => {
		const single1 = makeBatchTester(1, 'single1');
		const single2 = makeBatchTester(1, 'single2');

		const batch1 = makeBatchTester(20, 'batch1');
		const batch2 = makeBatchTester(20, 'batch2');

		single1.create();
		batch1.create();
		await Promise.all([single1.assertContentsCorrect(), batch1.assertContentsCorrect()]);
		single2.create();
		batch2.create();
		await Promise.all([single2.assertContentsCorrect(), batch2.assertContentsCorrect()]);
		await Promise.all([single1.assertContentsCorrect(), batch1.assertContentsCorrect()]);

		await (Promise.all([single1.delete(), single2.delete(), batch1.delete(), batch2.delete()]));
		await (Promise.all([single1.assertContentsEmpty(), single2.assertContentsEmpty(), batch1.assertContentsEmpty(), batch2.assertContentsEmpty()]));
	});

	test('deleteFile', async () => {
		await initFixtures();

		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const anotherResource = userdataURIFromPaths(['fixtures', 'service', 'deep', 'company.js']);
		const resource = userdataURIFromPaths(['fixtures', 'service', 'deep', 'conway.js']);
		const source = await service.resolve(resource);

		assert.strictEqual(await service.canDelete(source.resource, { useTrash: false }), true);
		await service.del(source.resource, { useTrash: false });

		assert.strictEqual(await service.exists(source.resource), false);
		assert.strictEqual(await service.exists(anotherResource), true);

		assert.ok(event!);
		assert.strictEqual(event!.resource.path, resource.path);
		assert.strictEqual(event!.operation, FileOperation.DELETE);

		{
			let error: Error | undefined = undefined;
			try {
				await service.del(source.resource, { useTrash: false });
			} catch (e) {
				error = e;
			}

			assert.ok(error);
			assert.strictEqual((<FileOperationError>error).fileOperationResult, FileOperationResult.FILE_NOT_FOUND);
		}
		await reload();
		{
			let error: Error | undefined = undefined;
			try {
				await service.del(source.resource, { useTrash: false });
			} catch (e) {
				error = e;
			}

			assert.ok(error);
			assert.strictEqual((<FileOperationError>error).fileOperationResult, FileOperationResult.FILE_NOT_FOUND);
		}
	});

	test('deleteFolder (recursive)', async () => {
		await initFixtures();
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const resource = userdataURIFromPaths(['fixtures', 'service', 'deep']);
		const subResource1 = userdataURIFromPaths(['fixtures', 'service', 'deep', 'company.js']);
		const subResource2 = userdataURIFromPaths(['fixtures', 'service', 'deep', 'conway.js']);
		assert.strictEqual(await service.exists(subResource1), true);
		assert.strictEqual(await service.exists(subResource2), true);

		const source = await service.resolve(resource);

		assert.strictEqual(await service.canDelete(source.resource, { recursive: true, useTrash: false }), true);
		await service.del(source.resource, { recursive: true, useTrash: false });

		assert.strictEqual(await service.exists(source.resource), false);
		assert.strictEqual(await service.exists(subResource1), false);
		assert.strictEqual(await service.exists(subResource2), false);
		assert.ok(event!);
		assert.strictEqual(event!.resource.fsPath, resource.fsPath);
		assert.strictEqual(event!.operation, FileOperation.DELETE);
	});


	test('deleteFolder (non recursive)', async () => {
		await initFixtures();
		const resource = userdataURIFromPaths(['fixtures', 'service', 'deep']);
		const source = await service.resolve(resource);

		assert.ok((await service.canDelete(source.resource)) instanceof Error);

		let error;
		try {
			await service.del(source.resource);
		} catch (e) {
			error = e;
		}
		assert.ok(error);
	});
});
