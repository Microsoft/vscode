/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { globals } from 'vs/base/common/platform';
import { IWorker, IWorkerCallback, IWorkerFactory, logOnceWebWorkerWarning } from 'vs/base/common/worker/simpleWorker';

const ttPolicy = window.trustedTypes?.createPolicy('defaultWorkerFactory', { createScriptURL: value => value });

function getWorker(workerId: string, label: string): Worker | Promise<Worker> {
	// Option for hosts to overwrite the worker script (used in the standalone editor)
	if (globals.MonacoEnvironment) {
		if (typeof globals.MonacoEnvironment.getWorker === 'function') {
			return globals.MonacoEnvironment.getWorker(workerId, label);
		}
		if (typeof globals.MonacoEnvironment.getWorkerUrl === 'function') {
			const wokerUrl = <string>globals.MonacoEnvironment.getWorkerUrl(workerId, label);
			return new Worker(ttPolicy ? ttPolicy.createScriptURL(wokerUrl) as unknown as string : wokerUrl, { name: label });
		}
	}
	// ESM-comment-begin
	if (typeof require === 'function') {
		// check if the JS lives on a different origin
		const workerMain = require.toUrl('./' + workerId); // explicitly using require.toUrl(), see https://github.com/microsoft/vscode/issues/107440#issuecomment-698982321
		const workerUrl = getWorkerBootstrapUrl(workerMain, label);
		return new Worker(ttPolicy ? ttPolicy.createScriptURL(workerUrl) as unknown as string : workerUrl, { name: label });
	}
	// ESM-comment-end
	throw new Error(`You must define a function MonacoEnvironment.getWorkerUrl or MonacoEnvironment.getWorker`);
}

// ESM-comment-begin
export function getWorkerBootstrapUrl(scriptPath: string, label: string): string {
	if (/^((http:)|(https:)|(file:))/.test(scriptPath) && scriptPath.substring(0, self.origin.length) !== self.origin) {
		// this is the cross-origin case
		// i.e. the webpage is running at a different origin than where the scripts are loaded from
		const myPath = 'vs/base/worker/defaultWorkerFactory.js';
		const workerBaseUrl = require.toUrl(myPath).slice(0, -myPath.length); // explicitly using require.toUrl(), see https://github.com/microsoft/vscode/issues/107440#issuecomment-698982321
		const js = `/*${label}*/self.MonacoEnvironment={baseUrl: '${workerBaseUrl}'};importScripts('${scriptPath}');/*${label}*/`;
		const blob = new Blob([js], { type: 'application/javascript' });
		return URL.createObjectURL(blob);
	}
	return scriptPath + '#' + label;
}
// ESM-comment-end

function isPromiseLike<T>(obj: any): obj is PromiseLike<T> {
	if (typeof obj.then === 'function') {
		return true;
	}
	return false;
}

/**
 * A worker that uses HTML5 web workers so that is has
 * its own global scope and its own thread.
 */
class WebWorker implements IWorker {

	private id: number;
	private worker: Promise<Worker> | null;

	constructor(moduleId: string, id: number, label: string, onMessageCallback: IWorkerCallback, onErrorCallback: (err: any) => void) {
		this.id = id;
		const workerOrPromise = getWorker('workerMain.js', label);
		if (isPromiseLike(workerOrPromise)) {
			this.worker = workerOrPromise;
		} else {
			this.worker = Promise.resolve(workerOrPromise);
		}
		this.postMessage(moduleId, []);
		this.worker.then((w) => {
			w.onmessage = function (ev: any) {
				onMessageCallback(ev.data);
			};
			(<any>w).onmessageerror = onErrorCallback;
			if (typeof w.addEventListener === 'function') {
				w.addEventListener('error', onErrorCallback);
			}
		});
	}

	public getId(): number {
		return this.id;
	}

	public postMessage(message: any, transfer: Transferable[]): void {
		if (this.worker) {
			this.worker.then(w => w.postMessage(message, transfer));
		}
	}

	public dispose(): void {
		if (this.worker) {
			this.worker.then(w => w.terminate());
		}
		this.worker = null;
	}
}

export class DefaultWorkerFactory implements IWorkerFactory {

	private static LAST_WORKER_ID = 0;

	private _label: string | undefined;
	private _webWorkerFailedBeforeError: any;

	constructor(label: string | undefined) {
		this._label = label;
		this._webWorkerFailedBeforeError = false;
	}

	public create(moduleId: string, onMessageCallback: IWorkerCallback, onErrorCallback: (err: any) => void): IWorker {
		let workerId = (++DefaultWorkerFactory.LAST_WORKER_ID);

		if (this._webWorkerFailedBeforeError) {
			throw this._webWorkerFailedBeforeError;
		}

		return new WebWorker(moduleId, workerId, this._label || 'anonymous' + workerId, onMessageCallback, (err) => {
			logOnceWebWorkerWarning(err);
			this._webWorkerFailedBeforeError = err;
			onErrorCallback(err);
		});
	}
}
