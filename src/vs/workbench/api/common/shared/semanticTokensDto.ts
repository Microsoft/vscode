/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import * as platform from 'vs/base/common/platform';

export interface IFullSemanticTokensDto {
	id: number;
	type: 'full';
	data: Uint32Array;
}

export interface IDeltaSemanticTokensDto {
	id: number;
	type: 'delta';
	deltas: { start: number; deleteCount: number; data?: Uint32Array; }[];
}

export type ISemanticTokensDto = IFullSemanticTokensDto | IDeltaSemanticTokensDto;

const enum EncodedSemanticTokensType {
	Full = 1,
	Delta = 2
}

function reverseEndianness(arr: Uint8Array): void {
	for (let i = 0, len = arr.length; i < len; i += 4) {
		// flip bytes 0<->3 and 1<->2
		const b0 = arr[i + 0];
		const b1 = arr[i + 1];
		const b2 = arr[i + 2];
		const b3 = arr[i + 3];
		arr[i + 0] = b3;
		arr[i + 1] = b2;
		arr[i + 2] = b1;
		arr[i + 3] = b0;
	}
}

function toLittleEndianBuffer(arr: Uint32Array): VSBuffer {
	const uint8Arr = new Uint8Array(arr.buffer, arr.byteOffset, arr.length * 4);
	if (!platform.isLittleEndian()) {
		// the byte order must be changed
		reverseEndianness(uint8Arr);
	}
	return VSBuffer.wrap(uint8Arr);
}

function fromLittleEndianBuffer(buff: VSBuffer): Uint32Array {
	const uint8Arr = buff.buffer;
	if (!platform.isLittleEndian()) {
		// the byte order must be changed
		reverseEndianness(uint8Arr);
	}
	if (uint8Arr.byteOffset % 4 === 0) {
		return new Uint32Array(uint8Arr.buffer, uint8Arr.byteOffset, uint8Arr.length / 4);
	} else {
		// unaligned memory access doesn't work on all platforms
		const data = new Uint8Array(uint8Arr.byteLength);
		data.set(uint8Arr);
		return new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
	}
}

export function encodeSemanticTokensDto(semanticTokens: ISemanticTokensDto): VSBuffer {
	const dest = new Uint32Array(encodeSemanticTokensDtoSize(semanticTokens));
	let offset = 0;
	dest[offset++] = semanticTokens.id;
	if (semanticTokens.type === 'full') {
		dest[offset++] = EncodedSemanticTokensType.Full;
		dest[offset++] = semanticTokens.data.length;
		dest.set(semanticTokens.data, offset); offset += semanticTokens.data.length;
	} else {
		dest[offset++] = EncodedSemanticTokensType.Delta;
		dest[offset++] = semanticTokens.deltas.length;
		for (const delta of semanticTokens.deltas) {
			dest[offset++] = delta.start;
			dest[offset++] = delta.deleteCount;
			if (delta.data) {
				dest[offset++] = delta.data.length;
				dest.set(delta.data, offset); offset += delta.data.length;
			} else {
				dest[offset++] = 0;
			}
		}
	}
	return toLittleEndianBuffer(dest);
}

function encodeSemanticTokensDtoSize(semanticTokens: ISemanticTokensDto): number {
	let result = 0;
	result += (
		+ 1 // id
		+ 1 // type
	);
	if (semanticTokens.type === 'full') {
		result += (
			+ 1 // data length
			+ semanticTokens.data.length
		);
	} else {
		result += (
			+ 1 // delta count
		);
		result += (
			+ 1 // start
			+ 1 // deleteCount
			+ 1 // data length
		) * semanticTokens.deltas.length;
		for (const delta of semanticTokens.deltas) {
			if (delta.data) {
				result += delta.data.length;
			}
		}
	}
	return result;
}

export function decodeSemanticTokensDto(_buff: VSBuffer): ISemanticTokensDto {
	const src = fromLittleEndianBuffer(_buff);
	let offset = 0;
	const id = src[offset++];
	const type: EncodedSemanticTokensType = src[offset++];
	if (type === EncodedSemanticTokensType.Full) {
		const length = src[offset++];
		const data = src.subarray(offset, offset + length); offset += length;
		return {
			id: id,
			type: 'full',
			data: data
		};
	}
	const deltaCount = src[offset++];
	let deltas: { start: number; deleteCount: number; data?: Uint32Array; }[] = [];
	for (let i = 0; i < deltaCount; i++) {
		const start = src[offset++];
		const deleteCount = src[offset++];
		const length = src[offset++];
		let data: Uint32Array | undefined;
		if (length > 0) {
			data = src.subarray(offset, offset + length); offset += length;
		}
		deltas[i] = { start, deleteCount, data };
	}
	return {
		id: id,
		type: 'delta',
		deltas: deltas
	};
}
