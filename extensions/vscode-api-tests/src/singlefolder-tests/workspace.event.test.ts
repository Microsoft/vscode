/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { assertNoRpc, createRandomFile, disposeAll, withLogDisabled } from '../utils';

suite('vscode API - workspace events', () => {

	const disposables: vscode.Disposable[] = [];

	teardown(() => {
		assertNoRpc();
		disposeAll(disposables);
		disposables.length = 0;
	});

	test('onWillCreate/onDidCreate', withLogDisabled(async function () {

		const base = await createRandomFile();
		const newUri = base.with({ path: base.path + '-foo' });

		let onWillCreate: vscode.FileWillCreateEvent | undefined;
		let onDidCreate: vscode.FileCreateEvent | undefined;

		disposables.push(vscode.workspace.onWillCreateFiles(e => onWillCreate = e));
		disposables.push(vscode.workspace.onDidCreateFiles(e => onDidCreate = e));

		const edit = new vscode.WorkspaceEdit();
		edit.createFile(newUri);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);

		assert.ok(onWillCreate);
		assert.strictEqual(onWillCreate?.files.length, 1);
		assert.strictEqual(onWillCreate?.files[0].toString(), newUri.toString());

		assert.ok(onDidCreate);
		assert.strictEqual(onDidCreate?.files.length, 1);
		assert.strictEqual(onDidCreate?.files[0].toString(), newUri.toString());
	}));

	test('onWillCreate/onDidCreate, make changes, edit another file', withLogDisabled(async function () {

		const base = await createRandomFile();
		const baseDoc = await vscode.workspace.openTextDocument(base);

		const newUri = base.with({ path: base.path + '-foo' });

		disposables.push(vscode.workspace.onWillCreateFiles(e => {
			const ws = new vscode.WorkspaceEdit();
			ws.insert(base, new vscode.Position(0, 0), 'HALLO_NEW');
			e.waitUntil(Promise.resolve(ws));
		}));

		const edit = new vscode.WorkspaceEdit();
		edit.createFile(newUri);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);

		assert.strictEqual(baseDoc.getText(), 'HALLO_NEW');
	}));

	test('onWillCreate/onDidCreate, make changes, edit new file fails', withLogDisabled(async function () {

		const base = await createRandomFile();

		const newUri = base.with({ path: base.path + '-foo' });

		disposables.push(vscode.workspace.onWillCreateFiles(e => {
			const ws = new vscode.WorkspaceEdit();
			ws.insert(e.files[0], new vscode.Position(0, 0), 'nope');
			e.waitUntil(Promise.resolve(ws));
		}));

		const edit = new vscode.WorkspaceEdit();
		edit.createFile(newUri);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);

		assert.strictEqual((await vscode.workspace.fs.readFile(newUri)).toString(), '');
		assert.strictEqual((await vscode.workspace.openTextDocument(newUri)).getText(), '');
	}));

	test('onWillDelete/onDidDelete', withLogDisabled(async function () {

		const base = await createRandomFile();

		let onWilldelete: vscode.FileWillDeleteEvent | undefined;
		let onDiddelete: vscode.FileDeleteEvent | undefined;

		disposables.push(vscode.workspace.onWillDeleteFiles(e => onWilldelete = e));
		disposables.push(vscode.workspace.onDidDeleteFiles(e => onDiddelete = e));

		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(base);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);

		assert.ok(onWilldelete);
		assert.strictEqual(onWilldelete?.files.length, 1);
		assert.strictEqual(onWilldelete?.files[0].toString(), base.toString());

		assert.ok(onDiddelete);
		assert.strictEqual(onDiddelete?.files.length, 1);
		assert.strictEqual(onDiddelete?.files[0].toString(), base.toString());
	}));

	test('onWillDelete/onDidDelete, make changes', withLogDisabled(async function () {

		const base = await createRandomFile();
		const newUri = base.with({ path: base.path + '-NEW' });

		disposables.push(vscode.workspace.onWillDeleteFiles(e => {

			const edit = new vscode.WorkspaceEdit();
			edit.createFile(newUri);
			edit.insert(newUri, new vscode.Position(0, 0), 'hahah');
			e.waitUntil(Promise.resolve(edit));
		}));

		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(base);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);
	}));

	test('onWillDelete/onDidDelete, make changes, del another file', withLogDisabled(async function () {

		const base = await createRandomFile();
		const base2 = await createRandomFile();
		disposables.push(vscode.workspace.onWillDeleteFiles(e => {
			if (e.files[0].toString() === base.toString()) {
				const edit = new vscode.WorkspaceEdit();
				edit.deleteFile(base2);
				e.waitUntil(Promise.resolve(edit));
			}
		}));

		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(base);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);


	}));

	test('onWillDelete/onDidDelete, make changes, double delete', withLogDisabled(async function () {

		const base = await createRandomFile();
		let cnt = 0;
		disposables.push(vscode.workspace.onWillDeleteFiles(e => {
			if (++cnt === 0) {
				const edit = new vscode.WorkspaceEdit();
				edit.deleteFile(e.files[0]);
				e.waitUntil(Promise.resolve(edit));
			}
		}));

		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(base);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);
	}));

	test('onWillRename/onDidRename', withLogDisabled(async function () {

		const oldUri = await createRandomFile();
		const newUri = oldUri.with({ path: oldUri.path + '-NEW' });

		let onWillRename: vscode.FileWillRenameEvent | undefined;
		let onDidRename: vscode.FileRenameEvent | undefined;

		disposables.push(vscode.workspace.onWillRenameFiles(e => onWillRename = e));
		disposables.push(vscode.workspace.onDidRenameFiles(e => onDidRename = e));

		const edit = new vscode.WorkspaceEdit();
		edit.renameFile(oldUri, newUri);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);

		assert.ok(onWillRename);
		assert.strictEqual(onWillRename?.files.length, 1);
		assert.strictEqual(onWillRename?.files[0].oldUri.toString(), oldUri.toString());
		assert.strictEqual(onWillRename?.files[0].newUri.toString(), newUri.toString());

		assert.ok(onDidRename);
		assert.strictEqual(onDidRename?.files.length, 1);
		assert.strictEqual(onDidRename?.files[0].oldUri.toString(), oldUri.toString());
		assert.strictEqual(onDidRename?.files[0].newUri.toString(), newUri.toString());
	}));

	test('onWillRename - make changes (saved file)', withLogDisabled(function () {
		return testOnWillRename(false);
	}));

	test('onWillRename - make changes (dirty file)', withLogDisabled(function () {
		return testOnWillRename(true);
	}));

	async function testOnWillRename(withDirtyFile: boolean): Promise<void> {

		const oldUri = await createRandomFile('BAR');

		if (withDirtyFile) {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(oldUri, new vscode.Position(0, 0), 'BAR');

			const success = await vscode.workspace.applyEdit(edit);
			assert.ok(success);

			const oldDocument = await vscode.workspace.openTextDocument(oldUri);
			assert.ok(oldDocument.isDirty);
		}

		const newUri = oldUri.with({ path: oldUri.path + '-NEW' });

		const anotherFile = await createRandomFile('BAR');

		let onWillRename: vscode.FileWillRenameEvent | undefined;

		disposables.push(vscode.workspace.onWillRenameFiles(e => {
			onWillRename = e;
			const edit = new vscode.WorkspaceEdit();
			edit.insert(e.files[0].oldUri, new vscode.Position(0, 0), 'FOO');
			edit.replace(anotherFile, new vscode.Range(0, 0, 0, 3), 'FARBOO');
			e.waitUntil(Promise.resolve(edit));
		}));

		const edit = new vscode.WorkspaceEdit();
		edit.renameFile(oldUri, newUri);

		const success = await vscode.workspace.applyEdit(edit);
		assert.ok(success);

		assert.ok(onWillRename);
		assert.strictEqual(onWillRename?.files.length, 1);
		assert.strictEqual(onWillRename?.files[0].oldUri.toString(), oldUri.toString());
		assert.strictEqual(onWillRename?.files[0].newUri.toString(), newUri.toString());

		const newDocument = await vscode.workspace.openTextDocument(newUri);
		const anotherDocument = await vscode.workspace.openTextDocument(anotherFile);

		assert.strictEqual(newDocument.getText(), withDirtyFile ? 'FOOBARBAR' : 'FOOBAR');
		assert.strictEqual(anotherDocument.getText(), 'FARBOO');

		assert.ok(newDocument.isDirty);
		assert.ok(anotherDocument.isDirty);
	}
});
