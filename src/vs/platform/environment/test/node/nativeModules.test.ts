/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isMacintosh, isWindows } from 'vs/base/common/platform';

function testErrorMessage(module: string): string {
	return `Unable to load "${module}" dependency. It was probably not compiled for the right operating system architecture or had missing build tools.`;
}

suite('Native Modules (all platforms)', () => {

	test('native-is-elevated', async () => {
		const isElevated = await import('native-is-elevated');
		assert.ok(typeof isElevated === 'function', testErrorMessage('native-is-elevated '));
	});

	test('native-keymap', async () => {
		const keyMap = await import('native-keymap');
		assert.ok(typeof keyMap.getCurrentKeyboardLayout === 'function', testErrorMessage('native-keymap'));
	});

	test('native-watchdog', async () => {
		const watchDog = await import('native-watchdog');
		assert.ok(typeof watchDog.start === 'function', testErrorMessage('native-watchdog'));
	});

	test('node-pty', async () => {
		const nodePty = await import('node-pty');
		assert.ok(typeof nodePty.spawn === 'function', testErrorMessage('node-pty'));
	});

	test('spdlog', async () => {
		const spdlog = await import('spdlog');
		assert.ok(typeof spdlog.createRotatingLogger === 'function', testErrorMessage('spdlog'));
	});

	test('v8-inspect-profiler', async () => {
		const profiler = await import('v8-inspect-profiler');
		assert.ok(typeof profiler.startProfiling === 'function', testErrorMessage('v8-inspect-profiler'));
	});

	test('vscode-nsfw', async () => {
		const nsfWatcher = await import('vscode-nsfw');
		assert.ok(typeof nsfWatcher === 'function', testErrorMessage('vscode-nsfw'));
	});

	test('vscode-sqlite3', async () => {
		const sqlite3 = await import('vscode-sqlite3');
		assert.ok(typeof sqlite3.Database === 'function', testErrorMessage('vscode-sqlite3'));
	});
});

(!isMacintosh ? suite.skip : suite)('Native Modules (macOS)', () => {

	test('chokidar (fsevents)', async () => {
		const chokidar = await import('chokidar');
		const watcher = chokidar.watch(__dirname);
		assert.ok(watcher.options.useFsEvents, testErrorMessage('chokidar (fsevents)'));

		return watcher.close();
	});
});

(!isWindows ? suite.skip : suite)('Native Modules (Windows)', () => {

	test('windows-mutex', async () => {
		const mutex = await import('windows-mutex');
		assert.ok(mutex && typeof mutex.isActive === 'function', testErrorMessage('windows-mutex'));
		assert.ok(typeof mutex.isActive === 'function', testErrorMessage('windows-mutex'));
	});

	test('windows-foreground-love', async () => {
		const foregroundLove = await import('windows-foreground-love');
		assert.ok(typeof foregroundLove.allowSetForegroundWindow === 'function', testErrorMessage('windows-foreground-love'));
	});

	test('windows-process-tree', async () => {
		const processTree = await import('windows-process-tree');
		assert.ok(typeof processTree.getProcessTree === 'function', testErrorMessage('windows-process-tree'));
	});

	test('vscode-windows-registry', async () => {
		const windowsRegistry = await import('vscode-windows-registry');
		assert.ok(typeof windowsRegistry.GetStringRegKey === 'function', testErrorMessage('vscode-windows-registry'));
	});

	test('vscode-windows-ca-certs', async () => {
		// @ts-ignore Windows only
		const windowsCerts = await import('vscode-windows-ca-certs');
		const store = new windowsCerts.Crypt32();
		assert.ok(windowsCerts, testErrorMessage('vscode-windows-ca-certs'));
		let certCount = 0;
		try {
			while (store.next()) {
				certCount++;
			}
		} finally {
			store.done();
		}
		assert(certCount > 0);
	});
});
