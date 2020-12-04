/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ExtensionContext, TextDocument, commands, ProviderResult, CancellationToken,
	workspace, tasks, Range, HoverProvider, Hover, Position, MarkdownString, Uri
} from 'vscode';
import {
	createTask, startDebugging, findAllScriptRanges
} from './tasks';
import * as nls from 'vscode-nls';
import { dirname } from 'path';

const localize = nls.loadMessageBundle();

let cachedDocument: Uri | undefined = undefined;
let cachedScriptsMap: Map<string, [number, number, string]> | undefined = undefined;

export function invalidateHoverScriptsCache(document?: TextDocument) {
	if (!document) {
		cachedDocument = undefined;
		return;
	}
	if (document.uri === cachedDocument) {
		cachedDocument = undefined;
	}
}

export class NpmScriptHoverProvider implements HoverProvider {

	constructor(private context: ExtensionContext) {
		context.subscriptions.push(commands.registerCommand('npm.runScriptFromHover', this.runScriptFromHover, this));
		context.subscriptions.push(commands.registerCommand('npm.debugScriptFromHover', this.debugScriptFromHover, this));
		context.subscriptions.push(workspace.onDidChangeTextDocument((e) => {
			invalidateHoverScriptsCache(e.document);
		}));
	}

	public provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
		let hover: Hover | undefined = undefined;

		if (!cachedDocument || cachedDocument.fsPath !== document.uri.fsPath) {
			cachedScriptsMap = findAllScriptRanges(document.getText());
			cachedDocument = document.uri;
		}

		cachedScriptsMap!.forEach((value, key) => {
			let start = document.positionAt(value[0]);
			let end = document.positionAt(value[0] + value[1]);
			let range = new Range(start, end);

			if (range.contains(position)) {
				let contents: MarkdownString = new MarkdownString();
				contents.isTrusted = true;
				contents.appendMarkdown(this.createRunScriptMarkdown(key, document.uri));
				contents.appendMarkdown(this.createDebugScriptMarkdown(key, document.uri));
				hover = new Hover(contents);
			}
		});
		return hover;
	}

	private createRunScriptMarkdown(script: string, documentUri: Uri): string {
		let args = {
			documentUri: documentUri,
			script: script,
		};
		return this.createMarkdownLink(
			localize('runScript', 'Run Script'),
			'npm.runScriptFromHover',
			args,
			localize('runScript.tooltip', 'Run the script as a task')
		);
	}

	private createDebugScriptMarkdown(script: string, documentUri: Uri): string {
		const args = {
			documentUri: documentUri,
			script: script,
		};
		return this.createMarkdownLink(
			localize('debugScript', 'Debug Script'),
			'npm.debugScriptFromHover',
			args,
			localize('debugScript.tooltip', 'Runs the script under the debugger'),
			'|'
		);
	}

	private createMarkdownLink(label: string, cmd: string, args: any, tooltip: string, separator?: string): string {
		let encodedArgs = encodeURIComponent(JSON.stringify(args));
		let prefix = '';
		if (separator) {
			prefix = ` ${separator} `;
		}
		return `${prefix}[${label}](command:${cmd}?${encodedArgs} "${tooltip}")`;
	}

	public async runScriptFromHover(args: any) {
		let script = args.script;
		let documentUri = args.documentUri;
		let folder = workspace.getWorkspaceFolder(documentUri);
		if (folder) {
			let task = await createTask(this.context, script, `run ${script}`, folder, documentUri);
			await tasks.executeTask(task);
		}
	}

	public debugScriptFromHover(args: { script: string; documentUri: Uri }) {
		let script = args.script;
		let documentUri = args.documentUri;
		let folder = workspace.getWorkspaceFolder(documentUri);
		if (folder) {
			startDebugging(this.context, script, dirname(documentUri.fsPath), folder);
		}
	}
}
