/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from 'vs/base/common/strings';
import { renderCodicons } from 'vs/base/common/codicons';

export class CodiconLabel {

	constructor(
		private readonly _container: HTMLElement
	) { }

	set text(text: string) {
		this._container.innerHTML = renderCodicons(escape(text ?? ''));
	}

	set title(title: string) {
		this._container.title = title;
	}
}
