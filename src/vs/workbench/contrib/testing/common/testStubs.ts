/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { TestItemImpl, TestItemStatus, TestResultState } from 'vs/workbench/api/common/extHostTypes';

export { TestItemImpl, TestResultState } from 'vs/workbench/api/common/extHostTypes';
export * as Convert from 'vs/workbench/api/common/extHostTypeConverters';

export const stubTest = (label: string, idPrefix = 'id-', children: TestItemImpl[] = [], uri = URI.file('/')): TestItemImpl => {
	const item = new TestItemImpl(idPrefix + label, label, uri, undefined);
	if (children.length) {
		item.status = TestItemStatus.Pending;
		item.resolveHandler = () => {
			for (const child of children) {
				item.addChild(child);
			}

			item.status = TestItemStatus.Resolved;
		};
	}

	return item;
};

export const testStubsChain = (stub: TestItemImpl, path: string[], slice = 0) => {
	const tests = [stub];
	for (const segment of path) {
		if (stub.status !== TestItemStatus.Resolved) {
			stub.resolveHandler!(CancellationToken.None);
		}

		stub = stub.children.get(segment)!;
		if (!stub) {
			throw new Error(`missing child ${segment}`);
		}

		tests.push(stub);
	}

	return tests.slice(slice);
};

export const testStubs = {
	test: stubTest,
	nested: (idPrefix = 'id-') => stubTest('root', idPrefix, [
		stubTest('a', idPrefix, [stubTest('aa', idPrefix), stubTest('ab', idPrefix)]),
		stubTest('b', idPrefix),
	]),
};

export const ReExportedTestRunState = TestResultState;
