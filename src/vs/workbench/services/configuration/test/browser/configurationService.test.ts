/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { URI } from 'vs/base/common/uri';
import { Registry } from 'vs/platform/registry/common/platform';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ConfigurationEditingErrorCode } from 'vs/workbench/services/configuration/common/configurationEditingService';
import { IFileService } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { ConfigurationTarget, IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { workbenchInstantiationService, RemoteFileSystemProvider, TestProductService, TestEnvironmentService, TestTextFileService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { JSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditingService';
import { Schemas } from 'vs/base/common/network';
import { joinPath, dirname, basename } from 'vs/base/common/resources';
import { isLinux, isMacintosh } from 'vs/base/common/platform';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IConfigurationCache } from 'vs/workbench/services/configuration/common/configuration';
import { SignService } from 'vs/platform/sign/browser/signService';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { IKeybindingEditingService, KeybindingsEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { timeout } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { ConfigurationCache as BrowserConfigurationCache } from 'vs/workbench/services/configuration/browser/configurationCache';
import { BrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { RemoteAgentService } from 'vs/workbench/services/remote/browser/remoteAgentServiceImpl';
import { RemoteAuthorityResolverService } from 'vs/platform/remote/browser/remoteAuthorityResolverService';
import { hash } from 'vs/base/common/hash';

function convertToWorkspacePayload(folder: URI): ISingleFolderWorkspaceIdentifier {
	return {
		id: hash(folder.toString()).toString(16),
		uri: folder
	};
}

class ConfigurationCache extends BrowserConfigurationCache {
	override needsCaching() { return false; }
}

const ROOT = URI.file('tests').with({ scheme: 'vscode-tests' });

suite('WorkspaceContextService - Folder', () => {

	let folderName = 'Folder A', folder: URI, testObject: WorkspaceService;
	const disposables = new DisposableStore();

	setup(async () => {
		const logService = new NullLogService();
		const fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		folder = joinPath(ROOT, folderName);
		await fileService.createFolder(folder);

		const environmentService = TestEnvironmentService;
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		testObject = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, new RemoteAgentService(null, environmentService, TestProductService, new RemoteAuthorityResolverService(undefined, undefined), new SignService(undefined), new NullLogService()), new UriIdentityService(fileService), new NullLogService()));
		await (<WorkspaceService>testObject).initialize(convertToWorkspacePayload(folder));
	});

	teardown(() => disposables.clear());

	test('getWorkspace()', () => {
		const actual = testObject.getWorkspace();

		assert.strictEqual(actual.folders.length, 1);
		assert.strictEqual(actual.folders[0].uri.path, folder.path);
		assert.strictEqual(actual.folders[0].name, folderName);
		assert.strictEqual(actual.folders[0].index, 0);
		assert.ok(!actual.configuration);
	});

	test('getWorkbenchState()', () => {
		const actual = testObject.getWorkbenchState();

		assert.strictEqual(actual, WorkbenchState.FOLDER);
	});

	test('getWorkspaceFolder()', () => {
		const actual = testObject.getWorkspaceFolder(joinPath(folder, 'a'));

		assert.strictEqual(actual, testObject.getWorkspace().folders[0]);
	});

	test('isCurrentWorkspace() => true', () => {
		assert.ok(testObject.isCurrentWorkspace(folder));
	});

	test('isCurrentWorkspace() => false', () => {
		assert.ok(!testObject.isCurrentWorkspace(joinPath(dirname(folder), 'abc')));
	});

	test('workspace is complete', () => testObject.getCompleteWorkspace());
});

suite('WorkspaceContextService - Workspace', () => {

	let testObject: WorkspaceService;
	const disposables = new DisposableStore();

	setup(async () => {
		const logService = new NullLogService();
		const fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		const appSettingsHome = joinPath(ROOT, 'user');
		const folderA = joinPath(ROOT, 'a');
		const folderB = joinPath(ROOT, 'b');
		const configResource = joinPath(ROOT, 'vsctests.code-workspace');
		const workspace = { folders: [{ path: folderA.path }, { path: folderB.path }] };

		await fileService.createFolder(appSettingsHome);
		await fileService.createFolder(folderA);
		await fileService.createFolder(folderB);
		await fileService.writeFile(configResource, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));

		const instantiationService = <TestInstantiationService>workbenchInstantiationService();
		const environmentService = TestEnvironmentService;
		const remoteAgentService = disposables.add(instantiationService.createInstance(RemoteAgentService, null));
		instantiationService.stub(IRemoteAgentService, remoteAgentService);
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		testObject = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));

		instantiationService.stub(IWorkspaceContextService, testObject);
		instantiationService.stub(IConfigurationService, testObject);
		instantiationService.stub(IEnvironmentService, environmentService);

		await testObject.initialize(getWorkspaceIdentifier(configResource));
		testObject.acquireInstantiationService(instantiationService);
	});

	teardown(() => disposables.clear());

	test('workspace folders', () => {
		const actual = testObject.getWorkspace().folders;

		assert.strictEqual(actual.length, 2);
		assert.strictEqual(basename(actual[0].uri), 'a');
		assert.strictEqual(basename(actual[1].uri), 'b');
	});

	test('getWorkbenchState()', () => {
		const actual = testObject.getWorkbenchState();

		assert.strictEqual(actual, WorkbenchState.WORKSPACE);
	});


	test('workspace is complete', () => testObject.getCompleteWorkspace());

});

suite('WorkspaceContextService - Workspace Editing', () => {

	let testObject: WorkspaceService, fileService: IFileService;
	const disposables = new DisposableStore();

	setup(async () => {
		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		const appSettingsHome = joinPath(ROOT, 'user');
		const folderA = joinPath(ROOT, 'a');
		const folderB = joinPath(ROOT, 'b');
		const configResource = joinPath(ROOT, 'vsctests.code-workspace');
		const workspace = { folders: [{ path: folderA.path }, { path: folderB.path }] };

		await fileService.createFolder(appSettingsHome);
		await fileService.createFolder(folderA);
		await fileService.createFolder(folderB);
		await fileService.writeFile(configResource, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));

		const instantiationService = <TestInstantiationService>workbenchInstantiationService();
		const environmentService = TestEnvironmentService;
		const remoteAgentService = instantiationService.createInstance(RemoteAgentService, null);
		instantiationService.stub(IRemoteAgentService, remoteAgentService);
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		testObject = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));

		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IWorkspaceContextService, testObject);
		instantiationService.stub(IConfigurationService, testObject);
		instantiationService.stub(IEnvironmentService, environmentService);

		await testObject.initialize(getWorkspaceIdentifier(configResource));
		instantiationService.stub(ITextFileService, disposables.add(instantiationService.createInstance(TestTextFileService)));
		instantiationService.stub(ITextModelService, disposables.add(instantiationService.createInstance(TextModelResolverService)));
		testObject.acquireInstantiationService(instantiationService);
	});

	teardown(() => disposables.clear());

	test('add folders', async () => {
		await testObject.addFolders([{ uri: joinPath(ROOT, 'd') }, { uri: joinPath(ROOT, 'c') }]);
		const actual = testObject.getWorkspace().folders;

		assert.strictEqual(actual.length, 4);
		assert.strictEqual(basename(actual[0].uri), 'a');
		assert.strictEqual(basename(actual[1].uri), 'b');
		assert.strictEqual(basename(actual[2].uri), 'd');
		assert.strictEqual(basename(actual[3].uri), 'c');
	});

	test('add folders (at specific index)', async () => {
		await testObject.addFolders([{ uri: joinPath(ROOT, 'd') }, { uri: joinPath(ROOT, 'c') }], 0);
		const actual = testObject.getWorkspace().folders;

		assert.strictEqual(actual.length, 4);
		assert.strictEqual(basename(actual[0].uri), 'd');
		assert.strictEqual(basename(actual[1].uri), 'c');
		assert.strictEqual(basename(actual[2].uri), 'a');
		assert.strictEqual(basename(actual[3].uri), 'b');
	});

	test('add folders (at specific wrong index)', async () => {
		await testObject.addFolders([{ uri: joinPath(ROOT, 'd') }, { uri: joinPath(ROOT, 'c') }], 10);
		const actual = testObject.getWorkspace().folders;

		assert.strictEqual(actual.length, 4);
		assert.strictEqual(basename(actual[0].uri), 'a');
		assert.strictEqual(basename(actual[1].uri), 'b');
		assert.strictEqual(basename(actual[2].uri), 'd');
		assert.strictEqual(basename(actual[3].uri), 'c');
	});

	test('add folders (with name)', async () => {
		await testObject.addFolders([{ uri: joinPath(ROOT, 'd'), name: 'DDD' }, { uri: joinPath(ROOT, 'c'), name: 'CCC' }]);
		const actual = testObject.getWorkspace().folders;

		assert.strictEqual(actual.length, 4);
		assert.strictEqual(basename(actual[0].uri), 'a');
		assert.strictEqual(basename(actual[1].uri), 'b');
		assert.strictEqual(basename(actual[2].uri), 'd');
		assert.strictEqual(basename(actual[3].uri), 'c');
		assert.strictEqual(actual[2].name, 'DDD');
		assert.strictEqual(actual[3].name, 'CCC');
	});

	test('add folders triggers change event', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);

		const addedFolders = [{ uri: joinPath(ROOT, 'd') }, { uri: joinPath(ROOT, 'c') }];
		await testObject.addFolders(addedFolders);

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added.map(r => r.uri.toString()), addedFolders.map(a => a.uri.toString()));
		assert.deepStrictEqual(actual_1.removed, []);
		assert.deepStrictEqual(actual_1.changed, []);
	});

	test('remove folders', async () => {
		await testObject.removeFolders([testObject.getWorkspace().folders[0].uri]);
		const actual = testObject.getWorkspace().folders;

		assert.strictEqual(actual.length, 1);
		assert.strictEqual(basename(actual[0].uri), 'b');
	});

	test('remove folders triggers change event', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		const removedFolder = testObject.getWorkspace().folders[0];
		await testObject.removeFolders([removedFolder.uri]);

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added, []);
		assert.deepStrictEqual(actual_1.removed.map(r => r.uri.toString()), [removedFolder.uri.toString()]);
		assert.deepStrictEqual(actual_1.changed.map(c => c.uri.toString()), [testObject.getWorkspace().folders[0].uri.toString()]);
	});

	test('remove folders and add them back by writing into the file', async () => {
		const folders = testObject.getWorkspace().folders;
		await testObject.removeFolders([folders[0].uri]);

		const promise = new Promise<void>((resolve, reject) => {
			testObject.onDidChangeWorkspaceFolders(actual => {
				try {
					assert.deepStrictEqual(actual.added.map(r => r.uri.toString()), [folders[0].uri.toString()]);
					resolve();
				} catch (error) {
					reject(error);
				}
			});
		});

		const workspace = { folders: [{ path: folders[0].uri.path }, { path: folders[1].uri.path }] };
		await fileService.writeFile(testObject.getWorkspace().configuration!, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));
		await promise;
	});

	test('update folders (remove last and add to end)', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		const addedFolders = [{ uri: joinPath(ROOT, 'd') }, { uri: joinPath(ROOT, 'c') }];
		const removedFolders = [testObject.getWorkspace().folders[1]].map(f => f.uri);
		await testObject.updateFolders(addedFolders, removedFolders);

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added.map(r => r.uri.toString()), addedFolders.map(a => a.uri.toString()));
		assert.deepStrictEqual(actual_1.removed.map(r_1 => r_1.uri.toString()), removedFolders.map(a_1 => a_1.toString()));
		assert.deepStrictEqual(actual_1.changed, []);
	});

	test('update folders (rename first via add and remove)', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		const addedFolders = [{ uri: joinPath(ROOT, 'a'), name: 'The Folder' }];
		const removedFolders = [testObject.getWorkspace().folders[0]].map(f => f.uri);
		await testObject.updateFolders(addedFolders, removedFolders, 0);

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added, []);
		assert.deepStrictEqual(actual_1.removed, []);
		assert.deepStrictEqual(actual_1.changed.map(r => r.uri.toString()), removedFolders.map(a => a.toString()));
	});

	test('update folders (remove first and add to end)', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		const addedFolders = [{ uri: joinPath(ROOT, 'd') }, { uri: joinPath(ROOT, 'c') }];
		const removedFolders = [testObject.getWorkspace().folders[0]].map(f => f.uri);
		const changedFolders = [testObject.getWorkspace().folders[1]].map(f => f.uri);
		await testObject.updateFolders(addedFolders, removedFolders);

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added.map(r => r.uri.toString()), addedFolders.map(a => a.uri.toString()));
		assert.deepStrictEqual(actual_1.removed.map(r_1 => r_1.uri.toString()), removedFolders.map(a_1 => a_1.toString()));
		assert.deepStrictEqual(actual_1.changed.map(r_2 => r_2.uri.toString()), changedFolders.map(a_2 => a_2.toString()));
	});

	test('reorder folders trigger change event', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		const workspace = { folders: [{ path: testObject.getWorkspace().folders[1].uri.path }, { path: testObject.getWorkspace().folders[0].uri.path }] };
		await fileService.writeFile(testObject.getWorkspace().configuration!, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));
		await testObject.reloadConfiguration();

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added, []);
		assert.deepStrictEqual(actual_1.removed, []);
		assert.deepStrictEqual(actual_1.changed.map(c => c.uri.toString()), testObject.getWorkspace().folders.map(f => f.uri.toString()).reverse());
	});

	test('rename folders trigger change event', async () => {
		const target = sinon.spy();
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		const workspace = { folders: [{ path: testObject.getWorkspace().folders[0].uri.path, name: '1' }, { path: testObject.getWorkspace().folders[1].uri.path }] };
		fileService.writeFile(testObject.getWorkspace().configuration!, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));
		await testObject.reloadConfiguration();

		assert.strictEqual(target.callCount, 2, `Should be called only once but called ${target.callCount} times`);
		const actual_1 = (<IWorkspaceFoldersChangeEvent>target.args[1][0]);
		assert.deepStrictEqual(actual_1.added, []);
		assert.deepStrictEqual(actual_1.removed, []);
		assert.deepStrictEqual(actual_1.changed.map(c => c.uri.toString()), [testObject.getWorkspace().folders[0].uri.toString()]);
	});

});

suite('WorkspaceService - Initialization', () => {

	let configResource: URI, testObject: WorkspaceService, fileService: IFileService, environmentService: BrowserWorkbenchEnvironmentService;
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

	setup(async () => {
		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		const appSettingsHome = joinPath(ROOT, 'user');
		const folderA = joinPath(ROOT, 'a');
		const folderB = joinPath(ROOT, 'b');
		configResource = joinPath(ROOT, 'vsctests.code-workspace');
		const workspace = { folders: [{ path: folderA.path }, { path: folderB.path }] };

		await fileService.createFolder(appSettingsHome);
		await fileService.createFolder(folderA);
		await fileService.createFolder(folderB);
		await fileService.writeFile(configResource, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));

		const instantiationService = <TestInstantiationService>workbenchInstantiationService();
		environmentService = TestEnvironmentService;
		const remoteAgentService = instantiationService.createInstance(RemoteAgentService, null);
		instantiationService.stub(IRemoteAgentService, remoteAgentService);
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		testObject = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IWorkspaceContextService, testObject);
		instantiationService.stub(IConfigurationService, testObject);
		instantiationService.stub(IEnvironmentService, environmentService);

		await testObject.initialize({ id: '' });
		instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
		instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
		testObject.acquireInstantiationService(instantiationService);
	});

	teardown(() => disposables.clear());

	(isMacintosh ? test.skip : test)('initialize a folder workspace from an empty workspace with no configuration changes', async () => {

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "initialization.testSetting1": "userValue" }'));

		await testObject.reloadConfiguration();
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		const folder = joinPath(ROOT, 'a');
		await testObject.initialize(convertToWorkspacePayload(folder));

		assert.strictEqual(testObject.getValue('initialization.testSetting1'), 'userValue');
		assert.strictEqual(target.callCount, 4);
		assert.deepStrictEqual(target.args[0], [WorkbenchState.FOLDER]);
		assert.deepStrictEqual(target.args[1], [undefined]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).added.map(f => f.uri.toString()), [folder.toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).removed, []);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).changed, []);

	});

	(isMacintosh ? test.skip : test)('initialize a folder workspace from an empty workspace with configuration changes', async () => {

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "initialization.testSetting1": "userValue" }'));

		await testObject.reloadConfiguration();
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		const folder = joinPath(ROOT, 'a');
		await fileService.writeFile(joinPath(folder, '.vscode', 'settings.json'), VSBuffer.fromString('{ "initialization.testSetting1": "workspaceValue" }'));
		await testObject.initialize(convertToWorkspacePayload(folder));

		assert.strictEqual(testObject.getValue('initialization.testSetting1'), 'workspaceValue');
		assert.strictEqual(target.callCount, 5);
		assert.deepStrictEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1']);
		assert.deepStrictEqual(target.args[1], [WorkbenchState.FOLDER]);
		assert.deepStrictEqual(target.args[2], [undefined]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).added.map(f => f.uri.toString()), [folder.toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).removed, []);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).changed, []);

	});

	(isMacintosh ? test.skip : test)('initialize a multi root workspace from an empty workspace with no configuration changes', async () => {

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "initialization.testSetting1": "userValue" }'));

		await testObject.reloadConfiguration();
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		await testObject.initialize(getWorkspaceIdentifier(configResource));

		assert.strictEqual(target.callCount, 4);
		assert.deepStrictEqual(target.args[0], [WorkbenchState.WORKSPACE]);
		assert.deepStrictEqual(target.args[1], [undefined]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).added.map(folder => folder.uri.toString()), [joinPath(ROOT, 'a').toString(), joinPath(ROOT, 'b').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).removed, []);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[3][0]).changed, []);

	});

	(isMacintosh ? test.skip : test)('initialize a multi root workspace from an empty workspace with configuration changes', async () => {

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "initialization.testSetting1": "userValue" }'));

		await testObject.reloadConfiguration();
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		await fileService.writeFile(joinPath(ROOT, 'a', '.vscode', 'settings.json'), VSBuffer.fromString('{ "initialization.testSetting1": "workspaceValue1" }'));
		await fileService.writeFile(joinPath(ROOT, 'b', '.vscode', 'settings.json'), VSBuffer.fromString('{ "initialization.testSetting2": "workspaceValue2" }'));
		await testObject.initialize(getWorkspaceIdentifier(configResource));

		assert.strictEqual(target.callCount, 5);
		assert.deepStrictEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1', 'initialization.testSetting2']);
		assert.deepStrictEqual(target.args[1], [WorkbenchState.WORKSPACE]);
		assert.deepStrictEqual(target.args[2], [undefined]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).added.map(folder => folder.uri.toString()), [joinPath(ROOT, 'a').toString(), joinPath(ROOT, 'b').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).removed, []);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).changed, []);

	});

	(isMacintosh ? test.skip : test)('initialize a folder workspace from a folder workspace with no configuration changes', async () => {

		await testObject.initialize(convertToWorkspacePayload(joinPath(ROOT, 'a')));
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "initialization.testSetting1": "userValue" }'));
		await testObject.reloadConfiguration();
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		await testObject.initialize(convertToWorkspacePayload(joinPath(ROOT, 'b')));

		assert.strictEqual(testObject.getValue('initialization.testSetting1'), 'userValue');
		assert.strictEqual(target.callCount, 2);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[1][0]).added.map(folder_1 => folder_1.uri.toString()), [joinPath(ROOT, 'b').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[1][0]).removed.map(folder_2 => folder_2.uri.toString()), [joinPath(ROOT, 'a').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[1][0]).changed, []);

	});

	(isMacintosh ? test.skip : test)('initialize a folder workspace from a folder workspace with configuration changes', async () => {

		await testObject.initialize(convertToWorkspacePayload(joinPath(ROOT, 'a')));
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		await fileService.writeFile(joinPath(ROOT, 'b', '.vscode', 'settings.json'), VSBuffer.fromString('{ "initialization.testSetting1": "workspaceValue2" }'));
		await testObject.initialize(convertToWorkspacePayload(joinPath(ROOT, 'b')));

		assert.strictEqual(testObject.getValue('initialization.testSetting1'), 'workspaceValue2');
		assert.strictEqual(target.callCount, 3);
		assert.deepStrictEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1']);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).added.map(folder_1 => folder_1.uri.toString()), [joinPath(ROOT, 'b').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).removed.map(folder_2 => folder_2.uri.toString()), [joinPath(ROOT, 'a').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[2][0]).changed, []);

	});

	(isMacintosh ? test.skip : test)('initialize a multi folder workspace from a folder workspacce triggers change events in the right order', async () => {
		await testObject.initialize(convertToWorkspacePayload(joinPath(ROOT, 'a')));
		const target = sinon.spy();
		testObject.onDidChangeWorkbenchState(target);
		testObject.onDidChangeWorkspaceName(target);
		testObject.onWillChangeWorkspaceFolders(target);
		testObject.onDidChangeWorkspaceFolders(target);
		testObject.onDidChangeConfiguration(target);

		await fileService.writeFile(joinPath(ROOT, 'a', '.vscode', 'settings.json'), VSBuffer.fromString('{ "initialization.testSetting1": "workspaceValue2" }'));
		await testObject.initialize(getWorkspaceIdentifier(configResource));

		assert.strictEqual(target.callCount, 5);
		assert.deepStrictEqual((<IConfigurationChangeEvent>target.args[0][0]).affectedKeys, ['initialization.testSetting1']);
		assert.deepStrictEqual(target.args[1], [WorkbenchState.WORKSPACE]);
		assert.deepStrictEqual(target.args[2], [undefined]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).added.map(folder_1 => folder_1.uri.toString()), [joinPath(ROOT, 'b').toString()]);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).removed, []);
		assert.deepStrictEqual((<IWorkspaceFoldersChangeEvent>target.args[4][0]).changed, []);
	});

});

suite('WorkspaceConfigurationService - Folder', () => {

	let testObject: WorkspaceService, workspaceService: WorkspaceService, fileService: IFileService, environmentService: BrowserWorkbenchEnvironmentService;
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
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
				},
				'configurationService.folder.restrictedSetting': {
					'type': 'string',
					'default': 'isSet',
					restricted: true
				},
			}
		});
	});

	setup(async () => {
		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		const folder = joinPath(ROOT, 'a');
		await fileService.createFolder(folder);

		const instantiationService = <TestInstantiationService>workbenchInstantiationService();
		environmentService = TestEnvironmentService;
		const remoteAgentService = instantiationService.createInstance(RemoteAgentService, null);
		instantiationService.stub(IRemoteAgentService, remoteAgentService);
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		workspaceService = testObject = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IWorkspaceContextService, testObject);
		instantiationService.stub(IConfigurationService, testObject);
		instantiationService.stub(IEnvironmentService, environmentService);

		await workspaceService.initialize(convertToWorkspacePayload(folder));
		instantiationService.stub(IKeybindingEditingService, instantiationService.createInstance(KeybindingsEditingService));
		instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
		instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
		workspaceService.acquireInstantiationService(instantiationService);
	});

	teardown(() => disposables.clear());

	test('defaults', () => {
		assert.deepStrictEqual(testObject.getValue('configurationService'), { 'folder': { 'applicationSetting': 'isSet', 'machineSetting': 'isSet', 'machineOverridableSetting': 'isSet', 'testSetting': 'isSet', 'languageSetting': 'isSet', 'restrictedSetting': 'isSet' } });
	});

	test('globals override defaults', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "userValue" }'));
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'userValue');
	});

	test('globals', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "testworkbench.editor.tabs": true }'));
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('testworkbench.editor.tabs'), true);
	});

	test('workspace settings', async () => {
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "testworkbench.editor.icons": true }'));
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('testworkbench.editor.icons'), true);
	});

	test('workspace settings override user settings', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'workspaceValue');
	});

	test('machine overridable settings override user Settings', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineOverridableSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.machineOverridableSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.machineOverridableSetting'), 'workspaceValue');
	});

	test('workspace settings override user settings after defaults are registered ', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.newSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.newSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
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
		assert.strictEqual(testObject.getValue('configurationService.folder.newSetting'), 'workspaceValue');
	});

	test('machine overridable settings override user settings after defaults are registered ', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.newMachineOverridableSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.newMachineOverridableSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
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
		assert.strictEqual(testObject.getValue('configurationService.folder.newMachineOverridableSetting'), 'workspaceValue');
	});

	test('application settings are not read from workspace', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.applicationSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.applicationSetting": "workspaceValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting'), 'userValue');
	});

	test('application settings are not read from workspace when workspace folder uri is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.applicationSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.applicationSetting": "workspaceValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.machineSetting": "workspaceValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace when workspace folder uri is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.machineSetting": "workspaceValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.applicationSetting-2": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.applicationSetting-2": "workspaceValue" }'));

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting-2'), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting-2'), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting-2'), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered when workspace folder uri is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.applicationSetting-3": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.applicationSetting-3": "workspaceValue" }'));

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('get machine scope settings are not loaded after defaults are registered', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineSetting-2": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.machineSetting-2": "workspaceValue" }'));

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting-2'), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting-2'), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting-2'), 'userValue');
	});

	test('get machine scope settings are not loaded after defaults are registered when workspace folder uri is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineSetting-3": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.machineSetting-3": "workspaceValue" }'));

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting-3', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('reload configuration emits events after global configuraiton changes', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "testworkbench.editor.tabs": true }'));
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.reloadConfiguration();
		assert.ok(target.called);
	});

	test('reload configuration emits events after workspace configuraiton changes', async () => {
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.reloadConfiguration();
		assert.ok(target.called);
	});

	test('reload configuration should not emit event if no changes', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "testworkbench.editor.tabs": true }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(() => { target(); });
		await testObject.reloadConfiguration();
		assert.ok(!target.called);
	});

	test('inspect', async () => {
		let actual = testObject.inspect('something.missing');
		assert.strictEqual(actual.defaultValue, undefined);
		assert.strictEqual(actual.userValue, undefined);
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, undefined);

		actual = testObject.inspect('configurationService.folder.testSetting');
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, undefined);
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, 'isSet');

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "userValue" }'));
		await testObject.reloadConfiguration();
		actual = testObject.inspect('configurationService.folder.testSetting');
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, 'userValue');
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, 'userValue');

		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		actual = testObject.inspect('configurationService.folder.testSetting');
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, 'userValue');
		assert.strictEqual(actual.workspaceValue, 'workspaceValue');
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, 'workspaceValue');
	});

	test('keys', async () => {
		let actual = testObject.keys();
		assert.ok(actual.default.indexOf('configurationService.folder.testSetting') !== -1);
		assert.deepStrictEqual(actual.user, []);
		assert.deepStrictEqual(actual.workspace, []);
		assert.deepStrictEqual(actual.workspaceFolder, []);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "userValue" }'));
		await testObject.reloadConfiguration();
		actual = testObject.keys();
		assert.ok(actual.default.indexOf('configurationService.folder.testSetting') !== -1);
		assert.deepStrictEqual(actual.user, ['configurationService.folder.testSetting']);
		assert.deepStrictEqual(actual.workspace, []);
		assert.deepStrictEqual(actual.workspaceFolder, []);

		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		actual = testObject.keys();
		assert.ok(actual.default.indexOf('configurationService.folder.testSetting') !== -1);
		assert.deepStrictEqual(actual.user, ['configurationService.folder.testSetting']);
		assert.deepStrictEqual(actual.workspace, ['configurationService.folder.testSetting']);
		assert.deepStrictEqual(actual.workspaceFolder, []);
	});

	test('update user configuration', () => {
		return testObject.updateValue('configurationService.folder.testSetting', 'value', ConfigurationTarget.USER)
			.then(() => assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'value'));
	});

	test('update workspace configuration', () => {
		return testObject.updateValue('tasks.service.testSetting', 'value', ConfigurationTarget.WORKSPACE)
			.then(() => assert.strictEqual(testObject.getValue('tasks.service.testSetting'), 'value'));
	});

	test('update resource configuration', () => {
		return testObject.updateValue('configurationService.folder.testSetting', 'value', { resource: workspaceService.getWorkspace().folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'value'));
	});

	test('update resource language configuration', () => {
		return testObject.updateValue('configurationService.folder.languageSetting', 'value', { resource: workspaceService.getWorkspace().folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.strictEqual(testObject.getValue('configurationService.folder.languageSetting'), 'value'));
	});

	test('update application setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.folder.applicationSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.strictEqual(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_APPLICATION));
	});

	test('update machine setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.folder.machineSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.strictEqual(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_MACHINE));
	});

	test('update tasks configuration', () => {
		return testObject.updateValue('tasks', { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }, ConfigurationTarget.WORKSPACE)
			.then(() => assert.deepStrictEqual(testObject.getValue('tasks'), { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }));
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
			.then(() => assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'memoryValue'));
	});

	test('update memory configuration should trigger change event before promise is resolve', () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		return testObject.updateValue('configurationService.folder.testSetting', 'memoryValue', ConfigurationTarget.MEMORY)
			.then(() => assert.ok(target.called));
	});

	test('remove setting from all targets', async () => {
		const key = 'configurationService.folder.testSetting';
		await testObject.updateValue(key, 'workspaceValue', ConfigurationTarget.WORKSPACE);
		await testObject.updateValue(key, 'userValue', ConfigurationTarget.USER);

		await testObject.updateValue(key, undefined);
		await testObject.reloadConfiguration();

		const actual = testObject.inspect(key, { resource: workspaceService.getWorkspace().folders[0].uri });
		assert.strictEqual(actual.userValue, undefined);
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
	});

	test('update user configuration to default value when target is not passed', async () => {
		await testObject.updateValue('configurationService.folder.testSetting', 'value', ConfigurationTarget.USER);
		await testObject.updateValue('configurationService.folder.testSetting', 'isSet');
		assert.strictEqual(testObject.inspect('configurationService.folder.testSetting').userValue, undefined);
	});

	test('update user configuration to default value when target is passed', async () => {
		await testObject.updateValue('configurationService.folder.testSetting', 'value', ConfigurationTarget.USER);
		await testObject.updateValue('configurationService.folder.testSetting', 'isSet', ConfigurationTarget.USER);
		assert.strictEqual(testObject.inspect('configurationService.folder.testSetting').userValue, 'isSet');
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

	test('change event when there are global tasks', async () => {
		await fileService.writeFile(joinPath(environmentService.userRoamingDataHome, 'tasks.json'), VSBuffer.fromString('{ "version": "1.0.0", "tasks": [{ "taskName": "myTask" }'));
		return new Promise<void>((c) => testObject.onDidChangeConfiguration(() => c()));
	});

	test('creating workspace settings', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "userValue" }'));
		await testObject.reloadConfiguration();
		await new Promise<void>(async (c) => {
			const disposable = testObject.onDidChangeConfiguration(e => {
				assert.ok(e.affectsConfiguration('configurationService.folder.testSetting'));
				assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'workspaceValue');
				disposable.dispose();
				c();
			});
			await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		});
	});

	test('deleting workspace settings', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "userValue" }'));
		const workspaceSettingsResource = joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json');
		await fileService.writeFile(workspaceSettingsResource, VSBuffer.fromString('{ "configurationService.folder.testSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();
		const e = await new Promise<IConfigurationChangeEvent>(async (c) => {
			Event.once(testObject.onDidChangeConfiguration)(c);
			await fileService.del(workspaceSettingsResource);
		});
		assert.ok(e.affectsConfiguration('configurationService.folder.testSetting'));
		assert.strictEqual(testObject.getValue('configurationService.folder.testSetting'), 'userValue');
	});

	test('restricted setting is read from workspace when workspace is trusted', async () => {
		testObject.updateWorkspaceTrust(true);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.restrictedSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'workspaceValue');
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.folder.restrictedSetting'));
		assert.strictEqual(testObject.restrictedSettings.userLocal, undefined);
		assert.strictEqual(testObject.restrictedSettings.userRemote, undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspace, ['configurationService.folder.restrictedSetting']);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.size, 1);
		assert.deepStrictEqual(testObject.restrictedSettings.workspaceFolder?.get(workspaceService.getWorkspace().folders[0].uri), ['configurationService.folder.restrictedSetting']);
	});

	test('restricted setting is not read from workspace when workspace is changed to trusted', async () => {
		testObject.updateWorkspaceTrust(true);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();

		testObject.updateWorkspaceTrust(false);

		assert.strictEqual(testObject.getValue('configurationService.folder.restrictedSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.folder.restrictedSetting'));
		assert.strictEqual(testObject.restrictedSettings.userLocal, undefined);
		assert.strictEqual(testObject.restrictedSettings.userRemote, undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspace, ['configurationService.folder.restrictedSetting']);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.size, 1);
		assert.deepStrictEqual(testObject.restrictedSettings.workspaceFolder?.get(workspaceService.getWorkspace().folders[0].uri), ['configurationService.folder.restrictedSetting']);
	});

	test('change event is triggered when workspace is changed to untrusted', async () => {
		testObject.updateWorkspaceTrust(true);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();

		const promise = Event.toPromise(testObject.onDidChangeConfiguration);
		testObject.updateWorkspaceTrust(false);

		const event = await promise;
		assert.ok(event.affectedKeys.includes('configurationService.folder.restrictedSetting'));
		assert.ok(event.affectsConfiguration('configurationService.folder.restrictedSetting'));
	});

	test('restricted setting is not read from workspace when workspace is not trusted', async () => {
		testObject.updateWorkspaceTrust(false);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.restrictedSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'userValue');
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.folder.restrictedSetting'));
		assert.strictEqual(testObject.restrictedSettings.userLocal, undefined);
		assert.strictEqual(testObject.restrictedSettings.userRemote, undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspace, ['configurationService.folder.restrictedSetting']);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.size, 1);
		assert.deepStrictEqual(testObject.restrictedSettings.workspaceFolder?.get(workspaceService.getWorkspace().folders[0].uri), ['configurationService.folder.restrictedSetting']);
	});

	test('restricted setting is read when workspace is changed to trusted', async () => {
		testObject.updateWorkspaceTrust(false);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();

		testObject.updateWorkspaceTrust(true);

		assert.strictEqual(testObject.getValue('configurationService.folder.restrictedSetting', { resource: workspaceService.getWorkspace().folders[0].uri }), 'workspaceValue');
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.folder.restrictedSetting'));
		assert.strictEqual(testObject.restrictedSettings.userLocal, undefined);
		assert.strictEqual(testObject.restrictedSettings.userRemote, undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspace, ['configurationService.folder.restrictedSetting']);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.size, 1);
		assert.deepStrictEqual(testObject.restrictedSettings.workspaceFolder?.get(workspaceService.getWorkspace().folders[0].uri), ['configurationService.folder.restrictedSetting']);
	});

	test('change event is triggered when workspace is changed to trusted', async () => {
		testObject.updateWorkspaceTrust(false);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));
		await testObject.reloadConfiguration();

		const promise = Event.toPromise(testObject.onDidChangeConfiguration);
		testObject.updateWorkspaceTrust(true);

		const event = await promise;
		assert.ok(event.affectedKeys.includes('configurationService.folder.restrictedSetting'));
		assert.ok(event.affectsConfiguration('configurationService.folder.restrictedSetting'));
	});

	test('adding an restricted setting triggers change event', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "userValue" }'));
		testObject.updateWorkspaceTrust(false);

		const promise = Event.toPromise(testObject.onDidChangeRestrictedSettings);
		await fileService.writeFile(joinPath(workspaceService.getWorkspace().folders[0].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.folder.restrictedSetting": "workspaceValue" }'));

		return promise;
	});
});

suite('WorkspaceConfigurationService-Multiroot', () => {

	let workspaceContextService: IWorkspaceContextService, jsonEditingServce: IJSONEditingService, testObject: WorkspaceService, fileService: IFileService, environmentService: BrowserWorkbenchEnvironmentService;
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
				},
				'configurationService.workspace.testRestrictedSetting1': {
					'type': 'string',
					'default': 'isSet',
					restricted: true,
					scope: ConfigurationScope.RESOURCE
				},
				'configurationService.workspace.testRestrictedSetting2': {
					'type': 'string',
					'default': 'isSet',
					restricted: true,
					scope: ConfigurationScope.RESOURCE
				}
			}
		});
	});

	setup(async () => {
		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		const appSettingsHome = joinPath(ROOT, 'user');
		const folderA = joinPath(ROOT, 'a');
		const folderB = joinPath(ROOT, 'b');
		const configResource = joinPath(ROOT, 'vsctests.code-workspace');
		const workspace = { folders: [{ path: folderA.path }, { path: folderB.path }] };

		await fileService.createFolder(appSettingsHome);
		await fileService.createFolder(folderA);
		await fileService.createFolder(folderB);
		await fileService.writeFile(configResource, VSBuffer.fromString(JSON.stringify(workspace, null, '\t')));

		const instantiationService = <TestInstantiationService>workbenchInstantiationService();
		environmentService = TestEnvironmentService;
		const remoteAgentService = instantiationService.createInstance(RemoteAgentService, null);
		instantiationService.stub(IRemoteAgentService, remoteAgentService);
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		const workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));

		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IWorkspaceContextService, workspaceService);
		instantiationService.stub(IConfigurationService, workspaceService);
		instantiationService.stub(IWorkbenchEnvironmentService, environmentService);
		instantiationService.stub(IEnvironmentService, environmentService);

		await workspaceService.initialize(getWorkspaceIdentifier(configResource));
		instantiationService.stub(IKeybindingEditingService, instantiationService.createInstance(KeybindingsEditingService));
		instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
		instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
		workspaceService.acquireInstantiationService(instantiationService);

		workspaceContextService = workspaceService;
		jsonEditingServce = instantiationService.createInstance(JSONEditingService);
		testObject = workspaceService;
	});

	teardown(() => disposables.clear());

	test('application settings are not read from workspace', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.applicationSetting": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.applicationSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting'), 'userValue');
	});

	test('application settings are not read from workspace when folder is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.applicationSetting": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.applicationSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.applicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineSetting": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.machineSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting'), 'userValue');
	});

	test('machine settings are not read from workspace when folder is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.folder.machineSetting": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.machineSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.folder.machineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.newSetting": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.newSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.newSetting'), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.workspace.newSetting'), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.newSetting'), 'userValue');
	});

	test('get application scope settings are not loaded after defaults are registered when workspace folder is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.newSetting-2": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.newSetting-2': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.newSetting-2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.workspace.newSetting-2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.newSetting-2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('workspace settings override user settings after defaults are registered for machine overridable settings ', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.newMachineOverridableSetting": "userValue" }'));
		await jsonEditingServce.write(workspaceContextService.getWorkspace().configuration!, [{ path: ['settings'], value: { 'configurationService.workspace.newMachineOverridableSetting': 'workspaceValue' } }], true);

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.newMachineOverridableSetting'), 'workspaceValue');

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

		assert.strictEqual(testObject.getValue('configurationService.workspace.newMachineOverridableSetting'), 'workspaceValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.newMachineOverridableSetting'), 'workspaceValue');

	});

	test('application settings are not read from workspace folder', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.applicationSetting": "userValue" }'));
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.applicationSetting": "workspaceFolderValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.applicationSetting'), 'userValue');
	});

	test('application settings are not read from workspace folder when workspace folder is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.applicationSetting": "userValue" }'));
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.applicationSetting": "workspaceFolderValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.applicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('machine settings are not read from workspace folder', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.machineSetting": "userValue" }'));
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.machineSetting": "workspaceFolderValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.machineSetting'), 'userValue');
	});

	test('machine settings are not read from workspace folder when workspace folder is passed', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.machineSetting": "userValue" }'));
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.machineSetting": "workspaceFolderValue" }'));

		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.machineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('application settings are not read from workspace folder after defaults are registered', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.testNewApplicationSetting": "userValue" }'));
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testNewApplicationSetting": "workspaceFolderValue" }'));

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewApplicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');

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

		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewApplicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewApplicationSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('application settings are not read from workspace folder after defaults are registered', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.testNewMachineSetting": "userValue" }'));
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testNewMachineSetting": "workspaceFolderValue" }'));
		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewMachineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');

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

		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewMachineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');

		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewMachineSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'userValue');
	});

	test('resource setting in folder is read after it is registered later', async () => {
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testNewResourceSetting2": "workspaceFolderValue" }'));
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['settings'], value: { 'configurationService.workspace.testNewResourceSetting2': 'workspaceValue' } }], true);
		await testObject.reloadConfiguration();
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
		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewResourceSetting2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');
	});

	test('resource language setting in folder is read after it is registered later', async () => {
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testNewResourceLanguageSetting2": "workspaceFolderValue" }'));
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['settings'], value: { 'configurationService.workspace.testNewResourceLanguageSetting2': 'workspaceValue' } }], true);
		await testObject.reloadConfiguration();
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
		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewResourceLanguageSetting2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');
	});

	test('machine overridable setting in folder is read after it is registered later', async () => {
		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testNewMachineOverridableSetting2": "workspaceFolderValue" }'));
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['settings'], value: { 'configurationService.workspace.testNewMachineOverridableSetting2': 'workspaceValue' } }], true);
		await testObject.reloadConfiguration();
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
		assert.strictEqual(testObject.getValue('configurationService.workspace.testNewMachineOverridableSetting2', { resource: workspaceContextService.getWorkspace().folders[0].uri }), 'workspaceFolderValue');
	});

	test('inspect', async () => {
		let actual = testObject.inspect('something.missing');
		assert.strictEqual(actual.defaultValue, undefined);
		assert.strictEqual(actual.userValue, undefined);
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, undefined);

		actual = testObject.inspect('configurationService.workspace.testResourceSetting');
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, undefined);
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, 'isSet');

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.testResourceSetting": "userValue" }'));
		await testObject.reloadConfiguration();
		actual = testObject.inspect('configurationService.workspace.testResourceSetting');
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, 'userValue');
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, 'userValue');

		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['settings'], value: { 'configurationService.workspace.testResourceSetting': 'workspaceValue' } }], true);
		await testObject.reloadConfiguration();
		actual = testObject.inspect('configurationService.workspace.testResourceSetting');
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, 'userValue');
		assert.strictEqual(actual.workspaceValue, 'workspaceValue');
		assert.strictEqual(actual.workspaceFolderValue, undefined);
		assert.strictEqual(actual.value, 'workspaceValue');

		await fileService.writeFile(workspaceContextService.getWorkspace().folders[0].toResource('.vscode/settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testResourceSetting": "workspaceFolderValue" }'));
		await testObject.reloadConfiguration();
		actual = testObject.inspect('configurationService.workspace.testResourceSetting', { resource: workspaceContextService.getWorkspace().folders[0].uri });
		assert.strictEqual(actual.defaultValue, 'isSet');
		assert.strictEqual(actual.userValue, 'userValue');
		assert.strictEqual(actual.workspaceValue, 'workspaceValue');
		assert.strictEqual(actual.workspaceFolderValue, 'workspaceFolderValue');
		assert.strictEqual(actual.value, 'workspaceFolderValue');
	});

	test('get launch configuration', async () => {
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
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['launch'], value: expectedLaunchConfiguration }], true);
		await testObject.reloadConfiguration();
		const actual = testObject.getValue('launch');
		assert.deepStrictEqual(actual, expectedLaunchConfiguration);
	});

	test('inspect launch configuration', async () => {
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
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['launch'], value: expectedLaunchConfiguration }], true);
		await testObject.reloadConfiguration();
		const actual = testObject.inspect('launch').workspaceValue;
		assert.deepStrictEqual(actual, expectedLaunchConfiguration);
	});


	test('get tasks configuration', async () => {
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
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['tasks'], value: expectedTasksConfiguration }], true);
		await testObject.reloadConfiguration();
		const actual = testObject.getValue('tasks');
		assert.deepStrictEqual(actual, expectedTasksConfiguration);
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
		assert.deepStrictEqual(actual, expectedTasksConfiguration);
	});

	test('update user configuration', async () => {
		await testObject.updateValue('configurationService.workspace.testSetting', 'userValue', ConfigurationTarget.USER);
		assert.strictEqual(testObject.getValue('configurationService.workspace.testSetting'), 'userValue');
	});

	test('update user configuration should trigger change event before promise is resolve', async () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.updateValue('configurationService.workspace.testSetting', 'userValue', ConfigurationTarget.USER);
		assert.ok(target.called);
	});

	test('update workspace configuration', async () => {
		await testObject.updateValue('configurationService.workspace.testSetting', 'workspaceValue', ConfigurationTarget.WORKSPACE);
		assert.strictEqual(testObject.getValue('configurationService.workspace.testSetting'), 'workspaceValue');
	});

	test('update workspace configuration should trigger change event before promise is resolve', async () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.updateValue('configurationService.workspace.testSetting', 'workspaceValue', ConfigurationTarget.WORKSPACE);
		assert.ok(target.called);
	});

	test('update application setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.workspace.applicationSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.strictEqual(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_APPLICATION));
	});

	test('update machine setting into workspace configuration in a workspace is not supported', () => {
		return testObject.updateValue('configurationService.workspace.machineSetting', 'workspaceValue', {}, ConfigurationTarget.WORKSPACE, true)
			.then(() => assert.fail('Should not be supported'), (e) => assert.strictEqual(e.code, ConfigurationEditingErrorCode.ERROR_INVALID_WORKSPACE_CONFIGURATION_MACHINE));
	});

	test('update workspace folder configuration', () => {
		const workspace = workspaceContextService.getWorkspace();
		return testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER)
			.then(() => assert.strictEqual(testObject.getValue('configurationService.workspace.testResourceSetting', { resource: workspace.folders[0].uri }), 'workspaceFolderValue'));
	});

	test('update resource language configuration in workspace folder', async () => {
		const workspace = workspaceContextService.getWorkspace();
		await testObject.updateValue('configurationService.workspace.testLanguageSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		assert.strictEqual(testObject.getValue('configurationService.workspace.testLanguageSetting', { resource: workspace.folders[0].uri }), 'workspaceFolderValue');
	});

	test('update workspace folder configuration should trigger change event before promise is resolve', async () => {
		const workspace = workspaceContextService.getWorkspace();
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		assert.ok(target.called);
	});

	test('update workspace folder configuration second time should trigger change event before promise is resolve', async () => {
		const workspace = workspaceContextService.getWorkspace();
		await testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.updateValue('configurationService.workspace.testResourceSetting', 'workspaceFolderValue2', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		assert.ok(target.called);
	});

	test('update memory configuration', async () => {
		await testObject.updateValue('configurationService.workspace.testSetting', 'memoryValue', ConfigurationTarget.MEMORY);
		assert.strictEqual(testObject.getValue('configurationService.workspace.testSetting'), 'memoryValue');
	});

	test('update memory configuration should trigger change event before promise is resolve', async () => {
		const target = sinon.spy();
		testObject.onDidChangeConfiguration(target);
		await testObject.updateValue('configurationService.workspace.testSetting', 'memoryValue', ConfigurationTarget.MEMORY);
		assert.ok(target.called);
	});

	test('remove setting from all targets', async () => {
		const workspace = workspaceContextService.getWorkspace();
		const key = 'configurationService.workspace.testResourceSetting';
		await testObject.updateValue(key, 'workspaceFolderValue', { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		await testObject.updateValue(key, 'workspaceValue', ConfigurationTarget.WORKSPACE);
		await testObject.updateValue(key, 'userValue', ConfigurationTarget.USER);

		await testObject.updateValue(key, undefined, { resource: workspace.folders[0].uri });
		await testObject.reloadConfiguration();

		const actual = testObject.inspect(key, { resource: workspace.folders[0].uri });
		assert.strictEqual(actual.userValue, undefined);
		assert.strictEqual(actual.workspaceValue, undefined);
		assert.strictEqual(actual.workspaceFolderValue, undefined);
	});

	test('update tasks configuration in a folder', async () => {
		const workspace = workspaceContextService.getWorkspace();
		await testObject.updateValue('tasks', { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] }, { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		assert.deepStrictEqual(testObject.getValue('tasks', { resource: workspace.folders[0].uri }), { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] });
	});

	test('update launch configuration in a workspace', async () => {
		const workspace = workspaceContextService.getWorkspace();
		await testObject.updateValue('launch', { 'version': '1.0.0', configurations: [{ 'name': 'myLaunch' }] }, { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE, true);
		assert.deepStrictEqual(testObject.getValue('launch'), { 'version': '1.0.0', configurations: [{ 'name': 'myLaunch' }] });
	});

	test('update tasks configuration in a workspace', async () => {
		const workspace = workspaceContextService.getWorkspace();
		const tasks = { 'version': '2.0.0', tasks: [{ 'label': 'myTask' }] };
		await testObject.updateValue('tasks', tasks, { resource: workspace.folders[0].uri }, ConfigurationTarget.WORKSPACE, true);
		assert.deepStrictEqual(testObject.getValue('tasks'), tasks);
	});

	test('configuration of newly added folder is available on configuration change event', async () => {
		const workspaceService = <WorkspaceService>testObject;
		const uri = workspaceService.getWorkspace().folders[1].uri;
		await workspaceService.removeFolders([uri]);
		await fileService.writeFile(joinPath(uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testResourceSetting": "workspaceFolderValue" }'));

		return new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(() => {
				try {
					assert.strictEqual(testObject.getValue('configurationService.workspace.testResourceSetting', { resource: uri }), 'workspaceFolderValue');
					c();
				} catch (error) {
					e(error);
				}
			});
			workspaceService.addFolders([{ uri }]);
		});
	});

	test('restricted setting is read from workspace folders when workspace is trusted', async () => {
		testObject.updateWorkspaceTrust(true);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.testRestrictedSetting1": "userValue", "configurationService.workspace.testRestrictedSetting2": "userValue" }'));
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['settings'], value: { 'configurationService.workspace.testRestrictedSetting1': 'workspaceValue' } }], true);
		await fileService.writeFile(joinPath(testObject.getWorkspace().folders[1].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testRestrictedSetting2": "workspaceFolder2Value" }'));
		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.testRestrictedSetting1', { resource: testObject.getWorkspace().folders[0].uri }), 'workspaceValue');
		assert.strictEqual(testObject.getValue('configurationService.workspace.testRestrictedSetting2', { resource: testObject.getWorkspace().folders[1].uri }), 'workspaceFolder2Value');
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.workspace.testRestrictedSetting1'));
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.workspace.testRestrictedSetting2'));
		assert.strictEqual(testObject.restrictedSettings.userLocal, undefined);
		assert.strictEqual(testObject.restrictedSettings.userRemote, undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspace, ['configurationService.workspace.testRestrictedSetting1']);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.size, 1);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.get(testObject.getWorkspace().folders[0].uri), undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspaceFolder?.get(testObject.getWorkspace().folders[1].uri), ['configurationService.workspace.testRestrictedSetting2']);
	});

	test('restricted setting is not read from workspace when workspace is not trusted', async () => {
		testObject.updateWorkspaceTrust(false);

		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.workspace.testRestrictedSetting1": "userValue", "configurationService.workspace.testRestrictedSetting2": "userValue" }'));
		await jsonEditingServce.write((workspaceContextService.getWorkspace().configuration!), [{ path: ['settings'], value: { 'configurationService.workspace.testRestrictedSetting1': 'workspaceValue' } }], true);
		await fileService.writeFile(joinPath(testObject.getWorkspace().folders[1].uri, '.vscode', 'settings.json'), VSBuffer.fromString('{ "configurationService.workspace.testRestrictedSetting2": "workspaceFolder2Value" }'));
		await testObject.reloadConfiguration();

		assert.strictEqual(testObject.getValue('configurationService.workspace.testRestrictedSetting1', { resource: testObject.getWorkspace().folders[0].uri }), 'userValue');
		assert.strictEqual(testObject.getValue('configurationService.workspace.testRestrictedSetting2', { resource: testObject.getWorkspace().folders[1].uri }), 'userValue');
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.workspace.testRestrictedSetting1'));
		assert.ok(testObject.restrictedSettings.default.includes('configurationService.workspace.testRestrictedSetting2'));
		assert.strictEqual(testObject.restrictedSettings.userLocal, undefined);
		assert.strictEqual(testObject.restrictedSettings.userRemote, undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspace, ['configurationService.workspace.testRestrictedSetting1']);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.size, 1);
		assert.strictEqual(testObject.restrictedSettings.workspaceFolder?.get(testObject.getWorkspace().folders[0].uri), undefined);
		assert.deepStrictEqual(testObject.restrictedSettings.workspaceFolder?.get(testObject.getWorkspace().folders[1].uri), ['configurationService.workspace.testRestrictedSetting2']);
	});

});

suite('WorkspaceConfigurationService - Remote Folder', () => {

	let testObject: WorkspaceService, folder: URI,
		machineSettingsResource: URI, remoteSettingsResource: URI, fileSystemProvider: InMemoryFileSystemProvider, resolveRemoteEnvironment: () => void,
		instantiationService: TestInstantiationService, fileService: IFileService, environmentService: BrowserWorkbenchEnvironmentService;
	const remoteAuthority = 'configuraiton-tests';
	const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const disposables = new DisposableStore();

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

	setup(async () => {
		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(ROOT.scheme, fileSystemProvider);

		const appSettingsHome = joinPath(ROOT, 'user');
		folder = joinPath(ROOT, 'a');
		await fileService.createFolder(folder);
		await fileService.createFolder(appSettingsHome);
		machineSettingsResource = joinPath(ROOT, 'machine-settings.json');
		remoteSettingsResource = machineSettingsResource.with({ scheme: Schemas.vscodeRemote, authority: remoteAuthority });

		instantiationService = <TestInstantiationService>workbenchInstantiationService();
		environmentService = TestEnvironmentService;
		const remoteEnvironmentPromise = new Promise<Partial<IRemoteAgentEnvironment>>(c => resolveRemoteEnvironment = () => c({ settingsPath: remoteSettingsResource }));
		const remoteAgentService = instantiationService.stub(IRemoteAgentService, <Partial<IRemoteAgentService>>{ getEnvironment: () => remoteEnvironmentPromise });
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		const configurationCache: IConfigurationCache = { read: () => Promise.resolve(''), write: () => Promise.resolve(), remove: () => Promise.resolve(), needsCaching: () => false };
		testObject = disposables.add(new WorkspaceService({ configurationCache, remoteAuthority }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
		instantiationService.stub(IWorkspaceContextService, testObject);
		instantiationService.stub(IConfigurationService, testObject);
		instantiationService.stub(IEnvironmentService, environmentService);
		instantiationService.stub(IFileService, fileService);
	});

	async function initialize(): Promise<void> {
		await testObject.initialize(convertToWorkspacePayload(folder));
		instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
		instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
		testObject.acquireInstantiationService(instantiationService);
	}

	function registerRemoteFileSystemProvider(): void {
		instantiationService.get(IFileService).registerProvider(Schemas.vscodeRemote, new RemoteFileSystemProvider(fileSystemProvider, remoteAuthority));
	}

	function registerRemoteFileSystemProviderOnActivation(): void {
		const disposable = instantiationService.get(IFileService).onWillActivateFileSystemProvider(e => {
			if (e.scheme === Schemas.vscodeRemote) {
				disposable.dispose();
				e.join(Promise.resolve().then(() => registerRemoteFileSystemProvider()));
			}
		});
	}

	teardown(() => disposables.clear());

	test('remote settings override globals', async () => {
		await fileService.writeFile(machineSettingsResource, VSBuffer.fromString('{ "configurationService.remote.machineSetting": "remoteValue" }'));
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.strictEqual(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
	});

	test('remote settings override globals after remote provider is registered on activation', async () => {
		await fileService.writeFile(machineSettingsResource, VSBuffer.fromString('{ "configurationService.remote.machineSetting": "remoteValue" }'));
		resolveRemoteEnvironment();
		registerRemoteFileSystemProviderOnActivation();
		await initialize();
		assert.strictEqual(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
	});

	test('remote settings override globals after remote environment is resolved', async () => {
		await fileService.writeFile(machineSettingsResource, VSBuffer.fromString('{ "configurationService.remote.machineSetting": "remoteValue" }'));
		registerRemoteFileSystemProvider();
		await initialize();
		const promise = new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(event => {
				try {
					assert.strictEqual(event.source, ConfigurationTarget.USER);
					assert.deepStrictEqual(event.affectedKeys, ['configurationService.remote.machineSetting']);
					assert.strictEqual(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
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
		await fileService.writeFile(machineSettingsResource, VSBuffer.fromString('{ "configurationService.remote.machineSetting": "remoteValue" }'));
		registerRemoteFileSystemProviderOnActivation();
		await initialize();
		const promise = new Promise<void>((c, e) => {
			testObject.onDidChangeConfiguration(event => {
				try {
					assert.strictEqual(event.source, ConfigurationTarget.USER);
					assert.deepStrictEqual(event.affectedKeys, ['configurationService.remote.machineSetting']);
					assert.strictEqual(testObject.getValue('configurationService.remote.machineSetting'), 'remoteValue');
					c();
				} catch (error) {
					e(error);
				}
			});
		});
		resolveRemoteEnvironment();
		return promise;
	});

	test('machine settings in local user settings does not override defaults', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.remote.machineSetting": "globalValue" }'));
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.strictEqual(testObject.getValue('configurationService.remote.machineSetting'), 'isSet');
	});

	test('machine overridable settings in local user settings does not override defaults', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.remote.machineOverridableSetting": "globalValue" }'));
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		assert.strictEqual(testObject.getValue('configurationService.remote.machineOverridableSetting'), 'isSet');
	});

	test('non machine setting is written in local settings', async () => {
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		await testObject.updateValue('configurationService.remote.applicationSetting', 'applicationValue');
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.inspect('configurationService.remote.applicationSetting').userLocalValue, 'applicationValue');
	});

	test('machine setting is written in remote settings', async () => {
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		await testObject.updateValue('configurationService.remote.machineSetting', 'machineValue');
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.inspect('configurationService.remote.machineSetting').userRemoteValue, 'machineValue');
	});

	test('machine overridable setting is written in remote settings', async () => {
		registerRemoteFileSystemProvider();
		resolveRemoteEnvironment();
		await initialize();
		await testObject.updateValue('configurationService.remote.machineOverridableSetting', 'machineValue');
		await testObject.reloadConfiguration();
		assert.strictEqual(testObject.inspect('configurationService.remote.machineOverridableSetting').userRemoteValue, 'machineValue');
	});

	test('machine settings in local user settings does not override defaults after defalts are registered ', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.remote.newMachineSetting": "userValue" }'));
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
		assert.strictEqual(testObject.getValue('configurationService.remote.newMachineSetting'), 'isSet');
	});

	test('machine overridable settings in local user settings does not override defaults after defaults are registered ', async () => {
		await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString('{ "configurationService.remote.newMachineOverridableSetting": "userValue" }'));
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
		assert.strictEqual(testObject.getValue('configurationService.remote.newMachineOverridableSetting'), 'isSet');
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

	teardown(() => disposableStore.clear());

	test('when default value is not overriden', () => {
		const testObject = createConfigurationService({});
		assert.deepStrictEqual(testObject.getValue('configurationService.defaultOverridesSetting'), 'isSet');
	});

	test('when default value is overriden', () => {
		const testObject = createConfigurationService({ 'configurationService.defaultOverridesSetting': 'overriddenValue' });
		assert.deepStrictEqual(testObject.getValue('configurationService.defaultOverridesSetting'), 'overriddenValue');
	});

	function createConfigurationService(configurationDefaults: Record<string, any>): IConfigurationService {
		const remoteAgentService = (<TestInstantiationService>workbenchInstantiationService()).createInstance(RemoteAgentService, null);
		const environmentService = new BrowserWorkbenchEnvironmentService({ logsPath: joinPath(ROOT, 'logs'), workspaceId: '', configurationDefaults }, TestProductService);
		const fileService = new FileService(new NullLogService());
		return disposableStore.add(new WorkspaceService({ configurationCache: new ConfigurationCache() }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
	}

});

function getWorkspaceId(configPath: URI): string {
	let workspaceConfigPath = configPath.toString();
	if (!isLinux) {
		workspaceConfigPath = workspaceConfigPath.toLowerCase(); // sanitize for platform file system
	}
	return hash(workspaceConfigPath).toString(16);
}

export function getWorkspaceIdentifier(configPath: URI): IWorkspaceIdentifier {
	return {
		configPath,
		id: getWorkspaceId(configPath)
	};
}
