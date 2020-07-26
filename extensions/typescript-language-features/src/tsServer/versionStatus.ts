/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { Command, CommandManager } from '../commands/commandManager';
import { ITypeScriptServiceClient } from '../typescriptService';
import { coalesce } from '../utils/arrays';
import { Disposable } from '../utils/dispose';
import { isTypeScriptDocument } from '../utils/languageModeIds';
import { isImplicitProjectConfigFile, openOrCreateConfig, openProjectConfigForFile, openProjectConfigOrPromptToCreate, ProjectType } from '../utils/tsconfig';
import { TypeScriptVersion } from './versionProvider';

const localize = nls.loadMessageBundle();


namespace ProjectInfoState {
	export const enum Type { None, Pending, Resolved }

	export const None = Object.freeze({ type: Type.None } as const);

	export class Pending {
		public readonly type = Type.Pending;

		public readonly cancellation = new vscode.CancellationTokenSource();

		constructor(
			public readonly resource: vscode.Uri,
		) { }
	}

	export class Resolved {
		public readonly type = Type.Resolved;

		constructor(
			public readonly resource: vscode.Uri,
			public readonly configFile: string,
		) { }
	}

	export type State = typeof None | Pending | Resolved;
}

interface QuickPickItem extends vscode.QuickPickItem {
	run(): void;
}

class ProjectStatusCommand implements Command {
	public readonly id = '_typescript.projectStatus';

	public constructor(
		private readonly _client: ITypeScriptServiceClient,
		private readonly _delegate: () => ProjectInfoState.State,
	) { }

	public async execute(): Promise<void> {
		const info = this._delegate();


		const result = await vscode.window.showQuickPick<QuickPickItem>(coalesce([
			this.getProjectItem(info),
			this.getVersionItem(),
			this.getHelpItem(),
		]), {
			placeHolder: localize('projectQuickPick.placeholder', "TypeScript Project Info"),
		});

		return result?.run();
	}

	private getVersionItem(): QuickPickItem {
		return {
			label: localize('projectQuickPick.version.label', "Select TypeScript Version..."),
			description: this._client.apiVersion.displayName,
			run: () => {
				this._client.showVersionPicker();
			}
		};
	}

	private getProjectItem(info: ProjectInfoState.State): QuickPickItem | undefined {
		const rootPath = info.type === ProjectInfoState.Type.Resolved ? this._client.getWorkspaceRootForResource(info.resource) : undefined;
		if (!rootPath) {
			return undefined;
		}

		if (info.type === ProjectInfoState.Type.Resolved) {
			if (isImplicitProjectConfigFile(info.configFile)) {
				return {
					label: localize('projectQuickPick.project.create', "Create tsconfig"),
					detail: localize('projectQuickPick.project.create.description', "This file is currently not part of a tsconfig/jsconfig project"),
					run: () => {
						openOrCreateConfig(ProjectType.TypeScript, rootPath, this._client.configuration);
					}
				};
			}
		}

		return {
			label: localize('projectQuickPick.version.goProjectConfig', "Open tsconfig"),
			description: info.type === ProjectInfoState.Type.Resolved ? vscode.workspace.asRelativePath(info.configFile) : undefined,
			run: () => {
				if (info.type === ProjectInfoState.Type.Resolved) {
					openProjectConfigOrPromptToCreate(ProjectType.TypeScript, this._client, rootPath, info.configFile);
				} else if (info.type === ProjectInfoState.Type.Pending) {
					openProjectConfigForFile(ProjectType.TypeScript, this._client, info.resource);
				}
			}
		};
	}

	private getHelpItem(): QuickPickItem {
		return {
			label: localize('projectQuickPick.help', "TypeScript help"),
			run: () => {
				vscode.env.openExternal(vscode.Uri.parse('https://go.microsoft.com/fwlink/?linkid=839919')); // TODO:
			}
		};
	}
}

export default class VersionStatus extends Disposable {

	private readonly _statusBarEntry: vscode.StatusBarItem;

	private _ready = false;
	private _state: ProjectInfoState.State = ProjectInfoState.None;

	constructor(
		private readonly _client: ITypeScriptServiceClient,
		commandManager: CommandManager,
	) {
		super();

		this._statusBarEntry = this._register(vscode.window.createStatusBarItem({
			id: 'status.typescript',
			name: localize('projectInfo.name', "TypeScript: Project Info"),
			alignment: vscode.StatusBarAlignment.Right,
			priority: 99 /* to the right of editor status (100) */
		}));

		const command = new ProjectStatusCommand(this._client, () => this._state);
		commandManager.register(command);
		this._statusBarEntry.command = command.id;

		vscode.window.onDidChangeActiveTextEditor(this.updateStatus, this, this._disposables);

		this._client.onReady(() => {
			this._ready = true;
			this.updateStatus();
		});

		this._register(this._client.onTsServerStarted(({ version }) => this.onDidChangeTypeScriptVersion(version)));
	}

	private onDidChangeTypeScriptVersion(version: TypeScriptVersion) {
		this._statusBarEntry.text = version.displayName;
		this._statusBarEntry.tooltip = version.path;
		this.updateStatus();
	}

	private async updateStatus() {
		if (!vscode.window.activeTextEditor) {
			this.hide();
			return;
		}

		const doc = vscode.window.activeTextEditor.document;
		if (isTypeScriptDocument(doc)) {
			const file = this._client.normalizedPath(doc.uri);
			if (file) {
				this._statusBarEntry.show();
				if (!this._ready) {
					return;
				}

				const pendingState = new ProjectInfoState.Pending(doc.uri);
				this.updateState(pendingState);

				const response = await this._client.execute('projectInfo', { file, needFileNameList: false }, pendingState.cancellation.token);
				if (response.type === 'response' && response.body) {
					if (this._state === pendingState) {
						this.updateState(new ProjectInfoState.Resolved(doc.uri, response.body.configFileName));
						this._statusBarEntry.show();
					}
				}

				return;
			}
		}

		if (!vscode.window.activeTextEditor.viewColumn) {
			// viewColumn is undefined for the debug/output panel, but we still want
			// to show the version info in the existing editor
			return;
		}

		this.hide();
	}

	private hide(): void {
		this._statusBarEntry.hide();
		this.updateState(ProjectInfoState.None);
	}

	private updateState(newState: ProjectInfoState.State): void {
		if (this._state === newState) {
			return;
		}

		if (this._state.type === ProjectInfoState.Type.Pending) {
			this._state.cancellation.cancel();
			this._state.cancellation.dispose();
		}

		this._state = newState;
	}
}
