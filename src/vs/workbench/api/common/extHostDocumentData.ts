/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ok } from 'vs/base/common/assert';
import { Schemas } from 'vs/base/common/network';
import { regExpLeadsToEndlessLoop } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { MirrorTextModel } from 'vs/editor/common/model/mirrorTextModel';
import { ensureValidWordDefinition, getWordAtText } from 'vs/editor/common/model/wordHelper';
import { MainThreadDocumentsShape } from 'vs/workbench/api/common/extHost.protocol';
import { EndOfLine, Position, Range } from 'vs/workbench/api/common/extHostTypes';
import type * as vscode from 'vscode';
import { equals } from 'vs/base/common/arrays';

const _modeId2WordDefinition = new Map<string, RegExp>();
export function setWordDefinitionFor(modeId: string, wordDefinition: RegExp | undefined): void {
	if (!wordDefinition) {
		_modeId2WordDefinition.delete(modeId);
	} else {
		_modeId2WordDefinition.set(modeId, wordDefinition);
	}
}

export function getWordDefinitionFor(modeId: string): RegExp | undefined {
	return _modeId2WordDefinition.get(modeId);
}

export class ExtHostDocumentData extends MirrorTextModel {

	private _document?: vscode.TextDocument;
	private _isDisposed: boolean = false;

	constructor(
		private readonly _proxy: MainThreadDocumentsShape,
		uri: URI, lines: string[], eol: string, versionId: number,
		private _languageId: string,
		private _isDirty: boolean,
		private readonly _notebook?: vscode.NotebookDocument | undefined
	) {
		super(uri, lines, eol, versionId);
	}

	override dispose(): void {
		// we don't really dispose documents but let
		// extensions still read from them. some
		// operations, live saving, will now error tho
		ok(!this._isDisposed);
		this._isDisposed = true;
		this._isDirty = false;
	}

	equalLines(lines: readonly string[]): boolean {
		return equals(this._lines, lines);
	}

	get document(): vscode.TextDocument {
		if (!this._document) {
			const that = this;
			this._document = {
				get uri() { return that._uri; },
				get fileName() { return that._uri.fsPath; },
				get isUntitled() { return that._uri.scheme === Schemas.untitled; },
				get languageId() { return that._languageId; },
				get version() { return that._versionId; },
				get isClosed() { return that._isDisposed; },
				get isDirty() { return that._isDirty; },
				get notebook() { return that._notebook; },
				save() { return that._save(); },
				getText(range?) { return range ? that._getTextInRange(range) : that.getText(); },
				get eol() { return that._eol === '\n' ? EndOfLine.LF : EndOfLine.CRLF; },
				get lineCount() { return that._lines.length; },
				lineAt(lineOrPos: number | vscode.Position) { return that._lineAt(lineOrPos); },
				offsetAt(pos) { return that._offsetAt(pos); },
				positionAt(offset) { return that._positionAt(offset); },
				validateRange(ran) { return that._validateRange(ran); },
				validatePosition(pos) { return that._validatePosition(pos); },
				getWordRangeAtPosition(pos, regexp?) { return that._getWordRangeAtPosition(pos, regexp); },
			};
		}
		return Object.freeze(this._document);
	}

	_acceptLanguageId(newLanguageId: string): void {
		ok(!this._isDisposed);
		this._languageId = newLanguageId;
	}

	_acceptIsDirty(isDirty: boolean): void {
		ok(!this._isDisposed);
		this._isDirty = isDirty;
	}

	private _save(): Promise<boolean> {
		if (this._isDisposed) {
			return Promise.reject(new Error('Document has been closed'));
		}
		return this._proxy.$trySaveDocument(this._uri);
	}

	private _getTextInRange(_range: vscode.Range): string {
		const range = this._validateRange(_range);

		if (range.isEmpty) {
			return '';
		}

		if (range.isSingleLine) {
			return this._lines[range.start.line].substring(range.start.character, range.end.character);
		}

		const lineEnding = this._eol,
			startLineIndex = range.start.line,
			endLineIndex = range.end.line,
			resultLines: string[] = [];

		resultLines.push(this._lines[startLineIndex].substring(range.start.character));
		for (let i = startLineIndex + 1; i < endLineIndex; i++) {
			resultLines.push(this._lines[i]);
		}
		resultLines.push(this._lines[endLineIndex].substring(0, range.end.character));

		return resultLines.join(lineEnding);
	}

	private _lineAt(lineOrPosition: number | vscode.Position): vscode.TextLine {

		let line: number | undefined;
		if (lineOrPosition instanceof Position) {
			line = lineOrPosition.line;
		} else if (typeof lineOrPosition === 'number') {
			line = lineOrPosition;
		}

		if (typeof line !== 'number' || line < 0 || line >= this._lines.length || Math.floor(line) !== line) {
			throw new Error('Illegal value for `line`');
		}

		return new ExtHostDocumentLine(line, this._lines[line], line === this._lines.length - 1);
	}

	private _offsetAt(position: vscode.Position): number {
		position = this._validatePosition(position);
		this._ensureLineStarts();
		return this._lineStarts!.getAccumulatedValue(position.line - 1) + position.character;
	}

	private _positionAt(offset: number): vscode.Position {
		offset = Math.floor(offset);
		offset = Math.max(0, offset);

		this._ensureLineStarts();
		const out = this._lineStarts!.getIndexOf(offset);

		const lineLength = this._lines[out.index].length;

		// Ensure we return a valid position
		return new Position(out.index, Math.min(out.remainder, lineLength));
	}

	// ---- range math

	private _validateRange(range: vscode.Range): vscode.Range {
		if (!(range instanceof Range)) {
			throw new Error('Invalid argument');
		}

		const start = this._validatePosition(range.start);
		const end = this._validatePosition(range.end);

		if (start === range.start && end === range.end) {
			return range;
		}
		return new Range(start.line, start.character, end.line, end.character);
	}

	private _validatePosition(position: vscode.Position): vscode.Position {
		if (!(position instanceof Position)) {
			throw new Error('Invalid argument');
		}

		if (this._lines.length === 0) {
			return position.with(0, 0);
		}

		let { line, character } = position;
		let hasChanged = false;

		if (line < 0) {
			line = 0;
			character = 0;
			hasChanged = true;
		}
		else if (line >= this._lines.length) {
			line = this._lines.length - 1;
			character = this._lines[line].length;
			hasChanged = true;
		}
		else {
			const maxCharacter = this._lines[line].length;
			if (character < 0) {
				character = 0;
				hasChanged = true;
			}
			else if (character > maxCharacter) {
				character = maxCharacter;
				hasChanged = true;
			}
		}

		if (!hasChanged) {
			return position;
		}
		return new Position(line, character);
	}

	private _getWordRangeAtPosition(_position: vscode.Position, regexp?: RegExp): vscode.Range | undefined {
		const position = this._validatePosition(_position);

		if (!regexp) {
			// use default when custom-regexp isn't provided
			regexp = getWordDefinitionFor(this._languageId);

		} else if (regExpLeadsToEndlessLoop(regexp)) {
			// use default when custom-regexp is bad
			throw new Error(`[getWordRangeAtPosition]: ignoring custom regexp '${regexp.source}' because it matches the empty string.`);
		}

		const wordAtText = getWordAtText(
			position.character + 1,
			ensureValidWordDefinition(regexp),
			this._lines[position.line],
			0
		);

		if (wordAtText) {
			return new Range(position.line, wordAtText.startColumn - 1, position.line, wordAtText.endColumn - 1);
		}
		return undefined;
	}
}

export class ExtHostDocumentLine implements vscode.TextLine {

	private readonly _line: number;
	private readonly _text: string;
	private readonly _isLastLine: boolean;

	constructor(line: number, text: string, isLastLine: boolean) {
		this._line = line;
		this._text = text;
		this._isLastLine = isLastLine;
	}

	public get lineNumber(): number {
		return this._line;
	}

	public get text(): string {
		return this._text;
	}

	public get range(): Range {
		return new Range(this._line, 0, this._line, this._text.length);
	}

	public get rangeIncludingLineBreak(): Range {
		if (this._isLastLine) {
			return this.range;
		}
		return new Range(this._line, 0, this._line + 1, 0);
	}

	public get firstNonWhitespaceCharacterIndex(): number {
		//TODO@api, rename to 'leadingWhitespaceLength'
		return /^(\s*)/.exec(this._text)![1].length;
	}

	public get isEmptyOrWhitespace(): boolean {
		return this.firstNonWhitespaceCharacterIndex === this._text.length;
	}
}
