/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce, equals } from 'vs/base/common/arrays';
import { escapeCodicons } from 'vs/base/common/codicons';
import { illegalArgument } from 'vs/base/common/errors';
import { IRelativePattern } from 'vs/base/common/glob';
import { isMarkdownString } from 'vs/base/common/htmlContent';
import { startsWith } from 'vs/base/common/strings';
import { isStringArray } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { FileSystemProviderErrorCode, markAsFileSystemProviderError } from 'vs/platform/files/common/files';
import { RemoteAuthorityResolverErrorCode } from 'vs/platform/remote/common/remoteAuthorityResolver';
import type * as vscode from 'vscode';

function es5ClassCompat(target: Function): any {
	///@ts-expect-error
	function _() { return Reflect.construct(target, arguments, this.constructor); }
	Object.defineProperty(_, 'name', Object.getOwnPropertyDescriptor(target, 'name')!);
	Object.setPrototypeOf(_, target);
	Object.setPrototypeOf(_.prototype, target.prototype);
	return _;
}

@es5ClassCompat
export class Disposable {

	static from(...inDisposables: { dispose(): any; }[]): Disposable {
		let disposables: ReadonlyArray<{ dispose(): any; }> | undefined = inDisposables;
		return new Disposable(function () {
			if (disposables) {
				for (const disposable of disposables) {
					if (disposable && typeof disposable.dispose === 'function') {
						disposable.dispose();
					}
				}
				disposables = undefined;
			}
		});
	}

	#callOnDispose?: () => any;

	constructor(callOnDispose: () => any) {
		this.#callOnDispose = callOnDispose;
	}

	dispose(): any {
		if (typeof this.#callOnDispose === 'function') {
			this.#callOnDispose();
			this.#callOnDispose = undefined;
		}
	}
}

@es5ClassCompat
export class Position {

	static Min(...positions: Position[]): Position {
		if (positions.length === 0) {
			throw new TypeError();
		}
		let result = positions[0];
		for (let i = 1; i < positions.length; i++) {
			const p = positions[i];
			if (p.isBefore(result!)) {
				result = p;
			}
		}
		return result;
	}

	static Max(...positions: Position[]): Position {
		if (positions.length === 0) {
			throw new TypeError();
		}
		let result = positions[0];
		for (let i = 1; i < positions.length; i++) {
			const p = positions[i];
			if (p.isAfter(result!)) {
				result = p;
			}
		}
		return result;
	}

	static isPosition(other: any): other is Position {
		if (!other) {
			return false;
		}
		if (other instanceof Position) {
			return true;
		}
		let { line, character } = <Position>other;
		if (typeof line === 'number' && typeof character === 'number') {
			return true;
		}
		return false;
	}

	private _line: number;
	private _character: number;

	get line(): number {
		return this._line;
	}

	get character(): number {
		return this._character;
	}

	constructor(line: number, character: number) {
		if (line < 0) {
			throw illegalArgument('line must be non-negative');
		}
		if (character < 0) {
			throw illegalArgument('character must be non-negative');
		}
		this._line = line;
		this._character = character;
	}

	isBefore(other: Position): boolean {
		if (this._line < other._line) {
			return true;
		}
		if (other._line < this._line) {
			return false;
		}
		return this._character < other._character;
	}

	isBeforeOrEqual(other: Position): boolean {
		if (this._line < other._line) {
			return true;
		}
		if (other._line < this._line) {
			return false;
		}
		return this._character <= other._character;
	}

	isAfter(other: Position): boolean {
		return !this.isBeforeOrEqual(other);
	}

	isAfterOrEqual(other: Position): boolean {
		return !this.isBefore(other);
	}

	isEqual(other: Position): boolean {
		return this._line === other._line && this._character === other._character;
	}

	compareTo(other: Position): number {
		if (this._line < other._line) {
			return -1;
		} else if (this._line > other.line) {
			return 1;
		} else {
			// equal line
			if (this._character < other._character) {
				return -1;
			} else if (this._character > other._character) {
				return 1;
			} else {
				// equal line and character
				return 0;
			}
		}
	}

	translate(change: { lineDelta?: number; characterDelta?: number; }): Position;
	translate(lineDelta?: number, characterDelta?: number): Position;
	translate(lineDeltaOrChange: number | undefined | { lineDelta?: number; characterDelta?: number; }, characterDelta: number = 0): Position {

		if (lineDeltaOrChange === null || characterDelta === null) {
			throw illegalArgument();
		}

		let lineDelta: number;
		if (typeof lineDeltaOrChange === 'undefined') {
			lineDelta = 0;
		} else if (typeof lineDeltaOrChange === 'number') {
			lineDelta = lineDeltaOrChange;
		} else {
			lineDelta = typeof lineDeltaOrChange.lineDelta === 'number' ? lineDeltaOrChange.lineDelta : 0;
			characterDelta = typeof lineDeltaOrChange.characterDelta === 'number' ? lineDeltaOrChange.characterDelta : 0;
		}

		if (lineDelta === 0 && characterDelta === 0) {
			return this;
		}
		return new Position(this.line + lineDelta, this.character + characterDelta);
	}

	with(change: { line?: number; character?: number; }): Position;
	with(line?: number, character?: number): Position;
	with(lineOrChange: number | undefined | { line?: number; character?: number; }, character: number = this.character): Position {

		if (lineOrChange === null || character === null) {
			throw illegalArgument();
		}

		let line: number;
		if (typeof lineOrChange === 'undefined') {
			line = this.line;

		} else if (typeof lineOrChange === 'number') {
			line = lineOrChange;

		} else {
			line = typeof lineOrChange.line === 'number' ? lineOrChange.line : this.line;
			character = typeof lineOrChange.character === 'number' ? lineOrChange.character : this.character;
		}

		if (line === this.line && character === this.character) {
			return this;
		}
		return new Position(line, character);
	}

	toJSON(): any {
		return { line: this.line, character: this.character };
	}
}

@es5ClassCompat
export class Range {

	static isRange(thing: any): thing is vscode.Range {
		if (thing instanceof Range) {
			return true;
		}
		if (!thing) {
			return false;
		}
		return Position.isPosition((<Range>thing).start)
			&& Position.isPosition((<Range>thing.end));
	}

	protected _start: Position;
	protected _end: Position;

	get start(): Position {
		return this._start;
	}

	get end(): Position {
		return this._end;
	}

	constructor(start: Position, end: Position);
	constructor(startLine: number, startColumn: number, endLine: number, endColumn: number);
	constructor(startLineOrStart: number | Position, startColumnOrEnd: number | Position, endLine?: number, endColumn?: number) {
		let start: Position | undefined;
		let end: Position | undefined;

		if (typeof startLineOrStart === 'number' && typeof startColumnOrEnd === 'number' && typeof endLine === 'number' && typeof endColumn === 'number') {
			start = new Position(startLineOrStart, startColumnOrEnd);
			end = new Position(endLine, endColumn);
		} else if (startLineOrStart instanceof Position && startColumnOrEnd instanceof Position) {
			start = startLineOrStart;
			end = startColumnOrEnd;
		}

		if (!start || !end) {
			throw new Error('Invalid arguments');
		}

		if (start.isBefore(end)) {
			this._start = start;
			this._end = end;
		} else {
			this._start = end;
			this._end = start;
		}
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Range) {
			return this.contains(positionOrRange._start)
				&& this.contains(positionOrRange._end);

		} else if (positionOrRange instanceof Position) {
			if (positionOrRange.isBefore(this._start)) {
				return false;
			}
			if (this._end.isBefore(positionOrRange)) {
				return false;
			}
			return true;
		}
		return false;
	}

	isEqual(other: Range): boolean {
		return this._start.isEqual(other._start) && this._end.isEqual(other._end);
	}

	intersection(other: Range): Range | undefined {
		const start = Position.Max(other.start, this._start);
		const end = Position.Min(other.end, this._end);
		if (start.isAfter(end)) {
			// this happens when there is no overlap:
			// |-----|
			//          |----|
			return undefined;
		}
		return new Range(start, end);
	}

	union(other: Range): Range {
		if (this.contains(other)) {
			return this;
		} else if (other.contains(this)) {
			return other;
		}
		const start = Position.Min(other.start, this._start);
		const end = Position.Max(other.end, this.end);
		return new Range(start, end);
	}

	get isEmpty(): boolean {
		return this._start.isEqual(this._end);
	}

	get isSingleLine(): boolean {
		return this._start.line === this._end.line;
	}

	with(change: { start?: Position, end?: Position; }): Range;
	with(start?: Position, end?: Position): Range;
	with(startOrChange: Position | undefined | { start?: Position, end?: Position; }, end: Position = this.end): Range {

		if (startOrChange === null || end === null) {
			throw illegalArgument();
		}

		let start: Position;
		if (!startOrChange) {
			start = this.start;

		} else if (Position.isPosition(startOrChange)) {
			start = startOrChange;

		} else {
			start = startOrChange.start || this.start;
			end = startOrChange.end || this.end;
		}

		if (start.isEqual(this._start) && end.isEqual(this.end)) {
			return this;
		}
		return new Range(start, end);
	}

	toJSON(): any {
		return [this.start, this.end];
	}
}

@es5ClassCompat
export class Selection extends Range {

	static isSelection(thing: any): thing is Selection {
		if (thing instanceof Selection) {
			return true;
		}
		if (!thing) {
			return false;
		}
		return Range.isRange(thing)
			&& Position.isPosition((<Selection>thing).anchor)
			&& Position.isPosition((<Selection>thing).active)
			&& typeof (<Selection>thing).isReversed === 'boolean';
	}

	private _anchor: Position;

	public get anchor(): Position {
		return this._anchor;
	}

	private _active: Position;

	public get active(): Position {
		return this._active;
	}

	constructor(anchor: Position, active: Position);
	constructor(anchorLine: number, anchorColumn: number, activeLine: number, activeColumn: number);
	constructor(anchorLineOrAnchor: number | Position, anchorColumnOrActive: number | Position, activeLine?: number, activeColumn?: number) {
		let anchor: Position | undefined;
		let active: Position | undefined;

		if (typeof anchorLineOrAnchor === 'number' && typeof anchorColumnOrActive === 'number' && typeof activeLine === 'number' && typeof activeColumn === 'number') {
			anchor = new Position(anchorLineOrAnchor, anchorColumnOrActive);
			active = new Position(activeLine, activeColumn);
		} else if (anchorLineOrAnchor instanceof Position && anchorColumnOrActive instanceof Position) {
			anchor = anchorLineOrAnchor;
			active = anchorColumnOrActive;
		}

		if (!anchor || !active) {
			throw new Error('Invalid arguments');
		}

		super(anchor, active);

		this._anchor = anchor;
		this._active = active;
	}

	get isReversed(): boolean {
		return this._anchor === this._end;
	}

	toJSON() {
		return {
			start: this.start,
			end: this.end,
			active: this.active,
			anchor: this.anchor
		};
	}
}

export class ResolvedAuthority {
	readonly host: string;
	readonly port: number;

	constructor(host: string, port: number) {
		if (typeof host !== 'string' || host.length === 0) {
			throw illegalArgument('host');
		}
		if (typeof port !== 'number' || port === 0 || Math.round(port) !== port) {
			throw illegalArgument('port');
		}
		this.host = host;
		this.port = Math.round(port);
	}
}

export class RemoteAuthorityResolverError extends Error {

	static NotAvailable(message?: string, handled?: boolean): RemoteAuthorityResolverError {
		return new RemoteAuthorityResolverError(message, RemoteAuthorityResolverErrorCode.NotAvailable, handled);
	}

	static TemporarilyNotAvailable(message?: string): RemoteAuthorityResolverError {
		return new RemoteAuthorityResolverError(message, RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable);
	}

	public readonly _message: string | undefined;
	public readonly _code: RemoteAuthorityResolverErrorCode;
	public readonly _detail: any;

	constructor(message?: string, code: RemoteAuthorityResolverErrorCode = RemoteAuthorityResolverErrorCode.Unknown, detail?: any) {
		super(message);

		this._message = message;
		this._code = code;
		this._detail = detail;

		// workaround when extending builtin objects and when compiling to ES5, see:
		// https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
		if (typeof (<any>Object).setPrototypeOf === 'function') {
			(<any>Object).setPrototypeOf(this, RemoteAuthorityResolverError.prototype);
		}
	}
}

export enum EndOfLine {
	LF = 1,
	CRLF = 2
}

export enum EnvironmentVariableMutatorType {
	Replace = 1,
	Append = 2,
	Prepend = 3
}

@es5ClassCompat
export class TextEdit {

	static isTextEdit(thing: any): thing is TextEdit {
		if (thing instanceof TextEdit) {
			return true;
		}
		if (!thing) {
			return false;
		}
		return Range.isRange((<TextEdit>thing))
			&& typeof (<TextEdit>thing).newText === 'string';
	}

	static replace(range: Range, newText: string): TextEdit {
		return new TextEdit(range, newText);
	}

	static insert(position: Position, newText: string): TextEdit {
		return TextEdit.replace(new Range(position, position), newText);
	}

	static delete(range: Range): TextEdit {
		return TextEdit.replace(range, '');
	}

	static setEndOfLine(eol: EndOfLine): TextEdit {
		const ret = new TextEdit(new Range(new Position(0, 0), new Position(0, 0)), '');
		ret.newEol = eol;
		return ret;
	}

	protected _range: Range;
	protected _newText: string | null;
	protected _newEol?: EndOfLine;

	get range(): Range {
		return this._range;
	}

	set range(value: Range) {
		if (value && !Range.isRange(value)) {
			throw illegalArgument('range');
		}
		this._range = value;
	}

	get newText(): string {
		return this._newText || '';
	}

	set newText(value: string) {
		if (value && typeof value !== 'string') {
			throw illegalArgument('newText');
		}
		this._newText = value;
	}

	get newEol(): EndOfLine | undefined {
		return this._newEol;
	}

	set newEol(value: EndOfLine | undefined) {
		if (value && typeof value !== 'number') {
			throw illegalArgument('newEol');
		}
		this._newEol = value;
	}

	constructor(range: Range, newText: string | null) {
		this._range = range;
		this._newText = newText;
	}

	toJSON(): any {
		return {
			range: this.range,
			newText: this.newText,
			newEol: this._newEol
		};
	}
}

export interface IFileOperationOptions {
	overwrite?: boolean;
	ignoreIfExists?: boolean;
	ignoreIfNotExists?: boolean;
	recursive?: boolean;
}

export interface IFileOperation {
	_type: 1;
	from?: URI;
	to?: URI;
	options?: IFileOperationOptions;
	metadata?: vscode.WorkspaceEditEntryMetadata;
}

export interface IFileTextEdit {
	_type: 2;
	uri: URI;
	edit: TextEdit;
	metadata?: vscode.WorkspaceEditEntryMetadata;
}

@es5ClassCompat
export class WorkspaceEdit implements vscode.WorkspaceEdit {

	private _edits = new Array<IFileOperation | IFileTextEdit>();

	renameFile(from: vscode.Uri, to: vscode.Uri, options?: { overwrite?: boolean, ignoreIfExists?: boolean; }, metadata?: vscode.WorkspaceEditEntryMetadata): void {
		this._edits.push({ _type: 1, from, to, options, metadata });
	}

	createFile(uri: vscode.Uri, options?: { overwrite?: boolean, ignoreIfExists?: boolean; }, metadata?: vscode.WorkspaceEditEntryMetadata): void {
		this._edits.push({ _type: 1, from: undefined, to: uri, options, metadata });
	}

	deleteFile(uri: vscode.Uri, options?: { recursive?: boolean, ignoreIfNotExists?: boolean; }, metadata?: vscode.WorkspaceEditEntryMetadata): void {
		this._edits.push({ _type: 1, from: uri, to: undefined, options, metadata });
	}

	replace(uri: URI, range: Range, newText: string, metadata?: vscode.WorkspaceEditEntryMetadata): void {
		this._edits.push({ _type: 2, uri, edit: new TextEdit(range, newText), metadata });
	}

	insert(resource: URI, position: Position, newText: string, metadata?: vscode.WorkspaceEditEntryMetadata): void {
		this.replace(resource, new Range(position, position), newText, metadata);
	}

	delete(resource: URI, range: Range, metadata?: vscode.WorkspaceEditEntryMetadata): void {
		this.replace(resource, range, '', metadata);
	}

	has(uri: URI): boolean {
		return this._edits.some(edit => edit._type === 2 && edit.uri.toString() === uri.toString());
	}

	set(uri: URI, edits: TextEdit[]): void {
		if (!edits) {
			// remove all text edits for `uri`
			for (let i = 0; i < this._edits.length; i++) {
				const element = this._edits[i];
				if (element._type === 2 && element.uri.toString() === uri.toString()) {
					this._edits[i] = undefined!; // will be coalesced down below
				}
			}
			this._edits = coalesce(this._edits);
		} else {
			// append edit to the end
			for (const edit of edits) {
				if (edit) {
					this._edits.push({ _type: 2, uri, edit });
				}
			}
		}
	}

	get(uri: URI): TextEdit[] {
		const res: TextEdit[] = [];
		for (let candidate of this._edits) {
			if (candidate._type === 2 && candidate.uri.toString() === uri.toString()) {
				res.push(candidate.edit);
			}
		}
		return res;
	}

	entries(): [URI, TextEdit[]][] {
		const textEdits = new Map<string, [URI, TextEdit[]]>();
		for (let candidate of this._edits) {
			if (candidate._type === 2) {
				let textEdit = textEdits.get(candidate.uri.toString());
				if (!textEdit) {
					textEdit = [candidate.uri, []];
					textEdits.set(candidate.uri.toString(), textEdit);
				}
				textEdit[1].push(candidate.edit);
			}
		}
		return [...textEdits.values()];
	}

	allEntries(): ReadonlyArray<IFileTextEdit | IFileOperation> {
		return this._edits;
	}

	// _allEntries(): ([URI, TextEdit] | [URI?, URI?, IFileOperationOptions?])[] {
	// 	const res: ([URI, TextEdit] | [URI?, URI?, IFileOperationOptions?])[] = [];
	// 	for (let edit of this._edits) {
	// 		if (edit._type === 1) {
	// 			res.push([edit.from, edit.to, edit.options]);
	// 		} else {
	// 			res.push([edit.uri, edit.edit]);
	// 		}
	// 	}
	// 	return res;
	// }

	get size(): number {
		return this.entries().length;
	}

	toJSON(): any {
		return this.entries();
	}
}

@es5ClassCompat
export class SnippetString {

	static isSnippetString(thing: any): thing is SnippetString {
		if (thing instanceof SnippetString) {
			return true;
		}
		if (!thing) {
			return false;
		}
		return typeof (<SnippetString>thing).value === 'string';
	}

	private static _escape(value: string): string {
		return value.replace(/\$|}|\\/g, '\\$&');
	}

	private _tabstop: number = 1;

	value: string;

	constructor(value?: string) {
		this.value = value || '';
	}

	appendText(string: string): SnippetString {
		this.value += SnippetString._escape(string);
		return this;
	}

	appendTabstop(number: number = this._tabstop++): SnippetString {
		this.value += '$';
		this.value += number;
		return this;
	}

	appendPlaceholder(value: string | ((snippet: SnippetString) => any), number: number = this._tabstop++): SnippetString {

		if (typeof value === 'function') {
			const nested = new SnippetString();
			nested._tabstop = this._tabstop;
			value(nested);
			this._tabstop = nested._tabstop;
			value = nested.value;
		} else {
			value = SnippetString._escape(value);
		}

		this.value += '${';
		this.value += number;
		this.value += ':';
		this.value += value;
		this.value += '}';

		return this;
	}

	appendChoice(values: string[], number: number = this._tabstop++): SnippetString {
		const value = SnippetString._escape(values.toString());

		this.value += '${';
		this.value += number;
		this.value += '|';
		this.value += value;
		this.value += '|}';

		return this;
	}

	appendVariable(name: string, defaultValue?: string | ((snippet: SnippetString) => any)): SnippetString {

		if (typeof defaultValue === 'function') {
			const nested = new SnippetString();
			nested._tabstop = this._tabstop;
			defaultValue(nested);
			this._tabstop = nested._tabstop;
			defaultValue = nested.value;

		} else if (typeof defaultValue === 'string') {
			defaultValue = defaultValue.replace(/\$|}/g, '\\$&');
		}

		this.value += '${';
		this.value += name;
		if (defaultValue) {
			this.value += ':';
			this.value += defaultValue;
		}
		this.value += '}';


		return this;
	}
}

export enum DiagnosticTag {
	Unnecessary = 1,
	Deprecated = 2
}

export enum DiagnosticSeverity {
	Hint = 3,
	Information = 2,
	Warning = 1,
	Error = 0
}

@es5ClassCompat
export class Location {

	static isLocation(thing: any): thing is Location {
		if (thing instanceof Location) {
			return true;
		}
		if (!thing) {
			return false;
		}
		return Range.isRange((<Location>thing).range)
			&& URI.isUri((<Location>thing).uri);
	}

	uri: URI;
	range!: Range;

	constructor(uri: URI, rangeOrPosition: Range | Position) {
		this.uri = uri;

		if (!rangeOrPosition) {
			//that's OK
		} else if (rangeOrPosition instanceof Range) {
			this.range = rangeOrPosition;
		} else if (rangeOrPosition instanceof Position) {
			this.range = new Range(rangeOrPosition, rangeOrPosition);
		} else {
			throw new Error('Illegal argument');
		}
	}

	toJSON(): any {
		return {
			uri: this.uri,
			range: this.range
		};
	}
}

@es5ClassCompat
export class DiagnosticRelatedInformation {

	static is(thing: any): thing is DiagnosticRelatedInformation {
		if (!thing) {
			return false;
		}
		return typeof (<DiagnosticRelatedInformation>thing).message === 'string'
			&& (<DiagnosticRelatedInformation>thing).location
			&& Range.isRange((<DiagnosticRelatedInformation>thing).location.range)
			&& URI.isUri((<DiagnosticRelatedInformation>thing).location.uri);
	}

	location: Location;
	message: string;

	constructor(location: Location, message: string) {
		this.location = location;
		this.message = message;
	}

	static isEqual(a: DiagnosticRelatedInformation, b: DiagnosticRelatedInformation): boolean {
		if (a === b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		return a.message === b.message
			&& a.location.range.isEqual(b.location.range)
			&& a.location.uri.toString() === b.location.uri.toString();
	}
}

@es5ClassCompat
export class Diagnostic {

	range: Range;
	message: string;
	severity: DiagnosticSeverity;
	source?: string;
	code?: string | number;
	relatedInformation?: DiagnosticRelatedInformation[];
	tags?: DiagnosticTag[];

	constructor(range: Range, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
		this.range = range;
		this.message = message;
		this.severity = severity;
	}

	toJSON(): any {
		return {
			severity: DiagnosticSeverity[this.severity],
			message: this.message,
			range: this.range,
			source: this.source,
			code: this.code,
		};
	}

	static isEqual(a: Diagnostic | undefined, b: Diagnostic | undefined): boolean {
		if (a === b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		return a.message === b.message
			&& a.severity === b.severity
			&& a.code === b.code
			&& a.severity === b.severity
			&& a.source === b.source
			&& a.range.isEqual(b.range)
			&& equals(a.tags, b.tags)
			&& equals(a.relatedInformation, b.relatedInformation, DiagnosticRelatedInformation.isEqual);
	}
}

@es5ClassCompat
export class Hover {

	public contents: vscode.MarkdownString[] | vscode.MarkedString[];
	public range: Range | undefined;

	constructor(
		contents: vscode.MarkdownString | vscode.MarkedString | vscode.MarkdownString[] | vscode.MarkedString[],
		range?: Range
	) {
		if (!contents) {
			throw new Error('Illegal argument, contents must be defined');
		}
		if (Array.isArray(contents)) {
			this.contents = <vscode.MarkdownString[] | vscode.MarkedString[]>contents;
		} else if (isMarkdownString(contents)) {
			this.contents = [contents];
		} else {
			this.contents = [contents];
		}
		this.range = range;
	}
}

export enum DocumentHighlightKind {
	Text = 0,
	Read = 1,
	Write = 2
}

@es5ClassCompat
export class DocumentHighlight {

	range: Range;
	kind: DocumentHighlightKind;

	constructor(range: Range, kind: DocumentHighlightKind = DocumentHighlightKind.Text) {
		this.range = range;
		this.kind = kind;
	}

	toJSON(): any {
		return {
			range: this.range,
			kind: DocumentHighlightKind[this.kind]
		};
	}
}

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
	Deprecated = 1,
}

@es5ClassCompat
export class SymbolInformation {

	static validate(candidate: SymbolInformation): void {
		if (!candidate.name) {
			throw new Error('name must not be falsy');
		}
	}

	name: string;
	location!: Location;
	kind: SymbolKind;
	tags?: SymbolTag[];
	containerName: string | undefined;

	constructor(name: string, kind: SymbolKind, containerName: string | undefined, location: Location);
	constructor(name: string, kind: SymbolKind, range: Range, uri?: URI, containerName?: string);
	constructor(name: string, kind: SymbolKind, rangeOrContainer: string | undefined | Range, locationOrUri?: Location | URI, containerName?: string) {
		this.name = name;
		this.kind = kind;
		this.containerName = containerName;

		if (typeof rangeOrContainer === 'string') {
			this.containerName = rangeOrContainer;
		}

		if (locationOrUri instanceof Location) {
			this.location = locationOrUri;
		} else if (rangeOrContainer instanceof Range) {
			this.location = new Location(locationOrUri!, rangeOrContainer);
		}

		SymbolInformation.validate(this);
	}

	toJSON(): any {
		return {
			name: this.name,
			kind: SymbolKind[this.kind],
			location: this.location,
			containerName: this.containerName
		};
	}
}

@es5ClassCompat
export class DocumentSymbol {

	static validate(candidate: DocumentSymbol): void {
		if (!candidate.name) {
			throw new Error('name must not be falsy');
		}
		if (!candidate.range.contains(candidate.selectionRange)) {
			throw new Error('selectionRange must be contained in fullRange');
		}
		if (candidate.children) {
			candidate.children.forEach(DocumentSymbol.validate);
		}
	}

	name: string;
	detail: string;
	kind: SymbolKind;
	tags?: SymbolTag[];
	range: Range;
	selectionRange: Range;
	children: DocumentSymbol[];

	constructor(name: string, detail: string, kind: SymbolKind, range: Range, selectionRange: Range) {
		this.name = name;
		this.detail = detail;
		this.kind = kind;
		this.range = range;
		this.selectionRange = selectionRange;
		this.children = [];

		DocumentSymbol.validate(this);
	}
}


export enum CodeActionTrigger {
	Automatic = 1,
	Manual = 2,
}

@es5ClassCompat
export class CodeAction {
	title: string;

	command?: vscode.Command;

	edit?: WorkspaceEdit;

	diagnostics?: Diagnostic[];

	kind?: CodeActionKind;

	isPreferred?: boolean;

	constructor(title: string, kind?: CodeActionKind) {
		this.title = title;
		this.kind = kind;
	}
}


@es5ClassCompat
export class CodeActionKind {
	private static readonly sep = '.';

	public static Empty: CodeActionKind;
	public static QuickFix: CodeActionKind;
	public static Refactor: CodeActionKind;
	public static RefactorExtract: CodeActionKind;
	public static RefactorInline: CodeActionKind;
	public static RefactorRewrite: CodeActionKind;
	public static Source: CodeActionKind;
	public static SourceOrganizeImports: CodeActionKind;
	public static SourceFixAll: CodeActionKind;

	constructor(
		public readonly value: string
	) { }

	public append(parts: string): CodeActionKind {
		return new CodeActionKind(this.value ? this.value + CodeActionKind.sep + parts : parts);
	}

	public intersects(other: CodeActionKind): boolean {
		return this.contains(other) || other.contains(this);
	}

	public contains(other: CodeActionKind): boolean {
		return this.value === other.value || startsWith(other.value, this.value + CodeActionKind.sep);
	}
}
CodeActionKind.Empty = new CodeActionKind('');
CodeActionKind.QuickFix = CodeActionKind.Empty.append('quickfix');
CodeActionKind.Refactor = CodeActionKind.Empty.append('refactor');
CodeActionKind.RefactorExtract = CodeActionKind.Refactor.append('extract');
CodeActionKind.RefactorInline = CodeActionKind.Refactor.append('inline');
CodeActionKind.RefactorRewrite = CodeActionKind.Refactor.append('rewrite');
CodeActionKind.Source = CodeActionKind.Empty.append('source');
CodeActionKind.SourceOrganizeImports = CodeActionKind.Source.append('organizeImports');
CodeActionKind.SourceFixAll = CodeActionKind.Source.append('fixAll');

@es5ClassCompat
export class SelectionRange {

	range: Range;
	parent?: SelectionRange;

	constructor(range: Range, parent?: SelectionRange) {
		this.range = range;
		this.parent = parent;

		if (parent && !parent.range.contains(this.range)) {
			throw new Error('Invalid argument: parent must contain this range');
		}
	}
}

export class CallHierarchyItem {

	_sessionId?: string;
	_itemId?: string;

	kind: SymbolKind;
	name: string;
	detail?: string;
	uri: URI;
	range: Range;
	selectionRange: Range;

	constructor(kind: SymbolKind, name: string, detail: string, uri: URI, range: Range, selectionRange: Range) {
		this.kind = kind;
		this.name = name;
		this.detail = detail;
		this.uri = uri;
		this.range = range;
		this.selectionRange = selectionRange;
	}
}

export class CallHierarchyIncomingCall {

	from: vscode.CallHierarchyItem;
	fromRanges: vscode.Range[];

	constructor(item: vscode.CallHierarchyItem, fromRanges: vscode.Range[]) {
		this.fromRanges = fromRanges;
		this.from = item;
	}
}
export class CallHierarchyOutgoingCall {

	to: vscode.CallHierarchyItem;
	fromRanges: vscode.Range[];

	constructor(item: vscode.CallHierarchyItem, fromRanges: vscode.Range[]) {
		this.fromRanges = fromRanges;
		this.to = item;
	}
}

@es5ClassCompat
export class CodeLens {

	range: Range;

	command: vscode.Command | undefined;

	constructor(range: Range, command?: vscode.Command) {
		this.range = range;
		this.command = command;
	}

	get isResolved(): boolean {
		return !!this.command;
	}
}


export class CodeInset {

	range: Range;
	height?: number;

	constructor(range: Range, height?: number) {
		this.range = range;
		this.height = height;
	}
}


@es5ClassCompat
export class MarkdownString {

	value: string;
	isTrusted?: boolean;
	readonly supportThemeIcons?: boolean;

	constructor(value?: string, supportThemeIcons: boolean = false) {
		this.value = value ?? '';
		this.supportThemeIcons = supportThemeIcons;
	}

	appendText(value: string): MarkdownString {
		// escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
		this.value += (this.supportThemeIcons ? escapeCodicons(value) : value)
			.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&')
			.replace('\n', '\n\n');

		return this;
	}

	appendMarkdown(value: string): MarkdownString {
		this.value += value;

		return this;
	}

	appendCodeblock(code: string, language: string = ''): MarkdownString {
		this.value += '\n```';
		this.value += language;
		this.value += '\n';
		this.value += code;
		this.value += '\n```\n';
		return this;
	}
}

@es5ClassCompat
export class ParameterInformation {

	label: string | [number, number];
	documentation?: string | MarkdownString;

	constructor(label: string | [number, number], documentation?: string | MarkdownString) {
		this.label = label;
		this.documentation = documentation;
	}
}

@es5ClassCompat
export class SignatureInformation {

	label: string;
	documentation?: string | MarkdownString;
	parameters: ParameterInformation[];
	activeParameter?: number;

	constructor(label: string, documentation?: string | MarkdownString) {
		this.label = label;
		this.documentation = documentation;
		this.parameters = [];
	}
}

@es5ClassCompat
export class SignatureHelp {

	signatures: SignatureInformation[];
	activeSignature: number = 0;
	activeParameter: number = 0;

	constructor() {
		this.signatures = [];
	}
}

export enum SignatureHelpTriggerKind {
	Invoke = 1,
	TriggerCharacter = 2,
	ContentChange = 3,
}

export enum CompletionTriggerKind {
	Invoke = 0,
	TriggerCharacter = 1,
	TriggerForIncompleteCompletions = 2
}

export interface CompletionContext {
	readonly triggerKind: CompletionTriggerKind;
	readonly triggerCharacter?: string;
}

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
	File = 16,
	Reference = 17,
	Folder = 18,
	EnumMember = 19,
	Constant = 20,
	Struct = 21,
	Event = 22,
	Operator = 23,
	TypeParameter = 24,
	User = 25,
	Issue = 26
}

export enum CompletionItemTag {
	Deprecated = 1,
}

export interface CompletionItemLabel {
	name: string;
	parameters?: string;
	qualifier?: string;
	type?: string;
}


@es5ClassCompat
export class CompletionItem implements vscode.CompletionItem {

	label: string;
	label2?: CompletionItemLabel;
	kind?: CompletionItemKind;
	tags?: CompletionItemTag[];
	detail?: string;
	documentation?: string | MarkdownString;
	sortText?: string;
	filterText?: string;
	preselect?: boolean;
	insertText?: string | SnippetString;
	keepWhitespace?: boolean;
	range?: Range | { inserting: Range; replacing: Range; };
	commitCharacters?: string[];
	textEdit?: TextEdit;
	additionalTextEdits?: TextEdit[];
	command?: vscode.Command;

	constructor(label: string, kind?: CompletionItemKind) {
		this.label = label;
		this.kind = kind;
	}

	toJSON(): any {
		return {
			label: this.label,
			label2: this.label2,
			kind: this.kind && CompletionItemKind[this.kind],
			detail: this.detail,
			documentation: this.documentation,
			sortText: this.sortText,
			filterText: this.filterText,
			preselect: this.preselect,
			insertText: this.insertText,
			textEdit: this.textEdit
		};
	}
}

@es5ClassCompat
export class CompletionList {

	isIncomplete?: boolean;
	items: vscode.CompletionItem[];

	constructor(items: vscode.CompletionItem[] = [], isIncomplete: boolean = false) {
		this.items = items;
		this.isIncomplete = isIncomplete;
	}
}

export enum ViewColumn {
	Active = -1,
	Beside = -2,
	One = 1,
	Two = 2,
	Three = 3,
	Four = 4,
	Five = 5,
	Six = 6,
	Seven = 7,
	Eight = 8,
	Nine = 9
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2
}

export enum TextEditorLineNumbersStyle {
	Off = 0,
	On = 1,
	Relative = 2
}

export enum TextDocumentSaveReason {
	Manual = 1,
	AfterDelay = 2,
	FocusOut = 3
}

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3
}

export enum TextEditorSelectionChangeKind {
	Keyboard = 1,
	Mouse = 2,
	Command = 3
}

/**
 * These values match very carefully the values of `TrackedRangeStickiness`
 */
export enum DecorationRangeBehavior {
	/**
	 * TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
	 */
	OpenOpen = 0,
	/**
	 * TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
	 */
	ClosedClosed = 1,
	/**
	 * TrackedRangeStickiness.GrowsOnlyWhenTypingBefore
	 */
	OpenClosed = 2,
	/**
	 * TrackedRangeStickiness.GrowsOnlyWhenTypingAfter
	 */
	ClosedOpen = 3
}

export namespace TextEditorSelectionChangeKind {
	export function fromValue(s: string | undefined) {
		switch (s) {
			case 'keyboard': return TextEditorSelectionChangeKind.Keyboard;
			case 'mouse': return TextEditorSelectionChangeKind.Mouse;
			case 'api': return TextEditorSelectionChangeKind.Command;
		}
		return undefined;
	}
}

@es5ClassCompat
export class DocumentLink {

	range: Range;

	target?: URI;

	tooltip?: string;

	constructor(range: Range, target: URI | undefined) {
		if (target && !(URI.isUri(target))) {
			throw illegalArgument('target');
		}
		if (!Range.isRange(range) || range.isEmpty) {
			throw illegalArgument('range');
		}
		this.range = range;
		this.target = target;
	}
}

@es5ClassCompat
export class Color {
	readonly red: number;
	readonly green: number;
	readonly blue: number;
	readonly alpha: number;

	constructor(red: number, green: number, blue: number, alpha: number) {
		this.red = red;
		this.green = green;
		this.blue = blue;
		this.alpha = alpha;
	}
}

export type IColorFormat = string | { opaque: string, transparent: string; };

@es5ClassCompat
export class ColorInformation {
	range: Range;

	color: Color;

	constructor(range: Range, color: Color) {
		if (color && !(color instanceof Color)) {
			throw illegalArgument('color');
		}
		if (!Range.isRange(range) || range.isEmpty) {
			throw illegalArgument('range');
		}
		this.range = range;
		this.color = color;
	}
}

@es5ClassCompat
export class ColorPresentation {
	label: string;
	textEdit?: TextEdit;
	additionalTextEdits?: TextEdit[];

	constructor(label: string) {
		if (!label || typeof label !== 'string') {
			throw illegalArgument('label');
		}
		this.label = label;
	}
}

export enum ColorFormat {
	RGB = 0,
	HEX = 1,
	HSL = 2
}

export enum SourceControlInputBoxValidationType {
	Error = 0,
	Warning = 1,
	Information = 2
}

export enum TaskRevealKind {
	Always = 1,

	Silent = 2,

	Never = 3
}

export enum TaskPanelKind {
	Shared = 1,

	Dedicated = 2,

	New = 3
}

@es5ClassCompat
export class TaskGroup implements vscode.TaskGroup {

	private _id: string;

	public static Clean: TaskGroup = new TaskGroup('clean', 'Clean');

	public static Build: TaskGroup = new TaskGroup('build', 'Build');

	public static Rebuild: TaskGroup = new TaskGroup('rebuild', 'Rebuild');

	public static Test: TaskGroup = new TaskGroup('test', 'Test');

	public static from(value: string) {
		switch (value) {
			case 'clean':
				return TaskGroup.Clean;
			case 'build':
				return TaskGroup.Build;
			case 'rebuild':
				return TaskGroup.Rebuild;
			case 'test':
				return TaskGroup.Test;
			default:
				return undefined;
		}
	}

	constructor(id: string, _label: string) {
		if (typeof id !== 'string') {
			throw illegalArgument('name');
		}
		if (typeof _label !== 'string') {
			throw illegalArgument('name');
		}
		this._id = id;
	}

	get id(): string {
		return this._id;
	}
}

function computeTaskExecutionId(values: string[]): string {
	let id: string = '';
	for (let i = 0; i < values.length; i++) {
		id += values[i].replace(/,/g, ',,') + ',';
	}
	return id;
}

@es5ClassCompat
export class ProcessExecution implements vscode.ProcessExecution {

	private _process: string;
	private _args: string[];
	private _options: vscode.ProcessExecutionOptions | undefined;

	constructor(process: string, options?: vscode.ProcessExecutionOptions);
	constructor(process: string, args: string[], options?: vscode.ProcessExecutionOptions);
	constructor(process: string, varg1?: string[] | vscode.ProcessExecutionOptions, varg2?: vscode.ProcessExecutionOptions) {
		if (typeof process !== 'string') {
			throw illegalArgument('process');
		}
		this._args = [];
		this._process = process;
		if (varg1 !== undefined) {
			if (Array.isArray(varg1)) {
				this._args = varg1;
				this._options = varg2;
			} else {
				this._options = varg1;
			}
		}
	}


	get process(): string {
		return this._process;
	}

	set process(value: string) {
		if (typeof value !== 'string') {
			throw illegalArgument('process');
		}
		this._process = value;
	}

	get args(): string[] {
		return this._args;
	}

	set args(value: string[]) {
		if (!Array.isArray(value)) {
			value = [];
		}
		this._args = value;
	}

	get options(): vscode.ProcessExecutionOptions | undefined {
		return this._options;
	}

	set options(value: vscode.ProcessExecutionOptions | undefined) {
		this._options = value;
	}

	public computeId(): string {
		const props: string[] = [];
		props.push('process');
		if (this._process !== undefined) {
			props.push(this._process);
		}
		if (this._args && this._args.length > 0) {
			for (let arg of this._args) {
				props.push(arg);
			}
		}
		return computeTaskExecutionId(props);
	}
}

@es5ClassCompat
export class ShellExecution implements vscode.ShellExecution {

	private _commandLine: string | undefined;
	private _command: string | vscode.ShellQuotedString | undefined;
	private _args: (string | vscode.ShellQuotedString)[] = [];
	private _options: vscode.ShellExecutionOptions | undefined;

	constructor(commandLine: string, options?: vscode.ShellExecutionOptions);
	constructor(command: string | vscode.ShellQuotedString, args: (string | vscode.ShellQuotedString)[], options?: vscode.ShellExecutionOptions);
	constructor(arg0: string | vscode.ShellQuotedString, arg1?: vscode.ShellExecutionOptions | (string | vscode.ShellQuotedString)[], arg2?: vscode.ShellExecutionOptions) {
		if (Array.isArray(arg1)) {
			if (!arg0) {
				throw illegalArgument('command can\'t be undefined or null');
			}
			if (typeof arg0 !== 'string' && typeof arg0.value !== 'string') {
				throw illegalArgument('command');
			}
			this._command = arg0;
			this._args = arg1 as (string | vscode.ShellQuotedString)[];
			this._options = arg2;
		} else {
			if (typeof arg0 !== 'string') {
				throw illegalArgument('commandLine');
			}
			this._commandLine = arg0;
			this._options = arg1;
		}
	}

	get commandLine(): string | undefined {
		return this._commandLine;
	}

	set commandLine(value: string | undefined) {
		if (typeof value !== 'string') {
			throw illegalArgument('commandLine');
		}
		this._commandLine = value;
	}

	get command(): string | vscode.ShellQuotedString {
		return this._command ? this._command : '';
	}

	set command(value: string | vscode.ShellQuotedString) {
		if (typeof value !== 'string' && typeof value.value !== 'string') {
			throw illegalArgument('command');
		}
		this._command = value;
	}

	get args(): (string | vscode.ShellQuotedString)[] {
		return this._args;
	}

	set args(value: (string | vscode.ShellQuotedString)[]) {
		this._args = value || [];
	}

	get options(): vscode.ShellExecutionOptions | undefined {
		return this._options;
	}

	set options(value: vscode.ShellExecutionOptions | undefined) {
		this._options = value;
	}

	public computeId(): string {
		const props: string[] = [];
		props.push('shell');
		if (this._commandLine !== undefined) {
			props.push(this._commandLine);
		}
		if (this._command !== undefined) {
			props.push(typeof this._command === 'string' ? this._command : this._command.value);
		}
		if (this._args && this._args.length > 0) {
			for (let arg of this._args) {
				props.push(typeof arg === 'string' ? arg : arg.value);
			}
		}
		return computeTaskExecutionId(props);
	}
}

export enum ShellQuoting {
	Escape = 1,
	Strong = 2,
	Weak = 3
}

export enum TaskScope {
	Global = 1,
	Workspace = 2
}

export class CustomExecution implements vscode.CustomExecution2 {
	private _callback: (resolvedDefintion?: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>;
	constructor(callback: (resolvedDefintion?: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>) {
		this._callback = callback;
	}
	public computeId(): string {
		return 'customExecution' + generateUuid();
	}

	public set callback(value: (resolvedDefintion?: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>) {
		this._callback = value;
	}

	public get callback(): ((resolvedDefintion?: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>) {
		return this._callback;
	}
}

@es5ClassCompat
export class Task implements vscode.Task2 {

	private static ExtensionCallbackType: string = 'customExecution';
	private static ProcessType: string = 'process';
	private static ShellType: string = 'shell';
	private static EmptyType: string = '$empty';

	private __id: string | undefined;
	private __deprecated: boolean = false;

	private _definition: vscode.TaskDefinition;
	private _scope: vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder | undefined;
	private _name: string;
	private _execution: ProcessExecution | ShellExecution | CustomExecution | undefined;
	private _problemMatchers: string[];
	private _hasDefinedMatchers: boolean;
	private _isBackground: boolean;
	private _source: string;
	private _group: TaskGroup | undefined;
	private _presentationOptions: vscode.TaskPresentationOptions;
	private _runOptions: vscode.RunOptions;
	private _detail: string | undefined;

	constructor(definition: vscode.TaskDefinition, name: string, source: string, execution?: ProcessExecution | ShellExecution | CustomExecution, problemMatchers?: string | string[]);
	constructor(definition: vscode.TaskDefinition, scope: vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder, name: string, source: string, execution?: ProcessExecution | ShellExecution | CustomExecution, problemMatchers?: string | string[]);
	constructor(definition: vscode.TaskDefinition, arg2: string | (vscode.TaskScope.Global | vscode.TaskScope.Workspace) | vscode.WorkspaceFolder, arg3: any, arg4?: any, arg5?: any, arg6?: any) {
		this._definition = this.definition = definition;
		let problemMatchers: string | string[];
		if (typeof arg2 === 'string') {
			this._name = this.name = arg2;
			this._source = this.source = arg3;
			this.execution = arg4;
			problemMatchers = arg5;
			this.__deprecated = true;
		} else if (arg2 === TaskScope.Global || arg2 === TaskScope.Workspace) {
			this.target = arg2;
			this._name = this.name = arg3;
			this._source = this.source = arg4;
			this.execution = arg5;
			problemMatchers = arg6;
		} else {
			this.target = arg2;
			this._name = this.name = arg3;
			this._source = this.source = arg4;
			this.execution = arg5;
			problemMatchers = arg6;
		}
		if (typeof problemMatchers === 'string') {
			this._problemMatchers = [problemMatchers];
			this._hasDefinedMatchers = true;
		} else if (Array.isArray(problemMatchers)) {
			this._problemMatchers = problemMatchers;
			this._hasDefinedMatchers = true;
		} else {
			this._problemMatchers = [];
			this._hasDefinedMatchers = false;
		}
		this._isBackground = false;
		this._presentationOptions = Object.create(null);
		this._runOptions = Object.create(null);
	}

	get _id(): string | undefined {
		return this.__id;
	}

	set _id(value: string | undefined) {
		this.__id = value;
	}

	get _deprecated(): boolean {
		return this.__deprecated;
	}

	private clear(): void {
		if (this.__id === undefined) {
			return;
		}
		this.__id = undefined;
		this._scope = undefined;
		this.computeDefinitionBasedOnExecution();
	}

	private computeDefinitionBasedOnExecution(): void {
		if (this._execution instanceof ProcessExecution) {
			this._definition = {
				type: Task.ProcessType,
				id: this._execution.computeId()
			};
		} else if (this._execution instanceof ShellExecution) {
			this._definition = {
				type: Task.ShellType,
				id: this._execution.computeId()
			};
		} else if (this._execution instanceof CustomExecution) {
			this._definition = {
				type: Task.ExtensionCallbackType,
				id: this._execution.computeId()
			};
		} else {
			this._definition = {
				type: Task.EmptyType,
				id: generateUuid()
			};
		}
	}

	get definition(): vscode.TaskDefinition {
		return this._definition;
	}

	set definition(value: vscode.TaskDefinition) {
		if (value === undefined || value === null) {
			throw illegalArgument('Kind can\'t be undefined or null');
		}
		this.clear();
		this._definition = value;
	}

	get scope(): vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder | undefined {
		return this._scope;
	}

	set target(value: vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder) {
		this.clear();
		this._scope = value;
	}

	get name(): string {
		return this._name;
	}

	set name(value: string) {
		if (typeof value !== 'string') {
			throw illegalArgument('name');
		}
		this.clear();
		this._name = value;
	}

	get execution(): ProcessExecution | ShellExecution | CustomExecution | undefined {
		return this._execution;
	}

	set execution(value: ProcessExecution | ShellExecution | CustomExecution | undefined) {
		if (value === null) {
			value = undefined;
		}
		this.clear();
		this._execution = value;
		const type = this._definition.type;
		if (Task.EmptyType === type || Task.ProcessType === type || Task.ShellType === type || Task.ExtensionCallbackType === type) {
			this.computeDefinitionBasedOnExecution();
		}
	}

	get problemMatchers(): string[] {
		return this._problemMatchers;
	}

	set problemMatchers(value: string[]) {
		if (!Array.isArray(value)) {
			this.clear();
			this._problemMatchers = [];
			this._hasDefinedMatchers = false;
			return;
		} else {
			this.clear();
			this._problemMatchers = value;
			this._hasDefinedMatchers = true;
		}
	}

	get hasDefinedMatchers(): boolean {
		return this._hasDefinedMatchers;
	}

	get isBackground(): boolean {
		return this._isBackground;
	}

	set isBackground(value: boolean) {
		if (value !== true && value !== false) {
			value = false;
		}
		this.clear();
		this._isBackground = value;
	}

	get source(): string {
		return this._source;
	}

	set source(value: string) {
		if (typeof value !== 'string' || value.length === 0) {
			throw illegalArgument('source must be a string of length > 0');
		}
		this.clear();
		this._source = value;
	}

	get group(): TaskGroup | undefined {
		return this._group;
	}

	set group(value: TaskGroup | undefined) {
		if (value === null) {
			value = undefined;
		}
		this.clear();
		this._group = value;
	}

	get detail(): string | undefined {
		return this._detail;
	}

	set detail(value: string | undefined) {
		if (value === null) {
			value = undefined;
		}
		this._detail = value;
	}

	get presentationOptions(): vscode.TaskPresentationOptions {
		return this._presentationOptions;
	}

	set presentationOptions(value: vscode.TaskPresentationOptions) {
		if (value === null || value === undefined) {
			value = Object.create(null);
		}
		this.clear();
		this._presentationOptions = value;
	}

	get runOptions(): vscode.RunOptions {
		return this._runOptions;
	}

	set runOptions(value: vscode.RunOptions) {
		if (value === null || value === undefined) {
			value = Object.create(null);
		}
		this.clear();
		this._runOptions = value;
	}
}


export enum ProgressLocation {
	SourceControl = 1,
	Window = 10,
	Notification = 15
}

@es5ClassCompat
export class TreeItem {

	label?: string | vscode.TreeItemLabel;
	resourceUri?: URI;
	iconPath?: string | URI | { light: string | URI; dark: string | URI; };
	command?: vscode.Command;
	contextValue?: string;
	tooltip?: string;

	constructor(label: string | vscode.TreeItemLabel, collapsibleState?: vscode.TreeItemCollapsibleState);
	constructor(resourceUri: URI, collapsibleState?: vscode.TreeItemCollapsibleState);
	constructor(arg1: string | vscode.TreeItemLabel | URI, public collapsibleState: vscode.TreeItemCollapsibleState = TreeItemCollapsibleState.None) {
		if (URI.isUri(arg1)) {
			this.resourceUri = arg1;
		} else {
			this.label = arg1;
		}
	}

}

export enum TreeItemCollapsibleState {
	None = 0,
	Collapsed = 1,
	Expanded = 2
}

@es5ClassCompat
export class ThemeIcon {

	static File: ThemeIcon;
	static Folder: ThemeIcon;

	readonly id: string;

	constructor(id: string) {
		this.id = id;
	}
}
ThemeIcon.File = new ThemeIcon('file');
ThemeIcon.Folder = new ThemeIcon('folder');


@es5ClassCompat
export class ThemeColor {
	id: string;
	constructor(id: string) {
		this.id = id;
	}
}

export enum ConfigurationTarget {
	Global = 1,

	Workspace = 2,

	WorkspaceFolder = 3
}

@es5ClassCompat
export class RelativePattern implements IRelativePattern {
	base: string;
	baseFolder?: URI;

	pattern: string;

	constructor(base: vscode.WorkspaceFolder | string, pattern: string) {
		if (typeof base !== 'string') {
			if (!base || !URI.isUri(base.uri)) {
				throw illegalArgument('base');
			}
		}

		if (typeof pattern !== 'string') {
			throw illegalArgument('pattern');
		}

		if (typeof base === 'string') {
			this.base = base;
		} else {
			this.baseFolder = base.uri;
			this.base = base.uri.fsPath;
		}

		this.pattern = pattern;
	}
}

@es5ClassCompat
export class Breakpoint {

	private _id: string | undefined;

	readonly enabled: boolean;
	readonly condition?: string;
	readonly hitCondition?: string;
	readonly logMessage?: string;

	protected constructor(enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string) {
		this.enabled = typeof enabled === 'boolean' ? enabled : true;
		if (typeof condition === 'string') {
			this.condition = condition;
		}
		if (typeof hitCondition === 'string') {
			this.hitCondition = hitCondition;
		}
		if (typeof logMessage === 'string') {
			this.logMessage = logMessage;
		}
	}

	get id(): string {
		if (!this._id) {
			this._id = generateUuid();
		}
		return this._id;
	}
}

@es5ClassCompat
export class SourceBreakpoint extends Breakpoint {
	readonly location: Location;

	constructor(location: Location, enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string) {
		super(enabled, condition, hitCondition, logMessage);
		if (location === null) {
			throw illegalArgument('location');
		}
		this.location = location;
	}
}

@es5ClassCompat
export class FunctionBreakpoint extends Breakpoint {
	readonly functionName: string;

	constructor(functionName: string, enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string) {
		super(enabled, condition, hitCondition, logMessage);
		if (!functionName) {
			throw illegalArgument('functionName');
		}
		this.functionName = functionName;
	}
}

@es5ClassCompat
export class DataBreakpoint extends Breakpoint {
	readonly label: string;
	readonly dataId: string;
	readonly canPersist: boolean;

	constructor(label: string, dataId: string, canPersist: boolean, enabled?: boolean, condition?: string, hitCondition?: string, logMessage?: string) {
		super(enabled, condition, hitCondition, logMessage);
		if (!dataId) {
			throw illegalArgument('dataId');
		}
		this.label = label;
		this.dataId = dataId;
		this.canPersist = canPersist;
	}
}


@es5ClassCompat
export class DebugAdapterExecutable implements vscode.DebugAdapterExecutable {
	readonly command: string;
	readonly args: string[];
	readonly options?: vscode.DebugAdapterExecutableOptions;

	constructor(command: string, args: string[], options?: vscode.DebugAdapterExecutableOptions) {
		this.command = command;
		this.args = args || [];
		this.options = options;
	}
}

@es5ClassCompat
export class DebugAdapterServer implements vscode.DebugAdapterServer {
	readonly port: number;
	readonly host?: string;

	constructor(port: number, host?: string) {
		this.port = port;
		this.host = host;
	}
}

@es5ClassCompat
export class DebugAdapterInlineImplementation implements vscode.DebugAdapterInlineImplementation {
	readonly implementation: vscode.DebugAdapter;

	constructor(impl: vscode.DebugAdapter) {
		this.implementation = impl;
	}
}

@es5ClassCompat
export class EvaluatableExpression implements vscode.EvaluatableExpression {
	readonly range: vscode.Range;
	readonly expression?: string;

	constructor(range: vscode.Range, expression?: string) {
		this.range = range;
		this.expression = expression;
	}
}

export enum LogLevel {
	Trace = 1,
	Debug = 2,
	Info = 3,
	Warning = 4,
	Error = 5,
	Critical = 6,
	Off = 7
}

//#region file api

export enum FileChangeType {
	Changed = 1,
	Created = 2,
	Deleted = 3,
}

@es5ClassCompat
export class FileSystemError extends Error {

	static FileExists(messageOrUri?: string | URI): FileSystemError {
		return new FileSystemError(messageOrUri, FileSystemProviderErrorCode.FileExists, FileSystemError.FileExists);
	}
	static FileNotFound(messageOrUri?: string | URI): FileSystemError {
		return new FileSystemError(messageOrUri, FileSystemProviderErrorCode.FileNotFound, FileSystemError.FileNotFound);
	}
	static FileNotADirectory(messageOrUri?: string | URI): FileSystemError {
		return new FileSystemError(messageOrUri, FileSystemProviderErrorCode.FileNotADirectory, FileSystemError.FileNotADirectory);
	}
	static FileIsADirectory(messageOrUri?: string | URI): FileSystemError {
		return new FileSystemError(messageOrUri, FileSystemProviderErrorCode.FileIsADirectory, FileSystemError.FileIsADirectory);
	}
	static NoPermissions(messageOrUri?: string | URI): FileSystemError {
		return new FileSystemError(messageOrUri, FileSystemProviderErrorCode.NoPermissions, FileSystemError.NoPermissions);
	}
	static Unavailable(messageOrUri?: string | URI): FileSystemError {
		return new FileSystemError(messageOrUri, FileSystemProviderErrorCode.Unavailable, FileSystemError.Unavailable);
	}

	readonly code: string;

	constructor(uriOrMessage?: string | URI, code: FileSystemProviderErrorCode = FileSystemProviderErrorCode.Unknown, terminator?: Function) {
		super(URI.isUri(uriOrMessage) ? uriOrMessage.toString(true) : uriOrMessage);

		this.code = terminator?.name ?? 'Unknown';

		// mark the error as file system provider error so that
		// we can extract the error code on the receiving side
		markAsFileSystemProviderError(this, code);

		// workaround when extending builtin objects and when compiling to ES5, see:
		// https://github.com/Microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
		if (typeof (<any>Object).setPrototypeOf === 'function') {
			(<any>Object).setPrototypeOf(this, FileSystemError.prototype);
		}

		if (typeof Error.captureStackTrace === 'function' && typeof terminator === 'function') {
			// nice stack traces
			Error.captureStackTrace(this, terminator);
		}
	}
}

//#endregion

//#region folding api

@es5ClassCompat
export class FoldingRange {

	start: number;

	end: number;

	kind?: FoldingRangeKind;

	constructor(start: number, end: number, kind?: FoldingRangeKind) {
		this.start = start;
		this.end = end;
		this.kind = kind;
	}
}

export enum FoldingRangeKind {
	Comment = 1,
	Imports = 2,
	Region = 3
}

//#endregion

//#region Comment
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

export enum CommentMode {
	Editing = 0,
	Preview = 1
}

//#endregion

//#region Semantic Coloring

export class SemanticTokensLegend {
	public readonly tokenTypes: string[];
	public readonly tokenModifiers: string[];

	constructor(tokenTypes: string[], tokenModifiers: string[] = []) {
		this.tokenTypes = tokenTypes;
		this.tokenModifiers = tokenModifiers;
	}
}

function isStrArrayOrUndefined(arg: any): arg is string[] | undefined {
	return ((typeof arg === 'undefined') || isStringArray(arg));
}

export class SemanticTokensBuilder {

	private _prevLine: number;
	private _prevChar: number;
	private _dataIsSortedAndDeltaEncoded: boolean;
	private _data: number[];
	private _dataLen: number;
	private _tokenTypeStrToInt: Map<string, number>;
	private _tokenModifierStrToInt: Map<string, number>;
	private _hasLegend: boolean;

	constructor(legend?: vscode.SemanticTokensLegend) {
		this._prevLine = 0;
		this._prevChar = 0;
		this._dataIsSortedAndDeltaEncoded = true;
		this._data = [];
		this._dataLen = 0;
		this._tokenTypeStrToInt = new Map<string, number>();
		this._tokenModifierStrToInt = new Map<string, number>();
		this._hasLegend = false;
		if (legend) {
			this._hasLegend = true;
			for (let i = 0, len = legend.tokenTypes.length; i < len; i++) {
				this._tokenTypeStrToInt.set(legend.tokenTypes[i], i);
			}
			for (let i = 0, len = legend.tokenModifiers.length; i < len; i++) {
				this._tokenModifierStrToInt.set(legend.tokenModifiers[i], i);
			}
		}
	}

	public push(line: number, char: number, length: number, tokenType: number, tokenModifiers?: number): void;
	public push(range: Range, tokenType: string, tokenModifiers?: string[]): void;
	public push(arg0: any, arg1: any, arg2: any, arg3?: any, arg4?: any): void {
		if (typeof arg0 === 'number' && typeof arg1 === 'number' && typeof arg2 === 'number' && typeof arg3 === 'number' && (typeof arg4 === 'number' || typeof arg4 === 'undefined')) {
			if (typeof arg4 === 'undefined') {
				arg4 = 0;
			}
			// 1st overload
			return this._pushEncoded(arg0, arg1, arg2, arg3, arg4);
		}
		if (Range.isRange(arg0) && typeof arg1 === 'string' && isStrArrayOrUndefined(arg2)) {
			// 2nd overload
			return this._push(arg0, arg1, arg2);
		}
		throw illegalArgument();
	}

	private _push(range: vscode.Range, tokenType: string, tokenModifiers?: string[]): void {
		if (!this._hasLegend) {
			throw new Error('Legend must be provided in constructor');
		}
		if (range.start.line !== range.end.line) {
			throw new Error('`range` cannot span multiple lines');
		}
		if (!this._tokenTypeStrToInt.has(tokenType)) {
			throw new Error('`tokenType` is not in the provided legend');
		}
		const line = range.start.line;
		const char = range.start.character;
		const length = range.end.character - range.start.character;
		const nTokenType = this._tokenTypeStrToInt.get(tokenType)!;
		let nTokenModifiers = 0;
		if (tokenModifiers) {
			for (const tokenModifier of tokenModifiers) {
				if (!this._tokenModifierStrToInt.has(tokenModifier)) {
					throw new Error('`tokenModifier` is not in the provided legend');
				}
				const nTokenModifier = this._tokenModifierStrToInt.get(tokenModifier)!;
				nTokenModifiers |= (1 << nTokenModifier) >>> 0;
			}
		}
		this._pushEncoded(line, char, length, nTokenType, nTokenModifiers);
	}

	private _pushEncoded(line: number, char: number, length: number, tokenType: number, tokenModifiers: number): void {
		if (this._dataIsSortedAndDeltaEncoded && (line < this._prevLine || (line === this._prevLine && char < this._prevChar))) {
			// push calls were ordered and are no longer ordered
			this._dataIsSortedAndDeltaEncoded = false;

			// Remove delta encoding from data
			const tokenCount = (this._data.length / 5) | 0;
			let prevLine = 0;
			let prevChar = 0;
			for (let i = 0; i < tokenCount; i++) {
				let line = this._data[5 * i];
				let char = this._data[5 * i + 1];

				if (line === 0) {
					// on the same line as previous token
					line = prevLine;
					char += prevChar;
				} else {
					// on a different line than previous token
					line += prevLine;
				}

				this._data[5 * i] = line;
				this._data[5 * i + 1] = char;

				prevLine = line;
				prevChar = char;
			}
		}

		let pushLine = line;
		let pushChar = char;
		if (this._dataIsSortedAndDeltaEncoded && this._dataLen > 0) {
			pushLine -= this._prevLine;
			if (pushLine === 0) {
				pushChar -= this._prevChar;
			}
		}

		this._data[this._dataLen++] = pushLine;
		this._data[this._dataLen++] = pushChar;
		this._data[this._dataLen++] = length;
		this._data[this._dataLen++] = tokenType;
		this._data[this._dataLen++] = tokenModifiers;

		this._prevLine = line;
		this._prevChar = char;
	}

	private static _sortAndDeltaEncode(data: number[]): Uint32Array {
		let pos: number[] = [];
		const tokenCount = (data.length / 5) | 0;
		for (let i = 0; i < tokenCount; i++) {
			pos[i] = i;
		}
		pos.sort((a, b) => {
			const aLine = data[5 * a];
			const bLine = data[5 * b];
			if (aLine === bLine) {
				const aChar = data[5 * a + 1];
				const bChar = data[5 * b + 1];
				return aChar - bChar;
			}
			return aLine - bLine;
		});
		const result = new Uint32Array(data.length);
		let prevLine = 0;
		let prevChar = 0;
		for (let i = 0; i < tokenCount; i++) {
			const srcOffset = 5 * pos[i];
			const line = data[srcOffset + 0];
			const char = data[srcOffset + 1];
			const length = data[srcOffset + 2];
			const tokenType = data[srcOffset + 3];
			const tokenModifiers = data[srcOffset + 4];

			const pushLine = line - prevLine;
			const pushChar = (pushLine === 0 ? char - prevChar : char);

			const dstOffset = 5 * i;
			result[dstOffset + 0] = pushLine;
			result[dstOffset + 1] = pushChar;
			result[dstOffset + 2] = length;
			result[dstOffset + 3] = tokenType;
			result[dstOffset + 4] = tokenModifiers;

			prevLine = line;
			prevChar = char;
		}

		return result;
	}

	public build(resultId?: string): SemanticTokens {
		if (!this._dataIsSortedAndDeltaEncoded) {
			return new SemanticTokens(SemanticTokensBuilder._sortAndDeltaEncode(this._data), resultId);
		}
		return new SemanticTokens(new Uint32Array(this._data), resultId);
	}
}

export class SemanticTokens {
	readonly resultId?: string;
	readonly data: Uint32Array;

	constructor(data: Uint32Array, resultId?: string) {
		this.resultId = resultId;
		this.data = data;
	}
}

export class SemanticTokensEdit {
	readonly start: number;
	readonly deleteCount: number;
	readonly data?: Uint32Array;

	constructor(start: number, deleteCount: number, data?: Uint32Array) {
		this.start = start;
		this.deleteCount = deleteCount;
		this.data = data;
	}
}

export class SemanticTokensEdits {
	readonly resultId?: string;
	readonly edits: SemanticTokensEdit[];

	constructor(edits: SemanticTokensEdit[], resultId?: string) {
		this.resultId = resultId;
		this.edits = edits;
	}
}

//#endregion

//#region debug
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

//#endregion

@es5ClassCompat
export class QuickInputButtons {

	static readonly Back: vscode.QuickInputButton = { iconPath: 'back.svg' };

	private constructor() { }
}

export enum ExtensionKind {
	UI = 1,
	Workspace = 2
}

export class Decoration {

	static validate(d: Decoration): void {
		if (d.letter && d.letter.length !== 1) {
			throw new Error(`The 'letter'-property must be undefined or a single character`);
		}
		if (!d.bubble && !d.color && !d.letter && !d.priority && !d.title) {
			throw new Error(`The decoration is empty`);
		}
	}

	letter?: string;
	title?: string;
	color?: vscode.ThemeColor;
	priority?: number;
	bubble?: boolean;
}

//#region Theming

@es5ClassCompat
export class ColorTheme implements vscode.ColorTheme {
	constructor(public readonly kind: ColorThemeKind) {
	}
}

export enum ColorThemeKind {
	Light = 1,
	Dark = 2,
	HighContrast = 3
}

//#endregion Theming

//#region Notebook

export enum CellKind {
	Markdown = 1,
	Code = 2
}

export enum CellOutputKind {
	Text = 1,
	Error = 2,
	Rich = 3
}

export enum NotebookCellRunState {
	Running = 1,
	Idle = 2,
	Success = 3,
	Error = 4
}

//#endregion

//#region Timeline

@es5ClassCompat
export class TimelineItem implements vscode.TimelineItem {
	constructor(public label: string, public timestamp: number) { }
}

//#endregion Timeline

//#region ExtensionContext

export enum ExtensionMode {
	/**
	 * The extension is installed normally (for example, from the marketplace
	 * or VSIX) in VS Code.
	 */
	Release = 1,

	/**
	 * The extension is running from an `--extensionDevelopmentPath` provided
	 * when launching VS Code.
	 */
	Development = 2,

	/**
	 * The extension is running from an `--extensionDevelopmentPath` and
	 * the extension host is running unit tests.
	 */
	Test = 3,
}

//#endregion ExtensionContext
