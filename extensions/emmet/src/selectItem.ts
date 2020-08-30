/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { validate, parseDocument, isStyleSheet } from './util';
import { nextItemHTML, prevItemHTML } from './selectItemHTML';
import { nextItemStylesheet, prevItemStylesheet } from './selectItemStylesheet';
import { HtmlNode, CssNode } from 'EmmetNode';

export function fetchSelectItem(direction: string): void {
	if (!validate() || !vscode.window.activeTextEditor) {
		return;
	}
	const editor = vscode.window.activeTextEditor;
	let rootNode = parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	let newSelections: vscode.Selection[] = [];
	editor.selections.forEach(selection => {
		const selectionStart = selection.isReversed ? selection.active : selection.anchor;
		const selectionEnd = selection.isReversed ? selection.anchor : selection.active;

		let updatedSelection;
		if (isStyleSheet(editor.document.languageId)) {
			updatedSelection = direction === 'next' ? nextItemStylesheet(selectionStart, selectionEnd, <CssNode>rootNode!) : prevItemStylesheet(selectionStart, selectionEnd, <CssNode>rootNode!);
		} else {
			updatedSelection = direction === 'next' ? nextItemHTML(selectionStart, selectionEnd, editor, <HtmlNode>rootNode!) : prevItemHTML(selectionStart, selectionEnd, editor, <HtmlNode>rootNode!);
		}
		newSelections.push(updatedSelection ? updatedSelection : selection);
	});
	editor.selections = newSelections;
	editor.revealRange(editor.selections[editor.selections.length - 1]);
}
