/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as buffer from 'vs/base/common/buffer';
import { decodeUTF16LE } from 'vs/editor/common/core/stringBuilder';

export class TextChange {

	public get oldLength(): number {
		return this.oldText.length;
	}

	public get oldEnd(): number {
		return this.oldPosition + this.oldText.length;
	}

	public get newLength(): number {
		return this.newText.length;
	}

	public get newEnd(): number {
		return this.newPosition + this.newText.length;
	}

	constructor(
		public readonly oldPosition: number,
		public readonly oldText: string,
		public readonly newPosition: number,
		public readonly newText: string
	) { }

	public toString(): string {
		if (this.oldText.length === 0) {
			return `(insert@${this.oldPosition} "${this.newText}")`;
		}
		if (this.newText.length === 0) {
			return `(delete@${this.oldPosition} "${this.oldText}")`;
		}
		return `(replace@${this.oldPosition} "${this.oldText}" with "${this.newText}")`;
	}

	private static _writeStringSize(str: string): number {
		return (
			4 + 2 * str.length
		);
	}

	private static _writeString(b: Uint8Array, str: string, offset: number): number {
		const len = str.length;
		buffer.writeUInt32BE(b, len, offset); offset += 4;
		for (let i = 0; i < len; i++) {
			buffer.writeUInt16LE(b, str.charCodeAt(i), offset); offset += 2;
		}
		return offset;
	}

	private static _readString(b: Uint8Array, offset: number): string {
		const len = buffer.readUInt32BE(b, offset); offset += 4;
		return decodeUTF16LE(b, offset, len);
	}

	public writeSize(): number {
		return (
			+ 4 // oldPosition
			+ 4 // newPosition
			+ TextChange._writeStringSize(this.oldText)
			+ TextChange._writeStringSize(this.newText)
		);
	}

	public write(b: Uint8Array, offset: number): number {
		buffer.writeUInt32BE(b, this.oldPosition, offset); offset += 4;
		buffer.writeUInt32BE(b, this.newPosition, offset); offset += 4;
		offset = TextChange._writeString(b, this.oldText, offset);
		offset = TextChange._writeString(b, this.newText, offset);
		return offset;
	}

	public static read(b: Uint8Array, offset: number, dest: TextChange[]): number {
		const oldPosition = buffer.readUInt32BE(b, offset); offset += 4;
		const newPosition = buffer.readUInt32BE(b, offset); offset += 4;
		const oldText = TextChange._readString(b, offset); offset += TextChange._writeStringSize(oldText);
		const newText = TextChange._readString(b, offset); offset += TextChange._writeStringSize(newText);
		dest.push(new TextChange(oldPosition, oldText, newPosition, newText));
		return offset;
	}
}

export function compressConsecutiveTextChanges(prevEdits: TextChange[] | null, currEdits: TextChange[]): TextChange[] {
	if (prevEdits === null || prevEdits.length === 0) {
		return currEdits;
	}
	const compressor = new TextChangeCompressor(prevEdits, currEdits);
	return compressor.compress();
}

class TextChangeCompressor {

	private _prevEdits: TextChange[];
	private _currEdits: TextChange[];

	private _result: TextChange[];
	private _resultLen: number;

	private _prevLen: number;
	private _prevDeltaOffset: number;

	private _currLen: number;
	private _currDeltaOffset: number;

	constructor(prevEdits: TextChange[], currEdits: TextChange[]) {
		this._prevEdits = prevEdits;
		this._currEdits = currEdits;

		this._result = [];
		this._resultLen = 0;

		this._prevLen = this._prevEdits.length;
		this._prevDeltaOffset = 0;

		this._currLen = this._currEdits.length;
		this._currDeltaOffset = 0;
	}

	public compress(): TextChange[] {
		let prevIndex = 0;
		let currIndex = 0;

		let prevEdit = this._getPrev(prevIndex);
		let currEdit = this._getCurr(currIndex);

		while (prevIndex < this._prevLen || currIndex < this._currLen) {

			if (prevEdit === null) {
				this._acceptCurr(currEdit!);
				currEdit = this._getCurr(++currIndex);
				continue;
			}

			if (currEdit === null) {
				this._acceptPrev(prevEdit);
				prevEdit = this._getPrev(++prevIndex);
				continue;
			}

			if (currEdit.oldEnd <= prevEdit.newPosition) {
				this._acceptCurr(currEdit);
				currEdit = this._getCurr(++currIndex);
				continue;
			}

			if (prevEdit.newEnd <= currEdit.oldPosition) {
				this._acceptPrev(prevEdit);
				prevEdit = this._getPrev(++prevIndex);
				continue;
			}

			if (currEdit.oldPosition < prevEdit.newPosition) {
				const [e1, e2] = TextChangeCompressor._splitCurr(currEdit, prevEdit.newPosition - currEdit.oldPosition);
				this._acceptCurr(e1);
				currEdit = e2;
				continue;
			}

			if (prevEdit.newPosition < currEdit.oldPosition) {
				const [e1, e2] = TextChangeCompressor._splitPrev(prevEdit, currEdit.oldPosition - prevEdit.newPosition);
				this._acceptPrev(e1);
				prevEdit = e2;
				continue;
			}

			// At this point, currEdit.oldPosition === prevEdit.newPosition

			let mergePrev: TextChange;
			let mergeCurr: TextChange;

			if (currEdit.oldEnd === prevEdit.newEnd) {
				mergePrev = prevEdit;
				mergeCurr = currEdit;
				prevEdit = this._getPrev(++prevIndex);
				currEdit = this._getCurr(++currIndex);
			} else if (currEdit.oldEnd < prevEdit.newEnd) {
				const [e1, e2] = TextChangeCompressor._splitPrev(prevEdit, currEdit.oldLength);
				mergePrev = e1;
				mergeCurr = currEdit;
				prevEdit = e2;
				currEdit = this._getCurr(++currIndex);
			} else {
				const [e1, e2] = TextChangeCompressor._splitCurr(currEdit, prevEdit.newLength);
				mergePrev = prevEdit;
				mergeCurr = e1;
				prevEdit = this._getPrev(++prevIndex);
				currEdit = e2;
			}

			this._result[this._resultLen++] = new TextChange(
				mergePrev.oldPosition,
				mergePrev.oldText,
				mergeCurr.newPosition,
				mergeCurr.newText
			);
			this._prevDeltaOffset += mergePrev.newLength - mergePrev.oldLength;
			this._currDeltaOffset += mergeCurr.newLength - mergeCurr.oldLength;
		}

		const merged = TextChangeCompressor._merge(this._result);
		const cleaned = TextChangeCompressor._removeNoOps(merged);
		return cleaned;
	}

	private _acceptCurr(currEdit: TextChange): void {
		this._result[this._resultLen++] = TextChangeCompressor._rebaseCurr(this._prevDeltaOffset, currEdit);
		this._currDeltaOffset += currEdit.newLength - currEdit.oldLength;
	}

	private _getCurr(currIndex: number): TextChange | null {
		return (currIndex < this._currLen ? this._currEdits[currIndex] : null);
	}

	private _acceptPrev(prevEdit: TextChange): void {
		this._result[this._resultLen++] = TextChangeCompressor._rebasePrev(this._currDeltaOffset, prevEdit);
		this._prevDeltaOffset += prevEdit.newLength - prevEdit.oldLength;
	}

	private _getPrev(prevIndex: number): TextChange | null {
		return (prevIndex < this._prevLen ? this._prevEdits[prevIndex] : null);
	}

	private static _rebaseCurr(prevDeltaOffset: number, currEdit: TextChange): TextChange {
		return new TextChange(
			currEdit.oldPosition - prevDeltaOffset,
			currEdit.oldText,
			currEdit.newPosition,
			currEdit.newText
		);
	}

	private static _rebasePrev(currDeltaOffset: number, prevEdit: TextChange): TextChange {
		return new TextChange(
			prevEdit.oldPosition,
			prevEdit.oldText,
			prevEdit.newPosition + currDeltaOffset,
			prevEdit.newText
		);
	}

	private static _splitPrev(edit: TextChange, offset: number): [TextChange, TextChange] {
		const preText = edit.newText.substr(0, offset);
		const postText = edit.newText.substr(offset);

		return [
			new TextChange(
				edit.oldPosition,
				edit.oldText,
				edit.newPosition,
				preText
			),
			new TextChange(
				edit.oldEnd,
				'',
				edit.newPosition + offset,
				postText
			)
		];
	}

	private static _splitCurr(edit: TextChange, offset: number): [TextChange, TextChange] {
		const preText = edit.oldText.substr(0, offset);
		const postText = edit.oldText.substr(offset);

		return [
			new TextChange(
				edit.oldPosition,
				preText,
				edit.newPosition,
				edit.newText
			),
			new TextChange(
				edit.oldPosition + offset,
				postText,
				edit.newEnd,
				''
			)
		];
	}

	private static _merge(edits: TextChange[]): TextChange[] {
		if (edits.length === 0) {
			return edits;
		}

		let result: TextChange[] = [], resultLen = 0;

		let prev = edits[0];
		for (let i = 1; i < edits.length; i++) {
			const curr = edits[i];

			if (prev.oldEnd === curr.oldPosition) {
				// Merge into `prev`
				prev = new TextChange(
					prev.oldPosition,
					prev.oldText + curr.oldText,
					prev.newPosition,
					prev.newText + curr.newText
				);
			} else {
				result[resultLen++] = prev;
				prev = curr;
			}
		}
		result[resultLen++] = prev;

		return result;
	}

	private static _removeNoOps(edits: TextChange[]): TextChange[] {
		if (edits.length === 0) {
			return edits;
		}

		let result: TextChange[] = [], resultLen = 0;

		for (let i = 0; i < edits.length; i++) {
			const edit = edits[i];

			if (edit.oldText === edit.newText) {
				continue;
			}
			result[resultLen++] = edit;
		}

		return result;
	}
}
