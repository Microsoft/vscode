/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, TimeoutTimer } from 'vs/base/common/async';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { IActiveCodeEditor } from 'vs/editor/browser/editorBrowser';
import { ReplaceCommand, ReplaceCommandThatPreservesSelection } from 'vs/editor/common/commands/replaceCommand';
import { CursorChangeReason, ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { Constants } from 'vs/base/common/uint';
import { ScrollType, ICommand } from 'vs/editor/common/editorCommon';
import { EndOfLinePreference, FindMatch, ITextModel } from 'vs/editor/common/model';
import { SearchParams } from 'vs/editor/common/model/textModelSearch';
import { FindDecorations } from 'vs/editor/contrib/find/findDecorations';
import { FindReplaceState, FindReplaceStateChangedEvent } from 'vs/editor/contrib/find/findState';
import { ReplaceAllCommand } from 'vs/editor/contrib/find/replaceAllCommand';
import { ReplacePattern, parseReplaceString } from 'vs/editor/contrib/find/replacePattern';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindings } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { findFirstInSorted } from 'vs/base/common/arrays';

export const CONTEXT_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('findWidgetVisible', false);
export const CONTEXT_FIND_WIDGET_NOT_VISIBLE = CONTEXT_FIND_WIDGET_VISIBLE.toNegated();
// Keep ContextKey use of 'Focussed' to not break when clauses
export const CONTEXT_FIND_INPUT_FOCUSED = new RawContextKey<boolean>('findInputFocussed', false);
export const CONTEXT_REPLACE_INPUT_FOCUSED = new RawContextKey<boolean>('replaceInputFocussed', false);

export const ToggleCaseSensitiveKeybinding: IKeybindings = {
	primary: KeyMod.Alt | KeyCode.KEY_C,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_C }
};
export const ToggleWholeWordKeybinding: IKeybindings = {
	primary: KeyMod.Alt | KeyCode.KEY_W,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_W }
};
export const ToggleRegexKeybinding: IKeybindings = {
	primary: KeyMod.Alt | KeyCode.KEY_R,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_R }
};
export const ToggleSearchScopeKeybinding: IKeybindings = {
	primary: KeyMod.Alt | KeyCode.KEY_L,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_L }
};

export const FIND_IDS = {
	StartFindAction: 'actions.find',
	StartFindWithSelection: 'actions.findWithSelection',
	NextMatchFindAction: 'editor.action.nextMatchFindAction',
	PreviousMatchFindAction: 'editor.action.previousMatchFindAction',
	NextSelectionMatchFindAction: 'editor.action.nextSelectionMatchFindAction',
	PreviousSelectionMatchFindAction: 'editor.action.previousSelectionMatchFindAction',
	StartFindReplaceAction: 'editor.action.startFindReplaceAction',
	CloseFindWidgetCommand: 'closeFindWidget',
	ToggleCaseSensitiveCommand: 'toggleFindCaseSensitive',
	ToggleWholeWordCommand: 'toggleFindWholeWord',
	ToggleRegexCommand: 'toggleFindRegex',
	ToggleSearchScopeCommand: 'toggleFindInSelection',
	TogglePreserveCaseCommand: 'togglePreserveCase',
	ReplaceOneAction: 'editor.action.replaceOne',
	ReplaceAllAction: 'editor.action.replaceAll',
	SelectAllMatchesAction: 'editor.action.selectAllMatches'
};

export const MATCHES_LIMIT = 19999;
const RESEARCH_DELAY = 240;

export class FindModelBoundToEditorModel {

	private readonly _editor: IActiveCodeEditor;
	private readonly _state: FindReplaceState;
	private readonly _toDispose = new DisposableStore();
	private readonly _decorations: FindDecorations;
	private _ignoreModelContentChanged: boolean;
	private readonly _startSearchingTimer: TimeoutTimer;

	private readonly _updateDecorationsScheduler: RunOnceScheduler;
	private _isDisposed: boolean;

	constructor(editor: IActiveCodeEditor, state: FindReplaceState) {
		this._editor = editor;
		this._state = state;
		this._isDisposed = false;
		this._startSearchingTimer = new TimeoutTimer();

		this._decorations = new FindDecorations(editor);
		this._toDispose.add(this._decorations);

		this._updateDecorationsScheduler = new RunOnceScheduler(() => this.research(false), 100);
		this._toDispose.add(this._updateDecorationsScheduler);

		this._toDispose.add(this._editor.onDidChangeCursorPosition((e: ICursorPositionChangedEvent) => {
			if (
				e.reason === CursorChangeReason.Explicit
				|| e.reason === CursorChangeReason.Undo
				|| e.reason === CursorChangeReason.Redo
			) {
				this._decorations.setStartPosition(this._editor.getPosition());
			}
		}));

		this._ignoreModelContentChanged = false;
		this._toDispose.add(this._editor.onDidChangeModelContent((e) => {
			if (this._ignoreModelContentChanged) {
				return;
			}
			if (e.isFlush) {
				// a model.setValue() was called
				this._decorations.reset();
			}
			this._decorations.setStartPosition(this._editor.getPosition());
			this._updateDecorationsScheduler.schedule();
		}));

		this._toDispose.add(this._state.onFindReplaceStateChange((e) => this._onStateChanged(e)));

		this.research(false, this._state.searchScope);
	}

	public dispose(): void {
		this._isDisposed = true;
		dispose(this._startSearchingTimer);
		this._toDispose.dispose();
	}

	private _onStateChanged(e: FindReplaceStateChangedEvent): void {
		if (this._isDisposed) {
			// The find model is disposed during a find state changed event
			return;
		}
		if (!this._editor.hasModel()) {
			// The find model will be disposed momentarily
			return;
		}
		if (e.searchString || e.isReplaceRevealed || e.isRegex || e.wholeWord || e.matchCase || e.searchScope) {
			let model = this._editor.getModel();

			if (model.isTooLargeForSyncing()) {
				this._startSearchingTimer.cancel();

				this._startSearchingTimer.setIfNotSet(() => {
					if (e.searchScope) {
						this.research(e.moveCursor, this._state.searchScope);
					} else {
						this.research(e.moveCursor);
					}
				}, RESEARCH_DELAY);
			} else {
				if (e.searchScope) {
					this.research(e.moveCursor, this._state.searchScope);
				} else {
					this.research(e.moveCursor);
				}
			}
		}
	}

	private static _getSearchRange(model: ITextModel, findScope: Range | null): Range {
		// If we have set now or before a find scope, use it for computing the search range
		if (findScope) {
			return findScope;
		}

		return model.getFullModelRange();
	}

	private research(moveCursor: boolean, newFindScope?: Range | null): void {
		let findScope: Range | null = null;
		if (typeof newFindScope !== 'undefined') {
			findScope = newFindScope;
		} else {
			findScope = this._decorations.getFindScope();
		}
		if (findScope !== null) {
			if (findScope.startLineNumber !== findScope.endLineNumber) {
				if (findScope.endColumn === 1) {
					findScope = new Range(findScope.startLineNumber, 1, findScope.endLineNumber - 1, this._editor.getModel().getLineMaxColumn(findScope.endLineNumber - 1));
				} else {
					// multiline find scope => expand to line starts / ends
					findScope = new Range(findScope.startLineNumber, 1, findScope.endLineNumber, this._editor.getModel().getLineMaxColumn(findScope.endLineNumber));
				}
			}
		}

		let findMatches = this._findMatches(findScope, false, MATCHES_LIMIT);
		this._decorations.set(findMatches, findScope);

		const editorSelection = this._editor.getSelection();
		let currentMatchesPosition = this._decorations.getCurrentMatchesPosition(editorSelection);
		if (currentMatchesPosition === 0 && findMatches.length > 0) {
			// current selection is not on top of a match
			// try to find its nearest result from the top of the document
			const matchAfterSelection = findFirstInSorted(findMatches.map(match => match.range), range => Range.compareRangesUsingStarts(range, editorSelection) >= 0);
			currentMatchesPosition = matchAfterSelection > 0 ? matchAfterSelection - 1 + 1 /** match position is one based */ : currentMatchesPosition;
		}

		this._state.changeMatchInfo(
			currentMatchesPosition,
			this._decorations.getCount(),
			undefined
		);

		if (moveCursor) {
			this._moveToNextMatch(this._decorations.getStartPosition());
		}
	}

	private _hasMatches(): boolean {
		return (this._state.matchesCount > 0);
	}

	private _cannotFind(): boolean {
		if (!this._hasMatches()) {
			let findScope = this._decorations.getFindScope();
			if (findScope) {
				// Reveal the selection so user is reminded that 'selection find' is on.
				this._editor.revealRangeInCenterIfOutsideViewport(findScope, ScrollType.Smooth);
			}
			return true;
		}
		return false;
	}

	private _setCurrentFindMatch(match: Range): void {
		let matchesPosition = this._decorations.setCurrentFindMatch(match);
		this._state.changeMatchInfo(
			matchesPosition,
			this._decorations.getCount(),
			match
		);

		this._editor.setSelection(match);
		this._editor.revealRangeInCenterIfOutsideViewport(match, ScrollType.Smooth);
	}

	private _prevSearchPosition(before: Position) {
		let isUsingLineStops = this._state.isRegex && (
			this._state.searchString.indexOf('^') >= 0
			|| this._state.searchString.indexOf('$') >= 0
		);
		let { lineNumber, column } = before;
		let model = this._editor.getModel();

		if (isUsingLineStops || column === 1) {
			if (lineNumber === 1) {
				lineNumber = model.getLineCount();
			} else {
				lineNumber--;
			}
			column = model.getLineMaxColumn(lineNumber);
		} else {
			column--;
		}

		return new Position(lineNumber, column);
	}

	private _moveToPrevMatch(before: Position, isRecursed: boolean = false): void {
		if (!this._state.canNavigateBack()) {
			// we are beyond the first matched find result
			// instead of doing nothing, we should refocus the first item
			const nextMatchRange = this._decorations.matchAfterPosition(before);

			if (nextMatchRange) {
				this._setCurrentFindMatch(nextMatchRange);
			}
			return;
		}
		if (this._decorations.getCount() < MATCHES_LIMIT) {
			let prevMatchRange = this._decorations.matchBeforePosition(before);

			if (prevMatchRange && prevMatchRange.isEmpty() && prevMatchRange.getStartPosition().equals(before)) {
				before = this._prevSearchPosition(before);
				prevMatchRange = this._decorations.matchBeforePosition(before);
			}

			if (prevMatchRange) {
				this._setCurrentFindMatch(prevMatchRange);
			}

			return;
		}

		if (this._cannotFind()) {
			return;
		}

		let findScope = this._decorations.getFindScope();
		let searchRange = FindModelBoundToEditorModel._getSearchRange(this._editor.getModel(), findScope);

		// ...(----)...|...
		if (searchRange.getEndPosition().isBefore(before)) {
			before = searchRange.getEndPosition();
		}

		// ...|...(----)...
		if (before.isBefore(searchRange.getStartPosition())) {
			before = searchRange.getEndPosition();
		}

		let { lineNumber, column } = before;
		let model = this._editor.getModel();

		let position = new Position(lineNumber, column);

		let prevMatch = model.findPreviousMatch(this._state.searchString, position, this._state.isRegex, this._state.matchCase, this._state.wholeWord ? this._editor.getOption(EditorOption.wordSeparators) : null, false);

		if (prevMatch && prevMatch.range.isEmpty() && prevMatch.range.getStartPosition().equals(position)) {
			// Looks like we're stuck at this position, unacceptable!
			position = this._prevSearchPosition(position);
			prevMatch = model.findPreviousMatch(this._state.searchString, position, this._state.isRegex, this._state.matchCase, this._state.wholeWord ? this._editor.getOption(EditorOption.wordSeparators) : null, false);
		}

		if (!prevMatch) {
			// there is precisely one match and selection is on top of it
			return;
		}

		if (!isRecursed && !searchRange.containsRange(prevMatch.range)) {
			return this._moveToPrevMatch(prevMatch.range.getStartPosition(), true);
		}

		this._setCurrentFindMatch(prevMatch.range);
	}

	public moveToPrevMatch(): void {
		this._moveToPrevMatch(this._editor.getSelection().getStartPosition());
	}

	private _nextSearchPosition(after: Position) {
		let isUsingLineStops = this._state.isRegex && (
			this._state.searchString.indexOf('^') >= 0
			|| this._state.searchString.indexOf('$') >= 0
		);

		let { lineNumber, column } = after;
		let model = this._editor.getModel();

		if (isUsingLineStops || column === model.getLineMaxColumn(lineNumber)) {
			if (lineNumber === model.getLineCount()) {
				lineNumber = 1;
			} else {
				lineNumber++;
			}
			column = 1;
		} else {
			column++;
		}

		return new Position(lineNumber, column);
	}

	private _moveToNextMatch(after: Position): void {
		if (!this._state.canNavigateForward()) {
			// we are beyond the last matched find result
			// instead of doing nothing, we should refocus the last item
			const prevMatchRange = this._decorations.matchBeforePosition(after);

			if (prevMatchRange) {
				this._setCurrentFindMatch(prevMatchRange);
			}
			return;
		}
		if (this._decorations.getCount() < MATCHES_LIMIT) {
			let nextMatchRange = this._decorations.matchAfterPosition(after);

			if (nextMatchRange && nextMatchRange.isEmpty() && nextMatchRange.getStartPosition().equals(after)) {
				// Looks like we're stuck at this position, unacceptable!
				after = this._nextSearchPosition(after);
				nextMatchRange = this._decorations.matchAfterPosition(after);
			}
			if (nextMatchRange) {
				this._setCurrentFindMatch(nextMatchRange);
			}

			return;
		}

		let nextMatch = this._getNextMatch(after, false, true);
		if (nextMatch) {
			this._setCurrentFindMatch(nextMatch.range);
		}
	}

	private _getNextMatch(after: Position, captureMatches: boolean, forceMove: boolean, isRecursed: boolean = false): FindMatch | null {
		if (this._cannotFind()) {
			return null;
		}

		let findScope = this._decorations.getFindScope();
		let searchRange = FindModelBoundToEditorModel._getSearchRange(this._editor.getModel(), findScope);

		// ...(----)...|...
		if (searchRange.getEndPosition().isBefore(after)) {
			after = searchRange.getStartPosition();
		}

		// ...|...(----)...
		if (after.isBefore(searchRange.getStartPosition())) {
			after = searchRange.getStartPosition();
		}

		let { lineNumber, column } = after;
		let model = this._editor.getModel();

		let position = new Position(lineNumber, column);

		let nextMatch = model.findNextMatch(this._state.searchString, position, this._state.isRegex, this._state.matchCase, this._state.wholeWord ? this._editor.getOption(EditorOption.wordSeparators) : null, captureMatches);

		if (forceMove && nextMatch && nextMatch.range.isEmpty() && nextMatch.range.getStartPosition().equals(position)) {
			// Looks like we're stuck at this position, unacceptable!
			position = this._nextSearchPosition(position);
			nextMatch = model.findNextMatch(this._state.searchString, position, this._state.isRegex, this._state.matchCase, this._state.wholeWord ? this._editor.getOption(EditorOption.wordSeparators) : null, captureMatches);
		}

		if (!nextMatch) {
			// there is precisely one match and selection is on top of it
			return null;
		}

		if (!isRecursed && !searchRange.containsRange(nextMatch.range)) {
			return this._getNextMatch(nextMatch.range.getEndPosition(), captureMatches, forceMove, true);
		}

		return nextMatch;
	}

	public moveToNextMatch(): void {
		this._moveToNextMatch(this._editor.getSelection().getEndPosition());
	}

	private _getReplacePattern(): ReplacePattern {
		if (this._state.isRegex) {
			return parseReplaceString(this._state.replaceString);
		}
		return ReplacePattern.fromStaticValue(this._state.replaceString);
	}

	public replace(): void {
		if (!this._hasMatches()) {
			return;
		}

		let replacePattern = this._getReplacePattern();
		let selection = this._editor.getSelection();
		let nextMatch = this._getNextMatch(selection.getStartPosition(), true, false);
		if (nextMatch) {
			if (selection.equalsRange(nextMatch.range)) {
				// selection sits on a find match => replace it!
				let replaceString = replacePattern.buildReplaceString(nextMatch.matches, this._state.preserveCase);

				let command = new ReplaceCommand(selection, replaceString);

				this._executeEditorCommand('replace', command);

				this._decorations.setStartPosition(new Position(selection.startLineNumber, selection.startColumn + replaceString.length));
				this.research(true);
			} else {
				this._decorations.setStartPosition(this._editor.getPosition());
				this._setCurrentFindMatch(nextMatch.range);
			}
		}
	}

	private _findMatches(findScope: Range | null, captureMatches: boolean, limitResultCount: number): FindMatch[] {
		let searchRange = FindModelBoundToEditorModel._getSearchRange(this._editor.getModel(), findScope);
		return this._editor.getModel().findMatches(this._state.searchString, searchRange, this._state.isRegex, this._state.matchCase, this._state.wholeWord ? this._editor.getOption(EditorOption.wordSeparators) : null, captureMatches, limitResultCount);
	}

	public replaceAll(): void {
		if (!this._hasMatches()) {
			return;
		}

		const findScope = this._decorations.getFindScope();

		if (findScope === null && this._state.matchesCount >= MATCHES_LIMIT) {
			// Doing a replace on the entire file that is over ${MATCHES_LIMIT} matches
			this._largeReplaceAll();
		} else {
			this._regularReplaceAll(findScope);
		}

		this.research(false);
	}

	private _largeReplaceAll(): void {
		const searchParams = new SearchParams(this._state.searchString, this._state.isRegex, this._state.matchCase, this._state.wholeWord ? this._editor.getOption(EditorOption.wordSeparators) : null);
		const searchData = searchParams.parseSearchRequest();
		if (!searchData) {
			return;
		}

		let searchRegex = searchData.regex;
		if (!searchRegex.multiline) {
			let mod = 'mu';
			if (searchRegex.ignoreCase) {
				mod += 'i';
			}
			if (searchRegex.global) {
				mod += 'g';
			}
			searchRegex = new RegExp(searchRegex.source, mod);
		}

		const model = this._editor.getModel();
		const modelText = model.getValue(EndOfLinePreference.LF);
		const fullModelRange = model.getFullModelRange();

		const replacePattern = this._getReplacePattern();
		let resultText: string;
		const preserveCase = this._state.preserveCase;

		if (replacePattern.hasReplacementPatterns || preserveCase) {
			resultText = modelText.replace(searchRegex, function () {
				return replacePattern.buildReplaceString(<string[]><any>arguments, preserveCase);
			});
		} else {
			resultText = modelText.replace(searchRegex, replacePattern.buildReplaceString(null, preserveCase));
		}

		let command = new ReplaceCommandThatPreservesSelection(fullModelRange, resultText, this._editor.getSelection());
		this._executeEditorCommand('replaceAll', command);
	}

	private _regularReplaceAll(findScope: Range | null): void {
		const replacePattern = this._getReplacePattern();
		// Get all the ranges (even more than the highlighted ones)
		let matches = this._findMatches(findScope, replacePattern.hasReplacementPatterns || this._state.preserveCase, Constants.MAX_SAFE_SMALL_INTEGER);

		let replaceStrings: string[] = [];
		for (let i = 0, len = matches.length; i < len; i++) {
			replaceStrings[i] = replacePattern.buildReplaceString(matches[i].matches, this._state.preserveCase);
		}

		let command = new ReplaceAllCommand(this._editor.getSelection(), matches.map(m => m.range), replaceStrings);
		this._executeEditorCommand('replaceAll', command);
	}

	public selectAllMatches(): void {
		if (!this._hasMatches()) {
			return;
		}

		let findScope = this._decorations.getFindScope();

		// Get all the ranges (even more than the highlighted ones)
		let matches = this._findMatches(findScope, false, Constants.MAX_SAFE_SMALL_INTEGER);
		let selections = matches.map(m => new Selection(m.range.startLineNumber, m.range.startColumn, m.range.endLineNumber, m.range.endColumn));

		// If one of the ranges is the editor selection, then maintain it as primary
		let editorSelection = this._editor.getSelection();
		for (let i = 0, len = selections.length; i < len; i++) {
			let sel = selections[i];
			if (sel.equalsRange(editorSelection)) {
				selections = [editorSelection].concat(selections.slice(0, i)).concat(selections.slice(i + 1));
				break;
			}
		}

		this._editor.setSelections(selections);
	}

	private _executeEditorCommand(source: string, command: ICommand): void {
		try {
			this._ignoreModelContentChanged = true;
			this._editor.pushUndoStop();
			this._editor.executeCommand(source, command);
			this._editor.pushUndoStop();
		} finally {
			this._ignoreModelContentChanged = false;
		}
	}
}
