/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { compress, ICompressedTreeElement, ICompressedTreeNode, decompress, CompressedObjectTreeModel } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import { Iterable } from 'vs/base/common/iterator';
import { ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { IList } from 'vs/base/browser/ui/tree/indexTreeModel';
import { IObjectTreeModelSetChildrenOptions } from 'vs/base/browser/ui/tree/objectTreeModel';

interface IResolvedCompressedTreeElement<T> extends ICompressedTreeElement<T> {
	readonly element: T;
	readonly children?: ICompressedTreeElement<T>[];
}

function resolve<T>(treeElement: ICompressedTreeElement<T>): IResolvedCompressedTreeElement<T> {
	const result: any = { element: treeElement.element };
	const children = [...Iterable.map(Iterable.from(treeElement.children), resolve)];

	if (treeElement.incompressible) {
		result.incompressible = true;
	}

	if (children.length > 0) {
		result.children = children;
	}

	return result;
}

suite('CompressedObjectTree', function () {

	suite('compress & decompress', function () {

		test('small', function () {
			const decompressed: ICompressedTreeElement<number> = { element: 1 };
			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> =
				{ element: { elements: [1], incompressible: false } };

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('no compression', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{ element: 11 },
					{ element: 12 },
					{ element: 13 }
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1], incompressible: false },
				children: [
					{ element: { elements: [11], incompressible: false } },
					{ element: { elements: [12], incompressible: false } },
					{ element: { elements: [13], incompressible: false } }
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('single hierarchy', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, children: [
							{
								element: 111, children: [
									{ element: 1111 }
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1, 11, 111, 1111], incompressible: false }
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('deep compression', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, children: [
							{
								element: 111, children: [
									{ element: 1111 },
									{ element: 1112 },
									{ element: 1113 },
									{ element: 1114 },
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1, 11, 111], incompressible: false },
				children: [
					{ element: { elements: [1111], incompressible: false } },
					{ element: { elements: [1112], incompressible: false } },
					{ element: { elements: [1113], incompressible: false } },
					{ element: { elements: [1114], incompressible: false } },
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('double deep compression', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, children: [
							{
								element: 111, children: [
									{ element: 1112 },
									{ element: 1113 },
								]
							}
						]
					},
					{
						element: 12, children: [
							{
								element: 121, children: [
									{ element: 1212 },
									{ element: 1213 },
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1], incompressible: false },
				children: [
					{
						element: { elements: [11, 111], incompressible: false },
						children: [
							{ element: { elements: [1112], incompressible: false } },
							{ element: { elements: [1113], incompressible: false } },
						]
					},
					{
						element: { elements: [12, 121], incompressible: false },
						children: [
							{ element: { elements: [1212], incompressible: false } },
							{ element: { elements: [1213], incompressible: false } },
						]
					}
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('incompressible leaf', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, children: [
							{
								element: 111, children: [
									{ element: 1111, incompressible: true }
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1, 11, 111], incompressible: false },
				children: [
					{ element: { elements: [1111], incompressible: true } }
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('incompressible branch', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, children: [
							{
								element: 111, incompressible: true, children: [
									{ element: 1111 }
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1, 11], incompressible: false },
				children: [
					{ element: { elements: [111, 1111], incompressible: true } }
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('incompressible chain', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, children: [
							{
								element: 111, incompressible: true, children: [
									{ element: 1111, incompressible: true }
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1, 11], incompressible: false },
				children: [
					{
						element: { elements: [111], incompressible: true },
						children: [
							{ element: { elements: [1111], incompressible: true } }
						]
					}
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});

		test('incompressible tree', function () {
			const decompressed: ICompressedTreeElement<number> = {
				element: 1, children: [
					{
						element: 11, incompressible: true, children: [
							{
								element: 111, incompressible: true, children: [
									{ element: 1111, incompressible: true }
								]
							}
						]
					}
				]
			};

			const compressed: IResolvedCompressedTreeElement<ICompressedTreeNode<number>> = {
				element: { elements: [1], incompressible: false },
				children: [
					{
						element: { elements: [11], incompressible: true },
						children: [
							{
								element: { elements: [111], incompressible: true },
								children: [
									{ element: { elements: [1111], incompressible: true } }
								]
							}
						]
					}
				]
			};

			assert.deepStrictEqual(resolve(compress(decompressed)), compressed);
			assert.deepStrictEqual(resolve(decompress(compressed)), decompressed);
		});
	});

	function toList<T>(arr: T[]): IList<T> {
		return {
			splice(start: number, deleteCount: number, elements: T[]): void {
				arr.splice(start, deleteCount, ...elements);
			},
			updateElementHeight() { }
		};
	}

	function toArray<T>(list: ITreeNode<ICompressedTreeNode<T>>[]): T[][] {
		return list.map(i => i.element.elements);
	}

	suite('CompressedObjectTreeModel', function () {

		/**
		 * Calls that test function twice, once with an empty options and
		 * once with `diffIdentityProvider`.
		 */
		function withSmartSplice(fn: (options: IObjectTreeModelSetChildrenOptions<number, any>) => void) {
			fn({});
			fn({ diffIdentityProvider: { getId: n => String(n) } });
		}


		test('ctor', () => {
			const list: ITreeNode<ICompressedTreeNode<number>>[] = [];
			const model = new CompressedObjectTreeModel<number>('test', toList(list));
			assert(model);
			assert.strictEqual(list.length, 0);
			assert.strictEqual(model.size, 0);
		});

		test('flat', () => withSmartSplice(options => {
			const list: ITreeNode<ICompressedTreeNode<number>>[] = [];
			const model = new CompressedObjectTreeModel<number>('test', toList(list));

			model.setChildren(null, [
				{ element: 0 },
				{ element: 1 },
				{ element: 2 }
			], options);

			assert.deepStrictEqual(toArray(list), [[0], [1], [2]]);
			assert.strictEqual(model.size, 3);

			model.setChildren(null, [
				{ element: 3 },
				{ element: 4 },
				{ element: 5 },
			], options);

			assert.deepStrictEqual(toArray(list), [[3], [4], [5]]);
			assert.strictEqual(model.size, 3);

			model.setChildren(null, [], options);
			assert.deepStrictEqual(toArray(list), []);
			assert.strictEqual(model.size, 0);
		}));

		test('nested', () => withSmartSplice(options => {
			const list: ITreeNode<ICompressedTreeNode<number>>[] = [];
			const model = new CompressedObjectTreeModel<number>('test', toList(list));

			model.setChildren(null, [
				{
					element: 0, children: [
						{ element: 10 },
						{ element: 11 },
						{ element: 12 },
					]
				},
				{ element: 1 },
				{ element: 2 }
			], options);

			assert.deepStrictEqual(toArray(list), [[0], [10], [11], [12], [1], [2]]);
			assert.strictEqual(model.size, 6);

			model.setChildren(12, [
				{ element: 120 },
				{ element: 121 }
			], options);

			assert.deepStrictEqual(toArray(list), [[0], [10], [11], [12], [120], [121], [1], [2]]);
			assert.strictEqual(model.size, 8);

			model.setChildren(0, [], options);
			assert.deepStrictEqual(toArray(list), [[0], [1], [2]]);
			assert.strictEqual(model.size, 3);

			model.setChildren(null, [], options);
			assert.deepStrictEqual(toArray(list), []);
			assert.strictEqual(model.size, 0);
		}));

		test('compressed', () => withSmartSplice(options => {
			const list: ITreeNode<ICompressedTreeNode<number>>[] = [];
			const model = new CompressedObjectTreeModel<number>('test', toList(list));

			model.setChildren(null, [
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
			], options);

			assert.deepStrictEqual(toArray(list), [[1, 11, 111], [1111], [1112], [1113]]);
			assert.strictEqual(model.size, 6);

			model.setChildren(11, [
				{ element: 111 },
				{ element: 112 },
				{ element: 113 },
			], options);

			assert.deepStrictEqual(toArray(list), [[1, 11], [111], [112], [113]]);
			assert.strictEqual(model.size, 5);

			model.setChildren(113, [
				{ element: 1131 }
			], options);

			assert.deepStrictEqual(toArray(list), [[1, 11], [111], [112], [113, 1131]]);
			assert.strictEqual(model.size, 6);

			model.setChildren(1131, [
				{ element: 1132 }
			], options);

			assert.deepStrictEqual(toArray(list), [[1, 11], [111], [112], [113, 1131, 1132]]);
			assert.strictEqual(model.size, 7);

			model.setChildren(1131, [
				{ element: 1132 },
				{ element: 1133 },
			], options);

			assert.deepStrictEqual(toArray(list), [[1, 11], [111], [112], [113, 1131], [1132], [1133]]);
			assert.strictEqual(model.size, 8);
		}));
	});
});
