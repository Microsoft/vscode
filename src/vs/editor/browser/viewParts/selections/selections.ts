/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./selections';
import { DynamicViewOverlay } from 'vs/editor/browser/view/dynamicViewOverlay';
import { Range } from 'vs/editor/common/core/range';
import { HorizontalRange, LineVisibleRanges, RenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { editorInactiveSelection, editorSelectionBackground, editorSelectionForeground } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

const enum CornerStyle {
	EXTERN,
	INTERN,
	FLAT
}

interface IVisibleRangeEndPointStyle {
	top: CornerStyle;
	bottom: CornerStyle;
}

class HorizontalRangeWithStyle {
	public left: number;
	public width: number;
	public startStyle: IVisibleRangeEndPointStyle | null;
	public endStyle: IVisibleRangeEndPointStyle | null;

	constructor(other: HorizontalRange) {
		this.left = other.left;
		this.width = other.width;
		this.startStyle = null;
		this.endStyle = null;
	}
}

class LineVisibleRangesWithStyle {
	public lineNumber: number;
	public ranges: HorizontalRangeWithStyle[];

	constructor(lineNumber: number, ranges: HorizontalRangeWithStyle[]) {
		this.lineNumber = lineNumber;
		this.ranges = ranges;
	}
}

function toStyledRange(item: HorizontalRange): HorizontalRangeWithStyle {
	return new HorizontalRangeWithStyle(item);
}

function toStyled(item: LineVisibleRanges): LineVisibleRangesWithStyle {
	return new LineVisibleRangesWithStyle(item.lineNumber, item.ranges.map(toStyledRange));
}

export class SelectionsOverlay extends DynamicViewOverlay {

	private static readonly SELECTION_CLASS_NAME = 'selected-text';
	private static readonly SELECTION_TOP_LEFT = 'top-left-radius';
	private static readonly SELECTION_BOTTOM_LEFT = 'bottom-left-radius';
	private static readonly SELECTION_TOP_RIGHT = 'top-right-radius';
	private static readonly SELECTION_BOTTOM_RIGHT = 'bottom-right-radius';
	private static readonly EDITOR_BACKGROUND_CLASS_NAME = 'monaco-editor-background';

	private static readonly ROUNDED_PIECE_WIDTH = 10;

	private readonly _context: ViewContext;
	private _lineHeight: number;
	private _roundedSelection: boolean;
	private _typicalHalfwidthCharacterWidth: number;
	private _selections: Range[];
	private _renderResult: string[] | null;

	constructor(context: ViewContext) {
		super();
		this._context = context;
		const options = this._context.configuration.options;
		this._lineHeight = options.get(EditorOption.lineHeight);
		this._roundedSelection = options.get(EditorOption.roundedSelection);
		this._typicalHalfwidthCharacterWidth = options.get(EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
		this._selections = [];
		this._renderResult = null;
		this._context.addEventHandler(this);
	}

	public override dispose(): void {
		this._context.removeEventHandler(this);
		this._renderResult = null;
		super.dispose();
	}

	// --- begin event handlers

	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const options = this._context.configuration.options;
		this._lineHeight = options.get(EditorOption.lineHeight);
		this._roundedSelection = options.get(EditorOption.roundedSelection);
		this._typicalHalfwidthCharacterWidth = options.get(EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
		return true;
	}
	public override onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		this._selections = e.selections.slice(0);
		return true;
	}
	public override onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		// true for inline decorations that can end up relayouting text
		return true;//e.inlineDecorationsChanged;
	}
	public override onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		return true;
	}
	public override onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return true;
	}
	public override onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return true;
	}
	public override onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return true;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return e.scrollTopChanged;
	}
	public override onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return true;
	}

	// --- end event handlers

	private _visibleRangesHaveGaps(linesVisibleRanges: LineVisibleRangesWithStyle[]): boolean {

		for (let i = 0, len = linesVisibleRanges.length; i < len; i++) {
			const lineVisibleRanges = linesVisibleRanges[i];

			if (lineVisibleRanges.ranges.length > 1) {
				// There are two ranges on the same line
				return true;
			}
		}

		return false;
	}

	private _enrichVisibleRangesWithStyle(viewport: Range, linesVisibleRanges: LineVisibleRangesWithStyle[], previousFrame: LineVisibleRangesWithStyle[] | null): void {
		const epsilon = this._typicalHalfwidthCharacterWidth / 4;
		let previousFrameTop: HorizontalRangeWithStyle | null = null;
		let previousFrameBottom: HorizontalRangeWithStyle | null = null;

		if (previousFrame && previousFrame.length > 0 && linesVisibleRanges.length > 0) {

			const topLineNumber = linesVisibleRanges[0].lineNumber;
			if (topLineNumber === viewport.startLineNumber) {
				for (let i = 0; !previousFrameTop && i < previousFrame.length; i++) {
					if (previousFrame[i].lineNumber === topLineNumber) {
						previousFrameTop = previousFrame[i].ranges[0];
					}
				}
			}

			const bottomLineNumber = linesVisibleRanges[linesVisibleRanges.length - 1].lineNumber;
			if (bottomLineNumber === viewport.endLineNumber) {
				for (let i = previousFrame.length - 1; !previousFrameBottom && i >= 0; i--) {
					if (previousFrame[i].lineNumber === bottomLineNumber) {
						previousFrameBottom = previousFrame[i].ranges[0];
					}
				}
			}

			if (previousFrameTop && !previousFrameTop.startStyle) {
				previousFrameTop = null;
			}
			if (previousFrameBottom && !previousFrameBottom.startStyle) {
				previousFrameBottom = null;
			}
		}

		for (let i = 0, len = linesVisibleRanges.length; i < len; i++) {
			// We know for a fact that there is precisely one range on each line
			const curLineRange = linesVisibleRanges[i].ranges[0];
			const curLeft = curLineRange.left;
			const curRight = curLineRange.left + curLineRange.width;

			const startStyle = {
				top: CornerStyle.EXTERN,
				bottom: CornerStyle.EXTERN
			};

			const endStyle = {
				top: CornerStyle.EXTERN,
				bottom: CornerStyle.EXTERN
			};

			if (i > 0) {
				// Look above
				const prevLeft = linesVisibleRanges[i - 1].ranges[0].left;
				const prevRight = linesVisibleRanges[i - 1].ranges[0].left + linesVisibleRanges[i - 1].ranges[0].width;

				if (abs(curLeft - prevLeft) < epsilon) {
					startStyle.top = CornerStyle.FLAT;
				} else if (curLeft > prevLeft) {
					startStyle.top = CornerStyle.INTERN;
				}

				if (abs(curRight - prevRight) < epsilon) {
					endStyle.top = CornerStyle.FLAT;
				} else if (prevLeft < curRight && curRight < prevRight) {
					endStyle.top = CornerStyle.INTERN;
				}
			} else if (previousFrameTop) {
				// Accept some hiccups near the viewport edges to save on repaints
				startStyle.top = previousFrameTop.startStyle!.top;
				endStyle.top = previousFrameTop.endStyle!.top;
			}

			if (i + 1 < len) {
				// Look below
				const nextLeft = linesVisibleRanges[i + 1].ranges[0].left;
				const nextRight = linesVisibleRanges[i + 1].ranges[0].left + linesVisibleRanges[i + 1].ranges[0].width;

				if (abs(curLeft - nextLeft) < epsilon) {
					startStyle.bottom = CornerStyle.FLAT;
				} else if (nextLeft < curLeft && curLeft < nextRight) {
					startStyle.bottom = CornerStyle.INTERN;
				}

				if (abs(curRight - nextRight) < epsilon) {
					endStyle.bottom = CornerStyle.FLAT;
				} else if (curRight < nextRight) {
					endStyle.bottom = CornerStyle.INTERN;
				}
			} else if (previousFrameBottom) {
				// Accept some hiccups near the viewport edges to save on repaints
				startStyle.bottom = previousFrameBottom.startStyle!.bottom;
				endStyle.bottom = previousFrameBottom.endStyle!.bottom;
			}

			curLineRange.startStyle = startStyle;
			curLineRange.endStyle = endStyle;
		}
	}

	private _getVisibleRangesWithStyle(selection: Range, ctx: RenderingContext, previousFrame: LineVisibleRangesWithStyle[] | null): LineVisibleRangesWithStyle[] {
		const _linesVisibleRanges = ctx.linesVisibleRangesForRange(selection, true) || [];
		const linesVisibleRanges = _linesVisibleRanges.map(toStyled);
		const visibleRangesHaveGaps = this._visibleRangesHaveGaps(linesVisibleRanges);

		if (!visibleRangesHaveGaps && this._roundedSelection) {
			this._enrichVisibleRangesWithStyle(ctx.visibleRange, linesVisibleRanges, previousFrame);
		}

		// The visible ranges are sorted TOP-BOTTOM and LEFT-RIGHT
		return linesVisibleRanges;
	}

	private _createSelectionPiece(top: number, height: string, className: string, left: number, width: number): string {
		return (
			'<div class="cslr '
			+ className
			+ '" style="top:'
			+ top.toString()
			+ 'px;left:'
			+ left.toString()
			+ 'px;width:'
			+ width.toString()
			+ 'px;height:'
			+ height
			+ 'px;"></div>'
		);
	}

	private _actualRenderOneSelection(output2: [string, string][], visibleStartLineNumber: number, hasMultipleSelections: boolean, visibleRanges: LineVisibleRangesWithStyle[]): void {
		if (visibleRanges.length === 0) {
			return;
		}

		const visibleRangesHaveStyle = !!visibleRanges[0].ranges[0].startStyle;
		const fullLineHeight = (this._lineHeight).toString();
		const reducedLineHeight = (this._lineHeight - 1).toString();

		const firstLineNumber = visibleRanges[0].lineNumber;
		const lastLineNumber = visibleRanges[visibleRanges.length - 1].lineNumber;

		for (let i = 0, len = visibleRanges.length; i < len; i++) {
			const lineVisibleRanges = visibleRanges[i];
			const lineNumber = lineVisibleRanges.lineNumber;
			const lineIndex = lineNumber - visibleStartLineNumber;

			const lineHeight = hasMultipleSelections ? (lineNumber === lastLineNumber || lineNumber === firstLineNumber ? reducedLineHeight : fullLineHeight) : fullLineHeight;
			const top = hasMultipleSelections ? (lineNumber === firstLineNumber ? 1 : 0) : 0;

			let innerCornerOutput = '';
			let restOfSelectionOutput = '';

			for (let j = 0, lenJ = lineVisibleRanges.ranges.length; j < lenJ; j++) {
				const visibleRange = lineVisibleRanges.ranges[j];

				if (visibleRangesHaveStyle) {
					const startStyle = visibleRange.startStyle!;
					const endStyle = visibleRange.endStyle!;
					if (startStyle.top === CornerStyle.INTERN || startStyle.bottom === CornerStyle.INTERN) {
						// Reverse rounded corner to the left

						// First comes the selection (blue layer)
						innerCornerOutput += this._createSelectionPiece(top, lineHeight, SelectionsOverlay.SELECTION_CLASS_NAME, visibleRange.left - SelectionsOverlay.ROUNDED_PIECE_WIDTH, SelectionsOverlay.ROUNDED_PIECE_WIDTH);

						// Second comes the background (white layer) with inverse border radius
						let className = SelectionsOverlay.EDITOR_BACKGROUND_CLASS_NAME;
						if (startStyle.top === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_TOP_RIGHT;
						}
						if (startStyle.bottom === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_RIGHT;
						}
						innerCornerOutput += this._createSelectionPiece(top, lineHeight, className, visibleRange.left - SelectionsOverlay.ROUNDED_PIECE_WIDTH, SelectionsOverlay.ROUNDED_PIECE_WIDTH);
					}
					if (endStyle.top === CornerStyle.INTERN || endStyle.bottom === CornerStyle.INTERN) {
						// Reverse rounded corner to the right

						// First comes the selection (blue layer)
						innerCornerOutput += this._createSelectionPiece(top, lineHeight, SelectionsOverlay.SELECTION_CLASS_NAME, visibleRange.left + visibleRange.width, SelectionsOverlay.ROUNDED_PIECE_WIDTH);

						// Second comes the background (white layer) with inverse border radius
						let className = SelectionsOverlay.EDITOR_BACKGROUND_CLASS_NAME;
						if (endStyle.top === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_TOP_LEFT;
						}
						if (endStyle.bottom === CornerStyle.INTERN) {
							className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_LEFT;
						}
						innerCornerOutput += this._createSelectionPiece(top, lineHeight, className, visibleRange.left + visibleRange.width, SelectionsOverlay.ROUNDED_PIECE_WIDTH);
					}
				}

				let className = SelectionsOverlay.SELECTION_CLASS_NAME;
				if (visibleRangesHaveStyle) {
					const startStyle = visibleRange.startStyle!;
					const endStyle = visibleRange.endStyle!;
					if (startStyle.top === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_TOP_LEFT;
					}
					if (startStyle.bottom === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_LEFT;
					}
					if (endStyle.top === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_TOP_RIGHT;
					}
					if (endStyle.bottom === CornerStyle.EXTERN) {
						className += ' ' + SelectionsOverlay.SELECTION_BOTTOM_RIGHT;
					}
				}
				restOfSelectionOutput += this._createSelectionPiece(top, lineHeight, className, visibleRange.left, visibleRange.width);
			}

			output2[lineIndex][0] += innerCornerOutput;
			output2[lineIndex][1] += restOfSelectionOutput;
		}
	}

	private _previousFrameVisibleRangesWithStyle: (LineVisibleRangesWithStyle[] | null)[] = [];
	public prepareRender(ctx: RenderingContext): void {

		// Build HTML for inner corners separate from HTML for the rest of selections,
		// as the inner corner HTML can interfere with that of other selections.
		// In final render, make sure to place the inner corner HTML before the rest of selection HTML. See issue #77777.
		const output: [string, string][] = [];
		const visibleStartLineNumber = ctx.visibleRange.startLineNumber;
		const visibleEndLineNumber = ctx.visibleRange.endLineNumber;
		for (let lineNumber = visibleStartLineNumber; lineNumber <= visibleEndLineNumber; lineNumber++) {
			const lineIndex = lineNumber - visibleStartLineNumber;
			output[lineIndex] = ['', ''];
		}

		const thisFrameVisibleRangesWithStyle: (LineVisibleRangesWithStyle[] | null)[] = [];
		for (let i = 0, len = this._selections.length; i < len; i++) {
			const selection = this._selections[i];
			if (selection.isEmpty()) {
				thisFrameVisibleRangesWithStyle[i] = null;
				continue;
			}

			const visibleRangesWithStyle = this._getVisibleRangesWithStyle(selection, ctx, this._previousFrameVisibleRangesWithStyle[i]);
			thisFrameVisibleRangesWithStyle[i] = visibleRangesWithStyle;
			this._actualRenderOneSelection(output, visibleStartLineNumber, this._selections.length > 1, visibleRangesWithStyle);
		}

		this._previousFrameVisibleRangesWithStyle = thisFrameVisibleRangesWithStyle;
		this._renderResult = output.map(([internalCorners, restOfSelection]) => internalCorners + restOfSelection);
	}

	public render(startLineNumber: number, lineNumber: number): string {
		if (!this._renderResult) {
			return '';
		}
		const lineIndex = lineNumber - startLineNumber;
		if (lineIndex < 0 || lineIndex >= this._renderResult.length) {
			return '';
		}
		return this._renderResult[lineIndex];
	}
}

registerThemingParticipant((theme, collector) => {
	const editorSelectionColor = theme.getColor(editorSelectionBackground);
	if (editorSelectionColor) {
		collector.addRule(`.monaco-editor .focused .selected-text { background-color: ${editorSelectionColor}; }`);
	}
	const editorInactiveSelectionColor = theme.getColor(editorInactiveSelection);
	if (editorInactiveSelectionColor) {
		collector.addRule(`.monaco-editor .selected-text { background-color: ${editorInactiveSelectionColor}; }`);
	}
	const editorSelectionForegroundColor = theme.getColor(editorSelectionForeground);
	if (editorSelectionForegroundColor && !editorSelectionForegroundColor.isTransparent()) {
		collector.addRule(`.monaco-editor .view-line span.inline-selected-text { color: ${editorSelectionForegroundColor}; }`);
	}
});

function abs(n: number): number {
	return n < 0 ? -n : n;
}
