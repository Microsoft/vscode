/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';

export interface IExtHostReadyMessage {
	type: 'VSCODE_EXTHOST_IPC_READY';
}

export interface IExtHostSocketMessage {
	type: 'VSCODE_EXTHOST_IPC_SOCKET';
	initialDataChunk: string;
	skipWebSocketFrames: boolean;
}

export interface IExtHostReduceGraceTimeMessage {
	type: 'VSCODE_EXTHOST_IPC_REDUCE_GRACE_TIME';
}

export const enum MessageType {
	Initialized,
	Ready,
	Terminate
}

export function createMessageOfType(type: MessageType): VSBuffer {
	const result = VSBuffer.alloc(1);

	switch (type) {
		case MessageType.Initialized: result.writeUInt8(1, 0); break;
		case MessageType.Ready: result.writeUInt8(2, 0); break;
		case MessageType.Terminate: result.writeUInt8(3, 0); break;
	}

	return result;
}

export function isMessageOfType(message: VSBuffer, type: MessageType): boolean {
	if (message.byteLength !== 1) {
		return false;
	}

	switch (message.readUInt8(0)) {
		case 1: return type === MessageType.Initialized;
		case 2: return type === MessageType.Ready;
		case 3: return type === MessageType.Terminate;
		default: return false;
	}
}
