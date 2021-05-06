/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import * as vscode from 'vscode';

function rndName() {
	return Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
}

export function createRandomFile(contents = '', fileExtension = 'txt'): Thenable<vscode.Uri> {
	return new Promise((resolve, reject) => {
		const tmpFile = join(os.tmpdir(), rndName() + '.' + fileExtension);
		fs.writeFile(tmpFile, contents, (error) => {
			if (error) {
				return reject(error);
			}

			resolve(vscode.Uri.file(tmpFile));
		});
	});
}


export function deleteFile(file: vscode.Uri): Thenable<boolean> {
	return new Promise((resolve, reject) => {
		fs.unlink(file.fsPath, (err) => {
			if (err) {
				reject(err);
			} else {
				resolve(true);
			}
		});
	});
}

export const CURSOR = '$$CURSOR$$';

export function withRandomFileEditor(
	contents: string,
	fileExtension: string,
	run: (editor: vscode.TextEditor, doc: vscode.TextDocument) => Thenable<void>
): Thenable<boolean> {
	const cursorIndex = contents.indexOf(CURSOR);
	return createRandomFile(contents.replace(CURSOR, ''), fileExtension).then(file => {
		return vscode.workspace.openTextDocument(file).then(doc => {
			return vscode.window.showTextDocument(doc).then((editor) => {
				if (cursorIndex >= 0) {
					const pos = doc.positionAt(cursorIndex);
					editor.selection = new vscode.Selection(pos, pos);
				}
				return run(editor, doc).then(_ => {
					if (doc.isDirty) {
						return doc.save().then(() => {
							return deleteFile(file);
						});
					} else {
						return deleteFile(file);
					}
				});
			});
		});
	});
}

export const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms));

export const joinLines = (...args: string[]) => args.join(os.platform() === 'win32' ? '\r\n' : '\n');

export async function createTestEditor(uri: vscode.Uri, ...lines: string[]) {
	const document = await vscode.workspace.openTextDocument(uri);
	const editor = await vscode.window.showTextDocument(document);
	await editor.insertSnippet(new vscode.SnippetString(joinLines(...lines)), new vscode.Range(0, 0, 1000, 0));
	return editor;
}

export function assertEditorContents(editor: vscode.TextEditor, expectedDocContent: string, message?: string): void {
	const cursorIndex = expectedDocContent.indexOf(CURSOR);

	assert.strictEqual(
		editor.document.getText(),
		expectedDocContent.replace(CURSOR, ''),
		message);

	if (cursorIndex >= 0) {
		const expectedCursorPos = editor.document.positionAt(cursorIndex);
		assert.deepStrictEqual(
			{ line: editor.selection.active.line, character: editor.selection.active.line },
			{ line: expectedCursorPos.line, character: expectedCursorPos.line },
			'Cursor position'
		);
	}
}

export type VsCodeConfiguration = { [key: string]: any };

export async function updateConfig(documentUri: vscode.Uri, newConfig: VsCodeConfiguration): Promise<VsCodeConfiguration> {
	const oldConfig: VsCodeConfiguration = {};
	const config = vscode.workspace.getConfiguration(undefined, documentUri);

	for (const configKey of Object.keys(newConfig)) {
		oldConfig[configKey] = config.get(configKey);
		await new Promise<void>((resolve, reject) =>
			config.update(configKey, newConfig[configKey], vscode.ConfigurationTarget.Global)
				.then(() => resolve(), reject));
	}
	return oldConfig;
}

export const Config = Object.freeze({
	autoClosingBrackets: 'editor.autoClosingBrackets',
	typescriptCompleteFunctionCalls: 'typescript.suggest.completeFunctionCalls',
	insertMode: 'editor.suggest.insertMode',
	snippetSuggestions: 'editor.snippetSuggestions',
	suggestSelection: 'editor.suggestSelection',
	javascriptQuoteStyle: 'javascript.preferences.quoteStyle',
	typescriptQuoteStyle: 'typescript.preferences.quoteStyle',
} as const);

export const insertModesValues = Object.freeze(['insert', 'replace']);

export async function enumerateConfig(
	documentUri: vscode.Uri,
	configKey: string,
	values: readonly string[],
	f: (message: string) => Promise<void>
): Promise<void> {
	for (const value of values) {
		const newConfig = { [configKey]: value };
		await updateConfig(documentUri, newConfig);
		await f(JSON.stringify(newConfig));
	}
}


export function onChangedDocument(documentUri: vscode.Uri, disposables: vscode.Disposable[]) {
	return new Promise<vscode.TextDocument>(resolve => vscode.workspace.onDidChangeTextDocument(e => {
		if (e.document.uri.toString() === documentUri.toString()) {
			resolve(e.document);
		}
	}, undefined, disposables));
}

export async function retryUntilDocumentChanges(
	documentUri: vscode.Uri,
	options: { retries: number, timeout: number },
	disposables: vscode.Disposable[],
	exec: () => Thenable<unknown>,
) {
	const didChangeDocument = onChangedDocument(documentUri, disposables);

	let done = false;

	const result = await Promise.race([
		didChangeDocument,
		(async () => {
			for (let i = 0; i < options.retries; ++i) {
				await wait(options.timeout);
				if (done) {
					return;
				}
				await exec();
			}
		})(),
	]);
	done = true;
	return result;
}
