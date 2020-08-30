/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { DecorationSegment, LineDecoration, LineDecorationsNormalizer } from 'vs/editor/common/viewLayout/lineDecorations';
import { InlineDecoration, InlineDecorationType } from 'vs/editor/common/viewModel/viewModel';

suite('Editor ViewLayout - ViewLineParts', () => {

	test('Bug 9827:Overlapping inline decorations can cause wrong inline class to be applied', () => {

		let result = LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 11, 'c1', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular)
		]);

		assert.deepEqual(result, [
			new DecorationSegment(0, 1, 'c1', 0),
			new DecorationSegment(2, 2, 'c2 c1', 0),
			new DecorationSegment(3, 9, 'c1', 0),
		]);
	});

	test('issue #3462: no whitespace shown at the end of a decorated line', () => {

		let result = LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(15, 21, 'mtkw', InlineDecorationType.Regular),
			new LineDecoration(20, 21, 'inline-folded', InlineDecorationType.Regular),
		]);

		assert.deepEqual(result, [
			new DecorationSegment(14, 18, 'mtkw', 0),
			new DecorationSegment(19, 19, 'mtkw inline-folded', 0)
		]);
	});

	test('issue #3661: Link decoration bleeds to next line when wrapping', () => {

		let result = LineDecoration.filter([
			new InlineDecoration(new Range(2, 12, 3, 30), 'detected-link', InlineDecorationType.Regular)
		], 3, 12, 500);

		assert.deepEqual(result, [
			new LineDecoration(12, 30, 'detected-link', InlineDecorationType.Regular),
		]);
	});

	test('issue #37401: Allow both before and after decorations on empty line', () => {
		let result = LineDecoration.filter([
			new InlineDecoration(new Range(4, 1, 4, 2), 'before', InlineDecorationType.Before),
			new InlineDecoration(new Range(4, 0, 4, 1), 'after', InlineDecorationType.After),
		], 4, 1, 500);

		assert.deepEqual(result, [
			new LineDecoration(1, 2, 'before', InlineDecorationType.Before),
			new LineDecoration(0, 1, 'after', InlineDecorationType.After),
		]);
	});

	test('ViewLineParts', () => {

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 2, 'c1', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 0, 'c1', 0),
			new DecorationSegment(2, 2, 'c2', 0)
		]);

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 3, 'c1', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 1, 'c1', 0),
			new DecorationSegment(2, 2, 'c2', 0)
		]);

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 4, 'c1', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 1, 'c1', 0),
			new DecorationSegment(2, 2, 'c1 c2', 0)
		]);

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 4, 'c1', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1*', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 1, 'c1 c1*', 0),
			new DecorationSegment(2, 2, 'c1 c1* c2', 0)
		]);

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 4, 'c1', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1*', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1**', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 1, 'c1 c1* c1**', 0),
			new DecorationSegment(2, 2, 'c1 c1* c1** c2', 0)
		]);

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 4, 'c1', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1*', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1**', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2*', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 1, 'c1 c1* c1**', 0),
			new DecorationSegment(2, 2, 'c1 c1* c1** c2 c2*', 0)
		]);

		assert.deepEqual(LineDecorationsNormalizer.normalize('abcabcabcabcabcabcabcabcabcabc', [
			new LineDecoration(1, 4, 'c1', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1*', InlineDecorationType.Regular),
			new LineDecoration(1, 4, 'c1**', InlineDecorationType.Regular),
			new LineDecoration(3, 4, 'c2', InlineDecorationType.Regular),
			new LineDecoration(3, 5, 'c2*', InlineDecorationType.Regular)
		]), [
			new DecorationSegment(0, 1, 'c1 c1* c1**', 0),
			new DecorationSegment(2, 2, 'c1 c1* c1** c2 c2*', 0),
			new DecorationSegment(3, 3, 'c2*', 0)
		]);
	});
});
