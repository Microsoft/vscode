/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

import * as Objects from 'vs/base/common/objects';
import { IStringDictionary } from 'vs/base/common/collections';
import { Platform } from 'vs/base/common/platform';
import * as Types from 'vs/base/common/types';
import * as UUID from 'vs/base/common/uuid';

import { ValidationStatus, IProblemReporter as IProblemReporterBase } from 'vs/base/common/parsers';
import {
	NamedProblemMatcher, ProblemMatcher, ProblemMatcherParser, Config as ProblemMatcherConfig,
	isNamedProblemMatcher, ProblemMatcherRegistry
} from 'vs/workbench/parts/tasks/common/problemMatcher';

import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

import * as Tasks from '../common/tasks';
import { TaskDefinitionRegistry } from '../common/taskDefinitionRegistry';

import { TaskDefinition } from 'vs/workbench/parts/tasks/node/tasks';

export const enum ShellQuoting {
	/**
	 * Default is character escaping.
	 */
	escape = 1,

	/**
	 * Default is strong quoting
	 */
	strong = 2,

	/**
	 * Default is weak quoting.
	 */
	weak = 3
}

export interface ShellQuotingOptions {
	/**
	 * The character used to do character escaping.
	 */
	escape?: string | {
		escapeChar: string;
		charsToEscape: string;
	};

	/**
	 * The character used for string quoting.
	 */
	strong?: string;

	/**
	 * The character used for weak quoting.
	 */
	weak?: string;
}

export interface ShellConfiguration {
	executable?: string;
	args?: string[];
	quoting?: ShellQuotingOptions;
}

export interface CommandOptions {
	/**
	 * The current working directory of the executed program or shell.
	 * If omitted VSCode's current workspace root is used.
	 */
	cwd?: string;

	/**
	 * The additional environment of the executed program or shell. If omitted
	 * the parent process' environment is used.
	 */
	env?: IStringDictionary<string>;

	/**
	 * The shell configuration;
	 */
	shell?: ShellConfiguration;
}

export interface PresentationOptions {
	/**
	 * Controls whether the terminal executing a task is brought to front or not.
	 * Defaults to `RevealKind.Always`.
	 */
	reveal?: string;

	/**
	 * Controls whether the executed command is printed to the output window or terminal as well.
	 */
	echo?: boolean;

	/**
	 * Controls whether the terminal is focus when this task is executed
	 */
	focus?: boolean;

	/**
	 * Controls whether the task runs in a new terminal
	 */
	panel?: string;

	/**
	 * Controls whether to show the "Terminal will be reused by tasks, press any key to close it" message.
	 */
	showReuseMessage?: boolean;

	/**
	 * Controls whether the terminal should be cleared before running the task.
	 */
	clear?: boolean;
}

export interface TaskIdentifier {
	type?: string;
	[name: string]: any;
}

export namespace TaskIdentifier {
	export function is(value: any): value is TaskIdentifier {
		let candidate: TaskIdentifier = value;
		return candidate !== void 0 && Types.isString(value.type);
	}
}

export interface LegacyTaskProperties {
	/**
	 * @deprecated Use `isBackground` instead.
	 * Whether the executed command is kept alive and is watching the file system.
	 */
	isWatching?: boolean;

	/**
	 * @deprecated Use `group` instead.
	 * Whether this task maps to the default build command.
	 */
	isBuildCommand?: boolean;

	/**
	 * @deprecated Use `group` instead.
	 * Whether this task maps to the default test command.
	 */
	isTestCommand?: boolean;
}

export interface LegacyCommandProperties {

	/**
	 * Whether this is a shell or process
	 */
	type?: string;

	/**
	 * @deprecated Use presentation options
	 * Controls whether the output view of the running tasks is brought to front or not.
	 * See BaseTaskRunnerConfiguration#showOutput for details.
	 */
	showOutput?: string;

	/**
	 * @deprecated Use presentation options
	 * Controls whether the executed command is printed to the output windows as well.
	 */
	echoCommand?: boolean;

	/**
	 * @deprecated Use presentation instead
	 */
	terminal?: PresentationOptions;

	/**
	 * @deprecated Use inline commands.
	 * See BaseTaskRunnerConfiguration#suppressTaskName for details.
	 */
	suppressTaskName?: boolean;

	/**
	 * Some commands require that the task argument is highlighted with a special
	 * prefix (e.g. /t: for msbuild). This property can be used to control such
	 * a prefix.
	 */
	taskSelector?: string;

	/**
	 * @deprecated use the task type instead.
	 * Specifies whether the command is a shell command and therefore must
	 * be executed in a shell interpreter (e.g. cmd.exe, bash, ...).
	 *
	 * Defaults to false if omitted.
	 */
	isShellCommand?: boolean | ShellConfiguration;
}

export type CommandString = string | string[] | { value: string | string[], quoting: 'escape' | 'strong' | 'weak' };

export namespace CommandString {
	export function value(value: CommandString): string {
		if (Types.isString(value)) {
			return value;
		} else if (Types.isStringArray(value)) {
			return value.join(' ');
		} else {
			if (Types.isString(value.value)) {
				return value.value;
			} else {
				return value.value.join(' ');
			}
		}
	}
}

export interface BaseCommandProperties {

	/**
	 * The command to be executed. Can be an external program or a shell
	 * command.
	 */
	command?: CommandString;

	/**
	 * The command options used when the command is executed. Can be omitted.
	 */
	options?: CommandOptions;

	/**
	 * The arguments passed to the command or additional arguments passed to the
	 * command when using a global command.
	 */
	args?: CommandString[];
}


export interface CommandProperties extends BaseCommandProperties {

	/**
	 * Windows specific command properties
	 */
	windows?: BaseCommandProperties;

	/**
	 * OSX specific command properties
	 */
	osx?: BaseCommandProperties;

	/**
	 * linux specific command properties
	 */
	linux?: BaseCommandProperties;
}

export interface GroupKind {
	kind?: string;
	isDefault?: boolean;
}

export interface ConfigurationProperties {
	/**
	 * The task's name
	 */
	taskName?: string;

	/**
	 * The UI label used for the task.
	 */
	label?: string;

	/**
	 * An optional indentifier which can be used to reference a task
	 * in a dependsOn or other attributes.
	 */
	identifier?: string;

	/**
	 * Whether the executed command is kept alive and runs in the background.
	 */
	isBackground?: boolean;

	/**
	 * Defines if the application can have only 1 active instance at a time.
	 */
	instanceLimit?: boolean;

	/**
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * Defines the group the task belongs too.
	 */
	group?: string | GroupKind;

	/**
	 * The other tasks the task depend on
	 */
	dependsOn?: string | TaskIdentifier | (string | TaskIdentifier)[];

	/**
	 * Controls the behavior of the used terminal
	 */
	presentation?: PresentationOptions;

	/**
	 * Controls shell options.
	 */
	options?: CommandOptions;

	/**
	 * The problem matcher(s) to use to capture problems in the tasks
	 * output.
	 */
	problemMatcher?: ProblemMatcherConfig.ProblemMatcherType;
}

export interface CustomTask extends CommandProperties, ConfigurationProperties {
	/**
	 * Custom tasks have the type CUSTOMIZED_TASK_TYPE
	 */
	type?: string;

}

export interface ConfiguringTask extends ConfigurationProperties {
	/**
	 * The contributed type of the task
	 */
	type?: string;
}

/**
 * The base task runner configuration
 */
export interface BaseTaskRunnerConfiguration {

	/**
	 * The command to be executed. Can be an external program or a shell
	 * command.
	 */
	command?: CommandString;

	/**
	 * @deprecated Use type instead
	 *
	 * Specifies whether the command is a shell command and therefore must
	 * be executed in a shell interpreter (e.g. cmd.exe, bash, ...).
	 *
	 * Defaults to false if omitted.
	 */
	isShellCommand?: boolean;

	/**
	 * The task type
	 */
	type?: string;

	/**
	 * The command options used when the command is executed. Can be omitted.
	 */
	options?: CommandOptions;

	/**
	 * The arguments passed to the command. Can be omitted.
	 */
	args?: CommandString[];

	/**
	 * Controls whether the output view of the running tasks is brought to front or not.
	 * Valid values are:
	 *   "always": bring the output window always to front when a task is executed.
	 *   "silent": only bring it to front if no problem matcher is defined for the task executed.
	 *   "never": never bring the output window to front.
	 *
	 * If omitted "always" is used.
	 */
	showOutput?: string;

	/**
	 * Controls whether the executed command is printed to the output windows as well.
	 */
	echoCommand?: boolean;

	/**
	 * The group
	 */
	group?: string | GroupKind;
	/**
	 * Controls the behavior of the used terminal
	 */
	presentation?: PresentationOptions;

	/**
	 * If set to false the task name is added as an additional argument to the
	 * command when executed. If set to true the task name is suppressed. If
	 * omitted false is used.
	 */
	suppressTaskName?: boolean;

	/**
	 * Some commands require that the task argument is highlighted with a special
	 * prefix (e.g. /t: for msbuild). This property can be used to control such
	 * a prefix.
	 */
	taskSelector?: string;

	/**
	 * The problem matcher(s) to used if a global command is exucuted (e.g. no tasks
	 * are defined). A tasks.json file can either contain a global problemMatcher
	 * property or a tasks property but not both.
	 */
	problemMatcher?: ProblemMatcherConfig.ProblemMatcherType;

	/**
	 * @deprecated Use `isBackground` instead.
	 *
	 * Specifies whether a global command is a watching the filesystem. A task.json
	 * file can either contain a global isWatching property or a tasks property
	 * but not both.
	 */
	isWatching?: boolean;

	/**
	 * Specifies whether a global command is a background task.
	 */
	isBackground?: boolean;

	/**
	 * Defines if the application can have only 1 active instance at a time.
	 */
	instanceLimit?: boolean;

	/**
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * The configuration of the available tasks. A tasks.json file can either
	 * contain a global problemMatcher property or a tasks property but not both.
	 */
	tasks?: (CustomTask | ConfiguringTask)[];

	/**
	 * Problem matcher declarations
	 */
	declares?: ProblemMatcherConfig.NamedProblemMatcher[];
}

/**
 * A configuration of an external build system. BuildConfiguration.buildSystem
 * must be set to 'program'
 */
export interface ExternalTaskRunnerConfiguration extends BaseTaskRunnerConfiguration {

	_runner?: string;

	/**
	 * Determines the runner to use
	 */
	runner?: string;

	/**
	 * The config's version number
	 */
	version: string;

	/**
	 * Windows specific task configuration
	 */
	windows?: BaseTaskRunnerConfiguration;

	/**
	 * Mac specific task configuration
	 */
	osx?: BaseTaskRunnerConfiguration;

	/**
	 * Linux speciif task configuration
	 */
	linux?: BaseTaskRunnerConfiguration;
}

enum ProblemMatcherKind {
	Unknown,
	String,
	ProblemMatcher,
	Array
}

const EMPTY_ARRAY: any[] = [];
Object.freeze(EMPTY_ARRAY);

function assignProperty<T, K extends keyof T>(target: T, source: Partial<T>, key: K) {
	if (source[key] !== void 0) {
		target[key] = source[key];
	}
}

function fillProperty<T, K extends keyof T>(target: T, source: Partial<T>, key: K) {
	if (target[key] === void 0 && source[key] !== void 0) {
		target[key] = source[key];
	}
}


interface ParserType<T> {
	isEmpty(value: T): boolean;
	assignProperties(target: T, source: T): T;
	fillProperties(target: T, source: T): T;
	fillDefaults(value: T, context: ParseContext): T;
	freeze(value: T): Readonly<T>;
}

interface MetaData<T, U> {
	property: keyof T;
	type?: ParserType<U>;
}


function _isEmpty<T>(this: void, value: T, properties: MetaData<T, any>[]): boolean {
	if (value === void 0 || value === null) {
		return true;
	}
	for (let meta of properties) {
		let property = value[meta.property];
		if (property !== void 0 && property !== null) {
			if (meta.type !== void 0 && !meta.type.isEmpty(property)) {
				return false;
			} else if (!Array.isArray(property) || property.length > 0) {
				return false;
			}
		}
	}
	return true;
}

function _assignProperties<T>(this: void, target: T, source: T, properties: MetaData<T, any>[]): T {
	if (_isEmpty(source, properties)) {
		return target;
	}
	if (_isEmpty(target, properties)) {
		return source;
	}
	for (let meta of properties) {
		let property = meta.property;
		let value: any;
		if (meta.type !== void 0) {
			value = meta.type.assignProperties(target[property], source[property]);
		} else {
			value = source[property];
		}
		if (value !== void 0 && value !== null) {
			target[property] = value;
		}
	}
	return target;
}

function _fillProperties<T>(this: void, target: T, source: T, properties: MetaData<T, any>[]): T {
	if (_isEmpty(source, properties)) {
		return target;
	}
	if (_isEmpty(target, properties)) {
		return source;
	}
	for (let meta of properties) {
		let property = meta.property;
		let value: any;
		if (meta.type) {
			value = meta.type.fillProperties(target[property], source[property]);
		} else if (target[property] === void 0) {
			value = source[property];
		}
		if (value !== void 0 && value !== null) {
			target[property] = value;
		}
	}
	return target;
}

function _fillDefaults<T>(this: void, target: T, defaults: T, properties: MetaData<T, any>[], context: ParseContext): T {
	if (target && Object.isFrozen(target)) {
		return target;
	}
	if (target === void 0 || target === null) {
		if (defaults !== void 0 && defaults !== null) {
			return Objects.deepClone(defaults);
		} else {
			return undefined;
		}
	}
	for (let meta of properties) {
		let property = meta.property;
		if (target[property] !== void 0) {
			continue;
		}
		let value: any;
		if (meta.type) {
			value = meta.type.fillDefaults(target[property], context);
		} else {
			value = defaults[property];
		}

		if (value !== void 0 && value !== null) {
			target[property] = value;
		}
	}
	return target;
}

function _freeze<T>(this: void, target: T, properties: MetaData<T, any>[]): Readonly<T> {
	if (target === void 0 || target === null) {
		return undefined;
	}
	if (Object.isFrozen(target)) {
		return target;
	}
	for (let meta of properties) {
		if (meta.type) {
			let value = target[meta.property];
			if (value) {
				meta.type.freeze(value);
			}
		}
	}
	Object.freeze(target);
	return target;
}

interface ParseContext {
	workspaceFolder: IWorkspaceFolder;
	problemReporter: IProblemReporter;
	namedProblemMatchers: IStringDictionary<NamedProblemMatcher>;
	uuidMap: UUIDMap;
	engine: Tasks.ExecutionEngine;
	schemaVersion: Tasks.JsonSchemaVersion;
	platform: Platform;
}


namespace ShellConfiguration {

	const properties: MetaData<Tasks.ShellConfiguration, void>[] = [{ property: 'executable' }, { property: 'args' }, { property: 'quoting' }];

	export function is(value: any): value is ShellConfiguration {
		let candidate: ShellConfiguration = value;
		return candidate && (Types.isString(candidate.executable) || Types.isStringArray(candidate.args));
	}

	export function from(this: void, config: ShellConfiguration, context: ParseContext): Tasks.ShellConfiguration {
		if (!is(config)) {
			return undefined;
		}
		let result: ShellConfiguration = {};
		if (config.executable !== void 0) {
			result.executable = config.executable;
		}
		if (config.args !== void 0) {
			result.args = config.args.slice();
		}
		if (config.quoting !== void 0) {
			result.quoting = Objects.deepClone(config.quoting);
		}

		return result;
	}

	export function isEmpty(this: void, value: Tasks.ShellConfiguration): boolean {
		return _isEmpty(value, properties);
	}

	export function assignProperties(this: void, target: Tasks.ShellConfiguration, source: Tasks.ShellConfiguration): Tasks.ShellConfiguration {
		return _assignProperties(target, source, properties);
	}

	export function fillProperties(this: void, target: Tasks.ShellConfiguration, source: Tasks.ShellConfiguration): Tasks.ShellConfiguration {
		return _fillProperties(target, source, properties);
	}

	export function fillDefaults(this: void, value: Tasks.ShellConfiguration, context: ParseContext): Tasks.ShellConfiguration {
		return value;
	}

	export function freeze(this: void, value: Tasks.ShellConfiguration): Readonly<Tasks.ShellConfiguration> {
		if (!value) {
			return undefined;
		}
		return Object.freeze(value);
	}
}

namespace CommandOptions {

	const properties: MetaData<Tasks.CommandOptions, Tasks.ShellConfiguration>[] = [{ property: 'cwd' }, { property: 'env' }, { property: 'shell', type: ShellConfiguration }];
	const defaults: CommandOptions = { cwd: '${workspaceFolder}' };

	export function from(this: void, options: CommandOptions, context: ParseContext): Tasks.CommandOptions {
		let result: Tasks.CommandOptions = {};
		if (options.cwd !== void 0) {
			if (Types.isString(options.cwd)) {
				result.cwd = options.cwd;
			} else {
				context.problemReporter.warn(nls.localize('ConfigurationParser.invalidCWD', 'Warning: options.cwd must be of type string. Ignoring value {0}\n', options.cwd));
			}
		}
		if (options.env !== void 0) {
			result.env = Objects.deepClone(options.env);
		}
		result.shell = ShellConfiguration.from(options.shell, context);
		return isEmpty(result) ? undefined : result;
	}

	export function isEmpty(value: Tasks.CommandOptions): boolean {
		return _isEmpty(value, properties);
	}

	export function assignProperties(target: Tasks.CommandOptions, source: Tasks.CommandOptions): Tasks.CommandOptions {
		if (isEmpty(source)) {
			return target;
		}
		if (isEmpty(target)) {
			return source;
		}
		assignProperty(target, source, 'cwd');
		if (target.env === void 0) {
			target.env = source.env;
		} else if (source.env !== void 0) {
			let env: { [key: string]: string; } = Object.create(null);
			Object.keys(target.env).forEach(key => env[key] = target.env[key]);
			Object.keys(source.env).forEach(key => env[key] = source.env[key]);
			target.env = env;
		}
		target.shell = ShellConfiguration.assignProperties(target.shell, source.shell);
		return target;
	}

	export function fillProperties(target: Tasks.CommandOptions, source: Tasks.CommandOptions): Tasks.CommandOptions {
		return _fillProperties(target, source, properties);
	}

	export function fillDefaults(value: Tasks.CommandOptions, context: ParseContext): Tasks.CommandOptions {
		return _fillDefaults(value, defaults, properties, context);
	}

	export function freeze(value: Tasks.CommandOptions): Readonly<Tasks.CommandOptions> {
		return _freeze(value, properties);
	}
}

namespace CommandConfiguration {

	export namespace PresentationOptions {
		const properties: MetaData<Tasks.PresentationOptions, void>[] = [{ property: 'echo' }, { property: 'reveal' }, { property: 'focus' }, { property: 'panel' }, { property: 'showReuseMessage' }, { property: 'clear' }];

		interface PresentationOptionsShape extends LegacyCommandProperties {
			presentation?: PresentationOptions;
		}

		export function from(this: void, config: PresentationOptionsShape, context: ParseContext): Tasks.PresentationOptions {
			let echo: boolean;
			let reveal: Tasks.RevealKind;
			let focus: boolean;
			let panel: Tasks.PanelKind;
			let showReuseMessage: boolean;
			let clear: boolean;
			if (Types.isBoolean(config.echoCommand)) {
				echo = config.echoCommand;
			}
			if (Types.isString(config.showOutput)) {
				reveal = Tasks.RevealKind.fromString(config.showOutput);
			}
			let presentation = config.presentation || config.terminal;
			if (presentation) {
				if (Types.isBoolean(presentation.echo)) {
					echo = presentation.echo;
				}
				if (Types.isString(presentation.reveal)) {
					reveal = Tasks.RevealKind.fromString(presentation.reveal);
				}
				if (Types.isBoolean(presentation.focus)) {
					focus = presentation.focus;
				}
				if (Types.isString(presentation.panel)) {
					panel = Tasks.PanelKind.fromString(presentation.panel);
				}
				if (Types.isBoolean(presentation.showReuseMessage)) {
					showReuseMessage = presentation.showReuseMessage;
				}
				if (Types.isBoolean(presentation.clear)) {
					clear = presentation.clear;
				}
			}
			if (echo === void 0 && reveal === void 0 && focus === void 0 && panel === void 0 && showReuseMessage === void 0) {
				return undefined;
			}
			return { echo, reveal, focus, panel, showReuseMessage, clear };
		}

		export function assignProperties(target: Tasks.PresentationOptions, source: Tasks.PresentationOptions): Tasks.PresentationOptions {
			return _assignProperties(target, source, properties);
		}

		export function fillProperties(target: Tasks.PresentationOptions, source: Tasks.PresentationOptions): Tasks.PresentationOptions {
			return _fillProperties(target, source, properties);
		}

		export function fillDefaults(value: Tasks.PresentationOptions, context: ParseContext): Tasks.PresentationOptions {
			let defaultEcho = context.engine === Tasks.ExecutionEngine.Terminal ? true : false;
			return _fillDefaults(value, { echo: defaultEcho, reveal: Tasks.RevealKind.Always, focus: false, panel: Tasks.PanelKind.Shared, showReuseMessage: true, clear: false }, properties, context);
		}

		export function freeze(value: Tasks.PresentationOptions): Readonly<Tasks.PresentationOptions> {
			return _freeze(value, properties);
		}

		export function isEmpty(this: void, value: Tasks.PresentationOptions): boolean {
			return _isEmpty(value, properties);
		}
	}

	namespace ShellString {
		export function from(this: void, value: CommandString): Tasks.CommandString {
			if (value === void 0 || value === null) {
				return undefined;
			}
			if (Types.isString(value)) {
				return value;
			} else if (Types.isStringArray(value)) {
				return value.join(' ');
			} else {
				let quoting = Tasks.ShellQuoting.from(value.quoting);
				let result = Types.isString(value.value) ? value.value : Types.isStringArray(value.value) ? value.value.join(' ') : undefined;
				if (result) {
					return {
						value: result,
						quoting: quoting
					};
				} else {
					return undefined;
				}
			}
		}
	}

	interface BaseCommandConfiguationShape extends BaseCommandProperties, LegacyCommandProperties {
	}

	interface CommandConfiguationShape extends BaseCommandConfiguationShape {
		windows?: BaseCommandConfiguationShape;
		osx?: BaseCommandConfiguationShape;
		linux?: BaseCommandConfiguationShape;
	}

	const properties: MetaData<Tasks.CommandConfiguration, any>[] = [
		{ property: 'runtime' }, { property: 'name' }, { property: 'options', type: CommandOptions },
		{ property: 'args' }, { property: 'taskSelector' }, { property: 'suppressTaskName' },
		{ property: 'presentation', type: PresentationOptions }
	];

	export function from(this: void, config: CommandConfiguationShape, context: ParseContext): Tasks.CommandConfiguration {
		let result: Tasks.CommandConfiguration = fromBase(config, context);

		let osConfig: Tasks.CommandConfiguration = undefined;
		if (config.windows && context.platform === Platform.Windows) {
			osConfig = fromBase(config.windows, context);
		} else if (config.osx && context.platform === Platform.Mac) {
			osConfig = fromBase(config.osx, context);
		} else if (config.linux && context.platform === Platform.Linux) {
			osConfig = fromBase(config.linux, context);
		}
		if (osConfig) {
			result = assignProperties(result, osConfig, context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0);
		}
		return isEmpty(result) ? undefined : result;
	}

	function fromBase(this: void, config: BaseCommandConfiguationShape, context: ParseContext): Tasks.CommandConfiguration {
		let result: Tasks.CommandConfiguration = {
			name: undefined,
			runtime: undefined,
			presentation: undefined
		};

		result.name = ShellString.from(config.command);
		if (Types.isString(config.type)) {
			if (config.type === 'shell' || config.type === 'process') {
				result.runtime = Tasks.RuntimeType.fromString(config.type);
			}
		}
		let isShellConfiguration = ShellConfiguration.is(config.isShellCommand);
		if (Types.isBoolean(config.isShellCommand) || isShellConfiguration) {
			result.runtime = Tasks.RuntimeType.Shell;
		} else if (config.isShellCommand !== void 0) {
			result.runtime = !!config.isShellCommand ? Tasks.RuntimeType.Shell : Tasks.RuntimeType.Process;
		}

		if (config.args !== void 0) {
			result.args = [];
			for (let arg of config.args) {
				let converted = ShellString.from(arg);
				if (converted !== void 0) {
					result.args.push(converted);
				} else {
					context.problemReporter.error(
						nls.localize(
							'ConfigurationParser.inValidArg',
							'Error: command argument must either be a string or a quoted string. Provided value is:\n{0}',
							arg ? JSON.stringify(arg, undefined, 4) : 'undefined'
						));
				}
			}
		}
		if (config.options !== void 0) {
			result.options = CommandOptions.from(config.options, context);
			if (result.options && result.options.shell === void 0 && isShellConfiguration) {
				result.options.shell = ShellConfiguration.from(config.isShellCommand as ShellConfiguration, context);
				if (context.engine !== Tasks.ExecutionEngine.Terminal) {
					context.problemReporter.warn(nls.localize('ConfigurationParser.noShell', 'Warning: shell configuration is only supported when executing tasks in the terminal.'));
				}
			}
		}
		let panel = PresentationOptions.from(config, context);
		if (panel) {
			result.presentation = panel;
		}
		if (Types.isString(config.taskSelector)) {
			result.taskSelector = config.taskSelector;
		}
		if (Types.isBoolean(config.suppressTaskName)) {
			result.suppressTaskName = config.suppressTaskName;
		}
		return isEmpty(result) ? undefined : result;
	}

	export function hasCommand(value: Tasks.CommandConfiguration): boolean {
		return value && !!value.name;
	}

	export function isEmpty(value: Tasks.CommandConfiguration): boolean {
		return _isEmpty(value, properties);
	}

	export function assignProperties(target: Tasks.CommandConfiguration, source: Tasks.CommandConfiguration, overwriteArgs: boolean): Tasks.CommandConfiguration {
		if (isEmpty(source)) {
			return target;
		}
		if (isEmpty(target)) {
			return source;
		}
		assignProperty(target, source, 'name');
		assignProperty(target, source, 'runtime');
		assignProperty(target, source, 'taskSelector');
		assignProperty(target, source, 'suppressTaskName');
		if (source.args !== void 0) {
			if (target.args === void 0 || overwriteArgs) {
				target.args = source.args;
			} else {
				target.args = target.args.concat(source.args);
			}
		}
		target.presentation = PresentationOptions.assignProperties(target.presentation, source.presentation);
		target.options = CommandOptions.assignProperties(target.options, source.options);
		return target;
	}

	export function fillProperties(target: Tasks.CommandConfiguration, source: Tasks.CommandConfiguration): Tasks.CommandConfiguration {
		return _fillProperties(target, source, properties);
	}

	export function fillGlobals(target: Tasks.CommandConfiguration, source: Tasks.CommandConfiguration, taskName: string): Tasks.CommandConfiguration {
		if (isEmpty(source)) {
			return target;
		}
		target = target || {
			name: undefined,
			runtime: undefined,
			presentation: undefined
		};
		if (target.name === void 0) {
			fillProperty(target, source, 'name');
			fillProperty(target, source, 'taskSelector');
			fillProperty(target, source, 'suppressTaskName');
			let args: Tasks.CommandString[] = source.args ? source.args.slice() : [];
			if (!target.suppressTaskName) {
				if (target.taskSelector !== void 0) {
					args.push(target.taskSelector + taskName);
				} else {
					args.push(taskName);
				}
			}
			if (target.args) {
				args = args.concat(target.args);
			}
			target.args = args;
		}
		fillProperty(target, source, 'runtime');

		target.presentation = PresentationOptions.fillProperties(target.presentation, source.presentation);
		target.options = CommandOptions.fillProperties(target.options, source.options);

		return target;
	}

	export function fillDefaults(value: Tasks.CommandConfiguration, context: ParseContext): void {
		if (!value || Object.isFrozen(value)) {
			return;
		}
		if (value.name !== void 0 && value.runtime === void 0) {
			value.runtime = Tasks.RuntimeType.Process;
		}
		value.presentation = PresentationOptions.fillDefaults(value.presentation, context);
		if (!isEmpty(value)) {
			value.options = CommandOptions.fillDefaults(value.options, context);
		}
		if (value.args === void 0) {
			value.args = EMPTY_ARRAY;
		}
		if (value.suppressTaskName === void 0) {
			value.suppressTaskName = false;
		}
	}

	export function freeze(value: Tasks.CommandConfiguration): Readonly<Tasks.CommandConfiguration> {
		return _freeze(value, properties);
	}
}

namespace ProblemMatcherConverter {

	export function namedFrom(this: void, declares: ProblemMatcherConfig.NamedProblemMatcher[], context: ParseContext): IStringDictionary<NamedProblemMatcher> {
		let result: IStringDictionary<NamedProblemMatcher> = Object.create(null);

		if (!Types.isArray(declares)) {
			return result;
		}
		(<ProblemMatcherConfig.NamedProblemMatcher[]>declares).forEach((value) => {
			let namedProblemMatcher = (new ProblemMatcherParser(context.problemReporter)).parse(value);
			if (isNamedProblemMatcher(namedProblemMatcher)) {
				result[namedProblemMatcher.name] = namedProblemMatcher;
			} else {
				context.problemReporter.error(nls.localize('ConfigurationParser.noName', 'Error: Problem Matcher in declare scope must have a name:\n{0}\n', JSON.stringify(value, undefined, 4)));
			}
		});
		return result;
	}

	export function from(this: void, config: ProblemMatcherConfig.ProblemMatcherType, context: ParseContext): ProblemMatcher[] {
		let result: ProblemMatcher[] = [];
		if (config === void 0) {
			return result;
		}
		let kind = getProblemMatcherKind(config);
		if (kind === ProblemMatcherKind.Unknown) {
			context.problemReporter.warn(nls.localize(
				'ConfigurationParser.unknownMatcherKind',
				'Warning: the defined problem matcher is unknown. Supported types are string | ProblemMatcher | (string | ProblemMatcher)[].\n{0}\n',
				JSON.stringify(config, null, 4)));
			return result;
		} else if (kind === ProblemMatcherKind.String || kind === ProblemMatcherKind.ProblemMatcher) {
			let matcher = resolveProblemMatcher(config as ProblemMatcherConfig.ProblemMatcher, context);
			if (matcher) {
				result.push(matcher);
			}
		} else if (kind === ProblemMatcherKind.Array) {
			let problemMatchers = <(string | ProblemMatcherConfig.ProblemMatcher)[]>config;
			problemMatchers.forEach(problemMatcher => {
				let matcher = resolveProblemMatcher(problemMatcher, context);
				if (matcher) {
					result.push(matcher);
				}
			});
		}
		return result;
	}

	function getProblemMatcherKind(this: void, value: ProblemMatcherConfig.ProblemMatcherType): ProblemMatcherKind {
		if (Types.isString(value)) {
			return ProblemMatcherKind.String;
		} else if (Types.isArray(value)) {
			return ProblemMatcherKind.Array;
		} else if (!Types.isUndefined(value)) {
			return ProblemMatcherKind.ProblemMatcher;
		} else {
			return ProblemMatcherKind.Unknown;
		}
	}

	function resolveProblemMatcher(this: void, value: string | ProblemMatcherConfig.ProblemMatcher, context: ParseContext): ProblemMatcher {
		if (Types.isString(value)) {
			let variableName = <string>value;
			if (variableName.length > 1 && variableName[0] === '$') {
				variableName = variableName.substring(1);
				let global = ProblemMatcherRegistry.get(variableName);
				if (global) {
					return Objects.deepClone(global);
				}
				let localProblemMatcher = context.namedProblemMatchers[variableName];
				if (localProblemMatcher) {
					localProblemMatcher = Objects.deepClone(localProblemMatcher);
					// remove the name
					delete localProblemMatcher.name;
					return localProblemMatcher;
				}
			}
			context.problemReporter.error(nls.localize('ConfigurationParser.invalidVaraibleReference', 'Error: Invalid problemMatcher reference: {0}\n', value));
			return undefined;
		} else {
			let json = <ProblemMatcherConfig.ProblemMatcher>value;
			return new ProblemMatcherParser(context.problemReporter).parse(json);
		}
	}
}

const source: Tasks.TaskSource = {
	kind: Tasks.TaskSourceKind.Workspace,
	label: 'Workspace',
	config: undefined
};

namespace GroupKind {
	export function from(this: void, external: string | GroupKind): [string, Tasks.GroupType] {
		if (external === void 0) {
			return undefined;
		}
		if (Types.isString(external)) {
			if (Tasks.TaskGroup.is(external)) {
				return [external, Tasks.GroupType.user];
			} else {
				return undefined;
			}
		}
		if (!Types.isString(external.kind) || !Tasks.TaskGroup.is(external.kind)) {
			return undefined;
		}
		let group: string = external.kind;
		let isDefault: boolean = !!external.isDefault;

		return [group, isDefault ? Tasks.GroupType.default : Tasks.GroupType.user];
	}
}

namespace TaskDependency {
	export function from(this: void, external: string | TaskIdentifier, context: ParseContext): Tasks.TaskDependency {
		if (Types.isString(external)) {
			return { workspaceFolder: context.workspaceFolder, task: external };
		} else if (TaskIdentifier.is(external)) {
			return { workspaceFolder: context.workspaceFolder, task: TaskDefinition.createTaskIdentifier(external as Tasks.TaskIdentifier, context.problemReporter) };
		} else {
			return undefined;
		}
	}
}

namespace ConfigurationProperties {

	const properties: MetaData<Tasks.ConfigurationProperties, any>[] = [

		{ property: 'name' }, { property: 'identifier' }, { property: 'group' }, { property: 'isBackground' },
		{ property: 'promptOnClose' }, { property: 'dependsOn' }, { property: 'instanceLimit' },
		{ property: 'presentation', type: CommandConfiguration.PresentationOptions }, { property: 'problemMatchers' }
	];

	export function from(this: void, external: ConfigurationProperties, context: ParseContext, includeCommandOptions: boolean): Tasks.ConfigurationProperties {
		if (!external) {
			return undefined;
		}
		let result: Tasks.ConfigurationProperties = {};
		if (Types.isString(external.taskName)) {
			result.name = external.taskName;
		}
		if (Types.isString(external.label) && context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0) {
			result.name = external.label;
		}
		if (Types.isString(external.identifier)) {
			result.identifier = external.identifier;
		}
		if (external.isBackground !== void 0) {
			result.isBackground = !!external.isBackground;
		}
		if (external.instanceLimit !== void 0) {
			result.instanceLimit = !!external.instanceLimit;
		}
		if (external.promptOnClose !== void 0) {
			result.promptOnClose = !!external.promptOnClose;
		}
		if (external.group !== void 0) {
			if (Types.isString(external.group) && Tasks.TaskGroup.is(external.group)) {
				result.group = external.group;
				result.groupType = Tasks.GroupType.user;
			} else {
				let values = GroupKind.from(external.group);
				if (values) {
					result.group = values[0];
					result.groupType = values[1];
				}
			}
		}
		if (external.dependsOn !== void 0) {
			if (Types.isArray(external.dependsOn)) {
				result.dependsOn = external.dependsOn.map(item => TaskDependency.from(item, context));
			} else {
				result.dependsOn = [TaskDependency.from(external.dependsOn, context)];
			}
		}
		if (includeCommandOptions && (external.presentation !== void 0 || (external as LegacyCommandProperties).terminal !== void 0)) {
			result.presentation = CommandConfiguration.PresentationOptions.from(external, context);
		}
		if (includeCommandOptions && (external.options !== void 0)) {
			result.options = CommandOptions.from(external.options, context);
		}
		if (external.problemMatcher) {
			result.problemMatchers = ProblemMatcherConverter.from(external.problemMatcher, context);
		}
		return isEmpty(result) ? undefined : result;
	}

	export function isEmpty(this: void, value: Tasks.ConfigurationProperties): boolean {
		return _isEmpty(value, properties);
	}
}

namespace ConfiguringTask {

	const grunt = 'grunt.';
	const jake = 'jake.';
	const gulp = 'gulp.';
	const npm = 'vscode.npm.';
	const typescript = 'vscode.typescript.';

	interface CustomizeShape {
		customize: string;
	}

	export function from(this: void, external: ConfiguringTask, context: ParseContext, index: number): Tasks.ConfiguringTask {
		if (!external) {
			return undefined;
		}
		let type = external.type;
		let customize = (external as CustomizeShape).customize;
		if (!type && !customize) {
			context.problemReporter.error(nls.localize('ConfigurationParser.noTaskType', 'Error: tasks configuration must have a type property. The configuration will be ignored.\n{0}\n', JSON.stringify(external, null, 4)));
			return undefined;
		}
		let typeDeclaration = TaskDefinitionRegistry.get(type);
		if (!typeDeclaration) {
			let message = nls.localize('ConfigurationParser.noTypeDefinition', 'Error: there is no registered task type \'{0}\'. Did you miss to install an extension that provides a corresponding task provider?', type);
			context.problemReporter.error(message);
			return undefined;
		}
		let identifier: Tasks.TaskIdentifier;
		if (Types.isString(customize)) {
			if (customize.indexOf(grunt) === 0) {
				identifier = { type: 'grunt', task: customize.substring(grunt.length) };
			} else if (customize.indexOf(jake) === 0) {
				identifier = { type: 'jake', task: customize.substring(jake.length) };
			} else if (customize.indexOf(gulp) === 0) {
				identifier = { type: 'gulp', task: customize.substring(gulp.length) };
			} else if (customize.indexOf(npm) === 0) {
				identifier = { type: 'npm', script: customize.substring(npm.length + 4) };
			} else if (customize.indexOf(typescript) === 0) {
				identifier = { type: 'typescript', tsconfig: customize.substring(typescript.length + 6) };
			}
		} else {
			if (Types.isString(external.type)) {
				identifier = external as Tasks.TaskIdentifier;
			}
		}
		if (identifier === void 0) {
			context.problemReporter.error(nls.localize(
				'ConfigurationParser.missingType',
				'Error: the task configuration \'{0}\' is missing the required property \'type\'. The task configuration will be ignored.', JSON.stringify(external, undefined, 0)
			));
			return undefined;
		}
		let taskIdentifier: Tasks.KeyedTaskIdentifier = TaskDefinition.createTaskIdentifier(identifier, context.problemReporter);
		if (taskIdentifier === void 0) {
			context.problemReporter.error(nls.localize(
				'ConfigurationParser.incorrectType',
				'Error: the task configuration \'{0}\' is using an unknown type. The task configuration will be ignored.', JSON.stringify(external, undefined, 0)
			));
			return undefined;
		}
		let configElement: Tasks.TaskSourceConfigElement = {
			workspaceFolder: context.workspaceFolder,
			file: '.vscode\\tasks.json',
			index,
			element: external
		};
		let result: Tasks.ConfiguringTask = {
			type: type,
			configures: taskIdentifier,
			_id: `${typeDeclaration.extensionId}.${taskIdentifier._key}`,
			_source: Objects.assign({}, source, { config: configElement }),
			_label: undefined
		};
		let configuration = ConfigurationProperties.from(external, context, true);
		if (configuration) {
			result = Objects.assign(result, configuration);
			if (result.name) {
				result._label = result.name;
			} else {
				let label = result.configures.type;
				if (typeDeclaration.required && typeDeclaration.required.length > 0) {
					for (let required of typeDeclaration.required) {
						let value = result.configures[required];
						if (value) {
							label = label + ' ' + value;
							break;
						}
					}
				}
				result._label = label;
			}
			if (!result.identifier) {
				result.identifier = taskIdentifier._key;
			}
		}
		return result;
	}
}

namespace CustomTask {

	export function from(this: void, external: CustomTask, context: ParseContext, index: number): Tasks.CustomTask {
		if (!external) {
			return undefined;
		}
		let type = external.type;
		if (type === void 0 || type === null) {
			type = Tasks.CUSTOMIZED_TASK_TYPE;
		}
		if (type !== Tasks.CUSTOMIZED_TASK_TYPE && type !== 'shell' && type !== 'process') {
			context.problemReporter.error(nls.localize('ConfigurationParser.notCustom', 'Error: tasks is not declared as a custom task. The configuration will be ignored.\n{0}\n', JSON.stringify(external, null, 4)));
			return undefined;
		}
		let taskName = external.taskName;
		if (Types.isString(external.label) && context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0) {
			taskName = external.label;
		}
		if (!taskName) {
			context.problemReporter.error(nls.localize('ConfigurationParser.noTaskName', 'Error: a task must provide a label property. The task will be ignored.\n{0}\n', JSON.stringify(external, null, 4)));
			return undefined;
		}

		let result: Tasks.CustomTask = {
			type: Tasks.CUSTOMIZED_TASK_TYPE,
			_id: context.uuidMap.getUUID(taskName),
			_source: Objects.assign({}, source, { config: { index, element: external, file: '.vscode\\tasks.json', workspaceFolder: context.workspaceFolder } }),
			_label: taskName,
			name: taskName,
			identifier: taskName,
			hasDefinedMatchers: false,
			command: undefined
		};
		let configuration = ConfigurationProperties.from(external, context, false);
		if (configuration) {
			result = Objects.assign(result, configuration);
		}
		let supportLegacy: boolean = true; //context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0;
		if (supportLegacy) {
			let legacy: LegacyTaskProperties = external as LegacyTaskProperties;
			if (result.isBackground === void 0 && legacy.isWatching !== void 0) {
				result.isBackground = !!legacy.isWatching;
			}
			if (result.group === void 0) {
				if (legacy.isBuildCommand === true) {
					result.group = Tasks.TaskGroup.Build;
				} else if (legacy.isTestCommand === true) {
					result.group = Tasks.TaskGroup.Test;
				}
			}
		}
		let command: Tasks.CommandConfiguration = CommandConfiguration.from(external, context);
		if (command) {
			result.command = command;
		}
		if (external.command !== void 0) {
			// if the task has its own command then we suppress the
			// task name by default.
			command.suppressTaskName = true;
		}
		return result;
	}

	export function fillGlobals(task: Tasks.CustomTask, globals: Globals): void {
		// We only merge a command from a global definition if there is no dependsOn
		// or there is a dependsOn and a defined command.
		if (CommandConfiguration.hasCommand(task.command) || task.dependsOn === void 0) {
			task.command = CommandConfiguration.fillGlobals(task.command, globals.command, task.name);
		}
		if (task.problemMatchers === void 0 && globals.problemMatcher !== void 0) {
			task.problemMatchers = Objects.deepClone(globals.problemMatcher);
			task.hasDefinedMatchers = true;
		}
		// promptOnClose is inferred from isBackground if available
		if (task.promptOnClose === void 0 && task.isBackground === void 0 && globals.promptOnClose !== void 0) {
			task.promptOnClose = globals.promptOnClose;
		}
	}

	export function fillDefaults(task: Tasks.CustomTask, context: ParseContext): void {
		CommandConfiguration.fillDefaults(task.command, context);
		if (task.promptOnClose === void 0) {
			task.promptOnClose = task.isBackground !== void 0 ? !task.isBackground : true;
		}
		if (task.isBackground === void 0) {
			task.isBackground = false;
		}
		if (task.instanceLimit === void 0) {
			task.instanceLimit = false;
		}
		if (task.problemMatchers === void 0) {
			task.problemMatchers = EMPTY_ARRAY;
		}
		if (task.group !== void 0 && task.groupType === void 0) {
			task.groupType = Tasks.GroupType.user;
		}
	}

	export function createCustomTask(contributedTask: Tasks.ContributedTask, configuredProps: Tasks.ConfigurationProperties & { _id: string, _source: Tasks.WorkspaceTaskSource }): Tasks.CustomTask {
		let result: Tasks.CustomTask = {
			_id: configuredProps._id,
			_source: Objects.assign({}, configuredProps._source, { customizes: contributedTask.defines }),
			_label: configuredProps.name || contributedTask._label,
			type: Tasks.CUSTOMIZED_TASK_TYPE,
			command: contributedTask.command,
			name: configuredProps.name || contributedTask.name,
			identifier: configuredProps.identifier || contributedTask.identifier,
			hasDefinedMatchers: false
		};
		let resultConfigProps: Tasks.ConfigurationProperties = result;

		assignProperty(resultConfigProps, configuredProps, 'group');
		assignProperty(resultConfigProps, configuredProps, 'groupType');
		assignProperty(resultConfigProps, configuredProps, 'isBackground');
		assignProperty(resultConfigProps, configuredProps, 'instanceLimit');
		assignProperty(resultConfigProps, configuredProps, 'dependsOn');
		assignProperty(resultConfigProps, configuredProps, 'problemMatchers');
		assignProperty(resultConfigProps, configuredProps, 'promptOnClose');
		result.command.presentation = CommandConfiguration.PresentationOptions.assignProperties(
			result.command.presentation, configuredProps.presentation);
		result.command.options = CommandOptions.assignProperties(result.command.options, configuredProps.options);

		let contributedConfigProps: Tasks.ConfigurationProperties = contributedTask;
		fillProperty(resultConfigProps, contributedConfigProps, 'group');
		fillProperty(resultConfigProps, contributedConfigProps, 'groupType');
		fillProperty(resultConfigProps, contributedConfigProps, 'isBackground');
		fillProperty(resultConfigProps, contributedConfigProps, 'instanceLimit');
		fillProperty(resultConfigProps, contributedConfigProps, 'dependsOn');
		fillProperty(resultConfigProps, contributedConfigProps, 'problemMatchers');
		fillProperty(resultConfigProps, contributedConfigProps, 'promptOnClose');
		result.command.presentation = CommandConfiguration.PresentationOptions.fillProperties(
			result.command.presentation, contributedConfigProps.presentation);
		result.command.options = CommandOptions.fillProperties(result.command.options, contributedConfigProps.options);

		if (contributedTask.hasDefinedMatchers === true) {
			result.hasDefinedMatchers = true;
		}

		return result;
	}
}

interface TaskParseResult {
	custom: Tasks.CustomTask[];
	configured: Tasks.ConfiguringTask[];
}

namespace TaskParser {

	function isCustomTask(value: CustomTask | ConfiguringTask): value is CustomTask {
		let type = value.type;
		let customize = (value as any).customize;
		return customize === void 0 && (type === void 0 || type === null || type === Tasks.CUSTOMIZED_TASK_TYPE || type === 'shell' || type === 'process');
	}

	export function from(this: void, externals: (CustomTask | ConfiguringTask)[], globals: Globals, context: ParseContext): TaskParseResult {
		let result: TaskParseResult = { custom: [], configured: [] };
		if (!externals) {
			return result;
		}
		let defaultBuildTask: { task: Tasks.Task; rank: number; } = { task: undefined, rank: -1 };
		let defaultTestTask: { task: Tasks.Task; rank: number; } = { task: undefined, rank: -1 };
		let schema2_0_0: boolean = context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0;

		for (let index = 0; index < externals.length; index++) {
			let external = externals[index];
			if (isCustomTask(external)) {
				let customTask = CustomTask.from(external, context, index);
				if (customTask) {
					CustomTask.fillGlobals(customTask, globals);
					CustomTask.fillDefaults(customTask, context);
					if (schema2_0_0) {
						if ((customTask.command === void 0 || customTask.command.name === void 0) && (customTask.dependsOn === void 0 || customTask.dependsOn.length === 0)) {
							context.problemReporter.error(nls.localize(
								'taskConfiguration.noCommandOrDependsOn', 'Error: the task \'{0}\' neither specifies a command nor a dependsOn property. The task will be ignored. Its definition is:\n{1}',
								customTask.name, JSON.stringify(external, undefined, 4)
							));
							continue;
						}
					} else {
						if (customTask.command === void 0 || customTask.command.name === void 0) {
							context.problemReporter.warn(nls.localize(
								'taskConfiguration.noCommand', 'Error: the task \'{0}\' doesn\'t define a command. The task will be ignored. Its definition is:\n{1}',
								customTask.name, JSON.stringify(external, undefined, 4)
							));
							continue;
						}
					}
					if (customTask.group === Tasks.TaskGroup.Build && defaultBuildTask.rank < 2) {
						defaultBuildTask.task = customTask;
						defaultBuildTask.rank = 2;
					} else if (customTask.group === Tasks.TaskGroup.Test && defaultTestTask.rank < 2) {
						defaultTestTask.task = customTask;
						defaultTestTask.rank = 2;
					} else if (customTask.name === 'build' && defaultBuildTask.rank < 1) {
						defaultBuildTask.task = customTask;
						defaultBuildTask.rank = 1;
					} else if (customTask.name === 'test' && defaultTestTask.rank < 1) {
						defaultTestTask.task = customTask;
						defaultTestTask.rank = 1;
					}
					result.custom.push(customTask);
				}
			} else {
				let configuredTask = ConfiguringTask.from(external, context, index);
				if (configuredTask) {
					result.configured.push(configuredTask);
				}
			}
		}
		if (defaultBuildTask.rank > -1 && defaultBuildTask.rank < 2) {
			defaultBuildTask.task.group = Tasks.TaskGroup.Build;
			defaultBuildTask.task.groupType = Tasks.GroupType.user;
		} else if (defaultTestTask.rank > -1 && defaultTestTask.rank < 2) {
			defaultTestTask.task.group = Tasks.TaskGroup.Test;
			defaultTestTask.task.groupType = Tasks.GroupType.user;
		}

		return result;
	}

	export function assignTasks(target: Tasks.CustomTask[], source: Tasks.CustomTask[]): Tasks.CustomTask[] {
		if (source === void 0 || source.length === 0) {
			return target;
		}
		if (target === void 0 || target.length === 0) {
			return source;
		}

		if (source) {
			// Tasks are keyed by ID but we need to merge by name
			let map: IStringDictionary<Tasks.CustomTask> = Object.create(null);
			target.forEach((task) => {
				map[task.name] = task;
			});

			source.forEach((task) => {
				map[task.name] = task;
			});
			let newTarget: Tasks.CustomTask[] = [];
			target.forEach(task => {
				newTarget.push(map[task.name]);
				delete map[task.name];
			});
			Object.keys(map).forEach(key => newTarget.push(map[key]));
			target = newTarget;
		}
		return target;
	}
}

interface Globals {
	command?: Tasks.CommandConfiguration;
	problemMatcher?: ProblemMatcher[];
	promptOnClose?: boolean;
	suppressTaskName?: boolean;
}

namespace Globals {

	export function from(config: ExternalTaskRunnerConfiguration, context: ParseContext): Globals {
		let result = fromBase(config, context);
		let osGlobals: Globals | undefined = undefined;
		if (config.windows && context.platform === Platform.Windows) {
			osGlobals = fromBase(config.windows, context);
		} else if (config.osx && context.platform === Platform.Mac) {
			osGlobals = fromBase(config.osx, context);
		} else if (config.linux && context.platform === Platform.Linux) {
			osGlobals = fromBase(config.linux, context);
		}
		if (osGlobals) {
			result = Globals.assignProperties(result, osGlobals);
		}
		let command = CommandConfiguration.from(config, context);
		if (command) {
			result.command = command;
		}
		Globals.fillDefaults(result, context);
		Globals.freeze(result);
		return result;
	}

	export function fromBase(this: void, config: BaseTaskRunnerConfiguration, context: ParseContext): Globals {
		let result: Globals = {};
		if (config.suppressTaskName !== void 0) {
			result.suppressTaskName = !!config.suppressTaskName;
		}
		if (config.promptOnClose !== void 0) {
			result.promptOnClose = !!config.promptOnClose;
		}
		if (config.problemMatcher) {
			result.problemMatcher = ProblemMatcherConverter.from(config.problemMatcher, context);
		}
		return result;
	}

	export function isEmpty(value: Globals): boolean {
		return !value || value.command === void 0 && value.promptOnClose === void 0 && value.suppressTaskName === void 0;
	}

	export function assignProperties(target: Globals, source: Globals): Globals {
		if (isEmpty(source)) {
			return target;
		}
		if (isEmpty(target)) {
			return source;
		}
		assignProperty(target, source, 'promptOnClose');
		assignProperty(target, source, 'suppressTaskName');
		return target;
	}

	export function fillDefaults(value: Globals, context: ParseContext): void {
		if (!value) {
			return;
		}
		CommandConfiguration.fillDefaults(value.command, context);
		if (value.suppressTaskName === void 0) {
			value.suppressTaskName = false;
		}
		if (value.promptOnClose === void 0) {
			value.promptOnClose = true;
		}
	}

	export function freeze(value: Globals): void {
		Object.freeze(value);
		if (value.command) {
			CommandConfiguration.freeze(value.command);
		}
	}
}

export namespace ExecutionEngine {

	export function from(config: ExternalTaskRunnerConfiguration): Tasks.ExecutionEngine {
		let runner = config.runner || config._runner;
		let result: Tasks.ExecutionEngine;
		if (runner) {
			switch (runner) {
				case 'terminal':
					result = Tasks.ExecutionEngine.Terminal;
					break;
				case 'process':
					result = Tasks.ExecutionEngine.Process;
					break;
			}
		}
		let schemaVersion = JsonSchemaVersion.from(config);
		if (schemaVersion === Tasks.JsonSchemaVersion.V0_1_0) {
			return result || Tasks.ExecutionEngine.Process;
		} else if (schemaVersion === Tasks.JsonSchemaVersion.V2_0_0) {
			return Tasks.ExecutionEngine.Terminal;
		} else {
			throw new Error('Shouldn\'t happen.');
		}
	}
}

export namespace JsonSchemaVersion {

	const _default: Tasks.JsonSchemaVersion = Tasks.JsonSchemaVersion.V2_0_0;

	export function from(config: ExternalTaskRunnerConfiguration): Tasks.JsonSchemaVersion {
		let version = config.version;
		if (!version) {
			return _default;
		}
		switch (version) {
			case '0.1.0':
				return Tasks.JsonSchemaVersion.V0_1_0;
			case '2.0.0':
				return Tasks.JsonSchemaVersion.V2_0_0;
			default:
				return _default;
		}
	}
}

export interface ParseResult {
	validationStatus: ValidationStatus;
	custom: Tasks.CustomTask[];
	configured: Tasks.ConfiguringTask[];
	engine: Tasks.ExecutionEngine;
}

export interface IProblemReporter extends IProblemReporterBase {
}

class UUIDMap {

	private last: IStringDictionary<string | string[]>;
	private current: IStringDictionary<string | string[]>;

	constructor(other?: UUIDMap) {
		this.current = Object.create(null);
		if (other) {
			for (let key of Object.keys(other.current)) {
				let value = other.current[key];
				if (Array.isArray(value)) {
					this.current[key] = value.slice();
				} else {
					this.current[key] = value;
				}
			}
		}
	}

	public start(): void {
		this.last = this.current;
		this.current = Object.create(null);
	}

	public getUUID(identifier: string): string {
		let lastValue = this.last[identifier];
		let result: string;
		if (lastValue !== void 0) {
			if (Array.isArray(lastValue)) {
				result = lastValue.shift();
				if (lastValue.length === 0) {
					delete this.last[identifier];
				}
			} else {
				result = lastValue;
				delete this.last[identifier];
			}
		}
		if (result === void 0) {
			result = UUID.generateUuid();
		}
		let currentValue = this.current[identifier];
		if (currentValue === void 0) {
			this.current[identifier] = result;
		} else {
			if (Array.isArray(currentValue)) {
				currentValue.push(result);
			} else {
				let arrayValue: string[] = [currentValue];
				arrayValue.push(result);
				this.current[identifier] = arrayValue;
			}
		}
		return result;
	}

	public finish(): void {
		this.last = undefined;
	}
}

class ConfigurationParser {

	private workspaceFolder: IWorkspaceFolder;
	private problemReporter: IProblemReporter;
	private uuidMap: UUIDMap;
	private platform: Platform;

	constructor(workspaceFolder: IWorkspaceFolder, platform: Platform, problemReporter: IProblemReporter, uuidMap: UUIDMap) {
		this.workspaceFolder = workspaceFolder;
		this.platform = platform;
		this.problemReporter = problemReporter;
		this.uuidMap = uuidMap;
	}

	public run(fileConfig: ExternalTaskRunnerConfiguration): ParseResult {
		let engine = ExecutionEngine.from(fileConfig);
		let schemaVersion = JsonSchemaVersion.from(fileConfig);
		let context: ParseContext = {
			workspaceFolder: this.workspaceFolder,
			problemReporter: this.problemReporter,
			uuidMap: this.uuidMap,
			namedProblemMatchers: undefined,
			engine,
			schemaVersion,
			platform: this.platform
		};
		let taskParseResult = this.createTaskRunnerConfiguration(fileConfig, context);
		return {
			validationStatus: this.problemReporter.status,
			custom: taskParseResult.custom,
			configured: taskParseResult.configured,
			engine
		};
	}

	private createTaskRunnerConfiguration(fileConfig: ExternalTaskRunnerConfiguration, context: ParseContext): TaskParseResult {
		let globals = Globals.from(fileConfig, context);
		if (this.problemReporter.status.isFatal()) {
			return { custom: [], configured: [] };
		}
		context.namedProblemMatchers = ProblemMatcherConverter.namedFrom(fileConfig.declares, context);
		let globalTasks: Tasks.CustomTask[];
		let externalGlobalTasks: (ConfiguringTask | CustomTask)[];
		if (fileConfig.windows && context.platform === Platform.Windows) {
			globalTasks = TaskParser.from(fileConfig.windows.tasks, globals, context).custom;
			externalGlobalTasks = fileConfig.windows.tasks;
		} else if (fileConfig.osx && context.platform === Platform.Mac) {
			globalTasks = TaskParser.from(fileConfig.osx.tasks, globals, context).custom;
			externalGlobalTasks = fileConfig.osx.tasks;
		} else if (fileConfig.linux && context.platform === Platform.Linux) {
			globalTasks = TaskParser.from(fileConfig.linux.tasks, globals, context).custom;
			externalGlobalTasks = fileConfig.linux.tasks;
		}
		if (context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0 && globalTasks && globalTasks.length > 0 && externalGlobalTasks && externalGlobalTasks.length > 0) {
			let taskContent: string[] = [];
			for (let task of externalGlobalTasks) {
				taskContent.push(JSON.stringify(task, null, 4));
			}
			context.problemReporter.error(
				nls.localize(
					'TaskParse.noOsSpecificGlobalTasks',
					'Task version 2.0.0 doesn\'t support global OS specific tasks. Convert them to a task with a OS specific command. Affected tasks are:\n{0}', taskContent.join('\n'))
			);
		}

		let result: TaskParseResult = { custom: undefined, configured: undefined };
		if (fileConfig.tasks) {
			result = TaskParser.from(fileConfig.tasks, globals, context);
		}
		if (globalTasks) {
			result.custom = TaskParser.assignTasks(result.custom, globalTasks);
		}

		if ((!result.custom || result.custom.length === 0) && (globals.command && globals.command.name)) {
			let matchers: ProblemMatcher[] = ProblemMatcherConverter.from(fileConfig.problemMatcher, context);
			let isBackground = fileConfig.isBackground ? !!fileConfig.isBackground : fileConfig.isWatching ? !!fileConfig.isWatching : undefined;
			let instanceLimit = fileConfig.instanceLimit ? true : undefined;
			let name = Tasks.CommandString.value(globals.command.name);
			let task: Tasks.CustomTask = {
				_id: context.uuidMap.getUUID(name),
				_source: Objects.assign({}, source, { config: { index: -1, element: fileConfig, workspaceFolder: context.workspaceFolder } }),
				_label: name,
				type: Tasks.CUSTOMIZED_TASK_TYPE,
				name: name,
				identifier: name,
				group: Tasks.TaskGroup.Build,
				command: {
					name: undefined,
					runtime: undefined,
					presentation: undefined,
					suppressTaskName: true
				},
				isBackground: isBackground,
				instanceLimit: instanceLimit,
				problemMatchers: matchers,
				hasDefinedMatchers: false,
			};
			let value = GroupKind.from(fileConfig.group);
			if (value) {
				task.group = value[0];
				task.groupType = value[1];
			} else if (fileConfig.group === 'none') {
				task.group = undefined;
			}
			CustomTask.fillGlobals(task, globals);
			CustomTask.fillDefaults(task, context);
			result.custom = [task];
		}
		result.custom = result.custom || [];
		result.configured = result.configured || [];
		return result;
	}
}

let uuidMaps: Map<string, UUIDMap> = new Map();
export function parse(workspaceFolder: IWorkspaceFolder, platform: Platform, configuration: ExternalTaskRunnerConfiguration, logger: IProblemReporter): ParseResult {
	let uuidMap = uuidMaps.get(workspaceFolder.uri.toString());
	if (!uuidMap) {
		uuidMap = new UUIDMap();
		uuidMaps.set(workspaceFolder.uri.toString(), uuidMap);
	}
	try {
		uuidMap.start();
		return (new ConfigurationParser(workspaceFolder, platform, logger, uuidMap)).run(configuration);
	} finally {
		uuidMap.finish();
	}
}

export function createCustomTask(contributedTask: Tasks.ContributedTask, configuredProps: Tasks.ConfigurationProperties & { _id: string; _source: Tasks.WorkspaceTaskSource }): Tasks.CustomTask {
	return CustomTask.createCustomTask(contributedTask, configuredProps);
}

/*
class VersionConverter {
	constructor(private problemReporter: IProblemReporter) {
	}

	public convert(fromConfig: ExternalTaskRunnerConfiguration): ExternalTaskRunnerConfiguration {
		let result: ExternalTaskRunnerConfiguration;
		result.version = '2.0.0';
		if (Array.isArray(fromConfig.tasks)) {

		} else {
			result.tasks = [];
		}


		return result;
	}

	private convertGlobalTask(fromConfig: ExternalTaskRunnerConfiguration): TaskDescription {
		let command: string = this.getGlobalCommand(fromConfig);
		if (!command) {
			this.problemReporter.error(nls.localize('Converter.noGlobalName', 'No global command specified. Can\'t convert to 2.0.0 version.'));
			return undefined;
		}
		let result: TaskDescription = {
			taskName: command
		};
		if (fromConfig.isShellCommand) {
			result.type = 'shell';
		} else {
			result.type = 'process';
			result.args = fromConfig.args;
		}
		if (fromConfig.)

		return result;
	}

	private getGlobalCommand(fromConfig: ExternalTaskRunnerConfiguration): string {
		if (fromConfig.command) {
			return fromConfig.command;
		} else if (fromConfig.windows && fromConfig.windows.command) {
			return fromConfig.windows.command;
		} else if (fromConfig.osx && fromConfig.osx.command) {
			return fromConfig.osx.command;
		} else if (fromConfig.linux && fromConfig.linux.command) {
			return fromConfig.linux.command;
		} else {
			return undefined;
		}
	}

	private createCommandLine(command: string, args: string[], isWindows: boolean): string {
		let result: string[];
		let commandHasSpace = false;
		let argHasSpace = false;
		if (TaskDescription.hasUnescapedSpaces(command)) {
			result.push(`"${command}"`);
			commandHasSpace = true;
		} else {
			result.push(command);
		}
		if (args) {
			for (let arg of args) {
				if (TaskDescription.hasUnescapedSpaces(arg)) {
					result.push(`"${arg}"`);
					argHasSpace= true;
				} else {
					result.push(arg);
				}
			}
		}
		return result.join(' ');
	}

}
*/
