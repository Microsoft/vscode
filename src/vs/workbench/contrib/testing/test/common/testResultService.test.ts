/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { bufferToStream, newWriteableBufferStream, VSBuffer } from 'vs/base/common/buffer';
import { Lazy } from 'vs/base/common/lazy';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { NullLogService } from 'vs/platform/log/common/log';
import { ITestTaskState, TestResultItem } from 'vs/workbench/contrib/testing/common/testCollection';
import { HydratedTestResult, LiveOutputController, LiveTestResult, makeEmptyCounts, TestResultItemChange, TestResultItemChangeReason } from 'vs/workbench/contrib/testing/common/testResult';
import { TestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { InMemoryResultStorage, ITestResultStorage } from 'vs/workbench/contrib/testing/common/testResultStorage';
import { Convert, ReExportedTestRunState as TestRunState, TestItemImpl, TestResultState, testStubs, testStubsChain } from 'vs/workbench/contrib/testing/common/testStubs';
import { getInitializedMainTestCollection } from 'vs/workbench/contrib/testing/test/common/ownedTestCollection';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';

export const emptyOutputController = () => new LiveOutputController(
	new Lazy(() => [newWriteableBufferStream(), Promise.resolve()]),
	() => Promise.resolve(bufferToStream(VSBuffer.alloc(0))),
);

suite('Workbench - Test Results Service', () => {
	const getLabelsIn = (it: Iterable<TestResultItem>) => [...it].map(t => t.item.label).sort();
	const getChangeSummary = () => [...changed]
		.map(c => ({ reason: c.reason, label: c.item.item.label }))
		.sort((a, b) => a.label.localeCompare(b.label));

	let r: TestLiveTestResult;
	let changed = new Set<TestResultItemChange>();
	let tests: TestItemImpl;

	const defaultOpts = {
		exclude: [],
		debug: false,
		id: 'x',
		persist: true,
	};

	class TestLiveTestResult extends LiveTestResult {
		public override setAllToState(state: TestResultState, taskId: string, when: (task: ITestTaskState, item: TestResultItem) => boolean) {
			super.setAllToState(state, taskId, when);
		}
	}

	setup(async () => {
		changed = new Set();
		r = new TestLiveTestResult(
			'foo',
			emptyOutputController(),
			{ ...defaultOpts, tests: ['id-a'] },
		);

		r.onChange(e => changed.add(e));
		r.addTask({ id: 't', name: undefined, running: true });

		tests = testStubs.nested();
		r.addTestChainToRun(testStubsChain(tests, ['id-a', 'id-aa']).map(Convert.TestItem.from));
		r.addTestChainToRun(testStubsChain(tests, ['id-a', 'id-ab'], 1).map(Convert.TestItem.from));
	});

	suite('LiveTestResult', () => {
		test('is empty if no tests are yet present', async () => {
			assert.deepStrictEqual(getLabelsIn(new TestLiveTestResult(
				'foo',
				emptyOutputController(),
				{ ...defaultOpts, tests: ['id-a'] },
			).tests), []);
		});

		test('initially queues with update', () => {
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.ComputedStateChange },
				{ label: 'aa', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'ab', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'root', reason: TestResultItemChangeReason.ComputedStateChange },
			]);
		});

		test('initializes with the subtree of requested tests', () => {
			assert.deepStrictEqual(getLabelsIn(r.tests), ['a', 'aa', 'ab', 'root']);
		});

		test('initializes with valid counts', () => {
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestRunState.Queued]: 2,
				[TestRunState.Unset]: 2,
			});
		});

		test('setAllToState', () => {
			changed.clear();
			r.setAllToState(TestRunState.Queued, 't', (_, t) => t.item.label !== 'root');
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestRunState.Unset]: 1,
				[TestRunState.Queued]: 3,
			});

			r.setAllToState(TestRunState.Passed, 't', (_, t) => t.item.label !== 'root');
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestRunState.Unset]: 1,
				[TestRunState.Passed]: 3,
			});

			assert.deepStrictEqual(r.getStateById('id-a')?.ownComputedState, TestRunState.Passed);
			assert.deepStrictEqual(r.getStateById('id-a')?.tasks[0].state, TestRunState.Passed);
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'aa', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'ab', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'root', reason: TestResultItemChangeReason.ComputedStateChange },
			]);
		});

		test('updateState', () => {
			changed.clear();
			r.updateState('id-aa', 't', TestRunState.Running);
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestRunState.Unset]: 2,
				[TestRunState.Running]: 1,
				[TestRunState.Queued]: 1,
			});
			assert.deepStrictEqual(r.getStateById('id-aa')?.ownComputedState, TestRunState.Running);
			// update computed state:
			assert.deepStrictEqual(r.getStateById('id-root')?.computedState, TestRunState.Running);
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.ComputedStateChange },
				{ label: 'aa', reason: TestResultItemChangeReason.OwnStateChange },
				{ label: 'root', reason: TestResultItemChangeReason.ComputedStateChange },
			]);
		});

		test('retire', () => {
			changed.clear();
			r.retire('id-a');
			assert.deepStrictEqual(getChangeSummary(), [
				{ label: 'a', reason: TestResultItemChangeReason.Retired },
				{ label: 'aa', reason: TestResultItemChangeReason.ParentRetired },
				{ label: 'ab', reason: TestResultItemChangeReason.ParentRetired },
			]);

			changed.clear();
			r.retire('id-a');
			assert.strictEqual(changed.size, 0);
		});

		test('ignores outside run', () => {
			changed.clear();
			r.updateState('id-b', 't', TestRunState.Running);
			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestRunState.Queued]: 2,
				[TestRunState.Unset]: 2,
			});
			assert.deepStrictEqual(r.getStateById('id-b'), undefined);
		});

		test('markComplete', () => {
			r.setAllToState(TestRunState.Queued, 't', () => true);
			r.updateState('id-aa', 't', TestRunState.Passed);
			changed.clear();

			r.markComplete();

			assert.deepStrictEqual(r.counts, {
				...makeEmptyCounts(),
				[TestRunState.Passed]: 1,
				[TestRunState.Unset]: 3,
			});

			assert.deepStrictEqual(r.getStateById('id-root')?.ownComputedState, TestRunState.Unset);
			assert.deepStrictEqual(r.getStateById('id-aa')?.ownComputedState, TestRunState.Passed);
		});
	});

	suite('service', () => {
		let storage: ITestResultStorage;
		let results: TestResultService;

		class TestTestResultService extends TestResultService {
			override persistScheduler = { schedule: () => this.persistImmediately() } as any;
		}

		setup(() => {
			storage = new InMemoryResultStorage(new TestStorageService(), new NullLogService());
			results = new TestTestResultService(new MockContextKeyService(), storage);
		});

		test('pushes new result', () => {
			results.push(r);
			assert.deepStrictEqual(results.results, [r]);
		});

		test('serializes and re-hydrates', async () => {
			results.push(r);
			r.updateState('id-aa', 't', TestRunState.Passed);
			r.markComplete();
			await timeout(0); // allow persistImmediately async to happen

			results = new TestResultService(
				new MockContextKeyService(),
				storage,
			);

			assert.strictEqual(0, results.results.length);
			await timeout(0); // allow load promise to resolve
			assert.strictEqual(1, results.results.length);

			const [rehydrated, actual] = results.getStateById('id-root')!;
			const expected: any = { ...r.getStateById('id-root')! };
			delete expected.tasks[0].duration; // delete undefined props that don't survive serialization
			delete expected.item.range;
			delete expected.item.description;
			expected.item.uri = actual.item.uri;

			assert.deepStrictEqual(actual, { ...expected, src: undefined, retired: true, children: ['id-a'] });
			assert.deepStrictEqual(rehydrated.counts, r.counts);
			assert.strictEqual(typeof rehydrated.completedAt, 'number');
		});

		test('clears results but keeps ongoing tests', async () => {
			results.push(r);
			r.markComplete();

			const r2 = results.push(new LiveTestResult(
				'',
				emptyOutputController(),
				{ ...defaultOpts, tests: [] }
			));
			results.clear();

			assert.deepStrictEqual(results.results, [r2]);
		});

		test('keeps ongoing tests on top', async () => {
			results.push(r);
			const r2 = results.push(new LiveTestResult(
				'',
				emptyOutputController(),
				{ ...defaultOpts, tests: [] }
			));

			assert.deepStrictEqual(results.results, [r2, r]);
			r2.markComplete();
			assert.deepStrictEqual(results.results, [r, r2]);
			r.markComplete();
			assert.deepStrictEqual(results.results, [r, r2]);
		});

		const makeHydrated = async (completedAt = 42, state = TestRunState.Passed) => new HydratedTestResult({
			completedAt,
			id: 'some-id',
			tasks: [{ id: 't', running: false, name: undefined }],
			items: [{
				...(await getInitializedMainTestCollection()).getNodeById('id-a')!,
				tasks: [{ state, duration: 0, messages: [] }],
				computedState: state,
				ownComputedState: state,
				retired: undefined,
				children: [],
			}]
		}, () => Promise.resolve(bufferToStream(VSBuffer.alloc(0))));

		test('pushes hydrated results', async () => {
			results.push(r);
			const hydrated = await makeHydrated();
			results.push(hydrated);
			assert.deepStrictEqual(results.results, [r, hydrated]);
		});

		test('inserts in correct order', async () => {
			results.push(r);
			const hydrated1 = await makeHydrated();
			results.push(hydrated1);
			assert.deepStrictEqual(results.results, [r, hydrated1]);
		});

		test('inserts in correct order 2', async () => {
			results.push(r);
			const hydrated1 = await makeHydrated();
			results.push(hydrated1);
			const hydrated2 = await makeHydrated(30);
			results.push(hydrated2);
			assert.deepStrictEqual(results.results, [r, hydrated1, hydrated2]);
		});
	});
});
