/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { timeout } from 'vs/base/common/async';
import { onUnexpectedError } from 'vs/base/common/errors';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { ILifecycleService, StartupKind, StartupKindToString } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IProductService } from 'vs/platform/product/common/productService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUpdateService } from 'vs/platform/update/common/update';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import * as files from 'vs/workbench/contrib/files/common/files';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { didUseCachedData } from 'vs/workbench/services/timer/electron-sandbox/timerService';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ITimerService } from 'vs/workbench/services/timer/browser/timerService';
import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { VSBuffer } from 'vs/base/common/buffer';

export class StartupTimings implements IWorkbenchContribution {

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ITimerService private readonly _timerService: ITimerService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IEditorService private readonly _editorService: IEditorService,
		@IViewletService private readonly _viewletService: IViewletService,
		@IPanelService private readonly _panelService: IPanelService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IUpdateService private readonly _updateService: IUpdateService,
		@INativeWorkbenchEnvironmentService private readonly _environmentService: INativeWorkbenchEnvironmentService,
		@IProductService private readonly _productService: IProductService
	) {
		//
		this._report().catch(onUnexpectedError);
	}

	private async _report() {
		const standardStartupError = await this._isStandardStartup();
		this._appendStartupTimes(standardStartupError).catch(onUnexpectedError);
	}

	private async _appendStartupTimes(standardStartupError: string | undefined) {
		const appendTo = this._environmentService.args['prof-append-timers'];
		if (!appendTo) {
			// nothing to do
			return;
		}

		const { sessionId } = await this._telemetryService.getTelemetryInfo();

		Promise.all([
			this._timerService.whenReady(),
			timeout(15000), // wait: cached data creation, telemetry sending
		]).then(async () => {
			const uri = URI.file(appendTo);
			const chunks: VSBuffer[] = [];
			if (await this._fileService.exists(uri)) {
				chunks.push((await this._fileService.readFile(uri)).value);
			}
			chunks.push(VSBuffer.fromString(`${this._timerService.startupMetrics.ellapsed}\t${this._productService.nameShort}\t${(this._productService.commit || '').slice(0, 10) || '0000000000'}\t${sessionId}\t${standardStartupError === undefined ? 'standard_start' : 'NO_standard_start : ' + standardStartupError}\n`));
			await this._fileService.writeFile(uri, VSBuffer.concat(chunks));
		}).then(() => {
			this._nativeHostService.quit();
		}).catch(err => {
			console.error(err);
			this._nativeHostService.quit();
		});
	}

	private async _isStandardStartup(): Promise<string | undefined> {
		// check for standard startup:
		// * new window (no reload)
		// * just one window
		// * explorer viewlet visible
		// * one text editor (not multiple, not webview, welcome etc...)
		// * cached data present (not rejected, not created)
		if (this._lifecycleService.startupKind !== StartupKind.NewWindow) {
			return StartupKindToString(this._lifecycleService.startupKind);
		}
		const windowCount = await this._nativeHostService.getWindowCount();
		if (windowCount !== 1) {
			return 'Expected window count : 1, Actual : ' + windowCount;
		}
		const activeViewlet = this._viewletService.getActiveViewlet();
		if (!activeViewlet || activeViewlet.getId() !== files.VIEWLET_ID) {
			return 'Explorer viewlet not visible';
		}
		const visibleEditorPanes = this._editorService.visibleEditorPanes;
		if (visibleEditorPanes.length !== 1) {
			return 'Expected text editor count : 1, Actual : ' + visibleEditorPanes.length;
		}
		if (!isCodeEditor(visibleEditorPanes[0].getControl())) {
			return 'Active editor is not a text editor';
		}
		const activePanel = this._panelService.getActivePanel();
		if (activePanel) {
			return 'Current active panel : ' + this._panelService.getPanel(activePanel.getId())?.name;
		}
		if (!didUseCachedData()) {
			return 'Either cache data is rejected or not created';
		}
		if (!await this._updateService.isLatestVersion()) {
			return 'Not on latest version, updates available';
		}
		return undefined;
	}
}
