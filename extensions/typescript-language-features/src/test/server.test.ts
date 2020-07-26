/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as stream from 'stream';
import type * as Proto from '../protocol';
import { NodeRequestCanceller } from '../tsServer/cancellation.electron';
import { ProcessBasedTsServer, TsServerProcess } from '../tsServer/server';
import { nulToken } from '../utils/cancellation';
import { Logger } from '../utils/logger';
import { TelemetryReporter } from '../utils/telemetry';
import Tracer from '../utils/tracer';


const NoopTelemetryReporter = new class implements TelemetryReporter {
	logTelemetry(): void { /* noop */ }
	dispose(): void { /* noop */ }
};

class FakeServerProcess implements TsServerProcess {
	private readonly _out: stream.PassThrough;

	private readonly writeListeners = new Set<(data: Buffer) => void>();
	public stdout: stream.PassThrough;

	constructor() {
		this._out = new stream.PassThrough();
		this.stdout = this._out;
	}

	public write(data: Proto.Request) {
		const listeners = Array.from(this.writeListeners);
		this.writeListeners.clear();

		setImmediate(() => {
			for (const listener of listeners) {
				listener(Buffer.from(JSON.stringify(data), 'utf8'));
			}
			const body = Buffer.from(JSON.stringify({ 'seq': data.seq, 'type': 'response', 'command': data.command, 'request_seq': data.seq, 'success': true }), 'utf8');
			this._out.write(Buffer.from(`Content-Length: ${body.length}\r\n\r\n${body}`, 'utf8'));
		});
	}

	onData(_handler: any) { /* noop */ }
	onError(_handler: any) { /* noop */ }
	onExit(_handler: any) { /* noop */ }

	kill(): void { /* noop */ }

	public onWrite(): Promise<any> {
		return new Promise<string>((resolve) => {
			this.writeListeners.add((data) => {
				resolve(JSON.parse(data.toString()));
			});
		});
	}
}

suite('Server', () => {
	const tracer = new Tracer(new Logger());

	test('should send requests with increasing sequence numbers', async () => {
		const process = new FakeServerProcess();
		const server = new ProcessBasedTsServer('semantic', process, undefined, new NodeRequestCanceller('semantic', tracer), undefined!, NoopTelemetryReporter, tracer);

		const onWrite1 = process.onWrite();
		server.executeImpl('geterr', {}, { isAsync: false, token: nulToken, expectsResult: true });
		assert.strictEqual((await onWrite1).seq, 0);

		const onWrite2 = process.onWrite();
		server.executeImpl('geterr', {}, { isAsync: false, token: nulToken, expectsResult: true });
		assert.strictEqual((await onWrite2).seq, 1);
	});
});

