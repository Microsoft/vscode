/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ITypeScriptServiceClient } from '../typescriptService';
import { conditionalRegistration, requireConfiguration } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';


const localize = nls.loadMessageBundle();

const defaultJsDoc = new vscode.SnippetString(`/**\n * $0\n */`);

class JsDocCompletionItem extends vscode.CompletionItem {
	constructor(
		public readonly document: vscode.TextDocument,
		public readonly position: vscode.Position
	) {
		super('/** */', vscode.CompletionItemKind.Snippet);
		this.detail = localize('typescript.jsDocCompletionItem.documentation', 'JSDoc comment');
		this.sortText = '\0';

		const line = document.lineAt(position.line).text;
		const prefix = line.slice(0, position.character).match(/\/\**\s*$/);
		const suffix = line.slice(position.character).match(/^\s*\**\//);
		const start = position.translate(0, prefix ? -prefix[0].length : 0);
		const range = new vscode.Range(start, position.translate(0, suffix ? suffix[0].length : 0));
		this.range = { inserting: range, replacing: range };
	}
}

class JsDocCompletionProvider implements vscode.CompletionItemProvider {

	constructor(
		private readonly client: ITypeScriptServiceClient,
	) { }

	public async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.CompletionItem[] | undefined> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return undefined;
		}

		if (!this.isPotentiallyValidDocCompletionPosition(document, position)) {
			return undefined;
		}

		const args = typeConverters.Position.toFileLocationRequestArgs(file, position);
		const response = await this.client.execute('docCommentTemplate', args, token);
		if (response.type !== 'response' || !response.body) {
			return undefined;
		}

		const item = new JsDocCompletionItem(document, position);

		// Workaround for #43619
		// docCommentTemplate previously returned undefined for empty jsdoc templates.
		// TS 2.7 now returns a single line doc comment, which breaks indentation.
		if (response.body.newText === '/** */') {
			item.insertText = defaultJsDoc;
		} else {
			item.insertText = templateToSnippet(response.body.newText);
		}

		return [item];
	}

	private isPotentiallyValidDocCompletionPosition(
		document: vscode.TextDocument,
		position: vscode.Position
	): boolean {
		// Only show the JSdoc completion when the everything before the cursor is whitespace
		// or could be the opening of a comment
		const line = document.lineAt(position.line).text;
		const prefix = line.slice(0, position.character);
		if (!/^\s*$|\/\*\*\s*$|^\s*\/\*\*+\s*$/.test(prefix)) {
			return false;
		}

		// And everything after is possibly a closing comment or more whitespace
		const suffix = line.slice(position.character);
		return /^\s*(\*+\/)?\s*$/.test(suffix);
	}
}

export function templateToSnippet(template: string): vscode.SnippetString {
	// TODO: use append placeholder
	let snippetIndex = 1;
	template = template.replace(/\$/g, '\\$');
	template = template.replace(/^\s*(?=(\/|[ ]\*))/gm, '');
	template = template.replace(/^(\/\*\*\s*\*[ ]*)$/m, (x) => x + `\$0`);
	template = template.replace(/\* @param([ ]\{\S+\})?\s+(\S+)\s*$/gm, (_param, type, post) => {
		let out = '* @param ';
		if (type === ' {any}' || type === ' {*}') {
			out += `{\$\{${snippetIndex++}:*\}} `;
		} else if (type) {
			out += type + ' ';
		}
		out += post + ` \${${snippetIndex++}}`;
		return out;
	});
	return new vscode.SnippetString(template);
}

export function register(
	selector: DocumentSelector,
	modeId: string,
	client: ITypeScriptServiceClient,
): vscode.Disposable {
	return conditionalRegistration([
		requireConfiguration(modeId, 'suggest.completeJSDocs')
	], () => {
		return vscode.languages.registerCompletionItemProvider(selector.syntax,
			new JsDocCompletionProvider(client),
			'*');
	});
}
