/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * Allows webviews to monitor when an element in the VS Code editor is being dragged/dropped.
 *
 * This is required since webview end up eating the drag event. VS Code needs to see this
 * event so it can handle editor element drag drop.
 */
export class WebviewWindowDragMonitor extends Disposable {
	constructor(getWebview: () => Webview | undefined) {
		super();

		this._register(DOM.addDisposableListener(window, DOM.EventType.DRAG_START, () => {
			getWebview()?.windowDidDragStart();
		}));

		const onDragEnd = () => {
			getWebview()?.windowDidDragEnd();
		};

		this._register(DOM.addDisposableListener(window, DOM.EventType.DRAG_END, onDragEnd));
		this._register(DOM.addDisposableListener(window, DOM.EventType.MOUSE_MOVE, currentEvent => {
			if (currentEvent.buttons === 0) {
				onDragEnd();
			}
		}));
	}
}
