/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestExplorerTreeElement, TestItemTreeElement, TestTreeErrorMessage, TestTreeWorkspaceFolder } from 'vs/workbench/contrib/testing/browser/explorerProjections/index';
import { applyTestItemUpdate, InternalTestItem, ITestItemUpdate } from 'vs/workbench/contrib/testing/common/testCollection';

/**
 * Test tree element element that groups be hierarchy.
 */
export class ByLocationTestItemElement extends TestItemTreeElement {
	private errorChild?: TestTreeErrorMessage;

	public override readonly parent: ByLocationFolderElement | ByLocationTestItemElement;

	constructor(
		test: InternalTestItem,
		parent: ByLocationFolderElement | ByLocationTestItemElement,
		protected readonly addedOrRemoved: (n: TestExplorerTreeElement) => void,
	) {
		super({ ...test, item: { ...test.item } }, parent);
		this.parent = parent;
		this.updateErrorVisiblity();
	}

	public update(patch: ITestItemUpdate) {
		applyTestItemUpdate(this.test, patch);
		this.updateErrorVisiblity();
	}

	private updateErrorVisiblity() {
		if (this.errorChild && !this.test.item.error) {
			this.addedOrRemoved(this.errorChild);
			this.children.delete(this.errorChild);
			this.errorChild = undefined;
		} else if (this.test.item.error && !this.errorChild) {
			this.errorChild = new TestTreeErrorMessage(this.test.item.error, this);
			this.children.add(this.errorChild);
			this.addedOrRemoved(this.errorChild);
		}
	}
}

/**
 * Workspace folder in the location view.
 */
export class ByLocationFolderElement extends TestTreeWorkspaceFolder {
	public override readonly children = new Set<ByLocationTestItemElement>();
}
