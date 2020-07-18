/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ShutdownReason, ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { AbstractLifecycleService } from 'vs/platform/lifecycle/common/lifecycleService';
import { localize } from 'vs/nls';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class BrowserLifecycleService extends AbstractLifecycleService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService readonly logService: ILogService
	) {
		super(logService);

		this.registerListeners();
	}

	private registerListeners(): void {
		window.addEventListener('beforeunload', e => this.onBeforeUnload(e));
	}

	private onBeforeUnload(event: BeforeUnloadEvent): void {
		const logService = this.logService;
		logService.info('[lifecycle] onBeforeUnload triggered');

		let veto = false;

		// Before Shutdown
		this._onBeforeShutdown.fire({
			veto(value) {
				if (value === true) {
					veto = true;
				} else if (value instanceof Promise && !veto) {
					logService.error('[lifecycle] Long running onBeforeShutdown currently not supported in the web');
					veto = true;
				}
			},
			reason: ShutdownReason.QUIT
		});

		// Veto: signal back to browser by returning a non-falsify return value
		if (veto) {
			event.preventDefault();
			event.returnValue = localize('lifecycleVeto', "Changes that you made may not be saved. Please check press 'Cancel' and try again.");

			return;
		}

		// No Veto: continue with Will Shutdown
		this._onWillShutdown.fire({
			join() {
				logService.error('[lifecycle] Long running onWillShutdown currently not supported in the web');
			},
			reason: ShutdownReason.QUIT
		});

		// Finally end with Shutdown event
		this._onShutdown.fire();
	}
}

registerSingleton(ILifecycleService, BrowserLifecycleService);
