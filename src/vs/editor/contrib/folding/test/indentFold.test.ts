/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { computeRanges } from 'vs/editor/contrib/folding/indentRangeProvider';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

interface IndentRange {
	start: number;
	end: number;
}

suite('Indentation Folding', () => {
	function r(start: number, end: number): IndentRange {
		return { start, end };
	}

	test('Limit by indent', () => {


		let lines = [
		/* 1*/	'A',
		/* 2*/	'  A',
		/* 3*/	'  A',
		/* 4*/	'    A',
		/* 5*/	'      A',
		/* 6*/	'    A',
		/* 7*/	'      A',
		/* 8*/	'      A',
		/* 9*/	'         A',
		/* 10*/	'      A',
		/* 11*/	'         A',
		/* 12*/	'  A',
		/* 13*/	'              A',
		/* 14*/	'                 A',
		/* 15*/	'A',
		/* 16*/	'  A'
		];
		let r1 = r(1, 14); //0
		let r2 = r(3, 11); //1
		let r3 = r(4, 5); //2
		let r4 = r(6, 11); //2
		let r5 = r(8, 9); //3
		let r6 = r(10, 11); //3
		let r7 = r(12, 14); //1
		let r8 = r(13, 14);//4
		let r9 = r(15, 16);//0

		let model = createTextModel(lines.join('\n'));

		function assertLimit(maxEntries: number, expectedRanges: IndentRange[], message: string) {
			let indentRanges = computeRanges(model, true, undefined, maxEntries);
			assert.ok(indentRanges.length <= maxEntries, 'max ' + message);
			let actual: IndentRange[] = [];
			for (let i = 0; i < indentRanges.length; i++) {
				actual.push({ start: indentRanges.getStartLineNumber(i), end: indentRanges.getEndLineNumber(i) });
			}
			assert.deepStrictEqual(actual, expectedRanges, message);
		}

		assertLimit(1000, [r1, r2, r3, r4, r5, r6, r7, r8, r9], '1000');
		assertLimit(9, [r1, r2, r3, r4, r5, r6, r7, r8, r9], '9');
		assertLimit(8, [r1, r2, r3, r4, r5, r6, r7, r9], '8');
		assertLimit(7, [r1, r2, r3, r4, r5, r7, r9], '7');
		assertLimit(6, [r1, r2, r3, r4, r7, r9], '6');
		assertLimit(5, [r1, r2, r3, r7, r9], '5');
		assertLimit(4, [r1, r2, r7, r9], '4');
		assertLimit(3, [r1, r2, r9], '3');
		assertLimit(2, [r1, r9], '2');
		assertLimit(1, [r1], '1');
		assertLimit(0, [], '0');
	});

});
