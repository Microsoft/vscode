/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { RunTestForProviderRequest, RunTestsRequest, RunTestsResult, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';

export const ITestService = createDecorator<ITestService>('testService');

export interface MainTestController {
	runTests(request: RunTestForProviderRequest): Promise<RunTestsResult>;
}

export type TestDiffListener = (diff: TestsDiff) => void;

export interface ITestService {
	readonly _serviceBrand: undefined;
	readonly onShouldSubscribe: Event<{ resource: ExtHostTestingResource, uri: URI }>;
	readonly onShouldUnsubscribe: Event<{ resource: ExtHostTestingResource, uri: URI }>;
	registerTestController(id: string, controller: MainTestController): void;
	unregisterTestController(id: string): void;
	runTests(req: RunTestsRequest): Promise<RunTestsResult>;
	publishDiff(resource: ExtHostTestingResource, uri: URI, diff: TestsDiff): void;
	subscribeToDiffs(resource: ExtHostTestingResource, uri: URI, acceptDiff: TestDiffListener): IDisposable;
}
