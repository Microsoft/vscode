/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import { TPromise } from 'vs/base/common/winjs.base';
import { Registry } from 'vs/platform/platform';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actionRegistry';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { Action } from 'vs/base/common/actions';
import { IQuickOpenService, IPickOpenEntry } from 'vs/workbench/services/quickopen/common/quickOpenService';
import { IActivityService } from 'vs/workbench/services/activity/common/activityService';

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);

export class ToggleExternalViewletAction extends Action {
	public static ID = 'workbench.view.customTreeExplorerViewlet';
	public static LABEL = nls.localize('toggleCustomExplorer', 'Toggle Custom Explorer');

	constructor(
		id: string,
		label: string,
		@IQuickOpenService private quickOpenService: IQuickOpenService,
		@IActivityService private activityService: IActivityService
	) {
		super(id, name);
	}

	run(): TPromise<any> {
		const viewletsToggleStataus = this.activityService.getRegisteredViewletsIsEnabled();

		const picks: IPickOpenEntry[] = [];
		for (let viewletId in viewletsToggleStataus) {
			picks.push({
				id: viewletId,
				label: (viewletsToggleStataus[viewletId] ? 'Disable ' : 'Enable ') + this.getShortViewletId(viewletId)
			});
		}

		return TPromise.timeout(50 /* quick open is sensitive to being opened so soon after another */).then(() => {
			this.quickOpenService.pick(picks, { placeHolder: 'Select Viewlet to toggle', autoFocus: 2 }).then(pick => {
				if (pick) {
					this.activityService.toggleViewlet(pick.id);
				}
			});
		});
	}

	private getShortViewletId(viewletId: string): string {
		return viewletId.split('.').pop();
	}
}

registry.registerWorkbenchAction(
	new SyncActionDescriptor(ToggleExternalViewletAction, ToggleExternalViewletAction.ID, ToggleExternalViewletAction.LABEL),
	'View: Toggle Custom Explorer',
	nls.localize('view', "View")
);
