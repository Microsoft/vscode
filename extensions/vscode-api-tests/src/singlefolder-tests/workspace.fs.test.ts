/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { posix } from 'path';
import { assertNoRpc } from '../utils';

suite('vscode API - workspace-fs', () => {

	let root: vscode.Uri;

	suiteSetup(function () {
		root = vscode.workspace.workspaceFolders![0]!.uri;
	});

	teardown(assertNoRpc);

	test('fs.stat', async function () {
		const stat = await vscode.workspace.fs.stat(root);
		assert.strictEqual(stat.type, vscode.FileType.Directory);

		assert.strictEqual(typeof stat.size, 'number');
		assert.strictEqual(typeof stat.mtime, 'number');
		assert.strictEqual(typeof stat.ctime, 'number');

		assert.ok(stat.mtime > 0);
		assert.ok(stat.ctime > 0);

		const entries = await vscode.workspace.fs.readDirectory(root);
		assert.ok(entries.length > 0);

		// find far.js
		const tuple = entries.find(tuple => tuple[0] === 'far.js')!;
		assert.ok(tuple);
		assert.strictEqual(tuple[0], 'far.js');
		assert.strictEqual(tuple[1], vscode.FileType.File);
	});

	test('fs.stat - bad scheme', async function () {
		try {
			await vscode.workspace.fs.stat(vscode.Uri.parse('foo:/bar/baz/test.txt'));
			assert.ok(false);
		} catch {
			assert.ok(true);
		}
	});

	test('fs.stat - missing file', async function () {
		try {
			await vscode.workspace.fs.stat(root.with({ path: root.path + '.bad' }));
			assert.ok(false);
		} catch (e) {
			assert.ok(true);
		}
	});

	test('fs.write/stat/delete', async function () {

		const uri = root.with({ path: posix.join(root.path, 'new.file') });
		await vscode.workspace.fs.writeFile(uri, Buffer.from('HELLO'));

		const stat = await vscode.workspace.fs.stat(uri);
		assert.strictEqual(stat.type, vscode.FileType.File);

		await vscode.workspace.fs.delete(uri);

		try {
			await vscode.workspace.fs.stat(uri);
			assert.ok(false);
		} catch {
			assert.ok(true);
		}
	});

	test('fs.delete folder', async function () {

		const folder = root.with({ path: posix.join(root.path, 'folder') });
		const file = root.with({ path: posix.join(root.path, 'folder/file') });

		await vscode.workspace.fs.createDirectory(folder);
		await vscode.workspace.fs.writeFile(file, Buffer.from('FOO'));

		await vscode.workspace.fs.stat(folder);
		await vscode.workspace.fs.stat(file);

		// ensure non empty folder cannot be deleted
		try {
			await vscode.workspace.fs.delete(folder, { recursive: false, useTrash: false });
			assert.ok(false);
		} catch {
			await vscode.workspace.fs.stat(folder);
			await vscode.workspace.fs.stat(file);
		}

		// ensure non empty folder cannot be deleted is DEFAULT
		try {
			await vscode.workspace.fs.delete(folder); // recursive: false as default
			assert.ok(false);
		} catch {
			await vscode.workspace.fs.stat(folder);
			await vscode.workspace.fs.stat(file);
		}

		// delete non empty folder with recursive-flag
		await vscode.workspace.fs.delete(folder, { recursive: true, useTrash: false });

		// esnure folder/file are gone
		try {
			await vscode.workspace.fs.stat(folder);
			assert.ok(false);
		} catch {
			assert.ok(true);
		}
		try {
			await vscode.workspace.fs.stat(file);
			assert.ok(false);
		} catch {
			assert.ok(true);
		}
	});

	test('throws FileSystemError', async function () {

		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(`/c468bf16-acfd-4591-825e-2bcebba508a3/71b1f274-91cb-4c19-af00-8495eaab4b73/4b60cb48-a6f2-40ea-9085-0936f4a8f59a.tx6`));
			assert.ok(false);
		} catch (e) {
			assert.ok(e instanceof vscode.FileSystemError);
			assert.strictEqual(e.name, vscode.FileSystemError.FileNotFound().name);
		}
	});

	test('throws FileSystemError', async function () {

		try {
			await vscode.workspace.fs.stat(vscode.Uri.parse('foo:/bar'));
			assert.ok(false);
		} catch (e) {
			assert.ok(e instanceof vscode.FileSystemError);
			assert.strictEqual(e.name, vscode.FileSystemError.Unavailable().name);
		}
	});

	test('vscode.workspace.fs.remove() (and copy()) succeed unexpectedly. #84177', async function () {
		const entries = await vscode.workspace.fs.readDirectory(root);
		assert.ok(entries.length > 0);

		const someFolder = root.with({ path: posix.join(root.path, '6b1f9d664a92') });

		try {
			await vscode.workspace.fs.delete(someFolder, { recursive: true });
			assert.ok(false);
		} catch (err) {
			assert.ok(true);
		}
	});

	test('vscode.workspace.fs.remove() (and copy()) succeed unexpectedly. #84177', async function () {
		const entries = await vscode.workspace.fs.readDirectory(root);
		assert.ok(entries.length > 0);

		const folder = root.with({ path: posix.join(root.path, 'folder') });
		const file = root.with({ path: posix.join(root.path, 'folder/file') });

		await vscode.workspace.fs.createDirectory(folder);
		await vscode.workspace.fs.writeFile(file, Buffer.from('FOO'));

		const someFolder = root.with({ path: posix.join(root.path, '6b1f9d664a92/a564c52da70a') });

		try {
			await vscode.workspace.fs.copy(folder, someFolder, { overwrite: true });
			assert.ok(true);
		} catch (err) {
			assert.ok(false, err);

		} finally {
			await vscode.workspace.fs.delete(folder, { recursive: true, useTrash: false });
			await vscode.workspace.fs.delete(someFolder, { recursive: true, useTrash: false });
		}
	});
});
