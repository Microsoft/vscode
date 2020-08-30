/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { globals } from 'vs/base/common/platform';

const hasPerformanceNow = (globals.performance && typeof globals.performance.now === 'function');

export class StopWatch {

	private _highResolution: boolean;
	private _startTime: number;
	private _stopTime: number;

	public static create(highResolution: boolean = true): StopWatch {
		return new StopWatch(highResolution);
	}

	constructor(highResolution: boolean) {
		this._highResolution = hasPerformanceNow && highResolution;
		this._startTime = this._now();
		this._stopTime = -1;
	}

	public stop(): void {
		this._stopTime = this._now();
	}

	public elapsed(): number {
		if (this._stopTime !== -1) {
			return this._stopTime - this._startTime;
		}
		return this._now() - this._startTime;
	}

	private _now(): number {
		return this._highResolution ? globals.performance.now() : new Date().getTime();
	}
}
