/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as fs from 'fs';
import * as pfs from 'vs/base/node/pfs';
import * as cp from 'child_process';
import * as nls from 'vs/nls';
import * as process from 'vs/base/common/process';
import * as Types from 'vs/base/common/types';
import { IStringDictionary } from 'vs/base/common/collections';
import * as Objects from 'vs/base/common/objects';
import * as extpath from 'vs/base/common/extpath';
import * as Platform from 'vs/base/common/platform';
import { LineDecoder } from 'vs/base/node/decoder';
import { CommandOptions, ForkOptions, SuccessData, Source, TerminateResponse, TerminateResponseCode, Executable } from 'vs/base/common/processes';
import { FileAccess } from 'vs/base/common/network';
export { CommandOptions, ForkOptions, SuccessData, Source, TerminateResponse, TerminateResponseCode };

export type ValueCallback<T> = (value: T | Promise<T>) => void;
export type ErrorCallback = (error?: any) => void;
export type ProgressCallback<T> = (progress: T) => void;

export interface LineData {
	line: string;
	source: Source;
}

function getWindowsCode(status: number): TerminateResponseCode {
	switch (status) {
		case 0:
			return TerminateResponseCode.Success;
		case 1:
			return TerminateResponseCode.AccessDenied;
		case 128:
			return TerminateResponseCode.ProcessNotFound;
		default:
			return TerminateResponseCode.Unknown;
	}
}

function terminateProcess(process: cp.ChildProcess, cwd?: string): Promise<TerminateResponse> {
	if (Platform.isWindows) {
		try {
			const options: any = {
				stdio: ['pipe', 'pipe', 'ignore']
			};
			if (cwd) {
				options.cwd = cwd;
			}
			const killProcess = cp.execFile('taskkill', ['/T', '/F', '/PID', process.pid.toString()], options);
			return new Promise(resolve => {
				killProcess.once('error', (err) => {
					resolve({ success: false, error: err });
				});
				killProcess.once('exit', (code, signal) => {
					if (code === 0) {
						resolve({ success: true });
					} else {
						resolve({ success: false, code: code !== null ? code : TerminateResponseCode.Unknown });
					}
				});
			});
		} catch (err) {
			return Promise.resolve({ success: false, error: err, code: err.status ? getWindowsCode(err.status) : TerminateResponseCode.Unknown });
		}
	} else if (Platform.isLinux || Platform.isMacintosh) {
		try {
			const cmd = FileAccess.asFileUri('vs/base/node/terminateProcess.sh', require).fsPath;
			return new Promise(resolve => {
				cp.execFile(cmd, [process.pid.toString()], { encoding: 'utf8', shell: true } as cp.ExecFileOptions, (err, stdout, stderr) => {
					if (err) {
						resolve({ success: false, error: err });
					} else {
						resolve({ success: true });
					}
				});
			});
		} catch (err) {
			return Promise.resolve({ success: false, error: err });
		}
	} else {
		process.kill('SIGKILL');
	}
	return Promise.resolve({ success: true });
}

export function getWindowsShell(env = process.env as Platform.IProcessEnvironment): string {
	return env['comspec'] || 'cmd.exe';
}

export abstract class AbstractProcess<TProgressData> {
	private cmd: string;
	private args: string[];
	private options: CommandOptions | ForkOptions;
	protected shell: boolean;

	private childProcess: cp.ChildProcess | null;
	protected childProcessPromise: Promise<cp.ChildProcess> | null;
	private pidResolve: ValueCallback<number> | undefined;
	protected terminateRequested: boolean;

	private static WellKnowCommands: IStringDictionary<boolean> = {
		'ant': true,
		'cmake': true,
		'eslint': true,
		'gradle': true,
		'grunt': true,
		'gulp': true,
		'jake': true,
		'jenkins': true,
		'jshint': true,
		'make': true,
		'maven': true,
		'msbuild': true,
		'msc': true,
		'nmake': true,
		'npm': true,
		'rake': true,
		'tsc': true,
		'xbuild': true
	};

	public constructor(executable: Executable);
	public constructor(cmd: string, args: string[] | undefined, shell: boolean, options: CommandOptions | undefined);
	public constructor(arg1: string | Executable, arg2?: string[], arg3?: boolean, arg4?: CommandOptions) {
		if (arg2 !== undefined && arg3 !== undefined && arg4 !== undefined) {
			this.cmd = <string>arg1;
			this.args = arg2;
			this.shell = arg3;
			this.options = arg4;
		} else {
			const executable = <Executable>arg1;
			this.cmd = executable.command;
			this.shell = executable.isShellCommand;
			this.args = executable.args.slice(0);
			this.options = executable.options || {};
		}

		this.childProcess = null;
		this.childProcessPromise = null;
		this.terminateRequested = false;

		if (this.options.env) {
			const newEnv: IStringDictionary<string> = Object.create(null);
			Object.keys(process.env).forEach((key) => {
				newEnv[key] = process.env[key]!;
			});
			Object.keys(this.options.env).forEach((key) => {
				newEnv[key] = this.options.env![key]!;
			});
			this.options.env = newEnv;
		}
	}

	public getSanitizedCommand(): string {
		let result = this.cmd.toLowerCase();
		const index = result.lastIndexOf(path.sep);
		if (index !== -1) {
			result = result.substring(index + 1);
		}
		if (AbstractProcess.WellKnowCommands[result]) {
			return result;
		}
		return 'other';
	}

	public start(pp: ProgressCallback<TProgressData>): Promise<SuccessData> {
		if (Platform.isWindows && ((this.options && this.options.cwd && extpath.isUNC(this.options.cwd)) || !this.options && extpath.isUNC(process.cwd()))) {
			return Promise.reject(new Error(nls.localize('TaskRunner.UNC', 'Can\'t execute a shell command on a UNC drive.')));
		}
		return this.useExec().then((useExec) => {
			let cc: ValueCallback<SuccessData>;
			let ee: ErrorCallback;
			const result = new Promise<any>((c, e) => {
				cc = c;
				ee = e;
			});

			if (useExec) {
				let cmd: string = this.cmd;
				if (this.args) {
					cmd = cmd + ' ' + this.args.join(' ');
				}
				this.childProcess = cp.exec(cmd, this.options, (error, stdout, stderr) => {
					this.childProcess = null;
					const err: any = error;
					// This is tricky since executing a command shell reports error back in case the executed command return an
					// error or the command didn't exist at all. So we can't blindly treat an error as a failed command. So we
					// always parse the output and report success unless the job got killed.
					if (err && err.killed) {
						ee({ killed: this.terminateRequested, stdout: stdout.toString(), stderr: stderr.toString() });
					} else {
						this.handleExec(cc, pp, error, stdout as any, stderr as any);
					}
				});
			} else {
				let childProcess: cp.ChildProcess | null = null;
				const closeHandler = (data: any) => {
					this.childProcess = null;
					this.childProcessPromise = null;
					this.handleClose(data, cc, pp, ee);
					const result: SuccessData = {
						terminated: this.terminateRequested
					};
					if (Types.isNumber(data)) {
						result.cmdCode = <number>data;
					}
					cc(result);
				};
				if (this.shell && Platform.isWindows) {
					const options: any = Objects.deepClone(this.options);
					options.windowsVerbatimArguments = true;
					options.detached = false;
					let quotedCommand: boolean = false;
					let quotedArg: boolean = false;
					const commandLine: string[] = [];
					let quoted = this.ensureQuotes(this.cmd);
					commandLine.push(quoted.value);
					quotedCommand = quoted.quoted;
					if (this.args) {
						this.args.forEach((elem) => {
							quoted = this.ensureQuotes(elem);
							commandLine.push(quoted.value);
							quotedArg = quotedArg && quoted.quoted;
						});
					}
					const args: string[] = [
						'/s',
						'/c',
					];
					if (quotedCommand) {
						if (quotedArg) {
							args.push('"' + commandLine.join(' ') + '"');
						} else if (commandLine.length > 1) {
							args.push('"' + commandLine[0] + '"' + ' ' + commandLine.slice(1).join(' '));
						} else {
							args.push('"' + commandLine[0] + '"');
						}
					} else {
						args.push(commandLine.join(' '));
					}
					childProcess = cp.spawn(getWindowsShell(), args, options);
				} else {
					if (this.cmd) {
						childProcess = cp.spawn(this.cmd, this.args, this.options);
					}
				}
				if (childProcess) {
					this.childProcess = childProcess;
					this.childProcessPromise = Promise.resolve(childProcess);
					if (this.pidResolve) {
						this.pidResolve(Types.isNumber(childProcess.pid) ? childProcess.pid : -1);
						this.pidResolve = undefined;
					}
					childProcess.on('error', (error: Error) => {
						this.childProcess = null;
						ee({ terminated: this.terminateRequested, error: error });
					});
					if (childProcess.pid) {
						this.childProcess.on('close', closeHandler);
						this.handleSpawn(childProcess, cc!, pp, ee!, true);
					}
				}
			}
			return result;
		});
	}

	protected abstract handleExec(cc: ValueCallback<SuccessData>, pp: ProgressCallback<TProgressData>, error: Error | null, stdout: Buffer, stderr: Buffer): void;
	protected abstract handleSpawn(childProcess: cp.ChildProcess, cc: ValueCallback<SuccessData>, pp: ProgressCallback<TProgressData>, ee: ErrorCallback, sync: boolean): void;

	protected handleClose(data: any, cc: ValueCallback<SuccessData>, pp: ProgressCallback<TProgressData>, ee: ErrorCallback): void {
		// Default is to do nothing.
	}

	private static readonly regexp = /^[^"].* .*[^"]/;
	private ensureQuotes(value: string) {
		if (AbstractProcess.regexp.test(value)) {
			return {
				value: '"' + value + '"', //`"${value}"`,
				quoted: true
			};
		} else {
			return {
				value: value,
				quoted: value.length > 0 && value[0] === '"' && value[value.length - 1] === '"'
			};
		}
	}

	public get pid(): Promise<number> {
		if (this.childProcessPromise) {
			return this.childProcessPromise.then(childProcess => childProcess.pid, err => -1);
		} else {
			return new Promise<number>((resolve) => {
				this.pidResolve = resolve;
			});
		}
	}

	public terminate(): Promise<TerminateResponse> {
		if (!this.childProcessPromise) {
			return Promise.resolve<TerminateResponse>({ success: true });
		}
		return this.childProcessPromise.then((childProcess) => {
			this.terminateRequested = true;
			return terminateProcess(childProcess, this.options.cwd).then(response => {
				if (response.success) {
					this.childProcess = null;
				}
				return response;
			});
		}, (err) => {
			return { success: true };
		});
	}

	private useExec(): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			if (!this.shell || !Platform.isWindows) {
				return resolve(false);
			}
			const cmdShell = cp.spawn(getWindowsShell(), ['/s', '/c']);
			cmdShell.on('error', (error: Error) => {
				return resolve(true);
			});
			cmdShell.on('exit', (data: any) => {
				return resolve(false);
			});
		});
	}
}

export class LineProcess extends AbstractProcess<LineData> {

	private stdoutLineDecoder: LineDecoder | null;
	private stderrLineDecoder: LineDecoder | null;

	public constructor(executable: Executable);
	public constructor(cmd: string, args: string[], shell: boolean, options: CommandOptions);
	public constructor(arg1: string | Executable, arg2?: string[], arg3?: boolean | ForkOptions, arg4?: CommandOptions) {
		super(<any>arg1, arg2, <any>arg3, arg4);

		this.stdoutLineDecoder = null;
		this.stderrLineDecoder = null;
	}

	protected handleExec(cc: ValueCallback<SuccessData>, pp: ProgressCallback<LineData>, error: Error, stdout: Buffer, stderr: Buffer) {
		[stdout, stderr].forEach((buffer: Buffer, index: number) => {
			const lineDecoder = new LineDecoder();
			const lines = lineDecoder.write(buffer);
			lines.forEach((line) => {
				pp({ line: line, source: index === 0 ? Source.stdout : Source.stderr });
			});
			const line = lineDecoder.end();
			if (line) {
				pp({ line: line, source: index === 0 ? Source.stdout : Source.stderr });
			}
		});
		cc({ terminated: this.terminateRequested, error: error });
	}

	protected handleSpawn(childProcess: cp.ChildProcess, cc: ValueCallback<SuccessData>, pp: ProgressCallback<LineData>, ee: ErrorCallback, sync: boolean): void {
		const stdoutLineDecoder = new LineDecoder();
		const stderrLineDecoder = new LineDecoder();
		childProcess.stdout!.on('data', (data: Buffer) => {
			const lines = stdoutLineDecoder.write(data);
			lines.forEach(line => pp({ line: line, source: Source.stdout }));
		});
		childProcess.stderr!.on('data', (data: Buffer) => {
			const lines = stderrLineDecoder.write(data);
			lines.forEach(line => pp({ line: line, source: Source.stderr }));
		});

		this.stdoutLineDecoder = stdoutLineDecoder;
		this.stderrLineDecoder = stderrLineDecoder;
	}

	protected override handleClose(data: any, cc: ValueCallback<SuccessData>, pp: ProgressCallback<LineData>, ee: ErrorCallback): void {
		const stdoutLine = this.stdoutLineDecoder ? this.stdoutLineDecoder.end() : null;
		if (stdoutLine) {
			pp({ line: stdoutLine, source: Source.stdout });
		}
		const stderrLine = this.stderrLineDecoder ? this.stderrLineDecoder.end() : null;
		if (stderrLine) {
			pp({ line: stderrLine, source: Source.stderr });
		}
	}
}

export interface IQueuedSender {
	send: (msg: any) => void;
}

// Wrapper around process.send() that will queue any messages if the internal node.js
// queue is filled with messages and only continue sending messages when the internal
// queue is free again to consume messages.
// On Windows we always wait for the send() method to return before sending the next message
// to workaround https://github.com/nodejs/node/issues/7657 (IPC can freeze process)
export function createQueuedSender(childProcess: cp.ChildProcess): IQueuedSender {
	let msgQueue: string[] = [];
	let useQueue = false;

	const send = function (msg: any): void {
		if (useQueue) {
			msgQueue.push(msg); // add to the queue if the process cannot handle more messages
			return;
		}

		const result = childProcess.send(msg, (error: Error | null) => {
			if (error) {
				console.error(error); // unlikely to happen, best we can do is log this error
			}

			useQueue = false; // we are good again to send directly without queue

			// now send all the messages that we have in our queue and did not send yet
			if (msgQueue.length > 0) {
				const msgQueueCopy = msgQueue.slice(0);
				msgQueue = [];
				msgQueueCopy.forEach(entry => send(entry));
			}
		});

		if (!result || Platform.isWindows /* workaround https://github.com/nodejs/node/issues/7657 */) {
			useQueue = true;
		}
	};

	return { send };
}

export namespace win32 {
	export async function findExecutable(command: string, cwd?: string, paths?: string[]): Promise<string> {
		// If we have an absolute path then we take it.
		if (path.isAbsolute(command)) {
			return command;
		}
		if (cwd === undefined) {
			cwd = process.cwd();
		}
		const dir = path.dirname(command);
		if (dir !== '.') {
			// We have a directory and the directory is relative (see above). Make the path absolute
			// to the current working directory.
			return path.join(cwd, command);
		}
		if (paths === undefined && Types.isString(process.env['PATH'])) {
			paths = process.env['PATH'].split(path.delimiter);
		}
		// No PATH environment. Make path absolute to the cwd.
		if (paths === undefined || paths.length === 0) {
			return path.join(cwd, command);
		}

		async function fileExists(path: string): Promise<boolean> {
			if (await pfs.exists(path)) {
				return !((await fs.promises.stat(path)).isDirectory());
			}
			return false;
		}

		// We have a simple file name. We get the path variable from the env
		// and try to find the executable on the path.
		for (let pathEntry of paths) {
			// The path entry is absolute.
			let fullPath: string;
			if (path.isAbsolute(pathEntry)) {
				fullPath = path.join(pathEntry, command);
			} else {
				fullPath = path.join(cwd, pathEntry, command);
			}
			if (await fileExists(fullPath)) {
				return fullPath;
			}
			let withExtension = fullPath + '.com';
			if (await fileExists(withExtension)) {
				return withExtension;
			}
			withExtension = fullPath + '.exe';
			if (await fileExists(withExtension)) {
				return withExtension;
			}
		}
		return path.join(cwd, command);
	}
}
