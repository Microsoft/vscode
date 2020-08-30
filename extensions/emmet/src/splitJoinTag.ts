/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HtmlNode } from 'EmmetNode';
import { getHtmlNode, parseDocument, validate, getEmmetMode, getEmmetConfiguration } from './util';

export function splitJoinTag() {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}

	const editor = vscode.window.activeTextEditor;
	let rootNode = <HtmlNode>parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	return editor.edit(editBuilder => {
		editor.selections.reverse().forEach(selection => {
			let nodeToUpdate = getHtmlNode(editor.document, rootNode, selection.start, true);
			if (nodeToUpdate) {
				let textEdit = getRangesToReplace(editor.document, nodeToUpdate);
				editBuilder.replace(textEdit.range, textEdit.newText);
			}
		});
	});
}

function getRangesToReplace(document: vscode.TextDocument, nodeToUpdate: HtmlNode): vscode.TextEdit {
	let rangeToReplace: vscode.Range;
	let textToReplaceWith: string;

	if (!nodeToUpdate.close) {
		// Split Tag
		let nodeText = document.getText(new vscode.Range(nodeToUpdate.start, nodeToUpdate.end));
		let m = nodeText.match(/(\s*\/)?>$/);
		let end = <vscode.Position>nodeToUpdate.end;
		let start = m ? end.translate(0, -m[0].length) : end;

		rangeToReplace = new vscode.Range(start, end);
		textToReplaceWith = `></${nodeToUpdate.name}>`;
	} else {
		// Join Tag
		let start = (<vscode.Position>nodeToUpdate.open.end).translate(0, -1);
		let end = <vscode.Position>nodeToUpdate.end;
		rangeToReplace = new vscode.Range(start, end);
		textToReplaceWith = '/>';

		const emmetMode = getEmmetMode(document.languageId, []) || '';
		const emmetConfig = getEmmetConfiguration(emmetMode);
		if (emmetMode && emmetConfig.syntaxProfiles[emmetMode] &&
			(emmetConfig.syntaxProfiles[emmetMode]['selfClosingStyle'] === 'xhtml' || emmetConfig.syntaxProfiles[emmetMode]['self_closing_tag'] === 'xhtml')) {
			textToReplaceWith = ' ' + textToReplaceWith;
		}

	}

	return new vscode.TextEdit(rangeToReplace, textToReplaceWith);
}
