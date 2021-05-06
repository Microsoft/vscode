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

export const enum ContextViewDOMPosition {
	ABSOLUTE = 1,
	FIXED,
	FIXED_SHADOW
}

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

export const enum AnchorAxisAlignment {
	VERTICAL, HORIZONTAL
}

export interface IDelegate {
	getAnchor(): HTMLElement | IAnchor;
	render(container: HTMLElement): IDisposable | null;
	focus?(): void;
	layout?(): void;
	anchorAlignment?: AnchorAlignment; // default: left
	anchorPosition?: AnchorPosition; // default: below
	anchorAxisAlignment?: AnchorAxisAlignment; // default: vertical
	canRelayout?: boolean; // default: true
	onDOMEvent?(e: Event, activeElement: HTMLElement): void;
	onHide?(data?: unknown): void;
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

export enum LayoutAnchorMode {
	AVOID,
	ALIGN
}

export interface ILayoutAnchor {
	offset: number;
	size: number;
	mode?: LayoutAnchorMode; // default: AVOID
	position: LayoutAnchorPosition;
}

/**
 * Lays out a one dimensional view next to an anchor in a viewport.
 *
 * @returns The view offset within the viewport.
 */
export function layout(viewportSize: number, viewSize: number, anchor: ILayoutAnchor): number {
	const layoutAfterAnchorBoundary = anchor.mode === LayoutAnchorMode.ALIGN ? anchor.offset : anchor.offset + anchor.size;
	const layoutBeforeAnchorBoundary = anchor.mode === LayoutAnchorMode.ALIGN ? anchor.offset + anchor.size : anchor.offset;

	if (anchor.position === LayoutAnchorPosition.Before) {
		if (viewSize <= viewportSize - layoutAfterAnchorBoundary) {
			return layoutAfterAnchorBoundary; // happy case, lay it out after the anchor
		}

		if (viewSize <= layoutBeforeAnchorBoundary) {
			return layoutBeforeAnchorBoundary - viewSize; // ok case, lay it out before the anchor
		}

		return Math.max(viewportSize - viewSize, 0); // sad case, lay it over the anchor
	} else {
		if (viewSize <= layoutBeforeAnchorBoundary) {
			return layoutBeforeAnchorBoundary - viewSize; // happy case, lay it out before the anchor
		}

		if (viewSize <= viewportSize - layoutAfterAnchorBoundary) {
			return layoutAfterAnchorBoundary; // ok case, lay it out after the anchor
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
	private useShadowDOM: boolean;
	private delegate: IDelegate | null = null;
	private toDisposeOnClean: IDisposable = Disposable.None;
	private toDisposeOnSetContainer: IDisposable = Disposable.None;
	private shadowRoot: ShadowRoot | null = null;
	private shadowRootHostElement: HTMLElement | null = null;

	constructor(container: HTMLElement, domPosition: ContextViewDOMPosition) {
		super();

		this.view = DOM.$('.context-view');
		this.useFixedPosition = false;
		this.useShadowDOM = false;

		DOM.hide(this.view);

		this.setContainer(container, domPosition);

		this._register(toDisposable(() => this.setContainer(null, ContextViewDOMPosition.ABSOLUTE)));
	}

	setContainer(container: HTMLElement | null, domPosition: ContextViewDOMPosition): void {
		if (this.container) {
			this.toDisposeOnSetContainer.dispose();

			if (this.shadowRoot) {
				this.shadowRoot.removeChild(this.view);
				this.shadowRoot = null;
				this.shadowRootHostElement?.remove();
				this.shadowRootHostElement = null;
			} else {
				this.container.removeChild(this.view);
			}

			this.container = null;
		}
		if (container) {
			this.container = container;

			this.useFixedPosition = domPosition !== ContextViewDOMPosition.ABSOLUTE;
			this.useShadowDOM = domPosition === ContextViewDOMPosition.FIXED_SHADOW;

			if (this.useShadowDOM) {
				this.shadowRootHostElement = DOM.$('.shadow-root-host');
				this.container.appendChild(this.shadowRootHostElement);
				this.shadowRoot = this.shadowRootHostElement.attachShadow({ mode: 'open' });
				const style = document.createElement('style');
				style.textContent = SHADOW_ROOT_CSS;
				this.shadowRoot.appendChild(style);
				this.shadowRoot.appendChild(this.view);
				this.shadowRoot.appendChild(DOM.$('slot'));
			} else {
				this.container.appendChild(this.view);
			}

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
		this.view.style.zIndex = '2500';
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

	getViewElement(): HTMLElement {
		return this.view;
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
		const anchorAxisAlignment = this.delegate!.anchorAxisAlignment || AnchorAxisAlignment.VERTICAL;

		let top: number;
		let left: number;

		if (anchorAxisAlignment === AnchorAxisAlignment.VERTICAL) {
			const verticalAnchor: ILayoutAnchor = { offset: around.top - window.pageYOffset, size: around.height, position: anchorPosition === AnchorPosition.BELOW ? LayoutAnchorPosition.Before : LayoutAnchorPosition.After };
			const horizontalAnchor: ILayoutAnchor = { offset: around.left, size: around.width, position: anchorAlignment === AnchorAlignment.LEFT ? LayoutAnchorPosition.Before : LayoutAnchorPosition.After, mode: LayoutAnchorMode.ALIGN };

			top = layout(window.innerHeight, viewSizeHeight, verticalAnchor) + window.pageYOffset;

			// if view intersects vertically with anchor,  we must avoid the anchor
			if (Range.intersects({ start: top, end: top + viewSizeHeight }, { start: verticalAnchor.offset, end: verticalAnchor.offset + verticalAnchor.size })) {
				horizontalAnchor.mode = LayoutAnchorMode.AVOID;
			}

			left = layout(window.innerWidth, viewSizeWidth, horizontalAnchor);
		} else {
			const horizontalAnchor: ILayoutAnchor = { offset: around.left, size: around.width, position: anchorAlignment === AnchorAlignment.LEFT ? LayoutAnchorPosition.Before : LayoutAnchorPosition.After };
			const verticalAnchor: ILayoutAnchor = { offset: around.top, size: around.height, position: anchorPosition === AnchorPosition.BELOW ? LayoutAnchorPosition.Before : LayoutAnchorPosition.After, mode: LayoutAnchorMode.ALIGN };

			left = layout(window.innerWidth, viewSizeWidth, horizontalAnchor);

			// if view intersects horizontally with anchor, we must avoid the anchor
			if (Range.intersects({ start: left, end: left + viewSizeWidth }, { start: horizontalAnchor.offset, end: horizontalAnchor.offset + horizontalAnchor.size })) {
				verticalAnchor.mode = LayoutAnchorMode.AVOID;
			}

			top = layout(window.innerHeight, viewSizeHeight, verticalAnchor) + window.pageYOffset;
		}

		this.view.classList.remove('top', 'bottom', 'left', 'right');
		this.view.classList.add(anchorPosition === AnchorPosition.BELOW ? 'bottom' : 'top');
		this.view.classList.add(anchorAlignment === AnchorAlignment.LEFT ? 'left' : 'right');
		this.view.classList.toggle('fixed', this.useFixedPosition);

		const containerPosition = DOM.getDomNodePagePosition(this.container!);
		this.view.style.top = `${top - (this.useFixedPosition ? DOM.getDomNodePagePosition(this.view).top : containerPosition.top)}px`;
		this.view.style.left = `${left - (this.useFixedPosition ? DOM.getDomNodePagePosition(this.view).left : containerPosition.left)}px`;
		this.view.style.width = 'initial';
	}

	hide(data?: unknown): void {
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

	override dispose(): void {
		this.hide();

		super.dispose();
	}
}

let SHADOW_ROOT_CSS = /* css */ `
	:host {
		all: initial; /* 1st rule so subsequent properties are reset. */
	}

	@font-face {
		font-family: "codicon";
		src: url("./codicon.ttf?5d4d76ab2ce5108968ad644d591a16a6") format("truetype");
	}

	.codicon[class*='codicon-'] {
		font: normal normal normal 16px/1 codicon;
		display: inline-block;
		text-decoration: none;
		text-rendering: auto;
		text-align: center;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		user-select: none;
		-webkit-user-select: none;
		-ms-user-select: none;
	}

	:host {
		font-family: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "HelveticaNeue-Light", system-ui, "Ubuntu", "Droid Sans", sans-serif;
	}

	:host-context(.mac) { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
	:host-context(.mac:lang(zh-Hans)) { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", sans-serif; }
	:host-context(.mac:lang(zh-Hant)) { font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", sans-serif; }
	:host-context(.mac:lang(ja)) { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic Pro", sans-serif; }
	:host-context(.mac:lang(ko)) { font-family: -apple-system, BlinkMacSystemFont, "Nanum Gothic", "Apple SD Gothic Neo", "AppleGothic", sans-serif; }

	:host-context(.windows) { font-family: "Segoe WPC", "Segoe UI", sans-serif; }
	:host-context(.windows:lang(zh-Hans)) { font-family: "Segoe WPC", "Segoe UI", "Microsoft YaHei", sans-serif; }
	:host-context(.windows:lang(zh-Hant)) { font-family: "Segoe WPC", "Segoe UI", "Microsoft Jhenghei", sans-serif; }
	:host-context(.windows:lang(ja)) { font-family: "Segoe WPC", "Segoe UI", "Yu Gothic UI", "Meiryo UI", sans-serif; }
	:host-context(.windows:lang(ko)) { font-family: "Segoe WPC", "Segoe UI", "Malgun Gothic", "Dotom", sans-serif; }

	:host-context(.linux) { font-family: system-ui, "Ubuntu", "Droid Sans", sans-serif; }
	:host-context(.linux:lang(zh-Hans)) { font-family: system-ui, "Ubuntu", "Droid Sans", "Source Han Sans SC", "Source Han Sans CN", "Source Han Sans", sans-serif; }
	:host-context(.linux:lang(zh-Hant)) { font-family: system-ui, "Ubuntu", "Droid Sans", "Source Han Sans TC", "Source Han Sans TW", "Source Han Sans", sans-serif; }
	:host-context(.linux:lang(ja)) { font-family: system-ui, "Ubuntu", "Droid Sans", "Source Han Sans J", "Source Han Sans JP", "Source Han Sans", sans-serif; }
	:host-context(.linux:lang(ko)) { font-family: system-ui, "Ubuntu", "Droid Sans", "Source Han Sans K", "Source Han Sans JR", "Source Han Sans", "UnDotum", "FBaekmuk Gulim", sans-serif; }
`;
