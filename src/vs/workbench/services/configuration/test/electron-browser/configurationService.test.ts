/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'vs/base/common/path';
import * as os from 'os';
import { URI } from 'vs/base/common/uri';
import { Registry } from 'vs/platform/registry/common/platform';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import * as pfs from 'vs/base/node/pfs';
import * as uuid from 'vs/base/common/uuid';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ISingleFolderWorkspaceInitializationPayload, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ConfigurationEditingErrorCode } from 'vs/workbench/services/configuration/common/configurationEditingService';
import { IFileService } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { ConfigurationTarget, IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { workbenchInstantiationService, RemoteFileSystemProvider, TestProductService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestWorkbenchConfiguration, TestTextFileService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { JSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditingService';
import { createHash } from 'crypto';
import { Schemas } from 'vs/base/common/network';
import { originalFSPath, joinPath } from 'vs/base/common/resources';
import { isLinux, isMacintosh } from 'vs/base/common/platform';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import { RemoteAuthorityResolverService } from 'vs/platform/remote/electron-sandbox/remoteAuthorityResolverService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { ConfigurationCache } from 'vs/workbench/services/configuration/electron-browser/configurationCache';
import { ConfigurationCache as BrowserConfigurationCache } from 'vs/workbench/services/configuration/browser/configurationCache';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IConfigurationCache } from 'vs/workbench/services/configuration/common/configuration';
import { SignService } from 'vs/platform/sign/browser/signService';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { IKeybindingEditingService, KeybindingsEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { timeout } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import product from 'vs/platform/product/common/product';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { Event } from 'vs/base/common/event';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';

class TestWorkbenchEnvironmentService extends NativeWorkbenchEnvironmentService {

	constructor(private _appSettingsHome: URI) {
		super(TestWorkbenchConfiguration, TestProductService);
	}

	get appSettingsHome() { return this._appSettingsHome; }

}

function setUpFolderWorkspace(folderName: string): Promise<{ parentDir: string, folderDir: string }> {
	const id = uuid.generateUuid();
	const parentDir = path.join(os.tmpdir(), 'vsctests', id);
	return setUpFolder(folderName, parentDir).then(folderDir => ({ parentDir, folderDir }));
}

function setUpFolder(folderName: string, parentDir: string): Promise<string> {
	const folderDir = path.join(parentDir, folderName);
	const workspaceSettingsDir = path.join(folderDir, '.vscode');
	return Promise.resolve(pfs.mkdirp(workspaceSettingsDir, 493).then(() => folderDir));
}

function convertToWorkspacePayload(folder: URI): ISingleFolderWorkspaceInitializationPayload {
	return {
		id: createHash('md5').update(folder.fsPath).digest('hex'),
		folder
	} as ISingleFolderWorkspaceInitializationPayload;
}

function setUpWorkspace(folders: string[]): Promise<{ parentDir: string, configPath: URI }> {

	const id = uuid.generateUuid();
	const parentDir = path.join(os.tmpdir(), 'vsctests', id);

	return Promise.resolve(pfs.mkdirp(parentDir, 493)
		.then(() => {
			const configPath = path.join(parentDir, 'vsctests.code-workspace');
			const workspace = { folders: folders.map(path => ({ path })) };
			fs.writeFileSync(configPath, JSON.stringify(workspace, null, '\t'));

			return Promise.all(folders.map(folder => setUpFolder(folder, parentDir)))
				.then(() => ({ parentDir, configPath: URI.file(configPath) }));
		}));

}


suite('WorkspaceContextService - Folder', () => {

	let workspaceName = `testWorkspace${uuid.generateUuid()}`, parentResource: string, workspaceResource: string, workspaceContextService: IWorkspaceContextService;
	const disposables = new DisposableStore();

	setup(() => {
		return setUpFolderWorkspace(workspaceName)
			.then(({ parentDir, folderDir }) => {
				parentResource = parentDir;
				workspaceResource = folderDir;
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const fileService = disposables.add(new FileService(new NullLogService()));
				const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, new DiskFileSystemProvider(new NullLogService()), Schemas.userData, new NullLogService())));
				workspaceContextService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, new RemoteAgentService(environmentService, { _serviceBrand: undefined, ...product }, new RemoteAuthorityResolverService(), new SignService(undefined), new NullLogService()), new UriIdentityService(fileService), new NullLogService()));
				return (<WorkspaceService>workspaceContextService).initialize(convertToWorkspacePayload(URI.file(folderDir)));
			});
	});

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('getWorkspace()', () => {
		const actual = workspaceContextService.getWorkspace();

		assert.equal(actual.folders.length, 1);
		assert.equal(actual.folders[0].uri.fsPath, URI.file(workspaceResource).fsPath);
		assert.equal(actual.folders[0].name, workspaceName);
		assert.equal(actual.folders[0].index, 0);
		assert.ok(!actual.configuration);
	});

	test('getWorkbenchState()', () => {
		const actual = workspaceContextService.getWorkbenchState();

		assert.equal(actual, WorkbenchState.FOLDER);
	});

	test('getWorkspaceFolder()', () => {
		const actual = workspaceContextService.getWorkspaceFolder(URI.file(path.join(workspaceResource, 'a')));

		assert.equal(actual, workspaceContextService.getWorkspace().folders[0]);
	});

	test('isCurrentWorkspace() => true', () => {
		assert.ok(workspaceContextService.isCurrentWorkspace(URI.file(workspaceResource)));
	});

	test('isCurrentWorkspace() => false', () => {
		assert.ok(!workspaceContextService.isCurrentWorkspace(URI.file(workspaceResource + 'abc')));
	});

	test('workspace is complete', () => workspaceContextService.getCompleteWorkspace());
});

suite('WorkspaceContextService - Workspace', () => {

	let parentResource: string, testObject: WorkspaceService, instantiationService: TestInstantiationService;
	const disposables = new DisposableStore();

	setup(() => {
		return setUpWorkspace(['a', 'b'])
			.then(({ parentDir, configPath }) => {

				parentResource = parentDir;

				instantiationService = <TestInstantiationService>workbenchInstantiationService();
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const remoteAgentService = instantiationService.createInstance(RemoteAgentService);
				instantiationService.stub(IRemoteAgentService, remoteAgentService);
				const fileService = disposables.add(new FileService(new NullLogService()));
				const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
				const workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));

				instantiationService.stub(IWorkspaceContextService, workspaceService);
				instantiationService.stub(IConfigurationService, workspaceService);
				instantiationService.stub(IEnvironmentService, environmentService);

				return workspaceService.initialize(getWorkspaceIdentifier(configPath)).then(() => {
					workspaceService.acquireInstantiationService(instantiationService);
					testObject = workspaceService;
				});
			});
	});

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('workspace folders', () => {
		const actual = testObject.getWorkspace().folders;

		assert.equal(actual.length, 2);
		assert.equal(path.basename(actual[0].uri.fsPath), 'a');
		assert.equal(path.basename(actual[1].uri.fsPath), 'b');
	});

	test('getWorkbenchState()', () => {
		const actual = testObject.getWorkbenchState();

		assert.equal(actual, WorkbenchState.WORKSPACE);
	});


	test('workspace is complete', () => testObject.getCompleteWorkspace());

});

suite('WorkspaceContextService - Workspace Editing', () => {

	let parentResource: string, testObject: WorkspaceService, instantiationService: TestInstantiationService;
	const disposables = new DisposableStore();

	setup(() => {
		return setUpWorkspace(['a', 'b'])
			.then(({ parentDir, configPath }) => {

				parentResource = parentDir;

				instantiationService = <TestInstantiationService>workbenchInstantiationService();
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const remoteAgentService = instantiationService.createInstance(RemoteAgentService);
				instantiationService.stub(IRemoteAgentService, remoteAgentService);
				const fileService = disposables.add(new FileService(new NullLogService()));
				const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
				const workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));

				instantiationService.stub(IWorkspaceContextService, workspaceService);
				instantiationService.stub(IConfigurationService, workspaceService);
				instantiationService.stub(IEnvironmentService, environmentService);

				return workspaceService.initialize(getWorkspaceIdentifier(configPath)).then(() => {
					instantiationService.stub(IFileService, fileService);
					instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
					instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
					workspaceService.acquireInstantiationService(instantiationService);

					testObject = workspaceService;
				});
			});
	});

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('add folders', () => {
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		return testObject.addFolders([{ uri: URI.file(path.join(workspaceDir, 'd')) }, { uri: URI.file(path.join(workspaceDir, 'c')) }])
			.then(() => {
				const actual = testObject.getWorkspace().folders;

				assert.equal(actual.length, 4);
				assert.equal(path.basename(actual[0].uri.fsPath), 'a');
				assert.equal(path.basename(actual[1].uri.fsPath), 'b');
				assert.equal(path.basename(actual[2].uri.fsPath), 'd');
				assert.equal(path.basename(actual[3].uri.fsPath), 'c');
			});
	});

	test('add folders (at specific index)', () => {
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		return testObject.addFolders([{ uri: URI.file(path.join(workspaceDir, 'd')) }, { uri: URI.file(path.join(workspaceDir, 'c')) }], 0)
			.then(() => {
				const actual = testObject.getWorkspace().folders;

				assert.equal(actual.length, 4);
				assert.equal(path.basename(actual[0].uri.fsPath), 'd');
				assert.equal(path.basename(actual[1].uri.fsPath), 'c');
				assert.equal(path.basename(actual[2].uri.fsPath), 'a');
				assert.equal(path.basename(actual[3].uri.fsPath), 'b');
			});
	});

	test('add folders (at specific wrong index)', () => {
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		return testObject.addFolders([{ uri: URI.file(path.join(workspaceDir, 'd')) }, { uri: URI.file(path.join(workspaceDir, 'c')) }], 10)
			.then(() => {
				const actual = testObject.getWorkspace().folders;

				assert.equal(actual.length, 4);
				assert.equal(path.basename(actual[0].uri.fsPath), 'a');
				assert.equal(path.basename(actual[1].uri.fsPath), 'b');
				assert.equal(path.basename(actual[2].uri.fsPath), 'd');
				assert.equal(path.basename(actual[3].uri.fsPath), 'c');
			});
	});

	test('add folders (with name)', () => {
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		return testObject.addFolders([{ uri: URI.file(path.join(workspaceDir, 'd')), name: 'DDD' }, { uri: URI.file(path.join(workspaceDir, 'c')), name: 'CCC' }])
			.then(() => {
				const actual = testObject.getWorkspace().folders;

				assert.equal(actual.length, 4);
				assert.equal(path.basename(actual[0].uri.fsPath), 'a');
				assert.equal(path.basename(actual[1].uri.fsPath), 'b');
				assert.equal(path.basename(actual[2].uri.fsPath), 'd');
				assert.equal(path.basename(actual[3].uri.fsPath), 'c');
				assert.equal(actual[2].name, 'DDD');
				assert.equal(actual[3].name, 'CCC');
			});
	});

	test('add folders triggers change event', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		const addedFolders = [{ uri: URI.file(path.join(workspaceDir, 'd')) }, { uri: URI.file(path.join(workspaceDir, 'c')) }];
		return testObject.addFolders(addedFolders)
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added.map(r => r.uri.toString()), addedFolders.map(a => a.uri.toString()));
				assert.deepEqual(actual.removed, []);
				assert.deepEqual(actual.changed, []);
			});
	});

	test('remove folders', () => {
		return testObject.removeFolders([testObject.getWorkspace().folders[0].uri])
			.then(() => {
				const actual = testObject.getWorkspace().folders;
				assert.equal(actual.length, 1);
				assert.equal(path.basename(actual[0].uri.fsPath), 'b');
			});
	});

	test('remove folders triggers change event', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const removedFolder = testObject.getWorkspace().folders[0];
		return testObject.removeFolders([removedFolder.uri])
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added, []);
				assert.deepEqual(actual.removed.map(r => r.uri.toString()), [removedFolder.uri.toString()]);
				assert.deepEqual(actual.changed.map(c => c.uri.toString()), [testObject.getWorkspace().folders[0].uri.toString()]);
			});
	});

	test('remove folders and add them back by writing into the file', async done => {
		const folders = testObject.getWorkspace().folders;
		await testObject.removeFolders([folders[0].uri]);

		testObject.onDidChangeWorkspaceFolders(actual => {
			try {
				assert.deepEqual(actual.added.map(r => r.uri.toString()), [folders[0].uri.toString()]);
				done();
			} catch (error) {
				done(error);
			}
		});

		const workspace = { folders: [{ path: folders[0].uri.fsPath }, { path: folders[1].uri.fsPath }] };
		await instantiationService.get(ITextFileService).write(testObject.getWorkspace().configuration!, JSON.stringify(workspace, null, '\t'));
	});

	test('update folders (remove last and add to end)', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		const addedFolders = [{ uri: URI.file(path.join(workspaceDir, 'd')) }, { uri: URI.file(path.join(workspaceDir, 'c')) }];
		const removedFolders = [testObject.getWorkspace().folders[1]].map(f => f.uri);
		return testObject.updateFolders(addedFolders, removedFolders)
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added.map(r => r.uri.toString()), addedFolders.map(a => a.uri.toString()));
				assert.deepEqual(actual.removed.map(r => r.uri.toString()), removedFolders.map(a => a.toString()));
				assert.deepEqual(actual.changed, []);
			});
	});

	test('update folders (rename first via add and remove)', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		const addedFolders = [{ uri: URI.file(path.join(workspaceDir, 'a')), name: 'The Folder' }];
		const removedFolders = [testObject.getWorkspace().folders[0]].map(f => f.uri);
		return testObject.updateFolders(addedFolders, removedFolders, 0)
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added, []);
				assert.deepEqual(actual.removed, []);
				assert.deepEqual(actual.changed.map(r => r.uri.toString()), removedFolders.map(a => a.toString()));
			});
	});

	test('update folders (remove first and add to end)', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const workspaceDir = path.dirname(testObject.getWorkspace().folders[0].uri.fsPath);
		const addedFolders = [{ uri: URI.file(path.join(workspaceDir, 'd')) }, { uri: URI.file(path.join(workspaceDir, 'c')) }];
		const removedFolders = [testObject.getWorkspace().folders[0]].map(f => f.uri);
		const changedFolders = [testObject.getWorkspace().folders[1]].map(f => f.uri);
		return testObject.updateFolders(addedFolders, removedFolders)
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added.map(r => r.uri.toString()), addedFolders.map(a => a.uri.toString()));
				assert.deepEqual(actual.removed.map(r => r.uri.toString()), removedFolders.map(a => a.toString()));
				assert.deepEqual(actual.changed.map(r => r.uri.toString()), changedFolders.map(a => a.toString()));
			});
	});

	test('reorder folders trigger change event', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const workspace = { folders: [{ path: testObject.getWorkspace().folders[1].uri.fsPath }, { path: testObject.getWorkspace().folders[0].uri.fsPath }] };
		fs.writeFileSync(testObject.getWorkspace().configuration!.fsPath, JSON.stringify(workspace, null, '\t'));
		return testObject.reloadConfiguration()
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added, []);
				assert.deepEqual(actual.removed, []);
				assert.deepEqual(actual.changed.map(c => c.uri.toString()), testObject.getWorkspace().folders.map(f => f.uri.toString()).reverse());
			});
	});

	test('rename folders trigger change event', () => {
		const target = sinon.spy();
		testObject.onDidChangeWorkspaceFolders(target);
		const workspace = { folders: [{ path: testObject.getWorkspace().folders[0].uri.fsPath, name: '1' }, { path: testObject.getWorkspace().folders[1].uri.fsPath }] };
		fs.writeFileSync(testObject.getWorkspace().configuration!.fsPath, JSON.stringify(workspace, null, '\t'));
		return testObject.reloadConfiguration()
			.then(() => {
				assert.equal(target.callCount, 1, `Should be called only once but called ${target.callCount} times`);
				const actual = <IWorkspaceFoldersChangeEvent>target.args[0][0];
				assert.deepEqual(actual.added, []);
				assert.deepEqual(actual.removed, []);
				assert.deepEqual(actual.changed.map(c => c.uri.toString()), [testObject.getWorkspace().folders[0].uri.toString()]);
			});
	});

});

suite('WorkspaceService - Initialization', () => {

	let parentResource: string, workspaceConfigPath: URI, testObject: WorkspaceService, globalSettingsFile: string;
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const disposables = new DisposableStore();

	suiteSetup(() => {
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'initialization.testSetting1': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.RESOURCE
				},
				'initialization.testSetting2': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.RESOURCE
				}
			}
		});
	});

	setup(() => {
		return setUpWorkspace(['1', '2'])
			.then(({ parentDir, configPath }) => {

				parentResource = parentDir;
				workspaceConfigPath = configPath;
				globalSettingsFile = path.join(parentDir, 'settings.json');

				const instantiationService = <TestInstantiationService>workbenchInstantiationService();
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const remoteAgentService = instantiationService.createInstance(RemoteAgentService);
				instantiationService.stub(IRemoteAgentService, remoteAgentService);
				const fileService = disposables.add(new FileService(new NullLogService()));
				const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
				const workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
				instantiationService.stub(IWorkspaceContextService, workspaceService);
				instantiationService.stub(IConfigurationService, workspaceService);
				instantiationService.stub(IEnvironmentService, environmentService);

				return workspaceService.initialize({ id: '' }).then(() => {
					instantiationService.stub(IFileService, fileService);
					instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
					instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
					workspaceService.acquireInstantiationService(instantiationService);
					testObject = workspaceService;
				});
			});
	});

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('initialize a folder workspace from an empty workspace with no configuration changes', () => {

		fs.writeFileSync(globalSettingsFile, '{ "initialization.testSetting1": "userValue" }');

		return testObject.reloadConfiguration()
			.then(() => {
				const target = sinon.spy();
				testObject.onDidChangeWorkbenchState(target);
				testObject.onDidChangeWorkspaceName(target);
				testObject.onDidChangeWorkspaceFolders(target);
				testObject.onDidChangeConfiguration(target);

				return testObject.initialize(convertToWorkspacePayload(URI.file(path.join(parentResource, '1'))))
					.then(() => {
						assert.equal(testObject.getValue('initialization.testSetting1'), 'userValue');
						assert.equal(target.callCount, 3);
						assert.deepEqual(target.args[0], [WorkbenchState.FOLDER]);
						assert.deepEqual(target.args[1], [undefined]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '1')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).removed, []);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).changed, []);
					});

			});

	});

	test('initialize a folder workspace from an empty workspace with configuration changes', () => {

		fs.writeFileSync(globalSettingsFile, '{ "initialization.testSetting1": "userValue" }');

		return testObject.reloadConfiguration()
			.then(() => {
				const target = sinon.spy();
				testObject.onDidChangeWorkbenchState(target);
				testObject.onDidChangeWorkspaceName(target);
				testObject.onDidChangeWorkspaceFolders(target);
				testObject.onDidChangeConfiguration(target);

				fs.writeFileSync(path.join(parentResource, '1', '.vscode', 'settings.json'), '{ "initialization.testSetting1": "workspaceValue" }');

				return testObject.initialize(convertToWorkspacePayload(URI.file(path.join(parentResource, '1'))))
					.then(() => {
						assert.equal(testObject.getValue('initialization.testSetting1'), 'workspaceValue');
						assert.equal(target.callCount, 4);
						assert.deepEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1']);
						assert.deepEqual(target.args[1], [WorkbenchState.FOLDER]);
						assert.deepEqual(target.args[2], [undefined]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '1')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).removed, []);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).changed, []);
					});

			});

	});

	test('initialize a multi root workspace from an empty workspace with no configuration changes', () => {

		fs.writeFileSync(globalSettingsFile, '{ "initialization.testSetting1": "userValue" }');

		return testObject.reloadConfiguration()
			.then(() => {
				const target = sinon.spy();
				testObject.onDidChangeWorkbenchState(target);
				testObject.onDidChangeWorkspaceName(target);
				testObject.onDidChangeWorkspaceFolders(target);
				testObject.onDidChangeConfiguration(target);

				return testObject.initialize(getWorkspaceIdentifier(workspaceConfigPath))
					.then(() => {
						assert.equal(target.callCount, 3);
						assert.deepEqual(target.args[0], [WorkbenchState.WORKSPACE]);
						assert.deepEqual(target.args[1], [undefined]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '1')).fsPath, URI.file(path.join(parentResource, '2')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).removed, []);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).changed, []);
					});

			});

	});

	test('initialize a multi root workspace from an empty workspace with configuration changes', () => {

		fs.writeFileSync(globalSettingsFile, '{ "initialization.testSetting1": "userValue" }');

		return testObject.reloadConfiguration()
			.then(() => {
				const target = sinon.spy();
				testObject.onDidChangeWorkbenchState(target);
				testObject.onDidChangeWorkspaceName(target);
				testObject.onDidChangeWorkspaceFolders(target);
				testObject.onDidChangeConfiguration(target);

				fs.writeFileSync(path.join(parentResource, '1', '.vscode', 'settings.json'), '{ "initialization.testSetting1": "workspaceValue1" }');
				fs.writeFileSync(path.join(parentResource, '2', '.vscode', 'settings.json'), '{ "initialization.testSetting2": "workspaceValue2" }');

				return testObject.initialize(getWorkspaceIdentifier(workspaceConfigPath))
					.then(() => {
						assert.equal(target.callCount, 4);
						assert.deepEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1', 'initialization.testSetting2']);
						assert.deepEqual(target.args[1], [WorkbenchState.WORKSPACE]);
						assert.deepEqual(target.args[2], [undefined]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '1')).fsPath, URI.file(path.join(parentResource, '2')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).removed, []);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).changed, []);
					});

			});

	});

	test('initialize a folder workspace from a folder workspace with no configuration changes', () => {

		return testObject.initialize(convertToWorkspacePayload(URI.file(path.join(parentResource, '1'))))
			.then(() => {
				fs.writeFileSync(globalSettingsFile, '{ "initialization.testSetting1": "userValue" }');

				return testObject.reloadConfiguration()
					.then(() => {
						const target = sinon.spy();
						testObject.onDidChangeWorkbenchState(target);
						testObject.onDidChangeWorkspaceName(target);
						testObject.onDidChangeWorkspaceFolders(target);
						testObject.onDidChangeConfiguration(target);

						return testObject.initialize(convertToWorkspacePayload(URI.file(path.join(parentResource, '2'))))
							.then(() => {
								assert.equal(testObject.getValue('initialization.testSetting1'), 'userValue');
								assert.equal(target.callCount, 1);
								assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[0][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '2')).fsPath]);
								assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[0][0]).removed.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '1')).fsPath]);
								assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[0][0]).changed, []);
							});

					});
			});

	});

	test('initialize a folder workspace from a folder workspace with configuration changes', () => {

		return testObject.initialize(convertToWorkspacePayload(URI.file(path.join(parentResource, '1'))))
			.then(() => {

				const target = sinon.spy();
				testObject.onDidChangeWorkbenchState(target);
				testObject.onDidChangeWorkspaceName(target);
				testObject.onDidChangeWorkspaceFolders(target);
				testObject.onDidChangeConfiguration(target);

				fs.writeFileSync(path.join(parentResource, '2', '.vscode', 'settings.json'), '{ "initialization.testSetting1": "workspaceValue2" }');
				return testObject.initialize(convertToWorkspacePayload(URI.file(path.join(parentResource, '2'))))
					.then(() => {
						assert.equal(testObject.getValue('initialization.testSetting1'), 'workspaceValue2');
						assert.equal(target.callCount, 2);
						assert.deepEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1']);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[1][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '2')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[1][0]).removed.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '1')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[1][0]).changed, []);
					});
			});

	});

	test('initialize a multi folder workspace from a folder workspacce triggers change events in the right order', () => {
		const folderDir = path.join(parentResource, '1');
		return testObject.initialize(convertToWorkspacePayload(URI.file(folderDir)))
			.then(() => {

				const target = sinon.spy();

				testObject.onDidChangeWorkbenchState(target);
				testObject.onDidChangeWorkspaceName(target);
				testObject.onDidChangeWorkspaceFolders(target);
				testObject.onDidChangeConfiguration(target);

				fs.writeFileSync(path.join(parentResource, '1', '.vscode', 'settings.json'), '{ "initialization.testSetting1": "workspaceValue2" }');
				return testObject.initialize(getWorkspaceIdentifier(workspaceConfigPath))
					.then(() => {
						assert.equal(target.callCount, 4);
						assert.deepEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1']);
						assert.deepEqual(target.args[1], [WorkbenchState.WORKSPACE]);
						assert.deepEqual(target.args[2], [undefined]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).added.map(folder => folder.uri.fsPath), [URI.file(path.join(parentResource, '2')).fsPath]);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).removed, []);
						assert.deepEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).changed, []);
					});
			});
	});

});

suite('WorkspaceConfigurationService - Folder', () => {

	let workspaceName = `testWorkspace${uuid.generateUuid()}`, parentResource: string, workspaceDir: string, testObject: IConfigurationService, globalSettingsFile: string, globalTasksFile: string, workspaceService: WorkspaceService;
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	let fileService: IFileService;
	const disposables: DisposableStore = new DisposableStore();

	suiteSetup(() => {
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.folder.applicationSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				},
				'configurationService.folder.machineSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				},
				'configurationService.folder.machineOverridableSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE_OVERRIDABLE
				},
				'configurationService.folder.testSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.RESOURCE
				},
				'configurationService.folder.languageSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.LANGUAGE_OVERRIDABLE
				}
			}
		});
	});

	setup(() => {
		return setUpFolderWorkspace(workspaceName)
			.then(({ parentDir, folderDir }) => {

				parentResource = parentDir;
				workspaceDir = folderDir;
				globalSettingsFile = path.join(parentDir, 'settings.json');
				globalTasksFile = path.join(parentDir, 'tasks.json');

				const instantiationService = <TestInstantiationService>workbenchInstantiationService();
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const remoteAgentService = instantiationService.createInstance(RemoteAgentService);
				instantiationService.stub(IRemoteAgentService, remoteAgentService);
				fileService = disposables.add(new FileService(new NullLogService()));
				const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
				workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
				instantiationService.stub(IWorkspaceContextService, workspaceService);
				instantiationService.stub(IConfigurationService, workspaceService);
				instantiationService.stub(IEnvironmentService, environmentService);

				// Watch workspace configuration directory
				disposables.add(fileService.watch(joinPath(URI.file(workspaceDir), '.vscode')));

				return workspaceService.initialize(convertToWorkspacePayload(URI.file(folderDir))).then(() => {
					instantiationService.stub(IFileService, fileService);
					instantiationService.stub(IKeybindingEditingService, instantiationService.createInstance(KeybindingsEditingService));
					instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
					instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
					workspaceService.acquireInstantiationService(instantiationService);
					testObject = workspaceService;
				});
			});
	});

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('defaults', () => {
		assert.deepEqual(testObject.getValue('configurationService'), { 'folder': { 'applicationSetting': 'isSet', 'machineSetting': 'isSet', 'machineOverridableSetting': 'isSet', 'testSetting': 'isSet', 'languageSetting': 'isSet' } });
	});

	test('globals override defaults', () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.testSetting": "userValue" }');
		return testObject.reloadConfiguration()
			.then(() => assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'userValue'));
	});

	test('globals', () => {
		fs.writeFileSync(globalSettingsFile, '{ "testworkbench.editor.tabs": true }');
		return testObject.reloadConfiguration()
			.then(() => assert.equal(testObject.getValue('testworkbench.editor.tabs'), true));
	});

	test('workspace settings', () => {
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "testworkbench.editor.icons": true }');
		return testObject.reloadConfiguration()
			.then(() => assert.equal(testObject.getValue('testworkbench.editor.icons'), true));
	});

	test('workspace settings override user settings', () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.testSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.testSetting": "workspaceValue" }');
		return testObject.reloadConfiguration()
			.then(() => assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'workspaceValue'));
	});

	test('machine overridable settings override user Settings', () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineOverridableSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.machineOverridableSetting": "workspaceValue" }');
		return testObject.reloadConfiguration()
			.then(() => assert.equal(testObject.getValue('configurationService.folder.machineOverridableSetting'), 'workspaceValue'));
	});

	test('workspace settings override user settings after defaults are registered ', () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.newSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.newSetting": "workspaceValue" }');
		return testObject.reloadConfiguration()
			.then(() => {

				configurationRegistry.registerConfiguration({
					'id': '_test',
					'type': 'object',
					'properties': {
						'configurationService.folder.newSetting': {
							'type': 'string',
							'default': 'isSet'
						}
					}
				});

				assert.equal(testObject.getValue('configurationService.folder.newSetting'), 'workspaceValue');
			});
	});

	test('machine overridable settings override user settings after defaults are registered ', () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.newMachineOverridableSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.newMachineOverridableSetting": "workspaceValue" }');
		return testObject.reloadConfiguration()
			.then(() => {

				configurationRegistry.registerConfiguration({
					'id': '_test',
					'type': 'object',
					'properties': {
						'configurationService.folder.newMachineOverridableSetting': {
							'type': 'string',
							'default': 'isSet',
							scope: ConfigurationScope.MACHINE_OVERRIDABLE
						}
					}
				});

				assert.equal(testObject.getValue('configurationService.folder.newMachineOverridableSetting'), 'workspaceValue');
			});
	});

	test('application settings are not read from workspace', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.applicationSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.applicationSetting": "workspaceValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.applicationSetting'), 'userValue');
	});

	test('application settings are not read from workspace when workspace folder uri is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.applicationSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.applicationSetting": "workspaceValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.applicationSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.machineSetting": "workspaceValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.machineSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace when workspace folder uri is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineSetting": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.machineSetting": "workspaceValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.machineSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.applicationSetting-2": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.applicationSetting-2": "workspaceValue" }');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.applicationSetting-2'), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.folder.applicationSetting-2': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.folder.applicationSetting-2'), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.applicationSetting-2'), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered when workspace folder uri is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.applicationSetting-3": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.applicationSetting-3": "workspaceValue" }');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.applicationSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.folder.applicationSetting-3': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.folder.applicationSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.applicationSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('get machine scope settings are not loaded after defaults are registered', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineSetting-2": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.machineSetting-2": "workspaceValue" }');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.machineSetting-2'), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.folder.machineSetting-2': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.folder.machineSetting-2'), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.machineSetting-2'), 'userValue');
	});

	test('get machine scope settings are not loaded after defaults are registered when workspace folder uri is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineSetting-3": "userValue" }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.machineSetting-3": "workspaceValue" }');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.machineSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.folder.machineSetting-3': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.folder.machineSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.folder.machineSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('reload configuration emits events after global configuraiton changes', () => {
		fs.writeFileSync(globalSettingsFile, '{ "testworkbench.editor.tabs": true }');
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.reloadConfiguration().then(() => assert.ok(target.called));
	});

	test('reload configuration emits events after workspace configuraiton changes', () => {
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.testSetting": "workspaceValue" }');
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.reloadConfiguration().then(() => assert.ok(target.called));
	});

	test('reload configuration should not emit event if no changes', () => {
		fs.writeFileSync(globalSettingsFile, '{ "testworkbench.editor.tabs": true }');
		fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.testSetting": "workspaceValue" }');
		return testObject.reloadConfiguration()
			.then(() => {
				const target = sinon.spy();
				testObject.onDidChangeConfiguration(() => { target(); });
				return testObject.reloadConfiguration()
					.then(() => assert.ok(!target.called));
			});
	});

	test('inspect', () => {
		let actual = testObject.inspect('something.missing');
		assert.equal(actual.defaultValue, undefined);
		assert.equal(actual.userValue, undefined);
		assert.equal(actual.workspaceValue, undefined);
		assert.equal(actual.workspaceFolderValue, undefined);
		assert.equal(actual.value, undefined);

		actual = testObject.inspect('configurationService.folder.testSetting');
		assert.equal(actual.defaultValue, 'isSet');
		assert.equal(actual.userValue, undefined);
		assert.equal(actual.workspaceValue, undefined);
		assert.equal(actual.workspaceFolderValue, undefined);
		assert.equal(actual.value, 'isSet');

		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.testSetting": "userValue" }');
		return testObject.reloadConfiguration()
			.then(() => {
				actual = testObject.inspect('configurationService.folder.testSetting');
				assert.equal(actual.defaultValue, 'isSet');
				assert.equal(actual.userValue, 'userValue');
				assert.equal(actual.workspaceValue, undefined);
				assert.equal(actual.workspaceFolderValue, undefined);
				assert.equal(actual.value, 'userValue');

				fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.testSetting": "workspaceValue" }');

				return testObject.reloadConfiguration()
					.then(() => {
						actual = testObject.inspect('configurationService.folder.testSetting');
						assert.equal(actual.defaultValue, 'isSet');
						assert.equal(actual.userValue, 'userValue');
						assert.equal(actual.workspaceValue, 'workspaceValue');
						assert.equal(actual.workspaceFolderValue, undefined);
						assert.equal(actual.value, 'workspaceValue');
					});
			});
	});

	test('keys', () => {
		let actual = testObject.keys();
		assert.ok(actual.default.indexOf('configurationService.folder.testSetting') !== -1);
		assert.deepEqual(actual.user, []);
		assert.deepEqual(actual.workspace, []);
		assert.deepEqual(actual.workspaceFolder, []);

		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.testSetting": "userValue" }');
		return testObject.reloadConfiguration()
			.then(() => {
				actual = testObject.keys();
				assert.ok(actual.default.indexOf('configurationService.folder.testSetting') !== -1);
				assert.deepEqual(actual.user, ['configurationService.folder.testSetting']);
				assert.deepEqual(actual.workspace, []);
				assert.deepEqual(actual.workspaceFolder, []);

				fs.writeFileSync(path.join(workspaceDir, '.vscode', 'settings.json'), '{ "configurationService.folder.testSetting": "workspaceValue" }');

				return testObject.reloadConfiguration()
					.then(() => {
						actual = testObject.keys();
						assert.ok(actual.default.indexOf('configurationService.folder.testSetting') !== -1);
						assert.deepEqual(actual.user, ['configurationService.folder.testSetting']);
						assert.deepEqual(actual.workspace, ['configurationService.folder.testSetting']);
						assert.deepEqual(actual.workspaceFolder, []);
					});
			});
	});

	test('update user configuration', () => {
		return testObject.updateValue('configurationService.folder.testSetting', 'value', ConfigurationTarget.USER)
			.then(() => assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'value'));
	});

	test('update workspace configuration', () => {
		return testObject.updateValue('tasks.service.testSetting', 'value', ConfigurationTarget.WORKSPACE)
			.then(() => assert.equal(testObject.getValue('tasks.service.testSetting'), 'value'));
	});

	test('update resource configuration', () => {
		return testObject.updateValue('configurationService.folder.testSetting', 'value', { resource: workspaceService.getWorkspace().folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'value'));
	});

	test('update resource language configuration', () => {
		return testObject.updateValue('configurationService.folder.languageSetting', 'value', { resource: workspaceService.getWorkspace().folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.equal(testObject.getValue('configurationService.folder.languageSetting'), 'value'));
	});

	test('update application setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.folder.applicationSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.equal(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_APPLICATION));
	});

	test('update machine setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.folder.machineSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.equal(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_MACHINE));
	});

	test('update tasks configuration', () => {
		return testObject.updateValue('tasks', { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }, ConfigurationTarget.WORKSPACE)
			.then(() => assert.deepEqual(testObject.getValue('tasks'), { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }));
	});

	test('update user configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.folder.testSetting', 'value', ConfigurationTarget.USER)
			.then(() => assert.ok(target.called));
	});

	test('update workspace configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.folder.testSetting', 'value', ConfigurationTarget.WORKSPACE)
			.then(() => assert.ok(target.called));
	});

	test('update memory configuration', () => {
		return testObject.updateValue('configurationService.folder.testSetting', 'memoryValue', ConfigurationTarget.MEMORY)
			.then(() => assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'memoryValue'));
	});

	test('update memory configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.folder.testSetting', 'memoryValue', ConfigurationTarget.MEMORY)
			.then(() => assert.ok(target.called));
	});

	test('update task configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('tasks', { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }, ConfigurationTarget.WORKSPACE)
			.then(() => assert.ok(target.called));
	});

	test('no change event when there are no global tasks', async () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await timeout(5);
		assert.ok(target.notCalled);
	});

	test('change event when there are global tasks', () => {
		fs.writeFileSync(globalTasksFile, '{ "version": "1.0.0", "tasks": [{ "taskName": "myTask" }');
		return new Promise<void>((c) => testObject.onDidChangeConfiguration(() => c()));
	});

	test('creating workspace settings', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.testSetting": "userValue" }');
		await testObject.reloadConfiguration();
		const workspaceSettingsResource = URI.file(path.join(workspaceDir, '.vscode', 'settings.json'));
		await new Promise<void>(async (c) => {
			const disposable = testObject.onDidChangeConfiguration(e => {
				assert.ok(e.affectsConfiguration('configurationService.folder.testSetting'));
				assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'workspaceValue');
				disposable.dispose();
				c();
			});
			await fileService.writeFile(workspaceSettingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		});
	});

	test('deleting workspace settings', async () => {
		if (!isMacintosh) {
			return;
		}
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.testSetting": "userValue" }');
		const workspaceSettingsResource = URI.file(path.join(workspaceDir, '.vscode', 'settings.json'));
		await fileService.writeFile(workspaceSettingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		const e = await new Promise<IConfigurationChangeEvent>(async (c) => {
			Event.once(testObject.onDidChangeConfiguration)(c);
			await fileService.del(workspaceSettingsResource);
		});
		assert.ok(e.affectsConfiguration('configurationService.folder.testSetting'));
		assert.equal(testObject.getValue('configurationService.folder.testSetting'), 'userValue');
	});
});

suite('WorkspaceConfigurationService-Multiroot', () => {

	let parentResource: string, workspaceContextService: IWorkspaceContextService, jsonEditingServce: IJSONEditingService, testObject: IConfigurationService, globalSettingsFile: string;
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const disposables = new DisposableStore();

	suiteSetup(() => {
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.workspace.testSetting': {
					'type': 'string',
					'default': 'isSet'
				},
				'configurationService.workspace.applicationSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				},
				'configurationService.workspace.machineSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				},
				'configurationService.workspace.machineOverridableSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE_OVERRIDABLE
				},
				'configurationService.workspace.testResourceSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.RESOURCE
				},
				'configurationService.workspace.testLanguageSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.LANGUAGE_OVERRIDABLE
				}
			}
		});
	});

	setup(() => {
		return setUpWorkspace(['1', '2'])
			.then(({ parentDir, configPath }) => {

				parentResource = parentDir;
				globalSettingsFile = path.join(parentDir, 'settings.json');

				const instantiationService = <TestInstantiationService>workbenchInstantiationService();
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const remoteAgentService = instantiationService.createInstance(RemoteAgentService);
				instantiationService.stub(IRemoteAgentService, remoteAgentService);
				const fileService = disposables.add(new FileService(new NullLogService()));
				const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
				const workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));

				instantiationService.stub(IWorkspaceContextService, workspaceService);
				instantiationService.stub(IConfigurationService, workspaceService);
				instantiationService.stub(IWorkbenchEnvironmentService, environmentService);
				instantiationService.stub(INativeWorkbenchEnvironmentService, environmentService);

				return workspaceService.initialize(getWorkspaceIdentifier(configPath)).then(() => {
					instantiationService.stub(IFileService, fileService);
					instantiationService.stub(IKeybindingEditingService, instantiationService.createInstance(KeybindingsEditingService));
					instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
					instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
					workspaceService.acquireInstantiationService(instantiationService);

					workspaceContextService = workspaceService;
					jsonEditingServce = instantiationService.createInstance(JSONEditingService);
					testObject = workspaceService;
				});
			});
	});

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('application settings are not read from workspace', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.applicationSetting": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.applicationSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.applicationSetting'), 'userValue');
	});

	test('application settings are not read from workspace when folder is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.applicationSetting": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.applicationSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.applicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineSetting": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.machineSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.machineSetting'), 'userValue');
	});

	test('machine settings are not read from workspace when folder is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.folder.machineSetting": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.machineSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.folder.machineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.newSetting": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.newSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.newSetting'), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.workspace.newSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.workspace.newSetting'), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.newSetting'), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered when workspace folder is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.newSetting-2": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.newSetting-2': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.newSetting-2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.workspace.newSetting-2': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.workspace.newSetting-2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.newSetting-2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('workspace settings override user settings after defaults are registered for machine overridable settings ', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.newMachineOverridableSetting": "userValue" }');
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.newMachineOverridableSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.newMachineOverridableSetting'), 'workspaceValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.workspace.newMachineOverridableSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE_OVERRIDABLE
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.workspace.newMachineOverridableSetting'), 'workspaceValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.newMachineOverridableSetting'), 'workspaceValue');

	});

	test('application settings are not read from workspace folder', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.applicationSetting": "userValue" }');
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.applicationSetting": "workspaceFolderValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.workspace.applicationSetting'), 'userValue');
	});

	test('application settings are not read from workspace folder when workspace folder is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.applicationSetting": "userValue" }');
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.applicationSetting": "workspaceFolderValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.workspace.applicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace folder', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.machineSetting": "userValue" }');
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.machineSetting": "workspaceFolderValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.workspace.machineSetting'), 'userValue');
	});

	test('machine settings are not read from workspace folder when workspace folder is passed', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.machineSetting": "userValue" }');
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.machineSetting": "workspaceFolderValue" }');

		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.workspace.machineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('application settings are not read from workspace folder after defaults are registered', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.testNewApplicationSetting": "userValue" }');
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.testNewApplicationSetting": "workspaceFolderValue" }');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.testNewApplicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.workspace.testNewApplicationSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.workspace.testNewApplicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.testNewApplicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('application settings are not read from workspace folder after defaults are registered', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.testNewMachineSetting": "userValue" }');
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.testNewMachineSetting": "workspaceFolderValue" }');
		await testObject.reloadConfiguration();

		assert.equal(testObject.getValue('configurationService.workspace.testNewMachineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');

		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.workspace.testNewMachineSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				}
			}
		});

		assert.equal(testObject.getValue('configurationService.workspace.testNewMachineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.equal(testObject.getValue('configurationService.workspace.testNewMachineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('resource setting in folder is read after it is registered later', () => {
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.testNewResourceSetting2": "workspaceFolderValue" }');
		return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.testNewResourceSetting2': 'workspaceValue' } }], true)
			.then(() => testObject.reloadConfiguration())
			.then(() => {
				configurationRegistry.registerConfiguration({
					'id': '_test',
					'type': 'object',
					'properties': {
						'configurationService.workspace.testNewResourceSetting2': {
							'type': 'string',
							'default': 'isSet',
							scope: ConfigurationScope.RESOURCE
						}
					}
				});
				assert.equal(testObject.getValue('configurationService.workspace.testNewResourceSetting2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');
			});
	});

	test('resource language setting in folder is read after it is registered later', () => {
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.testNewResourceLanguageSetting2": "workspaceFolderValue" }');
		return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.testNewResourceLanguageSetting2': 'workspaceValue' } }], true)
			.then(() => testObject.reloadConfiguration())
			.then(() => {
				configurationRegistry.registerConfiguration({
					'id': '_test',
					'type': 'object',
					'properties': {
						'configurationService.workspace.testNewResourceLanguageSetting2': {
							'type': 'string',
							'default': 'isSet',
							scope: ConfigurationScope.LANGUAGE_OVERRIDABLE
						}
					}
				});
				assert.equal(testObject.getValue('configurationService.workspace.testNewResourceLanguageSetting2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');
			});
	});

	test('machine overridable setting in folder is read after it is registered later', () => {
		fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.testNewMachineOverridableSetting2": "workspaceFolderValue" }');
		return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.testNewMachineOverridableSetting2': 'workspaceValue' } }], true)
			.then(() => testObject.reloadConfiguration())
			.then(() => {
				configurationRegistry.registerConfiguration({
					'id': '_test',
					'type': 'object',
					'properties': {
						'configurationService.workspace.testNewMachineOverridableSetting2': {
							'type': 'string',
							'default': 'isSet',
							scope: ConfigurationScope.MACHINE_OVERRIDABLE
						}
					}
				});
				assert.equal(testObject.getValue('configurationService.workspace.testNewMachineOverridableSetting2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');
			});
	});

	test('inspect', () => {
		let actual = testObject.inspect('something.missing');
		assert.equal(actual.defaultValue, undefined);
		assert.equal(actual.userValue, undefined);
		assert.equal(actual.workspaceValue, undefined);
		assert.equal(actual.workspaceFolderValue, undefined);
		assert.equal(actual.value, undefined);

		actual = testObject.inspect('configurationService.workspace.testResourceSetting');
		assert.equal(actual.defaultValue, 'isSet');
		assert.equal(actual.userValue, undefined);
		assert.equal(actual.workspaceValue, undefined);
		assert.equal(actual.workspaceFolderValue, undefined);
		assert.equal(actual.value, 'isSet');

		fs.writeFileSync(globalSettingsFile, '{ "configurationService.workspace.testResourceSetting": "userValue" }');
		return testObject.reloadConfiguration()
			.then(() => {
				actual = testObject.inspect('configurationService.workspace.testResourceSetting');
				assert.equal(actual.defaultValue, 'isSet');
				assert.equal(actual.userValue, 'userValue');
				assert.equal(actual.workspaceValue, undefined);
				assert.equal(actual.workspaceFolderValue, undefined);
				assert.equal(actual.value, 'userValue');

				return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.testResourceSetting': 'workspaceValue' } }], true)
					.then(() => testObject.reloadConfiguration())
					.then(() => {
						actual = testObject.inspect('configurationService.workspace.testResourceSetting');
						assert.equal(actual.defaultValue, 'isSet');
						assert.equal(actual.userValue, 'userValue');
						assert.equal(actual.workspaceValue, 'workspaceValue');
						assert.equal(actual.workspaceFolderValue, undefined);
						assert.equal(actual.value, 'workspaceValue');

						fs.writeFileSync(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json').fsPath, '{ "configurationService.workspace.testResourceSetting": "workspaceFolderValue" }');

						return testObject.reloadConfiguration()
							.then(() => {
								actual = testObject.inspect('configurationService.workspace.testResourceSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri });
								assert.equal(actual.defaultValue, 'isSet');
								assert.equal(actual.userValue, 'userValue');
								assert.equal(actual.workspaceValue, 'workspaceValue');
								assert.equal(actual.workspaceFolderValue, 'workspaceFolderValue');
								assert.equal(actual.value, 'workspaceFolderValue');
							});
					});
			});
	});

	test('get launch configuration', () => {
		const expectedLaunchConfiguration = {
			'version': '0.1.0',
			'configurations': [
				{
					'type': 'node',
					'request': 'launch',
					'name': 'Gulp Build',
					'program': '${workspaceFolder}/node_modules/gulp/bin/gulp.js',
					'stopOnEntry': true,
					'args': [
						'watch-extension:json-client'
					],
					'cwd': '${workspaceFolder}'
				}
			]
		};
		return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['launch'], value: expectedLaunchConfiguration }], true)
			.then(() => testObject.reloadConfiguration())
			.then(() => {
				const actual = testObject.getValue('launch');
				assert.deepEqual(actual, expectedLaunchConfiguration);
			});
	});

	test('inspect launch configuration', () => {
		const expectedLaunchConfiguration = {
			'version': '0.1.0',
			'configurations': [
				{
					'type': 'node',
					'request': 'launch',
					'name': 'Gulp Build',
					'program': '${workspaceFolder}/node_modules/gulp/bin/gulp.js',
					'stopOnEntry': true,
					'args': [
						'watch-extension:json-client'
					],
					'cwd': '${workspaceFolder}'
				}
			]
		};
		return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['launch'], value: expectedLaunchConfiguration }], true)
			.then(() => testObject.reloadConfiguration())
			.then(() => {
				const actual = testObject.inspect('launch').workspaceValue;
				assert.deepEqual(actual, expectedLaunchConfiguration);
			});
	});


	test('get tasks configuration', () => {
		const expectedTasksConfiguration = {
			'version': '2.0.0',
			'tasks': [
				{
					'label': 'Run Dev',
					'type': 'shell',
					'command': './scripts/code.sh',
					'windows': {
						'command': '.\\scripts\\code.bat'
					},
					'problemMatcher': []
				}
			]
		};
		return jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['tasks'], value: expectedTasksConfiguration }], true)
			.then(() => testObject.reloadConfiguration())
			.then(() => {
				const actual = testObject.getValue('tasks');
				assert.deepEqual(actual, expectedTasksConfiguration);
			});
	});

	test('inspect tasks configuration', async () => {
		const expectedTasksConfiguration = {
			'version': '2.0.0',
			'tasks': [
				{
					'label': 'Run Dev',
					'type': 'shell',
					'command': './scripts/code.sh',
					'windows': {
						'command': '.\\scripts\\code.bat'
					},
					'problemMatcher': []
				}
			]
		};
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['tasks'], value: expectedTasksConfiguration }], true);
		await testObject.reloadConfiguration();
		const actual = testObject.inspect('tasks').workspaceValue;
		assert.deepEqual(actual, expectedTasksConfiguration);
	});

	test('update user configuration', () => {
		return testObject.updateValue('configurationService.workspace.testSetting', 'userValue', ConfigurationTarget.USER)
			.then(() => assert.equal(testObject.getValue('configurationService.workspace.testSetting'), 'userValue'));
	});

	test('update user configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.workspace.testSetting', 'userValue', ConfigurationTarget.USER)
			.then(() => assert.ok(target.called));
	});

	test('update workspace configuration', () => {
		return testObject.updateValue('configurationService.workspace.testSetting', 'workspaceValue', ConfigurationTarget.WORKSPACE)
			.then(() => assert.equal(testObject.getValue('configurationService.workspace.testSetting'), 'workspaceValue'));
	});

	test('update workspace configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.workspace.testSetting', 'workspaceValue', ConfigurationTarget.WORKSPACE)
			.then(() => assert.ok(target.called));
	});

	test('update application setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.workspace.applicationSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.equal(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_APPLICATION));
	});

	test('update machine setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.workspace.machineSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.equal(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_MACHINE));
	});

	test('update workspace folder configuration', () => {
		const workspace = workspaceContextService.getWorkspace();
		return testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.equal(testObject.getValue('configurationService.workspace.testResourceSetting', { resource: workspace.folders[0].uri }), 'workspaceFolderValue'));
	});

	test('update resource language configuration in workspace folder', () => {
		const workspace = workspaceContextService.getWorkspace();
		return testObject.updateValue('configurationService.workspace.testLanguageSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.equal(testObject.getValue('configurationService.workspace.testLanguageSetting', { resource: workspace.folders[0].uri }), 'workspaceFolderValue'));
	});

	test('update workspace folder configuration should trigger change event before promise is resolve', () => {
		const workspace = workspaceContextService.getWorkspace();
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.ok(target.called));
	});

	test('update workspace folder configuration second time should trigger change event before promise is resolve', () => {
		const workspace = workspaceContextService.getWorkspace();
		return testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => {
				const target = sinon.spy();
				testObject.onDidChangeConfiguration(target);
				return testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue2', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
					.then(() => assert.ok(target.called));
			});
	});

	test('update memory configuration', () => {
		return testObject.updateValue('configurationService.workspace.testSetting', 'memoryValue', ConfigurationTarget.MEMORY)
			.then(() => assert.equal(testObject.getValue('configurationService.workspace.testSetting'), 'memoryValue'));
	});

	test('update memory configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.workspace.testSetting', 'memoryValue', ConfigurationTarget.MEMORY)
			.then(() => assert.ok(target.called));
	});

	test('update tasks configuration in a folder', () => {
		const workspace = workspaceContextService.getWorkspace();
		return testObject.updateValue('tasks', { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }, { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.deepEqual(testObject.getValue('tasks', { resource: workspace.folders[0].uri }), { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }));
	});

	test('update launch configuration in a workspace', () => {
		const workspace = workspaceContextService.getWorkspace();
		return testObject.updateValue('launch', { 'version': '1.0.0', configurations: [{ 'name': 'myLaunch' }] }, { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.deepEqual(testObject.getValue('launch'), { 'version': '1.0.0', configurations: [{ 'name': 'myLaunch' }] }));
	});

	test('update tasks configuration in a workspace', () => {
		const workspace = workspaceContextService.getWorkspace();
		const tasks = { 'version': '2.0.0', tasks: [{ 'label': 'myTask' }] };
		return testObject.updateValue('tasks', tasks, { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.deepEqual(testObject.getValue('tasks'), tasks));
	});

	test('configuration of newly added folder is available on configuration change event', async () => {
		const workspaceService = <WorkspaceService>testObject;
		const uri = workspaceService.getWorkspace().folders[1].uri;
		await workspaceService.removeFolders([uri]);
		fs.writeFileSync(path.join(uri.fsPath, '.vscode', 'settings.json'), '{ "configurationService.workspace.testResourceSetting": "workspaceFolderValue" }');

		return new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(() => {
				try {
					assert.equal(testObject.getValue('configurationService.workspace.testResourceSetting', { resource: uri }), 'workspaceFolderValue');
					c();
				} catch (error) {
					e(error);
				}
			});
			workspaceService.addFolders([{ uri }]);
		});
	});
});

suite('WorkspaceConfigurationService - Remote Folder', () => {

	let workspaceName = `testWorkspace${uuid.generateUuid()}`, parentResource: string, workspaceDir: string, testObject: WorkspaceService, globalSettingsFile: string, remoteSettingsFile: string, remoteSettingsResource: URI, instantiationService: TestInstantiationService, resolveRemoteEnvironment: () => void;
	const remoteAuthority = 'configuraiton-tests';
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const disposables = new DisposableStore();
	let diskFileSystemProvider: DiskFileSystemProvider;

	suiteSetup(() => {
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.remote.applicationSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				},
				'configurationService.remote.machineSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				},
				'configurationService.remote.machineOverridableSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE_OVERRIDABLE
				},
				'configurationService.remote.testSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.RESOURCE
				}
			}
		});
	});

	setup(() => {
		return setUpFolderWorkspace(workspaceName)
			.then(({ parentDir, folderDir }) => {

				parentResource = parentDir;
				workspaceDir = folderDir;
				globalSettingsFile = path.join(parentDir, 'settings.json');
				remoteSettingsFile = path.join(parentDir, 'remote-settings.json');
				remoteSettingsResource = URI.file(remoteSettingsFile).with({ scheme: Schemas.vscodeRemote, authority: remoteAuthority });

				instantiationService = <TestInstantiationService>workbenchInstantiationService();
				const environmentService = new TestWorkbenchEnvironmentService(URI.file(parentDir));
				const remoteEnvironmentPromise = new Promise<Partial<IRemoteAgentEnvironment>>(c => resolveRemoteEnvironment = () => c({ settingsPath: remoteSettingsResource }));
				const remoteAgentService = instantiationService.stub(IRemoteAgentService, <Partial<IRemoteAgentService>>{ getEnvironment: () => remoteEnvironmentPromise });
				const fileService = disposables.add(new FileService(new NullLogService()));
				diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
				fileService.registerProvider(Schemas.file, diskFileSystemProvider);
				fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
				const configurationCache: IConfigurationCache = { read: () => Promise.resolve(''), write: () => Promise.resolve(), remove: () => Promise.resolve(), needsCaching: () => false };
				testObject = disposables.add(new WorkspaceService({ configurationCache, remoteAuthority }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
				instantiationService.stub(IWorkspaceContextService, testObject);
				instantiationService.stub(IConfigurationService, testObject);
				instantiationService.stub(IEnvironmentService, environmentService);
				instantiationService.stub(IFileService, fileService);
			});
	});

	async function initialize(): Promise<void> {
		await testObject.initialize(convertToWorkspacePayload(URI.file(workspaceDir)));
		instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
		instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
		testObject.acquireInstantiationService(instantiationService);
	}

	function registerRemoteFileSystemProvider(): void {
		instantiationService.get(IFileService).registerProvider(Schemas.vscodeRemote, new RemoteFileSystemProvider(diskFileSystemProvider, remoteAuthority));
	}

	function registerRemoteFileSystemProviderOnActivation(): void {
		const disposable = instantiationService.get(IFileService).onWillActivateFileSystemProvider(e => {
			if (e.scheme === Schemas.vscodeRemote) {
				disposable.dispose();
				e.join(Promise.resolve().then(() => registerRemoteFileSystemProvider()));
			}
		});
	}

	teardown(() => {
		disposables.clear();
		if (parentResource) {
			return pfs.rimraf(parentResource, pfs.RimRafMode.MOVE);
		}
		return undefined;
	});

	test('remote settings override globals', async () => {
		fs.writeFileSync(remoteSettingsFile, '{ "configurationService.remote.machineSetting": "remoteValue" }');
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
	});

	test('remote settings override globals after remote provider is registered on activation', async () => {
		fs.writeFileSync(remoteSettingsFile, '{ "configurationService.remote.machineSetting": "remoteValue" }');
		resolveRemoteEnvironment();
		registerRemoteFileSystemProviderOnActivation();
		await initialize();
		assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
	});

	test('remote settings override globals after remote environment is resolved', async () => {
		fs.writeFileSync(remoteSettingsFile, '{ "configurationService.remote.machineSetting": "remoteValue" }');
		registerRemoteFileSystemProvider();
		await initialize();
		const promise = new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(event => {
				try {
					assert.equal(event.source, ConfigurationTarget.USER);
					assert.deepEqual(event.affectedKeys, ['configurationService.remote.machineSetting']);
					assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
					c();
				} catch (error) {
					e(error);
				}
			});
		});
		resolveRemoteEnvironment();
		return promise;
	});

	test('remote settings override globals after remote provider is registered on activation and remote environment is resolved', async () => {
		fs.writeFileSync(remoteSettingsFile, '{ "configurationService.remote.machineSetting": "remoteValue" }');
		registerRemoteFileSystemProviderOnActivation();
		await initialize();
		const promise = new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(event => {
				try {
					assert.equal(event.source, ConfigurationTarget.USER);
					assert.deepEqual(event.affectedKeys, ['configurationService.remote.machineSetting']);
					assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
					c();
				} catch (error) {
					e(error);
				}
			});
		});
		resolveRemoteEnvironment();
		return promise;
	});

	test.skip('update remote settings', async () => {
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'isSet');
		const promise = new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(event => {
				try {
					assert.equal(event.source, ConfigurationTarget.USER);
					assert.deepEqual(event.affectedKeys, ['configurationService.remote.machineSetting']);
					assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
					c();
				} catch (error) {
					e(error);
				}
			});
		});
		await instantiationService.get(IFileService).writeFile(remoteSettingsResource, VSBuffer.fromString('{ "configurationService.remote.machineSetting": "remoteValue" }'));
		return promise;
	});

	test('machine settings in local user settings does not override defaults', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.remote.machineSetting": "globalValue" }');
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.equal(testObject.getValue('configurationService.remote.machineSetting'), 'isSet');
	});

	test('machine overridable settings in local user settings does not override defaults', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.remote.machineOverridableSetting": "globalValue" }');
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.equal(testObject.getValue('configurationService.remote.machineOverridableSetting'), 'isSet');
	});

	test('machine settings in local user settings does not override defaults after defalts are registered ', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.remote.newMachineSetting": "userValue" }');
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.remote.newMachineSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				}
			}
		});
		assert.equal(testObject.getValue('configurationService.remote.newMachineSetting'), 'isSet');
	});

	test('machine overridable settings in local user settings does not override defaults after defalts are registered ', async () => {
		fs.writeFileSync(globalSettingsFile, '{ "configurationService.remote.newMachineOverridableSetting": "userValue" }');
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.remote.newMachineOverridableSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE_OVERRIDABLE
				}
			}
		});
		assert.equal(testObject.getValue('configurationService.remote.newMachineOverridableSetting'), 'isSet');
	});

});

suite('ConfigurationService - Configuration Defaults', () => {

	const disposableStore: DisposableStore = new DisposableStore();

	suiteSetup(() => {
		Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationService.defaultOverridesSetting': {
					'type': 'string',
					'default': 'isSet',
				},
			}
		});
	});

	teardown(() => {
		disposableStore.clear();
	});

	test('when default value is not overriden', () => {
		const testObject = createConfiurationService({});
		assert.deepEqual(testObject.getValue('configurationService.defaultOverridesSetting'), 'isSet');
	});

	test('when default value is overriden', () => {
		const testObject = createConfiurationService({ 'configurationService.defaultOverridesSetting': 'overriddenValue' });
		assert.deepEqual(testObject.getValue('configurationService.defaultOverridesSetting'), 'overriddenValue');
	});

	function createConfiurationService(configurationDefaults: Record<string, any>): IConfigurationService {
		const remoteAgentService = (<TestInstantiationService>workbenchInstantiationService()).createInstance(RemoteAgentService);
		const environmentService = new BrowserWorkbenchEnvironmentService({ logsPath: URI.file(''), workspaceId: '', configurationDefaults }, TestProductService);
		const fileService = new FileService(new NullLogService());
		return disposableStore.add(new WorkspaceService({ configurationCache: new BrowserConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
	}

});

function getWorkspaceId(configPath: URI): string {
	let workspaceConfigPath = configPath.scheme === Schemas.file ? originalFSPath(configPath) : configPath.toString();
	if (!isLinux) {
		workspaceConfigPath = workspaceConfigPath.toLowerCase(); // sanitize for platform file system
	}

	return createHash('md5').update(workspaceConfigPath).digest('hex');
}

export function getWorkspaceIdentifier(configPath: URI): IWorkspaceIdentifier {
	return {
		configPath,
		id: getWorkspaceId(configPath)
	};
}
