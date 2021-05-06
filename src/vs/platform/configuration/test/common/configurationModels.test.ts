/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ConfigurationModel, DefaultConfigurationModel, ConfigurationChangeEvent, ConfigurationModelParser, Configuration, mergeChanges, AllKeysConfigurationChangeEvent } from 'vs/platform/configuration/common/configurationModels';
import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { URI } from 'vs/base/common/uri';
import { WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { join } from 'vs/base/common/path';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { Workspace } from 'vs/platform/workspace/test/common/testWorkspace';

suite('ConfigurationModel', () => {

	test('setValue for a key that has no sections and not defined', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1 } }, ['a.b']);

		testObject.setValue('f', 1);

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': 1 }, 'f': 1 });
		assert.deepStrictEqual(testObject.keys, ['a.b', 'f']);
	});

	test('setValue for a key that has no sections and defined', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1 }, 'f': 1 }, ['a.b', 'f']);

		testObject.setValue('f', 3);

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': 1 }, 'f': 3 });
		assert.deepStrictEqual(testObject.keys, ['a.b', 'f']);
	});

	test('setValue for a key that has sections and not defined', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1 }, 'f': 1 }, ['a.b', 'f']);

		testObject.setValue('b.c', 1);

		const expected: any = {};
		expected['a'] = { 'b': 1 };
		expected['f'] = 1;
		expected['b'] = Object.create(null);
		expected['b']['c'] = 1;
		assert.deepStrictEqual(testObject.contents, expected);
		assert.deepStrictEqual(testObject.keys, ['a.b', 'f', 'b.c']);
	});

	test('setValue for a key that has sections and defined', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1 }, 'b': { 'c': 1 }, 'f': 1 }, ['a.b', 'b.c', 'f']);

		testObject.setValue('b.c', 3);

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': 1 }, 'b': { 'c': 3 }, 'f': 1 });
		assert.deepStrictEqual(testObject.keys, ['a.b', 'b.c', 'f']);
	});

	test('setValue for a key that has sections and sub section not defined', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1 }, 'f': 1 }, ['a.b', 'f']);

		testObject.setValue('a.c', 1);

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': 1, 'c': 1 }, 'f': 1 });
		assert.deepStrictEqual(testObject.keys, ['a.b', 'f', 'a.c']);
	});

	test('setValue for a key that has sections and sub section defined', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1, 'c': 1 }, 'f': 1 }, ['a.b', 'a.c', 'f']);

		testObject.setValue('a.c', 3);

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': 1, 'c': 3 }, 'f': 1 });
		assert.deepStrictEqual(testObject.keys, ['a.b', 'a.c', 'f']);
	});

	test('setValue for a key that has sections and last section is added', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': {} }, 'f': 1 }, ['a.b', 'f']);

		testObject.setValue('a.b.c', 1);

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': { 'c': 1 } }, 'f': 1 });
		assert.deepStrictEqual(testObject.keys, ['a.b.c', 'f']);
	});

	test('removeValue: remove a non existing key', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 2 } }, ['a.b']);

		testObject.removeValue('a.b.c');

		assert.deepStrictEqual(testObject.contents, { 'a': { 'b': 2 } });
		assert.deepStrictEqual(testObject.keys, ['a.b']);
	});

	test('removeValue: remove a single segmented key', () => {
		let testObject = new ConfigurationModel({ 'a': 1 }, ['a']);

		testObject.removeValue('a');

		assert.deepStrictEqual(testObject.contents, {});
		assert.deepStrictEqual(testObject.keys, []);
	});

	test('removeValue: remove a multi segmented key', () => {
		let testObject = new ConfigurationModel({ 'a': { 'b': 1 } }, ['a.b']);

		testObject.removeValue('a.b');

		assert.deepStrictEqual(testObject.contents, {});
		assert.deepStrictEqual(testObject.keys, []);
	});

	test('get overriding configuration model for an existing identifier', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': 1 }, [],
			[{ identifiers: ['c'], contents: { 'a': { 'd': 1 } }, keys: ['a'] }]);

		assert.deepStrictEqual(testObject.override('c').contents, { 'a': { 'b': 1, 'd': 1 }, 'f': 1 });
	});

	test('get overriding configuration model for an identifier that does not exist', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': 1 }, [],
			[{ identifiers: ['c'], contents: { 'a': { 'd': 1 } }, keys: ['a'] }]);

		assert.deepStrictEqual(testObject.override('xyz').contents, { 'a': { 'b': 1 }, 'f': 1 });
	});

	test('get overriding configuration when one of the keys does not exist in base', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': 1 }, [],
			[{ identifiers: ['c'], contents: { 'a': { 'd': 1 }, 'g': 1 }, keys: ['a', 'g'] }]);

		assert.deepStrictEqual(testObject.override('c').contents, { 'a': { 'b': 1, 'd': 1 }, 'f': 1, 'g': 1 });
	});

	test('get overriding configuration when one of the key in base is not of object type', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': 1 }, [],
			[{ identifiers: ['c'], contents: { 'a': { 'd': 1 }, 'f': { 'g': 1 } }, keys: ['a', 'f'] }]);

		assert.deepStrictEqual(testObject.override('c').contents, { 'a': { 'b': 1, 'd': 1 }, 'f': { 'g': 1 } });
	});

	test('get overriding configuration when one of the key in overriding contents is not of object type', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': { 'g': 1 } }, [],
			[{ identifiers: ['c'], contents: { 'a': { 'd': 1 }, 'f': 1 }, keys: ['a', 'f'] }]);

		assert.deepStrictEqual(testObject.override('c').contents, { 'a': { 'b': 1, 'd': 1 }, 'f': 1 });
	});

	test('get overriding configuration if the value of overriding identifier is not object', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': { 'g': 1 } }, [],
			[{ identifiers: ['c'], contents: 'abc', keys: [] }]);

		assert.deepStrictEqual(testObject.override('c').contents, { 'a': { 'b': 1 }, 'f': { 'g': 1 } });
	});

	test('get overriding configuration if the value of overriding identifier is an empty object', () => {
		let testObject = new ConfigurationModel(
			{ 'a': { 'b': 1 }, 'f': { 'g': 1 } }, [],
			[{ identifiers: ['c'], contents: {}, keys: [] }]);

		assert.deepStrictEqual(testObject.override('c').contents, { 'a': { 'b': 1 }, 'f': { 'g': 1 } });
	});

	test('simple merge', () => {
		let base = new ConfigurationModel({ 'a': 1, 'b': 2 }, ['a', 'b']);
		let add = new ConfigurationModel({ 'a': 3, 'c': 4 }, ['a', 'c']);
		let result = base.merge(add);

		assert.deepStrictEqual(result.contents, { 'a': 3, 'b': 2, 'c': 4 });
		assert.deepStrictEqual(result.keys, ['a', 'b', 'c']);
	});

	test('recursive merge', () => {
		let base = new ConfigurationModel({ 'a': { 'b': 1 } }, ['a.b']);
		let add = new ConfigurationModel({ 'a': { 'b': 2 } }, ['a.b']);
		let result = base.merge(add);

		assert.deepStrictEqual(result.contents, { 'a': { 'b': 2 } });
		assert.deepStrictEqual(result.getValue('a'), { 'b': 2 });
		assert.deepStrictEqual(result.keys, ['a.b']);
	});

	test('simple merge overrides', () => {
		let base = new ConfigurationModel({ 'a': { 'b': 1 } }, ['a.b'], [{ identifiers: ['c'], contents: { 'a': 2 }, keys: ['a'] }]);
		let add = new ConfigurationModel({ 'a': { 'b': 2 } }, ['a.b'], [{ identifiers: ['c'], contents: { 'b': 2 }, keys: ['b'] }]);
		let result = base.merge(add);

		assert.deepStrictEqual(result.contents, { 'a': { 'b': 2 } });
		assert.deepStrictEqual(result.overrides, [{ identifiers: ['c'], contents: { 'a': 2, 'b': 2 }, keys: ['a'] }]);
		assert.deepStrictEqual(result.override('c').contents, { 'a': 2, 'b': 2 });
		assert.deepStrictEqual(result.keys, ['a.b']);
	});

	test('recursive merge overrides', () => {
		let base = new ConfigurationModel({ 'a': { 'b': 1 }, 'f': 1 }, ['a.b', 'f'], [{ identifiers: ['c'], contents: { 'a': { 'd': 1 } }, keys: ['a'] }]);
		let add = new ConfigurationModel({ 'a': { 'b': 2 } }, ['a.b'], [{ identifiers: ['c'], contents: { 'a': { 'e': 2 } }, keys: ['a'] }]);
		let result = base.merge(add);

		assert.deepStrictEqual(result.contents, { 'a': { 'b': 2 }, 'f': 1 });
		assert.deepStrictEqual(result.overrides, [{ identifiers: ['c'], contents: { 'a': { 'd': 1, 'e': 2 } }, keys: ['a'] }]);
		assert.deepStrictEqual(result.override('c').contents, { 'a': { 'b': 2, 'd': 1, 'e': 2 }, 'f': 1 });
		assert.deepStrictEqual(result.keys, ['a.b', 'f']);
	});

	test('merge overrides when frozen', () => {
		let model1 = new ConfigurationModel({ 'a': { 'b': 1 }, 'f': 1 }, ['a.b', 'f'], [{ identifiers: ['c'], contents: { 'a': { 'd': 1 } }, keys: ['a'] }]).freeze();
		let model2 = new ConfigurationModel({ 'a': { 'b': 2 } }, ['a.b'], [{ identifiers: ['c'], contents: { 'a': { 'e': 2 } }, keys: ['a'] }]).freeze();
		let result = new ConfigurationModel().merge(model1, model2);

		assert.deepStrictEqual(result.contents, { 'a': { 'b': 2 }, 'f': 1 });
		assert.deepStrictEqual(result.overrides, [{ identifiers: ['c'], contents: { 'a': { 'd': 1, 'e': 2 } }, keys: ['a'] }]);
		assert.deepStrictEqual(result.override('c').contents, { 'a': { 'b': 2, 'd': 1, 'e': 2 }, 'f': 1 });
		assert.deepStrictEqual(result.keys, ['a.b', 'f']);
	});

	test('Test contents while getting an existing property', () => {
		let testObject = new ConfigurationModel({ 'a': 1 });
		assert.deepStrictEqual(testObject.getValue('a'), 1);

		testObject = new ConfigurationModel({ 'a': { 'b': 1 } });
		assert.deepStrictEqual(testObject.getValue('a'), { 'b': 1 });
	});

	test('Test contents are undefined for non existing properties', () => {
		const testObject = new ConfigurationModel({ awesome: true });

		assert.deepStrictEqual(testObject.getValue('unknownproperty'), undefined);
	});

	test('Test override gives all content merged with overrides', () => {
		const testObject = new ConfigurationModel({ 'a': 1, 'c': 1 }, [], [{ identifiers: ['b'], contents: { 'a': 2 }, keys: ['a'] }]);

		assert.deepStrictEqual(testObject.override('b').contents, { 'a': 2, 'c': 1 });
	});
});

suite('CustomConfigurationModel', () => {

	test('simple merge using models', () => {
		let base = new ConfigurationModelParser('base');
		base.parse(JSON.stringify({ 'a': 1, 'b': 2 }));

		let add = new ConfigurationModelParser('add');
		add.parse(JSON.stringify({ 'a': 3, 'c': 4 }));

		let result = base.configurationModel.merge(add.configurationModel);
		assert.deepStrictEqual(result.contents, { 'a': 3, 'b': 2, 'c': 4 });
	});

	test('simple merge with an undefined contents', () => {
		let base = new ConfigurationModelParser('base');
		base.parse(JSON.stringify({ 'a': 1, 'b': 2 }));
		let add = new ConfigurationModelParser('add');
		let result = base.configurationModel.merge(add.configurationModel);
		assert.deepStrictEqual(result.contents, { 'a': 1, 'b': 2 });

		base = new ConfigurationModelParser('base');
		add = new ConfigurationModelParser('add');
		add.parse(JSON.stringify({ 'a': 1, 'b': 2 }));
		result = base.configurationModel.merge(add.configurationModel);
		assert.deepStrictEqual(result.contents, { 'a': 1, 'b': 2 });

		base = new ConfigurationModelParser('base');
		add = new ConfigurationModelParser('add');
		result = base.configurationModel.merge(add.configurationModel);
		assert.deepStrictEqual(result.contents, {});
	});

	test('Recursive merge using config models', () => {
		let base = new ConfigurationModelParser('base');
		base.parse(JSON.stringify({ 'a': { 'b': 1 } }));
		let add = new ConfigurationModelParser('add');
		add.parse(JSON.stringify({ 'a': { 'b': 2 } }));
		let result = base.configurationModel.merge(add.configurationModel);
		assert.deepStrictEqual(result.contents, { 'a': { 'b': 2 } });
	});

	test('Test contents while getting an existing property', () => {
		let testObject = new ConfigurationModelParser('test');
		testObject.parse(JSON.stringify({ 'a': 1 }));
		assert.deepStrictEqual(testObject.configurationModel.getValue('a'), 1);

		testObject.parse(JSON.stringify({ 'a': { 'b': 1 } }));
		assert.deepStrictEqual(testObject.configurationModel.getValue('a'), { 'b': 1 });
	});

	test('Test contents are undefined for non existing properties', () => {
		const testObject = new ConfigurationModelParser('test');
		testObject.parse(JSON.stringify({
			awesome: true
		}));

		assert.deepStrictEqual(testObject.configurationModel.getValue('unknownproperty'), undefined);
	});

	test('Test contents are undefined for undefined config', () => {
		const testObject = new ConfigurationModelParser('test');

		assert.deepStrictEqual(testObject.configurationModel.getValue('unknownproperty'), undefined);
	});

	test('Test configWithOverrides gives all content merged with overrides', () => {
		const testObject = new ConfigurationModelParser('test');
		testObject.parse(JSON.stringify({ 'a': 1, 'c': 1, '[b]': { 'a': 2 } }));

		assert.deepStrictEqual(testObject.configurationModel.override('b').contents, { 'a': 2, 'c': 1, '[b]': { 'a': 2 } });
	});

	test('Test configWithOverrides gives empty contents', () => {
		const testObject = new ConfigurationModelParser('test');

		assert.deepStrictEqual(testObject.configurationModel.override('b').contents, {});
	});

	test('Test update with empty data', () => {
		const testObject = new ConfigurationModelParser('test');
		testObject.parse('');

		assert.deepStrictEqual(testObject.configurationModel.contents, Object.create(null));
		assert.deepStrictEqual(testObject.configurationModel.keys, []);

		testObject.parse(null!);

		assert.deepStrictEqual(testObject.configurationModel.contents, Object.create(null));
		assert.deepStrictEqual(testObject.configurationModel.keys, []);

		testObject.parse(undefined!);

		assert.deepStrictEqual(testObject.configurationModel.contents, Object.create(null));
		assert.deepStrictEqual(testObject.configurationModel.keys, []);
	});

	test('Test registering the same property again', () => {
		Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
			'id': 'a',
			'order': 1,
			'title': 'a',
			'type': 'object',
			'properties': {
				'a': {
					'description': 'a',
					'type': 'boolean',
					'default': true,
				}
			}
		});
		Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
			'id': 'a',
			'order': 1,
			'title': 'a',
			'type': 'object',
			'properties': {
				'a': {
					'description': 'a',
					'type': 'boolean',
					'default': false,
				}
			}
		});
		assert.strictEqual(true, new DefaultConfigurationModel().getValue('a'));
	});
});

suite('Configuration', () => {

	test('Test inspect for overrideIdentifiers', () => {
		const defaultConfigurationModel = parseConfigurationModel({ '[l1]': { 'a': 1 }, '[l2]': { 'b': 1 } });
		const userConfigurationModel = parseConfigurationModel({ '[l3]': { 'a': 2 } });
		const workspaceConfigurationModel = parseConfigurationModel({ '[l1]': { 'a': 3 }, '[l4]': { 'a': 3 } });
		const testObject: Configuration = new Configuration(defaultConfigurationModel, userConfigurationModel, new ConfigurationModel(), workspaceConfigurationModel);

		const { overrideIdentifiers } = testObject.inspect('a', {}, undefined);

		assert.deepStrictEqual(overrideIdentifiers, ['l1', 'l3', 'l4']);
	});

	test('Test update value', () => {
		const parser = new ConfigurationModelParser('test');
		parser.parse(JSON.stringify({ 'a': 1 }));
		const testObject: Configuration = new Configuration(parser.configurationModel, new ConfigurationModel());

		testObject.updateValue('a', 2);

		assert.strictEqual(testObject.getValue('a', {}, undefined), 2);
	});

	test('Test update value after inspect', () => {
		const parser = new ConfigurationModelParser('test');
		parser.parse(JSON.stringify({ 'a': 1 }));
		const testObject: Configuration = new Configuration(parser.configurationModel, new ConfigurationModel());

		testObject.inspect('a', {}, undefined);
		testObject.updateValue('a', 2);

		assert.strictEqual(testObject.getValue('a', {}, undefined), 2);
	});

	test('Test compare and update default configuration', () => {
		const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		testObject.updateDefaultConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'on',
		}));

		const actual = testObject.compareAndUpdateDefaultConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'off',
			'[markdown]': {
				'editor.wordWrap': 'off'
			}
		}), ['editor.lineNumbers', '[markdown]']);

		assert.deepStrictEqual(actual, { keys: ['editor.lineNumbers', '[markdown]'], overrides: [['markdown', ['editor.wordWrap']]] });

	});

	test('Test compare and update user configuration', () => {
		const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		testObject.updateLocalUserConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'off',
			'editor.fontSize': 12,
			'[typescript]': {
				'editor.wordWrap': 'off'
			}
		}));

		const actual = testObject.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'on',
			'window.zoomLevel': 1,
			'[typescript]': {
				'editor.wordWrap': 'on',
				'editor.insertSpaces': false
			}
		}));

		assert.deepStrictEqual(actual, { keys: ['window.zoomLevel', 'editor.lineNumbers', '[typescript]', 'editor.fontSize'], overrides: [['typescript', ['editor.insertSpaces', 'editor.wordWrap']]] });

	});

	test('Test compare and update workspace configuration', () => {
		const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		testObject.updateWorkspaceConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'off',
			'editor.fontSize': 12,
			'[typescript]': {
				'editor.wordWrap': 'off'
			}
		}));

		const actual = testObject.compareAndUpdateWorkspaceConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'on',
			'window.zoomLevel': 1,
			'[typescript]': {
				'editor.wordWrap': 'on',
				'editor.insertSpaces': false
			}
		}));

		assert.deepStrictEqual(actual, { keys: ['window.zoomLevel', 'editor.lineNumbers', '[typescript]', 'editor.fontSize'], overrides: [['typescript', ['editor.insertSpaces', 'editor.wordWrap']]] });

	});

	test('Test compare and update workspace folder configuration', () => {
		const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		testObject.updateFolderConfiguration(URI.file('file1'), toConfigurationModel({
			'editor.lineNumbers': 'off',
			'editor.fontSize': 12,
			'[typescript]': {
				'editor.wordWrap': 'off'
			}
		}));

		const actual = testObject.compareAndUpdateFolderConfiguration(URI.file('file1'), toConfigurationModel({
			'editor.lineNumbers': 'on',
			'window.zoomLevel': 1,
			'[typescript]': {
				'editor.wordWrap': 'on',
				'editor.insertSpaces': false
			}
		}));

		assert.deepStrictEqual(actual, { keys: ['window.zoomLevel', 'editor.lineNumbers', '[typescript]', 'editor.fontSize'], overrides: [['typescript', ['editor.insertSpaces', 'editor.wordWrap']]] });

	});

	test('Test compare and delete workspace folder configuration', () => {
		const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		testObject.updateFolderConfiguration(URI.file('file1'), toConfigurationModel({
			'editor.lineNumbers': 'off',
			'editor.fontSize': 12,
			'[typescript]': {
				'editor.wordWrap': 'off'
			}
		}));

		const actual = testObject.compareAndDeleteFolderConfiguration(URI.file('file1'));

		assert.deepStrictEqual(actual, { keys: ['editor.lineNumbers', 'editor.fontSize', '[typescript]'], overrides: [['typescript', ['editor.wordWrap']]] });

	});

	function parseConfigurationModel(content: any): ConfigurationModel {
		const parser = new ConfigurationModelParser('test');
		parser.parse(JSON.stringify(content));
		return parser.configurationModel;
	}

});

suite('ConfigurationChangeEvent', () => {

	test('changeEvent affecting keys with new configuration', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		const change = configuration.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
			'window.zoomLevel': 1,
			'workbench.editor.enablePreview': false,
			'files.autoSave': 'off',
		}));
		let testObject = new ConfigurationChangeEvent(change, undefined, configuration);

		assert.deepStrictEqual(testObject.affectedKeys, ['window.zoomLevel', 'workbench.editor.enablePreview', 'files.autoSave']);

		assert.ok(testObject.affectsConfiguration('window.zoomLevel'));
		assert.ok(testObject.affectsConfiguration('window'));

		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'));
		assert.ok(testObject.affectsConfiguration('workbench.editor'));
		assert.ok(testObject.affectsConfiguration('workbench'));

		assert.ok(testObject.affectsConfiguration('files'));
		assert.ok(testObject.affectsConfiguration('files.autoSave'));
		assert.ok(!testObject.affectsConfiguration('files.exclude'));

		assert.ok(!testObject.affectsConfiguration('[markdown]'));
		assert.ok(!testObject.affectsConfiguration('editor'));
	});

	test('changeEvent affecting keys when configuration changed', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		configuration.updateLocalUserConfiguration(toConfigurationModel({
			'window.zoomLevel': 2,
			'workbench.editor.enablePreview': true,
			'files.autoSave': 'off',
		}));
		const data = configuration.toData();
		const change = configuration.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
			'window.zoomLevel': 1,
			'workbench.editor.enablePreview': false,
			'files.autoSave': 'off',
		}));
		let testObject = new ConfigurationChangeEvent(change, { data }, configuration);

		assert.deepStrictEqual(testObject.affectedKeys, ['window.zoomLevel', 'workbench.editor.enablePreview']);

		assert.ok(testObject.affectsConfiguration('window.zoomLevel'));
		assert.ok(testObject.affectsConfiguration('window'));

		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'));
		assert.ok(testObject.affectsConfiguration('workbench.editor'));
		assert.ok(testObject.affectsConfiguration('workbench'));

		assert.ok(!testObject.affectsConfiguration('files'));
		assert.ok(!testObject.affectsConfiguration('[markdown]'));
		assert.ok(!testObject.affectsConfiguration('editor'));
	});

	test('changeEvent affecting overrides with new configuration', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		const change = configuration.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
			'files.autoSave': 'off',
			'[markdown]': {
				'editor.wordWrap': 'off'
			}
		}));
		let testObject = new ConfigurationChangeEvent(change, undefined, configuration);

		assert.deepStrictEqual(testObject.affectedKeys, ['files.autoSave', '[markdown]', 'editor.wordWrap']);

		assert.ok(testObject.affectsConfiguration('files'));
		assert.ok(testObject.affectsConfiguration('files.autoSave'));
		assert.ok(!testObject.affectsConfiguration('files.exclude'));

		assert.ok(testObject.affectsConfiguration('[markdown]'));
		assert.ok(!testObject.affectsConfiguration('[markdown].editor'));
		assert.ok(!testObject.affectsConfiguration('[markdown].workbench'));

		assert.ok(testObject.affectsConfiguration('editor'));
		assert.ok(testObject.affectsConfiguration('editor.wordWrap'));
		assert.ok(testObject.affectsConfiguration('editor', { overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor.wordWrap', { overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor', { overrideIdentifier: 'json' }));
		assert.ok(!testObject.affectsConfiguration('editor.fontSize', { overrideIdentifier: 'markdown' }));

		assert.ok(!testObject.affectsConfiguration('editor.fontSize'));
		assert.ok(!testObject.affectsConfiguration('window'));
	});

	test('changeEvent affecting overrides when configuration changed', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		configuration.updateLocalUserConfiguration(toConfigurationModel({
			'workbench.editor.enablePreview': true,
			'[markdown]': {
				'editor.fontSize': 12,
				'editor.wordWrap': 'off'
			},
			'files.autoSave': 'off',
		}));
		const data = configuration.toData();
		const change = configuration.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
			'files.autoSave': 'off',
			'[markdown]': {
				'editor.fontSize': 13,
				'editor.wordWrap': 'off'
			},
			'window.zoomLevel': 1,
		}));
		let testObject = new ConfigurationChangeEvent(change, { data }, configuration);

		assert.deepStrictEqual(testObject.affectedKeys, ['window.zoomLevel', '[markdown]', 'workbench.editor.enablePreview', 'editor.fontSize']);

		assert.ok(!testObject.affectsConfiguration('files'));

		assert.ok(testObject.affectsConfiguration('[markdown]'));
		assert.ok(!testObject.affectsConfiguration('[markdown].editor'));
		assert.ok(!testObject.affectsConfiguration('[markdown].editor.fontSize'));
		assert.ok(!testObject.affectsConfiguration('[markdown].editor.wordWrap'));
		assert.ok(!testObject.affectsConfiguration('[markdown].workbench'));

		assert.ok(testObject.affectsConfiguration('editor'));
		assert.ok(testObject.affectsConfiguration('editor', { overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor.fontSize', { overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap'));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor', { overrideIdentifier: 'json' }));
		assert.ok(!testObject.affectsConfiguration('editor.fontSize', { overrideIdentifier: 'json' }));

		assert.ok(testObject.affectsConfiguration('window'));
		assert.ok(testObject.affectsConfiguration('window.zoomLevel'));
		assert.ok(testObject.affectsConfiguration('window', { overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('window.zoomLevel', { overrideIdentifier: 'markdown' }));

		assert.ok(testObject.affectsConfiguration('workbench'));
		assert.ok(testObject.affectsConfiguration('workbench.editor'));
		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'));
		assert.ok(testObject.affectsConfiguration('workbench', { overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('workbench.editor', { overrideIdentifier: 'markdown' }));
	});

	test('changeEvent affecting workspace folders', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		configuration.updateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'custom' }));
		configuration.updateFolderConfiguration(URI.file('folder1'), toConfigurationModel({ 'window.zoomLevel': 2, 'window.restoreFullscreen': true }));
		configuration.updateFolderConfiguration(URI.file('folder2'), toConfigurationModel({ 'workbench.editor.enablePreview': true, 'window.restoreWindows': true }));
		const data = configuration.toData();
		const workspace = new Workspace('a', [new WorkspaceFolder({ index: 0, name: 'a', uri: URI.file('folder1') }), new WorkspaceFolder({ index: 1, name: 'b', uri: URI.file('folder2') }), new WorkspaceFolder({ index: 2, name: 'c', uri: URI.file('folder3') })]);
		const change = mergeChanges(
			configuration.compareAndUpdateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'native' })),
			configuration.compareAndUpdateFolderConfiguration(URI.file('folder1'), toConfigurationModel({ 'window.zoomLevel': 1, 'window.restoreFullscreen': false })),
			configuration.compareAndUpdateFolderConfiguration(URI.file('folder2'), toConfigurationModel({ 'workbench.editor.enablePreview': false, 'window.restoreWindows': false }))
		);
		let testObject = new ConfigurationChangeEvent(change, { data, workspace }, configuration, workspace);

		assert.deepStrictEqual(testObject.affectedKeys, ['window.title', 'window.zoomLevel', 'window.restoreFullscreen', 'workbench.editor.enablePreview', 'window.restoreWindows']);

		assert.ok(testObject.affectsConfiguration('window.zoomLevel'));
		assert.ok(testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('folder1') }));
		assert.ok(testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(!testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file(join('folder3', 'file3')) }));

		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen'));
		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('folder1') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file(join('folder3', 'file3')) }));

		assert.ok(testObject.affectsConfiguration('window.restoreWindows'));
		assert.ok(testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file('folder2') }));
		assert.ok(testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(!testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file(join('folder3', 'file3')) }));

		assert.ok(testObject.affectsConfiguration('window.title'));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('folder1') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('folder2') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('folder3') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file(join('folder3', 'file3')) }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file2') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file3') }));

		assert.ok(testObject.affectsConfiguration('window'));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('folder1') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('folder2') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('folder3') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file(join('folder3', 'file3')) }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file2') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file3') }));

		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'));
		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('folder2') }));
		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('folder1') }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('folder3') }));

		assert.ok(testObject.affectsConfiguration('workbench.editor'));
		assert.ok(testObject.affectsConfiguration('workbench.editor', { resource: URI.file('folder2') }));
		assert.ok(testObject.affectsConfiguration('workbench.editor', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor', { resource: URI.file('folder1') }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor', { resource: URI.file('folder3') }));

		assert.ok(testObject.affectsConfiguration('workbench'));
		assert.ok(testObject.affectsConfiguration('workbench', { resource: URI.file('folder2') }));
		assert.ok(testObject.affectsConfiguration('workbench', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('workbench', { resource: URI.file('folder1') }));
		assert.ok(!testObject.affectsConfiguration('workbench', { resource: URI.file('folder3') }));

		assert.ok(!testObject.affectsConfiguration('files'));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('folder1') }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file(join('folder1', 'file1')) }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('folder2') }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file(join('folder2', 'file2')) }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('folder3') }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file(join('folder3', 'file3')) }));
	});

	test('changeEvent - all', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		configuration.updateFolderConfiguration(URI.file('file1'), toConfigurationModel({ 'window.zoomLevel': 2, 'window.restoreFullscreen': true }));
		const data = configuration.toData();
		const change = mergeChanges(
			configuration.compareAndUpdateDefaultConfiguration(toConfigurationModel({
				'editor.lineNumbers': 'off',
				'[markdown]': {
					'editor.wordWrap': 'off'
				}
			}), ['editor.lineNumbers', '[markdown]']),
			configuration.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
				'[json]': {
					'editor.lineNumbers': 'relative'
				}
			})),
			configuration.compareAndUpdateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'custom' })),
			configuration.compareAndDeleteFolderConfiguration(URI.file('file1')),
			configuration.compareAndUpdateFolderConfiguration(URI.file('file2'), toConfigurationModel({ 'workbench.editor.enablePreview': true, 'window.restoreWindows': true })));
		const workspace = new Workspace('a', [new WorkspaceFolder({ index: 0, name: 'a', uri: URI.file('file1') }), new WorkspaceFolder({ index: 1, name: 'b', uri: URI.file('file2') }), new WorkspaceFolder({ index: 2, name: 'c', uri: URI.file('folder3') })]);
		const testObject = new ConfigurationChangeEvent(change, { data, workspace }, configuration, workspace);

		assert.deepStrictEqual(testObject.affectedKeys, ['editor.lineNumbers', '[markdown]', '[json]', 'window.title', 'window.zoomLevel', 'window.restoreFullscreen', 'workbench.editor.enablePreview', 'window.restoreWindows', 'editor.wordWrap']);

		assert.ok(testObject.affectsConfiguration('window.title'));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window'));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window.zoomLevel'));
		assert.ok(testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen'));
		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window.restoreWindows'));
		assert.ok(testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file('file1') }));

		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'));
		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('file1') }));

		assert.ok(testObject.affectsConfiguration('workbench.editor'));
		assert.ok(testObject.affectsConfiguration('workbench.editor', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor', { resource: URI.file('file1') }));

		assert.ok(testObject.affectsConfiguration('workbench'));
		assert.ok(testObject.affectsConfiguration('workbench', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('workbench', { resource: URI.file('file1') }));

		assert.ok(!testObject.affectsConfiguration('files'));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('editor'));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2') }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1'), overrideIdentifier: 'typescript' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2'), overrideIdentifier: 'typescript' }));

		assert.ok(testObject.affectsConfiguration('editor.lineNumbers'));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2') }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1'), overrideIdentifier: 'typescript' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2'), overrideIdentifier: 'typescript' }));

		assert.ok(testObject.affectsConfiguration('editor.wordWrap'));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1'), overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1'), overrideIdentifier: 'typescript' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2'), overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2'), overrideIdentifier: 'typescript' }));

		assert.ok(!testObject.affectsConfiguration('editor.fontSize'));
		assert.ok(!testObject.affectsConfiguration('editor.fontSize', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('editor.fontSize', { resource: URI.file('file2') }));
	});

	test('changeEvent affecting tasks and launches', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		const change = configuration.compareAndUpdateLocalUserConfiguration(toConfigurationModel({
			'launch': {
				'configuraiton': {}
			},
			'launch.version': 1,
			'tasks': {
				'version': 2
			}
		}));
		let testObject = new ConfigurationChangeEvent(change, undefined, configuration);

		assert.deepStrictEqual(testObject.affectedKeys, ['launch', 'launch.version', 'tasks']);
		assert.ok(testObject.affectsConfiguration('launch'));
		assert.ok(testObject.affectsConfiguration('launch.version'));
		assert.ok(testObject.affectsConfiguration('tasks'));
	});

});

suite('AllKeysConfigurationChangeEvent', () => {

	test('changeEvent', () => {
		const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel());
		configuration.updateDefaultConfiguration(toConfigurationModel({
			'editor.lineNumbers': 'off',
			'[markdown]': {
				'editor.wordWrap': 'off'
			}
		}));
		configuration.updateLocalUserConfiguration(toConfigurationModel({
			'[json]': {
				'editor.lineNumbers': 'relative'
			}
		}));
		configuration.updateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'custom' }));
		configuration.updateFolderConfiguration(URI.file('file1'), toConfigurationModel({ 'window.zoomLevel': 2, 'window.restoreFullscreen': true }));
		configuration.updateFolderConfiguration(URI.file('file2'), toConfigurationModel({ 'workbench.editor.enablePreview': true, 'window.restoreWindows': true }));
		const workspace = new Workspace('a', [new WorkspaceFolder({ index: 0, name: 'a', uri: URI.file('file1') }), new WorkspaceFolder({ index: 1, name: 'b', uri: URI.file('file2') }), new WorkspaceFolder({ index: 2, name: 'c', uri: URI.file('folder3') })]);
		let testObject = new AllKeysConfigurationChangeEvent(configuration, workspace, ConfigurationTarget.USER, null);

		assert.deepStrictEqual(testObject.affectedKeys, ['editor.lineNumbers', '[markdown]', '[json]', 'window.title', 'window.zoomLevel', 'window.restoreFullscreen', 'workbench.editor.enablePreview', 'window.restoreWindows']);

		assert.ok(testObject.affectsConfiguration('window.title'));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('window.title', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window'));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('window', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window.zoomLevel'));
		assert.ok(testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('window.zoomLevel', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen'));
		assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('window.restoreWindows'));
		assert.ok(testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('window.restoreWindows', { resource: URI.file('file1') }));

		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'));
		assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', { resource: URI.file('file1') }));

		assert.ok(testObject.affectsConfiguration('workbench.editor'));
		assert.ok(testObject.affectsConfiguration('workbench.editor', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('workbench.editor', { resource: URI.file('file1') }));

		assert.ok(testObject.affectsConfiguration('workbench'));
		assert.ok(testObject.affectsConfiguration('workbench', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('workbench', { resource: URI.file('file1') }));

		assert.ok(!testObject.affectsConfiguration('files'));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('files', { resource: URI.file('file2') }));

		assert.ok(testObject.affectsConfiguration('editor'));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2') }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file1'), overrideIdentifier: 'typescript' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor', { resource: URI.file('file2'), overrideIdentifier: 'typescript' }));

		assert.ok(testObject.affectsConfiguration('editor.lineNumbers'));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1') }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2') }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file1'), overrideIdentifier: 'typescript' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2'), overrideIdentifier: 'json' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2'), overrideIdentifier: 'markdown' }));
		assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { resource: URI.file('file2'), overrideIdentifier: 'typescript' }));

		assert.ok(!testObject.affectsConfiguration('editor.wordWrap'));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2') }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1'), overrideIdentifier: 'json' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1'), overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file1'), overrideIdentifier: 'typescript' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2'), overrideIdentifier: 'json' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2'), overrideIdentifier: 'markdown' }));
		assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { resource: URI.file('file2'), overrideIdentifier: 'typescript' }));

		assert.ok(!testObject.affectsConfiguration('editor.fontSize'));
		assert.ok(!testObject.affectsConfiguration('editor.fontSize', { resource: URI.file('file1') }));
		assert.ok(!testObject.affectsConfiguration('editor.fontSize', { resource: URI.file('file2') }));
	});
});

function toConfigurationModel(obj: any): ConfigurationModel {
	const parser = new ConfigurationModelParser('test');
	parser.parse(JSON.stringify(obj));
	return parser.configurationModel;
}
