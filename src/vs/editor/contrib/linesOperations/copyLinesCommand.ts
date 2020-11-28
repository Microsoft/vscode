/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from 'vs/editor/common/core/range';
import { Selection, SelectionDirection } from 'vs/editor/common/core/selection';
import { ICommand, IEditOperationBuilder, ICursorStateComputerData } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';

export class CopyLinesCommand implements ICommand {

	private readonly _selection: Selection;
	private readonly _isCopyingDown: boolean;
	private readonly _noop: boolean;

	private _selectionDirection: SelectionDirection;
	private _selectionId: string | null;
	private _startLineNumberDelta: number;
	private _endLineNumberDelta: number;

	constructor(selection: Selection, isCopyingDown: boolean, noop?: boolean) {
		this._selection = selection;
		this._isCopyingDown = isCopyingDown;
		this._noop = noop || false;
		this._selectionDirection = SelectionDirection.LTR;
		this._selectionId = null;
		this._startLineNumberDelta = 0;
		this._endLineNumberDelta = 0;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		let s = this._selection;

		this._startLineNumberDelta = 0;
		this._endLineNumberDelta = 0;
		if (s.startLineNumber < s.endLineNumber && s.endColumn === 1) {
			this._endLineNumberDelta = 1;
			s = s.setEndPosition(s.endLineNumber - 1, model.getLineMaxColumn(s.endLineNumber - 1));
		}

		let sourceLines: string[] = [];
		for (let i = s.startLineNumber; i <= s.endLineNumber; i++) {
			sourceLines.push(model.getLineContent(i));
		}
		const sourceText = sourceLines.join('\n');

		if (sourceText === '') {
			// Duplicating empty line
			if (this._isCopyingDown) {
				this._startLineNumberDelta++;
				this._endLineNumberDelta++;
			}
		}

		if (this._noop) {
			builder.addEditOperation(new Range(s.endLineNumber, model.getLineMaxColumn(s.endLineNumber), s.endLineNumber + 1, 1), s.endLineNumber === model.getLineCount() ? '' : '\n');
		} else {
			if (!this._isCopyingDown) {
				builder.addEditOperation(new Range(s.endLineNumber, model.getLineMaxColumn(s.endLineNumber), s.endLineNumber, model.getLineMaxColumn(s.endLineNumber)), '\n' + sourceText);
			} else {
				builder.addEditOperation(new Range(s.startLineNumber, 1, s.startLineNumber, 1), sourceText + '\n');
			}
		}

		this._selectionId = builder.trackSelection(s);
		this._selectionDirection = this._selection.getDirection();
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let result = helper.getTrackedSelection(this._selectionId!);

		if (this._startLineNumberDelta !== 0 || this._endLineNumberDelta !== 0) {
			let startLineNumber = result.startLineNumber;
			let startColumn = result.startColumn;
			let endLineNumber = result.endLineNumber;
			let endColumn = result.endColumn;

			if (this._startLineNumberDelta !== 0) {
				startLineNumber = startLineNumber + this._startLineNumberDelta;
				startColumn = 1;
			}

			if (this._endLineNumberDelta !== 0) {
				endLineNumber = endLineNumber + this._endLineNumberDelta;
				endColumn = 1;
			}

			result = Selection.createWithDirection(startLineNumber, startColumn, endLineNumber, endColumn, this._selectionDirection);
		}

		return result;
	}
}
