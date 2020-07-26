/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IExperimentService } from 'vs/workbench/contrib/experiments/common/experimentService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IProductService } from 'vs/platform/product/common/productService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { AbstractTelemetryOptOut } from 'vs/workbench/contrib/welcome/telemetryOptOut/browser/telemetryOptOut';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';

export class NativeTelemetryOptOut extends AbstractTelemetryOptOut {

	constructor(
		@IStorageService storageService: IStorageService,
		@IOpenerService openerService: IOpenerService,
		@INotificationService notificationService: INotificationService,
		@IHostService hostService: IHostService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExperimentService experimentService: IExperimentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExtensionGalleryService galleryService: IExtensionGalleryService,
		@IProductService productService: IProductService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IJSONEditingService jsonEditingService: IJSONEditingService,
		@IElectronService private readonly electronService: IElectronService
	) {
		super(storageService, openerService, notificationService, hostService, telemetryService, experimentService, configurationService, galleryService, productService, environmentService, jsonEditingService);

		this.handleTelemetryOptOut();
	}

	protected getWindowCount(): Promise<number> {
		return this.electronService.getWindowCount();
	}
}
