/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IConfigurationValue, IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { TextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationServiceImpl';
import { URI } from 'vs/base/common/uri';


suite('TextResourceConfigurationService - Update', () => {

	let configurationValue: IConfigurationValue<any> = {};
	let updateArgs: any[];
	let configurationService = new class extends TestConfigurationService {
		override inspect() {
			return configurationValue;
		}
		override updateValue() {
			updateArgs = [...arguments];
			return Promise.resolve();
		}
	}();
	let language: string | null = null;
	let testObject: TextResourceConfigurationService;

	setup(() => {
		const instantiationService = new TestInstantiationService();
		instantiationService.stub(IModelService, <Partial<IModelService>>{ getModel() { return null; } });
		instantiationService.stub(IModeService, <Partial<IModeService>>{ getModeIdByFilepathOrFirstLine() { return language; } });
		instantiationService.stub(IConfigurationService, configurationService);
		testObject = instantiationService.createInstance(TextResourceConfigurationService);
	});

	test('updateValue writes without target and overrides when no language is defined', async () => {
		const resource = URI.file('someFile');
		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue writes with target and without overrides when no language is defined', async () => {
		const resource = URI.file('someFile');
		await testObject.updateValue(resource, 'a', 'b', ConfigurationTarget.USER_LOCAL);
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue writes into given memory target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspaceFolder: { value: '1' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b', ConfigurationTarget.MEMORY);
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.MEMORY]);
	});

	test('updateValue writes into given workspace target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspaceFolder: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b', ConfigurationTarget.WORKSPACE);
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.WORKSPACE]);
	});

	test('updateValue writes into given user target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspaceFolder: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b', ConfigurationTarget.USER);
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.USER]);
	});

	test('updateValue writes into given workspace folder target with overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspaceFolder: { value: '2', override: '1' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b', ConfigurationTarget.WORKSPACE_FOLDER);
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.WORKSPACE_FOLDER]);
	});

	test('updateValue writes into derived workspace folder target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspaceFolder: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.WORKSPACE_FOLDER]);
	});

	test('updateValue writes into derived workspace folder target with overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspace: { value: '2', override: '1' },
			workspaceFolder: { value: '2', override: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.WORKSPACE_FOLDER]);
	});

	test('updateValue writes into derived workspace target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspace: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.WORKSPACE]);
	});

	test('updateValue writes into derived workspace target with overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			workspace: { value: '2', override: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.WORKSPACE]);
	});

	test('updateValue writes into derived workspace target with overrides and value defined in folder', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1', override: '3' },
			userLocal: { value: '2' },
			workspace: { value: '2', override: '2' },
			workspaceFolder: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.WORKSPACE]);
	});

	test('updateValue writes into derived user remote target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			userRemote: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.USER_REMOTE]);
	});

	test('updateValue writes into derived user remote target with overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			userRemote: { value: '2', override: '3' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_REMOTE]);
	});

	test('updateValue writes into derived user remote target with overrides and value defined in workspace', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
			userRemote: { value: '2', override: '3' },
			workspace: { value: '3' }
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_REMOTE]);
	});

	test('updateValue writes into derived user remote target with overrides and value defined in workspace folder', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2', override: '1' },
			userRemote: { value: '2', override: '3' },
			workspace: { value: '3' },
			workspaceFolder: { value: '3' }
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_REMOTE]);
	});

	test('updateValue writes into derived user target without overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue writes into derived user target with overrides', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2', override: '3' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', '2');
		assert.deepStrictEqual(updateArgs, ['a', '2', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue writes into derived user target with overrides and value is defined in remote', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2', override: '3' },
			userRemote: { value: '3' }
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', '2');
		assert.deepStrictEqual(updateArgs, ['a', '2', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue writes into derived user target with overrides and value is defined in workspace', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
			userLocal: { value: '2', override: '3' },
			workspaceValue: { value: '3' }
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', '2');
		assert.deepStrictEqual(updateArgs, ['a', '2', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue writes into derived user target with overrides and value is defined in workspace folder', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1', override: '3' },
			userLocal: { value: '2', override: '3' },
			userRemote: { value: '3' },
			workspaceFolderValue: { value: '3' }
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', '2');
		assert.deepStrictEqual(updateArgs, ['a', '2', { resource, overrideIdentifier: language }, ConfigurationTarget.USER_LOCAL]);
	});

	test('updateValue when not changed', async () => {
		language = 'a';
		configurationValue = {
			default: { value: '1' },
		};
		const resource = URI.file('someFile');

		await testObject.updateValue(resource, 'a', 'b');
		assert.deepStrictEqual(updateArgs, ['a', 'b', { resource }, ConfigurationTarget.USER_LOCAL]);
	});

});
