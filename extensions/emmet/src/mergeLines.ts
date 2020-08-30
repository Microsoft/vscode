/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Node } from 'EmmetNode';
import { getNode, parseDocument, validate } from './util';

export function mergeLines() {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}

	const editor = vscode.window.activeTextEditor;

	let rootNode = parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	return editor.edit(editBuilder => {
		editor.selections.reverse().forEach(selection => {
			let textEdit = getRangesToReplace(editor.document, selection, rootNode!);
			if (textEdit) {
				editBuilder.replace(textEdit.range, textEdit.newText);
			}
		});
	});
}

function getRangesToReplace(document: vscode.TextDocument, selection: vscode.Selection, rootNode: Node): vscode.TextEdit | undefined {
	let startNodeToUpdate: Node | null;
	let endNodeToUpdate: Node | null;

	if (selection.isEmpty) {
		startNodeToUpdate = endNodeToUpdate = getNode(rootNode, selection.start, true);
	} else {
		startNodeToUpdate = getNode(rootNode, selection.start, true);
		endNodeToUpdate = getNode(rootNode, selection.end, true);
	}

	if (!startNodeToUpdate || !endNodeToUpdate || startNodeToUpdate.start.line === endNodeToUpdate.end.line) {
		return;
	}

	let rangeToReplace = new vscode.Range(startNodeToUpdate.start, endNodeToUpdate.end);
	let textToReplaceWith = document.lineAt(startNodeToUpdate.start.line).text.substr(startNodeToUpdate.start.character);
	for (let i = startNodeToUpdate.start.line + 1; i <= endNodeToUpdate.end.line; i++) {
		textToReplaceWith += document.lineAt(i).text.trim();
	}

	return new vscode.TextEdit(rangeToReplace, textToReplaceWith);
}
