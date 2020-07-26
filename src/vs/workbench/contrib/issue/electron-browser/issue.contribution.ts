/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import * as nls from 'vs/nls';
import product from 'vs/platform/product/common/product';
import { SyncActionDescriptor, ICommandAction, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { IWorkbenchActionRegistry, Extensions } from 'vs/workbench/common/actions';
import { ReportPerformanceIssueUsingReporterAction, OpenProcessExplorer } from 'vs/workbench/contrib/issue/electron-browser/issueActions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkbenchIssueService } from 'vs/workbench/contrib/issue/electron-browser/issue';
import { WorkbenchIssueService } from 'vs/workbench/contrib/issue/electron-browser/issueService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IssueReporterData } from 'vs/platform/issue/common/issue';
import { IIssueService } from 'vs/platform/issue/electron-sandbox/issue';
import { OpenIssueReporterArgs, OpenIssueReporterActionId } from 'vs/workbench/contrib/issue/common/commands';

const helpCategory = { value: nls.localize('help', "Help"), original: 'Help' };
const workbenchActionsRegistry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);

if (!!product.reportIssueUrl) {
	workbenchActionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(ReportPerformanceIssueUsingReporterAction), 'Help: Report Performance Issue', helpCategory.value);

	const OpenIssueReporterActionLabel = nls.localize({ key: 'reportIssueInEnglish', comment: ['Translate this to "Report Issue in English" in all languages please!'] }, "Report Issue...");

	CommandsRegistry.registerCommand(OpenIssueReporterActionId, function (accessor, args?: [string] | OpenIssueReporterArgs) {
		const data: Partial<IssueReporterData> = Array.isArray(args)
			? { extensionId: args[0] }
			: args || {};

		return accessor.get(IWorkbenchIssueService).openReporter(data);
	});

	const command: ICommandAction = {
		id: OpenIssueReporterActionId,
		title: { value: OpenIssueReporterActionLabel, original: 'Report Issue' },
		category: helpCategory
	};

	MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command });
}

const developerCategory = nls.localize({ key: 'developer', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer");
workbenchActionsRegistry.registerWorkbenchAction(SyncActionDescriptor.from(OpenProcessExplorer), 'Developer: Open Process Explorer', developerCategory);

registerSingleton(IWorkbenchIssueService, WorkbenchIssueService, true);

CommandsRegistry.registerCommand('_issues.getSystemStatus', (accessor) => {
	return accessor.get(IIssueService).getSystemStatus();
});
