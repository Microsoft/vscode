/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as uuid from 'vs/base/common/uuid';

suite('UUID', () => {
	test('generation', () => {
		const asHex = uuid.generateUuid();
		assert.equal(asHex.length, 36);
		assert.equal(asHex[14], '4');
		assert.ok(asHex[19] === '8' || asHex[19] === '9' || asHex[19] === 'a' || asHex[19] === 'b');
	});

	test('self-check', function () {
		const t1 = Date.now();
		while (Date.now() - t1 < 50) {
			const value = uuid.generateUuid();
			assert.ok(uuid.isUUID(value));
		}
	});
});
