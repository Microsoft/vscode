/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import { conditionalRegistration, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import { markdownDocumentation } from '../utils/previewer';
import * as typeConverters from '../utils/typeConverters';


class TypeScriptHoverProvider implements vscode.HoverProvider {

	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	public async provideHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Hover | undefined> {
		const filepath = this.client.toOpenedFilePath(document);
		if (!filepath) {
			return undefined;
		}

		const args = typeConverters.Position.toFileLocationRequestArgs(filepath, position);
		const response = await this.client.interruptGetErr(() => this.client.execute('quickinfo', args, token));
		if (response.type !== 'response' || !response.body) {
			return undefined;
		}

		return new vscode.Hover(
			TypeScriptHoverProvider.getContents(response.body),
			typeConverters.Range.fromTextSpan(response.body));
	}

	private static getContents(
		data: Proto.QuickInfoResponseBody
	) {
		const parts = [];

		if (data.displayString) {
			parts.push({ language: 'typescript', value: data.displayString });
		}
		parts.push(markdownDocumentation(data.documentation, data.tags));
		return parts;
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient
): vscode.Disposable {
	return conditionalRegistration([
		requireSomeCapability(client, ClientCapability.EnhancedSyntax, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerHoverProvider(selector.syntax,
			new TypeScriptHoverProvider(client));
	});
}
