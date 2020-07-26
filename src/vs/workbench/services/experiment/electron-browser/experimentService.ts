/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import { IKeyValueStorage, IExperimentationTelemetry, IExperimentationFilterProvider, ExperimentationService as TASClient } from 'tas-client';
import { MementoObject, Memento } from 'vs/workbench/common/memento';
import { IProductService } from 'vs/platform/product/common/productService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITelemetryData } from 'vs/base/common/actions';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

const storageKey = 'VSCode.ABExp.FeatureData';
const refetchInterval = 1000 * 60 * 30; // By default it's set up to 30 minutes.

class MementoKeyValueStorage implements IKeyValueStorage {
	constructor(private mementoObj: MementoObject) { }

	async getValue<T>(key: string, defaultValue?: T | undefined): Promise<T | undefined> {
		const value = await this.mementoObj[key];
		return value || defaultValue;
	}

	setValue<T>(key: string, value: T): void {
		this.mementoObj[key] = value;
	}
}

class ExperimentServiceTelemetry implements IExperimentationTelemetry {
	constructor(private telemetryService: ITelemetryService) { }

	// __GDPR__COMMON__ "VSCode.ABExp.Features" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	// __GDPR__COMMON__ "abexp.assignmentcontext" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	setSharedProperty(name: string, value: string): void {
		this.telemetryService.setExperimentProperty(name, value);
	}

	postEvent(eventName: string, props: Map<string, string>): void {
		const data: ITelemetryData = {};
		for (const [key, value] of props.entries()) {
			data[key] = value;
		}

		/* __GDPR__
			"query-expfeature" : {
				"ABExp.queriedFeature": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLog(eventName, data);
	}
}

class ExperimentServiceFilterProvider implements IExperimentationFilterProvider {
	constructor(
		private version: string,
		private appName: string,
		private machineId: string,
		private targetPopulation: TargetPopulation
	) { }

	getFilterValue(filter: string): string | null {
		switch (filter) {
			case Filters.ApplicationVersion:
				return this.version; // productService.version
			case Filters.Build:
				return this.appName; // productService.nameLong
			case Filters.ClientId:
				return this.machineId;
			case Filters.Language:
				return platform.language;
			case Filters.ExtensionName:
				return 'vscode-core'; // always return vscode-core for exp service
			case Filters.TargetPopulation:
				return this.targetPopulation;
			default:
				return '';
		}
	}

	getFilters(): Map<string, any> {
		let filters: Map<string, any> = new Map<string, any>();
		let filterValues = Object.values(Filters);
		for (let value of filterValues) {
			filters.set(value, this.getFilterValue(value));
		}

		return filters;
	}
}

/*
Based upon the official VSCode currently existing filters in the
ExP backend for the VSCode cluster.
https://experimentation.visualstudio.com/Analysis%20and%20Experimentation/_git/AnE.ExP.TAS.TachyonHost.Configuration?path=%2FConfigurations%2Fvscode%2Fvscode.json&version=GBmaster
"X-MSEdge-Market": "detection.market",
"X-FD-Corpnet": "detection.corpnet",
"X-VSCode–AppVersion": "appversion",
"X-VSCode-Build": "build",
"X-MSEdge-ClientId": "clientid",
"X-VSCode-ExtensionName": "extensionname",
"X-VSCode-TargetPopulation": "targetpopulation",
"X-VSCode-Language": "language"
*/

enum Filters {
	/**
	 * The market in which the extension is distributed.
	 */
	Market = 'X-MSEdge-Market',

	/**
	 * The corporation network.
	 */
	CorpNet = 'X-FD-Corpnet',

	/**
	 * Version of the application which uses experimentation service.
	 */
	ApplicationVersion = 'X-VSCode-AppVersion',

	/**
	 * Insiders vs Stable.
	 */
	Build = 'X-VSCode-Build',

	/**
	 * Client Id which is used as primary unit for the experimentation.
	 */
	ClientId = 'X-MSEdge-ClientId',

	/**
	 * Extension header.
	 */
	ExtensionName = 'X-VSCode-ExtensionName',

	/**
	 * The language in use by VS Code
	 */
	Language = 'X-VSCode-Language',

	/**
	 * The target population.
	 * This is used to separate internal, early preview, GA, etc.
	 */
	TargetPopulation = 'X-VSCode-TargetPopulation',
}

enum TargetPopulation {
	Team = 'team',
	Internal = 'internal',
	Insiders = 'insider',
	Public = 'public',
}

export class ExperimentService implements ITASExperimentService {
	_serviceBrand: undefined;
	private tasClient: Promise<TASClient> | undefined;
	private static MEMENTO_ID = 'experiment.service.memento';

	constructor(
		@IProductService private productService: IProductService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@IStorageService private storageService: IStorageService
	) {

		if (this.productService.tasConfig) {
			this.tasClient = this.setupTASClient();
		}
	}

	async getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined> {
		if (!this.tasClient) {
			return undefined;
		}

		return (await this.tasClient).getTreatmentVariable<T>('vscode', name);
	}

	private async setupTASClient(): Promise<TASClient> {
		const telemetryInfo = await this.telemetryService.getTelemetryInfo();
		const targetPopulation = telemetryInfo.msftInternal ? TargetPopulation.Internal : (this.productService.quality === 'stable' ? TargetPopulation.Public : TargetPopulation.Insiders);
		const machineId = telemetryInfo.machineId;
		const filterProvider = new ExperimentServiceFilterProvider(
			this.productService.version,
			this.productService.nameLong,
			machineId,
			targetPopulation
		);

		const memento = new Memento(ExperimentService.MEMENTO_ID, this.storageService);
		const keyValueStorage = new MementoKeyValueStorage(memento.getMemento(StorageScope.GLOBAL));

		const telemetry = new ExperimentServiceTelemetry(this.telemetryService);

		const tasConfig = this.productService.tasConfig!;
		const tasClient = new TASClient({
			filterProviders: [filterProvider],
			telemetry: telemetry,
			storageKey: storageKey,
			keyValueStorage: keyValueStorage,
			featuresTelemetryPropertyName: tasConfig.featuresTelemetryPropertyName,
			assignmentContextTelemetryPropertyName: tasConfig.assignmentContextTelemetryPropertyName,
			telemetryEventName: tasConfig.telemetryEventName,
			endpoint: tasConfig.endpoint,
			refetchInterval: refetchInterval,
		});

		await tasClient.initializePromise;
		return tasClient;
	}
}

registerSingleton(ITASExperimentService, ExperimentService, false);

