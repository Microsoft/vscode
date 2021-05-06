/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { removeAccents } from 'vs/base/common/normalization';

suite('Normalization', () => {

	test('removeAccents', function () {
		assert.strictEqual(removeAccents('joào'), 'joao');
		assert.strictEqual(removeAccents('joáo'), 'joao');
		assert.strictEqual(removeAccents('joâo'), 'joao');
		assert.strictEqual(removeAccents('joäo'), 'joao');
		// assert.strictEqual(strings.removeAccents('joæo'), 'joao'); // not an accent
		assert.strictEqual(removeAccents('joão'), 'joao');
		assert.strictEqual(removeAccents('joåo'), 'joao');
		assert.strictEqual(removeAccents('joåo'), 'joao');
		assert.strictEqual(removeAccents('joāo'), 'joao');

		assert.strictEqual(removeAccents('fôo'), 'foo');
		assert.strictEqual(removeAccents('föo'), 'foo');
		assert.strictEqual(removeAccents('fòo'), 'foo');
		assert.strictEqual(removeAccents('fóo'), 'foo');
		// assert.strictEqual(strings.removeAccents('fœo'), 'foo');
		// assert.strictEqual(strings.removeAccents('føo'), 'foo');
		assert.strictEqual(removeAccents('fōo'), 'foo');
		assert.strictEqual(removeAccents('fõo'), 'foo');

		assert.strictEqual(removeAccents('andrè'), 'andre');
		assert.strictEqual(removeAccents('andré'), 'andre');
		assert.strictEqual(removeAccents('andrê'), 'andre');
		assert.strictEqual(removeAccents('andrë'), 'andre');
		assert.strictEqual(removeAccents('andrē'), 'andre');
		assert.strictEqual(removeAccents('andrė'), 'andre');
		assert.strictEqual(removeAccents('andrę'), 'andre');

		assert.strictEqual(removeAccents('hvîc'), 'hvic');
		assert.strictEqual(removeAccents('hvïc'), 'hvic');
		assert.strictEqual(removeAccents('hvíc'), 'hvic');
		assert.strictEqual(removeAccents('hvīc'), 'hvic');
		assert.strictEqual(removeAccents('hvįc'), 'hvic');
		assert.strictEqual(removeAccents('hvìc'), 'hvic');

		assert.strictEqual(removeAccents('ûdo'), 'udo');
		assert.strictEqual(removeAccents('üdo'), 'udo');
		assert.strictEqual(removeAccents('ùdo'), 'udo');
		assert.strictEqual(removeAccents('údo'), 'udo');
		assert.strictEqual(removeAccents('ūdo'), 'udo');

		assert.strictEqual(removeAccents('heÿ'), 'hey');

		// assert.strictEqual(strings.removeAccents('gruß'), 'grus');
		assert.strictEqual(removeAccents('gruś'), 'grus');
		assert.strictEqual(removeAccents('gruš'), 'grus');

		assert.strictEqual(removeAccents('çool'), 'cool');
		assert.strictEqual(removeAccents('ćool'), 'cool');
		assert.strictEqual(removeAccents('čool'), 'cool');

		assert.strictEqual(removeAccents('ñice'), 'nice');
		assert.strictEqual(removeAccents('ńice'), 'nice');
	});
});
