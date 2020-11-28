/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { Disposable } from 'vs/base/common/lifecycle';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { IDisplayMainService } from 'vs/platform/display/common/displayMainService';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { clearAllFontInfos } from 'vs/editor/browser/config/configuration';

class DisplayChangeRemeasureFonts extends Disposable implements IWorkbenchContribution {

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		super();
		const displayMainService = createChannelSender<IDisplayMainService>(mainProcessService.getChannel('display'));
		displayMainService.onDidDisplayChanged(() => {
			clearAllFontInfos();
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DisplayChangeRemeasureFonts, LifecyclePhase.Eventually);
