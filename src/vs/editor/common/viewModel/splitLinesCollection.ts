/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import { WrappingIndent } from 'vs/editor/common/config/editorOptions';
import { LineTokens } from 'vs/editor/common/core/lineTokens';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { EndOfLinePreference, IActiveIndentGuideInfo, IModelDecoration, IModelDeltaDecoration, ITextModel } from 'vs/editor/common/model';
import { ModelDecorationOptions, ModelDecorationOverviewRulerOptions } from 'vs/editor/common/model/textModel';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { PrefixSumIndexOfResult } from 'vs/editor/common/viewModel/prefixSumComputer';
import { ICoordinatesConverter, ILineBreaksComputer, IOverviewRulerDecorations, LineBreakData, ViewLineData } from 'vs/editor/common/viewModel/viewModel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { EditorTheme } from 'vs/editor/common/view/viewContext';

export interface ILineBreaksComputerFactory {
	createLineBreaksComputer(fontInfo: FontInfo, tabSize: number, wrappingColumn: number, wrappingIndent: WrappingIndent): ILineBreaksComputer;
}

export interface ISimpleModel {
	getLineTokens(lineNumber: number): LineTokens;
	getLineContent(lineNumber: number): string;
	getLineLength(lineNumber: number): number;
	getLineMinColumn(lineNumber: number): number;
	getLineMaxColumn(lineNumber: number): number;
	getValueInRange(range: IRange, eol?: EndOfLinePreference): string;
}

export interface ISplitLine {
	isVisible(): boolean;
	setVisible(isVisible: boolean): ISplitLine;

	getLineBreakData(): LineBreakData | null;
	getViewLineCount(): number;
	getViewLineContent(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): string;
	getViewLineLength(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number;
	getViewLineMinColumn(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number;
	getViewLineMaxColumn(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number;
	getViewLineData(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): ViewLineData;
	getViewLinesData(model: ISimpleModel, modelLineNumber: number, fromOuputLineIndex: number, toOutputLineIndex: number, globalStartIndex: number, needed: boolean[], result: Array<ViewLineData | null>): void;

	getModelColumnOfViewPosition(outputLineIndex: number, outputColumn: number): number;
	getViewPositionOfModelPosition(deltaLineNumber: number, inputColumn: number): Position;
	getViewLineNumberOfModelPosition(deltaLineNumber: number, inputColumn: number): number;
}

export interface IViewModelLinesCollection extends IDisposable {
	createCoordinatesConverter(): ICoordinatesConverter;

	setWrappingSettings(fontInfo: FontInfo, wrappingStrategy: 'simple' | 'advanced', wrappingColumn: number, wrappingIndent: WrappingIndent): boolean;
	setTabSize(newTabSize: number): boolean;
	getHiddenAreas(): Range[];
	setHiddenAreas(_ranges: Range[]): boolean;

	createLineBreaksComputer(): ILineBreaksComputer;
	onModelFlushed(): void;
	onModelLinesDeleted(versionId: number, fromLineNumber: number, toLineNumber: number): viewEvents.ViewLinesDeletedEvent | null;
	onModelLinesInserted(versionId: number, fromLineNumber: number, toLineNumber: number, lineBreaks: (LineBreakData | null)[]): viewEvents.ViewLinesInsertedEvent | null;
	onModelLineChanged(versionId: number, lineNumber: number, lineBreakData: LineBreakData | null): [boolean, viewEvents.ViewLinesChangedEvent | null, viewEvents.ViewLinesInsertedEvent | null, viewEvents.ViewLinesDeletedEvent | null];
	acceptVersionId(versionId: number): void;

	getViewLineCount(): number;
	getActiveIndentGuide(viewLineNumber: number, minLineNumber: number, maxLineNumber: number): IActiveIndentGuideInfo;
	getViewLinesIndentGuides(viewStartLineNumber: number, viewEndLineNumber: number): number[];
	getViewLineContent(viewLineNumber: number): string;
	getViewLineLength(viewLineNumber: number): number;
	getViewLineMinColumn(viewLineNumber: number): number;
	getViewLineMaxColumn(viewLineNumber: number): number;
	getViewLineData(viewLineNumber: number): ViewLineData;
	getViewLinesData(viewStartLineNumber: number, viewEndLineNumber: number, needed: boolean[]): Array<ViewLineData | null>;

	getAllOverviewRulerDecorations(ownerId: number, filterOutValidation: boolean, theme: EditorTheme): IOverviewRulerDecorations;
	getDecorationsInRange(range: Range, ownerId: number, filterOutValidation: boolean): IModelDecoration[];
}

export class CoordinatesConverter implements ICoordinatesConverter {

	private readonly _lines: SplitLinesCollection;

	constructor(lines: SplitLinesCollection) {
		this._lines = lines;
	}

	// View -> Model conversion and related methods

	public convertViewPositionToModelPosition(viewPosition: Position): Position {
		return this._lines.convertViewPositionToModelPosition(viewPosition.lineNumber, viewPosition.column);
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		return this._lines.convertViewRangeToModelRange(viewRange);
	}

	public validateViewPosition(viewPosition: Position, expectedModelPosition: Position): Position {
		return this._lines.validateViewPosition(viewPosition.lineNumber, viewPosition.column, expectedModelPosition);
	}

	public validateViewRange(viewRange: Range, expectedModelRange: Range): Range {
		return this._lines.validateViewRange(viewRange, expectedModelRange);
	}

	// Model -> View conversion and related methods

	public convertModelPositionToViewPosition(modelPosition: Position): Position {
		return this._lines.convertModelPositionToViewPosition(modelPosition.lineNumber, modelPosition.column);
	}

	public convertModelRangeToViewRange(modelRange: Range): Range {
		return this._lines.convertModelRangeToViewRange(modelRange);
	}

	public modelPositionIsVisible(modelPosition: Position): boolean {
		return this._lines.modelPositionIsVisible(modelPosition.lineNumber, modelPosition.column);
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		return this._lines.getModelLineViewLineCount(modelLineNumber);
	}
}

const enum IndentGuideRepeatOption {
	BlockNone = 0,
	BlockSubsequent = 1,
	BlockAll = 2
}

class LineNumberMapper {

	private _counts: number[];
	private _isValid: boolean;
	private _validEndIndex: number;

	private _modelToView: number[];
	private _viewToModel: number[];

	constructor(viewLineCounts: number[]) {
		this._counts = viewLineCounts;
		this._isValid = false;
		this._validEndIndex = -1;
		this._modelToView = [];
		this._viewToModel = [];
	}

	private _invalidate(index: number): void {
		this._isValid = false;
		this._validEndIndex = Math.min(this._validEndIndex, index - 1);
	}

	private _ensureValid(): void {
		if (this._isValid) {
			return;
		}

		for (let i = this._validEndIndex + 1, len = this._counts.length; i < len; i++) {
			const viewLineCount = this._counts[i];
			const viewLinesAbove = (i > 0 ? this._modelToView[i - 1] : 0);

			this._modelToView[i] = viewLinesAbove + viewLineCount;
			for (let j = 0; j < viewLineCount; j++) {
				this._viewToModel[viewLinesAbove + j] = i;
			}
		}

		// trim things
		this._modelToView.length = this._counts.length;
		this._viewToModel.length = this._modelToView[this._modelToView.length - 1];

		// mark as valid
		this._isValid = true;
		this._validEndIndex = this._counts.length - 1;
	}

	public changeValue(index: number, value: number): void {
		if (this._counts[index] === value) {
			// no change
			return;
		}
		this._counts[index] = value;
		this._invalidate(index);
	}

	public removeValues(start: number, deleteCount: number): void {
		this._counts.splice(start, deleteCount);
		this._invalidate(start);
	}

	public insertValues(insertIndex: number, insertArr: number[]): void {
		this._counts = arrays.arrayInsert(this._counts, insertIndex, insertArr);
		this._invalidate(insertIndex);
	}

	public getTotalValue(): number {
		this._ensureValid();
		return this._viewToModel.length;
	}

	public getAccumulatedValue(index: number): number {
		this._ensureValid();
		return this._modelToView[index];
	}

	public getIndexOf(accumulatedValue: number): PrefixSumIndexOfResult {
		this._ensureValid();
		const modelLineIndex = this._viewToModel[accumulatedValue];
		const viewLinesAbove = (modelLineIndex > 0 ? this._modelToView[modelLineIndex - 1] : 0);
		return new PrefixSumIndexOfResult(modelLineIndex, accumulatedValue - viewLinesAbove);
	}
}

export class SplitLinesCollection implements IViewModelLinesCollection {

	private readonly model: ITextModel;
	private _validModelVersionId: number;

	private readonly _domLineBreaksComputerFactory: ILineBreaksComputerFactory;
	private readonly _monospaceLineBreaksComputerFactory: ILineBreaksComputerFactory;

	private fontInfo: FontInfo;
	private tabSize: number;
	private wrappingColumn: number;
	private wrappingIndent: WrappingIndent;
	private wrappingStrategy: 'simple' | 'advanced';
	private lines!: ISplitLine[];

	private prefixSumComputer!: LineNumberMapper;

	private hiddenAreasIds!: string[];

	constructor(
		model: ITextModel,
		domLineBreaksComputerFactory: ILineBreaksComputerFactory,
		monospaceLineBreaksComputerFactory: ILineBreaksComputerFactory,
		fontInfo: FontInfo,
		tabSize: number,
		wrappingStrategy: 'simple' | 'advanced',
		wrappingColumn: number,
		wrappingIndent: WrappingIndent,
	) {
		this.model = model;
		this._validModelVersionId = -1;
		this._domLineBreaksComputerFactory = domLineBreaksComputerFactory;
		this._monospaceLineBreaksComputerFactory = monospaceLineBreaksComputerFactory;
		this.fontInfo = fontInfo;
		this.tabSize = tabSize;
		this.wrappingStrategy = wrappingStrategy;
		this.wrappingColumn = wrappingColumn;
		this.wrappingIndent = wrappingIndent;

		this._constructLines(/*resetHiddenAreas*/true, null);
	}

	public dispose(): void {
		this.hiddenAreasIds = this.model.deltaDecorations(this.hiddenAreasIds, []);
	}

	public createCoordinatesConverter(): ICoordinatesConverter {
		return new CoordinatesConverter(this);
	}

	private _constructLines(resetHiddenAreas: boolean, previousLineBreaks: ((LineBreakData | null)[]) | null): void {
		this.lines = [];

		if (resetHiddenAreas) {
			this.hiddenAreasIds = [];
		}

		let linesContent = this.model.getLinesContent();
		const lineCount = linesContent.length;
		const lineBreaksComputer = this.createLineBreaksComputer();
		for (let i = 0; i < lineCount; i++) {
			lineBreaksComputer.addRequest(linesContent[i], previousLineBreaks ? previousLineBreaks[i] : null);
		}
		const linesBreaks = lineBreaksComputer.finalize();

		let values: number[] = [];

		let hiddenAreas = this.hiddenAreasIds.map((areaId) => this.model.getDecorationRange(areaId)!).sort(Range.compareRangesUsingStarts);
		let hiddenAreaStart = 1, hiddenAreaEnd = 0;
		let hiddenAreaIdx = -1;
		let nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : lineCount + 2;

		for (let i = 0; i < lineCount; i++) {
			let lineNumber = i + 1;

			if (lineNumber === nextLineNumberToUpdateHiddenArea) {
				hiddenAreaIdx++;
				hiddenAreaStart = hiddenAreas[hiddenAreaIdx]!.startLineNumber;
				hiddenAreaEnd = hiddenAreas[hiddenAreaIdx]!.endLineNumber;
				nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : lineCount + 2;
			}

			let isInHiddenArea = (lineNumber >= hiddenAreaStart && lineNumber <= hiddenAreaEnd);
			let line = createSplitLine(linesBreaks[i], !isInHiddenArea);
			values[i] = line.getViewLineCount();
			this.lines[i] = line;
		}

		this._validModelVersionId = this.model.getVersionId();

		this.prefixSumComputer = new LineNumberMapper(values);
	}

	public getHiddenAreas(): Range[] {
		return this.hiddenAreasIds.map((decId) => {
			return this.model.getDecorationRange(decId)!;
		});
	}

	private _reduceRanges(_ranges: Range[]): Range[] {
		if (_ranges.length === 0) {
			return [];
		}
		let ranges = _ranges.map(r => this.model.validateRange(r)).sort(Range.compareRangesUsingStarts);

		let result: Range[] = [];
		let currentRangeStart = ranges[0].startLineNumber;
		let currentRangeEnd = ranges[0].endLineNumber;

		for (let i = 1, len = ranges.length; i < len; i++) {
			let range = ranges[i];

			if (range.startLineNumber > currentRangeEnd + 1) {
				result.push(new Range(currentRangeStart, 1, currentRangeEnd, 1));
				currentRangeStart = range.startLineNumber;
				currentRangeEnd = range.endLineNumber;
			} else if (range.endLineNumber > currentRangeEnd) {
				currentRangeEnd = range.endLineNumber;
			}
		}
		result.push(new Range(currentRangeStart, 1, currentRangeEnd, 1));
		return result;
	}

	public setHiddenAreas(_ranges: Range[]): boolean {

		let newRanges = this._reduceRanges(_ranges);

		// BEGIN TODO@Martin: Please stop calling this method on each model change!
		let oldRanges = this.hiddenAreasIds.map((areaId) => this.model.getDecorationRange(areaId)!).sort(Range.compareRangesUsingStarts);

		if (newRanges.length === oldRanges.length) {
			let hasDifference = false;
			for (let i = 0; i < newRanges.length; i++) {
				if (!newRanges[i].equalsRange(oldRanges[i])) {
					hasDifference = true;
					break;
				}
			}
			if (!hasDifference) {
				return false;
			}
		}
		// END TODO@Martin: Please stop calling this method on each model change!

		let newDecorations: IModelDeltaDecoration[] = [];
		for (const newRange of newRanges) {
			newDecorations.push({
				range: newRange,
				options: ModelDecorationOptions.EMPTY
			});
		}

		this.hiddenAreasIds = this.model.deltaDecorations(this.hiddenAreasIds, newDecorations);

		let hiddenAreas = newRanges;
		let hiddenAreaStart = 1, hiddenAreaEnd = 0;
		let hiddenAreaIdx = -1;
		let nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : this.lines.length + 2;

		let hasVisibleLine = false;
		for (let i = 0; i < this.lines.length; i++) {
			let lineNumber = i + 1;

			if (lineNumber === nextLineNumberToUpdateHiddenArea) {
				hiddenAreaIdx++;
				hiddenAreaStart = hiddenAreas[hiddenAreaIdx].startLineNumber;
				hiddenAreaEnd = hiddenAreas[hiddenAreaIdx].endLineNumber;
				nextLineNumberToUpdateHiddenArea = (hiddenAreaIdx + 1 < hiddenAreas.length) ? hiddenAreaEnd + 1 : this.lines.length + 2;
			}

			let lineChanged = false;
			if (lineNumber >= hiddenAreaStart && lineNumber <= hiddenAreaEnd) {
				// Line should be hidden
				if (this.lines[i].isVisible()) {
					this.lines[i] = this.lines[i].setVisible(false);
					lineChanged = true;
				}
			} else {
				hasVisibleLine = true;
				// Line should be visible
				if (!this.lines[i].isVisible()) {
					this.lines[i] = this.lines[i].setVisible(true);
					lineChanged = true;
				}
			}
			if (lineChanged) {
				let newOutputLineCount = this.lines[i].getViewLineCount();
				this.prefixSumComputer.changeValue(i, newOutputLineCount);
			}
		}

		if (!hasVisibleLine) {
			// Cannot have everything be hidden => reveal everything!
			this.setHiddenAreas([]);
		}

		return true;
	}

	public modelPositionIsVisible(modelLineNumber: number, _modelColumn: number): boolean {
		if (modelLineNumber < 1 || modelLineNumber > this.lines.length) {
			// invalid arguments
			return false;
		}
		return this.lines[modelLineNumber - 1].isVisible();
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		if (modelLineNumber < 1 || modelLineNumber > this.lines.length) {
			// invalid arguments
			return 1;
		}
		return this.lines[modelLineNumber - 1].getViewLineCount();
	}

	public setTabSize(newTabSize: number): boolean {
		if (this.tabSize === newTabSize) {
			return false;
		}
		this.tabSize = newTabSize;

		this._constructLines(/*resetHiddenAreas*/false, null);

		return true;
	}

	public setWrappingSettings(fontInfo: FontInfo, wrappingStrategy: 'simple' | 'advanced', wrappingColumn: number, wrappingIndent: WrappingIndent): boolean {
		const equalFontInfo = this.fontInfo.equals(fontInfo);
		const equalWrappingStrategy = (this.wrappingStrategy === wrappingStrategy);
		const equalWrappingColumn = (this.wrappingColumn === wrappingColumn);
		const equalWrappingIndent = (this.wrappingIndent === wrappingIndent);
		if (equalFontInfo && equalWrappingStrategy && equalWrappingColumn && equalWrappingIndent) {
			return false;
		}

		const onlyWrappingColumnChanged = (equalFontInfo && equalWrappingStrategy && !equalWrappingColumn && equalWrappingIndent);

		this.fontInfo = fontInfo;
		this.wrappingStrategy = wrappingStrategy;
		this.wrappingColumn = wrappingColumn;
		this.wrappingIndent = wrappingIndent;

		let previousLineBreaks: ((LineBreakData | null)[]) | null = null;
		if (onlyWrappingColumnChanged) {
			previousLineBreaks = [];
			for (let i = 0, len = this.lines.length; i < len; i++) {
				previousLineBreaks[i] = this.lines[i].getLineBreakData();
			}
		}

		this._constructLines(/*resetHiddenAreas*/false, previousLineBreaks);

		return true;
	}

	public createLineBreaksComputer(): ILineBreaksComputer {
		const lineBreaksComputerFactory = (
			this.wrappingStrategy === 'advanced'
				? this._domLineBreaksComputerFactory
				: this._monospaceLineBreaksComputerFactory
		);
		return lineBreaksComputerFactory.createLineBreaksComputer(this.fontInfo, this.tabSize, this.wrappingColumn, this.wrappingIndent);
	}

	public onModelFlushed(): void {
		this._constructLines(/*resetHiddenAreas*/true, null);
	}

	public onModelLinesDeleted(versionId: number, fromLineNumber: number, toLineNumber: number): viewEvents.ViewLinesDeletedEvent | null {
		if (versionId <= this._validModelVersionId) {
			// Here we check for versionId in case the lines were reconstructed in the meantime.
			// We don't want to apply stale change events on top of a newer read model state.
			return null;
		}

		let outputFromLineNumber = (fromLineNumber === 1 ? 1 : this.prefixSumComputer.getAccumulatedValue(fromLineNumber - 2) + 1);
		let outputToLineNumber = this.prefixSumComputer.getAccumulatedValue(toLineNumber - 1);

		this.lines.splice(fromLineNumber - 1, toLineNumber - fromLineNumber + 1);
		this.prefixSumComputer.removeValues(fromLineNumber - 1, toLineNumber - fromLineNumber + 1);

		return new viewEvents.ViewLinesDeletedEvent(outputFromLineNumber, outputToLineNumber);
	}

	public onModelLinesInserted(versionId: number, fromLineNumber: number, _toLineNumber: number, lineBreaks: (LineBreakData | null)[]): viewEvents.ViewLinesInsertedEvent | null {
		if (versionId <= this._validModelVersionId) {
			// Here we check for versionId in case the lines were reconstructed in the meantime.
			// We don't want to apply stale change events on top of a newer read model state.
			return null;
		}

		let hiddenAreas = this.getHiddenAreas();
		let isInHiddenArea = false;
		let testPosition = new Position(fromLineNumber, 1);
		for (const hiddenArea of hiddenAreas) {
			if (hiddenArea.containsPosition(testPosition)) {
				isInHiddenArea = true;
				break;
			}
		}

		let outputFromLineNumber = (fromLineNumber === 1 ? 1 : this.prefixSumComputer.getAccumulatedValue(fromLineNumber - 2) + 1);

		let totalOutputLineCount = 0;
		let insertLines: ISplitLine[] = [];
		let insertPrefixSumValues: number[] = [];

		for (let i = 0, len = lineBreaks.length; i < len; i++) {
			let line = createSplitLine(lineBreaks[i], !isInHiddenArea);
			insertLines.push(line);

			let outputLineCount = line.getViewLineCount();
			totalOutputLineCount += outputLineCount;
			insertPrefixSumValues[i] = outputLineCount;
		}

		// TODO@Alex: use arrays.arrayInsert
		this.lines = this.lines.slice(0, fromLineNumber - 1).concat(insertLines).concat(this.lines.slice(fromLineNumber - 1));

		this.prefixSumComputer.insertValues(fromLineNumber - 1, insertPrefixSumValues);

		return new viewEvents.ViewLinesInsertedEvent(outputFromLineNumber, outputFromLineNumber + totalOutputLineCount - 1);
	}

	public onModelLineChanged(versionId: number, lineNumber: number, lineBreakData: LineBreakData | null): [boolean, viewEvents.ViewLinesChangedEvent | null, viewEvents.ViewLinesInsertedEvent | null, viewEvents.ViewLinesDeletedEvent | null] {
		if (versionId <= this._validModelVersionId) {
			// Here we check for versionId in case the lines were reconstructed in the meantime.
			// We don't want to apply stale change events on top of a newer read model state.
			return [false, null, null, null];
		}

		let lineIndex = lineNumber - 1;

		let oldOutputLineCount = this.lines[lineIndex].getViewLineCount();
		let isVisible = this.lines[lineIndex].isVisible();
		let line = createSplitLine(lineBreakData, isVisible);
		this.lines[lineIndex] = line;
		let newOutputLineCount = this.lines[lineIndex].getViewLineCount();

		let lineMappingChanged = false;
		let changeFrom = 0;
		let changeTo = -1;
		let insertFrom = 0;
		let insertTo = -1;
		let deleteFrom = 0;
		let deleteTo = -1;

		if (oldOutputLineCount > newOutputLineCount) {
			changeFrom = (lineNumber === 1 ? 1 : this.prefixSumComputer.getAccumulatedValue(lineNumber - 2) + 1);
			changeTo = changeFrom + newOutputLineCount - 1;
			deleteFrom = changeTo + 1;
			deleteTo = deleteFrom + (oldOutputLineCount - newOutputLineCount) - 1;
			lineMappingChanged = true;
		} else if (oldOutputLineCount < newOutputLineCount) {
			changeFrom = (lineNumber === 1 ? 1 : this.prefixSumComputer.getAccumulatedValue(lineNumber - 2) + 1);
			changeTo = changeFrom + oldOutputLineCount - 1;
			insertFrom = changeTo + 1;
			insertTo = insertFrom + (newOutputLineCount - oldOutputLineCount) - 1;
			lineMappingChanged = true;
		} else {
			changeFrom = (lineNumber === 1 ? 1 : this.prefixSumComputer.getAccumulatedValue(lineNumber - 2) + 1);
			changeTo = changeFrom + newOutputLineCount - 1;
		}

		this.prefixSumComputer.changeValue(lineIndex, newOutputLineCount);

		const viewLinesChangedEvent = (changeFrom <= changeTo ? new viewEvents.ViewLinesChangedEvent(changeFrom, changeTo) : null);
		const viewLinesInsertedEvent = (insertFrom <= insertTo ? new viewEvents.ViewLinesInsertedEvent(insertFrom, insertTo) : null);
		const viewLinesDeletedEvent = (deleteFrom <= deleteTo ? new viewEvents.ViewLinesDeletedEvent(deleteFrom, deleteTo) : null);

		return [lineMappingChanged, viewLinesChangedEvent, viewLinesInsertedEvent, viewLinesDeletedEvent];
	}

	public acceptVersionId(versionId: number): void {
		this._validModelVersionId = versionId;
		if (this.lines.length === 1 && !this.lines[0].isVisible()) {
			// At least one line must be visible => reset hidden areas
			this.setHiddenAreas([]);
		}
	}

	public getViewLineCount(): number {
		return this.prefixSumComputer.getTotalValue();
	}

	private _toValidViewLineNumber(viewLineNumber: number): number {
		if (viewLineNumber < 1) {
			return 1;
		}
		const viewLineCount = this.getViewLineCount();
		if (viewLineNumber > viewLineCount) {
			return viewLineCount;
		}
		return viewLineNumber | 0;
	}

	public getActiveIndentGuide(viewLineNumber: number, minLineNumber: number, maxLineNumber: number): IActiveIndentGuideInfo {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		minLineNumber = this._toValidViewLineNumber(minLineNumber);
		maxLineNumber = this._toValidViewLineNumber(maxLineNumber);

		const modelPosition = this.convertViewPositionToModelPosition(viewLineNumber, this.getViewLineMinColumn(viewLineNumber));
		const modelMinPosition = this.convertViewPositionToModelPosition(minLineNumber, this.getViewLineMinColumn(minLineNumber));
		const modelMaxPosition = this.convertViewPositionToModelPosition(maxLineNumber, this.getViewLineMinColumn(maxLineNumber));
		const result = this.model.getActiveIndentGuide(modelPosition.lineNumber, modelMinPosition.lineNumber, modelMaxPosition.lineNumber);

		const viewStartPosition = this.convertModelPositionToViewPosition(result.startLineNumber, 1);
		const viewEndPosition = this.convertModelPositionToViewPosition(result.endLineNumber, this.model.getLineMaxColumn(result.endLineNumber));
		return {
			startLineNumber: viewStartPosition.lineNumber,
			endLineNumber: viewEndPosition.lineNumber,
			indent: result.indent
		};
	}

	public getViewLinesIndentGuides(viewStartLineNumber: number, viewEndLineNumber: number): number[] {
		viewStartLineNumber = this._toValidViewLineNumber(viewStartLineNumber);
		viewEndLineNumber = this._toValidViewLineNumber(viewEndLineNumber);

		const modelStart = this.convertViewPositionToModelPosition(viewStartLineNumber, this.getViewLineMinColumn(viewStartLineNumber));
		const modelEnd = this.convertViewPositionToModelPosition(viewEndLineNumber, this.getViewLineMaxColumn(viewEndLineNumber));

		let result: number[] = [];
		let resultRepeatCount: number[] = [];
		let resultRepeatOption: IndentGuideRepeatOption[] = [];
		const modelStartLineIndex = modelStart.lineNumber - 1;
		const modelEndLineIndex = modelEnd.lineNumber - 1;

		let reqStart: Position | null = null;
		for (let modelLineIndex = modelStartLineIndex; modelLineIndex <= modelEndLineIndex; modelLineIndex++) {
			const line = this.lines[modelLineIndex];
			if (line.isVisible()) {
				let viewLineStartIndex = line.getViewLineNumberOfModelPosition(0, modelLineIndex === modelStartLineIndex ? modelStart.column : 1);
				let viewLineEndIndex = line.getViewLineNumberOfModelPosition(0, this.model.getLineMaxColumn(modelLineIndex + 1));
				let count = viewLineEndIndex - viewLineStartIndex + 1;
				let option = IndentGuideRepeatOption.BlockNone;
				if (count > 1 && line.getViewLineMinColumn(this.model, modelLineIndex + 1, viewLineEndIndex) === 1) {
					// wrapped lines should block indent guides
					option = (viewLineStartIndex === 0 ? IndentGuideRepeatOption.BlockSubsequent : IndentGuideRepeatOption.BlockAll);
				}
				resultRepeatCount.push(count);
				resultRepeatOption.push(option);
				// merge into previous request
				if (reqStart === null) {
					reqStart = new Position(modelLineIndex + 1, 0);
				}
			} else {
				// hit invisible line => flush request
				if (reqStart !== null) {
					result = result.concat(this.model.getLinesIndentGuides(reqStart.lineNumber, modelLineIndex));
					reqStart = null;
				}
			}
		}

		if (reqStart !== null) {
			result = result.concat(this.model.getLinesIndentGuides(reqStart.lineNumber, modelEnd.lineNumber));
			reqStart = null;
		}

		const viewLineCount = viewEndLineNumber - viewStartLineNumber + 1;
		let viewIndents = new Array<number>(viewLineCount);
		let currIndex = 0;
		for (let i = 0, len = result.length; i < len; i++) {
			let value = result[i];
			let count = Math.min(viewLineCount - currIndex, resultRepeatCount[i]);
			let option = resultRepeatOption[i];
			let blockAtIndex: number;
			if (option === IndentGuideRepeatOption.BlockAll) {
				blockAtIndex = 0;
			} else if (option === IndentGuideRepeatOption.BlockSubsequent) {
				blockAtIndex = 1;
			} else {
				blockAtIndex = count;
			}
			for (let j = 0; j < count; j++) {
				if (j === blockAtIndex) {
					value = 0;
				}
				viewIndents[currIndex++] = value;
			}
		}
		return viewIndents;
	}

	public getViewLineContent(viewLineNumber: number): string {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		return this.lines[lineIndex].getViewLineContent(this.model, lineIndex + 1, remainder);
	}

	public getViewLineLength(viewLineNumber: number): number {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		return this.lines[lineIndex].getViewLineLength(this.model, lineIndex + 1, remainder);
	}

	public getViewLineMinColumn(viewLineNumber: number): number {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		return this.lines[lineIndex].getViewLineMinColumn(this.model, lineIndex + 1, remainder);
	}

	public getViewLineMaxColumn(viewLineNumber: number): number {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		return this.lines[lineIndex].getViewLineMaxColumn(this.model, lineIndex + 1, remainder);
	}

	public getViewLineData(viewLineNumber: number): ViewLineData {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);
		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		return this.lines[lineIndex].getViewLineData(this.model, lineIndex + 1, remainder);
	}

	public getViewLinesData(viewStartLineNumber: number, viewEndLineNumber: number, needed: boolean[]): ViewLineData[] {

		viewStartLineNumber = this._toValidViewLineNumber(viewStartLineNumber);
		viewEndLineNumber = this._toValidViewLineNumber(viewEndLineNumber);

		let start = this.prefixSumComputer.getIndexOf(viewStartLineNumber - 1);
		let viewLineNumber = viewStartLineNumber;
		let startModelLineIndex = start.index;
		let startRemainder = start.remainder;

		let result: ViewLineData[] = [];
		for (let modelLineIndex = startModelLineIndex, len = this.model.getLineCount(); modelLineIndex < len; modelLineIndex++) {
			let line = this.lines[modelLineIndex];
			if (!line.isVisible()) {
				continue;
			}
			let fromViewLineIndex = (modelLineIndex === startModelLineIndex ? startRemainder : 0);
			let remainingViewLineCount = line.getViewLineCount() - fromViewLineIndex;

			let lastLine = false;
			if (viewLineNumber + remainingViewLineCount > viewEndLineNumber) {
				lastLine = true;
				remainingViewLineCount = viewEndLineNumber - viewLineNumber + 1;
			}
			let toViewLineIndex = fromViewLineIndex + remainingViewLineCount;

			line.getViewLinesData(this.model, modelLineIndex + 1, fromViewLineIndex, toViewLineIndex, viewLineNumber - viewStartLineNumber, needed, result);

			viewLineNumber += remainingViewLineCount;

			if (lastLine) {
				break;
			}
		}

		return result;
	}

	public validateViewPosition(viewLineNumber: number, viewColumn: number, expectedModelPosition: Position): Position {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);

		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		let line = this.lines[lineIndex];

		let minColumn = line.getViewLineMinColumn(this.model, lineIndex + 1, remainder);
		let maxColumn = line.getViewLineMaxColumn(this.model, lineIndex + 1, remainder);
		if (viewColumn < minColumn) {
			viewColumn = minColumn;
		}
		if (viewColumn > maxColumn) {
			viewColumn = maxColumn;
		}

		let computedModelColumn = line.getModelColumnOfViewPosition(remainder, viewColumn);
		let computedModelPosition = this.model.validatePosition(new Position(lineIndex + 1, computedModelColumn));

		if (computedModelPosition.equals(expectedModelPosition)) {
			return new Position(viewLineNumber, viewColumn);
		}

		return this.convertModelPositionToViewPosition(expectedModelPosition.lineNumber, expectedModelPosition.column);
	}

	public validateViewRange(viewRange: Range, expectedModelRange: Range): Range {
		const validViewStart = this.validateViewPosition(viewRange.startLineNumber, viewRange.startColumn, expectedModelRange.getStartPosition());
		const validViewEnd = this.validateViewPosition(viewRange.endLineNumber, viewRange.endColumn, expectedModelRange.getEndPosition());
		return new Range(validViewStart.lineNumber, validViewStart.column, validViewEnd.lineNumber, validViewEnd.column);
	}

	public convertViewPositionToModelPosition(viewLineNumber: number, viewColumn: number): Position {
		viewLineNumber = this._toValidViewLineNumber(viewLineNumber);

		let r = this.prefixSumComputer.getIndexOf(viewLineNumber - 1);
		let lineIndex = r.index;
		let remainder = r.remainder;

		let inputColumn = this.lines[lineIndex].getModelColumnOfViewPosition(remainder, viewColumn);
		// console.log('out -> in ' + viewLineNumber + ',' + viewColumn + ' ===> ' + (lineIndex+1) + ',' + inputColumn);
		return this.model.validatePosition(new Position(lineIndex + 1, inputColumn));
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		const start = this.convertViewPositionToModelPosition(viewRange.startLineNumber, viewRange.startColumn);
		const end = this.convertViewPositionToModelPosition(viewRange.endLineNumber, viewRange.endColumn);
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	public convertModelPositionToViewPosition(_modelLineNumber: number, _modelColumn: number): Position {

		const validPosition = this.model.validatePosition(new Position(_modelLineNumber, _modelColumn));
		const inputLineNumber = validPosition.lineNumber;
		const inputColumn = validPosition.column;

		let lineIndex = inputLineNumber - 1, lineIndexChanged = false;
		while (lineIndex > 0 && !this.lines[lineIndex].isVisible()) {
			lineIndex--;
			lineIndexChanged = true;
		}
		if (lineIndex === 0 && !this.lines[lineIndex].isVisible()) {
			// Could not reach a real line
			// console.log('in -> out ' + inputLineNumber + ',' + inputColumn + ' ===> ' + 1 + ',' + 1);
			return new Position(1, 1);
		}
		const deltaLineNumber = 1 + (lineIndex === 0 ? 0 : this.prefixSumComputer.getAccumulatedValue(lineIndex - 1));

		let r: Position;
		if (lineIndexChanged) {
			r = this.lines[lineIndex].getViewPositionOfModelPosition(deltaLineNumber, this.model.getLineMaxColumn(lineIndex + 1));
		} else {
			r = this.lines[inputLineNumber - 1].getViewPositionOfModelPosition(deltaLineNumber, inputColumn);
		}

		// console.log('in -> out ' + inputLineNumber + ',' + inputColumn + ' ===> ' + r.lineNumber + ',' + r);
		return r;
	}

	public convertModelRangeToViewRange(modelRange: Range): Range {
		let start = this.convertModelPositionToViewPosition(modelRange.startLineNumber, modelRange.startColumn);
		let end = this.convertModelPositionToViewPosition(modelRange.endLineNumber, modelRange.endColumn);
		if (modelRange.startLineNumber === modelRange.endLineNumber && start.lineNumber !== end.lineNumber) {
			// This is a single line range that ends up taking more lines due to wrapping
			if (end.column === this.getViewLineMinColumn(end.lineNumber)) {
				// the end column lands on the first column of the next line
				return new Range(start.lineNumber, start.column, end.lineNumber - 1, this.getViewLineMaxColumn(end.lineNumber - 1));
			}
		}
		return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	private _getViewLineNumberForModelPosition(inputLineNumber: number, inputColumn: number): number {
		let lineIndex = inputLineNumber - 1;
		if (this.lines[lineIndex].isVisible()) {
			// this model line is visible
			const deltaLineNumber = 1 + (lineIndex === 0 ? 0 : this.prefixSumComputer.getAccumulatedValue(lineIndex - 1));
			return this.lines[lineIndex].getViewLineNumberOfModelPosition(deltaLineNumber, inputColumn);
		}

		// this model line is not visible
		while (lineIndex > 0 && !this.lines[lineIndex].isVisible()) {
			lineIndex--;
		}
		if (lineIndex === 0 && !this.lines[lineIndex].isVisible()) {
			// Could not reach a real line
			return 1;
		}
		const deltaLineNumber = 1 + (lineIndex === 0 ? 0 : this.prefixSumComputer.getAccumulatedValue(lineIndex - 1));
		return this.lines[lineIndex].getViewLineNumberOfModelPosition(deltaLineNumber, this.model.getLineMaxColumn(lineIndex + 1));
	}

	public getAllOverviewRulerDecorations(ownerId: number, filterOutValidation: boolean, theme: EditorTheme): IOverviewRulerDecorations {
		const decorations = this.model.getOverviewRulerDecorations(ownerId, filterOutValidation);
		const result = new OverviewRulerDecorations();
		for (const decoration of decorations) {
			const opts = <ModelDecorationOverviewRulerOptions>decoration.options.overviewRuler;
			const lane = opts ? opts.position : 0;
			if (lane === 0) {
				continue;
			}
			const color = opts.getColor(theme);
			const viewStartLineNumber = this._getViewLineNumberForModelPosition(decoration.range.startLineNumber, decoration.range.startColumn);
			const viewEndLineNumber = this._getViewLineNumberForModelPosition(decoration.range.endLineNumber, decoration.range.endColumn);

			result.accept(color, viewStartLineNumber, viewEndLineNumber, lane);
		}
		return result.result;
	}

	public getDecorationsInRange(range: Range, ownerId: number, filterOutValidation: boolean): IModelDecoration[] {
		const modelStart = this.convertViewPositionToModelPosition(range.startLineNumber, range.startColumn);
		const modelEnd = this.convertViewPositionToModelPosition(range.endLineNumber, range.endColumn);

		if (modelEnd.lineNumber - modelStart.lineNumber <= range.endLineNumber - range.startLineNumber) {
			// most likely there are no hidden lines => fast path
			// fetch decorations from column 1 to cover the case of wrapped lines that have whole line decorations at column 1
			return this.model.getDecorationsInRange(new Range(modelStart.lineNumber, 1, modelEnd.lineNumber, modelEnd.column), ownerId, filterOutValidation);
		}

		let result: IModelDecoration[] = [];
		const modelStartLineIndex = modelStart.lineNumber - 1;
		const modelEndLineIndex = modelEnd.lineNumber - 1;

		let reqStart: Position | null = null;
		for (let modelLineIndex = modelStartLineIndex; modelLineIndex <= modelEndLineIndex; modelLineIndex++) {
			const line = this.lines[modelLineIndex];
			if (line.isVisible()) {
				// merge into previous request
				if (reqStart === null) {
					reqStart = new Position(modelLineIndex + 1, modelLineIndex === modelStartLineIndex ? modelStart.column : 1);
				}
			} else {
				// hit invisible line => flush request
				if (reqStart !== null) {
					const maxLineColumn = this.model.getLineMaxColumn(modelLineIndex);
					result = result.concat(this.model.getDecorationsInRange(new Range(reqStart.lineNumber, reqStart.column, modelLineIndex, maxLineColumn), ownerId, filterOutValidation));
					reqStart = null;
				}
			}
		}

		if (reqStart !== null) {
			result = result.concat(this.model.getDecorationsInRange(new Range(reqStart.lineNumber, reqStart.column, modelEnd.lineNumber, modelEnd.column), ownerId, filterOutValidation));
			reqStart = null;
		}

		result.sort((a, b) => {
			const res = Range.compareRangesUsingStarts(a.range, b.range);
			if (res === 0) {
				if (a.id < b.id) {
					return -1;
				}
				if (a.id > b.id) {
					return 1;
				}
				return 0;
			}
			return res;
		});

		// Eliminate duplicate decorations that might have intersected our visible ranges multiple times
		let finalResult: IModelDecoration[] = [], finalResultLen = 0;
		let prevDecId: string | null = null;
		for (const dec of result) {
			const decId = dec.id;
			if (prevDecId === decId) {
				// skip
				continue;
			}
			prevDecId = decId;
			finalResult[finalResultLen++] = dec;
		}

		return finalResult;
	}
}

class VisibleIdentitySplitLine implements ISplitLine {

	public static readonly INSTANCE = new VisibleIdentitySplitLine();

	private constructor() { }

	public isVisible(): boolean {
		return true;
	}

	public setVisible(isVisible: boolean): ISplitLine {
		if (isVisible) {
			return this;
		}
		return InvisibleIdentitySplitLine.INSTANCE;
	}

	public getLineBreakData(): LineBreakData | null {
		return null;
	}

	public getViewLineCount(): number {
		return 1;
	}

	public getViewLineContent(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): string {
		return model.getLineContent(modelLineNumber);
	}

	public getViewLineLength(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): number {
		return model.getLineLength(modelLineNumber);
	}

	public getViewLineMinColumn(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): number {
		return model.getLineMinColumn(modelLineNumber);
	}

	public getViewLineMaxColumn(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): number {
		return model.getLineMaxColumn(modelLineNumber);
	}

	public getViewLineData(model: ISimpleModel, modelLineNumber: number, _outputLineIndex: number): ViewLineData {
		let lineTokens = model.getLineTokens(modelLineNumber);
		let lineContent = lineTokens.getLineContent();
		return new ViewLineData(
			lineContent,
			false,
			1,
			lineContent.length + 1,
			0,
			lineTokens.inflate()
		);
	}

	public getViewLinesData(model: ISimpleModel, modelLineNumber: number, _fromOuputLineIndex: number, _toOutputLineIndex: number, globalStartIndex: number, needed: boolean[], result: Array<ViewLineData | null>): void {
		if (!needed[globalStartIndex]) {
			result[globalStartIndex] = null;
			return;
		}
		result[globalStartIndex] = this.getViewLineData(model, modelLineNumber, 0);
	}

	public getModelColumnOfViewPosition(_outputLineIndex: number, outputColumn: number): number {
		return outputColumn;
	}

	public getViewPositionOfModelPosition(deltaLineNumber: number, inputColumn: number): Position {
		return new Position(deltaLineNumber, inputColumn);
	}

	public getViewLineNumberOfModelPosition(deltaLineNumber: number, _inputColumn: number): number {
		return deltaLineNumber;
	}
}

class InvisibleIdentitySplitLine implements ISplitLine {

	public static readonly INSTANCE = new InvisibleIdentitySplitLine();

	private constructor() { }

	public isVisible(): boolean {
		return false;
	}

	public setVisible(isVisible: boolean): ISplitLine {
		if (!isVisible) {
			return this;
		}
		return VisibleIdentitySplitLine.INSTANCE;
	}

	public getLineBreakData(): LineBreakData | null {
		return null;
	}

	public getViewLineCount(): number {
		return 0;
	}

	public getViewLineContent(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): string {
		throw new Error('Not supported');
	}

	public getViewLineLength(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): number {
		throw new Error('Not supported');
	}

	public getViewLineMinColumn(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): number {
		throw new Error('Not supported');
	}

	public getViewLineMaxColumn(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): number {
		throw new Error('Not supported');
	}

	public getViewLineData(_model: ISimpleModel, _modelLineNumber: number, _outputLineIndex: number): ViewLineData {
		throw new Error('Not supported');
	}

	public getViewLinesData(_model: ISimpleModel, _modelLineNumber: number, _fromOuputLineIndex: number, _toOutputLineIndex: number, _globalStartIndex: number, _needed: boolean[], _result: ViewLineData[]): void {
		throw new Error('Not supported');
	}

	public getModelColumnOfViewPosition(_outputLineIndex: number, _outputColumn: number): number {
		throw new Error('Not supported');
	}

	public getViewPositionOfModelPosition(_deltaLineNumber: number, _inputColumn: number): Position {
		throw new Error('Not supported');
	}

	public getViewLineNumberOfModelPosition(_deltaLineNumber: number, _inputColumn: number): number {
		throw new Error('Not supported');
	}
}

export class SplitLine implements ISplitLine {

	private readonly _lineBreakData: LineBreakData;
	private _isVisible: boolean;

	constructor(lineBreakData: LineBreakData, isVisible: boolean) {
		this._lineBreakData = lineBreakData;
		this._isVisible = isVisible;
	}

	public isVisible(): boolean {
		return this._isVisible;
	}

	public setVisible(isVisible: boolean): ISplitLine {
		this._isVisible = isVisible;
		return this;
	}

	public getLineBreakData(): LineBreakData | null {
		return this._lineBreakData;
	}

	public getViewLineCount(): number {
		if (!this._isVisible) {
			return 0;
		}
		return this._lineBreakData.breakOffsets.length;
	}

	private getInputStartOffsetOfOutputLineIndex(outputLineIndex: number): number {
		return LineBreakData.getInputOffsetOfOutputPosition(this._lineBreakData.breakOffsets, outputLineIndex, 0);
	}

	private getInputEndOffsetOfOutputLineIndex(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number {
		if (outputLineIndex + 1 === this._lineBreakData.breakOffsets.length) {
			return model.getLineMaxColumn(modelLineNumber) - 1;
		}
		return LineBreakData.getInputOffsetOfOutputPosition(this._lineBreakData.breakOffsets, outputLineIndex + 1, 0);
	}

	public getViewLineContent(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): string {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		let startOffset = this.getInputStartOffsetOfOutputLineIndex(outputLineIndex);
		let endOffset = this.getInputEndOffsetOfOutputLineIndex(model, modelLineNumber, outputLineIndex);
		let r = model.getValueInRange({
			startLineNumber: modelLineNumber,
			startColumn: startOffset + 1,
			endLineNumber: modelLineNumber,
			endColumn: endOffset + 1
		});

		if (outputLineIndex > 0) {
			r = spaces(this._lineBreakData.wrappedTextIndentLength) + r;
		}

		return r;
	}

	public getViewLineLength(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		let startOffset = this.getInputStartOffsetOfOutputLineIndex(outputLineIndex);
		let endOffset = this.getInputEndOffsetOfOutputLineIndex(model, modelLineNumber, outputLineIndex);
		let r = endOffset - startOffset;

		if (outputLineIndex > 0) {
			r = this._lineBreakData.wrappedTextIndentLength + r;
		}

		return r;
	}

	public getViewLineMinColumn(_model: ITextModel, _modelLineNumber: number, outputLineIndex: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		if (outputLineIndex > 0) {
			return this._lineBreakData.wrappedTextIndentLength + 1;
		}
		return 1;
	}

	public getViewLineMaxColumn(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		return this.getViewLineContent(model, modelLineNumber, outputLineIndex).length + 1;
	}

	public getViewLineData(model: ISimpleModel, modelLineNumber: number, outputLineIndex: number): ViewLineData {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}

		let startOffset = this.getInputStartOffsetOfOutputLineIndex(outputLineIndex);
		let endOffset = this.getInputEndOffsetOfOutputLineIndex(model, modelLineNumber, outputLineIndex);

		let lineContent = model.getValueInRange({
			startLineNumber: modelLineNumber,
			startColumn: startOffset + 1,
			endLineNumber: modelLineNumber,
			endColumn: endOffset + 1
		});

		if (outputLineIndex > 0) {
			lineContent = spaces(this._lineBreakData.wrappedTextIndentLength) + lineContent;
		}

		let minColumn = (outputLineIndex > 0 ? this._lineBreakData.wrappedTextIndentLength + 1 : 1);
		let maxColumn = lineContent.length + 1;

		let continuesWithWrappedLine = (outputLineIndex + 1 < this.getViewLineCount());

		let deltaStartIndex = 0;
		if (outputLineIndex > 0) {
			deltaStartIndex = this._lineBreakData.wrappedTextIndentLength;
		}
		let lineTokens = model.getLineTokens(modelLineNumber);

		const startVisibleColumn = (outputLineIndex === 0 ? 0 : this._lineBreakData.breakOffsetsVisibleColumn[outputLineIndex - 1]);

		return new ViewLineData(
			lineContent,
			continuesWithWrappedLine,
			minColumn,
			maxColumn,
			startVisibleColumn,
			lineTokens.sliceAndInflate(startOffset, endOffset, deltaStartIndex)
		);
	}

	public getViewLinesData(model: ITextModel, modelLineNumber: number, fromOuputLineIndex: number, toOutputLineIndex: number, globalStartIndex: number, needed: boolean[], result: Array<ViewLineData | null>): void {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}

		for (let outputLineIndex = fromOuputLineIndex; outputLineIndex < toOutputLineIndex; outputLineIndex++) {
			let globalIndex = globalStartIndex + outputLineIndex - fromOuputLineIndex;
			if (!needed[globalIndex]) {
				result[globalIndex] = null;
				continue;
			}
			result[globalIndex] = this.getViewLineData(model, modelLineNumber, outputLineIndex);
		}
	}

	public getModelColumnOfViewPosition(outputLineIndex: number, outputColumn: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		let adjustedColumn = outputColumn - 1;
		if (outputLineIndex > 0) {
			if (adjustedColumn < this._lineBreakData.wrappedTextIndentLength) {
				adjustedColumn = 0;
			} else {
				adjustedColumn -= this._lineBreakData.wrappedTextIndentLength;
			}
		}
		return LineBreakData.getInputOffsetOfOutputPosition(this._lineBreakData.breakOffsets, outputLineIndex, adjustedColumn) + 1;
	}

	public getViewPositionOfModelPosition(deltaLineNumber: number, inputColumn: number): Position {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		let r = LineBreakData.getOutputPositionOfInputOffset(this._lineBreakData.breakOffsets, inputColumn - 1);
		let outputLineIndex = r.outputLineIndex;
		let outputColumn = r.outputOffset + 1;

		if (outputLineIndex > 0) {
			outputColumn += this._lineBreakData.wrappedTextIndentLength;
		}

		//		console.log('in -> out ' + deltaLineNumber + ',' + inputColumn + ' ===> ' + (deltaLineNumber+outputLineIndex) + ',' + outputColumn);
		return new Position(deltaLineNumber + outputLineIndex, outputColumn);
	}

	public getViewLineNumberOfModelPosition(deltaLineNumber: number, inputColumn: number): number {
		if (!this._isVisible) {
			throw new Error('Not supported');
		}
		const r = LineBreakData.getOutputPositionOfInputOffset(this._lineBreakData.breakOffsets, inputColumn - 1);
		return (deltaLineNumber + r.outputLineIndex);
	}
}

let _spaces: string[] = [''];
function spaces(count: number): string {
	if (count >= _spaces.length) {
		for (let i = 1; i <= count; i++) {
			_spaces[i] = _makeSpaces(i);
		}
	}
	return _spaces[count];
}
function _makeSpaces(count: number): string {
	return new Array(count + 1).join(' ');
}

function createSplitLine(lineBreakData: LineBreakData | null, isVisible: boolean): ISplitLine {
	if (lineBreakData === null) {
		// No mapping needed
		if (isVisible) {
			return VisibleIdentitySplitLine.INSTANCE;
		}
		return InvisibleIdentitySplitLine.INSTANCE;
	} else {
		return new SplitLine(lineBreakData, isVisible);
	}
}

export class IdentityCoordinatesConverter implements ICoordinatesConverter {

	private readonly _lines: IdentityLinesCollection;

	constructor(lines: IdentityLinesCollection) {
		this._lines = lines;
	}

	private _validPosition(pos: Position): Position {
		return this._lines.model.validatePosition(pos);
	}

	private _validRange(range: Range): Range {
		return this._lines.model.validateRange(range);
	}

	// View -> Model conversion and related methods

	public convertViewPositionToModelPosition(viewPosition: Position): Position {
		return this._validPosition(viewPosition);
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		return this._validRange(viewRange);
	}

	public validateViewPosition(_viewPosition: Position, expectedModelPosition: Position): Position {
		return this._validPosition(expectedModelPosition);
	}

	public validateViewRange(_viewRange: Range, expectedModelRange: Range): Range {
		return this._validRange(expectedModelRange);
	}

	// Model -> View conversion and related methods

	public convertModelPositionToViewPosition(modelPosition: Position): Position {
		return this._validPosition(modelPosition);
	}

	public convertModelRangeToViewRange(modelRange: Range): Range {
		return this._validRange(modelRange);
	}

	public modelPositionIsVisible(modelPosition: Position): boolean {
		const lineCount = this._lines.model.getLineCount();
		if (modelPosition.lineNumber < 1 || modelPosition.lineNumber > lineCount) {
			// invalid arguments
			return false;
		}
		return true;
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		return 1;
	}
}

export class IdentityLinesCollection implements IViewModelLinesCollection {

	public readonly model: ITextModel;

	constructor(model: ITextModel) {
		this.model = model;
	}

	public dispose(): void {
	}

	public createCoordinatesConverter(): ICoordinatesConverter {
		return new IdentityCoordinatesConverter(this);
	}

	public getHiddenAreas(): Range[] {
		return [];
	}

	public setHiddenAreas(_ranges: Range[]): boolean {
		return false;
	}

	public setTabSize(_newTabSize: number): boolean {
		return false;
	}

	public setWrappingSettings(_fontInfo: FontInfo, _wrappingStrategy: 'simple' | 'advanced', _wrappingColumn: number, _wrappingIndent: WrappingIndent): boolean {
		return false;
	}

	public createLineBreaksComputer(): ILineBreaksComputer {
		let result: null[] = [];
		return {
			addRequest: (lineText: string, previousLineBreakData: LineBreakData | null) => {
				result.push(null);
			},
			finalize: () => {
				return result;
			}
		};
	}

	public onModelFlushed(): void {
	}

	public onModelLinesDeleted(_versionId: number, fromLineNumber: number, toLineNumber: number): viewEvents.ViewLinesDeletedEvent | null {
		return new viewEvents.ViewLinesDeletedEvent(fromLineNumber, toLineNumber);
	}

	public onModelLinesInserted(_versionId: number, fromLineNumber: number, toLineNumber: number, lineBreaks: (LineBreakData | null)[]): viewEvents.ViewLinesInsertedEvent | null {
		return new viewEvents.ViewLinesInsertedEvent(fromLineNumber, toLineNumber);
	}

	public onModelLineChanged(_versionId: number, lineNumber: number, lineBreakData: LineBreakData | null): [boolean, viewEvents.ViewLinesChangedEvent | null, viewEvents.ViewLinesInsertedEvent | null, viewEvents.ViewLinesDeletedEvent | null] {
		return [false, new viewEvents.ViewLinesChangedEvent(lineNumber, lineNumber), null, null];
	}

	public acceptVersionId(_versionId: number): void {
	}

	public getViewLineCount(): number {
		return this.model.getLineCount();
	}

	public getActiveIndentGuide(viewLineNumber: number, _minLineNumber: number, _maxLineNumber: number): IActiveIndentGuideInfo {
		return {
			startLineNumber: viewLineNumber,
			endLineNumber: viewLineNumber,
			indent: 0
		};
	}

	public getViewLinesIndentGuides(viewStartLineNumber: number, viewEndLineNumber: number): number[] {
		const viewLineCount = viewEndLineNumber - viewStartLineNumber + 1;
		let result = new Array<number>(viewLineCount);
		for (let i = 0; i < viewLineCount; i++) {
			result[i] = 0;
		}
		return result;
	}

	public getViewLineContent(viewLineNumber: number): string {
		return this.model.getLineContent(viewLineNumber);
	}

	public getViewLineLength(viewLineNumber: number): number {
		return this.model.getLineLength(viewLineNumber);
	}

	public getViewLineMinColumn(viewLineNumber: number): number {
		return this.model.getLineMinColumn(viewLineNumber);
	}

	public getViewLineMaxColumn(viewLineNumber: number): number {
		return this.model.getLineMaxColumn(viewLineNumber);
	}

	public getViewLineData(viewLineNumber: number): ViewLineData {
		let lineTokens = this.model.getLineTokens(viewLineNumber);
		let lineContent = lineTokens.getLineContent();
		return new ViewLineData(
			lineContent,
			false,
			1,
			lineContent.length + 1,
			0,
			lineTokens.inflate()
		);
	}

	public getViewLinesData(viewStartLineNumber: number, viewEndLineNumber: number, needed: boolean[]): Array<ViewLineData | null> {
		const lineCount = this.model.getLineCount();
		viewStartLineNumber = Math.min(Math.max(1, viewStartLineNumber), lineCount);
		viewEndLineNumber = Math.min(Math.max(1, viewEndLineNumber), lineCount);

		let result: Array<ViewLineData | null> = [];
		for (let lineNumber = viewStartLineNumber; lineNumber <= viewEndLineNumber; lineNumber++) {
			let idx = lineNumber - viewStartLineNumber;
			if (!needed[idx]) {
				result[idx] = null;
			}
			result[idx] = this.getViewLineData(lineNumber);
		}

		return result;
	}

	public getAllOverviewRulerDecorations(ownerId: number, filterOutValidation: boolean, theme: EditorTheme): IOverviewRulerDecorations {
		const decorations = this.model.getOverviewRulerDecorations(ownerId, filterOutValidation);
		const result = new OverviewRulerDecorations();
		for (const decoration of decorations) {
			const opts = <ModelDecorationOverviewRulerOptions>decoration.options.overviewRuler;
			const lane = opts ? opts.position : 0;
			if (lane === 0) {
				continue;
			}
			const color = opts.getColor(theme);
			const viewStartLineNumber = decoration.range.startLineNumber;
			const viewEndLineNumber = decoration.range.endLineNumber;

			result.accept(color, viewStartLineNumber, viewEndLineNumber, lane);
		}
		return result.result;
	}

	public getDecorationsInRange(range: Range, ownerId: number, filterOutValidation: boolean): IModelDecoration[] {
		return this.model.getDecorationsInRange(range, ownerId, filterOutValidation);
	}
}

class OverviewRulerDecorations {

	readonly result: IOverviewRulerDecorations = Object.create(null);

	public accept(color: string, startLineNumber: number, endLineNumber: number, lane: number): void {
		let prev = this.result[color];

		if (prev) {
			const prevLane = prev[prev.length - 3];
			const prevEndLineNumber = prev[prev.length - 1];
			if (prevLane === lane && prevEndLineNumber + 1 >= startLineNumber) {
				// merge into prev
				if (endLineNumber > prevEndLineNumber) {
					prev[prev.length - 1] = endLineNumber;
				}
				return;
			}

			// push
			prev.push(lane, startLineNumber, endLineNumber);
		} else {
			this.result[color] = [lane, startLineNumber, endLineNumber];
		}
	}
}
