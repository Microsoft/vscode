/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { MainThreadCommandsShape } from 'vs/workbench/api/common/extHost.protocol';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { SingleProxyRPCProtocol } from './testRPCProtocol';
import { mock } from 'vs/base/test/common/mock';
import { NullLogService } from 'vs/platform/log/common/log';

suite('ExtHostCommands', function () {

	test('dispose calls unregister', function () {

		let lastUnregister: string;

		const shape = new class extends mock<MainThreadCommandsShape>() {
			override $registerCommand(id: string): void {
				//
			}
			override $unregisterCommand(id: string): void {
				lastUnregister = id;
			}
		};

		const commands = new ExtHostCommands(
			SingleProxyRPCProtocol(shape),
			new NullLogService()
		);
		commands.registerCommand(true, 'foo', (): any => { }).dispose();
		assert.strictEqual(lastUnregister!, 'foo');
		assert.strictEqual(CommandsRegistry.getCommand('foo'), undefined);

	});

	test('dispose bubbles only once', function () {

		let unregisterCounter = 0;

		const shape = new class extends mock<MainThreadCommandsShape>() {
			override $registerCommand(id: string): void {
				//
			}
			override $unregisterCommand(id: string): void {
				unregisterCounter += 1;
			}
		};

		const commands = new ExtHostCommands(
			SingleProxyRPCProtocol(shape),
			new NullLogService()
		);
		const reg = commands.registerCommand(true, 'foo', (): any => { });
		reg.dispose();
		reg.dispose();
		reg.dispose();
		assert.strictEqual(unregisterCounter, 1);
	});

	test('execute with retry', async function () {

		let count = 0;

		const shape = new class extends mock<MainThreadCommandsShape>() {
			override $registerCommand(id: string): void {
				//
			}
			override async $executeCommand<T>(id: string, args: any[], retry: boolean): Promise<T | undefined> {
				count++;
				assert.strictEqual(retry, count === 1);
				if (count === 1) {
					assert.strictEqual(retry, true);
					throw new Error('$executeCommand:retry');
				} else {
					assert.strictEqual(retry, false);
					return <any>17;
				}
			}
		};

		const commands = new ExtHostCommands(
			SingleProxyRPCProtocol(shape),
			new NullLogService()
		);

		const result = await commands.executeCommand('fooo', [this, true]);
		assert.strictEqual(result, 17);
		assert.strictEqual(count, 2);
	});
});
