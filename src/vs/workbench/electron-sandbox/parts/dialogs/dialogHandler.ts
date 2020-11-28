/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { fromNow } from 'vs/base/common/date';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { isLinux, isWindows } from 'vs/base/common/platform';
import Severity from 'vs/base/common/severity';
import { MessageBoxOptions } from 'vs/base/parts/sandbox/common/electronTypes';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfirmation, IConfirmationResult, IDialogHandler, IDialogOptions, IShowResult } from 'vs/platform/dialogs/common/dialogs';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IProductService } from 'vs/platform/product/common/productService';
import { process } from 'vs/base/parts/sandbox/electron-sandbox/globals';

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

export class NativeDialogHandler implements IDialogHandler {

	constructor(
		@ILogService private readonly logService: ILogService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IProductService private readonly productService: IProductService,
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
	}

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		this.logService.trace('DialogService#confirm', confirmation.message);

		const { options, buttonIndexMap } = this.massageMessageBoxOptions(this.getConfirmOptions(confirmation));

		const result = await this.nativeHostService.showMessageBox(options);
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

		const result = await this.nativeHostService.showMessageBox(options);
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

	input(): never {
		throw new Error('Unsupported'); // we have no native API for password dialogs in Electron
	}

	async about(): Promise<void> {
		let version = this.productService.version;
		if (this.productService.target) {
			version = `${version} (${this.productService.target} setup)`;
		}

		const isSnap = process.platform === 'linux' && process.env.SNAP && process.env.SNAP_REVISION;
		const osProps = await this.nativeHostService.getOSProperties();

		const detailString = (useAgo: boolean): string => {
			return nls.localize({ key: 'aboutDetail', comment: ['Electron, Chrome, Node.js and V8 are product names that need no translation'] },
				"Version: {0}\nCommit: {1}\nDate: {2}\nElectron: {3}\nChrome: {4}\nNode.js: {5}\nV8: {6}\nOS: {7}",
				version,
				this.productService.commit || 'Unknown',
				this.productService.date ? `${this.productService.date}${useAgo ? ' (' + fromNow(new Date(this.productService.date), true) + ')' : ''}` : 'Unknown',
				process.versions['electron'],
				process.versions['chrome'],
				process.versions['node'],
				process.versions['v8'],
				`${osProps.type} ${osProps.arch} ${osProps.release}${isSnap ? ' snap' : ''}`
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

		const result = await this.nativeHostService.showMessageBox({
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

