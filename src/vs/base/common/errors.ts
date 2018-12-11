/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise, IPromiseError, IPromiseErrorDetail } from 'vs/base/common/winjs.base';

// ------ BEGIN Hook up error listeners to winjs promises

let outstandingPromiseErrors: { [id: string]: IPromiseErrorDetail; } = {};
function promiseErrorHandler(e: IPromiseError): void {

	//
	// e.detail looks like: { exception, error, promise, handler, id, parent }
	//
	const details = e.detail;
	const id = details.id;

	// If the error has a parent promise then this is not the origination of the
	//  error so we check if it has a handler, and if so we mark that the error
	//  was handled by removing it from outstandingPromiseErrors
	//
	if (details.parent) {
		if (details.handler && outstandingPromiseErrors) {
			delete outstandingPromiseErrors[id];
		}
		return;
	}

	// Indicate that this error was originated and needs to be handled
	outstandingPromiseErrors[id] = details;

	// The first time the queue fills up this iteration, schedule a timeout to
	// check if any errors are still unhandled.
	if (Object.keys(outstandingPromiseErrors).length === 1) {
		setTimeout(function () {
			const errors = outstandingPromiseErrors;
			outstandingPromiseErrors = {};
			Object.keys(errors).forEach(function (errorId) {
				const error = errors[errorId];
				if (error.exception) {
					onUnexpectedError(error.exception);
				} else if (error.error) {
					onUnexpectedError(error.error);
				}
				console.log('WARNING: Promise with no error callback:' + error.id);
				console.log(error);
				if (error.exception) {
					console.log(error.exception.stack);
				}
				if (error.error) {
					console.log(error.error);
				}
			});
		}, 0);
	}
}
TPromise.addEventListener('error', promiseErrorHandler);

// ------ END Hook up error listeners to winjs promises

export interface ErrorListenerCallback {
	(error: any): void;
}

export interface ErrorListenerUnbind {
	(): void;
}

// Avoid circular dependency on EventEmitter by implementing a subset of the interface.
export class ErrorHandler {
	private unexpectedErrorHandler: (e: any) => void;
	private listeners: ErrorListenerCallback[];

	constructor() {

		this.listeners = [];

		this.unexpectedErrorHandler = function (e: any) {
			setTimeout(() => {
				if (e.stack) {
					throw new Error(e.message + '\n\n' + e.stack);
				}

				throw e;
			}, 0);
		};
	}

	public addListener(listener: ErrorListenerCallback): ErrorListenerUnbind {
		this.listeners.push(listener);

		return () => {
			this._removeListener(listener);
		};
	}

	private emit(e: any): void {
		this.listeners.forEach((listener) => {
			listener(e);
		});
	}

	private _removeListener(listener: ErrorListenerCallback): void {
		this.listeners.splice(this.listeners.indexOf(listener), 1);
	}

	public setUnexpectedErrorHandler(newUnexpectedErrorHandler: (e: any) => void): void {
		this.unexpectedErrorHandler = newUnexpectedErrorHandler;
	}

	public getUnexpectedErrorHandler(): (e: any) => void {
		return this.unexpectedErrorHandler;
	}

	public onUnexpectedError(e: any): void {
		this.unexpectedErrorHandler(e);
		this.emit(e);
	}

	// For external errors, we don't want the listeners to be called
	public onUnexpectedExternalError(e: any): void {
		this.unexpectedErrorHandler(e);
	}
}

export const errorHandler = new ErrorHandler();

export function setUnexpectedErrorHandler(newUnexpectedErrorHandler: (e: any) => void): void {
	errorHandler.setUnexpectedErrorHandler(newUnexpectedErrorHandler);
}

export function onUnexpectedError(e: any): undefined {
	// ignore errors from cancelled promises
	if (!isPromiseCanceledError(e)) {
		errorHandler.onUnexpectedError(e);
	}
	return undefined;
}

export function onUnexpectedExternalError(e: any): undefined {
	// ignore errors from cancelled promises
	if (!isPromiseCanceledError(e)) {
		errorHandler.onUnexpectedExternalError(e);
	}
	return undefined;
}

export interface SerializedError {
	readonly $isError: true;
	readonly name: string;
	readonly message: string;
	readonly stack: string;
}

export function transformErrorForSerialization(error: Error): SerializedError;
export function transformErrorForSerialization(error: any): any;
export function transformErrorForSerialization(error: any): any {
	if (error instanceof Error) {
		let { name, message } = error;
		let stack: string = (<any>error).stacktrace || (<any>error).stack;
		return {
			$isError: true,
			name,
			message,
			stack
		};
	}

	// return as is
	return error;
}

// see https://github.com/v8/v8/wiki/Stack%20Trace%20API#basic-stack-traces
export interface V8CallSite {
	getThis(): any;
	getTypeName(): string;
	getFunction(): string;
	getFunctionName(): string;
	getMethodName(): string;
	getFileName(): string;
	getLineNumber(): number;
	getColumnNumber(): number;
	getEvalOrigin(): string;
	isToplevel(): boolean;
	isEval(): boolean;
	isNative(): boolean;
	isConstructor(): boolean;
	toString(): string;
}

const canceledName = 'Canceled';

/**
 * Checks if the given error is a promise in canceled state
 */
export function isPromiseCanceledError(error: any): boolean {
	return error instanceof Error && error.name === canceledName && error.message === canceledName;
}

/**
 * Returns an error that signals cancellation.
 */
export function canceled(): Error {
	let error = new Error(canceledName);
	error.name = error.message;
	return error;
}

export function illegalArgument(name?: string): Error {
	if (name) {
		return new Error(`Illegal argument: ${name}`);
	} else {
		return new Error('Illegal argument');
	}
}

export function illegalState(name?: string): Error {
	if (name) {
		return new Error(`Illegal state: ${name}`);
	} else {
		return new Error('Illegal state');
	}
}

export function readonly(name?: string): Error {
	return name
		? new Error(`readonly property '${name} cannot be changed'`)
		: new Error('readonly property cannot be changed');
}

export function disposed(what: string): Error {
	const result = new Error(`${what} has been disposed`);
	result.name = 'DISPOSED';
	return result;
}

export function getErrorMessage(err: any): string {
	if (!err) {
		return 'Error';
	}

	if (err.message) {
		return err.message;
	}

	if (err.stack) {
		return err.stack.split('\n')[0];
	}

	return String(err);
}
