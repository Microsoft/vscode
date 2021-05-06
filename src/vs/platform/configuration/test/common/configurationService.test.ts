/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

import { Registry } from 'vs/platform/registry/common/platform';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { URI } from 'vs/base/common/uri';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { Event } from 'vs/base/common/event';
import { NullLogService } from 'vs/platform/log/common/log';
import { FileService } from 'vs/platform/files/common/fileService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';

suite('ConfigurationService', () => {

	let fileService: IFileService;
	let settingsResource: URI;
	const disposables: DisposableStore = new DisposableStore();

	setup(async () => {
		fileService = disposables.add(new FileService(new NullLogService()));
		const diskFileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);
		settingsResource = URI.file('settings.json');
	});

	teardown(() => disposables.clear());

	test('simple', async () => {
		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "foo": "bar" }'));
		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		await testObject.initialize();
		const config = testObject.getValue<{
			foo: string;
		}>();

		assert.ok(config);
		assert.strictEqual(config.foo, 'bar');
	});

	test('config gets flattened', async () => {
		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "testworkbench.editor.tabs": true }'));

		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		await testObject.initialize();
		const config = testObject.getValue<{
			testworkbench: {
				editor: {
					tabs: boolean;
				};
			};
		}>();

		assert.ok(config);
		assert.ok(config.testworkbench);
		assert.ok(config.testworkbench.editor);
		assert.strictEqual(config.testworkbench.editor.tabs, true);
	});

	test('error case does not explode', async () => {
		await fileService.writeFile(settingsResource, VSBuffer.fromString(',,,,'));

		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		await testObject.initialize();
		const config = testObject.getValue<{
			foo: string;
		}>();

		assert.ok(config);
	});

	test('missing file does not explode', async () => {
		const testObject = disposables.add(new ConfigurationService(URI.file('__testFile'), fileService));
		await testObject.initialize();

		const config = testObject.getValue<{ foo: string }>();

		assert.ok(config);
	});

	test('trigger configuration change event when file does not exist', async () => {
		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		await testObject.initialize();
		return new Promise<void>(async (c) => {
			disposables.add(Event.filter(testObject.onDidChangeConfiguration, e => e.source === ConfigurationTarget.USER)(() => {
				assert.strictEqual(testObject.getValue('foo'), 'bar');
				c();
			}));
			await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "foo": "bar" }'));
		});

	});

	test('trigger configuration change event when file exists', async () => {
		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "foo": "bar" }'));
		await testObject.initialize();

		return new Promise<void>((c) => {
			disposables.add(Event.filter(testObject.onDidChangeConfiguration, e => e.source === ConfigurationTarget.USER)(async (e) => {
				assert.strictEqual(testObject.getValue('foo'), 'barz');
				c();
			}));
			fileService.writeFile(settingsResource, VSBuffer.fromString('{ "foo": "barz" }'));
		});
	});

	test('reloadConfiguration', async () => {
		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "foo": "bar" }'));

		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		await testObject.initialize();
		let config = testObject.getValue<{
			foo: string;
		}>();
		assert.ok(config);
		assert.strictEqual(config.foo, 'bar');
		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "foo": "changed" }'));

		// force a reload to get latest
		await testObject.reloadConfiguration();
		config = testObject.getValue<{
			foo: string;
		}>();
		assert.ok(config);
		assert.strictEqual(config.foo, 'changed');
	});

	test('model defaults', async () => {
		interface ITestSetting {
			configuration: {
				service: {
					testSetting: string;
				}
			};
		}

		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'configuration.service.testSetting': {
					'type': 'string',
					'default': 'isSet'
				}
			}
		});

		let testObject = disposables.add(new ConfigurationService(URI.file('__testFile'), fileService));
		await testObject.initialize();
		let setting = testObject.getValue<ITestSetting>();

		assert.ok(setting);
		assert.strictEqual(setting.configuration.service.testSetting, 'isSet');

		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "testworkbench.editor.tabs": true }'));
		testObject = disposables.add(new ConfigurationService(settingsResource, fileService));

		setting = testObject.getValue<ITestSetting>();

		assert.ok(setting);
		assert.strictEqual(setting.configuration.service.testSetting, 'isSet');

		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "configuration.service.testSetting": "isChanged" }'));

		await testObject.reloadConfiguration();
		setting = testObject.getValue<ITestSetting>();
		assert.ok(setting);
		assert.strictEqual(setting.configuration.service.testSetting, 'isChanged');
	});

	test('lookup', async () => {
		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		configurationRegistry.registerConfiguration({
			'id': '_test',
			'type': 'object',
			'properties': {
				'lookup.service.testSetting': {
					'type': 'string',
					'default': 'isSet'
				}
			}
		});

		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		testObject.initialize();

		let res = testObject.inspect('something.missing');
		assert.strictEqual(res.value, undefined);
		assert.strictEqual(res.defaultValue, undefined);
		assert.strictEqual(res.userValue, undefined);

		res = testObject.inspect('lookup.service.testSetting');
		assert.strictEqual(res.defaultValue, 'isSet');
		assert.strictEqual(res.value, 'isSet');
		assert.strictEqual(res.userValue, undefined);

		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "lookup.service.testSetting": "bar" }'));

		await testObject.reloadConfiguration();
		res = testObject.inspect('lookup.service.testSetting');
		assert.strictEqual(res.defaultValue, 'isSet');
		assert.strictEqual(res.userValue, 'bar');
		assert.strictEqual(res.value, 'bar');

	});

	test('lookup with null', async () => {
		const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
		configurationRegistry.registerConfiguration({
			'id': '_testNull',
			'type': 'object',
			'properties': {
				'lookup.service.testNullSetting': {
					'type': 'null',
				}
			}
		});

		const testObject = disposables.add(new ConfigurationService(settingsResource, fileService));
		testObject.initialize();

		let res = testObject.inspect('lookup.service.testNullSetting');
		assert.strictEqual(res.defaultValue, null);
		assert.strictEqual(res.value, null);
		assert.strictEqual(res.userValue, undefined);

		await fileService.writeFile(settingsResource, VSBuffer.fromString('{ "lookup.service.testNullSetting": null }'));

		await testObject.reloadConfiguration();

		res = testObject.inspect('lookup.service.testNullSetting');
		assert.strictEqual(res.defaultValue, null);
		assert.strictEqual(res.value, null);
		assert.strictEqual(res.userValue, null);
	});
});
