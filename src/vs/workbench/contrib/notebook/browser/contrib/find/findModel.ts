/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotebookEditor, CellFindMatch, CellEditState, CellFindMatchWithIndex } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { Range } from 'vs/editor/common/core/range';
import { FindDecorations } from 'vs/editor/contrib/find/findDecorations';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { IModelDeltaDecoration } from 'vs/editor/common/model';
import { ICellModelDeltaDecorations, ICellModelDecorations } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import { CellKind, INotebookSearchOptions, NotebookCellsChangeType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { findFirstInSorted } from 'vs/base/common/arrays';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';


export class FindModel extends Disposable {
	private _findMatches: CellFindMatch[] = [];
	protected _findMatchesStarts: PrefixSumComputer | null = null;
	private _currentMatch: number = -1;
	private _allMatchesDecorations: ICellModelDecorations[] = [];
	private _currentMatchDecorations: ICellModelDecorations[] = [];
	private _modelDisposable = new DisposableStore();

	get findMatches() {
		return this._findMatches;
	}

	get currentMatch() {
		return this._currentMatch;
	}

	constructor(
		private readonly _notebookEditor: INotebookEditor,
		private readonly _state: FindReplaceState,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		this._register(_state.onFindReplaceStateChange(e => {
			if (e.searchString || (e.isRevealed && this._state.isRevealed)) {
				this.research();
			}

			if (e.isRevealed && !this._state.isRevealed) {
				this.clear();
			}
		}));

		this._register(this._notebookEditor.onDidChangeModel(e => {
			this._registerModelListener(e);
		}));

		if (this._notebookEditor.hasModel()) {
			this._registerModelListener(this._notebookEditor.textModel);
		}
	}

	ensureFindMatches() {
		if (!this._findMatchesStarts) {
			this.set(this._findMatches, true);
		}
	}

	getCurrentMatch() {
		const nextIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
		const cell = this._findMatches[nextIndex.index].cell;
		const match = this._findMatches[nextIndex.index].matches[nextIndex.remainder];

		return {
			cell,
			match
		};
	}

	find(previous: boolean) {
		if (!this.findMatches.length) {
			return;
		}

		// let currCell;
		if (!this._findMatchesStarts) {
			this.set(this._findMatches, true);
		} else {
			// const currIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
			// currCell = this._findMatches[currIndex.index].cell;
			const totalVal = this._findMatchesStarts.getTotalValue();
			if (this._currentMatch === -1) {
				this._currentMatch = previous ? totalVal - 1 : 0;
			} else {
				const nextVal = (this._currentMatch + (previous ? -1 : 1) + totalVal) % totalVal;
				this._currentMatch = nextVal;
			}
		}

		const nextIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
		// const newFocusedCell = this._findMatches[nextIndex.index].cell;
		this.setCurrentFindMatchDecoration(nextIndex.index, nextIndex.remainder);
		this.revealCellRange(nextIndex.index, nextIndex.remainder);

		this._state.changeMatchInfo(
			this._currentMatch,
			this._findMatches.reduce((p, c) => p + c.matches.length, 0),
			undefined
		);
	}

	private revealCellRange(cellIndex: number, matchIndex: number) {
		this._findMatches[cellIndex].cell.updateEditState(CellEditState.Editing, 'find');
		this._notebookEditor.focusElement(this._findMatches[cellIndex].cell);
		this._notebookEditor.setCellEditorSelection(this._findMatches[cellIndex].cell, this._findMatches[cellIndex].matches[matchIndex].range);
		this._notebookEditor.revealRangeInCenterIfOutsideViewportAsync(this._findMatches[cellIndex].cell, this._findMatches[cellIndex].matches[matchIndex].range);
	}

	private _registerModelListener(notebookTextModel?: NotebookTextModel) {
		this._modelDisposable.clear();

		if (notebookTextModel) {
			this._modelDisposable.add(notebookTextModel.onDidChangeContent((e) => {
				if (!e.rawEvents.some(event => event.kind === NotebookCellsChangeType.ChangeCellContent || event.kind === NotebookCellsChangeType.ModelChange)) {
					return;
				}

				this.research();
			}));
		}

		this.research();
	}

	research() {
		if (!this._state.isRevealed) {
			this.set([], false);
			return;
		}

		const findMatches = this._getFindMatches();
		if (!findMatches) {
			return;
		}

		if (this._currentMatch === -1) {
			// no active current match
			this.set(findMatches, false);
			return;
		}

		const oldCurrIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
		const oldCurrCell = this._findMatches[oldCurrIndex.index].cell;
		const oldCurrMatchCellIndex = this._notebookEditor.viewModel!.getCellIndex(oldCurrCell);

		if (oldCurrMatchCellIndex < 0) {
			// the cell containing the active match is deleted
			const focusedCell = this._notebookEditor.viewModel!.viewCells[this._notebookEditor.viewModel!.getFocus().start];

			if (!focusedCell) {
				this.set(findMatches, false);
				return;
			}

			const matchAfterSelection = findFirstInSorted(findMatches.map(match => match.index), index => index >= oldCurrMatchCellIndex);
			this._updateCurrentMatch(findMatches, this._matchesCountBeforeIndex(findMatches, matchAfterSelection));
			return;
		}

		// the cell still exist
		const cell = this._notebookEditor.viewModel!.viewCells[oldCurrMatchCellIndex];
		if (cell.cellKind === CellKind.Markdown && cell.getEditState() === CellEditState.Preview) {
			// find the nearest match above this cell
			const matchAfterSelection = findFirstInSorted(findMatches.map(match => match.index), index => index >= oldCurrMatchCellIndex);
			this._updateCurrentMatch(findMatches, this._matchesCountBeforeIndex(findMatches, matchAfterSelection));
			return;
		}

		if ((cell.cellKind === CellKind.Markdown && cell.getEditState() === CellEditState.Editing) || cell.cellKind === CellKind.Code) {
			// check if there is monaco editor selection and find the first match, otherwise find the first match above current cell
			// this._findMatches[cellIndex].matches[matchIndex].range
			const currentMatchDecorationId = this._currentMatchDecorations.find(decoration => decoration.ownerId === cell.handle);

			if (currentMatchDecorationId) {
				const currMatchRangeInEditor = (cell.editorAttached && currentMatchDecorationId.decorations[0] ? cell.getCellDecorationRange(currentMatchDecorationId.decorations[0]) : null)
					?? this._findMatches[oldCurrIndex.index].matches[oldCurrIndex.remainder].range;

				// not attached, just use the range
				const matchAfterSelection = findFirstInSorted(findMatches, match => match.index >= oldCurrMatchCellIndex);
				if (findMatches[matchAfterSelection].index > oldCurrMatchCellIndex) {
					// there is no search result in curr cell anymore
					this._updateCurrentMatch(findMatches, this._matchesCountBeforeIndex(findMatches, matchAfterSelection));
				} else {
					// findMatches[matchAfterSelection].index === currMatchCellIndex
					const cellMatch = findMatches[matchAfterSelection];
					const matchAfterOldSelection = findFirstInSorted(cellMatch.matches, match => Range.compareRangesUsingStarts(match.range, currMatchRangeInEditor) >= 0);
					this._updateCurrentMatch(findMatches, this._matchesCountBeforeIndex(findMatches, matchAfterSelection) + matchAfterOldSelection);
				}
			} else {
				const matchAfterSelection = findFirstInSorted(findMatches.map(match => match.index), index => index >= oldCurrMatchCellIndex);
				this._updateCurrentMatch(findMatches, this._matchesCountBeforeIndex(findMatches, matchAfterSelection));
			}

			return;
		}

		this.set(findMatches, false);
	}

	private set(cellFindMatches: CellFindMatch[] | null, autoStart: boolean): void {
		if (!cellFindMatches || !cellFindMatches.length) {
			this._findMatches = [];
			this.setAllFindMatchesDecorations([]);

			this.constructFindMatchesStarts();
			this._currentMatch = -1;
			this.clearCurrentFindMatchDecoration();
			return;
		}

		// all matches
		this._findMatches = cellFindMatches;
		this.setAllFindMatchesDecorations(cellFindMatches || []);

		// current match
		this.constructFindMatchesStarts();

		if (autoStart) {
			this._currentMatch = 0;
			this.setCurrentFindMatchDecoration(0, 0);
		}

		this._state.changeMatchInfo(
			this._currentMatch,
			this._findMatches.reduce((p, c) => p + c.matches.length, 0),
			undefined
		);
	}

	private _getFindMatches(): CellFindMatchWithIndex[] | null {
		const val = this._state.searchString;
		const wordSeparators = this._configurationService.inspect<string>('editor.wordSeparators').value;

		const options: INotebookSearchOptions = { regex: this._state.isRegex, wholeWord: this._state.wholeWord, caseSensitive: this._state.matchCase, wordSeparators: wordSeparators };
		if (!val) {
			return null;
		}

		const findMatches = this._notebookEditor.viewModel!.find(val, options).filter(match => match.matches.length > 0);
		return findMatches;
	}

	private _updateCurrentMatch(findMatches: CellFindMatchWithIndex[], currentMatchesPosition: number) {
		this.set(findMatches, false);
		this._currentMatch = currentMatchesPosition;
		const nextIndex = this._findMatchesStarts!.getIndexOf(this._currentMatch);
		this.setCurrentFindMatchDecoration(nextIndex.index, nextIndex.remainder);

		this._state.changeMatchInfo(
			this._currentMatch,
			this._findMatches.reduce((p, c) => p + c.matches.length, 0),
			undefined
		);
	}

	private _matchesCountBeforeIndex(findMatches: CellFindMatchWithIndex[], index: number) {
		let prevMatchesCount = 0;
		for (let i = 0; i < index; i++) {
			prevMatchesCount += findMatches[i].matches.length;
		}

		return prevMatchesCount;
	}

	private constructFindMatchesStarts() {
		if (this._findMatches && this._findMatches.length) {
			const values = new Uint32Array(this._findMatches.length);
			for (let i = 0; i < this._findMatches.length; i++) {
				values[i] = this._findMatches[i].matches.length;
			}

			this._findMatchesStarts = new PrefixSumComputer(values);
		} else {
			this._findMatchesStarts = null;
		}
	}

	private setCurrentFindMatchDecoration(cellIndex: number, matchIndex: number) {
		this._notebookEditor.changeModelDecorations(accessor => {
			const findMatchesOptions: ModelDecorationOptions = FindDecorations._CURRENT_FIND_MATCH_DECORATION;

			const cell = this._findMatches[cellIndex].cell;
			const match = this._findMatches[cellIndex].matches[matchIndex];
			const decorations: IModelDeltaDecoration[] = [
				{ range: match.range, options: findMatchesOptions }
			];
			const deltaDecoration: ICellModelDeltaDecorations = {
				ownerId: cell.handle,
				decorations: decorations
			};

			this._currentMatchDecorations = accessor.deltaDecorations(this._currentMatchDecorations, [deltaDecoration]);
		});
	}

	private clearCurrentFindMatchDecoration() {
		this._notebookEditor.changeModelDecorations(accessor => {
			this._currentMatchDecorations = accessor.deltaDecorations(this._currentMatchDecorations, []);
		});
	}

	private setAllFindMatchesDecorations(cellFindMatches: CellFindMatch[]) {
		this._notebookEditor.changeModelDecorations((accessor) => {

			const findMatchesOptions: ModelDecorationOptions = FindDecorations._FIND_MATCH_DECORATION;

			const deltaDecorations: ICellModelDeltaDecorations[] = cellFindMatches.map(cellFindMatch => {
				const findMatches = cellFindMatch.matches;

				// Find matches
				const newFindMatchesDecorations: IModelDeltaDecoration[] = new Array<IModelDeltaDecoration>(findMatches.length);
				for (let i = 0, len = findMatches.length; i < len; i++) {
					newFindMatchesDecorations[i] = {
						range: findMatches[i].range,
						options: findMatchesOptions
					};
				}

				return { ownerId: cellFindMatch.cell.handle, decorations: newFindMatchesDecorations };
			});

			this._allMatchesDecorations = accessor.deltaDecorations(this._allMatchesDecorations, deltaDecorations);
		});
	}


	clear() {
		this.set([], false);
	}
}
