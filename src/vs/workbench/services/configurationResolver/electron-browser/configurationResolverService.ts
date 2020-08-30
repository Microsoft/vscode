/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { BaseConfigurationResolverService } from 'vs/workbench/services/configurationResolver/browser/configurationResolverService';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';

export class ConfigurationResolverService extends BaseConfigurationResolverService {

	constructor(
		@IEditorService editorService: IEditorService,
		@IWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@ICommandService commandService: ICommandService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IQuickInputService quickInputService: IQuickInputService
	) {
		super({
			getExecPath: (): string | undefined => {
				return environmentService.execPath;
			}
		}, process.env as IProcessEnvironment, editorService, configurationService, commandService, workspaceContextService, quickInputService);
	}
}

registerSingleton(IConfigurationResolverService, ConfigurationResolverService, true);
