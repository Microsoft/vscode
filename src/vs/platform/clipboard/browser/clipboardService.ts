/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { URI } from 'vs/base/common/uri';
import { $ } from 'vs/base/browser/dom';

export class BrowserClipboardService implements IClipboardService {

	_serviceBrand: undefined;

	private _internalResourcesClipboard: URI[] | undefined;

	async writeText(text: string, type?: string): Promise<void> {
		if (type) {
			return; // TODO@sbatten support for writing a specific type into clipboard is unsupported
		}

		// Guard access to navigator.clipboard with try/catch
		// as we have seen DOMExceptions in certain browsers
		// due to security policies.
		try {
			return await navigator.clipboard.writeText(text);
		} catch (error) {
			console.error(error);
		}

		// Fallback to textarea and execCommand solution

		const activeElement = document.activeElement;

		const textArea: HTMLTextAreaElement = document.body.appendChild($('textarea', { 'aria-hidden': true }));
		textArea.style.height = '1px';
		textArea.style.width = '1px';
		textArea.style.position = 'absolute';

		textArea.value = text;
		textArea.focus();
		textArea.select();

		document.execCommand('copy');

		if (activeElement instanceof HTMLElement) {
			activeElement.focus();
		}

		document.body.removeChild(textArea);

		return;
	}

	async readText(type?: string): Promise<string> {
		if (type) {
			return ''; // TODO@sbatten support for reading a specific type from clipboard is unsupported
		}

		// Guard access to navigator.clipboard with try/catch
		// as we have seen DOMExceptions in certain browsers
		// due to security policies.
		try {
			return await navigator.clipboard.readText();
		} catch (error) {
			console.error(error);

			return '';
		}
	}

	readTextSync(): string | undefined {
		return undefined;
	}

	readFindText(): string {
		// @ts-expect-error
		return undefined;
	}

	writeFindText(text: string): void { }

	writeResources(resources: URI[]): void {
		this._internalResourcesClipboard = resources;
	}

	readResources(): URI[] {
		return this._internalResourcesClipboard || [];
	}

	hasResources(): boolean {
		return this._internalResourcesClipboard !== undefined && this._internalResourcesClipboard.length > 0;
	}
}
