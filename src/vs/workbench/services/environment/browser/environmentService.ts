/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';
import { IColorScheme, IPath, IWindowConfiguration } from 'vs/platform/windows/common/windows';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import type { IWorkbenchConstructionOptions as IWorkbenchOptions } from 'vs/workbench/workbench.web.api';
import { IProductService } from 'vs/platform/product/common/productService';
import { memoize } from 'vs/base/common/decorators';
import { onUnexpectedError } from 'vs/base/common/errors';
import { parseLineAndColumnAware } from 'vs/base/common/extpath';

class BrowserWorkbenchConfiguration implements IWindowConfiguration {

	constructor(
		private readonly options: IBrowserWorkbenchOptions,
		private readonly payload: Map<string, string> | undefined
	) { }

	@memoize
	get sessionId(): string { return generateUuid(); }

	@memoize
	get remoteAuthority(): string | undefined { return this.options.remoteAuthority; }

	@memoize
	get filesToOpenOrCreate(): IPath[] | undefined {
		if (this.payload) {
			const fileToOpen = this.payload.get('openFile');
			if (fileToOpen) {
				const fileUri = URI.parse(fileToOpen);

				// Support: --goto parameter to open on line/col
				if (this.payload.has('gotoLineMode')) {
					const pathColumnAware = parseLineAndColumnAware(fileUri.path);

					return [{
						fileUri: fileUri.with({ path: pathColumnAware.path }),
						lineNumber: pathColumnAware.line,
						columnNumber: pathColumnAware.column
					}];
				}

				return [{ fileUri }];
			}
		}

		return undefined;
	}

	@memoize
	get filesToDiff(): IPath[] | undefined {
		if (this.payload) {
			const fileToDiffPrimary = this.payload.get('diffFilePrimary');
			const fileToDiffSecondary = this.payload.get('diffFileSecondary');
			if (fileToDiffPrimary && fileToDiffSecondary) {
				return [
					{ fileUri: URI.parse(fileToDiffSecondary) },
					{ fileUri: URI.parse(fileToDiffPrimary) }
				];
			}
		}

		return undefined;
	}

	get colorScheme(): IColorScheme {
		return { dark: false, highContrast: false };
	}
}

interface IBrowserWorkbenchOptions extends IWorkbenchOptions {
	workspaceId: string;
	logsPath: URI;
}

interface IExtensionHostDebugEnvironment {
	params: IExtensionHostDebugParams;
	debugRenderer: boolean;
	isExtensionDevelopment: boolean;
	extensionDevelopmentLocationURI?: URI[];
	extensionTestsLocationURI?: URI;
	extensionEnabledProposedApi?: string[];
}

export class BrowserWorkbenchEnvironmentService implements IWorkbenchEnvironmentService {

	declare readonly _serviceBrand: undefined;

	private _configuration: IWindowConfiguration | undefined = undefined;
	get configuration(): IWindowConfiguration {
		if (!this._configuration) {
			this._configuration = new BrowserWorkbenchConfiguration(this.options, this.payload);
		}

		return this._configuration;
	}

	@memoize
	get remoteAuthority(): string | undefined { return this.options.remoteAuthority; }

	@memoize
	get sessionId(): string { return this.configuration.sessionId; }

	@memoize
	get isBuilt(): boolean { return !!this.productService.commit; }

	@memoize
	get logsPath(): string { return this.options.logsPath.path; }

	get logLevel(): string | undefined { return this.payload?.get('logLevel'); }

	@memoize
	get logFile(): URI { return joinPath(this.options.logsPath, 'window.log'); }

	@memoize
	get userRoamingDataHome(): URI { return URI.file('/User').with({ scheme: Schemas.userData }); }

	@memoize
	get settingsResource(): URI { return joinPath(this.userRoamingDataHome, 'settings.json'); }

	@memoize
	get argvResource(): URI { return joinPath(this.userRoamingDataHome, 'argv.json'); }

	@memoize
	get snippetsHome(): URI { return joinPath(this.userRoamingDataHome, 'snippets'); }

	@memoize
	get globalStorageHome(): URI { return URI.joinPath(this.userRoamingDataHome, 'globalStorage'); }

	@memoize
	get workspaceStorageHome(): URI { return URI.joinPath(this.userRoamingDataHome, 'workspaceStorage'); }

	/*
	 * In Web every workspace can potentially have scoped user-data and/or extensions and if Sync state is shared then it can make
	 * Sync error prone - say removing extensions from another workspace. Hence scope Sync state per workspace.
	 * Sync scoped to a workspace is capable of handling opening same workspace in multiple windows.
	 */
	@memoize
	get userDataSyncHome(): URI { return joinPath(this.userRoamingDataHome, 'sync', this.options.workspaceId); }

	@memoize
	get userDataSyncLogResource(): URI { return joinPath(this.options.logsPath, 'userDataSync.log'); }

	@memoize
	get sync(): 'on' | 'off' | undefined { return undefined; }

	@memoize
	get keybindingsResource(): URI { return joinPath(this.userRoamingDataHome, 'keybindings.json'); }

	@memoize
	get keyboardLayoutResource(): URI { return joinPath(this.userRoamingDataHome, 'keyboardLayout.json'); }

	@memoize
	get untitledWorkspacesHome(): URI { return joinPath(this.userRoamingDataHome, 'Workspaces'); }

	@memoize
	get serviceMachineIdResource(): URI { return joinPath(this.userRoamingDataHome, 'machineid'); }

	@memoize
	get extHostLogsPath(): URI { return joinPath(this.options.logsPath, 'exthost'); }

	private _extensionHostDebugEnvironment: IExtensionHostDebugEnvironment | undefined = undefined;
	get debugExtensionHost(): IExtensionHostDebugParams {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.params;
	}

	get isExtensionDevelopment(): boolean {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.isExtensionDevelopment;
	}

	get extensionDevelopmentLocationURI(): URI[] | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionDevelopmentLocationURI;
	}

	get extensionTestsLocationURI(): URI | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionTestsLocationURI;
	}

	get extensionEnabledProposedApi(): string[] | undefined {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.extensionEnabledProposedApi;
	}

	get debugRenderer(): boolean {
		if (!this._extensionHostDebugEnvironment) {
			this._extensionHostDebugEnvironment = this.resolveExtensionHostDebugEnvironment();
		}

		return this._extensionHostDebugEnvironment.debugRenderer;
	}

	get disableExtensions() { return this.payload?.get('disableExtensions') === 'true'; }

	private get webviewEndpoint(): string {
		// TODO@matt: get fallback from product service
		return this.options.webviewEndpoint || 'https://{{uuid}}.vscode-webview-test.com/{{commit}}';
	}

	@memoize
	get webviewExternalEndpoint(): string {
		return (this.webviewEndpoint).replace('{{commit}}', this.productService.commit || '0d728c31ebdf03869d2687d9be0b017667c9ff37');
	}

	@memoize
	get webviewResourceRoot(): string {
		return `${this.webviewExternalEndpoint}/vscode-resource/{{resource}}`;
	}

	@memoize
	get webviewCspSource(): string {
		const uri = URI.parse(this.webviewEndpoint.replace('{{uuid}}', '*'));
		return `${uri.scheme}://${uri.authority}`;
	}

	@memoize
	get telemetryLogResource(): URI { return joinPath(this.options.logsPath, 'telemetry.log'); }
	get disableTelemetry(): boolean { return false; }

	get verbose(): boolean { return this.payload?.get('verbose') === 'true'; }
	get logExtensionHostCommunication(): boolean { return this.payload?.get('logExtensionHostCommunication') === 'true'; }

	get skipReleaseNotes(): boolean { return false; }

	private payload: Map<string, string> | undefined;

	constructor(
		readonly options: IBrowserWorkbenchOptions,
		private readonly productService: IProductService
	) {
		if (options.workspaceProvider && Array.isArray(options.workspaceProvider.payload)) {
			try {
				this.payload = new Map(options.workspaceProvider.payload);
			} catch (error) {
				onUnexpectedError(error); // possible invalid payload for map
			}
		}
	}

	private resolveExtensionHostDebugEnvironment(): IExtensionHostDebugEnvironment {
		const extensionHostDebugEnvironment: IExtensionHostDebugEnvironment = {
			params: {
				port: null,
				break: false
			},
			debugRenderer: false,
			isExtensionDevelopment: false,
			extensionDevelopmentLocationURI: undefined
		};

		// Fill in selected extra environmental properties
		if (this.payload) {
			for (const [key, value] of this.payload) {
				switch (key) {
					case 'extensionDevelopmentPath':
						extensionHostDebugEnvironment.extensionDevelopmentLocationURI = [URI.parse(value)];
						extensionHostDebugEnvironment.isExtensionDevelopment = true;
						break;
					case 'extensionTestsPath':
						extensionHostDebugEnvironment.extensionTestsLocationURI = URI.parse(value);
						break;
					case 'debugRenderer':
						extensionHostDebugEnvironment.debugRenderer = value === 'true';
						break;
					case 'debugId':
						extensionHostDebugEnvironment.params.debugId = value;
						break;
					case 'inspect-brk-extensions':
						extensionHostDebugEnvironment.params.port = parseInt(value);
						extensionHostDebugEnvironment.params.break = true;
						break;
					case 'inspect-extensions':
						extensionHostDebugEnvironment.params.port = parseInt(value);
						break;
					case 'enableProposedApi':
						extensionHostDebugEnvironment.extensionEnabledProposedApi = [];
						break;
				}
			}
		}

		return extensionHostDebugEnvironment;
	}
}
