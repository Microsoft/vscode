/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { BaseConfigurationResolverService } from 'vs/workbench/services/configurationResolver/browser/configurationResolverService';
import { process } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { ILabelService } from 'vs/platform/label/common/label';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class ConfigurationResolverService extends BaseConfigurationResolverService {

	constructor(
		@IEditorService editorService: IEditorService,
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IConfigurationService configurationService: IConfigurationService,
		@ICommandService commandService: ICommandService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IQuickInputService quickInputService: IQuickInputService,
		@ILabelService labelService: ILabelService,
		@IUriIdentityService uriIdentityService: IUriIdentityService
	) {
		super({
			getExecPath: (): string | undefined => {
				return environmentService.execPath;
			}
		}, process.env as IProcessEnvironment, editorService, configurationService, commandService, workspaceContextService, quickInputService, labelService, uriIdentityService);
	}
}

registerSingleton(IConfigurationResolverService, ConfigurationResolverService, true);
