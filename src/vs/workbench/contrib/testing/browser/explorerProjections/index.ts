/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectTree } from 'vs/base/browser/ui/tree/objectTree';
import { Event } from 'vs/base/common/event';
import { FuzzyScore } from 'vs/base/common/filters';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { Iterable } from 'vs/base/common/iterator';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Position } from 'vs/editor/common/core/position';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { InternalTestItem, TestIdWithSrc } from 'vs/workbench/contrib/testing/common/testCollection';

/**
 * Describes a rendering of tests in the explorer view. Different
 * implementations of this are used for trees and lists, and groupings.
 * Originally this was implemented as inline logic within the ViewModel and
 * using a single IncrementalTestChangeCollector, but this became hairy
 * with status projections.
 */
export interface ITestTreeProjection extends IDisposable {
	/**
	 * Event that fires when the projection changes.
	 */
	onUpdate: Event<void>;

	/**
	 * Fired when an element in the tree is expanded.
	 */
	expandElement(element: TestItemTreeElement, depth: number): void;

	/**
	 * Gets an element by its extension-assigned ID.
	 */
	getElementByTestId(testId: string): TestItemTreeElement | undefined;

	/**
	 * Gets the test at the given position in th editor. Should be fast,
	 * since it is called on each cursor move.
	 */
	getTestAtPosition(uri: URI, position: Position): TestItemTreeElement | undefined;

	/**
	 * Gets whether any test is defined in the given URI.
	 */
	hasTestInDocument(uri: URI): boolean;

	/**
	 * Applies pending update to the tree.
	 */
	applyTo(tree: ObjectTree<TestExplorerTreeElement, FuzzyScore>): void;
}

/**
 * Interface describing the workspace folder and test item tree elements.
 */
export interface IActionableTestTreeElement {
	/**
	 * Parent tree item.
	 */
	parent: IActionableTestTreeElement | null;

	/**
	 * Unique ID of the element in the tree.
	 */
	treeId: string;

	/**
	 * Test children of this item.
	 */
	children: Set<TestExplorerTreeElement>;

	/**
	 * Depth of the element in the tree.
	 */
	depth: number;

	/**
	 * Folder associated with this element.
	 */
	folder: IWorkspaceFolder;

	/**
	 * Tests to debug when the 'debug' context action is taken on this item.
	 */
	debuggable: Iterable<TestIdWithSrc>;

	/**
	 * Tests to run when the 'debug' context action is taken on this item.
	 */
	runnable: Iterable<TestIdWithSrc>;

	/**
	 * State to show on the item. This is generally the item's computed state
	 * from its children.
	 */
	state: TestResultState;

	/**
	 * Label for the item.
	 */
	label: string;
}

let idCounter = 0;

const getId = () => String(idCounter++);

export class TestTreeWorkspaceFolder implements IActionableTestTreeElement {
	/**
	 * @inheritdoc
	 */
	public readonly parent = null;

	/**
	 * @inheritdoc
	 */
	public readonly children = new Set<TestItemTreeElement>();

	/**
	 * @inheritdoc
	 */
	public readonly treeId = getId();

	/**
	 * @inheritdoc
	 */
	public readonly depth = 0;

	/**
	 * @inheritdoc
	 */
	public get runnable() {
		return Iterable.concatNested(Iterable.map(this.children, c => c.runnable));
	}

	/**
	 * @inheritdoc
	 */
	public get debuggable() {
		return Iterable.concatNested(Iterable.map(this.children, c => c.debuggable));
	}

	/**
	 * @inheritdoc
	 */
	public state = TestResultState.Unset;

	/**
	 * @inheritdoc
	 */
	public get label() {
		return this.folder.name;
	}

	constructor(public readonly folder: IWorkspaceFolder) { }
}

export class TestItemTreeElement implements IActionableTestTreeElement {
	/**
	 * @inheritdoc
	 */
	public readonly children = new Set<TestExplorerTreeElement>();

	/**
	 * @inheritdoc
	 */
	public readonly treeId = getId();

	/**
	 * @inheritdoc
	 */
	public depth: number = this.parent.depth + 1;

	/**
	 * @inheritdoc
	 */
	public get folder(): IWorkspaceFolder {
		return this.parent.folder;
	}

	/**
	 * @inheritdoc
	 */
	public get runnable() {
		return this.test.item.runnable
			? Iterable.single({ testId: this.test.item.extId, src: this.test.src })
			: Iterable.empty();
	}

	/**
	 * @inheritdoc
	 */
	public get debuggable() {
		return this.test.item.debuggable
			? Iterable.single({ testId: this.test.item.extId, src: this.test.src })
			: Iterable.empty();
	}

	public get description() {
		return this.test.item.description;
	}

	/**
	 * Whether the node's test result is 'retired' -- from an outdated test run.
	 */
	public retired = false;

	/**
	 * @inheritdoc
	 */
	public state = TestResultState.Unset;

	/**
	 * Own, non-computed state.
	 */
	public ownState = TestResultState.Unset;

	/**
	 * @inheritdoc
	 */
	public get label() {
		return this.test.item.label;
	}

	constructor(
		public readonly test: InternalTestItem,
		public readonly parent: TestItemTreeElement | TestTreeWorkspaceFolder,
	) { }
}

export class TestTreeErrorMessage {
	public readonly treeId = getId();
	public readonly children = new Set<never>();

	public get description() {
		return typeof this.message === 'string' ? this.message : this.message.value;
	}

	constructor(
		public readonly message: string | IMarkdownString,
		public readonly parent: TestExplorerTreeElement,
	) { }
}

export const isActionableTestTreeElement = (t: unknown): t is (TestItemTreeElement | TestTreeWorkspaceFolder) =>
	t instanceof TestItemTreeElement || t instanceof TestTreeWorkspaceFolder;

export type TestExplorerTreeElement = TestItemTreeElement | TestTreeWorkspaceFolder | TestTreeErrorMessage;
