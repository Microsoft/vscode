/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Direction, getRelativeLocation, Orientation, SerializableGrid, ISerializableView, IViewDeserializer, GridNode, Sizing, isGridBranchNode, sanitizeGridNodeDescriptor, GridNodeDescriptor, createSerializedGrid, Grid } from 'vs/base/browser/ui/grid/grid';
import { TestView, nodesToArrays } from './util';
import { deepClone } from 'vs/base/common/objects';
import { Event } from 'vs/base/common/event';

// Simple example:
//
//  +-----+---------------+
//  |  4  |      2        |
//  +-----+---------+-----+
//  |        1      |     |
//  +---------------+  3  |
//  |        5      |     |
//  +---------------+-----+
//
//  V
//  +-H
//  | +-4
//  | +-2
//  +-H
//    +-V
//    | +-1
//    | +-5
//    +-3

suite('Grid', function () {
	let container: HTMLElement;

	setup(function () {
		container = document.createElement('div');
		container.style.position = 'absolute';
		container.style.width = `${800}px`;
		container.style.height = `${600}px`;
	});

	test('getRelativeLocation', () => {
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0], Direction.Up), [0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0], Direction.Down), [1]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0], Direction.Left), [0, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0], Direction.Right), [0, 1]);

		assert.deepStrictEqual(getRelativeLocation(Orientation.HORIZONTAL, [0], Direction.Up), [0, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.HORIZONTAL, [0], Direction.Down), [0, 1]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.HORIZONTAL, [0], Direction.Left), [0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.HORIZONTAL, [0], Direction.Right), [1]);

		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [4], Direction.Up), [4]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [4], Direction.Down), [5]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [4], Direction.Left), [4, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [4], Direction.Right), [4, 1]);

		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0, 0], Direction.Up), [0, 0, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0, 0], Direction.Down), [0, 0, 1]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0, 0], Direction.Left), [0, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [0, 0], Direction.Right), [0, 1]);

		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2], Direction.Up), [1, 2, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2], Direction.Down), [1, 2, 1]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2], Direction.Left), [1, 2]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2], Direction.Right), [1, 3]);

		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2, 3], Direction.Up), [1, 2, 3]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2, 3], Direction.Down), [1, 2, 4]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2, 3], Direction.Left), [1, 2, 3, 0]);
		assert.deepStrictEqual(getRelativeLocation(Orientation.VERTICAL, [1, 2, 3], Direction.Right), [1, 2, 3, 1]);
	});

	test('empty', () => {
		const view1 = new TestView(100, Number.MAX_VALUE, 100, Number.MAX_VALUE);
		const gridview = new Grid(view1);
		container.appendChild(gridview.element);
		gridview.layout(800, 600);

		assert.deepStrictEqual(view1.size, [800, 600]);
	});

	test('two views vertically', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);
		assert.deepStrictEqual(view1.size, [800, 600]);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);
		assert.deepStrictEqual(view1.size, [800, 400]);
		assert.deepStrictEqual(view2.size, [800, 200]);
	});

	test('two views horizontally', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);
		assert.deepStrictEqual(view1.size, [800, 600]);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 300, view1, Direction.Right);
		assert.deepStrictEqual(view1.size, [500, 600]);
		assert.deepStrictEqual(view2.size, [300, 600]);
	});

	test('simple layout', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);
		assert.deepStrictEqual(view1.size, [800, 600]);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);
		assert.deepStrictEqual(view1.size, [800, 400]);
		assert.deepStrictEqual(view2.size, [800, 200]);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, 200, view1, Direction.Right);
		assert.deepStrictEqual(view1.size, [600, 400]);
		assert.deepStrictEqual(view2.size, [800, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, 200, view2, Direction.Left);
		assert.deepStrictEqual(view1.size, [600, 400]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);

		const view5 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, 100, view1, Direction.Down);
		assert.deepStrictEqual(view1.size, [600, 300]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);
		assert.deepStrictEqual(view5.size, [600, 100]);
	});

	test('another simple layout with automatic size distribution', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);
		assert.deepStrictEqual(view1.size, [800, 600]);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Distribute, view1, Direction.Left);
		assert.deepStrictEqual(view1.size, [400, 600]);
		assert.deepStrictEqual(view2.size, [400, 600]);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Distribute, view1, Direction.Right);
		assert.deepStrictEqual(view1.size, [266, 600]);
		assert.deepStrictEqual(view2.size, [266, 600]);
		assert.deepStrictEqual(view3.size, [268, 600]);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Distribute, view2, Direction.Down);
		assert.deepStrictEqual(view1.size, [266, 600]);
		assert.deepStrictEqual(view2.size, [266, 300]);
		assert.deepStrictEqual(view3.size, [268, 600]);
		assert.deepStrictEqual(view4.size, [266, 300]);

		const view5 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, Sizing.Distribute, view3, Direction.Up);
		assert.deepStrictEqual(view1.size, [266, 600]);
		assert.deepStrictEqual(view2.size, [266, 300]);
		assert.deepStrictEqual(view3.size, [268, 300]);
		assert.deepStrictEqual(view4.size, [266, 300]);
		assert.deepStrictEqual(view5.size, [268, 300]);

		const view6 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view6, Sizing.Distribute, view3, Direction.Down);
		assert.deepStrictEqual(view1.size, [266, 600]);
		assert.deepStrictEqual(view2.size, [266, 300]);
		assert.deepStrictEqual(view3.size, [268, 200]);
		assert.deepStrictEqual(view4.size, [266, 300]);
		assert.deepStrictEqual(view5.size, [268, 200]);
		assert.deepStrictEqual(view6.size, [268, 200]);
	});

	test('another simple layout with split size distribution', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);
		assert.deepStrictEqual(view1.size, [800, 600]);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Split, view1, Direction.Left);
		assert.deepStrictEqual(view1.size, [400, 600]);
		assert.deepStrictEqual(view2.size, [400, 600]);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Split, view1, Direction.Right);
		assert.deepStrictEqual(view1.size, [200, 600]);
		assert.deepStrictEqual(view2.size, [400, 600]);
		assert.deepStrictEqual(view3.size, [200, 600]);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Split, view2, Direction.Down);
		assert.deepStrictEqual(view1.size, [200, 600]);
		assert.deepStrictEqual(view2.size, [400, 300]);
		assert.deepStrictEqual(view3.size, [200, 600]);
		assert.deepStrictEqual(view4.size, [400, 300]);

		const view5 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, Sizing.Split, view3, Direction.Up);
		assert.deepStrictEqual(view1.size, [200, 600]);
		assert.deepStrictEqual(view2.size, [400, 300]);
		assert.deepStrictEqual(view3.size, [200, 300]);
		assert.deepStrictEqual(view4.size, [400, 300]);
		assert.deepStrictEqual(view5.size, [200, 300]);

		const view6 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view6, Sizing.Split, view3, Direction.Down);
		assert.deepStrictEqual(view1.size, [200, 600]);
		assert.deepStrictEqual(view2.size, [400, 300]);
		assert.deepStrictEqual(view3.size, [200, 150]);
		assert.deepStrictEqual(view4.size, [400, 300]);
		assert.deepStrictEqual(view5.size, [200, 300]);
		assert.deepStrictEqual(view6.size, [200, 150]);
	});

	test('3/2 layout with split', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);
		assert.deepStrictEqual(view1.size, [800, 600]);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Split, view1, Direction.Down);
		assert.deepStrictEqual(view1.size, [800, 300]);
		assert.deepStrictEqual(view2.size, [800, 300]);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Split, view2, Direction.Right);
		assert.deepStrictEqual(view1.size, [800, 300]);
		assert.deepStrictEqual(view2.size, [400, 300]);
		assert.deepStrictEqual(view3.size, [400, 300]);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Split, view1, Direction.Right);
		assert.deepStrictEqual(view1.size, [400, 300]);
		assert.deepStrictEqual(view2.size, [400, 300]);
		assert.deepStrictEqual(view3.size, [400, 300]);
		assert.deepStrictEqual(view4.size, [400, 300]);

		const view5 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, Sizing.Split, view1, Direction.Right);
		assert.deepStrictEqual(view1.size, [200, 300]);
		assert.deepStrictEqual(view2.size, [400, 300]);
		assert.deepStrictEqual(view3.size, [400, 300]);
		assert.deepStrictEqual(view4.size, [400, 300]);
		assert.deepStrictEqual(view5.size, [200, 300]);
	});

	test('sizing should be correct after branch demotion #50564', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Split, view1, Direction.Right);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Split, view2, Direction.Down);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Split, view2, Direction.Right);
		assert.deepStrictEqual(view1.size, [400, 600]);
		assert.deepStrictEqual(view2.size, [200, 300]);
		assert.deepStrictEqual(view3.size, [400, 300]);
		assert.deepStrictEqual(view4.size, [200, 300]);

		grid.removeView(view3);
		assert.deepStrictEqual(view1.size, [400, 600]);
		assert.deepStrictEqual(view2.size, [200, 600]);
		assert.deepStrictEqual(view4.size, [200, 600]);
	});

	test('sizing should be correct after branch demotion #50675', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Distribute, view1, Direction.Down);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Distribute, view2, Direction.Down);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Distribute, view3, Direction.Right);
		assert.deepStrictEqual(view1.size, [800, 200]);
		assert.deepStrictEqual(view2.size, [800, 200]);
		assert.deepStrictEqual(view3.size, [400, 200]);
		assert.deepStrictEqual(view4.size, [400, 200]);

		grid.removeView(view3, Sizing.Distribute);
		assert.deepStrictEqual(view1.size, [800, 200]);
		assert.deepStrictEqual(view2.size, [800, 200]);
		assert.deepStrictEqual(view4.size, [800, 200]);
	});

	test('getNeighborViews should work on single view layout', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Up), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Down), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Left), []);

		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Up, true), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Right, true), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Down, true), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Left, true), [view1]);
	});

	test('getNeighborViews should work on simple layout', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Distribute, view1, Direction.Down);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Distribute, view2, Direction.Down);

		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Up), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Down), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Left), []);

		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Up, true), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Right, true), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Down, true), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Left, true), [view1]);

		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Up), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Down), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Left), []);

		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Up, true), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Right, true), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Down, true), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Left, true), [view2]);

		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Up), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Down), []);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Left), []);

		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Up, true), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Right, true), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Down, true), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Left, true), [view3]);
	});

	test('getNeighborViews should work on a complex layout', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Distribute, view1, Direction.Down);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Distribute, view2, Direction.Down);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Distribute, view2, Direction.Right);

		const view5 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, Sizing.Distribute, view4, Direction.Down);

		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Up), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Down), [view2, view4]);
		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Left), []);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Up), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Right), [view4, view5]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Down), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view2, Direction.Left), []);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Up), [view1]);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Down), [view5]);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Left), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view5, Direction.Up), [view4]);
		assert.deepStrictEqual(grid.getNeighborViews(view5, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view5, Direction.Down), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view5, Direction.Left), [view2]);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Up), [view2, view5]);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Down), []);
		assert.deepStrictEqual(grid.getNeighborViews(view3, Direction.Left), []);
	});

	test('getNeighborViews should work on another simple layout', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Distribute, view1, Direction.Right);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Distribute, view2, Direction.Down);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Distribute, view2, Direction.Right);

		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Up), []);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Right), []);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Down), [view3]);
		assert.deepStrictEqual(grid.getNeighborViews(view4, Direction.Left), [view2]);
	});

	test('getNeighborViews should only return immediate neighbors', function () {
		const view1 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new Grid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Distribute, view1, Direction.Right);

		const view3 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Distribute, view2, Direction.Down);

		const view4 = new TestView(50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Distribute, view2, Direction.Right);

		assert.deepStrictEqual(grid.getNeighborViews(view1, Direction.Right), [view2, view3]);
	});
});

class TestSerializableView extends TestView implements ISerializableView {

	constructor(
		readonly name: string,
		minimumWidth: number,
		maximumWidth: number,
		minimumHeight: number,
		maximumHeight: number
	) {
		super(minimumWidth, maximumWidth, minimumHeight, maximumHeight);
	}

	toJSON() {
		return { name: this.name };
	}
}

class TestViewDeserializer implements IViewDeserializer<TestSerializableView> {

	private views = new Map<string, TestSerializableView>();

	fromJSON(json: any): TestSerializableView {
		const view = new TestSerializableView(json.name, 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		this.views.set(json.name, view);
		return view;
	}

	getView(id: string): TestSerializableView {
		const view = this.views.get(id);
		if (!view) {
			throw new Error('Unknown view');
		}
		return view;
	}
}

function nodesToNames(node: GridNode<TestSerializableView>): any {
	if (isGridBranchNode(node)) {
		return node.children.map(nodesToNames);
	} else {
		return node.view.name;
	}
}

suite('SerializableGrid', function () {

	let container: HTMLElement;

	setup(function () {
		container = document.createElement('div');
		container.style.position = 'absolute';
		container.style.width = `${800}px`;
		container.style.height = `${600}px`;
	});

	test('serialize empty', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);

		const actual = grid.serialize();
		assert.deepStrictEqual(actual, {
			orientation: 0,
			width: 800,
			height: 600,
			root: {
				type: 'branch',
				data: [
					{
						type: 'leaf',
						data: {
							name: 'view1',
						},
						size: 600
					}
				],
				size: 800
			}
		});
	});

	test('serialize simple layout', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, 200, view1, Direction.Right);

		const view4 = new TestSerializableView('view4', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, 200, view2, Direction.Left);

		const view5 = new TestSerializableView('view5', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, 100, view1, Direction.Down);

		assert.deepStrictEqual(grid.serialize(), {
			orientation: 0,
			width: 800,
			height: 600,
			root: {
				type: 'branch',
				data: [
					{
						type: 'branch',
						data: [
							{ type: 'leaf', data: { name: 'view4' }, size: 200 },
							{ type: 'leaf', data: { name: 'view2' }, size: 600 }
						],
						size: 200
					},
					{
						type: 'branch',
						data: [
							{
								type: 'branch',
								data: [
									{ type: 'leaf', data: { name: 'view1' }, size: 300 },
									{ type: 'leaf', data: { name: 'view5' }, size: 100 }
								],
								size: 600
							},
							{ type: 'leaf', data: { name: 'view3' }, size: 200 }
						],
						size: 400
					}
				],
				size: 800
			}
		});
	});

	test('deserialize empty', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);

		const json = grid.serialize();
		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);
		grid2.layout(800, 600);

		assert.deepStrictEqual(nodesToNames(grid2.getViews()), ['view1']);
	});

	test('deserialize simple layout', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, 200, view1, Direction.Right);

		const view4 = new TestSerializableView('view4', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, 200, view2, Direction.Left);

		const view5 = new TestSerializableView('view5', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, 100, view1, Direction.Down);

		const json = grid.serialize();
		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view1Copy = deserializer.getView('view1');
		const view2Copy = deserializer.getView('view2');
		const view3Copy = deserializer.getView('view3');
		const view4Copy = deserializer.getView('view4');
		const view5Copy = deserializer.getView('view5');

		assert.deepStrictEqual(nodesToArrays(grid2.getViews()), [[view4Copy, view2Copy], [[view1Copy, view5Copy], view3Copy]]);

		grid2.layout(800, 600);

		assert.deepStrictEqual(view1Copy.size, [600, 300]);
		assert.deepStrictEqual(view2Copy.size, [600, 200]);
		assert.deepStrictEqual(view3Copy.size, [200, 400]);
		assert.deepStrictEqual(view4Copy.size, [200, 200]);
		assert.deepStrictEqual(view5Copy.size, [600, 100]);
	});

	test('deserialize simple layout with scaling', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, 200, view1, Direction.Right);

		const view4 = new TestSerializableView('view4', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, 200, view2, Direction.Left);

		const view5 = new TestSerializableView('view5', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, 100, view1, Direction.Down);

		const json = grid.serialize();
		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view1Copy = deserializer.getView('view1');
		const view2Copy = deserializer.getView('view2');
		const view3Copy = deserializer.getView('view3');
		const view4Copy = deserializer.getView('view4');
		const view5Copy = deserializer.getView('view5');

		grid2.layout(400, 800); // [/2, *4/3]
		assert.deepStrictEqual(view1Copy.size, [300, 400]);
		assert.deepStrictEqual(view2Copy.size, [300, 267]);
		assert.deepStrictEqual(view3Copy.size, [100, 533]);
		assert.deepStrictEqual(view4Copy.size, [100, 267]);
		assert.deepStrictEqual(view5Copy.size, [300, 133]);
	});

	test('deserialize 4 view layout (ben issue #2)', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Split, view1, Direction.Down);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Split, view2, Direction.Down);

		const view4 = new TestSerializableView('view4', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, Sizing.Split, view3, Direction.Right);

		const json = grid.serialize();
		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view1Copy = deserializer.getView('view1');
		const view2Copy = deserializer.getView('view2');
		const view3Copy = deserializer.getView('view3');
		const view4Copy = deserializer.getView('view4');

		grid2.layout(800, 600);

		assert.deepStrictEqual(view1Copy.size, [800, 300]);
		assert.deepStrictEqual(view2Copy.size, [800, 150]);
		assert.deepStrictEqual(view3Copy.size, [400, 150]);
		assert.deepStrictEqual(view4Copy.size, [400, 150]);
	});

	test('deserialize 2 view layout (ben issue #3)', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Split, view1, Direction.Right);

		const json = grid.serialize();
		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view1Copy = deserializer.getView('view1');
		const view2Copy = deserializer.getView('view2');

		grid2.layout(800, 600);

		assert.deepStrictEqual(view1Copy.size, [400, 600]);
		assert.deepStrictEqual(view2Copy.size, [400, 600]);
	});

	test('deserialize simple view layout #50609', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);

		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, Sizing.Split, view1, Direction.Right);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, Sizing.Split, view2, Direction.Down);

		grid.removeView(view1, Sizing.Split);

		const json = grid.serialize();
		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view2Copy = deserializer.getView('view2');
		const view3Copy = deserializer.getView('view3');

		grid2.layout(800, 600);

		assert.deepStrictEqual(view2Copy.size, [800, 300]);
		assert.deepStrictEqual(view3Copy.size, [800, 300]);
	});

	test('sanitizeGridNodeDescriptor', () => {
		const nodeDescriptor = { groups: [{ size: 0.2 }, { size: 0.2 }, { size: 0.6, groups: [{}, {}] }] };
		const nodeDescriptorCopy = deepClone<GridNodeDescriptor>(nodeDescriptor);
		sanitizeGridNodeDescriptor(nodeDescriptorCopy, true);
		assert.deepStrictEqual(nodeDescriptorCopy, { groups: [{ size: 0.2 }, { size: 0.2 }, { size: 0.6, groups: [{ size: 0.5 }, { size: 0.5 }] }] });
	});

	test('createSerializedGrid', () => {
		const gridDescriptor = { orientation: Orientation.VERTICAL, groups: [{ size: 0.2 }, { size: 0.2 }, { size: 0.6, groups: [{}, {}] }] };
		const serializedGrid = createSerializedGrid(gridDescriptor);
		assert.deepStrictEqual(serializedGrid, {
			root: {
				type: 'branch',
				size: undefined,
				data: [
					{ type: 'leaf', size: 0.2, data: null },
					{ type: 'leaf', size: 0.2, data: null },
					{
						type: 'branch', size: 0.6, data: [
							{ type: 'leaf', size: 0.5, data: null },
							{ type: 'leaf', size: 0.5, data: null }
						]
					}
				]
			},
			orientation: Orientation.VERTICAL,
			width: 1,
			height: 1
		});
	});

	test('createSerializedGrid - issue #85601, should not allow single children groups', () => {
		const serializedGrid = createSerializedGrid({ orientation: Orientation.HORIZONTAL, groups: [{ groups: [{}, {}], size: 0.5 }, { groups: [{}], size: 0.5 }] });
		const views: ISerializableView[] = [];
		const deserializer = new class implements IViewDeserializer<ISerializableView> {
			fromJSON(): ISerializableView {
				const view: ISerializableView = {
					element: document.createElement('div'),
					layout: () => null,
					minimumWidth: 0,
					maximumWidth: Number.POSITIVE_INFINITY,
					minimumHeight: 0,
					maximumHeight: Number.POSITIVE_INFINITY,
					onDidChange: Event.None,
					toJSON: () => ({})
				};
				views.push(view);
				return view;
			}
		};

		const grid = SerializableGrid.deserialize(serializedGrid, deserializer);
		assert.strictEqual(views.length, 3);

		// should not throw
		grid.removeView(views[2]);
	});

	test('serialize should store visibility and previous size', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, 200, view1, Direction.Right);

		const view4 = new TestSerializableView('view4', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, 200, view2, Direction.Left);

		const view5 = new TestSerializableView('view5', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, 100, view1, Direction.Down);

		assert.deepStrictEqual(view1.size, [600, 300]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);
		assert.deepStrictEqual(view5.size, [600, 100]);

		grid.setViewVisible(view5, false);

		assert.deepStrictEqual(view1.size, [600, 400]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);
		assert.deepStrictEqual(view5.size, [600, 0]);

		grid.setViewVisible(view5, true);

		assert.deepStrictEqual(view1.size, [600, 300]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);
		assert.deepStrictEqual(view5.size, [600, 100]);

		grid.setViewVisible(view5, false);

		assert.deepStrictEqual(view1.size, [600, 400]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);
		assert.deepStrictEqual(view5.size, [600, 0]);

		grid.setViewVisible(view5, false);

		const json = grid.serialize();
		assert.deepStrictEqual(json, {
			orientation: 0,
			width: 800,
			height: 600,
			root: {
				type: 'branch',
				data: [
					{
						type: 'branch',
						data: [
							{ type: 'leaf', data: { name: 'view4' }, size: 200 },
							{ type: 'leaf', data: { name: 'view2' }, size: 600 }
						],
						size: 200
					},
					{
						type: 'branch',
						data: [
							{
								type: 'branch',
								data: [
									{ type: 'leaf', data: { name: 'view1' }, size: 400 },
									{ type: 'leaf', data: { name: 'view5' }, size: 100, visible: false }
								],
								size: 600
							},
							{ type: 'leaf', data: { name: 'view3' }, size: 200 }
						],
						size: 400
					}
				],
				size: 800
			}
		});

		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view1Copy = deserializer.getView('view1');
		const view2Copy = deserializer.getView('view2');
		const view3Copy = deserializer.getView('view3');
		const view4Copy = deserializer.getView('view4');
		const view5Copy = deserializer.getView('view5');

		assert.deepStrictEqual(nodesToArrays(grid2.getViews()), [[view4Copy, view2Copy], [[view1Copy, view5Copy], view3Copy]]);

		grid2.layout(800, 600);
		assert.deepStrictEqual(view1Copy.size, [600, 400]);
		assert.deepStrictEqual(view2Copy.size, [600, 200]);
		assert.deepStrictEqual(view3Copy.size, [200, 400]);
		assert.deepStrictEqual(view4Copy.size, [200, 200]);
		assert.deepStrictEqual(view5Copy.size, [600, 0]);

		assert.deepStrictEqual(grid2.isViewVisible(view1Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view2Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view3Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view4Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view5Copy), false);

		grid2.setViewVisible(view5Copy, true);

		assert.deepStrictEqual(view1Copy.size, [600, 300]);
		assert.deepStrictEqual(view2Copy.size, [600, 200]);
		assert.deepStrictEqual(view3Copy.size, [200, 400]);
		assert.deepStrictEqual(view4Copy.size, [200, 200]);
		assert.deepStrictEqual(view5Copy.size, [600, 100]);

		assert.deepStrictEqual(grid2.isViewVisible(view1Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view2Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view3Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view4Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view5Copy), true);
	});

	test('serialize should store visibility and previous size even for first leaf', function () {
		const view1 = new TestSerializableView('view1', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		const grid = new SerializableGrid(view1);
		container.appendChild(grid.element);
		grid.layout(800, 600);

		const view2 = new TestSerializableView('view2', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view2, 200, view1, Direction.Up);

		const view3 = new TestSerializableView('view3', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view3, 200, view1, Direction.Right);

		const view4 = new TestSerializableView('view4', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view4, 200, view2, Direction.Left);

		const view5 = new TestSerializableView('view5', 50, Number.MAX_VALUE, 50, Number.MAX_VALUE);
		grid.addView(view5, 100, view1, Direction.Down);

		assert.deepStrictEqual(view1.size, [600, 300]);
		assert.deepStrictEqual(view2.size, [600, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [200, 200]);
		assert.deepStrictEqual(view5.size, [600, 100]);

		grid.setViewVisible(view4, false);

		assert.deepStrictEqual(view1.size, [600, 300]);
		assert.deepStrictEqual(view2.size, [800, 200]);
		assert.deepStrictEqual(view3.size, [200, 400]);
		assert.deepStrictEqual(view4.size, [0, 200]);
		assert.deepStrictEqual(view5.size, [600, 100]);

		const json = grid.serialize();
		assert.deepStrictEqual(json, {
			orientation: 0,
			width: 800,
			height: 600,
			root: {
				type: 'branch',
				data: [
					{
						type: 'branch',
						data: [
							{ type: 'leaf', data: { name: 'view4' }, size: 200, visible: false },
							{ type: 'leaf', data: { name: 'view2' }, size: 800 }
						],
						size: 200
					},
					{
						type: 'branch',
						data: [
							{
								type: 'branch',
								data: [
									{ type: 'leaf', data: { name: 'view1' }, size: 300 },
									{ type: 'leaf', data: { name: 'view5' }, size: 100 }
								],
								size: 600
							},
							{ type: 'leaf', data: { name: 'view3' }, size: 200 }
						],
						size: 400
					}
				],
				size: 800
			}
		});

		grid.dispose();

		const deserializer = new TestViewDeserializer();
		const grid2 = SerializableGrid.deserialize(json, deserializer);

		const view1Copy = deserializer.getView('view1');
		const view2Copy = deserializer.getView('view2');
		const view3Copy = deserializer.getView('view3');
		const view4Copy = deserializer.getView('view4');
		const view5Copy = deserializer.getView('view5');

		assert.deepStrictEqual(nodesToArrays(grid2.getViews()), [[view4Copy, view2Copy], [[view1Copy, view5Copy], view3Copy]]);

		grid2.layout(800, 600);
		assert.deepStrictEqual(view1Copy.size, [600, 300]);
		assert.deepStrictEqual(view2Copy.size, [800, 200]);
		assert.deepStrictEqual(view3Copy.size, [200, 400]);
		assert.deepStrictEqual(view4Copy.size, [0, 200]);
		assert.deepStrictEqual(view5Copy.size, [600, 100]);

		assert.deepStrictEqual(grid2.isViewVisible(view1Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view2Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view3Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view4Copy), false);
		assert.deepStrictEqual(grid2.isViewVisible(view5Copy), true);

		grid2.setViewVisible(view4Copy, true);

		assert.deepStrictEqual(view1Copy.size, [600, 300]);
		assert.deepStrictEqual(view2Copy.size, [600, 200]);
		assert.deepStrictEqual(view3Copy.size, [200, 400]);
		assert.deepStrictEqual(view4Copy.size, [200, 200]);
		assert.deepStrictEqual(view5Copy.size, [600, 100]);

		assert.deepStrictEqual(grid2.isViewVisible(view1Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view2Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view3Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view4Copy), true);
		assert.deepStrictEqual(grid2.isViewVisible(view5Copy), true);
	});
});
