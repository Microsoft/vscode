/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { onUnexpectedError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';
import { EditorAutoClosingStrategy, EditorAutoSurroundStrategy, IConfigurationChangedEvent } from 'vs/editor/common/config/editorOptions';
import { CursorChangeReason } from 'vs/editor/common/controller/cursorEvents';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ISelection, Selection } from 'vs/editor/common/core/selection';
import { ICommand, IConfiguration, ScrollType } from 'vs/editor/common/editorCommon';
import { ITextModel, TextModelResolvedOptions } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { IAutoClosingPair } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry, ICommentsConfiguration } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { VerticalRevealType } from 'vs/editor/common/view/viewEvents';
import { IViewModel } from 'vs/editor/common/viewModel/viewModel';

export interface IColumnSelectData {
	isReal: boolean;
	fromViewLineNumber: number;
	fromViewVisualColumn: number;
	toViewLineNumber: number;
	toViewVisualColumn: number;
}

export const enum RevealTarget {
	Primary = 0,
	TopMost = 1,
	BottomMost = 2
}

/**
 * This is an operation type that will be recorded for undo/redo purposes.
 * The goal is to introduce an undo stop when the controller switches between different operation types.
 */
export const enum EditOperationType {
	Other = 0,
	Typing = 1,
	DeletingLeft = 2,
	DeletingRight = 3
}

export interface ICursors {
	readonly context: CursorContext;
	getPrimaryCursor(): CursorState;
	getLastAddedCursorIndex(): number;
	getAll(): CursorState[];

	getColumnSelectData(): IColumnSelectData;
	setColumnSelectData(columnSelectData: IColumnSelectData): void;

	setStates(source: string, reason: CursorChangeReason, states: PartialCursorState[] | null): void;
	reveal(horizontal: boolean, target: RevealTarget, scrollType: ScrollType): void;
	revealRange(revealHorizontal: boolean, viewRange: Range, verticalType: VerticalRevealType, scrollType: ScrollType): void;

	scrollTo(desiredScrollTop: number): void;

	getPrevEditOperationType(): EditOperationType;
	setPrevEditOperationType(type: EditOperationType): void;
}

export interface CharacterMap {
	[char: string]: string;
}

const autoCloseAlways = () => true;
const autoCloseNever = () => false;
const autoCloseBeforeWhitespace = (chr: string) => (chr === ' ' || chr === '\t');

export class CursorConfiguration {
	_cursorMoveConfigurationBrand: void;

	public readonly readOnly: boolean;
	public readonly tabSize: number;
	public readonly indentSize: number;
	public readonly insertSpaces: boolean;
	public readonly pageSize: number;
	public readonly lineHeight: number;
	public readonly useTabStops: boolean;
	public readonly wordSeparators: string;
	public readonly emptySelectionClipboard: boolean;
	public readonly copyWithSyntaxHighlighting: boolean;
	public readonly multiCursorMergeOverlapping: boolean;
	public readonly autoClosingBrackets: EditorAutoClosingStrategy;
	public readonly autoClosingComments: EditorAutoClosingStrategy;
	public readonly autoClosingQuotes: EditorAutoClosingStrategy;
	public readonly autoSurround: EditorAutoSurroundStrategy;
	public readonly autoIndent: boolean;
	public readonly autoClosingPairsOpen: CharacterMap;
	public readonly autoClosingPairsClose: CharacterMap;
	public readonly surroundingPairs: CharacterMap;
	public readonly blockCommentPairsOpen: CharacterMap;
	public readonly blockCommentPairsClose: CharacterMap;
	public readonly shouldAutoCloseBefore: { quote: (ch: string) => boolean, bracket: (ch: string) => boolean, comment: (ch: string) => boolean };

	private readonly _languageIdentifier: LanguageIdentifier;
	private _electricChars: { [key: string]: boolean; } | null;

	public static shouldRecreate(e: IConfigurationChangedEvent): boolean {
		return (
			e.layoutInfo
			|| e.wordSeparators
			|| e.emptySelectionClipboard
			|| e.multiCursorMergeOverlapping
			|| e.autoClosingBrackets
			|| e.autoClosingComments
			|| e.autoClosingQuotes
			|| e.autoSurround
			|| e.useTabStops
			|| e.lineHeight
			|| e.readOnly
		);
	}

	constructor(
		languageIdentifier: LanguageIdentifier,
		modelOptions: TextModelResolvedOptions,
		configuration: IConfiguration
	) {
		this._languageIdentifier = languageIdentifier;

		let c = configuration.editor;

		this.readOnly = c.readOnly;
		this.tabSize = modelOptions.tabSize;
		this.indentSize = modelOptions.indentSize;
		this.insertSpaces = modelOptions.insertSpaces;
		this.pageSize = Math.max(1, Math.floor(c.layoutInfo.height / c.fontInfo.lineHeight) - 2);
		this.lineHeight = c.lineHeight;
		this.useTabStops = c.useTabStops;
		this.wordSeparators = c.wordSeparators;
		this.emptySelectionClipboard = c.emptySelectionClipboard;
		this.copyWithSyntaxHighlighting = c.copyWithSyntaxHighlighting;
		this.multiCursorMergeOverlapping = c.multiCursorMergeOverlapping;
		this.autoClosingBrackets = c.autoClosingBrackets;
		this.autoClosingComments = c.autoClosingComments;
		this.autoClosingQuotes = c.autoClosingQuotes;
		this.autoSurround = c.autoSurround;
		this.autoIndent = c.autoIndent;

		this.autoClosingPairsOpen = {};
		this.autoClosingPairsClose = {};
		this.surroundingPairs = {};
		this.blockCommentPairsOpen = {};
		this.blockCommentPairsClose = {};
		this._electricChars = null;

		this.shouldAutoCloseBefore = {
			quote: CursorConfiguration._getShouldAutoClose(languageIdentifier, this.autoClosingQuotes),
			comment: CursorConfiguration._getShouldAutoClose(languageIdentifier, this.autoClosingComments),
			bracket: CursorConfiguration._getShouldAutoClose(languageIdentifier, this.autoClosingBrackets)
		};

		let autoClosingPairs = CursorConfiguration._getAutoClosingPairs(languageIdentifier);
		if (autoClosingPairs) {
			for (const pair of autoClosingPairs) {
				this.autoClosingPairsOpen[pair.open] = pair.close;
				this.autoClosingPairsClose[pair.close] = pair.open;
			}
		}

		let surroundingPairs = CursorConfiguration._getSurroundingPairs(languageIdentifier);
		if (surroundingPairs) {
			for (const pair of surroundingPairs) {
				this.surroundingPairs[pair.open] = pair.close;
			}
		}

		let commentsConfiguration = CursorConfiguration._getCommentsConfiguration(languageIdentifier);
		if (commentsConfiguration) {
			if (commentsConfiguration.blockCommentEndToken && commentsConfiguration.blockCommentStartToken) {
				this.blockCommentPairsOpen[commentsConfiguration.blockCommentEndToken] = commentsConfiguration.blockCommentStartToken;
				this.blockCommentPairsClose[commentsConfiguration.blockCommentStartToken] = commentsConfiguration.blockCommentEndToken;
			}
		}
	}

	public get electricChars() {
		if (!this._electricChars) {
			this._electricChars = {};
			let electricChars = CursorConfiguration._getElectricCharacters(this._languageIdentifier);
			if (electricChars) {
				for (const char of electricChars) {
					this._electricChars[char] = true;
				}
			}
		}
		return this._electricChars;
	}

	public normalizeIndentation(str: string): string {
		return TextModel.normalizeIndentation(str, this.indentSize, this.insertSpaces);
	}

	private static _getElectricCharacters(languageIdentifier: LanguageIdentifier): string[] | null {
		try {
			return LanguageConfigurationRegistry.getElectricCharacters(languageIdentifier.id);
		} catch (e) {
			onUnexpectedError(e);
			return null;
		}
	}

	private static _getAutoClosingPairs(languageIdentifier: LanguageIdentifier): IAutoClosingPair[] | null {
		try {
			return LanguageConfigurationRegistry.getAutoClosingPairs(languageIdentifier.id);
		} catch (e) {
			onUnexpectedError(e);
			return null;
		}
	}

	private static _getShouldAutoClose(languageIdentifier: LanguageIdentifier, autoCloseConfig: EditorAutoClosingStrategy): (ch: string) => boolean {
		switch (autoCloseConfig) {
			case 'beforeWhitespace':
				return autoCloseBeforeWhitespace;
			case 'languageDefined':
				return CursorConfiguration._getLanguageDefinedShouldAutoClose(languageIdentifier);
			case 'always':
				return autoCloseAlways;
			case 'never':
				return autoCloseNever;
		}
	}

	private static _getLanguageDefinedShouldAutoClose(languageIdentifier: LanguageIdentifier): (ch: string) => boolean {
		try {
			const autoCloseBeforeSet = LanguageConfigurationRegistry.getAutoCloseBeforeSet(languageIdentifier.id);
			return c => autoCloseBeforeSet.indexOf(c) !== -1;
		} catch (e) {
			onUnexpectedError(e);
			return autoCloseNever;
		}
	}

	private static _getSurroundingPairs(languageIdentifier: LanguageIdentifier): IAutoClosingPair[] | null {
		try {
			return LanguageConfigurationRegistry.getSurroundingPairs(languageIdentifier.id);
		} catch (e) {
			onUnexpectedError(e);
			return null;
		}
	}

	private static _getCommentsConfiguration(languageIdentifier: LanguageIdentifier): ICommentsConfiguration | null {
		try {
			return LanguageConfigurationRegistry.getComments(languageIdentifier.id);
		} catch (e) {
			onUnexpectedError(e);
			return null;
		}
	}
}

/**
 * Represents a simple model (either the model or the view model).
 */
export interface ICursorSimpleModel {
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
	getLineMinColumn(lineNumber: number): number;
	getLineMaxColumn(lineNumber: number): number;
	getLineFirstNonWhitespaceColumn(lineNumber: number): number;
	getLineLastNonWhitespaceColumn(lineNumber: number): number;
}

/**
 * Represents the cursor state on either the model or on the view model.
 */
export class SingleCursorState {
	_singleCursorStateBrand: void;

	// --- selection can start as a range (think double click and drag)
	public readonly selectionStart: Range;
	public readonly selectionStartLeftoverVisibleColumns: number;
	public readonly position: Position;
	public readonly leftoverVisibleColumns: number;
	public readonly selection: Selection;

	constructor(
		selectionStart: Range,
		selectionStartLeftoverVisibleColumns: number,
		position: Position,
		leftoverVisibleColumns: number,
	) {
		this.selectionStart = selectionStart;
		this.selectionStartLeftoverVisibleColumns = selectionStartLeftoverVisibleColumns;
		this.position = position;
		this.leftoverVisibleColumns = leftoverVisibleColumns;
		this.selection = SingleCursorState._computeSelection(this.selectionStart, this.position);
	}

	public equals(other: SingleCursorState) {
		return (
			this.selectionStartLeftoverVisibleColumns === other.selectionStartLeftoverVisibleColumns
			&& this.leftoverVisibleColumns === other.leftoverVisibleColumns
			&& this.position.equals(other.position)
			&& this.selectionStart.equalsRange(other.selectionStart)
		);
	}

	public hasSelection(): boolean {
		return (!this.selection.isEmpty() || !this.selectionStart.isEmpty());
	}

	public move(inSelectionMode: boolean, lineNumber: number, column: number, leftoverVisibleColumns: number): SingleCursorState {
		if (inSelectionMode) {
			// move just position
			return new SingleCursorState(
				this.selectionStart,
				this.selectionStartLeftoverVisibleColumns,
				new Position(lineNumber, column),
				leftoverVisibleColumns
			);
		} else {
			// move everything
			return new SingleCursorState(
				new Range(lineNumber, column, lineNumber, column),
				leftoverVisibleColumns,
				new Position(lineNumber, column),
				leftoverVisibleColumns
			);
		}
	}

	private static _computeSelection(selectionStart: Range, position: Position): Selection {
		let startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number;
		if (selectionStart.isEmpty()) {
			startLineNumber = selectionStart.startLineNumber;
			startColumn = selectionStart.startColumn;
			endLineNumber = position.lineNumber;
			endColumn = position.column;
		} else {
			if (position.isBeforeOrEqual(selectionStart.getStartPosition())) {
				startLineNumber = selectionStart.endLineNumber;
				startColumn = selectionStart.endColumn;
				endLineNumber = position.lineNumber;
				endColumn = position.column;
			} else {
				startLineNumber = selectionStart.startLineNumber;
				startColumn = selectionStart.startColumn;
				endLineNumber = position.lineNumber;
				endColumn = position.column;
			}
		}
		return new Selection(
			startLineNumber,
			startColumn,
			endLineNumber,
			endColumn
		);
	}
}

export class CursorContext {
	_cursorContextBrand: void;

	public readonly model: ITextModel;
	public readonly viewModel: IViewModel;
	public readonly config: CursorConfiguration;

	constructor(configuration: IConfiguration, model: ITextModel, viewModel: IViewModel) {
		this.model = model;
		this.viewModel = viewModel;
		this.config = new CursorConfiguration(
			this.model.getLanguageIdentifier(),
			this.model.getOptions(),
			configuration
		);
	}

	public validateViewPosition(viewPosition: Position, modelPosition: Position): Position {
		return this.viewModel.coordinatesConverter.validateViewPosition(viewPosition, modelPosition);
	}

	public validateViewRange(viewRange: Range, expectedModelRange: Range): Range {
		return this.viewModel.coordinatesConverter.validateViewRange(viewRange, expectedModelRange);
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		return this.viewModel.coordinatesConverter.convertViewRangeToModelRange(viewRange);
	}

	public convertViewPositionToModelPosition(lineNumber: number, column: number): Position {
		return this.viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(lineNumber, column));
	}

	public convertModelPositionToViewPosition(modelPosition: Position): Position {
		return this.viewModel.coordinatesConverter.convertModelPositionToViewPosition(modelPosition);
	}

	public convertModelRangeToViewRange(modelRange: Range): Range {
		return this.viewModel.coordinatesConverter.convertModelRangeToViewRange(modelRange);
	}

	public getCurrentScrollTop(): number {
		return this.viewModel.viewLayout.getCurrentScrollTop();
	}

	public getCompletelyVisibleViewRange(): Range {
		return this.viewModel.getCompletelyVisibleViewRange();
	}

	public getCompletelyVisibleModelRange(): Range {
		const viewRange = this.viewModel.getCompletelyVisibleViewRange();
		return this.viewModel.coordinatesConverter.convertViewRangeToModelRange(viewRange);
	}

	public getCompletelyVisibleViewRangeAtScrollTop(scrollTop: number): Range {
		return this.viewModel.getCompletelyVisibleViewRangeAtScrollTop(scrollTop);
	}

	public getVerticalOffsetForViewLine(viewLineNumber: number): number {
		return this.viewModel.viewLayout.getVerticalOffsetForLineNumber(viewLineNumber);
	}
}

export class PartialModelCursorState {
	readonly modelState: SingleCursorState;
	readonly viewState: null;

	constructor(modelState: SingleCursorState) {
		this.modelState = modelState;
		this.viewState = null;
	}
}

export class PartialViewCursorState {
	readonly modelState: null;
	readonly viewState: SingleCursorState;

	constructor(viewState: SingleCursorState) {
		this.modelState = null;
		this.viewState = viewState;
	}
}

export type PartialCursorState = CursorState | PartialModelCursorState | PartialViewCursorState;

export class CursorState {
	_cursorStateBrand: void;

	public static fromModelState(modelState: SingleCursorState): PartialModelCursorState {
		return new PartialModelCursorState(modelState);
	}

	public static fromViewState(viewState: SingleCursorState): PartialViewCursorState {
		return new PartialViewCursorState(viewState);
	}

	public static fromModelSelection(modelSelection: ISelection): PartialModelCursorState {
		const selectionStartLineNumber = modelSelection.selectionStartLineNumber;
		const selectionStartColumn = modelSelection.selectionStartColumn;
		const positionLineNumber = modelSelection.positionLineNumber;
		const positionColumn = modelSelection.positionColumn;
		const modelState = new SingleCursorState(
			new Range(selectionStartLineNumber, selectionStartColumn, selectionStartLineNumber, selectionStartColumn), 0,
			new Position(positionLineNumber, positionColumn), 0
		);
		return CursorState.fromModelState(modelState);
	}

	public static fromModelSelections(modelSelections: ISelection[]): PartialModelCursorState[] {
		let states: PartialModelCursorState[] = [];
		for (let i = 0, len = modelSelections.length; i < len; i++) {
			states[i] = this.fromModelSelection(modelSelections[i]);
		}
		return states;
	}

	readonly modelState: SingleCursorState;
	readonly viewState: SingleCursorState;

	constructor(modelState: SingleCursorState, viewState: SingleCursorState) {
		this.modelState = modelState;
		this.viewState = viewState;
	}

	public equals(other: CursorState): boolean {
		return (this.viewState.equals(other.viewState) && this.modelState.equals(other.modelState));
	}
}

export class EditOperationResult {
	_editOperationResultBrand: void;

	readonly type: EditOperationType;
	readonly commands: Array<ICommand | null>;
	readonly shouldPushStackElementBefore: boolean;
	readonly shouldPushStackElementAfter: boolean;

	constructor(
		type: EditOperationType,
		commands: Array<ICommand | null>,
		opts: {
			shouldPushStackElementBefore: boolean;
			shouldPushStackElementAfter: boolean;
		}
	) {
		this.type = type;
		this.commands = commands;
		this.shouldPushStackElementBefore = opts.shouldPushStackElementBefore;
		this.shouldPushStackElementAfter = opts.shouldPushStackElementAfter;
	}
}

/**
 * Common operations that work and make sense both on the model and on the view model.
 */
export class CursorColumns {

	public static isLowSurrogate(model: ICursorSimpleModel, lineNumber: number, charOffset: number): boolean {
		let lineContent = model.getLineContent(lineNumber);
		if (charOffset < 0 || charOffset >= lineContent.length) {
			return false;
		}
		return strings.isLowSurrogate(lineContent.charCodeAt(charOffset));
	}

	public static isHighSurrogate(model: ICursorSimpleModel, lineNumber: number, charOffset: number): boolean {
		let lineContent = model.getLineContent(lineNumber);
		if (charOffset < 0 || charOffset >= lineContent.length) {
			return false;
		}
		return strings.isHighSurrogate(lineContent.charCodeAt(charOffset));
	}

	public static isInsideSurrogatePair(model: ICursorSimpleModel, lineNumber: number, column: number): boolean {
		return this.isHighSurrogate(model, lineNumber, column - 2);
	}

	public static visibleColumnFromColumn(lineContent: string, column: number, tabSize: number): number {
		let endOffset = lineContent.length;
		if (endOffset > column - 1) {
			endOffset = column - 1;
		}

		let result = 0;
		for (let i = 0; i < endOffset; i++) {
			let charCode = lineContent.charCodeAt(i);
			if (charCode === CharCode.Tab) {
				result = this.nextRenderTabStop(result, tabSize);
			} else if (strings.isFullWidthCharacter(charCode)) {
				result = result + 2;
			} else {
				result = result + 1;
			}
		}
		return result;
	}

	public static visibleColumnFromColumn2(config: CursorConfiguration, model: ICursorSimpleModel, position: Position): number {
		return this.visibleColumnFromColumn(model.getLineContent(position.lineNumber), position.column, config.tabSize);
	}

	public static columnFromVisibleColumn(lineContent: string, visibleColumn: number, tabSize: number): number {
		if (visibleColumn <= 0) {
			return 1;
		}

		const lineLength = lineContent.length;

		let beforeVisibleColumn = 0;
		for (let i = 0; i < lineLength; i++) {
			let charCode = lineContent.charCodeAt(i);

			let afterVisibleColumn: number;
			if (charCode === CharCode.Tab) {
				afterVisibleColumn = this.nextRenderTabStop(beforeVisibleColumn, tabSize);
			} else if (strings.isFullWidthCharacter(charCode)) {
				afterVisibleColumn = beforeVisibleColumn + 2;
			} else {
				afterVisibleColumn = beforeVisibleColumn + 1;
			}

			if (afterVisibleColumn >= visibleColumn) {
				let prevDelta = visibleColumn - beforeVisibleColumn;
				let afterDelta = afterVisibleColumn - visibleColumn;
				if (afterDelta < prevDelta) {
					return i + 2;
				} else {
					return i + 1;
				}
			}

			beforeVisibleColumn = afterVisibleColumn;
		}

		// walked the entire string
		return lineLength + 1;
	}

	public static columnFromVisibleColumn2(config: CursorConfiguration, model: ICursorSimpleModel, lineNumber: number, visibleColumn: number): number {
		let result = this.columnFromVisibleColumn(model.getLineContent(lineNumber), visibleColumn, config.tabSize);

		let minColumn = model.getLineMinColumn(lineNumber);
		if (result < minColumn) {
			return minColumn;
		}

		let maxColumn = model.getLineMaxColumn(lineNumber);
		if (result > maxColumn) {
			return maxColumn;
		}

		return result;
	}

	/**
	 * ATTENTION: This works with 0-based columns (as oposed to the regular 1-based columns)
	 */
	public static nextRenderTabStop(visibleColumn: number, tabSize: number): number {
		return visibleColumn + tabSize - visibleColumn % tabSize;
	}

	/**
	 * ATTENTION: This works with 0-based columns (as oposed to the regular 1-based columns)
	 */
	public static nextIndentTabStop(visibleColumn: number, indentSize: number): number {
		return visibleColumn + indentSize - visibleColumn % indentSize;
	}

	/**
	 * ATTENTION: This works with 0-based columns (as oposed to the regular 1-based columns)
	 */
	public static prevRenderTabStop(column: number, tabSize: number): number {
		return column - 1 - (column - 1) % tabSize;
	}

	/**
	 * ATTENTION: This works with 0-based columns (as oposed to the regular 1-based columns)
	 */
	public static prevIndentTabStop(column: number, indentSize: number): number {
		return column - 1 - (column - 1) % indentSize;
	}
}

export function isQuote(ch: string): boolean {
	return (ch === '\'' || ch === '"' || ch === '`');
}
