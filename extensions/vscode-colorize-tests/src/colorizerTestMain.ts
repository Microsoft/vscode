/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as jsoncParser from 'jsonc-parser';

export function activate(context: vscode.ExtensionContext): any {

	const tokenTypes = ['type', 'struct', 'class', 'interface', 'enum', 'parameterType', 'function', 'variable', 'testToken'];
	const tokenModifiers = ['static', 'abstract', 'deprecated', 'declaration', 'documentation', 'member', 'async', 'testModifier'];

	const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

	const outputChannel = vscode.window.createOutputChannel('Semantic Tokens Test');

	const documentSemanticHighlightProvider: vscode.DocumentSemanticTokensProvider = {
		provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
			const builder = new vscode.SemanticTokensBuilder();

			function addToken(value: string, startLine: number, startCharacter: number, length: number) {
				const [type, ...modifiers] = value.split('.');

				const selectedModifiers = [];

				let tokenType = legend.tokenTypes.indexOf(type);
				if (tokenType === -1) {
					if (type === 'notInLegend') {
						tokenType = tokenTypes.length + 2;
					} else {
						return;
					}
				}

				let tokenModifiers = 0;
				for (const modifier of modifiers) {
					const index = legend.tokenModifiers.indexOf(modifier);
					if (index !== -1) {
						tokenModifiers = tokenModifiers | 1 << index;
						selectedModifiers.push(modifier);
					} else if (modifier === 'notInLegend') {
						tokenModifiers = tokenModifiers | 1 << (legend.tokenModifiers.length + 2);
						selectedModifiers.push(modifier);
					}
				}
				builder.push(startLine, startCharacter, length, tokenType, tokenModifiers);

				outputChannel.appendLine(`line: ${startLine}, character: ${startCharacter}, length ${length}, ${type} (${tokenType}), ${selectedModifiers} ${tokenModifiers.toString(2)}`);
			}

			outputChannel.appendLine('---');

			const visitor: jsoncParser.JSONVisitor = {
				onObjectProperty: (property: string, _offset: number, _length: number, startLine: number, startCharacter: number) => {
					addToken(property, startLine, startCharacter, property.length + 2);
				},
				onLiteralValue: (value: any, _offset: number, length: number, startLine: number, startCharacter: number) => {
					if (typeof value === 'string') {
						addToken(value, startLine, startCharacter, length);
					}
				}
			};
			jsoncParser.visit(document.getText(), visitor);

			return builder.build();
		}
	};


	context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider({ pattern: '**/*semantic-test.json' }, documentSemanticHighlightProvider, legend));

}
