/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { formatOptions, Option } from 'vs/platform/environment/node/argv';
import { addArg } from 'vs/platform/environment/node/argvHelper';

suite('formatOptions', () => {

	function o(description: string): Option<any> {
		return {
			description, type: 'string'
		};
	}

	test('Text should display small columns correctly', () => {
		assert.deepEqual(
			formatOptions({
				'add': o('bar')
			}, 80),
			['  --add bar']
		);
		assert.deepEqual(
			formatOptions({
				'add': o('bar'),
				'wait': o('ba'),
				'trace': o('b')
			}, 80),
			[
				'  --add   bar',
				'  --wait  ba',
				'  --trace b'
			]);
	});

	test('Text should wrap', () => {
		assert.deepEqual(
			formatOptions({
				'add': o((<any>'bar ').repeat(9))
			}, 40),
			[
				'  --add bar bar bar bar bar bar bar bar',
				'        bar'
			]);
	});

	test('Text should revert to the condensed view when the terminal is too narrow', () => {
		assert.deepEqual(
			formatOptions({
				'add': o((<any>'bar ').repeat(9))
			}, 30),
			[
				'  --add',
				'      bar bar bar bar bar bar bar bar bar '
			]);
	});

	test('addArg', () => {
		assert.deepEqual(addArg([], 'foo'), ['foo']);
		assert.deepEqual(addArg([], 'foo', 'bar'), ['foo', 'bar']);
		assert.deepEqual(addArg(['foo'], 'bar'), ['foo', 'bar']);
		assert.deepEqual(addArg(['--wait'], 'bar'), ['--wait', 'bar']);
		assert.deepEqual(addArg(['--wait', '--', '--foo'], 'bar'), ['--wait', 'bar', '--', '--foo']);
		assert.deepEqual(addArg(['--', '--foo'], 'bar'), ['bar', '--', '--foo']);
	});
});
