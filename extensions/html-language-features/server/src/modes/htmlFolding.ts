/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument, FoldingRange, Position, Range, LanguageModes, LanguageMode } from './languageModes';
import { CancellationToken } from 'vscode-languageserver';

export async function getFoldingRanges(languageModes: LanguageModes, document: TextDocument, maxRanges: number | undefined, _cancellationToken: CancellationToken | null): Promise<FoldingRange[]> {
	let htmlMode = languageModes.getMode('html');
	let range = Range.create(Position.create(0, 0), Position.create(document.lineCount, 0));
	let result: FoldingRange[] = [];
	if (htmlMode && htmlMode.getFoldingRanges) {
		result.push(... await htmlMode.getFoldingRanges(document));
	}

	// cache folding ranges per mode
	let rangesPerMode: { [mode: string]: FoldingRange[] } = Object.create(null);
	let getRangesForMode = async (mode: LanguageMode) => {
		if (mode.getFoldingRanges) {
			let ranges = rangesPerMode[mode.getId()];
			if (!Array.isArray(ranges)) {
				ranges = await mode.getFoldingRanges(document) || [];
				rangesPerMode[mode.getId()] = ranges;
			}
			return ranges;
		}
		return [];
	};

	let modeRanges = languageModes.getModesInRange(document, range);
	for (let modeRange of modeRanges) {
		let mode = modeRange.mode;
		if (mode && mode !== htmlMode && !modeRange.attributeValue) {
			const ranges = await getRangesForMode(mode);
			result.push(...ranges.filter(r => r.startLine >= modeRange.start.line && r.endLine < modeRange.end.line));
		}
	}
	if (maxRanges && result.length > maxRanges) {
		result = limitRanges(result, maxRanges);
	}
	return result;
}

function limitRanges(ranges: FoldingRange[], maxRanges: number) {
	ranges = ranges.sort((r1, r2) => {
		let diff = r1.startLine - r2.startLine;
		if (diff === 0) {
			diff = r1.endLine - r2.endLine;
		}
		return diff;
	});

	// compute each range's nesting level in 'nestingLevels'.
	// count the number of ranges for each level in 'nestingLevelCounts'
	let top: FoldingRange | undefined = undefined;
	let previous: FoldingRange[] = [];
	let nestingLevels: number[] = [];
	let nestingLevelCounts: number[] = [];

	let setNestingLevel = (index: number, level: number) => {
		nestingLevels[index] = level;
		if (level < 30) {
			nestingLevelCounts[level] = (nestingLevelCounts[level] || 0) + 1;
		}
	};

	// compute nesting levels and sanitize
	for (let i = 0; i < ranges.length; i++) {
		let entry = ranges[i];
		if (!top) {
			top = entry;
			setNestingLevel(i, 0);
		} else {
			if (entry.startLine > top.startLine) {
				if (entry.endLine <= top.endLine) {
					previous.push(top);
					top = entry;
					setNestingLevel(i, previous.length);
				} else if (entry.startLine > top.endLine) {
					do {
						top = previous.pop();
					} while (top && entry.startLine > top.endLine);
					if (top) {
						previous.push(top);
					}
					top = entry;
					setNestingLevel(i, previous.length);
				}
			}
		}
	}
	let entries = 0;
	let maxLevel = 0;
	for (let i = 0; i < nestingLevelCounts.length; i++) {
		let n = nestingLevelCounts[i];
		if (n) {
			if (n + entries > maxRanges) {
				maxLevel = i;
				break;
			}
			entries += n;
		}
	}
	let result = [];
	for (let i = 0; i < ranges.length; i++) {
		let level = nestingLevels[i];
		if (typeof level === 'number') {
			if (level < maxLevel || (level === maxLevel && entries++ < maxRanges)) {
				result.push(ranges[i]);
			}
		}
	}
	return result;
}
