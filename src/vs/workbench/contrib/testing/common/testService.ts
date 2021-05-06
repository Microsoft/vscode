/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { DisposableStore, IDisposable, IReference } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { MutableObservableValue } from 'vs/workbench/contrib/testing/common/observableValue';
import { AbstractIncrementalTestCollection, IncrementalTestCollectionItem, InternalTestItem, RunTestForProviderRequest, RunTestsRequest, TestIdPath, TestIdWithSrc, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { ITestResult } from 'vs/workbench/contrib/testing/common/testResult';

export const ITestService = createDecorator<ITestService>('testService');

export interface MainTestController {
	expandTest(src: TestIdWithSrc, levels: number): Promise<void>;
	lookupTest(test: TestIdWithSrc): Promise<InternalTestItem | undefined>;
	runTests(request: RunTestForProviderRequest, token: CancellationToken): Promise<void>;
}

export type TestDiffListener = (diff: TestsDiff) => void;

export interface IMainThreadTestCollection extends AbstractIncrementalTestCollection<IncrementalTestCollectionItem> {
	onPendingRootProvidersChange: Event<number>;
	onBusyProvidersChange: Event<number>;

	/**
	 * Number of test root sources who are yet to report.
	 */
	pendingRootProviders: number;

	/**
	 * Number of providers working to discover tests.
	 */
	busyProviders: number;

	/**
	 * Root node IDs.
	 */
	rootIds: ReadonlySet<string>;

	/**
	 * Iterates over every test in the collection.
	 */
	all: Iterable<IncrementalTestCollectionItem>;

	/**
	 * Gets a node in the collection by ID.
	 */
	getNodeById(id: string): IncrementalTestCollectionItem | undefined;

	/**
	 * Requests that children be revealed for the given test. "Levels" may
	 * be infinite.
	 */
	expand(testId: string, levels: number): Promise<void>;

	/**
	 * Gets a diff that adds all items currently in the tree to a new collection,
	 * allowing it to fully hydrate.
	 */
	getReviverDiff(): TestsDiff;
}

export const waitForAllRoots = (collection: IMainThreadTestCollection, ct = CancellationToken.None) => {
	if (collection.pendingRootProviders === 0 || ct.isCancellationRequested) {
		return Promise.resolve();
	}

	const disposable = new DisposableStore();
	return new Promise<void>(resolve => {
		disposable.add(collection.onPendingRootProvidersChange(count => {
			if (count === 0) {
				resolve();
			}
		}));

		disposable.add(ct.onCancellationRequested(() => resolve()));
	}).finally(() => disposable.dispose());
};

/**
 * Ensures the test with the given path exists in the collection, if possible.
 * If cancellation is requested, or the test cannot be found, it will return
 * undefined.
 */
export const getTestByPath = async (collection: IMainThreadTestCollection, idPath: TestIdPath, ct = CancellationToken.None) => {
	await waitForAllRoots(collection, ct);

	// Expand all direct children since roots might well have different IDs, but
	// children should start matching.
	await Promise.all([...collection.rootIds].map(r => collection.expand(r, 0)));

	if (ct.isCancellationRequested) {
		return undefined;
	}

	let expandToLevel = 0;
	for (let i = idPath.length - 1; !ct.isCancellationRequested && i >= expandToLevel;) {
		const id = idPath[i];
		const existing = collection.getNodeById(id);
		if (!existing) {
			i--;
			continue;
		}

		if (i === idPath.length - 1) {
			return existing;
		}

		await collection.expand(id, 0);
		expandToLevel = i + 1; // avoid an infinite loop if the test does not exist
		i = idPath.length - 1;
	}
	return undefined;
};

/**
 * Waits for all test in the hierarchy to be fulfilled before returning.
 * If cancellation is requested, it will return early.
 */
export const getAllTestsInHierarchy = async (collection: IMainThreadTestCollection, ct = CancellationToken.None) => {
	await waitForAllRoots(collection, ct);

	if (ct.isCancellationRequested) {
		return;
	}

	let l: IDisposable;

	await Promise.race([
		Promise.all([...collection.rootIds].map(r => collection.expand(r, Infinity))),
		new Promise(r => { l = ct.onCancellationRequested(r); }),
	]).finally(() => l?.dispose());
};

/**
 * An instance of the RootProvider should be registered for each extension
 * host.
 */
export interface ITestRootProvider {
	// todo: nothing, yet
}

export interface ITestService {
	readonly _serviceBrand: undefined;
	readonly onShouldSubscribe: Event<{ resource: ExtHostTestingResource, uri: URI; }>;
	readonly onShouldUnsubscribe: Event<{ resource: ExtHostTestingResource, uri: URI; }>;
	readonly onDidChangeProviders: Event<{ delta: number; }>;
	readonly providers: number;
	readonly subscriptions: ReadonlyArray<{ resource: ExtHostTestingResource, uri: URI; }>;
	readonly testRuns: Iterable<RunTestsRequest>;

	/**
	 * Set of test IDs the user asked to exclude.
	 */
	readonly excludeTests: MutableObservableValue<ReadonlySet<string>>;

	/**
	 * Sets whether a test is excluded.
	 */
	setTestExcluded(testId: string, exclude?: boolean): void;

	/**
	 * Removes all test exclusions.
	 */
	clearExcludedTests(): void;

	/**
	 * Updates the number of sources who provide test roots when subscription
	 * is requested. This is equal to the number of extension hosts, and used
	 * with `TestDiffOpType.DeltaRootsComplete` to signal when all roots
	 * are available.
	 */
	registerRootProvider(provider: ITestRootProvider): IDisposable;

	/**
	 * Registers an interface that runs tests for the given provider ID.
	 */
	registerTestController(providerId: string, controller: MainTestController): IDisposable;

	/**
	 * Requests that tests be executed.
	 */
	runTests(req: RunTestsRequest, token?: CancellationToken): Promise<ITestResult>;

	/**
	 * Cancels an ongoign test run request.
	 */
	cancelTestRun(req: RunTestsRequest): void;

	publishDiff(resource: ExtHostTestingResource, uri: URI, diff: TestsDiff): void;
	subscribeToDiffs(resource: ExtHostTestingResource, uri: URI, acceptDiff?: TestDiffListener): IReference<IMainThreadTestCollection>;


	/**
	 * Looks up a test, by a request to extension hosts.
	 */
	lookupTest(test: TestIdWithSrc): Promise<InternalTestItem | undefined>;

	/**
	 * Requests to resubscribe to all active subscriptions, discarding old tests.
	 */
	resubscribeToAllTests(): void;
}
