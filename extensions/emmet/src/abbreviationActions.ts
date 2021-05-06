/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { Node, HtmlNode, Rule, Property, Stylesheet } from 'EmmetFlatNode';
import { getEmmetHelper, getFlatNode, getMappingForIncludedLanguages, validate, getEmmetConfiguration, isStyleSheet, getEmmetMode, parsePartialStylesheet, isStyleAttribute, getEmbeddedCssNodeIfAny, allowedMimeTypesInScriptTag, toLSTextDocument, isOffsetInsideOpenOrCloseTag } from './util';
import { getRootNode as parseDocument } from './parseDocument';

const localize = nls.loadMessageBundle();
const trimRegex = /[\u00a0]*[\d#\-\*\u2022]+\.?/;
const hexColorRegex = /^#[\da-fA-F]{0,6}$/;

interface ExpandAbbreviationInput {
	syntax: string;
	abbreviation: string;
	rangeToReplace: vscode.Range;
	textToWrap?: string[];
	filter?: string;
	indent?: string;
	baseIndent?: string;
}

interface PreviewRangesWithContent {
	previewRange: vscode.Range;
	originalRange: vscode.Range;
	originalContent: string;
	textToWrapInPreview: string[];
	baseIndent: string;
}

export async function wrapWithAbbreviation(args: any): Promise<boolean> {
	if (!validate(false)) {
		return false;
	}

	const editor = vscode.window.activeTextEditor!;
	const document = editor.document;

	args = args || {};
	if (!args['language']) {
		args['language'] = document.languageId;
	}
	// we know it's not stylesheet due to the validate(false) call above
	const syntax = getSyntaxFromArgs(args) || 'html';
	const rootNode = parseDocument(document, true);

	const helper = getEmmetHelper();

	const operationRanges = editor.selections.sort((a, b) => a.start.compareTo(b.start)).map(selection => {
		let rangeToReplace: vscode.Range = selection;
		// wrap around the node if the selection falls inside its open or close tag
		{
			let { start, end } = rangeToReplace;

			const startOffset = document.offsetAt(start);
			const startNode = getFlatNode(rootNode, startOffset, true);
			if (startNode && isOffsetInsideOpenOrCloseTag(startNode, startOffset)) {
				start = document.positionAt(startNode.start);
				const nodeEndPosition = document.positionAt(startNode.end);
				end = nodeEndPosition.isAfter(end) ? nodeEndPosition : end;
			}

			const endOffset = document.offsetAt(end);
			const endNode = getFlatNode(rootNode, endOffset, true);
			if (endNode && isOffsetInsideOpenOrCloseTag(endNode, endOffset)) {
				const nodeStartPosition = document.positionAt(endNode.start);
				start = nodeStartPosition.isBefore(start) ? nodeStartPosition : start;
				const nodeEndPosition = document.positionAt(endNode.end);
				end = nodeEndPosition.isAfter(end) ? nodeEndPosition : end;
			}

			rangeToReplace = new vscode.Range(start, end);
		}
		// in case of multi-line, exclude last empty line from rangeToReplace
		if (!rangeToReplace.isSingleLine && rangeToReplace.end.character === 0) {
			const previousLine = rangeToReplace.end.line - 1;
			rangeToReplace = new vscode.Range(rangeToReplace.start, document.lineAt(previousLine).range.end);
		}
		// wrap line the cursor is on
		if (rangeToReplace.isEmpty) {
			rangeToReplace = document.lineAt(rangeToReplace.start).range;
		}

		// ignore whitespace on the first line
		const firstLineOfRange = document.lineAt(rangeToReplace.start);
		if (!firstLineOfRange.isEmptyOrWhitespace && firstLineOfRange.firstNonWhitespaceCharacterIndex > rangeToReplace.start.character) {
			rangeToReplace = rangeToReplace.with(new vscode.Position(rangeToReplace.start.line, firstLineOfRange.firstNonWhitespaceCharacterIndex));
		}

		return rangeToReplace;
	}).reduce((mergedRanges, range) => {
		// Merge overlapping ranges
		if (mergedRanges.length > 0 && range.intersection(mergedRanges[mergedRanges.length - 1])) {
			mergedRanges.push(range.union(mergedRanges.pop()!));
		} else {
			mergedRanges.push(range);
		}
		return mergedRanges;
	}, [] as vscode.Range[]);

	// Backup orginal selections and update selections
	// Also helps with https://github.com/microsoft/vscode/issues/113930 by avoiding `editor.linkedEditing`
	// execution if selection is inside an open or close tag
	const oldSelections = editor.selections;
	editor.selections = operationRanges.map(range => new vscode.Selection(range.start, range.end));

	// Fetch general information for the succesive expansions. i.e. the ranges to replace and its contents
	const rangesToReplace: PreviewRangesWithContent[] = operationRanges.map(rangeToReplace => {
		let textToWrapInPreview: string[];
		const textToReplace = document.getText(rangeToReplace);

		// the following assumes all the lines are indented the same way as the first
		// this assumption helps with applyPreview later
		const wholeFirstLine = document.lineAt(rangeToReplace.start).text;
		const otherMatches = wholeFirstLine.match(/^(\s*)/);
		const baseIndent = otherMatches ? otherMatches[1] : '';
		textToWrapInPreview = rangeToReplace.isSingleLine ?
			[textToReplace] :
			textToReplace.split('\n' + baseIndent).map(x => x.trimEnd());

		// escape $ characters, fixes #52640
		textToWrapInPreview = textToWrapInPreview.map(e => e.replace(/(\$\d)/g, '\\$1'));

		return {
			previewRange: rangeToReplace,
			originalRange: rangeToReplace,
			originalContent: textToReplace,
			textToWrapInPreview,
			baseIndent
		};
	});

	const { tabSize, insertSpaces } = editor.options;
	const indent = insertSpaces ? ' '.repeat(tabSize as number) : '\t';

	function revertPreview(): Thenable<boolean> {
		return editor.edit(builder => {
			for (const rangeToReplace of rangesToReplace) {
				builder.replace(rangeToReplace.previewRange, rangeToReplace.originalContent);
				rangeToReplace.previewRange = rangeToReplace.originalRange;
			}
		}, { undoStopBefore: false, undoStopAfter: false });
	}

	function applyPreview(expandAbbrList: ExpandAbbreviationInput[]): Thenable<boolean> {
		let lastOldPreviewRange = new vscode.Range(0, 0, 0, 0);
		let lastNewPreviewRange = new vscode.Range(0, 0, 0, 0);
		let totalNewLinesInserted = 0;

		return editor.edit(builder => {
			// the edits are applied in order top-down
			for (let i = 0; i < rangesToReplace.length; i++) {
				const expandedText = expandAbbr(expandAbbrList[i]) || '';
				if (!expandedText) {
					// Failed to expand text. We already showed an error inside expandAbbr.
					break;
				}

				// get the current preview range, format the new wrapped text, and then replace
				// the text in the preview range with that new text
				const oldPreviewRange = rangesToReplace[i].previewRange;
				const newText = expandedText
					.replace(/\$\{[\d]*\}/g, '|') // Removing Tabstops
					.replace(/\$\{[\d]*:([^}]*)\}/g, (_, placeholder) => placeholder) // Replacing Placeholders
					.replace(/\\\$/g, '$'); // Remove backslashes before $
				builder.replace(oldPreviewRange, newText);

				// calculate the new preview range to use for future previews
				// we also have to take into account that the previous expansions could:
				// - cause new lines to appear
				// - be on the same line as other expansions
				const expandedTextLines = newText.split('\n');
				const oldPreviewLines = oldPreviewRange.end.line - oldPreviewRange.start.line + 1;
				const newLinesInserted = expandedTextLines.length - oldPreviewLines;

				const newPreviewLineStart = oldPreviewRange.start.line + totalNewLinesInserted;
				let newPreviewStart = oldPreviewRange.start.character;
				const newPreviewLineEnd = oldPreviewRange.end.line + totalNewLinesInserted + newLinesInserted;
				let newPreviewEnd = expandedTextLines[expandedTextLines.length - 1].length;
				if (i > 0 && newPreviewLineEnd === lastNewPreviewRange.end.line) {
					// If newPreviewLineEnd is equal to the previous expandedText lineEnd,
					// set newPreviewStart to the length of the previous expandedText in that line
					// plus the number of characters between both selections.
					newPreviewStart = lastNewPreviewRange.end.character + (oldPreviewRange.start.character - lastOldPreviewRange.end.character);
					newPreviewEnd += newPreviewStart;
				} else if (i > 0 && newPreviewLineStart === lastNewPreviewRange.end.line) {
					// Same as above but expandedTextLines.length > 1 so newPreviewEnd keeps its value.
					newPreviewStart = lastNewPreviewRange.end.character + (oldPreviewRange.start.character - lastOldPreviewRange.end.character);
				} else if (expandedTextLines.length === 1) {
					// If the expandedText is single line, add the length of preceeding text as it will not be included in line length.
					newPreviewEnd += oldPreviewRange.start.character;
				}

				lastOldPreviewRange = rangesToReplace[i].previewRange;
				lastNewPreviewRange = new vscode.Range(newPreviewLineStart, newPreviewStart, newPreviewLineEnd, newPreviewEnd);
				rangesToReplace[i].previewRange = lastNewPreviewRange;
				totalNewLinesInserted += newLinesInserted;
			}
		}, { undoStopBefore: false, undoStopAfter: false });
	}

	let inPreviewMode = false;
	async function makeChanges(inputAbbreviation: string | undefined, previewChanges: boolean): Promise<boolean> {
		const isAbbreviationValid = !!inputAbbreviation && !!inputAbbreviation.trim() && helper.isAbbreviationValid(syntax, inputAbbreviation);
		const extractedResults = isAbbreviationValid ? helper.extractAbbreviationFromText(inputAbbreviation!, syntax) : undefined;
		if (!extractedResults) {
			if (inPreviewMode) {
				inPreviewMode = false;
				await revertPreview();
			}
			return false;
		}

		const { abbreviation, filter } = extractedResults;
		if (abbreviation !== inputAbbreviation) {
			// Not clear what should we do in this case. Warn the user? How?
		}

		if (previewChanges) {
			const expandAbbrList: ExpandAbbreviationInput[] = rangesToReplace.map(rangesAndContent =>
				({ syntax, abbreviation, rangeToReplace: rangesAndContent.originalRange, textToWrap: rangesAndContent.textToWrapInPreview, filter, indent, baseIndent: rangesAndContent.baseIndent })
			);

			inPreviewMode = true;
			return applyPreview(expandAbbrList);
		}

		const expandAbbrList: ExpandAbbreviationInput[] = rangesToReplace.map(rangesAndContent =>
			({ syntax, abbreviation, rangeToReplace: rangesAndContent.originalRange, textToWrap: rangesAndContent.textToWrapInPreview, filter, indent })
		);

		if (inPreviewMode) {
			inPreviewMode = false;
			await revertPreview();
		}

		return expandAbbreviationInRange(editor, expandAbbrList, false);
	}

	let currentValue = '';
	function inputChanged(value: string): string {
		if (value !== currentValue) {
			currentValue = value;
			makeChanges(value, true);
		}
		return '';
	}

	const prompt = localize('wrapWithAbbreviationPrompt', "Enter Abbreviation");
	const inputAbbreviation = (args && args['abbreviation'])
		? (args['abbreviation'] as string)
		: await vscode.window.showInputBox({ prompt, validateInput: inputChanged });

	const changesWereMade = await makeChanges(inputAbbreviation, false);
	if (!changesWereMade) {
		editor.selections = oldSelections;
	}

	return changesWereMade;
}

export function expandEmmetAbbreviation(args: any): Thenable<boolean | undefined> {
	if (!validate() || !vscode.window.activeTextEditor) {
		return fallbackTab();
	}

	/**
	 * Short circuit the parsing. If previous character is space, do not expand.
	 */
	if (vscode.window.activeTextEditor.selections.length === 1 &&
		vscode.window.activeTextEditor.selection.isEmpty
	) {
		const anchor = vscode.window.activeTextEditor.selection.anchor;
		if (anchor.character === 0) {
			return fallbackTab();
		}

		const prevPositionAnchor = anchor.translate(0, -1);
		const prevText = vscode.window.activeTextEditor.document.getText(new vscode.Range(prevPositionAnchor, anchor));
		if (prevText === ' ' || prevText === '\t') {
			return fallbackTab();
		}
	}

	args = args || {};
	if (!args['language']) {
		args['language'] = vscode.window.activeTextEditor.document.languageId;
	} else {
		const excludedLanguages = vscode.workspace.getConfiguration('emmet')['excludeLanguages'] ? vscode.workspace.getConfiguration('emmet')['excludeLanguages'] : [];
		if (excludedLanguages.indexOf(vscode.window.activeTextEditor.document.languageId) > -1) {
			return fallbackTab();
		}
	}
	const syntax = getSyntaxFromArgs(args);
	if (!syntax) {
		return fallbackTab();
	}

	const editor = vscode.window.activeTextEditor;

	// When tabbed on a non empty selection, do not treat it as an emmet abbreviation, and fallback to tab instead
	if (vscode.workspace.getConfiguration('emmet')['triggerExpansionOnTab'] === true && editor.selections.find(x => !x.isEmpty)) {
		return fallbackTab();
	}

	const abbreviationList: ExpandAbbreviationInput[] = [];
	let firstAbbreviation: string;
	let allAbbreviationsSame: boolean = true;
	const helper = getEmmetHelper();

	const getAbbreviation = (document: vscode.TextDocument, selection: vscode.Selection, position: vscode.Position, syntax: string): [vscode.Range | null, string, string | undefined] => {
		position = document.validatePosition(position);
		let rangeToReplace: vscode.Range = selection;
		let abbr = document.getText(rangeToReplace);
		if (!rangeToReplace.isEmpty) {
			const extractedResults = helper.extractAbbreviationFromText(abbr, syntax);
			if (extractedResults) {
				return [rangeToReplace, extractedResults.abbreviation, extractedResults.filter];
			}
			return [null, '', ''];
		}

		const currentLine = editor.document.lineAt(position.line).text;
		const textTillPosition = currentLine.substr(0, position.character);

		// Expand cases like <div to <div></div> explicitly
		// else we will end up with <<div></div>
		if (syntax === 'html') {
			const matches = textTillPosition.match(/<(\w+)$/);
			if (matches) {
				abbr = matches[1];
				rangeToReplace = new vscode.Range(position.translate(0, -(abbr.length + 1)), position);
				return [rangeToReplace, abbr, ''];
			}
		}
		const extractedResults = helper.extractAbbreviation(toLSTextDocument(editor.document), position, { lookAhead: false });
		if (!extractedResults) {
			return [null, '', ''];
		}

		const { abbreviationRange, abbreviation, filter } = extractedResults;
		return [new vscode.Range(abbreviationRange.start.line, abbreviationRange.start.character, abbreviationRange.end.line, abbreviationRange.end.character), abbreviation, filter];
	};

	const selectionsInReverseOrder = editor.selections.slice(0);
	selectionsInReverseOrder.sort((a, b) => {
		const posA = a.isReversed ? a.anchor : a.active;
		const posB = b.isReversed ? b.anchor : b.active;
		return posA.compareTo(posB) * -1;
	});

	let rootNode: Node | undefined;
	function getRootNode() {
		if (rootNode) {
			return rootNode;
		}

		const usePartialParsing = vscode.workspace.getConfiguration('emmet')['optimizeStylesheetParsing'] === true;
		if (editor.selections.length === 1 && isStyleSheet(editor.document.languageId) && usePartialParsing && editor.document.lineCount > 1000) {
			rootNode = parsePartialStylesheet(editor.document, editor.selection.isReversed ? editor.selection.anchor : editor.selection.active);
		} else {
			rootNode = parseDocument(editor.document, true);
		}

		return rootNode;
	}

	selectionsInReverseOrder.forEach(selection => {
		const position = selection.isReversed ? selection.anchor : selection.active;
		const [rangeToReplace, abbreviation, filter] = getAbbreviation(editor.document, selection, position, syntax);
		if (!rangeToReplace) {
			return;
		}
		if (!helper.isAbbreviationValid(syntax, abbreviation)) {
			return;
		}
		if (isStyleSheet(syntax) && abbreviation.endsWith(':')) {
			// Fix for https://github.com/Microsoft/vscode/issues/1623
			return;
		}

		const offset = editor.document.offsetAt(position);
		let currentNode = getFlatNode(getRootNode(), offset, true);
		let validateLocation = true;
		let syntaxToUse = syntax;

		if (editor.document.languageId === 'html') {
			if (isStyleAttribute(currentNode, offset)) {
				syntaxToUse = 'css';
				validateLocation = false;
			} else {
				const embeddedCssNode = getEmbeddedCssNodeIfAny(editor.document, currentNode, position);
				if (embeddedCssNode) {
					currentNode = getFlatNode(embeddedCssNode, offset, true);
					syntaxToUse = 'css';
				}
			}
		}

		if (validateLocation && !isValidLocationForEmmetAbbreviation(editor.document, getRootNode(), currentNode, syntaxToUse, offset, rangeToReplace)) {
			return;
		}

		if (!firstAbbreviation) {
			firstAbbreviation = abbreviation;
		} else if (allAbbreviationsSame && firstAbbreviation !== abbreviation) {
			allAbbreviationsSame = false;
		}

		abbreviationList.push({ syntax: syntaxToUse, abbreviation, rangeToReplace, filter });
	});

	return expandAbbreviationInRange(editor, abbreviationList, allAbbreviationsSame).then(success => {
		return success ? Promise.resolve(undefined) : fallbackTab();
	});
}

function fallbackTab(): Thenable<boolean | undefined> {
	if (vscode.workspace.getConfiguration('emmet')['triggerExpansionOnTab'] === true) {
		return vscode.commands.executeCommand('tab');
	}
	return Promise.resolve(true);
}
/**
 * Checks if given position is a valid location to expand emmet abbreviation.
 * Works only on html and css/less/scss syntax
 * @param document current Text Document
 * @param rootNode parsed document
 * @param currentNode current node in the parsed document
 * @param syntax syntax of the abbreviation
 * @param position position to validate
 * @param abbreviationRange The range of the abbreviation for which given position is being validated
 */
export function isValidLocationForEmmetAbbreviation(document: vscode.TextDocument, rootNode: Node | undefined, currentNode: Node | undefined, syntax: string, offset: number, abbreviationRange: vscode.Range): boolean {
	if (isStyleSheet(syntax)) {
		const stylesheet = <Stylesheet>rootNode;
		if (stylesheet && (stylesheet.comments || []).some(x => offset >= x.start && offset <= x.end)) {
			return false;
		}
		// Continue validation only if the file was parse-able and the currentNode has been found
		if (!currentNode) {
			return true;
		}

		// Get the abbreviation right now
		// Fixes https://github.com/microsoft/vscode/issues/74505
		// Stylesheet abbreviations starting with @ should bring up suggestions
		// even at outer-most level
		const abbreviation = document.getText(new vscode.Range(abbreviationRange.start.line, abbreviationRange.start.character, abbreviationRange.end.line, abbreviationRange.end.character));
		if (abbreviation.startsWith('@')) {
			return true;
		}

		// Fix for https://github.com/microsoft/vscode/issues/34162
		// Other than sass, stylus, we can make use of the terminator tokens to validate position
		if (syntax !== 'sass' && syntax !== 'stylus' && currentNode.type === 'property') {
			// Fix for upstream issue https://github.com/emmetio/css-parser/issues/3
			if (currentNode.parent
				&& currentNode.parent.type !== 'rule'
				&& currentNode.parent.type !== 'at-rule') {
				return false;
			}

			const propertyNode = <Property>currentNode;
			if (propertyNode.terminatorToken
				&& propertyNode.separator
				&& offset >= propertyNode.separatorToken.end
				&& offset <= propertyNode.terminatorToken.start
				&& abbreviation.indexOf(':') === -1) {
				return hexColorRegex.test(abbreviation) || abbreviation === '!';
			}
			if (!propertyNode.terminatorToken
				&& propertyNode.separator
				&& offset >= propertyNode.separatorToken.end
				&& abbreviation.indexOf(':') === -1) {
				return hexColorRegex.test(abbreviation) || abbreviation === '!';
			}
			if (hexColorRegex.test(abbreviation) || abbreviation === '!') {
				return false;
			}
		}

		// If current node is a rule or at-rule, then perform additional checks to ensure
		// emmet suggestions are not provided in the rule selector
		if (currentNode.type !== 'rule' && currentNode.type !== 'at-rule') {
			return true;
		}

		const currentCssNode = <Rule>currentNode;

		// Position is valid if it occurs after the `{` that marks beginning of rule contents
		if (offset > currentCssNode.contentStartToken.end) {
			return true;
		}

		// Workaround for https://github.com/microsoft/vscode/30188
		// The line above the rule selector is considered as part of the selector by the css-parser
		// But we should assume it is a valid location for css properties under the parent rule
		if (currentCssNode.parent
			&& (currentCssNode.parent.type === 'rule' || currentCssNode.parent.type === 'at-rule')
			&& currentCssNode.selectorToken) {
			const position = document.positionAt(offset);
			const tokenStartPos = document.positionAt(currentCssNode.selectorToken.start);
			const tokenEndPos = document.positionAt(currentCssNode.selectorToken.end);
			if (position.line !== tokenEndPos.line
				&& tokenStartPos.character === abbreviationRange.start.character
				&& tokenStartPos.line === abbreviationRange.start.line
			) {
				return true;
			}
		}

		return false;
	}

	const startAngle = '<';
	const endAngle = '>';
	const escape = '\\';
	const question = '?';
	const currentHtmlNode = <HtmlNode>currentNode;
	let start = 0;

	if (currentHtmlNode) {
		if (currentHtmlNode.name === 'script') {
			const typeAttribute = (currentHtmlNode.attributes || []).filter(x => x.name.toString() === 'type')[0];
			const typeValue = typeAttribute ? typeAttribute.value.toString() : '';

			if (allowedMimeTypesInScriptTag.indexOf(typeValue) > -1) {
				return true;
			}

			const isScriptJavascriptType = !typeValue || typeValue === 'application/javascript' || typeValue === 'text/javascript';
			if (isScriptJavascriptType) {
				return !!getSyntaxFromArgs({ language: 'javascript' });
			}
			return false;
		}

		// Fix for https://github.com/microsoft/vscode/issues/28829
		if (!currentHtmlNode.open || !currentHtmlNode.close ||
			!(currentHtmlNode.open.end <= offset && offset <= currentHtmlNode.close.start)) {
			return false;
		}

		// Fix for https://github.com/microsoft/vscode/issues/35128
		// Find the position up till where we will backtrack looking for unescaped < or >
		// to decide if current position is valid for emmet expansion
		start = currentHtmlNode.open.end;
		let lastChildBeforePosition = currentHtmlNode.firstChild;
		while (lastChildBeforePosition) {
			if (lastChildBeforePosition.end > offset) {
				break;
			}
			start = lastChildBeforePosition.end;
			lastChildBeforePosition = lastChildBeforePosition.nextSibling;
		}
	}
	const startPos = document.positionAt(start);
	let textToBackTrack = document.getText(new vscode.Range(startPos.line, startPos.character, abbreviationRange.start.line, abbreviationRange.start.character));

	// Worse case scenario is when cursor is inside a big chunk of text which needs to backtracked
	// Backtrack only 500 offsets to ensure we dont waste time doing this
	if (textToBackTrack.length > 500) {
		textToBackTrack = textToBackTrack.substr(textToBackTrack.length - 500);
	}

	if (!textToBackTrack.trim()) {
		return true;
	}

	let valid = true;
	let foundSpace = false; // If < is found before finding whitespace, then its valid abbreviation. E.g.: <div|
	let i = textToBackTrack.length - 1;
	if (textToBackTrack[i] === startAngle) {
		return false;
	}

	while (i >= 0) {
		const char = textToBackTrack[i];
		i--;
		if (!foundSpace && /\s/.test(char)) {
			foundSpace = true;
			continue;
		}
		if (char === question && textToBackTrack[i] === startAngle) {
			i--;
			continue;
		}
		// Fix for https://github.com/microsoft/vscode/issues/55411
		// A space is not a valid character right after < in a tag name.
		if (/\s/.test(char) && textToBackTrack[i] === startAngle) {
			i--;
			continue;
		}
		if (char !== startAngle && char !== endAngle) {
			continue;
		}
		if (i >= 0 && textToBackTrack[i] === escape) {
			i--;
			continue;
		}
		if (char === endAngle) {
			if (i >= 0 && textToBackTrack[i] === '=') {
				continue; // False alarm of cases like =>
			} else {
				break;
			}
		}
		if (char === startAngle) {
			valid = !foundSpace;
			break;
		}
	}

	return valid;
}

/**
 * Expands abbreviations as detailed in expandAbbrList in the editor
 *
 * @returns false if no snippet can be inserted.
 */
function expandAbbreviationInRange(editor: vscode.TextEditor, expandAbbrList: ExpandAbbreviationInput[], insertSameSnippet: boolean): Thenable<boolean> {
	if (!expandAbbrList || expandAbbrList.length === 0) {
		return Promise.resolve(false);
	}

	// Snippet to replace at multiple cursors are not the same
	// `editor.insertSnippet` will have to be called for each instance separately
	// We will not be able to maintain multiple cursors after snippet insertion
	const insertPromises: Thenable<boolean>[] = [];
	if (!insertSameSnippet) {
		expandAbbrList.sort((a: ExpandAbbreviationInput, b: ExpandAbbreviationInput) => { return b.rangeToReplace.start.compareTo(a.rangeToReplace.start); }).forEach((expandAbbrInput: ExpandAbbreviationInput) => {
			const expandedText = expandAbbr(expandAbbrInput);
			if (expandedText) {
				insertPromises.push(editor.insertSnippet(new vscode.SnippetString(expandedText), expandAbbrInput.rangeToReplace, { undoStopBefore: false, undoStopAfter: false }));
			}
		});
		if (insertPromises.length === 0) {
			return Promise.resolve(false);
		}
		return Promise.all(insertPromises).then(() => Promise.resolve(true));
	}

	// Snippet to replace at all cursors are the same
	// We can pass all ranges to `editor.insertSnippet` in a single call so that
	// all cursors are maintained after snippet insertion
	const anyExpandAbbrInput = expandAbbrList[0];
	const expandedText = expandAbbr(anyExpandAbbrInput);
	const allRanges = expandAbbrList.map(value => value.rangeToReplace);
	if (expandedText) {
		return editor.insertSnippet(new vscode.SnippetString(expandedText), allRanges);
	}
	return Promise.resolve(false);
}

/**
 * Expands abbreviation as detailed in given input.
 */
function expandAbbr(input: ExpandAbbreviationInput): string | undefined {
	const helper = getEmmetHelper();
	const expandOptions = helper.getExpandOptions(input.syntax, getEmmetConfiguration(input.syntax), input.filter);

	if (input.textToWrap) {
		// escape ${ sections, fixes #122231
		input.textToWrap = input.textToWrap.map(e => e.replace(/\$\{/g, '\\\$\{'));
		if (input.filter && input.filter.includes('t')) {
			input.textToWrap = input.textToWrap.map(line => {
				return line.replace(trimRegex, '').trim();
			});
		}
		expandOptions['text'] = input.textToWrap;

		if (expandOptions.options) {
			// Below fixes https://github.com/microsoft/vscode/issues/29898
			// With this, Emmet formats inline elements as block elements
			// ensuring the wrapped multi line text does not get merged to a single line
			if (!input.rangeToReplace.isSingleLine) {
				expandOptions.options['output.inlineBreak'] = 1;
			}

			if (input.indent) {
				expandOptions.options['output.indent'] = input.indent;
			}
			if (input.baseIndent) {
				expandOptions.options['output.baseIndent'] = input.baseIndent;
			}
		}
	}

	let expandedText: string | undefined;
	try {
		expandedText = helper.expandAbbreviation(input.abbreviation, expandOptions);
	} catch (e) {
		vscode.window.showErrorMessage('Failed to expand abbreviation');
	}

	return expandedText;
}

export function getSyntaxFromArgs(args: { [x: string]: string }): string | undefined {
	const mappedModes = getMappingForIncludedLanguages();
	const language: string = args['language'];
	const parentMode: string = args['parentMode'];
	const excludedLanguages = vscode.workspace.getConfiguration('emmet')['excludeLanguages'] ? vscode.workspace.getConfiguration('emmet')['excludeLanguages'] : [];
	if (excludedLanguages.indexOf(language) > -1) {
		return;
	}

	let syntax = getEmmetMode((mappedModes[language] ? mappedModes[language] : language), excludedLanguages);
	if (!syntax) {
		syntax = getEmmetMode((mappedModes[parentMode] ? mappedModes[parentMode] : parentMode), excludedLanguages);
	}

	return syntax;
}
