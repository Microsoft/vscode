/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable, IDisposable } from 'vs/base/common/lifecycle';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { localize } from 'vs/nls';
import Constants from './constants';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';

export class ActivityUpdater extends Disposable implements IWorkbenchContribution {

	private readonly activity = this._register(new MutableDisposable<IDisposable>());

	constructor(
		@IActivityService private readonly activityService: IActivityService,
		@IMarkerService private readonly markerService: IMarkerService
	) {
		super();
		this._register(this.markerService.onMarkerChanged(() => this.updateBadge()));
		this.updateBadge();
	}

	private updateBadge(): void {
		const { errors, warnings, infos } = this.markerService.getStatistics();
		const total = errors + warnings + infos;
		const message = localize('totalProblems', 'Total {0} Problems', total);
		this.activity.value = this.activityService.showViewActivity(Constants.MARKERS_VIEW_ID, { badge: new NumberBadge(total, () => message) });
	}
}
