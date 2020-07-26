/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import type * as Proto from '../protocol';
import { TypeScriptServiceConfiguration } from '../utils/configuration';
import { Disposable } from '../utils/dispose';
import { TsServerProcess, TsServerProcessKind } from './server';
import { TypeScriptVersionManager } from './versionManager';

const localize = nls.loadMessageBundle();

const defaultSize: number = 8192;
const contentLength: string = 'Content-Length: ';
const contentLengthSize: number = Buffer.byteLength(contentLength, 'utf8');
const blank: number = Buffer.from(' ', 'utf8')[0];
const backslashR: number = Buffer.from('\r', 'utf8')[0];
const backslashN: number = Buffer.from('\n', 'utf8')[0];

class ProtocolBuffer {

	private index: number = 0;
	private buffer: Buffer = Buffer.allocUnsafe(defaultSize);

	public append(data: string | Buffer): void {
		let toAppend: Buffer | null = null;
		if (Buffer.isBuffer(data)) {
			toAppend = data;
		} else {
			toAppend = Buffer.from(data, 'utf8');
		}
		if (this.buffer.length - this.index >= toAppend.length) {
			toAppend.copy(this.buffer, this.index, 0, toAppend.length);
		} else {
			let newSize = (Math.ceil((this.index + toAppend.length) / defaultSize) + 1) * defaultSize;
			if (this.index === 0) {
				this.buffer = Buffer.allocUnsafe(newSize);
				toAppend.copy(this.buffer, 0, 0, toAppend.length);
			} else {
				this.buffer = Buffer.concat([this.buffer.slice(0, this.index), toAppend], newSize);
			}
		}
		this.index += toAppend.length;
	}

	public tryReadContentLength(): number {
		let result = -1;
		let current = 0;
		// we are utf8 encoding...
		while (current < this.index && (this.buffer[current] === blank || this.buffer[current] === backslashR || this.buffer[current] === backslashN)) {
			current++;
		}
		if (this.index < current + contentLengthSize) {
			return result;
		}
		current += contentLengthSize;
		let start = current;
		while (current < this.index && this.buffer[current] !== backslashR) {
			current++;
		}
		if (current + 3 >= this.index || this.buffer[current + 1] !== backslashN || this.buffer[current + 2] !== backslashR || this.buffer[current + 3] !== backslashN) {
			return result;
		}
		let data = this.buffer.toString('utf8', start, current);
		result = parseInt(data);
		this.buffer = this.buffer.slice(current + 4);
		this.index = this.index - (current + 4);
		return result;
	}

	public tryReadContent(length: number): string | null {
		if (this.index < length) {
			return null;
		}
		let result = this.buffer.toString('utf8', 0, length);
		let sourceStart = length;
		while (sourceStart < this.index && (this.buffer[sourceStart] === backslashR || this.buffer[sourceStart] === backslashN)) {
			sourceStart++;
		}
		this.buffer.copy(this.buffer, 0, sourceStart);
		this.index = this.index - sourceStart;
		return result;
	}
}

class Reader<T> extends Disposable {

	private readonly buffer: ProtocolBuffer = new ProtocolBuffer();
	private nextMessageLength: number = -1;

	public constructor(readable: Readable) {
		super();
		readable.on('data', data => this.onLengthData(data));
	}

	private readonly _onError = this._register(new vscode.EventEmitter<Error>());
	public readonly onError = this._onError.event;

	private readonly _onData = this._register(new vscode.EventEmitter<T>());
	public readonly onData = this._onData.event;

	private onLengthData(data: Buffer | string): void {
		if (this.isDisposed) {
			return;
		}

		try {
			this.buffer.append(data);
			while (true) {
				if (this.nextMessageLength === -1) {
					this.nextMessageLength = this.buffer.tryReadContentLength();
					if (this.nextMessageLength === -1) {
						return;
					}
				}
				const msg = this.buffer.tryReadContent(this.nextMessageLength);
				if (msg === null) {
					return;
				}
				this.nextMessageLength = -1;
				const json = JSON.parse(msg);
				this._onData.fire(json);
			}
		} catch (e) {
			this._onError.fire(e);
		}
	}
}

export class ChildServerProcess extends Disposable implements TsServerProcess {
	private readonly _reader: Reader<Proto.Response>;

	public static fork(
		tsServerPath: string,
		args: readonly string[],
		kind: TsServerProcessKind,
		configuration: TypeScriptServiceConfiguration,
		versionManager: TypeScriptVersionManager,
	): ChildServerProcess {
		if (!fs.existsSync(tsServerPath)) {
			vscode.window.showWarningMessage(localize('noServerFound', 'The path {0} doesn\'t point to a valid tsserver install. Falling back to bundled TypeScript version.', tsServerPath));
			versionManager.reset();
			tsServerPath = versionManager.currentVersion.tsServerPath;
		}

		const childProcess = child_process.fork(tsServerPath, args, {
			silent: true,
			cwd: undefined,
			env: this.generatePatchedEnv(process.env, tsServerPath),
			execArgv: this.getExecArgv(kind, configuration),
		});

		return new ChildServerProcess(childProcess);
	}

	private static generatePatchedEnv(env: any, modulePath: string): any {
		const newEnv = Object.assign({}, env);

		newEnv['ELECTRON_RUN_AS_NODE'] = '1';
		newEnv['NODE_PATH'] = path.join(modulePath, '..', '..', '..');

		// Ensure we always have a PATH set
		newEnv['PATH'] = newEnv['PATH'] || process.env.PATH;

		return newEnv;
	}

	private static getExecArgv(kind: TsServerProcessKind, configuration: TypeScriptServiceConfiguration): string[] {
		const debugPort = this.getDebugPort(kind);
		const inspectFlag = process.env['TSS_DEBUG_BRK'] ? '--inspect-brk' : '--inspect';
		return [
			...(debugPort ? [`${inspectFlag}=${debugPort}`] : []),
			...(configuration.maxTsServerMemory ? [`--max-old-space-size=${configuration.maxTsServerMemory}`] : [])
		];
	}

	private static getDebugPort(kind: TsServerProcessKind): number | undefined {
		if (kind === TsServerProcessKind.Syntax) {
			// We typically only want to debug the main semantic server
			return undefined;
		}
		const value = process.env['TSS_DEBUG_BRK'] || process.env['TSS_DEBUG'];
		if (value) {
			const port = parseInt(value);
			if (!isNaN(port)) {
				return port;
			}
		}
		return undefined;
	}

	private constructor(
		private readonly _process: child_process.ChildProcess,
	) {
		super();
		this._reader = this._register(new Reader<Proto.Response>(this._process.stdout!));
	}

	write(serverRequest: Proto.Request): void {
		this._process.stdin!.write(JSON.stringify(serverRequest) + '\r\n', 'utf8');
	}

	onData(handler: (data: Proto.Response) => void): void {
		this._reader.onData(handler);
	}

	onExit(handler: (code: number | null) => void): void {
		this._process.on('exit', handler);
	}

	onError(handler: (err: Error) => void): void {
		this._process.on('error', handler);
		this._reader.onError(handler);
	}

	kill(): void {
		this._process.kill();
		this._reader.dispose();
	}
}
