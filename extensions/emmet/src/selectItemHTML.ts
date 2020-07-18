/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getDeepestNode, findNextWord, findPrevWord, getHtmlNode, isNumber } from './util';
import { HtmlNode } from 'EmmetNode';

export function nextItemHTML(selectionStart: vscode.Position, selectionEnd: vscode.Position, editor: vscode.TextEditor, rootNode: HtmlNode): vscode.Selection | undefined {
	let currentNode = getHtmlNode(editor.document, rootNode, selectionEnd, false);
	let nextNode: HtmlNode | undefined = undefined;

	if (!currentNode) {
		return;
	}

	if (currentNode.type !== 'comment') {
		// If cursor is in the tag name, select tag
		if (selectionEnd.isBefore(currentNode.open.start.translate(0, currentNode.name.length))) {
			return getSelectionFromNode(currentNode);
		}

		// If cursor is in the open tag, look for attributes
		if (selectionEnd.isBefore(currentNode.open.end)) {
			let attrSelection = getNextAttribute(selectionStart, selectionEnd, currentNode);
			if (attrSelection) {
				return attrSelection;
			}
		}

		// Get the first child of current node which is right after the cursor and is not a comment
		nextNode = currentNode.firstChild;
		while (nextNode && (selectionEnd.isAfterOrEqual(nextNode.end) || nextNode.type === 'comment')) {
			nextNode = nextNode.nextSibling;
		}
	}


	// Get next sibling of current node which is not a comment. If none is found try the same on the parent
	while (!nextNode && currentNode) {
		if (currentNode.nextSibling) {
			if (currentNode.nextSibling.type !== 'comment') {
				nextNode = currentNode.nextSibling;
			} else {
				currentNode = currentNode.nextSibling;
			}
		} else {
			currentNode = currentNode.parent;
		}
	}

	return nextNode && getSelectionFromNode(nextNode);
}

export function prevItemHTML(selectionStart: vscode.Position, selectionEnd: vscode.Position, editor: vscode.TextEditor, rootNode: HtmlNode): vscode.Selection | undefined {
	let currentNode = getHtmlNode(editor.document, rootNode, selectionStart, false);
	let prevNode: HtmlNode | undefined = undefined;

	if (!currentNode) {
		return;
	}

	if (currentNode.type !== 'comment' && selectionStart.translate(0, -1).isAfter(currentNode.open.start)) {

		if (selectionStart.isBefore(currentNode.open.end) || !currentNode.firstChild || selectionEnd.isBeforeOrEqual(currentNode.firstChild.start)) {
			prevNode = currentNode;
		} else {
			// Select the child that appears just before the cursor and is not a comment
			prevNode = currentNode.firstChild;
			let oldOption: HtmlNode | undefined = undefined;
			while (prevNode.nextSibling && selectionStart.isAfterOrEqual(prevNode.nextSibling.end)) {
				if (prevNode && prevNode.type !== 'comment') {
					oldOption = prevNode;
				}
				prevNode = prevNode.nextSibling;
			}

			prevNode = <HtmlNode>getDeepestNode((prevNode && prevNode.type !== 'comment') ? prevNode : oldOption);
		}
	}

	// Select previous sibling which is not a comment. If none found, then select parent
	while (!prevNode && currentNode) {
		if (currentNode.previousSibling) {
			if (currentNode.previousSibling.type !== 'comment') {
				prevNode = <HtmlNode>getDeepestNode(currentNode.previousSibling);
			} else {
				currentNode = currentNode.previousSibling;
			}
		} else {
			prevNode = currentNode.parent;
		}

	}

	if (!prevNode) {
		return undefined;
	}

	let attrSelection = getPrevAttribute(selectionStart, selectionEnd, prevNode);
	return attrSelection ? attrSelection : getSelectionFromNode(prevNode);
}

function getSelectionFromNode(node: HtmlNode): vscode.Selection | undefined {
	if (node && node.open) {
		let selectionStart = (<vscode.Position>node.open.start).translate(0, 1);
		let selectionEnd = selectionStart.translate(0, node.name.length);

		return new vscode.Selection(selectionStart, selectionEnd);
	}
	return undefined;
}

function getNextAttribute(selectionStart: vscode.Position, selectionEnd: vscode.Position, node: HtmlNode): vscode.Selection | undefined {

	if (!node.attributes || node.attributes.length === 0 || node.type === 'comment') {
		return;
	}

	for (const attr of node.attributes) {
		if (selectionEnd.isBefore(attr.start)) {
			// select full attr
			return new vscode.Selection(attr.start, attr.end);
		}

		if (!attr.value || (<vscode.Position>attr.value.start).isEqual(attr.value.end)) {
			// No attr value to select
			continue;
		}

		if ((selectionStart.isEqual(attr.start) && selectionEnd.isEqual(attr.end)) || selectionEnd.isBefore(attr.value.start)) {
			// cursor is in attr name,  so select full attr value
			return new vscode.Selection(attr.value.start, attr.value.end);
		}

		// Fetch the next word in the attr value

		if (attr.value.toString().indexOf(' ') === -1) {
			// attr value does not have space, so no next word to find
			continue;
		}

		let pos: number | undefined = undefined;
		if (selectionStart.isEqual(attr.value.start) && selectionEnd.isEqual(attr.value.end)) {
			pos = -1;
		}
		if (pos === undefined && selectionEnd.isBefore(attr.end)) {
			pos = selectionEnd.character - attr.value.start.character - 1;
		}

		if (pos !== undefined) {
			let [newSelectionStartOffset, newSelectionEndOffset] = findNextWord(attr.value.toString(), pos);
			if (!isNumber(newSelectionStartOffset) || !isNumber(newSelectionEndOffset)) {
				return;
			}
			if (newSelectionStartOffset >= 0 && newSelectionEndOffset >= 0) {
				const newSelectionStart = (<vscode.Position>attr.value.start).translate(0, newSelectionStartOffset);
				const newSelectionEnd = (<vscode.Position>attr.value.start).translate(0, newSelectionEndOffset);
				return new vscode.Selection(newSelectionStart, newSelectionEnd);
			}
		}

	}

	return;
}

function getPrevAttribute(selectionStart: vscode.Position, selectionEnd: vscode.Position, node: HtmlNode): vscode.Selection | undefined {

	if (!node.attributes || node.attributes.length === 0 || node.type === 'comment') {
		return;
	}

	for (let i = node.attributes.length - 1; i >= 0; i--) {
		let attr = node.attributes[i];

		if (selectionStart.isBeforeOrEqual(attr.start)) {
			continue;
		}

		if (!attr.value || (<vscode.Position>attr.value.start).isEqual(attr.value.end) || selectionStart.isBefore(attr.value.start)) {
			// select full attr
			return new vscode.Selection(attr.start, attr.end);
		}

		if (selectionStart.isEqual(attr.value.start)) {
			if (selectionEnd.isAfterOrEqual(attr.value.end)) {
				// select full attr
				return new vscode.Selection(attr.start, attr.end);
			}
			// select attr value
			return new vscode.Selection(attr.value.start, attr.value.end);
		}

		// Fetch the prev word in the attr value

		let pos = selectionStart.isAfter(attr.value.end) ? attr.value.toString().length : selectionStart.character - attr.value.start.character;
		let [newSelectionStartOffset, newSelectionEndOffset] = findPrevWord(attr.value.toString(), pos);
		if (!isNumber(newSelectionStartOffset) || !isNumber(newSelectionEndOffset)) {
			return;
		}
		if (newSelectionStartOffset >= 0 && newSelectionEndOffset >= 0) {
			const newSelectionStart = (<vscode.Position>attr.value.start).translate(0, newSelectionStartOffset);
			const newSelectionEnd = (<vscode.Position>attr.value.start).translate(0, newSelectionEndOffset);
			return new vscode.Selection(newSelectionStart, newSelectionEnd);
		}
	}

	return;
}
