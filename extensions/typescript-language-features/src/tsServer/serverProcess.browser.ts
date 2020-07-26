/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as Proto from '../protocol';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import { TsServerProcess, TsServerProcessKind } from './server';

declare const Worker: any;
declare type Worker = any;

export class WorkerServerProcess implements TsServerProcess {

	public static fork(
		tsServerPath: string,
		args: readonly string[],
		_kind: TsServerProcessKind,
		_configuration: TypeScriptServiceConfiguration,
	) {
		const worker = new Worker(tsServerPath);
		return new WorkerServerProcess(worker, args);
	}

	private _onDataHandlers = new Set<(data: Proto.Response) => void>();
	private _onErrorHandlers = new Set<(err: Error) => void>();
	private _onExitHandlers = new Set<(code: number | null) => void>();

	public constructor(
		private readonly worker: Worker,
		args: readonly string[],
	) {
		worker.addEventListener('message', (msg: any) => {
			for (const handler of this._onDataHandlers) {
				handler(msg.data);
			}
		});
		worker.postMessage(args);
	}

	write(serverRequest: Proto.Request): void {
		this.worker.postMessage(serverRequest);
	}

	onData(handler: (response: Proto.Response) => void): void {
		this._onDataHandlers.add(handler);
	}

	onError(handler: (err: Error) => void): void {
		this._onErrorHandlers.add(handler);
		// Todo: not implemented
	}

	onExit(handler: (code: number | null) => void): void {
		this._onExitHandlers.add(handler);
		// Todo: not implemented
	}

	kill(): void {
		this.worker.terminate();
	}
}
