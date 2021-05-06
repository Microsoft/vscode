/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'vs/base/common/path';
import { generateUuid } from 'vs/base/common/uuid';
import { copy, exists, move, readdir, readDirsInDir, rimraf, RimRafMode, rimrafSync, SymlinkSupport, writeFile, writeFileSync } from 'vs/base/node/pfs';
import { timeout } from 'vs/base/common/async';
import { canNormalize } from 'vs/base/common/normalization';
import { VSBuffer } from 'vs/base/common/buffer';
import { flakySuite, getRandomTestPath, getPathFromAmdModule } from 'vs/base/test/node/testUtils';
import { isWindows } from 'vs/base/common/platform';

flakySuite('PFS', function () {

	let testDir: string;

	setup(() => {
		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'pfs');

		return fs.promises.mkdir(testDir, { recursive: true });
	});

	teardown(() => {
		return rimraf(testDir);
	});

	test('writeFile', async () => {
		const testFile = join(testDir, 'writefile.txt');

		assert.ok(!(await exists(testFile)));

		await writeFile(testFile, 'Hello World', (null!));

		assert.strictEqual((await fs.promises.readFile(testFile)).toString(), 'Hello World');
	});

	test('writeFile - parallel write on different files works', async () => {
		const testFile1 = join(testDir, 'writefile1.txt');
		const testFile2 = join(testDir, 'writefile2.txt');
		const testFile3 = join(testDir, 'writefile3.txt');
		const testFile4 = join(testDir, 'writefile4.txt');
		const testFile5 = join(testDir, 'writefile5.txt');

		await Promise.all([
			writeFile(testFile1, 'Hello World 1', (null!)),
			writeFile(testFile2, 'Hello World 2', (null!)),
			writeFile(testFile3, 'Hello World 3', (null!)),
			writeFile(testFile4, 'Hello World 4', (null!)),
			writeFile(testFile5, 'Hello World 5', (null!))
		]);
		assert.strictEqual(fs.readFileSync(testFile1).toString(), 'Hello World 1');
		assert.strictEqual(fs.readFileSync(testFile2).toString(), 'Hello World 2');
		assert.strictEqual(fs.readFileSync(testFile3).toString(), 'Hello World 3');
		assert.strictEqual(fs.readFileSync(testFile4).toString(), 'Hello World 4');
		assert.strictEqual(fs.readFileSync(testFile5).toString(), 'Hello World 5');
	});

	test('writeFile - parallel write on same files works and is sequentalized', async () => {
		const testFile = join(testDir, 'writefile.txt');

		await Promise.all([
			writeFile(testFile, 'Hello World 1', undefined),
			writeFile(testFile, 'Hello World 2', undefined),
			timeout(10).then(() => writeFile(testFile, 'Hello World 3', undefined)),
			writeFile(testFile, 'Hello World 4', undefined),
			timeout(10).then(() => writeFile(testFile, 'Hello World 5', undefined))
		]);
		assert.strictEqual(fs.readFileSync(testFile).toString(), 'Hello World 5');
	});

	test('rimraf - simple - unlink', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(testDir);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - simple - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(testDir, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - recursive folder structure - unlink', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');
		fs.mkdirSync(join(testDir, 'somefolder'));
		fs.writeFileSync(join(testDir, 'somefolder', 'somefile.txt'), 'Contents');

		await rimraf(testDir);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - recursive folder structure - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');
		fs.mkdirSync(join(testDir, 'somefolder'));
		fs.writeFileSync(join(testDir, 'somefolder', 'somefile.txt'), 'Contents');

		await rimraf(testDir, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - simple ends with dot - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(testDir, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimraf - simple ends with dot slash/backslash - move', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		await rimraf(`${testDir}${sep}`, RimRafMode.MOVE);
		assert.ok(!fs.existsSync(testDir));
	});

	test('rimrafSync - swallows file not found error', function () {
		const nonExistingDir = join(testDir, 'not-existing');
		rimrafSync(nonExistingDir);

		assert.ok(!fs.existsSync(nonExistingDir));
	});

	test('rimrafSync - simple', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		rimrafSync(testDir);

		assert.ok(!fs.existsSync(testDir));
	});

	test('rimrafSync - recursive folder structure', async () => {
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		fs.mkdirSync(join(testDir, 'somefolder'));
		fs.writeFileSync(join(testDir, 'somefolder', 'somefile.txt'), 'Contents');

		rimrafSync(testDir);

		assert.ok(!fs.existsSync(testDir));
	});

	test('copy, move and delete', async () => {
		const id = generateUuid();
		const id2 = generateUuid();
		const sourceDir = getPathFromAmdModule(require, './fixtures');
		const parentDir = join(tmpdir(), 'vsctests', 'pfs');
		const targetDir = join(parentDir, id);
		const targetDir2 = join(parentDir, id2);

		await copy(sourceDir, targetDir, { preserveSymlinks: true });

		assert.ok(fs.existsSync(targetDir));
		assert.ok(fs.existsSync(join(targetDir, 'index.html')));
		assert.ok(fs.existsSync(join(targetDir, 'site.css')));
		assert.ok(fs.existsSync(join(targetDir, 'examples')));
		assert.ok(fs.statSync(join(targetDir, 'examples')).isDirectory());
		assert.ok(fs.existsSync(join(targetDir, 'examples', 'small.jxs')));

		await move(targetDir, targetDir2);

		assert.ok(!fs.existsSync(targetDir));
		assert.ok(fs.existsSync(targetDir2));
		assert.ok(fs.existsSync(join(targetDir2, 'index.html')));
		assert.ok(fs.existsSync(join(targetDir2, 'site.css')));
		assert.ok(fs.existsSync(join(targetDir2, 'examples')));
		assert.ok(fs.statSync(join(targetDir2, 'examples')).isDirectory());
		assert.ok(fs.existsSync(join(targetDir2, 'examples', 'small.jxs')));

		await move(join(targetDir2, 'index.html'), join(targetDir2, 'index_moved.html'));

		assert.ok(!fs.existsSync(join(targetDir2, 'index.html')));
		assert.ok(fs.existsSync(join(targetDir2, 'index_moved.html')));

		await rimraf(parentDir);

		assert.ok(!fs.existsSync(parentDir));
	});

	test('copy handles symbolic links', async () => {
		const id1 = generateUuid();
		const symbolicLinkTarget = join(testDir, id1);

		const id2 = generateUuid();
		const symLink = join(testDir, id2);

		const id3 = generateUuid();
		const copyTarget = join(testDir, id3);

		await fs.promises.mkdir(symbolicLinkTarget, { recursive: true });

		fs.symlinkSync(symbolicLinkTarget, symLink, 'junction');

		// Copy preserves symlinks if configured as such
		//
		// Windows: this test does not work because creating symlinks
		// requires priviledged permissions (admin).
		if (!isWindows) {
			await copy(symLink, copyTarget, { preserveSymlinks: true });

			assert.ok(fs.existsSync(copyTarget));

			const { symbolicLink } = await SymlinkSupport.stat(copyTarget);
			assert.ok(symbolicLink);
			assert.ok(!symbolicLink.dangling);

			const target = await fs.promises.readlink(copyTarget);
			assert.strictEqual(target, symbolicLinkTarget);

			// Copy does not preserve symlinks if configured as such

			await rimraf(copyTarget);
			await copy(symLink, copyTarget, { preserveSymlinks: false });

			assert.ok(fs.existsSync(copyTarget));

			const { symbolicLink: symbolicLink2 } = await SymlinkSupport.stat(copyTarget);
			assert.ok(!symbolicLink2);
		}

		// Copy does not fail over dangling symlinks

		await rimraf(copyTarget);
		await rimraf(symbolicLinkTarget);

		await copy(symLink, copyTarget, { preserveSymlinks: true }); // this should not throw

		if (!isWindows) {
			const { symbolicLink } = await SymlinkSupport.stat(copyTarget);
			assert.ok(symbolicLink?.dangling);
		} else {
			assert.ok(!fs.existsSync(copyTarget));
		}
	});

	test('copy handles symbolic links when the reference is inside source', async () => {

		// Source Folder
		const sourceFolder = join(testDir, generateUuid(), 'copy-test'); 	// copy-test
		const sourceLinkTestFolder = join(sourceFolder, 'link-test');		// copy-test/link-test
		const sourceLinkMD5JSFolder = join(sourceLinkTestFolder, 'md5');	// copy-test/link-test/md5
		const sourceLinkMD5JSFile = join(sourceLinkMD5JSFolder, 'md5.js');	// copy-test/link-test/md5/md5.js
		await fs.promises.mkdir(sourceLinkMD5JSFolder, { recursive: true });
		await writeFile(sourceLinkMD5JSFile, 'Hello from MD5');

		const sourceLinkMD5JSFolderLinked = join(sourceLinkTestFolder, 'md5-linked');	// copy-test/link-test/md5-linked
		fs.symlinkSync(sourceLinkMD5JSFolder, sourceLinkMD5JSFolderLinked, 'junction');

		// Target Folder
		const targetLinkTestFolder = join(sourceFolder, 'link-test copy');				// copy-test/link-test copy
		const targetLinkMD5JSFolder = join(targetLinkTestFolder, 'md5');				// copy-test/link-test copy/md5
		const targetLinkMD5JSFile = join(targetLinkMD5JSFolder, 'md5.js');				// copy-test/link-test copy/md5/md5.js
		const targetLinkMD5JSFolderLinked = join(targetLinkTestFolder, 'md5-linked');	// copy-test/link-test copy/md5-linked

		// Copy with `preserveSymlinks: true` and verify result
		//
		// Windows: this test does not work because creating symlinks
		// requires priviledged permissions (admin).
		if (!isWindows) {
			await copy(sourceLinkTestFolder, targetLinkTestFolder, { preserveSymlinks: true });

			assert.ok(fs.existsSync(targetLinkTestFolder));
			assert.ok(fs.existsSync(targetLinkMD5JSFolder));
			assert.ok(fs.existsSync(targetLinkMD5JSFile));
			assert.ok(fs.existsSync(targetLinkMD5JSFolderLinked));
			assert.ok(fs.lstatSync(targetLinkMD5JSFolderLinked).isSymbolicLink());

			const linkTarget = await fs.promises.readlink(targetLinkMD5JSFolderLinked);
			assert.strictEqual(linkTarget, targetLinkMD5JSFolder);

			await fs.promises.rmdir(targetLinkTestFolder, { recursive: true });
		}

		// Copy with `preserveSymlinks: false` and verify result
		await copy(sourceLinkTestFolder, targetLinkTestFolder, { preserveSymlinks: false });

		assert.ok(fs.existsSync(targetLinkTestFolder));
		assert.ok(fs.existsSync(targetLinkMD5JSFolder));
		assert.ok(fs.existsSync(targetLinkMD5JSFile));
		assert.ok(fs.existsSync(targetLinkMD5JSFolderLinked));
		assert.ok(fs.lstatSync(targetLinkMD5JSFolderLinked).isDirectory());
	});

	test('readDirsInDir', async () => {
		fs.mkdirSync(join(testDir, 'somefolder1'));
		fs.mkdirSync(join(testDir, 'somefolder2'));
		fs.mkdirSync(join(testDir, 'somefolder3'));
		fs.writeFileSync(join(testDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(join(testDir, 'someOtherFile.txt'), 'Contents');

		const result = await readDirsInDir(testDir);
		assert.strictEqual(result.length, 3);
		assert.ok(result.indexOf('somefolder1') !== -1);
		assert.ok(result.indexOf('somefolder2') !== -1);
		assert.ok(result.indexOf('somefolder3') !== -1);
	});

	test('stat link', async () => {
		const id1 = generateUuid();
		const directory = join(testDir, id1);

		const id2 = generateUuid();
		const symbolicLink = join(testDir, id2);

		await fs.promises.mkdir(directory, { recursive: true });

		fs.symlinkSync(directory, symbolicLink, 'junction');

		let statAndIsLink = await SymlinkSupport.stat(directory);
		assert.ok(!statAndIsLink?.symbolicLink);

		statAndIsLink = await SymlinkSupport.stat(symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink);
		assert.ok(!statAndIsLink?.symbolicLink?.dangling);
	});

	test('stat link (non existing target)', async () => {
		const id1 = generateUuid();
		const directory = join(testDir, id1);

		const id2 = generateUuid();
		const symbolicLink = join(testDir, id2);

		await fs.promises.mkdir(directory, { recursive: true });

		fs.symlinkSync(directory, symbolicLink, 'junction');

		await rimraf(directory);

		const statAndIsLink = await SymlinkSupport.stat(symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink?.dangling);
	});

	test('readdir', async () => {
		if (canNormalize && typeof process.versions['electron'] !== 'undefined' /* needs electron */) {
			const id = generateUuid();
			const newDir = join(testDir, 'pfs', id, 'öäü');

			await fs.promises.mkdir(newDir, { recursive: true });

			assert.ok(fs.existsSync(newDir));

			const children = await readdir(join(testDir, 'pfs', id));
			assert.strictEqual(children.some(n => n === 'öäü'), true); // Mac always converts to NFD, so
		}
	});

	test('readdir (with file types)', async () => {
		if (canNormalize && typeof process.versions['electron'] !== 'undefined' /* needs electron */) {
			const newDir = join(testDir, 'öäü');
			await fs.promises.mkdir(newDir, { recursive: true });

			await writeFile(join(testDir, 'somefile.txt'), 'contents');

			assert.ok(fs.existsSync(newDir));

			const children = await readdir(testDir, { withFileTypes: true });

			assert.strictEqual(children.some(n => n.name === 'öäü'), true); // Mac always converts to NFD, so
			assert.strictEqual(children.some(n => n.isDirectory()), true);

			assert.strictEqual(children.some(n => n.name === 'somefile.txt'), true);
			assert.strictEqual(children.some(n => n.isFile()), true);
		}
	});

	test('writeFile (string)', async () => {
		const smallData = 'Hello World';
		const bigData = (new Array(100 * 1024)).join('Large String\n');

		return testWriteFileAndFlush(smallData, smallData, bigData, bigData);
	});

	test('writeFile (Buffer)', async () => {
		const smallData = 'Hello World';
		const bigData = (new Array(100 * 1024)).join('Large String\n');

		return testWriteFileAndFlush(Buffer.from(smallData), smallData, Buffer.from(bigData), bigData);
	});

	test('writeFile (UInt8Array)', async () => {
		const smallData = 'Hello World';
		const bigData = (new Array(100 * 1024)).join('Large String\n');

		return testWriteFileAndFlush(VSBuffer.fromString(smallData).buffer, smallData, VSBuffer.fromString(bigData).buffer, bigData);
	});

	async function testWriteFileAndFlush(
		smallData: string | Buffer | Uint8Array,
		smallDataValue: string,
		bigData: string | Buffer | Uint8Array,
		bigDataValue: string
	): Promise<void> {
		const testFile = join(testDir, 'flushed.txt');

		assert.ok(fs.existsSync(testDir));

		await writeFile(testFile, smallData);
		assert.strictEqual(fs.readFileSync(testFile).toString(), smallDataValue);

		await writeFile(testFile, bigData);
		assert.strictEqual(fs.readFileSync(testFile).toString(), bigDataValue);
	}

	test('writeFile (string, error handling)', async () => {
		const testFile = join(testDir, 'flushed.txt');

		fs.mkdirSync(testFile); // this will trigger an error later because testFile is now a directory!

		let expectedError: Error | undefined;
		try {
			await writeFile(testFile, 'Hello World');
		} catch (error) {
			expectedError = error;
		}

		assert.ok(expectedError);
	});

	test('writeFileSync', async () => {
		const testFile = join(testDir, 'flushed.txt');

		writeFileSync(testFile, 'Hello World');
		assert.strictEqual(fs.readFileSync(testFile).toString(), 'Hello World');

		const largeString = (new Array(100 * 1024)).join('Large String\n');

		writeFileSync(testFile, largeString);
		assert.strictEqual(fs.readFileSync(testFile).toString(), largeString);
	});
});
