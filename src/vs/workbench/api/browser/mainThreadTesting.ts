/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { getTestSubscriptionKey, RunTestsRequest, RunTestsResult, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { ITestService } from 'vs/workbench/contrib/testing/common/testService';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { ExtHostContext, ExtHostTestingResource, ExtHostTestingShape, IExtHostContext, MainContext, MainThreadTestingShape } from '../common/extHost.protocol';
import { URI, UriComponents } from 'vs/base/common/uri';

@extHostNamedCustomer(MainContext.MainThreadTesting)
export class MainThreadTesting extends Disposable implements MainThreadTestingShape {
	private readonly proxy: ExtHostTestingShape;
	private readonly testSubscriptions = new Map<string, IDisposable>();

	constructor(
		extHostContext: IExtHostContext,
		@ITestService private readonly testService: ITestService,
	) {
		super();
		this.proxy = extHostContext.getProxy(ExtHostContext.ExtHostTesting);
		this._register(this.testService.onShouldSubscribe(args => this.proxy.$subscribeToTests(args.resource, args.uri)));
		this._register(this.testService.onShouldUnsubscribe(args => this.proxy.$unsubscribeFromTests(args.resource, args.uri)));
	}

	/**
	 * @inheritdoc
	 */
	public $registerTestProvider(id: string) {
		this.testService.registerTestController(id, {
			runTests: req => this.proxy.$runTestsForProvider(req),
		});
	}

	/**
	 * @inheritdoc
	 */
	public $unregisterTestProvider(id: string) {
		this.testService.unregisterTestController(id);
	}

	/**
	 * @inheritdoc
	 */
	$subscribeToDiffs(resource: ExtHostTestingResource, uriComponents: UriComponents): void {
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
		this.testService.publishDiff(resource, URI.revive(uri), diff);
	}

	public $runTests(req: RunTestsRequest): Promise<RunTestsResult> {
		return this.testService.runTests(req);
	}

	public dispose() {
		// no-op
	}
}
