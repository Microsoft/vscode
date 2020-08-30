/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as processes from 'vs/base/common/processes';

suite('Processes', () => {
	test('sanitizeProcessEnvironment', () => {
		let env = {
			FOO: 'bar',
			ELECTRON_ENABLE_STACK_DUMPING: 'x',
			ELECTRON_ENABLE_LOGGING: 'x',
			ELECTRON_NO_ASAR: 'x',
			ELECTRON_NO_ATTACH_CONSOLE: 'x',
			ELECTRON_RUN_AS_NODE: 'x',
			GOOGLE_API_KEY: 'x',
			VSCODE_CLI: 'x',
			VSCODE_DEV: 'x',
			VSCODE_IPC_HOOK: 'x',
			VSCODE_LOGS: 'x',
			VSCODE_NLS_CONFIG: 'x',
			VSCODE_PORTABLE: 'x',
			VSCODE_PID: 'x',
			VSCODE_NODE_CACHED_DATA_DIR: 'x',
			VSCODE_NEW_VAR: 'x'
		};
		processes.sanitizeProcessEnvironment(env);
		assert.equal(env['FOO'], 'bar');
		assert.equal(Object.keys(env).length, 1);
	});
});
