/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter, Event } from 'vs/base/common/event';
import { GridNode, isGridBranchNode } from 'vs/base/browser/ui/grid/gridview';
import { IView } from 'vs/base/browser/ui/grid/grid';

export class TestView implements IView {

	private readonly _onDidChange = new Emitter<{ width: number; height: number; } | undefined>();
	readonly onDidChange = this._onDidChange.event;

	get minimumWidth(): number { return this._minimumWidth; }
	set minimumWidth(size: number) { this._minimumWidth = size; this._onDidChange.fire(undefined); }

	get maximumWidth(): number { return this._maximumWidth; }
	set maximumWidth(size: number) { this._maximumWidth = size; this._onDidChange.fire(undefined); }

	get minimumHeight(): number { return this._minimumHeight; }
	set minimumHeight(size: number) { this._minimumHeight = size; this._onDidChange.fire(undefined); }

	get maximumHeight(): number { return this._maximumHeight; }
	set maximumHeight(size: number) { this._maximumHeight = size; this._onDidChange.fire(undefined); }

	private _element: HTMLElement = document.createElement('div');
	get element(): HTMLElement { this._onDidGetElement.fire(); return this._element; }

	private readonly _onDidGetElement = new Emitter<void>();
	readonly onDidGetElement = this._onDidGetElement.event;

	private _width = 0;
	get width(): number { return this._width; }

	private _height = 0;
	get height(): number { return this._height; }

	get size(): [number, number] { return [this.width, this.height]; }

	private readonly _onDidLayout = new Emitter<{ width: number; height: number; }>();
	readonly onDidLayout: Event<{ width: number; height: number; }> = this._onDidLayout.event;

	private readonly _onDidFocus = new Emitter<void>();
	readonly onDidFocus: Event<void> = this._onDidFocus.event;

	constructor(
		private _minimumWidth: number,
		private _maximumWidth: number,
		private _minimumHeight: number,
		private _maximumHeight: number
	) {
		assert(_minimumWidth <= _maximumWidth, 'gridview view minimum width must be <= maximum width');
		assert(_minimumHeight <= _maximumHeight, 'gridview view minimum height must be <= maximum height');
	}

	layout(width: number, height: number): void {
		this._width = width;
		this._height = height;
		this._onDidLayout.fire({ width, height });
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

export function nodesToArrays(node: GridNode): any {
	if (isGridBranchNode(node)) {
		return node.children.map(nodesToArrays);
	} else {
		return node.view;
	}
}
