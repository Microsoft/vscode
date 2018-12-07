/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as minimist from 'minimist';
import * as assert from 'assert';
import { firstIndex } from 'vs/base/common/arrays';
import { localize } from 'vs/nls';
import { ParsedArgs } from '../common/environment';
import { isWindows } from 'vs/base/common/platform';
import product from 'vs/platform/node/product';
import { MIN_MAX_MEMORY_SIZE_MB } from 'vs/platform/files/common/files';

const options: minimist.Opts = {
	string: [
		'locale',
		'user-data-dir',
		'extensions-dir',
		'folder-uri',
		'file-uri',
		'remote',
		'extensionDevelopmentPath',
		'extensionTestsPath',
		'install-extension',
		'search-extension',
		'disable-extension',
		'uninstall-extension',
		'debugId',
		'debugPluginHost',
		'debugBrkPluginHost',
		'debugSearch',
		'debugBrkSearch',
		'enable-proposed-api',
		'export-default-configuration',
		'install-source',
		'upload-logs',
		'driver',
		'trace-category-filter',
		'trace-options',
		'_'
	],
	boolean: [
		'help',
		'version',
		'wait',
		'diff',
		'add',
		'goto',
		'new-window',
		'unity-launch',
		'reuse-window',
		'open-url',
		'performance',
		'prof-startup',
		'verbose',
		'logExtensionHostCommunication',
		'disable-extensions',
		'list-extensions',
		'show-versions',
		'nolazy',
		'issue',
		'skip-getting-started',
		'skip-release-notes',
		'sticky-quickopen',
		'disable-restore-windows',
		'disable-telemetry',
		'disable-updates',
		'disable-crash-reporter',
		'skip-add-to-recently-opened',
		'status',
		'file-write',
		'file-chmod',
		'driver-verbose',
		'trace'
	],
	alias: {
		add: 'a',
		help: 'h',
		version: 'v',
		wait: 'w',
		diff: 'd',
		goto: 'g',
		status: 's',
		'new-window': 'n',
		'reuse-window': 'r',
		performance: 'p',
		'disable-extensions': 'disableExtensions',
		'extensions-dir': 'extensionHomePath',
		'debugPluginHost': 'inspect-extensions',
		'debugBrkPluginHost': 'inspect-brk-extensions',
		'debugSearch': 'inspect-search',
		'debugBrkSearch': 'inspect-brk-search',
	}
};

function validate(args: ParsedArgs): ParsedArgs {
	if (args.goto) {
		args._.forEach(arg => assert(/^(\w:)?[^:]+(:\d*){0,2}$/.test(arg), localize('gotoValidation', "Arguments in `--goto` mode should be in the format of `FILE(:LINE(:CHARACTER))`.")));
	}

	if (args['max-memory']) {
		assert(args['max-memory'] >= MIN_MAX_MEMORY_SIZE_MB, `The max-memory argument cannot be specified lower than ${MIN_MAX_MEMORY_SIZE_MB} MB.`);
	}

	return args;
}

function stripAppPath(argv: string[]): string[] | undefined {
	const index = firstIndex(argv, a => !/^-/.test(a));

	if (index > -1) {
		return [...argv.slice(0, index), ...argv.slice(index + 1)];
	}
	return undefined;
}

/**
 * Use this to parse raw code process.argv such as: `Electron . --verbose --wait`
 */
export function parseMainProcessArgv(processArgv: string[]): ParsedArgs {
	let [, ...args] = processArgv;

	// If dev, remove the first non-option argument: it's the app location
	if (process.env['VSCODE_DEV']) {
		args = stripAppPath(args) || [];
	}

	return validate(parseArgs(args));
}

/**
 * Use this to parse raw code CLI process.argv such as: `Electron cli.js . --verbose --wait`
 */
export function parseCLIProcessArgv(processArgv: string[]): ParsedArgs {
	let [, , ...args] = processArgv;

	if (process.env['VSCODE_DEV']) {
		args = stripAppPath(args) || [];
	}

	return validate(parseArgs(args));
}

/**
 * Use this to parse code arguments such as `--verbose --wait`
 */
export function parseArgs(args: string[]): ParsedArgs {
	return minimist(args, options) as ParsedArgs;
}

const optionsHelp: { [name: string]: string; } = {
	'-d, --diff <file> <file>': localize('diff', "Compare two files with each other."),
	'-a, --add <dir>': localize('add', "Add folder(s) to the last active window."),
	'-g, --goto <file:line[:character]>': localize('goto', "Open a file at the path on the specified line and character position."),
	'-n, --new-window': localize('newWindow', "Force to open a new window."),
	'-r, --reuse-window': localize('reuseWindow', "Force to open a file or folder in an already opened window."),
	'-w, --wait': localize('wait', "Wait for the files to be closed before returning."),
	'--locale <locale>': localize('locale', "The locale to use (e.g. en-US or zh-TW)."),
	'--user-data-dir <dir>': localize('userDataDir', "Specifies the directory that user data is kept in. Can be used to open multiple distinct instances of Code."),
	'-v, --version': localize('version', "Print version."),
	'-h, --help': localize('help', "Print usage.")
};

const extensionsHelp: { [name: string]: string; } = {
	'--extensions-dir <dir>': localize('extensionHomePath', "Set the root path for extensions."),
	'--list-extensions': localize('listExtensions', "List the installed extensions."),
	'--search-extensions (<extension-name>)': localize('searchExtensions', "Search within the installed extensions."),
	'--show-versions': localize('showVersions', "Show versions of installed extensions, when using --list-extension."),
	'--uninstall-extension (<extension-id> | <extension-vsix-path>)': localize('uninstallExtension', "Uninstalls an extension."),
	'--install-extension (<extension-id> | <extension-vsix-path>)': localize('installExtension', "Installs or updates the extension. Use `--force` argument to avoid prompts."),
	'--enable-proposed-api (<extension-id>)': localize('experimentalApis', "Enables proposed API features for extensions. Can receive one or more extension IDs to enable individually.")
};

const troubleshootingHelp: { [name: string]: string; } = {
	'--verbose': localize('verbose', "Print verbose output (implies --wait)."),
	'--log <level>': localize('log', "Log level to use. Default is 'info'. Allowed values are 'critical', 'error', 'warn', 'info', 'debug', 'trace', 'off'."),
	'-s, --status': localize('status', "Print process usage and diagnostics information."),
	'-p, --performance': localize('performance', "Start with the 'Developer: Startup Performance' command enabled."),
	'--prof-startup': localize('prof-startup', "Run CPU profiler during startup"),
	'--disable-extensions': localize('disableExtensions', "Disable all installed extensions."),
	'--disable-extension <extension-id>': localize('disableExtension', "Disable an extension."),
	'--inspect-extensions': localize('inspect-extensions', "Allow debugging and profiling of extensions. Check the developer tools for the connection URI."),
	'--inspect-brk-extensions': localize('inspect-brk-extensions', "Allow debugging and profiling of extensions with the extension host being paused after start. Check the developer tools for the connection URI."),
	'--disable-gpu': localize('disableGPU', "Disable GPU hardware acceleration."),
	'--upload-logs': localize('uploadLogs', "Uploads logs from current session to a secure endpoint."),
	'--max-memory': localize('maxMemory', "Max memory size for a window (in Mbytes).")
};

export function formatOptions(options: { [name: string]: string; }, columns: number): string {
	let keys = Object.keys(options);
	let argLength = Math.max.apply(null, keys.map(k => k.length)) + 2/*left padding*/ + 1/*right padding*/;
	if (columns - argLength < 25) {
		// Use a condensed version on narrow terminals
		return keys.reduce((r, key) => r.concat([`  ${key}`, `      ${options[key]}`]), [] as string[]).join('\n');
	}
	let descriptionColumns = columns - argLength - 1;
	let result = '';
	keys.forEach(k => {
		let wrappedDescription = wrapText(options[k], descriptionColumns);
		let keyPadding = (<any>' ').repeat(argLength - k.length - 2/*left padding*/);
		if (result.length > 0) {
			result += '\n';
		}
		result += '  ' + k + keyPadding + wrappedDescription[0];
		for (let i = 1; i < wrappedDescription.length; i++) {
			result += '\n' + (<any>' ').repeat(argLength) + wrappedDescription[i];
		}
	});
	return result;
}

function wrapText(text: string, columns: number): string[] {
	let lines: string[] = [];
	while (text.length) {
		let index = text.length < columns ? text.length : text.lastIndexOf(' ', columns);
		let line = text.slice(0, index).trim();
		text = text.slice(index);
		lines.push(line);
	}
	return lines;
}

export function buildHelpMessage(fullName: string, name: string, version: string): string {
	const columns = (<any>process.stdout).isTTY ? (<any>process.stdout).columns : 80;
	const executable = `${name}${os.platform() === 'win32' ? '.exe' : ''}`;

	return `${fullName} ${version}

${ localize('usage', "Usage")}: ${executable} [${localize('options', "options")}] [${localize('paths', 'paths')}...]

${ isWindows ? localize('stdinWindows', "To read output from another program, append '-' (e.g. 'echo Hello World | {0} -')", product.applicationName) : localize('stdinUnix', "To read from stdin, append '-' (e.g. 'ps aux | grep code | {0} -')", product.applicationName)}

${ localize('optionsUpperCase', "Options")}:
${formatOptions(optionsHelp, columns)}

${ localize('extensionsManagement', "Extensions Management")}:
${formatOptions(extensionsHelp, columns)}

${ localize('troubleshooting', "Troubleshooting")}:
${formatOptions(troubleshootingHelp, columns)}`;
}

/**
 * Converts an argument into an array
 * @param arg a argument value. Can be undefined, an entry or an array
 */
export function asArray(arg: string | string[] | undefined): string[] {
	if (arg) {
		if (Array.isArray(arg)) {
			return arg;
		}
		return [arg];
	}
	return [];
}

/**
 * Returns whether an argument is present.
 */
export function hasArgs(arg: string | string[] | undefined): boolean {
	if (arg) {
		if (Array.isArray(arg)) {
			return !!arg.length;
		}
		return true;
	}
	return false;
}