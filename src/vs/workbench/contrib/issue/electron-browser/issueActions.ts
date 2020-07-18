/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import * as nls from 'vs/nls';
import { IssueType } from 'vs/platform/issue/common/issue';
import { IWorkbenchIssueService } from 'vs/workbench/contrib/issue/electron-browser/issue';

export class OpenProcessExplorer extends Action {
	static readonly ID = 'workbench.action.openProcessExplorer';
	static readonly LABEL = nls.localize('openProcessExplorer', "Open Process Explorer");

	constructor(
		id: string,
		label: string,
		@IWorkbenchIssueService private readonly issueService: IWorkbenchIssueService
	) {
		super(id, label);
	}

	run(): Promise<boolean> {
		return this.issueService.openProcessExplorer().then(() => true);
	}
}

export class ReportPerformanceIssueUsingReporterAction extends Action {
	static readonly ID = 'workbench.action.reportPerformanceIssueUsingReporter';
	static readonly LABEL = nls.localize('reportPerformanceIssue', "Report Performance Issue");

	constructor(
		id: string,
		label: string,
		@IWorkbenchIssueService private readonly issueService: IWorkbenchIssueService
	) {
		super(id, label);
	}

	run(): Promise<boolean> {
		return this.issueService.openReporter({ issueType: IssueType.PerformanceIssue }).then(() => true);
	}
}
