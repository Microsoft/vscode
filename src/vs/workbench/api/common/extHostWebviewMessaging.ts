/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import * as extHostProtocol from './extHost.protocol';

class ArrayBufferSet {
	public readonly buffers: ArrayBuffer[] = [];

	public add(buffer: ArrayBuffer): number {
		let index = this.buffers.indexOf(buffer);
		if (index < 0) {
			index = this.buffers.length;
			this.buffers.push(buffer);
		}
		return index;
	}
}

export function serializeWebviewMessage(
	message: any,
	options: { serializeBuffersForPostMessage?: boolean }
): { message: string, buffers: VSBuffer[] } {
	if (options.serializeBuffersForPostMessage) {
		// Extract all ArrayBuffers from the message and replace them with references.
		const arrayBuffers = new ArrayBufferSet();

		const replacer = (_key: string, value: any) => {
			if (value instanceof ArrayBuffer) {
				const index = arrayBuffers.add(value);
				return <extHostProtocol.WebviewMessageArrayBufferReference>{
					$$vscode_array_buffer_reference$$: true,
					index,
				};
			} else if (ArrayBuffer.isView(value)) {
				const type = getTypedArrayType(value);
				if (type) {
					const index = arrayBuffers.add(value.buffer);
					return <extHostProtocol.WebviewMessageArrayBufferReference>{
						$$vscode_array_buffer_reference$$: true,
						index,
						view: {
							type: type,
							byteLength: value.byteLength,
							byteOffset: value.byteOffset,
						}
					};
				}
			}

			return value;
		};

		const serializedMessage = JSON.stringify(message, replacer);

		const buffers = arrayBuffers.buffers.map(arrayBuffer => {
			const bytes = new Uint8Array(arrayBuffer);
			return VSBuffer.wrap(bytes);
		});

		return { message: serializedMessage, buffers };
	} else {
		return { message: JSON.stringify(message), buffers: [] };
	}
}

function getTypedArrayType(value: ArrayBufferView): extHostProtocol.WebviewMessageArrayBufferViewType | undefined {
	switch (value.constructor.name) {
		case 'Int8Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Int8Array;
		case 'Uint8Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Uint8Array;
		case 'Uint8ClampedArray': return extHostProtocol.WebviewMessageArrayBufferViewType.Uint8ClampedArray;
		case 'Int16Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Int16Array;
		case 'Uint16Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Uint16Array;
		case 'Int32Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Int32Array;
		case 'Uint32Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Uint32Array;
		case 'Float32Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Float32Array;
		case 'Float64Array': return extHostProtocol.WebviewMessageArrayBufferViewType.Float64Array;
		case 'BigInt64Array': return extHostProtocol.WebviewMessageArrayBufferViewType.BigInt64Array;
		case 'BigUint64Array': return extHostProtocol.WebviewMessageArrayBufferViewType.BigUint64Array;
	}
	return undefined;
}

export function deserializeWebviewMessage(jsonMessage: string, buffers: VSBuffer[]): { message: any, arrayBuffers: ArrayBuffer[] } {
	const arrayBuffers: ArrayBuffer[] = buffers.map(buffer => {
		const arrayBuffer = new ArrayBuffer(buffer.byteLength);
		const uint8Array = new Uint8Array(arrayBuffer);
		uint8Array.set(buffer.buffer);
		return arrayBuffer;
	});

	const reviver = !buffers.length ? undefined : (_key: string, value: any) => {
		if (typeof value === 'object' && (value as extHostProtocol.WebviewMessageArrayBufferReference).$$vscode_array_buffer_reference$$) {
			const ref = value as extHostProtocol.WebviewMessageArrayBufferReference;
			const { index } = ref;
			const arrayBuffer = arrayBuffers[index];
			if (ref.view) {
				switch (ref.view.type) {
					case extHostProtocol.WebviewMessageArrayBufferViewType.Int8Array: return new Int8Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Int8Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Uint8Array: return new Uint8Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Uint8Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Uint8ClampedArray: return new Uint8ClampedArray(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Uint8ClampedArray.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Int16Array: return new Int16Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Int16Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Uint16Array: return new Uint16Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Uint16Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Int32Array: return new Int32Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Int32Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Uint32Array: return new Uint32Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Uint32Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Float32Array: return new Float32Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Float32Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.Float64Array: return new Float64Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / Float64Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.BigInt64Array: return new BigInt64Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / BigInt64Array.BYTES_PER_ELEMENT);
					case extHostProtocol.WebviewMessageArrayBufferViewType.BigUint64Array: return new BigUint64Array(arrayBuffer, ref.view.byteOffset, ref.view.byteLength / BigUint64Array.BYTES_PER_ELEMENT);
					default: throw new Error('Unknown array buffer view type');
				}
			}
			return arrayBuffer;
		}
		return value;
	};

	const message = JSON.parse(jsonMessage, reviver);
	return { message, arrayBuffers };
}
