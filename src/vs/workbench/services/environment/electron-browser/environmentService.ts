/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EnvironmentService, INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IWorkbenchEnvironmentService, IEnvironmentConfiguration } from 'vs/workbench/services/environment/common/environmentService';
import { memoize } from 'vs/base/common/decorators';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { toBackupWorkspaceResource } from 'vs/workbench/services/backup/electron-browser/backup';
import { join } from 'vs/base/common/path';
import product from 'vs/platform/product/common/product';
import { INativeWindowConfiguration } from 'vs/platform/windows/node/window';

export interface INativeWorkbenchEnvironmentService extends IWorkbenchEnvironmentService, INativeEnvironmentService {

	readonly configuration: INativeEnvironmentConfiguration;

	readonly crashReporterDirectory?: string;
	readonly crashReporterId?: string;

	readonly cliPath: string;

	readonly log?: string;
	readonly extHostLogsPath: URI;
}

export interface INativeEnvironmentConfiguration extends IEnvironmentConfiguration, INativeWindowConfiguration { }

export class NativeWorkbenchEnvironmentService extends EnvironmentService implements INativeWorkbenchEnvironmentService {

	declare readonly _serviceBrand: undefined;

	@memoize
	get webviewExternalEndpoint(): string {
		const baseEndpoint = 'https://{{uuid}}.vscode-webview-test.com/{{commit}}';

		return baseEndpoint.replace('{{commit}}', product.commit || '0d728c31ebdf03869d2687d9be0b017667c9ff37');
	}

	@memoize
	get webviewResourceRoot(): string { return `${Schemas.vscodeWebviewResource}://{{uuid}}/{{resource}}`; }

	@memoize
	get webviewCspSource(): string { return `${Schemas.vscodeWebviewResource}:`; }

	@memoize
	get userRoamingDataHome(): URI { return this.appSettingsHome.with({ scheme: Schemas.userData }); }

	@memoize
	get logFile(): URI { return URI.file(join(this.logsPath, `renderer${this.configuration.windowId}.log`)); }

	@memoize
	get extHostLogsPath(): URI { return URI.file(join(this.logsPath, `exthost${this.configuration.windowId}`)); }

	@memoize
	get skipReleaseNotes(): boolean { return !!this.args['skip-release-notes']; }

	constructor(
		readonly configuration: INativeEnvironmentConfiguration,
		execPath: string
	) {
		super(configuration, execPath);

		this.configuration.backupWorkspaceResource = this.configuration.backupPath ? toBackupWorkspaceResource(this.configuration.backupPath, this) : undefined;
	}
}
