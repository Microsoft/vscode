/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import { Disposable } from '../utils/dispose';
import { ITypeScriptVersionProvider, TypeScriptVersion } from './versionProvider';

const localize = nls.loadMessageBundle();

const useWorkspaceTsdkStorageKey = 'typescript.useWorkspaceTsdk';
const suppressPromptWorkspaceTsdkStorageKey = 'typescript.suppressPromptWorkspaceTsdk';

interface QuickPickItem extends vscode.QuickPickItem {
	run(): void;
}

export class TypeScriptVersionManager extends Disposable {

	private _currentVersion: TypeScriptVersion;

	public constructor(
		private configuration: TypeScriptServiceConfiguration,
		private readonly versionProvider: ITypeScriptVersionProvider,
		private readonly workspaceState: vscode.Memento
	) {
		super();

		this._currentVersion = this.versionProvider.defaultVersion;

		if (this.useWorkspaceTsdkSetting) {
			const localVersion = this.versionProvider.localVersion;
			if (localVersion) {
				this._currentVersion = localVersion;
			}
		}

		if (this.isInPromptWorkspaceTsdkState(configuration)) {
			setImmediate(() => {
				this.promptUseWorkspaceTsdk();
			});
		}

	}

	private readonly _onDidPickNewVersion = this._register(new vscode.EventEmitter<void>());
	public readonly onDidPickNewVersion = this._onDidPickNewVersion.event;

	public updateConfiguration(nextConfiguration: TypeScriptServiceConfiguration) {
		const lastConfiguration = this.configuration;
		this.configuration = nextConfiguration;

		if (
			!this.isInPromptWorkspaceTsdkState(lastConfiguration)
			&& this.isInPromptWorkspaceTsdkState(nextConfiguration)
		) {
			this.promptUseWorkspaceTsdk();
		}
	}

	public get currentVersion(): TypeScriptVersion {
		return this._currentVersion;
	}

	public reset(): void {
		this._currentVersion = this.versionProvider.bundledVersion;
	}

	public async promptUserForVersion(): Promise<void> {
		const selected = await vscode.window.showQuickPick<QuickPickItem>([
			this.getBundledPickItem(),
			...this.getLocalPickItems(),
			LearnMorePickItem,
		], {
			placeHolder: localize(
				'selectTsVersion',
				"Select the TypeScript version used for JavaScript and TypeScript language features"),
		});

		return selected?.run();
	}

	private getBundledPickItem(): QuickPickItem {
		const bundledVersion = this.versionProvider.defaultVersion;
		return {
			label: (!this.useWorkspaceTsdkSetting
				? '• '
				: '') + localize('useVSCodeVersionOption', "Use VS Code's Version"),
			description: bundledVersion.displayName,
			detail: bundledVersion.pathLabel,
			run: async () => {
				await this.workspaceState.update(useWorkspaceTsdkStorageKey, false);
				this.updateActiveVersion(bundledVersion);
			},
		};
	}

	private getLocalPickItems(): QuickPickItem[] {
		return this.versionProvider.localVersions.map(version => {
			return {
				label: (this.useWorkspaceTsdkSetting && this.currentVersion.eq(version)
					? '• '
					: '') + localize('useWorkspaceVersionOption', "Use Workspace Version"),
				description: version.displayName,
				detail: version.pathLabel,
				run: async () => {
					await this.workspaceState.update(useWorkspaceTsdkStorageKey, true);
					const tsConfig = vscode.workspace.getConfiguration('typescript');
					await tsConfig.update('tsdk', version.pathLabel, false);
					this.updateActiveVersion(version);
				},
			};
		});
	}

	private async promptUseWorkspaceTsdk(): Promise<void> {
		const workspaceVersion = this.versionProvider.localVersion;

		if (workspaceVersion === undefined) {
			throw new Error('Could not prompt to use workspace TypeScript version because no workspace version is specified');
		}

		const allowIt = localize('allow', 'Allow');
		const dismissPrompt = localize('dismiss', 'Dismiss');
		const suppressPrompt = localize('suppress prompt', 'Never in this Workspace');

		const result = await vscode.window.showInformationMessage(localize('promptUseWorkspaceTsdk', 'This workspace contains a TypeScript version. Would you like to use the workspace TypeScript version for TypeScript and JavaScript language features?'),
			allowIt,
			dismissPrompt,
			suppressPrompt
		);

		if (result === allowIt) {
			await this.workspaceState.update(useWorkspaceTsdkStorageKey, true);
			this.updateActiveVersion(workspaceVersion);
		} else if (result === suppressPrompt) {
			await this.workspaceState.update(suppressPromptWorkspaceTsdkStorageKey, true);
		}
	}

	private updateActiveVersion(pickedVersion: TypeScriptVersion) {
		const oldVersion = this.currentVersion;
		this._currentVersion = pickedVersion;
		if (!oldVersion.eq(pickedVersion)) {
			this._onDidPickNewVersion.fire();
		}
	}

	private get useWorkspaceTsdkSetting(): boolean {
		return this.workspaceState.get<boolean>(useWorkspaceTsdkStorageKey, false);
	}

	private get suppressPromptWorkspaceTsdkSetting(): boolean {
		return this.workspaceState.get<boolean>(suppressPromptWorkspaceTsdkStorageKey, false);
	}

	private isInPromptWorkspaceTsdkState(configuration: TypeScriptServiceConfiguration) {
		return (
			configuration.localTsdk !== null
			&& configuration.enablePromptUseWorkspaceTsdk === true
			&& this.suppressPromptWorkspaceTsdkSetting === false
			&& this.useWorkspaceTsdkSetting === false
		);
	}
}

const LearnMorePickItem: QuickPickItem = {
	label: localize('learnMore', 'Learn more about managing TypeScript versions'),
	description: '',
	run: () => {
		vscode.env.openExternal(vscode.Uri.parse('https://go.microsoft.com/fwlink/?linkid=839919'));
	}
};
