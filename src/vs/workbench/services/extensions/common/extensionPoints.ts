/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Severity } from 'vs/platform/notification/common/notification';

export interface Translations {
	[id: string]: string;
}

export namespace Translations {
	export function equals(a: Translations, b: Translations): boolean {
		if (a === b) {
			return true;
		}
		let aKeys = Object.keys(a);
		let bKeys: Set<string> = new Set<string>();
		for (let key of Object.keys(b)) {
			bKeys.add(key);
		}
		if (aKeys.length !== bKeys.size) {
			return false;
		}

		for (let key of aKeys) {
			if (a[key] !== b[key]) {
				return false;
			}
			bKeys.delete(key);
		}
		return bKeys.size === 0;
	}
}

export interface ILog {
	error(source: string, message: string): void;
	warn(source: string, message: string): void;
	info(source: string, message: string): void;
}

export class Logger implements ILog {

	private readonly _messageHandler: (severity: Severity, source: string, message: string) => void;

	constructor(
		messageHandler: (severity: Severity, source: string, message: string) => void
	) {
		this._messageHandler = messageHandler;
	}

	public error(source: string, message: string): void {
		this._messageHandler(Severity.Error, source, message);
	}

	public warn(source: string, message: string): void {
		this._messageHandler(Severity.Warning, source, message);
	}

	public info(source: string, message: string): void {
		this._messageHandler(Severity.Info, source, message);
	}
}
