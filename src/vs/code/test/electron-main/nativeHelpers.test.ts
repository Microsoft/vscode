/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isWindows } from 'vs/base/common/platform';

suite('Windows Native Helpers', () => {
	if (!isWindows) {
		return;
	}

	test('windows-mutex', async () => {
		const mutex = await import('windows-mutex');
		assert.ok(mutex && typeof mutex.isActive === 'function', 'Unable to load windows-mutex dependency.');
		assert.ok(typeof mutex.isActive === 'function', 'Unable to load windows-mutex dependency.');
	});

	test('windows-foreground-love', async () => {
		const foregroundLove = await import('windows-foreground-love');
		assert.ok(foregroundLove && typeof foregroundLove.allowSetForegroundWindow === 'function', 'Unable to load windows-foreground-love dependency.');
	});

	test('windows-process-tree', async () => {
		const processTree = await import('windows-process-tree');
		assert.ok(processTree && typeof processTree.getProcessTree === 'function', 'Unable to load windows-process-tree dependency.');
	});

	test('vscode-windows-ca-certs', async () => {
		// @ts-ignore Windows only
		const windowsCerts = await import('vscode-windows-ca-certs');
		assert.ok(windowsCerts, 'Unable to load vscode-windows-ca-certs dependency.');
	});

	test('vscode-windows-registry', async () => {
		const windowsRegistry = await import('vscode-windows-registry');
		assert.ok(windowsRegistry && typeof windowsRegistry.GetStringRegKey === 'function', 'Unable to load vscode-windows-registry dependency.');
	});
});
