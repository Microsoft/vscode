/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './dispose';
import { isJsConfigOrTsConfigFileName } from './languageDescription';
import { isSupportedLanguageMode } from './languageModeIds';

/**
 * When clause context set when the current file is managed by vscode's built-in typescript extension.
 */
export default class ManagedFileContextManager extends Disposable {
	private static readonly contextName = 'typescript.isManagedFile';

	private isInManagedFileContext: boolean = false;

	public constructor(
		private readonly normalizePath: (resource: vscode.Uri) => string | undefined
	) {
		super();
		vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, this._disposables);

		this.onDidChangeActiveTextEditor(vscode.window.activeTextEditor);
	}

	private onDidChangeActiveTextEditor(editor?: vscode.TextEditor): any {
		if (editor) {
			this.updateContext(this.isManagedFile(editor));
		}
	}

	private updateContext(newValue: boolean) {
		if (newValue === this.isInManagedFileContext) {
			return;
		}

		vscode.commands.executeCommand('setContext', ManagedFileContextManager.contextName, newValue);
		this.isInManagedFileContext = newValue;
	}

	private isManagedFile(editor: vscode.TextEditor): boolean {
		return this.isManagedScriptFile(editor) || this.isManagedConfigFile(editor);
	}

	private isManagedScriptFile(editor: vscode.TextEditor): boolean {
		return isSupportedLanguageMode(editor.document) && this.normalizePath(editor.document.uri) !== null;
	}

	private isManagedConfigFile(editor: vscode.TextEditor): boolean {
		return isJsConfigOrTsConfigFileName(editor.document.fileName);
	}
}
