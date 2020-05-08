/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./aria';
import { isMacintosh } from 'vs/base/common/platform';
import * as dom from 'vs/base/browser/dom';

// Use a max length since we are inserting the whole msg in the DOM and that can cause browsers to freeze for long messages #94233
const MAX_MESSAGE_LENGTH = 20000;
let ariaContainer: HTMLElement;
let alertContainer: HTMLElement;
let statusContainer: HTMLElement;
export function setARIAContainer(parent: HTMLElement) {
	ariaContainer = document.createElement('div');
	ariaContainer.className = 'monaco-aria-container';

	alertContainer = document.createElement('div');
	alertContainer.className = 'monaco-alert';
	alertContainer.setAttribute('role', 'alert');
	alertContainer.setAttribute('aria-atomic', 'true');
	ariaContainer.appendChild(alertContainer);

	statusContainer = document.createElement('div');
	statusContainer.className = 'monaco-status';
	statusContainer.setAttribute('role', 'complementary');
	statusContainer.setAttribute('aria-live', 'polite');
	statusContainer.setAttribute('aria-atomic', 'true');
	ariaContainer.appendChild(statusContainer);

	parent.appendChild(ariaContainer);
}

/**
 * Given the provided message, will make sure that it is read as alert to screen readers.
 */
export function alert(msg: string): void {
	insertMessage(alertContainer, msg);
}

/**
 * Given the provided message, will make sure that it is read as status to screen readers.
 */
export function status(msg: string): void {
	if (isMacintosh) {
		alert(msg); // VoiceOver does not seem to support status role
	} else {
		insertMessage(statusContainer, msg);
	}
}

function insertMessage(target: HTMLElement, msg: string): void {
	if (!ariaContainer) {
		return;
	}

	dom.clearNode(target);
	if (msg.length > MAX_MESSAGE_LENGTH) {
		msg = msg.substr(0, MAX_MESSAGE_LENGTH);
	}
	target.textContent = msg;

	// See https://www.paciellogroup.com/blog/2012/06/html5-accessibility-chops-aria-rolealert-browser-support/
	target.style.visibility = 'hidden';
	target.style.visibility = 'visible';
}
