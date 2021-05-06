/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { extractRangeFromFilter } from 'vs/workbench/contrib/search/common/search';

suite('extractRangeFromFilter', () => {

	test('basics', async function () {
		assert.ok(!extractRangeFromFilter(''));
		assert.ok(!extractRangeFromFilter('/some/path'));
		assert.ok(!extractRangeFromFilter('/some/path/file.txt'));

		for (const lineSep of [':', '#', '(', ':line ']) {
			for (const colSep of [':', '#', ',']) {
				const base = '/some/path/file.txt';

				let res = extractRangeFromFilter(`${base}${lineSep}20`);
				assert.strictEqual(res?.filter, base);
				assert.strictEqual(res?.range.startLineNumber, 20);
				assert.strictEqual(res?.range.startColumn, 1);

				res = extractRangeFromFilter(`${base}${lineSep}20${colSep}`);
				assert.strictEqual(res?.filter, base);
				assert.strictEqual(res?.range.startLineNumber, 20);
				assert.strictEqual(res?.range.startColumn, 1);

				res = extractRangeFromFilter(`${base}${lineSep}20${colSep}3`);
				assert.strictEqual(res?.filter, base);
				assert.strictEqual(res?.range.startLineNumber, 20);
				assert.strictEqual(res?.range.startColumn, 3);
			}
		}
	});

	test('allow space after path', async function () {
		const res = extractRangeFromFilter('/some/path/file.txt (19,20)');

		assert.strictEqual(res?.filter, '/some/path/file.txt');
		assert.strictEqual(res?.range.startLineNumber, 19);
		assert.strictEqual(res?.range.startColumn, 20);
	});

	test('unless', async function () {
		const res = extractRangeFromFilter('/some/path/file.txt@ (19,20)', ['@']);

		assert.ok(!res);
	});
});
