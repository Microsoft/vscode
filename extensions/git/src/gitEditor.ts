/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { workspace, window, Uri } from 'vscode';
import { v4 as uuid } from 'uuid';


import { IIPCHandler, IIPCServer } from './ipc/ipcServer';
import { IDisposable, EmptyDisposable } from './util';

interface GitEditorRequest {
	commitMessagePath?: string;
}

export class GitEditor implements IIPCHandler {

	private disposable: IDisposable = EmptyDisposable;

	constructor(private ipc?: IIPCServer) {
		if (ipc) {
			this.disposable = ipc.registerHandler('git-editor', this);
		}
	}

	async handle({ commitMessagePath }: GitEditorRequest): Promise<any> {
		if (commitMessagePath) {
			const id = uuid();
			const uri = Uri.parse(`gitcommit://${id}/${commitMessagePath}`);
			const doc = await workspace.openTextDocument(uri);
			await window.showTextDocument(doc);

			return new Promise((c) => {
				const onDidChange = window.onDidChangeVisibleTextEditors(async (editors) => {
					if (!editors.find(editor => `${editor.document.uri}` === `${uri}`)) {
						onDidChange.dispose();

						// dump in-memory content to actual COMMIT_MESSAGE file
						await workspace.fs.writeFile(Uri.file(commitMessagePath), await workspace.fs.readFile(uri));
						await workspace.fs.delete(uri);
						return c(true);
					}
				});
			});
		}
	}

	getEnv(): { [key: string]: string; } {
		if (!this.ipc) {
			const fileType = process.platform === 'win32' ? 'bat' : 'sh';
			const gitEditor = path.join(__dirname, `scripts/git-editor-empty.${fileType}`);

			return {
				GIT_EDITOR: `'${gitEditor}'`
			};
		}

		const fileType = process.platform === 'win32' ? 'bat' : 'sh';
		const gitEditor = path.join(__dirname, `scripts/git-editor.${fileType}`);

		return {
			GIT_EDITOR: `'${gitEditor}'`,
			ELECTRON_RUN_AS_NODE: '1',
			VSCODE_GIT_EDITOR_NODE: process.execPath,
			VSCODE_GIT_EDITOR_MAIN: path.join(__dirname, 'git-editor-main.js')
		};
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
