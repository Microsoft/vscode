/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';

export class SurroundSelectionCommand implements ICommand {
	private readonly _range: Selection;
	private readonly _charBeforeSelection: string;
	private readonly _charAfterSelection: string;

	constructor(range: Selection, charBeforeSelection: string, charAfterSelection: string) {
		this._range = range;
		this._charBeforeSelection = charBeforeSelection;
		this._charAfterSelection = charAfterSelection;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(new Range(
			this._range.startLineNumber,
			this._range.startColumn,
			this._range.startLineNumber,
			this._range.startColumn
		), this._charBeforeSelection);

		builder.addTrackedEditOperation(new Range(
			this._range.endLineNumber,
			this._range.endColumn,
			this._range.endLineNumber,
			this._range.endColumn
		), this._charAfterSelection);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let inverseEditOperations = helper.getInverseEditOperations();
		let firstOperationRange = inverseEditOperations[0].range;
		let secondOperationRange = inverseEditOperations[1].range;

		return new Selection(
			firstOperationRange.endLineNumber,
			firstOperationRange.endColumn,
			secondOperationRange.endLineNumber,
			secondOperationRange.endColumn - this._charAfterSelection.length
		);
	}
}
