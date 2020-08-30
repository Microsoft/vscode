/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Registry } from 'vs/platform/registry/common/platform';
import { IQuickAccessRegistry, Extensions, IQuickAccessProvider, QuickAccessRegistry } from 'vs/platform/quickinput/common/quickAccess';
import { IQuickPick, IQuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TestServiceAccessor, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { DisposableStore, toDisposable, IDisposable } from 'vs/base/common/lifecycle';
import { timeout } from 'vs/base/common/async';
import { PickerQuickAccessProvider, FastAndSlowPicks } from 'vs/platform/quickinput/browser/pickerQuickAccess';

suite('QuickAccess', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;

	let providerDefaultCalled = false;
	let providerDefaultCanceled = false;
	let providerDefaultDisposed = false;

	let provider1Called = false;
	let provider1Canceled = false;
	let provider1Disposed = false;

	let provider2Called = false;
	let provider2Canceled = false;
	let provider2Disposed = false;

	let provider3Called = false;
	let provider3Canceled = false;
	let provider3Disposed = false;

	class TestProviderDefault implements IQuickAccessProvider {

		constructor(@IQuickInputService private readonly quickInputService: IQuickInputService, disposables: DisposableStore) { }

		provide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable {
			assert.ok(picker);
			providerDefaultCalled = true;
			token.onCancellationRequested(() => providerDefaultCanceled = true);

			// bring up provider #3
			setTimeout(() => this.quickInputService.quickAccess.show(providerDescriptor3.prefix));

			return toDisposable(() => providerDefaultDisposed = true);
		}
	}

	class TestProvider1 implements IQuickAccessProvider {
		provide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable {
			assert.ok(picker);
			provider1Called = true;
			token.onCancellationRequested(() => provider1Canceled = true);

			return toDisposable(() => provider1Disposed = true);
		}
	}

	class TestProvider2 implements IQuickAccessProvider {
		provide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable {
			assert.ok(picker);
			provider2Called = true;
			token.onCancellationRequested(() => provider2Canceled = true);

			return toDisposable(() => provider2Disposed = true);
		}
	}

	class TestProvider3 implements IQuickAccessProvider {
		provide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken): IDisposable {
			assert.ok(picker);
			provider3Called = true;
			token.onCancellationRequested(() => provider3Canceled = true);

			// hide without picking
			setTimeout(() => picker.hide());

			return toDisposable(() => provider3Disposed = true);
		}
	}

	const providerDescriptorDefault = { ctor: TestProviderDefault, prefix: '', helpEntries: [] };
	const providerDescriptor1 = { ctor: TestProvider1, prefix: 'test', helpEntries: [] };
	const providerDescriptor2 = { ctor: TestProvider2, prefix: 'test something', helpEntries: [] };
	const providerDescriptor3 = { ctor: TestProvider3, prefix: 'changed', helpEntries: [] };

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	test('registry', () => {
		const registry = (Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess));
		const restore = (registry as QuickAccessRegistry).clear();

		assert.ok(!registry.getQuickAccessProvider('test'));

		const disposables = new DisposableStore();

		disposables.add(registry.registerQuickAccessProvider(providerDescriptorDefault));
		assert(registry.getQuickAccessProvider('') === providerDescriptorDefault);
		assert(registry.getQuickAccessProvider('test') === providerDescriptorDefault);

		const disposable = disposables.add(registry.registerQuickAccessProvider(providerDescriptor1));
		assert(registry.getQuickAccessProvider('test') === providerDescriptor1);

		const providers = registry.getQuickAccessProviders();
		assert(providers.some(provider => provider.prefix === 'test'));

		disposable.dispose();
		assert(registry.getQuickAccessProvider('test') === providerDescriptorDefault);

		disposables.dispose();
		assert.ok(!registry.getQuickAccessProvider('test'));

		restore();
	});

	test('provider', async () => {
		const registry = (Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess));
		const restore = (registry as QuickAccessRegistry).clear();

		const disposables = new DisposableStore();

		disposables.add(registry.registerQuickAccessProvider(providerDescriptorDefault));
		disposables.add(registry.registerQuickAccessProvider(providerDescriptor1));
		disposables.add(registry.registerQuickAccessProvider(providerDescriptor2));
		disposables.add(registry.registerQuickAccessProvider(providerDescriptor3));

		accessor.quickInputService.quickAccess.show('test');
		assert.equal(providerDefaultCalled, false);
		assert.equal(provider1Called, true);
		assert.equal(provider2Called, false);
		assert.equal(provider3Called, false);
		assert.equal(providerDefaultCanceled, false);
		assert.equal(provider1Canceled, false);
		assert.equal(provider2Canceled, false);
		assert.equal(provider3Canceled, false);
		assert.equal(providerDefaultDisposed, false);
		assert.equal(provider1Disposed, false);
		assert.equal(provider2Disposed, false);
		assert.equal(provider3Disposed, false);
		provider1Called = false;

		accessor.quickInputService.quickAccess.show('test something');
		assert.equal(providerDefaultCalled, false);
		assert.equal(provider1Called, false);
		assert.equal(provider2Called, true);
		assert.equal(provider3Called, false);
		assert.equal(providerDefaultCanceled, false);
		assert.equal(provider1Canceled, true);
		assert.equal(provider2Canceled, false);
		assert.equal(provider3Canceled, false);
		assert.equal(providerDefaultDisposed, false);
		assert.equal(provider1Disposed, true);
		assert.equal(provider2Disposed, false);
		assert.equal(provider3Disposed, false);
		provider2Called = false;
		provider1Canceled = false;
		provider1Disposed = false;

		accessor.quickInputService.quickAccess.show('usedefault');
		assert.equal(providerDefaultCalled, true);
		assert.equal(provider1Called, false);
		assert.equal(provider2Called, false);
		assert.equal(provider3Called, false);
		assert.equal(providerDefaultCanceled, false);
		assert.equal(provider1Canceled, false);
		assert.equal(provider2Canceled, true);
		assert.equal(provider3Canceled, false);
		assert.equal(providerDefaultDisposed, false);
		assert.equal(provider1Disposed, false);
		assert.equal(provider2Disposed, true);
		assert.equal(provider3Disposed, false);

		await timeout(1);

		assert.equal(providerDefaultCanceled, true);
		assert.equal(providerDefaultDisposed, true);
		assert.equal(provider3Called, true);

		await timeout(1);

		assert.equal(provider3Canceled, true);
		assert.equal(provider3Disposed, true);

		disposables.dispose();

		restore();
	});

	let fastProviderCalled = false;
	let slowProviderCalled = false;
	let fastAndSlowProviderCalled = false;

	let slowProviderCanceled = false;
	let fastAndSlowProviderCanceled = false;

	class FastTestQuickPickProvider extends PickerQuickAccessProvider<IQuickPickItem> {

		constructor() {
			super('fast');
		}

		protected getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): Array<IQuickPickItem> {
			fastProviderCalled = true;

			return [{ label: 'Fast Pick' }];
		}
	}

	class SlowTestQuickPickProvider extends PickerQuickAccessProvider<IQuickPickItem> {

		constructor() {
			super('slow');
		}

		protected async getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): Promise<Array<IQuickPickItem>> {
			slowProviderCalled = true;

			await timeout(1);

			if (token.isCancellationRequested) {
				slowProviderCanceled = true;
			}

			return [{ label: 'Slow Pick' }];
		}
	}

	class FastAndSlowTestQuickPickProvider extends PickerQuickAccessProvider<IQuickPickItem> {

		constructor() {
			super('bothFastAndSlow');
		}

		protected getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): FastAndSlowPicks<IQuickPickItem> {
			fastAndSlowProviderCalled = true;

			return {
				picks: [{ label: 'Fast Pick' }],
				additionalPicks: (async () => {
					await timeout(1);

					if (token.isCancellationRequested) {
						fastAndSlowProviderCanceled = true;
					}

					return [{ label: 'Slow Pick' }];
				})()
			};
		}
	}

	const fastProviderDescriptor = { ctor: FastTestQuickPickProvider, prefix: 'fast', helpEntries: [] };
	const slowProviderDescriptor = { ctor: SlowTestQuickPickProvider, prefix: 'slow', helpEntries: [] };
	const fastAndSlowProviderDescriptor = { ctor: FastAndSlowTestQuickPickProvider, prefix: 'bothFastAndSlow', helpEntries: [] };

	test('quick pick access', async () => {
		const registry = (Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess));
		const restore = (registry as QuickAccessRegistry).clear();

		const disposables = new DisposableStore();

		disposables.add(registry.registerQuickAccessProvider(fastProviderDescriptor));
		disposables.add(registry.registerQuickAccessProvider(slowProviderDescriptor));
		disposables.add(registry.registerQuickAccessProvider(fastAndSlowProviderDescriptor));

		accessor.quickInputService.quickAccess.show('fast');
		assert.equal(fastProviderCalled, true);
		assert.equal(slowProviderCalled, false);
		assert.equal(fastAndSlowProviderCalled, false);
		fastProviderCalled = false;

		accessor.quickInputService.quickAccess.show('slow');
		await timeout(2);

		assert.equal(fastProviderCalled, false);
		assert.equal(slowProviderCalled, true);
		assert.equal(slowProviderCanceled, false);
		assert.equal(fastAndSlowProviderCalled, false);
		slowProviderCalled = false;

		accessor.quickInputService.quickAccess.show('bothFastAndSlow');
		await timeout(2);

		assert.equal(fastProviderCalled, false);
		assert.equal(slowProviderCalled, false);
		assert.equal(fastAndSlowProviderCalled, true);
		assert.equal(fastAndSlowProviderCanceled, false);
		fastAndSlowProviderCalled = false;

		accessor.quickInputService.quickAccess.show('slow');
		accessor.quickInputService.quickAccess.show('bothFastAndSlow');
		accessor.quickInputService.quickAccess.show('fast');

		assert.equal(fastProviderCalled, true);
		assert.equal(slowProviderCalled, true);
		assert.equal(fastAndSlowProviderCalled, true);

		await timeout(2);
		assert.equal(slowProviderCanceled, true);
		assert.equal(fastAndSlowProviderCanceled, true);

		disposables.dispose();

		restore();
	});
});
