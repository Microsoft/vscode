/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getFirstFrame } from 'vs/base/common/console';
import { normalize } from 'vs/base/common/path';

suite('Console', () => {

	test('getFirstFrame', () => {
		let stack = 'at vscode.commands.registerCommand (/Users/someone/Desktop/test-ts/out/src/extension.js:18:17)';
		let frame = getFirstFrame(stack)!;

		assert.strictEqual(frame.uri.fsPath, normalize('/Users/someone/Desktop/test-ts/out/src/extension.js'));
		assert.strictEqual(frame.line, 18);
		assert.strictEqual(frame.column, 17);

		stack = 'at /Users/someone/Desktop/test-ts/out/src/extension.js:18:17';
		frame = getFirstFrame(stack)!;

		assert.strictEqual(frame.uri.fsPath, normalize('/Users/someone/Desktop/test-ts/out/src/extension.js'));
		assert.strictEqual(frame.line, 18);
		assert.strictEqual(frame.column, 17);

		stack = 'at c:\\Users\\someone\\Desktop\\end-js\\extension.js:18:17';
		frame = getFirstFrame(stack)!;

		assert.strictEqual(frame.uri.fsPath, 'c:\\Users\\someone\\Desktop\\end-js\\extension.js');
		assert.strictEqual(frame.line, 18);
		assert.strictEqual(frame.column, 17);

		stack = 'at e.$executeContributedCommand(c:\\Users\\someone\\Desktop\\end-js\\extension.js:18:17)';
		frame = getFirstFrame(stack)!;

		assert.strictEqual(frame.uri.fsPath, 'c:\\Users\\someone\\Desktop\\end-js\\extension.js');
		assert.strictEqual(frame.line, 18);
		assert.strictEqual(frame.column, 17);

		stack = 'at /Users/someone/Desktop/test-ts/out/src/extension.js:18:17\nat /Users/someone/Desktop/test-ts/out/src/other.js:28:27\nat /Users/someone/Desktop/test-ts/out/src/more.js:38:37';
		frame = getFirstFrame(stack)!;

		assert.strictEqual(frame.uri.fsPath, normalize('/Users/someone/Desktop/test-ts/out/src/extension.js'));
		assert.strictEqual(frame.line, 18);
		assert.strictEqual(frame.column, 17);
	});
});
