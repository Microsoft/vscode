/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

import * as Objects from 'vs/base/common/objects';
import { IStringDictionary } from 'vs/base/common/collections';
import { IJSONSchemaMap } from 'vs/base/common/jsonSchema';
import { Platform } from 'vs/base/common/platform';
import * as Types from 'vs/base/common/types';
import * as UUID from 'vs/base/common/uuid';

import { ValidationStatus, IProblemReporter as IProblemReporterBase } from 'vs/base/common/parsers';
import {
	NamedProblemMatcher, ProblemMatcher, ProblemMatcherParser, Config as ProblemMatcherConfig,
	isNamedProblemMatcher, ProblemMatcherRegistry
} from 'vs/workbench/contrib/tasks/common/problemMatcher';

import { IWorkspaceFolder, IWorkspace } from 'vs/platform/workspace/common/workspace';
import * as Tasks from './tasks';
import { TaskDefinitionRegistry } from './taskDefinitionRegistry';
import { ConfiguredInput } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { URI } from 'vs/base/common/uri';
import { USER_TASKS_GROUP_KEY, ShellExecutionSupportedContext, ProcessExecutionSupportedContext } from 'vs/workbench/contrib/tasks/common/taskService';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';

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

export interface CommandOptionsConfig {
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

export interface PresentationOptionsConfig {
	/**
	 * Controls whether the terminal executing a task is brought to front or not.
	 * Defaults to `RevealKind.Always`.
	 */
	reveal?: string;

	/**
	 * Controls whether the problems panel is revealed when running this task or not.
	 * Defaults to `RevealKind.Never`.
	 */
	revealProblems?: string;

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

	/**
	 * Controls whether the task is executed in a specific terminal group using split panes.
	 */
	group?: string;
}

export interface RunOptionsConfig {
	reevaluateOnRerun?: boolean;
	runOn?: string;
	instanceLimit?: number;
}

export interface TaskIdentifier {
	type?: string;
	[name: string]: any;
}

export namespace TaskIdentifier {
	export function is(value: any): value is TaskIdentifier {
		let candidate: TaskIdentifier = value;
		return candidate !== undefined && Types.isString(value.type);
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
	terminal?: PresentationOptionsConfig;

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
	options?: CommandOptionsConfig;

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
	 * An optional identifier which can be used to reference a task
	 * in a dependsOn or other attributes.
	 */
	identifier?: string;

	/**
	 * Whether the executed command is kept alive and runs in the background.
	 */
	isBackground?: boolean;

	/**
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * Defines the group the task belongs too.
	 */
	group?: string | GroupKind;

	/**
	 * A description of the task.
	 */
	detail?: string;

	/**
	 * The other tasks the task depend on
	 */
	dependsOn?: string | TaskIdentifier | Array<string | TaskIdentifier>;

	/**
	 * The order the dependsOn tasks should be executed in.
	 */
	dependsOrder?: string;

	/**
	 * Controls the behavior of the used terminal
	 */
	presentation?: PresentationOptionsConfig;

	/**
	 * Controls shell options.
	 */
	options?: CommandOptionsConfig;

	/**
	 * The problem matcher(s) to use to capture problems in the tasks
	 * output.
	 */
	problemMatcher?: ProblemMatcherConfig.ProblemMatcherType;

	/**
	 * Task run options. Control run related properties.
	 */
	runOptions?: RunOptionsConfig;
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
	options?: CommandOptionsConfig;

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
	presentation?: PresentationOptionsConfig;

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
	 * The problem matcher(s) to used if a global command is executed (e.g. no tasks
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
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * The configuration of the available tasks. A tasks.json file can either
	 * contain a global problemMatcher property or a tasks property but not both.
	 */
	tasks?: Array<CustomTask | ConfiguringTask>;

	/**
	 * Problem matcher declarations.
	 */
	declares?: ProblemMatcherConfig.NamedProblemMatcher[];

	/**
	 * Optional user input variables.
	 */
	inputs?: ConfiguredInput[];
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
	 * Linux specific task configuration
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
	const sourceAtKey = source[key];
	if (sourceAtKey !== undefined) {
		target[key] = sourceAtKey!;
	}
}

function fillProperty<T, K extends keyof T>(target: T, source: Partial<T>, key: K) {
	const sourceAtKey = source[key];
	if (target[key] === undefined && sourceAtKey !== undefined) {
		target[key] = sourceAtKey!;
	}
}


interface ParserType<T> {
	isEmpty(value: T | undefined): boolean;
	assignProperties(target: T | undefined, source: T | undefined): T | undefined;
	fillProperties(target: T | undefined, source: T | undefined): T | undefined;
	fillDefaults(value: T | undefined, context: ParseContext): T | undefined;
	freeze(value: T): Readonly<T> | undefined;
}

interface MetaData<T, U> {
	property: keyof T;
	type?: ParserType<U>;
}


function _isEmpty<T>(this: void, value: T | undefined, properties: MetaData<T, any>[] | undefined, allowEmptyArray: boolean = false): boolean {
	if (value === undefined || value === null || properties === undefined) {
		return true;
	}
	for (let meta of properties) {
		let property = value[meta.property];
		if (property !== undefined && property !== null) {
			if (meta.type !== undefined && !meta.type.isEmpty(property)) {
				return false;
			} else if (!Array.isArray(property) || (property.length > 0) || allowEmptyArray) {
				return false;
			}
		}
	}
	return true;
}

function _assignProperties<T>(this: void, target: T | undefined, source: T | undefined, properties: MetaData<T, any>[]): T | undefined {
	if (!source || _isEmpty(source, properties)) {
		return target;
	}
	if (!target || _isEmpty(target, properties)) {
		return source;
	}
	for (let meta of properties) {
		let property = meta.property;
		let value: any;
		if (meta.type !== undefined) {
			value = meta.type.assignProperties(target[property], source[property]);
		} else {
			value = source[property];
		}
		if (value !== undefined && value !== null) {
			target[property] = value;
		}
	}
	return target;
}

function _fillProperties<T>(this: void, target: T | undefined, source: T | undefined, properties: MetaData<T, any>[] | undefined, allowEmptyArray: boolean = false): T | undefined {
	if (!source || _isEmpty(source, properties)) {
		return target;
	}
	if (!target || _isEmpty(target, properties, allowEmptyArray)) {
		return source;
	}
	for (let meta of properties!) {
		let property = meta.property;
		let value: any;
		if (meta.type) {
			value = meta.type.fillProperties(target[property], source[property]);
		} else if (target[property] === undefined) {
			value = source[property];
		}
		if (value !== undefined && value !== null) {
			target[property] = value;
		}
	}
	return target;
}

function _fillDefaults<T>(this: void, target: T | undefined, defaults: T | undefined, properties: MetaData<T, any>[], context: ParseContext): T | undefined {
	if (target && Object.isFrozen(target)) {
		return target;
	}
	if (target === undefined || target === null || defaults === undefined || defaults === null) {
		if (defaults !== undefined && defaults !== null) {
			return Objects.deepClone(defaults);
		} else {
			return undefined;
		}
	}
	for (let meta of properties) {
		let property = meta.property;
		if (target[property] !== undefined) {
			continue;
		}
		let value: any;
		if (meta.type) {
			value = meta.type.fillDefaults(target[property], context);
		} else {
			value = defaults[property];
		}

		if (value !== undefined && value !== null) {
			target[property] = value;
		}
	}
	return target;
}

function _freeze<T>(this: void, target: T, properties: MetaData<T, any>[]): Readonly<T> | undefined {
	if (target === undefined || target === null) {
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

export namespace RunOnOptions {
	export function fromString(value: string | undefined): Tasks.RunOnOptions {
		if (!value) {
			return Tasks.RunOnOptions.default;
		}
		switch (value.toLowerCase()) {
			case 'folderopen':
				return Tasks.RunOnOptions.folderOpen;
			case 'default':
			default:
				return Tasks.RunOnOptions.default;
		}
	}
}

export namespace RunOptions {
	const properties: MetaData<Tasks.RunOptions, void>[] = [{ property: 'reevaluateOnRerun' }, { property: 'runOn' }, { property: 'instanceLimit' }];
	export function fromConfiguration(value: RunOptionsConfig | undefined): Tasks.RunOptions {
		return {
			reevaluateOnRerun: value ? value.reevaluateOnRerun : true,
			runOn: value ? RunOnOptions.fromString(value.runOn) : Tasks.RunOnOptions.default,
			instanceLimit: value ? value.instanceLimit : 1
		};
	}

	export function assignProperties(target: Tasks.RunOptions, source: Tasks.RunOptions | undefined): Tasks.RunOptions {
		return _assignProperties(target, source, properties)!;
	}

	export function fillProperties(target: Tasks.RunOptions, source: Tasks.RunOptions | undefined): Tasks.RunOptions {
		return _fillProperties(target, source, properties)!;
	}
}

interface ParseContext {
	workspaceFolder: IWorkspaceFolder;
	workspace: IWorkspace | undefined;
	problemReporter: IProblemReporter;
	namedProblemMatchers: IStringDictionary<NamedProblemMatcher>;
	uuidMap: UUIDMap;
	engine: Tasks.ExecutionEngine;
	schemaVersion: Tasks.JsonSchemaVersion;
	platform: Platform;
	taskLoadIssues: string[];
	contextKeyService: IContextKeyService;
}


namespace ShellConfiguration {

	const properties: MetaData<Tasks.ShellConfiguration, void>[] = [{ property: 'executable' }, { property: 'args' }, { property: 'quoting' }];

	export function is(value: any): value is ShellConfiguration {
		let candidate: ShellConfiguration = value;
		return candidate && (Types.isString(candidate.executable) || Types.isStringArray(candidate.args));
	}

	export function from(this: void, config: ShellConfiguration | undefined, context: ParseContext): Tasks.ShellConfiguration | undefined {
		if (!is(config)) {
			return undefined;
		}
		let result: ShellConfiguration = {};
		if (config.executable !== undefined) {
			result.executable = config.executable;
		}
		if (config.args !== undefined) {
			result.args = config.args.slice();
		}
		if (config.quoting !== undefined) {
			result.quoting = Objects.deepClone(config.quoting);
		}

		return result;
	}

	export function isEmpty(this: void, value: Tasks.ShellConfiguration): boolean {
		return _isEmpty(value, properties, true);
	}

	export function assignProperties(this: void, target: Tasks.ShellConfiguration | undefined, source: Tasks.ShellConfiguration | undefined): Tasks.ShellConfiguration | undefined {
		return _assignProperties(target, source, properties);
	}

	export function fillProperties(this: void, target: Tasks.ShellConfiguration, source: Tasks.ShellConfiguration): Tasks.ShellConfiguration | undefined {
		return _fillProperties(target, source, properties, true);
	}

	export function fillDefaults(this: void, value: Tasks.ShellConfiguration, context: ParseContext): Tasks.ShellConfiguration {
		return value;
	}

	export function freeze(this: void, value: Tasks.ShellConfiguration): Readonly<Tasks.ShellConfiguration> | undefined {
		if (!value) {
			return undefined;
		}
		return Object.freeze(value);
	}
}

namespace CommandOptions {

	const properties: MetaData<Tasks.CommandOptions, Tasks.ShellConfiguration>[] = [{ property: 'cwd' }, { property: 'env' }, { property: 'shell', type: ShellConfiguration }];
	const defaults: CommandOptionsConfig = { cwd: '${workspaceFolder}' };

	export function from(this: void, options: CommandOptionsConfig, context: ParseContext): Tasks.CommandOptions | undefined {
		let result: Tasks.CommandOptions = {};
		if (options.cwd !== undefined) {
			if (Types.isString(options.cwd)) {
				result.cwd = options.cwd;
			} else {
				context.taskLoadIssues.push(nls.localize('ConfigurationParser.invalidCWD', 'Warning: options.cwd must be of type string. Ignoring value {0}\n', options.cwd));
			}
		}
		if (options.env !== undefined) {
			result.env = Objects.deepClone(options.env);
		}
		result.shell = ShellConfiguration.from(options.shell, context);
		return isEmpty(result) ? undefined : result;
	}

	export function isEmpty(value: Tasks.CommandOptions | undefined): boolean {
		return _isEmpty(value, properties);
	}

	export function assignProperties(target: Tasks.CommandOptions | undefined, source: Tasks.CommandOptions | undefined): Tasks.CommandOptions | undefined {
		if ((source === undefined) || isEmpty(source)) {
			return target;
		}
		if ((target === undefined) || isEmpty(target)) {
			return source;
		}
		assignProperty(target, source, 'cwd');
		if (target.env === undefined) {
			target.env = source.env;
		} else if (source.env !== undefined) {
			let env: { [key: string]: string; } = Object.create(null);
			if (target.env !== undefined) {
				Object.keys(target.env).forEach(key => env[key] = target.env![key]);
			}
			if (source.env !== undefined) {
				Object.keys(source.env).forEach(key => env[key] = source.env![key]);
			}
			target.env = env;
		}
		target.shell = ShellConfiguration.assignProperties(target.shell, source.shell);
		return target;
	}

	export function fillProperties(target: Tasks.CommandOptions | undefined, source: Tasks.CommandOptions | undefined): Tasks.CommandOptions | undefined {
		return _fillProperties(target, source, properties);
	}

	export function fillDefaults(value: Tasks.CommandOptions | undefined, context: ParseContext): Tasks.CommandOptions | undefined {
		return _fillDefaults(value, defaults, properties, context);
	}

	export function freeze(value: Tasks.CommandOptions): Readonly<Tasks.CommandOptions> | undefined {
		return _freeze(value, properties);
	}
}

namespace CommandConfiguration {

	export namespace PresentationOptions {
		const properties: MetaData<Tasks.PresentationOptions, void>[] = [{ property: 'echo' }, { property: 'reveal' }, { property: 'revealProblems' }, { property: 'focus' }, { property: 'panel' }, { property: 'showReuseMessage' }, { property: 'clear' }, { property: 'group' }];

		interface PresentationOptionsShape extends LegacyCommandProperties {
			presentation?: PresentationOptionsConfig;
		}

		export function from(this: void, config: PresentationOptionsShape, context: ParseContext): Tasks.PresentationOptions | undefined {
			let echo: boolean;
			let reveal: Tasks.RevealKind;
			let revealProblems: Tasks.RevealProblemKind;
			let focus: boolean;
			let panel: Tasks.PanelKind;
			let showReuseMessage: boolean;
			let clear: boolean;
			let group: string | undefined;
			let hasProps = false;
			if (Types.isBoolean(config.echoCommand)) {
				echo = config.echoCommand;
				hasProps = true;
			}
			if (Types.isString(config.showOutput)) {
				reveal = Tasks.RevealKind.fromString(config.showOutput);
				hasProps = true;
			}
			let presentation = config.presentation || config.terminal;
			if (presentation) {
				if (Types.isBoolean(presentation.echo)) {
					echo = presentation.echo;
				}
				if (Types.isString(presentation.reveal)) {
					reveal = Tasks.RevealKind.fromString(presentation.reveal);
				}
				if (Types.isString(presentation.revealProblems)) {
					revealProblems = Tasks.RevealProblemKind.fromString(presentation.revealProblems);
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
				if (Types.isString(presentation.group)) {
					group = presentation.group;
				}
				hasProps = true;
			}
			if (!hasProps) {
				return undefined;
			}
			return { echo: echo!, reveal: reveal!, revealProblems: revealProblems!, focus: focus!, panel: panel!, showReuseMessage: showReuseMessage!, clear: clear!, group };
		}

		export function assignProperties(target: Tasks.PresentationOptions, source: Tasks.PresentationOptions | undefined): Tasks.PresentationOptions | undefined {
			return _assignProperties(target, source, properties);
		}

		export function fillProperties(target: Tasks.PresentationOptions, source: Tasks.PresentationOptions | undefined): Tasks.PresentationOptions | undefined {
			return _fillProperties(target, source, properties);
		}

		export function fillDefaults(value: Tasks.PresentationOptions, context: ParseContext): Tasks.PresentationOptions | undefined {
			let defaultEcho = context.engine === Tasks.ExecutionEngine.Terminal ? true : false;
			return _fillDefaults(value, { echo: defaultEcho, reveal: Tasks.RevealKind.Always, revealProblems: Tasks.RevealProblemKind.Never, focus: false, panel: Tasks.PanelKind.Shared, showReuseMessage: true, clear: false }, properties, context);
		}

		export function freeze(value: Tasks.PresentationOptions): Readonly<Tasks.PresentationOptions> | undefined {
			return _freeze(value, properties);
		}

		export function isEmpty(this: void, value: Tasks.PresentationOptions): boolean {
			return _isEmpty(value, properties);
		}
	}

	namespace ShellString {
		export function from(this: void, value: CommandString | undefined): Tasks.CommandString | undefined {
			if (value === undefined || value === null) {
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

	interface BaseCommandConfigurationShape extends BaseCommandProperties, LegacyCommandProperties {
	}

	interface CommandConfigurationShape extends BaseCommandConfigurationShape {
		windows?: BaseCommandConfigurationShape;
		osx?: BaseCommandConfigurationShape;
		linux?: BaseCommandConfigurationShape;
	}

	const properties: MetaData<Tasks.CommandConfiguration, any>[] = [
		{ property: 'runtime' }, { property: 'name' }, { property: 'options', type: CommandOptions },
		{ property: 'args' }, { property: 'taskSelector' }, { property: 'suppressTaskName' },
		{ property: 'presentation', type: PresentationOptions }
	];

	export function from(this: void, config: CommandConfigurationShape, context: ParseContext): Tasks.CommandConfiguration | undefined {
		let result: Tasks.CommandConfiguration = fromBase(config, context)!;

		let osConfig: Tasks.CommandConfiguration | undefined = undefined;
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

	function fromBase(this: void, config: BaseCommandConfigurationShape, context: ParseContext): Tasks.CommandConfiguration | undefined {
		let name: Tasks.CommandString | undefined = ShellString.from(config.command);
		let runtime: Tasks.RuntimeType;
		if (Types.isString(config.type)) {
			if (config.type === 'shell' || config.type === 'process') {
				runtime = Tasks.RuntimeType.fromString(config.type);
			}
		}
		let isShellConfiguration = ShellConfiguration.is(config.isShellCommand);
		if (Types.isBoolean(config.isShellCommand) || isShellConfiguration) {
			runtime = Tasks.RuntimeType.Shell;
		} else if (config.isShellCommand !== undefined) {
			runtime = !!config.isShellCommand ? Tasks.RuntimeType.Shell : Tasks.RuntimeType.Process;
		}

		let result: Tasks.CommandConfiguration = {
			name: name,
			runtime: runtime!,
			presentation: PresentationOptions.from(config, context)!
		};

		if (config.args !== undefined) {
			result.args = [];
			for (let arg of config.args) {
				let converted = ShellString.from(arg);
				if (converted !== undefined) {
					result.args.push(converted);
				} else {
					context.taskLoadIssues.push(
						nls.localize(
							'ConfigurationParser.inValidArg',
							'Error: command argument must either be a string or a quoted string. Provided value is:\n{0}',
							arg ? JSON.stringify(arg, undefined, 4) : 'undefined'
						));
				}
			}
		}
		if (config.options !== undefined) {
			result.options = CommandOptions.from(config.options, context);
			if (result.options && result.options.shell === undefined && isShellConfiguration) {
				result.options.shell = ShellConfiguration.from(config.isShellCommand as ShellConfiguration, context);
				if (context.engine !== Tasks.ExecutionEngine.Terminal) {
					context.taskLoadIssues.push(nls.localize('ConfigurationParser.noShell', 'Warning: shell configuration is only supported when executing tasks in the terminal.'));
				}
			}
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

	export function isEmpty(value: Tasks.CommandConfiguration | undefined): boolean {
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
		if (source.args !== undefined) {
			if (target.args === undefined || overwriteArgs) {
				target.args = source.args;
			} else {
				target.args = target.args.concat(source.args);
			}
		}
		target.presentation = PresentationOptions.assignProperties(target.presentation!, source.presentation)!;
		target.options = CommandOptions.assignProperties(target.options, source.options);
		return target;
	}

	export function fillProperties(target: Tasks.CommandConfiguration, source: Tasks.CommandConfiguration): Tasks.CommandConfiguration | undefined {
		return _fillProperties(target, source, properties);
	}

	export function fillGlobals(target: Tasks.CommandConfiguration, source: Tasks.CommandConfiguration | undefined, taskName: string | undefined): Tasks.CommandConfiguration {
		if ((source === undefined) || isEmpty(source)) {
			return target;
		}
		target = target || {
			name: undefined,
			runtime: undefined,
			presentation: undefined
		};
		if (target.name === undefined) {
			fillProperty(target, source, 'name');
			fillProperty(target, source, 'taskSelector');
			fillProperty(target, source, 'suppressTaskName');
			let args: Tasks.CommandString[] = source.args ? source.args.slice() : [];
			if (!target.suppressTaskName && taskName) {
				if (target.taskSelector !== undefined) {
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

		target.presentation = PresentationOptions.fillProperties(target.presentation!, source.presentation)!;
		target.options = CommandOptions.fillProperties(target.options, source.options);

		return target;
	}

	export function fillDefaults(value: Tasks.CommandConfiguration | undefined, context: ParseContext): void {
		if (!value || Object.isFrozen(value)) {
			return;
		}
		if (value.name !== undefined && value.runtime === undefined) {
			value.runtime = Tasks.RuntimeType.Process;
		}
		value.presentation = PresentationOptions.fillDefaults(value.presentation!, context)!;
		if (!isEmpty(value)) {
			value.options = CommandOptions.fillDefaults(value.options, context);
		}
		if (value.args === undefined) {
			value.args = EMPTY_ARRAY;
		}
		if (value.suppressTaskName === undefined) {
			value.suppressTaskName = (context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0);
		}
	}

	export function freeze(value: Tasks.CommandConfiguration): Readonly<Tasks.CommandConfiguration> | undefined {
		return _freeze(value, properties);
	}
}

namespace ProblemMatcherConverter {

	export function namedFrom(this: void, declares: ProblemMatcherConfig.NamedProblemMatcher[] | undefined, context: ParseContext): IStringDictionary<NamedProblemMatcher> {
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

	export function fromWithOsConfig(this: void, external: ConfigurationProperties & { [key: string]: any; }, context: ParseContext): ProblemMatcher[] | undefined {
		let result: ProblemMatcher[] | undefined = undefined;
		if (external.windows && external.windows.problemMatcher && context.platform === Platform.Windows) {
			result = from(external.windows.problemMatcher, context);
		} else if (external.osx && external.osx.problemMatcher && context.platform === Platform.Mac) {
			result = from(external.osx.problemMatcher, context);
		} else if (external.linux && external.linux.problemMatcher && context.platform === Platform.Linux) {
			result = from(external.linux.problemMatcher, context);
		} else if (external.problemMatcher) {
			result = from(external.problemMatcher, context);
		}
		return result;
	}

	export function from(this: void, config: ProblemMatcherConfig.ProblemMatcherType | undefined, context: ParseContext): ProblemMatcher[] {
		let result: ProblemMatcher[] = [];
		if (config === undefined) {
			return result;
		}
		let kind = getProblemMatcherKind(config);
		if (kind === ProblemMatcherKind.Unknown) {
			context.problemReporter.warn(nls.localize(
				'ConfigurationParser.unknownMatcherKind',
				'Warning: the defined problem matcher is unknown. Supported types are string | ProblemMatcher | Array<string | ProblemMatcher>.\n{0}\n',
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

	function resolveProblemMatcher(this: void, value: string | ProblemMatcherConfig.ProblemMatcher, context: ParseContext): ProblemMatcher | undefined {
		if (Types.isString(value)) {
			let variableName = <string>value;
			if (variableName.length > 1 && variableName[0] === '$') {
				variableName = variableName.substring(1);
				let global = ProblemMatcherRegistry.get(variableName);
				if (global) {
					return Objects.deepClone(global);
				}
				let localProblemMatcher: ProblemMatcher & Partial<NamedProblemMatcher> = context.namedProblemMatchers[variableName];
				if (localProblemMatcher) {
					localProblemMatcher = Objects.deepClone(localProblemMatcher);
					// remove the name
					delete localProblemMatcher.name;
					return localProblemMatcher;
				}
			}
			context.taskLoadIssues.push(nls.localize('ConfigurationParser.invalidVariableReference', 'Error: Invalid problemMatcher reference: {0}\n', value));
			return undefined;
		} else {
			let json = <ProblemMatcherConfig.ProblemMatcher>value;
			return new ProblemMatcherParser(context.problemReporter).parse(json);
		}
	}
}

const partialSource: Partial<Tasks.TaskSource> = {
	label: 'Workspace',
	config: undefined
};

namespace GroupKind {
	export function from(this: void, external: string | GroupKind | undefined): [string, Tasks.GroupType] | undefined {
		if (external === undefined) {
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
	function uriFromSource(context: ParseContext, source: TaskConfigSource): URI | string {
		switch (source) {
			case TaskConfigSource.User: return USER_TASKS_GROUP_KEY;
			case TaskConfigSource.TasksJson: return context.workspaceFolder.uri;
			default: return context.workspace && context.workspace.configuration ? context.workspace.configuration : context.workspaceFolder.uri;
		}
	}

	export function from(this: void, external: string | TaskIdentifier, context: ParseContext, source: TaskConfigSource): Tasks.TaskDependency | undefined {
		if (Types.isString(external)) {
			return { uri: uriFromSource(context, source), task: external };
		} else if (TaskIdentifier.is(external)) {
			return {
				uri: uriFromSource(context, source),
				task: Tasks.TaskDefinition.createTaskIdentifier(external as Tasks.TaskIdentifier, context.problemReporter)
			};
		} else {
			return undefined;
		}
	}
}

namespace DependsOrder {
	export function from(order: string | undefined): Tasks.DependsOrder {
		switch (order) {
			case Tasks.DependsOrder.sequence:
				return Tasks.DependsOrder.sequence;
			case Tasks.DependsOrder.parallel:
			default:
				return Tasks.DependsOrder.parallel;
		}
	}
}

namespace ConfigurationProperties {

	const properties: MetaData<Tasks.ConfigurationProperties, any>[] = [

		{ property: 'name' }, { property: 'identifier' }, { property: 'group' }, { property: 'isBackground' },
		{ property: 'promptOnClose' }, { property: 'dependsOn' },
		{ property: 'presentation', type: CommandConfiguration.PresentationOptions }, { property: 'problemMatchers' },
		{ property: 'options' }
	];

	export function from(this: void, external: ConfigurationProperties & { [key: string]: any; }, context: ParseContext, includeCommandOptions: boolean, source: TaskConfigSource, properties?: IJSONSchemaMap): Tasks.ConfigurationProperties | undefined {
		if (!external) {
			return undefined;
		}
		let result: Tasks.ConfigurationProperties & { [key: string]: any; } = {};

		if (properties) {
			for (const propertyName of Object.keys(properties)) {
				if (external[propertyName] !== undefined) {
					result[propertyName] = Objects.deepClone(external[propertyName]);
				}
			}
		}

		if (Types.isString(external.taskName)) {
			result.name = external.taskName;
		}
		if (Types.isString(external.label) && context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0) {
			result.name = external.label;
		}
		if (Types.isString(external.identifier)) {
			result.identifier = external.identifier;
		}
		if (external.isBackground !== undefined) {
			result.isBackground = !!external.isBackground;
		}
		if (external.promptOnClose !== undefined) {
			result.promptOnClose = !!external.promptOnClose;
		}
		if (external.group !== undefined) {
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
		if (external.dependsOn !== undefined) {
			if (Types.isArray(external.dependsOn)) {
				result.dependsOn = external.dependsOn.reduce((dependencies: Tasks.TaskDependency[], item): Tasks.TaskDependency[] => {
					const dependency = TaskDependency.from(item, context, source);
					if (dependency) {
						dependencies.push(dependency);
					}
					return dependencies;
				}, []);
			} else {
				const dependsOnValue = TaskDependency.from(external.dependsOn, context, source);
				result.dependsOn = dependsOnValue ? [dependsOnValue] : undefined;
			}
		}
		result.dependsOrder = DependsOrder.from(external.dependsOrder);
		if (includeCommandOptions && (external.presentation !== undefined || (external as LegacyCommandProperties).terminal !== undefined)) {
			result.presentation = CommandConfiguration.PresentationOptions.from(external, context);
		}
		if (includeCommandOptions && (external.options !== undefined)) {
			result.options = CommandOptions.from(external.options, context);
		}
		const configProblemMatcher = ProblemMatcherConverter.fromWithOsConfig(external, context);
		if (configProblemMatcher !== undefined) {
			result.problemMatchers = configProblemMatcher;
		}
		if (external.detail) {
			result.detail = external.detail;
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

	export function from(this: void, external: ConfiguringTask, context: ParseContext, index: number, source: TaskConfigSource): Tasks.ConfiguringTask | undefined {
		if (!external) {
			return undefined;
		}
		let type = external.type;
		let customize = (external as CustomizeShape).customize;
		if (!type && !customize) {
			context.problemReporter.error(nls.localize('ConfigurationParser.noTaskType', 'Error: tasks configuration must have a type property. The configuration will be ignored.\n{0}\n', JSON.stringify(external, null, 4)));
			return undefined;
		}
		let typeDeclaration = type ? TaskDefinitionRegistry.get(type) : undefined;
		if (!typeDeclaration) {
			let message = nls.localize('ConfigurationParser.noTypeDefinition', 'Error: there is no registered task type \'{0}\'. Did you miss to install an extension that provides a corresponding task provider?', type);
			context.problemReporter.error(message);
			return undefined;
		}
		let identifier: Tasks.TaskIdentifier | undefined;
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
		if (identifier === undefined) {
			context.problemReporter.error(nls.localize(
				'ConfigurationParser.missingType',
				'Error: the task configuration \'{0}\' is missing the required property \'type\'. The task configuration will be ignored.', JSON.stringify(external, undefined, 0)
			));
			return undefined;
		}
		let taskIdentifier: Tasks.KeyedTaskIdentifier | undefined = Tasks.TaskDefinition.createTaskIdentifier(identifier, context.problemReporter);
		if (taskIdentifier === undefined) {
			context.problemReporter.error(nls.localize(
				'ConfigurationParser.incorrectType',
				'Error: the task configuration \'{0}\' is using an unknown type. The task configuration will be ignored.', JSON.stringify(external, undefined, 0)
			));
			return undefined;
		}
		let configElement: Tasks.TaskSourceConfigElement = {
			workspaceFolder: context.workspaceFolder,
			file: '.vscode/tasks.json',
			index,
			element: external
		};
		let taskSource: Tasks.FileBasedTaskSource;
		switch (source) {
			case TaskConfigSource.User: {
				taskSource = Object.assign({} as Tasks.UserTaskSource, partialSource, { kind: Tasks.TaskSourceKind.User, config: configElement });
				break;
			}
			case TaskConfigSource.WorkspaceFile: {
				taskSource = Object.assign({} as Tasks.WorkspaceFileTaskSource, partialSource, { kind: Tasks.TaskSourceKind.WorkspaceFile, config: configElement });
				break;
			}
			default: {
				taskSource = Object.assign({} as Tasks.WorkspaceTaskSource, partialSource, { kind: Tasks.TaskSourceKind.Workspace, config: configElement });
				break;
			}
		}
		let result: Tasks.ConfiguringTask = new Tasks.ConfiguringTask(
			`${typeDeclaration.extensionId}.${taskIdentifier._key}`,
			taskSource,
			undefined,
			type,
			taskIdentifier,
			RunOptions.fromConfiguration(external.runOptions),
			{}
		);
		let configuration = ConfigurationProperties.from(external, context, true, source, typeDeclaration.properties);
		if (configuration) {
			result.configurationProperties = Object.assign(result.configurationProperties, configuration);
			if (result.configurationProperties.name) {
				result._label = result.configurationProperties.name;
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
			if (!result.configurationProperties.identifier) {
				result.configurationProperties.identifier = taskIdentifier._key;
			}
		}
		return result;
	}
}

namespace CustomTask {
	export function from(this: void, external: CustomTask, context: ParseContext, index: number, source: TaskConfigSource): Tasks.CustomTask | undefined {
		if (!external) {
			return undefined;
		}
		let type = external.type;
		if (type === undefined || type === null) {
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

		let taskSource: Tasks.FileBasedTaskSource;
		switch (source) {
			case TaskConfigSource.User: {
				taskSource = Object.assign({} as Tasks.UserTaskSource, partialSource, { kind: Tasks.TaskSourceKind.User, config: { index, element: external, file: '.vscode/tasks.json', workspaceFolder: context.workspaceFolder } });
				break;
			}
			case TaskConfigSource.WorkspaceFile: {
				taskSource = Object.assign({} as Tasks.WorkspaceFileTaskSource, partialSource, { kind: Tasks.TaskSourceKind.WorkspaceFile, config: { index, element: external, file: '.vscode/tasks.json', workspaceFolder: context.workspaceFolder, workspace: context.workspace } });
				break;
			}
			default: {
				taskSource = Object.assign({} as Tasks.WorkspaceTaskSource, partialSource, { kind: Tasks.TaskSourceKind.Workspace, config: { index, element: external, file: '.vscode/tasks.json', workspaceFolder: context.workspaceFolder } });
				break;
			}
		}

		let result: Tasks.CustomTask = new Tasks.CustomTask(
			context.uuidMap.getUUID(taskName),
			taskSource,
			taskName,
			Tasks.CUSTOMIZED_TASK_TYPE,
			undefined,
			false,
			RunOptions.fromConfiguration(external.runOptions),
			{
				name: taskName,
				identifier: taskName,
			}
		);
		let configuration = ConfigurationProperties.from(external, context, false, source);
		if (configuration) {
			result.configurationProperties = Object.assign(result.configurationProperties, configuration);
		}
		let supportLegacy: boolean = true; //context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0;
		if (supportLegacy) {
			let legacy: LegacyTaskProperties = external as LegacyTaskProperties;
			if (result.configurationProperties.isBackground === undefined && legacy.isWatching !== undefined) {
				result.configurationProperties.isBackground = !!legacy.isWatching;
			}
			if (result.configurationProperties.group === undefined) {
				if (legacy.isBuildCommand === true) {
					result.configurationProperties.group = Tasks.TaskGroup.Build;
				} else if (legacy.isTestCommand === true) {
					result.configurationProperties.group = Tasks.TaskGroup.Test;
				}
			}
		}
		let command: Tasks.CommandConfiguration = CommandConfiguration.from(external, context)!;
		if (command) {
			result.command = command;
		}
		if (external.command !== undefined) {
			// if the task has its own command then we suppress the
			// task name by default.
			command.suppressTaskName = true;
		}
		return result;
	}

	export function fillGlobals(task: Tasks.CustomTask, globals: Globals): void {
		// We only merge a command from a global definition if there is no dependsOn
		// or there is a dependsOn and a defined command.
		if (CommandConfiguration.hasCommand(task.command) || task.configurationProperties.dependsOn === undefined) {
			task.command = CommandConfiguration.fillGlobals(task.command, globals.command, task.configurationProperties.name);
		}
		if (task.configurationProperties.problemMatchers === undefined && globals.problemMatcher !== undefined) {
			task.configurationProperties.problemMatchers = Objects.deepClone(globals.problemMatcher);
			task.hasDefinedMatchers = true;
		}
		// promptOnClose is inferred from isBackground if available
		if (task.configurationProperties.promptOnClose === undefined && task.configurationProperties.isBackground === undefined && globals.promptOnClose !== undefined) {
			task.configurationProperties.promptOnClose = globals.promptOnClose;
		}
	}

	export function fillDefaults(task: Tasks.CustomTask, context: ParseContext): void {
		CommandConfiguration.fillDefaults(task.command, context);
		if (task.configurationProperties.promptOnClose === undefined) {
			task.configurationProperties.promptOnClose = task.configurationProperties.isBackground !== undefined ? !task.configurationProperties.isBackground : true;
		}
		if (task.configurationProperties.isBackground === undefined) {
			task.configurationProperties.isBackground = false;
		}
		if (task.configurationProperties.problemMatchers === undefined) {
			task.configurationProperties.problemMatchers = EMPTY_ARRAY;
		}
		if (task.configurationProperties.group !== undefined && task.configurationProperties.groupType === undefined) {
			task.configurationProperties.groupType = Tasks.GroupType.user;
		}
	}

	export function createCustomTask(contributedTask: Tasks.ContributedTask, configuredProps: Tasks.ConfiguringTask | Tasks.CustomTask): Tasks.CustomTask {
		let result: Tasks.CustomTask = new Tasks.CustomTask(
			configuredProps._id,
			Object.assign({}, configuredProps._source, { customizes: contributedTask.defines }),
			configuredProps.configurationProperties.name || contributedTask._label,
			Tasks.CUSTOMIZED_TASK_TYPE,
			contributedTask.command,
			false,
			contributedTask.runOptions,
			{
				name: configuredProps.configurationProperties.name || contributedTask.configurationProperties.name,
				identifier: configuredProps.configurationProperties.identifier || contributedTask.configurationProperties.identifier,
			}
		);
		result.addTaskLoadMessages(configuredProps.taskLoadMessages);
		let resultConfigProps: Tasks.ConfigurationProperties = result.configurationProperties;

		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'group');
		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'groupType');
		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'isBackground');
		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'dependsOn');
		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'problemMatchers');
		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'promptOnClose');
		assignProperty(resultConfigProps, configuredProps.configurationProperties, 'detail');
		result.command.presentation = CommandConfiguration.PresentationOptions.assignProperties(
			result.command.presentation!, configuredProps.configurationProperties.presentation)!;
		result.command.options = CommandOptions.assignProperties(result.command.options, configuredProps.configurationProperties.options);
		result.runOptions = RunOptions.assignProperties(result.runOptions, configuredProps.runOptions);

		let contributedConfigProps: Tasks.ConfigurationProperties = contributedTask.configurationProperties;
		fillProperty(resultConfigProps, contributedConfigProps, 'group');
		fillProperty(resultConfigProps, contributedConfigProps, 'groupType');
		fillProperty(resultConfigProps, contributedConfigProps, 'isBackground');
		fillProperty(resultConfigProps, contributedConfigProps, 'dependsOn');
		fillProperty(resultConfigProps, contributedConfigProps, 'problemMatchers');
		fillProperty(resultConfigProps, contributedConfigProps, 'promptOnClose');
		fillProperty(resultConfigProps, contributedConfigProps, 'detail');
		result.command.presentation = CommandConfiguration.PresentationOptions.fillProperties(
			result.command.presentation!, contributedConfigProps.presentation)!;
		result.command.options = CommandOptions.fillProperties(result.command.options, contributedConfigProps.options);
		result.runOptions = RunOptions.fillProperties(result.runOptions, contributedTask.runOptions);

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
		return customize === undefined && (type === undefined || type === null || type === Tasks.CUSTOMIZED_TASK_TYPE || type === 'shell' || type === 'process');
	}

	const builtinTypeContextMap: IStringDictionary<RawContextKey<boolean>> = {
		shell: ShellExecutionSupportedContext,
		process: ProcessExecutionSupportedContext
	};

	export function from(this: void, externals: Array<CustomTask | ConfiguringTask> | undefined, globals: Globals, context: ParseContext, source: TaskConfigSource): TaskParseResult {
		let result: TaskParseResult = { custom: [], configured: [] };
		if (!externals) {
			return result;
		}
		let defaultBuildTask: { task: Tasks.Task | undefined; rank: number; } = { task: undefined, rank: -1 };
		let defaultTestTask: { task: Tasks.Task | undefined; rank: number; } = { task: undefined, rank: -1 };
		let schema2_0_0: boolean = context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0;
		const baseLoadIssues = Objects.deepClone(context.taskLoadIssues);
		for (let index = 0; index < externals.length; index++) {
			let external = externals[index];
			const definition = external.type ? TaskDefinitionRegistry.get(external.type) : undefined;
			let typeNotSupported: boolean = false;
			if (definition && definition.when && !context.contextKeyService.contextMatchesRules(definition.when)) {
				typeNotSupported = true;
			} else if (!definition && external.type) {
				for (const key of Object.keys(builtinTypeContextMap)) {
					if (external.type === key) {
						typeNotSupported = !ShellExecutionSupportedContext.evaluate(context.contextKeyService.getContext(null));
						break;
					}
				}
			}

			if (typeNotSupported) {
				context.problemReporter.info(nls.localize(
					'taskConfiguration.providerUnavailable', 'Warning: {0} tasks are unavailable in the current environment.\n',
					external.type
				));
				continue;
			}

			if (isCustomTask(external)) {
				let customTask = CustomTask.from(external, context, index, source);
				if (customTask) {
					CustomTask.fillGlobals(customTask, globals);
					CustomTask.fillDefaults(customTask, context);
					if (schema2_0_0) {
						if ((customTask.command === undefined || customTask.command.name === undefined) && (customTask.configurationProperties.dependsOn === undefined || customTask.configurationProperties.dependsOn.length === 0)) {
							context.problemReporter.error(nls.localize(
								'taskConfiguration.noCommandOrDependsOn', 'Error: the task \'{0}\' neither specifies a command nor a dependsOn property. The task will be ignored. Its definition is:\n{1}',
								customTask.configurationProperties.name, JSON.stringify(external, undefined, 4)
							));
							continue;
						}
					} else {
						if (customTask.command === undefined || customTask.command.name === undefined) {
							context.problemReporter.warn(nls.localize(
								'taskConfiguration.noCommand', 'Error: the task \'{0}\' doesn\'t define a command. The task will be ignored. Its definition is:\n{1}',
								customTask.configurationProperties.name, JSON.stringify(external, undefined, 4)
							));
							continue;
						}
					}
					if (customTask.configurationProperties.group === Tasks.TaskGroup.Build && defaultBuildTask.rank < 2) {
						defaultBuildTask.task = customTask;
						defaultBuildTask.rank = 2;
					} else if (customTask.configurationProperties.group === Tasks.TaskGroup.Test && defaultTestTask.rank < 2) {
						defaultTestTask.task = customTask;
						defaultTestTask.rank = 2;
					} else if (customTask.configurationProperties.name === 'build' && defaultBuildTask.rank < 1) {
						defaultBuildTask.task = customTask;
						defaultBuildTask.rank = 1;
					} else if (customTask.configurationProperties.name === 'test' && defaultTestTask.rank < 1) {
						defaultTestTask.task = customTask;
						defaultTestTask.rank = 1;
					}
					customTask.addTaskLoadMessages(context.taskLoadIssues);
					result.custom.push(customTask);
				}
			} else {
				let configuredTask = ConfiguringTask.from(external, context, index, source);
				if (configuredTask) {
					configuredTask.addTaskLoadMessages(context.taskLoadIssues);
					result.configured.push(configuredTask);
				}
			}
			context.taskLoadIssues = Objects.deepClone(baseLoadIssues);
		}
		if ((defaultBuildTask.rank > -1) && (defaultBuildTask.rank < 2) && defaultBuildTask.task) {
			defaultBuildTask.task.configurationProperties.group = Tasks.TaskGroup.Build;
			defaultBuildTask.task.configurationProperties.groupType = Tasks.GroupType.user;
		} else if ((defaultTestTask.rank > -1) && (defaultTestTask.rank < 2) && defaultTestTask.task) {
			defaultTestTask.task.configurationProperties.group = Tasks.TaskGroup.Test;
			defaultTestTask.task.configurationProperties.groupType = Tasks.GroupType.user;
		}

		return result;
	}

	export function assignTasks(target: Tasks.CustomTask[], source: Tasks.CustomTask[]): Tasks.CustomTask[] {
		if (source === undefined || source.length === 0) {
			return target;
		}
		if (target === undefined || target.length === 0) {
			return source;
		}

		if (source) {
			// Tasks are keyed by ID but we need to merge by name
			let map: IStringDictionary<Tasks.CustomTask> = Object.create(null);
			target.forEach((task) => {
				map[task.configurationProperties.name!] = task;
			});

			source.forEach((task) => {
				map[task.configurationProperties.name!] = task;
			});
			let newTarget: Tasks.CustomTask[] = [];
			target.forEach(task => {
				newTarget.push(map[task.configurationProperties.name!]);
				delete map[task.configurationProperties.name!];
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
		if (config.suppressTaskName !== undefined) {
			result.suppressTaskName = !!config.suppressTaskName;
		}
		if (config.promptOnClose !== undefined) {
			result.promptOnClose = !!config.promptOnClose;
		}
		if (config.problemMatcher) {
			result.problemMatcher = ProblemMatcherConverter.from(config.problemMatcher, context);
		}
		return result;
	}

	export function isEmpty(value: Globals): boolean {
		return !value || value.command === undefined && value.promptOnClose === undefined && value.suppressTaskName === undefined;
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
		if (value.suppressTaskName === undefined) {
			value.suppressTaskName = (context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0);
		}
		if (value.promptOnClose === undefined) {
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
		let result: Tasks.ExecutionEngine | undefined;
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

	private last: IStringDictionary<string | string[]> | undefined;
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
		let lastValue = this.last ? this.last[identifier] : undefined;
		let result: string | undefined = undefined;
		if (lastValue !== undefined) {
			if (Array.isArray(lastValue)) {
				result = lastValue.shift();
				if (lastValue.length === 0) {
					delete this.last![identifier];
				}
			} else {
				result = lastValue;
				delete this.last![identifier];
			}
		}
		if (result === undefined) {
			result = UUID.generateUuid();
		}
		let currentValue = this.current[identifier];
		if (currentValue === undefined) {
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

export enum TaskConfigSource {
	TasksJson,
	WorkspaceFile,
	User
}

class ConfigurationParser {

	private workspaceFolder: IWorkspaceFolder;
	private workspace: IWorkspace | undefined;
	private problemReporter: IProblemReporter;
	private uuidMap: UUIDMap;
	private platform: Platform;

	constructor(workspaceFolder: IWorkspaceFolder, workspace: IWorkspace | undefined, platform: Platform, problemReporter: IProblemReporter, uuidMap: UUIDMap) {
		this.workspaceFolder = workspaceFolder;
		this.workspace = workspace;
		this.platform = platform;
		this.problemReporter = problemReporter;
		this.uuidMap = uuidMap;
	}

	public run(fileConfig: ExternalTaskRunnerConfiguration, source: TaskConfigSource, contextKeyService: IContextKeyService): ParseResult {
		let engine = ExecutionEngine.from(fileConfig);
		let schemaVersion = JsonSchemaVersion.from(fileConfig);
		let context: ParseContext = {
			workspaceFolder: this.workspaceFolder,
			workspace: this.workspace,
			problemReporter: this.problemReporter,
			uuidMap: this.uuidMap,
			namedProblemMatchers: {},
			engine,
			schemaVersion,
			platform: this.platform,
			taskLoadIssues: [],
			contextKeyService
		};
		let taskParseResult = this.createTaskRunnerConfiguration(fileConfig, context, source);
		return {
			validationStatus: this.problemReporter.status,
			custom: taskParseResult.custom,
			configured: taskParseResult.configured,
			engine
		};
	}

	private createTaskRunnerConfiguration(fileConfig: ExternalTaskRunnerConfiguration, context: ParseContext, source: TaskConfigSource): TaskParseResult {
		let globals = Globals.from(fileConfig, context);
		if (this.problemReporter.status.isFatal()) {
			return { custom: [], configured: [] };
		}
		context.namedProblemMatchers = ProblemMatcherConverter.namedFrom(fileConfig.declares, context);
		let globalTasks: Tasks.CustomTask[] | undefined = undefined;
		let externalGlobalTasks: Array<ConfiguringTask | CustomTask> | undefined = undefined;
		if (fileConfig.windows && context.platform === Platform.Windows) {
			globalTasks = TaskParser.from(fileConfig.windows.tasks, globals, context, source).custom;
			externalGlobalTasks = fileConfig.windows.tasks;
		} else if (fileConfig.osx && context.platform === Platform.Mac) {
			globalTasks = TaskParser.from(fileConfig.osx.tasks, globals, context, source).custom;
			externalGlobalTasks = fileConfig.osx.tasks;
		} else if (fileConfig.linux && context.platform === Platform.Linux) {
			globalTasks = TaskParser.from(fileConfig.linux.tasks, globals, context, source).custom;
			externalGlobalTasks = fileConfig.linux.tasks;
		}
		if (context.schemaVersion === Tasks.JsonSchemaVersion.V2_0_0 && globalTasks && globalTasks.length > 0 && externalGlobalTasks && externalGlobalTasks.length > 0) {
			let taskContent: string[] = [];
			for (let task of externalGlobalTasks) {
				taskContent.push(JSON.stringify(task, null, 4));
			}
			context.problemReporter.error(
				nls.localize(
					{ key: 'TaskParse.noOsSpecificGlobalTasks', comment: ['\"Task version 2.0.0\" refers to the 2.0.0 version of the task system. The \"version 2.0.0\" is not localizable as it is a json key and value.'] },
					'Task version 2.0.0 doesn\'t support global OS specific tasks. Convert them to a task with a OS specific command. Affected tasks are:\n{0}', taskContent.join('\n'))
			);
		}

		let result: TaskParseResult = { custom: [], configured: [] };
		if (fileConfig.tasks) {
			result = TaskParser.from(fileConfig.tasks, globals, context, source);
		}
		if (globalTasks) {
			result.custom = TaskParser.assignTasks(result.custom, globalTasks);
		}

		if ((!result.custom || result.custom.length === 0) && (globals.command && globals.command.name)) {
			let matchers: ProblemMatcher[] = ProblemMatcherConverter.from(fileConfig.problemMatcher, context);
			let isBackground = fileConfig.isBackground ? !!fileConfig.isBackground : fileConfig.isWatching ? !!fileConfig.isWatching : undefined;
			let name = Tasks.CommandString.value(globals.command.name);
			let task: Tasks.CustomTask = new Tasks.CustomTask(
				context.uuidMap.getUUID(name),
				Object.assign({} as Tasks.WorkspaceTaskSource, source, { config: { index: -1, element: fileConfig, workspaceFolder: context.workspaceFolder } }),
				name,
				Tasks.CUSTOMIZED_TASK_TYPE,
				{
					name: undefined,
					runtime: undefined,
					presentation: undefined,
					suppressTaskName: true
				},
				false,
				{ reevaluateOnRerun: true },
				{
					name: name,
					identifier: name,
					group: Tasks.TaskGroup.Build,
					isBackground: isBackground,
					problemMatchers: matchers,
				}
			);
			let value = GroupKind.from(fileConfig.group);
			if (value) {
				task.configurationProperties.group = value[0];
				task.configurationProperties.groupType = value[1];
			} else if (fileConfig.group === 'none') {
				task.configurationProperties.group = undefined;
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

let uuidMaps: Map<TaskConfigSource, Map<string, UUIDMap>> = new Map();
let recentUuidMaps: Map<TaskConfigSource, Map<string, UUIDMap>> = new Map();
export function parse(workspaceFolder: IWorkspaceFolder, workspace: IWorkspace | undefined, platform: Platform, configuration: ExternalTaskRunnerConfiguration, logger: IProblemReporter, source: TaskConfigSource, contextKeyService: IContextKeyService, isRecents: boolean = false): ParseResult {
	let recentOrOtherMaps = isRecents ? recentUuidMaps : uuidMaps;
	let selectedUuidMaps = recentOrOtherMaps.get(source);
	if (!selectedUuidMaps) {
		recentOrOtherMaps.set(source, new Map());
		selectedUuidMaps = recentOrOtherMaps.get(source)!;
	}
	let uuidMap = selectedUuidMaps.get(workspaceFolder.uri.toString());
	if (!uuidMap) {
		uuidMap = new UUIDMap();
		selectedUuidMaps.set(workspaceFolder.uri.toString(), uuidMap);
	}
	try {
		uuidMap.start();
		return (new ConfigurationParser(workspaceFolder, workspace, platform, logger, uuidMap)).run(configuration, source, contextKeyService);
	} finally {
		uuidMap.finish();
	}
}



export function createCustomTask(contributedTask: Tasks.ContributedTask, configuredProps: Tasks.ConfiguringTask | Tasks.CustomTask): Tasks.CustomTask {
	return CustomTask.createCustomTask(contributedTask, configuredProps);
}

