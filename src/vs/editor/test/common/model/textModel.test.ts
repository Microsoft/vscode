/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { UTF8_BOM_CHARACTER } from 'vs/base/common/strings';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { TextModel, createTextBuffer } from 'vs/editor/common/model/textModel';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

function testGuessIndentation(defaultInsertSpaces: boolean, defaultTabSize: number, expectedInsertSpaces: boolean, expectedTabSize: number, text: string[], msg?: string): void {
	let m = createTextModel(
		text.join('\n'),
		{
			tabSize: defaultTabSize,
			insertSpaces: defaultInsertSpaces,
			detectIndentation: true
		}
	);
	let r = m.getOptions();
	m.dispose();

	assert.strictEqual(r.insertSpaces, expectedInsertSpaces, msg);
	assert.strictEqual(r.tabSize, expectedTabSize, msg);
}

function assertGuess(expectedInsertSpaces: boolean | undefined, expectedTabSize: number | undefined | [number], text: string[], msg?: string): void {
	if (typeof expectedInsertSpaces === 'undefined') {
		// cannot guess insertSpaces
		if (typeof expectedTabSize === 'undefined') {
			// cannot guess tabSize
			testGuessIndentation(true, 13370, true, 13370, text, msg);
			testGuessIndentation(false, 13371, false, 13371, text, msg);
		} else if (typeof expectedTabSize === 'number') {
			// can guess tabSize
			testGuessIndentation(true, 13370, true, expectedTabSize, text, msg);
			testGuessIndentation(false, 13371, false, expectedTabSize, text, msg);
		} else {
			// can only guess tabSize when insertSpaces is true
			testGuessIndentation(true, 13370, true, expectedTabSize[0], text, msg);
			testGuessIndentation(false, 13371, false, 13371, text, msg);
		}
	} else {
		// can guess insertSpaces
		if (typeof expectedTabSize === 'undefined') {
			// cannot guess tabSize
			testGuessIndentation(true, 13370, expectedInsertSpaces, 13370, text, msg);
			testGuessIndentation(false, 13371, expectedInsertSpaces, 13371, text, msg);
		} else if (typeof expectedTabSize === 'number') {
			// can guess tabSize
			testGuessIndentation(true, 13370, expectedInsertSpaces, expectedTabSize, text, msg);
			testGuessIndentation(false, 13371, expectedInsertSpaces, expectedTabSize, text, msg);
		} else {
			// can only guess tabSize when insertSpaces is true
			if (expectedInsertSpaces === true) {
				testGuessIndentation(true, 13370, expectedInsertSpaces, expectedTabSize[0], text, msg);
				testGuessIndentation(false, 13371, expectedInsertSpaces, expectedTabSize[0], text, msg);
			} else {
				testGuessIndentation(true, 13370, expectedInsertSpaces, 13370, text, msg);
				testGuessIndentation(false, 13371, expectedInsertSpaces, 13371, text, msg);
			}
		}
	}
}

suite('TextModelData.fromString', () => {

	interface ITextBufferData {
		EOL: string;
		lines: string[];
		containsRTL: boolean;
		isBasicASCII: boolean;
	}

	function testTextModelDataFromString(text: string, expected: ITextBufferData): void {
		const textBuffer = createTextBuffer(text, TextModel.DEFAULT_CREATION_OPTIONS.defaultEOL).textBuffer;
		let actual: ITextBufferData = {
			EOL: textBuffer.getEOL(),
			lines: textBuffer.getLinesContent(),
			containsRTL: textBuffer.mightContainRTL(),
			isBasicASCII: !textBuffer.mightContainNonBasicASCII()
		};
		assert.deepStrictEqual(actual, expected);
	}

	test('one line text', () => {
		testTextModelDataFromString('Hello world!',
			{
				EOL: '\n',
				lines: [
					'Hello world!'
				],
				containsRTL: false,
				isBasicASCII: true
			}
		);
	});

	test('multiline text', () => {
		testTextModelDataFromString('Hello,\r\ndear friend\nHow\rare\r\nyou?',
			{
				EOL: '\r\n',
				lines: [
					'Hello,',
					'dear friend',
					'How',
					'are',
					'you?'
				],
				containsRTL: false,
				isBasicASCII: true
			}
		);
	});

	test('Non Basic ASCII 1', () => {
		testTextModelDataFromString('Hello,\nZürich',
			{
				EOL: '\n',
				lines: [
					'Hello,',
					'Zürich'
				],
				containsRTL: false,
				isBasicASCII: false
			}
		);
	});

	test('containsRTL 1', () => {
		testTextModelDataFromString('Hello,\nזוהי עובדה מבוססת שדעתו',
			{
				EOL: '\n',
				lines: [
					'Hello,',
					'זוהי עובדה מבוססת שדעתו'
				],
				containsRTL: true,
				isBasicASCII: false
			}
		);
	});

	test('containsRTL 2', () => {
		testTextModelDataFromString('Hello,\nهناك حقيقة مثبتة منذ زمن طويل',
			{
				EOL: '\n',
				lines: [
					'Hello,',
					'هناك حقيقة مثبتة منذ زمن طويل'
				],
				containsRTL: true,
				isBasicASCII: false
			}
		);
	});

});

suite('Editor Model - TextModel', () => {

	test('getValueLengthInRange', () => {

		let m = createTextModel('My First Line\r\nMy Second Line\r\nMy Third Line');
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1, 1)), ''.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1, 2)), 'M'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 1, 3)), 'y'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1, 14)), 'My First Line'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 2, 1)), 'My First Line\r\n'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 2, 1)), 'y First Line\r\n'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 2, 2)), 'y First Line\r\nM'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 2, 1000)), 'y First Line\r\nMy Second Line'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 3, 1)), 'y First Line\r\nMy Second Line\r\n'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 3, 1000)), 'y First Line\r\nMy Second Line\r\nMy Third Line'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1000, 1000)), 'My First Line\r\nMy Second Line\r\nMy Third Line'.length);

		m = createTextModel('My First Line\nMy Second Line\nMy Third Line');
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1, 1)), ''.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1, 2)), 'M'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 1, 3)), 'y'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1, 14)), 'My First Line'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 2, 1)), 'My First Line\n'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 2, 1)), 'y First Line\n'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 2, 2)), 'y First Line\nM'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 2, 1000)), 'y First Line\nMy Second Line'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 3, 1)), 'y First Line\nMy Second Line\n'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 2, 3, 1000)), 'y First Line\nMy Second Line\nMy Third Line'.length);
		assert.strictEqual(m.getValueLengthInRange(new Range(1, 1, 1000, 1000)), 'My First Line\nMy Second Line\nMy Third Line'.length);
	});

	test('guess indentation 1', () => {

		assertGuess(undefined, undefined, [
			'x',
			'x',
			'x',
			'x',
			'x',
			'x',
			'x'
		], 'no clues');

		assertGuess(false, undefined, [
			'\tx',
			'x',
			'x',
			'x',
			'x',
			'x',
			'x'
		], 'no spaces, 1xTAB');

		assertGuess(true, 2, [
			'  x',
			'x',
			'x',
			'x',
			'x',
			'x',
			'x'
		], '1x2');

		assertGuess(false, undefined, [
			'\tx',
			'\tx',
			'\tx',
			'\tx',
			'\tx',
			'\tx',
			'\tx'
		], '7xTAB');

		assertGuess(undefined, [2], [
			'\tx',
			'  x',
			'\tx',
			'  x',
			'\tx',
			'  x',
			'\tx',
			'  x',
		], '4x2, 4xTAB');
		assertGuess(false, undefined, [
			'\tx',
			' x',
			'\tx',
			' x',
			'\tx',
			' x',
			'\tx',
			' x'
		], '4x1, 4xTAB');
		assertGuess(false, undefined, [
			'\tx',
			'\tx',
			'  x',
			'\tx',
			'  x',
			'\tx',
			'  x',
			'\tx',
			'  x',
		], '4x2, 5xTAB');
		assertGuess(false, undefined, [
			'\tx',
			'\tx',
			'x',
			'\tx',
			'x',
			'\tx',
			'x',
			'\tx',
			'  x',
		], '1x2, 5xTAB');
		assertGuess(false, undefined, [
			'\tx',
			'\tx',
			'x',
			'\tx',
			'x',
			'\tx',
			'x',
			'\tx',
			'    x',
		], '1x4, 5xTAB');
		assertGuess(false, undefined, [
			'\tx',
			'\tx',
			'x',
			'\tx',
			'x',
			'\tx',
			'  x',
			'\tx',
			'    x',
		], '1x2, 1x4, 5xTAB');

		assertGuess(undefined, undefined, [
			'x',
			' x',
			' x',
			' x',
			' x',
			' x',
			' x',
			' x'
		], '7x1 - 1 space is never guessed as an indentation');
		assertGuess(true, undefined, [
			'x',
			'          x',
			' x',
			' x',
			' x',
			' x',
			' x',
			' x'
		], '1x10, 6x1');
		assertGuess(undefined, undefined, [
			'',
			'  ',
			'    ',
			'      ',
			'        ',
			'          ',
			'            ',
			'              ',
		], 'whitespace lines don\'t count');
		assertGuess(true, 3, [
			'x',
			'   x',
			'   x',
			'    x',
			'x',
			'   x',
			'   x',
			'    x',
			'x',
			'   x',
			'   x',
			'    x',
		], '6x3, 3x4');
		assertGuess(true, 5, [
			'x',
			'     x',
			'     x',
			'    x',
			'x',
			'     x',
			'     x',
			'    x',
			'x',
			'     x',
			'     x',
			'    x',
		], '6x5, 3x4');
		assertGuess(true, 7, [
			'x',
			'       x',
			'       x',
			'     x',
			'x',
			'       x',
			'       x',
			'    x',
			'x',
			'       x',
			'       x',
			'    x',
		], '6x7, 1x5, 2x4');
		assertGuess(true, 2, [
			'x',
			'  x',
			'  x',
			'  x',
			'  x',
			'x',
			'  x',
			'  x',
			'  x',
			'  x',
		], '8x2');

		assertGuess(true, 2, [
			'x',
			'  x',
			'  x',
			'x',
			'  x',
			'  x',
			'x',
			'  x',
			'  x',
			'x',
			'  x',
			'  x',
		], '8x2');
		assertGuess(true, 2, [
			'x',
			'  x',
			'    x',
			'x',
			'  x',
			'    x',
			'x',
			'  x',
			'    x',
			'x',
			'  x',
			'    x',
		], '4x2, 4x4');
		assertGuess(true, 2, [
			'x',
			'  x',
			'  x',
			'    x',
			'x',
			'  x',
			'  x',
			'    x',
			'x',
			'  x',
			'  x',
			'    x',
		], '6x2, 3x4');
		assertGuess(true, 2, [
			'x',
			'  x',
			'  x',
			'    x',
			'    x',
			'x',
			'  x',
			'  x',
			'    x',
			'    x',
		], '4x2, 4x4');
		assertGuess(true, 2, [
			'x',
			'  x',
			'    x',
			'    x',
			'x',
			'  x',
			'    x',
			'    x',
		], '2x2, 4x4');
		assertGuess(true, 4, [
			'x',
			'    x',
			'    x',
			'x',
			'    x',
			'    x',
			'x',
			'    x',
			'    x',
			'x',
			'    x',
			'    x',
		], '8x4');
		assertGuess(true, 2, [
			'x',
			'  x',
			'    x',
			'    x',
			'      x',
			'x',
			'  x',
			'    x',
			'    x',
			'      x',
		], '2x2, 4x4, 2x6');
		assertGuess(true, 2, [
			'x',
			'  x',
			'    x',
			'    x',
			'      x',
			'      x',
			'        x',
		], '1x2, 2x4, 2x6, 1x8');
		assertGuess(true, 4, [
			'x',
			'    x',
			'    x',
			'    x',
			'     x',
			'        x',
			'x',
			'    x',
			'    x',
			'    x',
			'     x',
			'        x',
		], '6x4, 2x5, 2x8');
		assertGuess(true, 4, [
			'x',
			'    x',
			'    x',
			'    x',
			'     x',
			'        x',
			'        x',
		], '3x4, 1x5, 2x8');
		assertGuess(true, 4, [
			'x',
			'x',
			'    x',
			'    x',
			'     x',
			'        x',
			'        x',
			'x',
			'x',
			'    x',
			'    x',
			'     x',
			'        x',
			'        x',
		], '6x4, 2x5, 4x8');
		assertGuess(true, 3, [
			'x',
			' x',
			' x',
			' x',
			' x',
			' x',
			'x',
			'   x',
			'    x',
			'    x',
		], '5x1, 2x0, 1x3, 2x4');
		assertGuess(false, undefined, [
			'\t x',
			' \t x',
			'\tx'
		], 'mixed whitespace 1');
		assertGuess(false, undefined, [
			'\tx',
			'\t    x'
		], 'mixed whitespace 2');
	});

	test('issue #44991: Wrong indentation size auto-detection', () => {
		assertGuess(true, 4, [
			'a = 10             # 0 space indent',
			'b = 5              # 0 space indent',
			'if a > 10:         # 0 space indent',
			'    a += 1         # 4 space indent      delta 4 spaces',
			'    if b > 5:      # 4 space indent',
			'        b += 1     # 8 space indent      delta 4 spaces',
			'        b += 1     # 8 space indent',
			'        b += 1     # 8 space indent',
			'# comment line 1   # 0 space indent      delta 8 spaces',
			'# comment line 2   # 0 space indent',
			'# comment line 3   # 0 space indent',
			'        b += 1     # 8 space indent      delta 8 spaces',
			'        b += 1     # 8 space indent',
			'        b += 1     # 8 space indent',
		]);
	});

	test('issue #55818: Broken indentation detection', () => {
		assertGuess(true, 2, [
			'',
			'/* REQUIRE */',
			'',
			'const foo = require ( \'foo\' ),',
			'      bar = require ( \'bar\' );',
			'',
			'/* MY FN */',
			'',
			'function myFn () {',
			'',
			'  const asd = 1,',
			'        dsa = 2;',
			'',
			'  return bar ( foo ( asd ) );',
			'',
			'}',
			'',
			'/* EXPORT */',
			'',
			'module.exports = myFn;',
			'',
		]);
	});

	test('issue #70832: Broken indentation detection', () => {
		assertGuess(false, undefined, [
			'x',
			'x',
			'x',
			'x',
			'	x',
			'		x',
			'    x',
			'		x',
			'	x',
			'		x',
			'	x',
			'	x',
			'	x',
			'	x',
			'x',
		]);
	});

	test('issue #62143: Broken indentation detection', () => {
		// works before the fix
		assertGuess(true, 2, [
			'x',
			'x',
			'  x',
			'  x'
		]);

		// works before the fix
		assertGuess(true, 2, [
			'x',
			'  - item2',
			'  - item3'
		]);

		// works before the fix
		testGuessIndentation(true, 2, true, 2, [
			'x x',
			'  x',
			'  x',
		]);

		// fails before the fix
		// empty space inline breaks the indentation guess
		testGuessIndentation(true, 2, true, 2, [
			'x x',
			'  x',
			'  x',
			'    x'
		]);

		testGuessIndentation(true, 2, true, 2, [
			'<!--test1.md -->',
			'- item1',
			'  - item2',
			'    - item3'
		]);
	});

	test('issue #84217: Broken indentation detection', () => {
		assertGuess(true, 4, [
			'def main():',
			'    print(\'hello\')',
		]);
		assertGuess(true, 4, [
			'def main():',
			'    with open(\'foo\') as fp:',
			'        print(fp.read())',
		]);
	});

	test('validatePosition', () => {

		let m = createTextModel('line one\nline two');

		assert.deepStrictEqual(m.validatePosition(new Position(0, 0)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(0, 1)), new Position(1, 1));

		assert.deepStrictEqual(m.validatePosition(new Position(1, 1)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 2)), new Position(1, 2));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 30)), new Position(1, 9));

		assert.deepStrictEqual(m.validatePosition(new Position(2, 0)), new Position(2, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(2, 1)), new Position(2, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(2, 2)), new Position(2, 2));
		assert.deepStrictEqual(m.validatePosition(new Position(2, 30)), new Position(2, 9));

		assert.deepStrictEqual(m.validatePosition(new Position(3, 0)), new Position(2, 9));
		assert.deepStrictEqual(m.validatePosition(new Position(3, 1)), new Position(2, 9));
		assert.deepStrictEqual(m.validatePosition(new Position(3, 30)), new Position(2, 9));

		assert.deepStrictEqual(m.validatePosition(new Position(30, 30)), new Position(2, 9));

		assert.deepStrictEqual(m.validatePosition(new Position(-123.123, -0.5)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(Number.MIN_VALUE, Number.MIN_VALUE)), new Position(1, 1));

		assert.deepStrictEqual(m.validatePosition(new Position(Number.MAX_VALUE, Number.MAX_VALUE)), new Position(2, 9));
		assert.deepStrictEqual(m.validatePosition(new Position(123.23, 47.5)), new Position(2, 9));
	});

	test('validatePosition around high-low surrogate pairs 1', () => {

		let m = createTextModel('a📚b');

		assert.deepStrictEqual(m.validatePosition(new Position(0, 0)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(0, 1)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(0, 7)), new Position(1, 1));

		assert.deepStrictEqual(m.validatePosition(new Position(1, 1)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 2)), new Position(1, 2));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 3)), new Position(1, 2));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 4)), new Position(1, 4));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 5)), new Position(1, 5));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 30)), new Position(1, 5));

		assert.deepStrictEqual(m.validatePosition(new Position(2, 0)), new Position(1, 5));
		assert.deepStrictEqual(m.validatePosition(new Position(2, 1)), new Position(1, 5));
		assert.deepStrictEqual(m.validatePosition(new Position(2, 2)), new Position(1, 5));
		assert.deepStrictEqual(m.validatePosition(new Position(2, 30)), new Position(1, 5));

		assert.deepStrictEqual(m.validatePosition(new Position(-123.123, -0.5)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(Number.MIN_VALUE, Number.MIN_VALUE)), new Position(1, 1));

		assert.deepStrictEqual(m.validatePosition(new Position(Number.MAX_VALUE, Number.MAX_VALUE)), new Position(1, 5));
		assert.deepStrictEqual(m.validatePosition(new Position(123.23, 47.5)), new Position(1, 5));
	});

	test('validatePosition around high-low surrogate pairs 2', () => {

		let m = createTextModel('a📚📚b');

		assert.deepStrictEqual(m.validatePosition(new Position(1, 1)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 2)), new Position(1, 2));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 3)), new Position(1, 2));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 4)), new Position(1, 4));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 5)), new Position(1, 4));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 6)), new Position(1, 6));
		assert.deepStrictEqual(m.validatePosition(new Position(1, 7)), new Position(1, 7));

	});

	test('validatePosition handle NaN.', () => {

		let m = createTextModel('line one\nline two');

		assert.deepStrictEqual(m.validatePosition(new Position(NaN, 1)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(1, NaN)), new Position(1, 1));

		assert.deepStrictEqual(m.validatePosition(new Position(NaN, NaN)), new Position(1, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(2, NaN)), new Position(2, 1));
		assert.deepStrictEqual(m.validatePosition(new Position(NaN, 3)), new Position(1, 3));
	});

	test('issue #71480: validatePosition handle floats', () => {
		let m = createTextModel('line one\nline two');

		assert.deepStrictEqual(m.validatePosition(new Position(0.2, 1)), new Position(1, 1), 'a');
		assert.deepStrictEqual(m.validatePosition(new Position(1.2, 1)), new Position(1, 1), 'b');
		assert.deepStrictEqual(m.validatePosition(new Position(1.5, 2)), new Position(1, 2), 'c');
		assert.deepStrictEqual(m.validatePosition(new Position(1.8, 3)), new Position(1, 3), 'd');
		assert.deepStrictEqual(m.validatePosition(new Position(1, 0.3)), new Position(1, 1), 'e');
		assert.deepStrictEqual(m.validatePosition(new Position(2, 0.8)), new Position(2, 1), 'f');
		assert.deepStrictEqual(m.validatePosition(new Position(1, 1.2)), new Position(1, 1), 'g');
		assert.deepStrictEqual(m.validatePosition(new Position(2, 1.5)), new Position(2, 1), 'h');
	});

	test('issue #71480: validateRange handle floats', () => {
		let m = createTextModel('line one\nline two');

		assert.deepStrictEqual(m.validateRange(new Range(0.2, 1.5, 0.8, 2.5)), new Range(1, 1, 1, 1));
		assert.deepStrictEqual(m.validateRange(new Range(1.2, 1.7, 1.8, 2.2)), new Range(1, 1, 1, 2));
	});

	test('validateRange around high-low surrogate pairs 1', () => {

		let m = createTextModel('a📚b');

		assert.deepStrictEqual(m.validateRange(new Range(0, 0, 0, 1)), new Range(1, 1, 1, 1));
		assert.deepStrictEqual(m.validateRange(new Range(0, 0, 0, 7)), new Range(1, 1, 1, 1));

		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 1)), new Range(1, 1, 1, 1));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 2)), new Range(1, 1, 1, 2));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 3)), new Range(1, 1, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 4)), new Range(1, 1, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 5)), new Range(1, 1, 1, 5));

		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 2)), new Range(1, 2, 1, 2));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 3)), new Range(1, 2, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 4)), new Range(1, 2, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 5)), new Range(1, 2, 1, 5));

		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 3)), new Range(1, 2, 1, 2));
		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 4)), new Range(1, 2, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 5)), new Range(1, 2, 1, 5));

		assert.deepStrictEqual(m.validateRange(new Range(1, 4, 1, 4)), new Range(1, 4, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 4, 1, 5)), new Range(1, 4, 1, 5));

		assert.deepStrictEqual(m.validateRange(new Range(1, 5, 1, 5)), new Range(1, 5, 1, 5));
	});

	test('validateRange around high-low surrogate pairs 2', () => {

		let m = createTextModel('a📚📚b');

		assert.deepStrictEqual(m.validateRange(new Range(0, 0, 0, 1)), new Range(1, 1, 1, 1));
		assert.deepStrictEqual(m.validateRange(new Range(0, 0, 0, 7)), new Range(1, 1, 1, 1));

		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 1)), new Range(1, 1, 1, 1));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 2)), new Range(1, 1, 1, 2));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 3)), new Range(1, 1, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 4)), new Range(1, 1, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 5)), new Range(1, 1, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 6)), new Range(1, 1, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 1, 1, 7)), new Range(1, 1, 1, 7));

		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 2)), new Range(1, 2, 1, 2));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 3)), new Range(1, 2, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 4)), new Range(1, 2, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 5)), new Range(1, 2, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 6)), new Range(1, 2, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 2, 1, 7)), new Range(1, 2, 1, 7));

		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 3)), new Range(1, 2, 1, 2));
		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 4)), new Range(1, 2, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 5)), new Range(1, 2, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 6)), new Range(1, 2, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 3, 1, 7)), new Range(1, 2, 1, 7));

		assert.deepStrictEqual(m.validateRange(new Range(1, 4, 1, 4)), new Range(1, 4, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 4, 1, 5)), new Range(1, 4, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 4, 1, 6)), new Range(1, 4, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 4, 1, 7)), new Range(1, 4, 1, 7));

		assert.deepStrictEqual(m.validateRange(new Range(1, 5, 1, 5)), new Range(1, 4, 1, 4));
		assert.deepStrictEqual(m.validateRange(new Range(1, 5, 1, 6)), new Range(1, 4, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 5, 1, 7)), new Range(1, 4, 1, 7));

		assert.deepStrictEqual(m.validateRange(new Range(1, 6, 1, 6)), new Range(1, 6, 1, 6));
		assert.deepStrictEqual(m.validateRange(new Range(1, 6, 1, 7)), new Range(1, 6, 1, 7));

		assert.deepStrictEqual(m.validateRange(new Range(1, 7, 1, 7)), new Range(1, 7, 1, 7));
	});

	test('modifyPosition', () => {

		let m = createTextModel('line one\nline two');
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 1), 0), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(0, 0), 0), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(30, 1), 0), new Position(2, 9));

		assert.deepStrictEqual(m.modifyPosition(new Position(1, 1), 17), new Position(2, 9));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 1), 1), new Position(1, 2));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 1), 3), new Position(1, 4));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), 10), new Position(2, 3));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 5), 13), new Position(2, 9));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), 16), new Position(2, 9));

		assert.deepStrictEqual(m.modifyPosition(new Position(2, 9), -17), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), -1), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 4), -3), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(2, 3), -10), new Position(1, 2));
		assert.deepStrictEqual(m.modifyPosition(new Position(2, 9), -13), new Position(1, 5));
		assert.deepStrictEqual(m.modifyPosition(new Position(2, 9), -16), new Position(1, 2));

		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), 17), new Position(2, 9));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), 100), new Position(2, 9));

		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), -2), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(1, 2), -100), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(2, 2), -100), new Position(1, 1));
		assert.deepStrictEqual(m.modifyPosition(new Position(2, 9), -18), new Position(1, 1));
	});

	test('normalizeIndentation 1', () => {
		let model = createTextModel('',
			{
				insertSpaces: false
			}
		);

		assert.strictEqual(model.normalizeIndentation('\t'), '\t');
		assert.strictEqual(model.normalizeIndentation('    '), '\t');
		assert.strictEqual(model.normalizeIndentation('   '), '   ');
		assert.strictEqual(model.normalizeIndentation('  '), '  ');
		assert.strictEqual(model.normalizeIndentation(' '), ' ');
		assert.strictEqual(model.normalizeIndentation(''), '');
		assert.strictEqual(model.normalizeIndentation(' \t   '), '\t\t');
		assert.strictEqual(model.normalizeIndentation(' \t  '), '\t   ');
		assert.strictEqual(model.normalizeIndentation(' \t '), '\t  ');
		assert.strictEqual(model.normalizeIndentation(' \t'), '\t ');

		assert.strictEqual(model.normalizeIndentation('\ta'), '\ta');
		assert.strictEqual(model.normalizeIndentation('    a'), '\ta');
		assert.strictEqual(model.normalizeIndentation('   a'), '   a');
		assert.strictEqual(model.normalizeIndentation('  a'), '  a');
		assert.strictEqual(model.normalizeIndentation(' a'), ' a');
		assert.strictEqual(model.normalizeIndentation('a'), 'a');
		assert.strictEqual(model.normalizeIndentation(' \t   a'), '\t\ta');
		assert.strictEqual(model.normalizeIndentation(' \t  a'), '\t   a');
		assert.strictEqual(model.normalizeIndentation(' \t a'), '\t  a');
		assert.strictEqual(model.normalizeIndentation(' \ta'), '\t a');

		model.dispose();
	});

	test('normalizeIndentation 2', () => {
		let model = createTextModel('');

		assert.strictEqual(model.normalizeIndentation('\ta'), '    a');
		assert.strictEqual(model.normalizeIndentation('    a'), '    a');
		assert.strictEqual(model.normalizeIndentation('   a'), '   a');
		assert.strictEqual(model.normalizeIndentation('  a'), '  a');
		assert.strictEqual(model.normalizeIndentation(' a'), ' a');
		assert.strictEqual(model.normalizeIndentation('a'), 'a');
		assert.strictEqual(model.normalizeIndentation(' \t   a'), '        a');
		assert.strictEqual(model.normalizeIndentation(' \t  a'), '       a');
		assert.strictEqual(model.normalizeIndentation(' \t a'), '      a');
		assert.strictEqual(model.normalizeIndentation(' \ta'), '     a');

		model.dispose();
	});

	test('getLineFirstNonWhitespaceColumn', () => {
		let model = createTextModel([
			'asd',
			' asd',
			'\tasd',
			'  asd',
			'\t\tasd',
			' ',
			'  ',
			'\t',
			'\t\t',
			'  \tasd',
			'',
			''
		].join('\n'));

		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(1), 1, '1');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(2), 2, '2');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(3), 2, '3');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(4), 3, '4');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(5), 3, '5');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(6), 0, '6');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(7), 0, '7');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(8), 0, '8');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(9), 0, '9');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(10), 4, '10');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(11), 0, '11');
		assert.strictEqual(model.getLineFirstNonWhitespaceColumn(12), 0, '12');
	});

	test('getLineLastNonWhitespaceColumn', () => {
		let model = createTextModel([
			'asd',
			'asd ',
			'asd\t',
			'asd  ',
			'asd\t\t',
			' ',
			'  ',
			'\t',
			'\t\t',
			'asd  \t',
			'',
			''
		].join('\n'));

		assert.strictEqual(model.getLineLastNonWhitespaceColumn(1), 4, '1');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(2), 4, '2');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(3), 4, '3');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(4), 4, '4');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(5), 4, '5');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(6), 0, '6');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(7), 0, '7');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(8), 0, '8');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(9), 0, '9');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(10), 4, '10');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(11), 0, '11');
		assert.strictEqual(model.getLineLastNonWhitespaceColumn(12), 0, '12');
	});

	test('#50471. getValueInRange with invalid range', () => {
		let m = createTextModel('My First Line\r\nMy Second Line\r\nMy Third Line');
		assert.strictEqual(m.getValueInRange(new Range(1, NaN, 1, 3)), 'My');
		assert.strictEqual(m.getValueInRange(new Range(NaN, NaN, NaN, NaN)), '');
	});
});

suite('TextModel.mightContainRTL', () => {

	test('nope', () => {
		let model = createTextModel('hello world!');
		assert.strictEqual(model.mightContainRTL(), false);
	});

	test('yes', () => {
		let model = createTextModel('Hello,\nזוהי עובדה מבוססת שדעתו');
		assert.strictEqual(model.mightContainRTL(), true);
	});

	test('setValue resets 1', () => {
		let model = createTextModel('hello world!');
		assert.strictEqual(model.mightContainRTL(), false);
		model.setValue('Hello,\nזוהי עובדה מבוססת שדעתו');
		assert.strictEqual(model.mightContainRTL(), true);
	});

	test('setValue resets 2', () => {
		let model = createTextModel('Hello,\nهناك حقيقة مثبتة منذ زمن طويل');
		assert.strictEqual(model.mightContainRTL(), true);
		model.setValue('hello world!');
		assert.strictEqual(model.mightContainRTL(), false);
	});

});

suite('TextModel.createSnapshot', () => {

	test('empty file', () => {
		let model = createTextModel('');
		let snapshot = model.createSnapshot();
		assert.strictEqual(snapshot.read(), null);
		model.dispose();
	});

	test('file with BOM', () => {
		let model = createTextModel(UTF8_BOM_CHARACTER + 'Hello');
		assert.strictEqual(model.getLineContent(1), 'Hello');
		let snapshot = model.createSnapshot(true);
		assert.strictEqual(snapshot.read(), UTF8_BOM_CHARACTER + 'Hello');
		assert.strictEqual(snapshot.read(), null);
		model.dispose();
	});

	test('regular file', () => {
		let model = createTextModel('My First Line\n\t\tMy Second Line\n    Third Line\n\n1');
		let snapshot = model.createSnapshot();
		assert.strictEqual(snapshot.read(), 'My First Line\n\t\tMy Second Line\n    Third Line\n\n1');
		assert.strictEqual(snapshot.read(), null);
		model.dispose();
	});

	test('large file', () => {
		let lines: string[] = [];
		for (let i = 0; i < 1000; i++) {
			lines[i] = 'Just some text that is a bit long such that it can consume some memory';
		}
		const text = lines.join('\n');

		let model = createTextModel(text);
		let snapshot = model.createSnapshot();
		let actual = '';

		// 70999 length => at most 2 read calls are necessary
		let tmp1 = snapshot.read();
		assert.ok(tmp1);
		actual += tmp1;

		let tmp2 = snapshot.read();
		if (tmp2 === null) {
			// all good
		} else {
			actual += tmp2;
			assert.strictEqual(snapshot.read(), null);
		}

		assert.strictEqual(actual, text);

		model.dispose();
	});

	test('issue #119632: invalid range', () => {
		const model = createTextModel('hello world!');
		const actual = model._validateRangeRelaxedNoAllocations(new Range(<any>undefined, 0, <any>undefined, 1));
		assert.deepStrictEqual(actual, new Range(1, 1, 1, 1));
		model.dispose();
	});

});
