/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';

export class DebugCompoundRoot {
	private stopped = false;
	private stopEmitter = new Emitter<void>();

	onDidSessionStop = this.stopEmitter.event;

	sessionStopped(): void {
		if (!this.stopped) { // avoid sending extranous terminate events
			this.stopped = true;
			this.stopEmitter.fire();
		}
	}
}
