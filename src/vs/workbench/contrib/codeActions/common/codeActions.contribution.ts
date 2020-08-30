/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { CodeActionsContribution, editorConfiguration } from 'vs/workbench/contrib/codeActions/common/codeActionsContribution';
import { CodeActionsExtensionPoint, codeActionsExtensionPointDescriptor } from 'vs/workbench/contrib/codeActions/common/codeActionsExtensionPoint';
import { CodeActionDocumentationContribution } from 'vs/workbench/contrib/codeActions/common/documentationContribution';
import { DocumentationExtensionPoint, documentationExtensionPointDescriptor } from 'vs/workbench/contrib/codeActions/common/documentationExtensionPoint';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';

const codeActionsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<CodeActionsExtensionPoint[]>(codeActionsExtensionPointDescriptor);
const documentationExtensionPoint = ExtensionsRegistry.registerExtensionPoint<DocumentationExtensionPoint>(documentationExtensionPointDescriptor);

Registry.as<IConfigurationRegistry>(Extensions.Configuration)
	.registerConfiguration(editorConfiguration);

class WorkbenchConfigurationContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		instantiationService.createInstance(CodeActionsContribution, codeActionsExtensionPoint);
		instantiationService.createInstance(CodeActionDocumentationContribution, documentationExtensionPoint);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(WorkbenchConfigurationContribution, LifecyclePhase.Eventually);
