/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { Logger } from './logger';

enum Trace {
	Off,
	Messages,
	Verbose,
}

namespace Trace {
	export function fromString(value: string): Trace {
		value = value.toLowerCase();
		switch (value) {
			case 'off':
				return Trace.Off;
			case 'messages':
				return Trace.Messages;
			case 'verbose':
				return Trace.Verbose;
			default:
				return Trace.Off;
		}
	}
}

interface RequestExecutionMetadata {
	readonly queuingStartTime: number
}

export default class Tracer {
	private trace?: Trace;

	constructor(
		private readonly logger: Logger
	) {
		this.updateConfiguration();
	}

	public updateConfiguration() {
		this.trace = Tracer.readTrace();
	}

	private static readTrace(): Trace {
		let result: Trace = Trace.fromString(vscode.workspace.getConfiguration().get<string>('typescript.tsserver.trace', 'off'));
		if (result === Trace.Off && !!process.env.TSS_TRACE) {
			result = Trace.Messages;
		}
		return result;
	}

	public traceRequest(serverId: string, request: Proto.Request, responseExpected: boolean, queueLength: number): void {
		if (this.trace === Trace.Off) {
			return;
		}
		let data: string | undefined = undefined;
		if (this.trace === Trace.Verbose && request.arguments) {
			data = `Arguments: ${JSON.stringify(request.arguments, null, 4)}`;
		}
		this.logTrace(serverId, `Sending request: ${request.command} (${request.seq}). Response expected: ${responseExpected ? 'yes' : 'no'}. Current queue length: ${queueLength}`, data);
	}

	public traceResponse(serverId: string, response: Proto.Response, meta: RequestExecutionMetadata): void {
		if (this.trace === Trace.Off) {
			return;
		}
		let data: string | undefined = undefined;
		if (this.trace === Trace.Verbose && response.body) {
			data = `Result: ${JSON.stringify(response.body, null, 4)}`;
		}
		this.logTrace(serverId, `Response received: ${response.command} (${response.request_seq}). Request took ${Date.now() - meta.queuingStartTime} ms. Success: ${response.success} ${!response.success ? '. Message: ' + response.message : ''}`, data);
	}

	public traceRequestCompleted(serverId: string, command: string, request_seq: number, meta: RequestExecutionMetadata): any {
		if (this.trace === Trace.Off) {
			return;
		}
		this.logTrace(serverId, `Async response received: ${command} (${request_seq}). Request took ${Date.now() - meta.queuingStartTime} ms.`);
	}

	public traceEvent(serverId: string, event: Proto.Event): void {
		if (this.trace === Trace.Off) {
			return;
		}
		let data: string | undefined = undefined;
		if (this.trace === Trace.Verbose && event.body) {
			data = `Data: ${JSON.stringify(event.body, null, 4)}`;
		}
		this.logTrace(serverId, `Event received: ${event.event} (${event.seq}).`, data);
	}

	public logTrace(serverId: string, message: string, data?: any): void {
		if (this.trace !== Trace.Off) {
			this.logger.logLevel('Trace', `<${serverId}> ${message}`, data);
		}
	}
}
