/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { conditionalRegistration, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';
import DefinitionProviderBase from './definitionProviderBase';

export default class TypeScriptDefinitionProvider extends DefinitionProviderBase implements vscode.DefinitionProvider {
	constructor(
		client: ITypeScriptServiceClient
	) {
		super(client);
	}

	public async provideDefinition(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.DefinitionLink[] | vscode.Definition | undefined> {
		if (this.client.apiVersion.gte(API.v270)) {
			const filepath = this.client.toOpenedFilePath(document);
			if (!filepath) {
				return undefined;
			}

			const args = typeConverters.Position.toFileLocationRequestArgs(filepath, position);
			const response = await this.client.execute('definitionAndBoundSpan', args, token);
			if (response.type !== 'response' || !response.body) {
				return undefined;
			}

			const span = response.body.textSpan ? typeConverters.Range.fromTextSpan(response.body.textSpan) : undefined;
			return response.body.definitions
				.map((location): vscode.DefinitionLink => {
					const target = typeConverters.Location.fromTextSpan(this.client.toResource(location.file), location);
					if ((location as any).contextStart) {
						return {
							originSelectionRange: span,
							targetRange: typeConverters.Range.fromLocations((location as any).contextStart, (location as any).contextEnd),
							targetUri: target.uri,
							targetSelectionRange: target.range,
						};
					}
					return {
						originSelectionRange: span,
						targetRange: target.range,
						targetUri: target.uri
					};
				});
		}

		return this.getSymbolLocations('definition', document, position, token);
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
) {
	return conditionalRegistration([
		requireSomeCapability(client, ClientCapability.EnhancedSyntax, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerDefinitionProvider(selector.syntax,
			new TypeScriptDefinitionProvider(client));
	});
}
