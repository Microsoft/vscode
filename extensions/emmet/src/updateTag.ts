/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HtmlNode } from 'EmmetNode';
import { getHtmlNode, parseDocument, validate } from './util';

export function updateTag(tagName: string): Thenable<boolean> | undefined {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}
	let editor = vscode.window.activeTextEditor;
	let rootNode = <HtmlNode>parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	let rangesToUpdate: vscode.Range[] = [];
	editor.selections.reverse().forEach(selection => {
		rangesToUpdate = rangesToUpdate.concat(getRangesToUpdate(editor, selection, rootNode));
	});

	return editor.edit(editBuilder => {
		rangesToUpdate.forEach(range => {
			editBuilder.replace(range, tagName);
		});
	});
}

function getRangesToUpdate(editor: vscode.TextEditor, selection: vscode.Selection, rootNode: HtmlNode): vscode.Range[] {
	let nodeToUpdate = getHtmlNode(editor.document, rootNode, selection.start, true);
	if (!nodeToUpdate) {
		return [];
	}

	let openStart = nodeToUpdate.open.start.translate(0, 1);
	let openEnd = openStart.translate(0, nodeToUpdate.name.length);

	let ranges = [new vscode.Range(openStart, openEnd)];
	if (nodeToUpdate.close) {
		let closeStart = nodeToUpdate.close.start.translate(0, 2);
		let closeEnd = nodeToUpdate.close.end.translate(0, -1);
		ranges.push(new vscode.Range(closeStart, closeEnd));
	}
	return ranges;
}


