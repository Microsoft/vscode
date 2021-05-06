/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ITreeNode, ITreeRenderer, IDataSource } from 'vs/base/browser/ui/tree/tree';
import { IListVirtualDelegate, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { DataTree } from 'vs/base/browser/ui/tree/dataTree';

interface E {
	value: number;
	children?: E[];
}

suite('DataTree', function () {
	let tree: DataTree<E, E>;

	const root: E = {
		value: -1,
		children: [
			{ value: 0, children: [{ value: 10 }, { value: 11 }, { value: 12 }] },
			{ value: 1 },
			{ value: 2 },
		]
	};

	const empty: E = {
		value: -1,
		children: []
	};

	setup(() => {
		const container = document.createElement('div');
		container.style.width = '200px';
		container.style.height = '200px';

		const delegate = new class implements IListVirtualDelegate<E> {
			getHeight() { return 20; }
			getTemplateId(): string { return 'default'; }
		};

		const renderer = new class implements ITreeRenderer<E, void, HTMLElement> {
			readonly templateId = 'default';
			renderTemplate(container: HTMLElement): HTMLElement {
				return container;
			}
			renderElement(element: ITreeNode<E, void>, index: number, templateData: HTMLElement): void {
				templateData.textContent = `${element.element.value}`;
			}
			disposeTemplate(): void { }
		};

		const dataSource = new class implements IDataSource<E, E> {
			getChildren(element: E): E[] {
				return element.children || [];
			}
		};

		const identityProvider = new class implements IIdentityProvider<E> {
			getId(element: E): { toString(): string; } {
				return `${element.value}`;
			}
		};

		tree = new DataTree<E, E>('test', container, delegate, [renderer], dataSource, {
			identityProvider
		});
		tree.layout(200);
	});

	teardown(() => {
		tree.dispose();
	});

	test('view state is lost implicitly', () => {
		tree.setInput(root);

		let navigator = tree.navigate();
		assert.strictEqual(navigator.next()!.value, 0);
		assert.strictEqual(navigator.next()!.value, 10);
		assert.strictEqual(navigator.next()!.value, 11);
		assert.strictEqual(navigator.next()!.value, 12);
		assert.strictEqual(navigator.next()!.value, 1);
		assert.strictEqual(navigator.next()!.value, 2);
		assert.strictEqual(navigator.next()!, null);

		tree.collapse(root.children![0]);
		navigator = tree.navigate();
		assert.strictEqual(navigator.next()!.value, 0);
		assert.strictEqual(navigator.next()!.value, 1);
		assert.strictEqual(navigator.next()!.value, 2);
		assert.strictEqual(navigator.next()!, null);

		tree.setSelection([root.children![1]]);
		tree.setFocus([root.children![2]]);

		tree.setInput(empty);
		tree.setInput(root);
		navigator = tree.navigate();
		assert.strictEqual(navigator.next()!.value, 0);
		assert.strictEqual(navigator.next()!.value, 10);
		assert.strictEqual(navigator.next()!.value, 11);
		assert.strictEqual(navigator.next()!.value, 12);
		assert.strictEqual(navigator.next()!.value, 1);
		assert.strictEqual(navigator.next()!.value, 2);
		assert.strictEqual(navigator.next()!, null);

		assert.deepStrictEqual(tree.getSelection(), []);
		assert.deepStrictEqual(tree.getFocus(), []);
	});

	test('view state can be preserved', () => {
		tree.setInput(root);

		let navigator = tree.navigate();
		assert.strictEqual(navigator.next()!.value, 0);
		assert.strictEqual(navigator.next()!.value, 10);
		assert.strictEqual(navigator.next()!.value, 11);
		assert.strictEqual(navigator.next()!.value, 12);
		assert.strictEqual(navigator.next()!.value, 1);
		assert.strictEqual(navigator.next()!.value, 2);
		assert.strictEqual(navigator.next()!, null);

		tree.collapse(root.children![0]);
		navigator = tree.navigate();
		assert.strictEqual(navigator.next()!.value, 0);
		assert.strictEqual(navigator.next()!.value, 1);
		assert.strictEqual(navigator.next()!.value, 2);
		assert.strictEqual(navigator.next()!, null);

		tree.setSelection([root.children![1]]);
		tree.setFocus([root.children![2]]);

		const viewState = tree.getViewState();

		tree.setInput(empty);
		tree.setInput(root, viewState);
		navigator = tree.navigate();
		assert.strictEqual(navigator.next()!.value, 0);
		assert.strictEqual(navigator.next()!.value, 1);
		assert.strictEqual(navigator.next()!.value, 2);
		assert.strictEqual(navigator.next()!, null);

		assert.deepStrictEqual(tree.getSelection(), [root.children![1]]);
		assert.deepStrictEqual(tree.getFocus(), [root.children![2]]);
	});
});
