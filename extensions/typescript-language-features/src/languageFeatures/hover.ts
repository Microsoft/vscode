/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { localize } from '../tsServer/versionProvider';
import { ClientCapability, ITypeScriptServiceClient, ServerType } from '../typescriptService';
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
			this.getContents(response.body, response._serverType),
			typeConverters.Range.fromTextSpan(response.body));
	}

	private getContents(
		data: Proto.QuickInfoResponseBody,
		source: ServerType | undefined,
	) {
		const parts: vscode.MarkedString[] = [];

		if (data.displayString) {
			const displayParts: string[] = [];

			if (source === ServerType.Syntax && this.client.capabilities.has(ClientCapability.Semantic)) {
				displayParts.push(
					localize({
						key: 'loadingPrefix',
						comment: ['Prefix displayed for hover entries while the server is still loading']
					}, "(loading...)"));
			}

			displayParts.push(data.displayString);

			parts.push({ language: 'typescript', value: displayParts.join(' ') });
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
