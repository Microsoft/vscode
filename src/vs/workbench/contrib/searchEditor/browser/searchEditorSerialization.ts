/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, flatten } from 'vs/base/common/arrays';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/searchEditor';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Range } from 'vs/editor/common/core/range';
import type { ITextModel } from 'vs/editor/common/model';
import { localize } from 'vs/nls';
import { FileMatch, Match, searchMatchComparer, SearchResult, FolderMatch } from 'vs/workbench/contrib/search/common/searchModel';
import type { SearchConfiguration } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { ITextQuery, SearchSortOrder } from 'vs/workbench/services/search/common/search';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';

// Using \r\n on Windows inserts an extra newline between results.
const lineDelimiter = '\n';

const translateRangeLines =
	(n: number) =>
		(range: Range) =>
			new Range(range.startLineNumber + n, range.startColumn, range.endLineNumber + n, range.endColumn);

const matchToSearchResultFormat = (match: Match, longestLineNumber: number): { line: string, ranges: Range[], lineNumber: string }[] => {
	const getLinePrefix = (i: number) => `${match.range().startLineNumber + i}`;

	const fullMatchLines = match.fullPreviewLines();


	const results: { line: string, ranges: Range[], lineNumber: string }[] = [];

	fullMatchLines
		.forEach((sourceLine, i) => {
			const lineNumber = getLinePrefix(i);
			const paddingStr = ' '.repeat(longestLineNumber - lineNumber.length);
			const prefix = `  ${paddingStr}${lineNumber}: `;
			const prefixOffset = prefix.length;

			const line = (prefix + sourceLine).replace(/\r?\n?$/, '');

			const rangeOnThisLine = ({ start, end }: { start?: number; end?: number; }) => new Range(1, (start ?? 1) + prefixOffset, 1, (end ?? sourceLine.length + 1) + prefixOffset);

			const matchRange = match.rangeInPreview();
			const matchIsSingleLine = matchRange.startLineNumber === matchRange.endLineNumber;

			let lineRange;
			if (matchIsSingleLine) { lineRange = (rangeOnThisLine({ start: matchRange.startColumn, end: matchRange.endColumn })); }
			else if (i === 0) { lineRange = (rangeOnThisLine({ start: matchRange.startColumn })); }
			else if (i === fullMatchLines.length - 1) { lineRange = (rangeOnThisLine({ end: matchRange.endColumn })); }
			else { lineRange = (rangeOnThisLine({})); }

			results.push({ lineNumber: lineNumber, line, ranges: [lineRange] });
		});

	return results;
};

type SearchResultSerialization = { text: string[], matchRanges: Range[] };

function fileMatchToSearchResultFormat(fileMatch: FileMatch, labelFormatter: (x: URI) => string): SearchResultSerialization {
	const sortedMatches = fileMatch.matches().sort(searchMatchComparer);
	const longestLineNumber = sortedMatches[sortedMatches.length - 1].range().endLineNumber.toString().length;
	const serializedMatches = flatten(sortedMatches.map(match => matchToSearchResultFormat(match, longestLineNumber)));

	const uriString = labelFormatter(fileMatch.resource);
	const text: string[] = [`${uriString}:`];
	const matchRanges: Range[] = [];

	const targetLineNumberToOffset: Record<string, number> = {};

	const context: { line: string, lineNumber: number }[] = [];
	fileMatch.context.forEach((line, lineNumber) => context.push({ line, lineNumber }));
	context.sort((a, b) => a.lineNumber - b.lineNumber);

	let lastLine: number | undefined = undefined;

	const seenLines = new Set<string>();
	serializedMatches.forEach(match => {
		if (!seenLines.has(match.line)) {
			while (context.length && context[0].lineNumber < +match.lineNumber) {
				const { line, lineNumber } = context.shift()!;
				if (lastLine !== undefined && lineNumber !== lastLine + 1) {
					text.push('');
				}
				text.push(`  ${' '.repeat(longestLineNumber - `${lineNumber}`.length)}${lineNumber}  ${line}`);
				lastLine = lineNumber;
			}

			targetLineNumberToOffset[match.lineNumber] = text.length;
			seenLines.add(match.line);
			text.push(match.line);
			lastLine = +match.lineNumber;
		}

		matchRanges.push(...match.ranges.map(translateRangeLines(targetLineNumberToOffset[match.lineNumber])));
	});

	while (context.length) {
		const { line, lineNumber } = context.shift()!;
		text.push(`  ${lineNumber}  ${line}`);
	}

	return { text, matchRanges };
}

const contentPatternToSearchConfiguration = (pattern: ITextQuery, includes: string, excludes: string, contextLines: number): SearchConfiguration => {
	return {
		query: pattern.contentPattern.pattern,
		isRegexp: !!pattern.contentPattern.isRegExp,
		isCaseSensitive: !!pattern.contentPattern.isCaseSensitive,
		matchWholeWord: !!pattern.contentPattern.isWordMatch,
		filesToExclude: excludes, filesToInclude: includes,
		showIncludesExcludes: !!(includes || excludes || pattern?.userDisabledExcludesAndIgnoreFiles),
		useExcludeSettingsAndIgnoreFiles: (pattern?.userDisabledExcludesAndIgnoreFiles === undefined ? true : !pattern.userDisabledExcludesAndIgnoreFiles),
		contextLines,
		onlyOpenEditors: !!pattern.onlyOpenEditors,
	};
};

export const serializeSearchConfiguration = (config: Partial<SearchConfiguration>): string => {
	const removeNullFalseAndUndefined = <T>(a: (T | null | false | undefined)[]) => a.filter(a => a !== false && a !== null && a !== undefined) as T[];

	const escapeNewlines = (str: string) => str.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

	return removeNullFalseAndUndefined([
		`# Query: ${escapeNewlines(config.query ?? '')}`,

		(config.isCaseSensitive || config.matchWholeWord || config.isRegexp || config.useExcludeSettingsAndIgnoreFiles === false)
		&& `# Flags: ${coalesce([
			config.isCaseSensitive && 'CaseSensitive',
			config.matchWholeWord && 'WordMatch',
			config.isRegexp && 'RegExp',
			config.onlyOpenEditors && 'OpenEditors',
			(config.useExcludeSettingsAndIgnoreFiles === false) && 'IgnoreExcludeSettings'
		]).join(' ')}`,
		config.filesToInclude ? `# Including: ${config.filesToInclude}` : undefined,
		config.filesToExclude ? `# Excluding: ${config.filesToExclude}` : undefined,
		config.contextLines ? `# ContextLines: ${config.contextLines}` : undefined,
		''
	]).join(lineDelimiter);
};

export const extractSearchQueryFromModel = (model: ITextModel): SearchConfiguration =>
	extractSearchQueryFromLines(model.getValueInRange(new Range(1, 1, 6, 1)).split(lineDelimiter));

export const defaultSearchConfig = (): SearchConfiguration => ({
	query: '',
	filesToInclude: '',
	filesToExclude: '',
	isRegexp: false,
	isCaseSensitive: false,
	useExcludeSettingsAndIgnoreFiles: true,
	matchWholeWord: false,
	contextLines: 0,
	showIncludesExcludes: false,
	onlyOpenEditors: false,
});

export const extractSearchQueryFromLines = (lines: string[]): SearchConfiguration => {

	const query = defaultSearchConfig();

	const unescapeNewlines = (str: string) => {
		let out = '';
		for (let i = 0; i < str.length; i++) {
			if (str[i] === '\\') {
				i++;
				const escaped = str[i];

				if (escaped === 'n') {
					out += '\n';
				}
				else if (escaped === '\\') {
					out += '\\';
				}
				else {
					throw Error(localize('invalidQueryStringError', "All backslashes in Query string must be escaped (\\\\)"));
				}
			} else {
				out += str[i];
			}
		}
		return out;
	};

	const parseYML = /^# ([^:]*): (.*)$/;
	for (const line of lines) {
		const parsed = parseYML.exec(line);
		if (!parsed) { continue; }
		const [, key, value] = parsed;
		switch (key) {
			case 'Query': query.query = unescapeNewlines(value); break;
			case 'Including': query.filesToInclude = value; break;
			case 'Excluding': query.filesToExclude = value; break;
			case 'ContextLines': query.contextLines = +value; break;
			case 'Flags': {
				query.isRegexp = value.indexOf('RegExp') !== -1;
				query.isCaseSensitive = value.indexOf('CaseSensitive') !== -1;
				query.useExcludeSettingsAndIgnoreFiles = value.indexOf('IgnoreExcludeSettings') === -1;
				query.matchWholeWord = value.indexOf('WordMatch') !== -1;
				query.onlyOpenEditors = value.indexOf('OpenEditors') !== -1;
			}
		}
	}

	query.showIncludesExcludes = !!(query.filesToInclude || query.filesToExclude || !query.useExcludeSettingsAndIgnoreFiles);

	return query;
};

export const serializeSearchResultForEditor =
	(searchResult: SearchResult, rawIncludePattern: string, rawExcludePattern: string, contextLines: number, labelFormatter: (x: URI) => string, sortOrder: SearchSortOrder, limitHit?: boolean): { matchRanges: Range[], text: string, config: Partial<SearchConfiguration> } => {
		if (!searchResult.query) { throw Error('Internal Error: Expected query, got null'); }
		const config = contentPatternToSearchConfiguration(searchResult.query, rawIncludePattern, rawExcludePattern, contextLines);

		const filecount = searchResult.fileCount() > 1 ? localize('numFiles', "{0} files", searchResult.fileCount()) : localize('oneFile', "1 file");
		const resultcount = searchResult.count() > 1 ? localize('numResults', "{0} results", searchResult.count()) : localize('oneResult', "1 result");

		const info = [
			searchResult.count()
				? `${resultcount} - ${filecount}`
				: localize('noResults', "No Results"),
		];
		if (limitHit) {
			info.push(localize('searchMaxResultsWarning', "The result set only contains a subset of all matches. Be more specific in your search to narrow down the results."));
		}
		info.push('');

		const matchComparer = (a: FileMatch | FolderMatch, b: FileMatch | FolderMatch) => searchMatchComparer(a, b, sortOrder);

		const allResults =
			flattenSearchResultSerializations(
				flatten(
					searchResult.folderMatches().sort(matchComparer)
						.map(folderMatch => folderMatch.matches().sort(matchComparer)
							.map(fileMatch => fileMatchToSearchResultFormat(fileMatch, labelFormatter)))));

		return {
			matchRanges: allResults.matchRanges.map(translateRangeLines(info.length)),
			text: info.concat(allResults.text).join(lineDelimiter),
			config
		};
	};

const flattenSearchResultSerializations = (serializations: SearchResultSerialization[]): SearchResultSerialization => {
	const text: string[] = [];
	const matchRanges: Range[] = [];

	serializations.forEach(serialized => {
		serialized.matchRanges.map(translateRangeLines(text.length)).forEach(range => matchRanges.push(range));
		serialized.text.forEach(line => text.push(line));
		text.push(''); // new line
	});

	return { text, matchRanges };
};

export const parseSavedSearchEditor = async (accessor: ServicesAccessor, resource: URI) => {
	const textFileService = accessor.get(ITextFileService);

	const text = (await textFileService.read(resource)).value;

	const headerlines = [];
	const bodylines = [];

	let inHeader = true;
	for (const line of text.split(/\r?\n/g)) {
		if (inHeader) {
			headerlines.push(line);
			if (line === '') {
				inHeader = false;
			}
		} else {
			bodylines.push(line);
		}
	}

	return { config: extractSearchQueryFromLines(headerlines), text: bodylines.join('\n') };
};
