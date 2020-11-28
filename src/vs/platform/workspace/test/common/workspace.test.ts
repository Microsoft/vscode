/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'vs/base/common/path';
import { Workspace, toWorkspaceFolders, WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';
import { IRawFileWorkspaceFolder } from 'vs/platform/workspaces/common/workspaces';
import { isLinux, isWindows } from 'vs/base/common/platform';

suite('Workspace', () => {

	const fileFolder = isWindows ? 'c:\\src' : '/src';
	const abcFolder = isWindows ? 'c:\\abc' : '/abc';

	const testFolderUri = URI.file(path.join(fileFolder, 'test'));
	const mainFolderUri = URI.file(path.join(fileFolder, 'main'));
	const test1FolderUri = URI.file(path.join(fileFolder, 'test1'));
	const test2FolderUri = URI.file(path.join(fileFolder, 'test2'));
	const test3FolderUri = URI.file(path.join(fileFolder, 'test3'));
	const abcTest1FolderUri = URI.file(path.join(abcFolder, 'test1'));
	const abcTest3FolderUri = URI.file(path.join(abcFolder, 'test3'));

	const workspaceConfigUri = URI.file(path.join(fileFolder, 'test.code-workspace'));

	test('getFolder returns the folder with given uri', () => {
		const expected = new WorkspaceFolder({ uri: testFolderUri, name: '', index: 2 });
		let testObject = new Workspace('', [new WorkspaceFolder({ uri: mainFolderUri, name: '', index: 0 }), expected, new WorkspaceFolder({ uri: URI.file('/src/code'), name: '', index: 2 })], null, () => !isLinux);

		const actual = testObject.getFolder(expected.uri);

		assert.equal(actual, expected);
	});

	test('getFolder returns the folder if the uri is sub', () => {
		const expected = new WorkspaceFolder({ uri: testFolderUri, name: '', index: 0 });
		let testObject = new Workspace('', [expected, new WorkspaceFolder({ uri: mainFolderUri, name: '', index: 1 }), new WorkspaceFolder({ uri: URI.file('/src/code'), name: '', index: 2 })], null, () => !isLinux);

		const actual = testObject.getFolder(URI.file(path.join(fileFolder, 'test/a')));

		assert.equal(actual, expected);
	});

	test('getFolder returns the closest folder if the uri is sub', () => {
		const expected = new WorkspaceFolder({ uri: testFolderUri, name: '', index: 2 });
		let testObject = new Workspace('', [new WorkspaceFolder({ uri: mainFolderUri, name: '', index: 0 }), new WorkspaceFolder({ uri: URI.file('/src/code'), name: '', index: 1 }), expected], null, () => !isLinux);

		const actual = testObject.getFolder(URI.file(path.join(fileFolder, 'test/a')));

		assert.equal(actual, expected);
	});

	test('getFolder returns the folder even if the uri has query path', () => {
		const expected = new WorkspaceFolder({ uri: testFolderUri, name: '', index: 2 });
		let testObject = new Workspace('', [new WorkspaceFolder({ uri: mainFolderUri, name: '', index: 0 }), new WorkspaceFolder({ uri: URI.file('/src/code'), name: '', index: 1 }), expected], null, () => !isLinux);

		const actual = testObject.getFolder(URI.file(path.join(fileFolder, 'test/a')).with({ query: 'somequery' }));

		assert.equal(actual, expected);
	});

	test('getFolder returns null if the uri is not sub', () => {
		let testObject = new Workspace('', [new WorkspaceFolder({ uri: testFolderUri, name: '', index: 0 }), new WorkspaceFolder({ uri: URI.file('/src/code'), name: '', index: 1 })], null, () => !isLinux);

		const actual = testObject.getFolder(URI.file(path.join(fileFolder, 'main/a')));

		assert.equal(actual, undefined);
	});

	test('toWorkspaceFolders with single absolute folder', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test' }], workspaceConfigUri);

		assert.equal(actual.length, 1);
		assert.equal(actual[0].uri.fsPath, testFolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test');
	});

	test('toWorkspaceFolders with single relative folder', () => {
		const actual = toWorkspaceFolders([{ path: './test' }], workspaceConfigUri);

		assert.equal(actual.length, 1);
		assert.equal(actual[0].uri.fsPath, testFolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, './test');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test');
	});

	test('toWorkspaceFolders with single absolute folder with name', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test', name: 'hello' }], workspaceConfigUri);

		assert.equal(actual.length, 1);

		assert.equal(actual[0].uri.fsPath, testFolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'hello');
	});

	test('toWorkspaceFolders with multiple unique absolute folders', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test2' }, { path: '/src/test3' }, { path: '/src/test1' }], workspaceConfigUri);

		assert.equal(actual.length, 3);
		assert.equal(actual[0].uri.fsPath, test2FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test2');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test2');

		assert.equal(actual[1].uri.fsPath, test3FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[1].raw).path, '/src/test3');
		assert.equal(actual[1].index, 1);
		assert.equal(actual[1].name, 'test3');

		assert.equal(actual[2].uri.fsPath, test1FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[2].raw).path, '/src/test1');
		assert.equal(actual[2].index, 2);
		assert.equal(actual[2].name, 'test1');
	});

	test('toWorkspaceFolders with multiple unique absolute folders with names', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test2' }, { path: '/src/test3', name: 'noName' }, { path: '/src/test1' }], workspaceConfigUri);

		assert.equal(actual.length, 3);
		assert.equal(actual[0].uri.fsPath, test2FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test2');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test2');

		assert.equal(actual[1].uri.fsPath, test3FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[1].raw).path, '/src/test3');
		assert.equal(actual[1].index, 1);
		assert.equal(actual[1].name, 'noName');

		assert.equal(actual[2].uri.fsPath, test1FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[2].raw).path, '/src/test1');
		assert.equal(actual[2].index, 2);
		assert.equal(actual[2].name, 'test1');
	});

	test('toWorkspaceFolders with multiple unique absolute and relative folders', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test2' }, { path: '/abc/test3', name: 'noName' }, { path: './test1' }], workspaceConfigUri);

		assert.equal(actual.length, 3);
		assert.equal(actual[0].uri.fsPath, test2FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test2');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test2');

		assert.equal(actual[1].uri.fsPath, abcTest3FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[1].raw).path, '/abc/test3');
		assert.equal(actual[1].index, 1);
		assert.equal(actual[1].name, 'noName');

		assert.equal(actual[2].uri.fsPath, test1FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[2].raw).path, './test1');
		assert.equal(actual[2].index, 2);
		assert.equal(actual[2].name, 'test1');
	});

	test('toWorkspaceFolders with multiple absolute folders with duplicates', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test2' }, { path: '/src/test2', name: 'noName' }, { path: '/src/test1' }], workspaceConfigUri);

		assert.equal(actual.length, 2);
		assert.equal(actual[0].uri.fsPath, test2FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test2');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test2');

		assert.equal(actual[1].uri.fsPath, test1FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[1].raw).path, '/src/test1');
		assert.equal(actual[1].index, 1);
		assert.equal(actual[1].name, 'test1');
	});

	test('toWorkspaceFolders with multiple absolute and relative folders with duplicates', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test2' }, { path: '/src/test3', name: 'noName' }, { path: './test3' }, { path: '/abc/test1' }], workspaceConfigUri);

		assert.equal(actual.length, 3);
		assert.equal(actual[0].uri.fsPath, test2FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test2');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test2');

		assert.equal(actual[1].uri.fsPath, test3FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[1].raw).path, '/src/test3');
		assert.equal(actual[1].index, 1);
		assert.equal(actual[1].name, 'noName');

		assert.equal(actual[2].uri.fsPath, abcTest1FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[2].raw).path, '/abc/test1');
		assert.equal(actual[2].index, 2);
		assert.equal(actual[2].name, 'test1');
	});

	test('toWorkspaceFolders with multiple absolute and relative folders with invalid paths', () => {
		const actual = toWorkspaceFolders([{ path: '/src/test2' }, { path: '', name: 'noName' }, { path: './test3' }, { path: '/abc/test1' }], workspaceConfigUri);

		assert.equal(actual.length, 3);
		assert.equal(actual[0].uri.fsPath, test2FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[0].raw).path, '/src/test2');
		assert.equal(actual[0].index, 0);
		assert.equal(actual[0].name, 'test2');

		assert.equal(actual[1].uri.fsPath, test3FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[1].raw).path, './test3');
		assert.equal(actual[1].index, 1);
		assert.equal(actual[1].name, 'test3');

		assert.equal(actual[2].uri.fsPath, abcTest1FolderUri.fsPath);
		assert.equal((<IRawFileWorkspaceFolder>actual[2].raw).path, '/abc/test1');
		assert.equal(actual[2].index, 2);
		assert.equal(actual[2].name, 'test1');
	});
});
