/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';

interface TerminalDataBuffer extends IDisposable {
	data: string[];
	timeoutId: any;
}

export class TerminalDataBufferer implements IDisposable {
	private readonly _terminalBufferMap = new Map<number, TerminalDataBuffer>();

	constructor(private readonly _callback: (id: number, data: string) => void) {
	}

	dispose() {
		for (const buffer of this._terminalBufferMap.values()) {
			buffer.dispose();
		}
	}

	startBuffering(id: number, event: Event<string>, throttleBy: number = 5): IDisposable {
		let disposable: IDisposable;
		disposable = event((e: string) => {
			let buffer = this._terminalBufferMap.get(id);
			if (buffer) {
				buffer.data.push(e);

				return;
			}

			const timeoutId = setTimeout(() => this._flushBuffer(id), throttleBy);
			buffer = {
				data: [e],
				timeoutId: timeoutId,
				dispose: () => {
					clearTimeout(timeoutId);
					this._flushBuffer(id);
					disposable.dispose();
				}
			};
			this._terminalBufferMap.set(id, buffer);
		});
		return disposable;
	}

	stopBuffering(id: number) {
		const buffer = this._terminalBufferMap.get(id);
		if (buffer) {
			buffer.dispose();
		}
	}

	private _flushBuffer(id: number): void {
		const buffer = this._terminalBufferMap.get(id);
		if (buffer) {
			this._terminalBufferMap.delete(id);
			this._callback(id, buffer.data.join(''));
		}
	}
}
