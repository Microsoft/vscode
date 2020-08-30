/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as labels from 'vs/base/common/labels';
import * as platform from 'vs/base/common/platform';

suite('Labels', () => {
	test('shorten - windows', () => {
		if (!platform.isWindows) {
			assert.ok(true);
			return;
		}

		// nothing to shorten
		assert.deepEqual(labels.shorten(['a']), ['a']);
		assert.deepEqual(labels.shorten(['a', 'b']), ['a', 'b']);
		assert.deepEqual(labels.shorten(['a', 'b', 'c']), ['a', 'b', 'c']);

		// completely different paths
		assert.deepEqual(labels.shorten(['a\\b', 'c\\d', 'e\\f']), ['…\\b', '…\\d', '…\\f']);

		// same beginning
		assert.deepEqual(labels.shorten(['a', 'a\\b']), ['a', '…\\b']);
		assert.deepEqual(labels.shorten(['a\\b', 'a\\b\\c']), ['…\\b', '…\\c']);
		assert.deepEqual(labels.shorten(['a', 'a\\b', 'a\\b\\c']), ['a', '…\\b', '…\\c']);
		assert.deepEqual(labels.shorten(['x:\\a\\b', 'x:\\a\\c']), ['x:\\…\\b', 'x:\\…\\c']);
		assert.deepEqual(labels.shorten(['\\\\a\\b', '\\\\a\\c']), ['\\\\a\\b', '\\\\a\\c']);

		// same ending
		assert.deepEqual(labels.shorten(['a', 'b\\a']), ['a', 'b\\…']);
		assert.deepEqual(labels.shorten(['a\\b\\c', 'd\\b\\c']), ['a\\…', 'd\\…']);
		assert.deepEqual(labels.shorten(['a\\b\\c\\d', 'f\\b\\c\\d']), ['a\\…', 'f\\…']);
		assert.deepEqual(labels.shorten(['d\\e\\a\\b\\c', 'd\\b\\c']), ['…\\a\\…', 'd\\b\\…']);
		assert.deepEqual(labels.shorten(['a\\b\\c\\d', 'a\\f\\b\\c\\d']), ['a\\b\\…', '…\\f\\…']);
		assert.deepEqual(labels.shorten(['a\\b\\a', 'b\\b\\a']), ['a\\b\\…', 'b\\b\\…']);
		assert.deepEqual(labels.shorten(['d\\f\\a\\b\\c', 'h\\d\\b\\c']), ['…\\a\\…', 'h\\…']);
		assert.deepEqual(labels.shorten(['a\\b\\c', 'x:\\0\\a\\b\\c']), ['a\\b\\c', 'x:\\0\\…']);
		assert.deepEqual(labels.shorten(['x:\\a\\b\\c', 'x:\\0\\a\\b\\c']), ['x:\\a\\…', 'x:\\0\\…']);
		assert.deepEqual(labels.shorten(['x:\\a\\b', 'y:\\a\\b']), ['x:\\…', 'y:\\…']);
		assert.deepEqual(labels.shorten(['x:\\a', 'x:\\c']), ['x:\\a', 'x:\\c']);
		assert.deepEqual(labels.shorten(['x:\\a\\b', 'y:\\x\\a\\b']), ['x:\\…', 'y:\\…']);
		assert.deepEqual(labels.shorten(['\\\\x\\b', '\\\\y\\b']), ['\\\\x\\…', '\\\\y\\…']);
		assert.deepEqual(labels.shorten(['\\\\x\\a', '\\\\x\\b']), ['\\\\x\\a', '\\\\x\\b']);

		// same name ending
		assert.deepEqual(labels.shorten(['a\\b', 'a\\c', 'a\\e-b']), ['…\\b', '…\\c', '…\\e-b']);

		// same in the middle
		assert.deepEqual(labels.shorten(['a\\b\\c', 'd\\b\\e']), ['…\\c', '…\\e']);

		// case-sensetive
		assert.deepEqual(labels.shorten(['a\\b\\c', 'd\\b\\C']), ['…\\c', '…\\C']);

		// empty or null
		assert.deepEqual(labels.shorten(['', null!]), ['.\\', null]);

		assert.deepEqual(labels.shorten(['a', 'a\\b', 'a\\b\\c', 'd\\b\\c', 'd\\b']), ['a', 'a\\b', 'a\\b\\c', 'd\\b\\c', 'd\\b']);
		assert.deepEqual(labels.shorten(['a', 'a\\b', 'b']), ['a', 'a\\b', 'b']);
		assert.deepEqual(labels.shorten(['', 'a', 'b', 'b\\c', 'a\\c']), ['.\\', 'a', 'b', 'b\\c', 'a\\c']);
		assert.deepEqual(labels.shorten(['src\\vs\\workbench\\parts\\execution\\electron-browser', 'src\\vs\\workbench\\parts\\execution\\electron-browser\\something', 'src\\vs\\workbench\\parts\\terminal\\electron-browser']), ['…\\execution\\electron-browser', '…\\something', '…\\terminal\\…']);
	});

	test('shorten - not windows', () => {
		if (platform.isWindows) {
			assert.ok(true);
			return;
		}

		// nothing to shorten
		assert.deepEqual(labels.shorten(['a']), ['a']);
		assert.deepEqual(labels.shorten(['a', 'b']), ['a', 'b']);
		assert.deepEqual(labels.shorten(['a', 'b', 'c']), ['a', 'b', 'c']);

		// completely different paths
		assert.deepEqual(labels.shorten(['a/b', 'c/d', 'e/f']), ['…/b', '…/d', '…/f']);

		// same beginning
		assert.deepEqual(labels.shorten(['a', 'a/b']), ['a', '…/b']);
		assert.deepEqual(labels.shorten(['a/b', 'a/b/c']), ['…/b', '…/c']);
		assert.deepEqual(labels.shorten(['a', 'a/b', 'a/b/c']), ['a', '…/b', '…/c']);
		assert.deepEqual(labels.shorten(['/a/b', '/a/c']), ['/a/b', '/a/c']);

		// same ending
		assert.deepEqual(labels.shorten(['a', 'b/a']), ['a', 'b/…']);
		assert.deepEqual(labels.shorten(['a/b/c', 'd/b/c']), ['a/…', 'd/…']);
		assert.deepEqual(labels.shorten(['a/b/c/d', 'f/b/c/d']), ['a/…', 'f/…']);
		assert.deepEqual(labels.shorten(['d/e/a/b/c', 'd/b/c']), ['…/a/…', 'd/b/…']);
		assert.deepEqual(labels.shorten(['a/b/c/d', 'a/f/b/c/d']), ['a/b/…', '…/f/…']);
		assert.deepEqual(labels.shorten(['a/b/a', 'b/b/a']), ['a/b/…', 'b/b/…']);
		assert.deepEqual(labels.shorten(['d/f/a/b/c', 'h/d/b/c']), ['…/a/…', 'h/…']);
		assert.deepEqual(labels.shorten(['/x/b', '/y/b']), ['/x/…', '/y/…']);

		// same name ending
		assert.deepEqual(labels.shorten(['a/b', 'a/c', 'a/e-b']), ['…/b', '…/c', '…/e-b']);

		// same in the middle
		assert.deepEqual(labels.shorten(['a/b/c', 'd/b/e']), ['…/c', '…/e']);

		// case-sensitive
		assert.deepEqual(labels.shorten(['a/b/c', 'd/b/C']), ['…/c', '…/C']);

		// empty or null
		assert.deepEqual(labels.shorten(['', null!]), ['./', null]);

		assert.deepEqual(labels.shorten(['a', 'a/b', 'a/b/c', 'd/b/c', 'd/b']), ['a', 'a/b', 'a/b/c', 'd/b/c', 'd/b']);
		assert.deepEqual(labels.shorten(['a', 'a/b', 'b']), ['a', 'a/b', 'b']);
		assert.deepEqual(labels.shorten(['', 'a', 'b', 'b/c', 'a/c']), ['./', 'a', 'b', 'b/c', 'a/c']);
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

		// // real world example (macOS)
		let t = '${activeEditorShort}${separator}${rootName}';
		assert.strictEqual(labels.template(t, { activeEditorShort: '', rootName: '', separator: { label: ' - ' } }), '');
		assert.strictEqual(labels.template(t, { activeEditorShort: '', rootName: 'root', separator: { label: ' - ' } }), 'root');
		assert.strictEqual(labels.template(t, { activeEditorShort: 'markdown.txt', rootName: 'root', separator: { label: ' - ' } }), 'markdown.txt - root');

		// // real world example (other)
		t = '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}';
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: '', rootName: '', appName: '', separator: { label: ' - ' } }), '');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: '', rootName: '', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: 'Untitled-1', rootName: '', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'Untitled-1 - Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: '', rootName: 'monaco', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'monaco - Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '', activeEditorShort: 'somefile.txt', rootName: 'monaco', appName: 'Visual Studio Code', separator: { label: ' - ' } }), 'somefile.txt - monaco - Visual Studio Code');
		assert.strictEqual(labels.template(t, { dirty: '* ', activeEditorShort: 'somefile.txt', rootName: 'monaco', appName: 'Visual Studio Code', separator: { label: ' - ' } }), '* somefile.txt - monaco - Visual Studio Code');
	});

	test('getBaseLabel - unix', () => {
		if (platform.isWindows) {
			assert.ok(true);
			return;
		}

		assert.equal(labels.getBaseLabel('/some/folder/file.txt'), 'file.txt');
		assert.equal(labels.getBaseLabel('/some/folder'), 'folder');
		assert.equal(labels.getBaseLabel('/'), '/');
	});

	test('getBaseLabel - windows', () => {
		if (!platform.isWindows) {
			assert.ok(true);
			return;
		}

		assert.equal(labels.getBaseLabel('c:'), 'C:');
		assert.equal(labels.getBaseLabel('c:\\'), 'C:');
		assert.equal(labels.getBaseLabel('c:\\some\\folder\\file.txt'), 'file.txt');
		assert.equal(labels.getBaseLabel('c:\\some\\folder'), 'folder');
	});

	test('mnemonicButtonLabel', () => {
		assert.equal(labels.mnemonicButtonLabel('Hello World'), 'Hello World');
		assert.equal(labels.mnemonicButtonLabel(''), '');
		if (platform.isWindows) {
			assert.equal(labels.mnemonicButtonLabel('Hello & World'), 'Hello && World');
			assert.equal(labels.mnemonicButtonLabel('Do &&not Save & Continue'), 'Do &not Save && Continue');
		} else if (platform.isMacintosh) {
			assert.equal(labels.mnemonicButtonLabel('Hello & World'), 'Hello & World');
			assert.equal(labels.mnemonicButtonLabel('Do &&not Save & Continue'), 'Do not Save & Continue');
		} else {
			assert.equal(labels.mnemonicButtonLabel('Hello & World'), 'Hello & World');
			assert.equal(labels.mnemonicButtonLabel('Do &&not Save & Continue'), 'Do _not Save & Continue');
		}
	});
});
