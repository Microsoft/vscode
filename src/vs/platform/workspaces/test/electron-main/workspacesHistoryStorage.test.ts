/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import { IWorkspaceIdentifier, IRecentlyOpened, isRecentFolder, IRecentFolder, IRecentWorkspace, toStoreData, restoreRecentlyOpened } from 'vs/platform/workspaces/common/workspaces';
import { URI } from 'vs/base/common/uri';
import { NullLogService } from 'vs/platform/log/common/log';

function toWorkspace(uri: URI): IWorkspaceIdentifier {
	return {
		id: '1234',
		configPath: uri
	};
}
function assertEqualURI(u1: URI | undefined, u2: URI | undefined, message?: string): void {
	assert.equal(u1 && u1.toString(), u2 && u2.toString(), message);
}

function assertEqualWorkspace(w1: IWorkspaceIdentifier | undefined, w2: IWorkspaceIdentifier | undefined, message?: string): void {
	if (!w1 || !w2) {
		assert.equal(w1, w2, message);
		return;
	}
	assert.equal(w1.id, w2.id, message);
	assertEqualURI(w1.configPath, w2.configPath, message);
}

function assertEqualRecentlyOpened(actual: IRecentlyOpened, expected: IRecentlyOpened, message?: string) {
	assert.equal(actual.files.length, expected.files.length, message);
	for (let i = 0; i < actual.files.length; i++) {
		assertEqualURI(actual.files[i].fileUri, expected.files[i].fileUri, message);
		assert.equal(actual.files[i].label, expected.files[i].label);
	}
	assert.equal(actual.workspaces.length, expected.workspaces.length, message);
	for (let i = 0; i < actual.workspaces.length; i++) {
		let expectedRecent = expected.workspaces[i];
		let actualRecent = actual.workspaces[i];
		if (isRecentFolder(actualRecent)) {
			assertEqualURI(actualRecent.folderUri, (<IRecentFolder>expectedRecent).folderUri, message);
		} else {
			assertEqualWorkspace(actualRecent.workspace, (<IRecentWorkspace>expectedRecent).workspace, message);
		}
		assert.equal(actualRecent.label, expectedRecent.label);
	}
}

function assertRestoring(state: IRecentlyOpened, message?: string) {
	const stored = toStoreData(state);
	const restored = restoreRecentlyOpened(stored, new NullLogService());
	assertEqualRecentlyOpened(state, restored, message);
}

const testWSPath = URI.file(path.join(os.tmpdir(), 'windowStateTest', 'test.code-workspace'));
const testFileURI = URI.file(path.join(os.tmpdir(), 'windowStateTest', 'testFile.txt'));
const testFolderURI = URI.file(path.join(os.tmpdir(), 'windowStateTest', 'testFolder'));

const testRemoteFolderURI = URI.parse('foo://bar/c/e');
const testRemoteFileURI = URI.parse('foo://bar/c/d.txt');
const testRemoteWSURI = URI.parse('foo://bar/c/test.code-workspace');

suite('History Storage', () => {
	test('storing and restoring', () => {
		let ro: IRecentlyOpened;
		ro = {
			files: [],
			workspaces: []
		};
		assertRestoring(ro, 'empty');
		ro = {
			files: [{ fileUri: testFileURI }],
			workspaces: []
		};
		assertRestoring(ro, 'file');
		ro = {
			files: [],
			workspaces: [{ folderUri: testFolderURI }]
		};
		assertRestoring(ro, 'folder');
		ro = {
			files: [],
			workspaces: [{ workspace: toWorkspace(testWSPath) }, { folderUri: testFolderURI }]
		};
		assertRestoring(ro, 'workspaces and folders');

		ro = {
			files: [{ fileUri: testRemoteFileURI }],
			workspaces: [{ workspace: toWorkspace(testRemoteWSURI) }, { folderUri: testRemoteFolderURI }]
		};
		assertRestoring(ro, 'remote workspaces and folders');
		ro = {
			files: [{ label: 'abc', fileUri: testFileURI }],
			workspaces: [{ label: 'def', workspace: toWorkspace(testWSPath) }, { folderUri: testRemoteFolderURI }]
		};
		assertRestoring(ro, 'labels');
	});

	test('open 1_33', () => {
		const v1_33 = `{
			"workspaces3": [
				{
					"id": "53b714b46ef1a2d4346568b4f591028c",
					"configURIPath": "file:///home/user/workspaces/testing/custom.code-workspace"
				},
				"file:///home/user/workspaces/testing/folding"
			],
			"files2": [
				"file:///home/user/.config/code-oss-dev/storage.json"
			],
			"workspaceLabels": [
				null,
				"abc"
			],
			"fileLabels": [
				"def"
			]
		}`;

		let windowsState = restoreRecentlyOpened(JSON.parse(v1_33), new NullLogService());
		let expected: IRecentlyOpened = {
			files: [{ label: 'def', fileUri: URI.parse('file:///home/user/.config/code-oss-dev/storage.json') }],
			workspaces: [
				{ workspace: { id: '53b714b46ef1a2d4346568b4f591028c', configPath: URI.parse('file:///home/user/workspaces/testing/custom.code-workspace') } },
				{ label: 'abc', folderUri: URI.parse('file:///home/user/workspaces/testing/folding') }
			]
		};

		assertEqualRecentlyOpened(windowsState, expected, 'v1_33');

	});


});
