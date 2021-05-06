/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { compressConsecutiveTextChanges, TextChange } from 'vs/editor/common/model/textChange';

const GENERATE_TESTS = false;

interface IGeneratedEdit {
	offset: number;
	length: number;
	text: string;
}

suite('TextChangeCompressor', () => {

	function getResultingContent(initialContent: string, edits: IGeneratedEdit[]): string {
		let content = initialContent;
		for (let i = edits.length - 1; i >= 0; i--) {
			content = (
				content.substring(0, edits[i].offset) +
				edits[i].text +
				content.substring(edits[i].offset + edits[i].length)
			);
		}
		return content;
	}

	function getTextChanges(initialContent: string, edits: IGeneratedEdit[]): TextChange[] {
		let content = initialContent;
		let changes: TextChange[] = new Array<TextChange>(edits.length);
		let deltaOffset = 0;

		for (let i = 0; i < edits.length; i++) {
			let edit = edits[i];

			let position = edit.offset + deltaOffset;
			let length = edit.length;
			let text = edit.text;

			let oldText = content.substr(position, length);

			content = (
				content.substr(0, position) +
				text +
				content.substr(position + length)
			);

			changes[i] = new TextChange(edit.offset, oldText, position, text);

			deltaOffset += text.length - length;
		}

		return changes;
	}

	function assertCompression(initialText: string, edit1: IGeneratedEdit[], edit2: IGeneratedEdit[]): void {

		let tmpText = getResultingContent(initialText, edit1);
		let chg1 = getTextChanges(initialText, edit1);

		let finalText = getResultingContent(tmpText, edit2);
		let chg2 = getTextChanges(tmpText, edit2);

		let compressedTextChanges = compressConsecutiveTextChanges(chg1, chg2);

		// Check that the compression was correct
		let compressedDoTextEdits: IGeneratedEdit[] = compressedTextChanges.map((change) => {
			return {
				offset: change.oldPosition,
				length: change.oldLength,
				text: change.newText
			};
		});
		let actualDoResult = getResultingContent(initialText, compressedDoTextEdits);
		assert.strictEqual(actualDoResult, finalText);

		let compressedUndoTextEdits: IGeneratedEdit[] = compressedTextChanges.map((change) => {
			return {
				offset: change.newPosition,
				length: change.newLength,
				text: change.oldText
			};
		});
		let actualUndoResult = getResultingContent(finalText, compressedUndoTextEdits);
		assert.strictEqual(actualUndoResult, initialText);
	}

	test('simple 1', () => {
		assertCompression(
			'',
			[{ offset: 0, length: 0, text: 'h' }],
			[{ offset: 1, length: 0, text: 'e' }]
		);
	});

	test('simple 2', () => {
		assertCompression(
			'|',
			[{ offset: 0, length: 0, text: 'h' }],
			[{ offset: 2, length: 0, text: 'e' }]
		);
	});

	test('complex1', () => {
		assertCompression(
			'abcdefghij',
			[
				{ offset: 0, length: 3, text: 'qh' },
				{ offset: 5, length: 0, text: '1' },
				{ offset: 8, length: 2, text: 'X' }
			],
			[
				{ offset: 1, length: 0, text: 'Z' },
				{ offset: 3, length: 3, text: 'Y' },
			]
		);
	});

	// test('issue #118041', () => {
	// 	assertCompression(
	// 		'﻿',
	// 		[
	// 			{ offset: 0, length: 1, text: '' },
	// 		],
	// 		[
	// 			{ offset: 1, length: 0, text: 'Z' },
	// 			{ offset: 3, length: 3, text: 'Y' },
	// 		]
	// 	);
	// })

	test('gen1', () => {
		assertCompression(
			'kxm',
			[{ offset: 0, length: 1, text: 'tod_neu' }],
			[{ offset: 1, length: 2, text: 'sag_e' }]
		);
	});

	test('gen2', () => {
		assertCompression(
			'kpb_r_v',
			[{ offset: 5, length: 2, text: 'a_jvf_l' }],
			[{ offset: 10, length: 2, text: 'w' }]
		);
	});

	test('gen3', () => {
		assertCompression(
			'slu_w',
			[{ offset: 4, length: 1, text: '_wfw' }],
			[{ offset: 3, length: 5, text: '' }]
		);
	});

	test('gen4', () => {
		assertCompression(
			'_e',
			[{ offset: 2, length: 0, text: 'zo_b' }],
			[{ offset: 1, length: 3, text: 'tra' }]
		);
	});

	test('gen5', () => {
		assertCompression(
			'ssn_',
			[{ offset: 0, length: 2, text: 'tat_nwe' }],
			[{ offset: 2, length: 6, text: 'jm' }]
		);
	});

	test('gen6', () => {
		assertCompression(
			'kl_nru',
			[{ offset: 4, length: 1, text: '' }],
			[{ offset: 1, length: 4, text: '__ut' }]
		);
	});

	const _a = 'a'.charCodeAt(0);
	const _z = 'z'.charCodeAt(0);

	function getRandomInt(min: number, max: number): number {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	function getRandomString(minLength: number, maxLength: number): string {
		const length = getRandomInt(minLength, maxLength);
		let r = '';
		for (let i = 0; i < length; i++) {
			r += String.fromCharCode(getRandomInt(_a, _z));
		}
		return r;
	}

	function getRandomEOL(): string {
		switch (getRandomInt(1, 3)) {
			case 1: return '\r';
			case 2: return '\n';
			case 3: return '\r\n';
		}
		throw new Error(`not possible`);
	}

	function getRandomBuffer(small: boolean): string {
		let lineCount = getRandomInt(1, small ? 3 : 10);
		let lines: string[] = [];
		for (let i = 0; i < lineCount; i++) {
			lines.push(getRandomString(0, small ? 3 : 10) + getRandomEOL());
		}
		return lines.join('');
	}

	function getRandomEdits(content: string, min: number = 1, max: number = 5): IGeneratedEdit[] {

		let result: IGeneratedEdit[] = [];
		let cnt = getRandomInt(min, max);

		let maxOffset = content.length;

		while (cnt > 0 && maxOffset > 0) {

			let offset = getRandomInt(0, maxOffset);
			let length = getRandomInt(0, maxOffset - offset);
			let text = getRandomBuffer(true);

			result.push({
				offset: offset,
				length: length,
				text: text
			});

			maxOffset = offset;
			cnt--;
		}

		result.reverse();

		return result;
	}

	class GeneratedTest {

		private readonly _content: string;
		private readonly _edits1: IGeneratedEdit[];
		private readonly _edits2: IGeneratedEdit[];

		constructor() {
			this._content = getRandomBuffer(false).replace(/\n/g, '_');
			this._edits1 = getRandomEdits(this._content, 1, 5).map((e) => { return { offset: e.offset, length: e.length, text: e.text.replace(/\n/g, '_') }; });
			let tmp = getResultingContent(this._content, this._edits1);
			this._edits2 = getRandomEdits(tmp, 1, 5).map((e) => { return { offset: e.offset, length: e.length, text: e.text.replace(/\n/g, '_') }; });
		}

		public print(): void {
			console.log(`assertCompression(${JSON.stringify(this._content)}, ${JSON.stringify(this._edits1)}, ${JSON.stringify(this._edits2)});`);
		}

		public assert(): void {
			assertCompression(this._content, this._edits1, this._edits2);
		}
	}

	if (GENERATE_TESTS) {
		let testNumber = 0;
		while (true) {
			testNumber++;
			console.log(`------RUNNING TextChangeCompressor TEST ${testNumber}`);
			let test = new GeneratedTest();
			try {
				test.assert();
			} catch (err) {
				console.log(err);
				test.print();
				break;
			}
		}
	}
});

suite('TextChange', () => {

	test('issue #118041: unicode character undo bug', () => {
		const textChange = new TextChange(428, '﻿', 428, '');
		const buff = new Uint8Array(textChange.writeSize());
		textChange.write(buff, 0);
		const actual: TextChange[] = [];
		TextChange.read(buff, 0, actual);
		assert.deepStrictEqual(actual[0], textChange);
	});

});
