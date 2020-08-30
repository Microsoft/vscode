/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Disposable } from 'vs/base/common/lifecycle';
import { ITextAreaWrapper, PagedScreenReaderStrategy, TextAreaState } from 'vs/editor/browser/controller/textAreaState';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

export class MockTextAreaWrapper extends Disposable implements ITextAreaWrapper {

	public _value: string;
	public _selectionStart: number;
	public _selectionEnd: number;

	constructor() {
		super();
		this._value = '';
		this._selectionStart = 0;
		this._selectionEnd = 0;
	}

	public getValue(): string {
		return this._value;
	}

	public setValue(reason: string, value: string): void {
		this._value = value;
		this._selectionStart = this._value.length;
		this._selectionEnd = this._value.length;
	}

	public getSelectionStart(): number {
		return this._selectionStart;
	}

	public getSelectionEnd(): number {
		return this._selectionEnd;
	}

	public setSelectionRange(reason: string, selectionStart: number, selectionEnd: number): void {
		if (selectionStart < 0) {
			selectionStart = 0;
		}
		if (selectionStart > this._value.length) {
			selectionStart = this._value.length;
		}
		if (selectionEnd < 0) {
			selectionEnd = 0;
		}
		if (selectionEnd > this._value.length) {
			selectionEnd = this._value.length;
		}
		this._selectionStart = selectionStart;
		this._selectionEnd = selectionEnd;
	}
}

function equalsTextAreaState(a: TextAreaState, b: TextAreaState): boolean {
	return (
		a.value === b.value
		&& a.selectionStart === b.selectionStart
		&& a.selectionEnd === b.selectionEnd
		&& Position.equals(a.selectionStartPosition, b.selectionStartPosition)
		&& Position.equals(a.selectionEndPosition, b.selectionEndPosition)
	);
}

suite('TextAreaState', () => {

	function assertTextAreaState(actual: TextAreaState, value: string, selectionStart: number, selectionEnd: number): void {
		let desired = new TextAreaState(value, selectionStart, selectionEnd, null, null);
		assert.ok(equalsTextAreaState(desired, actual), desired.toString() + ' == ' + actual.toString());
	}

	test('fromTextArea', () => {
		let textArea = new MockTextAreaWrapper();
		textArea._value = 'Hello world!';
		textArea._selectionStart = 1;
		textArea._selectionEnd = 12;
		let actual = TextAreaState.readFromTextArea(textArea);

		assertTextAreaState(actual, 'Hello world!', 1, 12);
		assert.equal(actual.value, 'Hello world!');
		assert.equal(actual.selectionStart, 1);

		actual = actual.collapseSelection();
		assertTextAreaState(actual, 'Hello world!', 12, 12);

		textArea.dispose();
	});

	test('applyToTextArea', () => {
		let textArea = new MockTextAreaWrapper();
		textArea._value = 'Hello world!';
		textArea._selectionStart = 1;
		textArea._selectionEnd = 12;

		let state = new TextAreaState('Hi world!', 2, 2, null, null);
		state.writeToTextArea('test', textArea, false);

		assert.equal(textArea._value, 'Hi world!');
		assert.equal(textArea._selectionStart, 9);
		assert.equal(textArea._selectionEnd, 9);

		state = new TextAreaState('Hi world!', 3, 3, null, null);
		state.writeToTextArea('test', textArea, false);

		assert.equal(textArea._value, 'Hi world!');
		assert.equal(textArea._selectionStart, 9);
		assert.equal(textArea._selectionEnd, 9);

		state = new TextAreaState('Hi world!', 0, 2, null, null);
		state.writeToTextArea('test', textArea, true);

		assert.equal(textArea._value, 'Hi world!');
		assert.equal(textArea._selectionStart, 0);
		assert.equal(textArea._selectionEnd, 2);

		textArea.dispose();
	});

	function testDeduceInput(prevState: TextAreaState | null, value: string, selectionStart: number, selectionEnd: number, couldBeEmojiInput: boolean, expected: string, expectedCharReplaceCnt: number): void {
		prevState = prevState || TextAreaState.EMPTY;

		let textArea = new MockTextAreaWrapper();
		textArea._value = value;
		textArea._selectionStart = selectionStart;
		textArea._selectionEnd = selectionEnd;

		let newState = TextAreaState.readFromTextArea(textArea);
		let actual = TextAreaState.deduceInput(prevState, newState, couldBeEmojiInput);

		assert.equal(actual.text, expected);
		assert.equal(actual.replaceCharCnt, expectedCharReplaceCnt);

		textArea.dispose();
	}

	test('deduceInput - Japanese typing sennsei and accepting', () => {
		// manual test:
		// - choose keyboard layout: Japanese -> Hiragama
		// - type sennsei
		// - accept with Enter
		// - expected: せんせい

		// s
		// PREVIOUS STATE: [ <>, selectionStart: 0, selectionEnd: 0, selectionToken: 0]
		// CURRENT STATE: [ <ｓ>, selectionStart: 0, selectionEnd: 1, selectionToken: 0]
		testDeduceInput(
			TextAreaState.EMPTY,
			'ｓ',
			0, 1, true,
			'ｓ', 0
		);

		// e
		// PREVIOUS STATE: [ <ｓ>, selectionStart: 0, selectionEnd: 1, selectionToken: 0]
		// CURRENT STATE: [ <せ>, selectionStart: 0, selectionEnd: 1, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('ｓ', 0, 1, null, null),
			'せ',
			0, 1, true,
			'せ', 1
		);

		// n
		// PREVIOUS STATE: [ <せ>, selectionStart: 0, selectionEnd: 1, selectionToken: 0]
		// CURRENT STATE: [ <せｎ>, selectionStart: 0, selectionEnd: 2, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せ', 0, 1, null, null),
			'せｎ',
			0, 2, true,
			'せｎ', 1
		);

		// n
		// PREVIOUS STATE: [ <せｎ>, selectionStart: 0, selectionEnd: 2, selectionToken: 0]
		// CURRENT STATE: [ <せん>, selectionStart: 0, selectionEnd: 2, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せｎ', 0, 2, null, null),
			'せん',
			0, 2, true,
			'せん', 2
		);

		// s
		// PREVIOUS STATE: [ <せん>, selectionStart: 0, selectionEnd: 2, selectionToken: 0]
		// CURRENT STATE: [ <せんｓ>, selectionStart: 0, selectionEnd: 3, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せん', 0, 2, null, null),
			'せんｓ',
			0, 3, true,
			'せんｓ', 2
		);

		// e
		// PREVIOUS STATE: [ <せんｓ>, selectionStart: 0, selectionEnd: 3, selectionToken: 0]
		// CURRENT STATE: [ <せんせ>, selectionStart: 0, selectionEnd: 3, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せんｓ', 0, 3, null, null),
			'せんせ',
			0, 3, true,
			'せんせ', 3
		);

		// no-op? [was recorded]
		// PREVIOUS STATE: [ <せんせ>, selectionStart: 0, selectionEnd: 3, selectionToken: 0]
		// CURRENT STATE: [ <せんせ>, selectionStart: 0, selectionEnd: 3, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せんせ', 0, 3, null, null),
			'せんせ',
			0, 3, true,
			'せんせ', 3
		);

		// i
		// PREVIOUS STATE: [ <せんせ>, selectionStart: 0, selectionEnd: 3, selectionToken: 0]
		// CURRENT STATE: [ <せんせい>, selectionStart: 0, selectionEnd: 4, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せんせ', 0, 3, null, null),
			'せんせい',
			0, 4, true,
			'せんせい', 3
		);

		// ENTER (accept)
		// PREVIOUS STATE: [ <せんせい>, selectionStart: 0, selectionEnd: 4, selectionToken: 0]
		// CURRENT STATE: [ <せんせい>, selectionStart: 4, selectionEnd: 4, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せんせい', 0, 4, null, null),
			'せんせい',
			4, 4, true,
			'', 0
		);
	});

	test('deduceInput - Japanese typing sennsei and choosing different suggestion', () => {
		// manual test:
		// - choose keyboard layout: Japanese -> Hiragama
		// - type sennsei
		// - arrow down (choose next suggestion)
		// - accept with Enter
		// - expected: せんせい

		// sennsei
		// PREVIOUS STATE: [ <せんせい>, selectionStart: 0, selectionEnd: 4, selectionToken: 0]
		// CURRENT STATE: [ <せんせい>, selectionStart: 0, selectionEnd: 4, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せんせい', 0, 4, null, null),
			'せんせい',
			0, 4, true,
			'せんせい', 4
		);

		// arrow down
		// CURRENT STATE: [ <先生>, selectionStart: 0, selectionEnd: 2, selectionToken: 0]
		// PREVIOUS STATE: [ <せんせい>, selectionStart: 0, selectionEnd: 4, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('せんせい', 0, 4, null, null),
			'先生',
			0, 2, true,
			'先生', 4
		);

		// ENTER (accept)
		// PREVIOUS STATE: [ <先生>, selectionStart: 0, selectionEnd: 2, selectionToken: 0]
		// CURRENT STATE: [ <先生>, selectionStart: 2, selectionEnd: 2, selectionToken: 0]
		testDeduceInput(
			new TextAreaState('先生', 0, 2, null, null),
			'先生',
			2, 2, true,
			'', 0
		);
	});

	test('extractNewText - no previous state with selection', () => {
		testDeduceInput(
			null,
			'a',
			0, 1, true,
			'a', 0
		);
	});

	test('issue #2586: Replacing selected end-of-line with newline locks up the document', () => {
		testDeduceInput(
			new TextAreaState(']\n', 1, 2, null, null),
			']\n',
			2, 2, true,
			'\n', 0
		);
	});

	test('extractNewText - no previous state without selection', () => {
		testDeduceInput(
			null,
			'a',
			1, 1, true,
			'a', 0
		);
	});

	test('extractNewText - typing does not cause a selection', () => {
		testDeduceInput(
			TextAreaState.EMPTY,
			'a',
			0, 1, true,
			'a', 0
		);
	});

	test('extractNewText - had the textarea empty', () => {
		testDeduceInput(
			TextAreaState.EMPTY,
			'a',
			1, 1, true,
			'a', 0
		);
	});

	test('extractNewText - had the entire line selected', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 0, 12, null, null),
			'H',
			1, 1, true,
			'H', 0
		);
	});

	test('extractNewText - had previous text 1', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 12, 12, null, null),
			'Hello world!a',
			13, 13, true,
			'a', 0
		);
	});

	test('extractNewText - had previous text 2', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 0, 0, null, null),
			'aHello world!',
			1, 1, true,
			'a', 0
		);
	});

	test('extractNewText - had previous text 3', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 6, 11, null, null),
			'Hello other!',
			11, 11, true,
			'other', 0
		);
	});

	test('extractNewText - IME', () => {
		testDeduceInput(
			TextAreaState.EMPTY,
			'これは',
			3, 3, true,
			'これは', 0
		);
	});

	test('extractNewText - isInOverwriteMode', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 0, 0, null, null),
			'Aello world!',
			1, 1, true,
			'A', 0
		);
	});

	test('extractMacReplacedText - does nothing if there is selection', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 5, 5, null, null),
			'Hellö world!',
			4, 5, true,
			'ö', 0
		);
	});

	test('extractMacReplacedText - does nothing if there is more than one extra char', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 5, 5, null, null),
			'Hellöö world!',
			5, 5, true,
			'öö', 1
		);
	});

	test('extractMacReplacedText - does nothing if there is more than one changed char', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 5, 5, null, null),
			'Helöö world!',
			5, 5, true,
			'öö', 2
		);
	});

	test('extractMacReplacedText', () => {
		testDeduceInput(
			new TextAreaState('Hello world!', 5, 5, null, null),
			'Hellö world!',
			5, 5, true,
			'ö', 1
		);
	});

	test('issue #25101 - First key press ignored', () => {
		testDeduceInput(
			new TextAreaState('a', 0, 1, null, null),
			'a',
			1, 1, true,
			'a', 0
		);
	});

	test('issue #16520 - Cmd-d of single character followed by typing same character as has no effect', () => {
		testDeduceInput(
			new TextAreaState('x x', 0, 1, null, null),
			'x x',
			1, 1, true,
			'x', 0
		);
	});

	test('issue #4271 (example 1) - When inserting an emoji on OSX, it is placed two spaces left of the cursor', () => {
		// The OSX emoji inserter inserts emojis at random positions in the text, unrelated to where the cursor is.
		testDeduceInput(
			new TextAreaState(
				[
					'some1  text',
					'some2  text',
					'some3  text',
					'some4  text', // cursor is here in the middle of the two spaces
					'some5  text',
					'some6  text',
					'some7  text'
				].join('\n'),
				42, 42,
				null, null
			),
			[
				'so📅me1  text',
				'some2  text',
				'some3  text',
				'some4  text',
				'some5  text',
				'some6  text',
				'some7  text'
			].join('\n'),
			4, 4, true,
			'📅', 0
		);
	});

	test('issue #4271 (example 2) - When inserting an emoji on OSX, it is placed two spaces left of the cursor', () => {
		// The OSX emoji inserter inserts emojis at random positions in the text, unrelated to where the cursor is.
		testDeduceInput(
			new TextAreaState(
				'some1  text',
				6, 6,
				null, null
			),
			'some💊1  text',
			6, 6, true,
			'💊', 0
		);
	});

	test('issue #4271 (example 3) - When inserting an emoji on OSX, it is placed two spaces left of the cursor', () => {
		// The OSX emoji inserter inserts emojis at random positions in the text, unrelated to where the cursor is.
		testDeduceInput(
			new TextAreaState(
				'qwertyu\nasdfghj\nzxcvbnm',
				12, 12,
				null, null
			),
			'qwertyu\nasdfghj\nzxcvbnm🎈',
			25, 25, true,
			'🎈', 0
		);
	});

	// an example of an emoji missed by the regex but which has the FE0F variant 16 hint
	test('issue #4271 (example 4) - When inserting an emoji on OSX, it is placed two spaces left of the cursor', () => {
		// The OSX emoji inserter inserts emojis at random positions in the text, unrelated to where the cursor is.
		testDeduceInput(
			new TextAreaState(
				'some1  text',
				6, 6,
				null, null
			),
			'some⌨️1  text',
			6, 6, true,
			'⌨️', 0
		);
	});

	suite('PagedScreenReaderStrategy', () => {

		function testPagedScreenReaderStrategy(lines: string[], selection: Selection, expected: TextAreaState): void {
			const model = createTextModel(lines.join('\n'));
			const actual = PagedScreenReaderStrategy.fromEditorSelection(TextAreaState.EMPTY, model, selection, 10, true);
			assert.ok(equalsTextAreaState(actual, expected));
			model.dispose();
		}

		test('simple', () => {
			testPagedScreenReaderStrategy(
				[
					'Hello world!'
				],
				new Selection(1, 13, 1, 13),
				new TextAreaState('Hello world!', 12, 12, new Position(1, 13), new Position(1, 13))
			);

			testPagedScreenReaderStrategy(
				[
					'Hello world!'
				],
				new Selection(1, 1, 1, 1),
				new TextAreaState('Hello world!', 0, 0, new Position(1, 1), new Position(1, 1))
			);

			testPagedScreenReaderStrategy(
				[
					'Hello world!'
				],
				new Selection(1, 1, 1, 6),
				new TextAreaState('Hello world!', 0, 5, new Position(1, 1), new Position(1, 6))
			);
		});

		test('multiline', () => {
			testPagedScreenReaderStrategy(
				[
					'Hello world!',
					'How are you?'
				],
				new Selection(1, 1, 1, 1),
				new TextAreaState('Hello world!\nHow are you?', 0, 0, new Position(1, 1), new Position(1, 1))
			);

			testPagedScreenReaderStrategy(
				[
					'Hello world!',
					'How are you?'
				],
				new Selection(2, 1, 2, 1),
				new TextAreaState('Hello world!\nHow are you?', 13, 13, new Position(2, 1), new Position(2, 1))
			);
		});

		test('page', () => {
			testPagedScreenReaderStrategy(
				[
					'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21'
				],
				new Selection(1, 1, 1, 1),
				new TextAreaState('L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\n', 0, 0, new Position(1, 1), new Position(1, 1))
			);

			testPagedScreenReaderStrategy(
				[
					'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21'
				],
				new Selection(11, 1, 11, 1),
				new TextAreaState('L11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\n', 0, 0, new Position(11, 1), new Position(11, 1))
			);

			testPagedScreenReaderStrategy(
				[
					'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21'
				],
				new Selection(12, 1, 12, 1),
				new TextAreaState('L11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\n', 4, 4, new Position(12, 1), new Position(12, 1))
			);

			testPagedScreenReaderStrategy(
				[
					'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11\nL12\nL13\nL14\nL15\nL16\nL17\nL18\nL19\nL20\nL21'
				],
				new Selection(21, 1, 21, 1),
				new TextAreaState('L21', 0, 0, new Position(21, 1), new Position(21, 1))
			);
		});

	});
});
