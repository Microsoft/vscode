/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService, ITelemetryInfo, ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService, combinedAppender, LogAppender, ITelemetryAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { TelemetryService as BaseTelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { resolveWorkbenchCommonProperties } from 'vs/platform/telemetry/browser/workbenchCommonProperties';
import { IProductService } from 'vs/platform/product/common/productService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

export class WebTelemetryAppender implements ITelemetryAppender {

	constructor(private _logService: ILogService, private _appender: IRemoteAgentService) { }

	log(eventName: string, data: any): void {
		this._logService.trace(`telemetry/${eventName}`, data);
		this._appender.logTelemetry(eventName, data);
	}

	flush(): Promise<void> {
		return this._appender.flushTelemetry();
	}
}

export class TelemetryService extends Disposable implements ITelemetryService {

	declare readonly _serviceBrand: undefined;

	private impl: ITelemetryService;
	public readonly sendErrorTelemetry = false;

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@ILogService logService: ILogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IProductService productService: IProductService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService
	) {
		super();

		if (!!productService.enableTelemetry) {
			const config: ITelemetryServiceConfig = {
				appender: combinedAppender(new WebTelemetryAppender(logService, remoteAgentService), new LogAppender(logService)),
				commonProperties: resolveWorkbenchCommonProperties(storageService, productService.commit, productService.version, environmentService.configuration.remoteAuthority, environmentService.options && environmentService.options.resolveCommonTelemetryProperties),
				sendErrorTelemetry: false,
			};

			this.impl = this._register(new BaseTelemetryService(config, configurationService));
		} else {
			this.impl = NullTelemetryService;
		}
	}

	setEnabled(value: boolean): void {
		return this.impl.setEnabled(value);
	}

	setExperimentProperty(name: string, value: string): void {
		return this.impl.setExperimentProperty(name, value);
	}

	get isOptedIn(): boolean {
		return this.impl.isOptedIn;
	}

	publicLog(eventName: string, data?: ITelemetryData, anonymizeFilePaths?: boolean): Promise<void> {
		return this.impl.publicLog(eventName, data, anonymizeFilePaths);
	}

	publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>, anonymizeFilePaths?: boolean) {
		return this.publicLog(eventName, data as ITelemetryData, anonymizeFilePaths);
	}

	publicLogError(errorEventName: string, data?: ITelemetryData): Promise<void> {
		return this.impl.publicLog(errorEventName, data);
	}

	publicLogError2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLogError(eventName, data as ITelemetryData);
	}

	getTelemetryInfo(): Promise<ITelemetryInfo> {
		return this.impl.getTelemetryInfo();
	}
}

registerSingleton(ITelemetryService, TelemetryService);
