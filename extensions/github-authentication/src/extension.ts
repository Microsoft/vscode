/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GitHubAuthenticationProvider, onDidChangeSessions } from './github';
import { uriHandler } from './githubServer';
import Logger from './common/logger';
import TelemetryReporter from 'vscode-extension-telemetry';
import { createExperimentationService, ExperimentationTelemetry } from './experimentationService';

export async function activate(context: vscode.ExtensionContext) {
	const { name, version, aiKey } = require('../package.json') as { name: string, version: string, aiKey: string };
	const telemetryReporter = new ExperimentationTelemetry(new TelemetryReporter(name, version, aiKey));

	const experimentationService = await createExperimentationService(context, telemetryReporter);
	await experimentationService.initialFetch;

	context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
	const loginService = new GitHubAuthenticationProvider(context, telemetryReporter);

	await loginService.initialize(context);

	context.subscriptions.push(vscode.commands.registerCommand('github.provide-token', () => {
		return loginService.manuallyProvideToken();
	}));

	context.subscriptions.push(vscode.authentication.registerAuthenticationProvider('github', 'GitHub', {
		onDidChangeSessions: onDidChangeSessions.event,
		getSessions: (scopes?: string[]) => loginService.getSessions(scopes),
		createSession: async (scopeList: string[]) => {
			try {
				/* __GDPR__
					"login" : { }
				*/
				telemetryReporter.sendTelemetryEvent('login');

				const session = await loginService.createSession(scopeList.sort().join(' '));
				Logger.info('Login success!');
				onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
				return session;
			} catch (e) {
				// If login was cancelled, do not notify user.
				if (e.message === 'Cancelled') {
					/* __GDPR__
						"loginCancelled" : { }
					*/
					telemetryReporter.sendTelemetryEvent('loginCancelled');
					throw e;
				}

				/* __GDPR__
					"loginFailed" : { }
				*/
				telemetryReporter.sendTelemetryEvent('loginFailed');

				vscode.window.showErrorMessage(`Sign in failed: ${e}`);
				Logger.error(e);
				throw e;
			}
		},
		removeSession: async (id: string) => {
			try {
				/* __GDPR__
					"logout" : { }
				*/
				telemetryReporter.sendTelemetryEvent('logout');

				const session = await loginService.removeSession(id);
				if (session) {
					onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
				}
			} catch (e) {
				/* __GDPR__
					"logoutFailed" : { }
				*/
				telemetryReporter.sendTelemetryEvent('logoutFailed');

				vscode.window.showErrorMessage(`Sign out failed: ${e}`);
				Logger.error(e);
				throw e;
			}
		}
	}, { supportsMultipleAccounts: false }));

	return;
}

// this method is called when your extension is deactivated
export function deactivate() { }
