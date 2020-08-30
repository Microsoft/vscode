/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export class InMemoryDocument implements vscode.TextDocument {
	private readonly _lines: string[];

	constructor(
		public readonly uri: vscode.Uri,
		private readonly _contents: string,
		public readonly version = 1,
	) {
		this._lines = this._contents.split(/\n/g);
	}


	isUntitled: boolean = false;
	languageId: string = '';
	isDirty: boolean = false;
	isClosed: boolean = false;
	eol: vscode.EndOfLine = vscode.EndOfLine.LF;
	notebook: undefined;

	get fileName(): string {
		return this.uri.fsPath;
	}

	get lineCount(): number {
		return this._lines.length;
	}

	lineAt(line: any): vscode.TextLine {
		return {
			lineNumber: line,
			text: this._lines[line],
			range: new vscode.Range(0, 0, 0, 0),
			firstNonWhitespaceCharacterIndex: 0,
			rangeIncludingLineBreak: new vscode.Range(0, 0, 0, 0),
			isEmptyOrWhitespace: false
		};
	}
	offsetAt(_position: vscode.Position): never {
		throw new Error('Method not implemented.');
	}
	positionAt(offset: number): vscode.Position {
		const before = this._contents.slice(0, offset);
		const newLines = before.match(/\n/g);
		const line = newLines ? newLines.length : 0;
		const preCharacters = before.match(/(\n|^).*$/g);
		return new vscode.Position(line, preCharacters ? preCharacters[0].length : 0);
	}
	getText(_range?: vscode.Range | undefined): string {
		return this._contents;
	}
	getWordRangeAtPosition(_position: vscode.Position, _regex?: RegExp | undefined): never {
		throw new Error('Method not implemented.');
	}
	validateRange(_range: vscode.Range): never {
		throw new Error('Method not implemented.');
	}
	validatePosition(_position: vscode.Position): never {
		throw new Error('Method not implemented.');
	}
	save(): never {
		throw new Error('Method not implemented.');
	}
}
