/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { localize } from 'vs/nls';
import { IDisposable } from 'vs/base/common/lifecycle';
import { timeout } from 'vs/base/common/async';
import { ILogService } from 'vs/platform/log/common/log';

export class ExtensionActivationProgress implements IWorkbenchContribution {

	private readonly _listener: IDisposable;

	constructor(
		@IExtensionService extensionService: IExtensionService,
		@IProgressService progressService: IProgressService,
		@ILogService logService: ILogService,
	) {

		const options = {
			location: ProgressLocation.Window,
			title: localize('activation', "Activating Extensions...")
		};

		this._listener = extensionService.onWillActivateByEvent(e => {
			logService.trace('onWillActivateByEvent: ', e.event);
			progressService.withProgress(options, _ => Promise.race([e.activation, timeout(5000)]));
		});
	}

	dispose(): void {
		this._listener.dispose();
	}
}
