/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import product from 'vs/platform/product/common/product';
import { ICommandAction, MenuRegistry, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { ReportPerformanceIssueUsingReporterAction, OpenProcessExplorer } from 'vs/workbench/contrib/issue/electron-sandbox/issueActions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkbenchIssueService } from 'vs/workbench/services/issue/common/issue';
import { WorkbenchIssueService } from 'vs/workbench/services/issue/electron-sandbox/issueService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IssueReporterData } from 'vs/platform/issue/common/issue';
import { IIssueService } from 'vs/platform/issue/electron-sandbox/issue';
import { OpenIssueReporterArgs, OpenIssueReporterActionId } from 'vs/workbench/contrib/issue/common/commands';

if (!!product.reportIssueUrl) {
	registerAction2(ReportPerformanceIssueUsingReporterAction);

	CommandsRegistry.registerCommand(OpenIssueReporterActionId, function (accessor, args?: [string] | OpenIssueReporterArgs) {
		const data: Partial<IssueReporterData> = Array.isArray(args)
			? { extensionId: args[0] }
			: args || {};

		return accessor.get(IWorkbenchIssueService).openReporter(data);
	});

	const reportIssue: ICommandAction = {
		id: OpenIssueReporterActionId,
		title: {
			value: localize({ key: 'reportIssueInEnglish', comment: ['Translate this to "Report Issue in English" in all languages please!'] }, "Report Issue..."),
			original: 'Report Issue...'
		},
		category: CATEGORIES.Help
	};

	MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: reportIssue });

	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '3_feedback',
		command: {
			id: OpenIssueReporterActionId,
			title: localize({ key: 'miReportIssue', comment: ['&& denotes a mnemonic', 'Translate this to "Report Issue in English" in all languages please!'] }, "Report &&Issue")
		},
		order: 3
	});
}

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '5_tools',
	command: {
		id: 'workbench.action.openProcessExplorer',
		title: localize({ key: 'miOpenProcessExplorerer', comment: ['&& denotes a mnemonic'] }, "Open &&Process Explorer")
	},
	order: 2
});

registerAction2(OpenProcessExplorer);

registerSingleton(IWorkbenchIssueService, WorkbenchIssueService, true);

CommandsRegistry.registerCommand('_issues.getSystemStatus', (accessor) => {
	return accessor.get(IIssueService).getSystemStatus();
});
