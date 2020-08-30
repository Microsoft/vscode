/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { CharCode } from 'vs/base/common/charCode';
import { CharacterClassifier } from 'vs/editor/common/core/characterClassifier';

suite('CharacterClassifier', () => {

	test('works', () => {
		let classifier = new CharacterClassifier<number>(0);

		assert.equal(classifier.get(-1), 0);
		assert.equal(classifier.get(0), 0);
		assert.equal(classifier.get(CharCode.a), 0);
		assert.equal(classifier.get(CharCode.b), 0);
		assert.equal(classifier.get(CharCode.z), 0);
		assert.equal(classifier.get(255), 0);
		assert.equal(classifier.get(1000), 0);
		assert.equal(classifier.get(2000), 0);

		classifier.set(CharCode.a, 1);
		classifier.set(CharCode.z, 2);
		classifier.set(1000, 3);

		assert.equal(classifier.get(-1), 0);
		assert.equal(classifier.get(0), 0);
		assert.equal(classifier.get(CharCode.a), 1);
		assert.equal(classifier.get(CharCode.b), 0);
		assert.equal(classifier.get(CharCode.z), 2);
		assert.equal(classifier.get(255), 0);
		assert.equal(classifier.get(1000), 3);
		assert.equal(classifier.get(2000), 0);
	});

});
