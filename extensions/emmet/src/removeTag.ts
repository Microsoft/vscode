/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { parseDocument, validate, getHtmlNode } from './util';
import { HtmlNode } from 'EmmetNode';

export function removeTag() {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}
	const editor = vscode.window.activeTextEditor;

	let rootNode = <HtmlNode>parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	let indentInSpaces = '';
	const tabSize: number = editor.options.tabSize ? +editor.options.tabSize : 0;
	for (let i = 0; i < tabSize || 0; i++) {
		indentInSpaces += ' ';
	}

	let rangesToRemove: vscode.Range[] = [];
	editor.selections.reverse().forEach(selection => {
		rangesToRemove = rangesToRemove.concat(getRangeToRemove(editor, rootNode, selection, indentInSpaces));
	});

	return editor.edit(editBuilder => {
		rangesToRemove.forEach(range => {
			editBuilder.replace(range, '');
		});
	});
}

function getRangeToRemove(editor: vscode.TextEditor, rootNode: HtmlNode, selection: vscode.Selection, indentInSpaces: string): vscode.Range[] {

	let nodeToUpdate = getHtmlNode(editor.document, rootNode, selection.start, true);
	if (!nodeToUpdate) {
		return [];
	}

	let openRange = new vscode.Range(nodeToUpdate.open.start, nodeToUpdate.open.end);
	let closeRange: vscode.Range | null = null;
	if (nodeToUpdate.close) {
		closeRange = new vscode.Range(nodeToUpdate.close.start, nodeToUpdate.close.end);
	}

	let ranges = [openRange];
	if (closeRange) {
		for (let i = openRange.start.line + 1; i <= closeRange.start.line; i++) {
			let lineContent = editor.document.lineAt(i).text;
			if (lineContent.startsWith('\t')) {
				ranges.push(new vscode.Range(i, 0, i, 1));
			} else if (lineContent.startsWith(indentInSpaces)) {
				ranges.push(new vscode.Range(i, 0, i, indentInSpaces.length));
			}
		}
		ranges.push(closeRange);
	}
	return ranges;
}

