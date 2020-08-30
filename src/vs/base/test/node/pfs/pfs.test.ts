/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as fs from 'fs';
import * as uuid from 'vs/base/common/uuid';
import * as pfs from 'vs/base/node/pfs';
import { timeout } from 'vs/base/common/async';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { isWindows } from 'vs/base/common/platform';
import { canNormalize } from 'vs/base/common/normalization';
import { VSBuffer } from 'vs/base/common/buffer';

suite('PFS', function () {

	// Given issues such as https://github.com/microsoft/vscode/issues/84066
	// we see random test failures when accessing the native file system. To
	// diagnose further, we retry node.js file access tests up to 3 times to
	// rule out any random disk issue.
	this.retries(3);

	test('writeFile', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);
		const testFile = path.join(newDir, 'writefile.txt');

		await pfs.mkdirp(newDir, 493);
		assert.ok(fs.existsSync(newDir));

		await pfs.writeFile(testFile, 'Hello World', (null!));
		assert.equal(fs.readFileSync(testFile), 'Hello World');

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});

	test('writeFile - parallel write on different files works', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);
		const testFile1 = path.join(newDir, 'writefile1.txt');
		const testFile2 = path.join(newDir, 'writefile2.txt');
		const testFile3 = path.join(newDir, 'writefile3.txt');
		const testFile4 = path.join(newDir, 'writefile4.txt');
		const testFile5 = path.join(newDir, 'writefile5.txt');

		await pfs.mkdirp(newDir, 493);
		assert.ok(fs.existsSync(newDir));

		await Promise.all([
			pfs.writeFile(testFile1, 'Hello World 1', (null!)),
			pfs.writeFile(testFile2, 'Hello World 2', (null!)),
			pfs.writeFile(testFile3, 'Hello World 3', (null!)),
			pfs.writeFile(testFile4, 'Hello World 4', (null!)),
			pfs.writeFile(testFile5, 'Hello World 5', (null!))
		]);
		assert.equal(fs.readFileSync(testFile1), 'Hello World 1');
		assert.equal(fs.readFileSync(testFile2), 'Hello World 2');
		assert.equal(fs.readFileSync(testFile3), 'Hello World 3');
		assert.equal(fs.readFileSync(testFile4), 'Hello World 4');
		assert.equal(fs.readFileSync(testFile5), 'Hello World 5');

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});

	test('writeFile - parallel write on same files works and is sequentalized', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);
		const testFile = path.join(newDir, 'writefile.txt');

		await pfs.mkdirp(newDir, 493);
		assert.ok(fs.existsSync(newDir));

		await Promise.all([
			pfs.writeFile(testFile, 'Hello World 1', undefined),
			pfs.writeFile(testFile, 'Hello World 2', undefined),
			timeout(10).then(() => pfs.writeFile(testFile, 'Hello World 3', undefined)),
			pfs.writeFile(testFile, 'Hello World 4', undefined),
			timeout(10).then(() => pfs.writeFile(testFile, 'Hello World 5', undefined))
		]);
		assert.equal(fs.readFileSync(testFile), 'Hello World 5');

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});

	test('rimraf - simple - unlink', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		await pfs.rimraf(newDir);
		assert.ok(!fs.existsSync(newDir));
	});

	test('rimraf - simple - move', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		await pfs.rimraf(newDir, pfs.RimRafMode.MOVE);
		assert.ok(!fs.existsSync(newDir));
	});

	test('rimraf - recursive folder structure - unlink', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');
		fs.mkdirSync(path.join(newDir, 'somefolder'));
		fs.writeFileSync(path.join(newDir, 'somefolder', 'somefile.txt'), 'Contents');

		await pfs.rimraf(newDir);
		assert.ok(!fs.existsSync(newDir));
	});

	test('rimraf - recursive folder structure - move', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');
		fs.mkdirSync(path.join(newDir, 'somefolder'));
		fs.writeFileSync(path.join(newDir, 'somefolder', 'somefile.txt'), 'Contents');

		await pfs.rimraf(newDir, pfs.RimRafMode.MOVE);
		assert.ok(!fs.existsSync(newDir));
	});

	test('rimraf - simple ends with dot - move', async () => {
		const id = `${uuid.generateUuid()}.`;
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		await pfs.rimraf(newDir, pfs.RimRafMode.MOVE);
		assert.ok(!fs.existsSync(newDir));
	});

	test('rimraf - simple ends with dot slash/backslash - move', async () => {
		const id = `${uuid.generateUuid()}.`;
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		await pfs.rimraf(`${newDir}${path.sep}`, pfs.RimRafMode.MOVE);
		assert.ok(!fs.existsSync(newDir));
	});

	test('rimrafSync - swallows file not found error', function () {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		pfs.rimrafSync(newDir);

		assert.ok(!fs.existsSync(newDir));
	});

	test('rimrafSync - simple', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);

		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		pfs.rimrafSync(newDir);

		assert.ok(!fs.existsSync(newDir));
	});

	test('rimrafSync - recursive folder structure', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		fs.mkdirSync(path.join(newDir, 'somefolder'));
		fs.writeFileSync(path.join(newDir, 'somefolder', 'somefile.txt'), 'Contents');

		pfs.rimrafSync(newDir);

		assert.ok(!fs.existsSync(newDir));
	});

	test('moveIgnoreError', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);
		try {
			await pfs.renameIgnoreError(path.join(newDir, 'foo'), path.join(newDir, 'bar'));
			return pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
		}
		catch (error) {
			assert.fail(error);
		}
	});

	test('copy, move and delete', async () => {
		const id = uuid.generateUuid();
		const id2 = uuid.generateUuid();
		const sourceDir = getPathFromAmdModule(require, './fixtures');
		const parentDir = path.join(os.tmpdir(), 'vsctests', 'pfs');
		const targetDir = path.join(parentDir, id);
		const targetDir2 = path.join(parentDir, id2);

		await pfs.copy(sourceDir, targetDir);

		assert.ok(fs.existsSync(targetDir));
		assert.ok(fs.existsSync(path.join(targetDir, 'index.html')));
		assert.ok(fs.existsSync(path.join(targetDir, 'site.css')));
		assert.ok(fs.existsSync(path.join(targetDir, 'examples')));
		assert.ok(fs.statSync(path.join(targetDir, 'examples')).isDirectory());
		assert.ok(fs.existsSync(path.join(targetDir, 'examples', 'small.jxs')));

		await pfs.move(targetDir, targetDir2);

		assert.ok(!fs.existsSync(targetDir));
		assert.ok(fs.existsSync(targetDir2));
		assert.ok(fs.existsSync(path.join(targetDir2, 'index.html')));
		assert.ok(fs.existsSync(path.join(targetDir2, 'site.css')));
		assert.ok(fs.existsSync(path.join(targetDir2, 'examples')));
		assert.ok(fs.statSync(path.join(targetDir2, 'examples')).isDirectory());
		assert.ok(fs.existsSync(path.join(targetDir2, 'examples', 'small.jxs')));

		await pfs.move(path.join(targetDir2, 'index.html'), path.join(targetDir2, 'index_moved.html'));

		assert.ok(!fs.existsSync(path.join(targetDir2, 'index.html')));
		assert.ok(fs.existsSync(path.join(targetDir2, 'index_moved.html')));

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);

		assert.ok(!fs.existsSync(parentDir));
	});

	test('mkdirp', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);

		assert.ok(fs.existsSync(newDir));

		return pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});

	test('readDirsInDir', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);

		await pfs.mkdirp(newDir, 493);

		fs.mkdirSync(path.join(newDir, 'somefolder1'));
		fs.mkdirSync(path.join(newDir, 'somefolder2'));
		fs.mkdirSync(path.join(newDir, 'somefolder3'));
		fs.writeFileSync(path.join(newDir, 'somefile.txt'), 'Contents');
		fs.writeFileSync(path.join(newDir, 'someOtherFile.txt'), 'Contents');

		const result = await pfs.readDirsInDir(newDir);
		assert.equal(result.length, 3);
		assert.ok(result.indexOf('somefolder1') !== -1);
		assert.ok(result.indexOf('somefolder2') !== -1);
		assert.ok(result.indexOf('somefolder3') !== -1);

		await pfs.rimraf(newDir);
	});

	test('stat link', async () => {
		if (isWindows) {
			return; // Symlinks are not the same on win, and we can not create them programitically without admin privileges
		}

		const id1 = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id1);
		const directory = path.join(parentDir, 'pfs', id1);

		const id2 = uuid.generateUuid();
		const symbolicLink = path.join(parentDir, 'pfs', id2);

		await pfs.mkdirp(directory, 493);

		fs.symlinkSync(directory, symbolicLink);

		let statAndIsLink = await pfs.statLink(directory);
		assert.ok(!statAndIsLink?.symbolicLink);

		statAndIsLink = await pfs.statLink(symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink);
		assert.ok(!statAndIsLink?.symbolicLink?.dangling);

		pfs.rimrafSync(directory);
	});

	test('stat link (non existing target)', async () => {
		if (isWindows) {
			return; // Symlinks are not the same on win, and we can not create them programitically without admin privileges
		}

		const id1 = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id1);
		const directory = path.join(parentDir, 'pfs', id1);

		const id2 = uuid.generateUuid();
		const symbolicLink = path.join(parentDir, 'pfs', id2);

		await pfs.mkdirp(directory, 493);

		fs.symlinkSync(directory, symbolicLink);

		pfs.rimrafSync(directory);

		const statAndIsLink = await pfs.statLink(symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink);
		assert.ok(statAndIsLink?.symbolicLink?.dangling);
	});

	test('readdir', async () => {
		if (canNormalize && typeof process.versions['electron'] !== 'undefined' /* needs electron */) {
			const id = uuid.generateUuid();
			const parentDir = path.join(os.tmpdir(), 'vsctests', id);
			const newDir = path.join(parentDir, 'pfs', id, 'öäü');

			await pfs.mkdirp(newDir, 493);

			assert.ok(fs.existsSync(newDir));

			const children = await pfs.readdir(path.join(parentDir, 'pfs', id));
			assert.equal(children.some(n => n === 'öäü'), true); // Mac always converts to NFD, so

			await pfs.rimraf(parentDir);
		}
	});

	test('readdirWithFileTypes', async () => {
		if (canNormalize && typeof process.versions['electron'] !== 'undefined' /* needs electron */) {
			const id = uuid.generateUuid();
			const parentDir = path.join(os.tmpdir(), 'vsctests', id);
			const testDir = path.join(parentDir, 'pfs', id);

			const newDir = path.join(testDir, 'öäü');
			await pfs.mkdirp(newDir, 493);

			await pfs.writeFile(path.join(testDir, 'somefile.txt'), 'contents');

			assert.ok(fs.existsSync(newDir));

			const children = await pfs.readdirWithFileTypes(testDir);

			assert.equal(children.some(n => n.name === 'öäü'), true); // Mac always converts to NFD, so
			assert.equal(children.some(n => n.isDirectory()), true);

			assert.equal(children.some(n => n.name === 'somefile.txt'), true);
			assert.equal(children.some(n => n.isFile()), true);

			await pfs.rimraf(parentDir);
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
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);
		const testFile = path.join(newDir, 'flushed.txt');

		await pfs.mkdirp(newDir, 493);
		assert.ok(fs.existsSync(newDir));

		await pfs.writeFile(testFile, smallData);
		assert.equal(fs.readFileSync(testFile), smallDataValue);

		await pfs.writeFile(testFile, bigData);
		assert.equal(fs.readFileSync(testFile), bigDataValue);

		await pfs.rimraf(parentDir);
	}

	test('writeFile (string, error handling)', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);
		const testFile = path.join(newDir, 'flushed.txt');

		await pfs.mkdirp(newDir, 493);

		assert.ok(fs.existsSync(newDir));

		fs.mkdirSync(testFile); // this will trigger an error because testFile is now a directory!

		let expectedError: Error | undefined;
		try {
			await pfs.writeFile(testFile, 'Hello World');
		} catch (error) {
			expectedError = error;
		}

		assert.ok(expectedError);

		await pfs.rimraf(parentDir);
	});

	test('writeFileSync', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'pfs', id);
		const testFile = path.join(newDir, 'flushed.txt');

		await pfs.mkdirp(newDir, 493);

		assert.ok(fs.existsSync(newDir));

		pfs.writeFileSync(testFile, 'Hello World');
		assert.equal(fs.readFileSync(testFile), 'Hello World');

		const largeString = (new Array(100 * 1024)).join('Large String\n');

		pfs.writeFileSync(testFile, largeString);
		assert.equal(fs.readFileSync(testFile), largeString);

		await pfs.rimraf(parentDir);
	});
});
