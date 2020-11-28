/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { join, normalize } from 'vs/base/common/path';
import * as platform from 'vs/base/common/platform';
import { IDebugAdapterExecutable, IConfig, IDebugSession, IAdapterManager } from 'vs/workbench/contrib/debug/common/debug';
import { Debugger } from 'vs/workbench/contrib/debug/common/debugger';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { URI } from 'vs/base/common/uri';
import { ExecutableDebugAdapter } from 'vs/workbench/contrib/debug/node/debugAdapter';
import { TestTextResourcePropertiesService } from 'vs/editor/test/common/services/modelService.test';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';


suite('Debug - Debugger', () => {
	let _debugger: Debugger;

	const extensionFolderPath = '/a/b/c/';
	const debuggerContribution = {
		type: 'mock',
		label: 'Mock Debug',
		program: './out/mock/mockDebug.js',
		args: ['arg1', 'arg2'],
		configurationAttributes: {
			launch: {
				required: ['program'],
				properties: {
					program: {
						'type': 'string',
						'description': 'Workspace relative path to a text file.',
						'default': 'readme.md'
					}
				}
			}
		},
		variables: null!,
		initialConfigurations: [
			{
				name: 'Mock-Debug',
				type: 'mock',
				request: 'launch',
				program: 'readme.md'
			}
		]
	};

	const extensionDescriptor0 = <IExtensionDescription>{
		id: 'adapter',
		identifier: new ExtensionIdentifier('adapter'),
		name: 'myAdapter',
		version: '1.0.0',
		publisher: 'vscode',
		extensionLocation: URI.file(extensionFolderPath),
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		engines: null!,
		contributes: {
			'debuggers': [
				debuggerContribution
			]
		}
	};

	const extensionDescriptor1 = {
		id: 'extension1',
		identifier: new ExtensionIdentifier('extension1'),
		name: 'extension1',
		version: '1.0.0',
		publisher: 'vscode',
		extensionLocation: URI.file('/e1/b/c/'),
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		engines: null!,
		contributes: {
			'debuggers': [
				{
					type: 'mock',
					runtime: 'runtime',
					runtimeArgs: ['rarg'],
					program: 'mockprogram',
					args: ['parg']
				}
			]
		}
	};

	const extensionDescriptor2 = {
		id: 'extension2',
		identifier: new ExtensionIdentifier('extension2'),
		name: 'extension2',
		version: '1.0.0',
		publisher: 'vscode',
		extensionLocation: URI.file('/e2/b/c/'),
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		engines: null!,
		contributes: {
			'debuggers': [
				{
					type: 'mock',
					win: {
						runtime: 'winRuntime',
						program: 'winProgram'
					},
					linux: {
						runtime: 'linuxRuntime',
						program: 'linuxProgram'
					},
					osx: {
						runtime: 'osxRuntime',
						program: 'osxProgram'
					}
				}
			]
		}
	};


	const adapterManager = <IAdapterManager>{
		getDebugAdapterDescriptor(session: IDebugSession, config: IConfig): Promise<IDebugAdapterExecutable | undefined> {
			return Promise.resolve(undefined);
		}
	};

	const configurationService = new TestConfigurationService();
	const testResourcePropertiesService = new TestTextResourcePropertiesService(configurationService);

	setup(() => {
		_debugger = new Debugger(adapterManager, debuggerContribution, extensionDescriptor0, configurationService, testResourcePropertiesService, undefined!, undefined!, undefined!, undefined!);
	});

	teardown(() => {
		_debugger = null!;
	});

	test('attributes', () => {
		assert.equal(_debugger.type, debuggerContribution.type);
		assert.equal(_debugger.label, debuggerContribution.label);

		const ae = ExecutableDebugAdapter.platformAdapterExecutable([extensionDescriptor0], 'mock');

		assert.equal(ae!.command, join(extensionFolderPath, debuggerContribution.program));
		assert.deepEqual(ae!.args, debuggerContribution.args);
	});

	test('schema attributes', () => {
		const schemaAttribute = _debugger.getSchemaAttributes()![0];
		assert.notDeepEqual(schemaAttribute, debuggerContribution.configurationAttributes);
		Object.keys(debuggerContribution.configurationAttributes.launch).forEach(key => {
			assert.deepEqual((<any>schemaAttribute)[key], (<any>debuggerContribution.configurationAttributes.launch)[key]);
		});

		assert.equal(schemaAttribute['additionalProperties'], false);
		assert.equal(!!schemaAttribute['properties']!['request'], true);
		assert.equal(!!schemaAttribute['properties']!['name'], true);
		assert.equal(!!schemaAttribute['properties']!['type'], true);
		assert.equal(!!schemaAttribute['properties']!['preLaunchTask'], true);
	});

	test('merge platform specific attributes', () => {
		const ae = ExecutableDebugAdapter.platformAdapterExecutable([extensionDescriptor1, extensionDescriptor2], 'mock')!;
		assert.equal(ae.command, platform.isLinux ? 'linuxRuntime' : (platform.isMacintosh ? 'osxRuntime' : 'winRuntime'));
		const xprogram = platform.isLinux ? 'linuxProgram' : (platform.isMacintosh ? 'osxProgram' : 'winProgram');
		assert.deepEqual(ae.args, ['rarg', normalize('/e2/b/c/') + xprogram, 'parg']);
	});

	test('initial config file content', () => {

		const expected = ['{',
			'	// Use IntelliSense to learn about possible attributes.',
			'	// Hover to view descriptions of existing attributes.',
			'	// For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387',
			'	"version": "0.2.0",',
			'	"configurations": [',
			'		{',
			'			"name": "Mock-Debug",',
			'			"type": "mock",',
			'			"request": "launch",',
			'			"program": "readme.md"',
			'		}',
			'	]',
			'}'].join(testResourcePropertiesService.getEOL(URI.file('somefile')));

		return _debugger.getInitialConfigurationContent().then(content => {
			assert.equal(content, expected);
		}, err => assert.fail(err));
	});
});
