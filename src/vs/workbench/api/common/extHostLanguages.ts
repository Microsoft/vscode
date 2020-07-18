/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainContext, MainThreadLanguagesShape, IMainContext } from './extHost.protocol';
import type * as vscode from 'vscode';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import * as typeConvert from 'vs/workbench/api/common/extHostTypeConverters';
import { StandardTokenType, Range, Position } from 'vs/workbench/api/common/extHostTypes';

export class ExtHostLanguages {

	private readonly _proxy: MainThreadLanguagesShape;
	private readonly _documents: ExtHostDocuments;

	constructor(
		mainContext: IMainContext,
		documents: ExtHostDocuments
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadLanguages);
		this._documents = documents;
	}

	getLanguages(): Promise<string[]> {
		return this._proxy.$getLanguages();
	}

	async changeLanguage(uri: vscode.Uri, languageId: string): Promise<vscode.TextDocument> {
		await this._proxy.$changeLanguage(uri, languageId);
		const data = this._documents.getDocumentData(uri);
		if (!data) {
			throw new Error(`document '${uri.toString}' NOT found`);
		}
		return data.document;
	}

	async tokenAtPosition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.TokenInformation> {
		const versionNow = document.version;
		const pos = typeConvert.Position.from(position);
		const info = await this._proxy.$tokensAtPosition(document.uri, pos);
		const defaultRange = {
			type: StandardTokenType.Other,
			range: document.getWordRangeAtPosition(position) ?? new Range(position.line, position.character, position.line, position.character)
		};
		if (!info) {
			// no result
			return defaultRange;
		}
		const result = {
			range: typeConvert.Range.to(info.range),
			type: typeConvert.TokenType.to(info.type)
		};
		if (!result.range.contains(<Position>position)) {
			// bogous result
			return defaultRange;
		}
		if (versionNow !== document.version) {
			// concurrent change
			return defaultRange;
		}
		return result;
	}
}
