/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { canceled } from 'vs/base/common/errors';
import { isWindows } from 'vs/base/common/platform';

export type ValueCallback<T = any> = (value: T | Promise<T>) => void;

export class DeferredPromise<T> {

	private completeCallback!: ValueCallback<T>;
	private errorCallback!: (err: any) => void;

	public p: Promise<any>;

	constructor() {
		this.p = new Promise<any>((c, e) => {
			this.completeCallback = c;
			this.errorCallback = e;
		});
	}

	public complete(value: T) {
		return new Promise(resolve => {
			this.completeCallback(value);
			resolve();
		});
	}

	public error(err: any) {
		return new Promise(resolve => {
			this.errorCallback(err);
			resolve();
		});
	}

	public cancel() {
		new Promise(resolve => {
			this.errorCallback(canceled());
			resolve();
		});
	}
}

export function toResource(this: any, path: string) {
	if (isWindows) {
		return URI.file(join('C:\\', btoa(this.test.fullTitle()), path));
	}

	return URI.file(join('/', btoa(this.test.fullTitle()), path));
}

export function suiteRepeat(n: number, description: string, callback: (this: any) => void): void {
	for (let i = 0; i < n; i++) {
		suite(`${description} (iteration ${i})`, callback);
	}
}

export function testRepeat(n: number, description: string, callback: (this: any, done: MochaDone) => any): void {
	for (let i = 0; i < n; i++) {
		test(`${description} (iteration ${i})`, callback);
	}
}

export function testRepeatOnly(n: number, description: string, callback: (this: any, done: MochaDone) => any): void {
	suite.only('repeat', () => testRepeat(n, description, callback));
}
