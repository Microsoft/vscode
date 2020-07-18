/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import parse from '@emmetio/html-matcher';
import parseStylesheet from '@emmetio/css-parser';
import { Node, HtmlNode, CssToken, Property, Rule, Stylesheet } from 'EmmetNode';
import { DocumentStreamReader } from './bufferStream';
import * as EmmetHelper from 'vscode-emmet-helper2';
import { TextDocument as LSTextDocument } from 'vscode-html-languageservice';

let _emmetHelper: typeof EmmetHelper;
let _currentExtensionsPath: string | undefined = undefined;

let _homeDir: vscode.Uri | undefined;


export function setHomeDir(homeDir: vscode.Uri) {
	_homeDir = homeDir;
}


export function getEmmetHelper() {
	// Lazy load vscode-emmet-helper instead of importing it
	// directly to reduce the start-up time of the extension
	if (!_emmetHelper) {
		_emmetHelper = require('vscode-emmet-helper2');
	}
	updateEmmetExtensionsPath();
	return _emmetHelper;
}

/**
 * Update Emmet Helper to use user snippets from the extensionsPath setting
 */
export function updateEmmetExtensionsPath() {
	if (!_emmetHelper) {
		return;
	}
	let extensionsPath = vscode.workspace.getConfiguration('emmet')['extensionsPath'];
	if (_currentExtensionsPath !== extensionsPath) {
		_currentExtensionsPath = extensionsPath;
		if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
			return;
		} else {
			const rootPath = vscode.workspace.workspaceFolders[0].uri;
			const fileSystem = vscode.workspace.fs;
			_emmetHelper.updateExtensionsPath(extensionsPath, fileSystem, rootPath, _homeDir).then(null, (err: string) => vscode.window.showErrorMessage(err));
		}
	}
}

/**
 * Mapping between languages that support Emmet and completion trigger characters
 */
export const LANGUAGE_MODES: { [id: string]: string[] } = {
	'html': ['!', '.', '}', ':', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'jade': ['!', '.', '}', ':', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'slim': ['!', '.', '}', ':', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'haml': ['!', '.', '}', ':', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'xml': ['.', '}', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'xsl': ['!', '.', '}', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'css': [':', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'scss': [':', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'sass': [':', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'less': [':', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'stylus': [':', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'javascriptreact': ['!', '.', '}', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
	'typescriptreact': ['!', '.', '}', '*', '$', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
};

export function isStyleSheet(syntax: string): boolean {
	let stylesheetSyntaxes = ['css', 'scss', 'sass', 'less', 'stylus'];
	return (stylesheetSyntaxes.indexOf(syntax) > -1);
}

export function validate(allowStylesheet: boolean = true): boolean {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No editor is active');
		return false;
	}
	if (!allowStylesheet && isStyleSheet(editor.document.languageId)) {
		return false;
	}
	return true;
}

export function getMappingForIncludedLanguages(): any {
	// Explicitly map languages that have built-in grammar in VS Code to their parent language
	// to get emmet completion support
	// For other languages, users will have to use `emmet.includeLanguages` or
	// language specific extensions can provide emmet completion support
	const MAPPED_MODES: Object = {
		'handlebars': 'html',
		'php': 'html'
	};

	const finalMappedModes = Object.create(null);
	let includeLanguagesConfig = vscode.workspace.getConfiguration('emmet')['includeLanguages'];
	let includeLanguages = Object.assign({}, MAPPED_MODES, includeLanguagesConfig ? includeLanguagesConfig : {});
	Object.keys(includeLanguages).forEach(syntax => {
		if (typeof includeLanguages[syntax] === 'string' && LANGUAGE_MODES[includeLanguages[syntax]]) {
			finalMappedModes[syntax] = includeLanguages[syntax];
		}
	});
	return finalMappedModes;
}

/**
* Get the corresponding emmet mode for given vscode language mode
* E.g.: jsx for typescriptreact/javascriptreact or pug for jade
* If the language is not supported by emmet or has been excluded via `excludeLanguages` setting,
* then nothing is returned
*
* @param excludedLanguages Array of language ids that user has chosen to exclude for emmet
*/
export function getEmmetMode(language: string, excludedLanguages: string[]): string | undefined {
	if (!language || excludedLanguages.indexOf(language) > -1) {
		return;
	}
	if (/\b(typescriptreact|javascriptreact|jsx-tags)\b/.test(language)) { // treat tsx like jsx
		return 'jsx';
	}
	if (language === 'sass-indented') { // map sass-indented to sass
		return 'sass';
	}
	if (language === 'jade') {
		return 'pug';
	}
	const emmetModes = ['html', 'pug', 'slim', 'haml', 'xml', 'xsl', 'jsx', 'css', 'scss', 'sass', 'less', 'stylus'];
	if (emmetModes.indexOf(language) > -1) {
		return language;
	}
	return;
}

/**
 * Parses the given document using emmet parsing modules
 */
export function parseDocument(document: vscode.TextDocument, showError: boolean = true): Node | undefined {
	let parseContent = isStyleSheet(document.languageId) ? parseStylesheet : parse;
	try {
		return parseContent(new DocumentStreamReader(document));
	} catch (e) {
		if (showError) {
			vscode.window.showErrorMessage('Emmet: Failed to parse the file');
		}
	}
	return undefined;
}

const closeBrace = 125;
const openBrace = 123;
const slash = 47;
const star = 42;

/**
 * Traverse the given document backward & forward from given position
 * to find a complete ruleset, then parse just that to return a Stylesheet
 * @param document vscode.TextDocument
 * @param position vscode.Position
 */
export function parsePartialStylesheet(document: vscode.TextDocument, position: vscode.Position): Stylesheet | undefined {
	const isCSS = document.languageId === 'css';
	let startPosition = new vscode.Position(0, 0);
	let endPosition = new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
	const limitCharacter = document.offsetAt(position) - 5000;
	const limitPosition = limitCharacter > 0 ? document.positionAt(limitCharacter) : startPosition;
	const stream = new DocumentStreamReader(document, position);

	function findOpeningCommentBeforePosition(pos: vscode.Position): vscode.Position | undefined {
		let text = document.getText(new vscode.Range(0, 0, pos.line, pos.character));
		let offset = text.lastIndexOf('/*');
		if (offset === -1) {
			return;
		}
		return document.positionAt(offset);
	}

	function findClosingCommentAfterPosition(pos: vscode.Position): vscode.Position | undefined {
		let text = document.getText(new vscode.Range(pos.line, pos.character, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length));
		let offset = text.indexOf('*/');
		if (offset === -1) {
			return;
		}
		offset += 2 + document.offsetAt(pos);
		return document.positionAt(offset);
	}

	function consumeLineCommentBackwards() {
		if (!isCSS && currentLine !== stream.pos.line) {
			currentLine = stream.pos.line;
			let startLineComment = document.lineAt(currentLine).text.indexOf('//');
			if (startLineComment > -1) {
				stream.pos = new vscode.Position(currentLine, startLineComment);
			}
		}
	}

	function consumeBlockCommentBackwards() {
		if (stream.peek() === slash) {
			if (stream.backUp(1) === star) {
				stream.pos = findOpeningCommentBeforePosition(stream.pos) || startPosition;
			} else {
				stream.next();
			}
		}
	}

	function consumeCommentForwards() {
		if (stream.eat(slash)) {
			if (stream.eat(slash) && !isCSS) {
				stream.pos = new vscode.Position(stream.pos.line + 1, 0);
			} else if (stream.eat(star)) {
				stream.pos = findClosingCommentAfterPosition(stream.pos) || endPosition;
			}
		}
	}

	// Go forward until we find a closing brace.
	while (!stream.eof() && !stream.eat(closeBrace)) {
		if (stream.peek() === slash) {
			consumeCommentForwards();
		} else {
			stream.next();
		}
	}

	if (!stream.eof()) {
		endPosition = stream.pos;
	}

	stream.pos = position;
	let openBracesToFind = 1;
	let currentLine = position.line;
	let exit = false;

	// Go back until we found an opening brace. If we find a closing one, consume its pair and continue.
	while (!exit && openBracesToFind > 0 && !stream.sof()) {
		consumeLineCommentBackwards();

		switch (stream.backUp(1)) {
			case openBrace:
				openBracesToFind--;
				break;
			case closeBrace:
				if (isCSS) {
					stream.next();
					startPosition = stream.pos;
					exit = true;
				} else {
					openBracesToFind++;
				}
				break;
			case slash:
				consumeBlockCommentBackwards();
				break;
			default:
				break;
		}

		if (position.line - stream.pos.line > 100 || stream.pos.isBeforeOrEqual(limitPosition)) {
			exit = true;
		}
	}

	// We are at an opening brace. We need to include its selector.
	currentLine = stream.pos.line;
	openBracesToFind = 0;
	let foundSelector = false;
	while (!exit && !stream.sof() && !foundSelector && openBracesToFind >= 0) {

		consumeLineCommentBackwards();

		const ch = stream.backUp(1);
		if (/\s/.test(String.fromCharCode(ch))) {
			continue;
		}

		switch (ch) {
			case slash:
				consumeBlockCommentBackwards();
				break;
			case closeBrace:
				openBracesToFind++;
				break;
			case openBrace:
				openBracesToFind--;
				break;
			default:
				if (!openBracesToFind) {
					foundSelector = true;
				}
				break;
		}

		if (!stream.sof() && foundSelector) {
			startPosition = stream.pos;
		}
	}

	try {
		return parseStylesheet(new DocumentStreamReader(document, startPosition, new vscode.Range(startPosition, endPosition)));
	} catch (e) {
		return;
	}
}

/**
 * Returns node corresponding to given position in the given root node
 */
export function getNode(root: Node | undefined, position: vscode.Position, includeNodeBoundary: boolean) {
	if (!root) {
		return null;
	}

	let currentNode = root.firstChild;
	let foundNode: Node | null = null;

	while (currentNode) {
		const nodeStart: vscode.Position = currentNode.start;
		const nodeEnd: vscode.Position = currentNode.end;
		if ((nodeStart.isBefore(position) && nodeEnd.isAfter(position))
			|| (includeNodeBoundary && (nodeStart.isBeforeOrEqual(position) && nodeEnd.isAfterOrEqual(position)))) {

			foundNode = currentNode;
			// Dig deeper
			currentNode = currentNode.firstChild;
		} else {
			currentNode = currentNode.nextSibling;
		}
	}

	return foundNode;
}

export const allowedMimeTypesInScriptTag = ['text/html', 'text/plain', 'text/x-template', 'text/template', 'text/ng-template'];

/**
 * Returns HTML node corresponding to given position in the given root node
 * If position is inside a script tag of type template, then it will be parsed to find the inner HTML node as well
 */
export function getHtmlNode(document: vscode.TextDocument, root: Node | undefined, position: vscode.Position, includeNodeBoundary: boolean): HtmlNode | undefined {
	let currentNode = <HtmlNode>getNode(root, position, includeNodeBoundary);
	if (!currentNode) { return; }

	const isTemplateScript = currentNode.name === 'script' &&
		(currentNode.attributes &&
			currentNode.attributes.some(x => x.name.toString() === 'type'
				&& allowedMimeTypesInScriptTag.indexOf(x.value.toString()) > -1));

	if (isTemplateScript && currentNode.close &&
		(position.isAfter(currentNode.open.end) && position.isBefore(currentNode.close.start))) {

		let buffer = new DocumentStreamReader(document, currentNode.open.end, new vscode.Range(currentNode.open.end, currentNode.close.start));

		try {
			let scriptInnerNodes = parse(buffer);
			currentNode = <HtmlNode>getNode(scriptInnerNodes, position, includeNodeBoundary) || currentNode;
		} catch (e) { }
	}

	return currentNode;
}

/**
 * Returns inner range of an html node.
 */
export function getInnerRange(currentNode: HtmlNode): vscode.Range | undefined {
	if (!currentNode.close) {
		return undefined;
	}
	return new vscode.Range(currentNode.open.end, currentNode.close.start);
}

/**
 * Returns the deepest non comment node under given node
 */
export function getDeepestNode(node: Node | undefined): Node | undefined {
	if (!node || !node.children || node.children.length === 0 || !node.children.find(x => x.type !== 'comment')) {
		return node;
	}
	for (let i = node.children.length - 1; i >= 0; i--) {
		if (node.children[i].type !== 'comment') {
			return getDeepestNode(node.children[i]);
		}
	}
	return undefined;
}

export function findNextWord(propertyValue: string, pos: number): [number | undefined, number | undefined] {

	let foundSpace = pos === -1;
	let foundStart = false;
	let foundEnd = false;

	let newSelectionStart;
	let newSelectionEnd;
	while (pos < propertyValue.length - 1) {
		pos++;
		if (!foundSpace) {
			if (propertyValue[pos] === ' ') {
				foundSpace = true;
			}
			continue;
		}
		if (foundSpace && !foundStart && propertyValue[pos] === ' ') {
			continue;
		}
		if (!foundStart) {
			newSelectionStart = pos;
			foundStart = true;
			continue;
		}
		if (propertyValue[pos] === ' ') {
			newSelectionEnd = pos;
			foundEnd = true;
			break;
		}
	}

	if (foundStart && !foundEnd) {
		newSelectionEnd = propertyValue.length;
	}

	return [newSelectionStart, newSelectionEnd];
}

export function findPrevWord(propertyValue: string, pos: number): [number | undefined, number | undefined] {

	let foundSpace = pos === propertyValue.length;
	let foundStart = false;
	let foundEnd = false;

	let newSelectionStart;
	let newSelectionEnd;
	while (pos > -1) {
		pos--;
		if (!foundSpace) {
			if (propertyValue[pos] === ' ') {
				foundSpace = true;
			}
			continue;
		}
		if (foundSpace && !foundEnd && propertyValue[pos] === ' ') {
			continue;
		}
		if (!foundEnd) {
			newSelectionEnd = pos + 1;
			foundEnd = true;
			continue;
		}
		if (propertyValue[pos] === ' ') {
			newSelectionStart = pos + 1;
			foundStart = true;
			break;
		}
	}

	if (foundEnd && !foundStart) {
		newSelectionStart = 0;
	}

	return [newSelectionStart, newSelectionEnd];
}

export function getNodesInBetween(node1: Node, node2: Node): Node[] {
	// Same node
	if (sameNodes(node1, node2)) {
		return [node1];
	}

	// Not siblings
	if (!sameNodes(node1.parent, node2.parent)) {
		// node2 is ancestor of node1
		if (node2.start.isBefore(node1.start)) {
			return [node2];
		}

		// node1 is ancestor of node2
		if (node2.start.isBefore(node1.end)) {
			return [node1];
		}

		// Get the highest ancestor of node1 that should be commented
		while (node1.parent && node1.parent.end.isBefore(node2.start)) {
			node1 = node1.parent;
		}

		// Get the highest ancestor of node2 that should be commented
		while (node2.parent && node2.parent.start.isAfter(node1.start)) {
			node2 = node2.parent;
		}
	}

	const siblings: Node[] = [];
	let currentNode = node1;
	const position = node2.end;
	while (currentNode && position.isAfter(currentNode.start)) {
		siblings.push(currentNode);
		currentNode = currentNode.nextSibling;
	}
	return siblings;
}

export function sameNodes(node1: Node, node2: Node): boolean {
	if (!node1 || !node2) {
		return false;
	}
	return (<vscode.Position>node1.start).isEqual(node2.start) && (<vscode.Position>node1.end).isEqual(node2.end);
}

export function getEmmetConfiguration(syntax: string) {
	const emmetConfig = vscode.workspace.getConfiguration('emmet');
	const syntaxProfiles = Object.assign({}, emmetConfig['syntaxProfiles'] || {});
	const preferences = Object.assign({}, emmetConfig['preferences'] || {});
	// jsx, xml and xsl syntaxes need to have self closing tags unless otherwise configured by user
	if (syntax === 'jsx' || syntax === 'xml' || syntax === 'xsl') {
		syntaxProfiles[syntax] = syntaxProfiles[syntax] || {};
		if (typeof syntaxProfiles[syntax] === 'object'
			&& !syntaxProfiles[syntax].hasOwnProperty('self_closing_tag') // Old Emmet format
			&& !syntaxProfiles[syntax].hasOwnProperty('selfClosingStyle') // Emmet 2.0 format
		) {
			syntaxProfiles[syntax] = {
				...syntaxProfiles[syntax],
				selfClosingStyle: 'xml'
			};
		}
	}

	return {
		preferences,
		showExpandedAbbreviation: emmetConfig['showExpandedAbbreviation'],
		showAbbreviationSuggestions: emmetConfig['showAbbreviationSuggestions'],
		syntaxProfiles,
		variables: emmetConfig['variables'],
		excludeLanguages: emmetConfig['excludeLanguages'],
		showSuggestionsAsSnippets: emmetConfig['showSuggestionsAsSnippets']
	};
}

/**
 * Itereates by each child, as well as nested child's children, in their order
 * and invokes `fn` for each. If `fn` function returns `false`, iteration stops
 */
export function iterateCSSToken(token: CssToken, fn: (x: any) => any): boolean {
	for (let i = 0, il = token.size; i < il; i++) {
		if (fn(token.item(i)) === false || iterateCSSToken(token.item(i), fn) === false) {
			return false;
		}
	}
	return true;
}

/**
 * Returns `name` CSS property from given `rule`
 */
export function getCssPropertyFromRule(rule: Rule, name: string): Property | undefined {
	return rule.children.find(node => node.type === 'property' && node.name === name) as Property;
}

/**
 * Returns css property under caret in given editor or `null` if such node cannot
 * be found
 */
export function getCssPropertyFromDocument(editor: vscode.TextEditor, position: vscode.Position): Property | null {
	const rootNode = parseDocument(editor.document);
	const node = getNode(rootNode, position, true);

	if (isStyleSheet(editor.document.languageId)) {
		return node && node.type === 'property' ? <Property>node : null;
	}

	let htmlNode = <HtmlNode>node;
	if (htmlNode
		&& htmlNode.name === 'style'
		&& htmlNode.open.end.isBefore(position)
		&& htmlNode.close.start.isAfter(position)) {
		let buffer = new DocumentStreamReader(editor.document, htmlNode.start, new vscode.Range(htmlNode.start, htmlNode.end));
		let rootNode = parseStylesheet(buffer);
		const node = getNode(rootNode, position, true);
		return (node && node.type === 'property') ? <Property>node : null;
	}

	return null;
}


export function getEmbeddedCssNodeIfAny(document: vscode.TextDocument, currentNode: Node | null, position: vscode.Position): Node | undefined {
	if (!currentNode) {
		return;
	}
	const currentHtmlNode = <HtmlNode>currentNode;
	if (currentHtmlNode && currentHtmlNode.close) {
		const innerRange = getInnerRange(currentHtmlNode);
		if (innerRange && innerRange.contains(position)) {
			if (currentHtmlNode.name === 'style'
				&& currentHtmlNode.open.end.isBefore(position)
				&& currentHtmlNode.close.start.isAfter(position)

			) {
				let buffer = new DocumentStreamReader(document, currentHtmlNode.open.end, new vscode.Range(currentHtmlNode.open.end, currentHtmlNode.close.start));
				return parseStylesheet(buffer);
			}
		}
	}
	return;
}

export function isStyleAttribute(currentNode: Node | null, position: vscode.Position): boolean {
	if (!currentNode) {
		return false;
	}
	const currentHtmlNode = <HtmlNode>currentNode;
	const index = (currentHtmlNode.attributes || []).findIndex(x => x.name.toString() === 'style');
	if (index === -1) {
		return false;
	}
	const styleAttribute = currentHtmlNode.attributes[index];
	return position.isAfterOrEqual(styleAttribute.value.start) && position.isBeforeOrEqual(styleAttribute.value.end);
}


export function trimQuotes(s: string) {
	if (s.length <= 1) {
		return s.replace(/['"]/, '');
	}

	if (s[0] === `'` || s[0] === `"`) {
		s = s.slice(1);
	}

	if (s[s.length - 1] === `'` || s[s.length - 1] === `"`) {
		s = s.slice(0, -1);
	}

	return s;
}

export function isNumber(obj: any): obj is number {
	return typeof obj === 'number';
}

export function toLSTextDocument(doc: vscode.TextDocument): LSTextDocument {
	return LSTextDocument.create(doc.uri.toString(), doc.languageId, doc.version, doc.getText());
}
