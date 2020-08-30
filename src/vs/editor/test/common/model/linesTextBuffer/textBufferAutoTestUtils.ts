/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { Range } from 'vs/editor/common/core/range';
import { DefaultEndOfLine, ITextBuffer, ITextBufferBuilder, ValidAnnotatedEditOperation } from 'vs/editor/common/model';

export function getRandomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRandomEOLSequence(): string {
	let rnd = getRandomInt(1, 3);
	if (rnd === 1) {
		return '\n';
	}
	if (rnd === 2) {
		return '\r';
	}
	return '\r\n';
}

export function getRandomString(minLength: number, maxLength: number): string {
	let length = getRandomInt(minLength, maxLength);
	let r = '';
	for (let i = 0; i < length; i++) {
		r += String.fromCharCode(getRandomInt(CharCode.a, CharCode.z));
	}
	return r;
}

export function generateRandomEdits(chunks: string[], editCnt: number): ValidAnnotatedEditOperation[] {
	let lines: string[] = [];
	for (const chunk of chunks) {
		let newLines = chunk.split(/\r\n|\r|\n/);
		if (lines.length === 0) {
			lines.push(...newLines);
		} else {
			newLines[0] = lines[lines.length - 1] + newLines[0];
			lines.splice(lines.length - 1, 1, ...newLines);
		}
	}

	let ops: ValidAnnotatedEditOperation[] = [];

	for (let i = 0; i < editCnt; i++) {
		let line = getRandomInt(1, lines.length);
		let startColumn = getRandomInt(1, Math.max(lines[line - 1].length, 1));
		let endColumn = getRandomInt(startColumn, Math.max(lines[line - 1].length, startColumn));
		let text: string = '';
		if (Math.random() < 0.5) {
			text = getRandomString(5, 10);
		}

		ops.push(new ValidAnnotatedEditOperation(null, new Range(line, startColumn, line, endColumn), text, false, false, false));
		lines[line - 1] = lines[line - 1].substring(0, startColumn - 1) + text + lines[line - 1].substring(endColumn - 1);
	}

	return ops;
}

export function generateSequentialInserts(chunks: string[], editCnt: number): ValidAnnotatedEditOperation[] {
	let lines: string[] = [];
	for (const chunk of chunks) {
		let newLines = chunk.split(/\r\n|\r|\n/);
		if (lines.length === 0) {
			lines.push(...newLines);
		} else {
			newLines[0] = lines[lines.length - 1] + newLines[0];
			lines.splice(lines.length - 1, 1, ...newLines);
		}
	}

	let ops: ValidAnnotatedEditOperation[] = [];

	for (let i = 0; i < editCnt; i++) {
		let line = lines.length;
		let column = lines[line - 1].length + 1;
		let text: string = '';
		if (Math.random() < 0.5) {
			text = '\n';
			lines.push('');
		} else {
			text = getRandomString(1, 2);
			lines[line - 1] += text;
		}

		ops.push(new ValidAnnotatedEditOperation(null, new Range(line, column, line, column), text, false, false, false));
	}

	return ops;
}

export function generateRandomReplaces(chunks: string[], editCnt: number, searchStringLen: number, replaceStringLen: number): ValidAnnotatedEditOperation[] {
	let lines: string[] = [];
	for (const chunk of chunks) {
		let newLines = chunk.split(/\r\n|\r|\n/);
		if (lines.length === 0) {
			lines.push(...newLines);
		} else {
			newLines[0] = lines[lines.length - 1] + newLines[0];
			lines.splice(lines.length - 1, 1, ...newLines);
		}
	}

	let ops: ValidAnnotatedEditOperation[] = [];
	let chunkSize = Math.max(1, Math.floor(lines.length / editCnt));
	let chunkCnt = Math.floor(lines.length / chunkSize);
	let replaceString = getRandomString(replaceStringLen, replaceStringLen);

	let previousChunksLength = 0;
	for (let i = 0; i < chunkCnt; i++) {
		let startLine = previousChunksLength + 1;
		let endLine = previousChunksLength + chunkSize;
		let line = getRandomInt(startLine, endLine);
		let maxColumn = lines[line - 1].length + 1;
		let startColumn = getRandomInt(1, maxColumn);
		let endColumn = Math.min(maxColumn, startColumn + searchStringLen);

		ops.push(new ValidAnnotatedEditOperation(null, new Range(line, startColumn, line, endColumn), replaceString, false, false, false));
		previousChunksLength = endLine;
	}

	return ops;
}

export function createMockText(lineCount: number, minColumn: number, maxColumn: number) {
	let fixedEOL = getRandomEOLSequence();
	let lines: string[] = [];
	for (let i = 0; i < lineCount; i++) {
		if (i !== 0) {
			lines.push(fixedEOL);
		}
		lines.push(getRandomString(minColumn, maxColumn));
	}
	return lines.join('');
}

export function createMockBuffer(str: string, bufferBuilder: ITextBufferBuilder): ITextBuffer {
	bufferBuilder.acceptChunk(str);
	let bufferFactory = bufferBuilder.finish();
	let buffer = bufferFactory.create(DefaultEndOfLine.LF);
	return buffer;
}

export function generateRandomChunkWithLF(minLength: number, maxLength: number): string {
	let length = getRandomInt(minLength, maxLength);
	let r = '';
	for (let i = 0; i < length; i++) {
		let randomI = getRandomInt(0, CharCode.z - CharCode.a + 1);
		if (randomI === 0 && Math.random() < 0.3) {
			r += '\n';
		} else {
			r += String.fromCharCode(randomI + CharCode.a - 1);
		}
	}
	return r;
}
