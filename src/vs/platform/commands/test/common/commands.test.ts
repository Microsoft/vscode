/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';

suite('Command Tests', function () {

	test('register command - no handler', function () {
		assert.throws(() => CommandsRegistry.registerCommand('foo', null!));
	});

	test('register/dispose', () => {
		const command = function () { };
		const reg = CommandsRegistry.registerCommand('foo', command);
		assert.ok(CommandsRegistry.getCommand('foo')!.handler === command);
		reg.dispose();
		assert.ok(CommandsRegistry.getCommand('foo') === undefined);
	});

	test('register/register/dispose', () => {
		const command1 = function () { };
		const command2 = function () { };

		// dispose overriding command
		let reg1 = CommandsRegistry.registerCommand('foo', command1);
		assert.ok(CommandsRegistry.getCommand('foo')!.handler === command1);

		let reg2 = CommandsRegistry.registerCommand('foo', command2);
		assert.ok(CommandsRegistry.getCommand('foo')!.handler === command2);
		reg2.dispose();

		assert.ok(CommandsRegistry.getCommand('foo')!.handler === command1);
		reg1.dispose();
		assert.ok(CommandsRegistry.getCommand('foo') === undefined);

		// dispose override command first
		reg1 = CommandsRegistry.registerCommand('foo', command1);
		reg2 = CommandsRegistry.registerCommand('foo', command2);
		assert.ok(CommandsRegistry.getCommand('foo')!.handler === command2);

		reg1.dispose();
		assert.ok(CommandsRegistry.getCommand('foo')!.handler === command2);

		reg2.dispose();
		assert.ok(CommandsRegistry.getCommand('foo') === undefined);
	});

	test('command with description', function () {

		CommandsRegistry.registerCommand('test', function (accessor, args) {
			assert.ok(typeof args === 'string');
		});

		CommandsRegistry.registerCommand('test2', function (accessor, args) {
			assert.ok(typeof args === 'string');
		});

		CommandsRegistry.registerCommand({
			id: 'test3',
			handler: function (accessor, args) {
				return true;
			},
			description: {
				description: 'a command',
				args: [{ name: 'value', constraint: Number }]
			}
		});

		CommandsRegistry.getCommands().get('test')!.handler.apply(undefined, [undefined!, 'string']);
		CommandsRegistry.getCommands().get('test2')!.handler.apply(undefined, [undefined!, 'string']);
		assert.throws(() => CommandsRegistry.getCommands().get('test3')!.handler.apply(undefined, [undefined!, 'string']));
		assert.strictEqual(CommandsRegistry.getCommands().get('test3')!.handler.apply(undefined, [undefined!, 1]), true);

	});
});
