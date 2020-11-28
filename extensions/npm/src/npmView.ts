/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JSONVisitor, visit } from 'jsonc-parser';
import * as path from 'path';
import {
	commands, Event, EventEmitter, ExtensionContext,
	Range,
	Selection, Task,
	TaskGroup, tasks, TextDocument, TextDocumentShowOptions, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri,
	window, workspace, WorkspaceFolder
} from 'vscode';
import * as nls from 'vscode-nls';
import {
	createTask, getTaskName, isAutoDetectionEnabled, isWorkspaceFolder, NpmTaskDefinition,
	NpmTaskProvider,
	startDebugging,
	TaskLocation,
	TaskWithLocation
} from './tasks';

const localize = nls.loadMessageBundle();

class Folder extends TreeItem {
	packages: PackageJSON[] = [];
	workspaceFolder: WorkspaceFolder;

	constructor(folder: WorkspaceFolder) {
		super(folder.name, TreeItemCollapsibleState.Expanded);
		this.contextValue = 'folder';
		this.resourceUri = folder.uri;
		this.workspaceFolder = folder;
		this.iconPath = ThemeIcon.Folder;
	}

	addPackage(packageJson: PackageJSON) {
		this.packages.push(packageJson);
	}
}

const packageName = 'package.json';

class PackageJSON extends TreeItem {
	path: string;
	folder: Folder;
	scripts: NpmScript[] = [];

	static getLabel(relativePath: string): string {
		if (relativePath.length > 0) {
			return path.join(relativePath, packageName);
		}
		return packageName;
	}

	constructor(folder: Folder, relativePath: string) {
		super(PackageJSON.getLabel(relativePath), TreeItemCollapsibleState.Expanded);
		this.folder = folder;
		this.path = relativePath;
		this.contextValue = 'packageJSON';
		if (relativePath) {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, relativePath, packageName));
		} else {
			this.resourceUri = Uri.file(path.join(folder!.resourceUri!.fsPath, packageName));
		}
		this.iconPath = ThemeIcon.File;
	}

	addScript(script: NpmScript) {
		this.scripts.push(script);
	}
}

type ExplorerCommands = 'open' | 'run';

class NpmScript extends TreeItem {
	task: Task;
	package: PackageJSON;

	constructor(_context: ExtensionContext, packageJson: PackageJSON, task: Task, public taskLocation?: TaskLocation) {
		super(task.name, TreeItemCollapsibleState.None);
		const command: ExplorerCommands = workspace.getConfiguration('npm').get<ExplorerCommands>('scriptExplorerAction') || 'open';

		const commandList = {
			'open': {
				title: 'Edit Script',
				command: 'vscode.open',
				arguments: [
					taskLocation?.document,
					taskLocation ? <TextDocumentShowOptions>{
						selection: new Range(taskLocation.line, taskLocation.line)
					} : undefined
				]
			},
			'run': {
				title: 'Run Script',
				command: 'npm.runScript',
				arguments: [this]
			}
		};
		this.contextValue = 'script';
		this.package = packageJson;
		this.task = task;
		this.command = commandList[command];

		if (task.group && task.group === TaskGroup.Clean) {
			this.iconPath = new ThemeIcon('wrench-subaction');
		} else {
			this.iconPath = new ThemeIcon('wrench');
		}
		if (task.detail) {
			this.tooltip = task.detail;
		}
	}

	getFolder(): WorkspaceFolder {
		return this.package.folder.workspaceFolder;
	}
}

class NoScripts extends TreeItem {
	constructor(message: string) {
		super(message, TreeItemCollapsibleState.None);
		this.contextValue = 'noscripts';
	}
}

export class NpmScriptsTreeDataProvider implements TreeDataProvider<TreeItem> {
	private taskTree: Folder[] | PackageJSON[] | NoScripts[] | null = null;
	private extensionContext: ExtensionContext;
	private _onDidChangeTreeData: EventEmitter<TreeItem | null> = new EventEmitter<TreeItem | null>();
	readonly onDidChangeTreeData: Event<TreeItem | null> = this._onDidChangeTreeData.event;

	constructor(context: ExtensionContext, public taskProvider: NpmTaskProvider) {
		const subscriptions = context.subscriptions;
		this.extensionContext = context;
		subscriptions.push(commands.registerCommand('npm.runScript', this.runScript, this));
		subscriptions.push(commands.registerCommand('npm.debugScript', this.debugScript, this));
		subscriptions.push(commands.registerCommand('npm.openScript', this.openScript, this));
		subscriptions.push(commands.registerCommand('npm.runInstall', this.runInstall, this));
	}

	private async runScript(script: NpmScript) {
		tasks.executeTask(script.task);
	}

	private async debugScript(script: NpmScript) {
		startDebugging(script.task.definition.script, path.dirname(script.package.resourceUri!.fsPath), script.getFolder());
	}

	private findScript(document: TextDocument, script?: NpmScript): number {
		let scriptOffset = 0;
		let inScripts = false;

		let visitor: JSONVisitor = {
			onError() {
				return scriptOffset;
			},
			onObjectEnd() {
				if (inScripts) {
					inScripts = false;
				}
			},
			onObjectProperty(property: string, offset: number, _length: number) {
				if (property === 'scripts') {
					inScripts = true;
					if (!script) { // select the script section
						scriptOffset = offset;
					}
				}
				else if (inScripts && script) {
					let label = getTaskName(property, script.task.definition.path);
					if (script.task.name === label) {
						scriptOffset = offset;
					}
				}
			}
		};
		visit(document.getText(), visitor);
		return scriptOffset;

	}

	private async runInstall(selection: PackageJSON) {
		let uri: Uri | undefined = undefined;
		if (selection instanceof PackageJSON) {
			uri = selection.resourceUri;
		}
		if (!uri) {
			return;
		}
		let task = await createTask('install', 'install', selection.folder.workspaceFolder, uri, undefined, []);
		tasks.executeTask(task);
	}

	private async openScript(selection: PackageJSON | NpmScript) {
		let uri: Uri | undefined = undefined;
		if (selection instanceof PackageJSON) {
			uri = selection.resourceUri!;
		} else if (selection instanceof NpmScript) {
			uri = selection.package.resourceUri;
		}
		if (!uri) {
			return;
		}
		let document: TextDocument = await workspace.openTextDocument(uri);
		let offset = this.findScript(document, selection instanceof NpmScript ? selection : undefined);
		let position = document.positionAt(offset);
		await window.showTextDocument(document, { preserveFocus: true, selection: new Selection(position, position) });
	}

	public refresh() {
		this.taskTree = null;
		this._onDidChangeTreeData.fire(null);
	}

	getTreeItem(element: TreeItem): TreeItem {
		return element;
	}

	getParent(element: TreeItem): TreeItem | null {
		if (element instanceof Folder) {
			return null;
		}
		if (element instanceof PackageJSON) {
			return element.folder;
		}
		if (element instanceof NpmScript) {
			return element.package;
		}
		if (element instanceof NoScripts) {
			return null;
		}
		return null;
	}

	async getChildren(element?: TreeItem): Promise<TreeItem[]> {
		if (!this.taskTree) {
			const taskItems = await this.taskProvider.tasksWithLocation;
			if (taskItems) {
				this.taskTree = this.buildTaskTree(taskItems);
				if (this.taskTree.length === 0) {
					let message = localize('noScripts', 'No scripts found.');
					if (!isAutoDetectionEnabled()) {
						message = localize('autoDetectIsOff', 'The setting "npm.autoDetect" is "off".');
					}
					this.taskTree = [new NoScripts(message)];
				}
			}
		}
		if (element instanceof Folder) {
			return element.packages;
		}
		if (element instanceof PackageJSON) {
			return element.scripts;
		}
		if (element instanceof NpmScript) {
			return [];
		}
		if (element instanceof NoScripts) {
			return [];
		}
		if (!element) {
			if (this.taskTree) {
				return this.taskTree;
			}
		}
		return [];
	}

	private isInstallTask(task: Task): boolean {
		let fullName = getTaskName('install', task.definition.path);
		return fullName === task.name;
	}

	private buildTaskTree(tasks: TaskWithLocation[]): Folder[] | PackageJSON[] | NoScripts[] {
		let folders: Map<String, Folder> = new Map();
		let packages: Map<String, PackageJSON> = new Map();

		let folder = null;
		let packageJson = null;

		tasks.forEach(each => {
			if (isWorkspaceFolder(each.task.scope) && !this.isInstallTask(each.task)) {
				folder = folders.get(each.task.scope.name);
				if (!folder) {
					folder = new Folder(each.task.scope);
					folders.set(each.task.scope.name, folder);
				}
				let definition: NpmTaskDefinition = <NpmTaskDefinition>each.task.definition;
				let relativePath = definition.path ? definition.path : '';
				let fullPath = path.join(each.task.scope.name, relativePath);
				packageJson = packages.get(fullPath);
				if (!packageJson) {
					packageJson = new PackageJSON(folder, relativePath);
					folder.addPackage(packageJson);
					packages.set(fullPath, packageJson);
				}
				let script = new NpmScript(this.extensionContext, packageJson, each.task, each.location);
				packageJson.addScript(script);
			}
		});
		if (folders.size === 1) {
			return [...packages.values()];
		}
		return [...folders.values()];
	}
}
