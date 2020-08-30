/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Snippet, SnippetSource } from 'vs/workbench/contrib/snippets/browser/snippetsFile';

suite('SnippetRewrite', function () {

	function assertRewrite(input: string, expected: string | boolean): void {
		const actual = new Snippet(['foo'], 'foo', 'foo', 'foo', input, 'foo', SnippetSource.User);
		if (typeof expected === 'boolean') {
			assert.equal(actual.codeSnippet, input);
		} else {
			assert.equal(actual.codeSnippet, expected);
		}
	}

	test('bogous variable rewrite', function () {

		assertRewrite('foo', false);
		assertRewrite('hello $1 world$0', false);

		assertRewrite('$foo and $foo', '${1:foo} and ${1:foo}');
		assertRewrite('$1 and $SELECTION and $foo', '$1 and ${SELECTION} and ${2:foo}');


		assertRewrite(
			[
				'for (var ${index} = 0; ${index} < ${array}.length; ${index}++) {',
				'\tvar ${element} = ${array}[${index}];',
				'\t$0',
				'}'
			].join('\n'),
			[
				'for (var ${1:index} = 0; ${1:index} < ${2:array}.length; ${1:index}++) {',
				'\tvar ${3:element} = ${2:array}[${1:index}];',
				'\t$0',
				'\\}'
			].join('\n')
		);
	});

	test('Snippet choices: unable to escape comma and pipe, #31521', function () {
		assertRewrite('console.log(${1|not\\, not, five, 5, 1   23|});', false);
	});

	test('lazy bogous variable rewrite', function () {
		const snippet = new Snippet(['fooLang'], 'foo', 'prefix', 'desc', 'This is ${bogous} because it is a ${var}', 'source', SnippetSource.Extension);
		assert.equal(snippet.body, 'This is ${bogous} because it is a ${var}');
		assert.equal(snippet.codeSnippet, 'This is ${1:bogous} because it is a ${2:var}');
		assert.equal(snippet.isBogous, true);
	});
});
