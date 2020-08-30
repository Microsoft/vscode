/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ok } from 'vs/base/common/assert';

suite('Assert', () => {
	test('ok', () => {
		assert.throws(function () {
			ok(false);
		});

		assert.throws(function () {
			ok(null);
		});

		assert.throws(function () {
			ok();
		});

		assert.throws(function () {
			ok(null, 'Foo Bar');
		}, function (e: Error) {
			return e.message.indexOf('Foo Bar') >= 0;
		});

		ok(true);
		ok('foo');
		ok({});
		ok(5);
	});
});
