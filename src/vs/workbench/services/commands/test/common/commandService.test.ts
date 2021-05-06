/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { CommandService } from 'vs/workbench/services/commands/common/commandService';
import { NullExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { NullLogService } from 'vs/platform/log/common/log';

suite('CommandService', function () {

	let commandRegistration: IDisposable;

	setup(function () {
		commandRegistration = CommandsRegistry.registerCommand('foo', function () { });
	});

	teardown(function () {
		commandRegistration.dispose();
	});

	test('activateOnCommand', () => {

		let lastEvent: string;

		let service = new CommandService(new InstantiationService(), new class extends NullExtensionService {
			override activateByEvent(activationEvent: string): Promise<void> {
				lastEvent = activationEvent;
				return super.activateByEvent(activationEvent);
			}
		}, new NullLogService());

		return service.executeCommand('foo').then(() => {
			assert.ok(lastEvent, 'onCommand:foo');
			return service.executeCommand('unknownCommandId');
		}).then(() => {
			assert.ok(false);
		}, () => {
			assert.ok(lastEvent, 'onCommand:unknownCommandId');
		});
	});

	test('fwd activation error', async function () {

		const extensionService = new class extends NullExtensionService {
			override activateByEvent(activationEvent: string): Promise<void> {
				return Promise.reject(new Error('bad_activate'));
			}
		};

		let service = new CommandService(new InstantiationService(), extensionService, new NullLogService());

		await extensionService.whenInstalledExtensionsRegistered();

		return service.executeCommand('foo').then(() => assert.ok(false), err => {
			assert.strictEqual(err.message, 'bad_activate');
		});
	});

	test('!onReady, but executeCommand', function () {

		let callCounter = 0;
		let reg = CommandsRegistry.registerCommand('bar', () => callCounter += 1);

		let service = new CommandService(new InstantiationService(), new class extends NullExtensionService {
			override whenInstalledExtensionsRegistered() {
				return new Promise<boolean>(_resolve => { /*ignore*/ });
			}
		}, new NullLogService());

		service.executeCommand('bar');
		assert.strictEqual(callCounter, 1);
		reg.dispose();
	});

	test('issue #34913: !onReady, unknown command', function () {

		let callCounter = 0;
		let resolveFunc: Function;
		const whenInstalledExtensionsRegistered = new Promise<boolean>(_resolve => { resolveFunc = _resolve; });

		let service = new CommandService(new InstantiationService(), new class extends NullExtensionService {
			override whenInstalledExtensionsRegistered() {
				return whenInstalledExtensionsRegistered;
			}
		}, new NullLogService());

		let r = service.executeCommand('bar');
		assert.strictEqual(callCounter, 0);

		let reg = CommandsRegistry.registerCommand('bar', () => callCounter += 1);
		resolveFunc!(true);

		return r.then(() => {
			reg.dispose();
			assert.strictEqual(callCounter, 1);
		});
	});

	test('Stop waiting for * extensions to activate when trigger is satisfied #62457', function () {

		let callCounter = 0;
		const disposable = new DisposableStore();
		let events: string[] = [];
		let service = new CommandService(new InstantiationService(), new class extends NullExtensionService {

			override activateByEvent(event: string): Promise<void> {
				events.push(event);
				if (event === '*') {
					return new Promise(() => { }); //forever promise...
				}
				if (event.indexOf('onCommand:') === 0) {
					return new Promise(resolve => {
						setTimeout(() => {
							let reg = CommandsRegistry.registerCommand(event.substr('onCommand:'.length), () => {
								callCounter += 1;
							});
							disposable.add(reg);
							resolve();
						}, 0);
					});
				}
				return Promise.resolve();
			}

		}, new NullLogService());

		return service.executeCommand('farboo').then(() => {
			assert.strictEqual(callCounter, 1);
			assert.deepStrictEqual(events.sort(), ['*', 'onCommand:farboo'].sort());
		}).finally(() => {
			disposable.dispose();
		});
	});

	test('issue #71471: wait for onCommand activation even if a command is registered', () => {
		let expectedOrder: string[] = ['registering command', 'resolving activation event', 'executing command'];
		let actualOrder: string[] = [];
		const disposables = new DisposableStore();
		let service = new CommandService(new InstantiationService(), new class extends NullExtensionService {

			override activateByEvent(event: string): Promise<void> {
				if (event === '*') {
					return new Promise(() => { }); //forever promise...
				}
				if (event.indexOf('onCommand:') === 0) {
					return new Promise(resolve => {
						setTimeout(() => {
							// Register the command after some time
							actualOrder.push('registering command');
							let reg = CommandsRegistry.registerCommand(event.substr('onCommand:'.length), () => {
								actualOrder.push('executing command');
							});
							disposables.add(reg);

							setTimeout(() => {
								// Resolve the activation event after some more time
								actualOrder.push('resolving activation event');
								resolve();
							}, 10);
						}, 10);
					});
				}
				return Promise.resolve();
			}

		}, new NullLogService());

		return service.executeCommand('farboo2').then(() => {
			assert.deepStrictEqual(actualOrder, expectedOrder);
		}).finally(() => {
			disposables.dispose();
		});
	});
});
