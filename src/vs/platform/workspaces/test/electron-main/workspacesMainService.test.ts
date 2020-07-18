/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as pfs from 'vs/base/node/pfs';
import { EnvironmentService } from 'vs/platform/environment/node/environmentService';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { WorkspacesMainService, IStoredWorkspace } from 'vs/platform/workspaces/electron-main/workspacesMainService';
import { WORKSPACE_EXTENSION, IRawFileWorkspaceFolder, IWorkspaceFolderCreationData, IRawUriWorkspaceFolder, rewriteWorkspaceFileForNewLocation, IWorkspaceIdentifier, IStoredWorkspaceFolder } from 'vs/platform/workspaces/common/workspaces';
import { NullLogService } from 'vs/platform/log/common/log';
import { URI } from 'vs/base/common/uri';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { isWindows } from 'vs/base/common/platform';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { dirname, joinPath } from 'vs/base/common/resources';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { IBackupMainService, IWorkspaceBackupInfo } from 'vs/platform/backup/electron-main/backup';
import { IEmptyWindowBackupInfo } from 'vs/platform/backup/node/backup';

export class TestDialogMainService implements IDialogMainService {
	declare readonly _serviceBrand: undefined;

	pickFileFolder(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> {
		throw new Error('Method not implemented.');
	}

	pickFolder(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> {
		throw new Error('Method not implemented.');
	}

	pickFile(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> {
		throw new Error('Method not implemented.');
	}

	pickWorkspace(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> {
		throw new Error('Method not implemented.');
	}

	showMessageBox(options: Electron.MessageBoxOptions, window?: Electron.BrowserWindow | undefined): Promise<Electron.MessageBoxReturnValue> {
		throw new Error('Method not implemented.');
	}

	showSaveDialog(options: Electron.SaveDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<Electron.SaveDialogReturnValue> {
		throw new Error('Method not implemented.');
	}

	showOpenDialog(options: Electron.OpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<Electron.OpenDialogReturnValue> {
		throw new Error('Method not implemented.');
	}
}

export class TestBackupMainService implements IBackupMainService {

	declare readonly _serviceBrand: undefined;

	isHotExitEnabled(): boolean {
		throw new Error('Method not implemented.');
	}

	getWorkspaceBackups(): IWorkspaceBackupInfo[] {
		throw new Error('Method not implemented.');
	}

	getFolderBackupPaths(): URI[] {
		throw new Error('Method not implemented.');
	}

	getEmptyWindowBackupPaths(): IEmptyWindowBackupInfo[] {
		throw new Error('Method not implemented.');
	}

	registerWorkspaceBackupSync(workspace: IWorkspaceBackupInfo, migrateFrom?: string | undefined): string {
		throw new Error('Method not implemented.');
	}

	registerFolderBackupSync(folderUri: URI): string {
		throw new Error('Method not implemented.');
	}

	registerEmptyWindowBackupSync(backupFolder?: string | undefined, remoteAuthority?: string | undefined): string {
		throw new Error('Method not implemented.');
	}

	unregisterWorkspaceBackupSync(workspace: IWorkspaceIdentifier): void {
		throw new Error('Method not implemented.');
	}

	unregisterFolderBackupSync(folderUri: URI): void {
		throw new Error('Method not implemented.');
	}

	unregisterEmptyWindowBackupSync(backupFolder: string): void {
		throw new Error('Method not implemented.');
	}

	async getDirtyWorkspaces(): Promise<(IWorkspaceIdentifier | URI)[]> {
		return [];
	}
}

suite('WorkspacesMainService', () => {
	const parentDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'workspacesservice');
	const untitledWorkspacesHomePath = path.join(parentDir, 'Workspaces');

	class TestEnvironmentService extends EnvironmentService {
		get untitledWorkspacesHome(): URI {
			return URI.file(untitledWorkspacesHomePath);
		}
	}

	function createUntitledWorkspace(folders: string[], names?: string[]) {
		return service.createUntitledWorkspace(folders.map((folder, index) => ({ uri: URI.file(folder), name: names ? names[index] : undefined } as IWorkspaceFolderCreationData)));
	}

	function createWorkspace(workspaceConfigPath: string, folders: (string | URI)[], names?: string[]): void {

		const ws: IStoredWorkspace = {
			folders: []
		};
		for (let i = 0; i < folders.length; i++) {
			const f = folders[i];
			const s: IStoredWorkspaceFolder = f instanceof URI ? { uri: f.toString() } : { path: f };
			if (names) {
				s.name = names[i];
			}
			ws.folders.push(s);
		}
		fs.writeFileSync(workspaceConfigPath, JSON.stringify(ws));
	}

	function createUntitledWorkspaceSync(folders: string[], names?: string[]) {
		return service.createUntitledWorkspaceSync(folders.map((folder, index) => ({ uri: URI.file(folder), name: names ? names[index] : undefined } as IWorkspaceFolderCreationData)));
	}

	const environmentService = new TestEnvironmentService(parseArgs(process.argv, OPTIONS), process.execPath);
	const logService = new NullLogService();

	let service: WorkspacesMainService;

	setup(async () => {
		service = new WorkspacesMainService(environmentService, logService, new TestBackupMainService(), new TestDialogMainService());

		// Delete any existing backups completely and then re-create it.
		await pfs.rimraf(untitledWorkspacesHomePath, pfs.RimRafMode.MOVE);

		return pfs.mkdirp(untitledWorkspacesHomePath);
	});

	teardown(() => {
		return pfs.rimraf(untitledWorkspacesHomePath, pfs.RimRafMode.MOVE);
	});

	function assertPathEquals(p1: string, p2: string): void {
		if (isWindows) {
			p1 = normalizeDriveLetter(p1);
			p2 = normalizeDriveLetter(p2);
		}

		assert.equal(p1, p2);
	}

	function assertEqualURI(u1: URI, u2: URI): void {
		assert.equal(u1.toString(), u2.toString());
	}

	test('createWorkspace (folders)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = (JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace);
		assert.equal(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, process.cwd());
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, os.tmpdir());
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
	});

	test('createWorkspace (folders with name)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()], ['currentworkingdirectory', 'tempdir']);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = (JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace);
		assert.equal(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, process.cwd());
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, os.tmpdir());
		assert.equal((<IRawFileWorkspaceFolder>ws.folders[0]).name, 'currentworkingdirectory');
		assert.equal((<IRawFileWorkspaceFolder>ws.folders[1]).name, 'tempdir');
	});

	test('createUntitledWorkspace (folders as other resource URIs)', async () => {
		const folder1URI = URI.parse('myscheme://server/work/p/f1');
		const folder2URI = URI.parse('myscheme://server/work/o/f3');

		const workspace = await service.createUntitledWorkspace([{ uri: folder1URI }, { uri: folder2URI }], 'server');
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = (JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace);
		assert.equal(ws.folders.length, 2);
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[0]).uri, folder1URI.toString(true));
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[1]).uri, folder2URI.toString(true));
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
		assert.equal(ws.remoteAuthority, 'server');
	});

	test('createWorkspaceSync (folders)', () => {
		const workspace = createUntitledWorkspaceSync([process.cwd(), os.tmpdir()]);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace;
		assert.equal(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, process.cwd());
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, os.tmpdir());

		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
	});

	test('createWorkspaceSync (folders with names)', () => {
		const workspace = createUntitledWorkspaceSync([process.cwd(), os.tmpdir()], ['currentworkingdirectory', 'tempdir']);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace;
		assert.equal(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, process.cwd());
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, os.tmpdir());

		assert.equal((<IRawFileWorkspaceFolder>ws.folders[0]).name, 'currentworkingdirectory');
		assert.equal((<IRawFileWorkspaceFolder>ws.folders[1]).name, 'tempdir');
	});

	test('createUntitledWorkspaceSync (folders as other resource URIs)', () => {
		const folder1URI = URI.parse('myscheme://server/work/p/f1');
		const folder2URI = URI.parse('myscheme://server/work/o/f3');

		const workspace = service.createUntitledWorkspaceSync([{ uri: folder1URI }, { uri: folder2URI }]);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace;
		assert.equal(ws.folders.length, 2);
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[0]).uri, folder1URI.toString(true));
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[1]).uri, folder2URI.toString(true));

		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
	});

	test('resolveWorkspaceSync', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		assert.ok(service.resolveLocalWorkspaceSync(workspace.configPath));

		// make it a valid workspace path
		const newPath = path.join(path.dirname(workspace.configPath.fsPath), `workspace.${WORKSPACE_EXTENSION}`);
		fs.renameSync(workspace.configPath.fsPath, newPath);
		workspace.configPath = URI.file(newPath);

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assert.equal(2, resolved!.folders.length);
		assertEqualURI(resolved!.configPath, workspace.configPath);
		assert.ok(resolved!.id);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ something: 'something' })); // invalid workspace

		const resolvedInvalid = service.resolveLocalWorkspaceSync(workspace.configPath);
		assert.ok(!resolvedInvalid);
	});

	test('resolveWorkspaceSync (support relative paths)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ folders: [{ path: './ticino-playground/lib' }] }));

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'lib')));
	});

	test('resolveWorkspaceSync (support relative paths #2)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ folders: [{ path: './ticino-playground/lib/../other' }] }));

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'other')));
	});

	test('resolveWorkspaceSync (support relative paths #3)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ folders: [{ path: 'ticino-playground/lib' }] }));

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'lib')));
	});

	test('resolveWorkspaceSync (support invalid JSON via fault tolerant parsing)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		fs.writeFileSync(workspace.configPath.fsPath, '{ "folders": [ { "path": "./ticino-playground/lib" } , ] }'); // trailing comma

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'lib')));
	});

	test('rewriteWorkspaceFileForNewLocation', async () => {
		const folder1 = process.cwd();  // absolute path because outside of tmpDir
		const tmpDir = os.tmpdir();
		const tmpInsideDir = path.join(tmpDir, 'inside');

		const firstConfigPath = path.join(tmpDir, 'myworkspace0.code-workspace');
		createWorkspace(firstConfigPath, [folder1, 'inside', path.join('inside', 'somefolder')]);
		const origContent = fs.readFileSync(firstConfigPath).toString();

		let origConfigPath = URI.file(firstConfigPath);
		let workspaceConfigPath = URI.file(path.join(tmpDir, 'inside', 'myworkspace1.code-workspace'));
		let newContent = rewriteWorkspaceFileForNewLocation(origContent, origConfigPath, false, workspaceConfigPath);
		let ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.equal(ws.folders.length, 3);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1); // absolute path because outside of tmpdir
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, '.');
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, 'somefolder');

		origConfigPath = workspaceConfigPath;
		workspaceConfigPath = URI.file(path.join(tmpDir, 'myworkspace2.code-workspace'));
		newContent = rewriteWorkspaceFileForNewLocation(newContent, origConfigPath, false, workspaceConfigPath);
		ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.equal(ws.folders.length, 3);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, 'inside');
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, isWindows ? 'inside\\somefolder' : 'inside/somefolder');

		origConfigPath = workspaceConfigPath;
		workspaceConfigPath = URI.file(path.join(tmpDir, 'other', 'myworkspace2.code-workspace'));
		newContent = rewriteWorkspaceFileForNewLocation(newContent, origConfigPath, false, workspaceConfigPath);
		ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.equal(ws.folders.length, 3);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, isWindows ? '..\\inside' : '../inside');
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, isWindows ? '..\\inside\\somefolder' : '../inside/somefolder');

		origConfigPath = workspaceConfigPath;
		workspaceConfigPath = URI.parse('foo://foo/bar/myworkspace2.code-workspace');
		newContent = rewriteWorkspaceFileForNewLocation(newContent, origConfigPath, false, workspaceConfigPath);
		ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.equal(ws.folders.length, 3);
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[0]).uri, URI.file(folder1).toString(true));
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[1]).uri, URI.file(tmpInsideDir).toString(true));
		assert.equal((<IRawUriWorkspaceFolder>ws.folders[2]).uri, URI.file(path.join(tmpInsideDir, 'somefolder')).toString(true));

		fs.unlinkSync(firstConfigPath);
	});

	test('rewriteWorkspaceFileForNewLocation (preserves comments)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir(), path.join(os.tmpdir(), 'somefolder')]);
		const workspaceConfigPath = URI.file(path.join(os.tmpdir(), `myworkspace.${Date.now()}.${WORKSPACE_EXTENSION}`));

		let origContent = fs.readFileSync(workspace.configPath.fsPath).toString();
		origContent = `// this is a comment\n${origContent}`;

		let newContent = rewriteWorkspaceFileForNewLocation(origContent, workspace.configPath, false, workspaceConfigPath);
		assert.equal(0, newContent.indexOf('// this is a comment'));
		service.deleteUntitledWorkspaceSync(workspace);
	});

	test('rewriteWorkspaceFileForNewLocation (preserves forward slashes)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir(), path.join(os.tmpdir(), 'somefolder')]);
		const workspaceConfigPath = URI.file(path.join(os.tmpdir(), `myworkspace.${Date.now()}.${WORKSPACE_EXTENSION}`));

		let origContent = fs.readFileSync(workspace.configPath.fsPath).toString();
		origContent = origContent.replace(/[\\]/g, '/'); // convert backslash to slash

		const newContent = rewriteWorkspaceFileForNewLocation(origContent, workspace.configPath, false, workspaceConfigPath);
		const ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.ok(ws.folders.every(f => (<IRawFileWorkspaceFolder>f).path.indexOf('\\') < 0));
		service.deleteUntitledWorkspaceSync(workspace);
	});

	test.skip('rewriteWorkspaceFileForNewLocation (unc paths)', async () => {
		if (!isWindows) {
			return Promise.resolve();
		}

		const workspaceLocation = path.join(os.tmpdir(), 'wsloc');
		const folder1Location = 'x:\\foo';
		const folder2Location = '\\\\server\\share2\\some\\path';
		const folder3Location = path.join(os.tmpdir(), 'wsloc', 'inner', 'more');

		const workspace = await createUntitledWorkspace([folder1Location, folder2Location, folder3Location]);
		const workspaceConfigPath = URI.file(path.join(workspaceLocation, `myworkspace.${Date.now()}.${WORKSPACE_EXTENSION}`));
		let origContent = fs.readFileSync(workspace.configPath.fsPath).toString();
		const newContent = rewriteWorkspaceFileForNewLocation(origContent, workspace.configPath, false, workspaceConfigPath);
		const ws = (JSON.parse(newContent) as IStoredWorkspace);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1Location);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, folder2Location);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, 'inner\\more');

		service.deleteUntitledWorkspaceSync(workspace);
	});

	test('deleteUntitledWorkspaceSync (untitled)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		service.deleteUntitledWorkspaceSync(workspace);
		assert.ok(!fs.existsSync(workspace.configPath.fsPath));
	});

	test('deleteUntitledWorkspaceSync (saved)', async () => {
		const workspace = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		service.deleteUntitledWorkspaceSync(workspace);
	});

	test('getUntitledWorkspaceSync', async function () {
		this.retries(3);

		let untitled = service.getUntitledWorkspacesSync();
		assert.equal(untitled.length, 0);

		const untitledOne = await createUntitledWorkspace([process.cwd(), os.tmpdir()]);
		assert.ok(fs.existsSync(untitledOne.configPath.fsPath));

		untitled = service.getUntitledWorkspacesSync();
		assert.equal(1, untitled.length);
		assert.equal(untitledOne.id, untitled[0].workspace.id);

		const untitledTwo = await createUntitledWorkspace([os.tmpdir(), process.cwd()]);
		assert.ok(fs.existsSync(untitledTwo.configPath.fsPath));
		assert.ok(fs.existsSync(untitledOne.configPath.fsPath), `Unexpected workspaces count of 1 (expected 2): ${untitledOne.configPath.fsPath} does not exist anymore?`);
		const untitledHome = dirname(dirname(untitledTwo.configPath));
		const beforeGettingUntitledWorkspaces = fs.readdirSync(untitledHome.fsPath).map(name => fs.readFileSync(joinPath(untitledHome, name, 'workspace.json').fsPath, 'utf8'));
		untitled = service.getUntitledWorkspacesSync();
		assert.ok(fs.existsSync(untitledOne.configPath.fsPath), `Unexpected workspaces count of 1 (expected 2): ${untitledOne.configPath.fsPath} does not exist anymore?`);
		if (untitled.length === 1) {
			assert.fail(`Unexpected workspaces count of 1 (expected 2), all workspaces:\n ${fs.readdirSync(untitledHome.fsPath).map(name => fs.readFileSync(joinPath(untitledHome, name, 'workspace.json').fsPath, 'utf8'))}, before getUntitledWorkspacesSync: ${beforeGettingUntitledWorkspaces}`);
		}
		assert.equal(2, untitled.length);

		service.deleteUntitledWorkspaceSync(untitledOne);
		untitled = service.getUntitledWorkspacesSync();
		assert.equal(1, untitled.length);

		service.deleteUntitledWorkspaceSync(untitledTwo);
		untitled = service.getUntitledWorkspacesSync();
		assert.equal(0, untitled.length);
	});
});
