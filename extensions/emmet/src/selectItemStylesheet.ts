/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getDeepestNode, findNextWord, findPrevWord, getNode } from './util';
import { Node, CssNode, Rule, Property } from 'EmmetNode';

export function nextItemStylesheet(startOffset: vscode.Position, endOffset: vscode.Position, rootNode: Node): vscode.Selection | undefined {
	let currentNode = <CssNode>getNode(rootNode, endOffset, true);
	if (!currentNode) {
		currentNode = <CssNode>rootNode;
	}
	if (!currentNode) {
		return;
	}
	// Full property is selected, so select full property value next
	if (currentNode.type === 'property' && startOffset.isEqual(currentNode.start) && endOffset.isEqual(currentNode.end)) {
		return getSelectionFromProperty(currentNode, startOffset, endOffset, true, 'next');
	}

	// Part or whole of propertyValue is selected, so select the next word in the propertyValue
	if (currentNode.type === 'property' && startOffset.isAfterOrEqual((<Property>currentNode).valueToken.start) && endOffset.isBeforeOrEqual((<Property>currentNode).valueToken.end)) {
		let singlePropertyValue = getSelectionFromProperty(currentNode, startOffset, endOffset, false, 'next');
		if (singlePropertyValue) {
			return singlePropertyValue;
		}
	}

	// Cursor is in the selector or in a property
	if ((currentNode.type === 'rule' && endOffset.isBefore((<Rule>currentNode).selectorToken.end))
		|| (currentNode.type === 'property' && endOffset.isBefore((<Property>currentNode).valueToken.end))) {
		return getSelectionFromNode(currentNode);
	}

	// Get the first child of current node which is right after the cursor
	let nextNode = currentNode.firstChild;
	while (nextNode && endOffset.isAfterOrEqual(nextNode.end)) {
		nextNode = nextNode.nextSibling;
	}

	// Get next sibling of current node or the parent
	while (!nextNode && currentNode) {
		nextNode = currentNode.nextSibling;
		currentNode = currentNode.parent;
	}

	return getSelectionFromNode(nextNode);

}

export function prevItemStylesheet(startOffset: vscode.Position, endOffset: vscode.Position, rootNode: CssNode): vscode.Selection | undefined {
	let currentNode = <CssNode>getNode(rootNode, startOffset, false);
	if (!currentNode) {
		currentNode = rootNode;
	}
	if (!currentNode) {
		return;
	}

	// Full property value is selected, so select the whole property next
	if (currentNode.type === 'property' && startOffset.isEqual((<Property>currentNode).valueToken.start) && endOffset.isEqual((<Property>currentNode).valueToken.end)) {
		return getSelectionFromNode(currentNode);
	}

	// Part of propertyValue is selected, so select the prev word in the propertyValue
	if (currentNode.type === 'property' && startOffset.isAfterOrEqual((<Property>currentNode).valueToken.start) && endOffset.isBeforeOrEqual((<Property>currentNode).valueToken.end)) {
		let singlePropertyValue = getSelectionFromProperty(currentNode, startOffset, endOffset, false, 'prev');
		if (singlePropertyValue) {
			return singlePropertyValue;
		}
	}

	if (currentNode.type === 'property' || !currentNode.firstChild || (currentNode.type === 'rule' && startOffset.isBeforeOrEqual(currentNode.firstChild.start))) {
		return getSelectionFromNode(currentNode);
	}

	// Select the child that appears just before the cursor
	let prevNode = currentNode.firstChild;
	while (prevNode.nextSibling && startOffset.isAfterOrEqual(prevNode.nextSibling.end)) {
		prevNode = prevNode.nextSibling;
	}
	prevNode = <CssNode>getDeepestNode(prevNode);

	return getSelectionFromProperty(prevNode, startOffset, endOffset, false, 'prev');

}


function getSelectionFromNode(node: Node): vscode.Selection | undefined {
	if (!node) {
		return;
	}

	let nodeToSelect = node.type === 'rule' ? (<Rule>node).selectorToken : node;
	return new vscode.Selection(nodeToSelect.start, nodeToSelect.end);
}


function getSelectionFromProperty(node: Node, selectionStart: vscode.Position, selectionEnd: vscode.Position, selectFullValue: boolean, direction: string): vscode.Selection | undefined {
	if (!node || node.type !== 'property') {
		return;
	}
	const propertyNode = <Property>node;

	let propertyValue = propertyNode.valueToken.stream.substring(propertyNode.valueToken.start, propertyNode.valueToken.end);
	selectFullValue = selectFullValue || (direction === 'prev' && selectionStart.isEqual(propertyNode.valueToken.start) && selectionEnd.isBefore(propertyNode.valueToken.end));

	if (selectFullValue) {
		return new vscode.Selection(propertyNode.valueToken.start, propertyNode.valueToken.end);
	}

	let pos: number = -1;
	if (direction === 'prev') {
		if (selectionStart.isEqual(propertyNode.valueToken.start)) {
			return;
		}
		pos = selectionStart.isAfter(propertyNode.valueToken.end) ? propertyValue.length : selectionStart.character - propertyNode.valueToken.start.character;
	}

	if (direction === 'next') {
		if (selectionEnd.isEqual(propertyNode.valueToken.end) && (selectionStart.isAfter(propertyNode.valueToken.start) || propertyValue.indexOf(' ') === -1)) {
			return;
		}
		pos = selectionEnd.isEqual(propertyNode.valueToken.end) ? -1 : selectionEnd.character - propertyNode.valueToken.start.character - 1;
	}


	let [newSelectionStartOffset, newSelectionEndOffset] = direction === 'prev' ? findPrevWord(propertyValue, pos) : findNextWord(propertyValue, pos);
	if (!newSelectionStartOffset && !newSelectionEndOffset) {
		return;
	}

	const newSelectionStart = (<vscode.Position>propertyNode.valueToken.start).translate(0, newSelectionStartOffset);
	const newSelectionEnd = (<vscode.Position>propertyNode.valueToken.start).translate(0, newSelectionEndOffset);

	return new vscode.Selection(newSelectionStart, newSelectionEnd);
}



