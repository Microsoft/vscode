/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { LcsDiff, IDiffChange, StringDiffSequence } from 'vs/base/common/diff/diff';

function createArray<T>(length: number, value: T): T[] {
	const r: T[] = [];
	for (let i = 0; i < length; i++) {
		r[i] = value;
	}
	return r;
}

function maskBasedSubstring(str: string, mask: boolean[]): string {
	let r = '';
	for (let i = 0; i < str.length; i++) {
		if (mask[i]) {
			r += str.charAt(i);
		}
	}
	return r;
}

function assertAnswer(originalStr: string, modifiedStr: string, changes: IDiffChange[], answerStr: string, onlyLength: boolean = false): void {
	let originalMask = createArray(originalStr.length, true);
	let modifiedMask = createArray(modifiedStr.length, true);

	let i, j, change;
	for (i = 0; i < changes.length; i++) {
		change = changes[i];

		if (change.originalLength) {
			for (j = 0; j < change.originalLength; j++) {
				originalMask[change.originalStart + j] = false;
			}
		}

		if (change.modifiedLength) {
			for (j = 0; j < change.modifiedLength; j++) {
				modifiedMask[change.modifiedStart + j] = false;
			}
		}
	}

	let originalAnswer = maskBasedSubstring(originalStr, originalMask);
	let modifiedAnswer = maskBasedSubstring(modifiedStr, modifiedMask);

	if (onlyLength) {
		assert.equal(originalAnswer.length, answerStr.length);
		assert.equal(modifiedAnswer.length, answerStr.length);
	} else {
		assert.equal(originalAnswer, answerStr);
		assert.equal(modifiedAnswer, answerStr);
	}
}

function lcsInnerTest(originalStr: string, modifiedStr: string, answerStr: string, onlyLength: boolean = false): void {
	let diff = new LcsDiff(new StringDiffSequence(originalStr), new StringDiffSequence(modifiedStr));
	let changes = diff.ComputeDiff(false).changes;
	assertAnswer(originalStr, modifiedStr, changes, answerStr, onlyLength);
}

function stringPower(str: string, power: number): string {
	let r = str;
	for (let i = 0; i < power; i++) {
		r += r;
	}
	return r;
}

function lcsTest(originalStr: string, modifiedStr: string, answerStr: string) {
	lcsInnerTest(originalStr, modifiedStr, answerStr);
	for (let i = 2; i <= 5; i++) {
		lcsInnerTest(stringPower(originalStr, i), stringPower(modifiedStr, i), stringPower(answerStr, i), true);
	}
}

suite('Diff', () => {
	test('LcsDiff - different strings tests', function () {
		this.timeout(10000);
		lcsTest('heLLo world', 'hello orlando', 'heo orld');
		lcsTest('abcde', 'acd', 'acd'); // simple
		lcsTest('abcdbce', 'bcede', 'bcde'); // skip
		lcsTest('abcdefgabcdefg', 'bcehafg', 'bceafg'); // long
		lcsTest('abcde', 'fgh', ''); // no match
		lcsTest('abcfabc', 'fabc', 'fabc');
		lcsTest('0azby0', '9axbzby9', 'azby');
		lcsTest('0abc00000', '9a1b2c399999', 'abc');

		lcsTest('fooBar', 'myfooBar', 'fooBar'); // all insertions
		lcsTest('fooBar', 'fooMyBar', 'fooBar'); // all insertions
		lcsTest('fooBar', 'fooBar', 'fooBar'); // identical sequences
	});
});

suite('Diff - Ported from VS', () => {
	test('using continue processing predicate to quit early', function () {
		let left = 'abcdef';
		let right = 'abxxcyyydzzzzezzzzzzzzzzzzzzzzzzzzf';

		// We use a long non-matching portion at the end of the right-side string, so the backwards tracking logic
		// doesn't get there first.
		let predicateCallCount = 0;

		let diff = new LcsDiff(new StringDiffSequence(left), new StringDiffSequence(right), function (leftIndex, longestMatchSoFar) {
			assert.equal(predicateCallCount, 0);

			predicateCallCount++;

			assert.equal(leftIndex, 1);

			// cancel processing
			return false;
		});
		let changes = diff.ComputeDiff(true).changes;

		assert.equal(predicateCallCount, 1);

		// Doesn't include 'c', 'd', or 'e', since we quit on the first request
		assertAnswer(left, right, changes, 'abf');



		// Cancel after the first match ('c')
		diff = new LcsDiff(new StringDiffSequence(left), new StringDiffSequence(right), function (leftIndex, longestMatchSoFar) {
			assert(longestMatchSoFar <= 1); // We never see a match of length > 1

			// Continue processing as long as there hasn't been a match made.
			return longestMatchSoFar < 1;
		});
		changes = diff.ComputeDiff(true).changes;

		assertAnswer(left, right, changes, 'abcf');



		// Cancel after the second match ('d')
		diff = new LcsDiff(new StringDiffSequence(left), new StringDiffSequence(right), function (leftIndex, longestMatchSoFar) {
			assert(longestMatchSoFar <= 2); // We never see a match of length > 2

			// Continue processing as long as there hasn't been a match made.
			return longestMatchSoFar < 2;
		});
		changes = diff.ComputeDiff(true).changes;

		assertAnswer(left, right, changes, 'abcdf');



		// Cancel *one iteration* after the second match ('d')
		let hitSecondMatch = false;
		diff = new LcsDiff(new StringDiffSequence(left), new StringDiffSequence(right), function (leftIndex, longestMatchSoFar) {
			assert(longestMatchSoFar <= 2); // We never see a match of length > 2

			let hitYet = hitSecondMatch;
			hitSecondMatch = longestMatchSoFar > 1;
			// Continue processing as long as there hasn't been a match made.
			return !hitYet;
		});
		changes = diff.ComputeDiff(true).changes;

		assertAnswer(left, right, changes, 'abcdf');



		// Cancel after the third and final match ('e')
		diff = new LcsDiff(new StringDiffSequence(left), new StringDiffSequence(right), function (leftIndex, longestMatchSoFar) {
			assert(longestMatchSoFar <= 3); // We never see a match of length > 3

			// Continue processing as long as there hasn't been a match made.
			return longestMatchSoFar < 3;
		});
		changes = diff.ComputeDiff(true).changes;

		assertAnswer(left, right, changes, 'abcdef');
	});
});
