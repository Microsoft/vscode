/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from 'vs/base/common/async';
import { Color } from 'vs/base/common/color';
import { debounce } from 'vs/base/common/decorators';
import { Emitter } from 'vs/base/common/event';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { escapeRegExpCharacters } from 'vs/base/common/strings';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { XTermAttributes, XTermCore } from 'vs/workbench/contrib/terminal/browser/xterm-private';
import { DEFAULT_LOCAL_ECHO_EXCLUDE, IBeforeProcessDataEvent, ITerminalConfiguration, ITerminalProcessManager } from 'vs/workbench/contrib/terminal/common/terminal';
import type { IBuffer, IBufferCell, IDisposable, ITerminalAddon, Terminal } from 'xterm';

const ESC = '\x1b';
const CSI = `${ESC}[`;
const SHOW_CURSOR = `${CSI}?25h`;
const HIDE_CURSOR = `${CSI}?25l`;
const DELETE_CHAR = `${CSI}X`;
const DELETE_REST_OF_LINE = `${CSI}K`;
const CSI_STYLE_RE = /^\x1b\[[0-9;]*m/;
const CSI_MOVE_RE = /^\x1b\[?([0-9]*)(;[35])?O?([DC])/;
const NOT_WORD_RE = /[^a-z0-9]/i;

const statsBufferSize = 24;
const statsSendTelemetryEvery = 1000 * 60 * 5; // how often to collect stats
const statsMinSamplesToTurnOn = 5;
const statsMinAccuracyToTurnOn = 0.3;
const statsToggleOffThreshold = 0.5; // if latency is less than `threshold * this`, turn off

/**
 * Codes that should be omitted from sending to the prediction engine and instead omitted directly:
 * - Hide cursor (DECTCEM): We wrap the local echo sequence in hide and show
 *   CSI ? 2 5 l
 * - Show cursor (DECTCEM): We wrap the local echo sequence in hide and show
 *   CSI ? 2 5 h
 * - Device Status Report (DSR): These sequence fire report events from xterm which could cause
 *   double reporting and potentially a stack overflow (#119472)
 *   CSI Ps n
 *   CSI ? Ps n
 */
const PREDICTION_OMIT_RE = /^(\x1b\[(\??25[hl]|\??[0-9;]+n))+/;

const core = (terminal: Terminal): XTermCore => (terminal as any)._core;
const flushOutput = (terminal: Terminal) => {
	// TODO: Flushing output is not possible anymore without async
};

const enum CursorMoveDirection {
	Back = 'D',
	Forwards = 'C',
}

interface ICoordinate {
	x: number;
	y: number;
	baseY: number;
}

class Cursor implements ICoordinate {
	private _x = 0;
	private _y = 1;
	private _baseY = 1;

	get x() {
		return this._x;
	}

	get y() {
		return this._y;
	}

	get baseY() {
		return this._baseY;
	}

	get coordinate(): ICoordinate {
		return { x: this._x, y: this._y, baseY: this._baseY };
	}

	constructor(
		readonly rows: number,
		readonly cols: number,
		private readonly _buffer: IBuffer
	) {
		this._x = _buffer.cursorX;
		this._y = _buffer.cursorY;
		this._baseY = _buffer.baseY;
	}

	getLine() {
		return this._buffer.getLine(this._y + this._baseY);
	}

	getCell(loadInto?: IBufferCell) {
		return this.getLine()?.getCell(this._x, loadInto);
	}

	moveTo(coordinate: ICoordinate) {
		this._x = coordinate.x;
		this._y = (coordinate.y + coordinate.baseY) - this._baseY;
		return this.moveInstruction();
	}

	clone() {
		const c = new Cursor(this.rows, this.cols, this._buffer);
		c.moveTo(this);
		return c;
	}

	move(x: number, y: number) {
		this._x = x;
		this._y = y;
		return this.moveInstruction();
	}

	shift(x: number = 0, y: number = 0) {
		this._x += x;
		this._y += y;
		return this.moveInstruction();
	}

	moveInstruction() {
		if (this._y >= this.rows) {
			this._baseY += this._y - (this.rows - 1);
			this._y = this.rows - 1;
		} else if (this._y < 0) {
			this._baseY -= this._y;
			this._y = 0;
		}

		return `${CSI}${this._y + 1};${this._x + 1}H`;
	}
}

const moveToWordBoundary = (b: IBuffer, cursor: Cursor, direction: -1 | 1) => {
	let ateLeadingWhitespace = false;
	if (direction < 0) {
		cursor.shift(-1);
	}

	let cell: IBufferCell | undefined;
	while (cursor.x >= 0) {
		cell = cursor.getCell(cell);
		if (!cell?.getCode()) {
			return;
		}

		const chars = cell.getChars();
		if (NOT_WORD_RE.test(chars)) {
			if (ateLeadingWhitespace) {
				break;
			}
		} else {
			ateLeadingWhitespace = true;
		}

		cursor.shift(direction);
	}

	if (direction < 0) {
		cursor.shift(1); // we want to place the cursor after the whitespace starting the word
	}
};

const enum MatchResult {
	/** matched successfully */
	Success,
	/** failed to match */
	Failure,
	/** buffer data, it might match in the future one more data comes in */
	Buffer,
}

export interface IPrediction {
	/**
	 * Whether applying this prediction can modify the style attributes of the
	 * terminal. If so it means we need to reset the cursor style if it's
	 * rolled back.
	 */
	readonly affectsStyle?: boolean;

	/**
	 * If set to false, the prediction will not be cleared if no input is
	 * received from the server.
	 */
	readonly clearAfterTimeout?: boolean;

	/**
	 * Returns a sequence to apply the prediction.
	 * @param buffer to write to
	 * @param cursor position to write the data. Should advance the cursor.
	 * @returns a string to be written to the user terminal, or optionally a
	 * string for the user terminal and real pty.
	 */
	apply(buffer: IBuffer, cursor: Cursor): string;

	/**
	 * Returns a sequence to roll back a previous `apply()` call. If
	 * `rollForwards` is not given, then this is also called if a prediction
	 * is correct before show the user's data.
	 */
	rollback(cursor: Cursor): string;

	/**
	 * If available, this will be called when the prediction is correct.
	 */
	rollForwards(cursor: Cursor, withInput: string): string;

	/**
	 * Returns whether the given input is one expected by this prediction.
	 * @param input reader for the input the PTY is giving
	 * @param lookBehind the last successfully-made prediction, if any
	 */
	matches(input: StringReader, lookBehind?: IPrediction): MatchResult;
}

class StringReader {
	index = 0;

	get remaining() {
		return this._input.length - this.index;
	}

	get eof() {
		return this.index === this._input.length;
	}

	get rest() {
		return this._input.slice(this.index);
	}

	constructor(
		private readonly _input: string
	) { }

	/**
	 * Advances the reader and returns the character if it matches.
	 */
	eatChar(char: string) {
		if (this._input[this.index] !== char) {
			return;
		}

		this.index++;
		return char;
	}

	/**
	 * Advances the reader and returns the string if it matches.
	 */
	eatStr(substr: string) {
		if (this._input.slice(this.index, substr.length) !== substr) {
			return;
		}

		this.index += substr.length;
		return substr;
	}

	/**
	 * Matches and eats the substring character-by-character. If EOF is reached
	 * before the substring is consumed, it will buffer. Index is not moved
	 * if it's not a match.
	 */
	eatGradually(substr: string): MatchResult {
		const prevIndex = this.index;
		for (let i = 0; i < substr.length; i++) {
			if (i > 0 && this.eof) {
				return MatchResult.Buffer;
			}

			if (!this.eatChar(substr[i])) {
				this.index = prevIndex;
				return MatchResult.Failure;
			}
		}

		return MatchResult.Success;
	}

	/**
	 * Advances the reader and returns the regex if it matches.
	 */
	eatRe(re: RegExp) {
		const match = re.exec(this._input.slice(this.index));
		if (!match) {
			return;
		}

		this.index += match[0].length;
		return match;
	}

	/**
	 * Advances the reader and returns the character if the code matches.
	 */
	eatCharCode(min = 0, max = min + 1) {
		const code = this._input.charCodeAt(this.index);
		if (code < min || code >= max) {
			return undefined;
		}

		this.index++;
		return code;
	}
}

/**
 * Preidction which never tests true. Will always discard predictions made
 * after it.
 */
class HardBoundary implements IPrediction {
	readonly clearAfterTimeout = false;

	apply() {
		return '';
	}

	rollback() {
		return '';
	}

	rollForwards() {
		return '';
	}

	matches() {
		return MatchResult.Failure;
	}
}

/**
 * Wraps another prediction. Does not apply the prediction, but will pass
 * through its `matches` request.
 */
class TentativeBoundary implements IPrediction {
	private _appliedCursor?: Cursor;

	constructor(readonly inner: IPrediction) { }

	apply(buffer: IBuffer, cursor: Cursor) {
		this._appliedCursor = cursor.clone();
		this.inner.apply(buffer, this._appliedCursor);
		return '';
	}

	rollback(cursor: Cursor) {
		this.inner.rollback(cursor.clone());
		return '';
	}

	rollForwards(cursor: Cursor, withInput: string) {
		if (this._appliedCursor) {
			cursor.moveTo(this._appliedCursor);
		}

		return withInput;
	}

	matches(input: StringReader) {
		return this.inner.matches(input);
	}
}

export const isTenativeCharacterPrediction = (p: unknown): p is (TentativeBoundary & { inner: CharacterPrediction }) =>
	p instanceof TentativeBoundary && p.inner instanceof CharacterPrediction;

/**
 * Prediction for a single alphanumeric character.
 */
class CharacterPrediction implements IPrediction {
	readonly affectsStyle = true;

	appliedAt?: {
		pos: ICoordinate;
		oldAttributes: string;
		oldChar: string;
	};

	constructor(private readonly _style: TypeAheadStyle, private readonly _char: string) { }

	apply(_: IBuffer, cursor: Cursor) {
		const cell = cursor.getCell();
		this.appliedAt = cell
			? { pos: cursor.coordinate, oldAttributes: attributesToSeq(cell), oldChar: cell.getChars() }
			: { pos: cursor.coordinate, oldAttributes: '', oldChar: '' };

		cursor.shift(1);

		return this._style.apply + this._char + this._style.undo;
	}

	rollback(cursor: Cursor) {
		if (!this.appliedAt) {
			return ''; // not applied
		}

		const { oldAttributes, oldChar, pos } = this.appliedAt;
		const r = cursor.moveTo(pos) + (oldChar ? `${oldAttributes}${oldChar}${cursor.moveTo(pos)}` : DELETE_CHAR);
		return r;
	}

	rollForwards(cursor: Cursor, input: string) {
		if (!this.appliedAt) {
			return ''; // not applied
		}

		return cursor.clone().moveTo(this.appliedAt.pos) + input;
	}

	matches(input: StringReader, lookBehind?: IPrediction) {
		const startIndex = input.index;

		// remove any styling CSI before checking the char
		while (input.eatRe(CSI_STYLE_RE)) { }

		if (input.eof) {
			return MatchResult.Buffer;
		}

		if (input.eatChar(this._char)) {
			return MatchResult.Success;
		}

		if (lookBehind instanceof CharacterPrediction) {
			// see #112842
			const sillyZshOutcome = input.eatGradually(`\b${lookBehind._char}${this._char}`);
			if (sillyZshOutcome !== MatchResult.Failure) {
				return sillyZshOutcome;
			}
		}

		input.index = startIndex;
		return MatchResult.Failure;
	}
}

class BackspacePrediction implements IPrediction {
	protected _appliedAt?: {
		pos: ICoordinate;
		oldAttributes: string;
		oldChar: string;
		isLastChar: boolean;
	};

	constructor(private readonly _terminal: Terminal) { }

	apply(_: IBuffer, cursor: Cursor) {
		// at eol if everything to the right is whitespace (zsh will emit a "clear line" code in this case)
		// todo: can be optimized if `getTrimmedLength` is exposed from xterm
		const isLastChar = !cursor.getLine()?.translateToString(undefined, cursor.x).trim();
		const pos = cursor.coordinate;
		const move = cursor.shift(-1);
		const cell = cursor.getCell();
		this._appliedAt = cell
			? { isLastChar, pos, oldAttributes: attributesToSeq(cell), oldChar: cell.getChars() }
			: { isLastChar, pos, oldAttributes: '', oldChar: '' };

		return move + DELETE_CHAR;
	}

	rollback(cursor: Cursor) {
		if (!this._appliedAt) {
			return ''; // not applied
		}

		const { oldAttributes, oldChar, pos } = this._appliedAt;
		if (!oldChar) {
			return cursor.moveTo(pos) + DELETE_CHAR;
		}

		return oldAttributes + oldChar + cursor.moveTo(pos) + attributesToSeq(core(this._terminal)._inputHandler._curAttrData);
	}

	rollForwards() {
		return '';
	}

	matches(input: StringReader) {
		if (this._appliedAt?.isLastChar) {
			const r1 = input.eatGradually(`\b${CSI}K`);
			if (r1 !== MatchResult.Failure) {
				return r1;
			}

			const r2 = input.eatGradually(`\b \b`);
			if (r2 !== MatchResult.Failure) {
				return r2;
			}
		}

		return MatchResult.Failure;
	}
}

class NewlinePrediction implements IPrediction {
	protected _prevPosition?: ICoordinate;

	apply(_: IBuffer, cursor: Cursor) {
		this._prevPosition = cursor.coordinate;
		cursor.move(0, cursor.y + 1);
		return '\r\n';
	}

	rollback(cursor: Cursor) {
		return this._prevPosition ? cursor.moveTo(this._prevPosition) : '';
	}

	rollForwards() {
		return ''; // does not need to rewrite
	}

	matches(input: StringReader) {
		return input.eatGradually('\r\n');
	}
}

/**
 * Prediction when the cursor reaches the end of the line. Similar to newline
 * prediction, but shells handle it slightly differently.
 */
class LinewrapPrediction extends NewlinePrediction implements IPrediction {
	override apply(_: IBuffer, cursor: Cursor) {
		this._prevPosition = cursor.coordinate;
		cursor.move(0, cursor.y + 1);
		return ' \r';
	}

	override matches(input: StringReader) {
		// bash and zshell add a space which wraps in the terminal, then a CR
		const r = input.eatGradually(' \r');
		if (r !== MatchResult.Failure) {
			// zshell additionally adds a clear line after wrapping to be safe -- eat it
			const r2 = input.eatGradually(DELETE_REST_OF_LINE);
			return r2 === MatchResult.Buffer ? MatchResult.Buffer : r;
		}

		return input.eatGradually('\r\n');
	}
}

class CursorMovePrediction implements IPrediction {
	private _applied?: {
		rollForward: string;
		prevPosition: number;
		prevAttrs: string;
		amount: number;
	};

	constructor(
		private readonly _direction: CursorMoveDirection,
		private readonly _moveByWords: boolean,
		private readonly _amount: number,
	) { }

	apply(buffer: IBuffer, cursor: Cursor) {
		const prevPosition = cursor.x;
		const currentCell = cursor.getCell();
		const prevAttrs = currentCell ? attributesToSeq(currentCell) : '';

		const { _amount: amount, _direction: direction, _moveByWords: moveByWords } = this;
		const delta = direction === CursorMoveDirection.Back ? -1 : 1;

		const target = cursor.clone();
		if (moveByWords) {
			for (let i = 0; i < amount; i++) {
				moveToWordBoundary(buffer, target, delta);
			}
		} else {
			target.shift(delta * amount);
		}

		this._applied = {
			amount: Math.abs(cursor.x - target.x),
			prevPosition,
			prevAttrs,
			rollForward: cursor.moveTo(target),
		};

		return this._applied.rollForward;
	}

	rollback(cursor: Cursor) {
		if (!this._applied) {
			return '';
		}

		return cursor.move(this._applied.prevPosition, cursor.y) + this._applied.prevAttrs;
	}

	rollForwards() {
		return ''; // does not need to rewrite
	}

	matches(input: StringReader) {
		if (!this._applied) {
			return MatchResult.Failure;
		}

		const direction = this._direction;
		const { amount, rollForward } = this._applied;


		// arg can be omitted to move one character. We don't eatGradually() here
		// or below moves that don't go as far as the cursor would be buffered
		// indefinitely
		if (input.eatStr(`${CSI}${direction}`.repeat(amount))) {
			return MatchResult.Success;
		}

		// \b is the equivalent to moving one character back
		if (direction === CursorMoveDirection.Back) {
			if (input.eatStr(`\b`.repeat(amount))) {
				return MatchResult.Success;
			}
		}

		// check if the cursor position is set absolutely
		if (rollForward) {
			const r = input.eatGradually(rollForward);
			if (r !== MatchResult.Failure) {
				return r;
			}
		}

		// check for a relative move in the direction
		return input.eatGradually(`${CSI}${amount}${direction}`);
	}
}

export class PredictionStats extends Disposable {
	private readonly _stats: [latency: number, correct: boolean][] = [];
	private _index = 0;
	private readonly _addedAtTime = new WeakMap<IPrediction, number>();
	private readonly _changeEmitter = new Emitter<void>();
	readonly onChange = this._changeEmitter.event;

	/**
	 * Gets the percent (0-1) of predictions that were accurate.
	 */
	get accuracy() {
		let correctCount = 0;
		for (const [, correct] of this._stats) {
			if (correct) {
				correctCount++;
			}
		}

		return correctCount / (this._stats.length || 1);
	}

	/**
	 * Gets the number of recorded stats.
	 */
	get sampleSize() {
		return this._stats.length;
	}

	/**
	 * Gets latency stats of successful predictions.
	 */
	get latency() {
		const latencies = this._stats.filter(([, correct]) => correct).map(([s]) => s).sort();

		return {
			count: latencies.length,
			min: latencies[0],
			median: latencies[Math.floor(latencies.length / 2)],
			max: latencies[latencies.length - 1],
		};
	}

	/**
	 * Gets the maximum observed latency.
	 */
	get maxLatency() {
		let max = -Infinity;
		for (const [latency, correct] of this._stats) {
			if (correct) {
				max = Math.max(latency, max);
			}
		}

		return max;
	}

	constructor(timeline: PredictionTimeline) {
		super();
		this._register(timeline.onPredictionAdded(p => this._addedAtTime.set(p, Date.now())));
		this._register(timeline.onPredictionSucceeded(this._pushStat.bind(this, true)));
		this._register(timeline.onPredictionFailed(this._pushStat.bind(this, false)));
	}

	private _pushStat(correct: boolean, prediction: IPrediction) {
		const started = this._addedAtTime.get(prediction)!;
		this._stats[this._index] = [Date.now() - started, correct];
		this._index = (this._index + 1) % statsBufferSize;
		this._changeEmitter.fire();
	}
}

export class PredictionTimeline {
	/**
	 * Expected queue of events. Only predictions for the lowest are
	 * written into the terminal.
	 */
	private _expected: ({ gen: number; p: IPrediction })[] = [];

	/**
	 * Current prediction generation.
	 */
	private _currentGen = 0;

	/**
	 * Current cursor position -- kept outside the buffer since it can be ahead
	 * if typing swiftly. The position of the cursor that the user is currently
	 * looking at on their screen (or will be looking at after all pending writes
	 * are flushed.)
	 */
	private _physicalCursor: Cursor | undefined;

	/**
	 * Cursor position taking into account all (possibly not-yet-applied)
	 * predictions. A new prediction inserted, if applied, will be applied at
	 * the position of the tentative cursor.
	 */
	private _tenativeCursor: Cursor | undefined;

	/**
	 * Previously sent data that was buffered and should be prepended to the
	 * next input.
	 */
	private _inputBuffer?: string;

	/**
	 * Whether predictions are echoed to the terminal. If false, predictions
	 * will still be computed internally for latency metrics, but input will
	 * never be adjusted.
	 */
	private _showPredictions = false;

	/**
	 * The last successfully-made prediction.
	 */
	private _lookBehind?: IPrediction;

	private readonly _addedEmitter = new Emitter<IPrediction>();
	readonly onPredictionAdded = this._addedEmitter.event;
	private readonly _failedEmitter = new Emitter<IPrediction>();
	readonly onPredictionFailed = this._failedEmitter.event;
	private readonly _succeededEmitter = new Emitter<IPrediction>();
	readonly onPredictionSucceeded = this._succeededEmitter.event;

	private get _currentGenerationPredictions() {
		return this._expected.filter(({ gen }) => gen === this._expected[0].gen).map(({ p }) => p);
	}

	get isShowingPredictions() {
		return this._showPredictions;
	}

	get length() {
		return this._expected.length;
	}

	constructor(readonly terminal: Terminal, private readonly _style: TypeAheadStyle) { }

	setShowPredictions(show: boolean) {
		if (show === this._showPredictions) {
			return;
		}

		// console.log('set predictions:', show);
		this._showPredictions = show;

		const buffer = this._getActiveBuffer();
		if (!buffer) {
			return;
		}

		const toApply = this._currentGenerationPredictions;
		if (show) {
			this.clearCursor();
			this._style.expectIncomingStyle(toApply.reduce((count, p) => p.affectsStyle ? count + 1 : count, 0));
			this.terminal.write(toApply.map(p => p.apply(buffer, this.physicalCursor(buffer))).join(''));
		} else {
			this.terminal.write(toApply.reverse().map(p => p.rollback(this.physicalCursor(buffer))).join(''));
		}
	}

	/**
	 * Undoes any predictions written and resets expectations.
	 */
	undoAllPredictions() {
		const buffer = this._getActiveBuffer();
		if (this._showPredictions && buffer) {
			this.terminal.write(this._currentGenerationPredictions.reverse()
				.map(p => p.rollback(this.physicalCursor(buffer))).join(''));
		}

		this._expected = [];
	}

	/**
	 * Should be called when input is incoming to the temrinal.
	 */
	beforeServerInput(input: string): string {
		const originalInput = input;
		if (this._inputBuffer) {
			input = this._inputBuffer + input;
			this._inputBuffer = undefined;
		}

		if (!this._expected.length) {
			this._clearPredictionState();
			return input;
		}

		const buffer = this._getActiveBuffer();
		if (!buffer) {
			this._clearPredictionState();
			return input;
		}

		let output = '';

		const reader = new StringReader(input);
		const startingGen = this._expected[0].gen;
		const emitPredictionOmitted = () => {
			const omit = reader.eatRe(PREDICTION_OMIT_RE);
			if (omit) {
				output += omit[0];
			}
		};

		ReadLoop: while (this._expected.length && reader.remaining > 0) {
			emitPredictionOmitted();

			const { p: prediction, gen } = this._expected[0];
			const cursor = this.physicalCursor(buffer);
			const beforeTestReaderIndex = reader.index;
			switch (prediction.matches(reader, this._lookBehind)) {
				case MatchResult.Success:
					// if the input character matches what the next prediction expected, undo
					// the prediction and write the real character out.
					const eaten = input.slice(beforeTestReaderIndex, reader.index);
					if (gen === startingGen) {
						output += prediction.rollForwards?.(cursor, eaten);
					} else {
						prediction.apply(buffer, this.physicalCursor(buffer)); // move cursor for additional apply
						output += eaten;
					}

					this._succeededEmitter.fire(prediction);
					this._lookBehind = prediction;
					this._expected.shift();
					break;
				case MatchResult.Buffer:
					// on a buffer, store the remaining data and completely read data
					// to be output as normal.
					this._inputBuffer = input.slice(beforeTestReaderIndex);
					reader.index = input.length;
					break ReadLoop;
				case MatchResult.Failure:
					// on a failure, roll back all remaining items in this generation
					// and clear predictions, since they are no longer valid
					const rollback = this._expected.filter(p => p.gen === startingGen).reverse();
					output += rollback.map(({ p }) => p.rollback(this.physicalCursor(buffer))).join('');
					if (rollback.some(r => r.p.affectsStyle)) {
						// reading the current style should generally be safe, since predictions
						// always restore the style if they modify it.
						output += attributesToSeq(core(this.terminal)._inputHandler._curAttrData);
					}
					this._clearPredictionState();
					this._failedEmitter.fire(prediction);
					break ReadLoop;
			}
		}

		emitPredictionOmitted();

		// Extra data (like the result of running a command) should cause us to
		// reset the cursor
		if (!reader.eof) {
			output += reader.rest;
			this._clearPredictionState();
		}

		// If we passed a generation boundary, apply the current generation's predictions
		if (this._expected.length && startingGen !== this._expected[0].gen) {
			for (const { p, gen } of this._expected) {
				if (gen !== this._expected[0].gen) {
					break;
				}
				if (p.affectsStyle) {
					this._style.expectIncomingStyle();
				}

				output += p.apply(buffer, this.physicalCursor(buffer));
			}
		}

		if (!this._showPredictions) {
			return originalInput;
		}

		if (output.length === 0 || output === input) {
			return output;
		}

		if (this._physicalCursor) {
			output += this._physicalCursor.moveInstruction();
		}

		// prevent cursor flickering while typing
		output = HIDE_CURSOR + output + SHOW_CURSOR;

		return output;
	}

	/**
	 * Clears any expected predictions and stored state. Should be called when
	 * the pty gives us something we don't recognize.
	 */
	private _clearPredictionState() {
		this._expected = [];
		this.clearCursor();
		this._lookBehind = undefined;
	}

	/**
	 * Appends a typeahead prediction.
	 */
	addPrediction(buffer: IBuffer, prediction: IPrediction) {
		this._expected.push({ gen: this._currentGen, p: prediction });
		this._addedEmitter.fire(prediction);

		if (this._currentGen !== this._expected[0].gen) {
			prediction.apply(buffer, this.tentativeCursor(buffer));
			return false;
		}

		const text = prediction.apply(buffer, this.physicalCursor(buffer));
		this._tenativeCursor = undefined; // next read will get or clone the physical cursor

		if (this._showPredictions && text) {
			if (prediction.affectsStyle) {
				this._style.expectIncomingStyle();
			}
			// console.log('predict:', JSON.stringify(text));
			this.terminal.write(text);
		}

		return true;
	}

	/**
	 * Appends a prediction followed by a boundary. The predictions applied
	 * after this one will only be displayed after the give prediction matches
	 * pty output/
	 */
	addBoundary(): void;
	addBoundary(buffer: IBuffer, prediction: IPrediction): boolean;
	addBoundary(buffer?: IBuffer, prediction?: IPrediction) {
		let applied = false;
		if (buffer && prediction) {
			// We apply the prediction so that it's matched against, but wrapped
			// in a tentativeboundary so that it doesn't affect the physical cursor.
			// Then we apply it specifically to the tentative cursor.
			applied = this.addPrediction(buffer, new TentativeBoundary(prediction));
			prediction.apply(buffer, this.tentativeCursor(buffer));
		}
		this._currentGen++;
		return applied;
	}

	/**
	 * Peeks the last prediction written.
	 */
	peekEnd(): IPrediction | undefined {
		return this._expected[this._expected.length - 1]?.p;
	}

	/**
	 * Peeks the first pending prediction.
	 */
	peekStart(): IPrediction | undefined {
		return this._expected[0]?.p;
	}

	/**
	 * Current position of the cursor in the terminal.
	 */
	physicalCursor(buffer: IBuffer) {
		if (!this._physicalCursor) {
			if (this._showPredictions) {
				flushOutput(this.terminal);
			}
			this._physicalCursor = new Cursor(this.terminal.rows, this.terminal.cols, buffer);
		}

		return this._physicalCursor;
	}

	/**
	 * Cursor position if all predictions and boundaries that have been inserted
	 * so far turn out to be successfully predicted.
	 */
	tentativeCursor(buffer: IBuffer) {
		if (!this._tenativeCursor) {
			this._tenativeCursor = this.physicalCursor(buffer).clone();
		}

		return this._tenativeCursor;
	}

	clearCursor() {
		this._physicalCursor = undefined;
		this._tenativeCursor = undefined;
	}

	private _getActiveBuffer() {
		const buffer = this.terminal.buffer.active;
		return buffer.type === 'normal' ? buffer : undefined;
	}
}

/**
 * Gets the escape sequence args to restore state/appearence in the cell.
 */
const attributesToArgs = (cell: XTermAttributes) => {
	if (cell.isAttributeDefault()) { return [0]; }

	const args = [];
	if (cell.isBold()) { args.push(1); }
	if (cell.isDim()) { args.push(2); }
	if (cell.isItalic()) { args.push(3); }
	if (cell.isUnderline()) { args.push(4); }
	if (cell.isBlink()) { args.push(5); }
	if (cell.isInverse()) { args.push(7); }
	if (cell.isInvisible()) { args.push(8); }

	if (cell.isFgRGB()) { args.push(38, 2, cell.getFgColor() >>> 24, (cell.getFgColor() >>> 16) & 0xFF, cell.getFgColor() & 0xFF); }
	if (cell.isFgPalette()) { args.push(38, 5, cell.getFgColor()); }
	if (cell.isFgDefault()) { args.push(39); }

	if (cell.isBgRGB()) { args.push(48, 2, cell.getBgColor() >>> 24, (cell.getBgColor() >>> 16) & 0xFF, cell.getBgColor() & 0xFF); }
	if (cell.isBgPalette()) { args.push(48, 5, cell.getBgColor()); }
	if (cell.isBgDefault()) { args.push(49); }

	return args;
};

/**
 * Gets the escape sequence to restore state/appearence in the cell.
 */
const attributesToSeq = (cell: XTermAttributes) => `${CSI}${attributesToArgs(cell).join(';')}m`;

const arrayHasPrefixAt = <T>(a: ReadonlyArray<T>, ai: number, b: ReadonlyArray<T>) => {
	if (a.length - ai > b.length) {
		return false;
	}

	for (let bi = 0; bi < b.length; bi++, ai++) {
		if (b[ai] !== a[ai]) {
			return false;
		}
	}

	return true;
};

/**
 * @see https://github.com/xtermjs/xterm.js/blob/065eb13a9d3145bea687239680ec9696d9112b8e/src/common/InputHandler.ts#L2127
 */
const getColorWidth = (params: (number | number[])[], pos: number) => {
	const accu = [0, 0, -1, 0, 0, 0];
	let cSpace = 0;
	let advance = 0;

	do {
		const v = params[pos + advance];
		accu[advance + cSpace] = typeof v === 'number' ? v : v[0];
		if (typeof v !== 'number') {
			let i = 0;
			do {
				if (accu[1] === 5) {
					cSpace = 1;
				}
				accu[advance + i + 1 + cSpace] = v[i];
			} while (++i < v.length && i + advance + 1 + cSpace < accu.length);
			break;
		}
		// exit early if can decide color mode with semicolons
		if ((accu[1] === 5 && advance + cSpace >= 2)
			|| (accu[1] === 2 && advance + cSpace >= 5)) {
			break;
		}
		// offset colorSpace slot for semicolon mode
		if (accu[1]) {
			cSpace = 1;
		}
	} while (++advance + pos < params.length && advance + cSpace < accu.length);

	return advance;
};

class TypeAheadStyle implements IDisposable {
	private static _compileArgs(args: ReadonlyArray<number>) {
		return `${CSI}${args.join(';')}m`;
	}

	/**
	 * Number of typeahead style arguments we expect to read. If this is 0 and
	 * we see a style coming in, we know that the PTY actually wanted to update.
	 */
	private _expectedIncomingStyles = 0;
	private _applyArgs!: ReadonlyArray<number>;
	private _originalUndoArgs!: ReadonlyArray<number>;
	private _undoArgs!: ReadonlyArray<number>;

	apply!: string;
	undo!: string;
	private _csiHandler?: IDisposable;

	constructor(value: ITerminalConfiguration['localEchoStyle'], private readonly _terminal: Terminal) {
		this.onUpdate(value);
	}

	/**
	 * Signals that a style was written to the terminal and we should watch
	 * for it coming in.
	 */
	expectIncomingStyle(n = 1) {
		this._expectedIncomingStyles += n * 2;
	}

	/**
	 * Starts tracking for CSI changes in the terminal.
	 */
	startTracking() {
		this._expectedIncomingStyles = 0;
		this._onDidWriteSGR(attributesToArgs(core(this._terminal)._inputHandler._curAttrData));
		this._csiHandler = this._terminal.parser.registerCsiHandler({ final: 'm' }, args => {
			this._onDidWriteSGR(args);
			return false;
		});
	}

	/**
	 * Stops tracking terminal CSI changes.
	 */
	@debounce(2000)
	debounceStopTracking() {
		this._stopTracking();
	}

	/**
	 * @inheritdoc
	 */
	dispose() {
		this._stopTracking();
	}

	private _stopTracking() {
		this._csiHandler?.dispose();
		this._csiHandler = undefined;
	}

	private _onDidWriteSGR(args: (number | number[])[]) {
		const originalUndo = this._undoArgs;
		for (let i = 0; i < args.length;) {
			const px = args[i];
			const p = typeof px === 'number' ? px : px[0];

			if (this._expectedIncomingStyles) {
				if (arrayHasPrefixAt(args, i, this._undoArgs)) {
					this._expectedIncomingStyles--;
					i += this._undoArgs.length;
					continue;
				}
				if (arrayHasPrefixAt(args, i, this._applyArgs)) {
					this._expectedIncomingStyles--;
					i += this._applyArgs.length;
					continue;
				}
			}

			const width = p === 38 || p === 48 || p === 58 ? getColorWidth(args, i) : 1;
			switch (this._applyArgs[0]) {
				case 1:
					if (p === 2) {
						this._undoArgs = [22, 2];
					} else if (p === 22 || p === 0) {
						this._undoArgs = [22];
					}
					break;
				case 2:
					if (p === 1) {
						this._undoArgs = [22, 1];
					} else if (p === 22 || p === 0) {
						this._undoArgs = [22];
					}
					break;
				case 38:
					if (p === 0 || p === 39 || p === 100) {
						this._undoArgs = [39];
					} else if ((p >= 30 && p <= 38) || (p >= 90 && p <= 97)) {
						this._undoArgs = args.slice(i, i + width) as number[];
					}
					break;
				default:
					if (p === this._applyArgs[0]) {
						this._undoArgs = this._applyArgs;
					} else if (p === 0) {
						this._undoArgs = this._originalUndoArgs;
					}
				// no-op
			}

			i += width;
		}

		if (originalUndo !== this._undoArgs) {
			this.undo = TypeAheadStyle._compileArgs(this._undoArgs);
		}
	}

	/**
	 * Updates the current typeahead style.
	 */
	onUpdate(style: ITerminalConfiguration['localEchoStyle']) {
		const { applyArgs, undoArgs } = this._getArgs(style);
		this._applyArgs = applyArgs;
		this._undoArgs = this._originalUndoArgs = undoArgs;
		this.apply = TypeAheadStyle._compileArgs(this._applyArgs);
		this.undo = TypeAheadStyle._compileArgs(this._undoArgs);
	}

	private _getArgs(style: ITerminalConfiguration['localEchoStyle']) {
		switch (style) {
			case 'bold':
				return { applyArgs: [1], undoArgs: [22] };
			case 'dim':
				return { applyArgs: [2], undoArgs: [22] };
			case 'italic':
				return { applyArgs: [3], undoArgs: [23] };
			case 'underlined':
				return { applyArgs: [4], undoArgs: [24] };
			case 'inverted':
				return { applyArgs: [7], undoArgs: [27] };
			default:
				const { r, g, b } = Color.fromHex(style).rgba;
				return { applyArgs: [38, 2, r, g, b], undoArgs: [39] };
		}
	}
}

const compileExcludeRegexp = (programs = DEFAULT_LOCAL_ECHO_EXCLUDE) =>
	new RegExp(`\\b(${programs.map(escapeRegExpCharacters).join('|')})\\b`, 'i');

export const enum CharPredictState {
	/** No characters typed on this line yet */
	Unknown,
	/** Has a pending character prediction */
	HasPendingChar,
	/** Character validated on this line */
	Validated,
}

export class TypeAheadAddon extends Disposable implements ITerminalAddon {
	private _typeaheadStyle?: TypeAheadStyle;
	private _typeaheadThreshold = this._config.config.localEchoLatencyThreshold;
	private _excludeProgramRe = compileExcludeRegexp(this._config.config.localEchoExcludePrograms);
	protected _lastRow?: { y: number; startingX: number; endingX: number; charState: CharPredictState };
	protected _timeline?: PredictionTimeline;
	private _terminalTitle = '';
	stats?: PredictionStats;

	/**
	 * Debounce that clears predictions after a timeout if the PTY doesn't apply them.
	 */
	private _clearPredictionDebounce?: IDisposable;

	constructor(
		private _processManager: ITerminalProcessManager,
		private readonly _config: TerminalConfigHelper,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();
		this._register(toDisposable(() => this._clearPredictionDebounce?.dispose()));
	}

	activate(terminal: Terminal): void {
		const style = this._typeaheadStyle = this._register(new TypeAheadStyle(this._config.config.localEchoStyle, terminal));
		const timeline = this._timeline = new PredictionTimeline(terminal, this._typeaheadStyle);
		const stats = this.stats = this._register(new PredictionStats(this._timeline));

		timeline.setShowPredictions(this._typeaheadThreshold === 0);
		this._register(terminal.onData(e => this._onUserData(e)));
		this._register(terminal.onTitleChange(title => {
			this._terminalTitle = title;
			this._reevaluatePredictorState(stats, timeline);
		}));
		this._register(terminal.onResize(() => {
			timeline.setShowPredictions(false);
			timeline.clearCursor();
			this._reevaluatePredictorState(stats, timeline);
		}));
		this._register(this._config.onConfigChanged(() => {
			style.onUpdate(this._config.config.localEchoStyle);
			this._typeaheadThreshold = this._config.config.localEchoLatencyThreshold;
			this._excludeProgramRe = compileExcludeRegexp(this._config.config.localEchoExcludePrograms);
			this._reevaluatePredictorState(stats, timeline);
		}));
		this._register(this._timeline.onPredictionSucceeded(p => {
			if (this._lastRow?.charState === CharPredictState.HasPendingChar && isTenativeCharacterPrediction(p) && p.inner.appliedAt) {
				if (p.inner.appliedAt.pos.y + p.inner.appliedAt.pos.baseY === this._lastRow.y) {
					this._lastRow.charState = CharPredictState.Validated;
				}
			}
		}));
		this._register(this._processManager.onBeforeProcessData(e => this._onBeforeProcessData(e)));

		let nextStatsSend: any;
		this._register(stats.onChange(() => {
			if (!nextStatsSend) {
				nextStatsSend = setTimeout(() => {
					this._sendLatencyStats(stats);
					nextStatsSend = undefined;
				}, statsSendTelemetryEvery);
			}

			if (timeline.length === 0) {
				style.debounceStopTracking();
			}

			this._reevaluatePredictorState(stats, timeline);
		}));
	}

	reset() {
		this._lastRow = undefined;
	}

	private _deferClearingPredictions() {
		if (!this.stats || !this._timeline) {
			return;
		}

		this._clearPredictionDebounce?.dispose();
		if (this._timeline.length === 0 || this._timeline.peekStart()?.clearAfterTimeout === false) {
			this._clearPredictionDebounce = undefined;
			return;
		}

		this._clearPredictionDebounce = disposableTimeout(
			() => {
				this._timeline?.undoAllPredictions();
				if (this._lastRow?.charState === CharPredictState.HasPendingChar) {
					this._lastRow.charState = CharPredictState.Unknown;
				}
			},
			Math.max(500, this.stats.maxLatency * 3 / 2),
		);
	}

	/**
	 * Note on debounce:
	 *
	 * We want to toggle the state only when the user has a pause in their
	 * typing. Otherwise, we could turn this on when the PTY sent data but the
	 * terminal cursor is not updated, causes issues.
	 */
	@debounce(100)
	protected _reevaluatePredictorState(stats: PredictionStats, timeline: PredictionTimeline) {
		this._reevaluatePredictorStateNow(stats, timeline);
	}

	protected _reevaluatePredictorStateNow(stats: PredictionStats, timeline: PredictionTimeline) {
		if (this._excludeProgramRe.test(this._terminalTitle)) {
			timeline.setShowPredictions(false);
		} else if (this._typeaheadThreshold < 0) {
			timeline.setShowPredictions(false);
		} else if (this._typeaheadThreshold === 0) {
			timeline.setShowPredictions(true);
		} else if (stats.sampleSize > statsMinSamplesToTurnOn && stats.accuracy > statsMinAccuracyToTurnOn) {
			const latency = stats.latency.median;
			if (latency >= this._typeaheadThreshold) {
				timeline.setShowPredictions(true);
			} else if (latency < this._typeaheadThreshold / statsToggleOffThreshold) {
				timeline.setShowPredictions(false);
			}
		}
	}

	private _sendLatencyStats(stats: PredictionStats) {
		/* __GDPR__
			"terminalLatencyStats" : {
				"min" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"max" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"median" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"count" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"predictionAccuracy" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
			}
		 */
		this._telemetryService.publicLog('terminalLatencyStats', {
			...stats.latency,
			predictionAccuracy: stats.accuracy,
		});
	}

	private _onUserData(data: string): void {
		if (this._timeline?.terminal.buffer.active.type !== 'normal') {
			return;
		}

		// console.log('user data:', JSON.stringify(data));

		const terminal = this._timeline.terminal;
		const buffer = terminal.buffer.active;

		// Detect programs like git log/less that use the normal buffer but don't
		// take input by deafult (fixes #109541)
		if (buffer.cursorX === 1 && buffer.cursorY === terminal.rows - 1) {
			if (buffer.getLine(buffer.cursorY + buffer.baseY)?.getCell(0)?.getChars() === ':') {
				return;
			}
		}

		// the following code guards the terminal prompt to avoid being able to
		// arrow or backspace-into the prompt. Record the lowest X value at which
		// the user gave input, and mark all additions before that as tentative.
		const actualY = buffer.baseY + buffer.cursorY;
		if (actualY !== this._lastRow?.y) {
			this._lastRow = { y: actualY, startingX: buffer.cursorX, endingX: buffer.cursorX, charState: CharPredictState.Unknown };
		} else {
			this._lastRow.startingX = Math.min(this._lastRow.startingX, buffer.cursorX);
			this._lastRow.endingX = Math.max(this._lastRow.endingX, this._timeline.physicalCursor(buffer).x);
		}

		const addLeftNavigating = (p: IPrediction) =>
			this._timeline!.tentativeCursor(buffer).x <= this._lastRow!.startingX
				? this._timeline!.addBoundary(buffer, p)
				: this._timeline!.addPrediction(buffer, p);

		const addRightNavigating = (p: IPrediction) =>
			this._timeline!.tentativeCursor(buffer).x >= this._lastRow!.endingX - 1
				? this._timeline!.addBoundary(buffer, p)
				: this._timeline!.addPrediction(buffer, p);

		/** @see https://github.com/xtermjs/xterm.js/blob/1913e9512c048e3cf56bb5f5df51bfff6899c184/src/common/input/Keyboard.ts */
		const reader = new StringReader(data);
		while (reader.remaining > 0) {
			if (reader.eatCharCode(127)) { // backspace
				const previous = this._timeline.peekEnd();
				if (previous && previous instanceof CharacterPrediction) {
					this._timeline.addBoundary();
				}

				// backspace must be able to read the previously-written character in
				// the event that it needs to undo it
				if (this._timeline.isShowingPredictions) {
					flushOutput(this._timeline.terminal);
				}

				if (this._timeline.tentativeCursor(buffer).x <= this._lastRow!.startingX) {
					this._timeline.addBoundary(buffer, new BackspacePrediction(this._timeline.terminal));
				} else {
					// Backspace decrements our ability to go right.
					this._lastRow.endingX--;
					this._timeline!.addPrediction(buffer, new BackspacePrediction(this._timeline.terminal));
				}

				continue;
			}

			if (reader.eatCharCode(32, 126)) { // alphanum
				const char = data[reader.index - 1];
				const prediction = new CharacterPrediction(this._typeaheadStyle!, char);
				if (this._lastRow.charState === CharPredictState.Unknown) {
					this._timeline.addBoundary(buffer, prediction);
					this._lastRow.charState = CharPredictState.HasPendingChar;
				} else {
					this._timeline.addPrediction(buffer, prediction);
				}

				if (this._timeline.tentativeCursor(buffer).x >= terminal.cols) {
					this._timeline.addBoundary(buffer, new LinewrapPrediction());
				}
				continue;
			}

			const cursorMv = reader.eatRe(CSI_MOVE_RE);
			if (cursorMv) {
				const direction = cursorMv[3] as CursorMoveDirection;
				const p = new CursorMovePrediction(direction, !!cursorMv[2], Number(cursorMv[1]) || 1);
				if (direction === CursorMoveDirection.Back) {
					addLeftNavigating(p);
				} else {
					addRightNavigating(p);
				}
				continue;
			}

			if (reader.eatStr(`${ESC}f`)) {
				addRightNavigating(new CursorMovePrediction(CursorMoveDirection.Forwards, true, 1));
				continue;
			}

			if (reader.eatStr(`${ESC}b`)) {
				addLeftNavigating(new CursorMovePrediction(CursorMoveDirection.Back, true, 1));
				continue;
			}

			if (reader.eatChar('\r') && buffer.cursorY < terminal.rows - 1) {
				this._timeline.addPrediction(buffer, new NewlinePrediction());
				continue;
			}

			// something else
			this._timeline.addBoundary(buffer, new HardBoundary());
			break;
		}

		if (this._timeline.length === 1) {
			this._deferClearingPredictions();
			this._typeaheadStyle!.startTracking();
		}
	}

	private _onBeforeProcessData(event: IBeforeProcessDataEvent): void {
		if (!this._timeline) {
			return;
		}

		// console.log('incoming data:', JSON.stringify(event.data));
		event.data = this._timeline.beforeServerInput(event.data);
		// console.log('emitted data:', JSON.stringify(event.data));

		this._deferClearingPredictions();
	}
}
