/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Query } from 'vs/workbench/contrib/extensions/common/extensionQuery';

suite('Extension query', () => {
	test('parse', () => {
		let query = Query.parse('');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, '');

		query = Query.parse('hello');
		assert.strictEqual(query.value, 'hello');
		assert.strictEqual(query.sortBy, '');

		query = Query.parse('   hello world ');
		assert.strictEqual(query.value, 'hello world');
		assert.strictEqual(query.sortBy, '');

		query = Query.parse('@sort');
		assert.strictEqual(query.value, '@sort');
		assert.strictEqual(query.sortBy, '');

		query = Query.parse('@sort:');
		assert.strictEqual(query.value, '@sort:');
		assert.strictEqual(query.sortBy, '');

		query = Query.parse('  @sort:  ');
		assert.strictEqual(query.value, '@sort:');
		assert.strictEqual(query.sortBy, '');

		query = Query.parse('@sort:installs');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('   @sort:installs   ');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('@sort:installs-');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('@sort:installs-foo');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('@sort:installs');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('@sort:installs');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('vs @sort:installs');
		assert.strictEqual(query.value, 'vs');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('vs @sort:installs code');
		assert.strictEqual(query.value, 'vs  code');
		assert.strictEqual(query.sortBy, 'installs');

		query = Query.parse('@sort:installs @sort:ratings');
		assert.strictEqual(query.value, '');
		assert.strictEqual(query.sortBy, 'ratings');
	});

	test('toString', () => {
		let query = new Query('hello', '', '');
		assert.strictEqual(query.toString(), 'hello');

		query = new Query('hello world', '', '');
		assert.strictEqual(query.toString(), 'hello world');

		query = new Query('  hello    ', '', '');
		assert.strictEqual(query.toString(), 'hello');

		query = new Query('', 'installs', '');
		assert.strictEqual(query.toString(), '@sort:installs');

		query = new Query('', 'installs', '');
		assert.strictEqual(query.toString(), '@sort:installs');

		query = new Query('', 'installs', '');
		assert.strictEqual(query.toString(), '@sort:installs');

		query = new Query('hello', 'installs', '');
		assert.strictEqual(query.toString(), 'hello @sort:installs');

		query = new Query('  hello      ', 'installs', '');
		assert.strictEqual(query.toString(), 'hello @sort:installs');
	});

	test('isValid', () => {
		let query = new Query('hello', '', '');
		assert(query.isValid());

		query = new Query('hello world', '', '');
		assert(query.isValid());

		query = new Query('  hello    ', '', '');
		assert(query.isValid());

		query = new Query('', 'installs', '');
		assert(query.isValid());

		query = new Query('', 'installs', '');
		assert(query.isValid());

		query = new Query('', 'installs', '');
		assert(query.isValid());

		query = new Query('', 'installs', '');
		assert(query.isValid());

		query = new Query('hello', 'installs', '');
		assert(query.isValid());

		query = new Query('  hello      ', 'installs', '');
		assert(query.isValid());
	});

	test('equals', () => {
		let query1 = new Query('hello', '', '');
		let query2 = new Query('hello', '', '');
		assert(query1.equals(query2));

		query2 = new Query('hello world', '', '');
		assert(!query1.equals(query2));

		query2 = new Query('hello', 'installs', '');
		assert(!query1.equals(query2));

		query2 = new Query('hello', 'installs', '');
		assert(!query1.equals(query2));
	});

	test('autocomplete', () => {
		Query.suggestions('@sort:in').some(x => x === '@sort:installs ');
		Query.suggestions('@sort:installs').every(x => x !== '@sort:rating ');

		Query.suggestions('@category:blah').some(x => x === '@category:"extension packs" ');
		Query.suggestions('@category:"extension packs"').every(x => x !== '@category:formatters ');
	});
});
