/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';

export class ReplaceCommand implements ICommand {

	private readonly _range: Range;
	private readonly _text: string;
	public readonly insertsAutoWhitespace: boolean;

	constructor(range: Range, text: string, insertsAutoWhitespace: boolean = false) {
		this._range = range;
		this._text = text;
		this.insertsAutoWhitespace = insertsAutoWhitespace;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._range, this._text);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let inverseEditOperations = helper.getInverseEditOperations();
		let srcRange = inverseEditOperations[0].range;
		return new Selection(
			srcRange.endLineNumber,
			srcRange.endColumn,
			srcRange.endLineNumber,
			srcRange.endColumn
		);
	}
}

export class ReplaceCommandThatSelectsText implements ICommand {

	private readonly _range: Range;
	private readonly _text: string;

	constructor(range: Range, text: string) {
		this._range = range;
		this._text = text;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._range, this._text);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		const srcRange = inverseEditOperations[0].range;
		return new Selection(srcRange.startLineNumber, srcRange.startColumn, srcRange.endLineNumber, srcRange.endColumn);
	}
}

export class ReplaceCommandWithoutChangingPosition implements ICommand {

	private readonly _range: Range;
	private readonly _text: string;
	public readonly insertsAutoWhitespace: boolean;

	constructor(range: Range, text: string, insertsAutoWhitespace: boolean = false) {
		this._range = range;
		this._text = text;
		this.insertsAutoWhitespace = insertsAutoWhitespace;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._range, this._text);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let inverseEditOperations = helper.getInverseEditOperations();
		let srcRange = inverseEditOperations[0].range;
		return new Selection(
			srcRange.startLineNumber,
			srcRange.startColumn,
			srcRange.startLineNumber,
			srcRange.startColumn
		);
	}
}

export class ReplaceCommandWithOffsetCursorState implements ICommand {

	private readonly _range: Range;
	private readonly _text: string;
	private readonly _columnDeltaOffset: number;
	private readonly _lineNumberDeltaOffset: number;
	public readonly insertsAutoWhitespace: boolean;

	constructor(range: Range, text: string, lineNumberDeltaOffset: number, columnDeltaOffset: number, insertsAutoWhitespace: boolean = false) {
		this._range = range;
		this._text = text;
		this._columnDeltaOffset = columnDeltaOffset;
		this._lineNumberDeltaOffset = lineNumberDeltaOffset;
		this.insertsAutoWhitespace = insertsAutoWhitespace;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._range, this._text);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let inverseEditOperations = helper.getInverseEditOperations();
		let srcRange = inverseEditOperations[0].range;
		return new Selection(
			srcRange.endLineNumber + this._lineNumberDeltaOffset,
			srcRange.endColumn + this._columnDeltaOffset,
			srcRange.endLineNumber + this._lineNumberDeltaOffset,
			srcRange.endColumn + this._columnDeltaOffset
		);
	}
}

export class ReplaceCommandThatPreservesSelection implements ICommand {

	private readonly _range: Range;
	private readonly _text: string;
	private readonly _initialSelection: Selection;
	private readonly _forceMoveMarkers: boolean;
	private _selectionId: string | null;

	constructor(editRange: Range, text: string, initialSelection: Selection, forceMoveMarkers: boolean = false) {
		this._range = editRange;
		this._text = text;
		this._initialSelection = initialSelection;
		this._forceMoveMarkers = forceMoveMarkers;
		this._selectionId = null;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		builder.addTrackedEditOperation(this._range, this._text, this._forceMoveMarkers);
		this._selectionId = builder.trackSelection(this._initialSelection);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		return helper.getTrackedSelection(this._selectionId!);
	}
}
