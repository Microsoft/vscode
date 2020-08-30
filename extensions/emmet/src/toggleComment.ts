/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getNodesInBetween, getNode, getHtmlNode, parseDocument, sameNodes, isStyleSheet, validate } from './util';
import { Node, Stylesheet, Rule } from 'EmmetNode';
import parseStylesheet from '@emmetio/css-parser';
import { DocumentStreamReader } from './bufferStream';

const startCommentStylesheet = '/*';
const endCommentStylesheet = '*/';
const startCommentHTML = '<!--';
const endCommentHTML = '-->';

export function toggleComment(): Thenable<boolean> | undefined {
	if (!validate() || !vscode.window.activeTextEditor) {
		return;
	}
	const editor = vscode.window.activeTextEditor;
	let rootNode = parseDocument(editor.document);
	if (!rootNode) {
		return;
	}

	return editor.edit(editBuilder => {
		let allEdits: vscode.TextEdit[][] = [];
		editor.selections.reverse().forEach(selection => {
			let edits = isStyleSheet(editor.document.languageId) ? toggleCommentStylesheet(selection, <Stylesheet>rootNode) : toggleCommentHTML(editor.document, selection, rootNode!);
			if (edits.length > 0) {
				allEdits.push(edits);
			}
		});

		// Apply edits in order so we can skip nested ones.
		allEdits.sort((arr1, arr2) => {
			let result = arr1[0].range.start.line - arr2[0].range.start.line;
			return result === 0 ? arr1[0].range.start.character - arr2[0].range.start.character : result;
		});
		let lastEditPosition = new vscode.Position(0, 0);
		for (const edits of allEdits) {
			if (edits[0].range.end.isAfterOrEqual(lastEditPosition)) {
				edits.forEach(x => {
					editBuilder.replace(x.range, x.newText);
					lastEditPosition = x.range.end;
				});
			}
		}
	});
}

function toggleCommentHTML(document: vscode.TextDocument, selection: vscode.Selection, rootNode: Node): vscode.TextEdit[] {
	const selectionStart = selection.isReversed ? selection.active : selection.anchor;
	const selectionEnd = selection.isReversed ? selection.anchor : selection.active;

	let startNode = getHtmlNode(document, rootNode, selectionStart, true);
	let endNode = getHtmlNode(document, rootNode, selectionEnd, true);

	if (!startNode || !endNode) {
		return [];
	}

	if (sameNodes(startNode, endNode) && startNode.name === 'style'
		&& startNode.open.end.isBefore(selectionStart)
		&& startNode.close.start.isAfter(selectionEnd)) {
		let buffer = new DocumentStreamReader(document, startNode.open.end, new vscode.Range(startNode.open.end, startNode.close.start));
		let cssRootNode = parseStylesheet(buffer);

		return toggleCommentStylesheet(selection, cssRootNode);
	}

	let allNodes: Node[] = getNodesInBetween(startNode, endNode);
	let edits: vscode.TextEdit[] = [];

	allNodes.forEach(node => {
		edits = edits.concat(getRangesToUnCommentHTML(node, document));
	});

	if (startNode.type === 'comment') {
		return edits;
	}


	edits.push(new vscode.TextEdit(new vscode.Range(allNodes[0].start, allNodes[0].start), startCommentHTML));
	edits.push(new vscode.TextEdit(new vscode.Range(allNodes[allNodes.length - 1].end, allNodes[allNodes.length - 1].end), endCommentHTML));

	return edits;
}

function getRangesToUnCommentHTML(node: Node, document: vscode.TextDocument): vscode.TextEdit[] {
	let unCommentTextEdits: vscode.TextEdit[] = [];

	// If current node is commented, then uncomment and return
	if (node.type === 'comment') {

		unCommentTextEdits.push(new vscode.TextEdit(new vscode.Range(node.start, node.start.translate(0, startCommentHTML.length)), ''));
		unCommentTextEdits.push(new vscode.TextEdit(new vscode.Range(node.end.translate(0, -endCommentHTML.length), node.end), ''));

		return unCommentTextEdits;
	}

	// All children of current node should be uncommented
	node.children.forEach(childNode => {
		unCommentTextEdits = unCommentTextEdits.concat(getRangesToUnCommentHTML(childNode, document));
	});

	return unCommentTextEdits;
}

function toggleCommentStylesheet(selection: vscode.Selection, rootNode: Stylesheet): vscode.TextEdit[] {
	let selectionStart = selection.isReversed ? selection.active : selection.anchor;
	let selectionEnd = selection.isReversed ? selection.anchor : selection.active;

	let startNode = getNode(rootNode, selectionStart, true);
	let endNode = getNode(rootNode, selectionEnd, true);

	if (!selection.isEmpty) {
		selectionStart = adjustStartNodeCss(startNode, selectionStart, rootNode);
		selectionEnd = adjustEndNodeCss(endNode, selectionEnd, rootNode);
		selection = new vscode.Selection(selectionStart, selectionEnd);
	} else if (startNode) {
		selectionStart = startNode.start;
		selectionEnd = startNode.end;
		selection = new vscode.Selection(selectionStart, selectionEnd);
	}

	// Uncomment the comments that intersect with the selection.
	let rangesToUnComment: vscode.Range[] = [];
	let edits: vscode.TextEdit[] = [];
	rootNode.comments.forEach(comment => {
		let commentRange = new vscode.Range(comment.start, comment.end);
		if (selection.intersection(commentRange)) {
			rangesToUnComment.push(commentRange);
			edits.push(new vscode.TextEdit(new vscode.Range(comment.start, comment.start.translate(0, startCommentStylesheet.length)), ''));
			edits.push(new vscode.TextEdit(new vscode.Range(comment.end.translate(0, -endCommentStylesheet.length), comment.end), ''));
		}
	});

	if (edits.length > 0) {
		return edits;
	}

	return [
		new vscode.TextEdit(new vscode.Range(selection.start, selection.start), startCommentStylesheet),
		new vscode.TextEdit(new vscode.Range(selection.end, selection.end), endCommentStylesheet)
	];


}

function adjustStartNodeCss(node: Node | null, pos: vscode.Position, rootNode: Stylesheet): vscode.Position {
	for (const comment of rootNode.comments) {
		let commentRange = new vscode.Range(comment.start, comment.end);
		if (commentRange.contains(pos)) {
			return pos;
		}
	}

	if (!node) {
		return pos;
	}

	if (node.type === 'property') {
		return node.start;
	}

	const rule = <Rule>node;
	if (pos.isBefore(rule.contentStartToken.end) || !rule.firstChild) {
		return rule.start;
	}

	if (pos.isBefore(rule.firstChild.start)) {
		return pos;
	}

	let newStartNode = rule.firstChild;
	while (newStartNode.nextSibling && pos.isAfter(newStartNode.end)) {
		newStartNode = newStartNode.nextSibling;
	}

	return newStartNode.start;
}

function adjustEndNodeCss(node: Node | null, pos: vscode.Position, rootNode: Stylesheet): vscode.Position {
	for (const comment of rootNode.comments) {
		let commentRange = new vscode.Range(comment.start, comment.end);
		if (commentRange.contains(pos)) {
			return pos;
		}
	}

	if (!node) {
		return pos;
	}

	if (node.type === 'property') {
		return node.end;
	}

	const rule = <Rule>node;
	if (pos.isEqual(rule.contentEndToken.end) || !rule.firstChild) {
		return rule.end;
	}

	if (pos.isAfter(rule.children[rule.children.length - 1].end)) {
		return pos;
	}

	let newEndNode = rule.children[rule.children.length - 1];
	while (newEndNode.previousSibling && pos.isBefore(newEndNode.start)) {
		newEndNode = newEndNode.previousSibling;
	}

	return newEndNode.end;
}


