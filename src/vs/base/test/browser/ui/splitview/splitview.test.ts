/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from 'vs/base/common/event';
import { SplitView, IView, Sizing, LayoutPriority } from 'vs/base/browser/ui/splitview/splitview';
import { Sash, SashState } from 'vs/base/browser/ui/sash/sash';

class TestView implements IView<number> {

	private readonly _onDidChange = new Emitter<number | undefined>();
	readonly onDidChange = this._onDidChange.event;

	get minimumSize(): number { return this._minimumSize; }
	set minimumSize(size: number) { this._minimumSize = size; this._onDidChange.fire(undefined); }

	get maximumSize(): number { return this._maximumSize; }
	set maximumSize(size: number) { this._maximumSize = size; this._onDidChange.fire(undefined); }

	private _element: HTMLElement = document.createElement('div');
	get element(): HTMLElement { this._onDidGetElement.fire(); return this._element; }

	private readonly _onDidGetElement = new Emitter<void>();
	readonly onDidGetElement = this._onDidGetElement.event;

	private _size = 0;
	get size(): number { return this._size; }
	private _orthogonalSize: number | undefined = 0;
	get orthogonalSize(): number | undefined { return this._orthogonalSize; }
	private readonly _onDidLayout = new Emitter<{ size: number; orthogonalSize: number | undefined }>();
	readonly onDidLayout = this._onDidLayout.event;

	private readonly _onDidFocus = new Emitter<void>();
	readonly onDidFocus = this._onDidFocus.event;

	constructor(
		private _minimumSize: number,
		private _maximumSize: number,
		readonly priority: LayoutPriority = LayoutPriority.Normal
	) {
		assert(_minimumSize <= _maximumSize, 'splitview view minimum size must be <= maximum size');
	}

	layout(size: number, _offset: number, orthogonalSize: number | undefined): void {
		this._size = size;
		this._orthogonalSize = orthogonalSize;
		this._onDidLayout.fire({ size, orthogonalSize });
	}

	focus(): void {
		this._onDidFocus.fire();
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._onDidGetElement.dispose();
		this._onDidLayout.dispose();
		this._onDidFocus.dispose();
	}
}

function getSashes(splitview: SplitView): Sash[] {
	return (splitview as any).sashItems.map((i: any) => i.sash) as Sash[];
}

suite('Splitview', () => {
	let container: HTMLElement;

	setup(() => {
		container = document.createElement('div');
		container.style.position = 'absolute';
		container.style.width = `${200}px`;
		container.style.height = `${200}px`;
	});

	test('empty splitview has empty DOM', () => {
		const splitview = new SplitView(container);
		assert.strictEqual(container.firstElementChild!.firstElementChild!.childElementCount, 0, 'split view should be empty');
		splitview.dispose();
	});

	test('has views and sashes as children', () => {
		const view1 = new TestView(20, 20);
		const view2 = new TestView(20, 20);
		const view3 = new TestView(20, 20);
		const splitview = new SplitView(container);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		let viewQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-scrollable-element > .split-view-container > .split-view-view');
		assert.strictEqual(viewQuery.length, 3, 'split view should have 3 views');

		let sashQuery = container.querySelectorAll('.monaco-split-view2 > .sash-container > .monaco-sash');
		assert.strictEqual(sashQuery.length, 2, 'split view should have 2 sashes');

		splitview.removeView(2);

		viewQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-scrollable-element > .split-view-container > .split-view-view');
		assert.strictEqual(viewQuery.length, 2, 'split view should have 2 views');

		sashQuery = container.querySelectorAll('.monaco-split-view2 > .sash-container > .monaco-sash');
		assert.strictEqual(sashQuery.length, 1, 'split view should have 1 sash');

		splitview.removeView(0);

		viewQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-scrollable-element > .split-view-container > .split-view-view');
		assert.strictEqual(viewQuery.length, 1, 'split view should have 1 view');

		sashQuery = container.querySelectorAll('.monaco-split-view2 > .sash-container > .monaco-sash');
		assert.strictEqual(sashQuery.length, 0, 'split view should have no sashes');

		splitview.removeView(0);

		viewQuery = container.querySelectorAll('.monaco-split-view2 > .monaco-scrollable-element > .split-view-container > .split-view-view');
		assert.strictEqual(viewQuery.length, 0, 'split view should have no views');

		sashQuery = container.querySelectorAll('.monaco-split-view2 > .sash-container > .monaco-sash');
		assert.strictEqual(sashQuery.length, 0, 'split view should have no sashes');

		splitview.dispose();
		view1.dispose();
		view2.dispose();
		view3.dispose();
	});

	test('calls view methods on addView and removeView', () => {
		const view = new TestView(20, 20);
		const splitview = new SplitView(container);

		let didLayout = false;
		const layoutDisposable = view.onDidLayout(() => didLayout = true);

		const renderDisposable = view.onDidGetElement(() => undefined);

		splitview.addView(view, 20);

		assert.strictEqual(view.size, 20, 'view has right size');
		assert(didLayout, 'layout is called');
		assert(didLayout, 'render is called');

		splitview.dispose();
		layoutDisposable.dispose();
		renderDisposable.dispose();
		view.dispose();
	});

	test('stretches view to viewport', () => {
		const view = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view, 20);
		assert.strictEqual(view.size, 200, 'view is stretched');

		splitview.layout(200);
		assert.strictEqual(view.size, 200, 'view stayed the same');

		splitview.layout(100);
		assert.strictEqual(view.size, 100, 'view is collapsed');

		splitview.layout(20);
		assert.strictEqual(view.size, 20, 'view is collapsed');

		splitview.layout(10);
		assert.strictEqual(view.size, 20, 'view is clamped');

		splitview.layout(200);
		assert.strictEqual(view.size, 200, 'view is stretched');

		splitview.dispose();
		view.dispose();
	});

	test('can resize views', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		assert.strictEqual(view1.size, 160, 'view1 is stretched');
		assert.strictEqual(view2.size, 20, 'view2 size is 20');
		assert.strictEqual(view3.size, 20, 'view3 size is 20');

		splitview.resizeView(1, 40);

		assert.strictEqual(view1.size, 140, 'view1 is collapsed');
		assert.strictEqual(view2.size, 40, 'view2 is stretched');
		assert.strictEqual(view3.size, 20, 'view3 stays the same');

		splitview.resizeView(0, 70);

		assert.strictEqual(view1.size, 70, 'view1 is collapsed');
		assert.strictEqual(view2.size, 40, 'view2 stays the same');
		assert.strictEqual(view3.size, 90, 'view3 is stretched');

		splitview.resizeView(2, 40);

		assert.strictEqual(view1.size, 70, 'view1 stays the same');
		assert.strictEqual(view2.size, 90, 'view2 is collapsed');
		assert.strictEqual(view3.size, 40, 'view3 is stretched');

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('reacts to view changes', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, 20);
		splitview.addView(view2, 20);
		splitview.addView(view3, 20);

		assert.strictEqual(view1.size, 160, 'view1 is stretched');
		assert.strictEqual(view2.size, 20, 'view2 size is 20');
		assert.strictEqual(view3.size, 20, 'view3 size is 20');

		view1.maximumSize = 20;

		assert.strictEqual(view1.size, 20, 'view1 is collapsed');
		assert.strictEqual(view2.size, 20, 'view2 stays the same');
		assert.strictEqual(view3.size, 160, 'view3 is stretched');

		view3.maximumSize = 40;

		assert.strictEqual(view1.size, 20, 'view1 stays the same');
		assert.strictEqual(view2.size, 140, 'view2 is stretched');
		assert.strictEqual(view3.size, 40, 'view3 is collapsed');

		view2.maximumSize = 200;

		assert.strictEqual(view1.size, 20, 'view1 stays the same');
		assert.strictEqual(view2.size, 140, 'view2 stays the same');
		assert.strictEqual(view3.size, 40, 'view3 stays the same');

		view3.maximumSize = Number.POSITIVE_INFINITY;
		view3.minimumSize = 100;

		assert.strictEqual(view1.size, 20, 'view1 is collapsed');
		assert.strictEqual(view2.size, 80, 'view2 is collapsed');
		assert.strictEqual(view3.size, 100, 'view3 is stretched');

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('sashes are properly enabled/disabled', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		splitview.addView(view2, Sizing.Distribute);
		splitview.addView(view3, Sizing.Distribute);

		let sashes = getSashes(splitview);
		assert.strictEqual(sashes.length, 2, 'there are two sashes');
		assert.strictEqual(sashes[0].state, SashState.Enabled, 'first sash is enabled');
		assert.strictEqual(sashes[1].state, SashState.Enabled, 'second sash is enabled');

		splitview.layout(60);
		assert.strictEqual(sashes[0].state, SashState.Disabled, 'first sash is disabled');
		assert.strictEqual(sashes[1].state, SashState.Disabled, 'second sash is disabled');

		splitview.layout(20);
		assert.strictEqual(sashes[0].state, SashState.Disabled, 'first sash is disabled');
		assert.strictEqual(sashes[1].state, SashState.Disabled, 'second sash is disabled');

		splitview.layout(200);
		assert.strictEqual(sashes[0].state, SashState.Enabled, 'first sash is enabled');
		assert.strictEqual(sashes[1].state, SashState.Enabled, 'second sash is enabled');

		view1.maximumSize = 20;
		assert.strictEqual(sashes[0].state, SashState.Disabled, 'first sash is disabled');
		assert.strictEqual(sashes[1].state, SashState.Enabled, 'second sash is enabled');

		view2.maximumSize = 20;
		assert.strictEqual(sashes[0].state, SashState.Disabled, 'first sash is disabled');
		assert.strictEqual(sashes[1].state, SashState.Disabled, 'second sash is disabled');

		view1.maximumSize = 300;
		assert.strictEqual(sashes[0].state, SashState.Minimum, 'first sash is enabled');
		assert.strictEqual(sashes[1].state, SashState.Minimum, 'second sash is enabled');

		view2.maximumSize = 200;
		assert.strictEqual(sashes[0].state, SashState.Minimum, 'first sash is enabled');
		assert.strictEqual(sashes[1].state, SashState.Minimum, 'second sash is enabled');

		splitview.resizeView(0, 40);
		assert.strictEqual(sashes[0].state, SashState.Enabled, 'first sash is enabled');
		assert.strictEqual(sashes[1].state, SashState.Enabled, 'second sash is enabled');

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('issue #35497', () => {
		const view1 = new TestView(160, Number.POSITIVE_INFINITY);
		const view2 = new TestView(66, 66);

		const splitview = new SplitView(container);
		splitview.layout(986);

		splitview.addView(view1, 142, 0);
		assert.strictEqual(view1.size, 986, 'first view is stretched');

		view2.onDidGetElement(() => {
			assert.throws(() => splitview.resizeView(1, 922));
			assert.throws(() => splitview.resizeView(1, 922));
		});

		splitview.addView(view2, 66, 0);
		assert.strictEqual(view2.size, 66, 'second view is fixed');
		assert.strictEqual(view1.size, 986 - 66, 'first view is collapsed');

		const viewContainers = container.querySelectorAll('.split-view-view');
		assert.strictEqual(viewContainers.length, 2, 'there are two view containers');
		assert.strictEqual((viewContainers.item(0) as HTMLElement).style.height, '66px', 'second view container is 66px');
		assert.strictEqual((viewContainers.item(1) as HTMLElement).style.height, `${986 - 66}px`, 'first view container is 66px');

		splitview.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('automatic size distribution', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		assert.strictEqual(view1.size, 200);

		splitview.addView(view2, 50);
		assert.deepStrictEqual([view1.size, view2.size], [150, 50]);

		splitview.addView(view3, Sizing.Distribute);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [66, 66, 68]);

		splitview.removeView(1, Sizing.Distribute);
		assert.deepStrictEqual([view1.size, view3.size], [100, 100]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('add views before layout', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);

		splitview.addView(view1, 100);
		splitview.addView(view2, 75);
		splitview.addView(view3, 25);

		splitview.layout(200);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [67, 67, 66]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('split sizing', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		assert.strictEqual(view1.size, 200);

		splitview.addView(view2, Sizing.Split(0));
		assert.deepStrictEqual([view1.size, view2.size], [100, 100]);

		splitview.addView(view3, Sizing.Split(1));
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [100, 50, 50]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('split sizing 2', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		assert.strictEqual(view1.size, 200);

		splitview.addView(view2, Sizing.Split(0));
		assert.deepStrictEqual([view1.size, view2.size], [100, 100]);

		splitview.addView(view3, Sizing.Split(0));
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [50, 100, 50]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('proportional layout', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container);
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		splitview.addView(view2, Sizing.Distribute);
		assert.deepStrictEqual([view1.size, view2.size], [100, 100]);

		splitview.layout(100);
		assert.deepStrictEqual([view1.size, view2.size], [50, 50]);

		splitview.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('disable proportional layout', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container, { proportionalLayout: false });
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		splitview.addView(view2, Sizing.Distribute);
		assert.deepStrictEqual([view1.size, view2.size], [100, 100]);

		splitview.layout(100);
		assert.deepStrictEqual([view1.size, view2.size], [80, 20]);

		splitview.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('high layout priority', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY, LayoutPriority.High);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY);
		const splitview = new SplitView(container, { proportionalLayout: false });
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		splitview.addView(view2, Sizing.Distribute);
		splitview.addView(view3, Sizing.Distribute);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [66, 68, 66]);

		splitview.layout(180);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [66, 48, 66]);

		splitview.layout(124);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [66, 20, 38]);

		splitview.layout(60);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [20, 20, 20]);

		splitview.layout(200);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [20, 160, 20]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('low layout priority', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY, LayoutPriority.Low);
		const splitview = new SplitView(container, { proportionalLayout: false });
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		splitview.addView(view2, Sizing.Distribute);
		splitview.addView(view3, Sizing.Distribute);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [66, 68, 66]);

		splitview.layout(180);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [66, 48, 66]);

		splitview.layout(132);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [46, 20, 66]);

		splitview.layout(60);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [20, 20, 20]);

		splitview.layout(200);
		assert.deepStrictEqual([view1.size, view2.size, view3.size], [20, 160, 20]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});

	test('context propagates to views', () => {
		const view1 = new TestView(20, Number.POSITIVE_INFINITY);
		const view2 = new TestView(20, Number.POSITIVE_INFINITY);
		const view3 = new TestView(20, Number.POSITIVE_INFINITY, LayoutPriority.Low);
		const splitview = new SplitView<number>(container, { proportionalLayout: false });
		splitview.layout(200);

		splitview.addView(view1, Sizing.Distribute);
		splitview.addView(view2, Sizing.Distribute);
		splitview.addView(view3, Sizing.Distribute);

		splitview.layout(200, 100);
		assert.deepStrictEqual([view1.orthogonalSize, view2.orthogonalSize, view3.orthogonalSize], [100, 100, 100]);

		splitview.dispose();
		view3.dispose();
		view2.dispose();
		view1.dispose();
	});
});
