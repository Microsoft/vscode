/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { DocumentSelector } from '../utils/documentSelector';

const localize = nls.loadMessageBundle();

interface Directive {
	readonly value: string;
	readonly description: string;
}

const tsDirectives: Directive[] = [
	{
		value: '@ts-check',
		description: localize(
			'ts-check',
			"Enables semantic checking in a JavaScript file. Must be at the top of a file.")
	}, {
		value: '@ts-nocheck',
		description: localize(
			'ts-nocheck',
			"Disables semantic checking in a JavaScript file. Must be at the top of a file.")
	}, {
		value: '@ts-ignore',
		description: localize(
			'ts-ignore',
			"Suppresses @ts-check errors on the next line of a file.")
	}
];

const tsDirectives390: Directive[] = [
	...tsDirectives,
	{
		value: '@ts-expect-error',
		description: localize(
			'ts-expect-error',
			"Suppresses @ts-check errors on the next line of a file, expecting at least one to exist.")
	}
];

class DirectiveCommentCompletionProvider implements vscode.CompletionItemProvider {

	constructor(
		private readonly client: ITypeScriptServiceClient,
	) { }

	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token: vscode.CancellationToken
	): vscode.CompletionItem[] {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return [];
		}

		const line = document.lineAt(position.line).text;
		const prefix = line.slice(0, position.character);
		const match = prefix.match(/^\s*\/\/+\s?(@[a-zA-Z\-]*)?$/);
		if (match) {
			const directives = this.client.apiVersion.gte(API.v390)
				? tsDirectives390
				: tsDirectives;

			return directives.map(directive => {
				const item = new vscode.CompletionItem(directive.value, vscode.CompletionItemKind.Snippet);
				item.detail = directive.description;
				item.range = new vscode.Range(position.line, Math.max(0, position.character - (match[1] ? match[1].length : 0)), position.line, position.character);
				return item;
			});
		}
		return [];
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
) {
	return vscode.languages.registerCompletionItemProvider(selector.syntax,
		new DirectiveCommentCompletionProvider(client),
		'@');
}
