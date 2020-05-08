/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StandardWheelEvent } from 'vs/base/browser/mouseEvent';
import { AbstractScrollbar, ISimplifiedMouseEvent, ScrollbarHost } from 'vs/base/browser/ui/scrollbar/abstractScrollbar';
import { ScrollableElementResolvedOptions } from 'vs/base/browser/ui/scrollbar/scrollableElementOptions';
import { ARROW_IMG_SIZE } from 'vs/base/browser/ui/scrollbar/scrollbarArrow';
import { ScrollbarState } from 'vs/base/browser/ui/scrollbar/scrollbarState';
import { INewScrollPosition, ScrollEvent, Scrollable, ScrollbarVisibility } from 'vs/base/common/scrollable';
import { Codicon, registerIcon } from 'vs/base/common/codicons';

const scrollbarButtonUpIcon = registerIcon('scrollbar-button-up', Codicon.triangleUp);
const scrollbarButtonDownIcon = registerIcon('scrollbar-button-down', Codicon.triangleDown);

export class VerticalScrollbar extends AbstractScrollbar {

	constructor(scrollable: Scrollable, options: ScrollableElementResolvedOptions, host: ScrollbarHost) {
		const scrollDimensions = scrollable.getScrollDimensions();
		const scrollPosition = scrollable.getCurrentScrollPosition();
		super({
			lazyRender: options.lazyRender,
			host: host,
			scrollbarState: new ScrollbarState(
				(options.verticalHasArrows ? options.arrowSize : 0),
				(options.vertical === ScrollbarVisibility.Hidden ? 0 : options.verticalScrollbarSize),
				// give priority to vertical scroll bar over horizontal and let it scroll all the way to the bottom
				0,
				scrollDimensions.height,
				scrollDimensions.scrollHeight,
				scrollPosition.scrollTop
			),
			visibility: options.vertical,
			extraScrollbarClassName: 'vertical',
			scrollable: scrollable
		});

		if (options.verticalHasArrows) {
			let arrowDelta = (options.arrowSize - ARROW_IMG_SIZE) / 2;
			let scrollbarDelta = (options.verticalScrollbarSize - ARROW_IMG_SIZE) / 2;

			this._createArrow({
				className: 'scra',
				icon: scrollbarButtonUpIcon,
				top: arrowDelta,
				left: scrollbarDelta,
				bottom: undefined,
				right: undefined,
				bgWidth: options.verticalScrollbarSize,
				bgHeight: options.arrowSize,
				onActivate: () => this._host.onMouseWheel(new StandardWheelEvent(null, 0, 1)),
			});

			this._createArrow({
				className: 'scra',
				icon: scrollbarButtonDownIcon,
				top: undefined,
				left: scrollbarDelta,
				bottom: arrowDelta,
				right: undefined,
				bgWidth: options.verticalScrollbarSize,
				bgHeight: options.arrowSize,
				onActivate: () => this._host.onMouseWheel(new StandardWheelEvent(null, 0, -1)),
			});
		}

		this._createSlider(0, Math.floor((options.verticalScrollbarSize - options.verticalSliderSize) / 2), options.verticalSliderSize, undefined);
	}

	protected _updateSlider(sliderSize: number, sliderPosition: number): void {
		this.slider.setHeight(sliderSize);
		this.slider.setTop(sliderPosition);
	}

	protected _renderDomNode(largeSize: number, smallSize: number): void {
		this.domNode.setWidth(smallSize);
		this.domNode.setHeight(largeSize);
		this.domNode.setRight(0);
		this.domNode.setTop(0);
	}

	public onDidScroll(e: ScrollEvent): boolean {
		this._shouldRender = this._onElementScrollSize(e.scrollHeight) || this._shouldRender;
		this._shouldRender = this._onElementScrollPosition(e.scrollTop) || this._shouldRender;
		this._shouldRender = this._onElementSize(e.height) || this._shouldRender;
		return this._shouldRender;
	}

	protected _mouseDownRelativePosition(offsetX: number, offsetY: number): number {
		return offsetY;
	}

	protected _sliderMousePosition(e: ISimplifiedMouseEvent): number {
		return e.posy;
	}

	protected _sliderOrthogonalMousePosition(e: ISimplifiedMouseEvent): number {
		return e.posx;
	}

	protected _updateScrollbarSize(size: number): void {
		this.slider.setWidth(size);
	}

	public writeScrollPosition(target: INewScrollPosition, scrollPosition: number): void {
		target.scrollTop = scrollPosition;
	}
}
