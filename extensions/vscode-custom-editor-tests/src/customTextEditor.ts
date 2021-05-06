/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as pLimit from 'p-limit';
import * as path from 'path';
import * as vscode from 'vscode';
import { Disposable } from './dispose';

export namespace Testing {
	export const abcEditorContentChangeCommand = '_abcEditor.contentChange';
	export const abcEditorTypeCommand = '_abcEditor.type';

	export interface CustomEditorContentChangeEvent {
		readonly content: string;
		readonly source: vscode.Uri;
	}
}

export class AbcTextEditorProvider implements vscode.CustomTextEditorProvider {

	public static readonly viewType = 'testWebviewEditor.abc';

	private activeEditor?: AbcEditor;

	public constructor(
		private readonly context: vscode.ExtensionContext,
	) { }

	public register(): vscode.Disposable {
		const provider = vscode.window.registerCustomEditorProvider(AbcTextEditorProvider.viewType, this);

		const commands: vscode.Disposable[] = [];
		commands.push(vscode.commands.registerCommand(Testing.abcEditorTypeCommand, (content: string) => {
			this.activeEditor?.testing_fakeInput(content);
		}));

		return vscode.Disposable.from(provider, ...commands);
	}

	public async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
		const editor = new AbcEditor(document, this.context.extensionPath, panel);

		this.activeEditor = editor;

		panel.onDidChangeViewState(({ webviewPanel }) => {
			if (this.activeEditor === editor && !webviewPanel.active) {
				this.activeEditor = undefined;
			}
			if (webviewPanel.active) {
				this.activeEditor = editor;
			}
		});
	}
}

class AbcEditor extends Disposable {

	public readonly _onDispose = this._register(new vscode.EventEmitter<void>());
	public readonly onDispose = this._onDispose.event;

	private readonly limit = pLimit(1);
	private syncedVersion: number = -1;
	private currentWorkspaceEdit?: Thenable<void>;

	constructor(
		private readonly document: vscode.TextDocument,
		private readonly _extensionPath: string,
		private readonly panel: vscode.WebviewPanel,
	) {
		super();

		panel.webview.options = {
			enableScripts: true,
		};
		panel.webview.html = this.html;

		this._register(vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document === this.document) {
				this.update();
			}
		}));

		this._register(panel.webview.onDidReceiveMessage(message => {
			switch (message.type) {
				case 'edit':
					this.doEdit(message.value);
					break;

				case 'didChangeContent':
					vscode.commands.executeCommand(Testing.abcEditorContentChangeCommand, {
						content: message.value,
						source: document.uri,
					} as Testing.CustomEditorContentChangeEvent);
					break;
			}
		}));

		this._register(panel.onDidDispose(() => { this.dispose(); }));

		this.update();
	}

	public testing_fakeInput(value: string) {
		this.panel.webview.postMessage({
			type: 'fakeInput',
			value: value,
		});
	}

	private async doEdit(value: string) {
		const edit = new vscode.WorkspaceEdit();
		edit.replace(this.document.uri, this.document.validateRange(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(999999, 999999))), value);
		this.limit(() => {
			this.currentWorkspaceEdit = vscode.workspace.applyEdit(edit).then(() => {
				this.syncedVersion = this.document.version;
				this.currentWorkspaceEdit = undefined;
			});
			return this.currentWorkspaceEdit;
		});
	}

	public override dispose() {
		if (this.isDisposed) {
			return;
		}

		this._onDispose.fire();
		super.dispose();
	}

	private get html() {
		const contentRoot = path.join(this._extensionPath, 'customEditorMedia');
		const scriptUri = vscode.Uri.file(path.join(contentRoot, 'textEditor.js'));
		const nonce = Date.now() + '';
		return /* html */`<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
				<title>Document</title>
			</head>
			<body>
				<textarea style="width: 300px; height: 300px;"></textarea>
				<script nonce=${nonce} src="${this.panel.webview.asWebviewUri(scriptUri)}"></script>
			</body>
			</html>`;
	}

	public async update() {
		await this.currentWorkspaceEdit;

		if (this.isDisposed || this.syncedVersion >= this.document.version) {
			return;
		}

		this.panel.webview.postMessage({
			type: 'setValue',
			value: this.document.getText(),
		});
		this.syncedVersion = this.document.version;
	}
}
