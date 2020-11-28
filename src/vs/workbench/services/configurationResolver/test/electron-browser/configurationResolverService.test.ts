/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { normalize } from 'vs/base/common/path';
import { Emitter, Event } from 'vs/base/common/event';
import { URI as uri } from 'vs/base/common/uri';
import * as platform from 'vs/base/common/platform';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { BaseConfigurationResolverService } from 'vs/workbench/services/configurationResolver/browser/configurationResolverService';
import { Workspace, IWorkspaceFolder, IWorkspace } from 'vs/platform/workspace/common/workspace';
import { TestEditorService, TestProductService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestWorkbenchConfiguration } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IQuickInputService, IQuickPickItem, QuickPickInput, IPickOptions, Omit, IInputOptions, IQuickInputButton, IQuickPick, IInputBox, IQuickNavigateConfiguration } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import * as Types from 'vs/base/common/types';
import { EditorType } from 'vs/editor/common/editorCommon';
import { Selection } from 'vs/editor/common/core/selection';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { testWorkspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { IFormatterChangeEvent, ILabelService, ResourceLabelFormatter } from 'vs/platform/label/common/label';
import { IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';

const mockLineNumber = 10;
class TestEditorServiceWithActiveEditor extends TestEditorService {
	get activeTextEditorControl(): any {
		return {
			getEditorType() {
				return EditorType.ICodeEditor;
			},
			getSelection() {
				return new Selection(mockLineNumber, 1, mockLineNumber, 10);
			}
		};
	}
	get activeEditor(): any {
		return {
			get resource(): any {
				return uri.parse('file:///VSCode/workspaceLocation/file');
			}
		};
	}
}

class TestConfigurationResolverService extends BaseConfigurationResolverService {

}

suite('Configuration Resolver Service', () => {
	let configurationResolverService: IConfigurationResolverService | null;
	let envVariables: { [key: string]: string } = { key1: 'Value for key1', key2: 'Value for key2' };
	let environmentService: MockWorkbenchEnvironmentService;
	let mockCommandService: MockCommandService;
	let editorService: TestEditorServiceWithActiveEditor;
	let containingWorkspace: Workspace;
	let workspace: IWorkspaceFolder;
	let quickInputService: MockQuickInputService;
	let labelService: MockLabelService;

	setup(() => {
		mockCommandService = new MockCommandService();
		editorService = new TestEditorServiceWithActiveEditor();
		quickInputService = new MockQuickInputService();
		environmentService = new MockWorkbenchEnvironmentService(envVariables);
		labelService = new MockLabelService();
		containingWorkspace = testWorkspace(uri.parse('file:///VSCode/workspaceLocation'));
		workspace = containingWorkspace.folders[0];
		configurationResolverService = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, editorService, new MockInputsConfigurationService(), mockCommandService, new TestContextService(containingWorkspace), quickInputService, labelService);
	});

	teardown(() => {
		configurationResolverService = null;
	});

	test('substitute one', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder} xyz'), 'abc \\VSCode\\workspaceLocation xyz');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder} xyz'), 'abc /VSCode/workspaceLocation xyz');
		}
	});

	test('workspace folder with argument', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder:workspaceLocation} xyz'), 'abc \\VSCode\\workspaceLocation xyz');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder:workspaceLocation} xyz'), 'abc /VSCode/workspaceLocation xyz');
		}
	});

	test('workspace folder with invalid argument', () => {
		assert.throws(() => configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder:invalidLocation} xyz'));
	});

	test('workspace folder with undefined workspace folder', () => {
		assert.throws(() => configurationResolverService!.resolve(undefined, 'abc ${workspaceFolder} xyz'));
	});

	test('workspace folder with argument and undefined workspace folder', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(undefined, 'abc ${workspaceFolder:workspaceLocation} xyz'), 'abc \\VSCode\\workspaceLocation xyz');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(undefined, 'abc ${workspaceFolder:workspaceLocation} xyz'), 'abc /VSCode/workspaceLocation xyz');
		}
	});

	test('workspace folder with invalid argument and undefined workspace folder', () => {
		assert.throws(() => configurationResolverService!.resolve(undefined, 'abc ${workspaceFolder:invalidLocation} xyz'));
	});

	test('workspace root folder name', () => {
		assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceRootFolderName} xyz'), 'abc workspaceLocation xyz');
	});

	test('current selected line number', () => {
		assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${lineNumber} xyz'), `abc ${mockLineNumber} xyz`);
	});

	test('relative file', () => {
		assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${relativeFile} xyz'), 'abc file xyz');
	});

	test('relative file with argument', () => {
		assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${relativeFile:workspaceLocation} xyz'), 'abc file xyz');
	});

	test('relative file with invalid argument', () => {
		assert.throws(() => configurationResolverService!.resolve(workspace, 'abc ${relativeFile:invalidLocation} xyz'));
	});

	test('relative file with undefined workspace folder', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(undefined, 'abc ${relativeFile} xyz'), 'abc \\VSCode\\workspaceLocation\\file xyz');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(undefined, 'abc ${relativeFile} xyz'), 'abc /VSCode/workspaceLocation/file xyz');
		}
	});

	test('relative file with argument and undefined workspace folder', () => {
		assert.strictEqual(configurationResolverService!.resolve(undefined, 'abc ${relativeFile:workspaceLocation} xyz'), 'abc file xyz');
	});

	test('relative file with invalid argument and undefined workspace folder', () => {
		assert.throws(() => configurationResolverService!.resolve(undefined, 'abc ${relativeFile:invalidLocation} xyz'));
	});

	test('substitute many', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(workspace, '${workspaceFolder} - ${workspaceFolder}'), '\\VSCode\\workspaceLocation - \\VSCode\\workspaceLocation');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(workspace, '${workspaceFolder} - ${workspaceFolder}'), '/VSCode/workspaceLocation - /VSCode/workspaceLocation');
		}
	});

	test('substitute one env variable', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder} ${env:key1} xyz'), 'abc \\VSCode\\workspaceLocation Value for key1 xyz');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(workspace, 'abc ${workspaceFolder} ${env:key1} xyz'), 'abc /VSCode/workspaceLocation Value for key1 xyz');
		}
	});

	test('substitute many env variable', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(workspace, '${workspaceFolder} - ${workspaceFolder} ${env:key1} - ${env:key2}'), '\\VSCode\\workspaceLocation - \\VSCode\\workspaceLocation Value for key1 - Value for key2');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(workspace, '${workspaceFolder} - ${workspaceFolder} ${env:key1} - ${env:key2}'), '/VSCode/workspaceLocation - /VSCode/workspaceLocation Value for key1 - Value for key2');
		}
	});

	test('disallows nested keys (#77289)', () => {
		assert.strictEqual(configurationResolverService!.resolve(workspace, '${env:key1} ${env:key1${env:key2}}'), 'Value for key1 ${env:key1${env:key2}}');
	});

	// test('substitute keys and values in object', () => {
	// 	const myObject = {
	// 		'${workspaceRootFolderName}': '${lineNumber}',
	// 		'hey ${env:key1} ': '${workspaceRootFolderName}'
	// 	};
	// 	assert.deepEqual(configurationResolverService!.resolve(workspace, myObject), {
	// 		'workspaceLocation': `${editorService.mockLineNumber}`,
	// 		'hey Value for key1 ': 'workspaceLocation'
	// 	});
	// });


	test('substitute one env variable using platform case sensitivity', () => {
		if (platform.isWindows) {
			assert.strictEqual(configurationResolverService!.resolve(workspace, '${env:key1} - ${env:Key1}'), 'Value for key1 - Value for key1');
		} else {
			assert.strictEqual(configurationResolverService!.resolve(workspace, '${env:key1} - ${env:Key1}'), 'Value for key1 - ');
		}
	});

	test('substitute one configuration variable', () => {
		let configurationService: IConfigurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo'
			},
			terminal: {
				integrated: {
					fontFamily: 'bar'
				}
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		assert.strictEqual(service.resolve(workspace, 'abc ${config:editor.fontFamily} xyz'), 'abc foo xyz');
	});

	test('substitute configuration variable with undefined workspace folder', () => {
		let configurationService: IConfigurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo'
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		assert.strictEqual(service.resolve(undefined, 'abc ${config:editor.fontFamily} xyz'), 'abc foo xyz');
	});

	test('substitute many configuration variables', () => {
		let configurationService: IConfigurationService;
		configurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo'
			},
			terminal: {
				integrated: {
					fontFamily: 'bar'
				}
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		assert.strictEqual(service.resolve(workspace, 'abc ${config:editor.fontFamily} ${config:terminal.integrated.fontFamily} xyz'), 'abc foo bar xyz');
	});

	test('substitute one env variable and a configuration variable', () => {
		let configurationService: IConfigurationService;
		configurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo'
			},
			terminal: {
				integrated: {
					fontFamily: 'bar'
				}
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		if (platform.isWindows) {
			assert.strictEqual(service.resolve(workspace, 'abc ${config:editor.fontFamily} ${workspaceFolder} ${env:key1} xyz'), 'abc foo \\VSCode\\workspaceLocation Value for key1 xyz');
		} else {
			assert.strictEqual(service.resolve(workspace, 'abc ${config:editor.fontFamily} ${workspaceFolder} ${env:key1} xyz'), 'abc foo /VSCode/workspaceLocation Value for key1 xyz');
		}
	});

	test('substitute many env variable and a configuration variable', () => {
		let configurationService: IConfigurationService;
		configurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo'
			},
			terminal: {
				integrated: {
					fontFamily: 'bar'
				}
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		if (platform.isWindows) {
			assert.strictEqual(service.resolve(workspace, '${config:editor.fontFamily} ${config:terminal.integrated.fontFamily} ${workspaceFolder} - ${workspaceFolder} ${env:key1} - ${env:key2}'), 'foo bar \\VSCode\\workspaceLocation - \\VSCode\\workspaceLocation Value for key1 - Value for key2');
		} else {
			assert.strictEqual(service.resolve(workspace, '${config:editor.fontFamily} ${config:terminal.integrated.fontFamily} ${workspaceFolder} - ${workspaceFolder} ${env:key1} - ${env:key2}'), 'foo bar /VSCode/workspaceLocation - /VSCode/workspaceLocation Value for key1 - Value for key2');
		}
	});

	test('mixed types of configuration variables', () => {
		let configurationService: IConfigurationService;
		configurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo',
				lineNumbers: 123,
				insertSpaces: false
			},
			terminal: {
				integrated: {
					fontFamily: 'bar'
				}
			},
			json: {
				schemas: [
					{
						fileMatch: [
							'/myfile',
							'/myOtherfile'
						],
						url: 'schemaURL'
					}
				]
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		assert.strictEqual(service.resolve(workspace, 'abc ${config:editor.fontFamily} ${config:editor.lineNumbers} ${config:editor.insertSpaces} xyz'), 'abc foo 123 false xyz');
	});

	test('uses original variable as fallback', () => {
		let configurationService: IConfigurationService;
		configurationService = new TestConfigurationService({
			editor: {}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);
		assert.strictEqual(service.resolve(workspace, 'abc ${unknownVariable} xyz'), 'abc ${unknownVariable} xyz');
		assert.strictEqual(service.resolve(workspace, 'abc ${env:unknownVariable} xyz'), 'abc  xyz');
	});

	test('configuration variables with invalid accessor', () => {
		let configurationService: IConfigurationService;
		configurationService = new TestConfigurationService({
			editor: {
				fontFamily: 'foo'
			}
		});

		let service = new TestConfigurationResolverService({ getExecPath: () => undefined }, environmentService.userEnv, new TestEditorServiceWithActiveEditor(), configurationService, mockCommandService, new TestContextService(), quickInputService, labelService);

		assert.throws(() => service.resolve(workspace, 'abc ${env} xyz'));
		assert.throws(() => service.resolve(workspace, 'abc ${env:} xyz'));
		assert.throws(() => service.resolve(workspace, 'abc ${config} xyz'));
		assert.throws(() => service.resolve(workspace, 'abc ${config:} xyz'));
		assert.throws(() => service.resolve(workspace, 'abc ${config:editor} xyz'));
		assert.throws(() => service.resolve(workspace, 'abc ${config:editor..fontFamily} xyz'));
		assert.throws(() => service.resolve(workspace, 'abc ${config:editor.none.none2} xyz'));
	});

	test('a single command variable', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${command:command1}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};

		return configurationResolverService!.resolveWithInteractionReplace(undefined, configuration).then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'command1-result',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(1, mockCommandService.callCount);
		});
	});

	test('an old style command variable', () => {
		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${command:commandVariable1}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};
		const commandVariables = Object.create(null);
		commandVariables['commandVariable1'] = 'command1';

		return configurationResolverService!.resolveWithInteractionReplace(undefined, configuration, undefined, commandVariables).then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'command1-result',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(1, mockCommandService.callCount);
		});
	});

	test('multiple new and old-style command variables', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${command:commandVariable1}',
			'pid': '${command:command2}',
			'sourceMaps': false,
			'outDir': 'src/${command:command2}',
			'env': {
				'processId': '__${command:command2}__',
			}
		};
		const commandVariables = Object.create(null);
		commandVariables['commandVariable1'] = 'command1';

		return configurationResolverService!.resolveWithInteractionReplace(undefined, configuration, undefined, commandVariables).then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'command1-result',
				'pid': 'command2-result',
				'sourceMaps': false,
				'outDir': 'src/command2-result',
				'env': {
					'processId': '__command2-result__',
				}
			});

			assert.equal(2, mockCommandService.callCount);
		});
	});

	test('a command variable that relies on resolved env vars', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${command:commandVariable1}',
			'value': '${env:key1}'
		};
		const commandVariables = Object.create(null);
		commandVariables['commandVariable1'] = 'command1';

		return configurationResolverService!.resolveWithInteractionReplace(undefined, configuration, undefined, commandVariables).then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'Value for key1',
				'value': 'Value for key1'
			});

			assert.equal(1, mockCommandService.callCount);
		});
	});

	test('a single prompt input variable', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${input:input1}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};

		return configurationResolverService!.resolveWithInteractionReplace(workspace, configuration, 'tasks').then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'resolvedEnterinput1',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(0, mockCommandService.callCount);
		});
	});

	test('a single pick input variable', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${input:input2}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};

		return configurationResolverService!.resolveWithInteractionReplace(workspace, configuration, 'tasks').then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'selectedPick',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(0, mockCommandService.callCount);
		});
	});

	test('a single command input variable', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${input:input4}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};

		return configurationResolverService!.resolveWithInteractionReplace(workspace, configuration, 'tasks').then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'arg for command',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(1, mockCommandService.callCount);
		});
	});

	test('several input variables and command', () => {

		const configuration = {
			'name': '${input:input3}',
			'type': '${command:command1}',
			'request': '${input:input1}',
			'processId': '${input:input2}',
			'command': '${input:input4}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};

		return configurationResolverService!.resolveWithInteractionReplace(workspace, configuration, 'tasks').then(result => {

			assert.deepEqual(result, {
				'name': 'resolvedEnterinput3',
				'type': 'command1-result',
				'request': 'resolvedEnterinput1',
				'processId': 'selectedPick',
				'command': 'arg for command',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(2, mockCommandService.callCount);
		});
	});

	test('input variable with undefined workspace folder', () => {

		const configuration = {
			'name': 'Attach to Process',
			'type': 'node',
			'request': 'attach',
			'processId': '${input:input1}',
			'port': 5858,
			'sourceMaps': false,
			'outDir': null
		};

		return configurationResolverService!.resolveWithInteractionReplace(undefined, configuration, 'tasks').then(result => {

			assert.deepEqual(result, {
				'name': 'Attach to Process',
				'type': 'node',
				'request': 'attach',
				'processId': 'resolvedEnterinput1',
				'port': 5858,
				'sourceMaps': false,
				'outDir': null
			});

			assert.equal(0, mockCommandService.callCount);
		});
	});

	test('contributed variable', () => {
		const buildTask = 'npm: compile';
		const variable = 'defaultBuildTask';
		const configuration = {
			'name': '${' + variable + '}',
		};
		configurationResolverService!.contributeVariable(variable, async () => { return buildTask; });
		return configurationResolverService!.resolveWithInteractionReplace(workspace, configuration).then(result => {
			assert.deepEqual(result, {
				'name': `${buildTask}`
			});
		});
	});
});


class MockCommandService implements ICommandService {

	public _serviceBrand: undefined;
	public callCount = 0;

	onWillExecuteCommand = () => Disposable.None;
	onDidExecuteCommand = () => Disposable.None;
	public executeCommand(commandId: string, ...args: any[]): Promise<any> {
		this.callCount++;

		let result = `${commandId}-result`;
		if (args.length >= 1) {
			if (args[0] && args[0].value) {
				result = args[0].value;
			}
		}

		return Promise.resolve(result);
	}
}

class MockQuickInputService implements IQuickInputService {
	declare readonly _serviceBrand: undefined;

	readonly onShow = Event.None;
	readonly onHide = Event.None;

	readonly quickAccess = undefined!;

	public pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: true }, token?: CancellationToken): Promise<T[]>;
	public pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: false }, token?: CancellationToken): Promise<T>;
	public pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: Omit<IPickOptions<T>, 'canPickMany'>, token?: CancellationToken): Promise<T | undefined> {
		if (Types.isArray(picks)) {
			return Promise.resolve(<any>{ label: 'selectedPick', description: 'pick description', value: 'selectedPick' });
		} else {
			return Promise.resolve(undefined);
		}
	}

	public input(options?: IInputOptions, token?: CancellationToken): Promise<string> {
		return Promise.resolve(options ? 'resolved' + options.prompt : 'resolved');
	}

	backButton!: IQuickInputButton;

	createQuickPick<T extends IQuickPickItem>(): IQuickPick<T> {
		throw new Error('not implemented.');
	}

	createInputBox(): IInputBox {
		throw new Error('not implemented.');
	}

	focus(): void {
		throw new Error('not implemented.');
	}

	toggle(): void {
		throw new Error('not implemented.');
	}

	navigate(next: boolean, quickNavigate?: IQuickNavigateConfiguration): void {
		throw new Error('not implemented.');
	}

	accept(): Promise<void> {
		throw new Error('not implemented.');
	}

	back(): Promise<void> {
		throw new Error('not implemented.');
	}

	cancel(): Promise<void> {
		throw new Error('not implemented.');
	}
}

class MockLabelService implements ILabelService {
	_serviceBrand: undefined;
	getUriLabel(resource: uri, options?: { relative?: boolean | undefined; noPrefix?: boolean | undefined; endWithSeparator?: boolean | undefined; }): string {
		return normalize(resource.fsPath);
	}
	getUriBasenameLabel(resource: uri): string {
		throw new Error('Method not implemented.');
	}
	getWorkspaceLabel(workspace: uri | IWorkspaceIdentifier | IWorkspace, options?: { verbose: boolean; }): string {
		throw new Error('Method not implemented.');
	}
	getHostLabel(scheme: string, authority?: string): string {
		throw new Error('Method not implemented.');
	}
	getSeparator(scheme: string, authority?: string): '/' | '\\' {
		throw new Error('Method not implemented.');
	}
	registerFormatter(formatter: ResourceLabelFormatter): IDisposable {
		throw new Error('Method not implemented.');
	}
	onDidChangeFormatters: Event<IFormatterChangeEvent> = new Emitter<IFormatterChangeEvent>().event;
}

class MockInputsConfigurationService extends TestConfigurationService {
	public getValue(arg1?: any, arg2?: any): any {
		let configuration;
		if (arg1 === 'tasks') {
			configuration = {
				inputs: [
					{
						id: 'input1',
						type: 'promptString',
						description: 'Enterinput1',
						default: 'default input1'
					},
					{
						id: 'input2',
						type: 'pickString',
						description: 'Enterinput1',
						default: 'option2',
						options: ['option1', 'option2', 'option3']
					},
					{
						id: 'input3',
						type: 'promptString',
						description: 'Enterinput3',
						default: 'default input3',
						password: true
					},
					{
						id: 'input4',
						type: 'command',
						command: 'command1',
						args: {
							value: 'arg for command'
						}
					}
				]
			};
		}
		return configuration;
	}
}

class MockWorkbenchEnvironmentService extends NativeWorkbenchEnvironmentService {

	constructor(public userEnv: platform.IProcessEnvironment) {
		super({ ...TestWorkbenchConfiguration, userEnv }, TestProductService);
	}
}
