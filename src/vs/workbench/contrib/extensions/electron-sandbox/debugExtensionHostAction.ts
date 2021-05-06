/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IProductService } from 'vs/platform/product/common/productService';
import { Action } from 'vs/base/common/actions';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IDebugService } from 'vs/workbench/contrib/debug/common/debug';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { randomPort } from 'vs/base/common/ports';

export class DebugExtensionHostAction extends Action {
	static readonly ID = 'workbench.extensions.action.debugExtensionHost';
	static readonly LABEL = nls.localize('debugExtensionHost', "Start Debugging Extension Host");
	static readonly CSS_CLASS = 'debug-extension-host';

	constructor(
		@IDebugService private readonly _debugService: IDebugService,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IDialogService private readonly _dialogService: IDialogService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IProductService private readonly productService: IProductService
	) {
		super(DebugExtensionHostAction.ID, DebugExtensionHostAction.LABEL, DebugExtensionHostAction.CSS_CLASS);
	}

	override async run(): Promise<any> {

		const inspectPort = await this._extensionService.getInspectPort(false);
		if (!inspectPort) {
			const res = await this._dialogService.confirm({
				type: 'info',
				message: nls.localize('restart1', "Profile Extensions"),
				detail: nls.localize('restart2', "In order to profile extensions a restart is required. Do you want to restart '{0}' now?", this.productService.nameLong),
				primaryButton: nls.localize('restart3', "&&Restart"),
				secondaryButton: nls.localize('cancel', "&&Cancel")
			});
			if (res.confirmed) {
				await this._nativeHostService.relaunch({ addArgs: [`--inspect-extensions=${randomPort()}`] });
			}

			return;
		}

		return this._debugService.startDebugging(undefined, {
			type: 'node',
			name: nls.localize('debugExtensionHost.launch.name', "Attach Extension Host"),
			request: 'attach',
			port: inspectPort
		});
	}
}
