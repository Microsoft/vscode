/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mapArrayOrNot } from 'vs/base/common/arrays';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { SearchRange, TextSearchMatch } from 'vs/workbench/services/search/common/search';
import * as searchExtTypes from 'vs/workbench/services/search/common/searchExtTypes';

export type Maybe<T> = T | null | undefined;

export function anchorGlob(glob: string): string {
	return glob.startsWith('**') || glob.startsWith('/') ? glob : `/${glob}`;
}

/**
 * Create a vscode.TextSearchMatch by using our internal TextSearchMatch type for its previewOptions logic.
 */
export function createTextSearchResult(uri: URI, text: string, range: searchExtTypes.Range | searchExtTypes.Range[], previewOptions?: searchExtTypes.TextSearchPreviewOptions): searchExtTypes.TextSearchMatch {
	const searchRange = mapArrayOrNot(range, rangeToSearchRange);

	const internalResult = new TextSearchMatch(text, searchRange, previewOptions);
	const internalPreviewRange = internalResult.preview.matches;
	return {
		ranges: mapArrayOrNot(searchRange, searchRangeToRange),
		uri,
		preview: {
			text: internalResult.preview.text,
			matches: mapArrayOrNot(internalPreviewRange, searchRangeToRange)
		}
	};
}

function rangeToSearchRange(range: searchExtTypes.Range): SearchRange {
	return new SearchRange(range.start.line, range.start.character, range.end.line, range.end.character);
}

function searchRangeToRange(range: SearchRange): searchExtTypes.Range {
	return new searchExtTypes.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
}

export interface IOutputChannel {
	appendLine(msg: string): void;
}

export class OutputChannel implements IOutputChannel {
	constructor(@ILogService private readonly logService: ILogService) { }

	appendLine(msg: string): void {
		this.logService.debug('RipgrepSearchEH#search', msg);
	}
}
