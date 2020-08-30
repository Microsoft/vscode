/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { testApplyEditsWithSyncedModels } from 'vs/editor/test/common/model/editableTextModelTestUtils';

const GENERATE_TESTS = false;

suite('EditorModel Auto Tests', () => {
	function editOp(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, text: string[]): IIdentifiedSingleEditOperation {
		return {
			identifier: null,
			range: new Range(startLineNumber, startColumn, endLineNumber, endColumn),
			text: text.join('\n'),
			forceMoveMarkers: false
		};
	}

	test('auto1', () => {
		testApplyEditsWithSyncedModels(
			[
				'ioe',
				'',
				'yjct',
				'',
				'',
			],
			[
				editOp(1, 2, 1, 2, ['b', 'r', 'fq']),
				editOp(1, 4, 2, 1, ['', '']),
			],
			[
				'ib',
				'r',
				'fqoe',
				'',
				'yjct',
				'',
				'',
			]
		);
	});

	test('auto2', () => {
		testApplyEditsWithSyncedModels(
			[
				'f',
				'littnhskrq',
				'utxvsizqnk',
				'lslqz',
				'jxn',
				'gmm',
			],
			[
				editOp(1, 2, 1, 2, ['', 'o']),
				editOp(2, 4, 2, 4, ['zaq', 'avb']),
				editOp(2, 5, 6, 2, ['jlr', 'zl', 'j']),
			],
			[
				'f',
				'o',
				'litzaq',
				'avbtjlr',
				'zl',
				'jmm',
			]
		);
	});

	test('auto3', () => {
		testApplyEditsWithSyncedModels(
			[
				'ofw',
				'qsxmziuvzw',
				'rp',
				'qsnymek',
				'elth',
				'wmgzbwudxz',
				'iwsdkndh',
				'bujlbwb',
				'asuouxfv',
				'xuccnb',
			],
			[
				editOp(4, 3, 4, 3, ['']),
			],
			[
				'ofw',
				'qsxmziuvzw',
				'rp',
				'qsnymek',
				'elth',
				'wmgzbwudxz',
				'iwsdkndh',
				'bujlbwb',
				'asuouxfv',
				'xuccnb',
			]
		);
	});

	test('auto4', () => {
		testApplyEditsWithSyncedModels(
			[
				'fefymj',
				'qum',
				'vmiwxxaiqq',
				'dz',
				'lnqdgorosf',
			],
			[
				editOp(1, 3, 1, 5, ['hp']),
				editOp(1, 7, 2, 1, ['kcg', '', 'mpx']),
				editOp(2, 2, 2, 2, ['', 'aw', '']),
				editOp(2, 2, 2, 2, ['vqr', 'mo']),
				editOp(4, 2, 5, 3, ['xyc']),
			],
			[
				'fehpmjkcg',
				'',
				'mpxq',
				'aw',
				'vqr',
				'moum',
				'vmiwxxaiqq',
				'dxycqdgorosf',
			]
		);
	});
});

function getRandomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomString(minLength: number, maxLength: number): string {
	let length = getRandomInt(minLength, maxLength);
	let r = '';
	for (let i = 0; i < length; i++) {
		r += String.fromCharCode(getRandomInt(CharCode.a, CharCode.z));
	}
	return r;
}

function generateFile(small: boolean): string {
	let lineCount = getRandomInt(1, small ? 3 : 10);
	let lines: string[] = [];
	for (let i = 0; i < lineCount; i++) {
		lines.push(getRandomString(0, small ? 3 : 10));
	}
	return lines.join('\n');
}

function generateEdits(content: string): ITestModelEdit[] {

	let result: ITestModelEdit[] = [];
	let cnt = getRandomInt(1, 5);

	let maxOffset = content.length;

	while (cnt > 0 && maxOffset > 0) {

		let offset = getRandomInt(0, maxOffset);
		let length = getRandomInt(0, maxOffset - offset);
		let text = generateFile(true);

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

interface ITestModelEdit {
	offset: number;
	length: number;
	text: string;
}

class TestModel {

	public initialContent: string;
	public resultingContent: string;
	public edits: IIdentifiedSingleEditOperation[];

	private static _generateOffsetToPosition(content: string): Position[] {
		let result: Position[] = [];
		let lineNumber = 1;
		let column = 1;

		for (let offset = 0, len = content.length; offset <= len; offset++) {
			let ch = content.charAt(offset);

			result[offset] = new Position(lineNumber, column);

			if (ch === '\n') {
				lineNumber++;
				column = 1;
			} else {
				column++;
			}
		}

		return result;
	}

	constructor() {
		this.initialContent = generateFile(false);

		let edits = generateEdits(this.initialContent);

		let offsetToPosition = TestModel._generateOffsetToPosition(this.initialContent);
		this.edits = [];
		for (const edit of edits) {
			let startPosition = offsetToPosition[edit.offset];
			let endPosition = offsetToPosition[edit.offset + edit.length];
			this.edits.push({
				range: new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column),
				text: edit.text
			});
		}

		this.resultingContent = this.initialContent;
		for (let i = edits.length - 1; i >= 0; i--) {
			this.resultingContent = (
				this.resultingContent.substring(0, edits[i].offset) +
				edits[i].text +
				this.resultingContent.substring(edits[i].offset + edits[i].length)
			);
		}
	}

	public print(): string {
		let r: string[] = [];
		r.push('testApplyEditsWithSyncedModels(');
		r.push('\t[');
		let initialLines = this.initialContent.split('\n');
		r = r.concat(initialLines.map((i) => `\t\t'${i}',`));
		r.push('\t],');
		r.push('\t[');
		r = r.concat(this.edits.map((i) => {
			let text = `['` + i.text!.split('\n').join(`', '`) + `']`;
			return `\t\teditOp(${i.range.startLineNumber}, ${i.range.startColumn}, ${i.range.endLineNumber}, ${i.range.endColumn}, ${text}),`;
		}));
		r.push('\t],');
		r.push('\t[');
		let resultLines = this.resultingContent.split('\n');
		r = r.concat(resultLines.map((i) => `\t\t'${i}',`));
		r.push('\t]');
		r.push(');');

		return r.join('\n');
	}
}

if (GENERATE_TESTS) {
	let number = 1;
	while (true) {

		console.log('------BEGIN NEW TEST: ' + number);

		let testModel = new TestModel();

		// console.log(testModel.print());

		console.log('------END NEW TEST: ' + (number++));

		try {
			testApplyEditsWithSyncedModels(
				testModel.initialContent.split('\n'),
				testModel.edits,
				testModel.resultingContent.split('\n')
			);
			// throw new Error('a');
		} catch (err) {
			console.log(err);
			console.log(testModel.print());
			break;
		}

		// break;
	}

}
