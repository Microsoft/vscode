/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from 'vs/platform/product/common/product';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { State, IUpdate, AvailableForDownload, UpdateType } from 'vs/platform/update/common/update';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { createUpdateURL, AbstractUpdateService, UpdateNotAvailableClassification } from 'vs/platform/update/electron-main/abstractUpdateService';
import { IRequestService, asJson } from 'vs/platform/request/common/request';
import { shell } from 'electron';
import { CancellationToken } from 'vs/base/common/cancellation';

export class LinuxUpdateService extends AbstractUpdateService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentService environmentService: INativeEnvironmentService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService
	) {
		super(lifecycleMainService, configurationService, environmentService, requestService, logService);
	}

	protected buildUpdateFeedUrl(quality: string): string {
		return createUpdateURL(`linux-${process.arch}`, quality);
	}

	protected doCheckForUpdates(context: any): void {
		if (!this.url) {
			return;
		}

		this.setState(State.CheckingForUpdates(context));
		this.requestService.request({ url: this.url }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then(update => {
				if (!update || !update.url || !update.version || !update.productVersion) {
					this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: !!context });

					this.setState(State.Idle(UpdateType.Archive));
				} else {
					this.setState(State.AvailableForDownload(update));
				}
			})
			.then(undefined, err => {
				this.logService.error(err);
				this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: !!context });
				// only show message when explicitly checking for updates
				const message: string | undefined = !!context ? (err.message || err) : undefined;
				this.setState(State.Idle(UpdateType.Archive, message));
			});
	}

	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// Use the download URL if available as we don't currently detect the package type that was
		// installed and the website download page is more useful than the tarball generally.
		if (product.downloadUrl && product.downloadUrl.length > 0) {
			shell.openExternal(product.downloadUrl);
		} else if (state.update.url) {
			shell.openExternal(state.update.url);
		}

		this.setState(State.Idle(UpdateType.Archive));
	}
}
