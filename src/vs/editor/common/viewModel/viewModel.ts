/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IScrollPosition, Scrollable } from 'vs/base/common/scrollable';
import * as strings from 'vs/base/common/strings';
import { IViewLineTokens } from 'vs/editor/common/core/lineTokens';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { INewScrollPosition, ScrollType } from 'vs/editor/common/editorCommon';
import { EndOfLinePreference, IActiveIndentGuideInfo, IModelDecorationOptions, TextModelResolvedOptions, ITextModel } from 'vs/editor/common/model';
import { VerticalRevealType } from 'vs/editor/common/view/viewEvents';
import { IPartialViewLinesViewportData } from 'vs/editor/common/viewLayout/viewLinesViewportData';
import { IEditorWhitespace, IWhitespaceChangeAccessor } from 'vs/editor/common/viewLayout/linesLayout';
import { EditorTheme } from 'vs/editor/common/view/viewContext';
import { ICursorSimpleModel, PartialCursorState, CursorState, IColumnSelectData, EditOperationType, CursorConfiguration } from 'vs/editor/common/controller/cursorCommon';
import { CursorChangeReason } from 'vs/editor/common/controller/cursorEvents';
import { ViewEventHandler } from 'vs/editor/common/viewModel/viewEventHandler';

export interface IViewWhitespaceViewportData {
	readonly id: string;
	readonly afterLineNumber: number;
	readonly verticalOffset: number;
	readonly height: number;
}

export class Viewport {
	readonly _viewportBrand: void;

	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;

	constructor(top: number, left: number, width: number, height: number) {
		this.top = top | 0;
		this.left = left | 0;
		this.width = width | 0;
		this.height = height | 0;
	}
}

export interface IViewLayout {

	getScrollable(): Scrollable;

	getScrollWidth(): number;
	getScrollHeight(): number;

	getCurrentScrollLeft(): number;
	getCurrentScrollTop(): number;
	getCurrentViewport(): Viewport;

	getFutureViewport(): Viewport;

	validateScrollPosition(scrollPosition: INewScrollPosition): IScrollPosition;

	getLinesViewportData(): IPartialViewLinesViewportData;
	getLinesViewportDataAtScrollTop(scrollTop: number): IPartialViewLinesViewportData;
	getWhitespaces(): IEditorWhitespace[];

	isAfterLines(verticalOffset: number): boolean;
	isInTopPadding(verticalOffset: number): boolean;
	isInBottomPadding(verticalOffset: number): boolean;
	getLineNumberAtVerticalOffset(verticalOffset: number): number;
	getVerticalOffsetForLineNumber(lineNumber: number): number;
	getWhitespaceAtVerticalOffset(verticalOffset: number): IViewWhitespaceViewportData | null;

	/**
	 * Get the layout information for whitespaces currently in the viewport
	 */
	getWhitespaceViewportData(): IViewWhitespaceViewportData[];
}

export interface ICoordinatesConverter {
	// View -> Model conversion and related methods
	convertViewPositionToModelPosition(viewPosition: Position): Position;
	convertViewRangeToModelRange(viewRange: Range): Range;
	validateViewPosition(viewPosition: Position, expectedModelPosition: Position): Position;
	validateViewRange(viewRange: Range, expectedModelRange: Range): Range;

	// Model -> View conversion and related methods
	convertModelPositionToViewPosition(modelPosition: Position): Position;
	convertModelRangeToViewRange(modelRange: Range): Range;
	modelPositionIsVisible(modelPosition: Position): boolean;
	getModelLineViewLineCount(modelLineNumber: number): number;
}

export class OutputPosition {
	outputLineIndex: number;
	outputOffset: number;

	constructor(outputLineIndex: number, outputOffset: number) {
		this.outputLineIndex = outputLineIndex;
		this.outputOffset = outputOffset;
	}
}

export class LineBreakData {
	constructor(
		public breakOffsets: number[],
		public breakOffsetsVisibleColumn: number[],
		public wrappedTextIndentLength: number
	) { }

	public static getInputOffsetOfOutputPosition(breakOffsets: number[], outputLineIndex: number, outputOffset: number): number {
		if (outputLineIndex === 0) {
			return outputOffset;
		} else {
			return breakOffsets[outputLineIndex - 1] + outputOffset;
		}
	}

	public static getOutputPositionOfInputOffset(breakOffsets: number[], inputOffset: number): OutputPosition {
		let low = 0;
		let high = breakOffsets.length - 1;
		let mid = 0;
		let midStart = 0;

		while (low <= high) {
			mid = low + ((high - low) / 2) | 0;

			const midStop = breakOffsets[mid];
			midStart = mid > 0 ? breakOffsets[mid - 1] : 0;

			if (inputOffset < midStart) {
				high = mid - 1;
			} else if (inputOffset >= midStop) {
				low = mid + 1;
			} else {
				break;
			}
		}

		return new OutputPosition(mid, inputOffset - midStart);
	}
}

export interface ILineBreaksComputer {
	/**
	 * Pass in `previousLineBreakData` if the only difference is in breaking columns!!!
	 */
	addRequest(lineText: string, previousLineBreakData: LineBreakData | null): void;
	finalize(): (LineBreakData | null)[];
}

export interface IViewModel extends ICursorSimpleModel {

	readonly model: ITextModel;

	readonly coordinatesConverter: ICoordinatesConverter;

	readonly viewLayout: IViewLayout;

	readonly cursorConfig: CursorConfiguration;

	addViewEventHandler(eventHandler: ViewEventHandler): void;
	removeViewEventHandler(eventHandler: ViewEventHandler): void;

	/**
	 * Gives a hint that a lot of requests are about to come in for these line numbers.
	 */
	setViewport(startLineNumber: number, endLineNumber: number, centeredLineNumber: number): void;
	tokenizeViewport(): void;
	setHasFocus(hasFocus: boolean): void;
	onDidColorThemeChange(): void;

	getDecorationsInViewport(visibleRange: Range): ViewModelDecoration[];
	getViewLineRenderingData(visibleRange: Range, lineNumber: number): ViewLineRenderingData;
	getViewLineData(lineNumber: number): ViewLineData;
	getMinimapLinesRenderingData(startLineNumber: number, endLineNumber: number, needed: boolean[]): MinimapLinesRenderingData;
	getCompletelyVisibleViewRange(): Range;
	getCompletelyVisibleViewRangeAtScrollTop(scrollTop: number): Range;

	getTextModelOptions(): TextModelResolvedOptions;
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
	getLineLength(lineNumber: number): number;
	getActiveIndentGuide(lineNumber: number, minLineNumber: number, maxLineNumber: number): IActiveIndentGuideInfo;
	getLinesIndentGuides(startLineNumber: number, endLineNumber: number): number[];
	getLineMinColumn(lineNumber: number): number;
	getLineMaxColumn(lineNumber: number): number;
	getLineFirstNonWhitespaceColumn(lineNumber: number): number;
	getLineLastNonWhitespaceColumn(lineNumber: number): number;
	getAllOverviewRulerDecorations(theme: EditorTheme): IOverviewRulerDecorations;
	invalidateOverviewRulerColorCache(): void;
	invalidateMinimapColorCache(): void;
	getValueInRange(range: Range, eol: EndOfLinePreference): string;

	getModelLineMaxColumn(modelLineNumber: number): number;
	validateModelPosition(modelPosition: IPosition): Position;
	validateModelRange(range: IRange): Range;

	deduceModelPositionRelativeToViewPosition(viewAnchorPosition: Position, deltaOffset: number, lineFeedCnt: number): Position;
	getEOL(): string;
	getPlainTextToCopy(modelRanges: Range[], emptySelectionClipboard: boolean, forceCRLF: boolean): string | string[];
	getRichTextToCopy(modelRanges: Range[], emptySelectionClipboard: boolean): { html: string, mode: string } | null;

	//#region model

	pushStackElement(): void;

	//#endregion

	createLineBreaksComputer(): ILineBreaksComputer;

	//#region cursor
	getPrimaryCursorState(): CursorState;
	getLastAddedCursorIndex(): number;
	getCursorStates(): CursorState[];
	setCursorStates(source: string | null | undefined, reason: CursorChangeReason, states: PartialCursorState[] | null): void;
	getCursorColumnSelectData(): IColumnSelectData;
	setCursorColumnSelectData(columnSelectData: IColumnSelectData): void;
	getPrevEditOperationType(): EditOperationType;
	setPrevEditOperationType(type: EditOperationType): void;
	revealPrimaryCursor(source: string | null | undefined, revealHorizontal: boolean): void;
	revealTopMostCursor(source: string | null | undefined): void;
	revealBottomMostCursor(source: string | null | undefined): void;
	revealRange(source: string | null | undefined, revealHorizontal: boolean, viewRange: Range, verticalType: VerticalRevealType, scrollType: ScrollType): void;
	//#endregion

	//#region viewLayout
	getVerticalOffsetForLineNumber(viewLineNumber: number): number;
	getScrollTop(): number;
	setScrollTop(newScrollTop: number, scrollType: ScrollType): void;
	setScrollPosition(position: INewScrollPosition, type: ScrollType): void;
	deltaScrollNow(deltaScrollLeft: number, deltaScrollTop: number): void;
	changeWhitespace(callback: (accessor: IWhitespaceChangeAccessor) => void): void;
	setMaxLineWidth(maxLineWidth: number): void;
	//#endregion
}

export class MinimapLinesRenderingData {
	public readonly tabSize: number;
	public readonly data: Array<ViewLineData | null>;

	constructor(
		tabSize: number,
		data: Array<ViewLineData | null>
	) {
		this.tabSize = tabSize;
		this.data = data;
	}
}

export class ViewLineData {
	_viewLineDataBrand: void;

	/**
	 * The content at this view line.
	 */
	public readonly content: string;
	/**
	 * Does this line continue with a wrapped line?
	 */
	public readonly continuesWithWrappedLine: boolean;
	/**
	 * The minimum allowed column at this view line.
	 */
	public readonly minColumn: number;
	/**
	 * The maximum allowed column at this view line.
	 */
	public readonly maxColumn: number;
	/**
	 * The visible column at the start of the line (after the fauxIndent).
	 */
	public readonly startVisibleColumn: number;
	/**
	 * The tokens at this view line.
	 */
	public readonly tokens: IViewLineTokens;

	constructor(
		content: string,
		continuesWithWrappedLine: boolean,
		minColumn: number,
		maxColumn: number,
		startVisibleColumn: number,
		tokens: IViewLineTokens
	) {
		this.content = content;
		this.continuesWithWrappedLine = continuesWithWrappedLine;
		this.minColumn = minColumn;
		this.maxColumn = maxColumn;
		this.startVisibleColumn = startVisibleColumn;
		this.tokens = tokens;
	}
}

export class ViewLineRenderingData {
	/**
	 * The minimum allowed column at this view line.
	 */
	public readonly minColumn: number;
	/**
	 * The maximum allowed column at this view line.
	 */
	public readonly maxColumn: number;
	/**
	 * The content at this view line.
	 */
	public readonly content: string;
	/**
	 * Does this line continue with a wrapped line?
	 */
	public readonly continuesWithWrappedLine: boolean;
	/**
	 * Describes if `content` contains RTL characters.
	 */
	public readonly containsRTL: boolean;
	/**
	 * Describes if `content` contains non basic ASCII chars.
	 */
	public readonly isBasicASCII: boolean;
	/**
	 * The tokens at this view line.
	 */
	public readonly tokens: IViewLineTokens;
	/**
	 * Inline decorations at this view line.
	 */
	public readonly inlineDecorations: InlineDecoration[];
	/**
	 * The tab size for this view model.
	 */
	public readonly tabSize: number;
	/**
	 * The visible column at the start of the line (after the fauxIndent)
	 */
	public readonly startVisibleColumn: number;

	constructor(
		minColumn: number,
		maxColumn: number,
		content: string,
		continuesWithWrappedLine: boolean,
		mightContainRTL: boolean,
		mightContainNonBasicASCII: boolean,
		tokens: IViewLineTokens,
		inlineDecorations: InlineDecoration[],
		tabSize: number,
		startVisibleColumn: number
	) {
		this.minColumn = minColumn;
		this.maxColumn = maxColumn;
		this.content = content;
		this.continuesWithWrappedLine = continuesWithWrappedLine;

		this.isBasicASCII = ViewLineRenderingData.isBasicASCII(content, mightContainNonBasicASCII);
		this.containsRTL = ViewLineRenderingData.containsRTL(content, this.isBasicASCII, mightContainRTL);

		this.tokens = tokens;
		this.inlineDecorations = inlineDecorations;
		this.tabSize = tabSize;
		this.startVisibleColumn = startVisibleColumn;
	}

	public static isBasicASCII(lineContent: string, mightContainNonBasicASCII: boolean): boolean {
		if (mightContainNonBasicASCII) {
			return strings.isBasicASCII(lineContent);
		}
		return true;
	}

	public static containsRTL(lineContent: string, isBasicASCII: boolean, mightContainRTL: boolean): boolean {
		if (!isBasicASCII && mightContainRTL) {
			return strings.containsRTL(lineContent);
		}
		return false;
	}
}

export const enum InlineDecorationType {
	Regular = 0,
	Before = 1,
	After = 2,
	RegularAffectingLetterSpacing = 3
}

export class InlineDecoration {
	constructor(
		public readonly range: Range,
		public readonly inlineClassName: string,
		public readonly type: InlineDecorationType
	) {
	}
}

export class ViewModelDecoration {
	_viewModelDecorationBrand: void;

	public readonly range: Range;
	public readonly options: IModelDecorationOptions;

	constructor(range: Range, options: IModelDecorationOptions) {
		this.range = range;
		this.options = options;
	}
}

/**
 * Decorations are encoded in a number array using the following scheme:
 *  - 3*i = lane
 *  - 3*i+1 = startLineNumber
 *  - 3*i+2 = endLineNumber
 */
export interface IOverviewRulerDecorations {
	[color: string]: number[];
}
