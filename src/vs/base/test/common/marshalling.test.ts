/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { parse, stringify } from 'vs/base/common/marshalling';

suite('Marshalling', () => {

	test('RegExp', () => {
		let value = /foo/img;
		let raw = stringify(value);
		let clone = <RegExp>parse(raw);

		assert.equal(value.source, clone.source);
		assert.equal(value.global, clone.global);
		assert.equal(value.ignoreCase, clone.ignoreCase);
		assert.equal(value.multiline, clone.multiline);
	});

	test('URI', () => {
		const value = URI.from({ scheme: 'file', authority: 'server', path: '/shares/c#files', query: 'q', fragment: 'f' });
		const raw = stringify(value);
		const clone = <URI>parse(raw);

		assert.equal(value.scheme, clone.scheme);
		assert.equal(value.authority, clone.authority);
		assert.equal(value.path, clone.path);
		assert.equal(value.query, clone.query);
		assert.equal(value.fragment, clone.fragment);
	});

	test('Bug 16793:# in folder name => mirror models get out of sync', () => {
		const uri1 = URI.file('C:\\C#\\file.txt');
		assert.equal(parse(stringify(uri1)).toString(), uri1.toString());
	});
});
