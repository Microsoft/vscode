/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { coalesce } from '../utils/arrays';
import { conditionalRegistration, requireMinVersion } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';

class TypeScriptFoldingProvider implements vscode.FoldingRangeProvider {
	public static readonly minVersion = API.v280;

	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	async provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		token: vscode.CancellationToken
	): Promise<vscode.FoldingRange[] | undefined> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return;
		}

		const args: Proto.FileRequestArgs = { file };
		const response = await this.client.execute('getOutliningSpans', args, token);
		if (response.type !== 'response' || !response.body) {
			return;
		}

		return coalesce(response.body.map(span => this.convertOutliningSpan(span, document)));
	}

	private convertOutliningSpan(
		span: Proto.OutliningSpan,
		document: vscode.TextDocument
	): vscode.FoldingRange | undefined {
		const range = typeConverters.Range.fromTextSpan(span.textSpan);
		const kind = TypeScriptFoldingProvider.getFoldingRangeKind(span);

		// Workaround for #49904
		if (span.kind === 'comment') {
			const line = document.lineAt(range.start.line).text;
			if (line.match(/\/\/\s*#endregion/gi)) {
				return undefined;
			}
		}

		const start = range.start.line;
		const end = this.adjustFoldingEnd(range, document);
		return new vscode.FoldingRange(start, end, kind);
	}

	private static readonly foldEndPairCharacters = ['}', ']', ')', '`'];

	private adjustFoldingEnd(range: vscode.Range, document: vscode.TextDocument) {
		// workaround for #47240
		if (range.end.character > 0) {
			const foldEndCharacter = document.getText(new vscode.Range(range.end.translate(0, -1), range.end));
			if (TypeScriptFoldingProvider.foldEndPairCharacters.includes(foldEndCharacter)) {
				return Math.max(range.end.line - 1, range.start.line);
			}
		}

		return range.end.line;
	}

	private static getFoldingRangeKind(span: Proto.OutliningSpan): vscode.FoldingRangeKind | undefined {
		switch (span.kind) {
			case 'comment': return vscode.FoldingRangeKind.Comment;
			case 'region': return vscode.FoldingRangeKind.Region;
			case 'imports': return vscode.FoldingRangeKind.Imports;
			case 'code':
			default: return undefined;
		}
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
): vscode.Disposable {
	return conditionalRegistration([
		requireMinVersion(client, TypeScriptFoldingProvider.minVersion),
	], () => {
		return vscode.languages.registerFoldingRangeProvider(selector.syntax,
			new TypeScriptFoldingProvider(client));
	});
}
