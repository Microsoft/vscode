/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as types from 'vs/workbench/api/common/extHostTypes';
import * as vscode from 'vscode';
import { Event, Emitter } from 'vs/base/common/event';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { score } from 'vs/editor/common/modes/languageSelector';
import { ResourceMap } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';

export class ExtHostNotebookConcatDocument implements vscode.NotebookConcatTextDocument {

	private _disposables = new DisposableStore();
	private _isClosed = false;

	private _cells!: vscode.NotebookCell[];
	private _cellUris!: ResourceMap<number>;
	private _cellLengths!: PrefixSumComputer;
	private _cellLines!: PrefixSumComputer;
	private _versionId = 0;

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	readonly uri = URI.from({ scheme: 'vscode-concat-doc', path: generateUuid() });

	constructor(
		extHostNotebooks: ExtHostNotebookController,
		extHostDocuments: ExtHostDocuments,
		private readonly _notebook: vscode.NotebookDocument,
		private readonly _selector: vscode.DocumentSelector | undefined,
	) {
		this._init();

		this._disposables.add(extHostDocuments.onDidChangeDocument(e => {
			const cellIdx = this._cellUris.get(e.document.uri);
			if (cellIdx !== undefined) {
				this._cellLengths.changeValue(cellIdx, this._cells[cellIdx].document.getText().length + 1);
				this._cellLines.changeValue(cellIdx, this._cells[cellIdx].document.lineCount);
				this._versionId += 1;
				this._onDidChange.fire(undefined);
			}
		}));
		const documentChange = (document: vscode.NotebookDocument) => {
			if (document === this._notebook) {
				this._init();
				this._versionId += 1;
				this._onDidChange.fire(undefined);
			}
		};

		this._disposables.add(extHostNotebooks.onDidChangeNotebookCells(e => documentChange(e.document)));
	}

	dispose(): void {
		this._disposables.dispose();
		this._isClosed = true;
	}

	get isClosed() {
		return this._isClosed;
	}

	private _init() {
		this._cells = [];
		this._cellUris = new ResourceMap();
		const cellLengths: number[] = [];
		const cellLineCounts: number[] = [];
		for (const cell of this._notebook.getCells()) {
			if (cell.kind === types.NotebookCellKind.Code && (!this._selector || score(this._selector, cell.document.uri, cell.document.languageId, true))) {
				this._cellUris.set(cell.document.uri, this._cells.length);
				this._cells.push(cell);
				cellLengths.push(cell.document.getText().length + 1);
				cellLineCounts.push(cell.document.lineCount);
			}
		}
		this._cellLengths = new PrefixSumComputer(new Uint32Array(cellLengths));
		this._cellLines = new PrefixSumComputer(new Uint32Array(cellLineCounts));
	}

	get version(): number {
		return this._versionId;
	}

	getText(range?: vscode.Range): string {
		if (!range) {
			let result = '';
			for (const cell of this._cells) {
				result += cell.document.getText() + '\n';
			}
			// remove last newline again
			result = result.slice(0, -1);
			return result;
		}

		if (range.isEmpty) {
			return '';
		}

		// get start and end locations and create substrings
		const start = this.locationAt(range.start);
		const end = this.locationAt(range.end);
		const startCell = this._cells[this._cellUris.get(start.uri) ?? -1];
		const endCell = this._cells[this._cellUris.get(end.uri) ?? -1];

		if (!startCell || !endCell) {
			return '';
		} else if (startCell === endCell) {
			return startCell.document.getText(new types.Range(start.range.start, end.range.end));
		} else {
			const a = startCell.document.getText(new types.Range(start.range.start, new types.Position(startCell.document.lineCount, 0)));
			const b = endCell.document.getText(new types.Range(new types.Position(0, 0), end.range.end));
			return a + '\n' + b;
		}
	}

	offsetAt(position: vscode.Position): number {
		const idx = this._cellLines.getIndexOf(position.line);
		const offset1 = this._cellLengths.getAccumulatedValue(idx.index - 1);
		const offset2 = this._cells[idx.index].document.offsetAt(position.with(idx.remainder));
		return offset1 + offset2;
	}

	positionAt(locationOrOffset: vscode.Location | number): vscode.Position {
		if (typeof locationOrOffset === 'number') {
			const idx = this._cellLengths.getIndexOf(locationOrOffset);
			const lineCount = this._cellLines.getAccumulatedValue(idx.index - 1);
			return this._cells[idx.index].document.positionAt(idx.remainder).translate(lineCount);
		}

		const idx = this._cellUris.get(locationOrOffset.uri);
		if (idx !== undefined) {
			const line = this._cellLines.getAccumulatedValue(idx - 1);
			return new types.Position(line + locationOrOffset.range.start.line, locationOrOffset.range.start.character);
		}
		// do better?
		// return undefined;
		return new types.Position(0, 0);
	}

	locationAt(positionOrRange: vscode.Range | vscode.Position): types.Location {
		if (!types.Range.isRange(positionOrRange)) {
			positionOrRange = new types.Range(<types.Position>positionOrRange, <types.Position>positionOrRange);
		}

		const startIdx = this._cellLines.getIndexOf(positionOrRange.start.line);
		let endIdx = startIdx;
		if (!positionOrRange.isEmpty) {
			endIdx = this._cellLines.getIndexOf(positionOrRange.end.line);
		}

		const startPos = new types.Position(startIdx.remainder, positionOrRange.start.character);
		const endPos = new types.Position(endIdx.remainder, positionOrRange.end.character);
		const range = new types.Range(startPos, endPos);

		const startCell = this._cells[startIdx.index];
		return new types.Location(startCell.document.uri, <types.Range>startCell.document.validateRange(range));
	}

	contains(uri: vscode.Uri): boolean {
		return this._cellUris.has(uri);
	}

	validateRange(range: vscode.Range): vscode.Range {
		const start = this.validatePosition(range.start);
		const end = this.validatePosition(range.end);
		return range.with(start, end);
	}

	validatePosition(position: vscode.Position): vscode.Position {
		const startIdx = this._cellLines.getIndexOf(position.line);

		const cellPosition = new types.Position(startIdx.remainder, position.character);
		const validCellPosition = this._cells[startIdx.index].document.validatePosition(cellPosition);

		const line = this._cellLines.getAccumulatedValue(startIdx.index - 1);
		return new types.Position(line + validCellPosition.line, validCellPosition.character);
	}
}
