/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { LineTokens } from 'vs/editor/common/core/lineTokens';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { IModelContentChange, IModelContentChangedEvent, IModelDecorationsChangedEvent, IModelLanguageChangedEvent, IModelLanguageConfigurationChangedEvent, IModelOptionsChangedEvent, IModelTokensChangedEvent, ModelRawContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { SearchData } from 'vs/editor/common/model/textModelSearch';
import { LanguageId, LanguageIdentifier, FormattingOptions } from 'vs/editor/common/modes';
import { ThemeColor } from 'vs/platform/theme/common/themeService';
import { MultilineTokens, MultilineTokens2 } from 'vs/editor/common/model/tokensStore';
import { TextChange } from 'vs/editor/common/model/textChange';

/**
 * Vertical Lane in the overview ruler of the editor.
 */
export enum OverviewRulerLane {
	Left = 1,
	Center = 2,
	Right = 4,
	Full = 7
}

/**
 * Position in the minimap to render the decoration.
 */
export enum MinimapPosition {
	Inline = 1,
	Gutter = 2
}

export interface IDecorationOptions {
	/**
	 * CSS color to render.
	 * e.g.: rgba(100, 100, 100, 0.5) or a color from the color registry
	 */
	color: string | ThemeColor | undefined;
	/**
	 * CSS color to render.
	 * e.g.: rgba(100, 100, 100, 0.5) or a color from the color registry
	 */
	darkColor?: string | ThemeColor;
}

/**
 * Options for rendering a model decoration in the overview ruler.
 */
export interface IModelDecorationOverviewRulerOptions extends IDecorationOptions {
	/**
	 * The position in the overview ruler.
	 */
	position: OverviewRulerLane;
}

/**
 * Options for rendering a model decoration in the overview ruler.
 */
export interface IModelDecorationMinimapOptions extends IDecorationOptions {
	/**
	 * The position in the overview ruler.
	 */
	position: MinimapPosition;
}

/**
 * Options for a model decoration.
 */
export interface IModelDecorationOptions {
	/**
	 * Customize the growing behavior of the decoration when typing at the edges of the decoration.
	 * Defaults to TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
	 */
	stickiness?: TrackedRangeStickiness;
	/**
	 * CSS class name describing the decoration.
	 */
	className?: string | null;
	/**
	 * Message to be rendered when hovering over the glyph margin decoration.
	 */
	glyphMarginHoverMessage?: IMarkdownString | IMarkdownString[] | null;
	/**
	 * Array of MarkdownString to render as the decoration message.
	 */
	hoverMessage?: IMarkdownString | IMarkdownString[] | null;
	/**
	 * Should the decoration expand to encompass a whole line.
	 */
	isWholeLine?: boolean;
	/**
	 * Always render the decoration (even when the range it encompasses is collapsed).
	 * @internal
	 */
	showIfCollapsed?: boolean;
	/**
	 * Collapse the decoration if its entire range is being replaced via an edit.
	 * @internal
	 */
	collapseOnReplaceEdit?: boolean;
	/**
	 * Specifies the stack order of a decoration.
	 * A decoration with greater stack order is always in front of a decoration with a lower stack order.
	 */
	zIndex?: number;
	/**
	 * If set, render this decoration in the overview ruler.
	 */
	overviewRuler?: IModelDecorationOverviewRulerOptions | null;
	/**
	 * If set, render this decoration in the minimap.
	 */
	minimap?: IModelDecorationMinimapOptions | null;
	/**
	 * If set, the decoration will be rendered in the glyph margin with this CSS class name.
	 */
	glyphMarginClassName?: string | null;
	/**
	 * If set, the decoration will be rendered in the lines decorations with this CSS class name.
	 */
	linesDecorationsClassName?: string | null;
	/**
	 * If set, the decoration will be rendered in the lines decorations with this CSS class name, but only for the first line in case of line wrapping.
	 */
	firstLineDecorationClassName?: string | null;
	/**
	 * If set, the decoration will be rendered in the margin (covering its full width) with this CSS class name.
	 */
	marginClassName?: string | null;
	/**
	 * If set, the decoration will be rendered inline with the text with this CSS class name.
	 * Please use this only for CSS rules that must impact the text. For example, use `className`
	 * to have a background color decoration.
	 */
	inlineClassName?: string | null;
	/**
	 * If there is an `inlineClassName` which affects letter spacing.
	 */
	inlineClassNameAffectsLetterSpacing?: boolean;
	/**
	 * If set, the decoration will be rendered before the text with this CSS class name.
	 */
	beforeContentClassName?: string | null;
	/**
	 * If set, the decoration will be rendered after the text with this CSS class name.
	 */
	afterContentClassName?: string | null;
}

/**
 * New model decorations.
 */
export interface IModelDeltaDecoration {
	/**
	 * Range that this decoration covers.
	 */
	range: IRange;
	/**
	 * Options associated with this decoration.
	 */
	options: IModelDecorationOptions;
}

/**
 * A decoration in the model.
 */
export interface IModelDecoration {
	/**
	 * Identifier for a decoration.
	 */
	readonly id: string;
	/**
	 * Identifier for a decoration's owner.
	 */
	readonly ownerId: number;
	/**
	 * Range that this decoration covers.
	 */
	readonly range: Range;
	/**
	 * Options associated with this decoration.
	 */
	readonly options: IModelDecorationOptions;
}

/**
 * An accessor that can add, change or remove model decorations.
 * @internal
 */
export interface IModelDecorationsChangeAccessor {
	/**
	 * Add a new decoration.
	 * @param range Range that this decoration covers.
	 * @param options Options associated with this decoration.
	 * @return An unique identifier associated with this decoration.
	 */
	addDecoration(range: IRange, options: IModelDecorationOptions): string;
	/**
	 * Change the range that an existing decoration covers.
	 * @param id The unique identifier associated with the decoration.
	 * @param newRange The new range that this decoration covers.
	 */
	changeDecoration(id: string, newRange: IRange): void;
	/**
	 * Change the options associated with an existing decoration.
	 * @param id The unique identifier associated with the decoration.
	 * @param newOptions The new options associated with this decoration.
	 */
	changeDecorationOptions(id: string, newOptions: IModelDecorationOptions): void;
	/**
	 * Remove an existing decoration.
	 * @param id The unique identifier associated with the decoration.
	 */
	removeDecoration(id: string): void;
	/**
	 * Perform a minimum amount of operations, in order to transform the decorations
	 * identified by `oldDecorations` to the decorations described by `newDecorations`
	 * and returns the new identifiers associated with the resulting decorations.
	 *
	 * @param oldDecorations Array containing previous decorations identifiers.
	 * @param newDecorations Array describing what decorations should result after the call.
	 * @return An array containing the new decorations identifiers.
	 */
	deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
}

/**
 * Word inside a model.
 */
export interface IWordAtPosition {
	/**
	 * The word.
	 */
	readonly word: string;
	/**
	 * The column where the word starts.
	 */
	readonly startColumn: number;
	/**
	 * The column where the word ends.
	 */
	readonly endColumn: number;
}

/**
 * End of line character preference.
 */
export const enum EndOfLinePreference {
	/**
	 * Use the end of line character identified in the text buffer.
	 */
	TextDefined = 0,
	/**
	 * Use line feed (\n) as the end of line character.
	 */
	LF = 1,
	/**
	 * Use carriage return and line feed (\r\n) as the end of line character.
	 */
	CRLF = 2
}

/**
 * The default end of line to use when instantiating models.
 */
export const enum DefaultEndOfLine {
	/**
	 * Use line feed (\n) as the end of line character.
	 */
	LF = 1,
	/**
	 * Use carriage return and line feed (\r\n) as the end of line character.
	 */
	CRLF = 2
}

/**
 * End of line character preference.
 */
export const enum EndOfLineSequence {
	/**
	 * Use line feed (\n) as the end of line character.
	 */
	LF = 0,
	/**
	 * Use carriage return and line feed (\r\n) as the end of line character.
	 */
	CRLF = 1
}

/**
 * An identifier for a single edit operation.
 * @internal
 */
export interface ISingleEditOperationIdentifier {
	/**
	 * Identifier major
	 */
	major: number;
	/**
	 * Identifier minor
	 */
	minor: number;
}

/**
 * A single edit operation, that acts as a simple replace.
 * i.e. Replace text at `range` with `text` in model.
 */
export interface ISingleEditOperation {
	/**
	 * The range to replace. This can be empty to emulate a simple insert.
	 */
	range: IRange;
	/**
	 * The text to replace with. This can be null to emulate a simple delete.
	 */
	text: string | null;
	/**
	 * This indicates that this operation has "insert" semantics.
	 * i.e. forceMoveMarkers = true => if `range` is collapsed, all markers at the position will be moved.
	 */
	forceMoveMarkers?: boolean;
}

/**
 * A single edit operation, that has an identifier.
 */
export interface IIdentifiedSingleEditOperation {
	/**
	 * An identifier associated with this single edit operation.
	 * @internal
	 */
	identifier?: ISingleEditOperationIdentifier | null;
	/**
	 * The range to replace. This can be empty to emulate a simple insert.
	 */
	range: IRange;
	/**
	 * The text to replace with. This can be null to emulate a simple delete.
	 */
	text: string | null;
	/**
	 * This indicates that this operation has "insert" semantics.
	 * i.e. forceMoveMarkers = true => if `range` is collapsed, all markers at the position will be moved.
	 */
	forceMoveMarkers?: boolean;
	/**
	 * This indicates that this operation is inserting automatic whitespace
	 * that can be removed on next model edit operation if `config.trimAutoWhitespace` is true.
	 * @internal
	 */
	isAutoWhitespaceEdit?: boolean;
	/**
	 * This indicates that this operation is in a set of operations that are tracked and should not be "simplified".
	 * @internal
	 */
	_isTracked?: boolean;
}

export interface IValidEditOperation {
	/**
	 * An identifier associated with this single edit operation.
	 * @internal
	 */
	identifier: ISingleEditOperationIdentifier | null;
	/**
	 * The range to replace. This can be empty to emulate a simple insert.
	 */
	range: Range;
	/**
	 * The text to replace with. This can be empty to emulate a simple delete.
	 */
	text: string;
	/**
	 * @internal
	 */
	textChange: TextChange;
}

/**
 * A callback that can compute the cursor state after applying a series of edit operations.
 */
export interface ICursorStateComputer {
	/**
	 * A callback that can compute the resulting cursors state after some edit operations have been executed.
	 */
	(inverseEditOperations: IValidEditOperation[]): Selection[] | null;
}

export class TextModelResolvedOptions {
	_textModelResolvedOptionsBrand: void;

	readonly tabSize: number;
	readonly indentSize: number;
	readonly insertSpaces: boolean;
	readonly defaultEOL: DefaultEndOfLine;
	readonly trimAutoWhitespace: boolean;

	/**
	 * @internal
	 */
	constructor(src: {
		tabSize: number;
		indentSize: number;
		insertSpaces: boolean;
		defaultEOL: DefaultEndOfLine;
		trimAutoWhitespace: boolean;
	}) {
		this.tabSize = Math.max(1, src.tabSize | 0);
		this.indentSize = src.tabSize | 0;
		this.insertSpaces = Boolean(src.insertSpaces);
		this.defaultEOL = src.defaultEOL | 0;
		this.trimAutoWhitespace = Boolean(src.trimAutoWhitespace);
	}

	/**
	 * @internal
	 */
	public equals(other: TextModelResolvedOptions): boolean {
		return (
			this.tabSize === other.tabSize
			&& this.indentSize === other.indentSize
			&& this.insertSpaces === other.insertSpaces
			&& this.defaultEOL === other.defaultEOL
			&& this.trimAutoWhitespace === other.trimAutoWhitespace
		);
	}

	/**
	 * @internal
	 */
	public createChangeEvent(newOpts: TextModelResolvedOptions): IModelOptionsChangedEvent {
		return {
			tabSize: this.tabSize !== newOpts.tabSize,
			indentSize: this.indentSize !== newOpts.indentSize,
			insertSpaces: this.insertSpaces !== newOpts.insertSpaces,
			trimAutoWhitespace: this.trimAutoWhitespace !== newOpts.trimAutoWhitespace,
		};
	}
}

/**
 * @internal
 */
export interface ITextModelCreationOptions {
	tabSize: number;
	indentSize: number;
	insertSpaces: boolean;
	detectIndentation: boolean;
	trimAutoWhitespace: boolean;
	defaultEOL: DefaultEndOfLine;
	isForSimpleWidget: boolean;
	largeFileOptimizations: boolean;
}

export interface ITextModelUpdateOptions {
	tabSize?: number;
	indentSize?: number;
	insertSpaces?: boolean;
	trimAutoWhitespace?: boolean;
}

export class FindMatch {
	_findMatchBrand: void;

	public readonly range: Range;
	public readonly matches: string[] | null;

	/**
	 * @internal
	 */
	constructor(range: Range, matches: string[] | null) {
		this.range = range;
		this.matches = matches;
	}
}

/**
 * @internal
 */
export interface IFoundBracket {
	range: Range;
	open: string[];
	close: string[];
	isOpen: boolean;
}

/**
 * Describes the behavior of decorations when typing/editing near their edges.
 * Note: Please do not edit the values, as they very carefully match `DecorationRangeBehavior`
 */
export const enum TrackedRangeStickiness {
	AlwaysGrowsWhenTypingAtEdges = 0,
	NeverGrowsWhenTypingAtEdges = 1,
	GrowsOnlyWhenTypingBefore = 2,
	GrowsOnlyWhenTypingAfter = 3,
}

/**
 * @internal
 */
export interface IActiveIndentGuideInfo {
	startLineNumber: number;
	endLineNumber: number;
	indent: number;
}

/**
 * Text snapshot that works like an iterator.
 * Will try to return chunks of roughly ~64KB size.
 * Will return null when finished.
 *
 * @internal
 */
export interface ITextSnapshot {
	read(): string | null;
}

/**
 * A model.
 */
export interface ITextModel {

	/**
	 * Gets the resource associated with this editor model.
	 */
	readonly uri: URI;

	/**
	 * A unique identifier associated with this model.
	 */
	readonly id: string;

	/**
	 * This model is constructed for a simple widget code editor.
	 * @internal
	 */
	readonly isForSimpleWidget: boolean;

	/**
	 * If true, the text model might contain RTL.
	 * If false, the text model **contains only** contain LTR.
	 * @internal
	 */
	mightContainRTL(): boolean;

	/**
	 * If true, the text model might contain LINE SEPARATOR (LS), PARAGRAPH SEPARATOR (PS).
	 * If false, the text model definitely does not contain these.
	 * @internal
	 */
	mightContainUnusualLineTerminators(): boolean;

	/**
	 * @internal
	 */
	removeUnusualLineTerminators(selections?: Selection[]): void;

	/**
	 * If true, the text model might contain non basic ASCII.
	 * If false, the text model **contains only** basic ASCII.
	 * @internal
	 */
	mightContainNonBasicASCII(): boolean;

	/**
	 * Get the resolved options for this model.
	 */
	getOptions(): TextModelResolvedOptions;

	/**
	 * Get the formatting options for this model.
	 * @internal
	 */
	getFormattingOptions(): FormattingOptions;

	/**
	 * Get the current version id of the model.
	 * Anytime a change happens to the model (even undo/redo),
	 * the version id is incremented.
	 */
	getVersionId(): number;

	/**
	 * Get the alternative version id of the model.
	 * This alternative version id is not always incremented,
	 * it will return the same values in the case of undo-redo.
	 */
	getAlternativeVersionId(): number;

	/**
	 * Replace the entire text buffer value contained in this model.
	 */
	setValue(newValue: string): void;

	/**
	 * Replace the entire text buffer value contained in this model.
	 * @internal
	 */
	setValueFromTextBuffer(newValue: ITextBuffer): void;

	/**
	 * Get the text stored in this model.
	 * @param eol The end of line character preference. Defaults to `EndOfLinePreference.TextDefined`.
	 * @param preserverBOM Preserve a BOM character if it was detected when the model was constructed.
	 * @return The text.
	 */
	getValue(eol?: EndOfLinePreference, preserveBOM?: boolean): string;

	/**
	 * Get the text stored in this model.
	 * @param preserverBOM Preserve a BOM character if it was detected when the model was constructed.
	 * @return The text snapshot (it is safe to consume it asynchronously).
	 * @internal
	 */
	createSnapshot(preserveBOM?: boolean): ITextSnapshot;

	/**
	 * Get the length of the text stored in this model.
	 */
	getValueLength(eol?: EndOfLinePreference, preserveBOM?: boolean): number;

	/**
	 * Check if the raw text stored in this model equals another raw text.
	 * @internal
	 */
	equalsTextBuffer(other: ITextBuffer): boolean;

	/**
	 * Get the underling text buffer.
	 * @internal
	 */
	getTextBuffer(): ITextBuffer;

	/**
	 * Get the text in a certain range.
	 * @param range The range describing what text to get.
	 * @param eol The end of line character preference. This will only be used for multiline ranges. Defaults to `EndOfLinePreference.TextDefined`.
	 * @return The text.
	 */
	getValueInRange(range: IRange, eol?: EndOfLinePreference): string;

	/**
	 * Get the length of text in a certain range.
	 * @param range The range describing what text length to get.
	 * @return The text length.
	 */
	getValueLengthInRange(range: IRange): number;

	/**
	 * Get the character count of text in a certain range.
	 * @param range The range describing what text length to get.
	 */
	getCharacterCountInRange(range: IRange): number;

	/**
	 * Splits characters in two buckets. First bucket (A) is of characters that
	 * sit in lines with length < `LONG_LINE_BOUNDARY`. Second bucket (B) is of
	 * characters that sit in lines with length >= `LONG_LINE_BOUNDARY`.
	 * If count(B) > count(A) return true. Returns false otherwise.
	 * @internal
	 */
	isDominatedByLongLines(): boolean;

	/**
	 * Get the number of lines in the model.
	 */
	getLineCount(): number;

	/**
	 * Get the text for a certain line.
	 */
	getLineContent(lineNumber: number): string;

	/**
	 * Get the text length for a certain line.
	 */
	getLineLength(lineNumber: number): number;

	/**
	 * Get the text for all lines.
	 */
	getLinesContent(): string[];

	/**
	 * Get the end of line sequence predominantly used in the text buffer.
	 * @return EOL char sequence (e.g.: '\n' or '\r\n').
	 */
	getEOL(): string;

	/**
	 * Get the end of line sequence predominantly used in the text buffer.
	 */
	getEndOfLineSequence(): EndOfLineSequence;

	/**
	 * Get the minimum legal column for line at `lineNumber`
	 */
	getLineMinColumn(lineNumber: number): number;

	/**
	 * Get the maximum legal column for line at `lineNumber`
	 */
	getLineMaxColumn(lineNumber: number): number;

	/**
	 * Returns the column before the first non whitespace character for line at `lineNumber`.
	 * Returns 0 if line is empty or contains only whitespace.
	 */
	getLineFirstNonWhitespaceColumn(lineNumber: number): number;

	/**
	 * Returns the column after the last non whitespace character for line at `lineNumber`.
	 * Returns 0 if line is empty or contains only whitespace.
	 */
	getLineLastNonWhitespaceColumn(lineNumber: number): number;

	/**
	 * Create a valid position,
	 */
	validatePosition(position: IPosition): Position;

	/**
	 * Advances the given position by the given offset (negative offsets are also accepted)
	 * and returns it as a new valid position.
	 *
	 * If the offset and position are such that their combination goes beyond the beginning or
	 * end of the model, throws an exception.
	 *
	 * If the offset is such that the new position would be in the middle of a multi-byte
	 * line terminator, throws an exception.
	 */
	modifyPosition(position: IPosition, offset: number): Position;

	/**
	 * Create a valid range.
	 */
	validateRange(range: IRange): Range;

	/**
	 * Converts the position to a zero-based offset.
	 *
	 * The position will be [adjusted](#TextDocument.validatePosition).
	 *
	 * @param position A position.
	 * @return A valid zero-based offset.
	 */
	getOffsetAt(position: IPosition): number;

	/**
	 * Converts a zero-based offset to a position.
	 *
	 * @param offset A zero-based offset.
	 * @return A valid [position](#Position).
	 */
	getPositionAt(offset: number): Position;

	/**
	 * Get a range covering the entire model
	 */
	getFullModelRange(): Range;

	/**
	 * Returns if the model was disposed or not.
	 */
	isDisposed(): boolean;

	/**
	 * @internal
	 */
	tokenizeViewport(startLineNumber: number, endLineNumber: number): void;

	/**
	 * This model is so large that it would not be a good idea to sync it over
	 * to web workers or other places.
	 * @internal
	 */
	isTooLargeForSyncing(): boolean;

	/**
	 * The file is so large, that even tokenization is disabled.
	 * @internal
	 */
	isTooLargeForTokenization(): boolean;

	/**
	 * Search the model.
	 * @param searchString The string used to search. If it is a regular expression, set `isRegex` to true.
	 * @param searchOnlyEditableRange Limit the searching to only search inside the editable range of the model.
	 * @param isRegex Used to indicate that `searchString` is a regular expression.
	 * @param matchCase Force the matching to match lower/upper case exactly.
	 * @param wordSeparators Force the matching to match entire words only. Pass null otherwise.
	 * @param captureMatches The result will contain the captured groups.
	 * @param limitResultCount Limit the number of results
	 * @return The ranges where the matches are. It is empty if not matches have been found.
	 */
	findMatches(searchString: string, searchOnlyEditableRange: boolean, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean, limitResultCount?: number): FindMatch[];
	/**
	 * Search the model.
	 * @param searchString The string used to search. If it is a regular expression, set `isRegex` to true.
	 * @param searchScope Limit the searching to only search inside these ranges.
	 * @param isRegex Used to indicate that `searchString` is a regular expression.
	 * @param matchCase Force the matching to match lower/upper case exactly.
	 * @param wordSeparators Force the matching to match entire words only. Pass null otherwise.
	 * @param captureMatches The result will contain the captured groups.
	 * @param limitResultCount Limit the number of results
	 * @return The ranges where the matches are. It is empty if no matches have been found.
	 */
	findMatches(searchString: string, searchScope: IRange | IRange[], isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean, limitResultCount?: number): FindMatch[];
	/**
	 * Search the model for the next match. Loops to the beginning of the model if needed.
	 * @param searchString The string used to search. If it is a regular expression, set `isRegex` to true.
	 * @param searchStart Start the searching at the specified position.
	 * @param isRegex Used to indicate that `searchString` is a regular expression.
	 * @param matchCase Force the matching to match lower/upper case exactly.
	 * @param wordSeparators Force the matching to match entire words only. Pass null otherwise.
	 * @param captureMatches The result will contain the captured groups.
	 * @return The range where the next match is. It is null if no next match has been found.
	 */
	findNextMatch(searchString: string, searchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean): FindMatch | null;
	/**
	 * Search the model for the previous match. Loops to the end of the model if needed.
	 * @param searchString The string used to search. If it is a regular expression, set `isRegex` to true.
	 * @param searchStart Start the searching at the specified position.
	 * @param isRegex Used to indicate that `searchString` is a regular expression.
	 * @param matchCase Force the matching to match lower/upper case exactly.
	 * @param wordSeparators Force the matching to match entire words only. Pass null otherwise.
	 * @param captureMatches The result will contain the captured groups.
	 * @return The range where the previous match is. It is null if no previous match has been found.
	 */
	findPreviousMatch(searchString: string, searchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean): FindMatch | null;

	/**
	 * @internal
	 */
	setTokens(tokens: MultilineTokens[]): void;

	/**
	 * @internal
	 */
	setSemanticTokens(tokens: MultilineTokens2[] | null, isComplete: boolean): void;

	/**
	 * @internal
	 */
	setPartialSemanticTokens(range: Range, tokens: MultilineTokens2[] | null): void;

	/**
	 * @internal
	 */
	hasSemanticTokens(): boolean;

	/**
	 * Flush all tokenization state.
	 * @internal
	 */
	resetTokenization(): void;

	/**
	 * Force tokenization information for `lineNumber` to be accurate.
	 * @internal
	 */
	forceTokenization(lineNumber: number): void;

	/**
	 * If it is cheap, force tokenization information for `lineNumber` to be accurate.
	 * This is based on a heuristic.
	 * @internal
	 */
	tokenizeIfCheap(lineNumber: number): void;

	/**
	 * Check if calling `forceTokenization` for this `lineNumber` will be cheap (time-wise).
	 * This is based on a heuristic.
	 * @internal
	 */
	isCheapToTokenize(lineNumber: number): boolean;

	/**
	 * Get the tokens for the line `lineNumber`.
	 * The tokens might be inaccurate. Use `forceTokenization` to ensure accurate tokens.
	 * @internal
	 */
	getLineTokens(lineNumber: number): LineTokens;

	/**
	 * Get the language associated with this model.
	 * @internal
	 */
	getLanguageIdentifier(): LanguageIdentifier;

	/**
	 * Get the language associated with this model.
	 */
	getModeId(): string;

	/**
	 * Set the current language mode associated with the model.
	 * @internal
	 */
	setMode(languageIdentifier: LanguageIdentifier): void;

	/**
	 * Returns the real (inner-most) language mode at a given position.
	 * The result might be inaccurate. Use `forceTokenization` to ensure accurate tokens.
	 * @internal
	 */
	getLanguageIdAtPosition(lineNumber: number, column: number): LanguageId;

	/**
	 * Get the word under or besides `position`.
	 * @param position The position to look for a word.
	 * @return The word under or besides `position`. Might be null.
	 */
	getWordAtPosition(position: IPosition): IWordAtPosition | null;

	/**
	 * Get the word under or besides `position` trimmed to `position`.column
	 * @param position The position to look for a word.
	 * @return The word under or besides `position`. Will never be null.
	 */
	getWordUntilPosition(position: IPosition): IWordAtPosition;

	/**
	 * Find the matching bracket of `request` up, counting brackets.
	 * @param request The bracket we're searching for
	 * @param position The position at which to start the search.
	 * @return The range of the matching bracket, or null if the bracket match was not found.
	 * @internal
	 */
	findMatchingBracketUp(bracket: string, position: IPosition): Range | null;

	/**
	 * Find the first bracket in the model before `position`.
	 * @param position The position at which to start the search.
	 * @return The info for the first bracket before `position`, or null if there are no more brackets before `positions`.
	 * @internal
	 */
	findPrevBracket(position: IPosition): IFoundBracket | null;

	/**
	 * Find the first bracket in the model after `position`.
	 * @param position The position at which to start the search.
	 * @return The info for the first bracket after `position`, or null if there are no more brackets after `positions`.
	 * @internal
	 */
	findNextBracket(position: IPosition): IFoundBracket | null;

	/**
	 * Find the enclosing brackets that contain `position`.
	 * @param position The position at which to start the search.
	 * @internal
	 */
	findEnclosingBrackets(position: IPosition, maxDuration?: number): [Range, Range] | null;

	/**
	 * Given a `position`, if the position is on top or near a bracket,
	 * find the matching bracket of that bracket and return the ranges of both brackets.
	 * @param position The position at which to look for a bracket.
	 * @internal
	 */
	matchBracket(position: IPosition): [Range, Range] | null;

	/**
	 * @internal
	 */
	getActiveIndentGuide(lineNumber: number, minLineNumber: number, maxLineNumber: number): IActiveIndentGuideInfo;

	/**
	 * @internal
	 */
	getLinesIndentGuides(startLineNumber: number, endLineNumber: number): number[];

	/**
	 * Change the decorations. The callback will be called with a change accessor
	 * that becomes invalid as soon as the callback finishes executing.
	 * This allows for all events to be queued up until the change
	 * is completed. Returns whatever the callback returns.
	 * @param ownerId Identifies the editor id in which these decorations should appear. If no `ownerId` is provided, the decorations will appear in all editors that attach this model.
	 * @internal
	 */
	changeDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T, ownerId?: number): T | null;

	/**
	 * Perform a minimum amount of operations, in order to transform the decorations
	 * identified by `oldDecorations` to the decorations described by `newDecorations`
	 * and returns the new identifiers associated with the resulting decorations.
	 *
	 * @param oldDecorations Array containing previous decorations identifiers.
	 * @param newDecorations Array describing what decorations should result after the call.
	 * @param ownerId Identifies the editor id in which these decorations should appear. If no `ownerId` is provided, the decorations will appear in all editors that attach this model.
	 * @return An array containing the new decorations identifiers.
	 */
	deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[], ownerId?: number): string[];

	/**
	 * Remove all decorations that have been added with this specific ownerId.
	 * @param ownerId The owner id to search for.
	 * @internal
	 */
	removeAllDecorationsWithOwnerId(ownerId: number): void;

	/**
	 * Get the options associated with a decoration.
	 * @param id The decoration id.
	 * @return The decoration options or null if the decoration was not found.
	 */
	getDecorationOptions(id: string): IModelDecorationOptions | null;

	/**
	 * Get the range associated with a decoration.
	 * @param id The decoration id.
	 * @return The decoration range or null if the decoration was not found.
	 */
	getDecorationRange(id: string): Range | null;

	/**
	 * Gets all the decorations for the line `lineNumber` as an array.
	 * @param lineNumber The line number
	 * @param ownerId If set, it will ignore decorations belonging to other owners.
	 * @param filterOutValidation If set, it will ignore decorations specific to validation (i.e. warnings, errors).
	 * @return An array with the decorations
	 */
	getLineDecorations(lineNumber: number, ownerId?: number, filterOutValidation?: boolean): IModelDecoration[];

	/**
	 * Gets all the decorations for the lines between `startLineNumber` and `endLineNumber` as an array.
	 * @param startLineNumber The start line number
	 * @param endLineNumber The end line number
	 * @param ownerId If set, it will ignore decorations belonging to other owners.
	 * @param filterOutValidation If set, it will ignore decorations specific to validation (i.e. warnings, errors).
	 * @return An array with the decorations
	 */
	getLinesDecorations(startLineNumber: number, endLineNumber: number, ownerId?: number, filterOutValidation?: boolean): IModelDecoration[];

	/**
	 * Gets all the decorations in a range as an array. Only `startLineNumber` and `endLineNumber` from `range` are used for filtering.
	 * So for now it returns all the decorations on the same line as `range`.
	 * @param range The range to search in
	 * @param ownerId If set, it will ignore decorations belonging to other owners.
	 * @param filterOutValidation If set, it will ignore decorations specific to validation (i.e. warnings, errors).
	 * @return An array with the decorations
	 */
	getDecorationsInRange(range: IRange, ownerId?: number, filterOutValidation?: boolean): IModelDecoration[];

	/**
	 * Gets all the decorations as an array.
	 * @param ownerId If set, it will ignore decorations belonging to other owners.
	 * @param filterOutValidation If set, it will ignore decorations specific to validation (i.e. warnings, errors).
	 */
	getAllDecorations(ownerId?: number, filterOutValidation?: boolean): IModelDecoration[];

	/**
	 * Gets all the decorations that should be rendered in the overview ruler as an array.
	 * @param ownerId If set, it will ignore decorations belonging to other owners.
	 * @param filterOutValidation If set, it will ignore decorations specific to validation (i.e. warnings, errors).
	 */
	getOverviewRulerDecorations(ownerId?: number, filterOutValidation?: boolean): IModelDecoration[];

	/**
	 * @internal
	 */
	_getTrackedRange(id: string): Range | null;

	/**
	 * @internal
	 */
	_setTrackedRange(id: string | null, newRange: null, newStickiness: TrackedRangeStickiness): null;
	/**
	 * @internal
	 */
	_setTrackedRange(id: string | null, newRange: Range, newStickiness: TrackedRangeStickiness): string;

	/**
	 * Normalize a string containing whitespace according to indentation rules (converts to spaces or to tabs).
	 */
	normalizeIndentation(str: string): string;

	/**
	 * Change the options of this model.
	 */
	updateOptions(newOpts: ITextModelUpdateOptions): void;

	/**
	 * Detect the indentation options for this model from its content.
	 */
	detectIndentation(defaultInsertSpaces: boolean, defaultTabSize: number): void;

	/**
	 * Push a stack element onto the undo stack. This acts as an undo/redo point.
	 * The idea is to use `pushEditOperations` to edit the model and then to
	 * `pushStackElement` to create an undo/redo stop point.
	 */
	pushStackElement(): void;

	/**
	 * Push edit operations, basically editing the model. This is the preferred way
	 * of editing the model. The edit operations will land on the undo stack.
	 * @param beforeCursorState The cursor state before the edit operations. This cursor state will be returned when `undo` or `redo` are invoked.
	 * @param editOperations The edit operations.
	 * @param cursorStateComputer A callback that can compute the resulting cursors state after the edit operations have been executed.
	 * @return The cursor state returned by the `cursorStateComputer`.
	 */
	pushEditOperations(beforeCursorState: Selection[] | null, editOperations: IIdentifiedSingleEditOperation[], cursorStateComputer: ICursorStateComputer): Selection[] | null;

	/**
	 * Change the end of line sequence. This is the preferred way of
	 * changing the eol sequence. This will land on the undo stack.
	 */
	pushEOL(eol: EndOfLineSequence): void;

	/**
	 * Edit the model without adding the edits to the undo stack.
	 * This can have dire consequences on the undo stack! See @pushEditOperations for the preferred way.
	 * @param operations The edit operations.
	 * @return If desired, the inverse edit operations, that, when applied, will bring the model back to the previous state.
	 */
	applyEdits(operations: IIdentifiedSingleEditOperation[]): void;
	applyEdits(operations: IIdentifiedSingleEditOperation[], computeUndoEdits: false): void;
	applyEdits(operations: IIdentifiedSingleEditOperation[], computeUndoEdits: true): IValidEditOperation[];

	/**
	 * Change the end of line sequence without recording in the undo stack.
	 * This can have dire consequences on the undo stack! See @pushEOL for the preferred way.
	 */
	setEOL(eol: EndOfLineSequence): void;

	/**
	 * @internal
	 */
	_applyUndo(changes: TextChange[], eol: EndOfLineSequence, resultingAlternativeVersionId: number, resultingSelection: Selection[] | null): void;

	/**
	 * @internal
	 */
	_applyRedo(changes: TextChange[], eol: EndOfLineSequence, resultingAlternativeVersionId: number, resultingSelection: Selection[] | null): void;

	/**
	 * Undo edit operations until the first previous stop point created by `pushStackElement`.
	 * The inverse edit operations will be pushed on the redo stack.
	 * @internal
	 */
	undo(): void | Promise<void>;

	/**
	 * Is there anything in the undo stack?
	 * @internal
	 */
	canUndo(): boolean;

	/**
	 * Redo edit operations until the next stop point created by `pushStackElement`.
	 * The inverse edit operations will be pushed on the undo stack.
	 * @internal
	 */
	redo(): void | Promise<void>;

	/**
	 * Is there anything in the redo stack?
	 * @internal
	 */
	canRedo(): boolean;

	/**
	 * @deprecated Please use `onDidChangeContent` instead.
	 * An event emitted when the contents of the model have changed.
	 * @internal
	 * @event
	 */
	onDidChangeRawContentFast(listener: (e: ModelRawContentChangedEvent) => void): IDisposable;
	/**
	 * @deprecated Please use `onDidChangeContent` instead.
	 * An event emitted when the contents of the model have changed.
	 * @internal
	 * @event
	 */
	onDidChangeRawContent(listener: (e: ModelRawContentChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when the contents of the model have changed.
	 * @event
	 */
	onDidChangeContent(listener: (e: IModelContentChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when decorations of the model have changed.
	 * @event
	 */
	onDidChangeDecorations(listener: (e: IModelDecorationsChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when the model options have changed.
	 * @event
	 */
	onDidChangeOptions(listener: (e: IModelOptionsChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when the language associated with the model has changed.
	 * @event
	 */
	onDidChangeLanguage(listener: (e: IModelLanguageChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when the language configuration associated with the model has changed.
	 * @event
	 */
	onDidChangeLanguageConfiguration(listener: (e: IModelLanguageConfigurationChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when the tokens associated with the model have changed.
	 * @event
	 * @internal
	 */
	onDidChangeTokens(listener: (e: IModelTokensChangedEvent) => void): IDisposable;
	/**
	 * An event emitted when the model has been attached to the first editor or detached from the last editor.
	 * @event
	 * @internal
	 */
	onDidChangeAttached(listener: () => void): IDisposable;
	/**
	 * An event emitted right before disposing the model.
	 * @event
	 */
	onWillDispose(listener: () => void): IDisposable;

	/**
	 * Destroy this model. This will unbind the model from the mode
	 * and make all necessary clean-up to release this object to the GC.
	 */
	dispose(): void;

	/**
	 * @internal
	 */
	onBeforeAttached(): void;

	/**
	 * @internal
	 */
	onBeforeDetached(): void;

	/**
	 * Returns if this model is attached to an editor or not.
	 * @internal
	 */
	isAttachedToEditor(): boolean;

	/**
	 * Returns the count of editors this model is attached to.
	 * @internal
	 */
	getAttachedEditorCount(): number;
}

/**
 * @internal
 */
export interface ITextBufferBuilder {
	acceptChunk(chunk: string): void;
	finish(): ITextBufferFactory;
}

/**
 * @internal
 */
export interface ITextBufferFactory {
	create(defaultEOL: DefaultEndOfLine): ITextBuffer;
	getFirstLineText(lengthLimit: number): string;
}

/**
 * @internal
 */
export const enum ModelConstants {
	FIRST_LINE_DETECTION_LENGTH_LIMIT = 1000
}

/**
 * @internal
 */
export class ValidAnnotatedEditOperation implements IIdentifiedSingleEditOperation {
	constructor(
		public readonly identifier: ISingleEditOperationIdentifier | null,
		public readonly range: Range,
		public readonly text: string | null,
		public readonly forceMoveMarkers: boolean,
		public readonly isAutoWhitespaceEdit: boolean,
		public readonly _isTracked: boolean,
	) { }
}

/**
 * @internal
 */
export interface IReadonlyTextBuffer {
	onDidChangeContent: Event<void>;
	equals(other: ITextBuffer): boolean;
	mightContainRTL(): boolean;
	mightContainUnusualLineTerminators(): boolean;
	resetMightContainUnusualLineTerminators(): void;
	mightContainNonBasicASCII(): boolean;
	getBOM(): string;
	getEOL(): string;

	getOffsetAt(lineNumber: number, column: number): number;
	getPositionAt(offset: number): Position;
	getRangeAt(offset: number, length: number): Range;

	getValueInRange(range: Range, eol: EndOfLinePreference): string;
	createSnapshot(preserveBOM: boolean): ITextSnapshot;
	getValueLengthInRange(range: Range, eol: EndOfLinePreference): number;
	getCharacterCountInRange(range: Range, eol: EndOfLinePreference): number;
	getLength(): number;
	getLineCount(): number;
	getLinesContent(): string[];
	getLineContent(lineNumber: number): string;
	getLineCharCode(lineNumber: number, index: number): number;
	getCharCode(offset: number): number;
	getLineLength(lineNumber: number): number;
	getLineFirstNonWhitespaceColumn(lineNumber: number): number;
	getLineLastNonWhitespaceColumn(lineNumber: number): number;
	findMatchesLineByLine(searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): FindMatch[];
}

/**
 * @internal
 */
export interface ITextBuffer extends IReadonlyTextBuffer {
	setEOL(newEOL: '\r\n' | '\n'): void;
	applyEdits(rawOperations: ValidAnnotatedEditOperation[], recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): ApplyEditsResult;
}

/**
 * @internal
 */
export class ApplyEditsResult {

	constructor(
		public readonly reverseEdits: IValidEditOperation[] | null,
		public readonly changes: IInternalModelContentChange[],
		public readonly trimAutoWhitespaceLineNumbers: number[] | null
	) { }

}

/**
 * @internal
 */
export interface IInternalModelContentChange extends IModelContentChange {
	range: Range;
	forceMoveMarkers: boolean;
}
