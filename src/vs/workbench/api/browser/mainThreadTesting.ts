/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { isDefined } from 'vs/base/common/types';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { ExtensionRunTestsRequest, getTestSubscriptionKey, ITestItem, ITestMessage, ITestRunTask, RunTestsRequest, TestDiffOpType, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { LiveTestResult } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { ITestRootProvider, ITestService } from 'vs/workbench/contrib/testing/common/testService';
import { ExtHostContext, ExtHostTestingResource, ExtHostTestingShape, IExtHostContext, MainContext, MainThreadTestingShape } from '../common/extHost.protocol';

const reviveDiff = (diff: TestsDiff) => {
	for (const entry of diff) {
		if (entry[0] === TestDiffOpType.Add || entry[0] === TestDiffOpType.Update) {
			const item = entry[1];
			if (item.item?.uri) {
				item.item.uri = URI.revive(item.item.uri);
			}
			if (item.item?.range) {
				item.item.range = Range.lift(item.item.range);
			}
		}
	}
};

@extHostNamedCustomer(MainContext.MainThreadTesting)
export class MainThreadTesting extends Disposable implements MainThreadTestingShape, ITestRootProvider {
	private readonly proxy: ExtHostTestingShape;
	private readonly testSubscriptions = new Map<string, IDisposable>();
	private readonly testProviderRegistrations = new Map<string, IDisposable>();

	constructor(
		extHostContext: IExtHostContext,
		@ITestService private readonly testService: ITestService,
		@ITestResultService private readonly resultService: ITestResultService,
	) {
		super();
		this.proxy = extHostContext.getProxy(ExtHostContext.ExtHostTesting);
		this._register(this.testService.onShouldSubscribe(args => this.proxy.$subscribeToTests(args.resource, args.uri)));
		this._register(this.testService.onShouldUnsubscribe(args => this.proxy.$unsubscribeFromTests(args.resource, args.uri)));

		const prevResults = resultService.results.map(r => r.toJSON()).filter(isDefined);
		if (prevResults.length) {
			this.proxy.$publishTestResults(prevResults);
		}

		this._register(resultService.onResultsChanged(evt => {
			const results = 'completed' in evt ? evt.completed : ('inserted' in evt ? evt.inserted : undefined);
			const serialized = results?.toJSON();
			if (serialized) {
				this.proxy.$publishTestResults([serialized]);
			}
		}));

		this._register(testService.registerRootProvider(this));

		for (const { resource, uri } of this.testService.subscriptions) {
			this.proxy.$subscribeToTests(resource, uri);
		}
	}

	/**
	 * @inheritdoc
	 */
	$addTestsToRun(runId: string, tests: ITestItem[]): void {
		for (const test of tests) {
			test.uri = URI.revive(test.uri);
			if (test.range) {
				test.range = Range.lift(test.range);
			}
		}

		this.withLiveRun(runId, r => r.addTestChainToRun(tests));
	}

	/**
	 * @inheritdoc
	 */
	$startedExtensionTestRun(req: ExtensionRunTestsRequest): void {
		this.resultService.createLiveResult(req);
	}

	/**
	 * @inheritdoc
	 */
	$startedTestRunTask(runId: string, task: ITestRunTask): void {
		this.withLiveRun(runId, r => r.addTask(task));
	}

	/**
	 * @inheritdoc
	 */
	$finishedTestRunTask(runId: string, taskId: string): void {
		this.withLiveRun(runId, r => r.markTaskComplete(taskId));
	}

	/**
	 * @inheritdoc
	 */
	$finishedExtensionTestRun(runId: string): void {
		this.withLiveRun(runId, r => r.markComplete());
	}

	/**
	 * @inheritdoc
	 */
	public $updateTestStateInRun(runId: string, taskId: string, testId: string, state: TestResultState, duration?: number): void {
		this.withLiveRun(runId, r => r.updateState(testId, taskId, state, duration));
	}

	/**
	 * @inheritdoc
	 */
	public $appendOutputToRun(runId: string, _taskId: string, output: VSBuffer): void {
		this.withLiveRun(runId, r => r.output.append(output));
	}


	/**
	 * @inheritdoc
	 */
	public $appendTestMessageInRun(runId: string, taskId: string, testId: string, message: ITestMessage): void {
		const r = this.resultService.getResult(runId);
		if (r && r instanceof LiveTestResult) {
			if (message.location) {
				message.location.uri = URI.revive(message.location.uri);
				message.location.range = Range.lift(message.location.range);
			}

			r.appendMessage(testId, taskId, message);
		}
	}

	/**
	 * @inheritdoc
	 */
	public $registerTestController(id: string) {
		const disposable = this.testService.registerTestController(id, {
			runTests: (req, token) => this.proxy.$runTestsForProvider(req, token),
			lookupTest: test => this.proxy.$lookupTest(test),
			expandTest: (src, levels) => this.proxy.$expandTest(src, isFinite(levels) ? levels : -1),
		});

		this.testProviderRegistrations.set(id, disposable);
	}

	/**
	 * @inheritdoc
	 */
	public $unregisterTestController(id: string) {
		this.testProviderRegistrations.get(id)?.dispose();
		this.testProviderRegistrations.delete(id);
	}

	/**
	 * @inheritdoc
	 */
	public $subscribeToDiffs(resource: ExtHostTestingResource, uriComponents: UriComponents): void {
		const uri = URI.revive(uriComponents);
		const disposable = this.testService.subscribeToDiffs(resource, uri,
			diff => this.proxy.$acceptDiff(resource, uriComponents, diff));
		this.testSubscriptions.set(getTestSubscriptionKey(resource, uri), disposable);
	}

	/**
	 * @inheritdoc
	 */
	public $unsubscribeFromDiffs(resource: ExtHostTestingResource, uriComponents: UriComponents): void {
		const key = getTestSubscriptionKey(resource, URI.revive(uriComponents));
		this.testSubscriptions.get(key)?.dispose();
		this.testSubscriptions.delete(key);
	}

	/**
	 * @inheritdoc
	 */
	public $publishDiff(resource: ExtHostTestingResource, uri: UriComponents, diff: TestsDiff): void {
		reviveDiff(diff);
		this.testService.publishDiff(resource, URI.revive(uri), diff);
	}

	public async $runTests(req: RunTestsRequest, token: CancellationToken): Promise<string> {
		const result = await this.testService.runTests(req, token);
		return result.id;
	}

	public override dispose() {
		super.dispose();
		for (const subscription of this.testSubscriptions.values()) {
			subscription.dispose();
		}
		this.testSubscriptions.clear();
	}

	private withLiveRun<T>(runId: string, fn: (run: LiveTestResult) => T): T | undefined {
		const r = this.resultService.getResult(runId);
		return r && r instanceof LiveTestResult ? fn(r) : undefined;
	}
}
