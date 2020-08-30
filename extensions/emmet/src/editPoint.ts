/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { validate } from './util';

export function fetchEditPoint(direction: string): void {
	if (!validate() || !vscode.window.activeTextEditor) {
		return;
	}
	const editor = vscode.window.activeTextEditor;

	let newSelections: vscode.Selection[] = [];
	editor.selections.forEach(selection => {
		let updatedSelection = direction === 'next' ? nextEditPoint(selection, editor) : prevEditPoint(selection, editor);
		newSelections.push(updatedSelection);
	});
	editor.selections = newSelections;
	editor.revealRange(editor.selections[editor.selections.length - 1]);
}

function nextEditPoint(selection: vscode.Selection, editor: vscode.TextEditor): vscode.Selection {
	for (let lineNum = selection.anchor.line; lineNum < editor.document.lineCount; lineNum++) {
		let updatedSelection = findEditPoint(lineNum, editor, selection.anchor, 'next');
		if (updatedSelection) {
			return updatedSelection;
		}
	}
	return selection;
}

function prevEditPoint(selection: vscode.Selection, editor: vscode.TextEditor): vscode.Selection {
	for (let lineNum = selection.anchor.line; lineNum >= 0; lineNum--) {
		let updatedSelection = findEditPoint(lineNum, editor, selection.anchor, 'prev');
		if (updatedSelection) {
			return updatedSelection;
		}
	}
	return selection;
}


function findEditPoint(lineNum: number, editor: vscode.TextEditor, position: vscode.Position, direction: string): vscode.Selection | undefined {
	let line = editor.document.lineAt(lineNum);
	let lineContent = line.text;

	if (lineNum !== position.line && line.isEmptyOrWhitespace) {
		return new vscode.Selection(lineNum, lineContent.length, lineNum, lineContent.length);
	}

	if (lineNum === position.line && direction === 'prev') {
		lineContent = lineContent.substr(0, position.character);
	}
	let emptyAttrIndex = direction === 'next' ? lineContent.indexOf('""', lineNum === position.line ? position.character : 0) : lineContent.lastIndexOf('""');
	let emptyTagIndex = direction === 'next' ? lineContent.indexOf('><', lineNum === position.line ? position.character : 0) : lineContent.lastIndexOf('><');

	let winner = -1;

	if (emptyAttrIndex > -1 && emptyTagIndex > -1) {
		winner = direction === 'next' ? Math.min(emptyAttrIndex, emptyTagIndex) : Math.max(emptyAttrIndex, emptyTagIndex);
	} else if (emptyAttrIndex > -1) {
		winner = emptyAttrIndex;
	} else {
		winner = emptyTagIndex;
	}

	if (winner > -1) {
		return new vscode.Selection(lineNum, winner + 1, lineNum, winner + 1);
	}
	return;
}
