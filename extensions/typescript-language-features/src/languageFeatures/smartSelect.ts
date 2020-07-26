/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { conditionalRegistration, requireMinVersion } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as typeConverters from '../utils/typeConverters';

class SmartSelection implements vscode.SelectionRangeProvider {
	public static readonly minVersion = API.v350;

	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	public async provideSelectionRanges(
		document: vscode.TextDocument,
		positions: vscode.Position[],
		token: vscode.CancellationToken,
	): Promise<vscode.SelectionRange[] | undefined> {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return undefined;
		}

		const args: Proto.SelectionRangeRequestArgs = {
			file,
			locations: positions.map(typeConverters.Position.toLocation)
		};
		const response = await this.client.execute('selectionRange', args, token);
		if (response.type !== 'response' || !response.body) {
			return undefined;
		}
		return response.body.map(SmartSelection.convertSelectionRange);
	}

	private static convertSelectionRange(
		selectionRange: Proto.SelectionRange
	): vscode.SelectionRange {
		return new vscode.SelectionRange(
			typeConverters.Range.fromTextSpan(selectionRange.textSpan),
			selectionRange.parent ? SmartSelection.convertSelectionRange(selectionRange.parent) : undefined,
		);
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
) {
	return conditionalRegistration([
		requireMinVersion(client, SmartSelection.minVersion),
	], () => {
		return vscode.languages.registerSelectionRangeProvider(selector.syntax, new SmartSelection(client));
	});
}
