/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { toUint32 } from 'vs/base/common/uint';
import { PrefixSumComputer, PrefixSumIndexOfResult } from 'vs/editor/common/viewModel/prefixSumComputer';

function toUint32Array(arr: number[]): Uint32Array {
	const len = arr.length;
	const r = new Uint32Array(len);
	for (let i = 0; i < len; i++) {
		r[i] = toUint32(arr[i]);
	}
	return r;
}

suite('Editor ViewModel - PrefixSumComputer', () => {

	test('PrefixSumComputer', () => {
		let indexOfResult: PrefixSumIndexOfResult;

		let psc = new PrefixSumComputer(toUint32Array([1, 1, 2, 1, 3]));
		assert.equal(psc.getTotalValue(), 8);
		assert.equal(psc.getAccumulatedValue(-1), 0);
		assert.equal(psc.getAccumulatedValue(0), 1);
		assert.equal(psc.getAccumulatedValue(1), 2);
		assert.equal(psc.getAccumulatedValue(2), 4);
		assert.equal(psc.getAccumulatedValue(3), 5);
		assert.equal(psc.getAccumulatedValue(4), 8);
		indexOfResult = psc.getIndexOf(0);
		assert.equal(indexOfResult.index, 0);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(1);
		assert.equal(indexOfResult.index, 1);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(2);
		assert.equal(indexOfResult.index, 2);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(3);
		assert.equal(indexOfResult.index, 2);
		assert.equal(indexOfResult.remainder, 1);
		indexOfResult = psc.getIndexOf(4);
		assert.equal(indexOfResult.index, 3);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(5);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(6);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 1);
		indexOfResult = psc.getIndexOf(7);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 2);
		indexOfResult = psc.getIndexOf(8);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 3);

		// [1, 2, 2, 1, 3]
		psc.changeValue(1, 2);
		assert.equal(psc.getTotalValue(), 9);
		assert.equal(psc.getAccumulatedValue(0), 1);
		assert.equal(psc.getAccumulatedValue(1), 3);
		assert.equal(psc.getAccumulatedValue(2), 5);
		assert.equal(psc.getAccumulatedValue(3), 6);
		assert.equal(psc.getAccumulatedValue(4), 9);

		// [1, 0, 2, 1, 3]
		psc.changeValue(1, 0);
		assert.equal(psc.getTotalValue(), 7);
		assert.equal(psc.getAccumulatedValue(0), 1);
		assert.equal(psc.getAccumulatedValue(1), 1);
		assert.equal(psc.getAccumulatedValue(2), 3);
		assert.equal(psc.getAccumulatedValue(3), 4);
		assert.equal(psc.getAccumulatedValue(4), 7);
		indexOfResult = psc.getIndexOf(0);
		assert.equal(indexOfResult.index, 0);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(1);
		assert.equal(indexOfResult.index, 2);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(2);
		assert.equal(indexOfResult.index, 2);
		assert.equal(indexOfResult.remainder, 1);
		indexOfResult = psc.getIndexOf(3);
		assert.equal(indexOfResult.index, 3);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(4);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(5);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 1);
		indexOfResult = psc.getIndexOf(6);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 2);
		indexOfResult = psc.getIndexOf(7);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 3);

		// [1, 0, 0, 1, 3]
		psc.changeValue(2, 0);
		assert.equal(psc.getTotalValue(), 5);
		assert.equal(psc.getAccumulatedValue(0), 1);
		assert.equal(psc.getAccumulatedValue(1), 1);
		assert.equal(psc.getAccumulatedValue(2), 1);
		assert.equal(psc.getAccumulatedValue(3), 2);
		assert.equal(psc.getAccumulatedValue(4), 5);
		indexOfResult = psc.getIndexOf(0);
		assert.equal(indexOfResult.index, 0);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(1);
		assert.equal(indexOfResult.index, 3);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(2);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(3);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 1);
		indexOfResult = psc.getIndexOf(4);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 2);
		indexOfResult = psc.getIndexOf(5);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 3);

		// [1, 0, 0, 0, 3]
		psc.changeValue(3, 0);
		assert.equal(psc.getTotalValue(), 4);
		assert.equal(psc.getAccumulatedValue(0), 1);
		assert.equal(psc.getAccumulatedValue(1), 1);
		assert.equal(psc.getAccumulatedValue(2), 1);
		assert.equal(psc.getAccumulatedValue(3), 1);
		assert.equal(psc.getAccumulatedValue(4), 4);
		indexOfResult = psc.getIndexOf(0);
		assert.equal(indexOfResult.index, 0);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(1);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(2);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 1);
		indexOfResult = psc.getIndexOf(3);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 2);
		indexOfResult = psc.getIndexOf(4);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 3);

		// [1, 1, 0, 1, 1]
		psc.changeValue(1, 1);
		psc.changeValue(3, 1);
		psc.changeValue(4, 1);
		assert.equal(psc.getTotalValue(), 4);
		assert.equal(psc.getAccumulatedValue(0), 1);
		assert.equal(psc.getAccumulatedValue(1), 2);
		assert.equal(psc.getAccumulatedValue(2), 2);
		assert.equal(psc.getAccumulatedValue(3), 3);
		assert.equal(psc.getAccumulatedValue(4), 4);
		indexOfResult = psc.getIndexOf(0);
		assert.equal(indexOfResult.index, 0);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(1);
		assert.equal(indexOfResult.index, 1);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(2);
		assert.equal(indexOfResult.index, 3);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(3);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 0);
		indexOfResult = psc.getIndexOf(4);
		assert.equal(indexOfResult.index, 4);
		assert.equal(indexOfResult.remainder, 1);
	});
});
