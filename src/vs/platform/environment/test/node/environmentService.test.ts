/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'vs/base/common/path';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { parseExtensionHostPort, parseUserDataDir } from 'vs/platform/environment/node/environmentService';

suite('EnvironmentService', () => {

	test('parseExtensionHostPort when built', () => {
		const parse = (a: string[]) => parseExtensionHostPort(parseArgs(a, OPTIONS), true);

		assert.deepEqual(parse([]), { port: null, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugPluginHost']), { port: null, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugPluginHost=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugBrkPluginHost']), { port: null, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugBrkPluginHost=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepEqual(parse(['--debugPluginHost=1234', '--debugBrkPluginHost=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });

		assert.deepEqual(parse(['--inspect-extensions']), { port: null, break: false, debugId: undefined });
		assert.deepEqual(parse(['--inspect-extensions=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepEqual(parse(['--inspect-brk-extensions']), { port: null, break: false, debugId: undefined });
		assert.deepEqual(parse(['--inspect-brk-extensions=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepEqual(parse(['--inspect-extensions=1234', '--inspect-brk-extensions=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });
	});

	test('parseExtensionHostPort when unbuilt', () => {
		const parse = (a: string[]) => parseExtensionHostPort(parseArgs(a, OPTIONS), false);

		assert.deepEqual(parse([]), { port: 5870, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugPluginHost']), { port: 5870, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugPluginHost=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugBrkPluginHost']), { port: 5870, break: false, debugId: undefined });
		assert.deepEqual(parse(['--debugBrkPluginHost=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepEqual(parse(['--debugPluginHost=1234', '--debugBrkPluginHost=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });

		assert.deepEqual(parse(['--inspect-extensions']), { port: 5870, break: false, debugId: undefined });
		assert.deepEqual(parse(['--inspect-extensions=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepEqual(parse(['--inspect-brk-extensions']), { port: 5870, break: false, debugId: undefined });
		assert.deepEqual(parse(['--inspect-brk-extensions=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepEqual(parse(['--inspect-extensions=1234', '--inspect-brk-extensions=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });
	});

	test('userDataPath', () => {
		const parse = (a: string[], b: { cwd: () => string, env: { [key: string]: string } }) => parseUserDataDir(parseArgs(a, OPTIONS), <any>b);

		assert.equal(parse(['--user-data-dir', './dir'], { cwd: () => '/foo', env: {} }), path.resolve('/foo/dir'),
			'should use cwd when --user-data-dir is specified');
		assert.equal(parse(['--user-data-dir', './dir'], { cwd: () => '/foo', env: { 'VSCODE_CWD': '/bar' } }), path.resolve('/bar/dir'),
			'should use VSCODE_CWD as the cwd when --user-data-dir is specified');
	});

	// https://github.com/microsoft/vscode/issues/78440
	test('careful with boolean file names', function () {
		let actual = parseArgs(['-r', 'arg.txt'], OPTIONS);
		assert(actual['reuse-window']);
		assert.deepEqual(actual._, ['arg.txt']);

		actual = parseArgs(['-r', 'true.txt'], OPTIONS);
		assert(actual['reuse-window']);
		assert.deepEqual(actual._, ['true.txt']);
	});
});
