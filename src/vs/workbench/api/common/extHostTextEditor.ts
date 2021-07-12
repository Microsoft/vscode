/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ok } from 'vs/base/common/assert';
import { illegalArgument, readonly } from 'vs/base/common/errors';
import { IdGenerator } from 'vs/base/common/idGenerator';
import { IRulerOption, TextEditorCursorStyle } from 'vs/editor/common/config/editorOptions';
import { IRange } from 'vs/editor/common/core/range';
import { ISingleEditOperation } from 'vs/editor/common/model';
import { IResolvedTextEditorConfiguration, ITextEditorConfigurationUpdate, MainThreadTextEditorsShape } from 'vs/workbench/api/common/extHost.protocol';
import * as TypeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { EndOfLine, Position, Range, Selection, SnippetString, TextEditorLineNumbersStyle, TextEditorRevealType } from 'vs/workbench/api/common/extHostTypes';
import type * as vscode from 'vscode';
import { ILogService } from 'vs/platform/log/common/log';
import { Lazy } from 'vs/base/common/lazy';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { equals } from 'vs/base/common/arrays';

export class TextEditorDecorationType {

	private static readonly _Keys = new IdGenerator('TextEditorDecorationType');

	readonly value: vscode.TextEditorDecorationType;

	constructor(proxy: MainThreadTextEditorsShape, extension: IExtensionDescription, options: vscode.DecorationRenderOptions) {
		const key = TextEditorDecorationType._Keys.nextId();
		proxy.$registerTextEditorDecorationType(extension.identifier, key, TypeConverters.DecorationRenderOptions.from(options));
		this.value = Object.freeze({
			key,
			dispose() {
				proxy.$removeTextEditorDecorationType(key);
			}
		});
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

export class ExtHostTextEditorOptions {

	private _proxy: MainThreadTextEditorsShape;
	private _id: string;
	private _logService: ILogService;

	private _tabSize!: number;
	private _insertSpaces!: boolean;
	private _cursorStyle!: TextEditorCursorStyle;
	private _lineNumbers!: TextEditorLineNumbersStyle;
	private _rulers!: (number | IRulerOption)[];

	readonly value: vscode.TextEditorOptions;

	constructor(proxy: MainThreadTextEditorsShape, id: string, source: IResolvedTextEditorConfiguration, logService: ILogService) {
		this._proxy = proxy;
		this._id = id;
		this._accept(source);
		this._logService = logService;

		const that = this;

		this.value = {
			get tabSize(): number | string {
				return that._tabSize;
			},
			set tabSize(value: number | string) {
				that._setTabSize(value);
			},
			get insertSpaces(): boolean | string {
				return that._insertSpaces;
			},
			set insertSpaces(value: boolean | string) {
				that._setInsertSpaces(value);
			},
			get cursorStyle(): TextEditorCursorStyle {
				return that._cursorStyle;
			},
			set cursorStyle(value: TextEditorCursorStyle) {
				that._setCursorStyle(value);
			},
			get lineNumbers(): TextEditorLineNumbersStyle {
				return that._lineNumbers;
			},
			set lineNumbers(value: TextEditorLineNumbersStyle) {
				that._setLineNumbers(value);
			},
			get rulers(): (number | IRulerOption)[] {
				return that._rulers;
			},
			set rulers(value: (number | IRulerOption)[]) {
				that._setRulers(value);
			}
		};
	}

	public _accept(source: IResolvedTextEditorConfiguration): void {
		this._tabSize = source.tabSize;
		this._insertSpaces = source.insertSpaces;
		this._cursorStyle = source.cursorStyle;
		this._lineNumbers = TypeConverters.TextEditorLineNumbersStyle.to(source.lineNumbers);
		this._rulers = source.rulers;
	}

	// --- internal: tabSize

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

	private _setTabSize(value: number | string) {
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

	// --- internal: insert spaces

	private _validateInsertSpaces(value: boolean | string): boolean | 'auto' {
		if (value === 'auto') {
			return 'auto';
		}
		return (value === 'false' ? false : Boolean(value));
	}

	private _setInsertSpaces(value: boolean | string) {
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

	// --- internal: cursor style

	private _setCursorStyle(value: TextEditorCursorStyle) {
		if (this._cursorStyle === value) {
			// nothing to do
			return;
		}
		this._cursorStyle = value;
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			cursorStyle: value
		}));
	}

	// --- internal: line number

	private _setLineNumbers(value: TextEditorLineNumbersStyle) {
		if (this._lineNumbers === value) {
			// nothing to do
			return;
		}
		this._lineNumbers = value;
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			lineNumbers: TypeConverters.TextEditorLineNumbersStyle.from(value)
		}));
	}

	private _setRulers(value: (number | IRulerOption)[]) {
		const isEqual = equals(this._rulers, value, (a, b) => {
			// For numbers and object equality
			if (a === b) {
				return true;
			}

			// TODO: Is there a better way to do the types here?
			if ((a as IRulerOption).color !== (b as IRulerOption).color) {
				return false;
			}
			if ((a as IRulerOption).column !== (b as IRulerOption).column) {
				return false;
			}
			return true;
		});
		if (isEqual) {
			return;
		}
		this._rulers = value;
		this._warnOnError(this._proxy.$trySetOptions(this._id, {
			rulers: value
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

		if (typeof newOptions.rulers !== 'undefined') {
			this._rulers = newOptions.rulers;
			hasUpdate = true;
			bulkConfigurationUpdate.rulers = newOptions.rulers;
		}

		if (hasUpdate) {
			this._warnOnError(this._proxy.$trySetOptions(this._id, bulkConfigurationUpdate));
		}
	}

	private _warnOnError(promise: Promise<any>): void {
		promise.catch(err => this._logService.warn(err));
	}
}

export class ExtHostTextEditor {

	private _selections: Selection[];
	private _options: ExtHostTextEditorOptions;
	private _visibleRanges: Range[];
	private _viewColumn: vscode.ViewColumn | undefined;
	private _disposed: boolean = false;
	private _hasDecorationsForKey = new Set<string>();

	readonly value: vscode.TextEditor;

	constructor(
		readonly id: string,
		private readonly _proxy: MainThreadTextEditorsShape,
		private readonly _logService: ILogService,
		document: Lazy<vscode.TextDocument>,
		selections: Selection[], options: IResolvedTextEditorConfiguration,
		visibleRanges: Range[], viewColumn: vscode.ViewColumn | undefined
	) {
		this._selections = selections;
		this._options = new ExtHostTextEditorOptions(this._proxy, this.id, options, _logService);
		this._visibleRanges = visibleRanges;
		this._viewColumn = viewColumn;

		const that = this;

		this.value = Object.freeze({
			get document(): vscode.TextDocument {
				return document.getValue();
			},
			set document(_value) {
				throw readonly('document');
			},
			// --- selection
			get selection(): Selection {
				return that._selections && that._selections[0];
			},
			set selection(value: Selection) {
				if (!(value instanceof Selection)) {
					throw illegalArgument('selection');
				}
				that._selections = [value];
				that._trySetSelection();
			},
			get selections(): Selection[] {
				return that._selections;
			},
			set selections(value: Selection[]) {
				if (!Array.isArray(value) || value.some(a => !(a instanceof Selection))) {
					throw illegalArgument('selections');
				}
				that._selections = value;
				that._trySetSelection();
			},
			// --- visible ranges
			get visibleRanges(): Range[] {
				return that._visibleRanges;
			},
			set visibleRanges(_value: Range[]) {
				throw readonly('visibleRanges');
			},
			// --- options
			get options(): vscode.TextEditorOptions {
				return that._options.value;
			},
			set options(value: vscode.TextEditorOptions) {
				if (!that._disposed) {
					that._options.assign(value);
				}
			},
			// --- view column
			get viewColumn(): vscode.ViewColumn | undefined {
				return that._viewColumn;
			},
			set viewColumn(_value) {
				throw readonly('viewColumn');
			},
			// --- edit
			edit(callback: (edit: TextEditorEdit) => void, options: { undoStopBefore: boolean; undoStopAfter: boolean; } = { undoStopBefore: true, undoStopAfter: true }): Promise<boolean> {
				if (that._disposed) {
					return Promise.reject(new Error('TextEditor#edit not possible on closed editors'));
				}
				const edit = new TextEditorEdit(document.getValue(), options);
				callback(edit);
				return that._applyEdit(edit);
			},
			// --- snippet edit
			insertSnippet(snippet: SnippetString, where?: Position | readonly Position[] | Range | readonly Range[], options: { undoStopBefore: boolean; undoStopAfter: boolean; } = { undoStopBefore: true, undoStopAfter: true }): Promise<boolean> {
				if (that._disposed) {
					return Promise.reject(new Error('TextEditor#insertSnippet not possible on closed editors'));
				}
				let ranges: IRange[];

				if (!where || (Array.isArray(where) && where.length === 0)) {
					ranges = that._selections.map(range => TypeConverters.Range.from(range));

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
				return _proxy.$tryInsertSnippet(id, snippet.value, ranges, options);
			},
			setDecorations(decorationType: vscode.TextEditorDecorationType, ranges: Range[] | vscode.DecorationOptions[]): void {
				const willBeEmpty = (ranges.length === 0);
				if (willBeEmpty && !that._hasDecorationsForKey.has(decorationType.key)) {
					// avoid no-op call to the renderer
					return;
				}
				if (willBeEmpty) {
					that._hasDecorationsForKey.delete(decorationType.key);
				} else {
					that._hasDecorationsForKey.add(decorationType.key);
				}
				that._runOnProxy(() => {
					if (TypeConverters.isDecorationOptionsArr(ranges)) {
						return _proxy.$trySetDecorations(
							id,
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
						return _proxy.$trySetDecorationsFast(
							id,
							decorationType.key,
							_ranges
						);
					}
				});
			},
			revealRange(range: Range, revealType: vscode.TextEditorRevealType): void {
				that._runOnProxy(() => _proxy.$tryRevealRange(
					id,
					TypeConverters.Range.from(range),
					(revealType || TextEditorRevealType.Default)
				));
			},
			show(column: vscode.ViewColumn) {
				_proxy.$tryShowEditor(id, TypeConverters.ViewColumn.from(column));
			},
			hide() {
				_proxy.$tryHideEditor(id);
			}
		});
	}

	dispose() {
		ok(!this._disposed);
		this._disposed = true;
	}

	// --- incoming: extension host MUST accept what the renderer says

	_acceptOptions(options: IResolvedTextEditorConfiguration): void {
		ok(!this._disposed);
		this._options._accept(options);
	}

	_acceptVisibleRanges(value: Range[]): void {
		ok(!this._disposed);
		this._visibleRanges = value;
	}

	_acceptViewColumn(value: vscode.ViewColumn) {
		ok(!this._disposed);
		this._viewColumn = value;
	}

	_acceptSelections(selections: Selection[]): void {
		ok(!this._disposed);
		this._selections = selections;
	}

	private async _trySetSelection(): Promise<vscode.TextEditor | null | undefined> {
		const selection = this._selections.map(TypeConverters.Selection.from);
		await this._runOnProxy(() => this._proxy.$trySetSelections(this.id, selection));
		return this.value;
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
