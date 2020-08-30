/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { HtmlNode } from 'EmmetNode';
import { getHtmlNode, parseDocument, validate } from './util';

let balanceOutStack: Array<vscode.Selection[]> = [];
let lastOut = false;
let lastBalancedSelections: vscode.Selection[] = [];

export function balanceOut() {
	balance(true);
}

export function balanceIn() {
	balance(false);
}

function balance(out: boolean) {
	if (!validate(false) || !vscode.window.activeTextEditor) {
		return;
	}
	const editor = vscode.window.activeTextEditor;
	let rootNode = <HtmlNode>parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	let getRangeFunction = out ? getRangeToBalanceOut : getRangeToBalanceIn;
	let newSelections: vscode.Selection[] = [];
	editor.selections.forEach(selection => {
		let range = getRangeFunction(editor.document, selection, rootNode);
		newSelections.push(range);
	});

	if (areSameSelections(newSelections, editor.selections)) {
		return;
	}

	if (areSameSelections(lastBalancedSelections, editor.selections)) {
		if (out) {
			if (!balanceOutStack.length) {
				balanceOutStack.push(editor.selections);
			}
			balanceOutStack.push(newSelections);
		} else {
			if (lastOut) {
				balanceOutStack.pop();
			}
			newSelections = balanceOutStack.pop() || newSelections;
		}
	} else {
		balanceOutStack = out ? [editor.selections, newSelections] : [];
	}

	lastOut = out;
	lastBalancedSelections = editor.selections = newSelections;
}

function getRangeToBalanceOut(document: vscode.TextDocument, selection: vscode.Selection, rootNode: HtmlNode): vscode.Selection {
	let nodeToBalance = getHtmlNode(document, rootNode, selection.start, false);
	if (!nodeToBalance) {
		return selection;
	}
	if (!nodeToBalance.close) {
		return new vscode.Selection(nodeToBalance.start, nodeToBalance.end);
	}

	let innerSelection = new vscode.Selection(nodeToBalance.open.end, nodeToBalance.close.start);
	let outerSelection = new vscode.Selection(nodeToBalance.start, nodeToBalance.end);

	if (innerSelection.contains(selection) && !innerSelection.isEqual(selection)) {
		return innerSelection;
	}
	if (outerSelection.contains(selection) && !outerSelection.isEqual(selection)) {
		return outerSelection;
	}
	return selection;
}

function getRangeToBalanceIn(document: vscode.TextDocument, selection: vscode.Selection, rootNode: HtmlNode): vscode.Selection {
	let nodeToBalance = getHtmlNode(document, rootNode, selection.start, true);
	if (!nodeToBalance) {
		return selection;
	}

	if (nodeToBalance.close) {
		const entireNodeSelected = selection.start.isEqual(nodeToBalance.start) && selection.end.isEqual(nodeToBalance.end);
		const startInOpenTag = selection.start.isAfter(nodeToBalance.open.start) && selection.start.isBefore(nodeToBalance.open.end);
		const startInCloseTag = selection.start.isAfter(nodeToBalance.close.start) && selection.start.isBefore(nodeToBalance.close.end);

		if (entireNodeSelected || startInOpenTag || startInCloseTag) {
			return new vscode.Selection(nodeToBalance.open.end, nodeToBalance.close.start);
		}
	}

	if (!nodeToBalance.firstChild) {
		return selection;
	}

	if (selection.start.isEqual(nodeToBalance.firstChild.start)
		&& selection.end.isEqual(nodeToBalance.firstChild.end)
		&& nodeToBalance.firstChild.close) {
		return new vscode.Selection(nodeToBalance.firstChild.open.end, nodeToBalance.firstChild.close.start);
	}

	return new vscode.Selection(nodeToBalance.firstChild.start, nodeToBalance.firstChild.end);

}

function areSameSelections(a: vscode.Selection[], b: vscode.Selection[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (!a[i].isEqual(b[i])) {
			return false;
		}
	}
	return true;
}
