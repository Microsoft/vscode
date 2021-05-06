/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as minimist from 'minimist';
import { localize } from 'vs/nls';
import { isWindows } from 'vs/base/common/platform';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';

/**
 * This code is also used by standalone cli's. Avoid adding any other dependencies.
 */
const helpCategories = {
	o: localize('optionsUpperCase', "Options"),
	e: localize('extensionsManagement', "Extensions Management"),
	t: localize('troubleshooting', "Troubleshooting")
};

export interface Option<OptionType> {
	type: OptionType;
	alias?: string;
	deprecates?: string; // old deprecated id
	args?: string | string[];
	description?: string;
	cat?: keyof typeof helpCategories;
}

export type OptionDescriptions<T> = {
	[P in keyof T]: Option<OptionTypeName<T[P]>>;
};

type OptionTypeName<T> =
	T extends boolean ? 'boolean' :
	T extends string ? 'string' :
	T extends string[] ? 'string[]' :
	T extends undefined ? 'undefined' :
	'unknown';

export const OPTIONS: OptionDescriptions<Required<NativeParsedArgs>> = {
	'diff': { type: 'boolean', cat: 'o', alias: 'd', args: ['file', 'file'], description: localize('diff', "Compare two files with each other.") },
	'add': { type: 'boolean', cat: 'o', alias: 'a', args: 'folder', description: localize('add', "Add folder(s) to the last active window.") },
	'goto': { type: 'boolean', cat: 'o', alias: 'g', args: 'file:line[:character]', description: localize('goto', "Open a file at the path on the specified line and character position.") },
	'new-window': { type: 'boolean', cat: 'o', alias: 'n', description: localize('newWindow', "Force to open a new window.") },
	'reuse-window': { type: 'boolean', cat: 'o', alias: 'r', description: localize('reuseWindow', "Force to open a file or folder in an already opened window.") },
	'wait': { type: 'boolean', cat: 'o', alias: 'w', description: localize('wait', "Wait for the files to be closed before returning.") },
	'waitMarkerFilePath': { type: 'string' },
	'locale': { type: 'string', cat: 'o', args: 'locale', description: localize('locale', "The locale to use (e.g. en-US or zh-TW).") },
	'user-data-dir': { type: 'string', cat: 'o', args: 'dir', description: localize('userDataDir', "Specifies the directory that user data is kept in. Can be used to open multiple distinct instances of Code.") },
	'help': { type: 'boolean', cat: 'o', alias: 'h', description: localize('help', "Print usage.") },

	'extensions-dir': { type: 'string', deprecates: 'extensionHomePath', cat: 'e', args: 'dir', description: localize('extensionHomePath', "Set the root path for extensions.") },
	'extensions-download-dir': { type: 'string' },
	'builtin-extensions-dir': { type: 'string' },
	'list-extensions': { type: 'boolean', cat: 'e', description: localize('listExtensions', "List the installed extensions.") },
	'show-versions': { type: 'boolean', cat: 'e', description: localize('showVersions', "Show versions of installed extensions, when using --list-extensions.") },
	'category': { type: 'string', cat: 'e', description: localize('category', "Filters installed extensions by provided category, when using --list-extensions.") },
	'install-extension': { type: 'string[]', cat: 'e', args: 'extension-id[@version] | path-to-vsix', description: localize('installExtension', "Installs or updates the extension. The identifier of an extension is always `${publisher}.${name}`. Use `--force` argument to update to latest version. To install a specific version provide `@${version}`. For example: 'vscode.csharp@1.2.3'.") },
	'uninstall-extension': { type: 'string[]', cat: 'e', args: 'extension-id', description: localize('uninstallExtension', "Uninstalls an extension.") },
	'enable-proposed-api': { type: 'string[]', cat: 'e', args: 'extension-id', description: localize('experimentalApis', "Enables proposed API features for extensions. Can receive one or more extension IDs to enable individually.") },

	'version': { type: 'boolean', cat: 't', alias: 'v', description: localize('version', "Print version.") },
	'verbose': { type: 'boolean', cat: 't', description: localize('verbose', "Print verbose output (implies --wait).") },
	'log': { type: 'string', cat: 't', args: 'level', description: localize('log', "Log level to use. Default is 'info'. Allowed values are 'critical', 'error', 'warn', 'info', 'debug', 'trace', 'off'.") },
	'status': { type: 'boolean', alias: 's', cat: 't', description: localize('status', "Print process usage and diagnostics information.") },
	'prof-startup': { type: 'boolean', cat: 't', description: localize('prof-startup', "Run CPU profiler during startup") },
	'prof-append-timers': { type: 'string' },
	'prof-startup-prefix': { type: 'string' },
	'prof-v8-extensions': { type: 'boolean' },
	'disable-extensions': { type: 'boolean', deprecates: 'disableExtensions', cat: 't', description: localize('disableExtensions', "Disable all installed extensions.") },
	'disable-extension': { type: 'string[]', cat: 't', args: 'extension-id', description: localize('disableExtension', "Disable an extension.") },
	'sync': { type: 'string', cat: 't', description: localize('turn sync', "Turn sync on or off"), args: ['on', 'off'] },

	'inspect-extensions': { type: 'string', deprecates: 'debugPluginHost', args: 'port', cat: 't', description: localize('inspect-extensions', "Allow debugging and profiling of extensions. Check the developer tools for the connection URI.") },
	'inspect-brk-extensions': { type: 'string', deprecates: 'debugBrkPluginHost', args: 'port', cat: 't', description: localize('inspect-brk-extensions', "Allow debugging and profiling of extensions with the extension host being paused after start. Check the developer tools for the connection URI.") },
	'disable-gpu': { type: 'boolean', cat: 't', description: localize('disableGPU', "Disable GPU hardware acceleration.") },
	'max-memory': { type: 'string', cat: 't', description: localize('maxMemory', "Max memory size for a window (in Mbytes).") },
	'telemetry': { type: 'boolean', cat: 't', description: localize('telemetry', "Shows all telemetry events which VS code collects.") },

	'remote': { type: 'string' },
	'folder-uri': { type: 'string[]', cat: 'o', args: 'uri' },
	'file-uri': { type: 'string[]', cat: 'o', args: 'uri' },

	'locate-extension': { type: 'string[]' },
	'extensionDevelopmentPath': { type: 'string[]' },
	'extensionDevelopmentKind': { type: 'string[]' },
	'extensionTestsPath': { type: 'string' },
	'debugId': { type: 'string' },
	'debugRenderer': { type: 'boolean' },
	'inspect-search': { type: 'string', deprecates: 'debugSearch' },
	'inspect-brk-search': { type: 'string', deprecates: 'debugBrkSearch' },
	'export-default-configuration': { type: 'string' },
	'install-source': { type: 'string' },
	'driver': { type: 'string' },
	'logExtensionHostCommunication': { type: 'boolean' },
	'skip-release-notes': { type: 'boolean' },
	'disable-telemetry': { type: 'boolean' },
	'disable-updates': { type: 'boolean' },
	'disable-keytar': { type: 'boolean' },
	'disable-crash-reporter': { type: 'boolean' },
	'crash-reporter-directory': { type: 'string' },
	'crash-reporter-id': { type: 'string' },
	'skip-add-to-recently-opened': { type: 'boolean' },
	'unity-launch': { type: 'boolean' },
	'open-url': { type: 'boolean' },
	'file-write': { type: 'boolean' },
	'file-chmod': { type: 'boolean' },
	'driver-verbose': { type: 'boolean' },
	'install-builtin-extension': { type: 'string[]' },
	'force': { type: 'boolean' },
	'do-not-sync': { type: 'boolean' },
	'trace': { type: 'boolean' },
	'trace-category-filter': { type: 'string' },
	'trace-options': { type: 'string' },
	'force-user-env': { type: 'boolean' },
	'force-disable-user-env': { type: 'boolean' },
	'open-devtools': { type: 'boolean' },
	'__sandbox': { type: 'boolean' },
	'logsPath': { type: 'string' },

	// chromium flags
	'no-proxy-server': { type: 'boolean' },
	'proxy-server': { type: 'string' },
	'proxy-bypass-list': { type: 'string' },
	'proxy-pac-url': { type: 'string' },
	'js-flags': { type: 'string' }, // chrome js flags
	'inspect': { type: 'string' },
	'inspect-brk': { type: 'string' },
	'nolazy': { type: 'boolean' }, // node inspect
	'force-device-scale-factor': { type: 'string' },
	'force-renderer-accessibility': { type: 'boolean' },
	'ignore-certificate-errors': { type: 'boolean' },
	'allow-insecure-localhost': { type: 'boolean' },
	'log-net-log': { type: 'string' },
	'vmodule': { type: 'string' },
	'_urls': { type: 'string[]' },

	_: { type: 'string[]' } // main arguments
};

export interface ErrorReporter {
	onUnknownOption(id: string): void;
	onMultipleValues(id: string, usedValue: string): void;
}

const ignoringReporter: ErrorReporter = {
	onUnknownOption: () => { },
	onMultipleValues: () => { }
};

export function parseArgs<T>(args: string[], options: OptionDescriptions<T>, errorReporter: ErrorReporter = ignoringReporter): T {
	const alias: { [key: string]: string } = {};
	const string: string[] = [];
	const boolean: string[] = [];
	for (let optionId in options) {
		const o = options[optionId];
		if (o.alias) {
			alias[optionId] = o.alias;
		}

		if (o.type === 'string' || o.type === 'string[]') {
			string.push(optionId);
			if (o.deprecates) {
				string.push(o.deprecates);
			}
		} else if (o.type === 'boolean') {
			boolean.push(optionId);
			if (o.deprecates) {
				boolean.push(o.deprecates);
			}
		}
	}
	// remove aliases to avoid confusion
	const parsedArgs = minimist(args, { string, boolean, alias });

	const cleanedArgs: any = {};
	const remainingArgs: any = parsedArgs;

	// https://github.com/microsoft/vscode/issues/58177, https://github.com/microsoft/vscode/issues/106617
	cleanedArgs._ = parsedArgs._.map(arg => String(arg)).filter(arg => arg.length > 0);

	delete remainingArgs._;

	for (let optionId in options) {
		const o = options[optionId];
		if (o.alias) {
			delete remainingArgs[o.alias];
		}

		let val = remainingArgs[optionId];
		if (o.deprecates && remainingArgs.hasOwnProperty(o.deprecates)) {
			if (!val) {
				val = remainingArgs[o.deprecates];
			}
			delete remainingArgs[o.deprecates];
		}

		if (typeof val !== 'undefined') {
			if (o.type === 'string[]') {
				if (val && !Array.isArray(val)) {
					val = [val];
				}
			} else if (o.type === 'string') {
				if (Array.isArray(val)) {
					val = val.pop(); // take the last
					errorReporter.onMultipleValues(optionId, val);
				}
			}
			cleanedArgs[optionId] = val;
		}
		delete remainingArgs[optionId];
	}

	for (let key in remainingArgs) {
		errorReporter.onUnknownOption(key);
	}

	return cleanedArgs;
}

function formatUsage(optionId: string, option: Option<any>) {
	let args = '';
	if (option.args) {
		if (Array.isArray(option.args)) {
			args = ` <${option.args.join('> <')}>`;
		} else {
			args = ` <${option.args}>`;
		}
	}
	if (option.alias) {
		return `-${option.alias} --${optionId}${args}`;
	}
	return `--${optionId}${args}`;
}

// exported only for testing
export function formatOptions(options: OptionDescriptions<any>, columns: number): string[] {
	let maxLength = 0;
	let usageTexts: [string, string][] = [];
	for (const optionId in options) {
		const o = options[optionId];
		const usageText = formatUsage(optionId, o);
		maxLength = Math.max(maxLength, usageText.length);
		usageTexts.push([usageText, o.description!]);
	}
	let argLength = maxLength + 2/*left padding*/ + 1/*right padding*/;
	if (columns - argLength < 25) {
		// Use a condensed version on narrow terminals
		return usageTexts.reduce<string[]>((r, ut) => r.concat([`  ${ut[0]}`, `      ${ut[1]}`]), []);
	}
	let descriptionColumns = columns - argLength - 1;
	let result: string[] = [];
	for (const ut of usageTexts) {
		let usage = ut[0];
		let wrappedDescription = wrapText(ut[1], descriptionColumns);
		let keyPadding = indent(argLength - usage.length - 2/*left padding*/);
		result.push('  ' + usage + keyPadding + wrappedDescription[0]);
		for (let i = 1; i < wrappedDescription.length; i++) {
			result.push(indent(argLength) + wrappedDescription[i]);
		}
	}
	return result;
}

function indent(count: number): string {
	return ' '.repeat(count);
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

export function buildHelpMessage(productName: string, executableName: string, version: string, options: OptionDescriptions<any>, isPipeSupported = true): string {
	const columns = (process.stdout).isTTY && (process.stdout).columns || 80;

	let help = [`${productName} ${version}`];
	help.push('');
	help.push(`${localize('usage', "Usage")}: ${executableName} [${localize('options', "options")}][${localize('paths', 'paths')}...]`);
	help.push('');
	if (isPipeSupported) {
		if (isWindows) {
			help.push(localize('stdinWindows', "To read output from another program, append '-' (e.g. 'echo Hello World | {0} -')", executableName));
		} else {
			help.push(localize('stdinUnix', "To read from stdin, append '-' (e.g. 'ps aux | grep code | {0} -')", executableName));
		}
		help.push('');
	}
	const optionsByCategory: { [P in keyof typeof helpCategories]?: OptionDescriptions<any> } = {};
	for (const optionId in options) {
		const o = options[optionId];
		if (o.description && o.cat) {
			let optionsByCat = optionsByCategory[o.cat];
			if (!optionsByCat) {
				optionsByCategory[o.cat] = optionsByCat = {};
			}
			optionsByCat[optionId] = o;
		}
	}

	for (let helpCategoryKey in optionsByCategory) {
		const key = <keyof typeof helpCategories>helpCategoryKey;

		let categoryOptions = optionsByCategory[key];
		if (categoryOptions) {
			help.push(helpCategories[key]);
			help.push(...formatOptions(categoryOptions, columns));
			help.push('');
		}
	}
	return help.join('\n');
}

export function buildVersionMessage(version: string | undefined, commit: string | undefined): string {
	return `${version || localize('unknownVersion', "Unknown version")}\n${commit || localize('unknownCommit', "Unknown commit")}\n${process.arch}`;
}
