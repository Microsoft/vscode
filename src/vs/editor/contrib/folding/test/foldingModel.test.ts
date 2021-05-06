/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { FoldingModel, setCollapseStateAtLevel, setCollapseStateLevelsDown, setCollapseStateLevelsUp, setCollapseStateForMatchingLines, setCollapseStateUp, setCollapseStateForRest } from 'vs/editor/contrib/folding/foldingModel';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { computeRanges } from 'vs/editor/contrib/folding/indentRangeProvider';
import { TrackedRangeStickiness, IModelDeltaDecoration, ITextModel, IModelDecorationsChangeAccessor } from 'vs/editor/common/model';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { FoldingRegion } from 'vs/editor/contrib/folding/foldingRanges';
import { escapeRegExpCharacters } from 'vs/base/common/strings';


interface ExpectedRegion {
	startLineNumber: number;
	endLineNumber: number;
	isCollapsed: boolean;
}

interface ExpectedDecoration {
	line: number;
	type: 'hidden' | 'collapsed' | 'expanded';
}

export class TestDecorationProvider {

	private static readonly collapsedDecoration = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		linesDecorationsClassName: 'folding'
	});

	private static readonly expandedDecoration = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		linesDecorationsClassName: 'folding'
	});

	private static readonly hiddenDecoration = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		linesDecorationsClassName: 'folding'
	});

	constructor(private model: ITextModel) {
	}

	getDecorationOption(isCollapsed: boolean, isHidden: boolean): ModelDecorationOptions {
		if (isHidden) {
			return TestDecorationProvider.hiddenDecoration;
		}
		if (isCollapsed) {
			return TestDecorationProvider.collapsedDecoration;
		}
		return TestDecorationProvider.expandedDecoration;
	}

	deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[] {
		return this.model.deltaDecorations(oldDecorations, newDecorations);
	}

	changeDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): (T | null) {
		return this.model.changeDecorations(callback);
	}

	getDecorations(): ExpectedDecoration[] {
		const decorations = this.model.getAllDecorations();
		const res: ExpectedDecoration[] = [];
		for (let decoration of decorations) {
			if (decoration.options === TestDecorationProvider.hiddenDecoration) {
				res.push({ line: decoration.range.startLineNumber, type: 'hidden' });
			} else if (decoration.options === TestDecorationProvider.collapsedDecoration) {
				res.push({ line: decoration.range.startLineNumber, type: 'collapsed' });
			} else if (decoration.options === TestDecorationProvider.expandedDecoration) {
				res.push({ line: decoration.range.startLineNumber, type: 'expanded' });
			}
		}
		return res;
	}
}

suite('Folding Model', () => {
	function r(startLineNumber: number, endLineNumber: number, isCollapsed: boolean = false): ExpectedRegion {
		return { startLineNumber, endLineNumber, isCollapsed };
	}

	function d(line: number, type: 'hidden' | 'collapsed' | 'expanded'): ExpectedDecoration {
		return { line, type };
	}

	function assertRegion(actual: FoldingRegion | null, expected: ExpectedRegion | null, message?: string) {
		assert.strictEqual(!!actual, !!expected, message);
		if (actual && expected) {
			assert.strictEqual(actual.startLineNumber, expected.startLineNumber, message);
			assert.strictEqual(actual.endLineNumber, expected.endLineNumber, message);
			assert.strictEqual(actual.isCollapsed, expected.isCollapsed, message);
		}
	}

	function assertFoldedRanges(foldingModel: FoldingModel, expectedRegions: ExpectedRegion[], message?: string) {
		let actualRanges: ExpectedRegion[] = [];
		let actual = foldingModel.regions;
		for (let i = 0; i < actual.length; i++) {
			if (actual.isCollapsed(i)) {
				actualRanges.push(r(actual.getStartLineNumber(i), actual.getEndLineNumber(i)));
			}
		}
		assert.deepStrictEqual(actualRanges, expectedRegions, message);
	}

	function assertRanges(foldingModel: FoldingModel, expectedRegions: ExpectedRegion[], message?: string) {
		let actualRanges: ExpectedRegion[] = [];
		let actual = foldingModel.regions;
		for (let i = 0; i < actual.length; i++) {
			actualRanges.push(r(actual.getStartLineNumber(i), actual.getEndLineNumber(i), actual.isCollapsed(i)));
		}
		assert.deepStrictEqual(actualRanges, expectedRegions, message);
	}

	function assertDecorations(foldingModel: FoldingModel, expectedDecoration: ExpectedDecoration[], message?: string) {
		const decorationProvider = foldingModel.decorationProvider as TestDecorationProvider;
		assert.deepStrictEqual(decorationProvider.getDecorations(), expectedDecoration, message);
	}

	function assertRegions(actual: FoldingRegion[], expectedRegions: ExpectedRegion[], message?: string) {
		assert.deepStrictEqual(actual.map(r => ({ startLineNumber: r.startLineNumber, endLineNumber: r.endLineNumber, isCollapsed: r.isCollapsed })), expectedRegions, message);
	}

	test('getRegionAtLine', () => {
		let lines = [
		/* 1*/	'/**',
		/* 2*/	' * Comment',
		/* 3*/	' */',
		/* 4*/	'class A {',
		/* 5*/	'  void foo() {',
		/* 6*/	'    // comment {',
		/* 7*/	'  }',
		/* 8*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, undefined);
			foldingModel.update(ranges);

			let r1 = r(1, 3, false);
			let r2 = r(4, 7, false);
			let r3 = r(5, 6, false);

			assertRanges(foldingModel, [r1, r2, r3]);

			assertRegion(foldingModel.getRegionAtLine(1), r1, '1');
			assertRegion(foldingModel.getRegionAtLine(2), r1, '2');
			assertRegion(foldingModel.getRegionAtLine(3), r1, '3');
			assertRegion(foldingModel.getRegionAtLine(4), r2, '4');
			assertRegion(foldingModel.getRegionAtLine(5), r3, '5');
			assertRegion(foldingModel.getRegionAtLine(6), r3, '5');
			assertRegion(foldingModel.getRegionAtLine(7), r2, '6');
			assertRegion(foldingModel.getRegionAtLine(8), null, '7');
		} finally {
			textModel.dispose();
		}


	});

	test('collapse', () => {
		let lines = [
		/* 1*/	'/**',
		/* 2*/	' * Comment',
		/* 3*/	' */',
		/* 4*/	'class A {',
		/* 5*/	'  void foo() {',
		/* 6*/	'    // comment {',
		/* 7*/	'  }',
		/* 8*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, undefined);
			foldingModel.update(ranges);

			let r1 = r(1, 3, false);
			let r2 = r(4, 7, false);
			let r3 = r(5, 6, false);

			assertRanges(foldingModel, [r1, r2, r3]);

			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(1)!]);
			foldingModel.update(ranges);

			assertRanges(foldingModel, [r(1, 3, true), r2, r3]);

			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(5)!]);
			foldingModel.update(ranges);

			assertRanges(foldingModel, [r(1, 3, true), r2, r(5, 6, true)]);

			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(7)!]);
			foldingModel.update(ranges);

			assertRanges(foldingModel, [r(1, 3, true), r(4, 7, true), r(5, 6, true)]);

			textModel.dispose();
		} finally {
			textModel.dispose();
		}

	});

	test('update', () => {
		let lines = [
		/* 1*/	'/**',
		/* 2*/	' * Comment',
		/* 3*/	' */',
		/* 4*/	'class A {',
		/* 5*/	'  void foo() {',
		/* 6*/	'    // comment {',
		/* 7*/	'  }',
		/* 8*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, undefined);
			foldingModel.update(ranges);

			let r1 = r(1, 3, false);
			let r2 = r(4, 7, false);
			let r3 = r(5, 6, false);

			assertRanges(foldingModel, [r1, r2, r3]);
			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(2)!, foldingModel.getRegionAtLine(5)!]);

			textModel.applyEdits([EditOperation.insert(new Position(4, 1), '//hello\n')]);

			foldingModel.update(computeRanges(textModel, false, undefined));

			assertRanges(foldingModel, [r(1, 3, true), r(5, 8, false), r(6, 7, true)]);
		} finally {
			textModel.dispose();
		}
	});

	test('delete', () => {
		let lines = [
		/* 1*/	'function foo() {',
		/* 2*/	'  switch (x) {',
		/* 3*/	'    case 1:',
		/* 4*/	'      //hello1',
		/* 5*/	'      break;',
		/* 6*/	'    case 2:',
		/* 7*/	'      //hello2',
		/* 8*/	'      break;',
		/* 9*/	'    case 3:',
		/* 10*/	'      //hello3',
		/* 11*/	'      break;',
		/* 12*/	'  }',
		/* 13*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, undefined);
			foldingModel.update(ranges);

			let r1 = r(1, 12, false);
			let r2 = r(2, 11, false);
			let r3 = r(3, 5, false);
			let r4 = r(6, 8, false);
			let r5 = r(9, 11, false);

			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);
			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(6)!]);

			textModel.applyEdits([EditOperation.delete(new Range(6, 11, 9, 0))]);

			foldingModel.update(computeRanges(textModel, false, undefined));

			assertRanges(foldingModel, [r(1, 9, false), r(2, 8, false), r(3, 5, false), r(6, 8, false)]);
		} finally {
			textModel.dispose();
		}
	});

	test('getRegionsInside', () => {
		let lines = [
		/* 1*/	'/**',
		/* 2*/	' * Comment',
		/* 3*/	' */',
		/* 4*/	'class A {',
		/* 5*/	'  void foo() {',
		/* 6*/	'    // comment {',
		/* 7*/	'  }',
		/* 8*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, undefined);
			foldingModel.update(ranges);

			let r1 = r(1, 3, false);
			let r2 = r(4, 7, false);
			let r3 = r(5, 6, false);

			assertRanges(foldingModel, [r1, r2, r3]);
			let region1 = foldingModel.getRegionAtLine(r1.startLineNumber);
			let region2 = foldingModel.getRegionAtLine(r2.startLineNumber);
			let region3 = foldingModel.getRegionAtLine(r3.startLineNumber);

			assertRegions(foldingModel.getRegionsInside(null), [r1, r2, r3], '1');
			assertRegions(foldingModel.getRegionsInside(region1), [], '2');
			assertRegions(foldingModel.getRegionsInside(region2), [r3], '3');
			assertRegions(foldingModel.getRegionsInside(region3), [], '4');
		} finally {
			textModel.dispose();
		}

	});

	test('getRegionsInsideWithLevel', () => {
		let lines = [
			/* 1*/	'//#region',
			/* 2*/	'//#endregion',
			/* 3*/	'class A {',
			/* 4*/	'  void foo() {',
			/* 5*/	'    if (true) {',
			/* 6*/	'        return;',
			/* 7*/	'    }',
			/* 8*/	'    if (true) {',
			/* 9*/	'      return;',
			/* 10*/	'    }',
			/* 11*/	'  }',
			/* 12*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {

			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 11, false);
			let r3 = r(4, 10, false);
			let r4 = r(5, 6, false);
			let r5 = r(8, 9, false);

			let region1 = foldingModel.getRegionAtLine(r1.startLineNumber);
			let region2 = foldingModel.getRegionAtLine(r2.startLineNumber);
			let region3 = foldingModel.getRegionAtLine(r3.startLineNumber);

			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			assertRegions(foldingModel.getRegionsInside(null, (r, level) => level === 1), [r1, r2], '1');
			assertRegions(foldingModel.getRegionsInside(null, (r, level) => level === 2), [r3], '2');
			assertRegions(foldingModel.getRegionsInside(null, (r, level) => level === 3), [r4, r5], '3');

			assertRegions(foldingModel.getRegionsInside(region2, (r, level) => level === 1), [r3], '4');
			assertRegions(foldingModel.getRegionsInside(region2, (r, level) => level === 2), [r4, r5], '5');
			assertRegions(foldingModel.getRegionsInside(region3, (r, level) => level === 1), [r4, r5], '6');

			assertRegions(foldingModel.getRegionsInside(region2, (r, level) => r.hidesLine(9)), [r3, r5], '7');

			assertRegions(foldingModel.getRegionsInside(region1, (r, level) => level === 1), [], '8');
		} finally {
			textModel.dispose();
		}

	});

	test('getRegionAtLine', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'class A {',
		/* 3*/	'  void foo() {',
		/* 4*/	'    if (true) {',
		/* 5*/	'      //hello',
		/* 6*/	'    }',
		/* 7*/	'',
		/* 8*/	'  }',
		/* 9*/	'}',
		/* 10*/	'//#endregion',
		/* 11*/	''];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 10, false);
			let r2 = r(2, 8, false);
			let r3 = r(3, 7, false);
			let r4 = r(4, 5, false);

			assertRanges(foldingModel, [r1, r2, r3, r4]);

			assertRegions(foldingModel.getAllRegionsAtLine(1), [r1], '1');
			assertRegions(foldingModel.getAllRegionsAtLine(2), [r1, r2].reverse(), '2');
			assertRegions(foldingModel.getAllRegionsAtLine(3), [r1, r2, r3].reverse(), '3');
			assertRegions(foldingModel.getAllRegionsAtLine(4), [r1, r2, r3, r4].reverse(), '4');
			assertRegions(foldingModel.getAllRegionsAtLine(5), [r1, r2, r3, r4].reverse(), '5');
			assertRegions(foldingModel.getAllRegionsAtLine(6), [r1, r2, r3].reverse(), '6');
			assertRegions(foldingModel.getAllRegionsAtLine(7), [r1, r2, r3].reverse(), '7');
			assertRegions(foldingModel.getAllRegionsAtLine(8), [r1, r2].reverse(), '8');
			assertRegions(foldingModel.getAllRegionsAtLine(9), [r1], '9');
			assertRegions(foldingModel.getAllRegionsAtLine(10), [r1], '10');
			assertRegions(foldingModel.getAllRegionsAtLine(11), [], '10');
		} finally {
			textModel.dispose();
		}
	});

	test('setCollapseStateRecursivly', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'//#endregion',
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
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 12, false);
			let r3 = r(4, 11, false);
			let r4 = r(5, 6, false);
			let r5 = r(9, 10, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			setCollapseStateLevelsDown(foldingModel, true, Number.MAX_VALUE, [4]);
			assertFoldedRanges(foldingModel, [r3, r4, r5], '1');

			setCollapseStateLevelsDown(foldingModel, false, Number.MAX_VALUE, [8]);
			assertFoldedRanges(foldingModel, [], '2');

			setCollapseStateLevelsDown(foldingModel, true, Number.MAX_VALUE, [12]);
			assertFoldedRanges(foldingModel, [r2, r3, r4, r5], '1');

			setCollapseStateLevelsDown(foldingModel, false, Number.MAX_VALUE, [7]);
			assertFoldedRanges(foldingModel, [r2], '1');

			setCollapseStateLevelsDown(foldingModel, false);
			assertFoldedRanges(foldingModel, [], '1');

			setCollapseStateLevelsDown(foldingModel, true);
			assertFoldedRanges(foldingModel, [r1, r2, r3, r4, r5], '1');
		} finally {
			textModel.dispose();
		}

	});

	test('setCollapseStateAtLevel', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'//#endregion',
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
		/* 13*/	'  //#region',
		/* 14*/	'  const bar = 9;',
		/* 15*/	'  //#endregion',
		/* 16*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\s*\/\/#region$/, end: /^\s*\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 15, false);
			let r3 = r(4, 11, false);
			let r4 = r(5, 6, false);
			let r5 = r(9, 10, false);
			let r6 = r(13, 15, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5, r6]);

			setCollapseStateAtLevel(foldingModel, 1, true, []);
			assertFoldedRanges(foldingModel, [r1, r2], '1');

			setCollapseStateAtLevel(foldingModel, 1, false, [5]);
			assertFoldedRanges(foldingModel, [r2], '2');

			setCollapseStateAtLevel(foldingModel, 1, false, [1]);
			assertFoldedRanges(foldingModel, [], '3');

			setCollapseStateAtLevel(foldingModel, 2, true, []);
			assertFoldedRanges(foldingModel, [r3, r6], '4');

			setCollapseStateAtLevel(foldingModel, 2, false, [5, 6]);
			assertFoldedRanges(foldingModel, [r3], '5');

			setCollapseStateAtLevel(foldingModel, 3, true, [4, 9]);
			assertFoldedRanges(foldingModel, [r3, r4], '6');

			setCollapseStateAtLevel(foldingModel, 3, false, [4, 9]);
			assertFoldedRanges(foldingModel, [r3], '7');
		} finally {
			textModel.dispose();
		}
	});

	test('setCollapseStateLevelsDown', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'//#endregion',
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
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 12, false);
			let r3 = r(4, 11, false);
			let r4 = r(5, 6, false);
			let r5 = r(9, 10, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			setCollapseStateLevelsDown(foldingModel, true, 1, [4]);
			assertFoldedRanges(foldingModel, [r3], '1');

			setCollapseStateLevelsDown(foldingModel, true, 2, [4]);
			assertFoldedRanges(foldingModel, [r3, r4, r5], '2');

			setCollapseStateLevelsDown(foldingModel, false, 2, [3]);
			assertFoldedRanges(foldingModel, [r4, r5], '3');

			setCollapseStateLevelsDown(foldingModel, false, 2, [2]);
			assertFoldedRanges(foldingModel, [r4, r5], '4');

			setCollapseStateLevelsDown(foldingModel, true, 4, [2]);
			assertFoldedRanges(foldingModel, [r1, r4, r5], '5');

			setCollapseStateLevelsDown(foldingModel, false, 4, [2, 3]);
			assertFoldedRanges(foldingModel, [], '6');
		} finally {
			textModel.dispose();
		}
	});

	test('setCollapseStateLevelsUp', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'//#endregion',
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
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 12, false);
			let r3 = r(4, 11, false);
			let r4 = r(5, 6, false);
			let r5 = r(9, 10, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			setCollapseStateLevelsUp(foldingModel, true, 1, [4]);
			assertFoldedRanges(foldingModel, [r3], '1');

			setCollapseStateLevelsUp(foldingModel, true, 2, [4]);
			assertFoldedRanges(foldingModel, [r2, r3], '2');

			setCollapseStateLevelsUp(foldingModel, false, 4, [1, 3, 4]);
			assertFoldedRanges(foldingModel, [], '3');

			setCollapseStateLevelsUp(foldingModel, true, 2, [10]);
			assertFoldedRanges(foldingModel, [r3, r5], '4');
		} finally {
			textModel.dispose();
		}

	});

	test('setCollapseStateUp', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'//#endregion',
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
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 12, false);
			let r3 = r(4, 11, false);
			let r4 = r(5, 6, false);
			let r5 = r(9, 10, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			setCollapseStateUp(foldingModel, true, [5]);
			assertFoldedRanges(foldingModel, [r4], '1');

			setCollapseStateUp(foldingModel, true, [5]);
			assertFoldedRanges(foldingModel, [r3, r4], '2');

			setCollapseStateUp(foldingModel, true, [4]);
			assertFoldedRanges(foldingModel, [r2, r3, r4], '2');
		} finally {
			textModel.dispose();
		}

	});


	test('setCollapseStateForMatchingLines', () => {
		let lines = [
		/* 1*/	'/**',
		/* 2*/	' * the class',
		/* 3*/	' */',
		/* 4*/	'class A {',
		/* 5*/	'  /**',
		/* 6*/	'   * the foo',
		/* 7*/	'   */',
		/* 8*/	'  void foo() {',
		/* 9*/	'    /*',
		/* 10*/	'     * the comment',
		/* 11*/	'     */',
		/* 12*/	'  }',
		/* 13*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 3, false);
			let r2 = r(4, 12, false);
			let r3 = r(5, 7, false);
			let r4 = r(8, 11, false);
			let r5 = r(9, 11, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			let regExp = new RegExp('^\\s*' + escapeRegExpCharacters('/*'));
			setCollapseStateForMatchingLines(foldingModel, regExp, true);
			assertFoldedRanges(foldingModel, [r1, r3, r5], '1');
		} finally {
			textModel.dispose();
		}

	});


	test('setCollapseStateForRest', () => {
		let lines = [
		/* 1*/	'//#region',
		/* 2*/	'//#endregion',
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
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, { start: /^\/\/#region$/, end: /^\/\/#endregion$/ });
			foldingModel.update(ranges);

			let r1 = r(1, 2, false);
			let r2 = r(3, 12, false);
			let r3 = r(4, 11, false);
			let r4 = r(5, 6, false);
			let r5 = r(9, 10, false);
			assertRanges(foldingModel, [r1, r2, r3, r4, r5]);

			setCollapseStateForRest(foldingModel, true, [5]);
			assertFoldedRanges(foldingModel, [r1, r5], '1');

			setCollapseStateForRest(foldingModel, false, [5]);
			assertFoldedRanges(foldingModel, [], '2');

			setCollapseStateForRest(foldingModel, true, [1]);
			assertFoldedRanges(foldingModel, [r2, r3, r4, r5], '3');

			setCollapseStateForRest(foldingModel, true, [3]);
			assertFoldedRanges(foldingModel, [r1, r2, r3, r4, r5], '3');

		} finally {
			textModel.dispose();
		}

	});


	test('folding decoration', () => {
		let lines = [
		/* 1*/	'class A {',
		/* 2*/	'  void foo() {',
		/* 3*/	'    if (true) {',
		/* 4*/	'      hoo();',
		/* 5*/	'    }',
		/* 6*/	'  }',
		/* 7*/	'}'];

		let textModel = createTextModel(lines.join('\n'));
		try {
			let foldingModel = new FoldingModel(textModel, new TestDecorationProvider(textModel));

			let ranges = computeRanges(textModel, false, undefined);
			foldingModel.update(ranges);

			let r1 = r(1, 6, false);
			let r2 = r(2, 5, false);
			let r3 = r(3, 4, false);

			assertRanges(foldingModel, [r1, r2, r3]);
			assertDecorations(foldingModel, [d(1, 'expanded'), d(2, 'expanded'), d(3, 'expanded')]);

			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(2)!]);

			assertRanges(foldingModel, [r1, r(2, 5, true), r3]);
			assertDecorations(foldingModel, [d(1, 'expanded'), d(2, 'collapsed'), d(3, 'hidden')]);

			foldingModel.update(ranges);

			assertRanges(foldingModel, [r1, r(2, 5, true), r3]);
			assertDecorations(foldingModel, [d(1, 'expanded'), d(2, 'collapsed'), d(3, 'hidden')]);

			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(1)!]);

			assertRanges(foldingModel, [r(1, 6, true), r(2, 5, true), r3]);
			assertDecorations(foldingModel, [d(1, 'collapsed'), d(2, 'hidden'), d(3, 'hidden')]);

			foldingModel.update(ranges);

			assertRanges(foldingModel, [r(1, 6, true), r(2, 5, true), r3]);
			assertDecorations(foldingModel, [d(1, 'collapsed'), d(2, 'hidden'), d(3, 'hidden')]);

			foldingModel.toggleCollapseState([foldingModel.getRegionAtLine(1)!, foldingModel.getRegionAtLine(3)!]);

			assertRanges(foldingModel, [r1, r(2, 5, true), r(3, 4, true)]);
			assertDecorations(foldingModel, [d(1, 'expanded'), d(2, 'collapsed'), d(3, 'hidden')]);

			foldingModel.update(ranges);

			assertRanges(foldingModel, [r1, r(2, 5, true), r(3, 4, true)]);
			assertDecorations(foldingModel, [d(1, 'expanded'), d(2, 'collapsed'), d(3, 'hidden')]);

			textModel.dispose();
		} finally {
			textModel.dispose();
		}

	});

});
