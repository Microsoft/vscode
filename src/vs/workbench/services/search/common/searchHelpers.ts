/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from 'vs/editor/common/core/range';
import { FindMatch, ITextModel } from 'vs/editor/common/model';
import { ITextSearchPreviewOptions, TextSearchMatch, ITextSearchResult, ITextSearchMatch, ITextQuery, ITextSearchContext } from 'vs/workbench/services/search/common/search';

function editorMatchToTextSearchResult(matches: FindMatch[], model: ITextModel, previewOptions?: ITextSearchPreviewOptions): TextSearchMatch {
	const firstLine = matches[0].range.startLineNumber;
	const lastLine = matches[matches.length - 1].range.endLineNumber;

	const lineTexts: string[] = [];
	for (let i = firstLine; i <= lastLine; i++) {
		lineTexts.push(model.getLineContent(i));
	}

	return new TextSearchMatch(
		lineTexts.join('\n') + '\n',
		matches.map(m => new Range(m.range.startLineNumber - 1, m.range.startColumn - 1, m.range.endLineNumber - 1, m.range.endColumn - 1)),
		previewOptions);
}

/**
 * Combine a set of FindMatches into a set of TextSearchResults. They should be grouped by matches that start on the same line that the previous match ends on.
 */
export function editorMatchesToTextSearchResults(matches: FindMatch[], model: ITextModel, previewOptions?: ITextSearchPreviewOptions): TextSearchMatch[] {
	let previousEndLine = -1;
	const groupedMatches: FindMatch[][] = [];
	let currentMatches: FindMatch[] = [];
	matches.forEach((match) => {
		if (match.range.startLineNumber !== previousEndLine) {
			currentMatches = [];
			groupedMatches.push(currentMatches);
		}

		currentMatches.push(match);
		previousEndLine = match.range.endLineNumber;
	});

	return groupedMatches.map(sameLineMatches => {
		return editorMatchToTextSearchResult(sameLineMatches, model, previewOptions);
	});
}

export function addContextToEditorMatches(matches: ITextSearchMatch[], model: ITextModel, query: ITextQuery): ITextSearchResult[] {
	const results: ITextSearchResult[] = [];

	let prevLine = -1;
	for (let i = 0; i < matches.length; i++) {
		const { start: matchStartLine, end: matchEndLine } = getMatchStartEnd(matches[i]);
		if (typeof query.beforeContext === 'number' && query.beforeContext > 0) {
			const beforeContextStartLine = Math.max(prevLine + 1, matchStartLine - query.beforeContext);
			for (let b = beforeContextStartLine; b < matchStartLine; b++) {
				results.push(<ITextSearchContext>{
					text: model.getLineContent(b + 1),
					lineNumber: b
				});
			}
		}

		results.push(matches[i]);

		const nextMatch = matches[i + 1];
		const nextMatchStartLine = nextMatch ? getMatchStartEnd(nextMatch).start : Number.MAX_VALUE;
		if (typeof query.afterContext === 'number' && query.afterContext > 0) {
			const afterContextToLine = Math.min(nextMatchStartLine - 1, matchEndLine + query.afterContext, model.getLineCount() - 1);
			for (let a = matchEndLine + 1; a <= afterContextToLine; a++) {
				results.push(<ITextSearchContext>{
					text: model.getLineContent(a + 1),
					lineNumber: a
				});
			}
		}

		prevLine = matchEndLine;
	}

	return results;
}

function getMatchStartEnd(match: ITextSearchMatch): { start: number, end: number } {
	const matchRanges = match.ranges;
	const matchStartLine = Array.isArray(matchRanges) ? matchRanges[0].startLineNumber : matchRanges.startLineNumber;
	const matchEndLine = Array.isArray(matchRanges) ? matchRanges[matchRanges.length - 1].endLineNumber : matchRanges.endLineNumber;

	return {
		start: matchStartLine,
		end: matchEndLine
	};
}
