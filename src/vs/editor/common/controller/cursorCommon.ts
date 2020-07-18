/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { onUnexpectedError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';
import { EditorAutoClosingStrategy, EditorAutoSurroundStrategy, ConfigurationChangedEvent, EditorAutoClosingOvertypeStrategy, EditorOption, EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ISelection, Selection } from 'vs/editor/common/core/selection';
import { ICommand, IConfiguration } from 'vs/editor/common/editorCommon';
import { ITextModel, TextModelResolvedOptions } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { IAutoClosingPair, StandardAutoClosingPairConditional } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { ICoordinatesConverter } from 'vs/editor/common/viewModel/viewModel';
import { Constants } from 'vs/base/common/uint';

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

export interface CharacterMap {
	[char: string]: string;
}
export interface MultipleCharacterMap {
	[char: string]: string[];
}

const autoCloseAlways = () => true;
const autoCloseNever = () => false;
const autoCloseBeforeWhitespace = (chr: string) => (chr === ' ' || chr === '\t');

function appendEntry<K, V>(target: Map<K, V[]>, key: K, value: V): void {
	if (target.has(key)) {
		target.get(key)!.push(value);
	} else {
		target.set(key, [value]);
	}
}

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
	public readonly multiCursorPaste: 'spread' | 'full';
	public readonly autoClosingBrackets: EditorAutoClosingStrategy;
	public readonly autoClosingQuotes: EditorAutoClosingStrategy;
	public readonly autoClosingOvertype: EditorAutoClosingOvertypeStrategy;
	public readonly autoSurround: EditorAutoSurroundStrategy;
	public readonly autoIndent: EditorAutoIndentStrategy;
	public readonly autoClosingPairsOpen2: Map<string, StandardAutoClosingPairConditional[]>;
	public readonly autoClosingPairsClose2: Map<string, StandardAutoClosingPairConditional[]>;
	public readonly surroundingPairs: CharacterMap;
	public readonly shouldAutoCloseBefore: { quote: (ch: string) => boolean, bracket: (ch: string) => boolean };

	private readonly _languageIdentifier: LanguageIdentifier;
	private _electricChars: { [key: string]: boolean; } | null;

	public static shouldRecreate(e: ConfigurationChangedEvent): boolean {
		return (
			e.hasChanged(EditorOption.layoutInfo)
			|| e.hasChanged(EditorOption.wordSeparators)
			|| e.hasChanged(EditorOption.emptySelectionClipboard)
			|| e.hasChanged(EditorOption.multiCursorMergeOverlapping)
			|| e.hasChanged(EditorOption.multiCursorPaste)
			|| e.hasChanged(EditorOption.autoClosingBrackets)
			|| e.hasChanged(EditorOption.autoClosingQuotes)
			|| e.hasChanged(EditorOption.autoClosingOvertype)
			|| e.hasChanged(EditorOption.autoSurround)
			|| e.hasChanged(EditorOption.useTabStops)
			|| e.hasChanged(EditorOption.lineHeight)
			|| e.hasChanged(EditorOption.readOnly)
		);
	}

	constructor(
		languageIdentifier: LanguageIdentifier,
		modelOptions: TextModelResolvedOptions,
		configuration: IConfiguration
	) {
		this._languageIdentifier = languageIdentifier;

		const options = configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);

		this.readOnly = options.get(EditorOption.readOnly);
		this.tabSize = modelOptions.tabSize;
		this.indentSize = modelOptions.indentSize;
		this.insertSpaces = modelOptions.insertSpaces;
		this.lineHeight = options.get(EditorOption.lineHeight);
		this.pageSize = Math.max(1, Math.floor(layoutInfo.height / this.lineHeight) - 2);
		this.useTabStops = options.get(EditorOption.useTabStops);
		this.wordSeparators = options.get(EditorOption.wordSeparators);
		this.emptySelectionClipboard = options.get(EditorOption.emptySelectionClipboard);
		this.copyWithSyntaxHighlighting = options.get(EditorOption.copyWithSyntaxHighlighting);
		this.multiCursorMergeOverlapping = options.get(EditorOption.multiCursorMergeOverlapping);
		this.multiCursorPaste = options.get(EditorOption.multiCursorPaste);
		this.autoClosingBrackets = options.get(EditorOption.autoClosingBrackets);
		this.autoClosingQuotes = options.get(EditorOption.autoClosingQuotes);
		this.autoClosingOvertype = options.get(EditorOption.autoClosingOvertype);
		this.autoSurround = options.get(EditorOption.autoSurround);
		this.autoIndent = options.get(EditorOption.autoIndent);

		this.autoClosingPairsOpen2 = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsClose2 = new Map<string, StandardAutoClosingPairConditional[]>();
		this.surroundingPairs = {};
		this._electricChars = null;

		this.shouldAutoCloseBefore = {
			quote: CursorConfiguration._getShouldAutoClose(languageIdentifier, this.autoClosingQuotes),
			bracket: CursorConfiguration._getShouldAutoClose(languageIdentifier, this.autoClosingBrackets)
		};

		let autoClosingPairs = CursorConfiguration._getAutoClosingPairs(languageIdentifier);
		if (autoClosingPairs) {
			for (const pair of autoClosingPairs) {
				appendEntry(this.autoClosingPairsOpen2, pair.open.charAt(pair.open.length - 1), pair);
				if (pair.close.length === 1) {
					appendEntry(this.autoClosingPairsClose2, pair.close, pair);
				}
			}
		}

		let surroundingPairs = CursorConfiguration._getSurroundingPairs(languageIdentifier);
		if (surroundingPairs) {
			for (const pair of surroundingPairs) {
				this.surroundingPairs[pair.open] = pair.close;
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

	private static _getAutoClosingPairs(languageIdentifier: LanguageIdentifier): StandardAutoClosingPairConditional[] | null {
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
	public readonly coordinatesConverter: ICoordinatesConverter;
	public readonly cursorConfig: CursorConfiguration;

	constructor(model: ITextModel, coordinatesConverter: ICoordinatesConverter, cursorConfig: CursorConfiguration) {
		this.model = model;
		this.coordinatesConverter = coordinatesConverter;
		this.cursorConfig = cursorConfig;
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

	public static fromModelSelections(modelSelections: readonly ISelection[]): PartialModelCursorState[] {
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

	public static visibleColumnFromColumn(lineContent: string, column: number, tabSize: number): number {
		const lineContentLength = lineContent.length;
		const endOffset = column - 1 < lineContentLength ? column - 1 : lineContentLength;

		let result = 0;
		let i = 0;
		while (i < endOffset) {
			const codePoint = strings.getNextCodePoint(lineContent, endOffset, i);
			i += (codePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);

			if (codePoint === CharCode.Tab) {
				result = CursorColumns.nextRenderTabStop(result, tabSize);
			} else {
				let graphemeBreakType = strings.getGraphemeBreakType(codePoint);
				while (i < endOffset) {
					const nextCodePoint = strings.getNextCodePoint(lineContent, endOffset, i);
					const nextGraphemeBreakType = strings.getGraphemeBreakType(nextCodePoint);
					if (strings.breakBetweenGraphemeBreakType(graphemeBreakType, nextGraphemeBreakType)) {
						break;
					}
					i += (nextCodePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);
					graphemeBreakType = nextGraphemeBreakType;
				}
				if (strings.isFullWidthCharacter(codePoint) || strings.isEmojiImprecise(codePoint)) {
					result = result + 2;
				} else {
					result = result + 1;
				}
			}
		}
		return result;
	}

	public static toStatusbarColumn(lineContent: string, column: number, tabSize: number): number {
		const lineContentLength = lineContent.length;
		const endOffset = column - 1 < lineContentLength ? column - 1 : lineContentLength;

		let result = 0;
		let i = 0;
		while (i < endOffset) {
			const codePoint = strings.getNextCodePoint(lineContent, endOffset, i);
			i += (codePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);

			if (codePoint === CharCode.Tab) {
				result = CursorColumns.nextRenderTabStop(result, tabSize);
			} else {
				result = result + 1;
			}
		}

		return result + 1;
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
		let beforeColumn = 1;
		let i = 0;
		while (i < lineLength) {
			const codePoint = strings.getNextCodePoint(lineContent, lineLength, i);
			i += (codePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);

			let afterVisibleColumn: number;
			if (codePoint === CharCode.Tab) {
				afterVisibleColumn = CursorColumns.nextRenderTabStop(beforeVisibleColumn, tabSize);
			} else {
				let graphemeBreakType = strings.getGraphemeBreakType(codePoint);
				while (i < lineLength) {
					const nextCodePoint = strings.getNextCodePoint(lineContent, lineLength, i);
					const nextGraphemeBreakType = strings.getGraphemeBreakType(nextCodePoint);
					if (strings.breakBetweenGraphemeBreakType(graphemeBreakType, nextGraphemeBreakType)) {
						break;
					}
					i += (nextCodePoint >= Constants.UNICODE_SUPPLEMENTARY_PLANE_BEGIN ? 2 : 1);
					graphemeBreakType = nextGraphemeBreakType;
				}
				if (strings.isFullWidthCharacter(codePoint) || strings.isEmojiImprecise(codePoint)) {
					afterVisibleColumn = beforeVisibleColumn + 2;
				} else {
					afterVisibleColumn = beforeVisibleColumn + 1;
				}
			}
			const afterColumn = i + 1;

			if (afterVisibleColumn >= visibleColumn) {
				const beforeDelta = visibleColumn - beforeVisibleColumn;
				const afterDelta = afterVisibleColumn - visibleColumn;
				if (afterDelta < beforeDelta) {
					return afterColumn;
				} else {
					return beforeColumn;
				}
			}

			beforeVisibleColumn = afterVisibleColumn;
			beforeColumn = afterColumn;
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
