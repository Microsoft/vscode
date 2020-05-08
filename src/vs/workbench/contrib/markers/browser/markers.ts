/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkersModel, compareMarkersByUri } from './markersModel';
import { Disposable } from 'vs/base/common/lifecycle';
import { IMarkerService, MarkerSeverity, IMarker } from 'vs/platform/markers/common/markers';
import { NumberBadge, ViewContaierActivityByView } from 'vs/workbench/services/activity/common/activity';
import { localize } from 'vs/nls';
import Constants from './constants';
import { URI } from 'vs/base/common/uri';
import { groupBy } from 'vs/base/common/arrays';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Event } from 'vs/base/common/event';
import { ResourceMap } from 'vs/base/common/map';

export const IMarkersWorkbenchService = createDecorator<IMarkersWorkbenchService>('markersWorkbenchService');

export interface IMarkersWorkbenchService {
	_serviceBrand: undefined;
	readonly markersModel: MarkersModel;
}

export class MarkersWorkbenchService extends Disposable implements IMarkersWorkbenchService {
	_serviceBrand: undefined;

	readonly markersModel: MarkersModel;

	constructor(
		@IMarkerService private readonly markerService: IMarkerService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this.markersModel = this._register(instantiationService.createInstance(MarkersModel));

		this.markersModel.setResourceMarkers(groupBy(this.readMarkers(), compareMarkersByUri).map(group => [group[0].resource, group]));
		this._register(Event.debounce<readonly URI[], ResourceMap<URI>>(markerService.onMarkerChanged, (resourcesMap, resources) => {
			resourcesMap = resourcesMap ? resourcesMap : new ResourceMap<URI>();
			resources.forEach(resource => resourcesMap!.set(resource, resource));
			return resourcesMap;
		}, 0)(resourcesMap => this.onMarkerChanged([...resourcesMap.values()])));
	}

	private onMarkerChanged(resources: URI[]): void {
		this.markersModel.setResourceMarkers(resources.map(resource => [resource, this.readMarkers(resource)]));
	}

	private readMarkers(resource?: URI): IMarker[] {
		return this.markerService.read({ resource, severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info });
	}

}

export class ActivityUpdater extends Disposable implements IWorkbenchContribution {

	private readonly activity: ViewContaierActivityByView;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IMarkerService private readonly markerService: IMarkerService
	) {
		super();
		this.activity = this._register(instantiationService.createInstance(ViewContaierActivityByView, Constants.MARKERS_VIEW_ID));
		this._register(this.markerService.onMarkerChanged(() => this.updateActivity()));
		this.updateActivity();
	}

	private updateActivity(): void {
		const { errors, warnings, infos } = this.markerService.getStatistics();
		const total = errors + warnings + infos;
		const message = localize('totalProblems', 'Total {0} Problems', total);
		this.activity.setActivity({ badge: new NumberBadge(total, () => message) });
	}
}
