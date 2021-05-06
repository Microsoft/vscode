/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { spawn } from 'child_process';
import { generateUuid } from 'vs/base/common/uuid';
import { IProcessEnvironment, isWindows, OS } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { isLaunchedFromCli } from 'vs/platform/environment/node/argvHelper';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { getSystemShell } from 'vs/base/node/shell';

/**
 * We need to get the environment from a user's shell.
 * This should only be done when Code itself is not launched
 * from within a shell.
 */
export async function resolveShellEnv(logService: ILogService, args: NativeParsedArgs, env: IProcessEnvironment): Promise<typeof process.env> {

	// Skip if --force-disable-user-env
	if (args['force-disable-user-env']) {
		logService.trace('resolveShellEnv(): skipped (--force-disable-user-env)');

		return {};
	}

	// Skip on windows
	else if (isWindows) {
		logService.trace('resolveShellEnv(): skipped (Windows)');

		return {};
	}

	// Skip if running from CLI already
	else if (isLaunchedFromCli(env) && !args['force-user-env']) {
		logService.trace('resolveShellEnv(): skipped (VSCODE_CLI is set)');

		return {};
	}

	// Otherwise resolve (macOS, Linux)
	else {
		if (isLaunchedFromCli(env)) {
			logService.trace('resolveShellEnv(): running (--force-user-env)');
		} else {
			logService.trace('resolveShellEnv(): running (macOS/Linux)');
		}

		if (!unixShellEnvPromise) {
			unixShellEnvPromise = doResolveUnixShellEnv(logService);
		}

		return unixShellEnvPromise;
	}
}

let unixShellEnvPromise: Promise<typeof process.env> | undefined = undefined;

async function doResolveUnixShellEnv(logService: ILogService): Promise<typeof process.env> {
	const promise = new Promise<typeof process.env>(async (resolve, reject) => {
		const runAsNode = process.env['ELECTRON_RUN_AS_NODE'];
		logService.trace('getUnixShellEnvironment#runAsNode', runAsNode);

		const noAttach = process.env['ELECTRON_NO_ATTACH_CONSOLE'];
		logService.trace('getUnixShellEnvironment#noAttach', noAttach);

		const mark = generateUuid().replace(/-/g, '').substr(0, 12);
		const regex = new RegExp(mark + '(.*)' + mark);

		const env = {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			ELECTRON_NO_ATTACH_CONSOLE: '1'
		};

		logService.trace('getUnixShellEnvironment#env', env);
		const systemShellUnix = await getSystemShell(OS, env);
		logService.trace('getUnixShellEnvironment#shell', systemShellUnix);

		// handle popular non-POSIX shells
		const name = path.basename(systemShellUnix);
		let command: string, shellArgs: Array<string>;
		if (/^pwsh(-preview)?$/.test(name)) {
			// Older versions of PowerShell removes double quotes sometimes so we use "double single quotes" which is how
			// you escape single quotes inside of a single quoted string.
			command = `& '${process.execPath}' -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`;
			shellArgs = ['-Login', '-Command'];
		} else {
			command = `'${process.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
			shellArgs = ['-ilc'];
		}

		logService.trace('getUnixShellEnvironment#spawn', JSON.stringify(shellArgs), command);

		const child = spawn(systemShellUnix, [...shellArgs, command], {
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env
		});

		child.on('error', err => {
			logService.error('getUnixShellEnvironment#errorChildProcess', toErrorMessage(err));
			resolve({});
		});

		const buffers: Buffer[] = [];
		child.stdout.on('data', b => buffers.push(b));

		const stderr: Buffer[] = [];
		child.stderr.on('data', b => stderr.push(b));

		child.on('close', (code, signal) => {
			const raw = Buffer.concat(buffers).toString('utf8');
			logService.trace('getUnixShellEnvironment#raw', raw);

			const stderrStr = Buffer.concat(stderr).toString('utf8');
			if (stderrStr.trim()) {
				logService.trace('getUnixShellEnvironment#stderr', stderrStr);
			}

			if (code || signal) {
				return reject(new Error(`Failed to get environment (code ${code}, signal ${signal})`));
			}

			const match = regex.exec(raw);
			const rawStripped = match ? match[1] : '{}';

			try {
				const env = JSON.parse(rawStripped);

				if (runAsNode) {
					env['ELECTRON_RUN_AS_NODE'] = runAsNode;
				} else {
					delete env['ELECTRON_RUN_AS_NODE'];
				}

				if (noAttach) {
					env['ELECTRON_NO_ATTACH_CONSOLE'] = noAttach;
				} else {
					delete env['ELECTRON_NO_ATTACH_CONSOLE'];
				}

				// https://github.com/microsoft/vscode/issues/22593#issuecomment-336050758
				delete env['XDG_RUNTIME_DIR'];

				logService.trace('getUnixShellEnvironment#result', env);
				resolve(env);
			} catch (err) {
				logService.error('getUnixShellEnvironment#errorCaught', toErrorMessage(err));
				reject(err);
			}
		});
	});

	try {
		return await promise;
	} catch (error) {
		logService.error('getUnixShellEnvironment#error', toErrorMessage(error));

		return {}; // ignore any errors
	}
}
