/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getLocation, Location } from 'jsonc-parser';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

export class PackageDocument {

	constructor(private document: vscode.TextDocument) { }

	public provideCompletionItems(position: vscode.Position, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem[]> {
		const location = getLocation(this.document.getText(), this.document.offsetAt(position));

		if (location.path.length >= 2 && location.path[1] === 'configurationDefaults') {
			return this.provideLanguageOverridesCompletionItems(location, position);
		}

		return undefined;
	}

	private provideLanguageOverridesCompletionItems(location: Location, position: vscode.Position): vscode.ProviderResult<vscode.CompletionItem[]> {
		let range = this.document.getWordRangeAtPosition(position) || new vscode.Range(position, position);
		const text = this.document.getText(range);

		if (location.path.length === 2) {

			let snippet = '"[${1:language}]": {\n\t"$0"\n}';

			// Suggestion model word matching includes quotes,
			// hence exclude the starting quote from the snippet and the range
			// ending quote gets replaced
			if (text && text.startsWith('"')) {
				range = new vscode.Range(new vscode.Position(range.start.line, range.start.character + 1), range.end);
				snippet = snippet.substring(1);
			}

			return Promise.resolve([this.newSnippetCompletionItem({
				label: localize('languageSpecificEditorSettings', "Language specific editor settings"),
				documentation: localize('languageSpecificEditorSettingsDescription', "Override editor settings for language"),
				snippet,
				range
			})]);
		}

		if (location.path.length === 3 && location.previousNode && typeof location.previousNode.value === 'string' && location.previousNode.value.startsWith('[')) {

			// Suggestion model word matching includes starting quote and open sqaure bracket
			// Hence exclude them from the proposal range
			range = new vscode.Range(new vscode.Position(range.start.line, range.start.character + 2), range.end);

			return vscode.languages.getLanguages().then(languages => {
				return languages.map(l => {

					// Suggestion model word matching includes closed sqaure bracket and ending quote
					// Hence include them in the proposal to replace
					return this.newSimpleCompletionItem(l, range, '', l + ']"');
				});
			});
		}
		return Promise.resolve([]);
	}

	private newSimpleCompletionItem(text: string, range: vscode.Range, description?: string, insertText?: string): vscode.CompletionItem {
		const item = new vscode.CompletionItem(text);
		item.kind = vscode.CompletionItemKind.Value;
		item.detail = description;
		item.insertText = insertText ? insertText : text;
		item.range = range;
		return item;
	}

	private newSnippetCompletionItem(o: { label: string; documentation?: string; snippet: string; range: vscode.Range; }): vscode.CompletionItem {
		const item = new vscode.CompletionItem(o.label);
		item.kind = vscode.CompletionItemKind.Value;
		item.documentation = o.documentation;
		item.insertText = new vscode.SnippetString(o.snippet);
		item.range = o.range;
		return item;
	}
}
