/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureActiveDirectoryService, onDidChangeSessions } from './AADHelper';
import TelemetryReporter from 'vscode-extension-telemetry';

export const DEFAULT_SCOPES = 'https://management.core.windows.net/.default offline_access';

export async function activate(context: vscode.ExtensionContext) {
	const { name, version, aiKey } = require('../package.json') as { name: string, version: string, aiKey: string };
	const telemetryReporter = new TelemetryReporter(name, version, aiKey);

	const loginService = new AzureActiveDirectoryService();

	await loginService.initialize();

	context.subscriptions.push(vscode.authentication.registerAuthenticationProvider({
		id: 'microsoft',
		label: 'Microsoft',
		supportsMultipleAccounts: true,
		onDidChangeSessions: onDidChangeSessions.event,
		getSessions: () => Promise.resolve(loginService.sessions),
		login: async (scopes: string[]) => {
			try {
				/* __GDPR__
					"login" : { }
				*/
				telemetryReporter.sendTelemetryEvent('login');

				const session = await loginService.login(scopes.sort().join(' '));
				onDidChangeSessions.fire({ added: [session.id], removed: [], changed: [] });
				return session;
			} catch (e) {
				/* __GDPR__
					"loginFailed" : { }
				*/
				telemetryReporter.sendTelemetryEvent('loginFailed');

				throw e;
			}
		},
		logout: async (id: string) => {
			try {
				/* __GDPR__
					"logout" : { }
				*/
				telemetryReporter.sendTelemetryEvent('logout');

				await loginService.logout(id);
				onDidChangeSessions.fire({ added: [], removed: [id], changed: [] });
			} catch (e) {
				/* __GDPR__
					"logoutFailed" : { }
				*/
				telemetryReporter.sendTelemetryEvent('logoutFailed');
			}
		}
	}));

	return;
}

// this method is called when your extension is deactivated
export function deactivate() { }
