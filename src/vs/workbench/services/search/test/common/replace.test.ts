/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ReplacePattern } from 'vs/workbench/services/search/common/replace';

suite('Replace Pattern test', () => {

	test('parse replace string', () => {
		let testParse = (input: string, expected: string, expectedHasParameters: boolean) => {
			let actual = new ReplacePattern(input, { pattern: 'somepattern', isRegExp: true });
			assert.equal(expected, actual.pattern);
			assert.equal(expectedHasParameters, actual.hasParameters);

			actual = new ReplacePattern('hello' + input + 'hi', { pattern: 'sonepattern', isRegExp: true });
			assert.equal('hello' + expected + 'hi', actual.pattern);
			assert.equal(expectedHasParameters, actual.hasParameters);
		};

		// no backslash => no treatment
		testParse('hello', 'hello', false);

		// \t => TAB
		testParse('\\thello', '\thello', false);

		// \n => LF
		testParse('\\nhello', '\nhello', false);

		// \\t => \t
		testParse('\\\\thello', '\\thello', false);

		// \\\t => \TAB
		testParse('\\\\\\thello', '\\\thello', false);

		// \\\\t => \\t
		testParse('\\\\\\\\thello', '\\\\thello', false);

		// \ at the end => no treatment
		testParse('hello\\', 'hello\\', false);

		// \ with unknown char => no treatment
		testParse('hello\\x', 'hello\\x', false);

		// \ with back reference => no treatment
		testParse('hello\\0', 'hello\\0', false);



		// $1 => no treatment
		testParse('hello$1', 'hello$1', true);
		// $2 => no treatment
		testParse('hello$2', 'hello$2', true);
		// $12 => no treatment
		testParse('hello$12', 'hello$12', true);
		// $99 => no treatment
		testParse('hello$99', 'hello$99', true);
		// $99a => no treatment
		testParse('hello$99a', 'hello$99a', true);
		// $100 => no treatment
		testParse('hello$100', 'hello$100', false);
		// $100a => no treatment
		testParse('hello$100a', 'hello$100a', false);
		// $10a0 => no treatment
		testParse('hello$10a0', 'hello$10a0', true);
		// $$ => no treatment
		testParse('hello$$', 'hello$$', false);
		// $$0 => no treatment
		testParse('hello$$0', 'hello$$0', false);

		// $0 => $&
		testParse('hello$0', 'hello$&', true);
		testParse('hello$02', 'hello$&2', true);

		testParse('hello$`', 'hello$`', true);
		testParse('hello$\'', 'hello$\'', true);
	});

	test('create pattern by passing regExp', () => {
		let expected = /abc/;
		let actual = new ReplacePattern('hello', false, expected).regExp;
		assert.deepEqual(expected, actual);

		expected = /abc/;
		actual = new ReplacePattern('hello', false, /abc/g).regExp;
		assert.deepEqual(expected, actual);

		let testObject = new ReplacePattern('hello$0', false, /abc/g);
		assert.equal(false, testObject.hasParameters);

		testObject = new ReplacePattern('hello$0', true, /abc/g);
		assert.equal(true, testObject.hasParameters);
	});

	test('get replace string if given text is a complete match', () => {
		let testObject = new ReplacePattern('hello', { pattern: 'bla', isRegExp: true });
		let actual = testObject.getReplaceString('bla');
		assert.equal('hello', actual);

		testObject = new ReplacePattern('hello', { pattern: 'bla', isRegExp: false });
		actual = testObject.getReplaceString('bla');
		assert.equal('hello', actual);

		testObject = new ReplacePattern('hello', { pattern: '(bla)', isRegExp: true });
		actual = testObject.getReplaceString('bla');
		assert.equal('hello', actual);

		testObject = new ReplacePattern('hello$0', { pattern: '(bla)', isRegExp: true });
		actual = testObject.getReplaceString('bla');
		assert.equal('hellobla', actual);

		testObject = new ReplacePattern('import * as $1 from \'$2\';', { pattern: 'let\\s+(\\w+)\\s*=\\s*require\\s*\\(\\s*[\'\"]([\\w.\\-/]+)\\s*[\'\"]\\s*\\)\\s*', isRegExp: true });
		actual = testObject.getReplaceString('let fs = require(\'fs\')');
		assert.equal('import * as fs from \'fs\';', actual);

		actual = testObject.getReplaceString('let something = require(\'fs\')');
		assert.equal('import * as something from \'fs\';', actual);

		actual = testObject.getReplaceString('let require(\'fs\')');
		assert.equal(null, actual);

		testObject = new ReplacePattern('import * as $1 from \'$1\';', { pattern: 'let\\s+(\\w+)\\s*=\\s*require\\s*\\(\\s*[\'\"]([\\w.\\-/]+)\\s*[\'\"]\\s*\\)\\s*', isRegExp: true });
		actual = testObject.getReplaceString('let something = require(\'fs\')');
		assert.equal('import * as something from \'something\';', actual);

		testObject = new ReplacePattern('import * as $2 from \'$1\';', { pattern: 'let\\s+(\\w+)\\s*=\\s*require\\s*\\(\\s*[\'\"]([\\w.\\-/]+)\\s*[\'\"]\\s*\\)\\s*', isRegExp: true });
		actual = testObject.getReplaceString('let something = require(\'fs\')');
		assert.equal('import * as fs from \'something\';', actual);

		testObject = new ReplacePattern('import * as $0 from \'$0\';', { pattern: 'let\\s+(\\w+)\\s*=\\s*require\\s*\\(\\s*[\'\"]([\\w.\\-/]+)\\s*[\'\"]\\s*\\)\\s*', isRegExp: true });
		actual = testObject.getReplaceString('let something = require(\'fs\');');
		assert.equal('import * as let something = require(\'fs\') from \'let something = require(\'fs\')\';', actual);

		testObject = new ReplacePattern('import * as $1 from \'$2\';', { pattern: 'let\\s+(\\w+)\\s*=\\s*require\\s*\\(\\s*[\'\"]([\\w.\\-/]+)\\s*[\'\"]\\s*\\)\\s*', isRegExp: false });
		actual = testObject.getReplaceString('let fs = require(\'fs\');');
		assert.equal(null, actual);

		testObject = new ReplacePattern('cat$1', { pattern: 'for(.*)', isRegExp: true });
		actual = testObject.getReplaceString('for ()');
		assert.equal('cat ()', actual);
	});

	test('get replace string for no matches', () => {
		let testObject = new ReplacePattern('hello', { pattern: 'bla', isRegExp: true });
		let actual = testObject.getReplaceString('foo');
		assert.equal(null, actual);

		testObject = new ReplacePattern('hello', { pattern: 'bla', isRegExp: false });
		actual = testObject.getReplaceString('foo');
		assert.equal(null, actual);
	});

	test('get replace string if match is sub-string of the text', () => {
		let testObject = new ReplacePattern('hello', { pattern: 'bla', isRegExp: true });
		let actual = testObject.getReplaceString('this is a bla text');
		assert.equal('hello', actual);

		testObject = new ReplacePattern('hello', { pattern: 'bla', isRegExp: false });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('hello', actual);

		testObject = new ReplacePattern('that', { pattern: 'this(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('that', actual);

		testObject = new ReplacePattern('$1at', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('that', actual);

		testObject = new ReplacePattern('$1e', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('the', actual);

		testObject = new ReplacePattern('$1ere', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('there', actual);

		testObject = new ReplacePattern('$1', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('th', actual);

		testObject = new ReplacePattern('ma$1', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('math', actual);

		testObject = new ReplacePattern('ma$1s', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('maths', actual);

		testObject = new ReplacePattern('ma$1s', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('maths', actual);

		testObject = new ReplacePattern('$0', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('this', actual);

		testObject = new ReplacePattern('$0$1', { pattern: '(th)is(?=.*bla)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('thisth', actual);

		testObject = new ReplacePattern('foo', { pattern: 'bla(?=\\stext$)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('foo', actual);

		testObject = new ReplacePattern('f$1', { pattern: 'b(la)(?=\\stext$)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('fla', actual);

		testObject = new ReplacePattern('f$0', { pattern: 'b(la)(?=\\stext$)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('fbla', actual);

		testObject = new ReplacePattern('$0ah', { pattern: 'b(la)(?=\\stext$)', isRegExp: true });
		actual = testObject.getReplaceString('this is a bla text');
		assert.equal('blaah', actual);

		testObject = new ReplacePattern('newrege$1', true, /Testrege(\w*)/);
		actual = testObject.getReplaceString('Testregex', true);
		assert.equal('Newregex', actual);

		testObject = new ReplacePattern('newrege$1', true, /TESTREGE(\w*)/);
		actual = testObject.getReplaceString('TESTREGEX', true);
		assert.equal('NEWREGEX', actual);

		testObject = new ReplacePattern('new_rege$1', true, /Test_Rege(\w*)/);
		actual = testObject.getReplaceString('Test_Regex', true);
		assert.equal('New_Regex', actual);

		testObject = new ReplacePattern('new-rege$1', true, /Test-Rege(\w*)/);
		actual = testObject.getReplaceString('Test-Regex', true);
		assert.equal('New-Regex', actual);
	});
});
