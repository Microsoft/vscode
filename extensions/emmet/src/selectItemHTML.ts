/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getDeepestFlatNode, findNextWord, findPrevWord, getHtmlFlatNode, offsetRangeToSelection } from './util';
import { HtmlNode } from 'EmmetFlatNode';

export function nextItemHTML(document: vscode.TextDocument, selectionStart: vscode.Position, selectionEnd: vscode.Position, rootNode: HtmlNode): vscode.Selection | undefined {
	const selectionEndOffset = document.offsetAt(selectionEnd);
	let currentNode = getHtmlFlatNode(document.getText(), rootNode, selectionEndOffset, false);
	let nextNode: HtmlNode | undefined = undefined;

	if (!currentNode) {
		return;
	}

	if (currentNode.type !== 'comment') {
		// If cursor is in the tag name, select tag
		if (currentNode.open &&
			selectionEndOffset <= currentNode.open.start + currentNode.name.length) {
			return getSelectionFromNode(document, currentNode);
		}

		// If cursor is in the open tag, look for attributes
		if (currentNode.open &&
			selectionEndOffset < currentNode.open.end) {
			const selectionStartOffset = document.offsetAt(selectionStart);
			const attrSelection = getNextAttribute(document, selectionStartOffset, selectionEndOffset, currentNode);
			if (attrSelection) {
				return attrSelection;
			}
		}

		// Get the first child of current node which is right after the cursor and is not a comment
		nextNode = currentNode.firstChild;
		while (nextNode && (selectionEndOffset >= nextNode.end || nextNode.type === 'comment')) {
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

	return nextNode && getSelectionFromNode(document, nextNode);
}

export function prevItemHTML(document: vscode.TextDocument, selectionStart: vscode.Position, selectionEnd: vscode.Position, rootNode: HtmlNode): vscode.Selection | undefined {
	const selectionStartOffset = document.offsetAt(selectionStart);
	let currentNode = getHtmlFlatNode(document.getText(), rootNode, selectionStartOffset, false);
	let prevNode: HtmlNode | undefined = undefined;

	if (!currentNode) {
		return;
	}

	const selectionEndOffset = document.offsetAt(selectionEnd);
	if (currentNode.open &&
		currentNode.type !== 'comment' &&
		selectionStartOffset - 1 > currentNode.open.start) {
		if (selectionStartOffset < currentNode.open.end || !currentNode.firstChild || selectionEndOffset <= currentNode.firstChild.start) {
			prevNode = currentNode;
		} else {
			// Select the child that appears just before the cursor and is not a comment
			prevNode = currentNode.firstChild;
			let oldOption: HtmlNode | undefined = undefined;
			while (prevNode.nextSibling && selectionStartOffset >= prevNode.nextSibling.end) {
				if (prevNode && prevNode.type !== 'comment') {
					oldOption = prevNode;
				}
				prevNode = prevNode.nextSibling;
			}

			prevNode = <HtmlNode>getDeepestFlatNode((prevNode && prevNode.type !== 'comment') ? prevNode : oldOption);
		}
	}

	// Select previous sibling which is not a comment. If none found, then select parent
	while (!prevNode && currentNode) {
		if (currentNode.previousSibling) {
			if (currentNode.previousSibling.type !== 'comment') {
				prevNode = <HtmlNode>getDeepestFlatNode(currentNode.previousSibling);
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

	const attrSelection = getPrevAttribute(document, selectionStartOffset, selectionEndOffset, prevNode);
	return attrSelection ? attrSelection : getSelectionFromNode(document, prevNode);
}

function getSelectionFromNode(document: vscode.TextDocument, node: HtmlNode): vscode.Selection | undefined {
	if (node && node.open) {
		const selectionStart = node.open.start + 1;
		const selectionEnd = selectionStart + node.name.length;
		return offsetRangeToSelection(document, selectionStart, selectionEnd);
	}
	return undefined;
}

function getNextAttribute(document: vscode.TextDocument, selectionStart: number, selectionEnd: number, node: HtmlNode): vscode.Selection | undefined {
	if (!node.attributes || node.attributes.length === 0 || node.type === 'comment') {
		return;
	}

	for (const attr of node.attributes) {
		if (selectionEnd < attr.start) {
			// select full attr
			return offsetRangeToSelection(document, attr.start, attr.end);
		}

		if (!attr.value || attr.value.start === attr.value.end) {
			// No attr value to select
			continue;
		}

		if ((selectionStart === attr.start && selectionEnd === attr.end) ||
			selectionEnd < attr.value.start) {
			// cursor is in attr name,  so select full attr value
			return offsetRangeToSelection(document, attr.value.start, attr.value.end);
		}

		// Fetch the next word in the attr value
		if (attr.value.toString().indexOf(' ') === -1) {
			// attr value does not have space, so no next word to find
			continue;
		}

		let pos: number | undefined = undefined;
		if (selectionStart === attr.value.start && selectionEnd === attr.value.end) {
			pos = -1;
		}
		if (pos === undefined && selectionEnd < attr.end) {
			const selectionEndCharacter = document.positionAt(selectionEnd).character;
			const attrValueStartCharacter = document.positionAt(attr.value.start).character;
			pos = selectionEndCharacter - attrValueStartCharacter - 1;
		}

		if (pos !== undefined) {
			const [newSelectionStartOffset, newSelectionEndOffset] = findNextWord(attr.value.toString(), pos);
			if (newSelectionStartOffset === undefined || newSelectionEndOffset === undefined) {
				return;
			}
			if (newSelectionStartOffset >= 0 && newSelectionEndOffset >= 0) {
				const newSelectionStart = attr.value.start + newSelectionStartOffset;
				const newSelectionEnd = attr.value.start + newSelectionEndOffset;
				return offsetRangeToSelection(document, newSelectionStart, newSelectionEnd);
			}
		}

	}

	return;
}

function getPrevAttribute(document: vscode.TextDocument, selectionStart: number, selectionEnd: number, node: HtmlNode): vscode.Selection | undefined {
	if (!node.attributes || node.attributes.length === 0 || node.type === 'comment') {
		return;
	}

	for (let i = node.attributes.length - 1; i >= 0; i--) {
		const attr = node.attributes[i];
		if (selectionStart <= attr.start) {
			continue;
		}

		if (!attr.value || attr.value.start === attr.value.end || selectionStart < attr.value.start) {
			// select full attr
			return offsetRangeToSelection(document, attr.start, attr.end);
		}

		if (selectionStart === attr.value.start) {
			if (selectionEnd >= attr.value.end) {
				// select full attr
				return offsetRangeToSelection(document, attr.start, attr.end);
			}
			// select attr value
			return offsetRangeToSelection(document, attr.value.start, attr.value.end);
		}

		// Fetch the prev word in the attr value
		const selectionStartCharacter = document.positionAt(selectionStart).character;
		const attrValueStartCharacter = document.positionAt(attr.value.start).character;
		const pos = selectionStart > attr.value.end ? attr.value.toString().length :
			selectionStartCharacter - attrValueStartCharacter;
		const [newSelectionStartOffset, newSelectionEndOffset] = findPrevWord(attr.value.toString(), pos);
		if (newSelectionStartOffset === undefined || newSelectionEndOffset === undefined) {
			return;
		}
		if (newSelectionStartOffset >= 0 && newSelectionEndOffset >= 0) {
			const newSelectionStart = attr.value.start + newSelectionStartOffset;
			const newSelectionEnd = attr.value.start + newSelectionEndOffset;
			return offsetRangeToSelection(document, newSelectionStart, newSelectionEnd);
		}
	}

	return;
}
