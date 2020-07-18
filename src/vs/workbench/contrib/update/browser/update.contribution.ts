/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/platform/update/common/update.config.contribution';
import { localize } from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { ShowCurrentReleaseNotesAction, ProductContribution, UpdateContribution, CheckForVSCodeUpdateAction, CONTEXT_UPDATE_STATE, SwitchProductQualityContribution } from 'vs/workbench/contrib/update/browser/update';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import product from 'vs/platform/product/common/product';
import { StateType } from 'vs/platform/update/common/update';

const workbench = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);

workbench.registerWorkbenchContribution(ProductContribution, LifecyclePhase.Restored);
workbench.registerWorkbenchContribution(UpdateContribution, LifecyclePhase.Restored);
workbench.registerWorkbenchContribution(SwitchProductQualityContribution, LifecyclePhase.Restored);

const actionRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);

// Editor
actionRegistry
	.registerWorkbenchAction(SyncActionDescriptor.from(ShowCurrentReleaseNotesAction), `${product.nameShort}: Show Release Notes`, product.nameShort);

actionRegistry
	.registerWorkbenchAction(SyncActionDescriptor.from(CheckForVSCodeUpdateAction), `${product.nameShort}: Check for Update`, product.nameShort, CONTEXT_UPDATE_STATE.isEqualTo(StateType.Idle));

// Menu
if (ShowCurrentReleaseNotesAction.AVAILABE) {
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '1_welcome',
		command: {
			id: ShowCurrentReleaseNotesAction.ID,
			title: localize({ key: 'miReleaseNotes', comment: ['&& denotes a mnemonic'] }, "&&Release Notes")
		},
		order: 4
	});
}
