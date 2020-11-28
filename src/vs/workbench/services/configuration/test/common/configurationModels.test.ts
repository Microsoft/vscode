/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Registry } from 'vs/platform/registry/common/platform';
import { StandaloneConfigurationModelParser, Configuration } from 'vs/workbench/services/configuration/common/configurationModels';
import { ConfigurationModelParser, ConfigurationModel } from 'vs/platform/configuration/common/configurationModels';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { ResourceMap } from 'vs/base/common/map';
import { WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';
import { Workspace } from 'vs/platform/workspace/test/common/testWorkspace';

suite('FolderSettingsModelParser', () => {

	suiteSetup(() => {
		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		configurationRegistry.registerConfiguration({
			'id': 'FolderSettingsModelParser_1',
			'type': 'object',
			'properties': {
				'FolderSettingsModelParser.window': {
					'type': 'string',
					'default': 'isSet'
				},
				'FolderSettingsModelParser.resource': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.RESOURCE,
				},
				'FolderSettingsModelParser.resourceLanguage': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
				},
				'FolderSettingsModelParser.application': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				},
				'FolderSettingsModelParser.machine': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				}
			}
		});
	});

	test('parse all folder settings', () => {
		const testObject = new ConfigurationModelParser('settings', [ConfigurationScope.RESOURCE, ConfigurationScope.WINDOW]);

		testObject.parseContent(JSON.stringify({ 'FolderSettingsModelParser.window': 'window', 'FolderSettingsModelParser.resource': 'resource', 'FolderSettingsModelParser.application': 'application', 'FolderSettingsModelParser.machine': 'executable' }));

		assert.deepEqual(testObject.configurationModel.contents, { 'FolderSettingsModelParser': { 'window': 'window', 'resource': 'resource' } });
	});

	test('parse resource folder settings', () => {
		const testObject = new ConfigurationModelParser('settings', [ConfigurationScope.RESOURCE]);

		testObject.parseContent(JSON.stringify({ 'FolderSettingsModelParser.window': 'window', 'FolderSettingsModelParser.resource': 'resource', 'FolderSettingsModelParser.application': 'application', 'FolderSettingsModelParser.machine': 'executable' }));

		assert.deepEqual(testObject.configurationModel.contents, { 'FolderSettingsModelParser': { 'resource': 'resource' } });
	});

	test('parse resource and resource language settings', () => {
		const testObject = new ConfigurationModelParser('settings', [ConfigurationScope.RESOURCE, ConfigurationScope.LANGUAGE_OVERRIDABLE]);

		testObject.parseContent(JSON.stringify({ '[json]': { 'FolderSettingsModelParser.window': 'window', 'FolderSettingsModelParser.resource': 'resource', 'FolderSettingsModelParser.resourceLanguage': 'resourceLanguage', 'FolderSettingsModelParser.application': 'application', 'FolderSettingsModelParser.machine': 'executable' } }));

		assert.deepEqual(testObject.configurationModel.overrides, [{ 'contents': { 'FolderSettingsModelParser': { 'resource': 'resource', 'resourceLanguage': 'resourceLanguage' } }, 'identifiers': ['json'], 'keys': ['FolderSettingsModelParser.resource', 'FolderSettingsModelParser.resourceLanguage'] }]);
	});

	test('reprocess folder settings excludes application and machine setting', () => {
		const testObject = new ConfigurationModelParser('settings', [ConfigurationScope.RESOURCE, ConfigurationScope.WINDOW]);

		testObject.parseContent(JSON.stringify({ 'FolderSettingsModelParser.resource': 'resource', 'FolderSettingsModelParser.anotherApplicationSetting': 'executable' }));

		assert.deepEqual(testObject.configurationModel.contents, { 'FolderSettingsModelParser': { 'resource': 'resource', 'anotherApplicationSetting': 'executable' } });

		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		configurationRegistry.registerConfiguration({
			'id': 'FolderSettingsModelParser_2',
			'type': 'object',
			'properties': {
				'FolderSettingsModelParser.anotherApplicationSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.APPLICATION
				},
				'FolderSettingsModelParser.anotherMachineSetting': {
					'type': 'string',
					'default': 'isSet',
					scope: ConfigurationScope.MACHINE
				}
			}
		});

		testObject.parse();
		assert.deepEqual(testObject.configurationModel.contents, { 'FolderSettingsModelParser': { 'resource': 'resource' } });
	});

});

suite('StandaloneConfigurationModelParser', () => {

	test('parse tasks stand alone configuration model', () => {
		const testObject = new StandaloneConfigurationModelParser('tasks', 'tasks');

		testObject.parseContent(JSON.stringify({ 'version': '1.1.1', 'tasks': [] }));

		assert.deepEqual(testObject.configurationModel.contents, { 'tasks': { 'version': '1.1.1', 'tasks': [] } });
	});

});

suite('Workspace Configuration', () => {

	const defaultConfigurationModel = toConfigurationModel({
		'editor.lineNumbers': 'on',
		'editor.fontSize': 12,
		'window.zoomLevel': 1,
		'[markdown]': {
			'editor.wordWrap': 'off'
		},
		'window.title': 'custom',
		'workbench.enableTabs': false,
		'editor.insertSpaces': true
	});

	test('Test compare same configurations', () => {
		const workspace = new Workspace('a', [new WorkspaceFolder({ index: 0, name: 'a', uri: URI.file('folder1') }), new WorkspaceFolder({ index: 1, name: 'b', uri: URI.file('folder2') }), new WorkspaceFolder({ index: 2, name: 'c', uri: URI.file('folder3') })]);
		const configuration1 = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), workspace);
		configuration1.updateDefaultConfiguration(defaultConfigurationModel);
		configuration1.updateLocalUserConfiguration(toConfigurationModel({ 'window.title': 'native', '[typescript]': { 'editor.insertSpaces': false } }));
		configuration1.updateWorkspaceConfiguration(toConfigurationModel({ 'editor.lineNumbers': 'on' }));
		configuration1.updateFolderConfiguration(URI.file('folder1'), toConfigurationModel({ 'editor.fontSize': 14 }));
		configuration1.updateFolderConfiguration(URI.file('folder2'), toConfigurationModel({ 'editor.wordWrap': 'on' }));

		const configuration2 = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), workspace);
		configuration2.updateDefaultConfiguration(defaultConfigurationModel);
		configuration2.updateLocalUserConfiguration(toConfigurationModel({ 'window.title': 'native', '[typescript]': { 'editor.insertSpaces': false } }));
		configuration2.updateWorkspaceConfiguration(toConfigurationModel({ 'editor.lineNumbers': 'on' }));
		configuration2.updateFolderConfiguration(URI.file('folder1'), toConfigurationModel({ 'editor.fontSize': 14 }));
		configuration2.updateFolderConfiguration(URI.file('folder2'), toConfigurationModel({ 'editor.wordWrap': 'on' }));

		const actual = configuration2.compare(configuration1);

		assert.deepEqual(actual, { keys: [], overrides: [] });
	});

	test('Test compare different configurations', () => {
		const workspace = new Workspace('a', [new WorkspaceFolder({ index: 0, name: 'a', uri: URI.file('folder1') }), new WorkspaceFolder({ index: 1, name: 'b', uri: URI.file('folder2') }), new WorkspaceFolder({ index: 2, name: 'c', uri: URI.file('folder3') })]);
		const configuration1 = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), workspace);
		configuration1.updateDefaultConfiguration(defaultConfigurationModel);
		configuration1.updateLocalUserConfiguration(toConfigurationModel({ 'window.title': 'native', '[typescript]': { 'editor.insertSpaces': false } }));
		configuration1.updateWorkspaceConfiguration(toConfigurationModel({ 'editor.lineNumbers': 'on' }));
		configuration1.updateFolderConfiguration(URI.file('folder1'), toConfigurationModel({ 'editor.fontSize': 14 }));
		configuration1.updateFolderConfiguration(URI.file('folder2'), toConfigurationModel({ 'editor.wordWrap': 'on' }));

		const configuration2 = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), new ConfigurationModel(), new ResourceMap<ConfigurationModel>(), workspace);
		configuration2.updateDefaultConfiguration(defaultConfigurationModel);
		configuration2.updateLocalUserConfiguration(toConfigurationModel({ 'workbench.enableTabs': true, '[typescript]': { 'editor.insertSpaces': true } }));
		configuration2.updateWorkspaceConfiguration(toConfigurationModel({ 'editor.fontSize': 11 }));
		configuration2.updateFolderConfiguration(URI.file('folder1'), toConfigurationModel({ 'editor.insertSpaces': true }));
		configuration2.updateFolderConfiguration(URI.file('folder2'), toConfigurationModel({
			'[markdown]': {
				'editor.wordWrap': 'on',
				'editor.lineNumbers': 'relative'
			},
		}));

		const actual = configuration2.compare(configuration1);

		assert.deepEqual(actual, { keys: ['editor.wordWrap', 'editor.fontSize', '[markdown]', 'window.title', 'workbench.enableTabs', '[typescript]'], overrides: [['markdown', ['editor.lineNumbers', 'editor.wordWrap']], ['typescript', ['editor.insertSpaces']]] });
	});


});

function toConfigurationModel(obj: any): ConfigurationModel {
	const parser = new ConfigurationModelParser('test');
	parser.parseContent(JSON.stringify(obj));
	return parser.configurationModel;
}
