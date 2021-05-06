/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as glob from 'vs/base/common/glob';
import { sep } from 'vs/base/common/path';
import { isWindows } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';

suite('Glob', () => {

	// test('perf', () => {

	// 	let patterns = [
	// 		'{**/*.cs,**/*.json,**/*.csproj,**/*.sln}',
	// 		'{**/*.cs,**/*.csproj,**/*.sln}',
	// 		'{**/*.ts,**/*.tsx,**/*.js,**/*.jsx,**/*.es6,**/*.mjs,**/*.cjs}',
	// 		'**/*.go',
	// 		'{**/*.ps,**/*.ps1}',
	// 		'{**/*.c,**/*.cpp,**/*.h}',
	// 		'{**/*.fsx,**/*.fsi,**/*.fs,**/*.ml,**/*.mli}',
	// 		'{**/*.js,**/*.jsx,**/*.es6,**/*.mjs,**/*.cjs}',
	// 		'{**/*.ts,**/*.tsx}',
	// 		'{**/*.php}',
	// 		'{**/*.php}',
	// 		'{**/*.php}',
	// 		'{**/*.php}',
	// 		'{**/*.py}',
	// 		'{**/*.py}',
	// 		'{**/*.py}',
	// 		'{**/*.rs,**/*.rslib}',
	// 		'{**/*.cpp,**/*.cc,**/*.h}',
	// 		'{**/*.md}',
	// 		'{**/*.md}',
	// 		'{**/*.md}'
	// 	];

	// 	let paths = [
	// 		'/DNXConsoleApp/Program.cs',
	// 		'C:\\DNXConsoleApp\\foo\\Program.cs',
	// 		'test/qunit',
	// 		'test/test.txt',
	// 		'test/node_modules',
	// 		'.hidden.txt',
	// 		'/node_module/test/foo.js'
	// 	];

	// 	let results = 0;
	// 	let c = 1000;
	// 	console.profile('glob.match');
	// 	while (c-- > 0) {
	// 		for (let path of paths) {
	// 			for (let pattern of patterns) {
	// 				let r = glob.match(pattern, path);
	// 				if (r) {
	// 					results += 42;
	// 				}
	// 			}
	// 		}
	// 	}
	// 	console.profileEnd();
	// });

	function assertGlobMatch(pattern: string | glob.IRelativePattern, input: string) {
		assert(glob.match(pattern, input), `${pattern} should match ${input}`);
		assert(glob.match(pattern, nativeSep(input)), `${pattern} should match ${nativeSep(input)}`);
	}

	function assertNoGlobMatch(pattern: string | glob.IRelativePattern, input: string) {
		assert(!glob.match(pattern, input), `${pattern} should not match ${input}`);
		assert(!glob.match(pattern, nativeSep(input)), `${pattern} should not match ${nativeSep(input)}`);
	}

	test('simple', () => {
		let p = 'node_modules';

		assertGlobMatch(p, 'node_modules');
		assertNoGlobMatch(p, 'node_module');
		assertNoGlobMatch(p, '/node_modules');
		assertNoGlobMatch(p, 'test/node_modules');

		p = 'test.txt';
		assertGlobMatch(p, 'test.txt');
		assertNoGlobMatch(p, 'test?txt');
		assertNoGlobMatch(p, '/text.txt');
		assertNoGlobMatch(p, 'test/test.txt');

		p = 'test(.txt';
		assertGlobMatch(p, 'test(.txt');
		assertNoGlobMatch(p, 'test?txt');

		p = 'qunit';

		assertGlobMatch(p, 'qunit');
		assertNoGlobMatch(p, 'qunit.css');
		assertNoGlobMatch(p, 'test/qunit');

		// Absolute

		p = '/DNXConsoleApp/**/*.cs';
		assertGlobMatch(p, '/DNXConsoleApp/Program.cs');
		assertGlobMatch(p, '/DNXConsoleApp/foo/Program.cs');

		p = 'C:/DNXConsoleApp/**/*.cs';
		assertGlobMatch(p, 'C:\\DNXConsoleApp\\Program.cs');
		assertGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.cs');

		p = '*';
		assertGlobMatch(p, '');
	});

	test('dot hidden', function () {
		let p = '.*';

		assertGlobMatch(p, '.git');
		assertGlobMatch(p, '.hidden.txt');
		assertNoGlobMatch(p, 'git');
		assertNoGlobMatch(p, 'hidden.txt');
		assertNoGlobMatch(p, 'path/.git');
		assertNoGlobMatch(p, 'path/.hidden.txt');

		p = '**/.*';
		assertGlobMatch(p, '.git');
		assertGlobMatch(p, '.hidden.txt');
		assertNoGlobMatch(p, 'git');
		assertNoGlobMatch(p, 'hidden.txt');
		assertGlobMatch(p, 'path/.git');
		assertGlobMatch(p, 'path/.hidden.txt');
		assertNoGlobMatch(p, 'path/git');
		assertNoGlobMatch(p, 'pat.h/hidden.txt');

		p = '._*';

		assertGlobMatch(p, '._git');
		assertGlobMatch(p, '._hidden.txt');
		assertNoGlobMatch(p, 'git');
		assertNoGlobMatch(p, 'hidden.txt');
		assertNoGlobMatch(p, 'path/._git');
		assertNoGlobMatch(p, 'path/._hidden.txt');

		p = '**/._*';
		assertGlobMatch(p, '._git');
		assertGlobMatch(p, '._hidden.txt');
		assertNoGlobMatch(p, 'git');
		assertNoGlobMatch(p, 'hidden._txt');
		assertGlobMatch(p, 'path/._git');
		assertGlobMatch(p, 'path/._hidden.txt');
		assertNoGlobMatch(p, 'path/git');
		assertNoGlobMatch(p, 'pat.h/hidden._txt');
	});

	test('file pattern', function () {
		let p = '*.js';

		assertGlobMatch(p, 'foo.js');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_modules/foo.js');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');

		p = 'html.*';
		assertGlobMatch(p, 'html.js');
		assertGlobMatch(p, 'html.txt');
		assertNoGlobMatch(p, 'htm.txt');

		p = '*.*';
		assertGlobMatch(p, 'html.js');
		assertGlobMatch(p, 'html.txt');
		assertGlobMatch(p, 'htm.txt');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_modules/foo.js');

		p = 'node_modules/test/*.js';
		assertGlobMatch(p, 'node_modules/test/foo.js');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_module/test/foo.js');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');
	});

	test('star', () => {
		let p = 'node*modules';

		assertGlobMatch(p, 'node_modules');
		assertGlobMatch(p, 'node_super_modules');
		assertNoGlobMatch(p, 'node_module');
		assertNoGlobMatch(p, '/node_modules');
		assertNoGlobMatch(p, 'test/node_modules');

		p = '*';
		assertGlobMatch(p, 'html.js');
		assertGlobMatch(p, 'html.txt');
		assertGlobMatch(p, 'htm.txt');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_modules/foo.js');
	});

	test('file / folder match', function () {
		let p = '**/node_modules/**';

		assertGlobMatch(p, 'node_modules');
		assertGlobMatch(p, 'node_modules/');
		assertGlobMatch(p, 'a/node_modules');
		assertGlobMatch(p, 'a/node_modules/');
		assertGlobMatch(p, 'node_modules/foo');
		assertGlobMatch(p, 'foo/node_modules/foo/bar');
	});

	test('questionmark', () => {
		let p = 'node?modules';

		assertGlobMatch(p, 'node_modules');
		assertNoGlobMatch(p, 'node_super_modules');
		assertNoGlobMatch(p, 'node_module');
		assertNoGlobMatch(p, '/node_modules');
		assertNoGlobMatch(p, 'test/node_modules');

		p = '?';
		assertGlobMatch(p, 'h');
		assertNoGlobMatch(p, 'html.txt');
		assertNoGlobMatch(p, 'htm.txt');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_modules/foo.js');
	});

	test('globstar', () => {
		let p = '**/*.js';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'folder/foo.js');
		assertGlobMatch(p, '/node_modules/foo.js');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');
		assertNoGlobMatch(p, '/some.js/test');
		assertNoGlobMatch(p, '\\some.js\\test');

		p = '**/project.json';

		assertGlobMatch(p, 'project.json');
		assertGlobMatch(p, '/project.json');
		assertGlobMatch(p, 'some/folder/project.json');
		assertNoGlobMatch(p, 'some/folder/file_project.json');
		assertNoGlobMatch(p, 'some/folder/fileproject.json');
		assertNoGlobMatch(p, 'some/rrproject.json');
		assertNoGlobMatch(p, 'some\\rrproject.json');

		p = 'test/**';
		assertGlobMatch(p, 'test');
		assertGlobMatch(p, 'test/foo.js');
		assertGlobMatch(p, 'test/other/foo.js');
		assertNoGlobMatch(p, 'est/other/foo.js');

		p = '**';
		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'folder/foo.js');
		assertGlobMatch(p, '/node_modules/foo.js');
		assertGlobMatch(p, 'foo.jss');
		assertGlobMatch(p, 'some.js/test');

		p = 'test/**/*.js';
		assertGlobMatch(p, 'test/foo.js');
		assertGlobMatch(p, 'test/other/foo.js');
		assertGlobMatch(p, 'test/other/more/foo.js');
		assertNoGlobMatch(p, 'test/foo.ts');
		assertNoGlobMatch(p, 'test/other/foo.ts');
		assertNoGlobMatch(p, 'test/other/more/foo.ts');

		p = '**/**/*.js';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'folder/foo.js');
		assertGlobMatch(p, '/node_modules/foo.js');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');

		p = '**/node_modules/**/*.js';

		assertNoGlobMatch(p, 'foo.js');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertGlobMatch(p, 'node_modules/foo.js');
		assertGlobMatch(p, 'node_modules/some/folder/foo.js');
		assertNoGlobMatch(p, 'node_modules/some/folder/foo.ts');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');

		p = '{**/node_modules/**,**/.git/**,**/bower_components/**}';

		assertGlobMatch(p, 'node_modules');
		assertGlobMatch(p, '/node_modules');
		assertGlobMatch(p, '/node_modules/more');
		assertGlobMatch(p, 'some/test/node_modules');
		assertGlobMatch(p, 'some\\test\\node_modules');
		assertGlobMatch(p, 'C:\\\\some\\test\\node_modules');
		assertGlobMatch(p, 'C:\\\\some\\test\\node_modules\\more');

		assertGlobMatch(p, 'bower_components');
		assertGlobMatch(p, 'bower_components/more');
		assertGlobMatch(p, '/bower_components');
		assertGlobMatch(p, 'some/test/bower_components');
		assertGlobMatch(p, 'some\\test\\bower_components');
		assertGlobMatch(p, 'C:\\\\some\\test\\bower_components');
		assertGlobMatch(p, 'C:\\\\some\\test\\bower_components\\more');

		assertGlobMatch(p, '.git');
		assertGlobMatch(p, '/.git');
		assertGlobMatch(p, 'some/test/.git');
		assertGlobMatch(p, 'some\\test\\.git');
		assertGlobMatch(p, 'C:\\\\some\\test\\.git');

		assertNoGlobMatch(p, 'tempting');
		assertNoGlobMatch(p, '/tempting');
		assertNoGlobMatch(p, 'some/test/tempting');
		assertNoGlobMatch(p, 'some\\test\\tempting');
		assertNoGlobMatch(p, 'C:\\\\some\\test\\tempting');

		p = '{**/package.json,**/project.json}';
		assertGlobMatch(p, 'package.json');
		assertGlobMatch(p, '/package.json');
		assertNoGlobMatch(p, 'xpackage.json');
		assertNoGlobMatch(p, '/xpackage.json');
	});

	test('issue 41724', function () {
		let p = 'some/**/*.js';

		assertGlobMatch(p, 'some/foo.js');
		assertGlobMatch(p, 'some/folder/foo.js');
		assertNoGlobMatch(p, 'something/foo.js');
		assertNoGlobMatch(p, 'something/folder/foo.js');

		p = 'some/**/*';

		assertGlobMatch(p, 'some/foo.js');
		assertGlobMatch(p, 'some/folder/foo.js');
		assertNoGlobMatch(p, 'something/foo.js');
		assertNoGlobMatch(p, 'something/folder/foo.js');
	});

	test('brace expansion', function () {
		let p = '*.{html,js}';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'foo.html');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_modules/foo.js');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');

		p = '*.{html}';

		assertGlobMatch(p, 'foo.html');
		assertNoGlobMatch(p, 'foo.js');
		assertNoGlobMatch(p, 'folder/foo.js');
		assertNoGlobMatch(p, '/node_modules/foo.js');
		assertNoGlobMatch(p, 'foo.jss');
		assertNoGlobMatch(p, 'some.js/test');

		p = '{node_modules,testing}';
		assertGlobMatch(p, 'node_modules');
		assertGlobMatch(p, 'testing');
		assertNoGlobMatch(p, 'node_module');
		assertNoGlobMatch(p, 'dtesting');

		p = '**/{foo,bar}';
		assertGlobMatch(p, 'foo');
		assertGlobMatch(p, 'bar');
		assertGlobMatch(p, 'test/foo');
		assertGlobMatch(p, 'test/bar');
		assertGlobMatch(p, 'other/more/foo');
		assertGlobMatch(p, 'other/more/bar');

		p = '{foo,bar}/**';
		assertGlobMatch(p, 'foo');
		assertGlobMatch(p, 'bar');
		assertGlobMatch(p, 'foo/test');
		assertGlobMatch(p, 'bar/test');
		assertGlobMatch(p, 'foo/other/more');
		assertGlobMatch(p, 'bar/other/more');

		p = '{**/*.d.ts,**/*.js}';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'testing/foo.js');
		assertGlobMatch(p, 'testing\\foo.js');
		assertGlobMatch(p, '/testing/foo.js');
		assertGlobMatch(p, '\\testing\\foo.js');
		assertGlobMatch(p, 'C:\\testing\\foo.js');

		assertGlobMatch(p, 'foo.d.ts');
		assertGlobMatch(p, 'testing/foo.d.ts');
		assertGlobMatch(p, 'testing\\foo.d.ts');
		assertGlobMatch(p, '/testing/foo.d.ts');
		assertGlobMatch(p, '\\testing\\foo.d.ts');
		assertGlobMatch(p, 'C:\\testing\\foo.d.ts');

		assertNoGlobMatch(p, 'foo.d');
		assertNoGlobMatch(p, 'testing/foo.d');
		assertNoGlobMatch(p, 'testing\\foo.d');
		assertNoGlobMatch(p, '/testing/foo.d');
		assertNoGlobMatch(p, '\\testing\\foo.d');
		assertNoGlobMatch(p, 'C:\\testing\\foo.d');

		p = '{**/*.d.ts,**/*.js,path/simple.jgs}';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'testing/foo.js');
		assertGlobMatch(p, 'testing\\foo.js');
		assertGlobMatch(p, '/testing/foo.js');
		assertGlobMatch(p, 'path/simple.jgs');
		assertNoGlobMatch(p, '/path/simple.jgs');
		assertGlobMatch(p, '\\testing\\foo.js');
		assertGlobMatch(p, 'C:\\testing\\foo.js');

		p = '{**/*.d.ts,**/*.js,foo.[0-9]}';

		assertGlobMatch(p, 'foo.5');
		assertGlobMatch(p, 'foo.8');
		assertNoGlobMatch(p, 'bar.5');
		assertNoGlobMatch(p, 'foo.f');
		assertGlobMatch(p, 'foo.js');

		p = 'prefix/{**/*.d.ts,**/*.js,foo.[0-9]}';

		assertGlobMatch(p, 'prefix/foo.5');
		assertGlobMatch(p, 'prefix/foo.8');
		assertNoGlobMatch(p, 'prefix/bar.5');
		assertNoGlobMatch(p, 'prefix/foo.f');
		assertGlobMatch(p, 'prefix/foo.js');
	});

	test('expression support (single)', function () {
		let siblings = ['test.html', 'test.txt', 'test.ts', 'test.js'];
		let hasSibling = (name: string) => siblings.indexOf(name) !== -1;

		// { "**/*.js": { "when": "$(basename).ts" } }
		let expression: glob.IExpression = {
			'**/*.js': {
				when: '$(basename).ts'
			}
		};

		assert.strictEqual('**/*.js', glob.match(expression, 'test.js', hasSibling));
		assert.strictEqual(glob.match(expression, 'test.js', () => false), null);
		assert.strictEqual(glob.match(expression, 'test.js', name => name === 'te.ts'), null);
		assert.strictEqual(glob.match(expression, 'test.js'), null);

		expression = {
			'**/*.js': {
				when: ''
			}
		};

		assert.strictEqual(glob.match(expression, 'test.js', hasSibling), null);

		expression = {
			'**/*.js': {
			} as any
		};

		assert.strictEqual('**/*.js', glob.match(expression, 'test.js', hasSibling));

		expression = {};

		assert.strictEqual(glob.match(expression, 'test.js', hasSibling), null);
	});

	test('expression support (multiple)', function () {
		let siblings = ['test.html', 'test.txt', 'test.ts', 'test.js'];
		let hasSibling = (name: string) => siblings.indexOf(name) !== -1;

		// { "**/*.js": { "when": "$(basename).ts" } }
		let expression: glob.IExpression = {
			'**/*.js': { when: '$(basename).ts' },
			'**/*.as': true,
			'**/*.foo': false,
			'**/*.bananas': { bananas: true } as any
		};

		assert.strictEqual('**/*.js', glob.match(expression, 'test.js', hasSibling));
		assert.strictEqual('**/*.as', glob.match(expression, 'test.as', hasSibling));
		assert.strictEqual('**/*.bananas', glob.match(expression, 'test.bananas', hasSibling));
		assert.strictEqual('**/*.bananas', glob.match(expression, 'test.bananas'));
		assert.strictEqual(glob.match(expression, 'test.foo', hasSibling), null);
	});

	test('brackets', () => {
		let p = 'foo.[0-9]';

		assertGlobMatch(p, 'foo.5');
		assertGlobMatch(p, 'foo.8');
		assertNoGlobMatch(p, 'bar.5');
		assertNoGlobMatch(p, 'foo.f');

		p = 'foo.[^0-9]';

		assertNoGlobMatch(p, 'foo.5');
		assertNoGlobMatch(p, 'foo.8');
		assertNoGlobMatch(p, 'bar.5');
		assertGlobMatch(p, 'foo.f');

		p = 'foo.[!0-9]';

		assertNoGlobMatch(p, 'foo.5');
		assertNoGlobMatch(p, 'foo.8');
		assertNoGlobMatch(p, 'bar.5');
		assertGlobMatch(p, 'foo.f');

		p = 'foo.[0!^*?]';

		assertNoGlobMatch(p, 'foo.5');
		assertNoGlobMatch(p, 'foo.8');
		assertGlobMatch(p, 'foo.0');
		assertGlobMatch(p, 'foo.!');
		assertGlobMatch(p, 'foo.^');
		assertGlobMatch(p, 'foo.*');
		assertGlobMatch(p, 'foo.?');

		p = 'foo[/]bar';

		assertNoGlobMatch(p, 'foo/bar');

		p = 'foo.[[]';

		assertGlobMatch(p, 'foo.[');

		p = 'foo.[]]';

		assertGlobMatch(p, 'foo.]');

		p = 'foo.[][!]';

		assertGlobMatch(p, 'foo.]');
		assertGlobMatch(p, 'foo.[');
		assertGlobMatch(p, 'foo.!');

		p = 'foo.[]-]';

		assertGlobMatch(p, 'foo.]');
		assertGlobMatch(p, 'foo.-');
	});

	test('full path', function () {
		assertGlobMatch('testing/this/foo.txt', 'testing/this/foo.txt');
		// assertGlobMatch('testing/this/foo.txt', 'testing\\this\\foo.txt');
	});

	test('ending path', function () {
		assertGlobMatch('**/testing/this/foo.txt', 'some/path/testing/this/foo.txt');
		// assertGlobMatch('**/testing/this/foo.txt', 'some\\path\\testing\\this\\foo.txt');
	});

	test('prefix agnostic', function () {
		let p = '**/*.js';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, '/foo.js');
		assertGlobMatch(p, '\\foo.js');
		assertGlobMatch(p, 'testing/foo.js');
		assertGlobMatch(p, 'testing\\foo.js');
		assertGlobMatch(p, '/testing/foo.js');
		assertGlobMatch(p, '\\testing\\foo.js');
		assertGlobMatch(p, 'C:\\testing\\foo.js');

		assertNoGlobMatch(p, 'foo.ts');
		assertNoGlobMatch(p, 'testing/foo.ts');
		assertNoGlobMatch(p, 'testing\\foo.ts');
		assertNoGlobMatch(p, '/testing/foo.ts');
		assertNoGlobMatch(p, '\\testing\\foo.ts');
		assertNoGlobMatch(p, 'C:\\testing\\foo.ts');

		assertNoGlobMatch(p, 'foo.js.txt');
		assertNoGlobMatch(p, 'testing/foo.js.txt');
		assertNoGlobMatch(p, 'testing\\foo.js.txt');
		assertNoGlobMatch(p, '/testing/foo.js.txt');
		assertNoGlobMatch(p, '\\testing\\foo.js.txt');
		assertNoGlobMatch(p, 'C:\\testing\\foo.js.txt');

		assertNoGlobMatch(p, 'testing.js/foo');
		assertNoGlobMatch(p, 'testing.js\\foo');
		assertNoGlobMatch(p, '/testing.js/foo');
		assertNoGlobMatch(p, '\\testing.js\\foo');
		assertNoGlobMatch(p, 'C:\\testing.js\\foo');

		p = '**/foo.js';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, '/foo.js');
		assertGlobMatch(p, '\\foo.js');
		assertGlobMatch(p, 'testing/foo.js');
		assertGlobMatch(p, 'testing\\foo.js');
		assertGlobMatch(p, '/testing/foo.js');
		assertGlobMatch(p, '\\testing\\foo.js');
		assertGlobMatch(p, 'C:\\testing\\foo.js');
	});

	test('cached properly', function () {
		let p = '**/*.js';

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'testing/foo.js');
		assertGlobMatch(p, 'testing\\foo.js');
		assertGlobMatch(p, '/testing/foo.js');
		assertGlobMatch(p, '\\testing\\foo.js');
		assertGlobMatch(p, 'C:\\testing\\foo.js');

		assertNoGlobMatch(p, 'foo.ts');
		assertNoGlobMatch(p, 'testing/foo.ts');
		assertNoGlobMatch(p, 'testing\\foo.ts');
		assertNoGlobMatch(p, '/testing/foo.ts');
		assertNoGlobMatch(p, '\\testing\\foo.ts');
		assertNoGlobMatch(p, 'C:\\testing\\foo.ts');

		assertNoGlobMatch(p, 'foo.js.txt');
		assertNoGlobMatch(p, 'testing/foo.js.txt');
		assertNoGlobMatch(p, 'testing\\foo.js.txt');
		assertNoGlobMatch(p, '/testing/foo.js.txt');
		assertNoGlobMatch(p, '\\testing\\foo.js.txt');
		assertNoGlobMatch(p, 'C:\\testing\\foo.js.txt');

		assertNoGlobMatch(p, 'testing.js/foo');
		assertNoGlobMatch(p, 'testing.js\\foo');
		assertNoGlobMatch(p, '/testing.js/foo');
		assertNoGlobMatch(p, '\\testing.js\\foo');
		assertNoGlobMatch(p, 'C:\\testing.js\\foo');

		// Run again and make sure the regex are properly reused

		assertGlobMatch(p, 'foo.js');
		assertGlobMatch(p, 'testing/foo.js');
		assertGlobMatch(p, 'testing\\foo.js');
		assertGlobMatch(p, '/testing/foo.js');
		assertGlobMatch(p, '\\testing\\foo.js');
		assertGlobMatch(p, 'C:\\testing\\foo.js');

		assertNoGlobMatch(p, 'foo.ts');
		assertNoGlobMatch(p, 'testing/foo.ts');
		assertNoGlobMatch(p, 'testing\\foo.ts');
		assertNoGlobMatch(p, '/testing/foo.ts');
		assertNoGlobMatch(p, '\\testing\\foo.ts');
		assertNoGlobMatch(p, 'C:\\testing\\foo.ts');

		assertNoGlobMatch(p, 'foo.js.txt');
		assertNoGlobMatch(p, 'testing/foo.js.txt');
		assertNoGlobMatch(p, 'testing\\foo.js.txt');
		assertNoGlobMatch(p, '/testing/foo.js.txt');
		assertNoGlobMatch(p, '\\testing\\foo.js.txt');
		assertNoGlobMatch(p, 'C:\\testing\\foo.js.txt');

		assertNoGlobMatch(p, 'testing.js/foo');
		assertNoGlobMatch(p, 'testing.js\\foo');
		assertNoGlobMatch(p, '/testing.js/foo');
		assertNoGlobMatch(p, '\\testing.js\\foo');
		assertNoGlobMatch(p, 'C:\\testing.js\\foo');
	});

	test('invalid glob', function () {
		let p = '**/*(.js';

		assertNoGlobMatch(p, 'foo.js');
	});

	test('split glob aware', function () {
		assert.deepStrictEqual(glob.splitGlobAware('foo,bar', ','), ['foo', 'bar']);
		assert.deepStrictEqual(glob.splitGlobAware('foo', ','), ['foo']);
		assert.deepStrictEqual(glob.splitGlobAware('{foo,bar}', ','), ['{foo,bar}']);
		assert.deepStrictEqual(glob.splitGlobAware('foo,bar,{foo,bar}', ','), ['foo', 'bar', '{foo,bar}']);
		assert.deepStrictEqual(glob.splitGlobAware('{foo,bar},foo,bar,{foo,bar}', ','), ['{foo,bar}', 'foo', 'bar', '{foo,bar}']);

		assert.deepStrictEqual(glob.splitGlobAware('[foo,bar]', ','), ['[foo,bar]']);
		assert.deepStrictEqual(glob.splitGlobAware('foo,bar,[foo,bar]', ','), ['foo', 'bar', '[foo,bar]']);
		assert.deepStrictEqual(glob.splitGlobAware('[foo,bar],foo,bar,[foo,bar]', ','), ['[foo,bar]', 'foo', 'bar', '[foo,bar]']);
	});

	test('expression with disabled glob', function () {
		let expr = { '**/*.js': false };

		assert.strictEqual(glob.match(expr, 'foo.js'), null);
	});

	test('expression with two non-trivia globs', function () {
		let expr = {
			'**/*.j?': true,
			'**/*.t?': true
		};

		assert.strictEqual(glob.match(expr, 'foo.js'), '**/*.j?');
		assert.strictEqual(glob.match(expr, 'foo.as'), null);
	});

	test('expression with empty glob', function () {
		let expr = { '': true };

		assert.strictEqual(glob.match(expr, 'foo.js'), null);
	});

	test('expression with other falsy value', function () {
		let expr = { '**/*.js': 0 } as any;

		assert.strictEqual(glob.match(expr, 'foo.js'), '**/*.js');
	});

	test('expression with two basename globs', function () {
		let expr = {
			'**/bar': true,
			'**/baz': true
		};

		assert.strictEqual(glob.match(expr, 'bar'), '**/bar');
		assert.strictEqual(glob.match(expr, 'foo'), null);
		assert.strictEqual(glob.match(expr, 'foo/bar'), '**/bar');
		assert.strictEqual(glob.match(expr, 'foo\\bar'), '**/bar');
		assert.strictEqual(glob.match(expr, 'foo/foo'), null);
	});

	test('expression with two basename globs and a siblings expression', function () {
		let expr = {
			'**/bar': true,
			'**/baz': true,
			'**/*.js': { when: '$(basename).ts' }
		};

		let siblings = ['foo.ts', 'foo.js', 'foo', 'bar'];
		let hasSibling = (name: string) => siblings.indexOf(name) !== -1;

		assert.strictEqual(glob.match(expr, 'bar', hasSibling), '**/bar');
		assert.strictEqual(glob.match(expr, 'foo', hasSibling), null);
		assert.strictEqual(glob.match(expr, 'foo/bar', hasSibling), '**/bar');
		if (isWindows) {
			// backslash is a valid file name character on posix
			assert.strictEqual(glob.match(expr, 'foo\\bar', hasSibling), '**/bar');
		}
		assert.strictEqual(glob.match(expr, 'foo/foo', hasSibling), null);
		assert.strictEqual(glob.match(expr, 'foo.js', hasSibling), '**/*.js');
		assert.strictEqual(glob.match(expr, 'bar.js', hasSibling), null);
	});

	test('expression with multipe basename globs', function () {
		let expr = {
			'**/bar': true,
			'{**/baz,**/foo}': true
		};

		assert.strictEqual(glob.match(expr, 'bar'), '**/bar');
		assert.strictEqual(glob.match(expr, 'foo'), '{**/baz,**/foo}');
		assert.strictEqual(glob.match(expr, 'baz'), '{**/baz,**/foo}');
		assert.strictEqual(glob.match(expr, 'abc'), null);
	});

	test('falsy expression/pattern', function () {
		assert.strictEqual(glob.match(null!, 'foo'), false);
		assert.strictEqual(glob.match('', 'foo'), false);
		assert.strictEqual(glob.parse(null!)('foo'), false);
		assert.strictEqual(glob.parse('')('foo'), false);
	});

	test('falsy path', function () {
		assert.strictEqual(glob.parse('foo')(null!), false);
		assert.strictEqual(glob.parse('foo')(''), false);
		assert.strictEqual(glob.parse('**/*.j?')(null!), false);
		assert.strictEqual(glob.parse('**/*.j?')(''), false);
		assert.strictEqual(glob.parse('**/*.foo')(null!), false);
		assert.strictEqual(glob.parse('**/*.foo')(''), false);
		assert.strictEqual(glob.parse('**/foo')(null!), false);
		assert.strictEqual(glob.parse('**/foo')(''), false);
		assert.strictEqual(glob.parse('{**/baz,**/foo}')(null!), false);
		assert.strictEqual(glob.parse('{**/baz,**/foo}')(''), false);
		assert.strictEqual(glob.parse('{**/*.baz,**/*.foo}')(null!), false);
		assert.strictEqual(glob.parse('{**/*.baz,**/*.foo}')(''), false);
	});

	test('expression/pattern basename', function () {
		assert.strictEqual(glob.parse('**/foo')('bar/baz', 'baz'), false);
		assert.strictEqual(glob.parse('**/foo')('bar/foo', 'foo'), true);

		assert.strictEqual(glob.parse('{**/baz,**/foo}')('baz/bar', 'bar'), false);
		assert.strictEqual(glob.parse('{**/baz,**/foo}')('baz/foo', 'foo'), true);

		let expr = { '**/*.js': { when: '$(basename).ts' } };
		let siblings = ['foo.ts', 'foo.js'];
		let hasSibling = (name: string) => siblings.indexOf(name) !== -1;

		assert.strictEqual(glob.parse(expr)('bar/baz.js', 'baz.js', hasSibling), null);
		assert.strictEqual(glob.parse(expr)('bar/foo.js', 'foo.js', hasSibling), '**/*.js');
	});

	test('expression/pattern basename terms', function () {
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('**/*.foo')), []);
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('**/foo')), ['foo']);
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('**/foo/')), ['foo']);
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('{**/baz,**/foo}')), ['baz', 'foo']);
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('{**/baz/,**/foo/}')), ['baz', 'foo']);

		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse({
			'**/foo': true,
			'{**/bar,**/baz}': true,
			'{**/bar2/,**/baz2/}': true,
			'**/bulb': false
		})), ['foo', 'bar', 'baz', 'bar2', 'baz2']);
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse({
			'**/foo': { when: '$(basename).zip' },
			'**/bar': true
		})), ['bar']);
	});

	test('expression/pattern optimization for basenames', function () {
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('**/foo/**')), []);
		assert.deepStrictEqual(glob.getBasenameTerms(glob.parse('**/foo/**', { trimForExclusions: true })), ['foo']);

		testOptimizationForBasenames('**/*.foo/**', [], [['baz/bar.foo/bar/baz', true]]);
		testOptimizationForBasenames('**/foo/**', ['foo'], [['bar/foo', true], ['bar/foo/baz', false]]);
		testOptimizationForBasenames('{**/baz/**,**/foo/**}', ['baz', 'foo'], [['bar/baz', true], ['bar/foo', true]]);

		testOptimizationForBasenames({
			'**/foo/**': true,
			'{**/bar/**,**/baz/**}': true,
			'**/bulb/**': false
		}, ['foo', 'bar', 'baz'], [
			['bar/foo', '**/foo/**'],
			['foo/bar', '{**/bar/**,**/baz/**}'],
			['bar/nope', null!]
		]);

		const siblings = ['baz', 'baz.zip', 'nope'];
		const hasSibling = (name: string) => siblings.indexOf(name) !== -1;
		testOptimizationForBasenames({
			'**/foo/**': { when: '$(basename).zip' },
			'**/bar/**': true
		}, ['bar'], [
			['bar/foo', null!],
			['bar/foo/baz', null!],
			['bar/foo/nope', null!],
			['foo/bar', '**/bar/**'],
		], [
			null!,
			hasSibling,
			hasSibling
		]);
	});

	function testOptimizationForBasenames(pattern: string | glob.IExpression, basenameTerms: string[], matches: [string, string | boolean][], siblingsFns: ((name: string) => boolean)[] = []) {
		const parsed = glob.parse(<glob.IExpression>pattern, { trimForExclusions: true });
		assert.deepStrictEqual(glob.getBasenameTerms(parsed), basenameTerms);
		matches.forEach(([text, result], i) => {
			assert.strictEqual(parsed(text, null!, siblingsFns[i]), result);
		});
	}

	test('trailing slash', function () {
		// Testing existing (more or less intuitive) behavior
		assert.strictEqual(glob.parse('**/foo/')('bar/baz', 'baz'), false);
		assert.strictEqual(glob.parse('**/foo/')('bar/foo', 'foo'), true);
		assert.strictEqual(glob.parse('**/*.foo/')('bar/file.baz', 'file.baz'), false);
		assert.strictEqual(glob.parse('**/*.foo/')('bar/file.foo', 'file.foo'), true);
		assert.strictEqual(glob.parse('{**/foo/,**/abc/}')('bar/baz', 'baz'), false);
		assert.strictEqual(glob.parse('{**/foo/,**/abc/}')('bar/foo', 'foo'), true);
		assert.strictEqual(glob.parse('{**/foo/,**/abc/}')('bar/abc', 'abc'), true);
		assert.strictEqual(glob.parse('{**/foo/,**/abc/}', { trimForExclusions: true })('bar/baz', 'baz'), false);
		assert.strictEqual(glob.parse('{**/foo/,**/abc/}', { trimForExclusions: true })('bar/foo', 'foo'), true);
		assert.strictEqual(glob.parse('{**/foo/,**/abc/}', { trimForExclusions: true })('bar/abc', 'abc'), true);
	});

	test('expression/pattern path', function () {
		assert.strictEqual(glob.parse('**/foo/bar')(nativeSep('foo/baz'), 'baz'), false);
		assert.strictEqual(glob.parse('**/foo/bar')(nativeSep('foo/bar'), 'bar'), true);
		assert.strictEqual(glob.parse('**/foo/bar')(nativeSep('bar/foo/bar'), 'bar'), true);
		assert.strictEqual(glob.parse('**/foo/bar/**')(nativeSep('bar/foo/bar'), 'bar'), true);
		assert.strictEqual(glob.parse('**/foo/bar/**')(nativeSep('bar/foo/bar/baz'), 'baz'), true);
		assert.strictEqual(glob.parse('**/foo/bar/**', { trimForExclusions: true })(nativeSep('bar/foo/bar'), 'bar'), true);
		assert.strictEqual(glob.parse('**/foo/bar/**', { trimForExclusions: true })(nativeSep('bar/foo/bar/baz'), 'baz'), false);

		assert.strictEqual(glob.parse('foo/bar')(nativeSep('foo/baz'), 'baz'), false);
		assert.strictEqual(glob.parse('foo/bar')(nativeSep('foo/bar'), 'bar'), true);
		assert.strictEqual(glob.parse('foo/bar/baz')(nativeSep('foo/bar/baz'), 'baz'), true); // #15424
		assert.strictEqual(glob.parse('foo/bar')(nativeSep('bar/foo/bar'), 'bar'), false);
		assert.strictEqual(glob.parse('foo/bar/**')(nativeSep('foo/bar/baz'), 'baz'), true);
		assert.strictEqual(glob.parse('foo/bar/**', { trimForExclusions: true })(nativeSep('foo/bar'), 'bar'), true);
		assert.strictEqual(glob.parse('foo/bar/**', { trimForExclusions: true })(nativeSep('foo/bar/baz'), 'baz'), false);
	});

	test('expression/pattern paths', function () {
		assert.deepStrictEqual(glob.getPathTerms(glob.parse('**/*.foo')), []);
		assert.deepStrictEqual(glob.getPathTerms(glob.parse('**/foo')), []);
		assert.deepStrictEqual(glob.getPathTerms(glob.parse('**/foo/bar')), ['*/foo/bar']);
		assert.deepStrictEqual(glob.getPathTerms(glob.parse('**/foo/bar/')), ['*/foo/bar']);
		// Not supported
		// assert.deepStrictEqual(glob.getPathTerms(glob.parse('{**/baz/bar,**/foo/bar,**/bar}')), ['*/baz/bar', '*/foo/bar']);
		// assert.deepStrictEqual(glob.getPathTerms(glob.parse('{**/baz/bar/,**/foo/bar/,**/bar/}')), ['*/baz/bar', '*/foo/bar']);

		const parsed = glob.parse({
			'**/foo/bar': true,
			'**/foo2/bar2': true,
			// Not supported
			// '{**/bar/foo,**/baz/foo}': true,
			// '{**/bar2/foo/,**/baz2/foo/}': true,
			'**/bulb': true,
			'**/bulb2': true,
			'**/bulb/foo': false
		});
		assert.deepStrictEqual(glob.getPathTerms(parsed), ['*/foo/bar', '*/foo2/bar2']);
		assert.deepStrictEqual(glob.getBasenameTerms(parsed), ['bulb', 'bulb2']);
		assert.deepStrictEqual(glob.getPathTerms(glob.parse({
			'**/foo/bar': { when: '$(basename).zip' },
			'**/bar/foo': true,
			'**/bar2/foo2': true
		})), ['*/bar/foo', '*/bar2/foo2']);
	});

	test('expression/pattern optimization for paths', function () {
		assert.deepStrictEqual(glob.getPathTerms(glob.parse('**/foo/bar/**')), []);
		assert.deepStrictEqual(glob.getPathTerms(glob.parse('**/foo/bar/**', { trimForExclusions: true })), ['*/foo/bar']);

		testOptimizationForPaths('**/*.foo/bar/**', [], [[nativeSep('baz/bar.foo/bar/baz'), true]]);
		testOptimizationForPaths('**/foo/bar/**', ['*/foo/bar'], [[nativeSep('bar/foo/bar'), true], [nativeSep('bar/foo/bar/baz'), false]]);
		// Not supported
		// testOptimizationForPaths('{**/baz/bar/**,**/foo/bar/**}', ['*/baz/bar', '*/foo/bar'], [[nativeSep('bar/baz/bar'), true], [nativeSep('bar/foo/bar'), true]]);

		testOptimizationForPaths({
			'**/foo/bar/**': true,
			// Not supported
			// '{**/bar/bar/**,**/baz/bar/**}': true,
			'**/bulb/bar/**': false
		}, ['*/foo/bar'], [
			[nativeSep('bar/foo/bar'), '**/foo/bar/**'],
			// Not supported
			// [nativeSep('foo/bar/bar'), '{**/bar/bar/**,**/baz/bar/**}'],
			[nativeSep('/foo/bar/nope'), null!]
		]);

		const siblings = ['baz', 'baz.zip', 'nope'];
		let hasSibling = (name: string) => siblings.indexOf(name) !== -1;
		testOptimizationForPaths({
			'**/foo/123/**': { when: '$(basename).zip' },
			'**/bar/123/**': true
		}, ['*/bar/123'], [
			[nativeSep('bar/foo/123'), null!],
			[nativeSep('bar/foo/123/baz'), null!],
			[nativeSep('bar/foo/123/nope'), null!],
			[nativeSep('foo/bar/123'), '**/bar/123/**'],
		], [
			null!,
			hasSibling,
			hasSibling
		]);
	});

	function testOptimizationForPaths(pattern: string | glob.IExpression, pathTerms: string[], matches: [string, string | boolean][], siblingsFns: ((name: string) => boolean)[] = []) {
		const parsed = glob.parse(<glob.IExpression>pattern, { trimForExclusions: true });
		assert.deepStrictEqual(glob.getPathTerms(parsed), pathTerms);
		matches.forEach(([text, result], i) => {
			assert.strictEqual(parsed(text, null!, siblingsFns[i]), result);
		});
	}

	function nativeSep(slashPath: string): string {
		return slashPath.replace(/\//g, sep);
	}

	test('relative pattern - glob star', function () {
		if (isWindows) {
			let p: glob.IRelativePattern = { base: 'C:\\DNXConsoleApp\\foo', pattern: '**/*.cs' };
			assertGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.cs');
			assertGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\bar\\Program.cs');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.ts');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\Program.cs');
			assertNoGlobMatch(p, 'C:\\other\\DNXConsoleApp\\foo\\Program.ts');
		} else {
			let p: glob.IRelativePattern = { base: '/DNXConsoleApp/foo', pattern: '**/*.cs' };
			assertGlobMatch(p, '/DNXConsoleApp/foo/Program.cs');
			assertGlobMatch(p, '/DNXConsoleApp/foo/bar/Program.cs');
			assertNoGlobMatch(p, '/DNXConsoleApp/foo/Program.ts');
			assertNoGlobMatch(p, '/DNXConsoleApp/Program.cs');
			assertNoGlobMatch(p, '/other/DNXConsoleApp/foo/Program.ts');
		}
	});

	test('relative pattern - single star', function () {
		if (isWindows) {
			let p: glob.IRelativePattern = { base: 'C:\\DNXConsoleApp\\foo', pattern: '*.cs' };
			assertGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.cs');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\bar\\Program.cs');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.ts');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\Program.cs');
			assertNoGlobMatch(p, 'C:\\other\\DNXConsoleApp\\foo\\Program.ts');
		} else {
			let p: glob.IRelativePattern = { base: '/DNXConsoleApp/foo', pattern: '*.cs' };
			assertGlobMatch(p, '/DNXConsoleApp/foo/Program.cs');
			assertNoGlobMatch(p, '/DNXConsoleApp/foo/bar/Program.cs');
			assertNoGlobMatch(p, '/DNXConsoleApp/foo/Program.ts');
			assertNoGlobMatch(p, '/DNXConsoleApp/Program.cs');
			assertNoGlobMatch(p, '/other/DNXConsoleApp/foo/Program.ts');
		}
	});

	test('relative pattern - single star with path', function () {
		if (isWindows) {
			let p: glob.IRelativePattern = { base: 'C:\\DNXConsoleApp\\foo', pattern: 'something/*.cs' };
			assertGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\something\\Program.cs');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.cs');
		} else {
			let p: glob.IRelativePattern = { base: '/DNXConsoleApp/foo', pattern: 'something/*.cs' };
			assertGlobMatch(p, '/DNXConsoleApp/foo/something/Program.cs');
			assertNoGlobMatch(p, '/DNXConsoleApp/foo/Program.cs');
		}
	});

	test('pattern with "base" does not explode - #36081', function () {
		assert.ok(glob.match({ 'base': true }, 'base'));
	});

	test('relative pattern - #57475', function () {
		if (isWindows) {
			let p: glob.IRelativePattern = { base: 'C:\\DNXConsoleApp\\foo', pattern: 'styles/style.css' };
			assertGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\styles\\style.css');
			assertNoGlobMatch(p, 'C:\\DNXConsoleApp\\foo\\Program.cs');
		} else {
			let p: glob.IRelativePattern = { base: '/DNXConsoleApp/foo', pattern: 'styles/style.css' };
			assertGlobMatch(p, '/DNXConsoleApp/foo/styles/style.css');
			assertNoGlobMatch(p, '/DNXConsoleApp/foo/Program.cs');
		}
	});

	test('URI match', () => {
		let p = 'scheme:/**/*.md';
		assertGlobMatch(p, URI.file('super/duper/long/some/file.md').with({ scheme: 'scheme' }).toString());
	});
});
