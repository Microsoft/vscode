/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from 'vs/base/common/htmlContent';
import { URI } from 'vs/base/common/uri';
import { Location as ModeLocation } from 'vs/editor/common/modes';
import { ExtHostTestingResource } from 'vs/workbench/api/common/extHost.protocol';
import { TestMessageSeverity, TestRunState } from 'vs/workbench/api/common/extHostTypes';

/**
 * Request to them main thread to run a set of tests.
 */
export interface RunTestsRequest {
	tests: { testId: string; providerId: string }[];
	debug: boolean;
}

/**
 * Request from the main thread to run tests for a single provider.
 */
export interface RunTestForProviderRequest {
	providerId: string;
	ids: string[];
	debug: boolean;
}

/**
 * Response to a  {@link RunTestsRequest}
 */
export interface RunTestsResult {
	// todo
}

export const EMPTY_TEST_RESULT: RunTestsResult = {};

export const collectTestResults = (results: ReadonlyArray<RunTestsResult>) => {
	return results[0] || {}; // todo
};

export interface ITestMessage {
	message: string | IMarkdownString;
	severity: TestMessageSeverity | undefined;
	expectedOutput: string | undefined;
	actualOutput: string | undefined;
	location: ModeLocation | undefined;
}

export interface ITestState {
	runState: TestRunState;
	duration: number | undefined;
	messages: ITestMessage[];
}

/**
 * The TestItem from .d.ts, as a plain object without children.
 */
export interface ITestItem {
	label: string;
	children?: never;
	location: ModeLocation | undefined;
	description: string | undefined;
	runnable: boolean | undefined;
	debuggable: boolean | undefined;
	state: ITestState;
}

/**
 * TestItem-like shape, butm with an ID and children as strings.
 */
export interface InternalTestItem {
	id: string;
	providerId: string;
	parent: string | null;
	item: ITestItem;
}

export const enum TestDiffOpType {
	Add,
	Update,
	Remove,
}

export type TestsDiffOp =
	| [op: TestDiffOpType.Add, item: InternalTestItem]
	| [op: TestDiffOpType.Update, item: InternalTestItem]
	| [op: TestDiffOpType.Remove, itemId: string];

/**
 * Utility function to get a unique string for a subscription to a resource,
 * useful to keep maps of document or workspace folder subscription info.
 */
export const getTestSubscriptionKey = (resource: ExtHostTestingResource, uri: URI) => `${resource}:${uri.toString()}`;

/**
 * Request from the ext host or main thread to indicate that tests have
 * changed. It's assumed that any item upserted *must* have its children
 * previously also upserted, or upserted as part of the same operation.
 * Children that no longer exist in an upserted item will be removed.
 */
export type TestsDiff = TestsDiffOp[];

/**
 * @private
 */
export interface IncrementalTestCollectionItem extends InternalTestItem {
	children: Set<string>;
}

/**
 * The IncrementalChangeCollector is used in the IncrementalTestCollection
 * and called with diff changes as they're applied. This is used in the
 * ext host to create a cohesive change event from a diff.
 */
export class IncrementalChangeCollector<T> {
	/**
	 * A node was added.
	 */
	public add(node: T): void { }

	/**
	 * A node in the collection was updated.
	 */
	public update(node: T): void { }

	/**
	 * A node was removed.
	 */
	public remove(node: T): void { }

	/**
	 * Called when the diff has been applied.
	 */
	public complete(): void { }
}

/**
 * Maintains tests in this extension host sent from the main thread.
 */
export abstract class AbstractIncrementalTestCollection<T extends IncrementalTestCollectionItem>  {
	/**
	 * Map of item IDs to test item objects.
	 */
	protected readonly items = new Map<string, T>();

	/**
	 * ID of test root items.
	 */
	protected readonly roots = new Set<string>();

	/**
	 * Applies the diff to the collection.
	 */
	public apply(diff: TestsDiff) {
		const changes = this.createChangeCollector();

		for (const op of diff) {
			switch (op[0]) {
				case TestDiffOpType.Add: {
					const item = op[1];
					if (!item.parent) {
						this.roots.add(item.id);
						const created = this.createItem(item);
						this.items.set(item.id, created);
						changes.add(created);
					} else if (this.items.has(item.parent)) {
						const parent = this.items.get(item.parent)!;
						parent.children.add(item.id);
						const created = this.createItem(item, parent);
						this.items.set(item.id, created);
						changes.add(created);
					}
					break;
				}

				case TestDiffOpType.Update: {
					const item = op[1];
					const existing = this.items.get(item.id);
					if (existing) {
						Object.assign(existing.item, item.item);
						changes.update(existing);
					}
					break;
				}

				case TestDiffOpType.Remove: {
					const toRemove = this.items.get(op[1]);
					if (!toRemove) {
						break;
					}

					if (toRemove.parent) {
						const parent = this.items.get(toRemove.parent)!;
						parent.children.delete(toRemove.id);
					} else {
						this.roots.delete(toRemove.id);
					}

					const queue: Iterable<string>[] = [[op[1]]];
					while (queue.length) {
						for (const itemId of queue.pop()!) {
							const existing = this.items.get(itemId);
							if (existing) {
								queue.push(existing.children);
								this.items.delete(itemId);
								changes.remove(existing);
							}
						}
					}
				}
			}
		}

		changes.complete();
	}

	/**
	 * Called before a diff is applied to create a new change collector.
	 */
	protected createChangeCollector() {
		return new IncrementalChangeCollector<T>();
	}

	/**
	 * Creates a new item for the collection from the internal test item.
	 */
	protected abstract createItem(internal: InternalTestItem, parent?: T): T;
}
