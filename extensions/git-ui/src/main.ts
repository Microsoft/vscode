/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext, commands } from 'vscode';

import * as cp from 'child_process';

export async function deactivate(): Promise<any> {
}

export async function activate(context: ExtensionContext): Promise<void> {
	context.subscriptions.push(commands.registerCommand('git.credential', async (data: any) => {
		try {
			const { stdout, stderr } = await exec(`git credential ${data.command}`, {
				stdin: data.stdin,
				env: Object.assign(process.env, { GIT_TERMINAL_PROMPT: '0' })
			});
			return { stdout, stderr, code: 0 };
		} catch ({ stdout, stderr, error }) {
			const code = error.code || 0;
			if (stderr.indexOf('terminal prompts disabled') !== -1) {
				stderr = '';
			}
			return { stdout, stderr, code };
		}
	}));
}

export interface ExecResult {
	error: Error | null;
	stdout: string;
	stderr: string;
}


export function exec(command: string, options: cp.ExecOptions & { stdin?: string } = {}) {
	return new Promise<ExecResult>((resolve, reject) => {
		const child = cp.exec(command, options, (error, stdout, stderr) => {
			(error ? reject : resolve)({ error, stdout, stderr });
		});
		if (options.stdin) {
			child.stdin!.write(options.stdin, (err: any) => {
				if (err) {
					reject(err);
					return;
				}
				child.stdin!.end((err: any) => {
					if (err) {
						reject(err);
					}
				});
			});
		}
	});
}
