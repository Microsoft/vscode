/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { parseExtensionHostPort } from 'vs/platform/environment/common/environmentService';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import product from 'vs/platform/product/common/product';

suite('EnvironmentService', () => {

	test('parseExtensionHostPort when built', () => {
		const parse = (a: string[]) => parseExtensionHostPort(parseArgs(a, OPTIONS), true);

		assert.deepStrictEqual(parse([]), { port: null, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugPluginHost']), { port: null, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugPluginHost=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugBrkPluginHost']), { port: null, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugBrkPluginHost=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugPluginHost=1234', '--debugBrkPluginHost=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });

		assert.deepStrictEqual(parse(['--inspect-extensions']), { port: null, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-extensions=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-brk-extensions']), { port: null, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-brk-extensions=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-extensions=1234', '--inspect-brk-extensions=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });
	});

	test('parseExtensionHostPort when unbuilt', () => {
		const parse = (a: string[]) => parseExtensionHostPort(parseArgs(a, OPTIONS), false);

		assert.deepStrictEqual(parse([]), { port: 5870, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugPluginHost']), { port: 5870, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugPluginHost=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugBrkPluginHost']), { port: 5870, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugBrkPluginHost=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepStrictEqual(parse(['--debugPluginHost=1234', '--debugBrkPluginHost=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });

		assert.deepStrictEqual(parse(['--inspect-extensions']), { port: 5870, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-extensions=1234']), { port: 1234, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-brk-extensions']), { port: 5870, break: false, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-brk-extensions=5678']), { port: 5678, break: true, debugId: undefined });
		assert.deepStrictEqual(parse(['--inspect-extensions=1234', '--inspect-brk-extensions=5678', '--debugId=7']), { port: 5678, break: true, debugId: '7' });
	});

	// https://github.com/microsoft/vscode/issues/78440
	test('careful with boolean file names', function () {
		let actual = parseArgs(['-r', 'arg.txt'], OPTIONS);
		assert(actual['reuse-window']);
		assert.deepStrictEqual(actual._, ['arg.txt']);

		actual = parseArgs(['-r', 'true.txt'], OPTIONS);
		assert(actual['reuse-window']);
		assert.deepStrictEqual(actual._, ['true.txt']);
	});

	test('userDataDir', () => {
		const service1 = new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), { _serviceBrand: undefined, ...product });
		assert.ok(service1.userDataPath.length > 0);

		const args = parseArgs(process.argv, OPTIONS);
		args['user-data-dir'] = '/userDataDir/folder';

		const service2 = new NativeEnvironmentService(args, { _serviceBrand: undefined, ...product });
		assert.notStrictEqual(service1.userDataPath, service2.userDataPath);
	});
});
