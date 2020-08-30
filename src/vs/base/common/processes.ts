/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment } from 'vs/base/common/platform';

/**
 * Options to be passed to the external program or shell.
 */
export interface CommandOptions {
	/**
	 * The current working directory of the executed program or shell.
	 * If omitted VSCode's current workspace root is used.
	 */
	cwd?: string;

	/**
	 * The environment of the executed program or shell. If omitted
	 * the parent process' environment is used.
	 */
	env?: { [key: string]: string; };
}

export interface Executable {
	/**
	 * The command to be executed. Can be an external program or a shell
	 * command.
	 */
	command: string;

	/**
	 * Specifies whether the command is a shell command and therefore must
	 * be executed in a shell interpreter (e.g. cmd.exe, bash, ...).
	 */
	isShellCommand: boolean;

	/**
	 * The arguments passed to the command.
	 */
	args: string[];

	/**
	 * The command options used when the command is executed. Can be omitted.
	 */
	options?: CommandOptions;
}

export interface ForkOptions extends CommandOptions {
	execArgv?: string[];
}

export const enum Source {
	stdout,
	stderr
}

/**
 * The data send via a success callback
 */
export interface SuccessData {
	error?: Error;
	cmdCode?: number;
	terminated?: boolean;
}

/**
 * The data send via a error callback
 */
export interface ErrorData {
	error?: Error;
	terminated?: boolean;
	stdout?: string;
	stderr?: string;
}

export interface TerminateResponse {
	success: boolean;
	code?: TerminateResponseCode;
	error?: any;
}

export const enum TerminateResponseCode {
	Success = 0,
	Unknown = 1,
	AccessDenied = 2,
	ProcessNotFound = 3,
}

export interface ProcessItem {
	name: string;
	cmd: string;
	pid: number;
	ppid: number;
	load: number;
	mem: number;

	children?: ProcessItem[];
}

/**
 * Sanitizes a VS Code process environment by removing all Electron/VS Code-related values.
 */
export function sanitizeProcessEnvironment(env: IProcessEnvironment, ...preserve: string[]): void {
	const set = preserve.reduce((set, key) => {
		set[key] = true;
		return set;
	}, {} as Record<string, boolean>);
	const keysToRemove = [
		/^ELECTRON_.+$/,
		/^GOOGLE_API_KEY$/,
		/^VSCODE_.+$/,
		/^SNAP(|_.*)$/
	];
	const envKeys = Object.keys(env);
	envKeys
		.filter(key => !set[key])
		.forEach(envKey => {
			for (let i = 0; i < keysToRemove.length; i++) {
				if (envKey.search(keysToRemove[i]) !== -1) {
					delete env[envKey];
					break;
				}
			}
		});
}
