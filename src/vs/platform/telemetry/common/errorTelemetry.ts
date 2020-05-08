/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { binarySearch } from 'vs/base/common/arrays';
import * as Errors from 'vs/base/common/errors';
import { toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { safeStringify } from 'vs/base/common/objects';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

type ErrorEventFragment = {
	callstack: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth' };
	msg?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth' };
	file?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth' };
	line?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth', isMeasurement: true };
	column?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth', isMeasurement: true };
	uncaught_error_name?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth' };
	uncaught_error_msg?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth' };
	count?: { classification: 'CallstackOrException', purpose: 'PerformanceAndHealth', isMeasurement: true };
};
export interface ErrorEvent {
	callstack: string;
	msg?: string;
	file?: string;
	line?: number;
	column?: number;
	uncaught_error_name?: string;
	uncaught_error_msg?: string;
	count?: number;
}

export namespace ErrorEvent {
	export function compare(a: ErrorEvent, b: ErrorEvent) {
		if (a.callstack < b.callstack) {
			return -1;
		} else if (a.callstack > b.callstack) {
			return 1;
		}
		return 0;
	}
}

export default abstract class BaseErrorTelemetry {

	public static ERROR_FLUSH_TIMEOUT: number = 5 * 1000;

	private _telemetryService: ITelemetryService;
	private _flushDelay: number;
	private _flushHandle: any = -1;
	private _buffer: ErrorEvent[] = [];
	protected readonly _disposables = new DisposableStore();

	constructor(telemetryService: ITelemetryService, flushDelay = BaseErrorTelemetry.ERROR_FLUSH_TIMEOUT) {
		this._telemetryService = telemetryService;
		this._flushDelay = flushDelay;

		// (1) check for unexpected but handled errors
		const unbind = Errors.errorHandler.addListener((err) => this._onErrorEvent(err));
		this._disposables.add(toDisposable(unbind));

		// (2) install implementation-specific error listeners
		this.installErrorListeners();
	}

	dispose() {
		clearTimeout(this._flushHandle);
		this._flushBuffer();
		this._disposables.dispose();
	}

	protected installErrorListeners(): void {
		// to override
	}

	private _onErrorEvent(err: any): void {

		if (!err) {
			return;
		}

		// unwrap nested errors from loader
		if (err.detail && err.detail.stack) {
			err = err.detail;
		}

		// work around behavior in workerServer.ts that breaks up Error.stack
		let callstack = Array.isArray(err.stack) ? err.stack.join('\n') : err.stack;
		let msg = err.message ? err.message : safeStringify(err);

		// errors without a stack are not useful telemetry
		if (!callstack) {
			return;
		}

		this._enqueue({ msg, callstack });
	}

	protected _enqueue(e: ErrorEvent): void {

		const idx = binarySearch(this._buffer, e, ErrorEvent.compare);
		if (idx < 0) {
			e.count = 1;
			this._buffer.splice(~idx, 0, e);
		} else {
			if (!this._buffer[idx].count) {
				this._buffer[idx].count = 0;
			}
			this._buffer[idx].count! += 1;
		}

		if (this._flushHandle === -1) {
			this._flushHandle = setTimeout(() => {
				this._flushBuffer();
				this._flushHandle = -1;
			}, this._flushDelay);
		}
	}

	private _flushBuffer(): void {
		for (let error of this._buffer) {
			type UnhandledErrorClassification = {} & ErrorEventFragment;
			this._telemetryService.publicLogError2<ErrorEvent, UnhandledErrorClassification>('UnhandledError', error);
		}
		this._buffer.length = 0;
	}
}
