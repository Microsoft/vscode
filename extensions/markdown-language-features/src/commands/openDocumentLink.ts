/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { extname } from 'path';

import { Command } from '../commandManager';
import { MarkdownEngine } from '../markdownEngine';
import { TableOfContentsProvider } from '../tableOfContentsProvider';
import { isMarkdownFile } from '../util/file';


export interface OpenDocumentLinkArgs {
	readonly path: {};
	readonly fragment: string;
	readonly fromResource: {};
}

enum OpenMarkdownLinks {
	beside = 'beside',
	currentGroup = 'currentGroup',
}

export class OpenDocumentLinkCommand implements Command {
	private static readonly id = '_markdown.openDocumentLink';
	public readonly id = OpenDocumentLinkCommand.id;

	public static createCommandUri(
		fromResource: vscode.Uri,
		path: vscode.Uri,
		fragment: string,
	): vscode.Uri {
		const toJson = (uri: vscode.Uri) => {
			return {
				scheme: uri.scheme,
				authority: uri.authority,
				path: uri.path,
				fragment: uri.fragment,
				query: uri.query,
			};
		};
		return vscode.Uri.parse(`command:${OpenDocumentLinkCommand.id}?${encodeURIComponent(JSON.stringify(<OpenDocumentLinkArgs>{
			path: toJson(path),
			fragment,
			fromResource: toJson(fromResource),
		}))}`);
	}

	public constructor(
		private readonly engine: MarkdownEngine
	) { }

	public async execute(args: OpenDocumentLinkArgs) {
		return OpenDocumentLinkCommand.execute(this.engine, args);
	}

	public static async execute(engine: MarkdownEngine, args: OpenDocumentLinkArgs) {
		const fromResource = vscode.Uri.parse('').with(args.fromResource);
		const targetResource = vscode.Uri.parse('').with(args.path);
		const column = this.getViewColumn(fromResource);
		try {
			return await this.tryOpen(engine, targetResource, args, column);
		} catch {
			if (extname(targetResource.path) === '') {
				return this.tryOpen(engine, targetResource.with({ path: targetResource.path + '.md' }), args, column);
			}
			await vscode.commands.executeCommand('vscode.open', targetResource, column);
			return undefined;
		}
	}

	private static async tryOpen(engine: MarkdownEngine, resource: vscode.Uri, args: OpenDocumentLinkArgs, column: vscode.ViewColumn) {
		if (vscode.window.activeTextEditor && isMarkdownFile(vscode.window.activeTextEditor.document)) {
			if (vscode.window.activeTextEditor.document.uri.fsPath === resource.fsPath) {
				return this.tryRevealLine(engine, vscode.window.activeTextEditor, args.fragment);
			}
		}

		const stat = await vscode.workspace.fs.stat(resource);
		if (stat.type === vscode.FileType.Directory) {
			return vscode.commands.executeCommand('revealInExplorer', resource);
		}

		return vscode.workspace.openTextDocument(resource)
			.then(document => vscode.window.showTextDocument(document, column))
			.then(editor => this.tryRevealLine(engine, editor, args.fragment));
	}

	private static getViewColumn(resource: vscode.Uri): vscode.ViewColumn {
		const config = vscode.workspace.getConfiguration('markdown', resource);
		const openLinks = config.get<OpenMarkdownLinks>('links.openLocation', OpenMarkdownLinks.currentGroup);
		switch (openLinks) {
			case OpenMarkdownLinks.beside:
				return vscode.ViewColumn.Beside;
			case OpenMarkdownLinks.currentGroup:
			default:
				return vscode.ViewColumn.Active;
		}
	}

	private static async tryRevealLine(engine: MarkdownEngine, editor: vscode.TextEditor, fragment?: string) {
		if (editor && fragment) {
			const toc = new TableOfContentsProvider(engine, editor.document);
			const entry = await toc.lookup(fragment);
			if (entry) {
				const lineStart = new vscode.Range(entry.line, 0, entry.line, 0);
				editor.selection = new vscode.Selection(lineStart.start, lineStart.end);
				return editor.revealRange(lineStart, vscode.TextEditorRevealType.AtTop);
			}
			const lineNumberFragment = fragment.match(/^L(\d+)$/i);
			if (lineNumberFragment) {
				const line = +lineNumberFragment[1] - 1;
				if (!isNaN(line)) {
					const lineStart = new vscode.Range(line, 0, line, 0);
					editor.selection = new vscode.Selection(lineStart.start, lineStart.end);
					return editor.revealRange(lineStart, vscode.TextEditorRevealType.AtTop);
				}
			}
		}
	}
}


export async function resolveLinkToMarkdownFile(path: string): Promise<vscode.Uri | undefined> {
	try {
		const standardLink = await tryResolveLinkToMarkdownFile(path);
		if (standardLink) {
			return standardLink;
		}
	} catch {
		// Noop
	}

	// If no extension, try with `.md` extension
	if (extname(path) === '') {
		return tryResolveLinkToMarkdownFile(path + '.md');
	}

	return undefined;
}

async function tryResolveLinkToMarkdownFile(path: string): Promise<vscode.Uri | undefined> {
	const resource = vscode.Uri.file(path);

	let document: vscode.TextDocument;
	try {
		document = await vscode.workspace.openTextDocument(resource);
	} catch {
		return undefined;
	}
	if (isMarkdownFile(document)) {
		return document.uri;
	}
	return undefined;
}
