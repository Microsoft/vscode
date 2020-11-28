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

		const blockTokens = getBlockTokensForPosition(tokens, position);

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
		// no children and not on this header line so select content then header
		return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(range, parent));
	}
}

function getBlockTokensForPosition(tokens: Token[], position: vscode.Position): Token[] {
	const enclosingTokens = tokens.filter(token => token.map && (token.map[0] <= position.line && token.map[1] > position.line) && isBlockElement(token));
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
	const linkSelection = createLinkRange(lineText, cursorPosition.character, cursorPosition.line, boldSelection ? boldSelection : italicSelection || parent);
	const inlineCodeBlockSelection = createOtherInlineRange(lineText, cursorPosition.character, cursorPosition.line, false, linkSelection || parent);
	return inlineCodeBlockSelection || linkSelection || boldSelection || italicSelection;
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
	// find closest ** that occurs before cursor position
	let startBold = lineText.substring(0, cursorChar).lastIndexOf('**');

	// find closest ** that occurs after the start **
	const endBoldIndex = lineText.substring(startBold + 2).indexOf('**');
	let endBold = startBold + 2 + lineText.substring(startBold + 2).indexOf('**');

	if (startBold >= 0 && endBoldIndex >= 0 && startBold + 1 < endBold && startBold <= cursorChar && endBold >= cursorChar) {
		const range = new vscode.Range(cursorLine, startBold, cursorLine, endBold + 2);
		// **content cursor content** so select content then ** on both sides
		const contentRange = new vscode.Range(cursorLine, startBold + 2, cursorLine, endBold);
		return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(range, parent));
	} else if (startBold >= 0) {
		// **content**cursor or **content*cursor*
		// find end ** from end of start ** to end of line (since the cursor is within the end stars)
		let adjustedEnd = startBold + 2 + lineText.substring(startBold + 2).indexOf('**');
		startBold = lineText.substring(0, adjustedEnd - 2).lastIndexOf('**');
		if (adjustedEnd >= 0 && cursorChar === adjustedEnd || cursorChar === adjustedEnd + 1) {
			if (lineText.charAt(adjustedEnd + 1) === '*') {
				// *cursor* so need to extend end to include the second *
				adjustedEnd += 1;
			}
			return new vscode.SelectionRange(new vscode.Range(cursorLine, startBold, cursorLine, adjustedEnd + 1), parent);
		}
	} else if (endBold > 0) {
		// cursor**content** or *cursor*content**
		// find start ** from start of string to cursor + 2 (since the cursor is within the start stars)
		const adjustedStart = lineText.substring(0, cursorChar + 2).lastIndexOf('**');
		endBold = adjustedStart + 2 + lineText.substring(adjustedStart + 2).indexOf('**');
		if (adjustedStart >= 0 && adjustedStart === cursorChar || adjustedStart === cursorChar - 1) {
			return new vscode.SelectionRange(new vscode.Range(cursorLine, adjustedStart, cursorLine, endBold + 2), parent);
		}
	}
	return undefined;
}

function createOtherInlineRange(lineText: string, cursorChar: number, cursorLine: number, isItalic: boolean, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined {
	const type = isItalic ? '*' : '`';
	const start = lineText.substring(0, cursorChar + 1).lastIndexOf(type);
	let end = lineText.substring(cursorChar).indexOf(type);

	if (start >= 0 && end >= 0) {
		end += cursorChar;
		// ensure there's no * or ` before end
		const intermediate = lineText.substring(start + 1, end - 1).indexOf(type);
		if (intermediate < 0) {
			const range = new vscode.Range(cursorLine, start, cursorLine, end + 1);
			if (cursorChar > start && cursorChar <= end) {
				// within the content so select content then include the stars or backticks
				const contentRange = new vscode.Range(cursorLine, start + 1, cursorLine, end);
				return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(range, parent));
			} else if (cursorChar === start) {
				return new vscode.SelectionRange(range, parent);
			}
		}
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

		// determine if cursor is on a bracket or paren and if so, return the [content] or (content), skipping over the content range
		const cursorOnType = cursorChar === lineText.indexOf(nearestType) || cursorChar === lineText.indexOf(nearestType) + nearestType.length;

		const contentAndNearestType = new vscode.SelectionRange(new vscode.Range(cursorLine, lineText.indexOf(nearestType), cursorLine, lineText.indexOf(nearestType) + nearestType.length), linkRange);
		const content = new vscode.SelectionRange(new vscode.Range(cursorLine, lineText.indexOf(nearestType) + 1, cursorLine, lineText.indexOf(nearestType) + nearestType.length - 1), contentAndNearestType);
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
