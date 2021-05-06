/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Selection } from 'vs/editor/common/core/selection';
import { EndOfLineSequence, ICursorStateComputer, IIdentifiedSingleEditOperation, IValidEditOperation, ITextModel } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import { IUndoRedoService, IResourceUndoRedoElement, UndoRedoElementType, IWorkspaceUndoRedoElement } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { TextChange, compressConsecutiveTextChanges } from 'vs/editor/common/model/textChange';
import * as buffer from 'vs/base/common/buffer';
import { IDisposable } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/resources';

function uriGetComparisonKey(resource: URI): string {
	return resource.toString();
}

export class SingleModelEditStackData {

	public static create(model: ITextModel, beforeCursorState: Selection[] | null): SingleModelEditStackData {
		const alternativeVersionId = model.getAlternativeVersionId();
		const eol = getModelEOL(model);
		return new SingleModelEditStackData(
			alternativeVersionId,
			alternativeVersionId,
			eol,
			eol,
			beforeCursorState,
			beforeCursorState,
			[]
		);
	}

	constructor(
		public readonly beforeVersionId: number,
		public afterVersionId: number,
		public readonly beforeEOL: EndOfLineSequence,
		public afterEOL: EndOfLineSequence,
		public readonly beforeCursorState: Selection[] | null,
		public afterCursorState: Selection[] | null,
		public changes: TextChange[]
	) { }

	public append(model: ITextModel, textChanges: TextChange[], afterEOL: EndOfLineSequence, afterVersionId: number, afterCursorState: Selection[] | null): void {
		if (textChanges.length > 0) {
			this.changes = compressConsecutiveTextChanges(this.changes, textChanges);
		}
		this.afterEOL = afterEOL;
		this.afterVersionId = afterVersionId;
		this.afterCursorState = afterCursorState;
	}

	private static _writeSelectionsSize(selections: Selection[] | null): number {
		return 4 + 4 * 4 * (selections ? selections.length : 0);
	}

	private static _writeSelections(b: Uint8Array, selections: Selection[] | null, offset: number): number {
		buffer.writeUInt32BE(b, (selections ? selections.length : 0), offset); offset += 4;
		if (selections) {
			for (const selection of selections) {
				buffer.writeUInt32BE(b, selection.selectionStartLineNumber, offset); offset += 4;
				buffer.writeUInt32BE(b, selection.selectionStartColumn, offset); offset += 4;
				buffer.writeUInt32BE(b, selection.positionLineNumber, offset); offset += 4;
				buffer.writeUInt32BE(b, selection.positionColumn, offset); offset += 4;
			}
		}
		return offset;
	}

	private static _readSelections(b: Uint8Array, offset: number, dest: Selection[]): number {
		const count = buffer.readUInt32BE(b, offset); offset += 4;
		for (let i = 0; i < count; i++) {
			const selectionStartLineNumber = buffer.readUInt32BE(b, offset); offset += 4;
			const selectionStartColumn = buffer.readUInt32BE(b, offset); offset += 4;
			const positionLineNumber = buffer.readUInt32BE(b, offset); offset += 4;
			const positionColumn = buffer.readUInt32BE(b, offset); offset += 4;
			dest.push(new Selection(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn));
		}
		return offset;
	}

	public serialize(): ArrayBuffer {
		let necessarySize = (
			+ 4 // beforeVersionId
			+ 4 // afterVersionId
			+ 1 // beforeEOL
			+ 1 // afterEOL
			+ SingleModelEditStackData._writeSelectionsSize(this.beforeCursorState)
			+ SingleModelEditStackData._writeSelectionsSize(this.afterCursorState)
			+ 4 // change count
		);
		for (const change of this.changes) {
			necessarySize += change.writeSize();
		}

		const b = new Uint8Array(necessarySize);
		let offset = 0;
		buffer.writeUInt32BE(b, this.beforeVersionId, offset); offset += 4;
		buffer.writeUInt32BE(b, this.afterVersionId, offset); offset += 4;
		buffer.writeUInt8(b, this.beforeEOL, offset); offset += 1;
		buffer.writeUInt8(b, this.afterEOL, offset); offset += 1;
		offset = SingleModelEditStackData._writeSelections(b, this.beforeCursorState, offset);
		offset = SingleModelEditStackData._writeSelections(b, this.afterCursorState, offset);
		buffer.writeUInt32BE(b, this.changes.length, offset); offset += 4;
		for (const change of this.changes) {
			offset = change.write(b, offset);
		}
		return b.buffer;
	}

	public static deserialize(source: ArrayBuffer): SingleModelEditStackData {
		const b = new Uint8Array(source);
		let offset = 0;
		const beforeVersionId = buffer.readUInt32BE(b, offset); offset += 4;
		const afterVersionId = buffer.readUInt32BE(b, offset); offset += 4;
		const beforeEOL = buffer.readUInt8(b, offset); offset += 1;
		const afterEOL = buffer.readUInt8(b, offset); offset += 1;
		const beforeCursorState: Selection[] = [];
		offset = SingleModelEditStackData._readSelections(b, offset, beforeCursorState);
		const afterCursorState: Selection[] = [];
		offset = SingleModelEditStackData._readSelections(b, offset, afterCursorState);
		const changeCount = buffer.readUInt32BE(b, offset); offset += 4;
		const changes: TextChange[] = [];
		for (let i = 0; i < changeCount; i++) {
			offset = TextChange.read(b, offset, changes);
		}
		return new SingleModelEditStackData(
			beforeVersionId,
			afterVersionId,
			beforeEOL,
			afterEOL,
			beforeCursorState,
			afterCursorState,
			changes
		);
	}
}

export interface IUndoRedoDelegate {
	prepareUndoRedo(element: MultiModelEditStackElement): Promise<IDisposable> | IDisposable | void;
}

export class SingleModelEditStackElement implements IResourceUndoRedoElement {

	public model: ITextModel | URI;
	private _data: SingleModelEditStackData | ArrayBuffer;

	public get type(): UndoRedoElementType.Resource {
		return UndoRedoElementType.Resource;
	}

	public get resource(): URI {
		if (URI.isUri(this.model)) {
			return this.model;
		}
		return this.model.uri;
	}

	public get label(): string {
		return nls.localize('edit', "Typing");
	}

	constructor(model: ITextModel, beforeCursorState: Selection[] | null) {
		this.model = model;
		this._data = SingleModelEditStackData.create(model, beforeCursorState);
	}

	public toString(): string {
		const data = (this._data instanceof SingleModelEditStackData ? this._data : SingleModelEditStackData.deserialize(this._data));
		return data.changes.map(change => change.toString()).join(', ');
	}

	public matchesResource(resource: URI): boolean {
		const uri = (URI.isUri(this.model) ? this.model : this.model.uri);
		return (uri.toString() === resource.toString());
	}

	public setModel(model: ITextModel | URI): void {
		this.model = model;
	}

	public canAppend(model: ITextModel): boolean {
		return (this.model === model && this._data instanceof SingleModelEditStackData);
	}

	public append(model: ITextModel, textChanges: TextChange[], afterEOL: EndOfLineSequence, afterVersionId: number, afterCursorState: Selection[] | null): void {
		if (this._data instanceof SingleModelEditStackData) {
			this._data.append(model, textChanges, afterEOL, afterVersionId, afterCursorState);
		}
	}

	public close(): void {
		if (this._data instanceof SingleModelEditStackData) {
			this._data = this._data.serialize();
		}
	}

	public open(): void {
		if (!(this._data instanceof SingleModelEditStackData)) {
			this._data = SingleModelEditStackData.deserialize(this._data);
		}
	}

	public undo(): void {
		if (URI.isUri(this.model)) {
			// don't have a model
			throw new Error(`Invalid SingleModelEditStackElement`);
		}
		if (this._data instanceof SingleModelEditStackData) {
			this._data = this._data.serialize();
		}
		const data = SingleModelEditStackData.deserialize(this._data);
		this.model._applyUndo(data.changes, data.beforeEOL, data.beforeVersionId, data.beforeCursorState);
	}

	public redo(): void {
		if (URI.isUri(this.model)) {
			// don't have a model
			throw new Error(`Invalid SingleModelEditStackElement`);
		}
		if (this._data instanceof SingleModelEditStackData) {
			this._data = this._data.serialize();
		}
		const data = SingleModelEditStackData.deserialize(this._data);
		this.model._applyRedo(data.changes, data.afterEOL, data.afterVersionId, data.afterCursorState);
	}

	public heapSize(): number {
		if (this._data instanceof SingleModelEditStackData) {
			this._data = this._data.serialize();
		}
		return this._data.byteLength + 168/*heap overhead*/;
	}
}

export class MultiModelEditStackElement implements IWorkspaceUndoRedoElement {

	public readonly type = UndoRedoElementType.Workspace;
	public readonly label: string;
	private _isOpen: boolean;

	private readonly _editStackElementsArr: SingleModelEditStackElement[];
	private readonly _editStackElementsMap: Map<string, SingleModelEditStackElement>;

	private _delegate: IUndoRedoDelegate | null;

	public get resources(): readonly URI[] {
		return this._editStackElementsArr.map(editStackElement => editStackElement.resource);
	}

	constructor(
		label: string,
		editStackElements: SingleModelEditStackElement[]
	) {
		this.label = label;
		this._isOpen = true;
		this._editStackElementsArr = editStackElements.slice(0);
		this._editStackElementsMap = new Map<string, SingleModelEditStackElement>();
		for (const editStackElement of this._editStackElementsArr) {
			const key = uriGetComparisonKey(editStackElement.resource);
			this._editStackElementsMap.set(key, editStackElement);
		}
		this._delegate = null;
	}

	public setDelegate(delegate: IUndoRedoDelegate): void {
		this._delegate = delegate;
	}

	public prepareUndoRedo(): Promise<IDisposable> | IDisposable | void {
		if (this._delegate) {
			return this._delegate.prepareUndoRedo(this);
		}
	}

	public getMissingModels(): URI[] {
		const result: URI[] = [];
		for (const editStackElement of this._editStackElementsArr) {
			if (URI.isUri(editStackElement.model)) {
				result.push(editStackElement.model);
			}
		}
		return result;
	}

	public matchesResource(resource: URI): boolean {
		const key = uriGetComparisonKey(resource);
		return (this._editStackElementsMap.has(key));
	}

	public setModel(model: ITextModel | URI): void {
		const key = uriGetComparisonKey(URI.isUri(model) ? model : model.uri);
		if (this._editStackElementsMap.has(key)) {
			this._editStackElementsMap.get(key)!.setModel(model);
		}
	}

	public canAppend(model: ITextModel): boolean {
		if (!this._isOpen) {
			return false;
		}
		const key = uriGetComparisonKey(model.uri);
		if (this._editStackElementsMap.has(key)) {
			const editStackElement = this._editStackElementsMap.get(key)!;
			return editStackElement.canAppend(model);
		}
		return false;
	}

	public append(model: ITextModel, textChanges: TextChange[], afterEOL: EndOfLineSequence, afterVersionId: number, afterCursorState: Selection[] | null): void {
		const key = uriGetComparisonKey(model.uri);
		const editStackElement = this._editStackElementsMap.get(key)!;
		editStackElement.append(model, textChanges, afterEOL, afterVersionId, afterCursorState);
	}

	public close(): void {
		this._isOpen = false;
	}

	public open(): void {
		// cannot reopen
	}

	public undo(): void {
		this._isOpen = false;

		for (const editStackElement of this._editStackElementsArr) {
			editStackElement.undo();
		}
	}

	public redo(): void {
		for (const editStackElement of this._editStackElementsArr) {
			editStackElement.redo();
		}
	}

	public heapSize(resource: URI): number {
		const key = uriGetComparisonKey(resource);
		if (this._editStackElementsMap.has(key)) {
			const editStackElement = this._editStackElementsMap.get(key)!;
			return editStackElement.heapSize();
		}
		return 0;
	}

	public split(): IResourceUndoRedoElement[] {
		return this._editStackElementsArr;
	}

	public toString(): string {
		let result: string[] = [];
		for (const editStackElement of this._editStackElementsArr) {
			result.push(`${basename(editStackElement.resource)}: ${editStackElement}`);
		}
		return `{${result.join(', ')}}`;
	}
}

export type EditStackElement = SingleModelEditStackElement | MultiModelEditStackElement;

function getModelEOL(model: ITextModel): EndOfLineSequence {
	const eol = model.getEOL();
	if (eol === '\n') {
		return EndOfLineSequence.LF;
	} else {
		return EndOfLineSequence.CRLF;
	}
}

export function isEditStackElement(element: IResourceUndoRedoElement | IWorkspaceUndoRedoElement | null): element is EditStackElement {
	if (!element) {
		return false;
	}
	return ((element instanceof SingleModelEditStackElement) || (element instanceof MultiModelEditStackElement));
}

export class EditStack {

	private readonly _model: TextModel;
	private readonly _undoRedoService: IUndoRedoService;

	constructor(model: TextModel, undoRedoService: IUndoRedoService) {
		this._model = model;
		this._undoRedoService = undoRedoService;
	}

	public pushStackElement(): void {
		const lastElement = this._undoRedoService.getLastElement(this._model.uri);
		if (isEditStackElement(lastElement)) {
			lastElement.close();
		}
	}

	public popStackElement(): void {
		const lastElement = this._undoRedoService.getLastElement(this._model.uri);
		if (isEditStackElement(lastElement)) {
			lastElement.open();
		}
	}

	public clear(): void {
		this._undoRedoService.removeElements(this._model.uri);
	}

	private _getOrCreateEditStackElement(beforeCursorState: Selection[] | null): EditStackElement {
		const lastElement = this._undoRedoService.getLastElement(this._model.uri);
		if (isEditStackElement(lastElement) && lastElement.canAppend(this._model)) {
			return lastElement;
		}
		const newElement = new SingleModelEditStackElement(this._model, beforeCursorState);
		this._undoRedoService.pushElement(newElement);
		return newElement;
	}

	public pushEOL(eol: EndOfLineSequence): void {
		const editStackElement = this._getOrCreateEditStackElement(null);
		this._model.setEOL(eol);
		editStackElement.append(this._model, [], getModelEOL(this._model), this._model.getAlternativeVersionId(), null);
	}

	public pushEditOperation(beforeCursorState: Selection[] | null, editOperations: IIdentifiedSingleEditOperation[], cursorStateComputer: ICursorStateComputer | null): Selection[] | null {
		const editStackElement = this._getOrCreateEditStackElement(beforeCursorState);
		const inverseEditOperations = this._model.applyEdits(editOperations, true);
		const afterCursorState = EditStack._computeCursorState(cursorStateComputer, inverseEditOperations);
		const textChanges = inverseEditOperations.map((op, index) => ({ index: index, textChange: op.textChange }));
		textChanges.sort((a, b) => {
			if (a.textChange.oldPosition === b.textChange.oldPosition) {
				return a.index - b.index;
			}
			return a.textChange.oldPosition - b.textChange.oldPosition;
		});
		editStackElement.append(this._model, textChanges.map(op => op.textChange), getModelEOL(this._model), this._model.getAlternativeVersionId(), afterCursorState);
		return afterCursorState;
	}

	private static _computeCursorState(cursorStateComputer: ICursorStateComputer | null, inverseEditOperations: IValidEditOperation[]): Selection[] | null {
		try {
			return cursorStateComputer ? cursorStateComputer(inverseEditOperations) : null;
		} catch (e) {
			onUnexpectedError(e);
			return null;
		}
	}
}
