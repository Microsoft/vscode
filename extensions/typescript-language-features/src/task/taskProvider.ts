/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ITypeScriptServiceClient, ServerResponse } from '../typescriptService';
import { isTsConfigFileName } from '../utils/languageDescription';
import { Lazy } from '../utils/lazy';
import { isImplicitProjectConfigFile } from '../utils/tsconfig';
import { TSConfig, TsConfigProvider } from './tsconfigProvider';

const localize = nls.loadMessageBundle();

type AutoDetect = 'on' | 'off' | 'build' | 'watch';

const exists = async (resource: vscode.Uri): Promise<boolean> => {
	try {
		const stat = await vscode.workspace.fs.stat(resource);
		// stat.type is an enum flag
		return !!(stat.type & vscode.FileType.File);
	} catch {
		return false;
	}
};

interface TypeScriptTaskDefinition extends vscode.TaskDefinition {
	tsconfig: string;
	option?: string;
}

/**
 * Provides tasks for building `tsconfig.json` files in a project.
 */
class TscTaskProvider implements vscode.TaskProvider {

	private readonly projectInfoRequestTimeout = 2000;
	private autoDetect: AutoDetect = 'on';
	private readonly tsconfigProvider: TsConfigProvider;
	private readonly disposables: vscode.Disposable[] = [];

	public constructor(
		private readonly client: Lazy<ITypeScriptServiceClient>
	) {
		this.tsconfigProvider = new TsConfigProvider();

		vscode.workspace.onDidChangeConfiguration(this.onConfigurationChanged, this, this.disposables);
		this.onConfigurationChanged();
	}

	dispose() {
		this.disposables.forEach(x => x.dispose());
	}

	public async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
		const folders = vscode.workspace.workspaceFolders;
		if ((this.autoDetect === 'off') || !folders || !folders.length) {
			return [];
		}

		const configPaths: Set<string> = new Set();
		const tasks: vscode.Task[] = [];
		for (const project of await this.getAllTsConfigs(token)) {
			if (!configPaths.has(project.fsPath)) {
				configPaths.add(project.fsPath);
				tasks.push(...(await this.getTasksForProject(project)));
			}
		}
		return tasks;
	}

	public async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
		const definition = <TypeScriptTaskDefinition>task.definition;
		if (/\\tsconfig.*\.json/.test(definition.tsconfig)) {
			// Warn that the task has the wrong slash type
			vscode.window.showWarningMessage(localize('badTsConfig', "TypeScript Task in tasks.json contains \"\\\\\". TypeScript tasks tsconfig must use \"/\""));
			return undefined;
		}

		const tsconfigPath = definition.tsconfig;
		if (!tsconfigPath) {
			return undefined;
		}

		if (task.scope === undefined || task.scope === vscode.TaskScope.Global || task.scope === vscode.TaskScope.Workspace) {
			// scope is required to be a WorkspaceFolder for resolveTask
			return undefined;
		}
		const tsconfigUri = task.scope.uri.with({ path: task.scope.uri.path + '/' + tsconfigPath });
		const tsconfig: TSConfig = {
			uri: tsconfigUri,
			fsPath: tsconfigUri.fsPath,
			posixPath: tsconfigUri.path,
			workspaceFolder: task.scope
		};
		return this.getTasksForProjectAndDefinition(tsconfig, definition);
	}

	private async getAllTsConfigs(token: vscode.CancellationToken): Promise<TSConfig[]> {
		const out = new Set<TSConfig>();
		const configs = [
			...await this.getTsConfigForActiveFile(token),
			...await this.getTsConfigsInWorkspace()
		];
		for (const config of configs) {
			if (await exists(config.uri)) {
				out.add(config);
			}
		}
		return Array.from(out);
	}

	private async getTsConfigForActiveFile(token: vscode.CancellationToken): Promise<TSConfig[]> {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			if (isTsConfigFileName(editor.document.fileName)) {
				const uri = editor.document.uri;
				return [{
					uri,
					fsPath: uri.fsPath,
					posixPath: uri.path,
					workspaceFolder: vscode.workspace.getWorkspaceFolder(uri)
				}];
			}
		}

		const file = this.getActiveTypeScriptFile();
		if (!file) {
			return [];
		}

		const response = await Promise.race([
			this.client.value.execute(
				'projectInfo',
				{ file, needFileNameList: false },
				token),
			new Promise<typeof ServerResponse.NoContent>(resolve => setTimeout(() => resolve(ServerResponse.NoContent), this.projectInfoRequestTimeout))
		]);
		if (response.type !== 'response' || !response.body) {
			return [];
		}

		const { configFileName } = response.body;
		if (configFileName && !isImplicitProjectConfigFile(configFileName)) {
			const normalizedConfigPath = path.normalize(configFileName);
			const uri = vscode.Uri.file(normalizedConfigPath);
			const folder = vscode.workspace.getWorkspaceFolder(uri);
			return [{
				uri,
				fsPath: normalizedConfigPath,
				posixPath: uri.path,
				workspaceFolder: folder
			}];
		}

		return [];
	}

	private async getTsConfigsInWorkspace(): Promise<TSConfig[]> {
		return Array.from(await this.tsconfigProvider.getConfigsForWorkspace());
	}

	private static async getCommand(project: TSConfig): Promise<string> {
		if (project.workspaceFolder) {
			const localTsc = await TscTaskProvider.getLocalTscAtPath(path.dirname(project.fsPath));
			if (localTsc) {
				return localTsc;
			}

			const workspaceTsc = await TscTaskProvider.getLocalTscAtPath(project.workspaceFolder.uri.fsPath);
			if (workspaceTsc) {
				return workspaceTsc;
			}
		}

		// Use global tsc version
		return 'tsc';
	}

	private static async getLocalTscAtPath(folderPath: string): Promise<string | undefined> {
		const platform = process.platform;
		const bin = path.join(folderPath, 'node_modules', '.bin');
		if (platform === 'win32' && await exists(vscode.Uri.file(path.join(bin, 'tsc.cmd')))) {
			return path.join(bin, 'tsc.cmd');
		} else if ((platform === 'linux' || platform === 'darwin') && await exists(vscode.Uri.file(path.join(bin, 'tsc')))) {
			return path.join(bin, 'tsc');
		}
		return undefined;
	}

	private getActiveTypeScriptFile(): string | undefined {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			const document = editor.document;
			if (document && (document.languageId === 'typescript' || document.languageId === 'typescriptreact')) {
				return this.client.value.toPath(document.uri);
			}
		}
		return undefined;
	}

	private getBuildTask(workspaceFolder: vscode.WorkspaceFolder | undefined, label: string, command: string, args: string[], buildTaskidentifier: TypeScriptTaskDefinition): vscode.Task {
		const buildTask = new vscode.Task2(
			buildTaskidentifier,
			workspaceFolder || vscode.TaskScope.Workspace,
			localize('buildTscLabel', 'build - {0}', label),
			'tsc',
			new vscode.ShellExecution(command, args),
			'$tsc');
		buildTask.group = vscode.TaskGroup.Build;
		buildTask.isBackground = false;
		return buildTask;
	}

	private getWatchTask(workspaceFolder: vscode.WorkspaceFolder | undefined, label: string, command: string, args: string[], watchTaskidentifier: TypeScriptTaskDefinition) {
		const watchTask = new vscode.Task(
			watchTaskidentifier,
			workspaceFolder || vscode.TaskScope.Workspace,
			localize('buildAndWatchTscLabel', 'watch - {0}', label),
			'tsc',
			new vscode.ShellExecution(command, [...args, '--watch']),
			'$tsc-watch');
		watchTask.group = vscode.TaskGroup.Build;
		watchTask.isBackground = true;
		return watchTask;
	}

	private async getTasksForProject(project: TSConfig): Promise<vscode.Task[]> {
		const command = await TscTaskProvider.getCommand(project);
		const args = await this.getBuildShellArgs(project);
		const label = this.getLabelForTasks(project);

		const tasks: vscode.Task[] = [];

		if (this.autoDetect === 'build' || this.autoDetect === 'on') {
			tasks.push(this.getBuildTask(project.workspaceFolder, label, command, args, { type: 'typescript', tsconfig: label }));
		}

		if (this.autoDetect === 'watch' || this.autoDetect === 'on') {
			tasks.push(this.getWatchTask(project.workspaceFolder, label, command, args, { type: 'typescript', tsconfig: label, option: 'watch' }));
		}

		return tasks;
	}

	private async getTasksForProjectAndDefinition(project: TSConfig, definition: TypeScriptTaskDefinition): Promise<vscode.Task | undefined> {
		const command = await TscTaskProvider.getCommand(project);
		const args = await this.getBuildShellArgs(project);
		const label = this.getLabelForTasks(project);

		let task: vscode.Task | undefined;

		if (definition.option === undefined) {
			task = this.getBuildTask(project.workspaceFolder, label, command, args, definition);
		} else if (definition.option === 'watch') {
			task = this.getWatchTask(project.workspaceFolder, label, command, args, definition);
		}

		return task;
	}

	private async getBuildShellArgs(project: TSConfig): Promise<Array<string>> {
		const defaultArgs = ['-p', project.fsPath];
		try {
			const bytes = await vscode.workspace.fs.readFile(project.uri);
			const text = Buffer.from(bytes).toString('utf-8');
			const tsconfig = jsonc.parse(text);
			if (tsconfig?.references) {
				return ['-b', project.fsPath];
			}
		} catch {
			// noops
		}
		return defaultArgs;
	}

	private getLabelForTasks(project: TSConfig): string {
		if (project.workspaceFolder) {
			const workspaceNormalizedUri = vscode.Uri.file(path.normalize(project.workspaceFolder.uri.fsPath)); // Make sure the drive letter is lowercase
			return path.posix.relative(workspaceNormalizedUri.path, project.posixPath);
		}

		return project.posixPath;
	}

	private onConfigurationChanged(): void {
		const type = vscode.workspace.getConfiguration('typescript.tsc').get<AutoDetect>('autoDetect');
		this.autoDetect = typeof type === 'undefined' ? 'on' : type;
	}
}

export function register(
	lazyClient: Lazy<ITypeScriptServiceClient>,
) {
	return vscode.tasks.registerTaskProvider('typescript', new TscTaskProvider(lazyClient));
}
