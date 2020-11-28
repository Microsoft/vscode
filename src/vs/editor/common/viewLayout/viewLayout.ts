/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IScrollPosition, ScrollEvent, Scrollable, ScrollbarVisibility, INewScrollPosition } from 'vs/base/common/scrollable';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { IConfiguration, ScrollType } from 'vs/editor/common/editorCommon';
import { LinesLayout, IEditorWhitespace, IWhitespaceChangeAccessor } from 'vs/editor/common/viewLayout/linesLayout';
import { IPartialViewLinesViewportData } from 'vs/editor/common/viewLayout/viewLinesViewportData';
import { IViewLayout, IViewWhitespaceViewportData, Viewport } from 'vs/editor/common/viewModel/viewModel';
import { ContentSizeChangedEvent } from 'vs/editor/common/viewModel/viewModelEventDispatcher';

const SMOOTH_SCROLLING_TIME = 125;

class EditorScrollDimensions {

	public readonly width: number;
	public readonly contentWidth: number;
	public readonly scrollWidth: number;

	public readonly height: number;
	public readonly contentHeight: number;
	public readonly scrollHeight: number;

	constructor(
		width: number,
		contentWidth: number,
		height: number,
		contentHeight: number,
	) {
		width = width | 0;
		contentWidth = contentWidth | 0;
		height = height | 0;
		contentHeight = contentHeight | 0;

		if (width < 0) {
			width = 0;
		}
		if (contentWidth < 0) {
			contentWidth = 0;
		}

		if (height < 0) {
			height = 0;
		}
		if (contentHeight < 0) {
			contentHeight = 0;
		}

		this.width = width;
		this.contentWidth = contentWidth;
		this.scrollWidth = Math.max(width, contentWidth);

		this.height = height;
		this.contentHeight = contentHeight;
		this.scrollHeight = Math.max(height, contentHeight);
	}

	public equals(other: EditorScrollDimensions): boolean {
		return (
			this.width === other.width
			&& this.contentWidth === other.contentWidth
			&& this.height === other.height
			&& this.contentHeight === other.contentHeight
		);
	}
}

class EditorScrollable extends Disposable {

	private readonly _scrollable: Scrollable;
	private _dimensions: EditorScrollDimensions;

	public readonly onDidScroll: Event<ScrollEvent>;

	private readonly _onDidContentSizeChange = this._register(new Emitter<ContentSizeChangedEvent>());
	public readonly onDidContentSizeChange: Event<ContentSizeChangedEvent> = this._onDidContentSizeChange.event;

	constructor(smoothScrollDuration: number, scheduleAtNextAnimationFrame: (callback: () => void) => IDisposable) {
		super();
		this._dimensions = new EditorScrollDimensions(0, 0, 0, 0);
		this._scrollable = this._register(new Scrollable(smoothScrollDuration, scheduleAtNextAnimationFrame));
		this.onDidScroll = this._scrollable.onScroll;
	}

	public getScrollable(): Scrollable {
		return this._scrollable;
	}

	public setSmoothScrollDuration(smoothScrollDuration: number): void {
		this._scrollable.setSmoothScrollDuration(smoothScrollDuration);
	}

	public validateScrollPosition(scrollPosition: INewScrollPosition): IScrollPosition {
		return this._scrollable.validateScrollPosition(scrollPosition);
	}

	public getScrollDimensions(): EditorScrollDimensions {
		return this._dimensions;
	}

	public setScrollDimensions(dimensions: EditorScrollDimensions): void {
		if (this._dimensions.equals(dimensions)) {
			return;
		}

		const oldDimensions = this._dimensions;
		this._dimensions = dimensions;

		this._scrollable.setScrollDimensions({
			width: dimensions.width,
			scrollWidth: dimensions.scrollWidth,
			height: dimensions.height,
			scrollHeight: dimensions.scrollHeight
		}, true);

		const contentWidthChanged = (oldDimensions.contentWidth !== dimensions.contentWidth);
		const contentHeightChanged = (oldDimensions.contentHeight !== dimensions.contentHeight);
		if (contentWidthChanged || contentHeightChanged) {
			this._onDidContentSizeChange.fire(new ContentSizeChangedEvent(
				oldDimensions.contentWidth, oldDimensions.contentHeight,
				dimensions.contentWidth, dimensions.contentHeight
			));
		}
	}

	public getFutureScrollPosition(): IScrollPosition {
		return this._scrollable.getFutureScrollPosition();
	}

	public getCurrentScrollPosition(): IScrollPosition {
		return this._scrollable.getCurrentScrollPosition();
	}

	public setScrollPositionNow(update: INewScrollPosition): void {
		this._scrollable.setScrollPositionNow(update);
	}

	public setScrollPositionSmooth(update: INewScrollPosition): void {
		this._scrollable.setScrollPositionSmooth(update);
	}
}

export class ViewLayout extends Disposable implements IViewLayout {

	private readonly _configuration: IConfiguration;
	private readonly _linesLayout: LinesLayout;

	private readonly _scrollable: EditorScrollable;
	public readonly onDidScroll: Event<ScrollEvent>;
	public readonly onDidContentSizeChange: Event<ContentSizeChangedEvent>;

	constructor(configuration: IConfiguration, lineCount: number, scheduleAtNextAnimationFrame: (callback: () => void) => IDisposable) {
		super();

		this._configuration = configuration;
		const options = this._configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);
		const padding = options.get(EditorOption.padding);

		this._linesLayout = new LinesLayout(lineCount, options.get(EditorOption.lineHeight), padding.top, padding.bottom);

		this._scrollable = this._register(new EditorScrollable(0, scheduleAtNextAnimationFrame));
		this._configureSmoothScrollDuration();

		this._scrollable.setScrollDimensions(new EditorScrollDimensions(
			layoutInfo.contentWidth,
			0,
			layoutInfo.height,
			0
		));
		this.onDidScroll = this._scrollable.onDidScroll;
		this.onDidContentSizeChange = this._scrollable.onDidContentSizeChange;

		this._updateHeight();
	}

	public dispose(): void {
		super.dispose();
	}

	public getScrollable(): Scrollable {
		return this._scrollable.getScrollable();
	}

	public onHeightMaybeChanged(): void {
		this._updateHeight();
	}

	private _configureSmoothScrollDuration(): void {
		this._scrollable.setSmoothScrollDuration(this._configuration.options.get(EditorOption.smoothScrolling) ? SMOOTH_SCROLLING_TIME : 0);
	}

	// ---- begin view event handlers

	public onConfigurationChanged(e: ConfigurationChangedEvent): void {
		const options = this._configuration.options;
		if (e.hasChanged(EditorOption.lineHeight)) {
			this._linesLayout.setLineHeight(options.get(EditorOption.lineHeight));
		}
		if (e.hasChanged(EditorOption.padding)) {
			const padding = options.get(EditorOption.padding);
			this._linesLayout.setPadding(padding.top, padding.bottom);
		}
		if (e.hasChanged(EditorOption.layoutInfo)) {
			const layoutInfo = options.get(EditorOption.layoutInfo);
			const width = layoutInfo.contentWidth;
			const height = layoutInfo.height;
			const scrollDimensions = this._scrollable.getScrollDimensions();
			const contentWidth = scrollDimensions.contentWidth;
			this._scrollable.setScrollDimensions(new EditorScrollDimensions(
				width,
				scrollDimensions.contentWidth,
				height,
				this._getContentHeight(width, height, contentWidth)
			));
		} else {
			this._updateHeight();
		}
		if (e.hasChanged(EditorOption.smoothScrolling)) {
			this._configureSmoothScrollDuration();
		}
	}
	public onFlushed(lineCount: number): void {
		this._linesLayout.onFlushed(lineCount);
	}
	public onLinesDeleted(fromLineNumber: number, toLineNumber: number): void {
		this._linesLayout.onLinesDeleted(fromLineNumber, toLineNumber);
	}
	public onLinesInserted(fromLineNumber: number, toLineNumber: number): void {
		this._linesLayout.onLinesInserted(fromLineNumber, toLineNumber);
	}

	// ---- end view event handlers

	private _getHorizontalScrollbarHeight(width: number, scrollWidth: number): number {
		const options = this._configuration.options;
		const scrollbar = options.get(EditorOption.scrollbar);
		if (scrollbar.horizontal === ScrollbarVisibility.Hidden) {
			// horizontal scrollbar not visible
			return 0;
		}
		if (width >= scrollWidth) {
			// horizontal scrollbar not visible
			return 0;
		}
		return scrollbar.horizontalScrollbarSize;
	}

	private _getContentHeight(width: number, height: number, contentWidth: number): number {
		const options = this._configuration.options;

		let result = this._linesLayout.getLinesTotalHeight();
		if (options.get(EditorOption.scrollBeyondLastLine)) {
			result += height - options.get(EditorOption.lineHeight);
		} else {
			result += this._getHorizontalScrollbarHeight(width, contentWidth);
		}

		return result;
	}

	private _updateHeight(): void {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		const width = scrollDimensions.width;
		const height = scrollDimensions.height;
		const contentWidth = scrollDimensions.contentWidth;
		this._scrollable.setScrollDimensions(new EditorScrollDimensions(
			width,
			scrollDimensions.contentWidth,
			height,
			this._getContentHeight(width, height, contentWidth)
		));
	}

	// ---- Layouting logic

	public getCurrentViewport(): Viewport {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		const currentScrollPosition = this._scrollable.getCurrentScrollPosition();
		return new Viewport(
			currentScrollPosition.scrollTop,
			currentScrollPosition.scrollLeft,
			scrollDimensions.width,
			scrollDimensions.height
		);
	}

	public getFutureViewport(): Viewport {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		const currentScrollPosition = this._scrollable.getFutureScrollPosition();
		return new Viewport(
			currentScrollPosition.scrollTop,
			currentScrollPosition.scrollLeft,
			scrollDimensions.width,
			scrollDimensions.height
		);
	}

	private _computeContentWidth(maxLineWidth: number): number {
		const options = this._configuration.options;
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		const fontInfo = options.get(EditorOption.fontInfo);
		if (wrappingInfo.isViewportWrapping) {
			const layoutInfo = options.get(EditorOption.layoutInfo);
			const minimap = options.get(EditorOption.minimap);
			if (maxLineWidth > layoutInfo.contentWidth + fontInfo.typicalHalfwidthCharacterWidth) {
				// This is a case where viewport wrapping is on, but the line extends above the viewport
				if (minimap.enabled && minimap.side === 'right') {
					// We need to accomodate the scrollbar width
					return maxLineWidth + layoutInfo.verticalScrollbarWidth;
				}
			}
			return maxLineWidth;
		} else {
			const extraHorizontalSpace = options.get(EditorOption.scrollBeyondLastColumn) * fontInfo.typicalHalfwidthCharacterWidth;
			const whitespaceMinWidth = this._linesLayout.getWhitespaceMinWidth();
			return Math.max(maxLineWidth + extraHorizontalSpace, whitespaceMinWidth);
		}
	}

	public setMaxLineWidth(maxLineWidth: number): void {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		// const newScrollWidth = ;
		this._scrollable.setScrollDimensions(new EditorScrollDimensions(
			scrollDimensions.width,
			this._computeContentWidth(maxLineWidth),
			scrollDimensions.height,
			scrollDimensions.contentHeight
		));

		// The height might depend on the fact that there is a horizontal scrollbar or not
		this._updateHeight();
	}

	// ---- view state

	public saveState(): { scrollTop: number; scrollTopWithoutViewZones: number; scrollLeft: number; } {
		const currentScrollPosition = this._scrollable.getFutureScrollPosition();
		let scrollTop = currentScrollPosition.scrollTop;
		let firstLineNumberInViewport = this._linesLayout.getLineNumberAtOrAfterVerticalOffset(scrollTop);
		let whitespaceAboveFirstLine = this._linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(firstLineNumberInViewport);
		return {
			scrollTop: scrollTop,
			scrollTopWithoutViewZones: scrollTop - whitespaceAboveFirstLine,
			scrollLeft: currentScrollPosition.scrollLeft
		};
	}

	// ---- IVerticalLayoutProvider
	public changeWhitespace(callback: (accessor: IWhitespaceChangeAccessor) => void): boolean {
		const hadAChange = this._linesLayout.changeWhitespace(callback);
		if (hadAChange) {
			this.onHeightMaybeChanged();
		}
		return hadAChange;
	}
	public getVerticalOffsetForLineNumber(lineNumber: number): number {
		return this._linesLayout.getVerticalOffsetForLineNumber(lineNumber);
	}
	public isAfterLines(verticalOffset: number): boolean {
		return this._linesLayout.isAfterLines(verticalOffset);
	}
	public isInTopPadding(verticalOffset: number): boolean {
		return this._linesLayout.isInTopPadding(verticalOffset);
	}
	isInBottomPadding(verticalOffset: number): boolean {
		return this._linesLayout.isInBottomPadding(verticalOffset);
	}

	public getLineNumberAtVerticalOffset(verticalOffset: number): number {
		return this._linesLayout.getLineNumberAtOrAfterVerticalOffset(verticalOffset);
	}

	public getWhitespaceAtVerticalOffset(verticalOffset: number): IViewWhitespaceViewportData | null {
		return this._linesLayout.getWhitespaceAtVerticalOffset(verticalOffset);
	}
	public getLinesViewportData(): IPartialViewLinesViewportData {
		const visibleBox = this.getCurrentViewport();
		return this._linesLayout.getLinesViewportData(visibleBox.top, visibleBox.top + visibleBox.height);
	}
	public getLinesViewportDataAtScrollTop(scrollTop: number): IPartialViewLinesViewportData {
		// do some minimal validations on scrollTop
		const scrollDimensions = this._scrollable.getScrollDimensions();
		if (scrollTop + scrollDimensions.height > scrollDimensions.scrollHeight) {
			scrollTop = scrollDimensions.scrollHeight - scrollDimensions.height;
		}
		if (scrollTop < 0) {
			scrollTop = 0;
		}
		return this._linesLayout.getLinesViewportData(scrollTop, scrollTop + scrollDimensions.height);
	}
	public getWhitespaceViewportData(): IViewWhitespaceViewportData[] {
		const visibleBox = this.getCurrentViewport();
		return this._linesLayout.getWhitespaceViewportData(visibleBox.top, visibleBox.top + visibleBox.height);
	}
	public getWhitespaces(): IEditorWhitespace[] {
		return this._linesLayout.getWhitespaces();
	}

	// ---- IScrollingProvider

	public getContentWidth(): number {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		return scrollDimensions.contentWidth;
	}
	public getScrollWidth(): number {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		return scrollDimensions.scrollWidth;
	}
	public getContentHeight(): number {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		return scrollDimensions.contentHeight;
	}
	public getScrollHeight(): number {
		const scrollDimensions = this._scrollable.getScrollDimensions();
		return scrollDimensions.scrollHeight;
	}

	public getCurrentScrollLeft(): number {
		const currentScrollPosition = this._scrollable.getCurrentScrollPosition();
		return currentScrollPosition.scrollLeft;
	}
	public getCurrentScrollTop(): number {
		const currentScrollPosition = this._scrollable.getCurrentScrollPosition();
		return currentScrollPosition.scrollTop;
	}

	public validateScrollPosition(scrollPosition: INewScrollPosition): IScrollPosition {
		return this._scrollable.validateScrollPosition(scrollPosition);
	}

	public setScrollPosition(position: INewScrollPosition, type: ScrollType): void {
		if (type === ScrollType.Immediate) {
			this._scrollable.setScrollPositionNow(position);
		} else {
			this._scrollable.setScrollPositionSmooth(position);
		}
	}

	public deltaScrollNow(deltaScrollLeft: number, deltaScrollTop: number): void {
		const currentScrollPosition = this._scrollable.getCurrentScrollPosition();
		this._scrollable.setScrollPositionNow({
			scrollLeft: currentScrollPosition.scrollLeft + deltaScrollLeft,
			scrollTop: currentScrollPosition.scrollTop + deltaScrollTop
		});
	}
}
