/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node, Stylesheet } from 'EmmetFlatNode';
import { isValidLocationForEmmetAbbreviation, getSyntaxFromArgs } from './abbreviationActions';
import { getEmmetHelper, getMappingForIncludedLanguages, parsePartialStylesheet, getEmmetConfiguration, getEmmetMode, isStyleSheet, getFlatNode, allowedMimeTypesInScriptTag, toLSTextDocument, getHtmlFlatNode, getEmbeddedCssNodeIfAny } from './util';
import { Range as LSRange } from 'vscode-languageserver-textdocument';
import { getRootNode } from './parseDocument';

export class DefaultCompletionItemProvider implements vscode.CompletionItemProvider {

	private lastCompletionType: string | undefined;

	public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, _: vscode.CancellationToken, context: vscode.CompletionContext): Thenable<vscode.CompletionList | undefined> | undefined {
		const completionResult = this.provideCompletionItemsInternal(document, position, context);
		if (!completionResult) {
			this.lastCompletionType = undefined;
			return;
		}

		return completionResult.then(completionList => {
			if (!completionList || !completionList.items.length) {
				this.lastCompletionType = undefined;
				return completionList;
			}
			const item = completionList.items[0];
			const expandedText = item.documentation ? item.documentation.toString() : '';

			if (expandedText.startsWith('<')) {
				this.lastCompletionType = 'html';
			} else if (expandedText.indexOf(':') > 0 && expandedText.endsWith(';')) {
				this.lastCompletionType = 'css';
			} else {
				this.lastCompletionType = undefined;
			}
			return completionList;
		});
	}

	private provideCompletionItemsInternal(document: vscode.TextDocument, position: vscode.Position, context: vscode.CompletionContext): Thenable<vscode.CompletionList | undefined> | undefined {
		const emmetConfig = vscode.workspace.getConfiguration('emmet');
		const excludedLanguages = emmetConfig['excludeLanguages'] ? emmetConfig['excludeLanguages'] : [];
		if (excludedLanguages.indexOf(document.languageId) > -1) {
			return;
		}

		const mappedLanguages = getMappingForIncludedLanguages();
		const isSyntaxMapped = mappedLanguages[document.languageId] ? true : false;
		let emmetMode = getEmmetMode((isSyntaxMapped ? mappedLanguages[document.languageId] : document.languageId), excludedLanguages);

		if (!emmetMode
			|| emmetConfig['showExpandedAbbreviation'] === 'never'
			|| ((isSyntaxMapped || emmetMode === 'jsx') && emmetConfig['showExpandedAbbreviation'] !== 'always')) {
			return;
		}

		let syntax = emmetMode;

		const helper = getEmmetHelper();
		let validateLocation = syntax === 'html' || syntax === 'jsx' || syntax === 'xml';
		let rootNode: Node | undefined;
		let currentNode: Node | undefined;

		const lsDoc = toLSTextDocument(document);
		position = document.validatePosition(position);

		if (syntax === 'html') {
			if (context.triggerKind === vscode.CompletionTriggerKind.TriggerForIncompleteCompletions) {
				switch (this.lastCompletionType) {
					case 'html':
						validateLocation = false;
						break;
					case 'css':
						validateLocation = false;
						syntax = 'css';
						break;
					default:
						break;
				}
			}
			if (validateLocation) {
				const positionOffset = document.offsetAt(position);
				const emmetRootNode = getRootNode(document, true);
				const foundNode = getHtmlFlatNode(document.getText(), emmetRootNode, positionOffset, false);
				if (foundNode) {
					if (foundNode.name === 'script') {
						const typeNode = foundNode.attributes.find(attr => attr.name.toString() === 'type');
						if (typeNode) {
							const typeAttrValue = typeNode.value.toString();
							if (typeAttrValue === 'application/javascript' || typeAttrValue === 'text/javascript') {
								if (!getSyntaxFromArgs({ language: 'javascript' })) {
									return;
								} else {
									validateLocation = false;
								}
							}
							else if (allowedMimeTypesInScriptTag.includes(typeAttrValue)) {
								validateLocation = false;
							}
						} else {
							return;
						}
					}
					else if (foundNode.name === 'style') {
						syntax = 'css';
						validateLocation = false;
					} else {
						const styleNode = foundNode.attributes.find(attr => attr.name.toString() === 'style');
						if (styleNode && styleNode.value.start <= positionOffset && positionOffset <= styleNode.value.end) {
							syntax = 'css';
							validateLocation = false;
						}
					}
				}
			}
		}

		const expandOptions = isStyleSheet(syntax) ?
			{ lookAhead: false, syntax: 'stylesheet' } :
			{ lookAhead: true, syntax: 'markup' };
		const extractAbbreviationResults = helper.extractAbbreviation(lsDoc, position, expandOptions);
		if (!extractAbbreviationResults || !helper.isAbbreviationValid(syntax, extractAbbreviationResults.abbreviation)) {
			return;
		}

		const offset = document.offsetAt(position);
		if (isStyleSheet(document.languageId) && context.triggerKind !== vscode.CompletionTriggerKind.TriggerForIncompleteCompletions) {
			validateLocation = true;
			let usePartialParsing = vscode.workspace.getConfiguration('emmet')['optimizeStylesheetParsing'] === true;
			rootNode = usePartialParsing && document.lineCount > 1000 ? parsePartialStylesheet(document, position) : <Stylesheet>getRootNode(document, true);
			if (!rootNode) {
				return;
			}
			currentNode = getFlatNode(rootNode, offset, true);
		}

		// Fix for https://github.com/microsoft/vscode/issues/107578
		// Validate location if syntax is of styleSheet type to ensure that location is valid for emmet abbreviation.
		// For an html document containing a <style> node, compute the embeddedCssNode and fetch the flattened node as currentNode.
		if (!isStyleSheet(document.languageId) && isStyleSheet(syntax) && context.triggerKind !== vscode.CompletionTriggerKind.TriggerForIncompleteCompletions) {
			validateLocation = true;
			rootNode = getRootNode(document, true);
			if (!rootNode) {
				return;
			}
			let flatNode = getFlatNode(rootNode, offset, true);
			let embeddedCssNode = getEmbeddedCssNodeIfAny(document, flatNode, position);
			currentNode = getFlatNode(embeddedCssNode, offset, true);
		}

		if (validateLocation && !isValidLocationForEmmetAbbreviation(document, rootNode, currentNode, syntax, offset, toRange(extractAbbreviationResults.abbreviationRange))) {
			return;
		}

		let noiseCheckPromise: Thenable<any> = Promise.resolve();

		// Fix for https://github.com/microsoft/vscode/issues/32647
		// Check for document symbols in js/ts/jsx/tsx and avoid triggering emmet for abbreviations of the form symbolName.sometext
		// Presence of > or * or + in the abbreviation denotes valid abbreviation that should trigger emmet
		if (!isStyleSheet(syntax) && (document.languageId === 'javascript' || document.languageId === 'javascriptreact' || document.languageId === 'typescript' || document.languageId === 'typescriptreact')) {
			let abbreviation: string = extractAbbreviationResults.abbreviation;
			if (abbreviation.startsWith('this.')) {
				noiseCheckPromise = Promise.resolve(true);
			} else {
				noiseCheckPromise = vscode.commands.executeCommand<vscode.SymbolInformation[]>('vscode.executeDocumentSymbolProvider', document.uri).then((symbols: vscode.SymbolInformation[] | undefined) => {
					return symbols && symbols.find(x => abbreviation === x.name || (abbreviation.startsWith(x.name + '.') && !/>|\*|\+/.test(abbreviation)));
				});
			}
		}

		return noiseCheckPromise.then((noise): vscode.CompletionList | undefined => {
			if (noise) {
				return;
			}

			const config = getEmmetConfiguration(syntax!);
			const result = helper.doComplete(toLSTextDocument(document), position, syntax, config);

			// https://github.com/microsoft/vscode/issues/86941
			if (result && result.items && result.items.length === 1) {
				if (result.items[0].label === 'widows: ;') {
					return undefined;
				}
			}

			let newItems: vscode.CompletionItem[] = [];
			if (result && result.items) {
				result.items.forEach((item: any) => {
					let newItem = new vscode.CompletionItem(item.label);
					newItem.documentation = item.documentation;
					newItem.detail = item.detail;
					newItem.insertText = new vscode.SnippetString(item.textEdit.newText);
					let oldrange = item.textEdit.range;
					newItem.range = new vscode.Range(oldrange.start.line, oldrange.start.character, oldrange.end.line, oldrange.end.character);

					newItem.filterText = item.filterText;
					newItem.sortText = item.sortText;

					if (emmetConfig['showSuggestionsAsSnippets'] === true) {
						newItem.kind = vscode.CompletionItemKind.Snippet;
					}
					newItems.push(newItem);
				});
			}

			return new vscode.CompletionList(newItems, true);
		});
	}
}

function toRange(lsRange: LSRange) {
	return new vscode.Range(lsRange.start.line, lsRange.start.character, lsRange.end.line, lsRange.end.character);
}
