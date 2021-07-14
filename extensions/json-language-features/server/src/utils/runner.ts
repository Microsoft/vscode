/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, ResponseError, LSPErrorCodes } from 'vscode-languageserver';
import { RuntimeEnvironment } from '../jsonServer';

export function formatError(message: string, err: any): string {
	if (err instanceof Error) {
		let error = <Error>err;
		return `${message}: ${error.message}\n${error.stack}`;
	} else if (typeof err === 'string') {
		return `${message}: ${err}`;
	} else if (err) {
		return `${message}: ${err.toString()}`;
	}
	return message;
}

export function runSafeAsync<T>(runtime: RuntimeEnvironment, func: () => Thenable<T>, errorVal: T, errorMessage: string, token: CancellationToken): Thenable<T | ResponseError<any>> {
	return new Promise<T | ResponseError<any>>((resolve) => {
		runtime.timer.setImmediate(() => {
			if (token.isCancellationRequested) {
				resolve(cancelValue());
			}
			return func().then(result => {
				if (token.isCancellationRequested) {
					resolve(cancelValue());
					return;
				} else {
					resolve(result);
				}
			}, e => {
				console.error(formatError(errorMessage, e));
				resolve(errorVal);
			});
		});
	});
}

export function runSafe<T, E>(runtime: RuntimeEnvironment, func: () => T, errorVal: T, errorMessage: string, token: CancellationToken): Thenable<T | ResponseError<E>> {
	return new Promise<T | ResponseError<E>>((resolve) => {
		runtime.timer.setImmediate(() => {
			if (token.isCancellationRequested) {
				resolve(cancelValue());
			} else {
				try {
					let result = func();
					if (token.isCancellationRequested) {
						resolve(cancelValue());
						return;
					} else {
						resolve(result);
					}

				} catch (e) {
					console.error(formatError(errorMessage, e));
					resolve(errorVal);
				}
			}
		});
	});
}

function cancelValue<E>() {
	console.log('cancelled');
	return new ResponseError<E>(LSPErrorCodes.RequestCancelled, 'Request cancelled');
}
