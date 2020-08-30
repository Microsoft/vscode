/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { computeRanges } from 'vs/editor/contrib/folding/indentRangeProvider';
import { FoldingMarkers } from 'vs/editor/common/modes/languageConfiguration';
import { MAX_FOLDING_REGIONS } from 'vs/editor/contrib/folding/foldingRanges';

let markers: FoldingMarkers = {
	start: /^\s*#region\b/,
	end: /^\s*#endregion\b/
};


suite('FoldingRanges', () => {

	test('test max folding regions', () => {
		let lines: string[] = [];
		let nRegions = MAX_FOLDING_REGIONS;
		for (let i = 0; i < nRegions; i++) {
			lines.push('#region');
		}
		for (let i = 0; i < nRegions; i++) {
			lines.push('#endregion');
		}
		let model = createTextModel(lines.join('\n'));
		let actual = computeRanges(model, false, markers, MAX_FOLDING_REGIONS);
		assert.equal(actual.length, nRegions, 'len');
		for (let i = 0; i < nRegions; i++) {
			assert.equal(actual.getStartLineNumber(i), i + 1, 'start' + i);
			assert.equal(actual.getEndLineNumber(i), nRegions * 2 - i, 'end' + i);
			assert.equal(actual.getParentIndex(i), i - 1, 'parent' + i);
		}

	});

	test('findRange', () => {
		let lines = [
		/* 1*/	'#region',
		/* 2*/	'#endregion',
		/* 3*/	'class A {',
		/* 4*/	'  void foo() {',
		/* 5*/	'    if (true) {',
		/* 6*/	'        return;',
		/* 7*/	'    }',
		/* 8*/	'',
		/* 9*/	'    if (true) {',
		/* 10*/	'      return;',
		/* 11*/	'    }',
		/* 12*/	'  }',
		/* 13*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let actual = computeRanges(textModel, false, markers);
			// let r0 = r(1, 2);
			// let r1 = r(3, 12);
			// let r2 = r(4, 11);
			// let r3 = r(5, 6);
			// let r4 = r(9, 10);

			assert.equal(actual.findRange(1), 0, '1');
			assert.equal(actual.findRange(2), 0, '2');
			assert.equal(actual.findRange(3), 1, '3');
			assert.equal(actual.findRange(4), 2, '4');
			assert.equal(actual.findRange(5), 3, '5');
			assert.equal(actual.findRange(6), 3, '6');
			assert.equal(actual.findRange(7), 2, '7');
			assert.equal(actual.findRange(8), 2, '8');
			assert.equal(actual.findRange(9), 4, '9');
			assert.equal(actual.findRange(10), 4, '10');
			assert.equal(actual.findRange(11), 2, '11');
			assert.equal(actual.findRange(12), 1, '12');
			assert.equal(actual.findRange(13), -1, '13');
		} finally {
			textModel.dispose();
		}


	});

	test('setCollapsed', () => {
		let lines: string[] = [];
		let nRegions = 500;
		for (let i = 0; i < nRegions; i++) {
			lines.push('#region');
		}
		for (let i = 0; i < nRegions; i++) {
			lines.push('#endregion');
		}
		let model = createTextModel(lines.join('\n'));
		let actual = computeRanges(model, false, markers, MAX_FOLDING_REGIONS);
		assert.equal(actual.length, nRegions, 'len');
		for (let i = 0; i < nRegions; i++) {
			actual.setCollapsed(i, i % 3 === 0);
		}
		for (let i = 0; i < nRegions; i++) {
			assert.equal(actual.isCollapsed(i), i % 3 === 0, 'line' + i);
		}
	});
});
