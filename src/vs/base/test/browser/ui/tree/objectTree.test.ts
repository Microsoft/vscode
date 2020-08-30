/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { IListVirtualDelegate, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { ObjectTree, CompressibleObjectTree, ICompressibleTreeRenderer } from 'vs/base/browser/ui/tree/objectTree';
import { ICompressedTreeNode } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';

suite('ObjectTree', function () {
	suite('TreeNavigator', function () {
		let tree: ObjectTree<number>;
		let filter = (_: number) => true;

		setup(() => {
			const container = document.createElement('div');
			container.style.width = '200px';
			container.style.height = '200px';

			const delegate = new class implements IListVirtualDelegate<number> {
				getHeight() { return 20; }
				getTemplateId(): string { return 'default'; }
			};

			const renderer = new class implements ITreeRenderer<number, void, HTMLElement> {
				readonly templateId = 'default';
				renderTemplate(container: HTMLElement): HTMLElement {
					return container;
				}
				renderElement(element: ITreeNode<number, void>, index: number, templateData: HTMLElement): void {
					templateData.textContent = `${element.element}`;
				}
				disposeTemplate(): void { }
			};

			tree = new ObjectTree<number>('test', container, delegate, [renderer], { filter: { filter: (el) => filter(el) } });
			tree.layout(200);
		});

		teardown(() => {
			tree.dispose();
			filter = (_: number) => true;
		});

		test('should be able to navigate', () => {
			tree.setChildren(null, [
				{
					element: 0, children: [
						{ element: 10 },
						{ element: 11 },
						{ element: 12 },
					]
				},
				{ element: 1 },
				{ element: 2 }
			]);

			const navigator = tree.navigate();

			assert.equal(navigator.current(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.current(), 0);
			assert.equal(navigator.next(), 10);
			assert.equal(navigator.current(), 10);
			assert.equal(navigator.next(), 11);
			assert.equal(navigator.current(), 11);
			assert.equal(navigator.next(), 12);
			assert.equal(navigator.current(), 12);
			assert.equal(navigator.next(), 1);
			assert.equal(navigator.current(), 1);
			assert.equal(navigator.next(), 2);
			assert.equal(navigator.current(), 2);
			assert.equal(navigator.previous(), 1);
			assert.equal(navigator.current(), 1);
			assert.equal(navigator.previous(), 12);
			assert.equal(navigator.previous(), 11);
			assert.equal(navigator.previous(), 10);
			assert.equal(navigator.previous(), 0);
			assert.equal(navigator.previous(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.next(), 10);
			assert.equal(navigator.first(), 0);
			assert.equal(navigator.last(), 2);
		});

		test('should skip collapsed nodes', () => {
			tree.setChildren(null, [
				{
					element: 0, collapsed: true, children: [
						{ element: 10 },
						{ element: 11 },
						{ element: 12 },
					]
				},
				{ element: 1 },
				{ element: 2 }
			]);

			const navigator = tree.navigate();

			assert.equal(navigator.current(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.next(), 1);
			assert.equal(navigator.next(), 2);
			assert.equal(navigator.next(), null);
			assert.equal(navigator.previous(), 2);
			assert.equal(navigator.previous(), 1);
			assert.equal(navigator.previous(), 0);
			assert.equal(navigator.previous(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.first(), 0);
			assert.equal(navigator.last(), 2);
		});

		test('should skip filtered elements', () => {
			filter = el => el % 2 === 0;

			tree.setChildren(null, [
				{
					element: 0, children: [
						{ element: 10 },
						{ element: 11 },
						{ element: 12 },
					]
				},
				{ element: 1 },
				{ element: 2 }
			]);

			const navigator = tree.navigate();

			assert.equal(navigator.current(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.next(), 10);
			assert.equal(navigator.next(), 12);
			assert.equal(navigator.next(), 2);
			assert.equal(navigator.next(), null);
			assert.equal(navigator.previous(), 2);
			assert.equal(navigator.previous(), 12);
			assert.equal(navigator.previous(), 10);
			assert.equal(navigator.previous(), 0);
			assert.equal(navigator.previous(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.next(), 10);
			assert.equal(navigator.first(), 0);
			assert.equal(navigator.last(), 2);
		});

		test('should be able to start from node', () => {
			tree.setChildren(null, [
				{
					element: 0, children: [
						{ element: 10 },
						{ element: 11 },
						{ element: 12 },
					]
				},
				{ element: 1 },
				{ element: 2 }
			]);

			const navigator = tree.navigate(1);

			assert.equal(navigator.current(), 1);
			assert.equal(navigator.next(), 2);
			assert.equal(navigator.current(), 2);
			assert.equal(navigator.previous(), 1);
			assert.equal(navigator.current(), 1);
			assert.equal(navigator.previous(), 12);
			assert.equal(navigator.previous(), 11);
			assert.equal(navigator.previous(), 10);
			assert.equal(navigator.previous(), 0);
			assert.equal(navigator.previous(), null);
			assert.equal(navigator.next(), 0);
			assert.equal(navigator.next(), 10);
			assert.equal(navigator.first(), 0);
			assert.equal(navigator.last(), 2);
		});
	});

	test('traits are preserved according to string identity', function () {
		const container = document.createElement('div');
		container.style.width = '200px';
		container.style.height = '200px';

		const delegate = new class implements IListVirtualDelegate<number> {
			getHeight() { return 20; }
			getTemplateId(): string { return 'default'; }
		};

		const renderer = new class implements ITreeRenderer<number, void, HTMLElement> {
			readonly templateId = 'default';
			renderTemplate(container: HTMLElement): HTMLElement {
				return container;
			}
			renderElement(element: ITreeNode<number, void>, index: number, templateData: HTMLElement): void {
				templateData.textContent = `${element.element}`;
			}
			disposeTemplate(): void { }
		};

		const identityProvider = new class implements IIdentityProvider<number> {
			getId(element: number): { toString(): string; } {
				return `${element % 100}`;
			}
		};

		const tree = new ObjectTree<number>('test', container, delegate, [renderer], { identityProvider });
		tree.layout(200);

		tree.setChildren(null, [{ element: 0 }, { element: 1 }, { element: 2 }, { element: 3 }]);
		tree.setFocus([1]);
		assert.deepStrictEqual(tree.getFocus(), [1]);

		tree.setChildren(null, [{ element: 100 }, { element: 101 }, { element: 102 }, { element: 103 }]);
		assert.deepStrictEqual(tree.getFocus(), [101]);
	});
});

function toArray(list: NodeList): Node[] {
	const result: Node[] = [];
	list.forEach(node => result.push(node));
	return result;
}

suite('CompressibleObjectTree', function () {

	class Delegate implements IListVirtualDelegate<number> {
		getHeight() { return 20; }
		getTemplateId(): string { return 'default'; }
	}

	class Renderer implements ICompressibleTreeRenderer<number, void, HTMLElement> {
		readonly templateId = 'default';
		renderTemplate(container: HTMLElement): HTMLElement {
			return container;
		}
		renderElement(node: ITreeNode<number, void>, _: number, templateData: HTMLElement): void {
			templateData.textContent = `${node.element}`;
		}
		renderCompressedElements(node: ITreeNode<ICompressedTreeNode<number>, void>, _: number, templateData: HTMLElement): void {
			templateData.textContent = `${node.element.elements.join('/')}`;
		}
		disposeTemplate(): void { }
	}

	test('empty', function () {
		const container = document.createElement('div');
		container.style.width = '200px';
		container.style.height = '200px';

		const tree = new CompressibleObjectTree<number>('test', container, new Delegate(), [new Renderer()]);
		tree.layout(200);

		const rows = toArray(container.querySelectorAll('.monaco-tl-contents'));
		assert.equal(rows.length, 0);
	});

	test('simple', function () {
		const container = document.createElement('div');
		container.style.width = '200px';
		container.style.height = '200px';

		const tree = new CompressibleObjectTree<number>('test', container, new Delegate(), [new Renderer()]);
		tree.layout(200);

		tree.setChildren(null, [
			{
				element: 0, children: [
					{ element: 10 },
					{ element: 11 },
					{ element: 12 },
				]
			},
			{ element: 1 },
			{ element: 2 }
		]);

		const rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['0', '10', '11', '12', '1', '2']);
	});

	test('compressed', () => {
		const container = document.createElement('div');
		container.style.width = '200px';
		container.style.height = '200px';

		const tree = new CompressibleObjectTree<number>('test', container, new Delegate(), [new Renderer()]);
		tree.layout(200);

		tree.setChildren(null, [
			{
				element: 1, children: [{
					element: 11, children: [{
						element: 111, children: [
							{ element: 1111 },
							{ element: 1112 },
							{ element: 1113 },
						]
					}]
				}]
			}
		]);

		let rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11/111', '1111', '1112', '1113']);

		tree.setChildren(11, [
			{ element: 111 },
			{ element: 112 },
			{ element: 113 },
		]);

		rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11', '111', '112', '113']);

		tree.setChildren(113, [
			{ element: 1131 }
		]);

		rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11', '111', '112', '113/1131']);

		tree.setChildren(1131, [
			{ element: 1132 }
		]);

		rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11', '111', '112', '113/1131/1132']);

		tree.setChildren(1131, [
			{ element: 1132 },
			{ element: 1133 },
		]);

		rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11', '111', '112', '113/1131', '1132', '1133']);
	});

	test('enableCompression', () => {
		const container = document.createElement('div');
		container.style.width = '200px';
		container.style.height = '200px';

		const tree = new CompressibleObjectTree<number>('test', container, new Delegate(), [new Renderer()]);
		tree.layout(200);

		tree.setChildren(null, [
			{
				element: 1, children: [{
					element: 11, children: [{
						element: 111, children: [
							{ element: 1111 },
							{ element: 1112 },
							{ element: 1113 },
						]
					}]
				}]
			}
		]);

		let rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11/111', '1111', '1112', '1113']);

		tree.updateOptions({ compressionEnabled: false });
		rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1', '11', '111', '1111', '1112', '1113']);

		tree.updateOptions({ compressionEnabled: true });
		rows = toArray(container.querySelectorAll('.monaco-tl-contents')).map(row => row.textContent);
		assert.deepEqual(rows, ['1/11/111', '1111', '1112', '1113']);
	});
});
