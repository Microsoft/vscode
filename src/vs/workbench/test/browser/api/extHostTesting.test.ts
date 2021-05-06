/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from 'vs/base/common/cancellation';
import { URI } from 'vs/base/common/uri';
import { createDefaultDocumentTestRoot, TestItemFilteredWrapper } from 'vs/workbench/api/common/extHostTesting';
import * as convert from 'vs/workbench/api/common/extHostTypeConverters';
import { TestDiffOpType, TestItemExpandState } from 'vs/workbench/contrib/testing/common/testCollection';
import { stubTest, TestItemImpl, testStubs } from 'vs/workbench/contrib/testing/common/testStubs';
import { TestOwnedTestCollection, TestSingleUseCollection } from 'vs/workbench/contrib/testing/test/common/ownedTestCollection';
import { TestItem, TextDocument } from 'vscode';

const simplify = (item: TestItem<unknown>) => ({
	id: item.id,
	label: item.label,
	uri: item.uri,
	range: item.range,
	runnable: item.runnable,
	debuggable: item.debuggable,
});

const assertTreesEqual = (a: TestItem<unknown> | undefined, b: TestItem<unknown> | undefined) => {
	if (!a) {
		throw new assert.AssertionError({ message: 'Expected a to be defined', actual: a });
	}

	if (!b) {
		throw new assert.AssertionError({ message: 'Expected b to be defined', actual: b });
	}

	assert.deepStrictEqual(simplify(a), simplify(b));

	const aChildren = [...a.children.keys()].slice().sort();
	const bChildren = [...b.children.keys()].slice().sort();
	assert.strictEqual(aChildren.length, bChildren.length, `expected ${a.label}.children.length == ${b.label}.children.length`);
	aChildren.forEach(key => assertTreesEqual(a.children.get(key), b.children.get(key)));
};

// const assertTreeListEqual = (a: ReadonlyArray<TestItem>, b: ReadonlyArray<TestItem>) => {
// 	assert.strictEqual(a.length, b.length, `expected a.length == n.length`);
// 	a.forEach((_, i) => assertTreesEqual(a[i], b[i]));
// };

// class TestMirroredCollection extends MirroredTestCollection {
// 	public changeEvent!: TestChangeEvent;

// 	constructor() {
// 		super();
// 		this.onDidChangeTests(evt => this.changeEvent = evt);
// 	}

// 	public get length() {
// 		return this.items.size;
// 	}
// }

suite('ExtHost Testing', () => {
	let single: TestSingleUseCollection;
	let owned: TestOwnedTestCollection;
	setup(() => {
		owned = new TestOwnedTestCollection();
		single = owned.createForHierarchy(d => single.setDiff(d /* don't clear during testing */));
	});

	teardown(() => {
		single.dispose();
		assert.strictEqual(!owned.idToInternal?.size, true, 'expected owned ids to be empty after dispose');
	});

	suite('OwnedTestCollection', () => {
		test('adds a root recursively', () => {
			const tests = testStubs.nested();
			single.addRoot(tests, 'pid');
			single.expand('id-root', Infinity);
			assert.deepStrictEqual(single.collectDiff(), [
				[
					TestDiffOpType.Add,
					{ src: { tree: 0, controller: 'pid' }, parent: null, expand: TestItemExpandState.BusyExpanding, item: { ...convert.TestItem.from(stubTest('root')) } }
				],
				[
					TestDiffOpType.Add,
					{ src: { tree: 0, controller: 'pid' }, parent: 'id-root', expand: TestItemExpandState.Expandable, item: { ...convert.TestItem.from(stubTest('a')) } }
				],
				[
					TestDiffOpType.Add,
					{ src: { tree: 0, controller: 'pid' }, parent: 'id-root', expand: TestItemExpandState.NotExpandable, item: convert.TestItem.from(stubTest('b')) }
				],
				[
					TestDiffOpType.Update,
					{ extId: 'id-root', expand: TestItemExpandState.Expanded }
				],
				[
					TestDiffOpType.Update,
					{ extId: 'id-a', expand: TestItemExpandState.BusyExpanding }
				],
				[
					TestDiffOpType.Add,
					{ src: { tree: 0, controller: 'pid' }, parent: 'id-a', expand: TestItemExpandState.NotExpandable, item: convert.TestItem.from(stubTest('aa')) }
				],
				[
					TestDiffOpType.Add,
					{ src: { tree: 0, controller: 'pid' }, parent: 'id-a', expand: TestItemExpandState.NotExpandable, item: convert.TestItem.from(stubTest('ab')) }
				],
				[
					TestDiffOpType.Update,
					{ extId: 'id-a', expand: TestItemExpandState.Expanded }
				],
			]);
		});

		test('no-ops if items not changed', () => {
			const tests = testStubs.nested();
			single.addRoot(tests, 'pid');
			single.collectDiff();
			assert.deepStrictEqual(single.collectDiff(), []);
		});

		test('watches property mutations', () => {
			const tests = testStubs.nested();
			single.addRoot(tests, 'pid');
			single.expand('id-root', Infinity);
			single.collectDiff();
			tests.children.get('id-a')!.description = 'Hello world'; /* item a */

			assert.deepStrictEqual(single.collectDiff(), [
				[
					TestDiffOpType.Update,
					{ extId: 'id-a', item: { description: 'Hello world' } }],
			]);
		});

		test('removes children', () => {
			const tests = testStubs.nested();
			single.addRoot(tests, 'pid');
			single.expand('id-root', Infinity);
			single.collectDiff();
			tests.children.get('id-a')!.dispose();

			assert.deepStrictEqual(single.collectDiff(), [
				[TestDiffOpType.Remove, 'id-a'],
			]);
			assert.deepStrictEqual([...owned.idToInternal].map(n => n.item.extId).sort(), ['id-b', 'id-root']);
			assert.strictEqual(single.itemToInternal.size, 2);
		});

		test('adds new children', () => {
			const tests = testStubs.nested();
			single.addRoot(tests, 'pid');
			single.expand('id-root', Infinity);
			single.collectDiff();
			const child = stubTest('ac');
			tests.children.get('id-a')!.addChild(child);

			assert.deepStrictEqual(single.collectDiff(), [
				[TestDiffOpType.Add, {
					src: { tree: 0, controller: 'pid' },
					parent: 'id-a',
					expand: TestItemExpandState.NotExpandable,
					item: convert.TestItem.from(child),
				}],
			]);
			assert.deepStrictEqual(
				[...owned.idToInternal].map(n => n.item.extId).sort(),
				['id-a', 'id-aa', 'id-ab', 'id-ac', 'id-b', 'id-root'],
			);
			assert.strictEqual(single.itemToInternal.size, 6);
		});
	});


	suite('MirroredTestCollection', () => {
		// todo@connor4312: re-renable when we figure out what observing looks like we async children
		// 	let m: TestMirroredCollection;
		// 	setup(() => m = new TestMirroredCollection());

		// 	test('mirrors creation of the root', () => {
		// 		const tests = testStubs.nested();
		// 		single.addRoot(tests, 'pid');
		// 		single.expand('id-root', Infinity);
		// 		m.apply(single.collectDiff());
		// 		assertTreesEqual(m.rootTestItems[0], owned.getTestById('id-root')![1].actual);
		// 		assert.strictEqual(m.length, single.itemToInternal.size);
		// 	});

		// 	test('mirrors node deletion', () => {
		// 		const tests = testStubs.nested();
		// 		single.addRoot(tests, 'pid');
		// 		m.apply(single.collectDiff());
		// 		single.expand('id-root', Infinity);
		// 		tests.children!.splice(0, 1);
		// 		single.onItemChange(tests, 'pid');
		// 		single.expand('id-root', Infinity);
		// 		m.apply(single.collectDiff());

		// 		assertTreesEqual(m.rootTestItems[0], owned.getTestById('id-root')![1].actual);
		// 		assert.strictEqual(m.length, single.itemToInternal.size);
		// 	});

		// 	test('mirrors node addition', () => {
		// 		const tests = testStubs.nested();
		// 		single.addRoot(tests, 'pid');
		// 		m.apply(single.collectDiff());
		// 		tests.children![0].children!.push(stubTest('ac'));
		// 		single.onItemChange(tests, 'pid');
		// 		m.apply(single.collectDiff());

		// 		assertTreesEqual(m.rootTestItems[0], owned.getTestById('id-root')![1].actual);
		// 		assert.strictEqual(m.length, single.itemToInternal.size);
		// 	});

		// 	test('mirrors node update', () => {
		// 		const tests = testStubs.nested();
		// 		single.addRoot(tests, 'pid');
		// 		m.apply(single.collectDiff());
		// 		tests.children![0].description = 'Hello world'; /* item a */
		// 		single.onItemChange(tests, 'pid');
		// 		m.apply(single.collectDiff());

		// 		assertTreesEqual(m.rootTestItems[0], owned.getTestById('id-root')![1].actual);
		// 	});

		// 	suite('MirroredChangeCollector', () => {
		// 		let tests = testStubs.nested();
		// 		setup(() => {
		// 			tests = testStubs.nested();
		// 			single.addRoot(tests, 'pid');
		// 			m.apply(single.collectDiff());
		// 		});

		// 		test('creates change for root', () => {
		// 			assertTreeListEqual(m.changeEvent.added, [
		// 				tests,
		// 				tests.children[0],
		// 				tests.children![0].children![0],
		// 				tests.children![0].children![1],
		// 				tests.children[1],
		// 			]);
		// 			assertTreeListEqual(m.changeEvent.removed, []);
		// 			assertTreeListEqual(m.changeEvent.updated, []);
		// 		});

		// 		test('creates change for delete', () => {
		// 			const rm = tests.children.shift()!;
		// 			single.onItemChange(tests, 'pid');
		// 			m.apply(single.collectDiff());

		// 			assertTreeListEqual(m.changeEvent.added, []);
		// 			assertTreeListEqual(m.changeEvent.removed, [
		// 				{ ...rm },
		// 				{ ...rm.children![0] },
		// 				{ ...rm.children![1] },
		// 			]);
		// 			assertTreeListEqual(m.changeEvent.updated, []);
		// 		});

		// 		test('creates change for update', () => {
		// 			tests.children[0].label = 'updated!';
		// 			single.onItemChange(tests, 'pid');
		// 			m.apply(single.collectDiff());

		// 			assertTreeListEqual(m.changeEvent.added, []);
		// 			assertTreeListEqual(m.changeEvent.removed, []);
		// 			assertTreeListEqual(m.changeEvent.updated, [tests.children[0]]);
		// 		});

		// 		test('is a no-op if a node is added and removed', () => {
		// 			const nested = testStubs.nested('id2-');
		// 			tests.children.push(nested);
		// 			single.onItemChange(tests, 'pid');
		// 			tests.children.pop();
		// 			single.onItemChange(tests, 'pid');
		// 			const previousEvent = m.changeEvent;
		// 			m.apply(single.collectDiff());
		// 			assert.strictEqual(m.changeEvent, previousEvent);
		// 		});

		// 		test('is a single-op if a node is added and changed', () => {
		// 			const child = stubTest('c');
		// 			tests.children.push(child);
		// 			single.onItemChange(tests, 'pid');
		// 			child.label = 'd';
		// 			single.onItemChange(tests, 'pid');
		// 			m.apply(single.collectDiff());

		// 			assertTreeListEqual(m.changeEvent.added, [child]);
		// 			assertTreeListEqual(m.changeEvent.removed, []);
		// 			assertTreeListEqual(m.changeEvent.updated, []);
		// 		});

		// 		test('gets the common ancestor (1)', () => {
		// 			tests.children![0].children![0].label = 'za';
		// 			tests.children![0].children![1].label = 'zb';
		// 			single.onItemChange(tests, 'pid');
		// 			m.apply(single.collectDiff());

		// 		});

		// 		test('gets the common ancestor (2)', () => {
		// 			tests.children![0].children![0].label = 'za';
		// 			tests.children![1].label = 'ab';
		// 			single.onItemChange(tests, 'pid');
		// 			m.apply(single.collectDiff());
		// 		});
		// 	});

		suite('TestItemFilteredWrapper', () => {
			const textDocumentFilter = {
				uri: URI.parse('file:///foo.ts'),
			} as TextDocument;

			let testsWithLocation: TestItemImpl;
			setup(async () => {
				testsWithLocation =
					stubTest('root', undefined, [
						stubTest('a', undefined, [
							stubTest('aa', undefined, undefined, URI.parse('file:///foo.ts')),
							stubTest('ab', undefined, undefined, URI.parse('file:///foo.ts'))
						], URI.parse('file:///foo.ts')),
						stubTest('b', undefined, [
							stubTest('ba', undefined, undefined, URI.parse('file:///bar.ts')),
							stubTest('bb', undefined, undefined, URI.parse('file:///bar.ts'))
						], URI.parse('file:///bar.ts')),
						stubTest('c', undefined, undefined, URI.parse('file:///baz.ts')),
					]);

				// todo: this is not used, don't think it's needed anymore
				await createDefaultDocumentTestRoot<void>(
					{
						createWorkspaceTestRoot: () => testsWithLocation as TestItem<void>,
						runTests() {
							throw new Error('no implemented');
						}
					},
					textDocumentFilter,
					undefined,
					CancellationToken.None
				);
			});

			teardown(() => {
				TestItemFilteredWrapper.removeFilter(textDocumentFilter);
			});

			test('gets all actual properties', () => {
				const testItem = stubTest('test1');
				const wrapper = TestItemFilteredWrapper.getWrapperForTestItem(testItem, textDocumentFilter);

				assert.strictEqual(testItem.debuggable, wrapper.debuggable);
				assert.strictEqual(testItem.description, wrapper.description);
				assert.strictEqual(testItem.label, wrapper.label);
				assert.strictEqual(testItem.uri, wrapper.uri);
				assert.strictEqual(testItem.runnable, wrapper.runnable);
			});

			test('gets no children if nothing matches Uri filter', () => {
				const tests = testStubs.nested();
				const wrapper = TestItemFilteredWrapper.getWrapperForTestItem(tests, textDocumentFilter);
				wrapper.resolveHandler?.(CancellationToken.None);
				assert.strictEqual(wrapper.children.size, 0);
			});

			test('filter is applied to children', () => {
				const wrapper = TestItemFilteredWrapper.getWrapperForTestItem(testsWithLocation, textDocumentFilter);
				assert.strictEqual(wrapper.label, 'root');
				wrapper.resolveHandler?.(CancellationToken.None);

				const children = [...wrapper.children.values()];
				assert.strictEqual(children.length, 1);
				assert.strictEqual(children[0] instanceof TestItemFilteredWrapper, true);
				assert.strictEqual(children[0].label, 'a');
			});

			test('can get if node has matching filter', () => {
				const rootWrapper = TestItemFilteredWrapper.getWrapperForTestItem(testsWithLocation, textDocumentFilter);
				rootWrapper.resolveHandler?.(CancellationToken.None);

				const invisible = testsWithLocation.children.get('id-b')!;
				const invisibleWrapper = TestItemFilteredWrapper.getWrapperForTestItem(invisible, textDocumentFilter);
				const visible = testsWithLocation.children.get('id-a')!;
				const visibleWrapper = TestItemFilteredWrapper.getWrapperForTestItem(visible, textDocumentFilter);

				// The root is always visible
				assert.strictEqual(rootWrapper.hasNodeMatchingFilter, true);
				assert.strictEqual(invisibleWrapper.hasNodeMatchingFilter, false);
				assert.strictEqual(visibleWrapper.hasNodeMatchingFilter, true);
			});

			test('can reset cached value of hasNodeMatchingFilter', () => {
				const wrapper = TestItemFilteredWrapper.getWrapperForTestItem(testsWithLocation, textDocumentFilter);
				wrapper.resolveHandler?.(CancellationToken.None);

				const invisible = testsWithLocation.children.get('id-b')!;
				const invisibleWrapper = TestItemFilteredWrapper.getWrapperForTestItem(invisible, textDocumentFilter);

				assert.strictEqual(wrapper.children.get('id-b'), undefined);
				assert.strictEqual(invisibleWrapper.hasNodeMatchingFilter, false);

				invisible.addChild(stubTest('bc', undefined, undefined, URI.parse('file:///foo.ts')));
				assert.strictEqual(invisibleWrapper.hasNodeMatchingFilter, true);
				assert.strictEqual(invisibleWrapper.children.size, 1);
				assert.strictEqual(wrapper.children.get('id-b'), invisibleWrapper);
			});

			// test('can reset cached value of hasNodeMatchingFilter of parents up to visible parent', () => {
			// 	const rootWrapper = TestItemFilteredWrapper.getWrapperForTestItem(testsWithLocation, textDocumentFilter);

			// 	const invisibleParent = testsWithLocation.children.get('id-b')!;
			// 	const invisibleParentWrapper = TestItemFilteredWrapper.getWrapperForTestItem(invisibleParent, textDocumentFilter);
			// 	const invisible = invisibleParent.children.get('id-bb')!;
			// 	const invisibleWrapper = TestItemFilteredWrapper.getWrapperForTestItem(invisible, textDocumentFilter);

			// 	assert.strictEqual(invisibleParentWrapper.hasNodeMatchingFilter, false);
			// 	invisible.location = location1 as any;
			// 	assert.strictEqual(invisibleParentWrapper.hasNodeMatchingFilter, false);
			// 	invisibleWrapper.reset();
			// 	assert.strictEqual(invisibleParentWrapper.hasNodeMatchingFilter, true);

			// 	// the root should be undefined due to the reset.
			// 	assert.strictEqual((rootWrapper as any).matchesFilter, undefined);
			// });
		});
	});
});
