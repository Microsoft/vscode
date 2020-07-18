/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { score } from 'vs/editor/common/modes/languageSelector';

suite('LanguageSelector', function () {

	let model = {
		language: 'farboo',
		uri: URI.parse('file:///testbed/file.fb')
	};

	test('score, invalid selector', function () {
		assert.equal(score({}, model.uri, model.language, true), 0);
		assert.equal(score(undefined!, model.uri, model.language, true), 0);
		assert.equal(score(null!, model.uri, model.language, true), 0);
		assert.equal(score('', model.uri, model.language, true), 0);
	});

	test('score, any language', function () {
		assert.equal(score({ language: '*' }, model.uri, model.language, true), 5);
		assert.equal(score('*', model.uri, model.language, true), 5);

		assert.equal(score('*', URI.parse('foo:bar'), model.language, true), 5);
		assert.equal(score('farboo', URI.parse('foo:bar'), model.language, true), 10);
	});

	test('score, default schemes', function () {

		const uri = URI.parse('git:foo/file.txt');
		const language = 'farboo';

		assert.equal(score('*', uri, language, true), 5);
		assert.equal(score('farboo', uri, language, true), 10);
		assert.equal(score({ language: 'farboo', scheme: '' }, uri, language, true), 10);
		assert.equal(score({ language: 'farboo', scheme: 'git' }, uri, language, true), 10);
		assert.equal(score({ language: 'farboo', scheme: '*' }, uri, language, true), 10);
		assert.equal(score({ language: 'farboo' }, uri, language, true), 10);
		assert.equal(score({ language: '*' }, uri, language, true), 5);

		assert.equal(score({ scheme: '*' }, uri, language, true), 5);
		assert.equal(score({ scheme: 'git' }, uri, language, true), 10);
	});

	test('score, filter', function () {
		assert.equal(score('farboo', model.uri, model.language, true), 10);
		assert.equal(score({ language: 'farboo' }, model.uri, model.language, true), 10);
		assert.equal(score({ language: 'farboo', scheme: 'file' }, model.uri, model.language, true), 10);
		assert.equal(score({ language: 'farboo', scheme: 'http' }, model.uri, model.language, true), 0);

		assert.equal(score({ pattern: '**/*.fb' }, model.uri, model.language, true), 10);
		assert.equal(score({ pattern: '**/*.fb', scheme: 'file' }, model.uri, model.language, true), 10);
		assert.equal(score({ pattern: '**/*.fb' }, URI.parse('foo:bar'), model.language, true), 0);
		assert.equal(score({ pattern: '**/*.fb', scheme: 'foo' }, URI.parse('foo:bar'), model.language, true), 0);

		let doc = {
			uri: URI.parse('git:/my/file.js'),
			langId: 'javascript'
		};
		assert.equal(score('javascript', doc.uri, doc.langId, true), 10); // 0;
		assert.equal(score({ language: 'javascript', scheme: 'git' }, doc.uri, doc.langId, true), 10); // 10;
		assert.equal(score('*', doc.uri, doc.langId, true), 5); // 5
		assert.equal(score('fooLang', doc.uri, doc.langId, true), 0); // 0
		assert.equal(score(['fooLang', '*'], doc.uri, doc.langId, true), 5); // 5
	});

	test('score, max(filters)', function () {
		let match = { language: 'farboo', scheme: 'file' };
		let fail = { language: 'farboo', scheme: 'http' };

		assert.equal(score(match, model.uri, model.language, true), 10);
		assert.equal(score(fail, model.uri, model.language, true), 0);
		assert.equal(score([match, fail], model.uri, model.language, true), 10);
		assert.equal(score([fail, fail], model.uri, model.language, true), 0);
		assert.equal(score(['farboo', '*'], model.uri, model.language, true), 10);
		assert.equal(score(['*', 'farboo'], model.uri, model.language, true), 10);
	});

	test('score hasAccessToAllModels', function () {
		let doc = {
			uri: URI.parse('file:/my/file.js'),
			langId: 'javascript'
		};
		assert.equal(score('javascript', doc.uri, doc.langId, false), 0);
		assert.equal(score({ language: 'javascript', scheme: 'file' }, doc.uri, doc.langId, false), 0);
		assert.equal(score('*', doc.uri, doc.langId, false), 0);
		assert.equal(score('fooLang', doc.uri, doc.langId, false), 0);
		assert.equal(score(['fooLang', '*'], doc.uri, doc.langId, false), 0);

		assert.equal(score({ language: 'javascript', scheme: 'file', hasAccessToAllModels: true }, doc.uri, doc.langId, false), 10);
		assert.equal(score(['fooLang', '*', { language: '*', hasAccessToAllModels: true }], doc.uri, doc.langId, false), 5);
	});

	test('Document selector match - unexpected result value #60232', function () {
		let selector = {
			language: 'json',
			scheme: 'file',
			pattern: '**/*.interface.json'
		};
		let value = score(selector, URI.parse('file:///C:/Users/zlhe/Desktop/test.interface.json'), 'json', true);
		assert.equal(value, 10);
	});

	test('Document selector match - platform paths #99938', function () {
		let selector = {
			pattern: {
				base: '/home/user/Desktop',
				pattern: '*.json'
			}
		};
		let value = score(selector, URI.file('/home/user/Desktop/test.json'), 'json', true);
		assert.equal(value, 10);
	});
});
