/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mapFind } from 'vs/base/common/arrays';
import { DeferredPromise, isThenable, RunOnceScheduler } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IDisposable, IReference } from 'vs/base/common/lifecycle';
import { assertNever } from 'vs/base/common/types';
import { ExtHostTestItemEvent, ExtHostTestItemEventType, getPrivateApiFor } from 'vs/workbench/api/common/extHostTestingPrivateApi';
import * as Convert from 'vs/workbench/api/common/extHostTypeConverters';
import { TestItemImpl, TestItemStatus } from 'vs/workbench/api/common/extHostTypes';
import { applyTestItemUpdate, InternalTestItem, TestDiffOpType, TestItemExpandState, TestsDiff, TestsDiffOp } from 'vs/workbench/contrib/testing/common/testCollection';

type TestItemRaw = Convert.TestItem.Raw;

export interface IHierarchyProvider {
	getChildren(node: TestItemRaw, token: CancellationToken): Iterable<TestItemRaw> | AsyncIterable<TestItemRaw> | undefined | null;
}

/**
 * @private
 */
export class OwnedTestCollection {
	protected readonly testIdsToInternal = new Map<number, TestTree<OwnedCollectionTestItem>>();

	/**
	 * Gets test information by ID, if it was defined and still exists in this
	 * extension host.
	 */
	public getTestById(id: string, preferTree?: number): undefined | [
		tree: TestTree<OwnedCollectionTestItem>,
		test: OwnedCollectionTestItem,
	] {
		if (preferTree !== undefined) {
			const tree = this.testIdsToInternal.get(preferTree);
			const test = tree?.get(id);
			if (test) {
				return [tree!, test];
			}
		}
		return mapFind(this.testIdsToInternal.values(), t => {
			const owned = t.get(id);
			return owned && [t, owned];
		});
	}

	/**
	 * Creates a new test collection for a specific hierarchy for a workspace
	 * or document observation.
	 */
	public createForHierarchy(publishDiff: (diff: TestsDiff) => void = () => undefined) {
		return new SingleUseTestCollection(this.createIdMap(treeIdCounter++), publishDiff);
	}

	protected createIdMap(id: number): IReference<TestTree<OwnedCollectionTestItem>> {
		const tree = new TestTree<OwnedCollectionTestItem>(id);
		this.testIdsToInternal.set(tree.id, tree);
		return { object: tree, dispose: () => this.testIdsToInternal.delete(tree.id) };
	}
}
/**
 * @private
 */
export interface OwnedCollectionTestItem extends InternalTestItem {
	actual: TestItemImpl;
	/**
	 * Number of levels of items below this one that are expanded. May be infinite.
	 */
	expandLevels?: number;
	initialExpand?: DeferredPromise<void>;
	discoverCts?: CancellationTokenSource;
}

/**
 * Enum for describing relative positions of tests. Similar to
 * `node.compareDocumentPosition` in the DOM.
 */
export const enum TestPosition {
	/** Neither a nor b are a child of one another. They may share a common parent, though. */
	Disconnected,
	/** b is a child of a */
	IsChild,
	/** b is a parent of a */
	IsParent,
	/** a === b */
	IsSame,
}

let treeIdCounter = 0;

/**
 * Test tree is (or will be after debt week 2020-03) the standard collection
 * for test trees. Internally it indexes tests by their extension ID in
 * a map.
 */
export class TestTree<T extends InternalTestItem> {
	private readonly map = new Map<string, T>();
	private readonly _roots = new Set<T>();
	public readonly roots: ReadonlySet<T> = this._roots;

	constructor(public readonly id: number) { }

	/**
	 * Gets the size of the tree.
	 */
	public get size() {
		return this.map.size;
	}

	/**
	 * Adds a new test to the tree if it doesn't exist.
	 * @throws if a duplicate item is inserted
	 */
	public add(test: T) {
		if (this.map.has(test.item.extId)) {
			throw new Error(`Attempted to insert a duplicate test item ID ${test.item.extId}`);
		}

		this.map.set(test.item.extId, test);
		if (!test.parent) {
			this._roots.add(test);
		}
	}

	/**
	 * Gets whether the test exists in the tree.
	 */
	public has(testId: string) {
		return this.map.has(testId);
	}

	/**
	 * Removes a test ID from the tree. This is NOT recursive.
	 */
	public delete(testId: string) {
		const existing = this.map.get(testId);
		if (!existing) {
			return false;
		}

		this.map.delete(testId);
		this._roots.delete(existing);
		return true;
	}

	/**
	 * Gets a test item by ID from the tree.
	 */
	public get(testId: string) {
		return this.map.get(testId);
	}

	/**
 * Compares the positions of the two items in the test tree.
	 */
	public comparePositions(aOrId: T | string, bOrId: T | string) {
		const a = typeof aOrId === 'string' ? this.map.get(aOrId) : aOrId;
		const b = typeof bOrId === 'string' ? this.map.get(bOrId) : bOrId;
		if (!a || !b) {
			return TestPosition.Disconnected;
		}

		if (a === b) {
			return TestPosition.IsSame;
		}

		for (let p = this.map.get(b.parent!); p; p = this.map.get(p.parent!)) {
			if (p === a) {
				return TestPosition.IsChild;
			}
		}

		for (let p = this.map.get(a.parent!); p; p = this.map.get(p.parent!)) {
			if (p === b) {
				return TestPosition.IsParent;
			}
		}

		return TestPosition.Disconnected;
	}

	/**
	 * Iterates over all test in the tree.
	 */
	[Symbol.iterator]() {
		return this.map.values();
	}
}

/**
 * Maintains tests created and registered for a single set of hierarchies
 * for a workspace or document.
 * @private
 */
export class SingleUseTestCollection implements IDisposable {
	protected readonly testItemToInternal = new Map<TestItemRaw, OwnedCollectionTestItem>();
	protected diff: TestsDiff = [];
	private readonly debounceSendDiff = new RunOnceScheduler(() => this.flushDiff(), 200);

	public get treeId() {
		return this.testIdToInternal.object.id;
	}

	constructor(
		private readonly testIdToInternal: IReference<TestTree<OwnedCollectionTestItem>>,
		private readonly publishDiff: (diff: TestsDiff) => void,
	) { }

	/**
	 * Adds a new root node to the collection.
	 */
	public addRoot(item: TestItemRaw, controllerId: string) {
		this.addItem(item, controllerId, null);
	}

	/**
	 * Gets test information by its reference, if it was defined and still exists
	 * in this extension host.
	 */
	public getTestByReference(item: TestItemRaw) {
		return this.testItemToInternal.get(item);
	}

	/**
	 * Gets a diff of all changes that have been made, and clears the diff queue.
	 */
	public collectDiff() {
		const diff = this.diff;
		this.diff = [];
		return diff;
	}

	/**
	 * Pushes a new diff entry onto the collected diff list.
	 */
	public pushDiff(diff: TestsDiffOp) {
		// Try to merge updates, since they're invoked per-property
		const last = this.diff[this.diff.length - 1];
		if (last && diff[0] === TestDiffOpType.Update) {
			if (last[0] === TestDiffOpType.Update && last[1].extId === diff[1].extId) {
				applyTestItemUpdate(last[1], diff[1]);
				return;
			}

			if (last[0] === TestDiffOpType.Add && last[1].item.extId === diff[1].extId) {
				applyTestItemUpdate(last[1], diff[1]);
				return;
			}
		}

		this.diff.push(diff);

		if (!this.debounceSendDiff.isScheduled()) {
			this.debounceSendDiff.schedule();
		}
	}

	/**
	 * Expands the test and the given number of `levels` of children. If levels
	 * is < 0, then all children will be expanded. If it's 0, then only this
	 * item will be expanded.
	 */
	public expand(testId: string, levels: number): Promise<void> | void {
		const internal = this.testIdToInternal.object.get(testId);
		if (!internal) {
			return;
		}

		if (internal.expandLevels === undefined || levels > internal.expandLevels) {
			internal.expandLevels = levels;
		}

		// try to avoid awaiting things if the provider returns synchronously in
		// order to keep everything in a single diff and DOM update.
		if (internal.expand === TestItemExpandState.Expandable) {
			const r = this.refreshChildren(internal);
			return !r.isSettled
				? r.p.then(() => this.expandChildren(internal, levels - 1))
				: this.expandChildren(internal, levels - 1);
		} else if (internal.expand === TestItemExpandState.Expanded) {
			return internal.initialExpand?.isSettled === false
				? internal.initialExpand.p.then(() => this.expandChildren(internal, levels - 1))
				: this.expandChildren(internal, levels - 1);
		}
	}

	/**
	 * @inheritdoc
	 */
	public dispose() {
		for (const item of this.testItemToInternal.values()) {
			item.discoverCts?.dispose(true);
			getPrivateApiFor(item.actual).bus.dispose();
		}

		this.diff = [];
		this.testIdToInternal.dispose();
		this.debounceSendDiff.dispose();
	}

	private onTestItemEvent(internal: OwnedCollectionTestItem, evt: ExtHostTestItemEvent) {
		const extId = internal?.actual.id;

		switch (evt[0]) {
			case ExtHostTestItemEventType.Invalidated:
				this.pushDiff([TestDiffOpType.Retire, extId]);
				break;

			case ExtHostTestItemEventType.Disposed:
				this.removeItem(internal);
				break;

			case ExtHostTestItemEventType.NewChild:
				this.addItem(evt[1], internal.src.controller, internal);
				break;

			case ExtHostTestItemEventType.SetProp:
				const [_, key, value] = evt;
				switch (key) {
					case 'status':
						this.updateExpandability(internal);
						break;
					case 'range':
						this.pushDiff([TestDiffOpType.Update, { extId, item: { range: Convert.Range.from(value) }, }]);
						break;
					case 'error':
						this.pushDiff([TestDiffOpType.Update, { extId, item: { error: Convert.MarkdownString.fromStrict(value) || null }, }]);
						break;
					default:
						this.pushDiff([TestDiffOpType.Update, { extId, item: { [key]: value ?? null } }]);
						break;
				}
				break;
			default:
				assertNever(evt[0]);
		}
	}

	private addItem(actual: TestItemRaw, controllerId: string, parent: OwnedCollectionTestItem | null) {
		if (!(actual instanceof TestItemImpl)) {
			throw new Error(`TestItems provided to the VS Code API must extend \`vscode.TestItem\`, but ${actual.id} did not`);
		}

		if (this.testItemToInternal.has(actual)) {
			throw new Error(`Attempted to add a single TestItem ${actual.id} multiple times to the tree`);
		}

		if (this.testIdToInternal.object.has(actual.id)) {
			throw new Error(`Attempted to insert a duplicate test item ID ${actual.id}`);
		}

		const parentId = parent ? parent.item.extId : null;
		const expand = actual.resolveHandler ? TestItemExpandState.Expandable : TestItemExpandState.NotExpandable;
		// always expand root node to know if there are tests (and whether to show the welcome view)
		const pExpandLvls = parent ? parent.expandLevels : 1;
		const src = { controller: controllerId, tree: this.testIdToInternal.object.id };
		const internal: OwnedCollectionTestItem = {
			actual,
			parent: parentId,
			item: Convert.TestItem.from(actual),
			expandLevels: pExpandLvls /* intentionally undefined or 0 */ ? pExpandLvls - 1 : undefined,
			expand: TestItemExpandState.NotExpandable, // updated by `updateExpandability` down below
			src,
		};

		this.testIdToInternal.object.add(internal);
		this.testItemToInternal.set(actual, internal);
		this.pushDiff([TestDiffOpType.Add, { parent: parentId, src, expand, item: internal.item }]);

		const api = getPrivateApiFor(actual);
		api.parent = parent?.actual;
		api.bus.event(this.onTestItemEvent.bind(this, internal));

		// important that this comes after binding the event bus otherwise we
		// might miss a synchronous discovery completion
		this.updateExpandability(internal);

		// Discover any existing children that might have already been added
		for (const child of api.children.values()) {
			if (!this.testItemToInternal.has(child)) {
				this.addItem(child, controllerId, internal);
			}
		}
	}

	/**
	 * Updates the `expand` state of the item. Should be called whenever the
	 * resolved state of the item changes. Can automatically expand the item
	 * if requested by a consumer.
	 */
	private updateExpandability(internal: OwnedCollectionTestItem) {
		let newState: TestItemExpandState;
		if (!internal.actual.resolveHandler) {
			newState = TestItemExpandState.NotExpandable;
		} else if (internal.actual.status === TestItemStatus.Pending) {
			newState = internal.discoverCts
				? TestItemExpandState.BusyExpanding
				: TestItemExpandState.Expandable;
		} else {
			internal.initialExpand?.complete();
			newState = TestItemExpandState.Expanded;
		}

		if (newState === internal.expand) {
			return;
		}

		internal.expand = newState;
		this.pushDiff([TestDiffOpType.Update, { extId: internal.actual.id, expand: newState }]);

		if (newState === TestItemExpandState.Expandable && internal.expandLevels !== undefined) {
			this.refreshChildren(internal);
		}
	}

	/**
	 * Expands all children of the item, "levels" deep. If levels is 0, only
	 * the children will be expanded. If it's 1, the children and their children
	 * will be expanded. If it's <0, it's a no-op.
	 */
	private expandChildren(internal: OwnedCollectionTestItem, levels: number): Promise<void> | void {
		if (levels < 0) {
			return;
		}

		const asyncChildren = [...internal.actual.children.values()]
			.map(c => this.expand(c.id, levels))
			.filter(isThenable);

		if (asyncChildren.length) {
			return Promise.all(asyncChildren).then(() => { });
		}
	}

	/**
	 * Calls `discoverChildren` on the item, refreshing all its tests.
	 */
	private refreshChildren(internal: OwnedCollectionTestItem) {
		if (internal.discoverCts) {
			internal.discoverCts.dispose(true);
		}

		if (!internal.actual.resolveHandler) {
			const p = new DeferredPromise<void>();
			p.complete();
			return p;
		}

		internal.expand = TestItemExpandState.BusyExpanding;
		internal.discoverCts = new CancellationTokenSource();
		this.pushExpandStateUpdate(internal);

		internal.initialExpand = new DeferredPromise<void>();
		internal.actual.resolveHandler(internal.discoverCts.token);

		return internal.initialExpand;
	}

	private pushExpandStateUpdate(internal: OwnedCollectionTestItem) {
		this.pushDiff([TestDiffOpType.Update, { extId: internal.actual.id, expand: internal.expand }]);
	}

	private removeItem(internal: OwnedCollectionTestItem) {
		this.pushDiff([TestDiffOpType.Remove, internal.actual.id]);

		const queue: (OwnedCollectionTestItem | undefined)[] = [internal];
		while (queue.length) {
			const item = queue.pop();
			if (!item) {
				continue;
			}

			item.discoverCts?.dispose(true);
			this.testIdToInternal.object.delete(item.item.extId);
			this.testItemToInternal.delete(item.actual);
			for (const child of item.actual.children.values()) {
				queue.push(this.testIdToInternal.object.get(child.id));
			}
		}
	}

	public flushDiff() {
		const diff = this.collectDiff();
		if (diff.length) {
			this.publishDiff(diff);
		}
	}
}
