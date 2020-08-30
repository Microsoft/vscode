/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as browser from 'vs/base/browser/browser';
import * as platform from 'vs/base/common/platform';

export const enum KeyboardSupport {
	Always,
	FullScreen,
	None
}

/**
 * Browser feature we can support in current platform, browser and environment.
 */
export const BrowserFeatures = {
	clipboard: {
		writeText: (
			platform.isNative
			|| (document.queryCommandSupported && document.queryCommandSupported('copy'))
			|| !!(navigator && navigator.clipboard && navigator.clipboard.writeText)
		),
		readText: (
			platform.isNative
			|| !!(navigator && navigator.clipboard && navigator.clipboard.readText)
		),
		richText: (() => {
			if (browser.isEdge) {
				let index = navigator.userAgent.indexOf('Edge/');
				let version = parseInt(navigator.userAgent.substring(index + 5, navigator.userAgent.indexOf('.', index)), 10);

				if (!version || (version >= 12 && version <= 16)) {
					return false;
				}
			}

			return true;
		})()
	},
	keyboard: (() => {
		if (platform.isNative || browser.isStandalone) {
			return KeyboardSupport.Always;
		}

		if ((<any>navigator).keyboard || browser.isSafari) {
			return KeyboardSupport.FullScreen;
		}

		return KeyboardSupport.None;
	})(),

	// 'ontouchstart' in window always evaluates to true with typescript's modern typings. This causes `window` to be
	// `never` later in `window.navigator`. That's why we need the explicit `window as Window` cast
	touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0 || (window as Window).navigator.msMaxTouchPoints > 0,
	pointerEvents: window.PointerEvent && ('ontouchstart' in window || (window as Window).navigator.maxTouchPoints > 0 || navigator.maxTouchPoints > 0 || (window as Window).navigator.msMaxTouchPoints > 0)
};
