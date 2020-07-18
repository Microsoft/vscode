/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { tmpdir } from 'os';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { generateUuid } from 'vs/base/common/uuid';
import { join, basename, dirname, posix } from 'vs/base/common/path';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { copy, rimraf, symlink, RimRafMode, rimrafSync } from 'vs/base/node/pfs';
import { URI } from 'vs/base/common/uri';
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, createReadStream } from 'fs';
import { FileOperation, FileOperationEvent, IFileStat, FileOperationResult, FileSystemProviderCapabilities, FileChangeType, IFileChange, FileChangesEvent, FileOperationError, etag, IStat, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { NullLogService } from 'vs/platform/log/common/log';
import { isLinux, isWindows } from 'vs/base/common/platform';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { isEqual, joinPath } from 'vs/base/common/resources';
import { VSBuffer, VSBufferReadable, streamToBufferReadableStream, VSBufferReadableStream, bufferToReadable, bufferToStream, streamToBuffer } from 'vs/base/common/buffer';

function getByName(root: IFileStat, name: string): IFileStat | undefined {
	if (root.children === undefined) {
		return undefined;
	}

	return root.children.find(child => child.name === name);
}

function toLineByLineReadable(content: string): VSBufferReadable {
	let chunks = content.split('\n');
	chunks = chunks.map((chunk, index) => {
		if (index === 0) {
			return chunk;
		}

		return '\n' + chunk;
	});

	return {
		read(): VSBuffer | null {
			const chunk = chunks.shift();
			if (typeof chunk === 'string') {
				return VSBuffer.fromString(chunk);
			}

			return null;
		}
	};
}

export class TestDiskFileSystemProvider extends DiskFileSystemProvider {

	totalBytesRead: number = 0;

	private invalidStatSize: boolean = false;
	private smallStatSize: boolean = false;

	private _testCapabilities!: FileSystemProviderCapabilities;
	get capabilities(): FileSystemProviderCapabilities {
		if (!this._testCapabilities) {
			this._testCapabilities =
				FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.FileOpenReadWriteClose |
				FileSystemProviderCapabilities.FileReadStream |
				FileSystemProviderCapabilities.Trash |
				FileSystemProviderCapabilities.FileFolderCopy;

			if (isLinux) {
				this._testCapabilities |= FileSystemProviderCapabilities.PathCaseSensitive;
			}
		}

		return this._testCapabilities;
	}

	set capabilities(capabilities: FileSystemProviderCapabilities) {
		this._testCapabilities = capabilities;
	}

	setInvalidStatSize(enabled: boolean): void {
		this.invalidStatSize = enabled;
	}

	setSmallStatSize(enabled: boolean): void {
		this.smallStatSize = enabled;
	}

	async stat(resource: URI): Promise<IStat> {
		const res = await super.stat(resource);

		if (this.invalidStatSize) {
			res.size = String(res.size) as any; // for https://github.com/Microsoft/vscode/issues/72909
		} else if (this.smallStatSize) {
			res.size = 1;
		}

		return res;
	}

	async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const bytesRead = await super.read(fd, pos, data, offset, length);

		this.totalBytesRead += bytesRead;

		return bytesRead;
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const res = await super.readFile(resource);

		this.totalBytesRead += res.byteLength;

		return res;
	}
}

suite('Disk File Service', function () {

	const parentDir = getRandomTestPath(tmpdir(), 'vsctests', 'diskfileservice');
	const testSchema = 'test';

	let service: FileService;
	let fileProvider: TestDiskFileSystemProvider;
	let testProvider: TestDiskFileSystemProvider;
	let testDir: string;

	const disposables = new DisposableStore();

	// Given issues such as https://github.com/microsoft/vscode/issues/78602
	// and https://github.com/microsoft/vscode/issues/92334 we see random test
	// failures when accessing the native file system. To diagnose further, we
	// retry node.js file access tests up to 3 times to rule out any random disk
	// issue and increase the timeout.
	this.retries(3);
	this.timeout(1000 * 10);

	setup(async () => {
		const logService = new NullLogService();

		service = new FileService(logService);
		disposables.add(service);

		fileProvider = new TestDiskFileSystemProvider(logService);
		disposables.add(service.registerProvider(Schemas.file, fileProvider));
		disposables.add(fileProvider);

		testProvider = new TestDiskFileSystemProvider(logService);
		disposables.add(service.registerProvider(testSchema, testProvider));
		disposables.add(testProvider);

		const id = generateUuid();
		testDir = join(parentDir, id);
		const sourceDir = getPathFromAmdModule(require, './fixtures/service');

		await copy(sourceDir, testDir);
	});

	teardown(async () => {
		disposables.clear();

		await rimraf(parentDir, RimRafMode.MOVE);
	});

	test('createFolder', async () => {
		let event: FileOperationEvent | undefined;
		disposables.add(service.onDidRunOperation(e => event = e));

		const parent = await service.resolve(URI.file(testDir));

		const newFolderResource = URI.file(join(parent.resource.fsPath, 'newFolder'));

		const newFolder = await service.createFolder(newFolderResource);

		assert.equal(newFolder.name, 'newFolder');
		assert.equal(existsSync(newFolder.resource.fsPath), true);

		assert.ok(event);
		assert.equal(event!.resource.fsPath, newFolderResource.fsPath);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.fsPath, newFolderResource.fsPath);
		assert.equal(event!.target!.isDirectory, true);
	});

	test('createFolder: creating multiple folders at once', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const multiFolderPaths = ['a', 'couple', 'of', 'folders'];
		const parent = await service.resolve(URI.file(testDir));

		const newFolderResource = URI.file(join(parent.resource.fsPath, ...multiFolderPaths));

		const newFolder = await service.createFolder(newFolderResource);

		const lastFolderName = multiFolderPaths[multiFolderPaths.length - 1];
		assert.equal(newFolder.name, lastFolderName);
		assert.equal(existsSync(newFolder.resource.fsPath), true);

		assert.ok(event!);
		assert.equal(event!.resource.fsPath, newFolderResource.fsPath);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.fsPath, newFolderResource.fsPath);
		assert.equal(event!.target!.isDirectory, true);
	});

	test('exists', async () => {
		let exists = await service.exists(URI.file(testDir));
		assert.equal(exists, true);

		exists = await service.exists(URI.file(testDir + 'something'));
		assert.equal(exists, false);
	});

	test('resolve - file', async () => {
		const resource = URI.file(getPathFromAmdModule(require, './fixtures/resolver/index.html'));
		const resolved = await service.resolve(resource);

		assert.equal(resolved.name, 'index.html');
		assert.equal(resolved.isFile, true);
		assert.equal(resolved.isDirectory, false);
		assert.equal(resolved.isSymbolicLink, false);
		assert.equal(resolved.resource.toString(), resource.toString());
		assert.equal(resolved.children, undefined);
		assert.ok(resolved.mtime! > 0);
		assert.ok(resolved.ctime! > 0);
		assert.ok(resolved.size! > 0);
	});

	test('resolve - directory', async () => {
		const testsElements = ['examples', 'other', 'index.html', 'site.css'];

		const resource = URI.file(getPathFromAmdModule(require, './fixtures/resolver'));
		const result = await service.resolve(resource);

		assert.ok(result);
		assert.equal(result.resource.toString(), resource.toString());
		assert.equal(result.name, 'resolver');
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result!.isDirectory);
		assert.ok(result.mtime! > 0);
		assert.ok(result.ctime! > 0);
		assert.equal(result.children!.length, testsElements.length);

		assert.ok(result.children!.every(entry => {
			return testsElements.some(name => {
				return basename(entry.resource.fsPath) === name;
			});
		}));

		result.children!.forEach(value => {
			assert.ok(basename(value.resource.fsPath));
			if (['examples', 'other'].indexOf(basename(value.resource.fsPath)) >= 0) {
				assert.ok(value.isDirectory);
				assert.equal(value.mtime, undefined);
				assert.equal(value.ctime, undefined);
			} else if (basename(value.resource.fsPath) === 'index.html') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.equal(value.mtime, undefined);
				assert.equal(value.ctime, undefined);
			} else if (basename(value.resource.fsPath) === 'site.css') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.equal(value.mtime, undefined);
				assert.equal(value.ctime, undefined);
			} else {
				assert.ok(!'Unexpected value ' + basename(value.resource.fsPath));
			}
		});
	});

	test('resolve - directory - with metadata', async () => {
		const testsElements = ['examples', 'other', 'index.html', 'site.css'];

		const result = await service.resolve(URI.file(getPathFromAmdModule(require, './fixtures/resolver')), { resolveMetadata: true });

		assert.ok(result);
		assert.equal(result.name, 'resolver');
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result!.isDirectory);
		assert.ok(result.mtime! > 0);
		assert.ok(result.ctime! > 0);
		assert.equal(result.children!.length, testsElements.length);

		assert.ok(result.children!.every(entry => {
			return testsElements.some(name => {
				return basename(entry.resource.fsPath) === name;
			});
		}));

		assert.ok(result.children!.every(entry => entry.etag.length > 0));

		result.children!.forEach(value => {
			assert.ok(basename(value.resource.fsPath));
			if (['examples', 'other'].indexOf(basename(value.resource.fsPath)) >= 0) {
				assert.ok(value.isDirectory);
				assert.ok(value.mtime! > 0);
				assert.ok(value.ctime! > 0);
			} else if (basename(value.resource.fsPath) === 'index.html') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.ok(value.mtime! > 0);
				assert.ok(value.ctime! > 0);
			} else if (basename(value.resource.fsPath) === 'site.css') {
				assert.ok(!value.isDirectory);
				assert.ok(!value.children);
				assert.ok(value.mtime! > 0);
				assert.ok(value.ctime! > 0);
			} else {
				assert.ok(!'Unexpected value ' + basename(value.resource.fsPath));
			}
		});
	});

	test('resolve - directory with resolveTo', async () => {
		const resolved = await service.resolve(URI.file(testDir), { resolveTo: [URI.file(join(testDir, 'deep'))] });
		assert.equal(resolved.children!.length, 8);

		const deep = (getByName(resolved, 'deep')!);
		assert.equal(deep.children!.length, 4);
	});

	test('resolve - directory - resolveTo single directory', async () => {
		const resolverFixturesPath = getPathFromAmdModule(require, './fixtures/resolver');
		const result = await service.resolve(URI.file(resolverFixturesPath), { resolveTo: [URI.file(join(resolverFixturesPath, 'other/deep'))] });

		assert.ok(result);
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result.isDirectory);

		const children = result.children!;
		assert.equal(children.length, 4);

		const other = getByName(result, 'other');
		assert.ok(other);
		assert.ok(other!.children!.length > 0);

		const deep = getByName(other!, 'deep');
		assert.ok(deep);
		assert.ok(deep!.children!.length > 0);
		assert.equal(deep!.children!.length, 4);
	});

	test('resolve directory - resolveTo multiple directories', async () => {
		const resolverFixturesPath = getPathFromAmdModule(require, './fixtures/resolver');
		const result = await service.resolve(URI.file(resolverFixturesPath), {
			resolveTo: [
				URI.file(join(resolverFixturesPath, 'other/deep')),
				URI.file(join(resolverFixturesPath, 'examples'))
			]
		});

		assert.ok(result);
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result.isDirectory);

		const children = result.children!;
		assert.equal(children.length, 4);

		const other = getByName(result, 'other');
		assert.ok(other);
		assert.ok(other!.children!.length > 0);

		const deep = getByName(other!, 'deep');
		assert.ok(deep);
		assert.ok(deep!.children!.length > 0);
		assert.equal(deep!.children!.length, 4);

		const examples = getByName(result, 'examples');
		assert.ok(examples);
		assert.ok(examples!.children!.length > 0);
		assert.equal(examples!.children!.length, 4);
	});

	test('resolve directory - resolveSingleChildFolders', async () => {
		const resolverFixturesPath = getPathFromAmdModule(require, './fixtures/resolver/other');
		const result = await service.resolve(URI.file(resolverFixturesPath), { resolveSingleChildDescendants: true });

		assert.ok(result);
		assert.ok(result.children);
		assert.ok(result.children!.length > 0);
		assert.ok(result.isDirectory);

		const children = result.children!;
		assert.equal(children.length, 1);

		let deep = getByName(result, 'deep');
		assert.ok(deep);
		assert.ok(deep!.children!.length > 0);
		assert.equal(deep!.children!.length, 4);
	});

	test('resolves', async () => {
		const res = await service.resolveAll([
			{ resource: URI.file(testDir), options: { resolveTo: [URI.file(join(testDir, 'deep'))] } },
			{ resource: URI.file(join(testDir, 'deep')) }
		]);

		const r1 = (res[0].stat!);
		assert.equal(r1.children!.length, 8);

		const deep = (getByName(r1, 'deep')!);
		assert.equal(deep.children!.length, 4);

		const r2 = (res[1].stat!);
		assert.equal(r2.children!.length, 4);
		assert.equal(r2.name, 'deep');
	});

	(isWindows /* not reliable on windows */ ? test.skip : test)('resolve - folder symbolic link', async () => {
		const link = URI.file(join(testDir, 'deep-link'));
		await symlink(join(testDir, 'deep'), link.fsPath);

		const resolved = await service.resolve(link);
		assert.equal(resolved.children!.length, 4);
		assert.equal(resolved.isDirectory, true);
		assert.equal(resolved.isSymbolicLink, true);
	});

	(isWindows /* not reliable on windows */ ? test.skip : test)('resolve - file symbolic link', async () => {
		const link = URI.file(join(testDir, 'lorem.txt-linked'));
		await symlink(join(testDir, 'lorem.txt'), link.fsPath);

		const resolved = await service.resolve(link);
		assert.equal(resolved.isDirectory, false);
		assert.equal(resolved.isSymbolicLink, true);
	});

	(isWindows /* not reliable on windows */ ? test.skip : test)('resolve - symbolic link pointing to non-existing file does not break', async () => {
		await symlink(join(testDir, 'foo'), join(testDir, 'bar'));

		const resolved = await service.resolve(URI.file(testDir));
		assert.equal(resolved.isDirectory, true);
		assert.equal(resolved.children!.length, 9);

		const resolvedLink = resolved.children?.find(child => child.name === 'bar' && child.isSymbolicLink);
		assert.ok(resolvedLink);

		assert.ok(!resolvedLink?.isDirectory);
		assert.ok(!resolvedLink?.isFile);
	});

	test('deleteFile', async () => {
		return testDeleteFile(false);
	});

	(isLinux /* trash is unreliable on Linux */ ? test.skip : test)('deleteFile (useTrash)', async () => {
		return testDeleteFile(true);
	});

	async function testDeleteFile(useTrash: boolean): Promise<void> {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const resource = URI.file(join(testDir, 'deep', 'conway.js'));
		const source = await service.resolve(resource);

		assert.equal(await service.canDelete(source.resource, { useTrash }), true);
		await service.del(source.resource, { useTrash });

		assert.equal(existsSync(source.resource.fsPath), false);

		assert.ok(event!);
		assert.equal(event!.resource.fsPath, resource.fsPath);
		assert.equal(event!.operation, FileOperation.DELETE);

		let error: Error | undefined = undefined;
		try {
			await service.del(source.resource, { useTrash });
		} catch (e) {
			error = e;
		}

		assert.ok(error);
		assert.equal((<FileOperationError>error).fileOperationResult, FileOperationResult.FILE_NOT_FOUND);
	}

	(isWindows /* not reliable on windows */ ? test.skip : test)('deleteFile - symbolic link (exists)', async () => {
		const target = URI.file(join(testDir, 'lorem.txt'));
		const link = URI.file(join(testDir, 'lorem.txt-linked'));
		await symlink(target.fsPath, link.fsPath);

		const source = await service.resolve(link);

		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		assert.equal(await service.canDelete(source.resource), true);
		await service.del(source.resource);

		assert.equal(existsSync(source.resource.fsPath), false);

		assert.ok(event!);
		assert.equal(event!.resource.fsPath, link.fsPath);
		assert.equal(event!.operation, FileOperation.DELETE);

		assert.equal(existsSync(target.fsPath), true); // target the link pointed to is never deleted
	});

	(isWindows /* not reliable on windows */ ? test.skip : test)('deleteFile - symbolic link (pointing to non-existing file)', async () => {
		const target = URI.file(join(testDir, 'foo'));
		const link = URI.file(join(testDir, 'bar'));
		await symlink(target.fsPath, link.fsPath);

		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		assert.equal(await service.canDelete(link), true);
		await service.del(link);

		assert.equal(existsSync(link.fsPath), false);

		assert.ok(event!);
		assert.equal(event!.resource.fsPath, link.fsPath);
		assert.equal(event!.operation, FileOperation.DELETE);
	});

	test('deleteFolder (recursive)', async () => {
		return testDeleteFolderRecursive(false);
	});

	(isLinux /* trash is unreliable on Linux */ ? test.skip : test)('deleteFolder (recursive, useTrash)', async () => {
		return testDeleteFolderRecursive(true);
	});

	async function testDeleteFolderRecursive(useTrash: boolean): Promise<void> {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const resource = URI.file(join(testDir, 'deep'));
		const source = await service.resolve(resource);

		assert.equal(await service.canDelete(source.resource, { recursive: true, useTrash }), true);
		await service.del(source.resource, { recursive: true, useTrash });

		assert.equal(existsSync(source.resource.fsPath), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, resource.fsPath);
		assert.equal(event!.operation, FileOperation.DELETE);
	}

	test('deleteFolder (non recursive)', async () => {
		const resource = URI.file(join(testDir, 'deep'));
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

	test('move', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = URI.file(join(testDir, 'index.html'));
		const sourceContents = readFileSync(source.fsPath);

		const target = URI.file(join(dirname(source.fsPath), 'other.html'));

		assert.equal(await service.canMove(source, target), true);
		const renamed = await service.move(source, target);

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(existsSync(source.fsPath), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.fsPath);
		assert.equal(event!.operation, FileOperation.MOVE);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);

		const targetContents = readFileSync(target.fsPath);

		assert.equal(sourceContents.byteLength, targetContents.byteLength);
		assert.equal(sourceContents.toString(), targetContents.toString());
	});

	test('move - across providers (buffered => buffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testMoveAcrossProviders();
	});

	test('move - across providers (unbuffered => unbuffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testMoveAcrossProviders();
	});

	test('move - across providers (buffered => unbuffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testMoveAcrossProviders();
	});

	test('move - across providers (unbuffered => buffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testMoveAcrossProviders();
	});

	test('move - across providers - large (buffered => buffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testMoveAcrossProviders('lorem.txt');
	});

	test('move - across providers - large (unbuffered => unbuffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testMoveAcrossProviders('lorem.txt');
	});

	test('move - across providers - large (buffered => unbuffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testMoveAcrossProviders('lorem.txt');
	});

	test('move - across providers - large (unbuffered => buffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testMoveAcrossProviders('lorem.txt');
	});

	async function testMoveAcrossProviders(sourceFile = 'index.html'): Promise<void> {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = URI.file(join(testDir, sourceFile));
		const sourceContents = readFileSync(source.fsPath);

		const target = URI.file(join(dirname(source.fsPath), 'other.html')).with({ scheme: testSchema });

		assert.equal(await service.canMove(source, target), true);
		const renamed = await service.move(source, target);

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(existsSync(source.fsPath), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.fsPath);
		assert.equal(event!.operation, FileOperation.COPY);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);

		const targetContents = readFileSync(target.fsPath);

		assert.equal(sourceContents.byteLength, targetContents.byteLength);
		assert.equal(sourceContents.toString(), targetContents.toString());
	}

	test('move - multi folder', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const multiFolderPaths = ['a', 'couple', 'of', 'folders'];
		const renameToPath = join(...multiFolderPaths, 'other.html');

		const source = URI.file(join(testDir, 'index.html'));

		assert.equal(await service.canMove(source, URI.file(join(dirname(source.fsPath), renameToPath))), true);
		const renamed = await service.move(source, URI.file(join(dirname(source.fsPath), renameToPath)));

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(existsSync(source.fsPath), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.fsPath);
		assert.equal(event!.operation, FileOperation.MOVE);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);
	});

	test('move - directory', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = URI.file(join(testDir, 'deep'));

		assert.equal(await service.canMove(source, URI.file(join(dirname(source.fsPath), 'deeper'))), true);
		const renamed = await service.move(source, URI.file(join(dirname(source.fsPath), 'deeper')));

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(existsSync(source.fsPath), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.fsPath);
		assert.equal(event!.operation, FileOperation.MOVE);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);
	});

	test('move - directory - across providers (buffered => buffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testMoveFolderAcrossProviders();
	});

	test('move - directory - across providers (unbuffered => unbuffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testMoveFolderAcrossProviders();
	});

	test('move - directory - across providers (buffered => unbuffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testMoveFolderAcrossProviders();
	});

	test('move - directory - across providers (unbuffered => buffered)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);
		setCapabilities(testProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testMoveFolderAcrossProviders();
	});

	async function testMoveFolderAcrossProviders(): Promise<void> {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = URI.file(join(testDir, 'deep'));
		const sourceChildren = readdirSync(source.fsPath);

		const target = URI.file(join(dirname(source.fsPath), 'deeper')).with({ scheme: testSchema });

		assert.equal(await service.canMove(source, target), true);
		const renamed = await service.move(source, target);

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(existsSync(source.fsPath), false);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.fsPath);
		assert.equal(event!.operation, FileOperation.COPY);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);

		const targetChildren = readdirSync(target.fsPath);
		assert.equal(sourceChildren.length, targetChildren.length);
		for (let i = 0; i < sourceChildren.length; i++) {
			assert.equal(sourceChildren[i], targetChildren[i]);
		}
	}

	test('move - MIX CASE', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		assert.ok(source.size > 0);

		const renamedResource = URI.file(join(dirname(source.resource.fsPath), 'INDEX.html'));
		assert.equal(await service.canMove(source.resource, renamedResource), true);
		let renamed = await service.move(source.resource, renamedResource);

		assert.equal(existsSync(renamedResource.fsPath), true);
		assert.equal(basename(renamedResource.fsPath), 'INDEX.html');
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.resource.fsPath);
		assert.equal(event!.operation, FileOperation.MOVE);
		assert.equal(event!.target!.resource.fsPath, renamedResource.fsPath);

		renamed = await service.resolve(renamedResource, { resolveMetadata: true });
		assert.equal(source.size, renamed.size);
	});

	test('move - same file', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		assert.ok(source.size > 0);

		assert.equal(await service.canMove(source.resource, URI.file(source.resource.fsPath)), true);
		let renamed = await service.move(source.resource, URI.file(source.resource.fsPath));

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(basename(renamed.resource.fsPath), 'index.html');
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.resource.fsPath);
		assert.equal(event!.operation, FileOperation.MOVE);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);

		renamed = await service.resolve(renamed.resource, { resolveMetadata: true });
		assert.equal(source.size, renamed.size);
	});

	test('move - same file #2', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		assert.ok(source.size > 0);

		const targetParent = URI.file(testDir);
		const target = targetParent.with({ path: posix.join(targetParent.path, posix.basename(source.resource.path)) });

		assert.equal(await service.canMove(source.resource, target), true);
		let renamed = await service.move(source.resource, target);

		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.equal(basename(renamed.resource.fsPath), 'index.html');
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.resource.fsPath);
		assert.equal(event!.operation, FileOperation.MOVE);
		assert.equal(event!.target!.resource.fsPath, renamed.resource.fsPath);

		renamed = await service.resolve(renamed.resource, { resolveMetadata: true });
		assert.equal(source.size, renamed.size);
	});

	test('move - source parent of target', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		let source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		const originalSize = source.size;
		assert.ok(originalSize > 0);

		assert.ok((await service.canMove(URI.file(testDir), URI.file(join(testDir, 'binary.txt'))) instanceof Error));

		let error;
		try {
			await service.move(URI.file(testDir), URI.file(join(testDir, 'binary.txt')));
		} catch (e) {
			error = e;
		}

		assert.ok(error);
		assert.ok(!event!);

		source = await service.resolve(source.resource, { resolveMetadata: true });
		assert.equal(originalSize, source.size);
	});

	test('move - FILE_MOVE_CONFLICT', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		let source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		const originalSize = source.size;
		assert.ok(originalSize > 0);

		assert.ok((await service.canMove(source.resource, URI.file(join(testDir, 'binary.txt'))) instanceof Error));

		let error;
		try {
			await service.move(source.resource, URI.file(join(testDir, 'binary.txt')));
		} catch (e) {
			error = e;
		}

		assert.equal(error.fileOperationResult, FileOperationResult.FILE_MOVE_CONFLICT);
		assert.ok(!event!);

		source = await service.resolve(source.resource, { resolveMetadata: true });
		assert.equal(originalSize, source.size);
	});

	test('move - overwrite folder with file', async () => {
		let createEvent: FileOperationEvent;
		let moveEvent: FileOperationEvent;
		let deleteEvent: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => {
			if (e.operation === FileOperation.CREATE) {
				createEvent = e;
			} else if (e.operation === FileOperation.DELETE) {
				deleteEvent = e;
			} else if (e.operation === FileOperation.MOVE) {
				moveEvent = e;
			}
		}));

		const parent = await service.resolve(URI.file(testDir));
		const folderResource = URI.file(join(parent.resource.fsPath, 'conway.js'));
		const f = await service.createFolder(folderResource);
		const source = URI.file(join(testDir, 'deep', 'conway.js'));

		assert.equal(await service.canMove(source, f.resource, true), true);
		const moved = await service.move(source, f.resource, true);

		assert.equal(existsSync(moved.resource.fsPath), true);
		assert.ok(statSync(moved.resource.fsPath).isFile);
		assert.ok(createEvent!);
		assert.ok(deleteEvent!);
		assert.ok(moveEvent!);
		assert.equal(moveEvent!.resource.fsPath, source.fsPath);
		assert.equal(moveEvent!.target!.resource.fsPath, moved.resource.fsPath);
		assert.equal(deleteEvent!.resource.fsPath, folderResource.fsPath);
	});

	test('copy', async () => {
		await doTestCopy();
	});

	test('copy - unbuffered (FileSystemProviderCapabilities.FileReadWrite)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		await doTestCopy();
	});

	test('copy - unbuffered large (FileSystemProviderCapabilities.FileReadWrite)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		await doTestCopy('lorem.txt');
	});

	test('copy - buffered (FileSystemProviderCapabilities.FileOpenReadWriteClose)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		await doTestCopy();
	});

	test('copy - buffered large (FileSystemProviderCapabilities.FileOpenReadWriteClose)', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		await doTestCopy('lorem.txt');
	});

	function setCapabilities(provider: TestDiskFileSystemProvider, capabilities: FileSystemProviderCapabilities): void {
		provider.capabilities = capabilities;
		if (isLinux) {
			provider.capabilities |= FileSystemProviderCapabilities.PathCaseSensitive;
		}
	}

	async function doTestCopy(sourceName: string = 'index.html') {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = await service.resolve(URI.file(join(testDir, sourceName)));
		const target = URI.file(join(testDir, 'other.html'));

		assert.equal(await service.canCopy(source.resource, target), true);
		const copied = await service.copy(source.resource, target);

		assert.equal(existsSync(copied.resource.fsPath), true);
		assert.equal(existsSync(source.resource.fsPath), true);
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.resource.fsPath);
		assert.equal(event!.operation, FileOperation.COPY);
		assert.equal(event!.target!.resource.fsPath, copied.resource.fsPath);

		const sourceContents = readFileSync(source.resource.fsPath);
		const targetContents = readFileSync(target.fsPath);

		assert.equal(sourceContents.byteLength, targetContents.byteLength);
		assert.equal(sourceContents.toString(), targetContents.toString());
	}

	test('copy - overwrite folder with file', async () => {
		let createEvent: FileOperationEvent;
		let copyEvent: FileOperationEvent;
		let deleteEvent: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => {
			if (e.operation === FileOperation.CREATE) {
				createEvent = e;
			} else if (e.operation === FileOperation.DELETE) {
				deleteEvent = e;
			} else if (e.operation === FileOperation.COPY) {
				copyEvent = e;
			}
		}));

		const parent = await service.resolve(URI.file(testDir));
		const folderResource = URI.file(join(parent.resource.fsPath, 'conway.js'));
		const f = await service.createFolder(folderResource);
		const source = URI.file(join(testDir, 'deep', 'conway.js'));

		assert.equal(await service.canCopy(source, f.resource, true), true);
		const copied = await service.copy(source, f.resource, true);

		assert.equal(existsSync(copied.resource.fsPath), true);
		assert.ok(statSync(copied.resource.fsPath).isFile);
		assert.ok(createEvent!);
		assert.ok(deleteEvent!);
		assert.ok(copyEvent!);
		assert.equal(copyEvent!.resource.fsPath, source.fsPath);
		assert.equal(copyEvent!.target!.resource.fsPath, copied.resource.fsPath);
		assert.equal(deleteEvent!.resource.fsPath, folderResource.fsPath);
	});

	test('copy - MIX CASE same target - no overwrite', async () => {
		let source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		const originalSize = source.size;
		assert.ok(originalSize > 0);

		const target = URI.file(join(dirname(source.resource.fsPath), 'INDEX.html'));

		const canCopy = await service.canCopy(source.resource, target);

		let error;
		let copied: IFileStatWithMetadata;
		try {
			copied = await service.copy(source.resource, target);
		} catch (e) {
			error = e;
		}

		if (isLinux) {
			assert.ok(!error);
			assert.equal(canCopy, true);

			assert.equal(existsSync(copied!.resource.fsPath), true);
			assert.ok(readdirSync(testDir).some(f => f === 'INDEX.html'));
			assert.equal(source.size, copied!.size);
		} else {
			assert.ok(error);
			assert.ok(canCopy instanceof Error);

			source = await service.resolve(source.resource, { resolveMetadata: true });
			assert.equal(originalSize, source.size);
		}
	});

	test('copy - MIX CASE same target - overwrite', async () => {
		let source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		const originalSize = source.size;
		assert.ok(originalSize > 0);

		const target = URI.file(join(dirname(source.resource.fsPath), 'INDEX.html'));

		const canCopy = await service.canCopy(source.resource, target, true);

		let error;
		let copied: IFileStatWithMetadata;
		try {
			copied = await service.copy(source.resource, target, true);
		} catch (e) {
			error = e;
		}

		if (isLinux) {
			assert.ok(!error);
			assert.equal(canCopy, true);

			assert.equal(existsSync(copied!.resource.fsPath), true);
			assert.ok(readdirSync(testDir).some(f => f === 'INDEX.html'));
			assert.equal(source.size, copied!.size);
		} else {
			assert.ok(error);
			assert.ok(canCopy instanceof Error);

			source = await service.resolve(source.resource, { resolveMetadata: true });
			assert.equal(originalSize, source.size);
		}
	});

	test('copy - MIX CASE different taget - overwrite', async () => {
		const source1 = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		assert.ok(source1.size > 0);

		const renamed = await service.move(source1.resource, URI.file(join(dirname(source1.resource.fsPath), 'CONWAY.js')));
		assert.equal(existsSync(renamed.resource.fsPath), true);
		assert.ok(readdirSync(testDir).some(f => f === 'CONWAY.js'));
		assert.equal(source1.size, renamed.size);

		const source2 = await service.resolve(URI.file(join(testDir, 'deep', 'conway.js')), { resolveMetadata: true });
		const target = URI.file(join(testDir, basename(source2.resource.path)));

		assert.equal(await service.canCopy(source2.resource, target, true), true);
		const res = await service.copy(source2.resource, target, true);
		assert.equal(existsSync(res.resource.fsPath), true);
		assert.ok(readdirSync(testDir).some(f => f === 'conway.js'));
		assert.equal(source2.size, res.size);
	});

	test('copy - same file', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		assert.ok(source.size > 0);

		assert.equal(await service.canCopy(source.resource, URI.file(source.resource.fsPath)), true);
		let copied = await service.copy(source.resource, URI.file(source.resource.fsPath));

		assert.equal(existsSync(copied.resource.fsPath), true);
		assert.equal(basename(copied.resource.fsPath), 'index.html');
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.resource.fsPath);
		assert.equal(event!.operation, FileOperation.COPY);
		assert.equal(event!.target!.resource.fsPath, copied.resource.fsPath);

		copied = await service.resolve(source.resource, { resolveMetadata: true });
		assert.equal(source.size, copied.size);
	});

	test('copy - same file #2', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const source = await service.resolve(URI.file(join(testDir, 'index.html')), { resolveMetadata: true });
		assert.ok(source.size > 0);

		const targetParent = URI.file(testDir);
		const target = targetParent.with({ path: posix.join(targetParent.path, posix.basename(source.resource.path)) });

		assert.equal(await service.canCopy(source.resource, URI.file(target.fsPath)), true);
		let copied = await service.copy(source.resource, URI.file(target.fsPath));

		assert.equal(existsSync(copied.resource.fsPath), true);
		assert.equal(basename(copied.resource.fsPath), 'index.html');
		assert.ok(event!);
		assert.equal(event!.resource.fsPath, source.resource.fsPath);
		assert.equal(event!.operation, FileOperation.COPY);
		assert.equal(event!.target!.resource.fsPath, copied.resource.fsPath);

		copied = await service.resolve(source.resource, { resolveMetadata: true });
		assert.equal(source.size, copied.size);
	});

	test('readFile - small file - default', () => {
		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - small file - buffered', () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - small file - buffered / readonly', () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose | FileSystemProviderCapabilities.Readonly);

		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - small file - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - small file - unbuffered / readonly', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly);

		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - small file - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - small file - streamed / readonly', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream | FileSystemProviderCapabilities.Readonly);

		return testReadFile(URI.file(join(testDir, 'small.txt')));
	});

	test('readFile - large file - default', async () => {
		return testReadFile(URI.file(join(testDir, 'lorem.txt')));
	});

	test('readFile - large file - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testReadFile(URI.file(join(testDir, 'lorem.txt')));
	});

	test('readFile - large file - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testReadFile(URI.file(join(testDir, 'lorem.txt')));
	});

	test('readFile - large file - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testReadFile(URI.file(join(testDir, 'lorem.txt')));
	});

	async function testReadFile(resource: URI): Promise<void> {
		const content = await service.readFile(resource);

		assert.equal(content.value.toString(), readFileSync(resource.fsPath));
	}

	test('readFileStream - small file - default', () => {
		return testReadFileStream(URI.file(join(testDir, 'small.txt')));
	});

	test('readFileStream - small file - buffered', () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testReadFileStream(URI.file(join(testDir, 'small.txt')));
	});

	test('readFileStream - small file - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testReadFileStream(URI.file(join(testDir, 'small.txt')));
	});

	test('readFileStream - small file - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testReadFileStream(URI.file(join(testDir, 'small.txt')));
	});

	async function testReadFileStream(resource: URI): Promise<void> {
		const content = await service.readFileStream(resource);

		assert.equal((await streamToBuffer(content.value)).toString(), readFileSync(resource.fsPath));
	}

	test('readFile - Files are intermingled #38331 - default', async () => {
		return testFilesNotIntermingled();
	});

	test('readFile - Files are intermingled #38331 - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testFilesNotIntermingled();
	});

	test('readFile - Files are intermingled #38331 - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testFilesNotIntermingled();
	});

	test('readFile - Files are intermingled #38331 - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testFilesNotIntermingled();
	});

	async function testFilesNotIntermingled() {
		let resource1 = URI.file(join(testDir, 'lorem.txt'));
		let resource2 = URI.file(join(testDir, 'some_utf16le.css'));

		// load in sequence and keep data
		const value1 = await service.readFile(resource1);
		const value2 = await service.readFile(resource2);

		// load in parallel in expect the same result
		const result = await Promise.all([
			service.readFile(resource1),
			service.readFile(resource2)
		]);

		assert.equal(result[0].value.toString(), value1.value.toString());
		assert.equal(result[1].value.toString(), value2.value.toString());
	}

	test('readFile - from position (ASCII) - default', async () => {
		return testReadFileFromPositionAscii();
	});

	test('readFile - from position (ASCII) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testReadFileFromPositionAscii();
	});

	test('readFile - from position (ASCII) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testReadFileFromPositionAscii();
	});

	test('readFile - from position (ASCII) - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testReadFileFromPositionAscii();
	});

	async function testReadFileFromPositionAscii() {
		const resource = URI.file(join(testDir, 'small.txt'));

		const contents = await service.readFile(resource, { position: 6 });

		assert.equal(contents.value.toString(), 'File');
	}

	test('readFile - from position (with umlaut) - default', async () => {
		return testReadFileFromPositionUmlaut();
	});

	test('readFile - from position (with umlaut) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testReadFileFromPositionUmlaut();
	});

	test('readFile - from position (with umlaut) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testReadFileFromPositionUmlaut();
	});

	test('readFile - from position (with umlaut) - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testReadFileFromPositionUmlaut();
	});

	async function testReadFileFromPositionUmlaut() {
		const resource = URI.file(join(testDir, 'small_umlaut.txt'));

		const contents = await service.readFile(resource, { position: Buffer.from('Small File with Ü').length });

		assert.equal(contents.value.toString(), 'mlaut');
	}

	test('readFile - 3 bytes (ASCII) - default', async () => {
		return testReadThreeBytesFromFile();
	});

	test('readFile - 3 bytes (ASCII) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testReadThreeBytesFromFile();
	});

	test('readFile - 3 bytes (ASCII) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testReadThreeBytesFromFile();
	});

	test('readFile - 3 bytes (ASCII) - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testReadThreeBytesFromFile();
	});

	async function testReadThreeBytesFromFile() {
		const resource = URI.file(join(testDir, 'small.txt'));

		const contents = await service.readFile(resource, { length: 3 });

		assert.equal(contents.value.toString(), 'Sma');
	}

	test('readFile - 20000 bytes (large) - default', async () => {
		return readLargeFileWithLength(20000);
	});

	test('readFile - 20000 bytes (large) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return readLargeFileWithLength(20000);
	});

	test('readFile - 20000 bytes (large) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return readLargeFileWithLength(20000);
	});

	test('readFile - 20000 bytes (large) - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return readLargeFileWithLength(20000);
	});

	test('readFile - 80000 bytes (large) - default', async () => {
		return readLargeFileWithLength(80000);
	});

	test('readFile - 80000 bytes (large) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return readLargeFileWithLength(80000);
	});

	test('readFile - 80000 bytes (large) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return readLargeFileWithLength(80000);
	});

	test('readFile - 80000 bytes (large) - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return readLargeFileWithLength(80000);
	});

	async function readLargeFileWithLength(length: number) {
		const resource = URI.file(join(testDir, 'lorem.txt'));

		const contents = await service.readFile(resource, { length });

		assert.equal(contents.value.byteLength, length);
	}

	test('readFile - FILE_IS_DIRECTORY', async () => {
		const resource = URI.file(join(testDir, 'deep'));

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource);
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_IS_DIRECTORY);
	});

	(isWindows /* error code does not seem to be supported on windows */ ? test.skip : test)('readFile - FILE_NOT_DIRECTORY', async () => {
		const resource = URI.file(join(testDir, 'lorem.txt', 'file.txt'));

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource);
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_NOT_DIRECTORY);
	});

	test('readFile - FILE_NOT_FOUND', async () => {
		const resource = URI.file(join(testDir, '404.html'));

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource);
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_NOT_FOUND);
	});

	test('readFile - FILE_NOT_MODIFIED_SINCE - default', async () => {
		return testNotModifiedSince();
	});

	test('readFile - FILE_NOT_MODIFIED_SINCE - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testNotModifiedSince();
	});

	test('readFile - FILE_NOT_MODIFIED_SINCE - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testNotModifiedSince();
	});

	test('readFile - FILE_NOT_MODIFIED_SINCE - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testNotModifiedSince();
	});

	async function testNotModifiedSince() {
		const resource = URI.file(join(testDir, 'index.html'));

		const contents = await service.readFile(resource);
		fileProvider.totalBytesRead = 0;

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource, { etag: contents.etag });
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_NOT_MODIFIED_SINCE);
		assert.equal(fileProvider.totalBytesRead, 0);
	}

	test('readFile - FILE_NOT_MODIFIED_SINCE does not fire wrongly - https://github.com/Microsoft/vscode/issues/72909', async () => {
		fileProvider.setInvalidStatSize(true);

		const resource = URI.file(join(testDir, 'index.html'));

		await service.readFile(resource);

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource, { etag: undefined });
		} catch (err) {
			error = err;
		}

		assert.ok(!error);
	});

	test('readFile - FILE_EXCEEDS_MEMORY_LIMIT - default', async () => {
		return testFileExceedsMemoryLimit();
	});

	test('readFile - FILE_EXCEEDS_MEMORY_LIMIT - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testFileExceedsMemoryLimit();
	});

	test('readFile - FILE_EXCEEDS_MEMORY_LIMIT - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testFileExceedsMemoryLimit();
	});

	test('readFile - FILE_EXCEEDS_MEMORY_LIMIT - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testFileExceedsMemoryLimit();
	});

	async function testFileExceedsMemoryLimit() {
		await doTestFileExceedsMemoryLimit();

		// Also test when the stat size is wrong
		fileProvider.setSmallStatSize(true);
		return doTestFileExceedsMemoryLimit();
	}

	async function doTestFileExceedsMemoryLimit() {
		const resource = URI.file(join(testDir, 'index.html'));

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource, { limits: { memory: 10 } });
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_EXCEEDS_MEMORY_LIMIT);
	}

	(isWindows ? test.skip /* flaky test */ : test)('readFile - FILE_TOO_LARGE - default', async () => {
		return testFileTooLarge();
	});

	(isWindows ? test.skip /* flaky test */ : test)('readFile - FILE_TOO_LARGE - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testFileTooLarge();
	});

	(isWindows ? test.skip /* flaky test */ : test)('readFile - FILE_TOO_LARGE - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testFileTooLarge();
	});

	(isWindows ? test.skip /* flaky test */ : test)('readFile - FILE_TOO_LARGE - streamed', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadStream);

		return testFileTooLarge();
	});

	async function testFileTooLarge() {
		await doTestFileTooLarge();

		// Also test when the stat size is wrong
		fileProvider.setSmallStatSize(true);
		return doTestFileTooLarge();
	}

	async function doTestFileTooLarge() {
		const resource = URI.file(join(testDir, 'index.html'));

		let error: FileOperationError | undefined = undefined;
		try {
			await service.readFile(resource, { limits: { size: 10 } });
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_TOO_LARGE);
	}

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
		const resource = URI.file(join(testDir, 'test.txt'));

		assert.equal(await service.canCreateFile(resource), true);
		const fileStat = await service.createFile(resource, converter(contents));
		assert.equal(fileStat.name, 'test.txt');
		assert.equal(existsSync(fileStat.resource.fsPath), true);
		assert.equal(readFileSync(fileStat.resource.fsPath), contents);

		assert.ok(event!);
		assert.equal(event!.resource.fsPath, resource.fsPath);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.fsPath, resource.fsPath);
	}

	test('createFile (does not overwrite by default)', async () => {
		const contents = 'Hello World';
		const resource = URI.file(join(testDir, 'test.txt'));

		writeFileSync(resource.fsPath, ''); // create file

		assert.ok((await service.canCreateFile(resource)) instanceof Error);

		let error;
		try {
			await service.createFile(resource, VSBuffer.fromString(contents));
		} catch (err) {
			error = err;
		}

		assert.ok(error);
	});

	test('createFile (allows to overwrite existing)', async () => {
		let event: FileOperationEvent;
		disposables.add(service.onDidRunOperation(e => event = e));

		const contents = 'Hello World';
		const resource = URI.file(join(testDir, 'test.txt'));

		writeFileSync(resource.fsPath, ''); // create file

		assert.equal(await service.canCreateFile(resource, { overwrite: true }), true);
		const fileStat = await service.createFile(resource, VSBuffer.fromString(contents), { overwrite: true });
		assert.equal(fileStat.name, 'test.txt');
		assert.equal(existsSync(fileStat.resource.fsPath), true);
		assert.equal(readFileSync(fileStat.resource.fsPath), contents);

		assert.ok(event!);
		assert.equal(event!.resource.fsPath, resource.fsPath);
		assert.equal(event!.operation, FileOperation.CREATE);
		assert.equal(event!.target!.resource.fsPath, resource.fsPath);
	});

	test('writeFile - default', async () => {
		return testWriteFile();
	});

	test('writeFile - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testWriteFile();
	});

	test('writeFile - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testWriteFile();
	});

	async function testWriteFile() {
		const resource = URI.file(join(testDir, 'small.txt'));

		const content = readFileSync(resource.fsPath);
		assert.equal(content, 'Small File');

		const newContent = 'Updates to the small file';
		await service.writeFile(resource, VSBuffer.fromString(newContent));

		assert.equal(readFileSync(resource.fsPath), newContent);
	}

	test('writeFile (large file) - default', async () => {
		return testWriteFileLarge();
	});

	test('writeFile (large file) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testWriteFileLarge();
	});

	test('writeFile (large file) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testWriteFileLarge();
	});

	async function testWriteFileLarge() {
		const resource = URI.file(join(testDir, 'lorem.txt'));

		const content = readFileSync(resource.fsPath);
		const newContent = content.toString() + content.toString();

		const fileStat = await service.writeFile(resource, VSBuffer.fromString(newContent));
		assert.equal(fileStat.name, 'lorem.txt');

		assert.equal(readFileSync(resource.fsPath), newContent);
	}

	test('writeFile - buffered - readonly throws', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose | FileSystemProviderCapabilities.Readonly);

		return testWriteFileReadonlyThrows();
	});

	test('writeFile - unbuffered - readonly throws', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly);

		return testWriteFileReadonlyThrows();
	});

	async function testWriteFileReadonlyThrows() {
		const resource = URI.file(join(testDir, 'small.txt'));

		const content = readFileSync(resource.fsPath);
		assert.equal(content, 'Small File');

		const newContent = 'Updates to the small file';

		let error: Error;
		try {
			await service.writeFile(resource, VSBuffer.fromString(newContent));
		} catch (err) {
			error = err;
		}

		assert.ok(error!);
	}

	test('writeFile (large file) - multiple parallel writes queue up', async () => {
		const resource = URI.file(join(testDir, 'lorem.txt'));

		const content = readFileSync(resource.fsPath);
		const newContent = content.toString() + content.toString();

		await Promise.all(['0', '00', '000', '0000', '00000'].map(async offset => {
			const fileStat = await service.writeFile(resource, VSBuffer.fromString(offset + newContent));
			assert.equal(fileStat.name, 'lorem.txt');
		}));

		const fileContent = readFileSync(resource.fsPath).toString();
		assert.ok(['0', '00', '000', '0000', '00000'].some(offset => fileContent === offset + newContent));
	});

	test('writeFile (readable) - default', async () => {
		return testWriteFileReadable();
	});

	test('writeFile (readable) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testWriteFileReadable();
	});

	test('writeFile (readable) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testWriteFileReadable();
	});

	async function testWriteFileReadable() {
		const resource = URI.file(join(testDir, 'small.txt'));

		const content = readFileSync(resource.fsPath);
		assert.equal(content, 'Small File');

		const newContent = 'Updates to the small file';
		await service.writeFile(resource, toLineByLineReadable(newContent));

		assert.equal(readFileSync(resource.fsPath), newContent);
	}

	test('writeFile (large file - readable) - default', async () => {
		return testWriteFileLargeReadable();
	});

	test('writeFile (large file - readable) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testWriteFileLargeReadable();
	});

	test('writeFile (large file - readable) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testWriteFileLargeReadable();
	});

	async function testWriteFileLargeReadable() {
		const resource = URI.file(join(testDir, 'lorem.txt'));

		const content = readFileSync(resource.fsPath);
		const newContent = content.toString() + content.toString();

		const fileStat = await service.writeFile(resource, toLineByLineReadable(newContent));
		assert.equal(fileStat.name, 'lorem.txt');

		assert.equal(readFileSync(resource.fsPath), newContent);
	}

	test('writeFile (stream) - default', async () => {
		return testWriteFileStream();
	});

	test('writeFile (stream) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testWriteFileStream();
	});

	test('writeFile (stream) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testWriteFileStream();
	});

	async function testWriteFileStream() {
		const source = URI.file(join(testDir, 'small.txt'));
		const target = URI.file(join(testDir, 'small-copy.txt'));

		const fileStat = await service.writeFile(target, streamToBufferReadableStream(createReadStream(source.fsPath)));
		assert.equal(fileStat.name, 'small-copy.txt');

		const targetContents = readFileSync(target.fsPath).toString();
		assert.equal(readFileSync(source.fsPath).toString(), targetContents);
	}

	test('writeFile (large file - stream) - default', async () => {
		return testWriteFileLargeStream();
	});

	test('writeFile (large file - stream) - buffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileOpenReadWriteClose);

		return testWriteFileLargeStream();
	});

	test('writeFile (large file - stream) - unbuffered', async () => {
		setCapabilities(fileProvider, FileSystemProviderCapabilities.FileReadWrite);

		return testWriteFileLargeStream();
	});

	async function testWriteFileLargeStream() {
		const source = URI.file(join(testDir, 'lorem.txt'));
		const target = URI.file(join(testDir, 'lorem-copy.txt'));

		const fileStat = await service.writeFile(target, streamToBufferReadableStream(createReadStream(source.fsPath)));
		assert.equal(fileStat.name, 'lorem-copy.txt');

		const targetContents = readFileSync(target.fsPath).toString();
		assert.equal(readFileSync(source.fsPath).toString(), targetContents);
	}

	test('writeFile (file is created including parents)', async () => {
		const resource = URI.file(join(testDir, 'other', 'newfile.txt'));

		const content = 'File is created including parent';
		const fileStat = await service.writeFile(resource, VSBuffer.fromString(content));
		assert.equal(fileStat.name, 'newfile.txt');

		assert.equal(readFileSync(resource.fsPath), content);
	});

	test('writeFile (error when folder is encountered)', async () => {
		const resource = URI.file(testDir);

		let error: Error | undefined = undefined;
		try {
			await service.writeFile(resource, VSBuffer.fromString('File is created including parent'));
		} catch (err) {
			error = err;
		}

		assert.ok(error);
	});

	test('writeFile (no error when providing up to date etag)', async () => {
		const resource = URI.file(join(testDir, 'small.txt'));

		const stat = await service.resolve(resource);

		const content = readFileSync(resource.fsPath);
		assert.equal(content, 'Small File');

		const newContent = 'Updates to the small file';
		await service.writeFile(resource, VSBuffer.fromString(newContent), { etag: stat.etag, mtime: stat.mtime });

		assert.equal(readFileSync(resource.fsPath), newContent);
	});

	test('writeFile - error when writing to file that has been updated meanwhile', async () => {
		const resource = URI.file(join(testDir, 'small.txt'));

		const stat = await service.resolve(resource);

		const content = readFileSync(resource.fsPath).toString();
		assert.equal(content, 'Small File');

		const newContent = 'Updates to the small file';
		await service.writeFile(resource, VSBuffer.fromString(newContent), { etag: stat.etag, mtime: stat.mtime });

		const newContentLeadingToError = newContent + newContent;

		const fakeMtime = 1000;
		const fakeSize = 1000;

		let error: FileOperationError | undefined = undefined;
		try {
			await service.writeFile(resource, VSBuffer.fromString(newContentLeadingToError), { etag: etag({ mtime: fakeMtime, size: fakeSize }), mtime: fakeMtime });
		} catch (err) {
			error = err;
		}

		assert.ok(error);
		assert.ok(error instanceof FileOperationError);
		assert.equal(error!.fileOperationResult, FileOperationResult.FILE_MODIFIED_SINCE);
	});

	test('writeFile - no error when writing to file where size is the same', async () => {
		const resource = URI.file(join(testDir, 'small.txt'));

		const stat = await service.resolve(resource);

		const content = readFileSync(resource.fsPath).toString();
		assert.equal(content, 'Small File');

		const newContent = content; // same content
		await service.writeFile(resource, VSBuffer.fromString(newContent), { etag: stat.etag, mtime: stat.mtime });

		const newContentLeadingToNoError = newContent; // writing the same content should be OK

		const fakeMtime = 1000;
		const actualSize = newContent.length;

		let error: FileOperationError | undefined = undefined;
		try {
			await service.writeFile(resource, VSBuffer.fromString(newContentLeadingToNoError), { etag: etag({ mtime: fakeMtime, size: actualSize }), mtime: fakeMtime });
		} catch (err) {
			error = err;
		}

		assert.ok(!error);
	});

	test('writeFile - no error when writing to same non-existing folder multiple times different new files', async () => {
		const newFolder = URI.file(join(testDir, 'some', 'new', 'folder'));

		const file1 = joinPath(newFolder, 'file-1');
		const file2 = joinPath(newFolder, 'file-2');
		const file3 = joinPath(newFolder, 'file-3');

		// this essentially verifies that the mkdirp logic implemented
		// in the file service is able to receive multiple requests for
		// the same folder and will not throw errors if another racing
		// call succeeded first.
		const newContent = 'Updates to the small file';
		await Promise.all([
			service.writeFile(file1, VSBuffer.fromString(newContent)),
			service.writeFile(file2, VSBuffer.fromString(newContent)),
			service.writeFile(file3, VSBuffer.fromString(newContent))
		]);

		assert.ok(service.exists(file1));
		assert.ok(service.exists(file2));
		assert.ok(service.exists(file3));
	});

	test('writeFile - error when writing to folder that is a file', async () => {
		const existingFile = URI.file(join(testDir, 'my-file'));

		await service.createFile(existingFile);

		const newFile = joinPath(existingFile, 'file-1');

		let error;
		const newContent = 'Updates to the small file';
		try {
			await service.writeFile(newFile, VSBuffer.fromString(newContent));
		} catch (e) {
			error = e;
		}

		assert.ok(error);
	});

	const runWatchTests = isLinux;

	(runWatchTests ? test : test.skip)('watch - file', done => {
		const toWatch = URI.file(join(testDir, 'index-watch1.html'));
		writeFileSync(toWatch.fsPath, 'Init');

		assertWatch(toWatch, [[FileChangeType.UPDATED, toWatch]], done);

		setTimeout(() => writeFileSync(toWatch.fsPath, 'Changes'), 50);
	});

	(runWatchTests && !isWindows /* symbolic links not reliable on windows */ ? test : test.skip)('watch - file symbolic link', async done => {
		const toWatch = URI.file(join(testDir, 'lorem.txt-linked'));
		await symlink(join(testDir, 'lorem.txt'), toWatch.fsPath);

		assertWatch(toWatch, [[FileChangeType.UPDATED, toWatch]], done);

		setTimeout(() => writeFileSync(toWatch.fsPath, 'Changes'), 50);
	});

	(runWatchTests ? test : test.skip)('watch - file - multiple writes', done => {
		const toWatch = URI.file(join(testDir, 'index-watch1.html'));
		writeFileSync(toWatch.fsPath, 'Init');

		assertWatch(toWatch, [[FileChangeType.UPDATED, toWatch]], done);

		setTimeout(() => writeFileSync(toWatch.fsPath, 'Changes 1'), 0);
		setTimeout(() => writeFileSync(toWatch.fsPath, 'Changes 2'), 10);
		setTimeout(() => writeFileSync(toWatch.fsPath, 'Changes 3'), 20);
	});

	(runWatchTests ? test : test.skip)('watch - file - delete file', done => {
		const toWatch = URI.file(join(testDir, 'index-watch1.html'));
		writeFileSync(toWatch.fsPath, 'Init');

		assertWatch(toWatch, [[FileChangeType.DELETED, toWatch]], done);

		setTimeout(() => unlinkSync(toWatch.fsPath), 50);
	});

	(runWatchTests ? test : test.skip)('watch - file - rename file', done => {
		const toWatch = URI.file(join(testDir, 'index-watch1.html'));
		const toWatchRenamed = URI.file(join(testDir, 'index-watch1-renamed.html'));
		writeFileSync(toWatch.fsPath, 'Init');

		assertWatch(toWatch, [[FileChangeType.DELETED, toWatch]], done);

		setTimeout(() => renameSync(toWatch.fsPath, toWatchRenamed.fsPath), 50);
	});

	(runWatchTests ? test : test.skip)('watch - file - rename file (different case)', done => {
		const toWatch = URI.file(join(testDir, 'index-watch1.html'));
		const toWatchRenamed = URI.file(join(testDir, 'INDEX-watch1.html'));
		writeFileSync(toWatch.fsPath, 'Init');

		if (isLinux) {
			assertWatch(toWatch, [[FileChangeType.DELETED, toWatch]], done);
		} else {
			assertWatch(toWatch, [[FileChangeType.UPDATED, toWatch]], done); // case insensitive file system treat this as change
		}

		setTimeout(() => renameSync(toWatch.fsPath, toWatchRenamed.fsPath), 50);
	});

	(runWatchTests ? test : test.skip)('watch - file (atomic save)', function (done) {
		const toWatch = URI.file(join(testDir, 'index-watch2.html'));
		writeFileSync(toWatch.fsPath, 'Init');

		assertWatch(toWatch, [[FileChangeType.UPDATED, toWatch]], done);

		setTimeout(() => {
			// Simulate atomic save by deleting the file, creating it under different name
			// and then replacing the previously deleted file with those contents
			const renamed = `${toWatch.fsPath}.bak`;
			unlinkSync(toWatch.fsPath);
			writeFileSync(renamed, 'Changes');
			renameSync(renamed, toWatch.fsPath);
		}, 50);
	});

	(runWatchTests ? test : test.skip)('watch - folder (non recursive) - change file', done => {
		const watchDir = URI.file(join(testDir, 'watch3'));
		mkdirSync(watchDir.fsPath);

		const file = URI.file(join(watchDir.fsPath, 'index.html'));
		writeFileSync(file.fsPath, 'Init');

		assertWatch(watchDir, [[FileChangeType.UPDATED, file]], done);

		setTimeout(() => writeFileSync(file.fsPath, 'Changes'), 50);
	});

	(runWatchTests ? test : test.skip)('watch - folder (non recursive) - add file', done => {
		const watchDir = URI.file(join(testDir, 'watch4'));
		mkdirSync(watchDir.fsPath);

		const file = URI.file(join(watchDir.fsPath, 'index.html'));

		assertWatch(watchDir, [[FileChangeType.ADDED, file]], done);

		setTimeout(() => writeFileSync(file.fsPath, 'Changes'), 50);
	});

	(runWatchTests ? test : test.skip)('watch - folder (non recursive) - delete file', done => {
		const watchDir = URI.file(join(testDir, 'watch5'));
		mkdirSync(watchDir.fsPath);

		const file = URI.file(join(watchDir.fsPath, 'index.html'));
		writeFileSync(file.fsPath, 'Init');

		assertWatch(watchDir, [[FileChangeType.DELETED, file]], done);

		setTimeout(() => unlinkSync(file.fsPath), 50);
	});

	(runWatchTests ? test : test.skip)('watch - folder (non recursive) - add folder', done => {
		const watchDir = URI.file(join(testDir, 'watch6'));
		mkdirSync(watchDir.fsPath);

		const folder = URI.file(join(watchDir.fsPath, 'folder'));

		assertWatch(watchDir, [[FileChangeType.ADDED, folder]], done);

		setTimeout(() => mkdirSync(folder.fsPath), 50);
	});

	(runWatchTests ? test : test.skip)('watch - folder (non recursive) - delete folder', done => {
		const watchDir = URI.file(join(testDir, 'watch7'));
		mkdirSync(watchDir.fsPath);

		const folder = URI.file(join(watchDir.fsPath, 'folder'));
		mkdirSync(folder.fsPath);

		assertWatch(watchDir, [[FileChangeType.DELETED, folder]], done);

		setTimeout(() => rimrafSync(folder.fsPath), 50);
	});

	(runWatchTests && !isWindows /* symbolic links not reliable on windows */ ? test : test.skip)('watch - folder (non recursive) - symbolic link - change file', async done => {
		const watchDir = URI.file(join(testDir, 'deep-link'));
		await symlink(join(testDir, 'deep'), watchDir.fsPath);

		const file = URI.file(join(watchDir.fsPath, 'index.html'));
		writeFileSync(file.fsPath, 'Init');

		assertWatch(watchDir, [[FileChangeType.UPDATED, file]], done);

		setTimeout(() => writeFileSync(file.fsPath, 'Changes'), 50);
	});

	(runWatchTests ? test : test.skip)('watch - folder (non recursive) - rename file', done => {
		const watchDir = URI.file(join(testDir, 'watch8'));
		mkdirSync(watchDir.fsPath);

		const file = URI.file(join(watchDir.fsPath, 'index.html'));
		writeFileSync(file.fsPath, 'Init');

		const fileRenamed = URI.file(join(watchDir.fsPath, 'index-renamed.html'));

		assertWatch(watchDir, [[FileChangeType.DELETED, file], [FileChangeType.ADDED, fileRenamed]], done);

		setTimeout(() => renameSync(file.fsPath, fileRenamed.fsPath), 50);
	});

	(runWatchTests && isLinux /* this test requires a case sensitive file system */ ? test : test.skip)('watch - folder (non recursive) - rename file (different case)', done => {
		const watchDir = URI.file(join(testDir, 'watch8'));
		mkdirSync(watchDir.fsPath);

		const file = URI.file(join(watchDir.fsPath, 'index.html'));
		writeFileSync(file.fsPath, 'Init');

		const fileRenamed = URI.file(join(watchDir.fsPath, 'INDEX.html'));

		assertWatch(watchDir, [[FileChangeType.DELETED, file], [FileChangeType.ADDED, fileRenamed]], done);

		setTimeout(() => renameSync(file.fsPath, fileRenamed.fsPath), 50);
	});

	function assertWatch(toWatch: URI, expected: [FileChangeType, URI][], done: MochaDone): void {
		const watcherDisposable = service.watch(toWatch);

		function toString(type: FileChangeType): string {
			switch (type) {
				case FileChangeType.ADDED: return 'added';
				case FileChangeType.DELETED: return 'deleted';
				case FileChangeType.UPDATED: return 'updated';
			}
		}

		function printEvents(event: FileChangesEvent): string {
			return event.changes.map(change => `Change: type ${toString(change.type)} path ${change.resource.toString()}`).join('\n');
		}

		const listenerDisposable = service.onDidFilesChange(event => {
			watcherDisposable.dispose();
			listenerDisposable.dispose();

			try {
				assert.equal(event.changes.length, expected.length, `Expected ${expected.length} events, but got ${event.changes.length}. Details (${printEvents(event)})`);

				if (expected.length === 1) {
					assert.equal(event.changes[0].type, expected[0][0], `Expected ${toString(expected[0][0])} but got ${toString(event.changes[0].type)}. Details (${printEvents(event)})`);
					assert.equal(event.changes[0].resource.fsPath, expected[0][1].fsPath);
				} else {
					for (const expect of expected) {
						assert.equal(hasChange(event.changes, expect[0], expect[1]), true, `Unable to find ${toString(expect[0])} for ${expect[1].fsPath}. Details (${printEvents(event)})`);
					}
				}

				done();
			} catch (error) {
				done(error);
			}
		});
	}

	function hasChange(changes: readonly IFileChange[], type: FileChangeType, resource: URI): boolean {
		return changes.some(change => change.type === type && isEqual(change.resource, resource));
	}

	test('read - mixed positions', async () => {
		const resource = URI.file(join(testDir, 'lorem.txt'));

		// read multiple times from position 0
		let buffer = VSBuffer.alloc(1024);
		let fd = await fileProvider.open(resource, { create: false });
		for (let i = 0; i < 3; i++) {
			await fileProvider.read(fd, 0, buffer.buffer, 0, 26);
			assert.equal(buffer.slice(0, 26).toString(), 'Lorem ipsum dolor sit amet');
		}
		await fileProvider.close(fd);

		// read multiple times at various locations
		buffer = VSBuffer.alloc(1024);
		fd = await fileProvider.open(resource, { create: false });

		let posInFile = 0;

		await fileProvider.read(fd, posInFile, buffer.buffer, 0, 26);
		assert.equal(buffer.slice(0, 26).toString(), 'Lorem ipsum dolor sit amet');
		posInFile += 26;

		await fileProvider.read(fd, posInFile, buffer.buffer, 0, 1);
		assert.equal(buffer.slice(0, 1).toString(), ',');
		posInFile += 1;

		await fileProvider.read(fd, posInFile, buffer.buffer, 0, 12);
		assert.equal(buffer.slice(0, 12).toString(), ' consectetur');
		posInFile += 12;

		await fileProvider.read(fd, 98 /* no longer in sequence of posInFile */, buffer.buffer, 0, 9);
		assert.equal(buffer.slice(0, 9).toString(), 'fermentum');

		await fileProvider.read(fd, 27, buffer.buffer, 0, 12);
		assert.equal(buffer.slice(0, 12).toString(), ' consectetur');

		await fileProvider.read(fd, 26, buffer.buffer, 0, 1);
		assert.equal(buffer.slice(0, 1).toString(), ',');

		await fileProvider.read(fd, 0, buffer.buffer, 0, 26);
		assert.equal(buffer.slice(0, 26).toString(), 'Lorem ipsum dolor sit amet');

		await fileProvider.read(fd, posInFile /* back in sequence */, buffer.buffer, 0, 11);
		assert.equal(buffer.slice(0, 11).toString(), ' adipiscing');

		await fileProvider.close(fd);
	});

	test('write - mixed positions', async () => {
		const resource = URI.file(join(testDir, 'lorem.txt'));

		const buffer = VSBuffer.alloc(1024);
		const fdWrite = await fileProvider.open(resource, { create: true });
		const fdRead = await fileProvider.open(resource, { create: false });

		let posInFileWrite = 0;
		let posInFileRead = 0;

		const initialContents = VSBuffer.fromString('Lorem ipsum dolor sit amet');
		await fileProvider.write(fdWrite, posInFileWrite, initialContents.buffer, 0, initialContents.byteLength);
		posInFileWrite += initialContents.byteLength;

		await fileProvider.read(fdRead, posInFileRead, buffer.buffer, 0, 26);
		assert.equal(buffer.slice(0, 26).toString(), 'Lorem ipsum dolor sit amet');
		posInFileRead += 26;

		const contents = VSBuffer.fromString('Hello World');

		await fileProvider.write(fdWrite, posInFileWrite, contents.buffer, 0, contents.byteLength);
		posInFileWrite += contents.byteLength;

		await fileProvider.read(fdRead, posInFileRead, buffer.buffer, 0, contents.byteLength);
		assert.equal(buffer.slice(0, contents.byteLength).toString(), 'Hello World');
		posInFileRead += contents.byteLength;

		await fileProvider.write(fdWrite, 6, contents.buffer, 0, contents.byteLength);

		await fileProvider.read(fdRead, 0, buffer.buffer, 0, 11);
		assert.equal(buffer.slice(0, 11).toString(), 'Lorem Hello');

		await fileProvider.write(fdWrite, posInFileWrite, contents.buffer, 0, contents.byteLength);
		posInFileWrite += contents.byteLength;

		await fileProvider.read(fdRead, posInFileWrite - contents.byteLength, buffer.buffer, 0, contents.byteLength);
		assert.equal(buffer.slice(0, contents.byteLength).toString(), 'Hello World');

		await fileProvider.close(fdWrite);
		await fileProvider.close(fdRead);
	});
});
