/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ok } from 'vs/base/common/assert';
import { illegalArgument, readonly } from 'vs/base/common/errors';
import { IdGenerator } from 'vs/base/common/idGenerator';
import { TextEditorCursorStyle } from 'vs/editor/common/config/editorOptions';
import { IRange } from 'vs/editor/common/core/range';
import { ISingleEditOperation } from 'vs/editor/common/model';
import { IResolvedTextEditorConfiguration, ITextEditorConfigurationUpdate, MainThreadTextEditorsShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostDocumentData } from 'vs/workbench/api/common/extHostDocumentData';
import * as TypeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { EndOfLine, Position, Range, Selection, SnippetString, TextEditorLineNumbersStyle, TextEditorRevealType } from 'vs/workbench/api/common/extHostTypes';
import type * as vscode from 'vscode';
import { ILogService } from 'vs/platform/log/common/log';

export class TextEditorDecorationType implements vscode.TextEditorDecorationType {

	private static readonly _Keys = new IdGenerator('TextEditorDecorationType');

	private _proxy: MainThreadTextEditorsShape;
	public key: string;

	constructor(proxy: MainThreadTextEditorsShape, options: vscode.DecorationRenderOptions) {
		this.key = TextEditorDecorationType._Keys.nextId();
		this._proxy = proxy;
		this._proxy.$registerTextEditorDecorationType(this.key, TypeConverters.DecorationRenderOptions.from(options));
	}

	public dispose(): void {
		this._proxy.$removeTextEditorDecorationType(this.key);
	}
}

export interface ITextEditOperation {
	range: vscode.Range;
	text: string | null;
	forceMoveMarkers: boolean;
}

export interface IEditData {
	documentVersionId: number;
	edits: ITextEditOperation[];
	setEndOfLine: EndOfLine | undefined;
	undoStopBefore: boolean;
	undoStopAfter: boolean;
}

export class TextEditorEdit {

	private readonly _document: vscode.TextDocument;
	private readonly _documentVersionId: number;
	private readonly _undoStopBefore: boolean;
	private readonly _undoStopAfter: boolean;
	private _collectedEdits: ITextEditOperation[] = [];
	private _setEndOfLine: EndOfLine | undefined = undefined;
	private _finalized: boolean = false;

	constructor(document: vscode.TextDocument, options: { undoStopBefore: boolean; undoStopAfter: boolean; }) {
		this._document = document;
		this._documentVersionId = document.version;
		this._undoStopBefore = options.undoStopBefore;
		this._undoStopAfter = options.undoStopAfter;
	}

	finalize(): IEditData {
		this._finalized = true;
		return {
			documentVersionId: this._documentVersionId,
			edits: this._collectedEdits,
			setEndOfLine: this._setEndOfLine,
			undoStopBefore: this._undoStopBefore,
			undoStopAfter: this._undoStopAfter
		};
	}

	private _throwIfFinalized() {
		if (this._finalized) {
			throw new Error('Edit is only valid while callback runs');
		}
	}

	replace(location: Position | Range | Selection, value: string): void {
		this._throwIfFinalized();
		let range: Range | null = null;

		if (location instanceof Position) {
			range = new Range(location, location);
		} else if (location instanceof Range) {
			range = location;
		} else {
			throw new Error('Unrecognized location');
		}

		this._pushEdit(range, value, false);
	}

	insert(location: Position, value: string): void {
		this._throwIfFinalized();
		this._pushEdit(new Range(location, location), value, true);
	}

	delete(location: Range | Selection): void {
		this._throwIfFinalized();
		let range: Range | null = null;

		if (location instanceof Range) {
			range = location;
		} else {
			throw new Error('Unrecognized location');
		}

		this._pushEdit(range, null, true);
	}

	private _pushEdit(range: Range, text: string | null, forceMoveMarkers: boolean): void {
		const validRange = this._document.validateRange(range);
		this._collectedEdits.push({
			range: validRange,
			text: text,
			forceMoveMarkers: forceMoveMarkers
		});
	}

	setEndOfLine(endOfLine: EndOfLine): void {
		this._throwIfFinalized();
		if (endOfLine !== EndOfLine.LF && endOfLine !== EndOfLine.CRLF) {
			throw illegalArgument('endOfLine');
		}

		this._setEndOfLine = endOfLine;
	}
}

export class ExtHostTextEditorOptions implements vscode.TextEditorOptions {

	private _proxy: MainThreadTextEditorsShape;
	private _id: string;
	private _logService: ILogService;

	private _tabSize!: number;
	private _indentSize!: number;
	private _insertSpaces!: boolean;
	private _cursorStyle!: TextEditorCursorStyle;
	private _lineNumbers!: TextEditorLineNumbersStyle;

	constructor(proxy: MainThreadTextEditorsShape, id: string, source: IResolvedTextEditorConfiguration, logService: ILogService) {
		this._proxy = proxy;
		this._id = id;
		this._accept(source);
		this._logService = logService;
	}

	public _accept(source: IResolvedTextEditorConfiguration): void {
		this._tabSize = source.tabSize;
		this._indentSize = source.indentSize;
		this._insertSpaces = source.insertSpaces;
		this._cursorStyle = source.cursorStyle;
		this._lineNumbers = TypeConverters.TextEditorLineNumbersStyle.to(source.lineNumbers);
	}

	public get tabSize(): number | string {
		return this._tabSize;
	}

	private _validateTabSize(value: number | string): number | 'auto' | null {
		if (value === 'auto') {
			return 'auto';
		}
		if (typeof value === 'number') {
			const r = Math.floor(value);
			return (r > 0 ? r : null);
		}
		if (typeof value === 'string') {
			const r = parseInt(value, 10);
			if (isNaN(r)) {
				return null;
			}
			return (r > 0 ? r : null);
		}
		return null;
	}

	public set tabSize(value: number | string) {
		const tabSize = this._validateTabSize(value);
		if (tabSize === null) {
			// ignore invalid call
			return;
		}
		if (typeof tabSize === 'number') {
			if (this._tabSize === tabSize) {
				// nothing to do
				return;
			}
			// reflect the new tabSize value immediately
			this._tabSize = tabSize;
		}
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			tabSize: tabSize
		}));
	}

	public get indentSize(): number | string {
		return this._indentSize;
	}

	private _validateIndentSize(value: number | string): number | 'tabSize' | null {
		if (value === 'tabSize') {
			return 'tabSize';
		}
		if (typeof value === 'number') {
			const r = Math.floor(value);
			return (r > 0 ? r : null);
		}
		if (typeof value === 'string') {
			const r = parseInt(value, 10);
			if (isNaN(r)) {
				return null;
			}
			return (r > 0 ? r : null);
		}
		return null;
	}

	public set indentSize(value: number | string) {
		const indentSize = this._validateIndentSize(value);
		if (indentSize === null) {
			// ignore invalid call
			return;
		}
		if (typeof indentSize === 'number') {
			if (this._indentSize === indentSize) {
				// nothing to do
				return;
			}
			// reflect the new indentSize value immediately
			this._indentSize = indentSize;
		}
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			indentSize: indentSize
		}));
	}

	public get insertSpaces(): boolean | string {
		return this._insertSpaces;
	}

	private _validateInsertSpaces(value: boolean | string): boolean | 'auto' {
		if (value === 'auto') {
			return 'auto';
		}
		return (value === 'false' ? false : Boolean(value));
	}

	public set insertSpaces(value: boolean | string) {
		const insertSpaces = this._validateInsertSpaces(value);
		if (typeof insertSpaces === 'boolean') {
			if (this._insertSpaces === insertSpaces) {
				// nothing to do
				return;
			}
			// reflect the new insertSpaces value immediately
			this._insertSpaces = insertSpaces;
		}
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			insertSpaces: insertSpaces
		}));
	}

	public get cursorStyle(): TextEditorCursorStyle {
		return this._cursorStyle;
	}

	public set cursorStyle(value: TextEditorCursorStyle) {
		if (this._cursorStyle === value) {
			// nothing to do
			return;
		}
		this._cursorStyle = value;
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			cursorStyle: value
		}));
	}

	public get lineNumbers(): TextEditorLineNumbersStyle {
		return this._lineNumbers;
	}

	public set lineNumbers(value: TextEditorLineNumbersStyle) {
		if (this._lineNumbers === value) {
			// nothing to do
			return;
		}
		this._lineNumbers = value;
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			lineNumbers: TypeConverters.TextEditorLineNumbersStyle.from(value)
		}));
	}

	public assign(newOptions: vscode.TextEditorOptions) {
		const bulkConfigurationUpdate: ITextEditorConfigurationUpdate = {};
		let hasUpdate = false;

		if (typeof newOptions.tabSize !== 'undefined') {
			const tabSize = this._validateTabSize(newOptions.tabSize);
			if (tabSize === 'auto') {
				hasUpdate = true;
				bulkConfigurationUpdate.tabSize = tabSize;
			} else if (typeof tabSize === 'number' && this._tabSize !== tabSize) {
				// reflect the new tabSize value immediately
				this._tabSize = tabSize;
				hasUpdate = true;
				bulkConfigurationUpdate.tabSize = tabSize;
			}
		}

		// if (typeof newOptions.indentSize !== 'undefined') {
		// 	const indentSize = this._validateIndentSize(newOptions.indentSize);
		// 	if (indentSize === 'tabSize') {
		// 		hasUpdate = true;
		// 		bulkConfigurationUpdate.indentSize = indentSize;
		// 	} else if (typeof indentSize === 'number' && this._indentSize !== indentSize) {
		// 		// reflect the new indentSize value immediately
		// 		this._indentSize = indentSize;
		// 		hasUpdate = true;
		// 		bulkConfigurationUpdate.indentSize = indentSize;
		// 	}
		// }

		if (typeof newOptions.insertSpaces !== 'undefined') {
			const insertSpaces = this._validateInsertSpaces(newOptions.insertSpaces);
			if (insertSpaces === 'auto') {
				hasUpdate = true;
				bulkConfigurationUpdate.insertSpaces = insertSpaces;
			} else if (this._insertSpaces !== insertSpaces) {
				// reflect the new insertSpaces value immediately
				this._insertSpaces = insertSpaces;
				hasUpdate = true;
				bulkConfigurationUpdate.insertSpaces = insertSpaces;
			}
		}

		if (typeof newOptions.cursorStyle !== 'undefined') {
			if (this._cursorStyle !== newOptions.cursorStyle) {
				this._cursorStyle = newOptions.cursorStyle;
				hasUpdate = true;
				bulkConfigurationUpdate.cursorStyle = newOptions.cursorStyle;
			}
		}

		if (typeof newOptions.lineNumbers !== 'undefined') {
			if (this._lineNumbers !== newOptions.lineNumbers) {
				this._lineNumbers = newOptions.lineNumbers;
				hasUpdate = true;
				bulkConfigurationUpdate.lineNumbers = TypeConverters.TextEditorLineNumbersStyle.from(newOptions.lineNumbers);
			}
		}

		if (hasUpdate) {
			this._warnOnError(this._proxy.$trySetOptions(this._id, bulkConfigurationUpdate));
		}
	}

	private _warnOnError(promise: Promise<any>): void {
		promise.catch(err => this._logService.warn(err));
	}
}

export class ExtHostTextEditor implements vscode.TextEditor {

	private readonly _documentData: ExtHostDocumentData;

	private _selections: Selection[];
	private _options: ExtHostTextEditorOptions;
	private _visibleRanges: Range[];
	private _viewColumn: vscode.ViewColumn | undefined;
	private _disposed: boolean = false;
	private _hasDecorationsForKey: { [key: string]: boolean; };

	constructor(
		readonly id: string,
		private readonly _proxy: MainThreadTextEditorsShape,
		private readonly _logService: ILogService,
		document: ExtHostDocumentData,
		selections: Selection[], options: IResolvedTextEditorConfiguration,
		visibleRanges: Range[], viewColumn: vscode.ViewColumn | undefined
	) {
		this._documentData = document;
		this._selections = selections;
		this._options = new ExtHostTextEditorOptions(this._proxy, this.id, options, _logService);
		this._visibleRanges = visibleRanges;
		this._viewColumn = viewColumn;
		this._hasDecorationsForKey = Object.create(null);
	}

	dispose() {
		ok(!this._disposed);
		this._disposed = true;
	}

	show(column: vscode.ViewColumn) {
		this._proxy.$tryShowEditor(this.id, TypeConverters.ViewColumn.from(column));
	}

	hide() {
		this._proxy.$tryHideEditor(this.id);
	}

	// ---- the document

	get document(): vscode.TextDocument {
		return this._documentData.document;
	}

	set document(value) {
		throw readonly('document');
	}

	// ---- options

	get options(): vscode.TextEditorOptions {
		return this._options;
	}

	set options(value: vscode.TextEditorOptions) {
		if (!this._disposed) {
			this._options.assign(value);
		}
	}

	_acceptOptions(options: IResolvedTextEditorConfiguration): void {
		ok(!this._disposed);
		this._options._accept(options);
	}

	// ---- visible ranges

	get visibleRanges(): Range[] {
		return this._visibleRanges;
	}

	set visibleRanges(value: Range[]) {
		throw readonly('visibleRanges');
	}

	_acceptVisibleRanges(value: Range[]): void {
		ok(!this._disposed);
		this._visibleRanges = value;
	}

	// ---- view column

	get viewColumn(): vscode.ViewColumn | undefined {
		return this._viewColumn;
	}

	set viewColumn(value) {
		throw readonly('viewColumn');
	}

	_acceptViewColumn(value: vscode.ViewColumn) {
		ok(!this._disposed);
		this._viewColumn = value;
	}

	// ---- selections

	get selection(): Selection {
		return this._selections && this._selections[0];
	}

	set selection(value: Selection) {
		if (!(value instanceof Selection)) {
			throw illegalArgument('selection');
		}
		this._selections = [value];
		this._trySetSelection();
	}

	get selections(): Selection[] {
		return this._selections;
	}

	set selections(value: Selection[]) {
		if (!Array.isArray(value) || value.some(a => !(a instanceof Selection))) {
			throw illegalArgument('selections');
		}
		this._selections = value;
		this._trySetSelection();
	}

	setDecorations(decorationType: vscode.TextEditorDecorationType, ranges: Range[] | vscode.DecorationOptions[]): void {
		const willBeEmpty = (ranges.length === 0);
		if (willBeEmpty && !this._hasDecorationsForKey[decorationType.key]) {
			// avoid no-op call to the renderer
			return;
		}
		if (willBeEmpty) {
			delete this._hasDecorationsForKey[decorationType.key];
		} else {
			this._hasDecorationsForKey[decorationType.key] = true;
		}
		this._runOnProxy(
			() => {
				if (TypeConverters.isDecorationOptionsArr(ranges)) {
					return this._proxy.$trySetDecorations(
						this.id,
						decorationType.key,
						TypeConverters.fromRangeOrRangeWithMessage(ranges)
					);
				} else {
					const _ranges: number[] = new Array<number>(4 * ranges.length);
					for (let i = 0, len = ranges.length; i < len; i++) {
						const range = ranges[i];
						_ranges[4 * i] = range.start.line + 1;
						_ranges[4 * i + 1] = range.start.character + 1;
						_ranges[4 * i + 2] = range.end.line + 1;
						_ranges[4 * i + 3] = range.end.character + 1;
					}
					return this._proxy.$trySetDecorationsFast(
						this.id,
						decorationType.key,
						_ranges
					);
				}
			}
		);
	}

	revealRange(range: Range, revealType: vscode.TextEditorRevealType): void {
		this._runOnProxy(
			() => this._proxy.$tryRevealRange(
				this.id,
				TypeConverters.Range.from(range),
				(revealType || TextEditorRevealType.Default)
			)
		);
	}

	private _trySetSelection(): Promise<vscode.TextEditor | null | undefined> {
		const selection = this._selections.map(TypeConverters.Selection.from);
		return this._runOnProxy(() => this._proxy.$trySetSelections(this.id, selection));
	}

	_acceptSelections(selections: Selection[]): void {
		ok(!this._disposed);
		this._selections = selections;
	}

	// ---- editing

	edit(callback: (edit: TextEditorEdit) => void, options: { undoStopBefore: boolean; undoStopAfter: boolean; } = { undoStopBefore: true, undoStopAfter: true }): Promise<boolean> {
		if (this._disposed) {
			return Promise.reject(new Error('TextEditor#edit not possible on closed editors'));
		}
		const edit = new TextEditorEdit(this._documentData.document, options);
		callback(edit);
		return this._applyEdit(edit);
	}

	private _applyEdit(editBuilder: TextEditorEdit): Promise<boolean> {
		const editData = editBuilder.finalize();

		// return when there is nothing to do
		if (editData.edits.length === 0 && !editData.setEndOfLine) {
			return Promise.resolve(true);
		}

		// check that the edits are not overlapping (i.e. illegal)
		const editRanges = editData.edits.map(edit => edit.range);

		// sort ascending (by end and then by start)
		editRanges.sort((a, b) => {
			if (a.end.line === b.end.line) {
				if (a.end.character === b.end.character) {
					if (a.start.line === b.start.line) {
						return a.start.character - b.start.character;
					}
					return a.start.line - b.start.line;
				}
				return a.end.character - b.end.character;
			}
			return a.end.line - b.end.line;
		});

		// check that no edits are overlapping
		for (let i = 0, count = editRanges.length - 1; i < count; i++) {
			const rangeEnd = editRanges[i].end;
			const nextRangeStart = editRanges[i + 1].start;

			if (nextRangeStart.isBefore(rangeEnd)) {
				// overlapping ranges
				return Promise.reject(
					new Error('Overlapping ranges are not allowed!')
				);
			}
		}

		// prepare data for serialization
		const edits = editData.edits.map((edit): ISingleEditOperation => {
			return {
				range: TypeConverters.Range.from(edit.range),
				text: edit.text,
				forceMoveMarkers: edit.forceMoveMarkers
			};
		});

		return this._proxy.$tryApplyEdits(this.id, editData.documentVersionId, edits, {
			setEndOfLine: typeof editData.setEndOfLine === 'number' ? TypeConverters.EndOfLine.from(editData.setEndOfLine) : undefined,
			undoStopBefore: editData.undoStopBefore,
			undoStopAfter: editData.undoStopAfter
		});
	}

	insertSnippet(snippet: SnippetString, where?: Position | readonly Position[] | Range | readonly Range[], options: { undoStopBefore: boolean; undoStopAfter: boolean; } = { undoStopBefore: true, undoStopAfter: true }): Promise<boolean> {
		if (this._disposed) {
			return Promise.reject(new Error('TextEditor#insertSnippet not possible on closed editors'));
		}
		let ranges: IRange[];

		if (!where || (Array.isArray(where) && where.length === 0)) {
			ranges = this._selections.map(range => TypeConverters.Range.from(range));

		} else if (where instanceof Position) {
			const { lineNumber, column } = TypeConverters.Position.from(where);
			ranges = [{ startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column }];

		} else if (where instanceof Range) {
			ranges = [TypeConverters.Range.from(where)];
		} else {
			ranges = [];
			for (const posOrRange of where) {
				if (posOrRange instanceof Range) {
					ranges.push(TypeConverters.Range.from(posOrRange));
				} else {
					const { lineNumber, column } = TypeConverters.Position.from(posOrRange);
					ranges.push({ startLineNumber: lineNumber, startColumn: column, endLineNumber: lineNumber, endColumn: column });
				}
			}
		}

		return this._proxy.$tryInsertSnippet(this.id, snippet.value, ranges, options);
	}

	// ---- util

	private _runOnProxy(callback: () => Promise<any>): Promise<ExtHostTextEditor | undefined | null> {
		if (this._disposed) {
			this._logService.warn('TextEditor is closed/disposed');
			return Promise.resolve(undefined);
		}
		return callback().then(() => this, err => {
			if (!(err instanceof Error && err.name === 'DISPOSED')) {
				this._logService.warn(err);
			}
			return null;
		});
	}
}

