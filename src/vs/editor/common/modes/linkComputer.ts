/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { CharacterClassifier } from 'vs/editor/common/core/characterClassifier';
import { ILink } from 'vs/editor/common/modes';

export interface ILinkComputerTarget {
	getLineCount(): number;
	getLineContent(lineNumber: number): string;
}

export const enum State {
	Invalid = 0,
	Start = 1,
	H = 2,
	HT = 3,
	HTT = 4,
	HTTP = 5,
	F = 6,
	FI = 7,
	FIL = 8,
	BeforeColon = 9,
	AfterColon = 10,
	AlmostThere = 11,
	End = 12,
	Accept = 13,
	LastKnownState = 14 // marker, custom states may follow
}

export type Edge = [State, number, State];

export class Uint8Matrix {

	private readonly _data: Uint8Array;
	public readonly rows: number;
	public readonly cols: number;

	constructor(rows: number, cols: number, defaultValue: number) {
		const data = new Uint8Array(rows * cols);
		for (let i = 0, len = rows * cols; i < len; i++) {
			data[i] = defaultValue;
		}

		this._data = data;
		this.rows = rows;
		this.cols = cols;
	}

	public get(row: number, col: number): number {
		return this._data[row * this.cols + col];
	}

	public set(row: number, col: number, value: number): void {
		this._data[row * this.cols + col] = value;
	}
}

export class StateMachine {

	private readonly _states: Uint8Matrix;
	private readonly _maxCharCode: number;

	constructor(edges: Edge[]) {
		let maxCharCode = 0;
		let maxState = State.Invalid;
		for (let i = 0, len = edges.length; i < len; i++) {
			let [from, chCode, to] = edges[i];
			if (chCode > maxCharCode) {
				maxCharCode = chCode;
			}
			if (from > maxState) {
				maxState = from;
			}
			if (to > maxState) {
				maxState = to;
			}
		}

		maxCharCode++;
		maxState++;

		let states = new Uint8Matrix(maxState, maxCharCode, State.Invalid);
		for (let i = 0, len = edges.length; i < len; i++) {
			let [from, chCode, to] = edges[i];
			states.set(from, chCode, to);
		}

		this._states = states;
		this._maxCharCode = maxCharCode;
	}

	public nextState(currentState: State, chCode: number): State {
		if (chCode < 0 || chCode >= this._maxCharCode) {
			return State.Invalid;
		}
		return this._states.get(currentState, chCode);
	}
}

// State machine for http:// or https:// or file://
let _stateMachine: StateMachine | null = null;
function getStateMachine(): StateMachine {
	if (_stateMachine === null) {
		_stateMachine = new StateMachine([
			[State.Start, CharCode.h, State.H],
			[State.Start, CharCode.H, State.H],
			[State.Start, CharCode.f, State.F],
			[State.Start, CharCode.F, State.F],

			[State.H, CharCode.t, State.HT],
			[State.H, CharCode.T, State.HT],

			[State.HT, CharCode.t, State.HTT],
			[State.HT, CharCode.T, State.HTT],

			[State.HTT, CharCode.p, State.HTTP],
			[State.HTT, CharCode.P, State.HTTP],

			[State.HTTP, CharCode.s, State.BeforeColon],
			[State.HTTP, CharCode.S, State.BeforeColon],
			[State.HTTP, CharCode.Colon, State.AfterColon],

			[State.F, CharCode.i, State.FI],
			[State.F, CharCode.I, State.FI],

			[State.FI, CharCode.l, State.FIL],
			[State.FI, CharCode.L, State.FIL],

			[State.FIL, CharCode.e, State.BeforeColon],
			[State.FIL, CharCode.E, State.BeforeColon],

			[State.BeforeColon, CharCode.Colon, State.AfterColon],

			[State.AfterColon, CharCode.Slash, State.AlmostThere],

			[State.AlmostThere, CharCode.Slash, State.End],
		]);
	}
	return _stateMachine;
}


const enum CharacterClass {
	None = 0,
	ForceTermination = 1,
	CannotEndIn = 2
}

let _classifier: CharacterClassifier<CharacterClass> | null = null;
function getClassifier(): CharacterClassifier<CharacterClass> {
	if (_classifier === null) {
		_classifier = new CharacterClassifier<CharacterClass>(CharacterClass.None);

		const FORCE_TERMINATION_CHARACTERS = ' \t<>\'\"、。｡､，．：；‘“〈《「『【〔（［｛｢｣｝］）〕】』」》〉”’｀～…';
		for (let i = 0; i < FORCE_TERMINATION_CHARACTERS.length; i++) {
			_classifier.set(FORCE_TERMINATION_CHARACTERS.charCodeAt(i), CharacterClass.ForceTermination);
		}

		const CANNOT_END_WITH_CHARACTERS = '.,;';
		for (let i = 0; i < CANNOT_END_WITH_CHARACTERS.length; i++) {
			_classifier.set(CANNOT_END_WITH_CHARACTERS.charCodeAt(i), CharacterClass.CannotEndIn);
		}
	}
	return _classifier;
}

export class LinkComputer {

	private static _createLink(classifier: CharacterClassifier<CharacterClass>, line: string, lineNumber: number, linkBeginIndex: number, linkEndIndex: number): ILink {
		// Do not allow to end link in certain characters...
		let lastIncludedCharIndex = linkEndIndex - 1;
		do {
			const chCode = line.charCodeAt(lastIncludedCharIndex);
			const chClass = classifier.get(chCode);
			if (chClass !== CharacterClass.CannotEndIn) {
				break;
			}
			lastIncludedCharIndex--;
		} while (lastIncludedCharIndex > linkBeginIndex);

		// Handle links enclosed in parens, square brackets and curlys.
		if (linkBeginIndex > 0) {
			const charCodeBeforeLink = line.charCodeAt(linkBeginIndex - 1);
			const lastCharCodeInLink = line.charCodeAt(lastIncludedCharIndex);

			if (
				(charCodeBeforeLink === CharCode.OpenParen && lastCharCodeInLink === CharCode.CloseParen)
				|| (charCodeBeforeLink === CharCode.OpenSquareBracket && lastCharCodeInLink === CharCode.CloseSquareBracket)
				|| (charCodeBeforeLink === CharCode.OpenCurlyBrace && lastCharCodeInLink === CharCode.CloseCurlyBrace)
			) {
				// Do not end in ) if ( is before the link start
				// Do not end in ] if [ is before the link start
				// Do not end in } if { is before the link start
				lastIncludedCharIndex--;
			}
		}

		return {
			range: {
				startLineNumber: lineNumber,
				startColumn: linkBeginIndex + 1,
				endLineNumber: lineNumber,
				endColumn: lastIncludedCharIndex + 2
			},
			url: line.substring(linkBeginIndex, lastIncludedCharIndex + 1)
		};
	}

	public static computeLinks(model: ILinkComputerTarget, stateMachine: StateMachine = getStateMachine()): ILink[] {
		const classifier = getClassifier();

		let result: ILink[] = [];
		for (let i = 1, lineCount = model.getLineCount(); i <= lineCount; i++) {
			const line = model.getLineContent(i);
			const len = line.length;

			let j = 0;
			let linkBeginIndex = 0;
			let linkBeginChCode = 0;
			let state = State.Start;
			let hasOpenParens = false;
			let hasOpenSquareBracket = false;
			let inSquareBrackets = false;
			let hasOpenCurlyBracket = false;

			while (j < len) {

				let resetStateMachine = false;
				const chCode = line.charCodeAt(j);

				if (state === State.Accept) {
					let chClass: CharacterClass;
					switch (chCode) {
						case CharCode.OpenParen:
							hasOpenParens = true;
							chClass = CharacterClass.None;
							break;
						case CharCode.CloseParen:
							chClass = (hasOpenParens ? CharacterClass.None : CharacterClass.ForceTermination);
							break;
						case CharCode.OpenSquareBracket:
							inSquareBrackets = true;
							hasOpenSquareBracket = true;
							chClass = CharacterClass.None;
							break;
						case CharCode.CloseSquareBracket:
							inSquareBrackets = false;
							chClass = (hasOpenSquareBracket ? CharacterClass.None : CharacterClass.ForceTermination);
							break;
						case CharCode.OpenCurlyBrace:
							hasOpenCurlyBracket = true;
							chClass = CharacterClass.None;
							break;
						case CharCode.CloseCurlyBrace:
							chClass = (hasOpenCurlyBracket ? CharacterClass.None : CharacterClass.ForceTermination);
							break;
						/* The following three rules make it that ' or " or ` are allowed inside links if the link began with a different one */
						case CharCode.SingleQuote:
							chClass = (linkBeginChCode === CharCode.DoubleQuote || linkBeginChCode === CharCode.BackTick) ? CharacterClass.None : CharacterClass.ForceTermination;
							break;
						case CharCode.DoubleQuote:
							chClass = (linkBeginChCode === CharCode.SingleQuote || linkBeginChCode === CharCode.BackTick) ? CharacterClass.None : CharacterClass.ForceTermination;
							break;
						case CharCode.BackTick:
							chClass = (linkBeginChCode === CharCode.SingleQuote || linkBeginChCode === CharCode.DoubleQuote) ? CharacterClass.None : CharacterClass.ForceTermination;
							break;
						case CharCode.Asterisk:
							// `*` terminates a link if the link began with `*`
							chClass = (linkBeginChCode === CharCode.Asterisk) ? CharacterClass.ForceTermination : CharacterClass.None;
							break;
						case CharCode.Pipe:
							// `|` terminates a link if the link began with `|`
							chClass = (linkBeginChCode === CharCode.Pipe) ? CharacterClass.ForceTermination : CharacterClass.None;
							break;
						case CharCode.Space:
							// ` ` allow space in between [ and ]
							chClass = (inSquareBrackets ? CharacterClass.None : CharacterClass.ForceTermination);
							break;
						default:
							chClass = classifier.get(chCode);
					}

					// Check if character terminates link
					if (chClass === CharacterClass.ForceTermination) {
						result.push(LinkComputer._createLink(classifier, line, i, linkBeginIndex, j));
						resetStateMachine = true;
					}
				} else if (state === State.End) {

					let chClass: CharacterClass;
					if (chCode === CharCode.OpenSquareBracket) {
						// Allow for the authority part to contain ipv6 addresses which contain [ and ]
						hasOpenSquareBracket = true;
						chClass = CharacterClass.None;
					} else {
						chClass = classifier.get(chCode);
					}

					// Check if character terminates link
					if (chClass === CharacterClass.ForceTermination) {
						resetStateMachine = true;
					} else {
						state = State.Accept;
					}
				} else {
					state = stateMachine.nextState(state, chCode);
					if (state === State.Invalid) {
						resetStateMachine = true;
					}
				}

				if (resetStateMachine) {
					state = State.Start;
					hasOpenParens = false;
					hasOpenSquareBracket = false;
					hasOpenCurlyBracket = false;

					// Record where the link started
					linkBeginIndex = j + 1;
					linkBeginChCode = chCode;
				}

				j++;
			}

			if (state === State.Accept) {
				result.push(LinkComputer._createLink(classifier, line, i, linkBeginIndex, len));
			}

		}

		return result;
	}
}

/**
 * Returns an array of all links contains in the provided
 * document. *Note* that this operation is computational
 * expensive and should not run in the UI thread.
 */
export function computeLinks(model: ILinkComputerTarget | null): ILink[] {
	if (!model || typeof model.getLineCount !== 'function' || typeof model.getLineContent !== 'function') {
		// Unknown caller!
		return [];
	}
	return LinkComputer.computeLinks(model);
}
