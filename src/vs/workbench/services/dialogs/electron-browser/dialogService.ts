/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as os from 'os';
import Severity from 'vs/base/common/severity';
import { isLinux, isWindows } from 'vs/base/common/platform';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { IDialogService, IConfirmation, IConfirmationResult, IDialogOptions, IShowResult } from 'vs/platform/dialogs/common/dialogs';
import { DialogService as HTMLDialogService } from 'vs/workbench/services/dialogs/browser/dialogService';
import { ILogService } from 'vs/platform/log/common/log';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { DialogChannel } from 'vs/platform/dialogs/electron-browser/dialogIpc';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IProductService } from 'vs/platform/product/common/productService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { MessageBoxOptions } from 'vs/base/parts/sandbox/common/electronTypes';
import { fromNow } from 'vs/base/common/date';

interface IMassagedMessageBoxOptions {

	/**
	 * OS massaged message box options.
	 */
	options: MessageBoxOptions;

	/**
	 * Since the massaged result of the message box options potentially
	 * changes the order of buttons, we have to keep a map of these
	 * changes so that we can still return the correct index to the caller.
	 */
	buttonIndexMap: number[];
}

export class DialogService implements IDialogService {

	declare readonly _serviceBrand: undefined;

	private nativeImpl: IDialogService;
	private customImpl: IDialogService;

	constructor(
		@IConfigurationService private configurationService: IConfigurationService,
		@ILogService logService: ILogService,
		@ILayoutService layoutService: ILayoutService,
		@IThemeService themeService: IThemeService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IProductService productService: IProductService,
		@IClipboardService clipboardService: IClipboardService,
		@IElectronService electronService: IElectronService
	) {
		this.customImpl = new HTMLDialogService(logService, layoutService, themeService, keybindingService, productService, clipboardService);
		this.nativeImpl = new NativeDialogService(logService, sharedProcessService, electronService, productService, clipboardService);
	}

	private get useCustomDialog(): boolean {
		return this.configurationService.getValue('workbench.dialogs.customEnabled') === true;
	}

	confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		if (this.useCustomDialog) {
			return this.customImpl.confirm(confirmation);
		}

		return this.nativeImpl.confirm(confirmation);
	}

	show(severity: Severity, message: string, buttons: string[], options?: IDialogOptions | undefined): Promise<IShowResult> {
		if (this.useCustomDialog) {
			return this.customImpl.show(severity, message, buttons, options);
		}

		return this.nativeImpl.show(severity, message, buttons, options);
	}

	about(): Promise<void> {
		return this.nativeImpl.about();
	}
}

class NativeDialogService implements IDialogService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
		@IElectronService private readonly electronService: IElectronService,
		@IProductService private readonly productService: IProductService,
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		sharedProcessService.registerChannel('dialog', new DialogChannel(this));
	}

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.logService.trace('DialogService#confirm', confirmation.message);

		const { options, buttonIndexMap } = this.massageMessageBoxOptions(this.getConfirmOptions(confirmation));

		const result = await this.electronService.showMessageBox(options);
		return {
			confirmed: buttonIndexMap[result.response] === 0 ? true : false,
			checkboxChecked: result.checkboxChecked
		};
	}

	private getConfirmOptions(confirmation: IConfirmation): MessageBoxOptions {
		const buttons: string[] = [];
		if (confirmation.primaryButton) {
			buttons.push(confirmation.primaryButton);
		} else {
			buttons.push(nls.localize({ key: 'yesButton', comment: ['&& denotes a mnemonic'] }, "&&Yes"));
		}

		if (confirmation.secondaryButton) {
			buttons.push(confirmation.secondaryButton);
		} else if (typeof confirmation.secondaryButton === 'undefined') {
			buttons.push(nls.localize('cancelButton', "Cancel"));
		}

		const opts: MessageBoxOptions = {
			title: confirmation.title,
			message: confirmation.message,
			buttons,
			cancelId: 1
		};

		if (confirmation.detail) {
			opts.detail = confirmation.detail;
		}

		if (confirmation.type) {
			opts.type = confirmation.type;
		}

		if (confirmation.checkbox) {
			opts.checkboxLabel = confirmation.checkbox.label;
			opts.checkboxChecked = confirmation.checkbox.checked;
		}

		return opts;
	}

	async show(severity: Severity, message: string, buttons: string[], dialogOptions?: IDialogOptions): Promise<IShowResult> {
		this.logService.trace('DialogService#show', message);

		const { options, buttonIndexMap } = this.massageMessageBoxOptions({
			message,
			buttons,
			type: (severity === Severity.Info) ? 'question' : (severity === Severity.Error) ? 'error' : (severity === Severity.Warning) ? 'warning' : 'none',
			cancelId: dialogOptions ? dialogOptions.cancelId : undefined,
			detail: dialogOptions ? dialogOptions.detail : undefined,
			checkboxLabel: dialogOptions && dialogOptions.checkbox ? dialogOptions.checkbox.label : undefined,
			checkboxChecked: dialogOptions && dialogOptions.checkbox ? dialogOptions.checkbox.checked : undefined
		});

		const result = await this.electronService.showMessageBox(options);
		return { choice: buttonIndexMap[result.response], checkboxChecked: result.checkboxChecked };
	}

	private massageMessageBoxOptions(options: MessageBoxOptions): IMassagedMessageBoxOptions {
		let buttonIndexMap = (options.buttons || []).map((button, index) => index);
		let buttons = (options.buttons || []).map(button => mnemonicButtonLabel(button));
		let cancelId = options.cancelId;

		// Linux: order of buttons is reverse
		// macOS: also reverse, but the OS handles this for us!
		if (isLinux) {
			buttons = buttons.reverse();
			buttonIndexMap = buttonIndexMap.reverse();
		}

		// Default Button (always first one)
		options.defaultId = buttonIndexMap[0];

		// Cancel Button
		if (typeof cancelId === 'number') {

			// Ensure the cancelId is the correct one from our mapping
			cancelId = buttonIndexMap[cancelId];

			// macOS/Linux: the cancel button should always be to the left of the primary action
			// if we see more than 2 buttons, move the cancel one to the left of the primary
			if (!isWindows && buttons.length > 2 && cancelId !== 1) {
				const cancelButton = buttons[cancelId];
				buttons.splice(cancelId, 1);
				buttons.splice(1, 0, cancelButton);

				const cancelButtonIndex = buttonIndexMap[cancelId];
				buttonIndexMap.splice(cancelId, 1);
				buttonIndexMap.splice(1, 0, cancelButtonIndex);

				cancelId = 1;
			}
		}

		options.buttons = buttons;
		options.cancelId = cancelId;
		options.noLink = true;
		options.title = options.title || this.productService.nameLong;

		return { options, buttonIndexMap };
	}

	async about(): Promise<void> {
		let version = this.productService.version;
		if (this.productService.target) {
			version = `${version} (${this.productService.target} setup)`;
		}

		const isSnap = process.platform === 'linux' && process.env.SNAP && process.env.SNAP_REVISION;

		const detailString = (useAgo: boolean): string => {
			return nls.localize('aboutDetail',
				"Version: {0}\nCommit: {1}\nDate: {2}\nElectron: {3}\nChrome: {4}\nNode.js: {5}\nV8: {6}\nOS: {7}",
				version,
				this.productService.commit || 'Unknown',
				this.productService.date ? `${this.productService.date}${useAgo ? ' (' + fromNow(new Date(this.productService.date), true) + ')' : ''}` : 'Unknown',
				process.versions['electron'],
				process.versions['chrome'],
				process.versions['node'],
				process.versions['v8'],
				`${os.type()} ${os.arch()} ${os.release()}${isSnap ? ' snap' : ''}`
			);
		};

		const detail = detailString(true);
		const detailToCopy = detailString(false);

		const ok = nls.localize('okButton', "OK");
		const copy = mnemonicButtonLabel(nls.localize({ key: 'copy', comment: ['&& denotes a mnemonic'] }, "&&Copy"));
		let buttons: string[];
		if (isLinux) {
			buttons = [copy, ok];
		} else {
			buttons = [ok, copy];
		}

		const result = await this.electronService.showMessageBox({
			title: this.productService.nameLong,
			type: 'info',
			message: this.productService.nameLong,
			detail: `\n${detail}`,
			buttons,
			noLink: true,
			defaultId: buttons.indexOf(ok),
			cancelId: buttons.indexOf(ok)
		});

		if (buttons[result.response] === copy) {
			this.clipboardService.writeText(detailToCopy);
		}
	}
}

registerSingleton(IDialogService, DialogService, true);
