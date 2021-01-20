/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./notificationLabel';
import * as dom from 'vs/base/browser/dom';

const $ = dom.$;

export class NotificationLabel {

	private domNode: HTMLElement;

	constructor(container: HTMLElement) {
		this.domNode = dom.append(container, $('.monaco-notification'));
		container.appendChild(this.domNode);
	}

	get element(): HTMLElement {
		return this.domNode;
	}
}
