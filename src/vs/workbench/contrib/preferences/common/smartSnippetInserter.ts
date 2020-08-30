/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JSONScanner, createScanner as createJSONScanner, SyntaxKind as JSONSyntaxKind } from 'vs/base/common/json';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';

export interface InsertSnippetResult {
	position: Position;
	prepend: string;
	append: string;
}

export class SmartSnippetInserter {

	private static hasOpenBrace(scanner: JSONScanner): boolean {

		while (scanner.scan() !== JSONSyntaxKind.EOF) {
			const kind = scanner.getToken();

			if (kind === JSONSyntaxKind.OpenBraceToken) {
				return true;
			}
		}

		return false;
	}

	private static offsetToPosition(model: ITextModel, offset: number): Position {
		let offsetBeforeLine = 0;
		const eolLength = model.getEOL().length;
		const lineCount = model.getLineCount();
		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			const lineTotalLength = model.getLineContent(lineNumber).length + eolLength;
			const offsetAfterLine = offsetBeforeLine + lineTotalLength;

			if (offsetAfterLine > offset) {
				return new Position(
					lineNumber,
					offset - offsetBeforeLine + 1
				);
			}
			offsetBeforeLine = offsetAfterLine;
		}
		return new Position(
			lineCount,
			model.getLineMaxColumn(lineCount)
		);
	}

	static insertSnippet(model: ITextModel, _position: Position): InsertSnippetResult {

		const desiredPosition = model.getValueLengthInRange(new Range(1, 1, _position.lineNumber, _position.column));

		// <INVALID> [ <BEFORE_OBJECT> { <INVALID> } <AFTER_OBJECT>, <BEFORE_OBJECT> { <INVALID> } <AFTER_OBJECT> ] <INVALID>
		enum State {
			INVALID = 0,
			AFTER_OBJECT = 1,
			BEFORE_OBJECT = 2,
		}
		let currentState = State.INVALID;
		let lastValidPos = -1;
		let lastValidState = State.INVALID;

		const scanner = createJSONScanner(model.getValue());
		let arrayLevel = 0;
		let objLevel = 0;

		const checkRangeStatus = (pos: number, state: State) => {
			if (state !== State.INVALID && arrayLevel === 1 && objLevel === 0) {
				currentState = state;
				lastValidPos = pos;
				lastValidState = state;
			} else {
				if (currentState !== State.INVALID) {
					currentState = State.INVALID;
					lastValidPos = scanner.getTokenOffset();
				}
			}
		};

		while (scanner.scan() !== JSONSyntaxKind.EOF) {
			const currentPos = scanner.getPosition();
			const kind = scanner.getToken();

			let goodKind = false;
			switch (kind) {
				case JSONSyntaxKind.OpenBracketToken:
					goodKind = true;
					arrayLevel++;
					checkRangeStatus(currentPos, State.BEFORE_OBJECT);
					break;
				case JSONSyntaxKind.CloseBracketToken:
					goodKind = true;
					arrayLevel--;
					checkRangeStatus(currentPos, State.INVALID);
					break;
				case JSONSyntaxKind.CommaToken:
					goodKind = true;
					checkRangeStatus(currentPos, State.BEFORE_OBJECT);
					break;
				case JSONSyntaxKind.OpenBraceToken:
					goodKind = true;
					objLevel++;
					checkRangeStatus(currentPos, State.INVALID);
					break;
				case JSONSyntaxKind.CloseBraceToken:
					goodKind = true;
					objLevel--;
					checkRangeStatus(currentPos, State.AFTER_OBJECT);
					break;
				case JSONSyntaxKind.Trivia:
				case JSONSyntaxKind.LineBreakTrivia:
					goodKind = true;
			}

			if (currentPos >= desiredPosition && (currentState !== State.INVALID || lastValidPos !== -1)) {
				let acceptPosition: number;
				let acceptState: State;

				if (currentState !== State.INVALID) {
					acceptPosition = (goodKind ? currentPos : scanner.getTokenOffset());
					acceptState = currentState;
				} else {
					acceptPosition = lastValidPos;
					acceptState = lastValidState;
				}

				if (acceptState as State === State.AFTER_OBJECT) {
					return {
						position: this.offsetToPosition(model, acceptPosition),
						prepend: ',',
						append: ''
					};
				} else {
					scanner.setPosition(acceptPosition);
					return {
						position: this.offsetToPosition(model, acceptPosition),
						prepend: '',
						append: this.hasOpenBrace(scanner) ? ',' : ''
					};
				}
			}
		}

		// no valid position found!
		const modelLineCount = model.getLineCount();
		return {
			position: new Position(modelLineCount, model.getLineMaxColumn(modelLineCount)),
			prepend: '\n[',
			append: ']'
		};
	}
}
