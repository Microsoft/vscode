/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('vscode API - configuration', () => {

	test('configurations, language defaults', function () {
		const defaultLanguageSettings = vscode.workspace.getConfiguration().get('[abcLang]');

		assert.deepEqual(defaultLanguageSettings, {
			'editor.lineNumbers': 'off',
			'editor.tabSize': 2
		});
	});

	test('configuration, defaults', () => {
		const config = vscode.workspace.getConfiguration('farboo');

		assert.ok(config.has('config0'));
		assert.equal(config.get('config0'), true);
		assert.equal(config.get('config4'), '');
		assert.equal(config['config0'], true);
		assert.equal(config['config4'], '');

		assert.throws(() => (<any>config)['config4'] = 'valuevalue');

		assert.ok(config.has('nested.config1'));
		assert.equal(config.get('nested.config1'), 42);
		assert.ok(config.has('nested.config2'));
		assert.equal(config.get('nested.config2'), 'Das Pferd frisst kein Reis.');
	});

	test('configuration, name vs property', () => {
		const config = vscode.workspace.getConfiguration('farboo');

		assert.ok(config.has('get'));
		assert.equal(config.get('get'), 'get-prop');
		assert.deepEqual(config['get'], config.get);
		assert.throws(() => config['get'] = <any>'get-prop');
	});
});
