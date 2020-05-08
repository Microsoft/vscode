/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IActivityService, IActivity } from 'vs/workbench/services/activity/common/activity';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { IActivityBarService } from 'vs/workbench/services/activityBar/browser/activityBarService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { GLOBAL_ACTIVITY_ID } from 'vs/workbench/common/activity';

export class ActivityService implements IActivityService {

	public _serviceBrand: undefined;

	constructor(
		@IPanelService private readonly panelService: IPanelService,
		@IActivityBarService private readonly activityBarService: IActivityBarService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
	) { }

	showViewContainerActivity(viewContainerId: string, { badge, clazz, priority }: IActivity): IDisposable {
		const viewContainer = this.viewDescriptorService.getViewContainerById(viewContainerId);
		if (viewContainer) {
			const location = this.viewDescriptorService.getViewContainerLocation(viewContainer);
			switch (location) {
				case ViewContainerLocation.Panel:
					return this.panelService.showActivity(viewContainer.id, badge, clazz);
				case ViewContainerLocation.Sidebar:
					return this.activityBarService.showActivity(viewContainer.id, badge, clazz, priority);
			}
		}
		return Disposable.None;
	}

	showGlobalActivity({ badge, clazz, priority }: IActivity): IDisposable {
		return this.activityBarService.showActivity(GLOBAL_ACTIVITY_ID, badge, clazz, priority);
	}
}

registerSingleton(IActivityService, ActivityService, true);
