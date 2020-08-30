/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as decoder from 'vs/base/node/decoder';

suite('Decoder', () => {

	test('decoding', () => {
		const lineDecoder = new decoder.LineDecoder();
		let res = lineDecoder.write(Buffer.from('hello'));
		assert.equal(res.length, 0);

		res = lineDecoder.write(Buffer.from('\nworld'));
		assert.equal(res[0], 'hello');
		assert.equal(res.length, 1);

		assert.equal(lineDecoder.end(), 'world');
	});
});
