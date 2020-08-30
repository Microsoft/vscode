/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { StandardTokenType } from 'vs/editor/common/modes';
import { StandardAutoClosingPairConditional } from 'vs/editor/common/modes/languageConfiguration';

suite('StandardAutoClosingPairConditional', () => {

	test('Missing notIn', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}' });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), true);
		assert.equal(v.isOK(StandardTokenType.String), true);
		assert.equal(v.isOK(StandardTokenType.RegEx), true);
	});

	test('Empty notIn', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: [] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), true);
		assert.equal(v.isOK(StandardTokenType.String), true);
		assert.equal(v.isOK(StandardTokenType.RegEx), true);
	});

	test('Invalid notIn', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['bla'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), true);
		assert.equal(v.isOK(StandardTokenType.String), true);
		assert.equal(v.isOK(StandardTokenType.RegEx), true);
	});

	test('notIn in strings', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['string'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), true);
		assert.equal(v.isOK(StandardTokenType.String), false);
		assert.equal(v.isOK(StandardTokenType.RegEx), true);
	});

	test('notIn in comments', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['comment'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), false);
		assert.equal(v.isOK(StandardTokenType.String), true);
		assert.equal(v.isOK(StandardTokenType.RegEx), true);
	});

	test('notIn in regex', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['regex'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), true);
		assert.equal(v.isOK(StandardTokenType.String), true);
		assert.equal(v.isOK(StandardTokenType.RegEx), false);
	});

	test('notIn in strings nor comments', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['string', 'comment'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), false);
		assert.equal(v.isOK(StandardTokenType.String), false);
		assert.equal(v.isOK(StandardTokenType.RegEx), true);
	});

	test('notIn in strings nor regex', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['string', 'regex'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), true);
		assert.equal(v.isOK(StandardTokenType.String), false);
		assert.equal(v.isOK(StandardTokenType.RegEx), false);
	});

	test('notIn in comments nor regex', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['comment', 'regex'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), false);
		assert.equal(v.isOK(StandardTokenType.String), true);
		assert.equal(v.isOK(StandardTokenType.RegEx), false);
	});

	test('notIn in strings, comments nor regex', () => {
		let v = new StandardAutoClosingPairConditional({ open: '{', close: '}', notIn: ['string', 'comment', 'regex'] });
		assert.equal(v.isOK(StandardTokenType.Other), true);
		assert.equal(v.isOK(StandardTokenType.Comment), false);
		assert.equal(v.isOK(StandardTokenType.String), false);
		assert.equal(v.isOK(StandardTokenType.RegEx), false);
	});
});
