/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as fs from 'fs';
import * as json from 'vs/base/common/json';
import { Registry } from 'vs/platform/registry/common/platform';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { TestProductService, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestWorkbenchConfiguration, TestTextFileService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import * as uuid from 'vs/base/common/uuid';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ConfigurationEditingService, ConfigurationEditingError, ConfigurationEditingErrorCode, EditableConfigurationTarget } from 'vs/workbench/services/configuration/common/configurationEditingService';
import { WORKSPACE_STANDALONE_CONFIGURATIONS, FOLDER_SETTINGS_PATH, USER_STANDALONE_CONFIGURATIONS } from 'vs/workbench/services/configuration/common/configuration';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { mkdirp, rimraf, RimRafMode } from 'vs/base/node/pfs';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { CommandService } from 'vs/workbench/services/commands/common/commandService';
import { URI } from 'vs/base/common/uri';
import { createHash } from 'crypto';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { Schemas } from 'vs/base/common/network';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { IFileService } from 'vs/platform/files/common/files';
import { ConfigurationCache } from 'vs/workbench/services/configuration/electron-browser/configurationCache';
import { KeybindingsEditingService, IKeybindingEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { DisposableStore } from 'vs/base/common/lifecycle';

class TestWorkbenchEnvironmentService extends NativeWorkbenchEnvironmentService {

	constructor(private _appSettingsHome: URI) {
		super(TestWorkbenchConfiguration, TestProductService);
	}

	get appSettingsHome() { return this._appSettingsHome; }
}

suite('ConfigurationEditingService', () => {

	let instantiationService: TestInstantiationService;
	let testObject: ConfigurationEditingService;
	let parentDir: string;
	let workspaceDir: string;
	let globalSettingsFile: string;
	let globalTasksFile: string;
	let workspaceSettingsDir;

	const disposables = new DisposableStore();

	suiteSetup(() => {
		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configurationEditing.service.testSetting': {
					'type': 'string',
					'default': 'isSet'
				},
				'configurationEditing.service.testSettingTwo': {
					'type': 'string',
					'default': 'isSet'
				},
				'configurationEditing.service.testSettingThree': {
					'type': 'string',
					'default': 'isSet'
				}
			}
		});
	});

	setup(async () => {
		await setUpWorkspace();
		await setUpServices();
	});

	async function setUpWorkspace(): Promise<void> {
		const id = uuid.generateUuid();
		parentDir = path.join(os.tmpdir(), 'vsctests', id);
		workspaceDir = path.join(parentDir, 'workspaceconfig', id);
		globalSettingsFile = path.join(workspaceDir, 'settings.json');
		globalTasksFile = path.join(workspaceDir, 'tasks.json');
		workspaceSettingsDir = path.join(workspaceDir, '.vscode');

		return await mkdirp(workspaceSettingsDir, 493);
	}

	async function setUpServices(noWorkspace: boolean = false): Promise<void> {
		instantiationService = <TestInstantiationService>workbenchInstantiationService();
		const environmentService = new TestWorkbenchEnvironmentService(URI.file(workspaceDir));
		instantiationService.stub(IEnvironmentService, environmentService);
		const remoteAgentService = instantiationService.createInstance(RemoteAgentService);
		const fileService = disposables.add(new FileService(new NullLogService()));
		const diskFileSystemProvider = disposables.add(new DiskFileSystemProvider(new NullLogService()));
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService())));
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IRemoteAgentService, remoteAgentService);
		const workspaceService = disposables.add(new WorkspaceService({ configurationCache: new ConfigurationCache(environmentService) }, environmentService, fileService, remoteAgentService, new UriIdentityService(fileService), new NullLogService()));
		instantiationService.stub(IWorkspaceContextService, workspaceService);
		await workspaceService.initialize(noWorkspace ? { id: '' } : { folder: URI.file(workspaceDir), id: createHash('md5').update(URI.file(workspaceDir).toString()).digest('hex') });
		instantiationService.stub(IConfigurationService, workspaceService);
		instantiationService.stub(IKeybindingEditingService, instantiationService.createInstance(KeybindingsEditingService));
		instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
		instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
		instantiationService.stub(ICommandService, CommandService);
		testObject = instantiationService.createInstance(ConfigurationEditingService);
	}

	teardown(() => {
		disposables.clear();
		if (workspaceDir) {
			return rimraf(workspaceDir, RimRafMode.MOVE);
		}
		return undefined;
	});

	test('errors cases - invalid key', () => {
		return testObject.writeConfiguration(EditableConfigurationTarget.WORKSPACE, { key: 'unknown.key', value: 'value' })
			.then(() => assert.fail('Should fail with ERROR_UNKNOWN_KEY'),
				(error: ConfigurationEditingError) => assert.equal(error.code, ConfigurationEditingErrorCode.ERROR_UNKNOWN_KEY));
	});

	test('errors cases - no workspace', () => {
		return setUpServices(true)
			.then(() => testObject.writeConfiguration(EditableConfigurationTarget.WORKSPACE, { key: 'configurationEditing.service.testSetting', value: 'value' }))
			.then(() => assert.fail('Should fail with ERROR_NO_WORKSPACE_OPENED'),
				(error: ConfigurationEditingError) => assert.equal(error.code, ConfigurationEditingErrorCode.ERROR_NO_WORKSPACE_OPENED));
	});

	function errorCasesInvalidConfig(file: string, key: string) {
		fs.writeFileSync(file, ',,,,,,,,,,,,,,');
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key, value: 'value' })
			.then(() => assert.fail('Should fail with ERROR_INVALID_CONFIGURATION'),
				(error: ConfigurationEditingError) => assert.equal(error.code, ConfigurationEditingErrorCode.ERROR_INVALID_CONFIGURATION));
	}

	test('errors cases - invalid configuration', () => {
		return errorCasesInvalidConfig(globalSettingsFile, 'configurationEditing.service.testSetting');
	});

	test('errors cases - invalid global tasks configuration', () => {
		return errorCasesInvalidConfig(globalTasksFile, 'tasks.configurationEditing.service.testSetting');
	});

	test('errors cases - dirty', () => {
		instantiationService.stub(ITextFileService, 'isDirty', true);
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: 'value' })
			.then(() => assert.fail('Should fail with ERROR_CONFIGURATION_FILE_DIRTY error.'),
				(error: ConfigurationEditingError) => assert.equal(error.code, ConfigurationEditingErrorCode.ERROR_CONFIGURATION_FILE_DIRTY));
	});

	test('dirty error is not thrown if not asked to save', () => {
		instantiationService.stub(ITextFileService, 'isDirty', true);
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: 'value' }, { donotSave: true })
			.then(() => null, error => assert.fail('Should not fail.'));
	});

	test('do not notify error', () => {
		instantiationService.stub(ITextFileService, 'isDirty', true);
		const target = sinon.stub();
		instantiationService.stub(INotificationService, <INotificationService>{ prompt: target, _serviceBrand: undefined, notify: null!, error: null!, info: null!, warn: null!, status: null!, setFilter: null! });
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: 'value' }, { donotNotifyError: true })
			.then(() => assert.fail('Should fail with ERROR_CONFIGURATION_FILE_DIRTY error.'),
				(error: ConfigurationEditingError) => {
					assert.equal(false, target.calledOnce);
					assert.equal(error.code, ConfigurationEditingErrorCode.ERROR_CONFIGURATION_FILE_DIRTY);
				});
	});

	test('write one setting - empty file', () => {
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: 'value' })
			.then(() => {
				const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
				const parsed = json.parse(contents);
				assert.equal(parsed['configurationEditing.service.testSetting'], 'value');
			});
	});

	test('write one setting - existing file', () => {
		fs.writeFileSync(globalSettingsFile, '{ "my.super.setting": "my.super.value" }');
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: 'value' })
			.then(() => {
				const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
				const parsed = json.parse(contents);
				assert.equal(parsed['configurationEditing.service.testSetting'], 'value');
				assert.equal(parsed['my.super.setting'], 'my.super.value');
			});
	});

	test('remove an existing setting - existing file', () => {
		fs.writeFileSync(globalSettingsFile, '{ "my.super.setting": "my.super.value", "configurationEditing.service.testSetting": "value" }');
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: undefined })
			.then(() => {
				const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
				const parsed = json.parse(contents);
				assert.deepEqual(Object.keys(parsed), ['my.super.setting']);
				assert.equal(parsed['my.super.setting'], 'my.super.value');
			});
	});

	test('remove non existing setting - existing file', () => {
		fs.writeFileSync(globalSettingsFile, '{ "my.super.setting": "my.super.value" }');
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key: 'configurationEditing.service.testSetting', value: undefined })
			.then(() => {
				const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
				const parsed = json.parse(contents);
				assert.deepEqual(Object.keys(parsed), ['my.super.setting']);
				assert.equal(parsed['my.super.setting'], 'my.super.value');
			});
	});

	test('write overridable settings to user settings', () => {
		const key = '[language]';
		const value = { 'configurationEditing.service.testSetting': 'overridden value' };
		return testObject.writeConfiguration(EditableConfigurationTarget.USER_LOCAL, { key, value })
			.then(() => {
				const contents = fs.readFileSync(globalSettingsFile).toString('utf8');
				const parsed = json.parse(contents);
				assert.deepEqual(parsed[key], value);
			});
	});

	test('write overridable settings to workspace settings', () => {
		const key = '[language]';
		const value = { 'configurationEditing.service.testSetting': 'overridden value' };
		return testObject.writeConfiguration(EditableConfigurationTarget.WORKSPACE, { key, value })
			.then(() => {
				const target = path.join(workspaceDir, FOLDER_SETTINGS_PATH);
				const contents = fs.readFileSync(target).toString('utf8');
				const parsed = json.parse(contents);
				assert.deepEqual(parsed[key], value);
			});
	});

	test('write overridable settings to workspace folder settings', () => {
		const key = '[language]';
		const value = { 'configurationEditing.service.testSetting': 'overridden value' };
		const folderSettingsFile = path.join(workspaceDir, FOLDER_SETTINGS_PATH);
		return testObject.writeConfiguration(EditableConfigurationTarget.WORKSPACE_FOLDER, { key, value }, { scopes: { resource: URI.file(folderSettingsFile) } })
			.then(() => {
				const contents = fs.readFileSync(folderSettingsFile).toString('utf8');
				const parsed = json.parse(contents);
				assert.deepEqual(parsed[key], value);
			});
	});

	function writeStandaloneSettingEmptyFile(configTarget: EditableConfigurationTarget, pathMap: any) {
		return testObject.writeConfiguration(configTarget, { key: 'tasks.service.testSetting', value: 'value' })
			.then(() => {
				const target = path.join(workspaceDir, pathMap['tasks']);
				const contents = fs.readFileSync(target).toString('utf8');
				const parsed = json.parse(contents);
				assert.equal(parsed['service.testSetting'], 'value');
			});
	}

	test('write workspace standalone setting - empty file', () => {
		return writeStandaloneSettingEmptyFile(EditableConfigurationTarget.WORKSPACE, WORKSPACE_STANDALONE_CONFIGURATIONS);
	});

	test('write user standalone setting - empty file', () => {
		return writeStandaloneSettingEmptyFile(EditableConfigurationTarget.USER_LOCAL, USER_STANDALONE_CONFIGURATIONS);
	});

	function writeStandaloneSettingExitingFile(configTarget: EditableConfigurationTarget, pathMap: any) {
		const target = path.join(workspaceDir, pathMap['tasks']);
		fs.writeFileSync(target, '{ "my.super.setting": "my.super.value" }');
		return testObject.writeConfiguration(configTarget, { key: 'tasks.service.testSetting', value: 'value' })
			.then(() => {
				const contents = fs.readFileSync(target).toString('utf8');
				const parsed = json.parse(contents);
				assert.equal(parsed['service.testSetting'], 'value');
				assert.equal(parsed['my.super.setting'], 'my.super.value');
			});
	}

	test('write workspace standalone setting - existing file', () => {
		return writeStandaloneSettingExitingFile(EditableConfigurationTarget.WORKSPACE, WORKSPACE_STANDALONE_CONFIGURATIONS);
	});

	test('write user standalone setting - existing file', () => {
		return writeStandaloneSettingExitingFile(EditableConfigurationTarget.USER_LOCAL, USER_STANDALONE_CONFIGURATIONS);
	});

	function writeStandaloneSettingEmptyFileFullJson(configTarget: EditableConfigurationTarget, pathMap: any) {
		return testObject.writeConfiguration(configTarget, { key: 'tasks', value: { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] } })
			.then(() => {
				const target = path.join(workspaceDir, pathMap['tasks']);
				const contents = fs.readFileSync(target).toString('utf8');
				const parsed = json.parse(contents);

				assert.equal(parsed['version'], '1.0.0');
				assert.equal(parsed['tasks'][0]['taskName'], 'myTask');
			});
	}

	test('write workspace standalone setting - empty file - full JSON', () => {
		return writeStandaloneSettingEmptyFileFullJson(EditableConfigurationTarget.WORKSPACE, WORKSPACE_STANDALONE_CONFIGURATIONS);
	});

	test('write user standalone setting - empty file - full JSON', () => {
		return writeStandaloneSettingEmptyFileFullJson(EditableConfigurationTarget.USER_LOCAL, USER_STANDALONE_CONFIGURATIONS);
	});

	function writeStandaloneSettingExistingFileFullJson(configTarget: EditableConfigurationTarget, pathMap: any) {
		const target = path.join(workspaceDir, pathMap['tasks']);
		fs.writeFileSync(target, '{ "my.super.setting": "my.super.value" }');
		return testObject.writeConfiguration(configTarget, { key: 'tasks', value: { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] } })
			.then(() => {
				const contents = fs.readFileSync(target).toString('utf8');
				const parsed = json.parse(contents);

				assert.equal(parsed['version'], '1.0.0');
				assert.equal(parsed['tasks'][0]['taskName'], 'myTask');
			});
	}

	test('write workspace standalone setting - existing file - full JSON', () => {
		return writeStandaloneSettingExistingFileFullJson(EditableConfigurationTarget.WORKSPACE, WORKSPACE_STANDALONE_CONFIGURATIONS);
	});

	test('write user standalone setting - existing file - full JSON', () => {
		return writeStandaloneSettingExistingFileFullJson(EditableConfigurationTarget.USER_LOCAL, USER_STANDALONE_CONFIGURATIONS);
	});

	function writeStandaloneSettingExistingFileWithJsonErrorFullJson(configTarget: EditableConfigurationTarget, pathMap: any) {
		const target = path.join(workspaceDir, pathMap['tasks']);
		fs.writeFileSync(target, '{ "my.super.setting": '); // invalid JSON
		return testObject.writeConfiguration(configTarget, { key: 'tasks', value: { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask' }] } })
			.then(() => {
				const contents = fs.readFileSync(target).toString('utf8');
				const parsed = json.parse(contents);

				assert.equal(parsed['version'], '1.0.0');
				assert.equal(parsed['tasks'][0]['taskName'], 'myTask');
			});
	}

	test('write workspace standalone setting - existing file with JSON errors - full JSON', () => {
		return writeStandaloneSettingExistingFileWithJsonErrorFullJson(EditableConfigurationTarget.WORKSPACE, WORKSPACE_STANDALONE_CONFIGURATIONS);
	});

	test('write user standalone setting - existing file with JSON errors - full JSON', () => {
		return writeStandaloneSettingExistingFileWithJsonErrorFullJson(EditableConfigurationTarget.USER_LOCAL, USER_STANDALONE_CONFIGURATIONS);
	});

	function writeStandaloneSettingShouldReplace(configTarget: EditableConfigurationTarget, pathMap: any) {
		const target = path.join(workspaceDir, pathMap['tasks']);
		fs.writeFileSync(target, `{
			"version": "1.0.0",
			"tasks": [
				{
					"taskName": "myTask1"
				},
				{
					"taskName": "myTask2"
				}
			]
		}`);
		return testObject.writeConfiguration(configTarget, { key: 'tasks', value: { 'version': '1.0.0', tasks: [{ 'taskName': 'myTask1' }] } })
			.then(() => {
				const actual = fs.readFileSync(target).toString('utf8');
				const expected = JSON.stringify({ 'version': '1.0.0', tasks: [{ 'taskName': 'myTask1' }] }, null, '\t');
				assert.equal(actual, expected);
			});
	}

	test('write workspace standalone setting should replace complete file', () => {
		return writeStandaloneSettingShouldReplace(EditableConfigurationTarget.WORKSPACE, WORKSPACE_STANDALONE_CONFIGURATIONS);
	});

	test('write user standalone setting should replace complete file', () => {
		return writeStandaloneSettingShouldReplace(EditableConfigurationTarget.USER_LOCAL, USER_STANDALONE_CONFIGURATIONS);
	});
});
