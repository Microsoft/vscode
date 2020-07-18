/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ExtensionContext, TextDocument, commands, ProviderResult, CancellationToken,
	workspace, tasks, Range, HoverProvider, Hover, Position, MarkdownString, Uri
} from 'vscode';
import {
	createTask, startDebugging, findAllScriptRanges, extractDebugArgFromScript
} from './tasks';
import * as nls from 'vscode-nls';

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

	constructor(context: ExtensionContext) {
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

				let debugArgs = extractDebugArgFromScript(value[2]);
				if (debugArgs) {
					contents.appendMarkdown(this.createDebugScriptMarkdown(key, document.uri, debugArgs[0], debugArgs[1]));
				}
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

	private createDebugScriptMarkdown(script: string, documentUri: Uri, protocol: string, port: number): string {
		let args = {
			documentUri: documentUri,
			script: script,
			protocol: protocol,
			port: port
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

	public runScriptFromHover(args: any) {
		let script = args.script;
		let documentUri = args.documentUri;
		let folder = workspace.getWorkspaceFolder(documentUri);
		if (folder) {
			let task = createTask(script, `run ${script}`, folder, documentUri);
			tasks.executeTask(task);
		}
	}

	public debugScriptFromHover(args: any) {
		let script = args.script;
		let documentUri = args.documentUri;
		let protocol = args.protocol;
		let port = args.port;
		let folder = workspace.getWorkspaceFolder(documentUri);
		if (folder) {
			startDebugging(script, protocol, port, folder);
		}
	}
}
