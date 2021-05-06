/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { assertNoRpc } from '../utils';

suite('vscode API - configuration', () => {

	teardown(assertNoRpc);

	test('configurations, language defaults', function () {
		const defaultLanguageSettings = vscode.workspace.getConfiguration().get('[abcLang]');

		assert.deepStrictEqual(defaultLanguageSettings, {
			'editor.lineNumbers': 'off',
			'editor.tabSize': 2
		});
	});

	test('configuration, defaults', () => {
		const config = vscode.workspace.getConfiguration('farboo');

		assert.ok(config.has('config0'));
		assert.strictEqual(config.get('config0'), true);
		assert.strictEqual(config.get('config4'), '');
		assert.strictEqual(config['config0'], true);
		assert.strictEqual(config['config4'], '');

		assert.throws(() => (<any>config)['config4'] = 'valuevalue');

		assert.ok(config.has('nested.config1'));
		assert.strictEqual(config.get('nested.config1'), 42);
		assert.ok(config.has('nested.config2'));
		assert.strictEqual(config.get('nested.config2'), 'Das Pferd frisst kein Reis.');
	});

	test('configuration, name vs property', () => {
		const config = vscode.workspace.getConfiguration('farboo');

		assert.ok(config.has('get'));
		assert.strictEqual(config.get('get'), 'get-prop');
		assert.deepStrictEqual(config['get'], config.get);
		assert.throws(() => config['get'] = <any>'get-prop');
	});
});
