/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessagePoster } from './messaging';
import { getSettings } from './settings';
import { getStrings } from './strings';

/**
 * Shows an alert when there is a content security policy violation.
 */
export class CspAlerter {
	private didShow = false;
	private didHaveCspWarning = false;

	private messaging?: MessagePoster;

	constructor() {
		document.addEventListener('securitypolicyviolation', () => {
			this.onCspWarning();
		});

		window.addEventListener('message', (event) => {
			if (event && event.data && event.data.name === 'vscode-did-block-svg') {
				this.onCspWarning();
			}
		});
	}

	public setPoster(poster: MessagePoster) {
		this.messaging = poster;
		if (this.didHaveCspWarning) {
			this.showCspWarning();
		}
	}

	private onCspWarning() {
		this.didHaveCspWarning = true;
		this.showCspWarning();
	}

	private showCspWarning() {
		const strings = getStrings();
		const settings = getSettings();

		if (this.didShow || settings.disableSecurityWarnings || !this.messaging) {
			return;
		}
		this.didShow = true;

		const notification = document.createElement('a');
		notification.innerText = strings.cspAlertMessageText;
		notification.setAttribute('id', 'code-csp-warning');
		notification.setAttribute('title', strings.cspAlertMessageTitle);

		notification.setAttribute('role', 'button');
		notification.setAttribute('aria-label', strings.cspAlertMessageLabel);
		notification.onclick = () => {
			this.messaging!.postMessage('showPreviewSecuritySelector', { source: settings.source });
		};
		document.body.appendChild(notification);
	}
}
