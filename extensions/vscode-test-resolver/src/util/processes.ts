/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as cp from 'child_process';
import * as path from 'path';

export interface TerminateResponse {
	success: boolean;
	error?: any;
}

export function terminateProcess(p: cp.ChildProcess, extensionPath: string): TerminateResponse {
	if (process.platform === 'win32') {
		try {
			const options: any = {
				stdio: ['pipe', 'pipe', 'ignore']
			};
			cp.execFileSync('taskkill', ['/T', '/F', '/PID', p.pid.toString()], options);
		} catch (err) {
			return { success: false, error: err };
		}
	} else if (process.platform === 'darwin' || process.platform === 'linux') {
		try {
			const cmd = path.join(extensionPath, 'scripts', 'terminateProcess.sh');
			const result = cp.spawnSync(cmd, [process.pid.toString()]);
			if (result.error) {
				return { success: false, error: result.error };
			}
		} catch (err) {
			return { success: false, error: err };
		}
	} else {
		p.kill('SIGKILL');
	}
	return { success: true };
}
