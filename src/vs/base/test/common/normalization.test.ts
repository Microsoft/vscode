/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { removeAccents } from 'vs/base/common/normalization';

suite('Normalization', () => {

	test('removeAccents', function () {
		assert.equal(removeAccents('joào'), 'joao');
		assert.equal(removeAccents('joáo'), 'joao');
		assert.equal(removeAccents('joâo'), 'joao');
		assert.equal(removeAccents('joäo'), 'joao');
		// assert.equal(strings.removeAccents('joæo'), 'joao'); // not an accent
		assert.equal(removeAccents('joão'), 'joao');
		assert.equal(removeAccents('joåo'), 'joao');
		assert.equal(removeAccents('joåo'), 'joao');
		assert.equal(removeAccents('joāo'), 'joao');

		assert.equal(removeAccents('fôo'), 'foo');
		assert.equal(removeAccents('föo'), 'foo');
		assert.equal(removeAccents('fòo'), 'foo');
		assert.equal(removeAccents('fóo'), 'foo');
		// assert.equal(strings.removeAccents('fœo'), 'foo');
		// assert.equal(strings.removeAccents('føo'), 'foo');
		assert.equal(removeAccents('fōo'), 'foo');
		assert.equal(removeAccents('fõo'), 'foo');

		assert.equal(removeAccents('andrè'), 'andre');
		assert.equal(removeAccents('andré'), 'andre');
		assert.equal(removeAccents('andrê'), 'andre');
		assert.equal(removeAccents('andrë'), 'andre');
		assert.equal(removeAccents('andrē'), 'andre');
		assert.equal(removeAccents('andrė'), 'andre');
		assert.equal(removeAccents('andrę'), 'andre');

		assert.equal(removeAccents('hvîc'), 'hvic');
		assert.equal(removeAccents('hvïc'), 'hvic');
		assert.equal(removeAccents('hvíc'), 'hvic');
		assert.equal(removeAccents('hvīc'), 'hvic');
		assert.equal(removeAccents('hvįc'), 'hvic');
		assert.equal(removeAccents('hvìc'), 'hvic');

		assert.equal(removeAccents('ûdo'), 'udo');
		assert.equal(removeAccents('üdo'), 'udo');
		assert.equal(removeAccents('ùdo'), 'udo');
		assert.equal(removeAccents('údo'), 'udo');
		assert.equal(removeAccents('ūdo'), 'udo');

		assert.equal(removeAccents('heÿ'), 'hey');

		// assert.equal(strings.removeAccents('gruß'), 'grus');
		assert.equal(removeAccents('gruś'), 'grus');
		assert.equal(removeAccents('gruš'), 'grus');

		assert.equal(removeAccents('çool'), 'cool');
		assert.equal(removeAccents('ćool'), 'cool');
		assert.equal(removeAccents('čool'), 'cool');

		assert.equal(removeAccents('ñice'), 'nice');
		assert.equal(removeAccents('ńice'), 'nice');
	});
});
