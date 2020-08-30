/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SplitView, Orientation, ISplitViewStyles, IView as ISplitViewView } from 'vs/base/browser/ui/splitview/splitview';
import { $ } from 'vs/base/browser/dom';
import { Event } from 'vs/base/common/event';
import { IView, IViewSize } from 'vs/base/browser/ui/grid/grid';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Color } from 'vs/base/common/color';
import { IBoundarySashes } from 'vs/base/browser/ui/grid/gridview';

export interface CenteredViewState {
	leftMarginRatio: number;
	rightMarginRatio: number;
}

const GOLDEN_RATIO = {
	leftMarginRatio: 0.1909,
	rightMarginRatio: 0.1909
};

function createEmptyView(background: Color | undefined): ISplitViewView {
	const element = $('.centered-layout-margin');
	element.style.height = '100%';
	if (background) {
		element.style.backgroundColor = background.toString();
	}

	return {
		element,
		layout: () => undefined,
		minimumSize: 60,
		maximumSize: Number.POSITIVE_INFINITY,
		onDidChange: Event.None
	};
}

function toSplitViewView(view: IView, getHeight: () => number): ISplitViewView {
	return {
		element: view.element,
		get maximumSize() { return view.maximumWidth; },
		get minimumSize() { return view.minimumWidth; },
		onDidChange: Event.map(view.onDidChange, e => e && e.width),
		layout: (size, offset) => view.layout(size, getHeight(), 0, offset)
	};
}

export interface ICenteredViewStyles extends ISplitViewStyles {
	background: Color;
}

export class CenteredViewLayout implements IDisposable {

	private splitView?: SplitView;
	private width: number = 0;
	private height: number = 0;
	private style!: ICenteredViewStyles;
	private didLayout = false;
	private emptyViews: ISplitViewView[] | undefined;
	private readonly splitViewDisposables = new DisposableStore();

	constructor(private container: HTMLElement, private view: IView, public readonly state: CenteredViewState = { leftMarginRatio: GOLDEN_RATIO.leftMarginRatio, rightMarginRatio: GOLDEN_RATIO.rightMarginRatio }) {
		this.container.appendChild(this.view.element);
		// Make sure to hide the split view overflow like sashes #52892
		this.container.style.overflow = 'hidden';
	}

	get minimumWidth(): number { return this.splitView ? this.splitView.minimumSize : this.view.minimumWidth; }
	get maximumWidth(): number { return this.splitView ? this.splitView.maximumSize : this.view.maximumWidth; }
	get minimumHeight(): number { return this.view.minimumHeight; }
	get maximumHeight(): number { return this.view.maximumHeight; }
	get onDidChange(): Event<IViewSize | undefined> { return this.view.onDidChange; }

	private _boundarySashes: IBoundarySashes = {};
	get boundarySashes(): IBoundarySashes { return this._boundarySashes; }
	set boundarySashes(boundarySashes: IBoundarySashes) {
		this._boundarySashes = boundarySashes;

		if (!this.splitView) {
			return;
		}

		this.splitView.orthogonalStartSash = boundarySashes.top;
		this.splitView.orthogonalEndSash = boundarySashes.bottom;
	}

	layout(width: number, height: number): void {
		this.width = width;
		this.height = height;
		if (this.splitView) {
			this.splitView.layout(width);
			if (!this.didLayout) {
				this.resizeMargins();
			}
		} else {
			this.view.layout(width, height, 0, 0);
		}
		this.didLayout = true;
	}

	private resizeMargins(): void {
		if (!this.splitView) {
			return;
		}
		this.splitView.resizeView(0, this.state.leftMarginRatio * this.width);
		this.splitView.resizeView(2, this.state.rightMarginRatio * this.width);
	}

	isActive(): boolean {
		return !!this.splitView;
	}

	styles(style: ICenteredViewStyles): void {
		this.style = style;
		if (this.splitView && this.emptyViews) {
			this.splitView.style(this.style);
			this.emptyViews[0].element.style.backgroundColor = this.style.background.toString();
			this.emptyViews[1].element.style.backgroundColor = this.style.background.toString();
		}
	}

	activate(active: boolean): void {
		if (active === this.isActive()) {
			return;
		}

		if (active) {
			this.container.removeChild(this.view.element);
			this.splitView = new SplitView(this.container, {
				inverseAltBehavior: true,
				orientation: Orientation.HORIZONTAL,
				styles: this.style
			});
			this.splitView.orthogonalStartSash = this.boundarySashes.top;
			this.splitView.orthogonalEndSash = this.boundarySashes.bottom;

			this.splitViewDisposables.add(this.splitView.onDidSashChange(() => {
				if (this.splitView) {
					this.state.leftMarginRatio = this.splitView.getViewSize(0) / this.width;
					this.state.rightMarginRatio = this.splitView.getViewSize(2) / this.width;
				}
			}));
			this.splitViewDisposables.add(this.splitView.onDidSashReset(() => {
				this.state.leftMarginRatio = GOLDEN_RATIO.leftMarginRatio;
				this.state.rightMarginRatio = GOLDEN_RATIO.rightMarginRatio;
				this.resizeMargins();
			}));

			this.splitView.layout(this.width);
			this.splitView.addView(toSplitViewView(this.view, () => this.height), 0);
			const backgroundColor = this.style ? this.style.background : undefined;
			this.emptyViews = [createEmptyView(backgroundColor), createEmptyView(backgroundColor)];
			this.splitView.addView(this.emptyViews[0], this.state.leftMarginRatio * this.width, 0);
			this.splitView.addView(this.emptyViews[1], this.state.rightMarginRatio * this.width, 2);
		} else {
			if (this.splitView) {
				this.container.removeChild(this.splitView.el);
			}
			this.splitViewDisposables.clear();
			if (this.splitView) {
				this.splitView.dispose();
			}
			this.splitView = undefined;
			this.emptyViews = undefined;
			this.container.appendChild(this.view.element);
		}
	}

	isDefault(state: CenteredViewState): boolean {
		return state.leftMarginRatio === GOLDEN_RATIO.leftMarginRatio && state.rightMarginRatio === GOLDEN_RATIO.rightMarginRatio;
	}

	dispose(): void {
		this.splitViewDisposables.dispose();

		if (this.splitView) {
			this.splitView.dispose();
			this.splitView = undefined;
		}
	}
}
