/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { loadMessageBundle } from 'vscode-nls';
import { ITypeScriptServiceClient } from '../typescriptService';
import { TelemetryReporter } from './telemetry';
import { isImplicitProjectConfigFile, openOrCreateConfig, ProjectType } from './tsconfig';

const localize = loadMessageBundle();

interface Hint {
	message: string;
}

class ExcludeHintItem {
	public configFileName?: string;
	private _item: vscode.StatusBarItem;
	private _currentHint?: Hint;

	constructor(
		private readonly telemetryReporter: TelemetryReporter
	) {
		this._item = vscode.window.createStatusBarItem({
			id: 'status.typescript.exclude',
			name: localize('statusExclude', "TypeScript: Configure Excludes"),
			alignment: vscode.StatusBarAlignment.Right,
			priority: 98 /* to the right of typescript version status (99) */
		});
		this._item.command = 'js.projectStatus.command';
	}

	public getCurrentHint(): Hint {
		return this._currentHint!;
	}

	public hide() {
		this._item.hide();
	}

	public show(largeRoots?: string) {
		this._currentHint = {
			message: largeRoots
				? localize('hintExclude', "To enable project-wide JavaScript/TypeScript language features, exclude folders with many files, like: {0}", largeRoots)
				: localize('hintExclude.generic', "To enable project-wide JavaScript/TypeScript language features, exclude large folders with source files that you do not work on.")
		};
		this._item.tooltip = this._currentHint.message;
		this._item.text = localize('large.label', "Configure Excludes");
		this._item.tooltip = localize('hintExclude.tooltip', "To enable project-wide JavaScript/TypeScript language features, exclude large folders with source files that you do not work on.");
		this._item.color = '#A5DF3B';
		this._item.show();
		/* __GDPR__
			"js.hintProjectExcludes" : {
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
		this.telemetryReporter.logTelemetry('js.hintProjectExcludes');
	}
}


function createLargeProjectMonitorFromTypeScript(item: ExcludeHintItem, client: ITypeScriptServiceClient): vscode.Disposable {

	interface LargeProjectMessageItem extends vscode.MessageItem {
		index: number;
	}

	return client.onProjectLanguageServiceStateChanged(body => {
		if (body.languageServiceEnabled) {
			item.hide();
		} else {
			item.show();
			const configFileName = body.projectName;
			if (configFileName) {
				item.configFileName = configFileName;
				vscode.window.showWarningMessage<LargeProjectMessageItem>(item.getCurrentHint().message,
					{
						title: localize('large.label', "Configure Excludes"),
						index: 0
					}).then(selected => {
						if (selected && selected.index === 0) {
							onConfigureExcludesSelected(client, configFileName);
						}
					});
			}
		}
	});
}

function onConfigureExcludesSelected(
	client: ITypeScriptServiceClient,
	configFileName: string
) {
	if (!isImplicitProjectConfigFile(configFileName)) {
		vscode.workspace.openTextDocument(configFileName)
			.then(vscode.window.showTextDocument);
	} else {
		const root = client.getWorkspaceRootForResource(vscode.Uri.file(configFileName));
		if (root) {
			openOrCreateConfig(
				/tsconfig\.?.*\.json/.test(configFileName) ? ProjectType.TypeScript : ProjectType.JavaScript,
				root,
				client.configuration);
		}
	}
}

export function create(
	client: ITypeScriptServiceClient,
): vscode.Disposable {
	const toDispose: vscode.Disposable[] = [];

	const item = new ExcludeHintItem(client.telemetryReporter);
	toDispose.push(vscode.commands.registerCommand('js.projectStatus.command', () => {
		if (item.configFileName) {
			onConfigureExcludesSelected(client, item.configFileName);
		}
		const { message } = item.getCurrentHint();
		return vscode.window.showInformationMessage(message);
	}));

	toDispose.push(createLargeProjectMonitorFromTypeScript(item, client));

	return vscode.Disposable.from(...toDispose);
}
