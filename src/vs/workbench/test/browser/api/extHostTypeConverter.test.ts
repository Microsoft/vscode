/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as assert from 'assert';
import { MarkdownString } from 'vs/workbench/api/common/extHostTypeConverters';
import { isEmptyObject } from 'vs/base/common/types';
import { forEach } from 'vs/base/common/collections';
import { LogLevel as _MainLogLevel } from 'vs/platform/log/common/log';
import { URI } from 'vs/base/common/uri';

suite('ExtHostTypeConverter', function () {
	function size<T>(from: Record<any, any>): number {
		let count = 0;
		for (let key in from) {
			if (Object.prototype.hasOwnProperty.call(from, key)) {
				count += 1;
			}
		}
		return count;
	}

	test('MarkdownConvert - uris', function () {

		let data = MarkdownString.from('Hello');
		assert.equal(isEmptyObject(data.uris), true);
		assert.equal(data.value, 'Hello');

		data = MarkdownString.from('Hello [link](foo)');
		assert.equal(data.value, 'Hello [link](foo)');
		assert.equal(isEmptyObject(data.uris), true); // no scheme, no uri

		data = MarkdownString.from('Hello [link](www.noscheme.bad)');
		assert.equal(data.value, 'Hello [link](www.noscheme.bad)');
		assert.equal(isEmptyObject(data.uris), true); // no scheme, no uri

		data = MarkdownString.from('Hello [link](foo:path)');
		assert.equal(data.value, 'Hello [link](foo:path)');
		assert.equal(size(data.uris!), 1);
		assert.ok(!!data.uris!['foo:path']);

		data = MarkdownString.from('hello@foo.bar');
		assert.equal(data.value, 'hello@foo.bar');
		assert.equal(size(data.uris!), 1);
		// assert.ok(!!data.uris!['mailto:hello@foo.bar']);

		data = MarkdownString.from('*hello* [click](command:me)');
		assert.equal(data.value, '*hello* [click](command:me)');
		assert.equal(size(data.uris!), 1);
		assert.ok(!!data.uris!['command:me']);

		data = MarkdownString.from('*hello* [click](file:///somepath/here). [click](file:///somepath/here)');
		assert.equal(data.value, '*hello* [click](file:///somepath/here). [click](file:///somepath/here)');
		assert.equal(size(data.uris!), 1);
		assert.ok(!!data.uris!['file:///somepath/here']);

		data = MarkdownString.from('*hello* [click](file:///somepath/here). [click](file:///somepath/here)');
		assert.equal(data.value, '*hello* [click](file:///somepath/here). [click](file:///somepath/here)');
		assert.equal(size(data.uris!), 1);
		assert.ok(!!data.uris!['file:///somepath/here']);

		data = MarkdownString.from('*hello* [click](file:///somepath/here). [click](file:///somepath/here2)');
		assert.equal(data.value, '*hello* [click](file:///somepath/here). [click](file:///somepath/here2)');
		assert.equal(size(data.uris!), 2);
		assert.ok(!!data.uris!['file:///somepath/here']);
		assert.ok(!!data.uris!['file:///somepath/here2']);
	});

	test('NPM script explorer running a script from the hover does not work #65561', function () {

		let data = MarkdownString.from('*hello* [click](command:npm.runScriptFromHover?%7B%22documentUri%22%3A%7B%22%24mid%22%3A1%2C%22external%22%3A%22file%3A%2F%2F%2Fc%253A%2Ffoo%2Fbaz.ex%22%2C%22path%22%3A%22%2Fc%3A%2Ffoo%2Fbaz.ex%22%2C%22scheme%22%3A%22file%22%7D%2C%22script%22%3A%22dev%22%7D)');
		// assert that both uri get extracted but that the latter is only decoded once...
		assert.equal(size(data.uris!), 2);
		forEach(data.uris!, entry => {
			if (entry.value.scheme === 'file') {
				assert.ok(URI.revive(entry.value).toString().indexOf('file:///c%3A') === 0);
			} else {
				assert.equal(entry.value.scheme, 'command');
			}
		});
	});
});
