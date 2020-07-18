/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { webFrame } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { zoomLevelToZoomFactor } from 'vs/platform/windows/common/windows';
import { setZoomFactor, setZoomLevel, getZoomLevel } from 'vs/base/browser/browser';

/**
 * Apply a zoom level to the window. Also sets it in our in-memory
 * browser helper so that it can be accessed in non-electron layers.
 */
export function applyZoom(zoomLevel: number): void {
	webFrame.setZoomLevel(zoomLevel);
	setZoomFactor(zoomLevelToZoomFactor(zoomLevel));
	// Cannot be trusted because the webFrame might take some time
	// until it really applies the new zoom level
	// See https://github.com/Microsoft/vscode/issues/26151
	setZoomLevel(zoomLevel, false /* isTrusted */);
}

export function zoomIn(): void {
	applyZoom(getZoomLevel() + 1);
}

export function zoomOut(): void {
	applyZoom(getZoomLevel() - 1);
}
