/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Dimension } from 'vs/base/browser/dom';
import { Orientation, OrthogonalEdge, Sash, SashState } from 'vs/base/browser/ui/sash/sash';


export interface IResizeEvent {
	dimension: Dimension;
	done: boolean;
	north?: boolean;
	east?: boolean;
	south?: boolean;
	west?: boolean;
}

export class ResizableHTMLElement {

	readonly domNode: HTMLElement;

	private readonly _onDidWillResize = new Emitter<void>();
	readonly onDidWillResize: Event<void> = this._onDidWillResize.event;

	private readonly _onDidResize = new Emitter<IResizeEvent>();
	readonly onDidResize: Event<IResizeEvent> = this._onDidResize.event;

	private readonly _northSash: Sash;
	private readonly _eastSash: Sash;
	private readonly _southSash: Sash;
	private readonly _westSash: Sash;
	private readonly _sashListener = new DisposableStore();

	private _size = new Dimension(0, 0);
	private _minSize = new Dimension(0, 0);
	private _maxSize = new Dimension(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
	private _preferredSize?: Dimension;

	constructor() {
		this.domNode = document.createElement('div');
		this._eastSash = new Sash(this.domNode, { getVerticalSashLeft: () => this._size.width }, { orientation: Orientation.VERTICAL });
		this._westSash = new Sash(this.domNode, { getVerticalSashLeft: () => 0 }, { orientation: Orientation.VERTICAL });
		this._northSash = new Sash(this.domNode, { getHorizontalSashTop: () => 0 }, { orientation: Orientation.HORIZONTAL, orthogonalEdge: OrthogonalEdge.North });
		this._southSash = new Sash(this.domNode, { getHorizontalSashTop: () => this._size.height }, { orientation: Orientation.HORIZONTAL, orthogonalEdge: OrthogonalEdge.South });

		this._northSash.orthogonalStartSash = this._westSash;
		this._northSash.orthogonalEndSash = this._eastSash;
		this._southSash.orthogonalStartSash = this._westSash;
		this._southSash.orthogonalEndSash = this._eastSash;

		let currentSize: Dimension | undefined;
		let deltaY = 0;
		let deltaX = 0;

		this._sashListener.add(Event.any(this._northSash.onDidStart, this._eastSash.onDidStart, this._southSash.onDidStart, this._westSash.onDidStart)(() => {
			if (currentSize === undefined) {
				this._onDidWillResize.fire();
				currentSize = this._size;
				deltaY = 0;
				deltaX = 0;
			}
		}));
		this._sashListener.add(Event.any(this._northSash.onDidEnd, this._eastSash.onDidEnd, this._southSash.onDidEnd, this._westSash.onDidEnd)(() => {
			if (currentSize !== undefined) {
				currentSize = undefined;
				deltaY = 0;
				deltaX = 0;
				this._onDidResize.fire({ dimension: this._size, done: true });
			}
		}));

		this._sashListener.add(this._eastSash.onDidChange(e => {
			if (currentSize) {
				deltaX = e.currentX - e.startX;
				this.layout(currentSize.height + deltaY, currentSize.width + deltaX);
				this._onDidResize.fire({ dimension: this._size, done: false, east: true });
			}
		}));
		this._sashListener.add(this._westSash.onDidChange(e => {
			if (currentSize) {
				deltaX = -(e.currentX - e.startX);
				this.layout(currentSize.height + deltaY, currentSize.width + deltaX);
				this._onDidResize.fire({ dimension: this._size, done: false, west: true });
			}
		}));
		this._sashListener.add(this._northSash.onDidChange(e => {
			if (currentSize) {
				deltaY = -(e.currentY - e.startY);
				this.layout(currentSize.height + deltaY, currentSize.width + deltaX);
				this._onDidResize.fire({ dimension: this._size, done: false, north: true });
			}
		}));
		this._sashListener.add(this._southSash.onDidChange(e => {
			if (currentSize) {
				deltaY = e.currentY - e.startY;
				this.layout(currentSize.height + deltaY, currentSize.width + deltaX);
				this._onDidResize.fire({ dimension: this._size, done: false, south: true });
			}
		}));

		this._sashListener.add(Event.any(this._eastSash.onDidReset, this._westSash.onDidReset)(e => {
			if (this._preferredSize) {
				this.layout(this._size.height, this._preferredSize.width);
				this._onDidResize.fire({ dimension: this._size, done: true });
			}
		}));
		this._sashListener.add(Event.any(this._northSash.onDidReset, this._southSash.onDidReset)(e => {
			if (this._preferredSize) {
				this.layout(this._preferredSize.height, this._size.width);
				this._onDidResize.fire({ dimension: this._size, done: true });
			}
		}));
	}

	dispose(): void {
		this._northSash.dispose();
		this._southSash.dispose();
		this._eastSash.dispose();
		this._westSash.dispose();
		this._sashListener.dispose();
		this.domNode.remove();
	}

	enableSashes(north: boolean, east: boolean, south: boolean, west: boolean): void {
		this._northSash.state = north ? SashState.Enabled : SashState.Disabled;
		this._eastSash.state = east ? SashState.Enabled : SashState.Disabled;
		this._southSash.state = south ? SashState.Enabled : SashState.Disabled;
		this._westSash.state = west ? SashState.Enabled : SashState.Disabled;
	}

	layout(height: number = this.size.height, width: number = this.size.width): void {

		const { height: minHeight, width: minWidth } = this._minSize;
		const { height: maxHeight, width: maxWidth } = this._maxSize;

		height = Math.max(minHeight, Math.min(maxHeight, height));
		width = Math.max(minWidth, Math.min(maxWidth, width));

		const newSize = new Dimension(width, height);
		if (!Dimension.equals(newSize, this._size)) {
			this.domNode.style.height = height + 'px';
			this.domNode.style.width = width + 'px';
			this._size = newSize;
			this._northSash.layout();
			this._eastSash.layout();
			this._southSash.layout();
			this._westSash.layout();
		}
	}

	get size() {
		return this._size;
	}

	set maxSize(value: Dimension) {
		this._maxSize = value;
	}

	get maxSize() {
		return this._maxSize;
	}

	set minSize(value: Dimension) {
		this._minSize = value;
	}

	get minSize() {
		return this._minSize;
	}

	set preferredSize(value: Dimension | undefined) {
		this._preferredSize = value;
	}

	get preferredSize() {
		return this._preferredSize;
	}
}
