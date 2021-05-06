/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { FindMatch, ITextModel } from 'vs/editor/common/model';
import { ISearchRange, ITextQuery, ITextSearchContext, QueryType } from 'vs/workbench/services/search/common/search';
import { addContextToEditorMatches, editorMatchesToTextSearchResults } from 'vs/workbench/services/search/common/searchHelpers';

suite('SearchHelpers', () => {
	suite('editorMatchesToTextSearchResults', () => {
		const mockTextModel: ITextModel = <ITextModel>{
			getLineContent(lineNumber: number): string {
				return '' + lineNumber;
			}
		};

		function assertRangesEqual(actual: ISearchRange | ISearchRange[], expected: ISearchRange[]) {
			if (!Array.isArray(actual)) {
				// All of these tests are for arrays...
				throw new Error('Expected array of ranges');
			}

			assert.strictEqual(actual.length, expected.length);

			// These are sometimes Range, sometimes SearchRange
			actual.forEach((r, i) => {
				const expectedRange = expected[i];
				assert.deepStrictEqual(
					{ startLineNumber: r.startLineNumber, startColumn: r.startColumn, endLineNumber: r.endLineNumber, endColumn: r.endColumn },
					{ startLineNumber: expectedRange.startLineNumber, startColumn: expectedRange.startColumn, endLineNumber: expectedRange.endLineNumber, endColumn: expectedRange.endColumn });
			});
		}

		test('simple', () => {
			const results = editorMatchesToTextSearchResults([new FindMatch(new Range(6, 1, 6, 2), null)], mockTextModel);
			assert.strictEqual(results.length, 1);
			assert.strictEqual(results[0].preview.text, '6\n');
			assertRangesEqual(results[0].preview.matches, [new Range(0, 0, 0, 1)]);
			assertRangesEqual(results[0].ranges, [new Range(5, 0, 5, 1)]);
		});

		test('multiple', () => {
			const results = editorMatchesToTextSearchResults(
				[
					new FindMatch(new Range(6, 1, 6, 2), null),
					new FindMatch(new Range(6, 4, 8, 2), null),
					new FindMatch(new Range(9, 1, 10, 3), null),
				],
				mockTextModel);
			assert.strictEqual(results.length, 2);
			assertRangesEqual(results[0].preview.matches, [
				new Range(0, 0, 0, 1),
				new Range(0, 3, 2, 1),
			]);
			assertRangesEqual(results[0].ranges, [
				new Range(5, 0, 5, 1),
				new Range(5, 3, 7, 1),
			]);
			assert.strictEqual(results[0].preview.text, '6\n7\n8\n');

			assertRangesEqual(results[1].preview.matches, [
				new Range(0, 0, 1, 2),
			]);
			assertRangesEqual(results[1].ranges, [
				new Range(8, 0, 9, 2),
			]);
			assert.strictEqual(results[1].preview.text, '9\n10\n');
		});
	});

	suite('addContextToEditorMatches', () => {
		const MOCK_LINE_COUNT = 100;

		const mockTextModel: ITextModel = <ITextModel>{
			getLineContent(lineNumber: number): string {
				if (lineNumber < 1 || lineNumber > MOCK_LINE_COUNT) {
					throw new Error(`invalid line count: ${lineNumber}`);
				}

				return '' + lineNumber;
			},

			getLineCount(): number {
				return MOCK_LINE_COUNT;
			}
		};

		function getQuery(beforeContext?: number, afterContext?: number): ITextQuery {
			return {
				folderQueries: [],
				type: QueryType.Text,
				contentPattern: { pattern: 'test' },
				beforeContext,
				afterContext
			};
		}

		test('no context', () => {
			const matches = [{
				preview: {
					text: 'foo',
					matches: new Range(0, 0, 0, 10)
				},
				ranges: new Range(0, 0, 0, 10)
			}];

			assert.deepStrictEqual(addContextToEditorMatches(matches, mockTextModel, getQuery()), matches);
		});

		test('simple', () => {
			const matches = [{
				preview: {
					text: 'foo',
					matches: new Range(0, 0, 0, 10)
				},
				ranges: new Range(1, 0, 1, 10)
			}];

			assert.deepStrictEqual(addContextToEditorMatches(matches, mockTextModel, getQuery(1, 2)), [
				<ITextSearchContext>{
					text: '1',
					lineNumber: 0
				},
				...matches,
				<ITextSearchContext>{
					text: '3',
					lineNumber: 2
				},
				<ITextSearchContext>{
					text: '4',
					lineNumber: 3
				},
			]);
		});

		test('multiple matches next to each other', () => {
			const matches = [
				{
					preview: {
						text: 'foo',
						matches: new Range(0, 0, 0, 10)
					},
					ranges: new Range(1, 0, 1, 10)
				},
				{
					preview: {
						text: 'bar',
						matches: new Range(0, 0, 0, 10)
					},
					ranges: new Range(2, 0, 2, 10)
				}];

			assert.deepStrictEqual(addContextToEditorMatches(matches, mockTextModel, getQuery(1, 2)), [
				<ITextSearchContext>{
					text: '1',
					lineNumber: 0
				},
				...matches,
				<ITextSearchContext>{
					text: '4',
					lineNumber: 3
				},
				<ITextSearchContext>{
					text: '5',
					lineNumber: 4
				},
			]);
		});

		test('boundaries', () => {
			const matches = [
				{
					preview: {
						text: 'foo',
						matches: new Range(0, 0, 0, 10)
					},
					ranges: new Range(0, 0, 0, 10)
				},
				{
					preview: {
						text: 'bar',
						matches: new Range(0, 0, 0, 10)
					},
					ranges: new Range(MOCK_LINE_COUNT - 1, 0, MOCK_LINE_COUNT - 1, 10)
				}];

			assert.deepStrictEqual(addContextToEditorMatches(matches, mockTextModel, getQuery(1, 2)), [
				matches[0],
				<ITextSearchContext>{
					text: '2',
					lineNumber: 1
				},
				<ITextSearchContext>{
					text: '3',
					lineNumber: 2
				},
				<ITextSearchContext>{
					text: '' + (MOCK_LINE_COUNT - 1),
					lineNumber: MOCK_LINE_COUNT - 2
				},
				matches[1]
			]);
		});
	});
});
