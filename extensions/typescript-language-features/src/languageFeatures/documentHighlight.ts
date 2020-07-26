/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ITypeScriptServiceClient } from '../typescriptService';
import { flatten } from '../utils/arrays';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';

class TypeScriptDocumentHighlightProvider implements vscode.DocumentHighlightProvider {
	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	public async provideDocumentHighlights(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentHighlight[]> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return [];
		}

		const args = {
			...typeConverters.Position.toFileLocationRequestArgs(file, position),
			filesToSearch: [file]
		};
		const response = await this.client.execute('documentHighlights', args, token);
		if (response.type !== 'response' || !response.body) {
			return [];
		}

		return flatten(
			response.body
				.filter(highlight => highlight.file === file)
				.map(convertDocumentHighlight));
	}
}

function convertDocumentHighlight(highlight: Proto.DocumentHighlightsItem): ReadonlyArray<vscode.DocumentHighlight> {
	return highlight.highlightSpans.map(span =>
		new vscode.DocumentHighlight(
			typeConverters.Range.fromTextSpan(span),
			span.kind === 'writtenReference' ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read));
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
) {
	return vscode.languages.registerDocumentHighlightProvider(selector.syntax,
		new TypeScriptDocumentHighlightProvider(client));
}
