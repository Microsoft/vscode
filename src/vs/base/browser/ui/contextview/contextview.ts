/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./contextview';
import * as DOM from 'vs/base/browser/dom';
import * as platform from 'vs/base/common/platform';
import { IDisposable, toDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Range } from 'vs/base/common/range';
import { BrowserFeatures } from 'vs/base/browser/canIUse';

export interface IAnchor {
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export const enum AnchorAlignment {
	LEFT, RIGHT
}

export const enum AnchorPosition {
	BELOW, ABOVE
}

export interface IDelegate {
	getAnchor(): HTMLElement | IAnchor;
	render(container: HTMLElement): IDisposable | null;
	focus?(): void;
	layout?(): void;
	anchorAlignment?: AnchorAlignment; // default: left
	anchorPosition?: AnchorPosition; // default: below
	canRelayout?: boolean; // default: true
	onDOMEvent?(e: Event, activeElement: HTMLElement): void;
	onHide?(data?: any): void;
}

export interface IContextViewProvider {
	showContextView(delegate: IDelegate, container?: HTMLElement): void;
	hideContextView(): void;
	layout(): void;
}

export interface IPosition {
	top: number;
	left: number;
}

export interface ISize {
	width: number;
	height: number;
}

export interface IView extends IPosition, ISize { }

export const enum LayoutAnchorPosition {
	Before,
	After
}

export interface ILayoutAnchor {
	offset: number;
	size: number;
	position: LayoutAnchorPosition;
}

/**
 * Lays out a one dimensional view next to an anchor in a viewport.
 *
 * @returns The view offset within the viewport.
 */
export function layout(viewportSize: number, viewSize: number, anchor: ILayoutAnchor): number {
	const anchorEnd = anchor.offset + anchor.size;

	if (anchor.position === LayoutAnchorPosition.Before) {
		if (viewSize <= viewportSize - anchorEnd) {
			return anchorEnd; // happy case, lay it out after the anchor
		}

		if (viewSize <= anchor.offset) {
			return anchor.offset - viewSize; // ok case, lay it out before the anchor
		}

		return Math.max(viewportSize - viewSize, 0); // sad case, lay it over the anchor
	} else {
		if (viewSize <= anchor.offset) {
			return anchor.offset - viewSize; // happy case, lay it out before the anchor
		}

		if (viewSize <= viewportSize - anchorEnd) {
			return anchorEnd; // ok case, lay it out after the anchor
		}

		return 0; // sad case, lay it over the anchor
	}
}

export class ContextView extends Disposable {

	private static readonly BUBBLE_UP_EVENTS = ['click', 'keydown', 'focus', 'blur'];
	private static readonly BUBBLE_DOWN_EVENTS = ['click'];

	private container: HTMLElement | null = null;
	private view: HTMLElement;
	private useFixedPosition: boolean;
	private delegate: IDelegate | null = null;
	private toDisposeOnClean: IDisposable = Disposable.None;
	private toDisposeOnSetContainer: IDisposable = Disposable.None;

	constructor(container: HTMLElement, useFixedPosition: boolean) {
		super();

		this.view = DOM.$('.context-view');
		this.useFixedPosition = false;

		DOM.hide(this.view);

		this.setContainer(container, useFixedPosition);

		this._register(toDisposable(() => this.setContainer(null, false)));
	}

	setContainer(container: HTMLElement | null, useFixedPosition: boolean): void {
		if (this.container) {
			this.toDisposeOnSetContainer.dispose();
			this.container.removeChild(this.view);
			this.container = null;
		}
		if (container) {
			this.container = container;
			this.container.appendChild(this.view);

			const toDisposeOnSetContainer = new DisposableStore();

			ContextView.BUBBLE_UP_EVENTS.forEach(event => {
				toDisposeOnSetContainer.add(DOM.addStandardDisposableListener(this.container!, event, (e: Event) => {
					this.onDOMEvent(e, false);
				}));
			});

			ContextView.BUBBLE_DOWN_EVENTS.forEach(event => {
				toDisposeOnSetContainer.add(DOM.addStandardDisposableListener(this.container!, event, (e: Event) => {
					this.onDOMEvent(e, true);
				}, true));
			});

			this.toDisposeOnSetContainer = toDisposeOnSetContainer;
		}

		this.useFixedPosition = useFixedPosition;
	}

	show(delegate: IDelegate): void {
		if (this.isVisible()) {
			this.hide();
		}

		// Show static box
		DOM.clearNode(this.view);
		this.view.className = 'context-view';
		this.view.style.top = '0px';
		this.view.style.left = '0px';
		this.view.style.position = this.useFixedPosition ? 'fixed' : 'absolute';
		DOM.show(this.view);

		// Render content
		this.toDisposeOnClean = delegate.render(this.view) || Disposable.None;

		// Set active delegate
		this.delegate = delegate;

		// Layout
		this.doLayout();

		// Focus
		if (this.delegate.focus) {
			this.delegate.focus();
		}
	}

	layout(): void {
		if (!this.isVisible()) {
			return;
		}

		if (this.delegate!.canRelayout === false && !(platform.isIOS && BrowserFeatures.pointerEvents)) {
			this.hide();
			return;
		}

		if (this.delegate!.layout) {
			this.delegate!.layout!();
		}

		this.doLayout();
	}

	private doLayout(): void {
		// Check that we still have a delegate - this.delegate.layout may have hidden
		if (!this.isVisible()) {
			return;
		}

		// Get anchor
		let anchor = this.delegate!.getAnchor();

		// Compute around
		let around: IView;

		// Get the element's position and size (to anchor the view)
		if (DOM.isHTMLElement(anchor)) {
			let elementPosition = DOM.getDomNodePagePosition(anchor);

			around = {
				top: elementPosition.top,
				left: elementPosition.left,
				width: elementPosition.width,
				height: elementPosition.height
			};
		} else {
			around = {
				top: anchor.y,
				left: anchor.x,
				width: anchor.width || 1,
				height: anchor.height || 2
			};
		}

		const viewSizeWidth = DOM.getTotalWidth(this.view);
		const viewSizeHeight = DOM.getTotalHeight(this.view);

		const anchorPosition = this.delegate!.anchorPosition || AnchorPosition.BELOW;
		const anchorAlignment = this.delegate!.anchorAlignment || AnchorAlignment.LEFT;

		const verticalAnchor: ILayoutAnchor = { offset: around.top - window.pageYOffset, size: around.height, position: anchorPosition === AnchorPosition.BELOW ? LayoutAnchorPosition.Before : LayoutAnchorPosition.After };

		let horizontalAnchor: ILayoutAnchor;

		if (anchorAlignment === AnchorAlignment.LEFT) {
			horizontalAnchor = { offset: around.left, size: 0, position: LayoutAnchorPosition.Before };
		} else {
			horizontalAnchor = { offset: around.left + around.width, size: 0, position: LayoutAnchorPosition.After };
		}

		const top = layout(window.innerHeight, viewSizeHeight, verticalAnchor) + window.pageYOffset;

		// if view intersects vertically with anchor, shift it horizontally
		if (Range.intersects({ start: top, end: top + viewSizeHeight }, { start: verticalAnchor.offset, end: verticalAnchor.offset + verticalAnchor.size })) {
			horizontalAnchor.size = around.width;
			if (anchorAlignment === AnchorAlignment.RIGHT) {
				horizontalAnchor.offset = around.left;
			}
		}

		const left = layout(window.innerWidth, viewSizeWidth, horizontalAnchor);

		DOM.removeClasses(this.view, 'top', 'bottom', 'left', 'right');
		DOM.addClass(this.view, anchorPosition === AnchorPosition.BELOW ? 'bottom' : 'top');
		DOM.addClass(this.view, anchorAlignment === AnchorAlignment.LEFT ? 'left' : 'right');
		DOM.toggleClass(this.view, 'fixed', this.useFixedPosition);

		const containerPosition = DOM.getDomNodePagePosition(this.container!);
		this.view.style.top = `${top - (this.useFixedPosition ? DOM.getDomNodePagePosition(this.view).top : containerPosition.top)}px`;
		this.view.style.left = `${left - (this.useFixedPosition ? DOM.getDomNodePagePosition(this.view).left : containerPosition.left)}px`;
		this.view.style.width = 'initial';
	}

	hide(data?: any): void {
		const delegate = this.delegate;
		this.delegate = null;

		if (delegate?.onHide) {
			delegate.onHide(data);
		}

		this.toDisposeOnClean.dispose();

		DOM.hide(this.view);
	}

	private isVisible(): boolean {
		return !!this.delegate;
	}

	private onDOMEvent(e: Event, onCapture: boolean): void {
		if (this.delegate) {
			if (this.delegate.onDOMEvent) {
				this.delegate.onDOMEvent(e, <HTMLElement>document.activeElement);
			} else if (onCapture && !DOM.isAncestor(<HTMLElement>e.target, this.container)) {
				this.hide();
			}
		}
	}

	dispose(): void {
		this.hide();

		super.dispose();
	}
}
