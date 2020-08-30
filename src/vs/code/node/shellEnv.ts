/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { generateUuid } from 'vs/base/common/uuid';
import { isWindows } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';

function getUnixShellEnvironment(logService: ILogService): Promise<typeof process.env> {
	const promise = new Promise<typeof process.env>((resolve, reject) => {
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

		const command = `'${process.execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
		logService.trace('getUnixShellEnvironment#env', env);
		logService.trace('getUnixShellEnvironment#spawn', command);

		const child = spawn(process.env.SHELL!, ['-ilc', command], {
			detached: true,
			stdio: ['ignore', 'pipe', process.stderr],
			env
		});

		const buffers: Buffer[] = [];
		child.on('error', () => resolve({}));
		child.stdout.on('data', b => buffers.push(b));

		child.on('close', code => {
			if (code !== 0) {
				return reject(new Error('Failed to get environment'));
			}

			const raw = Buffer.concat(buffers).toString('utf8');
			logService.trace('getUnixShellEnvironment#raw', raw);

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

				// https://github.com/Microsoft/vscode/issues/22593#issuecomment-336050758
				delete env['XDG_RUNTIME_DIR'];

				logService.trace('getUnixShellEnvironment#result', env);
				resolve(env);
			} catch (err) {
				logService.error('getUnixShellEnvironment#error', err);
				reject(err);
			}
		});
	});

	// swallow errors
	return promise.catch(() => ({}));
}

let shellEnvPromise: Promise<typeof process.env> | undefined = undefined;

/**
 * We need to get the environment from a user's shell.
 * This should only be done when Code itself is not launched
 * from within a shell.
 */
export function getShellEnvironment(logService: ILogService, environmentService: INativeEnvironmentService): Promise<typeof process.env> {
	if (!shellEnvPromise) {
		if (environmentService.args['disable-user-env-probe']) {
			logService.trace('getShellEnvironment: disable-user-env-probe set, skipping');
			shellEnvPromise = Promise.resolve({});
		} else if (isWindows) {
			logService.trace('getShellEnvironment: running on Windows, skipping');
			shellEnvPromise = Promise.resolve({});
		} else if (process.env['VSCODE_CLI'] === '1' && process.env['VSCODE_FORCE_USER_ENV'] !== '1') {
			logService.trace('getShellEnvironment: running on CLI, skipping');
			shellEnvPromise = Promise.resolve({});
		} else {
			logService.trace('getShellEnvironment: running on Unix');
			shellEnvPromise = getUnixShellEnvironment(logService);
		}
	}

	return shellEnvPromise;
}
