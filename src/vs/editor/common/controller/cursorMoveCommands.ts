/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as types from 'vs/base/common/types';
import { CursorState, ICursorSimpleModel, PartialCursorState, SingleCursorState } from 'vs/editor/common/controller/cursorCommon';
import { MoveOperations } from 'vs/editor/common/controller/cursorMoveOperations';
import { WordOperations } from 'vs/editor/common/controller/cursorWordOperations';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { IViewModel } from 'vs/editor/common/viewModel/viewModel';

export class CursorMoveCommands {

	public static addCursorDown(viewModel: IViewModel, cursors: CursorState[], useLogicalLine: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [], resultLen = 0;
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[resultLen++] = new CursorState(cursor.modelState, cursor.viewState);
			if (useLogicalLine) {
				result[resultLen++] = CursorState.fromModelState(MoveOperations.translateDown(viewModel.cursorConfig, viewModel.model, cursor.modelState));
			} else {
				result[resultLen++] = CursorState.fromViewState(MoveOperations.translateDown(viewModel.cursorConfig, viewModel, cursor.viewState));
			}
		}
		return result;
	}

	public static addCursorUp(viewModel: IViewModel, cursors: CursorState[], useLogicalLine: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [], resultLen = 0;
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[resultLen++] = new CursorState(cursor.modelState, cursor.viewState);
			if (useLogicalLine) {
				result[resultLen++] = CursorState.fromModelState(MoveOperations.translateUp(viewModel.cursorConfig, viewModel.model, cursor.modelState));
			} else {
				result[resultLen++] = CursorState.fromViewState(MoveOperations.translateUp(viewModel.cursorConfig, viewModel, cursor.viewState));
			}
		}
		return result;
	}

	public static moveToBeginningOfLine(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = this._moveToLineStart(viewModel, cursor, inSelectionMode);
		}

		return result;
	}

	private static _moveToLineStart(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean): PartialCursorState {
		const currentViewStateColumn = cursor.viewState.position.column;
		const currentModelStateColumn = cursor.modelState.position.column;
		const isFirstLineOfWrappedLine = currentViewStateColumn === currentModelStateColumn;

		const currentViewStatelineNumber = cursor.viewState.position.lineNumber;
		const firstNonBlankColumn = viewModel.getLineFirstNonWhitespaceColumn(currentViewStatelineNumber);
		const isBeginningOfViewLine = currentViewStateColumn === firstNonBlankColumn;

		if (!isFirstLineOfWrappedLine && !isBeginningOfViewLine) {
			return this._moveToLineStartByView(viewModel, cursor, inSelectionMode);
		} else {
			return this._moveToLineStartByModel(viewModel, cursor, inSelectionMode);
		}
	}

	private static _moveToLineStartByView(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean): PartialCursorState {
		return CursorState.fromViewState(
			MoveOperations.moveToBeginningOfLine(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode)
		);
	}

	private static _moveToLineStartByModel(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean): PartialCursorState {
		return CursorState.fromModelState(
			MoveOperations.moveToBeginningOfLine(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode)
		);
	}

	public static moveToEndOfLine(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, sticky: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = this._moveToLineEnd(viewModel, cursor, inSelectionMode, sticky);
		}

		return result;
	}

	private static _moveToLineEnd(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, sticky: boolean): PartialCursorState {
		const viewStatePosition = cursor.viewState.position;
		const viewModelMaxColumn = viewModel.getLineMaxColumn(viewStatePosition.lineNumber);
		const isEndOfViewLine = viewStatePosition.column === viewModelMaxColumn;

		const modelStatePosition = cursor.modelState.position;
		const modelMaxColumn = viewModel.model.getLineMaxColumn(modelStatePosition.lineNumber);
		const isEndLineOfWrappedLine = viewModelMaxColumn - viewStatePosition.column === modelMaxColumn - modelStatePosition.column;

		if (isEndOfViewLine || isEndLineOfWrappedLine) {
			return this._moveToLineEndByModel(viewModel, cursor, inSelectionMode, sticky);
		} else {
			return this._moveToLineEndByView(viewModel, cursor, inSelectionMode, sticky);
		}
	}

	private static _moveToLineEndByView(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, sticky: boolean): PartialCursorState {
		return CursorState.fromViewState(
			MoveOperations.moveToEndOfLine(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, sticky)
		);
	}

	private static _moveToLineEndByModel(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, sticky: boolean): PartialCursorState {
		return CursorState.fromModelState(
			MoveOperations.moveToEndOfLine(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode, sticky)
		);
	}

	public static expandLineSelection(viewModel: IViewModel, cursors: CursorState[]): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];

			const startLineNumber = cursor.modelState.selection.startLineNumber;
			const lineCount = viewModel.model.getLineCount();

			let endLineNumber = cursor.modelState.selection.endLineNumber;
			let endColumn: number;
			if (endLineNumber === lineCount) {
				endColumn = viewModel.model.getLineMaxColumn(lineCount);
			} else {
				endLineNumber++;
				endColumn = 1;
			}

			result[i] = CursorState.fromModelState(new SingleCursorState(
				new Range(startLineNumber, 1, startLineNumber, 1), 0,
				new Position(endLineNumber, endColumn), 0
			));
		}
		return result;
	}

	public static moveToBeginningOfBuffer(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = CursorState.fromModelState(MoveOperations.moveToBeginningOfBuffer(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode));
		}
		return result;
	}

	public static moveToEndOfBuffer(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = CursorState.fromModelState(MoveOperations.moveToEndOfBuffer(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode));
		}
		return result;
	}

	public static selectAll(viewModel: IViewModel, cursor: CursorState): PartialCursorState {
		const lineCount = viewModel.model.getLineCount();
		const maxColumn = viewModel.model.getLineMaxColumn(lineCount);

		return CursorState.fromModelState(new SingleCursorState(
			new Range(1, 1, 1, 1), 0,
			new Position(lineCount, maxColumn), 0
		));
	}

	public static line(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, _position: IPosition, _viewPosition: IPosition): PartialCursorState {
		const position = viewModel.model.validatePosition(_position);
		const viewPosition = (
			_viewPosition
				? viewModel.coordinatesConverter.validateViewPosition(new Position(_viewPosition.lineNumber, _viewPosition.column), position)
				: viewModel.coordinatesConverter.convertModelPositionToViewPosition(position)
		);

		if (!inSelectionMode || !cursor.modelState.hasSelection()) {
			// Entering line selection for the first time
			const lineCount = viewModel.model.getLineCount();

			let selectToLineNumber = position.lineNumber + 1;
			let selectToColumn = 1;
			if (selectToLineNumber > lineCount) {
				selectToLineNumber = lineCount;
				selectToColumn = viewModel.model.getLineMaxColumn(selectToLineNumber);
			}

			return CursorState.fromModelState(new SingleCursorState(
				new Range(position.lineNumber, 1, selectToLineNumber, selectToColumn), 0,
				new Position(selectToLineNumber, selectToColumn), 0
			));
		}

		// Continuing line selection
		const enteringLineNumber = cursor.modelState.selectionStart.getStartPosition().lineNumber;

		if (position.lineNumber < enteringLineNumber) {

			return CursorState.fromViewState(cursor.viewState.move(
				cursor.modelState.hasSelection(), viewPosition.lineNumber, 1, 0
			));

		} else if (position.lineNumber > enteringLineNumber) {

			const lineCount = viewModel.getLineCount();

			let selectToViewLineNumber = viewPosition.lineNumber + 1;
			let selectToViewColumn = 1;
			if (selectToViewLineNumber > lineCount) {
				selectToViewLineNumber = lineCount;
				selectToViewColumn = viewModel.getLineMaxColumn(selectToViewLineNumber);
			}

			return CursorState.fromViewState(cursor.viewState.move(
				cursor.modelState.hasSelection(), selectToViewLineNumber, selectToViewColumn, 0
			));

		} else {

			const endPositionOfSelectionStart = cursor.modelState.selectionStart.getEndPosition();
			return CursorState.fromModelState(cursor.modelState.move(
				cursor.modelState.hasSelection(), endPositionOfSelectionStart.lineNumber, endPositionOfSelectionStart.column, 0
			));

		}
	}

	public static word(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, _position: IPosition): PartialCursorState {
		const position = viewModel.model.validatePosition(_position);
		return CursorState.fromModelState(WordOperations.word(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode, position));
	}

	public static cancelSelection(viewModel: IViewModel, cursor: CursorState): PartialCursorState {
		if (!cursor.modelState.hasSelection()) {
			return new CursorState(cursor.modelState, cursor.viewState);
		}

		const lineNumber = cursor.viewState.position.lineNumber;
		const column = cursor.viewState.position.column;

		return CursorState.fromViewState(new SingleCursorState(
			new Range(lineNumber, column, lineNumber, column), 0,
			new Position(lineNumber, column), 0
		));
	}

	public static moveTo(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, _position: IPosition, _viewPosition: IPosition): PartialCursorState {
		const position = viewModel.model.validatePosition(_position);
		const viewPosition = (
			_viewPosition
				? viewModel.coordinatesConverter.validateViewPosition(new Position(_viewPosition.lineNumber, _viewPosition.column), position)
				: viewModel.coordinatesConverter.convertModelPositionToViewPosition(position)
		);
		return CursorState.fromViewState(cursor.viewState.move(inSelectionMode, viewPosition.lineNumber, viewPosition.column, 0));
	}

	public static simpleMove(viewModel: IViewModel, cursors: CursorState[], direction: CursorMove.SimpleMoveDirection, inSelectionMode: boolean, value: number, unit: CursorMove.Unit): PartialCursorState[] | null {
		switch (direction) {
			case CursorMove.Direction.Left: {
				if (unit === CursorMove.Unit.HalfLine) {
					// Move left by half the current line length
					return this._moveHalfLineLeft(viewModel, cursors, inSelectionMode);
				} else {
					// Move left by `moveParams.value` columns
					return this._moveLeft(viewModel, cursors, inSelectionMode, value);
				}
			}
			case CursorMove.Direction.Right: {
				if (unit === CursorMove.Unit.HalfLine) {
					// Move right by half the current line length
					return this._moveHalfLineRight(viewModel, cursors, inSelectionMode);
				} else {
					// Move right by `moveParams.value` columns
					return this._moveRight(viewModel, cursors, inSelectionMode, value);
				}
			}
			case CursorMove.Direction.Up: {
				if (unit === CursorMove.Unit.WrappedLine) {
					// Move up by view lines
					return this._moveUpByViewLines(viewModel, cursors, inSelectionMode, value);
				} else {
					// Move up by model lines
					return this._moveUpByModelLines(viewModel, cursors, inSelectionMode, value);
				}
			}
			case CursorMove.Direction.Down: {
				if (unit === CursorMove.Unit.WrappedLine) {
					// Move down by view lines
					return this._moveDownByViewLines(viewModel, cursors, inSelectionMode, value);
				} else {
					// Move down by model lines
					return this._moveDownByModelLines(viewModel, cursors, inSelectionMode, value);
				}
			}
			case CursorMove.Direction.WrappedLineStart: {
				// Move to the beginning of the current view line
				return this._moveToViewMinColumn(viewModel, cursors, inSelectionMode);
			}
			case CursorMove.Direction.WrappedLineFirstNonWhitespaceCharacter: {
				// Move to the first non-whitespace column of the current view line
				return this._moveToViewFirstNonWhitespaceColumn(viewModel, cursors, inSelectionMode);
			}
			case CursorMove.Direction.WrappedLineColumnCenter: {
				// Move to the "center" of the current view line
				return this._moveToViewCenterColumn(viewModel, cursors, inSelectionMode);
			}
			case CursorMove.Direction.WrappedLineEnd: {
				// Move to the end of the current view line
				return this._moveToViewMaxColumn(viewModel, cursors, inSelectionMode);
			}
			case CursorMove.Direction.WrappedLineLastNonWhitespaceCharacter: {
				// Move to the last non-whitespace column of the current view line
				return this._moveToViewLastNonWhitespaceColumn(viewModel, cursors, inSelectionMode);
			}
			default:
				return null;
		}

	}

	public static viewportMove(viewModel: IViewModel, cursors: CursorState[], direction: CursorMove.ViewportDirection, inSelectionMode: boolean, value: number): PartialCursorState[] | null {
		const visibleViewRange = viewModel.getCompletelyVisibleViewRange();
		const visibleModelRange = viewModel.coordinatesConverter.convertViewRangeToModelRange(visibleViewRange);
		switch (direction) {
			case CursorMove.Direction.ViewPortTop: {
				// Move to the nth line start in the viewport (from the top)
				const modelLineNumber = this._firstLineNumberInRange(viewModel.model, visibleModelRange, value);
				const modelColumn = viewModel.model.getLineFirstNonWhitespaceColumn(modelLineNumber);
				return [this._moveToModelPosition(viewModel, cursors[0], inSelectionMode, modelLineNumber, modelColumn)];
			}
			case CursorMove.Direction.ViewPortBottom: {
				// Move to the nth line start in the viewport (from the bottom)
				const modelLineNumber = this._lastLineNumberInRange(viewModel.model, visibleModelRange, value);
				const modelColumn = viewModel.model.getLineFirstNonWhitespaceColumn(modelLineNumber);
				return [this._moveToModelPosition(viewModel, cursors[0], inSelectionMode, modelLineNumber, modelColumn)];
			}
			case CursorMove.Direction.ViewPortCenter: {
				// Move to the line start in the viewport center
				const modelLineNumber = Math.round((visibleModelRange.startLineNumber + visibleModelRange.endLineNumber) / 2);
				const modelColumn = viewModel.model.getLineFirstNonWhitespaceColumn(modelLineNumber);
				return [this._moveToModelPosition(viewModel, cursors[0], inSelectionMode, modelLineNumber, modelColumn)];
			}
			case CursorMove.Direction.ViewPortIfOutside: {
				// Move to a position inside the viewport
				let result: PartialCursorState[] = [];
				for (let i = 0, len = cursors.length; i < len; i++) {
					const cursor = cursors[i];
					result[i] = this.findPositionInViewportIfOutside(viewModel, cursor, visibleViewRange, inSelectionMode);
				}
				return result;
			}
			default:
				return null;
		}
	}

	public static findPositionInViewportIfOutside(viewModel: IViewModel, cursor: CursorState, visibleViewRange: Range, inSelectionMode: boolean): PartialCursorState {
		let viewLineNumber = cursor.viewState.position.lineNumber;

		if (visibleViewRange.startLineNumber <= viewLineNumber && viewLineNumber <= visibleViewRange.endLineNumber - 1) {
			// Nothing to do, cursor is in viewport
			return new CursorState(cursor.modelState, cursor.viewState);

		} else {
			if (viewLineNumber > visibleViewRange.endLineNumber - 1) {
				viewLineNumber = visibleViewRange.endLineNumber - 1;
			}
			if (viewLineNumber < visibleViewRange.startLineNumber) {
				viewLineNumber = visibleViewRange.startLineNumber;
			}
			const viewColumn = viewModel.getLineFirstNonWhitespaceColumn(viewLineNumber);
			return this._moveToViewPosition(viewModel, cursor, inSelectionMode, viewLineNumber, viewColumn);
		}
	}

	/**
	 * Find the nth line start included in the range (from the start).
	 */
	private static _firstLineNumberInRange(model: ICursorSimpleModel, range: Range, count: number): number {
		let startLineNumber = range.startLineNumber;
		if (range.startColumn !== model.getLineMinColumn(startLineNumber)) {
			// Move on to the second line if the first line start is not included in the range
			startLineNumber++;
		}

		return Math.min(range.endLineNumber, startLineNumber + count - 1);
	}

	/**
	 * Find the nth line start included in the range (from the end).
	 */
	private static _lastLineNumberInRange(model: ICursorSimpleModel, range: Range, count: number): number {
		let startLineNumber = range.startLineNumber;
		if (range.startColumn !== model.getLineMinColumn(startLineNumber)) {
			// Move on to the second line if the first line start is not included in the range
			startLineNumber++;
		}

		return Math.max(startLineNumber, range.endLineNumber - count + 1);
	}

	private static _moveLeft(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, noOfColumns: number): PartialCursorState[] {
		const hasMultipleCursors = (cursors.length > 1);
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const skipWrappingPointStop = hasMultipleCursors || !cursor.viewState.hasSelection();
			let newViewState = MoveOperations.moveLeft(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, noOfColumns);

			if (skipWrappingPointStop
				&& noOfColumns === 1
				&& cursor.viewState.position.column === viewModel.getLineMinColumn(cursor.viewState.position.lineNumber)
				&& newViewState.position.lineNumber !== cursor.viewState.position.lineNumber
			) {
				// moved over to the previous view line
				const newViewModelPosition = viewModel.coordinatesConverter.convertViewPositionToModelPosition(newViewState.position);
				if (newViewModelPosition.lineNumber === cursor.modelState.position.lineNumber) {
					// stayed on the same model line => pass wrapping point where 2 view positions map to a single model position
					newViewState = MoveOperations.moveLeft(viewModel.cursorConfig, viewModel, newViewState, inSelectionMode, 1);
				}
			}

			result[i] = CursorState.fromViewState(newViewState);
		}
		return result;
	}

	private static _moveHalfLineLeft(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const halfLine = Math.round(viewModel.getLineContent(viewLineNumber).length / 2);
			result[i] = CursorState.fromViewState(MoveOperations.moveLeft(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, halfLine));
		}
		return result;
	}

	private static _moveRight(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, noOfColumns: number): PartialCursorState[] {
		const hasMultipleCursors = (cursors.length > 1);
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const skipWrappingPointStop = hasMultipleCursors || !cursor.viewState.hasSelection();
			let newViewState = MoveOperations.moveRight(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, noOfColumns);

			if (skipWrappingPointStop
				&& noOfColumns === 1
				&& cursor.viewState.position.column === viewModel.getLineMaxColumn(cursor.viewState.position.lineNumber)
				&& newViewState.position.lineNumber !== cursor.viewState.position.lineNumber
			) {
				// moved over to the next view line
				const newViewModelPosition = viewModel.coordinatesConverter.convertViewPositionToModelPosition(newViewState.position);
				if (newViewModelPosition.lineNumber === cursor.modelState.position.lineNumber) {
					// stayed on the same model line => pass wrapping point where 2 view positions map to a single model position
					newViewState = MoveOperations.moveRight(viewModel.cursorConfig, viewModel, newViewState, inSelectionMode, 1);
				}
			}

			result[i] = CursorState.fromViewState(newViewState);
		}
		return result;
	}

	private static _moveHalfLineRight(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const halfLine = Math.round(viewModel.getLineContent(viewLineNumber).length / 2);
			result[i] = CursorState.fromViewState(MoveOperations.moveRight(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, halfLine));
		}
		return result;
	}

	private static _moveDownByViewLines(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, linesCount: number): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = CursorState.fromViewState(MoveOperations.moveDown(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, linesCount));
		}
		return result;
	}

	private static _moveDownByModelLines(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, linesCount: number): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = CursorState.fromModelState(MoveOperations.moveDown(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode, linesCount));
		}
		return result;
	}

	private static _moveUpByViewLines(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, linesCount: number): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = CursorState.fromViewState(MoveOperations.moveUp(viewModel.cursorConfig, viewModel, cursor.viewState, inSelectionMode, linesCount));
		}
		return result;
	}

	private static _moveUpByModelLines(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean, linesCount: number): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			result[i] = CursorState.fromModelState(MoveOperations.moveUp(viewModel.cursorConfig, viewModel.model, cursor.modelState, inSelectionMode, linesCount));
		}
		return result;
	}

	private static _moveToViewPosition(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, toViewLineNumber: number, toViewColumn: number): PartialCursorState {
		return CursorState.fromViewState(cursor.viewState.move(inSelectionMode, toViewLineNumber, toViewColumn, 0));
	}

	private static _moveToModelPosition(viewModel: IViewModel, cursor: CursorState, inSelectionMode: boolean, toModelLineNumber: number, toModelColumn: number): PartialCursorState {
		return CursorState.fromModelState(cursor.modelState.move(inSelectionMode, toModelLineNumber, toModelColumn, 0));
	}

	private static _moveToViewMinColumn(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const viewColumn = viewModel.getLineMinColumn(viewLineNumber);
			result[i] = this._moveToViewPosition(viewModel, cursor, inSelectionMode, viewLineNumber, viewColumn);
		}
		return result;
	}

	private static _moveToViewFirstNonWhitespaceColumn(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const viewColumn = viewModel.getLineFirstNonWhitespaceColumn(viewLineNumber);
			result[i] = this._moveToViewPosition(viewModel, cursor, inSelectionMode, viewLineNumber, viewColumn);
		}
		return result;
	}

	private static _moveToViewCenterColumn(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const viewColumn = Math.round((viewModel.getLineMaxColumn(viewLineNumber) + viewModel.getLineMinColumn(viewLineNumber)) / 2);
			result[i] = this._moveToViewPosition(viewModel, cursor, inSelectionMode, viewLineNumber, viewColumn);
		}
		return result;
	}

	private static _moveToViewMaxColumn(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const viewColumn = viewModel.getLineMaxColumn(viewLineNumber);
			result[i] = this._moveToViewPosition(viewModel, cursor, inSelectionMode, viewLineNumber, viewColumn);
		}
		return result;
	}

	private static _moveToViewLastNonWhitespaceColumn(viewModel: IViewModel, cursors: CursorState[], inSelectionMode: boolean): PartialCursorState[] {
		let result: PartialCursorState[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			const cursor = cursors[i];
			const viewLineNumber = cursor.viewState.position.lineNumber;
			const viewColumn = viewModel.getLineLastNonWhitespaceColumn(viewLineNumber);
			result[i] = this._moveToViewPosition(viewModel, cursor, inSelectionMode, viewLineNumber, viewColumn);
		}
		return result;
	}
}

export namespace CursorMove {

	const isCursorMoveArgs = function (arg: any): boolean {
		if (!types.isObject(arg)) {
			return false;
		}

		let cursorMoveArg: RawArguments = arg;

		if (!types.isString(cursorMoveArg.to)) {
			return false;
		}

		if (!types.isUndefined(cursorMoveArg.select) && !types.isBoolean(cursorMoveArg.select)) {
			return false;
		}

		if (!types.isUndefined(cursorMoveArg.by) && !types.isString(cursorMoveArg.by)) {
			return false;
		}

		if (!types.isUndefined(cursorMoveArg.value) && !types.isNumber(cursorMoveArg.value)) {
			return false;
		}

		return true;
	};

	export const description = <ICommandHandlerDescription>{
		description: 'Move cursor to a logical position in the view',
		args: [
			{
				name: 'Cursor move argument object',
				description: `Property-value pairs that can be passed through this argument:
					* 'to': A mandatory logical position value providing where to move the cursor.
						\`\`\`
						'left', 'right', 'up', 'down'
						'wrappedLineStart', 'wrappedLineEnd', 'wrappedLineColumnCenter'
						'wrappedLineFirstNonWhitespaceCharacter', 'wrappedLineLastNonWhitespaceCharacter'
						'viewPortTop', 'viewPortCenter', 'viewPortBottom', 'viewPortIfOutside'
						\`\`\`
					* 'by': Unit to move. Default is computed based on 'to' value.
						\`\`\`
						'line', 'wrappedLine', 'character', 'halfLine'
						\`\`\`
					* 'value': Number of units to move. Default is '1'.
					* 'select': If 'true' makes the selection. Default is 'false'.
				`,
				constraint: isCursorMoveArgs,
				schema: {
					'type': 'object',
					'required': ['to'],
					'properties': {
						'to': {
							'type': 'string',
							'enum': ['left', 'right', 'up', 'down', 'wrappedLineStart', 'wrappedLineEnd', 'wrappedLineColumnCenter', 'wrappedLineFirstNonWhitespaceCharacter', 'wrappedLineLastNonWhitespaceCharacter', 'viewPortTop', 'viewPortCenter', 'viewPortBottom', 'viewPortIfOutside']
						},
						'by': {
							'type': 'string',
							'enum': ['line', 'wrappedLine', 'character', 'halfLine']
						},
						'value': {
							'type': 'number',
							'default': 1
						},
						'select': {
							'type': 'boolean',
							'default': false
						}
					}
				}
			}
		]
	};

	/**
	 * Positions in the view for cursor move command.
	 */
	export const RawDirection = {
		Left: 'left',
		Right: 'right',
		Up: 'up',
		Down: 'down',

		WrappedLineStart: 'wrappedLineStart',
		WrappedLineFirstNonWhitespaceCharacter: 'wrappedLineFirstNonWhitespaceCharacter',
		WrappedLineColumnCenter: 'wrappedLineColumnCenter',
		WrappedLineEnd: 'wrappedLineEnd',
		WrappedLineLastNonWhitespaceCharacter: 'wrappedLineLastNonWhitespaceCharacter',

		ViewPortTop: 'viewPortTop',
		ViewPortCenter: 'viewPortCenter',
		ViewPortBottom: 'viewPortBottom',

		ViewPortIfOutside: 'viewPortIfOutside'
	};

	/**
	 * Units for Cursor move 'by' argument
	 */
	export const RawUnit = {
		Line: 'line',
		WrappedLine: 'wrappedLine',
		Character: 'character',
		HalfLine: 'halfLine'
	};

	/**
	 * Arguments for Cursor move command
	 */
	export interface RawArguments {
		to: string;
		select?: boolean;
		by?: string;
		value?: number;
	}

	export function parse(args: RawArguments): ParsedArguments | null {
		if (!args.to) {
			// illegal arguments
			return null;
		}

		let direction: Direction;
		switch (args.to) {
			case RawDirection.Left:
				direction = Direction.Left;
				break;
			case RawDirection.Right:
				direction = Direction.Right;
				break;
			case RawDirection.Up:
				direction = Direction.Up;
				break;
			case RawDirection.Down:
				direction = Direction.Down;
				break;
			case RawDirection.WrappedLineStart:
				direction = Direction.WrappedLineStart;
				break;
			case RawDirection.WrappedLineFirstNonWhitespaceCharacter:
				direction = Direction.WrappedLineFirstNonWhitespaceCharacter;
				break;
			case RawDirection.WrappedLineColumnCenter:
				direction = Direction.WrappedLineColumnCenter;
				break;
			case RawDirection.WrappedLineEnd:
				direction = Direction.WrappedLineEnd;
				break;
			case RawDirection.WrappedLineLastNonWhitespaceCharacter:
				direction = Direction.WrappedLineLastNonWhitespaceCharacter;
				break;
			case RawDirection.ViewPortTop:
				direction = Direction.ViewPortTop;
				break;
			case RawDirection.ViewPortBottom:
				direction = Direction.ViewPortBottom;
				break;
			case RawDirection.ViewPortCenter:
				direction = Direction.ViewPortCenter;
				break;
			case RawDirection.ViewPortIfOutside:
				direction = Direction.ViewPortIfOutside;
				break;
			default:
				// illegal arguments
				return null;
		}

		let unit = Unit.None;
		switch (args.by) {
			case RawUnit.Line:
				unit = Unit.Line;
				break;
			case RawUnit.WrappedLine:
				unit = Unit.WrappedLine;
				break;
			case RawUnit.Character:
				unit = Unit.Character;
				break;
			case RawUnit.HalfLine:
				unit = Unit.HalfLine;
				break;
		}

		return {
			direction: direction,
			unit: unit,
			select: (!!args.select),
			value: (args.value || 1)
		};
	}

	export interface ParsedArguments {
		direction: Direction;
		unit: Unit;
		select: boolean;
		value: number;
	}

	export interface SimpleMoveArguments {
		direction: SimpleMoveDirection;
		unit: Unit;
		select: boolean;
		value: number;
	}

	export const enum Direction {
		Left,
		Right,
		Up,
		Down,

		WrappedLineStart,
		WrappedLineFirstNonWhitespaceCharacter,
		WrappedLineColumnCenter,
		WrappedLineEnd,
		WrappedLineLastNonWhitespaceCharacter,

		ViewPortTop,
		ViewPortCenter,
		ViewPortBottom,

		ViewPortIfOutside,
	}

	export type SimpleMoveDirection = (
		Direction.Left
		| Direction.Right
		| Direction.Up
		| Direction.Down
		| Direction.WrappedLineStart
		| Direction.WrappedLineFirstNonWhitespaceCharacter
		| Direction.WrappedLineColumnCenter
		| Direction.WrappedLineEnd
		| Direction.WrappedLineLastNonWhitespaceCharacter
	);

	export type ViewportDirection = (
		Direction.ViewPortTop
		| Direction.ViewPortCenter
		| Direction.ViewPortBottom
		| Direction.ViewPortIfOutside
	);

	export const enum Unit {
		None,
		Line,
		WrappedLine,
		Character,
		HalfLine,
	}

}
