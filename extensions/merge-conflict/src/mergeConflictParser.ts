/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as interfaces from './interfaces';
import { DocumentMergeConflict } from './documentMergeConflict';

const startHeaderMarker = '<<<<<<<';
const commonAncestorsMarker = '|||||||';
const splitterMarker = '=======';
const endFooterMarker = '>>>>>>>';

interface IScanMergedConflict {
	startHeader: vscode.TextLine;
	commonAncestors: vscode.TextLine[];
	splitter?: vscode.TextLine;
	endFooter?: vscode.TextLine;
}

export class MergeConflictParser {

	static scanDocument(document: vscode.TextDocument): interfaces.IDocumentMergeConflict[] {

		// Scan each line in the document, we already know there is at least a <<<<<<< and
		// >>>>>> marker within the document, we need to group these into conflict ranges.
		// We initially build a scan match, that references the lines of the header, splitter
		// and footer. This is then converted into a full descriptor containing all required
		// ranges.

		let currentConflict: IScanMergedConflict | null = null;
		const conflictDescriptors: interfaces.IDocumentMergeConflictDescriptor[] = [];

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i);

			// Ignore empty lines
			if (!line || line.isEmptyOrWhitespace) {
				continue;
			}

			// Is this a start line? <<<<<<<
			if (line.text.startsWith(startHeaderMarker)) {
				if (currentConflict !== null) {
					// Error, we should not see a startMarker before we've seen an endMarker
					currentConflict = null;

					// Give up parsing, anything matched up this to this point will be decorated
					// anything after will not
					break;
				}

				// Create a new conflict starting at this line
				currentConflict = { startHeader: line, commonAncestors: [] };
			}
			// Are we within a conflict block and is this a common ancestors marker? |||||||
			else if (currentConflict && !currentConflict.splitter && line.text.startsWith(commonAncestorsMarker)) {
				currentConflict.commonAncestors.push(line);
			}
			// Are we within a conflict block and is this a splitter? =======
			else if (currentConflict && !currentConflict.splitter && line.text.startsWith(splitterMarker)) {
				currentConflict.splitter = line;
			}
			// Are we within a conflict block and is this a footer? >>>>>>>
			else if (currentConflict && line.text.startsWith(endFooterMarker)) {
				currentConflict.endFooter = line;

				// Create a full descriptor from the lines that we matched. This can return
				// null if the descriptor could not be completed.
				let completeDescriptor = MergeConflictParser.scanItemTolMergeConflictDescriptor(document, currentConflict);

				if (completeDescriptor !== null) {
					conflictDescriptors.push(completeDescriptor);
				}

				// Reset the current conflict to be empty, so we can match the next
				// starting header marker.
				currentConflict = null;
			}
		}

		return conflictDescriptors
			.filter(Boolean)
			.map(descriptor => new DocumentMergeConflict(descriptor));
	}

	private static scanItemTolMergeConflictDescriptor(document: vscode.TextDocument, scanned: IScanMergedConflict): interfaces.IDocumentMergeConflictDescriptor | null {
		// Validate we have all the required lines within the scan item.
		if (!scanned.startHeader || !scanned.splitter || !scanned.endFooter) {
			return null;
		}

		let tokenAfterCurrentBlock: vscode.TextLine = scanned.commonAncestors[0] || scanned.splitter;

		// Assume that descriptor.current.header, descriptor.incoming.header and descriptor.splitter
		// have valid ranges, fill in content and total ranges from these parts.
		// NOTE: We need to shift the decorator range back one character so the splitter does not end up with
		// two decoration colors (current and splitter), if we take the new line from the content into account
		// the decorator will wrap to the next line.
		return {
			current: {
				header: scanned.startHeader.range,
				decoratorContent: new vscode.Range(
					scanned.startHeader.rangeIncludingLineBreak.end,
					MergeConflictParser.shiftBackOneCharacter(document, tokenAfterCurrentBlock.range.start, scanned.startHeader.rangeIncludingLineBreak.end)),
				// Current content is range between header (shifted for linebreak) and splitter or common ancestors mark start
				content: new vscode.Range(
					scanned.startHeader.rangeIncludingLineBreak.end,
					tokenAfterCurrentBlock.range.start),
				name: scanned.startHeader.text.substring(startHeaderMarker.length + 1)
			},
			commonAncestors: scanned.commonAncestors.map((currentTokenLine, index, commonAncestors) => {
				let nextTokenLine = commonAncestors[index + 1] || scanned.splitter;
				return {
					header: currentTokenLine.range,
					decoratorContent: new vscode.Range(
						currentTokenLine.rangeIncludingLineBreak.end,
						MergeConflictParser.shiftBackOneCharacter(document, nextTokenLine.range.start, currentTokenLine.rangeIncludingLineBreak.end)),
					// Each common ancestors block is range between one common ancestors token
					// (shifted for linebreak) and start of next common ancestors token or splitter
					content: new vscode.Range(
						currentTokenLine.rangeIncludingLineBreak.end,
						nextTokenLine.range.start),
					name: currentTokenLine.text.substring(commonAncestorsMarker.length + 1)
				};
			}),
			splitter: scanned.splitter.range,
			incoming: {
				header: scanned.endFooter.range,
				decoratorContent: new vscode.Range(
					scanned.splitter.rangeIncludingLineBreak.end,
					MergeConflictParser.shiftBackOneCharacter(document, scanned.endFooter.range.start, scanned.splitter.rangeIncludingLineBreak.end)),
				// Incoming content is range between splitter (shifted for linebreak) and footer start
				content: new vscode.Range(
					scanned.splitter.rangeIncludingLineBreak.end,
					scanned.endFooter.range.start),
				name: scanned.endFooter.text.substring(endFooterMarker.length + 1)
			},
			// Entire range is between current header start and incoming header end (including line break)
			range: new vscode.Range(scanned.startHeader.range.start, scanned.endFooter.rangeIncludingLineBreak.end)
		};
	}

	static containsConflict(document: vscode.TextDocument): boolean {
		if (!document) {
			return false;
		}

		let text = document.getText();
		return text.includes(startHeaderMarker) && text.includes(endFooterMarker);
	}

	private static shiftBackOneCharacter(document: vscode.TextDocument, range: vscode.Position, unlessEqual: vscode.Position): vscode.Position {
		if (range.isEqual(unlessEqual)) {
			return range;
		}

		let line = range.line;
		let character = range.character - 1;

		if (character < 0) {
			line--;
			character = document.lineAt(line).range.end.character;
		}

		return new vscode.Position(line, character);
	}
}
