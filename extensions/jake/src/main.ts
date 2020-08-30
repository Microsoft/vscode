/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

type AutoDetect = 'on' | 'off';

function exists(file: string): Promise<boolean> {
	return new Promise<boolean>((resolve, _reject) => {
		fs.exists(file, (value) => {
			resolve(value);
		});
	});
}

function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
		cp.exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject({ error, stdout, stderr });
			}
			resolve({ stdout, stderr });
		});
	});
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
		if (name.indexOf(testName) !== -1) {
			return true;
		}
	}
	return false;
}

let _channel: vscode.OutputChannel;
function getOutputChannel(): vscode.OutputChannel {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('Jake Auto Detection');
	}
	return _channel;
}

function showError() {
	vscode.window.showWarningMessage(localize('jakeTaskDetectError', 'Problem finding jake tasks. See the output for more information.'),
		localize('jakeShowOutput', 'Go to output')).then(() => {
			getOutputChannel().show(true);
		});
}

async function findJakeCommand(rootPath: string): Promise<string> {
	let jakeCommand: string;
	let platform = process.platform;
	if (platform === 'win32' && await exists(path.join(rootPath!, 'node_modules', '.bin', 'jake.cmd'))) {
		jakeCommand = path.join('.', 'node_modules', '.bin', 'jake.cmd');
	} else if ((platform === 'linux' || platform === 'darwin') && await exists(path.join(rootPath!, 'node_modules', '.bin', 'jake'))) {
		jakeCommand = path.join('.', 'node_modules', '.bin', 'jake');
	} else {
		jakeCommand = 'jake';
	}
	return jakeCommand;
}

interface JakeTaskDefinition extends vscode.TaskDefinition {
	task: string;
	file?: string;
}

class FolderDetector {

	private fileWatcher: vscode.FileSystemWatcher | undefined;
	private promise: Thenable<vscode.Task[]> | undefined;

	constructor(
		private _workspaceFolder: vscode.WorkspaceFolder,
		private _jakeCommand: Promise<string>) {
	}

	public get workspaceFolder(): vscode.WorkspaceFolder {
		return this._workspaceFolder;
	}

	public isEnabled(): boolean {
		return vscode.workspace.getConfiguration('jake', this._workspaceFolder.uri).get<AutoDetect>('autoDetect') === 'on';
	}

	public start(): void {
		let pattern = path.join(this._workspaceFolder.uri.fsPath, '{node_modules,Jakefile,Jakefile.js}');
		this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		this.fileWatcher.onDidChange(() => this.promise = undefined);
		this.fileWatcher.onDidCreate(() => this.promise = undefined);
		this.fileWatcher.onDidDelete(() => this.promise = undefined);
	}

	public async getTasks(): Promise<vscode.Task[]> {
		if (this.isEnabled()) {
			if (!this.promise) {
				this.promise = this.computeTasks();
			}
			return this.promise;
		} else {
			return [];
		}
	}

	public async getTask(_task: vscode.Task): Promise<vscode.Task | undefined> {
		const jakeTask = (<any>_task.definition).task;
		if (jakeTask) {
			let kind: JakeTaskDefinition = (<any>_task.definition);
			let options: vscode.ShellExecutionOptions = { cwd: this.workspaceFolder.uri.fsPath };
			let task = new vscode.Task(kind, this.workspaceFolder, jakeTask, 'jake', new vscode.ShellExecution(await this._jakeCommand, [jakeTask], options));
			return task;
		}
		return undefined;
	}

	private async computeTasks(): Promise<vscode.Task[]> {
		let rootPath = this._workspaceFolder.uri.scheme === 'file' ? this._workspaceFolder.uri.fsPath : undefined;
		let emptyTasks: vscode.Task[] = [];
		if (!rootPath) {
			return emptyTasks;
		}
		let jakefile = path.join(rootPath, 'Jakefile');
		if (!await exists(jakefile)) {
			jakefile = path.join(rootPath, 'Jakefile.js');
			if (! await exists(jakefile)) {
				return emptyTasks;
			}
		}

		let commandLine = `${await this._jakeCommand} --tasks`;
		try {
			let { stdout, stderr } = await exec(commandLine, { cwd: rootPath });
			if (stderr) {
				getOutputChannel().appendLine(stderr);
				showError();
			}
			let result: vscode.Task[] = [];
			if (stdout) {
				let lines = stdout.split(/\r{0,1}\n/);
				for (let line of lines) {
					if (line.length === 0) {
						continue;
					}
					let regExp = /^jake\s+([^\s]+)\s/g;
					let matches = regExp.exec(line);
					if (matches && matches.length === 2) {
						let taskName = matches[1];
						let kind: JakeTaskDefinition = {
							type: 'jake',
							task: taskName
						};
						let options: vscode.ShellExecutionOptions = { cwd: this.workspaceFolder.uri.fsPath };
						let task = new vscode.Task(kind, taskName, 'jake', new vscode.ShellExecution(`${await this._jakeCommand} ${taskName}`, options));
						result.push(task);
						let lowerCaseLine = line.toLowerCase();
						if (isBuildTask(lowerCaseLine)) {
							task.group = vscode.TaskGroup.Build;
						} else if (isTestTask(lowerCaseLine)) {
							task.group = vscode.TaskGroup.Test;
						}
					}
				}
			}
			return result;
		} catch (err) {
			let channel = getOutputChannel();
			if (err.stderr) {
				channel.appendLine(err.stderr);
			}
			if (err.stdout) {
				channel.appendLine(err.stdout);
			}
			channel.appendLine(localize('execFailed', 'Auto detecting Jake for folder {0} failed with error: {1}', this.workspaceFolder.name, err.error ? err.error.toString() : 'unknown'));
			showError();
			return emptyTasks;
		}
	}

	public dispose() {
		this.promise = undefined;
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
		}
	}
}

class TaskDetector {

	private taskProvider: vscode.Disposable | undefined;
	private detectors: Map<string, FolderDetector> = new Map();

	constructor() {
	}

	public start(): void {
		let folders = vscode.workspace.workspaceFolders;
		if (folders) {
			this.updateWorkspaceFolders(folders, []);
		}
		vscode.workspace.onDidChangeWorkspaceFolders((event) => this.updateWorkspaceFolders(event.added, event.removed));
		vscode.workspace.onDidChangeConfiguration(this.updateConfiguration, this);
	}

	public dispose(): void {
		if (this.taskProvider) {
			this.taskProvider.dispose();
			this.taskProvider = undefined;
		}
		this.detectors.clear();
	}

	private updateWorkspaceFolders(added: readonly vscode.WorkspaceFolder[], removed: readonly vscode.WorkspaceFolder[]): void {
		for (let remove of removed) {
			let detector = this.detectors.get(remove.uri.toString());
			if (detector) {
				detector.dispose();
				this.detectors.delete(remove.uri.toString());
			}
		}
		for (let add of added) {
			let detector = new FolderDetector(add, findJakeCommand(add.uri.fsPath));
			this.detectors.set(add.uri.toString(), detector);
			if (detector.isEnabled()) {
				detector.start();
			}
		}
		this.updateProvider();
	}

	private updateConfiguration(): void {
		for (let detector of this.detectors.values()) {
			detector.dispose();
			this.detectors.delete(detector.workspaceFolder.uri.toString());
		}
		let folders = vscode.workspace.workspaceFolders;
		if (folders) {
			for (let folder of folders) {
				if (!this.detectors.has(folder.uri.toString())) {
					let detector = new FolderDetector(folder, findJakeCommand(folder.uri.fsPath));
					this.detectors.set(folder.uri.toString(), detector);
					if (detector.isEnabled()) {
						detector.start();
					}
				}
			}
		}
		this.updateProvider();
	}

	private updateProvider(): void {
		if (!this.taskProvider && this.detectors.size > 0) {
			const thisCapture = this;
			this.taskProvider = vscode.tasks.registerTaskProvider('jake', {
				provideTasks(): Promise<vscode.Task[]> {
					return thisCapture.getTasks();
				},
				resolveTask(_task: vscode.Task): Promise<vscode.Task | undefined> {
					return thisCapture.getTask(_task);
				}
			});
		}
		else if (this.taskProvider && this.detectors.size === 0) {
			this.taskProvider.dispose();
			this.taskProvider = undefined;
		}
	}

	public getTasks(): Promise<vscode.Task[]> {
		return this.computeTasks();
	}

	private computeTasks(): Promise<vscode.Task[]> {
		if (this.detectors.size === 0) {
			return Promise.resolve([]);
		} else if (this.detectors.size === 1) {
			return this.detectors.values().next().value.getTasks();
		} else {
			let promises: Promise<vscode.Task[]>[] = [];
			for (let detector of this.detectors.values()) {
				promises.push(detector.getTasks().then((value) => value, () => []));
			}
			return Promise.all(promises).then((values) => {
				let result: vscode.Task[] = [];
				for (let tasks of values) {
					if (tasks && tasks.length > 0) {
						result.push(...tasks);
					}
				}
				return result;
			});
		}
	}

	public async getTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		if (this.detectors.size === 0) {
			return undefined;
		} else if (this.detectors.size === 1) {
			return this.detectors.values().next().value.getTask(task);
		} else {
			if ((task.scope === vscode.TaskScope.Workspace) || (task.scope === vscode.TaskScope.Global)) {
				// Not supported, we don't have enough info to create the task.
				return undefined;
			} else if (task.scope) {
				const detector = this.detectors.get(task.scope.uri.toString());
				if (detector) {
					return detector.getTask(task);
				}
			}
			return undefined;
		}
	}
}

let detector: TaskDetector;
export function activate(_context: vscode.ExtensionContext): void {
	detector = new TaskDetector();
	detector.start();
}

export function deactivate(): void {
	detector.dispose();
}
