/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDialogHandler, IDialogResult, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IProductService } from 'vs/platform/product/common/productService';
import { Registry } from 'vs/platform/registry/common/platform';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IDialogsModel, IDialogViewItem } from 'vs/workbench/common/dialogs';
import { BrowserDialogHandler } from 'vs/workbench/browser/parts/dialogs/dialogHandler';
import { NativeDialogHandler } from 'vs/workbench/electron-sandbox/parts/dialogs/dialogHandler';
import { DialogService } from 'vs/workbench/services/dialogs/common/dialogService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Disposable } from 'vs/base/common/lifecycle';

export class DialogHandlerContribution extends Disposable implements IWorkbenchContribution {
	private nativeImpl: IDialogHandler;
	private browserImpl: IDialogHandler;

	private model: IDialogsModel;
	private currentDialog: IDialogViewItem | undefined;

	constructor(
		@IConfigurationService private configurationService: IConfigurationService,
		@IDialogService private dialogService: IDialogService,
		@ILogService logService: ILogService,
		@ILayoutService layoutService: ILayoutService,
		@IThemeService themeService: IThemeService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IProductService productService: IProductService,
		@IClipboardService clipboardService: IClipboardService,
		@INativeHostService nativeHostService: INativeHostService
	) {
		super();

		this.browserImpl = new BrowserDialogHandler(logService, layoutService, themeService, keybindingService, productService, clipboardService);
		this.nativeImpl = new NativeDialogHandler(logService, nativeHostService, productService, clipboardService);

		this.model = (this.dialogService as DialogService).model;

		this._register(this.model.onDidShowDialog(() => {
			if (!this.currentDialog) {
				this.processDialogs();
			}
		}));

		this.processDialogs();
	}

	private async processDialogs(): Promise<void> {
		while (this.model.dialogs.length) {
			this.currentDialog = this.model.dialogs[0];

			let result: IDialogResult | undefined = undefined;
			if (this.currentDialog.args.confirmArgs) {
				const args = this.currentDialog.args.confirmArgs;
				result = this.useCustomDialog ? await this.browserImpl.confirm(args.confirmation) : await this.nativeImpl.confirm(args.confirmation);
			} else if (this.currentDialog.args.inputArgs) {
				const args = this.currentDialog.args.inputArgs;
				result = this.useCustomDialog ?
					await this.browserImpl.input(args.severity, args.message, args.buttons, args.inputs, args.options) :
					await this.nativeImpl.input(args.severity, args.message, args.buttons, args.inputs, args.options);
			} else if (this.currentDialog.args.showArgs) {
				const args = this.currentDialog.args.showArgs;
				result = this.useCustomDialog ?
					await this.browserImpl.show(args.severity, args.message, args.buttons, args.options) :
					await this.nativeImpl.show(args.severity, args.message, args.buttons, args.options);
			} else {
				await this.nativeImpl.about();
			}

			this.currentDialog.close(result);
			this.currentDialog = undefined;
		}
	}

	private get useCustomDialog(): boolean {
		return this.configurationService.getValue('window.dialogStyle') === 'custom';
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(DialogHandlerContribution, LifecyclePhase.Starting);
