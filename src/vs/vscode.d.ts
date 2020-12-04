/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	/**
	 * The version of the editor.
	 */
	export const version: string;

	/**
	 * Represents a reference to a command. Provides a title which
	 * will be used to represent a command in the UI and, optionally,
	 * an array of arguments which will be passed to the command handler
	 * function when invoked.
	 */
	export interface Command {
		/**
		 * Title of the command, like `save`.
		 */
		title: string;

		/**
		 * The identifier of the actual command handler.
		 * @see [commands.registerCommand](#commands.registerCommand).
		 */
		command: string;

		/**
		 * A tooltip for the command, when represented in the UI.
		 */
		tooltip?: string;

		/**
		 * Arguments that the command handler should be
		 * invoked with.
		 */
		arguments?: any[];
	}

	/**
	 * Represents a line of text, such as a line of source code.
	 *
	 * TextLine objects are __immutable__. When a [document](#TextDocument) changes,
	 * previously retrieved lines will not represent the latest state.
	 */
	export interface TextLine {

		/**
		 * The zero-based line number.
		 */
		readonly lineNumber: number;

		/**
		 * The text of this line without the line separator characters.
		 */
		readonly text: string;

		/**
		 * The range this line covers without the line separator characters.
		 */
		readonly range: Range;

		/**
		 * The range this line covers with the line separator characters.
		 */
		readonly rangeIncludingLineBreak: Range;

		/**
		 * The offset of the first character which is not a whitespace character as defined
		 * by `/\s/`. **Note** that if a line is all whitespace the length of the line is returned.
		 */
		readonly firstNonWhitespaceCharacterIndex: number;

		/**
		 * Whether this line is whitespace only, shorthand
		 * for [TextLine.firstNonWhitespaceCharacterIndex](#TextLine.firstNonWhitespaceCharacterIndex) === [TextLine.text.length](#TextLine.text).
		 */
		readonly isEmptyOrWhitespace: boolean;
	}

	/**
	 * Represents a text document, such as a source file. Text documents have
	 * [lines](#TextLine) and knowledge about an underlying resource like a file.
	 */
	export interface TextDocument {

		/**
		 * The associated uri for this document.
		 *
		 * *Note* that most documents use the `file`-scheme, which means they are files on disk. However, **not** all documents are
		 * saved on disk and therefore the `scheme` must be checked before trying to access the underlying file or siblings on disk.
		 *
		 * @see [FileSystemProvider](#FileSystemProvider)
		 * @see [TextDocumentContentProvider](#TextDocumentContentProvider)
		 */
		readonly uri: Uri;

		/**
		 * The file system path of the associated resource. Shorthand
		 * notation for [TextDocument.uri.fsPath](#TextDocument.uri). Independent of the uri scheme.
		 */
		readonly fileName: string;

		/**
		 * Is this document representing an untitled file which has never been saved yet. *Note* that
		 * this does not mean the document will be saved to disk, use [`uri.scheme`](#Uri.scheme)
		 * to figure out where a document will be [saved](#FileSystemProvider), e.g. `file`, `ftp` etc.
		 */
		readonly isUntitled: boolean;

		/**
		 * The identifier of the language associated with this document.
		 */
		readonly languageId: string;

		/**
		 * The version number of this document (it will strictly increase after each
		 * change, including undo/redo).
		 */
		readonly version: number;

		/**
		 * `true` if there are unpersisted changes.
		 */
		readonly isDirty: boolean;

		/**
		 * `true` if the document has been closed. A closed document isn't synchronized anymore
		 * and won't be re-used when the same resource is opened again.
		 */
		readonly isClosed: boolean;

		/**
		 * Save the underlying file.
		 *
		 * @return A promise that will resolve to true when the file
		 * has been saved. If the file was not dirty or the save failed,
		 * will return false.
		 */
		save(): Thenable<boolean>;

		/**
		 * The [end of line](#EndOfLine) sequence that is predominately
		 * used in this document.
		 */
		readonly eol: EndOfLine;

		/**
		 * The number of lines in this document.
		 */
		readonly lineCount: number;

		/**
		 * Returns a text line denoted by the line number. Note
		 * that the returned object is *not* live and changes to the
		 * document are not reflected.
		 *
		 * @param line A line number in [0, lineCount).
		 * @return A [line](#TextLine).
		 */
		lineAt(line: number): TextLine;

		/**
		 * Returns a text line denoted by the position. Note
		 * that the returned object is *not* live and changes to the
		 * document are not reflected.
		 *
		 * The position will be [adjusted](#TextDocument.validatePosition).
		 *
		 * @see [TextDocument.lineAt](#TextDocument.lineAt)
		 * @param position A position.
		 * @return A [line](#TextLine).
		 */
		lineAt(position: Position): TextLine;

		/**
		 * Converts the position to a zero-based offset.
		 *
		 * The position will be [adjusted](#TextDocument.validatePosition).
		 *
		 * @param position A position.
		 * @return A valid zero-based offset.
		 */
		offsetAt(position: Position): number;

		/**
		 * Converts a zero-based offset to a position.
		 *
		 * @param offset A zero-based offset.
		 * @return A valid [position](#Position).
		 */
		positionAt(offset: number): Position;

		/**
		 * Get the text of this document. A substring can be retrieved by providing
		 * a range. The range will be [adjusted](#TextDocument.validateRange).
		 *
		 * @param range Include only the text included by the range.
		 * @return The text inside the provided range or the entire text.
		 */
		getText(range?: Range): string;

		/**
		 * Get a word-range at the given position. By default words are defined by
		 * common separators, like space, -, _, etc. In addition, per language custom
		 * [word definitions](#LanguageConfiguration.wordPattern) can be defined. It
		 * is also possible to provide a custom regular expression.
		 *
		 * * *Note 1:* A custom regular expression must not match the empty string and
		 * if it does, it will be ignored.
		 * * *Note 2:* A custom regular expression will fail to match multiline strings
		 * and in the name of speed regular expressions should not match words with
		 * spaces. Use [`TextLine.text`](#TextLine.text) for more complex, non-wordy, scenarios.
		 *
		 * The position will be [adjusted](#TextDocument.validatePosition).
		 *
		 * @param position A position.
		 * @param regex Optional regular expression that describes what a word is.
		 * @return A range spanning a word, or `undefined`.
		 */
		getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined;

		/**
		 * Ensure a range is completely contained in this document.
		 *
		 * @param range A range.
		 * @return The given range or a new, adjusted range.
		 */
		validateRange(range: Range): Range;

		/**
		 * Ensure a position is contained in the range of this document.
		 *
		 * @param position A position.
		 * @return The given position or a new, adjusted position.
		 */
		validatePosition(position: Position): Position;
	}

	/**
	 * Represents a line and character position, such as
	 * the position of the cursor.
	 *
	 * Position objects are __immutable__. Use the [with](#Position.with) or
	 * [translate](#Position.translate) methods to derive new positions
	 * from an existing position.
	 */
	export class Position {

		/**
		 * The zero-based line value.
		 */
		readonly line: number;

		/**
		 * The zero-based character value.
		 */
		readonly character: number;

		/**
		 * @param line A zero-based line value.
		 * @param character A zero-based character value.
		 */
		constructor(line: number, character: number);

		/**
		 * Check if this position is before `other`.
		 *
		 * @param other A position.
		 * @return `true` if position is on a smaller line
		 * or on the same line on a smaller character.
		 */
		isBefore(other: Position): boolean;

		/**
		 * Check if this position is before or equal to `other`.
		 *
		 * @param other A position.
		 * @return `true` if position is on a smaller line
		 * or on the same line on a smaller or equal character.
		 */
		isBeforeOrEqual(other: Position): boolean;

		/**
		 * Check if this position is after `other`.
		 *
		 * @param other A position.
		 * @return `true` if position is on a greater line
		 * or on the same line on a greater character.
		 */
		isAfter(other: Position): boolean;

		/**
		 * Check if this position is after or equal to `other`.
		 *
		 * @param other A position.
		 * @return `true` if position is on a greater line
		 * or on the same line on a greater or equal character.
		 */
		isAfterOrEqual(other: Position): boolean;

		/**
		 * Check if this position is equal to `other`.
		 *
		 * @param other A position.
		 * @return `true` if the line and character of the given position are equal to
		 * the line and character of this position.
		 */
		isEqual(other: Position): boolean;

		/**
		 * Compare this to `other`.
		 *
		 * @param other A position.
		 * @return A number smaller than zero if this position is before the given position,
		 * a number greater than zero if this position is after the given position, or zero when
		 * this and the given position are equal.
		 */
		compareTo(other: Position): number;

		/**
		 * Create a new position relative to this position.
		 *
		 * @param lineDelta Delta value for the line value, default is `0`.
		 * @param characterDelta Delta value for the character value, default is `0`.
		 * @return A position which line and character is the sum of the current line and
		 * character and the corresponding deltas.
		 */
		translate(lineDelta?: number, characterDelta?: number): Position;

		/**
		 * Derived a new position relative to this position.
		 *
		 * @param change An object that describes a delta to this position.
		 * @return A position that reflects the given delta. Will return `this` position if the change
		 * is not changing anything.
		 */
		translate(change: { lineDelta?: number; characterDelta?: number; }): Position;

		/**
		 * Create a new position derived from this position.
		 *
		 * @param line Value that should be used as line value, default is the [existing value](#Position.line)
		 * @param character Value that should be used as character value, default is the [existing value](#Position.character)
		 * @return A position where line and character are replaced by the given values.
		 */
		with(line?: number, character?: number): Position;

		/**
		 * Derived a new position from this position.
		 *
		 * @param change An object that describes a change to this position.
		 * @return A position that reflects the given change. Will return `this` position if the change
		 * is not changing anything.
		 */
		with(change: { line?: number; character?: number; }): Position;
	}

	/**
	 * A range represents an ordered pair of two positions.
	 * It is guaranteed that [start](#Range.start).isBeforeOrEqual([end](#Range.end))
	 *
	 * Range objects are __immutable__. Use the [with](#Range.with),
	 * [intersection](#Range.intersection), or [union](#Range.union) methods
	 * to derive new ranges from an existing range.
	 */
	export class Range {

		/**
		 * The start position. It is before or equal to [end](#Range.end).
		 */
		readonly start: Position;

		/**
		 * The end position. It is after or equal to [start](#Range.start).
		 */
		readonly end: Position;

		/**
		 * Create a new range from two positions. If `start` is not
		 * before or equal to `end`, the values will be swapped.
		 *
		 * @param start A position.
		 * @param end A position.
		 */
		constructor(start: Position, end: Position);

		/**
		 * Create a new range from number coordinates. It is a shorter equivalent of
		 * using `new Range(new Position(startLine, startCharacter), new Position(endLine, endCharacter))`
		 *
		 * @param startLine A zero-based line value.
		 * @param startCharacter A zero-based character value.
		 * @param endLine A zero-based line value.
		 * @param endCharacter A zero-based character value.
		 */
		constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);

		/**
		 * `true` if `start` and `end` are equal.
		 */
		isEmpty: boolean;

		/**
		 * `true` if `start.line` and `end.line` are equal.
		 */
		isSingleLine: boolean;

		/**
		 * Check if a position or a range is contained in this range.
		 *
		 * @param positionOrRange A position or a range.
		 * @return `true` if the position or range is inside or equal
		 * to this range.
		 */
		contains(positionOrRange: Position | Range): boolean;

		/**
		 * Check if `other` equals this range.
		 *
		 * @param other A range.
		 * @return `true` when start and end are [equal](#Position.isEqual) to
		 * start and end of this range.
		 */
		isEqual(other: Range): boolean;

		/**
		 * Intersect `range` with this range and returns a new range or `undefined`
		 * if the ranges have no overlap.
		 *
		 * @param range A range.
		 * @return A range of the greater start and smaller end positions. Will
		 * return undefined when there is no overlap.
		 */
		intersection(range: Range): Range | undefined;

		/**
		 * Compute the union of `other` with this range.
		 *
		 * @param other A range.
		 * @return A range of smaller start position and the greater end position.
		 */
		union(other: Range): Range;

		/**
		 * Derived a new range from this range.
		 *
		 * @param start A position that should be used as start. The default value is the [current start](#Range.start).
		 * @param end A position that should be used as end. The default value is the [current end](#Range.end).
		 * @return A range derived from this range with the given start and end position.
		 * If start and end are not different `this` range will be returned.
		 */
		with(start?: Position, end?: Position): Range;

		/**
		 * Derived a new range from this range.
		 *
		 * @param change An object that describes a change to this range.
		 * @return A range that reflects the given change. Will return `this` range if the change
		 * is not changing anything.
		 */
		with(change: { start?: Position, end?: Position }): Range;
	}

	/**
	 * Represents a text selection in an editor.
	 */
	export class Selection extends Range {

		/**
		 * The position at which the selection starts.
		 * This position might be before or after [active](#Selection.active).
		 */
		anchor: Position;

		/**
		 * The position of the cursor.
		 * This position might be before or after [anchor](#Selection.anchor).
		 */
		active: Position;

		/**
		 * Create a selection from two positions.
		 *
		 * @param anchor A position.
		 * @param active A position.
		 */
		constructor(anchor: Position, active: Position);

		/**
		 * Create a selection from four coordinates.
		 *
		 * @param anchorLine A zero-based line value.
		 * @param anchorCharacter A zero-based character value.
		 * @param activeLine A zero-based line value.
		 * @param activeCharacter A zero-based character value.
		 */
		constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number);

		/**
		 * A selection is reversed if [active](#Selection.active).isBefore([anchor](#Selection.anchor)).
		 */
		isReversed: boolean;
	}

	/**
	 * Represents sources that can cause [selection change events](#window.onDidChangeTextEditorSelection).
	*/
	export enum TextEditorSelectionChangeKind {
		/**
		 * Selection changed due to typing in the editor.
		 */
		Keyboard = 1,
		/**
		 * Selection change due to clicking in the editor.
		 */
		Mouse = 2,
		/**
		 * Selection changed because a command ran.
		 */
		Command = 3
	}

	/**
	 * Represents an event describing the change in a [text editor's selections](#TextEditor.selections).
	 */
	export interface TextEditorSelectionChangeEvent {
		/**
		 * The [text editor](#TextEditor) for which the selections have changed.
		 */
		readonly textEditor: TextEditor;
		/**
		 * The new value for the [text editor's selections](#TextEditor.selections).
		 */
		readonly selections: ReadonlyArray<Selection>;
		/**
		 * The [change kind](#TextEditorSelectionChangeKind) which has triggered this
		 * event. Can be `undefined`.
		 */
		readonly kind?: TextEditorSelectionChangeKind;
	}

	/**
	 * Represents an event describing the change in a [text editor's visible ranges](#TextEditor.visibleRanges).
	 */
	export interface TextEditorVisibleRangesChangeEvent {
		/**
		 * The [text editor](#TextEditor) for which the visible ranges have changed.
		 */
		readonly textEditor: TextEditor;
		/**
		 * The new value for the [text editor's visible ranges](#TextEditor.visibleRanges).
		 */
		readonly visibleRanges: ReadonlyArray<Range>;
	}

	/**
	 * Represents an event describing the change in a [text editor's options](#TextEditor.options).
	 */
	export interface TextEditorOptionsChangeEvent {
		/**
		 * The [text editor](#TextEditor) for which the options have changed.
		 */
		readonly textEditor: TextEditor;
		/**
		 * The new value for the [text editor's options](#TextEditor.options).
		 */
		readonly options: TextEditorOptions;
	}

	/**
	 * Represents an event describing the change of a [text editor's view column](#TextEditor.viewColumn).
	 */
	export interface TextEditorViewColumnChangeEvent {
		/**
		 * The [text editor](#TextEditor) for which the view column has changed.
		 */
		readonly textEditor: TextEditor;
		/**
		 * The new value for the [text editor's view column](#TextEditor.viewColumn).
		 */
		readonly viewColumn: ViewColumn;
	}

	/**
	 * Rendering style of the cursor.
	 */
	export enum TextEditorCursorStyle {
		/**
		 * Render the cursor as a vertical thick line.
		 */
		Line = 1,
		/**
		 * Render the cursor as a block filled.
		 */
		Block = 2,
		/**
		 * Render the cursor as a thick horizontal line.
		 */
		Underline = 3,
		/**
		 * Render the cursor as a vertical thin line.
		 */
		LineThin = 4,
		/**
		 * Render the cursor as a block outlined.
		 */
		BlockOutline = 5,
		/**
		 * Render the cursor as a thin horizontal line.
		 */
		UnderlineThin = 6
	}

	/**
	 * Rendering style of the line numbers.
	 */
	export enum TextEditorLineNumbersStyle {
		/**
		 * Do not render the line numbers.
		 */
		Off = 0,
		/**
		 * Render the line numbers.
		 */
		On = 1,
		/**
		 * Render the line numbers with values relative to the primary cursor location.
		 */
		Relative = 2
	}

	/**
	 * Represents a [text editor](#TextEditor)'s [options](#TextEditor.options).
	 */
	export interface TextEditorOptions {

		/**
		 * The size in spaces a tab takes. This is used for two purposes:
		 *  - the rendering width of a tab character;
		 *  - the number of spaces to insert when [insertSpaces](#TextEditorOptions.insertSpaces) is true.
		 *
		 * When getting a text editor's options, this property will always be a number (resolved).
		 * When setting a text editor's options, this property is optional and it can be a number or `"auto"`.
		 */
		tabSize?: number | string;

		/**
		 * When pressing Tab insert [n](#TextEditorOptions.tabSize) spaces.
		 * When getting a text editor's options, this property will always be a boolean (resolved).
		 * When setting a text editor's options, this property is optional and it can be a boolean or `"auto"`.
		 */
		insertSpaces?: boolean | string;

		/**
		 * The rendering style of the cursor in this editor.
		 * When getting a text editor's options, this property will always be present.
		 * When setting a text editor's options, this property is optional.
		 */
		cursorStyle?: TextEditorCursorStyle;

		/**
		 * Render relative line numbers w.r.t. the current line number.
		 * When getting a text editor's options, this property will always be present.
		 * When setting a text editor's options, this property is optional.
		 */
		lineNumbers?: TextEditorLineNumbersStyle;
	}

	/**
	 * Represents a handle to a set of decorations
	 * sharing the same [styling options](#DecorationRenderOptions) in a [text editor](#TextEditor).
	 *
	 * To get an instance of a `TextEditorDecorationType` use
	 * [createTextEditorDecorationType](#window.createTextEditorDecorationType).
	 */
	export interface TextEditorDecorationType {

		/**
		 * Internal representation of the handle.
		 */
		readonly key: string;

		/**
		 * Remove this decoration type and all decorations on all text editors using it.
		 */
		dispose(): void;
	}

	/**
	 * Represents different [reveal](#TextEditor.revealRange) strategies in a text editor.
	 */
	export enum TextEditorRevealType {
		/**
		 * The range will be revealed with as little scrolling as possible.
		 */
		Default = 0,
		/**
		 * The range will always be revealed in the center of the viewport.
		 */
		InCenter = 1,
		/**
		 * If the range is outside the viewport, it will be revealed in the center of the viewport.
		 * Otherwise, it will be revealed with as little scrolling as possible.
		 */
		InCenterIfOutsideViewport = 2,
		/**
		 * The range will always be revealed at the top of the viewport.
		 */
		AtTop = 3
	}

	/**
	 * Represents different positions for rendering a decoration in an [overview ruler](#DecorationRenderOptions.overviewRulerLane).
	 * The overview ruler supports three lanes.
	 */
	export enum OverviewRulerLane {
		Left = 1,
		Center = 2,
		Right = 4,
		Full = 7
	}

	/**
	 * Describes the behavior of decorations when typing/editing at their edges.
	 */
	export enum DecorationRangeBehavior {
		/**
		 * The decoration's range will widen when edits occur at the start or end.
		 */
		OpenOpen = 0,
		/**
		 * The decoration's range will not widen when edits occur at the start of end.
		 */
		ClosedClosed = 1,
		/**
		 * The decoration's range will widen when edits occur at the start, but not at the end.
		 */
		OpenClosed = 2,
		/**
		 * The decoration's range will widen when edits occur at the end, but not at the start.
		 */
		ClosedOpen = 3
	}

	/**
	 * Represents options to configure the behavior of showing a [document](#TextDocument) in an [editor](#TextEditor).
	 */
	export interface TextDocumentShowOptions {
		/**
		 * An optional view column in which the [editor](#TextEditor) should be shown.
		 * The default is the [active](#ViewColumn.Active), other values are adjusted to
		 * be `Min(column, columnCount + 1)`, the [active](#ViewColumn.Active)-column is
		 * not adjusted. Use [`ViewColumn.Beside`](#ViewColumn.Beside) to open the
		 * editor to the side of the currently active one.
		 */
		viewColumn?: ViewColumn;

		/**
		 * An optional flag that when `true` will stop the [editor](#TextEditor) from taking focus.
		 */
		preserveFocus?: boolean;

		/**
		 * An optional flag that controls if an [editor](#TextEditor)-tab will be replaced
		 * with the next editor or if it will be kept.
		 */
		preview?: boolean;

		/**
		 * An optional selection to apply for the document in the [editor](#TextEditor).
		 */
		selection?: Range;
	}

	/**
	 * A reference to one of the workbench colors as defined in https://code.visualstudio.com/docs/getstarted/theme-color-reference.
	 * Using a theme color is preferred over a custom color as it gives theme authors and users the possibility to change the color.
	 */
	export class ThemeColor {

		/**
		 * Creates a reference to a theme color.
		 * @param id of the color. The available colors are listed in https://code.visualstudio.com/docs/getstarted/theme-color-reference.
		 */
		constructor(id: string);
	}

	/**
	 * A reference to a named icon. Currently, [File](#ThemeIcon.File), [Folder](#ThemeIcon.Folder),
	 * and [ThemeIcon ids](https://code.visualstudio.com/api/references/icons-in-labels#icon-listing) are supported.
	 * Using a theme icon is preferred over a custom icon as it gives product theme authors the possibility to change the icons.
	 *
	 * *Note* that theme icons can also be rendered inside labels and descriptions. Places that support theme icons spell this out
	 * and they use the `$(<name>)`-syntax, for instance `quickPick.label = "Hello World $(globe)"`.
	 */
	export class ThemeIcon {
		/**
		 * Reference to an icon representing a file. The icon is taken from the current file icon theme or a placeholder icon is used.
		 */
		static readonly File: ThemeIcon;

		/**
		 * Reference to an icon representing a folder. The icon is taken from the current file icon theme or a placeholder icon is used.
		 */
		static readonly Folder: ThemeIcon;

		/**
		 * The id of the icon. The available icons are listed in https://code.visualstudio.com/api/references/icons-in-labels#icon-listing.
		 */
		readonly id: string;

		/**
		 * The optional ThemeColor of the icon. The color is currently only used in [TreeItem](#TreeItem).
		 */
		readonly color?: ThemeColor;

		/**
		 * Creates a reference to a theme icon.
		 * @param id id of the icon. The available icons are listed in https://code.visualstudio.com/api/references/icons-in-labels#icon-listing.
		 * @param color optional `ThemeColor` for the icon. The color is currently only used in [TreeItem](#TreeItem).
		 */
		constructor(id: string, color?: ThemeColor);
	}

	/**
	 * Represents theme specific rendering styles for a [text editor decoration](#TextEditorDecorationType).
	 */
	export interface ThemableDecorationRenderOptions {
		/**
		 * Background color of the decoration. Use rgba() and define transparent background colors to play well with other decorations.
		 * Alternatively a color from the color registry can be [referenced](#ThemeColor).
		 */
		backgroundColor?: string | ThemeColor;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		outline?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'outline' for setting one or more of the individual outline properties.
		 */
		outlineColor?: string | ThemeColor;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'outline' for setting one or more of the individual outline properties.
		 */
		outlineStyle?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'outline' for setting one or more of the individual outline properties.
		 */
		outlineWidth?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		border?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'border' for setting one or more of the individual border properties.
		 */
		borderColor?: string | ThemeColor;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'border' for setting one or more of the individual border properties.
		 */
		borderRadius?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'border' for setting one or more of the individual border properties.
		 */
		borderSpacing?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'border' for setting one or more of the individual border properties.
		 */
		borderStyle?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 * Better use 'border' for setting one or more of the individual border properties.
		 */
		borderWidth?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		fontStyle?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		fontWeight?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		textDecoration?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		cursor?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		color?: string | ThemeColor;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		opacity?: string;

		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		letterSpacing?: string;

		/**
		 * An **absolute path** or an URI to an image to be rendered in the gutter.
		 */
		gutterIconPath?: string | Uri;

		/**
		 * Specifies the size of the gutter icon.
		 * Available values are 'auto', 'contain', 'cover' and any percentage value.
		 * For further information: https://msdn.microsoft.com/en-us/library/jj127316(v=vs.85).aspx
		 */
		gutterIconSize?: string;

		/**
		 * The color of the decoration in the overview ruler. Use rgba() and define transparent colors to play well with other decorations.
		 */
		overviewRulerColor?: string | ThemeColor;

		/**
		 * Defines the rendering options of the attachment that is inserted before the decorated text.
		 */
		before?: ThemableDecorationAttachmentRenderOptions;

		/**
		 * Defines the rendering options of the attachment that is inserted after the decorated text.
		 */
		after?: ThemableDecorationAttachmentRenderOptions;
	}

	export interface ThemableDecorationAttachmentRenderOptions {
		/**
		 * Defines a text content that is shown in the attachment. Either an icon or a text can be shown, but not both.
		 */
		contentText?: string;
		/**
		 * An **absolute path** or an URI to an image to be rendered in the attachment. Either an icon
		 * or a text can be shown, but not both.
		 */
		contentIconPath?: string | Uri;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		border?: string;
		/**
		 * CSS styling property that will be applied to text enclosed by a decoration.
		 */
		borderColor?: string | ThemeColor;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		fontStyle?: string;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		fontWeight?: string;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		textDecoration?: string;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		color?: string | ThemeColor;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		backgroundColor?: string | ThemeColor;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		margin?: string;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		width?: string;
		/**
		 * CSS styling property that will be applied to the decoration attachment.
		 */
		height?: string;
	}

	/**
	 * Represents rendering styles for a [text editor decoration](#TextEditorDecorationType).
	 */
	export interface DecorationRenderOptions extends ThemableDecorationRenderOptions {
		/**
		 * Should the decoration be rendered also on the whitespace after the line text.
		 * Defaults to `false`.
		 */
		isWholeLine?: boolean;

		/**
		 * Customize the growing behavior of the decoration when edits occur at the edges of the decoration's range.
		 * Defaults to `DecorationRangeBehavior.OpenOpen`.
		 */
		rangeBehavior?: DecorationRangeBehavior;

		/**
		 * The position in the overview ruler where the decoration should be rendered.
		 */
		overviewRulerLane?: OverviewRulerLane;

		/**
		 * Overwrite options for light themes.
		 */
		light?: ThemableDecorationRenderOptions;

		/**
		 * Overwrite options for dark themes.
		 */
		dark?: ThemableDecorationRenderOptions;
	}

	/**
	 * Represents options for a specific decoration in a [decoration set](#TextEditorDecorationType).
	 */
	export interface DecorationOptions {

		/**
		 * Range to which this decoration is applied. The range must not be empty.
		 */
		range: Range;

		/**
		 * A message that should be rendered when hovering over the decoration.
		 */
		hoverMessage?: MarkedString | MarkedString[];

		/**
		 * Render options applied to the current decoration. For performance reasons, keep the
		 * number of decoration specific options small, and use decoration types wherever possible.
		 */
		renderOptions?: DecorationInstanceRenderOptions;
	}

	export interface ThemableDecorationInstanceRenderOptions {
		/**
		 * Defines the rendering options of the attachment that is inserted before the decorated text.
		 */
		before?: ThemableDecorationAttachmentRenderOptions;

		/**
		 * Defines the rendering options of the attachment that is inserted after the decorated text.
		 */
		after?: ThemableDecorationAttachmentRenderOptions;
	}

	export interface DecorationInstanceRenderOptions extends ThemableDecorationInstanceRenderOptions {
		/**
		 * Overwrite options for light themes.
		 */
		light?: ThemableDecorationInstanceRenderOptions;

		/**
		 * Overwrite options for dark themes.
		 */
		dark?: ThemableDecorationInstanceRenderOptions;
	}

	/**
	 * Represents an editor that is attached to a [document](#TextDocument).
	 */
	export interface TextEditor {

		/**
		 * The document associated with this text editor. The document will be the same for the entire lifetime of this text editor.
		 */
		readonly document: TextDocument;

		/**
		 * The primary selection on this text editor. Shorthand for `TextEditor.selections[0]`.
		 */
		selection: Selection;

		/**
		 * The selections in this text editor. The primary selection is always at index 0.
		 */
		selections: Selection[];

		/**
		 * The current visible ranges in the editor (vertically).
		 * This accounts only for vertical scrolling, and not for horizontal scrolling.
		 */
		readonly visibleRanges: Range[];

		/**
		 * Text editor options.
		 */
		options: TextEditorOptions;

		/**
		 * The column in which this editor shows. Will be `undefined` in case this
		 * isn't one of the main editors, e.g. an embedded editor, or when the editor
		 * column is larger than three.
		 */
		readonly viewColumn?: ViewColumn;

		/**
		 * Perform an edit on the document associated with this text editor.
		 *
		 * The given callback-function is invoked with an [edit-builder](#TextEditorEdit) which must
		 * be used to make edits. Note that the edit-builder is only valid while the
		 * callback executes.
		 *
		 * @param callback A function which can create edits using an [edit-builder](#TextEditorEdit).
		 * @param options The undo/redo behavior around this edit. By default, undo stops will be created before and after this edit.
		 * @return A promise that resolves with a value indicating if the edits could be applied.
		 */
		edit(callback: (editBuilder: TextEditorEdit) => void, options?: { undoStopBefore: boolean; undoStopAfter: boolean; }): Thenable<boolean>;

		/**
		 * Insert a [snippet](#SnippetString) and put the editor into snippet mode. "Snippet mode"
		 * means the editor adds placeholders and additional cursors so that the user can complete
		 * or accept the snippet.
		 *
		 * @param snippet The snippet to insert in this edit.
		 * @param location Position or range at which to insert the snippet, defaults to the current editor selection or selections.
		 * @param options The undo/redo behavior around this edit. By default, undo stops will be created before and after this edit.
		 * @return A promise that resolves with a value indicating if the snippet could be inserted. Note that the promise does not signal
		 * that the snippet is completely filled-in or accepted.
		 */
		insertSnippet(snippet: SnippetString, location?: Position | Range | ReadonlyArray<Position> | ReadonlyArray<Range>, options?: { undoStopBefore: boolean; undoStopAfter: boolean; }): Thenable<boolean>;

		/**
		 * Adds a set of decorations to the text editor. If a set of decorations already exists with
		 * the given [decoration type](#TextEditorDecorationType), they will be replaced.
		 *
		 * @see [createTextEditorDecorationType](#window.createTextEditorDecorationType).
		 *
		 * @param decorationType A decoration type.
		 * @param rangesOrOptions Either [ranges](#Range) or more detailed [options](#DecorationOptions).
		 */
		setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: Range[] | DecorationOptions[]): void;

		/**
		 * Scroll as indicated by `revealType` in order to reveal the given range.
		 *
		 * @param range A range.
		 * @param revealType The scrolling strategy for revealing `range`.
		 */
		revealRange(range: Range, revealType?: TextEditorRevealType): void;

		/**
		 * Show the text editor.
		 *
		 * @deprecated Use [window.showTextDocument](#window.showTextDocument) instead.
		 *
		 * @param column The [column](#ViewColumn) in which to show this editor.
		 * This method shows unexpected behavior and will be removed in the next major update.
		 */
		show(column?: ViewColumn): void;

		/**
		 * Hide the text editor.
		 *
		 * @deprecated Use the command `workbench.action.closeActiveEditor` instead.
		 * This method shows unexpected behavior and will be removed in the next major update.
		 */
		hide(): void;
	}

	/**
	 * Represents an end of line character sequence in a [document](#TextDocument).
	 */
	export enum EndOfLine {
		/**
		 * The line feed `\n` character.
		 */
		LF = 1,
		/**
		 * The carriage return line feed `\r\n` sequence.
		 */
		CRLF = 2
	}

	/**
	 * A complex edit that will be applied in one transaction on a TextEditor.
	 * This holds a description of the edits and if the edits are valid (i.e. no overlapping regions, document was not changed in the meantime, etc.)
	 * they can be applied on a [document](#TextDocument) associated with a [text editor](#TextEditor).
	 */
	export interface TextEditorEdit {
		/**
		 * Replace a certain text region with a new value.
		 * You can use \r\n or \n in `value` and they will be normalized to the current [document](#TextDocument).
		 *
		 * @param location The range this operation should remove.
		 * @param value The new text this operation should insert after removing `location`.
		 */
		replace(location: Position | Range | Selection, value: string): void;

		/**
		 * Insert text at a location.
		 * You can use \r\n or \n in `value` and they will be normalized to the current [document](#TextDocument).
		 * Although the equivalent text edit can be made with [replace](#TextEditorEdit.replace), `insert` will produce a different resulting selection (it will get moved).
		 *
		 * @param location The position where the new text should be inserted.
		 * @param value The new text this operation should insert.
		 */
		insert(location: Position, value: string): void;

		/**
		 * Delete a certain text region.
		 *
		 * @param location The range this operation should remove.
		 */
		delete(location: Range | Selection): void;

		/**
		 * Set the end of line sequence.
		 *
		 * @param endOfLine The new end of line for the [document](#TextDocument).
		 */
		setEndOfLine(endOfLine: EndOfLine): void;
	}

	/**
	 * A universal resource identifier representing either a file on disk
	 * or another resource, like untitled resources.
	 */
	export class Uri {

		/**
		 * Create an URI from a string, e.g. `http://www.msft.com/some/path`,
		 * `file:///usr/home`, or `scheme:with/path`.
		 *
		 * *Note* that for a while uris without a `scheme` were accepted. That is not correct
		 * as all uris should have a scheme. To avoid breakage of existing code the optional
		 * `strict`-argument has been added. We *strongly* advise to use it, e.g. `Uri.parse('my:uri', true)`
		 *
		 * @see [Uri.toString](#Uri.toString)
		 * @param value The string value of an Uri.
		 * @param strict Throw an error when `value` is empty or when no `scheme` can be parsed.
		 * @return A new Uri instance.
		 */
		static parse(value: string, strict?: boolean): Uri;

		/**
		 * Create an URI from a file system path. The [scheme](#Uri.scheme)
		 * will be `file`.
		 *
		 * The *difference* between `Uri#parse` and `Uri#file` is that the latter treats the argument
		 * as path, not as stringified-uri. E.g. `Uri.file(path)` is *not* the same as
		 * `Uri.parse('file://' + path)` because the path might contain characters that are
		 * interpreted (# and ?). See the following sample:
		 * ```ts
		const good = URI.file('/coding/c#/project1');
		good.scheme === 'file';
		good.path === '/coding/c#/project1';
		good.fragment === '';

		const bad = URI.parse('file://' + '/coding/c#/project1');
		bad.scheme === 'file';
		bad.path === '/coding/c'; // path is now broken
		bad.fragment === '/project1';
		```
		 *
		 * @param path A file system or UNC path.
		 * @return A new Uri instance.
		 */
		static file(path: string): Uri;

		/**
		 * Create a new uri which path is the result of joining
		 * the path of the base uri with the provided path segments.
		 *
		 * - Note 1: `joinPath` only affects the path component
		 * and all other components (scheme, authority, query, and fragment) are
		 * left as they are.
		 * - Note 2: The base uri must have a path; an error is thrown otherwise.
		 *
		 * The path segments are normalized in the following ways:
		 * - sequences of path separators (`/` or `\`) are replaced with a single separator
		 * - for `file`-uris on windows, the backslash-character (`\`) is considered a path-separator
		 * - the `..`-segment denotes the parent segment, the `.` denotes the current segment
		 * - paths have a root which always remains, for instance on windows drive-letters are roots
		 * so that is true: `joinPath(Uri.file('file:///c:/root'), '../../other').fsPath === 'c:/other'`
		 *
		 * @param base An uri. Must have a path.
		 * @param pathSegments One more more path fragments
		 * @returns A new uri which path is joined with the given fragments
		 */
		static joinPath(base: Uri, ...pathSegments: string[]): Uri;

		/**
		 * Use the `file` and `parse` factory functions to create new `Uri` objects.
		 */
		private constructor(scheme: string, authority: string, path: string, query: string, fragment: string);

		/**
		 * Scheme is the `http` part of `http://www.msft.com/some/path?query#fragment`.
		 * The part before the first colon.
		 */
		readonly scheme: string;

		/**
		 * Authority is the `www.msft.com` part of `http://www.msft.com/some/path?query#fragment`.
		 * The part between the first double slashes and the next slash.
		 */
		readonly authority: string;

		/**
		 * Path is the `/some/path` part of `http://www.msft.com/some/path?query#fragment`.
		 */
		readonly path: string;

		/**
		 * Query is the `query` part of `http://www.msft.com/some/path?query#fragment`.
		 */
		readonly query: string;

		/**
		 * Fragment is the `fragment` part of `http://www.msft.com/some/path?query#fragment`.
		 */
		readonly fragment: string;

		/**
		 * The string representing the corresponding file system path of this Uri.
		 *
		 * Will handle UNC paths and normalize windows drive letters to lower-case. Also
		 * uses the platform specific path separator.
		 *
		 * * Will *not* validate the path for invalid characters and semantics.
		 * * Will *not* look at the scheme of this Uri.
		 * * The resulting string shall *not* be used for display purposes but
		 * for disk operations, like `readFile` et al.
		 *
		 * The *difference* to the [`path`](#Uri.path)-property is the use of the platform specific
		 * path separator and the handling of UNC paths. The sample below outlines the difference:
		 * ```ts
		const u = URI.parse('file://server/c$/folder/file.txt')
		u.authority === 'server'
		u.path === '/shares/c$/file.txt'
		u.fsPath === '\\server\c$\folder\file.txt'
		```
		 */
		readonly fsPath: string;

		/**
		 * Derive a new Uri from this Uri.
		 *
		 * ```ts
		 * let file = Uri.parse('before:some/file/path');
		 * let other = file.with({ scheme: 'after' });
		 * assert.ok(other.toString() === 'after:some/file/path');
		 * ```
		 *
		 * @param change An object that describes a change to this Uri. To unset components use `null` or
		 *  the empty string.
		 * @return A new Uri that reflects the given change. Will return `this` Uri if the change
		 *  is not changing anything.
		 */
		with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri;

		/**
		 * Returns a string representation of this Uri. The representation and normalization
		 * of a URI depends on the scheme.
		 *
		 * * The resulting string can be safely used with [Uri.parse](#Uri.parse).
		 * * The resulting string shall *not* be used for display purposes.
		 *
		 * *Note* that the implementation will encode _aggressive_ which often leads to unexpected,
		 * but not incorrect, results. For instance, colons are encoded to `%3A` which might be unexpected
		 * in file-uri. Also `&` and `=` will be encoded which might be unexpected for http-uris. For stability
		 * reasons this cannot be changed anymore. If you suffer from too aggressive encoding you should use
		 * the `skipEncoding`-argument: `uri.toString(true)`.
		 *
		 * @param skipEncoding Do not percentage-encode the result, defaults to `false`. Note that
		 *	the `#` and `?` characters occurring in the path will always be encoded.
		 * @returns A string representation of this Uri.
		 */
		toString(skipEncoding?: boolean): string;

		/**
		 * Returns a JSON representation of this Uri.
		 *
		 * @return An object.
		 */
		toJSON(): any;
	}

	/**
	 * A cancellation token is passed to an asynchronous or long running
	 * operation to request cancellation, like cancelling a request
	 * for completion items because the user continued to type.
	 *
	 * To get an instance of a `CancellationToken` use a
	 * [CancellationTokenSource](#CancellationTokenSource).
	 */
	export interface CancellationToken {

		/**
		 * Is `true` when the token has been cancelled, `false` otherwise.
		 */
		isCancellationRequested: boolean;

		/**
		 * An [event](#Event) which fires upon cancellation.
		 */
		onCancellationRequested: Event<any>;
	}

	/**
	 * A cancellation source creates and controls a [cancellation token](#CancellationToken).
	 */
	export class CancellationTokenSource {

		/**
		 * The cancellation token of this source.
		 */
		token: CancellationToken;

		/**
		 * Signal cancellation on the token.
		 */
		cancel(): void;

		/**
		 * Dispose object and free resources.
		 */
		dispose(): void;
	}

	/**
	 * Represents a type which can release resources, such
	 * as event listening or a timer.
	 */
	export class Disposable {

		/**
		 * Combine many disposable-likes into one. Use this method
		 * when having objects with a dispose function which are not
		 * instances of Disposable.
		 *
		 * @param disposableLikes Objects that have at least a `dispose`-function member.
		 * @return Returns a new disposable which, upon dispose, will
		 * dispose all provided disposables.
		 */
		static from(...disposableLikes: { dispose: () => any }[]): Disposable;

		/**
		 * Creates a new Disposable calling the provided function
		 * on dispose.
		 * @param callOnDispose Function that disposes something.
		 */
		constructor(callOnDispose: Function);

		/**
		 * Dispose this object.
		 */
		dispose(): any;
	}

	/**
	 * Represents a typed event.
	 *
	 * A function that represents an event to which you subscribe by calling it with
	 * a listener function as argument.
	 *
	 * @example
	 * item.onDidChange(function(event) { console.log("Event happened: " + event); });
	 */
	export interface Event<T> {

		/**
		 * A function that represents an event to which you subscribe by calling it with
		 * a listener function as argument.
		 *
		 * @param listener The listener function will be called when the event happens.
		 * @param thisArgs The `this`-argument which will be used when calling the event listener.
		 * @param disposables An array to which a [disposable](#Disposable) will be added.
		 * @return A disposable which unsubscribes the event listener.
		 */
		(listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
	}

	/**
	 * An event emitter can be used to create and manage an [event](#Event) for others
	 * to subscribe to. One emitter always owns one event.
	 *
	 * Use this class if you want to provide event from within your extension, for instance
	 * inside a [TextDocumentContentProvider](#TextDocumentContentProvider) or when providing
	 * API to other extensions.
	 */
	export class EventEmitter<T> {

		/**
		 * The event listeners can subscribe to.
		 */
		event: Event<T>;

		/**
		 * Notify all subscribers of the [event](#EventEmitter.event). Failure
		 * of one or more listener will not fail this function call.
		 *
		 * @param data The event object.
		 */
		fire(data: T): void;

		/**
		 * Dispose this object and free resources.
		 */
		dispose(): void;
	}

	/**
	 * A file system watcher notifies about changes to files and folders
	 * on disk or from other [FileSystemProviders](#FileSystemProvider).
	 *
	 * To get an instance of a `FileSystemWatcher` use
	 * [createFileSystemWatcher](#workspace.createFileSystemWatcher).
	 */
	export interface FileSystemWatcher extends Disposable {

		/**
		 * true if this file system watcher has been created such that
		 * it ignores creation file system events.
		 */
		ignoreCreateEvents: boolean;

		/**
		 * true if this file system watcher has been created such that
		 * it ignores change file system events.
		 */
		ignoreChangeEvents: boolean;

		/**
		 * true if this file system watcher has been created such that
		 * it ignores delete file system events.
		 */
		ignoreDeleteEvents: boolean;

		/**
		 * An event which fires on file/folder creation.
		 */
		onDidCreate: Event<Uri>;

		/**
		 * An event which fires on file/folder change.
		 */
		onDidChange: Event<Uri>;

		/**
		 * An event which fires on file/folder deletion.
		 */
		onDidDelete: Event<Uri>;
	}

	/**
	 * A text document content provider allows to add readonly documents
	 * to the editor, such as source from a dll or generated html from md.
	 *
	 * Content providers are [registered](#workspace.registerTextDocumentContentProvider)
	 * for a [uri-scheme](#Uri.scheme). When a uri with that scheme is to
	 * be [loaded](#workspace.openTextDocument) the content provider is
	 * asked.
	 */
	export interface TextDocumentContentProvider {

		/**
		 * An event to signal a resource has changed.
		 */
		onDidChange?: Event<Uri>;

		/**
		 * Provide textual content for a given uri.
		 *
		 * The editor will use the returned string-content to create a readonly
		 * [document](#TextDocument). Resources allocated should be released when
		 * the corresponding document has been [closed](#workspace.onDidCloseTextDocument).
		 *
		 * **Note**: The contents of the created [document](#TextDocument) might not be
		 * identical to the provided text due to end-of-line-sequence normalization.
		 *
		 * @param uri An uri which scheme matches the scheme this provider was [registered](#workspace.registerTextDocumentContentProvider) for.
		 * @param token A cancellation token.
		 * @return A string or a thenable that resolves to such.
		 */
		provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string>;
	}

	/**
	 * Represents an item that can be selected from
	 * a list of items.
	 */
	export interface QuickPickItem {

		/**
		 * A human-readable string which is rendered prominent. Supports rendering of [theme icons](#ThemeIcon) via
		 * the `$(<name>)`-syntax.
		 */
		label: string;

		/**
		 * A human-readable string which is rendered less prominent in the same line. Supports rendering of
		 * [theme icons](#ThemeIcon) via the `$(<name>)`-syntax.
		 */
		description?: string;

		/**
		 * A human-readable string which is rendered less prominent in a separate line. Supports rendering of
		 * [theme icons](#ThemeIcon) via the `$(<name>)`-syntax.
		 */
		detail?: string;

		/**
		 * Optional flag indicating if this item is picked initially.
		 * (Only honored when the picker allows multiple selections.)
		 *
		 * @see [QuickPickOptions.canPickMany](#QuickPickOptions.canPickMany)
		 */
		picked?: boolean;

		/**
		 * Always show this item.
		 */
		alwaysShow?: boolean;
	}

	/**
	 * Options to configure the behavior of the quick pick UI.
	 */
	export interface QuickPickOptions {
		/**
		 * An optional flag to include the description when filtering the picks.
		 */
		matchOnDescription?: boolean;

		/**
		 * An optional flag to include the detail when filtering the picks.
		 */
		matchOnDetail?: boolean;

		/**
		 * An optional string to show as placeholder in the input box to guide the user what to pick on.
		 */
		placeHolder?: string;

		/**
		 * Set to `true` to keep the picker open when focus moves to another part of the editor or to another window.
		 */
		ignoreFocusOut?: boolean;

		/**
		 * An optional flag to make the picker accept multiple selections, if true the result is an array of picks.
		 */
		canPickMany?: boolean;

		/**
		 * An optional function that is invoked whenever an item is selected.
		 */
		onDidSelectItem?(item: QuickPickItem | string): any;
	}

	/**
	 * Options to configure the behaviour of the [workspace folder](#WorkspaceFolder) pick UI.
	 */
	export interface WorkspaceFolderPickOptions {

		/**
		 * An optional string to show as placeholder in the input box to guide the user what to pick on.
		 */
		placeHolder?: string;

		/**
		 * Set to `true` to keep the picker open when focus moves to another part of the editor or to another window.
		 */
		ignoreFocusOut?: boolean;
	}

	/**
	 * Options to configure the behaviour of a file open dialog.
	 *
	 * * Note 1: A dialog can select files, folders, or both. This is not true for Windows
	 * which enforces to open either files or folder, but *not both*.
	 * * Note 2: Explicitly setting `canSelectFiles` and `canSelectFolders` to `false` is futile
	 * and the editor then silently adjusts the options to select files.
	 */
	export interface OpenDialogOptions {
		/**
		 * The resource the dialog shows when opened.
		 */
		defaultUri?: Uri;

		/**
		 * A human-readable string for the open button.
		 */
		openLabel?: string;

		/**
		 * Allow to select files, defaults to `true`.
		 */
		canSelectFiles?: boolean;

		/**
		 * Allow to select folders, defaults to `false`.
		 */
		canSelectFolders?: boolean;

		/**
		 * Allow to select many files or folders.
		 */
		canSelectMany?: boolean;

		/**
		 * A set of file filters that are used by the dialog. Each entry is a human-readable label,
		 * like "TypeScript", and an array of extensions, e.g.
		 * ```ts
		 * {
		 * 	'Images': ['png', 'jpg']
		 * 	'TypeScript': ['ts', 'tsx']
		 * }
		 * ```
		 */
		filters?: { [name: string]: string[] };

		/**
		 * Dialog title.
		 *
		 * This parameter might be ignored, as not all operating systems display a title on open dialogs
		 * (for example, macOS).
		 */
		title?: string;
	}

	/**
	 * Options to configure the behaviour of a file save dialog.
	 */
	export interface SaveDialogOptions {
		/**
		 * The resource the dialog shows when opened.
		 */
		defaultUri?: Uri;

		/**
		 * A human-readable string for the save button.
		 */
		saveLabel?: string;

		/**
		 * A set of file filters that are used by the dialog. Each entry is a human-readable label,
		 * like "TypeScript", and an array of extensions, e.g.
		 * ```ts
		 * {
		 * 	'Images': ['png', 'jpg']
		 * 	'TypeScript': ['ts', 'tsx']
		 * }
		 * ```
		 */
		filters?: { [name: string]: string[] };

		/**
		 * Dialog title.
		 *
		 * This parameter might be ignored, as not all operating systems display a title on save dialogs
		 * (for example, macOS).
		 */
		title?: string;
	}

	/**
	 * Represents an action that is shown with an information, warning, or
	 * error message.
	 *
	 * @see [showInformationMessage](#window.showInformationMessage)
	 * @see [showWarningMessage](#window.showWarningMessage)
	 * @see [showErrorMessage](#window.showErrorMessage)
	 */
	export interface MessageItem {

		/**
		 * A short title like 'Retry', 'Open Log' etc.
		 */
		title: string;

		/**
		 * A hint for modal dialogs that the item should be triggered
		 * when the user cancels the dialog (e.g. by pressing the ESC
		 * key).
		 *
		 * Note: this option is ignored for non-modal messages.
		 */
		isCloseAffordance?: boolean;
	}

	/**
	 * Options to configure the behavior of the message.
	 *
	 * @see [showInformationMessage](#window.showInformationMessage)
	 * @see [showWarningMessage](#window.showWarningMessage)
	 * @see [showErrorMessage](#window.showErrorMessage)
	 */
	export interface MessageOptions {

		/**
		 * Indicates that this message should be modal.
		 */
		modal?: boolean;
	}

	/**
	 * Options to configure the behavior of the input box UI.
	 */
	export interface InputBoxOptions {

		/**
		 * The value to prefill in the input box.
		 */
		value?: string;

		/**
		 * Selection of the prefilled [`value`](#InputBoxOptions.value). Defined as tuple of two number where the
		 * first is the inclusive start index and the second the exclusive end index. When `undefined` the whole
		 * word will be selected, when empty (start equals end) only the cursor will be set,
		 * otherwise the defined range will be selected.
		 */
		valueSelection?: [number, number];

		/**
		 * The text to display underneath the input box.
		 */
		prompt?: string;

		/**
		 * An optional string to show as placeholder in the input box to guide the user what to type.
		 */
		placeHolder?: string;

		/**
		 * Controls if a password input is shown. Password input hides the typed text.
		 */
		password?: boolean;

		/**
		 * Set to `true` to keep the input box open when focus moves to another part of the editor or to another window.
		 */
		ignoreFocusOut?: boolean;

		/**
		 * An optional function that will be called to validate input and to give a hint
		 * to the user.
		 *
		 * @param value The current value of the input box.
		 * @return A human-readable string which is presented as diagnostic message.
		 * Return `undefined`, `null`, or the empty string when 'value' is valid.
		 */
		validateInput?(value: string): string | undefined | null | Thenable<string | undefined | null>;
	}

	/**
	 * A relative pattern is a helper to construct glob patterns that are matched
	 * relatively to a base file path. The base path can either be an absolute file
	 * path as string or uri or a [workspace folder](#WorkspaceFolder), which is the
	 * preferred way of creating the relative pattern.
	 */
	export class RelativePattern {

		/**
		 * A base file path to which this pattern will be matched against relatively.
		 */
		base: string;

		/**
		 * A file glob pattern like `*.{ts,js}` that will be matched on file paths
		 * relative to the base path.
		 *
		 * Example: Given a base of `/home/work/folder` and a file path of `/home/work/folder/index.js`,
		 * the file glob pattern will match on `index.js`.
		 */
		pattern: string;

		/**
		 * Creates a new relative pattern object with a base file path and pattern to match. This pattern
		 * will be matched on file paths relative to the base.
		 *
		 * Example:
		 * ```ts
		 * const folder = vscode.workspace.workspaceFolders?.[0];
		 * if (folder) {
		 *
		 *   // Match any TypeScript file in the root of this workspace folder
		 *   const pattern1 = new vscode.RelativePattern(folder, '*.ts');
		 *
		 *   // Match any TypeScript file in `someFolder` inside this workspace folder
		 *   const pattern2 = new vscode.RelativePattern(folder, 'someFolder/*.ts');
		 * }
		 * ```
		 *
		 * @param base A base to which this pattern will be matched against relatively. It is recommended
		 * to pass in a [workspace folder](#WorkspaceFolder) if the pattern should match inside the workspace.
		 * Otherwise, a uri or string should only be used if the pattern is for a file path outside the workspace.
		 * @param pattern A file glob pattern like `*.{ts,js}` that will be matched on paths relative to the base.
		 */
		constructor(base: WorkspaceFolder | Uri | string, pattern: string)
	}

	/**
	 * A file glob pattern to match file paths against. This can either be a glob pattern string
	 * (like `**​/*.{ts,js}` or `*.{ts,js}`) or a [relative pattern](#RelativePattern).
	 *
	 * Glob patterns can have the following syntax:
	 * * `*` to match one or more characters in a path segment
	 * * `?` to match on one character in a path segment
	 * * `**` to match any number of path segments, including none
	 * * `{}` to group conditions (e.g. `**​/*.{ts,js}` matches all TypeScript and JavaScript files)
	 * * `[]` to declare a range of characters to match in a path segment (e.g., `example.[0-9]` to match on `example.0`, `example.1`, …)
	 * * `[!...]` to negate a range of characters to match in a path segment (e.g., `example.[!0-9]` to match on `example.a`, `example.b`, but not `example.0`)
	 *
	 * Note: a backslash (`\`) is not valid within a glob pattern. If you have an existing file
	 * path to match against, consider to use the [relative pattern](#RelativePattern) support
	 * that takes care of converting any backslash into slash. Otherwise, make sure to convert
	 * any backslash to slash when creating the glob pattern.
	 */
	export type GlobPattern = string | RelativePattern;

	/**
	 * A document filter denotes a document by different properties like
	 * the [language](#TextDocument.languageId), the [scheme](#Uri.scheme) of
	 * its resource, or a glob-pattern that is applied to the [path](#TextDocument.fileName).
	 *
	 * @example <caption>A language filter that applies to typescript files on disk</caption>
	 * { language: 'typescript', scheme: 'file' }
	 *
	 * @example <caption>A language filter that applies to all package.json paths</caption>
	 * { language: 'json', scheme: 'untitled', pattern: '**​/package.json' }
	 */
	export interface DocumentFilter {

		/**
		 * A language id, like `typescript`.
		 */
		readonly language?: string;

		/**
		 * A Uri [scheme](#Uri.scheme), like `file` or `untitled`.
		 */
		readonly scheme?: string;

		/**
		 * A [glob pattern](#GlobPattern) that is matched on the absolute path of the document. Use a [relative pattern](#RelativePattern)
		 * to filter documents to a [workspace folder](#WorkspaceFolder).
		 */
		readonly pattern?: GlobPattern;
	}

	/**
	 * A language selector is the combination of one or many language identifiers
	 * and [language filters](#DocumentFilter).
	 *
	 * *Note* that a document selector that is just a language identifier selects *all*
	 * documents, even those that are not saved on disk. Only use such selectors when
	 * a feature works without further context, e.g. without the need to resolve related
	 * 'files'.
	 *
	 * @example
	 * let sel:DocumentSelector = { scheme: 'file', language: 'typescript' };
	 */
	export type DocumentSelector = DocumentFilter | string | ReadonlyArray<DocumentFilter | string>;

	/**
	 * A provider result represents the values a provider, like the [`HoverProvider`](#HoverProvider),
	 * may return. For once this is the actual result type `T`, like `Hover`, or a thenable that resolves
	 * to that type `T`. In addition, `null` and `undefined` can be returned - either directly or from a
	 * thenable.
	 *
	 * The snippets below are all valid implementations of the [`HoverProvider`](#HoverProvider):
	 *
	 * ```ts
	 * let a: HoverProvider = {
	 * 	provideHover(doc, pos, token): ProviderResult<Hover> {
	 * 		return new Hover('Hello World');
	 * 	}
	 * }
	 *
	 * let b: HoverProvider = {
	 * 	provideHover(doc, pos, token): ProviderResult<Hover> {
	 * 		return new Promise(resolve => {
	 * 			resolve(new Hover('Hello World'));
	 * 	 	});
	 * 	}
	 * }
	 *
	 * let c: HoverProvider = {
	 * 	provideHover(doc, pos, token): ProviderResult<Hover> {
	 * 		return; // undefined
	 * 	}
	 * }
	 * ```
	 */
	export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

	/**
	 * Kind of a code action.
	 *
	 * Kinds are a hierarchical list of identifiers separated by `.`, e.g. `"refactor.extract.function"`.
	 *
	 * Code action kinds are used by VS Code for UI elements such as the refactoring context menu. Users
	 * can also trigger code actions with a specific kind with the `editor.action.codeAction` command.
	 */
	export class CodeActionKind {
		/**
		 * Empty kind.
		 */
		static readonly Empty: CodeActionKind;

		/**
		 * Base kind for quickfix actions: `quickfix`.
		 *
		 * Quick fix actions address a problem in the code and are shown in the normal code action context menu.
		 */
		static readonly QuickFix: CodeActionKind;

		/**
		 * Base kind for refactoring actions: `refactor`
		 *
		 * Refactoring actions are shown in the refactoring context menu.
		 */
		static readonly Refactor: CodeActionKind;

		/**
		 * Base kind for refactoring extraction actions: `refactor.extract`
		 *
		 * Example extract actions:
		 *
		 * - Extract method
		 * - Extract function
		 * - Extract variable
		 * - Extract interface from class
		 * - ...
		 */
		static readonly RefactorExtract: CodeActionKind;

		/**
		 * Base kind for refactoring inline actions: `refactor.inline`
		 *
		 * Example inline actions:
		 *
		 * - Inline function
		 * - Inline variable
		 * - Inline constant
		 * - ...
		 */
		static readonly RefactorInline: CodeActionKind;

		/**
		 * Base kind for refactoring rewrite actions: `refactor.rewrite`
		 *
		 * Example rewrite actions:
		 *
		 * - Convert JavaScript function to class
		 * - Add or remove parameter
		 * - Encapsulate field
		 * - Make method static
		 * - Move method to base class
		 * - ...
		 */
		static readonly RefactorRewrite: CodeActionKind;

		/**
		 * Base kind for source actions: `source`
		 *
		 * Source code actions apply to the entire file. They must be explicitly requested and will not show in the
		 * normal [lightbulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action) menu. Source actions
		 * can be run on save using `editor.codeActionsOnSave` and are also shown in the `source` context menu.
		 */
		static readonly Source: CodeActionKind;

		/**
		 * Base kind for an organize imports source action: `source.organizeImports`.
		 */
		static readonly SourceOrganizeImports: CodeActionKind;

		/**
		 * Base kind for auto-fix source actions: `source.fixAll`.
		 *
		 * Fix all actions automatically fix errors that have a clear fix that do not require user input.
		 * They should not suppress errors or perform unsafe fixes such as generating new types or classes.
		 */
		static readonly SourceFixAll: CodeActionKind;

		private constructor(value: string);

		/**
		 * String value of the kind, e.g. `"refactor.extract.function"`.
		 */
		readonly value: string;

		/**
		 * Create a new kind by appending a more specific selector to the current kind.
		 *
		 * Does not modify the current kind.
		 */
		append(parts: string): CodeActionKind;

		/**
		 * Checks if this code action kind intersects `other`.
		 *
		 * The kind `"refactor.extract"` for example intersects `refactor`, `"refactor.extract"` and ``"refactor.extract.function"`,
		 * but not `"unicorn.refactor.extract"`, or `"refactor.extractAll"`.
		 *
		 * @param other Kind to check.
		 */
		intersects(other: CodeActionKind): boolean;

		/**
		 * Checks if `other` is a sub-kind of this `CodeActionKind`.
		 *
		 * The kind `"refactor.extract"` for example contains `"refactor.extract"` and ``"refactor.extract.function"`,
		 * but not `"unicorn.refactor.extract"`, or `"refactor.extractAll"` or `refactor`.
		 *
		 * @param other Kind to check.
		 */
		contains(other: CodeActionKind): boolean;
	}

	/**
	 * Contains additional diagnostic information about the context in which
	 * a [code action](#CodeActionProvider.provideCodeActions) is run.
	 */
	export interface CodeActionContext {
		/**
		 * An array of diagnostics.
		 */
		readonly diagnostics: ReadonlyArray<Diagnostic>;

		/**
		 * Requested kind of actions to return.
		 *
		 * Actions not of this kind are filtered out before being shown by the [lightbulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action).
		 */
		readonly only?: CodeActionKind;
	}

	/**
	 * A code action represents a change that can be performed in code, e.g. to fix a problem or
	 * to refactor code.
	 *
	 * A CodeAction must set either [`edit`](#CodeAction.edit) and/or a [`command`](#CodeAction.command). If both are supplied, the `edit` is applied first, then the command is executed.
	 */
	export class CodeAction {

		/**
		 * A short, human-readable, title for this code action.
		 */
		title: string;

		/**
		 * A [workspace edit](#WorkspaceEdit) this code action performs.
		 */
		edit?: WorkspaceEdit;

		/**
		 * [Diagnostics](#Diagnostic) that this code action resolves.
		 */
		diagnostics?: Diagnostic[];

		/**
		 * A [command](#Command) this code action executes.
		 *
		 * If this command throws an exception, VS Code displays the exception message to users in the editor at the
		 * current cursor position.
		 */
		command?: Command;

		/**
		 * [Kind](#CodeActionKind) of the code action.
		 *
		 * Used to filter code actions.
		 */
		kind?: CodeActionKind;

		/**
		 * Marks this as a preferred action. Preferred actions are used by the `auto fix` command and can be targeted
		 * by keybindings.
		 *
		 * A quick fix should be marked preferred if it properly addresses the underlying error.
		 * A refactoring should be marked preferred if it is the most reasonable choice of actions to take.
		 */
		isPreferred?: boolean;

		/**
		 * Marks that the code action cannot currently be applied.
		 *
		 * - Disabled code actions are not shown in automatic [lightbulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action)
		 * code action menu.
		 *
		 * - Disabled actions are shown as faded out in the code action menu when the user request a more specific type
		 * of code action, such as refactorings.
		 *
		 * - If the user has a [keybinding](https://code.visualstudio.com/docs/editor/refactoring#_keybindings-for-code-actions)
		 * that auto applies a code action and only a disabled code actions are returned, VS Code will show the user an
		 * error message with `reason` in the editor.
		 */
		disabled?: {
			/**
			 * Human readable description of why the code action is currently disabled.
			 *
			 * This is displayed in the code actions UI.
			 */
			readonly reason: string;
		};

		/**
		 * Creates a new code action.
		 *
		 * A code action must have at least a [title](#CodeAction.title) and [edits](#CodeAction.edit)
		 * and/or a [command](#CodeAction.command).
		 *
		 * @param title The title of the code action.
		 * @param kind The kind of the code action.
		 */
		constructor(title: string, kind?: CodeActionKind);
	}

	/**
	 * The code action interface defines the contract between extensions and
	 * the [lightbulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action) feature.
	 *
	 * A code action can be any command that is [known](#commands.getCommands) to the system.
	 */
	export interface CodeActionProvider<T extends CodeAction = CodeAction> {
		/**
		 * Provide commands for the given document and range.
		 *
		 * @param document The document in which the command was invoked.
		 * @param range The selector or range for which the command was invoked. This will always be a selection if
		 * there is a currently active editor.
		 * @param context Context carrying additional information.
		 * @param token A cancellation token.
		 * @return An array of commands, quick fixes, or refactorings or a thenable of such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, token: CancellationToken): ProviderResult<(Command | CodeAction)[]>;

		/**
		 * Given a code action fill in its [`edit`](#CodeAction.edit)-property. Changes to
		 * all other properties, like title, are ignored. A code action that has an edit
		 * will not be resolved.
		 *
		 * *Note* that a code action provider that returns commands, not code actions, cannot successfully
		 * implement this function. Returning commands is deprecated and instead code actions should be
		 * returned.
		 *
		 * @param codeAction A code action.
		 * @param token A cancellation token.
		 * @return The resolved code action or a thenable that resolves to such. It is OK to return the given
		 * `item`. When no result is returned, the given `item` will be used.
		 */
		resolveCodeAction?(codeAction: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * Metadata about the type of code actions that a [CodeActionProvider](#CodeActionProvider) provides.
	 */
	export interface CodeActionProviderMetadata {
		/**
		 * List of [CodeActionKinds](#CodeActionKind) that a [CodeActionProvider](#CodeActionProvider) may return.
		 *
		 * This list is used to determine if a given `CodeActionProvider` should be invoked or not.
		 * To avoid unnecessary computation, every `CodeActionProvider` should list use `providedCodeActionKinds`. The
		 * list of kinds may either be generic, such as `[CodeActionKind.Refactor]`, or list out every kind provided,
		 * such as `[CodeActionKind.Refactor.Extract.append('function'), CodeActionKind.Refactor.Extract.append('constant'), ...]`.
		 */
		readonly providedCodeActionKinds?: ReadonlyArray<CodeActionKind>;

		/**
		 * Static documentation for a class of code actions.
		 *
		 * Documentation from the provider is shown in the code actions menu if either:
		 *
		 * - Code actions of `kind` are requested by VS Code. In this case, VS Code will show the documentation that
		 *   most closely matches the requested code action kind. For example, if a provider has documentation for
		 *   both `Refactor` and `RefactorExtract`, when the user requests code actions for `RefactorExtract`,
		 *   VS Code will use the documentation for `RefactorExtract` instead of the documentation for `Refactor`.
		 *
		 * - Any code actions of `kind` are returned by the provider.
		 *
		 * At most one documentation entry will be shown per provider.
		 */
		readonly documentation?: ReadonlyArray<{
			/**
			 * The kind of the code action being documented.
			 *
			 * If the kind is generic, such as `CodeActionKind.Refactor`, the documentation will be shown whenever any
			 * refactorings are returned. If the kind if more specific, such as `CodeActionKind.RefactorExtract`, the
			 * documentation will only be shown when extract refactoring code actions are returned.
			 */
			readonly kind: CodeActionKind;

			/**
			 * Command that displays the documentation to the user.
			 *
			 * This can display the documentation directly in VS Code or open a website using [`env.openExternal`](#env.openExternal);
			 *
			 * The title of this documentation code action is taken from [`Command.title`](#Command.title)
			 */
			readonly command: Command;
		}>;
	}

	/**
	 * A code lens represents a [command](#Command) that should be shown along with
	 * source text, like the number of references, a way to run tests, etc.
	 *
	 * A code lens is _unresolved_ when no command is associated to it. For performance
	 * reasons the creation of a code lens and resolving should be done to two stages.
	 *
	 * @see [CodeLensProvider.provideCodeLenses](#CodeLensProvider.provideCodeLenses)
	 * @see [CodeLensProvider.resolveCodeLens](#CodeLensProvider.resolveCodeLens)
	 */
	export class CodeLens {

		/**
		 * The range in which this code lens is valid. Should only span a single line.
		 */
		range: Range;

		/**
		 * The command this code lens represents.
		 */
		command?: Command;

		/**
		 * `true` when there is a command associated.
		 */
		readonly isResolved: boolean;

		/**
		 * Creates a new code lens object.
		 *
		 * @param range The range to which this code lens applies.
		 * @param command The command associated to this code lens.
		 */
		constructor(range: Range, command?: Command);
	}

	/**
	 * A code lens provider adds [commands](#Command) to source text. The commands will be shown
	 * as dedicated horizontal lines in between the source text.
	 */
	export interface CodeLensProvider<T extends CodeLens = CodeLens> {

		/**
		 * An optional event to signal that the code lenses from this provider have changed.
		 */
		onDidChangeCodeLenses?: Event<void>;

		/**
		 * Compute a list of [lenses](#CodeLens). This call should return as fast as possible and if
		 * computing the commands is expensive implementors should only return code lens objects with the
		 * range set and implement [resolve](#CodeLensProvider.resolveCodeLens).
		 *
		 * @param document The document in which the command was invoked.
		 * @param token A cancellation token.
		 * @return An array of code lenses or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<T[]>;

		/**
		 * This function will be called for each visible code lens, usually when scrolling and after
		 * calls to [compute](#CodeLensProvider.provideCodeLenses)-lenses.
		 *
		 * @param codeLens Code lens that must be resolved.
		 * @param token A cancellation token.
		 * @return The given, resolved code lens or thenable that resolves to such.
		 */
		resolveCodeLens?(codeLens: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * Information about where a symbol is defined.
	 *
	 * Provides additional metadata over normal [location](#Location) definitions, including the range of
	 * the defining symbol
	 */
	export type DefinitionLink = LocationLink;

	/**
	 * The definition of a symbol represented as one or many [locations](#Location).
	 * For most programming languages there is only one location at which a symbol is
	 * defined.
	 */
	export type Definition = Location | Location[];

	/**
	 * The definition provider interface defines the contract between extensions and
	 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
	 * and peek definition features.
	 */
	export interface DefinitionProvider {

		/**
		 * Provide the definition of the symbol at the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return A definition or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideDefinition(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>;
	}

	/**
	 * The implementation provider interface defines the contract between extensions and
	 * the go to implementation feature.
	 */
	export interface ImplementationProvider {

		/**
		 * Provide the implementations of the symbol at the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return A definition or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideImplementation(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>;
	}

	/**
	 * The type definition provider defines the contract between extensions and
	 * the go to type definition feature.
	 */
	export interface TypeDefinitionProvider {

		/**
		 * Provide the type definition of the symbol at the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return A definition or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideTypeDefinition(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>;
	}

	/**
	 * The declaration of a symbol representation as one or many [locations](#Location)
	 * or [location links](#LocationLink).
	 */
	export type Declaration = Location | Location[] | LocationLink[];

	/**
	 * The declaration provider interface defines the contract between extensions and
	 * the go to declaration feature.
	 */
	export interface DeclarationProvider {

		/**
		 * Provide the declaration of the symbol at the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return A declaration or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideDeclaration(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Declaration>;
	}

	/**
	 * The MarkdownString represents human-readable text that supports formatting via the
	 * markdown syntax. Standard markdown is supported, also tables, but no embedded html.
	 *
	 * When created with `supportThemeIcons` then rendering of [theme icons](#ThemeIcon) via
	 * the `$(<name>)`-syntax is supported.
	 */
	export class MarkdownString {

		/**
		 * The markdown string.
		 */
		value: string;

		/**
		 * Indicates that this markdown string is from a trusted source. Only *trusted*
		 * markdown supports links that execute commands, e.g. `[Run it](command:myCommandId)`.
		 */
		isTrusted?: boolean;

		/**
		 * Indicates that this markdown string can contain [ThemeIcons](#ThemeIcon), e.g. `$(zap)`.
		 */
		readonly supportThemeIcons?: boolean;

		/**
		 * Creates a new markdown string with the given value.
		 *
		 * @param value Optional, initial value.
		 * @param supportThemeIcons Optional, Specifies whether [ThemeIcons](#ThemeIcon) are supported within the [`MarkdownString`](#MarkdownString).
		 */
		constructor(value?: string, supportThemeIcons?: boolean);

		/**
		 * Appends and escapes the given string to this markdown string.
		 * @param value Plain text.
		 */
		appendText(value: string): MarkdownString;

		/**
		 * Appends the given string 'as is' to this markdown string. When [`supportThemeIcons`](#MarkdownString.supportThemeIcons) is `true`, [ThemeIcons](#ThemeIcon) in the `value` will be iconified.
		 * @param value Markdown string.
		 */
		appendMarkdown(value: string): MarkdownString;

		/**
		 * Appends the given string as codeblock using the provided language.
		 * @param value A code snippet.
		 * @param language An optional [language identifier](#languages.getLanguages).
		 */
		appendCodeblock(value: string, language?: string): MarkdownString;
	}

	/**
	 * MarkedString can be used to render human-readable text. It is either a markdown string
	 * or a code-block that provides a language and a code snippet. Note that
	 * markdown strings will be sanitized - that means html will be escaped.
	 *
	 * @deprecated This type is deprecated, please use [`MarkdownString`](#MarkdownString) instead.
	 */
	export type MarkedString = MarkdownString | string | { language: string; value: string };

	/**
	 * A hover represents additional information for a symbol or word. Hovers are
	 * rendered in a tooltip-like widget.
	 */
	export class Hover {

		/**
		 * The contents of this hover.
		 */
		contents: MarkedString[];

		/**
		 * The range to which this hover applies. When missing, the
		 * editor will use the range at the current position or the
		 * current position itself.
		 */
		range?: Range;

		/**
		 * Creates a new hover object.
		 *
		 * @param contents The contents of the hover.
		 * @param range The range to which the hover applies.
		 */
		constructor(contents: MarkedString | MarkedString[], range?: Range);
	}

	/**
	 * The hover provider interface defines the contract between extensions and
	 * the [hover](https://code.visualstudio.com/docs/editor/intellisense)-feature.
	 */
	export interface HoverProvider {

		/**
		 * Provide a hover for the given position and document. Multiple hovers at the same
		 * position will be merged by the editor. A hover can have a range which defaults
		 * to the word range at the position when omitted.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return A hover or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideHover(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Hover>;
	}

	/**
	 * An EvaluatableExpression represents an expression in a document that can be evaluated by an active debugger or runtime.
	 * The result of this evaluation is shown in a tooltip-like widget.
	 * If only a range is specified, the expression will be extracted from the underlying document.
	 * An optional expression can be used to override the extracted expression.
	 * In this case the range is still used to highlight the range in the document.
	 */
	export class EvaluatableExpression {

		/*
		 * The range is used to extract the evaluatable expression from the underlying document and to highlight it.
		 */
		readonly range: Range;

		/*
		 * If specified the expression overrides the extracted expression.
		 */
		readonly expression?: string;

		/**
		 * Creates a new evaluatable expression object.
		 *
		 * @param range The range in the underlying document from which the evaluatable expression is extracted.
		 * @param expression If specified overrides the extracted expression.
		 */
		constructor(range: Range, expression?: string);
	}

	/**
	 * The evaluatable expression provider interface defines the contract between extensions and
	 * the debug hover. In this contract the provider returns an evaluatable expression for a given position
	 * in a document and VS Code evaluates this expression in the active debug session and shows the result in a debug hover.
	 */
	export interface EvaluatableExpressionProvider {

		/**
		 * Provide an evaluatable expression for the given document and position.
		 * VS Code will evaluate this expression in the active debug session and will show the result in the debug hover.
		 * The expression can be implicitly specified by the range in the underlying document or by explicitly returning an expression.
		 *
		 * @param document The document for which the debug hover is about to appear.
		 * @param position The line and character position in the document where the debug hover is about to appear.
		 * @param token A cancellation token.
		 * @return An EvaluatableExpression or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideEvaluatableExpression(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<EvaluatableExpression>;
	}

	/**
	 * A document highlight kind.
	 */
	export enum DocumentHighlightKind {

		/**
		 * A textual occurrence.
		 */
		Text = 0,

		/**
		 * Read-access of a symbol, like reading a variable.
		 */
		Read = 1,

		/**
		 * Write-access of a symbol, like writing to a variable.
		 */
		Write = 2
	}

	/**
	 * A document highlight is a range inside a text document which deserves
	 * special attention. Usually a document highlight is visualized by changing
	 * the background color of its range.
	 */
	export class DocumentHighlight {

		/**
		 * The range this highlight applies to.
		 */
		range: Range;

		/**
		 * The highlight kind, default is [text](#DocumentHighlightKind.Text).
		 */
		kind?: DocumentHighlightKind;

		/**
		 * Creates a new document highlight object.
		 *
		 * @param range The range the highlight applies to.
		 * @param kind The highlight kind, default is [text](#DocumentHighlightKind.Text).
		 */
		constructor(range: Range, kind?: DocumentHighlightKind);
	}

	/**
	 * The document highlight provider interface defines the contract between extensions and
	 * the word-highlight-feature.
	 */
	export interface DocumentHighlightProvider {

		/**
		 * Provide a set of document highlights, like all occurrences of a variable or
		 * all exit-points of a function.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideDocumentHighlights(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>;
	}

	/**
	 * A symbol kind.
	 */
	export enum SymbolKind {
		File = 0,
		Module = 1,
		Namespace = 2,
		Package = 3,
		Class = 4,
		Method = 5,
		Property = 6,
		Field = 7,
		Constructor = 8,
		Enum = 9,
		Interface = 10,
		Function = 11,
		Variable = 12,
		Constant = 13,
		String = 14,
		Number = 15,
		Boolean = 16,
		Array = 17,
		Object = 18,
		Key = 19,
		Null = 20,
		EnumMember = 21,
		Struct = 22,
		Event = 23,
		Operator = 24,
		TypeParameter = 25
	}

	/**
	 * Symbol tags are extra annotations that tweak the rendering of a symbol.
	 */
	export enum SymbolTag {

		/**
		 * Render a symbol as obsolete, usually using a strike-out.
		 */
		Deprecated = 1
	}

	/**
	 * Represents information about programming constructs like variables, classes,
	 * interfaces etc.
	 */
	export class SymbolInformation {

		/**
		 * The name of this symbol.
		 */
		name: string;

		/**
		 * The name of the symbol containing this symbol.
		 */
		containerName: string;

		/**
		 * The kind of this symbol.
		 */
		kind: SymbolKind;

		/**
		 * Tags for this symbol.
		 */
		tags?: ReadonlyArray<SymbolTag>;

		/**
		 * The location of this symbol.
		 */
		location: Location;

		/**
		 * Creates a new symbol information object.
		 *
		 * @param name The name of the symbol.
		 * @param kind The kind of the symbol.
		 * @param containerName The name of the symbol containing the symbol.
		 * @param location The location of the symbol.
		 */
		constructor(name: string, kind: SymbolKind, containerName: string, location: Location);

		/**
		 * Creates a new symbol information object.
		 *
		 * @deprecated Please use the constructor taking a [location](#Location) object.
		 *
		 * @param name The name of the symbol.
		 * @param kind The kind of the symbol.
		 * @param range The range of the location of the symbol.
		 * @param uri The resource of the location of symbol, defaults to the current document.
		 * @param containerName The name of the symbol containing the symbol.
		 */
		constructor(name: string, kind: SymbolKind, range: Range, uri?: Uri, containerName?: string);
	}

	/**
	 * Represents programming constructs like variables, classes, interfaces etc. that appear in a document. Document
	 * symbols can be hierarchical and they have two ranges: one that encloses its definition and one that points to
	 * its most interesting range, e.g. the range of an identifier.
	 */
	export class DocumentSymbol {

		/**
		 * The name of this symbol.
		 */
		name: string;

		/**
		 * More detail for this symbol, e.g. the signature of a function.
		 */
		detail: string;

		/**
		 * The kind of this symbol.
		 */
		kind: SymbolKind;

		/**
		 * Tags for this symbol.
		 */
		tags?: ReadonlyArray<SymbolTag>;

		/**
		 * The range enclosing this symbol not including leading/trailing whitespace but everything else, e.g. comments and code.
		 */
		range: Range;

		/**
		 * The range that should be selected and reveal when this symbol is being picked, e.g. the name of a function.
		 * Must be contained by the [`range`](#DocumentSymbol.range).
		 */
		selectionRange: Range;

		/**
		 * Children of this symbol, e.g. properties of a class.
		 */
		children: DocumentSymbol[];

		/**
		 * Creates a new document symbol.
		 *
		 * @param name The name of the symbol.
		 * @param detail Details for the symbol.
		 * @param kind The kind of the symbol.
		 * @param range The full range of the symbol.
		 * @param selectionRange The range that should be reveal.
		 */
		constructor(name: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range);
	}

	/**
	 * The document symbol provider interface defines the contract between extensions and
	 * the [go to symbol](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-symbol)-feature.
	 */
	export interface DocumentSymbolProvider {

		/**
		 * Provide symbol information for the given document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param token A cancellation token.
		 * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideDocumentSymbols(document: TextDocument, token: CancellationToken): ProviderResult<SymbolInformation[] | DocumentSymbol[]>;
	}

	/**
	 * Metadata about a document symbol provider.
	 */
	export interface DocumentSymbolProviderMetadata {
		/**
		 * A human-readable string that is shown when multiple outlines trees show for one document.
		 */
		label?: string;
	}

	/**
	 * The workspace symbol provider interface defines the contract between extensions and
	 * the [symbol search](https://code.visualstudio.com/docs/editor/editingevolved#_open-symbol-by-name)-feature.
	 */
	export interface WorkspaceSymbolProvider<T extends SymbolInformation = SymbolInformation> {

		/**
		 * Project-wide search for a symbol matching the given query string.
		 *
		 * The `query`-parameter should be interpreted in a *relaxed way* as the editor will apply its own highlighting
		 * and scoring on the results. A good rule of thumb is to match case-insensitive and to simply check that the
		 * characters of *query* appear in their order in a candidate symbol. Don't use prefix, substring, or similar
		 * strict matching.
		 *
		 * To improve performance implementors can implement `resolveWorkspaceSymbol` and then provide symbols with partial
		 * [location](#SymbolInformation.location)-objects, without a `range` defined. The editor will then call
		 * `resolveWorkspaceSymbol` for selected symbols only, e.g. when opening a workspace symbol.
		 *
		 * @param query A query string, can be the empty string in which case all symbols should be returned.
		 * @param token A cancellation token.
		 * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideWorkspaceSymbols(query: string, token: CancellationToken): ProviderResult<T[]>;

		/**
		 * Given a symbol fill in its [location](#SymbolInformation.location). This method is called whenever a symbol
		 * is selected in the UI. Providers can implement this method and return incomplete symbols from
		 * [`provideWorkspaceSymbols`](#WorkspaceSymbolProvider.provideWorkspaceSymbols) which often helps to improve
		 * performance.
		 *
		 * @param symbol The symbol that is to be resolved. Guaranteed to be an instance of an object returned from an
		 * earlier call to `provideWorkspaceSymbols`.
		 * @param token A cancellation token.
		 * @return The resolved symbol or a thenable that resolves to that. When no result is returned,
		 * the given `symbol` is used.
		 */
		resolveWorkspaceSymbol?(symbol: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * Value-object that contains additional information when
	 * requesting references.
	 */
	export interface ReferenceContext {

		/**
		 * Include the declaration of the current symbol.
		 */
		includeDeclaration: boolean;
	}

	/**
	 * The reference provider interface defines the contract between extensions and
	 * the [find references](https://code.visualstudio.com/docs/editor/editingevolved#_peek)-feature.
	 */
	export interface ReferenceProvider {

		/**
		 * Provide a set of project-wide references for the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 *
		 * @return An array of locations or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): ProviderResult<Location[]>;
	}

	/**
	 * A text edit represents edits that should be applied
	 * to a document.
	 */
	export class TextEdit {

		/**
		 * Utility to create a replace edit.
		 *
		 * @param range A range.
		 * @param newText A string.
		 * @return A new text edit object.
		 */
		static replace(range: Range, newText: string): TextEdit;

		/**
		 * Utility to create an insert edit.
		 *
		 * @param position A position, will become an empty range.
		 * @param newText A string.
		 * @return A new text edit object.
		 */
		static insert(position: Position, newText: string): TextEdit;

		/**
		 * Utility to create a delete edit.
		 *
		 * @param range A range.
		 * @return A new text edit object.
		 */
		static delete(range: Range): TextEdit;

		/**
		 * Utility to create an eol-edit.
		 *
		 * @param eol An eol-sequence
		 * @return A new text edit object.
		 */
		static setEndOfLine(eol: EndOfLine): TextEdit;

		/**
		 * The range this edit applies to.
		 */
		range: Range;

		/**
		 * The string this edit will insert.
		 */
		newText: string;

		/**
		 * The eol-sequence used in the document.
		 *
		 * *Note* that the eol-sequence will be applied to the
		 * whole document.
		 */
		newEol?: EndOfLine;

		/**
		 * Create a new TextEdit.
		 *
		 * @param range A range.
		 * @param newText A string.
		 */
		constructor(range: Range, newText: string);
	}

	/**
	 * Additional data for entries of a workspace edit. Supports to label entries and marks entries
	 * as needing confirmation by the user. The editor groups edits with equal labels into tree nodes,
	 * for instance all edits labelled with "Changes in Strings" would be a tree node.
	 */
	export interface WorkspaceEditEntryMetadata {

		/**
		 * A flag which indicates that user confirmation is needed.
		 */
		needsConfirmation: boolean;

		/**
		 * A human-readable string which is rendered prominent.
		 */
		label: string;

		/**
		 * A human-readable string which is rendered less prominent on the same line.
		 */
		description?: string;

		/**
		 * The icon path or [ThemeIcon](#ThemeIcon) for the edit.
		 */
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
	}

	/**
	 * A workspace edit is a collection of textual and files changes for
	 * multiple resources and documents.
	 *
	 * Use the [applyEdit](#workspace.applyEdit)-function to apply a workspace edit.
	 */
	export class WorkspaceEdit {

		/**
		 * The number of affected resources of textual or resource changes.
		 */
		readonly size: number;

		/**
		 * Replace the given range with given text for the given resource.
		 *
		 * @param uri A resource identifier.
		 * @param range A range.
		 * @param newText A string.
		 * @param metadata Optional metadata for the entry.
		 */
		replace(uri: Uri, range: Range, newText: string, metadata?: WorkspaceEditEntryMetadata): void;

		/**
		 * Insert the given text at the given position.
		 *
		 * @param uri A resource identifier.
		 * @param position A position.
		 * @param newText A string.
		 * @param metadata Optional metadata for the entry.
		 */
		insert(uri: Uri, position: Position, newText: string, metadata?: WorkspaceEditEntryMetadata): void;

		/**
		 * Delete the text at the given range.
		 *
		 * @param uri A resource identifier.
		 * @param range A range.
		 * @param metadata Optional metadata for the entry.
		 */
		delete(uri: Uri, range: Range, metadata?: WorkspaceEditEntryMetadata): void;

		/**
		 * Check if a text edit for a resource exists.
		 *
		 * @param uri A resource identifier.
		 * @return `true` if the given resource will be touched by this edit.
		 */
		has(uri: Uri): boolean;

		/**
		 * Set (and replace) text edits for a resource.
		 *
		 * @param uri A resource identifier.
		 * @param edits An array of text edits.
		 */
		set(uri: Uri, edits: TextEdit[]): void;

		/**
		 * Get the text edits for a resource.
		 *
		 * @param uri A resource identifier.
		 * @return An array of text edits.
		 */
		get(uri: Uri): TextEdit[];

		/**
		 * Create a regular file.
		 *
		 * @param uri Uri of the new file..
		 * @param options Defines if an existing file should be overwritten or be
		 * ignored. When overwrite and ignoreIfExists are both set overwrite wins.
		 * When both are unset and when the file already exists then the edit cannot
		 * be applied successfully.
		 * @param metadata Optional metadata for the entry.
		 */
		createFile(uri: Uri, options?: { overwrite?: boolean, ignoreIfExists?: boolean }, metadata?: WorkspaceEditEntryMetadata): void;

		/**
		 * Delete a file or folder.
		 *
		 * @param uri The uri of the file that is to be deleted.
		 * @param metadata Optional metadata for the entry.
		 */
		deleteFile(uri: Uri, options?: { recursive?: boolean, ignoreIfNotExists?: boolean }, metadata?: WorkspaceEditEntryMetadata): void;

		/**
		 * Rename a file or folder.
		 *
		 * @param oldUri The existing file.
		 * @param newUri The new location.
		 * @param options Defines if existing files should be overwritten or be
		 * ignored. When overwrite and ignoreIfExists are both set overwrite wins.
		 * @param metadata Optional metadata for the entry.
		 */
		renameFile(oldUri: Uri, newUri: Uri, options?: { overwrite?: boolean, ignoreIfExists?: boolean }, metadata?: WorkspaceEditEntryMetadata): void;

		/**
		 * Get all text edits grouped by resource.
		 *
		 * @return A shallow copy of `[Uri, TextEdit[]]`-tuples.
		 */
		entries(): [Uri, TextEdit[]][];
	}

	/**
	 * A snippet string is a template which allows to insert text
	 * and to control the editor cursor when insertion happens.
	 *
	 * A snippet can define tab stops and placeholders with `$1`, `$2`
	 * and `${3:foo}`. `$0` defines the final tab stop, it defaults to
	 * the end of the snippet. Variables are defined with `$name` and
	 * `${name:default value}`. The full snippet syntax is documented
	 * [here](https://code.visualstudio.com/docs/editor/userdefinedsnippets#_creating-your-own-snippets).
	 */
	export class SnippetString {

		/**
		 * The snippet string.
		 */
		value: string;

		constructor(value?: string);

		/**
		 * Builder-function that appends the given string to
		 * the [`value`](#SnippetString.value) of this snippet string.
		 *
		 * @param string A value to append 'as given'. The string will be escaped.
		 * @return This snippet string.
		 */
		appendText(string: string): SnippetString;

		/**
		 * Builder-function that appends a tabstop (`$1`, `$2` etc) to
		 * the [`value`](#SnippetString.value) of this snippet string.
		 *
		 * @param number The number of this tabstop, defaults to an auto-increment
		 * value starting at 1.
		 * @return This snippet string.
		 */
		appendTabstop(number?: number): SnippetString;

		/**
		 * Builder-function that appends a placeholder (`${1:value}`) to
		 * the [`value`](#SnippetString.value) of this snippet string.
		 *
		 * @param value The value of this placeholder - either a string or a function
		 * with which a nested snippet can be created.
		 * @param number The number of this tabstop, defaults to an auto-increment
		 * value starting at 1.
		 * @return This snippet string.
		 */
		appendPlaceholder(value: string | ((snippet: SnippetString) => any), number?: number): SnippetString;

		/**
		 * Builder-function that appends a choice (`${1|a,b,c}`) to
		 * the [`value`](#SnippetString.value) of this snippet string.
		 *
		 * @param values The values for choices - the array of strings
		 * @param number The number of this tabstop, defaults to an auto-increment
		 * value starting at 1.
		 * @return This snippet string.
		 */
		appendChoice(values: string[], number?: number): SnippetString;

		/**
		 * Builder-function that appends a variable (`${VAR}`) to
		 * the [`value`](#SnippetString.value) of this snippet string.
		 *
		 * @param name The name of the variable - excluding the `$`.
		 * @param defaultValue The default value which is used when the variable name cannot
		 * be resolved - either a string or a function with which a nested snippet can be created.
		 * @return This snippet string.
		 */
		appendVariable(name: string, defaultValue: string | ((snippet: SnippetString) => any)): SnippetString;
	}

	/**
	 * The rename provider interface defines the contract between extensions and
	 * the [rename](https://code.visualstudio.com/docs/editor/editingevolved#_rename-symbol)-feature.
	 */
	export interface RenameProvider {

		/**
		 * Provide an edit that describes changes that have to be made to one
		 * or many resources to rename a symbol to a different name.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param newName The new name of the symbol. If the given name is not valid, the provider must return a rejected promise.
		 * @param token A cancellation token.
		 * @return A workspace edit or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideRenameEdits(document: TextDocument, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit>;

		/**
		 * Optional function for resolving and validating a position *before* running rename. The result can
		 * be a range or a range and a placeholder text. The placeholder text should be the identifier of the symbol
		 * which is being renamed - when omitted the text in the returned range is used.
		 *
		 * *Note: * This function should throw an error or return a rejected thenable when the provided location
		 * doesn't allow for a rename.
		 *
		 * @param document The document in which rename will be invoked.
		 * @param position The position at which rename will be invoked.
		 * @param token A cancellation token.
		 * @return The range or range and placeholder text of the identifier that is to be renamed. The lack of a result can signaled by returning `undefined` or `null`.
		 */
		prepareRename?(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Range | { range: Range, placeholder: string }>;
	}

	/**
	 * A semantic tokens legend contains the needed information to decipher
	 * the integer encoded representation of semantic tokens.
	 */
	export class SemanticTokensLegend {
		/**
		 * The possible token types.
		 */
		readonly tokenTypes: string[];
		/**
		 * The possible token modifiers.
		 */
		readonly tokenModifiers: string[];

		constructor(tokenTypes: string[], tokenModifiers?: string[]);
	}

	/**
	 * A semantic tokens builder can help with creating a `SemanticTokens` instance
	 * which contains delta encoded semantic tokens.
	 */
	export class SemanticTokensBuilder {

		constructor(legend?: SemanticTokensLegend);

		/**
		 * Add another token.
		 *
		 * @param line The token start line number (absolute value).
		 * @param char The token start character (absolute value).
		 * @param length The token length in characters.
		 * @param tokenType The encoded token type.
		 * @param tokenModifiers The encoded token modifiers.
		 */
		push(line: number, char: number, length: number, tokenType: number, tokenModifiers?: number): void;

		/**
		 * Add another token. Use only when providing a legend.
		 *
		 * @param range The range of the token. Must be single-line.
		 * @param tokenType The token type.
		 * @param tokenModifiers The token modifiers.
		 */
		push(range: Range, tokenType: string, tokenModifiers?: string[]): void;

		/**
		 * Finish and create a `SemanticTokens` instance.
		 */
		build(resultId?: string): SemanticTokens;
	}

	/**
	 * Represents semantic tokens, either in a range or in an entire document.
	 * @see [provideDocumentSemanticTokens](#DocumentSemanticTokensProvider.provideDocumentSemanticTokens) for an explanation of the format.
	 * @see [SemanticTokensBuilder](#SemanticTokensBuilder) for a helper to create an instance.
	 */
	export class SemanticTokens {
		/**
		 * The result id of the tokens.
		 *
		 * This is the id that will be passed to `DocumentSemanticTokensProvider.provideDocumentSemanticTokensEdits` (if implemented).
		 */
		readonly resultId?: string;
		/**
		 * The actual tokens data.
		 * @see [provideDocumentSemanticTokens](#DocumentSemanticTokensProvider.provideDocumentSemanticTokens) for an explanation of the format.
		 */
		readonly data: Uint32Array;

		constructor(data: Uint32Array, resultId?: string);
	}

	/**
	 * Represents edits to semantic tokens.
	 * @see [provideDocumentSemanticTokensEdits](#DocumentSemanticTokensProvider.provideDocumentSemanticTokensEdits) for an explanation of the format.
	 */
	export class SemanticTokensEdits {
		/**
		 * The result id of the tokens.
		 *
		 * This is the id that will be passed to `DocumentSemanticTokensProvider.provideDocumentSemanticTokensEdits` (if implemented).
		 */
		readonly resultId?: string;
		/**
		 * The edits to the tokens data.
		 * All edits refer to the initial data state.
		 */
		readonly edits: SemanticTokensEdit[];

		constructor(edits: SemanticTokensEdit[], resultId?: string);
	}

	/**
	 * Represents an edit to semantic tokens.
	 * @see [provideDocumentSemanticTokensEdits](#DocumentSemanticTokensProvider.provideDocumentSemanticTokensEdits) for an explanation of the format.
	 */
	export class SemanticTokensEdit {
		/**
		 * The start offset of the edit.
		 */
		readonly start: number;
		/**
		 * The count of elements to remove.
		 */
		readonly deleteCount: number;
		/**
		 * The elements to insert.
		 */
		readonly data?: Uint32Array;

		constructor(start: number, deleteCount: number, data?: Uint32Array);
	}

	/**
	 * The document semantic tokens provider interface defines the contract between extensions and
	 * semantic tokens.
	 */
	export interface DocumentSemanticTokensProvider {
		/**
		 * An optional event to signal that the semantic tokens from this provider have changed.
		 */
		onDidChangeSemanticTokens?: Event<void>;

		/**
		 * Tokens in a file are represented as an array of integers. The position of each token is expressed relative to
		 * the token before it, because most tokens remain stable relative to each other when edits are made in a file.
		 *
		 * ---
		 * In short, each token takes 5 integers to represent, so a specific token `i` in the file consists of the following array indices:
		 *  - at index `5*i`   - `deltaLine`: token line number, relative to the previous token
		 *  - at index `5*i+1` - `deltaStart`: token start character, relative to the previous token (relative to 0 or the previous token's start if they are on the same line)
		 *  - at index `5*i+2` - `length`: the length of the token. A token cannot be multiline.
		 *  - at index `5*i+3` - `tokenType`: will be looked up in `SemanticTokensLegend.tokenTypes`. We currently ask that `tokenType` < 65536.
		 *  - at index `5*i+4` - `tokenModifiers`: each set bit will be looked up in `SemanticTokensLegend.tokenModifiers`
		 *
		 * ---
		 * ### How to encode tokens
		 *
		 * Here is an example for encoding a file with 3 tokens in a uint32 array:
		 * ```
		 *    { line: 2, startChar:  5, length: 3, tokenType: "property",  tokenModifiers: ["private", "static"] },
		 *    { line: 2, startChar: 10, length: 4, tokenType: "type",      tokenModifiers: [] },
		 *    { line: 5, startChar:  2, length: 7, tokenType: "class",     tokenModifiers: [] }
		 * ```
		 *
		 * 1. First of all, a legend must be devised. This legend must be provided up-front and capture all possible token types.
		 * For this example, we will choose the following legend which must be passed in when registering the provider:
		 * ```
		 *    tokenTypes: ['property', 'type', 'class'],
		 *    tokenModifiers: ['private', 'static']
		 * ```
		 *
		 * 2. The first transformation step is to encode `tokenType` and `tokenModifiers` as integers using the legend. Token types are looked
		 * up by index, so a `tokenType` value of `1` means `tokenTypes[1]`. Multiple token modifiers can be set by using bit flags,
		 * so a `tokenModifier` value of `3` is first viewed as binary `0b00000011`, which means `[tokenModifiers[0], tokenModifiers[1]]` because
		 * bits 0 and 1 are set. Using this legend, the tokens now are:
		 * ```
		 *    { line: 2, startChar:  5, length: 3, tokenType: 0, tokenModifiers: 3 },
		 *    { line: 2, startChar: 10, length: 4, tokenType: 1, tokenModifiers: 0 },
		 *    { line: 5, startChar:  2, length: 7, tokenType: 2, tokenModifiers: 0 }
		 * ```
		 *
		 * 3. The next step is to represent each token relative to the previous token in the file. In this case, the second token
		 * is on the same line as the first token, so the `startChar` of the second token is made relative to the `startChar`
		 * of the first token, so it will be `10 - 5`. The third token is on a different line than the second token, so the
		 * `startChar` of the third token will not be altered:
		 * ```
		 *    { deltaLine: 2, deltaStartChar: 5, length: 3, tokenType: 0, tokenModifiers: 3 },
		 *    { deltaLine: 0, deltaStartChar: 5, length: 4, tokenType: 1, tokenModifiers: 0 },
		 *    { deltaLine: 3, deltaStartChar: 2, length: 7, tokenType: 2, tokenModifiers: 0 }
		 * ```
		 *
		 * 4. Finally, the last step is to inline each of the 5 fields for a token in a single array, which is a memory friendly representation:
		 * ```
		 *    // 1st token,  2nd token,  3rd token
		 *    [  2,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ]
		 * ```
		 *
		 * @see [SemanticTokensBuilder](#SemanticTokensBuilder) for a helper to encode tokens as integers.
		 * *NOTE*: When doing edits, it is possible that multiple edits occur until VS Code decides to invoke the semantic tokens provider.
		 * *NOTE*: If the provider cannot temporarily compute semantic tokens, it can indicate this by throwing an error with the message 'Busy'.
		 */
		provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): ProviderResult<SemanticTokens>;

		/**
		 * Instead of always returning all the tokens in a file, it is possible for a `DocumentSemanticTokensProvider` to implement
		 * this method (`provideDocumentSemanticTokensEdits`) and then return incremental updates to the previously provided semantic tokens.
		 *
		 * ---
		 * ### How tokens change when the document changes
		 *
		 * Suppose that `provideDocumentSemanticTokens` has previously returned the following semantic tokens:
		 * ```
		 *    // 1st token,  2nd token,  3rd token
		 *    [  2,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ]
		 * ```
		 *
		 * Also suppose that after some edits, the new semantic tokens in a file are:
		 * ```
		 *    // 1st token,  2nd token,  3rd token
		 *    [  3,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ]
		 * ```
		 * It is possible to express these new tokens in terms of an edit applied to the previous tokens:
		 * ```
		 *    [  2,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ] // old tokens
		 *    [  3,5,3,0,3,  0,5,4,1,0,  3,2,7,2,0 ] // new tokens
		 *
		 *    edit: { start:  0, deleteCount: 1, data: [3] } // replace integer at offset 0 with 3
		 * ```
		 *
		 * *NOTE*: If the provider cannot compute `SemanticTokensEdits`, it can "give up" and return all the tokens in the document again.
		 * *NOTE*: All edits in `SemanticTokensEdits` contain indices in the old integers array, so they all refer to the previous result state.
		 */
		provideDocumentSemanticTokensEdits?(document: TextDocument, previousResultId: string, token: CancellationToken): ProviderResult<SemanticTokens | SemanticTokensEdits>;
	}

	/**
	 * The document range semantic tokens provider interface defines the contract between extensions and
	 * semantic tokens.
	 */
	export interface DocumentRangeSemanticTokensProvider {
		/**
		 * @see [provideDocumentSemanticTokens](#DocumentSemanticTokensProvider.provideDocumentSemanticTokens).
		 */
		provideDocumentRangeSemanticTokens(document: TextDocument, range: Range, token: CancellationToken): ProviderResult<SemanticTokens>;
	}

	/**
	 * Value-object describing what options formatting should use.
	 */
	export interface FormattingOptions {

		/**
		 * Size of a tab in spaces.
		 */
		tabSize: number;

		/**
		 * Prefer spaces over tabs.
		 */
		insertSpaces: boolean;

		/**
		 * Signature for further properties.
		 */
		[key: string]: boolean | number | string;
	}

	/**
	 * The document formatting provider interface defines the contract between extensions and
	 * the formatting-feature.
	 */
	export interface DocumentFormattingEditProvider {

		/**
		 * Provide formatting edits for a whole document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param options Options controlling formatting.
		 * @param token A cancellation token.
		 * @return A set of text edits or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	/**
	 * The document formatting provider interface defines the contract between extensions and
	 * the formatting-feature.
	 */
	export interface DocumentRangeFormattingEditProvider {

		/**
		 * Provide formatting edits for a range in a document.
		 *
		 * The given range is a hint and providers can decide to format a smaller
		 * or larger range. Often this is done by adjusting the start and end
		 * of the range to full syntax nodes.
		 *
		 * @param document The document in which the command was invoked.
		 * @param range The range which should be formatted.
		 * @param options Options controlling formatting.
		 * @param token A cancellation token.
		 * @return A set of text edits or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	/**
	 * The document formatting provider interface defines the contract between extensions and
	 * the formatting-feature.
	 */
	export interface OnTypeFormattingEditProvider {

		/**
		 * Provide formatting edits after a character has been typed.
		 *
		 * The given position and character should hint to the provider
		 * what range the position to expand to, like find the matching `{`
		 * when `}` has been entered.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param ch The character that has been typed.
		 * @param options Options controlling formatting.
		 * @param token A cancellation token.
		 * @return A set of text edits or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideOnTypeFormattingEdits(document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	/**
	 * Represents a parameter of a callable-signature. A parameter can
	 * have a label and a doc-comment.
	 */
	export class ParameterInformation {

		/**
		 * The label of this signature.
		 *
		 * Either a string or inclusive start and exclusive end offsets within its containing
		 * [signature label](#SignatureInformation.label). *Note*: A label of type string must be
		 * a substring of its containing signature information's [label](#SignatureInformation.label).
		 */
		label: string | [number, number];

		/**
		 * The human-readable doc-comment of this signature. Will be shown
		 * in the UI but can be omitted.
		 */
		documentation?: string | MarkdownString;

		/**
		 * Creates a new parameter information object.
		 *
		 * @param label A label string or inclusive start and exclusive end offsets within its containing signature label.
		 * @param documentation A doc string.
		 */
		constructor(label: string | [number, number], documentation?: string | MarkdownString);
	}

	/**
	 * Represents the signature of something callable. A signature
	 * can have a label, like a function-name, a doc-comment, and
	 * a set of parameters.
	 */
	export class SignatureInformation {

		/**
		 * The label of this signature. Will be shown in
		 * the UI.
		 */
		label: string;

		/**
		 * The human-readable doc-comment of this signature. Will be shown
		 * in the UI but can be omitted.
		 */
		documentation?: string | MarkdownString;

		/**
		 * The parameters of this signature.
		 */
		parameters: ParameterInformation[];

		/**
		 * The index of the active parameter.
		 *
		 * If provided, this is used in place of [`SignatureHelp.activeSignature`](#SignatureHelp.activeSignature).
		 */
		activeParameter?: number;

		/**
		 * Creates a new signature information object.
		 *
		 * @param label A label string.
		 * @param documentation A doc string.
		 */
		constructor(label: string, documentation?: string | MarkdownString);
	}

	/**
	 * Signature help represents the signature of something
	 * callable. There can be multiple signatures but only one
	 * active and only one active parameter.
	 */
	export class SignatureHelp {

		/**
		 * One or more signatures.
		 */
		signatures: SignatureInformation[];

		/**
		 * The active signature.
		 */
		activeSignature: number;

		/**
		 * The active parameter of the active signature.
		 */
		activeParameter: number;
	}

	/**
	 * How a [`SignatureHelpProvider`](#SignatureHelpProvider) was triggered.
	 */
	export enum SignatureHelpTriggerKind {
		/**
		 * Signature help was invoked manually by the user or by a command.
		 */
		Invoke = 1,

		/**
		 * Signature help was triggered by a trigger character.
		 */
		TriggerCharacter = 2,

		/**
		 * Signature help was triggered by the cursor moving or by the document content changing.
		 */
		ContentChange = 3,
	}

	/**
	 * Additional information about the context in which a
	 * [`SignatureHelpProvider`](#SignatureHelpProvider.provideSignatureHelp) was triggered.
	 */
	export interface SignatureHelpContext {
		/**
		 * Action that caused signature help to be triggered.
		 */
		readonly triggerKind: SignatureHelpTriggerKind;

		/**
		 * Character that caused signature help to be triggered.
		 *
		 * This is `undefined` when signature help is not triggered by typing, such as when manually invoking
		 * signature help or when moving the cursor.
		 */
		readonly triggerCharacter?: string;

		/**
		 * `true` if signature help was already showing when it was triggered.
		 *
		 * Retriggers occur when the signature help is already active and can be caused by actions such as
		 * typing a trigger character, a cursor move, or document content changes.
		 */
		readonly isRetrigger: boolean;

		/**
		 * The currently active [`SignatureHelp`](#SignatureHelp).
		 *
		 * The `activeSignatureHelp` has its [`SignatureHelp.activeSignature`] field updated based on
		 * the user arrowing through available signatures.
		 */
		readonly activeSignatureHelp?: SignatureHelp;
	}

	/**
	 * The signature help provider interface defines the contract between extensions and
	 * the [parameter hints](https://code.visualstudio.com/docs/editor/intellisense)-feature.
	 */
	export interface SignatureHelpProvider {

		/**
		 * Provide help for the signature at the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @param context Information about how signature help was triggered.
		 *
		 * @return Signature help or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken, context: SignatureHelpContext): ProviderResult<SignatureHelp>;
	}

	/**
	 * Metadata about a registered [`SignatureHelpProvider`](#SignatureHelpProvider).
	 */
	export interface SignatureHelpProviderMetadata {
		/**
		 * List of characters that trigger signature help.
		 */
		readonly triggerCharacters: ReadonlyArray<string>;

		/**
		 * List of characters that re-trigger signature help.
		 *
		 * These trigger characters are only active when signature help is already showing. All trigger characters
		 * are also counted as re-trigger characters.
		 */
		readonly retriggerCharacters: ReadonlyArray<string>;
	}

	/**
	 * Completion item kinds.
	 */
	export enum CompletionItemKind {
		Text = 0,
		Method = 1,
		Function = 2,
		Constructor = 3,
		Field = 4,
		Variable = 5,
		Class = 6,
		Interface = 7,
		Module = 8,
		Property = 9,
		Unit = 10,
		Value = 11,
		Enum = 12,
		Keyword = 13,
		Snippet = 14,
		Color = 15,
		Reference = 17,
		File = 16,
		Folder = 18,
		EnumMember = 19,
		Constant = 20,
		Struct = 21,
		Event = 22,
		Operator = 23,
		TypeParameter = 24,
		User = 25,
		Issue = 26,
	}

	/**
	 * Completion item tags are extra annotations that tweak the rendering of a completion
	 * item.
	 */
	export enum CompletionItemTag {
		/**
		 * Render a completion as obsolete, usually using a strike-out.
		 */
		Deprecated = 1
	}

	/**
	 * A completion item represents a text snippet that is proposed to complete text that is being typed.
	 *
	 * It is sufficient to create a completion item from just a [label](#CompletionItem.label). In that
	 * case the completion item will replace the [word](#TextDocument.getWordRangeAtPosition)
	 * until the cursor with the given label or [insertText](#CompletionItem.insertText). Otherwise the
	 * given [edit](#CompletionItem.textEdit) is used.
	 *
	 * When selecting a completion item in the editor its defined or synthesized text edit will be applied
	 * to *all* cursors/selections whereas [additionalTextEdits](#CompletionItem.additionalTextEdits) will be
	 * applied as provided.
	 *
	 * @see [CompletionItemProvider.provideCompletionItems](#CompletionItemProvider.provideCompletionItems)
	 * @see [CompletionItemProvider.resolveCompletionItem](#CompletionItemProvider.resolveCompletionItem)
	 */
	export class CompletionItem {

		/**
		 * The label of this completion item. By default
		 * this is also the text that is inserted when selecting
		 * this completion.
		 */
		label: string;

		/**
		 * The kind of this completion item. Based on the kind
		 * an icon is chosen by the editor.
		 */
		kind?: CompletionItemKind;

		/**
		 * Tags for this completion item.
		 */
		tags?: ReadonlyArray<CompletionItemTag>;

		/**
		 * A human-readable string with additional information
		 * about this item, like type or symbol information.
		 */
		detail?: string;

		/**
		 * A human-readable string that represents a doc-comment.
		 */
		documentation?: string | MarkdownString;

		/**
		 * A string that should be used when comparing this item
		 * with other items. When `falsy` the [label](#CompletionItem.label)
		 * is used.
		 *
		 * Note that `sortText` is only used for the initial ordering of completion
		 * items. When having a leading word (prefix) ordering is based on how
		 * well completion match that prefix and the initial ordering is only used
		 * when completions match equal. The prefix is defined by the
		 * [`range`](#CompletionItem.range)-property and can therefore be different
		 * for each completion.
		 */
		sortText?: string;

		/**
		 * A string that should be used when filtering a set of
		 * completion items. When `falsy` the [label](#CompletionItem.label)
		 * is used.
		 *
		 * Note that the filter text is matched against the leading word (prefix) which is defined
		 * by the [`range`](#CompletionItem.range)-property.
		 * prefix.
		 */
		filterText?: string;

		/**
		 * Select this item when showing. *Note* that only one completion item can be selected and
		 * that the editor decides which item that is. The rule is that the *first* item of those
		 * that match best is selected.
		 */
		preselect?: boolean;

		/**
		 * A string or snippet that should be inserted in a document when selecting
		 * this completion. When `falsy` the [label](#CompletionItem.label)
		 * is used.
		 */
		insertText?: string | SnippetString;

		/**
		 * A range or a insert and replace range selecting the text that should be replaced by this completion item.
		 *
		 * When omitted, the range of the [current word](#TextDocument.getWordRangeAtPosition) is used as replace-range
		 * and as insert-range the start of the [current word](#TextDocument.getWordRangeAtPosition) to the
		 * current position is used.
		 *
		 * *Note 1:* A range must be a [single line](#Range.isSingleLine) and it must
		 * [contain](#Range.contains) the position at which completion has been [requested](#CompletionItemProvider.provideCompletionItems).
		 * *Note 2:* A insert range must be a prefix of a replace range, that means it must be contained and starting at the same position.
		 */
		range?: Range | { inserting: Range; replacing: Range; };

		/**
		 * An optional set of characters that when pressed while this completion is active will accept it first and
		 * then type that character. *Note* that all commit characters should have `length=1` and that superfluous
		 * characters will be ignored.
		 */
		commitCharacters?: string[];

		/**
		 * Keep whitespace of the [insertText](#CompletionItem.insertText) as is. By default, the editor adjusts leading
		 * whitespace of new lines so that they match the indentation of the line for which the item is accepted - setting
		 * this to `true` will prevent that.
		 */
		keepWhitespace?: boolean;

		/**
		 * @deprecated Use `CompletionItem.insertText` and `CompletionItem.range` instead.
		 *
		 * An [edit](#TextEdit) which is applied to a document when selecting
		 * this completion. When an edit is provided the value of
		 * [insertText](#CompletionItem.insertText) is ignored.
		 *
		 * The [range](#Range) of the edit must be single-line and on the same
		 * line completions were [requested](#CompletionItemProvider.provideCompletionItems) at.
		 */
		textEdit?: TextEdit;

		/**
		 * An optional array of additional [text edits](#TextEdit) that are applied when
		 * selecting this completion. Edits must not overlap with the main [edit](#CompletionItem.textEdit)
		 * nor with themselves.
		 */
		additionalTextEdits?: TextEdit[];

		/**
		 * An optional [command](#Command) that is executed *after* inserting this completion. *Note* that
		 * additional modifications to the current document should be described with the
		 * [additionalTextEdits](#CompletionItem.additionalTextEdits)-property.
		 */
		command?: Command;

		/**
		 * Creates a new completion item.
		 *
		 * Completion items must have at least a [label](#CompletionItem.label) which then
		 * will be used as insert text as well as for sorting and filtering.
		 *
		 * @param label The label of the completion.
		 * @param kind The [kind](#CompletionItemKind) of the completion.
		 */
		constructor(label: string, kind?: CompletionItemKind);
	}

	/**
	 * Represents a collection of [completion items](#CompletionItem) to be presented
	 * in the editor.
	 */
	export class CompletionList<T extends CompletionItem = CompletionItem> {

		/**
		 * This list is not complete. Further typing should result in recomputing
		 * this list.
		 */
		isIncomplete?: boolean;

		/**
		 * The completion items.
		 */
		items: T[];

		/**
		 * Creates a new completion list.
		 *
		 * @param items The completion items.
		 * @param isIncomplete The list is not complete.
		 */
		constructor(items?: T[], isIncomplete?: boolean);
	}

	/**
	 * How a [completion provider](#CompletionItemProvider) was triggered
	 */
	export enum CompletionTriggerKind {
		/**
		 * Completion was triggered normally.
		 */
		Invoke = 0,
		/**
		 * Completion was triggered by a trigger character.
		 */
		TriggerCharacter = 1,
		/**
		 * Completion was re-triggered as current completion list is incomplete
		 */
		TriggerForIncompleteCompletions = 2
	}

	/**
	 * Contains additional information about the context in which
	 * [completion provider](#CompletionItemProvider.provideCompletionItems) is triggered.
	 */
	export interface CompletionContext {
		/**
		 * How the completion was triggered.
		 */
		readonly triggerKind: CompletionTriggerKind;

		/**
		 * Character that triggered the completion item provider.
		 *
		 * `undefined` if provider was not triggered by a character.
		 *
		 * The trigger character is already in the document when the completion provider is triggered.
		 */
		readonly triggerCharacter?: string;
	}

	/**
	 * The completion item provider interface defines the contract between extensions and
	 * [IntelliSense](https://code.visualstudio.com/docs/editor/intellisense).
	 *
	 * Providers can delay the computation of the [`detail`](#CompletionItem.detail)
	 * and [`documentation`](#CompletionItem.documentation) properties by implementing the
	 * [`resolveCompletionItem`](#CompletionItemProvider.resolveCompletionItem)-function. However, properties that
	 * are needed for the initial sorting and filtering, like `sortText`, `filterText`, `insertText`, and `range`, must
	 * not be changed during resolve.
	 *
	 * Providers are asked for completions either explicitly by a user gesture or -depending on the configuration-
	 * implicitly when typing words or trigger characters.
	 */
	export interface CompletionItemProvider<T extends CompletionItem = CompletionItem> {

		/**
		 * Provide completion items for the given position and document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @param context How the completion was triggered.
		 *
		 * @return An array of completions, a [completion list](#CompletionList), or a thenable that resolves to either.
		 * The lack of a result can be signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<T[] | CompletionList<T>>;

		/**
		 * Given a completion item fill in more data, like [doc-comment](#CompletionItem.documentation)
		 * or [details](#CompletionItem.detail).
		 *
		 * The editor will only resolve a completion item once.
		 *
		 * *Note* that this function is called when completion items are already showing in the UI or when an item has been
		 * selected for insertion. Because of that, no property that changes the presentation (label, sorting, filtering etc)
		 * or the (primary) insert behaviour ([insertText](#CompletionItem.insertText)) can be changed.
		 *
		 * This function may fill in [additionalTextEdits](#CompletionItem.additionalTextEdits). However, that means an item might be
		 * inserted *before* resolving is done and in that case the editor will do a best effort to still apply those additional
		 * text edits.
		 *
		 * @param item A completion item currently active in the UI.
		 * @param token A cancellation token.
		 * @return The resolved completion item or a thenable that resolves to of such. It is OK to return the given
		 * `item`. When no result is returned, the given `item` will be used.
		 */
		resolveCompletionItem?(item: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * A document link is a range in a text document that links to an internal or external resource, like another
	 * text document or a web site.
	 */
	export class DocumentLink {

		/**
		 * The range this link applies to.
		 */
		range: Range;

		/**
		 * The uri this link points to.
		 */
		target?: Uri;

		/**
		 * The tooltip text when you hover over this link.
		 *
		 * If a tooltip is provided, is will be displayed in a string that includes instructions on how to
		 * trigger the link, such as `{0} (ctrl + click)`. The specific instructions vary depending on OS,
		 * user settings, and localization.
		 */
		tooltip?: string;

		/**
		 * Creates a new document link.
		 *
		 * @param range The range the document link applies to. Must not be empty.
		 * @param target The uri the document link points to.
		 */
		constructor(range: Range, target?: Uri);
	}

	/**
	 * The document link provider defines the contract between extensions and feature of showing
	 * links in the editor.
	 */
	export interface DocumentLinkProvider<T extends DocumentLink = DocumentLink> {

		/**
		 * Provide links for the given document. Note that the editor ships with a default provider that detects
		 * `http(s)` and `file` links.
		 *
		 * @param document The document in which the command was invoked.
		 * @param token A cancellation token.
		 * @return An array of [document links](#DocumentLink) or a thenable that resolves to such. The lack of a result
		 * can be signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideDocumentLinks(document: TextDocument, token: CancellationToken): ProviderResult<T[]>;

		/**
		 * Given a link fill in its [target](#DocumentLink.target). This method is called when an incomplete
		 * link is selected in the UI. Providers can implement this method and return incomplete links
		 * (without target) from the [`provideDocumentLinks`](#DocumentLinkProvider.provideDocumentLinks) method which
		 * often helps to improve performance.
		 *
		 * @param link The link that is to be resolved.
		 * @param token A cancellation token.
		 */
		resolveDocumentLink?(link: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * Represents a color in RGBA space.
	 */
	export class Color {

		/**
		 * The red component of this color in the range [0-1].
		 */
		readonly red: number;

		/**
		 * The green component of this color in the range [0-1].
		 */
		readonly green: number;

		/**
		 * The blue component of this color in the range [0-1].
		 */
		readonly blue: number;

		/**
		 * The alpha component of this color in the range [0-1].
		 */
		readonly alpha: number;

		/**
		 * Creates a new color instance.
		 *
		 * @param red The red component.
		 * @param green The green component.
		 * @param blue The blue component.
		 * @param alpha The alpha component.
		 */
		constructor(red: number, green: number, blue: number, alpha: number);
	}

	/**
	 * Represents a color range from a document.
	 */
	export class ColorInformation {

		/**
		 * The range in the document where this color appears.
		 */
		range: Range;

		/**
		 * The actual color value for this color range.
		 */
		color: Color;

		/**
		 * Creates a new color range.
		 *
		 * @param range The range the color appears in. Must not be empty.
		 * @param color The value of the color.
		 * @param format The format in which this color is currently formatted.
		 */
		constructor(range: Range, color: Color);
	}

	/**
	 * A color presentation object describes how a [`color`](#Color) should be represented as text and what
	 * edits are required to refer to it from source code.
	 *
	 * For some languages one color can have multiple presentations, e.g. css can represent the color red with
	 * the constant `Red`, the hex-value `#ff0000`, or in rgba and hsla forms. In csharp other representations
	 * apply, e.g. `System.Drawing.Color.Red`.
	 */
	export class ColorPresentation {

		/**
		 * The label of this color presentation. It will be shown on the color
		 * picker header. By default this is also the text that is inserted when selecting
		 * this color presentation.
		 */
		label: string;

		/**
		 * An [edit](#TextEdit) which is applied to a document when selecting
		 * this presentation for the color.  When `falsy` the [label](#ColorPresentation.label)
		 * is used.
		 */
		textEdit?: TextEdit;

		/**
		 * An optional array of additional [text edits](#TextEdit) that are applied when
		 * selecting this color presentation. Edits must not overlap with the main [edit](#ColorPresentation.textEdit) nor with themselves.
		 */
		additionalTextEdits?: TextEdit[];

		/**
		 * Creates a new color presentation.
		 *
		 * @param label The label of this color presentation.
		 */
		constructor(label: string);
	}

	/**
	 * The document color provider defines the contract between extensions and feature of
	 * picking and modifying colors in the editor.
	 */
	export interface DocumentColorProvider {

		/**
		 * Provide colors for the given document.
		 *
		 * @param document The document in which the command was invoked.
		 * @param token A cancellation token.
		 * @return An array of [color information](#ColorInformation) or a thenable that resolves to such. The lack of a result
		 * can be signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideDocumentColors(document: TextDocument, token: CancellationToken): ProviderResult<ColorInformation[]>;

		/**
		 * Provide [representations](#ColorPresentation) for a color.
		 *
		 * @param color The color to show and insert.
		 * @param context A context object with additional information
		 * @param token A cancellation token.
		 * @return An array of color presentations or a thenable that resolves to such. The lack of a result
		 * can be signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideColorPresentations(color: Color, context: { document: TextDocument, range: Range }, token: CancellationToken): ProviderResult<ColorPresentation[]>;
	}

	/**
	 * A line based folding range. To be valid, start and end line must be bigger than zero and smaller than the number of lines in the document.
	 * Invalid ranges will be ignored.
	 */
	export class FoldingRange {

		/**
		 * The zero-based start line of the range to fold. The folded area starts after the line's last character.
		 * To be valid, the end must be zero or larger and smaller than the number of lines in the document.
		 */
		start: number;

		/**
		 * The zero-based end line of the range to fold. The folded area ends with the line's last character.
		 * To be valid, the end must be zero or larger and smaller than the number of lines in the document.
		 */
		end: number;

		/**
		 * Describes the [Kind](#FoldingRangeKind) of the folding range such as [Comment](#FoldingRangeKind.Comment) or
		 * [Region](#FoldingRangeKind.Region). The kind is used to categorize folding ranges and used by commands
		 * like 'Fold all comments'. See
		 * [FoldingRangeKind](#FoldingRangeKind) for an enumeration of all kinds.
		 * If not set, the range is originated from a syntax element.
		 */
		kind?: FoldingRangeKind;

		/**
		 * Creates a new folding range.
		 *
		 * @param start The start line of the folded range.
		 * @param end The end line of the folded range.
		 * @param kind The kind of the folding range.
		 */
		constructor(start: number, end: number, kind?: FoldingRangeKind);
	}

	/**
	 * An enumeration of specific folding range kinds. The kind is an optional field of a [FoldingRange](#FoldingRange)
	 * and is used to distinguish specific folding ranges such as ranges originated from comments. The kind is used by commands like
	 * `Fold all comments` or `Fold all regions`.
	 * If the kind is not set on the range, the range originated from a syntax element other than comments, imports or region markers.
	 */
	export enum FoldingRangeKind {
		/**
		 * Kind for folding range representing a comment.
		 */
		Comment = 1,
		/**
		 * Kind for folding range representing a import.
		 */
		Imports = 2,
		/**
		 * Kind for folding range representing regions originating from folding markers like `#region` and `#endregion`.
		 */
		Region = 3
	}

	/**
	 * Folding context (for future use)
	 */
	export interface FoldingContext {
	}

	/**
	 * The folding range provider interface defines the contract between extensions and
	 * [Folding](https://code.visualstudio.com/docs/editor/codebasics#_folding) in the editor.
	 */
	export interface FoldingRangeProvider {

		/**
		 * An optional event to signal that the folding ranges from this provider have changed.
		 */
		onDidChangeFoldingRanges?: Event<void>;

		/**
		 * Returns a list of folding ranges or null and undefined if the provider
		 * does not want to participate or was cancelled.
		 * @param document The document in which the command was invoked.
		 * @param context Additional context information (for future use)
		 * @param token A cancellation token.
		 */
		provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]>;
	}

	/**
	 * A selection range represents a part of a selection hierarchy. A selection range
	 * may have a parent selection range that contains it.
	 */
	export class SelectionRange {

		/**
		 * The [range](#Range) of this selection range.
		 */
		range: Range;

		/**
		 * The parent selection range containing this range.
		 */
		parent?: SelectionRange;

		/**
		 * Creates a new selection range.
		 *
		 * @param range The range of the selection range.
		 * @param parent The parent of the selection range.
		 */
		constructor(range: Range, parent?: SelectionRange);
	}

	export interface SelectionRangeProvider {
		/**
		 * Provide selection ranges for the given positions.
		 *
		 * Selection ranges should be computed individually and independent for each position. The editor will merge
		 * and deduplicate ranges but providers must return hierarchies of selection ranges so that a range
		 * is [contained](#Range.contains) by its parent.
		 *
		 * @param document The document in which the command was invoked.
		 * @param positions The positions at which the command was invoked.
		 * @param token A cancellation token.
		 * @return Selection ranges or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideSelectionRanges(document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>;
	}

	/**
	 * Represents programming constructs like functions or constructors in the context
	 * of call hierarchy.
	 */
	export class CallHierarchyItem {
		/**
		 * The name of this item.
		 */
		name: string;

		/**
		 * The kind of this item.
		 */
		kind: SymbolKind;

		/**
		 * Tags for this item.
		 */
		tags?: ReadonlyArray<SymbolTag>;

		/**
		 * More detail for this item, e.g. the signature of a function.
		 */
		detail?: string;

		/**
		 * The resource identifier of this item.
		 */
		uri: Uri;

		/**
		 * The range enclosing this symbol not including leading/trailing whitespace but everything else, e.g. comments and code.
		 */
		range: Range;

		/**
		 * The range that should be selected and revealed when this symbol is being picked, e.g. the name of a function.
		 * Must be contained by the [`range`](#CallHierarchyItem.range).
		 */
		selectionRange: Range;

		/**
		 * Creates a new call hierarchy item.
		 */
		constructor(kind: SymbolKind, name: string, detail: string, uri: Uri, range: Range, selectionRange: Range);
	}

	/**
	 * Represents an incoming call, e.g. a caller of a method or constructor.
	 */
	export class CallHierarchyIncomingCall {

		/**
		 * The item that makes the call.
		 */
		from: CallHierarchyItem;

		/**
		 * The range at which at which the calls appears. This is relative to the caller
		 * denoted by [`this.from`](#CallHierarchyIncomingCall.from).
		 */
		fromRanges: Range[];

		/**
		 * Create a new call object.
		 *
		 * @param item The item making the call.
		 * @param fromRanges The ranges at which the calls appear.
		 */
		constructor(item: CallHierarchyItem, fromRanges: Range[]);
	}

	/**
	 * Represents an outgoing call, e.g. calling a getter from a method or a method from a constructor etc.
	 */
	export class CallHierarchyOutgoingCall {

		/**
		 * The item that is called.
		 */
		to: CallHierarchyItem;

		/**
		 * The range at which this item is called. This is the range relative to the caller, e.g the item
		 * passed to [`provideCallHierarchyOutgoingCalls`](#CallHierarchyProvider.provideCallHierarchyOutgoingCalls)
		 * and not [`this.to`](#CallHierarchyOutgoingCall.to).
		 */
		fromRanges: Range[];

		/**
		 * Create a new call object.
		 *
		 * @param item The item being called
		 * @param fromRanges The ranges at which the calls appear.
		 */
		constructor(item: CallHierarchyItem, fromRanges: Range[]);
	}

	/**
	 * The call hierarchy provider interface describes the contract between extensions
	 * and the call hierarchy feature which allows to browse calls and caller of function,
	 * methods, constructor etc.
	 */
	export interface CallHierarchyProvider {

		/**
		 * Bootstraps call hierarchy by returning the item that is denoted by the given document
		 * and position. This item will be used as entry into the call graph. Providers should
		 * return `undefined` or `null` when there is no item at the given location.
		 *
		 * @param document The document in which the command was invoked.
		 * @param position The position at which the command was invoked.
		 * @param token A cancellation token.
		 * @returns A call hierarchy item or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		prepareCallHierarchy(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<CallHierarchyItem | CallHierarchyItem[]>;

		/**
		 * Provide all incoming calls for an item, e.g all callers for a method. In graph terms this describes directed
		 * and annotated edges inside the call graph, e.g the given item is the starting node and the result is the nodes
		 * that can be reached.
		 *
		 * @param item The hierarchy item for which incoming calls should be computed.
		 * @param token A cancellation token.
		 * @returns A set of incoming calls or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideCallHierarchyIncomingCalls(item: CallHierarchyItem, token: CancellationToken): ProviderResult<CallHierarchyIncomingCall[]>;

		/**
		 * Provide all outgoing calls for an item, e.g call calls to functions, methods, or constructors from the given item. In
		 * graph terms this describes directed and annotated edges inside the call graph, e.g the given item is the starting
		 * node and the result is the nodes that can be reached.
		 *
		 * @param item The hierarchy item for which outgoing calls should be computed.
		 * @param token A cancellation token.
		 * @returns A set of outgoing calls or a thenable that resolves to such. The lack of a result can be
		 * signaled by returning `undefined` or `null`.
		 */
		provideCallHierarchyOutgoingCalls(item: CallHierarchyItem, token: CancellationToken): ProviderResult<CallHierarchyOutgoingCall[]>;
	}

	/**
	 * Represents a list of ranges that can be edited together along with a word pattern to describe valid range contents.
	 */
	export class LinkedEditingRanges {
		/**
		 * Create a new linked editing ranges object.
		 *
		 * @param ranges A list of ranges that can be edited together
		 * @param wordPattern An optional word pattern that describes valid contents for the given ranges
		 */
		constructor(ranges: Range[], wordPattern?: RegExp);

		/**
		 * A list of ranges that can be edited together. The ranges must have
		 * identical length and text content. The ranges cannot overlap.
		 */
		readonly ranges: Range[];

		/**
		 * An optional word pattern that describes valid contents for the given ranges.
		 * If no pattern is provided, the language configuration's word pattern will be used.
		 */
		readonly wordPattern?: RegExp;
	}

	/**
	 * The linked editing range provider interface defines the contract between extensions and
	 * the linked editing feature.
	 */
	export interface LinkedEditingRangeProvider {
		/**
		 * For a given position in a document, returns the range of the symbol at the position and all ranges
		 * that have the same content. A change to one of the ranges can be applied to all other ranges if the new content
		 * is valid. An optional word pattern can be returned with the result to describe valid contents.
		 * If no result-specific word pattern is provided, the word pattern from the language configuration is used.
		 *
		 * @param document The document in which the provider was invoked.
		 * @param position The position at which the provider was invoked.
		 * @param token A cancellation token.
		 * @return A list of ranges that can be edited together
		 */
		provideLinkedEditingRanges(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<LinkedEditingRanges>;
	}

	/**
	 * A tuple of two characters, like a pair of
	 * opening and closing brackets.
	 */
	export type CharacterPair = [string, string];

	/**
	 * Describes how comments for a language work.
	 */
	export interface CommentRule {

		/**
		 * The line comment token, like `// this is a comment`
		 */
		lineComment?: string;

		/**
		 * The block comment character pair, like `/* block comment *&#47;`
		 */
		blockComment?: CharacterPair;
	}

	/**
	 * Describes indentation rules for a language.
	 */
	export interface IndentationRule {
		/**
		 * If a line matches this pattern, then all the lines after it should be unindented once (until another rule matches).
		 */
		decreaseIndentPattern: RegExp;
		/**
		 * If a line matches this pattern, then all the lines after it should be indented once (until another rule matches).
		 */
		increaseIndentPattern: RegExp;
		/**
		 * If a line matches this pattern, then **only the next line** after it should be indented once.
		 */
		indentNextLinePattern?: RegExp;
		/**
		 * If a line matches this pattern, then its indentation should not be changed and it should not be evaluated against the other rules.
		 */
		unIndentedLinePattern?: RegExp;
	}

	/**
	 * Describes what to do with the indentation when pressing Enter.
	 */
	export enum IndentAction {
		/**
		 * Insert new line and copy the previous line's indentation.
		 */
		None = 0,
		/**
		 * Insert new line and indent once (relative to the previous line's indentation).
		 */
		Indent = 1,
		/**
		 * Insert two new lines:
		 *  - the first one indented which will hold the cursor
		 *  - the second one at the same indentation level
		 */
		IndentOutdent = 2,
		/**
		 * Insert new line and outdent once (relative to the previous line's indentation).
		 */
		Outdent = 3
	}

	/**
	 * Describes what to do when pressing Enter.
	 */
	export interface EnterAction {
		/**
		 * Describe what to do with the indentation.
		 */
		indentAction: IndentAction;
		/**
		 * Describes text to be appended after the new line and after the indentation.
		 */
		appendText?: string;
		/**
		 * Describes the number of characters to remove from the new line's indentation.
		 */
		removeText?: number;
	}

	/**
	 * Describes a rule to be evaluated when pressing Enter.
	 */
	export interface OnEnterRule {
		/**
		 * This rule will only execute if the text before the cursor matches this regular expression.
		 */
		beforeText: RegExp;
		/**
		 * This rule will only execute if the text after the cursor matches this regular expression.
		 */
		afterText?: RegExp;
		/**
		 * The action to execute.
		 */
		action: EnterAction;
	}

	/**
	 * The language configuration interfaces defines the contract between extensions
	 * and various editor features, like automatic bracket insertion, automatic indentation etc.
	 */
	export interface LanguageConfiguration {
		/**
		 * The language's comment settings.
		 */
		comments?: CommentRule;
		/**
		 * The language's brackets.
		 * This configuration implicitly affects pressing Enter around these brackets.
		 */
		brackets?: CharacterPair[];
		/**
		 * The language's word definition.
		 * If the language supports Unicode identifiers (e.g. JavaScript), it is preferable
		 * to provide a word definition that uses exclusion of known separators.
		 * e.g.: A regex that matches anything except known separators (and dot is allowed to occur in a floating point number):
		 *   /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g
		 */
		wordPattern?: RegExp;
		/**
		 * The language's indentation settings.
		 */
		indentationRules?: IndentationRule;
		/**
		 * The language's rules to be evaluated when pressing Enter.
		 */
		onEnterRules?: OnEnterRule[];

		/**
		 * **Deprecated** Do not use.
		 *
		 * @deprecated Will be replaced by a better API soon.
		 */
		__electricCharacterSupport?: {
			/**
			 * This property is deprecated and will be **ignored** from
			 * the editor.
			 * @deprecated
			 */
			brackets?: any;
			/**
			 * This property is deprecated and not fully supported anymore by
			 * the editor (scope and lineStart are ignored).
			 * Use the autoClosingPairs property in the language configuration file instead.
			 * @deprecated
			 */
			docComment?: {
				scope: string;
				open: string;
				lineStart: string;
				close?: string;
			};
		};

		/**
		 * **Deprecated** Do not use.
		 *
		 * @deprecated * Use the autoClosingPairs property in the language configuration file instead.
		 */
		__characterPairSupport?: {
			autoClosingPairs: {
				open: string;
				close: string;
				notIn?: string[];
			}[];
		};
	}

	/**
	 * The configuration target
	 */
	export enum ConfigurationTarget {
		/**
		 * Global configuration
		*/
		Global = 1,

		/**
		 * Workspace configuration
		 */
		Workspace = 2,

		/**
		 * Workspace folder configuration
		 */
		WorkspaceFolder = 3
	}

	/**
	 * Represents the configuration. It is a merged view of
	 *
	 * - *Default Settings*
	 * - *Global (User) Settings*
	 * - *Workspace settings*
	 * - *Workspace Folder settings* - From one of the [Workspace Folders](#workspace.workspaceFolders) under which requested resource belongs to.
	 * - *Language settings* - Settings defined under requested language.
	 *
	 * The *effective* value (returned by [`get`](#WorkspaceConfiguration.get)) is computed by overriding or merging the values in the following order.
	 *
	 * ```
	 * `defaultValue` (if defined in `package.json` otherwise derived from the value's type)
	 * `globalValue` (if defined)
	 * `workspaceValue` (if defined)
	 * `workspaceFolderValue` (if defined)
	 * `defaultLanguageValue` (if defined)
	 * `globalLanguageValue` (if defined)
	 * `workspaceLanguageValue` (if defined)
	 * `workspaceFolderLanguageValue` (if defined)
	 * ```
	 * **Note:** Only `object` value types are merged and all other value types are overridden.
	 *
	 * Example 1: Overriding
	 *
	 * ```ts
	 * defaultValue = 'on';
	 * globalValue = 'relative'
	 * workspaceFolderValue = 'off'
	 * value = 'off'
	 * ```
	 *
	 * Example 2: Language Values
	 *
	 * ```ts
	 * defaultValue = 'on';
	 * globalValue = 'relative'
	 * workspaceFolderValue = 'off'
	 * globalLanguageValue = 'on'
	 * value = 'on'
	 * ```
	 *
	 * Example 3: Object Values
	 *
	 * ```ts
	 * defaultValue = { "a": 1, "b": 2 };
	 * globalValue = { "b": 3, "c": 4 };
	 * value = { "a": 1, "b": 3, "c": 4 };
	 * ```
	 *
	 * *Note:* Workspace and Workspace Folder configurations contains `launch` and `tasks` settings. Their basename will be
	 * part of the section identifier. The following snippets shows how to retrieve all configurations
	 * from `launch.json`:
	 *
	 * ```ts
	 * // launch.json configuration
	 * const config = workspace.getConfiguration('launch', vscode.workspace.workspaceFolders[0].uri);
	 *
	 * // retrieve values
	 * const values = config.get('configurations');
	 * ```
	 *
	 * Refer to [Settings](https://code.visualstudio.com/docs/getstarted/settings) for more information.
	 */
	export interface WorkspaceConfiguration {

		/**
		 * Return a value from this configuration.
		 *
		 * @param section Configuration name, supports _dotted_ names.
		 * @return The value `section` denotes or `undefined`.
		 */
		get<T>(section: string): T | undefined;

		/**
		 * Return a value from this configuration.
		 *
		 * @param section Configuration name, supports _dotted_ names.
		 * @param defaultValue A value should be returned when no value could be found, is `undefined`.
		 * @return The value `section` denotes or the default.
		 */
		get<T>(section: string, defaultValue: T): T;

		/**
		 * Check if this configuration has a certain value.
		 *
		 * @param section Configuration name, supports _dotted_ names.
		 * @return `true` if the section doesn't resolve to `undefined`.
		 */
		has(section: string): boolean;

		/**
		 * Retrieve all information about a configuration setting. A configuration value
		 * often consists of a *default* value, a global or installation-wide value,
		 * a workspace-specific value, folder-specific value
		 * and language-specific values (if [WorkspaceConfiguration](#WorkspaceConfiguration) is scoped to a language).
		 *
		 * Also provides all language ids under which the given configuration setting is defined.
		 *
		 * *Note:* The configuration name must denote a leaf in the configuration tree
		 * (`editor.fontSize` vs `editor`) otherwise no result is returned.
		 *
		 * @param section Configuration name, supports _dotted_ names.
		 * @return Information about a configuration setting or `undefined`.
		 */
		inspect<T>(section: string): {
			key: string;

			defaultValue?: T;
			globalValue?: T;
			workspaceValue?: T,
			workspaceFolderValue?: T,

			defaultLanguageValue?: T;
			globalLanguageValue?: T;
			workspaceLanguageValue?: T;
			workspaceFolderLanguageValue?: T;

			languageIds?: string[];

		} | undefined;

		/**
		 * Update a configuration value. The updated configuration values are persisted.
		 *
		 * A value can be changed in
		 *
		 * - [Global settings](#ConfigurationTarget.Global): Changes the value for all instances of the editor.
		 * - [Workspace settings](#ConfigurationTarget.Workspace): Changes the value for current workspace, if available.
		 * - [Workspace folder settings](#ConfigurationTarget.WorkspaceFolder): Changes the value for settings from one of the [Workspace Folders](#workspace.workspaceFolders) under which the requested resource belongs to.
		 * - Language settings: Changes the value for the requested languageId.
		 *
		 * *Note:* To remove a configuration value use `undefined`, like so: `config.update('somekey', undefined)`
		 *
		 * @param section Configuration name, supports _dotted_ names.
		 * @param value The new value.
		 * @param configurationTarget The [configuration target](#ConfigurationTarget) or a boolean value.
		 *	- If `true` updates [Global settings](#ConfigurationTarget.Global).
		 *	- If `false` updates [Workspace settings](#ConfigurationTarget.Workspace).
		 *	- If `undefined` or `null` updates to [Workspace folder settings](#ConfigurationTarget.WorkspaceFolder) if configuration is resource specific,
		 * 	otherwise to [Workspace settings](#ConfigurationTarget.Workspace).
		 * @param overrideInLanguage Whether to update the value in the scope of requested languageId or not.
		 *	- If `true` updates the value under the requested languageId.
		 *	- If `undefined` updates the value under the requested languageId only if the configuration is defined for the language.
		 * @throws error while updating
		 *	- configuration which is not registered.
		 *	- window configuration to workspace folder
		 *	- configuration to workspace or workspace folder when no workspace is opened.
		 *	- configuration to workspace folder when there is no workspace folder settings.
		 *	- configuration to workspace folder when [WorkspaceConfiguration](#WorkspaceConfiguration) is not scoped to a resource.
		 */
		update(section: string, value: any, configurationTarget?: ConfigurationTarget | boolean, overrideInLanguage?: boolean): Thenable<void>;

		/**
		 * Readable dictionary that backs this configuration.
		 */
		readonly [key: string]: any;
	}

	/**
	 * Represents a location inside a resource, such as a line
	 * inside a text file.
	 */
	export class Location {

		/**
		 * The resource identifier of this location.
		 */
		uri: Uri;

		/**
		 * The document range of this location.
		 */
		range: Range;

		/**
		 * Creates a new location object.
		 *
		 * @param uri The resource identifier.
		 * @param rangeOrPosition The range or position. Positions will be converted to an empty range.
		 */
		constructor(uri: Uri, rangeOrPosition: Range | Position);
	}

	/**
	 * Represents the connection of two locations. Provides additional metadata over normal [locations](#Location),
	 * including an origin range.
	 */
	export interface LocationLink {
		/**
		 * Span of the origin of this link.
		 *
		 * Used as the underlined span for mouse definition hover. Defaults to the word range at
		 * the definition position.
		 */
		originSelectionRange?: Range;

		/**
		 * The target resource identifier of this link.
		 */
		targetUri: Uri;

		/**
		 * The full target range of this link.
		 */
		targetRange: Range;

		/**
		 * The span of this link.
		 */
		targetSelectionRange?: Range;
	}

	/**
	 * The event that is fired when diagnostics change.
	 */
	export interface DiagnosticChangeEvent {

		/**
		 * An array of resources for which diagnostics have changed.
		 */
		readonly uris: ReadonlyArray<Uri>;
	}

	/**
	 * Represents the severity of diagnostics.
	 */
	export enum DiagnosticSeverity {

		/**
		 * Something not allowed by the rules of a language or other means.
		 */
		Error = 0,

		/**
		 * Something suspicious but allowed.
		 */
		Warning = 1,

		/**
		 * Something to inform about but not a problem.
		 */
		Information = 2,

		/**
		 * Something to hint to a better way of doing it, like proposing
		 * a refactoring.
		 */
		Hint = 3
	}

	/**
	 * Represents a related message and source code location for a diagnostic. This should be
	 * used to point to code locations that cause or related to a diagnostics, e.g. when duplicating
	 * a symbol in a scope.
	 */
	export class DiagnosticRelatedInformation {

		/**
		 * The location of this related diagnostic information.
		 */
		location: Location;

		/**
		 * The message of this related diagnostic information.
		 */
		message: string;

		/**
		 * Creates a new related diagnostic information object.
		 *
		 * @param location The location.
		 * @param message The message.
		 */
		constructor(location: Location, message: string);
	}

	/**
	 * Additional metadata about the type of a diagnostic.
	 */
	export enum DiagnosticTag {
		/**
		 * Unused or unnecessary code.
		 *
		 * Diagnostics with this tag are rendered faded out. The amount of fading
		 * is controlled by the `"editorUnnecessaryCode.opacity"` theme color. For
		 * example, `"editorUnnecessaryCode.opacity": "#000000c0"` will render the
		 * code with 75% opacity. For high contrast themes, use the
		 * `"editorUnnecessaryCode.border"` theme color to underline unnecessary code
		 * instead of fading it out.
		 */
		Unnecessary = 1,

		/**
		 * Deprecated or obsolete code.
		 *
		 * Diagnostics with this tag are rendered with a strike through.
		 */
		Deprecated = 2,
	}

	/**
	 * Represents a diagnostic, such as a compiler error or warning. Diagnostic objects
	 * are only valid in the scope of a file.
	 */
	export class Diagnostic {

		/**
		 * The range to which this diagnostic applies.
		 */
		range: Range;

		/**
		 * The human-readable message.
		 */
		message: string;

		/**
		 * The severity, default is [error](#DiagnosticSeverity.Error).
		 */
		severity: DiagnosticSeverity;

		/**
		 * A human-readable string describing the source of this
		 * diagnostic, e.g. 'typescript' or 'super lint'.
		 */
		source?: string;

		/**
		 * A code or identifier for this diagnostic.
		 * Should be used for later processing, e.g. when providing [code actions](#CodeActionContext).
		 */
		code?: string | number | {
			/**
			 * A code or identifier for this diagnostic.
			 * Should be used for later processing, e.g. when providing [code actions](#CodeActionContext).
			 */
			value: string | number;

			/**
			 * A target URI to open with more information about the diagnostic error.
			 */
			target: Uri;
		};

		/**
		 * An array of related diagnostic information, e.g. when symbol-names within
		 * a scope collide all definitions can be marked via this property.
		 */
		relatedInformation?: DiagnosticRelatedInformation[];

		/**
		 * Additional metadata about the diagnostic.
		 */
		tags?: DiagnosticTag[];

		/**
		 * Creates a new diagnostic object.
		 *
		 * @param range The range to which this diagnostic applies.
		 * @param message The human-readable message.
		 * @param severity The severity, default is [error](#DiagnosticSeverity.Error).
		 */
		constructor(range: Range, message: string, severity?: DiagnosticSeverity);
	}

	/**
	 * A diagnostics collection is a container that manages a set of
	 * [diagnostics](#Diagnostic). Diagnostics are always scopes to a
	 * diagnostics collection and a resource.
	 *
	 * To get an instance of a `DiagnosticCollection` use
	 * [createDiagnosticCollection](#languages.createDiagnosticCollection).
	 */
	export interface DiagnosticCollection {

		/**
		 * The name of this diagnostic collection, for instance `typescript`. Every diagnostic
		 * from this collection will be associated with this name. Also, the task framework uses this
		 * name when defining [problem matchers](https://code.visualstudio.com/docs/editor/tasks#_defining-a-problem-matcher).
		 */
		readonly name: string;

		/**
		 * Assign diagnostics for given resource. Will replace
		 * existing diagnostics for that resource.
		 *
		 * @param uri A resource identifier.
		 * @param diagnostics Array of diagnostics or `undefined`
		 */
		set(uri: Uri, diagnostics: ReadonlyArray<Diagnostic> | undefined): void;

		/**
		 * Replace all entries in this collection.
		 *
		 * Diagnostics of multiple tuples of the same uri will be merged, e.g
		 * `[[file1, [d1]], [file1, [d2]]]` is equivalent to `[[file1, [d1, d2]]]`.
		 * If a diagnostics item is `undefined` as in `[file1, undefined]`
		 * all previous but not subsequent diagnostics are removed.
		 *
		 * @param entries An array of tuples, like `[[file1, [d1, d2]], [file2, [d3, d4, d5]]]`, or `undefined`.
		 */
		set(entries: ReadonlyArray<[Uri, ReadonlyArray<Diagnostic> | undefined]>): void;

		/**
		 * Remove all diagnostics from this collection that belong
		 * to the provided `uri`. The same as `#set(uri, undefined)`.
		 *
		 * @param uri A resource identifier.
		 */
		delete(uri: Uri): void;

		/**
		 * Remove all diagnostics from this collection. The same
		 * as calling `#set(undefined)`;
		 */
		clear(): void;

		/**
		 * Iterate over each entry in this collection.
		 *
		 * @param callback Function to execute for each entry.
		 * @param thisArg The `this` context used when invoking the handler function.
		 */
		forEach(callback: (uri: Uri, diagnostics: ReadonlyArray<Diagnostic>, collection: DiagnosticCollection) => any, thisArg?: any): void;

		/**
		 * Get the diagnostics for a given resource. *Note* that you cannot
		 * modify the diagnostics-array returned from this call.
		 *
		 * @param uri A resource identifier.
		 * @returns An immutable array of [diagnostics](#Diagnostic) or `undefined`.
		 */
		get(uri: Uri): ReadonlyArray<Diagnostic> | undefined;

		/**
		 * Check if this collection contains diagnostics for a
		 * given resource.
		 *
		 * @param uri A resource identifier.
		 * @returns `true` if this collection has diagnostic for the given resource.
		 */
		has(uri: Uri): boolean;

		/**
		 * Dispose and free associated resources. Calls
		 * [clear](#DiagnosticCollection.clear).
		 */
		dispose(): void;
	}

	/**
	 * Denotes a location of an editor in the window. Editors can be arranged in a grid
	 * and each column represents one editor location in that grid by counting the editors
	 * in order of their appearance.
	 */
	export enum ViewColumn {
		/**
		 * A *symbolic* editor column representing the currently active column. This value
		 * can be used when opening editors, but the *resolved* [viewColumn](#TextEditor.viewColumn)-value
		 * of editors will always be `One`, `Two`, `Three`,... or `undefined` but never `Active`.
		 */
		Active = -1,
		/**
		 * A *symbolic* editor column representing the column to the side of the active one. This value
		 * can be used when opening editors, but the *resolved* [viewColumn](#TextEditor.viewColumn)-value
		 * of editors will always be `One`, `Two`, `Three`,... or `undefined` but never `Beside`.
		 */
		Beside = -2,
		/**
		 * The first editor column.
		 */
		One = 1,
		/**
		 * The second editor column.
		 */
		Two = 2,
		/**
		 * The third editor column.
		 */
		Three = 3,
		/**
		 * The fourth editor column.
		 */
		Four = 4,
		/**
		 * The fifth editor column.
		 */
		Five = 5,
		/**
		 * The sixth editor column.
		 */
		Six = 6,
		/**
		 * The seventh editor column.
		 */
		Seven = 7,
		/**
		 * The eighth editor column.
		 */
		Eight = 8,
		/**
		 * The ninth editor column.
		 */
		Nine = 9
	}

	/**
	 * An output channel is a container for readonly textual information.
	 *
	 * To get an instance of an `OutputChannel` use
	 * [createOutputChannel](#window.createOutputChannel).
	 */
	export interface OutputChannel {

		/**
		 * The human-readable name of this output channel.
		 */
		readonly name: string;

		/**
		 * Append the given value to the channel.
		 *
		 * @param value A string, falsy values will not be printed.
		 */
		append(value: string): void;

		/**
		 * Append the given value and a line feed character
		 * to the channel.
		 *
		 * @param value A string, falsy values will be printed.
		 */
		appendLine(value: string): void;

		/**
		 * Removes all output from the channel.
		 */
		clear(): void;

		/**
		 * Reveal this channel in the UI.
		 *
		 * @param preserveFocus When `true` the channel will not take focus.
		 */
		show(preserveFocus?: boolean): void;

		/**
		 * Reveal this channel in the UI.
		 *
		 * @deprecated Use the overload with just one parameter (`show(preserveFocus?: boolean): void`).
		 *
		 * @param column This argument is **deprecated** and will be ignored.
		 * @param preserveFocus When `true` the channel will not take focus.
		 */
		show(column?: ViewColumn, preserveFocus?: boolean): void;

		/**
		 * Hide this channel from the UI.
		 */
		hide(): void;

		/**
		 * Dispose and free associated resources.
		 */
		dispose(): void;
	}

	/**
	 * Accessibility information which controls screen reader behavior.
	 */
	export interface AccessibilityInformation {
		/**
		 * Label to be read out by a screen reader once the item has focus.
		 */
		label: string;

		/**
		 * Role of the widget which defines how a screen reader interacts with it.
		 * The role should be set in special cases when for example a tree-like element behaves like a checkbox.
		 * If role is not specified VS Code will pick the appropriate role automatically.
		 * More about aria roles can be found here https://w3c.github.io/aria/#widget_roles
		 */
		role?: string;
	}

	/**
	 * Represents the alignment of status bar items.
	 */
	export enum StatusBarAlignment {

		/**
		 * Aligned to the left side.
		 */
		Left = 1,

		/**
		 * Aligned to the right side.
		 */
		Right = 2
	}

	/**
	 * A status bar item is a status bar contribution that can
	 * show text and icons and run a command on click.
	 */
	export interface StatusBarItem {

		/**
		 * The alignment of this item.
		 */
		readonly alignment: StatusBarAlignment;

		/**
		 * The priority of this item. Higher value means the item should
		 * be shown more to the left.
		 */
		readonly priority?: number;

		/**
		 * The text to show for the entry. You can embed icons in the text by leveraging the syntax:
		 *
		 * `My text $(icon-name) contains icons like $(icon-name) this one.`
		 *
		 * Where the icon-name is taken from the ThemeIcon [icon set](https://code.visualstudio.com/api/references/icons-in-labels#icon-listing), e.g.
		 * `light-bulb`, `thumbsup`, `zap` etc.
		 */
		text: string;

		/**
		 * The tooltip text when you hover over this entry.
		 */
		tooltip: string | undefined;

		/**
		 * The foreground color for this entry.
		 */
		color: string | ThemeColor | undefined;

		/**
		 * [`Command`](#Command) or identifier of a command to run on click.
		 *
		 * The command must be [known](#commands.getCommands).
		 *
		 * Note that if this is a [`Command`](#Command) object, only the [`command`](#Command.command) and [`arguments`](#Command.arguments)
		 * are used by VS Code.
		 */
		command: string | Command | undefined;

		/**
		 * Accessibility information used when screen reader interacts with this StatusBar item
		 */
		accessibilityInformation?: AccessibilityInformation;

		/**
		 * Shows the entry in the status bar.
		 */
		show(): void;

		/**
		 * Hide the entry in the status bar.
		 */
		hide(): void;

		/**
		 * Dispose and free associated resources. Call
		 * [hide](#StatusBarItem.hide).
		 */
		dispose(): void;
	}

	/**
	 * Defines a generalized way of reporting progress updates.
	 */
	export interface Progress<T> {

		/**
		 * Report a progress update.
		 * @param value A progress item, like a message and/or an
		 * report on how much work finished
		 */
		report(value: T): void;
	}

	/**
	 * An individual terminal instance within the integrated terminal.
	 */
	export interface Terminal {

		/**
		 * The name of the terminal.
		 */
		readonly name: string;

		/**
		 * The process ID of the shell process.
		 */
		readonly processId: Thenable<number | undefined>;

		/**
		 * The object used to initialize the terminal, this is useful for example to detecting the
		 * shell type of when the terminal was not launched by this extension or for detecting what
		 * folder the shell was launched in.
		 */
		readonly creationOptions: Readonly<TerminalOptions | ExtensionTerminalOptions>;

		/**
		 * The exit status of the terminal, this will be undefined while the terminal is active.
		 *
		 * **Example:** Show a notification with the exit code when the terminal exits with a
		 * non-zero exit code.
		 * ```typescript
		 * window.onDidCloseTerminal(t => {
		 *   if (t.exitStatus && t.exitStatus.code) {
		 *   	vscode.window.showInformationMessage(`Exit code: ${t.exitStatus.code}`);
		 *   }
		 * });
		 * ```
		 */
		readonly exitStatus: TerminalExitStatus | undefined;

		/**
		 * Send text to the terminal. The text is written to the stdin of the underlying pty process
		 * (shell) of the terminal.
		 *
		 * @param text The text to send.
		 * @param addNewLine Whether to add a new line to the text being sent, this is normally
		 * required to run a command in the terminal. The character(s) added are \n or \r\n
		 * depending on the platform. This defaults to `true`.
		 */
		sendText(text: string, addNewLine?: boolean): void;

		/**
		 * Show the terminal panel and reveal this terminal in the UI.
		 *
		 * @param preserveFocus When `true` the terminal will not take focus.
		 */
		show(preserveFocus?: boolean): void;

		/**
		 * Hide the terminal panel if this terminal is currently showing.
		 */
		hide(): void;

		/**
		 * Dispose and free associated resources.
		 */
		dispose(): void;
	}

	/**
	 * Provides information on a line in a terminal in order to provide links for it.
	 */
	export interface TerminalLinkContext {
		/**
		 * This is the text from the unwrapped line in the terminal.
		 */
		line: string;

		/**
		 * The terminal the link belongs to.
		 */
		terminal: Terminal;
	}

	/**
	 * A provider that enables detection and handling of links within terminals.
	 */
	export interface TerminalLinkProvider<T extends TerminalLink = TerminalLink> {
		/**
		 * Provide terminal links for the given context. Note that this can be called multiple times
		 * even before previous calls resolve, make sure to not share global objects (eg. `RegExp`)
		 * that could have problems when asynchronous usage may overlap.
		 * @param context Information about what links are being provided for.
		 * @param token A cancellation token.
		 * @return A list of terminal links for the given line.
		 */
		provideTerminalLinks(context: TerminalLinkContext, token: CancellationToken): ProviderResult<T[]>;

		/**
		 * Handle an activated terminal link.
		 * @param link The link to handle.
		 */
		handleTerminalLink(link: T): ProviderResult<void>;
	}

	/**
	 * A link on a terminal line.
	 */
	export interface TerminalLink {
		/**
		 * The start index of the link on [TerminalLinkContext.line](#TerminalLinkContext.line].
		 */
		startIndex: number;

		/**
		 * The length of the link on [TerminalLinkContext.line](#TerminalLinkContext.line]
		 */
		length: number;

		/**
		 * The tooltip text when you hover over this link.
		 *
		 * If a tooltip is provided, is will be displayed in a string that includes instructions on
		 * how to trigger the link, such as `{0} (ctrl + click)`. The specific instructions vary
		 * depending on OS, user settings, and localization.
		 */
		tooltip?: string;
	}

	/**
	 * A file decoration represents metadata that can be rendered with a file.
	 */
	export class FileDecoration {

		/**
		 * A very short string that represents this decoration.
		 */
		badge?: string;

		/**
		 * A human-readable tooltip for this decoration.
		 */
		tooltip?: string;

		/**
		 * The color of this decoration.
		 */
		color?: ThemeColor;

		/**
		 * A flag expressing that this decoration should be
		 * propagated to its parents.
		 */
		propagate?: boolean;

		/**
		 * Creates a new decoration.
		 *
		 * @param badge A letter that represents the decoration.
		 * @param tooltip The tooltip of the decoration.
		 * @param color The color of the decoration.
		 */
		constructor(badge?: string, tooltip?: string, color?: ThemeColor);
	}

	/**
	 * The decoration provider interfaces defines the contract between extensions and
	 * file decorations.
	 */
	export interface FileDecorationProvider {

		/**
		 * An optional event to signal that decorations for one or many files have changed.
		 *
		 * *Note* that this event should be used to propagate information about children.
		 *
		 * @see [EventEmitter](#EventEmitter)
		 */
		onDidChangeFileDecorations?: Event<undefined | Uri | Uri[]>;

		/**
		 * Provide decorations for a given uri.
		 *
		 * *Note* that this function is only called when a file gets rendered in the UI.
		 * This means a decoration from a descendent that propagates upwards must be signaled
		 * to the editor via the [onDidChangeFileDecorations](#FileDecorationProvider.onDidChangeFileDecorations)-event.
		 *
		 * @param uri The uri of the file to provide a decoration for.
		 * @param token A cancellation token.
		 * @returns A decoration or a thenable that resolves to such.
		 */
		provideFileDecoration(uri: Uri, token: CancellationToken): ProviderResult<FileDecoration>;
	}


	/**
	 * In a remote window the extension kind describes if an extension
	 * runs where the UI (window) runs or if an extension runs remotely.
	 */
	export enum ExtensionKind {

		/**
		 * Extension runs where the UI runs.
		 */
		UI = 1,

		/**
		 * Extension runs where the remote extension host runs.
		 */
		Workspace = 2
	}

	/**
	 * Represents an extension.
	 *
	 * To get an instance of an `Extension` use [getExtension](#extensions.getExtension).
	 */
	export interface Extension<T> {

		/**
		 * The canonical extension identifier in the form of: `publisher.name`.
		 */
		readonly id: string;

		/**
		 * The uri of the directory containing the extension.
		 */
		readonly extensionUri: Uri;

		/**
		 * The absolute file path of the directory containing this extension. Shorthand
		 * notation for [Extension.extensionUri.fsPath](#Extension.extensionUri) (independent of the uri scheme).
		 */
		readonly extensionPath: string;

		/**
		 * `true` if the extension has been activated.
		 */
		readonly isActive: boolean;

		/**
		 * The parsed contents of the extension's package.json.
		 */
		readonly packageJSON: any;

		/**
		 * The extension kind describes if an extension runs where the UI runs
		 * or if an extension runs where the remote extension host runs. The extension kind
		 * is defined in the `package.json`-file of extensions but can also be refined
		 * via the `remote.extensionKind`-setting. When no remote extension host exists,
		 * the value is [`ExtensionKind.UI`](#ExtensionKind.UI).
		 */
		extensionKind: ExtensionKind;

		/**
		 * The public API exported by this extension. It is an invalid action
		 * to access this field before this extension has been activated.
		 */
		readonly exports: T;

		/**
		 * Activates this extension and returns its public API.
		 *
		 * @return A promise that will resolve when this extension has been activated.
		 */
		activate(): Thenable<T>;
	}

	/**
	 * The ExtensionMode is provided on the `ExtensionContext` and indicates the
	 * mode the specific extension is running in.
	 */
	export enum ExtensionMode {
		/**
		 * The extension is installed normally (for example, from the marketplace
		 * or VSIX) in VS Code.
		 */
		Production = 1,

		/**
		 * The extension is running from an `--extensionDevelopmentPath` provided
		 * when launching VS Code.
		 */
		Development = 2,

		/**
		 * The extension is running from an `--extensionTestsPath` and
		 * the extension host is running unit tests.
		 */
		Test = 3,
	}

	/**
	 * An extension context is a collection of utilities private to an
	 * extension.
	 *
	 * An instance of an `ExtensionContext` is provided as the first
	 * parameter to the `activate`-call of an extension.
	 */
	export interface ExtensionContext {

		/**
		 * An array to which disposables can be added. When this
		 * extension is deactivated the disposables will be disposed.
		 */
		readonly subscriptions: { dispose(): any }[];

		/**
		 * A memento object that stores state in the context
		 * of the currently opened [workspace](#workspace.workspaceFolders).
		 */
		readonly workspaceState: Memento;

		/**
		 * A memento object that stores state independent
		 * of the current opened [workspace](#workspace.workspaceFolders).
		 */
		readonly globalState: Memento & {
			/**
			 * Set the keys whose values should be synchronized across devices when synchronizing user-data
			 * like configuration, extensions, and mementos.
			 *
			 * Note that this function defines the whole set of keys whose values are synchronized:
			 *  - calling it with an empty array stops synchronization for this memento
			 *  - calling it with a non-empty array replaces all keys whose values are synchronized
			 *
			 * For any given set of keys this function needs to be called only once but there is no harm in
			 * repeatedly calling it.
			 *
			 * @param keys The set of keys whose values are synced.
			 */
			setKeysForSync(keys: string[]): void;
		};

		/**
		 * The uri of the directory containing the extension.
		 */
		readonly extensionUri: Uri;

		/**
		 * The absolute file path of the directory containing the extension. Shorthand
		 * notation for [ExtensionContext.extensionUri.fsPath](#TextDocument.uri) (independent of the uri scheme).
		 */
		readonly extensionPath: string;

		/**
		 * Gets the extension's environment variable collection for this workspace, enabling changes
		 * to be applied to terminal environment variables.
		 */
		readonly environmentVariableCollection: EnvironmentVariableCollection;

		/**
		 * Get the absolute path of a resource contained in the extension.
		 *
		 * *Note* that an absolute uri can be constructed via [`Uri.joinPath`](#Uri.joinPath) and
		 * [`extensionUri`](#ExtensionContext.extensionUri), e.g. `vscode.Uri.joinPath(context.extensionUri, relativePath);`
		 *
		 * @param relativePath A relative path to a resource contained in the extension.
		 * @return The absolute path of the resource.
		 */
		asAbsolutePath(relativePath: string): string;

		/**
		 * The uri of a workspace specific directory in which the extension
		 * can store private state. The directory might not exist and creation is
		 * up to the extension. However, the parent directory is guaranteed to be existent.
		 * The value is `undefined` when no workspace nor folder has been opened.
		 *
		 * Use [`workspaceState`](#ExtensionContext.workspaceState) or
		 * [`globalState`](#ExtensionContext.globalState) to store key value data.
		 *
		 * @see [`workspace.fs`](#FileSystem) for how to read and write files and folders from
		 *  an uri.
		 */
		readonly storageUri: Uri | undefined;

		/**
		 * An absolute file path of a workspace specific directory in which the extension
		 * can store private state. The directory might not exist on disk and creation is
		 * up to the extension. However, the parent directory is guaranteed to be existent.
		 *
		 * Use [`workspaceState`](#ExtensionContext.workspaceState) or
		 * [`globalState`](#ExtensionContext.globalState) to store key value data.
		 *
		 * @deprecated Use [storageUri](#ExtensionContext.storageUri) instead.
		 */
		readonly storagePath: string | undefined;

		/**
		 * The uri of a directory in which the extension can store global state.
		 * The directory might not exist on disk and creation is
		 * up to the extension. However, the parent directory is guaranteed to be existent.
		 *
		 * Use [`globalState`](#ExtensionContext.globalState) to store key value data.
		 *
		 * @see [`workspace.fs`](#FileSystem) for how to read and write files and folders from
		 *  an uri.
		 */
		readonly globalStorageUri: Uri;

		/**
		 * An absolute file path in which the extension can store global state.
		 * The directory might not exist on disk and creation is
		 * up to the extension. However, the parent directory is guaranteed to be existent.
		 *
		 * Use [`globalState`](#ExtensionContext.globalState) to store key value data.
		 *
		 * @deprecated Use [globalStorageUri](#ExtensionContext.globalStorageUri) instead.
		 */
		readonly globalStoragePath: string;

		/**
		 * The uri of a directory in which the extension can create log files.
		 * The directory might not exist on disk and creation is up to the extension. However,
		 * the parent directory is guaranteed to be existent.
		 *
		 * @see [`workspace.fs`](#FileSystem) for how to read and write files and folders from
		 *  an uri.
		 */
		readonly logUri: Uri;

		/**
		 * An absolute file path of a directory in which the extension can create log files.
		 * The directory might not exist on disk and creation is up to the extension. However,
		 * the parent directory is guaranteed to be existent.
		 *
		 * @deprecated Use [logUri](#ExtensionContext.logUri) instead.
		 */
		readonly logPath: string;

		/**
		 * The mode the extension is running in. This is specific to the current
		 * extension. One extension may be in `ExtensionMode.Development` while
		 * other extensions in the host run in `ExtensionMode.Release`.
		 */
		readonly extensionMode: ExtensionMode;
	}

	/**
	 * A memento represents a storage utility. It can store and retrieve
	 * values.
	 */
	export interface Memento {

		/**
		 * Return a value.
		 *
		 * @param key A string.
		 * @return The stored value or `undefined`.
		 */
		get<T>(key: string): T | undefined;

		/**
		 * Return a value.
		 *
		 * @param key A string.
		 * @param defaultValue A value that should be returned when there is no
		 * value (`undefined`) with the given key.
		 * @return The stored value or the defaultValue.
		 */
		get<T>(key: string, defaultValue: T): T;

		/**
		 * Store a value. The value must be JSON-stringifyable.
		 *
		 * @param key A string.
		 * @param value A value. MUST not contain cyclic references.
		 */
		update(key: string, value: any): Thenable<void>;
	}

	/**
	 * Represents a color theme kind.
	 */
	export enum ColorThemeKind {
		Light = 1,
		Dark = 2,
		HighContrast = 3
	}

	/**
	 * Represents a color theme.
	 */
	export interface ColorTheme {

		/**
		 * The kind of this color theme: light, dark or high contrast.
		 */
		readonly kind: ColorThemeKind;
	}

	/**
	 * Controls the behaviour of the terminal's visibility.
	 */
	export enum TaskRevealKind {
		/**
		 * Always brings the terminal to front if the task is executed.
		 */
		Always = 1,

		/**
		 * Only brings the terminal to front if a problem is detected executing the task
		 * (e.g. the task couldn't be started because).
		 */
		Silent = 2,

		/**
		 * The terminal never comes to front when the task is executed.
		 */
		Never = 3
	}

	/**
	 * Controls how the task channel is used between tasks
	 */
	export enum TaskPanelKind {

		/**
		 * Shares a panel with other tasks. This is the default.
		 */
		Shared = 1,

		/**
		 * Uses a dedicated panel for this tasks. The panel is not
		 * shared with other tasks.
		 */
		Dedicated = 2,

		/**
		 * Creates a new panel whenever this task is executed.
		 */
		New = 3
	}

	/**
	 * Controls how the task is presented in the UI.
	 */
	export interface TaskPresentationOptions {
		/**
		 * Controls whether the task output is reveal in the user interface.
		 * Defaults to `RevealKind.Always`.
		 */
		reveal?: TaskRevealKind;

		/**
		 * Controls whether the command associated with the task is echoed
		 * in the user interface.
		 */
		echo?: boolean;

		/**
		 * Controls whether the panel showing the task output is taking focus.
		 */
		focus?: boolean;

		/**
		 * Controls if the task panel is used for this task only (dedicated),
		 * shared between tasks (shared) or if a new panel is created on
		 * every task execution (new). Defaults to `TaskInstanceKind.Shared`
		 */
		panel?: TaskPanelKind;

		/**
		 * Controls whether to show the "Terminal will be reused by tasks, press any key to close it" message.
		 */
		showReuseMessage?: boolean;

		/**
		 * Controls whether the terminal is cleared before executing the task.
		 */
		clear?: boolean;
	}

	/**
	 * A grouping for tasks. The editor by default supports the
	 * 'Clean', 'Build', 'RebuildAll' and 'Test' group.
	 */
	export class TaskGroup {

		/**
		 * The clean task group;
		 */
		static Clean: TaskGroup;

		/**
		 * The build task group;
		 */
		static Build: TaskGroup;

		/**
		 * The rebuild all task group;
		 */
		static Rebuild: TaskGroup;

		/**
		 * The test all task group;
		 */
		static Test: TaskGroup;

		private constructor(id: string, label: string);
	}

	/**
	 * A structure that defines a task kind in the system.
	 * The value must be JSON-stringifyable.
	 */
	export interface TaskDefinition {
		/**
		 * The task definition describing the task provided by an extension.
		 * Usually a task provider defines more properties to identify
		 * a task. They need to be defined in the package.json of the
		 * extension under the 'taskDefinitions' extension point. The npm
		 * task definition for example looks like this
		 * ```typescript
		 * interface NpmTaskDefinition extends TaskDefinition {
		 *     script: string;
		 * }
		 * ```
		 *
		 * Note that type identifier starting with a '$' are reserved for internal
		 * usages and shouldn't be used by extensions.
		 */
		readonly type: string;

		/**
		 * Additional attributes of a concrete task definition.
		 */
		[name: string]: any;
	}

	/**
	 * Options for a process execution
	 */
	export interface ProcessExecutionOptions {
		/**
		 * The current working directory of the executed program or shell.
		 * If omitted the tools current workspace root is used.
		 */
		cwd?: string;

		/**
		 * The additional environment of the executed program or shell. If omitted
		 * the parent process' environment is used. If provided it is merged with
		 * the parent process' environment.
		 */
		env?: { [key: string]: string };
	}

	/**
	 * The execution of a task happens as an external process
	 * without shell interaction.
	 */
	export class ProcessExecution {

		/**
		 * Creates a process execution.
		 *
		 * @param process The process to start.
		 * @param options Optional options for the started process.
		 */
		constructor(process: string, options?: ProcessExecutionOptions);

		/**
		 * Creates a process execution.
		 *
		 * @param process The process to start.
		 * @param args Arguments to be passed to the process.
		 * @param options Optional options for the started process.
		 */
		constructor(process: string, args: string[], options?: ProcessExecutionOptions);

		/**
		 * The process to be executed.
		 */
		process: string;

		/**
		 * The arguments passed to the process. Defaults to an empty array.
		 */
		args: string[];

		/**
		 * The process options used when the process is executed.
		 * Defaults to undefined.
		 */
		options?: ProcessExecutionOptions;
	}

	/**
	 * The shell quoting options.
	 */
	export interface ShellQuotingOptions {

		/**
		 * The character used to do character escaping. If a string is provided only spaces
		 * are escaped. If a `{ escapeChar, charsToEscape }` literal is provide all characters
		 * in `charsToEscape` are escaped using the `escapeChar`.
		 */
		escape?: string | {
			/**
			 * The escape character.
			 */
			escapeChar: string;
			/**
			 * The characters to escape.
			 */
			charsToEscape: string;
		};

		/**
		 * The character used for strong quoting. The string's length must be 1.
		 */
		strong?: string;

		/**
		 * The character used for weak quoting. The string's length must be 1.
		 */
		weak?: string;
	}

	/**
	 * Options for a shell execution
	 */
	export interface ShellExecutionOptions {
		/**
		 * The shell executable.
		 */
		executable?: string;

		/**
		 * The arguments to be passed to the shell executable used to run the task. Most shells
		 * require special arguments to execute a command. For  example `bash` requires the `-c`
		 * argument to execute a command, `PowerShell` requires `-Command` and `cmd` requires both
		 * `/d` and `/c`.
		 */
		shellArgs?: string[];

		/**
		 * The shell quotes supported by this shell.
		 */
		shellQuoting?: ShellQuotingOptions;

		/**
		 * The current working directory of the executed shell.
		 * If omitted the tools current workspace root is used.
		 */
		cwd?: string;

		/**
		 * The additional environment of the executed shell. If omitted
		 * the parent process' environment is used. If provided it is merged with
		 * the parent process' environment.
		 */
		env?: { [key: string]: string };
	}

	/**
	 * Defines how an argument should be quoted if it contains
	 * spaces or unsupported characters.
	 */
	export enum ShellQuoting {

		/**
		 * Character escaping should be used. This for example
		 * uses \ on bash and ` on PowerShell.
		 */
		Escape = 1,

		/**
		 * Strong string quoting should be used. This for example
		 * uses " for Windows cmd and ' for bash and PowerShell.
		 * Strong quoting treats arguments as literal strings.
		 * Under PowerShell echo 'The value is $(2 * 3)' will
		 * print `The value is $(2 * 3)`
		 */
		Strong = 2,

		/**
		 * Weak string quoting should be used. This for example
		 * uses " for Windows cmd, bash and PowerShell. Weak quoting
		 * still performs some kind of evaluation inside the quoted
		 * string.  Under PowerShell echo "The value is $(2 * 3)"
		 * will print `The value is 6`
		 */
		Weak = 3
	}

	/**
	 * A string that will be quoted depending on the used shell.
	 */
	export interface ShellQuotedString {
		/**
		 * The actual string value.
		 */
		value: string;

		/**
		 * The quoting style to use.
		 */
		quoting: ShellQuoting;
	}

	export class ShellExecution {
		/**
		 * Creates a shell execution with a full command line.
		 *
		 * @param commandLine The command line to execute.
		 * @param options Optional options for the started the shell.
		 */
		constructor(commandLine: string, options?: ShellExecutionOptions);

		/**
		 * Creates a shell execution with a command and arguments. For the real execution VS Code will
		 * construct a command line from the command and the arguments. This is subject to interpretation
		 * especially when it comes to quoting. If full control over the command line is needed please
		 * use the constructor that creates a `ShellExecution` with the full command line.
		 *
		 * @param command The command to execute.
		 * @param args The command arguments.
		 * @param options Optional options for the started the shell.
		 */
		constructor(command: string | ShellQuotedString, args: (string | ShellQuotedString)[], options?: ShellExecutionOptions);

		/**
		 * The shell command line. Is `undefined` if created with a command and arguments.
		 */
		commandLine: string | undefined;

		/**
		 * The shell command. Is `undefined` if created with a full command line.
		 */
		command: string | ShellQuotedString;

		/**
		 * The shell args. Is `undefined` if created with a full command line.
		 */
		args: (string | ShellQuotedString)[];

		/**
		 * The shell options used when the command line is executed in a shell.
		 * Defaults to undefined.
		 */
		options?: ShellExecutionOptions;
	}

	/**
	 * Class used to execute an extension callback as a task.
	 */
	export class CustomExecution {
		/**
		 * Constructs a CustomExecution task object. The callback will be executed when the task is run, at which point the
		 * extension should return the Pseudoterminal it will "run in". The task should wait to do further execution until
		 * [Pseudoterminal.open](#Pseudoterminal.open) is called. Task cancellation should be handled using
		 * [Pseudoterminal.close](#Pseudoterminal.close). When the task is complete fire
		 * [Pseudoterminal.onDidClose](#Pseudoterminal.onDidClose).
		 * @param callback The callback that will be called when the task is started by a user. Any ${} style variables that
		 * were in the task definition will be resolved and passed into the callback as `resolvedDefinition`.
		 */
		constructor(callback: (resolvedDefinition: TaskDefinition) => Thenable<Pseudoterminal>);
	}

	/**
	 * The scope of a task.
	 */
	export enum TaskScope {
		/**
		 * The task is a global task. Global tasks are currently not supported.
		 */
		Global = 1,

		/**
		 * The task is a workspace task
		 */
		Workspace = 2
	}

	/**
	 * Run options for a task.
	 */
	export interface RunOptions {
		/**
		 * Controls whether task variables are re-evaluated on rerun.
		 */
		reevaluateOnRerun?: boolean;
	}

	/**
	 * A task to execute
	 */
	export class Task {

		/**
		 * Creates a new task.
		 *
		 * @param definition The task definition as defined in the taskDefinitions extension point.
		 * @param scope Specifies the task's scope. It is either a global or a workspace task or a task for a specific workspace folder. Global tasks are currently not supported.
		 * @param name The task's name. Is presented in the user interface.
		 * @param source The task's source (e.g. 'gulp', 'npm', ...). Is presented in the user interface.
		 * @param execution The process or shell execution.
		 * @param problemMatchers the names of problem matchers to use, like '$tsc'
		 *  or '$eslint'. Problem matchers can be contributed by an extension using
		 *  the `problemMatchers` extension point.
		 */
		constructor(taskDefinition: TaskDefinition, scope: WorkspaceFolder | TaskScope.Global | TaskScope.Workspace, name: string, source: string, execution?: ProcessExecution | ShellExecution | CustomExecution, problemMatchers?: string | string[]);

		/**
		 * Creates a new task.
		 *
		 * @deprecated Use the new constructors that allow specifying a scope for the task.
		 *
		 * @param definition The task definition as defined in the taskDefinitions extension point.
		 * @param name The task's name. Is presented in the user interface.
		 * @param source The task's source (e.g. 'gulp', 'npm', ...). Is presented in the user interface.
		 * @param execution The process or shell execution.
		 * @param problemMatchers the names of problem matchers to use, like '$tsc'
		 *  or '$eslint'. Problem matchers can be contributed by an extension using
		 *  the `problemMatchers` extension point.
		 */
		constructor(taskDefinition: TaskDefinition, name: string, source: string, execution?: ProcessExecution | ShellExecution, problemMatchers?: string | string[]);

		/**
		 * The task's definition.
		 */
		definition: TaskDefinition;

		/**
		 * The task's scope.
		 */
		readonly scope?: TaskScope.Global | TaskScope.Workspace | WorkspaceFolder;

		/**
		 * The task's name
		 */
		name: string;

		/**
		 * A human-readable string which is rendered less prominently on a separate line in places
		 * where the task's name is displayed. Supports rendering of [theme icons](#ThemeIcon)
		 * via the `$(<name>)`-syntax.
		 */
		detail?: string;

		/**
		 * The task's execution engine
		 */
		execution?: ProcessExecution | ShellExecution | CustomExecution;

		/**
		 * Whether the task is a background task or not.
		 */
		isBackground: boolean;

		/**
		 * A human-readable string describing the source of this shell task, e.g. 'gulp'
		 * or 'npm'. Supports rendering of [theme icons](#ThemeIcon) via the `$(<name>)`-syntax.
		 */
		source: string;

		/**
		 * The task group this tasks belongs to. See TaskGroup
		 * for a predefined set of available groups.
		 * Defaults to undefined meaning that the task doesn't
		 * belong to any special group.
		 */
		group?: TaskGroup;

		/**
		 * The presentation options. Defaults to an empty literal.
		 */
		presentationOptions: TaskPresentationOptions;

		/**
		 * The problem matchers attached to the task. Defaults to an empty
		 * array.
		 */
		problemMatchers: string[];

		/**
		 * Run options for the task
		 */
		runOptions: RunOptions;
	}

	/**
	 * A task provider allows to add tasks to the task service.
	 * A task provider is registered via #tasks.registerTaskProvider.
	 */
	export interface TaskProvider<T extends Task = Task> {
		/**
		 * Provides tasks.
		 * @param token A cancellation token.
		 * @return an array of tasks
		 */
		provideTasks(token: CancellationToken): ProviderResult<T[]>;

		/**
		 * Resolves a task that has no [`execution`](#Task.execution) set. Tasks are
		 * often created from information found in the `tasks.json`-file. Such tasks miss
		 * the information on how to execute them and a task provider must fill in
		 * the missing information in the `resolveTask`-method. This method will not be
		 * called for tasks returned from the above `provideTasks` method since those
		 * tasks are always fully resolved. A valid default implementation for the
		 * `resolveTask` method is to return `undefined`.
		 *
		 * @param task The task to resolve.
		 * @param token A cancellation token.
		 * @return The resolved task
		 */
		resolveTask(task: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * An object representing an executed Task. It can be used
	 * to terminate a task.
	 *
	 * This interface is not intended to be implemented.
	 */
	export interface TaskExecution {
		/**
		 * The task that got started.
		 */
		task: Task;

		/**
		 * Terminates the task execution.
		 */
		terminate(): void;
	}

	/**
	 * An event signaling the start of a task execution.
	 *
	 * This interface is not intended to be implemented.
	 */
	interface TaskStartEvent {
		/**
		 * The task item representing the task that got started.
		 */
		readonly execution: TaskExecution;
	}

	/**
	 * An event signaling the end of an executed task.
	 *
	 * This interface is not intended to be implemented.
	 */
	interface TaskEndEvent {
		/**
		 * The task item representing the task that finished.
		 */
		readonly execution: TaskExecution;
	}

	/**
	 * An event signaling the start of a process execution
	 * triggered through a task
	 */
	export interface TaskProcessStartEvent {

		/**
		 * The task execution for which the process got started.
		 */
		readonly execution: TaskExecution;

		/**
		 * The underlying process id.
		 */
		readonly processId: number;
	}

	/**
	 * An event signaling the end of a process execution
	 * triggered through a task
	 */
	export interface TaskProcessEndEvent {

		/**
		 * The task execution for which the process got started.
		 */
		readonly execution: TaskExecution;

		/**
		 * The process's exit code. Will be `undefined` when the task is terminated.
		 */
		readonly exitCode: number | undefined;
	}

	export interface TaskFilter {
		/**
		 * The task version as used in the tasks.json file.
		 * The string support the package.json semver notation.
		 */
		version?: string;

		/**
		 * The task type to return;
		 */
		type?: string;
	}

	/**
	 * Namespace for tasks functionality.
	 */
	export namespace tasks {

		/**
		 * Register a task provider.
		 *
		 * @param type The task kind type this provider is registered for.
		 * @param provider A task provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerTaskProvider(type: string, provider: TaskProvider): Disposable;

		/**
		 * Fetches all tasks available in the systems. This includes tasks
		 * from `tasks.json` files as well as tasks from task providers
		 * contributed through extensions.
		 *
		 * @param filter Optional filter to select tasks of a certain type or version.
		 */
		export function fetchTasks(filter?: TaskFilter): Thenable<Task[]>;

		/**
		 * Executes a task that is managed by VS Code. The returned
		 * task execution can be used to terminate the task.
		 *
		 * @throws When running a ShellExecution or a ProcessExecution
		 * task in an environment where a new process cannot be started.
		 * In such an environment, only CustomExecution tasks can be run.
		 *
		 * @param task the task to execute
		 */
		export function executeTask(task: Task): Thenable<TaskExecution>;

		/**
		 * The currently active task executions or an empty array.
		 */
		export const taskExecutions: ReadonlyArray<TaskExecution>;

		/**
		 * Fires when a task starts.
		 */
		export const onDidStartTask: Event<TaskStartEvent>;

		/**
		 * Fires when a task ends.
		 */
		export const onDidEndTask: Event<TaskEndEvent>;

		/**
		 * Fires when the underlying process has been started.
		 * This event will not fire for tasks that don't
		 * execute an underlying process.
		 */
		export const onDidStartTaskProcess: Event<TaskProcessStartEvent>;

		/**
		 * Fires when the underlying process has ended.
		 * This event will not fire for tasks that don't
		 * execute an underlying process.
		 */
		export const onDidEndTaskProcess: Event<TaskProcessEndEvent>;
	}

	/**
	 * Enumeration of file types. The types `File` and `Directory` can also be
	 * a symbolic links, in that case use `FileType.File | FileType.SymbolicLink` and
	 * `FileType.Directory | FileType.SymbolicLink`.
	 */
	export enum FileType {
		/**
		 * The file type is unknown.
		 */
		Unknown = 0,
		/**
		 * A regular file.
		 */
		File = 1,
		/**
		 * A directory.
		 */
		Directory = 2,
		/**
		 * A symbolic link to a file.
		 */
		SymbolicLink = 64
	}

	/**
	 * The `FileStat`-type represents metadata about a file
	 */
	export interface FileStat {
		/**
		 * The type of the file, e.g. is a regular file, a directory, or symbolic link
		 * to a file.
		 *
		 * *Note:* This value might be a bitmask, e.g. `FileType.File | FileType.SymbolicLink`.
		 */
		type: FileType;
		/**
		 * The creation timestamp in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
		 */
		ctime: number;
		/**
		 * The modification timestamp in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
		 *
		 * *Note:* If the file changed, it is important to provide an updated `mtime` that advanced
		 * from the previous value. Otherwise there may be optimizations in place that will not show
		 * the updated file contents in an editor for example.
		 */
		mtime: number;
		/**
		 * The size in bytes.
		 *
		 * *Note:* If the file changed, it is important to provide an updated `size`. Otherwise there
		 * may be optimizations in place that will not show the updated file contents in an editor for
		 * example.
		 */
		size: number;
	}

	/**
	 * A type that filesystem providers should use to signal errors.
	 *
	 * This class has factory methods for common error-cases, like `FileNotFound` when
	 * a file or folder doesn't exist, use them like so: `throw vscode.FileSystemError.FileNotFound(someUri);`
	 */
	export class FileSystemError extends Error {

		/**
		 * Create an error to signal that a file or folder wasn't found.
		 * @param messageOrUri Message or uri.
		 */
		static FileNotFound(messageOrUri?: string | Uri): FileSystemError;

		/**
		 * Create an error to signal that a file or folder already exists, e.g. when
		 * creating but not overwriting a file.
		 * @param messageOrUri Message or uri.
		 */
		static FileExists(messageOrUri?: string | Uri): FileSystemError;

		/**
		 * Create an error to signal that a file is not a folder.
		 * @param messageOrUri Message or uri.
		 */
		static FileNotADirectory(messageOrUri?: string | Uri): FileSystemError;

		/**
		 * Create an error to signal that a file is a folder.
		 * @param messageOrUri Message or uri.
		 */
		static FileIsADirectory(messageOrUri?: string | Uri): FileSystemError;

		/**
		 * Create an error to signal that an operation lacks required permissions.
		 * @param messageOrUri Message or uri.
		 */
		static NoPermissions(messageOrUri?: string | Uri): FileSystemError;

		/**
		 * Create an error to signal that the file system is unavailable or too busy to
		 * complete a request.
		 * @param messageOrUri Message or uri.
		 */
		static Unavailable(messageOrUri?: string | Uri): FileSystemError;

		/**
		 * Creates a new filesystem error.
		 *
		 * @param messageOrUri Message or uri.
		 */
		constructor(messageOrUri?: string | Uri);

		/**
		 * A code that identifies this error.
		 *
		 * Possible values are names of errors, like [`FileNotFound`](#FileSystemError.FileNotFound),
		 * or `Unknown` for unspecified errors.
		 */
		readonly code: string;
	}

	/**
	 * Enumeration of file change types.
	 */
	export enum FileChangeType {

		/**
		 * The contents or metadata of a file have changed.
		 */
		Changed = 1,

		/**
		 * A file has been created.
		 */
		Created = 2,

		/**
		 * A file has been deleted.
		 */
		Deleted = 3,
	}

	/**
	 * The event filesystem providers must use to signal a file change.
	 */
	export interface FileChangeEvent {

		/**
		 * The type of change.
		 */
		readonly type: FileChangeType;

		/**
		 * The uri of the file that has changed.
		 */
		readonly uri: Uri;
	}

	/**
	 * The filesystem provider defines what the editor needs to read, write, discover,
	 * and to manage files and folders. It allows extensions to serve files from remote places,
	 * like ftp-servers, and to seamlessly integrate those into the editor.
	 *
	 * * *Note 1:* The filesystem provider API works with [uris](#Uri) and assumes hierarchical
	 * paths, e.g. `foo:/my/path` is a child of `foo:/my/` and a parent of `foo:/my/path/deeper`.
	 * * *Note 2:* There is an activation event `onFileSystem:<scheme>` that fires when a file
	 * or folder is being accessed.
	 * * *Note 3:* The word 'file' is often used to denote all [kinds](#FileType) of files, e.g.
	 * folders, symbolic links, and regular files.
	 */
	export interface FileSystemProvider {

		/**
		 * An event to signal that a resource has been created, changed, or deleted. This
		 * event should fire for resources that are being [watched](#FileSystemProvider.watch)
		 * by clients of this provider.
		 *
		 * *Note:* It is important that the metadata of the file that changed provides an
		 * updated `mtime` that advanced from the previous value in the [stat](#FileStat) and a
		 * correct `size` value. Otherwise there may be optimizations in place that will not show
		 * the change in an editor for example.
		 */
		readonly onDidChangeFile: Event<FileChangeEvent[]>;

		/**
		 * Subscribe to events in the file or folder denoted by `uri`.
		 *
		 * The editor will call this function for files and folders. In the latter case, the
		 * options differ from defaults, e.g. what files/folders to exclude from watching
		 * and if subfolders, sub-subfolder, etc. should be watched (`recursive`).
		 *
		 * @param uri The uri of the file to be watched.
		 * @param options Configures the watch.
		 * @returns A disposable that tells the provider to stop watching the `uri`.
		 */
		watch(uri: Uri, options: { recursive: boolean; excludes: string[] }): Disposable;

		/**
		 * Retrieve metadata about a file.
		 *
		 * Note that the metadata for symbolic links should be the metadata of the file they refer to.
		 * Still, the [SymbolicLink](#FileType.SymbolicLink)-type must be used in addition to the actual type, e.g.
		 * `FileType.SymbolicLink | FileType.Directory`.
		 *
		 * @param uri The uri of the file to retrieve metadata about.
		 * @return The file metadata about the file.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
		 */
		stat(uri: Uri): FileStat | Thenable<FileStat>;

		/**
		 * Retrieve all entries of a [directory](#FileType.Directory).
		 *
		 * @param uri The uri of the folder.
		 * @return An array of name/type-tuples or a thenable that resolves to such.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
		 */
		readDirectory(uri: Uri): [string, FileType][] | Thenable<[string, FileType][]>;

		/**
		 * Create a new directory (Note, that new files are created via `write`-calls).
		 *
		 * @param uri The uri of the new folder.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when the parent of `uri` doesn't exist, e.g. no mkdirp-logic required.
		 * @throws [`FileExists`](#FileSystemError.FileExists) when `uri` already exists.
		 * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
		 */
		createDirectory(uri: Uri): void | Thenable<void>;

		/**
		 * Read the entire contents of a file.
		 *
		 * @param uri The uri of the file.
		 * @return An array of bytes or a thenable that resolves to such.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
		 */
		readFile(uri: Uri): Uint8Array | Thenable<Uint8Array>;

		/**
		 * Write data to a file, replacing its entire contents.
		 *
		 * @param uri The uri of the file.
		 * @param content The new content of the file.
		 * @param options Defines if missing files should or must be created.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist and `create` is not set.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when the parent of `uri` doesn't exist and `create` is set, e.g. no mkdirp-logic required.
		 * @throws [`FileExists`](#FileSystemError.FileExists) when `uri` already exists, `create` is set but `overwrite` is not set.
		 * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
		 */
		writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void | Thenable<void>;

		/**
		 * Delete a file.
		 *
		 * @param uri The resource that is to be deleted.
		 * @param options Defines if deletion of folders is recursive.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `uri` doesn't exist.
		 * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
		 */
		delete(uri: Uri, options: { recursive: boolean }): void | Thenable<void>;

		/**
		 * Rename a file or folder.
		 *
		 * @param oldUri The existing file.
		 * @param newUri The new location.
		 * @param options Defines if existing files should be overwritten.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `oldUri` doesn't exist.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when parent of `newUri` doesn't exist, e.g. no mkdirp-logic required.
		 * @throws [`FileExists`](#FileSystemError.FileExists) when `newUri` exists and when the `overwrite` option is not `true`.
		 * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
		 */
		rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void | Thenable<void>;

		/**
		 * Copy files or folders. Implementing this function is optional but it will speedup
		 * the copy operation.
		 *
		 * @param source The existing file.
		 * @param destination The destination location.
		 * @param options Defines if existing files should be overwritten.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when `source` doesn't exist.
		 * @throws [`FileNotFound`](#FileSystemError.FileNotFound) when parent of `destination` doesn't exist, e.g. no mkdirp-logic required.
		 * @throws [`FileExists`](#FileSystemError.FileExists) when `destination` exists and when the `overwrite` option is not `true`.
		 * @throws [`NoPermissions`](#FileSystemError.NoPermissions) when permissions aren't sufficient.
		 */
		copy?(source: Uri, destination: Uri, options: { overwrite: boolean }): void | Thenable<void>;
	}

	/**
	 * The file system interface exposes the editor's built-in and contributed
	 * [file system providers](#FileSystemProvider). It allows extensions to work
	 * with files from the local disk as well as files from remote places, like the
	 * remote extension host or ftp-servers.
	 *
	 * *Note* that an instance of this interface is available as [`workspace.fs`](#workspace.fs).
	 */
	export interface FileSystem {

		/**
		 * Retrieve metadata about a file.
		 *
		 * @param uri The uri of the file to retrieve metadata about.
		 * @return The file metadata about the file.
		 */
		stat(uri: Uri): Thenable<FileStat>;

		/**
		 * Retrieve all entries of a [directory](#FileType.Directory).
		 *
		 * @param uri The uri of the folder.
		 * @return An array of name/type-tuples or a thenable that resolves to such.
		 */
		readDirectory(uri: Uri): Thenable<[string, FileType][]>;

		/**
		 * Create a new directory (Note, that new files are created via `write`-calls).
		 *
		 * *Note* that missing directories are created automatically, e.g this call has
		 * `mkdirp` semantics.
		 *
		 * @param uri The uri of the new folder.
		 */
		createDirectory(uri: Uri): Thenable<void>;

		/**
		 * Read the entire contents of a file.
		 *
		 * @param uri The uri of the file.
		 * @return An array of bytes or a thenable that resolves to such.
		 */
		readFile(uri: Uri): Thenable<Uint8Array>;

		/**
		 * Write data to a file, replacing its entire contents.
		 *
		 * @param uri The uri of the file.
		 * @param content The new content of the file.
		 */
		writeFile(uri: Uri, content: Uint8Array): Thenable<void>;

		/**
		 * Delete a file.
		 *
		 * @param uri The resource that is to be deleted.
		 * @param options Defines if trash can should be used and if deletion of folders is recursive
		 */
		delete(uri: Uri, options?: { recursive?: boolean, useTrash?: boolean }): Thenable<void>;

		/**
		 * Rename a file or folder.
		 *
		 * @param oldUri The existing file.
		 * @param newUri The new location.
		 * @param options Defines if existing files should be overwritten.
		 */
		rename(source: Uri, target: Uri, options?: { overwrite?: boolean }): Thenable<void>;

		/**
		 * Copy files or folders.
		 *
		 * @param source The existing file.
		 * @param destination The destination location.
		 * @param options Defines if existing files should be overwritten.
		 */
		copy(source: Uri, target: Uri, options?: { overwrite?: boolean }): Thenable<void>;

		/**
		 * Check if a given file system supports writing files.
		 *
		 * Keep in mind that just because a file system supports writing, that does
		 * not mean that writes will always succeed. There may be permissions issues
		 * or other errors that prevent writing a file.
		 *
		 * @param scheme The scheme of the filesystem, for example `file` or `git`.
		 *
		 * @return `true` if the file system supports writing, `false` if it does not
		 * support writing (i.e. it is readonly), and `undefined` if VS Code does not
		 * know about the filesystem.
		 */
		isWritableFileSystem(scheme: string): boolean | undefined;
	}

	/**
	 * Defines a port mapping used for localhost inside the webview.
	 */
	export interface WebviewPortMapping {
		/**
		 * Localhost port to remap inside the webview.
		 */
		readonly webviewPort: number;

		/**
		 * Destination port. The `webviewPort` is resolved to this port.
		 */
		readonly extensionHostPort: number;
	}

	/**
	 * Content settings for a webview.
	 */
	export interface WebviewOptions {
		/**
		 * Controls whether scripts are enabled in the webview content or not.
		 *
		 * Defaults to false (scripts-disabled).
		 */
		readonly enableScripts?: boolean;

		/**
		 * Controls whether command uris are enabled in webview content or not.
		 *
		 * Defaults to false.
		 */
		readonly enableCommandUris?: boolean;

		/**
		 * Root paths from which the webview can load local (filesystem) resources using uris from `asWebviewUri`
		 *
		 * Default to the root folders of the current workspace plus the extension's install directory.
		 *
		 * Pass in an empty array to disallow access to any local resources.
		 */
		readonly localResourceRoots?: ReadonlyArray<Uri>;

		/**
		 * Mappings of localhost ports used inside the webview.
		 *
		 * Port mapping allow webviews to transparently define how localhost ports are resolved. This can be used
		 * to allow using a static localhost port inside the webview that is resolved to random port that a service is
		 * running on.
		 *
		 * If a webview accesses localhost content, we recommend that you specify port mappings even if
		 * the `webviewPort` and `extensionHostPort` ports are the same.
		 *
		 * *Note* that port mappings only work for `http` or `https` urls. Websocket urls (e.g. `ws://localhost:3000`)
		 * cannot be mapped to another port.
		 */
		readonly portMapping?: ReadonlyArray<WebviewPortMapping>;
	}

	/**
	 * Displays html content, similarly to an iframe.
	 */
	export interface Webview {
		/**
		 * Content settings for the webview.
		 */
		options: WebviewOptions;

		/**
		 * HTML contents of the webview.
		 *
		 * This should be a complete, valid html document. Changing this property causes the webview to be reloaded.
		 *
		 * Webviews are sandboxed from normal extension process, so all communication with the webview must use
		 * message passing. To send a message from the extension to the webview, use [`postMessage`](#Webview.postMessage).
		 * To send message from the webview back to an extension, use the `acquireVsCodeApi` function inside the webview
		 * to get a handle to VS Code's api and then call `.postMessage()`:
		 *
		 * ```html
		 * <script>
		 *     const vscode = acquireVsCodeApi(); // acquireVsCodeApi can only be invoked once
		 *     vscode.postMessage({ message: 'hello!' });
		 * </script>
		 * ```
		 *
		 * To load a resources from the workspace inside a webview, use the `[asWebviewUri](#Webview.asWebviewUri)` method
		 * and ensure the resource's directory is listed in [`WebviewOptions.localResourceRoots`](#WebviewOptions.localResourceRoots).
		 *
		 * Keep in mind that even though webviews are sandboxed, they still allow running scripts and loading arbitrary content,
		 * so extensions must follow all standard web security best practices when working with webviews. This includes
		 * properly sanitizing all untrusted input (including content from the workspace) and
		 * setting a [content security policy](https://aka.ms/vscode-api-webview-csp).
		 */
		html: string;

		/**
		 * Fired when the webview content posts a message.
		 *
		 * Webview content can post strings or json serializable objects back to a VS Code extension. They cannot
		 * post `Blob`, `File`, `ImageData` and other DOM specific objects since the extension that receives the
		 * message does not run in a browser environment.
		 */
		readonly onDidReceiveMessage: Event<any>;

		/**
		 * Post a message to the webview content.
		 *
		 * Messages are only delivered if the webview is live (either visible or in the
		 * background with `retainContextWhenHidden`).
		 *
		 * @param message Body of the message. This must be a string or other json serializable object.
		 */
		postMessage(message: any): Thenable<boolean>;

		/**
		 * Convert a uri for the local file system to one that can be used inside webviews.
		 *
		 * Webviews cannot directly load resources from the workspace or local file system using `file:` uris. The
		 * `asWebviewUri` function takes a local `file:` uri and converts it into a uri that can be used inside of
		 * a webview to load the same resource:
		 *
		 * ```ts
		 * webview.html = `<img src="${webview.asWebviewUri(vscode.Uri.file('/Users/codey/workspace/cat.gif'))}">`
		 * ```
		 */
		asWebviewUri(localResource: Uri): Uri;

		/**
		 * Content security policy source for webview resources.
		 *
		 * This is the origin that should be used in a content security policy rule:
		 *
		 * ```
		 * img-src https: ${webview.cspSource} ...;
		 * ```
		 */
		readonly cspSource: string;
	}

	/**
	 * Content settings for a webview panel.
	 */
	export interface WebviewPanelOptions {
		/**
		 * Controls if the find widget is enabled in the panel.
		 *
		 * Defaults to false.
		 */
		readonly enableFindWidget?: boolean;

		/**
		 * Controls if the webview panel's content (iframe) is kept around even when the panel
		 * is no longer visible.
		 *
		 * Normally the webview panel's html context is created when the panel becomes visible
		 * and destroyed when it is hidden. Extensions that have complex state
		 * or UI can set the `retainContextWhenHidden` to make VS Code keep the webview
		 * context around, even when the webview moves to a background tab. When a webview using
		 * `retainContextWhenHidden` becomes hidden, its scripts and other dynamic content are suspended.
		 * When the panel becomes visible again, the context is automatically restored
		 * in the exact same state it was in originally. You cannot send messages to a
		 * hidden webview, even with `retainContextWhenHidden` enabled.
		 *
		 * `retainContextWhenHidden` has a high memory overhead and should only be used if
		 * your panel's context cannot be quickly saved and restored.
		 */
		readonly retainContextWhenHidden?: boolean;
	}

	/**
	 * A panel that contains a webview.
	 */
	interface WebviewPanel {
		/**
		 * Identifies the type of the webview panel, such as `'markdown.preview'`.
		 */
		readonly viewType: string;

		/**
		 * Title of the panel shown in UI.
		 */
		title: string;

		/**
		 * Icon for the panel shown in UI.
		 */
		iconPath?: Uri | { light: Uri; dark: Uri };

		/**
		 * [`Webview`](#Webview) belonging to the panel.
		 */
		readonly webview: Webview;

		/**
		 * Content settings for the webview panel.
		 */
		readonly options: WebviewPanelOptions;

		/**
		 * Editor position of the panel. This property is only set if the webview is in
		 * one of the editor view columns.
		 */
		readonly viewColumn?: ViewColumn;

		/**
		 * Whether the panel is active (focused by the user).
		 */
		readonly active: boolean;

		/**
		 * Whether the panel is visible.
		 */
		readonly visible: boolean;

		/**
		 * Fired when the panel's view state changes.
		 */
		readonly onDidChangeViewState: Event<WebviewPanelOnDidChangeViewStateEvent>;

		/**
		 * Fired when the panel is disposed.
		 *
		 * This may be because the user closed the panel or because `.dispose()` was
		 * called on it.
		 *
		 * Trying to use the panel after it has been disposed throws an exception.
		 */
		readonly onDidDispose: Event<void>;

		/**
		 * Show the webview panel in a given column.
		 *
		 * A webview panel may only show in a single column at a time. If it is already showing, this
		 * method moves it to a new column.
		 *
		 * @param viewColumn View column to show the panel in. Shows in the current `viewColumn` if undefined.
		 * @param preserveFocus When `true`, the webview will not take focus.
		 */
		reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;

		/**
		 * Dispose of the webview panel.
		 *
		 * This closes the panel if it showing and disposes of the resources owned by the webview.
		 * Webview panels are also disposed when the user closes the webview panel. Both cases
		 * fire the `onDispose` event.
		 */
		dispose(): any;
	}

	/**
	 * Event fired when a webview panel's view state changes.
	 */
	export interface WebviewPanelOnDidChangeViewStateEvent {
		/**
		 * Webview panel whose view state changed.
		 */
		readonly webviewPanel: WebviewPanel;
	}

	/**
	 * Restore webview panels that have been persisted when vscode shuts down.
	 *
	 * There are two types of webview persistence:
	 *
	 * - Persistence within a session.
	 * - Persistence across sessions (across restarts of VS Code).
	 *
	 * A `WebviewPanelSerializer` is only required for the second case: persisting a webview across sessions.
	 *
	 * Persistence within a session allows a webview to save its state when it becomes hidden
	 * and restore its content from this state when it becomes visible again. It is powered entirely
	 * by the webview content itself. To save off a persisted state, call `acquireVsCodeApi().setState()` with
	 * any json serializable object. To restore the state again, call `getState()`
	 *
	 * ```js
	 * // Within the webview
	 * const vscode = acquireVsCodeApi();
	 *
	 * // Get existing state
	 * const oldState = vscode.getState() || { value: 0 };
	 *
	 * // Update state
	 * setState({ value: oldState.value + 1 })
	 * ```
	 *
	 * A `WebviewPanelSerializer` extends this persistence across restarts of VS Code. When the editor is shutdown,
	 * VS Code will save off the state from `setState` of all webviews that have a serializer. When the
	 * webview first becomes visible after the restart, this state is passed to `deserializeWebviewPanel`.
	 * The extension can then restore the old `WebviewPanel` from this state.
	 *
	 * @param T Type of the webview's state.
	 */
	interface WebviewPanelSerializer<T = unknown> {
		/**
		 * Restore a webview panel from its serialized `state`.
		 *
		 * Called when a serialized webview first becomes visible.
		 *
		 * @param webviewPanel Webview panel to restore. The serializer should take ownership of this panel. The
		 * serializer must restore the webview's `.html` and hook up all webview events.
		 * @param state Persisted state from the webview content.
		 *
		 * @return Thenable indicating that the webview has been fully restored.
		 */
		deserializeWebviewPanel(webviewPanel: WebviewPanel, state: T): Thenable<void>;
	}

	/**
 * A webview based view.
 */
	export interface WebviewView {
		/**
		 * Identifies the type of the webview view, such as `'hexEditor.dataView'`.
		 */
		readonly viewType: string;

		/**
		 * The underlying webview for the view.
		 */
		readonly webview: Webview;

		/**
		 * View title displayed in the UI.
		 *
		 * The view title is initially taken from the extension `package.json` contribution.
		 */
		title?: string;

		/**
		 * Human-readable string which is rendered less prominently in the title.
		 */
		description?: string;

		/**
		 * Event fired when the view is disposed.
		 *
		 * Views are disposed when they are explicitly hidden by a user (this happens when a user
		 * right clicks in a view and unchecks the webview view).
		 *
		 * Trying to use the view after it has been disposed throws an exception.
		 */
		readonly onDidDispose: Event<void>;

		/**
		 * Tracks if the webview is currently visible.
		 *
		 * Views are visible when they are on the screen and expanded.
		 */
		readonly visible: boolean;

		/**
		 * Event fired when the visibility of the view changes.
		 *
		 * Actions that trigger a visibility change:
		 *
		 * - The view is collapsed or expanded.
		 * - The user switches to a different view group in the sidebar or panel.
		 *
		 * Note that hiding a view using the context menu instead disposes of the view and fires `onDidDispose`.
		 */
		readonly onDidChangeVisibility: Event<void>;

		/**
		 * Reveal the view in the UI.
		 *
		 * If the view is collapsed, this will expand it.
		 *
		 * @param preserveFocus When `true` the view will not take focus.
		 */
		show(preserveFocus?: boolean): void;
	}

	/**
	 * Additional information the webview view being resolved.
	 *
	 * @param T Type of the webview's state.
	 */
	interface WebviewViewResolveContext<T = unknown> {
		/**
		 * Persisted state from the webview content.
		 *
		 * To save resources, VS Code normally deallocates webview documents (the iframe content) that are not visible.
		 * For example, when the user collapse a view or switches to another top level activity in the sidebar, the
		 * `WebviewView` itself is kept alive but the webview's underlying document is deallocated. It is recreated when
		 * the view becomes visible again.
		 *
		 * You can prevent this behavior by setting `retainContextWhenHidden` in the `WebviewOptions`. However this
		 * increases resource usage and should be avoided wherever possible. Instead, you can use persisted state to
		 * save off a webview's state so that it can be quickly recreated as needed.
		 *
		 * To save off a persisted state, inside the webview call `acquireVsCodeApi().setState()` with
		 * any json serializable object. To restore the state again, call `getState()`. For example:
		 *
		 * ```js
		 * // Within the webview
		 * const vscode = acquireVsCodeApi();
		 *
		 * // Get existing state
		 * const oldState = vscode.getState() || { value: 0 };
		 *
		 * // Update state
		 * setState({ value: oldState.value + 1 })
		 * ```
		 *
		 * VS Code ensures that the persisted state is saved correctly when a webview is hidden and across
		 * editor restarts.
		 */
		readonly state: T | undefined;
	}

	/**
	 * Provider for creating `WebviewView` elements.
	 */
	export interface WebviewViewProvider {
		/**
		 * Revolves a webview view.
		 *
		 * `resolveWebviewView` is called when a view first becomes visible. This may happen when the view is
		 * first loaded or when the user hides and then shows a view again.
		 *
		 * @param webviewView Webview view to restore. The provider should take ownership of this view. The
		 *    provider must set the webview's `.html` and hook up all webview events it is interested in.
		 * @param context Additional metadata about the view being resolved.
		 * @param token Cancellation token indicating that the view being provided is no longer needed.
		 *
		 * @return Optional thenable indicating that the view has been fully resolved.
		 */
		resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext, token: CancellationToken): Thenable<void> | void;
	}

	/**
	 * Provider for text based custom editors.
	 *
	 * Text based custom editors use a [`TextDocument`](#TextDocument) as their data model. This considerably simplifies
	 * implementing a custom editor as it allows VS Code to handle many common operations such as
	 * undo and backup. The provider is responsible for synchronizing text changes between the webview and the `TextDocument`.
	 */
	export interface CustomTextEditorProvider {

		/**
		 * Resolve a custom editor for a given text resource.
		 *
		 * This is called when a user first opens a resource for a `CustomTextEditorProvider`, or if they reopen an
		 * existing editor using this `CustomTextEditorProvider`.
		 *
		 *
		 * @param document Document for the resource to resolve.
		 *
		 * @param webviewPanel The webview panel used to display the editor UI for this resource.
		 *
		 * During resolve, the provider must fill in the initial html for the content webview panel and hook up all
		 * the event listeners on it that it is interested in. The provider can also hold onto the `WebviewPanel` to
		 * use later for example in a command. See [`WebviewPanel`](#WebviewPanel) for additional details.
		 *
		 * @param token A cancellation token that indicates the result is no longer needed.
		 *
		 * @return Thenable indicating that the custom editor has been resolved.
		 */
		resolveCustomTextEditor(document: TextDocument, webviewPanel: WebviewPanel, token: CancellationToken): Thenable<void> | void;
	}

	/**
	 * Represents a custom document used by a [`CustomEditorProvider`](#CustomEditorProvider).
	 *
	 * Custom documents are only used within a given `CustomEditorProvider`. The lifecycle of a `CustomDocument` is
	 * managed by VS Code. When no more references remain to a `CustomDocument`, it is disposed of.
	 */
	interface CustomDocument {
		/**
		 * The associated uri for this document.
		 */
		readonly uri: Uri;

		/**
		 * Dispose of the custom document.
		 *
		 * This is invoked by VS Code when there are no more references to a given `CustomDocument` (for example when
		 * all editors associated with the document have been closed.)
		 */
		dispose(): void;
	}

	/**
	 * Event triggered by extensions to signal to VS Code that an edit has occurred on an [`CustomDocument`](#CustomDocument).
	 *
	 * @see [`CustomDocumentProvider.onDidChangeCustomDocument`](#CustomDocumentProvider.onDidChangeCustomDocument).
	 */
	interface CustomDocumentEditEvent<T extends CustomDocument = CustomDocument> {

		/**
		 * The document that the edit is for.
		 */
		readonly document: T;

		/**
		 * Undo the edit operation.
		 *
		 * This is invoked by VS Code when the user undoes this edit. To implement `undo`, your
		 * extension should restore the document and editor to the state they were in just before this
		 * edit was added to VS Code's internal edit stack by `onDidChangeCustomDocument`.
		 */
		undo(): Thenable<void> | void;

		/**
		 * Redo the edit operation.
		 *
		 * This is invoked by VS Code when the user redoes this edit. To implement `redo`, your
		 * extension should restore the document and editor to the state they were in just after this
		 * edit was added to VS Code's internal edit stack by `onDidChangeCustomDocument`.
		 */
		redo(): Thenable<void> | void;

		/**
		 * Display name describing the edit.
		 *
		 * This will be shown to users in the UI for undo/redo operations.
		 */
		readonly label?: string;
	}

	/**
	 * Event triggered by extensions to signal to VS Code that the content of a [`CustomDocument`](#CustomDocument)
	 * has changed.
	 *
	 * @see [`CustomDocumentProvider.onDidChangeCustomDocument`](#CustomDocumentProvider.onDidChangeCustomDocument).
	 */
	interface CustomDocumentContentChangeEvent<T extends CustomDocument = CustomDocument> {
		/**
		 * The document that the change is for.
		 */
		readonly document: T;
	}

	/**
	 * A backup for an [`CustomDocument`](#CustomDocument).
	 */
	interface CustomDocumentBackup {
		/**
		 * Unique identifier for the backup.
		 *
		 * This id is passed back to your extension in `openCustomDocument` when opening a custom editor from a backup.
		 */
		readonly id: string;

		/**
		 * Delete the current backup.
		 *
		 * This is called by VS Code when it is clear the current backup is no longer needed, such as when a new backup
		 * is made or when the file is saved.
		 */
		delete(): void;
	}

	/**
	 * Additional information used to implement [`CustomEditableDocument.backup`](#CustomEditableDocument.backup).
	 */
	interface CustomDocumentBackupContext {
		/**
		 * Suggested file location to write the new backup.
		 *
		 * Note that your extension is free to ignore this and use its own strategy for backup.
		 *
		 * If the editor is for a resource from the current workspace, `destination` will point to a file inside
		 * `ExtensionContext.storagePath`. The parent folder of `destination` may not exist, so make sure to created it
		 * before writing the backup to this location.
		 */
		readonly destination: Uri;
	}

	/**
	 * Additional information about the opening custom document.
	 */
	interface CustomDocumentOpenContext {
		/**
		 * The id of the backup to restore the document from or `undefined` if there is no backup.
		 *
		 * If this is provided, your extension should restore the editor from the backup instead of reading the file
		 * from the user's workspace.
		 */
		readonly backupId?: string;
	}

	/**
	 * Provider for readonly custom editors that use a custom document model.
	 *
	 * Custom editors use [`CustomDocument`](#CustomDocument) as their document model instead of a [`TextDocument`](#TextDocument).
	 *
	 * You should use this type of custom editor when dealing with binary files or more complex scenarios. For simple
	 * text based documents, use [`CustomTextEditorProvider`](#CustomTextEditorProvider) instead.
	 *
	 * @param T Type of the custom document returned by this provider.
	 */
	export interface CustomReadonlyEditorProvider<T extends CustomDocument = CustomDocument> {

		/**
		 * Create a new document for a given resource.
		 *
		 * `openCustomDocument` is called when the first time an editor for a given resource is opened. The opened
		 * document is then passed to `resolveCustomEditor` so that the editor can be shown to the user.
		 *
		 * Already opened `CustomDocument` are re-used if the user opened additional editors. When all editors for a
		 * given resource are closed, the `CustomDocument` is disposed of. Opening an editor at this point will
		 * trigger another call to `openCustomDocument`.
		 *
		 * @param uri Uri of the document to open.
		 * @param openContext Additional information about the opening custom document.
		 * @param token A cancellation token that indicates the result is no longer needed.
		 *
		 * @return The custom document.
		 */
		openCustomDocument(uri: Uri, openContext: CustomDocumentOpenContext, token: CancellationToken): Thenable<T> | T;

		/**
		 * Resolve a custom editor for a given resource.
		 *
		 * This is called whenever the user opens a new editor for this `CustomEditorProvider`.
		 *
		 * @param document Document for the resource being resolved.
		 *
		 * @param webviewPanel The webview panel used to display the editor UI for this resource.
		 *
		 * During resolve, the provider must fill in the initial html for the content webview panel and hook up all
		 * the event listeners on it that it is interested in. The provider can also hold onto the `WebviewPanel` to
		 * use later for example in a command. See [`WebviewPanel`](#WebviewPanel) for additional details.
		 *
		 * @param token A cancellation token that indicates the result is no longer needed.
		 *
		 * @return Optional thenable indicating that the custom editor has been resolved.
		 */
		resolveCustomEditor(document: T, webviewPanel: WebviewPanel, token: CancellationToken): Thenable<void> | void;
	}

	/**
	 * Provider for editable custom editors that use a custom document model.
	 *
	 * Custom editors use [`CustomDocument`](#CustomDocument) as their document model instead of a [`TextDocument`](#TextDocument).
	 * This gives extensions full control over actions such as edit, save, and backup.
	 *
	 * You should use this type of custom editor when dealing with binary files or more complex scenarios. For simple
	 * text based documents, use [`CustomTextEditorProvider`](#CustomTextEditorProvider) instead.
	 *
	 * @param T Type of the custom document returned by this provider.
	 */
	export interface CustomEditorProvider<T extends CustomDocument = CustomDocument> extends CustomReadonlyEditorProvider<T> {
		/**
		 * Signal that an edit has occurred inside a custom editor.
		 *
		 * This event must be fired by your extension whenever an edit happens in a custom editor. An edit can be
		 * anything from changing some text, to cropping an image, to reordering a list. Your extension is free to
		 * define what an edit is and what data is stored on each edit.
		 *
		 * Firing `onDidChange` causes VS Code to mark the editors as being dirty. This is cleared when the user either
		 * saves or reverts the file.
		 *
		 * Editors that support undo/redo must fire a `CustomDocumentEditEvent` whenever an edit happens. This allows
		 * users to undo and redo the edit using VS Code's standard VS Code keyboard shortcuts. VS Code will also mark
		 * the editor as no longer being dirty if the user undoes all edits to the last saved state.
		 *
		 * Editors that support editing but cannot use VS Code's standard undo/redo mechanism must fire a `CustomDocumentContentChangeEvent`.
		 * The only way for a user to clear the dirty state of an editor that does not support undo/redo is to either
		 * `save` or `revert` the file.
		 *
		 * An editor should only ever fire `CustomDocumentEditEvent` events, or only ever fire `CustomDocumentContentChangeEvent` events.
		 */
		readonly onDidChangeCustomDocument: Event<CustomDocumentEditEvent<T>> | Event<CustomDocumentContentChangeEvent<T>>;

		/**
		 * Save a custom document.
		 *
		 * This method is invoked by VS Code when the user saves a custom editor. This can happen when the user
		 * triggers save while the custom editor is active, by commands such as `save all`, or by auto save if enabled.
		 *
		 * To implement `save`, the implementer must persist the custom editor. This usually means writing the
		 * file data for the custom document to disk. After `save` completes, any associated editor instances will
		 * no longer be marked as dirty.
		 *
		 * @param document Document to save.
		 * @param cancellation Token that signals the save is no longer required (for example, if another save was triggered).
		 *
		 * @return Thenable signaling that saving has completed.
		 */
		saveCustomDocument(document: T, cancellation: CancellationToken): Thenable<void>;

		/**
		 * Save a custom document to a different location.
		 *
		 * This method is invoked by VS Code when the user triggers 'save as' on a custom editor. The implementer must
		 * persist the custom editor to `destination`.
		 *
		 * When the user accepts save as, the current editor is be replaced by an non-dirty editor for the newly saved file.
		 *
		 * @param document Document to save.
		 * @param destination Location to save to.
		 * @param cancellation Token that signals the save is no longer required.
		 *
		 * @return Thenable signaling that saving has completed.
		 */
		saveCustomDocumentAs(document: T, destination: Uri, cancellation: CancellationToken): Thenable<void>;

		/**
		 * Revert a custom document to its last saved state.
		 *
		 * This method is invoked by VS Code when the user triggers `File: Revert File` in a custom editor. (Note that
		 * this is only used using VS Code's `File: Revert File` command and not on a `git revert` of the file).
		 *
		 * To implement `revert`, the implementer must make sure all editor instances (webviews) for `document`
		 * are displaying the document in the same state is saved in. This usually means reloading the file from the
		 * workspace.
		 *
		 * @param document Document to revert.
		 * @param cancellation Token that signals the revert is no longer required.
		 *
		 * @return Thenable signaling that the change has completed.
		 */
		revertCustomDocument(document: T, cancellation: CancellationToken): Thenable<void>;

		/**
		 * Back up a dirty custom document.
		 *
		 * Backups are used for hot exit and to prevent data loss. Your `backup` method should persist the resource in
		 * its current state, i.e. with the edits applied. Most commonly this means saving the resource to disk in
		 * the `ExtensionContext.storagePath`. When VS Code reloads and your custom editor is opened for a resource,
		 * your extension should first check to see if any backups exist for the resource. If there is a backup, your
		 * extension should load the file contents from there instead of from the resource in the workspace.
		 *
		 * `backup` is triggered approximately one second after the the user stops editing the document. If the user
		 * rapidly edits the document, `backup` will not be invoked until the editing stops.
		 *
		 * `backup` is not invoked when `auto save` is enabled (since auto save already persists the resource).
		 *
		 * @param document Document to backup.
		 * @param context Information that can be used to backup the document.
		 * @param cancellation Token that signals the current backup since a new backup is coming in. It is up to your
		 * extension to decided how to respond to cancellation. If for example your extension is backing up a large file
		 * in an operation that takes time to complete, your extension may decide to finish the ongoing backup rather
		 * than cancelling it to ensure that VS Code has some valid backup.
		 */
		backupCustomDocument(document: T, context: CustomDocumentBackupContext, cancellation: CancellationToken): Thenable<CustomDocumentBackup>;
	}

	/**
	 * The clipboard provides read and write access to the system's clipboard.
	 */
	export interface Clipboard {

		/**
		 * Read the current clipboard contents as text.
		 * @returns A thenable that resolves to a string.
		 */
		readText(): Thenable<string>;

		/**
		 * Writes text into the clipboard.
		 * @returns A thenable that resolves when writing happened.
		 */
		writeText(value: string): Thenable<void>;
	}

	/**
	 * Possible kinds of UI that can use extensions.
	 */
	export enum UIKind {

		/**
		 * Extensions are accessed from a desktop application.
		 */
		Desktop = 1,

		/**
		 * Extensions are accessed from a web browser.
		 */
		Web = 2
	}

	/**
	 * Namespace describing the environment the editor runs in.
	 */
	export namespace env {

		/**
		 * The application name of the editor, like 'VS Code'.
		 */
		export const appName: string;

		/**
		 * The application root folder from which the editor is running.
		 *
		 * *Note* that the value is the empty string when running in an
		 * environment that has no representation of an application root folder.
		 */
		export const appRoot: string;

		/**
		 * The custom uri scheme the editor registers to in the operating system.
		 */
		export const uriScheme: string;

		/**
		 * Represents the preferred user-language, like `de-CH`, `fr`, or `en-US`.
		 */
		export const language: string;

		/**
		 * The system clipboard.
		 */
		export const clipboard: Clipboard;

		/**
		 * A unique identifier for the computer.
		 */
		export const machineId: string;

		/**
		 * A unique identifier for the current session.
		 * Changes each time the editor is started.
		 */
		export const sessionId: string;

		/**
		 * The name of a remote. Defined by extensions, popular samples are `wsl` for the Windows
		 * Subsystem for Linux or `ssh-remote` for remotes using a secure shell.
		 *
		 * *Note* that the value is `undefined` when there is no remote extension host but that the
		 * value is defined in all extension hosts (local and remote) in case a remote extension host
		 * exists. Use [`Extension#extensionKind`](#Extension.extensionKind) to know if
		 * a specific extension runs remote or not.
		 */
		export const remoteName: string | undefined;

		/**
		 * The detected default shell for the extension host, this is overridden by the
		 * `terminal.integrated.shell` setting for the extension host's platform. Note that in
		 * environments that do not support a shell the value is the empty string.
		 */
		export const shell: string;

		/**
		 * The UI kind property indicates from which UI extensions
		 * are accessed from. For example, extensions could be accessed
		 * from a desktop application or a web browser.
		 */
		export const uiKind: UIKind;

		/**
		 * Opens a link externally using the default application. Depending on the
		 * used scheme this can be:
		 * * a browser (`http:`, `https:`)
		 * * a mail client (`mailto:`)
		 * * VSCode itself (`vscode:` from `vscode.env.uriScheme`)
		 *
		 * *Note* that [`showTextDocument`](#window.showTextDocument) is the right
		 * way to open a text document inside the editor, not this function.
		 *
		 * @param target The uri that should be opened.
		 * @returns A promise indicating if open was successful.
		 */
		export function openExternal(target: Uri): Thenable<boolean>;

		/**
		 * Resolves a uri to form that is accessible externally. Currently only supports `https:`, `http:` and
		 * `vscode.env.uriScheme` uris.
		 *
		 * #### `http:` or `https:` scheme
		 *
		 * Resolves an *external* uri, such as a `http:` or `https:` link, from where the extension is running to a
		 * uri to the same resource on the client machine.
		 *
		 * This is a no-op if the extension is running on the client machine.
		 *
		 * If the extension is running remotely, this function automatically establishes a port forwarding tunnel
		 * from the local machine to `target` on the remote and returns a local uri to the tunnel. The lifetime of
		 * the port forwarding tunnel is managed by VS Code and the tunnel can be closed by the user.
		 *
		 * *Note* that uris passed through `openExternal` are automatically resolved and you should not call `asExternalUri` on them.
		 *
		 * #### `vscode.env.uriScheme`
		 *
		 * Creates a uri that - if opened in a browser (e.g. via `openExternal`) - will result in a registered [UriHandler](#UriHandler)
		 * to trigger.
		 *
		 * Extensions should not make any assumptions about the resulting uri and should not alter it in anyway.
		 * Rather, extensions can e.g. use this uri in an authentication flow, by adding the uri as callback query
		 * argument to the server to authenticate to.
		 *
		 * *Note* that if the server decides to add additional query parameters to the uri (e.g. a token or secret), it
		 * will appear in the uri that is passed to the [UriHandler](#UriHandler).
		 *
		 * **Example** of an authentication flow:
		 * ```typescript
		 * vscode.window.registerUriHandler({
		 *   handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
		 *     if (uri.path === '/did-authenticate') {
		 *       console.log(uri.toString());
		 *     }
		 *   }
		 * });
		 *
		 * const callableUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://my.extension/did-authenticate`));
		 * await vscode.env.openExternal(callableUri);
		 * ```
		 *
		 * *Note* that extensions should not cache the result of `asExternalUri` as the resolved uri may become invalid due to
		 * a system or user action — for example, in remote cases, a user may close a port forwarding tunnel that was opened by
		 * `asExternalUri`.
		 *
		 * @return A uri that can be used on the client machine.
		 */
		export function asExternalUri(target: Uri): Thenable<Uri>;
	}

	/**
	 * Namespace for dealing with commands. In short, a command is a function with a
	 * unique identifier. The function is sometimes also called _command handler_.
	 *
	 * Commands can be added to the editor using the [registerCommand](#commands.registerCommand)
	 * and [registerTextEditorCommand](#commands.registerTextEditorCommand) functions. Commands
	 * can be executed [manually](#commands.executeCommand) or from a UI gesture. Those are:
	 *
	 * * palette - Use the `commands`-section in `package.json` to make a command show in
	 * the [command palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette).
	 * * keybinding - Use the `keybindings`-section in `package.json` to enable
	 * [keybindings](https://code.visualstudio.com/docs/getstarted/keybindings#_customizing-shortcuts)
	 * for your extension.
	 *
	 * Commands from other extensions and from the editor itself are accessible to an extension. However,
	 * when invoking an editor command not all argument types are supported.
	 *
	 * This is a sample that registers a command handler and adds an entry for that command to the palette. First
	 * register a command handler with the identifier `extension.sayHello`.
	 * ```javascript
	 * commands.registerCommand('extension.sayHello', () => {
	 * 	window.showInformationMessage('Hello World!');
	 * });
	 * ```
	 * Second, bind the command identifier to a title under which it will show in the palette (`package.json`).
	 * ```json
	 * {
	 * 	"contributes": {
	 * 		"commands": [{
	 * 			"command": "extension.sayHello",
	 * 			"title": "Hello World"
	 * 		}]
	 * 	}
	 * }
	 * ```
	 */
	export namespace commands {

		/**
		 * Registers a command that can be invoked via a keyboard shortcut,
		 * a menu item, an action, or directly.
		 *
		 * Registering a command with an existing command identifier twice
		 * will cause an error.
		 *
		 * @param command A unique identifier for the command.
		 * @param callback A command handler function.
		 * @param thisArg The `this` context used when invoking the handler function.
		 * @return Disposable which unregisters this command on disposal.
		 */
		export function registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): Disposable;

		/**
		 * Registers a text editor command that can be invoked via a keyboard shortcut,
		 * a menu item, an action, or directly.
		 *
		 * Text editor commands are different from ordinary [commands](#commands.registerCommand) as
		 * they only execute when there is an active editor when the command is called. Also, the
		 * command handler of an editor command has access to the active editor and to an
		 * [edit](#TextEditorEdit)-builder. Note that the edit-builder is only valid while the
		 * callback executes.
		 *
		 * @param command A unique identifier for the command.
		 * @param callback A command handler function with access to an [editor](#TextEditor) and an [edit](#TextEditorEdit).
		 * @param thisArg The `this` context used when invoking the handler function.
		 * @return Disposable which unregisters this command on disposal.
		 */
		export function registerTextEditorCommand(command: string, callback: (textEditor: TextEditor, edit: TextEditorEdit, ...args: any[]) => void, thisArg?: any): Disposable;

		/**
		 * Executes the command denoted by the given command identifier.
		 *
		 * * *Note 1:* When executing an editor command not all types are allowed to
		 * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
		 * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`Uri`](#Uri) and [`Location`](#Location).
		 * * *Note 2:* There are no restrictions when executing commands that have been contributed
		 * by extensions.
		 *
		 * @param command Identifier of the command to execute.
		 * @param rest Parameters passed to the command function.
		 * @return A thenable that resolves to the returned value of the given command. `undefined` when
		 * the command handler function doesn't return anything.
		 */
		export function executeCommand<T>(command: string, ...rest: any[]): Thenable<T | undefined>;

		/**
		 * Retrieve the list of all available commands. Commands starting with an underscore are
		 * treated as internal commands.
		 *
		 * @param filterInternal Set `true` to not see internal commands (starting with an underscore)
		 * @return Thenable that resolves to a list of command ids.
		 */
		export function getCommands(filterInternal?: boolean): Thenable<string[]>;
	}

	/**
	 * Represents the state of a window.
	 */
	export interface WindowState {

		/**
		 * Whether the current window is focused.
		 */
		readonly focused: boolean;
	}

	/**
	 * A uri handler is responsible for handling system-wide [uris](#Uri).
	 *
	 * @see [window.registerUriHandler](#window.registerUriHandler).
	 */
	export interface UriHandler {

		/**
		 * Handle the provided system-wide [uri](#Uri).
		 *
		 * @see [window.registerUriHandler](#window.registerUriHandler).
		 */
		handleUri(uri: Uri): ProviderResult<void>;
	}

	/**
	 * Namespace for dealing with the current window of the editor. That is visible
	 * and active editors, as well as, UI elements to show messages, selections, and
	 * asking for user input.
	 */
	export namespace window {

		/**
		 * The currently active editor or `undefined`. The active editor is the one
		 * that currently has focus or, when none has focus, the one that has changed
		 * input most recently.
		 */
		export let activeTextEditor: TextEditor | undefined;

		/**
		 * The currently visible editors or an empty array.
		 */
		export let visibleTextEditors: TextEditor[];

		/**
		 * An [event](#Event) which fires when the [active editor](#window.activeTextEditor)
		 * has changed. *Note* that the event also fires when the active editor changes
		 * to `undefined`.
		 */
		export const onDidChangeActiveTextEditor: Event<TextEditor | undefined>;

		/**
		 * An [event](#Event) which fires when the array of [visible editors](#window.visibleTextEditors)
		 * has changed.
		 */
		export const onDidChangeVisibleTextEditors: Event<TextEditor[]>;

		/**
		 * An [event](#Event) which fires when the selection in an editor has changed.
		 */
		export const onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;

		/**
		 * An [event](#Event) which fires when the visible ranges of an editor has changed.
		 */
		export const onDidChangeTextEditorVisibleRanges: Event<TextEditorVisibleRangesChangeEvent>;

		/**
		 * An [event](#Event) which fires when the options of an editor have changed.
		 */
		export const onDidChangeTextEditorOptions: Event<TextEditorOptionsChangeEvent>;

		/**
		 * An [event](#Event) which fires when the view column of an editor has changed.
		 */
		export const onDidChangeTextEditorViewColumn: Event<TextEditorViewColumnChangeEvent>;

		/**
		 * The currently opened terminals or an empty array.
		 */
		export const terminals: ReadonlyArray<Terminal>;

		/**
		 * The currently active terminal or `undefined`. The active terminal is the one that
		 * currently has focus or most recently had focus.
		 */
		export const activeTerminal: Terminal | undefined;

		/**
		 * An [event](#Event) which fires when the [active terminal](#window.activeTerminal)
		 * has changed. *Note* that the event also fires when the active terminal changes
		 * to `undefined`.
		 */
		export const onDidChangeActiveTerminal: Event<Terminal | undefined>;

		/**
		 * An [event](#Event) which fires when a terminal has been created, either through the
		 * [createTerminal](#window.createTerminal) API or commands.
		 */
		export const onDidOpenTerminal: Event<Terminal>;

		/**
		 * An [event](#Event) which fires when a terminal is disposed.
		 */
		export const onDidCloseTerminal: Event<Terminal>;

		/**
		 * Represents the current window's state.
		 */
		export const state: WindowState;

		/**
		 * An [event](#Event) which fires when the focus state of the current window
		 * changes. The value of the event represents whether the window is focused.
		 */
		export const onDidChangeWindowState: Event<WindowState>;

		/**
		 * Show the given document in a text editor. A [column](#ViewColumn) can be provided
		 * to control where the editor is being shown. Might change the [active editor](#window.activeTextEditor).
		 *
		 * @param document A text document to be shown.
		 * @param column A view column in which the [editor](#TextEditor) should be shown. The default is the [active](#ViewColumn.Active), other values
		 * are adjusted to be `Min(column, columnCount + 1)`, the [active](#ViewColumn.Active)-column is not adjusted. Use [`ViewColumn.Beside`](#ViewColumn.Beside)
		 * to open the editor to the side of the currently active one.
		 * @param preserveFocus When `true` the editor will not take focus.
		 * @return A promise that resolves to an [editor](#TextEditor).
		 */
		export function showTextDocument(document: TextDocument, column?: ViewColumn, preserveFocus?: boolean): Thenable<TextEditor>;

		/**
		 * Show the given document in a text editor. [Options](#TextDocumentShowOptions) can be provided
		 * to control options of the editor is being shown. Might change the [active editor](#window.activeTextEditor).
		 *
		 * @param document A text document to be shown.
		 * @param options [Editor options](#TextDocumentShowOptions) to configure the behavior of showing the [editor](#TextEditor).
		 * @return A promise that resolves to an [editor](#TextEditor).
		 */
		export function showTextDocument(document: TextDocument, options?: TextDocumentShowOptions): Thenable<TextEditor>;

		/**
		 * A short-hand for `openTextDocument(uri).then(document => showTextDocument(document, options))`.
		 *
		 * @see [openTextDocument](#openTextDocument)
		 *
		 * @param uri A resource identifier.
		 * @param options [Editor options](#TextDocumentShowOptions) to configure the behavior of showing the [editor](#TextEditor).
		 * @return A promise that resolves to an [editor](#TextEditor).
		 */
		export function showTextDocument(uri: Uri, options?: TextDocumentShowOptions): Thenable<TextEditor>;

		/**
		 * Create a TextEditorDecorationType that can be used to add decorations to text editors.
		 *
		 * @param options Rendering options for the decoration type.
		 * @return A new decoration type instance.
		 */
		export function createTextEditorDecorationType(options: DecorationRenderOptions): TextEditorDecorationType;

		/**
		 * Show an information message to users. Optionally provide an array of items which will be presented as
		 * clickable buttons.
		 *
		 * @param message The message to show.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;

		/**
		 * Show an information message to users. Optionally provide an array of items which will be presented as
		 * clickable buttons.
		 *
		 * @param message The message to show.
		 * @param options Configures the behaviour of the message.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showInformationMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;

		/**
		 * Show an information message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showInformationMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;

		/**
		 * Show an information message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param options Configures the behaviour of the message.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showInformationMessage<T extends MessageItem>(message: string, options: MessageOptions, ...items: T[]): Thenable<T | undefined>;

		/**
		 * Show a warning message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;

		/**
		 * Show a warning message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param options Configures the behaviour of the message.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showWarningMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;

		/**
		 * Show a warning message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;

		/**
		 * Show a warning message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param options Configures the behaviour of the message.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showWarningMessage<T extends MessageItem>(message: string, options: MessageOptions, ...items: T[]): Thenable<T | undefined>;

		/**
		 * Show an error message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;

		/**
		 * Show an error message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param options Configures the behaviour of the message.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showErrorMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;

		/**
		 * Show an error message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showErrorMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;

		/**
		 * Show an error message.
		 *
		 * @see [showInformationMessage](#window.showInformationMessage)
		 *
		 * @param message The message to show.
		 * @param options Configures the behaviour of the message.
		 * @param items A set of items that will be rendered as actions in the message.
		 * @return A thenable that resolves to the selected item or `undefined` when being dismissed.
		 */
		export function showErrorMessage<T extends MessageItem>(message: string, options: MessageOptions, ...items: T[]): Thenable<T | undefined>;

		/**
		 * Shows a selection list allowing multiple selections.
		 *
		 * @param items An array of strings, or a promise that resolves to an array of strings.
		 * @param options Configures the behavior of the selection list.
		 * @param token A token that can be used to signal cancellation.
		 * @return A promise that resolves to the selected items or `undefined`.
		 */
		export function showQuickPick(items: string[] | Thenable<string[]>, options: QuickPickOptions & { canPickMany: true; }, token?: CancellationToken): Thenable<string[] | undefined>;

		/**
		 * Shows a selection list.
		 *
		 * @param items An array of strings, or a promise that resolves to an array of strings.
		 * @param options Configures the behavior of the selection list.
		 * @param token A token that can be used to signal cancellation.
		 * @return A promise that resolves to the selection or `undefined`.
		 */
		export function showQuickPick(items: string[] | Thenable<string[]>, options?: QuickPickOptions, token?: CancellationToken): Thenable<string | undefined>;

		/**
		 * Shows a selection list allowing multiple selections.
		 *
		 * @param items An array of items, or a promise that resolves to an array of items.
		 * @param options Configures the behavior of the selection list.
		 * @param token A token that can be used to signal cancellation.
		 * @return A promise that resolves to the selected items or `undefined`.
		 */
		export function showQuickPick<T extends QuickPickItem>(items: T[] | Thenable<T[]>, options: QuickPickOptions & { canPickMany: true; }, token?: CancellationToken): Thenable<T[] | undefined>;

		/**
		 * Shows a selection list.
		 *
		 * @param items An array of items, or a promise that resolves to an array of items.
		 * @param options Configures the behavior of the selection list.
		 * @param token A token that can be used to signal cancellation.
		 * @return A promise that resolves to the selected item or `undefined`.
		 */
		export function showQuickPick<T extends QuickPickItem>(items: T[] | Thenable<T[]>, options?: QuickPickOptions, token?: CancellationToken): Thenable<T | undefined>;

		/**
		 * Shows a selection list of [workspace folders](#workspace.workspaceFolders) to pick from.
		 * Returns `undefined` if no folder is open.
		 *
		 * @param options Configures the behavior of the workspace folder list.
		 * @return A promise that resolves to the workspace folder or `undefined`.
		 */
		export function showWorkspaceFolderPick(options?: WorkspaceFolderPickOptions): Thenable<WorkspaceFolder | undefined>;

		/**
		 * Shows a file open dialog to the user which allows to select a file
		 * for opening-purposes.
		 *
		 * @param options Options that control the dialog.
		 * @returns A promise that resolves to the selected resources or `undefined`.
		 */
		export function showOpenDialog(options?: OpenDialogOptions): Thenable<Uri[] | undefined>;

		/**
		 * Shows a file save dialog to the user which allows to select a file
		 * for saving-purposes.
		 *
		 * @param options Options that control the dialog.
		 * @returns A promise that resolves to the selected resource or `undefined`.
		 */
		export function showSaveDialog(options?: SaveDialogOptions): Thenable<Uri | undefined>;

		/**
		 * Opens an input box to ask the user for input.
		 *
		 * The returned value will be `undefined` if the input box was canceled (e.g. pressing ESC). Otherwise the
		 * returned value will be the string typed by the user or an empty string if the user did not type
		 * anything but dismissed the input box with OK.
		 *
		 * @param options Configures the behavior of the input box.
		 * @param token A token that can be used to signal cancellation.
		 * @return A promise that resolves to a string the user provided or to `undefined` in case of dismissal.
		 */
		export function showInputBox(options?: InputBoxOptions, token?: CancellationToken): Thenable<string | undefined>;

		/**
		 * Creates a [QuickPick](#QuickPick) to let the user pick an item from a list
		 * of items of type T.
		 *
		 * Note that in many cases the more convenient [window.showQuickPick](#window.showQuickPick)
		 * is easier to use. [window.createQuickPick](#window.createQuickPick) should be used
		 * when [window.showQuickPick](#window.showQuickPick) does not offer the required flexibility.
		 *
		 * @return A new [QuickPick](#QuickPick).
		 */
		export function createQuickPick<T extends QuickPickItem>(): QuickPick<T>;

		/**
		 * Creates a [InputBox](#InputBox) to let the user enter some text input.
		 *
		 * Note that in many cases the more convenient [window.showInputBox](#window.showInputBox)
		 * is easier to use. [window.createInputBox](#window.createInputBox) should be used
		 * when [window.showInputBox](#window.showInputBox) does not offer the required flexibility.
		 *
		 * @return A new [InputBox](#InputBox).
		 */
		export function createInputBox(): InputBox;

		/**
		 * Creates a new [output channel](#OutputChannel) with the given name.
		 *
		 * @param name Human-readable string which will be used to represent the channel in the UI.
		 */
		export function createOutputChannel(name: string): OutputChannel;

		/**
		 * Create and show a new webview panel.
		 *
		 * @param viewType Identifies the type of the webview panel.
		 * @param title Title of the panel.
		 * @param showOptions Where to show the webview in the editor. If preserveFocus is set, the new webview will not take focus.
		 * @param options Settings for the new panel.
		 *
		 * @return New webview panel.
		 */
		export function createWebviewPanel(viewType: string, title: string, showOptions: ViewColumn | { viewColumn: ViewColumn, preserveFocus?: boolean }, options?: WebviewPanelOptions & WebviewOptions): WebviewPanel;

		/**
		 * Set a message to the status bar. This is a short hand for the more powerful
		 * status bar [items](#window.createStatusBarItem).
		 *
		 * @param text The message to show, supports icon substitution as in status bar [items](#StatusBarItem.text).
		 * @param hideAfterTimeout Timeout in milliseconds after which the message will be disposed.
		 * @return A disposable which hides the status bar message.
		 */
		export function setStatusBarMessage(text: string, hideAfterTimeout: number): Disposable;

		/**
		 * Set a message to the status bar. This is a short hand for the more powerful
		 * status bar [items](#window.createStatusBarItem).
		 *
		 * @param text The message to show, supports icon substitution as in status bar [items](#StatusBarItem.text).
		 * @param hideWhenDone Thenable on which completion (resolve or reject) the message will be disposed.
		 * @return A disposable which hides the status bar message.
		 */
		export function setStatusBarMessage(text: string, hideWhenDone: Thenable<any>): Disposable;

		/**
		 * Set a message to the status bar. This is a short hand for the more powerful
		 * status bar [items](#window.createStatusBarItem).
		 *
		 * *Note* that status bar messages stack and that they must be disposed when no
		 * longer used.
		 *
		 * @param text The message to show, supports icon substitution as in status bar [items](#StatusBarItem.text).
		 * @return A disposable which hides the status bar message.
		 */
		export function setStatusBarMessage(text: string): Disposable;

		/**
		 * Show progress in the Source Control viewlet while running the given callback and while
		 * its returned promise isn't resolve or rejected.
		 *
		 * @deprecated Use `withProgress` instead.
		 *
		 * @param task A callback returning a promise. Progress increments can be reported with
		 * the provided [progress](#Progress)-object.
		 * @return The thenable the task did return.
		 */
		export function withScmProgress<R>(task: (progress: Progress<number>) => Thenable<R>): Thenable<R>;

		/**
		 * Show progress in the editor. Progress is shown while running the given callback
		 * and while the promise it returned isn't resolved nor rejected. The location at which
		 * progress should show (and other details) is defined via the passed [`ProgressOptions`](#ProgressOptions).
		 *
		 * @param task A callback returning a promise. Progress state can be reported with
		 * the provided [progress](#Progress)-object.
		 *
		 * To report discrete progress, use `increment` to indicate how much work has been completed. Each call with
		 * a `increment` value will be summed up and reflected as overall progress until 100% is reached (a value of
		 * e.g. `10` accounts for `10%` of work done).
		 * Note that currently only `ProgressLocation.Notification` is capable of showing discrete progress.
		 *
		 * To monitor if the operation has been cancelled by the user, use the provided [`CancellationToken`](#CancellationToken).
		 * Note that currently only `ProgressLocation.Notification` is supporting to show a cancel button to cancel the
		 * long running operation.
		 *
		 * @return The thenable the task-callback returned.
		 */
		export function withProgress<R>(options: ProgressOptions, task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>): Thenable<R>;

		/**
		 * Creates a status bar [item](#StatusBarItem).
		 *
		 * @param alignment The alignment of the item.
		 * @param priority The priority of the item. Higher values mean the item should be shown more to the left.
		 * @return A new status bar item.
		 */
		export function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;

		/**
		 * Creates a [Terminal](#Terminal) with a backing shell process. The cwd of the terminal will be the workspace
		 * directory if it exists.
		 *
		 * @param name Optional human-readable string which will be used to represent the terminal in the UI.
		 * @param shellPath Optional path to a custom shell executable to be used in the terminal.
		 * @param shellArgs Optional args for the custom shell executable. A string can be used on Windows only which
		 * allows specifying shell args in
		 * [command-line format](https://msdn.microsoft.com/en-au/08dfcab2-eb6e-49a4-80eb-87d4076c98c6).
		 * @return A new Terminal.
		 * @throws When running in an environment where a new process cannot be started.
		 */
		export function createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): Terminal;

		/**
		 * Creates a [Terminal](#Terminal) with a backing shell process.
		 *
		 * @param options A TerminalOptions object describing the characteristics of the new terminal.
		 * @return A new Terminal.
		 * @throws When running in an environment where a new process cannot be started.
		 */
		export function createTerminal(options: TerminalOptions): Terminal;

		/**
		 * Creates a [Terminal](#Terminal) where an extension controls its input and output.
		 *
		 * @param options An [ExtensionTerminalOptions](#ExtensionTerminalOptions) object describing
		 * the characteristics of the new terminal.
		 * @return A new Terminal.
		 */
		export function createTerminal(options: ExtensionTerminalOptions): Terminal;

		/**
		 * Register a [TreeDataProvider](#TreeDataProvider) for the view contributed using the extension point `views`.
		 * This will allow you to contribute data to the [TreeView](#TreeView) and update if the data changes.
		 *
		 * **Note:** To get access to the [TreeView](#TreeView) and perform operations on it, use [createTreeView](#window.createTreeView).
		 *
		 * @param viewId Id of the view contributed using the extension point `views`.
		 * @param treeDataProvider A [TreeDataProvider](#TreeDataProvider) that provides tree data for the view
		 */
		export function registerTreeDataProvider<T>(viewId: string, treeDataProvider: TreeDataProvider<T>): Disposable;

		/**
		 * Create a [TreeView](#TreeView) for the view contributed using the extension point `views`.
		 * @param viewId Id of the view contributed using the extension point `views`.
		 * @param options Options for creating the [TreeView](#TreeView)
		 * @returns a [TreeView](#TreeView).
		 */
		export function createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T>;

		/**
		 * Registers a [uri handler](#UriHandler) capable of handling system-wide [uris](#Uri).
		 * In case there are multiple windows open, the topmost window will handle the uri.
		 * A uri handler is scoped to the extension it is contributed from; it will only
		 * be able to handle uris which are directed to the extension itself. A uri must respect
		 * the following rules:
		 *
		 * - The uri-scheme must be `vscode.env.uriScheme`;
		 * - The uri-authority must be the extension id (e.g. `my.extension`);
		 * - The uri-path, -query and -fragment parts are arbitrary.
		 *
		 * For example, if the `my.extension` extension registers a uri handler, it will only
		 * be allowed to handle uris with the prefix `product-name://my.extension`.
		 *
		 * An extension can only register a single uri handler in its entire activation lifetime.
		 *
		 * * *Note:* There is an activation event `onUri` that fires when a uri directed for
		 * the current extension is about to be handled.
		 *
		 * @param handler The uri handler to register for this extension.
		 */
		export function registerUriHandler(handler: UriHandler): Disposable;

		/**
		 * Registers a webview panel serializer.
		 *
		 * Extensions that support reviving should have an `"onWebviewPanel:viewType"` activation event and
		 * make sure that [registerWebviewPanelSerializer](#registerWebviewPanelSerializer) is called during activation.
		 *
		 * Only a single serializer may be registered at a time for a given `viewType`.
		 *
		 * @param viewType Type of the webview panel that can be serialized.
		 * @param serializer Webview serializer.
		 */
		export function registerWebviewPanelSerializer(viewType: string, serializer: WebviewPanelSerializer): Disposable;

		/**
		 * Register a new provider for webview views.
		 *
		 * @param viewId Unique id of the view. This should match the `id` from the
		 *   `views` contribution in the package.json.
		 * @param provider Provider for the webview views.
		 *
		 * @return Disposable that unregisters the provider.
		 */
		export function registerWebviewViewProvider(viewId: string, provider: WebviewViewProvider, options?: {
			/**
			 * Content settings for the webview created for this view.
			 */
			readonly webviewOptions?: {
				/**
				 * Controls if the webview element itself (iframe) is kept around even when the view
				 * is no longer visible.
				 *
				 * Normally the webview's html context is created when the view becomes visible
				 * and destroyed when it is hidden. Extensions that have complex state
				 * or UI can set the `retainContextWhenHidden` to make VS Code keep the webview
				 * context around, even when the webview moves to a background tab. When a webview using
				 * `retainContextWhenHidden` becomes hidden, its scripts and other dynamic content are suspended.
				 * When the view becomes visible again, the context is automatically restored
				 * in the exact same state it was in originally. You cannot send messages to a
				 * hidden webview, even with `retainContextWhenHidden` enabled.
				 *
				 * `retainContextWhenHidden` has a high memory overhead and should only be used if
				 * your view's context cannot be quickly saved and restored.
				 */
				readonly retainContextWhenHidden?: boolean;
			};
		}): Disposable;

		/**
		 * Register a provider for custom editors for the `viewType` contributed by the `customEditors` extension point.
		 *
		 * When a custom editor is opened, VS Code fires an `onCustomEditor:viewType` activation event. Your extension
		 * must register a [`CustomTextEditorProvider`](#CustomTextEditorProvider), [`CustomReadonlyEditorProvider`](#CustomReadonlyEditorProvider),
		 * [`CustomEditorProvider`](#CustomEditorProvider)for `viewType` as part of activation.
		 *
		 * @param viewType Unique identifier for the custom editor provider. This should match the `viewType` from the
		 *   `customEditors` contribution point.
		 * @param provider Provider that resolves custom editors.
		 * @param options Options for the provider.
		 *
		 * @return Disposable that unregisters the provider.
		 */
		export function registerCustomEditorProvider(viewType: string, provider: CustomTextEditorProvider | CustomReadonlyEditorProvider | CustomEditorProvider, options?: {
			/**
			 * Content settings for the webview panels created for this custom editor.
			 */
			readonly webviewOptions?: WebviewPanelOptions;

			/**
			 * Only applies to `CustomReadonlyEditorProvider | CustomEditorProvider`.
			 *
			 * Indicates that the provider allows multiple editor instances to be open at the same time for
			 * the same resource.
			 *
			 * By default, VS Code only allows one editor instance to be open at a time for each resource. If the
			 * user tries to open a second editor instance for the resource, the first one is instead moved to where
			 * the second one was to be opened.
			 *
			 * When `supportsMultipleEditorsPerDocument` is enabled, users can split and create copies of the custom
			 * editor. In this case, the custom editor must make sure it can properly synchronize the states of all
			 * editor instances for a resource so that they are consistent.
			 */
			readonly supportsMultipleEditorsPerDocument?: boolean;
		}): Disposable;

		/**
		 * Register provider that enables the detection and handling of links within the terminal.
		 * @param provider The provider that provides the terminal links.
		 * @return Disposable that unregisters the provider.
		 */
		export function registerTerminalLinkProvider(provider: TerminalLinkProvider): Disposable;

		/**
		 * Register a file decoration provider.
		 *
		 * @param provider A [FileDecorationProvider](#FileDecorationProvider).
		 * @return A [disposable](#Disposable) that unregisters the provider.
		 */
		export function registerFileDecorationProvider(provider: FileDecorationProvider): Disposable;

		/**
		 * The currently active color theme as configured in the settings. The active
		 * theme can be changed via the `workbench.colorTheme` setting.
		 */
		export let activeColorTheme: ColorTheme;

		/**
		 * An [event](#Event) which fires when the active color theme is changed or has changes.
		 */
		export const onDidChangeActiveColorTheme: Event<ColorTheme>;
	}

	/**
	 * Options for creating a [TreeView](#TreeView)
	 */
	export interface TreeViewOptions<T> {

		/**
		 * A data provider that provides tree data.
		 */
		treeDataProvider: TreeDataProvider<T>;

		/**
		 * Whether to show collapse all action or not.
		 */
		showCollapseAll?: boolean;

		/**
		 * Whether the tree supports multi-select. When the tree supports multi-select and a command is executed from the tree,
		 * the first argument to the command is the tree item that the command was executed on and the second argument is an
		 * array containing all selected tree items.
		 */
		canSelectMany?: boolean;
	}

	/**
	 * The event that is fired when an element in the [TreeView](#TreeView) is expanded or collapsed
	 */
	export interface TreeViewExpansionEvent<T> {

		/**
		 * Element that is expanded or collapsed.
		 */
		readonly element: T;

	}

	/**
	 * The event that is fired when there is a change in [tree view's selection](#TreeView.selection)
	 */
	export interface TreeViewSelectionChangeEvent<T> {

		/**
		 * Selected elements.
		 */
		readonly selection: T[];

	}

	/**
	 * The event that is fired when there is a change in [tree view's visibility](#TreeView.visible)
	 */
	export interface TreeViewVisibilityChangeEvent {

		/**
		 * `true` if the [tree view](#TreeView) is visible otherwise `false`.
		 */
		readonly visible: boolean;

	}

	/**
	 * Represents a Tree view
	 */
	export interface TreeView<T> extends Disposable {

		/**
		 * Event that is fired when an element is expanded
		 */
		readonly onDidExpandElement: Event<TreeViewExpansionEvent<T>>;

		/**
		 * Event that is fired when an element is collapsed
		 */
		readonly onDidCollapseElement: Event<TreeViewExpansionEvent<T>>;

		/**
		 * Currently selected elements.
		 */
		readonly selection: T[];

		/**
		 * Event that is fired when the [selection](#TreeView.selection) has changed
		 */
		readonly onDidChangeSelection: Event<TreeViewSelectionChangeEvent<T>>;

		/**
		 * `true` if the [tree view](#TreeView) is visible otherwise `false`.
		 */
		readonly visible: boolean;

		/**
		 * Event that is fired when [visibility](#TreeView.visible) has changed
		 */
		readonly onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent>;

		/**
		 * An optional human-readable message that will be rendered in the view.
		 * Setting the message to null, undefined, or empty string will remove the message from the view.
		 */
		message?: string;

		/**
		 * The tree view title is initially taken from the extension package.json
		 * Changes to the title property will be properly reflected in the UI in the title of the view.
		 */
		title?: string;

		/**
		 * An optional human-readable description which is rendered less prominently in the title of the view.
		 * Setting the title description to null, undefined, or empty string will remove the description from the view.
		 */
		description?: string;

		/**
		 * Reveals the given element in the tree view.
		 * If the tree view is not visible then the tree view is shown and element is revealed.
		 *
		 * By default revealed element is selected.
		 * In order to not to select, set the option `select` to `false`.
		 * In order to focus, set the option `focus` to `true`.
		 * In order to expand the revealed element, set the option `expand` to `true`. To expand recursively set `expand` to the number of levels to expand.
		 * **NOTE:** You can expand only to 3 levels maximum.
		 *
		 * **NOTE:** The [TreeDataProvider](#TreeDataProvider) that the `TreeView` [is registered with](#window.createTreeView) with must implement [getParent](#TreeDataProvider.getParent) method to access this API.
		 */
		reveal(element: T, options?: { select?: boolean, focus?: boolean, expand?: boolean | number }): Thenable<void>;
	}

	/**
	 * A data provider that provides tree data
	 */
	export interface TreeDataProvider<T> {
		/**
		 * An optional event to signal that an element or root has changed.
		 * This will trigger the view to update the changed element/root and its children recursively (if shown).
		 * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
		 */
		onDidChangeTreeData?: Event<T | undefined | null | void>;

		/**
		 * Get [TreeItem](#TreeItem) representation of the `element`
		 *
		 * @param element The element for which [TreeItem](#TreeItem) representation is asked for.
		 * @return [TreeItem](#TreeItem) representation of the element
		 */
		getTreeItem(element: T): TreeItem | Thenable<TreeItem>;

		/**
		 * Get the children of `element` or root if no element is passed.
		 *
		 * @param element The element from which the provider gets children. Can be `undefined`.
		 * @return Children of `element` or root if no element is passed.
		 */
		getChildren(element?: T): ProviderResult<T[]>;

		/**
		 * Optional method to return the parent of `element`.
		 * Return `null` or `undefined` if `element` is a child of root.
		 *
		 * **NOTE:** This method should be implemented in order to access [reveal](#TreeView.reveal) API.
		 *
		 * @param element The element for which the parent has to be returned.
		 * @return Parent of `element`.
		 */
		getParent?(element: T): ProviderResult<T>;

		/**
		 * Called only on hover to resolve the [TreeItem](#TreeItem.tooltip) property if it is undefined.
		 * Only properties that were undefined can be resolved in `resolveTreeItem`.
		 * Functionality may be expanded later to include being called to resolve other missing
		 * properties on selection and/or on open.
		 *
		 * Will only ever be called once per TreeItem.
		 *
		 * onDidChangeTreeData should not be triggered from within resolveTreeItem.
		 *
		 * *Note* that this function is called when tree items are already showing in the UI.
		 * Because of that, no property that changes the presentation (label, description, command, etc.)
		 * can be changed.
		 *
		 * @param element The object associated with the TreeItem
		 * @param item Undefined properties of `item` should be set then `item` should be returned.
		 * @return The resolved tree item or a thenable that resolves to such. It is OK to return the given
		 * `item`. When no result is returned, the given `item` will be used.
		 */
		resolveTreeItem?(item: TreeItem, element: T): ProviderResult<TreeItem>;
	}

	export class TreeItem {
		/**
		 * A human-readable string describing this item. When `falsy`, it is derived from [resourceUri](#TreeItem.resourceUri).
		 */
		label?: string | TreeItemLabel;

		/**
		 * Optional id for the tree item that has to be unique across tree. The id is used to preserve the selection and expansion state of the tree item.
		 *
		 * If not provided, an id is generated using the tree item's label. **Note** that when labels change, ids will change and that selection and expansion state cannot be kept stable anymore.
		 */
		id?: string;

		/**
		 * The icon path or [ThemeIcon](#ThemeIcon) for the tree item.
		 * When `falsy`, [Folder Theme Icon](#ThemeIcon.Folder) is assigned, if item is collapsible otherwise [File Theme Icon](#ThemeIcon.File).
		 * When a file or folder [ThemeIcon](#ThemeIcon) is specified, icon is derived from the current file icon theme for the specified theme icon using [resourceUri](#TreeItem.resourceUri) (if provided).
		 */
		iconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon;

		/**
		 * A human-readable string which is rendered less prominent.
		 * When `true`, it is derived from [resourceUri](#TreeItem.resourceUri) and when `falsy`, it is not shown.
		 */
		description?: string | boolean;

		/**
		 * The [uri](#Uri) of the resource representing this item.
		 *
		 * Will be used to derive the [label](#TreeItem.label), when it is not provided.
		 * Will be used to derive the icon from current file icon theme, when [iconPath](#TreeItem.iconPath) has [ThemeIcon](#ThemeIcon) value.
		 */
		resourceUri?: Uri;

		/**
		 * The tooltip text when you hover over this item.
		 */
		tooltip?: string | MarkdownString | undefined;

		/**
		 * The [command](#Command) that should be executed when the tree item is selected.
		 *
		 * Please use `vscode.open` or `vscode.diff` as command IDs when the tree item is opening
		 * something in the editor. Using these commands ensures that the resulting editor will
		 * appear consistent with how other built-in trees open editors.
		 */
		command?: Command;

		/**
		 * [TreeItemCollapsibleState](#TreeItemCollapsibleState) of the tree item.
		 */
		collapsibleState?: TreeItemCollapsibleState;

		/**
		 * Context value of the tree item. This can be used to contribute item specific actions in the tree.
		 * For example, a tree item is given a context value as `folder`. When contributing actions to `view/item/context`
		 * using `menus` extension point, you can specify context value for key `viewItem` in `when` expression like `viewItem == folder`.
		 * ```
		 *	"contributes": {
		 *		"menus": {
		 *			"view/item/context": [
		 *				{
		 *					"command": "extension.deleteFolder",
		 *					"when": "viewItem == folder"
		 *				}
		 *			]
		 *		}
		 *	}
		 * ```
		 * This will show action `extension.deleteFolder` only for items with `contextValue` is `folder`.
		 */
		contextValue?: string;

		/**
		 * Accessibility information used when screen reader interacts with this tree item.
		 * Generally, a TreeItem has no need to set the `role` of the accessibilityInformation;
		 * however, there are cases where a TreeItem is not displayed in a tree-like way where setting the `role` may make sense.
		 */
		accessibilityInformation?: AccessibilityInformation;

		/**
		 * @param label A human-readable string describing this item
		 * @param collapsibleState [TreeItemCollapsibleState](#TreeItemCollapsibleState) of the tree item. Default is [TreeItemCollapsibleState.None](#TreeItemCollapsibleState.None)
		 */
		constructor(label: string | TreeItemLabel, collapsibleState?: TreeItemCollapsibleState);

		/**
		 * @param resourceUri The [uri](#Uri) of the resource representing this item.
		 * @param collapsibleState [TreeItemCollapsibleState](#TreeItemCollapsibleState) of the tree item. Default is [TreeItemCollapsibleState.None](#TreeItemCollapsibleState.None)
		 */
		constructor(resourceUri: Uri, collapsibleState?: TreeItemCollapsibleState);
	}

	/**
	 * Collapsible state of the tree item
	 */
	export enum TreeItemCollapsibleState {
		/**
		 * Determines an item can be neither collapsed nor expanded. Implies it has no children.
		 */
		None = 0,
		/**
		 * Determines an item is collapsed
		 */
		Collapsed = 1,
		/**
		 * Determines an item is expanded
		 */
		Expanded = 2
	}

	/**
	 * Label describing the [Tree item](#TreeItem)
	 */
	export interface TreeItemLabel {

		/**
		 * A human-readable string describing the [Tree item](#TreeItem).
		 */
		label: string;

		/**
		 * Ranges in the label to highlight. A range is defined as a tuple of two number where the
		 * first is the inclusive start index and the second the exclusive end index
		 */
		highlights?: [number, number][];
	}

	/**
	 * Value-object describing what options a terminal should use.
	 */
	export interface TerminalOptions {
		/**
		 * A human-readable string which will be used to represent the terminal in the UI.
		 */
		name?: string;

		/**
		 * A path to a custom shell executable to be used in the terminal.
		 */
		shellPath?: string;

		/**
		 * Args for the custom shell executable. A string can be used on Windows only which allows
		 * specifying shell args in [command-line format](https://msdn.microsoft.com/en-au/08dfcab2-eb6e-49a4-80eb-87d4076c98c6).
		 */
		shellArgs?: string[] | string;

		/**
		 * A path or Uri for the current working directory to be used for the terminal.
		 */
		cwd?: string | Uri;

		/**
		 * Object with environment variables that will be added to the VS Code process.
		 */
		env?: { [key: string]: string | null };

		/**
		 * Whether the terminal process environment should be exactly as provided in
		 * `TerminalOptions.env`. When this is false (default), the environment will be based on the
		 * window's environment and also apply configured platform settings like
		 * `terminal.integrated.windows.env` on top. When this is true, the complete environment
		 * must be provided as nothing will be inherited from the process or any configuration.
		 */
		strictEnv?: boolean;

		/**
		 * When enabled the terminal will run the process as normal but not be surfaced to the user
		 * until `Terminal.show` is called. The typical usage for this is when you need to run
		 * something that may need interactivity but only want to tell the user about it when
		 * interaction is needed. Note that the terminals will still be exposed to all extensions
		 * as normal.
		 */
		hideFromUser?: boolean;
	}

	/**
	 * Value-object describing what options a virtual process terminal should use.
	 */
	export interface ExtensionTerminalOptions {
		/**
		 * A human-readable string which will be used to represent the terminal in the UI.
		 */
		name: string;

		/**
		 * An implementation of [Pseudoterminal](#Pseudoterminal) that allows an extension to
		 * control a terminal.
		 */
		pty: Pseudoterminal;
	}

	/**
	 * Defines the interface of a terminal pty, enabling extensions to control a terminal.
	 */
	interface Pseudoterminal {
		/**
		 * An event that when fired will write data to the terminal. Unlike
		 * [Terminal.sendText](#Terminal.sendText) which sends text to the underlying child
		 * pseudo-device (the child), this will write the text to parent pseudo-device (the
		 * _terminal_ itself).
		 *
		 * Note writing `\n` will just move the cursor down 1 row, you need to write `\r` as well
		 * to move the cursor to the left-most cell.
		 *
		 * **Example:** Write red text to the terminal
		 * ```typescript
		 * const writeEmitter = new vscode.EventEmitter<string>();
		 * const pty: vscode.Pseudoterminal = {
		 *   onDidWrite: writeEmitter.event,
		 *   open: () => writeEmitter.fire('\x1b[31mHello world\x1b[0m'),
		 *   close: () => {}
		 * };
		 * vscode.window.createTerminal({ name: 'My terminal', pty });
		 * ```
		 *
		 * **Example:** Move the cursor to the 10th row and 20th column and write an asterisk
		 * ```typescript
		 * writeEmitter.fire('\x1b[10;20H*');
		 * ```
		 */
		onDidWrite: Event<string>;

		/**
		 * An event that when fired allows overriding the [dimensions](#Pseudoterminal.setDimensions) of the
		 * terminal. Note that when set, the overridden dimensions will only take effect when they
		 * are lower than the actual dimensions of the terminal (ie. there will never be a scroll
		 * bar). Set to `undefined` for the terminal to go back to the regular dimensions (fit to
		 * the size of the panel).
		 *
		 * **Example:** Override the dimensions of a terminal to 20 columns and 10 rows
		 * ```typescript
		 * const dimensionsEmitter = new vscode.EventEmitter<vscode.TerminalDimensions>();
		 * const pty: vscode.Pseudoterminal = {
		 *   onDidWrite: writeEmitter.event,
		 *   onDidOverrideDimensions: dimensionsEmitter.event,
		 *   open: () => {
		 *     dimensionsEmitter.fire({
		 *       columns: 20,
		 *       rows: 10
		 *     });
		 *   },
		 *   close: () => {}
		 * };
		 * vscode.window.createTerminal({ name: 'My terminal', pty });
		 * ```
		 */
		onDidOverrideDimensions?: Event<TerminalDimensions | undefined>;

		/**
		 * An event that when fired will signal that the pty is closed and dispose of the terminal.
		 *
		 * A number can be used to provide an exit code for the terminal. Exit codes must be
		 * positive and a non-zero exit codes signals failure which shows a notification for a
		 * regular terminal and allows dependent tasks to proceed when used with the
		 * `CustomExecution` API.
		 *
		 * **Example:** Exit the terminal when "y" is pressed, otherwise show a notification.
		 * ```typescript
		 * const writeEmitter = new vscode.EventEmitter<string>();
		 * const closeEmitter = new vscode.EventEmitter<vscode.TerminalDimensions>();
		 * const pty: vscode.Pseudoterminal = {
		 *   onDidWrite: writeEmitter.event,
		 *   onDidClose: closeEmitter.event,
		 *   open: () => writeEmitter.fire('Press y to exit successfully'),
		 *   close: () => {},
		 *   handleInput: data => {
		 *     if (data !== 'y') {
		 *       vscode.window.showInformationMessage('Something went wrong');
		 *     }
		 *     closeEmitter.fire();
		 *   }
		 * };
		 * vscode.window.createTerminal({ name: 'Exit example', pty });
		 * ```
		 */
		onDidClose?: Event<void | number>;

		/**
		 * Implement to handle when the pty is open and ready to start firing events.
		 *
		 * @param initialDimensions The dimensions of the terminal, this will be undefined if the
		 * terminal panel has not been opened before this is called.
		 */
		open(initialDimensions: TerminalDimensions | undefined): void;

		/**
		 * Implement to handle when the terminal is closed by an act of the user.
		 */
		close(): void;

		/**
		 * Implement to handle incoming keystrokes in the terminal or when an extension calls
		 * [Terminal.sendText](#Terminal.sendText). `data` contains the keystrokes/text serialized into
		 * their corresponding VT sequence representation.
		 *
		 * @param data The incoming data.
		 *
		 * **Example:** Echo input in the terminal. The sequence for enter (`\r`) is translated to
		 * CRLF to go to a new line and move the cursor to the start of the line.
		 * ```typescript
		 * const writeEmitter = new vscode.EventEmitter<string>();
		 * const pty: vscode.Pseudoterminal = {
		 *   onDidWrite: writeEmitter.event,
		 *   open: () => {},
		 *   close: () => {},
		 *   handleInput: data => writeEmitter.fire(data === '\r' ? '\r\n' : data)
		 * };
		 * vscode.window.createTerminal({ name: 'Local echo', pty });
		 * ```
		 */
		handleInput?(data: string): void;

		/**
		 * Implement to handle when the number of rows and columns that fit into the terminal panel
		 * changes, for example when font size changes or when the panel is resized. The initial
		 * state of a terminal's dimensions should be treated as `undefined` until this is triggered
		 * as the size of a terminal isn't know until it shows up in the user interface.
		 *
		 * When dimensions are overridden by
		 * [onDidOverrideDimensions](#Pseudoterminal.onDidOverrideDimensions), `setDimensions` will
		 * continue to be called with the regular panel dimensions, allowing the extension continue
		 * to react dimension changes.
		 *
		 * @param dimensions The new dimensions.
		 */
		setDimensions?(dimensions: TerminalDimensions): void;
	}

	/**
	 * Represents the dimensions of a terminal.
	 */
	export interface TerminalDimensions {
		/**
		 * The number of columns in the terminal.
		 */
		readonly columns: number;

		/**
		 * The number of rows in the terminal.
		 */
		readonly rows: number;
	}

	/**
	 * Represents how a terminal exited.
	 */
	export interface TerminalExitStatus {
		/**
		 * The exit code that a terminal exited with, it can have the following values:
		 * - Zero: the terminal process or custom execution succeeded.
		 * - Non-zero: the terminal process or custom execution failed.
		 * - `undefined`: the user forcibly closed the terminal or a custom execution exited
		 *   without providing an exit code.
		 */
		readonly code: number | undefined;
	}

	/**
	 * A type of mutation that can be applied to an environment variable.
	 */
	export enum EnvironmentVariableMutatorType {
		/**
		 * Replace the variable's existing value.
		 */
		Replace = 1,
		/**
		 * Append to the end of the variable's existing value.
		 */
		Append = 2,
		/**
		 * Prepend to the start of the variable's existing value.
		 */
		Prepend = 3
	}

	/**
	 * A type of mutation and its value to be applied to an environment variable.
	 */
	export interface EnvironmentVariableMutator {
		/**
		 * The type of mutation that will occur to the variable.
		 */
		readonly type: EnvironmentVariableMutatorType;

		/**
		 * The value to use for the variable.
		 */
		readonly value: string;
	}

	/**
	 * A collection of mutations that an extension can apply to a process environment.
	 */
	export interface EnvironmentVariableCollection {
		/**
		 * Whether the collection should be cached for the workspace and applied to the terminal
		 * across window reloads. When true the collection will be active immediately such when the
		 * window reloads. Additionally, this API will return the cached version if it exists. The
		 * collection will be invalidated when the extension is uninstalled or when the collection
		 * is cleared. Defaults to true.
		 */
		persistent: boolean;

		/**
		 * Replace an environment variable with a value.
		 *
		 * Note that an extension can only make a single change to any one variable, so this will
		 * overwrite any previous calls to replace, append or prepend.
		 *
		 * @param variable The variable to replace.
		 * @param value The value to replace the variable with.
		 */
		replace(variable: string, value: string): void;

		/**
		 * Append a value to an environment variable.
		 *
		 * Note that an extension can only make a single change to any one variable, so this will
		 * overwrite any previous calls to replace, append or prepend.
		 *
		 * @param variable The variable to append to.
		 * @param value The value to append to the variable.
		 */
		append(variable: string, value: string): void;

		/**
		 * Prepend a value to an environment variable.
		 *
		 * Note that an extension can only make a single change to any one variable, so this will
		 * overwrite any previous calls to replace, append or prepend.
		 *
		 * @param variable The variable to prepend.
		 * @param value The value to prepend to the variable.
		 */
		prepend(variable: string, value: string): void;

		/**
		 * Gets the mutator that this collection applies to a variable, if any.
		 *
		 * @param variable The variable to get the mutator for.
		 */
		get(variable: string): EnvironmentVariableMutator | undefined;

		/**
		 * Iterate over each mutator in this collection.
		 *
		 * @param callback Function to execute for each entry.
		 * @param thisArg The `this` context used when invoking the handler function.
		 */
		forEach(callback: (variable: string, mutator: EnvironmentVariableMutator, collection: EnvironmentVariableCollection) => any, thisArg?: any): void;

		/**
		 * Deletes this collection's mutator for a variable.
		 *
		 * @param variable The variable to delete the mutator for.
		 */
		delete(variable: string): void;

		/**
		 * Clears all mutators from this collection.
		 */
		clear(): void;
	}

	/**
	 * A location in the editor at which progress information can be shown. It depends on the
	 * location how progress is visually represented.
	 */
	export enum ProgressLocation {

		/**
		 * Show progress for the source control viewlet, as overlay for the icon and as progress bar
		 * inside the viewlet (when visible). Neither supports cancellation nor discrete progress.
		 */
		SourceControl = 1,

		/**
		 * Show progress in the status bar of the editor. Neither supports cancellation nor discrete progress.
		 */
		Window = 10,

		/**
		 * Show progress as notification with an optional cancel button. Supports to show infinite and discrete progress.
		 */
		Notification = 15
	}

	/**
	 * Value-object describing where and how progress should show.
	 */
	export interface ProgressOptions {

		/**
		 * The location at which progress should show.
		 */
		location: ProgressLocation | { viewId: string };

		/**
		 * A human-readable string which will be used to describe the
		 * operation.
		 */
		title?: string;

		/**
		 * Controls if a cancel button should show to allow the user to
		 * cancel the long running operation.  Note that currently only
		 * `ProgressLocation.Notification` is supporting to show a cancel
		 * button.
		 */
		cancellable?: boolean;
	}

	/**
	 * A light-weight user input UI that is initially not visible. After
	 * configuring it through its properties the extension can make it
	 * visible by calling [QuickInput.show](#QuickInput.show).
	 *
	 * There are several reasons why this UI might have to be hidden and
	 * the extension will be notified through [QuickInput.onDidHide](#QuickInput.onDidHide).
	 * (Examples include: an explicit call to [QuickInput.hide](#QuickInput.hide),
	 * the user pressing Esc, some other input UI opening, etc.)
	 *
	 * A user pressing Enter or some other gesture implying acceptance
	 * of the current state does not automatically hide this UI component.
	 * It is up to the extension to decide whether to accept the user's input
	 * and if the UI should indeed be hidden through a call to [QuickInput.hide](#QuickInput.hide).
	 *
	 * When the extension no longer needs this input UI, it should
	 * [QuickInput.dispose](#QuickInput.dispose) it to allow for freeing up
	 * any resources associated with it.
	 *
	 * See [QuickPick](#QuickPick) and [InputBox](#InputBox) for concrete UIs.
	 */
	export interface QuickInput {

		/**
		 * An optional title.
		 */
		title: string | undefined;

		/**
		 * An optional current step count.
		 */
		step: number | undefined;

		/**
		 * An optional total step count.
		 */
		totalSteps: number | undefined;

		/**
		 * If the UI should allow for user input. Defaults to true.
		 *
		 * Change this to false, e.g., while validating user input or
		 * loading data for the next step in user input.
		 */
		enabled: boolean;

		/**
		 * If the UI should show a progress indicator. Defaults to false.
		 *
		 * Change this to true, e.g., while loading more data or validating
		 * user input.
		 */
		busy: boolean;

		/**
		 * If the UI should stay open even when loosing UI focus. Defaults to false.
		 */
		ignoreFocusOut: boolean;

		/**
		 * Makes the input UI visible in its current configuration. Any other input
		 * UI will first fire an [QuickInput.onDidHide](#QuickInput.onDidHide) event.
		 */
		show(): void;

		/**
		 * Hides this input UI. This will also fire an [QuickInput.onDidHide](#QuickInput.onDidHide)
		 * event.
		 */
		hide(): void;

		/**
		 * An event signaling when this input UI is hidden.
		 *
		 * There are several reasons why this UI might have to be hidden and
		 * the extension will be notified through [QuickInput.onDidHide](#QuickInput.onDidHide).
		 * (Examples include: an explicit call to [QuickInput.hide](#QuickInput.hide),
		 * the user pressing Esc, some other input UI opening, etc.)
		 */
		onDidHide: Event<void>;

		/**
		 * Dispose of this input UI and any associated resources. If it is still
		 * visible, it is first hidden. After this call the input UI is no longer
		 * functional and no additional methods or properties on it should be
		 * accessed. Instead a new input UI should be created.
		 */
		dispose(): void;
	}

	/**
	 * A concrete [QuickInput](#QuickInput) to let the user pick an item from a
	 * list of items of type T. The items can be filtered through a filter text field and
	 * there is an option [canSelectMany](#QuickPick.canSelectMany) to allow for
	 * selecting multiple items.
	 *
	 * Note that in many cases the more convenient [window.showQuickPick](#window.showQuickPick)
	 * is easier to use. [window.createQuickPick](#window.createQuickPick) should be used
	 * when [window.showQuickPick](#window.showQuickPick) does not offer the required flexibility.
	 */
	export interface QuickPick<T extends QuickPickItem> extends QuickInput {

		/**
		 * Current value of the filter text.
		 */
		value: string;

		/**
		 * Optional placeholder in the filter text.
		 */
		placeholder: string | undefined;

		/**
		 * An event signaling when the value of the filter text has changed.
		 */
		readonly onDidChangeValue: Event<string>;

		/**
		 * An event signaling when the user indicated acceptance of the selected item(s).
		 */
		readonly onDidAccept: Event<void>;

		/**
		 * Buttons for actions in the UI.
		 */
		buttons: ReadonlyArray<QuickInputButton>;

		/**
		 * An event signaling when a button was triggered.
		 */
		readonly onDidTriggerButton: Event<QuickInputButton>;

		/**
		 * Items to pick from.
		 */
		items: ReadonlyArray<T>;

		/**
		 * If multiple items can be selected at the same time. Defaults to false.
		 */
		canSelectMany: boolean;

		/**
		 * If the filter text should also be matched against the description of the items. Defaults to false.
		 */
		matchOnDescription: boolean;

		/**
		 * If the filter text should also be matched against the detail of the items. Defaults to false.
		 */
		matchOnDetail: boolean;

		/**
		 * Active items. This can be read and updated by the extension.
		 */
		activeItems: ReadonlyArray<T>;

		/**
		 * An event signaling when the active items have changed.
		 */
		readonly onDidChangeActive: Event<T[]>;

		/**
		 * Selected items. This can be read and updated by the extension.
		 */
		selectedItems: ReadonlyArray<T>;

		/**
		 * An event signaling when the selected items have changed.
		 */
		readonly onDidChangeSelection: Event<T[]>;
	}

	/**
	 * A concrete [QuickInput](#QuickInput) to let the user input a text value.
	 *
	 * Note that in many cases the more convenient [window.showInputBox](#window.showInputBox)
	 * is easier to use. [window.createInputBox](#window.createInputBox) should be used
	 * when [window.showInputBox](#window.showInputBox) does not offer the required flexibility.
	 */
	export interface InputBox extends QuickInput {

		/**
		 * Current input value.
		 */
		value: string;

		/**
		 * Optional placeholder in the filter text.
		 */
		placeholder: string | undefined;

		/**
		 * If the input value should be hidden. Defaults to false.
		 */
		password: boolean;

		/**
		 * An event signaling when the value has changed.
		 */
		readonly onDidChangeValue: Event<string>;

		/**
		 * An event signaling when the user indicated acceptance of the input value.
		 */
		readonly onDidAccept: Event<void>;

		/**
		 * Buttons for actions in the UI.
		 */
		buttons: ReadonlyArray<QuickInputButton>;

		/**
		 * An event signaling when a button was triggered.
		 */
		readonly onDidTriggerButton: Event<QuickInputButton>;

		/**
		 * An optional prompt text providing some ask or explanation to the user.
		 */
		prompt: string | undefined;

		/**
		 * An optional validation message indicating a problem with the current input value.
		 */
		validationMessage: string | undefined;
	}

	/**
	 * Button for an action in a [QuickPick](#QuickPick) or [InputBox](#InputBox).
	 */
	export interface QuickInputButton {

		/**
		 * Icon for the button.
		 */
		readonly iconPath: Uri | { light: Uri; dark: Uri } | ThemeIcon;

		/**
		 * An optional tooltip.
		 */
		readonly tooltip?: string | undefined;
	}

	/**
	 * Predefined buttons for [QuickPick](#QuickPick) and [InputBox](#InputBox).
	 */
	export class QuickInputButtons {

		/**
		 * A back button for [QuickPick](#QuickPick) and [InputBox](#InputBox).
		 *
		 * When a navigation 'back' button is needed this one should be used for consistency.
		 * It comes with a predefined icon, tooltip and location.
		 */
		static readonly Back: QuickInputButton;

		/**
		 * @hidden
		 */
		private constructor();
	}

	/**
	 * An event describing an individual change in the text of a [document](#TextDocument).
	 */
	export interface TextDocumentContentChangeEvent {
		/**
		 * The range that got replaced.
		 */
		readonly range: Range;
		/**
		 * The offset of the range that got replaced.
		 */
		readonly rangeOffset: number;
		/**
		 * The length of the range that got replaced.
		 */
		readonly rangeLength: number;
		/**
		 * The new text for the range.
		 */
		readonly text: string;
	}

	/**
	 * An event describing a transactional [document](#TextDocument) change.
	 */
	export interface TextDocumentChangeEvent {

		/**
		 * The affected document.
		 */
		readonly document: TextDocument;

		/**
		 * An array of content changes.
		 */
		readonly contentChanges: ReadonlyArray<TextDocumentContentChangeEvent>;
	}

	/**
	 * Represents reasons why a text document is saved.
	 */
	export enum TextDocumentSaveReason {

		/**
		 * Manually triggered, e.g. by the user pressing save, by starting debugging,
		 * or by an API call.
		 */
		Manual = 1,

		/**
		 * Automatic after a delay.
		 */
		AfterDelay = 2,

		/**
		 * When the editor lost focus.
		 */
		FocusOut = 3
	}

	/**
	 * An event that is fired when a [document](#TextDocument) will be saved.
	 *
	 * To make modifications to the document before it is being saved, call the
	 * [`waitUntil`](#TextDocumentWillSaveEvent.waitUntil)-function with a thenable
	 * that resolves to an array of [text edits](#TextEdit).
	 */
	export interface TextDocumentWillSaveEvent {

		/**
		 * The document that will be saved.
		 */
		readonly document: TextDocument;

		/**
		 * The reason why save was triggered.
		 */
		readonly reason: TextDocumentSaveReason;

		/**
		 * Allows to pause the event loop and to apply [pre-save-edits](#TextEdit).
		 * Edits of subsequent calls to this function will be applied in order. The
		 * edits will be *ignored* if concurrent modifications of the document happened.
		 *
		 * *Note:* This function can only be called during event dispatch and not
		 * in an asynchronous manner:
		 *
		 * ```ts
		 * workspace.onWillSaveTextDocument(event => {
		 * 	// async, will *throw* an error
		 * 	setTimeout(() => event.waitUntil(promise));
		 *
		 * 	// sync, OK
		 * 	event.waitUntil(promise);
		 * })
		 * ```
		 *
		 * @param thenable A thenable that resolves to [pre-save-edits](#TextEdit).
		 */
		waitUntil(thenable: Thenable<TextEdit[]>): void;

		/**
		 * Allows to pause the event loop until the provided thenable resolved.
		 *
		 * *Note:* This function can only be called during event dispatch.
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<any>): void;
	}

	/**
	 * An event that is fired when files are going to be created.
	 *
	 * To make modifications to the workspace before the files are created,
	 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
	 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
	 */
	export interface FileWillCreateEvent {

		/**
		 * The files that are going to be created.
		 */
		readonly files: ReadonlyArray<Uri>;

		/**
		 * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
		 *
		 * *Note:* This function can only be called during event dispatch and not
		 * in an asynchronous manner:
		 *
		 * ```ts
		 * workspace.onWillCreateFiles(event => {
		 * 	// async, will *throw* an error
		 * 	setTimeout(() => event.waitUntil(promise));
		 *
		 * 	// sync, OK
		 * 	event.waitUntil(promise);
		 * })
		 * ```
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<WorkspaceEdit>): void;

		/**
		 * Allows to pause the event until the provided thenable resolves.
		 *
		 * *Note:* This function can only be called during event dispatch.
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<any>): void;
	}

	/**
	 * An event that is fired after files are created.
	 */
	export interface FileCreateEvent {

		/**
		 * The files that got created.
		 */
		readonly files: ReadonlyArray<Uri>;
	}

	/**
	 * An event that is fired when files are going to be deleted.
	 *
	 * To make modifications to the workspace before the files are deleted,
	 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
	 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
	 */
	export interface FileWillDeleteEvent {

		/**
		 * The files that are going to be deleted.
		 */
		readonly files: ReadonlyArray<Uri>;

		/**
		 * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
		 *
		 * *Note:* This function can only be called during event dispatch and not
		 * in an asynchronous manner:
		 *
		 * ```ts
		 * workspace.onWillCreateFiles(event => {
		 * 	// async, will *throw* an error
		 * 	setTimeout(() => event.waitUntil(promise));
		 *
		 * 	// sync, OK
		 * 	event.waitUntil(promise);
		 * })
		 * ```
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<WorkspaceEdit>): void;

		/**
		 * Allows to pause the event until the provided thenable resolves.
		 *
		 * *Note:* This function can only be called during event dispatch.
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<any>): void;
	}

	/**
	 * An event that is fired after files are deleted.
	 */
	export interface FileDeleteEvent {

		/**
		 * The files that got deleted.
		 */
		readonly files: ReadonlyArray<Uri>;
	}

	/**
	 * An event that is fired when files are going to be renamed.
	 *
	 * To make modifications to the workspace before the files are renamed,
	 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
	 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
	 */
	export interface FileWillRenameEvent {

		/**
		 * The files that are going to be renamed.
		 */
		readonly files: ReadonlyArray<{ oldUri: Uri, newUri: Uri }>;

		/**
		 * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
		 *
		 * *Note:* This function can only be called during event dispatch and not
		 * in an asynchronous manner:
		 *
		 * ```ts
		 * workspace.onWillCreateFiles(event => {
		 * 	// async, will *throw* an error
		 * 	setTimeout(() => event.waitUntil(promise));
		 *
		 * 	// sync, OK
		 * 	event.waitUntil(promise);
		 * })
		 * ```
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<WorkspaceEdit>): void;

		/**
		 * Allows to pause the event until the provided thenable resolves.
		 *
		 * *Note:* This function can only be called during event dispatch.
		 *
		 * @param thenable A thenable that delays saving.
		 */
		waitUntil(thenable: Thenable<any>): void;
	}

	/**
	 * An event that is fired after files are renamed.
	 */
	export interface FileRenameEvent {

		/**
		 * The files that got renamed.
		 */
		readonly files: ReadonlyArray<{ oldUri: Uri, newUri: Uri }>;
	}

	/**
	 * An event describing a change to the set of [workspace folders](#workspace.workspaceFolders).
	 */
	export interface WorkspaceFoldersChangeEvent {
		/**
		 * Added workspace folders.
		 */
		readonly added: ReadonlyArray<WorkspaceFolder>;

		/**
		 * Removed workspace folders.
		 */
		readonly removed: ReadonlyArray<WorkspaceFolder>;
	}

	/**
	 * A workspace folder is one of potentially many roots opened by the editor. All workspace folders
	 * are equal which means there is no notion of an active or primary workspace folder.
	 */
	export interface WorkspaceFolder {

		/**
		 * The associated uri for this workspace folder.
		 *
		 * *Note:* The [Uri](#Uri)-type was intentionally chosen such that future releases of the editor can support
		 * workspace folders that are not stored on the local disk, e.g. `ftp://server/workspaces/foo`.
		 */
		readonly uri: Uri;

		/**
		 * The name of this workspace folder. Defaults to
		 * the basename of its [uri-path](#Uri.path)
		 */
		readonly name: string;

		/**
		 * The ordinal number of this workspace folder.
		 */
		readonly index: number;
	}

	/**
	 * Namespace for dealing with the current workspace. A workspace is the representation
	 * of the folder that has been opened. There is no workspace when just a file but not a
	 * folder has been opened.
	 *
	 * The workspace offers support for [listening](#workspace.createFileSystemWatcher) to fs
	 * events and for [finding](#workspace.findFiles) files. Both perform well and run _outside_
	 * the editor-process so that they should be always used instead of nodejs-equivalents.
	 */
	export namespace workspace {

		/**
		 * A [file system](#FileSystem) instance that allows to interact with local and remote
		 * files, e.g. `vscode.workspace.fs.readDirectory(someUri)` allows to retrieve all entries
		 * of a directory or `vscode.workspace.fs.stat(anotherUri)` returns the meta data for a
		 * file.
		 */
		export const fs: FileSystem;

		/**
		 * The folder that is open in the editor. `undefined` when no folder
		 * has been opened.
		 *
		 * @deprecated Use [`workspaceFolders`](#workspace.workspaceFolders) instead.
		 */
		export const rootPath: string | undefined;

		/**
		 * List of workspace folders or `undefined` when no folder is open.
		 * *Note* that the first entry corresponds to the value of `rootPath`.
		 */
		export const workspaceFolders: ReadonlyArray<WorkspaceFolder> | undefined;

		/**
		 * The name of the workspace. `undefined` when no folder
		 * has been opened.
		 */
		export const name: string | undefined;

		/**
		 * The location of the workspace file, for example:
		 *
		 * `file:///Users/name/Development/myProject.code-workspace`
		 *
		 * or
		 *
		 * `untitled:1555503116870`
		 *
		 * for a workspace that is untitled and not yet saved.
		 *
		 * Depending on the workspace that is opened, the value will be:
		 *  * `undefined` when no workspace or  a single folder is opened
		 *  * the path of the workspace file as `Uri` otherwise. if the workspace
		 * is untitled, the returned URI will use the `untitled:` scheme
		 *
		 * The location can e.g. be used with the `vscode.openFolder` command to
		 * open the workspace again after it has been closed.
		 *
		 * **Example:**
		 * ```typescript
		 * vscode.commands.executeCommand('vscode.openFolder', uriOfWorkspace);
		 * ```
		 *
		 * **Note:** it is not advised to use `workspace.workspaceFile` to write
		 * configuration data into the file. You can use `workspace.getConfiguration().update()`
		 * for that purpose which will work both when a single folder is opened as
		 * well as an untitled or saved workspace.
		 */
		export const workspaceFile: Uri | undefined;

		/**
		 * An event that is emitted when a workspace folder is added or removed.
		 */
		export const onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>;

		/**
		 * Returns the [workspace folder](#WorkspaceFolder) that contains a given uri.
		 * * returns `undefined` when the given uri doesn't match any workspace folder
		 * * returns the *input* when the given uri is a workspace folder itself
		 *
		 * @param uri An uri.
		 * @return A workspace folder or `undefined`
		 */
		export function getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined;

		/**
		 * Returns a path that is relative to the workspace folder or folders.
		 *
		 * When there are no [workspace folders](#workspace.workspaceFolders) or when the path
		 * is not contained in them, the input is returned.
		 *
		 * @param pathOrUri A path or uri. When a uri is given its [fsPath](#Uri.fsPath) is used.
		 * @param includeWorkspaceFolder When `true` and when the given path is contained inside a
		 * workspace folder the name of the workspace is prepended. Defaults to `true` when there are
		 * multiple workspace folders and `false` otherwise.
		 * @return A path relative to the root or the input.
		 */
		export function asRelativePath(pathOrUri: string | Uri, includeWorkspaceFolder?: boolean): string;

		/**
		 * This method replaces `deleteCount` [workspace folders](#workspace.workspaceFolders) starting at index `start`
		 * by an optional set of `workspaceFoldersToAdd` on the `vscode.workspace.workspaceFolders` array. This "splice"
		 * behavior can be used to add, remove and change workspace folders in a single operation.
		 *
		 * If the first workspace folder is added, removed or changed, the currently executing extensions (including the
		 * one that called this method) will be terminated and restarted so that the (deprecated) `rootPath` property is
		 * updated to point to the first workspace folder.
		 *
		 * Use the [`onDidChangeWorkspaceFolders()`](#onDidChangeWorkspaceFolders) event to get notified when the
		 * workspace folders have been updated.
		 *
		 * **Example:** adding a new workspace folder at the end of workspace folders
		 * ```typescript
		 * workspace.updateWorkspaceFolders(workspace.workspaceFolders ? workspace.workspaceFolders.length : 0, null, { uri: ...});
		 * ```
		 *
		 * **Example:** removing the first workspace folder
		 * ```typescript
		 * workspace.updateWorkspaceFolders(0, 1);
		 * ```
		 *
		 * **Example:** replacing an existing workspace folder with a new one
		 * ```typescript
		 * workspace.updateWorkspaceFolders(0, 1, { uri: ...});
		 * ```
		 *
		 * It is valid to remove an existing workspace folder and add it again with a different name
		 * to rename that folder.
		 *
		 * **Note:** it is not valid to call [updateWorkspaceFolders()](#updateWorkspaceFolders) multiple times
		 * without waiting for the [`onDidChangeWorkspaceFolders()`](#onDidChangeWorkspaceFolders) to fire.
		 *
		 * @param start the zero-based location in the list of currently opened [workspace folders](#WorkspaceFolder)
		 * from which to start deleting workspace folders.
		 * @param deleteCount the optional number of workspace folders to remove.
		 * @param workspaceFoldersToAdd the optional variable set of workspace folders to add in place of the deleted ones.
		 * Each workspace is identified with a mandatory URI and an optional name.
		 * @return true if the operation was successfully started and false otherwise if arguments were used that would result
		 * in invalid workspace folder state (e.g. 2 folders with the same URI).
		 */
		export function updateWorkspaceFolders(start: number, deleteCount: number | undefined | null, ...workspaceFoldersToAdd: { uri: Uri, name?: string }[]): boolean;

		/**
		 * Creates a file system watcher.
		 *
		 * A glob pattern that filters the file events on their absolute path must be provided. Optionally,
		 * flags to ignore certain kinds of events can be provided. To stop listening to events the watcher must be disposed.
		 *
		 * *Note* that only files within the current [workspace folders](#workspace.workspaceFolders) can be watched.
		 * *Note* that when watching for file changes such as '**​/*.js', notifications will not be sent when a parent folder is
		 * moved or deleted (this is a known limitation of the current implementation and may change in the future).
		 *
		 * @param globPattern A [glob pattern](#GlobPattern) that is applied to the absolute paths of created, changed,
		 * and deleted files. Use a [relative pattern](#RelativePattern) to limit events to a certain [workspace folder](#WorkspaceFolder).
		 * @param ignoreCreateEvents Ignore when files have been created.
		 * @param ignoreChangeEvents Ignore when files have been changed.
		 * @param ignoreDeleteEvents Ignore when files have been deleted.
		 * @return A new file system watcher instance.
		 */
		export function createFileSystemWatcher(globPattern: GlobPattern, ignoreCreateEvents?: boolean, ignoreChangeEvents?: boolean, ignoreDeleteEvents?: boolean): FileSystemWatcher;

		/**
		 * Find files across all [workspace folders](#workspace.workspaceFolders) in the workspace.
		 *
		 * @example
		 * findFiles('**​/*.js', '**​/node_modules/**', 10)
		 *
		 * @param include A [glob pattern](#GlobPattern) that defines the files to search for. The glob pattern
		 * will be matched against the file paths of resulting matches relative to their workspace. Use a [relative pattern](#RelativePattern)
		 * to restrict the search results to a [workspace folder](#WorkspaceFolder).
		 * @param exclude  A [glob pattern](#GlobPattern) that defines files and folders to exclude. The glob pattern
		 * will be matched against the file paths of resulting matches relative to their workspace. When `undefined` only default excludes will
		 * apply, when `null` no excludes will apply.
		 * @param maxResults An upper-bound for the result.
		 * @param token A token that can be used to signal cancellation to the underlying search engine.
		 * @return A thenable that resolves to an array of resource identifiers. Will return no results if no
		 * [workspace folders](#workspace.workspaceFolders) are opened.
		 */
		export function findFiles(include: GlobPattern, exclude?: GlobPattern | null, maxResults?: number, token?: CancellationToken): Thenable<Uri[]>;

		/**
		 * Save all dirty files.
		 *
		 * @param includeUntitled Also save files that have been created during this session.
		 * @return A thenable that resolves when the files have been saved.
		 */
		export function saveAll(includeUntitled?: boolean): Thenable<boolean>;

		/**
		 * Make changes to one or many resources or create, delete, and rename resources as defined by the given
		 * [workspace edit](#WorkspaceEdit).
		 *
		 * All changes of a workspace edit are applied in the same order in which they have been added. If
		 * multiple textual inserts are made at the same position, these strings appear in the resulting text
		 * in the order the 'inserts' were made, unless that are interleaved with resource edits. Invalid sequences
		 * like 'delete file a' -> 'insert text in file a' cause failure of the operation.
		 *
		 * When applying a workspace edit that consists only of text edits an 'all-or-nothing'-strategy is used.
		 * A workspace edit with resource creations or deletions aborts the operation, e.g. consecutive edits will
		 * not be attempted, when a single edit fails.
		 *
		 * @param edit A workspace edit.
		 * @return A thenable that resolves when the edit could be applied.
		 */
		export function applyEdit(edit: WorkspaceEdit): Thenable<boolean>;

		/**
		 * All text documents currently known to the system.
		 */
		export const textDocuments: ReadonlyArray<TextDocument>;

		/**
		 * Opens a document. Will return early if this document is already open. Otherwise
		 * the document is loaded and the [didOpen](#workspace.onDidOpenTextDocument)-event fires.
		 *
		 * The document is denoted by an [uri](#Uri). Depending on the [scheme](#Uri.scheme) the
		 * following rules apply:
		 * * `file`-scheme: Open a file on disk, will be rejected if the file does not exist or cannot be loaded.
		 * * `untitled`-scheme: A new file that should be saved on disk, e.g. `untitled:c:\frodo\new.js`. The language
		 * will be derived from the file name.
		 * * For all other schemes contributed [text document content providers](#TextDocumentContentProvider) and
		 * [file system providers](#FileSystemProvider) are consulted.
		 *
		 * *Note* that the lifecycle of the returned document is owned by the editor and not by the extension. That means an
		 * [`onDidClose`](#workspace.onDidCloseTextDocument)-event can occur at any time after opening it.
		 *
		 * @param uri Identifies the resource to open.
		 * @return A promise that resolves to a [document](#TextDocument).
		 */
		export function openTextDocument(uri: Uri): Thenable<TextDocument>;

		/**
		 * A short-hand for `openTextDocument(Uri.file(fileName))`.
		 *
		 * @see [openTextDocument](#openTextDocument)
		 * @param fileName A name of a file on disk.
		 * @return A promise that resolves to a [document](#TextDocument).
		 */
		export function openTextDocument(fileName: string): Thenable<TextDocument>;

		/**
		 * Opens an untitled text document. The editor will prompt the user for a file
		 * path when the document is to be saved. The `options` parameter allows to
		 * specify the *language* and/or the *content* of the document.
		 *
		 * @param options Options to control how the document will be created.
		 * @return A promise that resolves to a [document](#TextDocument).
		 */
		export function openTextDocument(options?: { language?: string; content?: string; }): Thenable<TextDocument>;

		/**
		 * Register a text document content provider.
		 *
		 * Only one provider can be registered per scheme.
		 *
		 * @param scheme The uri-scheme to register for.
		 * @param provider A content provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable;

		/**
		 * An event that is emitted when a [text document](#TextDocument) is opened or when the language id
		 * of a text document [has been changed](#languages.setTextDocumentLanguage).
		 *
		 * To add an event listener when a visible text document is opened, use the [TextEditor](#TextEditor) events in the
		 * [window](#window) namespace. Note that:
		 *
		 * - The event is emitted before the [document](#TextDocument) is updated in the
		 * [active text editor](#window.activeTextEditor)
		 * - When a [text document](#TextDocument) is already open (e.g.: open in another [visible text editor](#window.visibleTextEditors)) this event is not emitted
		 *
		 */
		export const onDidOpenTextDocument: Event<TextDocument>;

		/**
		 * An event that is emitted when a [text document](#TextDocument) is disposed or when the language id
		 * of a text document [has been changed](#languages.setTextDocumentLanguage).
		 *
		 * *Note 1:* There is no guarantee that this event fires when an editor tab is closed, use the
		 * [`onDidChangeVisibleTextEditors`](#window.onDidChangeVisibleTextEditors)-event to know when editors change.
		 *
		 * *Note 2:* A document can be open but not shown in an editor which means this event can fire
		 * for a document that has not been shown in an editor.
		 */
		export const onDidCloseTextDocument: Event<TextDocument>;

		/**
		 * An event that is emitted when a [text document](#TextDocument) is changed. This usually happens
		 * when the [contents](#TextDocument.getText) changes but also when other things like the
		 * [dirty](#TextDocument.isDirty)-state changes.
		 */
		export const onDidChangeTextDocument: Event<TextDocumentChangeEvent>;

		/**
		 * An event that is emitted when a [text document](#TextDocument) will be saved to disk.
		 *
		 * *Note 1:* Subscribers can delay saving by registering asynchronous work. For the sake of data integrity the editor
		 * might save without firing this event. For instance when shutting down with dirty files.
		 *
		 * *Note 2:* Subscribers are called sequentially and they can [delay](#TextDocumentWillSaveEvent.waitUntil) saving
		 * by registering asynchronous work. Protection against misbehaving listeners is implemented as such:
		 *  * there is an overall time budget that all listeners share and if that is exhausted no further listener is called
		 *  * listeners that take a long time or produce errors frequently will not be called anymore
		 *
		 * The current thresholds are 1.5 seconds as overall time budget and a listener can misbehave 3 times before being ignored.
		 */
		export const onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>;

		/**
		 * An event that is emitted when a [text document](#TextDocument) is saved to disk.
		 */
		export const onDidSaveTextDocument: Event<TextDocument>;

		/**
		 * An event that is emitted when files are being created.
		 *
		 * *Note 1:* This event is triggered by user gestures, like creating a file from the
		 * explorer, or from the [`workspace.applyEdit`](#workspace.applyEdit)-api. This event is *not* fired when
		 * files change on disk, e.g triggered by another application, or when using the
		 * [`workspace.fs`](#FileSystem)-api.
		 *
		 * *Note 2:* When this event is fired, edits to files that are are being created cannot be applied.
		 */
		export const onWillCreateFiles: Event<FileWillCreateEvent>;

		/**
		 * An event that is emitted when files have been created.
		 *
		 * *Note:* This event is triggered by user gestures, like creating a file from the
		 * explorer, or from the [`workspace.applyEdit`](#workspace.applyEdit)-api, but this event is *not* fired when
		 * files change on disk, e.g triggered by another application, or when using the
		 * [`workspace.fs`](#FileSystem)-api.
		 */
		export const onDidCreateFiles: Event<FileCreateEvent>;

		/**
		 * An event that is emitted when files are being deleted.
		 *
		 * *Note 1:* This event is triggered by user gestures, like deleting a file from the
		 * explorer, or from the [`workspace.applyEdit`](#workspace.applyEdit)-api, but this event is *not* fired when
		 * files change on disk, e.g triggered by another application, or when using the
		 * [`workspace.fs`](#FileSystem)-api.
		 *
		 * *Note 2:* When deleting a folder with children only one event is fired.
		 */
		export const onWillDeleteFiles: Event<FileWillDeleteEvent>;

		/**
		 * An event that is emitted when files have been deleted.
		 *
		 * *Note 1:* This event is triggered by user gestures, like deleting a file from the
		 * explorer, or from the [`workspace.applyEdit`](#workspace.applyEdit)-api, but this event is *not* fired when
		 * files change on disk, e.g triggered by another application, or when using the
		 * [`workspace.fs`](#FileSystem)-api.
		 *
		 * *Note 2:* When deleting a folder with children only one event is fired.
		 */
		export const onDidDeleteFiles: Event<FileDeleteEvent>;

		/**
		 * An event that is emitted when files are being renamed.
		 *
		 * *Note 1:* This event is triggered by user gestures, like renaming a file from the
		 * explorer, and from the [`workspace.applyEdit`](#workspace.applyEdit)-api, but this event is *not* fired when
		 * files change on disk, e.g triggered by another application, or when using the
		 * [`workspace.fs`](#FileSystem)-api.
		 *
		 * *Note 2:* When renaming a folder with children only one event is fired.
		 */
		export const onWillRenameFiles: Event<FileWillRenameEvent>;

		/**
		 * An event that is emitted when files have been renamed.
		 *
		 * *Note 1:* This event is triggered by user gestures, like renaming a file from the
		 * explorer, and from the [`workspace.applyEdit`](#workspace.applyEdit)-api, but this event is *not* fired when
		 * files change on disk, e.g triggered by another application, or when using the
		 * [`workspace.fs`](#FileSystem)-api.
		 *
		 * *Note 2:* When renaming a folder with children only one event is fired.
		 */
		export const onDidRenameFiles: Event<FileRenameEvent>;

		/**
		 * Get a workspace configuration object.
		 *
		 * When a section-identifier is provided only that part of the configuration
		 * is returned. Dots in the section-identifier are interpreted as child-access,
		 * like `{ myExt: { setting: { doIt: true }}}` and `getConfiguration('myExt.setting').get('doIt') === true`.
		 *
		 * When a scope is provided configuration confined to that scope is returned. Scope can be a resource or a language identifier or both.
		 *
		 * @param section A dot-separated identifier.
		 * @param scope A scope for which the configuration is asked for.
		 * @return The full configuration or a subset.
		 */
		export function getConfiguration(section?: string | undefined, scope?: ConfigurationScope | null): WorkspaceConfiguration;

		/**
		 * An event that is emitted when the [configuration](#WorkspaceConfiguration) changed.
		 */
		export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;

		/**
		 * Register a task provider.
		 *
		 * @deprecated Use the corresponding function on the `tasks` namespace instead
		 *
		 * @param type The task kind type this provider is registered for.
		 * @param provider A task provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerTaskProvider(type: string, provider: TaskProvider): Disposable;

		/**
		 * Register a filesystem provider for a given scheme, e.g. `ftp`.
		 *
		 * There can only be one provider per scheme and an error is being thrown when a scheme
		 * has been claimed by another provider or when it is reserved.
		 *
		 * @param scheme The uri-[scheme](#Uri.scheme) the provider registers for.
		 * @param provider The filesystem provider.
		 * @param options Immutable metadata about the provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerFileSystemProvider(scheme: string, provider: FileSystemProvider, options?: { readonly isCaseSensitive?: boolean, readonly isReadonly?: boolean }): Disposable;
	}

	/**
	 * The configuration scope which can be a
	 * a 'resource' or a languageId or both or
	 * a '[TextDocument](#TextDocument)' or
	 * a '[WorkspaceFolder](#WorkspaceFolder)'
	 */
	export type ConfigurationScope = Uri | TextDocument | WorkspaceFolder | { uri?: Uri, languageId: string };

	/**
	 * An event describing the change in Configuration
	 */
	export interface ConfigurationChangeEvent {

		/**
		 * Checks if the given section has changed.
		 * If scope is provided, checks if the section has changed for resources under the given scope.
		 *
		 * @param section Configuration name, supports _dotted_ names.
		 * @param scope A scope in which to check.
		 * @return `true` if the given section has changed.
		 */
		affectsConfiguration(section: string, scope?: ConfigurationScope): boolean;
	}

	/**
	 * Namespace for participating in language-specific editor [features](https://code.visualstudio.com/docs/editor/editingevolved),
	 * like IntelliSense, code actions, diagnostics etc.
	 *
	 * Many programming languages exist and there is huge variety in syntaxes, semantics, and paradigms. Despite that, features
	 * like automatic word-completion, code navigation, or code checking have become popular across different tools for different
	 * programming languages.
	 *
	 * The editor provides an API that makes it simple to provide such common features by having all UI and actions already in place and
	 * by allowing you to participate by providing data only. For instance, to contribute a hover all you have to do is provide a function
	 * that can be called with a [TextDocument](#TextDocument) and a [Position](#Position) returning hover info. The rest, like tracking the
	 * mouse, positioning the hover, keeping the hover stable etc. is taken care of by the editor.
	 *
	 * ```javascript
	 * languages.registerHoverProvider('javascript', {
	 * 	provideHover(document, position, token) {
	 * 		return new Hover('I am a hover!');
	 * 	}
	 * });
	 * ```
	 *
	 * Registration is done using a [document selector](#DocumentSelector) which is either a language id, like `javascript` or
	 * a more complex [filter](#DocumentFilter) like `{ language: 'typescript', scheme: 'file' }`. Matching a document against such
	 * a selector will result in a [score](#languages.match) that is used to determine if and how a provider shall be used. When
	 * scores are equal the provider that came last wins. For features that allow full arity, like [hover](#languages.registerHoverProvider),
	 * the score is only checked to be `>0`, for other features, like [IntelliSense](#languages.registerCompletionItemProvider) the
	 * score is used for determining the order in which providers are asked to participate.
	 */
	export namespace languages {

		/**
		 * Return the identifiers of all known languages.
		 * @return Promise resolving to an array of identifier strings.
		 */
		export function getLanguages(): Thenable<string[]>;

		/**
		 * Set (and change) the [language](#TextDocument.languageId) that is associated
		 * with the given document.
		 *
		 * *Note* that calling this function will trigger the [`onDidCloseTextDocument`](#workspace.onDidCloseTextDocument) event
		 * followed by the [`onDidOpenTextDocument`](#workspace.onDidOpenTextDocument) event.
		 *
		 * @param document The document which language is to be changed
		 * @param languageId The new language identifier.
		 * @returns A thenable that resolves with the updated document.
		 */
		export function setTextDocumentLanguage(document: TextDocument, languageId: string): Thenable<TextDocument>;

		/**
		 * Compute the match between a document [selector](#DocumentSelector) and a document. Values
		 * greater than zero mean the selector matches the document.
		 *
		 * A match is computed according to these rules:
		 * 1. When [`DocumentSelector`](#DocumentSelector) is an array, compute the match for each contained `DocumentFilter` or language identifier and take the maximum value.
		 * 2. A string will be desugared to become the `language`-part of a [`DocumentFilter`](#DocumentFilter), so `"fooLang"` is like `{ language: "fooLang" }`.
		 * 3. A [`DocumentFilter`](#DocumentFilter) will be matched against the document by comparing its parts with the document. The following rules apply:
		 *  1. When the `DocumentFilter` is empty (`{}`) the result is `0`
		 *  2. When `scheme`, `language`, or `pattern` are defined but one doesn’t match, the result is `0`
		 *  3. Matching against `*` gives a score of `5`, matching via equality or via a glob-pattern gives a score of `10`
		 *  4. The result is the maximum value of each match
		 *
		 * Samples:
		 * ```js
		 * // default document from disk (file-scheme)
		 * doc.uri; //'file:///my/file.js'
		 * doc.languageId; // 'javascript'
		 * match('javascript', doc); // 10;
		 * match({language: 'javascript'}, doc); // 10;
		 * match({language: 'javascript', scheme: 'file'}, doc); // 10;
		 * match('*', doc); // 5
		 * match('fooLang', doc); // 0
		 * match(['fooLang', '*'], doc); // 5
		 *
		 * // virtual document, e.g. from git-index
		 * doc.uri; // 'git:/my/file.js'
		 * doc.languageId; // 'javascript'
		 * match('javascript', doc); // 10;
		 * match({language: 'javascript', scheme: 'git'}, doc); // 10;
		 * match('*', doc); // 5
		 * ```
		 *
		 * @param selector A document selector.
		 * @param document A text document.
		 * @return A number `>0` when the selector matches and `0` when the selector does not match.
		 */
		export function match(selector: DocumentSelector, document: TextDocument): number;

		/**
		 * An [event](#Event) which fires when the global set of diagnostics changes. This is
		 * newly added and removed diagnostics.
		 */
		export const onDidChangeDiagnostics: Event<DiagnosticChangeEvent>;

		/**
		 * Get all diagnostics for a given resource.
		 *
		 * @param resource A resource
		 * @returns An array of [diagnostics](#Diagnostic) objects or an empty array.
		 */
		export function getDiagnostics(resource: Uri): Diagnostic[];

		/**
		 * Get all diagnostics.
		 *
		 * @returns An array of uri-diagnostics tuples or an empty array.
		 */
		export function getDiagnostics(): [Uri, Diagnostic[]][];

		/**
		 * Create a diagnostics collection.
		 *
		 * @param name The [name](#DiagnosticCollection.name) of the collection.
		 * @return A new diagnostic collection.
		 */
		export function createDiagnosticCollection(name?: string): DiagnosticCollection;

		/**
		 * Register a completion provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and groups of equal score are sequentially asked for
		 * completion items. The process stops when one or many providers of a group return a
		 * result. A failing provider (rejected promise or exception) will not fail the whole
		 * operation.
		 *
		 * A completion item provider can be associated with a set of `triggerCharacters`. When trigger
		 * characters are being typed, completions are requested but only from providers that registered
		 * the typed character. Because of that trigger characters should be different than [word characters](#LanguageConfiguration.wordPattern),
		 * a common trigger character is `.` to trigger member completions.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A completion provider.
		 * @param triggerCharacters Trigger completion when the user types one of the characters.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerCompletionItemProvider(selector: DocumentSelector, provider: CompletionItemProvider, ...triggerCharacters: string[]): Disposable;

		/**
		 * Register a code action provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A code action provider.
		 * @param metadata Metadata about the kind of code actions the provider provides.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerCodeActionsProvider(selector: DocumentSelector, provider: CodeActionProvider, metadata?: CodeActionProviderMetadata): Disposable;

		/**
		 * Register a code lens provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A code lens provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable;

		/**
		 * Register a definition provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A definition provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDefinitionProvider(selector: DocumentSelector, provider: DefinitionProvider): Disposable;

		/**
		 * Register an implementation provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider An implementation provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerImplementationProvider(selector: DocumentSelector, provider: ImplementationProvider): Disposable;

		/**
		 * Register a type definition provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A type definition provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerTypeDefinitionProvider(selector: DocumentSelector, provider: TypeDefinitionProvider): Disposable;

		/**
		 * Register a declaration provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A declaration provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDeclarationProvider(selector: DocumentSelector, provider: DeclarationProvider): Disposable;

		/**
		 * Register a hover provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A hover provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable;

		/**
		 * Register a provider that locates evaluatable expressions in text documents.
		 * VS Code will evaluate the expression in the active debug session and will show the result in the debug hover.
		 *
		 * If multiple providers are registered for a language an arbitrary provider will be used.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider An evaluatable expression provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerEvaluatableExpressionProvider(selector: DocumentSelector, provider: EvaluatableExpressionProvider): Disposable;

		/**
		 * Register a document highlight provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and groups sequentially asked for document highlights.
		 * The process stops when a provider returns a `non-falsy` or `non-failure` result.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document highlight provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentHighlightProvider(selector: DocumentSelector, provider: DocumentHighlightProvider): Disposable;

		/**
		 * Register a document symbol provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document symbol provider.
		 * @param metaData metadata about the provider
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentSymbolProvider(selector: DocumentSelector, provider: DocumentSymbolProvider, metaData?: DocumentSymbolProviderMetadata): Disposable;

		/**
		 * Register a workspace symbol provider.
		 *
		 * Multiple providers can be registered. In that case providers are asked in parallel and
		 * the results are merged. A failing provider (rejected promise or exception) will not cause
		 * a failure of the whole operation.
		 *
		 * @param provider A workspace symbol provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerWorkspaceSymbolProvider(provider: WorkspaceSymbolProvider): Disposable;

		/**
		 * Register a reference provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A reference provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerReferenceProvider(selector: DocumentSelector, provider: ReferenceProvider): Disposable;

		/**
		 * Register a rename provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and asked in sequence. The first provider producing a result
		 * defines the result of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A rename provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerRenameProvider(selector: DocumentSelector, provider: RenameProvider): Disposable;

		/**
		 * Register a semantic tokens provider for a whole document.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document semantic tokens provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentSemanticTokensProvider(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable;

		/**
		 * Register a semantic tokens provider for a document range.
		 *
		 * *Note:* If a document has both a `DocumentSemanticTokensProvider` and a `DocumentRangeSemanticTokensProvider`,
		 * the range provider will be invoked only initially, for the time in which the full document provider takes
		 * to resolve the first request. Once the full document provider resolves the first request, the semantic tokens
		 * provided via the range provider will be discarded and from that point forward, only the document provider
		 * will be used.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document range semantic tokens provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentRangeSemanticTokensProvider(selector: DocumentSelector, provider: DocumentRangeSemanticTokensProvider, legend: SemanticTokensLegend): Disposable;

		/**
		 * Register a formatting provider for a document.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document formatting edit provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentFormattingEditProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider): Disposable;

		/**
		 * Register a formatting provider for a document range.
		 *
		 * *Note:* A document range provider is also a [document formatter](#DocumentFormattingEditProvider)
		 * which means there is no need to [register](#languages.registerDocumentFormattingEditProvider) a document
		 * formatter when also registering a range provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document range formatting edit provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentRangeFormattingEditProvider(selector: DocumentSelector, provider: DocumentRangeFormattingEditProvider): Disposable;

		/**
		 * Register a formatting provider that works on type. The provider is active when the user enables the setting `editor.formatOnType`.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider An on type formatting edit provider.
		 * @param firstTriggerCharacter A character on which formatting should be triggered, like `}`.
		 * @param moreTriggerCharacter More trigger characters.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerOnTypeFormattingEditProvider(selector: DocumentSelector, provider: OnTypeFormattingEditProvider, firstTriggerCharacter: string, ...moreTriggerCharacter: string[]): Disposable;

		/**
		 * Register a signature help provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and called sequentially until a provider returns a
		 * valid result.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A signature help provider.
		 * @param triggerCharacters Trigger signature help when the user types one of the characters, like `,` or `(`.
		 * @param metadata Information about the provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerSignatureHelpProvider(selector: DocumentSelector, provider: SignatureHelpProvider, ...triggerCharacters: string[]): Disposable;
		export function registerSignatureHelpProvider(selector: DocumentSelector, provider: SignatureHelpProvider, metadata: SignatureHelpProviderMetadata): Disposable;

		/**
		 * Register a document link provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A document link provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable;

		/**
		 * Register a color provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A color provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerColorProvider(selector: DocumentSelector, provider: DocumentColorProvider): Disposable;

		/**
		 * Register a folding range provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged.
		 * If multiple folding ranges start at the same position, only the range of the first registered provider is used.
		 * If a folding range overlaps with an other range that has a smaller position, it is also ignored.
		 *
		 * A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A folding range provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerFoldingRangeProvider(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable;

		/**
		 * Register a selection range provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A selection range provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerSelectionRangeProvider(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable;

		/**
		 * Register a call hierarchy provider.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A call hierarchy provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerCallHierarchyProvider(selector: DocumentSelector, provider: CallHierarchyProvider): Disposable;

		/**
		 * Register a linked editing range provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are sorted
		 * by their [score](#languages.match) and the best-matching provider that has a result is used. Failure
		 * of the selected provider will cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider A linked editing range provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerLinkedEditingRangeProvider(selector: DocumentSelector, provider: LinkedEditingRangeProvider): Disposable;

		/**
		 * Set a [language configuration](#LanguageConfiguration) for a language.
		 *
		 * @param language A language identifier like `typescript`.
		 * @param configuration Language configuration.
		 * @return A [disposable](#Disposable) that unsets this configuration.
		 */
		export function setLanguageConfiguration(language: string, configuration: LanguageConfiguration): Disposable;

	}

	/**
	 * Represents the input box in the Source Control viewlet.
	 */
	export interface SourceControlInputBox {

		/**
		 * Setter and getter for the contents of the input box.
		 */
		value: string;

		/**
		 * A string to show as placeholder in the input box to guide the user.
		 */
		placeholder: string;

		/**
		 * Controls whether the input box is visible (default is `true`).
		 */
		visible: boolean;
	}

	interface QuickDiffProvider {

		/**
		 * Provide a [uri](#Uri) to the original resource of any given resource uri.
		 *
		 * @param uri The uri of the resource open in a text editor.
		 * @param token A cancellation token.
		 * @return A thenable that resolves to uri of the matching original resource.
		 */
		provideOriginalResource?(uri: Uri, token: CancellationToken): ProviderResult<Uri>;
	}

	/**
	 * The theme-aware decorations for a
	 * [source control resource state](#SourceControlResourceState).
	 */
	export interface SourceControlResourceThemableDecorations {

		/**
		 * The icon path for a specific
		 * [source control resource state](#SourceControlResourceState).
		 */
		readonly iconPath?: string | Uri;
	}

	/**
	 * The decorations for a [source control resource state](#SourceControlResourceState).
	 * Can be independently specified for light and dark themes.
	 */
	export interface SourceControlResourceDecorations extends SourceControlResourceThemableDecorations {

		/**
		 * Whether the [source control resource state](#SourceControlResourceState) should
		 * be striked-through in the UI.
		 */
		readonly strikeThrough?: boolean;

		/**
		 * Whether the [source control resource state](#SourceControlResourceState) should
		 * be faded in the UI.
		 */
		readonly faded?: boolean;

		/**
		 * The title for a specific
		 * [source control resource state](#SourceControlResourceState).
		 */
		readonly tooltip?: string;

		/**
		 * The light theme decorations.
		 */
		readonly light?: SourceControlResourceThemableDecorations;

		/**
		 * The dark theme decorations.
		 */
		readonly dark?: SourceControlResourceThemableDecorations;
	}

	/**
	 * An source control resource state represents the state of an underlying workspace
	 * resource within a certain [source control group](#SourceControlResourceGroup).
	 */
	export interface SourceControlResourceState {

		/**
		 * The [uri](#Uri) of the underlying resource inside the workspace.
		 */
		readonly resourceUri: Uri;

		/**
		 * The [command](#Command) which should be run when the resource
		 * state is open in the Source Control viewlet.
		 */
		readonly command?: Command;

		/**
		 * The [decorations](#SourceControlResourceDecorations) for this source control
		 * resource state.
		 */
		readonly decorations?: SourceControlResourceDecorations;

		/**
		 * Context value of the resource state. This can be used to contribute resource specific actions.
		 * For example, if a resource is given a context value as `diffable`. When contributing actions to `scm/resourceState/context`
		 * using `menus` extension point, you can specify context value for key `scmResourceState` in `when` expressions, like `scmResourceState == diffable`.
		 * ```
		 *	"contributes": {
		 *		"menus": {
		 *			"scm/resourceState/context": [
		 *				{
		 *					"command": "extension.diff",
		 *					"when": "scmResourceState == diffable"
		 *				}
		 *			]
		 *		}
		 *	}
		 * ```
		 * This will show action `extension.diff` only for resources with `contextValue` is `diffable`.
		 */
		readonly contextValue?: string;
	}

	/**
	 * A source control resource group is a collection of
	 * [source control resource states](#SourceControlResourceState).
	 */
	export interface SourceControlResourceGroup {

		/**
		 * The id of this source control resource group.
		 */
		readonly id: string;

		/**
		 * The label of this source control resource group.
		 */
		label: string;

		/**
		 * Whether this source control resource group is hidden when it contains
		 * no [source control resource states](#SourceControlResourceState).
		 */
		hideWhenEmpty?: boolean;

		/**
		 * This group's collection of
		 * [source control resource states](#SourceControlResourceState).
		 */
		resourceStates: SourceControlResourceState[];

		/**
		 * Dispose this source control resource group.
		 */
		dispose(): void;
	}

	/**
	 * An source control is able to provide [resource states](#SourceControlResourceState)
	 * to the editor and interact with the editor in several source control related ways.
	 */
	export interface SourceControl {

		/**
		 * The id of this source control.
		 */
		readonly id: string;

		/**
		 * The human-readable label of this source control.
		 */
		readonly label: string;

		/**
		 * The (optional) Uri of the root of this source control.
		 */
		readonly rootUri: Uri | undefined;

		/**
		 * The [input box](#SourceControlInputBox) for this source control.
		 */
		readonly inputBox: SourceControlInputBox;

		/**
		 * The UI-visible count of [resource states](#SourceControlResourceState) of
		 * this source control.
		 *
		 * Equals to the total number of [resource state](#SourceControlResourceState)
		 * of this source control, if undefined.
		 */
		count?: number;

		/**
		 * An optional [quick diff provider](#QuickDiffProvider).
		 */
		quickDiffProvider?: QuickDiffProvider;

		/**
		 * Optional commit template string.
		 *
		 * The Source Control viewlet will populate the Source Control
		 * input with this value when appropriate.
		 */
		commitTemplate?: string;

		/**
		 * Optional accept input command.
		 *
		 * This command will be invoked when the user accepts the value
		 * in the Source Control input.
		 */
		acceptInputCommand?: Command;

		/**
		 * Optional status bar commands.
		 *
		 * These commands will be displayed in the editor's status bar.
		 */
		statusBarCommands?: Command[];

		/**
		 * Create a new [resource group](#SourceControlResourceGroup).
		 */
		createResourceGroup(id: string, label: string): SourceControlResourceGroup;

		/**
		 * Dispose this source control.
		 */
		dispose(): void;
	}

	export namespace scm {

		/**
		 * The [input box](#SourceControlInputBox) for the last source control
		 * created by the extension.
		 *
		 * @deprecated Use SourceControl.inputBox instead
		 */
		export const inputBox: SourceControlInputBox;

		/**
		 * Creates a new [source control](#SourceControl) instance.
		 *
		 * @param id An `id` for the source control. Something short, e.g.: `git`.
		 * @param label A human-readable string for the source control. E.g.: `Git`.
		 * @param rootUri An optional Uri of the root of the source control. E.g.: `Uri.parse(workspaceRoot)`.
		 * @return An instance of [source control](#SourceControl).
		 */
		export function createSourceControl(id: string, label: string, rootUri?: Uri): SourceControl;
	}

	/**
	 * A DebugProtocolMessage is an opaque stand-in type for the [ProtocolMessage](https://microsoft.github.io/debug-adapter-protocol/specification#Base_Protocol_ProtocolMessage) type defined in the Debug Adapter Protocol.
	 */
	export interface DebugProtocolMessage {
		// Properties: see details [here](https://microsoft.github.io/debug-adapter-protocol/specification#Base_Protocol_ProtocolMessage).
	}

	/**
	 * A DebugProtocolSource is an opaque stand-in type for the [Source](https://microsoft.github.io/debug-adapter-protocol/specification#Types_Source) type defined in the Debug Adapter Protocol.
	 */
	export interface DebugProtocolSource {
		// Properties: see details [here](https://microsoft.github.io/debug-adapter-protocol/specification#Types_Source).
	}

	/**
	 * A DebugProtocolBreakpoint is an opaque stand-in type for the [Breakpoint](https://microsoft.github.io/debug-adapter-protocol/specification#Types_Breakpoint) type defined in the Debug Adapter Protocol.
	 */
	export interface DebugProtocolBreakpoint {
		// Properties: see details [here](https://microsoft.github.io/debug-adapter-protocol/specification#Types_Breakpoint).
	}

	/**
	 * Configuration for a debug session.
	 */
	export interface DebugConfiguration {
		/**
		 * The type of the debug session.
		 */
		type: string;

		/**
		 * The name of the debug session.
		 */
		name: string;

		/**
		 * The request type of the debug session.
		 */
		request: string;

		/**
		 * Additional debug type specific properties.
		 */
		[key: string]: any;
	}

	/**
	 * A debug session.
	 */
	export interface DebugSession {

		/**
		 * The unique ID of this debug session.
		 */
		readonly id: string;

		/**
		 * The debug session's type from the [debug configuration](#DebugConfiguration).
		 */
		readonly type: string;

		/**
		 * The debug session's name is initially taken from the [debug configuration](#DebugConfiguration).
		 * Any changes will be properly reflected in the UI.
		 */
		name: string;

		/**
		 * The workspace folder of this session or `undefined` for a folderless setup.
		 */
		readonly workspaceFolder: WorkspaceFolder | undefined;

		/**
		 * The "resolved" [debug configuration](#DebugConfiguration) of this session.
		 * "Resolved" means that
		 * - all variables have been substituted and
		 * - platform specific attribute sections have been "flattened" for the matching platform and removed for non-matching platforms.
		 */
		readonly configuration: DebugConfiguration;

		/**
		 * Send a custom request to the debug adapter.
		 */
		customRequest(command: string, args?: any): Thenable<any>;

		/**
		 * Maps a VS Code breakpoint to the corresponding Debug Adapter Protocol (DAP) breakpoint that is managed by the debug adapter of the debug session.
		 * If no DAP breakpoint exists (either because the VS Code breakpoint was not yet registered or because the debug adapter is not interested in the breakpoint), the value `undefined` is returned.
		 *
		 * @param breakpoint A VS Code [breakpoint](#Breakpoint).
		 * @return A promise that resolves to the Debug Adapter Protocol breakpoint or `undefined`.
		 */
		getDebugProtocolBreakpoint(breakpoint: Breakpoint): Thenable<DebugProtocolBreakpoint | undefined>;
	}

	/**
	 * A custom Debug Adapter Protocol event received from a [debug session](#DebugSession).
	 */
	export interface DebugSessionCustomEvent {
		/**
		 * The [debug session](#DebugSession) for which the custom event was received.
		 */
		readonly session: DebugSession;

		/**
		 * Type of event.
		 */
		readonly event: string;

		/**
		 * Event specific information.
		 */
		readonly body?: any;
	}

	/**
	 * A debug configuration provider allows to add debug configurations to the debug service
	 * and to resolve launch configurations before they are used to start a debug session.
	 * A debug configuration provider is registered via #debug.registerDebugConfigurationProvider.
	 */
	export interface DebugConfigurationProvider {
		/**
		 * Provides [debug configuration](#DebugConfiguration) to the debug service. If more than one debug configuration provider is
		 * registered for the same type, debug configurations are concatenated in arbitrary order.
		 *
		 * @param folder The workspace folder for which the configurations are used or `undefined` for a folderless setup.
		 * @param token A cancellation token.
		 * @return An array of [debug configurations](#DebugConfiguration).
		 */
		provideDebugConfigurations?(folder: WorkspaceFolder | undefined, token?: CancellationToken): ProviderResult<DebugConfiguration[]>;

		/**
		 * Resolves a [debug configuration](#DebugConfiguration) by filling in missing values or by adding/changing/removing attributes.
		 * If more than one debug configuration provider is registered for the same type, the resolveDebugConfiguration calls are chained
		 * in arbitrary order and the initial debug configuration is piped through the chain.
		 * Returning the value 'undefined' prevents the debug session from starting.
		 * Returning the value 'null' prevents the debug session from starting and opens the underlying debug configuration instead.
		 *
		 * @param folder The workspace folder from which the configuration originates from or `undefined` for a folderless setup.
		 * @param debugConfiguration The [debug configuration](#DebugConfiguration) to resolve.
		 * @param token A cancellation token.
		 * @return The resolved debug configuration or undefined or null.
		 */
		resolveDebugConfiguration?(folder: WorkspaceFolder | undefined, debugConfiguration: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration>;

		/**
		 * This hook is directly called after 'resolveDebugConfiguration' but with all variables substituted.
		 * It can be used to resolve or verify a [debug configuration](#DebugConfiguration) by filling in missing values or by adding/changing/removing attributes.
		 * If more than one debug configuration provider is registered for the same type, the 'resolveDebugConfigurationWithSubstitutedVariables' calls are chained
		 * in arbitrary order and the initial debug configuration is piped through the chain.
		 * Returning the value 'undefined' prevents the debug session from starting.
		 * Returning the value 'null' prevents the debug session from starting and opens the underlying debug configuration instead.
		 *
		 * @param folder The workspace folder from which the configuration originates from or `undefined` for a folderless setup.
		 * @param debugConfiguration The [debug configuration](#DebugConfiguration) to resolve.
		 * @param token A cancellation token.
		 * @return The resolved debug configuration or undefined or null.
		 */
		resolveDebugConfigurationWithSubstitutedVariables?(folder: WorkspaceFolder | undefined, debugConfiguration: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration>;
	}

	/**
	 * Represents a debug adapter executable and optional arguments and runtime options passed to it.
	 */
	export class DebugAdapterExecutable {

		/**
		 * Creates a description for a debug adapter based on an executable program.
		 *
		 * @param command The command or executable path that implements the debug adapter.
		 * @param args Optional arguments to be passed to the command or executable.
		 * @param options Optional options to be used when starting the command or executable.
		 */
		constructor(command: string, args?: string[], options?: DebugAdapterExecutableOptions);

		/**
		 * The command or path of the debug adapter executable.
		 * A command must be either an absolute path of an executable or the name of an command to be looked up via the PATH environment variable.
		 * The special value 'node' will be mapped to VS Code's built-in Node.js runtime.
		 */
		readonly command: string;

		/**
		 * The arguments passed to the debug adapter executable. Defaults to an empty array.
		 */
		readonly args: string[];

		/**
		 * Optional options to be used when the debug adapter is started.
		 * Defaults to undefined.
		 */
		readonly options?: DebugAdapterExecutableOptions;
	}

	/**
	 * Options for a debug adapter executable.
	 */
	export interface DebugAdapterExecutableOptions {

		/**
		 * The additional environment of the executed program or shell. If omitted
		 * the parent process' environment is used. If provided it is merged with
		 * the parent process' environment.
		 */
		env?: { [key: string]: string };

		/**
		 * The current working directory for the executed debug adapter.
		 */
		cwd?: string;
	}

	/**
	 * Represents a debug adapter running as a socket based server.
	 */
	export class DebugAdapterServer {

		/**
		 * The port.
		 */
		readonly port: number;

		/**
		 * The host.
		 */
		readonly host?: string;

		/**
		 * Create a description for a debug adapter running as a socket based server.
		 */
		constructor(port: number, host?: string);
	}

	/**
	 * Represents a debug adapter running as a Named Pipe (on Windows)/UNIX Domain Socket (on non-Windows) based server.
	 */
	export class DebugAdapterNamedPipeServer {
		/**
		 * The path to the NamedPipe/UNIX Domain Socket.
		 */
		readonly path: string;

		/**
		 * Create a description for a debug adapter running as a socket based server.
		 */
		constructor(path: string);
	}

	/**
	 * A debug adapter that implements the Debug Adapter Protocol can be registered with VS Code if it implements the DebugAdapter interface.
	 */
	export interface DebugAdapter extends Disposable {

		/**
		 * An event which fires after the debug adapter has sent a Debug Adapter Protocol message to VS Code.
		 * Messages can be requests, responses, or events.
		 */
		readonly onDidSendMessage: Event<DebugProtocolMessage>;

		/**
		 * Handle a Debug Adapter Protocol message.
		 * Messages can be requests, responses, or events.
		 * Results or errors are returned via onSendMessage events.
		 * @param message A Debug Adapter Protocol message
		 */
		handleMessage(message: DebugProtocolMessage): void;
	}

	/**
	 * A debug adapter descriptor for an inline implementation.
	 */
	export class DebugAdapterInlineImplementation {

		/**
		 * Create a descriptor for an inline implementation of a debug adapter.
		 */
		constructor(implementation: DebugAdapter);
	}

	export type DebugAdapterDescriptor = DebugAdapterExecutable | DebugAdapterServer | DebugAdapterNamedPipeServer | DebugAdapterInlineImplementation;

	export interface DebugAdapterDescriptorFactory {
		/**
		 * 'createDebugAdapterDescriptor' is called at the start of a debug session to provide details about the debug adapter to use.
		 * These details must be returned as objects of type [DebugAdapterDescriptor](#DebugAdapterDescriptor).
		 * Currently two types of debug adapters are supported:
		 * - a debug adapter executable is specified as a command path and arguments (see [DebugAdapterExecutable](#DebugAdapterExecutable)),
		 * - a debug adapter server reachable via a communication port (see [DebugAdapterServer](#DebugAdapterServer)).
		 * If the method is not implemented the default behavior is this:
		 *   createDebugAdapter(session: DebugSession, executable: DebugAdapterExecutable) {
		 *      if (typeof session.configuration.debugServer === 'number') {
		 *         return new DebugAdapterServer(session.configuration.debugServer);
		 *      }
		 *      return executable;
		 *   }
		 * @param session The [debug session](#DebugSession) for which the debug adapter will be used.
		 * @param executable The debug adapter's executable information as specified in the package.json (or undefined if no such information exists).
		 * @return a [debug adapter descriptor](#DebugAdapterDescriptor) or undefined.
		 */
		createDebugAdapterDescriptor(session: DebugSession, executable: DebugAdapterExecutable | undefined): ProviderResult<DebugAdapterDescriptor>;
	}

	/**
	 * A Debug Adapter Tracker is a means to track the communication between VS Code and a Debug Adapter.
	 */
	export interface DebugAdapterTracker {
		/**
		 * A session with the debug adapter is about to be started.
		 */
		onWillStartSession?(): void;
		/**
		 * The debug adapter is about to receive a Debug Adapter Protocol message from VS Code.
		 */
		onWillReceiveMessage?(message: any): void;
		/**
		 * The debug adapter has sent a Debug Adapter Protocol message to VS Code.
		 */
		onDidSendMessage?(message: any): void;
		/**
		 * The debug adapter session is about to be stopped.
		 */
		onWillStopSession?(): void;
		/**
		 * An error with the debug adapter has occurred.
		 */
		onError?(error: Error): void;
		/**
		 * The debug adapter has exited with the given exit code or signal.
		 */
		onExit?(code: number | undefined, signal: string | undefined): void;
	}

	export interface DebugAdapterTrackerFactory {
		/**
		 * The method 'createDebugAdapterTracker' is called at the start of a debug session in order
		 * to return a "tracker" object that provides read-access to the communication between VS Code and a debug adapter.
		 *
		 * @param session The [debug session](#DebugSession) for which the debug adapter tracker will be used.
		 * @return A [debug adapter tracker](#DebugAdapterTracker) or undefined.
		 */
		createDebugAdapterTracker(session: DebugSession): ProviderResult<DebugAdapterTracker>;
	}

	/**
	 * Represents the debug console.
	 */
	export interface DebugConsole {
		/**
		 * Append the given value to the debug console.
		 *
		 * @param value A string, falsy values will not be printed.
		 */
		append(value: string): void;

		/**
		 * Append the given value and a line feed character
		 * to the debug console.
		 *
		 * @param value A string, falsy values will be printed.
		 */
		appendLine(value: string): void;
	}

	/**
	 * An event describing the changes to the set of [breakpoints](#Breakpoint).
	 */
	export interface BreakpointsChangeEvent {
		/**
		 * Added breakpoints.
		 */
		readonly added: ReadonlyArray<Breakpoint>;

		/**
		 * Removed breakpoints.
		 */
		readonly removed: ReadonlyArray<Breakpoint>;

		/**
		 * Changed breakpoints.
		 */
		readonly changed: ReadonlyArray<Breakpoint>;
	}

	/**
	 * The base class of all breakpoint types.
	 */
	export class Breakpoint {
		/**
		 * The unique ID of the breakpoint.
		 */
		readonly id: string;
		/**
		 * Is breakpoint enabled.
		 */
		readonly enabled: boolean;
		/**
		 * An optional expression for conditional breakpoints.
		 */
		readonly condition?: string;
		/**
		 * An optional expression that controls how many hits of the breakpoint are ignored.
		 */
		readonly hitCondition?: string;
		/**
		 * An optional message that gets logged when this breakpoint is hit. Embedded expressions within {} are interpolated by the debug adapter.
		 */
		readonly logMessage?: string;

		protected constructor(enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string);
	}

	/**
	 * A breakpoint specified by a source location.
	 */
	export class SourceBreakpoint extends Breakpoint {
		/**
		 * The source and line position of this breakpoint.
		 */
		readonly location: Location;

		/**
		 * Create a new breakpoint for a source location.
		 */
		constructor(location: Location, enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string);
	}

	/**
	 * A breakpoint specified by a function name.
	 */
	export class FunctionBreakpoint extends Breakpoint {
		/**
		 * The name of the function to which this breakpoint is attached.
		 */
		readonly functionName: string;

		/**
		 * Create a new function breakpoint.
		 */
		constructor(functionName: string, enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string);
	}

	/**
	 * Debug console mode used by debug session, see [options](#DebugSessionOptions).
	 */
	export enum DebugConsoleMode {
		/**
		 * Debug session should have a separate debug console.
		 */
		Separate = 0,

		/**
		 * Debug session should share debug console with its parent session.
		 * This value has no effect for sessions which do not have a parent session.
		 */
		MergeWithParent = 1
	}

	/**
	 * Options for [starting a debug session](#debug.startDebugging).
	 */
	export interface DebugSessionOptions {

		/**
		 * When specified the newly created debug session is registered as a "child" session of this
		 * "parent" debug session.
		 */
		parentSession?: DebugSession;

		/**
		 * Controls whether this session should have a separate debug console or share it
		 * with the parent session. Has no effect for sessions which do not have a parent session.
		 * Defaults to Separate.
		 */
		consoleMode?: DebugConsoleMode;

		/**
		 * Controls whether this session should run without debugging, thus ignoring breakpoints.
		 * When this property is not specified, the value from the parent session (if there is one) is used.
		 */
		noDebug?: boolean;

		/**
		 * Controls if the debug session's parent session is shown in the CALL STACK view even if it has only a single child.
		 * By default, the debug session will never hide its parent.
		 * If compact is true, debug sessions with a single child are hidden in the CALL STACK view to make the tree more compact.
		 */
		compact?: boolean;
	}

	/**
	 * A DebugConfigurationProviderTriggerKind specifies when the `provideDebugConfigurations` method of a `DebugConfigurationProvider` is triggered.
	 * Currently there are two situations: to provide the initial debug configurations for a newly created launch.json or
	 * to provide dynamically generated debug configurations when the user asks for them through the UI (e.g. via the "Select and Start Debugging" command).
	 * A trigger kind is used when registering a `DebugConfigurationProvider` with #debug.registerDebugConfigurationProvider.
	 */
	export enum DebugConfigurationProviderTriggerKind {
		/**
		 *	`DebugConfigurationProvider.provideDebugConfigurations` is called to provide the initial debug configurations for a newly created launch.json.
		 */
		Initial = 1,
		/**
		 * `DebugConfigurationProvider.provideDebugConfigurations` is called to provide dynamically generated debug configurations when the user asks for them through the UI (e.g. via the "Select and Start Debugging" command).
		 */
		Dynamic = 2
	}

	/**
	 * Namespace for debug functionality.
	 */
	export namespace debug {

		/**
		 * The currently active [debug session](#DebugSession) or `undefined`. The active debug session is the one
		 * represented by the debug action floating window or the one currently shown in the drop down menu of the debug action floating window.
		 * If no debug session is active, the value is `undefined`.
		 */
		export let activeDebugSession: DebugSession | undefined;

		/**
		 * The currently active [debug console](#DebugConsole).
		 * If no debug session is active, output sent to the debug console is not shown.
		 */
		export let activeDebugConsole: DebugConsole;

		/**
		 * List of breakpoints.
		 */
		export let breakpoints: Breakpoint[];

		/**
		 * An [event](#Event) which fires when the [active debug session](#debug.activeDebugSession)
		 * has changed. *Note* that the event also fires when the active debug session changes
		 * to `undefined`.
		 */
		export const onDidChangeActiveDebugSession: Event<DebugSession | undefined>;

		/**
		 * An [event](#Event) which fires when a new [debug session](#DebugSession) has been started.
		 */
		export const onDidStartDebugSession: Event<DebugSession>;

		/**
		 * An [event](#Event) which fires when a custom DAP event is received from the [debug session](#DebugSession).
		 */
		export const onDidReceiveDebugSessionCustomEvent: Event<DebugSessionCustomEvent>;

		/**
		 * An [event](#Event) which fires when a [debug session](#DebugSession) has terminated.
		 */
		export const onDidTerminateDebugSession: Event<DebugSession>;

		/**
		 * An [event](#Event) that is emitted when the set of breakpoints is added, removed, or changed.
		 */
		export const onDidChangeBreakpoints: Event<BreakpointsChangeEvent>;

		/**
		 * Register a [debug configuration provider](#DebugConfigurationProvider) for a specific debug type.
		 * The optional [triggerKind](#DebugConfigurationProviderTriggerKind) can be used to specify when the `provideDebugConfigurations` method of the provider is triggered.
		 * Currently two trigger kinds are possible: with the value `Initial` (or if no trigger kind argument is given) the `provideDebugConfigurations` method is used to provide the initial debug configurations to be copied into a newly created launch.json.
		 * With the trigger kind `Dynamic` the `provideDebugConfigurations` method is used to dynamically determine debug configurations to be presented to the user (in addition to the static configurations from the launch.json).
		 * Please note that the `triggerKind` argument only applies to the `provideDebugConfigurations` method: so the `resolveDebugConfiguration` methods are not affected at all.
		 * Registering a single provider with resolve methods for different trigger kinds, results in the same resolve methods called multiple times.
		 * More than one provider can be registered for the same type.
		 *
		 * @param type The debug type for which the provider is registered.
		 * @param provider The [debug configuration provider](#DebugConfigurationProvider) to register.
		 * @param triggerKind The [trigger](#DebugConfigurationProviderTrigger) for which the 'provideDebugConfiguration' method of the provider is registered. If `triggerKind` is missing, the value `DebugConfigurationProviderTriggerKind.Initial` is assumed.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerDebugConfigurationProvider(debugType: string, provider: DebugConfigurationProvider, triggerKind?: DebugConfigurationProviderTriggerKind): Disposable;

		/**
		 * Register a [debug adapter descriptor factory](#DebugAdapterDescriptorFactory) for a specific debug type.
		 * An extension is only allowed to register a DebugAdapterDescriptorFactory for the debug type(s) defined by the extension. Otherwise an error is thrown.
		 * Registering more than one DebugAdapterDescriptorFactory for a debug type results in an error.
		 *
		 * @param debugType The debug type for which the factory is registered.
		 * @param factory The [debug adapter descriptor factory](#DebugAdapterDescriptorFactory) to register.
		 * @return A [disposable](#Disposable) that unregisters this factory when being disposed.
		 */
		export function registerDebugAdapterDescriptorFactory(debugType: string, factory: DebugAdapterDescriptorFactory): Disposable;

		/**
		 * Register a debug adapter tracker factory for the given debug type.
		 *
		 * @param debugType The debug type for which the factory is registered or '*' for matching all debug types.
		 * @param factory The [debug adapter tracker factory](#DebugAdapterTrackerFactory) to register.
		 * @return A [disposable](#Disposable) that unregisters this factory when being disposed.
		 */
		export function registerDebugAdapterTrackerFactory(debugType: string, factory: DebugAdapterTrackerFactory): Disposable;

		/**
		 * Start debugging by using either a named launch or named compound configuration,
		 * or by directly passing a [DebugConfiguration](#DebugConfiguration).
		 * The named configurations are looked up in '.vscode/launch.json' found in the given folder.
		 * Before debugging starts, all unsaved files are saved and the launch configurations are brought up-to-date.
		 * Folder specific variables used in the configuration (e.g. '${workspaceFolder}') are resolved against the given folder.
		 * @param folder The [workspace folder](#WorkspaceFolder) for looking up named configurations and resolving variables or `undefined` for a non-folder setup.
		 * @param nameOrConfiguration Either the name of a debug or compound configuration or a [DebugConfiguration](#DebugConfiguration) object.
		 * @param parentSessionOrOptions Debug session options. When passed a parent [debug session](#DebugSession), assumes options with just this parent session.
		 * @return A thenable that resolves when debugging could be successfully started.
		 */
		export function startDebugging(folder: WorkspaceFolder | undefined, nameOrConfiguration: string | DebugConfiguration, parentSessionOrOptions?: DebugSession | DebugSessionOptions): Thenable<boolean>;

		/**
		 * Stop the given debug session or stop all debug sessions if session is omitted.
		 * @param session The [debug session](#DebugSession) to stop; if omitted all sessions are stopped.
		 */
		export function stopDebugging(session?: DebugSession): Thenable<void>;

		/**
		 * Add breakpoints.
		 * @param breakpoints The breakpoints to add.
		*/
		export function addBreakpoints(breakpoints: Breakpoint[]): void;

		/**
		 * Remove breakpoints.
		 * @param breakpoints The breakpoints to remove.
		 */
		export function removeBreakpoints(breakpoints: Breakpoint[]): void;

		/**
		 * Converts a "Source" descriptor object received via the Debug Adapter Protocol into a Uri that can be used to load its contents.
		 * If the source descriptor is based on a path, a file Uri is returned.
		 * If the source descriptor uses a reference number, a specific debug Uri (scheme 'debug') is constructed that requires a corresponding VS Code ContentProvider and a running debug session
		 *
		 * If the "Source" descriptor has insufficient information for creating the Uri, an error is thrown.
		 *
		 * @param source An object conforming to the [Source](https://microsoft.github.io/debug-adapter-protocol/specification#Types_Source) type defined in the Debug Adapter Protocol.
		 * @param session An optional debug session that will be used when the source descriptor uses a reference number to load the contents from an active debug session.
		 * @return A uri that can be used to load the contents of the source.
		 */
		export function asDebugSourceUri(source: DebugProtocolSource, session?: DebugSession): Uri;
	}

	/**
	 * Namespace for dealing with installed extensions. Extensions are represented
	 * by an [extension](#Extension)-interface which enables reflection on them.
	 *
	 * Extension writers can provide APIs to other extensions by returning their API public
	 * surface from the `activate`-call.
	 *
	 * ```javascript
	 * export function activate(context: vscode.ExtensionContext) {
	 * 	let api = {
	 * 		sum(a, b) {
	 * 			return a + b;
	 * 		},
	 * 		mul(a, b) {
	 * 			return a * b;
	 * 		}
	 * 	};
	 * 	// 'export' public api-surface
	 * 	return api;
	 * }
	 * ```
	 * When depending on the API of another extension add an `extensionDependencies`-entry
	 * to `package.json`, and use the [getExtension](#extensions.getExtension)-function
	 * and the [exports](#Extension.exports)-property, like below:
	 *
	 * ```javascript
	 * let mathExt = extensions.getExtension('genius.math');
	 * let importedApi = mathExt.exports;
	 *
	 * console.log(importedApi.mul(42, 1));
	 * ```
	 */
	export namespace extensions {

		/**
		 * Get an extension by its full identifier in the form of: `publisher.name`.
		 *
		 * @param extensionId An extension identifier.
		 * @return An extension or `undefined`.
		 */
		export function getExtension(extensionId: string): Extension<any> | undefined;

		/**
		 * Get an extension by its full identifier in the form of: `publisher.name`.
		 *
		 * @param extensionId An extension identifier.
		 * @return An extension or `undefined`.
		 */
		export function getExtension<T>(extensionId: string): Extension<T> | undefined;

		/**
		 * All extensions currently known to the system.
		 */
		export const all: ReadonlyArray<Extension<any>>;

		/**
		 * An event which fires when `extensions.all` changes. This can happen when extensions are
		 * installed, uninstalled, enabled or disabled.
		 */
		export const onDidChange: Event<void>;
	}

	//#region Comments

	/**
	 * Collapsible state of a [comment thread](#CommentThread)
	 */
	export enum CommentThreadCollapsibleState {
		/**
		 * Determines an item is collapsed
		 */
		Collapsed = 0,

		/**
		 * Determines an item is expanded
		 */
		Expanded = 1
	}

	/**
	 * Comment mode of a [comment](#Comment)
	 */
	export enum CommentMode {
		/**
		 * Displays the comment editor
		 */
		Editing = 0,

		/**
		 * Displays the preview of the comment
		 */
		Preview = 1
	}

	/**
	 * A collection of [comments](#Comment) representing a conversation at a particular range in a document.
	 */
	export interface CommentThread {
		/**
		 * The uri of the document the thread has been created on.
		 */
		readonly uri: Uri;

		/**
		 * The range the comment thread is located within the document. The thread icon will be shown
		 * at the first line of the range.
		 */
		range: Range;

		/**
		 * The ordered comments of the thread.
		 */
		comments: ReadonlyArray<Comment>;

		/**
		 * Whether the thread should be collapsed or expanded when opening the document.
		 * Defaults to Collapsed.
		 */
		collapsibleState: CommentThreadCollapsibleState;

		/**
		 * Whether the thread supports reply.
		 * Defaults to true.
		 */
		canReply: boolean;

		/**
		 * Context value of the comment thread. This can be used to contribute thread specific actions.
		 * For example, a comment thread is given a context value as `editable`. When contributing actions to `comments/commentThread/title`
		 * using `menus` extension point, you can specify context value for key `commentThread` in `when` expression like `commentThread == editable`.
		 * ```
		 *	"contributes": {
		 *		"menus": {
		 *			"comments/commentThread/title": [
		 *				{
		 *					"command": "extension.deleteCommentThread",
		 *					"when": "commentThread == editable"
		 *				}
		 *			]
		 *		}
		 *	}
		 * ```
		 * This will show action `extension.deleteCommentThread` only for comment threads with `contextValue` is `editable`.
		 */
		contextValue?: string;

		/**
		 * The optional human-readable label describing the [Comment Thread](#CommentThread)
		 */
		label?: string;

		/**
		 * Dispose this comment thread.
		 *
		 * Once disposed, this comment thread will be removed from visible editors and Comment Panel when appropriate.
		 */
		dispose(): void;
	}

	/**
	 * Author information of a [comment](#Comment)
	 */
	export interface CommentAuthorInformation {
		/**
		 * The display name of the author of the comment
		 */
		name: string;

		/**
		 * The optional icon path for the author
		 */
		iconPath?: Uri;
	}

	/**
	 * Reactions of a [comment](#Comment)
	 */
	export interface CommentReaction {
		/**
		 * The human-readable label for the reaction
		 */
		readonly label: string;

		/**
		 * Icon for the reaction shown in UI.
		 */
		readonly iconPath: string | Uri;

		/**
		 * The number of users who have reacted to this reaction
		 */
		readonly count: number;

		/**
		 * Whether the [author](CommentAuthorInformation) of the comment has reacted to this reaction
		 */
		readonly authorHasReacted: boolean;
	}

	/**
	 * A comment is displayed within the editor or the Comments Panel, depending on how it is provided.
	 */
	export interface Comment {
		/**
		 * The human-readable comment body
		 */
		body: string | MarkdownString;

		/**
		 * [Comment mode](#CommentMode) of the comment
		 */
		mode: CommentMode;

		/**
		 * The [author information](#CommentAuthorInformation) of the comment
		 */
		author: CommentAuthorInformation;

		/**
		 * Context value of the comment. This can be used to contribute comment specific actions.
		 * For example, a comment is given a context value as `editable`. When contributing actions to `comments/comment/title`
		 * using `menus` extension point, you can specify context value for key `comment` in `when` expression like `comment == editable`.
		 * ```json
		 *	"contributes": {
		 *		"menus": {
		 *			"comments/comment/title": [
		 *				{
		 *					"command": "extension.deleteComment",
		 *					"when": "comment == editable"
		 *				}
		 *			]
		 *		}
		 *	}
		 * ```
		 * This will show action `extension.deleteComment` only for comments with `contextValue` is `editable`.
		 */
		contextValue?: string;

		/**
		 * Optional reactions of the [comment](#Comment)
		 */
		reactions?: CommentReaction[];

		/**
		 * Optional label describing the [Comment](#Comment)
		 * Label will be rendered next to authorName if exists.
		 */
		label?: string;
	}

	/**
	 * Command argument for actions registered in `comments/commentThread/context`.
	 */
	export interface CommentReply {
		/**
		 * The active [comment thread](#CommentThread)
		 */
		thread: CommentThread;

		/**
		 * The value in the comment editor
		 */
		text: string;
	}

	/**
	 * Commenting range provider for a [comment controller](#CommentController).
	 */
	export interface CommentingRangeProvider {
		/**
		 * Provide a list of ranges which allow new comment threads creation or null for a given document
		 */
		provideCommentingRanges(document: TextDocument, token: CancellationToken): ProviderResult<Range[]>;
	}

	/**
	 * Represents a [comment controller](#CommentController)'s [options](#CommentController.options).
	 */
	export interface CommentOptions {
		/**
		 * An optional string to show on the comment input box when it's collapsed.
		 */
		prompt?: string;

		/**
		 * An optional string to show as placeholder in the comment input box when it's focused.
		 */
		placeHolder?: string;
	}

	/**
	 * A comment controller is able to provide [comments](#CommentThread) support to the editor and
	 * provide users various ways to interact with comments.
	 */
	export interface CommentController {
		/**
		 * The id of this comment controller.
		 */
		readonly id: string;

		/**
		 * The human-readable label of this comment controller.
		 */
		readonly label: string;

		/**
		 * Comment controller options
		 */
		options?: CommentOptions;

		/**
		 * Optional commenting range provider. Provide a list [ranges](#Range) which support commenting to any given resource uri.
		 *
		 * If not provided, users can leave comments in any document opened in the editor.
		 */
		commentingRangeProvider?: CommentingRangeProvider;

		/**
		 * Create a [comment thread](#CommentThread). The comment thread will be displayed in visible text editors (if the resource matches)
		 * and Comments Panel once created.
		 *
		 * @param uri The uri of the document the thread has been created on.
		 * @param range The range the comment thread is located within the document.
		 * @param comments The ordered comments of the thread.
		 */
		createCommentThread(uri: Uri, range: Range, comments: Comment[]): CommentThread;

		/**
		 * Optional reaction handler for creating and deleting reactions on a [comment](#Comment).
		 */
		reactionHandler?: (comment: Comment, reaction: CommentReaction) => Promise<void>;

		/**
		 * Dispose this comment controller.
		 *
		 * Once disposed, all [comment threads](#CommentThread) created by this comment controller will also be removed from the editor
		 * and Comments Panel.
		 */
		dispose(): void;
	}

	namespace comments {
		/**
		 * Creates a new [comment controller](#CommentController) instance.
		 *
		 * @param id An `id` for the comment controller.
		 * @param label A human-readable string for the comment controller.
		 * @return An instance of [comment controller](#CommentController).
		 */
		export function createCommentController(id: string, label: string): CommentController;
	}

	//#endregion

	/**
	 * Represents a session of a currently logged in user.
	 */
	export interface AuthenticationSession {
		/**
		 * The identifier of the authentication session.
		 */
		readonly id: string;

		/**
		 * The access token.
		 */
		readonly accessToken: string;

		/**
		 * The account associated with the session.
		 */
		readonly account: AuthenticationSessionAccountInformation;

		/**
		 * The permissions granted by the session's access token. Available scopes
		 * are defined by the [AuthenticationProvider](#AuthenticationProvider).
		 */
		readonly scopes: ReadonlyArray<string>;
	}

	/**
	 * The information of an account associated with an [AuthenticationSession](#AuthenticationSession).
	 */
	export interface AuthenticationSessionAccountInformation {
		/**
		 * The unique identifier of the account.
		 */
		readonly id: string;

		/**
		 * The human-readable name of the account.
		 */
		readonly label: string;
	}


	/**
	 * Options to be used when getting an [AuthenticationSession](#AuthenticationSession) from an [AuthenticationProvider](#AuthenticationProvider).
	 */
	export interface AuthenticationGetSessionOptions {
		/**
		 * Whether login should be performed if there is no matching session.
		 *
		 * If true, a modal dialog will be shown asking the user to sign in. If false, a numbered badge will be shown
		 * on the accounts activity bar icon. An entry for the extension will be added under the menu to sign in. This
		 * allows quietly prompting the user to sign in.
		 *
		 * Defaults to false.
		 */
		createIfNone?: boolean;

		/**
		 * Whether the existing user session preference should be cleared.
		 *
		 * For authentication providers that support being signed into multiple accounts at once, the user will be
		 * prompted to select an account to use when [getSession](#authentication.getSession) is called. This preference
		 * is remembered until [getSession](#authentication.getSession) is called with this flag.
		 *
		 * Defaults to false.
		 */
		clearSessionPreference?: boolean;
	}

	/**
	 * Basic information about an [authenticationProvider](#AuthenticationProvider)
	 */
	export interface AuthenticationProviderInformation {
		/**
		 * The unique identifier of the authentication provider.
		 */
		readonly id: string;

		/**
		 * The human-readable name of the authentication provider.
		 */
		readonly label: string;
	}

	/**
	 * An [event](#Event) which fires when an [AuthenticationSession](#AuthenticationSession) is added, removed, or changed.
	 */
	export interface AuthenticationSessionsChangeEvent {
		/**
		 * The [authenticationProvider](#AuthenticationProvider) that has had its sessions change.
		 */
		readonly provider: AuthenticationProviderInformation;
	}

	/**
	 * Namespace for authentication.
	 */
	export namespace authentication {
		/**
		 * Get an authentication session matching the desired scopes. Rejects if a provider with providerId is not
		 * registered, or if the user does not consent to sharing authentication information with
		 * the extension. If there are multiple sessions with the same scopes, the user will be shown a
		 * quickpick to select which account they would like to use.
		 *
		 * Currently, there are only two authentication providers that are contributed from built in extensions
		 * to VS Code that implement GitHub and Microsoft authentication: their providerId's are 'github' and 'microsoft'.
		 * @param providerId The id of the provider to use
		 * @param scopes A list of scopes representing the permissions requested. These are dependent on the authentication provider
		 * @param options The [getSessionOptions](#GetSessionOptions) to use
		 * @returns A thenable that resolves to an authentication session
		 */
		export function getSession(providerId: string, scopes: string[], options: AuthenticationGetSessionOptions & { createIfNone: true }): Thenable<AuthenticationSession>;

		/**
		 * Get an authentication session matching the desired scopes. Rejects if a provider with providerId is not
		 * registered, or if the user does not consent to sharing authentication information with
		 * the extension. If there are multiple sessions with the same scopes, the user will be shown a
		 * quickpick to select which account they would like to use.
		 *
		 * Currently, there are only two authentication providers that are contributed from built in extensions
		 * to VS Code that implement GitHub and Microsoft authentication: their providerId's are 'github' and 'microsoft'.
		 * @param providerId The id of the provider to use
		 * @param scopes A list of scopes representing the permissions requested. These are dependent on the authentication provider
		 * @param options The [getSessionOptions](#GetSessionOptions) to use
		 * @returns A thenable that resolves to an authentication session if available, or undefined if there are no sessions
		 */
		export function getSession(providerId: string, scopes: string[], options?: AuthenticationGetSessionOptions): Thenable<AuthenticationSession | undefined>;

		/**
		 * An [event](#Event) which fires when the authentication sessions of an authentication provider have
		 * been added, removed, or changed.
		 */
		export const onDidChangeSessions: Event<AuthenticationSessionsChangeEvent>;
	}
}

/**
 * Thenable is a common denominator between ES6 promises, Q, jquery.Deferred, WinJS.Promise,
 * and others. This API makes no assumption about what promise library is being used which
 * enables reusing existing code without migrating to a specific promise implementation. Still,
 * we recommend the use of native promises which are available in this editor.
 */
interface Thenable<T> {
	/**
	* Attaches callbacks for the resolution and/or rejection of the Promise.
	* @param onfulfilled The callback to execute when the Promise is resolved.
	* @param onrejected The callback to execute when the Promise is rejected.
	* @returns A Promise for the completion of which ever callback is executed.
	*/
	then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>;
	then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>;
}
