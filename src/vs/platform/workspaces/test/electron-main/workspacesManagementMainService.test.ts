/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as pfs from 'vs/base/node/pfs';
import { EnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { WorkspacesManagementMainService, IStoredWorkspace, getSingleFolderWorkspaceIdentifier, getWorkspaceIdentifier } from 'vs/platform/workspaces/electron-main/workspacesManagementMainService';
import { WORKSPACE_EXTENSION, IRawFileWorkspaceFolder, IWorkspaceFolderCreationData, IRawUriWorkspaceFolder, rewriteWorkspaceFileForNewLocation, IWorkspaceIdentifier, IStoredWorkspaceFolder } from 'vs/platform/workspaces/common/workspaces';
import { NullLogService } from 'vs/platform/log/common/log';
import { URI } from 'vs/base/common/uri';
import { flakySuite, getRandomTestPath } from 'vs/base/test/node/testUtils';
import { isWindows } from 'vs/base/common/platform';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogMainService';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { IBackupMainService, IWorkspaceBackupInfo } from 'vs/platform/backup/electron-main/backup';
import { IEmptyWindowBackupInfo } from 'vs/platform/backup/node/backup';
import product from 'vs/platform/product/common/product';
import { IProductService } from 'vs/platform/product/common/productService';

flakySuite('WorkspacesManagementMainService', () => {

	class TestDialogMainService implements IDialogMainService {

		declare readonly _serviceBrand: undefined;

		pickFileFolder(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> { throw new Error('Method not implemented.'); }
		pickFolder(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> { throw new Error('Method not implemented.'); }
		pickFile(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> { throw new Error('Method not implemented.'); }
		pickWorkspace(options: INativeOpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<string[] | undefined> { throw new Error('Method not implemented.'); }
		showMessageBox(options: Electron.MessageBoxOptions, window?: Electron.BrowserWindow | undefined): Promise<Electron.MessageBoxReturnValue> { throw new Error('Method not implemented.'); }
		showSaveDialog(options: Electron.SaveDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<Electron.SaveDialogReturnValue> { throw new Error('Method not implemented.'); }
		showOpenDialog(options: Electron.OpenDialogOptions, window?: Electron.BrowserWindow | undefined): Promise<Electron.OpenDialogReturnValue> { throw new Error('Method not implemented.'); }
	}

	class TestBackupMainService implements IBackupMainService {

		declare readonly _serviceBrand: undefined;

		isHotExitEnabled(): boolean { throw new Error('Method not implemented.'); }
		getWorkspaceBackups(): IWorkspaceBackupInfo[] { throw new Error('Method not implemented.'); }
		getFolderBackupPaths(): URI[] { throw new Error('Method not implemented.'); }
		getEmptyWindowBackupPaths(): IEmptyWindowBackupInfo[] { throw new Error('Method not implemented.'); }
		registerWorkspaceBackupSync(workspace: IWorkspaceBackupInfo, migrateFrom?: string | undefined): string { throw new Error('Method not implemented.'); }
		registerFolderBackupSync(folderUri: URI): string { throw new Error('Method not implemented.'); }
		registerEmptyWindowBackupSync(backupFolder?: string | undefined, remoteAuthority?: string | undefined): string { throw new Error('Method not implemented.'); }
		unregisterWorkspaceBackupSync(workspace: IWorkspaceIdentifier): void { throw new Error('Method not implemented.'); }
		unregisterFolderBackupSync(folderUri: URI): void { throw new Error('Method not implemented.'); }
		unregisterEmptyWindowBackupSync(backupFolder: string): void { throw new Error('Method not implemented.'); }
		async getDirtyWorkspaces(): Promise<(IWorkspaceIdentifier | URI)[]> { return []; }
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

	let testDir: string;
	let untitledWorkspacesHomePath: string;
	let environmentMainService: EnvironmentMainService;
	let service: WorkspacesManagementMainService;

	const cwd = process.cwd();
	const tmpDir = os.tmpdir();

	setup(async () => {
		testDir = getRandomTestPath(tmpDir, 'vsctests', 'workspacesmanagementmainservice');
		untitledWorkspacesHomePath = path.join(testDir, 'Workspaces');

		const productService: IProductService = { _serviceBrand: undefined, ...product };

		environmentMainService = new class TestEnvironmentService extends EnvironmentMainService {

			constructor() {
				super(parseArgs(process.argv, OPTIONS), productService);
			}

			override get untitledWorkspacesHome(): URI {
				return URI.file(untitledWorkspacesHomePath);
			}
		};

		service = new WorkspacesManagementMainService(environmentMainService, new NullLogService(), new TestBackupMainService(), new TestDialogMainService(), productService);

		return fs.promises.mkdir(untitledWorkspacesHomePath, { recursive: true });
	});

	teardown(() => {
		service.dispose();

		return pfs.rimraf(testDir);
	});

	function assertPathEquals(p1: string, p2: string): void {
		if (isWindows) {
			p1 = normalizeDriveLetter(p1);
			p2 = normalizeDriveLetter(p2);
		}

		assert.strictEqual(p1, p2);
	}

	function assertEqualURI(u1: URI, u2: URI): void {
		assert.strictEqual(u1.toString(), u2.toString());
	}

	test('createWorkspace (folders)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = (JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, cwd);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, tmpDir);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
	});

	test('createWorkspace (folders with name)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir], ['currentworkingdirectory', 'tempdir']);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = (JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, cwd);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, tmpDir);
		assert.strictEqual((<IRawFileWorkspaceFolder>ws.folders[0]).name, 'currentworkingdirectory');
		assert.strictEqual((<IRawFileWorkspaceFolder>ws.folders[1]).name, 'tempdir');
	});

	test('createUntitledWorkspace (folders as other resource URIs)', async () => {
		const folder1URI = URI.parse('myscheme://server/work/p/f1');
		const folder2URI = URI.parse('myscheme://server/work/o/f3');

		const workspace = await service.createUntitledWorkspace([{ uri: folder1URI }, { uri: folder2URI }], 'server');
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = (JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 2);
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[0]).uri, folder1URI.toString(true));
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[1]).uri, folder2URI.toString(true));
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
		assert.strictEqual(ws.remoteAuthority, 'server');
	});

	test('createWorkspaceSync (folders)', () => {
		const workspace = createUntitledWorkspaceSync([cwd, tmpDir]);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace;
		assert.strictEqual(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, cwd);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, tmpDir);

		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
	});

	test('createWorkspaceSync (folders with names)', () => {
		const workspace = createUntitledWorkspaceSync([cwd, tmpDir], ['currentworkingdirectory', 'tempdir']);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace;
		assert.strictEqual(ws.folders.length, 2);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, cwd);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, tmpDir);

		assert.strictEqual((<IRawFileWorkspaceFolder>ws.folders[0]).name, 'currentworkingdirectory');
		assert.strictEqual((<IRawFileWorkspaceFolder>ws.folders[1]).name, 'tempdir');
	});

	test('createUntitledWorkspaceSync (folders as other resource URIs)', () => {
		const folder1URI = URI.parse('myscheme://server/work/p/f1');
		const folder2URI = URI.parse('myscheme://server/work/o/f3');

		const workspace = service.createUntitledWorkspaceSync([{ uri: folder1URI }, { uri: folder2URI }]);
		assert.ok(workspace);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		assert.ok(service.isUntitledWorkspace(workspace));

		const ws = JSON.parse(fs.readFileSync(workspace.configPath.fsPath).toString()) as IStoredWorkspace;
		assert.strictEqual(ws.folders.length, 2);
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[0]).uri, folder1URI.toString(true));
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[1]).uri, folder2URI.toString(true));

		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[0]).name);
		assert.ok(!(<IRawFileWorkspaceFolder>ws.folders[1]).name);
	});

	test('resolveWorkspaceSync', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		assert.ok(service.resolveLocalWorkspaceSync(workspace.configPath));

		// make it a valid workspace path
		const newPath = path.join(path.dirname(workspace.configPath.fsPath), `workspace.${WORKSPACE_EXTENSION}`);
		fs.renameSync(workspace.configPath.fsPath, newPath);
		workspace.configPath = URI.file(newPath);

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assert.strictEqual(2, resolved!.folders.length);
		assertEqualURI(resolved!.configPath, workspace.configPath);
		assert.ok(resolved!.id);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ something: 'something' })); // invalid workspace

		const resolvedInvalid = service.resolveLocalWorkspaceSync(workspace.configPath);
		assert.ok(!resolvedInvalid);
	});

	test('resolveWorkspaceSync (support relative paths)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ folders: [{ path: './ticino-playground/lib' }] }));

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'lib')));
	});

	test('resolveWorkspaceSync (support relative paths #2)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ folders: [{ path: './ticino-playground/lib/../other' }] }));

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'other')));
	});

	test('resolveWorkspaceSync (support relative paths #3)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		fs.writeFileSync(workspace.configPath.fsPath, JSON.stringify({ folders: [{ path: 'ticino-playground/lib' }] }));

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'lib')));
	});

	test('resolveWorkspaceSync (support invalid JSON via fault tolerant parsing)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		fs.writeFileSync(workspace.configPath.fsPath, '{ "folders": [ { "path": "./ticino-playground/lib" } , ] }'); // trailing comma

		const resolved = service.resolveLocalWorkspaceSync(workspace.configPath);
		assertEqualURI(resolved!.folders[0].uri, URI.file(path.join(path.dirname(workspace.configPath.fsPath), 'ticino-playground', 'lib')));
	});

	test('rewriteWorkspaceFileForNewLocation', async () => {
		const folder1 = cwd;  // absolute path because outside of tmpDir
		const tmpInsideDir = path.join(tmpDir, 'inside');

		const firstConfigPath = path.join(tmpDir, 'myworkspace0.code-workspace');
		createWorkspace(firstConfigPath, [folder1, 'inside', path.join('inside', 'somefolder')]);
		const origContent = fs.readFileSync(firstConfigPath).toString();

		let origConfigPath = URI.file(firstConfigPath);
		let workspaceConfigPath = URI.file(path.join(tmpDir, 'inside', 'myworkspace1.code-workspace'));
		let newContent = rewriteWorkspaceFileForNewLocation(origContent, origConfigPath, false, workspaceConfigPath, extUriBiasedIgnorePathCase);
		let ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 3);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1); // absolute path because outside of tmpdir
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, '.');
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, 'somefolder');

		origConfigPath = workspaceConfigPath;
		workspaceConfigPath = URI.file(path.join(tmpDir, 'myworkspace2.code-workspace'));
		newContent = rewriteWorkspaceFileForNewLocation(newContent, origConfigPath, false, workspaceConfigPath, extUriBiasedIgnorePathCase);
		ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 3);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, 'inside');
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, isWindows ? 'inside\\somefolder' : 'inside/somefolder');

		origConfigPath = workspaceConfigPath;
		workspaceConfigPath = URI.file(path.join(tmpDir, 'other', 'myworkspace2.code-workspace'));
		newContent = rewriteWorkspaceFileForNewLocation(newContent, origConfigPath, false, workspaceConfigPath, extUriBiasedIgnorePathCase);
		ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 3);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, isWindows ? '..\\inside' : '../inside');
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, isWindows ? '..\\inside\\somefolder' : '../inside/somefolder');

		origConfigPath = workspaceConfigPath;
		workspaceConfigPath = URI.parse('foo://foo/bar/myworkspace2.code-workspace');
		newContent = rewriteWorkspaceFileForNewLocation(newContent, origConfigPath, false, workspaceConfigPath, extUriBiasedIgnorePathCase);
		ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.strictEqual(ws.folders.length, 3);
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[0]).uri, URI.file(folder1).toString(true));
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[1]).uri, URI.file(tmpInsideDir).toString(true));
		assert.strictEqual((<IRawUriWorkspaceFolder>ws.folders[2]).uri, URI.file(path.join(tmpInsideDir, 'somefolder')).toString(true));

		fs.unlinkSync(firstConfigPath);
	});

	test('rewriteWorkspaceFileForNewLocation (preserves comments)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir, path.join(tmpDir, 'somefolder')]);
		const workspaceConfigPath = URI.file(path.join(tmpDir, `myworkspace.${Date.now()}.${WORKSPACE_EXTENSION}`));

		let origContent = fs.readFileSync(workspace.configPath.fsPath).toString();
		origContent = `// this is a comment\n${origContent}`;

		let newContent = rewriteWorkspaceFileForNewLocation(origContent, workspace.configPath, false, workspaceConfigPath, extUriBiasedIgnorePathCase);
		assert.strictEqual(0, newContent.indexOf('// this is a comment'));
		service.deleteUntitledWorkspaceSync(workspace);
	});

	test('rewriteWorkspaceFileForNewLocation (preserves forward slashes)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir, path.join(tmpDir, 'somefolder')]);
		const workspaceConfigPath = URI.file(path.join(tmpDir, `myworkspace.${Date.now()}.${WORKSPACE_EXTENSION}`));

		let origContent = fs.readFileSync(workspace.configPath.fsPath).toString();
		origContent = origContent.replace(/[\\]/g, '/'); // convert backslash to slash

		const newContent = rewriteWorkspaceFileForNewLocation(origContent, workspace.configPath, false, workspaceConfigPath, extUriBiasedIgnorePathCase);
		const ws = (JSON.parse(newContent) as IStoredWorkspace);
		assert.ok(ws.folders.every(f => (<IRawFileWorkspaceFolder>f).path.indexOf('\\') < 0));
		service.deleteUntitledWorkspaceSync(workspace);
	});

	(!isWindows ? test.skip : test)('rewriteWorkspaceFileForNewLocation (unc paths)', async () => {
		const workspaceLocation = path.join(tmpDir, 'wsloc');
		const folder1Location = 'x:\\foo';
		const folder2Location = '\\\\server\\share2\\some\\path';
		const folder3Location = path.join(workspaceLocation, 'inner', 'more');

		const workspace = await createUntitledWorkspace([folder1Location, folder2Location, folder3Location]);
		const workspaceConfigPath = URI.file(path.join(workspaceLocation, `myworkspace.${Date.now()}.${WORKSPACE_EXTENSION}`));
		let origContent = fs.readFileSync(workspace.configPath.fsPath).toString();
		const newContent = rewriteWorkspaceFileForNewLocation(origContent, workspace.configPath, true, workspaceConfigPath, extUriBiasedIgnorePathCase);
		const ws = (JSON.parse(newContent) as IStoredWorkspace);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[0]).path, folder1Location);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[1]).path, folder2Location);
		assertPathEquals((<IRawFileWorkspaceFolder>ws.folders[2]).path, 'inner\\more');

		service.deleteUntitledWorkspaceSync(workspace);
	});

	test('deleteUntitledWorkspaceSync (untitled)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		assert.ok(fs.existsSync(workspace.configPath.fsPath));
		service.deleteUntitledWorkspaceSync(workspace);
		assert.ok(!fs.existsSync(workspace.configPath.fsPath));
	});

	test('deleteUntitledWorkspaceSync (saved)', async () => {
		const workspace = await createUntitledWorkspace([cwd, tmpDir]);
		service.deleteUntitledWorkspaceSync(workspace);
	});

	test('getUntitledWorkspaceSync', async function () {
		let untitled = service.getUntitledWorkspacesSync();
		assert.strictEqual(untitled.length, 0);

		const untitledOne = await createUntitledWorkspace([cwd, tmpDir]);
		assert.ok(fs.existsSync(untitledOne.configPath.fsPath));

		untitled = service.getUntitledWorkspacesSync();
		assert.strictEqual(1, untitled.length);
		assert.strictEqual(untitledOne.id, untitled[0].workspace.id);

		service.deleteUntitledWorkspaceSync(untitledOne);
		untitled = service.getUntitledWorkspacesSync();
		assert.strictEqual(0, untitled.length);
	});

	test('getSingleWorkspaceIdentifier', async function () {
		const nonLocalUri = URI.parse('myscheme://server/work/p/f1');
		const nonLocalUriId = getSingleFolderWorkspaceIdentifier(nonLocalUri);
		assert.ok(nonLocalUriId?.id);

		const localNonExistingUri = URI.file(path.join(testDir, 'f1'));
		const localNonExistingUriId = getSingleFolderWorkspaceIdentifier(localNonExistingUri);
		assert.ok(!localNonExistingUriId);

		fs.mkdirSync(path.join(testDir, 'f1'));

		const localExistingUri = URI.file(path.join(testDir, 'f1'));
		const localExistingUriId = getSingleFolderWorkspaceIdentifier(localExistingUri);
		assert.ok(localExistingUriId?.id);
	});

	test('workspace identifiers are stable', function () {

		// workspace identifier (local)
		assert.strictEqual(getWorkspaceIdentifier(URI.file('/hello/test')).id, isWindows  /* slash vs backslash */ ? '9f3efb614e2cd7924e4b8076e6c72233' : 'e36736311be12ff6d695feefe415b3e8');

		// single folder identifier (local)
		const fakeStat = {
			ino: 1611312115129,
			birthtimeMs: 1611312115129,
			birthtime: new Date(1611312115129)
		};
		assert.strictEqual(getSingleFolderWorkspaceIdentifier(URI.file('/hello/test'), fakeStat as fs.Stats)?.id, isWindows /* slash vs backslash */ ? '9a8441e897e5174fa388bc7ef8f7a710' : '1d726b3d516dc2a6d343abf4797eaaef');

		// workspace identifier (remote)
		assert.strictEqual(getWorkspaceIdentifier(URI.parse('vscode-remote:/hello/test')).id, '786de4f224d57691f218dc7f31ee2ee3');

		// single folder identifier (remote)
		assert.strictEqual(getSingleFolderWorkspaceIdentifier(URI.parse('vscode-remote:/hello/test'))?.id, '786de4f224d57691f218dc7f31ee2ee3');
	});
});
