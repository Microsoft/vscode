/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CspAlerter } from './csp';
import { StyleLoadingMonitor } from './loading';

declare global {
	interface Window {
		cspAlerter: CspAlerter;
		styleLoadingMonitor: StyleLoadingMonitor;
	}
}

window.cspAlerter = new CspAlerter();
window.styleLoadingMonitor = new StyleLoadingMonitor();
