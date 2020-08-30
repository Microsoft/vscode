/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { FoldingModel } from 'vs/editor/contrib/folding/foldingModel';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { computeRanges } from 'vs/editor/contrib/folding/indentRangeProvider';
import { TestDecorationProvider } from './foldingModel.test';
import { HiddenRangeModel } from 'vs/editor/contrib/folding/hiddenRangeModel';
import { IRange } from 'vs/editor/common/core/range';


interface ExpectedRange {
	startLineNumber: number;
	endLineNumber: number;
}

suite('Hidden Range Model', () => {
	function r(startLineNumber: number, endLineNumber: number): ExpectedRange {
		return { startLineNumber, endLineNumber };
	}

	function assertRanges(actual: IRange[], expectedRegions: ExpectedRange[], message?: string) {
		assert.deepEqual(actual.map(r => ({ startLineNumber: r.startLineNumber, endLineNumber: r.endLineNumber })), expectedRegions, message);
	}

	test('hasRanges', () => {
		let lines = [
		/* 1*/	'/**',
		/* 2*/	' * Comment',
		/* 3*/	' */',
		/* 4*/	'class A {',
		/* 5*/	'  void foo() {',
		/* 6*/	'    if (true) {',
		/* 7*/	'      //hello',
		/* 8*/	'    }',
		/* 9*/	'  }',
		/* 10*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));
		let hiddenRangeModel = new HiddenRangeModel(foldingModel);

		assert.equal(hiddenRangeModel.hasRanges(), false);

		let ranges = computeRanges(textModel, false, undefined);
		foldingModel.update(ranges);

		foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(1)!, foldingModel.getRegionAtLine(6)!]);
		assertRanges(hiddenRangeModel.hiddenRanges, [r(2, 3), r(7, 7)]);

		assert.equal(hiddenRangeModel.hasRanges(), true);
		assert.equal(hiddenRangeModel.isHidden(1), false);
		assert.equal(hiddenRangeModel.isHidden(2), true);
		assert.equal(hiddenRangeModel.isHidden(3), true);
		assert.equal(hiddenRangeModel.isHidden(4), false);
		assert.equal(hiddenRangeModel.isHidden(5), false);
		assert.equal(hiddenRangeModel.isHidden(6), false);
		assert.equal(hiddenRangeModel.isHidden(7), true);
		assert.equal(hiddenRangeModel.isHidden(8), false);
		assert.equal(hiddenRangeModel.isHidden(9), false);
		assert.equal(hiddenRangeModel.isHidden(10), false);

		foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(4)!]);
		assertRanges(hiddenRangeModel.hiddenRanges, [r(2, 3), r(5, 9)]);

		assert.equal(hiddenRangeModel.hasRanges(), true);
		assert.equal(hiddenRangeModel.isHidden(1), false);
		assert.equal(hiddenRangeModel.isHidden(2), true);
		assert.equal(hiddenRangeModel.isHidden(3), true);
		assert.equal(hiddenRangeModel.isHidden(4), false);
		assert.equal(hiddenRangeModel.isHidden(5), true);
		assert.equal(hiddenRangeModel.isHidden(6), true);
		assert.equal(hiddenRangeModel.isHidden(7), true);
		assert.equal(hiddenRangeModel.isHidden(8), true);
		assert.equal(hiddenRangeModel.isHidden(9), true);
		assert.equal(hiddenRangeModel.isHidden(10), false);

		foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(1)!, foldingModel.getRegionAtLine(6)!, foldingModel.getRegionAtLine(4)!]);
		assertRanges(hiddenRangeModel.hiddenRanges, []);
		assert.equal(hiddenRangeModel.hasRanges(), false);
		assert.equal(hiddenRangeModel.isHidden(1), false);
		assert.equal(hiddenRangeModel.isHidden(2), false);
		assert.equal(hiddenRangeModel.isHidden(3), false);
		assert.equal(hiddenRangeModel.isHidden(4), false);
		assert.equal(hiddenRangeModel.isHidden(5), false);
		assert.equal(hiddenRangeModel.isHidden(6), false);
		assert.equal(hiddenRangeModel.isHidden(7), false);
		assert.equal(hiddenRangeModel.isHidden(8), false);
		assert.equal(hiddenRangeModel.isHidden(9), false);
		assert.equal(hiddenRangeModel.isHidden(10), false);

	});


});
