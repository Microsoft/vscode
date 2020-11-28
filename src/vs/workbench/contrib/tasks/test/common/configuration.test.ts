/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI } from 'vs/base/common/uri';
import * as assert from 'assert';
import Severity from 'vs/base/common/severity';
import * as UUID from 'vs/base/common/uuid';

import * as Platform from 'vs/base/common/platform';
import { ValidationStatus } from 'vs/base/common/parsers';
import { ProblemMatcher, FileLocationKind, ProblemPattern, ApplyToKind } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import { WorkspaceFolder, IWorkspace } from 'vs/platform/workspace/common/workspace';

import * as Tasks from 'vs/workbench/contrib/tasks/common/tasks';
import { parse, ParseResult, IProblemReporter, ExternalTaskRunnerConfiguration, CustomTask, TaskConfigSource } from 'vs/workbench/contrib/tasks/common/taskConfiguration';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { IContext } from 'vs/platform/contextkey/common/contextkey';
import { Workspace } from 'vs/platform/workspace/test/common/testWorkspace';

const workspaceFolder: WorkspaceFolder = new WorkspaceFolder({
	uri: URI.file('/workspace/folderOne'),
	name: 'folderOne',
	index: 0
});

const workspace: IWorkspace = new Workspace('id', [workspaceFolder]);

class ProblemReporter implements IProblemReporter {

	private _validationStatus: ValidationStatus = new ValidationStatus();

	public receivedMessage: boolean = false;
	public lastMessage: string | undefined = undefined;

	public info(message: string): void {
		this.log(message);
	}

	public warn(message: string): void {
		this.log(message);
	}

	public error(message: string): void {
		this.log(message);
	}

	public fatal(message: string): void {
		this.log(message);
	}

	public get status(): ValidationStatus {
		return this._validationStatus;
	}

	private log(message: string): void {
		this.receivedMessage = true;
		this.lastMessage = message;
	}
}

class ConfiguationBuilder {

	public result: Tasks.Task[];
	private builders: CustomTaskBuilder[];

	constructor() {
		this.result = [];
		this.builders = [];
	}

	public task(name: string, command: string): CustomTaskBuilder {
		let builder = new CustomTaskBuilder(this, name, command);
		this.builders.push(builder);
		this.result.push(builder.result);
		return builder;
	}

	public done(): void {
		for (let builder of this.builders) {
			builder.done();
		}
	}
}

class PresentationBuilder {

	public result: Tasks.PresentationOptions;

	constructor(public parent: CommandConfigurationBuilder) {
		this.result = { echo: false, reveal: Tasks.RevealKind.Always, revealProblems: Tasks.RevealProblemKind.Never, focus: false, panel: Tasks.PanelKind.Shared, showReuseMessage: true, clear: false };
	}

	public echo(value: boolean): PresentationBuilder {
		this.result.echo = value;
		return this;
	}

	public reveal(value: Tasks.RevealKind): PresentationBuilder {
		this.result.reveal = value;
		return this;
	}

	public focus(value: boolean): PresentationBuilder {
		this.result.focus = value;
		return this;
	}

	public instance(value: Tasks.PanelKind): PresentationBuilder {
		this.result.panel = value;
		return this;
	}

	public showReuseMessage(value: boolean): PresentationBuilder {
		this.result.showReuseMessage = value;
		return this;
	}

	public done(): void {
	}
}

class CommandConfigurationBuilder {
	public result: Tasks.CommandConfiguration;

	private presentationBuilder: PresentationBuilder;

	constructor(public parent: CustomTaskBuilder, command: string) {
		this.presentationBuilder = new PresentationBuilder(this);
		this.result = {
			name: command,
			runtime: Tasks.RuntimeType.Process,
			args: [],
			options: {
				cwd: '${workspaceFolder}'
			},
			presentation: this.presentationBuilder.result,
			suppressTaskName: false
		};
	}

	public name(value: string): CommandConfigurationBuilder {
		this.result.name = value;
		return this;
	}

	public runtime(value: Tasks.RuntimeType): CommandConfigurationBuilder {
		this.result.runtime = value;
		return this;
	}

	public args(value: string[]): CommandConfigurationBuilder {
		this.result.args = value;
		return this;
	}

	public options(value: Tasks.CommandOptions): CommandConfigurationBuilder {
		this.result.options = value;
		return this;
	}

	public taskSelector(value: string): CommandConfigurationBuilder {
		this.result.taskSelector = value;
		return this;
	}

	public suppressTaskName(value: boolean): CommandConfigurationBuilder {
		this.result.suppressTaskName = value;
		return this;
	}

	public presentation(): PresentationBuilder {
		return this.presentationBuilder;
	}

	public done(taskName: string): void {
		this.result.args = this.result.args!.map(arg => arg === '$name' ? taskName : arg);
		this.presentationBuilder.done();
	}
}

class CustomTaskBuilder {

	public result: Tasks.CustomTask;
	private commandBuilder: CommandConfigurationBuilder;

	constructor(public parent: ConfiguationBuilder, name: string, command: string) {
		this.commandBuilder = new CommandConfigurationBuilder(this, command);
		this.result = new Tasks.CustomTask(
			name,
			{ kind: Tasks.TaskSourceKind.Workspace, label: 'workspace', config: { workspaceFolder: workspaceFolder, element: undefined, index: -1, file: '.vscode/tasks.json' } },
			name,
			Tasks.CUSTOMIZED_TASK_TYPE,
			this.commandBuilder.result,
			false,
			{ reevaluateOnRerun: true },
			{
				identifier: name,
				name: name,
				isBackground: false,
				promptOnClose: true,
				problemMatchers: [],
			}
		);
	}

	public identifier(value: string): CustomTaskBuilder {
		this.result.configurationProperties.identifier = value;
		return this;
	}

	public group(value: Tasks.TaskGroup): CustomTaskBuilder {
		this.result.configurationProperties.group = value;
		this.result.configurationProperties.groupType = Tasks.GroupType.user;
		return this;
	}

	public groupType(value: Tasks.GroupType): CustomTaskBuilder {
		this.result.configurationProperties.groupType = value;
		return this;
	}

	public isBackground(value: boolean): CustomTaskBuilder {
		this.result.configurationProperties.isBackground = value;
		return this;
	}

	public promptOnClose(value: boolean): CustomTaskBuilder {
		this.result.configurationProperties.promptOnClose = value;
		return this;
	}

	public problemMatcher(): ProblemMatcherBuilder {
		let builder = new ProblemMatcherBuilder(this);
		this.result.configurationProperties.problemMatchers!.push(builder.result);
		return builder;
	}

	public command(): CommandConfigurationBuilder {
		return this.commandBuilder;
	}

	public done(): void {
		this.commandBuilder.done(this.result.configurationProperties.name!);
	}
}

class ProblemMatcherBuilder {

	public static readonly DEFAULT_UUID = UUID.generateUuid();

	public result: ProblemMatcher;

	constructor(public parent: CustomTaskBuilder) {
		this.result = {
			owner: ProblemMatcherBuilder.DEFAULT_UUID,
			applyTo: ApplyToKind.allDocuments,
			severity: undefined,
			fileLocation: FileLocationKind.Relative,
			filePrefix: '${workspaceFolder}',
			pattern: undefined!
		};
	}

	public owner(value: string): ProblemMatcherBuilder {
		this.result.owner = value;
		return this;
	}

	public applyTo(value: ApplyToKind): ProblemMatcherBuilder {
		this.result.applyTo = value;
		return this;
	}

	public severity(value: Severity): ProblemMatcherBuilder {
		this.result.severity = value;
		return this;
	}

	public fileLocation(value: FileLocationKind): ProblemMatcherBuilder {
		this.result.fileLocation = value;
		return this;
	}

	public filePrefix(value: string): ProblemMatcherBuilder {
		this.result.filePrefix = value;
		return this;
	}

	public pattern(regExp: RegExp): PatternBuilder {
		let builder = new PatternBuilder(this, regExp);
		if (!this.result.pattern) {
			this.result.pattern = builder.result;
		}
		return builder;
	}
}

class PatternBuilder {
	public result: ProblemPattern;

	constructor(public parent: ProblemMatcherBuilder, regExp: RegExp) {
		this.result = {
			regexp: regExp,
			file: 1,
			message: 0,
			line: 2,
			character: 3
		};
	}

	public file(value: number): PatternBuilder {
		this.result.file = value;
		return this;
	}

	public message(value: number): PatternBuilder {
		this.result.message = value;
		return this;
	}

	public location(value: number): PatternBuilder {
		this.result.location = value;
		return this;
	}

	public line(value: number): PatternBuilder {
		this.result.line = value;
		return this;
	}

	public character(value: number): PatternBuilder {
		this.result.character = value;
		return this;
	}

	public endLine(value: number): PatternBuilder {
		this.result.endLine = value;
		return this;
	}

	public endCharacter(value: number): PatternBuilder {
		this.result.endCharacter = value;
		return this;
	}

	public code(value: number): PatternBuilder {
		this.result.code = value;
		return this;
	}

	public severity(value: number): PatternBuilder {
		this.result.severity = value;
		return this;
	}

	public loop(value: boolean): PatternBuilder {
		this.result.loop = value;
		return this;
	}
}

class TasksMockContextKeyService extends MockContextKeyService {
	public getContext(domNode: HTMLElement): IContext {
		return {
			getValue: <T>(_key: string) => {
				return <T><unknown>true;
			}
		};
	}
}

function testDefaultProblemMatcher(external: ExternalTaskRunnerConfiguration, resolved: number) {
	let reporter = new ProblemReporter();
	let result = parse(workspaceFolder, workspace, Platform.platform, external, reporter, TaskConfigSource.TasksJson, new TasksMockContextKeyService());
	assert.ok(!reporter.receivedMessage);
	assert.strictEqual(result.custom.length, 1);
	let task = result.custom[0];
	assert.ok(task);
	assert.strictEqual(task.configurationProperties.problemMatchers!.length, resolved);
}

function testConfiguration(external: ExternalTaskRunnerConfiguration, builder: ConfiguationBuilder): void {
	builder.done();
	let reporter = new ProblemReporter();
	let result = parse(workspaceFolder, workspace, Platform.platform, external, reporter, TaskConfigSource.TasksJson, new TasksMockContextKeyService());
	if (reporter.receivedMessage) {
		assert.ok(false, reporter.lastMessage);
	}
	assertConfiguration(result, builder.result);
}

class TaskGroupMap {
	private _store: { [key: string]: Tasks.Task[] };

	constructor() {
		this._store = Object.create(null);
	}

	public add(group: string, task: Tasks.Task): void {
		let tasks = this._store[group];
		if (!tasks) {
			tasks = [];
			this._store[group] = tasks;
		}
		tasks.push(task);
	}

	public static assert(actual: TaskGroupMap, expected: TaskGroupMap): void {
		let actualKeys = Object.keys(actual._store);
		let expectedKeys = Object.keys(expected._store);
		if (actualKeys.length === 0 && expectedKeys.length === 0) {
			return;
		}
		assert.strictEqual(actualKeys.length, expectedKeys.length);
		actualKeys.forEach(key => assert.ok(expected._store[key]));
		expectedKeys.forEach(key => actual._store[key]);
		actualKeys.forEach((key) => {
			let actualTasks = actual._store[key];
			let expectedTasks = expected._store[key];
			assert.strictEqual(actualTasks.length, expectedTasks.length);
			if (actualTasks.length === 1) {
				assert.strictEqual(actualTasks[0].configurationProperties.name, expectedTasks[0].configurationProperties.name);
				return;
			}
			let expectedTaskMap: { [key: string]: boolean } = Object.create(null);
			expectedTasks.forEach(task => expectedTaskMap[task.configurationProperties.name!] = true);
			actualTasks.forEach(task => delete expectedTaskMap[task.configurationProperties.name!]);
			assert.strictEqual(Object.keys(expectedTaskMap).length, 0);
		});
	}
}

function assertConfiguration(result: ParseResult, expected: Tasks.Task[]): void {
	assert.ok(result.validationStatus.isOK());
	let actual = result.custom;
	assert.strictEqual(typeof actual, typeof expected);
	if (!actual) {
		return;
	}

	// We can't compare Ids since the parser uses UUID which are random
	// So create a new map using the name.
	let actualTasks: { [key: string]: Tasks.Task; } = Object.create(null);
	let actualId2Name: { [key: string]: string; } = Object.create(null);
	let actualTaskGroups = new TaskGroupMap();
	actual.forEach(task => {
		assert.ok(!actualTasks[task.configurationProperties.name!]);
		actualTasks[task.configurationProperties.name!] = task;
		actualId2Name[task._id] = task.configurationProperties.name!;
		if (task.configurationProperties.group) {
			actualTaskGroups.add(task.configurationProperties.group, task);
		}
	});
	let expectedTasks: { [key: string]: Tasks.Task; } = Object.create(null);
	let expectedTaskGroup = new TaskGroupMap();
	expected.forEach(task => {
		assert.ok(!expectedTasks[task.configurationProperties.name!]);
		expectedTasks[task.configurationProperties.name!] = task;
		if (task.configurationProperties.group) {
			expectedTaskGroup.add(task.configurationProperties.group, task);
		}
	});
	let actualKeys = Object.keys(actualTasks);
	assert.strictEqual(actualKeys.length, expected.length);
	actualKeys.forEach((key) => {
		let actualTask = actualTasks[key];
		let expectedTask = expectedTasks[key];
		assert.ok(expectedTask);
		assertTask(actualTask, expectedTask);
	});
	TaskGroupMap.assert(actualTaskGroups, expectedTaskGroup);
}

function assertTask(actual: Tasks.Task, expected: Tasks.Task) {
	assert.ok(actual._id);
	assert.strictEqual(actual.configurationProperties.name, expected.configurationProperties.name, 'name');
	if (!Tasks.InMemoryTask.is(actual) && !Tasks.InMemoryTask.is(expected)) {
		assertCommandConfiguration(actual.command, expected.command);
	}
	assert.strictEqual(actual.configurationProperties.isBackground, expected.configurationProperties.isBackground, 'isBackground');
	assert.strictEqual(typeof actual.configurationProperties.problemMatchers, typeof expected.configurationProperties.problemMatchers);
	assert.strictEqual(actual.configurationProperties.promptOnClose, expected.configurationProperties.promptOnClose, 'promptOnClose');
	assert.strictEqual(actual.configurationProperties.group, expected.configurationProperties.group, 'group');
	assert.strictEqual(actual.configurationProperties.groupType, expected.configurationProperties.groupType, 'groupType');
	if (actual.configurationProperties.problemMatchers && expected.configurationProperties.problemMatchers) {
		assert.strictEqual(actual.configurationProperties.problemMatchers.length, expected.configurationProperties.problemMatchers.length);
		for (let i = 0; i < actual.configurationProperties.problemMatchers.length; i++) {
			assertProblemMatcher(actual.configurationProperties.problemMatchers[i], expected.configurationProperties.problemMatchers[i]);
		}
	}
}

function assertCommandConfiguration(actual: Tasks.CommandConfiguration, expected: Tasks.CommandConfiguration) {
	assert.strictEqual(typeof actual, typeof expected);
	if (actual && expected) {
		assertPresentation(actual.presentation!, expected.presentation!);
		assert.strictEqual(actual.name, expected.name, 'name');
		assert.strictEqual(actual.runtime, expected.runtime, 'runtime type');
		assert.strictEqual(actual.suppressTaskName, expected.suppressTaskName, 'suppressTaskName');
		assert.strictEqual(actual.taskSelector, expected.taskSelector, 'taskSelector');
		assert.deepEqual(actual.args, expected.args, 'args');
		assert.strictEqual(typeof actual.options, typeof expected.options);
		if (actual.options && expected.options) {
			assert.strictEqual(actual.options.cwd, expected.options.cwd, 'cwd');
			assert.strictEqual(typeof actual.options.env, typeof expected.options.env, 'env');
			if (actual.options.env && expected.options.env) {
				assert.deepEqual(actual.options.env, expected.options.env, 'env');
			}
		}
	}
}

function assertPresentation(actual: Tasks.PresentationOptions, expected: Tasks.PresentationOptions) {
	assert.strictEqual(typeof actual, typeof expected);
	if (actual && expected) {
		assert.strictEqual(actual.echo, expected.echo);
		assert.strictEqual(actual.reveal, expected.reveal);
	}
}

function assertProblemMatcher(actual: string | ProblemMatcher, expected: string | ProblemMatcher) {
	assert.strictEqual(typeof actual, typeof expected);
	if (typeof actual === 'string' && typeof expected === 'string') {
		assert.strictEqual(actual, expected, 'Problem matcher references are different');
		return;
	}
	if (typeof actual !== 'string' && typeof expected !== 'string') {
		if (expected.owner === ProblemMatcherBuilder.DEFAULT_UUID) {
			assert.ok(UUID.isUUID(actual.owner), 'Owner must be a UUID');
		} else {
			assert.strictEqual(actual.owner, expected.owner);
		}
		assert.strictEqual(actual.applyTo, expected.applyTo);
		assert.strictEqual(actual.severity, expected.severity);
		assert.strictEqual(actual.fileLocation, expected.fileLocation);
		assert.strictEqual(actual.filePrefix, expected.filePrefix);
		if (actual.pattern && expected.pattern) {
			assertProblemPatterns(actual.pattern, expected.pattern);
		}
	}
}

function assertProblemPatterns(actual: ProblemPattern | ProblemPattern[], expected: ProblemPattern | ProblemPattern[]) {
	assert.strictEqual(typeof actual, typeof expected);
	if (Array.isArray(actual)) {
		let actuals = <ProblemPattern[]>actual;
		let expecteds = <ProblemPattern[]>expected;
		assert.strictEqual(actuals.length, expecteds.length);
		for (let i = 0; i < actuals.length; i++) {
			assertProblemPattern(actuals[i], expecteds[i]);
		}
	} else {
		assertProblemPattern(<ProblemPattern>actual, <ProblemPattern>expected);
	}
}

function assertProblemPattern(actual: ProblemPattern, expected: ProblemPattern) {
	assert.equal(actual.regexp.toString(), expected.regexp.toString());
	assert.strictEqual(actual.file, expected.file);
	assert.strictEqual(actual.message, expected.message);
	if (typeof expected.location !== 'undefined') {
		assert.strictEqual(actual.location, expected.location);
	} else {
		assert.strictEqual(actual.line, expected.line);
		assert.strictEqual(actual.character, expected.character);
		assert.strictEqual(actual.endLine, expected.endLine);
		assert.strictEqual(actual.endCharacter, expected.endCharacter);
	}
	assert.strictEqual(actual.code, expected.code);
	assert.strictEqual(actual.severity, expected.severity);
	assert.strictEqual(actual.loop, expected.loop);
}

suite('Tasks version 0.1.0', () => {
	test('tasks: all default', () => {
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc'
			}, builder);
	});

	test('tasks: global isShellCommand', () => {
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				isShellCommand: true
			},
			builder);
	});

	test('tasks: global show output silent', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			presentation().reveal(Tasks.RevealKind.Silent);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				showOutput: 'silent'
			},
			builder
		);
	});

	test('tasks: global promptOnClose default', () => {
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				promptOnClose: true
			},
			builder
		);
	});

	test('tasks: global promptOnClose', () => {
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			promptOnClose(false).
			command().suppressTaskName(true);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				promptOnClose: false
			},
			builder
		);
	});

	test('tasks: global promptOnClose default watching', () => {
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			isBackground(true).
			promptOnClose(false).
			command().suppressTaskName(true);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				isWatching: true
			},
			builder
		);
	});

	test('tasks: global show output never', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			presentation().reveal(Tasks.RevealKind.Never);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				showOutput: 'never'
			},
			builder
		);
	});

	test('tasks: global echo Command', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			presentation().
			echo(true);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				echoCommand: true
			},
			builder
		);
	});

	test('tasks: global args', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			args(['--p']);
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				args: [
					'--p'
				]
			},
			builder
		);
	});

	test('tasks: options - cwd', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			options({
				cwd: 'myPath'
			});
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				options: {
					cwd: 'myPath'
				}
			},
			builder
		);
	});

	test('tasks: options - env', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			options({ cwd: '${workspaceFolder}', env: { key: 'value' } });
		testConfiguration(
			{
				version: '0.1.0',
				command: 'tsc',
				options: {
					env: {
						key: 'value'
					}
				}
			},
			builder
		);
	});

	test('tasks: os windows', () => {
		let name: string = Platform.isWindows ? 'tsc.win' : 'tsc';
		let builder = new ConfiguationBuilder();
		builder.
			task(name, name).
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true);
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			windows: {
				command: 'tsc.win'
			}
		};
		testConfiguration(external, builder);
	});

	test('tasks: os windows & global isShellCommand', () => {
		let name: string = Platform.isWindows ? 'tsc.win' : 'tsc';
		let builder = new ConfiguationBuilder();
		builder.
			task(name, name).
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell);
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			isShellCommand: true,
			windows: {
				command: 'tsc.win'
			}
		};
		testConfiguration(external, builder);
	});

	test('tasks: os mac', () => {
		let name: string = Platform.isMacintosh ? 'tsc.osx' : 'tsc';
		let builder = new ConfiguationBuilder();
		builder.
			task(name, name).
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true);
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			osx: {
				command: 'tsc.osx'
			}
		};
		testConfiguration(external, builder);
	});

	test('tasks: os linux', () => {
		let name: string = Platform.isLinux ? 'tsc.linux' : 'tsc';
		let builder = new ConfiguationBuilder();
		builder.
			task(name, name).
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true);
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			linux: {
				command: 'tsc.linux'
			}
		};
		testConfiguration(external, builder);
	});

	test('tasks: overwrite showOutput', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			presentation().reveal(Platform.isWindows ? Tasks.RevealKind.Always : Tasks.RevealKind.Never);
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			showOutput: 'never',
			windows: {
				showOutput: 'always'
			}
		};
		testConfiguration(external, builder);
	});

	test('tasks: overwrite echo Command', () => {
		let builder = new ConfiguationBuilder();
		builder.
			task('tsc', 'tsc').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			presentation().
			echo(Platform.isWindows ? false : true);
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			echoCommand: true,
			windows: {
				echoCommand: false
			}
		};
		testConfiguration(external, builder);
	});

	test('tasks: global problemMatcher one', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			problemMatcher: '$msCompile'
		};
		testDefaultProblemMatcher(external, 1);
	});

	test('tasks: global problemMatcher two', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			problemMatcher: ['$eslint-compact', '$msCompile']
		};
		testDefaultProblemMatcher(external, 2);
	});

	test('tasks: task definition', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: build task', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					isBuildCommand: true
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').group(Tasks.TaskGroup.Build).command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: default build task', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'build'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('build', 'tsc').group(Tasks.TaskGroup.Build).command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: test task', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					isTestCommand: true
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').group(Tasks.TaskGroup.Test).command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: default test task', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'test'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('test', 'tsc').group(Tasks.TaskGroup.Test).command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: task with values', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'test',
					showOutput: 'never',
					echoCommand: true,
					args: ['--p'],
					isWatching: true
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('test', 'tsc').
			group(Tasks.TaskGroup.Test).
			isBackground(true).
			promptOnClose(false).
			command().args(['$name', '--p']).
			presentation().
			echo(true).reveal(Tasks.RevealKind.Never);

		testConfiguration(external, builder);
	});

	test('tasks: task inherits global values', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			showOutput: 'never',
			echoCommand: true,
			tasks: [
				{
					taskName: 'test'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('test', 'tsc').
			group(Tasks.TaskGroup.Test).
			command().args(['$name']).presentation().
			echo(true).reveal(Tasks.RevealKind.Never);

		testConfiguration(external, builder);
	});

	test('tasks: problem matcher default', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					problemMatcher: {
						pattern: {
							regexp: 'abc'
						}
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().args(['$name']).parent.
			problemMatcher().pattern(/abc/);
		testConfiguration(external, builder);
	});

	test('tasks: problem matcher .* regular expression', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					problemMatcher: {
						pattern: {
							regexp: '.*'
						}
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().args(['$name']).parent.
			problemMatcher().pattern(/.*/);
		testConfiguration(external, builder);
	});

	test('tasks: problem matcher owner, applyTo, severity and fileLocation', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					problemMatcher: {
						owner: 'myOwner',
						applyTo: 'closedDocuments',
						severity: 'warning',
						fileLocation: 'absolute',
						pattern: {
							regexp: 'abc'
						}
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().args(['$name']).parent.
			problemMatcher().
			owner('myOwner').
			applyTo(ApplyToKind.closedDocuments).
			severity(Severity.Warning).
			fileLocation(FileLocationKind.Absolute).
			filePrefix(undefined!).
			pattern(/abc/);
		testConfiguration(external, builder);
	});

	test('tasks: problem matcher fileLocation and filePrefix', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					problemMatcher: {
						fileLocation: ['relative', 'myPath'],
						pattern: {
							regexp: 'abc'
						}
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().args(['$name']).parent.
			problemMatcher().
			fileLocation(FileLocationKind.Relative).
			filePrefix('myPath').
			pattern(/abc/);
		testConfiguration(external, builder);
	});

	test('tasks: problem pattern location', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					problemMatcher: {
						pattern: {
							regexp: 'abc',
							file: 10,
							message: 11,
							location: 12,
							severity: 13,
							code: 14
						}
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().args(['$name']).parent.
			problemMatcher().
			pattern(/abc/).file(10).message(11).location(12).severity(13).code(14);
		testConfiguration(external, builder);
	});

	test('tasks: problem pattern line & column', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					problemMatcher: {
						pattern: {
							regexp: 'abc',
							file: 10,
							message: 11,
							line: 12,
							column: 13,
							endLine: 14,
							endColumn: 15,
							severity: 16,
							code: 17
						}
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().args(['$name']).parent.
			problemMatcher().
			pattern(/abc/).file(10).message(11).
			line(12).character(13).endLine(14).endCharacter(15).
			severity(16).code(17);
		testConfiguration(external, builder);
	});

	test('tasks: prompt on close default', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			promptOnClose(true).
			command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: prompt on close watching', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					isWatching: true
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			isBackground(true).promptOnClose(false).
			command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: prompt on close set', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskName',
					promptOnClose: false
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			promptOnClose(false).
			command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: task selector set', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			taskSelector: '/t:',
			tasks: [
				{
					taskName: 'taskName',
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().
			taskSelector('/t:').
			args(['/t:taskName']);
		testConfiguration(external, builder);
	});

	test('tasks: suppress task name set', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			suppressTaskName: false,
			tasks: [
				{
					taskName: 'taskName',
					suppressTaskName: true
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().suppressTaskName(true);
		testConfiguration(external, builder);
	});

	test('tasks: suppress task name inherit', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			suppressTaskName: true,
			tasks: [
				{
					taskName: 'taskName'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskName', 'tsc').
			command().suppressTaskName(true);
		testConfiguration(external, builder);
	});

	test('tasks: two tasks', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskNameOne'
				},
				{
					taskName: 'taskNameTwo'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').
			command().args(['$name']);
		builder.task('taskNameTwo', 'tsc').
			command().args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: with command', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			tasks: [
				{
					taskName: 'taskNameOne',
					command: 'tsc'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').command().suppressTaskName(true);
		testConfiguration(external, builder);
	});

	test('tasks: two tasks with command', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			tasks: [
				{
					taskName: 'taskNameOne',
					command: 'tsc'
				},
				{
					taskName: 'taskNameTwo',
					command: 'dir'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').command().suppressTaskName(true);
		builder.task('taskNameTwo', 'dir').command().suppressTaskName(true);
		testConfiguration(external, builder);
	});

	test('tasks: with command and args', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			tasks: [
				{
					taskName: 'taskNameOne',
					command: 'tsc',
					isShellCommand: true,
					args: ['arg'],
					options: {
						cwd: 'cwd',
						env: {
							env: 'env'
						}
					}
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).args(['arg']).options({ cwd: 'cwd', env: { env: 'env' } });
		testConfiguration(external, builder);
	});

	test('tasks: with command os specific', () => {
		let name: string = Platform.isWindows ? 'tsc.win' : 'tsc';
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			tasks: [
				{
					taskName: 'taskNameOne',
					command: 'tsc',
					windows: {
						command: 'tsc.win'
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', name).command().suppressTaskName(true);
		testConfiguration(external, builder);
	});

	test('tasks: with Windows specific args', () => {
		let args: string[] = Platform.isWindows ? ['arg1', 'arg2'] : ['arg1'];
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			tasks: [
				{
					taskName: 'tsc',
					command: 'tsc',
					args: ['arg1'],
					windows: {
						args: ['arg2']
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').command().suppressTaskName(true).args(args);
		testConfiguration(external, builder);
	});

	test('tasks: with Linux specific args', () => {
		let args: string[] = Platform.isLinux ? ['arg1', 'arg2'] : ['arg1'];
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			tasks: [
				{
					taskName: 'tsc',
					command: 'tsc',
					args: ['arg1'],
					linux: {
						args: ['arg2']
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('tsc', 'tsc').command().suppressTaskName(true).args(args);
		testConfiguration(external, builder);
	});

	test('tasks: global command and task command properties', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			tasks: [
				{
					taskName: 'taskNameOne',
					isShellCommand: true,
				} as CustomTask
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').command().runtime(Tasks.RuntimeType.Shell).args(['$name']);
		testConfiguration(external, builder);
	});

	test('tasks: global and tasks args', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			args: ['global'],
			tasks: [
				{
					taskName: 'taskNameOne',
					args: ['local']
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').command().args(['global', '$name', 'local']);
		testConfiguration(external, builder);
	});

	test('tasks: global and tasks args with task selector', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			command: 'tsc',
			args: ['global'],
			taskSelector: '/t:',
			tasks: [
				{
					taskName: 'taskNameOne',
					args: ['local']
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('taskNameOne', 'tsc').command().taskSelector('/t:').args(['global', '/t:taskNameOne', 'local']);
		testConfiguration(external, builder);
	});
});

suite('Tasks version 2.0.0', () => {
	test('Build workspace task', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			tasks: [
				{
					taskName: 'dir',
					command: 'dir',
					type: 'shell',
					group: 'build'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Global group none', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			command: 'dir',
			type: 'shell',
			group: 'none'
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Global group build', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			command: 'dir',
			type: 'shell',
			group: 'build'
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Global group default build', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			command: 'dir',
			type: 'shell',
			group: { kind: 'build', isDefault: true }
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			group(Tasks.TaskGroup.Build).
			groupType(Tasks.GroupType.default).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Local group none', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			tasks: [
				{
					taskName: 'dir',
					command: 'dir',
					type: 'shell',
					group: 'none'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Local group build', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			tasks: [
				{
					taskName: 'dir',
					command: 'dir',
					type: 'shell',
					group: 'build'
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Local group default build', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			tasks: [
				{
					taskName: 'dir',
					command: 'dir',
					type: 'shell',
					group: { kind: 'build', isDefault: true }
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('dir', 'dir').
			group(Tasks.TaskGroup.Build).
			groupType(Tasks.GroupType.default).
			command().suppressTaskName(true).
			runtime(Tasks.RuntimeType.Shell).
			presentation().echo(true);
		testConfiguration(external, builder);
	});
	test('Arg overwrite', () => {
		let external: ExternalTaskRunnerConfiguration = {
			version: '2.0.0',
			tasks: [
				{
					label: 'echo',
					type: 'shell',
					command: 'echo',
					args: [
						'global'
					],
					windows: {
						args: [
							'windows'
						]
					},
					linux: {
						args: [
							'linux'
						]
					},
					osx: {
						args: [
							'osx'
						]
					}
				}
			]
		};
		let builder = new ConfiguationBuilder();
		if (Platform.isWindows) {
			builder.task('echo', 'echo').
				command().suppressTaskName(true).args(['windows']).
				runtime(Tasks.RuntimeType.Shell).
				presentation().echo(true);
			testConfiguration(external, builder);
		} else if (Platform.isLinux) {
			builder.task('echo', 'echo').
				command().suppressTaskName(true).args(['linux']).
				runtime(Tasks.RuntimeType.Shell).
				presentation().echo(true);
			testConfiguration(external, builder);
		} else if (Platform.isMacintosh) {
			builder.task('echo', 'echo').
				command().suppressTaskName(true).args(['osx']).
				runtime(Tasks.RuntimeType.Shell).
				presentation().echo(true);
			testConfiguration(external, builder);
		}
	});
});

suite('Bugs / regression tests', () => {
	test('Bug 19548', () => {
		if (Platform.isLinux) {
			return;
		}
		let external: ExternalTaskRunnerConfiguration = {
			version: '0.1.0',
			windows: {
				command: 'powershell',
				options: {
					cwd: '${workspaceFolder}'
				},
				tasks: [
					{
						taskName: 'composeForDebug',
						suppressTaskName: true,
						args: [
							'-ExecutionPolicy',
							'RemoteSigned',
							'.\\dockerTask.ps1',
							'-ComposeForDebug',
							'-Environment',
							'debug'
						],
						isBuildCommand: false,
						showOutput: 'always',
						echoCommand: true
					} as CustomTask
				]
			},
			osx: {
				command: '/bin/bash',
				options: {
					cwd: '${workspaceFolder}'
				},
				tasks: [
					{
						taskName: 'composeForDebug',
						suppressTaskName: true,
						args: [
							'-c',
							'./dockerTask.sh composeForDebug debug'
						],
						isBuildCommand: false,
						showOutput: 'always'
					} as CustomTask
				]
			}
		};
		let builder = new ConfiguationBuilder();
		if (Platform.isWindows) {
			builder.task('composeForDebug', 'powershell').
				command().suppressTaskName(true).
				args(['-ExecutionPolicy', 'RemoteSigned', '.\\dockerTask.ps1', '-ComposeForDebug', '-Environment', 'debug']).
				options({ cwd: '${workspaceFolder}' }).
				presentation().echo(true).reveal(Tasks.RevealKind.Always);
			testConfiguration(external, builder);
		} else if (Platform.isMacintosh) {
			builder.task('composeForDebug', '/bin/bash').
				command().suppressTaskName(true).
				args(['-c', './dockerTask.sh composeForDebug debug']).
				options({ cwd: '${workspaceFolder}' }).
				presentation().reveal(Tasks.RevealKind.Always);
			testConfiguration(external, builder);
		}
	});

	test('Bug 28489', () => {
		let external = {
			version: '0.1.0',
			command: '',
			isShellCommand: true,
			args: [''],
			showOutput: 'always',
			'tasks': [
				{
					taskName: 'build',
					command: 'bash',
					args: [
						'build.sh'
					]
				}
			]
		};
		let builder = new ConfiguationBuilder();
		builder.task('build', 'bash').
			group(Tasks.TaskGroup.Build).
			command().suppressTaskName(true).
			args(['build.sh']).
			runtime(Tasks.RuntimeType.Shell);
		testConfiguration(external, builder);
	});
});
