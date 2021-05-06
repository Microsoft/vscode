/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TestFS } from './memfs';
import * as assert from 'assert';

export function rndName() {
	return Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
}

export const testFs = new TestFS('fake-fs', true);
vscode.workspace.registerFileSystemProvider(testFs.scheme, testFs, { isCaseSensitive: testFs.isCaseSensitive });

export async function createRandomFile(contents = '', dir: vscode.Uri | undefined = undefined, ext = ''): Promise<vscode.Uri> {
	let fakeFile: vscode.Uri;
	if (dir) {
		assert.strictEqual(dir.scheme, testFs.scheme);
		fakeFile = dir.with({ path: dir.path + '/' + rndName() + ext });
	} else {
		fakeFile = vscode.Uri.parse(`${testFs.scheme}:/${rndName() + ext}`);
	}
	testFs.writeFile(fakeFile, Buffer.from(contents), { create: true, overwrite: true });
	return fakeFile;
}

export async function deleteFile(file: vscode.Uri): Promise<boolean> {
	try {
		testFs.delete(file);
		return true;
	} catch {
		return false;
	}
}

export function pathEquals(path1: string, path2: string): boolean {
	if (process.platform !== 'linux') {
		path1 = path1.toLowerCase();
		path2 = path2.toLowerCase();
	}

	return path1 === path2;
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export function saveAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.files.saveAll');
}

export async function revertAllDirty(): Promise<void> {
	return vscode.commands.executeCommand('_workbench.revertAllDirty');
}

export function disposeAll(disposables: vscode.Disposable[]) {
	vscode.Disposable.from(...disposables).dispose();
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function withLogDisabled(runnable: () => Promise<any>): () => Promise<void> {
	return async (): Promise<void> => {
		const logLevel = await vscode.commands.executeCommand('_extensionTests.getLogLevel');
		await vscode.commands.executeCommand('_extensionTests.setLogLevel', 6 /* critical */);

		try {
			await runnable();
		} finally {
			await vscode.commands.executeCommand('_extensionTests.setLogLevel', logLevel);
		}
	};
}

export function assertNoRpc() {
	assertNoRpcFromEntry([vscode, 'vscode']);
}

export function assertNoRpcFromEntry(entry: [obj: any, name: string]) {

	const symProxy = Symbol.for('rpcProxy');
	const symProtocol = Symbol.for('rpcProtocol');

	const proxyPaths: string[] = [];
	const rpcPaths: string[] = [];

	function walk(obj: any, path: string, seen: Set<any>) {
		if (!obj) {
			return;
		}
		if (typeof obj !== 'object' && typeof obj !== 'function') {
			return;
		}
		if (seen.has(obj)) {
			return;
		}
		seen.add(obj);

		if (obj[symProtocol]) {
			rpcPaths.push(`PROTOCOL via ${path}`);
		}
		if (obj[symProxy]) {
			proxyPaths.push(`PROXY '${obj[symProxy]}' via ${path}`);
		}

		for (const key in obj) {
			walk(obj[key], `${path}.${String(key)}`, seen);
		}
	}

	try {
		walk(entry[0], entry[1], new Set());
	} catch (err) {
		assert.fail(err);
	}
	assert.strictEqual(rpcPaths.length, 0, rpcPaths.join('\n'));
	assert.strictEqual(proxyPaths.length, 0, proxyPaths.join('\n')); // happens...
}

export async function asPromise<T>(event: vscode.Event<T>, timeout = vscode.env.uiKind === vscode.UIKind.Desktop ? 5000 : 15000): Promise<T> {
	return new Promise<T>((resolve, reject) => {

		const handle = setTimeout(() => {
			sub.dispose();
			reject(new Error('asPromise TIMEOUT reached'));
		}, timeout);

		const sub = event(e => {
			clearTimeout(handle);
			sub.dispose();
			resolve(e);
		});
	});
}
