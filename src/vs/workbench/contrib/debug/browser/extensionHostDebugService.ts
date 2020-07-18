/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionHostDebugChannelClient, ExtensionHostDebugBroadcastChannel } from 'vs/platform/debug/common/extensionHostDebugIpc';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IExtensionHostDebugService, IOpenExtensionWindowResult } from 'vs/platform/debug/common/extensionHostDebug';
import { IDebugHelperService } from 'vs/workbench/contrib/debug/common/debug';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkspaceProvider, IWorkspace } from 'vs/workbench/services/host/browser/browserHostService';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { ILogService } from 'vs/platform/log/common/log';

class BrowserExtensionHostDebugService extends ExtensionHostDebugChannelClient implements IExtensionHostDebugService {

	private workspaceProvider: IWorkspaceProvider;

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ILogService logService: ILogService
	) {
		const connection = remoteAgentService.getConnection();
		let channel: IChannel;
		if (connection) {
			channel = connection.getChannel(ExtensionHostDebugBroadcastChannel.ChannelName);
		} else {
			channel = { call: async () => undefined, listen: () => Event.None } as any;
			// TODO@weinand TODO@isidorn fallback?
			logService.warn('Extension Host Debugging not available due to missing connection.');
		}

		super(channel);

		if (environmentService.options && environmentService.options.workspaceProvider) {
			this.workspaceProvider = environmentService.options.workspaceProvider;
		} else {
			this.workspaceProvider = { open: async () => undefined, workspace: undefined };
			logService.warn('Extension Host Debugging not available due to missing workspace provider.');
		}

		// Reload window on reload request
		this._register(this.onReload(event => {
			if (environmentService.isExtensionDevelopment && environmentService.debugExtensionHost.debugId === event.sessionId) {
				window.location.reload();
			}
		}));

		// Close window on close request
		this._register(this.onClose(event => {
			if (environmentService.isExtensionDevelopment && environmentService.debugExtensionHost.debugId === event.sessionId) {
				window.close();
			}
		}));
	}

	async openExtensionDevelopmentHostWindow(args: string[], env: IProcessEnvironment): Promise<IOpenExtensionWindowResult> {

		// Find out which workspace to open debug window on
		let debugWorkspace: IWorkspace = undefined;
		const folderUriArg = this.findArgument('folder-uri', args);
		if (folderUriArg) {
			debugWorkspace = { folderUri: URI.parse(folderUriArg) };
		} else {
			const fileUriArg = this.findArgument('file-uri', args);
			if (fileUriArg && hasWorkspaceFileExtension(fileUriArg)) {
				debugWorkspace = { workspaceUri: URI.parse(fileUriArg) };
			}
		}

		// Add environment parameters required for debug to work
		const environment = new Map<string, string>();

		const fileUriArg = this.findArgument('file-uri', args);
		if (fileUriArg && !hasWorkspaceFileExtension(fileUriArg)) {
			environment.set('openFile', fileUriArg);
		}

		const extensionDevelopmentPath = this.findArgument('extensionDevelopmentPath', args);
		if (extensionDevelopmentPath) {
			environment.set('extensionDevelopmentPath', extensionDevelopmentPath);
		}

		const extensionTestsPath = this.findArgument('extensionTestsPath', args);
		if (extensionTestsPath) {
			environment.set('extensionTestsPath', extensionTestsPath);
		}

		const debugId = this.findArgument('debugId', args);
		if (debugId) {
			environment.set('debugId', debugId);
		}

		const inspectBrkExtensions = this.findArgument('inspect-brk-extensions', args);
		if (inspectBrkExtensions) {
			environment.set('inspect-brk-extensions', inspectBrkExtensions);
		}

		const inspectExtensions = this.findArgument('inspect-extensions', args);
		if (inspectExtensions) {
			environment.set('inspect-extensions', inspectExtensions);
		}

		// Open debug window as new window. Pass ParsedArgs over.
		await this.workspaceProvider.open(debugWorkspace, {
			reuse: false, 								// debugging always requires a new window
			payload: Array.from(environment.entries())	// mandatory properties to enable debugging
		});

		return {};
	}

	private findArgument(key: string, args: string[]): string | undefined {
		for (const a of args) {
			const k = `--${key}=`;
			if (a.indexOf(k) === 0) {
				return a.substr(k.length);
			}
		}

		return undefined;
	}
}

registerSingleton(IExtensionHostDebugService, BrowserExtensionHostDebugService, true);

class BrowserDebugHelperService implements IDebugHelperService {

	declare readonly _serviceBrand: undefined;

	createTelemetryService(configurationService: IConfigurationService, args: string[]): TelemetryService | undefined {
		return undefined;
	}
}

registerSingleton(IDebugHelperService, BrowserDebugHelperService, true);
