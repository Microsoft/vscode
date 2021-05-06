/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IProcessDataEvent } from 'vs/platform/terminal/common/terminal';

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

	startBuffering(id: number, event: Event<string | IProcessDataEvent>, throttleBy: number = 5): IDisposable {
		let disposable: IDisposable;
		disposable = event((e: string | IProcessDataEvent) => {
			const data = (typeof e === 'string' ? e : e.data);
			let buffer = this._terminalBufferMap.get(id);
			if (buffer) {
				buffer.data.push(data);
				return;
			}

			const timeoutId = setTimeout(() => this.flushBuffer(id), throttleBy);
			buffer = {
				data: [data],
				timeoutId: timeoutId,
				dispose: () => {
					clearTimeout(timeoutId);
					this.flushBuffer(id);
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

	flushBuffer(id: number): void {
		const buffer = this._terminalBufferMap.get(id);
		if (buffer) {
			this._terminalBufferMap.delete(id);
			this._callback(id, buffer.data.join(''));
		}
	}
}
