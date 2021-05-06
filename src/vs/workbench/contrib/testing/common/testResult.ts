/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { newWriteableBufferStream, VSBuffer, VSBufferReadableStream, VSBufferWriteableStream } from 'vs/base/common/buffer';
import { Emitter } from 'vs/base/common/event';
import { Lazy } from 'vs/base/common/lazy';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { IComputedStateAccessor, refreshComputedState } from 'vs/workbench/contrib/testing/common/getComputedState';
import { ExtensionRunTestsRequest, ISerializedTestResults, ITestItem, ITestMessage, ITestRunTask, ITestTaskState, RunTestsRequest, TestIdPath, TestResultItem } from 'vs/workbench/contrib/testing/common/testCollection';
import { maxPriority, statesInOrder } from 'vs/workbench/contrib/testing/common/testingStates';

export interface ITestResult {
	/**
	 * Count of the number of tests in each run state.
	 */
	readonly counts: Readonly<TestStateCount>;

	/**
	 * Unique ID of this set of test results.
	 */
	readonly id: string;

	/**
	 * If the test is completed, the unix milliseconds time at which it was
	 * completed. If undefined, the test is still running.
	 */
	readonly completedAt: number | undefined;

	/**
	 * Whether this test result is triggered from an auto run.
	 */
	readonly isAutoRun?: boolean;

	/**
	 * Gets all tests involved in the run.
	 */
	tests: IterableIterator<TestResultItem>;

	/**
	 * List of this result's subtasks.
	 */
	tasks: ReadonlyArray<ITestRunTask>;

	/**
	 * Gets the state of the test by its extension-assigned ID.
	 */
	getStateById(testExtId: string): TestResultItem | undefined;

	/**
	 * Loads the output of the result as a stream.
	 */
	getOutput(): Promise<VSBufferReadableStream>;

	/**
	 * Serializes the test result. Used to save and restore results
	 * in the workspace.
	 */
	toJSON(): ISerializedTestResults | undefined;
}

export const getPathForTestInResult = (test: TestResultItem, results: ITestResult): TestIdPath => {
	const path = [test];
	while (true) {
		const parentId = path[0].parent;
		const parent = parentId && results.getStateById(parentId);
		if (!parent) {
			break;
		}

		path.unshift(parent);
	}

	return path.map(t => t.item.extId);
};

/**
 * Count of the number of tests in each run state.
 */
export type TestStateCount = { [K in TestResultState]: number };

export const makeEmptyCounts = () => {
	const o: Partial<TestStateCount> = {};
	for (const state of statesInOrder) {
		o[state] = 0;
	}

	return o as TestStateCount;
};

export const sumCounts = (counts: Iterable<TestStateCount>) => {
	const total = makeEmptyCounts();
	for (const count of counts) {
		for (const state of statesInOrder) {
			total[state] += count[state];
		}
	}

	return total;
};

/**
 * Deals with output of a {@link LiveTestResult}. By default we pass-through
 * data into the underlying write stream, but if a client requests to read it
 * we splice in the written data and then continue streaming incoming data.
 */
export class LiveOutputController {
	/** Set on close() to a promise that is resolved once closing is complete */
	private closed?: Promise<void>;
	/** Data written so far. This is available until the file closes. */
	private previouslyWritten: VSBuffer[] | undefined = [];

	private readonly dataEmitter = new Emitter<VSBuffer>();
	private readonly endEmitter = new Emitter<void>();

	constructor(
		private readonly writer: Lazy<[VSBufferWriteableStream, Promise<void>]>,
		private readonly reader: () => Promise<VSBufferReadableStream>,
	) { }

	/**
	 * Appends data to the output.
	 */
	public append(data: VSBuffer): Promise<void> | void {
		if (this.closed) {
			return this.closed;
		}

		this.previouslyWritten?.push(data);
		this.dataEmitter.fire(data);

		return this.writer.getValue()[0].write(data);
	}

	/**
	 * Reads the value of the stream.
	 */
	public read() {
		if (!this.previouslyWritten) {
			return this.reader();
		}

		const stream = newWriteableBufferStream();
		for (const chunk of this.previouslyWritten) {
			stream.write(chunk);
		}

		const disposable = new DisposableStore();
		disposable.add(this.dataEmitter.event(d => stream.write(d)));
		disposable.add(this.endEmitter.event(() => stream.end()));
		stream.on('end', () => disposable.dispose());

		return Promise.resolve(stream);
	}

	/**
	 * Closes the output, signalling no more writes will be made.
	 * @returns a promise that resolves when the output is written
	 */
	public close(): Promise<void> {
		if (this.closed) {
			return this.closed;
		}

		if (!this.writer.hasValue()) {
			this.closed = Promise.resolve();
		} else {
			const [stream, ended] = this.writer.getValue();
			stream.end();
			this.closed = ended;
		}

		this.endEmitter.fire();
		this.closed.then(() => {
			this.previouslyWritten = undefined;
			this.dataEmitter.dispose();
			this.endEmitter.dispose();
		});

		return this.closed;
	}
}

interface TestResultItemWithChildren extends TestResultItem {
	/** Children in the run */
	children: TestResultItemWithChildren[];
}

const itemToNode = (item: ITestItem, parent: string | null): TestResultItemWithChildren => ({
	parent,
	item: { ...item },
	children: [],
	tasks: [],
	ownComputedState: TestResultState.Unset,
	computedState: TestResultState.Unset,
	retired: false,
});

export const enum TestResultItemChangeReason {
	Retired,
	ParentRetired,
	ComputedStateChange,
	OwnStateChange,
}

export type TestResultItemChange = { item: TestResultItem; result: ITestResult } & (
	| { reason: TestResultItemChangeReason.Retired | TestResultItemChangeReason.ParentRetired | TestResultItemChangeReason.ComputedStateChange }
	| { reason: TestResultItemChangeReason.OwnStateChange; previous: TestResultState }
);

/**
 * Results of a test. These are created when the test initially started running
 * and marked as "complete" when the run finishes.
 */
export class LiveTestResult implements ITestResult {
	private readonly completeEmitter = new Emitter<void>();
	private readonly changeEmitter = new Emitter<TestResultItemChange>();
	private readonly testById = new Map<string, TestResultItemWithChildren>();
	private _completedAt?: number;

	public readonly onChange = this.changeEmitter.event;
	public readonly onComplete = this.completeEmitter.event;
	public readonly tasks: ITestRunTask[] = [];

	/**
	 * Test IDs directly included in this run.
	 */
	public readonly includedIds: ReadonlySet<string>;

	/**
	 * Test IDs excluded from this run.
	 */
	public readonly excludedIds: ReadonlySet<string>;

	/**
	 * Gets whether this test is from an auto-run.
	 */
	public readonly isAutoRun: boolean;

	/**
	 * @inheritdoc
	 */
	public get completedAt() {
		return this._completedAt;
	}

	/**
	 * @inheritdoc
	 */
	public readonly counts: { [K in TestResultState]: number } = makeEmptyCounts();

	/**
	 * @inheritdoc
	 */
	public get tests() {
		return this.testById.values();
	}

	private readonly computedStateAccessor: IComputedStateAccessor<TestResultItemWithChildren> = {
		getOwnState: i => i.ownComputedState,
		getCurrentComputedState: i => i.computedState,
		setComputedState: (i, s) => i.computedState = s,
		getChildren: i => i.children,
		getParents: i => {
			const { testById: testByExtId } = this;
			return (function* () {
				for (let parentId = i.parent; parentId;) {
					const parent = testByExtId.get(parentId);
					if (!parent) {
						break;
					}

					yield parent;
					parentId = parent.parent;
				}
			})();
		},
	};

	constructor(
		public readonly id: string,
		public readonly output: LiveOutputController,
		private readonly req: ExtensionRunTestsRequest | RunTestsRequest,
	) {
		this.isAutoRun = 'isAutoRun' in this.req && !!this.req.isAutoRun;
		this.includedIds = new Set(req.tests.map(t => typeof t === 'string' ? t : t.testId));
		this.excludedIds = new Set(req.exclude);
	}

	/**
	 * @inheritdoc
	 */
	public getStateById(extTestId: string) {
		return this.testById.get(extTestId);
	}

	/**
	 * Adds a new run task to the results.
	 */
	public addTask(task: ITestRunTask) {
		const index = this.tasks.length;
		this.tasks.push(task);

		for (const test of this.tests) {
			test.tasks.push({ duration: undefined, messages: [], state: TestResultState.Unset });
			this.fireUpdateAndRefresh(test, index, TestResultState.Queued);
		}
	}

	/**
	 * Add the chain of tests to the run. The first test in the chain should
	 * be either a test root, or a previously-known test.
	 */
	public addTestChainToRun(chain: ReadonlyArray<ITestItem>) {
		let parent = this.testById.get(chain[0].extId);
		if (!parent) { // must be a test root
			parent = this.addTestToRun(chain[0], null);
		}

		for (let i = 1; i < chain.length; i++) {
			parent = this.addTestToRun(chain[i], parent.item.extId);
		}

		for (let i = 0; i < this.tasks.length; i++) {
			this.fireUpdateAndRefresh(parent, i, TestResultState.Queued);
		}

		return undefined;
	}

	/**
	 * Updates the state of the test by its internal ID.
	 */
	public updateState(testId: string, taskId: string, state: TestResultState, duration?: number) {
		const entry = this.testById.get(testId);
		if (!entry) {
			return;
		}

		const index = this.mustGetTaskIndex(taskId);
		if (duration !== undefined) {
			entry.tasks[index].duration = duration;
		}

		this.fireUpdateAndRefresh(entry, index, state);
	}

	/**
	 * Appends a message for the test in the run.
	 */
	public appendMessage(testId: string, taskId: string, message: ITestMessage) {
		const entry = this.testById.get(testId);
		if (!entry) {
			return;
		}

		entry.tasks[this.mustGetTaskIndex(taskId)].messages.push(message);
		this.changeEmitter.fire({
			item: entry,
			result: this,
			reason: TestResultItemChangeReason.OwnStateChange,
			previous: entry.ownComputedState,
		});
	}

	/**
	 * @inheritdoc
	 */
	public getOutput() {
		return this.output.read();
	}

	/**
	 * Marks a test as retired. This can trigger it to be rerun in live mode.
	 */
	public retire(testId: string) {
		const root = this.testById.get(testId);
		if (!root || root.retired) {
			return;
		}

		const queue = [[root]];
		while (queue.length) {
			for (const entry of queue.pop()!) {
				if (!entry.retired) {
					entry.retired = true;
					queue.push(entry.children);
					this.changeEmitter.fire({
						result: this,
						item: entry,
						reason: entry === root
							? TestResultItemChangeReason.Retired
							: TestResultItemChangeReason.ParentRetired
					});
				}
			}
		}
	}

	/**
	 * Marks the task in the test run complete.
	 */
	public markTaskComplete(taskId: string) {
		this.tasks[this.mustGetTaskIndex(taskId)].running = false;
		this.setAllToState(
			TestResultState.Unset,
			taskId,
			t => t.state === TestResultState.Queued || t.state === TestResultState.Running,
		);
	}

	/**
	 * Notifies the service that all tests are complete.
	 */
	public markComplete() {
		if (this._completedAt !== undefined) {
			throw new Error('cannot complete a test result multiple times');
		}

		for (const task of this.tasks) {
			if (task.running) {
				this.markTaskComplete(task.id);
			}
		}

		this._completedAt = Date.now();
		this.completeEmitter.fire();
	}

	/**
	 * @inheritdoc
	 */
	public toJSON(): ISerializedTestResults | undefined {
		return this.completedAt && !('persist' in this.req && this.req.persist === false)
			? this.doSerialize.getValue()
			: undefined;
	}

	/**
	 * Updates all tests in the collection to the given state.
	 */
	protected setAllToState(state: TestResultState, taskId: string, when: (task: ITestTaskState, item: TestResultItem) => boolean) {
		const index = this.mustGetTaskIndex(taskId);
		for (const test of this.testById.values()) {
			if (when(test.tasks[index], test)) {
				this.fireUpdateAndRefresh(test, index, state);
			}
		}
	}

	private fireUpdateAndRefresh(entry: TestResultItem, taskIndex: number, newState: TestResultState) {
		const previousOwnComputed = entry.ownComputedState;
		entry.tasks[taskIndex].state = newState;
		const newOwnComputed = maxPriority(...entry.tasks.map(t => t.state));
		if (newOwnComputed === previousOwnComputed) {
			return;
		}

		entry.ownComputedState = newOwnComputed;
		this.counts[previousOwnComputed]--;
		this.counts[newOwnComputed]++;
		refreshComputedState(this.computedStateAccessor, entry, t =>
			this.changeEmitter.fire(
				t === entry
					? { item: entry, result: this, reason: TestResultItemChangeReason.OwnStateChange, previous: previousOwnComputed }
					: { item: t, result: this, reason: TestResultItemChangeReason.ComputedStateChange }
			),
		);
	}

	private addTestToRun(item: ITestItem, parent: string | null) {
		const node = itemToNode(item, parent);
		node.direct = this.includedIds.has(item.extId);
		this.testById.set(item.extId, node);
		this.counts[TestResultState.Unset]++;

		if (parent) {
			this.testById.get(parent)?.children.push(node);
		}

		if (this.tasks.length) {
			for (let i = 0; i < this.tasks.length; i++) {
				node.tasks.push({ duration: undefined, messages: [], state: TestResultState.Queued });
			}
		}

		return node;
	}

	private mustGetTaskIndex(taskId: string) {
		const index = this.tasks.findIndex(t => t.id === taskId);
		if (index === -1) {
			throw new Error(`Unknown task ${taskId} in updateState`);
		}

		return index;
	}

	private readonly doSerialize = new Lazy((): ISerializedTestResults => ({
		id: this.id,
		completedAt: this.completedAt!,
		tasks: this.tasks,
		items: [...this.testById.values()].map(entry => ({
			...entry,
			retired: undefined,
			src: undefined,
			children: [...entry.children.map(c => c.item.extId)],
		})),
	}));
}

/**
 * Test results hydrated from a previously-serialized test run.
 */
export class HydratedTestResult implements ITestResult {
	/**
	 * @inheritdoc
	 */
	public readonly counts = makeEmptyCounts();

	/**
	 * @inheritdoc
	 */
	public readonly id: string;

	/**
	 * @inheritdoc
	 */
	public readonly completedAt: number;

	/**
	 * @inheritdoc
	 */
	public readonly tasks: ITestRunTask[];

	/**
	 * @inheritdoc
	 */
	public get tests() {
		return this.testById.values();
	}

	private readonly testById = new Map<string, TestResultItem>();

	constructor(
		private readonly serialized: ISerializedTestResults,
		private readonly outputLoader: () => Promise<VSBufferReadableStream>,
		private readonly persist = true,
	) {
		this.id = serialized.id;
		this.completedAt = serialized.completedAt;
		this.tasks = serialized.tasks;

		for (const item of serialized.items) {
			const cast: TestResultItem = { ...item, retired: true };
			cast.item.uri = URI.revive(cast.item.uri);

			for (const task of cast.tasks) {
				for (const message of task.messages) {
					if (message.location) {
						message.location.uri = URI.revive(message.location.uri);
						message.location.range = Range.lift(message.location.range);
					}
				}
			}

			this.counts[item.ownComputedState]++;
			this.testById.set(item.item.extId, cast);
		}
	}

	/**
	 * @inheritdoc
	 */
	public getStateById(extTestId: string) {
		return this.testById.get(extTestId);
	}

	/**
	 * @inheritdoc
	 */
	public getOutput() {
		return this.outputLoader();
	}

	/**
	 * @inheritdoc
	 */
	public toJSON(): ISerializedTestResults | undefined {
		return this.persist ? this.serialized : undefined;
	}
}
