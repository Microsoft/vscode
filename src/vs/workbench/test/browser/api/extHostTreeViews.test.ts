/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { Emitter } from 'vs/base/common/event';
import { ExtHostTreeViews } from 'vs/workbench/api/common/extHostTreeViews';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { MainThreadTreeViewsShape, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { TreeDataProvider, TreeItem } from 'vscode';
import { TestRPCProtocol } from './testRPCProtocol';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { MainThreadCommands } from 'vs/workbench/api/browser/mainThreadCommands';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { mock } from 'vs/base/test/common/mock';
import { TreeItemCollapsibleState, ITreeItem } from 'vs/workbench/common/views';
import { NullLogService } from 'vs/platform/log/common/log';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import type { IDisposable } from 'vs/base/common/lifecycle';

suite('ExtHostTreeView', function () {

	class RecordingShape extends mock<MainThreadTreeViewsShape>() {

		onRefresh = new Emitter<{ [treeItemHandle: string]: ITreeItem }>();

		override async $registerTreeViewDataProvider(treeViewId: string): Promise<void> {
		}

		override $refresh(viewId: string, itemsToRefresh: { [treeItemHandle: string]: ITreeItem }): Promise<void> {
			return Promise.resolve(null).then(() => {
				this.onRefresh.fire(itemsToRefresh);
			});
		}

		override $reveal(): Promise<void> {
			return Promise.resolve();
		}

	}

	let testObject: ExtHostTreeViews;
	let target: RecordingShape;
	let onDidChangeTreeNode: Emitter<{ key: string } | undefined>;
	let onDidChangeTreeNodeWithId: Emitter<{ key: string }>;
	let tree: { [key: string]: any };
	let labels: { [key: string]: string };
	let nodes: { [key: string]: { key: string } };

	setup(() => {
		tree = {
			'a': {
				'aa': {},
				'ab': {}
			},
			'b': {
				'ba': {},
				'bb': {}
			}
		};

		labels = {};
		nodes = {};

		let rpcProtocol = new TestRPCProtocol();
		// Use IInstantiationService to get typechecking when instantiating
		let inst: IInstantiationService;
		{
			let instantiationService = new TestInstantiationService();
			inst = instantiationService;
		}

		rpcProtocol.set(MainContext.MainThreadCommands, inst.createInstance(MainThreadCommands, rpcProtocol));
		target = new RecordingShape();
		testObject = new ExtHostTreeViews(target, new ExtHostCommands(
			rpcProtocol,
			new NullLogService()
		), new NullLogService());
		onDidChangeTreeNode = new Emitter<{ key: string } | undefined>();
		onDidChangeTreeNodeWithId = new Emitter<{ key: string }>();
		testObject.createTreeView('testNodeTreeProvider', { treeDataProvider: aNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		testObject.createTreeView('testNodeWithIdTreeProvider', { treeDataProvider: aNodeWithIdTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		testObject.createTreeView('testNodeWithHighlightsTreeProvider', { treeDataProvider: aNodeWithHighlightedLabelTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);

		return loadCompleteTree('testNodeTreeProvider');
	});

	test('construct node tree', () => {
		return testObject.$getChildren('testNodeTreeProvider')
			.then(elements => {
				const actuals = elements.map(e => e.handle);
				assert.deepStrictEqual(actuals, ['0/0:a', '0/0:b']);
				return Promise.all([
					testObject.$getChildren('testNodeTreeProvider', '0/0:a')
						.then(children => {
							const actuals = children.map(e => e.handle);
							assert.deepStrictEqual(actuals, ['0/0:a/0:aa', '0/0:a/0:ab']);
							return Promise.all([
								testObject.$getChildren('testNodeTreeProvider', '0/0:a/0:aa').then(children => assert.strictEqual(children.length, 0)),
								testObject.$getChildren('testNodeTreeProvider', '0/0:a/0:ab').then(children => assert.strictEqual(children.length, 0))
							]);
						}),
					testObject.$getChildren('testNodeTreeProvider', '0/0:b')
						.then(children => {
							const actuals = children.map(e => e.handle);
							assert.deepStrictEqual(actuals, ['0/0:b/0:ba', '0/0:b/0:bb']);
							return Promise.all([
								testObject.$getChildren('testNodeTreeProvider', '0/0:b/0:ba').then(children => assert.strictEqual(children.length, 0)),
								testObject.$getChildren('testNodeTreeProvider', '0/0:b/0:bb').then(children => assert.strictEqual(children.length, 0))
							]);
						})
				]);
			});
	});

	test('construct id tree', () => {
		return testObject.$getChildren('testNodeWithIdTreeProvider')
			.then(elements => {
				const actuals = elements.map(e => e.handle);
				assert.deepStrictEqual(actuals, ['1/a', '1/b']);
				return Promise.all([
					testObject.$getChildren('testNodeWithIdTreeProvider', '1/a')
						.then(children => {
							const actuals = children.map(e => e.handle);
							assert.deepStrictEqual(actuals, ['1/aa', '1/ab']);
							return Promise.all([
								testObject.$getChildren('testNodeWithIdTreeProvider', '1/aa').then(children => assert.strictEqual(children.length, 0)),
								testObject.$getChildren('testNodeWithIdTreeProvider', '1/ab').then(children => assert.strictEqual(children.length, 0))
							]);
						}),
					testObject.$getChildren('testNodeWithIdTreeProvider', '1/b')
						.then(children => {
							const actuals = children.map(e => e.handle);
							assert.deepStrictEqual(actuals, ['1/ba', '1/bb']);
							return Promise.all([
								testObject.$getChildren('testNodeWithIdTreeProvider', '1/ba').then(children => assert.strictEqual(children.length, 0)),
								testObject.$getChildren('testNodeWithIdTreeProvider', '1/bb').then(children => assert.strictEqual(children.length, 0))
							]);
						})
				]);
			});
	});

	test('construct highlights tree', () => {
		return testObject.$getChildren('testNodeWithHighlightsTreeProvider')
			.then(elements => {
				assert.deepStrictEqual(removeUnsetKeys(elements), [{
					handle: '1/a',
					label: { label: 'a', highlights: [[0, 2], [3, 5]] },
					collapsibleState: TreeItemCollapsibleState.Collapsed
				}, {
					handle: '1/b',
					label: { label: 'b', highlights: [[0, 2], [3, 5]] },
					collapsibleState: TreeItemCollapsibleState.Collapsed
				}]);
				return Promise.all([
					testObject.$getChildren('testNodeWithHighlightsTreeProvider', '1/a')
						.then(children => {
							assert.deepStrictEqual(removeUnsetKeys(children), [{
								handle: '1/aa',
								parentHandle: '1/a',
								label: { label: 'aa', highlights: [[0, 2], [3, 5]] },
								collapsibleState: TreeItemCollapsibleState.None
							}, {
								handle: '1/ab',
								parentHandle: '1/a',
								label: { label: 'ab', highlights: [[0, 2], [3, 5]] },
								collapsibleState: TreeItemCollapsibleState.None
							}]);
						}),
					testObject.$getChildren('testNodeWithHighlightsTreeProvider', '1/b')
						.then(children => {
							assert.deepStrictEqual(removeUnsetKeys(children), [{
								handle: '1/ba',
								parentHandle: '1/b',
								label: { label: 'ba', highlights: [[0, 2], [3, 5]] },
								collapsibleState: TreeItemCollapsibleState.None
							}, {
								handle: '1/bb',
								parentHandle: '1/b',
								label: { label: 'bb', highlights: [[0, 2], [3, 5]] },
								collapsibleState: TreeItemCollapsibleState.None
							}]);
						})
				]);
			});
	});

	test('error is thrown if id is not unique', (done) => {
		tree['a'] = {
			'aa': {},
		};
		tree['b'] = {
			'aa': {},
			'ba': {}
		};
		let caughtExpectedError = false;
		target.onRefresh.event(() => {
			testObject.$getChildren('testNodeWithIdTreeProvider')
				.then(elements => {
					const actuals = elements.map(e => e.handle);
					assert.deepStrictEqual(actuals, ['1/a', '1/b']);
					return testObject.$getChildren('testNodeWithIdTreeProvider', '1/a')
						.then(() => testObject.$getChildren('testNodeWithIdTreeProvider', '1/b'))
						.then(() => assert.fail('Should fail with duplicate id'))
						.catch(() => caughtExpectedError = true)
						.finally(() => caughtExpectedError ? done() : assert.fail('Expected duplicate id error not thrown.'));
				});
		});
		onDidChangeTreeNode.fire(undefined);
	});

	test('refresh root', function (done) {
		target.onRefresh.event(actuals => {
			assert.strictEqual(undefined, actuals);
			done();
		});
		onDidChangeTreeNode.fire(undefined);
	});

	test('refresh a parent node', () => {
		return new Promise((c, e) => {
			target.onRefresh.event(actuals => {
				assert.deepStrictEqual(['0/0:b'], Object.keys(actuals));
				assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:b']), {
					handle: '0/0:b',
					label: { label: 'b' },
					collapsibleState: TreeItemCollapsibleState.Collapsed
				});
				c(undefined);
			});
			onDidChangeTreeNode.fire(getNode('b'));
		});
	});

	test('refresh a leaf node', function (done) {
		target.onRefresh.event(actuals => {
			assert.deepStrictEqual(['0/0:b/0:bb'], Object.keys(actuals));
			assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:b/0:bb']), {
				handle: '0/0:b/0:bb',
				parentHandle: '0/0:b',
				label: { label: 'bb' },
				collapsibleState: TreeItemCollapsibleState.None
			});
			done();
		});
		onDidChangeTreeNode.fire(getNode('bb'));
	});

	async function runWithEventMerging(action: (resolve: () => void) => void) {
		await new Promise<void>((resolve) => {
			let subscription: IDisposable | undefined = undefined;
			subscription = target.onRefresh.event(() => {
				subscription!.dispose();
				resolve();
			});
			onDidChangeTreeNode.fire(getNode('b'));
		});
		await new Promise<void>(action);
	}

	test('refresh parent and child node trigger refresh only on parent - scenario 1', async () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.deepStrictEqual(['0/0:b', '0/0:a/0:aa'], Object.keys(actuals));
				assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:b']), {
					handle: '0/0:b',
					label: { label: 'b' },
					collapsibleState: TreeItemCollapsibleState.Collapsed
				});
				assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:a/0:aa']), {
					handle: '0/0:a/0:aa',
					parentHandle: '0/0:a',
					label: { label: 'aa' },
					collapsibleState: TreeItemCollapsibleState.None
				});
				resolve();
			});
			onDidChangeTreeNode.fire(getNode('b'));
			onDidChangeTreeNode.fire(getNode('aa'));
			onDidChangeTreeNode.fire(getNode('bb'));
		});
	});

	test('refresh parent and child node trigger refresh only on parent - scenario 2', async () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.deepStrictEqual(['0/0:a/0:aa', '0/0:b'], Object.keys(actuals));
				assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:b']), {
					handle: '0/0:b',
					label: { label: 'b' },
					collapsibleState: TreeItemCollapsibleState.Collapsed
				});
				assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:a/0:aa']), {
					handle: '0/0:a/0:aa',
					parentHandle: '0/0:a',
					label: { label: 'aa' },
					collapsibleState: TreeItemCollapsibleState.None
				});
				resolve();
			});
			onDidChangeTreeNode.fire(getNode('bb'));
			onDidChangeTreeNode.fire(getNode('aa'));
			onDidChangeTreeNode.fire(getNode('b'));
		});
	});

	test('refresh an element for label change', function (done) {
		labels['a'] = 'aa';
		target.onRefresh.event(actuals => {
			assert.deepStrictEqual(['0/0:a'], Object.keys(actuals));
			assert.deepStrictEqual(removeUnsetKeys(actuals['0/0:a']), {
				handle: '0/0:aa',
				label: { label: 'aa' },
				collapsibleState: TreeItemCollapsibleState.Collapsed
			});
			done();
		});
		onDidChangeTreeNode.fire(getNode('a'));
	});

	test('refresh calls are throttled on roots', () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.strictEqual(undefined, actuals);
				resolve();
			});
			onDidChangeTreeNode.fire(undefined);
			onDidChangeTreeNode.fire(undefined);
			onDidChangeTreeNode.fire(undefined);
			onDidChangeTreeNode.fire(undefined);
		});
	});

	test('refresh calls are throttled on elements', () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.deepStrictEqual(['0/0:a', '0/0:b'], Object.keys(actuals));
				resolve();
			});

			onDidChangeTreeNode.fire(getNode('a'));
			onDidChangeTreeNode.fire(getNode('b'));
			onDidChangeTreeNode.fire(getNode('b'));
			onDidChangeTreeNode.fire(getNode('a'));
		});
	});

	test('refresh calls are throttled on unknown elements', () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.deepStrictEqual(['0/0:a', '0/0:b'], Object.keys(actuals));
				resolve();
			});

			onDidChangeTreeNode.fire(getNode('a'));
			onDidChangeTreeNode.fire(getNode('b'));
			onDidChangeTreeNode.fire(getNode('g'));
			onDidChangeTreeNode.fire(getNode('a'));
		});
	});

	test('refresh calls are throttled on unknown elements and root', () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.strictEqual(undefined, actuals);
				resolve();
			});

			onDidChangeTreeNode.fire(getNode('a'));
			onDidChangeTreeNode.fire(getNode('b'));
			onDidChangeTreeNode.fire(getNode('g'));
			onDidChangeTreeNode.fire(undefined);
		});
	});

	test('refresh calls are throttled on elements and root', () => {
		return runWithEventMerging((resolve) => {
			target.onRefresh.event(actuals => {
				assert.strictEqual(undefined, actuals);
				resolve();
			});

			onDidChangeTreeNode.fire(getNode('a'));
			onDidChangeTreeNode.fire(getNode('b'));
			onDidChangeTreeNode.fire(undefined);
			onDidChangeTreeNode.fire(getNode('a'));
		});
	});

	test('generate unique handles from labels by escaping them', (done) => {
		tree = {
			'a/0:b': {}
		};

		target.onRefresh.event(() => {
			testObject.$getChildren('testNodeTreeProvider')
				.then(elements => {
					assert.deepStrictEqual(elements.map(e => e.handle), ['0/0:a//0:b']);
					done();
				});
		});
		onDidChangeTreeNode.fire(undefined);
	});

	test('tree with duplicate labels', (done) => {

		const dupItems = {
			'adup1': 'c',
			'adup2': 'g',
			'bdup1': 'e',
			'hdup1': 'i',
			'hdup2': 'l',
			'jdup1': 'k'
		};

		labels['c'] = 'a';
		labels['e'] = 'b';
		labels['g'] = 'a';
		labels['i'] = 'h';
		labels['l'] = 'h';
		labels['k'] = 'j';

		tree[dupItems['adup1']] = {};
		tree['d'] = {};

		const bdup1Tree: { [key: string]: any } = {};
		bdup1Tree['h'] = {};
		bdup1Tree[dupItems['hdup1']] = {};
		bdup1Tree['j'] = {};
		bdup1Tree[dupItems['jdup1']] = {};
		bdup1Tree[dupItems['hdup2']] = {};

		tree[dupItems['bdup1']] = bdup1Tree;
		tree['f'] = {};
		tree[dupItems['adup2']] = {};

		target.onRefresh.event(() => {
			testObject.$getChildren('testNodeTreeProvider')
				.then(elements => {
					const actuals = elements.map(e => e.handle);
					assert.deepStrictEqual(actuals, ['0/0:a', '0/0:b', '0/1:a', '0/0:d', '0/1:b', '0/0:f', '0/2:a']);
					return testObject.$getChildren('testNodeTreeProvider', '0/1:b')
						.then(elements => {
							const actuals = elements.map(e => e.handle);
							assert.deepStrictEqual(actuals, ['0/1:b/0:h', '0/1:b/1:h', '0/1:b/0:j', '0/1:b/1:j', '0/1:b/2:h']);
							done();
						});
				});
		});

		onDidChangeTreeNode.fire(undefined);
	});

	test('getChildren is not returned from cache if refreshed', (done) => {
		tree = {
			'c': {}
		};

		target.onRefresh.event(() => {
			testObject.$getChildren('testNodeTreeProvider')
				.then(elements => {
					assert.deepStrictEqual(elements.map(e => e.handle), ['0/0:c']);
					done();
				});
		});

		onDidChangeTreeNode.fire(undefined);
	});

	test('getChildren is returned from cache if not refreshed', () => {
		tree = {
			'c': {}
		};

		return testObject.$getChildren('testNodeTreeProvider')
			.then(elements => {
				assert.deepStrictEqual(elements.map(e => e.handle), ['0/0:a', '0/0:b']);
			});
	});

	test('reveal will throw an error if getParent is not implemented', () => {
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		return treeView.reveal({ key: 'a' })
			.then(() => assert.fail('Reveal should throw an error as getParent is not implemented'), () => null);
	});

	test('reveal will return empty array for root element', () => {
		const revealTarget = sinon.spy(target, '$reveal');
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aCompleteNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		const expected = {
			item:
				{ handle: '0/0:a', label: { label: 'a' }, collapsibleState: TreeItemCollapsibleState.Collapsed },
			parentChain: []
		};
		return treeView.reveal({ key: 'a' })
			.then(() => {
				assert.ok(revealTarget.calledOnce);
				assert.deepStrictEqual('treeDataProvider', revealTarget.args[0][0]);
				assert.deepStrictEqual(expected, removeUnsetKeys(revealTarget.args[0][1]));
				assert.deepStrictEqual({ select: true, focus: false, expand: false }, revealTarget.args[0][2]);
			});
	});

	test('reveal will return parents array for an element when hierarchy is not loaded', () => {
		const revealTarget = sinon.spy(target, '$reveal');
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aCompleteNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		const expected = {
			item: { handle: '0/0:a/0:aa', label: { label: 'aa' }, collapsibleState: TreeItemCollapsibleState.None, parentHandle: '0/0:a' },
			parentChain: [{ handle: '0/0:a', label: { label: 'a' }, collapsibleState: TreeItemCollapsibleState.Collapsed }]
		};
		return treeView.reveal({ key: 'aa' })
			.then(() => {
				assert.ok(revealTarget.calledOnce);
				assert.deepStrictEqual('treeDataProvider', revealTarget.args[0][0]);
				assert.deepStrictEqual(expected.item, removeUnsetKeys(revealTarget.args[0][1].item));
				assert.deepStrictEqual(expected.parentChain, (<Array<any>>(revealTarget.args[0][1].parentChain)).map(arg => removeUnsetKeys(arg)));
				assert.deepStrictEqual({ select: true, focus: false, expand: false }, revealTarget.args[0][2]);
			});
	});

	test('reveal will return parents array for an element when hierarchy is loaded', () => {
		const revealTarget = sinon.spy(target, '$reveal');
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aCompleteNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		const expected = {
			item: { handle: '0/0:a/0:aa', label: { label: 'aa' }, collapsibleState: TreeItemCollapsibleState.None, parentHandle: '0/0:a' },
			parentChain: [{ handle: '0/0:a', label: { label: 'a' }, collapsibleState: TreeItemCollapsibleState.Collapsed }]
		};
		return testObject.$getChildren('treeDataProvider')
			.then(() => testObject.$getChildren('treeDataProvider', '0/0:a'))
			.then(() => treeView.reveal({ key: 'aa' })
				.then(() => {
					assert.ok(revealTarget.calledOnce);
					assert.deepStrictEqual('treeDataProvider', revealTarget.args[0][0]);
					assert.deepStrictEqual(expected.item, removeUnsetKeys(revealTarget.args[0][1].item));
					assert.deepStrictEqual(expected.parentChain, (<Array<any>>(revealTarget.args[0][1].parentChain)).map(arg => removeUnsetKeys(arg)));
					assert.deepStrictEqual({ select: true, focus: false, expand: false }, revealTarget.args[0][2]);
				}));
	});

	test('reveal will return parents array for deeper element with no selection', () => {
		tree = {
			'b': {
				'ba': {
					'bac': {}
				}
			}
		};
		const revealTarget = sinon.spy(target, '$reveal');
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aCompleteNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		const expected = {
			item: { handle: '0/0:b/0:ba/0:bac', label: { label: 'bac' }, collapsibleState: TreeItemCollapsibleState.None, parentHandle: '0/0:b/0:ba' },
			parentChain: [
				{ handle: '0/0:b', label: { label: 'b' }, collapsibleState: TreeItemCollapsibleState.Collapsed },
				{ handle: '0/0:b/0:ba', label: { label: 'ba' }, collapsibleState: TreeItemCollapsibleState.Collapsed, parentHandle: '0/0:b' }
			]
		};
		return treeView.reveal({ key: 'bac' }, { select: false, focus: false, expand: false })
			.then(() => {
				assert.ok(revealTarget.calledOnce);
				assert.deepStrictEqual('treeDataProvider', revealTarget.args[0][0]);
				assert.deepStrictEqual(expected.item, removeUnsetKeys(revealTarget.args[0][1].item));
				assert.deepStrictEqual(expected.parentChain, (<Array<any>>(revealTarget.args[0][1].parentChain)).map(arg => removeUnsetKeys(arg)));
				assert.deepStrictEqual({ select: false, focus: false, expand: false }, revealTarget.args[0][2]);
			});
	});

	test('reveal after first udpate', () => {
		const revealTarget = sinon.spy(target, '$reveal');
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aCompleteNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		const expected = {
			item: { handle: '0/0:a/0:ac', label: { label: 'ac' }, collapsibleState: TreeItemCollapsibleState.None, parentHandle: '0/0:a' },
			parentChain: [{ handle: '0/0:a', label: { label: 'a' }, collapsibleState: TreeItemCollapsibleState.Collapsed }]
		};
		return loadCompleteTree('treeDataProvider')
			.then(() => {
				tree = {
					'a': {
						'aa': {},
						'ac': {}
					},
					'b': {
						'ba': {},
						'bb': {}
					}
				};
				onDidChangeTreeNode.fire(getNode('a'));

				return treeView.reveal({ key: 'ac' })
					.then(() => {
						assert.ok(revealTarget.calledOnce);
						assert.deepStrictEqual('treeDataProvider', revealTarget.args[0][0]);
						assert.deepStrictEqual(expected.item, removeUnsetKeys(revealTarget.args[0][1].item));
						assert.deepStrictEqual(expected.parentChain, (<Array<any>>(revealTarget.args[0][1].parentChain)).map(arg => removeUnsetKeys(arg)));
						assert.deepStrictEqual({ select: true, focus: false, expand: false }, revealTarget.args[0][2]);
					});
			});
	});

	test('reveal after second udpate', () => {
		const revealTarget = sinon.spy(target, '$reveal');
		const treeView = testObject.createTreeView('treeDataProvider', { treeDataProvider: aCompleteNodeTreeDataProvider() }, { enableProposedApi: true } as IExtensionDescription);
		return loadCompleteTree('treeDataProvider')
			.then(() => {
				return runWithEventMerging((resolve) => {
					tree = {
						'a': {
							'aa': {},
							'ac': {}
						},
						'b': {
							'ba': {},
							'bb': {}
						}
					};
					onDidChangeTreeNode.fire(getNode('a'));
					tree = {
						'a': {
							'aa': {},
							'ac': {}
						},
						'b': {
							'ba': {},
							'bc': {}
						}
					};
					onDidChangeTreeNode.fire(getNode('b'));
					resolve();
				}).then(() => {
					return treeView.reveal({ key: 'bc' })
						.then(() => {
							assert.ok(revealTarget.calledOnce);
							assert.deepStrictEqual('treeDataProvider', revealTarget.args[0][0]);
							assert.deepStrictEqual({ handle: '0/0:b/0:bc', label: { label: 'bc' }, collapsibleState: TreeItemCollapsibleState.None, parentHandle: '0/0:b' }, removeUnsetKeys(revealTarget.args[0][1].item));
							assert.deepStrictEqual([{ handle: '0/0:b', label: { label: 'b' }, collapsibleState: TreeItemCollapsibleState.Collapsed }], (<Array<any>>revealTarget.args[0][1].parentChain).map(arg => removeUnsetKeys(arg)));
							assert.deepStrictEqual({ select: true, focus: false, expand: false }, revealTarget.args[0][2]);
						});
				});
			});
	});

	function loadCompleteTree(treeId: string, element?: string): Promise<null> {
		return testObject.$getChildren(treeId, element)
			.then(elements => elements.map(e => loadCompleteTree(treeId, e.handle)))
			.then(() => null);
	}

	function removeUnsetKeys(obj: any): any {
		if (Array.isArray(obj)) {
			return obj.map(o => removeUnsetKeys(o));
		}

		if (typeof obj === 'object') {
			const result: { [key: string]: any } = {};
			for (const key of Object.keys(obj)) {
				if (obj[key] !== undefined) {
					result[key] = removeUnsetKeys(obj[key]);
				}
			}
			return result;
		}
		return obj;
	}

	function aNodeTreeDataProvider(): TreeDataProvider<{ key: string }> {
		return {
			getChildren: (element: { key: string }): { key: string }[] => {
				return getChildren(element ? element.key : undefined).map(key => getNode(key));
			},
			getTreeItem: (element: { key: string }): TreeItem => {
				return getTreeItem(element.key);
			},
			onDidChangeTreeData: onDidChangeTreeNode.event
		};
	}

	function aCompleteNodeTreeDataProvider(): TreeDataProvider<{ key: string }> {
		return {
			getChildren: (element: { key: string }): { key: string }[] => {
				return getChildren(element ? element.key : undefined).map(key => getNode(key));
			},
			getTreeItem: (element: { key: string }): TreeItem => {
				return getTreeItem(element.key);
			},
			getParent: ({ key }: { key: string }): { key: string } | undefined => {
				const parentKey = key.substring(0, key.length - 1);
				return parentKey ? new Key(parentKey) : undefined;
			},
			onDidChangeTreeData: onDidChangeTreeNode.event
		};
	}

	function aNodeWithIdTreeDataProvider(): TreeDataProvider<{ key: string }> {
		return {
			getChildren: (element: { key: string }): { key: string }[] => {
				return getChildren(element ? element.key : undefined).map(key => getNode(key));
			},
			getTreeItem: (element: { key: string }): TreeItem => {
				const treeItem = getTreeItem(element.key);
				treeItem.id = element.key;
				return treeItem;
			},
			onDidChangeTreeData: onDidChangeTreeNodeWithId.event
		};
	}

	function aNodeWithHighlightedLabelTreeDataProvider(): TreeDataProvider<{ key: string }> {
		return {
			getChildren: (element: { key: string }): { key: string }[] => {
				return getChildren(element ? element.key : undefined).map(key => getNode(key));
			},
			getTreeItem: (element: { key: string }): TreeItem => {
				const treeItem = getTreeItem(element.key, [[0, 2], [3, 5]]);
				treeItem.id = element.key;
				return treeItem;
			},
			onDidChangeTreeData: onDidChangeTreeNodeWithId.event
		};
	}

	function getTreeElement(element: string): any {
		let parent = tree;
		for (let i = 0; i < element.length; i++) {
			parent = parent[element.substring(0, i + 1)];
			if (!parent) {
				return null;
			}
		}
		return parent;
	}

	function getChildren(key: string | undefined): string[] {
		if (!key) {
			return Object.keys(tree);
		}
		let treeElement = getTreeElement(key);
		if (treeElement) {
			return Object.keys(treeElement);
		}
		return [];
	}

	function getTreeItem(key: string, highlights?: [number, number][]): TreeItem {
		const treeElement = getTreeElement(key);
		return {
			label: <any>{ label: labels[key] || key, highlights },
			collapsibleState: treeElement && Object.keys(treeElement).length ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None
		};
	}

	function getNode(key: string): { key: string } {
		if (!nodes[key]) {
			nodes[key] = new Key(key);
		}
		return nodes[key];
	}

	class Key {
		constructor(readonly key: string) { }
	}

});
