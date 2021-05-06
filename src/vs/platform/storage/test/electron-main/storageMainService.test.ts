/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { notStrictEqual, strictEqual } from 'assert';
import { OPTIONS, parseArgs } from 'vs/platform/environment/node/argv';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { NullLogService } from 'vs/platform/log/common/log';
import { StorageMainService } from 'vs/platform/storage/electron-main/storageMainService';
import { currentSessionDateStorageKey, firstSessionDateStorageKey, instanceStorageKey } from 'vs/platform/telemetry/common/telemetry';
import { IStorageChangeEvent, IStorageMain, IStorageMainOptions } from 'vs/platform/storage/electron-main/storageMain';
import { generateUuid } from 'vs/base/common/uuid';
import { IS_NEW_KEY } from 'vs/platform/storage/common/storage';
import { ILifecycleMainService, LifecycleMainPhase, ShutdownEvent, UnloadReason } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { Emitter, Event } from 'vs/base/common/event';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { Promises } from 'vs/base/common/async';
import product from 'vs/platform/product/common/product';
import { IProductService } from 'vs/platform/product/common/productService';

suite('StorageMainService', function () {

	const productService: IProductService = { _serviceBrand: undefined, ...product };

	class TestStorageMainService extends StorageMainService {

		protected override getStorageOptions(): IStorageMainOptions {
			return {
				useInMemoryStorage: true
			};
		}
	}

	class StorageTestLifecycleMainService implements ILifecycleMainService {

		_serviceBrand: undefined;

		onBeforeShutdown = Event.None;

		private readonly _onWillShutdown = new Emitter<ShutdownEvent>();
		readonly onWillShutdown = this._onWillShutdown.event;

		async fireOnWillShutdown(): Promise<void> {
			const joiners: Promise<void>[] = [];

			this._onWillShutdown.fire({
				join(promise) {
					joiners.push(promise);
				}
			});

			await Promises.settled(joiners);
		}

		onWillLoadWindow = Event.None;
		onBeforeCloseWindow = Event.None;
		onBeforeUnloadWindow = Event.None;

		wasRestarted = false;
		quitRequested = false;

		phase = LifecycleMainPhase.Ready;

		registerWindow(window: ICodeWindow): void { }
		async reload(window: ICodeWindow, cli?: NativeParsedArgs): Promise<void> { }
		async unload(window: ICodeWindow, reason: UnloadReason): Promise<boolean> { return true; }
		async relaunch(options?: { addArgs?: string[] | undefined; removeArgs?: string[] | undefined; }): Promise<void> { }
		async quit(willRestart?: boolean): Promise<boolean> { return true; }
		async kill(code?: number): Promise<void> { }
		async when(phase: LifecycleMainPhase): Promise<void> { }
	}

	async function testStorage(storage: IStorageMain, isGlobal: boolean): Promise<void> {

		// Telemetry: added after init
		if (isGlobal) {
			strictEqual(storage.items.size, 0);
			strictEqual(storage.get(instanceStorageKey), undefined);
			await storage.init();
			strictEqual(typeof storage.get(instanceStorageKey), 'string');
			strictEqual(typeof storage.get(firstSessionDateStorageKey), 'string');
			strictEqual(typeof storage.get(currentSessionDateStorageKey), 'string');
		} else {
			await storage.init();
		}

		let storageChangeEvent: IStorageChangeEvent | undefined = undefined;
		const storageChangeListener = storage.onDidChangeStorage(e => {
			storageChangeEvent = e;
		});

		let storageDidClose = false;
		const storageCloseListener = storage.onDidCloseStorage(() => storageDidClose = true);

		// Basic store/get/remove
		const size = storage.items.size;

		storage.set('bar', 'foo');
		strictEqual(storageChangeEvent!.key, 'bar');
		storage.set('barNumber', 55);
		storage.set('barBoolean', true);

		strictEqual(storage.get('bar'), 'foo');
		strictEqual(storage.get('barNumber'), '55');
		strictEqual(storage.get('barBoolean'), 'true');

		strictEqual(storage.items.size, size + 3);

		storage.delete('bar');
		strictEqual(storage.get('bar'), undefined);

		strictEqual(storage.items.size, size + 2);

		// IS_NEW
		strictEqual(storage.get(IS_NEW_KEY), 'true');

		// Close
		await storage.close();

		strictEqual(storageDidClose, true);

		storageChangeListener.dispose();
		storageCloseListener.dispose();
	}

	test('basics (global)', function () {
		const storageMainService = new TestStorageMainService(new NullLogService(), new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService), new StorageTestLifecycleMainService());

		return testStorage(storageMainService.globalStorage, true);
	});

	test('basics (workspace)', function () {
		const workspace = { id: generateUuid() };
		const storageMainService = new TestStorageMainService(new NullLogService(), new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService), new StorageTestLifecycleMainService());

		return testStorage(storageMainService.workspaceStorage(workspace), false);
	});

	test('storage closed onWillShutdown', async function () {
		const lifecycleMainService = new StorageTestLifecycleMainService();
		const workspace = { id: generateUuid() };
		const storageMainService = new TestStorageMainService(new NullLogService(), new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService), lifecycleMainService);

		let workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		});

		let globalStorage = storageMainService.globalStorage;
		let didCloseGlobalStorage = false;
		globalStorage.onDidCloseStorage(() => {
			didCloseGlobalStorage = true;
		});

		strictEqual(workspaceStorage, storageMainService.workspaceStorage(workspace)); // same instance as long as not closed

		await globalStorage.init();
		await workspaceStorage.init();

		await lifecycleMainService.fireOnWillShutdown();

		strictEqual(didCloseGlobalStorage, true);
		strictEqual(didCloseWorkspaceStorage, true);

		let storage2 = storageMainService.workspaceStorage(workspace);
		notStrictEqual(workspaceStorage, storage2);

		return storage2.close();
	});

	test('storage closed before init works', async function () {
		const storageMainService = new TestStorageMainService(new NullLogService(), new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService), new StorageTestLifecycleMainService());
		const workspace = { id: generateUuid() };

		let workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		});

		let globalStorage = storageMainService.globalStorage;
		let didCloseGlobalStorage = false;
		globalStorage.onDidCloseStorage(() => {
			didCloseGlobalStorage = true;
		});

		await globalStorage.close();
		await workspaceStorage.close();

		strictEqual(didCloseGlobalStorage, true);
		strictEqual(didCloseWorkspaceStorage, true);
	});

	test('storage closed before init awaits works', async function () {
		const storageMainService = new TestStorageMainService(new NullLogService(), new NativeEnvironmentService(parseArgs(process.argv, OPTIONS), productService), new StorageTestLifecycleMainService());
		const workspace = { id: generateUuid() };

		let workspaceStorage = storageMainService.workspaceStorage(workspace);
		let didCloseWorkspaceStorage = false;
		workspaceStorage.onDidCloseStorage(() => {
			didCloseWorkspaceStorage = true;
		});

		let globalStorage = storageMainService.globalStorage;
		let didCloseGlobalStorage = false;
		globalStorage.onDidCloseStorage(() => {
			didCloseGlobalStorage = true;
		});

		globalStorage.init();
		workspaceStorage.init();

		await globalStorage.close();
		await workspaceStorage.close();

		strictEqual(didCloseGlobalStorage, true);
		strictEqual(didCloseWorkspaceStorage, true);
	});
});
