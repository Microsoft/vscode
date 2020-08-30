/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { PreviewStatusBarEntry } from './ownedStatusBarEntry';

const localize = nls.loadMessageBundle();

class BinarySize {
	static readonly KB = 1024;
	static readonly MB = BinarySize.KB * BinarySize.KB;
	static readonly GB = BinarySize.MB * BinarySize.KB;
	static readonly TB = BinarySize.GB * BinarySize.KB;

	static formatSize(size: number): string {
		if (size < BinarySize.KB) {
			return localize('sizeB', "{0}B", size);
		}

		if (size < BinarySize.MB) {
			return localize('sizeKB', "{0}KB", (size / BinarySize.KB).toFixed(2));
		}

		if (size < BinarySize.GB) {
			return localize('sizeMB', "{0}MB", (size / BinarySize.MB).toFixed(2));
		}

		if (size < BinarySize.TB) {
			return localize('sizeGB', "{0}GB", (size / BinarySize.GB).toFixed(2));
		}

		return localize('sizeTB', "{0}TB", (size / BinarySize.TB).toFixed(2));
	}
}

export class BinarySizeStatusBarEntry extends PreviewStatusBarEntry {

	constructor() {
		super({
			id: 'imagePreview.binarySize',
			name: localize('sizeStatusBar.name', "Image Binary Size"),
			alignment: vscode.StatusBarAlignment.Right,
			priority: 100,
		});
	}

	public show(owner: string, size: number | undefined) {
		if (typeof size === 'number') {
			super.showItem(owner, BinarySize.formatSize(size));
		} else {
			this.hide(owner);
		}
	}
}
