/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare let MonacoEnvironment: monaco.Environment | undefined;

declare namespace monaco {

	export type Thenable<T> = PromiseLike<T>;

	export interface Environment {
		globalAPI?: boolean;
		baseUrl?: string;
		getWorker?(workerId: string, label: string): Worker;
		getWorkerUrl?(workerId: string, label: string): string;
	}

	export interface IDisposable {
		dispose(): void;
	}

	export interface IEvent<T> {
		(listener: (e: T) => any, thisArg?: any): IDisposable;
	}

	/**
	 * A helper that allows to emit and listen to typed events
	 */
	export class Emitter<T> {
		constructor();
		readonly event: IEvent<T>;
		fire(event: T): void;
		dispose(): void;
	}


	export enum MarkerTag {
		Unnecessary = 1,
		Deprecated = 2
	}

	export enum MarkerSeverity {
		Hint = 1,
		Info = 2,
		Warning = 4,
		Error = 8
	}

	export class CancellationTokenSource {
		constructor(parent?: CancellationToken);
		get token(): CancellationToken;
		cancel(): void;
		dispose(cancel?: boolean): void;
	}

	export interface CancellationToken {
		/**
		 * A flag signalling is cancellation has been requested.
		 */
		readonly isCancellationRequested: boolean;
		/**
		 * An event which fires when cancellation is requested. This event
		 * only ever fires `once` as cancellation can only happen once. Listeners
		 * that are registered after cancellation will be called (next event loop run),
		 * but also only once.
		 *
		 * @event
		 */
		readonly onCancellationRequested: (listener: (e: any) => any, thisArgs?: any, disposables?: IDisposable[]) => IDisposable;
	}
	/**
	 * Uniform Resource Identifier (Uri) http://tools.ietf.org/html/rfc3986.
	 * This class is a simple parser which creates the basic component parts
	 * (http://tools.ietf.org/html/rfc3986#section-3) with minimal validation
	 * and encoding.
	 *
	 * ```txt
	 *       foo://example.com:8042/over/there?name=ferret#nose
	 *       \_/   \______________/\_________/ \_________/ \__/
	 *        |           |            |            |        |
	 *     scheme     authority       path        query   fragment
	 *        |   _____________________|__
	 *       / \ /                        \
	 *       urn:example:animal:ferret:nose
	 * ```
	 */
	export class Uri implements UriComponents {
		static isUri(thing: any): thing is Uri;
		/**
		 * scheme is the 'http' part of 'http://www.msft.com/some/path?query#fragment'.
		 * The part before the first colon.
		 */
		readonly scheme: string;
		/**
		 * authority is the 'www.msft.com' part of 'http://www.msft.com/some/path?query#fragment'.
		 * The part between the first double slashes and the next slash.
		 */
		readonly authority: string;
		/**
		 * path is the '/some/path' part of 'http://www.msft.com/some/path?query#fragment'.
		 */
		readonly path: string;
		/**
		 * query is the 'query' part of 'http://www.msft.com/some/path?query#fragment'.
		 */
		readonly query: string;
		/**
		 * fragment is the 'fragment' part of 'http://www.msft.com/some/path?query#fragment'.
		 */
		readonly fragment: string;
		/**
		 * Returns a string representing the corresponding file system path of this Uri.
		 * Will handle UNC paths, normalizes windows drive letters to lower-case, and uses the
		 * platform specific path separator.
		 *
		 * * Will *not* validate the path for invalid characters and semantics.
		 * * Will *not* look at the scheme of this Uri.
		 * * The result shall *not* be used for display purposes but for accessing a file on disk.
		 *
		 *
		 * The *difference* to `Uri#path` is the use of the platform specific separator and the handling
		 * of UNC paths. See the below sample of a file-uri with an authority (UNC path).
		 *
		 * ```ts
			const u = Uri.parse('file://server/c$/folder/file.txt')
			u.authority === 'server'
			u.path === '/shares/c$/file.txt'
			u.fsPath === '\\server\c$\folder\file.txt'
		```
		 *
		 * Using `Uri#path` to read a file (using fs-apis) would not be enough because parts of the path,
		 * namely the server name, would be missing. Therefore `Uri#fsPath` exists - it's sugar to ease working
		 * with URIs that represent files on disk (`file` scheme).
		 */
		get fsPath(): string;
		with(change: {
			scheme?: string;
			authority?: string | null;
			path?: string | null;
			query?: string | null;
			fragment?: string | null;
		}): Uri;
		/**
		 * Creates a new Uri from a string, e.g. `http://www.msft.com/some/path`,
		 * `file:///usr/home`, or `scheme:with/path`.
		 *
		 * @param value A string which represents an Uri (see `Uri#toString`).
		 */
		static parse(value: string, _strict?: boolean): Uri;
		/**
		 * Creates a new Uri from a file system path, e.g. `c:\my\files`,
		 * `/usr/home`, or `\\server\share\some\path`.
		 *
		 * The *difference* between `Uri#parse` and `Uri#file` is that the latter treats the argument
		 * as path, not as stringified-uri. E.g. `Uri.file(path)` is **not the same as**
		 * `Uri.parse('file://' + path)` because the path might contain characters that are
		 * interpreted (# and ?). See the following sample:
		 * ```ts
		const good = Uri.file('/coding/c#/project1');
		good.scheme === 'file';
		good.path === '/coding/c#/project1';
		good.fragment === '';
		const bad = Uri.parse('file://' + '/coding/c#/project1');
		bad.scheme === 'file';
		bad.path === '/coding/c'; // path is now broken
		bad.fragment === '/project1';
		```
		 *
		 * @param path A file system path (see `Uri#fsPath`)
		 */
		static file(path: string): Uri;
		static from(components: {
			scheme: string;
			authority?: string;
			path?: string;
			query?: string;
			fragment?: string;
		}): Uri;
		/**
		 * Join a Uri path with path fragments and normalizes the resulting path.
		 *
		 * @param uri The input Uri.
		 * @param pathFragment The path fragment to add to the Uri path.
		 * @returns The resulting Uri.
		 */
		static joinPath(uri: Uri, ...pathFragment: string[]): Uri;
		/**
		 * Creates a string representation for this Uri. It's guaranteed that calling
		 * `Uri.parse` with the result of this function creates an Uri which is equal
		 * to this Uri.
		 *
		 * * The result shall *not* be used for display purposes but for externalization or transport.
		 * * The result will be encoded using the percentage encoding and encoding happens mostly
		 * ignore the scheme-specific encoding rules.
		 *
		 * @param skipEncoding Do not encode the result, default is `false`
		 */
		toString(skipEncoding?: boolean): string;
		toJSON(): UriComponents;
		static revive(data: UriComponents | Uri): Uri;
		static revive(data: UriComponents | Uri | undefined): Uri | undefined;
		static revive(data: UriComponents | Uri | null): Uri | null;
		static revive(data: UriComponents | Uri | undefined | null): Uri | undefined | null;
	}

	export interface UriComponents {
		scheme: string;
		authority: string;
		path: string;
		query: string;
		fragment: string;
	}

	/**
	 * Virtual Key Codes, the value does not hold any inherent meaning.
	 * Inspired somewhat from https://msdn.microsoft.com/en-us/library/windows/desktop/dd375731(v=vs.85).aspx
	 * But these are "more general", as they should work across browsers & OS`s.
	 */
	export enum KeyCode {
		DependsOnKbLayout = -1,
		/**
		 * Placed first to cover the 0 value of the enum.
		 */
		Unknown = 0,
		Backspace = 1,
		Tab = 2,
		Enter = 3,
		Shift = 4,
		Ctrl = 5,
		Alt = 6,
		PauseBreak = 7,
		CapsLock = 8,
		Escape = 9,
		Space = 10,
		PageUp = 11,
		PageDown = 12,
		End = 13,
		Home = 14,
		LeftArrow = 15,
		UpArrow = 16,
		RightArrow = 17,
		DownArrow = 18,
		Insert = 19,
		Delete = 20,
		KEY_0 = 21,
		KEY_1 = 22,
		KEY_2 = 23,
		KEY_3 = 24,
		KEY_4 = 25,
		KEY_5 = 26,
		KEY_6 = 27,
		KEY_7 = 28,
		KEY_8 = 29,
		KEY_9 = 30,
		KEY_A = 31,
		KEY_B = 32,
		KEY_C = 33,
		KEY_D = 34,
		KEY_E = 35,
		KEY_F = 36,
		KEY_G = 37,
		KEY_H = 38,
		KEY_I = 39,
		KEY_J = 40,
		KEY_K = 41,
		KEY_L = 42,
		KEY_M = 43,
		KEY_N = 44,
		KEY_O = 45,
		KEY_P = 46,
		KEY_Q = 47,
		KEY_R = 48,
		KEY_S = 49,
		KEY_T = 50,
		KEY_U = 51,
		KEY_V = 52,
		KEY_W = 53,
		KEY_X = 54,
		KEY_Y = 55,
		KEY_Z = 56,
		Meta = 57,
		ContextMenu = 58,
		F1 = 59,
		F2 = 60,
		F3 = 61,
		F4 = 62,
		F5 = 63,
		F6 = 64,
		F7 = 65,
		F8 = 66,
		F9 = 67,
		F10 = 68,
		F11 = 69,
		F12 = 70,
		F13 = 71,
		F14 = 72,
		F15 = 73,
		F16 = 74,
		F17 = 75,
		F18 = 76,
		F19 = 77,
		NumLock = 78,
		ScrollLock = 79,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the ';:' key
		 */
		US_SEMICOLON = 80,
		/**
		 * For any country/region, the '+' key
		 * For the US standard keyboard, the '=+' key
		 */
		US_EQUAL = 81,
		/**
		 * For any country/region, the ',' key
		 * For the US standard keyboard, the ',<' key
		 */
		US_COMMA = 82,
		/**
		 * For any country/region, the '-' key
		 * For the US standard keyboard, the '-_' key
		 */
		US_MINUS = 83,
		/**
		 * For any country/region, the '.' key
		 * For the US standard keyboard, the '.>' key
		 */
		US_DOT = 84,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the '/?' key
		 */
		US_SLASH = 85,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the '`~' key
		 */
		US_BACKTICK = 86,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the '[{' key
		 */
		US_OPEN_SQUARE_BRACKET = 87,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the '\|' key
		 */
		US_BACKSLASH = 88,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the ']}' key
		 */
		US_CLOSE_SQUARE_BRACKET = 89,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 * For the US standard keyboard, the ''"' key
		 */
		US_QUOTE = 90,
		/**
		 * Used for miscellaneous characters; it can vary by keyboard.
		 */
		OEM_8 = 91,
		/**
		 * Either the angle bracket key or the backslash key on the RT 102-key keyboard.
		 */
		OEM_102 = 92,
		NUMPAD_0 = 93,
		NUMPAD_1 = 94,
		NUMPAD_2 = 95,
		NUMPAD_3 = 96,
		NUMPAD_4 = 97,
		NUMPAD_5 = 98,
		NUMPAD_6 = 99,
		NUMPAD_7 = 100,
		NUMPAD_8 = 101,
		NUMPAD_9 = 102,
		NUMPAD_MULTIPLY = 103,
		NUMPAD_ADD = 104,
		NUMPAD_SEPARATOR = 105,
		NUMPAD_SUBTRACT = 106,
		NUMPAD_DECIMAL = 107,
		NUMPAD_DIVIDE = 108,
		/**
		 * Cover all key codes when IME is processing input.
		 */
		KEY_IN_COMPOSITION = 109,
		ABNT_C1 = 110,
		ABNT_C2 = 111,
		/**
		 * Placed last to cover the length of the enum.
		 * Please do not depend on this value!
		 */
		MAX_VALUE = 112
	}
	export class KeyMod {
		static readonly CtrlCmd: number;
		static readonly Shift: number;
		static readonly Alt: number;
		static readonly WinCtrl: number;
		static chord(firstPart: number, secondPart: number): number;
	}

	export interface IMarkdownString {
		readonly value: string;
		readonly isTrusted?: boolean;
		readonly supportThemeIcons?: boolean;
		uris?: {
			[href: string]: UriComponents;
		};
	}

	export interface IKeyboardEvent {
		readonly _standardKeyboardEventBrand: true;
		readonly browserEvent: KeyboardEvent;
		readonly target: HTMLElement;
		readonly ctrlKey: boolean;
		readonly shiftKey: boolean;
		readonly altKey: boolean;
		readonly metaKey: boolean;
		readonly keyCode: KeyCode;
		readonly code: string;
		equals(keybinding: number): boolean;
		preventDefault(): void;
		stopPropagation(): void;
	}
	export interface IMouseEvent {
		readonly browserEvent: MouseEvent;
		readonly leftButton: boolean;
		readonly middleButton: boolean;
		readonly rightButton: boolean;
		readonly buttons: number;
		readonly target: HTMLElement;
		readonly detail: number;
		readonly posx: number;
		readonly posy: number;
		readonly ctrlKey: boolean;
		readonly shiftKey: boolean;
		readonly altKey: boolean;
		readonly metaKey: boolean;
		readonly timestamp: number;
		preventDefault(): void;
		stopPropagation(): void;
	}

	export interface IScrollEvent {
		readonly scrollTop: number;
		readonly scrollLeft: number;
		readonly scrollWidth: number;
		readonly scrollHeight: number;
		readonly scrollTopChanged: boolean;
		readonly scrollLeftChanged: boolean;
		readonly scrollWidthChanged: boolean;
		readonly scrollHeightChanged: boolean;
	}
	/**
	 * A position in the editor. This interface is suitable for serialization.
	 */
	export interface IPosition {
		/**
		 * line number (starts at 1)
		 */
		readonly lineNumber: number;
		/**
		 * column (the first character in a line is between column 1 and column 2)
		 */
		readonly column: number;
	}

	/**
	 * A position in the editor.
	 */
	export class Position {
		/**
		 * line number (starts at 1)
		 */
		readonly lineNumber: number;
		/**
		 * column (the first character in a line is between column 1 and column 2)
		 */
		readonly column: number;
		constructor(lineNumber: number, column: number);
		/**
		 * Create a new position from this position.
		 *
		 * @param newLineNumber new line number
		 * @param newColumn new column
		 */
		with(newLineNumber?: number, newColumn?: number): Position;
		/**
		 * Derive a new position from this position.
		 *
		 * @param deltaLineNumber line number delta
		 * @param deltaColumn column delta
		 */
		delta(deltaLineNumber?: number, deltaColumn?: number): Position;
		/**
		 * Test if this position equals other position
		 */
		equals(other: IPosition): boolean;
		/**
		 * Test if position `a` equals position `b`
		 */
		static equals(a: IPosition | null, b: IPosition | null): boolean;
		/**
		 * Test if this position is before other position.
		 * If the two positions are equal, the result will be false.
		 */
		isBefore(other: IPosition): boolean;
		/**
		 * Test if position `a` is before position `b`.
		 * If the two positions are equal, the result will be false.
		 */
		static isBefore(a: IPosition, b: IPosition): boolean;
		/**
		 * Test if this position is before other position.
		 * If the two positions are equal, the result will be true.
		 */
		isBeforeOrEqual(other: IPosition): boolean;
		/**
		 * Test if position `a` is before position `b`.
		 * If the two positions are equal, the result will be true.
		 */
		static isBeforeOrEqual(a: IPosition, b: IPosition): boolean;
		/**
		 * A function that compares positions, useful for sorting
		 */
		static compare(a: IPosition, b: IPosition): number;
		/**
		 * Clone this position.
		 */
		clone(): Position;
		/**
		 * Convert to a human-readable representation.
		 */
		toString(): string;
		/**
		 * Create a `Position` from an `IPosition`.
		 */
		static lift(pos: IPosition): Position;
		/**
		 * Test if `obj` is an `IPosition`.
		 */
		static isIPosition(obj: any): obj is IPosition;
	}

	/**
	 * A range in the editor. This interface is suitable for serialization.
	 */
	export interface IRange {
		/**
		 * Line number on which the range starts (starts at 1).
		 */
		readonly startLineNumber: number;
		/**
		 * Column on which the range starts in line `startLineNumber` (starts at 1).
		 */
		readonly startColumn: number;
		/**
		 * Line number on which the range ends.
		 */
		readonly endLineNumber: number;
		/**
		 * Column on which the range ends in line `endLineNumber`.
		 */
		readonly endColumn: number;
	}

	/**
	 * A range in the editor. (startLineNumber,startColumn) is <= (endLineNumber,endColumn)
	 */
	export class Range {
		/**
		 * Line number on which the range starts (starts at 1).
		 */
		readonly startLineNumber: number;
		/**
		 * Column on which the range starts in line `startLineNumber` (starts at 1).
		 */
		readonly startColumn: number;
		/**
		 * Line number on which the range ends.
		 */
		readonly endLineNumber: number;
		/**
		 * Column on which the range ends in line `endLineNumber`.
		 */
		readonly endColumn: number;
		constructor(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number);
		/**
		 * Test if this range is empty.
		 */
		isEmpty(): boolean;
		/**
		 * Test if `range` is empty.
		 */
		static isEmpty(range: IRange): boolean;
		/**
		 * Test if position is in this range. If the position is at the edges, will return true.
		 */
		containsPosition(position: IPosition): boolean;
		/**
		 * Test if `position` is in `range`. If the position is at the edges, will return true.
		 */
		static containsPosition(range: IRange, position: IPosition): boolean;
		/**
		 * Test if range is in this range. If the range is equal to this range, will return true.
		 */
		containsRange(range: IRange): boolean;
		/**
		 * Test if `otherRange` is in `range`. If the ranges are equal, will return true.
		 */
		static containsRange(range: IRange, otherRange: IRange): boolean;
		/**
		 * Test if `range` is strictly in this range. `range` must start after and end before this range for the result to be true.
		 */
		strictContainsRange(range: IRange): boolean;
		/**
		 * Test if `otherRange` is strinctly in `range` (must start after, and end before). If the ranges are equal, will return false.
		 */
		static strictContainsRange(range: IRange, otherRange: IRange): boolean;
		/**
		 * A reunion of the two ranges.
		 * The smallest position will be used as the start point, and the largest one as the end point.
		 */
		plusRange(range: IRange): Range;
		/**
		 * A reunion of the two ranges.
		 * The smallest position will be used as the start point, and the largest one as the end point.
		 */
		static plusRange(a: IRange, b: IRange): Range;
		/**
		 * A intersection of the two ranges.
		 */
		intersectRanges(range: IRange): Range | null;
		/**
		 * A intersection of the two ranges.
		 */
		static intersectRanges(a: IRange, b: IRange): Range | null;
		/**
		 * Test if this range equals other.
		 */
		equalsRange(other: IRange | null): boolean;
		/**
		 * Test if range `a` equals `b`.
		 */
		static equalsRange(a: IRange | null, b: IRange | null): boolean;
		/**
		 * Return the end position (which will be after or equal to the start position)
		 */
		getEndPosition(): Position;
		/**
		 * Return the end position (which will be after or equal to the start position)
		 */
		static getEndPosition(range: IRange): Position;
		/**
		 * Return the start position (which will be before or equal to the end position)
		 */
		getStartPosition(): Position;
		/**
		 * Return the start position (which will be before or equal to the end position)
		 */
		static getStartPosition(range: IRange): Position;
		/**
		 * Transform to a user presentable string representation.
		 */
		toString(): string;
		/**
		 * Create a new range using this range's start position, and using endLineNumber and endColumn as the end position.
		 */
		setEndPosition(endLineNumber: number, endColumn: number): Range;
		/**
		 * Create a new range using this range's end position, and using startLineNumber and startColumn as the start position.
		 */
		setStartPosition(startLineNumber: number, startColumn: number): Range;
		/**
		 * Create a new empty range using this range's start position.
		 */
		collapseToStart(): Range;
		/**
		 * Create a new empty range using this range's start position.
		 */
		static collapseToStart(range: IRange): Range;
		static fromPositions(start: IPosition, end?: IPosition): Range;
		/**
		 * Create a `Range` from an `IRange`.
		 */
		static lift(range: undefined | null): null;
		static lift(range: IRange): Range;
		/**
		 * Test if `obj` is an `IRange`.
		 */
		static isIRange(obj: any): obj is IRange;
		/**
		 * Test if the two ranges are touching in any way.
		 */
		static areIntersectingOrTouching(a: IRange, b: IRange): boolean;
		/**
		 * Test if the two ranges are intersecting. If the ranges are touching it returns true.
		 */
		static areIntersecting(a: IRange, b: IRange): boolean;
		/**
		 * A function that compares ranges, useful for sorting ranges
		 * It will first compare ranges on the startPosition and then on the endPosition
		 */
		static compareRangesUsingStarts(a: IRange | null | undefined, b: IRange | null | undefined): number;
		/**
		 * A function that compares ranges, useful for sorting ranges
		 * It will first compare ranges on the endPosition and then on the startPosition
		 */
		static compareRangesUsingEnds(a: IRange, b: IRange): number;
		/**
		 * Test if the range spans multiple lines.
		 */
		static spansMultipleLines(range: IRange): boolean;
	}

	/**
	 * A selection in the editor.
	 * The selection is a range that has an orientation.
	 */
	export interface ISelection {
		/**
		 * The line number on which the selection has started.
		 */
		readonly selectionStartLineNumber: number;
		/**
		 * The column on `selectionStartLineNumber` where the selection has started.
		 */
		readonly selectionStartColumn: number;
		/**
		 * The line number on which the selection has ended.
		 */
		readonly positionLineNumber: number;
		/**
		 * The column on `positionLineNumber` where the selection has ended.
		 */
		readonly positionColumn: number;
	}

	/**
	 * A selection in the editor.
	 * The selection is a range that has an orientation.
	 */
	export class Selection extends Range {
		/**
		 * The line number on which the selection has started.
		 */
		readonly selectionStartLineNumber: number;
		/**
		 * The column on `selectionStartLineNumber` where the selection has started.
		 */
		readonly selectionStartColumn: number;
		/**
		 * The line number on which the selection has ended.
		 */
		readonly positionLineNumber: number;
		/**
		 * The column on `positionLineNumber` where the selection has ended.
		 */
		readonly positionColumn: number;
		constructor(selectionStartLineNumber: number, selectionStartColumn: number, positionLineNumber: number, positionColumn: number);
		/**
		 * Transform to a human-readable representation.
		 */
		toString(): string;
		/**
		 * Test if equals other selection.
		 */
		equalsSelection(other: ISelection): boolean;
		/**
		 * Test if the two selections are equal.
		 */
		static selectionsEqual(a: ISelection, b: ISelection): boolean;
		/**
		 * Get directions (LTR or RTL).
		 */
		getDirection(): SelectionDirection;
		/**
		 * Create a new selection with a different `positionLineNumber` and `positionColumn`.
		 */
		setEndPosition(endLineNumber: number, endColumn: number): Selection;
		/**
		 * Get the position at `positionLineNumber` and `positionColumn`.
		 */
		getPosition(): Position;
		/**
		 * Create a new selection with a different `selectionStartLineNumber` and `selectionStartColumn`.
		 */
		setStartPosition(startLineNumber: number, startColumn: number): Selection;
		/**
		 * Create a `Selection` from one or two positions
		 */
		static fromPositions(start: IPosition, end?: IPosition): Selection;
		/**
		 * Create a `Selection` from an `ISelection`.
		 */
		static liftSelection(sel: ISelection): Selection;
		/**
		 * `a` equals `b`.
		 */
		static selectionsArrEqual(a: ISelection[], b: ISelection[]): boolean;
		/**
		 * Test if `obj` is an `ISelection`.
		 */
		static isISelection(obj: any): obj is ISelection;
		/**
		 * Create with a direction.
		 */
		static createWithDirection(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, direction: SelectionDirection): Selection;
	}

	/**
	 * The direction of a selection.
	 */
	export enum SelectionDirection {
		/**
		 * The selection starts above where it ends.
		 */
		LTR = 0,
		/**
		 * The selection starts below where it ends.
		 */
		RTL = 1
	}

	export class Token {
		_tokenBrand: void;
		readonly offset: number;
		readonly type: string;
		readonly language: string;
		constructor(offset: number, type: string, language: string);
		toString(): string;
	}
}

declare namespace monaco.editor {

	export interface IDiffNavigator {
		canNavigate(): boolean;
		next(): void;
		previous(): void;
		dispose(): void;
	}

	/**
	 * Create a new editor under `domElement`.
	 * `domElement` should be empty (not contain other dom nodes).
	 * The editor will read the size of `domElement`.
	 */
	export function create(domElement: HTMLElement, options?: IStandaloneEditorConstructionOptions, override?: IEditorOverrideServices): IStandaloneCodeEditor;

	/**
	 * Emitted when an editor is created.
	 * Creating a diff editor might cause this listener to be invoked with the two editors.
	 * @event
	 */
	export function onDidCreateEditor(listener: (codeEditor: ICodeEditor) => void): IDisposable;

	/**
	 * Create a new diff editor under `domElement`.
	 * `domElement` should be empty (not contain other dom nodes).
	 * The editor will read the size of `domElement`.
	 */
	export function createDiffEditor(domElement: HTMLElement, options?: IDiffEditorConstructionOptions, override?: IEditorOverrideServices): IStandaloneDiffEditor;

	export interface IDiffNavigatorOptions {
		readonly followsCaret?: boolean;
		readonly ignoreCharChanges?: boolean;
		readonly alwaysRevealFirst?: boolean;
	}

	export function createDiffNavigator(diffEditor: IStandaloneDiffEditor, opts?: IDiffNavigatorOptions): IDiffNavigator;

	/**
	 * Create a new editor model.
	 * You can specify the language that should be set for this model or let the language be inferred from the `uri`.
	 */
	export function createModel(value: string, language?: string, uri?: Uri): ITextModel;

	/**
	 * Change the language for a model.
	 */
	export function setModelLanguage(model: ITextModel, languageId: string): void;

	/**
	 * Set the markers for a model.
	 */
	export function setModelMarkers(model: ITextModel, owner: string, markers: IMarkerData[]): void;

	/**
	 * Get markers for owner and/or resource
	 *
	 * @returns list of markers
	 */
	export function getModelMarkers(filter: {
		owner?: string;
		resource?: Uri;
		take?: number;
	}): IMarker[];

	/**
	 * Emitted when markers change for a model.
	 * @event
	 */
	export function onDidChangeMarkers(listener: (e: readonly Uri[]) => void): IDisposable;

	/**
	 * Get the model that has `uri` if it exists.
	 */
	export function getModel(uri: Uri): ITextModel | null;

	/**
	 * Get all the created models.
	 */
	export function getModels(): ITextModel[];

	/**
	 * Emitted when a model is created.
	 * @event
	 */
	export function onDidCreateModel(listener: (model: ITextModel) => void): IDisposable;

	/**
	 * Emitted right before a model is disposed.
	 * @event
	 */
	export function onWillDisposeModel(listener: (model: ITextModel) => void): IDisposable;

	/**
	 * Emitted when a different language is set to a model.
	 * @event
	 */
	export function onDidChangeModelLanguage(listener: (e: {
		readonly model: ITextModel;
		readonly oldLanguage: string;
	}) => void): IDisposable;

	/**
	 * Create a new web worker that has model syncing capabilities built in.
	 * Specify an AMD module to load that will `create` an object that will be proxied.
	 */
	export function createWebWorker<T>(opts: IWebWorkerOptions): MonacoWebWorker<T>;

	/**
	 * Colorize the contents of `domNode` using attribute `data-lang`.
	 */
	export function colorizeElement(domNode: HTMLElement, options: IColorizerElementOptions): Promise<void>;

	/**
	 * Colorize `text` using language `languageId`.
	 */
	export function colorize(text: string, languageId: string, options: IColorizerOptions): Promise<string>;

	/**
	 * Colorize a line in a model.
	 */
	export function colorizeModelLine(model: ITextModel, lineNumber: number, tabSize?: number): string;

	/**
	 * Tokenize `text` using language `languageId`
	 */
	export function tokenize(text: string, languageId: string): Token[][];

	/**
	 * Define a new theme or update an existing theme.
	 */
	export function defineTheme(themeName: string, themeData: IStandaloneThemeData): void;

	/**
	 * Switches to a theme.
	 */
	export function setTheme(themeName: string): void;

	/**
	 * Clears all cached font measurements and triggers re-measurement.
	 */
	export function remeasureFonts(): void;

	/**
	 * Register a command.
	 */
	export function registerCommand(id: string, handler: (accessor: any, ...args: any[]) => void): IDisposable;

	export type BuiltinTheme = 'vs' | 'vs-dark' | 'hc-black';

	export interface IStandaloneThemeData {
		base: BuiltinTheme;
		inherit: boolean;
		rules: ITokenThemeRule[];
		encodedTokensColors?: string[];
		colors: IColors;
	}

	export type IColors = {
		[colorId: string]: string;
	};

	export interface ITokenThemeRule {
		token: string;
		foreground?: string;
		background?: string;
		fontStyle?: string;
	}

	/**
	 * A web worker that can provide a proxy to an arbitrary file.
	 */
	export interface MonacoWebWorker<T> {
		/**
		 * Terminate the web worker, thus invalidating the returned proxy.
		 */
		dispose(): void;
		/**
		 * Get a proxy to the arbitrary loaded code.
		 */
		getProxy(): Promise<T>;
		/**
		 * Synchronize (send) the models at `resources` to the web worker,
		 * making them available in the monaco.worker.getMirrorModels().
		 */
		withSyncedResources(resources: Uri[]): Promise<T>;
	}

	export interface IWebWorkerOptions {
		/**
		 * The AMD moduleId to load.
		 * It should export a function `create` that should return the exported proxy.
		 */
		moduleId: string;
		/**
		 * The data to send over when calling create on the module.
		 */
		createData?: any;
		/**
		 * A label to be used to identify the web worker for debugging purposes.
		 */
		label?: string;
		/**
		 * An object that can be used by the web worker to make calls back to the main thread.
		 */
		host?: any;
		/**
		 * Keep idle models.
		 * Defaults to false, which means that idle models will stop syncing after a while.
		 */
		keepIdleModels?: boolean;
	}

	/**
	 * Description of an action contribution
	 */
	export interface IActionDescriptor {
		/**
		 * An unique identifier of the contributed action.
		 */
		id: string;
		/**
		 * A label of the action that will be presented to the user.
		 */
		label: string;
		/**
		 * Precondition rule.
		 */
		precondition?: string;
		/**
		 * An array of keybindings for the action.
		 */
		keybindings?: number[];
		/**
		 * The keybinding rule (condition on top of precondition).
		 */
		keybindingContext?: string;
		/**
		 * Control if the action should show up in the context menu and where.
		 * The context menu of the editor has these default:
		 *   navigation - The navigation group comes first in all cases.
		 *   1_modification - This group comes next and contains commands that modify your code.
		 *   9_cutcopypaste - The last default group with the basic editing commands.
		 * You can also create your own group.
		 * Defaults to null (don't show in context menu).
		 */
		contextMenuGroupId?: string;
		/**
		 * Control the order in the context menu group.
		 */
		contextMenuOrder?: number;
		/**
		 * Method that will be executed when the action is triggered.
		 * @param editor The editor instance is passed in as a convenience
		 */
		run(editor: ICodeEditor, ...args: any[]): void | Promise<void>;
	}

	/**
	 * Options which apply for all editors.
	 */
	export interface IGlobalEditorOptions {
		/**
		 * The number of spaces a tab is equal to.
		 * This setting is overridden based on the file contents when `detectIndentation` is on.
		 * Defaults to 4.
		 */
		tabSize?: number;
		/**
		 * Insert spaces when pressing `Tab`.
		 * This setting is overridden based on the file contents when `detectIndentation` is on.
		 * Defaults to true.
		 */
		insertSpaces?: boolean;
		/**
		 * Controls whether `tabSize` and `insertSpaces` will be automatically detected when a file is opened based on the file contents.
		 * Defaults to true.
		 */
		detectIndentation?: boolean;
		/**
		 * Remove trailing auto inserted whitespace.
		 * Defaults to true.
		 */
		trimAutoWhitespace?: boolean;
		/**
		 * Special handling for large files to disable certain memory intensive features.
		 * Defaults to true.
		 */
		largeFileOptimizations?: boolean;
		/**
		 * Controls whether completions should be computed based on words in the document.
		 * Defaults to true.
		 */
		wordBasedSuggestions?: boolean;
		/**
		 * Controls whether word based completions should be included from opened documents of the same language or any language.
		 */
		wordBasedSuggestionsOnlySameLanguage?: boolean;
		/**
		 * Controls whether the semanticHighlighting is shown for the languages that support it.
		 * true: semanticHighlighting is enabled for all themes
		 * false: semanticHighlighting is disabled for all themes
		 * 'configuredByTheme': semanticHighlighting is controlled by the current color theme's semanticHighlighting setting.
		 * Defaults to 'byTheme'.
		 */
		'semanticHighlighting.enabled'?: true | false | 'configuredByTheme';
		/**
		 * Keep peek editors open even when double clicking their content or when hitting `Escape`.
		 * Defaults to false.
		 */
		stablePeek?: boolean;
		/**
		 * Lines above this length will not be tokenized for performance reasons.
		 * Defaults to 20000.
		 */
		maxTokenizationLineLength?: number;
		/**
		 * Theme to be used for rendering.
		 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
		 * You can create custom themes via `monaco.editor.defineTheme`.
		 * To switch a theme, use `monaco.editor.setTheme`.
		 * **NOTE**: The theme might be overwritten if the OS is in high contrast mode, unless `autoDetectHighContrast` is set to false.
		 */
		theme?: string;
		/**
		 * If enabled, will automatically change to high contrast theme if the OS is using a high contrast theme.
		 * Defaults to true.
		 */
		autoDetectHighContrast?: boolean;
	}

	/**
	 * The options to create an editor.
	 */
	export interface IStandaloneEditorConstructionOptions extends IEditorConstructionOptions, IGlobalEditorOptions {
		/**
		 * The initial model associated with this code editor.
		 */
		model?: ITextModel | null;
		/**
		 * The initial value of the auto created model in the editor.
		 * To not create automatically a model, use `model: null`.
		 */
		value?: string;
		/**
		 * The initial language of the auto created model in the editor.
		 * To not create automatically a model, use `model: null`.
		 */
		language?: string;
		/**
		 * Initial theme to be used for rendering.
		 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
		 * You can create custom themes via `monaco.editor.defineTheme`.
		 * To switch a theme, use `monaco.editor.setTheme`.
		 * **NOTE**: The theme might be overwritten if the OS is in high contrast mode, unless `autoDetectHighContrast` is set to false.
		 */
		theme?: string;
		/**
		 * If enabled, will automatically change to high contrast theme if the OS is using a high contrast theme.
		 * Defaults to true.
		 */
		autoDetectHighContrast?: boolean;
		/**
		 * An URL to open when Ctrl+H (Windows and Linux) or Cmd+H (OSX) is pressed in
		 * the accessibility help dialog in the editor.
		 *
		 * Defaults to "https://go.microsoft.com/fwlink/?linkid=852450"
		 */
		accessibilityHelpUrl?: string;
	}

	/**
	 * The options to create a diff editor.
	 */
	export interface IDiffEditorConstructionOptions extends IDiffEditorOptions {
		/**
		 * Initial theme to be used for rendering.
		 * The current out-of-the-box available themes are: 'vs' (default), 'vs-dark', 'hc-black'.
		 * You can create custom themes via `monaco.editor.defineTheme`.
		 * To switch a theme, use `monaco.editor.setTheme`.
		 * **NOTE**: The theme might be overwritten if the OS is in high contrast mode, unless `autoDetectHighContrast` is set to false.
		 */
		theme?: string;
		/**
		 * If enabled, will automatically change to high contrast theme if the OS is using a high contrast theme.
		 * Defaults to true.
		 */
		autoDetectHighContrast?: boolean;
	}

	export interface IStandaloneCodeEditor extends ICodeEditor {
		updateOptions(newOptions: IEditorOptions & IGlobalEditorOptions): void;
		addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
		createContextKey<T>(key: string, defaultValue: T): IContextKey<T>;
		addAction(descriptor: IActionDescriptor): IDisposable;
	}

	export interface IStandaloneDiffEditor extends IDiffEditor {
		addCommand(keybinding: number, handler: ICommandHandler, context?: string): string | null;
		createContextKey<T>(key: string, defaultValue: T): IContextKey<T>;
		addAction(descriptor: IActionDescriptor): IDisposable;
		getOriginalEditor(): IStandaloneCodeEditor;
		getModifiedEditor(): IStandaloneCodeEditor;
	}
	export interface ICommandHandler {
		(...args: any[]): void;
	}

	export interface IContextKey<T> {
		set(value: T): void;
		reset(): void;
		get(): T | undefined;
	}

	export interface IEditorOverrideServices {
		[index: string]: any;
	}

	export interface IMarker {
		owner: string;
		resource: Uri;
		severity: MarkerSeverity;
		code?: string | {
			value: string;
			target: Uri;
		};
		message: string;
		source?: string;
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
		relatedInformation?: IRelatedInformation[];
		tags?: MarkerTag[];
	}

	/**
	 * A structure defining a problem/warning/etc.
	 */
	export interface IMarkerData {
		code?: string | {
			value: string;
			target: Uri;
		};
		severity: MarkerSeverity;
		message: string;
		source?: string;
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
		relatedInformation?: IRelatedInformation[];
		tags?: MarkerTag[];
	}

	/**
	 *
	 */
	export interface IRelatedInformation {
		resource: Uri;
		message: string;
		startLineNumber: number;
		startColumn: number;
		endLineNumber: number;
		endColumn: number;
	}

	export interface IColorizerOptions {
		tabSize?: number;
	}

	export interface IColorizerElementOptions extends IColorizerOptions {
		theme?: string;
		mimeType?: string;
	}

	export enum ScrollbarVisibility {
		Auto = 1,
		Hidden = 2,
		Visible = 3
	}

	export interface ThemeColor {
		id: string;
	}

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
		/**
		 * If set, text will be injected in the view after the range.
		 */
		after?: InjectedTextOptions | null;
		/**
		 * If set, text will be injected in the view before the range.
		 */
		before?: InjectedTextOptions | null;
	}

	/**
	 * Configures text that is injected into the view without changing the underlying document.
	*/
	export interface InjectedTextOptions {
		/**
		 * Sets the text to inject. Must be a single line.
		 */
		readonly content: string;
		/**
		 * If set, the decoration will be rendered inline with the text with this CSS class name.
		 */
		readonly inlineClassName?: string | null;
		/**
		 * If there is an `inlineClassName` which affects letter spacing.
		 */
		readonly inlineClassNameAffectsLetterSpacing?: boolean;
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
	export enum EndOfLinePreference {
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
	export enum DefaultEndOfLine {
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
	export enum EndOfLineSequence {
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

	export interface IValidEditOperation {
		/**
		 * The range to replace. This can be empty to emulate a simple insert.
		 */
		range: Range;
		/**
		 * The text to replace with. This can be empty to emulate a simple delete.
		 */
		text: string;
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
	}

	export interface ITextModelUpdateOptions {
		tabSize?: number;
		indentSize?: number;
		insertSpaces?: boolean;
		trimAutoWhitespace?: boolean;
	}

	export class FindMatch {
		_findMatchBrand: void;
		readonly range: Range;
		readonly matches: string[] | null;
	}

	/**
	 * Describes the behavior of decorations when typing/editing near their edges.
	 * Note: Please do not edit the values, as they very carefully match `DecorationRangeBehavior`
	 */
	export enum TrackedRangeStickiness {
		AlwaysGrowsWhenTypingAtEdges = 0,
		NeverGrowsWhenTypingAtEdges = 1,
		GrowsOnlyWhenTypingBefore = 2,
		GrowsOnlyWhenTypingAfter = 3
	}

	/**
	 * A model.
	 */
	export interface ITextModel {
		/**
		 * Gets the resource associated with this editor model.
		 */
		readonly uri: Uri;
		/**
		 * A unique identifier associated with this model.
		 */
		readonly id: string;
		/**
		 * Get the resolved options for this model.
		 */
		getOptions(): TextModelResolvedOptions;
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
		 * Get the text stored in this model.
		 * @param eol The end of line character preference. Defaults to `EndOfLinePreference.TextDefined`.
		 * @param preserverBOM Preserve a BOM character if it was detected when the model was constructed.
		 * @return The text.
		 */
		getValue(eol?: EndOfLinePreference, preserveBOM?: boolean): string;
		/**
		 * Get the length of the text stored in this model.
		 */
		getValueLength(eol?: EndOfLinePreference, preserveBOM?: boolean): number;
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
		 * Get the language associated with this model.
		 */
		getModeId(): string;
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
		 * Gets all the decorations that contain injected text.
		 * @param ownerId If set, it will ignore decorations belonging to other owners.
		 */
		getInjectedTextDecorations(ownerId?: number): IModelDecoration[];
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
		 * Close the current undo-redo element.
		 * This offers a way to create an undo/redo stop point.
		 */
		pushStackElement(): void;
		/**
		 * Open the current undo-redo element.
		 * This offers a way to remove the current undo/redo stop point.
		 */
		popStackElement(): void;
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
		 * An event emitted when the model has been attached to the first editor or detached from the last editor.
		 * @event
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
		 * Returns if this model is attached to an editor or not.
		 */
		isAttachedToEditor(): boolean;
	}

	/**
	 * A builder and helper for edit operations for a command.
	 */
	export interface IEditOperationBuilder {
		/**
		 * Add a new edit operation (a replace operation).
		 * @param range The range to replace (delete). May be empty to represent a simple insert.
		 * @param text The text to replace with. May be null to represent a simple delete.
		 */
		addEditOperation(range: IRange, text: string | null, forceMoveMarkers?: boolean): void;
		/**
		 * Add a new edit operation (a replace operation).
		 * The inverse edits will be accessible in `ICursorStateComputerData.getInverseEditOperations()`
		 * @param range The range to replace (delete). May be empty to represent a simple insert.
		 * @param text The text to replace with. May be null to represent a simple delete.
		 */
		addTrackedEditOperation(range: IRange, text: string | null, forceMoveMarkers?: boolean): void;
		/**
		 * Track `selection` when applying edit operations.
		 * A best effort will be made to not grow/expand the selection.
		 * An empty selection will clamp to a nearby character.
		 * @param selection The selection to track.
		 * @param trackPreviousOnEmpty If set, and the selection is empty, indicates whether the selection
		 *           should clamp to the previous or the next character.
		 * @return A unique identifier.
		 */
		trackSelection(selection: Selection, trackPreviousOnEmpty?: boolean): string;
	}

	/**
	 * A helper for computing cursor state after a command.
	 */
	export interface ICursorStateComputerData {
		/**
		 * Get the inverse edit operations of the added edit operations.
		 */
		getInverseEditOperations(): IValidEditOperation[];
		/**
		 * Get a previously tracked selection.
		 * @param id The unique identifier returned by `trackSelection`.
		 * @return The selection.
		 */
		getTrackedSelection(id: string): Selection;
	}

	/**
	 * A command that modifies text / cursor state on a model.
	 */
	export interface ICommand {
		/**
		 * Get the edit operations needed to execute this command.
		 * @param model The model the command will execute on.
		 * @param builder A helper to collect the needed edit operations and to track selections.
		 */
		getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void;
		/**
		 * Compute the cursor state after the edit operations were applied.
		 * @param model The model the command has executed on.
		 * @param helper A helper to get inverse edit operations and to get previously tracked selections.
		 * @return The cursor state after the command executed.
		 */
		computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection;
	}

	/**
	 * A model for the diff editor.
	 */
	export interface IDiffEditorModel {
		/**
		 * Original model.
		 */
		original: ITextModel;
		/**
		 * Modified model.
		 */
		modified: ITextModel;
	}

	/**
	 * An event describing that an editor has had its model reset (i.e. `editor.setModel()`).
	 */
	export interface IModelChangedEvent {
		/**
		 * The `uri` of the previous model or null.
		 */
		readonly oldModelUrl: Uri | null;
		/**
		 * The `uri` of the new model or null.
		 */
		readonly newModelUrl: Uri | null;
	}

	export interface IDimension {
		width: number;
		height: number;
	}

	/**
	 * A change
	 */
	export interface IChange {
		readonly originalStartLineNumber: number;
		readonly originalEndLineNumber: number;
		readonly modifiedStartLineNumber: number;
		readonly modifiedEndLineNumber: number;
	}

	/**
	 * A character level change.
	 */
	export interface ICharChange extends IChange {
		readonly originalStartColumn: number;
		readonly originalEndColumn: number;
		readonly modifiedStartColumn: number;
		readonly modifiedEndColumn: number;
	}

	/**
	 * A line change
	 */
	export interface ILineChange extends IChange {
		readonly charChanges: ICharChange[] | undefined;
	}

	export interface IContentSizeChangedEvent {
		readonly contentWidth: number;
		readonly contentHeight: number;
		readonly contentWidthChanged: boolean;
		readonly contentHeightChanged: boolean;
	}

	export interface INewScrollPosition {
		scrollLeft?: number;
		scrollTop?: number;
	}

	export interface IEditorAction {
		readonly id: string;
		readonly label: string;
		readonly alias: string;
		isSupported(): boolean;
		run(): Promise<void>;
	}

	export type IEditorModel = ITextModel | IDiffEditorModel;

	/**
	 * A (serializable) state of the cursors.
	 */
	export interface ICursorState {
		inSelectionMode: boolean;
		selectionStart: IPosition;
		position: IPosition;
	}

	/**
	 * A (serializable) state of the view.
	 */
	export interface IViewState {
		/** written by previous versions */
		scrollTop?: number;
		/** written by previous versions */
		scrollTopWithoutViewZones?: number;
		scrollLeft: number;
		firstPosition: IPosition;
		firstPositionDeltaTop: number;
	}

	/**
	 * A (serializable) state of the code editor.
	 */
	export interface ICodeEditorViewState {
		cursorState: ICursorState[];
		viewState: IViewState;
		contributionsState: {
			[id: string]: any;
		};
	}

	/**
	 * (Serializable) View state for the diff editor.
	 */
	export interface IDiffEditorViewState {
		original: ICodeEditorViewState | null;
		modified: ICodeEditorViewState | null;
	}

	/**
	 * An editor view state.
	 */
	export type IEditorViewState = ICodeEditorViewState | IDiffEditorViewState;

	export enum ScrollType {
		Smooth = 0,
		Immediate = 1
	}

	/**
	 * An editor.
	 */
	export interface IEditor {
		/**
		 * An event emitted when the editor has been disposed.
		 * @event
		 */
		onDidDispose(listener: () => void): IDisposable;
		/**
		 * Dispose the editor.
		 */
		dispose(): void;
		/**
		 * Get a unique id for this editor instance.
		 */
		getId(): string;
		/**
		 * Get the editor type. Please see `EditorType`.
		 * This is to avoid an instanceof check
		 */
		getEditorType(): string;
		/**
		 * Update the editor's options after the editor has been created.
		 */
		updateOptions(newOptions: IEditorOptions): void;
		/**
		 * Instructs the editor to remeasure its container. This method should
		 * be called when the container of the editor gets resized.
		 *
		 * If a dimension is passed in, the passed in value will be used.
		 */
		layout(dimension?: IDimension): void;
		/**
		 * Brings browser focus to the editor text
		 */
		focus(): void;
		/**
		 * Returns true if the text inside this editor is focused (i.e. cursor is blinking).
		 */
		hasTextFocus(): boolean;
		/**
		 * Returns all actions associated with this editor.
		 */
		getSupportedActions(): IEditorAction[];
		/**
		 * Saves current view state of the editor in a serializable object.
		 */
		saveViewState(): IEditorViewState | null;
		/**
		 * Restores the view state of the editor from a serializable object generated by `saveViewState`.
		 */
		restoreViewState(state: IEditorViewState): void;
		/**
		 * Given a position, returns a column number that takes tab-widths into account.
		 */
		getVisibleColumnFromPosition(position: IPosition): number;
		/**
		 * Returns the primary position of the cursor.
		 */
		getPosition(): Position | null;
		/**
		 * Set the primary position of the cursor. This will remove any secondary cursors.
		 * @param position New primary cursor's position
		 */
		setPosition(position: IPosition): void;
		/**
		 * Scroll vertically as necessary and reveal a line.
		 */
		revealLine(lineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically as necessary and reveal a line centered vertically.
		 */
		revealLineInCenter(lineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically as necessary and reveal a line centered vertically only if it lies outside the viewport.
		 */
		revealLineInCenterIfOutsideViewport(lineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically as necessary and reveal a line close to the top of the viewport,
		 * optimized for viewing a code definition.
		 */
		revealLineNearTop(lineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a position.
		 */
		revealPosition(position: IPosition, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a position centered vertically.
		 */
		revealPositionInCenter(position: IPosition, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a position centered vertically only if it lies outside the viewport.
		 */
		revealPositionInCenterIfOutsideViewport(position: IPosition, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a position close to the top of the viewport,
		 * optimized for viewing a code definition.
		 */
		revealPositionNearTop(position: IPosition, scrollType?: ScrollType): void;
		/**
		 * Returns the primary selection of the editor.
		 */
		getSelection(): Selection | null;
		/**
		 * Returns all the selections of the editor.
		 */
		getSelections(): Selection[] | null;
		/**
		 * Set the primary selection of the editor. This will remove any secondary cursors.
		 * @param selection The new selection
		 */
		setSelection(selection: IRange): void;
		/**
		 * Set the primary selection of the editor. This will remove any secondary cursors.
		 * @param selection The new selection
		 */
		setSelection(selection: Range): void;
		/**
		 * Set the primary selection of the editor. This will remove any secondary cursors.
		 * @param selection The new selection
		 */
		setSelection(selection: ISelection): void;
		/**
		 * Set the primary selection of the editor. This will remove any secondary cursors.
		 * @param selection The new selection
		 */
		setSelection(selection: Selection): void;
		/**
		 * Set the selections for all the cursors of the editor.
		 * Cursors will be removed or added, as necessary.
		 */
		setSelections(selections: readonly ISelection[]): void;
		/**
		 * Scroll vertically as necessary and reveal lines.
		 */
		revealLines(startLineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically as necessary and reveal lines centered vertically.
		 */
		revealLinesInCenter(lineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically as necessary and reveal lines centered vertically only if it lies outside the viewport.
		 */
		revealLinesInCenterIfOutsideViewport(lineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically as necessary and reveal lines close to the top of the viewport,
		 * optimized for viewing a code definition.
		 */
		revealLinesNearTop(lineNumber: number, endLineNumber: number, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a range.
		 */
		revealRange(range: IRange, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a range centered vertically.
		 */
		revealRangeInCenter(range: IRange, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a range at the top of the viewport.
		 */
		revealRangeAtTop(range: IRange, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a range centered vertically only if it lies outside the viewport.
		 */
		revealRangeInCenterIfOutsideViewport(range: IRange, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a range close to the top of the viewport,
		 * optimized for viewing a code definition.
		 */
		revealRangeNearTop(range: IRange, scrollType?: ScrollType): void;
		/**
		 * Scroll vertically or horizontally as necessary and reveal a range close to the top of the viewport,
		 * optimized for viewing a code definition. Only if it lies outside the viewport.
		 */
		revealRangeNearTopIfOutsideViewport(range: IRange, scrollType?: ScrollType): void;
		/**
		 * Directly trigger a handler or an editor action.
		 * @param source The source of the call.
		 * @param handlerId The id of the handler or the id of a contribution.
		 * @param payload Extra data to be sent to the handler.
		 */
		trigger(source: string | null | undefined, handlerId: string, payload: any): void;
		/**
		 * Gets the current model attached to this editor.
		 */
		getModel(): IEditorModel | null;
		/**
		 * Sets the current model attached to this editor.
		 * If the previous model was created by the editor via the value key in the options
		 * literal object, it will be destroyed. Otherwise, if the previous model was set
		 * via setModel, or the model key in the options literal object, the previous model
		 * will not be destroyed.
		 * It is safe to call setModel(null) to simply detach the current model from the editor.
		 */
		setModel(model: IEditorModel | null): void;
	}

	/**
	 * An editor contribution that gets created every time a new editor gets created and gets disposed when the editor gets disposed.
	 */
	export interface IEditorContribution {
		/**
		 * Dispose this contribution.
		 */
		dispose(): void;
		/**
		 * Store view state.
		 */
		saveViewState?(): any;
		/**
		 * Restore view state.
		 */
		restoreViewState?(state: any): void;
	}

	/**
	 * The type of the `IEditor`.
	 */
	export const EditorType: {
		ICodeEditor: string;
		IDiffEditor: string;
	};

	/**
	 * An event describing that the current mode associated with a model has changed.
	 */
	export interface IModelLanguageChangedEvent {
		/**
		 * Previous language
		 */
		readonly oldLanguage: string;
		/**
		 * New language
		 */
		readonly newLanguage: string;
	}

	/**
	 * An event describing that the language configuration associated with a model has changed.
	 */
	export interface IModelLanguageConfigurationChangedEvent {
	}

	export interface IModelContentChange {
		/**
		 * The range that got replaced.
		 */
		readonly range: IRange;
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
	 * An event describing a change in the text of a model.
	 */
	export interface IModelContentChangedEvent {
		readonly changes: IModelContentChange[];
		/**
		 * The (new) end-of-line character.
		 */
		readonly eol: string;
		/**
		 * The new version id the model has transitioned to.
		 */
		readonly versionId: number;
		/**
		 * Flag that indicates that this event was generated while undoing.
		 */
		readonly isUndoing: boolean;
		/**
		 * Flag that indicates that this event was generated while redoing.
		 */
		readonly isRedoing: boolean;
		/**
		 * Flag that indicates that all decorations were lost with this edit.
		 * The model has been reset to a new value.
		 */
		readonly isFlush: boolean;
	}

	/**
	 * An event describing that model decorations have changed.
	 */
	export interface IModelDecorationsChangedEvent {
		readonly affectsMinimap: boolean;
		readonly affectsOverviewRuler: boolean;
	}

	export interface IModelOptionsChangedEvent {
		readonly tabSize: boolean;
		readonly indentSize: boolean;
		readonly insertSpaces: boolean;
		readonly trimAutoWhitespace: boolean;
	}

	/**
	 * Describes the reason the cursor has changed its position.
	 */
	export enum CursorChangeReason {
		/**
		 * Unknown or not set.
		 */
		NotSet = 0,
		/**
		 * A `model.setValue()` was called.
		 */
		ContentFlush = 1,
		/**
		 * The `model` has been changed outside of this cursor and the cursor recovers its position from associated markers.
		 */
		RecoverFromMarkers = 2,
		/**
		 * There was an explicit user gesture.
		 */
		Explicit = 3,
		/**
		 * There was a Paste.
		 */
		Paste = 4,
		/**
		 * There was an Undo.
		 */
		Undo = 5,
		/**
		 * There was a Redo.
		 */
		Redo = 6
	}

	/**
	 * An event describing that the cursor position has changed.
	 */
	export interface ICursorPositionChangedEvent {
		/**
		 * Primary cursor's position.
		 */
		readonly position: Position;
		/**
		 * Secondary cursors' position.
		 */
		readonly secondaryPositions: Position[];
		/**
		 * Reason.
		 */
		readonly reason: CursorChangeReason;
		/**
		 * Source of the call that caused the event.
		 */
		readonly source: string;
	}

	/**
	 * An event describing that the cursor selection has changed.
	 */
	export interface ICursorSelectionChangedEvent {
		/**
		 * The primary selection.
		 */
		readonly selection: Selection;
		/**
		 * The secondary selections.
		 */
		readonly secondarySelections: Selection[];
		/**
		 * The model version id.
		 */
		readonly modelVersionId: number;
		/**
		 * The old selections.
		 */
		readonly oldSelections: Selection[] | null;
		/**
		 * The model version id the that `oldSelections` refer to.
		 */
		readonly oldModelVersionId: number;
		/**
		 * Source of the call that caused the event.
		 */
		readonly source: string;
		/**
		 * Reason.
		 */
		readonly reason: CursorChangeReason;
	}

	export enum AccessibilitySupport {
		/**
		 * This should be the browser case where it is not known if a screen reader is attached or no.
		 */
		Unknown = 0,
		Disabled = 1,
		Enabled = 2
	}

	/**
	 * Configuration options for auto closing quotes and brackets
	 */
	export type EditorAutoClosingStrategy = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';

	/**
	 * Configuration options for auto wrapping quotes and brackets
	 */
	export type EditorAutoSurroundStrategy = 'languageDefined' | 'quotes' | 'brackets' | 'never';

	/**
	 * Configuration options for typing over closing quotes or brackets
	 */
	export type EditorAutoClosingEditStrategy = 'always' | 'auto' | 'never';

	/**
	 * Configuration options for auto indentation in the editor
	 */
	export enum EditorAutoIndentStrategy {
		None = 0,
		Keep = 1,
		Brackets = 2,
		Advanced = 3,
		Full = 4
	}

	/**
	 * Configuration options for the editor.
	 */
	export interface IEditorOptions {
		/**
		 * This editor is used inside a diff editor.
		 */
		inDiffEditor?: boolean;
		/**
		 * The aria label for the editor's textarea (when it is focused).
		 */
		ariaLabel?: string;
		/**
		 * The `tabindex` property of the editor's textarea
		 */
		tabIndex?: number;
		/**
		 * Render vertical lines at the specified columns.
		 * Defaults to empty array.
		 */
		rulers?: (number | IRulerOption)[];
		/**
		 * A string containing the word separators used when doing word navigation.
		 * Defaults to `~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?
		 */
		wordSeparators?: string;
		/**
		 * Enable Linux primary clipboard.
		 * Defaults to true.
		 */
		selectionClipboard?: boolean;
		/**
		 * Control the rendering of line numbers.
		 * If it is a function, it will be invoked when rendering a line number and the return value will be rendered.
		 * Otherwise, if it is a truey, line numbers will be rendered normally (equivalent of using an identity function).
		 * Otherwise, line numbers will not be rendered.
		 * Defaults to `on`.
		 */
		lineNumbers?: LineNumbersType;
		/**
		 * Controls the minimal number of visible leading and trailing lines surrounding the cursor.
		 * Defaults to 0.
		*/
		cursorSurroundingLines?: number;
		/**
		 * Controls when `cursorSurroundingLines` should be enforced
		 * Defaults to `default`, `cursorSurroundingLines` is not enforced when cursor position is changed
		 * by mouse.
		*/
		cursorSurroundingLinesStyle?: 'default' | 'all';
		/**
		 * Render last line number when the file ends with a newline.
		 * Defaults to true.
		*/
		renderFinalNewline?: boolean;
		/**
		 * Remove unusual line terminators like LINE SEPARATOR (LS), PARAGRAPH SEPARATOR (PS).
		 * Defaults to 'prompt'.
		 */
		unusualLineTerminators?: 'auto' | 'off' | 'prompt';
		/**
		 * Should the corresponding line be selected when clicking on the line number?
		 * Defaults to true.
		 */
		selectOnLineNumbers?: boolean;
		/**
		 * Control the width of line numbers, by reserving horizontal space for rendering at least an amount of digits.
		 * Defaults to 5.
		 */
		lineNumbersMinChars?: number;
		/**
		 * Enable the rendering of the glyph margin.
		 * Defaults to true in vscode and to false in monaco-editor.
		 */
		glyphMargin?: boolean;
		/**
		 * The width reserved for line decorations (in px).
		 * Line decorations are placed between line numbers and the editor content.
		 * You can pass in a string in the format floating point followed by "ch". e.g. 1.3ch.
		 * Defaults to 10.
		 */
		lineDecorationsWidth?: number | string;
		/**
		 * When revealing the cursor, a virtual padding (px) is added to the cursor, turning it into a rectangle.
		 * This virtual padding ensures that the cursor gets revealed before hitting the edge of the viewport.
		 * Defaults to 30 (px).
		 */
		revealHorizontalRightPadding?: number;
		/**
		 * Render the editor selection with rounded borders.
		 * Defaults to true.
		 */
		roundedSelection?: boolean;
		/**
		 * Class name to be added to the editor.
		 */
		extraEditorClassName?: string;
		/**
		 * Should the editor be read only. See also `domReadOnly`.
		 * Defaults to false.
		 */
		readOnly?: boolean;
		/**
		 * Should the textarea used for input use the DOM `readonly` attribute.
		 * Defaults to false.
		 */
		domReadOnly?: boolean;
		/**
		 * Enable linked editing.
		 * Defaults to false.
		 */
		linkedEditing?: boolean;
		/**
		 * deprecated, use linkedEditing instead
		 */
		renameOnType?: boolean;
		/**
		 * Should the editor render validation decorations.
		 * Defaults to editable.
		 */
		renderValidationDecorations?: 'editable' | 'on' | 'off';
		/**
		 * Control the behavior and rendering of the scrollbars.
		 */
		scrollbar?: IEditorScrollbarOptions;
		/**
		 * Control the behavior and rendering of the minimap.
		 */
		minimap?: IEditorMinimapOptions;
		/**
		 * Control the behavior of the find widget.
		 */
		find?: IEditorFindOptions;
		/**
		 * Display overflow widgets as `fixed`.
		 * Defaults to `false`.
		 */
		fixedOverflowWidgets?: boolean;
		/**
		 * The number of vertical lanes the overview ruler should render.
		 * Defaults to 3.
		 */
		overviewRulerLanes?: number;
		/**
		 * Controls if a border should be drawn around the overview ruler.
		 * Defaults to `true`.
		 */
		overviewRulerBorder?: boolean;
		/**
		 * Control the cursor animation style, possible values are 'blink', 'smooth', 'phase', 'expand' and 'solid'.
		 * Defaults to 'blink'.
		 */
		cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
		/**
		 * Zoom the font in the editor when using the mouse wheel in combination with holding Ctrl.
		 * Defaults to false.
		 */
		mouseWheelZoom?: boolean;
		/**
		 * Control the mouse pointer style, either 'text' or 'default' or 'copy'
		 * Defaults to 'text'
		 */
		mouseStyle?: 'text' | 'default' | 'copy';
		/**
		 * Enable smooth caret animation.
		 * Defaults to false.
		 */
		cursorSmoothCaretAnimation?: boolean;
		/**
		 * Control the cursor style, either 'block' or 'line'.
		 * Defaults to 'line'.
		 */
		cursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
		/**
		 * Control the width of the cursor when cursorStyle is set to 'line'
		 */
		cursorWidth?: number;
		/**
		 * Enable font ligatures.
		 * Defaults to false.
		 */
		fontLigatures?: boolean | string;
		/**
		 * Disable the use of `transform: translate3d(0px, 0px, 0px)` for the editor margin and lines layers.
		 * The usage of `transform: translate3d(0px, 0px, 0px)` acts as a hint for browsers to create an extra layer.
		 * Defaults to false.
		 */
		disableLayerHinting?: boolean;
		/**
		 * Disable the optimizations for monospace fonts.
		 * Defaults to false.
		 */
		disableMonospaceOptimizations?: boolean;
		/**
		 * Should the cursor be hidden in the overview ruler.
		 * Defaults to false.
		 */
		hideCursorInOverviewRuler?: boolean;
		/**
		 * Enable that scrolling can go one screen size after the last line.
		 * Defaults to true.
		 */
		scrollBeyondLastLine?: boolean;
		/**
		 * Enable that scrolling can go beyond the last column by a number of columns.
		 * Defaults to 5.
		 */
		scrollBeyondLastColumn?: number;
		/**
		 * Enable that the editor animates scrolling to a position.
		 * Defaults to false.
		 */
		smoothScrolling?: boolean;
		/**
		 * Enable that the editor will install an interval to check if its container dom node size has changed.
		 * Enabling this might have a severe performance impact.
		 * Defaults to false.
		 */
		automaticLayout?: boolean;
		/**
		 * Control the wrapping of the editor.
		 * When `wordWrap` = "off", the lines will never wrap.
		 * When `wordWrap` = "on", the lines will wrap at the viewport width.
		 * When `wordWrap` = "wordWrapColumn", the lines will wrap at `wordWrapColumn`.
		 * When `wordWrap` = "bounded", the lines will wrap at min(viewport width, wordWrapColumn).
		 * Defaults to "off".
		 */
		wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
		/**
		 * Override the `wordWrap` setting.
		 */
		wordWrapOverride1?: 'off' | 'on' | 'inherit';
		/**
		 * Override the `wordWrapOverride1` setting.
		 */
		wordWrapOverride2?: 'off' | 'on' | 'inherit';
		/**
		 * Control the wrapping of the editor.
		 * When `wordWrap` = "off", the lines will never wrap.
		 * When `wordWrap` = "on", the lines will wrap at the viewport width.
		 * When `wordWrap` = "wordWrapColumn", the lines will wrap at `wordWrapColumn`.
		 * When `wordWrap` = "bounded", the lines will wrap at min(viewport width, wordWrapColumn).
		 * Defaults to 80.
		 */
		wordWrapColumn?: number;
		/**
		 * Control indentation of wrapped lines. Can be: 'none', 'same', 'indent' or 'deepIndent'.
		 * Defaults to 'same' in vscode and to 'none' in monaco-editor.
		 */
		wrappingIndent?: 'none' | 'same' | 'indent' | 'deepIndent';
		/**
		 * Controls the wrapping strategy to use.
		 * Defaults to 'simple'.
		 */
		wrappingStrategy?: 'simple' | 'advanced';
		/**
		 * Configure word wrapping characters. A break will be introduced before these characters.
		 * Defaults to '([{‘“〈《「『【〔（［｛｢£¥＄￡￥+＋'.
		 */
		wordWrapBreakBeforeCharacters?: string;
		/**
		 * Configure word wrapping characters. A break will be introduced after these characters.
		 * Defaults to ' \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ｧｨｩｪｫｬｭｮｯｰ”〉》」』】〕）］｝｣'.
		 */
		wordWrapBreakAfterCharacters?: string;
		/**
		 * Performance guard: Stop rendering a line after x characters.
		 * Defaults to 10000.
		 * Use -1 to never stop rendering
		 */
		stopRenderingLineAfter?: number;
		/**
		 * Configure the editor's hover.
		 */
		hover?: IEditorHoverOptions;
		/**
		 * Enable detecting links and making them clickable.
		 * Defaults to true.
		 */
		links?: boolean;
		/**
		 * Enable inline color decorators and color picker rendering.
		 */
		colorDecorators?: boolean;
		/**
		 * Control the behaviour of comments in the editor.
		 */
		comments?: IEditorCommentsOptions;
		/**
		 * Enable custom contextmenu.
		 * Defaults to true.
		 */
		contextmenu?: boolean;
		/**
		 * A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events.
		 * Defaults to 1.
		 */
		mouseWheelScrollSensitivity?: number;
		/**
		 * FastScrolling mulitplier speed when pressing `Alt`
		 * Defaults to 5.
		 */
		fastScrollSensitivity?: number;
		/**
		 * Enable that the editor scrolls only the predominant axis. Prevents horizontal drift when scrolling vertically on a trackpad.
		 * Defaults to true.
		 */
		scrollPredominantAxis?: boolean;
		/**
		 * Enable that the selection with the mouse and keys is doing column selection.
		 * Defaults to false.
		 */
		columnSelection?: boolean;
		/**
		 * The modifier to be used to add multiple cursors with the mouse.
		 * Defaults to 'alt'
		 */
		multiCursorModifier?: 'ctrlCmd' | 'alt';
		/**
		 * Merge overlapping selections.
		 * Defaults to true
		 */
		multiCursorMergeOverlapping?: boolean;
		/**
		 * Configure the behaviour when pasting a text with the line count equal to the cursor count.
		 * Defaults to 'spread'.
		 */
		multiCursorPaste?: 'spread' | 'full';
		/**
		 * Configure the editor's accessibility support.
		 * Defaults to 'auto'. It is best to leave this to 'auto'.
		 */
		accessibilitySupport?: 'auto' | 'off' | 'on';
		/**
		 * Controls the number of lines in the editor that can be read out by a screen reader
		 */
		accessibilityPageSize?: number;
		/**
		 * Suggest options.
		 */
		suggest?: ISuggestOptions;
		inlineSuggest?: IInlineSuggestOptions;
		/**
		 * Smart select options.
		 */
		smartSelect?: ISmartSelectOptions;
		/**
		 *
		 */
		gotoLocation?: IGotoLocationOptions;
		/**
		 * Enable quick suggestions (shadow suggestions)
		 * Defaults to true.
		 */
		quickSuggestions?: boolean | IQuickSuggestionsOptions;
		/**
		 * Quick suggestions show delay (in ms)
		 * Defaults to 10 (ms)
		 */
		quickSuggestionsDelay?: number;
		/**
		 * Controls the spacing around the editor.
		 */
		padding?: IEditorPaddingOptions;
		/**
		 * Parameter hint options.
		 */
		parameterHints?: IEditorParameterHintOptions;
		/**
		 * Options for auto closing brackets.
		 * Defaults to language defined behavior.
		 */
		autoClosingBrackets?: EditorAutoClosingStrategy;
		/**
		 * Options for auto closing quotes.
		 * Defaults to language defined behavior.
		 */
		autoClosingQuotes?: EditorAutoClosingStrategy;
		/**
		 * Options for pressing backspace near quotes or bracket pairs.
		 */
		autoClosingDelete?: EditorAutoClosingEditStrategy;
		/**
		 * Options for typing over closing quotes or brackets.
		 */
		autoClosingOvertype?: EditorAutoClosingEditStrategy;
		/**
		 * Options for auto surrounding.
		 * Defaults to always allowing auto surrounding.
		 */
		autoSurround?: EditorAutoSurroundStrategy;
		/**
		 * Controls whether the editor should automatically adjust the indentation when users type, paste, move or indent lines.
		 * Defaults to advanced.
		 */
		autoIndent?: 'none' | 'keep' | 'brackets' | 'advanced' | 'full';
		/**
		 * Emulate selection behaviour of tab characters when using spaces for indentation.
		 * This means selection will stick to tab stops.
		 */
		stickyTabStops?: boolean;
		/**
		 * Enable format on type.
		 * Defaults to false.
		 */
		formatOnType?: boolean;
		/**
		 * Enable format on paste.
		 * Defaults to false.
		 */
		formatOnPaste?: boolean;
		/**
		 * Controls if the editor should allow to move selections via drag and drop.
		 * Defaults to false.
		 */
		dragAndDrop?: boolean;
		/**
		 * Enable the suggestion box to pop-up on trigger characters.
		 * Defaults to true.
		 */
		suggestOnTriggerCharacters?: boolean;
		/**
		 * Accept suggestions on ENTER.
		 * Defaults to 'on'.
		 */
		acceptSuggestionOnEnter?: 'on' | 'smart' | 'off';
		/**
		 * Accept suggestions on provider defined characters.
		 * Defaults to true.
		 */
		acceptSuggestionOnCommitCharacter?: boolean;
		/**
		 * Enable snippet suggestions. Default to 'true'.
		 */
		snippetSuggestions?: 'top' | 'bottom' | 'inline' | 'none';
		/**
		 * Copying without a selection copies the current line.
		 */
		emptySelectionClipboard?: boolean;
		/**
		 * Syntax highlighting is copied.
		 */
		copyWithSyntaxHighlighting?: boolean;
		/**
		 * The history mode for suggestions.
		 */
		suggestSelection?: 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix';
		/**
		 * The font size for the suggest widget.
		 * Defaults to the editor font size.
		 */
		suggestFontSize?: number;
		/**
		 * The line height for the suggest widget.
		 * Defaults to the editor line height.
		 */
		suggestLineHeight?: number;
		/**
		 * Enable tab completion.
		 */
		tabCompletion?: 'on' | 'off' | 'onlySnippets';
		/**
		 * Enable selection highlight.
		 * Defaults to true.
		 */
		selectionHighlight?: boolean;
		/**
		 * Enable semantic occurrences highlight.
		 * Defaults to true.
		 */
		occurrencesHighlight?: boolean;
		/**
		 * Show code lens
		 * Defaults to true.
		 */
		codeLens?: boolean;
		/**
		 * Code lens font family. Defaults to editor font family.
		 */
		codeLensFontFamily?: string;
		/**
		 * Code lens font size. Default to 90% of the editor font size
		 */
		codeLensFontSize?: number;
		/**
		 * Control the behavior and rendering of the code action lightbulb.
		 */
		lightbulb?: IEditorLightbulbOptions;
		/**
		 * Timeout for running code actions on save.
		 */
		codeActionsOnSaveTimeout?: number;
		/**
		 * Enable code folding.
		 * Defaults to true.
		 */
		folding?: boolean;
		/**
		 * Selects the folding strategy. 'auto' uses the strategies contributed for the current document, 'indentation' uses the indentation based folding strategy.
		 * Defaults to 'auto'.
		 */
		foldingStrategy?: 'auto' | 'indentation';
		/**
		 * Enable highlight for folded regions.
		 * Defaults to true.
		 */
		foldingHighlight?: boolean;
		/**
		 * Controls whether the fold actions in the gutter stay always visible or hide unless the mouse is over the gutter.
		 * Defaults to 'mouseover'.
		 */
		showFoldingControls?: 'always' | 'mouseover';
		/**
		 * Controls whether clicking on the empty content after a folded line will unfold the line.
		 * Defaults to false.
		 */
		unfoldOnClickAfterEndOfLine?: boolean;
		/**
		 * Enable highlighting of matching brackets.
		 * Defaults to 'always'.
		 */
		matchBrackets?: 'never' | 'near' | 'always';
		/**
		 * Enable rendering of whitespace.
		 * Defaults to 'selection'.
		 */
		renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
		/**
		 * Enable rendering of control characters.
		 * Defaults to false.
		 */
		renderControlCharacters?: boolean;
		/**
		 * Enable rendering of indent guides.
		 * Defaults to true.
		 */
		renderIndentGuides?: boolean;
		/**
		 * Enable highlighting of the active indent guide.
		 * Defaults to true.
		 */
		highlightActiveIndentGuide?: boolean;
		/**
		 * Enable rendering of current line highlight.
		 * Defaults to all.
		 */
		renderLineHighlight?: 'none' | 'gutter' | 'line' | 'all';
		/**
		 * Control if the current line highlight should be rendered only the editor is focused.
		 * Defaults to false.
		 */
		renderLineHighlightOnlyWhenFocus?: boolean;
		/**
		 * Inserting and deleting whitespace follows tab stops.
		 */
		useTabStops?: boolean;
		/**
		 * The font family
		 */
		fontFamily?: string;
		/**
		 * The font weight
		 */
		fontWeight?: string;
		/**
		 * The font size
		 */
		fontSize?: number;
		/**
		 * The line height
		 */
		lineHeight?: number;
		/**
		 * The letter spacing
		 */
		letterSpacing?: number;
		/**
		 * Controls fading out of unused variables.
		 */
		showUnused?: boolean;
		/**
		 * Controls whether to focus the inline editor in the peek widget by default.
		 * Defaults to false.
		 */
		peekWidgetDefaultFocus?: 'tree' | 'editor';
		/**
		 * Controls whether the definition link opens element in the peek widget.
		 * Defaults to false.
		 */
		definitionLinkOpensInPeek?: boolean;
		/**
		 * Controls strikethrough deprecated variables.
		 */
		showDeprecated?: boolean;
		/**
		 * Control the behavior and rendering of the inline hints.
		 */
		inlayHints?: IEditorInlayHintsOptions;
		/**
		 * Control if the editor should use shadow DOM.
		 */
		useShadowDOM?: boolean;
	}

	/**
	 * Configuration options for the diff editor.
	 */
	export interface IDiffEditorOptions extends IEditorOptions {
		/**
		 * Allow the user to resize the diff editor split view.
		 * Defaults to true.
		 */
		enableSplitViewResizing?: boolean;
		/**
		 * Render the differences in two side-by-side editors.
		 * Defaults to true.
		 */
		renderSideBySide?: boolean;
		/**
		 * Timeout in milliseconds after which diff computation is cancelled.
		 * Defaults to 5000.
		 */
		maxComputationTime?: number;
		/**
		 * Compute the diff by ignoring leading/trailing whitespace
		 * Defaults to true.
		 */
		ignoreTrimWhitespace?: boolean;
		/**
		 * Render +/- indicators for added/deleted changes.
		 * Defaults to true.
		 */
		renderIndicators?: boolean;
		/**
		 * Original model should be editable?
		 * Defaults to false.
		 */
		originalEditable?: boolean;
		/**
		 * Should the diff editor enable code lens?
		 * Defaults to false.
		 */
		diffCodeLens?: boolean;
		/**
		 * Is the diff editor inside another editor
		 * Defaults to false
		 */
		isInEmbeddedEditor?: boolean;
		/**
		 * Is the diff editor should render overview ruler
		 * Defaults to true
		 */
		renderOverviewRuler?: boolean;
		/**
		 * Control the wrapping of the diff editor.
		 */
		diffWordWrap?: 'off' | 'on' | 'inherit';
		/**
		 * Aria label for original editor.
		 */
		originalAriaLabel?: string;
		/**
		 * Aria label for modifed editor.
		 */
		modifiedAriaLabel?: string;
	}

	/**
	 * An event describing that the configuration of the editor has changed.
	 */
	export class ConfigurationChangedEvent {
		hasChanged(id: EditorOption): boolean;
	}

	/**
	 * All computed editor options.
	 */
	export interface IComputedEditorOptions {
		get<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;
	}

	export interface IEditorOption<K1 extends EditorOption, V> {
		readonly id: K1;
		readonly name: string;
		defaultValue: V;
	}

	/**
	 * Configuration options for editor comments
	 */
	export interface IEditorCommentsOptions {
		/**
		 * Insert a space after the line comment token and inside the block comments tokens.
		 * Defaults to true.
		 */
		insertSpace?: boolean;
		/**
		 * Ignore empty lines when inserting line comments.
		 * Defaults to true.
		 */
		ignoreEmptyLines?: boolean;
	}

	export type EditorCommentsOptions = Readonly<Required<IEditorCommentsOptions>>;

	/**
	 * The kind of animation in which the editor's cursor should be rendered.
	 */
	export enum TextEditorCursorBlinkingStyle {
		/**
		 * Hidden
		 */
		Hidden = 0,
		/**
		 * Blinking
		 */
		Blink = 1,
		/**
		 * Blinking with smooth fading
		 */
		Smooth = 2,
		/**
		 * Blinking with prolonged filled state and smooth fading
		 */
		Phase = 3,
		/**
		 * Expand collapse animation on the y axis
		 */
		Expand = 4,
		/**
		 * No-Blinking
		 */
		Solid = 5
	}

	/**
	 * The style in which the editor's cursor should be rendered.
	 */
	export enum TextEditorCursorStyle {
		/**
		 * As a vertical line (sitting between two characters).
		 */
		Line = 1,
		/**
		 * As a block (sitting on top of a character).
		 */
		Block = 2,
		/**
		 * As a horizontal line (sitting under a character).
		 */
		Underline = 3,
		/**
		 * As a thin vertical line (sitting between two characters).
		 */
		LineThin = 4,
		/**
		 * As an outlined block (sitting on top of a character).
		 */
		BlockOutline = 5,
		/**
		 * As a thin horizontal line (sitting under a character).
		 */
		UnderlineThin = 6
	}

	/**
	 * Configuration options for editor find widget
	 */
	export interface IEditorFindOptions {
		/**
		* Controls whether the cursor should move to find matches while typing.
		*/
		cursorMoveOnType?: boolean;
		/**
		 * Controls if we seed search string in the Find Widget with editor selection.
		 */
		seedSearchStringFromSelection?: boolean;
		/**
		 * Controls if we seed search string in the Find Widget with editor cursor position.
		 */
		seedSearchStringFromCursor?: boolean;
		/**
		 * Controls if Find in Selection flag is turned on in the editor.
		 */
		autoFindInSelection?: 'never' | 'always' | 'multiline';
		addExtraSpaceOnTop?: boolean;
		/**
		 * Controls whether the search automatically restarts from the beginning (or the end) when no further matches can be found
		 */
		loop?: boolean;
	}

	export type EditorFindOptions = Readonly<Required<IEditorFindOptions>>;

	export type GoToLocationValues = 'peek' | 'gotoAndPeek' | 'goto';

	/**
	 * Configuration options for go to location
	 */
	export interface IGotoLocationOptions {
		multiple?: GoToLocationValues;
		multipleDefinitions?: GoToLocationValues;
		multipleTypeDefinitions?: GoToLocationValues;
		multipleDeclarations?: GoToLocationValues;
		multipleImplementations?: GoToLocationValues;
		multipleReferences?: GoToLocationValues;
		alternativeDefinitionCommand?: string;
		alternativeTypeDefinitionCommand?: string;
		alternativeDeclarationCommand?: string;
		alternativeImplementationCommand?: string;
		alternativeReferenceCommand?: string;
	}

	export type GoToLocationOptions = Readonly<Required<IGotoLocationOptions>>;

	/**
	 * Configuration options for editor hover
	 */
	export interface IEditorHoverOptions {
		/**
		 * Enable the hover.
		 * Defaults to true.
		 */
		enabled?: boolean;
		/**
		 * Delay for showing the hover.
		 * Defaults to 300.
		 */
		delay?: number;
		/**
		 * Is the hover sticky such that it can be clicked and its contents selected?
		 * Defaults to true.
		 */
		sticky?: boolean;
	}

	export type EditorHoverOptions = Readonly<Required<IEditorHoverOptions>>;

	/**
	 * A description for the overview ruler position.
	 */
	export interface OverviewRulerPosition {
		/**
		 * Width of the overview ruler
		 */
		readonly width: number;
		/**
		 * Height of the overview ruler
		 */
		readonly height: number;
		/**
		 * Top position for the overview ruler
		 */
		readonly top: number;
		/**
		 * Right position for the overview ruler
		 */
		readonly right: number;
	}

	export enum RenderMinimap {
		None = 0,
		Text = 1,
		Blocks = 2
	}

	/**
	 * The internal layout details of the editor.
	 */
	export interface EditorLayoutInfo {
		/**
		 * Full editor width.
		 */
		readonly width: number;
		/**
		 * Full editor height.
		 */
		readonly height: number;
		/**
		 * Left position for the glyph margin.
		 */
		readonly glyphMarginLeft: number;
		/**
		 * The width of the glyph margin.
		 */
		readonly glyphMarginWidth: number;
		/**
		 * Left position for the line numbers.
		 */
		readonly lineNumbersLeft: number;
		/**
		 * The width of the line numbers.
		 */
		readonly lineNumbersWidth: number;
		/**
		 * Left position for the line decorations.
		 */
		readonly decorationsLeft: number;
		/**
		 * The width of the line decorations.
		 */
		readonly decorationsWidth: number;
		/**
		 * Left position for the content (actual text)
		 */
		readonly contentLeft: number;
		/**
		 * The width of the content (actual text)
		 */
		readonly contentWidth: number;
		/**
		 * Layout information for the minimap
		 */
		readonly minimap: EditorMinimapLayoutInfo;
		/**
		 * The number of columns (of typical characters) fitting on a viewport line.
		 */
		readonly viewportColumn: number;
		readonly isWordWrapMinified: boolean;
		readonly isViewportWrapping: boolean;
		readonly wrappingColumn: number;
		/**
		 * The width of the vertical scrollbar.
		 */
		readonly verticalScrollbarWidth: number;
		/**
		 * The height of the horizontal scrollbar.
		 */
		readonly horizontalScrollbarHeight: number;
		/**
		 * The position of the overview ruler.
		 */
		readonly overviewRuler: OverviewRulerPosition;
	}

	/**
	 * The internal layout details of the editor.
	 */
	export interface EditorMinimapLayoutInfo {
		readonly renderMinimap: RenderMinimap;
		readonly minimapLeft: number;
		readonly minimapWidth: number;
		readonly minimapHeightIsEditorHeight: boolean;
		readonly minimapIsSampling: boolean;
		readonly minimapScale: number;
		readonly minimapLineHeight: number;
		readonly minimapCanvasInnerWidth: number;
		readonly minimapCanvasInnerHeight: number;
		readonly minimapCanvasOuterWidth: number;
		readonly minimapCanvasOuterHeight: number;
	}

	/**
	 * Configuration options for editor lightbulb
	 */
	export interface IEditorLightbulbOptions {
		/**
		 * Enable the lightbulb code action.
		 * Defaults to true.
		 */
		enabled?: boolean;
	}

	export type EditorLightbulbOptions = Readonly<Required<IEditorLightbulbOptions>>;

	/**
	 * Configuration options for editor inlayHints
	 */
	export interface IEditorInlayHintsOptions {
		/**
		 * Enable the inline hints.
		 * Defaults to true.
		 */
		enabled?: boolean;
		/**
		 * Font size of inline hints.
		 * Default to 90% of the editor font size.
		 */
		fontSize?: number;
		/**
		 * Font family of inline hints.
		 * Defaults to editor font family.
		 */
		fontFamily?: string;
	}

	export type EditorInlayHintsOptions = Readonly<Required<IEditorInlayHintsOptions>>;

	/**
	 * Configuration options for editor minimap
	 */
	export interface IEditorMinimapOptions {
		/**
		 * Enable the rendering of the minimap.
		 * Defaults to true.
		 */
		enabled?: boolean;
		/**
		 * Control the side of the minimap in editor.
		 * Defaults to 'right'.
		 */
		side?: 'right' | 'left';
		/**
		 * Control the minimap rendering mode.
		 * Defaults to 'actual'.
		 */
		size?: 'proportional' | 'fill' | 'fit';
		/**
		 * Control the rendering of the minimap slider.
		 * Defaults to 'mouseover'.
		 */
		showSlider?: 'always' | 'mouseover';
		/**
		 * Render the actual text on a line (as opposed to color blocks).
		 * Defaults to true.
		 */
		renderCharacters?: boolean;
		/**
		 * Limit the width of the minimap to render at most a certain number of columns.
		 * Defaults to 120.
		 */
		maxColumn?: number;
		/**
		 * Relative size of the font in the minimap. Defaults to 1.
		 */
		scale?: number;
	}

	export type EditorMinimapOptions = Readonly<Required<IEditorMinimapOptions>>;

	/**
	 * Configuration options for editor padding
	 */
	export interface IEditorPaddingOptions {
		/**
		 * Spacing between top edge of editor and first line.
		 */
		top?: number;
		/**
		 * Spacing between bottom edge of editor and last line.
		 */
		bottom?: number;
	}

	export interface InternalEditorPaddingOptions {
		readonly top: number;
		readonly bottom: number;
	}

	/**
	 * Configuration options for parameter hints
	 */
	export interface IEditorParameterHintOptions {
		/**
		 * Enable parameter hints.
		 * Defaults to true.
		 */
		enabled?: boolean;
		/**
		 * Enable cycling of parameter hints.
		 * Defaults to false.
		 */
		cycle?: boolean;
	}

	export type InternalParameterHintOptions = Readonly<Required<IEditorParameterHintOptions>>;

	/**
	 * Configuration options for quick suggestions
	 */
	export interface IQuickSuggestionsOptions {
		other?: boolean;
		comments?: boolean;
		strings?: boolean;
	}

	export type ValidQuickSuggestionsOptions = boolean | Readonly<Required<IQuickSuggestionsOptions>>;

	export type LineNumbersType = 'on' | 'off' | 'relative' | 'interval' | ((lineNumber: number) => string);

	export enum RenderLineNumbersType {
		Off = 0,
		On = 1,
		Relative = 2,
		Interval = 3,
		Custom = 4
	}

	export interface InternalEditorRenderLineNumbersOptions {
		readonly renderType: RenderLineNumbersType;
		readonly renderFn: ((lineNumber: number) => string) | null;
	}

	export interface IRulerOption {
		readonly column: number;
		readonly color: string | null;
	}

	/**
	 * Configuration options for editor scrollbars
	 */
	export interface IEditorScrollbarOptions {
		/**
		 * The size of arrows (if displayed).
		 * Defaults to 11.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		arrowSize?: number;
		/**
		 * Render vertical scrollbar.
		 * Defaults to 'auto'.
		 */
		vertical?: 'auto' | 'visible' | 'hidden';
		/**
		 * Render horizontal scrollbar.
		 * Defaults to 'auto'.
		 */
		horizontal?: 'auto' | 'visible' | 'hidden';
		/**
		 * Cast horizontal and vertical shadows when the content is scrolled.
		 * Defaults to true.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		useShadows?: boolean;
		/**
		 * Render arrows at the top and bottom of the vertical scrollbar.
		 * Defaults to false.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		verticalHasArrows?: boolean;
		/**
		 * Render arrows at the left and right of the horizontal scrollbar.
		 * Defaults to false.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		horizontalHasArrows?: boolean;
		/**
		 * Listen to mouse wheel events and react to them by scrolling.
		 * Defaults to true.
		 */
		handleMouseWheel?: boolean;
		/**
		 * Always consume mouse wheel events (always call preventDefault() and stopPropagation() on the browser events).
		 * Defaults to true.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		alwaysConsumeMouseWheel?: boolean;
		/**
		 * Height in pixels for the horizontal scrollbar.
		 * Defaults to 10 (px).
		 */
		horizontalScrollbarSize?: number;
		/**
		 * Width in pixels for the vertical scrollbar.
		 * Defaults to 10 (px).
		 */
		verticalScrollbarSize?: number;
		/**
		 * Width in pixels for the vertical slider.
		 * Defaults to `verticalScrollbarSize`.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		verticalSliderSize?: number;
		/**
		 * Height in pixels for the horizontal slider.
		 * Defaults to `horizontalScrollbarSize`.
		 * **NOTE**: This option cannot be updated using `updateOptions()`
		 */
		horizontalSliderSize?: number;
		/**
		 * Scroll gutter clicks move by page vs jump to position.
		 * Defaults to false.
		 */
		scrollByPage?: boolean;
	}

	export interface InternalEditorScrollbarOptions {
		readonly arrowSize: number;
		readonly vertical: ScrollbarVisibility;
		readonly horizontal: ScrollbarVisibility;
		readonly useShadows: boolean;
		readonly verticalHasArrows: boolean;
		readonly horizontalHasArrows: boolean;
		readonly handleMouseWheel: boolean;
		readonly alwaysConsumeMouseWheel: boolean;
		readonly horizontalScrollbarSize: number;
		readonly horizontalSliderSize: number;
		readonly verticalScrollbarSize: number;
		readonly verticalSliderSize: number;
		readonly scrollByPage: boolean;
	}

	export interface IInlineSuggestOptions {
		/**
		 * Enable or disable the rendering of automatic inline completions.
		*/
		enabled?: boolean;
		/**
		 * Configures the mode.
		 * Use `prefix` to only show ghost text if the text to replace is a prefix of the suggestion text.
		 * Use `subword` to only show ghost text if the replace text is a subword of the suggestion text.
		 * Use `subwordSmart` to only show ghost text if the replace text is a subword of the suggestion text, but the subword must start after the cursor position.
		 * Defaults to `prefix`.
		*/
		mode?: 'prefix' | 'subword' | 'subwordSmart';
	}

	export type InternalInlineSuggestOptions = Readonly<Required<IInlineSuggestOptions>>;

	/**
	 * Configuration options for editor suggest widget
	 */
	export interface ISuggestOptions {
		/**
		 * Overwrite word ends on accept. Default to false.
		 */
		insertMode?: 'insert' | 'replace';
		/**
		 * Enable graceful matching. Defaults to true.
		 */
		filterGraceful?: boolean;
		/**
		 * Prevent quick suggestions when a snippet is active. Defaults to true.
		 */
		snippetsPreventQuickSuggestions?: boolean;
		/**
		 * Favors words that appear close to the cursor.
		 */
		localityBonus?: boolean;
		/**
		 * Enable using global storage for remembering suggestions.
		 */
		shareSuggestSelections?: boolean;
		/**
		 * Enable or disable icons in suggestions. Defaults to true.
		 */
		showIcons?: boolean;
		/**
		 * Enable or disable the suggest status bar.
		 */
		showStatusBar?: boolean;
		/**
		 * Enable or disable the rendering of the suggestion preview.
		 */
		preview?: boolean;
		/**
		 * Configures the mode of the preview.
		*/
		previewMode?: 'prefix' | 'subword' | 'subwordSmart';
		/**
		 * Show details inline with the label. Defaults to true.
		 */
		showInlineDetails?: boolean;
		/**
		 * Show method-suggestions.
		 */
		showMethods?: boolean;
		/**
		 * Show function-suggestions.
		 */
		showFunctions?: boolean;
		/**
		 * Show constructor-suggestions.
		 */
		showConstructors?: boolean;
		/**
		 * Show deprecated-suggestions.
		 */
		showDeprecated?: boolean;
		/**
		 * Show field-suggestions.
		 */
		showFields?: boolean;
		/**
		 * Show variable-suggestions.
		 */
		showVariables?: boolean;
		/**
		 * Show class-suggestions.
		 */
		showClasses?: boolean;
		/**
		 * Show struct-suggestions.
		 */
		showStructs?: boolean;
		/**
		 * Show interface-suggestions.
		 */
		showInterfaces?: boolean;
		/**
		 * Show module-suggestions.
		 */
		showModules?: boolean;
		/**
		 * Show property-suggestions.
		 */
		showProperties?: boolean;
		/**
		 * Show event-suggestions.
		 */
		showEvents?: boolean;
		/**
		 * Show operator-suggestions.
		 */
		showOperators?: boolean;
		/**
		 * Show unit-suggestions.
		 */
		showUnits?: boolean;
		/**
		 * Show value-suggestions.
		 */
		showValues?: boolean;
		/**
		 * Show constant-suggestions.
		 */
		showConstants?: boolean;
		/**
		 * Show enum-suggestions.
		 */
		showEnums?: boolean;
		/**
		 * Show enumMember-suggestions.
		 */
		showEnumMembers?: boolean;
		/**
		 * Show keyword-suggestions.
		 */
		showKeywords?: boolean;
		/**
		 * Show text-suggestions.
		 */
		showWords?: boolean;
		/**
		 * Show color-suggestions.
		 */
		showColors?: boolean;
		/**
		 * Show file-suggestions.
		 */
		showFiles?: boolean;
		/**
		 * Show reference-suggestions.
		 */
		showReferences?: boolean;
		/**
		 * Show folder-suggestions.
		 */
		showFolders?: boolean;
		/**
		 * Show typeParameter-suggestions.
		 */
		showTypeParameters?: boolean;
		/**
		 * Show issue-suggestions.
		 */
		showIssues?: boolean;
		/**
		 * Show user-suggestions.
		 */
		showUsers?: boolean;
		/**
		 * Show snippet-suggestions.
		 */
		showSnippets?: boolean;
	}

	export type InternalSuggestOptions = Readonly<Required<ISuggestOptions>>;

	export interface ISmartSelectOptions {
		selectLeadingAndTrailingWhitespace?: boolean;
	}

	export type SmartSelectOptions = Readonly<Required<ISmartSelectOptions>>;

	/**
	 * Describes how to indent wrapped lines.
	 */
	export enum WrappingIndent {
		/**
		 * No indentation => wrapped lines begin at column 1.
		 */
		None = 0,
		/**
		 * Same => wrapped lines get the same indentation as the parent.
		 */
		Same = 1,
		/**
		 * Indent => wrapped lines get +1 indentation toward the parent.
		 */
		Indent = 2,
		/**
		 * DeepIndent => wrapped lines get +2 indentation toward the parent.
		 */
		DeepIndent = 3
	}

	export interface EditorWrappingInfo {
		readonly isDominatedByLongLines: boolean;
		readonly isWordWrapMinified: boolean;
		readonly isViewportWrapping: boolean;
		readonly wrappingColumn: number;
	}

	export enum EditorOption {
		acceptSuggestionOnCommitCharacter = 0,
		acceptSuggestionOnEnter = 1,
		accessibilitySupport = 2,
		accessibilityPageSize = 3,
		ariaLabel = 4,
		autoClosingBrackets = 5,
		autoClosingDelete = 6,
		autoClosingOvertype = 7,
		autoClosingQuotes = 8,
		autoIndent = 9,
		automaticLayout = 10,
		autoSurround = 11,
		codeLens = 12,
		codeLensFontFamily = 13,
		codeLensFontSize = 14,
		colorDecorators = 15,
		columnSelection = 16,
		comments = 17,
		contextmenu = 18,
		copyWithSyntaxHighlighting = 19,
		cursorBlinking = 20,
		cursorSmoothCaretAnimation = 21,
		cursorStyle = 22,
		cursorSurroundingLines = 23,
		cursorSurroundingLinesStyle = 24,
		cursorWidth = 25,
		disableLayerHinting = 26,
		disableMonospaceOptimizations = 27,
		domReadOnly = 28,
		dragAndDrop = 29,
		emptySelectionClipboard = 30,
		extraEditorClassName = 31,
		fastScrollSensitivity = 32,
		find = 33,
		fixedOverflowWidgets = 34,
		folding = 35,
		foldingStrategy = 36,
		foldingHighlight = 37,
		unfoldOnClickAfterEndOfLine = 38,
		fontFamily = 39,
		fontInfo = 40,
		fontLigatures = 41,
		fontSize = 42,
		fontWeight = 43,
		formatOnPaste = 44,
		formatOnType = 45,
		glyphMargin = 46,
		gotoLocation = 47,
		hideCursorInOverviewRuler = 48,
		highlightActiveIndentGuide = 49,
		hover = 50,
		inDiffEditor = 51,
		inlineSuggest = 52,
		letterSpacing = 53,
		lightbulb = 54,
		lineDecorationsWidth = 55,
		lineHeight = 56,
		lineNumbers = 57,
		lineNumbersMinChars = 58,
		linkedEditing = 59,
		links = 60,
		matchBrackets = 61,
		minimap = 62,
		mouseStyle = 63,
		mouseWheelScrollSensitivity = 64,
		mouseWheelZoom = 65,
		multiCursorMergeOverlapping = 66,
		multiCursorModifier = 67,
		multiCursorPaste = 68,
		occurrencesHighlight = 69,
		overviewRulerBorder = 70,
		overviewRulerLanes = 71,
		padding = 72,
		parameterHints = 73,
		peekWidgetDefaultFocus = 74,
		definitionLinkOpensInPeek = 75,
		quickSuggestions = 76,
		quickSuggestionsDelay = 77,
		readOnly = 78,
		renameOnType = 79,
		renderControlCharacters = 80,
		renderIndentGuides = 81,
		renderFinalNewline = 82,
		renderLineHighlight = 83,
		renderLineHighlightOnlyWhenFocus = 84,
		renderValidationDecorations = 85,
		renderWhitespace = 86,
		revealHorizontalRightPadding = 87,
		roundedSelection = 88,
		rulers = 89,
		scrollbar = 90,
		scrollBeyondLastColumn = 91,
		scrollBeyondLastLine = 92,
		scrollPredominantAxis = 93,
		selectionClipboard = 94,
		selectionHighlight = 95,
		selectOnLineNumbers = 96,
		showFoldingControls = 97,
		showUnused = 98,
		snippetSuggestions = 99,
		smartSelect = 100,
		smoothScrolling = 101,
		stickyTabStops = 102,
		stopRenderingLineAfter = 103,
		suggest = 104,
		suggestFontSize = 105,
		suggestLineHeight = 106,
		suggestOnTriggerCharacters = 107,
		suggestSelection = 108,
		tabCompletion = 109,
		tabIndex = 110,
		unusualLineTerminators = 111,
		useShadowDOM = 112,
		useTabStops = 113,
		wordSeparators = 114,
		wordWrap = 115,
		wordWrapBreakAfterCharacters = 116,
		wordWrapBreakBeforeCharacters = 117,
		wordWrapColumn = 118,
		wordWrapOverride1 = 119,
		wordWrapOverride2 = 120,
		wrappingIndent = 121,
		wrappingStrategy = 122,
		showDeprecated = 123,
		inlayHints = 124,
		editorClassName = 125,
		pixelRatio = 126,
		tabFocusMode = 127,
		layoutInfo = 128,
		wrappingInfo = 129
	}
	export const EditorOptions: {
		acceptSuggestionOnCommitCharacter: IEditorOption<EditorOption.acceptSuggestionOnCommitCharacter, boolean>;
		acceptSuggestionOnEnter: IEditorOption<EditorOption.acceptSuggestionOnEnter, 'on' | 'off' | 'smart'>;
		accessibilitySupport: IEditorOption<EditorOption.accessibilitySupport, AccessibilitySupport>;
		accessibilityPageSize: IEditorOption<EditorOption.accessibilityPageSize, number>;
		ariaLabel: IEditorOption<EditorOption.ariaLabel, string>;
		autoClosingBrackets: IEditorOption<EditorOption.autoClosingBrackets, 'always' | 'languageDefined' | 'beforeWhitespace' | 'never'>;
		autoClosingDelete: IEditorOption<EditorOption.autoClosingDelete, 'always' | 'never' | 'auto'>;
		autoClosingOvertype: IEditorOption<EditorOption.autoClosingOvertype, 'always' | 'never' | 'auto'>;
		autoClosingQuotes: IEditorOption<EditorOption.autoClosingQuotes, 'always' | 'languageDefined' | 'beforeWhitespace' | 'never'>;
		autoIndent: IEditorOption<EditorOption.autoIndent, EditorAutoIndentStrategy>;
		automaticLayout: IEditorOption<EditorOption.automaticLayout, boolean>;
		autoSurround: IEditorOption<EditorOption.autoSurround, 'languageDefined' | 'never' | 'quotes' | 'brackets'>;
		stickyTabStops: IEditorOption<EditorOption.stickyTabStops, boolean>;
		codeLens: IEditorOption<EditorOption.codeLens, boolean>;
		codeLensFontFamily: IEditorOption<EditorOption.codeLensFontFamily, string>;
		codeLensFontSize: IEditorOption<EditorOption.codeLensFontSize, number>;
		colorDecorators: IEditorOption<EditorOption.colorDecorators, boolean>;
		columnSelection: IEditorOption<EditorOption.columnSelection, boolean>;
		comments: IEditorOption<EditorOption.comments, EditorCommentsOptions>;
		contextmenu: IEditorOption<EditorOption.contextmenu, boolean>;
		copyWithSyntaxHighlighting: IEditorOption<EditorOption.copyWithSyntaxHighlighting, boolean>;
		cursorBlinking: IEditorOption<EditorOption.cursorBlinking, TextEditorCursorBlinkingStyle>;
		cursorSmoothCaretAnimation: IEditorOption<EditorOption.cursorSmoothCaretAnimation, boolean>;
		cursorStyle: IEditorOption<EditorOption.cursorStyle, TextEditorCursorStyle>;
		cursorSurroundingLines: IEditorOption<EditorOption.cursorSurroundingLines, number>;
		cursorSurroundingLinesStyle: IEditorOption<EditorOption.cursorSurroundingLinesStyle, 'default' | 'all'>;
		cursorWidth: IEditorOption<EditorOption.cursorWidth, number>;
		disableLayerHinting: IEditorOption<EditorOption.disableLayerHinting, boolean>;
		disableMonospaceOptimizations: IEditorOption<EditorOption.disableMonospaceOptimizations, boolean>;
		domReadOnly: IEditorOption<EditorOption.domReadOnly, boolean>;
		dragAndDrop: IEditorOption<EditorOption.dragAndDrop, boolean>;
		emptySelectionClipboard: IEditorOption<EditorOption.emptySelectionClipboard, boolean>;
		extraEditorClassName: IEditorOption<EditorOption.extraEditorClassName, string>;
		fastScrollSensitivity: IEditorOption<EditorOption.fastScrollSensitivity, number>;
		find: IEditorOption<EditorOption.find, EditorFindOptions>;
		fixedOverflowWidgets: IEditorOption<EditorOption.fixedOverflowWidgets, boolean>;
		folding: IEditorOption<EditorOption.folding, boolean>;
		foldingStrategy: IEditorOption<EditorOption.foldingStrategy, 'auto' | 'indentation'>;
		foldingHighlight: IEditorOption<EditorOption.foldingHighlight, boolean>;
		unfoldOnClickAfterEndOfLine: IEditorOption<EditorOption.unfoldOnClickAfterEndOfLine, boolean>;
		fontFamily: IEditorOption<EditorOption.fontFamily, string>;
		fontInfo: IEditorOption<EditorOption.fontInfo, FontInfo>;
		fontLigatures2: IEditorOption<EditorOption.fontLigatures, string>;
		fontSize: IEditorOption<EditorOption.fontSize, number>;
		fontWeight: IEditorOption<EditorOption.fontWeight, string>;
		formatOnPaste: IEditorOption<EditorOption.formatOnPaste, boolean>;
		formatOnType: IEditorOption<EditorOption.formatOnType, boolean>;
		glyphMargin: IEditorOption<EditorOption.glyphMargin, boolean>;
		gotoLocation: IEditorOption<EditorOption.gotoLocation, GoToLocationOptions>;
		hideCursorInOverviewRuler: IEditorOption<EditorOption.hideCursorInOverviewRuler, boolean>;
		highlightActiveIndentGuide: IEditorOption<EditorOption.highlightActiveIndentGuide, boolean>;
		hover: IEditorOption<EditorOption.hover, EditorHoverOptions>;
		inDiffEditor: IEditorOption<EditorOption.inDiffEditor, boolean>;
		letterSpacing: IEditorOption<EditorOption.letterSpacing, number>;
		lightbulb: IEditorOption<EditorOption.lightbulb, EditorLightbulbOptions>;
		lineDecorationsWidth: IEditorOption<EditorOption.lineDecorationsWidth, string | number>;
		lineHeight: IEditorOption<EditorOption.lineHeight, number>;
		lineNumbers: IEditorOption<EditorOption.lineNumbers, InternalEditorRenderLineNumbersOptions>;
		lineNumbersMinChars: IEditorOption<EditorOption.lineNumbersMinChars, number>;
		linkedEditing: IEditorOption<EditorOption.linkedEditing, boolean>;
		links: IEditorOption<EditorOption.links, boolean>;
		matchBrackets: IEditorOption<EditorOption.matchBrackets, 'always' | 'never' | 'near'>;
		minimap: IEditorOption<EditorOption.minimap, EditorMinimapOptions>;
		mouseStyle: IEditorOption<EditorOption.mouseStyle, 'default' | 'text' | 'copy'>;
		mouseWheelScrollSensitivity: IEditorOption<EditorOption.mouseWheelScrollSensitivity, number>;
		mouseWheelZoom: IEditorOption<EditorOption.mouseWheelZoom, boolean>;
		multiCursorMergeOverlapping: IEditorOption<EditorOption.multiCursorMergeOverlapping, boolean>;
		multiCursorModifier: IEditorOption<EditorOption.multiCursorModifier, 'altKey' | 'metaKey' | 'ctrlKey'>;
		multiCursorPaste: IEditorOption<EditorOption.multiCursorPaste, 'spread' | 'full'>;
		occurrencesHighlight: IEditorOption<EditorOption.occurrencesHighlight, boolean>;
		overviewRulerBorder: IEditorOption<EditorOption.overviewRulerBorder, boolean>;
		overviewRulerLanes: IEditorOption<EditorOption.overviewRulerLanes, number>;
		padding: IEditorOption<EditorOption.padding, InternalEditorPaddingOptions>;
		parameterHints: IEditorOption<EditorOption.parameterHints, InternalParameterHintOptions>;
		peekWidgetDefaultFocus: IEditorOption<EditorOption.peekWidgetDefaultFocus, 'tree' | 'editor'>;
		definitionLinkOpensInPeek: IEditorOption<EditorOption.definitionLinkOpensInPeek, boolean>;
		quickSuggestions: IEditorOption<EditorOption.quickSuggestions, ValidQuickSuggestionsOptions>;
		quickSuggestionsDelay: IEditorOption<EditorOption.quickSuggestionsDelay, number>;
		readOnly: IEditorOption<EditorOption.readOnly, boolean>;
		renameOnType: IEditorOption<EditorOption.renameOnType, boolean>;
		renderControlCharacters: IEditorOption<EditorOption.renderControlCharacters, boolean>;
		renderIndentGuides: IEditorOption<EditorOption.renderIndentGuides, boolean>;
		renderFinalNewline: IEditorOption<EditorOption.renderFinalNewline, boolean>;
		renderLineHighlight: IEditorOption<EditorOption.renderLineHighlight, 'all' | 'line' | 'none' | 'gutter'>;
		renderLineHighlightOnlyWhenFocus: IEditorOption<EditorOption.renderLineHighlightOnlyWhenFocus, boolean>;
		renderValidationDecorations: IEditorOption<EditorOption.renderValidationDecorations, 'on' | 'off' | 'editable'>;
		renderWhitespace: IEditorOption<EditorOption.renderWhitespace, 'all' | 'none' | 'boundary' | 'selection' | 'trailing'>;
		revealHorizontalRightPadding: IEditorOption<EditorOption.revealHorizontalRightPadding, number>;
		roundedSelection: IEditorOption<EditorOption.roundedSelection, boolean>;
		rulers: IEditorOption<EditorOption.rulers, {}>;
		scrollbar: IEditorOption<EditorOption.scrollbar, InternalEditorScrollbarOptions>;
		scrollBeyondLastColumn: IEditorOption<EditorOption.scrollBeyondLastColumn, number>;
		scrollBeyondLastLine: IEditorOption<EditorOption.scrollBeyondLastLine, boolean>;
		scrollPredominantAxis: IEditorOption<EditorOption.scrollPredominantAxis, boolean>;
		selectionClipboard: IEditorOption<EditorOption.selectionClipboard, boolean>;
		selectionHighlight: IEditorOption<EditorOption.selectionHighlight, boolean>;
		selectOnLineNumbers: IEditorOption<EditorOption.selectOnLineNumbers, boolean>;
		showFoldingControls: IEditorOption<EditorOption.showFoldingControls, 'always' | 'mouseover'>;
		showUnused: IEditorOption<EditorOption.showUnused, boolean>;
		showDeprecated: IEditorOption<EditorOption.showDeprecated, boolean>;
		inlayHints: IEditorOption<EditorOption.inlayHints, any>;
		snippetSuggestions: IEditorOption<EditorOption.snippetSuggestions, 'none' | 'top' | 'bottom' | 'inline'>;
		smartSelect: IEditorOption<EditorOption.smartSelect, any>;
		smoothScrolling: IEditorOption<EditorOption.smoothScrolling, boolean>;
		stopRenderingLineAfter: IEditorOption<EditorOption.stopRenderingLineAfter, number>;
		suggest: IEditorOption<EditorOption.suggest, InternalSuggestOptions>;
		inlineSuggest: IEditorOption<EditorOption.inlineSuggest, any>;
		suggestFontSize: IEditorOption<EditorOption.suggestFontSize, number>;
		suggestLineHeight: IEditorOption<EditorOption.suggestLineHeight, number>;
		suggestOnTriggerCharacters: IEditorOption<EditorOption.suggestOnTriggerCharacters, boolean>;
		suggestSelection: IEditorOption<EditorOption.suggestSelection, 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix'>;
		tabCompletion: IEditorOption<EditorOption.tabCompletion, 'on' | 'off' | 'onlySnippets'>;
		tabIndex: IEditorOption<EditorOption.tabIndex, number>;
		unusualLineTerminators: IEditorOption<EditorOption.unusualLineTerminators, 'auto' | 'off' | 'prompt'>;
		useShadowDOM: IEditorOption<EditorOption.useShadowDOM, boolean>;
		useTabStops: IEditorOption<EditorOption.useTabStops, boolean>;
		wordSeparators: IEditorOption<EditorOption.wordSeparators, string>;
		wordWrap: IEditorOption<EditorOption.wordWrap, 'on' | 'off' | 'wordWrapColumn' | 'bounded'>;
		wordWrapBreakAfterCharacters: IEditorOption<EditorOption.wordWrapBreakAfterCharacters, string>;
		wordWrapBreakBeforeCharacters: IEditorOption<EditorOption.wordWrapBreakBeforeCharacters, string>;
		wordWrapColumn: IEditorOption<EditorOption.wordWrapColumn, number>;
		wordWrapOverride1: IEditorOption<EditorOption.wordWrapOverride1, 'on' | 'off' | 'inherit'>;
		wordWrapOverride2: IEditorOption<EditorOption.wordWrapOverride2, 'on' | 'off' | 'inherit'>;
		wrappingIndent: IEditorOption<EditorOption.wrappingIndent, WrappingIndent>;
		wrappingStrategy: IEditorOption<EditorOption.wrappingStrategy, 'simple' | 'advanced'>;
		editorClassName: IEditorOption<EditorOption.editorClassName, string>;
		pixelRatio: IEditorOption<EditorOption.pixelRatio, number>;
		tabFocusMode: IEditorOption<EditorOption.tabFocusMode, boolean>;
		layoutInfo: IEditorOption<EditorOption.layoutInfo, EditorLayoutInfo>;
		wrappingInfo: IEditorOption<EditorOption.wrappingInfo, EditorWrappingInfo>;
	};

	type EditorOptionsType = typeof EditorOptions;

	type FindEditorOptionsKeyById<T extends EditorOption> = {
		[K in keyof EditorOptionsType]: EditorOptionsType[K]['id'] extends T ? K : never;
	}[keyof EditorOptionsType];

	type ComputedEditorOptionValue<T extends IEditorOption<any, any>> = T extends IEditorOption<any, infer R> ? R : never;

	export type FindComputedEditorOptionValueById<T extends EditorOption> = NonNullable<ComputedEditorOptionValue<EditorOptionsType[FindEditorOptionsKeyById<T>]>>;

	/**
	 * A view zone is a full horizontal rectangle that 'pushes' text down.
	 * The editor reserves space for view zones when rendering.
	 */
	export interface IViewZone {
		/**
		 * The line number after which this zone should appear.
		 * Use 0 to place a view zone before the first line number.
		 */
		afterLineNumber: number;
		/**
		 * The column after which this zone should appear.
		 * If not set, the maxLineColumn of `afterLineNumber` will be used.
		 */
		afterColumn?: number;
		/**
		 * Suppress mouse down events.
		 * If set, the editor will attach a mouse down listener to the view zone and .preventDefault on it.
		 * Defaults to false
		 */
		suppressMouseDown?: boolean;
		/**
		 * The height in lines of the view zone.
		 * If specified, `heightInPx` will be used instead of this.
		 * If neither `heightInPx` nor `heightInLines` is specified, a default of `heightInLines` = 1 will be chosen.
		 */
		heightInLines?: number;
		/**
		 * The height in px of the view zone.
		 * If this is set, the editor will give preference to it rather than `heightInLines` above.
		 * If neither `heightInPx` nor `heightInLines` is specified, a default of `heightInLines` = 1 will be chosen.
		 */
		heightInPx?: number;
		/**
		 * The minimum width in px of the view zone.
		 * If this is set, the editor will ensure that the scroll width is >= than this value.
		 */
		minWidthInPx?: number;
		/**
		 * The dom node of the view zone
		 */
		domNode: HTMLElement;
		/**
		 * An optional dom node for the view zone that will be placed in the margin area.
		 */
		marginDomNode?: HTMLElement | null;
		/**
		 * Callback which gives the relative top of the view zone as it appears (taking scrolling into account).
		 */
		onDomNodeTop?: (top: number) => void;
		/**
		 * Callback which gives the height in pixels of the view zone.
		 */
		onComputedHeight?: (height: number) => void;
	}

	/**
	 * An accessor that allows for zones to be added or removed.
	 */
	export interface IViewZoneChangeAccessor {
		/**
		 * Create a new view zone.
		 * @param zone Zone to create
		 * @return A unique identifier to the view zone.
		 */
		addZone(zone: IViewZone): string;
		/**
		 * Remove a zone
		 * @param id A unique identifier to the view zone, as returned by the `addZone` call.
		 */
		removeZone(id: string): void;
		/**
		 * Change a zone's position.
		 * The editor will rescan the `afterLineNumber` and `afterColumn` properties of a view zone.
		 */
		layoutZone(id: string): void;
	}

	/**
	 * A positioning preference for rendering content widgets.
	 */
	export enum ContentWidgetPositionPreference {
		/**
		 * Place the content widget exactly at a position
		 */
		EXACT = 0,
		/**
		 * Place the content widget above a position
		 */
		ABOVE = 1,
		/**
		 * Place the content widget below a position
		 */
		BELOW = 2
	}

	/**
	 * A position for rendering content widgets.
	 */
	export interface IContentWidgetPosition {
		/**
		 * Desired position for the content widget.
		 * `preference` will also affect the placement.
		 */
		position: IPosition | null;
		/**
		 * Optionally, a range can be provided to further
		 * define the position of the content widget.
		 */
		range?: IRange | null;
		/**
		 * Placement preference for position, in order of preference.
		 */
		preference: ContentWidgetPositionPreference[];
	}

	/**
	 * A content widget renders inline with the text and can be easily placed 'near' an editor position.
	 */
	export interface IContentWidget {
		/**
		 * Render this content widget in a location where it could overflow the editor's view dom node.
		 */
		allowEditorOverflow?: boolean;
		suppressMouseDown?: boolean;
		/**
		 * Get a unique identifier of the content widget.
		 */
		getId(): string;
		/**
		 * Get the dom node of the content widget.
		 */
		getDomNode(): HTMLElement;
		/**
		 * Get the placement of the content widget.
		 * If null is returned, the content widget will be placed off screen.
		 */
		getPosition(): IContentWidgetPosition | null;
		/**
		 * Optional function that is invoked before rendering
		 * the content widget. If a dimension is returned the editor will
		 * attempt to use it.
		 */
		beforeRender?(): IDimension | null;
		/**
		 * Optional function that is invoked after rendering the content
		 * widget. Is being invoked with the selected position preference
		 * or `null` if not rendered.
		 */
		afterRender?(position: ContentWidgetPositionPreference | null): void;
	}

	/**
	 * A positioning preference for rendering overlay widgets.
	 */
	export enum OverlayWidgetPositionPreference {
		/**
		 * Position the overlay widget in the top right corner
		 */
		TOP_RIGHT_CORNER = 0,
		/**
		 * Position the overlay widget in the bottom right corner
		 */
		BOTTOM_RIGHT_CORNER = 1,
		/**
		 * Position the overlay widget in the top center
		 */
		TOP_CENTER = 2
	}

	/**
	 * A position for rendering overlay widgets.
	 */
	export interface IOverlayWidgetPosition {
		/**
		 * The position preference for the overlay widget.
		 */
		preference: OverlayWidgetPositionPreference | null;
	}

	/**
	 * An overlay widgets renders on top of the text.
	 */
	export interface IOverlayWidget {
		/**
		 * Get a unique identifier of the overlay widget.
		 */
		getId(): string;
		/**
		 * Get the dom node of the overlay widget.
		 */
		getDomNode(): HTMLElement;
		/**
		 * Get the placement of the overlay widget.
		 * If null is returned, the overlay widget is responsible to place itself.
		 */
		getPosition(): IOverlayWidgetPosition | null;
	}

	/**
	 * Type of hit element with the mouse in the editor.
	 */
	export enum MouseTargetType {
		/**
		 * Mouse is on top of an unknown element.
		 */
		UNKNOWN = 0,
		/**
		 * Mouse is on top of the textarea used for input.
		 */
		TEXTAREA = 1,
		/**
		 * Mouse is on top of the glyph margin
		 */
		GUTTER_GLYPH_MARGIN = 2,
		/**
		 * Mouse is on top of the line numbers
		 */
		GUTTER_LINE_NUMBERS = 3,
		/**
		 * Mouse is on top of the line decorations
		 */
		GUTTER_LINE_DECORATIONS = 4,
		/**
		 * Mouse is on top of the whitespace left in the gutter by a view zone.
		 */
		GUTTER_VIEW_ZONE = 5,
		/**
		 * Mouse is on top of text in the content.
		 */
		CONTENT_TEXT = 6,
		/**
		 * Mouse is on top of empty space in the content (e.g. after line text or below last line)
		 */
		CONTENT_EMPTY = 7,
		/**
		 * Mouse is on top of a view zone in the content.
		 */
		CONTENT_VIEW_ZONE = 8,
		/**
		 * Mouse is on top of a content widget.
		 */
		CONTENT_WIDGET = 9,
		/**
		 * Mouse is on top of the decorations overview ruler.
		 */
		OVERVIEW_RULER = 10,
		/**
		 * Mouse is on top of a scrollbar.
		 */
		SCROLLBAR = 11,
		/**
		 * Mouse is on top of an overlay widget.
		 */
		OVERLAY_WIDGET = 12,
		/**
		 * Mouse is outside of the editor.
		 */
		OUTSIDE_EDITOR = 13
	}

	/**
	 * Target hit with the mouse in the editor.
	 */
	export interface IMouseTarget {
		/**
		 * The target element
		 */
		readonly element: Element | null;
		/**
		 * The target type
		 */
		readonly type: MouseTargetType;
		/**
		 * The 'approximate' editor position
		 */
		readonly position: Position | null;
		/**
		 * Desired mouse column (e.g. when position.column gets clamped to text length -- clicking after text on a line).
		 */
		readonly mouseColumn: number;
		/**
		 * The 'approximate' editor range
		 */
		readonly range: Range | null;
		/**
		 * Some extra detail.
		 */
		readonly detail: any;
	}

	/**
	 * A mouse event originating from the editor.
	 */
	export interface IEditorMouseEvent {
		readonly event: IMouseEvent;
		readonly target: IMouseTarget;
	}

	export interface IPartialEditorMouseEvent {
		readonly event: IMouseEvent;
		readonly target: IMouseTarget | null;
	}

	/**
	 * A paste event originating from the editor.
	 */
	export interface IPasteEvent {
		readonly range: Range;
		readonly mode: string | null;
	}

	export interface IEditorConstructionOptions extends IEditorOptions {
		/**
		 * The initial editor dimension (to avoid measuring the container).
		 */
		dimension?: IDimension;
		/**
		 * Place overflow widgets inside an external DOM node.
		 * Defaults to an internal DOM node.
		 */
		overflowWidgetsDomNode?: HTMLElement;
	}

	export interface IDiffEditorConstructionOptions extends IDiffEditorOptions {
		/**
		 * The initial editor dimension (to avoid measuring the container).
		 */
		dimension?: IDimension;
		/**
		 * Place overflow widgets inside an external DOM node.
		 * Defaults to an internal DOM node.
		 */
		overflowWidgetsDomNode?: HTMLElement;
	}

	/**
	 * A rich code editor.
	 */
	export interface ICodeEditor extends IEditor {
		/**
		 * An event emitted when the content of the current model has changed.
		 * @event
		 */
		onDidChangeModelContent(listener: (e: IModelContentChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the language of the current model has changed.
		 * @event
		 */
		onDidChangeModelLanguage(listener: (e: IModelLanguageChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the language configuration of the current model has changed.
		 * @event
		 */
		onDidChangeModelLanguageConfiguration(listener: (e: IModelLanguageConfigurationChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the options of the current model has changed.
		 * @event
		 */
		onDidChangeModelOptions(listener: (e: IModelOptionsChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the configuration of the editor has changed. (e.g. `editor.updateOptions()`)
		 * @event
		 */
		onDidChangeConfiguration(listener: (e: ConfigurationChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the cursor position has changed.
		 * @event
		 */
		onDidChangeCursorPosition(listener: (e: ICursorPositionChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the cursor selection has changed.
		 * @event
		 */
		onDidChangeCursorSelection(listener: (e: ICursorSelectionChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the model of this editor has changed (e.g. `editor.setModel()`).
		 * @event
		 */
		onDidChangeModel(listener: (e: IModelChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the decorations of the current model have changed.
		 * @event
		 */
		onDidChangeModelDecorations(listener: (e: IModelDecorationsChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the text inside this editor gained focus (i.e. cursor starts blinking).
		 * @event
		 */
		onDidFocusEditorText(listener: () => void): IDisposable;
		/**
		 * An event emitted when the text inside this editor lost focus (i.e. cursor stops blinking).
		 * @event
		 */
		onDidBlurEditorText(listener: () => void): IDisposable;
		/**
		 * An event emitted when the text inside this editor or an editor widget gained focus.
		 * @event
		 */
		onDidFocusEditorWidget(listener: () => void): IDisposable;
		/**
		 * An event emitted when the text inside this editor or an editor widget lost focus.
		 * @event
		 */
		onDidBlurEditorWidget(listener: () => void): IDisposable;
		/**
		 * An event emitted after composition has started.
		 */
		onDidCompositionStart(listener: () => void): IDisposable;
		/**
		 * An event emitted after composition has ended.
		 */
		onDidCompositionEnd(listener: () => void): IDisposable;
		/**
		 * An event emitted when editing failed because the editor is read-only.
		 * @event
		 */
		onDidAttemptReadOnlyEdit(listener: () => void): IDisposable;
		/**
		 * An event emitted when users paste text in the editor.
		 * @event
		 */
		onDidPaste(listener: (e: IPasteEvent) => void): IDisposable;
		/**
		 * An event emitted on a "mouseup".
		 * @event
		 */
		onMouseUp(listener: (e: IEditorMouseEvent) => void): IDisposable;
		/**
		 * An event emitted on a "mousedown".
		 * @event
		 */
		onMouseDown(listener: (e: IEditorMouseEvent) => void): IDisposable;
		/**
		 * An event emitted on a "contextmenu".
		 * @event
		 */
		onContextMenu(listener: (e: IEditorMouseEvent) => void): IDisposable;
		/**
		 * An event emitted on a "mousemove".
		 * @event
		 */
		onMouseMove(listener: (e: IEditorMouseEvent) => void): IDisposable;
		/**
		 * An event emitted on a "mouseleave".
		 * @event
		 */
		onMouseLeave(listener: (e: IPartialEditorMouseEvent) => void): IDisposable;
		/**
		 * An event emitted on a "keyup".
		 * @event
		 */
		onKeyUp(listener: (e: IKeyboardEvent) => void): IDisposable;
		/**
		 * An event emitted on a "keydown".
		 * @event
		 */
		onKeyDown(listener: (e: IKeyboardEvent) => void): IDisposable;
		/**
		 * An event emitted when the layout of the editor has changed.
		 * @event
		 */
		onDidLayoutChange(listener: (e: EditorLayoutInfo) => void): IDisposable;
		/**
		 * An event emitted when the content width or content height in the editor has changed.
		 * @event
		 */
		onDidContentSizeChange(listener: (e: IContentSizeChangedEvent) => void): IDisposable;
		/**
		 * An event emitted when the scroll in the editor has changed.
		 * @event
		 */
		onDidScrollChange(listener: (e: IScrollEvent) => void): IDisposable;
		/**
		 * Saves current view state of the editor in a serializable object.
		 */
		saveViewState(): ICodeEditorViewState | null;
		/**
		 * Restores the view state of the editor from a serializable object generated by `saveViewState`.
		 */
		restoreViewState(state: ICodeEditorViewState): void;
		/**
		 * Returns true if the text inside this editor or an editor widget has focus.
		 */
		hasWidgetFocus(): boolean;
		/**
		 * Get a contribution of this editor.
		 * @id Unique identifier of the contribution.
		 * @return The contribution or null if contribution not found.
		 */
		getContribution<T extends IEditorContribution>(id: string): T;
		/**
		 * Type the getModel() of IEditor.
		 */
		getModel(): ITextModel | null;
		/**
		 * Sets the current model attached to this editor.
		 * If the previous model was created by the editor via the value key in the options
		 * literal object, it will be destroyed. Otherwise, if the previous model was set
		 * via setModel, or the model key in the options literal object, the previous model
		 * will not be destroyed.
		 * It is safe to call setModel(null) to simply detach the current model from the editor.
		 */
		setModel(model: ITextModel | null): void;
		/**
		 * Gets all the editor computed options.
		 */
		getOptions(): IComputedEditorOptions;
		/**
		 * Gets a specific editor option.
		 */
		getOption<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;
		/**
		 * Returns the editor's configuration (without any validation or defaults).
		 */
		getRawOptions(): IEditorOptions;
		/**
		 * Get value of the current model attached to this editor.
		 * @see {@link ITextModel.getValue}
		 */
		getValue(options?: {
			preserveBOM: boolean;
			lineEnding: string;
		}): string;
		/**
		 * Set the value of the current model attached to this editor.
		 * @see {@link ITextModel.setValue}
		 */
		setValue(newValue: string): void;
		/**
		 * Get the width of the editor's content.
		 * This is information that is "erased" when computing `scrollWidth = Math.max(contentWidth, width)`
		 */
		getContentWidth(): number;
		/**
		 * Get the scrollWidth of the editor's viewport.
		 */
		getScrollWidth(): number;
		/**
		 * Get the scrollLeft of the editor's viewport.
		 */
		getScrollLeft(): number;
		/**
		 * Get the height of the editor's content.
		 * This is information that is "erased" when computing `scrollHeight = Math.max(contentHeight, height)`
		 */
		getContentHeight(): number;
		/**
		 * Get the scrollHeight of the editor's viewport.
		 */
		getScrollHeight(): number;
		/**
		 * Get the scrollTop of the editor's viewport.
		 */
		getScrollTop(): number;
		/**
		 * Change the scrollLeft of the editor's viewport.
		 */
		setScrollLeft(newScrollLeft: number, scrollType?: ScrollType): void;
		/**
		 * Change the scrollTop of the editor's viewport.
		 */
		setScrollTop(newScrollTop: number, scrollType?: ScrollType): void;
		/**
		 * Change the scroll position of the editor's viewport.
		 */
		setScrollPosition(position: INewScrollPosition, scrollType?: ScrollType): void;
		/**
		 * Get an action that is a contribution to this editor.
		 * @id Unique identifier of the contribution.
		 * @return The action or null if action not found.
		 */
		getAction(id: string): IEditorAction;
		/**
		 * Execute a command on the editor.
		 * The edits will land on the undo-redo stack, but no "undo stop" will be pushed.
		 * @param source The source of the call.
		 * @param command The command to execute
		 */
		executeCommand(source: string | null | undefined, command: ICommand): void;
		/**
		 * Create an "undo stop" in the undo-redo stack.
		 */
		pushUndoStop(): boolean;
		/**
		 * Remove the "undo stop" in the undo-redo stack.
		 */
		popUndoStop(): boolean;
		/**
		 * Execute edits on the editor.
		 * The edits will land on the undo-redo stack, but no "undo stop" will be pushed.
		 * @param source The source of the call.
		 * @param edits The edits to execute.
		 * @param endCursorState Cursor state after the edits were applied.
		 */
		executeEdits(source: string | null | undefined, edits: IIdentifiedSingleEditOperation[], endCursorState?: ICursorStateComputer | Selection[]): boolean;
		/**
		 * Execute multiple (concomitant) commands on the editor.
		 * @param source The source of the call.
		 * @param command The commands to execute
		 */
		executeCommands(source: string | null | undefined, commands: (ICommand | null)[]): void;
		/**
		 * Get all the decorations on a line (filtering out decorations from other editors).
		 */
		getLineDecorations(lineNumber: number): IModelDecoration[] | null;
		/**
		 * All decorations added through this call will get the ownerId of this editor.
		 * @see {@link ITextModel.deltaDecorations}
		 */
		deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];
		/**
		 * Get the layout info for the editor.
		 */
		getLayoutInfo(): EditorLayoutInfo;
		/**
		 * Returns the ranges that are currently visible.
		 * Does not account for horizontal scrolling.
		 */
		getVisibleRanges(): Range[];
		/**
		 * Get the vertical position (top offset) for the line w.r.t. to the first line.
		 */
		getTopForLineNumber(lineNumber: number): number;
		/**
		 * Get the vertical position (top offset) for the position w.r.t. to the first line.
		 */
		getTopForPosition(lineNumber: number, column: number): number;
		/**
		 * Returns the editor's container dom node
		 */
		getContainerDomNode(): HTMLElement;
		/**
		 * Returns the editor's dom node
		 */
		getDomNode(): HTMLElement | null;
		/**
		 * Add a content widget. Widgets must have unique ids, otherwise they will be overwritten.
		 */
		addContentWidget(widget: IContentWidget): void;
		/**
		 * Layout/Reposition a content widget. This is a ping to the editor to call widget.getPosition()
		 * and update appropriately.
		 */
		layoutContentWidget(widget: IContentWidget): void;
		/**
		 * Remove a content widget.
		 */
		removeContentWidget(widget: IContentWidget): void;
		/**
		 * Add an overlay widget. Widgets must have unique ids, otherwise they will be overwritten.
		 */
		addOverlayWidget(widget: IOverlayWidget): void;
		/**
		 * Layout/Reposition an overlay widget. This is a ping to the editor to call widget.getPosition()
		 * and update appropriately.
		 */
		layoutOverlayWidget(widget: IOverlayWidget): void;
		/**
		 * Remove an overlay widget.
		 */
		removeOverlayWidget(widget: IOverlayWidget): void;
		/**
		 * Change the view zones. View zones are lost when a new model is attached to the editor.
		 */
		changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void;
		/**
		 * Get the horizontal position (left offset) for the column w.r.t to the beginning of the line.
		 * This method works only if the line `lineNumber` is currently rendered (in the editor's viewport).
		 * Use this method with caution.
		 */
		getOffsetForColumn(lineNumber: number, column: number): number;
		/**
		 * Force an editor render now.
		 */
		render(forceRedraw?: boolean): void;
		/**
		 * Get the hit test target at coordinates `clientX` and `clientY`.
		 * The coordinates are relative to the top-left of the viewport.
		 *
		 * @returns Hit test target or null if the coordinates fall outside the editor or the editor has no model.
		 */
		getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null;
		/**
		 * Get the visible position for `position`.
		 * The result position takes scrolling into account and is relative to the top left corner of the editor.
		 * Explanation 1: the results of this method will change for the same `position` if the user scrolls the editor.
		 * Explanation 2: the results of this method will not change if the container of the editor gets repositioned.
		 * Warning: the results of this method are inaccurate for positions that are outside the current editor viewport.
		 */
		getScrolledVisiblePosition(position: IPosition): {
			top: number;
			left: number;
			height: number;
		} | null;
		/**
		 * Apply the same font settings as the editor to `target`.
		 */
		applyFontInfo(target: HTMLElement): void;
	}

	/**
	 * Information about a line in the diff editor
	 */
	export interface IDiffLineInformation {
		readonly equivalentLineNumber: number;
	}

	/**
	 * A rich diff editor.
	 */
	export interface IDiffEditor extends IEditor {
		/**
		 * @see {@link ICodeEditor.getDomNode}
		 */
		getDomNode(): HTMLElement;
		/**
		 * An event emitted when the diff information computed by this diff editor has been updated.
		 * @event
		 */
		onDidUpdateDiff(listener: () => void): IDisposable;
		/**
		 * Saves current view state of the editor in a serializable object.
		 */
		saveViewState(): IDiffEditorViewState | null;
		/**
		 * Restores the view state of the editor from a serializable object generated by `saveViewState`.
		 */
		restoreViewState(state: IDiffEditorViewState): void;
		/**
		 * Type the getModel() of IEditor.
		 */
		getModel(): IDiffEditorModel | null;
		/**
		 * Sets the current model attached to this editor.
		 * If the previous model was created by the editor via the value key in the options
		 * literal object, it will be destroyed. Otherwise, if the previous model was set
		 * via setModel, or the model key in the options literal object, the previous model
		 * will not be destroyed.
		 * It is safe to call setModel(null) to simply detach the current model from the editor.
		 */
		setModel(model: IDiffEditorModel | null): void;
		/**
		 * Get the `original` editor.
		 */
		getOriginalEditor(): ICodeEditor;
		/**
		 * Get the `modified` editor.
		 */
		getModifiedEditor(): ICodeEditor;
		/**
		 * Get the computed diff information.
		 */
		getLineChanges(): ILineChange[] | null;
		/**
		 * Get information based on computed diff about a line number from the original model.
		 * If the diff computation is not finished or the model is missing, will return null.
		 */
		getDiffLineInformationForOriginal(lineNumber: number): IDiffLineInformation | null;
		/**
		 * Get information based on computed diff about a line number from the modified model.
		 * If the diff computation is not finished or the model is missing, will return null.
		 */
		getDiffLineInformationForModified(lineNumber: number): IDiffLineInformation | null;
		/**
		 * Update the editor's options after the editor has been created.
		 */
		updateOptions(newOptions: IDiffEditorOptions): void;
	}

	export class FontInfo extends BareFontInfo {
		readonly _editorStylingBrand: void;
		readonly version: number;
		readonly isTrusted: boolean;
		readonly isMonospace: boolean;
		readonly typicalHalfwidthCharacterWidth: number;
		readonly typicalFullwidthCharacterWidth: number;
		readonly canUseHalfwidthRightwardsArrow: boolean;
		readonly spaceWidth: number;
		readonly middotWidth: number;
		readonly wsmiddotWidth: number;
		readonly maxDigitWidth: number;
	}

	export class BareFontInfo {
		readonly _bareFontInfoBrand: void;
		readonly zoomLevel: number;
		readonly pixelRatio: number;
		readonly fontFamily: string;
		readonly fontWeight: string;
		readonly fontSize: number;
		readonly fontFeatureSettings: string;
		readonly lineHeight: number;
		readonly letterSpacing: number;
	}

	//compatibility:
	export type IReadOnlyModel = ITextModel;
	export type IModel = ITextModel;
}

declare namespace monaco.languages {


	/**
	 * Register information about a new language.
	 */
	export function register(language: ILanguageExtensionPoint): void;

	/**
	 * Get the information of all the registered languages.
	 */
	export function getLanguages(): ILanguageExtensionPoint[];

	export function getEncodedLanguageId(languageId: string): number;

	/**
	 * An event emitted when a language is first time needed (e.g. a model has it set).
	 * @event
	 */
	export function onLanguage(languageId: string, callback: () => void): IDisposable;

	/**
	 * Set the editing configuration for a language.
	 */
	export function setLanguageConfiguration(languageId: string, configuration: LanguageConfiguration): IDisposable;

	/**
	 * A token.
	 */
	export interface IToken {
		startIndex: number;
		scopes: string;
	}

	/**
	 * The result of a line tokenization.
	 */
	export interface ILineTokens {
		/**
		 * The list of tokens on the line.
		 */
		tokens: IToken[];
		/**
		 * The tokenization end state.
		 * A pointer will be held to this and the object should not be modified by the tokenizer after the pointer is returned.
		 */
		endState: IState;
	}

	/**
	 * The result of a line tokenization.
	 */
	export interface IEncodedLineTokens {
		/**
		 * The tokens on the line in a binary, encoded format. Each token occupies two array indices. For token i:
		 *  - at offset 2*i => startIndex
		 *  - at offset 2*i + 1 => metadata
		 * Meta data is in binary format:
		 * - -------------------------------------------
		 *     3322 2222 2222 1111 1111 1100 0000 0000
		 *     1098 7654 3210 9876 5432 1098 7654 3210
		 * - -------------------------------------------
		 *     bbbb bbbb bfff ffff ffFF FTTT LLLL LLLL
		 * - -------------------------------------------
		 *  - L = EncodedLanguageId (8 bits): Use `getEncodedLanguageId` to get the encoded ID of a language.
		 *  - T = StandardTokenType (3 bits): Other = 0, Comment = 1, String = 2, RegEx = 4.
		 *  - F = FontStyle (3 bits): None = 0, Italic = 1, Bold = 2, Underline = 4.
		 *  - f = foreground ColorId (9 bits)
		 *  - b = background ColorId (9 bits)
		 *  - The color value for each colorId is defined in IStandaloneThemeData.customTokenColors:
		 * e.g. colorId = 1 is stored in IStandaloneThemeData.customTokenColors[1]. Color id = 0 means no color,
		 * id = 1 is for the default foreground color, id = 2 for the default background.
		 */
		tokens: Uint32Array;
		/**
		 * The tokenization end state.
		 * A pointer will be held to this and the object should not be modified by the tokenizer after the pointer is returned.
		 */
		endState: IState;
	}

	/**
	 * A "manual" provider of tokens.
	 */
	export interface TokensProvider {
		/**
		 * The initial state of a language. Will be the state passed in to tokenize the first line.
		 */
		getInitialState(): IState;
		/**
		 * Tokenize a line given the state at the beginning of the line.
		 */
		tokenize(line: string, state: IState): ILineTokens;
	}

	/**
	 * A "manual" provider of tokens, returning tokens in a binary form.
	 */
	export interface EncodedTokensProvider {
		/**
		 * The initial state of a language. Will be the state passed in to tokenize the first line.
		 */
		getInitialState(): IState;
		/**
		 * Tokenize a line given the state at the beginning of the line.
		 */
		tokenizeEncoded(line: string, state: IState): IEncodedLineTokens;
		/**
		 * Tokenize a line given the state at the beginning of the line.
		 */
		tokenize?(line: string, state: IState): ILineTokens;
	}

	/**
	 * Change the color map that is used for token colors.
	 * Supported formats (hex): #RRGGBB, $RRGGBBAA, #RGB, #RGBA
	 */
	export function setColorMap(colorMap: string[] | null): void;

	/**
	 * Set the tokens provider for a language (manual implementation).
	 */
	export function setTokensProvider(languageId: string, provider: TokensProvider | EncodedTokensProvider | Thenable<TokensProvider | EncodedTokensProvider>): IDisposable;

	/**
	 * Set the tokens provider for a language (monarch implementation).
	 */
	export function setMonarchTokensProvider(languageId: string, languageDef: IMonarchLanguage | Thenable<IMonarchLanguage>): IDisposable;

	/**
	 * Register a reference provider (used by e.g. reference search).
	 */
	export function registerReferenceProvider(languageId: string, provider: ReferenceProvider): IDisposable;

	/**
	 * Register a rename provider (used by e.g. rename symbol).
	 */
	export function registerRenameProvider(languageId: string, provider: RenameProvider): IDisposable;

	/**
	 * Register a signature help provider (used by e.g. parameter hints).
	 */
	export function registerSignatureHelpProvider(languageId: string, provider: SignatureHelpProvider): IDisposable;

	/**
	 * Register a hover provider (used by e.g. editor hover).
	 */
	export function registerHoverProvider(languageId: string, provider: HoverProvider): IDisposable;

	/**
	 * Register a document symbol provider (used by e.g. outline).
	 */
	export function registerDocumentSymbolProvider(languageId: string, provider: DocumentSymbolProvider): IDisposable;

	/**
	 * Register a document highlight provider (used by e.g. highlight occurrences).
	 */
	export function registerDocumentHighlightProvider(languageId: string, provider: DocumentHighlightProvider): IDisposable;

	/**
	 * Register an linked editing range provider.
	 */
	export function registerLinkedEditingRangeProvider(languageId: string, provider: LinkedEditingRangeProvider): IDisposable;

	/**
	 * Register a definition provider (used by e.g. go to definition).
	 */
	export function registerDefinitionProvider(languageId: string, provider: DefinitionProvider): IDisposable;

	/**
	 * Register a implementation provider (used by e.g. go to implementation).
	 */
	export function registerImplementationProvider(languageId: string, provider: ImplementationProvider): IDisposable;

	/**
	 * Register a type definition provider (used by e.g. go to type definition).
	 */
	export function registerTypeDefinitionProvider(languageId: string, provider: TypeDefinitionProvider): IDisposable;

	/**
	 * Register a code lens provider (used by e.g. inline code lenses).
	 */
	export function registerCodeLensProvider(languageId: string, provider: CodeLensProvider): IDisposable;

	/**
	 * Register a code action provider (used by e.g. quick fix).
	 */
	export function registerCodeActionProvider(languageId: string, provider: CodeActionProvider): IDisposable;

	/**
	 * Register a formatter that can handle only entire models.
	 */
	export function registerDocumentFormattingEditProvider(languageId: string, provider: DocumentFormattingEditProvider): IDisposable;

	/**
	 * Register a formatter that can handle a range inside a model.
	 */
	export function registerDocumentRangeFormattingEditProvider(languageId: string, provider: DocumentRangeFormattingEditProvider): IDisposable;

	/**
	 * Register a formatter than can do formatting as the user types.
	 */
	export function registerOnTypeFormattingEditProvider(languageId: string, provider: OnTypeFormattingEditProvider): IDisposable;

	/**
	 * Register a link provider that can find links in text.
	 */
	export function registerLinkProvider(languageId: string, provider: LinkProvider): IDisposable;

	/**
	 * Register a completion item provider (use by e.g. suggestions).
	 */
	export function registerCompletionItemProvider(languageId: string, provider: CompletionItemProvider): IDisposable;

	/**
	 * Register a document color provider (used by Color Picker, Color Decorator).
	 */
	export function registerColorProvider(languageId: string, provider: DocumentColorProvider): IDisposable;

	/**
	 * Register a folding range provider
	 */
	export function registerFoldingRangeProvider(languageId: string, provider: FoldingRangeProvider): IDisposable;

	/**
	 * Register a declaration provider
	 */
	export function registerDeclarationProvider(languageId: string, provider: DeclarationProvider): IDisposable;

	/**
	 * Register a selection range provider
	 */
	export function registerSelectionRangeProvider(languageId: string, provider: SelectionRangeProvider): IDisposable;

	/**
	 * Register a document semantic tokens provider
	 */
	export function registerDocumentSemanticTokensProvider(languageId: string, provider: DocumentSemanticTokensProvider): IDisposable;

	/**
	 * Register a document range semantic tokens provider
	 */
	export function registerDocumentRangeSemanticTokensProvider(languageId: string, provider: DocumentRangeSemanticTokensProvider): IDisposable;

	/**
	 * Register an inline completions provider.
	 */
	export function registerInlineCompletionsProvider(languageId: string, provider: InlineCompletionsProvider): IDisposable;

	/**
	 * Register an inlay hints provider.
	 */
	export function registerInlayHintsProvider(languageId: string, provider: InlayHintsProvider): IDisposable;

	/**
	 * Contains additional diagnostic information about the context in which
	 * a [code action](#CodeActionProvider.provideCodeActions) is run.
	 */
	export interface CodeActionContext {
		/**
		 * An array of diagnostics.
		 */
		readonly markers: editor.IMarkerData[];
		/**
		 * Requested kind of actions to return.
		 */
		readonly only?: string;
	}

	/**
	 * The code action interface defines the contract between extensions and
	 * the [light bulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action) feature.
	 */
	export interface CodeActionProvider {
		/**
		 * Provide commands for the given document and range.
		 */
		provideCodeActions(model: editor.ITextModel, range: Range, context: CodeActionContext, token: CancellationToken): ProviderResult<CodeActionList>;
	}

	/**
	 * Describes how comments for a language work.
	 */
	export interface CommentRule {
		/**
		 * The line comment token, like `// this is a comment`
		 */
		lineComment?: string | null;
		/**
		 * The block comment character pair, like `/* block comment *&#47;`
		 */
		blockComment?: CharacterPair | null;
	}

	/**
	 * The language configuration interface defines the contract between extensions and
	 * various editor features, like automatic bracket insertion, automatic indentation etc.
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
		 * The language's auto closing pairs. The 'close' character is automatically inserted with the
		 * 'open' character is typed. If not set, the configured brackets will be used.
		 */
		autoClosingPairs?: IAutoClosingPairConditional[];
		/**
		 * The language's surrounding pairs. When the 'open' character is typed on a selection, the
		 * selected string is surrounded by the open and close characters. If not set, the autoclosing pairs
		 * settings will be used.
		 */
		surroundingPairs?: IAutoClosingPair[];
		/**
		 * Defines what characters must be after the cursor for bracket or quote autoclosing to occur when using the \'languageDefined\' autoclosing setting.
		 *
		 * This is typically the set of characters which can not start an expression, such as whitespace, closing brackets, non-unary operators, etc.
		 */
		autoCloseBefore?: string;
		/**
		 * The language's folding rules.
		 */
		folding?: FoldingRules;
		/**
		 * **Deprecated** Do not use.
		 *
		 * @deprecated Will be replaced by a better API soon.
		 */
		__electricCharacterSupport?: {
			docComment?: IDocComment;
		};
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
		indentNextLinePattern?: RegExp | null;
		/**
		 * If a line matches this pattern, then its indentation should not be changed and it should not be evaluated against the other rules.
		 */
		unIndentedLinePattern?: RegExp | null;
	}

	/**
	 * Describes language specific folding markers such as '#region' and '#endregion'.
	 * The start and end regexes will be tested against the contents of all lines and must be designed efficiently:
	 * - the regex should start with '^'
	 * - regexp flags (i, g) are ignored
	 */
	export interface FoldingMarkers {
		start: RegExp;
		end: RegExp;
	}

	/**
	 * Describes folding rules for a language.
	 */
	export interface FoldingRules {
		/**
		 * Used by the indentation based strategy to decide whether empty lines belong to the previous or the next block.
		 * A language adheres to the off-side rule if blocks in that language are expressed by their indentation.
		 * See [wikipedia](https://en.wikipedia.org/wiki/Off-side_rule) for more information.
		 * If not set, `false` is used and empty lines belong to the previous block.
		 */
		offSide?: boolean;
		/**
		 * Region markers used by the language.
		 */
		markers?: FoldingMarkers;
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
		 * This rule will only execute if the text above the this line matches this regular expression.
		 */
		previousLineText?: RegExp;
		/**
		 * The action to execute.
		 */
		action: EnterAction;
	}

	/**
	 * Definition of documentation comments (e.g. Javadoc/JSdoc)
	 */
	export interface IDocComment {
		/**
		 * The string that starts a doc comment (e.g. '/**')
		 */
		open: string;
		/**
		 * The string that appears on the last line and closes the doc comment (e.g. ' * /').
		 */
		close?: string;
	}

	/**
	 * A tuple of two characters, like a pair of
	 * opening and closing brackets.
	 */
	export type CharacterPair = [string, string];

	export interface IAutoClosingPair {
		open: string;
		close: string;
	}

	export interface IAutoClosingPairConditional extends IAutoClosingPair {
		notIn?: string[];
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
	 * The state of the tokenizer between two lines.
	 * It is useful to store flags such as in multiline comment, etc.
	 * The model will clone the previous line's state and pass it in to tokenize the next line.
	 */
	export interface IState {
		clone(): IState;
		equals(other: IState): boolean;
	}

	/**
	 * A provider result represents the values a provider, like the {@link HoverProvider},
	 * may return. For once this is the actual result type `T`, like `Hover`, or a thenable that resolves
	 * to that type `T`. In addition, `null` and `undefined` can be returned - either directly or from a
	 * thenable.
	 */
	export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

	/**
	 * A hover represents additional information for a symbol or word. Hovers are
	 * rendered in a tooltip-like widget.
	 */
	export interface Hover {
		/**
		 * The contents of this hover.
		 */
		contents: IMarkdownString[];
		/**
		 * The range to which this hover applies. When missing, the
		 * editor will use the range at the current position or the
		 * current position itself.
		 */
		range?: IRange;
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
		 */
		provideHover(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Hover>;
	}

	export enum CompletionItemKind {
		Method = 0,
		Function = 1,
		Constructor = 2,
		Field = 3,
		Variable = 4,
		Class = 5,
		Struct = 6,
		Interface = 7,
		Module = 8,
		Property = 9,
		Event = 10,
		Operator = 11,
		Unit = 12,
		Value = 13,
		Constant = 14,
		Enum = 15,
		EnumMember = 16,
		Keyword = 17,
		Text = 18,
		Color = 19,
		File = 20,
		Reference = 21,
		Customcolor = 22,
		Folder = 23,
		TypeParameter = 24,
		User = 25,
		Issue = 26,
		Snippet = 27
	}

	export interface CompletionItemLabel {
		label: string;
		detail?: string;
		description?: string;
	}

	export enum CompletionItemTag {
		Deprecated = 1
	}

	export enum CompletionItemInsertTextRule {
		/**
		 * Adjust whitespace/indentation of multiline insert texts to
		 * match the current line indentation.
		 */
		KeepWhitespace = 1,
		/**
		 * `insertText` is a snippet.
		 */
		InsertAsSnippet = 4
	}

	/**
	 * A completion item represents a text snippet that is
	 * proposed to complete text that is being typed.
	 */
	export interface CompletionItem {
		/**
		 * The label of this completion item. By default
		 * this is also the text that is inserted when selecting
		 * this completion.
		 */
		label: string | CompletionItemLabel;
		/**
		 * The kind of this completion item. Based on the kind
		 * an icon is chosen by the editor.
		 */
		kind: CompletionItemKind;
		/**
		 * A modifier to the `kind` which affect how the item
		 * is rendered, e.g. Deprecated is rendered with a strikeout
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
		documentation?: string | IMarkdownString;
		/**
		 * A string that should be used when comparing this item
		 * with other items. When `falsy` the {@link CompletionItem.label label}
		 * is used.
		 */
		sortText?: string;
		/**
		 * A string that should be used when filtering a set of
		 * completion items. When `falsy` the {@link CompletionItem.label label}
		 * is used.
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
		 * this completion.
		 * is used.
		 */
		insertText: string;
		/**
		 * Addition rules (as bitmask) that should be applied when inserting
		 * this completion.
		 */
		insertTextRules?: CompletionItemInsertTextRule;
		/**
		 * A range of text that should be replaced by this completion item.
		 *
		 * Defaults to a range from the start of the {@link TextDocument.getWordRangeAtPosition current word} to the
		 * current position.
		 *
		 * *Note:* The range must be a {@link Range.isSingleLine single line} and it must
		 * {@link Range.contains contain} the position at which completion has been {@link CompletionItemProvider.provideCompletionItems requested}.
		 */
		range: IRange | {
			insert: IRange;
			replace: IRange;
		};
		/**
		 * An optional set of characters that when pressed while this completion is active will accept it first and
		 * then type that character. *Note* that all commit characters should have `length=1` and that superfluous
		 * characters will be ignored.
		 */
		commitCharacters?: string[];
		/**
		 * An optional array of additional text edits that are applied when
		 * selecting this completion. Edits must not overlap with the main edit
		 * nor with themselves.
		 */
		additionalTextEdits?: editor.ISingleEditOperation[];
		/**
		 * A command that should be run upon acceptance of this item.
		 */
		command?: Command;
	}

	export interface CompletionList {
		suggestions: CompletionItem[];
		incomplete?: boolean;
		dispose?(): void;
	}

	/**
	 * How a suggest provider was triggered.
	 */
	export enum CompletionTriggerKind {
		Invoke = 0,
		TriggerCharacter = 1,
		TriggerForIncompleteCompletions = 2
	}

	/**
	 * Contains additional information about the context in which
	 * {@link CompletionItemProvider.provideCompletionItems completion provider} is triggered.
	 */
	export interface CompletionContext {
		/**
		 * How the completion was triggered.
		 */
		triggerKind: CompletionTriggerKind;
		/**
		 * Character that triggered the completion item provider.
		 *
		 * `undefined` if provider was not triggered by a character.
		 */
		triggerCharacter?: string;
	}

	/**
	 * The completion item provider interface defines the contract between extensions and
	 * the [IntelliSense](https://code.visualstudio.com/docs/editor/intellisense).
	 *
	 * When computing *complete* completion items is expensive, providers can optionally implement
	 * the `resolveCompletionItem`-function. In that case it is enough to return completion
	 * items with a {@link CompletionItem.label label} from the
	 * {@link CompletionItemProvider.provideCompletionItems provideCompletionItems}-function. Subsequently,
	 * when a completion item is shown in the UI and gains focus this provider is asked to resolve
	 * the item, like adding {@link CompletionItem.documentation doc-comment} or {@link CompletionItem.detail details}.
	 */
	export interface CompletionItemProvider {
		triggerCharacters?: string[];
		/**
		 * Provide completion items for the given position and document.
		 */
		provideCompletionItems(model: editor.ITextModel, position: Position, context: CompletionContext, token: CancellationToken): ProviderResult<CompletionList>;
		/**
		 * Given a completion item fill in more data, like {@link CompletionItem.documentation doc-comment}
		 * or {@link CompletionItem.detail details}.
		 *
		 * The editor will only resolve a completion item once.
		 */
		resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>;
	}

	/**
	 * How an {@link InlineCompletionsProvider inline completion provider} was triggered.
	 */
	export enum InlineCompletionTriggerKind {
		/**
		 * Completion was triggered automatically while editing.
		 * It is sufficient to return a single completion item in this case.
		 */
		Automatic = 0,
		/**
		 * Completion was triggered explicitly by a user gesture.
		 * Return multiple completion items to enable cycling through them.
		 */
		Explicit = 1
	}

	export interface InlineCompletionContext {
		/**
		 * How the completion was triggered.
		 */
		readonly triggerKind: InlineCompletionTriggerKind;
	}

	export interface InlineCompletion {
		/**
		 * The text to insert.
		 * If the text contains a line break, the range must end at the end of a line.
		 * If existing text should be replaced, the existing text must be a prefix of the text to insert.
		*/
		readonly text: string;
		/**
		 * The range to replace.
		 * Must begin and end on the same line.
		*/
		readonly range?: IRange;
		readonly command?: Command;
	}

	export interface InlineCompletions<TItem extends InlineCompletion = InlineCompletion> {
		readonly items: readonly TItem[];
	}

	export interface InlineCompletionsProvider<T extends InlineCompletions = InlineCompletions> {
		provideInlineCompletions(model: editor.ITextModel, position: Position, context: InlineCompletionContext, token: CancellationToken): ProviderResult<T>;
		/**
		 * Will be called when an item is shown.
		*/
		handleItemDidShow?(completions: T, item: T['items'][number]): void;
		/**
		 * Will be called when a completions list is no longer in use and can be garbage-collected.
		*/
		freeInlineCompletions(completions: T): void;
	}

	export interface CodeAction {
		title: string;
		command?: Command;
		edit?: WorkspaceEdit;
		diagnostics?: editor.IMarkerData[];
		kind?: string;
		isPreferred?: boolean;
		disabled?: string;
	}

	export interface CodeActionList extends IDisposable {
		readonly actions: ReadonlyArray<CodeAction>;
	}

	/**
	 * Represents a parameter of a callable-signature. A parameter can
	 * have a label and a doc-comment.
	 */
	export interface ParameterInformation {
		/**
		 * The label of this signature. Will be shown in
		 * the UI.
		 */
		label: string | [number, number];
		/**
		 * The human-readable doc-comment of this signature. Will be shown
		 * in the UI but can be omitted.
		 */
		documentation?: string | IMarkdownString;
	}

	/**
	 * Represents the signature of something callable. A signature
	 * can have a label, like a function-name, a doc-comment, and
	 * a set of parameters.
	 */
	export interface SignatureInformation {
		/**
		 * The label of this signature. Will be shown in
		 * the UI.
		 */
		label: string;
		/**
		 * The human-readable doc-comment of this signature. Will be shown
		 * in the UI but can be omitted.
		 */
		documentation?: string | IMarkdownString;
		/**
		 * The parameters of this signature.
		 */
		parameters: ParameterInformation[];
		/**
		 * Index of the active parameter.
		 *
		 * If provided, this is used in place of `SignatureHelp.activeSignature`.
		 */
		activeParameter?: number;
	}

	/**
	 * Signature help represents the signature of something
	 * callable. There can be multiple signatures but only one
	 * active and only one active parameter.
	 */
	export interface SignatureHelp {
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

	export interface SignatureHelpResult extends IDisposable {
		value: SignatureHelp;
	}

	export enum SignatureHelpTriggerKind {
		Invoke = 1,
		TriggerCharacter = 2,
		ContentChange = 3
	}

	export interface SignatureHelpContext {
		readonly triggerKind: SignatureHelpTriggerKind;
		readonly triggerCharacter?: string;
		readonly isRetrigger: boolean;
		readonly activeSignatureHelp?: SignatureHelp;
	}

	/**
	 * The signature help provider interface defines the contract between extensions and
	 * the [parameter hints](https://code.visualstudio.com/docs/editor/intellisense)-feature.
	 */
	export interface SignatureHelpProvider {
		readonly signatureHelpTriggerCharacters?: ReadonlyArray<string>;
		readonly signatureHelpRetriggerCharacters?: ReadonlyArray<string>;
		/**
		 * Provide help for the signature at the given position and document.
		 */
		provideSignatureHelp(model: editor.ITextModel, position: Position, token: CancellationToken, context: SignatureHelpContext): ProviderResult<SignatureHelpResult>;
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
	export interface DocumentHighlight {
		/**
		 * The range this highlight applies to.
		 */
		range: IRange;
		/**
		 * The highlight kind, default is {@link DocumentHighlightKind.Text text}.
		 */
		kind?: DocumentHighlightKind;
	}

	/**
	 * The document highlight provider interface defines the contract between extensions and
	 * the word-highlight-feature.
	 */
	export interface DocumentHighlightProvider {
		/**
		 * Provide a set of document highlights, like all occurrences of a variable or
		 * all exit-points of a function.
		 */
		provideDocumentHighlights(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>;
	}

	/**
	 * The linked editing range provider interface defines the contract between extensions and
	 * the linked editing feature.
	 */
	export interface LinkedEditingRangeProvider {
		/**
		 * Provide a list of ranges that can be edited together.
		 */
		provideLinkedEditingRanges(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<LinkedEditingRanges>;
	}

	/**
	 * Represents a list of ranges that can be edited together along with a word pattern to describe valid contents.
	 */
	export interface LinkedEditingRanges {
		/**
		 * A list of ranges that can be edited together. The ranges must have
		 * identical length and text content. The ranges cannot overlap
		 */
		ranges: IRange[];
		/**
		 * An optional word pattern that describes valid contents for the given ranges.
		 * If no pattern is provided, the language configuration's word pattern will be used.
		 */
		wordPattern?: RegExp;
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
		 */
		provideReferences(model: editor.ITextModel, position: Position, context: ReferenceContext, token: CancellationToken): ProviderResult<Location[]>;
	}

	/**
	 * Represents a location inside a resource, such as a line
	 * inside a text file.
	 */
	export interface Location {
		/**
		 * The resource identifier of this location.
		 */
		uri: Uri;
		/**
		 * The document range of this locations.
		 */
		range: IRange;
	}

	export interface LocationLink {
		/**
		 * A range to select where this link originates from.
		 */
		originSelectionRange?: IRange;
		/**
		 * The target uri this link points to.
		 */
		uri: Uri;
		/**
		 * The full range this link points to.
		 */
		range: IRange;
		/**
		 * A range to select this link points to. Must be contained
		 * in `LocationLink.range`.
		 */
		targetSelectionRange?: IRange;
	}

	export type Definition = Location | Location[] | LocationLink[];

	/**
	 * The definition provider interface defines the contract between extensions and
	 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
	 * and peek definition features.
	 */
	export interface DefinitionProvider {
		/**
		 * Provide the definition of the symbol at the given position and document.
		 */
		provideDefinition(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	/**
	 * The definition provider interface defines the contract between extensions and
	 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
	 * and peek definition features.
	 */
	export interface DeclarationProvider {
		/**
		 * Provide the declaration of the symbol at the given position and document.
		 */
		provideDeclaration(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	/**
	 * The implementation provider interface defines the contract between extensions and
	 * the go to implementation feature.
	 */
	export interface ImplementationProvider {
		/**
		 * Provide the implementation of the symbol at the given position and document.
		 */
		provideImplementation(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
	}

	/**
	 * The type definition provider interface defines the contract between extensions and
	 * the go to type definition feature.
	 */
	export interface TypeDefinitionProvider {
		/**
		 * Provide the type definition of the symbol at the given position and document.
		 */
		provideTypeDefinition(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
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

	export enum SymbolTag {
		Deprecated = 1
	}

	export interface DocumentSymbol {
		name: string;
		detail: string;
		kind: SymbolKind;
		tags: ReadonlyArray<SymbolTag>;
		containerName?: string;
		range: IRange;
		selectionRange: IRange;
		children?: DocumentSymbol[];
	}

	/**
	 * The document symbol provider interface defines the contract between extensions and
	 * the [go to symbol](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-symbol)-feature.
	 */
	export interface DocumentSymbolProvider {
		displayName?: string;
		/**
		 * Provide symbol information for the given document.
		 */
		provideDocumentSymbols(model: editor.ITextModel, token: CancellationToken): ProviderResult<DocumentSymbol[]>;
	}

	export type TextEdit = {
		range: IRange;
		text: string;
		eol?: editor.EndOfLineSequence;
	};

	/**
	 * Interface used to format a model
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
	}

	/**
	 * The document formatting provider interface defines the contract between extensions and
	 * the formatting-feature.
	 */
	export interface DocumentFormattingEditProvider {
		readonly displayName?: string;
		/**
		 * Provide formatting edits for a whole document.
		 */
		provideDocumentFormattingEdits(model: editor.ITextModel, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	/**
	 * The document formatting provider interface defines the contract between extensions and
	 * the formatting-feature.
	 */
	export interface DocumentRangeFormattingEditProvider {
		readonly displayName?: string;
		/**
		 * Provide formatting edits for a range in a document.
		 *
		 * The given range is a hint and providers can decide to format a smaller
		 * or larger range. Often this is done by adjusting the start and end
		 * of the range to full syntax nodes.
		 */
		provideDocumentRangeFormattingEdits(model: editor.ITextModel, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	/**
	 * The document formatting provider interface defines the contract between extensions and
	 * the formatting-feature.
	 */
	export interface OnTypeFormattingEditProvider {
		autoFormatTriggerCharacters: string[];
		/**
		 * Provide formatting edits after a character has been typed.
		 *
		 * The given position and character should hint to the provider
		 * what range the position to expand to, like find the matching `{`
		 * when `}` has been entered.
		 */
		provideOnTypeFormattingEdits(model: editor.ITextModel, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
	}

	/**
	 * A link inside the editor.
	 */
	export interface ILink {
		range: IRange;
		url?: Uri | string;
		tooltip?: string;
	}

	export interface ILinksList {
		links: ILink[];
		dispose?(): void;
	}

	/**
	 * A provider of links.
	 */
	export interface LinkProvider {
		provideLinks(model: editor.ITextModel, token: CancellationToken): ProviderResult<ILinksList>;
		resolveLink?: (link: ILink, token: CancellationToken) => ProviderResult<ILink>;
	}

	/**
	 * A color in RGBA format.
	 */
	export interface IColor {
		/**
		 * The red component in the range [0-1].
		 */
		readonly red: number;
		/**
		 * The green component in the range [0-1].
		 */
		readonly green: number;
		/**
		 * The blue component in the range [0-1].
		 */
		readonly blue: number;
		/**
		 * The alpha component in the range [0-1].
		 */
		readonly alpha: number;
	}

	/**
	 * String representations for a color
	 */
	export interface IColorPresentation {
		/**
		 * The label of this color presentation. It will be shown on the color
		 * picker header. By default this is also the text that is inserted when selecting
		 * this color presentation.
		 */
		label: string;
		/**
		 * An {@link TextEdit edit} which is applied to a document when selecting
		 * this presentation for the color.
		 */
		textEdit?: TextEdit;
		/**
		 * An optional array of additional {@link TextEdit text edits} that are applied when
		 * selecting this color presentation.
		 */
		additionalTextEdits?: TextEdit[];
	}

	/**
	 * A color range is a range in a text model which represents a color.
	 */
	export interface IColorInformation {
		/**
		 * The range within the model.
		 */
		range: IRange;
		/**
		 * The color represented in this range.
		 */
		color: IColor;
	}

	/**
	 * A provider of colors for editor models.
	 */
	export interface DocumentColorProvider {
		/**
		 * Provides the color ranges for a specific model.
		 */
		provideDocumentColors(model: editor.ITextModel, token: CancellationToken): ProviderResult<IColorInformation[]>;
		/**
		 * Provide the string representations for a color.
		 */
		provideColorPresentations(model: editor.ITextModel, colorInfo: IColorInformation, token: CancellationToken): ProviderResult<IColorPresentation[]>;
	}

	export interface SelectionRange {
		range: IRange;
	}

	export interface SelectionRangeProvider {
		/**
		 * Provide ranges that should be selected from the given position.
		 */
		provideSelectionRanges(model: editor.ITextModel, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[][]>;
	}

	export interface FoldingContext {
	}

	/**
	 * A provider of folding ranges for editor models.
	 */
	export interface FoldingRangeProvider {
		/**
		 * An optional event to signal that the folding ranges from this provider have changed.
		 */
		onDidChange?: IEvent<this>;
		/**
		 * Provides the folding ranges for a specific model.
		 */
		provideFoldingRanges(model: editor.ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]>;
	}

	export interface FoldingRange {
		/**
		 * The one-based start line of the range to fold. The folded area starts after the line's last character.
		 */
		start: number;
		/**
		 * The one-based end line of the range to fold. The folded area ends with the line's last character.
		 */
		end: number;
		/**
		 * Describes the {@link FoldingRangeKind Kind} of the folding range such as {@link FoldingRangeKind.Comment Comment} or
		 * {@link FoldingRangeKind.Region Region}. The kind is used to categorize folding ranges and used by commands
		 * like 'Fold all comments'. See
		 * {@link FoldingRangeKind} for an enumeration of standardized kinds.
		 */
		kind?: FoldingRangeKind;
	}

	export class FoldingRangeKind {
		value: string;
		/**
		 * Kind for folding range representing a comment. The value of the kind is 'comment'.
		 */
		static readonly Comment: FoldingRangeKind;
		/**
		 * Kind for folding range representing a import. The value of the kind is 'imports'.
		 */
		static readonly Imports: FoldingRangeKind;
		/**
		 * Kind for folding range representing regions (for example marked by `#region`, `#endregion`).
		 * The value of the kind is 'region'.
		 */
		static readonly Region: FoldingRangeKind;
		/**
		 * Creates a new {@link FoldingRangeKind}.
		 *
		 * @param value of the kind.
		 */
		constructor(value: string);
	}

	export interface WorkspaceEditMetadata {
		needsConfirmation: boolean;
		label: string;
		description?: string;
	}

	export interface WorkspaceFileEditOptions {
		overwrite?: boolean;
		ignoreIfNotExists?: boolean;
		ignoreIfExists?: boolean;
		recursive?: boolean;
		copy?: boolean;
		folder?: boolean;
		skipTrashBin?: boolean;
		maxSize?: number;
	}

	export interface WorkspaceFileEdit {
		oldUri?: Uri;
		newUri?: Uri;
		options?: WorkspaceFileEditOptions;
		metadata?: WorkspaceEditMetadata;
	}

	export interface WorkspaceTextEdit {
		resource: Uri;
		edit: TextEdit;
		modelVersionId?: number;
		metadata?: WorkspaceEditMetadata;
	}

	export interface WorkspaceEdit {
		edits: Array<WorkspaceTextEdit | WorkspaceFileEdit>;
	}

	export interface Rejection {
		rejectReason?: string;
	}

	export interface RenameLocation {
		range: IRange;
		text: string;
	}

	export interface RenameProvider {
		provideRenameEdits(model: editor.ITextModel, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit & Rejection>;
		resolveRenameLocation?(model: editor.ITextModel, position: Position, token: CancellationToken): ProviderResult<RenameLocation & Rejection>;
	}

	export interface Command {
		id: string;
		title: string;
		tooltip?: string;
		arguments?: any[];
	}

	export interface CodeLens {
		range: IRange;
		id?: string;
		command?: Command;
	}

	export interface CodeLensList {
		lenses: CodeLens[];
		dispose(): void;
	}

	export interface CodeLensProvider {
		onDidChange?: IEvent<this>;
		provideCodeLenses(model: editor.ITextModel, token: CancellationToken): ProviderResult<CodeLensList>;
		resolveCodeLens?(model: editor.ITextModel, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>;
	}

	export enum InlayHintKind {
		Other = 0,
		Type = 1,
		Parameter = 2
	}

	export interface InlayHint {
		text: string;
		position: IPosition;
		kind: InlayHintKind;
		whitespaceBefore?: boolean;
		whitespaceAfter?: boolean;
	}

	export interface InlayHintsProvider {
		onDidChangeInlayHints?: IEvent<void> | undefined;
		provideInlayHints(model: editor.ITextModel, range: Range, token: CancellationToken): ProviderResult<InlayHint[]>;
	}

	export interface SemanticTokensLegend {
		readonly tokenTypes: string[];
		readonly tokenModifiers: string[];
	}

	export interface SemanticTokens {
		readonly resultId?: string;
		readonly data: Uint32Array;
	}

	export interface SemanticTokensEdit {
		readonly start: number;
		readonly deleteCount: number;
		readonly data?: Uint32Array;
	}

	export interface SemanticTokensEdits {
		readonly resultId?: string;
		readonly edits: SemanticTokensEdit[];
	}

	export interface DocumentSemanticTokensProvider {
		onDidChange?: IEvent<void>;
		getLegend(): SemanticTokensLegend;
		provideDocumentSemanticTokens(model: editor.ITextModel, lastResultId: string | null, token: CancellationToken): ProviderResult<SemanticTokens | SemanticTokensEdits>;
		releaseDocumentSemanticTokens(resultId: string | undefined): void;
	}

	export interface DocumentRangeSemanticTokensProvider {
		getLegend(): SemanticTokensLegend;
		provideDocumentRangeSemanticTokens(model: editor.ITextModel, range: Range, token: CancellationToken): ProviderResult<SemanticTokens>;
	}

	export interface ILanguageExtensionPoint {
		id: string;
		extensions?: string[];
		filenames?: string[];
		filenamePatterns?: string[];
		firstLine?: string;
		aliases?: string[];
		mimetypes?: string[];
		configuration?: Uri;
	}
	/**
	 * A Monarch language definition
	 */
	export interface IMonarchLanguage {
		/**
		 * map from string to ILanguageRule[]
		 */
		tokenizer: {
			[name: string]: IMonarchLanguageRule[];
		};
		/**
		 * is the language case insensitive?
		 */
		ignoreCase?: boolean;
		/**
		 * is the language unicode-aware? (i.e., /\u{1D306}/)
		 */
		unicode?: boolean;
		/**
		 * if no match in the tokenizer assign this token class (default 'source')
		 */
		defaultToken?: string;
		/**
		 * for example [['{','}','delimiter.curly']]
		 */
		brackets?: IMonarchLanguageBracket[];
		/**
		 * start symbol in the tokenizer (by default the first entry is used)
		 */
		start?: string;
		/**
		 * attach this to every token class (by default '.' + name)
		 */
		tokenPostfix?: string;
		/**
		 * include line feeds (in the form of a \n character) at the end of lines
		 * Defaults to false
		 */
		includeLF?: boolean;
		/**
		 * Other keys that can be referred to by the tokenizer.
		 */
		[key: string]: any;
	}

	/**
	 * A rule is either a regular expression and an action
	 * 		shorthands: [reg,act] == { regex: reg, action: act}
	 *		and       : [reg,act,nxt] == { regex: reg, action: act{ next: nxt }}
	 */
	export type IShortMonarchLanguageRule1 = [string | RegExp, IMonarchLanguageAction];

	export type IShortMonarchLanguageRule2 = [string | RegExp, IMonarchLanguageAction, string];

	export interface IExpandedMonarchLanguageRule {
		/**
		 * match tokens
		 */
		regex?: string | RegExp;
		/**
		 * action to take on match
		 */
		action?: IMonarchLanguageAction;
		/**
		 * or an include rule. include all rules from the included state
		 */
		include?: string;
	}

	export type IMonarchLanguageRule = IShortMonarchLanguageRule1 | IShortMonarchLanguageRule2 | IExpandedMonarchLanguageRule;

	/**
	 * An action is either an array of actions...
	 * ... or a case statement with guards...
	 * ... or a basic action with a token value.
	 */
	export type IShortMonarchLanguageAction = string;

	export interface IExpandedMonarchLanguageAction {
		/**
		 * array of actions for each parenthesized match group
		 */
		group?: IMonarchLanguageAction[];
		/**
		 * map from string to ILanguageAction
		 */
		cases?: Object;
		/**
		 * token class (ie. css class) (or "@brackets" or "@rematch")
		 */
		token?: string;
		/**
		 * the next state to push, or "@push", "@pop", "@popall"
		 */
		next?: string;
		/**
		 * switch to this state
		 */
		switchTo?: string;
		/**
		 * go back n characters in the stream
		 */
		goBack?: number;
		/**
		 * @open or @close
		 */
		bracket?: string;
		/**
		 * switch to embedded language (using the mimetype) or get out using "@pop"
		 */
		nextEmbedded?: string;
		/**
		 * log a message to the browser console window
		 */
		log?: string;
	}

	export type IMonarchLanguageAction = IShortMonarchLanguageAction | IExpandedMonarchLanguageAction | IShortMonarchLanguageAction[] | IExpandedMonarchLanguageAction[];

	/**
	 * This interface can be shortened as an array, ie. ['{','}','delimiter.curly']
	 */
	export interface IMonarchLanguageBracket {
		/**
		 * open bracket
		 */
		open: string;
		/**
		 * closing bracket
		 */
		close: string;
		/**
		 * token class
		 */
		token: string;
	}

}

declare namespace monaco.worker {


	export interface IMirrorTextModel {
		readonly version: number;
	}

	export interface IMirrorModel extends IMirrorTextModel {
		readonly uri: Uri;
		readonly version: number;
		getValue(): string;
	}

	export interface IWorkerContext<H = undefined> {
		/**
		 * A proxy to the main thread host object.
		 */
		host: H;
		/**
		 * Get all available mirror models in this worker.
		 */
		getMirrorModels(): IMirrorModel[];
	}

}

//dtsv=3
