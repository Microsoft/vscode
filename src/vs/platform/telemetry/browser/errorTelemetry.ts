/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toDisposable } from 'vs/base/common/lifecycle';
import { globals } from 'vs/base/common/platform';
import BaseErrorTelemetry, { ErrorEvent } from 'vs/platform/telemetry/common/errorTelemetry';

export default class ErrorTelemetry extends BaseErrorTelemetry {
	protected installErrorListeners(): void {
		let oldOnError: Function;
		let that = this;
		if (typeof globals.onerror === 'function') {
			oldOnError = globals.onerror;
		}
		globals.onerror = function (message: string, filename: string, line: number, column?: number, e?: any) {
			that._onUncaughtError(message, filename, line, column, e);
			if (oldOnError) {
				oldOnError.apply(this, arguments);
			}
		};
		this._disposables.add(toDisposable(() => {
			if (oldOnError) {
				globals.onerror = oldOnError;
			}
		}));
	}

	private _onUncaughtError(msg: string, file: string, line: number, column?: number, err?: any): void {
		let data: ErrorEvent = {
			callstack: msg,
			msg,
			file,
			line,
			column
		};

		if (err) {
			let { name, message, stack } = err;
			data.uncaught_error_name = name;
			if (message) {
				data.uncaught_error_msg = message;
			}
			if (stack) {
				data.callstack = Array.isArray(err.stack)
					? err.stack = err.stack.join('\n')
					: err.stack;
			}
		}

		this._enqueue(data);
	}
}
