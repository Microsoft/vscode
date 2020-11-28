/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	TaskDefinition, Task, TaskGroup, WorkspaceFolder, RelativePattern, ShellExecution, Uri, workspace,
	DebugConfiguration, debug, TaskProvider, TextDocument, tasks, TaskScope, QuickPickItem, window, Position
} from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as minimatch from 'minimatch';
import * as nls from 'vscode-nls';
import { JSONVisitor, visit, ParseErrorCode } from 'jsonc-parser';
import { findPreferredPM } from './preferred-pm';

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
	location?: TaskLocation
}

export class NpmTaskProvider implements TaskProvider {

	constructor() {
	}

	get tasksWithLocation(): Promise<TaskWithLocation[]> {
		return provideNpmScripts();
	}

	public async provideTasks() {
		const tasks = await provideNpmScripts();
		return tasks.map(task => task.task);
	}

	public resolveTask(_task: Task): Promise<Task> | undefined {
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
			return createTask(kind, `${kind.script === INSTALL_SCRIPT ? '' : 'run '}${kind.script}`, _task.scope, packageJsonUri);
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

export async function getPackageManager(folder: Uri): Promise<string> {
	let packageManagerName = workspace.getConfiguration('npm', folder).get<string>('packageManager', 'npm');

	if (packageManagerName === 'auto') {
		const { name, multiplePMDetected } = await findPreferredPM(folder.fsPath);
		packageManagerName = name;

		if (multiplePMDetected) {
			const multiplePMWarning = localize('npm.multiplePMWarning', 'Found multiple lockfiles for {0}. Using {1} as the preferred package manager.', folder.fsPath, packageManagerName);
			window.showWarningMessage(multiplePMWarning);
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

async function detectNpmScripts(): Promise<TaskWithLocation[]> {

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
						let tasks = await provideNpmScriptsForFolder(path);
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


export async function detectNpmScriptsForFolder(folder: Uri): Promise<FolderTaskItem[]> {

	let folderTasks: FolderTaskItem[] = [];

	try {
		let relativePattern = new RelativePattern(folder.fsPath, '**/package.json');
		let paths = await workspace.findFiles(relativePattern, '**/node_modules/**');

		let visitedPackageJsonFiles: Set<string> = new Set();
		for (const path of paths) {
			if (!visitedPackageJsonFiles.has(path.fsPath)) {
				let tasks = await provideNpmScriptsForFolder(path);
				visitedPackageJsonFiles.add(path.fsPath);
				folderTasks.push(...tasks.map(t => ({ label: t.task.name, task: t.task })));
			}
		}
		return folderTasks;
	} catch (error) {
		return Promise.reject(error);
	}
}

export async function provideNpmScripts(): Promise<TaskWithLocation[]> {
	if (!cachedTasks) {
		cachedTasks = await detectNpmScripts();
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

async function provideNpmScriptsForFolder(packageJsonUri: Uri): Promise<TaskWithLocation[]> {
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

	for (const each of scripts.keys()) {
		const scriptValue = scripts.get(each)!;
		const task = await createTask(each, `run ${each}`, folder!, packageJsonUri, scriptValue.script);
		const lowerCaseTaskName = each.toLowerCase();
		if (isBuildTask(lowerCaseTaskName)) {
			task.group = TaskGroup.Build;
		} else if (isTestTask(lowerCaseTaskName)) {
			task.group = TaskGroup.Test;
		}
		if (prePostScripts.has(each)) {
			task.group = TaskGroup.Clean; // hack: use Clean group to tag pre/post scripts
		}

		// todo@connor4312: all scripts are now debuggable, what is a 'debug script'?
		if (isDebugScript(scriptValue.script)) {
			task.group = TaskGroup.Rebuild; // hack: use Rebuild group to tag debug scripts
		}
		result.push({ task, location: scriptValue.location });
	}

	// always add npm install (without a problem matcher)
	result.push({ task: await createTask(INSTALL_SCRIPT, INSTALL_SCRIPT, folder, packageJsonUri, 'install dependencies from package', []) });
	return result;
}

export function getTaskName(script: string, relativePath: string | undefined) {
	if (relativePath && relativePath.length) {
		return `${script} - ${relativePath.substring(0, relativePath.length - 1)}`;
	}
	return script;
}

export async function createTask(script: NpmTaskDefinition | string, cmd: string, folder: WorkspaceFolder, packageJsonUri: Uri, detail?: string, matcher?: any): Promise<Task> {
	let kind: NpmTaskDefinition;
	if (typeof script === 'string') {
		kind = { type: 'npm', script: script };
	} else {
		kind = script;
	}

	const packageManager = await getPackageManager(folder.uri);
	async function getCommandLine(cmd: string): Promise<string> {
		if (workspace.getConfiguration('npm', folder.uri).get<boolean>('runSilent')) {
			return `${packageManager} --silent ${cmd}`;
		}
		return `${packageManager} ${cmd}`;
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
	const task = new Task(kind, folder, taskName, 'npm', new ShellExecution(await getCommandLine(cmd), { cwd: cwd }), matcher);
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

export async function runScript(script: string, document: TextDocument) {
	let uri = document.uri;
	let folder = workspace.getWorkspaceFolder(uri);
	if (folder) {
		let task = await createTask(script, `run ${script}`, folder, uri);
		tasks.executeTask(task);
	}
}

export async function startDebugging(scriptName: string, cwd: string, folder: WorkspaceFolder) {
	const config: DebugConfiguration = {
		type: 'pwa-node',
		request: 'launch',
		name: `Debug ${scriptName}`,
		cwd,
		runtimeExecutable: await getPackageManager(folder.uri),
		runtimeArgs: [
			'run',
			scriptName,
		],
	};

	if (folder) {
		debug.startDebugging(folder, config);
	}
}


export type StringMap = { [s: string]: string; };

async function findAllScripts(document: TextDocument, buffer: string): Promise<Map<string, { script: string, location: TaskLocation }>> {
	let scripts: Map<string, { script: string, location: TaskLocation }> = new Map();
	let script: string | undefined = undefined;
	let inScripts = false;
	let scriptOffset = 0;

	let visitor: JSONVisitor = {
		onError(_error: ParseErrorCode, _offset: number, _length: number) {
			console.log(_error);
		},
		onObjectEnd() {
			if (inScripts) {
				inScripts = false;
			}
		},
		onLiteralValue(value: any, _offset: number, _length: number) {
			if (script) {
				if (typeof value === 'string') {
					scripts.set(script, { script: value, location: { document: document.uri, line: document.positionAt(scriptOffset) } });
				}
				script = undefined;
			}
		},
		onObjectProperty(property: string, offset: number, _length: number) {
			if (property === 'scripts') {
				inScripts = true;
			}
			else if (inScripts && !script) {
				script = property;
				scriptOffset = offset;
			} else { // nested object which is invalid, ignore the script
				script = undefined;
			}
		}
	};
	visit(buffer, visitor);
	return scripts;
}

export function findAllScriptRanges(buffer: string): Map<string, [number, number, string]> {
	let scripts: Map<string, [number, number, string]> = new Map();
	let script: string | undefined = undefined;
	let offset: number;
	let length: number;

	let inScripts = false;

	let visitor: JSONVisitor = {
		onError(_error: ParseErrorCode, _offset: number, _length: number) {
		},
		onObjectEnd() {
			if (inScripts) {
				inScripts = false;
			}
		},
		onLiteralValue(value: any, _offset: number, _length: number) {
			if (script) {
				scripts.set(script, [offset, length, value]);
				script = undefined;
			}
		},
		onObjectProperty(property: string, off: number, len: number) {
			if (property === 'scripts') {
				inScripts = true;
			}
			else if (inScripts) {
				script = property;
				offset = off;
				length = len;
			}
		}
	};
	visit(buffer, visitor);
	return scripts;
}

export function findScriptAtPosition(buffer: string, offset: number): string | undefined {
	let script: string | undefined = undefined;
	let foundScript: string | undefined = undefined;
	let inScripts = false;
	let scriptStart: number | undefined;
	let visitor: JSONVisitor = {
		onError(_error: ParseErrorCode, _offset: number, _length: number) {
		},
		onObjectEnd() {
			if (inScripts) {
				inScripts = false;
				scriptStart = undefined;
			}
		},
		onLiteralValue(value: any, nodeOffset: number, nodeLength: number) {
			if (inScripts && scriptStart) {
				if (typeof value === 'string' && offset >= scriptStart && offset < nodeOffset + nodeLength) {
					// found the script
					inScripts = false;
					foundScript = script;
				} else {
					script = undefined;
				}
			}
		},
		onObjectProperty(property: string, nodeOffset: number) {
			if (property === 'scripts') {
				inScripts = true;
			}
			else if (inScripts) {
				scriptStart = nodeOffset;
				script = property;
			} else { // nested object which is invalid, ignore the script
				script = undefined;
			}
		}
	};
	visit(buffer, visitor);
	return foundScript;
}

export async function getScripts(packageJsonUri: Uri): Promise<Map<string, { script: string, location: TaskLocation }> | undefined> {

	if (packageJsonUri.scheme !== 'file') {
		return undefined;
	}

	let packageJson = packageJsonUri.fsPath;
	if (!await exists(packageJson)) {
		return undefined;
	}

	try {
		const document: TextDocument = await workspace.openTextDocument(packageJsonUri);
		let contents = document.getText();
		let json = findAllScripts(document, contents);//JSON.parse(contents);
		return json;
	} catch (e) {
		let localizedParseError = localize('npm.parseError', 'Npm task detection: failed to parse the file {0}', packageJsonUri.fsPath);
		throw new Error(localizedParseError);
	}
}
