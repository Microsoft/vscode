/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { ILocalTerminalService } from 'vs/platform/terminal/common/terminal';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IRemoteTerminalService, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { BaseTerminalProfileResolverService } from 'vs/workbench/contrib/terminal/browser/terminalProfileResolverService';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IHistoryService } from 'vs/workbench/services/history/common/history';

export class ElectronTerminalProfileResolverService extends BaseTerminalProfileResolverService {

	constructor(
		@IConfigurationResolverService configurationResolverService: IConfigurationResolverService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHistoryService historyService: IHistoryService,
		@ILogService logService: ILogService,
		@ITerminalService terminalService: ITerminalService,
		@ILocalTerminalService localTerminalService: ILocalTerminalService,
		@IRemoteTerminalService remoteTerminalService: IRemoteTerminalService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService
	) {
		super(
			{
				getDefaultSystemShell: async (remoteAuthority, platform) => {
					const service = remoteAuthority ? remoteTerminalService : localTerminalService;
					return service.getDefaultSystemShell(platform);
				},
				getEnvironment: (remoteAuthority) => {
					if (remoteAuthority) {
						return remoteTerminalService.getEnvironment();
					} else {
						return localTerminalService.getEnvironment();
					}
				}
			},
			configurationService,
			configurationResolverService,
			historyService,
			logService,
			terminalService,
			workspaceContextService
		);
	}
}
