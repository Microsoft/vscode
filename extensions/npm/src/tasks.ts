/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	TaskDefinition, Task, TaskGroup, WorkspaceFolder, RelativePattern, ShellExecution, Uri, workspace,
	TaskProvider, TextDocument, tasks, TaskScope, QuickPickItem, window, Position, ExtensionContext, env,
	ShellQuotedString, ShellQuoting, commands, Location, CancellationTokenSource
} from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as minimatch from 'minimatch';
import * as nls from 'vscode-nls';
import { findPreferredPM } from './preferred-pm';
import { readScripts } from './readScripts';

const localize = nls.loadMessageBundle();

export interface NpmTaskDefinition extends TaskDefinition {
	script: string;
	path?: string;
}

export interface FolderTaskItem extends QuickPickItem {
	label: string;
	task: Task;
}

type AutoDetect = 'on' | 'off';

let cachedTasks: TaskWithLocation[] | undefined = undefined;

const INSTALL_SCRIPT = 'install';

export interface TaskLocation {
	document: Uri,
	line: Position
}

export interface TaskWithLocation {
	task: Task,
	location?: Location
}

export class NpmTaskProvider implements TaskProvider {

	constructor(private context: ExtensionContext) {
	}

	get tasksWithLocation(): Promise<TaskWithLocation[]> {
		return provideNpmScripts(this.context, false);
	}

	public async provideTasks() {
		const tasks = await provideNpmScripts(this.context, true);
		return tasks.map(task => task.task);
	}

	public async resolveTask(_task: Task): Promise<Task | undefined> {
		const npmTask = (<any>_task.definition).script;
		if (npmTask) {
			const kind: NpmTaskDefinition = (<any>_task.definition);
			let packageJsonUri: Uri;
			if (_task.scope === undefined || _task.scope === TaskScope.Global || _task.scope === TaskScope.Workspace) {
				// scope is required to be a WorkspaceFolder for resolveTask
				return undefined;
			}
			if (kind.path) {
				packageJsonUri = _task.scope.uri.with({ path: _task.scope.uri.path + '/' + kind.path + 'package.json' });
			} else {
				packageJsonUri = _task.scope.uri.with({ path: _task.scope.uri.path + '/package.json' });
			}
			const cmd = [kind.script];
			if (kind.script !== INSTALL_SCRIPT) {
				cmd.unshift('run');
			}
			return createTask(await getPackageManager(this.context, _task.scope.uri), kind, cmd, _task.scope, packageJsonUri);
		}
		return undefined;
	}
}

export function invalidateTasksCache() {
	cachedTasks = undefined;
}

const buildNames: string[] = ['build', 'compile', 'watch'];
function isBuildTask(name: string): boolean {
	for (let buildName of buildNames) {
		if (name.indexOf(buildName) !== -1) {
			return true;
		}
	}
	return false;
}

const testNames: string[] = ['test'];
function isTestTask(name: string): boolean {
	for (let testName of testNames) {
		if (name === testName) {
			return true;
		}
	}
	return false;
}

function getPrePostScripts(scripts: any): Set<string> {
	const prePostScripts: Set<string> = new Set([
		'preuninstall', 'postuninstall', 'prepack', 'postpack', 'preinstall', 'postinstall',
		'prepack', 'postpack', 'prepublish', 'postpublish', 'preversion', 'postversion',
		'prestop', 'poststop', 'prerestart', 'postrestart', 'preshrinkwrap', 'postshrinkwrap',
		'pretest', 'postest', 'prepublishOnly'
	]);
	let keys = Object.keys(scripts);
	for (const script of keys) {
		const prepost = ['pre' + script, 'post' + script];
		prepost.forEach(each => {
			if (scripts[each] !== undefined) {
				prePostScripts.add(each);
			}
		});
	}
	return prePostScripts;
}

export function isWorkspaceFolder(value: any): value is WorkspaceFolder {
	return value && typeof value !== 'number';
}

export async function getPackageManager(extensionContext: ExtensionContext, folder: Uri, showWarning: boolean = true): Promise<string> {
	let packageManagerName = workspace.getConfiguration('npm', folder).get<string>('packageManager', 'npm');

	if (packageManagerName === 'auto') {
		const { name, multiplePMDetected } = await findPreferredPM(folder.fsPath);
		packageManagerName = name;
		const neverShowWarning = 'npm.multiplePMWarning.neverShow';
		if (showWarning && multiplePMDetected && !extensionContext.globalState.get<boolean>(neverShowWarning)) {
			const multiplePMWarning = localize('npm.multiplePMWarning', 'Using {0} as the preferred package manager. Found multiple lockfiles for {1}.', packageManagerName, folder.fsPath);
			const neverShowAgain = localize('npm.multiplePMWarning.doNotShow', "Do not show again");
			const learnMore = localize('npm.multiplePMWarning.learnMore', "Learn more");
			window.showInformationMessage(multiplePMWarning, learnMore, neverShowAgain).then(result => {
				switch (result) {
					case neverShowAgain: extensionContext.globalState.update(neverShowWarning, true); break;
					case learnMore: env.openExternal(Uri.parse('https://nodejs.dev/learn/the-package-lock-json-file'));
				}
			});
		}
	}

	return packageManagerName;
}

export async function hasNpmScripts(): Promise<boolean> {
	let folders = workspace.workspaceFolders;
	if (!folders) {
		return false;
	}
	try {
		for (const folder of folders) {
			if (isAutoDetectionEnabled(folder)) {
				let relativePattern = new RelativePattern(folder, '**/package.json');
				let paths = await workspace.findFiles(relativePattern, '**/node_modules/**');
				if (paths.length > 0) {
					return true;
				}
			}
		}
		return false;
	} catch (error) {
		return Promise.reject(error);
	}
}

async function detectNpmScripts(context: ExtensionContext, showWarning: boolean): Promise<TaskWithLocation[]> {

	let emptyTasks: TaskWithLocation[] = [];
	let allTasks: TaskWithLocation[] = [];
	let visitedPackageJsonFiles: Set<string> = new Set();

	let folders = workspace.workspaceFolders;
	if (!folders) {
		return emptyTasks;
	}
	try {
		for (const folder of folders) {
			if (isAutoDetectionEnabled(folder)) {
				let relativePattern = new RelativePattern(folder, '**/package.json');
				let paths = await workspace.findFiles(relativePattern, '**/{node_modules,.vscode-test}/**');
				for (const path of paths) {
					if (!isExcluded(folder, path) && !visitedPackageJsonFiles.has(path.fsPath)) {
						let tasks = await provideNpmScriptsForFolder(context, path, showWarning);
						visitedPackageJsonFiles.add(path.fsPath);
						allTasks.push(...tasks);
					}
				}
			}
		}
		return allTasks;
	} catch (error) {
		return Promise.reject(error);
	}
}


export async function detectNpmScriptsForFolder(context: ExtensionContext, folder: Uri): Promise<FolderTaskItem[]> {

	let folderTasks: FolderTaskItem[] = [];

	try {
		let relativePattern = new RelativePattern(folder.fsPath, '**/package.json');
		let paths = await workspace.findFiles(relativePattern, '**/node_modules/**');

		let visitedPackageJsonFiles: Set<string> = new Set();
		for (const path of paths) {
			if (!visitedPackageJsonFiles.has(path.fsPath)) {
				let tasks = await provideNpmScriptsForFolder(context, path, true);
				visitedPackageJsonFiles.add(path.fsPath);
				folderTasks.push(...tasks.map(t => ({ label: t.task.name, task: t.task })));
			}
		}
		return folderTasks;
	} catch (error) {
		return Promise.reject(error);
	}
}

export async function provideNpmScripts(context: ExtensionContext, showWarning: boolean): Promise<TaskWithLocation[]> {
	if (!cachedTasks) {
		cachedTasks = await detectNpmScripts(context, showWarning);
	}
	return cachedTasks;
}

export function isAutoDetectionEnabled(folder?: WorkspaceFolder): boolean {
	return workspace.getConfiguration('npm', folder?.uri).get<AutoDetect>('autoDetect') === 'on';
}

function isExcluded(folder: WorkspaceFolder, packageJsonUri: Uri) {
	function testForExclusionPattern(path: string, pattern: string): boolean {
		return minimatch(path, pattern, { dot: true });
	}

	let exclude = workspace.getConfiguration('npm', folder.uri).get<string | string[]>('exclude');
	let packageJsonFolder = path.dirname(packageJsonUri.fsPath);

	if (exclude) {
		if (Array.isArray(exclude)) {
			for (let pattern of exclude) {
				if (testForExclusionPattern(packageJsonFolder, pattern)) {
					return true;
				}
			}
		} else if (testForExclusionPattern(packageJsonFolder, exclude)) {
			return true;
		}
	}
	return false;
}

function isDebugScript(script: string): boolean {
	let match = script.match(/--(inspect|debug)(-brk)?(=((\[[0-9a-fA-F:]*\]|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+|[a-zA-Z0-9\.]*):)?(\d+))?/);
	return match !== null;
}

async function provideNpmScriptsForFolder(context: ExtensionContext, packageJsonUri: Uri, showWarning: boolean): Promise<TaskWithLocation[]> {
	let emptyTasks: TaskWithLocation[] = [];

	let folder = workspace.getWorkspaceFolder(packageJsonUri);
	if (!folder) {
		return emptyTasks;
	}
	let scripts = await getScripts(packageJsonUri);
	if (!scripts) {
		return emptyTasks;
	}

	const result: TaskWithLocation[] = [];

	const prePostScripts = getPrePostScripts(scripts);
	const packageManager = await getPackageManager(context, folder.uri, showWarning);

	for (const { name, value, nameRange } of scripts.scripts) {
		const task = await createTask(packageManager, name, ['run', name], folder!, packageJsonUri, value);
		const lowerCaseTaskName = name.toLowerCase();
		if (isBuildTask(lowerCaseTaskName)) {
			task.group = TaskGroup.Build;
		} else if (isTestTask(lowerCaseTaskName)) {
			task.group = TaskGroup.Test;
		}
		if (prePostScripts.has(name)) {
			task.group = TaskGroup.Clean; // hack: use Clean group to tag pre/post scripts
		}

		// todo@connor4312: all scripts are now debuggable, what is a 'debug script'?
		if (isDebugScript(value)) {
			task.group = TaskGroup.Rebuild; // hack: use Rebuild group to tag debug scripts
		}

		result.push({ task, location: new Location(packageJsonUri, nameRange) });
	}

	// always add npm install (without a problem matcher)
	result.push({ task: await createTask(packageManager, INSTALL_SCRIPT, [INSTALL_SCRIPT], folder, packageJsonUri, 'install dependencies from package', []) });
	return result;
}

export function getTaskName(script: string, relativePath: string | undefined) {
	if (relativePath && relativePath.length) {
		return `${script} - ${relativePath.substring(0, relativePath.length - 1)}`;
	}
	return script;
}

export async function createTask(packageManager: string, script: NpmTaskDefinition | string, cmd: string[], folder: WorkspaceFolder, packageJsonUri: Uri, detail?: string, matcher?: any): Promise<Task> {
	let kind: NpmTaskDefinition;
	if (typeof script === 'string') {
		kind = { type: 'npm', script: script };
	} else {
		kind = script;
	}

	function getCommandLine(cmd: string[]): (string | ShellQuotedString)[] {
		const result: (string | ShellQuotedString)[] = new Array(cmd.length);
		for (let i = 0; i < cmd.length; i++) {
			if (/\s/.test(cmd[i])) {
				result[i] = { value: cmd[i], quoting: cmd[i].includes('--') ? ShellQuoting.Weak : ShellQuoting.Strong };
			} else {
				result[i] = cmd[i];
			}
		}
		if (workspace.getConfiguration('npm', folder.uri).get<boolean>('runSilent')) {
			result.unshift('--silent');
		}
		return result;
	}

	function getRelativePath(packageJsonUri: Uri): string {
		let rootUri = folder.uri;
		let absolutePath = packageJsonUri.path.substring(0, packageJsonUri.path.length - 'package.json'.length);
		return absolutePath.substring(rootUri.path.length + 1);
	}

	let relativePackageJson = getRelativePath(packageJsonUri);
	if (relativePackageJson.length) {
		kind.path = relativePackageJson;
	}
	let taskName = getTaskName(kind.script, relativePackageJson);
	let cwd = path.dirname(packageJsonUri.fsPath);
	const task = new Task(kind, folder, taskName, 'npm', new ShellExecution(packageManager, getCommandLine(cmd), { cwd: cwd }), matcher);
	task.detail = detail;
	return task;
}


export function getPackageJsonUriFromTask(task: Task): Uri | null {
	if (isWorkspaceFolder(task.scope)) {
		if (task.definition.path) {
			return Uri.file(path.join(task.scope.uri.fsPath, task.definition.path, 'package.json'));
		} else {
			return Uri.file(path.join(task.scope.uri.fsPath, 'package.json'));
		}
	}
	return null;
}

export async function hasPackageJson(): Promise<boolean> {
	const token = new CancellationTokenSource();
	// Search for files for max 1 second.
	const timeout = setTimeout(() => token.cancel(), 1000);
	const files = await workspace.findFiles('**/package.json', undefined, 1, token.token);
	clearTimeout(timeout);
	return files.length > 0 || await hasRootPackageJson();
}

async function hasRootPackageJson(): Promise<boolean> {
	let folders = workspace.workspaceFolders;
	if (!folders) {
		return false;
	}
	for (const folder of folders) {
		if (folder.uri.scheme === 'file') {
			let packageJson = path.join(folder.uri.fsPath, 'package.json');
			if (await exists(packageJson)) {
				return true;
			}
		}
	}
	return false;
}

async function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

export async function runScript(context: ExtensionContext, script: string, document: TextDocument) {
	let uri = document.uri;
	let folder = workspace.getWorkspaceFolder(uri);
	if (folder) {
		const task = await createTask(await getPackageManager(context, folder.uri), script, ['run', script], folder, uri);
		tasks.executeTask(task);
	}
}

export async function startDebugging(context: ExtensionContext, scriptName: string, cwd: string, folder: WorkspaceFolder) {
	commands.executeCommand(
		'extension.js-debug.createDebuggerTerminal',
		`${await getPackageManager(context, folder.uri)} run ${scriptName}`,
		folder,
		{ cwd },
	);
}


export type StringMap = { [s: string]: string; };

export function findScriptAtPosition(document: TextDocument, buffer: string, position: Position): string | undefined {
	const read = readScripts(document, buffer);
	if (!read) {
		return undefined;
	}

	for (const script of read.scripts) {
		if (script.nameRange.start.isBeforeOrEqual(position) && script.valueRange.end.isAfterOrEqual(position)) {
			return script.name;
		}
	}

	return undefined;
}

export async function getScripts(packageJsonUri: Uri) {
	if (packageJsonUri.scheme !== 'file') {
		return undefined;
	}

	let packageJson = packageJsonUri.fsPath;
	if (!await exists(packageJson)) {
		return undefined;
	}

	try {
		const document: TextDocument = await workspace.openTextDocument(packageJsonUri);
		return readScripts(document);
	} catch (e) {
		let localizedParseError = localize('npm.parseError', 'Npm task detection: failed to parse the file {0}', packageJsonUri.fsPath);
		throw new Error(localizedParseError);
	}
}
