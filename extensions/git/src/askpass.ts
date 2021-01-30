/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window, InputBoxOptions, Uri, OutputChannel, Disposable, workspace } from 'vscode';
import { IDisposable, EmptyDisposable, toDisposable } from './util';
import * as path from 'path';
import { IIPCHandler, IIPCServer, createIPCServer } from './ipc/ipcServer';
import { CredentialsProvider, Credentials } from './api/git';

export class Askpass implements IIPCHandler {

	private disposable: IDisposable = EmptyDisposable;
	private cache = new Map<string, Credentials>();
	private credentialsProviders = new Set<CredentialsProvider>();

	static async create(outputChannel: OutputChannel, context?: string): Promise<Askpass> {
		try {
			return new Askpass(await createIPCServer(context));
		} catch (err) {
			outputChannel.appendLine(`[error] Failed to create git askpass IPC: ${err}`);
			return new Askpass();
		}
	}

	private constructor(private ipc?: IIPCServer) {
		if (ipc) {
			this.disposable = ipc.registerHandler('askpass', this);
		}
	}

	async handle({ request, host }: { request: string, host: string }): Promise<string> {
		const config = workspace.getConfiguration('git', null);
		const enabled = config.get<boolean>('enabled');

		if (!enabled) {
			return '';
		}

		const uri = Uri.parse(host);
		const authority = uri.authority.replace(/^.*@/, '');
		const password = /password/i.test(request);
		const cached = this.cache.get(authority);

		if (cached && password) {
			this.cache.delete(authority);
			return cached.password;
		}

		if (!password) {
			for (const credentialsProvider of this.credentialsProviders) {
				try {
					const credentials = await credentialsProvider.getCredentials(uri);

					if (credentials) {
						this.cache.set(authority, credentials);
						setTimeout(() => this.cache.delete(authority), 60_000);
						return credentials.username;
					}
				} catch { }
			}
		}

		const options: InputBoxOptions = {
			password,
			placeHolder: request,
			prompt: `Git: ${host}`,
			ignoreFocusOut: true
		};

		return await window.showInputBox(options) || '';
	}

	getEnv(): { [key: string]: string; } {
		if (!this.ipc) {
			return {
				GIT_ASKPASS: path.join(__dirname, 'askpass-empty.sh')
			};
		}

		let env: { [key: string]: string; } = {
			...this.ipc.getEnv(),
			VSCODE_GIT_ASKPASS_NODE: process.execPath,
			VSCODE_GIT_ASKPASS_MAIN: path.join(__dirname, 'askpass-main.js')
		};

		const config = workspace.getConfiguration('git');
		if (config.get<boolean>('useIntegratedAskPass')) {
			env.GIT_ASKPASS = path.join(__dirname, 'askpass.sh');
		}

		return env;
	}

	registerCredentialsProvider(provider: CredentialsProvider): Disposable {
		this.credentialsProviders.add(provider);
		return toDisposable(() => this.credentialsProviders.delete(provider));
	}

	dispose(): void {
		this.disposable.dispose();
	}
}
