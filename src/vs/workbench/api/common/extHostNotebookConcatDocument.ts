/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as types from 'vs/workbench/api/common/extHostTypes';
import * as vscode from 'vscode';
import { Event, Emitter } from 'vs/base/common/event';
import { ExtHostNotebookController, ExtHostCell } from 'vs/workbench/api/common/extHostNotebook';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { score } from 'vs/editor/common/modes/languageSelector';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { isEqual } from 'vs/base/common/resources';

export class ExtHostNotebookConcatDocument implements vscode.NotebookConcatTextDocument {

	private _disposables = new DisposableStore();
	private _isClosed = false;

	private _cells!: ExtHostCell[];
	private _cellLengths!: PrefixSumComputer;
	private _cellLines!: PrefixSumComputer;
	private _versionId = 0;

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		extHostNotebooks: ExtHostNotebookController,
		extHostDocuments: ExtHostDocuments,
		private readonly _notebook: vscode.NotebookDocument,
		private readonly _selector: vscode.DocumentSelector | undefined,
	) {
		this._init();

		this._disposables.add(extHostDocuments.onDidChangeDocument(e => {
			let cellIdx = this._cells.findIndex(cell => isEqual(cell.uri, e.document.uri));
			if (cellIdx >= 0) {
				this._cellLengths.changeValue(cellIdx, this._cells[cellIdx].document.getText().length + 1);
				this._cellLines.changeValue(cellIdx, this._cells[cellIdx].document.lineCount);
				this._versionId += 1;
				this._onDidChange.fire(undefined);
			}
		}));
		this._disposables.add(extHostNotebooks.onDidChangeNotebookDocument(e => {
			if (e.document === this._notebook) {
				this._init();
				this._versionId += 1;
				this._onDidChange.fire(undefined);
			}
		}));
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
		const cellLengths: number[] = [];
		const cellLineCounts: number[] = [];
		for (let cell of this._notebook.cells) {
			if (cell.cellKind === CellKind.Code && (!this._selector || score(this._selector, cell.uri, cell.language, true))) {
				this._cells.push(<ExtHostCell>cell);
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
			for (let cell of this._cells) {
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
		const startCell = this._cells.find(cell => isEqual(cell.uri, start.uri));
		const endCell = this._cells.find(cell => isEqual(cell.uri, end.uri));

		if (!startCell || !endCell) {
			return '';
		} else if (startCell === endCell) {
			return startCell.document.getText(new types.Range(start.range.start, end.range.end));
		} else {
			let a = startCell.document.getText(new types.Range(start.range.start, new types.Position(startCell.document.lineCount, 0)));
			let b = endCell.document.getText(new types.Range(new types.Position(0, 0), end.range.end));
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

		const idx = this._cells.findIndex(cell => isEqual(cell.uri, locationOrOffset.uri));
		if (idx >= 0) {
			let line = this._cellLines.getAccumulatedValue(idx - 1);
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

		let startPos = new types.Position(startIdx.remainder, positionOrRange.start.character);
		let endPos = new types.Position(endIdx.remainder, positionOrRange.end.character);
		let range = new types.Range(startPos, endPos);

		const startCell = this._cells[startIdx.index];
		return new types.Location(startCell.uri, <types.Range>startCell.document.validateRange(range));
	}
}
