/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./viewLines';
import * as platform from 'vs/base/common/platform';
import { FastDomNode } from 'vs/base/browser/fastDomNode';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Configuration } from 'vs/editor/browser/config/configuration';
import { IVisibleLinesHost, VisibleLinesCollection } from 'vs/editor/browser/view/viewLayer';
import { PartFingerprint, PartFingerprints, ViewPart } from 'vs/editor/browser/view/viewPart';
import { DomReadingContext, ViewLine, ViewLineOptions } from 'vs/editor/browser/viewParts/lines/viewLine';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { IViewLines, LineVisibleRanges, VisibleRanges, HorizontalPosition } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { ViewportData } from 'vs/editor/common/viewLayout/viewLinesViewportData';
import { Viewport } from 'vs/editor/common/viewModel/viewModel';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Constants } from 'vs/base/common/uint';
import { MOUSE_CURSOR_TEXT_CSS_CLASS_NAME } from 'vs/base/browser/ui/mouseCursor/mouseCursor';

class LastRenderedData {

	private _currentVisibleRange: Range;

	constructor() {
		this._currentVisibleRange = new Range(1, 1, 1, 1);
	}

	public getCurrentVisibleRange(): Range {
		return this._currentVisibleRange;
	}

	public setCurrentVisibleRange(currentVisibleRange: Range): void {
		this._currentVisibleRange = currentVisibleRange;
	}
}

class HorizontalRevealRangeRequest {
	public readonly type = 'range';
	public readonly minLineNumber: number;
	public readonly maxLineNumber: number;

	constructor(
		public readonly lineNumber: number,
		public readonly startColumn: number,
		public readonly endColumn: number,
		public readonly startScrollTop: number,
		public readonly stopScrollTop: number,
		public readonly scrollType: ScrollType
	) {
		this.minLineNumber = lineNumber;
		this.maxLineNumber = lineNumber;
	}
}

class HorizontalRevealSelectionsRequest {
	public readonly type = 'selections';
	public readonly minLineNumber: number;
	public readonly maxLineNumber: number;

	constructor(
		public readonly selections: Selection[],
		public readonly startScrollTop: number,
		public readonly stopScrollTop: number,
		public readonly scrollType: ScrollType
	) {
		let minLineNumber = selections[0].startLineNumber;
		let maxLineNumber = selections[0].endLineNumber;
		for (let i = 1, len = selections.length; i < len; i++) {
			const selection = selections[i];
			minLineNumber = Math.min(minLineNumber, selection.startLineNumber);
			maxLineNumber = Math.max(maxLineNumber, selection.endLineNumber);
		}
		this.minLineNumber = minLineNumber;
		this.maxLineNumber = maxLineNumber;
	}
}

type HorizontalRevealRequest = HorizontalRevealRangeRequest | HorizontalRevealSelectionsRequest;

export class ViewLines extends ViewPart implements IVisibleLinesHost<ViewLine>, IViewLines {
	/**
	 * Adds this amount of pixels to the right of lines (no-one wants to type near the edge of the viewport)
	 */
	private static readonly HORIZONTAL_EXTRA_PX = 30;

	private readonly _linesContent: FastDomNode<HTMLElement>;
	private readonly _textRangeRestingSpot: HTMLElement;
	private readonly _visibleLines: VisibleLinesCollection<ViewLine>;
	private readonly domNode: FastDomNode<HTMLElement>;

	// --- config
	private _lineHeight: number;
	private _typicalHalfwidthCharacterWidth: number;
	private _isViewportWrapping: boolean;
	private _revealHorizontalRightPadding: number;
	private _cursorSurroundingLines: number;
	private _cursorSurroundingLinesStyle: 'default' | 'all';
	private _canUseLayerHinting: boolean;
	private _viewLineOptions: ViewLineOptions;

	// --- width
	private _maxLineWidth: number;
	private readonly _asyncUpdateLineWidths: RunOnceScheduler;
	private readonly _asyncCheckMonospaceFontAssumptions: RunOnceScheduler;

	private _horizontalRevealRequest: HorizontalRevealRequest | null;
	private readonly _lastRenderedData: LastRenderedData;

	constructor(context: ViewContext, linesContent: FastDomNode<HTMLElement>) {
		super(context);
		this._linesContent = linesContent;
		this._textRangeRestingSpot = document.createElement('div');
		this._visibleLines = new VisibleLinesCollection(this);
		this.domNode = this._visibleLines.domNode;

		const conf = this._context.configuration;
		const options = this._context.configuration.options;
		const fontInfo = options.get(EditorOption.fontInfo);
		const wrappingInfo = options.get(EditorOption.wrappingInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._typicalHalfwidthCharacterWidth = fontInfo.typicalHalfwidthCharacterWidth;
		this._isViewportWrapping = wrappingInfo.isViewportWrapping;
		this._revealHorizontalRightPadding = options.get(EditorOption.revealHorizontalRightPadding);
		this._cursorSurroundingLines = options.get(EditorOption.cursorSurroundingLines);
		this._cursorSurroundingLinesStyle = options.get(EditorOption.cursorSurroundingLinesStyle);
		this._canUseLayerHinting = !options.get(EditorOption.disableLayerHinting);
		this._viewLineOptions = new ViewLineOptions(conf, this._context.theme.type);

		PartFingerprints.write(this.domNode, PartFingerprint.ViewLines);
		this.domNode.setClassName(`view-lines ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`);
		Configuration.applyFontInfo(this.domNode, fontInfo);

		// --- width & height
		this._maxLineWidth = 0;
		this._asyncUpdateLineWidths = new RunOnceScheduler(() => {
			this._updateLineWidthsSlow();
		}, 200);
		this._asyncCheckMonospaceFontAssumptions = new RunOnceScheduler(() => {
			this._checkMonospaceFontAssumptions();
		}, 2000);

		this._lastRenderedData = new LastRenderedData();

		this._horizontalRevealRequest = null;
	}

	public dispose(): void {
		this._asyncUpdateLineWidths.dispose();
		this._asyncCheckMonospaceFontAssumptions.dispose();
		super.dispose();
	}

	public getDomNode(): FastDomNode<HTMLElement> {
		return this.domNode;
	}

	// ---- begin IVisibleLinesHost

	public createVisibleLine(): ViewLine {
		return new ViewLine(this._viewLineOptions);
	}

	// ---- end IVisibleLinesHost

	// ---- begin view event handlers

	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		this._visibleLines.onConfigurationChanged(e);
		if (e.hasChanged(EditorOption.wrappingInfo)) {
			this._maxLineWidth = 0;
		}

		const options = this._context.configuration.options;
		const fontInfo = options.get(EditorOption.fontInfo);
		const wrappingInfo = options.get(EditorOption.wrappingInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._typicalHalfwidthCharacterWidth = fontInfo.typicalHalfwidthCharacterWidth;
		this._isViewportWrapping = wrappingInfo.isViewportWrapping;
		this._revealHorizontalRightPadding = options.get(EditorOption.revealHorizontalRightPadding);
		this._cursorSurroundingLines = options.get(EditorOption.cursorSurroundingLines);
		this._cursorSurroundingLinesStyle = options.get(EditorOption.cursorSurroundingLinesStyle);
		this._canUseLayerHinting = !options.get(EditorOption.disableLayerHinting);
		Configuration.applyFontInfo(this.domNode, fontInfo);

		this._onOptionsMaybeChanged();

		if (e.hasChanged(EditorOption.layoutInfo)) {
			this._maxLineWidth = 0;
		}

		return true;
	}
	private _onOptionsMaybeChanged(): boolean {
		const conf = this._context.configuration;

		const newViewLineOptions = new ViewLineOptions(conf, this._context.theme.type);
		if (!this._viewLineOptions.equals(newViewLineOptions)) {
			this._viewLineOptions = newViewLineOptions;

			const startLineNumber = this._visibleLines.getStartLineNumber();
			const endLineNumber = this._visibleLines.getEndLineNumber();
			for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
				const line = this._visibleLines.getVisibleLine(lineNumber);
				line.onOptionsChanged(this._viewLineOptions);
			}
			return true;
		}

		return false;
	}
	public onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		let r = false;
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			r = this._visibleLines.getVisibleLine(lineNumber).onSelectionChanged() || r;
		}
		return r;
	}
	public onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		if (true/*e.inlineDecorationsChanged*/) {
			const rendStartLineNumber = this._visibleLines.getStartLineNumber();
			const rendEndLineNumber = this._visibleLines.getEndLineNumber();
			for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
				this._visibleLines.getVisibleLine(lineNumber).onDecorationsChanged();
			}
		}
		return true;
	}
	public onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		const shouldRender = this._visibleLines.onFlushed(e);
		this._maxLineWidth = 0;
		return shouldRender;
	}
	public onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return this._visibleLines.onLinesChanged(e);
	}
	public onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return this._visibleLines.onLinesDeleted(e);
	}
	public onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return this._visibleLines.onLinesInserted(e);
	}
	public onRevealRangeRequest(e: viewEvents.ViewRevealRangeRequestEvent): boolean {
		// Using the future viewport here in order to handle multiple
		// incoming reveal range requests that might all desire to be animated
		const desiredScrollTop = this._computeScrollTopToRevealRange(this._context.viewLayout.getFutureViewport(), e.source, e.range, e.selections, e.verticalType);

		if (desiredScrollTop === -1) {
			// marker to abort the reveal range request
			return false;
		}

		// validate the new desired scroll top
		let newScrollPosition = this._context.viewLayout.validateScrollPosition({ scrollTop: desiredScrollTop });

		if (e.revealHorizontal) {
			if (e.range && e.range.startLineNumber !== e.range.endLineNumber) {
				// Two or more lines? => scroll to base (That's how you see most of the two lines)
				newScrollPosition = {
					scrollTop: newScrollPosition.scrollTop,
					scrollLeft: 0
				};
			} else if (e.range) {
				// We don't necessarily know the horizontal offset of this range since the line might not be in the view...
				this._horizontalRevealRequest = new HorizontalRevealRangeRequest(e.range.startLineNumber, e.range.startColumn, e.range.endColumn, this._context.viewLayout.getCurrentScrollTop(), newScrollPosition.scrollTop, e.scrollType);
			} else if (e.selections && e.selections.length > 0) {
				this._horizontalRevealRequest = new HorizontalRevealSelectionsRequest(e.selections, this._context.viewLayout.getCurrentScrollTop(), newScrollPosition.scrollTop, e.scrollType);
			}
		} else {
			this._horizontalRevealRequest = null;
		}

		const scrollTopDelta = Math.abs(this._context.viewLayout.getCurrentScrollTop() - newScrollPosition.scrollTop);
		const scrollType = (scrollTopDelta <= this._lineHeight ? ScrollType.Immediate : e.scrollType);
		this._context.model.setScrollPosition(newScrollPosition, scrollType);

		return true;
	}
	public onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		if (this._horizontalRevealRequest && e.scrollLeftChanged) {
			// cancel any outstanding horizontal reveal request if someone else scrolls horizontally.
			this._horizontalRevealRequest = null;
		}
		if (this._horizontalRevealRequest && e.scrollTopChanged) {
			const min = Math.min(this._horizontalRevealRequest.startScrollTop, this._horizontalRevealRequest.stopScrollTop);
			const max = Math.max(this._horizontalRevealRequest.startScrollTop, this._horizontalRevealRequest.stopScrollTop);
			if (e.scrollTop < min || e.scrollTop > max) {
				// cancel any outstanding horizontal reveal request if someone else scrolls vertically.
				this._horizontalRevealRequest = null;
			}
		}
		this.domNode.setWidth(e.scrollWidth);
		return this._visibleLines.onScrollChanged(e) || true;
	}

	public onTokensChanged(e: viewEvents.ViewTokensChangedEvent): boolean {
		return this._visibleLines.onTokensChanged(e);
	}
	public onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		this._context.model.setMaxLineWidth(this._maxLineWidth);
		return this._visibleLines.onZonesChanged(e);
	}
	public onThemeChanged(e: viewEvents.ViewThemeChangedEvent): boolean {
		return this._onOptionsMaybeChanged();
	}

	// ---- end view event handlers

	// ----------- HELPERS FOR OTHERS

	public getPositionFromDOMInfo(spanNode: HTMLElement, offset: number): Position | null {
		const viewLineDomNode = this._getViewLineDomNode(spanNode);
		if (viewLineDomNode === null) {
			// Couldn't find view line node
			return null;
		}
		const lineNumber = this._getLineNumberFor(viewLineDomNode);

		if (lineNumber === -1) {
			// Couldn't find view line node
			return null;
		}

		if (lineNumber < 1 || lineNumber > this._context.model.getLineCount()) {
			// lineNumber is outside range
			return null;
		}

		if (this._context.model.getLineMaxColumn(lineNumber) === 1) {
			// Line is empty
			return new Position(lineNumber, 1);
		}

		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		if (lineNumber < rendStartLineNumber || lineNumber > rendEndLineNumber) {
			// Couldn't find line
			return null;
		}

		let column = this._visibleLines.getVisibleLine(lineNumber).getColumnOfNodeOffset(lineNumber, spanNode, offset);
		const minColumn = this._context.model.getLineMinColumn(lineNumber);
		if (column < minColumn) {
			column = minColumn;
		}
		return new Position(lineNumber, column);
	}

	private _getViewLineDomNode(node: HTMLElement | null): HTMLElement | null {
		while (node && node.nodeType === 1) {
			if (node.className === ViewLine.CLASS_NAME) {
				return node;
			}
			node = node.parentElement;
		}
		return null;
	}

	/**
	 * @returns the line number of this view line dom node.
	 */
	private _getLineNumberFor(domNode: HTMLElement): number {
		const startLineNumber = this._visibleLines.getStartLineNumber();
		const endLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const line = this._visibleLines.getVisibleLine(lineNumber);
			if (domNode === line.getDomNode()) {
				return lineNumber;
			}
		}
		return -1;
	}

	public getLineWidth(lineNumber: number): number {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		if (lineNumber < rendStartLineNumber || lineNumber > rendEndLineNumber) {
			// Couldn't find line
			return -1;
		}

		return this._visibleLines.getVisibleLine(lineNumber).getWidth();
	}

	public linesVisibleRangesForRange(_range: Range, includeNewLines: boolean): LineVisibleRanges[] | null {
		if (this.shouldRender()) {
			// Cannot read from the DOM because it is dirty
			// i.e. the model & the dom are out of sync, so I'd be reading something stale
			return null;
		}

		const originalEndLineNumber = _range.endLineNumber;
		const range = Range.intersectRanges(_range, this._lastRenderedData.getCurrentVisibleRange());
		if (!range) {
			return null;
		}

		let visibleRanges: LineVisibleRanges[] = [], visibleRangesLen = 0;
		const domReadingContext = new DomReadingContext(this.domNode.domNode, this._textRangeRestingSpot);

		let nextLineModelLineNumber: number = 0;
		if (includeNewLines) {
			nextLineModelLineNumber = this._context.model.coordinatesConverter.convertViewPositionToModelPosition(new Position(range.startLineNumber, 1)).lineNumber;
		}

		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber++) {

			if (lineNumber < rendStartLineNumber || lineNumber > rendEndLineNumber) {
				continue;
			}

			const startColumn = lineNumber === range.startLineNumber ? range.startColumn : 1;
			const endColumn = lineNumber === range.endLineNumber ? range.endColumn : this._context.model.getLineMaxColumn(lineNumber);
			const visibleRangesForLine = this._visibleLines.getVisibleLine(lineNumber).getVisibleRangesForRange(startColumn, endColumn, domReadingContext);

			if (!visibleRangesForLine) {
				continue;
			}

			if (includeNewLines && lineNumber < originalEndLineNumber) {
				const currentLineModelLineNumber = nextLineModelLineNumber;
				nextLineModelLineNumber = this._context.model.coordinatesConverter.convertViewPositionToModelPosition(new Position(lineNumber + 1, 1)).lineNumber;

				if (currentLineModelLineNumber !== nextLineModelLineNumber) {
					visibleRangesForLine.ranges[visibleRangesForLine.ranges.length - 1].width += this._typicalHalfwidthCharacterWidth;
				}
			}

			visibleRanges[visibleRangesLen++] = new LineVisibleRanges(visibleRangesForLine.outsideRenderedLine, lineNumber, visibleRangesForLine.ranges);
		}

		if (visibleRangesLen === 0) {
			return null;
		}

		return visibleRanges;
	}

	private _visibleRangesForLineRange(lineNumber: number, startColumn: number, endColumn: number): VisibleRanges | null {
		if (this.shouldRender()) {
			// Cannot read from the DOM because it is dirty
			// i.e. the model & the dom are out of sync, so I'd be reading something stale
			return null;
		}

		if (lineNumber < this._visibleLines.getStartLineNumber() || lineNumber > this._visibleLines.getEndLineNumber()) {
			return null;
		}

		return this._visibleLines.getVisibleLine(lineNumber).getVisibleRangesForRange(startColumn, endColumn, new DomReadingContext(this.domNode.domNode, this._textRangeRestingSpot));
	}

	public visibleRangeForPosition(position: Position): HorizontalPosition | null {
		const visibleRanges = this._visibleRangesForLineRange(position.lineNumber, position.column, position.column);
		if (!visibleRanges) {
			return null;
		}
		return new HorizontalPosition(visibleRanges.outsideRenderedLine, visibleRanges.ranges[0].left);
	}

	// --- implementation

	public updateLineWidths(): void {
		this._updateLineWidths(false);
	}

	/**
	 * Updates the max line width if it is fast to compute.
	 * Returns true if all lines were taken into account.
	 * Returns false if some lines need to be reevaluated (in a slow fashion).
	 */
	private _updateLineWidthsFast(): boolean {
		return this._updateLineWidths(true);
	}

	private _updateLineWidthsSlow(): void {
		this._updateLineWidths(false);
	}

	private _updateLineWidths(fast: boolean): boolean {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();

		let localMaxLineWidth = 1;
		let allWidthsComputed = true;
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			const visibleLine = this._visibleLines.getVisibleLine(lineNumber);

			if (fast && !visibleLine.getWidthIsFast()) {
				// Cannot compute width in a fast way for this line
				allWidthsComputed = false;
				continue;
			}

			localMaxLineWidth = Math.max(localMaxLineWidth, visibleLine.getWidth());
		}

		if (allWidthsComputed && rendStartLineNumber === 1 && rendEndLineNumber === this._context.model.getLineCount()) {
			// we know the max line width for all the lines
			this._maxLineWidth = 0;
		}

		this._ensureMaxLineWidth(localMaxLineWidth);

		return allWidthsComputed;
	}

	private _checkMonospaceFontAssumptions(): void {
		// Problems with monospace assumptions are more apparent for longer lines,
		// as small rounding errors start to sum up, so we will select the longest
		// line for a closer inspection
		let longestLineNumber = -1;
		let longestWidth = -1;
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
			if (visibleLine.needsMonospaceFontCheck()) {
				const lineWidth = visibleLine.getWidth();
				if (lineWidth > longestWidth) {
					longestWidth = lineWidth;
					longestLineNumber = lineNumber;
				}
			}
		}

		if (longestLineNumber === -1) {
			return;
		}

		if (!this._visibleLines.getVisibleLine(longestLineNumber).monospaceAssumptionsAreValid()) {
			for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
				const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
				visibleLine.onMonospaceAssumptionsInvalidated();
			}
		}
	}

	public prepareRender(): void {
		throw new Error('Not supported');
	}

	public render(): void {
		throw new Error('Not supported');
	}

	public renderText(viewportData: ViewportData): void {
		// (1) render lines - ensures lines are in the DOM
		this._visibleLines.renderLines(viewportData);
		this._lastRenderedData.setCurrentVisibleRange(viewportData.visibleRange);
		this.domNode.setWidth(this._context.viewLayout.getScrollWidth());
		this.domNode.setHeight(Math.min(this._context.viewLayout.getScrollHeight(), 1000000));

		// (2) compute horizontal scroll position:
		//  - this must happen after the lines are in the DOM since it might need a line that rendered just now
		//  - it might change `scrollWidth` and `scrollLeft`
		if (this._horizontalRevealRequest) {

			const horizontalRevealRequest = this._horizontalRevealRequest;

			// Check that we have the line that contains the horizontal range in the viewport
			if (viewportData.startLineNumber <= horizontalRevealRequest.minLineNumber && horizontalRevealRequest.maxLineNumber <= viewportData.endLineNumber) {

				this._horizontalRevealRequest = null;

				// allow `visibleRangesForRange2` to work
				this.onDidRender();

				// compute new scroll position
				const newScrollLeft = this._computeScrollLeftToReveal(horizontalRevealRequest);

				if (newScrollLeft) {
					if (!this._isViewportWrapping) {
						// ensure `scrollWidth` is large enough
						this._ensureMaxLineWidth(newScrollLeft.maxHorizontalOffset);
					}
					// set `scrollLeft`
					this._context.model.setScrollPosition({
						scrollLeft: newScrollLeft.scrollLeft
					}, horizontalRevealRequest.scrollType);
				}
			}
		}

		// Update max line width (not so important, it is just so the horizontal scrollbar doesn't get too small)
		if (!this._updateLineWidthsFast()) {
			// Computing the width of some lines would be slow => delay it
			this._asyncUpdateLineWidths.schedule();
		}

		if (platform.isLinux && !this._asyncCheckMonospaceFontAssumptions.isScheduled()) {
			const rendStartLineNumber = this._visibleLines.getStartLineNumber();
			const rendEndLineNumber = this._visibleLines.getEndLineNumber();
			for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
				const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
				if (visibleLine.needsMonospaceFontCheck()) {
					this._asyncCheckMonospaceFontAssumptions.schedule();
					break;
				}
			}
		}

		// (3) handle scrolling
		this._linesContent.setLayerHinting(this._canUseLayerHinting);
		this._linesContent.setContain('strict');
		const adjustedScrollTop = this._context.viewLayout.getCurrentScrollTop() - viewportData.bigNumbersDelta;
		this._linesContent.setTop(-adjustedScrollTop);
		this._linesContent.setLeft(-this._context.viewLayout.getCurrentScrollLeft());
	}

	// --- width

	private _ensureMaxLineWidth(lineWidth: number): void {
		const iLineWidth = Math.ceil(lineWidth);
		if (this._maxLineWidth < iLineWidth) {
			this._maxLineWidth = iLineWidth;
			this._context.model.setMaxLineWidth(this._maxLineWidth);
		}
	}

	private _computeScrollTopToRevealRange(viewport: Viewport, source: string | null | undefined, range: Range | null, selections: Selection[] | null, verticalType: viewEvents.VerticalRevealType): number {
		const viewportStartY = viewport.top;
		const viewportHeight = viewport.height;
		const viewportEndY = viewportStartY + viewportHeight;
		let boxIsSingleRange: boolean;
		let boxStartY: number;
		let boxEndY: number;

		// Have a box that includes one extra line height (for the horizontal scrollbar)
		if (selections && selections.length > 0) {
			let minLineNumber = selections[0].startLineNumber;
			let maxLineNumber = selections[0].endLineNumber;
			for (let i = 1, len = selections.length; i < len; i++) {
				const selection = selections[i];
				minLineNumber = Math.min(minLineNumber, selection.startLineNumber);
				maxLineNumber = Math.max(maxLineNumber, selection.endLineNumber);
			}
			boxIsSingleRange = false;
			boxStartY = this._context.viewLayout.getVerticalOffsetForLineNumber(minLineNumber);
			boxEndY = this._context.viewLayout.getVerticalOffsetForLineNumber(maxLineNumber) + this._lineHeight;
		} else if (range) {
			boxIsSingleRange = true;
			boxStartY = this._context.viewLayout.getVerticalOffsetForLineNumber(range.startLineNumber);
			boxEndY = this._context.viewLayout.getVerticalOffsetForLineNumber(range.endLineNumber) + this._lineHeight;
		} else {
			return -1;
		}

		const shouldIgnoreScrollOff = source === 'mouse' && this._cursorSurroundingLinesStyle === 'default';

		if (!shouldIgnoreScrollOff) {
			const context = Math.min((viewportHeight / this._lineHeight) / 2, this._cursorSurroundingLines);
			boxStartY -= context * this._lineHeight;
			boxEndY += Math.max(0, (context - 1)) * this._lineHeight;
		}

		if (verticalType === viewEvents.VerticalRevealType.Simple || verticalType === viewEvents.VerticalRevealType.Bottom) {
			// Reveal one line more when the last line would be covered by the scrollbar - arrow down case or revealing a line explicitly at bottom
			boxEndY += this._lineHeight;
		}

		let newScrollTop: number;

		if (boxEndY - boxStartY > viewportHeight) {
			// the box is larger than the viewport ... scroll to its top
			if (!boxIsSingleRange) {
				// do not reveal multiple cursors if there are more than fit the viewport
				return -1;
			}
			newScrollTop = boxStartY;
		} else if (verticalType === viewEvents.VerticalRevealType.NearTop || verticalType === viewEvents.VerticalRevealType.NearTopIfOutsideViewport) {
			if (verticalType === viewEvents.VerticalRevealType.NearTopIfOutsideViewport && viewportStartY <= boxStartY && boxEndY <= viewportEndY) {
				// Box is already in the viewport... do nothing
				newScrollTop = viewportStartY;
			} else {
				// We want a gap that is 20% of the viewport, but with a minimum of 5 lines
				const desiredGapAbove = Math.max(5 * this._lineHeight, viewportHeight * 0.2);
				// Try to scroll just above the box with the desired gap
				const desiredScrollTop = boxStartY - desiredGapAbove;
				// But ensure that the box is not pushed out of viewport
				const minScrollTop = boxEndY - viewportHeight;
				newScrollTop = Math.max(minScrollTop, desiredScrollTop);
			}
		} else if (verticalType === viewEvents.VerticalRevealType.Center || verticalType === viewEvents.VerticalRevealType.CenterIfOutsideViewport) {
			if (verticalType === viewEvents.VerticalRevealType.CenterIfOutsideViewport && viewportStartY <= boxStartY && boxEndY <= viewportEndY) {
				// Box is already in the viewport... do nothing
				newScrollTop = viewportStartY;
			} else {
				// Box is outside the viewport... center it
				const boxMiddleY = (boxStartY + boxEndY) / 2;
				newScrollTop = Math.max(0, boxMiddleY - viewportHeight / 2);
			}
		} else {
			newScrollTop = this._computeMinimumScrolling(viewportStartY, viewportEndY, boxStartY, boxEndY, verticalType === viewEvents.VerticalRevealType.Top, verticalType === viewEvents.VerticalRevealType.Bottom);
		}

		return newScrollTop;
	}

	private _computeScrollLeftToReveal(horizontalRevealRequest: HorizontalRevealRequest): { scrollLeft: number; maxHorizontalOffset: number; } | null {

		const viewport = this._context.viewLayout.getCurrentViewport();
		const viewportStartX = viewport.left;
		const viewportEndX = viewportStartX + viewport.width;

		let boxStartX = Constants.MAX_SAFE_SMALL_INTEGER;
		let boxEndX = 0;
		if (horizontalRevealRequest.type === 'range') {
			const visibleRanges = this._visibleRangesForLineRange(horizontalRevealRequest.lineNumber, horizontalRevealRequest.startColumn, horizontalRevealRequest.endColumn);
			if (!visibleRanges) {
				return null;
			}
			for (const visibleRange of visibleRanges.ranges) {
				boxStartX = Math.min(boxStartX, visibleRange.left);
				boxEndX = Math.max(boxEndX, visibleRange.left + visibleRange.width);
			}
		} else {
			for (const selection of horizontalRevealRequest.selections) {
				if (selection.startLineNumber !== selection.endLineNumber) {
					return null;
				}
				const visibleRanges = this._visibleRangesForLineRange(selection.startLineNumber, selection.startColumn, selection.endColumn);
				if (!visibleRanges) {
					return null;
				}
				for (const visibleRange of visibleRanges.ranges) {
					boxStartX = Math.min(boxStartX, visibleRange.left);
					boxEndX = Math.max(boxEndX, visibleRange.left + visibleRange.width);
				}
			}
		}

		boxStartX = Math.max(0, boxStartX - ViewLines.HORIZONTAL_EXTRA_PX);
		boxEndX += this._revealHorizontalRightPadding;

		if (horizontalRevealRequest.type === 'selections' && boxEndX - boxStartX > viewport.width) {
			return null;
		}

		const newScrollLeft = this._computeMinimumScrolling(viewportStartX, viewportEndX, boxStartX, boxEndX);
		return {
			scrollLeft: newScrollLeft,
			maxHorizontalOffset: boxEndX
		};
	}

	private _computeMinimumScrolling(viewportStart: number, viewportEnd: number, boxStart: number, boxEnd: number, revealAtStart?: boolean, revealAtEnd?: boolean): number {
		viewportStart = viewportStart | 0;
		viewportEnd = viewportEnd | 0;
		boxStart = boxStart | 0;
		boxEnd = boxEnd | 0;
		revealAtStart = !!revealAtStart;
		revealAtEnd = !!revealAtEnd;

		const viewportLength = viewportEnd - viewportStart;
		const boxLength = boxEnd - boxStart;

		if (boxLength < viewportLength) {
			// The box would fit in the viewport

			if (revealAtStart) {
				return boxStart;
			}

			if (revealAtEnd) {
				return Math.max(0, boxEnd - viewportLength);
			}

			if (boxStart < viewportStart) {
				// The box is above the viewport
				return boxStart;
			} else if (boxEnd > viewportEnd) {
				// The box is below the viewport
				return Math.max(0, boxEnd - viewportLength);
			}
		} else {
			// The box would not fit in the viewport
			// Reveal the beginning of the box
			return boxStart;
		}

		return viewportStart;
	}
}
