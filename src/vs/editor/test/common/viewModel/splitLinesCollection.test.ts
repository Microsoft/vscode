/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IViewLineTokens } from 'vs/editor/common/core/lineTokens';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { TokenizationResult2 } from 'vs/editor/common/core/token';
import { EndOfLinePreference } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import * as modes from 'vs/editor/common/modes';
import { NULL_STATE } from 'vs/editor/common/modes/nullMode';
import { MonospaceLineBreaksComputerFactory } from 'vs/editor/common/viewModel/monospaceLineBreaksComputer';
import { ISimpleModel, SplitLine, SplitLinesCollection } from 'vs/editor/common/viewModel/splitLinesCollection';
import { LineBreakData, ViewLineData } from 'vs/editor/common/viewModel/viewModel';
import { TestConfiguration } from 'vs/editor/test/common/mocks/testConfiguration';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

suite('Editor ViewModel - SplitLinesCollection', () => {
	test('SplitLine', () => {
		let model1 = createModel('My First LineMy Second LineAnd another one');
		let line1 = createSplitLine([13, 14, 15], [13, 13 + 14, 13 + 14 + 15], 0);

		assert.equal(line1.getViewLineCount(), 3);
		assert.equal(line1.getViewLineContent(model1, 1, 0), 'My First Line');
		assert.equal(line1.getViewLineContent(model1, 1, 1), 'My Second Line');
		assert.equal(line1.getViewLineContent(model1, 1, 2), 'And another one');
		assert.equal(line1.getViewLineMaxColumn(model1, 1, 0), 14);
		assert.equal(line1.getViewLineMaxColumn(model1, 1, 1), 15);
		assert.equal(line1.getViewLineMaxColumn(model1, 1, 2), 16);
		for (let col = 1; col <= 14; col++) {
			assert.equal(line1.getModelColumnOfViewPosition(0, col), col, 'getInputColumnOfOutputPosition(0, ' + col + ')');
		}
		for (let col = 1; col <= 15; col++) {
			assert.equal(line1.getModelColumnOfViewPosition(1, col), 13 + col, 'getInputColumnOfOutputPosition(1, ' + col + ')');
		}
		for (let col = 1; col <= 16; col++) {
			assert.equal(line1.getModelColumnOfViewPosition(2, col), 13 + 14 + col, 'getInputColumnOfOutputPosition(2, ' + col + ')');
		}
		for (let col = 1; col <= 13; col++) {
			assert.deepEqual(line1.getViewPositionOfModelPosition(0, col), pos(0, col), 'getOutputPositionOfInputPosition(' + col + ')');
		}
		for (let col = 1 + 13; col <= 14 + 13; col++) {
			assert.deepEqual(line1.getViewPositionOfModelPosition(0, col), pos(1, col - 13), 'getOutputPositionOfInputPosition(' + col + ')');
		}
		for (let col = 1 + 13 + 14; col <= 15 + 14 + 13; col++) {
			assert.deepEqual(line1.getViewPositionOfModelPosition(0, col), pos(2, col - 13 - 14), 'getOutputPositionOfInputPosition(' + col + ')');
		}

		model1 = createModel('My First LineMy Second LineAnd another one');
		line1 = createSplitLine([13, 14, 15], [13, 13 + 14, 13 + 14 + 15], 4);

		assert.equal(line1.getViewLineCount(), 3);
		assert.equal(line1.getViewLineContent(model1, 1, 0), 'My First Line');
		assert.equal(line1.getViewLineContent(model1, 1, 1), '    My Second Line');
		assert.equal(line1.getViewLineContent(model1, 1, 2), '    And another one');
		assert.equal(line1.getViewLineMaxColumn(model1, 1, 0), 14);
		assert.equal(line1.getViewLineMaxColumn(model1, 1, 1), 19);
		assert.equal(line1.getViewLineMaxColumn(model1, 1, 2), 20);

		let actualViewColumnMapping: number[][] = [];
		for (let lineIndex = 0; lineIndex < line1.getViewLineCount(); lineIndex++) {
			let actualLineViewColumnMapping: number[] = [];
			for (let col = 1; col <= line1.getViewLineMaxColumn(model1, 1, lineIndex); col++) {
				actualLineViewColumnMapping.push(line1.getModelColumnOfViewPosition(lineIndex, col));
			}
			actualViewColumnMapping.push(actualLineViewColumnMapping);
		}
		assert.deepEqual(actualViewColumnMapping, [
			[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
			[14, 14, 14, 14, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28],
			[28, 28, 28, 28, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43],
		]);

		for (let col = 1; col <= 13; col++) {
			assert.deepEqual(line1.getViewPositionOfModelPosition(0, col), pos(0, col), '6.getOutputPositionOfInputPosition(' + col + ')');
		}
		for (let col = 1 + 13; col <= 14 + 13; col++) {
			assert.deepEqual(line1.getViewPositionOfModelPosition(0, col), pos(1, 4 + col - 13), '7.getOutputPositionOfInputPosition(' + col + ')');
		}
		for (let col = 1 + 13 + 14; col <= 15 + 14 + 13; col++) {
			assert.deepEqual(line1.getViewPositionOfModelPosition(0, col), pos(2, 4 + col - 13 - 14), '8.getOutputPositionOfInputPosition(' + col + ')');
		}
	});

	function withSplitLinesCollection(text: string, callback: (model: TextModel, linesCollection: SplitLinesCollection) => void): void {
		const config = new TestConfiguration({});
		const wrappingInfo = config.options.get(EditorOption.wrappingInfo);
		const fontInfo = config.options.get(EditorOption.fontInfo);
		const wordWrapBreakAfterCharacters = config.options.get(EditorOption.wordWrapBreakAfterCharacters);
		const wordWrapBreakBeforeCharacters = config.options.get(EditorOption.wordWrapBreakBeforeCharacters);
		const wrappingIndent = config.options.get(EditorOption.wrappingIndent);

		const lineBreaksComputerFactory = new MonospaceLineBreaksComputerFactory(wordWrapBreakBeforeCharacters, wordWrapBreakAfterCharacters);

		const model = createTextModel([
			'int main() {',
			'\tprintf("Hello world!");',
			'}',
			'int main() {',
			'\tprintf("Hello world!");',
			'}',
		].join('\n'));

		const linesCollection = new SplitLinesCollection(
			model,
			lineBreaksComputerFactory,
			lineBreaksComputerFactory,
			fontInfo,
			model.getOptions().tabSize,
			'simple',
			wrappingInfo.wrappingColumn,
			wrappingIndent
		);

		callback(model, linesCollection);

		linesCollection.dispose();
		model.dispose();
		config.dispose();
	}

	test('Invalid line numbers', () => {

		const text = [
			'int main() {',
			'\tprintf("Hello world!");',
			'}',
			'int main() {',
			'\tprintf("Hello world!");',
			'}',
		].join('\n');

		withSplitLinesCollection(text, (model, linesCollection) => {
			assert.equal(linesCollection.getViewLineCount(), 6);

			// getOutputIndentGuide
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(-1, -1), [0]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(0, 0), [0]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(1, 1), [0]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(2, 2), [1]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(3, 3), [0]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(4, 4), [0]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(5, 5), [1]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(6, 6), [0]);
			assert.deepEqual(linesCollection.getViewLinesIndentGuides(7, 7), [0]);

			assert.deepEqual(linesCollection.getViewLinesIndentGuides(0, 7), [0, 1, 0, 0, 1, 0]);

			// getOutputLineContent
			assert.equal(linesCollection.getViewLineContent(-1), 'int main() {');
			assert.equal(linesCollection.getViewLineContent(0), 'int main() {');
			assert.equal(linesCollection.getViewLineContent(1), 'int main() {');
			assert.equal(linesCollection.getViewLineContent(2), '\tprintf("Hello world!");');
			assert.equal(linesCollection.getViewLineContent(3), '}');
			assert.equal(linesCollection.getViewLineContent(4), 'int main() {');
			assert.equal(linesCollection.getViewLineContent(5), '\tprintf("Hello world!");');
			assert.equal(linesCollection.getViewLineContent(6), '}');
			assert.equal(linesCollection.getViewLineContent(7), '}');

			// getOutputLineMinColumn
			assert.equal(linesCollection.getViewLineMinColumn(-1), 1);
			assert.equal(linesCollection.getViewLineMinColumn(0), 1);
			assert.equal(linesCollection.getViewLineMinColumn(1), 1);
			assert.equal(linesCollection.getViewLineMinColumn(2), 1);
			assert.equal(linesCollection.getViewLineMinColumn(3), 1);
			assert.equal(linesCollection.getViewLineMinColumn(4), 1);
			assert.equal(linesCollection.getViewLineMinColumn(5), 1);
			assert.equal(linesCollection.getViewLineMinColumn(6), 1);
			assert.equal(linesCollection.getViewLineMinColumn(7), 1);

			// getOutputLineMaxColumn
			assert.equal(linesCollection.getViewLineMaxColumn(-1), 13);
			assert.equal(linesCollection.getViewLineMaxColumn(0), 13);
			assert.equal(linesCollection.getViewLineMaxColumn(1), 13);
			assert.equal(linesCollection.getViewLineMaxColumn(2), 25);
			assert.equal(linesCollection.getViewLineMaxColumn(3), 2);
			assert.equal(linesCollection.getViewLineMaxColumn(4), 13);
			assert.equal(linesCollection.getViewLineMaxColumn(5), 25);
			assert.equal(linesCollection.getViewLineMaxColumn(6), 2);
			assert.equal(linesCollection.getViewLineMaxColumn(7), 2);

			// convertOutputPositionToInputPosition
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(-1, 1), new Position(1, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(0, 1), new Position(1, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(1, 1), new Position(1, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(2, 1), new Position(2, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(3, 1), new Position(3, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(4, 1), new Position(4, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(5, 1), new Position(5, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(6, 1), new Position(6, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(7, 1), new Position(6, 1));
			assert.deepEqual(linesCollection.convertViewPositionToModelPosition(8, 1), new Position(6, 1));
		});
	});

	test('issue #3662', () => {

		const text = [
			'int main() {',
			'\tprintf("Hello world!");',
			'}',
			'int main() {',
			'\tprintf("Hello world!");',
			'}',
		].join('\n');

		withSplitLinesCollection(text, (model, linesCollection) => {
			linesCollection.setHiddenAreas([
				new Range(1, 1, 3, 1),
				new Range(5, 1, 6, 1)
			]);

			let viewLineCount = linesCollection.getViewLineCount();
			assert.equal(viewLineCount, 1, 'getOutputLineCount()');

			let modelLineCount = model.getLineCount();
			for (let lineNumber = 0; lineNumber <= modelLineCount + 1; lineNumber++) {
				let lineMinColumn = (lineNumber >= 1 && lineNumber <= modelLineCount) ? model.getLineMinColumn(lineNumber) : 1;
				let lineMaxColumn = (lineNumber >= 1 && lineNumber <= modelLineCount) ? model.getLineMaxColumn(lineNumber) : 1;
				for (let column = lineMinColumn - 1; column <= lineMaxColumn + 1; column++) {
					let viewPosition = linesCollection.convertModelPositionToViewPosition(lineNumber, column);

					// validate view position
					let viewLineNumber = viewPosition.lineNumber;
					let viewColumn = viewPosition.column;
					if (viewLineNumber < 1) {
						viewLineNumber = 1;
					}
					let lineCount = linesCollection.getViewLineCount();
					if (viewLineNumber > lineCount) {
						viewLineNumber = lineCount;
					}
					let viewMinColumn = linesCollection.getViewLineMinColumn(viewLineNumber);
					let viewMaxColumn = linesCollection.getViewLineMaxColumn(viewLineNumber);
					if (viewColumn < viewMinColumn) {
						viewColumn = viewMinColumn;
					}
					if (viewColumn > viewMaxColumn) {
						viewColumn = viewMaxColumn;
					}
					let validViewPosition = new Position(viewLineNumber, viewColumn);
					assert.equal(viewPosition.toString(), validViewPosition.toString(), 'model->view for ' + lineNumber + ', ' + column);
				}
			}

			for (let lineNumber = 0; lineNumber <= viewLineCount + 1; lineNumber++) {
				let lineMinColumn = linesCollection.getViewLineMinColumn(lineNumber);
				let lineMaxColumn = linesCollection.getViewLineMaxColumn(lineNumber);
				for (let column = lineMinColumn - 1; column <= lineMaxColumn + 1; column++) {
					let modelPosition = linesCollection.convertViewPositionToModelPosition(lineNumber, column);
					let validModelPosition = model.validatePosition(modelPosition);
					assert.equal(modelPosition.toString(), validModelPosition.toString(), 'view->model for ' + lineNumber + ', ' + column);
				}
			}
		});
	});

});

suite('SplitLinesCollection', () => {

	const _text = [
		'class Nice {',
		'	function hi() {',
		'		console.log("Hello world");',
		'	}',
		'	function hello() {',
		'		console.log("Hello world, this is a somewhat longer line");',
		'	}',
		'}',
	];

	const _tokens = [
		[
			{ startIndex: 0, value: 1 },
			{ startIndex: 5, value: 2 },
			{ startIndex: 6, value: 3 },
			{ startIndex: 10, value: 4 },
		],
		[
			{ startIndex: 0, value: 5 },
			{ startIndex: 1, value: 6 },
			{ startIndex: 9, value: 7 },
			{ startIndex: 10, value: 8 },
			{ startIndex: 12, value: 9 },
		],
		[
			{ startIndex: 0, value: 10 },
			{ startIndex: 2, value: 11 },
			{ startIndex: 9, value: 12 },
			{ startIndex: 10, value: 13 },
			{ startIndex: 13, value: 14 },
			{ startIndex: 14, value: 15 },
			{ startIndex: 27, value: 16 },
		],
		[
			{ startIndex: 0, value: 17 },
		],
		[
			{ startIndex: 0, value: 18 },
			{ startIndex: 1, value: 19 },
			{ startIndex: 9, value: 20 },
			{ startIndex: 10, value: 21 },
			{ startIndex: 15, value: 22 },
		],
		[
			{ startIndex: 0, value: 23 },
			{ startIndex: 2, value: 24 },
			{ startIndex: 9, value: 25 },
			{ startIndex: 10, value: 26 },
			{ startIndex: 13, value: 27 },
			{ startIndex: 14, value: 28 },
			{ startIndex: 59, value: 29 },
		],
		[
			{ startIndex: 0, value: 30 },
		],
		[
			{ startIndex: 0, value: 31 },
		]
	];

	let model: TextModel | null = null;
	let languageRegistration: IDisposable | null = null;

	setup(() => {
		let _lineIndex = 0;
		const tokenizationSupport: modes.ITokenizationSupport = {
			getInitialState: () => NULL_STATE,
			tokenize: undefined!,
			tokenize2: (line: string, state: modes.IState): TokenizationResult2 => {
				let tokens = _tokens[_lineIndex++];

				let result = new Uint32Array(2 * tokens.length);
				for (let i = 0; i < tokens.length; i++) {
					result[2 * i] = tokens[i].startIndex;
					result[2 * i + 1] = (
						tokens[i].value << modes.MetadataConsts.FOREGROUND_OFFSET
					);
				}
				return new TokenizationResult2(result, state);
			}
		};
		const LANGUAGE_ID = 'modelModeTest1';
		languageRegistration = modes.TokenizationRegistry.register(LANGUAGE_ID, tokenizationSupport);
		model = createTextModel(_text.join('\n'), undefined, new modes.LanguageIdentifier(LANGUAGE_ID, 0));
		// force tokenization
		model.forceTokenization(model.getLineCount());
	});

	teardown(() => {
		model!.dispose();
		model = null;
		languageRegistration!.dispose();
		languageRegistration = null;
	});


	interface ITestViewLineToken {
		endIndex: number;
		value: number;
	}

	function assertViewLineTokens(_actual: IViewLineTokens, expected: ITestViewLineToken[]): void {
		let actual: ITestViewLineToken[] = [];
		for (let i = 0, len = _actual.getCount(); i < len; i++) {
			actual[i] = {
				endIndex: _actual.getEndOffset(i),
				value: _actual.getForeground(i)
			};
		}
		assert.deepEqual(actual, expected);
	}

	interface ITestMinimapLineRenderingData {
		content: string;
		minColumn: number;
		maxColumn: number;
		tokens: ITestViewLineToken[];
	}

	function assertMinimapLineRenderingData(actual: ViewLineData, expected: ITestMinimapLineRenderingData | null): void {
		if (actual === null && expected === null) {
			assert.ok(true);
			return;
		}
		if (expected === null) {
			assert.ok(false);
			return;
		}
		assert.equal(actual.content, expected.content);
		assert.equal(actual.minColumn, expected.minColumn);
		assert.equal(actual.maxColumn, expected.maxColumn);
		assertViewLineTokens(actual.tokens, expected.tokens);
	}

	function assertMinimapLinesRenderingData(actual: ViewLineData[], expected: Array<ITestMinimapLineRenderingData | null>): void {
		assert.equal(actual.length, expected.length);
		for (let i = 0; i < expected.length; i++) {
			assertMinimapLineRenderingData(actual[i], expected[i]);
		}
	}

	function assertAllMinimapLinesRenderingData(splitLinesCollection: SplitLinesCollection, all: ITestMinimapLineRenderingData[]): void {
		let lineCount = all.length;
		for (let start = 1; start <= lineCount; start++) {
			for (let end = start; end <= lineCount; end++) {
				let count = end - start + 1;
				for (let desired = Math.pow(2, count) - 1; desired >= 0; desired--) {
					let needed: boolean[] = [];
					let expected: Array<ITestMinimapLineRenderingData | null> = [];
					for (let i = 0; i < count; i++) {
						needed[i] = (desired & (1 << i)) ? true : false;
						expected[i] = (needed[i] ? all[start - 1 + i] : null);
					}
					let actual = splitLinesCollection.getViewLinesData(start, end, needed);
					assertMinimapLinesRenderingData(actual, expected);
					// Comment out next line to test all possible combinations
					break;
				}
			}
		}
	}

	test('getViewLinesData - no wrapping', () => {
		withSplitLinesCollection(model!, 'off', 0, (splitLinesCollection) => {
			assert.equal(splitLinesCollection.getViewLineCount(), 8);
			assert.equal(splitLinesCollection.modelPositionIsVisible(1, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(2, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(3, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(4, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(5, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(6, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(7, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(8, 1), true);

			let _expected: ITestMinimapLineRenderingData[] = [
				{
					content: 'class Nice {',
					minColumn: 1,
					maxColumn: 13,
					tokens: [
						{ endIndex: 5, value: 1 },
						{ endIndex: 6, value: 2 },
						{ endIndex: 10, value: 3 },
						{ endIndex: 12, value: 4 },
					]
				},
				{
					content: '	function hi() {',
					minColumn: 1,
					maxColumn: 17,
					tokens: [
						{ endIndex: 1, value: 5 },
						{ endIndex: 9, value: 6 },
						{ endIndex: 10, value: 7 },
						{ endIndex: 12, value: 8 },
						{ endIndex: 16, value: 9 },
					]
				},
				{
					content: '		console.log("Hello world");',
					minColumn: 1,
					maxColumn: 30,
					tokens: [
						{ endIndex: 2, value: 10 },
						{ endIndex: 9, value: 11 },
						{ endIndex: 10, value: 12 },
						{ endIndex: 13, value: 13 },
						{ endIndex: 14, value: 14 },
						{ endIndex: 27, value: 15 },
						{ endIndex: 29, value: 16 },
					]
				},
				{
					content: '	}',
					minColumn: 1,
					maxColumn: 3,
					tokens: [
						{ endIndex: 2, value: 17 },
					]
				},
				{
					content: '	function hello() {',
					minColumn: 1,
					maxColumn: 20,
					tokens: [
						{ endIndex: 1, value: 18 },
						{ endIndex: 9, value: 19 },
						{ endIndex: 10, value: 20 },
						{ endIndex: 15, value: 21 },
						{ endIndex: 19, value: 22 },
					]
				},
				{
					content: '		console.log("Hello world, this is a somewhat longer line");',
					minColumn: 1,
					maxColumn: 62,
					tokens: [
						{ endIndex: 2, value: 23 },
						{ endIndex: 9, value: 24 },
						{ endIndex: 10, value: 25 },
						{ endIndex: 13, value: 26 },
						{ endIndex: 14, value: 27 },
						{ endIndex: 59, value: 28 },
						{ endIndex: 61, value: 29 },
					]
				},
				{
					minColumn: 1,
					maxColumn: 3,
					content: '	}',
					tokens: [
						{ endIndex: 2, value: 30 },
					]
				},
				{
					minColumn: 1,
					maxColumn: 2,
					content: '}',
					tokens: [
						{ endIndex: 1, value: 31 },
					]
				}
			];

			assertAllMinimapLinesRenderingData(splitLinesCollection, [
				_expected[0],
				_expected[1],
				_expected[2],
				_expected[3],
				_expected[4],
				_expected[5],
				_expected[6],
				_expected[7],
			]);

			splitLinesCollection.setHiddenAreas([new Range(2, 1, 4, 1)]);
			assert.equal(splitLinesCollection.getViewLineCount(), 5);
			assert.equal(splitLinesCollection.modelPositionIsVisible(1, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(2, 1), false);
			assert.equal(splitLinesCollection.modelPositionIsVisible(3, 1), false);
			assert.equal(splitLinesCollection.modelPositionIsVisible(4, 1), false);
			assert.equal(splitLinesCollection.modelPositionIsVisible(5, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(6, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(7, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(8, 1), true);

			assertAllMinimapLinesRenderingData(splitLinesCollection, [
				_expected[0],
				_expected[4],
				_expected[5],
				_expected[6],
				_expected[7],
			]);
		});
	});

	test('getViewLinesData - with wrapping', () => {
		withSplitLinesCollection(model!, 'wordWrapColumn', 30, (splitLinesCollection) => {
			assert.equal(splitLinesCollection.getViewLineCount(), 12);
			assert.equal(splitLinesCollection.modelPositionIsVisible(1, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(2, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(3, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(4, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(5, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(6, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(7, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(8, 1), true);

			let _expected: ITestMinimapLineRenderingData[] = [
				{
					content: 'class Nice {',
					minColumn: 1,
					maxColumn: 13,
					tokens: [
						{ endIndex: 5, value: 1 },
						{ endIndex: 6, value: 2 },
						{ endIndex: 10, value: 3 },
						{ endIndex: 12, value: 4 },
					]
				},
				{
					content: '	function hi() {',
					minColumn: 1,
					maxColumn: 17,
					tokens: [
						{ endIndex: 1, value: 5 },
						{ endIndex: 9, value: 6 },
						{ endIndex: 10, value: 7 },
						{ endIndex: 12, value: 8 },
						{ endIndex: 16, value: 9 },
					]
				},
				{
					content: '		console.log("Hello ',
					minColumn: 1,
					maxColumn: 22,
					tokens: [
						{ endIndex: 2, value: 10 },
						{ endIndex: 9, value: 11 },
						{ endIndex: 10, value: 12 },
						{ endIndex: 13, value: 13 },
						{ endIndex: 14, value: 14 },
						{ endIndex: 21, value: 15 },
					]
				},
				{
					content: '            world");',
					minColumn: 13,
					maxColumn: 21,
					tokens: [
						{ endIndex: 18, value: 15 },
						{ endIndex: 20, value: 16 },
					]
				},
				{
					content: '	}',
					minColumn: 1,
					maxColumn: 3,
					tokens: [
						{ endIndex: 2, value: 17 },
					]
				},
				{
					content: '	function hello() {',
					minColumn: 1,
					maxColumn: 20,
					tokens: [
						{ endIndex: 1, value: 18 },
						{ endIndex: 9, value: 19 },
						{ endIndex: 10, value: 20 },
						{ endIndex: 15, value: 21 },
						{ endIndex: 19, value: 22 },
					]
				},
				{
					content: '		console.log("Hello ',
					minColumn: 1,
					maxColumn: 22,
					tokens: [
						{ endIndex: 2, value: 23 },
						{ endIndex: 9, value: 24 },
						{ endIndex: 10, value: 25 },
						{ endIndex: 13, value: 26 },
						{ endIndex: 14, value: 27 },
						{ endIndex: 21, value: 28 },
					]
				},
				{
					content: '            world, this is a ',
					minColumn: 13,
					maxColumn: 30,
					tokens: [
						{ endIndex: 29, value: 28 },
					]
				},
				{
					content: '            somewhat longer ',
					minColumn: 13,
					maxColumn: 29,
					tokens: [
						{ endIndex: 28, value: 28 },
					]
				},
				{
					content: '            line");',
					minColumn: 13,
					maxColumn: 20,
					tokens: [
						{ endIndex: 17, value: 28 },
						{ endIndex: 19, value: 29 },
					]
				},
				{
					content: '	}',
					minColumn: 1,
					maxColumn: 3,
					tokens: [
						{ endIndex: 2, value: 30 },
					]
				},
				{
					content: '}',
					minColumn: 1,
					maxColumn: 2,
					tokens: [
						{ endIndex: 1, value: 31 },
					]
				}
			];

			assertAllMinimapLinesRenderingData(splitLinesCollection, [
				_expected[0],
				_expected[1],
				_expected[2],
				_expected[3],
				_expected[4],
				_expected[5],
				_expected[6],
				_expected[7],
				_expected[8],
				_expected[9],
				_expected[10],
				_expected[11],
			]);

			splitLinesCollection.setHiddenAreas([new Range(2, 1, 4, 1)]);
			assert.equal(splitLinesCollection.getViewLineCount(), 8);
			assert.equal(splitLinesCollection.modelPositionIsVisible(1, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(2, 1), false);
			assert.equal(splitLinesCollection.modelPositionIsVisible(3, 1), false);
			assert.equal(splitLinesCollection.modelPositionIsVisible(4, 1), false);
			assert.equal(splitLinesCollection.modelPositionIsVisible(5, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(6, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(7, 1), true);
			assert.equal(splitLinesCollection.modelPositionIsVisible(8, 1), true);

			assertAllMinimapLinesRenderingData(splitLinesCollection, [
				_expected[0],
				_expected[5],
				_expected[6],
				_expected[7],
				_expected[8],
				_expected[9],
				_expected[10],
				_expected[11],
			]);
		});
	});

	function withSplitLinesCollection(model: TextModel, wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded', wordWrapColumn: number, callback: (splitLinesCollection: SplitLinesCollection) => void): void {
		const configuration = new TestConfiguration({
			wordWrap: wordWrap,
			wordWrapColumn: wordWrapColumn,
			wrappingIndent: 'indent'
		});
		const wrappingInfo = configuration.options.get(EditorOption.wrappingInfo);
		const fontInfo = configuration.options.get(EditorOption.fontInfo);
		const wordWrapBreakAfterCharacters = configuration.options.get(EditorOption.wordWrapBreakAfterCharacters);
		const wordWrapBreakBeforeCharacters = configuration.options.get(EditorOption.wordWrapBreakBeforeCharacters);
		const wrappingIndent = configuration.options.get(EditorOption.wrappingIndent);

		const lineBreaksComputerFactory = new MonospaceLineBreaksComputerFactory(wordWrapBreakBeforeCharacters, wordWrapBreakAfterCharacters);

		const linesCollection = new SplitLinesCollection(
			model,
			lineBreaksComputerFactory,
			lineBreaksComputerFactory,
			fontInfo,
			model.getOptions().tabSize,
			'simple',
			wrappingInfo.wrappingColumn,
			wrappingIndent
		);

		callback(linesCollection);

		configuration.dispose();
	}
});


function pos(lineNumber: number, column: number): Position {
	return new Position(lineNumber, column);
}

function createSplitLine(splitLengths: number[], breakingOffsetsVisibleColumn: number[], wrappedTextIndentWidth: number, isVisible: boolean = true): SplitLine {
	return new SplitLine(createLineBreakData(splitLengths, breakingOffsetsVisibleColumn, wrappedTextIndentWidth), isVisible);
}

function createLineBreakData(breakingLengths: number[], breakingOffsetsVisibleColumn: number[], wrappedTextIndentWidth: number): LineBreakData {
	let sums: number[] = [];
	for (let i = 0; i < breakingLengths.length; i++) {
		sums[i] = (i > 0 ? sums[i - 1] : 0) + breakingLengths[i];
	}
	return new LineBreakData(sums, breakingOffsetsVisibleColumn, wrappedTextIndentWidth);
}

function createModel(text: string): ISimpleModel {
	return {
		getLineTokens: (lineNumber: number) => {
			return null!;
		},
		getLineContent: (lineNumber: number) => {
			return text;
		},
		getLineLength: (lineNumber: number) => {
			return text.length;
		},
		getLineMinColumn: (lineNumber: number) => {
			return 1;
		},
		getLineMaxColumn: (lineNumber: number) => {
			return text.length + 1;
		},
		getValueInRange: (range: IRange, eol?: EndOfLinePreference) => {
			return text.substring(range.startColumn - 1, range.endColumn - 1);
		}
	};
}
