/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectTree } from 'vs/base/browser/ui/tree/objectTree';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceFolder, IWorkspaceFolderData, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { TestItemTreeElement, ITestTreeProjection, TestExplorerTreeElement } from 'vs/workbench/contrib/testing/browser/explorerProjections/index';
import { TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestSubscriptionListener } from 'vs/workbench/contrib/testing/common/workspaceTestCollectionService';
import { TestOwnedTestCollection, TestSingleUseCollection } from 'vs/workbench/contrib/testing/test/common/ownedTestCollection';

type SerializedTree = { e: string; children?: SerializedTree[] };

const element = document.createElement('div');
element.style.height = '1000px';
element.style.width = '200px';

export class TestObjectTree<T> extends ObjectTree<T, any> {
	constructor(serializer: (node: T) => string) {
		super(
			'test',
			element,
			{
				getHeight: () => 20,
				getTemplateId: () => 'default'
			},
			[
				{
					disposeTemplate: () => undefined,
					renderElement: (node, _index, container: HTMLElement) => {
						container.textContent = `${node.depth}:${serializer(node.element)}`;
					},
					renderTemplate: c => c,
					templateId: 'default'
				}
			],
			{
				sorter: {
					compare: (a, b) => serializer(a).localeCompare(serializer(b))
				}
			}
		);
		this.layout(1000, 200);
	}

	public getModel() {
		return this.model;
	}

	public getRendered() {
		const elements = element.querySelectorAll('.monaco-tl-contents');
		const sorted = [...elements].sort((a, b) => pos(a) - pos(b));
		let chain: SerializedTree[] = [{ e: '', children: [] }];
		for (const element of sorted) {
			const [depthStr, label] = element.textContent!.split(':');
			const depth = Number(depthStr);
			const parent = chain[depth - 1];
			const child = { e: label };
			parent.children = parent.children?.concat(child) ?? [child];
			chain[depth] = child;
		}

		return chain[0].children;
	}
}

const pos = (element: Element) => Number(element.parentElement!.parentElement!.getAttribute('aria-posinset'));

export const makeTestWorkspaceFolder = (name: string): IWorkspaceFolder => ({
	name,
	uri: URI.file(`/${name}`),
	index: 0,
	toResource: path => URI.file(`/${name}/${path}`)
});

// names are hard
export class TestTreeTestHarness<T extends ITestTreeProjection = ITestTreeProjection> extends Disposable {
	private readonly owned = new TestOwnedTestCollection();
	private readonly onDiff = this._register(new Emitter<[IWorkspaceFolderData, TestsDiff]>());
	public readonly onFolderChange = this._register(new Emitter<IWorkspaceFoldersChangeEvent>());
	public readonly c: TestSingleUseCollection = this._register(this.owned.createForHierarchy(d => this.c.setDiff(d /* don't clear during testing */)));
	private isProcessingDiff = false;
	public readonly projection: T;
	public readonly tree: TestObjectTree<TestExplorerTreeElement>;

	constructor(folders: IWorkspaceFolderData[], makeTree: (listener: TestSubscriptionListener) => T) {
		super();
		this.projection = this._register(makeTree({
			workspaceFolderCollections: folders.map(folder => [{ folder }, {
				expand: (testId: string, levels: number) => {
					this.c.expand(testId, levels);
					if (!this.isProcessingDiff) {
						this.onDiff.fire([folder, this.c.collectDiff()]);
					}
					return Promise.resolve();
				},
				all: [],
			}]),
			onDiff: this.onDiff.event,
			onFolderChange: this.onFolderChange.event,
		} as any));
		this.tree = this._register(new TestObjectTree(t => 'label' in t ? t.label : t.message.toString()));
		this._register(this.tree.onDidChangeCollapseState(evt => {
			if (evt.node.element instanceof TestItemTreeElement) {
				this.projection.expandElement(evt.node.element, evt.deep ? Infinity : 0);
			}
		}));
	}

	public flush(folder: IWorkspaceFolderData) {
		this.isProcessingDiff = true;
		while (this.c.currentDiff.length) {
			this.onDiff.fire([folder!, this.c.collectDiff()]);
		}
		this.isProcessingDiff = false;

		this.projection.applyTo(this.tree);
		return this.tree.getRendered();
	}
}
