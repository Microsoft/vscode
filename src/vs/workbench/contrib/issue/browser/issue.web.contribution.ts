/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ICommandAction, MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IProductService } from 'vs/platform/product/common/productService';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IWebIssueService, WebIssueService } from 'vs/workbench/contrib/issue/browser/issueService';
import { OpenIssueReporterArgs, OpenIssueReporterActionId } from 'vs/workbench/contrib/issue/common/commands';

class RegisterIssueContribution implements IWorkbenchContribution {

	constructor(@IProductService readonly productService: IProductService) {
		if (productService.reportIssueUrl) {
			const helpCategory = { value: nls.localize('help', "Help"), original: 'Help' };
			const OpenIssueReporterActionLabel = nls.localize({ key: 'reportIssueInEnglish', comment: ['Translate this to "Report Issue in English" in all languages please!'] }, "Report Issue");

			CommandsRegistry.registerCommand(OpenIssueReporterActionId, function (accessor, args?: [string] | OpenIssueReporterArgs) {
				let extensionId: string | undefined;
				if (args) {
					if (Array.isArray(args)) {
						[extensionId] = args;
					} else {
						extensionId = args.extensionId;
					}
				}

				return accessor.get(IWebIssueService).openReporter({ extensionId });
			});

			const command: ICommandAction = {
				id: OpenIssueReporterActionId,
				title: { value: OpenIssueReporterActionLabel, original: 'Report Issue' },
				category: helpCategory
			};

			MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command });
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(RegisterIssueContribution, LifecyclePhase.Starting);

CommandsRegistry.registerCommand('_issues.getSystemStatus', (accessor) => {
	return nls.localize('statusUnsupported', "The --status argument is not yet supported in browsers.");
});

registerSingleton(IWebIssueService, WebIssueService, true);
