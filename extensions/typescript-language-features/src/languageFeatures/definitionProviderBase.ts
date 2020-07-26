/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ITypeScriptServiceClient } from '../typescriptService';
import * as typeConverters from '../utils/typeConverters';


export default class TypeScriptDefinitionProviderBase {
	constructor(
		protected readonly client: ITypeScriptServiceClient
	) { }

	protected async getSymbolLocations(
		definitionType: 'definition' | 'implementation' | 'typeDefinition',
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Location[] | undefined> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return undefined;
		}

		const args = typeConverters.Position.toFileLocationRequestArgs(file, position);
		const response = await this.client.execute(definitionType, args, token);
		if (response.type !== 'response' || !response.body) {
			return undefined;
		}

		return response.body.map(location =>
			typeConverters.Location.fromTextSpan(this.client.toResource(location.file), location));
	}
}