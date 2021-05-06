/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as labels from 'vs/base/common/labels';
import { isMacintosh, isWindows } from 'vs/base/common/platform';

suite('Labels', () => {
	(!isWindows ? test.skip : test)('shorten - windows', () => {

		// nothing to shorten
		assert.deepStrictEqual(labels.shorten(['a']), ['a']);
		assert.deepStrictEqual(labels.shorten(['a', 'b']), ['a', 'b']);
		assert.deepStrictEqual(labels.shorten(['a', 'b', 'c']), ['a', 'b', 'c']);

		// completely different paths
		assert.deepStrictEqual(labels.shorten(['a\\b', 'c\\d', 'e\\f']), ['…\\b', '…\\d', '…\\f']);

		// same beginning
		assert.deepStrictEqual(labels.shorten(['a', 'a\\b']), ['a', '…\\b']);
		assert.deepStrictEqual(labels.shorten(['a\\b', 'a\\b\\c']), ['…\\b', '…\\c']);
		assert.deepStrictEqual(labels.shorten(['a', 'a\\b', 'a\\b\\c']), ['a', '…\\b', '…\\c']);
		assert.deepStrictEqual(labels.shorten(['x:\\a\\b', 'x:\\a\\c']), ['x:\\…\\b', 'x:\\…\\c']);
		assert.deepStrictEqual(labels.shorten(['\\\\a\\b', '\\\\a\\c']), ['\\\\a\\b', '\\\\a\\c']);

		// same ending
		assert.deepStrictEqual(labels.shorten(['a', 'b\\a']), ['a', 'b\\…']);
		assert.deepStrictEqual(labels.shorten(['a\\b\\c', 'd\\b\\c']), ['a\\…', 'd\\…']);
		assert.deepStrictEqual(labels.shorten(['a\\b\\c\\d', 'f\\b\\c\\d']), ['a\\…', 'f\\…']);
		assert.deepStrictEqual(labels.shorten(['d\\e\\a\\b\\c', 'd\\b\\c']), ['…\\a\\…', 'd\\b\\…']);
		assert.deepStrictEqual(labels.shorten(['a\\b\\c\\d', 'a\\f\\b\\c\\d']), ['a\\b\\…', '…\\f\\…']);
		assert.deepStrictEqual(labels.shorten(['a\\b\\a', 'b\\b\\a']), ['a\\b\\…', 'b\\b\\…']);
		assert.deepStrictEqual(labels.shorten(['d\\f\\a\\b\\c', 'h\\d\\b\\c']), ['…\\a\\…', 'h\\…']);
		assert.deepStrictEqual(labels.shorten(['a\\b\\c', 'x:\\0\\a\\b\\c']), ['a\\b\\c', 'x:\\0\\…']);
		assert.deepStrictEqual(labels.shorten(['x:\\a\\b\\c', 'x:\\0\\a\\b\\c']), ['x:\\a\\…', 'x:\\0\\…']);
		assert.deepStrictEqual(labels.shorten(['x:\\a\\b', 'y:\\a\\b']), ['x:\\…', 'y:\\…']);
		assert.deepStrictEqual(labels.shorten(['x:\\a', 'x:\\c']), ['x:\\a', 'x:\\c']);
		assert.deepStrictEqual(labels.shorten(['x:\\a\\b', 'y:\\x\\a\\b']), ['x:\\…', 'y:\\…']);
		assert.deepStrictEqual(labels.shorten(['\\\\x\\b', '\\\\y\\b']), ['\\\\x\\…', '\\\\y\\…']);
		assert.deepStrictEqual(labels.shorten(['\\\\x\\a', '\\\\x\\b']), ['\\\\x\\a', '\\\\x\\b']);

		// same name ending
		assert.deepStrictEqual(labels.shorten(['a\\b', 'a\\c', 'a\\e-b']), ['…\\b', '…\\c', '…\\e-b']);

		// same in the middle
		assert.deepStrictEqual(labels.shorten(['a\\b\\c', 'd\\b\\e']), ['…\\c', '…\\e']);

		// case-sensetive
		assert.deepStrictEqual(labels.shorten(['a\\b\\c', 'd\\b\\C']), ['…\\c', '…\\C']);

		// empty or null
		assert.deepStrictEqual(labels.shorten(['', null!]), ['.\\', null]);

		assert.deepStrictEqual(labels.shorten(['a', 'a\\b', 'a\\b\\c', 'd\\b\\c', 'd\\b']), ['a', 'a\\b', 'a\\b\\c', 'd\\b\\c', 'd\\b']);
		assert.deepStrictEqual(labels.shorten(['a', 'a\\b', 'b']), ['a', 'a\\b', 'b']);
		assert.deepStrictEqual(labels.shorten(['', 'a', 'b', 'b\\c', 'a\\c']), ['.\\', 'a', 'b', 'b\\c', 'a\\c']);
		assert.deepStrictEqual(labels.shorten(['src\\vs\\workbench\\parts\\execution\\electron-browser', 'src\\vs\\workbench\\parts\\execution\\electron-browser\\something', 'src\\vs\\workbench\\parts\\terminal\\electron-browser']), ['…\\execution\\electron-browser', '…\\something', '…\\terminal\\…']);
	});

	(isWindows ? test.skip : test)('shorten - not windows', () => {

		// nothing to shorten
		assert.deepStrictEqual(labels.shorten(['a']), ['a']);
		assert.deepStrictEqual(labels.shorten(['a', 'b']), ['a', 'b']);
		assert.deepStrictEqual(labels.shorten(['a', 'b', 'c']), ['a', 'b', 'c']);

		// completely different paths
		assert.deepStrictEqual(labels.shorten(['a/b', 'c/d', 'e/f']), ['…/b', '…/d', '…/f']);

		// same beginning
		assert.deepStrictEqual(labels.shorten(['a', 'a/b']), ['a', '…/b']);
		assert.deepStrictEqual(labels.shorten(['a/b', 'a/b/c']), ['…/b', '…/c']);
		assert.deepStrictEqual(labels.shorten(['a', 'a/b', 'a/b/c']), ['a', '…/b', '…/c']);
		assert.deepStrictEqual(labels.shorten(['/a/b', '/a/c']), ['/a/b', '/a/c']);

		// same ending
		assert.deepStrictEqual(labels.shorten(['a', 'b/a']), ['a', 'b/…']);
		assert.deepStrictEqual(labels.shorten(['a/b/c', 'd/b/c']), ['a/…', 'd/…']);
		assert.deepStrictEqual(labels.shorten(['a/b/c/d', 'f/b/c/d']), ['a/…', 'f/…']);
		assert.deepStrictEqual(labels.shorten(['d/e/a/b/c', 'd/b/c']), ['…/a/…', 'd/b/…']);
		assert.deepStrictEqual(labels.shorten(['a/b/c/d', 'a/f/b/c/d']), ['a/b/…', '…/f/…']);
		assert.deepStrictEqual(labels.shorten(['a/b/a', 'b/b/a']), ['a/b/…', 'b/b/…']);
		assert.deepStrictEqual(labels.shorten(['d/f/a/b/c', 'h/d/b/c']), ['…/a/…', 'h/…']);
		assert.deepStrictEqual(labels.shorten(['/x/b', '/y/b']), ['/x/…', '/y/…']);

		// same name ending
		assert.deepStrictEqual(labels.shorten(['a/b', 'a/c', 'a/e-b']), ['…/b', '…/c', '…/e-b']);

		// same in the middle
		assert.deepStrictEqual(labels.shorten(['a/b/c', 'd/b/e']), ['…/c', '…/e']);

		// case-sensitive
		assert.deepStrictEqual(labels.shorten(['a/b/c', 'd/b/C']), ['…/c', '…/C']);

		// empty or null
		assert.deepStrictEqual(labels.shorten(['', null!]), ['./', null]);

		assert.deepStrictEqual(labels.shorten(['a', 'a/b', 'a/b/c', 'd/b/c', 'd/b']), ['a', 'a/b', 'a/b/c', 'd/b/c', 'd/b']);
		assert.deepStrictEqual(labels.shorten(['a', 'a/b', 'b']), ['a', 'a/b', 'b']);
		assert.deepStrictEqual(labels.shorten(['', 'a', 'b', 'b/c', 'a/c']), ['./', 'a', 'b', 'b/c', 'a/c']);
	});

	test('template', () => {

		// simple
		assert.strictEqual(labels.template('Foo Bar'), 'Foo Bar');
		assert.strictEqual(labels.template('Foo${}Bar'), 'FooBar');
		assert.strictEqual(labels.template('$FooBar'), '');
		assert.strictEqual(labels.template('}FooBar'), '}FooBar');
		assert.strictEqual(labels.template('Foo ${one} Bar', { one: 'value' }), 'Foo value Bar');
		assert.strictEqual(labels.template('Foo ${one} Bar ${two}', { one: 'value', two: 'other value' }), 'Foo value Bar other value');

		// conditional separator
		assert.strictEqual(labels.template('Foo${separator}Bar'), 'FooBar');
		assert.strictEqual(labels.template('Foo${separator}Bar', { separator: { label: ' - ' } }), 'Foo - Bar');
		assert.strictEqual(labels.template('${separator}Foo${separator}Bar', { value: 'something', separator: { label: ' - ' } }), 'Foo - Bar');
		assert.strictEqual(labels.template('${value} Foo${separator}Bar', { value: 'something', separator: { label: ' - ' } }), 'something Foo - Bar');

		// real world example (macOS)
		let t = '${activeEditorShort}${separator}${rootName}';
		assert.strictEqual(labels.template(t, { activeEditorShort: '', rootName: '', separator: { label: ' - ' } }), '');
		assert.strictEqual(labels.template(t, { activeEditorShort: '', rootName: 'root', separator: { label: ' - ' } }), 'root');
		assert.strictEqual(labels.template(t, { activeEditorShort: 'markdown.txt', rootName: 'root', separator: { label: ' - ' } }), 'markdown.txt - root');

		// real world example (other)
		t = '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}';
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: '', rootName: '', appName: '', separator: { label: ' - ' } }), '');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: '', rootName: '', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: 'Untitled-1', rootName: '', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'Untitled-1 - Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: '', rootName: 'monaco', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'monaco - Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: 'somefile.txt', rootName: 'monaco', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'somefile.txt - monaco - Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '* ', activeEditorShort: 'somefile.txt', rootName: 'monaco', appName: 'Visual Studio Code', separator: { label: ' - ' } }), '* somefile.txt - monaco - Visual Studio Code');
	});

	(isWindows ? test.skip : test)('getBaseLabel - unix', () => {
		assert.strictEqual(labels.getBaseLabel('/some/folder/file.txt'), 'file.txt');
		assert.strictEqual(labels.getBaseLabel('/some/folder'), 'folder');
		assert.strictEqual(labels.getBaseLabel('/'), '/');
	});

	(!isWindows ? test.skip : test)('getBaseLabel - windows', () => {
		assert.strictEqual(labels.getBaseLabel('c:'), 'C:');
		assert.strictEqual(labels.getBaseLabel('c:\\'), 'C:');
		assert.strictEqual(labels.getBaseLabel('c:\\some\\folder\\file.txt'), 'file.txt');
		assert.strictEqual(labels.getBaseLabel('c:\\some\\folder'), 'folder');
		assert.strictEqual(labels.getBaseLabel('c:\\some\\f:older'), 'f:older'); // https://github.com/microsoft/vscode-remote-release/issues/4227
	});

	test('mnemonicButtonLabel', () => {
		assert.strictEqual(labels.mnemonicButtonLabel('Hello World'), 'Hello World');
		assert.strictEqual(labels.mnemonicButtonLabel(''), '');
		if (isWindows) {
			assert.strictEqual(labels.mnemonicButtonLabel('Hello & World'), 'Hello && World');
			assert.strictEqual(labels.mnemonicButtonLabel('Do &&not Save & Continue'), 'Do &not Save && Continue');
		} else if (isMacintosh) {
			assert.strictEqual(labels.mnemonicButtonLabel('Hello & World'), 'Hello & World');
			assert.strictEqual(labels.mnemonicButtonLabel('Do &&not Save & Continue'), 'Do not Save & Continue');
		} else {
			assert.strictEqual(labels.mnemonicButtonLabel('Hello & World'), 'Hello & World');
			assert.strictEqual(labels.mnemonicButtonLabel('Do &&not Save & Continue'), 'Do _not Save & Continue');
		}
	});
});
