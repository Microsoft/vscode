/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vscode';

export interface ITask<T> {
	(): T;
}

export class Delayer<T> {

	public defaultDelay: number;
	private timeout: any; // Timer
	private completionPromise: Promise<T | null> | null;
	private onSuccess: ((value: T | PromiseLike<T> | undefined) => void) | null;
	private task: ITask<T> | null;

	constructor(defaultDelay: number) {
		this.defaultDelay = defaultDelay;
		this.timeout = null;
		this.completionPromise = null;
		this.onSuccess = null;
		this.task = null;
	}

	public trigger(task: ITask<T>, delay: number = this.defaultDelay): Promise<T | null> {
		this.task = task;
		if (delay >= 0) {
			this.cancelTimeout();
		}

		if (!this.completionPromise) {
			this.completionPromise = new Promise<T | undefined>((resolve) => {
				this.onSuccess = resolve;
			}).then(() => {
				this.completionPromise = null;
				this.onSuccess = null;
				const result = this.task && this.task();
				this.task = null;
				return result;
			});
		}

		if (delay >= 0 || this.timeout === null) {
			this.timeout = setTimeout(() => {
				this.timeout = null;
				if (this.onSuccess) {
					this.onSuccess(undefined);
				}
			}, delay >= 0 ? delay : this.defaultDelay);
		}

		return this.completionPromise;
	}

	private cancelTimeout(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}
}

export function setImmediate(callback: (...args: any[]) => void, ...args: any[]): Disposable {
	if (global.setImmediate) {
		const handle = global.setImmediate(callback, ...args);
		return { dispose: () => global.clearImmediate(handle) };
	} else {
		const handle = setTimeout(callback, 0, ...args);
		return { dispose: () => clearTimeout(handle) };
	}
}
