/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Token } from 'markdown-it';
import * as vscode from 'vscode';
import { MarkdownEngine } from '../markdownEngine';
import { TableOfContentsProvider, TocEntry } from '../tableOfContentsProvider';

export default class MarkdownSmartSelect implements vscode.SelectionRangeProvider {

	constructor(
		private readonly engine: MarkdownEngine
	) { }

	public async provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[], _token: vscode.CancellationToken): Promise<vscode.SelectionRange[] | undefined> {
		const promises = await Promise.all(positions.map((position) => {
			return this.provideSelectionRange(document, position, _token);
		}));
		return promises.filter(item => item !== undefined) as vscode.SelectionRange[];
	}

	private async provideSelectionRange(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.SelectionRange | undefined> {
		const headerRange = await this.getHeaderSelectionRange(document, position);
		const blockRange = await this.getBlockSelectionRange(document, position, headerRange);
		const inlineRange = await this.getInlineSelectionRange(document, position, blockRange);
		return inlineRange || blockRange || headerRange;
	}
	private async getInlineSelectionRange(document: vscode.TextDocument, position: vscode.Position, blockRange?: vscode.SelectionRange): Promise<vscode.SelectionRange | undefined> {
		return createInlineRange(document, position, blockRange);
	}

	private async getBlockSelectionRange(document: vscode.TextDocument, position: vscode.Position, headerRange?: vscode.SelectionRange): Promise<vscode.SelectionRange | undefined> {

		const tokens = await this.engine.parse(document);

		const blockTokens = getBlockTokensForPosition(tokens, position, headerRange);

		if (blockTokens.length === 0) {
			return undefined;
		}

		let currentRange: vscode.SelectionRange | undefined = headerRange ? headerRange : createBlockRange(blockTokens.shift()!, document, position.line);

		for (let i = 0; i < blockTokens.length; i++) {
			currentRange = createBlockRange(blockTokens[i], document, position.line, currentRange);
		}
		return currentRange;
	}

	private async getHeaderSelectionRange(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.SelectionRange | undefined> {

		const tocProvider = new TableOfContentsProvider(this.engine, document);
		const toc = await tocProvider.getToc();

		const headerInfo = getHeadersForPosition(toc, position);

		const headers = headerInfo.headers;

		let currentRange: vscode.SelectionRange | undefined;

		for (let i = 0; i < headers.length; i++) {
			currentRange = createHeaderRange(headers[i], i === headers.length - 1, headerInfo.headerOnThisLine, currentRange, getFirstChildHeader(document, headers[i], toc));
		}
		return currentRange;
	}
}

function getHeadersForPosition(toc: TocEntry[], position: vscode.Position): { headers: TocEntry[], headerOnThisLine: boolean } {
	const enclosingHeaders = toc.filter(header => header.location.range.start.line <= position.line && header.location.range.end.line >= position.line);
	const sortedHeaders = enclosingHeaders.sort((header1, header2) => (header1.line - position.line) - (header2.line - position.line));
	const onThisLine = toc.find(header => header.line === position.line) !== undefined;
	return {
		headers: sortedHeaders,
		headerOnThisLine: onThisLine
	};
}

function createHeaderRange(header: TocEntry, isClosestHeaderToPosition: boolean, onHeaderLine: boolean, parent?: vscode.SelectionRange, startOfChildRange?: vscode.Position): vscode.SelectionRange | undefined {
	const range = header.location.range;
	const contentRange = new vscode.Range(range.start.translate(1), range.end);
	if (onHeaderLine && isClosestHeaderToPosition && startOfChildRange) {
		// selection was made on this header line, so select header and its content until the start of its first child
		// then all of its content
		return new vscode.SelectionRange(range.with(undefined, startOfChildRange), new vscode.SelectionRange(range, parent));
	} else if (onHeaderLine && isClosestHeaderToPosition) {
		// selection was made on this header line and no children so expand to all of its content
		return new vscode.SelectionRange(range, parent);
	} else if (isClosestHeaderToPosition && startOfChildRange) {
		// selection was made within content and has child so select content
		// of this header then all content then header
		return new vscode.SelectionRange(contentRange.with(undefined, startOfChildRange), new vscode.SelectionRange(contentRange, (new vscode.SelectionRange(range, parent))));
	} else {
		// not on this header line so select content then header
		return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(range, parent));
	}
}

function getBlockTokensForPosition(tokens: Token[], position: vscode.Position, parent?: vscode.SelectionRange): Token[] {
	const enclosingTokens = tokens.filter(token => token.map && (token.map[0] <= position.line && token.map[1] > position.line) && (!parent || (token.map[0] >= parent.range.start.line && token.map[1] <= parent.range.end.line + 1)) && isBlockElement(token));
	if (enclosingTokens.length === 0) {
		return [];
	}
	const sortedTokens = enclosingTokens.sort((token1, token2) => (token2.map[1] - token2.map[0]) - (token1.map[1] - token1.map[0]));
	return sortedTokens;
}

function createBlockRange(block: Token, document: vscode.TextDocument, cursorLine: number, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined {
	if (block.type === 'fence') {
		return createFencedRange(block, cursorLine, document, parent);
	} else {
		let startLine = document.lineAt(block.map[0]).isEmptyOrWhitespace ? block.map[0] + 1 : block.map[0];
		let endLine = startLine === block.map[1] ? block.map[1] : block.map[1] - 1;
		if (block.type === 'paragraph_open' && block.map[1] - block.map[0] === 2) {
			startLine = endLine = cursorLine;
		} else if (isList(block) && document.lineAt(endLine).isEmptyOrWhitespace) {
			endLine = endLine - 1;
		}
		const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text?.length ?? 0);
		if (parent?.range.contains(range) && !parent.range.isEqual(range)) {
			return new vscode.SelectionRange(range, parent);
		} else if (parent?.range.isEqual(range)) {
			return parent;
		} else {
			return new vscode.SelectionRange(range);
		}
	}
}

function createInlineRange(document: vscode.TextDocument, cursorPosition: vscode.Position, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined {
	const lineText = document.lineAt(cursorPosition.line).text;
	const boldSelection = createBoldRange(lineText, cursorPosition.character, cursorPosition.line, parent);
	const italicSelection = createOtherInlineRange(lineText, cursorPosition.character, cursorPosition.line, true, parent);
	let comboSelection: vscode.SelectionRange | undefined;
	if (boldSelection && italicSelection && !boldSelection.range.isEqual(italicSelection.range)) {
		if (boldSelection.range.contains(italicSelection.range)) {
			comboSelection = createOtherInlineRange(lineText, cursorPosition.character, cursorPosition.line, true, boldSelection);
		} else if (italicSelection.range.contains(boldSelection.range)) {
			comboSelection = createBoldRange(lineText, cursorPosition.character, cursorPosition.line, italicSelection);
		}
	}
	const linkSelection = createLinkRange(lineText, cursorPosition.character, cursorPosition.line, comboSelection || boldSelection || italicSelection || parent);
	const inlineCodeBlockSelection = createOtherInlineRange(lineText, cursorPosition.character, cursorPosition.line, false, linkSelection || parent);
	return inlineCodeBlockSelection || linkSelection || comboSelection || boldSelection || italicSelection;
}

function createFencedRange(token: Token, cursorLine: number, document: vscode.TextDocument, parent?: vscode.SelectionRange): vscode.SelectionRange {
	const startLine = token.map[0];
	const endLine = token.map[1] - 1;
	const onFenceLine = cursorLine === startLine || cursorLine === endLine;
	const fenceRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
	const contentRange = endLine - startLine > 2 && !onFenceLine ? new vscode.Range(startLine + 1, 0, endLine - 1, document.lineAt(endLine - 1).text.length) : undefined;
	if (contentRange) {
		return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(fenceRange, parent));
	} else {
		if (parent?.range.isEqual(fenceRange)) {
			return parent;
		} else {
			return new vscode.SelectionRange(fenceRange, parent);
		}
	}
}

function createBoldRange(lineText: string, cursorChar: number, cursorLine: number, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined {
	const regex = /(?:^|(?<=\s))(?:\*\*\s*([^*]+)(?:\*\s*([^*]+)\s*?\*)*([^*]+)\s*?\*\*)/g;
	const matches = [...lineText.matchAll(regex)].filter(match => lineText.indexOf(match[0]) <= cursorChar && lineText.indexOf(match[0]) + match[0].length >= cursorChar);
	if (matches.length > 0) {
		// should only be one match, so select first and index 0 contains the entire match
		const bold = matches[0][0];
		const startIndex = lineText.indexOf(bold);
		const cursorOnStars = cursorChar === startIndex || cursorChar === startIndex + 1 || cursorChar === startIndex + bold.length || cursorChar === startIndex + bold.length - 1;
		const contentAndStars = new vscode.SelectionRange(new vscode.Range(cursorLine, startIndex, cursorLine, startIndex + bold.length), parent);
		const content = new vscode.SelectionRange(new vscode.Range(cursorLine, startIndex + 2, cursorLine, startIndex + bold.length - 2), contentAndStars);
		return cursorOnStars ? contentAndStars : content;
	}
	return undefined;
}

function createOtherInlineRange(lineText: string, cursorChar: number, cursorLine: number, isItalic: boolean, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined {
	const regex = isItalic ? /(?:^|(?<=\s))(?:\*\s*([^*]+)(?:\*\*\s*([^*]+)\s*?\*\*)*([^*]+)\s*?\*)/g : /\`[^\`]*\`/g;
	const matches = [...lineText.matchAll(regex)].filter(match => lineText.indexOf(match[0]) <= cursorChar && lineText.indexOf(match[0]) + match[0].length >= cursorChar);
	if (matches.length > 0) {
		// should only be one match, so select first and index 0 contains the entire match
		const match = matches[0][0];
		const startIndex = lineText.indexOf(match);
		const cursorOnType = cursorChar === startIndex || cursorChar === startIndex + match.length;
		const contentAndType = new vscode.SelectionRange(new vscode.Range(cursorLine, startIndex, cursorLine, startIndex + match.length), parent);
		const content = new vscode.SelectionRange(new vscode.Range(cursorLine, startIndex + 1, cursorLine, startIndex + match.length - 1), contentAndType);
		return cursorOnType ? contentAndType : content;
	}
	return undefined;
}

function createLinkRange(lineText: string, cursorChar: number, cursorLine: number, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined {
	const regex = /(\[[^\(\)]*\])(\([^\[\]]*\))/g;
	const matches = [...lineText.matchAll(regex)].filter(match => lineText.indexOf(match[0]) <= cursorChar && lineText.indexOf(match[0]) + match[0].length > cursorChar);

	if (matches.length > 0) {
		// should only be one match, so select first and index 0 contains the entire match, so match = [text](url)
		const link = matches[0][0];
		const linkRange = new vscode.SelectionRange(new vscode.Range(cursorLine, lineText.indexOf(link), cursorLine, lineText.indexOf(link) + link.length), parent);

		const linkText = matches[0][1];
		const url = matches[0][2];

		// determine if cursor is within [text] or (url) in order to know which should be selected
		const nearestType = cursorChar >= lineText.indexOf(linkText) && cursorChar < lineText.indexOf(linkText) + linkText.length ? linkText : url;

		const indexOfType = lineText.indexOf(nearestType);
		// determine if cursor is on a bracket or paren and if so, return the [content] or (content), skipping over the content range
		const cursorOnType = cursorChar === indexOfType || cursorChar === indexOfType + nearestType.length;

		const contentAndNearestType = new vscode.SelectionRange(new vscode.Range(cursorLine, indexOfType, cursorLine, indexOfType + nearestType.length), linkRange);
		const content = new vscode.SelectionRange(new vscode.Range(cursorLine, indexOfType + 1, cursorLine, indexOfType + nearestType.length - 1), contentAndNearestType);
		return cursorOnType ? contentAndNearestType : content;
	}
	return undefined;
}

function isList(token: Token): boolean {
	return token.type ? ['ordered_list_open', 'list_item_open', 'bullet_list_open'].includes(token.type) : false;
}

function isBlockElement(token: Token): boolean {
	return !['list_item_close', 'paragraph_close', 'bullet_list_close', 'inline', 'heading_close', 'heading_open'].includes(token.type);
}

function getFirstChildHeader(document: vscode.TextDocument, header?: TocEntry, toc?: TocEntry[]): vscode.Position | undefined {
	let childRange: vscode.Position | undefined;
	if (header && toc) {
		let children = toc.filter(t => header.location.range.contains(t.location.range) && t.location.range.start.line > header.location.range.start.line).sort((t1, t2) => t1.line - t2.line);
		if (children.length > 0) {
			childRange = children[0].location.range.start;
			const lineText = document.lineAt(childRange.line - 1).text;
			return childRange ? childRange.translate(-1, lineText.length) : undefined;
		}
	}
	return undefined;
}
