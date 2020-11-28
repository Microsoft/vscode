/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';

import { restoreWindowsState, getWindowsStateStoreData } from 'vs/platform/windows/electron-main/windowsStateStorage';
import { IWindowState as IWindowUIState, WindowMode } from 'vs/platform/windows/electron-main/windows';
import { IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { URI } from 'vs/base/common/uri';
import { IWindowsState, IWindowState } from 'vs/platform/windows/electron-main/windowsMainService';

function getUIState(): IWindowUIState {
	return {
		x: 0,
		y: 10,
		width: 100,
		height: 200,
		mode: 0
	};
}

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

function assertEqualWindowState(expected: IWindowState | undefined, actual: IWindowState | undefined, message?: string) {
	if (!expected || !actual) {
		assert.deepEqual(expected, actual, message);
		return;
	}
	assert.equal(expected.backupPath, actual.backupPath, message);
	assertEqualURI(expected.folderUri, actual.folderUri, message);
	assert.equal(expected.remoteAuthority, actual.remoteAuthority, message);
	assertEqualWorkspace(expected.workspace, actual.workspace, message);
	assert.deepEqual(expected.uiState, actual.uiState, message);
}

function assertEqualWindowsState(expected: IWindowsState, actual: IWindowsState, message?: string) {
	assertEqualWindowState(expected.lastPluginDevelopmentHostWindow, actual.lastPluginDevelopmentHostWindow, message);
	assertEqualWindowState(expected.lastActiveWindow, actual.lastActiveWindow, message);
	assert.equal(expected.openedWindows.length, actual.openedWindows.length, message);
	for (let i = 0; i < expected.openedWindows.length; i++) {
		assertEqualWindowState(expected.openedWindows[i], actual.openedWindows[i], message);
	}
}

function assertRestoring(state: IWindowsState, message?: string) {
	const stored = getWindowsStateStoreData(state);
	const restored = restoreWindowsState(stored);
	assertEqualWindowsState(state, restored, message);
}

const testBackupPath1 = path.join(os.tmpdir(), 'windowStateTest', 'backupFolder1');
const testBackupPath2 = path.join(os.tmpdir(), 'windowStateTest', 'backupFolder2');

const testWSPath = URI.file(path.join(os.tmpdir(), 'windowStateTest', 'test.code-workspace'));
const testFolderURI = URI.file(path.join(os.tmpdir(), 'windowStateTest', 'testFolder'));

const testRemoteFolderURI = URI.parse('foo://bar/c/d');

suite('Windows State Storing', () => {
	test('storing and restoring', () => {
		let windowState: IWindowsState;
		windowState = {
			openedWindows: []
		};
		assertRestoring(windowState, 'no windows');
		windowState = {
			openedWindows: [{ backupPath: testBackupPath1, uiState: getUIState() }]
		};
		assertRestoring(windowState, 'empty workspace');

		windowState = {
			openedWindows: [{ backupPath: testBackupPath1, uiState: getUIState(), workspace: toWorkspace(testWSPath) }]
		};
		assertRestoring(windowState, 'workspace');

		windowState = {
			openedWindows: [{ backupPath: testBackupPath2, uiState: getUIState(), folderUri: testFolderURI }]
		};
		assertRestoring(windowState, 'folder');

		windowState = {
			openedWindows: [{ backupPath: testBackupPath1, uiState: getUIState(), folderUri: testFolderURI }, { backupPath: testBackupPath1, uiState: getUIState(), folderUri: testRemoteFolderURI, remoteAuthority: 'bar' }]
		};
		assertRestoring(windowState, 'multiple windows');

		windowState = {
			lastActiveWindow: { backupPath: testBackupPath2, uiState: getUIState(), folderUri: testFolderURI },
			openedWindows: []
		};
		assertRestoring(windowState, 'lastActiveWindow');

		windowState = {
			lastPluginDevelopmentHostWindow: { backupPath: testBackupPath2, uiState: getUIState(), folderUri: testFolderURI },
			openedWindows: []
		};
		assertRestoring(windowState, 'lastPluginDevelopmentHostWindow');
	});

	test('open 1_31', () => {
		const v1_31_workspace = `{
			"openedWindows": [],
			"lastActiveWindow": {
				"workspace": {
					"id": "a41787288b5e9cc1a61ba2dd84cd0d80",
					"configPath": "/home/user/workspaces/code-and-docs.code-workspace"
				},
				"backupPath": "/home/user/.config/Code - Insiders/Backups/a41787288b5e9cc1a61ba2dd84cd0d80",
				"uiState": {
					"mode": 0,
					"x": 0,
					"y": 27,
					"width": 2560,
					"height": 1364
				}
			}
		}`;

		let windowsState = restoreWindowsState(JSON.parse(v1_31_workspace));
		let expected: IWindowsState = {
			openedWindows: [],
			lastActiveWindow: {
				backupPath: '/home/user/.config/Code - Insiders/Backups/a41787288b5e9cc1a61ba2dd84cd0d80',
				uiState: { mode: WindowMode.Maximized, x: 0, y: 27, width: 2560, height: 1364 },
				workspace: { id: 'a41787288b5e9cc1a61ba2dd84cd0d80', configPath: URI.file('/home/user/workspaces/code-and-docs.code-workspace') }
			}
		};

		assertEqualWindowsState(expected, windowsState, 'v1_31_workspace');

		const v1_31_folder = `{
			"openedWindows": [],
			"lastPluginDevelopmentHostWindow": {
				"folderUri": {
					"$mid": 1,
					"fsPath": "/home/user/workspaces/testing/customdata",
					"external": "file:///home/user/workspaces/testing/customdata",
					"path": "/home/user/workspaces/testing/customdata",
					"scheme": "file"
				},
				"uiState": {
					"mode": 1,
					"x": 593,
					"y": 617,
					"width": 1625,
					"height": 595
				}
			}
		}`;

		windowsState = restoreWindowsState(JSON.parse(v1_31_folder));
		expected = {
			openedWindows: [],
			lastPluginDevelopmentHostWindow: {
				uiState: { mode: WindowMode.Normal, x: 593, y: 617, width: 1625, height: 595 },
				folderUri: URI.parse('file:///home/user/workspaces/testing/customdata')
			}
		};
		assertEqualWindowsState(expected, windowsState, 'v1_31_folder');

		const v1_31_empty_window = ` {
			"openedWindows": [
			],
			"lastActiveWindow": {
				"backupPath": "C:\\\\Users\\\\Mike\\\\AppData\\\\Roaming\\\\Code\\\\Backups\\\\1549538599815",
				"uiState": {
					"mode": 0,
					"x": -8,
					"y": -8,
					"width": 2576,
					"height": 1344
				}
			}
		}`;

		windowsState = restoreWindowsState(JSON.parse(v1_31_empty_window));
		expected = {
			openedWindows: [],
			lastActiveWindow: {
				backupPath: 'C:\\Users\\Mike\\AppData\\Roaming\\Code\\Backups\\1549538599815',
				uiState: { mode: WindowMode.Maximized, x: -8, y: -8, width: 2576, height: 1344 }
			}
		};
		assertEqualWindowsState(expected, windowsState, 'v1_31_empty_window');

	});

	test('open 1_32', () => {
		const v1_32_workspace = `{
			"openedWindows": [],
			"lastActiveWindow": {
				"workspaceIdentifier": {
					"id": "53b714b46ef1a2d4346568b4f591028c",
					"configURIPath": "file:///home/user/workspaces/testing/custom.code-workspace"
				},
				"backupPath": "/home/user/.config/code-oss-dev/Backups/53b714b46ef1a2d4346568b4f591028c",
				"uiState": {
					"mode": 0,
					"x": 0,
					"y": 27,
					"width": 2560,
					"height": 1364
				}
			}
		}`;

		let windowsState = restoreWindowsState(JSON.parse(v1_32_workspace));
		let expected: IWindowsState = {
			openedWindows: [],
			lastActiveWindow: {
				backupPath: '/home/user/.config/code-oss-dev/Backups/53b714b46ef1a2d4346568b4f591028c',
				uiState: { mode: WindowMode.Maximized, x: 0, y: 27, width: 2560, height: 1364 },
				workspace: { id: '53b714b46ef1a2d4346568b4f591028c', configPath: URI.parse('file:///home/user/workspaces/testing/custom.code-workspace') }
			}
		};

		assertEqualWindowsState(expected, windowsState, 'v1_32_workspace');

		const v1_32_folder = `{
			"openedWindows": [],
			"lastActiveWindow": {
				"folder": "file:///home/user/workspaces/testing/folding",
				"backupPath": "/home/user/.config/code-oss-dev/Backups/1daac1621c6c06f9e916ac8062e5a1b5",
				"uiState": {
					"mode": 1,
					"x": 625,
					"y": 263,
					"width": 1718,
					"height": 953
				}
			}
		}`;

		windowsState = restoreWindowsState(JSON.parse(v1_32_folder));
		expected = {
			openedWindows: [],
			lastActiveWindow: {
				backupPath: '/home/user/.config/code-oss-dev/Backups/1daac1621c6c06f9e916ac8062e5a1b5',
				uiState: { mode: WindowMode.Normal, x: 625, y: 263, width: 1718, height: 953 },
				folderUri: URI.parse('file:///home/user/workspaces/testing/folding')
			}
		};
		assertEqualWindowsState(expected, windowsState, 'v1_32_folder');

		const v1_32_empty_window = ` {
			"openedWindows": [
			],
			"lastActiveWindow": {
				"backupPath": "/home/user/.config/code-oss-dev/Backups/1549539668998",
				"uiState": {
					"mode": 1,
					"x": 768,
					"y": 336,
					"width": 1024,
					"height": 768
				}
			}
		}`;

		windowsState = restoreWindowsState(JSON.parse(v1_32_empty_window));
		expected = {
			openedWindows: [],
			lastActiveWindow: {
				backupPath: '/home/user/.config/code-oss-dev/Backups/1549539668998',
				uiState: { mode: WindowMode.Normal, x: 768, y: 336, width: 1024, height: 768 }
			}
		};
		assertEqualWindowsState(expected, windowsState, 'v1_32_empty_window');

	});

});
